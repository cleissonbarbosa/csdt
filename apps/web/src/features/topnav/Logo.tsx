/**
 * The AEGIS mark: a shield drawn as a plate seen from above, with the one
 * point being watched. Ink only; it inherits the text colour.
 */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="AEGIS">
      <path
        d="M16 3.5 27 8.4v7.9c0 5.9-4.4 10.3-11 12.4C9.4 26.600 5 22.200 5 16.300V8.400L16 3.500Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="15.5" r="3.2" fill="currentColor" />
    </svg>
  );
}
