"""Reads an Oracle Cloud compartment through the OCI CLI.

Every call is one of `READS`: a list or a get, made in the compartment and
the regions the operator names, with the profile the operator names or the
CLI's default one. The CLI joins the pages of a list itself. What a call
answers is looked at for the fields named here and nothing else of it is
kept. An OCID is how one answer names what the next call asks about: none is
written, nor an address, nor who made a resource.

A resource is listed once: the instances of an instance pool as the pool,
the worker nodes of a Kubernetes cluster as the cluster. A connection is
written only where the tenancy states one, and says what states it.
"""

import re
from urllib.parse import urlsplit

from . import core

NAME = "oci"
HELP = "Oracle Cloud Infrastructure, through the OCI CLI"

# Every command the collector may run, as the words that follow `oci`. A test
# holds what it runs to this.
READS = (
    ("network", "vcn", "list"),
    ("network", "subnet", "list"),
    ("network", "nsg", "list"),
    ("network", "nsg", "rules", "list"),
    ("compute", "instance", "list"),
    ("compute", "vnic-attachment", "list"),
    ("network", "vnic", "get"),
    ("compute-management", "instance-pool", "list"),
    ("compute-management", "instance-pool", "list-instances"),
    ("ce", "cluster", "list"),
    ("ce", "node-pool", "list"),
    ("ce", "node-pool", "get"),
    ("container-instances", "container-instance", "list"),
    ("lb", "load-balancer", "list"),
    ("nlb", "network-load-balancer", "list"),
    ("fn", "application", "list"),
    ("fn", "function", "list"),
    ("api-gateway", "gateway", "list"),
    ("api-gateway", "deployment", "list"),
    ("api-gateway", "deployment", "get"),
    ("streaming", "admin", "stream", "list"),
    ("queue", "queue-admin", "queue", "list"),
    ("db", "autonomous-database", "list"),
    ("db", "system", "list"),
    ("mysql", "db-system", "list"),
    ("nosql", "table", "list"),
    ("os", "bucket", "list"),
)


def allow(granted, only=""):
    """A policy statement, for whoever runs the collector and the compartment read."""
    return f"Allow group <group> to {granted} in compartment <compartment>{only}"


# The statements that grant those reads and nothing else, for a
# least-privilege policy: `<group>` is the group of whoever runs the
# collector, `<compartment>` the compartment read. The first four are also
# what a compartment named with --network-compartment needs. Listing a
# group's rules is a permission only `use` carries, beside one that changes
# a group's members: that statement is narrowed to the one permission.
POLICY = (
    allow("inspect vcns"),
    allow("inspect subnets"),
    allow("read network-security-groups"),
    allow(
        "use network-security-groups",
        " where request.permission='NETWORK_SECURITY_GROUP_LIST_SECURITY_RULES'",
    ),
    allow("read instances"),
    allow("inspect vnic-attachments"),
    allow("inspect vnics"),
    allow("read instance-pools"),
    allow("inspect clusters"),
    allow("read cluster-node-pools"),
    allow("inspect compute-container-instances"),
    allow("inspect load-balancers"),
    allow("inspect network-load-balancers"),
    allow("inspect fn-app"),
    allow("inspect fn-function"),
    allow("read api-gateways"),
    allow("read api-deployments"),
    allow("inspect streams"),
    allow("inspect queues"),
    allow("inspect autonomous-databases"),
    allow("inspect db-systems"),
    allow("inspect mysql-instances"),
    allow("inspect nosql-tables"),
    allow("inspect buckets"),
)

# The lifecycle states in which a resource is there and doing its work:
# running, or being changed or looked after while it runs. One that is being
# made, is stopped, has failed or is gone is not listed.
SERVING = frozenset(
    {
        "RUNNING",
        "ACTIVE",
        "AVAILABLE",
        "UPDATING",
        "SCALING",
        "SCALE_IN_PROGRESS",
        "BACKUP_IN_PROGRESS",
        "MAINTENANCE_IN_PROGRESS",
        "AVAILABLE_NEEDS_ATTENTION",
        "NEEDS_ATTENTION",
    }
)
# The namespace of the tags Oracle adds by itself: who made a resource, and when.
ORACLE_TAGS = "Oracle-Tags"
# Most VNICs read in one region, each a call of its own. Past it an instance
# is listed without what its VNIC would say, and a note says how many.
MAX_VNIC_READS = 500
# The protocols a rule may give options for, by their numbers.
PROTOCOLS = {"1": "icmp", "6": "tcp", "17": "udp", "58": "icmpv6"}
ANYONE = ("0.0.0.0/0", "::/0")
NOT_READ = (
    "Not read: Cloud Guard, identity domains, Notifications topics, Events "
    "rules, Service Connector Hub, what runs inside an OKE cluster, security "
    "lists, the VNICs of a container instance, compartments under the one "
    "named, and a backend named by a host name or held in another network. "
    "An instance pool is taken to be in the network security groups of its "
    "first running instance. Declare a connection that is not here with "
    "--relation."
)
# A group's rules are a call for each group, which --no-network-rules saves.
NO_GROUPS = (
    "Network security groups were not read: an instance with an address of its "
    "own is not taken to be reachable from outside."
)
# How the CLI names a refusal: a service's own code in the body of its
# `ServiceError`, the name of what failed before any answer came, or the
# CLI's word for a command it does not take.
REFUSALS = (
    r'"code":\s*"(\w+)"',
    r"(?m)^(\w+(?:Error|Exception|Timeout)):",
    r"Error: ((?:Missing|No such) \w+)",
)


def region_code(value):
    if not re.fullmatch(r"[a-z][a-z0-9-]{1,63}", value):
        raise core.argparse.ArgumentTypeError(
            f"expected an OCI region identifier, such as sa-saopaulo-1; got {value!r}"
        )
    return value


def compartment_id(value):
    value = core.plain(value)
    if not re.match(r"ocid1\.(compartment|tenancy)\.", value):
        raise core.argparse.ArgumentTypeError(
            "expected the OCID of a compartment, such as "
            f"ocid1.compartment.oc1..aaaa; got {value!r}"
        )
    return value


def arguments(parser):
    parser.add_argument(
        "--compartment",
        type=compartment_id,
        required=True,
        metavar="OCID",
        help="OCID of the compartment to read; the compartments under it are not read",
    )
    parser.add_argument(
        "--network-compartment",
        dest="network_compartments",
        action="append",
        type=compartment_id,
        default=[],
        metavar="OCID",
        help="OCID of another compartment that holds the networks and network "
        "security groups, where they are kept apart; repeat for several",
    )
    parser.add_argument(
        "--profile",
        type=core.plain,
        help="OCI CLI profile to use; without it, the CLI's default one",
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
    return f"oci-{args.regions[0]}"


def client(args):
    """A `call(region, command, params)` that runs the OCI CLI."""

    def call(region, command, params=None):
        shown = f"oci {' '.join(command)}"
        line = ["oci", *command]
        for option, value in (params or {}).items():
            # An id an earlier answer gave is still a value handed to a CLI.
            try:
                line.extend([f"--{option}", core.plain(value)])
            except (core.argparse.ArgumentTypeError, TypeError) as error:
                raise core.CliError(shown, "UnexpectedValue", str(error)) from error
        if command[-1].startswith("list"):
            line.append("--all")
        line.extend(["--output", "json", "--region", region])
        if args.profile:
            line.extend(["--profile", args.profile])
        return core.run(line, REFUSALS, shown)

    return call


# ---------------------------------------------------------------------------
# Reading what the CLI answered
# ---------------------------------------------------------------------------


def items(answer):
    """What a list found. The CLI prints a list, a collection holding one, or nothing."""
    data = (answer or {}).get("data")
    if isinstance(data, dict):
        data = data.get("items")
    return data if isinstance(data, list) else []


def serving(resource):
    """Whether a resource is there and running. One that states no state is."""
    state = resource.get("lifecycle-state")
    return state is None or state in SERVING


def tags_of(resource):
    """A resource's tags: freeform ones as they are, defined ones as `namespace.key`.

    Two kinds name the tenancy and are left out: the tags Oracle adds by
    itself, which say who made the resource, and any whose value is an OCID.
    """
    found = {}
    for namespace, pairs in (resource.get("defined-tags") or {}).items():
        if namespace == ORACLE_TAGS or not isinstance(pairs, dict):
            continue
        for key, value in pairs.items():
            found[f"{namespace}.{key}"] = value
    found.update(resource.get("freeform-tags") or {})
    return {
        key: str(value)
        for key, value in found.items()
        if value is not None and "ocid1." not in str(value)
    }


def port_range(rule):
    """The destination ports a rule names, or None where it is about every port."""
    options = {"6": "tcp-options", "17": "udp-options"}.get(rule.get("protocol"))
    stated = (rule.get(options) or {}) if options else {}
    span = stated.get("destination-port-range") or {}
    low, high = span.get("min"), span.get("max")
    return None if low is None or high is None else (low, high)


def ports(rule):
    protocol = rule.get("protocol", "all")
    if protocol == "all":
        return "any port"
    name = PROTOCOLS.get(protocol, f"protocol {protocol}")
    span = port_range(rule)
    if not span:
        return name
    low, high = span
    return f"{name}/{low}" if low == high else f"{name}/{low}-{high}"


def open_to_requests(rule):
    """Whether a rule admits anyone on a port requests come to: 80 or 443."""
    if rule.get("source-type") != "CIDR_BLOCK" or rule.get("source") not in ANYONE:
        return False
    protocol = rule.get("protocol", "all")
    if protocol == "all":
        return True
    if protocol not in ("6", "17"):
        return False
    span = port_range(rule)
    return span is None or any(span[0] <= port <= span[1] for port in (80, 443))


def host_of(url):
    try:
        return urlsplit(url).hostname
    except ValueError:
        return None


def given(name):
    """A name as it was given. One that holds an OCID names the tenancy, and is not kept."""
    return name if name and "ocid1." not in name else None


def named(what, name):
    """What states a relation: `backend set checkout`."""
    return f"{what} {given(name)}" if given(name) else what


def collect(inventory, call, args):
    for region in args.regions:
        Region(inventory, call, region, args).read()
    if not inventory.network_rules:
        inventory.note(NO_GROUPS)
    inventory.note(NOT_READ)


class Region:
    def __init__(self, inventory, call, region, args):
        self.inventory = inventory
        self.call = call
        self.region = region
        self.compartment = args.compartment
        # Where networks are looked for: the compartment, and any other named.
        self.network_compartments = list(
            dict.fromkeys([args.compartment, *args.network_compartments])
        )
        # A VCN, to the name it was given; a subnet, to its VCN.
        self.vcns = {}
        self.subnets = {}
        self.group_names = {}
        self.open_groups = set()
        # The running instances, and what is attached to each.
        self.instances = {}
        self.attached = {}
        # An instance, to the pool or the cluster that stands for it.
        self.part_of = {}
        # An address, to each resource that holds it and the VCN it holds it in.
        self.held = {}
        self.vnic_reads = 0
        self.unread = 0

    def ask(self, what, command, **params):
        """One read. A refusal is noted, and answered as nothing found."""
        params = {name.replace("_", "-"): value for name, value in params.items()}
        return (
            self.inventory.attempt(what, lambda: self.call(self.region, command, params))
            or {}
        )

    def every(self, what, command, **params):
        """What a list found that is there and running."""
        return [one for one in items(self.ask(what, command, **params)) if serving(one)]

    def within(self, what, *command, **params):
        """What a list of the compartment found that is there and running."""
        return self.every(what, command, compartment_id=self.compartment, **params)

    def one(self, what, command, **params):
        """What a get answered: one resource, or nothing."""
        data = self.ask(what, command, **params).get("data")
        return data if isinstance(data, dict) else {}

    def add(self, key, name=None, **resource):
        """Lists a resource here. One with no name of its own is called by what it is."""
        return self.inventory.add(key, name=given(name), region=self.region, **resource)

    def network_of(self, subnet):
        """The name of the network a subnet is in."""
        return self.vcns.get(self.subnets.get(subnet))

    def hold(self, key, address, vcn):
        """Says a resource holds an address, in a VCN or, with None, wherever it is asked from."""
        if address:
            self.held.setdefault(address, []).append((vcn, key))

    def holder(self, address, vcn):
        """The one resource that holds an address as it is seen from a VCN.

        Networks may use the same addresses, so an address names a resource
        only in the network it is asked from. Where nothing says which
        network one of the two is in, it names the resource only when no
        other holds it.
        """
        found = {
            key
            for net, key in self.held.get(address, ())
            if net is None or vcn is None or net == vcn
        }
        return found.pop() if len(found) == 1 else None

    def read(self):
        self.read_networks()
        self.read_running()
        self.read_pools()
        self.read_clusters()
        self.read_instances()
        self.read_container_instances()
        self.read_balancers()
        self.read_functions()
        self.read_apis()
        self.read_messaging()
        self.read_stores()
        self.note_unread()

    def read_networks(self):
        groups = []
        for compartment in self.network_compartments:
            here = {"compartment_id": compartment}
            for vcn in self.every("Networks", ("network", "vcn", "list"), **here):
                self.vcns[vcn["id"]] = given(vcn.get("display-name"))
            for subnet in self.every("Subnets", ("network", "subnet", "list"), **here):
                self.subnets[subnet["id"]] = subnet.get("vcn-id")
            if self.inventory.network_rules:
                groups.extend(
                    self.every("Network security groups", ("network", "nsg", "list"), **here)
                )
        for group in groups:
            self.group_names[group["id"]] = given(group.get("display-name")) or "a group"
        for group in groups:
            target = group["id"]
            rules = self.ask(
                "Security rules",
                ("network", "nsg", "rules", "list"),
                nsg_id=target,
                direction="INGRESS",
            )
            for rule in items(rules):
                # A rule whose group was deleted is kept, and marked as not valid.
                if rule.get("direction", "INGRESS") != "INGRESS" or rule.get("is-valid") is False:
                    continue
                if open_to_requests(rule):
                    self.open_groups.add(target)
                source = rule.get("source")
                by_group = rule.get("source-type") == "NETWORK_SECURITY_GROUP"
                if by_group and source and source != target:
                    self.inventory.admit(
                        source,
                        target,
                        f"security rule: {self.group_names.get(source, 'a group')} "
                        f"may reach {self.group_names[target]} on {ports(rule)}",
                    )

    def read_running(self):
        for instance in self.within("Instances", "compute", "instance", "list"):
            self.instances[instance["id"]] = instance
        if not self.instances:
            return
        attachments = self.ask(
            "VNIC attachments",
            ("compute", "vnic-attachment", "list"),
            compartment_id=self.compartment,
        )
        for attachment in items(attachments):
            if attachment.get("lifecycle-state") == "ATTACHED" and attachment.get("vnic-id"):
                self.attached.setdefault(attachment.get("instance-id"), []).append(attachment)

    def placed(self, key, instance):
        """Where an instance stands, for `key`: the piece it is, or is part of.

        Its network comes with what is attached to it. Its groups, its
        addresses and whether requests reach it from outside are its VNICs'
        to say, each a call of its own.
        """
        attachments = self.attached.get(instance, [])
        network = next(
            filter(None, (self.network_of(one.get("subnet-id")) for one in attachments)), None
        )
        groups, public = [], False
        for attachment in attachments:
            if self.vnic_reads >= MAX_VNIC_READS:
                self.unread += 1
                break
            self.vnic_reads += 1
            vnic = self.one("VNICs", ("network", "vnic", "get"), vnic_id=attachment["vnic-id"])
            if not vnic or not serving(vnic):
                continue
            own = vnic.get("nsg-ids") or []
            groups.extend(own)
            subnet = vnic.get("subnet-id") or attachment.get("subnet-id")
            self.hold(key, vnic.get("private-ip"), self.subnets.get(subnet))
            # Reachable from outside: an address of its own, and a group that
            # admits anyone on a port requests come to. A bastion that admits
            # anyone on 22 is not where clients enter.
            if vnic.get("public-ip") and any(group in self.open_groups for group in own):
                public = True
        return network, list(dict.fromkeys(groups)), public

    def read_pools(self):
        for pool in self.within("Instance pools", "compute-management", "instance-pool", "list"):
            key = pool["id"]
            members = items(
                self.ask(
                    "Instance pool instances",
                    ("compute-management", "instance-pool", "list-instances"),
                    compartment_id=self.compartment,
                    instance_pool_id=key,
                )
            )
            for member in members:
                self.part_of[member["id"]] = key
                # A pool attached to a balancer says so of each instance.
                for backend in member.get("load-balancer-backends") or []:
                    if backend.get("load-balancer-id"):
                        self.inventory.relate(
                            backend["load-balancer-id"],
                            key,
                            "routing",
                            named("backend set", backend.get("backend-set-name")),
                        )
            # Its instances are launched from one configuration: the first
            # that runs says where the pool stands and which groups it is in.
            first = next((one["id"] for one in members if one["id"] in self.instances), None)
            network, groups, _ = self.placed(key, first) if first else (None, [], False)
            self.add(
                key,
                name=pool.get("display-name"),
                kind="virtual-machine",
                native="oci.core.InstancePool",
                network=network,
                tags=tags_of(pool),
                members=pool.get("size"),
                groups=groups,
            )

    def read_clusters(self):
        clusters = self.within("Kubernetes clusters", "ce", "cluster", "list")
        if not clusters:
            return
        node_pools = {}
        for summary in self.within("Kubernetes node pools", "ce", "node-pool", "list"):
            # The list does not name a pool's nodes; the pool itself does.
            pool = self.one(
                "Kubernetes node pools", ("ce", "node-pool", "get"), node_pool_id=summary["id"]
            )
            node_pools.setdefault(summary.get("cluster-id"), []).append(pool or summary)
        for cluster in clusters:
            key = cluster["id"]
            vcn = cluster.get("vcn-id")
            groups = []
            for pool in node_pools.get(key, []):
                config = pool.get("node-config-details") or {}
                pods = config.get("node-pool-pod-network-option-details") or {}
                groups.extend(config.get("nsg-ids") or [])
                groups.extend(pods.get("pod-nsg-ids") or [])
                # A node is an instance, and is not listed beside its cluster.
                for node in pool.get("nodes") or []:
                    if node.get("id"):
                        self.part_of[node["id"]] = key
                    self.hold(
                        key, node.get("private-ip"), self.subnets.get(node.get("subnet-id")) or vcn
                    )
            self.add(
                key,
                name=cluster.get("name"),
                kind="kubernetes-cluster",
                native="oci.container_engine.Cluster",
                network=self.vcns.get(vcn),
                tags=tags_of(cluster),
                groups=list(dict.fromkeys(groups)),
            )

    def read_instances(self):
        for key, instance in self.instances.items():
            if key in self.part_of:
                continue
            network, groups, public = self.placed(key, key)
            self.add(
                key,
                name=instance.get("display-name"),
                kind="virtual-machine",
                native="oci.core.Instance",
                network=network,
                tags=tags_of(instance),
                public=public,
                groups=groups,
            )

    def read_container_instances(self):
        for instance in self.within(
            "Container instances", "container-instances", "container-instance", "list"
        ):
            self.add(
                instance["id"],
                name=instance.get("display-name"),
                kind="container",
                native="oci.container_instances.ContainerInstance",
                tags=tags_of(instance),
            )

    def read_balancers(self):
        balancers = []
        for balancer in self.within("Load balancers", "lb", "load-balancer", "list"):
            subnet = (balancer.get("subnet-ids") or [None])[0]
            balancers.append(
                self.add_balancer(balancer, "load-balancer", "oci.load_balancer.LoadBalancer", subnet)
            )
        for balancer in self.within(
            "Network load balancers", "nlb", "network-load-balancer", "list"
        ):
            balancers.append(
                self.add_balancer(
                    balancer,
                    "load-balancer",
                    "oci.network_load_balancer.NetworkLoadBalancer",
                    balancer.get("subnet-id"),
                )
            )
        # Every balancer is listed before any backend is followed: one may
        # stand in front of another.
        for balancer, vcn in balancers:
            key = balancer["id"]
            for name, backend_set in (balancer.get("backend-sets") or {}).items():
                for backend in (backend_set or {}).get("backends") or []:
                    # A backend names an instance, or gives an address. An
                    # address nothing listed holds is not a resource.
                    target = backend.get("target-id")
                    target = self.part_of.get(target, target)
                    if target not in self.inventory:
                        target = self.holder(backend.get("ip-address"), vcn)
                    if target and target != key:
                        self.inventory.relate(key, target, "routing", named("backend set", name))

    def add_balancer(self, balancer, kind, native, subnet):
        key = balancer["id"]
        vcn = self.subnets.get(subnet)
        self.add(
            key,
            name=balancer.get("display-name"),
            kind=kind,
            native=native,
            network=self.vcns.get(vcn),
            tags=tags_of(balancer),
            public=balancer.get("is-private") is False,
            groups=balancer.get("network-security-group-ids") or [],
        )
        for address in balancer.get("ip-addresses") or []:
            # A public address is the same wherever it is asked from.
            self.hold(key, address.get("ip-address"), None if address.get("is-public") else vcn)
        return balancer, vcn

    def read_functions(self):
        for application in self.within("Function applications", "fn", "application", "list"):
            network = self.network_of((application.get("subnet-ids") or [None])[0])
            groups = application.get("network-security-group-ids") or []
            for function in self.every(
                "Functions", ("fn", "function", "list"), application_id=application["id"]
            ):
                self.add(
                    function["id"],
                    name=function.get("display-name"),
                    kind="serverless",
                    native="oci.functions.Function",
                    network=network,
                    tags=tags_of(function),
                    groups=groups,
                )

    def read_apis(self):
        gateways = {}
        for gateway in self.within("API gateways", "api-gateway", "gateway", "list"):
            key = gateway["id"]
            gateways[key] = self.subnets.get(gateway.get("subnet-id"))
            self.add(
                key,
                name=gateway.get("display-name"),
                kind="api-gateway",
                native="oci.apigateway.Gateway",
                network=self.vcns.get(gateways[key]),
                tags=tags_of(gateway),
                public=gateway.get("endpoint-type") == "PUBLIC",
                groups=gateway.get("network-security-group-ids") or [],
            )
        if not gateways:
            return
        for summary in self.within("API deployments", "api-gateway", "deployment", "list"):
            gateway = summary.get("gateway-id")
            if gateway not in gateways:
                continue
            # The list does not give a deployment's routes; the deployment does.
            deployment = self.one(
                "API deployments", ("api-gateway", "deployment", "get"), deployment_id=summary["id"]
            )
            for route in (deployment.get("specification") or {}).get("routes") or []:
                target = self.backend(route.get("backend") or {}, gateways[gateway])
                if target:
                    self.inventory.relate(
                        gateway, target, "routing", named("route", route.get("path"))
                    )

    def backend(self, backend, vcn):
        """The resource a route's backend names: a function, or what holds its address."""
        if backend.get("type") == "ORACLE_FUNCTIONS_BACKEND":
            return backend.get("function-id")
        if backend.get("type") == "HTTP_BACKEND":
            return self.holder(host_of(backend.get("url") or ""), vcn)
        return None

    def read_messaging(self):
        for stream in self.within("Streams", "streaming", "admin", "stream", "list"):
            self.add(
                stream["id"],
                name=stream.get("name"),
                kind="event-stream",
                native="oci.streaming.Stream",
                tags=tags_of(stream),
            )
        for queue in self.within("Queues", "queue", "queue-admin", "queue", "list"):
            self.add(
                queue["id"],
                name=queue.get("display-name"),
                kind="message-queue",
                native="oci.queue.Queue",
                tags=tags_of(queue),
            )

    def read_stores(self):
        for database in self.within("Autonomous databases", "db", "autonomous-database", "list"):
            self.add(
                database["id"],
                name=database.get("display-name") or database.get("db-name"),
                kind="database",
                native="oci.database.AutonomousDatabase",
                # Only one with a private endpoint is in a network.
                network=self.network_of(database.get("subnet-id")),
                tags=tags_of(database),
                groups=database.get("nsg-ids") or [],
            )
        for system in self.within("Database systems", "db", "system", "list"):
            self.add(
                system["id"],
                name=system.get("display-name"),
                kind="database",
                native="oci.database.DbSystem",
                network=self.network_of(system.get("subnet-id")),
                tags=tags_of(system),
                members=system.get("node-count"),
                groups=system.get("nsg-ids") or [],
            )
        # The list of MySQL systems names neither a subnet nor a group.
        for system in self.within("MySQL database systems", "mysql", "db-system", "list"):
            self.add(
                system["id"],
                name=system.get("display-name"),
                kind="database",
                native="oci.mysql.DbSystem",
                tags=tags_of(system),
            )
        for table in self.within("NoSQL tables", "nosql", "table", "list"):
            self.add(
                table["id"],
                name=table.get("name"),
                kind="database",
                native="oci.nosql.Table",
                tags=tags_of(table),
            )
        # A bucket's tags come only when asked for. The namespace it is in is
        # the tenancy's: the CLI finds it by itself, and it is not kept.
        for bucket in self.within("Buckets", "os", "bucket", "list", fields="tags"):
            self.add(
                ("bucket", self.region, bucket["name"]),
                name=bucket["name"],
                kind="storage",
                native="oci.object_storage.Bucket",
                tags=tags_of(bucket),
            )

    def note_unread(self):
        if self.unread == 1:
            self.inventory.note(
                f"1 instance in {self.region} is listed without its network security "
                f"groups and addresses: at most {MAX_VNIC_READS} VNICs are read in a region."
            )
        elif self.unread:
            self.inventory.note(
                f"{self.unread} instances in {self.region} are listed without their "
                f"network security groups and addresses: at most {MAX_VNIC_READS} VNICs "
                "are read in a region."
            )
