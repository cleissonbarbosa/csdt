/** The bar, the platform signals, the timeline, the scene's controls and the settings. */
export default {
  // The bar.
  '{total} services, all normal': '{total} serviços, todos normais',
  '{total} services, all normal; {faults} fault placed by hand':
    '{total} serviços, todos normais. {faults} falha aplicada manualmente',
  '{total} services, all normal; {faults} faults placed by hand':
    '{total} serviços, todos normais. {faults} falhas aplicadas manualmente',
  '{incident}: {phase}, {affected} service affected':
    '{incident}: {phase}, {affected} serviço afetado',
  '{incident}: {phase}, {affected} services affected':
    '{incident}: {phase}, {affected} serviços afetados',
  Incident: 'Incidente',
  '{unhealthy} of {total} services not normal': '{unhealthy} de {total} serviços fora do normal',
  'At {moment}, in history: {sentence}': 'Em {moment}, no histórico: {sentence}',
  'Show the incident': 'Mostrar o incidente',
  'Show what was placed by hand': 'Mostrar as falhas aplicadas manualmente',
  'Show the platform overview': 'Mostrar a visão geral da plataforma',
  'Stream connected': 'Fluxo conectado',
  Offline: 'Sem conexão',
  Disconnected: 'Desconectado',
  '{n} local integration connected alongside the simulation.':
    'Além da simulação, há {n} integração local conectada.',
  '{n} local integrations connected alongside the simulation.':
    'Além da simulação, há {n} integrações locais conectadas.',
  'Simulated: {hint} Open integrations.': 'Simulado: {hint} Abrir as integrações.',
  '{hint} Open integrations.': '{hint} Abrir as integrações.',
  'Simulated, with {n} live integration': 'Simulado, com {n} integração ao vivo',
  'Simulated, with {n} live integrations': 'Simulado, com {n} integrações ao vivo',
  'Simulated, synthetic data': 'Simulado, dados sintéticos',
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
  'Trace a request through Cedar': 'Rastrear uma requisição com o Cedar',
  'List every service': 'Listar todos os serviços',
  'Table view': 'Visualização em tabela',
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
    'Você está no agora da simulação. Novos dados entram no histórico.',
  Paused: 'Pausado',
  "Paused at the simulation's now: nothing advances until it is played.":
    'Você está no agora da simulação, com a reprodução pausada. Retome para avançar.',
  History: 'Histórico',
  'Inside recorded history: the past is being re-simulated exactly.':
    'A simulação está reproduzindo o histórico exatamente como aconteceu.',
  'Paused in history': 'Pausado no histórico',
  'Paused inside recorded history, at a moment that was re-simulated exactly.':
    'A reprodução do histórico está pausada em um momento que a simulação recriou com exatidão.',
  Play: 'Reproduzir',
  'Step one tick forward': 'Avançar um passo da simulação',
  "{hint} The simulation's now is at {head}.": '{hint} O agora da simulação corresponde a {head}.',
  ', now is {head}': ', agora da simulação em {head}',
  ', recording {name}': ', gravação {name}',
  'Go back to where the latest incident began and watch it again':
    'Voltar ao início do incidente mais recente para revê-lo',
  'Replay the incident': 'Rever o incidente',
  Replay: 'Rever',
  "Jump to the simulation's now, the end of recorded history":
    'Ir para o agora da simulação, o fim do histórico gravado',
  "Go to the simulation's now": 'Ir para o agora da simulação',
  Now: 'Agora',
  'Playback speed': 'Velocidade de reprodução',
  'Put the timeline away': 'Ocultar a linha do tempo',

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
    'Suas preferências ficam salvas apenas neste navegador.',
  Appearance: 'Aparência',
  Language: 'Idioma',
  'Browser#language': 'Do navegador',
  "The interface's words. Changing it reloads the page, which starts the simulation in this tab again.":
    'Ao mudar o idioma da interface, a página recarrega e a simulação recomeça nesta aba.',
  "The interface's words. Changing it reloads the page; the simulation on the server goes on as it is.":
    'Você pode mudar o idioma da interface sem interromper a simulação no servidor. A página será recarregada.',
  Theme: 'Tema',
  'Light for a lit room, night for a dark one. Both follow the same rule: a colour is an answer, to you or to the data.':
    'Use o tema claro em ambientes iluminados e o noturno em ambientes escuros. Nos dois, as cores sinalizam suas ações ou o estado dos dados.',
  System: 'Sistema',
  Light: 'Claro',
  Night: 'Noturno',
  Model: 'Modelo',
  'The overview by kind of service, or every service on its own: by cloud region, or by dependency tier.':
    'Veja a plataforma por tipo de serviço na visão geral ou veja cada serviço por região da nuvem ou por camada de dependência.',
  'Rendering quality': 'Qualidade de renderização',
  'Auto lowers resolution and bead density when frames get slow, and raises them back.':
    'O modo automático reduz a resolução e a densidade dos pontos de tráfego quando a taxa de quadros cai e volta a aumentá-las quando o desempenho melhora.',
  Auto: 'Auto',
  Low: 'Baixa',
  Medium: 'Média',
  High: 'Alta',
  Ultra: 'Ultra',
  'Graphics backend': 'API gráfica',
  'WebGPU is used when the browser offers it; WebGL 2 runs the same shaders. Changing this restarts the scene.':
    'A cena usa WebGPU quando o navegador oferece suporte. WebGL 2 usa os mesmos shaders. Alterar a API gráfica reinicia a cena.',
  'WebGPU (auto)': 'WebGPU (auto)',
  Labels: 'Nomes',
  'Service and region names in the model.': 'Nomes dos serviços e das regiões no modelo.',
  'Idle camera drift': 'Rotação automática da câmera',
  'Turns the model slowly until you move the camera. Off by default.':
    'Gira lentamente em torno do modelo até você mover a câmera. Desativada por padrão.',
  Accessibility: 'Acessibilidade',
  Motion: 'Movimento',
  'Reduced motion stops camera animation, the working parts of the pieces, the blink of a new alarm and interface transitions.':
    'O modo de movimento reduzido desativa a animação da câmera, o movimento das peças, o piscar de novos alarmes e as transições da interface.',
  Reduced: 'Reduzido',
  Full: 'Completo',
  Developer: 'Desenvolvedor',
  'Frame rate, frame time, draw calls, bead count and backend.':
    'Taxa de quadros, tempo por quadro, chamadas de desenho, número de pontos de tráfego e API gráfica.',
  'Restore defaults': 'Restaurar os padrões',
  'headroom, single points of failure': 'margem, pontos únicos de falha',
  'Draft a platform from this capture': 'Criar um rascunho de plataforma a partir desta captura',
} as const satisfies Record<string, string>;
