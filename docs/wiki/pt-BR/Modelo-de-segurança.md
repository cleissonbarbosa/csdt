[English](Security-model) · **Português**

O simulador AEGIS roda com dados sintéticos e não consegue mudar nada num
sistema externo. Fora o que uma instância local conectada explicitamente
informa (identificado como `live`), a única coisa que ele mostra que não é
sintética é uma [captura de incidente](Capturas-de-incidente): um incidente
real que o navegador lê de um arquivo e não envia a lugar nenhum. Arquivos
de captura e [inventários de nuvem](Inventários-de-nuvem) são escritos
antes, por scripts que um operador roda na própria máquina com o próprio
acesso; esses scripts só leem, e o AEGIS nunca os executa. Esta página
descreve cada limite e como ele é garantido.

## O que o AEGIS não consegue fazer

| Limite                                            | Como é garantido                                                                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nenhum ataque real**                            | Cenários são dados declarativos que mudam números dentro do motor. Os módulos `simulation` e `incidents` não fazem E/S                                                          |
| **Nenhuma varredura de rede**                     | Nenhum código varre um host ou uma porta. Os dois adaptadores ao vivo enviam requisições HTTP fixas ao único alvo configurado para cada um, por meio do `guard.rs`              |
| **Nenhuma mudança de infraestrutura**             | O servidor, o motor e a página não têm SDK de nuvem nem guardam credencial de nuvem. Os scripts do operador só fazem operações de leitura e não escrevem credenciais em arquivo |
| **Nenhuma conexão de saída por padrão**           | O modo de demonstração não abre nenhuma. Uma integração precisa ser configurada no servidor _e_ ativada pelo operador                                                           |
| **Nenhum alvo remoto**                            | Os adaptadores ao vivo só aceitam alvos de loopback, a menos que um host esteja explicitamente autorizado                                                                       |
| **Nenhuma requisição a terceiros pelo navegador** | Fontes e scripts vêm no pacote, e a Content-Security-Policy publicada é `default-src 'self'`                                                                                    |

## Dados e procedência

Todos os dados da simulação incluídos são sintéticos: serviços, métricas,
incidentes, principais e políticas. O pacote web também traz duas capturas
de incidente que não são: uma transcrição manual do relatório público do
Google Cloud sobre o incidente de 12 de junho de 2025, e agregados do
benchmark Online Boutique do RCAEval 0.2.0. Cada uma cita a sua fonte.

Todo dado traz um rótulo de procedência de onde é produzido até o pixel:
`synthetic` (a simulação), `live` (uma instância local conectada) ou
`recording` (uma captura de incidente, identificada como "Captura" e
mostrada como não simulada). Nada que a simulação produz é identificado
como `recording` ou `live`, e uma topologia de um espaço de trabalho
precisa ser `synthetic`, porque os números dela são calculados, seja qual
for a plataforma que ela descreve.

O AEGIS não coleta telemetria sobre quem o usa e não guarda nada fora do
`localStorage` do navegador (preferências de exibição e o seu progresso no
guia), que ele não envia a lugar nenhum. No site estático, o service worker
também guarda os arquivos da própria versão no Cache Storage.

### Uma captura de incidente fica na aba

Um arquivo de captura (de até 12 MiB) é lido na página, conferido com o
formato de captura e mantido na memória. Ele não é enviado, não é salvo
em armazenamento e some quando a página é recarregada. Ele não é um espaço
de trabalho, e nada dele entra na linha do tempo da simulação: enquanto uma
captura está aberta, nada na interface age sobre a simulação. O link da
fonte de uma captura precisa ser `https`, e é um link que você segue, não
uma requisição que a página faz. Uma captura pode citar um sistema real
(nomes de serviços e, numa captura do CloudWatch, um ARN com o ID da
conta), então compartilhe-a como achar melhor.

### Um rascunho só sai de uma captura quando pedido

**Criar um rascunho de plataforma a partir desta captura** escreve uma
topologia na página com os nomes dos serviços da captura, as chamadas entre
eles e as taxas que ela mediu, e deixa o arquivo preparado na caixa de
diálogo de importação. Prepará-lo o envia ao servidor para ser conferido, e
aplicá-lo o mostra a todos que estiverem conectados, como qualquer
importação. Nada mais vai junto: nem séries de amostras, nem eventos, nem
notas, nem o link da fonte, nem ARN. Num servidor que outras pessoas
acessam, só crie o rascunho de uma captura de um sistema real se os nomes
dos serviços puderem ser vistos ali; o site estático mantém o rascunho na
aba.

## O espaço de trabalho

Um [espaço de trabalho](Arquivos-do-espaço-de-trabalho) é o único lugar de
onde o AEGIS aceita topologias, cenários e políticas com que não foi
compilado. Os dois caminhos de entrada passam pelo mesmo código e pelas
mesmas verificações.

- **De um diretório, na inicialização.** `AEGIS_WORKSPACE` não é definida
  por padrão. O diretório (ou arquivo de pacote) que ela indica é lido uma
  vez, antes de o servidor começar a escutar. É o único lugar em que o
  servidor lê o sistema de arquivos, e é configuração: quem pode escrever
  no diretório já controla como o servidor inicia.
- **Pela API, com o servidor rodando.** A requisição traz o texto de cada
  arquivo, nunca um caminho a abrir: nada derivado de uma requisição é
  aberto, listado ou escrito. Os arquivos são conferidos exatamente como um
  diretório antes de qualquer coisa ser aplicada
  (`POST /demo/workspace/check` confere sem aplicar), mantidos na memória e
  descartados quando o servidor reinicia. `POST /demo/workspace/reset`
  volta ao que o servidor tinha ao iniciar.
- **Uma importação substitui o que todos veem.** Só existe uma simulação;
  por isso, num servidor compartilhado, desligue a importação com
  `AEGIS_IMPORT=off`. As rotas que recebem arquivos (conferência,
  pré-visualização, comparação de políticas, importação e a comparação de
  plataformas) e o reset passam a responder 403, e a interface avisa.

### O que um arquivo pode e não pode fazer

- **Dados, não comportamento.** Um cenário é uma lista dos onze efeitos que
  o motor entende, cada um um número limitado aplicado a um serviço ou a uma
  conexão do modelo. Nenhum efeito lê arquivo, abre socket ou executa nada.
- **Um arquivo do Compose é lido, não executado.** Um `docker-compose.yml`
  é lido como texto em busca dos serviços, dependências, portas publicadas e
  nomes de imagens. Nenhuma imagem é baixada, nada é compilado ou iniciado,
  nenhum `env_file`, `extends` ou `include` é seguido, e nenhuma variável é
  substituída.
- **Um inventário de nuvem é lido, não buscado.** Nenhum provedor é
  consultado, nem pelo servidor nem pela página. Depois de uma importação,
  só a topologia é mantida; as tags, as redes e as notas do arquivo não
  são, e o arquivo não é guardado.
- **A procedência não pode ser forjada.** Um cenário só pode anunciar
  alertas, falhas de autenticação, mitigações e desvios de rota; uma
  gravação, e uma sessão, só podem iniciar e encerrar cenários e aplicar e
  retirar falhas. Uma decisão de autorização não pode ser escrita num
  arquivo.
- **O Cedar continua decidindo.** As políticas de um espaço de trabalho são
  lidas e avaliadas pelo `cedar-policy`, e um fluxo só é barrado no
  autorizador se o Cedar negou a requisição dele.

### Limites

Os arquivos são lidos em estruturas tipadas que recusam campos
desconhecidos, e números fora da faixa são recusados antes de qualquer
execução.

| O quê                                      | Limite                                             |
| ------------------------------------------ | -------------------------------------------------- |
| Um arquivo                                 | 4 MiB                                              |
| Arquivos de um mesmo tipo                  | 64                                                 |
| Uma importação                             | 256 arquivos, num corpo de requisição de até 8 MiB |
| Uma topologia                              | 2 000 serviços e 20 000 conexões                   |
| Políticas                                  | 512                                                |
| Um cenário                                 | 30 minutos virtuais                                |
| Um inventário de nuvem                     | 10 000 recursos e 50 000 relações                  |
| Aninhamento de YAML num arquivo do Compose | 64 níveis                                          |
| Aliases de YAML, depois de expandidos      | 100 000 valores                                    |

Os dois limites de YAML cobrem o que o próprio leitor de YAML não limita.
Ele percorre cada nível de aninhamento chamando a si mesmo, então um
arquivo aninhado o bastante encerraria o processo; e os aliases podem
expandir um arquivo pequeno num enorme. Os dois são conferidos antes de o
texto ser entregue ao leitor, e nenhum YAML chega ao leitor de outra forma.

### Arquivos que descrevem um sistema real

- **Eles são servidos a quem alcançar a API.** A topologia, os textos dos
  cenários, o código de cada política e o catálogo de principais e recursos
  são o que a interface mostra, então a API os devolve. O AEGIS não tem
  autenticação: mantenha um servidor com um espaço de trabalho assim em
  loopback ou atrás de algo que autentique.
- **Eles não são enviados a nenhum outro lugar**, com uma exceção que
  precisa de duas autorizações: um cedar-agent conectado com
  `AEGIS_CEDAR_AGENT_SYNC=true` recebe as políticas e entidades que o motor
  embutido tem.

## Sessões, comparações e relatórios

Algumas rotas sob `/api/v1` recebem ou produzem uma linha do tempo como
dados. Nenhuma lê arquivo, nenhuma recebe um resultado, e cada uma é
limitada.

| Rota                                                                  | O que pode e não pode fazer                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /session`, `POST /demo/session/load`                             | Uma sessão é uma gravação: iniciar e encerrar cenários, aplicar e retirar falhas. Uma decisão nela é recusada. No máximo 512 comandos, 30 minutos virtuais e 256 KiB; carregar uma substitui a linha do tempo para todos |
| `POST /demo/experiments/compare`                                      | Simula um cenário duas vezes em linhas do tempo próprias; a linha do tempo em uso não muda                                                                                                                               |
| `POST /demo/experiments/trial`                                        | A plataforma em repouso duas vezes, sessenta segundos cada, uma delas com uma falha sujeita às mesmas regras de uma aplicada manualmente                                                                                 |
| `POST /demo/experiments/platforms`                                    | Recebe arquivos como uma importação, com os mesmos limites, e não aplica nada; desligada onde a importação está                                                                                                          |
| `POST /demo/experiments/headroom`                                     | No máximo quinze execuções de 66 segundos virtuais; não recebe nenhum número de quem chama                                                                                                                               |
| `POST /demo/experiments/weak-points`                                  | Uma execução de 64 segundos virtuais por serviço, numa plataforma de no máximo 250 serviços                                                                                                                              |
| `POST /demo/authorization/explain`, `POST /demo/authorization/matrix` | Perguntam ao Cedar e não registram nada: nem evento, nem decisão, nem caminho. A matriz faz no máximo 20 000 perguntas; as duas deixam de fora no máximo 32 políticas                                                    |
| `POST /demo/workspace/preview`, `POST /demo/workspace/diff`           | Montam os arquivos enviados como uma conferência e não aplicam nada; são rotas de importação, então 8 MiB e 403 com `AEGIS_IMPORT=off`                                                                                   |
| `GET /incidents/{id}/report`                                          | Lido dos eventos e amostras que já estão na linha do tempo; uma relação que ele não encontra é `unattributed`                                                                                                            |

Endereços também não mudam nada no servidor. Um link que leva uma sessão a
guarda no fragmento (depois do `#`), que não é enviado ao servidor, e a
página só a carrega quando você pede. A vista
(`?arrangement=regions&select=node:use-auth`), `?challenge=<id>` e
`?capture=<id>` nomeiam coisas que a página mostra; `?capture=` só pode
nomear uma captura incluída no pacote.

## O servidor

**Entrada.** Os corpos das requisições são lidos em estruturas tipadas que
recusam campos desconhecidos. Os identificadores têm um conjunto de
caracteres e um tamanho restritos, e as referências a entidades e os
contextos do Cedar são limitados e conferidos antes do uso. Um corpo tem no
máximo 16 KiB, exceto os que levam arquivos (8 MiB) e o de uma sessão
(256 KiB).

**Limites de taxa.** Um balde de tokens por cliente fica na frente de toda
rota, com uma rajada pequena para mutações (40, repostos a 8 por segundo) e
uma maior para leituras.

**O stream.** No máximo 64 assinantes simultâneos. Os navegadores não
aplicam CORS a WebSockets, então o handshake confere o `Origin` com a lista
de origens permitidas por conta própria. As mensagens do cliente têm no
máximo 1 KiB e 20 por segundo; um cliente que insiste em mandar mensagens
malformadas é desconectado, e um consumidor lento é descartado em vez de
acumulado sem limite.

**CORS** só permite as origens em `AEGIS_ALLOWED_ORIGINS`, e só `GET` e
`POST`.

**Cabeçalhos** em toda resposta da API: `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
`Cache-Control: no-store` e
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.

**Logs.** Os logs de requisição guardam só o método e o caminho: nem query
string, nem cabeçalhos, nem corpo.

**Memória.** `unsafe` é proibido no crate inteiro. O histórico é limitado
(30 minutos de tempo virtual, 8 000 eventos), assim como todo buffer que
alguém de fora possa encher.

## Integrações

As regras de [Integrações](Integrações#regras-de-isolamento), garantidas em
`apps/server/src/integrations/guard.rs`:

- Só `http` ou `https`, só loopback a menos que autorizado.
- Nenhuma credencial, caminho, query ou fragmento numa URL configurada.
- Tempo limite de 2 s, nenhum redirecionamento, nenhum proxy do ambiente,
  respostas de até 512 KiB.
- O único segredo, um token opcional do cedar-agent, é lido do ambiente do
  servidor, ocultado na saída de depuração e nunca enviado ao navegador nem
  escrito num log; um teste garante que ele não aparece nos status dos
  provedores.
- O cedar-agent é usado só para leitura, a menos que
  `AEGIS_CEDAR_AGENT_SYNC=true`.

O servidor, o motor e a página não usam credenciais do ambiente de nenhum
tipo: nem sessão do `gh`, nem perfil de nuvem, nem agente SSH. Um perfil de
nuvem só é usado por scripts que você roda:
`scripts/export-cloudwatch-capture.py`, pela AWS CLI, e
`scripts/export-cloud-inventory.py`, pela CLI da AWS, do Google Cloud ou da
Oracle Cloud. Cada um passa à CLI uma lista de argumentos, nunca uma linha
para um shell, e não escreve no arquivo nada sobre a identidade com que a
CLI está conectada. `scripts/export-otel-capture.py` só envia um token a
uma URL `https://` ou a um host de loopback.

## O cliente web

A configuração do nginx incluída define esta Content-Security-Policy:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self';
worker-src 'self' blob:; object-src 'none'; base-uri 'self';
form-action 'none'; frame-ancestors 'none'
```

`style-src 'unsafe-inline'` é a única concessão, para os estilos de
elemento que a interface define. O build não embute recursos no código, então
`font-src` e `script-src` ficam em `'self'`. Nada na página avalia um texto
como código: a biblioteca de esquemas compilaria os seus leitores assim, e
está configurada para não fazer isso. A mesma configuração também envia
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy` e `Cross-Origin-Opener-Policy`.

Toda resposta REST e toda mensagem do stream é conferida com os esquemas
compartilhados antes do uso; uma que viola o contrato é descartada e
registrada. O texto dos eventos é mostrado como texto, nunca como HTML.

## O site estático

`pnpm build:static` monta a aplicação em torno do motor compilado para
WebAssembly, no lugar do servidor. É o mesmo código por trás das mesmas
rotas, então tudo o que foi dito acima sobre o que um arquivo pode fazer
vale ali sem mudança.

- **Ele não fala com nada.** Não há API nem socket. A página pede os
  próprios arquivos e nada mais, e um teste falha se ela pedir algo além.
- **O módulo não consegue sair.** Ele é compilado sem nenhuma importação:
  nem rede, nem relógio, nem armazenamento, nem DOM. Isso é conferido no
  arquivo compilado.
- **Os adaptadores ao vivo não existem nele**, e uma importação fica na
  aba: mantida na memória da página e descartada ao recarregar.
- **A política vai dentro da página.** Um servidor estático não define
  cabeçalhos para ela, então o build escreve a política no documento. Ela
  acrescenta `'wasm-unsafe-eval'`, que permite compilar um módulo
  WebAssembly e nada mais (`eval` continua recusado). `frame-ancestors` não
  pode ser dado num documento: um servidor que possa definir cabeçalhos deve
  enviá-lo, junto com `X-Content-Type-Options: nosniff`.

```text
default-src 'self'; script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
font-src 'self'; connect-src 'self'; worker-src 'self' blob:;
object-src 'none'; base-uri 'self'; form-action 'none'
```

- **O navegador pode guardá-lo.** Um service worker (`sw.js`) guarda os
  arquivos do próprio site para que ele abra sem rede. Ele só responde a
  requisições à própria origem para as quais foi compilado com um arquivo,
  não busca nada em outro lugar e mantém um único cache com o nome do build,
  que o próximo build substitui. A página em si é pedida primeiro à rede.
- **Ele pode ser mostrado dentro de outra página.** `?embed=1` deixa a
  barra de fora e não alcança nenhuma captura de incidente;
  `&scenario=<id>` inicia um incidente ali, e só no site estático, já que
  num servidor a simulação é compartilhada.

## Contêineres

| Contêiner | Proteções                                                                                                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Servidor  | Imagem distroless, usuário sem privilégios de root, sistema de arquivos raiz só de leitura, todas as capabilities removidas, `no-new-privileges`. A porta dele não é publicada: só o contêiner web o alcança                                                 |
| Web       | nginx sem privilégios, todas as capabilities removidas, `no-new-privileges`. Os corpos de requisição à API têm no máximo 32 KiB, e 8 MiB sob `/api/v1/demo/workspace/`, repassados sem serem escritos em disco. A porta fica ligada a `127.0.0.1` por padrão |

## Cadeia de suprimentos

- Os lockfiles estão no repositório, e a CI instala com `--locked` e
  `--frozen-lockfile`. As dependências vêm só do crates.io e do npm.
- Nenhum segredo é necessário para compilar, testar ou rodar, e nenhum está
  no repositório. Arquivos `.env` são ignorados pelo git e o `.env.example`
  não tem valores.
- Uma versão é gerada a partir do commit que a CI testou, e só quando a
  versão em `Cargo.toml` ainda não tem tag. Os dois jobs que têm um token
  com permissão de escrita não rodam nenhuma action de terceiros, nenhum
  tem a permissão do outro, e nenhum job disparado por um pull request tem
  qualquer uma delas.
- As imagens são iniciadas juntas, e o servidor é consultado sobre a
  própria versão, antes de qualquer envio. Uma versão lista o digest de cada
  imagem, para que uma implantação possa usar `image@sha256:…` em vez de uma
  tag que muda.

## Publicar além do localhost

O AEGIS **não tem autenticação**. É uma demonstração feita para rodar numa
máquina de desenvolvimento ou atrás de algo que controle o acesso. Quem
alcançar a API pode iniciar cenários, reiniciar a simulação e, se não
estiver desligada, importar arquivos para todos que estiverem conectados;
não consegue alcançar mais nada por ela.

| Para expô-lo                               | Faça isto                                                    |
| ------------------------------------------ | ------------------------------------------------------------ |
| Controlar quem o alcança                   | Coloque-o atrás de um proxy reverso com autenticação         |
| Aceitar a origem do navegador              | Defina `AEGIS_ALLOWED_ORIGINS` com a origem pública exata    |
| Impedir que outros substituam a plataforma | Defina `AEGIS_IMPORT=off`                                    |
| Publicar o contêiner web além do loopback  | Mude de propósito a ligação da porta no `docker-compose.yml` |

## Reportar uma vulnerabilidade

Abra uma [issue no GitHub](https://github.com/cleissonbarbosa/csdt/issues)
para qualquer coisa que pareça errada. Não há implantação em produção nem
dados de usuários, então um relato público não é problema.

## Referência

Os documentos e arquivos abaixo estão em inglês.

- [`docs/SECURITY.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/SECURITY.md): a referência completa
- [`docs/INTEGRATIONS.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/INTEGRATIONS.md) e [`docs/CAPTURES.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/CAPTURES.md): os adaptadores ao vivo, e o que uma captura é e contém
- [`apps/server/src/integrations/guard.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/integrations/guard.rs): a única verificação por que passa todo alvo de saída
- [`apps/server/src/api/mod.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/api/mod.rs): limites de corpo, limites de taxa e cabeçalhos de resposta
- [`apps/web/nginx.conf.template`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/nginx.conf.template) e [`apps/web/vite.config.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/vite.config.ts): as duas Content-Security-Policies
- [`docker-compose.yml`](https://github.com/cleissonbarbosa/csdt/blob/main/docker-compose.yml) e [`.env.example`](https://github.com/cleissonbarbosa/csdt/blob/main/.env.example): os contêineres, e as variáveis do servidor com um comentário em cada uma
