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

  // A cloud inventory: the command that writes one.
  'Get an inventory of a cloud account, to import':
    'Obter o inventário de uma conta de nuvem para importar',
  'A script in this project’s repository reads what a provider lists of an account, its resources and the connections it states between them, and writes one file. It runs on your machine, through the provider’s own CLI and with your own access, and only reads. AEGIS never runs it and is given no credential: what you type here goes into the line below and nowhere else. Drop the file it writes on this dialog.':
    'Um script no repositório deste projeto lê o que o provedor lista de uma conta, seus recursos e as conexões que ele declara entre eles, e grava um único arquivo. Ele roda na sua máquina, pela CLI do próprio provedor e com o seu acesso, e apenas lê. O AEGIS nunca o executa e não recebe nenhuma credencial: o que você digita aqui vai para a linha abaixo e para nenhum outro lugar. Solte neste diálogo o arquivo que ele gravar.',
  Provider: 'Provedor',
  Profile: 'Perfil',
  'Of the provider’s CLI. Empty: its default.': 'Da CLI do provedor. Vazio: o padrão dela.',
  Project: 'Projeto',
  'The id of the project to read.': 'O id do projeto a ler.',
  Compartment: 'Compartimento',
  'The OCID of the compartment to read.': 'O OCID do compartimento a ler.',
  'Region codes, separated by spaces or commas.':
    'Códigos de região, separados por espaços ou vírgulas.',
  'Only with these tags': 'Somente com estas tags',
  'KEY or KEY=VALUE, separated by spaces. Empty: everything.':
    'CHAVE ou CHAVE=VALOR, separados por espaços. Vazio: tudo.',
  'Name in AEGIS': 'Nome no AEGIS',
  'It need not be the account’s.': 'Não precisa ser o da conta.',
  'Copy the command': 'Copiar o comando',
  'Still needed: {fields}': 'Ainda falta: {fields}',
  'Command copied.': 'Comando copiado.',
  'The command could not be copied.': 'Não foi possível copiar o comando.',
  'Run it from the repository’s folder, with the provider’s CLI installed and signed in. <c>--help</c> after the provider lists every option; what it reads, and the least access it needs, is in <c>docs/INVENTORY.md</c>.':
    'Execute-o na pasta do repositório, com a CLI do provedor instalada e autenticada. <c>--help</c> depois do provedor lista todas as opções; o que ele lê, e o acesso mínimo de que precisa, está em <c>docs/INVENTORY.md</c>.',

  // A cloud inventory among the files: what to bring from it.
  'What to bring from {file}': 'O que trazer de {file}',
  '<c>{file}</c> is an inventory of {provider}.': '<c>{file}</c> é um inventário de {provider}.',
  'Read <n>{when}</n>.': 'Lido em <n>{when}</n>.',
  'Its resources and the connections the provider states between them are read as a platform. Choose what to bring: each choice is written into the file, and what it brings is counted again.':
    'Seus recursos e as conexões que o provedor declara entre eles são lidos como uma plataforma. Escolha o que trazer: cada escolha é gravada no arquivo, e o que ela traz é contado de novo.',
  'Resources brought': 'Recursos trazidos',
  '{kept} of {total}': '{kept} de {total}',
  'Connections drawn': 'Conexões desenhadas',
  'Where clients enter': 'Por onde os clientes entram',
  '{n} resource': '{n} recurso',
  '{n} resources': '{n} recursos',
  'Not brought': 'Não trazidos',
  '{n} that the filters do not ask for': '{n} que os filtros não pedem',
  '{n} left out by hand': '{n} fora por escolha manual',
  '{n} that no connection touches': '{n} sem nenhuma conexão',
  'Left out so that calls run one way': 'Fora, para que as chamadas sigam em um só sentido',
  '{n} more': 'mais {n}',
  Networks: 'Redes',
  'In no network': 'Em nenhuma rede',
  Tag: 'Tag',
  'Choose a tag': 'Escolher uma tag',
  'Stop asking for the tag {key}': 'Deixar de pedir a tag {key}',
  'Values of {key}': 'Valores de {key}',
  'Any value': 'Qualquer valor',
  '(empty)': '(vazio)',
  'Name has': 'Nome contém',
  'Also what leads to them and what they lead to':
    'Também o que leva a eles e aquilo a que eles levam',
  'From what the filters choose, follows the connections both ways: what a tag misses on the same path comes too.':
    'A partir do que os filtros escolhem, segue as conexões nos dois sentidos: o que uma tag não alcança no mesmo caminho vem junto.',
  'Only what a connection touches': 'Somente o que tem alguma conexão',
  'A resource nothing leads to and that leads nowhere is left out. A security monitor stays: it watches, and nothing calls it.':
    'Um recurso ao qual nada leva e que não leva a lugar nenhum fica de fora. Um monitor de segurança permanece: ele observa, e nada o chama.',
  'Draw connections from network rules': 'Desenhar conexões a partir de regras de rede',
  'A rule that admits one group to another is a permission to reach, not a call that was seen. The file states {n} of them.':
    'Uma regra que admite um grupo em outro é uma permissão de alcance, não uma chamada que foi vista. O arquivo declara {n} delas.',
  'Resources, one by one': 'Recursos, um a um',
  'Find a resource': 'Buscar um recurso',
  'Leave out {name}': 'Deixar {name} de fora',
  'Bring back {name}': 'Trazer {name} de volta',
  '{n} more: search to find one of them.': 'Mais {n}: use a busca para encontrar um deles.',
  'Notes in the file': 'Notas do arquivo',
  'Bring everything': 'Trazer tudo',

  // The files to import, by the part each goes to.
  Platforms: 'Plataformas',
  Recordings: 'Gravações',
  'topologies, Compose files, inventories': 'topologias, arquivos Compose, inventários',
  'incidents to run': 'incidentes para executar',
  'incidents to replay': 'incidentes para rever',
  'Cedar policies': 'Políticas Cedar',
  'what Cedar decides by': 'pelo que o Cedar decide',
  Entities: 'Entidades',
  'who and what Cedar knows': 'quem e o que o Cedar conhece',
  Catalogue: 'Catálogo',
  'requests, and ordinary traffic': 'requisições, e o tráfego comum',
  Schema: 'Esquema',
  'optional: what policies are checked against':
    'opcional: contra o que as políticas são verificadas',
  'replaced by these': 'substituída por estes',
  'stays as it is': 'fica como está',
  'Not read': 'Não lidos',
  'no part of a workspace': 'nenhuma parte de um espaço de trabalho',
  'a saved workspace: its files are in the slots below':
    'um espaço de trabalho salvo: seus arquivos estão nos encaixes abaixo',
  'being read…': 'sendo lido…',
  'not told: see what is wrong below': 'não identificado: veja abaixo o que está errado',
  'the manifest: which version of the format the files are in':
    'o manifesto: em que versão do formato os arquivos estão',
  'in {bundle}': 'em {bundle}',
} as const satisfies Record<string, string>;
