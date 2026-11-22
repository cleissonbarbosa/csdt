export default {
  // The request tracer: its header and the form.
  'Close and put the path away': 'Fechar e ocultar o caminho',
  'Choose who asks for what, and follow the request across the model to where Cedar allows it or stops it. The decision is computed by the Cedar policy engine (cedar-policy {version}) over the principals and resources in its entity store; nothing is scripted.':
    'Escolha quem faz a requisição e o que solicita. Siga o caminho no modelo até o ponto em que o Cedar permite ou bloqueia a requisição. O motor de políticas do Cedar (cedar-policy {version}) toma a decisão na hora com base nos principais e recursos do repositório de entidades.',
  'Choose who asks for what, and follow the request across the model to where Cedar allows it or stops it. The decision is computed by the Cedar policy engine over the principals and resources in its entity store; nothing is scripted.':
    'Escolha quem faz a requisição e o que solicita. Siga o caminho no modelo até o ponto em que o Cedar permite ou bloqueia a requisição. O motor de políticas do Cedar toma a decisão na hora com base nos principais e recursos do repositório de entidades.',
  'Authorization unavailable': 'Autorização indisponível',
  'Loading policies': 'Carregando as políticas',
  Principal: 'Principal',
  Action: 'Ação',
  Resource: 'Recurso',
  '{resource}, tenant {tenant}': '{resource}, locatário {tenant}',
  '{principal} belongs to tenant <v>{tenant}</v> and has no role; the resource belongs to <v>{owner}</v>.':
    '{principal} pertence ao locatário <v>{tenant}</v> e não tem função atribuída. O recurso pertence a <v>{owner}</v>.',
  '{principal} belongs to tenant <v>{tenant}</v> with role <v>{roles}</v>; the resource belongs to <v>{owner}</v>.':
    '{principal} tem a função <v>{roles}</v> no locatário <v>{tenant}</v>. O recurso pertence a <v>{owner}</v>.',
  '{principal} belongs to tenant <v>{tenant}</v> with roles <v>{roles}</v>; the resource belongs to <v>{owner}</v>.':
    '{principal} tem as funções <v>{roles}</v> no locatário <v>{tenant}</v>. O recurso pertence a <v>{owner}</v>.',
  Context: 'Contexto',
  Absent: 'Ausente',
  True: 'Verdadeiro',
  False: 'Falso',
  Engine: 'Motor',
  'Policy engine': 'Motor de políticas',
  Embedded: 'Embutido',
  'Embedded Cedar': 'Cedar embutido',
  'Evaluating…': 'Avaliando…',
  'Evaluate again': 'Avaliar novamente',
  'Evaluate with Cedar': 'Avaliar com o Cedar',

  // The decision card.
  Decision: 'Decisão',
  'Configuration changed. Evaluate again.': 'A configuração mudou. Avalie novamente.',
  'The result below answers the earlier configuration, not the one in the form.':
    'O resultado abaixo corresponde à configuração anterior.',
  '<was>Was </was>{decision}': '<was>Decisão anterior: </was>{decision}',
  'Tracing…': 'Rastreando…',
  'Trace again': 'Rastrear novamente',
  'Show the path': 'Mostrar o caminho',
  'Determining policies': 'Políticas determinantes',
  'None. No policy permits this request, so Cedar denies it by default.':
    'O Cedar nega a requisição por padrão porque nenhuma política a permite.',
  'Evaluation diagnostics': 'Diagnósticos da avaliação',
  'Evaluated with': 'Avaliado com',
  "the agent's own policy store": 'o próprio repositório de políticas do agente',
  '<n>{on} of {total}</n> active': '<n>{on} de {total}</n> ativas',
  '<n>{on} of {total}</n> active; off: {ids}': '<n>{on} de {total}</n> ativas. Desativadas: {ids}',
  'Keep this result, change the context or the policies, and evaluate again to see the two side by side':
    'Guarde este resultado, altere o contexto ou as políticas e faça uma nova avaliação para comparar os resultados lado a lado',
  'Keep to compare': 'Guardar para comparar',
  'Path through the platform': 'Caminho pela plataforma',
  'None to draw. This platform does not name its gateway, authentication service and authorizer.':
    'Não há caminho para exibir. A configuração da plataforma não identifica o gateway, o serviço de autenticação e o autorizador.',
  Edge: 'Borda',
  ', blocked here': ', requisição bloqueada aqui',
  ', reached': ', alcançado',
  ', not reached': ', não alcançado',
  '{engine} (version not reported)': '{engine} (versão não informada)',
  'Evaluation time': 'Tempo de avaliação',
  'Virtual time': 'Tempo virtual',
  'at {time}': 'em {time}',

  // Policy by policy.
  'Policy by policy': 'Política por política',
  'No permit is about this request at all.':
    'Esta requisição está fora do escopo de todas as políticas de permissão.',
  'Closest: {ids} is about this request, but its condition does not hold.':
    'A política {ids} é a que mais se aproxima. A requisição está no escopo da política, mas não satisfaz sua condição.',
  'Closest: {ids} are about this request, but their conditions do not hold.':
    'As políticas {ids} são as que mais se aproximam. A requisição está no escopo delas, mas não satisfaz suas condições.',
  'Hold for this request': 'Aplicáveis a esta requisição',
  'About it, with a condition that does not hold':
    'No escopo da requisição, com condição não satisfeita',
  '{n} not about this request#one': '{n} política fora do escopo da requisição',
  '{n} not about this request': '{n} políticas fora do escopo da requisição',
  'Show the policy': 'Mostrar a política',
  'Holds: it forbids the request.': 'A política se aplica e proíbe a requisição.',
  'Holds: it permits the request.': 'A política se aplica e permite a requisição.',
  'Holds, and would permit the request, but a forbid overrides it.':
    'A política se aplica e permitiria a requisição, mas uma política de proibição tem prioridade.',
  'About this request, but its condition does not hold: it does not forbid.':
    'A requisição está no escopo da política. A proibição não se aplica porque a condição não foi satisfeita.',
  'About this request, but its condition does not hold: it does not permit.':
    'A requisição está no escopo da política. A permissão não se aplica porque a condição não foi satisfeita.',
  'Not about this request: who asks, what for, or on which thing is outside its scope.':
    'O principal, a ação ou o recurso da requisição está fora do escopo da política.',
  'Each policy in force, put to this request by itself by the embedded Cedar engine.':
    'O motor Cedar embutido avalia cada política em vigor separadamente para esta requisição.',
  'The policies could not be taken one by one.':
    'Não foi possível avaliar as políticas individualmente.',
  'The policies in force are no longer the ones this was decided under: evaluate again to see how each stands.':
    'As políticas em vigor mudaram desde a última decisão. Avalie a requisição novamente para ver como cada política se aplica.',

  // What changed since a result, and two results side by side.
  absent: 'ausente',
  true: 'verdadeiro',
  false: 'falso',
  embedded: 'embutido',
  'Principal was {from}, now {to}': 'Principal era {from}, agora {to}',
  'Action was {from}, now {to}': 'Ação era {from}, agora {to}',
  'Resource was {from}, now {to}': 'Recurso era {from}, agora {to}',
  '{name} was {from}, now {to}': '{name} era {from}, agora {to}',
  'Policy {id} switched off': 'Política {id} desativada',
  'Policy {id} switched on': 'Política {id} ativada',
  'Engine was {from}, now {to}': 'Motor era {from}, agora {to}',
  'The policies in use were replaced': 'As políticas em uso foram substituídas',
  'The policies in use were replaced in between':
    'As políticas em uso foram substituídas entre uma avaliação e outra',
  Comparison: 'Comparação',
  'A is kept. Change the context or switch a policy, then evaluate: the new result appears here as B.':
    'O resultado A está pronto para a comparação. Mude o contexto ou altere o estado de uma política. Ao avaliar novamente, o resultado aparecerá aqui como B.',
  'A and B are different requests, so the two decisions answer different questions.':
    'A e B são requisições diferentes, então as duas decisões respondem a perguntas diferentes.',
  'The decision changed from {a} to {b}.': 'A decisão mudou de {a} para {b}.',
  'The decision is the same on both sides.': 'A decisão é a mesma dos dois lados.',
  'Decided by': 'Decidido por',
  'none: denied by default': 'nenhuma: negado por padrão',
  'not evaluated yet': 'ainda não avaliado',
  'Policies off': 'Políticas desativadas',
  'none#policies': 'nenhuma',
  'What differs from A to B': 'O que muda de A para B',
  'Nothing: the same request under the same context and policies.':
    'Nada: a mesma requisição, com o mesmo contexto e as mesmas políticas.',
  'Only A is decided by {ids}.': 'Somente em A, a decisão é determinada por {ids}.',
  'Only B is decided by {ids}.': 'Somente em B, a decisão é determinada por {ids}.',

  // The list of policies under the form.
  '{on}/{total} active': '{on}/{total} ativas',
  'Edit the policies': 'Editar as políticas',
  'These are the real Cedar policies being evaluated. Switch one off to see how the decision changes.':
    'O Cedar avalia estas políticas. Desative uma delas para ver se a decisão muda.',
  'These are the real Cedar policies being evaluated. Switch one off to see how the decision changes (embedded engine only; the agent uses its own policy store).':
    'O motor embutido do Cedar avalia estas políticas. Desative uma delas para ver se a decisão muda. O agente usa seu próprio repositório de políticas.',
  Permit: 'Permite',
  Forbid: 'Proíbe',
  'Cedar source': 'Código Cedar',
  'Evaluated in this timeline': 'Avaliadas nesta linha do tempo',
  'Trace this decision through the scene': 'Rastrear esta decisão pela cena',

  // Who may do what: the access matrix.
  'Every principal and action of the catalogue, on every resource the action applies to, each asked of Cedar.':
    'O Cedar avalia cada combinação de principal, ação e recurso do catálogo em que a ação se aplica ao recurso.',
  'The catalogue is unavailable': 'O catálogo está indisponível',
  'Cedar could not be asked.': 'Não foi possível consultar o Cedar.',
  'The matrix could not be worked out': 'Não foi possível montar a matriz',
  'Cedar was not asked. Try again in a moment.':
    'O Cedar não foi consultado. Tente novamente em instantes.',
  'Policies in force: {on} of {total}': 'Políticas em vigor: {on} de {total}',
  'Not asked: {reason}.': 'Consulta não realizada: {reason}.',
  'Cedar allows {allowed} of {asked} requests.':
    'O Cedar permite {allowed} de {asked} requisições.',
  'Cedar allows {allowed} of {asked} requests; none differs from all policies in force.':
    'O Cedar permite {allowed} de {asked} requisições. Com todas as políticas ativas, as decisões seriam as mesmas.',
  'Cedar allows {allowed} of {asked} requests; {changed} differs from all policies in force.':
    'O Cedar permite {allowed} de {asked} requisições. Com todas as políticas ativas, {changed} decisão seria diferente.',
  'Cedar allows {allowed} of {asked} requests; {changed} differ from all policies in force.':
    'O Cedar permite {allowed} de {asked} requisições. Com todas as políticas ativas, {changed} decisões seriam diferentes.',
  'For each principal and action, on how many resources Cedar allows it':
    'Número de recursos em que o Cedar permite cada ação para cada principal',
  'not asked': 'não consultado',
  'none#resources': 'nenhum',
  yes: 'sim',
  'all {n}': 'todos os {n}',
  '{n} of {total}': '{n} de {total}',
  'was {access}': 'Antes: {access}',
  'decided by {ids}': 'decidido por {ids}',
  'decided by {ids}; differs from all policies in force':
    'decidido por {ids}. A decisão muda com todas as políticas ativas',
  'no policy permits it': 'nenhuma política a permite',
  'no policy permits it; differs from all policies in force':
    'nenhuma política permite a requisição. A decisão muda com todas as políticas ativas',
  'Trace it': 'Rastrear',
  'Select a cell to see each request it stands for, the policy that decided it, and to follow it across the model.':
    'Selecione uma célula para ver as requisições e as políticas que determinaram cada decisão. Você pode seguir o caminho de cada requisição no modelo.',
  "Each answer is the embedded Cedar engine's, to a request made of the catalogue's principals, actions and resources. Asking leaves the timeline as it is.":
    'O motor Cedar embutido avalia as requisições com os principais, as ações e os recursos do catálogo. As consultas não alteram a linha do tempo.',

  // The policy editor.
  'Change what Cedar decides by, see which answers would change, then apply.':
    'Edite as políticas do Cedar, veja quais decisões mudariam e aplique as alterações.',
  'The policies are unavailable': 'As políticas estão indisponíveis',
  'The files in use could not be read.': 'Não foi possível ler os arquivos em uso.',
  "The policies in force, in Cedar's own syntax":
    'As políticas em vigor, na sintaxe do próprio Cedar',
  'A policy goes by its {id}. Nothing is applied until you say so, and applying replaces the policies and the shares of ordinary traffic only: the platform, its scenarios and its entities stay as they are. The timeline starts again, as it does for any change of files.':
    'Cada política é identificada pelo {id}. Nada é aplicado até você pedir, e aplicar substitui apenas as políticas e as proporções do tráfego comum. A plataforma, os cenários e as entidades permanecem iguais. Como em qualquer mudança de arquivos, a linha do tempo recomeça.',
  'These are the policies in use.': 'Estas são as políticas em uso.',
  'The policies could not be checked.': 'Não foi possível verificar as políticas.',
  'Cedar accepts them: {n} policy.': 'O Cedar validou {n} política.',
  'Cedar accepts them: {n} policies.': 'O Cedar validou {n} políticas.',
  'Not valid.': 'Inválidas.',
  'Not applied: {reason}': 'Não aplicadas: {reason}',
  'Applying…': 'Aplicando…',
  'Apply these policies': 'Aplicar estas políticas',
  'Put back the ones in use': 'Restaurar as que estão em uso',

  // A policy written as a sentence.
  'Write one as a sentence': 'Escrever uma como frase',
  '{effect} {who} to {what} on {on}': '{effect} a {who} {what} em {on}',
  'Permit or forbid': 'Permite ou proíbe',
  Who: 'Quem',
  anyone: 'qualquer um',
  'A group, as the entity store has it': 'Um grupo, como o repositório de entidades o tem',
  'members of {group}': 'membros de {group}',
  'One principal': 'Um principal',
  'To do what': 'Para fazer o quê',
  'do anything': 'fazer qualquer coisa',
  'On what': 'Em quê',
  anything: 'qualquer coisa',
  'Every resource of a type': 'Todo recurso de um tipo',
  'any {type}': 'qualquer {type}',
  'One resource': 'Um recurso',
  Conditions: 'Condições',
  'the resource is of the principal’s own tenant': 'o recurso é do próprio locatário do principal',
  'What the conditions do': 'O que as condições fazem',
  'Only when these hold': 'Só quando valem',
  'Except when these hold': 'Exceto quando valem',
  'Its id': 'O id dela',
  'Another policy goes by this id.': 'Outra política já usa este id.',
  'What it is for, in a sentence': 'Para que serve, em uma frase',
  'Add it to the policies': 'Adicionar às políticas',
  'Cedar checks it with the rest before anything is applied.':
    'O Cedar a verifica com as demais antes de qualquer coisa ser aplicada.',

  // The ordinary traffic.
  'What ordinary traffic asks': 'O que o tráfego comum pede',
  'The request shapes the catalogue sends at rest, each as wide as its share. Carry a boundary to move share from one to the next. The share Cedar denies is the denial rate at rest.':
    'Os formatos de requisição que o catálogo envia em repouso, cada um com a largura da sua proporção. Leve um limite para passar proporção de um para o seguinte. A proporção que o Cedar nega é a taxa de negação em repouso.',
  '{who}: {asks}, {share} of requests': '{who}: {asks}, {share} das requisições',
  'Between {a} and {b}': 'Entre {a} e {b}',
  'At rest Cedar would deny {then} of ordinary requests; it denies {now} now.':
    'Em repouso o Cedar negaria {then} das requisições comuns; hoje nega {now}.',
} as const satisfies Record<string, string>;
