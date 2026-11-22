[English](FAQ-and-troubleshooting) · **Português**

Respostas curtas para dúvidas comuns, e a solução habitual de cada problema.
Cada resposta indica a página ou o documento com a história completa.

## Para rodar

### O Vitest ou o pnpm falha com um Node mais antigo

O AEGIS precisa do Node 24, a versão que o `.nvmrc` indica; o
`package.json` exige no mínimo a 22.12, e um `node` padrão mais antigo
falha no Vitest. Confira a versão primeiro, depois mude para o Node 24 e
instale de novo:

```bash
node -v
pnpm install
```

O próprio pnpm é fixado na 12.18.0 pelo campo `packageManager` do
`package.json`. [Desenvolvimento](Desenvolvimento#ferramentas) lista todas as
ferramentas.

### O `pnpm engine:build` diz que o alvo wasm32 não está instalado

O site estático precisa do motor compilado para WebAssembly, e isso exige um
alvo Rust que não vem instalado por padrão. O script para com:

```text
build-engine: the wasm32-unknown-unknown target is not installed. Run: rustup target add wasm32-unknown-unknown
```

Adicione o alvo e compile de novo:

```bash
rustup target add wasm32-unknown-unknown
pnpm engine:build
```

Um build estático iniciado sem o módulo para com "The engine module is not
built". O `pnpm build:static` roda o `pnpm engine:build` antes, então não
tem esse problema.

### Qual porta é qual?

| Endereço                | O que responde ali                                                 |
| ----------------------- | ------------------------------------------------------------------ |
| `http://127.0.0.1:8787` | O servidor (`cargo run -p aegis-server`)                           |
| `http://localhost:5173` | A interface em desenvolvimento (`pnpm dev:web`, `pnpm dev:static`) |
| `http://localhost:4173` | O `vite preview`, incluindo o `preview:static`                     |
| `http://localhost:8080` | Docker Compose: o contêiner web, que repassa a API                 |

As execuções de teste e os scripts de capturas de tela e de benchmark usam
portas próprias, então nunca compartilham uma simulação com a sua instância
de desenvolvimento. Elas estão listadas em
[Desenvolvimento](Desenvolvimento#portas).

### Uma porta já está em uso

O Vite não muda para outra porta quando a dele está ocupada: ele para.
Libere a porta ou mude o outro lado:

- **O servidor** escuta em `AEGIS_BIND` (por padrão `127.0.0.1:8787`). Se
  você o mudar, diga ao Vite onde ele está com `AEGIS_API_PROXY`.
- **O Docker** publica a interface em `AEGIS_WEB_PORT` (por padrão `8080`).
  A origem do navegador muda com a porta, então inclua a nova origem em
  `AEGIS_ALLOWED_ORIGINS`, que o servidor verifica para o CORS e o stream.

```bash
AEGIS_BIND=127.0.0.1:<port> cargo run -p aegis-server
AEGIS_API_PROXY=http://127.0.0.1:<port> pnpm dev:web
AEGIS_WEB_PORT=<port> AEGIS_ALLOWED_ORIGINS=http://localhost:<port> docker compose up --build
```

### O site publicado não tem uma mudança recente

O site estático é publicado por um workflow que só roda quando alguém o
inicia manualmente, então pode estar atrás da `main`. Gere você mesmo o
código atual com `pnpm build:static` ([Primeiros passos](Primeiros-passos)).
O service worker do site pede a página à rede primeiro, então um visitante
que está online recebe o build publicado.

## A visualização 3D

### Meu navegador não tem WebGPU

Nada se perde. Os materiais da cena são escritos uma vez e rodam no WebGPU
ou no WebGL 2, então o WebGL 2 desenha o mesmo modelo. A página pede ao
navegador um adaptador WebGPU em vez de confiar que a API existe, porque uma
GPU bloqueada, um navegador headless ou uma área de trabalho remota podem
oferecer a API sem um adaptador.

- Para usar o WebGL 2 mesmo onde o WebGPU funciona, abra **⋯** →
  **Configurações** e ajuste **API gráfica** para **WebGL 2**. A cena
  reinicia.
- Sem nenhuma das duas APIs, a página diz "Este navegador não é compatível
  com WebGPU nem com WebGL 2. A topologia é exibida em tabela." Se o
  renderizador não conseguir iniciar, ela diz "Não foi possível iniciar o
  renderizador 3D neste dispositivo." Nos dois casos aparece a visualização
  em tabela.
- <kbd>T</kbd> alterna para a visualização em tabela a qualquer momento. Ela
  traz a topologia inteira sem 3D e pode ser usada com um leitor de tela.

### O modelo está lento

Com **Qualidade de renderização** em **Auto** (em **⋯** →
**Configurações**), a cena desce por quatro níveis quando os quadros ficam
lentos, e volta a subir quando há folga. Os níveis mais baixos reduzem a
resolução, a densidade de contas e a distância em que os nomes aparecem; os
nomes continuam nítidos em todos os níveis. Você também pode fixar um nível.

Pressione <kbd>P</kbd> para o painel de desempenho: taxa de quadros, tempo
de quadro, chamadas de desenho, quantidade de contas e API gráfica. Com
renderização por software a cena continua lenta em todos os níveis: o
controle de qualidade reduz o custo de um quadro, mas não torna rápida uma
máquina sem GPU. [Desempenho](Desempenho) traz as medições.

### Por que quase nada tem cor?

Porque a cor é uma resposta. O azul responde a você: a seleção, a
requisição que você rastreia, o foco do teclado, os links. Âmbar, vermelho e
magenta respondem aos dados: algo fora do normal, falhando ou bloqueado, e
tráfego hostil. Um serviço saudável não tem cor, ponto nem selo, e a barra
superior diz "51 serviços, todos normais". Quando algo acontece, a cor que
você vê é o problema. O tema noturno segue a mesma regra, e todo estado tem
também uma forma, então nada depende de distinguir dois tons.
[Princípios de design](Princípios-de-design) explica as regras.

## Dados e segurança

### Alguma coisa no AEGIS é real?

A simulação, não. A Helios Commerce, seus serviços, métricas, incidentes,
principais e políticas são todos sintéticos. Uma plataforma carregada dos
seus próprios arquivos também é sintética: os números dela são calculados.
O que é real:

- **As decisões do Cedar.** Todo Permitido e Negado é a resposta de uma
  avaliação real do Cedar sobre as políticas exibidas: o motor `cedar-policy`
  embutido, ou um cedar-agent local que você conecta.
- **As capturas de incidente.** Uma captura é um incidente real, como um
  provedor o relatou ou um sistema o registrou, lido no seu navegador a
  partir de um arquivo. Duas vêm embutidas: o relatório público do Google
  Cloud sobre o incidente de 12 de junho de 2025 e agregados do benchmark
  Online Boutique do RCAEval 0.2.0. Uma captura é identificada como
  "Capturado, não simulado" ou "Do relatório do provedor, não simulado" e
  nunca é misturada à simulação.
- **Dados ao vivo**, só de uma instância local que você conecta em
  [Integrações](Integrações), identificados como `live`.

[Capturas de incidente](Capturas-de-incidente) e o [Glossário](Glossário)
dizem mais.

### O AEGIS se conecta à minha conta de nuvem?

Não. O servidor, o motor e a página não contêm SDK de nuvem nem guardam
credencial de nuvem, e não abrem conexão de saída por padrão. Um inventário
de nuvem é um arquivo escrito por um coletor de `scripts/`, que você roda na
sua própria máquina com as suas próprias credenciais. Os coletores (AWS,
Google Cloud, Oracle Cloud) só chamam operações de leitura e não escrevem
nada que identifique a conta. O AEGIS nunca os roda: a interface só escreve
o comando para você rodar. Os exportadores de captura funcionam do mesmo
jeito. Veja [Inventários de nuvem](Inventários-de-nuvem) e
[Modelo de segurança](Modelo-de-segurança).

### Posso rodá-lo onde outras pessoas o alcançam?

Só atrás de algo que controle o acesso. O AEGIS não tem autenticação, e há
uma única simulação: qualquer pessoa que alcance a API pode iniciar cenários
e reiniciar a simulação para todos os conectados e, enquanto a importação
estiver ligada, substituir a plataforma que todos veem. Se for expô-lo:

- coloque-o atrás de um proxy reverso com autenticação;
- defina `AEGIS_ALLOWED_ORIGINS` com a origem pública exata;
- defina `AEGIS_IMPORT=off` onde ninguém deve substituir o que está em
  exibição.

A configuração do Docker liga a porta web a `127.0.0.1` e não publica a
porta da API. O site estático é a outra opção: são arquivos comuns, sem
servidor, então publicá-lo mostra a plataforma fictícia embutida e nada
mais. [Modelo de segurança](Modelo-de-segurança) traz todos os limites.

### O que o navegador guarda?

O AEGIS não coleta telemetria sobre você. O navegador guarda, no
`localStorage`:

| Chave               | O que guarda                                                                                                                               | Como limpar                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `aegis.settings.v1` | As suas **Configurações**: idioma, tema, qualidade de renderização, API gráfica, nomes, rotação da câmera, movimento, painel de desempenho | **Restaurar os padrões** em **Configurações**                     |
| `aegis.guide.v1`    | Se o cartão da primeira visita foi usado ou dispensado, e quais desafios você resolveu                                                     | **Recomeçar** em **Desafios guiados** (só os desafios resolvidos) |

O site estático também instala um service worker que guarda os próprios
arquivos do site, para que ele abra sem rede. Ele mantém um único cache,
com o nome do build, que o build seguinte substitui.

Algumas coisas, de propósito, não são guardadas. Um arquivo de captura de
incidente fica na memória da página e some ao recarregá-la. Os arquivos
importados no site estático ficam na aba e somem ao recarregá-la; num
servidor, uma importação fica na memória do servidor até ele reiniciar.

## Idioma

### Como mudo o idioma?

Abra **⋯** → **Configurações** e escolha **Idioma**: **Do navegador** (a
primeira língua do navegador), **English** ou **Português (Brasil)**. O
idioma é lido quando a página carrega, então mudá-lo recarrega a página. Num
servidor, a simulação continua como está; no site estático, ela recomeça na
aba. A escolha fica guardada neste navegador.

### Por que alguns textos aparecem em inglês na interface em português?

A interface é traduzida, mas o que o servidor ou um arquivo escreveu aparece
como foi escrito: nomes, o texto de um cenário, eventos e mensagens de erro.
Os arquivos da plataforma embutida estão em inglês, então os nomes dos
cenários, os eventos e os rótulos do rastreador de requisições também estão.

## Referência

Os documentos abaixo estão em inglês.

- [`AGENTS.md`](https://github.com/cleissonbarbosa/csdt/blob/main/AGENTS.md): ferramentas, portas e as regras da interface
- [`docs/SECURITY.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/SECURITY.md): o que o AEGIS não consegue fazer, e como publicá-lo além do localhost
- [`docs/PERFORMANCE.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/PERFORMANCE.md): degradação gradual
- [`docs/DESIGN.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DESIGN.md): por que a cor é uma resposta
- [`docs/DEMO.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DEMO.md): escala e alternativas
- [`apps/web/vite.config.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/vite.config.ts), [`scripts/build-engine.sh`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/build-engine.sh), [`apps/server/src/config.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/src/config.rs)
- [`apps/web/src/stores/ui.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/stores/ui.ts), [`apps/web/src/stores/guide.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/stores/guide.ts): o que o navegador guarda
