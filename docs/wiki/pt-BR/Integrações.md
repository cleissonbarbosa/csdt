[English](Integrations) · **Português**

O AEGIS funciona completo sem nenhuma integração: o **modo de demonstração**
(Demo Mode) é a simulação determinística embutida no servidor e não precisa
de mais nada. As integrações são adaptadores opcionais para projetos
pessoais públicos, cada um escrito sobre uma interface lida no seu
repositório, e cada um diz claramente que tipo de dado traz.

| Rótulo      | Significado                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `synthetic` | Produzido pelo motor de simulação do AEGIS                                                                                                                                   |
| `recording` | Uma [captura de incidente](Capturas-de-incidente), lida no navegador. Não é produzida pela simulação, nunca é identificada como ao vivo e nunca entra na linha do tempo dela |
| `live`      | Medido de uma instância **local** conectada explicitamente                                                                                                                   |

O rótulo acompanha o dado (`dataSource` em topologias, eventos, decisões e
status de provedores) e aparece ao lado dele na interface.

## Escopo

- **Só foram considerados repositórios públicos do usuário
  `cleissonbarbosa` no GitHub.** Eles foram listados pela API pública sem
  autenticação; nenhum token, sessão do `gh` ou chave SSH foi usado.
- **Cada um foi conferido antes de o código ser lido:** o dono é
  `cleissonbarbosa`, o repositório não é privado e a visibilidade é
  pública. Nenhum repositório privado ou de organização foi listado, aberto
  ou clonado.
- **Nenhum código é copiado.** Os adaptadores foram escritos do zero sobre
  as interfaces descritas abaixo.

| Repositório                                                                                                                                           | O que expõe                                                    | Decisão                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`cedar-agent`](https://github.com/cleissonbarbosa/cedar-agent)                                                                                       | API HTTP: repositório de políticas, de dados e `is_authorized` | **Adaptador ao vivo**, verificado com um agente compilado localmente |
| [`rinha-backend-2026`](https://github.com/cleissonbarbosa/rinha-backend-2026) e [`-rust`](https://github.com/cleissonbarbosa/rinha-backend-2026-rust) | `GET /ready` e `POST /fraud-score` atrás de um balanceador     | **Adaptador ao vivo**, sonda de prontidão só de leitura              |
| [`ferrousDB`](https://github.com/cleissonbarbosa/ferrousDB)                                                                                           | Biblioteca Rust, REPL e interface gráfica de desktop           | **Não integrado**                                                    |

Os outros repositórios públicos da conta não têm relação com observabilidade
de segurança em nuvem e não foram considerados.

## Conectar uma integração

Uma integração precisa de duas autorizações: ser configurada no servidor e
você pressionar **Conectar** na interface. Só a configuração não contata
nada.

1. Defina a variável do adaptador no servidor e reinicie-o.
2. Abra **Integrações** pelo aviso na barra superior que diz que os dados
   são simulados (**Simulado, dados sintéticos**, ou **Simulado** numa tela
   mais estreita), ou com o comando **Abrir as integrações** da paleta de
   comandos.
3. Pressione **Conectar** no cartão do adaptador. Cada cartão mostra o
   estado, o repositório, a interface com que foi verificado e o alvo sem
   credenciais. **Desconectar** encerra a conexão.

| Variável                          | O que faz                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `AEGIS_CEDAR_AGENT_URL`           | Um cedar-agent local, por exemplo `http://127.0.0.1:8180`                                                      |
| `AEGIS_CEDAR_AGENT_TOKEN`         | Opcional: o token com que o agente foi iniciado (`--authentication`); ele fica no servidor                     |
| `AEGIS_CEDAR_AGENT_SYNC`          | `true` também envia as políticas e entidades do AEGIS ao conectar, **substituindo** as do agente               |
| `AEGIS_RINHA_URL`                 | Um ambiente local do rinha-backend, por exemplo `http://127.0.0.1:9999`                                        |
| `AEGIS_RINHA_PROBE_SECONDS`       | Opcional: segundos entre as sondas de prontidão; 2 por padrão, no mínimo 1, no máximo 3600                     |
| `AEGIS_INTEGRATION_ALLOWED_HOSTS` | Nomes de host extras, separados por vírgulas, aceitos como alvo (por exemplo, o nome de um serviço do Compose) |

O `docker-compose.yml` repassa essas variáveis ao contêiner do servidor,
todas menos `AEGIS_RINHA_PROBE_SECONDS`, e o
[`.env.example`](https://github.com/cleissonbarbosa/csdt/blob/main/.env.example)
descreve cada uma.

## cedar-agent

`apps/server/src/integrations/cedar_agent.rs` avalia requisições de
autorização com um [cedar-agent](https://github.com/cleissonbarbosa/cedar-agent)
local em vez do motor embutido.

| Requisição               | Usada pelo AEGIS para                         |
| ------------------------ | --------------------------------------------- |
| `GET /v1/` → `204`       | Verificar a saúde ao conectar                 |
| `GET /v1/policies`       | Contar as políticas que o agente tem          |
| `PUT /v1/policies`       | Sincronizar, se pedido, as políticas do AEGIS |
| `PUT /v1/data`           | Sincronizar, se pedido, as entidades do AEGIS |
| `POST /v1/is_authorized` | Avaliar uma requisição                        |

### Como ativar

```bash
cedar-agent --port 8180                                   # terminal 1
AEGIS_CEDAR_AGENT_URL=http://127.0.0.1:8180 \
AEGIS_CEDAR_AGENT_SYNC=true cargo run --release -p aegis-server
```

Pressione **Conectar** no cartão **Cedar Agent** e, em **Rastrear uma
requisição**, escolha `cedar-agent` como **Motor**. Com
`AEGIS_CEDAR_AGENT_SYNC=true`, o agente recebe as políticas e entidades que
o motor embutido tem (as incluídas, ou as de um espaço de trabalho) e perde
o que tinha antes.

- **Só leitura por padrão.** Sem a variável de sincronização, o
  repositório do próprio agente é usado como está.
- **As decisões são identificadas como `live`.** O motor aparece com
  "versão não informada", porque o agente não expõe uma.
- **Deixar políticas de fora é um recurso do motor embutido.** Com o
  agente, a requisição é recusada em vez de ser avaliada de outro jeito,
  pois o repositório do agente é que vale.
- **Uma avaliação que falha é um erro**, nunca uma decisão inventada, e não
  há troca silenciosa para o motor embutido.
- **O tráfego da própria simulação continua usando o motor embutido**, cujas
  decisões são calculadas na inicialização; o agente responde só às
  avaliações pedidas.

### O teste de paridade

Um teste em `apps/server/tests/integrations.rs` inicia um binário real do
`cedar-agent`, sincroniza nele os fixtures do AEGIS e compara a resposta
dele com a do motor embutido para cada formato de requisição que o AEGIS
usa. Ele informa "skipped" quando a variável não está definida.

```bash
AEGIS_TEST_CEDAR_AGENT_BIN=/path/to/cedar-agent cargo test -p aegis-server --test integrations real_cedar_agent
```

Na versão testada, os 15 formatos de requisição concordaram na decisão e
nas políticas determinantes (o agente com `cedar-policy` 2.4.2, o AEGIS com
4.14.1). O restante do adaptador (tempos limite, token errado, respostas
malformadas, o agente sumindo) é testado com um dublê, no mesmo processo,
que implementa a mesma interface.

> **Compilar o agente.** O `Cargo.lock` dele fixa `time 0.3.22`, que não
> compila no Rust 1.80 ou posterior. Para a verificação, `time` foi
> atualizado para 0.3.36 numa cópia descartável (`cargo update -p time
--precise 0.3.36`); o repositório em si não foi modificado.

## rinha-backend-2026

`apps/server/src/integrations/rinha.rs` adapta um ambiente local do
[rinha-backend-2026](https://github.com/cleissonbarbosa/rinha-backend-2026):
um balanceador de carga na porta 9999 na frente de duas instâncias da API,
que respondem a `GET /ready` e `POST /fraud-score`. O ambiente não tem
endpoint de métricas, Prometheus ou OpenTelemetry, e os repositórios não
publicam resultados de benchmark.

- **Ele só sonda.** O adaptador envia requisições `GET /ready` só de
  leitura, no máximo uma por segundo, espaçando-as exponencialmente
  enquanto o ambiente está inacessível. Ele nunca envia `POST /fraud-score`
  e nunca gera carga.
- **Ele só informa o que ele mesmo mediu:** sondas enviadas, sondas bem
  sucedidas e o tempo de ida e volta das últimas 60 sondas bem sucedidas.
  Ele não informa vazão, porque nenhuma pode ser observada de fora.
- **Os números ficam no painel de Integrações.** Eles não são incorporados
  ao modelo 3D.
- **Como foi verificado:** com um dublê dos dois endpoints, no mesmo
  processo, incluindo a verificação de que nada além de `GET /ready` é
  pedido. Ele não foi executado com um ambiente real, que precisa de um
  conjunto de dados de referência de vários gigabytes para ser compilado.

## ferrousDB, não integrado

O [ferrousDB](https://github.com/cleissonbarbosa/ferrousDB) é um motor de
armazenamento educacional (o README dele diz para não usá-lo em produção),
distribuído como biblioteca, REPL e interface gráfica de desktop. Ele não
tem interface de rede para adaptar, e vinculá-lo traria um kit de interface
gráfica para dentro de um servidor sem tela. Por isso, os bancos de dados
da plataforma incluída são serviços sintéticos comuns. Uma conexão forçada
aqui acrescentaria uma integração sem acrescentar nada que um visitante
pudesse verificar.

## OpenTelemetry e telemetria de nuvem

Não há OpenTelemetry nem provedor de nuvem entre as integrações: o servidor
não lê nenhuma API de traces, métricas ou nuvem. Um incidente real ainda
pode ser visto como uma [captura de incidente](Capturas-de-incidente), um
arquivo que o próprio navegador lê.

Os exportadores de captura em `scripts/` (CloudWatch Application Signals, e
Tempo com Prometheus) e os coletores de inventário de nuvem também não são
integrações. Você os roda com o seu próprio acesso, e nada no AEGIS os
executa ou chama. Veja
[Capturas de incidente](Capturas-de-incidente#escrever-uma-captura-sua) e
[Inventários de nuvem](Inventários-de-nuvem).

## Regras de isolamento

Toda requisição de saída de um adaptador ao vivo passa por
`apps/server/src/integrations/guard.rs`, com testes:

| Regra                          | O que significa                                                                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duas autorizações              | Configuração no servidor _e_ um **Conectar** explícito. O modo de demonstração não abre nenhuma conexão de saída                                                                   |
| Só loopback                    | Um alvo é `http` ou `https` num endereço de loopback, a menos que o host esteja em `AEGIS_INTEGRATION_ALLOWED_HOSTS`                                                               |
| Nenhuma credencial do ambiente | Uma URL com credenciais, caminho, query ou fragmento é recusada. O único segredo é o token opcional do agente, que nunca é registrado em log, serializado nem enviado ao navegador |
| Limitado                       | Tempo limite de 2 s, nenhum redirecionamento, nenhum proxy do ambiente, respostas de até 512 KiB                                                                                   |
| Esquema validado               | As respostas são lidas em estruturas tipadas; qualquer outra coisa é um erro de protocolo                                                                                          |
| Estado visível                 | Todo provedor informa o estado (`not-configured`, `available`, `connected`, `error`…), o alvo sem credenciais e o último erro                                                      |

Os erros de transporte são reduzidos a uma categoria antes de serem
registrados ou devolvidos, para que uma URL configurada não vaze.

## O site estático

O site estático, com o motor compilado para WebAssembly na aba, lista a
simulação embutida como seu único provedor. O código que faz requisições de
saída não é compilado no módulo, então nenhum dos adaptadores ao vivo
existe ali, e pedir uma decisão ao `cedar-agent` é recusado, como num
servidor sem nenhum conectado. O painel de Integrações diz isso: "A
simulação roda no navegador. As integrações com um cedar-agent local ou um
alvo de teste de carga dependem do servidor do AEGIS."

Uma captura de incidente abre no site estático como abre num servidor: o
navegador a lê, e ela não é um provedor.

## Acrescentar um provedor

1. Implemente `TelemetryProvider` em
   [`apps/server/src/integrations/mod.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/integrations/mod.rs):
   `id`, `status`, `connect` e `disconnect`.
2. Registre-o em `ProviderRegistry::new`.
3. Diga em `status()` com qual repositório e qual interface ele foi
   verificado, e valide o alvo com `guard.rs`, como os outros adaptadores
   fazem.

O cliente web não precisa de mudança: o painel de Integrações mostra o que
o servidor listar em `GET /api/v1/providers` e conecta com
`POST /api/v1/providers/{id}/connect`. Mantenha o escopo acima: um
repositório público de `cleissonbarbosa`, lido sem autenticação, sem copiar
código.

## Referência

Os documentos e arquivos abaixo estão em inglês.

- [`docs/INTEGRATIONS.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/INTEGRATIONS.md): a referência completa, com a forma como cada interface foi verificada
- [`docs/DEMO.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DEMO.md): a seção 9, o modo conectado passo a passo
- [`apps/server/src/integrations/`](https://github.com/cleissonbarbosa/csdt/tree/main/apps/server/src/integrations): `guard.rs`, `cedar_agent.rs`, `rinha.rs` e `mod.rs`
- [`apps/server/tests/integrations.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/tests/integrations.rs): os dublês e o teste de paridade
- [`.env.example`](https://github.com/cleissonbarbosa/csdt/blob/main/.env.example): as variáveis do servidor, comentadas
- [Modelo de segurança](Modelo-de-segurança#integrações): as mesmas regras, entre as outras
