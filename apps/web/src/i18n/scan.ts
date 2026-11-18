/**
 * Finds interface text that was written without `t()`.
 *
 * Used by a test, not by the application: it reads the sources with the
 * TypeScript parser and lists what a person would read on screen and no
 * dictionary would ever see. Three things count:
 *
 * - text between JSX tags;
 * - a literal given to a property that is shown or read out (`title`,
 *   `label`, `aria-label`…), in JSX or in a table of options;
 * - a literal that reads as prose, anywhere: three words or more, nearly
 *   all of them plain words. That is how a sentence built in `lib/` is
 *   told from a list of class names.
 *
 * A table whose name says it holds words (`HEALTH_LABEL`, `KIND_HINTS`) is
 * read as one: every literal in it is shown.
 *
 * A literal inside `t()`, `tr()` or a class-name helper is never counted,
 * nor is one compared with `===`. What is left and is not interface text
 * (a message for whoever reads the console, a sample of Cedar) is marked
 * where it is written: a comment holding `not-interface-text` on its line
 * or the line before, or `not-interface-text: whole file` anywhere in a
 * file that holds none.
 */
import ts from 'typescript';

export interface Found {
  line: number;
  rule: 'jsx-text' | 'attribute' | 'property' | 'prose';
  text: string;
}

/** Properties whose value is shown or read out. */
const SHOWN = new Set([
  'title',
  'label',
  'hint',
  'description',
  'placeholder',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'alt',
  'caption',
  'heading',
  'summary',
  'tooltip',
  'emptyLabel',
  'confirmLabel',
  'cancelLabel',
  'short',
  'plural',
]);

/** Properties that never hold words, however their value reads. */
const NEVER_WORDS =
  /^(className|class|style|id|type|role|key|href|src|d|viewBox|name|value|htmlFor|variant|size|tone|width|testId|data-.*|aria-(?!label$|description$|roledescription$|valuetext$).*)$/;
/** Elements that hold literal code, which is the same in every language. */
const CODE_TAGS = new Set(['code', 'kbd', 'pre', 'samp']);

/** Calls whose arguments are a phrase already, or never text. */
const NOT_TEXT_CALLS = new Set([
  't',
  'tr',
  'translate',
  'translateRich',
  'english',
  'cn',
  'clsx',
  'getByTestId',
  'querySelector',
  'querySelectorAll',
  'matchMedia',
  'getContext',
  'addEventListener',
  'removeEventListener',
  'setAttribute',
  'getAttribute',
  'createElement',
  'startsWith',
  'endsWith',
  'includes',
  'split',
  'join',
  'replace',
  'replaceAll',
  'test',
  'match',
  'indexOf',
  'get',
  'set',
  'has',
  'delete',
  'getItem',
  'setItem',
  'removeItem',
  'postMessage',
  'RegExp',
  'URL',
]);

/** Calls whose first argument is a phrase, however it is chosen. */
const PHRASE_CALLS = new Set(['t', 'tr', 'translate', 'translateRich']);

/** Said the same in every language, or not words at all. */
const AS_IT_IS = new Set([
  'AEGIS',
  'Cedar',
  'WebGPU',
  'WebGL 2',
  'WebGL',
  'OK',
  'ms',
  'rps',
  'req/s',
  'px',
  'fps',
  'JSON',
  'YAML',
  'API',
  'URL',
  'ID',
  'p95',
  'CVE',
  'Esc',
  'Ctrl',
  'Enter',
  'Tab',
  'Shift',
  'Alt',
]);

const MARK = 'not-interface-text';
const WHOLE_FILE = 'not-interface-text: whole file';
/** A variable named like this is a table of words. */
const TABLE_OF_WORDS = /(LABELS?|TITLES?|HINTS?|NAMES?|WORDS?|TEXTS?|COPY|CAPTIONS?)$/;

function hasWords(text: string): boolean {
  return /[A-Za-zÀ-ÿ]{2,}/.test(text);
}

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Whether a literal reads as a sentence or a piece of one. */
export function isProse(text: string): boolean {
  const words = tidy(text.replace(/\$\{[^}]*\}|\{\w+\}/g, ' '))
    .split(' ')
    .filter(Boolean);
  if (words.length < 3) return false;
  const plain = words.filter((word) =>
    /^[("'“‘]?[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’]*[)"'”’]?[.,;:!?…]?$/.test(word),
  );
  return plain.length / words.length >= 0.8;
}

function calleeName(node: ts.CallExpression | ts.NewExpression): string | null {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => `\${}${span.literal.text}`).join('');
  }
  return null;
}

/** Everything in one source file that looks like interface text and is not a phrase. */
export function scan(fileName: string, source: string): Found[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines = source.split('\n');
  const found: Found[] = [];
  if (source.includes(WHOLE_FILE)) return found;

  const marked = (node: ts.Node): boolean => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line;
    return [lines[line], lines[line - 1]].some((text) => text?.includes(MARK));
  };
  const report = (node: ts.Node, rule: Found['rule'], text: string) => {
    const clean = tidy(text);
    if (!hasWords(clean) || AS_IT_IS.has(clean) || marked(node)) return;
    found.push({
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      rule,
      text: clean,
    });
  };

  /** Whether a node stands inside an element that holds literal code. */
  const inCode = (node: ts.Node): boolean => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!ts.isJsxElement(parent)) continue;
      const opening = parent.openingElement;
      if (CODE_TAGS.has(opening.tagName.getText(file))) return true;
      const classes = opening.attributes.properties.find(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'className',
      );
      return classes !== undefined && /["'`\s]code["'`\s]/.test(classes.getText(file));
    }
    return false;
  };

  /**
   * `shown`: a literal here is put on screen as it is (a JSX child, the
   * value of a shown property). Elsewhere a literal counts only as prose,
   * and under `never` (a class name, an id) not at all.
   */
  const visit = (node: ts.Node, shown: Found['rule'] | 'never' | null): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isTypeNode(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      return;
    }
    if (ts.isJsxText(node)) {
      if (!inCode(node)) report(node, 'jsx-text', node.text);
      return;
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(file);
      if (node.initializer) {
        visit(
          node.initializer,
          SHOWN.has(name) ? 'attribute' : NEVER_WORDS.test(name) ? 'never' : null,
        );
      }
      return;
    }
    if (ts.isJsxExpression(node)) {
      // A child of an element is shown; an attribute's value keeps what
      // the attribute said.
      const child = ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent);
      if (node.expression) {
        visit(node.expression, child ? (inCode(node) ? 'never' : 'jsx-text') : shown);
      }
      return;
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isJsxSelfClosingElement(node)) {
      ts.forEachChild(node, (child) => visit(child, null));
      return;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = calleeName(node);
      visit(node.expression, null);
      const quiet = name !== null && NOT_TEXT_CALLS.has(name);
      const phrase = name !== null && PHRASE_CALLS.has(name);
      (node.arguments ?? []).forEach((argument, index) => {
        // `t(n === 1 ? 'a' : 'b', values)`: what is chosen is a phrase. The
        // values may still hold words of their own; anything else such a
        // call is given never does.
        if (quiet && (!phrase || index === 0)) visit(argument, 'never');
        else visit(argument, shown === 'never' ? 'never' : quiet ? null : shown);
      });
      return;
    }
    if (ts.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind;
      const comparing =
        kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        kind === ts.SyntaxKind.EqualsEqualsToken ||
        kind === ts.SyntaxKind.ExclamationEqualsToken ||
        kind === ts.SyntaxKind.InKeyword;
      if (comparing) {
        const side = shown === 'never' ? 'never' : null;
        if (literalText(node.left) === null) visit(node.left, side);
        if (literalText(node.right) === null) visit(node.right, side);
        return;
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const name =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : '';
      // In a table of words every value is shown; elsewhere only the
      // properties that are.
      visit(
        node.initializer,
        shown === 'never' ? 'never' : SHOWN.has(name) || shown === 'property' ? 'property' : null,
      );
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const table = ts.isIdentifier(node.name) && TABLE_OF_WORDS.test(node.name.text);
      visit(node.initializer, table ? 'property' : null);
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      visit(node.expression, null);
      if (literalText(node.argumentExpression) === null) visit(node.argumentExpression, null);
      return;
    }
    if (ts.isCaseClause(node)) {
      node.statements.forEach((statement) => visit(statement, shown));
      return;
    }
    const text = literalText(node);
    if (text !== null) {
      if (shown === 'never') return;
      if (shown) report(node, shown, text);
      else if (isProse(text)) report(node, 'prose', text);
      if (ts.isTemplateExpression(node)) {
        node.templateSpans.forEach((span) => visit(span.expression, null));
      }
      return;
    }
    // A shown value may be chosen (`a ? 'x' : 'y'`, `a ?? 'x'`); anything
    // else it is computed from is not itself on screen.
    const passes =
      ts.isConditionalExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isBinaryExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isObjectLiteralExpression(node) ||
      ts.isArrayLiteralExpression(node);
    ts.forEachChild(node, (child) => visit(child, passes || shown === 'never' ? shown : null));
  };

  visit(file, null);
  return found;
}
