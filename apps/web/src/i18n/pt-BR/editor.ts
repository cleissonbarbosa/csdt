/** The platform editor: drawing a topology on the model and the file it becomes. */
export default {
  // What a new platform starts with.
  'My platform': 'Minha plataforma',
  'Main region': 'Região principal',
  Clients: 'Clientes',
  'Global edge': 'Borda global',
  'Region {n}': 'Região {n}',

  // What the roles are for.
  'The gateway requests are traced through; the DDoS surge is aimed at it.':
    'O gateway por onde passam as requisições rastreadas; o pico de DDoS é apontado para ele.',
  'The authentication service traced requests and credential stuffing reach.':
    'O serviço de autenticação que as requisições rastreadas e o credential stuffing alcançam.',
  'The authorizer that puts traced requests to Cedar.':
    'O autorizador que submete as requisições rastreadas ao Cedar.',
  'Where a traced request starts.': 'Onde começa uma requisição rastreada.',
  'Where hostile traffic comes from.': 'De onde vem o tráfego hostil.',
  'The router of the global edge.': 'O roteador da borda global.',
  'The database the cascading failure starts at.':
    'O banco de dados onde começa a falha em cascata.',
  'What a traced request is for, when no resource role matches.':
    'O alvo de uma requisição rastreada, quando nenhuma função de recurso corresponde.',
  'The monitor named on the alerts the engine raises.':
    'O monitor citado nos alertas que o motor emite.',
  'The region the regional outage takes down.': 'A região que a queda regional derruba.',
  'The region its traffic fails over to.': 'A região para onde o tráfego dela é desviado.',

  // What is plainly wrong before the server is asked.
  'The platform needs a name.': 'A plataforma precisa de um nome.',
  'A platform needs at least one region.': 'Uma plataforma precisa de pelo menos uma região.',
  'A platform needs at least one service.': 'Uma plataforma precisa de pelo menos um serviço.',
  'The id of “{name}” is not 1 to 64 letters, digits, "-", "_" or ".".':
    'O id de “{name}” não tem de 1 a 64 letras, dígitos, "-", "_" ou ".".',
  'Two services have the id “{id}”.': 'Dois serviços têm o id “{id}”.',
  'Every service needs a name.': 'Todo serviço precisa de um nome.',
  '“{name}” stands in a region the platform does not have.':
    '“{name}” está numa região que a plataforma não tem.',
  'The connection {id} joins a service the platform does not have.':
    'A conexão {id} liga um serviço que a plataforma não tem.',
  'The role “{role}” names nothing on this platform.':
    'A função “{role}” não aponta para nada nesta plataforma.',
  'The connections run in a circle: {circle}.': 'As conexões formam um círculo: {circle}.',

  // The editor's bar.
  'Drawing a platform': 'Desenhando uma plataforma',
  'Editing {name}': 'Editando {name}',
  'The engine could not run the platform.': 'O motor não conseguiu executar a plataforma.',
  '{n} things to put right before the engine can run it, first: {first}':
    '{n} pontos a corrigir antes que o motor possa executá-la. Primeiro: {first}',
  'The engine is running the change at rest; the model shows the last run.':
    'O motor está executando a mudança em repouso; o modelo mostra a última execução.',
  'At rest, as the engine runs it: one service, normal.':
    'Em repouso, segundo o motor: um serviço, normal.',
  'At rest, as the engine runs it: {n} services, all normal.':
    'Em repouso, segundo o motor: {n} serviços, todos normais.',
  'At rest, as the engine runs it: {off} of {n} services out of normal.':
    'Em repouso, segundo o motor: {off} de {n} serviços fora do normal.',
  'Leave without applying? The draft is not kept.': 'Sair sem aplicar? O rascunho não é guardado.',
  'Keep editing': 'Continuar editando',
  Leave: 'Sair',
  Undo: 'Desfazer',
  Redo: 'Refazer',
  'Save the file': 'Salvar o arquivo',
  'Run an incident on it and on the platform in use':
    'Executar um incidente nela e na plataforma em uso',
  'Compare an incident': 'Comparar um incidente',
  'Put it in use: the simulation starts a new timeline, for everyone connected.':
    'Colocar em uso: a simulação começa uma nova linha do tempo, para todos os conectados.',
  'Applying…': 'Aplicando…',
  'Leave the editor': 'Sair do editor',
  'Edit this platform': 'Editar esta plataforma',
  'Draw a new platform': 'Desenhar uma plataforma nova',
  'The platform could not be read.': 'Não foi possível ler a plataforma.',
  '{name} is not a platform the editor can open.':
    '{name} não é uma plataforma que o editor consiga abrir.',

  // The pieces to place.
  'Pieces to place': 'Peças para posicionar',
  'Add: {kind}': 'Adicionar: {kind}',
  'Drag onto the table, or press to add one after the selection':
    'Arraste para a mesa, ou pressione para adicionar depois da seleção',
  '{kind}: drag onto the table, or press to add one after the selection':
    '{kind}: arraste para a mesa, ou pressione para adicionar depois da seleção',
  'Drag a piece onto the table: its lane is its region, its column how far along the path it stands. Carry a piece onto another to connect them.':
    'Arraste uma peça para a mesa: a raia é a região dela, a coluna diz em que ponto do caminho ela fica. Leve uma peça até outra para conectá-las.',

  // Carrying over the model.
  'Connect to {name}': 'Conectar a {name}',
  'a new region': 'uma região nova',
  'a new column of {region}': 'uma coluna nova de {region}',
  '{region}, tier {tier}': '{region}, camada {tier}',
  '{kind} in {where}': '{kind} em {where}',
  'Move to {where}': 'Mover para {where}',
  'These two are already connected.': 'Estes dois já estão conectados.',
  'That would close a circle: {circle}. Load runs one way along the connections.':
    'Isso fecharia um círculo: {circle}. A carga corre num só sentido pelas conexões.',

  // The card of what is selected.
  'The draft': 'O rascunho',
  Id: 'Id',
  'Not changed: an id is 1 to 64 letters, digits, "-", "_" or ".", and no other service may have it.':
    'Não alterado: um id tem de 1 a 64 letras, dígitos, "-", "_" ou ".", e nenhum outro serviço pode tê-lo.',
  'What scenarios and recordings name the service by.':
    'É por ele que cenários e gravações se referem ao serviço.',
  Region: 'Região',
  Tier: 'Camada',
  'At rest the engine gives it {rps} requests a second, of a capacity of {capacity}, and finds it {state}.':
    'Em repouso o motor lhe dá {rps} requisições por segundo, de uma capacidade de {capacity}, e o considera {state}.',
  Figures: 'Valores',
  'Own latency when idle (ms)': 'Latência própria em repouso (ms)',
  'Requests a second it sends': 'Requisições por segundo que envia',
  'State a capacity': 'Informar uma capacidade',
  'Without one the engine sizes it from its load at rest, and says so.':
    'Sem ela o motor a dimensiona pela carga em repouso, e informa isso.',
  'What it does about load': 'O que faz com a carga',
  'Rate limit (requests a second)': 'Limite de taxa (requisições por segundo)',
  'Turns away what arrives beyond it, whoever sent it.':
    'Recusa o que chega além dele, venha de quem vier.',
  'Filter of suspicious traffic (0 to 1)': 'Filtro de tráfego suspeito (0 a 1)',
  'The share of what a scenario marks suspicious it turns away as it arrives.':
    'A parte do que um cenário marca como suspeito que ele recusa na chegada.',
  Autoscale: 'Escalonamento automático',
  'Capacity follows the load, up to a multiple of its capacity at rest.':
    'A capacidade acompanha a carga, até um múltiplo da capacidade em repouso.',
  'Up to (times)': 'Até (vezes)',
  'Follows within (s)': 'Acompanha em (s)',
  'None yet. Carry this piece onto another to connect them.':
    'Nenhuma ainda. Leve esta peça até outra para conectá-las.',
  'from#connection': 'de',
  'Connect to': 'Conectar a',
  'Choose a service…': 'Escolha um serviço…',
  '{use} Now on {name}.': '{use} Hoje em {name}.',
  'Take this service away': 'Remover este serviço',
  'The connection': 'A conexão',
  Relationship: 'Relação',
  Protocol: 'Protocolo',
  'State how strongly a failure reaches the caller (0 to 1)':
    'Informar com que força uma falha alcança quem chama (0 a 1)',
  'Without it the relationship decides.': 'Sem isso, a relação decide.',
  'State the network latency (ms)': 'Informar a latência de rede (ms)',
  'Without it: 1.2 ms inside a region, 60 ms across regions.':
    'Sem isso: 1,2 ms dentro de uma região, 60 ms entre regiões.',
  'At rest the engine sends {rps} requests a second along it, {ms} each way.':
    'Em repouso o motor envia {rps} requisições por segundo por ela, {ms} em cada sentido.',
  'Take this connection away': 'Remover esta conexão',
  'Untitled platform': 'Plataforma sem nome',
  'Before the engine can run it': 'Antes que o motor possa executá-la',
  'The platform': 'A plataforma',
  Description: 'Descrição',
  'Add a region': 'Adicionar uma região',
  'Its id is {id}.': 'O id dela é {id}.',
  'Kind of region': 'Tipo de região',
  'Cloud region': 'Região de nuvem',
  'No service yet: carry one past the last lane, or choose this region on its card.':
    'Nenhum serviço ainda: leve um para além da última raia, ou escolha esta região no card dele.',
  'Take it away': 'Remover',
  'None yet. The bundled incidents and the request tracer ask for roles: give them on a service’s card.':
    'Nenhuma ainda. Os incidentes incluídos e o rastreador de requisições pedem funções: atribua-as no card de um serviço.',
  None: 'Nenhuma',
  'No service yet.': 'Nenhum serviço ainda.',
} as const;
