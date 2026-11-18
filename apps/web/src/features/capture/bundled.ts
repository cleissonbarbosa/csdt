/**
 * The incident captures that come with the application. Each is a file in
 * this folder, loaded only when it is opened, so neither is in the main
 * chunk. The title, source and window are repeated here so a list can be
 * shown without loading them; they are what the file says, shown as written,
 * and a test holds them equal to it.
 */
export interface BundledCapture {
  /** The file's name, and what `?capture=` names. */
  id: string;
  title: string;
  sourceLabel: string;
  window: { startMs: number; endMs: number };
  /** The file's contents, to be read with `readCapture`. */
  load: () => Promise<unknown>;
}

export const BUNDLED: readonly BundledCapture[] = [
  {
    id: 'google-cloud-2025-06-12',
    // not-interface-text: written by the capture file
    title: 'Google Cloud outage · 12 June 2025',
    // not-interface-text: written by the capture file
    sourceLabel: 'Google Cloud Service Health',
    window: { startMs: 1749750300000, endMs: 1749778020000 },
    load: () => import('./google-cloud-2025-06-12.json').then((module) => module.default),
  },
  {
    id: 'online-boutique-rcaeval',
    // not-interface-text: written by the capture file
    title: 'Online Boutique · RCAEval · 15 January 2024',
    // not-interface-text: written by the capture file
    sourceLabel: 'RCAEval · Prometheus / Jaeger',
    window: { startMs: 1705354266000, endMs: 1705354866000 },
    load: () => import('./online-boutique-rcaeval.json').then((module) => module.default),
  },
];

/** The bundled capture an id names, if it names one. */
export function bundledCapture(id: string): BundledCapture | undefined {
  return BUNDLED.find((entry) => entry.id === id);
}
