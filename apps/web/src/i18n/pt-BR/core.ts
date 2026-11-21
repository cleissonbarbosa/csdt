/**
 * The words the whole interface is built from (states, kinds of service and
 * of traffic, where data comes from), the application's frame, and what is
 * said when the server or the engine does not answer.
 */
export default {
  // How a service is, how serious an event is, what its traffic is doing.
  Healthy: 'Saudável',
  Degraded: 'Degradado',
  Down: 'Fora do ar',
  Info: 'Info',
  Notice: 'Aviso',
  Warning: 'Atenção',
  Secure: 'Seguro',
  Authorizing: 'Autorizando',
  Throttled: 'Limitado',

  // Kinds of service: the name, a short one for dense lists, and several of
  // them in the middle of a sentence.
  Gateway: 'Gateway',
  'API gateways': 'gateways de API',
  Auth: 'Identidade',
  'identity services': 'serviços de identidade',
  Cedar: 'Cedar',
  'Cedar authorizers': 'autorizadores Cedar',
  Microservice: 'Microsserviço',
  Service: 'Serviço',
  microservices: 'microsserviços',
  Container: 'Contêiner',
  containers: 'contêineres',
  Serverless: 'Serverless',
  Function: 'Função',
  functions: 'funções',
  'Message queue': 'Fila de mensagens',
  Queue: 'Fila',
  queues: 'filas',
  Database: 'Banco de dados',
  databases: 'bancos de dados',
  Storage: 'Armazenamento',
  'object stores': 'repositórios de objetos',
  'Network gateway': 'Gateway de rede',
  Network: 'Rede',
  'network gateways': 'gateways de rede',
  'Security monitor': 'Monitor de segurança',
  Monitor: 'Monitor',
  'security monitors': 'monitores de segurança',
  'External client': 'Cliente externo',
  'external clients': 'clientes externos',
  'Load balancer': 'Balanceador de carga',
  Balancer: 'Balanceador',
  'load balancers': 'balanceadores de carga',
  'Virtual machine': 'Máquina virtual',
  VM: 'VM',
  'virtual machines': 'máquinas virtuais',
  'Kubernetes cluster': 'Cluster Kubernetes',
  Cluster: 'Cluster',
  'Kubernetes clusters': 'clusters Kubernetes',
  Cache: 'Cache',
  caches: 'caches',
  'Event stream': 'Stream de eventos',
  Stream: 'Stream',
  'event streams': 'streams de eventos',

  // How one service relates to another.
  'Routes to': 'Encaminha para',
  'Authenticates with': 'Autentica por meio de',
  'Authorizes with': 'Autoriza por meio de',
  'Reads / writes': 'Lê / grava',
  'Publishes to': 'Publica em',
  'Consumed by': 'Consumido por',
  'Replicates to': 'Replica para',
  'Reports to': 'Envia telemetria para',

  // Where data comes from.
  Synthetic: 'Sintético',
  Capture: 'Captura',
  Live: 'Ao vivo',
  'Produced by the built-in simulation engine.': 'Produzido pelo motor de simulação embutido.',
  "Not produced by the simulation: an incident capture read in this browser from a file, either a real system's measurements or a provider's report transcribed by hand.":
    'O navegador lê esta captura de incidente de um arquivo. Os dados vêm de medições de um sistema real ou da transcrição manual do relatório de um provedor.',
  'Measured from an explicitly connected local instance.':
    'Medições de uma instância local conectada por você.',
  'Produced by the simulation engine, which runs in this tab.':
    'Produzido pelo motor de simulação, que roda nesta aba.',

  // Kinds of traffic.
  Response: 'Resposta',
  'Queue message': 'Mensagem de fila',

  // The overview's layers, and a kind of service standing for several.
  'Entry#layer': 'Entrada',
  'Identity#layer': 'Identidade',
  'Compute#layer': 'Computação',
  'Data#layer': 'Dados',
  '{n} {kinds}': '{n} {kinds}',
  '{n} {kinds} in {place}.': '{n} {kinds} em {place}.',
  '{n} {kinds} in {regions} regions.': '{n} {kinds} em {regions} regiões.',

  // The application's frame.
  'Skip to the topology': 'Pular para a topologia',
  'Infrastructure topology': 'Topologia da infraestrutura',
  'Services and incidents': 'Serviços e incidentes',
  'Left panel': 'Painel esquerdo',
  Incidents: 'Incidentes',
  '(incident active)': '(incidente ativo)',
  'Close this panel': 'Fechar este painel',
  Inspector: 'Inspetor',
  'Close dialog': 'Fechar a caixa de diálogo',
  Show: 'Mostrar',
  Hide: 'Ocultar',
  '{label}: not enough data': '{label}: dados insuficientes',
  'The 3D renderer could not start on this device. Showing the table view instead.':
    'Não foi possível iniciar o renderizador 3D neste dispositivo. A topologia é exibida em tabela.',
  'This browser offers neither WebGPU nor WebGL 2, so the 3D scene is unavailable. Showing the table view instead.':
    'Este navegador não é compatível com WebGPU nem com WebGL 2. A topologia é exibida em tabela.',

  // When nothing answers.
  'The simulation engine is not running': 'O motor de simulação está inativo',
  'On this page the simulation runs in the browser, from a WebAssembly module. Nothing is shown in its place: AEGIS does not invent data.':
    'Nesta página, a simulação roda no navegador com um módulo WebAssembly. Sem o motor, a página não exibe dados da simulação.',
  'Reload the page': 'Recarregar a página',
  'The AEGIS server is not answering': 'O servidor do AEGIS não está respondendo',
  'Start it with:': 'Use este comando para iniciar o servidor:',
  'The interface reconnects by itself as soon as the server is up. Nothing is shown in the meantime: AEGIS does not invent data.':
    'A interface volta a exibir dados assim que se reconectar automaticamente ao servidor.',
  'Retry now': 'Tentar novamente',
  'The simulation engine is not running.': 'O motor de simulação está inativo.',
  'The server could not be reached.': 'Não foi possível conectar ao servidor.',
  'Asking the engine…': 'Consultando o motor…',
  'Asking the server…': 'Consultando o servidor…',
  'Loading the engine': 'Carregando o motor',
  'Engine stopped': 'Motor parado',
  Reconnecting: 'Reconectando',
  'The topology could not be loaded.': 'A topologia não pôde ser carregada.',
  'The simulation engine could not be loaded.': 'O motor de simulação não pôde ser carregado.',
  'This browser could not start the simulation engine.':
    'Este navegador não conseguiu iniciar o motor de simulação.',
  'The engine is not running.': 'O motor está inativo.',
  'The simulation engine did not answer in time.': 'O motor de simulação não respondeu a tempo.',
  'The module is not the AEGIS engine.': 'O módulo não é o motor do AEGIS.',
  'The engine module speaks version {module} of its boundary and this page version {page}. Rebuild it.':
    'O módulo do motor usa a versão {module} da interface, mas esta página espera a versão {page}. Recompile o módulo.',
  'The simulation engine stopped: {reason}': 'O motor de simulação parou: {reason}',
  'The simulation engine could not start: {reason}':
    'O motor de simulação não pôde iniciar: {reason}',
  'the engine module answered {status}': 'o módulo do motor retornou o código {status}',
  'The simulation engine could not be loaded: {reason}':
    'O motor de simulação não pôde ser carregado: {reason}',
  'The AEGIS server did not answer in time.': 'O servidor do AEGIS não respondeu a tempo.',
  'The AEGIS server is unreachable.': 'Não foi possível conectar ao servidor do AEGIS.',
  'The server sent a non-JSON response.': 'O servidor respondeu em um formato diferente de JSON.',
  'Request failed with HTTP {status}.': 'A requisição falhou com HTTP {status}.',
  'The response for {path} does not match contract v1.0.':
    'A resposta de {path} não corresponde ao contrato v1.0.',
  'message is not JSON': 'a mensagem não é JSON',
  'message does not match stream contract v1': 'a mensagem não corresponde ao contrato de fluxo v1',

  // What an action that failed, or did something, says.
  'Playback could not be changed.': 'A reprodução não pôde ser alterada.',
  'The scenario did not start.': 'Não foi possível iniciar o cenário.',
  'The fault could not be placed.': 'A falha não pôde ser aplicada.',
  'The fault could not be lifted.': 'A falha não pôde ser retirada.',
  'The scenario could not be stopped.': 'O cenário não pôde ser parado.',
  'The simulation could not be reset.': 'A simulação não pôde ser reiniciada.',
  'Simulation reset to a clean baseline.': 'A simulação voltou ao estado inicial.',
  'The topology could not be switched.': 'A topologia não pôde ser trocada.',
  'The recording could not be loaded.': 'A gravação não pôde ser carregada.',
  'The integration could not be connected.': 'A integração não pôde ser conectada.',
  'The integration could not be disconnected.': 'A integração não pôde ser desconectada.',
  'Now showing the imported files.': 'Os arquivos importados estão em uso.',
  '{title}. Its summary is ready.': '{title}. O resumo está pronto.',
  'Open the summary': 'Abrir o resumo',

  // Where the simulation runs: in this tab, or on a server.
  'what this page opened with': 'os arquivos iniciais da página',
  'what the server started with': 'os arquivos iniciais do servidor',
  'Files imported into this page. They are held in its memory and are gone when it is reloaded.':
    'Os arquivos importados ficam na memória até a página ser recarregada.',
  'Files imported since this server started. They are held in its memory and are gone when it restarts.':
    'Os arquivos importados ficam na memória até o servidor ser reiniciado.',
  'Back to the files this page opened with.':
    'Os arquivos iniciais da página voltaram a ser usados.',
  'Back to the files the server started with.':
    'Os arquivos iniciais do servidor voltaram a ser usados.',
  'This page runs the simulation in the browser. The live adapters (a local cedar-agent, a load-test target) need the AEGIS server.':
    'A simulação roda no navegador. As integrações com um cedar-agent local ou um alvo de teste de carga dependem do servidor do AEGIS.',
  'Live adapters only accept loopback targets (or hosts explicitly allow-listed on the server), use short timeouts and never follow redirects.':
    'As integrações só aceitam endereços de loopback ou hosts autorizados no servidor. As requisições têm um tempo limite curto e não seguem redirecionamentos.',
  'Evaluating with a local cedar-agent needs the AEGIS server. This page has the embedded engine only.':
    'Para avaliar com um cedar-agent local, é preciso usar o servidor do AEGIS. Esta página usa apenas o motor embutido.',
  'Connect a local cedar-agent under Integrations to evaluate with it instead.':
    'Conecte um cedar-agent local em Integrações para avaliar com ele.',
  'not timed in the browser': 'não cronometrado no navegador',
  '{n} µs measured': '{n} µs medidos',
} as const satisfies Record<string, string>;
