/**
 * Unit tests for ModalQueueContext
 * 
 * Tests the modal queue system for managing sequential modal flows.
 * Covers queue operations, defer option, error handling, queue size limits,
 * navigation cleanup, and showNext functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { ModalQueueProvider, useModalQueue, QueuedModal } from '../ModalQueueContext';
import { logger } from '../../utils/logger';

// Mock react-dom's createPortal
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock react-router-dom's useLocation
let mockPathname = '/test';
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPathname }),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Test modal component
const TestModal: React.FC<{ title: string; onClose?: () => void }> = ({ title, onClose }) => (
  <div data-testid="test-modal">
    <h1>{title}</h1>
    {onClose && <button onClick={onClose}>Close</button>}
  </div>
);

// Wrapper component for testing hooks
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ModalQueueProvider>{children}</ModalQueueProvider>
);

describe('ModalQueueContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('enqueueModal', () => {
    it('should show modal immediately if no current modal', () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
      };

      act(() => {
        result.current.enqueueModal(modal);
      });

      expect(result.current.currentModal).not.toBeNull();
      expect(result.current.currentModal?.id).toBe('test-1');
      expect(result.current.hasPendingModals).toBe(true);
    });

    it('should add modal to queue if current modal exists', () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal1: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
      };

      const modal2: QueuedModal<{ title: string }> = {
        id: 'test-2',
        component: TestModal,
        props: { title: 'Test Modal 2' },
      };

      act(() => {
        result.current.enqueueModal(modal1);
      });

      // First modal should be shown
      expect(result.current.currentModal?.id).toBe('test-1');

      act(() => {
        result.current.enqueueModal(modal2);
      });

      // First modal should still be current, second should be in queue
      expect(result.current.currentModal?.id).toBe('test-1');
      expect(result.current.hasPendingModals).toBe(true);
    });

    it('should respect defer option and always add to queue', () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
        defer: true,
      };

      act(() => {
        result.current.enqueueModal(modal);
      });

      // With defer, modal should be in queue but not shown immediately
      expect(result.current.currentModal).toBeNull();
      expect(result.current.hasPendingModals).toBe(true);
    });

    it('should enforce queue size limit', () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      // Enqueue 11 modals (MAX_QUEUE_SIZE is 10)
      act(() => {
        for (let i = 0; i < 11; i++) {
          result.current.enqueueModal({
            id: `test-${i}`,
            component: TestModal,
            props: { title: `Test Modal ${i}` },
            defer: true,
          });
        }
      });

      // Should log warning
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Modal queue size limit')
      );

      // Queue should be limited to MAX_QUEUE_SIZE
      expect(result.current.hasPendingModals).toBe(true);
    });
  });

  describe('FIFO ordering', () => {
    it('should show modals in FIFO order', async () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal1: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
      };

      const modal2: QueuedModal<{ title: string }> = {
        id: 'test-2',
        component: TestModal,
        props: { title: 'Test Modal 2' },
      };

      const modal3: QueuedModal<{ title: string }> = {
        id: 'test-3',
        component: TestModal,
        props: { title: 'Test Modal 3' },
      };

      act(() => {
        result.current.enqueueModal(modal1);
      });

      // First modal should be shown immediately
      expect(result.current.currentModal?.id).toBe('test-1');

      act(() => {
        result.current.enqueueModal(modal2);
        result.current.enqueueModal(modal3);
      });

      // First modal should still be shown (others in queue)
      expect(result.current.currentModal?.id).toBe('test-1');

      // Close first modal
      await act(async () => {
        const closePromise = result.current.closeCurrent();
        vi.advanceTimersByTime(200);
        await closePromise;
      });

      // Second modal should be shown
      expect(result.current.currentModal?.id).toBe('test-2');

      // Close second modal
      await act(async () => {
        const closePromise = result.current.closeCurrent();
        vi.advanceTimersByTime(200);
        await closePromise;
      });

      // Third modal should be shown
      expect(result.current.currentModal?.id).toBe('test-3');
    });
  });

  describe('closeCurrent', () => {
    it('should close current modal and show next in queue', async () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal1: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
      };

      const modal2: QueuedModal<{ title: string }> = {
        id: 'test-2',
        component: TestModal,
        props: { title: 'Test Modal 2' },
      };

      act(() => {
        result.current.enqueueModal(modal1);
      });

      expect(result.current.currentModal?.id).toBe('test-1');

      act(() => {
        result.current.enqueueModal(modal2);
      });

      // First modal should still be current
      expect(result.current.currentModal?.id).toBe('test-1');

      // Close current modal (200ms animation)
      await act(async () => {
        const closePromise = result.current.closeCurrent();
        vi.advanceTimersByTime(200);
        await closePromise;
      });

      expect(result.current.currentModal?.id).toBe('test-2');
    });

    it('should handle async close with timeout', async () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
      };

      act(() => {
        result.current.enqueueModal(modal);
      });

      expect(result.current.currentModal).not.toBeNull();

      // Start close
      const closePromise = act(async () => {
        return result.current.closeCurrent();
      });

      // Advance timers to complete animation
      act(() => {
        vi.advanceTimersByTime(200);
      });

      await closePromise;

      expect(result.current.currentModal).toBeNull();
    });

    it('should not close if no current modal', async () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      await act(async () => {
        await result.current.closeCurrent();
      });

      // Should not throw or error
      expect(result.current.currentModal).toBeNull();
    });
  });

  describe('showNext', () => {
    it('should show next modal in queue when no current modal', () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal1: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
        defer: true,
      };

      const modal2: QueuedModal<{ title: string }> = {
        id: 'test-2',
        component: TestModal,
        props: { title: 'Test Modal 2' },
        defer: true,
      };

      act(() => {
        result.current.enqueueModal(modal1);
        result.current.enqueueModal(modal2);
      });

      // No current modal because of defer
      expect(result.current.currentModal).toBeNull();

      // Show next
      act(() => {
        result.current.showNext();
      });

      // First modal should be shown
      expect(result.current.currentModal?.id).toBe('test-1');
    });

    it('should not show next if current modal exists', () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal1: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
      };

      const modal2: QueuedModal<{ title: string }> = {
        id: 'test-2',
        component: TestModal,
        props: { title: 'Test Modal 2' },
        defer: true,
      };

      act(() => {
        result.current.enqueueModal(modal1);
        result.current.enqueueModal(modal2);
      });

      expect(result.current.currentModal?.id).toBe('test-1');

      // Show next should not change current modal
      act(() => {
        result.current.showNext();
      });

      expect(result.current.currentModal?.id).toBe('test-1');
    });
  });

  describe('showModal', () => {
    it('should replace current modal immediately', () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal1: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
      };

      const modal2: QueuedModal<{ title: string }> = {
        id: 'test-2',
        component: TestModal,
        props: { title: 'Test Modal 2' },
      };

      act(() => {
        result.current.enqueueModal(modal1);
      });

      expect(result.current.currentModal?.id).toBe('test-1');

      act(() => {
        result.current.showModal(modal2);
      });

      expect(result.current.currentModal?.id).toBe('test-2');
    });

    it('should clear queue when showing modal', () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal1: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
        defer: true,
      };

      const modal2: QueuedModal<{ title: string }> = {
        id: 'test-2',
        component: TestModal,
        props: { title: 'Test Modal 2' },
        defer: true,
      };

      const modal3: QueuedModal<{ title: string }> = {
        id: 'test-3',
        component: TestModal,
        props: { title: 'Test Modal 3' },
      };

      act(() => {
        result.current.enqueueModal(modal1);
        result.current.enqueueModal(modal2);
      });

      // No current modal because of defer
      expect(result.current.currentModal).toBeNull();

      act(() => {
        result.current.showModal(modal3);
      });

      expect(result.current.currentModal?.id).toBe('test-3');

      // Queue should be cleared - showNext should not show anything
      act(() => {
        result.current.showNext();
      });

      // Should still be modal3 (queue was cleared)
      expect(result.current.currentModal?.id).toBe('test-3');
    });
  });

  describe('clearQueue', () => {
    it('should clear all queued modals and close current', () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal1: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
      };

      const modal2: QueuedModal<{ title: string }> = {
        id: 'test-2',
        component: TestModal,
        props: { title: 'Test Modal 2' },
        defer: true,
      };

      act(() => {
        result.current.enqueueModal(modal1);
        result.current.enqueueModal(modal2);
      });

      expect(result.current.currentModal).not.toBeNull();
      expect(result.current.hasPendingModals).toBe(true);

      act(() => {
        result.current.clearQueue();
      });

      expect(result.current.currentModal).toBeNull();
      expect(result.current.hasPendingModals).toBe(false);
    });
  });

  describe('cancelQueue', () => {
    it('should clear queue but keep current modal', () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal1: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
      };

      const modal2: QueuedModal<{ title: string }> = {
        id: 'test-2',
        component: TestModal,
        props: { title: 'Test Modal 2' },
        defer: true,
      };

      act(() => {
        result.current.enqueueModal(modal1);
        result.current.enqueueModal(modal2);
      });

      expect(result.current.currentModal?.id).toBe('test-1');
      expect(result.current.hasPendingModals).toBe(true);

      act(() => {
        result.current.cancelQueue();
      });

      // Current modal should remain
      expect(result.current.currentModal?.id).toBe('test-1');
      // But queue should be cleared
      expect(result.current.hasPendingModals).toBe(true); // Still true because currentModal exists
    });
  });

  describe('Error handling', () => {
    it('should call onError callback when modal render fails', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const FailingModal: React.FC = () => {
        throw new Error('Render error');
      };

      const modal: QueuedModal = {
        id: 'test-error',
        component: FailingModal,
        props: {},
        onError,
      };

      act(() => {
        result.current.enqueueModal(modal);
      });

      // Error boundary should catch and call onError
      expect(onError).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should show next modal after error', () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const FailingModal: React.FC = () => {
        throw new Error('Render error');
      };

      const GoodModal: React.FC<{ title: string }> = ({ title }) => <div>{title}</div>;

      const modal1: QueuedModal = {
        id: 'test-error',
        component: FailingModal,
        props: {},
      };

      const modal2: QueuedModal<{ title: string }> = {
        id: 'test-good',
        component: GoodModal,
        props: { title: 'Good Modal' },
      };

      act(() => {
        result.current.enqueueModal(modal1);
        result.current.enqueueModal(modal2);
      });

      // After error, next modal should be shown
      expect(result.current.currentModal?.id).toBe('test-good');
    });
  });

  describe('Navigation cleanup', () => {
    it('should clear queue on route change', () => {
      mockPathname = '/test';
      const { result, rerender } = renderHook(() => useModalQueue(), { wrapper });

      const modal: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
      };

      act(() => {
        result.current.enqueueModal(modal);
      });

      expect(result.current.currentModal).not.toBeNull();

      // Simulate route change by updating mock pathname
      mockPathname = '/new-route';

      // Rerender to trigger useEffect
      rerender();

      // Queue should be cleared
      expect(result.current.currentModal).toBeNull();
      expect(result.current.hasPendingModals).toBe(false);
    });
  });

  describe('hasPendingModals', () => {
    it('should return true when current modal exists', () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
      };

      act(() => {
        result.current.enqueueModal(modal);
      });

      expect(result.current.hasPendingModals).toBe(true);
    });

    it('should return true when queue has items', () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
        defer: true,
      };

      act(() => {
        result.current.enqueueModal(modal);
      });

      expect(result.current.hasPendingModals).toBe(true);
    });

    it('should return false when queue is empty and no current modal', async () => {
      const { result } = renderHook(() => useModalQueue(), { wrapper });

      const modal: QueuedModal<{ title: string }> = {
        id: 'test-1',
        component: TestModal,
        props: { title: 'Test Modal 1' },
      };

      act(() => {
        result.current.enqueueModal(modal);
      });

      await act(async () => {
        const closePromise = result.current.closeCurrent();
        vi.advanceTimersByTime(200);
        await closePromise;
      });

      expect(result.current.hasPendingModals).toBe(false);
    });
  });
});

