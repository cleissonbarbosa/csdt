"""Offline checks for the Oracle Cloud inventory collector.

The OCI CLI is never run and no tenancy was asked anything: each test hands
the collector a fake `call` that answers in the shapes the OCI CLI prints
(the answer under `data`, the API's field names with dashes, the pages of a
list already joined as `--all` joins them, and nothing at all where a list
is empty). The shapes were written from Oracle's references (the OCI CLI
command reference for each command, and the API's models and responses as
the SDK references document them), not recorded from a tenancy.

`examples/cloud-inventory/topologies/oci-shop.json` is what the collector writes from
the answers below. To write it again after changing either:

    AEGIS_UPDATE_EXAMPLES=1 python3 -B -m unittest discover -s scripts -p 'test_cloud_inventory_oci.py'
"""

import contextlib
import importlib.util
import io
import json
import os
import re
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest import mock

from cloud_inventory import core, oci

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
EXAMPLE = ROOT / "examples" / "cloud-inventory" / "topologies" / "oci-shop.json"
WHEN = "2026-11-21T12:00:00Z"

REGION = "sa-saopaulo-1"
COMPARTMENT = "ocid1.compartment.oc1..aaaaaaaashop"
NETWORK = "ocid1.compartment.oc1..aaaaaaaanetwork"
# What names the tenancy besides an OCID, and is never written: its Object
# Storage namespace, who made a resource, and its own name for a data centre.
NAMESPACE = "axshopnamespace"
CREATOR = "oracleidentitycloudservice/ana@example.com"
DOMAIN = "Uocm:SA-SAOPAULO-1-AD-1"


def ocid(kind, name):
    return f"ocid1.{kind}.oc1.{REGION}.aaaaaaaa{name}"


def group(name):
    return ocid("networksecuritygroup", name)


VCN = ocid("vcn", "shop")
EDGE, APP, DATA = (ocid("subnet", name) for name in ("edge", "app", "data"))
POOL = ocid("instancepool", "storefront")
CLUSTER = ocid("cluster", "platform")
BALANCER = ocid("loadbalancer", "shop")
INTERNAL = ocid("loadbalancer", "internal")
APPLICATION = ocid("fnapp", "shop")
FUNCTION = ocid("fnfunc", "api-handler")
GATEWAY = ocid("apigateway", "partners")
DEPLOYMENT = ocid("apideployment", "partners-v1")

VCN_LIST = ("network", "vcn", "list")
SUBNET_LIST = ("network", "subnet", "list")
GROUP_LIST = ("network", "nsg", "list")
RULE_LIST = ("network", "nsg", "rules", "list")
INSTANCE_LIST = ("compute", "instance", "list")
ATTACHMENT_LIST = ("compute", "vnic-attachment", "list")
VNIC_GET = ("network", "vnic", "get")
POOL_LIST = ("compute-management", "instance-pool", "list")
POOL_INSTANCES = ("compute-management", "instance-pool", "list-instances")
CONTAINER_LIST = ("container-instances", "container-instance", "list")
CLUSTER_LIST = ("ce", "cluster", "list")
NODE_POOL_LIST = ("ce", "node-pool", "list")
NODE_POOL_GET = ("ce", "node-pool", "get")
BALANCER_LIST = ("lb", "load-balancer", "list")
NETWORK_BALANCER_LIST = ("nlb", "network-load-balancer", "list")
APPLICATION_LIST = ("fn", "application", "list")
FUNCTION_LIST = ("fn", "function", "list")
GATEWAY_LIST = ("api-gateway", "gateway", "list")
DEPLOYMENT_LIST = ("api-gateway", "deployment", "list")
DEPLOYMENT_GET = ("api-gateway", "deployment", "get")
AUTONOMOUS_LIST = ("db", "autonomous-database", "list")
DB_SYSTEM_LIST = ("db", "system", "list")
MYSQL_LIST = ("mysql", "db-system", "list")
TABLE_LIST = ("nosql", "table", "list")
BUCKET_LIST = ("os", "bucket", "list")
STREAM_LIST = ("streaming", "admin", "stream", "list")
QUEUE_LIST = ("queue", "queue-admin", "queue", "list")


def tags(defined=None, **freeform):
    """A resource's own tags, beside those Oracle adds to say who made it and when."""
    return {
        "freeform-tags": freeform,
        "defined-tags": {
            "Oracle-Tags": {"CreatedBy": CREATOR, "CreatedOn": "2026-01-10T12:00:00.000Z"},
            **(defined or {}),
        },
    }


def rule(source, low=None, high=None, protocol="6"):
    """An ingress rule: from an address range, or from the group `source` names."""
    written = {
        "id": "04ABEC",
        "direction": "INGRESS",
        "protocol": protocol,
        "source": source if "/" in source else group(source),
        "source-type": "CIDR_BLOCK" if "/" in source else "NETWORK_SECURITY_GROUP",
        "is-stateless": False,
        "is-valid": True,
    }
    if low is not None:
        options = {"6": "tcp-options", "17": "udp-options"}[protocol]
        written[options] = {"destination-port-range": {"min": low, "max": high or low}}
    return written


def networks(rules, vcns=None, subnets=None):
    """What four reads answer about networks: VCNs, subnets, groups and each group's rules."""
    vcns = vcns or {"shop": VCN}
    subnets = subnets or {EDGE: VCN, APP: VCN, DATA: VCN}
    by_group = {group(name): listed for name, listed in rules.items()}
    return {
        VCN_LIST: [
            {
                "id": vcn,
                "display-name": name,
                "lifecycle-state": "AVAILABLE",
                "cidr-block": "10.0.0.0/16",
                "compartment-id": COMPARTMENT,
                **tags(),
            }
            for name, vcn in vcns.items()
        ],
        SUBNET_LIST: [
            {
                "id": subnet,
                "vcn-id": vcn,
                "lifecycle-state": "AVAILABLE",
                "prohibit-public-ip-on-vnic": False,
                "compartment-id": COMPARTMENT,
            }
            for subnet, vcn in subnets.items()
        ],
        GROUP_LIST: [
            {
                "id": group(name),
                "display-name": name,
                "vcn-id": next(iter(vcns.values())),
                "lifecycle-state": "AVAILABLE",
                "compartment-id": COMPARTMENT,
                **tags(),
            }
            for name in rules
        ],
        RULE_LIST: lambda params: by_group[params["nsg-id"]],
    }


def machine(address, *groups, public=None, subnet=APP, state="RUNNING", **freeform):
    """An instance: its address, the groups its VNIC is in, and what else is said of it."""
    return {
        "address": address,
        "groups": groups,
        "public": public,
        "subnet": subnet,
        "state": state,
        "tags": freeform,
    }


def compute(machines):
    """What three reads answer about instances: the list, what is attached, and each VNIC."""
    vnics = {
        ocid("vnic", name): {
            "id": ocid("vnic", name),
            "display-name": name,
            "hostname-label": name,
            "private-ip": one["address"],
            "public-ip": one["public"],
            "nsg-ids": [group(each) for each in one["groups"]],
            "subnet-id": one["subnet"],
            "is-primary": True,
            "lifecycle-state": "AVAILABLE",
            "availability-domain": DOMAIN,
            "compartment-id": COMPARTMENT,
        }
        for name, one in machines.items()
    }
    return {
        INSTANCE_LIST: [
            {
                "id": ocid("instance", name),
                "display-name": name,
                "lifecycle-state": one["state"],
                "availability-domain": DOMAIN,
                "compartment-id": COMPARTMENT,
                "region": REGION,
                "shape": "VM.Standard.E5.Flex",
                "metadata": {"ssh_authorized_keys": "ssh-ed25519 AAAAC3Nza ana@laptop"},
                **tags(**one["tags"]),
            }
            for name, one in machines.items()
        ],
        ATTACHMENT_LIST: [
            {
                "id": ocid("vnicattachment", name),
                "instance-id": ocid("instance", name),
                "vnic-id": ocid("vnic", name),
                "subnet-id": one["subnet"],
                "nic-index": 0,
                "lifecycle-state": "ATTACHED",
                "availability-domain": DOMAIN,
                "compartment-id": COMPARTMENT,
            }
            for name, one in machines.items()
        ],
        VNIC_GET: lambda params: vnics[params["vnic-id"]],
    }


def balancer(key, name, address, subnet, groups, sets, private=False, state="ACTIVE", **more):
    """A load balancer as its list gives it, with the backends of each of its sets."""
    return {
        "id": key,
        "display-name": name,
        "lifecycle-state": state,
        "is-private": private,
        "ip-addresses": [{"ip-address": address, "is-public": not private}],
        "subnet-ids": [subnet],
        "network-security-group-ids": [group(each) for each in groups],
        "shape-name": "flexible",
        "backend-sets": {
            each: {
                "name": each,
                "policy": "ROUND_ROBIN",
                "backends": [
                    {
                        "name": f"{held}:{port}",
                        "ip-address": held,
                        "port": port,
                        "weight": 1,
                        "backup": False,
                        "drain": False,
                        "offline": False,
                    }
                    for held, port in backends
                ],
            }
            for each, backends in sets.items()
        },
        "compartment-id": COMPARTMENT,
        **(more or tags()),
    }


def database(name, state="AVAILABLE", **more):
    """An Autonomous Database with a private endpoint in the shop's data subnet."""
    return {
        "id": ocid("autonomousdatabase", name),
        "display-name": name,
        "db-name": name.replace("-", "").upper(),
        "lifecycle-state": state,
        "db-workload": "OLTP",
        "is-dedicated": False,
        "subnet-id": DATA,
        "nsg-ids": [group("shop-db")],
        "private-endpoint-ip": "10.0.2.10",
        "private-endpoint-label": name,
        "compartment-id": COMPARTMENT,
        **(more or tags(env="prod")),
    }


# The rules of each network security group of the shop.
RULES = {
    "shop-lb": [rule("0.0.0.0/0", 443)],
    "shop-api": [rule("0.0.0.0/0", 443)],
    "shop-app": [rule("shop-lb", 8080)],
    "shop-internal": [rule("shop-api", 443)],
    "oke-workers": [rule("shop-internal", 30000, 32767)],
    "shop-fn": [],
    "shop-db": [
        rule("shop-app", 1521),
        rule("shop-fn", 1521),
        rule("oke-workers", 1521),
        # A group that admits itself says nothing between two pieces.
        rule("shop-db", 1521),
        # Nor does a rule by address, or one about what leaves.
        rule("10.0.0.0/16", 1521),
        {
            "id": "F1E2D3",
            "direction": "EGRESS",
            "protocol": "all",
            "destination": group("shop-app"),
            "destination-type": "NETWORK_SECURITY_GROUP",
            "is-stateless": False,
            "is-valid": True,
        },
    ],
    "bastion": [rule("0.0.0.0/0", 22)],
}

# Every instance the compartment holds. Four are a pool's and two a cluster's.
MACHINES = {
    "storefront-1": machine("10.0.1.11", "shop-app"),
    "storefront-2": machine("10.0.1.12", "shop-app"),
    "storefront-3": machine("10.0.1.13", "shop-app"),
    "storefront-4": machine("10.0.1.14", "shop-app"),
    "legacy-web": machine(
        "10.0.1.20",
        "shop-app",
        env="prod",
        # A tag whose value is an OCID names the tenancy like any other.
        **{"launched-from": ocid("instanceconfiguration", "legacy")},
    ),
    "bastion": machine("10.0.0.5", "bastion", public="203.0.113.10", subnet=EDGE),
    "oke-node-1": machine("10.0.1.31", "oke-workers"),
    "oke-node-2": machine("10.0.1.32", "oke-workers"),
    "stopped": machine("10.0.1.40", "shop-app", state="STOPPED", env="prod"),
}

NODE_POOL = {
    "id": ocid("nodepool", "workers"),
    "name": "workers",
    "cluster-id": CLUSTER,
    "lifecycle-state": "ACTIVE",
    "kubernetes-version": "v1.33.1",
    "node-config-details": {
        "size": 2,
        "nsg-ids": [group("oke-workers")],
        "node-pool-pod-network-option-details": {"cni-type": "FLANNEL_OVERLAY"},
    },
    "compartment-id": COMPARTMENT,
}

# What the compartment answers in sa-saopaulo-1, by command. A list that
# finds nothing is not here: the CLI prints nothing for it.
SHOP = {
    **networks(RULES),
    **compute(MACHINES),
    POOL_LIST: [
        {
            "id": POOL,
            "display-name": "storefront",
            "lifecycle-state": "RUNNING",
            "size": 4,
            "instance-configuration-id": ocid("instanceconfiguration", "storefront"),
            "availability-domains": [DOMAIN],
            "compartment-id": COMPARTMENT,
            **tags(env="prod", app="shop"),
        }
    ],
    POOL_INSTANCES: lambda params: [
        {
            "id": ocid("instance", f"storefront-{n}"),
            "display-name": f"storefront-{n}",
            "instance-configuration-id": ocid("instanceconfiguration", "storefront"),
            "availability-domain": DOMAIN,
            "compartment-id": COMPARTMENT,
            "region": REGION,
            "shape": "VM.Standard.E5.Flex",
            "load-balancer-backends": [
                {
                    "load-balancer-id": BALANCER,
                    "backend-set-name": "storefront",
                    "backend-name": f"10.0.1.1{n}:8080",
                    "backend-health-status": "OK",
                }
            ],
        }
        for n in (1, 2, 3, 4)
        if params["instance-pool-id"] == POOL
    ],
    CLUSTER_LIST: [
        {
            "id": CLUSTER,
            "name": "platform",
            "vcn-id": VCN,
            "lifecycle-state": "ACTIVE",
            "kubernetes-version": "v1.33.1",
            "endpoint-config": {"subnet-id": APP, "nsg-ids": [], "is-public-ip-enabled": False},
            "compartment-id": COMPARTMENT,
            **tags(env="prod"),
        }
    ],
    NODE_POOL_LIST: [NODE_POOL],
    NODE_POOL_GET: lambda params: {
        **NODE_POOL,
        "nodes": [
            {
                "id": ocid("instance", f"oke-node-{n}"),
                "name": f"oke-node-{n}",
                "node-pool-id": NODE_POOL["id"],
                "subnet-id": APP,
                "private-ip": f"10.0.1.3{n}",
                "public-ip": None,
                "availability-domain": DOMAIN,
                "lifecycle-state": "ACTIVE",
            }
            for n in (1, 2)
        ],
    },
    BALANCER_LIST: [
        balancer(
            BALANCER,
            "shop-lb",
            "203.0.113.20",
            EDGE,
            ["shop-lb"],
            {
                "storefront": [(f"10.0.1.1{n}", 8080) for n in (1, 2, 3, 4)],
                # The second address is one nothing listed holds.
                "legacy": [("10.0.1.20", 8080), ("10.0.9.99", 8080)],
            },
            **tags({"Operations": {"CostCenter": "42"}}, env="prod"),
        ),
        balancer(
            INTERNAL,
            "internal-lb",
            "10.0.1.50",
            APP,
            ["shop-internal"],
            {"checkout": [("10.0.1.31", 30080), ("10.0.1.32", 30080)]},
            private=True,
            **tags(env="prod"),
        ),
    ],
    APPLICATION_LIST: [
        {
            "id": APPLICATION,
            "display-name": "shop",
            "lifecycle-state": "ACTIVE",
            "subnet-ids": [APP],
            "network-security-group-ids": [group("shop-fn")],
            "shape": "GENERIC_X86",
            "compartment-id": COMPARTMENT,
            **tags(env="prod"),
        }
    ],
    FUNCTION_LIST: lambda params: [
        {
            "id": FUNCTION,
            "display-name": "api-handler",
            "application-id": APPLICATION,
            "lifecycle-state": "ACTIVE",
            "memory-in-mbs": 256,
            "timeout-in-seconds": 30,
            "invoke-endpoint": f"https://a1b2c3d4.{REGION}.functions.oci.oraclecloud.com",
            "compartment-id": COMPARTMENT,
            **tags(env="prod"),
        }
    ]
    if params["application-id"] == APPLICATION
    else [],
    GATEWAY_LIST: {
        "items": [
            {
                "id": GATEWAY,
                "display-name": "partners",
                "endpoint-type": "PUBLIC",
                "lifecycle-state": "ACTIVE",
                "subnet-id": EDGE,
                "network-security-group-ids": [group("shop-api")],
                "hostname": f"a1b2c3d4.apigateway.{REGION}.oci.customer-oci.com",
                "compartment-id": COMPARTMENT,
                **tags(env="prod"),
            }
        ]
    },
    DEPLOYMENT_LIST: {
        "items": [
            {
                "id": DEPLOYMENT,
                "gateway-id": GATEWAY,
                "display-name": "partners-v1",
                "path-prefix": "/v1",
                "endpoint": f"https://a1b2c3d4.apigateway.{REGION}.oci.customer-oci.com/v1",
                "lifecycle-state": "ACTIVE",
                "compartment-id": COMPARTMENT,
            }
        ]
    },
    DEPLOYMENT_GET: lambda params: {
        "id": DEPLOYMENT,
        "gateway-id": GATEWAY,
        "display-name": "partners-v1",
        "path-prefix": "/v1",
        "lifecycle-state": "ACTIVE",
        "compartment-id": COMPARTMENT,
        "specification": {
            "routes": [
                {
                    "path": "/orders",
                    "methods": ["GET"],
                    "backend": {"type": "ORACLE_FUNCTIONS_BACKEND", "function-id": FUNCTION},
                },
                # By the address the private balancer holds.
                {
                    "path": "/checkout",
                    "methods": ["POST"],
                    "backend": {"type": "HTTP_BACKEND", "url": "https://10.0.1.50/checkout"},
                },
                # A backend by a name of the operator's own is not followed.
                {
                    "path": "/catalogue",
                    "methods": ["GET"],
                    "backend": {"type": "HTTP_BACKEND", "url": "https://catalogue.example.org/v2"},
                },
                {
                    "path": "/health",
                    "methods": ["GET"],
                    "backend": {"type": "STOCK_RESPONSE_BACKEND", "status": 200, "body": "ok"},
                },
            ]
        },
    }
    if params["deployment-id"] == DEPLOYMENT
    else None,
    STREAM_LIST: [
        {
            "id": ocid("stream", "order-events"),
            "name": "order-events",
            "partitions": 1,
            "lifecycle-state": "ACTIVE",
            "stream-pool-id": ocid("streampool", "shop"),
            "messages-endpoint": f"https://cell-1.streaming.{REGION}.oci.oraclecloud.com",
            "compartment-id": COMPARTMENT,
            **tags(env="prod"),
        }
    ],
    AUTONOMOUS_LIST: [database("orders-db")],
    BUCKET_LIST: [
        {
            "name": "shop-assets",
            "namespace": NAMESPACE,
            "compartment-id": COMPARTMENT,
            "created-by": ocid("user", "ana"),
            "time-created": "2026-01-10T12:00:00.000000+00:00",
            "etag": "5e1b6f0c-0a7e-4b39-b7a5-0d9c4b1e2f3a",
            **tags(env="prod"),
        }
    ],
}

# What the same compartment answers where it holds more kinds of resource.
MORE = {
    CONTAINER_LIST: {
        "items": [
            {
                "id": ocid("computecontainerinstance", "invoices"),
                "display-name": "invoice-renderer",
                "lifecycle-state": "ACTIVE",
                "container-count": 2,
                "shape": "CI.Standard.E4.Flex",
                "availability-domain": DOMAIN,
                "compartment-id": COMPARTMENT,
                **tags(env="prod"),
            }
        ]
    },
    NETWORK_BALANCER_LIST: {
        "items": [
            {
                "id": ocid("networkloadbalancer", "ingest"),
                "display-name": "ingest",
                "lifecycle-state": "ACTIVE",
                "is-private": False,
                "subnet-id": EDGE,
                "network-security-group-ids": [],
                "ip-addresses": [
                    {"ip-address": "203.0.113.30", "is-public": True, "ip-version": "IPV4"}
                ],
                "backend-sets": {
                    "tcp": {
                        "name": "tcp",
                        "policy": "FIVE_TUPLE",
                        "backends": [
                            # A backend may name an instance, which may be a pool's.
                            {
                                "name": f"{ocid('instance', target)}:443",
                                "target-id": ocid("instance", target),
                                "ip-address": None,
                                "port": 443,
                                "weight": 1,
                                "is-backup": False,
                                "is-drain": False,
                                "is-offline": False,
                            }
                            for target in ("legacy-web", "storefront-3")
                        ]
                        + [
                            {"name": "10.0.1.50:443", "ip-address": "10.0.1.50", "port": 443},
                            # A private address by its own OCID is not a resource.
                            {
                                "name": f"{ocid('privateip', 'gone')}:443",
                                "target-id": ocid("privateip", "gone"),
                                "port": 443,
                            },
                        ],
                    }
                },
                "compartment-id": COMPARTMENT,
                **tags(),
            }
        ]
    },
    DB_SYSTEM_LIST: [
        {
            "id": ocid("dbsystem", "erp"),
            "display-name": "erp-db",
            "lifecycle-state": "AVAILABLE",
            "node-count": 2,
            "subnet-id": DATA,
            "nsg-ids": [group("shop-db")],
            "hostname": "erp",
            "domain": "data.shop.oraclevcn.com",
            "shape": "VM.Standard.E5.Flex",
            "database-edition": "ENTERPRISE_EDITION_EXTREME_PERFORMANCE",
            "compartment-id": COMPARTMENT,
            **tags(env="prod"),
        }
    ],
    MYSQL_LIST: [
        {
            "id": ocid("mysqldbsystem", "reports"),
            "display-name": "reports-db",
            "lifecycle-state": "ACTIVE",
            "mysql-version": "8.4.3",
            "is-highly-available": False,
            "shape-name": "MySQL.4",
            "compartment-id": COMPARTMENT,
            **tags(env="prod"),
        }
    ],
    TABLE_LIST: {
        "items": [
            {
                "id": ocid("nosqltable", "sessions"),
                "name": "sessions",
                "lifecycle-state": "ACTIVE",
                "compartment-id": COMPARTMENT,
                **tags(env="prod"),
            }
        ]
    },
    QUEUE_LIST: {
        "items": [
            {
                "id": ocid("queue", "order-placed"),
                "display-name": "order-placed",
                "lifecycle-state": "ACTIVE",
                "messages-endpoint": f"https://cell-1.queue.messaging.{REGION}.oci.oraclecloud.com",
                "compartment-id": COMPARTMENT,
                **tags(),
            }
        ]
    },
}


class FakeOci:
    """Answers as the compartment above would, and remembers what it was asked."""

    def __init__(self, answers=None, refusing=(), elsewhere=None):
        self.answers = dict(SHOP if answers is None else answers)
        # What other compartments hold, by compartment.
        self.elsewhere = dict(elsewhere or {})
        self.refusing = set(refusing)
        self.calls = []

    def __call__(self, region, command, params=None):
        params = dict(params or {})
        self.calls.append((region, command, params))
        if command in self.refusing:
            raise core.CliError(
                f"oci {' '.join(command)}",
                "NotAuthorizedOrNotFound",
                f"Authorization failed or requested resource not found: {COMPARTMENT}, {CREATOR}",
            )
        compartment = params.get("compartment-id")
        if region != REGION:
            held = {}
        elif compartment is None:
            # Asked by an id, whichever compartment holds what it names.
            held = {}
            for some in (*self.elsewhere.values(), self.answers):
                held.update(some)
        elif compartment == COMPARTMENT:
            held = self.answers
        else:
            held = self.elsewhere.get(compartment, {})
        answer = held.get(command)
        if callable(answer):
            answer = answer(params)
        # Where a list finds nothing the CLI prints nothing.
        return {"data": answer} if answer else {}


def arguments(**overrides):
    values = {
        "regions": [REGION],
        "compartment": COMPARTMENT,
        "network_compartments": [],
        "profile": None,
    }
    values.update(overrides)
    return Namespace(**values)


def collected(fake=None, network_compartments=(), **options):
    fake = fake or FakeOci()
    inventory = core.Inventory("oci", "shop-oci", **options)
    with contextlib.redirect_stderr(io.StringIO()):
        oci.collect(inventory, fake, arguments(network_compartments=list(network_compartments)))
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


def asked(fake, command):
    return [params for _, asked_for, params in fake.calls if asked_for == command]


class CollectTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document, cls.fake = collected()
        cls.resources = by_id(cls.document)

    def test_each_resource_is_listed_once_as_the_kind_its_type_is(self):
        self.assertEqual(
            {name: one["type"] for name, one in self.resources.items()},
            {
                "storefront": "virtual-machine",
                "platform": "kubernetes-cluster",
                "legacy-web": "virtual-machine",
                "bastion": "virtual-machine",
                "shop-lb": "load-balancer",
                "internal-lb": "load-balancer",
                "api-handler": "serverless",
                "partners": "api-gateway",
                "order-events": "event-stream",
                "orders-db": "database",
                "shop-assets": "storage",
            },
        )
        self.assertEqual(
            {name: one["native"] for name, one in self.resources.items()},
            {
                "storefront": "oci.core.InstancePool",
                "platform": "oci.container_engine.Cluster",
                "legacy-web": "oci.core.Instance",
                "bastion": "oci.core.Instance",
                "shop-lb": "oci.load_balancer.LoadBalancer",
                "internal-lb": "oci.load_balancer.LoadBalancer",
                "api-handler": "oci.functions.Function",
                "partners": "oci.apigateway.Gateway",
                "order-events": "oci.streaming.Stream",
                "orders-db": "oci.database.AutonomousDatabase",
                "shop-assets": "oci.object_storage.Bucket",
            },
        )

    def test_a_pool_and_a_cluster_are_one_piece_each_whatever_runs_them(self):
        # The four instances of the pool are not listed beside it, nor the
        # two nodes beside their cluster; a stopped instance is not listed at
        # all, and one on its own is.
        self.assertEqual(self.resources["storefront"]["members"], 4)
        self.assertNotIn("members", self.resources["platform"])
        self.assertNotIn("members", self.resources["legacy-web"])
        for absent in ("storefront-1", "storefront-4", "oke-node-1", "oke-node-2", "stopped"):
            self.assertNotIn(absent, self.resources)

    def test_where_each_stands_is_what_the_tenancy_says(self):
        for one in self.resources.values():
            self.assertEqual(one["region"], REGION)
        # A network is called by the name its VCN was given.
        for name in (
            "storefront",
            "platform",
            "legacy-web",
            "bastion",
            "shop-lb",
            "internal-lb",
            "api-handler",
            "partners",
            "orders-db",
        ):
            self.assertEqual(self.resources[name].get("network"), "shop", name)
        for name in ("order-events", "shop-assets"):
            self.assertNotIn("network", self.resources[name], name)

    def test_public_is_what_the_provider_states_as_reachable_from_outside(self):
        public = sorted(name for name, one in self.resources.items() if one.get("public"))
        self.assertEqual(
            public,
            # Not the private balancer. Nor the bastion: it has an address of
            # its own, but its group admits anyone on 22 only, and that is
            # not where clients enter.
            ["partners", "shop-lb"],
        )

    def test_tags_are_the_resources_own_and_never_who_made_it(self):
        # A defined tag is written under its namespace.
        self.assertEqual(
            self.resources["shop-lb"]["tags"], {"env": "prod", "Operations.CostCenter": "42"}
        )
        self.assertEqual(self.resources["storefront"]["tags"], {"env": "prod", "app": "shop"})
        self.assertEqual(self.resources["legacy-web"]["tags"], {"env": "prod"})
        self.assertEqual(self.resources["shop-assets"]["tags"], {"env": "prod"})
        # What Oracle adds by itself is all the bastion carries.
        self.assertNotIn("tags", self.resources["bastion"])
        # A bucket's tags come only when they are asked for.
        self.assertEqual(
            asked(self.fake, BUCKET_LIST), [{"compartment-id": COMPARTMENT, "fields": "tags"}]
        )

    def test_routing_is_what_a_balancer_and_a_gateway_send_on(self):
        self.assertEqual(
            stated(self.document, "routing"),
            [
                ("internal-lb", "platform"),
                ("partners", "api-handler"),
                # A backend by a name of the operator's own is not followed,
                # and a stock response leads nowhere.
                ("partners", "internal-lb"),
                # Of the two addresses of the set, one is held by nothing.
                ("shop-lb", "legacy-web"),
                ("shop-lb", "storefront"),
            ],
        )
        said = evidence(self.document, "routing")
        self.assertEqual(said["shop-lb", "storefront"], "backend set storefront")
        self.assertEqual(said["shop-lb", "legacy-web"], "backend set legacy")
        self.assertEqual(said["internal-lb", "platform"], "backend set checkout")
        self.assertEqual(said["partners", "api-handler"], "route /orders")
        self.assertEqual(said["partners", "internal-lb"], "route /checkout")
        # The account states no delivery and names nothing in its own words.
        self.assertEqual(stated(self.document, "event"), [])
        self.assertEqual(stated(self.document, "declared"), [])

    def test_a_rule_between_two_groups_is_a_permission_between_their_members(self):
        self.assertEqual(
            stated(self.document, "network"),
            [
                ("api-handler", "orders-db"),
                ("internal-lb", "platform"),
                ("legacy-web", "orders-db"),
                ("partners", "internal-lb"),
                ("platform", "orders-db"),
                ("shop-lb", "legacy-web"),
                ("shop-lb", "storefront"),
                ("storefront", "orders-db"),
            ],
        )
        said = evidence(self.document, "network")
        self.assertEqual(
            said["api-handler", "orders-db"],
            "security rule: shop-fn may reach shop-db on tcp/1521",
        )
        self.assertEqual(
            said["internal-lb", "platform"],
            "security rule: shop-internal may reach oke-workers on tcp/30000-32767",
        )
        # Only what comes in is asked for.
        for params in asked(self.fake, RULE_LIST):
            self.assertEqual(params["direction"], "INGRESS")

    def test_nothing_that_names_the_tenancy_is_written(self):
        text = json.dumps(self.document)
        for absent in (
            "ocid1.",
            NAMESPACE,
            CREATOR,
            "ana@",
            "Oracle-Tags",
            "Uocm",
            "oraclecloud.com",
            "customer-oci.com",
            "ssh-",
        ):
            self.assertNotIn(absent, text)
        self.assertIsNone(re.search(r"\d{1,3}(\.\d{1,3}){3}", text), "an address is written")

    def test_it_says_what_it_did_not_read(self):
        self.assertEqual(len(self.document["notes"]), 1)
        for said in ("Cloud Guard", "security lists", "--relation"):
            self.assertIn(said, self.document["notes"][0])

    def test_every_call_is_a_read_the_collector_says_it_makes(self):
        made = {command for _, command, _ in self.fake.calls}
        self.assertLessEqual(made, set(oci.READS))
        self.assertEqual(len(oci.READS), len(set(oci.READS)))
        for command in oci.READS:
            self.assertRegex(command[-1], r"^(list|get)(-|$)", " ".join(command))
        # A statement for what each read needs, and none that lets anything
        # be changed: `use` is narrowed to the one permission that lists rules.
        self.assertEqual(len(oci.POLICY), len(set(oci.POLICY)))
        for statement in oci.POLICY:
            self.assertRegex(
                statement,
                r"^Allow group <group> to (inspect|read) [a-z-]+ in compartment <compartment>$"
                r"|^Allow group <group> to use network-security-groups in compartment "
                r"<compartment> where "
                r"request\.permission='NETWORK_SECURITY_GROUP_LIST_SECURITY_RULES'$",
            )

    def test_everything_is_asked_of_the_compartment_and_the_region_named(self):
        for region, command, params in self.fake.calls:
            self.assertEqual(region, REGION)
            self.assertEqual(params.get("compartment-id", COMPARTMENT), COMPARTMENT, command)
            self.assertNotIn(NAMESPACE, json.dumps(params))

    def test_an_instance_costs_one_call_for_each_vnic_and_a_pool_one(self):
        # The pool's first instance says which groups the pool is in; the
        # nodes of a cluster are placed by their node pool and cost nothing.
        self.assertEqual(
            [params["vnic-id"] for params in asked(self.fake, VNIC_GET)],
            [ocid("vnic", name) for name in ("storefront-1", "legacy-web", "bastion")],
        )
        self.assertEqual(len(asked(self.fake, ATTACHMENT_LIST)), 1)

    def test_the_example_is_what_the_collector_writes_from_these_answers(self):
        if os.environ.get("AEGIS_UPDATE_EXAMPLES"):
            EXAMPLE.parent.mkdir(parents=True, exist_ok=True)
            EXAMPLE.unlink(missing_ok=True)
            core.write(EXAMPLE, self.document)
        self.assertEqual(json.loads(EXAMPLE.read_text("utf-8")), self.document)


class EdgeTest(unittest.TestCase):
    def test_a_refused_read_is_noted_and_the_rest_is_still_read(self):
        document, _ = collected(FakeOci(refusing=[STREAM_LIST, CLUSTER_LIST]))
        resources = by_id(document)
        self.assertNotIn("order-events", resources)
        self.assertNotIn("platform", resources)
        self.assertIn("shop-lb", resources)
        notes = " ".join(document["notes"])
        self.assertIn("Streams could not be read (NotAuthorizedOrNotFound).", notes)
        self.assertIn("Kubernetes clusters could not be read (NotAuthorizedOrNotFound).", notes)
        # Only the code is kept of what the service said.
        text = json.dumps(document)
        self.assertNotIn("ocid1.", text)
        self.assertNotIn(CREATOR, text)

    def test_with_every_read_refused_nothing_is_written(self):
        fake = FakeOci(refusing=oci.READS)
        inventory = core.Inventory("oci", "shop-oci")
        with contextlib.redirect_stderr(io.StringIO()):
            oci.collect(inventory, fake, arguments())
        with self.assertRaisesRegex(core.CollectError, "NotAuthorizedOrNotFound"):
            inventory.document(WHEN)

    def test_a_list_that_found_nothing_is_read_however_the_cli_prints_it(self):
        for printed in ({}, {"data": None}, {"data": []}, {"data": {"items": []}}):
            inventory = core.Inventory("oci", "empty")
            oci.collect(inventory, mock.Mock(return_value=printed), arguments())
            with self.assertRaisesRegex(core.CollectError, "Nothing was found", msg=printed):
                inventory.document(WHEN)

    def test_other_kinds_of_resource_are_read_where_the_compartment_has_them(self):
        document, fake = collected(FakeOci({**SHOP, **MORE}))
        resources = by_id(document)
        self.assertEqual(
            {
                name: (resources[name]["type"], resources[name]["native"])
                for name in set(resources) - set(by_id(collected()[0]))
            },
            {
                "invoice-renderer": ("container", "oci.container_instances.ContainerInstance"),
                "ingest": ("load-balancer", "oci.network_load_balancer.NetworkLoadBalancer"),
                "erp-db": ("database", "oci.database.DbSystem"),
                "reports-db": ("database", "oci.mysql.DbSystem"),
                "sessions": ("database", "oci.nosql.Table"),
                "order-placed": ("message-queue", "oci.queue.Queue"),
            },
        )
        self.assertTrue(resources["ingest"]["public"])
        # A database system says how many nodes it is, and where it stands.
        self.assertEqual(resources["erp-db"]["members"], 2)
        self.assertEqual(resources["erp-db"]["network"], "shop")
        self.assertIn(("storefront", "erp-db"), stated(document, "network"))
        # Neither list places these two in a network.
        for name in ("reports-db", "invoice-renderer", "sessions"):
            self.assertNotIn("network", resources[name], name)
        # A network balancer's backend may name an instance, which may be a
        # pool's, or give an address, which another balancer may hold.
        routed = [pair for pair in stated(document, "routing") if pair[0] == "ingest"]
        self.assertEqual(
            routed, [("ingest", "internal-lb"), ("ingest", "legacy-web"), ("ingest", "storefront")]
        )
        self.assertEqual(evidence(document, "routing")["ingest", "storefront"], "backend set tcp")
        self.assertNotIn("ocid1.", json.dumps(document))
        # Between them, these answers have the collector make every read it may.
        self.assertEqual({command for _, command, _ in fake.calls}, set(oci.READS))

    def test_an_instance_is_public_only_with_an_address_and_a_rule_for_requests(self):
        answers = {
            **networks(
                {
                    "web": [rule("0.0.0.0/0", 443)],
                    "anything": [rule("::/0", protocol="all")],
                    # With no port named, a rule is about every port.
                    "every-port": [rule("0.0.0.0/0")],
                    "range": [rule("0.0.0.0/0", 1, 1024)],
                    "ssh": [rule("0.0.0.0/0", 22)],
                    "office": [rule("198.51.100.0/24", 443)],
                    "ping": [rule("0.0.0.0/0", protocol="1")],
                    "broken": [dict(rule("0.0.0.0/0", 443), **{"is-valid": False})],
                }
            ),
            **compute(
                {
                    "web": machine("10.0.1.1", "web", public="203.0.113.1"),
                    "open": machine("10.0.1.2", "anything", public="203.0.113.2"),
                    "wide": machine("10.0.1.3", "every-port", public="203.0.113.3"),
                    "low": machine("10.0.1.4", "range", public="203.0.113.4"),
                    "jump": machine("10.0.1.5", "ssh", public="203.0.113.5"),
                    "partner": machine("10.0.1.6", "office", public="203.0.113.6"),
                    "pinged": machine("10.0.1.7", "ping", public="203.0.113.7"),
                    "stale": machine("10.0.1.8", "broken", public="203.0.113.8"),
                    # Admitted, but with no address to be reached at.
                    "inner": machine("10.0.1.9", "web"),
                }
            ),
        }
        document, _ = collected(FakeOci(answers))
        self.assertEqual(
            {name: bool(one.get("public")) for name, one in by_id(document).items()},
            {
                "web": True,
                "open": True,
                "wide": True,
                "low": True,
                "jump": False,
                "partner": False,
                "pinged": False,
                "stale": False,
                "inner": False,
            },
        )

    def test_without_network_rules_no_group_is_read_and_no_instance_is_taken_to_be_public(self):
        answers = {
            **networks({"web": [rule("0.0.0.0/0", 443)], "db": [rule("web", 1521)]}),
            **compute({"web": machine("10.0.1.1", "web", public="203.0.113.1")}),
            AUTONOMOUS_LIST: [dict(database("orders-db"), **{"nsg-ids": [group("db")]})],
        }
        document, _ = collected(FakeOci(answers))
        self.assertTrue(by_id(document)["web"]["public"])
        self.assertEqual(stated(document, "network"), [("web", "orders-db")])
        # A group's rules are a call for each group: none is made.
        document, fake = collected(FakeOci(answers), network_rules=False)
        self.assertEqual(asked(fake, GROUP_LIST) + asked(fake, RULE_LIST), [])
        self.assertNotIn("public", by_id(document)["web"])
        self.assertEqual(by_id(document)["web"]["network"], "shop")
        self.assertEqual(document["relations"], [])
        self.assertIn("Network security groups were not read", " ".join(document["notes"]))

    def test_what_is_not_running_is_not_listed(self):
        def stream(name, state):
            return {"id": ocid("stream", name), "name": name, "lifecycle-state": state}

        old, new = ocid("loadbalancer", "old"), ocid("loadbalancer", "new")

        answers = {
            BALANCER_LIST: [
                balancer(old, "old-lb", "203.0.113.1", EDGE, [], {}, state="DELETED"),
                balancer(new, "new-lb", "203.0.113.2", EDGE, [], {}),
            ],
            AUTONOMOUS_LIST: [
                database("retired", "TERMINATED"),
                database("paused", "STOPPED"),
                # Being backed up or changed, a database is still there.
                database("nightly", "BACKUP_IN_PROGRESS"),
                database("resized", "SCALE_IN_PROGRESS"),
            ],
            STREAM_LIST: [
                stream("going", "DELETING"),
                stream("coming", "CREATING"),
                stream("kept", "UPDATING"),
            ],
            POOL_LIST: [
                {"id": POOL, "display-name": "ended", "lifecycle-state": "TERMINATED", "size": 3}
            ],
            # The functions of an application that is not active are not asked for.
            APPLICATION_LIST: [
                {"id": APPLICATION, "display-name": "idle", "lifecycle-state": "INACTIVE"}
            ],
            FUNCTION_LIST: [
                {"id": FUNCTION, "display-name": "never", "lifecycle-state": "ACTIVE"}
            ],
        }
        document, fake = collected(FakeOci(answers))
        self.assertEqual(sorted(by_id(document)), ["kept", "new-lb", "nightly", "resized"])
        self.assertEqual(asked(fake, FUNCTION_LIST), [])
        self.assertEqual(asked(fake, POOL_INSTANCES), [])

    def test_a_balancer_is_public_only_where_the_tenancy_says_it_is_not_private(self):
        unsaid = balancer(ocid("loadbalancer", "unsaid"), "unsaid-lb", "10.0.0.8", APP, [], {})
        del unsaid["is-private"]
        answers = {
            BALANCER_LIST: [
                unsaid,
                balancer(ocid("loadbalancer", "edge"), "edge-lb", "203.0.113.2", EDGE, [], {}),
            ]
        }
        document, _ = collected(FakeOci(answers))
        self.assertEqual(
            {name: bool(one.get("public")) for name, one in by_id(document).items()},
            {"unsaid-lb": False, "edge-lb": True},
        )

    def test_a_resource_with_no_name_is_called_by_what_it_is_and_never_by_its_ocid(self):
        unnamed = ocid("instance", "unnamed")
        answers = {
            INSTANCE_LIST: [
                {"id": unnamed, "lifecycle-state": "RUNNING"},
                # A name that is an OCID was given by nobody.
                {
                    "id": ocid("instance", "other"),
                    "display-name": unnamed,
                    "lifecycle-state": "RUNNING",
                },
            ],
            AUTONOMOUS_LIST: [
                {
                    "id": ocid("autonomousdatabase", "unnamed"),
                    "db-name": "ORDERS",
                    "lifecycle-state": "AVAILABLE",
                }
            ],
        }
        document, _ = collected(FakeOci(answers))
        self.assertEqual(
            sorted(by_id(document)),
            ["ORDERS", "oci.core.Instance", f"oci.core.Instance-{REGION}"],
        )
        self.assertNotIn("ocid1.", json.dumps(document))

    def test_an_address_is_resolved_in_the_balancers_own_network(self):
        # Two networks may use the same addresses.
        blue, green = ocid("vcn", "blue"), ocid("vcn", "green")
        blue_net, green_net = ocid("subnet", "blue"), ocid("subnet", "green")
        answers = {
            **networks(
                {}, vcns={"blue": blue, "green": green}, subnets={blue_net: blue, green_net: green}
            ),
            **compute(
                {
                    "blue-web": machine("10.0.1.10", subnet=blue_net),
                    "green-web": machine("10.0.1.10", subnet=green_net),
                }
            ),
            BALANCER_LIST: [
                balancer(
                    ocid("loadbalancer", "blue"),
                    "blue-lb",
                    "10.0.0.9",
                    blue_net,
                    [],
                    {"web": [("10.0.1.10", 80)]},
                    private=True,
                )
            ],
        }
        document, _ = collected(FakeOci(answers))
        resources = by_id(document)
        self.assertEqual(resources["blue-web"]["network"], "blue")
        self.assertEqual(resources["green-web"]["network"], "green")
        self.assertEqual(stated(document, "routing"), [("blue-lb", "blue-web")])
        # Where nothing says which network either is in, an address two
        # resources hold names neither of them.
        del answers[SUBNET_LIST]
        document, _ = collected(FakeOci(answers))
        self.assertEqual(stated(document, "routing"), [])

    def test_networks_kept_in_another_compartment_are_read_there_when_it_is_named(self):
        network = networks(RULES)
        rest = {command: answer for command, answer in SHOP.items() if command not in network}
        document, fake = collected(
            FakeOci(rest, elsewhere={NETWORK: network}), network_compartments=[NETWORK]
        )
        resources = by_id(document)
        self.assertEqual(resources["storefront"]["network"], "shop")
        self.assertTrue(resources["shop-lb"]["public"])
        self.assertIn(("storefront", "orders-db"), stated(document, "network"))
        # Only the networks are looked for there.
        there = {
            command
            for _, command, params in fake.calls
            if params.get("compartment-id") == NETWORK
        }
        self.assertEqual(there, {VCN_LIST, SUBNET_LIST, GROUP_LIST})
        # Without it, nothing says which network a resource is in or what
        # its groups admit; what a balancer sends on is still followed.
        document, fake = collected(FakeOci(rest, elsewhere={NETWORK: network}))
        self.assertNotIn("network", by_id(document)["storefront"])
        self.assertEqual(stated(document, "network"), [])
        self.assertIn(("shop-lb", "legacy-web"), stated(document, "routing"))
        self.assertEqual(asked(fake, RULE_LIST), [])

    def test_the_vnics_read_in_a_region_are_bounded_and_what_was_not_read_is_said(self):
        answers = {
            **networks({"app": []}),
            **compute(
                {name: machine(f"10.0.1.{n}", "app") for n, name in enumerate("abc", 1)}
            ),
        }
        with mock.patch.object(oci, "MAX_VNIC_READS", 2):
            document, fake = collected(FakeOci(answers))
        self.assertEqual(len(asked(fake, VNIC_GET)), 2)
        # The third is listed, in the network its attachment names.
        self.assertEqual(sorted(by_id(document)), ["a", "b", "c"])
        self.assertEqual(by_id(document)["c"]["network"], "shop")
        self.assertIn(
            f"1 instance in {REGION} is listed without its network security groups",
            " ".join(document["notes"]),
        )

    def test_a_pool_no_balancer_names_is_found_by_the_address_of_its_first_instance(self):
        answers = {
            **networks({}),
            **compute({"worker-1": machine("10.0.1.11"), "worker-2": machine("10.0.1.12")}),
            POOL_LIST: [
                {"id": POOL, "display-name": "workers", "lifecycle-state": "SCALING", "size": 2}
            ],
            POOL_INSTANCES: [
                {"id": ocid("instance", f"worker-{n}"), "load-balancer-backends": []}
                for n in (1, 2)
            ],
            BALANCER_LIST: [
                balancer(
                    BALANCER,
                    "jobs-lb",
                    "10.0.0.9",
                    APP,
                    [],
                    {"jobs": [("10.0.1.11", 80), ("10.0.1.12", 80)]},
                    private=True,
                )
            ],
        }
        document, _ = collected(FakeOci(answers))
        self.assertEqual(sorted(by_id(document)), ["jobs-lb", "workers"])
        self.assertEqual(by_id(document)["workers"]["network"], "shop")
        self.assertEqual(stated(document, "routing"), [("jobs-lb", "workers")])


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
        fake = fake or FakeOci()
        shown, said = io.StringIO(), io.StringIO()
        with (
            # The script lists its collectors itself; this one is tried on its own.
            mock.patch.object(self.script, "COLLECTORS", (oci,)),
            mock.patch.object(oci, "client", return_value=fake),
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
            code, shown, said, _ = self.run_main(
                "oci",
                "--compartment",
                COMPARTMENT,
                "--region",
                REGION,
                "--name",
                "shop-oci",
                "--tag",
                "env=prod",
                "--tag-key",
                "env",
                "--type",
                "legacy-web=container",
                "--relation",
                "storefront=order-events",
                "--output",
                str(output),
            )
            self.assertEqual(code, 0, said)
            document = json.loads(output.read_text("utf-8"))
        resources = by_id(document)
        self.assertEqual(document["provider"], "oci")
        self.assertEqual(document["name"], "shop-oci")
        self.assertRegex(document["collectedAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertNotIn("bastion", resources, "it carries no tag")
        self.assertEqual(resources["legacy-web"]["type"], "container")
        self.assertEqual(resources["storefront"]["tags"], {"env": "prod"})
        self.assertIn(("storefront", "order-events"), stated(document, "declared"))
        self.assertIn(f"{len(document['resources'])} resources", shown)
        self.assertIn(f"{len(document['relations'])} relations", shown)
        self.assertIn("Note: Not read:", said)

    def test_without_a_name_the_platform_is_called_after_what_was_read(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "inventory.json"
            code, _, _, fake = self.run_main(
                "oci",
                "--compartment",
                COMPARTMENT,
                "--region",
                REGION,
                "--region",
                "us-ashburn-1",
                "--network-compartment",
                NETWORK,
                "--output",
                str(output),
            )
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(output.read_text("utf-8"))["name"], f"oci-{REGION}")
        # Each region is asked on its own, and the networks in both compartments.
        self.assertEqual(sorted({region for region, _, _ in fake.calls}), [REGION, "us-ashburn-1"])
        self.assertEqual(
            [
                (region, params["compartment-id"])
                for region, command, params in fake.calls
                if command == VCN_LIST
            ],
            [
                (REGION, COMPARTMENT),
                (REGION, NETWORK),
                ("us-ashburn-1", COMPARTMENT),
                ("us-ashburn-1", NETWORK),
            ],
        )

    def test_a_file_that_exists_is_left_alone_and_nothing_is_asked(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "inventory.json"
            output.write_text("mine", encoding="utf-8")
            code, _, said, fake = self.run_main(
                "oci", "--compartment", COMPARTMENT, "--region", REGION, "--output", str(output)
            )
            self.assertEqual(code, 1)
            self.assertIn("Inventory failed: Output already exists", said)
            self.assertEqual(output.read_text("utf-8"), "mine")
        self.assertEqual(fake.calls, [])

    def test_a_declaration_that_names_nothing_stops_before_the_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "inventory.json"
            code, _, said, _ = self.run_main(
                "oci",
                "--compartment",
                COMPARTMENT,
                "--region",
                REGION,
                "--type",
                "nobody=database",
                "--output",
                str(output),
            )
            self.assertEqual(code, 1)
            self.assertIn("nobody", said)
            self.assertFalse(output.exists())

    def test_what_is_not_a_compartment_a_region_or_a_profile_is_refused_before_any_call(self):
        here = ["--compartment", COMPARTMENT, "--region", REGION]
        for bad in (
            ["oci", "--compartment", COMPARTMENT, "--region", "São Paulo", "--output", "x.json"],
            ["oci", *here, "--profile", "--config-file=/tmp/x", "--output", "x.json"],
            ["oci", "--region", REGION, "--output", "x.json"],
            ["oci", "--compartment", COMPARTMENT, "--output", "x.json"],
            # A compartment is named by its OCID, and nothing else is one.
            ["oci", "--compartment", "shop", "--region", REGION, "--output", "x.json"],
            ["oci", "--compartment", "--auth=security_token", "--region", REGION, "--output", "x"],
            ["oci", "--compartment", ocid("instance", "web"), "--region", REGION, "--output", "x"],
            ["oci", *here, "--network-compartment", "network", "--output", "x.json"],
            ["oci", *here, "--type", "db=warehouse", "--output", "x.json"],
        ):
            code, _, _, fake = self.run_main(*bad)
            self.assertEqual(code, 2, bad)
            self.assertEqual(fake.calls, [])


class ClientTest(unittest.TestCase):
    def test_the_cli_is_given_a_list_and_asked_for_json_with_the_operators_profile(self):
        ran = []

        def run(command, **options):
            ran.append((command, options))
            return mock.Mock(returncode=0, stdout='{"data": [{"id": "x"}]}', stderr="")

        with mock.patch.object(core.subprocess, "run", side_effect=run):
            call = oci.client(arguments(profile="readonly"))
            answer = call(REGION, VCN_LIST, {"compartment-id": COMPARTMENT})
            call(REGION, VNIC_GET, {"vnic-id": ocid("vnic", "web")})
        self.assertEqual(answer, {"data": [{"id": "x"}]})
        command, options = ran[0]
        self.assertEqual(command[:4], ["oci", "network", "vcn", "list"])
        self.assertEqual(command[command.index("--compartment-id") + 1], COMPARTMENT)
        self.assertEqual(command[command.index("--region") + 1], REGION)
        self.assertEqual(command[command.index("--profile") + 1], "readonly")
        self.assertEqual(command[command.index("--output") + 1], "json")
        # Every page of a list is asked for; one thing by its id has no pages.
        self.assertIn("--all", command)
        self.assertNotIn("shell", options)
        command, _ = ran[1]
        self.assertEqual(command[:4], ["oci", "network", "vnic", "get"])
        self.assertEqual(command[command.index("--vnic-id") + 1], ocid("vnic", "web"))
        self.assertNotIn("--all", command)
        self.assertNotIn("--compartment-id", command)

    def test_without_a_profile_none_is_named_and_nothing_printed_is_nothing_found(self):
        ran = []

        def run(command, **options):
            ran.append(command)
            return mock.Mock(returncode=0, stdout="", stderr="")

        with mock.patch.object(core.subprocess, "run", side_effect=run):
            answer = oci.client(arguments())(REGION, QUEUE_LIST, {"compartment-id": COMPARTMENT})
        self.assertEqual(answer, {})
        self.assertEqual(ran[0][:5], ["oci", "queue", "queue-admin", "queue", "list"])
        self.assertNotIn("--profile", ran[0])

    def test_a_refusal_is_named_by_the_services_code(self):
        # As the CLI prints a service's refusal: the error's name, then its
        # body with the keys sorted.
        body = {
            "client_version": "Oracle-PythonSDK/2.160.0, Oracle-PythonCLI/3.66.0",
            "code": "NotAuthorizedOrNotFound",
            "logging_tips": "Please run the OCI CLI command using --debug flag to find more "
            "debug information.",
            "message": "Authorization failed or requested resource not found.",
            "opc-request-id": "6B1C9D2EF0A14C5E/8A7B6C5D4E3F2A1B/0F1E2D3C4B5A6978",
            "operation_name": "list_streams",
            "request_endpoint": f"GET https://streaming.{REGION}.oci.oraclecloud.com/20180418/streams",
            "status": 404,
            "target_service": "stream_admin",
            "timestamp": "2026-11-21T12:00:00.000000+00:00",
            "troubleshooting_tips": "See "
            "https://docs.oracle.com/iaas/Content/API/References/apierrors.htm for more "
            "information about resolving this error.",
        }
        refused = mock.Mock(
            returncode=1,
            stdout="",
            stderr="ServiceError:\n" + json.dumps(body, indent=4, sort_keys=True),
        )
        with mock.patch.object(core.subprocess, "run", return_value=refused):
            with self.assertRaises(core.CliError) as raised:
                oci.client(arguments())(REGION, STREAM_LIST, {"compartment-id": COMPARTMENT})
        self.assertEqual(raised.exception.code, "NotAuthorizedOrNotFound")
        self.assertEqual(raised.exception.command, "oci streaming admin stream list")

    def test_a_failure_before_any_answer_is_named_by_what_failed(self):
        body = {
            "client_version": "Oracle-PythonCLI/3.66.0",
            "message": "The connection to endpoint timed out.",
            "request_endpoint": f"GET https://iaas.{REGION}.oraclecloud.com/20160918/vcns",
            "target_service": "CLI",
        }
        failed = mock.Mock(
            returncode=1,
            stdout="",
            stderr="RequestException:\n" + json.dumps(body, indent=4, sort_keys=True),
        )
        with mock.patch.object(core.subprocess, "run", return_value=failed):
            with self.assertRaises(core.CliError) as raised:
                oci.client(arguments())(REGION, VCN_LIST, {"compartment-id": COMPARTMENT})
        self.assertEqual(raised.exception.code, "RequestException")

    def test_a_value_that_reads_as_an_option_never_reaches_the_cli(self):
        with mock.patch.object(core.subprocess, "run") as run:
            call = oci.client(arguments())
            for bad in ("--from-json=file:///etc/passwd", "-h", "a b", "", None):
                with self.assertRaises(core.CliError, msg=bad):
                    call(REGION, VNIC_GET, {"vnic-id": bad})
        run.assert_not_called()

    def test_without_the_cli_the_operator_is_told_so(self):
        with mock.patch.object(core.subprocess, "run", side_effect=FileNotFoundError):
            with self.assertRaisesRegex(core.CollectError, "not installed"):
                oci.client(arguments())(REGION, VCN_LIST, {"compartment-id": COMPARTMENT})


if __name__ == "__main__":
    unittest.main()
