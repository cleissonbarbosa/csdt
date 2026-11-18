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
  'object stores': 'armazenamentos de objetos',
  'Network gateway': 'Gateway de rede',
  Network: 'Rede',
  'network gateways': 'gateways de rede',
  'Security monitor': 'Monitor de segurança',
  Monitor: 'Monitor',
  'security monitors': 'monitores de segurança',
  'External client': 'Cliente externo',
  'external clients': 'clientes externos',

  // How one service relates to another.
  'Routes to': 'Encaminha para',
  'Authenticates with': 'Autentica com',
  'Authorizes with': 'Autoriza com',
  'Reads / writes': 'Lê / grava',
  'Publishes to': 'Publica em',
  'Consumed by': 'Consumido por',
  'Replicates to': 'Replica para',
  'Reports to': 'Reporta a',

  // Where data comes from.
  Synthetic: 'Sintético',
  Recording: 'Gravação',
  Live: 'Ao vivo',
  'Produced by the built-in simulation engine.': 'Produzido pelo motor de simulação embutido.',
  'Imported from a bundled fixture file.': 'Importado de um arquivo de exemplo incluído.',
  'Measured from an explicitly connected local instance.':
    'Medido de uma instância local conectada explicitamente.',
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
    'O renderizador 3D não pôde iniciar neste dispositivo. Mostrando a vista em tabela.',
  'This browser offers neither WebGPU nor WebGL 2, so the 3D scene is unavailable. Showing the table view instead.':
    'Este navegador não oferece WebGPU nem WebGL 2, então a cena 3D não está disponível. Mostrando a vista em tabela.',

  // When nothing answers.
  'The simulation engine is not running': 'O motor de simulação não está rodando',
  'On this page the simulation runs in the browser, from a WebAssembly module. Nothing is shown in its place: AEGIS does not invent data.':
    'Nesta página a simulação roda no navegador, a partir de um módulo WebAssembly. Nada é mostrado no lugar dela: o AEGIS não inventa dados.',
  'Reload the page': 'Recarregar a página',
  'The AEGIS server is not answering': 'O servidor do AEGIS não está respondendo',
  'Start it with:': 'Inicie-o com:',
  'The interface reconnects by itself as soon as the server is up. Nothing is shown in the meantime: AEGIS does not invent data.':
    'A interface se reconecta sozinha assim que o servidor estiver no ar. Nada é mostrado enquanto isso: o AEGIS não inventa dados.',
  'Retry now': 'Tentar agora',
  'The simulation engine is not running.': 'O motor de simulação não está rodando.',
  'The server could not be reached.': 'Não foi possível alcançar o servidor.',
  'Asking the engine…': 'Perguntando ao motor…',
  'Asking the server…': 'Perguntando ao servidor…',
  'Loading the engine': 'Carregando o motor',
  'The topology could not be loaded.': 'A topologia não pôde ser carregada.',
  'The simulation engine could not be loaded.': 'O motor de simulação não pôde ser carregado.',
  'This browser could not start the simulation engine.':
    'Este navegador não conseguiu iniciar o motor de simulação.',
  'The engine is not running.': 'O motor não está rodando.',
  'The simulation engine did not answer in time.': 'O motor de simulação não respondeu a tempo.',
  'The module is not the AEGIS engine.': 'O módulo não é o motor do AEGIS.',
  'The engine module speaks version {module} of its boundary and this page version {page}. Rebuild it.':
    'O módulo do motor fala a versão {module} da sua interface e esta página, a versão {page}. Compile-o de novo.',
  'The simulation engine stopped: {reason}': 'O motor de simulação parou: {reason}',
  'The simulation engine could not start: {reason}':
    'O motor de simulação não pôde iniciar: {reason}',
  'the engine module answered {status}': 'o módulo do motor respondeu {status}',
  'The simulation engine could not be loaded: {reason}':
    'O motor de simulação não pôde ser carregado: {reason}',
  'The AEGIS server did not answer in time.': 'O servidor do AEGIS não respondeu a tempo.',
  'The AEGIS server is unreachable.': 'Não é possível alcançar o servidor do AEGIS.',
  'The server sent a non-JSON response.': 'O servidor enviou uma resposta que não é JSON.',
  'Request failed with HTTP {status}.': 'A requisição falhou com HTTP {status}.',
  'The response for {path} does not match contract v1.0.':
    'A resposta de {path} não corresponde ao contrato v1.0.',
  'message is not JSON': 'a mensagem não é JSON',
  'message does not match stream contract v1': 'a mensagem não corresponde ao contrato de fluxo v1',

  // What an action that failed, or did something, says.
  'Playback could not be changed.': 'A reprodução não pôde ser alterada.',
  'The scenario did not start.': 'O cenário não iniciou.',
  'The fault could not be placed.': 'A falha não pôde ser aplicada.',
  'The fault could not be lifted.': 'A falha não pôde ser retirada.',
  'The scenario could not be stopped.': 'O cenário não pôde ser parado.',
  'The simulation could not be reset.': 'A simulação não pôde ser reiniciada.',
  'Simulation reset to a clean baseline.': 'Simulação reiniciada, do zero.',
  'The topology could not be switched.': 'A topologia não pôde ser trocada.',
  'The recording could not be loaded.': 'A gravação não pôde ser carregada.',
  'The integration could not be connected.': 'A integração não pôde ser conectada.',
  'The integration could not be disconnected.': 'A integração não pôde ser desconectada.',
  'Now showing the imported files.': 'Mostrando agora os arquivos importados.',
  '{title}. Its summary is ready.': '{title}. O resumo está pronto.',
  'Open the summary': 'Abrir o resumo',

  // Where the simulation runs: in this tab, or on a server.
  'what this page opened with': 'o que esta página abriu',
  'what the server started with': 'o que o servidor carregou ao iniciar',
  'Files imported into this page. They are held in its memory and are gone when it is reloaded.':
    'Arquivos importados nesta página. Ficam na memória dela e somem quando ela é recarregada.',
  'Files imported since this server started. They are held in its memory and are gone when it restarts.':
    'Arquivos importados desde que este servidor iniciou. Ficam na memória dele e somem quando ele reinicia.',
  'Back to the files this page opened with.': 'De volta aos arquivos com que esta página abriu.',
  'Back to the files the server started with.': 'De volta aos arquivos com que o servidor iniciou.',
  'This page runs the simulation in the browser. The live adapters (a local cedar-agent, a load-test target) need the AEGIS server.':
    'Esta página roda a simulação no navegador. Os adaptadores ao vivo (um cedar-agent local, um alvo de teste de carga) precisam do servidor do AEGIS.',
  'Live adapters only accept loopback targets (or hosts explicitly allow-listed on the server), use short timeouts and never follow redirects.':
    'Os adaptadores ao vivo só aceitam alvos de loopback (ou hosts liberados explicitamente no servidor), usam tempos limite curtos e nunca seguem redirecionamentos.',
  'Evaluating with a local cedar-agent needs the AEGIS server. This page has the embedded engine only.':
    'Avaliar com um cedar-agent local precisa do servidor do AEGIS. Esta página tem só o motor embutido.',
  'Connect a local cedar-agent under Integrations to evaluate with it instead.':
    'Conecte um cedar-agent local em Integrações para avaliar com ele.',
  'not timed in the browser': 'não cronometrado no navegador',
  '{n} µs measured': '{n} µs medidos',
} as const satisfies Record<string, string>;
