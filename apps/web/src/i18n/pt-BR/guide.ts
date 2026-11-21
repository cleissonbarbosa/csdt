/**
 * The orientation of a first visit, the guided challenges, the help and
 * legend, the command palette, and saving and sharing a session.
 *
 * Cedar's own keywords (`permit`, `forbid`, `when`) stay as the policies
 * write them: the challenges ask the viewer to read those policies.
 */
export default {
  // The orientation of a first visit.
  'Where to start': 'Por onde começar',
  'A fictional cloud platform, simulated, to take apart':
    'Uma plataforma de nuvem fictícia para explorar em detalhes',
  'Each piece is a kind of service. Select one to see what it does and how it is doing; everything you see is computed by the simulation, and Cedar decides every authorization. Where would you like to start?':
    'Cada peça representa um tipo de serviço. Selecione uma para conhecer sua função e ver seu estado. A simulação calcula os dados exibidos e o Cedar decide quais requisições são autorizadas. Por onde você quer começar?',
  'Dismiss; this does not come back': 'Fechar esta apresentação sem exibi-la novamente',
  'Understand the platform': 'Entender a plataforma',
  'Its {n} kinds of service, the path a request takes through them, and the signals that say how it is doing.':
    'Conheça os {n} tipos de serviço, o caminho das requisições e os sinais que indicam o estado da plataforma.',
  'Its services, the path a request takes through them, and the signals that say how it is doing.':
    'Conheça os serviços, o caminho das requisições e os sinais que indicam o estado da plataforma.',
  'Investigate a failure': 'Investigar uma falha',
  'Start an incident, watch it spread, and read back where it began and why each service followed.':
    'Inicie um incidente, acompanhe sua propagação e consulte o registro para descobrir onde começou e por que cada serviço foi afetado.',
  'Ask Cedar who may do what, see which policy decides, and follow the request across the model.':
    'Pergunte ao Cedar quem pode fazer o quê, veja qual política determina a decisão e acompanhe a requisição pelo modelo.',
  'Or <guide>take a guided challenge</guide>: a question about the platform, checked against the model. All of this stays in the menu at the end of the bar.':
    'Ou <guide>faça um desafio guiado</guide> e responda a uma pergunta usando o modelo. Essas opções continuam disponíveis no menu no fim da barra.',

  // The guide card: the list of challenges and the one under way.
  'Close the guide': 'Fechar o guia',
  "Each asks one question about the platform. Your answer is checked against the model itself: the record of the incident, or Cedar's own decision.":
    'Cada desafio traz uma pergunta sobre a plataforma. O guia confere sua resposta com base no registro do incidente ou na decisão do Cedar.',
  '{n} of {total} solved': '{n} de {total} resolvidos',
  'Start over': 'Recomeçar',
  'The one you were sent': 'Desafio compartilhado com você',
  solved: 'resolvido',
  Again: 'Refazer',
  'All challenges': 'Todos os desafios',
  'Next: {title}': 'Próximo: {title}',
  'Copy a link to this challenge': 'Copiar link do desafio',
  'Link copied': 'Link copiado',
  'Read from the events and figures the engine recorded in this run.':
    'Com base nos eventos e nos dados que o motor registrou nesta execução.',
  'What the Cedar policy engine answered, or the text of a policy it holds.':
    'Resposta do motor de políticas Cedar ou texto de uma das políticas carregadas.',

  // What every challenge says before and while it is answered.
  'The platform in use cannot run the scenario this challenge needs.':
    'A plataforma atual não consegue executar o cenário necessário para este desafio.',
  'Answer: {service}': 'Responder: {service}',
  'That is a kind of service. Open it and select one service.':
    'Você selecionou um tipo de serviço. Abra o grupo e escolha um dos serviços.',
  'Select a service on the model to answer with it.':
    'Para responder, selecione um serviço no modelo.',
  'There is no incident to answer about yet.': 'Ainda não há um incidente para analisar.',
  'There is no incident to answer about.': 'Nenhum incidente disponível para analisar.',
  'Start the challenge again and let the incident run.':
    'Reinicie o desafio e deixe o incidente avançar.',
  'Not {service}.': 'Não é {service}.',

  // Where a cascade begins.
  'Find where the cascade begins': 'Encontrar a origem da falha em cascata',
  'Services start failing one after another. One of them is where it began; the rest follow from it.':
    'Os serviços começam a falhar um após o outro. A falha começa em um deles e se propaga para os demais.',
  'Starts the cascading failure scenario from a clean simulation.':
    'Reinicia a simulação e inicia o cenário de falha em cascata.',
  'Watch which services leave their normal state, and in what order. Then select the service you think it began at.':
    'Observe quais serviços saem do estado normal e em que ordem. Depois, selecione o serviço que você considera a origem da falha.',
  'In its first phase the scenario holds it to {effect}.':
    'Na primeira fase, o cenário prescreve {effect}.',
  '{service} became {health} at {at} because {why}.':
    '{service} ficou {health} em {at} porque {why}.',
  '{service} became {health} at {at}.': '{service} ficou {health} em {at}.',
  '{service} became {health} at {at} because of nothing the report can point to.':
    '{service} ficou {health} em {at}. O relatório não identificou a causa.',
  'Yes: it begins at {service}.': 'Sim, a falha começa em {service}.',
  'No service has left its normal state yet. Let the incident run a little longer.':
    'Nenhum serviço saiu do estado normal até agora. Deixe o incidente avançar um pouco mais.',
  '{service} has stayed normal so far: the incident has not reached it. Look at the services whose lamp is lit.':
    '{service} continua normal, pois o incidente ainda não o atingiu. Observe os serviços com a luz acesa.',
  '{n} service left the normal state before it did. Follow what it depends on.':
    '{n} serviço saiu do estado normal antes dele. Verifique suas dependências.',
  '{n} services left the normal state before it did. Follow what it depends on.':
    '{n} serviços saíram do estado normal antes dele. Verifique suas dependências.',
  'Nothing was seen to fail before it, but the run says something acts on another service first. Follow what it calls.':
    'Nenhuma falha anterior foi observada. O registro aponta um efeito inicial em outro serviço. Verifique os serviços chamados pelo que você selecionou.',
  'Not {service}: it is a consequence.': '{service} foi afetado pela propagação da falha.',

  // Where injected traffic is stopped: the flood, and the contractor.
  'Nothing is stopping it yet.': 'O tráfego ainda não está sendo bloqueado.',
  'Right now {share} of “{flow}” still gets through.':
    'Neste momento, {share} de “{flow}” ainda passa.',
  'The injected traffic has not started or has already ended.':
    'O tráfego injetado ainda não começou ou já terminou.',
  "The scenario's mitigation phase, “{phase}”, began at {at}; it takes a few seconds to ease in.":
    'A fase de mitigação “{phase}” começou em {at}. Ela leva alguns segundos para fazer efeito por completo.',
  'The scenario has not reached its mitigation phase. Let it run.':
    'Deixe a simulação avançar até a fase de mitigação.',
  'Yes: it is stopped at {service}.': 'Sim, o tráfego é bloqueado em {service}.',
  'Of {total} req/s of “{flow}”, {passed} req/s get past it (turned away by: {reason}).':
    'Das {total} req/s de “{flow}”, {passed} req/s passam pelo serviço. As demais são rejeitadas ({reason}).',
  'Of {total} req/s of “{flow}”, {passed} req/s get past it.':
    'Das {total} req/s de “{flow}”, {passed} req/s passam pelo serviço.',
  '{service} is on the route, but it is not where most of this traffic is turned away.':
    '{service} está na rota. A maior parte do tráfego é bloqueada em outro serviço.',
  'This traffic does not pass through {service}. Its route is the one drawn on the model.':
    'Esse tráfego não passa por {service}. Siga a rota desenhada no modelo.',
  "Only {share} of “{flow}” is still delivered: look for where the route's beads stop.":
    'Só {share} de “{flow}” ainda chega ao destino. Procure onde os pontos de tráfego param ao longo da rota.',
  'Find where the flood is stopped': 'Encontrar onde o pico de tráfego é bloqueado',
  'Hostile traffic pours in from outside. After a while a mitigation engages and most of it is turned away at one service.':
    'Um volume alto de tráfego hostil chega de fora da plataforma. Quando a mitigação entra em ação, um dos serviços bloqueia a maior parte desse tráfego.',
  'Starts the DDoS surge scenario from a clean simulation.':
    'Reinicia a simulação e inicia o cenário de pico de tráfego DDoS.',
  'Follow the incident’s route across the model. When the mitigation has engaged, select the service the flood is being stopped at.':
    'Siga a rota do incidente no modelo. Quando a mitigação entrar em ação, selecione o serviço que está bloqueando o pico de tráfego.',
  'The scenario prescribes the rejection at this service; how much load that takes off what lies behind it is the model’s doing.':
    'O cenário prescreve a rejeição neste serviço. O modelo calcula quanto isso reduz a carga nos serviços seguintes.',
  'Find where the contractor is stopped':
    'Encontrar onde as requisições do terceirizado são bloqueadas',
  'A contractor of another tenant is signed in, and asks for things that are not theirs to have. None of it reaches the data.':
    'Um terceirizado de outro locatário está autenticado e solicita acesso a recursos sem ter permissão. Nenhuma dessas requisições chega aos dados.',
  'Starts the Cedar authorization denial scenario from a clean simulation.':
    'Reinicia a simulação e inicia o cenário de autorização negada pelo Cedar.',
  'Follow the route of the contractor’s requests. Once they ask for what they may not have, select the service they are stopped at.':
    'Siga a rota das requisições do terceirizado. Quando ele fizer uma requisição sem autorização, selecione o serviço que a bloqueia.',
  'No scenario can write a denial. This traffic stops at the authorizer because Cedar, asked the request it is made of, denies it under the policies in force.':
    'Cabe ao Cedar decidir sobre a autorização. O tráfego para no autorizador porque o Cedar avalia a requisição e a nega com base nas políticas em vigor.',

  // The region that went dark.
  'Find the region that went dark': 'Encontrar a região que ficou fora do ar',
  'A whole cloud region stops answering. Traffic that went to it is sent elsewhere, and what stands there is out of reach.':
    'Uma região inteira da nuvem para de responder. O tráfego é redirecionado e os serviços daquela região ficam inacessíveis.',
  'Starts the regional outage scenario from a clean simulation.':
    'Reinicia a simulação e inicia o cenário de queda regional.',
  'Watch the model, by region if you like. When a region has gone dark, select any service that stands in it.':
    'Observe o modelo. Se preferir, organize os serviços por região. Quando uma região ficar fora do ar, selecione qualquer serviço dela.',
  'No region is dark yet.': 'Nenhuma região ficou fora do ar até agora.',
  '{region} has {n} of {total} services out of their normal state, and still answers {share} of what it is asked.':
    '{region} tem {n} de {total} serviços fora do estado normal e ainda responde a {share} das requisições.',
  'Every region is still serving. Let the incident run a little longer.':
    'Todas as regiões ainda respondem a requisições. Deixe o incidente avançar um pouco mais.',
  '{n} of the {total} services that stand in {region} are out of their normal state.':
    '{n} dos {total} serviços que ficam em {region} estão fora do estado normal.',
  '{regions} is still serving.': '{regions} ainda responde a requisições.',
  '{regions} are still serving.': '{regions} ainda respondem a requisições.',
  'Yes: {region} is dark.': 'Sim, {region} está fora do ar.',
  'It stands in {region}, where {n} of {total} services are out of their normal state: that region still answers.':
    'Esse serviço fica em {region}. Lá, {n} de {total} serviços estão fora do estado normal, e a região ainda responde.',
  'It stands in {region}, where no service is out of their normal state: that region still answers.':
    'Esse serviço fica em {region}, que ainda responde e tem todos os serviços no estado normal.',
  'One region has {n} of its {total} services out at once. Arranged by region, its plate is the one that has gone dark.':
    'Uma região tem {n} de {total} serviços fora do normal ao mesmo tempo. Na disposição por região, procure a placa apagada.',

  // A request Cedar denies, and the one circumstance under which it is allowed.
  'Opens the request tracer with the request. The simulation is left as it is.':
    'Abre a requisição no rastreador sem interferir na simulação.',
  'Evaluate the request and read the policies. Then change one thing about the circumstances of the request (not who asks, nor for what) so that Cedar allows it, and evaluate again.':
    'Avalie a requisição e leia as políticas. Mantenha o principal, a ação e o recurso. Altere uma das condições da avaliação para que o Cedar permita a requisição e avalie novamente.',
  'The policies in use do not know this request.':
    'A requisição deste desafio não está disponível no catálogo atual.',
  'Check my latest result': 'Conferir meu último resultado',
  'Evaluate the request in the tracer first.': 'Primeiro, avalie a requisição no rastreador.',
  'Nothing has been evaluated yet.': 'Nada foi avaliado ainda.',
  'Press “Evaluate with Cedar” in the tracer.': 'Clique em “Avaliar com o Cedar” no rastreador.',
  'That is another request.': 'Essa é outra requisição.',
  'Cedar answered for {principal} asking to {action} {resource}. {keep}':
    'O Cedar avaliou a requisição de {principal} com a ação {action} e o recurso {resource}. {keep}',
  'Cedar allows it under {context}, and names {policies} as the policy that decides.':
    'Com {context}, o Cedar permite a requisição com base em {policies}.',
  'Yes: now it is allowed.': 'Sim, agora a requisição é permitida.',
  'Still denied.': 'A requisição continua negada.',
  'Under {context} no policy decided this: nothing permits it, and Cedar denies by default. The decision lists, policy by policy, the permit that came closest; read its “when”.':
    'Com {context}, nenhuma política permite a requisição, por isso o Cedar a nega por padrão. Na lista de políticas da decisão, encontre o permit que quase se aplicou e leia sua condição “when”.',
  'Cedar names {policies}: a forbid, which no permit overrides. Read what it makes an exception for.':
    'O Cedar indica {policies}. Um forbid sempre prevalece sobre qualquer permit. Leia em que caso o forbid abre uma exceção.',
  'Cedar names {policies}.': 'O Cedar aponta {policies}.',
  '{policies} was switched off for this evaluation; the answer asked for is the one under every policy.':
    '{policies} estava desativada nesta avaliação. Para responder ao desafio, avalie com todas as políticas ativas.',
  '{policies} were switched off for this evaluation; the answer asked for is the one under every policy.':
    '{policies} estavam desativadas nesta avaliação. Para responder ao desafio, avalie com todas as políticas ativas.',
  'Explain why this export was denied': 'Explicar por que esta exportação foi negada',
  'Alice is a finance analyst of the tenant that owns the ledger. She asks to export it, and Cedar says no.':
    'Alice é analista financeira do locatário ao qual pertence o livro-razão. Ela solicita a exportação do livro-razão e o Cedar nega a requisição.',
  'Keep Alice, the export and the Acme ledger; change only the context or the policies.':
    'Mantenha Alice, a ação de exportação e o livro-razão da Acme. Altere apenas o contexto ou as políticas.',
  'So the first answer was no for want of a permit, not because anything forbade it: Cedar denies whatever no policy permits.':
    'O Cedar negou a primeira requisição por padrão. Para aquela requisição, não se aplicava nenhum permit nem forbid.',
  'Find when a customer may be deleted': 'Descobrir quando um cliente pode ser excluído',
  'Carol administers her tenant and may do anything in it. She asks to delete one of its customers, and Cedar says no.':
    'Carol administra seu locatário e tem permissão para realizar qualquer ação nele. Ela solicita a exclusão de um cliente e o Cedar nega a requisição.',
  'Keep Carol, the deletion and the Acme customer; change only the context.':
    'Mantenha Carol, a ação de exclusão e o cliente da Acme. Altere apenas o contexto.',
  'So the first answer was no although a permit held: a forbid held too, and a forbid is never overridden. What changed is the one thing that forbid makes an exception for.':
    'Na primeira avaliação, um permit e um forbid se aplicavam à requisição. O Cedar deu prioridade ao forbid e negou a requisição. A alteração no contexto atende à única exceção prevista nesse forbid.',

  // The help and legend: how the model is read and moved around.
  'How to read the model and move around it.': 'Como interpretar o modelo e navegar por ele.',
  'Two levels': 'Dois níveis',
  'The <ink>overview</ink> shows the platform as its kinds of service, in the four layers a request crosses: entry, identity, compute, data. A piece there stands for every service of its kind and says how many; its figures are theirs, added up. The two detailed arrangements show every service on its own, by region or by dependency tier. Opening a service from a list or from a kind takes you to it there.':
    'A <ink>visão geral</ink> agrupa os serviços por tipo nas quatro camadas que uma requisição atravessa (entrada, identidade, computação e dados). Cada peça representa um tipo, mostra quantos serviços há nele e agrega seus dados. As duas disposições detalhadas mostram cada serviço individualmente, por região ou por camada de dependência. Abra um serviço na lista ou no grupo para vê-lo em detalhe.',
  Camera: 'Câmera',
  '<ink>Drag</ink> to orbit': '<ink>Arrastar</ink> para orbitar',
  '<ink>Right-drag</ink> or <ink>two-finger drag</ink> to pan':
    '<ink>Arrastar com o botão direito</ink> ou <ink>arrastar com dois dedos</ink> para deslocar a vista',
  '<ink>Scroll</ink> or <ink>pinch</ink> to zoom toward the pointer':
    '<ink>Rolar</ink> ou <ink>fazer o gesto de pinça</ink> para ajustar o zoom na direção do ponteiro',
  '<ink>Click</ink> a service or a connection to inspect it':
    '<ink>Clicar</ink> em um serviço ou em uma conexão para ver os detalhes',
  '<ink>Double-click</ink> a service to move in on it, or a plate to move in on its region':
    '<ink>Clicar duas vezes</ink> em um serviço ou na placa de uma região para aproximar a câmera',
  '<ink>Point</ink> at a service to see what it is connected to; selecting it keeps that neighbourhood in front while the rest recedes':
    '<ink>Passar o ponteiro</ink> sobre um serviço para ver suas conexões. Ao selecionar o serviço, as conexões ficam em destaque',
  'Tracing a request, or an incident among every service, takes the camera to its path; taking the camera yourself stops that':
    'A câmera acompanha o caminho de uma requisição ou de um incidente na visualização detalhada. Para interromper esse acompanhamento, mova a câmera',
  Keyboard: 'Teclado',
  Space: 'Espaço',
  'Play or pause the simulation': 'Reproduzir ou pausar a simulação',
  'Reset the camera': 'Redefinir a câmera',
  'Move in on what is selected': 'Aproximar a câmera da seleção',
  'Let go of the selection, then put the panels away':
    'Limpar a seleção e, em seguida, fechar os painéis',
  'Go to anything: a service, a region, a scenario, an action':
    'Buscar um serviço, uma região, um cenário ou uma ação',
  'Search services': 'Buscar serviços',
  'Next arrangement: overview, by region, by dependency':
    'Próxima disposição: visão geral, por região, por dependência',
  'Switch between the 3D view and the table': 'Alternar entre o modelo 3D e a tabela',
  'Toggle the performance overlay': 'Mostrar ou ocultar o painel de desempenho',
  'Open this help': 'Abrir esta ajuda',
  'On the timeline: step 5 s (hold Shift for 30 s)':
    'Mover 5 s na linha do tempo (mantenha Shift pressionado para mover 30 s)',

  // The help and legend: the state of a service, traffic, time.
  'State of a service': 'Estado de um serviço',
  'Colour is an answer. <blue>Blue</blue> answers you: what you selected, the request you are following. The other colours answer the data: something is not normal. A service that is well is neutral, and has no mark in any list.':
    'O <blue>azul</blue> destaca sua seleção e a requisição que você acompanha. As outras cores indicam que algo está fora do normal. Serviços saudáveis têm cor neutra e aparecem sem marca nas listas.',
  'Neutral piece, no mark; its part runs evenly': 'Peça neutra e sem marca, com movimento regular',
  'Amber piece and a lamp; its part hesitates':
    'Peça âmbar com uma luz acesa e movimento irregular',
  'Red piece and a lamp; its part is jammed':
    'Peça vermelha com uma luz acesa e o mecanismo emperrado',
  'Pale piece; its part hangs crooked and still':
    'Peça esmaecida com a parte móvel inclinada e parada',
  'In the overview a lamp under a neutral piece means some of that kind are affected, and its part hesitates; the piece itself takes the colour, and the manner, when all of them are. A red badge with a cross marks where a request was stopped.':
    'Na visão geral, quando apenas alguns serviços de um tipo são afetados, uma luz acende sob a peça neutra e seu mecanismo se move de forma irregular. Quando todos são afetados, a cor e o movimento da peça indicam o estado do grupo. Um selo vermelho com uma cruz marca onde a requisição foi bloqueada.',
  'Every bead is a share of the requests on a connection; how many there are follows the request rate. Ordinary traffic is told apart by shape. Traffic that went wrong takes a colour once it amounts to something: errors above one request in a hundred, rejections above one in ten. Below that it keeps its shape and stays ink. Rejected requests stop short of their target.':
    'Cada ponto representa uma parcela das requisições de uma conexão. Quanto maior a taxa de requisições, mais pontos aparecem. A forma distingue o tráfego comum. O tráfego com problemas ganha cor quando os erros passam de 1 em cada 100 requisições ou as rejeições passam de 1 em cada 10. Abaixo desses limites, os pontos mantêm a forma e a cor do texto. Requisições rejeitadas param antes do destino.',
  Time: 'Tempo',
  "The clock is the simulation's own. The cursor is either at the <ink>simulation's now</ink>, where new history is being made, or in its <ink>history</ink>, which is re-simulated exactly as it happened; either can be <ink>paused</ink>. A phase of an incident is timed from the start of that incident (<n>+0:14</n>); an event shows both that and the simulation clock, which differ by when the incident began.":
    'A simulação tem seu próprio relógio. No <ink>agora da simulação</ink>, o tempo avança e acrescenta novos dados ao histórico. No <ink>histórico</ink>, a simulação reproduz o que aconteceu com exatidão. O relógio pode estar <ink>pausado</ink> em ambos. O horário de cada fase é contado a partir do início do incidente (<n>+0:14</n>). Cada evento mostra o tempo desde o início do incidente e a posição no relógio da simulação.',

  // The help and legend: what kind of statement a line of a report is.
  'Why something happened': 'Por que algo aconteceu',
  'An incident can be read back from its own record: select a phase, an event or the summary. Each line says what kind of statement it is.':
    'Selecione uma fase, um evento ou o resumo para consultar o registro do incidente. Cada linha indica o tipo de informação que apresenta.',
  '{term}: written in the scenario file. The scenario does this by itself.':
    '{term}: escrito no arquivo do cenário. O cenário faz isso por conta própria.',
  '{term}: a relation of the topology the model follows. A dependency carries failures back to its callers; added traffic flows on to what is called.':
    '{term}. O modelo usa as relações da topologia. As falhas de uma dependência afetam os serviços que a chamam. O tráfego adicional segue para os serviços chamados.',
  '{term}: an event or a figure the engine recorded during the run.':
    '{term}: um evento ou um número que o motor registrou durante a execução.',
  '{term}: none of the relations the report knows accounts for it, and it does not guess.':
    '{term}. As relações analisadas pelo relatório não explicam o que aconteceu.',

  // The help and legend: the pieces, one per kind of service.
  'Kinds of service': 'Tipos de serviço',
  'A gate; its door turns as requests pass':
    'Um portão com uma porta que gira quando passam requisições',
  'A shield; its lock turns for each sign-in': 'Um escudo com uma fechadura que gira a cada login',
  'A cedar; its tiers turn a notch for each decision':
    'Um cedro cujos níveis giram um passo a cada decisão',
  'A hexagonal cell; its lid turns one side on':
    'Uma célula hexagonal cuja tampa gira uma face por vez',
  'A shipping container; its doors open to take work in':
    'Um contêiner de carga cujas portas se abrem para receber tarefas',
  'A lightning bolt; it strikes once for each call': 'Um raio que cai a cada chamada',
  'Slabs standing in line; the line moves up as they are taken':
    'Uma fila de blocos verticais que avança à medida que eles são retirados',
  'A stack of platters, turning': 'Uma pilha de discos giratórios',
  'A bucket; objects are lifted out and put back':
    'Um balde de onde os objetos saem e para onde voltam',
  'A desk globe, turning': 'Um globo de mesa giratório',
  'A lighthouse above the edge; its lamp sweeps round': 'Um farol acima da borda cuja luz gira',
  'A pawn; its head lifts as it asks': 'Um peão que ergue a cabeça quando faz uma requisição',
  'A distributor; its arm turns to the next spout for each request':
    'Um distribuidor cujo braço gira para a próxima saída a cada requisição',
  'A server in its case; its fan turns while it works':
    'Um servidor no gabinete cuja ventoinha gira enquanto ele trabalha',
  'A ship’s wheel; it turns a spoke for each change it makes':
    'Um timão que gira um raio a cada mudança que faz',
  'A rotary card file; it turns a card for each lookup':
    'Um fichário rotativo que gira uma ficha a cada consulta',
  'Two reels; the tape runs from one to the other as events are written':
    'Dois carretéis; a fita passa de um para o outro à medida que os eventos são gravados',
  "The part of a piece that moves runs at the pace of its service's traffic: faster under a surge, slower as traffic thins, and still when nothing passes.":
    'O mecanismo de cada peça acompanha o ritmo do tráfego do serviço. Ele acelera nos picos, desacelera quando o tráfego diminui e fica parado quando não há tráfego.',
  'AEGIS is a simulation. The platform, its metrics and every incident are synthetic and deterministic; no real system is scanned or attacked.':
    'O AEGIS é uma simulação. A plataforma, suas métricas e todos os incidentes simulados são sintéticos e determinísticos. A simulação não faz varreduras nem ataques em sistemas reais.',

  // The command palette. A title and its hint are what a search matches.
  'Go to a service or run a command': 'Ir para um serviço ou executar um comando',
  'Search services, regions, scenarios and actions': 'Buscar serviços, regiões, cenários e ações',
  'Orders DB, frame EU West, start a scenario…':
    'Orders DB, enquadrar EU West, iniciar um cenário…',
  'Nothing matches. Try the name of a service, a region or a scenario.':
    'Nenhum resultado. Tente buscar pelo nome de um serviço, uma região ou um cenário.',
  Results: 'Resultados',
  'Pause the simulation': 'Pausar a simulação',
  'Resume the simulation': 'Retomar a simulação',
  'Show the table view': 'Mostrar a visualização em tabela',
  'Show the 3D model': 'Mostrar o modelo 3D',
  'Show the overview': 'Mostrar a visão geral',
  'Show every service, by region': 'Mostrar todos os serviços, por região',
  'Show every service, by dependency tier': 'Mostrar todos os serviços, por camada de dependência',
  'Use the light theme': 'Usar o tema claro',
  'Use the night theme': 'Usar o tema noturno',
  'Follow the system theme': 'Seguir o tema do sistema',
  'Open the authorization explorer': 'Abrir o explorador de autorização',
  'See who may do what': 'Ver quem pode fazer o quê',
  'the same incident twice, A/B': 'o mesmo incidente duas vezes, A/B',
  'Take a guided challenge': 'Fazer um desafio guiado',
  'objectives, training': 'objetivos, treinamento',
  'link, file, reproduce': 'link, arquivo, reproduzir',
  'editor, phases, effects': 'editor, fases, efeitos',
  'Open integrations': 'Abrir as integrações',
  'Import or export the platform files': 'Importar ou exportar os arquivos da plataforma',
  'topology, scenarios, Cedar policies': 'topologia, cenários, políticas Cedar',
  'Open settings': 'Abrir as configurações',
  'Open help and legend': 'Abrir a ajuda e a legenda',
  'Start {scenario}': 'Iniciar {scenario}',
  'incident scenario': 'cenário de incidente',
  'Frame {region}': 'Enquadrar {region}',

  // Saving a session, sharing it, and opening one.
  Session: 'Sessão',
  'What reproduces the experiment on screen: the platform, the seed, the commands issued, the moment and the view. Opening a session simulates it again; no figure travels with it.':
    'A sessão guarda a plataforma, a semente, os comandos enviados, o momento e a visualização. Ao abrir a sessão, a simulação recalcula os valores para reproduzir o experimento na tela.',
  'The link you followed carries a session. Nothing has been changed yet.':
    'Este link contém uma sessão que será carregada quando você confirmar.',
  'This session': 'Esta sessão',
  'Reading the timeline…': 'Lendo a linha do tempo…',
  Platform: 'Plataforma',
  ', as bundled with AEGIS': ', incluída no AEGIS',
  ', with its {n} file': ', com {n} arquivo',
  ', with its {n} files': ', com {n} arquivos',
  Seed: 'Semente',
  Length: 'Duração',
  ', opened paused at {time}': ', pausa em {time} ao abrir',
  Commands: 'Comandos',
  View: 'Visualização',
  'arranged by layers': 'disposta por camadas',
  'arranged by regions': 'disposta por regiões',
  'arranged by dependencies': 'disposta por dependências',
  'as a table': 'em tabela',
  'with node {id} selected': 'com o serviço {id} selecionado',
  'with edge {id} selected': 'com a conexão {id} selecionada',
  'with group {id} selected': 'com o tipo de serviço {id} selecionado',
  'with {selection} selected': 'com {selection} selecionado',
  'the overview': 'a visão geral',
  'This platform is not the bundled one, so the file carries its files too. A link cannot.':
    'Para compartilhar esta plataforma personalizada, salve a sessão como arquivo. Assim você inclui os arquivos da plataforma.',
  'This session omits {items}.': 'Esta sessão deixa de fora {items}.',
  '{n} authorization decision evaluated by hand': '{n} decisão de autorização avaliada manualmente',
  '{n} authorization decisions evaluated by hand':
    '{n} decisões de autorização avaliadas manualmente',
  'This timeline cannot be reproduced from a session: {reason}.':
    'Esta linha do tempo não pode ser reproduzida a partir de uma sessão: {reason}.',
  'part of it is missing': 'falta uma parte dela',
  'Save as a file': 'Salvar como arquivo',
  'Copy a link': 'Copiar link',
  'The session travels in the part of the address after #, which is not sent to any server':
    'A sessão fica no trecho do endereço após o #. O navegador não envia esse trecho ao servidor',
  'The session could not be read.': 'A sessão não pôde ser lida.',
  'Link to this session copied.': 'Link para esta sessão copiado.',
  'The link could not be copied to the clipboard.':
    'O link não pôde ser copiado para a área de transferência.',
  'Open a session': 'Abrir uma sessão',
  'Choose a session file': 'Escolher um arquivo de sessão',
  'Session file to open': 'Selecionar o arquivo de sessão',
  'The file could not be read.': 'O arquivo não pôde ser lido.',
  'This session holds:': 'Esta sessão contém:',
  'Open this session': 'Abrir esta sessão',
  'Simulating it again…': 'Reproduzindo a sessão…',
  'Not now': 'Agora não',
  'Opening replaces the timeline in use for everyone connected.':
    'Ao abrir a sessão, você substitui a linha do tempo atual para todas as pessoas conectadas.',
  'Opening replaces the timeline in use and the platform files for everyone connected.':
    'Ao abrir a sessão, você substitui a linha do tempo atual e os arquivos da plataforma para todas as pessoas conectadas.',
  'Session opened: its timeline was simulated again.':
    'Sessão aberta com a linha do tempo reconstruída pela simulação.',

  // What a session holds, line by line, and why one cannot be read.
  '{at} starts {scenario}': '{at} inicia {scenario}',
  '{at} stops the running scenario': '{at} interrompe o cenário em execução',
  '{at} places a fault by hand ({effect})': '{at} aplica uma falha manualmente ({effect})',
  '{at} lifts a fault placed by hand': '{at} remove uma falha aplicada manualmente',
  '{at} lifts every fault placed by hand': '{at} remove todas as falhas aplicadas manualmente',
  'No command: time simply passes.': 'O tempo avança sem executar comandos.',
  'This platform was imported; a link cannot carry its files. Save the file.':
    'Salve a sessão como arquivo para incluir os arquivos da plataforma importada.',
  'This session holds too many commands for a link. Save the file.':
    'A sessão tem mais comandos do que cabem em um link. Salve-a como arquivo.',
  'This is not a session file: it is not JSON.': 'Este não é um arquivo de sessão: não é JSON.',
  'This session file is not in a format this version reads: {problem}':
    'O formato deste arquivo de sessão é incompatível com esta versão. {problem}',
  'This is not a session file. One is saved from “{command}”.':
    'Este arquivo não é uma sessão do AEGIS. Para salvar uma sessão, use “{command}”.',
  'The session in this link is damaged and cannot be read.':
    'A sessão deste link está danificada e não pode ser lida.',
  'Its platform could not be imported. {reason}':
    'Não foi possível importar a plataforma desta sessão. {reason}',
} as const satisfies Record<string, string>;
