"""Offline checks for the AWS inventory collector.

The AWS CLI is never run: each test hands the collector a fake `call` that
answers in the shapes the AWS CLI v2 prints (the API's own field names, with
the pages of a list already joined, as the CLI joins them). The shapes were
written from the AWS API references, not recorded from an account.

`examples/cloud-inventory/topologies/aws-shop.json` is what the collector writes from
the answers below. To write it again after changing either:

    AEGIS_UPDATE_EXAMPLES=1 python3 -B -m unittest discover -s scripts -p 'test_cloud_inventory_aws.py'
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

from cloud_inventory import aws, core

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
EXAMPLE = ROOT / "examples" / "cloud-inventory" / "topologies" / "aws-shop.json"
WHEN = "2026-11-21T12:00:00Z"

REGION = "sa-east-1"
ACCOUNT = "123456789012"
ARN = f"arn:aws:{{}}:{REGION}:{ACCOUNT}:{{}}"

VPC = "vpc-0a1b2c3d"
ALB = ARN.format("elasticloadbalancing", "loadbalancer/app/shop-alb/50dc6c495c0c9188")
ALB_DNS = "shop-alb-1234567890.sa-east-1.elb.amazonaws.com"
LISTENER = ARN.format(
    "elasticloadbalancing", "listener/app/shop-alb/50dc6c495c0c9188/f2f7dc8efc522ab2"
)


def target_group(name):
    return ARN.format("elasticloadbalancing", f"targetgroup/{name}/73e2d6bc24d8a067")


def function(name):
    return ARN.format("lambda", f"function:{name}")


def queue(name):
    return ARN.format("sqs", name)


CLUSTER = ARN.format("ecs", "cluster/shop")
ASG = ARN.format(
    "autoscaling",
    "autoScalingGroup:930d940e-891e-4781-a11a-7b0acd480f03:autoScalingGroupName/legacy-web",
)
DB_CLUSTER = ARN.format("rds", "cluster:orders-db")
CACHE = ARN.format("elasticache", "replicationgroup:cart-cache")
TOPIC = ARN.format("sns", "order-placed")
POOL = ARN.format("cognito-idp", "userpool/sa-east-1_AbCdEfGhI")
DISTRIBUTION = f"arn:aws:cloudfront::{ACCOUNT}:distribution/E2QWRUHAPOMQZL"


def group(group_id, name, *rules):
    return {
        "GroupId": group_id,
        "GroupName": name,
        "VpcId": VPC,
        "IpPermissions": list(rules),
    }


def from_group(source, port):
    return {
        "IpProtocol": "tcp",
        "FromPort": port,
        "ToPort": port,
        "UserIdGroupPairs": [{"GroupId": source, "UserId": ACCOUNT}],
        "IpRanges": [],
    }


def from_anywhere(port):
    return {
        "IpProtocol": "tcp",
        "FromPort": port,
        "ToPort": port,
        "UserIdGroupPairs": [],
        "IpRanges": [{"CidrIp": "0.0.0.0/0"}],
    }


def instance(instance_id, name, groups, public=None):
    described = {
        "InstanceId": instance_id,
        "State": {"Name": "running"},
        "VpcId": VPC,
        "PrivateIpAddress": "10.0.1.10",
        "SecurityGroups": [{"GroupId": one, "GroupName": one} for one in groups],
        "Tags": [{"Key": "Name", "Value": name}, {"Key": "env", "Value": "prod"}],
    }
    if public:
        described["PublicIpAddress"] = public
    return described


def service(name, desired, target):
    return {
        "serviceArn": ARN.format("ecs", f"service/shop/{name}"),
        "serviceName": name,
        "clusterArn": CLUSTER,
        "desiredCount": desired,
        "loadBalancers": [{"targetGroupArn": target_group(target), "containerName": name}],
        "networkConfiguration": {
            "awsvpcConfiguration": {
                "subnets": ["subnet-1"],
                "securityGroups": ["sg-app"],
                "assignPublicIp": "DISABLED",
            }
        },
        "tags": [{"key": "env", "value": "prod"}, {"key": "app", "value": "shop"}],
    }


def tagged(arn, **tags):
    return {
        "ResourceARN": arn,
        "Tags": [{"Key": key, "Value": value} for key, value in tags.items()],
    }


# What the account answers in sa-east-1, by service and operation.
SHOP = {
    ("resourcegroupstaggingapi", "get-resources"): {
        "ResourceTagMappingList": [
            tagged(ALB, env="prod"),
            tagged(function("fulfil"), env="prod", app="shop"),
            tagged(queue("order-events"), env="prod"),
            tagged(ARN.format("dynamodb", "table/sessions"), env="prod"),
            tagged("arn:aws:s3:::shop-assets", env="prod"),
        ]
    },
    ("ec2", "describe-vpcs"): {
        "Vpcs": [{"VpcId": VPC, "Tags": [{"Key": "Name", "Value": "shop"}]}]
    },
    ("ec2", "describe-security-groups"): {
        "SecurityGroups": [
            group("sg-lb", "shop-lb", from_anywhere(443)),
            group("sg-app", "shop-app", from_group("sg-lb", 8080)),
            group(
                "sg-db",
                "shop-db",
                from_group("sg-app", 5432),
                from_group("sg-fn", 5432),
                # A group that admits itself says nothing between two pieces.
                from_group("sg-db", 5432),
            ),
            group("sg-fn", "shop-fn"),
            group("sg-cache", "shop-cache", from_group("sg-app", 6379)),
            group("sg-bastion", "bastion", from_anywhere(22)),
        ]
    },
    ("ec2", "describe-instances"): {
        "Reservations": [
            {
                "Instances": [
                    instance("i-0aaa", "legacy-web", ["sg-app"]),
                    instance("i-0bbb", "legacy-web", ["sg-app"]),
                ]
            },
            {
                "Instances": [
                    instance("i-0ccc", "bastion", ["sg-bastion"], public="203.0.113.10"),
                    dict(instance("i-0ddd", "stopped", ["sg-app"]), State={"Name": "stopped"}),
                ]
            },
        ]
    },
    ("autoscaling", "describe-auto-scaling-groups"): {
        "AutoScalingGroups": [
            {
                "AutoScalingGroupName": "legacy-web",
                "AutoScalingGroupARN": ASG,
                "DesiredCapacity": 2,
                "MinSize": 2,
                "MaxSize": 6,
                "Instances": [
                    {"InstanceId": "i-0aaa", "LifecycleState": "InService"},
                    {"InstanceId": "i-0bbb", "LifecycleState": "InService"},
                ],
                "TargetGroupARNs": [target_group("legacy")],
                "Tags": [{"Key": "env", "Value": "prod", "PropagateAtLaunch": True}],
            }
        ]
    },
    ("elbv2", "describe-load-balancers"): {
        "LoadBalancers": [
            {
                "LoadBalancerArn": ALB,
                "LoadBalancerName": "shop-alb",
                "DNSName": ALB_DNS,
                "Scheme": "internet-facing",
                "Type": "application",
                "VpcId": VPC,
                "SecurityGroups": ["sg-lb"],
                "State": {"Code": "active"},
            }
        ]
    },
    ("elbv2", "describe-target-groups"): {
        "TargetGroups": [
            {
                "TargetGroupArn": target_group(name),
                "TargetGroupName": name,
                "TargetType": kind,
                "VpcId": VPC,
                "LoadBalancerArns": [ALB],
            }
            for name, kind in (
                ("storefront", "ip"),
                ("checkout", "ip"),
                ("legacy", "instance"),
            )
        ]
    },
    ("elbv2", "describe-target-health"): lambda params: {
        "TargetHealthDescriptions": [
            {"Target": {"Id": "i-0aaa", "Port": 80}, "TargetHealth": {"State": "healthy"}},
            {"Target": {"Id": "i-0bbb", "Port": 80}, "TargetHealth": {"State": "healthy"}},
        ]
        if params["TargetGroupArn"] == target_group("legacy")
        else []
    },
    ("ecs", "list-clusters"): {"clusterArns": [CLUSTER]},
    ("ecs", "list-services"): {
        "serviceArns": [
            ARN.format("ecs", "service/shop/storefront"),
            ARN.format("ecs", "service/shop/checkout"),
        ]
    },
    ("ecs", "describe-services"): {
        "services": [
            service("storefront", 4, "storefront"),
            service("checkout", 2, "checkout"),
        ]
    },
    ("lambda", "list-functions"): {
        "Functions": [
            {
                "FunctionName": "fulfil",
                "FunctionArn": function("fulfil"),
                "VpcConfig": {"VpcId": VPC, "SecurityGroupIds": ["sg-fn"], "SubnetIds": []},
            },
            # A function outside any network: the API answers with empty strings.
            {
                "FunctionName": "notify",
                "FunctionArn": function("notify"),
                "VpcConfig": {"VpcId": "", "SecurityGroupIds": [], "SubnetIds": []},
            },
            {"FunctionName": "api-handler", "FunctionArn": function("api-handler")},
        ]
    },
    ("lambda", "list-event-source-mappings"): {
        "EventSourceMappings": [
            {
                "UUID": "14e0db71-0001",
                "EventSourceArn": queue("order-events"),
                "FunctionArn": function("fulfil"),
                "State": "Enabled",
            },
            {
                "UUID": "14e0db71-0002",
                "EventSourceArn": queue("order-events-dlq"),
                "FunctionArn": function("notify"),
                "State": "Disabled",
            },
        ]
    },
    ("apigateway", "get-rest-apis"): {
        "items": [
            {
                "id": "a1b2c3d4e5",
                "name": "partners",
                "endpointConfiguration": {"types": ["REGIONAL"]},
                "tags": {"env": "prod"},
            }
        ]
    },
    ("apigateway", "get-resources"): {
        "items": [
            {"id": "root", "path": "/"},
            {
                "id": "abc123",
                "path": "/orders",
                "resourceMethods": {
                    "GET": {
                        "httpMethod": "GET",
                        "authorizationType": "COGNITO_USER_POOLS",
                        "methodIntegration": {
                            "type": "AWS_PROXY",
                            "uri": f"arn:aws:apigateway:{REGION}:lambda:path/2015-03-31/functions/"
                            f"{function('api-handler')}/invocations",
                        },
                    },
                    "OPTIONS": {"httpMethod": "OPTIONS", "methodIntegration": {"type": "MOCK"}},
                },
            },
        ]
    },
    ("apigateway", "get-authorizers"): {
        "items": [
            {
                "id": "auth1",
                "name": "shoppers",
                "type": "COGNITO_USER_POOLS",
                "providerARNs": [POOL],
            }
        ]
    },
    ("apigatewayv2", "get-apis"): {
        "Items": [
            {
                "ApiId": "f6g7h8i9j0",
                "Name": "mobile",
                "ProtocolType": "HTTP",
                "ApiEndpoint": f"https://f6g7h8i9j0.execute-api.{REGION}.amazonaws.com",
                "Tags": {"env": "prod"},
            }
        ]
    },
    ("apigatewayv2", "get-integrations"): {
        "Items": [
            {
                "IntegrationId": "int1",
                "IntegrationType": "AWS_PROXY",
                "IntegrationUri": function("api-handler"),
            },
            {
                "IntegrationId": "int2",
                "IntegrationType": "HTTP_PROXY",
                "ConnectionType": "VPC_LINK",
                "IntegrationUri": LISTENER,
            },
        ]
    },
    ("apigatewayv2", "get-authorizers"): {
        "Items": [
            {
                "AuthorizerId": "jwt1",
                "Name": "shoppers-jwt",
                "AuthorizerType": "JWT",
                "JwtConfiguration": {
                    "Issuer": f"https://cognito-idp.{REGION}.amazonaws.com/sa-east-1_AbCdEfGhI",
                    "Audience": ["mobile"],
                },
            }
        ]
    },
    ("cognito-idp", "list-user-pools"): {
        "UserPools": [{"Id": "sa-east-1_AbCdEfGhI", "Name": "shoppers"}]
    },
    ("sqs", "list-queues"): {
        "QueueUrls": [
            f"https://sqs.{REGION}.amazonaws.com/{ACCOUNT}/order-events",
            f"https://sqs.{REGION}.amazonaws.com/{ACCOUNT}/order-events-dlq",
        ]
    },
    ("sqs", "get-queue-attributes"): lambda params: {
        "Attributes": {
            "QueueArn": queue("order-events"),
            "RedrivePolicy": json.dumps(
                {"deadLetterTargetArn": queue("order-events-dlq"), "maxReceiveCount": 5}
            ),
        }
        if params["QueueUrl"].endswith("/order-events")
        else {"QueueArn": queue("order-events-dlq")}
    },
    ("sns", "list-topics"): {"Topics": [{"TopicArn": TOPIC}]},
    ("sns", "list-subscriptions"): {
        "Subscriptions": [
            {
                "SubscriptionArn": f"{TOPIC}:1",
                "Protocol": "sqs",
                "Endpoint": queue("order-events"),
                "TopicArn": TOPIC,
            },
            {
                "SubscriptionArn": f"{TOPIC}:2",
                "Protocol": "lambda",
                "Endpoint": function("notify"),
                "TopicArn": TOPIC,
            },
            {
                "SubscriptionArn": "PendingConfirmation",
                "Protocol": "email",
                "Endpoint": "ops@example.com",
                "TopicArn": TOPIC,
            },
        ]
    },
    ("rds", "describe-db-clusters"): {
        "DBClusters": [
            {
                "DBClusterIdentifier": "orders-db",
                "DBClusterArn": DB_CLUSTER,
                "Engine": "aurora-postgresql",
                "DBClusterMembers": [
                    {"DBInstanceIdentifier": "orders-db-1", "IsClusterWriter": True},
                    {"DBInstanceIdentifier": "orders-db-2", "IsClusterWriter": False},
                ],
                "VpcSecurityGroups": [{"VpcSecurityGroupId": "sg-db", "Status": "active"}],
                "TagList": [{"Key": "env", "Value": "prod"}],
            }
        ]
    },
    ("rds", "describe-db-instances"): {
        "DBInstances": [
            {
                "DBInstanceIdentifier": f"orders-db-{n}",
                "DBInstanceArn": ARN.format("rds", f"db:orders-db-{n}"),
                "DBClusterIdentifier": "orders-db",
                "Engine": "aurora-postgresql",
                "VpcSecurityGroups": [{"VpcSecurityGroupId": "sg-db"}],
                "DBSubnetGroup": {"VpcId": VPC},
            }
            for n in (1, 2)
        ]
        + [
            {
                "DBInstanceIdentifier": "reports-db",
                "DBInstanceArn": ARN.format("rds", "db:reports-db"),
                "Engine": "postgres",
                "PubliclyAccessible": False,
                "VpcSecurityGroups": [{"VpcSecurityGroupId": "sg-db"}],
                "DBSubnetGroup": {"VpcId": VPC},
                "TagList": [{"Key": "env", "Value": "prod"}],
            }
        ]
    },
    ("dynamodb", "list-tables"): {"TableNames": ["sessions"]},
    ("elasticache", "describe-replication-groups"): {
        "ReplicationGroups": [
            {
                "ReplicationGroupId": "cart-cache",
                "ARN": CACHE,
                "MemberClusters": ["cart-cache-001", "cart-cache-002"],
            }
        ]
    },
    ("elasticache", "describe-cache-clusters"): {
        "CacheClusters": [
            {
                "CacheClusterId": f"cart-cache-00{n}",
                "ARN": ARN.format("elasticache", f"cluster:cart-cache-00{n}"),
                "ReplicationGroupId": "cart-cache",
                "Engine": "redis",
                "SecurityGroups": [{"SecurityGroupId": "sg-cache", "Status": "active"}],
            }
            for n in (1, 2)
        ]
    },
    ("s3api", "list-buckets"): {
        "Buckets": [{"Name": "shop-assets", "BucketRegion": REGION}],
        "Owner": {"ID": "abc"},
    },
    ("guardduty", "list-detectors"): {"DetectorIds": ["12abc34d567e8fa901bc2d34e56789f0"]},
}

# What it answers where it has nothing but what is in no region.
ELSEWHERE = {
    ("cloudfront", "list-distributions"): {
        "DistributionList": {
            "Items": [
                {
                    "Id": "E2QWRUHAPOMQZL",
                    "ARN": DISTRIBUTION,
                    "DomainName": "d111111abcdef8.cloudfront.net",
                    "Enabled": True,
                    "Aliases": {"Quantity": 1, "Items": ["shop.example"]},
                    "Origins": {
                        "Quantity": 3,
                        "Items": [
                            {"Id": "app", "DomainName": ALB_DNS.upper()},
                            {
                                "Id": "static",
                                "DomainName": f"shop-assets.s3.{REGION}.amazonaws.com",
                            },
                            {"Id": "elsewhere", "DomainName": "origin.example.org"},
                        ],
                    },
                },
                {
                    "Id": "EDISABLED",
                    "ARN": f"arn:aws:cloudfront::{ACCOUNT}:distribution/EDISABLED",
                    "DomainName": "d222222abcdef8.cloudfront.net",
                    "Enabled": False,
                    "Origins": {"Quantity": 0},
                },
            ]
        }
    },
}


class FakeAws:
    """Answers as the account above would, and remembers what it was asked."""

    def __init__(self, answers=None, refusing=()):
        self.answers = dict(SHOP if answers is None else answers)
        self.refusing = set(refusing)
        self.calls = []

    def __call__(self, region, service, operation, params=None):
        params = params or {}
        self.calls.append((region, service, operation, params))
        if (service, operation) in self.refusing:
            raise core.CliError(
                f"aws {service} {operation}",
                "AccessDenied",
                f"User: arn:aws:iam::{ACCOUNT}:user/ana is not authorized",
            )
        source = self.answers if region == REGION else {}
        answer = {**ELSEWHERE, **source}.get((service, operation), {})
        if region != "us-east-1" and service == "cloudfront":
            raise AssertionError("CloudFront is asked in us-east-1 only")
        return answer(params) if callable(answer) else answer


def arguments(**overrides):
    values = {"regions": [REGION], "profile": None}
    values.update(overrides)
    return Namespace(**values)


def collected(fake=None, **options):
    fake = fake or FakeAws()
    inventory = core.Inventory("aws", "shop-prod", **options)
    with contextlib.redirect_stderr(io.StringIO()):
        aws.collect(inventory, fake, arguments())
    return inventory.document(WHEN), fake


def by_id(document):
    return {resource["id"]: resource for resource in document["resources"]}


def stated(document, basis):
    return sorted(
        (relation["from"], relation["to"])
        for relation in document["relations"]
        if relation["basis"] == basis
    )


class CollectTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document, cls.fake = collected()
        cls.resources = by_id(cls.document)

    def test_each_resource_is_listed_once_as_the_kind_its_type_is(self):
        self.assertEqual(
            {name: one["type"] for name, one in self.resources.items()},
            {
                "legacy-web": "virtual-machine",
                "bastion": "virtual-machine",
                "storefront": "container",
                "checkout": "container",
                "shop-alb": "load-balancer",
                "fulfil": "serverless",
                "notify": "serverless",
                "api-handler": "serverless",
                "partners": "api-gateway",
                "mobile": "api-gateway",
                "shoppers": "auth-service",
                "order-events": "message-queue",
                "order-events-dlq": "message-queue",
                "order-placed": "event-stream",
                "orders-db": "database",
                "reports-db": "database",
                "sessions": "database",
                "cart-cache": "cache",
                "shop-assets": "storage",
                "GuardDuty": "security-monitor",
                "shop.example": "network-gateway",
            },
        )
        self.assertEqual(
            self.resources["orders-db"]["native"], "AWS::RDS::DBCluster"
        )
        self.assertEqual(self.resources["reports-db"]["native"], "AWS::RDS::DBInstance")

    def test_a_group_of_instances_is_one_piece_that_says_how_many(self):
        # The two instances of the group are not listed beside it, a stopped
        # one is not listed at all, and one on its own is.
        self.assertEqual(self.resources["legacy-web"]["members"], 2)
        self.assertEqual(
            self.resources["legacy-web"]["native"], "AWS::AutoScaling::AutoScalingGroup"
        )
        self.assertNotIn("stopped", self.resources)
        self.assertEqual(self.resources["bastion"]["native"], "AWS::EC2::Instance")
        self.assertEqual(self.resources["storefront"]["members"], 4)
        self.assertEqual(self.resources["orders-db"]["members"], 2)
        self.assertEqual(self.resources["cart-cache"]["members"], 2)

    def test_where_each_stands_is_what_the_account_says(self):
        self.assertEqual(self.resources["shop-alb"]["region"], REGION)
        # A network is called by its name where it has one.
        for name in ("shop-alb", "storefront", "legacy-web", "orders-db", "fulfil", "cart-cache"):
            self.assertEqual(self.resources[name].get("network"), "shop", name)
        for name in ("notify", "order-events", "shop-assets", "sessions", "partners"):
            self.assertNotIn("network", self.resources[name], name)
        self.assertEqual(self.resources["shop.example"]["region"], "global")

    def test_public_is_what_the_provider_states_as_reachable_from_outside(self):
        public = sorted(name for name, one in self.resources.items() if one.get("public"))
        self.assertEqual(
            public,
            # Not the bastion: it has an address of its own, but its group
            # admits anyone on 22 only, and that is not where clients enter.
            ["mobile", "partners", "shop-alb", "shop.example"],
        )

    def test_tags_come_with_each_resource_however_its_service_gives_them(self):
        self.assertEqual(self.resources["shop-alb"]["tags"], {"env": "prod"})
        self.assertEqual(
            self.resources["storefront"]["tags"], {"env": "prod", "app": "shop"}
        )
        self.assertEqual(self.resources["fulfil"]["tags"], {"env": "prod", "app": "shop"})
        self.assertEqual(self.resources["sessions"]["tags"], {"env": "prod"})
        self.assertEqual(self.resources["orders-db"]["tags"], {"env": "prod"})
        self.assertEqual(self.resources["bastion"]["tags"], {"Name": "bastion", "env": "prod"})
        self.assertNotIn("tags", self.resources["notify"])

    def test_routing_is_what_a_balancer_an_api_and_a_distribution_send_on(self):
        self.assertEqual(
            stated(self.document, "routing"),
            [
                ("mobile", "api-handler"),
                ("mobile", "shop-alb"),
                ("partners", "api-handler"),
                ("shop-alb", "checkout"),
                ("shop-alb", "legacy-web"),
                ("shop-alb", "storefront"),
                # An origin by a name of the operator's own is not followed.
                ("shop.example", "shop-alb"),
                ("shop.example", "shop-assets"),
            ],
        )
        evidence = {
            (r["from"], r["to"]): r["evidence"]
            for r in self.document["relations"]
            if r["basis"] == "routing"
        }
        self.assertEqual(evidence["shop-alb", "legacy-web"], "target group legacy")
        self.assertEqual(evidence["partners", "api-handler"], "integration GET /orders")
        self.assertEqual(evidence["shop.example", "shop-assets"], "origin static")

    def test_events_are_what_a_queue_and_a_topic_deliver(self):
        self.assertEqual(
            stated(self.document, "event"),
            [
                # A mapping that is switched off delivers nothing.
                ("order-events", "fulfil"),
                ("order-placed", "notify"),
                ("order-placed", "order-events"),
            ],
        )

    def test_what_a_resource_names_in_its_own_configuration_is_declared(self):
        self.assertEqual(
            stated(self.document, "declared"),
            [
                ("mobile", "shoppers"),
                ("order-events", "order-events-dlq"),
                ("partners", "shoppers"),
            ],
        )

    def test_a_rule_between_two_groups_is_a_permission_between_their_members(self):
        self.assertEqual(
            stated(self.document, "network"),
            [
                ("checkout", "cart-cache"),
                ("checkout", "orders-db"),
                ("checkout", "reports-db"),
                ("fulfil", "orders-db"),
                ("fulfil", "reports-db"),
                ("legacy-web", "cart-cache"),
                ("legacy-web", "orders-db"),
                ("legacy-web", "reports-db"),
                ("shop-alb", "checkout"),
                ("shop-alb", "legacy-web"),
                ("shop-alb", "storefront"),
                ("storefront", "cart-cache"),
                ("storefront", "orders-db"),
                ("storefront", "reports-db"),
            ],
        )
        rule = next(
            r
            for r in self.document["relations"]
            if (r["from"], r["to"], r["basis"]) == ("fulfil", "orders-db", "network")
        )
        self.assertEqual(
            rule["evidence"], "security group rule: shop-fn may reach shop-db on tcp/5432"
        )

    def test_nothing_that_names_the_account_is_written(self):
        text = json.dumps(self.document)
        for absent in (ACCOUNT, "arn:aws", "sg-", "i-0", VPC, "203.0.113.10", "ops@example.com"):
            self.assertNotIn(absent, text)

    def test_it_says_what_it_did_not_read(self):
        self.assertEqual(len(self.document["notes"]), 1)
        self.assertIn("function URLs", self.document["notes"][0])

    def test_every_call_is_a_read_the_collector_says_it_makes(self):
        asked = {(service, operation) for _, service, operation, _ in self.fake.calls}
        self.assertLessEqual(asked, set(aws.READS))
        for service, operation in aws.READS:
            self.assertRegex(operation, r"^(describe|list|get)-", f"{service} {operation}")
        # One permission for each read, and nothing that writes.
        self.assertEqual(len(aws.ACTIONS), len(set(aws.ACTIONS)))
        for action in aws.ACTIONS:
            self.assertRegex(action, r"^[a-z0-9-]+:(Describe|List|Get|GET)", action)

    def test_what_is_in_no_region_is_asked_once_and_in_one_place(self):
        document, fake = collected()
        asked = [
            (region, service)
            for region, service, _, _ in fake.calls
            if service == "cloudfront"
        ]
        self.assertEqual(asked, [("us-east-1", "cloudfront")])
        buckets = [params for _, service, _, params in fake.calls if service == "s3api"]
        self.assertEqual(buckets, [{"BucketRegion": REGION}])

    def test_the_example_is_what_the_collector_writes_from_these_answers(self):
        if os.environ.get("AEGIS_UPDATE_EXAMPLES"):
            EXAMPLE.parent.mkdir(parents=True, exist_ok=True)
            EXAMPLE.unlink(missing_ok=True)
            core.write(EXAMPLE, self.document)
        self.assertEqual(json.loads(EXAMPLE.read_text("utf-8")), self.document)


class EdgeTest(unittest.TestCase):
    def test_a_refused_list_is_noted_and_the_rest_is_still_read(self):
        document, _ = collected(FakeAws(refusing=[("sqs", "list-queues"), ("ecs", "list-clusters")]))
        resources = by_id(document)
        self.assertNotIn("order-events", resources)
        self.assertNotIn("storefront", resources)
        self.assertIn("shop-alb", resources)
        notes = " ".join(document["notes"])
        self.assertIn("Queues could not be read (AccessDenied).", notes)
        self.assertIn("ECS clusters could not be read (AccessDenied).", notes)
        self.assertNotIn(ACCOUNT, json.dumps(document))

    def test_with_every_list_refused_nothing_is_written(self):
        fake = FakeAws(refusing=aws.READS)
        inventory = core.Inventory("aws", "shop-prod")
        with contextlib.redirect_stderr(io.StringIO()):
            aws.collect(inventory, fake, arguments())
        with self.assertRaisesRegex(core.CollectError, "AccessDenied"):
            inventory.document(WHEN)

    def test_a_tag_that_holds_an_arn_is_not_written(self):
        # CloudFormation tags what it makes with the stack's own ARN, and
        # that names the account. The stack's name says the same and stays.
        stack = f"arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/shop/1a2b3c"
        tagged_by_a_stack = instance("i-9", "worker", ["sg-app"])
        tagged_by_a_stack["Tags"] += [
            {"Key": "aws:cloudformation:stack-id", "Value": stack},
            {"Key": "aws:cloudformation:stack-name", "Value": "shop"},
        ]
        answers = {
            ("ec2", "describe-instances"): {
                "Reservations": [{"Instances": [tagged_by_a_stack]}]
            },
            ("resourcegroupstaggingapi", "get-resources"): {
                "ResourceTagMappingList": [
                    tagged(function("fulfil"), **{"aws:cloudformation:stack-id": stack}, env="prod")
                ]
            },
            ("lambda", "list-functions"): {
                "Functions": [{"FunctionName": "fulfil", "FunctionArn": function("fulfil")}]
            },
        }
        document, _ = collected(FakeAws(answers))
        resources = by_id(document)
        self.assertEqual(
            resources["worker"]["tags"],
            {"Name": "worker", "env": "prod", "aws:cloudformation:stack-name": "shop"},
        )
        self.assertEqual(resources["fulfil"]["tags"], {"env": "prod"})
        self.assertNotIn(ACCOUNT, json.dumps(document))

    def test_a_cluster_of_kubernetes_is_one_piece(self):
        answers = {
            ("eks", "list-clusters"): {"clusters": ["platform"]},
            ("eks", "describe-cluster"): {
                "cluster": {
                    "name": "platform",
                    "arn": ARN.format("eks", "cluster/platform"),
                    "resourcesVpcConfig": {
                        "vpcId": VPC,
                        "securityGroupIds": ["sg-extra"],
                        "clusterSecurityGroupId": "sg-eks",
                    },
                    "tags": {"env": "prod"},
                }
            },
            ("rds", "describe-db-instances"): {
                "DBInstances": [
                    {
                        "DBInstanceIdentifier": "platform-db",
                        "DBInstanceArn": ARN.format("rds", "db:platform-db"),
                        "VpcSecurityGroups": [{"VpcSecurityGroupId": "sg-pdb"}],
                        "DBSubnetGroup": {"VpcId": VPC},
                    }
                ]
            },
            ("ec2", "describe-security-groups"): {
                "SecurityGroups": [
                    group("sg-eks", "eks-cluster-sg-platform"),
                    group(
                        "sg-pdb",
                        "platform-db",
                        {
                            "IpProtocol": "-1",
                            "UserIdGroupPairs": [{"GroupId": "sg-eks"}],
                            "IpRanges": [],
                        },
                        {
                            "IpProtocol": "tcp",
                            "FromPort": 8000,
                            "ToPort": 8100,
                            "UserIdGroupPairs": [{"GroupId": "sg-extra"}],
                        },
                    ),
                ]
            },
        }
        document, _ = collected(FakeAws(answers))
        resources = by_id(document)
        self.assertEqual(resources["platform"]["type"], "kubernetes-cluster")
        self.assertEqual(resources["platform"]["native"], "AWS::EKS::Cluster")
        self.assertEqual(stated(document, "network"), [("platform", "platform-db")])
        # The first rule between two pieces is the one written.
        self.assertTrue(document["relations"][0]["evidence"].endswith("on any port"))

    def test_other_kinds_of_resource_are_read_where_the_account_has_them(self):
        stream = ARN.format("kinesis", "stream/clicks")
        answers = {
            ("kinesis", "list-streams"): {
                "StreamNames": ["clicks"],
                "StreamSummaries": [{"StreamName": "clicks", "StreamARN": stream}],
            },
            ("dynamodb", "list-tables"): {"TableNames": ["clicks-by-day"]},
            ("lambda", "list-functions"): {
                "Functions": [{"FunctionName": "roll-up", "FunctionArn": function("roll-up")}]
            },
            ("lambda", "list-event-source-mappings"): {
                "EventSourceMappings": [
                    {"EventSourceArn": stream, "FunctionArn": function("roll-up")},
                    {
                        "EventSourceArn": ARN.format(
                            "dynamodb", "table/clicks-by-day/stream/2026-01-01T00:00:00.000"
                        ),
                        # A mapping may name a version or an alias of the function.
                        "FunctionArn": function("roll-up") + ":live",
                    },
                ]
            },
            ("elbv2", "describe-load-balancers"): {
                "LoadBalancers": [
                    {
                        "LoadBalancerArn": ARN.format(
                            "elasticloadbalancing", "loadbalancer/net/ingest/1a2b"
                        ),
                        "LoadBalancerName": "ingest",
                        "DNSName": "ingest-1a2b.elb.sa-east-1.amazonaws.com",
                        "Scheme": "internal",
                        "Type": "network",
                        "VpcId": VPC,
                    },
                    {
                        "LoadBalancerArn": ARN.format(
                            "elasticloadbalancing", "loadbalancer/gwy/inspect/3c4d"
                        ),
                        "LoadBalancerName": "inspect",
                        "Type": "gateway",
                    },
                ]
            },
            ("elasticache", "describe-cache-clusters"): {
                "CacheClusters": [
                    {
                        "CacheClusterId": "sessions-cache",
                        "ARN": ARN.format("elasticache", "cluster:sessions-cache"),
                        "Engine": "memcached",
                    }
                ]
            },
            ("ec2", "describe-security-groups"): {
                "SecurityGroups": [
                    group("sg-web", "web", from_anywhere(443)),
                    group(
                        "sg-any",
                        "anything",
                        {"IpProtocol": "-1", "Ipv6Ranges": [{"CidrIpv6": "::/0"}]},
                    ),
                    group("sg-ssh", "ssh", from_anywhere(22)),
                ]
            },
            ("ec2", "describe-instances"): {
                "Reservations": [
                    {
                        "Instances": [
                            instance("i-1", "web", ["sg-web"], public="203.0.113.1"),
                            instance("i-2", "open", ["sg-any"], public="203.0.113.2"),
                            instance("i-3", "jump", ["sg-ssh"], public="203.0.113.3"),
                            # Admitted, but with no address to be reached at.
                            instance("i-4", "inner", ["sg-web"]),
                        ]
                    }
                ]
            },
        }
        document, _ = collected(FakeAws(answers))
        resources = by_id(document)
        self.assertEqual(resources["clicks"]["type"], "event-stream")
        self.assertEqual(resources["ingest"]["type"], "load-balancer")
        self.assertNotIn("public", resources["ingest"])
        self.assertNotIn("inspect", resources)
        self.assertEqual(resources["sessions-cache"]["type"], "cache")
        # An instance is public with an address of its own and a group that
        # admits anyone on a port requests come to.
        self.assertEqual(
            {name: bool(resources[name].get("public")) for name in ("web", "open", "jump", "inner")},
            {"web": True, "open": True, "jump": False, "inner": False},
        )
        self.assertEqual(
            stated(document, "event"),
            [("clicks", "roll-up"), ("clicks-by-day", "roll-up")],
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
        fake = fake or FakeAws()
        shown, said = io.StringIO(), io.StringIO()
        with (
            mock.patch.object(aws, "client", return_value=fake),
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
                "aws",
                "--region",
                REGION,
                "--name",
                "shop-prod",
                "--tag",
                "env=prod",
                "--tag-key",
                "env",
                "--type",
                "legacy-web=container",
                "--relation",
                "checkout=order-events",
                "--output",
                str(output),
            )
            self.assertEqual(code, 0, shown)
            document = json.loads(output.read_text("utf-8"))
        resources = by_id(document)
        self.assertEqual(document["name"], "shop-prod")
        self.assertRegex(document["collectedAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertNotIn("notify", resources, "it carries no tag")
        self.assertEqual(resources["legacy-web"]["type"], "container")
        self.assertEqual(resources["storefront"]["tags"], {"env": "prod"})
        self.assertIn(("checkout", "order-events"), stated(document, "declared"))
        self.assertIn(f"{len(document['resources'])} resources", shown)
        self.assertIn(f"{len(document['relations'])} relations", shown)

    def test_without_a_name_the_platform_is_called_after_what_was_read(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "inventory.json"
            code, _, _, fake = self.run_main(
                "aws", "--region", REGION, "--region", "us-east-1", "--output", str(output)
            )
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(output.read_text("utf-8"))["name"], f"aws-{REGION}")
        self.assertEqual(
            sorted({region for region, _, _, _ in fake.calls}), [REGION, "us-east-1"]
        )

    def test_a_file_that_exists_is_left_alone_and_nothing_is_asked(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "inventory.json"
            output.write_text("mine", encoding="utf-8")
            code, _, said, fake = self.run_main("aws", "--region", REGION, "--output", str(output))
            self.assertEqual(code, 1)
            self.assertIn("Inventory failed: Output already exists", said)
            self.assertEqual(output.read_text("utf-8"), "mine")
        self.assertEqual(fake.calls, [])

    def test_a_declaration_that_names_nothing_stops_before_the_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "inventory.json"
            code, _, said, _ = self.run_main(
                "aws", "--region", REGION, "--type", "nobody=database", "--output", str(output)
            )
            self.assertEqual(code, 1)
            self.assertIn("nobody", said)
            self.assertFalse(output.exists())

    def test_what_is_not_a_region_or_a_profile_is_refused_before_any_call(self):
        for bad in (
            ["aws", "--region", "São Paulo", "--output", "x.json"],
            ["aws", "--region", REGION, "--profile", "--endpoint-url=http://x", "--output", "x.json"],
            ["aws", "--output", "x.json"],
            ["aws", "--region", REGION, "--type", "db=warehouse", "--output", "x.json"],
        ):
            code, _, _, fake = self.run_main(*bad)
            self.assertEqual(code, 2, bad)
            self.assertEqual(fake.calls, [])


class ClientTest(unittest.TestCase):
    def test_the_cli_is_given_a_list_and_asked_for_json_with_the_operators_profile(self):
        ran = []

        def run(command, **options):
            ran.append((command, options))
            request = Path(command[command.index("--cli-input-json") + 1].removeprefix("file://"))
            ran.append(json.loads(request.read_text("utf-8")))
            return mock.Mock(returncode=0, stdout='{"Vpcs": []}', stderr="")

        with mock.patch.object(core.subprocess, "run", side_effect=run):
            call = aws.client(arguments(profile="readonly"))
            self.assertEqual(call(REGION, "ec2", "describe-vpcs", {"MaxResults": 5}), {"Vpcs": []})
        command, options = ran[0]
        self.assertEqual(command[:3], ["aws", "ec2", "describe-vpcs"])
        self.assertEqual(command[command.index("--region") + 1], REGION)
        self.assertEqual(command[command.index("--profile") + 1], "readonly")
        self.assertEqual(command[command.index("--output") + 1], "json")
        self.assertIn("--no-cli-pager", command)
        self.assertNotIn("shell", options)
        self.assertEqual(ran[1], {"MaxResults": 5})

    def test_a_refusal_is_named_by_the_providers_code(self):
        refused = mock.Mock(
            returncode=254,
            stdout="",
            stderr="\nAn error occurred (AccessDenied) when calling the ListQueues operation: "
            f"User: arn:aws:iam::{ACCOUNT}:user/ana is not authorized",
        )
        with mock.patch.object(core.subprocess, "run", return_value=refused):
            with self.assertRaises(core.CliError) as raised:
                aws.client(arguments())(REGION, "sqs", "list-queues")
        self.assertEqual(raised.exception.code, "AccessDenied")
        self.assertEqual(raised.exception.command, "aws sqs list-queues")

    def test_without_the_cli_the_operator_is_told_so(self):
        with mock.patch.object(core.subprocess, "run", side_effect=FileNotFoundError):
            with self.assertRaisesRegex(core.CollectError, "not installed"):
                aws.client(arguments())(REGION, "ec2", "describe-vpcs")


if __name__ == "__main__":
    unittest.main()
