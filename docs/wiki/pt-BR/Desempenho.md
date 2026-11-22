[English](Performance) · **Português**

Todo número desta página foi medido na máquina e nos programas listados
abaixo, com os comandos mostrados, e vem do
[`docs/PERFORMANCE.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/PERFORMANCE.md)
(em inglês). Nada é estimado. Onde um número não responde à pergunta que você
poderia esperar, isso está dito ao lado dele.

## Condições do teste

|                      |                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Data                 | 2026-11-16 (UTC)                                                                                               |
| CPU                  | AMD Ryzen 5 5600G (6 núcleos / 12 threads)                                                                     |
| GPU                  | NVIDIA GeForce RTX 3050 8 GB, driver 580.178.04, Vulkan 1.4                                                    |
| Sistema              | Ubuntu 24.04.5 LTS, Linux 7.0                                                                                  |
| Navegador            | Chrome 157.0.8103.78 (headless, fora da tela), ANGLE sobre Vulkan                                              |
| Área de visualização | 1920 × 1080, com densidade de pixels 1                                                                         |
| Build                | de produção (`vite build`), feito em 2026-11-16 às 05:25 UTC e servido por `vite preview`; servidor em release |
| Configuração         | qualidade **ultra**, tema claro, câmera em deriva para que cada quadro seja redesenhado por inteiro            |
| Método               | 4 s de aquecimento, depois cada intervalo de `requestAnimationFrame` durante 12 s                              |

> **O que se mede é a disposição que desenha todos os serviços.** O benchmark
> abre a aplicação com `?arrangement=regions`, como um visitante que já veio
> antes. A visão geral, onde a aplicação abre, não foi medida.

A saída bruta desta execução é
[`benchmark-2026-11-16.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-16.json).
A execução anterior, num build mais antigo, está guardada como
[`benchmark-2026-11-15.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-15.json).

## Custo de um quadro

Os quadros foram produzidos com o limite de taxa de quadros e o vsync
desligados (`--disable-frame-rate-limit --disable-gpu-vsync`), então o
intervalo entre quadros é o tempo que leva para produzir um. A interface
também está na tela.

| Cena                    | Serviços / conexões | Backend | Quadro médio |     p95 |     p99 | Quadros/s | Chamadas de desenho | Triângulos | Contas visíveis |
| ----------------------- | ------------------: | ------- | -----------: | ------: | ------: | --------: | ------------------: | ---------: | --------------: |
| Helios · regime estável |             51 / 75 | WebGPU  |      2,30 ms |  3,0 ms |  3,4 ms |       434 |                  28 |     78.973 |           2.330 |
| Helios · surto de DDoS  |             51 / 75 | WebGPU  |      3,11 ms |  3,7 ms |  5,1 ms |       322 |                  28 |     78.971 |           2.933 |
| Stress · regime estável |           178 / 648 | WebGPU  |      2,47 ms |  3,1 ms |  3,8 ms |       405 |                  34 |    260.213 |           2.132 |
| Stress · queda regional |           178 / 648 | WebGPU  |      2,79 ms |  3,5 ms |  5,2 ms |       358 |                  34 |    260.213 |           1.960 |
| Helios · regime estável |             51 / 75 | WebGL 2 |      9,04 ms |  9,9 ms | 10,5 ms |       111 |                  28 |     78.971 |           2.348 |
| Helios · surto de DDoS  |             51 / 75 | WebGL 2 |      9,67 ms | 11,2 ms | 11,8 ms |       103 |                  28 |     78.971 |           2.939 |
| Stress · regime estável |           178 / 648 | WebGL 2 |      9,32 ms | 10,3 ms | 11,4 ms |       107 |                  34 |    260.213 |           2.132 |
| Stress · queda regional |           178 / 648 | WebGL 2 |      9,69 ms | 11,4 ms | 12,3 ms |       103 |                  34 |    260.213 |           1.960 |

- **WebGPU:** 2,7 ms por quadro em média, pior p99 de 5,2 ms, nas quatro cenas
  (322–434 quadros/s).
- **WebGL 2:** 9,4 ms por quadro em média, pior p99 de 12,3 ms (103–111
  quadros/s), rodando os mesmos materiais TSL.
- Uma tela de 60 Hz dá 16,7 ms por quadro. Os dois backends produzem um quadro
  de 1080p dentro desse orçamento, com folga, nesta GPU.
- **A escala quase não pesa.** Ir de 51 serviços e 75 conexões para 178 e 648
  acrescenta 6 chamadas de desenho (28 → 34) e alguns décimos de
  milissegundo, porque cada classe de objeto é um único desenho instanciado.
- **Mais lento que a execução anterior.** No build medido em 2026-11-15, as
  mesmas quatro cenas levavam de 1,7 a 1,9 ms no WebGPU e de 7,0 a 8,1 ms no
  WebGL 2. Desde então as peças foram remodeladas, cada uma com uma parte que
  trabalha, e os nomes passaram a ser desenhados de outro jeito. Quanto da
  diferença vem dos nomes está medido [abaixo](#o-custo-dos-nomes); o resto não
  foi isolado.
- **Há uma única passada.** Sem pós-processamento: sem bloom, sem desfoque,
  sem tone mapping.

## Ritmo dos quadros

Com o ritmo padrão do Chrome, o `requestAnimationFrame` fica limitado aos
60 Hz que o compositor pede, e cada quadro compõe o canvas 3D com a interface
por cima (o modelo, a barra superior e a faixa da linha do tempo). Todas as
cenas mantiveram 60,0–60,1 quadros/s nos dois backends, com pior intervalo p95
de 16,8 ms. A tabela completa está no `docs/PERFORMANCE.md`.

**O que isto não mostra.** Tudo rodou no Chrome headless, que não tem tela. A
tabela de custo é o custo de produzir um quadro; os números de ritmo mostram
a página acompanhando um compositor de 60 Hz. Nenhum dos dois é uma medição de
uma janela visível num monitor, e o projeto não afirma ter uma. Para medir na
sua própria tela, rode o benchmark com `--headed` (veja [Medindo de
novo](#medindo-de-novo)), ou aperte <kbd>P</kbd> na aplicação em execução para
abrir o **Painel de desempenho**.

## O custo dos nomes

Os nomes são desenhados num canvas próprio por cima da cena, para continuarem
nítidos em qualquer resolução de renderização e nunca ficarem um sobre o outro
([Arquitetura](Arquitetura#renderização)). O benchmark foi rodado uma segunda
vez no mesmo build com os nomes desligados
(`--settings '{"labels":false}'`), sem limite de taxa de quadros; a saída bruta
é
[`benchmark-2026-11-16-names-off.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-16-names-off.json).

| Cena                    | Backend | Nomes visíveis | Script por quadro | Quadro com nomes | Quadro sem nomes | Diferença |
| ----------------------- | ------- | -------------: | ----------------: | ---------------: | ---------------: | --------: |
| Helios · regime estável | WebGPU  |              3 |           0,02 ms |          2,30 ms |          1,97 ms |   0,33 ms |
| Helios · surto de DDoS  | WebGPU  |             35 |           0,15 ms |          3,11 ms |          2,21 ms |   0,90 ms |
| Stress · regime estável | WebGPU  |              7 |           0,06 ms |          2,47 ms |          2,12 ms |   0,35 ms |
| Stress · queda regional | WebGPU  |              7 |           0,05 ms |          2,79 ms |          2,38 ms |   0,41 ms |
| Helios · regime estável | WebGL 2 |              3 |           0,07 ms |          9,04 ms |          8,37 ms |   0,67 ms |
| Helios · surto de DDoS  | WebGL 2 |             35 |           0,15 ms |          9,67 ms |          8,56 ms |   1,11 ms |
| Stress · regime estável | WebGL 2 |              7 |           0,08 ms |          9,32 ms |          8,42 ms |   0,90 ms |
| Stress · queda regional | WebGL 2 |              7 |           0,09 ms |          9,69 ms |          8,75 ms |   0,94 ms |

- **Posicionar e desenhar os nomes custa de 0,02 a 0,15 ms de script por
  quadro**, cronometrado pela própria cena (a linha "Names" do painel aberto
  com <kbd>P</kbd>).
- **Um quadro com nomes leva de 0,33 a 1,11 ms a mais que um sem.** O script
  responde por uma fração disso; o resto não foi isolado.
- Com o ritmo padrão do Chrome o custo não aparece: todas as cenas mantêm
  60 quadros/s com os nomes ligados.
- **Não medido:** uma tela mais densa que um pixel do dispositivo por pixel
  CSS, e a visão geral, onde todas as peças têm nome.

## Uma regressão que o benchmark pegou

A primeira execução completa do benchmark, num design visual anterior,
renderizava a cena em cerca de 3 ms, mas com o ritmo padrão todas as cenas
davam só 19–24 quadros/s. Três medições nesse build, em 1080p e qualidade
ultra, isolaram a causa:

| Variante                                       |         WebGPU |        WebGL 2 |
| ---------------------------------------------- | -------------: | -------------: |
| A interface inteira, como era entregue         | 23,7 quadros/s | 21,3 quadros/s |
| A mesma página com `backdrop-filter` desligado | 60,1 quadros/s | 60,1 quadros/s |
| Interface escondida, só o canvas               | 60,0 quadros/s | 60,2 quadros/s |

Os painéis eram translúcidos, com um `backdrop-filter: blur()`, que obriga o
compositor a reamostrar o canvas embaixo deles a cada quadro; nessa
configuração isso custava várias vezes mais que renderizar a cena. O desfoque
foi retirado, e o design atual não tem nenhum: os painéis são papel opaco
([Princípios de design](Princípios-de-design)). Se uma janela visível paga o
mesmo preço não foi medido. A saída bruta é
[`benchmark-2026-11-15-backdrop-blur.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-15-backdrop-blur.json).

## Estabilidade de recursos

Uma única sessão do navegador, com uma coleta de lixo forçada antes de cada
amostra.

**Reconstruções da cena.** A topologia foi trocada entre as duas topologias
embutidas 12 vezes; cada troca descarta e reconstrói toda geometria, material e
textura. As geometrias de GPU ficaram em 19 e as texturas de GPU em 4 depois
de cada reconstrução: nada vaza na GPU. O heap de JS subiu de 15,8 para
18,3 MB ao longo das doze reconstruções, cerca de 0,2 MB por reconstrução.
Buffers de histórico limitados ainda enchendo, e os bitmaps guardados dos
nomes já mostrados, poderiam cada um explicar um crescimento desse tamanho,
mas nenhum dos dois foi isolado, e doze reconstruções são poucas para
descartar um vazamento lento.

**Reprodução repetida.** Um incidente gravado foi carregado e a linha do
tempo foi levada a seis pontos por rodada, durante seis rodadas (36 buscas), a
4×. O heap foi de 17,9 MB para 17,4 MB, subindo um pouco menos a cada rodada
depois da primeira; as geometrias de GPU eram 19 no início e 20 depois de cada
rodada. A mesma ressalva vale.

## Motor da simulação

Uma thread, build de release, enquanto roda um cenário de falha em cascata:

```bash
cargo test --release -p aegis-server --test trace engine_step_cost -- --ignored --nocapture
```

| Topologia         | Serviços / conexões | Um tick | Snapshot (montagem + JSON) | Tamanho do snapshot | Busca aleatória |
| ----------------- | ------------------: | ------: | -------------------------: | ------------------: | --------------: |
| Helios Commerce   |             51 / 75 |   26 µs |                      14 µs |             4,3 KiB |          0,3 ms |
| Hyperscale Stress |           178 / 648 |   41 µs |                      71 µs |            20,8 KiB |          0,5 ms |

A 1× o motor roda 5 ticks por segundo (20 a 4×), então a simulação usa uma
fração de um por cento de um núcleo. Uma busca restaura o checkpoint mais
próximo, tirado a cada 5 segundos virtuais, e refaz no máximo 24 ticks.

## Degradação gradual

O `AdaptiveQuality` desce entre quatro níveis quando o tempo de quadro
suavizado fica acima de 22 ms, e sobe de novo depois de folga sustentada; um
nível que se mostrou caro demais vira o teto. Os níveis mais baixos reduzem a
densidade de pixels, a densidade de contas e a distância em que os nomes
aparecem. Eles não deixam os nomes mais borrados, porque esses são desenhados
na resolução da tela em todos os níveis.

Com renderização por software (SwiftShader WebGL 2, 1280 × 720, qualidade
automática), a cena começou em `high`, desceu para `medium` depois de cerca de
12 s e para `low` depois de cerca de 20 s, e ficou ali, a cerca de
7 quadros/s: o controle reduz o custo de um quadro, mas não deixa rápida uma
máquina sem GPU. A suíte ponta a ponta roda em WebGL 2 por software, fixada no
nível `low`, e passa ali. Com todas as APIs de GPU desligadas, a aplicação
recorre à visualização em tabela, que um teste ponta a ponta também cobre.

## Como a cena continua leve

| Técnica                                                                                                                                            | Onde                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Instanciamento na GPU: um desenho por tipo de serviço, um para todas as conexões, um para todas as contas, um para tudo o que está sobre as placas | `graphics/SceneController.ts`                    |
| Contas sem estado: a animação é função de `time` e de quatro sementes, calculada no vertex shader                                                  | `graphics/materials.ts`                          |
| Textura de dados por conexão: a CPU atualiza uma pequena textura de floats, nunca buffers por conta                                                | `createParticleMaterial`                         |
| Nomes num canvas 2D sobre a cena, posicionados por importância e redesenhados só quando a imagem mudou                                             | `graphics/labelLayer.ts`                         |
| Sem pós-processamento e sem luzes: os materiais fazem o próprio sombreamento, uma passada por quadro                                               | `graphics/materials.ts`                          |
| Nível de detalhe: os rótulos somem com a distância; os níveis de qualidade ajustam densidade de contas e resolução                                 | `graphics/quality.ts`                            |
| Sem React no laço de quadros: as stores são lidas por assinaturas, as listas se limitam a 1 Hz                                                     | `features/scene/SceneCanvas.tsx`, `app/hooks.ts` |
| Snapshots colunares: struct-of-arrays no fio, copiados direto para arrays tipados                                                                  | `domain/telemetry.rs`                            |
| Serializar uma vez, distribuir: cada mensagem do stream é codificada uma só vez para todos os assinantes                                           | `application/service.rs`                         |

## Tempo das suítes de teste

Tempo de relógio na mesma máquina, de cada comando até a sua saída, com os
builds necessários já feitos (as suítes ponta a ponta ainda sobem o próprio
servidor e o próprio preview). As suítes cresceram desde então; o README conta
os testes como estão hoje.

| Suíte                                                                          | Testes |      Tempo |
| ------------------------------------------------------------------------------ | -----: | ---------: |
| Rust (`cargo test --workspace`)                                                |    208 |        6 s |
| Contratos e web (`pnpm test`)                                                  |    454 |       30 s |
| O motor compilado para o navegador, no Node (`pnpm test:engine`)               |     32 |        1 s |
| Ponta a ponta em WebGL 2 por software, mais o recurso sem GPU (`pnpm e2e`)     |     25 | 7 min 52 s |
| Ponta a ponta em WebGPU, GPU real (`AEGIS_E2E_GPU=1`, projeto `chrome-webgpu`) |     24 | 1 min 57 s |
| Ponta a ponta no site estático, sem servidor (`pnpm e2e:static`)               |      7 | 1 min 31 s |

## Medindo de novo

O benchmark sobe o próprio servidor de release na porta 8798 e um build de
produção na porta 4184, para que nada mais mexa na simulação enquanto os
quadros são cronometrados. Ele precisa de um build de release do servidor, de
um build de produção da aplicação web e do Google Chrome.

```bash
cargo build --release -p aegis-server && pnpm build
./scripts/benchmark.sh --out results.json
./scripts/benchmark.sh --headed          # opens a Chrome window for a few minutes
```

| Opção               | O que faz                                                             |
| ------------------- | --------------------------------------------------------------------- |
| `--out <file>`      | Grava os resultados brutos em JSON                                    |
| `--seconds <n>`     | Quanto tempo cada caso é medido (12 por padrão)                       |
| `--headed`          | Mede numa janela visível do Chrome na sua tela, só com o ritmo padrão |
| `--settings <json>` | Sobrescreve configurações na execução, como `'{"labels":false}'`      |

Os números do `docs/PERFORMANCE.md` vêm destes comandos, com a saída bruta do
benchmark commitada em `docs/assets/`; nenhum número é editado à mão.

## Referência

Os documentos e arquivos abaixo estão em inglês.

- [`docs/PERFORMANCE.md`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/PERFORMANCE.md): todas as tabelas acima, completas, com as suas ressalvas
- Saída bruta:
  [`benchmark-2026-11-16.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-16.json),
  [`benchmark-2026-11-16-names-off.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-16-names-off.json),
  [`benchmark-2026-11-15.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-15.json),
  [`benchmark-2026-11-15-backdrop-blur.json`](https://github.com/cleissonbarbosa/csdt/blob/main/docs/assets/benchmark-2026-11-15-backdrop-blur.json)
- [`scripts/benchmark.sh`](https://github.com/cleissonbarbosa/csdt/blob/main/scripts/benchmark.sh) e
  [`apps/web/scripts/benchmark.mjs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/scripts/benchmark.mjs): o benchmark
- [`apps/server/tests/trace.rs`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/server/tests/trace.rs): o microbenchmark do motor
- [`apps/web/src/graphics/quality.ts`](https://github.com/cleissonbarbosa/csdt/blob/main/apps/web/src/graphics/quality.ts): os níveis de qualidade
- [`README.md`](https://github.com/cleissonbarbosa/csdt/blob/main/README.md): "Performance" e "Tests"
