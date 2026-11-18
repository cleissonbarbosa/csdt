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
    'Uma plataforma de nuvem fictícia, simulada, para desmontar',
  'Each piece is a kind of service. Select one to see what it does and how it is doing; everything you see is computed by the simulation, and Cedar decides every authorization. Where would you like to start?':
    'Cada peça é um tipo de serviço. Selecione uma para ver o que esse tipo faz e como está; tudo o que você vê é calculado pela simulação, e o Cedar decide cada autorização. Por onde você quer começar?',
  'Dismiss; this does not come back': 'Dispensar; isto não volta mais',
  'Understand the platform': 'Entender a plataforma',
  'Its {n} kinds of service, the path a request takes through them, and the signals that say how it is doing.':
    'Seus {n} tipos de serviço, o caminho que uma requisição faz por eles e os sinais que dizem como ela está.',
  'Its services, the path a request takes through them, and the signals that say how it is doing.':
    'Seus serviços, o caminho que uma requisição faz por eles e os sinais que dizem como ela está.',
  'Investigate a failure': 'Investigar uma falha',
  'Start an incident, watch it spread, and read back where it began and why each service followed.':
    'Iniciar um incidente, vê-lo se espalhar e ler no registro onde ele começou e por que cada serviço o seguiu.',
  'Ask Cedar who may do what, see which policy decides, and follow the request across the model.':
    'Perguntar ao Cedar quem pode fazer o quê, ver qual política decide e seguir a requisição pelo modelo.',
  'Or <guide>take a guided challenge</guide>: a question about the platform, checked against the model. All of this stays in the menu at the end of the bar.':
    'Ou <guide>faça um desafio guiado</guide>: uma pergunta sobre a plataforma, conferida com o modelo. Tudo isso continua no menu no fim da barra.',

  // The guide card: the list of challenges and the one under way.
  'Close the guide': 'Fechar o guia',
  "Each asks one question about the platform. Your answer is checked against the model itself: the record of the incident, or Cedar's own decision.":
    'Cada um faz uma pergunta sobre a plataforma. Sua resposta é conferida com o próprio modelo: o registro do incidente ou a própria decisão do Cedar.',
  '{n} of {total} solved': '{n} de {total} resolvidos',
  'Start over': 'Recomeçar',
  'The one you were sent': 'O que enviaram para você',
  solved: 'resolvido',
  Again: 'Refazer',
  'All challenges': 'Todos os desafios',
  'Next: {title}': 'Próximo: {title}',
  'Copy a link to this challenge': 'Copiar um link para este desafio',
  'Link copied': 'Link copiado',
  'Read from the events and figures the engine recorded in this run.':
    'Lido dos eventos e dos números que o motor registrou nesta execução.',
  'What the Cedar policy engine answered, or the text of a policy it holds.':
    'O que o motor de políticas Cedar respondeu, ou o texto de uma política que ele guarda.',

  // What every challenge says before and while it is answered.
  'The platform in use cannot run the scenario this challenge needs.':
    'A plataforma em uso não pode rodar o cenário de que este desafio precisa.',
  'Answer: {service}': 'Responder: {service}',
  'That is a kind of service. Open it and select one service.':
    'Isso é um tipo de serviço. Abra-o e selecione um serviço.',
  'Select a service on the model to answer with it.':
    'Selecione um serviço no modelo para responder com ele.',
  'There is no incident to answer about yet.': 'Ainda não há incidente sobre o qual responder.',
  'There is no incident to answer about.': 'Não há incidente sobre o qual responder.',
  'Start the challenge again and let the incident run.':
    'Comece o desafio de novo e deixe o incidente correr.',
  'Not {service}.': 'Não é {service}.',

  // Where a cascade begins.
  'Find where the cascade begins': 'Encontrar onde a cascata começa',
  'Services start failing one after another. One of them is where it began; the rest follow from it.':
    'Serviços começam a falhar um após o outro. Um deles é onde tudo começou; os demais decorrem dele.',
  'Starts the cascading failure scenario from a clean simulation.':
    'Inicia o cenário de falha em cascata a partir de uma simulação limpa.',
  'Watch which services leave their normal state, and in what order. Then select the service you think it began at.':
    'Observe quais serviços saem do estado normal, e em que ordem. Depois selecione o serviço em que você acha que tudo começou.',
  'In its first phase the scenario holds it to {effect}.':
    'Na primeira fase, o cenário o submete a {effect}.',
  '{service} became {health} at {at} because {why}.':
    '{service} ficou {health} em {at} porque {why}.',
  '{service} became {health} at {at}.': '{service} ficou {health} em {at}.',
  '{service} became {health} at {at} because of nothing the report can point to.':
    '{service} ficou {health} em {at} sem causa que o relatório consiga apontar.',
  'Yes: it begins at {service}.': 'Sim: começa em {service}.',
  'No service has left its normal state yet. Let the incident run a little longer.':
    'Nenhum serviço saiu do estado normal ainda. Deixe o incidente correr um pouco mais.',
  '{service} has stayed normal so far: the incident has not reached it. Look at the services whose lamp is lit.':
    '{service} continua normal até agora: o incidente não chegou a ele. Olhe os serviços com a luz acesa.',
  '{n} service left the normal state before it did. Follow what it depends on.':
    '{n} serviço saiu do estado normal antes dele. Siga aquilo de que ele depende.',
  '{n} services left the normal state before it did. Follow what it depends on.':
    '{n} serviços saíram do estado normal antes dele. Siga aquilo de que ele depende.',
  'Nothing was seen to fail before it, but the run says something acts on another service first. Follow what it calls.':
    'Nada foi visto falhar antes dele, mas a execução diz que algo age primeiro sobre outro serviço. Siga o que ele chama.',
  'Not {service}: it is a consequence.': 'Não é {service}: é uma consequência.',

  // Where injected traffic is stopped: the flood, and the contractor.
  'Nothing is stopping it yet.': 'Nada o está barrando ainda.',
  'Right now {share} of “{flow}” still gets through.':
    'Neste momento, {share} de “{flow}” ainda passa.',
  'The injected traffic has not started or has already ended.':
    'O tráfego injetado ainda não começou ou já terminou.',
  "The scenario's mitigation phase, “{phase}”, began at {at}; it takes a few seconds to ease in.":
    'A fase de mitigação do cenário, “{phase}”, começou em {at}; leva alguns segundos para fazer efeito por completo.',
  'The scenario has not reached its mitigation phase. Let it run.':
    'O cenário ainda não chegou à fase de mitigação. Deixe-o correr.',
  'Yes: it is stopped at {service}.': 'Sim: é barrado em {service}.',
  'Of {total} req/s of “{flow}”, {passed} req/s get past it (turned away by: {reason}).':
    'De {total} req/s de “{flow}”, {passed} req/s passam por ele (recusadas por: {reason}).',
  'Of {total} req/s of “{flow}”, {passed} req/s get past it.':
    'De {total} req/s de “{flow}”, {passed} req/s passam por ele.',
  '{service} is on the route, but it is not where most of this traffic is turned away.':
    '{service} está na rota, mas não é onde a maior parte desse tráfego é recusada.',
  'This traffic does not pass through {service}. Its route is the one drawn on the model.':
    'Esse tráfego não passa por {service}. A rota dele é a que está desenhada no modelo.',
  "Only {share} of “{flow}” is still delivered: look for where the route's beads stop.":
    'Só {share} de “{flow}” ainda é entregue: procure onde os pontos de tráfego da rota param.',
  'Find where the flood is stopped': 'Encontrar onde a enxurrada é barrada',
  'Hostile traffic pours in from outside. After a while a mitigation engages and most of it is turned away at one service.':
    'Tráfego hostil chega em massa de fora. Depois de um tempo, uma mitigação entra em ação e a maior parte dele é recusada em um serviço.',
  'Starts the DDoS surge scenario from a clean simulation.':
    'Inicia o cenário de onda de DDoS a partir de uma simulação limpa.',
  'Follow the incident’s route across the model. When the mitigation has engaged, select the service the flood is being stopped at.':
    'Siga a rota do incidente pelo modelo. Quando a mitigação tiver entrado em ação, selecione o serviço em que a enxurrada está sendo barrada.',
  'The scenario prescribes the rejection at this service; how much load that takes off what lies behind it is the model’s doing.':
    'O cenário prescreve a rejeição neste serviço; quanto de carga isso tira do que está atrás dele é obra do modelo.',
  'Find where the contractor is stopped': 'Encontrar onde o terceirizado é barrado',
  'A contractor of another tenant is signed in, and asks for things that are not theirs to have. None of it reaches the data.':
    'Um terceirizado de outro locatário está autenticado e pede coisas que não lhe cabem. Nada disso chega aos dados.',
  'Starts the Cedar authorization denial scenario from a clean simulation.':
    'Inicia o cenário de negação de autorização do Cedar a partir de uma simulação limpa.',
  'Follow the route of the contractor’s requests. Once they ask for what they may not have, select the service they are stopped at.':
    'Siga a rota das requisições do terceirizado. Quando elas pedirem o que não podem ter, selecione o serviço em que são barradas.',
  'No scenario can write a denial. This traffic stops at the authorizer because Cedar, asked the request it is made of, denies it under the policies in force.':
    'Nenhum cenário pode escrever uma negação. Este tráfego para no autorizador porque o Cedar, consultado sobre a requisição de que ele é feito, a nega pelas políticas em vigor.',

  // The region that went dark.
  'Find the region that went dark': 'Encontrar a região que se apagou',
  'A whole cloud region stops answering. Traffic that went to it is sent elsewhere, and what stands there is out of reach.':
    'Uma região de nuvem inteira para de responder. O tráfego que ia para ela é enviado a outro lugar, e o que fica lá está fora de alcance.',
  'Starts the regional outage scenario from a clean simulation.':
    'Inicia o cenário de queda regional a partir de uma simulação limpa.',
  'Watch the model, by region if you like. When a region has gone dark, select any service that stands in it.':
    'Observe o modelo, por região se quiser. Quando uma região tiver se apagado, selecione qualquer serviço que fique nela.',
  'No region is dark yet.': 'Nenhuma região se apagou ainda.',
  '{region} has {n} of {total} services out of their normal state, and still answers {share} of what it is asked.':
    '{region} tem {n} de {total} serviços fora do estado normal e ainda responde a {share} do que lhe pedem.',
  'Every region is still serving. Let the incident run a little longer.':
    'Todas as regiões ainda estão atendendo. Deixe o incidente correr um pouco mais.',
  '{n} of the {total} services that stand in {region} are out of their normal state.':
    '{n} dos {total} serviços que ficam em {region} estão fora do estado normal.',
  '{regions} is still serving.': '{regions} ainda está atendendo.',
  '{regions} are still serving.': '{regions} ainda estão atendendo.',
  'Yes: {region} is dark.': 'Sim: {region} está apagada.',
  'It stands in {region}, where {n} of {total} services are out of their normal state: that region still answers.':
    'Ele fica em {region}, onde {n} de {total} serviços estão fora do estado normal: essa região ainda responde.',
  'It stands in {region}, where no service is out of their normal state: that region still answers.':
    'Ele fica em {region}, onde nenhum serviço está fora do estado normal: essa região ainda responde.',
  'One region has {n} of its {total} services out at once. Arranged by region, its plate is the one that has gone dark.':
    'Uma região tem {n} dos seus {total} serviços fora do normal ao mesmo tempo. Na disposição por região, a placa dela é a que se apagou.',

  // A request Cedar denies, and the one circumstance under which it is allowed.
  'Opens the request tracer with the request. The simulation is left as it is.':
    'Abre o rastreador de requisições com a requisição. A simulação fica como está.',
  'Evaluate the request and read the policies. Then change one thing about the circumstances of the request (not who asks, nor for what) so that Cedar allows it, and evaluate again.':
    'Avalie a requisição e leia as políticas. Depois mude uma coisa nas circunstâncias da requisição (não quem pede, nem o quê) para que o Cedar a permita, e avalie de novo.',
  'The policies in use do not know this request.':
    'As políticas em uso não conhecem esta requisição.',
  'Check my latest result': 'Conferir meu último resultado',
  'Evaluate the request in the tracer first.': 'Avalie a requisição no rastreador primeiro.',
  'Nothing has been evaluated yet.': 'Nada foi avaliado ainda.',
  'Press “Evaluate with Cedar” in the tracer.': 'Clique em “Avaliar com o Cedar” no rastreador.',
  'That is another request.': 'Essa é outra requisição.',
  'Cedar answered for {principal} asking to {action} {resource}. {keep}':
    'O Cedar respondeu ao pedido de {principal} para {action} em {resource}. {keep}',
  'Cedar allows it under {context}, and names {policies} as the policy that decides.':
    'O Cedar permite a requisição com {context} e aponta {policies} como a política que decide.',
  'Yes: now it is allowed.': 'Sim: agora ela é permitida.',
  'Still denied.': 'Ainda negada.',
  'Under {context} no policy decided this: nothing permits it, and Cedar denies by default. The decision lists, policy by policy, the permit that came closest; read its “when”.':
    'Com {context}, nenhuma política decidiu isto: nada a permite, e o Cedar nega por padrão. A decisão lista, política por política, o permit que chegou mais perto; leia o “when” dele.',
  'Cedar names {policies}: a forbid, which no permit overrides. Read what it makes an exception for.':
    'O Cedar aponta {policies}: um forbid, que nenhum permit anula. Leia a exceção que ele abre.',
  'Cedar names {policies}.': 'O Cedar aponta {policies}.',
  '{policies} was switched off for this evaluation; the answer asked for is the one under every policy.':
    '{policies} foi desligada nesta avaliação; a resposta pedida é a que vale com todas as políticas.',
  '{policies} were switched off for this evaluation; the answer asked for is the one under every policy.':
    '{policies} foram desligadas nesta avaliação; a resposta pedida é a que vale com todas as políticas.',
  'Explain why this export was denied': 'Explicar por que esta exportação foi negada',
  'Alice is a finance analyst of the tenant that owns the ledger. She asks to export it, and Cedar says no.':
    'Alice é analista financeira do locatário dono do livro-razão. Ela pede para exportá-lo, e o Cedar diz não.',
  'Keep Alice, the export and the Acme ledger; change only the context or the policies.':
    'Mantenha Alice, a exportação e o livro-razão da Acme; mude só o contexto ou as políticas.',
  'So the first answer was no for want of a permit, not because anything forbade it: Cedar denies whatever no policy permits.':
    'Então a primeira resposta foi não por falta de um permit, e não porque algo a proibisse: o Cedar nega tudo o que nenhuma política permite.',
  'Find when a customer may be deleted': 'Descobrir quando um cliente pode ser excluído',
  'Carol administers her tenant and may do anything in it. She asks to delete one of its customers, and Cedar says no.':
    'Carol administra o locatário dela e pode fazer qualquer coisa nele. Ela pede para excluir um dos clientes dele, e o Cedar diz não.',
  'Keep Carol, the deletion and the Acme customer; change only the context.':
    'Mantenha Carol, a exclusão e o cliente da Acme; mude só o contexto.',
  'So the first answer was no although a permit held: a forbid held too, and a forbid is never overridden. What changed is the one thing that forbid makes an exception for.':
    'Então a primeira resposta foi não, embora um permit valesse: um forbid também valia, e um forbid nunca é anulado. O que mudou é a única coisa para a qual esse forbid abre exceção.',

  // The help and legend: how the model is read and moved around.
  'How to read the model and move around it.': 'Como ler o modelo e se mover por ele.',
  'Two levels': 'Dois níveis',
  'The <ink>overview</ink> shows the platform as its kinds of service, in the four layers a request crosses: entry, identity, compute, data. A piece there stands for every service of its kind and says how many; its figures are theirs, added up. The two detailed arrangements show every service on its own, by region or by dependency tier. Opening a service from a list or from a kind takes you to it there.':
    'A <ink>visão geral</ink> mostra a plataforma como os seus tipos de serviço, nas quatro camadas que uma requisição atravessa: entrada, identidade, computação, dados. Ali, uma peça representa todos os serviços do seu tipo e diz quantos são; os números dela são os deles, somados. As duas disposições detalhadas mostram cada serviço por si, por região ou por camada de dependência. Abrir um serviço a partir de uma lista ou de um tipo leva você até ele lá.',
  Camera: 'Câmera',
  '<ink>Drag</ink> to orbit': '<ink>Arrastar</ink> para orbitar',
  '<ink>Right-drag</ink> or <ink>two-finger drag</ink> to pan':
    '<ink>Arrastar com o botão direito</ink> ou <ink>arrastar com dois dedos</ink> para deslocar a vista',
  '<ink>Scroll</ink> or <ink>pinch</ink> to zoom toward the pointer':
    '<ink>Rolar</ink> ou <ink>pinçar</ink> para dar zoom na direção do ponteiro',
  '<ink>Click</ink> a service or a connection to inspect it':
    '<ink>Clicar</ink> em um serviço ou em uma conexão para inspecionar',
  '<ink>Double-click</ink> a service to move in on it, or a plate to move in on its region':
    '<ink>Clique duplo</ink> em um serviço para se aproximar dele, ou em uma placa para se aproximar da sua região',
  '<ink>Point</ink> at a service to see what it is connected to; selecting it keeps that neighbourhood in front while the rest recedes':
    '<ink>Apontar</ink> para um serviço para ver a que ele está conectado; selecioná-lo mantém essa vizinhança à frente enquanto o resto se afasta',
  'Tracing a request, or an incident among every service, takes the camera to its path; taking the camera yourself stops that':
    'Rastrear uma requisição, ou um incidente entre todos os serviços, leva a câmera até o seu caminho; mover a câmera você mesmo interrompe isso',
  Keyboard: 'Teclado',
  Space: 'Espaço',
  'Play or pause the simulation': 'Reproduzir ou pausar a simulação',
  'Reset the camera': 'Redefinir a câmera',
  'Move in on what is selected': 'Aproximar do que está selecionado',
  'Let go of the selection, then put the panels away':
    'Desfazer a seleção, depois guardar os painéis',
  'Go to anything: a service, a region, a scenario, an action':
    'Ir para qualquer coisa: um serviço, uma região, um cenário, uma ação',
  'Search services': 'Buscar serviços',
  'Next arrangement: overview, by region, by dependency':
    'Próxima disposição: visão geral, por região, por dependência',
  'Switch between the 3D view and the table': 'Alternar entre a vista 3D e a tabela',
  'Toggle the performance overlay': 'Mostrar ou ocultar o painel de desempenho',
  'Open this help': 'Abrir esta ajuda',
  'On the timeline: step 5 s (hold Shift for 30 s)':
    'Na linha do tempo: passo de 5 s (segure Shift para 30 s)',

  // The help and legend: the state of a service, traffic, time.
  'State of a service': 'Estado de um serviço',
  'Colour is an answer. <blue>Blue</blue> answers you: what you selected, the request you are following. The other colours answer the data: something is not normal. A service that is well is neutral, and has no mark in any list.':
    'A cor é uma resposta. O <blue>azul</blue> responde a você: o que você selecionou, a requisição que está acompanhando. As outras cores respondem aos dados: algo não está normal. Um serviço que está bem é neutro e não tem marca em nenhuma lista.',
  'Neutral piece, no mark; its part runs evenly':
    'Peça neutra, sem marca; sua parte móvel trabalha de modo regular',
  'Amber piece and a lamp; its part hesitates': 'Peça âmbar e uma luz; sua parte móvel hesita',
  'Red piece and a lamp; its part is jammed':
    'Peça vermelha e uma luz; sua parte móvel está travada',
  'Pale piece; its part hangs crooked and still':
    'Peça pálida; sua parte móvel pende torta e parada',
  'In the overview a lamp under a neutral piece means some of that kind are affected, and its part hesitates; the piece itself takes the colour, and the manner, when all of them are. A red badge with a cross marks where a request was stopped.':
    'Na visão geral, uma luz sob uma peça neutra significa que alguns serviços daquele tipo estão afetados, e sua parte móvel hesita; a própria peça assume a cor, e o jeito, quando todos estão. Um selo vermelho com uma cruz marca onde uma requisição foi barrada.',
  'Every bead is a share of the requests on a connection; how many there are follows the request rate. Ordinary traffic is told apart by shape. Traffic that went wrong takes a colour once it amounts to something: errors above one request in a hundred, rejections above one in ten. Below that it keeps its shape and stays ink. Rejected requests stop short of their target.':
    'Cada ponto de tráfego é uma parcela das requisições em uma conexão; quantos há acompanha a taxa de requisições. O tráfego comum se distingue pela forma. O tráfego que deu errado ganha cor quando passa a ser relevante: erros acima de uma requisição em cem, rejeições acima de uma em dez. Abaixo disso, mantém a forma e fica na cor do texto. Requisições rejeitadas param antes do destino.',
  Time: 'Tempo',
  "The clock is the simulation's own. The cursor is either at the <ink>simulation's now</ink>, where new history is being made, or in its <ink>history</ink>, which is re-simulated exactly as it happened; either can be <ink>paused</ink>. A phase of an incident is timed from the start of that incident (<n>+0:14</n>); an event shows both that and the simulation clock, which differ by when the incident began.":
    'O relógio é o da própria simulação. O cursor está ou no <ink>agora da simulação</ink>, onde um novo histórico está sendo feito, ou no seu <ink>histórico</ink>, que é simulado de novo exatamente como aconteceu; qualquer um dos dois pode estar <ink>pausado</ink>. Uma fase de um incidente é cronometrada a partir do início desse incidente (<n>+0:14</n>); um evento mostra tanto isso quanto o relógio da simulação, que diferem pelo momento em que o incidente começou.',

  // The help and legend: what kind of statement a line of a report is.
  'Why something happened': 'Por que algo aconteceu',
  'An incident can be read back from its own record: select a phase, an event or the summary. Each line says what kind of statement it is.':
    'Um incidente pode ser relido a partir do seu próprio registro: selecione uma fase, um evento ou o resumo. Cada linha diz que tipo de afirmação ela é.',
  '{term}: written in the scenario file. The scenario does this by itself.':
    '{term}: escrito no arquivo do cenário. O cenário faz isso por conta própria.',
  '{term}: a relation of the topology the model follows. A dependency carries failures back to its callers; added traffic flows on to what is called.':
    '{term}: uma relação da topologia que o modelo segue. Uma dependência leva falhas de volta a quem a chama; o tráfego adicionado segue adiante para o que é chamado.',
  '{term}: an event or a figure the engine recorded during the run.':
    '{term}: um evento ou um número que o motor registrou durante a execução.',
  '{term}: none of the relations the report knows accounts for it, and it does not guess.':
    '{term}: nenhuma das relações que o relatório conhece dá conta disso, e ele não adivinha.',

  // The help and legend: the pieces, one per kind of service.
  'Kinds of service': 'Tipos de serviço',
  'A gate; its door turns as requests pass':
    'Um portão; sua porta gira conforme passam requisições',
  'A shield; its lock turns for each sign-in': 'Um escudo; sua fechadura gira a cada login',
  'A cedar; its tiers turn a notch for each decision':
    'Um cedro; seus andares giram um passo a cada decisão',
  'A hexagonal cell; its lid turns one side on':
    'Uma célula hexagonal; sua tampa gira um lado adiante',
  'A shipping container; its doors open to take work in':
    'Um contêiner de carga; suas portas se abrem para receber trabalho',
  'A lightning bolt; it strikes once for each call': 'Um raio; ele cai uma vez a cada chamada',
  'Slabs standing in line; the line moves up as they are taken':
    'Blocos em pé, em fila; a fila avança conforme eles são retirados',
  'A stack of platters, turning': 'Uma pilha de discos, girando',
  'A bucket; objects are lifted out and put back': 'Um balde; objetos são tirados e devolvidos',
  'A desk globe, turning': 'Um globo de mesa, girando',
  'A lighthouse above the edge; its lamp sweeps round':
    'Um farol acima da borda; sua luz varre em volta',
  'A pawn; its head lifts as it asks': 'Um peão; sua cabeça se ergue quando ele pede',
  "The part of a piece that moves runs at the pace of its service's traffic: faster under a surge, slower as traffic thins, and still when nothing passes.":
    'A parte de uma peça que se move anda no ritmo do tráfego do seu serviço: mais rápida num pico, mais lenta quando o tráfego diminui, e parada quando nada passa.',
  'AEGIS is a simulation. The platform, its metrics and every incident are synthetic and deterministic; no real system is observed, scanned or attacked.':
    'O AEGIS é uma simulação. A plataforma, suas métricas e todos os incidentes são sintéticos e determinísticos; nenhum sistema real é observado, escaneado ou atacado.',

  // The command palette. A title and its hint are what a search matches.
  'Go to a service or run a command': 'Ir para um serviço ou executar um comando',
  'Search services, regions, scenarios and actions': 'Buscar serviços, regiões, cenários e ações',
  'Orders DB, frame EU West, start a scenario…':
    'Orders DB, enquadrar EU West, iniciar um cenário…',
  'Nothing matches. Try the name of a service, a region or a scenario.':
    'Nada corresponde. Tente o nome de um serviço, de uma região ou de um cenário.',
  Results: 'Resultados',
  'Pause the simulation': 'Pausar a simulação',
  'Resume the simulation': 'Retomar a simulação',
  'Show the table view': 'Mostrar a vista em tabela',
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
    'O que reproduz o experimento na tela: a plataforma, a semente, os comandos dados, o momento e a vista. Abrir uma sessão a simula de novo; nenhum número vai junto.',
  'The link you followed carries a session. Nothing has been changed yet.':
    'O link que você seguiu traz uma sessão. Nada foi alterado ainda.',
  'This session': 'Esta sessão',
  'Reading the timeline…': 'Lendo a linha do tempo…',
  Platform: 'Plataforma',
  ', as bundled with AEGIS': ', como incluída no AEGIS',
  ', with its {n} file': ', com seu {n} arquivo',
  ', with its {n} files': ', com seus {n} arquivos',
  Seed: 'Semente',
  Length: 'Duração',
  ', opened paused at {time}': ', abre pausada em {time}',
  Commands: 'Comandos',
  View: 'Vista',
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
    'Esta plataforma não é a incluída, então o arquivo leva também os arquivos dela. Um link não pode.',
  'This session omits {items}.': 'Esta sessão deixa de fora {items}.',
  '{n} authorization decision evaluated by hand': '{n} decisão de autorização avaliada à mão',
  '{n} authorization decisions evaluated by hand': '{n} decisões de autorização avaliadas à mão',
  '{n} import from an integration': '{n} importação de uma integração',
  '{n} imports from an integration': '{n} importações de uma integração',
  '{first} and {second}': '{first} e {second}',
  'This timeline cannot be reproduced from a session: {reason}.':
    'Esta linha do tempo não pode ser reproduzida a partir de uma sessão: {reason}.',
  'part of it is missing': 'falta uma parte dela',
  'Save as a file': 'Salvar como arquivo',
  'Copy a link': 'Copiar um link',
  'The session travels in the part of the address after #, which is not sent to any server':
    'A sessão vai na parte do endereço depois do #, que não é enviada a nenhum servidor',
  'The session could not be read.': 'A sessão não pôde ser lida.',
  'Link to this session copied.': 'Link para esta sessão copiado.',
  'The link could not be copied to the clipboard.':
    'O link não pôde ser copiado para a área de transferência.',
  'Open a session': 'Abrir uma sessão',
  'Choose a session file': 'Escolher um arquivo de sessão',
  'Session file to open': 'Arquivo de sessão a abrir',
  'The file could not be read.': 'O arquivo não pôde ser lido.',
  'This session holds:': 'Esta sessão contém:',
  'Open this session': 'Abrir esta sessão',
  'Simulating it again…': 'Simulando de novo…',
  'Not now': 'Agora não',
  'Opening replaces the timeline in use for everyone connected.':
    'Abrir substitui a linha do tempo em uso para todos os conectados.',
  'Opening replaces the timeline in use and the platform files for everyone connected.':
    'Abrir substitui a linha do tempo em uso e os arquivos da plataforma para todos os conectados.',
  'Session opened: its timeline was simulated again.':
    'Sessão aberta: a linha do tempo dela foi simulada de novo.',

  // What a session holds, line by line, and why one cannot be read.
  '{at} starts {scenario}': '{at} inicia {scenario}',
  '{at} stops the running scenario': '{at} interrompe o cenário em execução',
  '{at} places a fault by hand ({effect})': '{at} aplica uma falha à mão ({effect})',
  '{at} lifts a fault placed by hand': '{at} remove uma falha aplicada à mão',
  '{at} lifts every fault placed by hand': '{at} remove todas as falhas aplicadas à mão',
  'No command: time simply passes.': 'Nenhum comando: o tempo simplesmente passa.',
  'This platform was imported; a link cannot carry its files. Save the file.':
    'Esta plataforma foi importada; um link não pode levar os arquivos dela. Salve o arquivo.',
  'This session holds too many commands for a link. Save the file.':
    'Esta sessão tem comandos demais para um link. Salve o arquivo.',
  'This is not a session file: it is not JSON.': 'Este não é um arquivo de sessão: não é JSON.',
  'This session file is not in a format this version reads: {problem}':
    'Este arquivo de sessão não está num formato que esta versão lê: {problem}',
  'This is not a session file. One is saved from “{command}”.':
    'Este não é um arquivo de sessão. Um arquivo de sessão é salvo em “{command}”.',
  'The session in this link is damaged and cannot be read.':
    'A sessão deste link está danificada e não pode ser lida.',
  'Its platform could not be imported. {reason}':
    'A plataforma dela não pôde ser importada. {reason}',
} as const satisfies Record<string, string>;
