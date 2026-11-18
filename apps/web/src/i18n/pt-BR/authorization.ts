export default {
  // The request tracer: its header and the form.
  'Close and put the path away': 'Fechar e recolher o caminho',
  'Choose who asks for what, and follow the request across the model to where Cedar allows it or stops it. The decision is computed by the Cedar policy engine (cedar-policy {version}) over the principals and resources in its entity store; nothing is scripted.':
    'Escolha quem pede o quê e acompanhe a requisição pelo modelo até onde o Cedar a deixa passar ou a barra. A decisão é calculada pelo motor de políticas Cedar (cedar-policy {version}) sobre os principais e os recursos do seu repositório de entidades; nada é roteirizado.',
  'Choose who asks for what, and follow the request across the model to where Cedar allows it or stops it. The decision is computed by the Cedar policy engine over the principals and resources in its entity store; nothing is scripted.':
    'Escolha quem pede o quê e acompanhe a requisição pelo modelo até onde o Cedar a deixa passar ou a barra. A decisão é calculada pelo motor de políticas Cedar sobre os principais e os recursos do seu repositório de entidades; nada é roteirizado.',
  'Authorization unavailable': 'Autorização indisponível',
  'Loading policies': 'Carregando as políticas',
  Principal: 'Principal',
  Action: 'Ação',
  Resource: 'Recurso',
  '{resource}, tenant {tenant}': '{resource}, locatário {tenant}',
  '{principal} belongs to tenant <v>{tenant}</v> and has no role; the resource belongs to <v>{owner}</v>.':
    '{principal} pertence ao locatário <v>{tenant}</v> e não tem função; o recurso pertence a <v>{owner}</v>.',
  '{principal} belongs to tenant <v>{tenant}</v> with role <v>{roles}</v>; the resource belongs to <v>{owner}</v>.':
    '{principal} pertence ao locatário <v>{tenant}</v> com a função <v>{roles}</v>; o recurso pertence a <v>{owner}</v>.',
  '{principal} belongs to tenant <v>{tenant}</v> with roles <v>{roles}</v>; the resource belongs to <v>{owner}</v>.':
    '{principal} pertence ao locatário <v>{tenant}</v> com as funções <v>{roles}</v>; o recurso pertence a <v>{owner}</v>.',
  Context: 'Contexto',
  Absent: 'Ausente',
  True: 'Verdadeiro',
  False: 'Falso',
  Engine: 'Motor',
  'Policy engine': 'Motor de políticas',
  Embedded: 'Embutido',
  'Embedded Cedar': 'Cedar embutido',
  'Evaluating…': 'Avaliando…',
  'Evaluate again': 'Avaliar de novo',
  'Evaluate with Cedar': 'Avaliar com o Cedar',

  // The decision card.
  Decision: 'Decisão',
  'Configuration changed. Evaluate again.': 'A configuração mudou. Avalie de novo.',
  'The result below answers the earlier configuration, not the one in the form.':
    'O resultado abaixo responde à configuração anterior, não à do formulário.',
  '<was>Was </was>{decision}': '<was>Era </was>{decision}',
  'Tracing…': 'Rastreando…',
  'Trace again': 'Rastrear de novo',
  'Show the path': 'Mostrar o caminho',
  'Determining policies': 'Políticas determinantes',
  'None. No policy permits this request, so Cedar denies it by default.':
    'Nenhuma. Nenhuma política permite esta requisição, então o Cedar a nega por padrão.',
  'Evaluation diagnostics': 'Diagnósticos da avaliação',
  'Evaluated with': 'Avaliado com',
  "the agent's own policy store": 'o próprio repositório de políticas do agente',
  '<n>{on} of {total}</n> active': '<n>{on} de {total}</n> ativas',
  '<n>{on} of {total}</n> active; off: {ids}': '<n>{on} de {total}</n> ativas; desligadas: {ids}',
  'Keep this result, change the context or the policies, and evaluate again to see the two side by side':
    'Guarde este resultado, mude o contexto ou as políticas e avalie de novo para ver os dois lado a lado',
  'Keep to compare': 'Guardar para comparar',
  'Path through the platform': 'Caminho pela plataforma',
  'None to draw. This platform does not name its gateway, authentication service and authorizer.':
    'Nenhum a desenhar. Esta plataforma não nomeia o seu gateway, o seu serviço de autenticação e o seu autorizador.',
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
    'Nenhuma política de permissão sequer diz respeito a esta requisição.',
  'Closest: {ids} is about this request, but its condition does not hold.':
    'Mais próxima: {ids} diz respeito a esta requisição, mas a condição dela não se cumpre.',
  'Closest: {ids} are about this request, but their conditions do not hold.':
    'Mais próximas: {ids} dizem respeito a esta requisição, mas as condições delas não se cumprem.',
  'Hold for this request': 'Valem para esta requisição',
  'About it, with a condition that does not hold':
    'Dizem respeito a ela, com uma condição que não se cumpre',
  '{n} not about this request#one': '{n} não diz respeito a esta requisição',
  '{n} not about this request': '{n} não dizem respeito a esta requisição',
  'Show the policy': 'Mostrar a política',
  'Holds: it forbids the request.': 'Vale: ela proíbe a requisição.',
  'Holds: it permits the request.': 'Vale: ela permite a requisição.',
  'Holds, and would permit the request, but a forbid overrides it.':
    'Vale e permitiria a requisição, mas uma política de proibição prevalece sobre ela.',
  'About this request, but its condition does not hold: it does not forbid.':
    'Diz respeito a esta requisição, mas a condição dela não se cumpre: ela não proíbe.',
  'About this request, but its condition does not hold: it does not permit.':
    'Diz respeito a esta requisição, mas a condição dela não se cumpre: ela não permite.',
  'Not about this request: who asks, what for, or on which thing is outside its scope.':
    'Não diz respeito a esta requisição: quem pede, para quê ou sobre o quê está fora do seu escopo.',
  'Each policy in force, put to this request by itself by the embedded Cedar engine.':
    'Cada política em vigor, aplicada sozinha a esta requisição pelo motor Cedar embutido.',
  'The policies could not be taken one by one.': 'Não foi possível tomar as políticas uma a uma.',
  'The policies in force are no longer the ones this was decided under: evaluate again to see how each stands.':
    'As políticas em vigor não são mais aquelas sob as quais isto foi decidido: avalie de novo para ver como cada uma fica.',

  // What changed since a result, and two results side by side.
  absent: 'ausente',
  true: 'verdadeiro',
  false: 'falso',
  embedded: 'embutido',
  'Principal was {from}, now {to}': 'Principal era {from}, agora {to}',
  'Action was {from}, now {to}': 'Ação era {from}, agora {to}',
  'Resource was {from}, now {to}': 'Recurso era {from}, agora {to}',
  '{name} was {from}, now {to}': '{name} era {from}, agora {to}',
  'Policy {id} switched off': 'Política {id} desligada',
  'Policy {id} switched on': 'Política {id} ligada',
  'Engine was {from}, now {to}': 'Motor era {from}, agora {to}',
  'The policies in use were replaced': 'As políticas em uso foram substituídas',
  'The policies in use were replaced in between':
    'As políticas em uso foram substituídas entre uma avaliação e outra',
  Comparison: 'Comparação',
  'A is kept. Change the context or switch a policy, then evaluate: the new result appears here as B.':
    'A fica guardado. Mude o contexto ou ligue ou desligue uma política e depois avalie: o novo resultado aparece aqui como B.',
  'A and B are different requests, so the two decisions answer different questions.':
    'A e B são requisições diferentes, então as duas decisões respondem a perguntas diferentes.',
  'The decision changed from {a} to {b}.': 'A decisão mudou de {a} para {b}.',
  'The decision is the same on both sides.': 'A decisão é a mesma dos dois lados.',
  'Decided by': 'Decidido por',
  'none: denied by default': 'nenhuma: negado por padrão',
  'not evaluated yet': 'ainda não avaliado',
  'Policies off': 'Políticas desligadas',
  'none#policies': 'nenhuma',
  'What differs from A to B': 'O que muda de A para B',
  'Nothing: the same request under the same context and policies.':
    'Nada: a mesma requisição, com o mesmo contexto e as mesmas políticas.',
  'Only A is decided by {ids}.': 'Só A é decidido por {ids}.',
  'Only B is decided by {ids}.': 'Só B é decidido por {ids}.',

  // The list of policies under the form.
  '{on}/{total} active': '{on}/{total} ativas',
  'Edit the policies': 'Editar as políticas',
  'These are the real Cedar policies being evaluated. Switch one off to see how the decision changes.':
    'Estas são as políticas Cedar reais em avaliação. Desligue uma para ver como a decisão muda.',
  'These are the real Cedar policies being evaluated. Switch one off to see how the decision changes (embedded engine only; the agent uses its own policy store).':
    'Estas são as políticas Cedar reais em avaliação. Desligue uma para ver como a decisão muda (só no motor embutido; o agente usa o próprio repositório de políticas).',
  Permit: 'Permite',
  Forbid: 'Proíbe',
  'Cedar source': 'Código Cedar',
  'Evaluated in this timeline': 'Avaliadas nesta linha do tempo',
  'Trace this decision through the scene': 'Rastrear esta decisão pela cena',

  // Who may do what: the access matrix.
  'Every principal and action of the catalogue, on every resource the action applies to, each asked of Cedar.':
    'Cada principal e ação do catálogo, em cada recurso a que a ação se aplica, cada um perguntado ao Cedar.',
  'The catalogue is unavailable': 'O catálogo está indisponível',
  'Cedar could not be asked.': 'Não foi possível consultar o Cedar.',
  'The matrix could not be worked out': 'Não foi possível montar a matriz',
  'Cedar was not asked. Try again in a moment.':
    'O Cedar não foi consultado. Tente de novo em instantes.',
  'Policies in force: {on} of {total}': 'Políticas em vigor: {on} de {total}',
  'Not asked: {reason}.': 'Nada foi consultado: {reason}.',
  'Cedar allows {allowed} of {asked} requests.':
    'O Cedar permite {allowed} de {asked} requisições.',
  'Cedar allows {allowed} of {asked} requests; none differs from all policies in force.':
    'O Cedar permite {allowed} de {asked} requisições; nenhuma difere do resultado com todas as políticas em vigor.',
  'Cedar allows {allowed} of {asked} requests; {changed} differs from all policies in force.':
    'O Cedar permite {allowed} de {asked} requisições; {changed} difere do resultado com todas as políticas em vigor.',
  'Cedar allows {allowed} of {asked} requests; {changed} differ from all policies in force.':
    'O Cedar permite {allowed} de {asked} requisições; {changed} diferem do resultado com todas as políticas em vigor.',
  'For each principal and action, on how many resources Cedar allows it':
    'Para cada principal e ação, em quantos recursos o Cedar a permite',
  'not asked': 'não consultado',
  'none#resources': 'nenhum',
  yes: 'sim',
  'all {n}': 'todos os {n}',
  '{n} of {total}': '{n} de {total}',
  'was {access}': 'era {access}',
  'decided by {ids}': 'decidido por {ids}',
  'decided by {ids}; differs from all policies in force':
    'decidido por {ids}; difere do resultado com todas as políticas em vigor',
  'no policy permits it': 'nenhuma política a permite',
  'no policy permits it; differs from all policies in force':
    'nenhuma política a permite; difere do resultado com todas as políticas em vigor',
  'Trace it': 'Rastrear',
  'Select a cell to see each request it stands for, the policy that decided it, and to follow it across the model.':
    'Selecione uma célula para ver cada requisição que ela representa e a política que a decidiu, e para acompanhá-la pelo modelo.',
  "Each answer is the embedded Cedar engine's, to a request made of the catalogue's principals, actions and resources. Asking leaves the timeline as it is.":
    'Cada resposta é do motor Cedar embutido, a uma requisição feita com os principais, as ações e os recursos do catálogo. Consultar deixa a linha do tempo como está.',

  // The policy editor.
  'Change what Cedar decides by, see which answers would change, then apply.':
    'Mude o que o Cedar usa para decidir, veja quais respostas mudariam e depois aplique.',
  'The policies are unavailable': 'As políticas estão indisponíveis',
  'The files in use could not be read.': 'Não foi possível ler os arquivos em uso.',
  "The policies in force, in Cedar's own syntax":
    'As políticas em vigor, na sintaxe do próprio Cedar',
  'A policy goes by its {id}. Nothing is applied until you say so, and applying replaces the policies only: the platform, its scenarios and its entities stay as they are. The timeline starts again, as it does for any change of files.':
    'Uma política é identificada pelo seu {id}. Nada é aplicado até você pedir, e aplicar substitui só as políticas: a plataforma, os seus cenários e as suas entidades ficam como estão. A linha do tempo recomeça, como em qualquer mudança de arquivos.',
  'These are the policies in use.': 'Estas são as políticas em uso.',
  'The policies could not be checked.': 'Não foi possível verificar as políticas.',
  'Cedar accepts them: {n} policy.': 'O Cedar as aceita: {n} política.',
  'Cedar accepts them: {n} policies.': 'O Cedar as aceita: {n} políticas.',
  'Not valid.': 'Inválidas.',
  'Not applied: {reason}': 'Não aplicadas: {reason}',
  'Applying…': 'Aplicando…',
  'Apply these policies': 'Aplicar estas políticas',
  'Put back the ones in use': 'Restaurar as que estão em uso',
} as const satisfies Record<string, string>;
