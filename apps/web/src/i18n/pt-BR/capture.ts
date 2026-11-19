/**
 * Incident captures: a real incident, as a provider reported it or a system
 * recorded it, read in the browser. Their words are in the glossary at the
 * top of `common.ts` (captura, relatório do provedor, sem dados, não
 * informado); a capture is never "gravação" or "gravado", which stay the
 * simulation's, and never "Rever", the simulation's re-simulated history.
 */
export default {
  // Opening one.
  'There is no incident capture called “{id}”.': 'Não há captura de incidente chamada “{id}”.',
  '“{title}” could not be read.': 'Não foi possível ler “{title}”.',
  '“{file}” could not be opened. {reason}': 'Não foi possível abrir “{file}”. {reason}',
  'The file is larger than 12 MiB.': 'O arquivo tem mais de 12 MiB.',
  'The file is not an incident capture this version can read.':
    'Esta versão do AEGIS não consegue ler o arquivo como uma captura de incidente.',
  'Open an incident capture': 'Abrir uma captura de incidente',
  'A real incident, as a provider reported it or a system recorded it, read in this browser and shown as it is: captured, not simulated. The simulation goes on untouched behind it.':
    'Veja um incidente real tal como foi relatado por um provedor ou registrado por um sistema. O navegador lê a captura diretamente e identifica os dados como não simulados. A simulação continua em segundo plano.',
  'Captures that come with AEGIS': 'Capturas incluídas no AEGIS',
  'Opening…': 'Abrindo…',
  'Open a capture file…': 'Abrir um arquivo de captura…',
  'Capture file to open': 'Selecionar arquivo de captura',
  'An incident capture file of up to 12 MiB. It is read in this tab and sent nowhere.':
    'Selecione um arquivo de captura de incidente de até 12 MiB. A leitura acontece apenas nesta aba, sem enviar o arquivo.',

  // Where it comes from, and what it says of a service.
  'Captured, not simulated': 'Capturado, não simulado',
  "From the provider's report, not simulated": 'Do relatório do provedor, não simulado',
  'No data': 'Sem dados',
  'Error rate not measured': 'Taxa de erro não medida',
  Normal: 'Normal',
  'Not stated at this time': 'Não informado neste momento',
  'Reported affected': 'Afetado segundo o relatório',
  'Reported recovering': 'Em recuperação segundo o relatório',
  'Reported recovered': 'Recuperado segundo o relatório',
  'Not stated in the report': 'Não informado no relatório',
  'Kind mapped from the resource type the source reported':
    'Tipo derivado do tipo de recurso informado pela fonte',
  'Kind declared by the operator': 'Tipo declarado pelo operador',
  'Kind assumed: the source does not say': 'Tipo presumido (a fonte não informa)',
  'Upright piece on a dashed ring, a shade fainter: in an incident capture, a service whose state the source does not give':
    'Na captura de incidente, uma peça em pé sobre um anel tracejado, com cor mais suave, indica um serviço cujo estado a fonte não informa',
  "Where a sample has no count to take an error rate from, the state reads “{unmeasured}”; in a provider's report, “{unstated}”.":
    'Quando faltam contagens para calcular a taxa de erro de uma amostra, o estado aparece como “{unmeasured}”. No relatório do provedor, o estado aparece como “{unstated}”.',

  // How it is to be read.
  'How to read it': 'Como ler',
  "Coloured by the error rates at which the simulation calls a service degraded ({degraded}) or critical ({critical}), applied to each sample as measured, without the simulation's smoothing or delay. The source sets no threshold.":
    'As cores usam os limiares de erro da simulação para indicar quando um serviço está degradado ({degraded}) ou crítico ({critical}). A fonte não define limiares. Cada amostra é usada como foi medida, sem suavização nem atraso.',
  'Reported impact is drawn as critical and a reported recovery as degraded; the report does not grade how severe the impact was.':
    'O relatório não indica a gravidade do impacto. Serviços afetados aparecem como críticos e serviços em recuperação aparecem como degradados.',
  'A service whose state the source does not give is drawn upright on a dashed ring, a shade fainter: unknown, never normal.':
    'Quando a fonte não informa o estado de um serviço, a peça fica em pé sobre um anel tracejado, com cor mais suave, para indicar um estado desconhecido.',
  "Transcribed by hand from the report: the products shown, their connections and kinds, and the state at each update are AEGIS's reading of the text; each event names the update it rests on.":
    'Os produtos, seus tipos e conexões e o estado em cada atualização foram extraídos manualmente da leitura que o AEGIS fez do relatório. Cada evento cita a atualização em que se baseia.',
  'The report has no request measurements: the pieces rest because nothing was measured, not because nothing passed.':
    'As peças ficam paradas porque o relatório não traz medições de requisições que indiquem quanto tráfego passou.',
  "The report states no condition for a connection: this one is part of AEGIS's reading of its text.":
    'O relatório não informa o estado das conexões. Esta conexão vem da interpretação que o AEGIS fez do texto.',
  'The source found its connections from {start} to {end}, UTC: one that was found may not have carried requests at every moment.':
    'A fonte identificou as conexões entre {start} e {end} (UTC). Elas podem ter transportado requisições em apenas parte desse período.',

  // Its figures.
  Measurements: 'Medições',
  Requests: 'Requisições',
  'in {period}': 'em {period}',
  'Peak memory': 'Pico de uso de memória',
  'Not measured': 'Não medido',
  'No requests': 'Sem requisições',
  'Sample from {time} UTC': 'Amostra das {time} UTC',
  'No sample at this time': 'Nenhuma amostra neste momento',
  '{measure} over the capture': '{measure} ao longo da captura',
  'Normal below {degraded} (simulation threshold)':
    'Normal abaixo de {degraded} (limiar da simulação)',
  'No normal range: the source states none. Lowest–highest in this capture: {low}–{high}.':
    'A fonte não informa uma faixa normal. Os valores desta captura vão de {low} a {high}.',
  'Not measured in this capture.': 'Não medido nesta captura.',
  'This capture has no error counts, so no service in it is coloured.':
    'Como a captura não traz contagens de erros, os serviços aparecem sem cor de estado.',
  'No connection from this service in the capture.':
    'A captura não mostra conexões de saída deste serviço.',
  'Show the connections': 'Mostrar as conexões',
  'Hide the connections': 'Ocultar as conexões',
  'No connection to this service in the capture.':
    'A captura não mostra conexões de entrada neste serviço.',
  "Errors are CloudWatch's “Fault” metric; requests are the sample count of its “Latency”.":
    'No CloudWatch, os erros vêm da métrica “Fault” e o total de requisições vem da contagem de amostras de “Latency”.',
  "Errors are the Tempo service graph's failed-request counter.":
    'Os erros vêm do contador de requisições com falha no grafo de serviços do Tempo.',
  'Errors are as the source counted them; its notes say which measure.':
    'A contagem de erros é a da fonte. Consulte as notas da fonte para saber qual métrica foi usada.',

  // What it covers.
  'Close the details': 'Fechar os detalhes',
  'Read from {file} in this browser': 'Lido de {file} neste navegador',
  'What it covers': 'Abrangência da captura',
  Window: 'Janela',
  'Connections found': 'Conexões encontradas',
  'Sampling period': 'Período de amostragem',
  Connections: 'Conexões',
  Notes: 'Notas',

  // Its services and its events.
  'Services and events': 'Serviços e eventos',
  'Services of the capture, by region': 'Serviços da captura, por região',
  '{from} to {to}': '{from} para {to}',
  'Events, in time order': 'Eventos em ordem cronológica',
  'This capture has no events.': 'Esta captura não tem eventos.',

  // Its time.
  'Capture timeline and playback': 'Linha do tempo e reprodução da captura',
  'How much capture time passes in each second of yours':
    'Tempo da captura que passa a cada segundo de reprodução',
  '{time} UTC': '{time} UTC',
  '{offset} into the capture': '{offset} desde o início da captura',
  '{time} UTC, {offset} into the capture': '{time} UTC, {offset} desde o início da captura',
  'From {start} to {end}, UTC': 'De {start} a {end}, UTC',

  // The sentence in the bar. A count followed by "not stated" is "sem
  // informação", which needs no agreement with the count.
  'At {time} UTC: {sentence}': 'Às {time} UTC: {sentence}',
  'Show the events of the capture': 'Mostrar os eventos da captura',
  'No measurements at this time': 'Nenhuma medição neste momento',
  'No service measured at this time': 'Sem medições de serviços neste momento',
  '{n} service measured; error counts are not in this capture':
    'Medições de {n} serviço. A captura não inclui contagens de erros',
  '{n} services measured; error counts are not in this capture':
    'Medições de {n} serviços. A captura não inclui contagens de erros',
  '{n} service measured, without an error rate at this time':
    '{n} serviço medido, sem taxa de erro neste momento',
  '{n} services measured, none with an error rate at this time':
    '{n} serviços medidos, nenhum com taxa de erro neste momento',
  '{known} service, past the error levels': '{known} serviço atingiu o limiar de erro',
  '{known} service, past the error levels; {unknown} without an error rate':
    '{known} serviço atingiu o limiar de erro, {unknown} sem taxa de erro',
  '{past} of {known} services past the error levels':
    'Serviços que atingiram o limiar de erro: {past} de {known}',
  '{past} of {known} services past the error levels; {unknown} without an error rate':
    'Serviços que atingiram o limiar de erro: {past} de {known}, com outros {unknown} sem taxa de erro',
  '{known} service, not past the error levels': '{known} serviço abaixo dos limiares de erro',
  '{known} services, none past the error levels':
    '{known} serviços, todos abaixo dos limiares de erro',
  '{known} service, not past the error levels; {unknown} without an error rate':
    '{known} serviço abaixo dos limiares de erro, {unknown} sem taxa de erro',
  '{known} services, none past the error levels; {unknown} without an error rate':
    '{known} serviços abaixo dos limiares de erro, {unknown} sem taxa de erro',
  '{affected} service reported affected': '{affected} serviço afetado segundo o relatório',
  '{affected} services reported affected': '{affected} serviços afetados segundo o relatório',
  '{affected} service reported affected; {notStated} not stated':
    '{affected} serviço afetado segundo o relatório, {notStated} sem informação',
  '{affected} services reported affected; {notStated} not stated':
    '{affected} serviços afetados segundo o relatório, {notStated} sem informação',
  '{recovering} service reported recovering':
    '{recovering} serviço em recuperação segundo o relatório',
  '{recovering} services reported recovering':
    '{recovering} serviços em recuperação segundo o relatório',
  '{recovering} service reported recovering; {notStated} not stated':
    '{recovering} serviço em recuperação segundo o relatório, {notStated} sem informação',
  '{recovering} services reported recovering; {notStated} not stated':
    '{recovering} serviços em recuperação segundo o relatório, {notStated} sem informação',
  '{affected} service reported affected, {recovering} recovering':
    '{affected} serviço afetado e {recovering} em recuperação segundo o relatório',
  '{affected} services reported affected, {recovering} recovering':
    '{affected} serviços afetados e {recovering} em recuperação segundo o relatório',
  '{affected} service reported affected, {recovering} recovering; {notStated} not stated':
    '{affected} serviço afetado e {recovering} em recuperação segundo o relatório, {notStated} sem informação',
  '{affected} services reported affected, {recovering} recovering; {notStated} not stated':
    '{affected} serviços afetados e {recovering} em recuperação segundo o relatório, {notStated} sem informação',
  '{n} service reported recovered': '{n} serviço recuperado segundo o relatório',
  '{n} services reported recovered': '{n} serviços recuperados segundo o relatório',
  '{n} service reported recovered; {notStated} not stated':
    '{n} serviço recuperado segundo o relatório, {notStated} sem informação',
  '{n} services reported recovered; {notStated} not stated':
    '{n} serviços recuperados segundo o relatório, {notStated} sem informação',
  '{n} service, not stated yet in the report':
    'O relatório ainda não informa o estado de {n} serviço',
  '{n} services, none stated yet in the report':
    'O relatório ainda não informa o estado de nenhum dos {n} serviços',

  // The application while a capture is open: its bar, its menu, its keys.
  'Incident capture': 'Captura de incidente',
  Captured: 'Capturado',
  Reported: 'Relatado',
  '{provenance}: {title}. Show what the capture is.':
    '{provenance}: {title}. Mostrar detalhes da captura.',
  'What the capture is': 'Sobre a captura',
  'Service in the capture': 'Serviço na captura',
  'Connection in the capture': 'Conexão na captura',
  'Back to the simulation': 'Voltar à simulação',
  Back: 'Voltar',
  'Open another capture': 'Abrir outra captura',
  'a real incident, not simulated': 'um incidente real, não simulado',
  'Play or pause the capture': 'Reproduzir ou pausar a captura',
  'List the services of the capture': 'Listar os serviços da captura',
  "On the capture's timeline: step one sampling period, or a hundredth of the window where there is none (hold Shift for ten)":
    'Na linha do tempo da captura, cada passo equivale a um período de amostragem ou a 1% da duração total quando não há amostragem (mantenha Shift pressionado para dar dez passos)',
  'Home / End': 'Home / End',
  'The start or the end of the capture': 'O início ou o fim da captura',
  'Apart from what a connected local instance reports (labelled Live), an incident capture is the one exception: a real incident as its source gave it, read in this browser, labelled as not simulated and never mixed into the simulation.':
    'As exceções são os dados de uma instância local conectada, marcados como Ao vivo, e as capturas de incidentes reais. O navegador lê cada captura como fornecida pela fonte, mostra que os dados são reais e os mantém separados da simulação.',

  // A draft of a platform written from a capture, as the import dialog says it.
  'Drafted in this page from the capture “{title}”: {services} of its services and {connections} of the connections it saw. A starting point to edit; nothing is applied until you apply it.':
    'Este rascunho foi criado nesta página a partir da captura “{title}”. Inclui {services} dos serviços e {connections} das conexões observadas na captura. Você pode editar o rascunho antes de aplicá-lo.',
  'Connection weights: {measured} read from the capture (calls seen over requests the caller handled, at rest), {assumed} left at 1.':
    'Para os pesos das conexões, {measured} vêm da captura (chamadas observadas divididas pelas requisições atendidas pelo serviço de origem, em repouso) e {assumed} ficaram com o valor 1.',
  'Latency at rest: {measured} read from the capture (median p95 less that of what each service calls), {assumed} at a placeholder of {ms} ms.':
    'Para a latência em repouso, calculamos {measured} valores com os dados da captura (mediana da latência p95 do serviço menos a contribuição dos serviços que ele chama) e usamos o valor provisório de {ms} ms para os outros {assumed}.',
  'Demand: {rate} req/s, the median the entry was seen to receive at rest, from one client added in front of it.':
    'Um cliente adicionado antes do serviço de entrada gera a demanda de {rate} req/s, a mediana que esse serviço recebeu em repouso.',
  'Demand: a default of {rate} req/s. The capture measured no requests at its entry.':
    'Demanda: um valor padrão de {rate} req/s. A captura não mediu requisições na entrada.',
  'Left out so that calls run one way, as a topology has to: {connections}.':
    'Estas conexões ficaram de fora para evitar ciclos na topologia: {connections}.',
  'No capture states a capacity. Each service has the model’s default headroom over its load at rest: give capacityRps to the services whose limits you know before reading what breaks.':
    'Nenhuma captura informa a capacidade dos serviços. O modelo aplica uma margem padrão sobre a carga em repouso de cada serviço. Preencha capacityRps nos serviços cujos limites você conhece para avaliar onde surgem falhas.',
  'A scenario repeats the load the capture measured, from ×{low} to ×{high} of its level at rest. It prescribes load and nothing else. One second of it is {n} seconds of the capture.':
    'O cenário prescreve apenas a carga medida na captura, entre ×{low} e ×{high} da carga em repouso. Cada segundo do cenário corresponde a {n} segundos da captura.',
  'A scenario repeats the load the capture measured, from ×{low} to ×{high} of its level at rest. It prescribes load and nothing else.':
    'O cenário prescreve apenas a carga medida na captura, entre ×{low} e ×{high} da carga em repouso.',
  'No draft can be written: a service of this capture has an id longer than a platform file takes (64 characters).':
    'Não foi possível gerar o rascunho. O ID de um serviço da captura excede o limite de 64 caracteres do arquivo de plataforma.',
  'No draft can be written: this capture holds no service, only clients.':
    'Não foi possível gerar o rascunho porque a captura contém apenas clientes.',
  'Demand: {rate} req/s, by convention. The capture did not count the requests its entry handled, so the entry is taken to be as busy as its busiest call. The calls it makes downstream come out as measured; its own load rests on that convention.':
    'A demanda é de {rate} req/s por convenção. Como a captura não contou as requisições atendidas na entrada, usamos o volume da conexão de saída com mais chamadas. A carga da entrada segue essa convenção e as chamadas de saída mantêm os valores medidos.',
  '{n} service was seen in no call: it is in the platform, connected to nothing.':
    '{n} serviço está na plataforma sem conexões, pois não participou de nenhuma chamada observada.',
  '{n} services were seen in no call: they are in the platform, connected to nothing.':
    '{n} serviços estão na plataforma sem conexões, pois não participaram de nenhuma chamada observada.',
} as const satisfies Record<string, string>;
