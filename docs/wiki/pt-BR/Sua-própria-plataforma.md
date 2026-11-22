[English](Your-own-platform) · **Português**

O AEGIS vem com uma plataforma fictícia, cinco incidentes e nove políticas
Cedar. Os seus próprios arquivos podem ocupar o lugar de qualquer um deles:
uma topologia que descreve uma plataforma que importa para você, cenários
escritos para ela e as políticas Cedar que você quer ver avaliadas. Nada é
recompilado.

> **Continua sendo uma simulação.** Uma topologia descreve uma plataforma; a
> carga, a latência, as falhas e o tráfego de autorização sobre ela são
> calculados pelo motor e identificados como `synthetic`, seja qual for a
> plataforma. Nada do que você traz faz o AEGIS observar um sistema real.

## Três formas de começar

| Forma                              | Use para                                                    | Onde                                                                   |
| ---------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| O diálogo de importação            | experimentar arquivos com o servidor rodando, sem reiniciar | **⋯** (**Mais**) → **Importar ou exportar arquivos**                   |
| Um diretório de espaço de trabalho | iniciar o servidor com os seus arquivos                     | `AEGIS_WORKSPACE=<dir>`                                                |
| O editor de plataforma             | desenhar uma topologia, ou mudar uma, no próprio modelo     | **⋯** → **Editar esta plataforma** ou **Desenhar uma plataforma nova** |

Seja qual for a forma, cada tipo de arquivo que você traz substitui aquela
parte, e o resto vem do conjunto que acompanha o AEGIS: um espaço de
trabalho só com políticas Cedar é a mesma plataforma sob outras políticas.
Os formatos estão em
[Arquivos do espaço de trabalho](Arquivos-do-espaço-de-trabalho).

## Comece de uma cópia

```bash
cargo run -p aegis-server -- export-workspace ./my-platform   # the bundled files, as a starting point
cargo run -p aegis-server -- check-workspace ./my-platform    # validate without starting anything
AEGIS_WORKSPACE=./my-platform cargo run -p aegis-server       # run with it
```

O `export-workspace` grava num diretório novo ou vazio. O
`check-workspace` carrega e compila o diretório exatamente como a
inicialização faz e mostra o que encontrou, inclusive cada cenário que não
consegue rodar numa topologia e o motivo:

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

O [`examples/corner-shop`](https://github.com/cleissonbarbosa/csdt/tree/main/examples/corner-shop)
é um espaço de trabalho completo em seis serviços, pequeno o bastante para
ler de uma vez. Um erro impede o servidor de iniciar e diz em que arquivo
está. Com o Docker Compose, monte o diretório e indique-o:

```yaml
services:
  server:
    environment:
      AEGIS_WORKSPACE: /workspace
    volumes:
      - ./my-platform:/workspace:ro
```

## A linha de comando

Nenhum destes comandos inicia o servidor. Quando um deles lê um espaço de
trabalho, ele o monta como a inicialização montaria, e esse espaço pode ser
um diretório, um arquivo salvo com **Salvar em um único arquivo** ou, nas
duas comparações, `@bundled`: o conjunto compilado no binário. São
subcomandos do binário do servidor, `aegis-server`; num checkout,
`cargo run -p aegis-server --` faz o papel dele.

| Comando                                                                                  | O que faz                                                                                          |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `export-workspace <dir>`                                                                 | Grava em `<dir>` as topologias, os cenários, as gravações e os arquivos Cedar que vêm com o AEGIS. |
| `check-workspace <dir>`                                                                  | Valida um espaço de trabalho sem iniciar o servidor.                                               |
| `diff-workspace <base> <candidate> [--json] [--exit-code]`                               | Lista o que o Cedar decide diferente sob o candidato.                                              |
| `compare-incident <base> <candidate> <scenario> [--topology=<id>] [--seed=<n>] [--json]` | Roda um cenário na plataforma que cada lado descreve, com a mesma semente, lado a lado.            |

### Comparar dois conjuntos de políticas

O `diff-workspace` é a pergunta a fazer a uma mudança de política antes do
merge. O relatório tem quatro partes (um exemplo completo, a plataforma que
vem com o AEGIS sem uma política, está no
[docs/WORKSPACE.md](https://github.com/cleissonbarbosa/csdt/blob/main/docs/WORKSPACE.md)):

- **Policies** (políticas) são comparadas pelo significado: reformatar uma,
  passá-la para um arquivo `.cedar` ou acrescentar um `@description` não é
  mudança.
- **Simulated traffic** (tráfego simulado) são as formas de requisição do
  catálogo, com a parcela do tráfego comum negada de cada lado.
- **Scenario flows** (fluxos de cenário) são os fluxos ligados a uma
  requisição do catálogo que param no autorizador de um lado e não do outro.
- **Access matrix** (matriz de acesso) é cada requisição que o rastreador
  de requisições do candidato consegue montar, com cada chave de contexto
  ausente, falsa e verdadeira; no máximo 20 000 são comparadas.

Cada linha é a resposta do Cedar de cada lado; o comando só compara, e uma
requisição que nenhum catálogo cita não é comparada. O `--json` grava a
comparação completa para outras ferramentas.

O código de saída é o que permite reprovar um pipeline: 0 normalmente; 1
com `--exit-code` quando uma decisão muda (uma requisição, um fluxo ou a
parcela negada em repouso, não uma política reescrita com o mesmo efeito);
2 quando um dos lados não pode ser montado.

```bash
aegis-server diff-workspace ./main-policies ./branch-policies --exit-code
```

### Comparar um incidente em duas plataformas

O `compare-incident` roda o mesmo cenário na plataforma com que a base abre
e na do candidato, cada uma numa linha do tempo própria, com a mesma
semente. Ele mostra o que difere, o que decorre sem estar escrito e as duas
execuções lado a lado (tudo isso com `--json`), e sai com 2 quando a
comparação não pode ser feita. O cenário precisa ser o mesmo incidente dos
dois lados: escrito igual nos dois e capaz de rodar em cada plataforma. O
diálogo de importação faz a mesma pergunta,
[mais abaixo](#um-incidente-nas-duas-plataformas).

## O diálogo de importação

**⋯** → **Importar ou exportar arquivos** abre **Arquivos da plataforma**.
Ele faz sem reiniciar o que um diretório de espaço de trabalho faz na
inicialização.

1. **Escolher arquivos**, **Escolher uma pasta**, ou solte um ou outro na
   área marcada. Uma pasta é lida com a estrutura de um espaço de trabalho;
   um arquivo sozinho é reconhecido pelo que contém.
2. Os arquivos são verificados à medida que você os acrescenta. O diálogo
   mostra o que aplicá-los daria (as plataformas, os cenários, a parcela das
   requisições comuns que o Cedar negaria, cada cenário que não pôde rodar e
   o motivo), ou o arquivo em que está um erro e qual é. Nada muda antes de
   **Aplicar**.
3. Se quiser, pergunte o que eles mudariam antes de aplicar (as duas seções
   seguintes).
4. **Aplicar**. Há uma só simulação, então aplicar inicia uma linha do tempo
   nova para todos que estão conectados.

O que mais o diálogo faz:

- Uma importação é posta sobre os arquivos com que o servidor iniciou, não
  sobre uma importação anterior: cada tipo de arquivo que você acrescenta
  substitui aquela parte. Um arquivo de cenário é a lista inteira de
  cenários. Para somar ao que está na tela, use **Usar os arquivos em uso
  como base para a importação**.
- **Salvar em um único arquivo** baixa tudo o que está em uso num único
  arquivo JSON, um pacote. Ele pode ser solto de volta no diálogo, ou
  indicado onde quer que caiba um diretório (`AEGIS_WORKSPACE`,
  `check-workspace`, `diff-workspace`).
- Uma importação fica na memória do servidor. Reiniciá-lo, ou **Voltar para
  os arquivos iniciais do servidor**, traz de volta os arquivos com que ele
  iniciou. Para manter uma importação, salve-a e inicie o servidor com ela.
- `AEGIS_IMPORT=off` desliga a importação; o diálogo passa a apenas salvar.
- No site estático, a importação funciona do mesmo jeito e os arquivos
  ficam na aba; um espaço de trabalho lido na inicialização exige o
  servidor.

### O que o Cedar decidiria diferente

Com os arquivos válidos, **Comparar com os arquivos em uso** responde
**Quais decisões do Cedar mudariam?**: políticas acrescentadas, removidas ou
de significado alterado, requisições do catálogo e fluxos de cenário cujo
resultado muda, e cada requisição que o rastreador consegue montar e que
passa de permitida a negada ou o contrário. É o `diff-workspace` com os
arquivos em uso como base, e não aplica nada.

### Um incidente nas duas plataformas

Uma capacidade, um serviço ou uma conexão que teria mudado o rumo de um
incidente é uma mudança num arquivo de topologia. Para experimentá-la antes
de aplicar, prepare os arquivos alterados, escolha um cenário em **Como
seria o mesmo incidente em cada plataforma?** e clique em **Executar as
duas**. O motor roda o cenário duas vezes, com a mesma semente: a execução A
na plataforma em uso e a B na que os arquivos descrevem. Nada é aplicado e
a linha do tempo em uso não é tocada.

| Parte da resposta                                                   | O que diz                                                                                                                                                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Diferenças entre as plataformas**                                 | O que as duas descrições dizem de forma diferente, casado por id e escrito como cada arquivo escreveu.                                                                                              |
| **Diferenças implícitas nos arquivos**                              | Uma capacidade que nenhum arquivo informa é dimensionada pela carga em repouso, e muda com quem chama; uma taxa escrita como fração de uma capacidade vira outra taxa onde essa capacidade é outra. |
| As duas execuções                                                   | Maior taxa de erro e taxa média de erro, maior latência, serviços afetados, quanto tempo cada objetivo deixou de ser cumprido, quando tudo voltou ao normal.                                        |
| **Ver a execução A**, **Aplicar estes arquivos e ver a execução B** | Põe uma execução na linha do tempo; a segunda aplica os arquivos antes, como **Aplicar** faz.                                                                                                       |

Leia a segunda parte antes dos números. O cenário DDoS Surge que vem com o
AEGIS escreve a inundação como 2,2 vezes o que o gateway aguenta, então um gateway
três vezes maior recebe uma inundação três vezes maior. Para pôr o mesmo
ataque contra as duas plataformas, escreva a taxa em requisições por
segundo (`"rate": { "rps": 5400 }`). Duas execuções não dizem de qual
diferença um resultado decorre, e o AEGIS não diz isso por elas: para ver o
que uma mudança faz, mude só ela.

## O editor de plataforma

**⋯** → **Editar esta plataforma** abre a topologia que está na tela;
**Desenhar uma plataforma nova** começa de uma região e um cliente. É um
modo da mesma janela: a simulação continua por trás e volta como estava.

- **Pôr um serviço.** Leve uma peça da paleta à esquerda até a mesa. A raia
  sob o ponteiro é a região dela e a coluna, a camada; o meio do espaço
  entre duas colunas cria uma coluna nova, e logo depois da última raia, uma
  região nova. Uma peça clicada sem ser arrastada, ou acionada pelo teclado,
  é acrescentada uma camada depois do que está selecionado.
- **Conectar.** Leve uma peça até outra, ou use **Conectar a** no card de um
  serviço. O protocolo e a relação são os que os tipos sugerem, os mesmos
  que o leitor de Compose usa. Uma conexão que fecharia um ciclo é recusada,
  com os serviços por onde ele passaria.
- **Editar.** O card à direita edita cada campo do arquivo para o que está
  selecionado: um serviço, uma conexão ou, sem seleção, a plataforma, as
  regiões e as funções. Um número que um arquivo pode omitir (uma
  capacidade, um limite de taxa, um filtro, um escalonamento automático,
  uma latência) fica desligado até você ligá-lo, e então começa do que o
  motor lhe deu em repouso. Delete remove a seleção; Ctrl Z e Ctrl Shift Z
  desfazem e refazem.
- **Ver o que o motor faz dela.** Um instante depois que o rascunho para de
  mudar, o motor o roda em repouso com os arquivos em uso em volta (uma
  prévia: nada é aplicado), e o modelo mostra o estado e o tráfego de cada
  serviço. Até o motor responder, um serviço aparece como desconhecido, em
  pé e mais apagado sobre um anel tracejado; enquanto uma mudança está
  rodando, a barra diz que o modelo mostra a última execução.
- **Concluir.** **Salvar o arquivo** baixa a topologia. **Comparar um
  incidente** a prepara no diálogo de importação, para rodar um incidente
  nela e na plataforma em uso. **Aplicar** a põe em uso e, como qualquer
  importação, inicia uma linha do tempo nova para todos que estão
  conectados. Um rascunho que não é aplicado não é guardado, então **Sair do
  editor** pergunta antes quando o rascunho tem mudanças.

Com a visualização em tabela ligada, ou onde o navegador não tem nem WebGPU
nem WebGL 2, o editor mostra o rascunho como uma tabela organizada por
região e camada: a paleta (clicada em vez de arrastada) e o card funcionam
do mesmo jeito.

Ao lado de **Plataforma**, o editor tem uma aba **Incidente**, onde um
cenário é escrito sobre o mesmo modelo: fases numa faixa, efeitos levados
até um serviço, uma região ou uma conexão, fluxos desenhados com cliques. É
ela que **Escrever o seu próprio cenário** abre;
[Arquivos do espaço de trabalho](Arquivos-do-espaço-de-trabalho#cenário) a
descreve junto com o formato.

## Um arquivo Compose

Ponha um `docker-compose.yml` em `topologies/`, ou solte-o no diálogo de
importação, e ele é lido como topologia. O arquivo é texto: nada é baixado,
construído ou executado.

| Do arquivo                                        | Na topologia                                                                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cada serviço                                      | um nó com o nome dele                                                                                                                                          |
| a sua `image` (ou, sem ela, o seu nome)           | o tipo do nó: `postgres`, `redis`… um banco de dados; `rabbitmq`, `kafka`… uma fila; `nginx`, `traefik`… um gateway de API; qualquer outra coisa, um contêiner |
| `depends_on` e `links`, também via `<<: *x`       | uma conexão do serviço para aquilo de que ele precisa                                                                                                          |
| `ports`                                           | uma conexão de `clients` para cada serviço que publica uma porta; sem nenhuma publicada, para cada serviço de que nada depende                                 |
| o `name` do topo do arquivo, ou o nome do arquivo | o id e o nome da plataforma                                                                                                                                    |

Um arquivo Compose não diz nada de tráfego nem de latência, então esses
números são padrões do próprio conversor (100 requisições por segundo de
`clients`, uma latência por tipo de serviço), e a descrição da topologia diz
isso. Trate o resultado como um primeiro rascunho: importe-o, salve-o num
único arquivo e ajuste os números e as funções. Um arquivo cujos serviços
dependem uns dos outros em ciclo, ou de um serviço que ele não declara, é
recusado com o motivo.

## Um inventário de nuvem

Um script do repositório lê o que a AWS, o Google Cloud ou a Oracle Cloud
lista de uma conta e grava um único arquivo; o diálogo de importação o lê,
deixa você escolher o que trazer, e ele vira a plataforma. O próprio AEGIS
não acessa nenhuma nuvem e não guarda nenhuma credencial. Veja
[Inventários de nuvem](Inventários-de-nuvem).

## O que um serviço faz com a carga

Três campos opcionais de um serviço dizem o que ele faz quando chega mais do
que ele foi feito para atender. Nenhum vale se o arquivo não o der, uma
plataforma que não dá nenhum roda exatamente como antes, e um cliente
externo não pode ter nenhum deles. No editor, eles ficam em **O que faz com
a carga**.

| Campo              | O que o serviço faz                                                                                                                                                        | Faixa                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `rateLimitRps`     | Admite no máximo esse número de requisições por segundo, venham de quem vierem; o resto falha rápido para quem chamou, e o que está atrás dele recebe só o que ele admite. | acima de 0                              |
| `suspiciousFilter` | Recusa essa fração do tráfego que um cenário marca como suspeito, desde a primeira requisição. O tráfego comum não é tocado.                                               | 0 a 1                                   |
| `autoscale`        | Deixa a capacidade acompanhar a carga, até `maxFactor` vezes a capacidade em repouso, fechando cerca de dois terços da diferença a cada `seconds`.                         | `maxFactor` 1 a 100, `seconds` 1 a 3600 |

O tráfego passa por eles nesta ordem: o filtro, o limite de taxa, o que a
própria fase de um cenário rejeita e, por fim, a capacidade. A fração do
filtro é o que o arquivo afirma, nunca calculada pelo modelo. No cenário
DDoS Surge que vem com o AEGIS, a inundação começa a ser filtrada aos 36
segundos, pela própria fase do cenário; uma plataforma que informa o mesmo filtro o aplica desde o
início, e comparar as duas é como se vê o custo desses 36 segundos.

## Onde a plataforma cede

**⋯** → **Testar os limites da plataforma** faz duas perguntas à plataforma
em uso, em repouso, cada uma em linhas do tempo próprias:

- **Quanto tráfego a plataforma suporta** (**Encontrar o limite**). A
  demanda de cada cliente externo é multiplicada pelo mesmo fator e mantida
  por um minuto, em ×1,25, ×1,5, ×2, ×3, ×4, ×6, ×8, ×12 e ×16, até o
  primeiro fator em que um objetivo deixa de ser cumprido; o intervalo é
  então dividido ao meio cinco vezes. A resposta é o último fator que se
  manteve e o primeiro que não, com uma linha para cada fator tentado. Nada
  é dito dos fatores entre eles.
- **Impacto de tirar cada serviço do ar** (**Testar todos os serviços**).
  Cada serviço fica inacessível por vez, exatamente como **Experimentar uma
  falha sem aplicá-la** faz no card dele, e são contados os outros que
  saíram do normal. Uma plataforma com mais de 250 serviços não é
  classificada.

## O que um espaço de trabalho não consegue fazer

- **Fazer o servidor abrir alguma coisa.** Um diretório é lido uma vez,
  antes de o servidor aceitar conexões, do único lugar que
  `AEGIS_WORKSPACE` indica. Uma importação leva o texto dos seus arquivos;
  nada é gravado em disco.
- **Fazer o AEGIS contatar alguma coisa.** Nenhum efeito de cenário sai do
  motor.
- **Afirmar um resultado.** Um arquivo não consegue identificar nada como
  `live` ou `recording`, afirmar uma decisão do Cedar ou pôr um evento que o
  motor não produziu.

O que ele faz é pôr o seu conteúdo na tela: a API devolve a topologia, os
cenários, cada política e o catálogo a quem conseguir alcançá-la, e o AEGIS
não tem autenticação. Se os arquivos descrevem um sistema real ou o
servidor é compartilhado, mantenha-o em loopback ou atrás de algo que
autentique, e defina `AEGIS_IMPORT=off` onde ninguém deve substituir o que
está na tela. Veja [Modelo de segurança](Modelo-de-segurança).

## Referência

Os documentos abaixo estão em inglês.

- [docs/WORKSPACE.md](https://github.com/cleissonbarbosa/csdt/blob/main/docs/WORKSPACE.md): o guia completo de espaços de trabalho, do diálogo de importação, do editor e das comparações
- [docs/INVENTORY.md](https://github.com/cleissonbarbosa/csdt/blob/main/docs/INVENTORY.md): inventários de nuvem
- [docs/SECURITY.md](https://github.com/cleissonbarbosa/csdt/blob/main/docs/SECURITY.md): como um espaço de trabalho é limitado
- [examples/corner-shop](https://github.com/cleissonbarbosa/csdt/tree/main/examples/corner-shop): um espaço de trabalho completo, de seis serviços
- [apps/server/src/main.rs](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/main.rs): os subcomandos da linha de comando
- [apps/web/src/features/workspace/](https://github.com/cleissonbarbosa/csdt/tree/main/apps/web/src/features/workspace) e [apps/web/src/features/editor/](https://github.com/cleissonbarbosa/csdt/tree/main/apps/web/src/features/editor): o diálogo de importação e o editor de plataforma
