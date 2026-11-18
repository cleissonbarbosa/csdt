import './index.css';
import './app/policy';

import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { keepOffline } from './app/offline';
import { queryClient } from './app/queryClient';

const CloudReplay = lazy(() => import('./features/replay/CloudReplay'));
const replay = new URLSearchParams(window.location.search).has('replay');

keepOffline();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {replay ? (
        <Suspense>
          <CloudReplay />
        </Suspense>
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </StrictMode>,
);
