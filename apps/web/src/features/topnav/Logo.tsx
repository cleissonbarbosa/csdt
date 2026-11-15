/** The AEGIS mark: a shield within a shield, around a single watched point. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="AEGIS">
      <path
        d="M16 3.5 27 8.4v7.9c0 5.9-4.4 10.300-11 12.400C9.400 26.600 5 22.200 5 16.300V8.400L16 3.500Z"
        fill="none"
        stroke="#55E6F2"
        strokeWidth="1.600"
        strokeLinejoin="round"
      />
      <path
        d="M16 9.800 21.500 12.500v3.700c0 3-2.200 5.200-5.500 6.400-3.300-1.200-5.500-3.400-5.500-6.400v-3.700L16 9.800Z"
        fill="#55E6F2"
        fillOpacity="0.16"
        stroke="#9B7BFF"
        strokeWidth="1.200"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="1.800" fill="#EAF2FF" />
    </svg>
  );
}
