"""
Builds the AEGIS identity: the mark, the logos, the favicon and the icons.

    python3 apps/web/scripts/build-identity.py
    python3 apps/web/scripts/build-identity.py --chrome /path/to/chrome

Needs fontTools (`pip install fonttools`), Google Chrome, and the web
client's dependencies (`pnpm install`), which hold the B612 font. Like
`build-pieces.py` it is a tool for whoever changes the identity: CI does not
run it, and what it writes is committed.

The mark is a passage through nested gates, the stages a request crosses
seen as one doorway, with a single line resting in the passage: the route,
neither selected nor abnormal. It is drawn in strokes on a 128 unit square,
in two tones and no hue: graphite for the gates and a quieter grey for the
line. Every colour is read from the tokens in `apps/web/src/index.css`, so
the identity cannot drift from the interface; the line is
`--color-logo-line`. The words are B612, the interface's own type, turned
into outlines here so that a file looks the same where B612 is not installed
(a README on GitHub, an image viewer). The client draws the same mark inline
(`src/features/topnav/Logo.tsx`), and `Logo.test.ts` holds the two to the
same strokes.

Writes, in `docs/assets/identity/`:

    aegis-symbol[-dark].svg          the mark alone, on nothing
    aegis-symbol[-dark]-512.png
    aegis-logo[-dark].svg            mark, name and descriptor in a row
    aegis-logo[-dark]-2x.png
    aegis-logo-compact[-dark].svg    mark and name
    aegis-lockup-stacked[-dark].svg  mark over name over descriptor
    aegis-favicon.svg                the mark on a plate; follows the system's theme
    aegis-favicon-32.png, -64.png
    aegis-brand-preview.png          a sheet of all of it

and in `apps/web/public/`: `favicon.svg` (the same file as above),
`apple-touch-icon.png`, `icon-192.png` and `icon-512.png`, which
`index.html` and `manifest.webmanifest` name.
"""

import argparse
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont
except ImportError:
    sys.exit("build-identity: needs fontTools (pip install fonttools)")

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "apps" / "web"
OUT = ROOT / "docs" / "assets" / "identity"
PUBLIC = WEB / "public"
FONTS = WEB / "node_modules" / "@fontsource" / "b612" / "files"

# The mark on its 128 unit square: three gates, outermost first, each a
# stroke of its own weight, then the line resting in the passage.
GATES = (
    ("M14 106 V43 L58 18 H70 L114 43 V106", 12),
    ("M31 106 V54 L59 38 H69 L97 54 V106", 10),
    ("M48 106 V67 L60 60 H68 L80 67 V106", 8),
)
LINE = ("M64 86 V106", 8)
# The plate a favicon or an icon stands on: the interface's own, rounded as
# a card is (10 px of a 72 px card, near enough 18 of 128).
PLATE_RADIUS = 18

NAME = "AEGIS"
DESCRIPTOR = "Cloud Security Digital Twin"


# --- Colours -----------------------------------------------------------------


def tokens():
    """The light and night values of the colour tokens, from `index.css`."""
    css = (WEB / "src" / "index.css").read_text(encoding="utf-8")

    def block(opening):
        start = css.index(opening)
        # The colours come first in each block, before anything nested.
        found = dict(re.findall(r"--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})", css[start : css.index("}", start)]))
        return {name: value.upper() for name, value in found.items()}

    light = block("@theme {")
    night = {**light, **block(":root[data-theme='night'] {")}
    for theme in (light, night):
        for name in ("plate", "ink", "ink-dim", "logo-line", "line", "focus"):
            if name not in theme:
                sys.exit(f"build-identity: index.css has no --color-{name}")
    return {"light": light, "night": night}


# --- Type --------------------------------------------------------------------


def number(value):
    """A coordinate, short: two decimals at most and no negative zero."""
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


class Face:
    """One weight of B612, set the way a browser sets it: advances and kerning."""

    def __init__(self, weight):
        path = FONTS / f"b612-latin-{weight}-normal.woff"
        if not path.exists():
            sys.exit(f"build-identity: {path} is missing; run pnpm install")
        self.font = TTFont(path)
        self.upm = self.font["head"].unitsPerEm
        self.cmap = self.font.getBestCmap()
        self.glyphs = self.font.getGlyphSet()
        self.advance = self.font["hmtx"]
        self.kerning = self._kerning_subtables()

    def _kerning_subtables(self):
        if "GPOS" not in self.font:
            return []
        table = self.font["GPOS"].table
        indices = sorted(
            {i for r in table.FeatureList.FeatureRecord if r.FeatureTag == "kern" for i in r.Feature.LookupListIndex}
        )
        found = []
        for index in indices:
            lookup = table.LookupList.Lookup[index]
            for sub in lookup.SubTable:
                if lookup.LookupType == 9:
                    sub = sub.ExtSubTable
                if getattr(sub, "LookupType", 2) == 2:
                    found.append(sub)
        return found

    def kern(self, first, second):
        """The pair adjustment between two glyphs, in font units."""
        for sub in self.kerning:
            covered = sub.Coverage.glyphs
            if first not in covered:
                continue
            if sub.Format == 1:
                for record in sub.PairSet[covered.index(first)].PairValueRecord:
                    if record.SecondGlyph == second:
                        return getattr(record.Value1, "XAdvance", 0) or 0
            elif sub.Format == 2:
                one = sub.ClassDef1.classDefs.get(first, 0)
                two = sub.ClassDef2.classDefs.get(second, 0)
                value = sub.Class1Record[one].Class2Record[two].Value1
                return getattr(value, "XAdvance", 0) or 0
        return 0

    def _place(self, text, size, spacing):
        scale = size / self.upm
        names = [self.cmap[ord(c)] for c in text]
        placed, x = [], 0.0
        for i, name in enumerate(names):
            placed.append((name, x))
            x += self.advance[name][0] * scale
            if i + 1 < len(names):
                x += self.kern(name, names[i + 1]) * scale + spacing
        return placed, x

    def width(self, text, size, spacing=0.0):
        """From the first pen position to the last glyph's advance."""
        return self._place(text, size, spacing)[1]

    def outline(self, text, size, x, baseline, spacing=0.0):
        """The line as one SVG path, and the right edge of its ink."""
        scale = size / self.upm
        placed, _ = self._place(text, size, spacing)
        pen = SVGPathPen(self.glyphs, ntos=number)
        right = x
        for name, at in placed:
            transform = (scale, 0, 0, -scale, x + at, baseline)
            self.glyphs[name].draw(TransformPen(pen, transform))
            bounds = BoundsPen(self.glyphs)
            self.glyphs[name].draw(bounds)
            if bounds.bounds:
                right = max(right, x + at + bounds.bounds[2] * scale)
        return pen.getCommands(), right


BOLD = Face(700)
REGULAR = Face(400)


def words(face, text, size, x, baseline, fill, spacing=0.0, anchor="start"):
    """A line of words as a path; `anchor` is where `x` sits, as in SVG."""
    if anchor == "middle":
        x -= face.width(text, size, spacing) / 2
    d, right = face.outline(text, size, x, baseline, spacing)
    return f'<path fill="{fill}" d="{d}"/>', right


# --- Drawings ----------------------------------------------------------------


def mark(gates, line, at=(0, 0), scale=1.0):
    """The mark, placed; colours are literal values or `class:` names."""

    def paint(colour):
        return f'class="{colour[6:]}"' if colour.startswith("class:") else f'stroke="{colour}"'

    move = ""
    if at != (0, 0) or scale != 1:
        zoom = f" scale({number(scale)})" if scale != 1 else ""
        move = f' transform="translate({number(at[0])} {number(at[1])}){zoom}"'
    paths = "".join(f'<path d="{d}" stroke-width="{w}"/>' for d, w in GATES)
    return (
        f'<g{move} fill="none" stroke-linejoin="bevel" stroke-linecap="butt">'
        f"<g {paint(gates)}>{paths}</g>"
        f'<path {paint(line)} d="{LINE[0]}" stroke-width="{LINE[1]}"/>'
        "</g>"
    )


def svg(body, label, width=None, height=None, viewbox=None):
    size = f' width="{number(width)}" height="{number(height)}"' if width else ""
    box = viewbox or f"0 0 {number(width)} {number(height)}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg"{size} viewBox="{box}" role="img" aria-label="{label}">\n'
        f"{body}\n</svg>\n"
    )


def symbol(theme, size=None):
    return svg(mark(theme["ink"], theme["logo-line"]), "AEGIS", size, size, "0 0 128 128")


def plated(theme, size=None, radius=PLATE_RADIUS):
    body = f'<rect width="128" height="128" rx="{radius}" fill="{theme["plate"]}"/>' + mark(
        theme["ink"], theme["logo-line"]
    )
    return svg(body, "AEGIS", size, size, "0 0 128 128")


def favicon(palette):
    """The mark on a plate, in the light or night values as the system is set."""
    light, night = palette["light"], palette["night"]
    style = (
        "<style>"
        f".plate{{fill:{light['plate']}}}.gates{{stroke:{light['ink']}}}.line{{stroke:{light['logo-line']}}}"
        "@media (prefers-color-scheme:dark){"
        f".plate{{fill:{night['plate']}}}.gates{{stroke:{night['ink']}}}.line{{stroke:{night['logo-line']}}}"
        "}</style>"
    )
    body = f'{style}<rect class="plate" width="128" height="128" rx="{PLATE_RADIUS}"/>' + mark(
        "class:gates", "class:line"
    )
    return svg(body, "AEGIS", viewbox="0 0 128 128")


# The row: the mark at the left with its ink 13 units in, the name beside
# it, the descriptor under the name. The right margin repeats the left one.
ROW_HEIGHT = 160
ROW_MARGIN = 13


def row(theme, descriptor=True):
    name, right = words(BOLD, NAME, 76, 158, 89, theme["ink"], spacing=-2.1)
    parts = [mark(theme["ink"], theme["logo-line"], at=(5, 9)), name]
    if descriptor:
        line, edge = words(REGULAR, DESCRIPTOR, 18, 160, 119, theme["ink-dim"], spacing=0.1)
        parts.append(line)
        right = max(right, edge)
    width = round(right + ROW_MARGIN)
    label = f"{NAME}, {DESCRIPTOR}" if descriptor else NAME
    return svg("".join(parts), label, width, ROW_HEIGHT), width


STACK = (400, 348)


def stacked(theme):
    middle = STACK[0] / 2
    name, _ = words(BOLD, NAME, 69, middle, 227, theme["ink"], spacing=-1.5, anchor="middle")
    line, _ = words(REGULAR, DESCRIPTOR, 18, middle, 263, theme["ink-dim"], anchor="middle")
    body = mark(theme["ink"], theme["logo-line"], at=(136, 34)) + name + line
    return svg(body, f"{NAME}, {DESCRIPTOR}", *STACK)


PREVIEW = (1600, 1080)


def preview(palette):
    """A sheet of the identity: both themes, the symbol at its sizes, the tones."""
    light, night = palette["light"], palette["night"]
    dim, ink, rule = light["ink-dim"], light["ink"], light["line"]

    def label(text, x, y, fill=dim, size=18, face=REGULAR):
        return words(face, text, size, x, y, fill)[0]

    def logo(theme, x, y):
        inner = row(theme)[0]
        inner = inner[inner.index(">", inner.index("<svg")) + 1 : inner.rindex("</svg>")]
        return f'<g transform="translate({x} {y})">{inner}</g>'

    parts = [
        f'<rect width="{PREVIEW[0]}" height="{PREVIEW[1]}" fill="{light["plate"]}"/>',
        label(f"{NAME} · Visual identity", 84, 74, ink, face=BOLD),
        label("Signal Field. A model, not a hologram.", 84, 124, size=26),
        f'<path d="M84 164 H1516" stroke="{rule}" stroke-width="2"/>',
        label("01  /  Primary mark", 90, 212),
        logo(light, 80, 236),
        label("Porcelain  /  graphite  /  structure", 90, 434),
        f'<rect x="84" y="493" width="976" height="272" rx="10" fill="{night["plate"]}"/>',
        label("02  /  Night theme", 116, 543, night["ink-dim"]),
        logo(night, 108, 572),
        label("03  /  Symbol", 1128, 212),
        mark(light["ink"], light["logo-line"], at=(1180, 230), scale=1.8),
        label("Responsive mark", 1128, 546),
    ]
    x = 1128
    for size in (64, 32, 16):
        parts.append(mark(light["ink"], light["logo-line"], at=(x, 640 - size * 106 / 128), scale=size / 128))
        parts.append(label(f"{size} px", x, 676, size=16))
        x += size + 56
    parts += [
        f'<path d="M84 820 H1516" stroke="{rule}" stroke-width="2"/>',
        label("04  /  Design tokens", 86, 866),
    ]
    swatches = (
        ("Porcelain", light["plate"]),
        ("Graphite", light["ink"]),
        ("Structure", light["logo-line"]),
        ("Focus*", light["focus"]),
    )
    for i, (name, value) in enumerate(swatches):
        x = 86 + i * 330
        parts.append(
            f'<rect x="{x}" y="892" width="62" height="62" rx="6" fill="{value}" stroke="{rule}" stroke-width="2"/>'
        )
        parts.append(label(name, x + 82, 917, ink, size=20))
        parts.append(label(value, x + 82, 946))
    parts.append(label("* Focus is for interaction only. The identity itself stays monochrome.", 86, 1018))
    return svg("".join(parts), f"{NAME} visual identity", *PREVIEW)


# --- Pictures ----------------------------------------------------------------


def find_chrome(given):
    for candidate in (given, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if candidate and shutil.which(candidate):
            return shutil.which(candidate)
    sys.exit("build-identity: needs Google Chrome to draw the PNGs (or pass --chrome)")


def png_size(path):
    with open(path, "rb") as file:
        head = file.read(24)
    return struct.unpack(">II", head[16:24])


def rasterise(chrome, text, width, height, out, scale=1):
    """Draws an SVG at `scale` with Chrome, on a transparent page."""
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "image.svg"
        source.write_text(text, encoding="utf-8")
        subprocess.run(
            [
                chrome,
                "--headless=new",
                "--disable-gpu",
                "--hide-scrollbars",
                "--no-first-run",
                "--no-default-browser-check",
                f"--user-data-dir={Path(tmp) / 'profile'}",
                "--default-background-color=00000000",
                f"--force-device-scale-factor={scale}",
                f"--window-size={width},{height}",
                f"--screenshot={out}",
                source.as_uri(),
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )
    expected = (round(width * scale), round(height * scale))
    if png_size(out) != expected:
        sys.exit(f"build-identity: {out.name} came out {png_size(out)}, not {expected}")


def write(path, text):
    path.write_text(text, encoding="utf-8")
    print(f"  wrote {path.relative_to(ROOT)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--chrome", help="the Chrome or Chromium binary to draw the PNGs with")
    args = parser.parse_args()
    chrome = find_chrome(args.chrome)
    palette = tokens()
    light, night = palette["light"], palette["night"]
    OUT.mkdir(parents=True, exist_ok=True)

    for suffix, theme in (("", light), ("-dark", night)):
        write(OUT / f"aegis-symbol{suffix}.svg", symbol(theme))
        rasterise(chrome, symbol(theme, 512), 512, 512, OUT / f"aegis-symbol{suffix}-512.png")
        text, width = row(theme)
        write(OUT / f"aegis-logo{suffix}.svg", text)
        rasterise(chrome, text, width, ROW_HEIGHT, OUT / f"aegis-logo{suffix}-2x.png", scale=2)
        write(OUT / f"aegis-logo-compact{suffix}.svg", row(theme, descriptor=False)[0])
        write(OUT / f"aegis-lockup-stacked{suffix}.svg", stacked(theme))

    icon = favicon(palette)
    write(OUT / "aegis-favicon.svg", icon)
    write(PUBLIC / "favicon.svg", icon)
    for size in (32, 64):
        rasterise(chrome, plated(light, size), size, size, OUT / f"aegis-favicon-{size}.png")
    # A home screen rounds the corners itself, so its icon is square.
    rasterise(chrome, plated(light, 180, radius=0), 180, 180, PUBLIC / "apple-touch-icon.png")
    for size in (192, 512):
        rasterise(chrome, plated(light, size), size, size, PUBLIC / f"icon-{size}.png")
    rasterise(chrome, preview(palette), *PREVIEW, OUT / "aegis-brand-preview.png")
    print("  drew the PNGs with", chrome)


if __name__ == "__main__":
    main()
