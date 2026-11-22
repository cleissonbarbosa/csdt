[English](Incident-captures) · **Português**

Uma **captura de incidente** é um incidente real, tal como um provedor o
relatou ou um sistema o registrou, lida pelo seu navegador a partir de um
arquivo e mostrada no mesmo modelo da simulação. Fora o que uma instância
local conectada informa (identificado como _ao vivo_), ela é a única coisa
que o AEGIS mostra que não é simulada.

> **Uma captura não é a simulação.** Ela nunca chega ao servidor nem à
> linha do tempo da simulação, e nada dela é colocado ali. Também não é um
> _Rever_ (o histórico que a simulação simula de novo) nem um incidente
> _gravado_ (os da própria simulação): essas palavras são da simulação.

## O que é uma captura

- **Identificada como não simulada.** O selo na barra diz **Capturado, não
  simulado**, ou **Do relatório do provedor, não simulado** para um
  relatório transcrito (**Capturado** ou **Relatado** numa tela estreita).
  A procedência é `recording`, identificada como "Captura".
- **Lida na aba.** O arquivo é lido na página, conferido com o formato de
  captura e mantido na memória. Ele não é enviado, não é salvo em
  armazenamento, nunca aparece no endereço e some quando a página é
  recarregada.
- **Um modo da mesma interface.** Enquanto uma captura está aberta, a
  simulação continua intacta em segundo plano e nada na interface age sobre
  ela. **Voltar à simulação** retorna a ela como você a deixou.
- **Mostrada como foi escrita.** Títulos, nomes, notas e textos de eventos
  são os do arquivo, e os horários são em UTC, com o tempo desde o início da
  captura.

## Abrir uma captura

| Forma                                                                                                           | O que acontece                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **⋯ → Abrir uma captura de incidente**, ou o mesmo comando na paleta de comandos (<kbd>Ctrl</kbd> <kbd>K</kbd>) | Uma caixa de diálogo lista as capturas incluídas no AEGIS, cada uma com título, fonte e janela em UTC, e **Abrir um arquivo de captura…**                                                                              |
| Um link com `?capture=google-cloud-2025-06-12` ou `?capture=online-boutique-rcaeval`                            | Abre essa captura incluída quando a página carrega, tanto num servidor quanto no site estático. O endereço é lido uma vez e não acrescenta nada ao histórico; um id que não nomeia uma captura incluída é ignorado     |
| **Abrir um arquivo de captura…**, com um arquivo de até 12 MiB                                                  | O arquivo é lido na aba e não é enviado a lugar nenhum. Um arquivo maior, que não seja JSON em UTF-8 ou que não seja uma captura que esta versão lê é recusado na caixa de diálogo, que nomeia o arquivo e diz por quê |

Com uma captura aberta, **⋯ → Abrir outra captura** abre a caixa de diálogo
de novo, e numa tela com pelo menos 1280 pixels de largura a barra tem um
seletor de capturas. Abrir uma captura acrescenta uma entrada ao histórico
do navegador; assim, o Voltar do navegador, **Voltar à simulação**
(**Voltar** num celular) e **⋯ → Voltar à simulação** retornam todos à
simulação, e o Avançar abre a captura de novo. Um arquivo só é aberto de
novo pelo Avançar enquanto a página que o leu continua aberta.

Uma incorporação (`?embed=1`) não alcança nenhuma captura: ela ignora
`?capture=`, sua paleta de comandos não tem o comando de captura e a caixa
de diálogo nunca abre.

## As duas capturas incluídas

| Captura                                         | Fonte                                                                                                                                      | O que contém                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google Cloud outage · 12 June 2025**          | Uma transcrição manual do [relatório público de incidente](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) do Google Cloud | Doze produtos e locais, e o estado que cada atualização do relatório lhes dá. Nenhuma medição                                                              |
| **Online Boutique · RCAEval · 15 January 2024** | Agregados do arquivo do [RCAEval 0.2.0](#licença-e-atribuição-do-rcaeval)                                                                  | Dez minutos de uma execução de benchmark público em torno da falha injetada: memória, chamadas e duração p95 a cada 30 segundos. Nenhuma contagem de erros |

Os títulos aparecem como os arquivos os escreveram, em inglês. Nas duas, o
tipo de todo serviço é _presumido_: nenhuma das fontes informa um.

## O que aparece na tela

- **A barra** diz o que a captura informa no cursor, precedido do horário
  ("Às 17:49 UTC: 6 serviços afetados segundo o relatório, 6 sem
  informação"). Ela fica esmaecida enquanto nada passou dos limiares, nem
  está afetado ou em recuperação, e em negrito, na cor e no símbolo do pior
  estado, caso contrário; ao pressioná-la, abrem-se os eventos. O selo abre
  o que a captura é: título, fonte, janela, período de amostragem,
  contagens, como lê-la e suas notas. **Serviços e eventos** abre a lista.
  Nada da simulação fica na barra: nem instrumentos, nem busca, nem o
  rastreador de requisições, nem incidentes.
- **O modelo** fica só na disposição por região: uma placa por região, as
  peças em fileiras por tipo. Uma captura não tem visão geral.
- **A barra da captura**, no pé do palco, tem **Reproduzir**, a data e a
  hora em UTC com o tempo desde o início da captura ("+5:00 desde o início
  da captura"), a faixa da janela e a velocidade. Uma captura abre pausada
  no início.
- **A lista** tem duas abas. **Serviços** os lista por região, com o estado
  no cursor, e depois as conexões (acima de 64, listadas só quando você
  pressiona **Mostrar**). **Eventos** os lista em ordem cronológica, com os
  dois relógios, esmaecidos depois do cursor; escolher um leva o cursor até
  ele.
- **Um cartão** vem com a seleção: nome, tipo e região do serviço, de onde
  vem o tipo, o estado no cursor em palavras e símbolo, a nota do arquivo
  sobre ele, os eventos que o citam e as conexões. Numa captura medida, ele
  mostra cada número da amostra no cursor com sua evolução ao longo de toda
  a captura.
- **A visualização em tabela** (<kbd>T</kbd>, ou sem GPU) lista o mesmo por
  região.

### A faixa e as velocidades

A velocidade é de 10×, 60×, 600× ou 3600× do tempo da captura por segundo;
uma captura abre na menor velocidade que reproduz a janela em até um
minuto.

| Marca na faixa                              | O que significa                          |
| ------------------------------------------- | ---------------------------------------- |
| Um traço pendurado no topo, curto e âmbar   | Uma amostra acima do limiar de degradado |
| Um traço pendurado no topo, alto e vermelho | Uma amostra acima do limiar de crítico   |
| Um quadrado                                 | Impacto relatado                         |
| Um triângulo                                | Uma recuperação em andamento             |
| Um disco                                    | Uma recuperação                          |
| Um traço curto                              | Uma atualização que não informa condição |

### Teclas sobre uma captura

| Tecla                                                  | Ação                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| <kbd>Space</kbd>                                       | Reproduzir ou pausar a captura                                 |
| <kbd>F</kbd>                                           | Aproximar do serviço selecionado, ou enquadrar tudo            |
| <kbd>/</kbd>                                           | A lista de serviços                                            |
| <kbd>Esc</kbd>                                         | Desfazer a seleção, depois fechar os detalhes, depois a lista  |
| <kbd>←</kbd> <kbd>→</kbd>                              | Na faixa: um período de amostragem; <kbd>Shift</kbd> para dez  |
| <kbd>Home</kbd> <kbd>End</kbd>                         | Na faixa: o início ou o fim da captura                         |
| <kbd>R</kbd>, <kbd>T</kbd>, <kbd>P</kbd>, <kbd>?</kbd> | Como na simulação: câmera, tabela, painel de desempenho, ajuda |

<kbd>L</kbd> e <kbd>Ctrl</kbd> <kbd>K</kbd> não fazem nada sobre uma
captura: ela tem uma só disposição, e os comandos da paleta são os da
simulação.

### Um serviço de estado desconhecido

Desconhecido nunca é desenhado como normal. Um serviço cujo estado a fonte
não informa fica em pé sobre um anel tracejado sem cor, um tom mais suave
que uma peça normal, e nunca recua. O estado aparece como _Sem dados_ onde
não há amostra, _Taxa de erro não medida_ onde a amostra não tem as
contagens para calcular uma taxa, e _Não informado neste momento_ num
relatório, antes de o relatório citá-lo. A frase da barra nunca conta um
serviço desconhecido entre os de estado conhecido.

## Como ler uma captura

Cada regra é uma função pura em
[`features/capture/capture.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/features/capture/capture.ts),
e tudo o que a interface diz de uma captura passa por elas.

### Quando um estado é conhecido

- **Uma amostra vale para o próprio período.** A amostra de um momento é a
  daquele período que o contém. Uma amostra anterior nunca substitui uma que
  falta.
- **Numa captura medida**, um estado só é conhecido onde a amostra conta
  requisições e erros (a taxa de erro é erros sobre requisições), ou não
  conta requisição nenhuma: nada passou, o que é normal.
- **Num relatório do provedor**, um serviço só passa a ser conhecido por um
  evento que o cita e informa uma condição, e fica como foi informado pela
  última vez. O relatório não indica a gravidade, então o impacto é
  desenhado como crítico:

| O relatório diz                    | Aparece como                                |
| ---------------------------------- | ------------------------------------------- |
| Afetado segundo o relatório        | Crítico                                     |
| Em recuperação segundo o relatório | Degradado                                   |
| Recuperado segundo o relatório     | Normal                                      |
| Nada ainda                         | Desconhecido, _Não informado neste momento_ |

Um relatório não mede tráfego, então suas peças ficam paradas como foram
modeladas e suas conexões aparecem como _Não informado no relatório_.

### Os limiares de erro

A cor vem dos limiares de erro da simulação aplicados a cada amostra como
foi medida: degradado a partir de uma taxa de erro de 4%, crítico a partir
de 20%. São os limiares com que a classificação de nós do motor chama um
serviço de degradado ou crítico, copiados em
[`lib/thresholds.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/lib/thresholds.ts)
e mantidos iguais aos do motor por um teste. Não são o objetivo de 5% que
as regras de alerta usam. O cartão diz isso: "As cores usam os limiares de
erro da simulação para indicar quando um serviço está degradado (4%) ou
crítico (20%). A fonte não define limiares. Cada amostra é usada como foi
medida, sem suavização nem atraso."

- Só a taxa de erro tem faixa normal: "Normal abaixo de 4% (limiar da
  simulação)". Uma taxa logo abaixo de um limiar nunca é arredondada para
  cima: ela aparece precedida de `<`.
- Requisições, erros, p95 e pico de memória não têm faixa nem cor: "A fonte
  não informa uma faixa normal."
- Uma captura medida sem nenhuma contagem de erros não colore nada e diz
  isso: "Como a captura não traz contagens de erros, os serviços aparecem
  sem cor de estado."
- Latência e memória nunca colorem nada, e uma captura nunca aparece como
  fora do ar.

### Ritmo e o que a fonte contou

A parte móvel de cada peça trabalha no ritmo das requisições por segundo da
amostra, comparadas com a mediana das taxas medidas do próprio serviço ao
longo da captura; assim, o ritmo habitual é o tráfego habitual naquela
janela. Onde não há contagem de requisições, a peça fica parada como foi
modelada, e essa imobilidade não diz nada.

Numa captura do CloudWatch, os erros são a métrica `Fault` e as
requisições, a contagem de amostras de `Latency`; numa captura do Tempo, os
erros são o contador de requisições com falha do grafo de serviços. O
cartão diz qual.

## Rascunho de plataforma a partir de uma captura

Uma captura mostra o que aconteceu. Para perguntar o que teria acontecido
com outra capacidade, outra conexão ou um filtro, o incidente precisa estar
numa plataforma que a simulação calcula. **⋯ → Criar um rascunho de
plataforma a partir desta captura** escreve os arquivos dessa plataforma na
página, sai da captura e os deixa preparados na caixa de diálogo que
**Importar ou exportar arquivos** abre, com uma lista do que foi medido e do
que não foi. Nada é aplicado até você pressionar **Aplicar**, e o servidor
confere o rascunho como confere qualquer arquivo. O rascunho é identificado
como `synthetic`, como toda plataforma.

| No rascunho                 | De onde vem                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serviços e seus tipos       | Os serviços da captura, como foram escritos                                                                                                           |
| Conexões                    | As chamadas que a captura viu, das mais movimentadas às menos; uma que fecharia um ciclo fica de fora e é listada                                     |
| Peso de uma conexão         | Chamadas nela sobre as requisições que o serviço de origem atendeu, ambas medianas em repouso (antes do primeiro evento); 1 onde não foi medido       |
| Latência própria do serviço | A mediana do p95 em repouso menos a do que ele chama; um valor provisório de 5 ms onde o p95 não foi medido                                           |
| Demanda                     | Um cliente na frente de cada serviço que nada chama, enviando a mediana deles em repouso; 100 requisições por segundo caso contrário                  |
| Taxa própria de uma entrada | Onde uma entrada não contou requisições próprias, ela é tomada como tão movimentada quanto sua chamada mais movimentada: uma convenção, dita como tal |
| Capacidade                  | Não é dada. Nenhuma captura informa uma: cada serviço tem a margem padrão do modelo sobre sua carga em repouso                                        |

**Preencha `capacityRps` nos serviços cujos limites você conhece antes de
ler o que quebra.** A capacidade decide o que falha sob carga, e é o único
número que uma captura não pode dar.

Onde a captura mediu o tráfego na entrada, o rascunho também traz um
cenário que o repete: a demanda de cada período como múltiplo do nível em
repouso, em no máximo 32 fases, comprimido no tempo quando a captura é mais
longa que os 30 minutos que um cenário pode durar. Ele prescreve carga e
nada mais; o que falha sob ela é o modelo que calcula. Um relatório não
mede nada, então seu rascunho traz os serviços e as conexões que o
relatório cita e valores padrão para todos os números.

Um rascunho é a única coisa que sai de uma captura, e só quando você pede.
Prepará-lo o envia ao servidor para ser conferido, e aplicá-lo mostra os
nomes dos serviços a todos que estiverem conectados, como qualquer
importação; num servidor que outras pessoas acessam, só crie o rascunho de
uma captura de um sistema real se esses nomes puderem ser vistos ali. O
site estático mantém o rascunho na aba. Nada mais da captura vai junto: nem
séries de amostras, nem eventos, nem notas, nem o link da fonte.

## Escrever uma captura sua

Três scripts em `scripts/` escrevem capturas. São ferramentas que você roda
na sua própria máquina, com o seu próprio acesso, usando só a biblioteca
padrão do Python 3. O AEGIS nunca os executa, e eles não são
[integrações](Integrações). Os dois exportadores escrevem um arquivo novo e
se recusam a sobrescrever um existente, e terminam com `0` quando escrevem o
arquivo, `1` com `Capture failed: …` quando a exportação falha e `2` para
um erro de uso. `--help` lista as opções e os tipos.

> **Uma captura pode citar os seus sistemas.** Ela traz nomes de serviços,
> conexões e horários da conta ou dos backends de onde foi lida; um nó do
> CloudWatch pode ter como nome um ARN com o ID da conta. Leia a captura
> antes de compartilhá-la. Nenhum dos exportadores escreve nela uma
> credencial, um token, um nome de perfil ou o endereço de um backend.

### A partir do CloudWatch Application Signals

`scripts/export-cloudwatch-capture.py` precisa da AWS CLI v2 no `PATH` e
usa o perfil que você indica com `--profile` ou, sem ele, a cadeia de
credenciais padrão da CLI. A aplicação já precisa enviar telemetria ao
Application Signals. Copie os nomes exatos do serviço e do ambiente da
lista de serviços dele, e escolha uma janela passada que comece antes do
primeiro sintoma e termine depois da recuperação.

```bash
python3 scripts/export-cloudwatch-capture.py \
  --profile observability \
  --region us-east-1 \
  --environment staging \
  --service checkout \
  --start 2026-11-17T14:00:00Z \
  --end 2026-11-17T15:00:00Z \
  --output checkout-incident.json
```

| Opção                        | Efeito                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `--service NAME`             | Outro serviço raiz; pode ser repetida                                                         |
| `--title TEXT`               | O título mostrado quando a captura abre, de 1 a 320 caracteres                                |
| `--cloudtrail-resource NAME` | Acrescenta eventos de gerenciamento de escrita do CloudTrail desse recurso; pode ser repetida |
| `--type NAME=KIND`           | Declara o tipo de um serviço; pode ser repetida (veja abaixo)                                 |

Ele percorre as dependências que o Application Signals descobriu a partir
de cada raiz e lê uma amostra para cada serviço e conexão: os erros são a
métrica `Fault`, as requisições, a contagem de amostras de `Latency`. O
período de amostragem é de 60 s para uma janela que começa há menos de 15
dias, 300 s para uma de menos de 63 dias e uma hora nos demais casos,
alongado para que uma série tenha no máximo 720 amostras. O tipo de um
serviço é mapeado (`typeSource` `source`) onde o Application Signals
informa um tipo de recurso que o exportador conhece (API Gateway, ECS,
EKS, Lambda, RDS, DynamoDB, S3, SNS, SQS), e é um `microservice`
presumido em todos os outros casos. Ele só faz chamadas de leitura; uma
política de privilégio mínimo são estas quatro ações (deixe de fora a
segunda declaração se você nunca usar `--cloudtrail-resource`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AegisCaptureRead",
      "Effect": "Allow",
      "Action": [
        "application-signals:ListServices",
        "application-signals:ListServiceDependencies",
        "cloudwatch:GetMetricData"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AegisCaptureCloudTrail",
      "Effect": "Allow",
      "Action": "cloudtrail:LookupEvents",
      "Resource": "*"
    }
  ]
}
```

### A partir do Tempo e do Prometheus

`scripts/export-otel-capture.py` lê as métricas do grafo de serviços do
Tempo num backend compatível com o Prometheus, e uma amostra limitada de
traces com erro no frontend de consultas do Tempo. Ative o processador de
grafos de serviços no Tempo ou no Alloy e envie os contadores e o
histograma clássico de duração no servidor para esse backend.

```bash
python3 scripts/export-otel-capture.py \
  --tempo-url http://localhost:3200 --prometheus-url http://localhost:9090 \
  --service checkout --start 2026-11-17T14:00:00Z --end 2026-11-17T15:00:00Z \
  --period 60 --output checkout-otel.json
```

| Opção                        | Efeito                                               |
| ---------------------------- | ---------------------------------------------------- |
| `--label KEY=VALUE`          | Um rótulo de escopo do Prometheus; pode ser repetida |
| `--trace-resource KEY=VALUE` | Um atributo de recurso do Tempo; pode ser repetida   |
| `--trace-limit N`            | Traces com erro a ler, de 1 a 100                    |
| `--type NAME=KIND`           | Declara o tipo de um serviço; pode ser repetida      |

- **Tokens só vão por HTTPS ou para esta máquina.** `TEMPO_TOKEN` e
  `PROMETHEUS_TOKEN` são enviados como tokens bearer, `TEMPO_TENANT` e
  `PROMETHEUS_TENANT` como `X-Scope-OrgID`. Com um token definido, uma URL
  que não seja `https://` precisa ser um host de loopback, ou o exportador
  para antes de qualquer requisição. Redirecionamentos nunca são seguidos, e
  um backend de loopback nunca é acessado por um proxy do ambiente.
- **Toda requisição é um GET**, e cada resposta tem no máximo 16 MiB.
- **O que ela contém:** o serviço indicado e suas conexões a um salto em
  cada direção. Todo serviço é um `microservice` presumido, a menos que
  `--type` o declare, numa região chamada "Location not reported".

### Declarar um tipo

Os dois exportadores aceitam `--type NAME=KIND`, que pode ser repetida.
NAME precisa ser exatamente o nome de um único serviço como a captura o
escreve, maiúsculas incluídas; KIND é um dos dezessete tipos de serviço de
uma topologia (`api-gateway`, `auth-service`, `cedar-authorizer`,
`microservice`, `container`, `serverless`, `message-queue`, `database`,
`storage`, `network-gateway`, `security-monitor`, `external-client`,
`load-balancer`, `virtual-machine`, `kubernetes-cluster`, `cache`,
`event-stream`). Um nome que nenhum serviço tem, ou que vários têm,
interrompe a exportação antes de qualquer leitura. O serviço recebe
`typeSource: "declared"`.

### Reconstruir a captura do Online Boutique

`scripts/capture-rcaeval.py` reconstrói a captura incluída a partir de
`multi-source-data.zip`, o arquivo publicado na versão 0.2.0 do RCAEval, e
recusa qualquer outro arquivo (o SHA-256 dele é fixado). Ele escreve na
saída padrão:

```bash
python3 scripts/capture-rcaeval.py multi-source-data.zip \
  > apps/web/src/features/capture/online-boutique-rcaeval.json
pnpm exec prettier --write apps/web/src/features/capture/online-boutique-rcaeval.json
```

Os testes dos três scripts usam simulações da AWS CLI, do Tempo e do
Prometheus e um arquivo sintético para o RCAEval; nada é baixado, então
eles não cobrem uma conta ou um backend reais.

## O formato em resumo

Uma captura é um arquivo JSON, versão 1. Todo horário é em milissegundos
desde a época Unix, e um arquivo que quebra qualquer regra é recusado, não
corrigido.

| Campo            | Significado                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `kind`           | `"aegis-incident-capture"`                                                                                                      |
| `version`        | `1`                                                                                                                             |
| `title`          | De 1 a 320 caracteres, mostrado como foi escrito                                                                                |
| `source`         | `kind` (`cloudwatch`, `tempo-prometheus`, `prometheus-recording` ou `provider-report`), um `label` e uma `url` `https` opcional |
| `window`         | `startMs` e `endMs`, em ordem crescente                                                                                         |
| `topologyWindow` | Opcional: onde a fonte encontrou as conexões; precisa se sobrepor à janela                                                      |
| `periodMs`       | O período de amostragem, de 1 s a um dia; obrigatório assim que algo tem amostras                                               |
| `regions`        | De 1 a 64 de `{ id, name }`                                                                                                     |
| `nodes`          | De 1 a 384 de `{ id, name, region, type, typeSource?, note?, buckets? }`                                                        |
| `edges`          | Até 2048 de `{ source, target, buckets? }`: chamadas vistas, que não precisam ser acíclicas                                     |
| `events`         | Até 1500 de `{ atMs, title, detail?, nodes?, state? }`; `state` é `affected`, `recovering` ou `recovered`                       |
| `notes`          | Até 40 textos, mostrados como foram escritos                                                                                    |

`buckets` são amostras com qualquer um de `requests`, `faults` (mostrado
como erros), `p95Ms` e `memoryBytes`. Deixe de fora o que não foi medido:
um valor ausente é desconhecido, nunca zero. `typeSource` é `source`,
`declared` ou `assumed` (o padrão). Os dois arquivos incluídos,
[`google-cloud-2025-06-12.json`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/features/capture/google-cloud-2025-06-12.json)
e
[`online-boutique-rcaeval.json`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/features/capture/online-boutique-rcaeval.json),
são um exemplo de relatório e um de medições.

## Licença e atribuição do RCAEval

A captura do Online Boutique é derivada de `multi-source-data.zip`, um
arquivo publicado na
[versão 0.2.0 do RCAEval](https://github.com/phamquiluan/RCAEval/releases/tag/0.2.0),
de Luan Pham et al., cujo README nessa versão distribui o código e os
conjuntos de dados dos autores sob a licença MIT (Copyright (c) 2024 Luan
Pham;
[LICENSE na 0.2.0](https://github.com/phamquiluan/RCAEval/blob/0.2.0/LICENSE)).
A captura traz agregados calculados a partir do arquivo por
`scripts/capture-rcaeval.py`, não o arquivo em si.

Cite: L. Pham, H. Zhang, H. Ha, F. Salim, X. Zhang, _RCAEval: A Benchmark
for Root Cause Analysis of Microservice Systems with Telemetry Data_, WWW '25
Companion, [doi:10.1145/3701716.3715290](https://doi.org/10.1145/3701716.3715290).

A captura do Google Cloud é a transcrição, feita pelo AEGIS, do
[relatório público de incidente](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW)
do Google Cloud de 12 de junho de 2025; cada evento cita a atualização em
que se baseia.

## Referência

Os documentos e arquivos abaixo estão em inglês.

- [`docs/CAPTURES.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/CAPTURES.md): a referência completa, com todas as regras de leitura e os detalhes dos exportadores
- [`docs/DEMO.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DEMO.md): a seção 11, um passeio pelas duas capturas incluídas
- [`apps/web/src/features/capture/`](https://github.com/cleissonbarbosa/csdt/tree/main/apps/web/src/features/capture): a leitura, o rascunho e a interface
- [`apps/web/src/app/captureUrl.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/app/captureUrl.ts): o endereço e o histórico do navegador
- [`scripts/export-cloudwatch-capture.py`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/export-cloudwatch-capture.py), [`scripts/export-otel-capture.py`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/export-otel-capture.py) e [`scripts/capture-rcaeval.py`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/capture-rcaeval.py): os três scripts
- [Modelo de segurança](Modelo-de-segurança) e [Glossário](Glossário#arquivos-e-dados): onde uma captura fica, e as palavras dela
