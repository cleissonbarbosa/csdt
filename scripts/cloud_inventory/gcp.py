"""Reads a Google Cloud project through the gcloud CLI.

Every call is one of `READS`: a list, made as whoever gcloud is signed in
as, or with the named configuration the operator gives. `--format=json`
prints each resource as its API gives it, and gcloud joins the pages of a
list itself. `--quiet` keeps it from asking anything, an offer to enable an
API included: with it gcloud takes the answer that changes nothing. What a
call answers is looked at for the fields named here and nothing else of it
is kept.

A resource is listed once: the instances of a managed instance group as the
group, the node pools of a GKE cluster as the cluster, the Cloud Run service
a function runs as as the function, and a load balancer as the URL map or
the backend service its forwarding rules lead to. A connection is written
only where the project states one, and says what states it.

Nothing that names the project is written: a resource is called by its own
name and never by its link, and no address and no service account is kept.
A name that was given the project's id as a part of it, as buckets often
are, is still the resource's name and is written as it is.
"""

import re

from . import core

NAME = "gcp"
HELP = "Google Cloud, through the gcloud CLI"

FIREWALL_RULES = ("compute", "firewall-rules", "list")
CLUSTERS = ("container", "clusters", "list")
INSTANCE_GROUPS = ("compute", "instance-groups", "managed", "list")
INSTANCES = ("compute", "instances", "list")
FUNCTIONS = ("functions", "list")
SERVICES = ("run", "services", "list")
TOPICS = ("pubsub", "topics", "list")
SUBSCRIPTIONS = ("pubsub", "subscriptions", "list")
SQL = ("sql", "instances", "list")
REDIS = ("redis", "instances", "list")
SPANNER = ("spanner", "instances", "list")
FIRESTORE = ("firestore", "databases", "list")
BUCKETS = ("storage", "buckets", "list")
FORWARDING_RULES = ("compute", "forwarding-rules", "list")
HTTP_PROXIES = ("compute", "target-http-proxies", "list")
HTTPS_PROXIES = ("compute", "target-https-proxies", "list")
URL_MAPS = ("compute", "url-maps", "list")
BACKEND_SERVICES = ("compute", "backend-services", "list")
BACKEND_BUCKETS = ("compute", "backend-buckets", "list")
ENDPOINT_GROUPS = ("compute", "network-endpoint-groups", "list")

# Every command the collector may run. A test holds what it runs to this.
READS = (
    FIREWALL_RULES,
    CLUSTERS,
    INSTANCE_GROUPS,
    INSTANCES,
    FUNCTIONS,
    SERVICES,
    TOPICS,
    SUBSCRIPTIONS,
    SQL,
    REDIS,
    SPANNER,
    FIRESTORE,
    BUCKETS,
    FORWARDING_RULES,
    HTTP_PROXIES,
    HTTPS_PROXIES,
    URL_MAPS,
    BACKEND_SERVICES,
    BACKEND_BUCKETS,
    ENDPOINT_GROUPS,
)

# What grants those reads and no more than viewing: a predefined role for
# each service that has one which reads no data.
ROLES = (
    "roles/compute.viewer",
    "roles/container.clusterViewer",
    "roles/cloudfunctions.viewer",
    "roles/run.viewer",
    "roles/pubsub.viewer",
    "roles/cloudsql.viewer",
    "roles/redis.viewer",
    "roles/spanner.viewer",
    "roles/storage.bucketViewer",
)
# Firestore's viewer role reads the documents too. Listing its databases
# takes this one permission, in a custom role.
PERMISSIONS = ("datastore.databases.list",)

NOT_READ = (
    "Not read: Identity Platform, API Gateway and Apigee and what they send "
    "on to, App Engine, Eventarc triggers other than a function's own, Cloud "
    "Tasks and Scheduler, Security Command Center, proxy Network Load "
    "Balancers, the instances of a target pool and of an unmanaged instance "
    "group, the endpoints of a zonal network endpoint group, firewall "
    "policies and rules that deny, and what runs inside a GKE cluster. "
    "Declare such a connection with --relation."
)
NO_REGION = (
    "Memorystore for Redis is listed region by region and no --region was "
    "given: it was not read."
)

# The statuses an API answers with: the names of google.rpc.Code.
STATUSES = (
    "CANCELLED",
    "UNKNOWN",
    "INVALID_ARGUMENT",
    "DEADLINE_EXCEEDED",
    "NOT_FOUND",
    "ALREADY_EXISTS",
    "PERMISSION_DENIED",
    "UNAUTHENTICATED",
    "RESOURCE_EXHAUSTED",
    "FAILED_PRECONDITION",
    "ABORTED",
    "OUT_OF_RANGE",
    "UNIMPLEMENTED",
    "INTERNAL",
    "UNAVAILABLE",
    "DATA_LOSS",
)
# How gcloud names a refusal.
REFUSALS = (
    # The reason among the error's details, where gcloud prints them under
    # the message: `reason: SERVICE_DISABLED`.
    r"(?m)^\s*reason: ([A-Z][A-Z0-9_]*[A-Z0-9])\s*$",
    # `ERROR: (gcloud.pubsub.topics.list) PERMISSION_DENIED: ...`
    rf"\b({'|'.join(STATUSES)}): ",
    # Where the API answered with no status, gcloud names the HTTP one.
    r"\b(HTTPError \d{3})\b",
)
# What gcloud says where it names no status at all, as Compute Engine's
# lists and its own sign-in do, and the status that is.
SENTENCES = (
    (r"before or it is disabled", "SERVICE_DISABLED"),
    (r"Required '[\w.]+' permission for", "PERMISSION_DENIED"),
    (r"does not have permission to access", "PERMISSION_DENIED"),
    (r"do not currently have an active account selected", "UNAUTHENTICATED"),
    (r"does not have any valid credentials", "UNAUTHENTICATED"),
    (r"problem refreshing your current auth tokens", "UNAUTHENTICATED"),
    (r"Reauthentication (?:failed|required)", "UNAUTHENTICATED"),
)
# What a refusal is called when none of `REFUSALS` finds its name.
UNNAMED = core.code_of("", ())

# Where a Cloud Run service says its region is, among its labels.
LOCATION = "cloud.googleapis.com/location"
INGRESS = "run.googleapis.com/ingress"
INGRESS_STATUS = "run.googleapis.com/ingress-status"
CLOUD_SQL = "run.googleapis.com/cloudsql-instances"
# The source ranges that are anyone.
ANYONE = {"0.0.0.0/0", "::/0"}
GLOBAL = "global"


def region_code(value):
    if not re.fullmatch(r"[a-z][a-z0-9-]{1,63}", value):
        raise core.argparse.ArgumentTypeError(
            f"expected a Google Cloud region, such as southamerica-east1; got {value!r}"
        )
    return value


def arguments(parser):
    parser.add_argument(
        "--project",
        type=core.plain,
        required=True,
        help="Project to read, by its id. It is not written to the file",
    )
    parser.add_argument(
        "--region",
        dest="regions",
        action="append",
        type=region_code,
        default=[],
        help="Keep only this region and what is in none; repeat for several. "
        "Without it every region is kept, and Memorystore is not read",
    )
    parser.add_argument(
        "--configuration",
        type=core.plain,
        help="Named gcloud configuration to use; without it, the active one",
    )


def default_name(args):
    """Never the project's id: the file is not to name the project."""
    return f"gcp-{args.regions[0]}" if args.regions else "gcp"


def status_of(said):
    """The status a refusal is, where gcloud's words for it name none."""
    for sentence, status in SENTENCES:
        if re.search(sentence, said):
            return status
    return UNNAMED


def client(args):
    """A `call(read, *flags)` that runs gcloud."""

    def call(read, *flags):
        command = [
            "gcloud",
            *read,
            *flags,
            "--project",
            args.project,
            "--format=json",
            "--quiet",
        ]
        if args.configuration:
            command.extend(["--configuration", args.configuration])
        shown = f"gcloud {' '.join(read)}"
        try:
            return core.run(command, REFUSALS, shown)
        except core.CliError as error:
            if error.code != UNNAMED:
                raise
            raise core.CliError(shown, status_of(error.said), error.said) from None

    return call


# ---------------------------------------------------------------------------
# Reading what the CLI answered
# ---------------------------------------------------------------------------


def last(path):
    """The name a URL or a resource's full name ends in."""
    return str(path or "").rstrip("/").rsplit("/", 1)[-1]


def region_of(location):
    """A zone's region: its name without the last `-x`. A region is itself."""
    return re.sub(r"-[a-z]$", "", location or "")


def placed(resource):
    """The region a Compute Engine resource is in; none for a global one."""
    if resource.get("zone"):
        return region_of(last(resource["zone"]))
    return last(resource.get("region")) or None


def ref(url):
    """What a Compute Engine URL names: the kind, where it is, and the name.

    A managed instance group and the group it manages are one name in one
    place, and are one thing here.
    """
    found = re.search(
        r"(?:^|/)(?:global|(?:regions|zones)/([^/]+))/([^/]+)/([^/]+)$", str(url or "")
    )
    if not found:
        return None
    where, kind, name = found.groups()
    if kind == "instanceGroupManagers":
        kind = "instanceGroups"
    return (kind, where or GLOBAL, name)


def own(kind, resource):
    """What a listed resource is named by in the URLs of the others."""
    where = last(resource.get("zone") or resource.get("region")) or GLOBAL
    return (kind, where, resource["name"])


def host(url):
    found = re.match(r"https://([^/:?#]+)", url or "")
    return found.group(1).lower() if found else None


def ports(allowed):
    """What one entry of a rule allows, as `tcp/5432`."""
    protocol = allowed.get("IPProtocol") or "all"
    if protocol == "all":
        return "any port"
    listed = [str(port) for port in allowed.get("ports") or []]
    return f"{protocol}/{','.join(listed)}" if listed else protocol


def admits_requests(allowed):
    """Whether an entry covers a port requests come to: 80 or 443, over TCP."""
    if allowed.get("IPProtocol") not in ("tcp", "all"):
        return False
    listed = allowed.get("ports") or []
    if not listed:
        return True
    for span in listed:
        low, _, high = str(span).partition("-")
        high = high or low
        if not (low.isdigit() and high.isdigit()):
            continue
        if any(int(low) <= port <= int(high) for port in (80, 443)):
            return True
    return False


def networks_of(instance):
    return [
        last(interface.get("network"))
        for interface in instance.get("networkInterfaces") or []
        if interface.get("network")
    ]


def tags_of(instance):
    return (instance.get("tags") or {}).get("items") or []


def accounts_of(instance):
    return [
        account["email"]
        for account in instance.get("serviceAccounts") or []
        if account.get("email")
    ]


def groups_of(instance):
    """What a firewall rule may name an instance by, in each of its networks.

    Its network tags and the account it runs as. They are how a rule is
    matched to a resource and are never written.
    """
    return [
        (kind, network, name)
        for network in networks_of(instance)
        for kind, names in (("tag", tags_of(instance)), ("account", accounts_of(instance)))
        for name in names
    ]


def created_by(instance):
    """The managed instance group an instance says made it."""
    for item in (instance.get("metadata") or {}).get("items") or []:
        if item.get("key") == "created-by":
            return ref(item.get("value"))
    return None


def shared(instances):
    """The labels every one of them carries."""
    labels = [instance.get("labels") or {} for instance in instances]
    if not labels:
        return {}
    return {
        key: value
        for key, value in labels[0].items()
        if all(other.get(key) == value for other in labels[1:])
    }


def weighted(action):
    return [
        one.get("backendService")
        for one in (action or {}).get("weightedBackendServices") or []
    ]


def backends_named(url_map):
    """Every backend a URL map sends to, in the order it names them."""
    named = [url_map.get("defaultService"), *weighted(url_map.get("defaultRouteAction"))]
    for matcher in url_map.get("pathMatchers") or []:
        named.append(matcher.get("defaultService"))
        named.extend(weighted(matcher.get("defaultRouteAction")))
        for rule in [*(matcher.get("pathRules") or []), *(matcher.get("routeRules") or [])]:
            named.append(rule.get("service"))
            named.extend(weighted(rule.get("routeAction")))
    return list(dict.fromkeys(found for found in map(ref, named) if found))


def collect(inventory, call, args):
    Project(inventory, call, args.regions).read()
    inventory.note(NOT_READ)


class Project:
    def __init__(self, inventory, call, regions):
        self.inventory = inventory
        self.call = call
        self.regions = list(regions or [])
        # The rules that admit anyone on a port requests come to: the
        # network of each, and the tags and accounts it applies to.
        self.open_rules = []
        # A managed instance group that is a cluster's node pool, to the cluster.
        self.node_groups = {}
        # A Cloud Run service that a function runs as, to the function.
        self.behind = {}
        # A service's or a function's own address, to the key it was added under.
        self.by_host = {}
        self.endpoint_groups = {}

    def answer(self, what, read, *flags):
        """One read. A refusal is noted, and answered as nothing found."""
        return self.inventory.attempt(what, lambda: self.call(read, *flags))

    def rows(self, what, read, *flags):
        """One read, as the list of resources gcloud prints."""
        answer = self.answer(what, read, *flags)
        if not isinstance(answer, list):
            return []
        return [row for row in answer if isinstance(row, dict)]

    def add(self, key, *, region, **resource):
        """Lists a resource, unless it is in a region that was not asked for."""
        region = region or core.EDGE_REGION
        if self.regions and region != core.EDGE_REGION and region not in self.regions:
            return False
        self.inventory.add(key, region=region, **resource)
        return True

    def relate(self, source, target, basis, evidence):
        self.inventory.relate(source, target, basis, evidence)

    def read(self):
        self.read_firewall()
        self.read_clusters()
        self.read_instances()
        self.read_functions()
        self.read_services()
        self.read_messaging()
        self.read_stores()
        self.read_balancers()

    def read_firewall(self):
        for rule in self.rows("Firewall rules", FIREWALL_RULES):
            allowed = rule.get("allowed") or []
            # A rule that denies, one for what leaves, and one that is
            # switched off are no permission to reach.
            if rule.get("disabled") or rule.get("direction", "INGRESS") != "INGRESS" or not allowed:
                continue
            network = last(rule.get("network"))
            tags = rule.get("targetTags") or []
            accounts = rule.get("targetServiceAccounts") or []
            if ANYONE & set(rule.get("sourceRanges") or []) and any(map(admits_requests, allowed)):
                self.open_rules.append((network, set(tags), set(accounts)))
            reach = ", ".join(ports(one) for one in allowed)
            for source in rule.get("sourceTags") or []:
                for target in tags:
                    if source != target:
                        self.inventory.admit(
                            ("tag", network, source),
                            ("tag", network, target),
                            f"firewall rule {rule['name']}: tag {source} may reach "
                            f"tag {target} on {reach}",
                        )
            # An account's address names the project, so the rule is said
            # without it.
            for source in rule.get("sourceServiceAccounts") or []:
                for target in accounts:
                    if source != target:
                        self.inventory.admit(
                            ("account", network, source),
                            ("account", network, target),
                            f"firewall rule {rule['name']}: one service account may "
                            f"reach another on {reach}",
                        )

    def read_clusters(self):
        for cluster in self.rows("GKE clusters", CLUSTERS):
            location = cluster.get("location") or cluster.get("zone") or ""
            key = ("cluster", location, cluster["name"])
            self.add(
                key,
                name=cluster["name"],
                kind="kubernetes-cluster",
                native="container.googleapis.com/Cluster",
                region=region_of(location),
                network=last(cluster.get("network")),
                tags=cluster.get("resourceLabels"),
            )
            for pool in cluster.get("nodePools") or []:
                for url in pool.get("instanceGroupUrls") or []:
                    if ref(url):
                        self.node_groups[ref(url)] = key

    def reachable(self, instance):
        """Whether an instance is reached from outside.

        An address of its own, and a rule that admits anyone to it on a port
        requests come to. A bastion that admits anyone on 22 is not where
        clients enter. A rule that denies is not weighed against one that
        allows.
        """
        tags, accounts = set(tags_of(instance)), set(accounts_of(instance))
        for interface in instance.get("networkInterfaces") or []:
            if not any(access.get("natIP") for access in interface.get("accessConfigs") or []):
                continue
            network = last(interface.get("network"))
            for rule_network, rule_tags, rule_accounts in self.open_rules:
                if rule_network != network:
                    continue
                # A rule with no target applies to every instance of its network.
                if not (rule_tags or rule_accounts) or rule_tags & tags or rule_accounts & accounts:
                    return True
        return False

    def read_instances(self):
        made_by = {}
        for instance in self.rows("Instances", INSTANCES):
            if instance.get("status") == "RUNNING":
                made_by.setdefault(created_by(instance), []).append(instance)

        # A cluster's nodes are the cluster, and it is named by what they are.
        for group, cluster in self.node_groups.items():
            for instance in made_by.pop(group, []):
                for one in groups_of(instance):
                    self.inventory.join(cluster, one)

        for group in self.rows("Instance groups", INSTANCE_GROUPS):
            key = ref(group.get("instanceGroup")) or own("instanceGroups", group)
            if key in self.node_groups:
                continue
            # A group states no network, no labels and nothing a rule names
            # it by: its running instances do.
            instances = made_by.pop(key, [])
            networks = [network for instance in instances for network in networks_of(instance)]
            named_by = [one for instance in instances for one in groups_of(instance)]
            self.add(
                key,
                name=group["name"],
                kind="virtual-machine",
                native="compute.googleapis.com/InstanceGroupManager",
                region=placed(group),
                network=networks[0] if networks else None,
                tags=shared(instances),
                members=group.get("targetSize"),
                groups=list(dict.fromkeys(named_by)),
            )

        # What no listed group stands for is listed as itself.
        for instances in made_by.values():
            for instance in instances:
                networks = networks_of(instance)
                self.add(
                    ("instance", last(instance.get("zone")), instance["name"]),
                    name=instance["name"],
                    kind="virtual-machine",
                    native="compute.googleapis.com/Instance",
                    region=placed(instance),
                    network=networks[0] if networks else None,
                    tags=instance.get("labels"),
                    public=self.reachable(instance),
                    groups=groups_of(instance),
                )

    def read_functions(self):
        for function in self.rows("Functions", FUNCTIONS, "--v2"):
            named = re.search(r"locations/([^/]+)/functions/([^/]+)$", function.get("name") or "")
            if not named:
                continue
            region, name = named.groups()
            key = ("function", region, name)
            trigger = function.get("eventTrigger") or {}
            config = function.get("serviceConfig") or {}
            first = function.get("environment") == "GEN_1"
            self.add(
                key,
                name=name,
                kind="serverless",
                native=f"cloudfunctions.googleapis.com/{'CloudFunction' if first else 'Function'}",
                region=region,
                tags=function.get("labels"),
                # Called by its address, and admitting all traffic to it. A
                # function an event calls is not where clients enter.
                public=not trigger and config.get("ingressSettings") == "ALLOW_ALL",
            )
            service = re.search(r"locations/([^/]+)/services/([^/]+)$", config.get("service") or "")
            if service:
                self.behind[("service", *service.groups())] = key
            for address in (config.get("uri"), function.get("url")):
                self.listens(address, key)
            if trigger.get("pubsubTopic"):
                self.relate(("topic", trigger["pubsubTopic"]), key, "event", "event trigger")
            for one in trigger.get("eventFilters") or []:
                # A filter with an operator matches a pattern, and names no bucket.
                if one.get("attribute") == "bucket" and not one.get("operator"):
                    self.relate(("bucket", one.get("value")), key, "event", "event trigger")

    def listens(self, address, key):
        if host(address):
            self.by_host[host(address)] = key

    def service(self, region, name):
        """A Cloud Run service by its name; the function, where it is one's own."""
        key = ("service", region, name)
        return self.behind.get(key, key)

    def read_services(self):
        for service in self.rows("Cloud Run services", SERVICES):
            described = service.get("metadata") or {}
            name = described.get("name")
            if not name:
                continue
            # Where it stands is written as its region, not as a label of its own.
            labels = dict(described.get("labels") or {})
            region = labels.pop(LOCATION, None)
            key = ("service", region, name)
            address = (service.get("status") or {}).get("url")
            if key in self.behind:
                self.listens(address, self.behind[key])
                continue
            stated = described.get("annotations") or {}
            self.add(
                key,
                name=name,
                kind="serverless",
                native="run.googleapis.com/Service",
                region=region,
                tags=labels,
                public=(stated.get(INGRESS_STATUS) or stated.get(INGRESS)) == "all",
            )
            self.listens(address, key)
            template = (service.get("spec") or {}).get("template") or {}
            declared = ((template.get("metadata") or {}).get("annotations") or {}).get(CLOUD_SQL)
            for connection in (declared or "").split(","):
                if connection.strip():
                    self.relate(
                        key, ("sql", connection.strip()), "declared", f"annotation {CLOUD_SQL}"
                    )

    def read_messaging(self):
        # A topic is in no region. It is kept under its full name, so that
        # one of another project's is never taken for it.
        for topic in self.rows("Topics", TOPICS):
            self.add(
                ("topic", topic["name"]),
                name=last(topic["name"]),
                kind="event-stream",
                native="pubsub.googleapis.com/Topic",
                region=None,
                tags=topic.get("labels"),
            )
        for subscription in self.rows("Subscriptions", SUBSCRIPTIONS):
            name = last(subscription.get("name"))
            topic = ("topic", subscription.get("topic"))
            # A subscription that is pulled from states no consumer.
            pushed = (subscription.get("pushConfig") or {}).get("pushEndpoint")
            target = self.by_host.get(host(pushed))
            if target:
                self.relate(topic, target, "event", f"push subscription {name}")
            dead = (subscription.get("deadLetterPolicy") or {}).get("deadLetterTopic")
            if dead:
                self.relate(
                    topic, ("topic", dead), "declared", f"dead letter policy of subscription {name}"
                )

    def read_stores(self):
        for instance in self.rows("Cloud SQL instances", SQL):
            # Where a replica copies from, outside Cloud SQL, is not the project's.
            if instance.get("instanceType") == "ON_PREMISES_INSTANCE":
                continue
            settings = instance.get("settings") or {}
            private = (settings.get("ipConfiguration") or {}).get("privateNetwork")
            self.add(
                ("sql", instance.get("connectionName") or instance["name"]),
                name=instance["name"],
                kind="database",
                native="sqladmin.googleapis.com/Instance",
                region=instance.get("region"),
                network=last(private),
                tags=settings.get("userLabels"),
            )

        if not self.regions:
            self.inventory.note(NO_REGION)
        for region in self.regions:
            for instance in self.rows("Redis instances", REDIS, "--region", region):
                replicas = instance.get("replicaCount") or 0
                self.add(
                    ("redis", instance["name"]),
                    name=last(instance["name"]),
                    kind="cache",
                    native="redis.googleapis.com/Instance",
                    region=region,
                    network=last(instance.get("authorizedNetwork")),
                    tags=instance.get("labels"),
                    # The primary and its replicas.
                    members=replicas + 1 if replicas else None,
                )

        for instance in self.rows("Spanner instances", SPANNER):
            self.add(
                ("spanner", instance["name"]),
                name=last(instance["name"]),
                kind="database",
                native="spanner.googleapis.com/Instance",
                # A configuration of one region is named after it; one of
                # several is called what the provider calls it.
                region=last(instance.get("config")).removeprefix("regional-"),
                tags=instance.get("labels"),
            )

        # gcloud has printed this list both as it is and inside the answer
        # that carries it.
        databases = self.answer("Firestore databases", FIRESTORE)
        if isinstance(databases, dict):
            databases = databases.get("databases")
        for database in databases or []:
            self.add(
                ("firestore", database["name"]),
                name=last(database["name"]),
                kind="database",
                native="firestore.googleapis.com/Database",
                region=database.get("locationId"),
            )

        # `--raw` prints a bucket as the API gives it.
        for bucket in self.rows("Buckets", BUCKETS, "--raw"):
            self.add(
                ("bucket", bucket["name"]),
                name=bucket["name"],
                kind="storage",
                native="storage.googleapis.com/Bucket",
                region=(bucket.get("location") or "").lower(),
                tags=bucket.get("labels"),
            )

    def read_balancers(self):
        what = "Load balancers"
        rules = self.rows(what, FORWARDING_RULES)
        maps_of = {}
        for kind, read in (("targetHttpProxies", HTTP_PROXIES), ("targetHttpsProxies", HTTPS_PROXIES)):
            for proxy in self.rows(what, read):
                maps_of[own(kind, proxy)] = ref(proxy.get("urlMap"))
        maps = self.rows(what, URL_MAPS)
        services = {own("backendServices", one): one for one in self.rows(what, BACKEND_SERVICES)}
        buckets = {own("backendBuckets", one): one for one in self.rows(what, BACKEND_BUCKETS)}
        self.endpoint_groups = {
            own("networkEndpointGroups", one): one for one in self.rows(what, ENDPOINT_GROUPS)
        }

        # What each forwarding rule leads to: a URL map through its proxy,
        # or a backend service or a target pool straight away. And what the
        # rules that lead to it say of it.
        fronts = {}
        for rule in rules:
            target = ref(rule.get("target"))
            led = maps_of.get(target) or ref(rule.get("backendService"))
            if not led and target and target[0] == "targetPools":
                led = target
            if not led:
                continue
            front = fronts.setdefault(led, {"public": False, "network": None, "labels": {}})
            if str(rule.get("loadBalancingScheme") or "").startswith("EXTERNAL"):
                front["public"] = True
            front["network"] = front["network"] or last(rule.get("network")) or None
            for label, value in (rule.get("labels") or {}).items():
                front["labels"].setdefault(label, value)

        def balancer(key, **resource):
            front = fronts.get(key) or {}
            return self.add(
                key,
                network=front.get("network"),
                tags=front.get("labels"),
                public=front.get("public", False),
                **resource,
            )

        def route(source, backend):
            kind, _, name = backend
            if kind == "backendBuckets" and backend in buckets:
                bucket = ("bucket", buckets[backend].get("bucketName"))
                self.relate(source, bucket, "routing", f"backend bucket {name}")
            for target in self.reached(services.get(backend)):
                self.relate(source, target, "routing", f"backend service {name}")

        for url_map in maps:
            backends = backends_named(url_map)
            # A map that only answers with a redirect sends nothing on.
            if not backends:
                continue
            key = own("urlMaps", url_map)
            listed = balancer(
                key,
                name=url_map["name"],
                kind="load-balancer",
                native="compute.googleapis.com/UrlMap",
                region=placed(url_map),
            )
            if listed:
                for backend in backends:
                    route(key, backend)

        natives = {
            "backendServices": "compute.googleapis.com/BackendService",
            "targetPools": "compute.googleapis.com/TargetPool",
        }
        for led in fronts:
            kind, where, name = led
            if kind in natives and balancer(
                led,
                name=name,
                kind="load-balancer",
                native=natives[kind],
                region=None if where == GLOBAL else where,
            ):
                route(led, led)

    def reached(self, service):
        """What a backend service sends on to: a group of instances, or the
        service or the function a serverless endpoint group names."""
        for backend in (service or {}).get("backends") or []:
            group = ref(backend.get("group"))
            if not group:
                continue
            if group[0] == "instanceGroups":
                yield self.node_groups.get(group, group)
                continue
            described = self.endpoint_groups.get(group) or {}
            region = placed(described)
            service_name = (described.get("cloudRun") or {}).get("service")
            if service_name:
                yield self.service(region, service_name)
            function = (described.get("cloudFunction") or {}).get("function")
            if function:
                yield ("function", region, function)
