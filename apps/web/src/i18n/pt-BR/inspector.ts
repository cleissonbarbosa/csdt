export default {
  // The list of services and its filters.
  'Search services': 'Buscar serviços',
  'Search services by name, type or region': 'Buscar serviços por nome, tipo ou região',
  Filter: 'Filtrar',
  'Filter ({n})': 'Filtrar ({n})',
  State: 'Estado',
  'Affected by the incident': 'Afetados pelo incidente',
  'Kind of service': 'Tipo de serviço',
  '{shown} of {total} services': '{shown} de {total} serviços',
  'Infrastructure by region': 'Infraestrutura por região',
  'Show all regions': 'Mostrar todas as regiões',
  'Show only this region': 'Mostrar só esta região',
  '{shown} of {total}': '{shown} de {total}',
  'Frame {region}': 'Enquadrar {region}',

  // The platform, with nothing selected.
  Loading: 'Carregando',
  'Close the overview': 'Fechar a visão geral',
  Signals: 'Sinais',
  'Needs attention': 'Requer atenção',
  ', severity {severity}': ', gravidade {severity}',
  'Show these events': 'Mostrar estes eventos',
  '{n} services changed state': '{n} serviços mudaram de estado',
  'Nothing needs attention.': 'Nada requer atenção.',
  '{percent} errors': '{percent} de erros',
  'Platform figures': 'Números da plataforma',
  'Average latency': 'Latência média',
  'Latency p99': 'Latência p99',
  'Authorization checks': 'Verificações de autorização',
  'per s': 'por s',
  'Checks denied': 'Verificações negadas',
  'Rejected at the edge': 'Rejeitado na borda',
  'Suspicious traffic': 'Tráfego suspeito',

  // The card of a service.
  '{kind} in {region}': '{kind} em {region}',
  'Focus camera on this service': 'Focar a câmera neste serviço',
  'Clear selection': 'Limpar a seleção',
  'Synthetic data': 'Dados sintéticos',
  'Capture data': 'Dados de captura',
  'Live data': 'Dados ao vivo',
  Throughput: 'Vazão',
  'Throughput over the last 90 seconds': 'Vazão nos últimos 90 segundos',
  'Latency over the last 90 seconds': 'Latência nos últimos 90 segundos',
  'Error rate over the last 90 seconds': 'Taxa de erro nos últimos 90 segundos',
  'Backlog {n} messages': 'Acúmulo de {n} mensagens',
  'Capacity {n} req/s': 'Capacidade de {n} req/s',
  'No capacity limit': 'Sem limite de capacidade',
  'Last {seconds} s; the grey band is the normal range. Baseline latency <n>{latency}</n>.':
    'Últimos {seconds} s; a área cinza é a faixa normal. Latência de referência <n>{latency}</n>.',
  ', cross-region': ', entre regiões',
  'Inspect connection to {service}': 'Inspecionar a conexão com {service}',
  'Called by': 'Chamado por',
  'This service calls nothing.': 'Este serviço não chama nada.',
  'Nothing calls this service.': 'Nada chama este serviço.',
  'Authorization decisions': 'Decisões de autorização',

  // The card of a connection.
  'Connection over {protocol}': 'Conexão via {protocol}',
  'Connection over {protocol}, between regions': 'Conexão via {protocol}, entre regiões',
  From: 'De',
  To: 'Para',
  'Network latency': 'Latência de rede',
  'Calls per request': 'Chamadas por requisição',

  // The card of a kind of service, on the overview.
  '{kind} in the {layer} layer': '{kind} na camada de {layer}',
  '{n} {kinds} in the {layer} layer': '{n} {kinds} na camada de {layer}',
  'Not normal': 'Fora do normal',
  '{unwell} of {total} not normal': '{unwell} de {total} fora do normal',
  'Fullest instance': 'Instância mais saturada',
  'Last {seconds} s; the grey band is the normal range.':
    'Últimos {seconds} s; a área cinza é a faixa normal.',
  'All of them together, last {seconds} s; the grey band is the normal range.':
    'Todos juntos, últimos {seconds} s; a área cinza é a faixa normal.',
  Checks: 'Verificações',
  'The service': 'O serviço',
  Instances: 'Instâncias',
  'Open this service where it stands': 'Abrir este serviço onde ele está',

  // What a service is exposed to: read from the topology, nothing simulated.
  Exposure: 'Exposição',
  'Were this service taken over: what its connections lead to, and how it is reached. Read from the topology; nothing is simulated.':
    'Se este serviço fosse comprometido: a que levam suas conexões e como ele é alcançado. Lido da topologia; nada é simulado.',
  'It opens no connection: nothing is reached from it.':
    'Não abre nenhuma conexão: nada é alcançado a partir dele.',
  'It reaches {n} service.': 'Alcança {n} serviço.',
  'It reaches {n} services.': 'Alcança {n} serviços.',
  'It reaches {n} service, {stores} of them a store of data.':
    'Alcança {n} serviço, {stores} deles um repositório de dados.',
  'It reaches {n} services, {stores} of them a store of data.':
    'Alcança {n} serviços, {stores} deles um repositório de dados.',
  'It reaches {n} services, {stores} of them stores of data.':
    'Alcança {n} serviços, {stores} deles repositórios de dados.',
  'and {n} more': 'e mais {n}',
  fewer: 'menos',
  'Kept in front on the model': 'Mantidos à frente no modelo',
  'Keep them in front on the model': 'Mantê-los à frente no modelo',
  'No connection leads to it.': 'Nenhuma conexão leva a ele.',
  '{n} service leads to it.': '{n} serviço leva a ele.',
  '{n} services lead to it.': '{n} serviços levam a ele.',
  '{n} service leads to it, none of them from outside the platform.':
    '{n} serviço leva a ele, nenhum de fora da plataforma.',
  '{n} services lead to it, none of them from outside the platform.':
    '{n} serviços levam a ele, nenhum deles de fora da plataforma.',
  'The shortest way in from outside, {n} connection:':
    'O caminho mais curto de fora, com {n} conexão:',
  'The shortest way in from outside, {n} connections:':
    'O caminho mais curto de fora, com {n} conexões:',
  then: 'depois',
  'What Cedar guards here': 'O que o Cedar protege aqui',
  'Requests for a <code>{type}</code> end at this service. Of the {asked} the catalogue describes, Cedar allows {allowed}, to {principals} of {total} principals.':
    'Requisições a um <code>{type}</code> terminam neste serviço. Das {asked} que o catálogo descreve, o Cedar permite {allowed}, a {principals} de {total} principais.',
  'Under every policy in force and an empty context.':
    'Sob todas as políticas em vigor e um contexto vazio.',

  // Faults placed by hand, and tried first.
  Faults: 'Falhas',
  'Hold this service away from normal, outside any scenario. A fault stays until it is lifted or the simulation is reset.':
    'Mantenha este serviço fora do normal, independentemente de qualquer cenário. Uma falha permanece até ser retirada ou até a simulação ser reiniciada.',
  'Hold this connection away from normal, outside any scenario. A fault stays until it is lifted or the simulation is reset.':
    'Mantenha esta conexão fora do normal, independentemente de qualquer cenário. Uma falha permanece até ser retirada ou até a simulação ser reiniciada.',
  'Faults on this service': 'Falhas neste serviço',
  'Faults on this connection': 'Falhas nesta conexão',
  'Try one first, without placing it': 'Experimentar uma antes, sem aplicá-la',
  'Trying…': 'Experimentando…',
  'Choose a fault to try…': 'Escolha uma falha para experimentar…',
  'Not tried: {reason}': 'Não experimentada: {reason}',
  'The trial could not be run.': 'Não foi possível experimentar a falha.',
  'Tried, not placed: {fault}': 'Experimentada, não aplicada: {fault}',
  'No service leaves normal in {time}.': 'Nenhum serviço sai do normal em {time}.',
  '{n} service leaves normal within {time}.': '{n} serviço sai do normal em até {time}.',
  '{n} services leave normal within {time}.': '{n} serviços saem do normal em até {time}.',
  'up to {peak} <dim>from {before}</dim>': 'até {peak} <dim>a partir de {before}</dim>',
  'Show all {n}': 'Mostrar todos os {n}',
  'Place it': 'Aplicar',
  'Put this away': 'Fechar',
  'Simulated from the platform at rest, on a timeline of its own. The one in use was not touched.':
    'Simulado a partir da plataforma em repouso, numa linha do tempo própria. A que está em uso não foi alterada.',
  Lift: 'Retirar',

  // A fault in a few words, as a button and the timeline say it.
  'demand {factor}': 'demanda {factor}',
  'capacity {factor}': 'capacidade {factor}',
  'latency {factor}': 'latência {factor}',
  '{share} of requests fail': '{share} das requisições falham',
  unreachable: 'inacessível',
  'calls {factor}': 'chamadas {factor}',
  'network latency {factor}': 'latência de rede {factor}',
  '{share} of calls fail': '{share} das chamadas falham',
  '{share} of traffic moved': '{share} do tráfego desviado',
  'Unknown service': 'Serviço desconhecido',
  'Unknown connection': 'Conexão desconhecida',
} as const satisfies Record<string, string>;
