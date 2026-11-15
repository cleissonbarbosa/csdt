import type { IntegrationState, IntegrationStatus } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';

import { actions } from '@/app/actions';
import { queryKeys } from '@/app/queryClient';
import { Badge, SourceBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Section';
import { COLOR } from '@/lib/palette';
import { api } from '@/providers/api';
import { useUi } from '@/stores/ui';

const STATE: Record<IntegrationState, { label: string; color: string }> = {
  active: { label: 'Active', color: COLOR.healthy },
  'not-configured': { label: 'Not configured', color: COLOR.inkFaint },
  available: { label: 'Available', color: COLOR.cyan },
  connecting: { label: 'Connecting', color: COLOR.warning },
  connected: { label: 'Connected', color: COLOR.healthy },
  imported: { label: 'Imported', color: COLOR.healthy },
  error: { label: 'Error', color: COLOR.critical },
};

const KIND = {
  simulation: 'Built-in simulation',
  'live-adapter': 'Live adapter',
  fixture: 'Fixture',
} as const;

const SETUP_HINT: Record<string, string> = {
  'cedar-agent':
    'Set AEGIS_CEDAR_AGENT_URL on the server (for example http://127.0.0.1:8180) and restart it.',
  'rinha-backend':
    'Set AEGIS_RINHA_URL on the server (for example http://127.0.0.1:9999) and restart it.',
};

function ProviderCard({ provider }: { provider: IntegrationStatus }) {
  const [busy, setBusy] = useState(false);
  const state = STATE[provider.state];
  const run = async (connect: boolean) => {
    setBusy(true);
    await actions.setProvider(provider.id, connect);
    setBusy(false);
  };
  const fixture = provider.kind === 'fixture';
  const on =
    provider.state === 'connected' ||
    provider.state === 'imported' ||
    provider.state === 'connecting';
  return (
    <li
      className="rounded-[4px] border border-line p-3"
      data-testid={`provider-${provider.id}`}
      data-state={provider.state}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-sm font-semibold text-ink">{provider.name}</h3>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-ink-faint">
            {KIND[provider.kind]}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <SourceBadge source={provider.dataSource} />
          <Badge color={state.color} dot pulse={provider.state === 'connecting'}>
            {state.label}
          </Badge>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-dim">{provider.description}</p>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        {provider.repository && (
          <>
            <dt className="text-ink-faint">Repository</dt>
            <dd className="min-w-0">
              <a
                href={provider.repository}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex max-w-full items-center gap-1 truncate text-cyan hover:underline"
              >
                {provider.repository.replace('https://github.com/', '')}
                <ExternalLink size={11} aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </dd>
          </>
        )}
        {provider.verifiedInterface && (
          <>
            <dt className="text-ink-faint">Verified interface</dt>
            <dd className="numeric text-ink-dim">{provider.verifiedInterface}</dd>
          </>
        )}
        {provider.endpoint && (
          <>
            <dt className="text-ink-faint">Target</dt>
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
          className="mt-2 rounded-[3px] border border-critical/40 bg-critical/10 px-2 py-1 text-[11px] text-critical"
        >
          {provider.lastError}
        </p>
      )}
      {provider.state === 'not-configured' && (
        <p className="mt-2 text-[11px] text-ink-faint">
          {SETUP_HINT[provider.id] ?? 'Not configured on the server.'}
        </p>
      )}

      {provider.kind !== 'simulation' && provider.state !== 'not-configured' && (
        <div className="mt-3 flex gap-1.5">
          {on ? (
            <Button size="sm" disabled={busy} onClick={() => void run(false)}>
              {fixture ? 'Forget import' : 'Disconnect'}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => void run(true)}
              data-testid={`provider-connect-${provider.id}`}
            >
              {busy ? 'Working…' : fixture ? 'Import onto timeline' : 'Connect'}
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
      title="Integrations"
      description="Demo Mode needs none of these. Each one is opt-in, and every piece of data is labelled with where it came from."
      width="max-w-3xl"
    >
      {isError && <EmptyState title="Unavailable">The server could not be reached.</EmptyState>}
      <ul className="grid gap-3 md:grid-cols-2">
        {data?.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
      </ul>
      <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
        Live adapters only accept loopback targets (or hosts explicitly allow-listed on the server),
        use short timeouts and never follow redirects. Fixtures are local files parsed in the format
        of a public project; importing them contacts nothing.
      </p>
    </Dialog>
  );
}
