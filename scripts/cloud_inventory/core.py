"""What the inventory collectors share.

The inventory being written, the ids its resources take, the arguments every
collector reads, how a provider's CLI is run, and the file. Nothing here
knows a provider: a collector fills an `Inventory` from what its CLI
answered, and this module writes it in the format
`schemas/v1/inventory.schema.json` describes. A test holds every name and
bound below to that schema.
"""

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

KIND = "aegis-cloud-inventory"
VERSION = 1
PROVIDERS = ("aws", "gcp", "oci")
# The ServiceType enum of the schema, in its order.
SERVICE_TYPES = (
    "api-gateway",
    "auth-service",
    "cedar-authorizer",
    "microservice",
    "container",
    "serverless",
    "message-queue",
    "database",
    "storage",
    "network-gateway",
    "security-monitor",
    "external-client",
    "load-balancer",
    "virtual-machine",
    "kubernetes-cluster",
    "cache",
    "event-stream",
)
# What states a relation, strongest first.
BASES = ("routing", "event", "declared", "network")

MAX_RESOURCES = 10_000
MAX_RELATIONS = 50_000
MAX_ID_LEN = 64
MAX_TEXT_LEN = 256
MAX_TAGS = 64
MAX_TAG_KEY_LEN = 128
MAX_TAG_VALUE_LEN = 256
MAX_NOTES = 40
MAX_NOTE_LEN = 1280
# The most the server reads in one file.
MAX_BYTES = 4 * 1024 * 1024

# Ids a topology read from an inventory gives its own stand-ins.
RESERVED = ("clients", "unknown-sources")
# Where a resource that is in no region stands.
EDGE_REGION = "global"
DECLARED = "declared by the operator"


class CollectError(Exception):
    """The collection cannot be written. Said to the operator; nothing is written."""


class CliError(Exception):
    """A provider's CLI refused one read.

    `code` is the provider's short name for why (`AccessDenied`), which is
    all of it a file may hold: what the provider `said` can name the account
    and the caller, and is shown to the operator only.
    """

    def __init__(self, command, code, said):
        super().__init__(f"{command} failed ({code}): {said}")
        self.command = command
        self.code = code
        self.said = said


def now():
    """This moment in UTC, to the second."""
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def code_of(said, patterns):
    """The provider's short name for a refusal, by the first pattern that finds one."""
    for pattern in patterns:
        found = re.search(pattern, said)
        if found:
            return found.group(1)
    return "refused"


def run(command, patterns, shown, timeout=300):
    """Runs a provider's CLI and reads the JSON it prints.

    `command` is a list, never a line for a shell. `shown` is what a failure
    is named by: the CLI and the read, without the operator's arguments.
    """
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            encoding="utf-8",
            check=False,
            timeout=timeout,
        )
    except FileNotFoundError as error:
        raise CollectError(
            f"{command[0]} is not installed, or is not on the PATH."
        ) from error
    except subprocess.TimeoutExpired as error:
        raise CliError(shown, "Timeout", f"no answer in {timeout} s") from error
    if result.returncode:
        # Most CLIs say what went wrong on the error stream; some, such as
        # the OCI CLI without a configuration, print it as output.
        said = result.stderr.strip() or result.stdout.strip()
        raise CliError(shown, code_of(said, patterns), said)
    text = result.stdout.strip()
    return json.loads(text) if text else {}


def slug(name, fallback):
    """An id a topology accepts, made of a name."""
    text = re.sub(r"[^A-Za-z0-9_.-]+", "-", name).strip("-")
    return text[:MAX_ID_LEN].rstrip("-") or fallback


def cut(text, most=MAX_TEXT_LEN):
    return text if len(text) <= most else text[:most]


class Inventory:
    """An inventory as a collector fills it.

    A resource is added under the provider's own key for it (an ARN, a self
    link, an OCID), which is how a later read names it. The key is never
    written: what is written is an id made of the resource's name.
    """

    def __init__(self, provider, name, only_tags=(), tag_keys=None, network_rules=True):
        if provider not in PROVIDERS:
            raise CollectError(f"Unknown provider {provider!r}.")
        if not 0 < len(name.strip()) <= MAX_ID_LEN:
            raise CollectError(
                f"The name must contain between 1 and {MAX_ID_LEN} characters."
            )
        self.provider = provider
        self.name = name
        self.only_tags = list(only_tags)
        self.tag_keys = None if tag_keys is None else set(tag_keys)
        self.network_rules = network_rules
        self._resources = []
        self._by_key = {}
        self._ids = set(RESERVED)
        self._relations = []
        self._members = {}
        self._rules = []
        self._notes = []
        self._failures = []

    def __contains__(self, key):
        return key in self._by_key

    def add(
        self,
        key,
        *,
        name,
        kind,
        native,
        region,
        network=None,
        tags=None,
        public=False,
        members=None,
        groups=(),
    ):
        """Adds a resource once, under `key`, and says which id it takes."""
        if key in self._by_key:
            return self._resources[self._by_key[key]]["id"]
        if kind not in SERVICE_TYPES or kind == "external-client":
            raise CollectError(f"{name!r} cannot be listed as a {kind!r}.")
        name = name or native
        identifier = self._free_id(slug(name, kind), region)
        self._by_key[key] = len(self._resources)
        self._resources.append(
            {
                "key": key,
                "id": identifier,
                "name": name,
                "type": kind,
                "native": native,
                "region": slug(region or EDGE_REGION, EDGE_REGION),
                "network": network or None,
                "tags": dict(tags or {}),
                "public": bool(public),
                "members": members if members and members > 0 else None,
            }
        )
        for group in groups:
            self.join(key, group)
        return identifier

    def _free_id(self, base, region):
        """`base`, or with the region after it, or with the first free number."""

        def fitted(suffix):
            return base[: MAX_ID_LEN - len(suffix)].rstrip("-") + suffix

        candidates = [base, fitted(f"-{slug(region or EDGE_REGION, EDGE_REGION)}")]
        number = 2
        while True:
            for candidate in candidates:
                if candidate not in self._ids:
                    self._ids.add(candidate)
                    return candidate
            candidates = [fitted(f"-{number}")]
            number += 1

    def relate(self, source, target, basis, evidence):
        """States a connection. An end that is not listed leaves it unwritten."""
        if basis not in BASES:
            raise CollectError(f"Unknown basis {basis!r}.")
        self._relations.append((source, target, basis, evidence))

    def join(self, key, group):
        """Says a resource is a member of a group a network rule may name."""
        members = self._members.setdefault(group, [])
        if key not in members:
            members.append(key)

    def admit(self, source_group, target_group, evidence):
        """A network rule: the members of one group may reach those of another."""
        self._rules.append((source_group, target_group, evidence))

    def note(self, text):
        if text not in self._notes:
            self._notes.append(text)

    def attempt(self, what, read):
        """Makes one read. A refusal is noted and the collection goes on.

        The note holds the provider's short name for the refusal and nothing
        else of what it said; the whole of it goes to the operator's screen.
        """
        try:
            return read()
        except CliError as error:
            print(f"{what}: {error}", file=sys.stderr)
            self._failures.append(error.code)
            self.note(f"{what} could not be read ({error.code}).")
            return None

    def _named(self, option, name):
        found = [
            resource["key"] for resource in self._resources if resource["name"] == name
        ]
        if len(found) != 1:
            raise CollectError(
                f"{option} names {name!r}, which {len(found)} resources are called; "
                "it must name exactly one."
            )
        return found[0]

    def declare_kinds(self, pairs):
        """Gives the one resource called NAME the declared KIND."""
        for name, kind in pairs:
            key = self._named("--type", name)
            self._resources[self._by_key[key]]["type"] = kind

    def declare_relations(self, pairs):
        """States a connection between two resources by their names."""
        for source, target in pairs:
            self.relate(
                self._named("--relation", source),
                self._named("--relation", target),
                "declared",
                DECLARED,
            )

    def _asked_for(self, resource):
        tags = resource["tags"]
        return all(
            key in tags and (value is None or tags[key] == value)
            for key, value in self.only_tags
        )

    def document(self, collected_at):
        """The inventory as the file holds it."""
        kept = [resource for resource in self._resources if self._asked_for(resource)]
        if not kept:
            if self._failures:
                raise CollectError(
                    f"Nothing was read: every list that was asked for was refused "
                    f"({self._failures[0]}). Check the credentials and what they may read."
                )
            raise CollectError(
                "Nothing was found to list: no resource of a kind this collector "
                "reads, in what it was asked to read."
            )
        if len(kept) > MAX_RESOURCES:
            raise CollectError(
                f"{len(kept)} resources were found; a file holds at most "
                f"{MAX_RESOURCES}. Narrow the collection with --region or --tag."
            )
        ids = {resource["key"]: resource["id"] for resource in kept}

        crowded = 0
        resources = []
        for resource in kept:
            tags = {
                cut(key, MAX_TAG_KEY_LEN): cut(str(value), MAX_TAG_VALUE_LEN)
                for key, value in sorted(resource["tags"].items())
                if key and (self.tag_keys is None or key in self.tag_keys)
            }
            if len(tags) > MAX_TAGS:
                crowded += 1
                tags = dict(list(tags.items())[:MAX_TAGS])
            written = {
                "id": resource["id"],
                "name": cut(resource["name"]),
                "type": resource["type"],
                "native": cut(resource["native"]),
                "region": resource["region"],
            }
            if resource["network"]:
                written["network"] = cut(resource["network"])
            if tags:
                written["tags"] = tags
            if resource["public"]:
                written["public"] = True
            if resource["members"]:
                written["members"] = resource["members"]
            resources.append(written)
        if crowded:
            self.note(
                f"{crowded} resources carry more than {MAX_TAGS} tags; "
                f"the first {MAX_TAGS} by key were written."
            )

        relations = []
        seen = set()

        def state(source, target, basis, evidence):
            if source == target or source not in ids or target not in ids:
                return
            pair = (ids[source], ids[target], basis)
            if pair in seen:
                return
            seen.add(pair)
            relations.append(
                {
                    "from": pair[0],
                    "to": pair[1],
                    "basis": basis,
                    "evidence": cut(evidence),
                }
            )

        for relation in self._relations:
            state(*relation)
        if len(relations) > MAX_RELATIONS:
            raise CollectError(
                f"{len(relations)} relations were found; a file holds at most "
                f"{MAX_RELATIONS}. Narrow the collection with --region or --tag."
            )
        if self.network_rules:
            for source_group, target_group, evidence in self._rules:
                for source in self._members.get(source_group, ()):
                    for target in self._members.get(target_group, ()):
                        state(source, target, "network", evidence)
                if len(relations) > MAX_RELATIONS:
                    raise CollectError(
                        f"The network rules come to more than {MAX_RELATIONS} "
                        "relations between the resources they admit. Narrow the "
                        "collection with --region or --tag, or leave the rules "
                        "out with --no-network-rules."
                    )
        else:
            self.note(
                "Network rules were not read: no connection in this file comes from one."
            )

        notes = [cut(note, MAX_NOTE_LEN) for note in self._notes]
        if len(notes) > MAX_NOTES:
            dropped = len(notes) - (MAX_NOTES - 1)
            notes = notes[: MAX_NOTES - 1] + [f"{dropped} more notes were not written."]
        document = {
            "kind": KIND,
            "version": VERSION,
            "provider": self.provider,
            "name": self.name,
            "collectedAt": collected_at,
            "resources": resources,
            "relations": relations,
        }
        if notes:
            document["notes"] = notes
        return document


# ---------------------------------------------------------------------------
# Arguments every collector reads
# ---------------------------------------------------------------------------


def plain(value):
    """A name handed on to a CLI as a value: never something it reads as an option."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}", value):
        raise argparse.ArgumentTypeError(
            f"expected a name of letters, digits and . _ : / @ -, not starting "
            f"with a dash; got {value!r}"
        )
    return value


def tag_pair(value):
    """Parse one --tag KEY or KEY=VALUE. The key is everything before the first '='."""
    key, separator, wanted = value.partition("=")
    if not key:
        raise argparse.ArgumentTypeError(
            f"expected KEY or KEY=VALUE, such as env=prod; got {value!r}"
        )
    return key, (wanted if separator else None)


def kind_pair(value):
    """Parse one --type NAME=KIND. The name is everything before the last '='."""
    name, separator, kind = value.rpartition("=")
    if not separator or not name:
        raise argparse.ArgumentTypeError(
            f"expected NAME=KIND, such as orders-db=database; got {value!r}"
        )
    kinds = [kind for kind in SERVICE_TYPES if kind != "external-client"]
    if kind not in kinds:
        raise argparse.ArgumentTypeError(
            f"unknown kind {kind!r} for {name!r}; expected one of: {', '.join(kinds)}"
        )
    return name, kind


def relation_pair(value):
    """Parse one --relation FROM=TO, by the names of two resources."""
    source, separator, target = value.partition("=")
    if not separator or not source or not target:
        raise argparse.ArgumentTypeError(
            f"expected FROM=TO, such as checkout=order-events; got {value!r}"
        )
    return source, target


def common_arguments(parser):
    """The arguments that mean the same whichever provider is read."""
    parser.add_argument(
        "--name",
        help="The platform's name in AEGIS (1-64 characters); it need not be the account's",
    )
    parser.add_argument(
        "--tag",
        dest="tags",
        action="append",
        type=tag_pair,
        default=[],
        metavar="KEY[=VALUE]",
        help="Write only resources that carry this tag or label; repeat to ask for several",
    )
    parser.add_argument(
        "--tag-key",
        dest="tag_keys",
        action="append",
        metavar="KEY",
        help="Write only this tag key of each resource; repeat for several. "
        "Without it every tag is written",
    )
    parser.add_argument(
        "--type",
        dest="types",
        action="append",
        type=kind_pair,
        default=[],
        metavar="NAME=KIND",
        help="Declare the kind of the one resource with exactly this name; repeat for several",
    )
    parser.add_argument(
        "--relation",
        dest="relations",
        action="append",
        type=relation_pair,
        default=[],
        metavar="FROM=TO",
        help="Declare a connection between two resources by their names; repeat for several",
    )
    parser.add_argument(
        "--no-network-rules",
        action="store_true",
        help="Do not read network rules: no connection is drawn from a permission to reach",
    )
    parser.add_argument(
        "--output", type=Path, required=True, help="Path to a new JSON file"
    )


def write(path, document):
    """Writes the inventory to a new file, within what the server reads."""
    for layout in ({"indent": 2}, {"separators": (",", ":")}):
        data = (
            json.dumps(document, ensure_ascii=False, allow_nan=False, **layout) + "\n"
        ).encode()
        if len(data) <= MAX_BYTES:
            break
    else:
        raise CollectError(
            "The inventory exceeds 4 MiB, the most the server reads in one file. "
            "Narrow the collection with --region or --tag."
        )
    try:
        with path.open("xb") as file:
            file.write(data)
    except FileExistsError as error:
        raise CollectError(f"Output already exists: {path}") from error
