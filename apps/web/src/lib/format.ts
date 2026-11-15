/** Formatting helpers. All of them are pure and locale-independent. */

export function formatRate(rps: number): string {
  if (!Number.isFinite(rps)) return '–';
  if (rps >= 10_000) return `${(rps / 1000).toFixed(1)}k`;
  if (rps >= 1000) return `${(rps / 1000).toFixed(2)}k`;
  if (rps >= 100) return rps.toFixed(0);
  if (rps >= 10) return rps.toFixed(1);
  return rps.toFixed(rps === 0 ? 0 : 2);
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '–';
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${ms.toFixed(0)} ms`;
  return `${ms.toFixed(1)} ms`;
}

/** A 0..1 fraction as a percentage with sensible precision. */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '–';
  const pct = fraction * 100;
  if (pct === 0) return '0%';
  if (pct < 0.1) return '<0.1%';
  if (pct < 10) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

/** Virtual time as `m:ss`, or `h:mm:ss` past an hour. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = seconds.toString().padStart(2, '0');
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '–';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(0)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return Math.round(value).toString();
}

/** `User::"alice"` → `alice`; leaves anything else untouched. */
export function entityId(uid: string): string {
  const match = /::"(.*)"$/.exec(uid);
  return match?.[1] ?? uid;
}

/** `User::"alice"` → `User`. */
export function entityType(uid: string): string {
  const index = uid.lastIndexOf('::');
  return index === -1 ? uid : uid.slice(0, index);
}

export function titleCase(value: string): string {
  return value
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
