export default {
  // The dialog, and the form that asks for one change.
  'The same scenario, run twice from the same seed on timelines of their own. The second run has one change. The timeline in use is not touched.':
    'O AEGIS executa o mesmo cenário duas vezes, em linhas do tempo separadas e com a mesma semente. A segunda execução tem uma única mudança. A linha do tempo em uso fica intacta.',
  Scenario: 'Cenário',
  'The one change in run B': 'A única mudança na execução B',
  'On this service': 'Serviço que recebe a mudança',
  'Multiplied by': 'Multiplicador',
  'Share that fails, in percent': 'Percentual de requisições que falham',
  'Placed this many seconds into the incident': 'Segundos desde o início do incidente',
  'From 0 to {last}: the scenario lasts {duration}.':
    'Informe de 0 a {last} segundos. O cenário dura {duration}.',
  'Run both': 'Executar as duas',
  'Run both again': 'Executar as duas novamente',
  'Running both…': 'Executando as duas…',
  'No scenario can run on this platform.': 'Nenhum cenário pode ser executado nesta plataforma.',
  'The comparison could not be run.': 'A comparação não pôde ser executada.',
  'A change this form cannot make, such as another service or another connection, is a change to the files: stage them under <a>Platform files</a> and the same incident is run on both platforms.':
    'Para mudanças na topologia, como adicionar um serviço ou uma conexão, selecione os arquivos em <a>Arquivos da plataforma</a> e compare o mesmo incidente nas duas plataformas.',

  // The kinds of change, and what their figure means.
  'Change its capacity': 'Alterar a capacidade',
  'Above 1 scales the service up; below 1 takes capacity away.':
    'Multiplicadores maiores que 1 aumentam a capacidade. Valores menores que 1 a reduzem.',
  'Change its latency': 'Alterar a latência',
  'Below 1 makes the service faster; above 1 slower.':
    'Multiplicadores menores que 1 deixam o serviço mais rápido. Valores maiores que 1 o deixam mais lento.',
  'Make a share of its requests fail': 'Provocar falhas em parte das requisições',
  'A share of the requests it handles, from 0 to 100.':
    'Informe um percentual de 0 a 100 das requisições atendidas pelo serviço.',
  'Take it out of service': 'Tirar do ar',
  'The service becomes unreachable for the rest of the run.':
    'O serviço fica inacessível pelo resto da execução.',

  // The same change at several figures.
  'Or the same change at several figures (multipliers)':
    'Ou teste a mesma mudança com vários multiplicadores',
  'Or the same change at several figures (percentages)':
    'Ou teste a mesma mudança com vários percentuais',
  'Up to {max}, separated by commas. Each is run against the incident as it is.':
    'Informe até {max} valores separados por vírgulas. Cada execução é comparada com o incidente original.',
  'Run them all': 'Executar todas',
  'Running {n} of {total}…': 'Executando {n} de {total}…',

  // What run B changed, and that nothing else did.
  'What changed': 'O que mudou',
  'In run B, <b>{change}</b> on {services}, placed <n>+{at}</n> into the incident and eased in over <n>{ramp}</n>.':
    'Na execução B, a mudança <b>{change}</b> em {services} começa em <n>+{at}</n> e é aplicada gradualmente ao longo de <n>{ramp}</n>.',
  'Nothing else differs: both runs are {scenario} on <c>{topology}</c> with seed <n>{seed}</n>.':
    'Essa é a única diferença. As duas execuções usam o cenário {scenario}, a topologia <c>{topology}</c> e a semente <n>{seed}</n>.',
  'Until the change is placed the two runs are identical, sample for sample.':
    'Até a mudança ser aplicada, as duas execuções são idênticas, amostra por amostra.',
  'The two runs differ before the change was placed, which should not happen: do not rely on this comparison.':
    'As duas execuções diferem antes de a mudança ser aplicada, o que não deveria acontecer: não confie nesta comparação.',
  'The exact commands': 'Os comandos exatos',

  // The two runs, measure by measure.
  'as it is': 'original',
  'with the change': 'com a mudança',
  'B against A': 'B em relação a A',
  'n/a': 'n/d',
  '{n} pts': '{n} p.p.',
  'Services affected': 'Serviços afetados',
  'Error rate at {threshold} or over for': 'Tempo com taxa de erro de {threshold} ou mais',
  'Latency p95 at {threshold} or over for': 'Tempo com latência p95 de {threshold} ou mais',
  'Error rate at its objective or over for': 'Tempo com taxa de erro igual ou superior ao objetivo',
  'Latency p95 at its objective or over for':
    'Tempo com latência p95 igual ou superior ao objetivo',
  '{time} (objective {threshold})': '{time} (objetivo {threshold})',
  'met throughout': 'cumprido o tempo todo',
  'nothing was affected': 'nada foi afetado',
  'not within the run': 'sem recuperação durante a execução',
  'the same': 'igual',
  'Affected only in A: {services}.': 'Afetados apenas em A: {services}.',
  'Affected only in B: {services}.': 'Afetados apenas em B: {services}.',

  // The two runs over time.
  'up to {peak}': 'até {peak}',
  '{measure} over both runs. As it is: up to {a}. With the change: up to {b}.':
    '{measure} nas duas execuções. Cenário original: até {a}. Com a mudança: até {b}.',
  'A, as it is': 'A, cenário original',
  'B, with the change': 'B, com a mudança',
  'The thin tick is where the incident begins, the thick one where the change is placed. Each run lasts <n>{duration}</n>.':
    'A marca fina indica o início do incidente. A marca grossa indica quando a mudança é aplicada. Cada execução dura <n>{duration}</n>.',

  // Watching a run on the timeline.
  'Replaces the timeline in use with run B, to play back and scrub':
    'Substitui a linha do tempo em uso pela execução B para reprodução e navegação',
  'Watch run B on the timeline': 'Ver a execução B na linha do tempo',
  'Replaces the timeline in use with run A': 'Substitui a linha do tempo em uso pela execução A',
  'Watch run A': 'Ver a execução A',
  'Watching a run replaces the timeline in use.':
    'Ao abrir uma execução, ela substitui a linha do tempo em uso.',

  // The runs of a sweep, figure by figure.
  '<b>The same change at {n} figures.</b> Each row is a run of its own from the same seed; the first is the incident as it is.#one':
    '<b>Mudança testada com {n} valor.</b> Cada linha é uma execução separada com a mesma semente. A primeira mostra o incidente original.',
  '<b>The same change at {n} figures.</b> Each row is a run of its own from the same seed; the first is the incident as it is.':
    '<b>A mesma mudança testada com {n} valores.</b> Cada linha é uma execução separada com a mesma semente. A primeira mostra o incidente original.',
  'The highest error rate was lowest at <n>{figure}</n>.':
    'O menor pico da taxa de erro ocorreu com <n>{figure}</n>.',
  Figure: 'Valor',
  '{measure}, up to {peak}': '{measure}, até {peak}',
  '{measure} by figure: {points}': '{measure} por valor: {points}',
  '{measure} by figure: {points}; as it is {baseline}':
    '{measure} por valor: {points}. Cenário original: {baseline}',
  'A dot is a run; the line only joins them. The dashed line is the incident as it is.':
    'Cada ponto representa uma execução. A linha apenas liga os pontos. A linha tracejada representa o incidente original.',

  // Where the platform gives: how much demand it takes.
  'Where the platform gives': 'Limites da plataforma',
  'Asked of the platform at rest, on timelines of their own. Every figure is a run of the engine; the timeline in use is not touched.':
    'Os testes partem da plataforma em repouso e têm linhas do tempo separadas. Cada valor corresponde a uma execução do motor. A linha do tempo em uso fica intacta.',
  'The platform could not be tried.': 'Não foi possível testar a plataforma.',
  'How much traffic it takes': 'Quanto tráfego a plataforma suporta',
  'The demand of every external client is multiplied by the same figure and held, at higher and higher figures until an objective is missed, then between the last that held and the first that did not.':
    'Em cada teste, a demanda de todos os clientes externos é multiplicada pelo mesmo valor e mantida nesse nível. O multiplicador aumenta de um teste para o outro até que um objetivo deixe de ser cumprido. Em seguida, são testados valores entre o último com todos os objetivos cumpridos e o primeiro em que algum objetivo deixou de ser cumprido.',
  'Find the limit': 'Encontrar o limite',
  'Find it again': 'Buscar o limite novamente',
  'Running…': 'Executando…',
  'Every objective is met up to <n>{holds}</n> the ordinary demand, the most that was tried.':
    'Todos os objetivos foram cumpridos até o maior multiplicador testado para a demanda normal (<n>{holds}</n>).',
  'An objective is missed with the demand as it is: there is no room above it.':
    'Mesmo com a demanda normal, um dos objetivos não é cumprido. A plataforma já está sem margem para aumento de demanda.',
  'Every objective is met at <n>{holds}</n> the ordinary demand. At <n>{gives}</n> one is missed: {missed}.':
    'Todos os objetivos foram cumpridos com o multiplicador <n>{holds}</n> aplicado à demanda normal. Com <n>{gives}</n>, um objetivo deixou de ser cumprido ({missed}).',
  'The first service to leave its normal state is {service}, at <n>{factor}</n>: it became {health} <n>{at}</n> after the demand began to rise.':
    'Com o multiplicador <n>{factor}</n>, {service} foi o primeiro serviço a sair do estado normal. Ficou {health} <n>{at}</n> após o início do aumento da demanda.',
  Demand: 'Demanda',
  'Services not normal': 'Serviços fora do normal',
  Objectives: 'Objetivos',
  'missed: {objectives}': 'não cumpridos: {objectives}',
  'error rate': 'taxa de erro',
  'latency p95': 'latência p95',
  'error rate at {threshold} or over': 'taxa de erro de {threshold} ou mais',
  'latency p95 at {threshold} or over': 'latência p95 de {threshold} ou mais',
  'Each row is a run of <n>{duration}</n> from seed <n>{seed}</n>, with the demand of {clients} external client multiplied and held. Nothing is said of the multiples between two rows.':
    'Cada linha mostra uma execução de <n>{duration}</n> com a semente <n>{seed}</n>. A demanda de {clients} cliente externo é multiplicada e mantida no novo nível. Os resultados valem apenas para os multiplicadores testados.',
  'Each row is a run of <n>{duration}</n> from seed <n>{seed}</n>, with the demand of {clients} external clients multiplied and held. Nothing is said of the multiples between two rows.':
    'Cada linha mostra uma execução de <n>{duration}</n> com a semente <n>{seed}</n>. A demanda de {clients} clientes externos é multiplicada e mantida no novo nível. Os resultados valem apenas para os multiplicadores testados.',
  'Replaces the timeline in use with that run, to play back and scrub':
    'Substitui a linha do tempo em uso por essa execução para reprodução e navegação',
  'Watch the run at {factor} on the timeline': 'Ver a execução com {factor} na linha do tempo',

  // Where the platform gives: what each service takes with it.
  'What each service takes with it': 'Impacto de tirar cada serviço do ar',
  'Every service is made unreachable in turn, as trying that fault on its card does, and the others that leave their normal state are counted.':
    'O teste tira um serviço do ar por vez, como no experimento disponível no cartão do serviço, e conta quantos outros saem do estado normal.',
  'Try every service': 'Testar todos os serviços',
  'Try them again': 'Testar novamente',
  'No service takes another out of its normal state when it is out.':
    'Em cada teste, os demais serviços permaneceram no estado normal.',
  '<e>{n} service</e> was taken out in turn, the platform otherwise at rest. The one that takes the most others with it is first.':
    'O teste tirou <e>{n} serviço</e> do ar a partir da plataforma em repouso. O primeiro da lista é o que afetou o maior número de outros serviços.',
  '<e>{n} services</e> were taken out in turn, the platform otherwise at rest. The one that takes the most others with it is first.':
    'Os testes tiraram <e>{n} serviços</e> do ar, um por vez, a partir da plataforma em repouso. O primeiro da lista é o que afetou o maior número de outros serviços.',
  'With this service out': 'Com este serviço fora do ar',
  'Others not normal': 'Outros serviços fora do normal',
  'Show this service on the model': 'Mostrar este serviço no modelo',
  'first {service}, <n>{at}</n> later': 'primeiro {service}, <n>{at}</n> depois',
  'Show the first {n} only': 'Mostrar só os {n} primeiros',
  'Each row is what trying that one fault gives: a run of <n>{duration}</n> from seed <n>{seed}</n> with the service unreachable. A service is counted because the engine recorded it leaving its normal state.':
    'Cada linha mostra uma execução de <n>{duration}</n> com a semente <n>{seed}</n> e o serviço fora do ar. A contagem inclui outros serviços cuja saída do estado normal foi registrada pelo motor.',

  // A comparison as text, to take away.
  'Copy this comparison as plain text': 'Copiar esta comparação como texto simples',
  '{label}: A {a}; B {b}; B against A {delta}': '{label}: A {a}; B {b}; B em relação a A {delta}',
  '{label}: A {a}; B {b}': '{label}: A {a}; B {b}',
  '{scenario}: the same incident twice, with one change':
    '{scenario}: o mesmo incidente duas vezes, com uma mudança',
  'In run B, {change} on {services}, placed +{at} into the incident and eased in over {ramp}.':
    'Na execução B, a mudança {change} em {services} começa em +{at} e é aplicada gradualmente ao longo de {ramp}.',
  'Nothing else differs: both runs are {scenario} on {topology} with seed {seed}.':
    'Essa é a única diferença. As duas execuções usam o cenário {scenario}, a topologia {topology} e a semente {seed}.',
  'The two runs (A as it is, B with the change)':
    'As duas execuções (A com o cenário original, B com a mudança)',
} as const satisfies Record<string, string>;
