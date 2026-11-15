import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/providers/api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Client errors will not fix themselves; only retry transport failures.
      retry: (failures, error) =>
        failures < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});

export const queryKeys = {
  scenarios: ['scenarios'] as const,
  incidents: ['incidents'] as const,
  recordings: ['recordings'] as const,
  topologies: ['topologies'] as const,
  providers: ['providers'] as const,
  catalog: ['authorization', 'catalog'] as const,
  decisions: ['authorization', 'decisions'] as const,
  workspace: ['workspace'] as const,
};

/**
 * Everything that is read from the platform's files. When those are replaced
 * nothing the client holds about them is true any more.
 */
export function invalidateWorkspaceQueries(): void {
  for (const key of [
    queryKeys.scenarios,
    queryKeys.incidents,
    queryKeys.recordings,
    queryKeys.topologies,
    queryKeys.catalog,
    queryKeys.decisions,
    queryKeys.workspace,
  ]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}
