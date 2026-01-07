/**
 * Component Lifecycle Integration Tests
 *
 * These tests validate component lifecycle management, memory leaks, and cleanup
 * issues that have historically caused bugs like infinite loading states.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock component that simulates problematic lifecycle behavior
const LifecycleTestComponent = ({
  onMount,
  onUnmount,
  shouldFailCleanup = false
}: {
  onMount?: () => void;
  onUnmount?: () => void;
  shouldFailCleanup?: boolean;
}) => {
  const [mounted, setMounted] = React.useState(false);
  const cleanupCalledRef = React.useRef(false);

  React.useEffect(() => {
    setMounted(true);
    onMount?.();

    return () => {
      cleanupCalledRef.current = true;
      onUnmount?.();

      if (shouldFailCleanup) {
        // Simulate cleanup that doesn't properly clear resources
        console.warn('Cleanup failed - resources not cleared');
      }
    };
  }, [onMount, onUnmount, shouldFailCleanup]);

  return (
    <div>
      <div data-testid="mounted">{mounted ? 'mounted' : 'unmounted'}</div>
      <div data-testid="cleanup-called">{cleanupCalledRef.current ? 'cleanup-called' : 'cleanup-pending'}</div>
    </div>
  );
};

// Simple async component for testing
const AsyncLifecycleComponent = ({ shouldCleanup = true }: { shouldCleanup?: boolean }) => {
  const [data, setData] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const abortController = new AbortController();

    // Simulate async operation
    const timer = setTimeout(() => {
      if (!abortController.signal.aborted) {
        setData('Success');
        setLoading(false);
      }
    }, 100);

    return () => {
      if (shouldCleanup) {
        clearTimeout(timer);
        abortController.abort();
      }
    };
  }, [shouldCleanup]);

  if (loading) return <div data-testid="loading">Loading...</div>;
  return <div data-testid="data">{data}</div>;
};

describe('Component Lifecycle Integration Tests', () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          cacheTime: 0,
        },
        mutations: {
          retry: false,
        },
      },
    });
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const renderWithProviders = (component: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        {component}
      </QueryClientProvider>
    );
  };

  describe('Mount/Unmount Lifecycle', () => {
    it('calls mount and unmount handlers correctly', () => {
      const onMount = vi.fn();
      const onUnmount = vi.fn();

      const { unmount } = renderWithProviders(
        <LifecycleTestComponent onMount={onMount} onUnmount={onUnmount} />
      );

      // Verify mount was called
      expect(onMount).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('mounted')).toHaveTextContent('mounted');

      // Unmount and verify unmount was called
      unmount();
      expect(onUnmount).toHaveBeenCalledTimes(1);
    });

    it('handles rapid mount/unmount cycles', () => {
      const mountSpy = vi.fn();
      const unmountSpy = vi.fn();

      // Mount and unmount component multiple times
      for (let i = 0; i < 3; i++) {
        const { unmount } = renderWithProviders(
          <LifecycleTestComponent onMount={mountSpy} onUnmount={unmountSpy} />
        );
        unmount();
      }

      // Each cycle should have been tracked
      expect(mountSpy).toHaveBeenCalledTimes(3);
      expect(unmountSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('Cleanup Error Handling', () => {
    it('handles errors during cleanup gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        const { unmount } = renderWithProviders(
          <LifecycleTestComponent shouldFailCleanup={true} />
        );
        unmount();
      }).not.toThrow();

      // Should have logged cleanup failure
      expect(consoleSpy).toHaveBeenCalledWith('Cleanup failed - resources not cleared');

      consoleSpy.mockRestore();
    });

    it('maintains component stability during cleanup', () => {
      const renderCountRef = { current: 0 };

      const StableComponent = () => {
        renderCountRef.current++;

        React.useEffect(() => {
          return () => {
            // Cleanup that should not cause issues
            renderCountRef.current = 999; // This is just a ref update, not state
          };
        }, []);

        return <div data-testid="stable-test">Stable component</div>;
      };

      const { unmount } = renderWithProviders(<StableComponent />);

      expect(renderCountRef.current).toBe(1);
      expect(screen.getByTestId('stable-test')).toBeInTheDocument();

      // Unmount should complete without issues
      expect(() => unmount()).not.toThrow();

      // Ref should be updated by cleanup
      expect(renderCountRef.current).toBe(999);
    });
  });

  describe('Resource Management', () => {
    it('cleans up event listeners on unmount', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const EventListenerComponent = () => {
        React.useEffect(() => {
          const handler = () => {};
          window.addEventListener('resize', handler);

          return () => {
            window.removeEventListener('resize', handler);
          };
        }, []);

        return <div data-testid="event-listener-test">Event listener component</div>;
      };

      const { unmount } = renderWithProviders(<EventListenerComponent />);

      expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });

    it('handles multiple cleanup functions', () => {
      const cleanup1 = vi.fn();
      const cleanup2 = vi.fn();

      const MultiCleanupComponent = () => {
        React.useEffect(() => {
          return () => {
            cleanup1();
            cleanup2();
          };
        }, []);

        return <div data-testid="multi-cleanup-test">Multi cleanup component</div>;
      };

      const { unmount } = renderWithProviders(<MultiCleanupComponent />);

      expect(cleanup1).not.toHaveBeenCalled();
      expect(cleanup2).not.toHaveBeenCalled();

      unmount();

      expect(cleanup1).toHaveBeenCalledTimes(1);
      expect(cleanup2).toHaveBeenCalledTimes(1);
    });
  });
});
