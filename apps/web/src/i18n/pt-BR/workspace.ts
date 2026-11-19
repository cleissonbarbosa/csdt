export default {
  // The files in use, and where they came from.
  'Platform files': 'Arquivos da plataforma',
  'The platform, its incidents and its Cedar policies are read from files. Yours can take their place. What is shown stays a simulation of whatever they describe.':
    'A plataforma, seus incidentes e suas políticas Cedar são lidos de arquivos. Os seus podem ocupar o lugar deles. O que é mostrado continua sendo uma simulação do que quer que eles descrevam.',
  'In use': 'Em uso',
  'The platform that ships with AEGIS.': 'A plataforma que vem com o AEGIS.',
  'The workspace this server was started with.':
    'O espaço de trabalho com que este servidor foi iniciado.',
  'From them: <c>{parts}</c>.': 'Vêm deles: <c>{parts}</c>.',
  'Save as one file': 'Salvar como um só arquivo',
  'Return to {started}': 'Voltar para {started}',

  // What a set of files amounts to.
  '{n} platform': '{n} plataforma',
  '{n} platforms': '{n} plataformas',
  '{n} service': '{n} serviço',
  '{n} services': '{n} serviços',
  '{n} scenario': '{n} cenário',
  '{n} scenarios': '{n} cenários',
  '{n} recording': '{n} gravação',
  '{n} recordings': '{n} gravações',
  '{n} Cedar policy': '{n} política Cedar',
  '{n} Cedar policies': '{n} políticas Cedar',
  'Cedar denies {share} of ordinary requests': 'O Cedar nega {share} das requisições comuns',
  '{n} scenario cannot run on a platform': '{n} cenário não pode ser executado em uma plataforma',
  '{n} scenarios cannot run on a platform':
    '{n} cenários não podem ser executados em uma plataforma',
  '<c>{scenario}</c> on <c>{topology}</c>: {reason}':
    '<c>{scenario}</c> sobre <c>{topology}</c>: {reason}',
  'Not read: <c>{files}</c>': 'Não lidos: <c>{files}</c>',

  // Importing.
  'Importing is switched off on this server (<c>AEGIS_IMPORT=off</c>). Files can still be saved from here and given to it when it starts, with <c>AEGIS_WORKSPACE</c>.':
    'A importação está desligada neste servidor (<c>AEGIS_IMPORT=off</c>). Ainda é possível salvar os arquivos daqui e entregá-los a ele quando iniciar, com <c>AEGIS_WORKSPACE</c>.',
  Import: 'Importar',
  'A topology, scenarios, recordings, Cedar policies, entities, a catalogue, a whole workspace folder, or a file saved from here. Each kind of file you add replaces that part of {started}; the rest stays. A Compose file (<c>.yml</c>) is read as a topology: its services and what each depends on are taken from it, and its traffic and latencies, which it does not state, are defaults.':
    'Uma topologia, cenários, gravações, políticas Cedar, entidades, um catálogo, uma pasta inteira de espaço de trabalho ou um arquivo salvo daqui. Cada tipo de arquivo que você adiciona substitui essa parte; o resto continua sendo {started}. Um arquivo Compose (<c>.yml</c>) é lido como uma topologia: seus serviços e aquilo de que cada um depende são tirados dele, e seu tráfego e suas latências, que ele não informa, são valores padrão.',
  'Choose files': 'Escolher arquivos',
  'Choose a folder': 'Escolher uma pasta',
  'or drop them here': 'ou solte-os aqui',
  'Files to import': 'Arquivos para importar',
  'Folder to import': 'Pasta para importar',
  'Start from the files in use, to add to them':
    'Partir dos arquivos em uso, para acrescentar a eles',

  // A file left out, and why.
  'Left out: {files}': 'Deixados de fora: {files}',
  'not a .json, .cedar, .cedarschema or Compose (.yml) file':
    'não é um arquivo .json, .cedar, .cedarschema ou Compose (.yml)',
  'larger than {size}': 'maior que {size}',
  'would take the import past {size}': 'faria a importação passar de {size}',
  'more than {n} files': 'mais de {n} arquivos',
  'could not be read': 'não pôde ser lido',

  // The files staged, and what applying them would give.
  'Remove {file}': 'Remover {file}',
  'These files are valid. Applying them gives:':
    'Estes arquivos são válidos. Aplicá-los resulta em:',
  'These files are not a valid workspace.':
    'Estes arquivos não formam um espaço de trabalho válido.',
  Apply: 'Aplicar',
  'Applying starts a new timeline for everyone connected.':
    'Aplicar inicia uma nova linha do tempo para todos que estão conectados.',

  // What Cedar would decide differently.
  'What would Cedar decide differently?': 'O que o Cedar decidiria de outra forma?',
  'The policies in use and these are both asked every request; nothing is applied.':
    'Cada requisição é feita às políticas em uso e a estas; nada é aplicado.',
  'Compare with what is in use': 'Comparar com o que está em uso',
  'Comparing…': 'Comparando…',
  'Compare again': 'Comparar de novo',
  'The files could not be compared.': 'Os arquivos não puderam ser comparados.',
  'Cedar would decide some requests differently.':
    'O Cedar decidiria algumas requisições de outra forma.',
  'Cedar would decide every request it is asked here the same as now.':
    'O Cedar decidiria toda requisição feita aqui da mesma forma que agora.',
  'Added: {policies}': 'Adicionadas: {policies}',
  'Removed: {policies}': 'Removidas: {policies}',
  'Changed in meaning: {policies}': 'Com o sentido alterado: {policies}',
  'What they are evaluated over': 'Sobre o que elas são avaliadas',
  'The entity store is another one.': 'O armazenamento de entidades é outro.',
  'The catalogue of principals, actions and requests changed.':
    'O catálogo de principais, ações e requisições mudou.',
  'Ordinary traffic': 'Tráfego comum',
  'Cedar denies <n>{candidate}</n> of ordinary authorization requests, where it now denies <n>{base}</n>.':
    'O Cedar nega <n>{candidate}</n> das requisições de autorização comuns, enquanto agora nega <n>{base}</n>.',
  'Catalogued requests decided differently: {n} of {total}':
    'Requisições catalogadas decididas de outra forma: {n} de {total}',
  becomes: 'passa a ser',
  '<c>{id}</c> (a scenario request); was decided by {policies}':
    '<c>{id}</c> (uma requisição de cenário); era decidida por {policies}',
  '<c>{id}</c>; was decided by {policies}': '<c>{id}</c>; era decidida por {policies}',
  '<c>{id}</c> (a scenario request)': '<c>{id}</c> (uma requisição de cenário)',
  'and {n} more': 'e mais {n}',
  'Scenario traffic': 'Tráfego dos cenários',
  'In <c>{scenario}</c> on <c>{topology}</c>, “{flow}” would stop at the authorizer; it now reaches its resource.':
    'Em <c>{scenario}</c> sobre <c>{topology}</c>, “{flow}” pararia no autorizador; agora chega ao seu recurso.',
  'In <c>{scenario}</c> on <c>{topology}</c>, “{flow}” would reach its resource; it now stops at the authorizer.':
    'Em <c>{scenario}</c> sobre <c>{topology}</c>, “{flow}” chegaria ao seu recurso; agora para no autorizador.',
  'Scenarios that can run': 'Cenários que podem ser executados',
  '<c>{scenario}</c> on <c>{topology}</c> could run, which it cannot now.':
    '<c>{scenario}</c> sobre <c>{topology}</c> poderia ser executado, o que agora não pode.',
  '<c>{scenario}</c> on <c>{topology}</c> could no longer run: {reason}.':
    '<c>{scenario}</c> sobre <c>{topology}</c> não poderia mais ser executado: {reason}.',
  'Every request the tracer can build': 'Toda requisição que o rastreador pode montar',
  'Of <n>{compared}</n> requests ({principals} principals, {actions} actions, {resources} resources, {contexts} contexts), <n>{allowToDeny}</n> go from allow to deny and <n>{denyToAllow}</n> from deny to allow.':
    'De <n>{compared}</n> requisições ({principals} principais, {actions} ações, {resources} recursos, {contexts} contextos), <n>{allowToDeny}</n> passam de permitida a negada e <n>{denyToAllow}</n> de negada a permitida.',
  'Of <n>{compared}</n> requests ({principals} principals, {actions} actions, {resources} resources, {contexts} contexts), <n>{allowToDeny}</n> go from allow to deny and <n>{denyToAllow}</n> from deny to allow; {attribution} keep their decision but are decided by other policies.':
    'De <n>{compared}</n> requisições ({principals} principais, {actions} ações, {resources} recursos, {contexts} contextos), <n>{allowToDeny}</n> passam de permitida a negada e <n>{denyToAllow}</n> de negada a permitida; {attribution} mantêm a decisão, mas são decididas por outras políticas.',
  'in every context': 'em todos os contextos',
  'under {contexts}': 'sob {contexts}',
  '<e>{principal} → {action} on {resource}</e>, {where}':
    '<e>{principal} → {action} em {resource}</e>, {where}',
  '<e>{principal} → {action} on {resource}</e>, {where}; now decided by {now}':
    '<e>{principal} → {action} em {resource}</e>, {where}; agora decidida por {now}',
  '<e>{principal} → {action} on {resource}</e>, {where}; would be decided by {then}':
    '<e>{principal} → {action} em {resource}</e>, {where}; seria decidida por {then}',
  '<e>{principal} → {action} on {resource}</e>, {where}; now decided by {now}; would be decided by {then}':
    '<e>{principal} → {action} em {resource}</e>, {where}; agora decidida por {now}; seria decidida por {then}',

  // One scenario on the platform in use and on the one the files describe.
  'How would an incident go on each?': 'Como um incidente correria em cada uma?',
  'One scenario is run on the platform in use and on the one these files describe, from the same seed, on timelines of their own; nothing is applied.':
    'Um cenário é executado na plataforma em uso e na que estes arquivos descrevem, a partir da mesma semente, em linhas do tempo próprias; nada é aplicado.',
  'Platform of the files': 'Plataforma dos arquivos',
  'No scenario can be run on both: it has to be in use and among these files, and able to run on each platform.':
    'Nenhum cenário pode ser executado nas duas: ele precisa estar em uso e entre estes arquivos, e poder ser executado em cada plataforma.',
  'What differs': 'O que difere',
  'A is <e>{base}</e>, in use ({services}). B is <e>{candidate}</e>, as these files describe it ({others}).':
    'A é <e>{base}</e>, em uso ({services}). B é <e>{candidate}</e>, como estes arquivos a descrevem ({others}).',
  'Both runs are {scenario} with seed <n>{seed}</n>, begun at the same moment.':
    'As duas execuções são {scenario} com a semente <n>{seed}</n>, iniciadas no mesmo instante.',
  'The files describe the platform in use as it is and Cedar answers the same, so the two runs are one run.':
    'Os arquivos descrevem a plataforma em uso tal como ela é e o Cedar responde da mesma forma; por isso as duas execuções são uma só.',
  'The files describe the platform in use as it is.':
    'Os arquivos descrevem a plataforma em uso tal como ela é.',
  'Services added': 'Serviços adicionados',
  'Services removed': 'Serviços removidos',
  'Services described differently': 'Serviços descritos de outra forma',
  'Connections added': 'Conexões adicionadas',
  'Connections removed': 'Conexões removidas',
  'Connections described differently': 'Conexões descritas de outra forma',
  'Regions added': 'Regiões adicionadas',
  'Regions removed': 'Regiões removidas',
  'Regions described differently': 'Regiões descritas de outra forma',
  Roles: 'Funções',
  'not stated': 'não informado',
  '<c>{role}</c> names nothing; in use it names <c>{other}</c>.':
    '<c>{role}</c> não aponta para nada; em uso, aponta para <c>{other}</c>.',
  '<c>{role}</c> names <c>{target}</c>; nothing has that role in use.':
    '<c>{role}</c> aponta para <c>{target}</c>; em uso, nada tem essa função.',
  '<c>{role}</c> names <c>{target}</c>; in use it names <c>{other}</c>.':
    '<c>{role}</c> aponta para <c>{target}</c>; em uso, aponta para <c>{other}</c>.',
  'Cedar also answers the simulation differently under these files; the comparison of decisions above says where.':
    'O Cedar também responde à simulação de outra forma com estes arquivos; a comparação de decisões acima diz onde.',
  'What follows without being stated': 'O que decorre sem estar escrito',
  'Where a file states no capacity, the model sizes the service from its load at rest, and that load is another on B.':
    'Onde um arquivo não informa a capacidade, o modelo dimensiona o serviço pela carga dele em repouso, e essa carga é outra em B.',
  'Capacity the model works with': 'Capacidade com que o modelo trabalha',
  '<n>{base}</n> req/s in A, <n>{candidate}</n> req/s in B':
    '<n>{base}</n> req/s em A, <n>{candidate}</n> req/s em B',
  'The scenario is one file, yet it prescribes something else on B: a role names another service there, or a rate is written as a share of a capacity that is another.':
    'O cenário é um só arquivo, mas prescreve outra coisa em B: lá uma função aponta para outro serviço, ou uma taxa está escrita como parte de uma capacidade que é outra.',
  'What the scenario prescribes': 'O que o cenário prescreve',
  nothing: 'nada',
  'Two runs do not say which of these differences an outcome follows from. To see what one of them does, change that one alone.':
    'Duas execuções não dizem de qual destas diferenças um resultado decorre. Para ver o que uma delas faz, mude apenas essa.',
  'in use': 'em uso',
  'with these files': 'com estes arquivos',
  '{measure} over both runs. In use: up to {a}. With these files: up to {b}.':
    '{measure} nas duas execuções. Em uso: até {a}. Com estes arquivos: até {b}.',
  'A, in use': 'A, em uso',
  'B, with these files': 'B, com estes arquivos',
  'The tick is where the incident begins. Each run lasts <n>{duration}</n>.':
    'A marca é onde o incidente começa. Cada execução dura <n>{duration}</n>.',
  'Applies the files, then puts run B on the timeline, to play back and scrub':
    'Aplica os arquivos e depois põe a execução B na linha do tempo, para reproduzir e percorrer',
  'Apply these files and watch run B': 'Aplicar estes arquivos e ver a execução B',
  'Either replaces the timeline in use, for everyone connected.':
    'Qualquer uma das duas substitui a linha do tempo em uso, para todos que estão conectados.',

  // Integrations.
  Integrations: 'Integrações',
  'Demo Mode needs none of these. Each one is opt-in, and every piece of data is labelled with where it came from.':
    'O modo de demonstração não precisa de nenhuma delas. Cada uma é opcional, e todo dado traz o rótulo de onde veio.',
  Unavailable: 'Indisponível',
  'Built-in simulation': 'Simulação embutida',
  'Live adapter': 'Adaptador ao vivo',
  'Not configured': 'Não configurado',
  Available: 'Disponível',
  Connecting: 'Conectando',
  Connected: 'Conectado',
  Repository: 'Repositório',
  '(opens in a new tab)': '(abre em uma nova aba)',
  'Verified interface': 'Interface verificada',
  Target: 'Alvo',
  'Set AEGIS_CEDAR_AGENT_URL on the server (for example http://127.0.0.1:8180) and restart it.':
    'Defina AEGIS_CEDAR_AGENT_URL no servidor (por exemplo, http://127.0.0.1:8180) e reinicie-o.',
  'Set AEGIS_RINHA_URL on the server (for example http://127.0.0.1:9999) and restart it.':
    'Defina AEGIS_RINHA_URL no servidor (por exemplo, http://127.0.0.1:9999) e reinicie-o.',
  'Not configured on the server.': 'Não configurado no servidor.',
  Disconnect: 'Desconectar',
  'Working…': 'Trabalhando…',
  Connect: 'Conectar',
} as const satisfies Record<string, string>;
