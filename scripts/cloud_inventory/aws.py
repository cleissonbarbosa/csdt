"""Reads an AWS account through the AWS CLI v2.

Every call is one of `READS`: a describe, a list or a get, made with the
profile the operator names or the CLI's default credential chain. The CLI
joins the pages of a list itself. What a call answers is looked at for the
fields named here and nothing else of it is kept.

A resource is listed once: the instances of an Auto Scaling group as the
group, the members of a database cluster as the cluster, the tasks of an ECS
service as the service. A connection is written only where the account
states one, and says what states it.
"""

import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory

from . import core

NAME = "aws"
HELP = "Amazon Web Services, through the AWS CLI v2"

# Every operation the collector may call. A test holds what it calls to this.
READS = (
    ("resourcegroupstaggingapi", "get-resources"),
    ("ec2", "describe-vpcs"),
    ("ec2", "describe-security-groups"),
    ("ec2", "describe-instances"),
    ("autoscaling", "describe-auto-scaling-groups"),
    ("elbv2", "describe-load-balancers"),
    ("elbv2", "describe-target-groups"),
    ("elbv2", "describe-target-health"),
    ("ecs", "list-clusters"),
    ("ecs", "list-services"),
    ("ecs", "describe-services"),
    ("eks", "list-clusters"),
    ("eks", "describe-cluster"),
    ("lambda", "list-functions"),
    ("lambda", "list-event-source-mappings"),
    ("apigateway", "get-rest-apis"),
    ("apigateway", "get-resources"),
    ("apigateway", "get-authorizers"),
    ("apigatewayv2", "get-apis"),
    ("apigatewayv2", "get-integrations"),
    ("apigatewayv2", "get-authorizers"),
    ("cognito-idp", "list-user-pools"),
    ("sqs", "list-queues"),
    ("sqs", "get-queue-attributes"),
    ("sns", "list-topics"),
    ("sns", "list-subscriptions"),
    ("rds", "describe-db-clusters"),
    ("rds", "describe-db-instances"),
    ("dynamodb", "list-tables"),
    ("elasticache", "describe-replication-groups"),
    ("elasticache", "describe-cache-clusters"),
    ("kinesis", "list-streams"),
    ("s3api", "list-buckets"),
    ("guardduty", "list-detectors"),
    ("cloudfront", "list-distributions"),
)

# The permissions those calls need, for a least-privilege policy. The two
# API Gateway services are read through one action, `apigateway:GET`.
ACTIONS = (
    "tag:GetResources",
    "ec2:DescribeVpcs",
    "ec2:DescribeSecurityGroups",
    "ec2:DescribeInstances",
    "autoscaling:DescribeAutoScalingGroups",
    "elasticloadbalancing:DescribeLoadBalancers",
    "elasticloadbalancing:DescribeTargetGroups",
    "elasticloadbalancing:DescribeTargetHealth",
    "ecs:ListClusters",
    "ecs:ListServices",
    "ecs:DescribeServices",
    "eks:ListClusters",
    "eks:DescribeCluster",
    "lambda:ListFunctions",
    "lambda:ListEventSourceMappings",
    "apigateway:GET",
    "cognito-idp:ListUserPools",
    "sqs:ListQueues",
    "sqs:GetQueueAttributes",
    "sns:ListTopics",
    "sns:ListSubscriptions",
    "rds:DescribeDBClusters",
    "rds:DescribeDBInstances",
    "dynamodb:ListTables",
    "elasticache:DescribeReplicationGroups",
    "elasticache:DescribeCacheClusters",
    "kinesis:ListStreams",
    "s3:ListAllMyBuckets",
    "guardduty:ListDetectors",
    "cloudfront:ListDistributions",
)

# Resource types whose own list does not give their tags.
TAGGED = [
    "elasticloadbalancing:loadbalancer",
    "lambda:function",
    "sqs:queue",
    "sns:topic",
    "dynamodb:table",
    "elasticache:replicationgroup",
    "elasticache:cluster",
    "kinesis:stream",
    "cognito-idp:userpool",
    "s3:bucket",
]

# Where what is in no region is asked.
GLOBAL_ENDPOINT = "us-east-1"
NOT_READ = (
    "Not read: Lambda function URLs, EventBridge rules, Step Functions, what "
    "runs inside an EKS cluster, and an origin or an integration named by a "
    "DNS name of the operator's own. Declare such a connection with --relation."
)
# How the CLI names a refusal.
REFUSALS = (
    r"An error occurred \((\w+)\)",
    r"(Parameter validation failed)",
    r"(Unable to locate credentials)",
    r"(Could not connect to the endpoint URL)",
)


def region_code(value):
    if not re.fullmatch(r"[a-z][a-z0-9-]{1,63}", value):
        raise core.argparse.ArgumentTypeError(
            f"expected an AWS region code, such as sa-east-1; got {value!r}"
        )
    return value


def arguments(parser):
    parser.add_argument(
        "--profile",
        type=core.plain,
        help="AWS CLI profile to use; without it, the CLI's default credential chain",
    )
    parser.add_argument(
        "--region",
        dest="regions",
        action="append",
        type=region_code,
        required=True,
        help="Region to read; repeat to read several into one inventory",
    )


def default_name(args):
    return f"aws-{args.regions[0]}"


def client(args):
    """A `call(region, service, operation, params)` that runs the AWS CLI."""

    def call(region, service, operation, params=None):
        with TemporaryDirectory() as directory:
            request = Path(directory) / "request.json"
            request.write_text(json.dumps(params or {}), encoding="utf-8")
            command = [
                "aws",
                service,
                operation,
                "--region",
                region,
                "--no-cli-pager",
                "--output",
                "json",
                "--cli-input-json",
                f"file://{request}",
            ]
            if args.profile:
                command.extend(["--profile", args.profile])
            return core.run(command, REFUSALS, f"aws {service} {operation}")

    return call


# ---------------------------------------------------------------------------
# Reading what the CLI answered
# ---------------------------------------------------------------------------


def tag_map(tags, key="Key", value="Value"):
    """Tags as a mapping, from the list of pairs most services answer with.

    A tag whose value is an ARN is left out: it names the account. AWS adds
    some itself (`aws:cloudformation:stack-id`), and the name beside it says
    the same without the account.
    """
    if isinstance(tags, dict):
        pairs = tags.items()
    else:
        pairs = ((tag.get(key), tag.get(value, "")) for tag in tags or [])
    return {
        name: written
        for name, written in pairs
        if name and "arn:aws" not in str(written)
    }


def base_function(arn):
    """A function's ARN without the version or alias a caller may name."""
    return ":".join(arn.split(":")[:7])


def ports(permission):
    protocol = permission.get("IpProtocol", "-1")
    if protocol == "-1":
        return "any port"
    low, high = permission.get("FromPort"), permission.get("ToPort")
    if low is None or high is None:
        return protocol
    return f"{protocol}/{low}" if low == high else f"{protocol}/{low}-{high}"


def open_to_requests(permission):
    """Whether a rule admits anyone on a port requests come to: 80 or 443."""
    anyone = any(
        one.get("CidrIp") == "0.0.0.0/0" for one in permission.get("IpRanges", [])
    ) or any(one.get("CidrIpv6") == "::/0" for one in permission.get("Ipv6Ranges", []))
    if not anyone:
        return False
    if permission.get("IpProtocol", "-1") == "-1":
        return True
    low, high = permission.get("FromPort"), permission.get("ToPort")
    if low is None or high is None:
        return False
    return any(low <= port <= high for port in (80, 443))


def chunks(items, size):
    for start in range(0, len(items), size):
        yield items[start : start + size]


class Account:
    """What one region's reads tell the next: how a name elsewhere resolves."""

    def __init__(self):
        # A balancer's or an API's own DNS name, to the key it was added under.
        self.by_dns = {}
        self.buckets = {}

    def origin(self, domain):
        """The resource a distribution's origin names, where it names one."""
        domain = domain.lower().rstrip(".")
        if domain in self.by_dns:
            return self.by_dns[domain]
        bucket = re.match(r"^(.+?)\.s3[.-]", domain)
        return self.buckets.get(bucket.group(1)) if bucket else None


def collect(inventory, call, args):
    account = Account()
    for region in args.regions:
        Region(inventory, call, region, account).read()
    read_distributions(inventory, call, account)
    inventory.note(NOT_READ)


class Region:
    def __init__(self, inventory, call, region, account):
        self.inventory = inventory
        self.call = call
        self.region = region
        self.account = account
        self.tags = {}
        self.vpcs = {}
        self.group_names = {}
        self.group_vpcs = {}
        self.open_groups = set()
        # An instance, to the group that stands for it.
        self.in_group = {}
        # A target group, to what registered with it by its own configuration.
        self.registered = {}

    def ask(self, what, service, operation, params=None):
        """One read. A refusal is noted, and answered as nothing found."""
        return (
            self.inventory.attempt(
                what, lambda: self.call(self.region, service, operation, params or {})
            )
            or {}
        )

    def add(self, key, **resource):
        return self.inventory.add(key, region=self.region, **resource)

    def network(self, vpc):
        return self.vpcs.get(vpc, vpc) if vpc else None

    def network_of(self, groups):
        """The network a resource is in, by the groups it is a member of."""
        for group in groups:
            if self.group_vpcs.get(group):
                return self.network(self.group_vpcs[group])
        return None

    def tags_of(self, arn):
        return self.tags.get(arn, {})

    def read(self):
        self.read_tags()
        self.read_networks()
        self.read_instances()
        self.read_containers()
        self.read_balancers()
        self.read_functions()
        self.read_apis()
        self.read_messaging()
        self.read_stores()
        self.read_monitor()

    def read_tags(self):
        mappings = self.ask(
            "Tags", "resourcegroupstaggingapi", "get-resources", {"ResourceTypeFilters": TAGGED}
        )
        for mapping in mappings.get("ResourceTagMappingList", []):
            self.tags[mapping["ResourceARN"]] = tag_map(mapping.get("Tags"))

    def read_networks(self):
        for vpc in self.ask("Networks", "ec2", "describe-vpcs").get("Vpcs", []):
            self.vpcs[vpc["VpcId"]] = tag_map(vpc.get("Tags")).get("Name") or vpc["VpcId"]
        groups = self.ask("Security groups", "ec2", "describe-security-groups").get(
            "SecurityGroups", []
        )
        for group in groups:
            self.group_names[group["GroupId"]] = group.get("GroupName") or group["GroupId"]
            self.group_vpcs[group["GroupId"]] = group.get("VpcId")
        for group in groups:
            target = group["GroupId"]
            for permission in group.get("IpPermissions", []):
                if open_to_requests(permission):
                    self.open_groups.add(target)
                for pair in permission.get("UserIdGroupPairs", []):
                    source = pair.get("GroupId")
                    if source and source != target:
                        self.inventory.admit(
                            source,
                            target,
                            f"security group rule: {self.group_names.get(source, 'a group')} "
                            f"may reach {self.group_names[target]} on {ports(permission)}",
                        )

    def read_instances(self):
        instances = {}
        reservations = self.ask("Instances", "ec2", "describe-instances").get("Reservations", [])
        for reservation in reservations:
            for instance in reservation.get("Instances", []):
                if instance.get("State", {}).get("Name") == "running":
                    instances[instance["InstanceId"]] = instance

        def groups_of(instance):
            return [group["GroupId"] for group in instance.get("SecurityGroups", [])]

        scaling = self.ask("Auto Scaling groups", "autoscaling", "describe-auto-scaling-groups")
        for group in scaling.get("AutoScalingGroups", []):
            key = group["AutoScalingGroupARN"]
            members = [member["InstanceId"] for member in group.get("Instances", [])]
            running = [instances[member] for member in members if member in instances]
            security = sorted({one for instance in running for one in groups_of(instance)})
            self.add(
                key,
                name=group["AutoScalingGroupName"],
                kind="virtual-machine",
                native="AWS::AutoScaling::AutoScalingGroup",
                network=self.network(running[0].get("VpcId")) if running else None,
                tags=tag_map(group.get("Tags")),
                members=len(members),
                groups=security,
            )
            for member in members:
                self.in_group[member] = key
            for target_group in group.get("TargetGroupARNs", []):
                self.registered.setdefault(target_group, []).append(key)

        for instance_id, instance in instances.items():
            if instance_id in self.in_group:
                continue
            tags = tag_map(instance.get("Tags"))
            security = groups_of(instance)
            self.add(
                instance_id,
                name=tags.get("Name") or instance_id,
                kind="virtual-machine",
                native="AWS::EC2::Instance",
                network=self.network(instance.get("VpcId")),
                tags=tags,
                # Reachable from outside: an address of its own, and a group
                # that admits anyone on a port requests come to. A bastion
                # that admits anyone on 22 is not where clients enter.
                public=bool(instance.get("PublicIpAddress"))
                and any(group in self.open_groups for group in security),
                groups=security,
            )

    def read_containers(self):
        for cluster in self.ask("ECS clusters", "ecs", "list-clusters").get("clusterArns", []):
            listed = self.ask("ECS services", "ecs", "list-services", {"cluster": cluster})
            # `describe-services` takes ten at a time.
            for some in chunks(listed.get("serviceArns", []), 10):
                described = self.ask(
                    "ECS services",
                    "ecs",
                    "describe-services",
                    {"cluster": cluster, "services": some, "include": ["TAGS"]},
                )
                for service in described.get("services", []):
                    self.add_service(service)

        for name in self.ask("EKS clusters", "eks", "list-clusters").get("clusters", []):
            cluster = self.ask("EKS clusters", "eks", "describe-cluster", {"name": name}).get(
                "cluster"
            )
            if not cluster:
                continue
            placed = cluster.get("resourcesVpcConfig", {})
            security = [placed.get("clusterSecurityGroupId"), *placed.get("securityGroupIds", [])]
            self.add(
                cluster["arn"],
                name=cluster["name"],
                kind="kubernetes-cluster",
                native="AWS::EKS::Cluster",
                network=self.network(placed.get("vpcId")),
                tags=tag_map(cluster.get("tags")),
                groups=[group for group in security if group],
            )

    def add_service(self, service):
        key = service["serviceArn"]
        placed = service.get("networkConfiguration", {}).get("awsvpcConfiguration", {})
        security = placed.get("securityGroups", [])
        self.add(
            key,
            name=service["serviceName"],
            kind="container",
            native="AWS::ECS::Service",
            network=self.network_of(security),
            tags=tag_map(service.get("tags"), "key", "value"),
            members=service.get("desiredCount"),
            groups=security,
        )
        for balancer in service.get("loadBalancers", []):
            if balancer.get("targetGroupArn"):
                self.registered.setdefault(balancer["targetGroupArn"], []).append(key)

    def read_balancers(self):
        balancers = self.ask("Load balancers", "elbv2", "describe-load-balancers")
        for balancer in balancers.get("LoadBalancers", []):
            kind = {"application": "load-balancer", "network": "load-balancer"}.get(
                balancer.get("Type")
            )
            if not kind:
                continue
            key = balancer["LoadBalancerArn"]
            self.add(
                key,
                name=balancer["LoadBalancerName"],
                kind=kind,
                native="AWS::ElasticLoadBalancingV2::LoadBalancer",
                network=self.network(balancer.get("VpcId")),
                tags=self.tags_of(key),
                public=balancer.get("Scheme") == "internet-facing",
                groups=balancer.get("SecurityGroups", []),
            )
            if balancer.get("DNSName"):
                self.account.by_dns[balancer["DNSName"].lower()] = key

        groups = self.ask("Target groups", "elbv2", "describe-target-groups")
        for group in groups.get("TargetGroups", []):
            arn = group["TargetGroupArn"]
            balancers = group.get("LoadBalancerArns", [])
            if not balancers:
                continue
            targets = list(self.registered.get(arn, []))
            # An address is not a resource; an instance, a function and
            # another balancer are, and the group's health names them.
            if group.get("TargetType") in ("instance", "lambda", "alb"):
                health = self.ask(
                    "Target groups", "elbv2", "describe-target-health", {"TargetGroupArn": arn}
                )
                for described in health.get("TargetHealthDescriptions", []):
                    target = described.get("Target", {}).get("Id", "")
                    if ":function:" in target:
                        target = base_function(target)
                    targets.append(self.in_group.get(target, target))
            for balancer in balancers:
                for target in dict.fromkeys(targets):
                    self.inventory.relate(
                        balancer, target, "routing", f"target group {group['TargetGroupName']}"
                    )

    def read_functions(self):
        functions = self.ask("Functions", "lambda", "list-functions").get("Functions", [])
        for function in functions:
            key = function["FunctionArn"]
            placed = function.get("VpcConfig") or {}
            self.add(
                key,
                name=function["FunctionName"],
                kind="serverless",
                native="AWS::Lambda::Function",
                network=self.network(placed.get("VpcId")),
                tags=self.tags_of(key),
                groups=placed.get("SecurityGroupIds", []),
            )
        mappings = self.ask("Event source mappings", "lambda", "list-event-source-mappings")
        for mapping in mappings.get("EventSourceMappings", []):
            source, function = mapping.get("EventSourceArn"), mapping.get("FunctionArn")
            if source and function and mapping.get("State", "Enabled") != "Disabled":
                self.inventory.relate(
                    self.source_key(source),
                    base_function(function),
                    "event",
                    "event source mapping",
                )

    def source_key(self, arn):
        """What an event source names: a table by its stream, anything else by its ARN."""
        stream = re.match(r"^arn:[^:]+:dynamodb:[^:]+:[^:]+:table/([^/]+)/stream/", arn)
        return self.table_key(stream.group(1)) if stream else arn

    def table_key(self, name):
        return ("dynamodb", self.region, name)

    def pool_key(self, pool_id):
        return ("cognito", pool_id)

    def integration(self, uri):
        """The resource an API's integration names, where it names one."""
        function = re.search(r"(arn:[^:]+:lambda:[^:]+:[^:]+:function:[^/:]+)", uri)
        if function:
            return function.group(1)
        # Through a VPC link an HTTP API names a balancer's listener.
        listener = re.match(r"^(arn:[^:]+:elasticloadbalancing:[^:]+:[^:]+):listener/(.+)/[^/]+$", uri)
        if listener:
            return f"{listener.group(1)}:loadbalancer/{listener.group(2)}"
        host = re.match(r"^https?://([^/:]+)", uri)
        return self.account.by_dns.get(host.group(1).lower()) if host else None

    def read_apis(self):
        pools = self.ask("User pools", "cognito-idp", "list-user-pools", {"MaxResults": 60})
        for pool in pools.get("UserPools", []):
            arn = next((arn for arn in self.tags if arn.endswith(f"userpool/{pool['Id']}")), None)
            self.add(
                self.pool_key(pool["Id"]),
                name=pool.get("Name") or pool["Id"],
                kind="auth-service",
                native="AWS::Cognito::UserPool",
                tags=self.tags_of(arn),
            )

        for api in self.ask("REST APIs", "apigateway", "get-rest-apis").get("items", []):
            key = ("apigateway", self.region, api["id"])
            kinds = api.get("endpointConfiguration", {}).get("types", [])
            self.add(
                key,
                name=api.get("name") or api["id"],
                kind="api-gateway",
                native="AWS::ApiGateway::RestApi",
                tags=tag_map(api.get("tags")),
                public="PRIVATE" not in kinds,
            )
            self.account.by_dns[f"{api['id']}.execute-api.{self.region}.amazonaws.com"] = key
            resources = self.ask(
                "REST API integrations",
                "apigateway",
                "get-resources",
                {"restApiId": api["id"], "embed": ["methods"]},
            )
            for resource in resources.get("items", []):
                for verb, method in (resource.get("resourceMethods") or {}).items():
                    uri = (method.get("methodIntegration") or {}).get("uri") or ""
                    target = self.integration(uri)
                    if target:
                        self.inventory.relate(
                            key, target, "routing", f"integration {verb} {resource.get('path')}"
                        )
            authorizers = self.ask(
                "REST API authorizers", "apigateway", "get-authorizers", {"restApiId": api["id"]}
            )
            for authorizer in authorizers.get("items", []):
                self.authorized_by(
                    key,
                    authorizer.get("name"),
                    [arn.rsplit("/", 1)[-1] for arn in authorizer.get("providerARNs") or []],
                    authorizer.get("authorizerUri"),
                )

        for api in self.ask("HTTP APIs", "apigatewayv2", "get-apis").get("Items", []):
            key = ("apigatewayv2", self.region, api["ApiId"])
            self.add(
                key,
                name=api.get("Name") or api["ApiId"],
                kind="api-gateway",
                native="AWS::ApiGatewayV2::Api",
                tags=tag_map(api.get("Tags")),
                public=not api.get("DisableExecuteApiEndpoint", False),
            )
            self.account.by_dns[f"{api['ApiId']}.execute-api.{self.region}.amazonaws.com"] = key
            integrations = self.ask(
                "HTTP API integrations", "apigatewayv2", "get-integrations", {"ApiId": api["ApiId"]}
            )
            for integration in integrations.get("Items", []):
                target = self.integration(integration.get("IntegrationUri") or "")
                if target:
                    self.inventory.relate(key, target, "routing", "integration")
            authorizers = self.ask(
                "HTTP API authorizers", "apigatewayv2", "get-authorizers", {"ApiId": api["ApiId"]}
            )
            for authorizer in authorizers.get("Items", []):
                issuer = (authorizer.get("JwtConfiguration") or {}).get("Issuer") or ""
                pool = re.search(r"cognito-idp\.[^/]+/([\w-]+)$", issuer)
                self.authorized_by(
                    key,
                    authorizer.get("Name"),
                    [pool.group(1)] if pool else [],
                    authorizer.get("AuthorizerUri"),
                )

    def authorized_by(self, api, name, pools, uri):
        """An API's authorizer names what it asks: a user pool, or a function."""
        evidence = f"authorizer {name}" if name else "authorizer"
        for pool in pools:
            self.inventory.relate(api, self.pool_key(pool), "declared", evidence)
        function = self.integration(uri or "")
        if function:
            self.inventory.relate(api, function, "declared", evidence)

    def read_messaging(self):
        for url in self.ask("Queues", "sqs", "list-queues").get("QueueUrls", []):
            attributes = self.ask(
                "Queues",
                "sqs",
                "get-queue-attributes",
                {"QueueUrl": url, "AttributeNames": ["QueueArn", "RedrivePolicy"]},
            ).get("Attributes", {})
            key = attributes.get("QueueArn")
            if not key:
                continue
            self.add(
                key,
                name=url.rsplit("/", 1)[-1],
                kind="message-queue",
                native="AWS::SQS::Queue",
                tags=self.tags_of(key),
            )
            try:
                dead = json.loads(attributes.get("RedrivePolicy") or "{}").get(
                    "deadLetterTargetArn"
                )
            except ValueError:
                dead = None
            if dead:
                self.inventory.relate(key, dead, "declared", "redrive policy")

        for topic in self.ask("Topics", "sns", "list-topics").get("Topics", []):
            key = topic["TopicArn"]
            self.add(
                key,
                name=key.rsplit(":", 1)[-1],
                kind="event-stream",
                native="AWS::SNS::Topic",
                tags=self.tags_of(key),
            )
        subscriptions = self.ask("Subscriptions", "sns", "list-subscriptions")
        for subscription in subscriptions.get("Subscriptions", []):
            endpoint = subscription.get("Endpoint") or ""
            if subscription.get("Protocol") == "lambda":
                endpoint = base_function(endpoint)
            if subscription.get("Protocol") in ("sqs", "lambda"):
                self.inventory.relate(subscription["TopicArn"], endpoint, "event", "subscription")

        streams = self.ask("Streams", "kinesis", "list-streams")
        for stream in streams.get("StreamSummaries", []):
            self.add(
                stream["StreamARN"],
                name=stream["StreamName"],
                kind="event-stream",
                native="AWS::Kinesis::Stream",
                tags=self.tags_of(stream["StreamARN"]),
            )

    def read_stores(self):
        def security(described):
            return [group["VpcSecurityGroupId"] for group in described.get("VpcSecurityGroups", [])]

        for cluster in self.ask("Database clusters", "rds", "describe-db-clusters").get(
            "DBClusters", []
        ):
            self.add(
                cluster["DBClusterArn"],
                name=cluster["DBClusterIdentifier"],
                kind="database",
                native="AWS::RDS::DBCluster",
                network=self.network_of(security(cluster)),
                tags=tag_map(cluster.get("TagList")),
                members=len(cluster.get("DBClusterMembers", [])),
                groups=security(cluster),
            )
        for instance in self.ask("Databases", "rds", "describe-db-instances").get(
            "DBInstances", []
        ):
            # A member of a cluster is the cluster.
            if instance.get("DBClusterIdentifier"):
                continue
            self.add(
                instance["DBInstanceArn"],
                name=instance["DBInstanceIdentifier"],
                kind="database",
                native="AWS::RDS::DBInstance",
                network=self.network((instance.get("DBSubnetGroup") or {}).get("VpcId")),
                tags=tag_map(instance.get("TagList")),
                groups=security(instance),
            )

        for name in self.ask("Tables", "dynamodb", "list-tables").get("TableNames", []):
            arn = next(
                (
                    arn
                    for arn in self.tags
                    if arn.endswith(f":table/{name}") and f":dynamodb:{self.region}:" in arn
                ),
                None,
            )
            self.add(
                self.table_key(name),
                name=name,
                kind="database",
                native="AWS::DynamoDB::Table",
                tags=self.tags_of(arn),
            )

        caches = self.ask("Caches", "elasticache", "describe-cache-clusters").get(
            "CacheClusters", []
        )
        in_replication = {}
        for cache in caches:
            if cache.get("ReplicationGroupId"):
                in_replication.setdefault(cache["ReplicationGroupId"], []).append(cache)

        def cache_groups(some):
            return sorted(
                {
                    group["SecurityGroupId"]
                    for cache in some
                    for group in cache.get("SecurityGroups", [])
                }
            )

        replicated = self.ask("Caches", "elasticache", "describe-replication-groups")
        for group in replicated.get("ReplicationGroups", []):
            members = in_replication.get(group["ReplicationGroupId"], [])
            security_groups = cache_groups(members)
            self.add(
                group["ARN"],
                name=group["ReplicationGroupId"],
                kind="cache",
                native="AWS::ElastiCache::ReplicationGroup",
                network=self.network_of(security_groups),
                tags=self.tags_of(group["ARN"]),
                members=len(group.get("MemberClusters", [])),
                groups=security_groups,
            )
        for cache in caches:
            if cache.get("ReplicationGroupId"):
                continue
            security_groups = cache_groups([cache])
            self.add(
                cache["ARN"],
                name=cache["CacheClusterId"],
                kind="cache",
                native="AWS::ElastiCache::CacheCluster",
                network=self.network_of(security_groups),
                tags=self.tags_of(cache["ARN"]),
                groups=security_groups,
            )

        # Asked of this region's endpoint, the list is of this region's buckets.
        buckets = self.ask("Buckets", "s3api", "list-buckets", {"BucketRegion": self.region})
        for bucket in buckets.get("Buckets", []):
            if bucket.get("BucketRegion", self.region) != self.region:
                continue
            key = f"arn:aws:s3:::{bucket['Name']}"
            self.add(
                key,
                name=bucket["Name"],
                kind="storage",
                native="AWS::S3::Bucket",
                tags=self.tags_of(key),
            )
            self.account.buckets[bucket["Name"].lower()] = key

    def read_monitor(self):
        if self.ask("Threat detection", "guardduty", "list-detectors").get("DetectorIds"):
            self.add(
                ("guardduty", self.region),
                name="GuardDuty",
                kind="security-monitor",
                native="AWS::GuardDuty::Detector",
            )


def read_distributions(inventory, call, account):
    """CloudFront is in no region: asked once, after what its origins name."""
    answer = inventory.attempt(
        "Distributions", lambda: call(GLOBAL_ENDPOINT, "cloudfront", "list-distributions", {})
    )
    for distribution in ((answer or {}).get("DistributionList") or {}).get("Items") or []:
        if not distribution.get("Enabled", True):
            continue
        key = distribution["ARN"]
        aliases = (distribution.get("Aliases") or {}).get("Items") or []
        inventory.add(
            key,
            name=aliases[0] if aliases else distribution["DomainName"],
            kind="network-gateway",
            native="AWS::CloudFront::Distribution",
            region=core.EDGE_REGION,
            public=True,
        )
        for origin in (distribution.get("Origins") or {}).get("Items") or []:
            target = account.origin(origin.get("DomainName") or "")
            if target:
                inventory.relate(key, target, "routing", f"origin {origin.get('Id')}")
