/**
 * A phrase with something inside it that is not text: a figure set in the
 * numeric face, a name that is a component, a word in bold. Word order
 * changes from one language to the next, so the sentence stays whole and
 * says where the parts go:
 *
 *   tr('Lowest at <n>{figure}</n>.', { n: (c) => <b>{c}</b>, figure })
 *
 * `{name}` is replaced by a value, which may be an element. `<name>…</name>`
 * is handed to a function that wraps what it holds.
 */
import { Fragment, type ReactNode } from 'react';

import { english, language, type Language, type Phrase } from './index';
import { PT_BR } from './pt-BR';

export type Parts = Record<string, ReactNode | ((children: ReactNode) => ReactNode)>;

const TOKEN = /<(\w+)>(.*?)<\/\1>|\{(\w+)\}/g;

function build(text: string, parts: Parts, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index;
    if (at > last) nodes.push(text.slice(last, at));
    const key = `${prefix}${index++}`;
    const [whole, tag, inner, name] = match;
    if (tag !== undefined) {
      const wrap = parts[tag];
      const children = build(inner ?? '', parts, `${key}.`);
      nodes.push(
        <Fragment key={key}>{typeof wrap === 'function' ? wrap(children) : children}</Fragment>,
      );
    } else if (name !== undefined && name in parts) {
      const value = parts[name];
      nodes.push(
        <Fragment key={key}>{typeof value === 'function' ? value(null) : value}</Fragment>,
      );
    } else {
      nodes.push(whole);
    }
    last = at + whole.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** A phrase with parts, in a given language. */
export function translateRich(to: Language, phrase: Phrase, parts: Parts): ReactNode {
  return build(to === 'pt-BR' ? PT_BR[phrase] : english(phrase), parts, '');
}

/** A phrase with parts, in the language of this page. */
export function tr(phrase: Phrase, parts: Parts): ReactNode {
  return translateRich(language, phrase, parts);
}
