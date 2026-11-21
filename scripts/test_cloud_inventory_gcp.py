"""Offline checks for the Google Cloud inventory collector.

gcloud is never run: each test hands the collector a fake `call` that answers
in the shapes `gcloud ... --format=json` prints, which are the resources of
the REST APIs as their references give them, a list of them for each read.
The shapes were written from the gcloud and REST references, not recorded
from a project; the refusals in `ClientTest` were written from how the Cloud
SDK builds its error messages, not copied from a terminal.

`examples/cloud-inventory/topologies/gcp-shop.json` is what the collector writes from
the answers below. To write it again after changing either:

    AEGIS_UPDATE_EXAMPLES=1 python3 -B -m unittest discover -s scripts -p 'test_cloud_inventory_gcp.py'
"""

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest import mock

from cloud_inventory import core, gcp

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
EXAMPLE = ROOT / "examples" / "cloud-inventory" / "topologies" / "gcp-shop.json"
WHEN = "2026-11-21T12:00:00Z"

PROJECT = "acme-retail-prod"
NUMBER = "123456789012"
REGION = "southamerica-east1"
ZONE = f"{REGION}-a"
ELSEWHERE = "us-central1"
COMPUTE = f"https://www.googleapis.com/compute/v1/projects/{PROJECT}"


def link(rest):
    """A Compute Engine URL, as every reference between its resources is written."""
    return f"{COMPUTE}/{rest}"


def regional(rest, region=REGION):
    return link(f"regions/{region}/{rest}")


def zonal(rest, zone=ZONE):
    return link(f"zones/{zone}/{rest}")


def path(rest):
    """A resource name of the newer APIs: relative, and beginning with the project."""
    return f"projects/{PROJECT}/{rest}"


def account(name):
    return f"{name}@{PROJECT}.iam.gserviceaccount.com"


NETWORK = link("global/networks/shop")
NODE_GROUP = "gke-platform-default-pool-5f3a1b2c-grp"
NODE_TAG = "gke-platform-1a2b3c4d-node"


def address_of(service):
    """A Cloud Run service's own URL."""
    return f"https://{service}-abc123xyz-rj.a.run.app"


def instance(
    name,
    tags=(),
    *,
    status="RUNNING",
    address=None,
    group=None,
    network=NETWORK,
    labels=None,
    runs_as="compute",
    zone=ZONE,
):
    interface = {
        "name": "nic0",
        "network": network,
        "subnetwork": regional("subnetworks/shop"),
        "networkIP": "10.0.1.10",
    }
    if address:
        interface["accessConfigs"] = [
            {"name": "external-nat", "type": "ONE_TO_ONE_NAT", "natIP": address}
        ]
    items = [{"key": "enable-oslogin", "value": "TRUE"}]
    if group:
        # How an instance says which managed group made it: with the
        # project's number, not its id.
        items.append({"key": "created-by", "value": f"projects/{NUMBER}/{group}"})
    described = {
        "name": name,
        "zone": link(f"zones/{zone}"),
        "status": status,
        "networkInterfaces": [interface],
        "tags": {"fingerprint": "42WmSpB8rSM="},
        "serviceAccounts": [
            {
                "email": account(runs_as),
                "scopes": ["https://www.googleapis.com/auth/cloud-platform"],
            }
        ],
        "metadata": {"items": items},
        "selfLink": zonal(f"instances/{name}", zone),
    }
    if tags:
        described["tags"]["items"] = list(tags)
    if labels:
        described["labels"] = dict(labels)
    return described


def firewall(name, allowed, *, network=NETWORK, **stated):
    """An ingress rule that allows. `stated` is whom it is from and whom it applies to."""
    rule = {
        "name": name,
        "network": network,
        "direction": "INGRESS",
        "priority": 1000,
        "allowed": allowed,
        "disabled": False,
        "selfLink": link(f"global/firewalls/{name}"),
    }
    rule.update(stated)
    return rule


def tcp(*ports):
    return [{"IPProtocol": "tcp", "ports": [str(port) for port in ports]}]


def forwarding_rule(name, scheme, *, region=None, **stated):
    rule = {
        "name": name,
        "IPAddress": "203.0.113.10" if scheme.startswith("EXTERNAL") else "10.0.0.20",
        "IPProtocol": "TCP",
        "loadBalancingScheme": scheme,
        "selfLink": regional(f"forwardingRules/{name}", region)
        if region
        else link(f"global/forwardingRules/{name}"),
    }
    if region:
        rule["region"] = link(f"regions/{region}")
    rule.update(stated)
    return rule


def backend_service(name, *groups, scheme="EXTERNAL_MANAGED", region=None):
    service = {
        "name": name,
        "protocol": "HTTPS",
        "loadBalancingScheme": scheme,
        "backends": [{"group": group, "balancingMode": "UTILIZATION"} for group in groups],
        "selfLink": regional(f"backendServices/{name}", region)
        if region
        else link(f"global/backendServices/{name}"),
    }
    if region:
        service["region"] = link(f"regions/{region}")
    return service


def serverless_group(name, region=REGION, **names):
    """A serverless network endpoint group: it names a service or a function by its name."""
    return {
        "name": name,
        "networkEndpointType": "SERVERLESS",
        "region": link(f"regions/{region}"),
        "selfLink": regional(f"networkEndpointGroups/{name}", region),
        **names,
    }


def managed_group(name, size, *, zone=ZONE, region=None):
    """A managed instance group, zonal unless it is given a region."""
    where = f"regions/{region}" if region else f"zones/{zone}"
    group = {
        "name": name,
        "baseInstanceName": name,
        "targetSize": size,
        "instanceGroup": link(f"{where}/instanceGroups/{name}"),
        "instanceTemplate": link(f"global/instanceTemplates/{name}-v3"),
        "selfLink": link(f"{where}/instanceGroupManagers/{name}"),
    }
    group["region" if region else "zone"] = link(where)
    return group


def run_service(name, ingress, *, region=REGION, labels=None, sql=()):
    """A Cloud Run service as the v1 API gives it: an object of Knative's."""
    template = {"autoscaling.knative.dev/maxScale": "10"}
    if sql:
        template["run.googleapis.com/cloudsql-instances"] = ",".join(sql)
    return {
        "apiVersion": "serving.knative.dev/v1",
        "kind": "Service",
        "metadata": {
            "name": name,
            "namespace": NUMBER,
            "labels": {"cloud.googleapis.com/location": region, **(labels or {})},
            "annotations": {
                "run.googleapis.com/ingress": ingress,
                "run.googleapis.com/ingress-status": ingress,
            },
        },
        "spec": {
            "template": {
                "metadata": {"annotations": template},
                "spec": {"serviceAccountName": account(name)},
            }
        },
        "status": {"url": address_of(name)},
    }


def function(name, *, region=REGION, generation="GEN_2", ingress="ALLOW_INTERNAL_ONLY", **stated):
    """A function as the v2 API gives it, whichever generation it is of."""
    described = {
        "name": path(f"locations/{region}/functions/{name}"),
        "environment": generation,
        "state": "ACTIVE",
        "serviceConfig": {
            "service": path(f"locations/{region}/services/{name}"),
            "uri": address_of(name),
            "ingressSettings": ingress,
            "serviceAccountEmail": account(name),
        },
        "url": f"https://{region}-{PROJECT}.cloudfunctions.net/{name}",
    }
    described.update(stated)
    return described


def subscription(name, topic, endpoint=None, **stated):
    described = {
        "name": path(f"subscriptions/{name}"),
        "topic": path(f"topics/{topic}"),
        # A subscription that is pulled from has a push configuration with nothing in it.
        "pushConfig": {},
        "ackDeadlineSeconds": 10,
        "state": "ACTIVE",
    }
    if endpoint:
        described["pushConfig"] = {
            "pushEndpoint": endpoint,
            "oidcToken": {"serviceAccountEmail": account("pubsub-push")},
        }
    described.update(stated)
    return described


def bucket(name, location=REGION, kind="region", labels=None):
    """A bucket as the JSON API gives it, which is what `--raw` prints."""
    described = {
        "name": name,
        "id": name,
        "location": location.upper(),
        "locationType": kind,
        "storageClass": "STANDARD",
        "projectNumber": NUMBER,
        "selfLink": f"https://www.googleapis.com/storage/v1/b/{name}",
    }
    if labels:
        described["labels"] = dict(labels)
    return described


# What the project answers, by the read.
SHOP = {
    gcp.FIREWALL_RULES: [
        firewall(
            "allow-web-to-search",
            tcp(9200),
            sourceTags=["web", NODE_TAG],
            targetTags=["search"],
        ),
        # A rule by address range says nothing between two resources.
        firewall(
            "allow-health-checks",
            tcp(80),
            sourceRanges=["130.211.0.0/22", "35.191.0.0/16"],
            targetTags=["web"],
        ),
        firewall("allow-ssh", tcp(22), sourceRanges=["0.0.0.0/0"], targetTags=["bastion"]),
    ],
    gcp.CLUSTERS: [
        {
            "name": "platform",
            "location": REGION,
            "network": "shop",
            "subnetwork": "shop",
            "status": "RUNNING",
            "resourceLabels": {"env": "prod"},
            "nodePools": [
                {
                    "name": "default-pool",
                    "instanceGroupUrls": [zonal(f"instanceGroupManagers/{NODE_GROUP}")],
                }
            ],
            "endpoint": "203.0.113.30",
            "selfLink": f"https://container.googleapis.com/v1/projects/{PROJECT}"
            f"/locations/{REGION}/clusters/platform",
        }
    ],
    gcp.INSTANCE_GROUPS: [
        managed_group("legacy-web", 2),
        # A cluster's node pool is a managed group too, and is the cluster.
        managed_group(NODE_GROUP, 3),
    ],
    gcp.INSTANCES: [
        instance(
            "legacy-web-x7k2",
            ["web"],
            group=f"zones/{ZONE}/instanceGroupManagers/legacy-web",
            labels={"env": "prod", "app": "shop"},
            runs_as="legacy-web",
        ),
        instance(
            "legacy-web-p0q9",
            ["web"],
            group=f"zones/{ZONE}/instanceGroupManagers/legacy-web",
            labels={"env": "prod", "canary": "yes"},
            runs_as="legacy-web",
        ),
        instance(
            f"{NODE_GROUP[:-4]}-m3n4",
            [NODE_TAG],
            group=f"zones/{ZONE}/instanceGroupManagers/{NODE_GROUP}",
            labels={"goog-gke-node": ""},
        ),
        instance("search", ["search"], labels={"env": "prod"}),
        instance("bastion", ["bastion"], address="203.0.113.20"),
        instance("old-batch", ["web"], status="TERMINATED"),
    ],
    gcp.FUNCTIONS: [
        function(
            "fulfil",
            labels={"env": "prod", "app": "shop"},
            eventTrigger={
                "trigger": path(f"locations/{REGION}/triggers/fulfil-482913"),
                "triggerRegion": REGION,
                "eventType": "google.cloud.pubsub.topic.v1.messagePublished",
                "pubsubTopic": path("topics/order-placed"),
                "serviceAccountEmail": account("fulfil"),
                "retryPolicy": "RETRY_POLICY_RETRY",
            },
        )
    ],
    gcp.SERVICES: [
        run_service(
            "storefront",
            "internal-and-cloud-load-balancing",
            labels={"env": "prod", "app": "shop"},
        ),
        run_service(
            "checkout",
            "internal-and-cloud-load-balancing",
            labels={"env": "prod", "app": "shop"},
            sql=[f"{PROJECT}:{REGION}:orders-db"],
        ),
        run_service("notify", "internal"),
        run_service(
            "partners-api",
            "all",
            labels={"env": "prod"},
            # Two instances, and one of another project's that is not listed here.
            sql=[f"{PROJECT}:{REGION}:orders-db", f"acme-data-lake:{REGION}:warehouse"],
        ),
        # The service a second-generation function runs as is the function.
        run_service("fulfil", "internal", labels={"goog-managed-by": "cloudfunctions"}),
    ],
    gcp.TOPICS: [
        {"name": path("topics/order-placed"), "labels": {"env": "prod"}},
        {"name": path("topics/order-placed-dead")},
    ],
    gcp.SUBSCRIPTIONS: [
        subscription(
            "notify-push",
            "order-placed",
            f"{address_of('notify')}/events",
            deadLetterPolicy={
                "deadLetterTopic": path("topics/order-placed-dead"),
                "maxDeliveryAttempts": 5,
            },
        ),
        # Pulled from: nothing says by whom.
        subscription("order-audit", "order-placed"),
        # The subscription a function's trigger keeps says what the trigger said.
        subscription(
            f"eventarc-{REGION}-fulfil-482913-sub-771",
            "order-placed",
            f"{address_of('fulfil')}/?__GCP_CloudEventsMode=CUSTOM_PUBSUB_projects",
        ),
        subscription("partner-hook", "order-placed", "https://hooks.example.org/orders"),
    ],
    gcp.SQL: [
        {
            "name": "orders-db",
            "project": PROJECT,
            "region": REGION,
            "connectionName": f"{PROJECT}:{REGION}:orders-db",
            "instanceType": "CLOUD_SQL_INSTANCE",
            "databaseVersion": "POSTGRES_16",
            "state": "RUNNABLE",
            "gceZone": ZONE,
            "ipAddresses": [{"type": "PRIVATE", "ipAddress": "10.20.0.3"}],
            "settings": {
                "userLabels": {"env": "prod"},
                "ipConfiguration": {
                    "ipv4Enabled": False,
                    "privateNetwork": path("global/networks/shop"),
                },
            },
            "selfLink": f"https://sqladmin.googleapis.com/sql/v1beta4/projects/{PROJECT}"
            "/instances/orders-db",
        }
    ],
    gcp.REDIS: lambda flags: [
        {
            "name": path(f"locations/{REGION}/instances/cart-cache"),
            "tier": "STANDARD_HA",
            "memorySizeGb": 5,
            "replicaCount": 1,
            "locationId": ZONE,
            "authorizedNetwork": path("global/networks/shop"),
            "host": "10.30.0.4",
            "port": 6379,
            "state": "READY",
            "labels": {"env": "prod"},
        }
    ]
    if flags == ("--region", REGION)
    else [],
    gcp.FIRESTORE: [
        {
            "name": path("databases/sessions"),
            "uid": "5f0b2a1c-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
            "locationId": REGION,
            "type": "FIRESTORE_NATIVE",
            "concurrencyMode": "PESSIMISTIC",
        }
    ],
    gcp.BUCKETS: [bucket("shop-assets", labels={"env": "prod"})],
    gcp.FORWARDING_RULES: [
        forwarding_rule(
            "shop-https",
            "EXTERNAL_MANAGED",
            portRange="443-443",
            target=link("global/targetHttpsProxies/shop-https"),
            labels={"env": "prod"},
        ),
        forwarding_rule(
            "shop-http",
            "EXTERNAL_MANAGED",
            portRange="80-80",
            target=link("global/targetHttpProxies/shop-http"),
        ),
        forwarding_rule(
            "backoffice",
            "INTERNAL_MANAGED",
            region=REGION,
            portRange="80-80",
            target=regional("targetHttpProxies/backoffice"),
            network=NETWORK,
        ),
    ],
    gcp.HTTPS_PROXIES: [
        {
            "name": "shop-https",
            "urlMap": link("global/urlMaps/shop-lb"),
            "sslCertificates": [link("global/sslCertificates/shop")],
            "selfLink": link("global/targetHttpsProxies/shop-https"),
        }
    ],
    gcp.HTTP_PROXIES: [
        {
            "name": "shop-http",
            "urlMap": link("global/urlMaps/shop-redirect"),
            "selfLink": link("global/targetHttpProxies/shop-http"),
        },
        {
            "name": "backoffice",
            "region": link(f"regions/{REGION}"),
            "urlMap": regional("urlMaps/backoffice"),
            "selfLink": regional("targetHttpProxies/backoffice"),
        },
    ],
    gcp.URL_MAPS: [
        {
            "name": "shop-lb",
            "defaultService": link("global/backendServices/storefront"),
            "hostRules": [{"hosts": ["shop.example"], "pathMatcher": "shop"}],
            "pathMatchers": [
                {
                    "name": "shop",
                    "defaultService": link("global/backendServices/storefront"),
                    "pathRules": [
                        {
                            "paths": ["/checkout", "/checkout/*"],
                            "service": link("global/backendServices/checkout"),
                        },
                        {
                            "paths": ["/legacy/*"],
                            "service": link("global/backendServices/legacy-web"),
                        },
                        {
                            "paths": ["/static/*"],
                            "service": link("global/backendBuckets/static-assets"),
                        },
                    ],
                }
            ],
            "selfLink": link("global/urlMaps/shop-lb"),
        },
        # The same balancer on port 80: it answers with a redirect and sends nothing on.
        {
            "name": "shop-redirect",
            "defaultUrlRedirect": {"httpsRedirect": True},
            "selfLink": link("global/urlMaps/shop-redirect"),
        },
        {
            "name": "backoffice",
            "region": link(f"regions/{REGION}"),
            "defaultService": regional("backendServices/backoffice"),
            "selfLink": regional("urlMaps/backoffice"),
        },
    ],
    gcp.BACKEND_SERVICES: [
        backend_service("storefront", regional("networkEndpointGroups/storefront")),
        backend_service("checkout", regional("networkEndpointGroups/checkout")),
        backend_service("legacy-web", zonal("instanceGroups/legacy-web")),
        backend_service(
            "backoffice",
            zonal("instanceGroups/legacy-web"),
            scheme="INTERNAL_MANAGED",
            region=REGION,
        ),
    ],
    gcp.BACKEND_BUCKETS: [
        {
            "name": "static-assets",
            "bucketName": "shop-assets",
            "enableCdn": True,
            "selfLink": link("global/backendBuckets/static-assets"),
        }
    ],
    gcp.ENDPOINT_GROUPS: [
        serverless_group("storefront", cloudRun={"service": "storefront"}),
        serverless_group("checkout", cloudRun={"service": "checkout"}),
    ],
}


class FakeGcloud:
    """Answers as the project above would, and remembers what it was asked."""

    def __init__(self, answers=None, refusing=()):
        self.answers = dict(SHOP if answers is None else answers)
        self.refusing = set(refusing)
        self.calls = []

    def __call__(self, read, *flags):
        self.calls.append((read, flags))
        if read in self.refusing:
            raise core.CliError(
                f"gcloud {' '.join(read)}",
                "PERMISSION_DENIED",
                f"ana@example.com does not have permission to access projects instance [{PROJECT}]",
            )
        # gcloud prints a list for each read, an empty one where there is nothing.
        answer = self.answers.get(read, [])
        return answer(flags) if callable(answer) else answer


def arguments(**overrides):
    values = {"project": PROJECT, "regions": [REGION], "configuration": None}
    values.update(overrides)
    return Namespace(**values)


def collected(fake=None, regions=(REGION,), **options):
    fake = fake or FakeGcloud()
    inventory = core.Inventory("gcp", "shop-gcp", **options)
    with contextlib.redirect_stderr(io.StringIO()):
        gcp.collect(inventory, fake, arguments(regions=list(regions)))
    return inventory.document(WHEN), fake


def by_id(document):
    return {resource["id"]: resource for resource in document["resources"]}


def stated(document, basis):
    return sorted(
        (relation["from"], relation["to"])
        for relation in document["relations"]
        if relation["basis"] == basis
    )


def evidence(document, basis):
    return {
        (relation["from"], relation["to"]): relation["evidence"]
        for relation in document["relations"]
        if relation["basis"] == basis
    }


class CollectTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document, cls.fake = collected()
        cls.resources = by_id(cls.document)

    def test_each_resource_is_listed_once_as_the_kind_its_type_is(self):
        self.assertEqual(
            {name: one["type"] for name, one in self.resources.items()},
            {
                "platform": "kubernetes-cluster",
                "legacy-web": "virtual-machine",
                "search": "virtual-machine",
                "bastion": "virtual-machine",
                "fulfil": "serverless",
                "storefront": "serverless",
                "checkout": "serverless",
                "notify": "serverless",
                "partners-api": "serverless",
                "order-placed": "event-stream",
                "order-placed-dead": "event-stream",
                "orders-db": "database",
                "cart-cache": "cache",
                "sessions": "database",
                "shop-assets": "storage",
                "shop-lb": "load-balancer",
                "backoffice": "load-balancer",
            },
        )
        self.assertEqual(
            {name: self.resources[name]["native"] for name in ("fulfil", "storefront", "shop-lb")},
            {
                # The service the function runs as is not listed beside it.
                "fulfil": "cloudfunctions.googleapis.com/Function",
                "storefront": "run.googleapis.com/Service",
                # A load balancer is the URL map its forwarding rules lead to;
                # one that only redirects is not a piece.
                "shop-lb": "compute.googleapis.com/UrlMap",
            },
        )
        self.assertEqual(self.resources["orders-db"]["native"], "sqladmin.googleapis.com/Instance")
        self.assertEqual(self.resources["cart-cache"]["native"], "redis.googleapis.com/Instance")
        self.assertEqual(self.resources["sessions"]["native"], "firestore.googleapis.com/Database")

    def test_a_group_of_instances_is_one_piece_that_says_how_many(self):
        # The two instances of the group are not listed beside it, nor the
        # node of the cluster beside the cluster; a terminated one is not
        # listed at all, and one on its own is.
        self.assertEqual(self.resources["legacy-web"]["members"], 2)
        self.assertEqual(
            self.resources["legacy-web"]["native"], "compute.googleapis.com/InstanceGroupManager"
        )
        self.assertNotIn("old-batch", self.resources)
        self.assertEqual(self.resources["search"]["native"], "compute.googleapis.com/Instance")
        self.assertEqual(self.resources["platform"]["native"], "container.googleapis.com/Cluster")
        self.assertNotIn("members", self.resources["platform"])
        self.assertFalse([name for name in self.resources if name.startswith("gke-")])
        # A primary and its replica.
        self.assertEqual(self.resources["cart-cache"]["members"], 2)

    def test_where_each_stands_is_what_the_project_says(self):
        # A zonal resource's region is its zone's.
        for name in ("legacy-web", "search", "platform", "storefront", "fulfil", "orders-db"):
            self.assertEqual(self.resources[name]["region"], REGION, name)
        self.assertEqual(self.resources["shop-assets"]["region"], REGION)
        self.assertEqual(self.resources["backoffice"]["region"], REGION)
        # What is in no region: a global balancer, and every topic.
        for name in ("shop-lb", "order-placed", "order-placed-dead"):
            self.assertEqual(self.resources[name]["region"], "global", name)
        # A network is called by its name.
        for name in ("legacy-web", "search", "bastion", "platform", "orders-db", "cart-cache"):
            self.assertEqual(self.resources[name].get("network"), "shop", name)
        self.assertEqual(self.resources["backoffice"].get("network"), "shop")
        for name in ("shop-lb", "storefront", "fulfil", "order-placed", "shop-assets", "sessions"):
            self.assertNotIn("network", self.resources[name], name)

    def test_public_is_what_the_provider_states_as_reachable_from_outside(self):
        public = sorted(name for name, one in self.resources.items() if one.get("public"))
        self.assertEqual(
            public,
            # A balancer by its forwarding rule's scheme and a service by its
            # ingress setting. Not the internal balancer, nor the services
            # only a balancer reaches; and not the bastion: it has an address
            # of its own, but the rule that admits anyone to it is for port
            # 22, and that is not where clients enter.
            ["partners-api", "shop-lb"],
        )

    def test_labels_come_with_each_resource_as_its_tags(self):
        self.assertEqual(self.resources["storefront"]["tags"], {"env": "prod", "app": "shop"})
        self.assertEqual(self.resources["fulfil"]["tags"], {"env": "prod", "app": "shop"})
        self.assertEqual(self.resources["orders-db"]["tags"], {"env": "prod"})
        self.assertEqual(self.resources["platform"]["tags"], {"env": "prod"})
        self.assertEqual(self.resources["shop-assets"]["tags"], {"env": "prod"})
        # A group has no labels of its own: it carries those all its instances do.
        self.assertEqual(self.resources["legacy-web"]["tags"], {"env": "prod"})
        # Nor has a URL map: a balancer carries those of its forwarding rules.
        self.assertEqual(self.resources["shop-lb"]["tags"], {"env": "prod"})
        # Where a service stands is its region, not a label of its own.
        self.assertNotIn("tags", self.resources["notify"])
        self.assertNotIn("tags", self.resources["bastion"])

    def test_routing_is_what_a_balancer_sends_on_through_its_backend_services(self):
        self.assertEqual(
            stated(self.document, "routing"),
            [
                ("backoffice", "legacy-web"),
                ("shop-lb", "checkout"),
                ("shop-lb", "legacy-web"),
                ("shop-lb", "shop-assets"),
                ("shop-lb", "storefront"),
            ],
        )
        said = evidence(self.document, "routing")
        self.assertEqual(said["shop-lb", "storefront"], "backend service storefront")
        self.assertEqual(said["shop-lb", "legacy-web"], "backend service legacy-web")
        self.assertEqual(said["backoffice", "legacy-web"], "backend service backoffice")
        self.assertEqual(said["shop-lb", "shop-assets"], "backend bucket static-assets")

    def test_events_are_what_a_topic_delivers(self):
        self.assertEqual(
            stated(self.document, "event"),
            # A subscription that is pulled from names no one, and one that
            # pushes to an address of the operator's own is not followed.
            [("order-placed", "fulfil"), ("order-placed", "notify")],
        )
        said = evidence(self.document, "event")
        self.assertEqual(said["order-placed", "notify"], "push subscription notify-push")
        self.assertEqual(said["order-placed", "fulfil"], "event trigger")

    def test_what_a_resource_names_in_its_own_configuration_is_declared(self):
        self.assertEqual(
            stated(self.document, "declared"),
            [
                ("checkout", "orders-db"),
                ("order-placed", "order-placed-dead"),
                ("partners-api", "orders-db"),
            ],
        )
        said = evidence(self.document, "declared")
        self.assertEqual(
            said["checkout", "orders-db"], "annotation run.googleapis.com/cloudsql-instances"
        )
        self.assertEqual(
            said["order-placed", "order-placed-dead"],
            "dead letter policy of subscription notify-push",
        )

    def test_a_rule_between_two_tags_is_a_permission_between_what_carries_them(self):
        self.assertEqual(
            stated(self.document, "network"),
            # The group by the tag its instances carry, the cluster by its nodes'.
            [("legacy-web", "search"), ("platform", "search")],
        )
        self.assertEqual(
            evidence(self.document, "network")["legacy-web", "search"],
            "firewall rule allow-web-to-search: tag web may reach tag search on tcp/9200",
        )

    def test_nothing_that_names_the_project_is_written(self):
        text = json.dumps(self.document)
        for absent in (
            PROJECT,
            NUMBER,
            "projects/",
            "https://",
            "www.googleapis.com",
            "gserviceaccount",
            "@",
            "run.app",
            "203.0.113.",
            "10.0.",
            "10.20.",
            "acme-data-lake",
        ):
            self.assertNotIn(absent, text)

    def test_it_says_what_it_did_not_read(self):
        self.assertEqual(len(self.document["notes"]), 1)
        self.assertIn("Identity Platform", self.document["notes"][0])
        self.assertIn("--relation", self.document["notes"][0])

    def test_every_call_is_a_read_the_collector_says_it_makes(self):
        asked = {read for read, _ in self.fake.calls}
        self.assertLessEqual(asked, set(gcp.READS))
        # Everything it says it reads, it reads; and each is a list or a describe.
        self.assertEqual(asked, set(gcp.READS))
        self.assertEqual(len(gcp.READS), len(set(gcp.READS)))
        for read in gcp.READS:
            self.assertIn(read[-1], ("list", "describe"), " ".join(read))
        # What grants them only views.
        self.assertEqual(len(gcp.ROLES), len(set(gcp.ROLES)))
        for role in gcp.ROLES:
            self.assertRegex(role, r"^roles/[a-z]+\.[A-Za-z]*[Vv]iewer$", role)
        for permission in gcp.PERMISSIONS:
            self.assertRegex(permission, r"^[a-z]+\.[A-Za-z]+\.(list|get)$", permission)

    def test_each_list_is_asked_once_and_only_redis_region_by_region(self):
        asked = [read for read, _ in self.fake.calls]
        self.assertEqual(len(asked), len(set(asked)))
        flags = {read: given for read, given in self.fake.calls if given}
        self.assertEqual(
            flags,
            {
                gcp.REDIS: ("--region", REGION),
                # One shape for both generations, and the API's own for a bucket.
                gcp.FUNCTIONS: ("--v2",),
                gcp.BUCKETS: ("--raw",),
            },
        )

    def test_the_example_is_what_the_collector_writes_from_these_answers(self):
        if os.environ.get("AEGIS_UPDATE_EXAMPLES"):
            EXAMPLE.parent.mkdir(parents=True, exist_ok=True)
            EXAMPLE.unlink(missing_ok=True)
            core.write(EXAMPLE, self.document)
        self.assertEqual(json.loads(EXAMPLE.read_text("utf-8")), self.document)


class EdgeTest(unittest.TestCase):
    def test_a_refused_list_is_noted_and_the_rest_is_still_read(self):
        document, _ = collected(
            FakeGcloud(refusing=[gcp.TOPICS, gcp.CLUSTERS, gcp.URL_MAPS, gcp.BACKEND_SERVICES])
        )
        resources = by_id(document)
        self.assertNotIn("order-placed", resources)
        self.assertNotIn("platform", resources)
        self.assertNotIn("shop-lb", resources)
        self.assertIn("storefront", resources)
        # With the cluster unread nothing says whose its node pool is, and the
        # group is listed as what the project says it is.
        self.assertEqual(resources[NODE_GROUP]["type"], "virtual-machine")
        self.assertEqual(resources[NODE_GROUP]["members"], 3)
        notes = document["notes"]
        self.assertIn("Topics could not be read (PERMISSION_DENIED).", notes)
        self.assertIn("GKE clusters could not be read (PERMISSION_DENIED).", notes)
        # Two reads of one thing that were refused are one note.
        self.assertEqual(
            [note for note in notes if note.startswith("Load balancers")],
            ["Load balancers could not be read (PERMISSION_DENIED)."],
        )
        text = json.dumps(document)
        self.assertNotIn(PROJECT, text)
        self.assertNotIn("ana@example.com", text)

    def test_with_every_list_refused_nothing_is_written(self):
        fake = FakeGcloud(refusing=gcp.READS)
        inventory = core.Inventory("gcp", "shop-gcp")
        with contextlib.redirect_stderr(io.StringIO()):
            gcp.collect(inventory, fake, arguments())
        with self.assertRaisesRegex(core.CollectError, "PERMISSION_DENIED"):
            inventory.document(WHEN)

    def test_a_forwarding_rule_straight_to_its_backends_is_a_load_balancer(self):
        answers = {
            gcp.FORWARDING_RULES: [
                # Two rules of one balancer: a port each.
                forwarding_rule(
                    "ingest-tcp",
                    "EXTERNAL",
                    region=REGION,
                    ports=["9000"],
                    backendService=regional("backendServices/ingest"),
                    labels={"env": "prod"},
                ),
                forwarding_rule(
                    "ingest-udp",
                    "EXTERNAL",
                    region=REGION,
                    IPProtocol="UDP",
                    ports=["9000"],
                    backendService=regional("backendServices/ingest"),
                ),
                forwarding_rule(
                    "ledger",
                    "INTERNAL",
                    region=REGION,
                    ports=["5432"],
                    backendService=regional("backendServices/ledger"),
                    network=NETWORK,
                ),
                forwarding_rule(
                    "game", "EXTERNAL", region=REGION, target=regional("targetPools/game-pool")
                ),
                # What leads to nothing this collector lists is not a piece.
                forwarding_rule(
                    "office", "EXTERNAL", region=REGION, target=regional("targetVpnGateways/office")
                ),
            ],
            gcp.BACKEND_SERVICES: [
                backend_service(
                    "ingest",
                    regional("instanceGroups/ingest-workers"),
                    scheme="EXTERNAL",
                    region=REGION,
                ),
                backend_service(
                    "ledger",
                    zonal("instanceGroups/ledger-nodes"),
                    scheme="INTERNAL",
                    region=REGION,
                ),
            ],
            gcp.INSTANCE_GROUPS: [
                managed_group("ingest-workers", 3, region=REGION),
                managed_group("ledger-nodes", 0),
            ],
            gcp.INSTANCES: [
                # A regional group's instance names it by its region.
                instance(
                    "ingest-workers-q1w2",
                    ["ingest"],
                    group=f"regions/{REGION}/instanceGroupManagers/ingest-workers",
                    zone=f"{REGION}-c",
                ),
            ],
        }
        document, _ = collected(FakeGcloud(answers))
        resources = by_id(document)
        self.assertEqual(
            {name: one["type"] for name, one in resources.items()},
            {
                "ingest": "load-balancer",
                "ledger": "load-balancer",
                "game-pool": "load-balancer",
                "ingest-workers": "virtual-machine",
                "ledger-nodes": "virtual-machine",
            },
        )
        self.assertEqual(resources["ingest"]["native"], "compute.googleapis.com/BackendService")
        self.assertEqual(resources["game-pool"]["native"], "compute.googleapis.com/TargetPool")
        self.assertEqual(
            {name: bool(resources[name].get("public")) for name in ("ingest", "ledger", "game-pool")},
            {"ingest": True, "ledger": False, "game-pool": True},
        )
        self.assertEqual(resources["ingest"]["region"], REGION)
        self.assertEqual(resources["ingest"]["tags"], {"env": "prod"})
        self.assertEqual(resources["ledger"]["network"], "shop")
        self.assertEqual(resources["ingest-workers"]["region"], REGION)
        self.assertEqual(resources["ingest-workers"]["network"], "shop")
        # A group that is to hold none stands for none.
        self.assertNotIn("members", resources["ledger-nodes"])
        self.assertEqual(
            stated(document, "routing"),
            [("ingest", "ingest-workers"), ("ledger", "ledger-nodes")],
        )
        self.assertEqual(
            evidence(document, "routing")["ingest", "ingest-workers"], "backend service ingest"
        )

    def test_an_instance_is_public_with_an_address_and_a_rule_that_admits_anyone_to_it(self):
        lab = link("global/networks/lab")
        dmz = link("global/networks/dmz")
        anyone = {"sourceRanges": ["0.0.0.0/0"]}
        answers = {
            gcp.FIREWALL_RULES: [
                firewall("allow-https", tcp(443), targetTags=["web"], **anyone),
                # With no target, a rule applies to every instance of its network.
                firewall("dmz-open", [{"IPProtocol": "all"}], network=dmz, **anyone),
                firewall("allow-ssh", tcp(22), targetTags=["jump"], **anyone),
                firewall("allow-low-ports", tcp("1-1024"), targetServiceAccounts=[account("edge")], **anyone),
                firewall("allow-dns", [{"IPProtocol": "udp", "ports": ["53"]}], targetTags=["dns"], **anyone),
                firewall(
                    "app-to-db",
                    tcp(5432),
                    sourceServiceAccounts=[account("app")],
                    targetServiceAccounts=[account("db")],
                ),
                # A tag that admits itself says nothing between two pieces.
                firewall("web-to-web", tcp(8080), sourceTags=["web"], targetTags=["web"]),
                # Switched off, outbound, or a denial: none is a permission to reach.
                firewall("off", tcp(6379), sourceTags=["web"], targetTags=["cache"], disabled=True),
                firewall("out", tcp(6379), sourceTags=["web"], targetTags=["cache"], direction="EGRESS"),
                dict(
                    firewall("no", [], sourceTags=["web"], targetTags=["cache"]),
                    denied=tcp(6379),
                ),
                # Several protocols in one rule.
                firewall(
                    "web-to-cache",
                    [{"IPProtocol": "tcp", "ports": ["6379", "16379-16384"]}, {"IPProtocol": "icmp"}],
                    sourceTags=["batch"],
                    targetTags=["cache"],
                ),
            ],
            gcp.INSTANCES: [
                instance("web", ["web"], address="203.0.113.1", runs_as="app"),
                instance("open", address="203.0.113.2", network=dmz),
                instance("jump", ["jump"], address="203.0.113.3"),
                instance("edge", address="203.0.113.4", runs_as="edge"),
                instance("resolver", ["dns"], address="203.0.113.5"),
                # Admitted, but with no address to be reached at.
                instance("inner", ["web"], runs_as="app"),
                # The same tag in another network is another network's.
                instance("stranger", ["web"], address="203.0.113.6", network=lab),
                instance("db", runs_as="db"),
                instance("cache", ["cache"]),
                instance("batch", ["batch"]),
            ],
        }
        document, _ = collected(FakeGcloud(answers))
        resources = by_id(document)
        self.assertEqual(
            sorted(name for name, one in resources.items() if one.get("public")),
            ["edge", "open", "web"],
        )
        self.assertEqual(
            stated(document, "network"),
            [("batch", "cache"), ("inner", "db"), ("web", "db")],
        )
        said = evidence(document, "network")
        # An account's address names the project: the rule is said without it.
        self.assertEqual(
            said["web", "db"],
            "firewall rule app-to-db: one service account may reach another on tcp/5432",
        )
        self.assertEqual(
            said["batch", "cache"],
            "firewall rule web-to-cache: tag batch may reach tag cache on tcp/6379,16379-16384, icmp",
        )
        text = json.dumps(document)
        self.assertNotIn("gserviceaccount", text)
        self.assertNotIn(PROJECT, text)

    def test_other_kinds_of_resource_are_read_where_the_project_has_them(self):
        answers = {
            gcp.SPANNER: [
                {
                    "name": path("instances/ledger"),
                    "config": path(f"instanceConfigs/regional-{REGION}"),
                    "displayName": "Ledger",
                    "nodeCount": 1,
                    "state": "READY",
                    "labels": {"env": "prod"},
                },
                {
                    "name": path("instances/catalog"),
                    "config": path("instanceConfigs/nam3"),
                    "displayName": "Catalog",
                    "processingUnits": 1000,
                    "state": "READY",
                },
            ],
            # The (default) database, in a location of several regions.
            gcp.FIRESTORE: [
                {
                    "name": path("databases/(default)"),
                    "locationId": "nam5",
                    "type": "FIRESTORE_NATIVE",
                }
            ],
            gcp.BUCKETS: [bucket("uploads"), bucket("archive", "US", "multi-region")],
            gcp.SQL: [
                {
                    "name": "reports-replica",
                    "region": REGION,
                    "connectionName": f"{PROJECT}:{REGION}:reports-replica",
                    "instanceType": "READ_REPLICA_INSTANCE",
                    "masterInstanceName": f"{PROJECT}:reports",
                    "settings": {"ipConfiguration": {"ipv4Enabled": True}},
                },
                # Where a replica copies from, outside Cloud SQL: not the project's.
                {
                    "name": "datacenter-primary",
                    "region": REGION,
                    "instanceType": "ON_PREMISES_INSTANCE",
                },
            ],
            gcp.CLUSTERS: [
                {"name": "batch", "location": f"{REGION}-b", "network": "shop", "nodePools": []}
            ],
            gcp.FUNCTIONS: [
                function(
                    "thumbnails",
                    eventTrigger={
                        "eventType": "google.cloud.storage.object.v1.finalized",
                        "eventFilters": [{"attribute": "bucket", "value": "uploads"}],
                    },
                ),
                # Called by its address, and admitting all traffic to it.
                function("webhook", ingress="ALLOW_ALL"),
                function("inner-hook"),
                function("nightly", generation="GEN_1", ingress="ALLOW_ALL"),
            ],
            gcp.SERVICES: [run_service("webhook", "all"), run_service("thumbnails", "internal")],
            gcp.TOPICS: [{"name": path("topics/hooks")}],
            gcp.SUBSCRIPTIONS: [
                subscription("hooks-push", "hooks", f"{address_of('webhook')}/"),
                # A topic of another project's is not one of these.
                subscription("mirror", "hooks", f"{address_of('webhook')}/")
                | {"topic": "projects/acme-data-lake/topics/hooks"},
            ],
            gcp.FORWARDING_RULES: [
                forwarding_rule(
                    "api", "EXTERNAL_MANAGED", target=link("global/targetHttpsProxies/api")
                ),
                forwarding_rule(
                    "api-v6", "EXTERNAL_MANAGED", target=link("global/targetHttpsProxies/api")
                ),
            ],
            gcp.HTTPS_PROXIES: [{"name": "api", "urlMap": link("global/urlMaps/api")}],
            gcp.URL_MAPS: [
                {
                    "name": "api",
                    "defaultRouteAction": {
                        "weightedBackendServices": [
                            {"backendService": link("global/backendServices/api"), "weight": 90},
                            {"backendService": link("global/backendServices/canary"), "weight": 10},
                        ]
                    },
                    "pathMatchers": [
                        {
                            "name": "paths",
                            "defaultService": link("global/backendServices/api"),
                            "routeRules": [
                                {
                                    "priority": 1,
                                    "service": link("global/backendServices/thumbs"),
                                },
                                {
                                    "priority": 2,
                                    "routeAction": {
                                        "weightedBackendServices": [
                                            {
                                                "backendService": link(
                                                    "global/backendServices/anything"
                                                ),
                                                "weight": 100,
                                            }
                                        ]
                                    },
                                },
                            ],
                        }
                    ],
                },
                # A map no forwarding rule leads to is a balancer nobody reaches.
                {"name": "unused", "defaultService": link("global/backendServices/api")},
            ],
            gcp.BACKEND_SERVICES: [
                backend_service("api", regional("networkEndpointGroups/by-function")),
                # The service a function runs as is the function, whoever names it.
                backend_service("canary", regional("networkEndpointGroups/by-service")),
                backend_service("thumbs", regional("networkEndpointGroups/thumbs")),
                backend_service("anything", regional("networkEndpointGroups/by-mask")),
            ],
            gcp.ENDPOINT_GROUPS: [
                serverless_group("by-function", cloudFunction={"function": "webhook"}),
                serverless_group("by-service", cloudRun={"service": "webhook"}),
                serverless_group("thumbs", cloudRun={"service": "thumbnails"}),
                # A group that reads the name from the request names no one.
                serverless_group("by-mask", cloudRun={"urlMask": "<service>.shop.example"}),
            ],
        }
        # With no region asked for, so that what is in none of them is kept.
        document, _ = collected(FakeGcloud(answers), regions=())
        resources = by_id(document)
        self.assertEqual(
            {name: (one["type"], one["region"]) for name, one in resources.items()},
            {
                "batch": ("kubernetes-cluster", REGION),
                "thumbnails": ("serverless", REGION),
                "webhook": ("serverless", REGION),
                "inner-hook": ("serverless", REGION),
                "nightly": ("serverless", REGION),
                "hooks": ("event-stream", "global"),
                "reports-replica": ("database", REGION),
                "ledger": ("database", REGION),
                # A location that is not one region is called what the provider calls it.
                "catalog": ("database", "nam3"),
                "default": ("database", "nam5"),
                "uploads": ("storage", REGION),
                "archive": ("storage", "us"),
                "api": ("load-balancer", "global"),
                "unused": ("load-balancer", "global"),
            },
        )
        self.assertEqual(resources["default"]["name"], "(default)")
        self.assertEqual(
            resources["nightly"]["native"], "cloudfunctions.googleapis.com/CloudFunction"
        )
        self.assertEqual(resources["webhook"]["native"], "cloudfunctions.googleapis.com/Function")
        self.assertNotIn("network", resources["reports-replica"])
        # A function is public where it is called by its address and admits
        # all traffic; one an event calls is not where clients enter.
        self.assertEqual(
            sorted(name for name, one in resources.items() if one.get("public")),
            ["api", "nightly", "webhook"],
        )
        self.assertEqual(
            stated(document, "routing"),
            # Two backend services that reach one function are one connection.
            [("api", "thumbnails"), ("api", "webhook"), ("unused", "webhook")],
        )
        self.assertEqual(
            stated(document, "event"), [("hooks", "webhook"), ("uploads", "thumbnails")]
        )
        self.assertEqual(evidence(document, "event")["uploads", "thumbnails"], "event trigger")

    def test_only_the_regions_asked_for_are_kept_and_what_is_in_none(self):
        answers = {
            gcp.SERVICES: [
                run_service("here", "all"),
                run_service("there", "all", region=ELSEWHERE),
            ],
            gcp.INSTANCE_GROUPS: [
                managed_group("workers", 2),
                managed_group("workers", 4, zone=f"{ELSEWHERE}-b"),
            ],
            gcp.INSTANCES: [
                instance("lonely", zone=f"{ELSEWHERE}-f"),
                instance(
                    "workers-a1b2",
                    group=f"zones/{ELSEWHERE}-b/instanceGroupManagers/workers",
                    zone=f"{ELSEWHERE}-b",
                ),
            ],
            gcp.TOPICS: [{"name": path("topics/events")}],
            gcp.BUCKETS: [bucket("near"), bucket("far", "US", "multi-region")],
            gcp.URL_MAPS: [
                {"name": "world", "defaultService": link("global/backendServices/world")},
                {
                    "name": "inland",
                    "region": link(f"regions/{ELSEWHERE}"),
                    "defaultService": regional("backendServices/inland", ELSEWHERE),
                },
            ],
            gcp.REDIS: lambda flags: [
                {"name": path(f"locations/{flags[1]}/instances/cache"), "tier": "BASIC"}
            ],
        }
        narrowed, fake = collected(FakeGcloud(answers))
        self.assertEqual(
            sorted((one["name"], one["region"]) for one in narrowed["resources"]),
            [
                ("cache", REGION),
                ("events", "global"),
                ("here", REGION),
                ("near", REGION),
                ("workers", REGION),
                ("world", "global"),
            ],
        )
        self.assertNotIn("members", by_id(narrowed)["cache"])

        # Without a region everything is kept, wherever it is. Redis alone is
        # listed region by region, so it is not read, and the file says so.
        whole, fake = collected(FakeGcloud(answers), regions=())
        self.assertEqual(
            sorted((one["id"], one["region"]) for one in whole["resources"]),
            [
                ("events", "global"),
                ("far", "us"),
                ("here", REGION),
                ("inland", ELSEWHERE),
                ("lonely", ELSEWHERE),
                ("near", REGION),
                ("there", ELSEWHERE),
                # Two groups of one name are told apart by where they are.
                ("workers", REGION),
                (f"workers-{ELSEWHERE}", ELSEWHERE),
                ("world", "global"),
            ],
        )
        self.assertNotIn(gcp.REDIS, [read for read, _ in fake.calls])
        self.assertTrue([note for note in whole["notes"] if "Redis" in note and "--region" in note])
        self.assertFalse([note for note in narrowed["notes"] if "Redis" in note])

        both, fake = collected(FakeGcloud(answers), regions=(REGION, ELSEWHERE))
        self.assertEqual(
            [given for read, given in fake.calls if read == gcp.REDIS],
            [("--region", REGION), ("--region", ELSEWHERE)],
        )
        self.assertEqual(
            sorted(one["region"] for one in both["resources"] if one["name"] == "cache"),
            [REGION, ELSEWHERE],
        )

    def test_firestore_is_read_whether_gcloud_prints_the_list_or_the_answer_around_it(self):
        database = {"name": path("databases/carts"), "locationId": REGION, "type": "DATASTORE_MODE"}
        for answer in ([database], {"databases": [database]}):
            document, _ = collected(FakeGcloud({gcp.FIRESTORE: answer}))
            self.assertEqual(
                [(one["name"], one["type"]) for one in document["resources"]],
                [("carts", "database")],
            )


class MainTest(unittest.TestCase):
    """The script as the operator runs it, with the CLI replaced."""

    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location(
            "export_cloud_inventory", HERE / "export-cloud-inventory.py"
        )
        cls.script = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.script)

    def run_main(self, *arguments, fake=None):
        fake = fake or FakeGcloud()
        shown, said = io.StringIO(), io.StringIO()
        with (
            mock.patch.object(self.script, "COLLECTORS", (gcp,)),
            mock.patch.object(gcp, "client", return_value=fake),
            contextlib.redirect_stdout(shown),
            contextlib.redirect_stderr(said),
        ):
            try:
                self.script.main(list(arguments))
                code = 0
            except SystemExit as exit_:
                code = exit_.code
        return code, shown.getvalue(), said.getvalue(), fake

    def test_the_inventory_is_written_and_the_operator_is_told_what_is_in_it(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "inventory.json"
            code, shown, _, fake = self.run_main(
                "gcp",
                "--project",
                PROJECT,
                "--region",
                REGION,
                "--name",
                "shop-gcp",
                "--tag",
                "env=prod",
                "--tag-key",
                "env",
                "--type",
                "legacy-web=container",
                "--relation",
                "checkout=order-placed",
                "--output",
                str(output),
            )
            self.assertEqual(code, 0, shown)
            document = json.loads(output.read_text("utf-8"))
        resources = by_id(document)
        self.assertEqual(document["provider"], "gcp")
        self.assertEqual(document["name"], "shop-gcp")
        self.assertRegex(document["collectedAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertNotIn("notify", resources, "it carries no label")
        self.assertEqual(resources["legacy-web"]["type"], "container")
        self.assertEqual(resources["storefront"]["tags"], {"env": "prod"})
        self.assertIn(("checkout", "order-placed"), stated(document, "declared"))
        self.assertIn(f"{len(document['resources'])} resources", shown)
        self.assertIn(f"{len(document['relations'])} relations", shown)
        self.assertNotIn(PROJECT, json.dumps(document))
        self.assertEqual({read for read, _ in fake.calls}, set(gcp.READS))

    def test_without_a_name_the_platform_is_called_after_what_was_read_never_the_project(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "inventory.json"
            code, _, _, fake = self.run_main(
                "gcp",
                "--project",
                PROJECT,
                "--region",
                REGION,
                "--region",
                ELSEWHERE,
                "--output",
                str(output),
            )
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(output.read_text("utf-8"))["name"], f"gcp-{REGION}")
            self.assertEqual(
                [given for read, given in fake.calls if read == gcp.REDIS],
                [("--region", REGION), ("--region", ELSEWHERE)],
            )

            everywhere = Path(directory) / "everywhere.json"
            code, _, said, _ = self.run_main("gcp", "--project", PROJECT, "--output", str(everywhere))
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(everywhere.read_text("utf-8"))["name"], "gcp")
            # What was not read is said on the way out too.
            self.assertIn("Redis", said)

    def test_a_file_that_exists_is_left_alone_and_nothing_is_asked(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "inventory.json"
            output.write_text("mine", encoding="utf-8")
            code, _, said, fake = self.run_main(
                "gcp", "--project", PROJECT, "--output", str(output)
            )
            self.assertEqual(code, 1)
            self.assertIn("Inventory failed: Output already exists", said)
            self.assertEqual(output.read_text("utf-8"), "mine")
        self.assertEqual(fake.calls, [])

    def test_a_declaration_that_names_nothing_stops_before_the_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "inventory.json"
            code, _, said, _ = self.run_main(
                "gcp", "--project", PROJECT, "--type", "nobody=database", "--output", str(output)
            )
            self.assertEqual(code, 1)
            self.assertIn("nobody", said)
            self.assertFalse(output.exists())

    def test_what_is_not_a_project_a_region_or_a_configuration_is_refused_before_any_call(self):
        for bad in (
            ["gcp", "--project", PROJECT, "--region", "São Paulo", "--output", "x.json"],
            ["gcp", "--project", "--impersonate-service-account=x", "--output", "x.json"],
            ["gcp", "--project=--impersonate-service-account=x", "--output", "x.json"],
            ["gcp", "--project", PROJECT, "--configuration=--account=x", "--output", "x.json"],
            ["gcp", "--output", "x.json"],
            ["gcp", "--project", PROJECT, "--type", "db=warehouse", "--output", "x.json"],
        ):
            code, _, _, fake = self.run_main(*bad)
            self.assertEqual(code, 2, bad)
            self.assertEqual(fake.calls, [])


def refusal(*lines):
    return "\n".join(lines)


# What gcloud prints when it refuses, and the short name each is noted by.
REFUSED = (
    # An API that answers with a status, and the reason in the details under it.
    (
        "SERVICE_DISABLED",
        gcp.SERVICES,
        refusal(
            "ERROR: (gcloud.run.services.list) PERMISSION_DENIED: Cloud Run Admin API has not "
            f"been used in project {NUMBER} before or it is disabled. Enable it by visiting "
            "https://console.developers.google.com/apis/api/run.googleapis.com/overview"
            f"?project={NUMBER} then retry. If you enabled this API recently, wait a few "
            "minutes for the action to propagate to our systems and retry.",
            "- '@type': type.googleapis.com/google.rpc.ErrorInfo",
            "  domain: googleapis.com",
            "  metadata:",
            f"    consumer: projects/{NUMBER}",
            "    service: run.googleapis.com",
            "  reason: SERVICE_DISABLED",
        ),
    ),
    (
        "PERMISSION_DENIED",
        gcp.TOPICS,
        refusal(
            "ERROR: (gcloud.pubsub.topics.list) PERMISSION_DENIED: User not authorized to "
            "perform this action. This command is authenticated as ana@example.com which is "
            "the active account specified by the [core/account] property."
        ),
    ),
    # An API that answers with no status: gcloud names the HTTP one.
    (
        "HTTPError 403",
        gcp.SQL,
        refusal(
            "ERROR: (gcloud.sql.instances.list) HTTPError 403: The client is not authorized "
            "to make this request."
        ),
    ),
    # Compute Engine's lists print what the API said and no status at all.
    (
        "PERMISSION_DENIED",
        gcp.INSTANCES,
        refusal(
            "ERROR: (gcloud.compute.instances.list) Some requests did not succeed:",
            f" - Required 'compute.instances.list' permission for 'projects/{PROJECT}'",
        ),
    ),
    (
        "SERVICE_DISABLED",
        gcp.URL_MAPS,
        refusal(
            "ERROR: (gcloud.compute.url-maps.list) Some requests did not succeed:",
            f" - Compute Engine API has not been used in project {NUMBER} before or it is "
            "disabled. Enable it by visiting https://console.developers.google.com/apis/api/"
            f"compute.googleapis.com/overview?project={NUMBER} then retry.",
        ),
    ),
    (
        "PERMISSION_DENIED",
        gcp.SPANNER,
        refusal(
            "ERROR: (gcloud.spanner.instances.list) [ana@example.com] does not have "
            f"permission to access projects instance [{PROJECT}] (or it may not exist): "
            "Caller is missing IAM permission spanner.instances.list on resource."
        ),
    ),
    # Nobody is signed in, or the sign-in has run out.
    (
        "UNAUTHENTICATED",
        gcp.BUCKETS,
        refusal(
            "ERROR: (gcloud.storage.buckets.list) You do not currently have an active account "
            "selected.",
            "Please run:",
            "",
            "  $ gcloud auth login",
        ),
    ),
    (
        "UNAUTHENTICATED",
        gcp.CLUSTERS,
        refusal(
            "ERROR: (gcloud.container.clusters.list) There was a problem refreshing your "
            "current auth tokens: ('invalid_grant: Bad Request', {'error': 'invalid_grant'})"
        ),
    ),
    ("refused", gcp.FIRESTORE, "ERROR: (gcloud.firestore.databases.list) Something else."),
)


class ClientTest(unittest.TestCase):
    def test_the_cli_is_given_a_list_and_asked_for_json_without_a_question(self):
        ran = []

        def run(command, **options):
            ran.append((command, options))
            return mock.Mock(returncode=0, stdout='[{"name": "search"}]\n', stderr="")

        with mock.patch.object(core.subprocess, "run", side_effect=run):
            call = gcp.client(arguments(configuration="readonly"))
            self.assertEqual(call(gcp.REDIS, "--region", REGION), [{"name": "search"}])
            self.assertEqual(gcp.client(arguments())(gcp.INSTANCES), [{"name": "search"}])
        command, options = ran[0]
        self.assertEqual(command[:4], ["gcloud", "redis", "instances", "list"])
        self.assertEqual(command[command.index("--region") + 1], REGION)
        self.assertEqual(command[command.index("--project") + 1], PROJECT)
        self.assertEqual(command[command.index("--configuration") + 1], "readonly")
        self.assertIn("--format=json", command)
        # Without it gcloud may ask, an offer to enable an API included; with
        # it gcloud takes the answer that changes nothing.
        self.assertIn("--quiet", command)
        self.assertNotIn("shell", options)
        # Whom it reads as is gcloud's to say: no account is named here.
        self.assertEqual(
            ran[1][0],
            ["gcloud", "compute", "instances", "list", "--project", PROJECT, "--format=json", "--quiet"],
        )

    def test_a_list_of_nothing_is_nothing(self):
        for printed in ("[]\n", ""):
            nothing = mock.Mock(returncode=0, stdout=printed, stderr="")
            with mock.patch.object(core.subprocess, "run", return_value=nothing):
                inventory = core.Inventory("gcp", "empty")
                gcp.collect(inventory, gcp.client(arguments()), arguments())
            with self.assertRaisesRegex(core.CollectError, "Nothing was found"):
                inventory.document(WHEN)

    def test_a_refusal_is_named_by_its_status_and_nothing_else_of_what_was_said(self):
        for code, read, said in REFUSED:
            refused = mock.Mock(returncode=1, stdout="", stderr=said + "\n")
            with mock.patch.object(core.subprocess, "run", return_value=refused):
                with self.assertRaises(core.CliError) as raised:
                    gcp.client(arguments())(read)
            self.assertEqual(raised.exception.code, code, said)
            self.assertEqual(raised.exception.command, f"gcloud {' '.join(read)}")
            # The whole of it is still the operator's to read.
            self.assertEqual(raised.exception.said, said)

    def test_no_answer_in_time_is_not_taken_for_a_refusal_of_another_kind(self):
        late = core.subprocess.TimeoutExpired(["gcloud"], 300)
        with mock.patch.object(core.subprocess, "run", side_effect=late):
            with self.assertRaises(core.CliError) as raised:
                gcp.client(arguments())(gcp.INSTANCES)
        self.assertEqual(raised.exception.code, "Timeout")

    def test_without_the_cli_the_operator_is_told_so(self):
        with mock.patch.object(core.subprocess, "run", side_effect=FileNotFoundError):
            with self.assertRaisesRegex(core.CollectError, "not installed"):
                gcp.client(arguments())(gcp.INSTANCES)


if __name__ == "__main__":
    unittest.main()
