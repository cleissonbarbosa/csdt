/** The incident console, the incident report and the scenario editor. */
export default {
  // The stage an incident is at, and what a scenario is about.
  Mitigating: 'Em mitigação',
  Recovering: 'Em recuperação',
  Resolved: 'Resolvido',
  Availability: 'Disponibilidade',
  Identity: 'Identidade',
  Resilience: 'Resiliência',

  // What kind of event it is.
  'Health Transition': 'Mudança de estado',
  'Incident Started': 'Incidente iniciado',
  'Incident Phase': 'Fase do incidente',
  'Incident Resolved': 'Incidente resolvido',
  'Authz Decision': 'Decisão de autorização',
  'Auth Failure': 'Falha de autenticação',
  Mitigation: 'Mitigação',
  Reroute: 'Redirecionamento',
  Alert: 'Alerta',
  'Cve Advisory': 'Aviso de CVE',
  'Scan Finding': 'Achado de varredura',
  System: 'Sistema',

  // The incident running now.
  'Scenario progress': 'Progresso do cenário',
  'Phases, timed from the start of the incident (<n>{clock}</n> on the simulation clock). Select one to see why.':
    'Fases, contadas a partir do início do incidente (<n>{clock}</n> no relógio da simulação). Selecione uma para ver o porquê.',
  'Phases, timed from the start of the incident. Select one to see why.':
    'Fases, contadas a partir do início do incidente. Selecione uma para ver o porquê.',
  Phases: 'Fases',
  'Not reached yet': 'Ainda não alcançada',
  'Entered at {clock} on the simulation clock. Hide what it prescribes and what followed.':
    'Alcançada em {clock} no relógio da simulação. Ocultar o que ela prescreve e o que se seguiu.',
  'Entered at {clock} on the simulation clock. Show what it prescribes and what followed.':
    'Alcançada em {clock} no relógio da simulação. Mostrar o que ela prescreve e o que se seguiu.',
  Resume: 'Continuar',
  'Stop the scenario and let the platform recover. History is kept.':
    'Parar o cenário e deixar a plataforma se recuperar. O histórico é mantido.',
  Stop: 'Parar',
  'Scenario speed': 'Velocidade do cenário',
  'Summary so far: origin, propagation, peak': 'Resumo até agora: origem, propagação, pico',
  '{n} service affected': '{n} serviço afetado',
  '{n} services affected': '{n} serviços afetados',

  // One event, opened from the log.
  'All events': 'Todos os eventos',
  Severity: 'Severidade',
  Kind: 'Tipo',
  'Simulation clock': 'Relógio da simulação',
  'Into the incident': 'Desde o início do incidente',
  '(it began at {clock})': '(começou em {clock})',
  Sequence: 'Sequência',
  Incident: 'Incidente',
  Data: 'Dados',
  'What this phase prescribes, and what followed': 'O que esta fase prescreve e o que se seguiu',
  'Jump to this moment': 'Ir para este momento',
  Details: 'Detalhes',

  // The incidents this timeline holds.
  'On this timeline': 'Nesta linha do tempo',
  '{start} to {end}': '{start} a {end}',
  'Summary: origin, propagation, peak and recovery':
    'Resumo: origem, propagação, pico e recuperação',

  // Faults placed by hand.
  'Placed by hand': 'Aplicado à mão',
  'Lift all': 'Retirar todas',
  'Lift this fault from {target}': 'Retirar esta falha de {target}',

  // The scenarios.
  Scenarios: 'Cenários',
  'Erase history': 'Apagar o histórico',
  Cancel: 'Cancelar',
  'Return to a clean baseline at 0:00': 'Voltar a uma linha de base limpa em 0:00',
  Reset: 'Reiniciar',
  'Fictional, deterministic incidents that run only inside the simulation engine. Nothing here touches a real system.':
    'Incidentes fictícios e determinísticos que rodam só dentro do motor de simulação. Nada aqui toca um sistema real.',
  'Scenarios unavailable': 'Cenários indisponíveis',
  '{category}, <n>{duration}</n>, {count} phases#one':
    '{category}, <n>{duration}</n>, {count} fase',
  '{category}, <n>{duration}</n>, {count} phases': '{category}, <n>{duration}</n>, {count} fases',
  Restart: 'Recomeçar',
  'Run this scenario twice from the same seed, once with one change, and compare':
    'Executar este cenário duas vezes a partir da mesma semente, uma delas com uma mudança, e comparar',
  'Cannot run: {reason}': 'Não pode ser executado: {reason}',
  'This scenario is incompatible with the active platform.':
    'Este cenário é incompatível com a plataforma ativa.',
  'Load a recorded incident': 'Carregar um incidente gravado',
  'Load a recorded incident…': 'Carregar um incidente gravado…',
  'Write a scenario of your own': 'Escrever o seu próprio cenário',

  // The event log.
  All: 'Todos',
  Notices: 'Avisos',
  Warnings: 'Atenção',
  'Minimum severity': 'Severidade mínima',
  'No events at this level yet.': 'Ainda não há eventos neste nível.',
  'Events, newest first': 'Eventos, os mais recentes primeiro',
  'severity {severity}': 'severidade {severity}',
  '{n} services changed state': '{n} serviços mudaram de estado',

  // A phase explained: what the scenario prescribes, what followed, what was observed.
  'Prescribed by the scenario': 'Prescrito pelo cenário',
  'Nothing: what earlier phases held eases back to nominal.':
    'Nada: o que as fases anteriores mantinham volta aos poucos ao nominal.',
  'Announces “{title}” at {at}': 'Anuncia “{title}” em {at}',
  'What followed': 'O que se seguiu',
  'No service has left its normal state in this phase so far.':
    'Nenhum serviço saiu do seu estado normal nesta fase até agora.',
  'No service got worse during this phase.': 'Nenhum serviço piorou durante esta fase.',
  'Error rate up to <peak>{figure}</peak> at {when}, from <before>{baseline}</before> before the incident':
    'Taxa de erro de até <peak>{figure}</peak> em {when}, contra <before>{baseline}</before> antes do incidente',
  'Error rate up to <peak>{figure}</peak> at {when}':
    'Taxa de erro de até <peak>{figure}</peak> em {when}',
  'Latency p95 up to <peak>{figure}</peak>, from <before>{baseline}</before> before':
    'Latência p95 de até <peak>{figure}</peak>, contra <before>{baseline}</before> antes',
  'Latency p95 up to <peak>{figure}</peak>': 'Latência p95 de até <peak>{figure}</peak>',
  'A detection rule raised “{title}” at {when}':
    'Uma regra de detecção disparou “{title}” em {when}',
  'No sample of this phase is on record yet.':
    'Ainda não há nenhuma amostra desta fase no registro.',

  // Why a service changed, and the kind of statement that is.
  'By hand': 'À mão',
  'Written in the scenario file: the scenario does this by itself.':
    'Escrito no arquivo do cenário: o cenário faz isso por conta própria.',
  'A relation of the topology the model follows: a dependency carries failures back to its callers, added traffic flows on to what is called.':
    'Uma relação da topologia que o modelo segue: uma dependência leva as falhas de volta a quem a chama, e o tráfego adicionado segue adiante para o que é chamado.',
  'A fault placed by hand was in force on the service.':
    'Uma falha aplicada à mão estava em vigor no serviço.',
  'None of the relations the report knows explains this change. It does not guess.':
    'Nenhuma das relações que o relatório conhece explica esta mudança. Ele não adivinha.',
  'another service': 'outro serviço',
  'the scenario acts on it ({effect})': 'o cenário atua sobre ele ({effect})',
  'the scenario acts on it': 'o cenário atua sobre ele',
  'a fault placed by hand is in force on it ({effect})':
    'uma falha aplicada à mão está em vigor nele ({effect})',
  'a fault placed by hand is in force on it': 'uma falha aplicada à mão está em vigor nele',
  '{via}, which drains it, was already not normal':
    '{via}, que o esvazia, já estava fora do normal',
  'it calls {via}, which was already not normal': 'ele chama {via}, que já estava fora do normal',
  'it receives the traffic the scenario adds at {via}':
    'ele recebe o tráfego que o cenário adiciona em {via}',
  // Portuguese cannot put this after "porque": it stands alone, and the
  // sentences that join it take it as a phrase of their own.
  'of nothing the report can point to': 'sem causa que o relatório consiga apontar',
  'Back to normal.': 'De volta ao normal.',
  '{state} because of nothing the report can point to.':
    '{state} sem causa que o relatório consiga apontar.',
  '{state} because {why}.': '{state} porque {why}.',
  '{state}, from {previous}.': '{state}, vindo de {previous}.',
  Why: 'Por quê',
  'Because of nothing the report can point to.': 'Sem causa que o relatório consiga apontar.',
  'Because {why}.': 'Porque {why}.',
  'Show {service}': 'Mostrar {service}',
  'Show all {n}': 'Mostrar todos os {n}',

  // Moments of an incident, on both clocks.
  '{since} since the incident began, {clock} on the simulation clock':
    '{since} desde o início do incidente, {clock} no relógio da simulação',
  '{when}. Go to this moment.': '{when}. Ir para este momento.',
  '{name} was back to normal at {at}': '{name} voltou ao normal em {at}',
  '{name} became {state} at {at}': '{name} ficou {state} em {at}',
  '{effect} on {names} and {rest} more': '{effect} em {names} e mais {rest}',
  '{effect} on {names}': '{effect} em {names}',

  // The summary of an incident.
  'Incidents and scenarios': 'Incidentes e cenários',
  'No summary': 'Sem resumo',
  'This incident is not on the timeline any more: it was reset, or is older than the history that is kept.':
    'Este incidente não está mais na linha do tempo: ela foi reiniciada, ou ele é mais antigo do que o histórico que é mantido.',
  'Reading the incident back': 'Lendo o registro do incidente',
  'Summary copied as text.': 'Resumo copiado como texto.',
  'The summary could not be copied.': 'O resumo não pôde ser copiado.',
  'Copy this summary as plain text': 'Copiar este resumo como texto simples',
  Copy: 'Copiar',
  'Still running: {at} recorded so far.': 'Ainda em andamento: {at} registrados até agora.',
  'The scenario ended at {at} ({how}).': 'O cenário terminou em {at} ({how}).',
  'The scenario ended at {at}.': 'O cenário terminou em {at}.',
  'No service left its normal state.': 'Nenhum serviço saiu do seu estado normal.',
  'Every affected service was back to normal by {at}.':
    'Todos os serviços afetados tinham voltado ao normal em {at}.',
  '{n} service was still not normal at {at}, where the record stops.':
    '{n} serviço ainda estava fora do normal em {at}, onde o registro termina.',
  '{n} services were still not normal at {at}, where the record stops.':
    '{n} serviços ainda estavam fora do normal em {at}, onde o registro termina.',
  'Read back from this run. Times are since the incident began, at <n>{clock}</n> on the simulation clock.':
    'Lido do registro desta execução. Os tempos contam desde o início do incidente, em <n>{clock}</n> no relógio da simulação.',
  Moments: 'Momentos',
  'Start#moment': 'Início',
  'First service affected': 'Primeiro serviço afetado',
  'Most errors': 'Mais erros',
  'Most services not normal': 'Mais serviços fora do normal',
  'End#moment': 'Fim',
  Origin: 'Origem',
  '{name}: the scenario names it as the root cause.': '{name}: o cenário o indica como causa raiz.',
  '{name}: the first service the scenario acts on.':
    '{name}: o primeiro serviço sobre o qual o cenário atua.',
  '{name}: the first service seen to leave its normal state.':
    '{name}: o primeiro serviço visto saindo do seu estado normal.',
  Propagation: 'Propagação',
  '{n} affected#one': '{n} afetado',
  '{n} affected': '{n} afetados',
  'The first time each service left its normal state, and why.':
    'A primeira vez que cada serviço saiu do seu estado normal, e por quê.',
  'Peak impact': 'Pico do impacto',
  services: 'serviços',
  'Before the incident: error rate <n>{errors}</n>, latency p95 <n>{latency}</n>.':
    'Antes do incidente: taxa de erro <n>{errors}</n>, latência p95 <n>{latency}</n>.',
  Objectives: 'Objetivos',
  'Error rate under {threshold}': 'Taxa de erro abaixo de {threshold}',
  'Latency p95 under {threshold}': 'Latência p95 abaixo de {threshold}',
  'met throughout': 'cumprido o tempo todo',
  'not met for {duration}, first at {at}': 'não cumprido por {duration}, pela primeira vez em {at}',
  'Observed: the objectives are the ones the engine alerts on, and the time each was not met is its samples counted, one a second.':
    'Observado: os objetivos são aqueles sobre os quais o motor alerta, e o tempo em que cada um não foi cumprido é a contagem das suas amostras, uma por segundo.',
  'What Cedar decided': 'O que o Cedar decidiu',
  'For the requests the scenario sends, as the decision events of this run record them.':
    'Para as requisições que o cenário envia, como os eventos de decisão desta execução as registram.',
  '{principal} → {action} on {resource}': '{principal} → {action} em {resource}',
  'on {resource}': 'em {resource}',
  'no policy permits it: denied by default': 'nenhuma política o permite: negado por padrão',
  Recovery: 'Recuperação',
  'Some lists were cut to their bound.': 'Algumas listas foram cortadas no seu limite.',

  // The summary as text to take away.
  '{title}: incident {id}': '{title}: incidente {id}',
  'Simulated on {platform}. Every figure comes from the AEGIS simulation engine; none is measured from a real system.':
    'Simulado em {platform}. Cada número vem do motor de simulação do AEGIS; nenhum é medido em um sistema real.',
  'Simulated on the platform. Every figure comes from the AEGIS simulation engine; none is measured from a real system.':
    'Simulado na plataforma. Cada número vem do motor de simulação do AEGIS; nenhum é medido em um sistema real.',
  'Phases (time since the incident began, then the simulation clock)':
    'Fases (tempo desde o início do incidente, depois o relógio da simulação)',
  'prescribed: {effect}': 'prescrito: {effect}',
  'Propagation (the first time each service left its normal state)':
    'Propagação (a primeira vez que cada serviço saiu do seu estado normal)',
  Impact: 'Impacto',
  'Services affected: {n}': 'Serviços afetados: {n}',
  'Most services not normal at once: {n} at {at}':
    'Máximo de serviços fora do normal ao mesmo tempo: {n} em {at}',
  'Highest error rate: {peak} at {at}, from {baseline} before':
    'Maior taxa de erro: {peak} em {at}, contra {baseline} antes',
  'Highest error rate: {peak} at {at}': 'Maior taxa de erro: {peak} em {at}',
  'Highest p95 latency: {peak} at {at}, from {baseline} before':
    'Maior latência p95: {peak} em {at}, contra {baseline} antes',
  'Highest p95 latency: {peak} at {at}': 'Maior latência p95: {peak} em {at}',
  'Mean error rate over the incident: {rate}': 'Taxa de erro média durante o incidente: {rate}',
  'Objectives (observed)': 'Objetivos (observados)',
  "Cedar's decisions for the scenario's requests":
    'Decisões do Cedar para as requisições do cenário',
  '{decision} {principal} -> {action} on {resource}, {count}x, {why}':
    '{decision} {principal} -> {action} em {resource}, {count}x, {why}',
  'decided by {policies}': 'decidido por {policies}',
  'denied by default': 'negado por padrão',

  // The scenario editor: the scenario.
  'Phases on a timeline, the effects each holds and the events it announces, in the file format the engine reads. A scenario changes figures inside the simulation and nothing else.':
    'Fases em uma linha do tempo, os efeitos que cada uma mantém e os eventos que anuncia, no formato de arquivo que o motor lê. Um cenário muda números dentro da simulação e nada mais.',
  'Start from': 'Começar de',
  'A blank scenario': 'Um cenário em branco',
  'A copy of {name}': 'Uma cópia de {name}',
  'That file could not be read as a scenario.': 'Esse arquivo não pôde ser lido como um cenário.',
  '{name} (copy)': '{name} (cópia)',
  'My scenario': 'Meu cenário',
  Name: 'Nome',
  'Id, as the file and the API name it': 'Id, como o arquivo e a API o chamam',
  Summary: 'Resumo',
  Category: 'Categoria',
  'Lasts, in seconds': 'Duração, em segundos',
  'Up to 1800: the half hour of history the timeline keeps.':
    'Até 1800: a meia hora de histórico que a linha do tempo mantém.',
  'Root cause, if it names one': 'Causa raiz, se o cenário indicar uma',
  'None named': 'Nenhuma indicada',

  // What an effect can be placed on.
  '{value} (not on this platform)': '{value} (não existe nesta plataforma)',
  'By role: runs wherever the role exists': 'Por papel: roda onde quer que o papel exista',
  'every service of {role} ({region})': 'todos os serviços de {role} ({region})',
  'the gateway of {role} ({region})': 'o gateway de {role} ({region})',
  'A region of this platform': 'Uma região desta plataforma',
  'every service of {region}': 'todos os serviços de {region}',
  'A service of this platform': 'Um serviço desta plataforma',

  // A phase.
  'Phase {n}': 'Fase {n}',
  Degradation: 'Degradação',
  'New phase': 'Nova fase',
  'Starts at, s': 'Começa em, s',
  'Seconds after the scenario starts': 'Segundos depois do início do cenário',
  'Eases in, s': 'Transição, s',
  'How long its effects take to ease in from what held before':
    'Quanto tempo os seus efeitos levam para entrar aos poucos, a partir do que valia antes',
  'Incident is': 'Estado do incidente',
  'Remove phase {n}': 'Remover a fase {n}',
  'What happens, in a sentence': 'O que acontece, em uma frase',
  'Effects held during this phase. Whatever a phase does not list eases back to nominal.':
    'Efeitos mantidos durante esta fase. O que uma fase não lista volta aos poucos ao nominal.',
  'Add an effect': 'Adicionar um efeito',
  'Events it announces': 'Eventos que ela anuncia',
  'Add an event it announces': 'Adicionar um evento que ela anuncia',
  'Add a phase': 'Adicionar uma fase',

  // An effect.
  Effect: 'Efeito',
  'Capacity ×': 'Capacidade ×',
  'Latency ×': 'Latência ×',
  'Share of requests that fail': 'Proporção das requisições que falham',
  Unreachable: 'Inacessível',
  'Demand ×': 'Demanda ×',
  'Calls into it ×': 'Chamadas a ele ×',
  'Network latency into it ×': 'Latência de rede até ele ×',
  'Share of calls into it that fail': 'Proporção das chamadas a ele que falham',
  'On#target': 'Em',
  'Choose what it acts on…': 'Escolher sobre o que ele atua…',
  'Share, 0 to 1': 'Proporção, de 0 a 1',
  Factor: 'Fator',
  'A share from 0 to 1': 'Uma proporção de 0 a 1',
  'A factor: 1 leaves it as it is, 0.5 halves it, 2 doubles it':
    'Um fator: 1 deixa como está, 0.5 reduz à metade, 2 dobra',
  'Remove this effect': 'Remover este efeito',
  'kept as written': 'mantido como foi escrito',

  // An event a phase announces.
  'After, s': 'Depois de, s',
  'Seconds after the phase begins': 'Segundos depois do início da fase',
  'What it says': 'O que ele diz',
  'What the event says': 'O que o evento diz',
  'Remove this event': 'Remover este evento',

  // Flows the editor keeps as they were read.
  '{n} injected flow read from the file is kept as written. Flows are edited in the file itself.':
    '{n} fluxo injetado lido do arquivo é mantido como foi escrito. Fluxos são editados no próprio arquivo.',
  '{n} injected flows read from the file are kept as written. Flows are edited in the file itself.':
    '{n} fluxos injetados lidos do arquivo são mantidos como foram escritos. Fluxos são editados no próprio arquivo.',

  // What is missing, before the engine is asked.
  'The scenario needs a name.': 'O cenário precisa de um nome.',
  'The id is 1 to 64 letters, digits, "-", "_" or ".".':
    'O id tem de 1 a 64 letras, dígitos, "-", "_" ou ".".',
  'A scenario needs at least one phase.': 'Um cenário precisa de pelo menos uma fase.',
  'One phase has to start at 0 seconds.': 'Uma fase tem de começar no segundo 0.',
  'Every phase needs a name.': 'Toda fase precisa de um nome.',
  '“{phase}” starts after the scenario ends.': '“{phase}” começa depois que o cenário termina.',
  'An effect of “{phase}” is not placed on anything.':
    'Um efeito de “{phase}” não está aplicado a nada.',
  'An event of “{phase}” has no title.': 'Um evento de “{phase}” não tem título.',

  // What the engine says of it.
  'The scenarios in use could not be read, so this one cannot be checked against them.':
    'Os cenários em uso não puderam ser lidos, então este não pode ser verificado em relação a eles.',
  'Asking the engine whether this is valid…': 'Perguntando ao motor se isto é válido…',
  'The file could not be checked.': 'O arquivo não pôde ser verificado.',
  '{error} The file can still be saved and given to a server when it starts.':
    '{error} O arquivo ainda pode ser salvo e entregue a um servidor quando ele iniciar.',
  'The engine does not accept this scenario.': 'O motor não aceita este cenário.',
  'The engine accepts this scenario and can run it on {platform}.':
    'O motor aceita este cenário e pode executá-lo em {platform}.',
  'The engine accepts this scenario.': 'O motor aceita este cenário.',
  'It cannot run on <id>{topology}</id>: {reason}':
    'Ele não pode ser executado em <id>{topology}</id>: {reason}',
  'A scenario with the id <id>{scenario}</id> is in use; running this one takes its place.':
    'Um cenário com o id <id>{scenario}</id> está em uso; executar este o substitui.',

  // Running it, or keeping it.
  'Add it and run it': 'Adicionar e executar',
  'Save the file': 'Salvar o arquivo',
  'Running it adds it to the scenarios in use and starts a new timeline for everyone connected.':
    'Executá-lo o adiciona aos cenários em uso e inicia uma nova linha do tempo para todos os que estão conectados.',
  'The file': 'O arquivo',
} as const satisfies Record<string, string>;
