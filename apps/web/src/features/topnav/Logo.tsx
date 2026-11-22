import { COLOR } from '@/lib/palette';

/**
 * The AEGIS mark: a passage through nested gates, the stages a request
 * crosses, with one line resting in it, the route, neither selected nor
 * abnormal. The gates are ink and inherit the text colour; the line is
 * `--color-logo-line`. No hue, in either theme.
 *
 * The strokes are the identity's own: `apps/web/scripts/build-identity.py`
 * draws the logo files and the favicon from the same ones, and
 * `Logo.test.ts` holds the two together. The mark always stands beside the
 * name, which says the same thing, so assistive technology is not told it
 * twice.
 */
export const GATES = [
  { d: 'M14 106 V43 L58 18 H70 L114 43 V106', width: 12 },
  { d: 'M31 106 V54 L59 38 H69 L97 54 V106', width: 10 },
  { d: 'M48 106 V67 L60 60 H68 L80 67 V106', width: 8 },
] as const;

export const LINE = { d: 'M64 86 V106', width: 8 } as const;

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      // The ink runs from 12 to 106 of the 128 unit square; the view is
      // moved up by 5 so it sits in the middle of the name's line.
      viewBox="0 -5 128 128"
      aria-hidden
      className="shrink-0"
      fill="none"
      strokeLinejoin="bevel"
      strokeLinecap="butt"
    >
      <g stroke="currentColor">
        {GATES.map(({ d, width }) => (
          <path key={d} d={d} strokeWidth={width} />
        ))}
      </g>
      <path d={LINE.d} strokeWidth={LINE.width} stroke={COLOR.logoLine} />
    </svg>
  );
}
