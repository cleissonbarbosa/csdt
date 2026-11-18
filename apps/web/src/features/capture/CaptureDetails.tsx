import { ExternalLink, X } from 'lucide-react';

import { IconButton } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import { t } from '@/i18n';
import { useCapture } from '@/stores/capture';

import { isReport } from './capture';
import { provenanceOf } from './CaptureCard';
import { colourNote, formatPeriod, utcSpan } from './present';

/**
 * What an incident capture is, on the card that takes the right side while
 * nothing in it is selected: its title and source as the file wrote them,
 * the stretch of time it covers, how much it holds, how its colours are to
 * be read and its own notes. A report says that AEGIS transcribed it, and
 * that its pieces rest because nothing was measured.
 */
export function CaptureDetails() {
  const capture = useCapture((state) => state.capture);
  const fileName = useCapture((state) => state.fileName);
  if (!capture) return null;
  const report = isReport(capture);
  const { source } = capture;
  const facts: [string, string][] = [
    [t('Window'), utcSpan(capture.window)],
    ...(capture.topologyWindow
      ? ([[t('Connections found'), utcSpan(capture.topologyWindow)]] as [string, string][])
      : []),
    ...(capture.periodMs
      ? ([[t('Sampling period'), formatPeriod(capture.periodMs)]] as [string, string][])
      : []),
    [t('Services'), String(capture.nodes.length)],
    [t('Connections'), String(capture.edges.length)],
    [t('Regions'), String(capture.regions.length)],
    [t('Events'), String(capture.events.length)],
  ];

  return (
    <div className="cascade" data-testid="capture-details">
      <header className="border-b border-line px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink" data-testid="capture-details-title">
              {capture.title}
            </h2>
            <p className="caption mt-0.5">{provenanceOf(capture)}</p>
          </div>
          <IconButton
            label={t('Close the details')}
            onClick={() => useCapture.getState().setDetails(false)}
            data-testid="capture-details-close"
          >
            <X size={15} />
          </IconButton>
        </div>
        <p className="mt-2 text-xs text-ink-dim" data-testid="capture-source">
          {source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex max-w-full items-center gap-1 text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
            >
              <span className="truncate">{source.label}</span>
              <ExternalLink size={11} aria-hidden className="shrink-0" />
              <span className="sr-only">{t('(opens in a new tab)')}</span>
            </a>
          ) : (
            source.label
          )}
        </p>
        {fileName !== null && (
          <p className="caption mt-1 truncate" data-testid="capture-file-name">
            {t('Read from {file} in this browser', { file: fileName })}
          </p>
        )}
      </header>

      <Section title={t('What it covers')}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-faint">{label}</dt>
              <dd className="numeric min-w-0 text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title={t('How to read it')}>
        <div className="space-y-2 text-xs leading-relaxed text-ink-dim">
          <p data-testid="capture-colour-note">{colourNote(capture)}</p>
          <p>
            {t(
              'A service whose state the source does not give is drawn upright on a dashed ring, a shade fainter: unknown, never normal.',
            )}
          </p>
          {report && (
            <>
              <p data-testid="capture-transcribed">
                {t(
                  "Transcribed by hand from the report: the products shown, their connections and kinds, and the state at each update are AEGIS's reading of the text; each event names the update it rests on.",
                )}
              </p>
              <p>
                {t(
                  'The report has no request measurements: the pieces rest because nothing was measured, not because nothing passed.',
                )}
              </p>
            </>
          )}
        </div>
      </Section>

      {capture.notes.length > 0 && (
        <Section title={t('Notes')}>
          {/* As the capture wrote them. */}
          <ul
            className="space-y-2 text-xs leading-relaxed text-ink-dim"
            data-testid="capture-notes"
          >
            {capture.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
