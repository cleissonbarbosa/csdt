"""The document of the cloud inventory collectors, held to the collectors.

`docs/INVENTORY.md` says what each collector reads, what it does not, the
least access it needs and how it is run. Those are statements an operator
grants access by, so each is checked against the code that makes the calls.
"""

import contextlib
import importlib.util
import io
import json
import re
import unittest
from pathlib import Path

from cloud_inventory import aws, gcp, oci

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DOC = (ROOT / "docs" / "INVENTORY.md").read_text("utf-8")
COMMAND = (ROOT / "apps" / "web" / "src" / "features" / "workspace" / "cloudCommand.ts").read_text(
    "utf-8"
)


def section(title):
    """The text of one `### title` section, up to the next one."""
    return DOC.split(f"\n### {title}\n", 1)[1].split("\n### ", 1)[0]


def fenced(text, language):
    return re.findall(rf"```{language}\n(.*?)```", text, re.S)


def flat(text):
    """Prose with its line breaks taken out, to compare with a note."""
    return " ".join(text.split()).replace("`", "")


SECTIONS = {"AWS": aws, "Google Cloud": gcp, "Oracle Cloud": oci}


class AccessTest(unittest.TestCase):
    def test_the_aws_policy_is_the_actions_the_reads_need(self):
        policy = json.loads(fenced(section("AWS"), "json")[0])
        self.assertEqual(policy["Statement"][0]["Action"], list(aws.ACTIONS))

    def test_the_google_cloud_roles_are_the_collectors(self):
        granted = fenced(section("Google Cloud"), "text")[0].split()
        self.assertEqual(granted, [*gcp.ROLES, *gcp.PERMISSIONS])

    def test_the_oracle_cloud_statements_are_the_collectors(self):
        statements = fenced(section("Oracle Cloud"), "text")[0].strip().splitlines()
        self.assertEqual(statements, list(oci.POLICY))
        # Reads only: nothing is granted that changes a resource, but the one
        # narrowed `use` that listing a group's rules needs.
        for statement in statements:
            verb = statement.split(" to ", 1)[1].split()[0]
            self.assertIn(verb, ("inspect", "read", "use"), statement)
            if verb == "use":
                self.assertIn("where request.permission=", statement)


class NotReadTest(unittest.TestCase):
    def test_what_each_section_says_is_not_read_is_the_note_the_file_carries(self):
        for title, collector in SECTIONS.items():
            text = flat(section(title))
            for part in re.split(r",\s*|\.\s+| and ", collector.NOT_READ.removeprefix("Not read: ")):
                part = part.strip(" .").removeprefix("and ")
                # The file speaks of the operator; the document to them.
                part = part.replace("the operator's own", "your own")
                # The pointer to --relation and the rule for pools are said in
                # the document's own words.
                if not part or part.startswith(("Declare", "An instance pool")):
                    continue
                self.assertIn(part.split(" (")[0], text, f"{title}: {part}")


class CommandTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location(
            "export_cloud_inventory", HERE / "export-cloud-inventory.py"
        )
        cls.script = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.script)

    def parses(self, words):
        """Whether the script takes these arguments, without running anything."""
        parser_error = io.StringIO()
        with contextlib.redirect_stderr(parser_error), contextlib.redirect_stdout(io.StringIO()):
            try:
                self.script.main([*words, "--help"])
            except SystemExit as exit_:
                return exit_.code == 0, parser_error.getvalue()
        return True, ""

    def test_every_collector_is_offered(self):
        self.assertEqual([one.NAME for one in self.script.COLLECTORS], ["aws", "gcp", "oci"])

    def test_each_documented_command_is_one_the_script_takes(self):
        for title in SECTIONS:
            for block in fenced(section(title), "bash"):
                words = block.replace("\\\n", " ").split()
                self.assertEqual(words[:2], ["python3", "scripts/export-cloud-inventory.py"])
                taken, said = self.parses(words[2:])
                self.assertTrue(taken, f"{title}: {said}")

    def test_the_interface_asks_each_provider_for_what_its_collector_takes(self):
        # cloudCommand.ts writes these options; each must be the collector's.
        asked = {
            provider: re.findall(r"field: '(\w+)', needed: (true|false)", block)
            for provider, block in re.findall(r"\n  (aws|gcp|oci): \[(.*?)\]", COMMAND, re.S)
        }
        flag = {"profile": "--profile", "project": "--project", "compartment": "--compartment", "regions": "--region"}
        for collector in SECTIONS.values():
            parser = self.script.argparse.ArgumentParser()
            collector.arguments(parser)
            options = {
                option: action.required
                for action in parser._actions
                for option in action.option_strings
            }
            for field, needed in asked[collector.NAME]:
                self.assertIn(flag[field], options, f"{collector.NAME}: {field}")
                self.assertEqual(options[flag[field]], needed == "true", f"{collector.NAME}: {field}")
            # And nothing the collector cannot run without is left unasked.
            required = {option for option, needed in options.items() if needed}
            self.assertLessEqual(
                required, {flag[field] for field, _ in asked[collector.NAME]}, collector.NAME
            )


if __name__ == "__main__":
    unittest.main()
