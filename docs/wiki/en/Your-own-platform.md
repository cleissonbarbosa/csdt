**English** · [Português](Sua-própria-plataforma)

AEGIS ships with one fictional platform, five incidents and nine Cedar
policies. Your own files can take the place of any of them: a topology that
describes a platform you care about, scenarios written for it, and the Cedar
policies you want evaluated. Nothing is recompiled.

> **It is still a simulation.** A topology describes a platform; the load,
> latency, failures and authorization traffic on it are computed by the
> engine and labelled `synthetic`, whatever the platform is. Nothing you
> bring makes AEGIS observe a real system.

## Three ways in

| Way                   | Use it to                                           | Where                                                     |
| --------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| The import dialog     | try files while the server runs, with no restart    | **⋯** (**More**) → **Import or export files**             |
| A workspace directory | start the server on your files                      | `AEGIS_WORKSPACE=<dir>`                                   |
| The platform editor   | draw a topology, or change one, on the model itself | **⋯** → **Edit this platform** or **Draw a new platform** |

Whichever way, each kind of file you bring replaces that part and the rest
comes from the bundled set: a workspace holding only Cedar policies is the
bundled platform under different policies. The formats are in
[Workspace files](Workspace-files).

## Start from a copy

```bash
cargo run -p aegis-server -- export-workspace ./my-platform   # the bundled files, as a starting point
cargo run -p aegis-server -- check-workspace ./my-platform    # validate without starting anything
AEGIS_WORKSPACE=./my-platform cargo run -p aegis-server       # run with it
```

`export-workspace` writes into a new or empty directory. `check-workspace`
loads and compiles the directory exactly as start-up does, and prints what
it found, including every scenario that cannot run on a topology and why:

```text
examples/corner-shop: valid
  from the workspace: topologies, scenarios, recordings, cedar/policies, cedar/entities, cedar/catalog, cedar/schema
  not read:
    examples/corner-shop/README.md
  topologies (1):
    corner-shop: 6 services, 5 connections, 1 region (opens at start-up)
  scenarios (2): ledger-fire, receipt-snooping
  recordings (1): a-bad-afternoon
  policies: 3; baseline traffic denied by Cedar: 10.0 %
```

[`examples/corner-shop`](https://github.com/cleissonbarbosa/csdt/tree/main/examples/corner-shop)
is a complete workspace in six services, small enough to read in one
sitting. A mistake stops the server from starting and names the file it is
in. With Docker Compose, mount the directory and name it:

```yaml
services:
  server:
    environment:
      AEGIS_WORKSPACE: /workspace
    volumes:
      - ./my-platform:/workspace:ro
```

## The command line

None of these commands starts the server. Where one reads a workspace, it
builds it the way start-up would, and it may be a directory, a file saved
with **Save as one file**, or, for the two comparisons, `@bundled`: the set
compiled into the binary. They are subcommands of the server's binary,
`aegis-server`; from a checkout, `cargo run -p aegis-server --` stands in
its place.

| Command                                                                                  | What it does                                                                             |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `export-workspace <dir>`                                                                 | Writes the bundled topologies, scenarios, recordings and Cedar files into `<dir>`.       |
| `check-workspace <dir>`                                                                  | Validates a workspace without starting the server.                                       |
| `diff-workspace <base> <candidate> [--json] [--exit-code]`                               | Lists what Cedar decides differently under the candidate.                                |
| `compare-incident <base> <candidate> <scenario> [--topology=<id>] [--seed=<n>] [--json]` | Runs one scenario on the platform each side describes, from the same seed, side by side. |

### Compare two sets of policies

`diff-workspace` is the question to ask of a policy change before merging
it. Its report has four parts (a complete example, the bundled platform
without one policy, is in
[docs/WORKSPACE.md](https://github.com/cleissonbarbosa/csdt/blob/main/docs/WORKSPACE.md)):

- **Policies** are compared by meaning, so reformatting one, moving it to a
  `.cedar` file or adding an `@description` is not a change.
- **Simulated traffic** is the catalogue's request shapes, with the share of
  ordinary traffic denied on each side.
- **Scenario flows** are the flows tied to a catalogue request that stop at
  the authorizer on one side and not on the other.
- **Access matrix** is every request the candidate's request tracer can
  build, with each context key absent, false and true; at most 20 000 are
  compared.

Every line is Cedar's answer on each side; the command only compares, and a
request no catalogue names is not compared. `--json` writes the full
comparison for other tools.

The exit status is what lets it fail a pipeline: 0 normally; 1 with
`--exit-code` when a decision differs (a request, a flow or the share denied
at rest, not a policy rewritten to the same effect); 2 when a side cannot be
built.

```bash
aegis-server diff-workspace ./main-policies ./branch-policies --exit-code
```

### Compare an incident on two platforms

`compare-incident` runs the same scenario on the platform the base opens on
and on the candidate's, each on a timeline of its own from the same seed. It
prints what differs, what follows without being stated and the two runs
side by side (all of it with `--json`), and exits 2 when the comparison
cannot be run. The scenario has to be the same incident on both sides:
written the same in both and able to run on each platform. The import
dialog asks the same question, [below](#an-incident-on-both-platforms).

## The import dialog

**⋯** → **Import or export files** opens **Platform files**. It does
without a restart what a workspace directory does at start-up.

1. **Choose files**, **Choose a folder**, or drop either on the marked area.
   A folder is read as the workspace layout; a file on its own is recognised
   by what it holds.
2. The files are checked as you add them. Each is laid in a slot for the
   part the server reads it as: **Platforms**, **Scenarios**,
   **Recordings**, **Cedar policies**, **Entities**, **Catalogue**,
   **Schema**, or **Not read**. Each part says whether it is **replaced by
   these** or **stays as it is**; the server decides, never the page. The
   dialog shows what applying them would give (the platforms, the
   scenarios, the share of ordinary requests Cedar would deny, any scenario
   that could not run and why), or the file a mistake is in and what it is.
   Nothing changes until **Apply**.
3. Optionally, ask what they would change before you apply (the next two
   sections).
4. **Apply**. There is one simulation, so applying starts a new timeline for
   everyone connected.

What else the dialog does:

- An import is laid over what the server started with, not over an
  earlier import: each kind of file you add replaces that part. One scenario
  file is the whole list of scenarios. To add to what is on show instead,
  use **Start from the files in use, to add to them**.
- **Save as one file** downloads everything in use as one JSON file, a
  bundle. It can be dropped back on the dialog, or named wherever a
  directory is (`AEGIS_WORKSPACE`, `check-workspace`, `diff-workspace`).
- An import lives in the server's memory. A restart, or **Return to what the
  server started with**, brings back the files it started with. To keep an
  import, save it and start the server with it.
- `AEGIS_IMPORT=off` switches importing off; the dialog then only saves.
- On the static site, importing works the same way and the files stay in
  the tab; a workspace read at start-up needs the server.

### What Cedar would decide differently

Once the files are valid, **Compare with what is in use** asks
**What would Cedar decide differently?**: policies added, removed or changed
in meaning, catalogued requests and scenario flows whose outcome changes,
and every request the tracer can build that goes from allow to deny or
back. It is `diff-workspace` with the files in use as the base, and it
applies nothing.

### An incident on both platforms

A capacity, a service or a connection that would have made an incident go
differently is a change to a topology file. To try it before applying it,
stage the changed files, choose a scenario under **How would an incident go
on each?** and press **Run both**. The engine runs the scenario twice, from
the same seed: run A on the platform in use and run B on the one the files
describe. Nothing is applied and the timeline in use is not touched.

| Part of the answer                                     | What it says                                                                                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What differs**                                       | What the two descriptions state differently, matched by id and written as each file wrote it.                                                                                 |
| **What follows without being stated**                  | A capacity no file states is sized from load at rest, so it changes with the callers; a rate written as a share of a capacity is another rate where that capacity is another. |
| The two runs                                           | Highest and mean error rate, highest latency, services affected, how long each objective was not met, when everything was back to normal.                                     |
| **Watch run A**, **Apply these files and watch run B** | Puts one run on the timeline; the second applies the files first, as **Apply** does.                                                                                          |

Read the second part before the figures. The bundled DDoS surge is written
as 2.2 times what the gateway can take, so a gateway three times the size is
sent three times the flood. To put the same attack to both platforms, write
its rate in requests a second (`"rate": { "rps": 5400 }`). Two runs do not
say which difference an outcome follows from, and AEGIS does not say it for
them: to see what one change does, change that one alone.

## The platform editor

**⋯** → **Edit this platform** opens the topology on show; **Draw a new
platform** starts from one region and a client. It is a mode of the same
window: the simulation goes on behind it and comes back as it was.

- **Place a service.** Carry a piece from the palette on the left onto the
  table. The lane under the pointer is its region and the column its tier;
  the middle of the gap between two columns makes a new column, and just
  past the last lane a new region. A piece pressed without being carried, or
  with the keyboard, is added one tier past what is selected.
- **Connect.** Carry a piece onto another, or use **Connect to** on a
  service's card. The protocol and relationship are the ones their kinds
  suggest, the same the Compose reader uses. A connection that would close a
  circle is refused, with the services it would run through.
- **Edit.** The card on the right edits every field of the file for the
  selection: a service, a connection or, with nothing selected, the
  platform, its regions and its roles. A figure a file may leave out (a
  capacity, a rate limit, a filter, an autoscaler, a latency) is off until
  you turn it on, and then starts from what the engine gave it at rest.
  Delete removes the selection; Ctrl Z and Ctrl Shift Z undo and redo.
- **See what the engine makes of it.** A moment after the draft stops
  changing, the engine runs it at rest with the files in use around it (a
  preview: nothing is applied), and the model shows each service's state
  and its traffic. Until the engine has answered, a service is drawn as
  unknown, upright and fainter on a dashed ring; while a change is being
  run, the bar says the model is showing the last run.
- **Finish.** **Save the file** downloads the topology. **Compare an
  incident** stages it in the import dialog, to run an incident on it and on
  the platform in use. **Apply** puts it in use and, like any import, starts
  a new timeline for everyone connected. A draft that is not applied is not
  kept, so **Leave the editor** asks first when the draft has changes.

With the table view on, or where the browser has neither WebGPU nor
WebGL 2, the editor shows the draft as a table laid out by region and tier:
the palette (pressed rather than carried) and the card work the same way.

Beside **Platform**, the editor has an **Incident** tab, where a scenario is
written over the same model: phases on a strip, effects carried onto a
service, a region or a connection, flows drawn by clicking. It is what
**Write a scenario of your own** opens;
[Workspace files](Workspace-files#scenario) describes it with the format.

## A Compose file

Put a `docker-compose.yml` in `topologies/`, or drop it on the import
dialog, and it is read as a topology. The file is text: nothing is pulled,
built or run.

| From the file                                   | In the topology                                                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| each service                                    | a node named after it                                                                                                                         |
| its `image` (or, with none, its name)           | the node's kind: `postgres`, `redis`… a database; `rabbitmq`, `kafka`… a queue; `nginx`, `traefik`… an API gateway; anything else a container |
| `depends_on` and `links`, also through `<<: *x` | a connection from the service to what it needs                                                                                                |
| `ports`                                         | a connection from `clients` to each service that publishes one; with none published, to each service nothing depends on                       |
| the top-level `name`, or the file's name        | the platform's id and name                                                                                                                    |

A Compose file says nothing of traffic or latency, so those figures are the
converter's own defaults (100 requests a second from `clients`, a latency by
kind of service), and the topology's description says so. Treat the result
as a first draft: import it, save it as one file, and edit the figures and
the roles. A file whose services depend on each other in a circle, or on a
service it does not declare, is refused with the reason.

## A cloud inventory

A script in the repository reads what AWS, Google Cloud or Oracle Cloud
lists of an account and writes one file; the import dialog reads it, lets
you choose what to bring, and it becomes the platform. AEGIS itself reaches
no cloud and holds no credential. See [Cloud inventories](Cloud-inventories).

## What a service does about load

Three optional fields of a service say what it does when more arrives than
it was built for. None is on unless the file gives it, a platform that gives
none runs exactly as before, and an external client can have none of them.
In the editor they are under **What it does about load**.

| Field              | What the service does                                                                                                                                | Range                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `rateLimitRps`     | Admits at most this many requests a second, whoever sent them; the rest fail fast for the caller, and what is behind it is sent only what it admits. | above 0                                   |
| `suspiciousFilter` | Turns away this share of the traffic a scenario marks suspicious, from the first request. Ordinary traffic is not touched.                           | 0 to 1                                    |
| `autoscale`        | Lets capacity follow the load, up to `maxFactor` times its capacity at rest, closing about two thirds of the gap every `seconds`.                    | `maxFactor` 1 to 100, `seconds` 1 to 3600 |

Traffic meets them in this order: the filter, the rate limit, whatever a
scenario's own phase rejects, then capacity. The filter's share is the
file's statement, never worked out by the model. The bundled DDoS surge
begins to be filtered 36 seconds in, by its own phase; a platform that
states the same filter takes it from the start, and comparing the two is how
the cost of those 36 seconds is seen.

## Where the platform gives

**⋯** → **Find where the platform gives** asks two things of the platform
in use, at rest, each on timelines of its own:

- **How much traffic it takes** (**Find the limit**). Every external
  client's demand is multiplied by the same figure and held for a minute, at
  ×1.25, ×1.5, ×2, ×3, ×4, ×6, ×8, ×12 and ×16, up to the first figure at
  which an objective is missed; the gap is then halved five times. The
  answer is the last figure that held and the first that did not, with a row
  for every figure tried. Nothing is said of the figures in between.
- **What each service takes with it** (**Try every service**). Each service
  is made unreachable in turn, exactly as **Try one first, without placing
  it** on its card does, and the others that left their normal state are
  counted. A platform of more than 250 services is not ranked.

## What a workspace cannot do

- **Make the server open anything.** A directory is read once, before the
  server listens, from the one place `AEGIS_WORKSPACE` names. An import
  carries the text of its files; nothing is written to disk.
- **Make AEGIS contact anything.** No scenario effect leaves the engine.
- **State an outcome.** A file cannot label anything `live` or `recording`,
  state a Cedar decision, or place an event the engine did not produce.

What it does do is put its contents on screen: the API returns the
topology, the scenarios, every policy and the catalogue to whoever can reach
it, and AEGIS has no authentication. If the files describe a real system or
the server is shared, keep it on loopback or behind something that
authenticates, and set `AEGIS_IMPORT=off` where nobody should replace what
is on show. See [Security model](Security-model).

## Reference

- [docs/WORKSPACE.md](https://github.com/cleissonbarbosa/csdt/blob/main/docs/WORKSPACE.md): the complete guide to workspaces, the import dialog, the editor and the comparisons
- [docs/INVENTORY.md](https://github.com/cleissonbarbosa/csdt/blob/main/docs/INVENTORY.md): cloud inventories
- [docs/SECURITY.md](https://github.com/cleissonbarbosa/csdt/blob/main/docs/SECURITY.md): how a workspace is bounded
- [examples/corner-shop](https://github.com/cleissonbarbosa/csdt/tree/main/examples/corner-shop): a complete six-service workspace
- [apps/server/src/main.rs](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/main.rs): the command-line subcommands
- [apps/web/src/features/workspace/](https://github.com/cleissonbarbosa/csdt/tree/main/apps/web/src/features/workspace) and [apps/web/src/features/editor/](https://github.com/cleissonbarbosa/csdt/tree/main/apps/web/src/features/editor): the import dialog and the platform editor
