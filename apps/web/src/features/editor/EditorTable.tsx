/**
 * The draft without the model: where neither WebGPU nor WebGL 2 is
 * available, or when the table view is asked for. It is laid out as the
 * swimlanes are, a region at a time and a tier after another, and a row is
 * selected as a piece is. Everything the model's carrying does, the
 * palette (pressed rather than carried) and the card do here.
 */
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { RELATIONSHIP_LABEL, SERVICE_TYPE } from '@/lib/palette';
import { useEditor } from '@/stores/editor';

import { KIND_GLYPH } from './Palette';

export function EditorTable({ notice }: { notice: string | null }) {
  const draft = useEditor((state) => state.draft);
  const selection = useEditor((state) => state.selection);
  if (!draft) return null;
  const nameOf = (id: string) => draft.nodes.find((node) => node.id === id)?.name ?? id;
  return (
    <div className="h-full overflow-y-auto px-4 py-4" data-testid="editor-table">
      {notice && (
        <p role="status" className="panel mb-4 px-3 py-2 text-xs text-ink">
          {notice}
        </p>
      )}
      {draft.regions.map((region) => {
        const nodes = draft.nodes
          .filter((node) => node.region === region.id)
          .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
        return (
          <section key={region.id} className="mb-5">
            <h2 className="mb-1.5 text-xs font-bold text-ink">{region.name}</h2>
            {nodes.length === 0 ? (
              <p className="text-[11px] text-ink-faint">{t('No service yet.')}</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="text-[11px] text-ink-faint">
                  <tr>
                    <th className="w-12 py-1 font-normal">{t('Tier')}</th>
                    <th className="py-1 font-normal">{t('Service')}</th>
                    <th className="py-1 font-normal">{t('Kind')}</th>
                    <th className="py-1 font-normal">{t('Calls')}</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((node) => {
                    const Glyph = KIND_GLYPH[node.type];
                    const selected = selection?.kind === 'node' && selection.id === node.id;
                    const out = draft.edges.filter((edge) => edge.source === node.id);
                    return (
                      <tr
                        key={node.id}
                        className={cn('border-t border-line', selected && 'bg-sunken')}
                        aria-selected={selected}
                      >
                        <td className="numeric py-1.5 text-ink-dim">{node.tier}</td>
                        <td className="py-1.5">
                          <button
                            type="button"
                            className="flex items-center gap-1.5 text-ink hover:underline"
                            onClick={() =>
                              useEditor.getState().select({ kind: 'node', id: node.id })
                            }
                          >
                            <Glyph
                              size={13}
                              strokeWidth={1.6}
                              aria-hidden
                              className="text-ink-dim"
                            />
                            {node.name}
                          </button>
                        </td>
                        <td className="py-1.5 text-ink-dim">{SERVICE_TYPE[node.type].label}</td>
                        <td className="py-1.5 text-ink-dim">
                          {out.length === 0
                            ? '–'
                            : out
                                .map(
                                  (edge) =>
                                    `${RELATIONSHIP_LABEL[edge.relationship]} ${nameOf(edge.target)}`,
                                )
                                .join(', ')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
