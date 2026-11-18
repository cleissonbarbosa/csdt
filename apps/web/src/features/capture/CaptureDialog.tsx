import { FileUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { openCapture, openCaptureFile } from '@/app/captureUrl';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { useCapture } from '@/stores/capture';

import { BUNDLED } from './bundled';
import { utcSpan } from './present';

/**
 * Where an incident capture is opened: the ones that come with AEGIS, each
 * by its title, source and window as its file states them, or a file of the
 * viewer's own, read in this tab. A file that cannot be read says why here;
 * one that opens closes the dialog on the capture.
 *
 * Opening goes through `app/captureUrl.ts`, so the browser's Back leaves the
 * capture as "Back to the simulation" does.
 */
export function CaptureDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const error = useCapture((state) => state.error);
  const current = useCapture((state) => (state.capture ? state.id : undefined));
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // What failed the last time is not news to a dialog opened again.
  useEffect(() => {
    if (open) useCapture.getState().clearError();
  }, [open]);

  const settle = (opened: boolean) => {
    setBusy(null);
    if (opened) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Open an incident capture')}
      description={t(
        'A real incident, as a provider reported it or a system recorded it, read in this browser and shown as it is: captured, not simulated. The simulation goes on untouched behind it.',
      )}
    >
      <div data-testid="capture-dialog">
        <h3 className="mb-1.5 text-xs font-bold text-ink">{t('Captures that come with AEGIS')}</h3>
        <ul className="-mx-2" data-testid="capture-bundled">
          {BUNDLED.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                disabled={busy !== null}
                aria-current={current === entry.id ? 'true' : undefined}
                onClick={() => {
                  setBusy(entry.id);
                  void openCapture(entry.id).then(settle);
                }}
                className={cn(
                  'w-full rounded-control px-2 py-2 text-left transition-colors hover:bg-raised disabled:opacity-60',
                  current === entry.id && 'bg-raised',
                )}
                data-testid={`capture-open-${entry.id}`}
              >
                <span className="block text-xs font-bold text-ink">{entry.title}</span>
                <span className="block text-[11px] text-ink-dim">{entry.sourceLabel}</span>
                <span className="caption numeric block">{utcSpan(entry.window)}</span>
                {busy === entry.id && <span className="caption mt-0.5 block">{t('Opening…')}</span>}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-line pt-4">
          <Button
            size="sm"
            icon={<FileUp size={12} aria-hidden />}
            disabled={busy !== null}
            onClick={() => input.current?.click()}
            data-testid="capture-file-button"
          >
            {busy === 'file' ? t('Opening…') : t('Open a capture file…')}
          </Button>
          <input
            ref={input}
            type="file"
            hidden
            accept=".json,application/json"
            aria-label={t('Capture file to open')}
            data-testid="capture-file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              setBusy('file');
              void openCaptureFile(file).then(settle);
            }}
          />
          <p className="caption mt-2 leading-snug">
            {t(
              'An incident capture file of up to 12 MiB. It is read in this tab and sent nowhere.',
            )}
          </p>
          {error && (
            <p
              role="alert"
              className="mt-2 rounded-control border border-critical/40 bg-critical/10 px-2 py-1.5 text-[11px] leading-relaxed text-critical"
              data-testid="capture-problem"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
