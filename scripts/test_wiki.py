"""The wiki, held together in its two languages.

`docs/wiki/` is the source of the project's GitHub wiki. `en/` and `pt-BR/`
hold one page per file, named as the wiki names the page, and `_Sidebar.md`
and `_Footer.md` are shared by both. A page and its translation are one page
in two languages, so each names the other on its first line, they keep the
same sections in the same order, and their code is the same code: a command
is not translated. Every link a page holds reaches something that exists: a
page of its own language, a heading of that page, or a file of this
repository on `main`. An image is one of `docs/assets/`, which only
`scripts/capture-docs.sh` writes.
"""

import re
import unicodedata
import unittest
from pathlib import Path
from urllib.parse import unquote

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
WIKI = ROOT / "docs" / "wiki"
LANGUAGES = ("en", "pt-BR")
SHARED = ("_Sidebar.md", "_Footer.md")
REPOSITORY = "https://github.com/cleissonbarbosa/csdt/"
RAW = "https://raw.githubusercontent.com/cleissonbarbosa/csdt/main/"

SWITCH = {
    "en": re.compile(r"\*\*English\*\* · \[Português\]\(([^)#\s]+)\)"),
    "pt-BR": re.compile(r"\[English\]\(([^)#\s]+)\) · \*\*Português\*\*"),
}
FENCE = re.compile(r"^(`{3,})([^`\n]*)\n(.*?)^\1`*[ \t]*$", re.M | re.S)
INLINE = re.compile(r"`[^`\n]+`")
HEADING = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*$", re.M)
LINK = re.compile(r"(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HTML_IMAGE = re.compile(r"<img\b[^>]*\bsrc=\"([^\"]+)\"")


def pages(language):
    """Page name → text, for one language."""
    return {
        path.stem: path.read_text("utf-8") for path in sorted((WIKI / language).glob("*.md"))
    }


ALL = {language: pages(language) for language in LANGUAGES}
EVERY = {name: text for language in LANGUAGES for name, text in ALL[language].items()}


def without_code(text):
    return INLINE.sub("", FENCE.sub("", text))


def headings(text):
    """(level, title) of every heading outside a code block."""
    return [(len(marks), title) for marks, title in HEADING.findall(FENCE.sub("", text))]


def slug(title):
    """The anchor GitHub gives a heading."""
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", title).replace("`", "").lower()
    kept = "".join(
        c
        for c in text
        if c.isalnum() or c in "-_ " or unicodedata.category(c).startswith("M")
    )
    return kept.replace(" ", "-")


def anchors(text):
    seen = {}
    found = set()
    for _, title in headings(text):
        base = slug(title)
        count = seen.get(base, 0)
        found.add(base if count == 0 else f"{base}-{count}")
        seen[base] = count + 1
    return found


def blocks(text):
    """(info string, body) of every fenced block."""
    return [(info.strip(), body) for _, info, body in FENCE.findall(text)]


def partner(language, name):
    """The page the first line names as this one in the other language."""
    first = ALL[language][name].split("\n", 1)[0]
    match = SWITCH[language].fullmatch(first.strip())
    return unquote(match.group(1)) if match else None


def file_on_main(target, prefix):
    path = unquote(target[len(prefix) :].split("#", 1)[0].split("?", 1)[0])
    return (ROOT / path).exists()


def link_problems(target, reachable, here):
    if target.startswith("#"):
        return [] if target[1:] in anchors(here) else [f"no heading {target} on this page"]
    if target.startswith("http://"):
        return [f"not https: {target}"]
    if target.startswith(RAW):
        return [] if file_on_main(target, RAW) else [f"no such file on main: {target}"]
    for kind in ("blob/main/", "tree/main/"):
        if target.startswith(REPOSITORY + kind):
            ok = file_on_main(target, REPOSITORY + kind)
            return [] if ok else [f"no such file on main: {target}"]
    if target.startswith(REPOSITORY + "wiki"):
        return [f"a wiki page linked by its address, not by its name: {target}"]
    if target.startswith("https://"):
        return []
    name, _, anchor = unquote(target).partition("#")
    if name not in reachable:
        return [f"no page {name!r} to link to"]
    if anchor and anchor not in anchors(reachable[name]):
        return [f"no heading #{anchor} on {name}"]
    return []


def problems(text, reachable, here):
    """What is wrong with the links and images of a text."""
    found = []
    plain = without_code(text)
    targets = [(bang == "!", target) for bang, _, target in LINK.findall(plain)]
    targets += [(True, source) for source in HTML_IMAGE.findall(plain)]
    for image, target in targets:
        if not image:
            found += link_problems(target, reachable, here)
        elif not target.startswith(RAW + "docs/assets/"):
            found.append(f"an image that is not one of docs/assets on main: {target}")
        elif not file_on_main(target, RAW):
            found.append(f"no such image: {target}")
    return found


def body(text):
    """A page without its first line, the language switch."""
    return text.split("\n", 1)[1] if "\n" in text else ""


class PagesTest(unittest.TestCase):
    def test_the_wiki_holds_two_languages_and_the_shared_files_only(self):
        self.assertEqual(
            sorted(path.name for path in WIKI.iterdir()), sorted([*LANGUAGES, *SHARED])
        )
        for language in LANGUAGES:
            self.assertTrue(ALL[language], language)
            for path in (WIKI / language).iterdir():
                self.assertTrue(path.is_file() and path.suffix == ".md", path)
        names = [name for language in LANGUAGES for name in ALL[language]]
        self.assertEqual(len(names), len(set(names)), "a page name used in both languages")

    def test_every_page_names_its_translation_and_is_named_back(self):
        for language, other in (("en", "pt-BR"), ("pt-BR", "en")):
            for name in ALL[language]:
                with self.subTest(page=f"{language}/{name}"):
                    there = partner(language, name)
                    self.assertIsNotNone(there, "the first line is not the language switch")
                    self.assertIn(there, ALL[other])
                    self.assertEqual(partner(other, there), name)

    def test_a_page_and_its_translation_have_the_same_sections(self):
        for name, text in ALL["en"].items():
            there = partner("en", name)
            if there in ALL["pt-BR"]:
                with self.subTest(page=name):
                    self.assertEqual(
                        [level for level, _ in headings(text)],
                        [level for level, _ in headings(ALL["pt-BR"][there])],
                    )

    def test_a_page_and_its_translation_have_the_same_code(self):
        for name, text in ALL["en"].items():
            there = partner("en", name)
            if there in ALL["pt-BR"]:
                with self.subTest(page=name):
                    mine, theirs = blocks(text), blocks(ALL["pt-BR"][there])
                    # A diagram's labels are words, so a diagram is translated.
                    self.assertEqual(
                        [block for block in mine if block[0] != "mermaid"],
                        [block for block in theirs if block[0] != "mermaid"],
                    )
                    self.assertEqual(
                        [info for info, _ in mine], [info for info, _ in theirs]
                    )

    def test_no_page_repeats_the_title_the_wiki_gives_it(self):
        for name, text in EVERY.items():
            with self.subTest(page=name):
                self.assertNotIn(1, [level for level, _ in headings(text)])

    def test_every_link_and_image_of_a_page_reaches_something_that_exists(self):
        for language in LANGUAGES:
            for name, text in ALL[language].items():
                with self.subTest(page=f"{language}/{name}"):
                    self.assertEqual(problems(body(text), ALL[language], text), [])

    def test_the_sidebar_lists_every_page_and_the_footer_reaches_what_it_names(self):
        for shared in SHARED:
            text = (WIKI / shared).read_text("utf-8")
            with self.subTest(file=shared):
                self.assertEqual(problems(text, EVERY, text), [])
        sidebar = without_code((WIKI / "_Sidebar.md").read_text("utf-8"))
        listed = {
            unquote(target).partition("#")[0]
            for bang, _, target in LINK.findall(sidebar)
            if not bang
        }
        self.assertEqual(set(EVERY) - listed, set())


class SlugTest(unittest.TestCase):
    def test_an_anchor_is_made_as_github_makes_it(self):
        self.assertEqual(slug("Run it on your own files"), "run-it-on-your-own-files")
        self.assertEqual(slug("The `/stream` protocol"), "the-stream-protocol")
        self.assertEqual(slug("Políticas e decisões"), "políticas-e-decisões")
        self.assertEqual(slug("A · B"), "a--b")
        self.assertEqual(anchors("## Tests\n\n## Tests\n"), {"tests", "tests-1"})


if __name__ == "__main__":
    unittest.main()
