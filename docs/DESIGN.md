# Design

AEGIS looks the way it does for reasons. This page states them, so that a
change to the interface can be judged against something firmer than taste.

## The idea

A digital twin is a scale model, and a scale model does not glow.

AEGIS is drawn as a **mimic board**: the schematic of a plant that hangs in a
control room, with lamps that light only where something needs attention.
The platform is a matte model standing on plates. Everything that is normal
is neutral. **The only colour on the screen is a problem.**

That one rule does most of the work. When a region fails there is nothing
else for the eye to go to, and when nothing is wrong the interface says so
by being quiet.

## Where it comes from

The first version of this interface was a dark "command center": neon cyan
on near-black, bloom, a sci-fi display face, tracked capitals, a status dot
beside every healthy service. It looked finished and said little. With
thirty per cent of requests failing, the screen was still mostly cyan, and
the alarm had to compete with the decoration.

The replacement was derived from fields that have had this problem for
decades:

| Source                                  | What was taken from it                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Control-room mimic boards               | The model itself: a schematic of the plant, lamps for state                                                                          |
| The "dark and quiet" cockpit            | Normal is the absence of a signal. A master caution leads to the system, then to the fault                                           |
| High-performance HMI practice (ISA-101) | Neutral background; colour reserved for abnormal states; state also coded by shape and text; values shown against their normal range |
| Cartography                             | A quiet base and a loud thematic layer; names with a halo, at one size, shown by zoom level                                          |
| Tufte and Few on data display           | Remove ink that is not data; a trend needs its context                                                                               |
| Shneiderman's mantra                    | Overview first, zoom and filter, details on demand                                                                                   |

Links are at the end of the page.

## The rules

**1. Hue is a signal.** There are three: amber for deviation (degraded,
throttled, rejected), red for failure (critical, errors) and magenta for
hostile traffic. Nothing normal has a hue: no brand colour, no "healthy
green", no coloured service types. Selection, focus and primary actions use
ink. A Cedar _Deny_ is not red either, because a policy stopping something
it should stop is the system working; Allow and Deny differ in form.

**2. Normal is silent.** A healthy service has no dot, no badge and no
label saying so. One sentence in the top bar gives the state of the
platform; while everything is normal it reads "51 services, all normal".
When something is wrong the sentence names it, leads to the incident, and
blinks until it has been looked at. That blink is the interface's only
looping animation.

The same goes for the interface itself. At rest the screen holds the model,
that sentence and a strip of timeline, and nothing else: overview first,
details on demand. The explorer comes when it is asked for, the inspector
comes with a selection and leaves with it, and the timeline opens into its
chart when it is reached for. A panel that is always open is a healthy
service with a green dot: it says nothing and takes the room.

**3. A model, not a hologram.** Pieces are matte solids under one fixed
light, standing on plates that cast soft shadows. There is no bloom, no
grid floor, no scan line, no additive blending. The camera uses a long lens
(14°), so parallel lines stay very nearly parallel as in an axonometric
drawing, while orbiting still works.

The pieces are modelled, one per kind of service, as turned and milled
blocks with a single chamfer size: a gate, a shield, a cedar, a lighthouse.
Each is the plainest object that says what the service is, so the kind can
be read from the silhouette at the size of a fingernail. What makes them
read as solids rather than icons is ambient occlusion baked into the model:
a piece is darker where it shades itself and where it meets its plate, as
any object on a table is.

**4. A number comes with its range.** The four signals of the platform
(traffic, latency, errors, saturation) are each drawn on a scale with their
normal band, and so are the figures in the inspector. A value takes a
colour only when it has left the band. The four are in the platform
overview at all times. In the top bar an instrument is on show only while
its reading is outside the band, which is the dark cockpit taken at its
word: with the platform well the bar shows none of them, and the one that
appears is the one to look at.

**5. Shape before colour.** Ordinary traffic is told apart by the shape of
its bead: disc for a request, ring for a response, diamond for
authentication, square for authorization, frame for a queue message. Traffic
that went wrong has a shape too (a bar for a rejection, a triangle for
suspicious traffic) and takes its colour only once it amounts to something:
every platform rejects a little junk and fails a request now and then, and
that routine trickle stays ink. Health
has a glyph as well as a colour: triangle, square, cross. Nothing depends
on telling two hues apart.

**6. Motion means something.** Beads move because requests do, at a rate
that follows the data. Everything else that moves is an answer, to the
viewer or to a change in the data, and it happens once:

| What moves                                                | In answer to              |
| --------------------------------------------------------- | ------------------------- |
| Plates open, pieces land, connections draw themselves     | A topology being laid out |
| Pieces walk to their new places                           | The layout changing       |
| A piece lifts; its connections are redrawn outward        | Selecting it              |
| The rest of the model recedes                             | Something being selected  |
| A piece's connections take ink                            | Pointing at it            |
| A piece is jolted and a ring leaves its lamp              | The service failing       |
| A plate takes its state colour, or goes dark              | Its region changing state |
| A panel slides in and the picture moves over to make room | Asking for the panel      |
| The timeline opens into its chart                         | Reaching for it           |

Each of these says something that a cut would not: where a piece went when
the layout changed, which connections belong to the selection, that the
panel is on top of the model and not instead of it. Pieces do not spin or
bob, nothing idles, and nothing loops except the unacknowledged alarm.
Arrivals share one curve (fast out of the gate, a long settle) and journeys
between two places another, so the motion has one hand. Reduced-motion
preferences, the system's or the application's own, switch all of it off.

## The arrangement

Where a piece stands is the first thing the model says about it, before its
shape and long before its name. The two arrangements
([`graphics/layout.ts`](../apps/web/src/graphics/layout.ts)) follow the same
few decisions.

**A tier is a line, and space is what draws it.** The services of one tier
stand in a straight line. Two tiers are about twice as far apart as two
neighbours within a tier, so the lines can be read without a rule, a band or
a caption being drawn to mark them. Within a line, pieces of a kind stand
together, and among those each stands nearest to what it is connected to in
the lines before it, so connections cross no more than they have to.

**A plate is as large as what stands on it.** A region of twenty-three
services has a larger plate than one of eight, which is itself information,
and no plate carries table it does not use.

**Nothing stands over anything else.** The edge is a low plinth, one step
above the regions and beside them, not a deck above them: a plate that
covers another hides whatever stands under its rim.

**The model faces the viewer.** The first region is turned toward the
opening shot, so its lines run straight across the picture, and the clients
on the hub keep off the line of sight through the router, where one would
hide behind it.

**A name stands off the rim.** A plate's name is hung from a point just
outside the plate, on the side that faces away from the rest of the model,
whichever way that is on screen as the camera turns. It never lies across
the plate it names, and the opening shot is framed to include it.

By region, the model is a hub and its spokes: the edge at the centre, each
region a round plate beside it with its gateway at the hub's side and its
tiers running outward, so requests travel away from the centre everywhere.
By dependency, it is a set of swimlanes: tiers are columns from left to
right, each region is a lane across them, and a tier lines up between
regions. A lane is a plate like any other, so it takes its region's state
colour and goes dark with it.

## Tokens

Defined in [`apps/web/src/index.css`](../apps/web/src/index.css) for the
interface and mirrored in
[`apps/web/src/lib/palette.ts`](../apps/web/src/lib/palette.ts) for the 3D
scene, which cannot read CSS custom properties.

| Role                | Light     | Night     |
| ------------------- | --------- | --------- |
| Plate (page, table) | `#E3E5E4` | `#1D1F20` |
| Paper (panels)      | `#F3F4F2` | `#26282A` |
| Line                | `#CDD0D0` | `#3A3D40` |
| Ink                 | `#191B1D` | `#ECEDEC` |
| Ink, secondary      | `#4F545A` | `#B4B9BC` |
| Ink, tertiary       | `#676D73` | `#8F9599` |
| Warning             | `#9A5C00` | `#FFB224` |
| Critical            | `#C8231A` | `#FF5D4F` |
| Hostile             | `#A81577` | `#F26BC4` |

The neutrals carry almost no chroma on purpose: a tinted grey would be a
hue, and hue is taken. Both themes follow the same rules; the light one is
for a lit room and the night one for a dark one.

**Motion** has two curves, also in `index.css`: `--ease-arrive` for what
comes into place and `--ease-travel` for what moves between two places.
Interface transitions take 140 to 260 ms. In the scene a plate opens in
0.6 s and a piece lands in 0.55 s, staggered outward from the hub, so a
whole topology assembles in about two seconds.

**Type** is [B612](https://github.com/polarsys/b612), drawn for Airbus
cockpit displays and released under the SIL Open Font License. It has two
weights, which is one fewer decision per label, and digits of equal width,
so figures hold their columns without a monospace face. B612 Mono is used
only for things that are literally code: identifiers, Cedar source, JSON.
Text is set in sentence case throughout.

## Deliberately absent

| Not here                                | Because                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Glow, bloom, gradients                  | They say nothing, and they make the alarm compete for attention                           |
| A colour for "healthy"                  | If normal is coloured, colour stops meaning abnormal                                      |
| Status dots on every row                | Fifty-one marks that all say "fine" bury the one that does not                            |
| Tracked capitals, labels above headings | Structure that decorates instead of informing                                             |
| Blur behind panels                      | Measured: it cost several times more than the 3D scene ([PERFORMANCE.md](PERFORMANCE.md)) |
| Spinning, bobbing, pulsing              | Motion that answers nothing teaches the eye to ignore motion                              |
| Panels that are open by default         | A panel nobody asked for is on screen while everything is normal, saying nothing          |
| Cards inside cards                      | Lists are rows with hairlines                                                             |

## Trade-offs

- **Long lens, not a true orthographic camera.** An orthographic projection
  would be purer, but orbit, zoom-to-pointer and picking would each need a
  second code path. A 14° lens gives nearly the same drawing with one.
- **Fewer beads.** Ink on a light plate turns into a solid rope past a
  certain density. The bead budget is about a third of what the glowing
  version drew, which keeps single beads discernible on the busiest
  connection. Density still follows request rate.
- **No service names at overview distance.** At that distance only the
  plates are named. Service names appear as the camera approaches; the
  explorer and the table view list everything.
- **A round plate for a region that is not round.** A small region with a
  long chain of tiers gets a plate wider than its lines need, because a
  circle is as wide as it is deep. The plates stay round by region so that
  the two arrangements can be told apart at a glance.
- **The edge is not the tallest thing.** A high deck made the edge the
  obvious centre, and hid the gateways of the regions behind it. One step
  up is enough to mark it, and its position does the rest.
- **Two weights of type.** Hierarchy has to come from size, position and
  weight, with no medium or semibold to hide behind.
- **The pieces are a file.** They are built in Blender by
  [`apps/web/scripts/build-pieces.py`](../apps/web/scripts/build-pieces.py)
  and shipped as one GLB of about half a megabyte, where the first version
  assembled them from primitives at start-up. The script is the source, so
  the asset is reproducible and its decisions can be read; the price is one
  more request before the scene can start, and a step to run when a piece
  changes.
- **Receding is not hiding.** With something selected, the pieces outside
  its neighbourhood fade toward the plate. A piece that is not in its
  normal state never does: a selection must not be able to cover an alarm.
- **The overview costs a click.** With the panels put away, the four
  signals and the list of regions are one action from the screen instead
  of on it. The sentence in the top bar, and any reading out of range, are
  what stay.

## Checking a change

Before adding something to the interface:

1. If it has a hue, what deviation does it report? If none, it is ink.
2. Would it be on screen while everything is normal? Then it must be quiet
   enough to live next to an alarm.
3. If it is a number, where is its normal range?
4. If it moves, what action or what change in the data is it answering,
   and does it stop?
5. Does it still read with the colour taken away?
6. Does it have to be on screen before anyone asks for it?

The first and the fifth of these are tested. An end-to-end test reads the
rendered frame back and asserts that no sampled pixel has a hue while the platform
is healthy, in both themes, and that hue appears once an incident is under
way (`apps/web/e2e/aegis.spec.ts`). Unit tests hold the palette to its own
rules (`apps/web/src/lib/palette.test.ts`).

## References

- Peter Hollifield and others on high-performance HMI; ISA-101.01, _Human
  Machine Interfaces for Process Automation Systems_. Summaries:
  [ISA-101 colour strategy](https://industrialmonitordirect.com/blogs/knowledgebase/isa-101-high-performance-hmi-design-principles-color-strategy),
  [ISA-101 how-to](https://docs.tatsoft.com/display/FX/ISA-101+HMI+Compliance+How-to).
  The standard itself was not consulted for this project.
- [The dark cockpit](https://www.lean.org/the-lean-post/articles/the-dark-cockpit-what-aviation-can-teach-lean-leaders/),
  Lean Enterprise Institute.
- Ben Shneiderman,
  [_The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations_](https://sites.umiacs.umd.edu/node/17412), 1996.
- Edward Tufte, _The Visual Display of Quantitative Information_; Stephen
  Few, _Information Dashboard Design_.
- [Design principles for cartography](https://www.esri.com/arcgis-blog/products/arcgis-pro/mapping/design-principles-for-cartography),
  Esri.
- Linear,
  [A calmer interface for a product in motion](https://linear.app/blog/behind-the-latest-design-refresh).
- Vercel, [Web Interface Guidelines](https://vercel.com/design/guidelines).
- On the look this replaces:
  [Scoring Show HN submissions for AI design patterns](https://www.adriankrebs.ch/blog/design-slop/),
  Adrian Krebs.
