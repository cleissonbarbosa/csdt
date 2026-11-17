import { describe, expect, it } from 'vitest';

import { embedFromSearch, fullAddress } from './embed';

describe('the model inside another page', () => {
  it('is asked for by the address, and by nothing else', () => {
    expect(embedFromSearch('')).toBeNull();
    expect(embedFromSearch('?arrangement=regions')).toBeNull();
    expect(embedFromSearch('?embed=0')).toBeNull();
    expect(embedFromSearch('?embed=false')).toBeNull();
    expect(embedFromSearch('?embed=1')).toEqual({ scenarioId: null });
    expect(embedFromSearch('?embed')).toEqual({ scenarioId: null });
  });

  it('takes a scenario only if it could be the id of one', () => {
    expect(embedFromSearch('?embed=1&scenario=ddos-surge')).toEqual({ scenarioId: 'ddos-surge' });
    expect(embedFromSearch('?embed=1&scenario=')).toEqual({ scenarioId: null });
    expect(embedFromSearch('?embed=1&scenario=../../etc')).toEqual({ scenarioId: null });
    expect(embedFromSearch('?embed=1&scenario=DROP%20TABLE')).toEqual({ scenarioId: null });
    // Without the embed a scenario in the address asks for nothing.
    expect(embedFromSearch('?scenario=ddos-surge')).toBeNull();
  });

  it('leads to the whole application at the same view', () => {
    expect(
      fullAddress({
        pathname: '/csdt/',
        search: '?embed=1&scenario=ddos-surge&arrangement=regions',
        hash: '',
      }),
    ).toBe('/csdt/?arrangement=regions');
    expect(fullAddress({ pathname: '/', search: '?embed=1', hash: '#main' })).toBe('/#main');
  });
});
