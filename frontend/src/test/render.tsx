import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ToastProvider';

export function renderWorkspace(ui: ReactNode, route = '/overview') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[route]}><ToastProvider>{ui}</ToastProvider></MemoryRouter></QueryClientProvider>),
  };
}
