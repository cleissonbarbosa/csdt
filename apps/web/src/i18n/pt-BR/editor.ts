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
  // The incident written on the platform: the tabs and the bar.
  'What is edited': 'O que está sendo editado',
  Platform: 'Plataforma',
  Incident: 'Incidente',
  'Writing {name}': 'Escrevendo {name}',
  'The engine is checking the incident with everything in use…':
    'O motor está verificando o incidente com tudo o que está em uso…',
  '{n} things to put right before the engine can check it, first: {first}':
    '{n} coisas a acertar antes que o motor possa verificá-lo; a primeira: {first}',
  'The engine accepts it, but it cannot run on {platform}: {reason}':
    'O motor aceita o incidente, mas ele não pode ser executado em {platform}: {reason}',
  'The engine accepts this incident and can run it on {platform}.':
    'O motor aceita este incidente e pode executá-lo em {platform}.',
  'Save the scenario': 'Salvar o cenário',
  'Run it': 'Executar',
  'Apply the platform as drawn with the incident in, and start it: the simulation starts a new timeline, for everyone connected.':
    'Aplica a plataforma como está desenhada, com o incidente, e o inicia: a simulação começa uma nova linha do tempo para todos os conectados.',
  'Leave without running it? The incident is not kept.':
    'Sair sem executar? O incidente não é guardado.',

  // The effects to place.
  'Effects to place': 'Efeitos para posicionar',
  'Carry an effect onto a service, a region or a connection: it holds during the phase in hand. Whatever a phase does not list eases back to normal.':
    'Leve um efeito até um serviço, uma região ou uma conexão: ele vale durante a fase selecionada. O que uma fase não lista volta aos poucos ao normal.',
  'On services': 'Em serviços',
  'On a client': 'Em um cliente',
  'On calls': 'Em chamadas',
  'Traffic of its own': 'Tráfego próprio',
  'Place: {effect}': 'Posicionar: {effect}',
  'Drag onto the model, or press to place it on what is selected':
    'Arraste para o modelo, ou pressione para posicioná-lo no que está selecionado',
  '{effect}: drag onto the model, or press to place it on what is selected':
    '{effect}: arraste para o modelo, ou pressione para posicioná-lo no que está selecionado',
  'Draw a flow': 'Desenhar um fluxo',
  'Click, one after another, the services the flow passes':
    'Clique, um depois do outro, nos serviços por onde o fluxo passa',
  'Click the service the flow starts at.': 'Clique no serviço onde o fluxo começa.',
  '{n} service so far. Click the next one it passes.':
    '{n} serviço até aqui. Clique no próximo por onde ele passa.',
  '{n} services so far. Click the next one, or finish.':
    '{n} serviços até aqui. Clique no próximo, ou conclua.',
  'Finish the flow': 'Concluir o fluxo',
  Done: 'Concluir',
  'Stop drawing the flow': 'Parar de desenhar o fluxo',
  'Flow {n}': 'Fluxo {n}',
  Capacity: 'Capacidade',
  'Requests fail': 'Requisições falham',
  Demand: 'Demanda',
  'Calls into it': 'Chamadas recebidas',
  'Network latency into it': 'Latência de rede das chamadas recebidas',
  'Calls into it fail': 'Chamadas recebidas falham',
  'Lasts, s': 'Dura (s)',

  // Where an effect goes, and what it says on the model.
  'Demand is what a client sends: carry it onto a client.':
    'Demanda é o que um cliente envia: leve-a até um cliente.',
  'This effect is placed on a service or a region, not on a connection.':
    'Este efeito vai em um serviço ou em uma região, não em uma conexão.',
  'This effect is placed on one service, not on a whole region.':
    'Este efeito vai em um serviço, não em uma região inteira.',
  '{effect} on {what}': '{effect} em {what}',
  'Capacity ×{n}': 'Capacidade ×{n}',
  'Latency ×{n}': 'Latência ×{n}',
  '{share} of requests fail': '{share} das requisições falham',
  'Demand ×{n}': 'Demanda ×{n}',
  'Calls ×{n}': 'Chamadas ×{n}',
  'Network latency ×{n}': 'Latência de rede ×{n}',
  '{share} of calls fail': '{share} das chamadas falham',
  '{rate} requests a second': '{rate} requisições por segundo',
  '{n} times the capacity of {service}': '{n} vezes a capacidade de {service}',
  'the connection {from} → {to}': 'a conexão {from} → {to}',
  'nothing yet': 'nada ainda',
  'every call into {service}': 'todas as chamadas a {service}',
  'the gateway of {region} ({name})': 'o gateway de {region} ({name})',
  '{flow}: {rate}': '{flow}: {rate}',
  'Open {effect} in the card': 'Abrir {effect} no card',

  // The phases of the incident.
  'The phases of the incident': 'As fases do incidente',
  Phases: 'Fases',
  'Cut the phase in hand in two': 'Dividir em duas a fase selecionada',
  'How long the incident lasts, in seconds: up to 1800':
    'Quanto tempo o incidente dura, em segundos: até 1.800',
  '{phase}, from {start} to {end}': '{phase}, de {start} a {end}',
  'Where {phase} starts': 'Onde {phase} começa',
  'How long {phase} eases in over': 'Duração da transição de {phase}',
  '{s} s': '{s} s',

  // The incident's card.
  'Untitled incident': 'Incidente sem nome',
  '{n} phases, {length} long': '{n} fases, {length} de duração',
  'Before the engine can check it': 'Antes que o motor possa verificá-lo',
  'Phase {n}: {name}': 'Fase {n}: {name}',
  'Remove this phase': 'Remover esta fase',
  'Seconds after the incident starts': 'Segundos depois do início do incidente',
  'Holds from {start} to {end}.': 'Vale de {start} a {end}.',
  'What it holds': 'O que ela mantém',
  'Nothing: everything eases back to normal. Carry an effect from the palette onto the model.':
    'Nada: tudo volta aos poucos ao normal. Leve um efeito da paleta até o modelo.',
  'on {what}': 'em {what}',
  'Every call into': 'Todas as chamadas a',
  'Its rate': 'A taxa dele',
  'A multiple of a service’s capacity': 'Um múltiplo da capacidade de um serviço',
  'Requests a second': 'Requisições por segundo',
  'Of the capacity of': 'Da capacidade de',
  'So the same incident overloads a small platform and a large one alike.':
    'Assim o mesmo incidente sobrecarrega igualmente uma plataforma pequena e uma grande.',
  'Remove this rate': 'Remover esta taxa',
  'What the phases name it by when they set its rate.':
    'O nome pelo qual as fases se referem a ele ao definir sua taxa.',
  Hostile: 'Hostil',
  'Drawn as hostile traffic.': 'Desenhado como tráfego hostil.',
  'Joins the traffic where it ends': 'Junta-se ao tráfego onde termina',
  'What survives the last hop goes on to what that service calls, as a flood does.':
    'O que passa do último salto segue para o que aquele serviço chama, como faz uma inundação.',
  'Remove this flow': 'Remover este fluxo',
  'Add an event': 'Adicionar um evento',
  'None.': 'Nenhum.',
  'Flows it injects': 'Fluxos que ele injeta',
  'None. Draw one from the palette, through the services it passes.':
    'Nenhum. Desenhe um pela paleta, através dos serviços por onde ele passa.',
  '{n} flow is kept as written.': '{n} fluxo é mantido como foi escrito.',
  '{n} flows are kept as written.': '{n} fluxos são mantidos como foram escritos.',
  'The incident': 'O incidente',
  'This scenario, as it is': 'Este cenário, como está',

  // What is missing, before the engine is asked.
  'An effect of “{phase}” sets the rate of a flow the scenario does not have.':
    'Um efeito de “{phase}” define a taxa de um fluxo que o cenário não tem.',
  'A flow’s id is 1 to 64 letters, digits, "-", "_" or ".".':
    'O ID de um fluxo deve ter entre 1 e 64 caracteres. Use letras, números, hífen (-), sublinhado (_) ou ponto (.).',
  'The flow “{flow}” has no hop.': 'O fluxo “{flow}” não tem nenhum salto.',
} as const;
