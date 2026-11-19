export default {
  // The files in use, and where they came from.
  'Platform files': 'Arquivos da plataforma',
  'The platform, its incidents and its Cedar policies are read from files. Yours can take their place. What is shown stays a simulation of whatever they describe.':
    'Os arquivos definem a plataforma, os incidentes e as políticas Cedar. Você pode importar seus próprios arquivos, e a simulação passa a usar o que eles descrevem.',
  'In use': 'Em uso',
  'The platform that ships with AEGIS.': 'A plataforma que vem com o AEGIS.',
  'The workspace this server was started with.':
    'O espaço de trabalho com que este servidor foi iniciado.',
  'From them: <c>{parts}</c>.': 'Esses arquivos fornecem <c>{parts}</c>.',
  'Save as one file': 'Salvar em um único arquivo',
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
    '<c>{scenario}</c> em <c>{topology}</c>: {reason}',
  'Not read: <c>{files}</c>': 'Arquivos não lidos: <c>{files}</c>',

  // Importing.
  'Importing is switched off on this server (<c>AEGIS_IMPORT=off</c>). Files can still be saved from here and given to it when it starts, with <c>AEGIS_WORKSPACE</c>.':
    'A importação está desativada neste servidor (<c>AEGIS_IMPORT=off</c>). Você ainda pode salvar os arquivos nesta tela e usar <c>AEGIS_WORKSPACE</c> para carregá-los na inicialização do servidor.',
  Import: 'Importar',
  'A topology, scenarios, recordings, Cedar policies, entities, a catalogue, a whole workspace folder, or a file saved from here. Each kind of file you add replaces that part of {started}; the rest stays. A Compose file (<c>.yml</c>) is read as a topology: its services and what each depends on are taken from it, and its traffic and latencies, which it does not state, are defaults.':
    'Você pode importar uma topologia, cenários, gravações, políticas Cedar, entidades, um catálogo, uma pasta completa do espaço de trabalho ou um arquivo salvo nesta tela. A importação usa {started} como base e substitui apenas as partes correspondentes aos tipos de arquivo adicionados. Ao importar um arquivo Compose (<c>.yml</c>), o AEGIS monta a topologia com os serviços e as dependências do arquivo. O tráfego e as latências seguem valores padrão.',
  'Choose files': 'Escolher arquivos',
  'Choose a folder': 'Escolher uma pasta',
  'or drop them here': 'ou arraste para cá',
  'Files to import': 'Arquivos para importar',
  'Folder to import': 'Pasta para importar',
  'Start from the files in use, to add to them':
    'Usar os arquivos em uso como base para a importação',

  // A file left out, and why.
  'Left out: {files}': 'Arquivos ignorados: {files}',
  'not a .json, .cedar, .cedarschema or Compose (.yml) file':
    'não é um arquivo .json, .cedar, .cedarschema ou Compose (.yml)',
  'larger than {size}': 'maior que {size}',
  'would take the import past {size}': 'excederia o limite de {size} por importação',
  'more than {n} files': 'mais de {n} arquivos',
  'could not be read': 'não pôde ser lido',

  // The files staged, and what applying them would give.
  'Remove {file}': 'Remover {file}',
  'These files are valid. Applying them gives:':
    'Os arquivos são válidos. Veja o que será carregado ao aplicá-los:',
  'These files are not a valid workspace.':
    'Estes arquivos não formam um espaço de trabalho válido.',
  Apply: 'Aplicar',
  'Applying starts a new timeline for everyone connected.':
    'Ao aplicar os arquivos, uma nova linha do tempo será iniciada para todos que estiverem conectados.',

  // What Cedar would decide differently.
  'What would Cedar decide differently?': 'Quais decisões do Cedar mudariam?',
  'The policies in use and these are both asked every request; nothing is applied.':
    'O Cedar avalia cada requisição com as políticas em uso e com as selecionadas. A comparação mantém os arquivos em uso.',
  'Compare with what is in use': 'Comparar com os arquivos em uso',
  'Comparing…': 'Comparando…',
  'Compare again': 'Comparar de novo',
  'The files could not be compared.': 'Os arquivos não puderam ser comparados.',
  'Cedar would decide some requests differently.':
    'O Cedar mudaria a decisão para algumas requisições.',
  'Cedar would decide every request it is asked here the same as now.':
    'O Cedar manteria a mesma decisão para todas as requisições avaliadas.',
  'Added: {policies}': 'Adicionadas: {policies}',
  'Removed: {policies}': 'Removidas: {policies}',
  'Changed in meaning: {policies}': 'Com mudança de significado: {policies}',
  'What they are evaluated over': 'Dados usados na avaliação das políticas',
  'The entity store is another one.': 'O conjunto de entidades mudou.',
  'The catalogue of principals, actions and requests changed.':
    'O catálogo de principais, ações e requisições mudou.',
  'Ordinary traffic': 'Tráfego comum',
  'Cedar denies <n>{candidate}</n> of ordinary authorization requests, where it now denies <n>{base}</n>.':
    'Com os arquivos selecionados, o Cedar negaria <n>{candidate}</n> das requisições comuns de autorização. Com os arquivos em uso, nega <n>{base}</n>.',
  'Catalogued requests decided differently: {n} of {total}':
    'Requisições do catálogo com mudança de decisão: {n} de {total}',
  becomes: 'passa a ser',
  '<c>{id}</c> (a scenario request); was decided by {policies}':
    '<c>{id}</c> (requisição de cenário). Políticas que determinaram a decisão: {policies}',
  '<c>{id}</c>; was decided by {policies}':
    '<c>{id}</c>. Políticas que determinaram a decisão: {policies}',
  '<c>{id}</c> (a scenario request)': '<c>{id}</c> (uma requisição de cenário)',
  'and {n} more': 'e mais {n}',
  'Scenario traffic': 'Tráfego dos cenários',
  'In <c>{scenario}</c> on <c>{topology}</c>, “{flow}” would stop at the authorizer; it now reaches its resource.':
    'No cenário <c>{scenario}</c> em <c>{topology}</c>, o autorizador bloquearia “{flow}”. Na configuração em uso, esse fluxo chega ao recurso.',
  'In <c>{scenario}</c> on <c>{topology}</c>, “{flow}” would reach its resource; it now stops at the authorizer.':
    'No cenário <c>{scenario}</c> em <c>{topology}</c>, “{flow}” chegaria ao recurso. Na configuração em uso, o autorizador bloqueia esse fluxo.',
  'Scenarios that can run': 'Cenários que podem ser executados',
  '<c>{scenario}</c> on <c>{topology}</c> could run, which it cannot now.':
    'A configuração em uso impede a execução de <c>{scenario}</c> em <c>{topology}</c>. Os arquivos selecionados permitiriam essa execução.',
  '<c>{scenario}</c> on <c>{topology}</c> could no longer run: {reason}.':
    '<c>{scenario}</c> não poderia mais ser executado em <c>{topology}</c>: {reason}.',
  'Every request the tracer can build': 'Todas as requisições que o rastreador pode montar',
  'Of <n>{compared}</n> requests ({principals} principals, {actions} actions, {resources} resources, {contexts} contexts), <n>{allowToDeny}</n> go from allow to deny and <n>{denyToAllow}</n> from deny to allow.':
    'Entre as <n>{compared}</n> requisições ({principals} principais, {actions} ações, {resources} recursos, {contexts} contextos), a decisão muda de permitir para negar em <n>{allowToDeny}</n> e de negar para permitir em <n>{denyToAllow}</n>.',
  'Of <n>{compared}</n> requests ({principals} principals, {actions} actions, {resources} resources, {contexts} contexts), <n>{allowToDeny}</n> go from allow to deny and <n>{denyToAllow}</n> from deny to allow; {attribution} keep their decision but are decided by other policies.':
    'Entre as <n>{compared}</n> requisições ({principals} principais, {actions} ações, {resources} recursos, {contexts} contextos), a decisão muda de permitir para negar em <n>{allowToDeny}</n> e de negar para permitir em <n>{denyToAllow}</n>. Em {attribution}, outras políticas levam à mesma decisão.',
  'in every context': 'em todos os contextos',
  'under {contexts}': 'com {contexts}',
  '<e>{principal} → {action} on {resource}</e>, {where}':
    '<e>{principal} → {action} em {resource}</e>, {where}',
  '<e>{principal} → {action} on {resource}</e>, {where}; now decided by {now}':
    '<e>{principal} → {action} em {resource}</e>, {where}. Políticas que determinam a decisão atual: {now}',
  '<e>{principal} → {action} on {resource}</e>, {where}; would be decided by {then}':
    '<e>{principal} → {action} em {resource}</e>, {where}. Políticas que determinariam a decisão: {then}',
  '<e>{principal} → {action} on {resource}</e>, {where}; now decided by {now}; would be decided by {then}':
    '<e>{principal} → {action} em {resource}</e>, {where}. Políticas que determinam a decisão atual: {now}. Com os arquivos selecionados: {then}',

  // One scenario on the platform in use and on the one the files describe.
  'How would an incident go on each?': 'Como seria o mesmo incidente em cada plataforma?',
  'One scenario is run on the platform in use and on the one these files describe, from the same seed, on timelines of their own; nothing is applied.':
    'O AEGIS executa o mesmo cenário na plataforma em uso e na descrita pelos arquivos selecionados. As execuções usam a mesma semente e têm linhas do tempo separadas. A comparação mantém os arquivos em uso.',
  'Platform of the files': 'Plataforma descrita nos arquivos',
  'No scenario can be run on both: it has to be in use and among these files, and able to run on each platform.':
    'Nenhum cenário pode ser executado nas duas plataformas. Para comparar, o cenário precisa estar nos arquivos em uso e nos selecionados, além de ser compatível com as duas plataformas.',
  'What differs': 'Diferenças entre as plataformas',
  'A is <e>{base}</e>, in use ({services}). B is <e>{candidate}</e>, as these files describe it ({others}).':
    'A é a plataforma em uso, <e>{base}</e> ({services}). B é a plataforma descrita nos arquivos, <e>{candidate}</e> ({others}).',
  'Both runs are {scenario} with seed <n>{seed}</n>, begun at the same moment.':
    'As duas execuções do cenário {scenario} começam no mesmo instante e usam a semente <n>{seed}</n>.',
  'The files describe the platform in use as it is and Cedar answers the same, so the two runs are one run.':
    'Os arquivos descrevem a mesma plataforma que está em uso, e o Cedar toma as mesmas decisões. Por isso, uma única execução representa as duas.',
  'The files describe the platform in use as it is.':
    'Os arquivos descrevem a mesma plataforma que está em uso.',
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
    'Nos arquivos selecionados, não há um componente associado à função <c>{role}</c>. Na plataforma em uso, essa função aponta para <c>{other}</c>.',
  '<c>{role}</c> names <c>{target}</c>; nothing has that role in use.':
    'Nos arquivos selecionados, a função <c>{role}</c> aponta para <c>{target}</c>. Na plataforma em uso, essa função não está associada a nenhum componente.',
  '<c>{role}</c> names <c>{target}</c>; in use it names <c>{other}</c>.':
    'Nos arquivos selecionados, a função <c>{role}</c> aponta para <c>{target}</c>. Na plataforma em uso, aponta para <c>{other}</c>.',
  'Cedar also answers the simulation differently under these files; the comparison of decisions above says where.':
    'Com os arquivos selecionados, o Cedar também toma decisões diferentes na simulação. A comparação acima mostra quais.',
  'What follows without being stated': 'Diferenças implícitas nos arquivos',
  'Where a file states no capacity, the model sizes the service from its load at rest, and that load is another on B.':
    'Quando o arquivo não informa a capacidade de um serviço, o modelo a calcula a partir da carga em repouso. Essa carga é diferente na plataforma B.',
  'Capacity the model works with': 'Capacidade usada pelo modelo',
  '<n>{base}</n> req/s in A, <n>{candidate}</n> req/s in B':
    '<n>{base}</n> req/s em A, <n>{candidate}</n> req/s em B',
  'The scenario is one file, yet it prescribes something else on B: a role names another service there, or a rate is written as a share of a capacity that is another.':
    'O mesmo arquivo de cenário prescreve condições diferentes na plataforma B quando uma função aponta para outro serviço ou uma taxa é expressa como fração de uma capacidade que muda entre as plataformas.',
  'What the scenario prescribes': 'O que o cenário prescreve',
  nothing: 'nada',
  'Two runs do not say which of these differences an outcome follows from. To see what one of them does, change that one alone.':
    'A comparação entre as duas execuções não identifica qual diferença levou a um resultado. Para avaliar o efeito de uma diferença, altere apenas esse fator.',
  'in use': 'em uso',
  'with these files': 'com estes arquivos',
  '{measure} over both runs. In use: up to {a}. With these files: up to {b}.':
    '{measure} nas duas execuções. Em uso: até {a}. Com estes arquivos: até {b}.',
  'A, in use': 'A, em uso',
  'B, with these files': 'B, com estes arquivos',
  'The tick is where the incident begins. Each run lasts <n>{duration}</n>.':
    'A marca indica o início do incidente. Cada execução dura <n>{duration}</n>.',
  'Applies the files, then puts run B on the timeline, to play back and scrub':
    'Aplica os arquivos e carrega a execução B para reprodução e navegação pela linha do tempo',
  'Apply these files and watch run B': 'Aplicar estes arquivos e ver a execução B',
  'Either replaces the timeline in use, for everyone connected.':
    'Ao abrir qualquer uma das execuções, ela substitui a linha do tempo em uso para todos que estiverem conectados.',

  // Integrations.
  Integrations: 'Integrações',
  'Demo Mode needs none of these. Each one is opt-in, and every piece of data is labelled with where it came from.':
    'As integrações são opcionais no modo de demonstração. Todo dado tem sua origem identificada.',
  Unavailable: 'Indisponível',
  'Built-in simulation': 'Simulação integrada',
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
  'Working…': 'Conectando…',
  Connect: 'Conectar',

  // A comparison of platforms as text, to take away.
  '{scenario}: one incident on two platforms': '{scenario}: um incidente em duas plataformas',
  'A is {base}, in use ({services}). B is {candidate}, as the files describe it ({others}). Both runs are {scenario} with seed {seed}.':
    'A é a plataforma em uso, {base} ({services}). B é a plataforma descrita nos arquivos, {candidate} ({others}). As duas execuções do cenário {scenario} usam a semente {seed}.',
  'Cedar also answers the simulation differently under these files.':
    'Com os arquivos selecionados, o Cedar também toma decisões diferentes na simulação.',
  '{service}: {base} req/s in A, {candidate} req/s in B':
    '{service}: {base} req/s em A, {candidate} req/s em B',
  'The two runs (A in use, B with these files)':
    'As duas execuções (A em uso, B com estes arquivos)',
} as const satisfies Record<string, string>;
