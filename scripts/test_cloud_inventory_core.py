"""Offline checks for what the three inventory collectors share.

No provider's CLI is run: the inventory is filled by hand, as a collector
would fill it, and what it writes is held to the format the server reads.
"""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from cloud_inventory import core

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SCHEMA = json.loads(
    (ROOT / "schemas" / "v1" / "inventory.schema.json").read_text("utf-8")
)
WHEN = "2026-11-21T12:00:00Z"


def shop(**options):
    """A balancer, two services and a store, with what each is a member of."""
    inventory = core.Inventory("aws", "shop", **options)
    inventory.add(
        "arn:lb",
        name="shop alb",
        kind="api-gateway",
        native="AWS::ElasticLoadBalancingV2::LoadBalancer",
        region="sa-east-1",
        network="shop",
        tags={"env": "prod"},
        public=True,
        groups=["sg-lb"],
    )
    for name in ("storefront", "checkout"):
        inventory.add(
            f"arn:{name}",
            name=name,
            kind="container",
            native="AWS::ECS::Service",
            region="sa-east-1",
            network="shop",
            tags={"env": "prod", "app": "shop"},
            members=2,
            groups=["sg-app"],
        )
    inventory.add(
        "arn:db",
        name="orders-db",
        kind="database",
        native="AWS::RDS::DBCluster",
        region="sa-east-1",
        network="shop",
        tags={"env": "prod"},
        groups=["sg-db"],
    )
    inventory.relate("arn:lb", "arn:storefront", "routing", "target group storefront")
    inventory.relate("arn:lb", "arn:checkout", "routing", "target group checkout")
    inventory.admit(
        "sg-app", "sg-db", "security group rule: app may reach db on tcp/5432"
    )
    return inventory


def relations(document):
    return [
        (relation["from"], relation["to"], relation["basis"])
        for relation in document["relations"]
    ]


class InventoryTest(unittest.TestCase):
    def test_a_resource_takes_an_id_made_of_its_name_and_never_the_providers_own(self):
        document = shop().document(WHEN)
        self.assertEqual(
            [resource["id"] for resource in document["resources"]],
            ["shop-alb", "storefront", "checkout", "orders-db"],
        )
        # The key a collector looks a resource up by is not written anywhere.
        self.assertNotIn("arn:", json.dumps(document))
        self.assertEqual(document["kind"], "aegis-cloud-inventory")
        self.assertEqual(document["version"], 1)
        self.assertEqual(document["provider"], "aws")
        self.assertEqual(document["collectedAt"], WHEN)

    def test_two_resources_of_one_name_are_told_apart(self):
        inventory = core.Inventory("gcp", "twice")
        for key, region in (
            ("a", "us-east1"),
            ("b", "europe-west1"),
            ("c", "us-east1"),
            ("e", "us-east1"),
        ):
            inventory.add(
                key,
                name="api",
                kind="serverless",
                native="run.googleapis.com/Service",
                region=region,
            )
        # What stands for whoever is outside is not a name a resource may take.
        inventory.add(
            "d", name="clients", kind="container", native="x", region="us-east1"
        )
        self.assertEqual(
            [resource["id"] for resource in inventory.document(WHEN)["resources"]],
            # By its region where that tells them apart, by a number after.
            ["api", "api-europe-west1", "api-us-east1", "api-2", "clients-us-east1"],
        )

    def test_an_id_is_what_a_topology_accepts_whatever_the_name(self):
        inventory = core.Inventory("oci", "names")
        inventory.add(
            "a",
            name="Pedidos (produção) / v2",
            kind="container",
            native="x",
            region="r",
        )
        inventory.add("b", name="x" * 200, kind="container", native="x", region="r")
        inventory.add("c", name="!!!", kind="database", native="x", region="r")
        ids = [resource["id"] for resource in inventory.document(WHEN)["resources"]]
        self.assertEqual(ids[0], "Pedidos-produ-o-v2")
        self.assertEqual(ids[1], "x" * 64)
        self.assertEqual(ids[2], "database")
        for one in ids:
            self.assertRegex(one, r"^[A-Za-z0-9_.-]{1,64}$")

    def test_a_relation_is_kept_once_between_two_resources_that_are_listed(self):
        inventory = shop()
        inventory.relate("arn:lb", "arn:checkout", "routing", "listener rule 2")
        inventory.relate("arn:lb", "arn:nowhere", "routing", "target group gone")
        inventory.relate("arn:db", "arn:db", "declared", "itself")
        self.assertEqual(
            relations(inventory.document(WHEN)),
            [
                ("shop-alb", "storefront", "routing"),
                ("shop-alb", "checkout", "routing"),
                ("storefront", "orders-db", "network"),
                ("checkout", "orders-db", "network"),
            ],
        )

    def test_a_network_rule_is_a_relation_between_the_members_of_two_groups(self):
        inventory = shop()
        # A group that admits itself says nothing between two resources of
        # one piece, and a group nothing is a member of says nothing at all.
        inventory.admit("sg-db", "sg-db", "self")
        inventory.admit("sg-empty", "sg-db", "nobody")
        document = inventory.document(WHEN)
        network = [r for r in document["relations"] if r["basis"] == "network"]
        self.assertEqual(
            [(r["from"], r["to"]) for r in network],
            [("storefront", "orders-db"), ("checkout", "orders-db")],
        )
        self.assertEqual(
            network[0]["evidence"],
            "security group rule: app may reach db on tcp/5432",
        )
        without = shop(network_rules=False).document(WHEN)
        self.assertFalse([r for r in without["relations"] if r["basis"] == "network"])
        self.assertIn("Network rules were not read", " ".join(without["notes"]))

    def test_only_what_carries_the_asked_tags_is_written(self):
        document = shop(only_tags=[("app", "shop")]).document(WHEN)
        self.assertEqual(
            [resource["id"] for resource in document["resources"]],
            ["storefront", "checkout"],
        )
        # A relation to something left out is left out with it.
        self.assertEqual(relations(document), [])
        # A key alone asks only that it be there.
        present = shop(only_tags=[("app", None)]).document(WHEN)
        self.assertEqual(len(present["resources"]), 2)
        # Which keys are written is a separate choice.
        kept = shop(tag_keys=["env"]).document(WHEN)
        self.assertEqual(kept["resources"][1]["tags"], {"env": "prod"})
        none = shop(tag_keys=[]).document(WHEN)
        self.assertNotIn("tags", none["resources"][1])

    def test_a_kind_and_a_relation_can_be_declared_by_name(self):
        inventory = shop()
        inventory.declare_kinds([("checkout", "microservice")])
        inventory.declare_relations([("checkout", "storefront")])
        document = inventory.document(WHEN)
        self.assertEqual(document["resources"][2]["type"], "microservice")
        self.assertIn(
            {
                "from": "checkout",
                "to": "storefront",
                "basis": "declared",
                "evidence": "declared by the operator",
            },
            document["relations"],
        )
        with self.assertRaisesRegex(core.CollectError, "nobody"):
            shop().declare_kinds([("nobody", "database")])
        with self.assertRaisesRegex(core.CollectError, "nobody"):
            shop().declare_relations([("checkout", "nobody")])
        twice = shop()
        twice.add(
            "arn:other",
            name="checkout",
            kind="container",
            native="x",
            region="us-east-1",
        )
        with self.assertRaisesRegex(core.CollectError, "2 resources"):
            twice.declare_kinds([("checkout", "database")])

    def test_what_is_written_is_what_the_format_holds(self):
        document = shop().document(WHEN)
        definitions = SCHEMA["definitions"]
        self.assertLessEqual(set(document), set(SCHEMA["properties"]))
        self.assertLessEqual(set(SCHEMA["required"]), set(document))
        for resource in document["resources"]:
            self.assertLessEqual(
                set(resource), set(definitions["Resource"]["properties"])
            )
            self.assertLessEqual(
                set(definitions["Resource"]["required"]), set(resource)
            )
        for relation in document["relations"]:
            self.assertLessEqual(
                set(relation), set(definitions["Relation"]["properties"])
            )
        # Nothing absent is written as empty: a store has no members to count.
        self.assertNotIn("members", document["resources"][3])
        self.assertNotIn("public", document["resources"][3])
        self.assertTrue(document["resources"][0]["public"])
        self.assertEqual(document["resources"][1]["members"], 2)

    def test_the_bounds_and_the_names_are_the_schemas(self):
        definitions = SCHEMA["definitions"]
        self.assertEqual(list(core.SERVICE_TYPES), definitions["ServiceType"]["enum"])
        # Each basis is described on its own in the schema.
        self.assertEqual(
            list(core.BASES),
            [one["const"] for one in definitions["Basis"]["oneOf"]],
        )
        self.assertEqual(list(core.PROVIDERS), definitions["Provider"]["enum"])
        self.assertEqual(core.KIND, SCHEMA["properties"]["kind"]["enum"][0])
        self.assertEqual(core.VERSION, SCHEMA["properties"]["version"]["maximum"])
        self.assertEqual(
            core.MAX_RESOURCES, SCHEMA["properties"]["resources"]["maxItems"]
        )
        self.assertEqual(
            core.MAX_RELATIONS, SCHEMA["properties"]["relations"]["maxItems"]
        )
        self.assertEqual(core.MAX_NOTES, SCHEMA["properties"]["notes"]["maxItems"])
        resource = definitions["Resource"]["properties"]
        self.assertEqual(core.MAX_ID_LEN, resource["id"]["maxLength"])
        self.assertEqual(core.MAX_TEXT_LEN, resource["name"]["maxLength"])
        self.assertEqual(core.MAX_ID_LEN, SCHEMA["properties"]["name"]["maxLength"])

    def test_more_than_a_file_holds_stops_the_collection_and_says_what_to_do(self):
        inventory = core.Inventory("aws", "many")
        for i in range(core.MAX_RESOURCES + 1):
            inventory.add(i, name=f"fn-{i}", kind="serverless", native="x", region="r")
        with self.assertRaisesRegex(core.CollectError, "--region|--tag"):
            inventory.document(WHEN)
        # A rule between two large groups is as many relations as their product.
        wide = core.Inventory("aws", "wide")
        for i in range(300):
            wide.add(
                ("a", i),
                name=f"a-{i}",
                kind="container",
                native="x",
                region="r",
                groups=["a"],
            )
            wide.add(
                ("b", i),
                name=f"b-{i}",
                kind="database",
                native="x",
                region="r",
                groups=["b"],
            )
        wide.admit("a", "b", "rule")
        with self.assertRaisesRegex(core.CollectError, "--no-network-rules"):
            wide.document(WHEN)

    def test_text_past_what_the_format_holds_is_cut_and_tags_past_the_most_noted(self):
        inventory = core.Inventory("oci", "long")
        inventory.add(
            "a",
            name="n" * 400,
            kind="container",
            native="x",
            region="r",
            tags={f"k{i:03}": "v" for i in range(80)},
        )
        inventory.add("b", name="b", kind="database", native="x", region="r")
        inventory.relate("a", "b", "declared", "e" * 400)
        document = inventory.document(WHEN)
        self.assertEqual(len(document["resources"][0]["name"]), core.MAX_TEXT_LEN)
        self.assertEqual(len(document["relations"][0]["evidence"]), core.MAX_TEXT_LEN)
        self.assertEqual(len(document["resources"][0]["tags"]), core.MAX_TAGS)
        self.assertIn("k000", document["resources"][0]["tags"])
        self.assertIn("more than 64 tags", " ".join(document["notes"]))

    def test_what_could_not_be_read_is_noted_without_what_the_provider_said(self):
        inventory = shop()

        def refused():
            raise core.CliError(
                "aws sqs list-queues",
                "AccessDenied",
                "User: arn:aws:iam::123456789012:user/ana is not authorized",
            )

        with contextlib.redirect_stderr(io.StringIO()) as shown:
            self.assertIsNone(inventory.attempt("Queues", refused))
            self.assertEqual(inventory.attempt("Tables", lambda: 3), 3)
        document = inventory.document(WHEN)
        self.assertEqual(
            document["notes"], ["Queues could not be read (AccessDenied)."]
        )
        # The operator sees the provider's own words; the file does not hold them.
        self.assertIn("123456789012", shown.getvalue())
        self.assertNotIn("123456789012", json.dumps(document))

    def test_a_collection_in_which_nothing_was_read_is_an_error(self):
        inventory = core.Inventory("aws", "empty")

        def refused():
            raise core.CliError("aws ec2 describe-instances", "ExpiredToken", "expired")

        with contextlib.redirect_stderr(io.StringIO()):
            inventory.attempt("Instances", refused)
        with self.assertRaisesRegex(core.CollectError, "ExpiredToken"):
            inventory.document(WHEN)


class ArgumentTest(unittest.TestCase):
    def test_a_tag_a_kind_and_a_relation_are_read_from_one_argument_each(self):
        self.assertEqual(core.tag_pair("env=prod"), ("env", "prod"))
        self.assertEqual(core.tag_pair("team=a=b"), ("team", "a=b"))
        self.assertEqual(core.tag_pair("env"), ("env", None))
        self.assertEqual(
            core.kind_pair("orders=db=database"), ("orders=db", "database")
        )
        self.assertEqual(
            core.relation_pair("checkout=order-events"), ("checkout", "order-events")
        )
        for bad, parse in (
            ("", core.tag_pair),
            ("=prod", core.tag_pair),
            ("orders-db", core.kind_pair),
            ("orders-db=warehouse", core.kind_pair),
            ("orders-db=external-client", core.kind_pair),
            ("checkout", core.relation_pair),
            ("checkout=", core.relation_pair),
        ):
            with self.assertRaises(core.argparse.ArgumentTypeError, msg=bad):
                parse(bad)

    def test_a_name_given_to_a_cli_is_a_name_and_never_an_option(self):
        self.assertEqual(core.plain("prod-readonly"), "prod-readonly")
        self.assertEqual(
            core.plain("ocid1.compartment.oc1..aaaa"), "ocid1.compartment.oc1..aaaa"
        )
        for bad in ("--endpoint-url=http://x", "-p", "", "a b", "a;b", "x" * 300):
            with self.assertRaises(core.argparse.ArgumentTypeError, msg=bad):
                core.plain(bad)


class RunTest(unittest.TestCase):
    def test_a_refusal_is_read_wherever_the_cli_printed_it(self):
        from unittest import mock

        # Not every CLI says what went wrong on the error stream.
        for printed in (
            {"stderr": "ERROR: denied (Forbidden)", "stdout": ""},
            {"stderr": "", "stdout": "ERROR: Could not find config file (Forbidden)"},
        ):
            failed = mock.Mock(returncode=1, **printed)
            with mock.patch.object(core.subprocess, "run", return_value=failed):
                with self.assertRaises(core.CliError) as raised:
                    core.run(["tool", "list"], (r"\((\w+)\)",), "tool list")
            self.assertEqual(raised.exception.code, "Forbidden")
            self.assertIn("ERROR", raised.exception.said)

    def test_an_answer_is_json_and_nothing_printed_is_nothing_found(self):
        from unittest import mock

        for printed, read in (('{"data": [1]}', {"data": [1]}), ("  \n", {}), ("[]", [])):
            done = mock.Mock(returncode=0, stdout=printed, stderr="")
            with mock.patch.object(core.subprocess, "run", return_value=done) as ran:
                self.assertEqual(core.run(["tool", "list"], (), "tool list"), read)
            # A list of arguments, never a line for a shell.
            self.assertEqual(ran.call_args.args[0], ["tool", "list"])
            self.assertNotIn("shell", ran.call_args.kwargs)


class WriteTest(unittest.TestCase):
    def test_the_file_is_new_and_within_what_the_server_reads(self):
        document = shop().document(WHEN)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "inventory.json"
            core.write(path, document)
            self.assertEqual(json.loads(path.read_text("utf-8")), document)
            with self.assertRaisesRegex(core.CollectError, "already exists"):
                core.write(path, document)
            large = dict(document, notes=["n" * 1000] * 5000)
            with self.assertRaisesRegex(core.CollectError, "4 MiB"):
                core.write(Path(directory) / "large.json", large)
            self.assertFalse((Path(directory) / "large.json").exists())


if __name__ == "__main__":
    unittest.main()
