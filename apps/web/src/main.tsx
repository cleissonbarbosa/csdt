import './index.css';
import './app/policy';

import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { followCaptureAddress } from './app/captureUrl';
import { keepOffline } from './app/offline';
import { queryClient } from './app/queryClient';

keepOffline();
// An address that names an incident capture opens it, inside the application.
followCaptureAddress();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
