/**
 * How to get an inventory of a cloud account: the command to run, written
 * from a few fields. It is folded away until asked for.
 *
 * The page runs nothing and reaches no cloud. What is typed here goes into
 * a line of text and nowhere else; the script it names runs on the viewer's
 * machine, through the provider's own CLI, with the viewer's own access.
 */
import { Copy } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Segmented, TextField } from '@/components/ui/Field';
import { t } from '@/i18n';
import { tr } from '@/i18n/rich';
import { useNotices } from '@/stores/notices';

import {
  NOTHING_ASKED,
  PROVIDER_NAME,
  cloudCommand,
  fieldsOf,
  type CloudAsk,
  type CloudField,
  type CloudProvider,
} from './cloudCommand';

const PROVIDERS: readonly { value: CloudProvider; label: string }[] = (
  ['aws', 'gcp', 'oci'] as const
).map((value) => ({ value, label: PROVIDER_NAME[value] }));

const FIELD: Record<CloudField, { label: string; hint: string }> = {
  profile: { label: t('Profile'), hint: t('Of the provider’s CLI. Empty: its default.') },
  project: { label: t('Project'), hint: t('The id of the project to read.') },
  compartment: { label: t('Compartment'), hint: t('The OCID of the compartment to read.') },
  regions: { label: t('Regions'), hint: t('Region codes, separated by spaces or commas.') },
};

const code = (children: React.ReactNode) => <span className="code">{children}</span>;

export function CloudCommand() {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<CloudAsk>(NOTHING_ASKED);
  const id = useId();
  const { command, missing } = cloudCommand(ask);
  const set = (part: Partial<CloudAsk>) => setAsk((current) => ({ ...current, ...part }));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      useNotices.getState().push('info', t('Command copied.'));
    } catch {
      useNotices.getState().push('error', t('The command could not be copied.'));
    }
  };

  return (
    <div className="mt-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        className="text-[11px] text-ink-dim underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-ink"
        onClick={() => setOpen(!open)}
        data-testid="cloud-command-toggle"
      >
        {t('Get an inventory of a cloud account, to import')}
      </button>
      {open && (
        <div
          id={id}
          className="mt-2 rounded-control border border-line p-3"
          data-testid="cloud-command"
        >
          <p className="text-[11px] leading-relaxed text-ink-dim">
            {t(
              'A script in this project’s repository reads what a provider lists of an account, its resources and the connections it states between them, and writes one file. It runs on your machine, through the provider’s own CLI and with your own access, and only reads. AEGIS never runs it and is given no credential: what you type here goes into the line below and nowhere else. Drop the file it writes on this dialog.',
            )}
          </p>
          <div className="mt-2.5">
            <Segmented
              label={t('Provider')}
              value={ask.provider}
              options={PROVIDERS}
              onChange={(provider) => set({ provider })}
              testId="cloud-provider"
            />
          </div>
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
            {fieldsOf(ask.provider).map(({ field }) => (
              <TextField
                key={field}
                label={FIELD[field].label}
                hint={FIELD[field].hint}
                value={ask[field]}
                onChange={(event) => set({ [field]: event.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
            ))}
            <TextField
              label={t('Only with these tags')}
              hint={t('KEY or KEY=VALUE, separated by spaces. Empty: everything.')}
              value={ask.tags}
              onChange={(event) => set({ tags: event.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
            <TextField
              label={t('Name in AEGIS')}
              hint={t('It need not be the account’s.')}
              value={ask.name}
              onChange={(event) => set({ name: event.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <pre
            className="code mt-2.5 overflow-x-auto whitespace-pre-wrap break-all rounded-control border border-line bg-sunken px-2 py-1.5 text-[11px] leading-relaxed text-ink"
            data-testid="cloud-command-text"
          >
            {command}
          </pre>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              icon={<Copy size={12} aria-hidden />}
              disabled={missing.length > 0}
              onClick={() => void copy()}
              data-testid="cloud-command-copy"
            >
              {t('Copy the command')}
            </Button>
            {missing.length > 0 && (
              <span className="text-[11px] text-ink-dim">
                {t('Still needed: {fields}', {
                  fields: missing.map((field) => FIELD[field].label).join(', '),
                })}
              </span>
            )}
          </div>
          <p className="caption mt-2">
            {tr(
              'Run it from the repository’s folder, with the provider’s CLI installed and signed in. <c>--help</c> after the provider lists every option; what it reads, and the least access it needs, is in <c>docs/INVENTORY.md</c>.',
              { c: code },
            )}
          </p>
        </div>
      )}
    </div>
  );
}
