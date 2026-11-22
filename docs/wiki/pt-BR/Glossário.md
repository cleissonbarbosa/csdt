[English](Glossary) · **Português**

As palavras que a interface e este wiki usam, cada uma com um só
significado. A interface está em inglês e em português do Brasil e usa uma
palavra para cada coisa nas duas línguas; a coluna do meio dá o termo em
inglês.

## A plataforma e o modelo

| Termo                  | Em inglês       | Significado                                                                                                                                                                                          |
| ---------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plataforma             | Platform        | Os serviços que a simulação roda. A que vem com o AEGIS é a _Helios Commerce_: 51 serviços em três regiões e uma borda global. Também vem uma topologia de estresse com 178 serviços e 648 conexões. |
| Topologia              | Topology        | O arquivo que descreve uma plataforma: seus serviços e as conexões entre eles, que formam um grafo dirigido sem ciclos.                                                                              |
| Serviço                | Service         | Um nó de uma topologia, com um tipo, uma região e uma camada de dependência.                                                                                                                         |
| Tipo de serviço        | Kind of service | O que um serviço é: um gateway, um autorizador, um banco de dados, um balanceador de carga e assim por diante. São dezessete, cada um desenhado como uma peça própria.                               |
| Peça                   | Piece           | O objeto modelado que representa um tipo de serviço na tela. A sua única parte móvel trabalha no ritmo do tráfego do serviço.                                                                        |
| Visão geral            | Overview        | O nível de abertura: uma peça por tipo de serviço, nas quatro camadas que uma requisição atravessa (entrada, identidade, computação e dados). Os números são a soma dos serviços que ela representa. |
| Disposição             | Arrangement     | Como o modelo detalhado é organizado: cada serviço por si, por região de nuvem ou por camada de dependência.                                                                                         |
| Visualização em tabela | Table view      | O mesmo modelo como uma tabela acessível, usada quando o navegador não tem 3D e disponível a qualquer momento com <kbd>T</kbd>.                                                                      |
| Ponto de tráfego       | Bead            | Uma marca que corre por uma conexão e representa tráfego. O tráfego comum se distingue pela forma; só o que deu errado (erro, rejeitado, suspeito) tem cor.                                          |
| Faixa normal           | Normal range    | A faixa contra a qual um sinal é lido. Todo número na tela vem com ela.                                                                                                                              |
| Saúde                  | Health          | Um serviço está saudável, degradado, crítico ou fora do ar. Um serviço saudável não tem cor, ponto nem selo.                                                                                         |
| Exposição              | Exposure        | Tudo aquilo para onde um serviço poderia abrir uma conexão, seguindo a topologia. É o que a topologia permite, não a afirmação de que um ataque teria sucesso.                                       |

## Tempo

| Termo              | Em inglês            | Significado                                                                                                                                                                  |
| ------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tick               | Tick                 | Um passo da simulação: 200 ms de tempo virtual.                                                                                                                              |
| Agora da simulação | The simulation's now | Onde o histórico novo está sendo feito. Pode estar pausado.                                                                                                                  |
| Histórico          | History              | Todo momento antes do agora da simulação. Voltar a um deles o restaura exatamente; também pode estar pausado. O histórico se limita a 30 minutos virtuais e 8 000 eventos.   |
| Rever              | Replay               | Simular de novo o histórico gravado, bit a bit, a partir da semente e dos comandos.                                                                                          |
| Semente            | Seed                 | O número do qual parte o gerador aleatório do motor. A mesma semente e os mesmos comandos dão a mesma execução.                                                              |
| Checkpoint         | Checkpoint           | Uma cópia do estado do motor feita a cada 25 ticks, a partir da qual um momento passado é simulado de novo.                                                                  |
| Gravação           | Recording            | Uma semente mais uma lista de comandos: um incidente gravado, carregado e simulado de novo.                                                                                  |
| Sessão             | Session              | O que está na tela, salvo como arquivo ou link: a plataforma, a semente, os comandos dados, o momento e a vista. Abrir uma sessão a simula de novo; nenhum número vai junto. |

## Incidentes

| Termo                   | Em inglês              | Significado                                                                                                                                                                |
| ----------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cenário                 | Scenario               | Um incidente escrito como dados: fases, os efeitos de cada fase e os eventos que ele anuncia. Cinco vêm com o AEGIS.                                                       |
| Função                  | Role                   | Uma parte da plataforma que um cenário nomeia em vez do id de um serviço, como `primaryGateway` ou `outageRegion`, para que o mesmo cenário rode em mais de uma topologia. |
| Fase                    | Phase                  | Um trecho de um cenário, contado a partir do início do seu incidente (`+0:14`).                                                                                            |
| Falha                   | Fault                  | Uma falha aplicada manualmente a um serviço, fora de qualquer cenário.                                                                                                     |
| Objetivo                | Objective              | Um dos dois limiares em que as regras de detecção do motor disparam alerta: uma taxa de erro e uma latência p95. Um relatório conta o tempo passado além deles.            |
| Prescrito               | Prescribed             | Uma afirmação escrita no arquivo do cenário.                                                                                                                               |
| Modelado                | Modelled               | Uma afirmação que decorre de uma relação da topologia que o modelo segue, como uma dependência ou a carga.                                                                 |
| Observado               | Observed               | Uma afirmação registrada durante a execução.                                                                                                                               |
| Não explicado           | Not explained          | O que um relatório não consegue explicar, dito com essas palavras em vez de adivinhado.                                                                                    |
| Intervenção             | Intervention           | Uma mudança (mais capacidade, um serviço retirado) feita num momento escolhido e comparada ao mesmo incidente sem ela, em linhas do tempo próprias.                        |
| Experimento             | Trial                  | Uma falha simulada na plataforma em repouso antes de ser aplicada, para ver quais serviços sairiam do normal. Nada vai para a linha do tempo.                              |
| Limites e pontos fracos | Limits and weak points | Quanta demanda a plataforma em repouso suporta antes de perder um objetivo, e quais serviços derrubam mais outros quando caem. Cada número é uma execução.                 |
| Desafio                 | Challenge              | Uma pergunta sobre a plataforma respondida usando-a, e conferida contra o próprio modelo.                                                                                  |

## Cedar

| Termo                    | Em inglês     | Significado                                                                                                                                                            |
| ------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requisição               | Request       | O que é posto ao Cedar: um principal (quem pede), uma ação (para quê), um recurso (sobre o quê) e um contexto.                                                         |
| Decisão                  | Decision      | A resposta do Cedar a uma requisição: Permitido ou Negado, com as políticas que a determinam e os diagnósticos.                                                        |
| Política                 | Policy        | Uma regra do Cedar que permite ou proíbe.                                                                                                                              |
| Situação de uma política | Standing      | O que uma política diz sozinha sobre uma requisição: ela se aplica; ela trata desta requisição, mas a sua condição não vale; ou ela está fora do escopo da requisição. |
| Matriz de acesso         | Access matrix | A decisão do Cedar para cada requisição que o catálogo descreve, com os principais nas linhas e as ações nas colunas.                                                  |
| Catálogo                 | Catalogue     | As formas de requisição que a simulação conhece (`fixtures/cedar/catalog.json`). Um fluxo de cenário só é bloqueado onde o Cedar negou a sua forma.                    |
| Desatualizado            | Stale         | Um resultado cujo formulário mudou depois de avaliado. Ele é marcado como a resposta a outra pergunta, nunca mostrado como atual.                                      |

## Arquivos e dados

| Termo                 | Em inglês        | Significado                                                                                                                                                                             |
| --------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Espaço de trabalho    | Workspace        | Um conjunto de arquivos (topologias, cenários, gravações, políticas Cedar) que substitui os que vêm com o AEGIS, de um diretório com que o servidor inicia ou importado pela interface. |
| Prévia                | Preview          | A plataforma que um conjunto de arquivos descreve, simulada em repouso antes de qualquer coisa ser aplicada.                                                                            |
| Editor de plataforma  | Platform editor  | O modo em que uma plataforma é desenhada ou editada peça a peça. O que ele produz é um arquivo de topologia.                                                                            |
| Arquivo Compose       | Compose file     | Um `docker-compose.yml`, lido como texto e transformado em topologia. Todo número que ele não traz é um padrão, e a topologia diz isso.                                                 |
| Inventário de nuvem   | Cloud inventory  | Um arquivo que um script coletor escreve a partir do que uma conta AWS, Google Cloud ou Oracle Cloud lista. O AEGIS lê o arquivo; ele não pergunta nada a nenhum provedor.              |
| Captura de incidente  | Incident capture | Um incidente real, como um provedor o relatou ou um sistema o mediu, lido pelo navegador a partir de um arquivo e mostrado no mesmo modelo. Nunca chega à linha do tempo da simulação.  |
| Relatório do provedor | Provider report  | Uma captura transcrita à mão do relatório público de incidente de um provedor.                                                                                                          |
| Procedência           | Provenance       | De onde vem um número: _synthetic_ (a simulação, «Sintético»), _recording_ (uma captura de incidente, «Captura») ou _live_ (medido de um sistema local conectado explicitamente).       |
| Modo conectado        | Connected mode   | A simulação com uma integração local conectada, como uma instância do cedar-agent. Exige configuração no servidor e um clique explícito.                                                |
| Site estático         | Static site      | A versão em que o motor roda na aba do navegador, como WebAssembly, sem servidor.                                                                                                       |
| Motor                 | Engine           | A simulação determinística: no servidor, ou compilada para WebAssembly no site estático.                                                                                                |

## Palavras que o AEGIS evita

- **"Ao vivo" para o tempo simulado.** O cursor está no agora da simulação
  ou no seu histórico. "Ao vivo" fica para dados medidos de um sistema
  conectado.
- **"Rever", "gravação" ou "gravado" para uma captura de incidente.** Essas
  palavras são da simulação: o seu histórico simulado de novo e os seus
  incidentes gravados.
- **"SLO" ou "orçamento de erro" para um objetivo.** Ninguém combinou esses
  limiares com ninguém; eles são do próprio motor.
- **"Ao vivo" ou "observado" para qualquer coisa de uma captura,** e
  "objetivo" para os limiares de uma captura.
- **Uma cor para o normal.** Não existe "verde saudável": uma cor responde
  ou a quem olha (azul, para o que está selecionado) ou aos dados (âmbar,
  vermelho e magenta, para o que se desvia).

## Referência

Os documentos abaixo estão em inglês.

- [docs/DESIGN.md, "Words"](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DESIGN.md)
- [AGENTS.md](https://github.com/cleissonbarbosa/csdt/blob/main/AGENTS.md)
- [O vocabulário em português da interface](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/i18n/pt-BR/common.ts)
