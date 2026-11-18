/**
 * The tabs of a panel: two or more equal triggers in a row, the chosen one
 * in bold ink, and a line under it that travels when the choice changes.
 * The tabs themselves are Radix's (`@radix-ui/react-tabs`); this is only how
 * they look, shared by every panel that has them.
 */

/** A tab's trigger: equal shares of the row, ink-faint until it is chosen. */
export const tabClass =
  'relative z-10 flex-1 px-3 py-2 text-xs text-ink-faint transition-colors hover:text-ink data-[state=active]:font-bold data-[state=active]:text-ink';

/**
 * The line under the active tab; it travels when the tab changes. It goes
 * inside the `Tabs.List`, which has to be `relative`.
 */
export function TabMarker({ index, count }: { index: number; count: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-ink transition-transform duration-200 ease-travel"
      style={{ width: `${100 / count}%`, transform: `translateX(${index * 100}%)` }}
    />
  );
}
