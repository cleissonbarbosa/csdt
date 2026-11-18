import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { english, fill, resolveLanguage, translate, type Phrase } from './index';
import { PARTS, PT_BR } from './pt-BR';

const SRC = join(import.meta.dirname, '..');

/** `{name}` and `<name>`, in order, so that a phrase and its translation can be compared. */
function slots(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}|<\/?(\w+)>/g)].map((m) => m[0]).sort();
}

/** Every phrase the sources hand to `t()` or `tr()`, however it is chosen. */
function phrasesInSources(): Set<string> {
  const found = new Set<string>();
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'i18n' ? [] : files(path);
      return /\.tsx?$/.test(entry.name) && !/\.(test|spec|d)\.tsx?$/.test(entry.name) ? [path] : [];
    });
  const literals = (node: ts.Node): string[] => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isConditionalExpression(node))
      return [...literals(node.whenTrue), ...literals(node.whenFalse)];
    if (ts.isParenthesizedExpression(node)) return literals(node.expression);
    return [];
  };
  for (const path of files(SRC)) {
    const file = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 't' || node.expression.text === 'tr') &&
        node.arguments[0]
      ) {
        for (const phrase of literals(node.arguments[0])) found.add(phrase);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return found;
}

describe('the dictionaries', () => {
  it('keep every placeholder and tag of the phrase they translate', () => {
    const wrong = Object.entries(PT_BR)
      .filter(([phrase, text]) => slots(english(phrase)).join() !== slots(text).join())
      .map(([phrase, text]) => `${phrase} → ${text}`);
    expect(wrong).toEqual([]);
  });

  it('say the same thing wherever a phrase is written twice', () => {
    const seen = new Map<string, { part: string; text: string }>();
    const differ: string[] = [];
    for (const [part, entries] of Object.entries(PARTS)) {
      for (const [phrase, text] of Object.entries(entries as Record<string, string>)) {
        const before = seen.get(phrase);
        if (before && before.text !== text) {
          differ.push(`${phrase}: ${before.part} "${before.text}", ${part} "${text}"`);
        }
        seen.set(phrase, { part, text });
      }
    }
    expect(differ).toEqual([]);
  });

  it('hold nothing the interface no longer says', () => {
    const used = phrasesInSources();
    expect(Object.keys(PT_BR).filter((phrase) => !used.has(phrase))).toEqual([]);
  });

  it('leave nothing empty or untouched by accident', () => {
    const blank = Object.entries(PT_BR).filter(([, text]) => text.trim() === '');
    expect(blank).toEqual([]);
  });
});

describe('a phrase', () => {
  it('is its own English, without the note that tells two meanings apart', () => {
    expect(translate('en', 'Open#verb' as Phrase)).toBe('Open');
    expect(translate('pt-BR', 'Open#verb' as Phrase)).toBe('Abrir');
    expect(english('Follow the#incident')).toBe('Follow the');
  });

  it('takes its values where it names them, and leaves a name it was not given', () => {
    expect(fill('{n} of {total}', { n: 3, total: 9 })).toBe('3 of 9');
    expect(fill('{n} of {total}', { n: 3 })).toBe('3 of {total}');
    expect(translate('pt-BR', '{total} services, all normal', { total: 51 })).toBe(
      '51 serviços, todos normais',
    );
  });
});

describe('the language', () => {
  it('is the setting, or with none the browser’s first language', () => {
    expect(resolveLanguage('en', 'pt-BR')).toBe('en');
    expect(resolveLanguage('pt-BR', 'en-US')).toBe('pt-BR');
    expect(resolveLanguage('auto', 'pt-BR')).toBe('pt-BR');
    expect(resolveLanguage('auto', 'pt-PT')).toBe('pt-BR');
    expect(resolveLanguage('auto', 'en-GB')).toBe('en');
    expect(resolveLanguage('auto', 'de')).toBe('en');
    expect(resolveLanguage('auto', undefined)).toBe('en');
  });
});
