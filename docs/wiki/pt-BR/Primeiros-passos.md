[English](Getting-started) · **Português**

O AEGIS roda só no navegador, em dois contêineres ou a partir do código.
Todas as formas mostram a mesma plataforma fictícia, a _Helios Commerce_, e
nenhuma precisa de credenciais, conta, token ou arquivo `.env`. Esta página
mostra cada forma de iniciá-lo, como carregar uma pequena plataforma sua, os
atalhos de teclado e um primeiro passeio.

## Do que você precisa

| Para rodar                         | Você precisa de                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| No site estático publicado         | Um navegador. O WebGPU é usado quando o navegador o oferece, e o WebGL 2 caso contrário |
| Com Docker                         | Docker com Compose                                                                      |
| A partir das imagens publicadas    | Docker com Compose                                                                      |
| A partir do código                 | Rust stable, Node 24 (no mínimo 22.12) e pnpm 12.18.0                                   |
| Como site estático gerado por você | O mesmo que a partir do código, mais o alvo Rust `wasm32-unknown-unknown`               |

Se o navegador não tiver nem WebGPU nem WebGL 2, a aplicação mostra a
plataforma em tabela, no lugar do modelo 3D. As ferramentas exatas estão em
[Desenvolvimento](Desenvolvimento#ferramentas).

## Como rodar

### No navegador, sem instalar nada

Abra o [site estático](https://cleissonbarbosa.github.io/csdt/). O motor da
simulação roda na própria aba, compilado para WebAssembly, e a página não
requisita nada além dos próprios arquivos. O site é publicado manualmente,
então pode estar atrás da `main`.

Tudo funciona igual ali, exceto o modo conectado (as
[Integrações](Integrações)), que precisa do servidor. Os arquivos que você
importa ficam na aba e somem quando você a recarrega.

### Com Docker

```bash
git clone https://github.com/cleissonbarbosa/csdt.git aegis
cd aegis
docker compose up --build
```

Abra `http://localhost:8080`. O contêiner web serve a interface e repassa a
API ao contêiner do servidor. A porta da API não é publicada, e a porta web
fica ligada a `127.0.0.1`.

O `docker-compose.yml` lê estas variáveis do seu ambiente (ou de um arquivo
`.env` ao lado dele). Todas são opcionais:

| Variável                | Padrão                                        | O que define                                                                |
| ----------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| `AEGIS_WEB_PORT`        | `8080`                                        | A porta em `127.0.0.1` em que a interface é servida                         |
| `AEGIS_ALLOWED_ORIGINS` | `http://localhost:8080,http://127.0.0.1:8080` | As origens de onde um navegador pode carregar a interface (CORS e o stream) |
| `AEGIS_SEED`            | `42`                                          | A semente da simulação determinística                                       |
| `AEGIS_IMPORT`          | `on`                                          | Se a interface pode substituir os arquivos da plataforma                    |
| `AEGIS_LOG`             | `info`                                        | O filtro de log do servidor                                                 |

As variáveis das integrações estão descritas em [Integrações](Integrações).

### A partir das imagens publicadas

Uma versão publicada roda a partir das suas imagens, sem nada para compilar:

```bash
export AEGIS_SERVER_IMAGE=ghcr.io/cleissonbarbosa/aegis-server:latest
export AEGIS_WEB_IMAGE=ghcr.io/cleissonbarbosa/aegis-web:latest
docker compose up --no-build
```

Uma release dá a cada imagem a tag da sua versão, do seu `MAJOR.MINOR` e
`latest`; uma pré-release (`0.2.0-rc.1`), só a da sua versão. A
[release no GitHub](https://github.com/cleissonbarbosa/csdt/releases) lista
o digest de cada imagem, então você pode usar `image@sha256:…` em vez de uma
tag que muda.

### A partir do código: servidor e web

Rode os dois processos em dois terminais:

```bash
cargo run --release -p aegis-server     # API on http://127.0.0.1:8787
pnpm install
pnpm dev:web                            # UI on http://localhost:5173
```

Abra `http://localhost:5173`. O Vite repassa `/api` e o WebSocket para
`http://127.0.0.1:8787`; defina `AEGIS_API_PROXY` se o servidor escutar em
outro endereço. `pnpm dev:server` é o mesmo servidor, compilado em modo de
depuração.

### Como site estático gerado por você

```bash
rustup target add wasm32-unknown-unknown
pnpm install
pnpm build:static                          # the engine as WebAssembly and the site around it
pnpm --filter @aegis/web preview:static    # http://localhost:4173
```

`apps/web/dist-static` passa a ser um conjunto de arquivos comuns que rodam a
simulação no navegador. Enquanto você altera o código, `pnpm engine:build`
seguido de `pnpm dev:static` serve o mesmo site em `http://localhost:5173`.

## Experimente uma plataforma sua

O repositório traz
[`examples/corner-shop`](https://github.com/cleissonbarbosa/csdt/tree/main/examples/corner-shop),
uma loja fictícia de seis serviços que usa todas as partes do formato de
arquivo.

- **Pela interface:** abra **⋯** (**Mais**), escolha **Importar ou exportar
  arquivos**, depois **Escolher uma pasta**, selecione `examples/corner-shop`
  e pressione **Aplicar**. Aplicar inicia uma nova linha do tempo para todos
  os conectados. **Voltar para os arquivos iniciais do servidor**, no mesmo
  diálogo, traz a Helios Commerce de volta.
- **Pelo terminal:** verifique a pasta e então inicie o servidor com ela. O
  servidor a lê uma vez, na inicialização, toda vez que inicia. Já uma
  importação feita pela interface fica na memória do servidor até ele ser
  reiniciado.

```bash
cargo run -p aegis-server -- check-workspace examples/corner-shop
AEGIS_WORKSPACE=examples/corner-shop cargo run --release -p aegis-server
```

- **Com Docker:** o `docker-compose.yml` tem uma linha
  `AEGIS_WORKSPACE: /workspace` e um volume somente leitura, ambos
  comentados. Descomente os dois e aponte o volume para a sua pasta.

[Sua própria plataforma](Sua-própria-plataforma) cobre as outras formas: um
arquivo Compose, um inventário de nuvem ou uma plataforma desenhada no
navegador. Os campos de cada arquivo estão em
[Arquivos do espaço de trabalho](Arquivos-do-espaço-de-trabalho).

## Atalhos de teclado

**Ajuda e legenda**, em **⋯**, lista as mesmas teclas.

| Tecla                        | O que faz                                                                |
| ---------------------------- | ------------------------------------------------------------------------ |
| <kbd>Espaço</kbd>            | Reproduzir ou pausar a simulação                                         |
| <kbd>R</kbd>                 | Redefinir a câmera                                                       |
| <kbd>F</kbd>                 | Aproximar a câmera da seleção                                            |
| <kbd>Esc</kbd>               | Limpar a seleção e, em seguida, fechar os painéis                        |
| <kbd>Ctrl</kbd> <kbd>K</kbd> | Buscar um serviço, uma região, um cenário ou uma ação                    |
| <kbd>/</kbd>                 | Buscar serviços                                                          |
| <kbd>L</kbd>                 | Próxima disposição: visão geral, por região, por dependência             |
| <kbd>T</kbd>                 | Alternar entre o modelo 3D e a tabela                                    |
| <kbd>P</kbd>                 | Mostrar ou ocultar o painel de desempenho                                |
| <kbd>?</kbd>                 | Abrir esta ajuda                                                         |
| <kbd>←</kbd> <kbd>→</kbd>    | Mover 5 s na linha do tempo (mantenha Shift pressionado para mover 30 s) |

Com uma captura de incidente aberta, <kbd>Espaço</kbd> reproduz ou pausa a
captura, <kbd>/</kbd> lista os serviços dela, <kbd>←</kbd> <kbd>→</kbd>
andam pela linha do tempo da própria captura, e <kbd>Home</kbd> /
<kbd>End</kbd> vão ao início ou ao fim dela. Uma captura é desenhada só por
região e não tem paleta de comandos, então a ajuda não lista
<kbd>Ctrl</kbd> <kbd>K</kbd> nem <kbd>L</kbd> nesse modo.

## Um passeio de cinco minutos

Esta é uma versão resumida do passeio de
[`docs/DEMO.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DEMO.md)
(em inglês). Os nomes que vêm dos arquivos da plataforma (principais, ações,
cenários) aparecem como os arquivos os escreveram, em inglês.

### 1. Leia a visão geral

A página abre na **visão geral**: a Helios Commerce reduzida a uma peça por
tipo de serviço, sobre quatro placas, uma para cada camada que uma
requisição atravessa (entrada, identidade, computação, dados). Quanto mais
ao fundo da imagem uma peça está, mais adiante ela fica no caminho. As
contas nos fios são requisições.

Nada tem cor, e a barra superior diz "51 serviços, todos normais". A cor
fica reservada para respostas. Arraste para girar, role para aproximar,
arraste com o botão direito para deslocar; <kbd>R</kbd> redefine a câmera.

### 2. De um tipo a um serviço

Clique nos autorizadores Cedar. Um cartão mostra os três juntos, cada número
com a sua faixa normal, e lista as instâncias por região. Clique em uma
instância: o modelo muda para a disposição por região, com aquele serviço
selecionado. <kbd>Esc</kbd> limpa a seleção. **Visão geral**, **Regiões** e
**Dependências** alternam as disposições.

### 3. Siga uma requisição pelo Cedar

Pressione **Testar uma autorização** na barra superior. Escolha o principal
**Mallory**, a ação **Export ledger** e o recurso **Acme ledger 2026**, e
pressione **Avaliar com o Cedar**. A requisição atravessa o modelo e para nos
autorizadores Cedar: **Negado**, determinado por `forbid-cross-tenant`. O
vermelho marca onde terminou a requisição que você seguiu, não uma falha.
Toda decisão é o que o motor `cedar-policy` devolveu.
[Políticas Cedar](Políticas-Cedar) vai além.

### 4. Inicie um incidente

Pressione **Explorar um incidente** e **Iniciar** ao lado de **DDoS Surge**.
A linha do tempo aparece no pé da tela; ajuste a velocidade para **2×**. O
tráfego suspeito, desenhado como triângulos magenta, sai dos clientes, passa
pelo roteador de borda e chega aos gateways, e os serviços que ele atinge
mudam de estado. O monitor de ameaças emite "Volumetric attack detected", e
então a mitigação contém a inundação no roteador de borda.

### 5. Viaje no tempo

Pressione **Pausar**. Arraste o cursor de reprodução para antes do incidente:
o modelo, os sinais e todos os cartões voltam exatamente àquele momento.
Pressione **Reproduzir** para simular de novo o histórico, bit a bit; a barra
diz **Histórico**. **Rever o incidente** volta ao ponto em que o último
começou, e **Agora** retorna ao agora da simulação.
[Incidentes e linha do tempo](Incidentes-e-linha-do-tempo) explica o que você
vê e como comparar uma mudança.

### Para onde ir depois

| Para                                            | Leia                                             |
| ----------------------------------------------- | ------------------------------------------------ |
| Conhecer cada parte da tela                     | [Usando a interface](Usando-a-interface)         |
| Rodar a simulação com os seus próprios arquivos | [Sua própria plataforma](Sua-própria-plataforma) |
| Ver um incidente real no mesmo modelo           | [Capturas de incidente](Capturas-de-incidente)   |
| Resolver um problema ao rodar o AEGIS           | [Perguntas frequentes](Perguntas-frequentes)     |

## Referência

Os documentos abaixo estão em inglês.

- [`README.md`](https://github.com/cleissonbarbosa/csdt/blob/main/README.md): início rápido
- [`docs/DEMO.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/DEMO.md): o passeio completo
- [`docker-compose.yml`](https://github.com/cleissonbarbosa/csdt/blob/main/docker-compose.yml)
- [`.env.example`](https://github.com/cleissonbarbosa/csdt/blob/main/.env.example): todas as variáveis do servidor
- [`examples/corner-shop/README.md`](https://github.com/cleissonbarbosa/csdt/blob/main/examples/corner-shop/README.md)
- [`apps/web/src/features/help/HelpDialog.tsx`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/features/help/HelpDialog.tsx): os atalhos de teclado
