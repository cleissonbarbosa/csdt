/**
 * The model shown inside another page.
 *
 * `?embed=1` asks for the application without its bar: the model, what a
 * selection brings, and one line that says what this is and leads to the
 * whole of it. `&scenario=<id>` also asks for an incident to be running,
 * which is granted only where the engine is the page's own (the static
 * site): a link must not start an incident on a simulation that other
 * people are looking at.
 */
export interface Embed {
  /** The scenario the address asks to have running, if it names one. */
  scenarioId: string | null;
}

export function embedFromSearch(search: string): Embed | null {
  const params = new URLSearchParams(search);
  const asked = params.get('embed');
  if (asked === null || asked === '0' || asked === 'false') return null;
  const scenario = params.get('scenario');
  return {
    scenarioId: scenario !== null && /^[a-z0-9][a-z0-9-]{0,63}$/.test(scenario) ? scenario : null,
  };
}

/** The address of the whole application: this one, without what makes it an embed. */
export function fullAddress(location: Pick<Location, 'pathname' | 'search' | 'hash'>): string {
  const params = new URLSearchParams(location.search);
  params.delete('embed');
  params.delete('scenario');
  const search = params.toString();
  return `${location.pathname}${search === '' ? '' : `?${search}`}${location.hash}`;
}
