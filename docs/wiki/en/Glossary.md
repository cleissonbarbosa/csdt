**English** · [Português](Glossário)

The words the interface and this wiki use, each with one meaning. The
interface is in English and Brazilian Portuguese and keeps one word for each
thing in both; the Portuguese page gives the pair.

## The platform and the model

| Term            | Meaning                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform        | The services the simulation runs. The bundled one is _Helios Commerce_: 51 services across three regions and a global edge. A stress topology of 178 services and 648 connections ships too. |
| Topology        | The file that describes a platform: its services and the connections between them, which form a directed graph without cycles.                                                               |
| Service         | One node of a topology, with a kind, a region and a dependency tier.                                                                                                                         |
| Kind of service | What a service is: a gateway, an authorizer, a database, a load balancer and so on. There are seventeen, each drawn as its own piece.                                                        |
| Piece           | The modelled object that stands for a kind of service on screen. Its one working part moves at the pace of the service's traffic.                                                            |
| Overview        | The opening level: one piece per kind of service, in the four layers a request crosses (entry, identity, compute, data). Its figures are those of the services it stands for, added up.      |
| Arrangement     | How the detailed model is laid out: every service on its own, by cloud region or by dependency tier.                                                                                         |
| Table view      | The same model as an accessible table, used when the browser has no 3D and available at any time with <kbd>T</kbd>.                                                                          |
| Bead            | A mark that moves along a connection and stands for traffic. Ordinary traffic is told apart by shape; only traffic that went wrong (error, rejected, suspicious) has a colour.               |
| Normal range    | The band a signal is read against. A number on screen comes with it.                                                                                                                         |
| Health          | A service is healthy, degraded, critical or down. A healthy service has no colour, dot or badge.                                                                                             |
| Exposure        | Everything a service could open a connection toward, following the topology. It is what the topology allows, not a claim that an attack would succeed.                                       |

## Time

| Term                 | Meaning                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tick                 | One step of the engine: 200 ms of virtual time.                                                                                                                                |
| The simulation's now | Where new history is being made. It can be paused.                                                                                                                             |
| History              | Every moment before the simulation's now. Going back to one restores it exactly; it can be paused too. History is bounded to 30 virtual minutes and 8 000 events.              |
| Replay               | Re-simulating recorded history, bit for bit, from its seed and its commands.                                                                                                   |
| Seed                 | The number the engine's random generator starts from. The same seed and the same commands give the same run.                                                                   |
| Checkpoint           | A copy of the engine's state taken every 25 ticks, from which a past moment is re-simulated.                                                                                   |
| Recording            | A seed plus a list of commands: a prerecorded incident, loaded and simulated again.                                                                                            |
| Session              | What is on screen, saved as a file or a link: the platform, the seed, the commands issued, the moment and the view. Opening one simulates it again; no figure travels with it. |

## Incidents

| Term                   | Meaning                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scenario               | An incident written as data: phases, the effects each phase has, and the events it announces. Five are bundled.                                                       |
| Role                   | A part of a platform a scenario names instead of a service id, such as `primaryGateway` or `outageRegion`, so the same scenario runs on more than one topology.       |
| Phase                  | A stretch of a scenario, timed from the start of its incident (`+0:14`).                                                                                              |
| Fault                  | A failure placed by hand on a service, outside any scenario.                                                                                                          |
| Objective              | One of the two thresholds the engine's detection rules alert on: an error rate and a p95 latency. A report counts the time spent past them.                           |
| Prescribed             | A statement written in the scenario file.                                                                                                                             |
| Modelled               | A statement that follows from a relation of the topology the model follows, such as a dependency or load.                                                             |
| Observed               | A statement recorded during the run.                                                                                                                                  |
| Not explained          | What a report cannot account for, said in those words rather than guessed.                                                                                            |
| Intervention           | One change (more capacity, a service taken out) made at a chosen moment, run against the same incident without it on timelines of their own.                          |
| Trial                  | A fault simulated on the platform at rest before it is placed, to see which services would leave normal. Nothing is put on the timeline.                              |
| Limits and weak points | How much demand the platform at rest takes before an objective is missed, and which services take the most others with them when they go down. Every figure is a run. |
| Challenge              | A question about the platform answered by using it, and checked against the model itself.                                                                             |

## Cedar

| Term          | Meaning                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request       | What is put to Cedar: a principal (who asks), an action (what for), a resource (on which thing) and a context.                                        |
| Decision      | Cedar's answer to a request: Allow or Deny, with the policies that determine it and its diagnostics.                                                  |
| Policy        | A Cedar rule that permits or forbids.                                                                                                                 |
| Standing      | What one policy says about a request on its own: it holds; it is about this request but its condition does not hold; or it is not about this request. |
| Access matrix | Cedar's decision for every request the catalogue describes, principals down and actions across.                                                       |
| Catalogue     | The request shapes the simulation knows (`fixtures/cedar/catalog.json`). A scenario flow is blocked only where Cedar denied its shape.                |
| Stale         | A result whose form has changed since it was evaluated. It is marked as the answer to something else, never shown as current.                         |

## Files and data

| Term             | Meaning                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace        | A set of files (topologies, scenarios, recordings, Cedar policies) that replaces the bundled ones, from a directory the server starts with or imported from the interface.     |
| Preview          | The platform a set of files describes, simulated at rest before anything is applied.                                                                                           |
| Platform editor  | The mode in which a platform is drawn or edited piece by piece. What it produces is a topology file.                                                                           |
| Compose file     | A `docker-compose.yml`, read as text into a topology. Every figure it does not hold is a default the topology says it is.                                                      |
| Cloud inventory  | A file a collector script writes from what an AWS, Google Cloud or Oracle Cloud account lists. AEGIS reads the file; it asks no provider anything.                             |
| Incident capture | A real incident, as a provider reported it or a system measured it, read by the browser from a file and shown in the same model. It never reaches the simulation's timeline.   |
| Provider report  | A capture transcribed by hand from a provider's public incident report.                                                                                                        |
| Provenance       | Where a figure comes from: _synthetic_ (the simulation), _recording_ (an incident capture, labelled "Capture") or _live_ (measured from an explicitly connected local system). |
| Connected mode   | The simulation with a local integration connected, such as a cedar-agent instance. It needs server configuration and an explicit click.                                        |
| Static site      | The build in which the engine runs in the browser tab as WebAssembly, with no server.                                                                                          |
| Engine           | The deterministic simulation: on the server, or compiled to WebAssembly for the static site.                                                                                   |

## Words AEGIS avoids

- **"Live" for simulated time.** The cursor is at the simulation's now or in
  its history. "Live" is kept for data measured from a connected system.
- **"Replay" or "recorded" for an incident capture.** Those are the
  simulation's: its re-simulated history and its prerecorded incidents.
- **"SLO" or "error budget" for an objective.** Nobody agreed the
  thresholds with anybody; they are the engine's own.
- **"Live" or "observed" for anything in a capture,** and "objective" for a
  capture's thresholds.
- **A colour for normal.** No "healthy green": a hue answers either the
  viewer (blue, for what is selected) or the data (amber, red and magenta,
  for what deviates).

## Reference

- [docs/DESIGN.md, "Words"](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DESIGN.md)
- [AGENTS.md](https://github.com/cleissonbarbosa/csdt/blob/main/AGENTS.md)
- [The interface's Portuguese vocabulary](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/i18n/pt-BR/common.ts)
