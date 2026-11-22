[English](Cedar-policies) · **Português**

Toda decisão de autorização no AEGIS é tomada pelo
[Cedar](https://www.cedarpolicy.com), o motor de políticas, embutido no
servidor (e no motor que o site estático roda na sua aba) como o crate
`cedar-policy`. Esta página mostra como perguntar a ele quem pode fazer o
quê, entender por que ele respondeu como respondeu e mudar as políticas pelas
quais ele decide.

## O que é real e o que não é

- **As decisões são reais.** Cada uma é o que o `cedar-policy` devolveu para
  as políticas e entidades em uso; nada é roteirizado. O rastreador informa a
  versão do motor.
- **Os dados são sintéticos.** Os locatários, os principais e os recursos são
  fictícios, e uma decisão é identificada como `synthetic`, mesmo com
  políticas suas: é a resposta do Cedar para as entidades dos arquivos, não a
  observação de um sistema em funcionamento.
- **A simulação só consulta respostas.** Na inicialização, cada forma de
  requisição que a simulação vai mostrar é avaliada uma vez. A parcela das
  verificações comuns que é negada é a parcela negada dessa mistura, e o fluxo
  de um cenário é barrado no autorizador se, e somente se, o Cedar negou a
  requisição dele. Um arquivo não pode afirmar um resultado.

## Montando uma requisição

Clique em **Testar uma autorização** na barra (ou em **⋯ → Rastrear uma
requisição com o Cedar**). O painel **Rastrear uma requisição** abre ao lado
do modelo.

| Campo         | O que você escolhe                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Principal** | Quem pede                                                                                                                                     |
| **Ação**      | Para quê                                                                                                                                      |
| **Recurso**   | Sobre o quê; só aparecem os recursos do tipo da ação                                                                                          |
| **Contexto**  | **Fresh MFA assertion** (`context.mfa`) e **Inside change window** (`context.changeWindow`), cada um **Ausente**, **Verdadeiro** ou **Falso** |
| **Motor**     | **Embutido**, ou um `cedar-agent` local depois de conectado (só no servidor; veja [Integrações](Integrações))                                 |

Depois clique em **Avaliar com o Cedar**. Os rótulos vêm do catálogo e
aparecem como ele os escreveu. O catálogo que acompanha o AEGIS oferece dois
locatários (Acme Retail e Globex Logistics) e seis principais:

| Principal   | Locatário | Quem é                                  |
| ----------- | --------- | --------------------------------------- |
| **Alice**   | Acme      | Analista financeira                     |
| **Bob**     | Acme      | Agente de suporte                       |
| **Carol**   | Acme      | Administradora do locatário             |
| **Erin**    | Acme      | Analista financeira, suspensa           |
| **Dave**    | Globex    | Administrador de outro locatário        |
| **Mallory** | Globex    | Terceirizada externa de outro locatário |

### O caminho que ela percorre

![O rastreador de requisições mostrando uma decisão Negado determinada pela política forbid-cross-tenant. Na visão geral, o caminho da requisição está desenhado em azul até os autorizadores Cedar, onde um selo vermelho com uma cruz marca o ponto em que ela foi barrada](https://raw.githubusercontent.com/cleissonbarbosa/csdt/main/docs/assets/cedar-denial.png)

Uma requisição azul percorre o modelo: cliente, borda, gateway de API,
autenticação, autorizador Cedar, recurso. Uma requisição permitida segue até
a camada de dados. Uma negada para nos autorizadores Cedar: um selo vermelho
com uma cruz pousa ali, o caminho continua desenhado e tudo fora dele recua.
O vermelho marca onde terminou a requisição que você escolheu seguir; a
política fez o seu trabalho, e nada está quebrado. **Caminho pela
plataforma**, no cartão, diz quais etapas foram alcançadas e onde a
requisição foi bloqueada. **Mostrar o caminho** (ou **Rastrear novamente**) a
envia mais uma vez, e fechar o painel oculta o caminho.

## A decisão

O cartão diz **Permitido** ou **Negado** e, depois:

- **Políticas determinantes**: os ids que o Cedar devolveu. Numa negação
  por padrão, ele diz **O Cedar nega a requisição por padrão porque nenhuma
  política a permite.**
- **Política por política**: veja
  [Por que não](#por-que-não-política-por-política).
- **Diagnósticos da avaliação**: as mensagens do próprio Cedar, como a de
  uma política que deu erro por falta de um atributo.
- **Avaliado com**: o motor, quantas políticas estavam ativas e quais
  estavam desativadas, e o contexto.
- Quanto tempo levou: medido em microssegundos no servidor, não cronometrado
  no navegador.

Cada avaliação é registrada na linha do tempo como um comando e aparece em
**Avaliadas nesta linha do tempo**, onde qualquer uma pode ser rastreada de
novo.

Experimente estas, do passeio:

| Requisição                                                    | Resposta                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| Mallory, **Export ledger**, **Acme ledger 2026**              | **Negado**, determinado por `forbid-cross-tenant`         |
| Alice, **View ledger**, **Acme ledger 2026**                  | **Permitido**, determinado por `finance-view-ledger`      |
| Alice, **Export ledger**, **Fresh MFA assertion** **Ausente** | **Negado**, com um diagnóstico sobre o atributo que falta |
| A mesma com **Fresh MFA assertion** **Verdadeiro**            | **Permitido**                                             |

## Desativando políticas

**Políticas**, abaixo do formulário, lista cada política em vigor com o seu
efeito (**Permite** ou **Proíbe**), a sua descrição e o seu **Código Cedar**.
Desative uma e avalie de novo para ver o resultado mudar: desative
`forbid-destructive-outside-change-window` e teste Carol excluindo um
cliente. Desativar só funciona com o motor embutido; um `cedar-agent` usa o
próprio armazenamento de políticas.

## Um resultado que não corresponde mais ao formulário

Um resultado pertence à pergunta que o originou. Mude o formulário depois de
uma avaliação e, antes de você avaliar de novo, o cartão diz **A configuração
mudou. Avalie novamente.** O resultado perde a cor e a borda firme, mostra
**Decisão anterior: Permitido** (ou **Negado**) e lista o que mudou: o
principal, a ação, o recurso, uma chave de contexto, uma política ativada ou
desativada, o motor, ou a substituição das políticas em uso. Ele nunca é
mostrado como a resposta ao formulário ao lado.

## Guardando um resultado para comparar

**Guardar para comparar** mantém o resultado na tela como A. Mude o contexto
ou as políticas e avalie de novo: a **Comparação** põe A e B lado a lado, com
a **Decisão** de cada um, as políticas que a determinaram (**Decidido por**),
as **Políticas desativadas** e **O que muda de A para B**. Uma frase diz se a
decisão mudou. Se A e B forem requisições diferentes, ela avisa: as duas
decisões respondem a perguntas diferentes. **Limpar** descarta A.

## Por que não: política por política

Abaixo de cada decisão, **Política por política** dá uma linha a cada
política em vigor, em grupos:

| Grupo                                                             | Significa                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Aplicáveis a esta requisição**                                  | A política vale                                                   |
| **No escopo da requisição, com condição não satisfeita**          | O escopo dela abrange a requisição, mas a condição não é cumprida |
| Uma linha recolhida, "_n_ políticas fora do escopo da requisição" | O escopo dela não abrange a requisição de forma alguma            |

O Cedar não nomeia política nenhuma numa negação por padrão, então, nesse
caso, a linha acima dos grupos diz qual política de permissão chegou mais
perto. Cada linha é a resposta do próprio Cedar: o motor embutido põe cada
política diante da requisição sozinha, duas vezes, como ela é e sem as
condições, as duas feitas a partir da forma JSON da política no Cedar. Uma
proibição é transformada em permissão só para a pergunta. Nada no AEGIS
interpreta uma política para dizer por que ela não se aplicou. Uma permissão
é uma etiqueta contornada e uma proibição, uma etiqueta cheia; nenhuma das
duas é um alarme. Nada disso é registrado na linha do tempo.

## Quem pode fazer o quê

**⋯ → Quem pode fazer o quê** (também no rastreador e na **Exposição** de um
serviço) pergunta ao Cedar cada principal e cada ação do catálogo, em cada
recurso ao qual a ação se aplica. Os principais ficam nas linhas, as ações
nas colunas, e cada célula diz em quantos recursos o Cedar permite a ação.
Uma negação não é vermelha.

- Defina cada chave de contexto como **Ausente**, **Verdadeiro** ou **Falso**,
  acima da tabela.
- **Políticas em vigor: … de …** abre um interruptor por política. Com
  alguma desativada, cada célula cuja resposta difere da resposta com todas as
  políticas em vigor, no mesmo contexto, fica marcada, e uma frase as conta.
- Escolha uma célula para ver a resposta em cada recurso e **Rastrear** para
  ver aquela requisição atravessar o modelo.
- **Editar as políticas** abre o editor.

A matriz é limitada (20 000 requisições) e não registra nada na linha do
tempo.

## Editando as políticas

**Editar as políticas** (no rastreador e na matriz) abre **Editar as
políticas do Cedar**: as políticas em vigor como um texto só, na sintaxe do
próprio Cedar, cada uma com o seu `@id` e a sua `@description`.

```text
@id("forbid-cross-tenant")
@description("Hard tenant isolation: no principal may touch another tenant's resources.")
forbid(principal, action, resource) unless { principal.tenant == resource.tenant };
```

1. Edite o texto. Um instante depois que você para de digitar, o motor o
   verifica: **Inválidas.**, com o local e a mensagem do Cedar, ou a contagem
   das políticas que o Cedar aceita.
2. Quando o texto é válido, o diálogo lista o que o Cedar decidiria
   diferente: políticas adicionadas, removidas ou com mudança de significado,
   requisições do catálogo e tráfego dos cenários cujo resultado muda, e os
   cenários que passariam a rodar ou deixariam de rodar.
3. **Aplicar estas políticas** substitui só as políticas: a plataforma, os
   cenários e as entidades continuam como estão. A linha do tempo recomeça,
   como em qualquer mudança de arquivos, e a matriz abre com as políticas
   novas. **Restaurar as que estão em uso** descarta a sua edição.

Políticas aplicadas são uma importação como qualquer outra: num servidor,
valem para todos os conectados e ficam só na memória. **⋯ → Importar ou
exportar arquivos → Voltar para os arquivos iniciais do servidor** (no site
estático, **Voltar para os arquivos iniciais da página**) desfaz a mudança. Um
servidor iniciado com `AEGIS_IMPORT=off` a recusa. Para comparar dois
conjuntos de políticas num terminal, veja
[Sua própria plataforma](Sua-própria-plataforma#comparar-dois-conjuntos-de-políticas).

## Exposição

**Exposição**, no cartão de um serviço, segue as conexões dele até o fim:

- o que o serviço poderia alcançar se fosse comprometido, quantos desses
  guardam dados, e **Destacar no modelo** para trazê-los para a frente no
  seu azul;
- quantos serviços levam até ele, e o caminho mais curto de fora da
  plataforma até ele;
- **O que o Cedar protege aqui**: para as requisições que terminam neste
  serviço, quantas das descritas no catálogo o Cedar permite, e para quantos
  principais, com todas as políticas em vigor e um contexto vazio.

Tudo é lido da topologia, e nada é simulado. Diz o que a topologia permite,
nunca o que um atacante faria.

## O Cedar num incidente

O fluxo de um cenário pode ser ligado a uma forma de requisição do catálogo.
O Cedar decide essa forma uma vez, na inicialização, e o fluxo só é barrado
no autorizador se o Cedar a negou; os eventos da execução trazem os ids das
políticas determinantes. Em **Cedar Authorization Denial**, as requisições de
Mallory param no autorizador. Parte de um dos fluxos dele, que nomeia a
requisição do catálogo pelo id:

```json
{
  "id": "mallory-export-ledger",
  "label": "Mallory · exportLedger",
  "suspicious": true,
  "authz": {
    "request": "mallory-export-ledger",
    "authorizer": "role:primaryAuthorizer"
  }
}
```

O resumo de um incidente lista **O que o Cedar decidiu** para as requisições
que ele enviou. Veja [Incidentes e linha do tempo](Incidentes-e-linha-do-tempo).

## O catálogo e os arquivos

O Cedar avalia três arquivos do conjunto que vem com o AEGIS
([`fixtures/cedar/`](https://github.com/cleissonbarbosa/csdt/tree/main/fixtures/cedar)),
e um espaço de trabalho pode substituir cada um:

| Arquivo                    | O que contém                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cedar/policies.json`      | As políticas, como `{ "id", "description", "content" }`. Um espaço de trabalho pode usar arquivos `cedar/*.cedar` no lugar                                                                                    |
| `cedar/entities.json`      | O armazenamento de entidades, na forma JSON que o Cedar lê                                                                                                                                                    |
| `cedar/catalog.json`       | O arquivo do próprio AEGIS: o que o rastreador oferece e do que é feito o tráfego de autorização                                                                                                              |
| `cedar/schema.cedarschema` | Opcional (o conjunto do AEGIS não tem). Quando existe, as políticas são validadas contra ele no modo estrito e as entidades são conferidas contra ele; o que o validador apontar impede o servidor de iniciar |

Os campos do catálogo:

| Campo                                           | Significado                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `tenants`, `principals`, `actions`, `resources` | As opções do rastreador, com os rótulos. Um recurso é oferecido para uma ação quando o `resourceType` dos dois coincide |
| `contextKeys`                                   | Atributos booleanos de contexto que o rastreador deixa você definir                                                     |
| `trafficMix`                                    | Formas de requisição e seus pesos: o tráfego comum de autorização da plataforma                                         |
| `scenarioRequests`                              | Formas de requisição às quais o fluxo de um cenário pode ser ligado, pelo `id`                                          |

O catálogo do AEGIS tem seis principais, seis ações, sete recursos, duas
chaves de contexto, dez formas de requisição comuns e cinco para cenários.
Uma entrada de `trafficMix`:

```json
{
  "id": "alice-export-ledger-mfa",
  "weight": 0.04,
  "principal": "User::\"alice\"",
  "action": "Action::\"exportLedger\"",
  "resource": "Ledger::\"acme-ledger-2026\"",
  "context": { "mfa": true }
}
```

Uma forma de requisição nova que a simulação deva mostrar entra no catálogo,
para que o Cedar a decida na inicialização. Campo por campo, veja
[Arquivos do espaço de trabalho](Arquivos-do-espaço-de-trabalho#cedar).

## As políticas que vêm com o AEGIS

| Id                                         | Efeito  | O que diz                                                                                |
| ------------------------------------------ | ------- | ---------------------------------------------------------------------------------------- |
| `tenant-view-orders`                       | Permite | Qualquer membro de um locatário pode ver os pedidos desse locatário                      |
| `support-refund-limit`                     | Permite | Agentes de suporte podem reembolsar pedidos do próprio locatário até 500                 |
| `support-view-customers`                   | Permite | Agentes de suporte podem ver perfis de clientes do próprio locatário                     |
| `finance-view-ledger`                      | Permite | A equipe financeira pode ler o livro-razão do seu locatário                              |
| `finance-export-ledger-mfa`                | Permite | Exportar o livro-razão também exige uma asserção de MFA recente no contexto              |
| `admin-own-tenant`                         | Permite | Administradores de locatário podem fazer qualquer ação nos recursos do próprio locatário |
| `forbid-cross-tenant`                      | Proíbe  | Nenhum principal pode tocar nos recursos de outro locatário                              |
| `forbid-suspended`                         | Proíbe  | Principais suspensos têm tudo negado, qualquer que seja a função                         |
| `forbid-destructive-outside-change-window` | Proíbe  | Excluir um cliente só é possível dentro de uma janela de mudança aprovada                |

Uma proibição que vale nunca é anulada por uma permissão; uma requisição que
nenhuma permissão cobre é negada por padrão.

## Rotas por trás desta página

| Rota                                                    | O que faz                                               |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `POST /api/v1/demo/authorization/evaluate`              | Avalia uma requisição; registrada na linha do tempo     |
| `POST /api/v1/demo/authorization/explain`               | Uma requisição, política por política; não é registrada |
| `POST /api/v1/demo/authorization/matrix`                | Todas as requisições do catálogo; não é registrada      |
| `GET /api/v1/demo/authorization/catalog` · `/decisions` | As políticas e o catálogo, e as decisões tomadas        |
| `POST /api/v1/demo/workspace/diff`                      | O que o Cedar decidiria diferente com outros arquivos   |

[API HTTP e stream](API-HTTP-e-stream) tem todas as rotas.

## Referência

Estes documentos do repositório estão em inglês.

- [docs/DEMO.md](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DEMO.md): o passo 3 do passeio
- [docs/ARCHITECTURE.md](https://github.com/cleissonbarbosa/csdt/blob/main/docs/ARCHITECTURE.md): as decisões do Cedar são reais
- [docs/WORKSPACE.md](https://github.com/cleissonbarbosa/csdt/blob/main/docs/WORKSPACE.md): os arquivos do Cedar e a comparação de dois espaços de trabalho
- [docs/DESIGN.md](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DESIGN.md): um resultado pertence à pergunta que o originou; uma decisão é desmontada, nunca reescrita
- [fixtures/cedar/](https://github.com/cleissonbarbosa/csdt/tree/main/fixtures/cedar): as políticas, as entidades e o catálogo que vêm com o AEGIS
- [apps/server/src/authorization/](https://github.com/cleissonbarbosa/csdt/tree/main/apps/server/src/authorization): o ponto de decisão embutido
- [apps/server/src/application/access.rs](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/application/access.rs): política por política, e a matriz
- [apps/web/src/features/authorization/](https://github.com/cleissonbarbosa/csdt/tree/main/apps/web/src/features/authorization): o rastreador, a matriz e o editor de políticas
- [apps/web/src/lib/evaluation.ts](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/lib/evaluation.ts): quando um resultado está desatualizado
- [apps/web/src/features/inspector/Exposure.tsx](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/features/inspector/Exposure.tsx): a exposição
