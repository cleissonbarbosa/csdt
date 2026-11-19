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
    'O arquivo não é uma captura de incidente que esta versão consiga ler.',
  'Open an incident capture': 'Abrir uma captura de incidente',
  'A real incident, as a provider reported it or a system recorded it, read in this browser and shown as it is: captured, not simulated. The simulation goes on untouched behind it.':
    'Um incidente real, como um provedor o relatou ou um sistema o registrou, lido neste navegador e mostrado como é: capturado, não simulado. A simulação continua intocada por trás.',
  'Captures that come with AEGIS': 'Capturas que vêm com o AEGIS',
  'Opening…': 'Abrindo…',
  'Open a capture file…': 'Abrir um arquivo de captura…',
  'Capture file to open': 'Arquivo de captura a abrir',
  'An incident capture file of up to 12 MiB. It is read in this tab and sent nowhere.':
    'Um arquivo de captura de incidente de até 12 MiB. Ele é lido nesta aba e não é enviado a lugar nenhum.',

  // Where it comes from, and what it says of a service.
  'Captured, not simulated': 'Capturado, não simulado',
  "From the provider's report, not simulated": 'Do relatório do provedor, não simulado',
  'No data': 'Sem dados',
  'Error rate not measured': 'Taxa de erro não medida',
  Normal: 'Normal',
  'Not stated at this time': 'Não informado neste momento',
  'Reported affected': 'Relatado como afetado',
  'Reported recovering': 'Relatado em recuperação',
  'Reported recovered': 'Relatado como recuperado',
  'Not stated in the report': 'Não informado no relatório',
  'Kind mapped from the resource type the source reported':
    'Tipo mapeado a partir do tipo de recurso que a fonte informou',
  'Kind declared by the operator': 'Tipo declarado pelo operador',
  'Kind assumed: the source does not say': 'Tipo presumido: a fonte não diz',
  'Upright piece on a dashed ring, a shade fainter: in an incident capture, a service whose state the source does not give':
    'Peça em pé sobre um anel tracejado, um pouco mais esmaecida: numa captura de incidente, um serviço cujo estado a fonte não informa',
  "Where a sample has no count to take an error rate from, the state reads “{unmeasured}”; in a provider's report, “{unstated}”.":
    'Onde uma amostra não tem contagem da qual tirar uma taxa de erro, o estado aparece como “{unmeasured}”; num relatório do provedor, como “{unstated}”.',

  // How it is to be read.
  'How to read it': 'Como ler',
  "Coloured by the error rates at which the simulation calls a service degraded ({degraded}) or critical ({critical}), applied to each sample as measured, without the simulation's smoothing or delay. The source sets no threshold.":
    'Colorido pelas taxas de erro em que a simulação considera um serviço degradado ({degraded}) ou crítico ({critical}), aplicadas a cada amostra como foi medida, sem a suavização nem o atraso da simulação. A fonte não define limiar.',
  'Reported impact is drawn as critical and a reported recovery as degraded; the report does not grade how severe the impact was.':
    'O impacto relatado é desenhado como crítico e uma recuperação relatada como degradada; o relatório não classifica a gravidade do impacto.',
  'A service whose state the source does not give is drawn upright on a dashed ring, a shade fainter: unknown, never normal.':
    'Um serviço cujo estado a fonte não informa é desenhado em pé sobre um anel tracejado, um pouco mais esmaecido: desconhecido, nunca normal.',
  "Transcribed by hand from the report: the products shown, their connections and kinds, and the state at each update are AEGIS's reading of the text; each event names the update it rests on.":
    'Transcrito à mão do relatório: os produtos mostrados, suas conexões e tipos, e o estado em cada atualização são a leitura que o AEGIS fez do texto; cada evento cita a atualização em que se baseia.',
  'The report has no request measurements: the pieces rest because nothing was measured, not because nothing passed.':
    'O relatório não tem medições de requisições: as peças ficam paradas porque nada foi medido, não porque nada passou.',
  "The report states no condition for a connection: this one is part of AEGIS's reading of its text.":
    'O relatório não informa a condição de nenhuma conexão: esta faz parte da leitura que o AEGIS fez do texto.',
  'The source found its connections from {start} to {end}, UTC: one that was found may not have carried requests at every moment.':
    'A fonte encontrou as conexões de {start} a {end}, UTC: uma conexão encontrada pode não ter levado requisições em todos os momentos.',

  // Its figures.
  Measurements: 'Medições',
  Requests: 'Requisições',
  'in {period}': 'em {period}',
  'Peak memory': 'Memória máxima',
  'Not measured': 'Não medido',
  'No requests': 'Sem requisições',
  'Sample from {time} UTC': 'Amostra das {time} UTC',
  'No sample at this time': 'Nenhuma amostra neste momento',
  '{measure} over the capture': '{measure} ao longo da captura',
  'Normal below {degraded} (simulation threshold)':
    'Normal abaixo de {degraded} (limiar da simulação)',
  'No normal range: the source states none. Lowest–highest in this capture: {low}–{high}.':
    'Sem faixa normal: a fonte não informa nenhuma. Menor–maior nesta captura: {low}–{high}.',
  'Not measured in this capture.': 'Não medido nesta captura.',
  'This capture has no error counts, so no service in it is coloured.':
    'Esta captura não tem contagem de erros, então nenhum serviço nela é colorido.',
  'No connection from this service in the capture.': 'Nenhuma conexão deste serviço na captura.',
  'Show the connections': 'Mostrar as conexões',
  'Hide the connections': 'Ocultar as conexões',
  'No connection to this service in the capture.': 'Nenhuma conexão para este serviço na captura.',
  "Errors are CloudWatch's “Fault” metric; requests are the sample count of its “Latency”.":
    'Os erros são a métrica “Fault” do CloudWatch; as requisições são a contagem de amostras da sua “Latency”.',
  "Errors are the Tempo service graph's failed-request counter.":
    'Os erros são o contador de requisições malsucedidas do grafo de serviços do Tempo.',
  'Errors are as the source counted them; its notes say which measure.':
    'Os erros são os que a fonte contou; as notas dela dizem qual medida.',

  // What it covers.
  'Close the details': 'Fechar os detalhes',
  'Read from {file} in this browser': 'Lido de {file} neste navegador',
  'What it covers': 'O que ela abrange',
  Window: 'Janela',
  'Connections found': 'Conexões encontradas',
  'Sampling period': 'Período de amostragem',
  Connections: 'Conexões',
  Notes: 'Notas',

  // Its services and its events.
  'Services and events': 'Serviços e eventos',
  'Services of the capture, by region': 'Serviços da captura, por região',
  '{from} to {to}': '{from} para {to}',
  'Events, in time order': 'Eventos, em ordem de tempo',
  'This capture has no events.': 'Esta captura não tem eventos.',

  // Its time.
  'Capture timeline and playback': 'Linha do tempo e reprodução da captura',
  'How much capture time passes in each second of yours':
    'Quanto tempo da captura passa em cada segundo seu',
  '{time} UTC': '{time} UTC',
  '{offset} into the capture': '{offset} desde o início da captura',
  '{time} UTC, {offset} into the capture': '{time} UTC, {offset} desde o início da captura',
  'From {start} to {end}, UTC': 'De {start} a {end}, UTC',

  // The sentence in the bar. A count followed by "not stated" is "sem
  // informação", which needs no agreement with the count.
  'At {time} UTC: {sentence}': 'Às {time} UTC: {sentence}',
  'Show the events of the capture': 'Mostrar os eventos da captura',
  'No measurements at this time': 'Nenhuma medição neste momento',
  'No service measured at this time': 'Nenhum serviço medido neste momento',
  '{n} service measured; error counts are not in this capture':
    '{n} serviço medido; esta captura não traz contagem de erros',
  '{n} services measured; error counts are not in this capture':
    '{n} serviços medidos; esta captura não traz contagem de erros',
  '{n} service measured, without an error rate at this time':
    '{n} serviço medido, sem taxa de erro neste momento',
  '{n} services measured, none with an error rate at this time':
    '{n} serviços medidos, nenhum com taxa de erro neste momento',
  '{known} service, past the error levels': '{known} serviço, acima dos níveis de erro',
  '{known} service, past the error levels; {unknown} without an error rate':
    '{known} serviço, acima dos níveis de erro; {unknown} sem taxa de erro',
  '{past} of {known} services past the error levels':
    '{past} de {known} serviços acima dos níveis de erro',
  '{past} of {known} services past the error levels; {unknown} without an error rate':
    '{past} de {known} serviços acima dos níveis de erro; {unknown} sem taxa de erro',
  '{known} service, not past the error levels': '{known} serviço, abaixo dos níveis de erro',
  '{known} services, none past the error levels':
    '{known} serviços, nenhum acima dos níveis de erro',
  '{known} service, not past the error levels; {unknown} without an error rate':
    '{known} serviço, abaixo dos níveis de erro; {unknown} sem taxa de erro',
  '{known} services, none past the error levels; {unknown} without an error rate':
    '{known} serviços, nenhum acima dos níveis de erro; {unknown} sem taxa de erro',
  '{affected} service reported affected': '{affected} serviço relatado como afetado',
  '{affected} services reported affected': '{affected} serviços relatados como afetados',
  '{affected} service reported affected; {notStated} not stated':
    '{affected} serviço relatado como afetado; {notStated} sem informação',
  '{affected} services reported affected; {notStated} not stated':
    '{affected} serviços relatados como afetados; {notStated} sem informação',
  '{recovering} service reported recovering': '{recovering} serviço relatado em recuperação',
  '{recovering} services reported recovering': '{recovering} serviços relatados em recuperação',
  '{recovering} service reported recovering; {notStated} not stated':
    '{recovering} serviço relatado em recuperação; {notStated} sem informação',
  '{recovering} services reported recovering; {notStated} not stated':
    '{recovering} serviços relatados em recuperação; {notStated} sem informação',
  '{affected} service reported affected, {recovering} recovering':
    '{affected} serviço relatado como afetado, {recovering} em recuperação',
  '{affected} services reported affected, {recovering} recovering':
    '{affected} serviços relatados como afetados, {recovering} em recuperação',
  '{affected} service reported affected, {recovering} recovering; {notStated} not stated':
    '{affected} serviço relatado como afetado, {recovering} em recuperação; {notStated} sem informação',
  '{affected} services reported affected, {recovering} recovering; {notStated} not stated':
    '{affected} serviços relatados como afetados, {recovering} em recuperação; {notStated} sem informação',
  '{n} service reported recovered': '{n} serviço relatado como recuperado',
  '{n} services reported recovered': '{n} serviços relatados como recuperados',
  '{n} service reported recovered; {notStated} not stated':
    '{n} serviço relatado como recuperado; {notStated} sem informação',
  '{n} services reported recovered; {notStated} not stated':
    '{n} serviços relatados como recuperados; {notStated} sem informação',
  '{n} service, not stated yet in the report': '{n} serviço, ainda não informado no relatório',
  '{n} services, none stated yet in the report':
    '{n} serviços, nenhum informado ainda no relatório',

  // The application while a capture is open: its bar, its menu, its keys.
  'Incident capture': 'Captura de incidente',
  Captured: 'Capturado',
  Reported: 'Relatado',
  '{provenance}: {title}. Show what the capture is.':
    '{provenance}: {title}. Mostrar o que é a captura.',
  'What the capture is': 'O que é a captura',
  'Service in the capture': 'Serviço na captura',
  'Connection in the capture': 'Conexão na captura',
  'Back to the simulation': 'Voltar à simulação',
  Back: 'Voltar',
  'Open another capture': 'Abrir outra captura',
  'a real incident, not simulated': 'um incidente real, não simulado',
  'Play or pause the capture': 'Reproduzir ou pausar a captura',
  'List the services of the capture': 'Listar os serviços da captura',
  "On the capture's timeline: step one sampling period, or a hundredth of the window where there is none (hold Shift for ten)":
    'Na linha do tempo da captura: passo de um período de amostragem, ou de um centésimo da janela onde não há período (segure Shift para dez)',
  'Home / End': 'Home / End',
  'The start or the end of the capture': 'O início ou o fim da captura',
  'Apart from what a connected local instance reports (labelled Live), an incident capture is the one exception: a real incident as its source gave it, read in this browser, labelled as not simulated and never mixed into the simulation.':
    'Além do que uma instância local conectada informa (marcado como Ao vivo), uma captura de incidente é a única exceção: um incidente real como a fonte o deu, lido neste navegador, marcado como não simulado e nunca misturado à simulação.',

  // A draft of a platform written from a capture, as the import dialog says it.
  'Drafted in this page from the capture “{title}”: {services} of its services and {connections} of the connections it saw. A starting point to edit; nothing is applied until you apply it.':
    'Rascunhado nesta página a partir da captura “{title}”: {services} dos serviços dela e {connections} das conexões que ela viu. Um ponto de partida para editar; nada é aplicado até você aplicar.',
  'Connection weights: {measured} read from the capture (calls seen over requests the caller handled, at rest), {assumed} left at 1.':
    'Pesos das conexões: {measured} lidos da captura (chamadas vistas sobre as requisições que o chamador atendeu, em repouso), {assumed} deixados em 1.',
  'Latency at rest: {measured} read from the capture (median p95 less that of what each service calls), {assumed} at a placeholder of {ms} ms.':
    'Latência em repouso: {measured} lidas da captura (mediana do p95 menos a do que cada serviço chama), {assumed} em um valor provisório de {ms} ms.',
  'Demand: {rate} req/s, the median the entry was seen to receive at rest, from one client added in front of it.':
    'Demanda: {rate} req/s, a mediana do que a entrada recebeu em repouso, vinda de um cliente acrescentado à frente dela.',
  'Demand: a default of {rate} req/s. The capture measured no requests at its entry.':
    'Demanda: um valor padrão de {rate} req/s. A captura não mediu requisições na entrada.',
  'Left out so that calls run one way, as a topology has to: {connections}.':
    'Deixadas de fora para que as chamadas corram em um só sentido, como uma topologia exige: {connections}.',
  'No capture states a capacity. Each service has the model’s default headroom over its load at rest: give capacityRps to the services whose limits you know before reading what breaks.':
    'Nenhuma captura informa capacidade. Cada serviço tem a folga padrão do modelo sobre a carga em repouso: informe capacityRps nos serviços cujos limites você conhece antes de ler o que quebra.',
  'A scenario repeats the load the capture measured, from ×{low} to ×{high} of its level at rest. It prescribes load and nothing else. One second of it is {n} seconds of the capture.':
    'Um cenário repete a carga que a captura mediu, de ×{low} a ×{high} do nível em repouso. Ele prescreve carga e nada mais. Um segundo dele são {n} segundos da captura.',
  'A scenario repeats the load the capture measured, from ×{low} to ×{high} of its level at rest. It prescribes load and nothing else.':
    'Um cenário repete a carga que a captura mediu, de ×{low} a ×{high} do nível em repouso. Ele prescreve carga e nada mais.',
  'No draft can be written: a service of this capture has an id longer than a platform file takes (64 characters).':
    'Não é possível escrever um rascunho: um serviço desta captura tem um id mais longo do que um arquivo de plataforma aceita (64 caracteres).',
  'No draft can be written: this capture holds no service, only clients.':
    'Não é possível escrever um rascunho: esta captura não tem nenhum serviço, só clientes.',
  'Demand: {rate} req/s, by convention. The capture did not count the requests its entry handled, so the entry is taken to be as busy as its busiest call. The calls it makes downstream come out as measured; its own load rests on that convention.':
    'Demanda: {rate} req/s, por convenção. A captura não contou as requisições que a entrada atendeu, então a entrada é considerada tão ocupada quanto a chamada mais movimentada dela. As chamadas que ela faz adiante saem como medidas; a carga dela própria depende dessa convenção.',
  '{n} service was seen in no call: it is in the platform, connected to nothing.':
    '{n} serviço não foi visto em nenhuma chamada: está na plataforma, ligado a nada.',
  '{n} services were seen in no call: they are in the platform, connected to nothing.':
    '{n} serviços não foram vistos em nenhuma chamada: estão na plataforma, ligados a nada.',
} as const satisfies Record<string, string>;
