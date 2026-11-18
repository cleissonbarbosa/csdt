/**
 * Phrases more than one area of the interface uses, and the vocabulary every
 * part keeps to. One English word has one Portuguese word here, so a thing
 * is called the same wherever it is met:
 *
 *   service · serviço            platform · plataforma     topology · topologia
 *   incident · incidente         scenario · cenário        phase · fase
 *   event · evento               alert · alerta            fault · falha
 *   request · requisição         traffic · tráfego         latency · latência
 *   error rate · taxa de erro    throughput · vazão        capacity · capacidade
 *   policy · política            principal · principal     action · ação
 *   resource · recurso           context · contexto        decision · decisão
 *   timeline · linha do tempo    history · histórico       session · sessão
 *   overview · visão geral       arrangement · disposição  piece · peça
 *   engine · motor               seed · semente            run · execução
 *   challenge · desafio          hint · dica               files · arquivos
 *   objective · objetivo         exposure · exposição      intervention · intervenção
 *   tenant · locatário           role · função             workspace · espaço de trabalho
 *   trial · experimento          normal range · faixa normal  n/a · n/d
 *   capture · captura            provider report · relatório do provedor
 *   no data · sem dados          not stated · não informado
 *
 * The plural of principal is "principais", as in "6 principais, 6 ações".
 *
 * Health is saudável, degradado, crítico, fora do ar; a platform is "normal"
 * or "fora do normal". A fault is "aplicada à mão". Cedar allows and denies:
 * Permitido, Negado; a policy permits or forbids: Permite, Proíbe.
 *
 * An incident capture ("captura de incidente") is a real incident read in
 * the browser, from a provider's report or a system's measurements. It is
 * never a "gravação" nor "gravado": those stay the simulation's (a recorded
 * incident, its recorded history). Nor is it "Rever", the simulation's
 * re-simulated history. After a count, "not stated" is "sem informação",
 * which needs no agreement with the count.
 *
 * The rules of `docs/DESIGN.md` hold in every language. Simulated time is
 * never "ao vivo": the cursor is at the "agora da simulação" or in its
 * "histórico", and either may be "pausado". "Ao vivo" is kept for data
 * measured from a connected system. Statements are "prescrito", "modelado",
 * "observado" or "não explicado". Sentence case, no exclamation marks, and
 * a button says what it does in the infinitive ("Buscar", "Fechar").
 */
export default {
  // Kinds of service and of traffic, and how one service relates to another.
  'API gateway': 'Gateway de API',
  Authentication: 'Autenticação',
  Authorization: 'Autorização',
  'Cedar authorizer': 'Autorizador Cedar',
  Client: 'Cliente',
  Request: 'Requisição',
  Error: 'Erro',
  Rejected: 'Rejeitado',
  Suspicious: 'Suspeito',
  Calls: 'Chama',

  // States.
  Active: 'Ativo',
  Critical: 'Crítico',
  Denied: 'Negado',
  Allow: 'Permitido',
  Deny: 'Negado',
  'On#state': 'Ligado',

  // The four kinds of statement.
  Prescribed: 'Prescrito',
  Modelled: 'Modelado',
  Observed: 'Observado',
  'Not explained': 'Não explicado',

  // Signals.
  Traffic: 'Tráfego',
  Latency: 'Latência',
  'Latency p95': 'Latência p95',
  'Error rate': 'Taxa de erro',
  Saturation: 'Saturação',
  'Highest error rate': 'Maior taxa de erro',
  'Highest latency p95': 'Maior latência p95',
  'Mean error rate': 'Taxa de erro média',
  'Not normal at once': 'Fora do normal ao mesmo tempo',
  'All back to normal': 'Tudo de volta ao normal',

  // Things and places.
  Services: 'Serviços',
  Regions: 'Regiões',
  Events: 'Eventos',
  Policies: 'Políticas',
  'an empty context': 'um contexto vazio',

  // What can be done, by the name it has everywhere.
  Start: 'Iniciar',
  Pause: 'Pausar',
  Clear: 'Limpar',
  'Show fewer': 'Mostrar menos',
  'Test an authorization': 'Testar uma autorização',
  'Trace a request': 'Rastrear uma requisição',
  'Who may do what': 'Quem pode fazer o quê',
  'Edit the Cedar policies': 'Editar as políticas Cedar',
  'Compare an intervention': 'Comparar uma intervenção',
  'Write a scenario': 'Escrever um cenário',
  'Save or share this session': 'Salvar ou compartilhar esta sessão',
  'Guided challenges': 'Desafios guiados',
  'Help and legend': 'Ajuda e legenda',

  // A figure that cannot be given, and a list cut short.
  'n/a': 'n/d',
  'and {n} more': 'e mais {n}',

  // While something is under way, and when it is not found or fails.
  'Checking…': 'Verificando…',
  'Starting…': 'Iniciando…',
  'Loading topology': 'Carregando a topologia',
  'No services match': 'Nenhum serviço corresponde',
  'Loosen the filters to see services again.': 'Afrouxe os filtros para ver os serviços de novo.',
  'Something went wrong.': 'Algo deu errado.',
  'The session could not be loaded.': 'A sessão não pôde ser carregada.',
} as const satisfies Record<string, string>;
