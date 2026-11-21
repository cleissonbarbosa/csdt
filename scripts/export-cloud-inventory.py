#!/usr/bin/env python3
"""Write an AEGIS cloud inventory from what a provider lists of an account.

Reads, through the provider's own CLI and with the operator's own access,
the resources of the kinds AEGIS has a piece for and the connections the
provider itself states between them, and writes them to one file. Drop the
file on AEGIS's import dialog, or put it in a workspace's `topologies/`, and
it is read as a topology. Every call is a read; nothing is changed.
"""

import argparse
import subprocess
import sys

from cloud_inventory import aws, core, gcp, oci

COLLECTORS = (aws, gcp, oci)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__.splitlines()[0],
        epilog="Each provider has its own arguments: see <provider> --help.",
    )
    providers = parser.add_subparsers(dest="provider", required=True, metavar="PROVIDER")
    kinds = [kind for kind in core.SERVICE_TYPES if kind != "external-client"]
    for collector in COLLECTORS:
        one = providers.add_parser(
            collector.NAME,
            help=collector.HELP,
            description=collector.__doc__.strip().splitlines()[0],
            epilog=f"Kinds: {', '.join(kinds)}.",
        )
        collector.arguments(one)
        core.common_arguments(one)
    args = parser.parse_args(argv)
    collector = next(one for one in COLLECTORS if one.NAME == args.provider)
    try:
        if args.output.exists():
            raise core.CollectError(f"Output already exists: {args.output}")
        inventory = core.Inventory(
            collector.NAME,
            args.name or collector.default_name(args),
            only_tags=args.tags,
            tag_keys=args.tag_keys,
            network_rules=not args.no_network_rules,
        )
        collector.collect(inventory, collector.client(args), args)
        inventory.declare_kinds(args.types)
        inventory.declare_relations(args.relations)
        document = inventory.document(core.now())
        core.write(args.output, document)
        print(
            f"Wrote {args.output} ({len(document['resources'])} resources, "
            f"{len(document['relations'])} relations)."
        )
        for note in document.get("notes", []):
            print(f"Note: {note}", file=sys.stderr)
    except (
        core.CollectError,
        core.CliError,
        OSError,
        subprocess.SubprocessError,
        ValueError,
        KeyError,
        TypeError,
    ) as error:
        parser.exit(1, f"Inventory failed: {error}\n")


if __name__ == "__main__":
    main()
