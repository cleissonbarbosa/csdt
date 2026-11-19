export default {
  // The dialog, and the form that asks for one change.
  'The same scenario, run twice from the same seed on timelines of their own. The second run has one change. The timeline in use is not touched.':
    'O mesmo cenário, executado duas vezes a partir da mesma semente, cada vez em uma linha do tempo própria. A segunda execução tem uma mudança. A linha do tempo em uso não é alterada.',
  Scenario: 'Cenário',
  'The one change in run B': 'A única mudança na execução B',
  'On this service': 'Neste serviço',
  'Multiplied by': 'Multiplicado por',
  'Share that fails, in percent': 'Parcela que falha, em porcentagem',
  'Placed this many seconds into the incident':
    'Aplicada tantos segundos após o início do incidente',
  'From 0 to {last}: the scenario lasts {duration}.': 'De 0 a {last}: o cenário dura {duration}.',
  'Run both': 'Executar as duas',
  'Run both again': 'Executar as duas de novo',
  'Running both…': 'Executando as duas…',
  'No scenario can run on this platform.': 'Nenhum cenário pode ser executado nesta plataforma.',
  'The comparison could not be run.': 'A comparação não pôde ser executada.',
  'A change this form cannot make, such as another service or another connection, is a change to the files: stage them under <a>Platform files</a> and the same incident is run on both platforms.':
    'Uma mudança que este formulário não faz, como mais um serviço ou outra conexão, é uma mudança nos arquivos: prepare-os em <a>Arquivos da plataforma</a> e o mesmo incidente é executado nas duas plataformas.',

  // The kinds of change, and what their figure means.
  'Change its capacity': 'Alterar a capacidade',
  'Above 1 scales the service up; below 1 takes capacity away.':
    'Acima de 1 aumenta a escala do serviço; abaixo de 1 tira capacidade.',
  'Change its latency': 'Alterar a latência',
  'Below 1 makes the service faster; above 1 slower.':
    'Abaixo de 1 deixa o serviço mais rápido; acima de 1, mais lento.',
  'Make a share of its requests fail': 'Fazer falhar uma parcela das requisições',
  'A share of the requests it handles, from 0 to 100.':
    'Uma parcela das requisições que ele atende, de 0 a 100.',
  'Take it out of service': 'Tirar do ar',
  'The service becomes unreachable for the rest of the run.':
    'O serviço fica inacessível pelo resto da execução.',

  // The same change at several figures.
  'Or the same change at several figures (multipliers)':
    'Ou a mesma mudança em vários valores (multiplicadores)',
  'Or the same change at several figures (percentages)':
    'Ou a mesma mudança em vários valores (porcentagens)',
  'Up to {max}, separated by commas. Each is run against the incident as it is.':
    'Até {max}, separados por vírgulas. Cada um é executado contra o incidente como está.',
  'Run them all': 'Executar todas',
  'Running {n} of {total}…': 'Executando {n} de {total}…',

  // What run B changed, and that nothing else did.
  'What changed': 'O que mudou',
  'In run B, <b>{change}</b> on {services}, placed <n>+{at}</n> into the incident and eased in over <n>{ramp}</n>.':
    'Na execução B, <b>{change}</b> em {services}, aplicada em <n>+{at}</n> do incidente e introduzida aos poucos ao longo de <n>{ramp}</n>.',
  'Nothing else differs: both runs are {scenario} on <c>{topology}</c> with seed <n>{seed}</n>.':
    'Nada mais difere: as duas execuções são {scenario} sobre <c>{topology}</c> com a semente <n>{seed}</n>.',
  'Until the change is placed the two runs are identical, sample for sample.':
    'Até a mudança ser aplicada, as duas execuções são idênticas, amostra por amostra.',
  'The two runs differ before the change was placed, which should not happen: do not rely on this comparison.':
    'As duas execuções diferem antes de a mudança ser aplicada, o que não deveria acontecer: não confie nesta comparação.',
  'The exact commands': 'Os comandos exatos',

  // The two runs, measure by measure.
  'as it is': 'como está',
  'with the change': 'com a mudança',
  'B against A': 'B em relação a A',
  'n/a': 'n/d',
  '{n} pts': '{n} p.p.',
  'Services affected': 'Serviços afetados',
  'Error rate at {threshold} or over for': 'Taxa de erro de {threshold} ou mais durante',
  'Latency p95 at {threshold} or over for': 'Latência p95 de {threshold} ou mais durante',
  'Error rate at its objective or over for': 'Taxa de erro no objetivo ou acima dele durante',
  'Latency p95 at its objective or over for': 'Latência p95 no objetivo ou acima dele durante',
  '{time} (objective {threshold})': '{time} (objetivo {threshold})',
  'met throughout': 'cumprido o tempo todo',
  'nothing was affected': 'nada foi afetado',
  'not within the run': 'não durante a execução',
  'the same': 'igual',
  'Affected only in A: {services}.': 'Afetados apenas em A: {services}.',
  'Affected only in B: {services}.': 'Afetados apenas em B: {services}.',

  // The two runs over time.
  'up to {peak}': 'até {peak}',
  '{measure} over both runs. As it is: up to {a}. With the change: up to {b}.':
    '{measure} nas duas execuções. Como está: até {a}. Com a mudança: até {b}.',
  'A, as it is': 'A, como está',
  'B, with the change': 'B, com a mudança',
  'The thin tick is where the incident begins, the thick one where the change is placed. Each run lasts <n>{duration}</n>.':
    'A marca fina é onde o incidente começa; a grossa, onde a mudança é aplicada. Cada execução dura <n>{duration}</n>.',

  // Watching a run on the timeline.
  'Replaces the timeline in use with run B, to play back and scrub':
    'Substitui a linha do tempo em uso pela execução B, para reproduzir e percorrer',
  'Watch run B on the timeline': 'Ver a execução B na linha do tempo',
  'Replaces the timeline in use with run A': 'Substitui a linha do tempo em uso pela execução A',
  'Watch run A': 'Ver a execução A',
  'Watching a run replaces the timeline in use.':
    'Ver uma execução substitui a linha do tempo em uso.',

  // The runs of a sweep, figure by figure.
  '<b>The same change at {n} figures.</b> Each row is a run of its own from the same seed; the first is the incident as it is.#one':
    '<b>A mesma mudança em {n} valor.</b> Cada linha é uma execução à parte, a partir da mesma semente; a primeira é o incidente como está.',
  '<b>The same change at {n} figures.</b> Each row is a run of its own from the same seed; the first is the incident as it is.':
    '<b>A mesma mudança em {n} valores.</b> Cada linha é uma execução à parte, a partir da mesma semente; a primeira é o incidente como está.',
  'The highest error rate was lowest at <n>{figure}</n>.':
    'A maior taxa de erro foi mais baixa em <n>{figure}</n>.',
  Figure: 'Valor',
  '{measure}, up to {peak}': '{measure}, até {peak}',
  '{measure} by figure: {points}': '{measure} por valor: {points}',
  '{measure} by figure: {points}; as it is {baseline}':
    '{measure} por valor: {points}; como está, {baseline}',
  'A dot is a run; the line only joins them. The dashed line is the incident as it is.':
    'Um ponto é uma execução; a linha só os liga. A linha tracejada é o incidente como está.',
} as const satisfies Record<string, string>;
