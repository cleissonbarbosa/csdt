import type { IntegrationState, IntegrationStatus } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';

import { actions } from '@/app/actions';
import { HOST } from '@/app/host';
import { queryKeys } from '@/app/queryClient';
import { SourceBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Section';
import { t } from '@/i18n';
import { COLOR } from '@/lib/palette';
import { api } from '@/providers/api';
import { useUi } from '@/stores/ui';

/** A provider's state is plain text unless it is trying or failing. */
const STATE: Record<IntegrationState, { label: string; color?: string; quiet?: boolean }> = {
  active: { label: t('Active') },
  'not-configured': { label: t('Not configured'), quiet: true },
  available: { label: t('Available') },
  connecting: { label: t('Connecting'), color: COLOR.warning },
  connected: { label: t('Connected') },
  error: { label: t('Error'), color: COLOR.critical },
};

const KIND: Record<IntegrationStatus['kind'], string> = {
  simulation: t('Built-in simulation'),
  'live-adapter': t('Live adapter'),
};

const SETUP_HINT: Record<string, string> = {
  'cedar-agent': t(
    'Set AEGIS_CEDAR_AGENT_URL on the server (for example http://127.0.0.1:8180) and restart it.',
  ),
  'rinha-backend': t(
    'Set AEGIS_RINHA_URL on the server (for example http://127.0.0.1:9999) and restart it.',
  ),
};

function ProviderCard({ provider }: { provider: IntegrationStatus }) {
  const [busy, setBusy] = useState(false);
  const state = STATE[provider.state];
  const run = async (connect: boolean) => {
    setBusy(true);
    await actions.setProvider(provider.id, connect);
    setBusy(false);
  };
  const on = provider.state === 'connected' || provider.state === 'connecting';
  return (
    <li
      className="rounded-control border border-line p-3"
      data-testid={`provider-${provider.id}`}
      data-state={provider.state}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">{provider.name}</h3>
          <p className="mt-0.5 text-[11px] text-ink-faint">{KIND[provider.kind]}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <SourceBadge source={provider.dataSource} />
          <span
            className={
              state.quiet ? 'text-[11px] text-ink-faint' : 'text-[11px] font-bold text-ink'
            }
            style={{ color: state.color }}
          >
            {state.label}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-dim">{provider.description}</p>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        {provider.repository && (
          <>
            <dt className="text-ink-faint">{t('Repository')}</dt>
            <dd className="min-w-0">
              <a
                href={provider.repository}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex max-w-full items-center gap-1 truncate text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
              >
                {provider.repository.replace('https://github.com/', '')}
                <ExternalLink size={11} aria-hidden />
                <span className="sr-only">{t('(opens in a new tab)')}</span>
              </a>
            </dd>
          </>
        )}
        {provider.verifiedInterface && (
          <>
            <dt className="text-ink-faint">{t('Verified interface')}</dt>
            <dd className="numeric text-ink-dim">{provider.verifiedInterface}</dd>
          </>
        )}
        {provider.endpoint && (
          <>
            <dt className="text-ink-faint">{t('Target')}</dt>
            <dd className="numeric text-ink-dim">{provider.endpoint}</dd>
          </>
        )}
        {provider.metrics.map((metric) => (
          <div key={metric.label} className="contents">
            <dt className="text-ink-faint">{metric.label}</dt>
            <dd className="numeric text-ink">{metric.value}</dd>
          </div>
        ))}
      </dl>

      {provider.lastError && (
        <p
          role="alert"
          className="mt-2 rounded-control border border-critical/40 bg-critical/10 px-2 py-1 text-[11px] text-critical"
        >
          {provider.lastError}
        </p>
      )}
      {provider.state === 'not-configured' && (
        <p className="mt-2 text-[11px] text-ink-faint">
          {SETUP_HINT[provider.id] ?? t('Not configured on the server.')}
        </p>
      )}

      {provider.kind !== 'simulation' && provider.state !== 'not-configured' && (
        <div className="mt-3 flex gap-1.5">
          {on ? (
            <Button size="sm" disabled={busy} onClick={() => void run(false)}>
              {t('Disconnect')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => void run(true)}
              data-testid={`provider-connect-${provider.id}`}
            >
              {busy ? t('Working…') : t('Connect')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function IntegrationsDialog() {
  const open = useUi((state) => state.openPanel === 'integrations');
  const { data, isError } = useQuery({
    queryKey: queryKeys.providers,
    queryFn: api.providers,
    refetchInterval: open ? 2000 : 5000,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => useUi.getState().setPanel(next ? 'integrations' : null)}
      title={t('Integrations')}
      description={t(
        'Demo Mode needs none of these. Each one is opt-in, and every piece of data is labelled with where it came from.',
      )}
      width="max-w-3xl"
    >
      {isError && <EmptyState title={t('Unavailable')}>{HOST.unreachable}</EmptyState>}
      <ul className="grid gap-3 md:grid-cols-2">
        {data?.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
      </ul>
      <p
        className="mt-4 text-[11px] leading-relaxed text-ink-faint"
        data-testid="integrations-note"
      >
        {HOST.adapters}
      </p>
    </Dialog>
  );
}
