import type { PolicyInfo, WorkspaceFile } from '@aegis/contracts';

/** Where the policies written in the page are put among a workspace's files. */
export const POLICY_FILE = 'cedar/policies.cedar';

/** Whether a file of a workspace holds policies, in either form they come in. */
export function isPolicyFile(path: string): boolean {
  return path === 'cedar/policies.json' || /^cedar\/[^/]+\.cedar$/.test(path);
}

/** A string as Cedar writes one: the two characters that end or escape it are escaped. */
function quoted(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The policies in force as one file in Cedar's own syntax, each under the
 * id and the description it goes by. A policy that already carries its
 * `@id` (it was read from a `.cedar` file) is written as it is.
 */
export function policiesAsCedar(policies: readonly PolicyInfo[]): string {
  return policies
    .map((policy) => {
      const body = policy.content.trim();
      if (/^\s*@id\s*\(/m.test(body)) return body;
      const lines = [`@id(${quoted(policy.id)})`];
      if (policy.description.trim() !== '')
        lines.push(`@description(${quoted(policy.description)})`);
      return `${lines.join('\n')}\n${body}`;
    })
    .join('\n\n')
    .concat('\n');
}

/**
 * The files of a workspace with its policies replaced by `text`. Everything
 * else is kept, so applying the result changes the policies and nothing
 * more: an import is laid over what the page opened with, not over what is
 * in use, and a file of policies alone would put the rest back.
 */
export function withPolicies(files: readonly WorkspaceFile[], text: string): WorkspaceFile[] {
  return [...files.filter((file) => !isPolicyFile(file.path)), { path: POLICY_FILE, text }];
}
