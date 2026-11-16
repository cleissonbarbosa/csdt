# Design

AEGIS looks the way it does for reasons. This page states them, so that a
change to the interface can be judged against something firmer than taste.

## The idea

The topology is the product. Everything else is a tool that comes when it is
called.

AEGIS is drawn as a **signal field**: a scale model of a platform standing on
a quiet porcelain field, in which a hue appears only as an answer. There are
two kinds of answer. Blue answers the viewer: this is what you selected, this
is the request you are following. The signal colours answer the data: this
deviates, this failed, this is where it was stopped. With nothing asked and
nothing wrong, the screen is porcelain, graphite and grey.

The model is read in three steps, and the interface is built around them:
**overview first, then one path, then the detail.** It opens on the platform
reduced to its twelve kinds of service in the four layers a request crosses.
Selecting a piece, tracing a request or starting an incident brings one path
forward and lets the rest recede. Opening a service takes it to the
arrangement where every service stands on its own.

## Where it comes from

The first version of this interface was a dark "command center": neon cyan
on near-black, bloom, a sci-fi display face, tracked capitals, a status dot
beside every healthy service. It looked finished and said little. With
thirty per cent of requests failing, the screen was still mostly cyan, and
the alarm had to compete with the decoration.

The second, the "Sinótico", was a mimic board: a matte model with lamps that
light only where something needs attention. It fixed the colour, and its
discipline is kept here: normal is silent, a number comes with its range,
shape before colour, motion that answers something. What it did not fix was
the composition. It was still a dashboard with a 3D view in the middle (a
bar above, a strip below, a panel on either side when open) and it showed
all fifty-one services at once, so the first thing a viewer met was the
whole of the detail.

This version changes the composition. The sources it draws on:

| Source                                        | What was taken from it                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Shneiderman's mantra                          | Overview first, zoom and filter, details on demand: the three levels the model is read at                           |
| Progressive disclosure (Nielsen Norman Group) | Nothing is on screen before it is needed: no filters, no figures, no timeline until asked for or until they matter  |
| Linear's refresh, "a calmer interface"        | Chrome that recedes so the content leads: a thin bar, soft dividers, few controls                                   |
| Canvases of services (Railway, Grafana)       | Services and their relations drawn directly, detail revealed by selecting, context kept around the selection        |
| Architectural models and technical drawing    | A light field, matte solids, contrast from geometry and shadow, a parallel-looking projection                       |
| High-performance HMI practice (ISA-101)       | Neutral background; colour reserved for abnormal states; state also coded by shape and text; values against a range |
| The "dark and quiet" cockpit                  | Normal is the absence of a signal. A master caution leads to the system, then to the fault                          |
| WCAG on the use of colour                     | Nothing is told by colour alone: every state has a shape or a word as well                                          |
| Research on reading 3D node-link diagrams     | Perspective makes relations overlap: the default view is nearly parallel, and depth is given one meaning            |

Links are at the end of the page.

## The rules

**1. Hue is an answer.** There are two kinds, and they never share a colour.
_Focus_ is blue and answers the viewer: the selected piece and its
connections, the request being traced, the keyboard focus, a link. The
_signals_ answer the data: amber for deviation (degraded, throttled,
rejected), a warm red for failure and for a request that was stopped, and
magenta for hostile traffic. Nothing normal has a hue: no brand colour, no
"healthy green", no coloured service types. Primary actions are ink, because
a command is not a signal.

A traced request that Cedar denies is marked in red where it stopped. The
policy did its job; the red does not say the system is broken. It says that
the request the viewer chose to follow ended here, which is the event they
asked about. For the same reason it is not listed among what needs
attention on the platform: the viewer asked, and was answered.

**2. Normal is silent.** A healthy service has no dot, no badge and no label
saying so. One sentence in the top bar gives the state of the platform;
while everything is normal it reads "51 services, all normal". When
something is wrong the sentence names it, leads to the incident, and blinks
until it has been looked at. That blink is the interface's only looping
animation.

The same goes for the interface itself. At rest the screen holds the bar and
the model, and nothing else. A card comes with a selection and leaves with
it. The list of services, the scenarios and the request tracer come when
they are asked for. The timeline is not on screen while there is nothing on
it: it arrives when time stops being simply "now" (an incident, a pause, a
replay) and goes again afterwards. A panel that is always open is a healthy
service with a green dot: it says nothing and takes the room.

A first visit is the one exception, once. The model alone does not say what
can be learnt from it, so a card at the foot of the stage says what this is
and offers the three things it is for: understand the platform, investigate
a failure, test an authorization. Taking one, or dismissing the card, is
remembered, and it does not come back; the model is framed above it while it
is there. Everything it offers stays in the bar and its menu.

**3. Overview first, then one path, then the detail.** The opening view is
not the platform; it is a summary of it that cannot be outgrown. One piece
per kind of service, twelve at most, whether the platform has fifty services
or five hundred. A piece that stands for several says how many, and its
figures are theirs: rates added up, latency and error rate averaged by the
traffic that saw them, state as bad as its worst member
([`lib/overview.ts`](../apps/web/src/lib/overview.ts)). Nothing in the
summary is invented, and nothing in it is a different model: it is the same
data, grouped.

From there, attention narrows. Selecting a piece keeps its neighbourhood in
front and lets the rest recede. A traced request, or the traffic an incident
injects, is one route across the model; the route stays in front, the camera
goes with it, and where it was stopped is marked. Among fifty services the
camera moves in on the route. In the overview, where the whole route is
already in the picture, it only goes a little of the way with a traced
request and comes back. Opening one service from
a kind, from a list or by name leaves the overview for the arrangement where
that service stands on its own.

**4. Depth is distance along the path.** The third dimension is given one
job. In the overview the four layers (entry, identity, compute, data) stand
one behind another in the direction a request travels, so how far into the
picture something is says how far along the path it is. Nothing is raised
for effect: no tower for the important thing, no stacked floors. The camera
uses a long lens (14°), so parallel lines stay very nearly parallel as in an
axonometric drawing and relations do not overlap the way they do in
perspective, while orbiting still works when the viewer wants to look
around.

**5. A model, not a hologram.** Pieces are matte porcelain solids under one
fixed light, standing on low plates that cast soft shadows on the field.
There is no bloom, no glow, no grid floor, no scan line, no additive
blending. A piece is as light as the field it stands on; its shaded sides,
its occlusion and its shadow are what draw it, and the mark that says what
it is (a keyhole, a band, a lid) is the one dark thing on it.

The pieces are modelled, one per kind of service, as turned and milled
blocks with a single chamfer size: a gate, a shield, a cedar, a lighthouse.
Each is the plainest object that says what the service is, so the kind can
be read from the silhouette at the size of a fingernail.

Cards float over the model and cast a shadow on it, as the pieces do on
their plates: porcelain on porcelain is told apart by shadow, not by a
heavier line. They never blur what is behind them.

**6. A number comes with its range.** The four signals of the platform
(traffic, latency, errors, saturation) are each drawn on a scale with their
normal band, and so are the figures on every card. A value takes a colour
only when it has left the band. In the top bar an instrument is on show only
while its reading is outside the band: with the platform well the bar shows
none of them, and the one that appears is the one to look at. Where the bar
has not room for every instrument that is out of range, it shows whole ones,
the most urgent first (failures before slowness before fullness), and counts
the rest beside them. A reading that is out of range is never simply left
out, and the sentence beside the instruments is what gives up the room.

**7. Shape before colour.** Ordinary traffic is told apart by the shape of
its bead: disc for a request, ring for a response, diamond for
authentication, square for authorization, frame for a queue message. Traffic
that went wrong has a shape too (a bar for a rejection, a triangle for
suspicious traffic) and takes its colour only once it amounts to something.
Health has a glyph as well as a colour: triangle, square, cross. In the
model it has a manner too: the working part of a degraded service hesitates,
that of a critical one is jammed, and that of one that is down hangs crooked
and still (rule 8). Where a
request was stopped is a badge with a cross cut out of it. In the overview,
"some of this kind are affected" is a lamp under a neutral piece and "all of
them are" is the piece itself taking the colour, so the two are told apart
without reading a number. Nothing depends on telling two hues apart.

**8. Motion means something.** Two kinds of thing move, and neither is
decoration.

_Traffic moves because requests do._ Beads travel their connections at a
rate that follows the data, and every piece has one part that works for the
same reason: a door that turns as requests pass, a line that moves up as
messages are taken. That part runs at the pace of its service's traffic:
evenly while the service carries what it did when the model was laid out,
faster under a surge, winding down as traffic thins, and not at all when
nothing passes. A piece standing still on a working platform is therefore a
signal in itself, and one that needs no colour.

| Piece            | The part that works                                                       |
| ---------------- | ------------------------------------------------------------------------- |
| External client  | Its head lifts as it asks                                                 |
| Network gateway  | The globe turns inside the meridian that carries it                       |
| API gateway      | A revolving door under the arch                                           |
| Authentication   | The lock turns a quarter, and turns back                                  |
| Cedar authorizer | Its three tiers turn a notch one after another: who, what, on which thing |
| Microservice     | The lid turns one side on                                                 |
| Container        | The doors open to take a load in and close on it                          |
| Serverless       | The bolt strikes: one whole turn for a call, then it stands still         |
| Message queue    | The line moves up a place; the head leaves and a new one joins the tail   |
| Database         | The platters turn                                                         |
| Storage          | Objects are lifted out of the bucket and put back                         |
| Security monitor | The hood of the lamp sweeps round                                         |

Each is the motion the object would really have, so it says again what the
silhouette says. The piece itself stays where it stands and does not spin,
bob or pulse: one part of it moves, slowly (a period of two to eight seconds
at normal traffic), and only as fast as the data says. Pieces of a kind do
not move in step, because their services do not.

_How it moves says how the service is._ The pace is the traffic; the manner
is the state, and it is the same for every piece, so it is learned once:

| State    | The part that works                                                                 |
| -------- | ----------------------------------------------------------------------------------- |
| Healthy  | Runs evenly                                                                         |
| Degraded | Hesitates: the same cycle, gone through in fits and starts                          |
| Critical | Is jammed: it pushes a little way in, shaking, slips back, and tries again          |
| Down     | Stands still and hangs crooked: a lid askew, a line fallen forward, doors left open |

A state is therefore told three ways (a colour, a glyph or a lamp, and a
manner of moving), and the third needs neither of the others: it reads the
same in either theme and without telling one hue from another. A part
passes from one manner to the
next in about a third of a second, and when its service goes down it drops
into the way it hangs and settles there, once. A piece that stands for
several services hesitates as soon as one of them is unwell and takes a
state's manner only when all of them are in it, which is the rule its colour
follows. With motion reduced nothing hesitates or jams, but a part that is
down still hangs: that is a posture, not a movement.

_Everything else that moves is an answer_, to the viewer or to a change in
the data, and it happens once:

| What moves                                               | In answer to                         |
| -------------------------------------------------------- | ------------------------------------ |
| Plates open, pieces land, connections draw themselves    | A model being laid out               |
| Pieces walk to their new places                          | The arrangement changing             |
| A piece lifts; its connections are redrawn outward       | Selecting it                         |
| The rest of the model recedes                            | Something being selected or followed |
| A piece's connections take the focus colour              | Pointing at it                       |
| The camera goes with a request; in the detail, moves in  | Tracing a request                    |
| The camera moves in on a route, in the detail            | An incident's traffic appearing      |
| A badge lands on a piece                                 | A request being stopped there        |
| A piece is jolted and a ring leaves its lamp             | The service failing                  |
| A plate takes its state colour, or goes dark             | Its region changing state            |
| A card slides in and the picture moves over to make room | Asking for the card                  |
| The timeline rises at the foot of the stage              | Time becoming something to look at   |

Each of these says something that a cut would not: where a piece went when
the arrangement changed, which connections belong to the selection, that the
card is on top of the model and not instead of it. Nothing moves that is
not one of these or traffic, and the only thing that repeats without the
data asking for it is the unacknowledged alarm. The camera never moves by
itself once the viewer has taken it. Arrivals share one curve (fast out of
the gate, a long settle) and journeys between two places another, so the
motion has one hand. Reduced-motion preferences, the system's or the
application's own, switch all of it off: the mechanisms rest as they were
modelled.

## The arrangement

Where a piece stands is the first thing the model says about it, before its
shape and long before its name. The three arrangements
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

**The model faces the viewer.** Each arrangement is drawn for the attitude
the camera first takes, so its lines run across the picture and nothing
important stands behind something else.

**A piece with a front faces its traffic.** A gate is gone through, a shield
is faced, a container is loaded at its door end and a queue is joined at its
tail. Those four are turned so that this side meets what calls them,
wherever the arrangement has put them, and the line of traffic goes into the
opening of the gate, not into its flank. The other eight are the same from
every side that matters and stand as they were modelled. A gate and a shield
are told by their face, and on a path that runs across the picture a face
turned all the way to its traffic shows the viewer its edge: a slab and a
blade. So those two turn toward their traffic no further than 45° from the
line of sight, where the arch is still an arch and the line still passes
through its opening, which is wider than the gate is deep.

**On a stage taller than wide, the model is seen along the path.** A phone
held upright is a picture four hundred pixels across, and the overview is a
row of four layers: drawn across it, the row was a strip a hundred pixels
tall under names larger than its pieces. There the camera stands at the
entry and looks along the path, a little higher than usual, so the layers
stand one above another and take the height of the screen. Depth is still
distance along the path (rule 4), more plainly than before. Every piece
that is not turned to its traffic is turned by as much as the camera went
round, so its front still faces the viewer, and a layer's heading is its
number, standing beside the plate instead of above it. Only the overview changes; the two detailed
arrangements are round or nearly square, and keep their attitude.

**A name stands clear of what it names.** A plate's name is hung from a
point just outside the plate, on the side that faces away from the rest of
the model. In the overview a piece's name lies on the plate at its foot,
toward the viewer, and the pieces of one column stand far enough apart that
the nearer covers neither the farther nor its name.

**A name is for reading, or it is not there.** Names are not part of the
scene's picture, whose resolution follows what the machine can render: they
are drawn over it at the display's own resolution, so they are as sharp on a
phone at the lowest quality tier as anywhere. And no two are printed across
each other. When there is not room for all of them the more important are
placed first: the piece in hand, a service that is failing, the places, then
the rest from the nearest. The overview's headings are written in full where
they fit and cut to their numbers together where they would touch. A name
that was left out comes back when the camera moves in, or when its piece is
pointed at or selected.

_The overview_ is four low plates, one per layer, left to right in the order
a request crosses them and numbered in that order. Within a layer its steps
are columns (clients, the edge router, the gateways) and the kinds of one
step stand side by side across the path. Connections are drawn firmly and
few beads ride them, because each stands for many.

_By region_, the model is a hub and its spokes: the edge at the centre, each
region a round plate beside it with its gateway at the hub's side and its
tiers running outward, so requests travel away from the centre everywhere.

_By dependency_, it is a set of swimlanes: tiers are columns from left to
right, each region is a lane across them, and a tier lines up between
regions. A lane is a plate like any other, so it takes its region's state
colour and goes dark with it.

## Words

**Time is the simulation's.** The cursor is at the _simulation's now_, where
new history is being made, or in its _history_, which is re-simulated
exactly; either can be _paused_. The interface does not call simulated time
"live": that word is kept for data measured from a connected system, and
"live, paused" contradicts itself. A phase of an incident is timed from the
start of that incident (`+0:14`); an event shows that and the simulation
clock, which differ by when the incident began. While the cursor is in the
history the sentence in the top bar says which moment it speaks of ("At
1:16, in history: 51 services, all normal"): unmarked, it read as the
present while an incident ran at the simulation's now.

**A statement says what kind it is.** An explanation of an incident mixes
three things that deserve different trust, and each line is tagged with
which it is: _prescribed_ (written in the scenario file), _modelled_ (a
relation of the topology the model follows) or _observed_ (recorded during
the run). What the report cannot account for is _not explained_, in those
words. The tags are ink, not colours: none of them is an alarm.

**A result belongs to what it was asked.** A Cedar decision is shown with
the context and the policies it was evaluated under. The moment the form
beside it changes, it is marked as the answer to something else, loses the
colour and the firm edge of an answer, and lists what changed. Two decisions
compared are two evaluations kept side by side, never one of them inferred.

**A name says which one.** A platform runs the same service in several
regions under one name. Where the place is not on show (what a service
calls, what an incident affected, a path) a name borne by more than one
service is followed by its region; a name that is unique is left alone.
In the table view, which is laid out by region, a name alone is a service
of that table's region, and a call that leaves the region says where it
goes: the edge router calls "API Gateway, US East · Primary; API Gateway,
EU West; API Gateway, AP Southeast", not one name three times.

## Tokens

Defined in [`apps/web/src/index.css`](../apps/web/src/index.css) for the
interface and mirrored in
[`apps/web/src/lib/palette.ts`](../apps/web/src/lib/palette.ts) for the 3D
scene, which cannot read CSS custom properties. The scene's signal colours
are a little lighter than the interface's, which have to hold up as small
text.

| Role                  | Light     | Night     |
| --------------------- | --------- | --------- |
| Porcelain (the field) | `#F5F4F0` | `#1E2226` |
| Paper (cards)         | `#FDFCFA` | `#272C31` |
| Line                  | `#DDDCD7` | `#3B4248` |
| Structure             | `#A9AFB1` | `#5B6369` |
| Graphite (ink)        | `#252B30` | `#ECEDEA` |
| Ink, secondary        | `#545C63` | `#B5BABD` |
| Ink, tertiary         | `#697177` | `#90979B` |
| Focus                 | `#3B5FC0` | `#8FABF3` |
| Warning               | `#8F5A00` | `#FFB224` |
| Incident (critical)   | `#BF4631` | `#F47C66` |
| Hostile               | `#A81577` | `#F26BC4` |

In the scene the focus is `#4269CE` and the incident colour `#D95D48`, the
two the direction was drawn with. The neutrals carry almost no chroma on
purpose: a tinted grey would be a hue, and hue is taken. Both themes follow
the same rules; the light one is for a lit room and the night one for a dark
one.

**Shape.** Controls have a 6 px radius and cards 10 px. Nothing is a pill.
A card over the model has one soft shadow; nothing else in the interface
casts one.

**Motion** has two curves, also in `index.css`: `--ease-arrive` for what
comes into place and `--ease-travel` for what moves between two places.
Interface transitions take 140 to 260 ms. In the scene a plate opens in
0.6 s and a piece lands in 0.55 s, staggered in the direction requests
travel, so a model assembles in about two seconds. A mechanism has a period
of two to eight seconds at the pace of normal traffic, runs between about a
third of that pace and two and a half times it, and takes most of a second
to change pace, as something with weight would. A jammed part tries again
about three times in two seconds.

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
| A colour for "healthy"                  | If normal is coloured, colour stops meaning anything                                      |
| A second use for blue                   | Focus is the viewer's colour; a blue button or a blue badge would spend it                |
| Status dots on every row                | Fifty-one marks that all say "fine" bury the one that does not                            |
| Cards of key figures                    | A figure nobody asked for is on screen while everything is normal, saying nothing         |
| A headline over the model               | The model is what there is to read; a sentence telling the viewer so is in its way        |
| Tracked capitals, labels above headings | Structure that decorates instead of informing                                             |
| Blur behind panels                      | Measured: it cost several times more than the 3D scene ([PERFORMANCE.md](PERFORMANCE.md)) |
| Height for emphasis                     | Depth means distance along the path; a tall thing would mean nothing                      |
| Pieces that spin, bob or pulse          | Motion that answers nothing teaches the eye to ignore motion; a mechanism follows traffic |
| Panels that are open by default         | Including the timeline, which has nothing on it until something happens                   |
| Cards inside cards                      | Lists are rows with hairlines                                                             |

## Trade-offs

- **The overview leaves things out.** What happens inside one kind
  (replication between databases, one service calling another) is not drawn
  there, and a kind is shown as unwell as its worst member. Both are the
  price of twelve pieces, and the detailed arrangements are one click away.
- **A regional failure lights every layer.** Every kind has an instance in
  the region that failed, so the overview shows a lamp under most pieces. It
  is true, and it is not where a regional failure is best read: the
  arrangement by region shows it as one dark plate.
- **Four hues, not two.** The direction this came from was drawn with one
  blue and one red. Amber and magenta are kept beside them because a
  platform that is degraded and one that is failing are different things to
  act on, and so are a failure and an attack. Shape carries each as well.
- **Porcelain on porcelain.** A piece is told from its plate by shading and
  shadow, not by a darker colour, which is a lower contrast than the model
  it replaces. The names, the marks on the pieces and the table view do not
  depend on it, and the night theme is the same model with the contrast the
  other way round.
- **Long lens, not a true orthographic camera.** An orthographic projection
  would be purer, but orbit, zoom-to-pointer and picking would each need a
  second code path. A 14° lens gives nearly the same drawing with one.
- **The model is never quite still.** An earlier version of this rule
  allowed nothing to keep moving but the beads, and the model read as a
  photograph of a platform, not as one at work. Now a part of every piece
  moves while traffic flows. The price is more motion on a screen that is
  meant to be quiet, and it is kept low on purpose: one part per piece, a
  slow period, a pace taken from the data, and the motion setting for anyone
  who wants none of it.
- **A pace is relative.** A mechanism is measured against the traffic its
  service had when the model was laid out, so "normal" is that moment's
  normal. A model first drawn in the middle of an incident takes the
  incident for its baseline until it is laid out again.
- **Fewer beads.** Past a certain density a stream turns into a solid rope.
  The bead budget keeps single beads discernible on the busiest connection,
  and the overview draws a fifth of it. Density still follows request rate.
- **No service names at overview distance, in the detailed arrangements.**
  There only the plates are named until the camera approaches. In the
  overview every piece is named where there is room for its name.
- **A name can be missing.** On a narrow screen the overview shows fewer
  names than pieces, and its headings as numbers. That is a loss, taken in
  preference to names nobody can read; selecting or approaching a piece
  names it, and the table view lists everything.
- **A phone's bar says less.** Under 640 pixels the three things to do
  first are still on the bar, but the request tracer is its icon and the
  incident button its last word.
- **A gate is not quite square to its path.** Where requests cross the
  picture a gate stands at three quarters to them, not across them: the
  price of an arch that can be read as one. Seen along the path, on a phone
  or in a region that lies in front of the hub, it stands square.
- **Upright, a heading is its number.** Beside a plate on a phone there is
  room for "02" and not for "02 Identity", so on a stage taller than wide
  the layers are numbered and not named, on a tablet as well, where the
  names would have fitted. Selecting a piece says which layer it is in.
- **On a phone a card takes half the stage.** A card there is as wide as the
  screen, so the model cannot move over beside it; it used to be asked to,
  and left the picture when a piece was selected. The card keeps to the
  upper half, scrolling what does not fit, and the model is framed in what
  is left under it: smaller, but there, with the selection marked on it.
- **A card gives way to the panels.** The guide's card stands beside the
  panels where the stage has room for it between them. Where it has not (a
  phone, where a panel takes the whole width, or a tablet with a panel on
  each side) it lies along the foot and the panels end above it, because a
  challenge is answered in a panel. The scene's toolbar and the notices
  keep the full width there instead of being squeezed into what is left.
  Where the card does stand beside the panels the model moves over for it
  as it does for a panel, and the card goes to the foot instead when that
  would leave the model less than 320 pixels.
- **Names are not in the captured frame.** They are drawn on a canvas over
  the scene, so a frame read back from the renderer does not contain them
  (`scripts/capture.mjs --readback` lays them on).
- **The first screen is not silent.** A first visit starts with a card over
  the model. It is the only thing that is on screen without being asked
  for, and it is there once.
- **Three things on the bar.** Search, the request tracer and the incidents
  are each one step away. The tracer used to be in the menu, where the part
  of the application that is about authorization was the hardest to find.
- **A round plate for a region that is not round.** A small region with a
  long chain of tiers gets a plate wider than its lines need, because a
  circle is as wide as it is deep. The plates stay round by region so that
  the arrangements can be told apart at a glance.
- **Two weights of type.** Hierarchy has to come from size, position and
  weight, with no medium or semibold to hide behind.
- **The pieces are a file.** They are built in Blender by
  [`apps/web/scripts/build-pieces.py`](../apps/web/scripts/build-pieces.py)
  and shipped as one GLB of about two thirds of a megabyte, which also says
  what moves on each piece and how. The script is the source,
  so the asset is reproducible and its decisions can be read; the price is
  one more request before the scene can start, and a step to run when a
  piece changes.
- **Receding is not hiding.** With something selected or followed, the
  pieces outside its neighbourhood fade toward the plate. A piece that is
  not in its normal state never does: a selection must not be able to cover
  an alarm.
- **Everything but the model costs a click.** The four signals, the list of
  services and the timeline are one action from the screen instead of on it.
  The sentence in the top bar, and any reading out of range, are what stay.

## Checking a change

Before adding something to the interface:

1. If it has a hue, what is it an answer to? Blue answers the viewer, a
   signal colour answers the data. If it answers nothing, it is ink.
2. Would it be on screen while everything is normal and nothing has been
   asked? Then it has to justify being there at all.
3. Which of the three levels does it belong to: the overview, a path, or the
   detail? It should appear at that level and not before.
4. If it is a number, where is its normal range?
5. If it moves, what action or what change in the data is it answering, and
   does it stop when that does?
6. Does it still read with the colour taken away?

The first and the last of these are tested. An end-to-end test reads the
rendered frame back and asserts that no sampled pixel has a hue while the
platform is healthy and nothing is selected, in both themes; that a hue
appears with a selection and with a traced request, and goes again when they
are let go of; and that hue appears once an incident is under way
(`apps/web/e2e/aegis.spec.ts`). The same suite asserts that no two names
on the model overlap, at a desktop width and on a phone, that the names'
canvas has the display's resolution while the scene's is lower, that on a
phone every playback control stays inside the screen, that the request
tracer is on the bar there too, and that a challenge's card never lies
over the panel it is answered in, on a phone or on a tablet with a panel on
each side.
Unit tests hold the
palette to its own rules
(`apps/web/src/lib/palette.test.ts`) and the overview to its arithmetic
(`apps/web/src/lib/overview.test.ts`).

## References

- Ben Shneiderman,
  [_The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations_](https://sites.umiacs.umd.edu/node/17412), 1996.
- Nielsen Norman Group,
  [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/).
- Linear,
  [A calmer interface for a product in motion](https://linear.app/blog/behind-the-latest-design-refresh).
- Grafana,
  [Node graph](https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/node-graph/);
  Railway's project canvas, as described in its documentation.
- W3C,
  [Understanding Success Criterion 1.4.1: Use of Color](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html).
- Apple, [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/),
  on depth that carries meaning and on showing what a task needs.
- Peter Hollifield and others on high-performance HMI; ISA-101.01, _Human
  Machine Interfaces for Process Automation Systems_. Summaries:
  [ISA-101 colour strategy](https://industrialmonitordirect.com/blogs/knowledgebase/isa-101-high-performance-hmi-design-principles-color-strategy),
  [ISA-101 how-to](https://docs.tatsoft.com/display/FX/ISA-101+HMI+Compliance+How-to).
  The standard itself was not consulted for this project.
- [The dark cockpit](https://www.lean.org/the-lean-post/articles/the-dark-cockpit-what-aviation-can-teach-lean-leaders/),
  Lean Enterprise Institute.
- Edward Tufte, _The Visual Display of Quantitative Information_; Stephen
  Few, _Information Dashboard Design_.
- Vercel, [Web Interface Guidelines](https://vercel.com/design/guidelines).
- On reading three-dimensional node-link diagrams: the brief this direction
  came from cites research that perspective introduces overlap and makes
  relations harder to follow. The papers themselves were not consulted for
  this project; the rule taken from them is rule 4.
- On the look the first version had:
  [Scoring Show HN submissions for AI design patterns](https://www.adriankrebs.ch/blog/design-slop/),
  Adrian Krebs.
