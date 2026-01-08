import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { logger } from '../utils/logger';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      logger.error('React Query Error', {
        error: error.message,
        queryKey: query.queryKey,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        endpoint: typeof window !== 'undefined' ? window.location.pathname : 'unknown'
      });
    }
  }),
  mutationCache: new MutationCache({
    onError: (error, variables, context) => {
      logger.error('Mutation Error', {
        error: error.message,
        variables: JSON.stringify(variables).substring(0, 500),
        context,
        timestamp: new Date().toISOString()
      });
    }
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (cache time)
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors (client errors)
        if (error instanceof AxiosError && error.response && error.response.status >= 400 && error.response.status < 500) {
          return false;
        }
        // Retry network errors up to 2 times
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false, // Don't retry mutations by default
    },
  },
});
