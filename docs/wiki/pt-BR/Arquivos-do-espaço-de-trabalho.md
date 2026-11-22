[English](Workspace-files) · **Português**

Um espaço de trabalho é um conjunto de arquivos nos formatos abaixo. A
plataforma que vem com o AEGIS, em
[`fixtures/`](https://github.com/cleissonbarbosa/csdt/tree/main/fixtures),
usa a mesma estrutura, e o
[`examples/corner-shop`](https://github.com/cleissonbarbosa/csdt/tree/main/examples/corner-shop)
também: um espaço de trabalho completo em seis serviços, de onde vem cada
exemplo desta página. Como trazer os arquivos está em
[Sua própria plataforma](Sua-própria-plataforma).

## Estrutura

```text
<workspace>/
  workspace.json           optional format version; omitted means version 1
  topologies/*.json         the platforms on offer
  topologies/*.yml          … or a Compose file, read as one (see below)
                            (a .json that is a cloud inventory is read as one too)
  scenarios/*.json          incident scenarios
  recordings/*.json         prerecorded incidents
  cedar/policies.json       policies as a JSON list …
  cedar/*.cedar             … or in Cedar's own syntax (one form, not both)
  cedar/entities.json       the entity store
  cedar/catalog.json        what the request tracer offers and what traffic is made of
  cedar/schema.cedarschema  optional: validate policies and entities against it
```

- **Uma parte presente substitui a que vem com o AEGIS.** Um diretório
  `topologies/` faz com que só as suas topologias sejam oferecidas.
- **Uma parte ausente vem do conjunto do AEGIS.**
- **Os arquivos são lidos em ordem de nome.** A primeira topologia é a que
  abre, e os cenários são listados nessa ordem; é por isso que os do AEGIS
  se chamam `01-…`, `02-…`.
- Sem um diretório `recordings/`, uma gravação do AEGIS só é mantida
  enquanto a topologia dela e os cenários que ela inicia continuam lá.
- Qualquer outra coisa no diretório não é lida, e o `check-workspace` a
  lista.

Um arquivo Compose (`.yml` ou `.yaml`) e um inventário de nuvem são lidos
como topologias; veja
[Sua própria plataforma](Sua-própria-plataforma#um-arquivo-compose) e
[Inventários de nuvem](Inventários-de-nuvem). Limites: 4 MiB por arquivo, 64
arquivos de um mesmo tipo, 2 000 serviços e 20 000 conexões por topologia,
512 políticas.

## Versão do formato

As exportações novas incluem o `workspace.json`, que dá a versão de todos os
formatos do diretório de uma vez:

```json
{ "formatVersion": 1 }
```

Um espaço de trabalho sem ele é a versão 1. Uma versão não suportada, um
manifesto malformado ou um campo desconhecido nele é recusado, com o nome do
arquivo, antes de qualquer outra leitura. Essa versão é independente do
`schemaVersion` do contrato HTTP.

## JSON Schemas para o seu editor

Documentos JSON Schema Draft 7 autocontidos, em
[`schemas/v1/`](https://github.com/cleissonbarbosa/csdt/tree/main/schemas/v1),
descrevem a versão 1. Eles dão ao seu editor autocompletar e verificação de
estrutura, inclusive dos seletores, das faixas dos efeitos e dos comandos e
eventos que um arquivo pode declarar, e a validação não precisa de rede.

| Arquivo                                             | Schema                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `workspace.json`                                    | `workspace.schema.json`                                                        |
| um arquivo salvo com **Salvar em um único arquivo** | `bundle.schema.json`                                                           |
| `topologies/*.json`                                 | `topology.schema.json`, ou `inventory.schema.json` para um inventário de nuvem |
| `scenarios/*.json`                                  | `scenario.schema.json`                                                         |
| `recordings/*.json`                                 | `recording.schema.json`                                                        |
| `cedar/catalog.json`                                | `catalog.schema.json`                                                          |
| `cedar/policies.json`                               | `policies.schema.json`                                                         |

Associe-os aos seus arquivos nas configurações do editor, para que nada seja
acrescentado aos próprios arquivos; o
[schemas/README.md](https://github.com/cleissonbarbosa/csdt/blob/main/schemas/README.md)
mostra como, com o `json.schemas` do VS Code. Um schema verifica um arquivo:
ele não prova que o grafo não tem ciclo, que os ids são únicos, que as
referências entre arquivos valem nem que os arquivos Cedar são válidos. O
`check-workspace` prova. Os schemas são gerados a partir dos tipos Rust com
`pnpm workspace:schemas`, nunca editados à mão. Entidades, esquemas Cedar e
arquivos `.cedar` seguem os formatos do próprio Cedar.

## Topologia

Uma topologia descreve uma plataforma: as regiões, os serviços (nós) e as
conexões entre eles (arestas). Este é o
`examples/corner-shop/topologies/corner-shop.json`, reduzido a dois dos seus
seis serviços, uma das suas cinco conexões e duas das suas funções:

```json
{
  "id": "corner-shop",
  "name": "Corner Shop",
  "description": "Fictional six-service platform: the smallest topology that uses every part of a workspace.",
  "dataSource": "synthetic",
  "regions": [
    { "id": "shop-floor", "name": "Shop floor", "kind": "cloud", "location": "Ground level" }
  ],
  "roles": { "partnerClient": "shoppers", "primaryGateway": "front-door" },
  "nodes": [
    {
      "id": "shoppers",
      "name": "Shoppers",
      "type": "external-client",
      "region": "shop-floor",
      "tier": 0,
      "baseLatencyMs": 0,
      "baseRps": 120,
      "description": "People at the counter."
    },
    {
      "id": "front-door",
      "name": "Front door",
      "type": "api-gateway",
      "region": "shop-floor",
      "tier": 1,
      "baseLatencyMs": 4,
      "description": "Everything comes in through here."
    }
  ],
  "edges": [
    {
      "source": "shoppers",
      "target": "front-door",
      "protocol": "https",
      "relationship": "route",
      "weight": 1.0
    }
  ]
}
```

### Campos principais

| Campo                                                   | Significado                                                                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataSource`                                            | Tem de ser `synthetic`: os números vêm da simulação, seja qual for a plataforma.                                                                                                    |
| `regions[].kind`                                        | `cloud`, ou `edge` para uma borda global, desenhada como o centro em volta do qual as regiões ficam. Uma topologia não precisa de região de borda.                                  |
| `nodes[].type`                                          | Um dos dezessete tipos abaixo. Decide a peça desenhada e como o modelo trata o nó.                                                                                                  |
| `nodes[].tier`                                          | Em que ponto do caminho de uma requisição o serviço fica, a partir de 0. Usado só pelo layout.                                                                                      |
| `nodes[].baseLatencyMs`                                 | A latência própria do serviço quando ocioso.                                                                                                                                        |
| `nodes[].baseRps`                                       | Para um `external-client`: a demanda que ele gera. Toda outra carga decorre das conexões.                                                                                           |
| `nodes[].capacityRps`, `headroom`                       | Opcionais. Sem eles, a capacidade é a carga do nó na demanda nominal vezes uma folga que depende do tipo.                                                                           |
| `nodes[].rateLimitRps`, `suspiciousFilter`, `autoscale` | Opcionais: [o que um serviço faz com a carga](Sua-própria-plataforma#o-que-um-serviço-faz-com-a-carga).                                                                             |
| `edges[].weight`                                        | Chamadas feitas na conexão por requisição que a origem atende.                                                                                                                      |
| `edges[].relationship`                                  | `route` (cada requisição segue exatamente uma), `call`, `auth`, `authz`, `data` (todas síncronas: uma falha chega a quem chamou), `publish`, `consume`, `replication`, `telemetry`. |
| `edges[].criticality`                                   | Opcional, de 0 a 1: com que força uma falha do destino derruba quem chamou. O padrão depende da relação.                                                                            |
| `edges[].latencyMs`                                     | Latência de rede opcional do salto. O padrão é 1,2 ms dentro de uma região e 60 ms entre regiões.                                                                                   |
| `edges[].protocol`                                      | `https`, `grpc`, `amqp`, `sql`, `redis`, `s3`, `tcp` ou `otlp`. Mostrado, não simulado.                                                                                             |

As restrições, cada uma informada com o id envolvido: o grafo é acíclico (a
carga se propaga numa só passada, então dois serviços que chamam um ao outro
são descritos pelo sentido que leva a requisição); os ids têm de 1 a 64
letras, dígitos, `-`, `_` ou `.`, e são únicos; toda conexão liga dois nós
declarados, todo nó fica numa região declarada e toda função aponta para um
nó ou uma região.

### Tipos de serviço

`external-client`, `network-gateway`, `load-balancer`, `api-gateway`,
`auth-service`, `cedar-authorizer`, `security-monitor`, `virtual-machine`,
`microservice`, `container`, `kubernetes-cluster`, `serverless`,
`message-queue`, `event-stream`, `database`, `cache`, `storage`. São
dezessete porque cada um tem uma peça modelada; um serviço de outro tipo é
classificado no mais próximo.

### Funções

Uma função dá nome a um lugar numa topologia. Os cenários que vêm com o
AEGIS e o rastreador de requisições usam funções, não ids, e é isso que os
deixa rodar em qualquer topologia que as declare.

| Função                           | Aponta para                                                   | Usada por                                                                  |
| -------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `primaryGateway`                 | um gateway de API                                             | rastreador, `ddos-surge`, `credential-stuffing`, `cedar-denial`            |
| `primaryAuth`                    | um serviço de autenticação                                    | rastreador, `credential-stuffing`, `cedar-denial`                          |
| `primaryAuthorizer`              | um autorizador Cedar                                          | rastreador, `credential-stuffing`, `cedar-denial`                          |
| `partnerClient`                  | um cliente externo                                            | rastreador (onde uma requisição começa), `cedar-denial`                    |
| `resource:<EntityType>`          | um serviço ou armazenamento                                   | rastreador: uma requisição para `Order::"…"` termina em `resource:Order`   |
| `protectedResource`              | um serviço ou armazenamento                                   | rastreador (quando nenhuma função `resource:` corresponde), `cedar-denial` |
| `edgeRouter`                     | o roteador da borda global                                    | `ddos-surge`, `credential-stuffing`, `cedar-denial`, `regional-outage`     |
| `attackSource`                   | um cliente externo                                            | `ddos-surge`, `credential-stuffing`                                        |
| `primaryDatabase`                | um banco de dados                                             | `cascading-failure`                                                        |
| `securityMonitor`                | um monitor de ameaças                                         | o nó citado nos alertas que o motor levanta; os cinco cenários do AEGIS    |
| `outageRegion`, `failoverRegion` | regiões com um gateway de API ou um balanceador de carga cada | `regional-outage`                                                          |

Uma topologia sem `primaryGateway`, `primaryAuth` e `primaryAuthorizer`
continua avaliando requisições; o rastreador só não tem caminho para
desenhar, e diz isso.

## Cenário

Um cenário muda números dentro do modelo e anuncia eventos; nenhum efeito
sai do motor. Este é o `examples/corner-shop/scenarios/01-ledger-fire.json`,
reduzido à primeira e à última das suas quatro fases:

```json
{
  "id": "ledger-fire",
  "name": "Ledger fire",
  "summary": "The ledger becomes unreachable. The till fails with it until a copy is brought up.",
  "category": "resilience",
  "severity": "critical",
  "durationMs": 40000,
  "rootCause": "node:ledger",
  "targets": ["node:ledger", "node:till"],
  "phases": [
    {
      "name": "Smoke",
      "atMs": 0,
      "rampMs": 3000,
      "status": "active",
      "description": "Writes to the ledger slow down.",
      "effects": [{ "type": "latency", "nodes": "node:ledger", "factor": 8.0 }],
      "events": [
        {
          "delayMs": 2000,
          "severity": "warning",
          "kind": "alert",
          "title": "Ledger writes are slow",
          "message": "Sales take several times longer to record.",
          "nodes": ["node:ledger"]
        }
      ]
    },
    {
      "name": "Recovery",
      "atMs": 30000,
      "rampMs": 5000,
      "status": "recovering",
      "description": "The ledger is back to its usual size.",
      "effects": [],
      "events": []
    }
  ]
}
```

### Fases

- `category` é `availability`, `identity`, `authorization` ou `resilience`;
  `severity` é `info`, `notice`, `warning` ou `critical`. `durationMs` é no
  máximo 30 minutos, o histórico que a linha do tempo guarda.
- Uma fase lista **o conjunto completo de efeitos que valem durante ela**. O
  que ela deixa de fora volta ao nominal ao longo de `rampMs`, então uma
  última fase sem efeitos termina o cenário com a plataforma restaurada.
- As fases começam em `atMs` a partir do início do cenário: a primeira em 0,
  cada uma pelo menos um tick (200 ms) depois da anterior. `status` é
  `active`, `mitigating` ou `recovering`.
- `targets` são os serviços listados como diretamente afetados; `rootCause`
  é o citado como causa.

### Seletores

| Seletor              | Escolhe                                                                               |
| -------------------- | ------------------------------------------------------------------------------------- |
| `role:<name>`        | o nó para onde aponta uma função da topologia; funciona em qualquer topologia com ela |
| `node:<id>`          | um nó pelo id; prende o cenário às topologias que o têm                               |
| `gatewayOf:<region>` | o gateway de API de uma região                                                        |
| `region:<region>`    | todos os nós de uma região (só onde um conjunto de nós é aceito)                      |

Uma região é indicada por uma função que aponta para ela (`outageRegion`) ou
pelo seu próprio id. Um cenário que cita algo que a topologia não tem não é
um erro: ele aparece como indisponível nessa topologia, e o
`check-workspace` e o console de incidentes dizem que nome faltou.

### Efeitos

| `type`        | Campos                             | O que faz                                               |
| ------------- | ---------------------------------- | ------------------------------------------------------- |
| `demand`      | `node`, `factor`                   | multiplica a demanda que um cliente externo gera        |
| `capacity`    | `nodes`, `factor`                  | multiplica a capacidade                                 |
| `latency`     | `nodes`, `factor`                  | multiplica a latência própria dos nós                   |
| `errorInject` | `nodes`, `rate`                    | acrescenta uma taxa de falha nos nós                    |
| `down`        | `nodes`                            | deixa os nós inacessíveis                               |
| `edgeWeight`  | `edges`, `factor`                  | multiplica as chamadas feitas nas conexões              |
| `edgeLatency` | `edges`, `factor`                  | multiplica a latência de rede das conexões              |
| `edgeError`   | `edges`, `rate`                    | acrescenta uma taxa de falha nas conexões               |
| `routeShift`  | `edge`, `onto`, `fraction`         | passa uma fração do tráfego de uma conexão para outra   |
| `flowRate`    | `flow`, `rate`                     | define a taxa de um fluxo injetado                      |
| `flowReject`  | `flow`, `at`, `fraction`, `reason` | rejeita uma fração de um fluxo quando ele chega a um nó |

Um `factor` fica entre 0 e 1000; um `rate` ou uma `fraction`, entre 0 e 1.
`nodes` aceita qualquer seletor; `node` e `at`, um seletor de um só nó.
`edges` é `{ "between": { "from": "…", "to": "…" } }` para uma conexão ou
`{ "inboundSync": "…" }` para todas as conexões síncronas que chegam a um
nó; `edge` e `onto` são `{ "from": "…", "to": "…" }`. `reason` é `waf`,
`rate-limit`, `auth-failure`, `session-revoked` ou `policy-deny`.

### Fluxos

Um fluxo é uma sequência de requisições injetada por uma rota explícita e
desenhada como tráfego próprio: um ataque, uma sondagem, as requisições de
um principal. Este vem do
`examples/corner-shop/scenarios/02-receipt-snooping.json`:

```json
{
  "id": "other-receipts",
  "label": "Ana · another shop",
  "suspicious": true,
  "hops": [
    { "from": "role:partnerClient", "to": "role:primaryGateway" },
    { "from": "role:primaryGateway", "to": "role:primaryAuth" },
    { "from": "role:primaryGateway", "to": "role:primaryAuthorizer" },
    { "from": "role:primaryGateway", "to": "role:resource:Receipt", "via": "path" }
  ],
  "spill": false,
  "authz": { "request": "ana-reads-south", "authorizer": "role:primaryAuthorizer" }
}
```

- Um salto é uma conexão existente ou, com `"via": "path"`, o caminho
  síncrono mais curto entre dois nós.
- `"spill": true` deixa o que sobrevive ao último salto se juntar ao
  tráfego comum daquele nó, que é como uma inundação satura o que fica atrás
  de um gateway.
- Uma fase define a taxa do fluxo com `flowRate`: `{ "rps": 14 }`, ou
  `{ "ofCapacity": { "node": "role:primaryGateway", "factor": 2.2 } }` para
  que o mesmo cenário sobrecarregue igualmente uma plataforma pequena e uma
  grande.
- `authz` liga o fluxo a uma requisição dos `scenarioRequests` do catálogo.
  **O fluxo é parado no autorizador se, e somente se, o Cedar negou essa
  requisição**, e os eventos que ele levanta trazem as políticas que o Cedar
  citou. Um cenário não consegue declarar uma negação.

### Eventos

Um evento é anunciado `delayMs` depois do início da sua fase, com uma
`severity`, um `title`, uma `message` opcional e os `nodes` a que se
refere. `kind` é `alert`, `auth-failure`, `mitigation` ou `reroute`; todo
outro tipo na linha do tempo, como uma mudança de saúde ou uma decisão de
autorização, é do próprio motor.

Um cenário também pode ser escrito na interface, sobre o modelo: **Escrever
o seu próprio cenário**, abaixo dos cenários no painel de incidentes, abre o
editor de plataforma na plataforma em uso, na aba **Incidente**, ao lado de
**Plataforma**. As fases ficam numa faixa no lugar da linha do tempo: leve
uma fase para o lado para mudar o seu início, use a alça no alto da rampa
para definir `rampMs` e dê um duplo clique numa fase para dividi-la em
duas. Um efeito é levado da paleta até um serviço, até a faixa de uma
região (todos os serviços dela) ou até uma conexão (`edges.between`), e é
aplicado primeiro por função, para que o cenário rode em qualquer
plataforma que tenha essa função. Um fluxo é desenhado clicando nos
serviços por onde ele passa, um depois do outro. O motor verifica o arquivo
enquanto ele é escrito; **Salvar o cenário** o entrega como está, e
**Executar** o importa com os arquivos em uso e o inicia. Um `routeShift`,
um `flowReject` e o `authz` de um fluxo não têm controle ali: um cenário
que os tenha mantém essas partes como foram escritas. Veja
[Incidentes e linha do tempo](Incidentes-e-linha-do-tempo).

## Gravação

Uma gravação é uma semente e os comandos que foram dados. Carregá-la a
simula de novo, igual todas as vezes. Esta é a
`examples/corner-shop/recordings/a-bad-afternoon.json`:

```json
{
  "id": "a-bad-afternoon",
  "name": "A bad afternoon",
  "description": "Fictional recording: receipts are snooped on, and then the ledger catches fire.",
  "topologyId": "corner-shop",
  "seed": 1987,
  "durationMs": 110000,
  "commands": [
    { "atMs": 8000, "command": { "type": "startScenario", "scenarioId": "receipt-snooping" } },
    { "atMs": 56000, "command": { "type": "startScenario", "scenarioId": "ledger-fire" } }
  ]
}
```

Uma gravação pode iniciar e interromper cenários (`startScenario`,
`abortScenario`) numa topologia e com cenários que o espaço de trabalho tem.
Ela também pode aplicar uma falha manualmente com `injectFault`: um
`effect`, escrito como numa fase, que entra ao longo de `rampMs` (no máximo
60000). `clearFaults` retira todas as falhas ou, com um `effect`, só o que
esse efeito atinge. Efeitos sobre o fluxo do próprio cenário (`flowRate`,
`flowReject`) são recusados. Um arquivo não consegue gravar uma decisão de
autorização: todo resultado é do Cedar. Uma sessão salva com **Salvar ou
compartilhar esta sessão** é uma gravação da linha do tempo em uso, sujeita
às mesmas regras, exceto que pode ter até 512 comandos, ou nenhum.

## Cedar

O motor embutido é a crate `cedar-policy`; o espaço de trabalho decide o
que ele avalia.

### Políticas

As políticas vêm numa de duas formas, não nas duas.
**`cedar/policies.json`** é uma lista de `{ "id", "description", "content" }`,
o formato que o [cedar-agent](https://github.com/cleissonbarbosa/cedar-agent)
aceita em `PUT /v1/policies`, mais uma descrição. Esta é a primeira entrada
da lista do AEGIS:

```json
[
  {
    "id": "tenant-view-orders",
    "description": "Any member of a tenant may view that tenant's orders.",
    "content": "permit(principal, action == Action::\"viewOrder\", resource) when { principal.tenant == resource.tenant };"
  }
]
```

Os arquivos **`cedar/*.cedar`** estão na sintaxe do próprio Cedar e são
lidos em ordem de nome. O id de uma política é a sua anotação `@id("…")`
(ou `<file>-<n>`, contando a partir de um) e a descrição, a sua
`@description("…")`. Templates de política são recusados. Esta é uma das
três políticas do `examples/corner-shop/cedar/shop.cedar`:

```text
@id("same-shop")
@description("A clerk reads the receipts of their own shop.")
permit (principal, action == Action::"read", resource)
when { principal.shop == resource.shop };
```

### Entidades, esquema e catálogo

O **`cedar/entities.json`** é o repositório de entidades, no formato JSON
que o Cedar lê. O **`cedar/schema.cedarschema`**, quando existe, é um
esquema na sintaxe de esquemas do Cedar: as políticas são validadas contra
ele em modo estrito e as entidades são conferidas contra ele, e o que o
validador apontar impede o servidor de iniciar. Sem ele, uma política que lê
um atributo que ninguém tem só aparece como erro de avaliação numa decisão.

O **`cedar/catalog.json`** é um arquivo do próprio AEGIS:

| Campo                                           | Significado                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenants`, `principals`, `actions`, `resources` | As opções do rastreador de requisições, com os seus rótulos. Um recurso é oferecido para uma ação quando o `resourceType` dos dois coincide.   |
| `contextKeys`                                   | Atributos booleanos de contexto que o rastreador deixa você definir.                                                                           |
| `trafficMix`                                    | Formas de requisição e os seus pesos: o tráfego de autorização comum da plataforma. A taxa de negação em repouso é a parcela que o Cedar nega. |
| `scenarioRequests`                              | Formas de requisição a que o fluxo de um cenário pode se ligar, pelo `id`.                                                                     |

Cada forma de requisição do catálogo é avaliada pelo Cedar uma vez, quando
os arquivos são carregados, e a simulação só consulta as respostas: isso a
mantém determinística enquanto todo resultado continua sendo do Cedar. Uma
decisão tomada sobre as políticas de um espaço de trabalho continua
identificada como `synthetic`. Veja [Políticas Cedar](Políticas-Cedar).

## Referência

Os documentos abaixo estão em inglês.

- [docs/WORKSPACE.md](https://github.com/cleissonbarbosa/csdt/blob/main/docs/WORKSPACE.md): todos os formatos, com as suas regras e o que é testado
- [schemas/README.md](https://github.com/cleissonbarbosa/csdt/blob/main/schemas/README.md) e [schemas/v1/](https://github.com/cleissonbarbosa/csdt/tree/main/schemas/v1): os JSON Schemas
- [examples/corner-shop](https://github.com/cleissonbarbosa/csdt/tree/main/examples/corner-shop): o exemplo de onde vêm estes trechos
- [fixtures/](https://github.com/cleissonbarbosa/csdt/tree/main/fixtures): o espaço de trabalho que vem com o AEGIS
- [apps/server/src/workspace.rs](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/workspace.rs), [apps/server/src/domain/topology.rs](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/domain/topology.rs) e [apps/server/src/incidents/spec.rs](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/incidents/spec.rs): o leitor, o tipo da topologia e o formato do cenário
