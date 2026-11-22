[English](Development) · **Português**

Esta página é para quem trabalha no próprio AEGIS: onde está o código, as
ferramentas de que ele precisa, como rodar e testar cada parte e as regras
que uma mudança segue. O
[`AGENTS.md`](https://github.com/cleissonbarbosa/csdt/blob/main/AGENTS.md)
(em inglês) é o guia completo, incluindo a lista do que é fácil quebrar.

## Organização do repositório

| Diretório            | O que contém                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server`        | O servidor em Rust, crate `aegis-server`: domínio, simulação, incidentes, autorização, integrações, espaço de trabalho, aplicação, API       |
| `apps/wasm`          | O motor para o navegador, crate `aegis-wasm`: as rotas do servidor atrás de uma fronteira de chamadas de função, compiladas para WebAssembly |
| `apps/web`           | O cliente React: gráficos, funcionalidades, stores, provedores e a ligação com o motor                                                       |
| `packages/contracts` | O contrato compartilhado: schemas zod e amostras exportadas pelo servidor                                                                    |
| `fixtures`           | A topologia, os cenários, as gravações e os arquivos Cedar embutidos, organizados como um espaço de trabalho                                 |
| `examples`           | Um pequeno espaço de trabalho para copiar, e inventários de nuvem como os coletores os escrevem                                              |
| `schemas`            | Os JSON Schemas dos formatos do espaço de trabalho, gerados a partir dos tipos em Rust                                                       |
| `docs`               | Os documentos de referência e a fonte deste wiki (`docs/wiki`)                                                                               |
| `scripts`            | Os executores de capturas de tela e de benchmark, a versão, os scripts de captura de incidente, os coletores de inventário de nuvem          |

As dependências do servidor apontam para dentro: `api → application →
simulation / authorization → domain`. [Arquitetura](Arquitetura) explica
cada parte.

## Ferramentas

| Ferramenta | Versão                                                                        | Onde é definida                     |
| ---------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| Rust       | stable, com `rustfmt` e `clippy`; a versão mínima suportada é a 1.85          | `rust-toolchain.toml`, `Cargo.toml` |
| Node       | 24; o campo `engines` exige no mínimo a 22.12                                 | `.nvmrc`, `package.json`            |
| pnpm       | 12.18.0                                                                       | `packageManager` no `package.json`  |
| wasm32     | o alvo `wasm32-unknown-unknown`, só para o site estático                      | `scripts/build-engine.sh`           |
| Python     | Python 3, só a biblioteca padrão, para os scripts de `scripts/` e seus testes |                                     |

Um `node` padrão mais antigo falha no Vitest, então confira `node -v`
primeiro. Rode `pnpm install` uma vez. Nada exige credenciais, tokens ou um
`.env`.

```bash
rustup target add wasm32-unknown-unknown
```

## Como rodar cada parte

### O servidor e o cliente web

```bash
cargo run -p aegis-server     # API on http://127.0.0.1:8787  (alias: pnpm dev:server)
pnpm dev:web                  # UI on http://localhost:5173, proxies /api and the WebSocket
docker compose up --build     # both, containerised, on http://localhost:8080
```

`pnpm dev` inicia o Vite e uma verificação de tipos contínua dos contratos;
ele não inicia o servidor.

### O servidor com os seus próprios arquivos

```bash
cargo run -p aegis-server -- export-workspace <dir>   # the bundled files, to edit
cargo run -p aegis-server -- check-workspace <dir>    # validate one; try examples/corner-shop
cargo run -p aegis-server -- diff-workspace <base> <candidate>   # what Cedar decides differently; @bundled is the bundled set
cargo run -p aegis-server -- compare-incident <base> <candidate> <scenario>   # one scenario on each side's platform, side by side
AEGIS_WORKSPACE=<dir> cargo run -p aegis-server
```

Os formatos estão em [Arquivos do espaço de trabalho](Arquivos-do-espaço-de-trabalho).

### O site estático

```bash
pnpm engine:build     # apps/wasm → apps/web/src/engine/aegis.wasm (git-ignored)
pnpm dev:static       # Vite on http://localhost:5173, no proxy, engine in a worker
pnpm build:static     # engine:build, then apps/web/dist-static
pnpm --filter @aegis/web preview:static
```

## Verificações, como o CI as roda

Estes são os comandos de
[`.github/workflows/ci.yml`](https://github.com/cleissonbarbosa/csdt/blob/main/.github/workflows/ci.yml),
na ordem:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm format:check     # pnpm format to fix
pnpm typecheck
pnpm lint
pnpm test             # Vitest: contracts + web
python3 -B -m unittest discover -s scripts -p 'test_*.py'   # the capture scripts; standard library only
pnpm build
pnpm e2e              # Playwright against the real stack
# The static site (its own CI job; needs the wasm32 target):
cargo clippy -p aegis-wasm --target wasm32-unknown-unknown --locked -- -D warnings
pnpm engine:build
pnpm test:engine      # the built module against the contract samples, in Node
pnpm e2e:static       # Playwright against the static build, no server
```

O CI os roda em cinco jobs a cada push na `main` e a cada pull request:

| Job           | O que roda                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust          | `./scripts/version.sh` (uma só versão em todos os manifestos), formatação, Clippy, testes, e as amostras do contrato geradas de novo e comparadas |
| Web           | Formatação, verificação de tipos, lint, testes unitários, os testes em Python e o build de produção                                               |
| Ponta a ponta | Um build de release do servidor e, depois, o Playwright                                                                                           |
| Site estático | O Clippy para o alvo do navegador, o módulo do motor, o teste dele e o Playwright sem servidor                                                    |
| Docker        | As duas imagens compiladas, iniciadas juntas e verificadas através do contêiner web                                                               |

## Como rodar um único teste

```bash
cargo test -p aegis-server --test simulation <name_substring>   # one file of apps/server/tests/
cargo test -p aegis-server --lib <module::or::name>             # unit tests inside src/
pnpm --filter @aegis/web exec vitest run src/stores/ui.test.ts
pnpm --filter @aegis/web exec vitest run -t "part of the test name"
pnpm --filter @aegis/contracts test
pnpm --filter @aegis/web exec playwright test -g "part of the title" --project chromium
cargo test -p aegis-wasm <name_substring>                        # the engine's boundary, natively
pnpm --filter @aegis/web exec playwright test --config playwright.static.config.ts -g "part of the title"
python3 -B scripts/test_export_otel_capture.py -k token          # one Python test file, narrowed by name
```

Os testes de integração do servidor são os arquivos de
[`apps/server/tests`](https://github.com/cleissonbarbosa/csdt/tree/main/apps/server/tests).
Eles montam a aplicação por meio de `tests/common`, chamam o roteador no
próprio processo e avançam o tempo por conta própria.

## Testes de ponta a ponta

- O Playwright inicia o seu próprio servidor de release e o seu próprio
  build web de produção, e nunca reaproveita uma instância de
  desenvolvimento em execução. A primeira execução compila o servidor em modo
  release. `pnpm --filter @aegis/web e2e:install` instala o navegador.
- Todos os testes compartilham uma única simulação, então a suíte roda em
  série, com um worker. Cada teste começa com `openApp()`, de
  `e2e/support.ts`, que reinicia a simulação, incluindo os arquivos
  importados.
- Uma falha interrompe os testes seguintes. `AEGIS_E2E_KEEP_GOING=1` roda
  todos, para ver de uma vez todas as falhas de uma execução.
- `window.__aegis` responde com base no último quadro desenhado: leia uma
  posição ou uma contagem de chamadas de desenho só depois de `waitForScene`.

| Projeto         | Onde roda                                                                         |
| --------------- | --------------------------------------------------------------------------------- |
| `chromium`      | WebGL 2 por software, o que o CI tem                                              |
| `no-3d`         | Todas as APIs de GPU desativadas: a visualização em tabela                        |
| `chrome-webgpu` | Só com `AEGIS_E2E_GPU=1`, num Chrome instalado localmente, com uma GPU de verdade |

## Diagnósticos

Estes não fazem parte da execução normal dos testes:

```bash
# Per-scenario trace table. Narrow with TRACE_SCENARIO=<id>, TRACE_TOPOLOGY=<id>, TRACE_EVENTS=1.
cargo test -p aegis-server --test trace -- --ignored --nocapture
# Engine micro-benchmark; only meaningful with --release.
cargo test --release -p aegis-server --test trace engine_step_cost -- --ignored --nocapture
# Parity with a locally built cedar-agent; reports "skipped" when the variable is unset.
AEGIS_TEST_CEDAR_AGENT_BIN=/path/to/cedar-agent cargo test -p aegis-server --test integrations
```

## Portas

As portas são separadas de propósito, para que duas execuções nunca
compartilhem uma simulação.

| Uso                                               | Servidor | Web  |
| ------------------------------------------------- | -------- | ---- |
| Desenvolvimento                                   | 8787     | 5173 |
| `vite preview`                                    | 8787     | 4173 |
| Playwright                                        | 8797     | 4183 |
| Playwright, site estático (`pnpm e2e:static`)     | nenhum   | 4187 |
| `scripts/capture-docs.sh`, `scripts/benchmark.sh` | 8798     | 4184 |

## Amostras do contrato e JSON Schemas

O módulo `domain` em Rust é a fonte da verdade do contrato, e
`packages/contracts/src/index.ts` o espelha como schemas zod.
`packages/contracts/samples/` guarda saídas reais do servidor, escritas pelo
binário `export-contract-samples`. Os testes do contrato exigem que cada
amostra lida seja igual à entrada, e o CI falha se as amostras commitadas
diferirem do que o servidor emite. Depois de mudar um tipo do domínio, a
resposta de uma rota ou um fixture:

```bash
pnpm contracts:samples    # then update src/index.ts to match and commit both
```

Os JSON Schemas de `schemas/v1/` são gerados a partir dos mesmos tipos em
Rust. Depois de mudar um tipo ou um limite `#[schemars(...)]`, gere-os de
novo e faça o commit do resultado; um teste em Rust falha com um schema
desatualizado:

```bash
pnpm workspace:schemas
```

Tudo o que está em `fixtures/` é compilado dentro do servidor, então editar
um fixture exige recompilá-lo. A mudança de um campo num formato público
também exige atualizar `docs/WORKSPACE.md` e `examples/corner-shop`, e uma
mudança que um arquivo existente não suportaria exige um novo
`FORMAT_VERSION` em `workspace.rs`.

## A versão e as releases

O `Cargo.toml` define a versão, o servidor a informa, e três arquivos
`package.json`, o `Cargo.lock` e a amostra de saúde a repetem.

```bash
./scripts/version.sh              # print it; fails if a manifest states another
./scripts/version.sh set 0.2.0    # write it everywhere; runs the exporter of contract samples
```

Publicar é uma decisão de uma pessoa:

- **Uma release** é feita pelo commit que muda a versão, e por nada mais.
  Quando esse commit passa no CI da `main`, o workflow de release compila as
  duas imagens a partir do commit testado, inicia as duas e pergunta a versão
  ao servidor, envia as imagens ao GitHub Container Registry, cria a tag
  `v<versão>` no commit e publica uma release no GitHub. Uma versão com
  sufixo (`0.2.0-rc.1`) é uma pré-release e não move nem `latest` nem
  `MAJOR.MINOR`. A versão muda pelo `version.sh`, nunca à mão.
- **A versão acompanha o código.** Uma mudança no que o servidor, o motor,
  a página, o contrato ou um formato de arquivo fazem sobe a versão, num
  commit só dela, depois desse trabalho: PATCH para uma correção que não
  muda nada de que um cliente ou um arquivo dependa, MINOR para todo o
  resto. Documentos, o wiki, os testes e o CI não a mudam. Enviar esse
  commit à `main` é a decisão de publicar.
- **O site estático** é publicado no GitHub Pages por
  `.github/workflows/pages.yml`, que só roda quando iniciado manualmente.
- **O wiki** também é publicado por uma pessoa; veja [O wiki](#o-wiki).

## Regras do projeto

- **Nada é inventado.** Os números de `docs/PERFORMANCE.md` vêm de
  `./scripts/benchmark.sh`, e as imagens de `docs/assets/` de
  `./scripts/capture-docs.sh`, ambos rodados contra a aplicação. Não edite
  um número à mão nem descreva como medido algo que não foi medido.
- **A procedência é sempre indicada.** Um dado é `synthetic`, `recording`
  (uma captura de incidente, identificada como "Captura") ou `live`, de onde
  é produzido até o pixel.
- **Só simulação.** `simulation` e `incidents` não fazem I/O; os arquivos
  são lidos apenas por `workspace::load`, na inicialização. O servidor, o
  motor e a página não têm SDK nem credencial de nuvem, e não abrem conexão
  de saída por padrão.
- **Determinismo.** `engine::step` nunca lê um relógio, usa um contador
  global ou percorre uma coleção sem ordem; tudo o que muda com o tempo fica
  em `SimState`.
- **Rust.** `unsafe` é proibido (`forbid`) no crate do servidor; o crate do
  motor o nega (`deny`) e libera o lint só nas funções exportadas com
  `#[no_mangle]`, sem nenhum bloco `unsafe`. `dbg!` e `todo!` são negados, e
  `unwrap()` fora dos testes é um aviso do Clippy que o CI transforma em
  falha. Os corpos de requisição recusam campos desconhecidos.
- **TypeScript** é estrito, com `noUncheckedIndexedAccess`, e
  `react-hooks/exhaustive-deps` é um erro.
- **Palavras e idiomas.** A documentação e os comentários no código são em
  inglês. O texto da interface passa por `t()`, e cada frase precisa da sua
  tradução em `apps/web/src/i18n/pt-BR/`, ou os testes falham. Uma mudança
  visual é avaliada pelo
  [`docs/DESIGN.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DESIGN.md)
  (em inglês; veja [Princípios de design](Princípios-de-design)).
- **Formatação.** O Prettier ignora `packages/contracts/samples`, `fixtures`
  e `docs/assets`; não os reformate à mão.

## Como contribuir com uma mudança

1. Leia a parte do `AGENTS.md` sobre a área que você vai mexer, e o
   `docs/DESIGN.md` para qualquer coisa visual.
2. Faça a mudança com os seus testes e rode as verificações acima que dizem
   respeito a ela.
3. Gere de novo o que a mudança afeta: as amostras do contrato, os JSON
   Schemas, um documento ou o espaço de trabalho de exemplo.
4. Não mexa na versão e abra um pull request. O CI roda nele.

### O wiki

A fonte deste wiki é
[`docs/wiki/`](https://github.com/cleissonbarbosa/csdt/tree/main/docs/wiki):
um arquivo por página em `en/` e em `pt-BR/`, mais `_Sidebar.md` e
`_Footer.md`, compartilhados pelas duas línguas. Uma correção é um pull
request ali, feito nas duas línguas. O `scripts/test_wiki.py` mantém as duas
línguas juntas, e o CI o roda com os outros testes em Python:

- a primeira linha de uma página leva à tradução dela, que leva de volta;
- uma página e a sua tradução têm os mesmos títulos, por nível;
- os blocos de código são idênticos nas duas línguas (só um bloco `mermaid`
  é traduzido);
- todo link chega a uma página da mesma língua, a um título dela ou a um
  arquivo do repositório na `main`, e toda imagem é uma de `docs/assets/`.

```bash
python3 -B scripts/test_wiki.py
```

O `scripts/wiki.sh` dispõe as páginas lado a lado num checkout do próprio
repositório do wiki, como o wiki do GitHub as guarda, e mostra o
`git status` dali. Ele se recusa a rodar se o `scripts/test_wiki.py` não
passar, e não faz commit nem push de nada: publicar o wiki é uma decisão de
uma pessoa. O repositório do wiki só existe depois que a primeira página é
salva no GitHub.

```bash
git clone https://github.com/cleissonbarbosa/csdt.wiki.git ../csdt.wiki
./scripts/wiki.sh ../csdt.wiki
```

## Referência

Os documentos abaixo estão em inglês.

- [`AGENTS.md`](https://github.com/cleissonbarbosa/csdt/blob/main/AGENTS.md): ferramentas, comandos, portas, notas sobre os testes de ponta a ponta e regras do projeto
- [`README.md`](https://github.com/cleissonbarbosa/csdt/blob/main/README.md): testes, releases e organização do projeto
- [`docs/ARCHITECTURE.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/ARCHITECTURE.md): organização do repositório e testes do contrato
- [`package.json`](https://github.com/cleissonbarbosa/csdt/blob/main/package.json): os scripts
- [`.github/workflows/ci.yml`](https://github.com/cleissonbarbosa/csdt/blob/main/.github/workflows/ci.yml), [`release.yml`](https://github.com/cleissonbarbosa/csdt/blob/main/.github/workflows/release.yml), [`pages.yml`](https://github.com/cleissonbarbosa/csdt/blob/main/.github/workflows/pages.yml)
- [`scripts/version.sh`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/version.sh), [`scripts/test_wiki.py`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/test_wiki.py), [`scripts/wiki.sh`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/wiki.sh)
- [`apps/web/playwright.config.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/playwright.config.ts)
