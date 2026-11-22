[English](HTTP-API-and-stream) · **Português**

O servidor responde JSON por HTTP sob `/api/v1` e transmite a telemetria por
um único WebSocket, `/api/v1/stream`. A interface não usa mais nada, e o motor
no navegador serve as mesmas rotas. Esta página lista cada rota como a
`route_table()` em
[`apps/server/src/api/mod.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/api/mod.rs)
a declara.

## Convenções

- **Caminho base** `/api/v1`. JSON em tudo, com nomes de campos em camelCase.
  Versão do contrato `1.0` (`schemaVersion`), versão do protocolo do stream `1`
  (`protocolVersion`).
- **Métodos** só `GET` e `POST`. O corpo de um `POST` é JSON enviado com
  `Content-Type: application/json`, lido num tipo que recusa campos
  desconhecidos.
- **Identificadores** num caminho, numa query ou num campo de id têm de 1 a 128
  caracteres: letras, dígitos e `-`, `_`, `:`, `.`, `>`.
- **Rotas desconhecidas** respondem 404 `not_found`.
- **Onde escuta.** Em desenvolvimento o servidor fica em `127.0.0.1:8787`
  (`AEGIS_BIND`), e o Vite repassa `/api` para ele, então o navegador só fala
  com a própria origem.

```bash
curl -fsS http://127.0.0.1:8787/api/v1/health
curl -fsS -X POST -H 'Content-Type: application/json' \
  -d '{"scenarioId":"ddos-surge"}' \
  http://127.0.0.1:8787/api/v1/demo/scenarios/start
```

A simulação é compartilhada: uma mutação muda o que todos os conectados veem.

## Rotas

Os caminhos são relativos a `/api/v1`. Um campo de corpo escrito com `?` pode
ser omitido.

### Plataforma e histórico

| Método | Caminho                  | O que faz                                                                                                                                      |
| ------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                | Versão do servidor, versões do esquema e do protocolo, tempo no ar, a topologia ativa, o tick atual e o motor de autorização                   |
| GET    | `/topology`              | A topologia em uso: os seus nós e arestas                                                                                                      |
| GET    | `/topologies`            | As topologias disponíveis e a ativa (`activeId`)                                                                                               |
| GET    | `/metrics`               | As métricas atuais da plataforma e o seu histórico                                                                                             |
| GET    | `/events`                | Eventos da linha do tempo. Query: `afterSeq` (padrão 0), `limit` (padrão 200, limitado a 1–1000; ficam os mais novos), `nodeId`, `minSeverity` |
| GET    | `/incidents`             | Os incidentes da linha do tempo em uso                                                                                                         |
| GET    | `/incidents/{id}/report` | Um incidente relido a partir do seu registro; 404 para um desconhecido ou mais antigo que o histórico guardado                                 |
| GET    | `/scenarios`             | Os cenários, com `unavailableReason` naquele que a topologia em uso não consegue rodar, e o id do cenário ativo                                |
| GET    | `/recordings`            | Os incidentes gravados que podem ser carregados                                                                                                |

### Controle da simulação

Cada uma responde `{"playback": …}`, o estado de reprodução depois do comando.

| Método | Caminho                  | O que faz                                                                                                                                                                                            |
| ------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/demo/scenarios/start`  | Inicia um cenário: `{scenarioId}`. 409 quando ele não está disponível na topologia em uso                                                                                                            |
| POST   | `/demo/scenarios/reset`  | Com corpo vazio, recomeça a simulação inteira do tick 0; `{"scope":"scenario"}` só para o cenário em execução e mantém o histórico                                                                   |
| POST   | `/demo/faults/inject`    | Aplica uma falha manualmente: `{effect, rampMs?}`, um efeito no formato em que uma fase de cenário o escreve                                                                                         |
| POST   | `/demo/faults/clear`     | Retira as falhas que `effect` atinge, ou todas com `{}`                                                                                                                                              |
| POST   | `/demo/playback/control` | `{action}`: `play`, `pause`, `step`, `seek` (com `toMs`), `setSpeed` (com `speed`: `0.5`, `1`, `2` ou `4`), `replay` (volta ao início do incidente mais recente), `live` (vai ao agora da simulação) |
| POST   | `/demo/topology/select`  | Troca a topologia: `{topologyId}`                                                                                                                                                                    |
| POST   | `/demo/recordings/load`  | Carrega uma gravação e a simula de novo: `{recordingId}`                                                                                                                                             |

Cada ação de reprodução aceita exatamente os parâmetros de que precisa: `seek`
com qualquer coisa além de `toMs`, ou `play` com um `speed`, é recusado com 400. O nome `live` é o do contrato; a interface chama esse momento de agora da
simulação, nunca de "ao vivo".

### Sessões e experimentos

Nenhum dos cinco experimentos toca na linha do tempo em uso: cada um roda em
linhas do tempo próprias, a partir da semente do servidor.

| Método | Caminho                         | O que faz                                                                                                                               |
| ------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/session`                      | A linha do tempo em uso como uma semente e uma lista de comandos: o que a reproduz. As decisões ficam de fora e são contadas            |
| POST   | `/demo/session/load`            | Troca a linha do tempo pela que uma sessão descreve, simulada de novo: `{recording, cursorMs?}`. Com um cursor, ela espera ali, pausada |
| POST   | `/demo/experiments/compare`     | Um cenário duas vezes, a segunda com uma falha aplicada: `{scenarioId, intervention: {effect, atMs, rampMs?}}`                          |
| POST   | `/demo/experiments/trial`       | Uma falha na plataforma em repouso: `{effect, rampMs?}`. Quais serviços saíram do normal, em ordem, e até onde foram os números         |
| POST   | `/demo/experiments/headroom`    | Quantas vezes a sua demanda comum a plataforma em uso aguenta antes de um objetivo ser perdido. Corpo `{}`                              |
| POST   | `/demo/experiments/weak-points` | Cada serviço retirado por vez, com o que saiu do normal a cada vez. Corpo `{}`                                                          |
| POST   | `/demo/experiments/platforms`   | Um cenário na plataforma em uso e naquela que os arquivos enviados descrevem: `{files, scenarioId, topologyId?}`                        |

### Espaço de trabalho

Um arquivo é `{"path", "text"}`; [Arquivos do espaço de
trabalho](Arquivos-do-espaço-de-trabalho) descreve os formatos.

| Método | Caminho                   | O que faz                                                                                                                                                  |
| ------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/workspace`              | O que está em uso: as partes substituídas, as topologias, os ids de cenários e gravações, o número de políticas e se a importação está ligada              |
| GET    | `/workspace/export`       | Os arquivos em uso como um só pacote, para salvar, editar e importar de novo                                                                               |
| POST   | `/demo/workspace/check`   | O que aplicar `{files}` daria, ou o que há de errado com eles, com um levantamento de cada inventário de nuvem entre eles (`inventories`). Nada é aplicado |
| POST   | `/demo/workspace/import`  | Troca as topologias, os cenários e as políticas em uso por `{files}`, mantidos só em memória                                                               |
| POST   | `/demo/workspace/diff`    | O que o Cedar decidiria diferente com `{files}`: `decisionsChanged` e o `diff`. Nada é aplicado                                                            |
| POST   | `/demo/workspace/preview` | Uma plataforma de `{files, topologyId?}` em repouso, numa linha do tempo própria. Nada é aplicado                                                          |
| POST   | `/demo/workspace/reset`   | Volta ao que o servidor tinha ao iniciar                                                                                                                   |

### Autorização

| Método | Caminho                         | O que faz                                                                                                                                                             |
| ------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/demo/authorization/catalog`   | Os motores e a sua disponibilidade, as políticas, locatários, principais, ações, recursos e chaves de contexto, e a parcela do tráfego de referência que o Cedar nega |
| GET    | `/demo/authorization/decisions` | As decisões na linha do tempo                                                                                                                                         |
| POST   | `/demo/authorization/evaluate`  | Avalia uma requisição e a registra: `{principal, action, resource, context?, disabledPolicies?, engine?}`; `engine` é `embedded` (o padrão) ou `cedar-agent`          |
| POST   | `/demo/authorization/explain`   | Uma requisição, política por política, perguntada ao motor embutido: `{principal, action, resource, context?, disabledPolicies?}`. Não é registrada em lugar nenhum   |
| POST   | `/demo/authorization/matrix`    | Toda requisição que o catálogo descreve, sob um contexto: `{context?, disabledPolicies?}`. Não é registrada em lugar nenhum                                           |

Com `cedar-agent`, `disabledPolicies` é recusado: quem decide é o
armazenamento de políticas do próprio agente. Veja [Políticas
Cedar](Políticas-Cedar) e [Integrações](Integrações).

### Integrações e o stream

| Método | Caminho                      | O que faz                                                       |
| ------ | ---------------------------- | --------------------------------------------------------------- |
| GET    | `/providers`                 | Cada provedor e o seu estado                                    |
| POST   | `/providers/{id}/connect`    | Conecta uma integração configurada; responde a lista de estados |
| POST   | `/providers/{id}/disconnect` | Desconecta; responde a lista de estados                         |
| WS     | `/stream`                    | Telemetria e eventos (só no servidor; veja abaixo)              |

## Limites

| O quê                               | Limite                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Corpo da requisição                 | 16 KiB; 8 MiB para `check`, `import`, `diff`, `preview` e `platforms`; 256 KiB para uma sessão |
| Taxa de requisições `GET`           | Por cliente: uma rajada de 240, recarregando 120 por segundo                                   |
| Taxa de todas as outras             | Por cliente: uma rajada de 40, recarregando 8 por segundo                                      |
| Tempo de uma requisição             | 10 s, depois 408                                                                               |
| Eventos por `GET /events`           | 1000                                                                                           |
| Políticas desligadas numa pergunta  | 32                                                                                             |
| Assinantes do stream ao mesmo tempo | 64                                                                                             |

Acima da taxa, a resposta é 429 `rate_limited`, com um cabeçalho
`Retry-After`. Com `AEGIS_IMPORT=off`, as rotas que recebem arquivos ou os
restauram (`check`, `import`, `diff`, `preview`, `platforms` e
`workspace/reset`) respondem 403 `import_disabled`. Os cabeçalhos de resposta
e o resto das proteções estão em [Modelo de segurança](Modelo-de-segurança).

## Erros

Todo handler responde um erro num só formato:

```json
{ "error": { "code": "not_found", "message": "no such route" } }
```

| Status | Código                                                                                        | Quando                                                                                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_request`                                                                             | Um corpo, query ou caminho malformado, um id inválido, uma ação de reprodução com parâmetros errados, uma velocidade não suportada, políticas desligadas demais, uma requisição Cedar inválida |
| 413    | `invalid_request`                                                                             | Um corpo acima do limite                                                                                                                                                                       |
| 415    | `invalid_request`                                                                             | Um corpo que não foi enviado como JSON                                                                                                                                                         |
| 403    | `import_disabled`, `origin_not_allowed`                                                       | A importação está desligada; o stream foi aberto de uma origem não permitida                                                                                                                   |
| 404    | `not_found`                                                                                   | Uma rota, cenário, topologia, gravação, incidente ou provedor desconhecido                                                                                                                     |
| 409    | `conflict`                                                                                    | Um cenário indisponível na topologia em uso, nenhum cenário rodando, ou os arquivos em uso trocados nesse meio-tempo                                                                           |
| 409    | `too_many_faults`, `not_configured`, `unsupported`                                            | Falhas demais em vigor; uma integração não configurada, ou que não consegue fazer isso                                                                                                         |
| 422    | `invalid_workspace`                                                                           | Os arquivos não formam um espaço de trabalho válido; a mensagem nomeia o arquivo                                                                                                               |
| 422    | `invalid_fault`, `invalid_session`, `invalid_experiment`, `invalid_preview`, `target_refused` | O que foi pedido não pode ser aplicado nem rodado; o destino de uma integração é recusado                                                                                                      |
| 429    | `rate_limited`                                                                                | Acima da taxa por cliente                                                                                                                                                                      |
| 500    | `internal`                                                                                    | Um trabalho que não pôde terminar                                                                                                                                                              |
| 502    | `engine_error`, `target_unreachable`, `target_protocol`                                       | O `cedar-agent` ou o destino de uma integração respondeu errado ou não respondeu                                                                                                               |
| 503    | `engine_unavailable`, `too_many_streams`                                                      | O motor de autorização pedido não está disponível; já há 64 assinantes                                                                                                                         |

## O stream

Abra um WebSocket em `/api/v1/stream`. O servidor envia `hello`, depois um
`snapshot`, e daí em diante cada mensagem é um objeto JSON identificado por
`type`.

| Mensagem   | Campos                                                       | Quando é enviada                                                                                                                |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `hello`    | `protocolVersion`, `schemaVersion`, `topologyId`, `playback` | Primeiro                                                                                                                        |
| `snapshot` | `data`: o snapshot de telemetria                             | Depois de `hello`; sempre que a simulação avançou; a cada 2 s enquanto pausada; depois de `timeline` e de `lagged`              |
| `events`   | `data`: os eventos novos                                     | Quando a simulação produz eventos, e em resposta a `resync`                                                                     |
| `timeline` | `reason`, `playback`                                         | O histórico mudou de forma (`reset`, `branch`, `seek`, `topology`, `recording`, `workspace`): busque de novo o estado pelo REST |
| `lagged`   | `dropped`                                                    | O assinante ficou para trás; segue-se um snapshot novo                                                                          |
| `pong`     | `t`                                                          | Em resposta a `ping`                                                                                                            |

O cliente pode enviar duas mensagens:

| Mensagem | Formato                            | Resposta                                                                            |
| -------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| `ping`   | `{"type":"ping","t":<number>}`     | `pong` com o mesmo `t`, que precisa ser um número finito                            |
| `resync` | `{"type":"resync","afterSeq":<n>}` | `events` depois desse número de sequência, no máximo 500; nada quando não há nenhum |

- **Snapshots colunares.** As métricas por nó e por aresta são arrays
  alinhados índice a índice com a topologia: compactos no fio e copiados
  direto para os arrays tipados que o renderizador usa.
- **Contrapressão.** Cada mensagem é serializada uma vez e distribuída por um
  único buffer limitado, de 256 mensagens. Um assinante que fica para trás não
  atrasa a simulação: recebe `lagged` e um snapshot novo, e pode pedir os
  eventos perdidos com `resync`. Os eventos têm números de sequência sem
  lacunas, então um cliente sempre sabe o que já tem.
- **Limites.** Uma mensagem do cliente tem no máximo 1 KiB, e chegam no máximo
  20 por segundo; mais do que isso fecha o socket, assim como mais de 8
  mensagens malformadas (um frame binário conta como uma). Um socket travado
  por 5 s num envio é desconectado.
- **Origem.** Navegadores não aplicam CORS a um WebSocket, por isso o
  handshake confere o `Origin` contra `AEGIS_ALLOWED_ORIGINS`. Um cliente que
  não envia `Origin`, o que não é um navegador, é aceito.

## No site estático

O motor compilado para WebAssembly serve o `api::offline_router`: a mesma
`route_table()`, com os mesmos limites de corpo, e sem os limites de taxa, a
verificação de origem ou uma rota `/stream`. Uma requisição é uma chamada de
função (`aegis_request`), e o stream é o que cada chamada devolve: `aegis_open`
dá `hello` e um snapshot, `aegis_advance` as mensagens que o tempo produziu, e
`aegis_message` responde `ping` e `resync` com `api::protocol::answer`, a
mesma função que o handler do WebSocket chama. Uma página que fica para trás
recebe `lagged` e um snapshot novo, como no servidor. Antes de o motor
iniciar, uma requisição recebe 503 `not_ready`.

A lista de provedores é a única diferença proposital entre os dois. Uma rota
nova entra na `route_table()`, para que as duas compilações a sirvam, e na
lista de `apps/web/src/engine/parity.spec.ts`, que chama cada rota no módulo
compilado. [Arquitetura](Arquitetura#o-motor-no-navegador) descreve a
fronteira.

## Exemplos

`packages/contracts/samples/` guarda respostas reais, escritas pelo servidor
enquanto ele roda um cenário fixo; os testes de contrato cobram dos esquemas
zod que as aceitem.

| Rota ou mensagem                     | Amostra                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /health`                        | [`health.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/health.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET /topology`                      | [`topology.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/topology.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET /events`                        | [`events.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/events.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET /incidents/{id}/report`         | [`incident-report.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/incident-report.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET /scenarios`                     | [`scenarios.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/scenarios.json), [`scenarios-unavailable.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/scenarios-unavailable.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `POST /demo/scenarios/start`         | [`control-response.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/control-response.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `POST /demo/authorization/evaluate`  | [`decision-allow.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/decision-allow.json), [`decision-deny.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/decision-deny.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `POST /demo/authorization/explain`   | [`authorization-explanation.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/authorization-explanation.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST /demo/authorization/matrix`    | [`access-matrix.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/access-matrix.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GET /session`                       | [`session.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/session.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `POST /demo/experiments/compare`     | [`experiment.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/experiment.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /demo/experiments/trial`       | [`trial.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/trial.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `POST /demo/experiments/headroom`    | [`headroom.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/headroom.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `POST /demo/experiments/weak-points` | [`weak-points.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/weak-points.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST /demo/experiments/platforms`   | [`platform-comparison.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/platform-comparison.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST /demo/workspace/check`         | [`workspace-check.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/workspace-check.json), [`workspace-check-invalid.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/workspace-check-invalid.json), [`workspace-check-inventory.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/workspace-check-inventory.json)                                                                                                                                                                                                                                                                                                                              |
| `POST /demo/workspace/diff`          | [`workspace-diff.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/workspace-diff.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /demo/workspace/preview`       | [`workspace-preview.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/workspace-preview.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST /demo/workspace/import`        | [`workspace-response.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/workspace-response.json)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Mensagens do stream                  | [`stream-hello.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/stream-hello.json), [`stream-snapshot.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/stream-snapshot.json), [`stream-events.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/stream-events.json), [`stream-timeline.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/stream-timeline.json), [`stream-lagged.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/stream-lagged.json), [`stream-pong.json`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/samples/stream-pong.json) |

A amostra do experimento foi produzida por este corpo, que deixa o Orders DB
da plataforma embutida inacessível (`down`), com uma rampa de 1000 ms:

```json
{ "effect": { "type": "down", "nodes": "node:use-orders-db" }, "rampMs": 1000 }
```

## Referência

Os documentos e arquivos abaixo estão em inglês.

- [`docs/ARCHITECTURE.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/ARCHITECTURE.md): "The API", "Stream protocol", "The engine in the browser"
- [`docs/SECURITY.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/SECURITY.md): "Server", "Sessions, comparisons and reports"
- [`apps/server/src/api/mod.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/api/mod.rs): `route_table()`, limites de corpo e de taxa, cabeçalhos
- [`apps/server/src/api/routes.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/api/routes.rs): cada handler e o seu corpo
- [`apps/server/src/api/error.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/api/error.rs): o formato do erro e os códigos
- [`apps/server/src/api/ws.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/api/ws.rs) e
  [`apps/server/src/api/protocol.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/api/protocol.rs): o stream
- [`apps/wasm/src/lib.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/wasm/src/lib.rs): as mesmas rotas no navegador
- [`packages/contracts/src/index.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/packages/contracts/src/index.ts) e
  [`packages/contracts/samples/`](https://github.com/cleissonbarbosa/csdt/tree/main/packages/contracts/samples)
