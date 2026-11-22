**English** · [Português](Princípios-de-design)

AEGIS looks the way it does for stated reasons, so that a change to the
interface can be judged against something firmer than taste. This page
summarises them;
[`docs/DESIGN.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DESIGN.md)
is the standard a change is checked against, with the sources each rule
comes from.

## The idea: a signal field

The topology is the product. Everything else is a tool that comes when it is
called.

AEGIS is drawn as a **signal field**: a scale model of a platform standing on
a quiet porcelain field, where a hue appears only as an answer. There are two
kinds of answer. Blue answers you: this is what you selected, this is the
request you are following. The signal colours answer the data: this
deviates, this failed, this is where it was stopped. With nothing asked and
nothing wrong, the screen is porcelain, graphite and grey.

The model is read in three steps, and the interface is built around them:
**overview first, then one path, then the detail.**

## The eight rules

1. **Hue is an answer.** Focus is blue and answers the viewer: the selection
   and its connections, the traced request, keyboard focus, links. Signals
   answer the data: amber for deviation, a warm red for failure and for a
   request that was stopped, magenta for hostile traffic. Nothing normal has
   a hue: no "healthy green", no brand colour, no coloured service types.
   Primary actions are ink, because a command is not a signal.
2. **Normal is silent.** A healthy service has no dot, badge or label saying
   so. One sentence in the top bar gives the state of the platform; while
   everything is normal it reads **51 services, all normal**. When something
   is wrong it names it and blinks until it has been looked at, the
   interface's only looping animation. At rest the screen holds the bar and
   the model: cards, lists and the timeline come when they are needed. The
   one exception is the orientation card of a first visit, shown once.
3. **Overview first, then one path, then the detail.** The opening view is
   one piece per kind of service (twelve for the bundled platform, seventeen
   at most), whatever the size of the platform. Its figures are the members'
   figures, grouped: rates added up, latency and error rate averaged by
   traffic, state as bad as the worst member. Selecting a piece, tracing a
   request or starting an incident brings one path forward; opening a
   service goes to the detailed arrangements.
4. **Depth is distance along the path.** In the overview the four layers
   (entry, identity, compute, data) stand one behind another in the
   direction a request travels. Nothing is raised for effect. The camera uses
   a long lens (14°), so the drawing stays nearly parallel.
5. **A model, not a hologram.** Matte porcelain pieces under one fixed light,
   on low plates that cast soft shadows. No bloom, glow, grid floor, scan
   line or additive blending. Cards float over the model with a shadow and
   never blur what is behind them.
6. **A number comes with its range.** Traffic, latency, errors and saturation
   are each drawn against their normal band, and a value takes a colour only
   when it has left it. In the top bar an instrument is on show only while
   its reading is out of range.
7. **Shape before colour.** Every kind of traffic has a bead shape (disc,
   ring, diamond, square, frame; a bar for a rejection, a triangle for
   suspicious traffic), and health has a glyph as well as a colour.
   Nothing depends on telling two hues apart.
8. **Motion means something.** Beads move because requests do, and each
   piece has one working part that runs at the pace of its service's
   throughput and stands still when nothing passes. How it moves is the
   service's state. Everything else that moves answers an action or a change
   in the data, once. The camera never moves by itself once you have taken
   it, and reduced motion switches all of it off.

The manner of a piece's working part is the same for every kind of piece:

| State    | The part that works                                                                 |
| -------- | ----------------------------------------------------------------------------------- |
| Healthy  | Runs evenly                                                                         |
| Degraded | Hesitates: the same cycle, gone through in fits and starts                          |
| Critical | Is jammed: it pushes a little way in, shaking, slips back, and tries again          |
| Down     | Stands still and hangs crooked: a lid askew, a line fallen forward, doors left open |

A state is therefore told three ways: a colour, a glyph or a lamp, and a
manner of moving. The third needs neither of the others.

## The arrangement

Where a piece stands is the first thing the model says about it. The three
arrangements (`graphics/layout.ts`) follow the same decisions:

- **A tier is a line**, and space draws it: two tiers are about twice as far
  apart as two neighbours within one.
- **A plate is as large as what stands on it**, and nothing stands over
  anything else.
- **A piece with a front faces its traffic**: a gate, a shield, a container
  and a queue are turned toward what calls them.
- **On a stage taller than wide**, such as a phone, the overview is seen
  along the path, so the layers stand one above another.
- **A name is for reading, or it is not there.** Names are drawn over the
  scene at the display's own resolution, never across each other and never
  in part; the more important are placed first.

| Arrangement   | What it shows                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------- |
| The overview  | Four low plates, one per layer, left to right in the order a request crosses them              |
| By region     | A hub and its spokes: the edge at the centre, each region a round plate with its tiers outward |
| By dependency | Swimlanes: tiers are columns, each region is a lane across them                                |

## Words

The words are part of the design, in both languages
([Glossary](Glossary) lists them).

- **Time is the simulation's.** The cursor is at the _simulation's now_ or in
  its _history_, and either may be _paused_. Simulated time is never called
  "live"; that word is kept for data measured from a connected system. While
  the cursor is in the history, the top bar says which moment it speaks of:
  **At 1:16, in history: 51 services, all normal**.
- **A statement says what kind it is**: _prescribed_ (written in the scenario
  file), _modelled_ (a relation of the topology the model follows),
  _observed_ (recorded during the run) or _not explained_. The tags are ink,
  not colours.
- **A result belongs to what it was asked.** A Cedar decision that no longer
  matches the form beside it is marked as the answer to something else,
  never shown as current.
- **A trial is not an event.** What a fault would do, shown before it is
  placed, takes no signal hue; the services it would reach are brought
  forward in the viewer's blue.
- **An objective is the engine's own threshold**, never an SLO or an error
  budget.

## An incident capture

An [incident capture](Incident-captures) is a real incident read from a
file, and the one thing on screen that is not simulated. Everything above
holds for it, with these exceptions:

- **It opens on the detail.** It is drawn by region only and has no
  overview, because its kinds of service are mostly assumed.
- **Unknown is not normal.** A service whose state the source does not give
  stands upright, a shade fainter, on a dashed ring without hue. In words it
  is **No data**, **Error rate not measured** or **Not stated at this time**.
- **Its colour is the simulation's levels, said as such.** A measured state
  uses the error rates at which the simulation calls a service degraded (4%)
  or critical (20%); latency and memory colour nothing.
- **No normal range** for requests, errors, p95 and memory, the one stated
  exception to rule 6: the source states none.
- **A report's pieces rest**, because a provider's report states no traffic.
- **Its bar is always there**, in the timeline's place, and its sentence
  never blinks.
- **Words.** Its figures are **Captured, not simulated** or **From the
  provider's report, not simulated**. It is never called a replay nor
  recorded, and its thresholds are never objectives.

## Tokens

Tokens are CSS custom properties in `apps/web/src/index.css`, mirrored as
literals in `apps/web/src/lib/palette.ts` because the 3D scene cannot read
custom properties. A change goes into both, for both themes.

| Role                  | Light     | Night     |
| --------------------- | --------- | --------- |
| Porcelain (the field) | `#F5F4F0` | `#1E2226` |
| Graphite (ink)        | `#252B30` | `#ECEDEA` |
| Focus                 | `#3B5FC0` | `#8FABF3` |
| Warning               | `#8F5A00` | `#FFB224` |
| Incident (critical)   | `#BF4631` | `#F47C66` |
| Hostile               | `#A81577` | `#F26BC4` |

- **Shape.** Controls have a 6 px radius and cards 10 px; nothing is a pill.
  A card over the model has one soft shadow, and nothing else casts one.
- **Motion.** Two curves, `--ease-arrive` and `--ease-travel`; interface
  transitions take 140 to 260 ms.
- **Type.** B612, in two weights, with digits of equal width; B612 Mono only
  for literal code. Sentence case throughout.

## Deliberately absent

| Not here                       | Because                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Glow, bloom, gradients         | They say nothing, and they make the alarm compete for attention                                                       |
| A colour for "healthy"         | If normal is coloured, colour stops meaning anything                                                                  |
| A second use for blue          | Focus is the viewer's colour; a blue button or badge would spend it                                                   |
| Status dots on every row       | Fifty-one marks that all say "fine" bury the one that does not                                                        |
| Cards of key figures           | A figure nobody asked for is on screen while everything is normal                                                     |
| Blur behind panels             | Measured: it cost several times more than the 3D scene ([Performance](Performance#a-regression-the-benchmark-caught)) |
| Height for emphasis            | Depth means distance along the path                                                                                   |
| Pieces that spin, bob or pulse | Motion that answers nothing teaches the eye to ignore motion                                                          |
| Panels open by default         | Including the timeline, which has nothing on it until something happens                                               |

## Checking a change

Before you add something to the interface, ask:

1. If it has a hue, what is it an answer to? Blue answers the viewer, a
   signal colour answers the data. If it answers nothing, it is ink.
2. Would it be on screen while everything is normal and nothing has been
   asked? Then it has to justify being there at all.
3. Which level does it belong to: the overview, a path, or the detail? It
   should appear at that level and not before.
4. If it is a number, where is its normal range?
5. If it moves, what action or change in the data is it answering, and does
   it stop when that does?
6. Does it still read with the colour taken away?

The first and the last are tested. An end-to-end test
(`apps/web/e2e/aegis.spec.ts`) reads the rendered frame back and asserts
that no sampled pixel has a hue while the platform is healthy and nothing is
selected, in both themes; that hue comes and goes with a selection and a
traced request; and that hue appears once an incident is under way. The same
suite fails if two names on the model overlap. The static site's suite holds
an incident capture to the first rule. Unit tests hold the palette to its
rules (`lib/palette.test.ts`), the overview to its arithmetic
(`lib/overview.test.ts`) and a capture's levels to the engine's
(`lib/thresholds.test.ts`).

## Reference

- [`docs/DESIGN.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DESIGN.md): the full standard, its trade-offs and its sources
- [`AGENTS.md`](https://github.com/cleissonbarbosa/csdt/blob/main/AGENTS.md): "Interface design rules"
- [`apps/web/src/index.css`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/index.css) and
  [`apps/web/src/lib/palette.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/lib/palette.ts): the tokens
- [`apps/web/src/graphics/layout.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/graphics/layout.ts): the arrangements
- [`apps/web/src/lib/overview.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/lib/overview.ts): the overview's arithmetic
- [`apps/web/e2e/aegis.spec.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/e2e/aegis.spec.ts) and
  [`apps/web/src/lib/palette.test.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/lib/palette.test.ts): the tests that hold the rules
