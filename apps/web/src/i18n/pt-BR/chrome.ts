/** The bar, the platform signals, the timeline, the scene's controls and the settings. */
export default {
  // The bar.
  '{total} services, all normal': '{total} serviços, todos normais',
  '{total} services, all normal; {faults} fault placed by hand':
    '{total} serviços, todos normais; {faults} falha aplicada à mão',
  '{total} services, all normal; {faults} faults placed by hand':
    '{total} serviços, todos normais; {faults} falhas aplicadas à mão',
  '{incident}: {phase}, {affected} service affected':
    '{incident}: {phase}, {affected} serviço afetado',
  '{incident}: {phase}, {affected} services affected':
    '{incident}: {phase}, {affected} serviços afetados',
  Incident: 'Incidente',
  '{unhealthy} of {total} services not normal': '{unhealthy} de {total} serviços fora do normal',
  'At {moment}, in history: {sentence}': 'Em {moment}, no histórico: {sentence}',
  'Show the incident': 'Mostrar o incidente',
  'Show what was placed by hand': 'Mostrar o que foi aplicado à mão',
  'Show the platform overview': 'Mostrar a visão geral da plataforma',
  'Stream connected': 'Fluxo conectado',
  Offline: 'Sem conexão',
  Disconnected: 'Desconectado',
  '{n} local integration connected alongside the simulation.':
    '{n} integração local conectada junto da simulação.',
  '{n} local integrations connected alongside the simulation.':
    '{n} integrações locais conectadas junto da simulação.',
  'Simulated: {hint} Open integrations.': 'Simulado: {hint} Abrir as integrações.',
  '{hint} Open integrations.': '{hint} Abrir as integrações.',
  'Simulated, with {n} live integration': 'Simulado, com {n} integração ao vivo',
  'Simulated, with {n} live integrations': 'Simulado, com {n} integrações ao vivo',
  'Simulated, synthetic data': 'Simulado, dados sintéticos',
  'Simulated, recording data': 'Simulado, dados de gravação',
  'Simulated, live data': 'Simulado, dados ao vivo',
  Simulated: 'Simulado',
  Environment: 'Ambiente',
  'Search services and commands': 'Buscar serviços e comandos',
  Search: 'Buscar',
  'Test an authorization with Cedar': 'Testar uma autorização com o Cedar',
  'Ask Cedar who may do what, and follow the request across the model':
    'Perguntar ao Cedar quem pode fazer o quê e seguir a requisição pelo modelo',
  // "Follow the incident" and "Explore an incident"; a phone shows only the
  // last word, capitalised.
  'Follow the#incident': 'Acompanhar o',
  'Explore an#incident': 'Explorar um',
  incident: 'incidente',
  More: 'Mais',
  'Trace a request through Cedar': 'Rastrear uma requisição pelo Cedar',
  'List every service': 'Listar todos os serviços',
  'Table view': 'Vista em tabela',
  '3D model': 'Modelo 3D',
  'Import or export files': 'Importar ou exportar arquivos',
  Settings: 'Configurações',
  'Timeline and playback': 'Linha do tempo e reprodução',

  // The model inside another page.
  '{phase}, {affected} affected': '{phase}, {affected} afetados',
  'Open#verb': 'Abrir',

  // The platform signals.
  'Platform signals': 'Sinais da plataforma',
  'Signals outside their normal range': 'Sinais fora da faixa normal',
  Errors: 'Erros',
  'Peak saturation': 'Saturação máxima',
  '{n} more signal outside the normal range: {signals}. Show the platform signals.':
    'Mais {n} sinal fora da faixa normal: {signals}. Mostrar os sinais da plataforma.',
  '{n} more signals outside the normal range: {signals}. Show the platform signals.':
    'Mais {n} sinais fora da faixa normal: {signals}. Mostrar os sinais da plataforma.',

  // The timeline.
  'Timeline position': 'Posição na linha do tempo',
  '{cursor} of {head}': '{cursor} de {head}',
  'Simulation now': 'Agora da simulação',
  "At the simulation's now: new history is being made.":
    'No agora da simulação: um novo histórico está sendo feito.',
  Paused: 'Pausado',
  "Paused at the simulation's now: nothing advances until it is played.":
    'Pausado no agora da simulação: nada avança até a reprodução continuar.',
  History: 'Histórico',
  'Inside recorded history: the past is being re-simulated exactly.':
    'Dentro do histórico gravado: o passado está sendo simulado de novo, exatamente.',
  'Paused in history': 'Pausado no histórico',
  'Paused inside recorded history, at a moment that was re-simulated exactly.':
    'Pausado dentro do histórico gravado, num momento que foi simulado de novo, exatamente.',
  Play: 'Reproduzir',
  'Step one tick forward': 'Avançar um tique',
  "{hint} The simulation's now is at {head}.": '{hint} O agora da simulação está em {head}.',
  ', now is {head}': ', agora é {head}',
  ', recording {name}': ', gravação {name}',
  'Go back to where the latest incident began and watch it again':
    'Voltar ao início do incidente mais recente e assistir de novo',
  'Replay the incident': 'Rever o incidente',
  Replay: 'Rever',
  "Jump to the simulation's now, the end of recorded history":
    'Ir para o agora da simulação, o fim do histórico gravado',
  "Go to the simulation's now": 'Ir para o agora da simulação',
  Now: 'Agora',
  'Playback speed': 'Velocidade de reprodução',
  'Put the timeline away': 'Guardar a linha do tempo',

  // The scene's controls.
  'Interactive 3D view of the infrastructure topology':
    'Vista 3D interativa da topologia da infraestrutura',
  'Scene controls': 'Controles da cena',
  'Topology layout': 'Disposição da topologia',
  Overview: 'Visão geral',
  Dependencies: 'Dependências',
  'Frame everything': 'Enquadrar tudo',
  'Reset camera': 'Redefinir a câmera',
  'Clear filters': 'Limpar os filtros',
  Dismiss: 'Dispensar',
  'Performance overlay': 'Painel de desempenho',
  '{place}, {n} service': '{place}, {n} serviço',
  '{place}, {n} services': '{place}, {n} serviços',

  // The settings.
  'Preferences are stored in this browser only.':
    'As preferências ficam guardadas só neste navegador.',
  Appearance: 'Aparência',
  Language: 'Idioma',
  'Browser#language': 'Do navegador',
  "The interface's words. Changing it reloads the page, which starts the simulation in this tab again.":
    'As palavras da interface. Mudar recarrega a página, o que reinicia a simulação nesta aba.',
  "The interface's words. Changing it reloads the page; the simulation on the server goes on as it is.":
    'As palavras da interface. Mudar recarrega a página; a simulação no servidor continua como está.',
  Theme: 'Tema',
  'Light for a lit room, night for a dark one. Both follow the same rule: a colour is an answer, to you or to the data.':
    'Claro para um ambiente iluminado, noturno para um escuro. Os dois seguem a mesma regra: uma cor é uma resposta, a você ou aos dados.',
  System: 'Sistema',
  Light: 'Claro',
  Night: 'Noturno',
  Model: 'Modelo',
  'The overview by kind of service, or every service on its own: by cloud region, or by dependency tier.':
    'A visão geral por tipo de serviço, ou cada serviço por si: por região de nuvem ou por camada de dependência.',
  'Rendering quality': 'Qualidade de renderização',
  'Auto lowers resolution and bead density when frames get slow, and raises them back.':
    'Auto reduz a resolução e a densidade dos pontos de tráfego quando os quadros ficam lentos, e volta a aumentá-las.',
  Auto: 'Auto',
  Low: 'Baixa',
  Medium: 'Média',
  High: 'Alta',
  Ultra: 'Ultra',
  'Graphics backend': 'API gráfica',
  'WebGPU is used when the browser offers it; WebGL 2 runs the same shaders. Changing this restarts the scene.':
    'O WebGPU é usado quando o navegador o oferece; o WebGL 2 roda os mesmos shaders. Mudar isso reinicia a cena.',
  'WebGPU (auto)': 'WebGPU (auto)',
  Labels: 'Nomes',
  'Service and region names in the model.': 'Nomes dos serviços e das regiões no modelo.',
  'Idle camera drift': 'Câmera girando em repouso',
  'Turns the model slowly until you move the camera. Off by default.':
    'Gira o modelo devagar até você mover a câmera. Desligado por padrão.',
  Accessibility: 'Acessibilidade',
  Motion: 'Movimento',
  'Reduced motion stops camera animation, the working parts of the pieces, the blink of a new alarm and interface transitions.':
    'Movimento reduzido para a animação da câmera, as partes móveis das peças, o piscar de um alarme novo e as transições da interface.',
  Reduced: 'Reduzido',
  Full: 'Completo',
  Developer: 'Desenvolvedor',
  'Frame rate, frame time, draw calls, bead count and backend.':
    'Taxa de quadros, tempo de quadro, chamadas de desenho, número de pontos de tráfego e API gráfica.',
  'Restore defaults': 'Restaurar os padrões',
} as const satisfies Record<string, string>;
