/**
 * ModalQueueContext
 * 
 * Centralized modal queue system for managing sequential modal flows.
 * Allows modals to enqueue the next modal before closing, preventing state loss.
 * 
 * Based on design doc: docs/design_doc/sequential_modal_flows.md
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode, ComponentType } from 'react';
import { useLocation } from 'react-router-dom';
import { logger } from '../utils/logger';

/**
 * Constants for modal queue timing
 */
const MODAL_CLOSE_ANIMATION_DURATION = 200; // ms - matches design doc specification
const MAX_QUEUE_SIZE = 10; // Maximum number of modals in queue to prevent memory issues

/**
 * A queued modal with its component and props
 */
export interface QueuedModal<T = Record<string, unknown>> {
  id: string;
  component: ComponentType<T>;
  props: T;
  priority?: number;
  onError?: (error: Error) => void;
  defer?: boolean; // If true, always add to queue instead of showing immediately
}

interface ModalQueueContextType {
  // Enqueue a modal to show after current one closes
  enqueueModal: <T>(modal: QueuedModal<T>) => void;
  
  // Show modal immediately (replaces current if any)
  showModal: <T>(modal: QueuedModal<T>) => void;
  
  // Close current modal and show next in queue (async for cleanup)
  closeCurrent: () => Promise<void>;
  
  // Show next modal in queue (useful when non-queue modal closes)
  showNext: () => void;
  
  // Clear all queued modals (e.g., on navigation)
  clearQueue: () => void;
  
  // Cancel entire queue from within a modal
  cancelQueue: () => void;
  
  // Get current modal
  currentModal: QueuedModal | null;
  
  // Check if queue has pending modals
  hasPendingModals: boolean;
}

const ModalQueueContext = createContext<ModalQueueContextType | undefined>(undefined);

export const useModalQueue = () => {
  const context = useContext(ModalQueueContext);
  if (context === undefined) {
    throw new Error('useModalQueue must be used within a ModalQueueProvider');
  }
  return context;
};

interface ModalQueueProviderProps {
  children: ReactNode;
}

/**
 * Error boundary component for modal rendering
 */
class ModalErrorBoundary extends React.Component<
  { children: ReactNode; onError: (error: Error) => void },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; onError: (error: Error) => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('Modal render error:', error, errorInfo);
    this.props.onError(error);
  }

  render() {
    if (this.state.hasError) {
      return null; // Don't render anything on error
    }
    return this.props.children;
  }
}

export const ModalQueueProvider: React.FC<ModalQueueProviderProps> = ({ children }) => {
  const [queue, setQueue] = useState<QueuedModal[]>([]);
  const [currentModal, setCurrentModal] = useState<QueuedModal | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const location = useLocation();
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousLocationRef = useRef(location.pathname);

  // Clear queue on navigation
  // Note: Modal queue does not create browser history entries itself.
  // History management is handled by BaseModal for full-screen modals only.
  // This prevents history pollution while maintaining proper navigation behavior.
  useEffect(() => {
    if (previousLocationRef.current !== location.pathname) {
      previousLocationRef.current = location.pathname;
      // Clear queue and close current modal on navigation
      if (currentModal) {
        setCurrentModal(null);
      }
      setQueue([]);
    }
  }, [location.pathname, currentModal]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const enqueueModal = useCallback(<T,>(modal: QueuedModal<T>) => {
    setQueue((prev) => {
      // Safety check: prevent queue from growing too large
      if (prev.length >= MAX_QUEUE_SIZE) {
        logger.warn(`Modal queue size limit (${MAX_QUEUE_SIZE}) reached. Dropping oldest queued modal.`);
        // Remove oldest and add new one
        const [, ...rest] = prev;
        if (modal.defer) {
          return [...rest, modal as QueuedModal];
        }
        // If not deferring and no current modal, show immediately
        if (!currentModal) {
          setCurrentModal(modal as QueuedModal);
          return rest;
        }
        return [...rest, modal as QueuedModal];
      }
      
      // If defer is true, always add to queue
      if (modal.defer) {
        return [...prev, modal as QueuedModal];
      }
      // If there's no current modal, show this one immediately
      if (!currentModal) {
        setCurrentModal(modal as QueuedModal);
        return prev;
      }
      // Otherwise, add to queue
      return [...prev, modal as QueuedModal];
    });
  }, [currentModal]);

  const showModal = useCallback(<T,>(modal: QueuedModal<T>) => {
    // Replace current modal immediately
    setCurrentModal(modal as QueuedModal);
    // Clear queue (or optionally keep it - design decision)
    setQueue([]);
  }, []);

  const closeCurrent = useCallback(async (): Promise<void> => {
    if (!currentModal || isClosing) {
      return;
    }

    setIsClosing(true);

    // Wait for animation/cleanup (matches design doc: 200ms fade-out)
    await new Promise<void>((resolve) => {
      closeTimeoutRef.current = setTimeout(() => {
        resolve();
      }, MODAL_CLOSE_ANIMATION_DURATION);
    });

    // Remove current modal
    setCurrentModal(null);
    setIsClosing(false);

    // Show next modal in queue
    setQueue((prev) => {
      if (prev.length > 0) {
        const [next, ...rest] = prev;
        if (next) {
          setCurrentModal(next);
        }
        return rest;
      }
      return prev;
    });
  }, [currentModal, isClosing]);

  const clearQueue = useCallback(() => {
    setQueue([]);
    if (currentModal) {
      setCurrentModal(null);
    }
  }, [currentModal]);

  const cancelQueue = useCallback(() => {
    setQueue([]);
    // Don't close current modal, let it handle its own close
  }, []);

  const showNext = useCallback(() => {
      // Show next modal in queue if no current modal
      if (!currentModal) {
        setQueue((prev) => {
          if (prev.length > 0) {
            const [next, ...rest] = prev;
            if (next) {
              setCurrentModal(next);
            }
            return rest;
          }
          return prev;
        });
      }
  }, [currentModal]);

  const handleModalError = useCallback((error: Error) => {
    logger.error('Modal render error in queue:', error);
    // Call onError callback if provided
    if (currentModal?.onError) {
      currentModal.onError(error);
    }
    // Remove failed modal from queue
    if (currentModal) {
      setCurrentModal(null);
    }
    // Show next modal if available
    setQueue((prev) => {
      if (prev.length > 0) {
        const [next, ...rest] = prev;
        if (next) {
          setCurrentModal(next);
        }
        return rest;
      }
      return prev;
    });
  }, [currentModal]);

  // ARIA live region for modal transitions
  const [announcement, setAnnouncement] = useState<string>('');

  // Announce modal transitions
  useEffect(() => {
    if (currentModal) {
      // Try to extract modal title from props (components can pass aria-label)
      const props = currentModal.props as { 'aria-label'?: string; ariaLabel?: string; [key: string]: unknown };
      const modalTitle = props['aria-label'] || props.ariaLabel || 'Modal';
      setAnnouncement(`${modalTitle} opened`);
    } else {
      setAnnouncement('Modal closed');
    }
  }, [currentModal]);

  // Render current modal
  // Note: Focus management is handled by BaseModal (tabIndex={-1} for focus trapping)
  // Individual modal components should use autoFocus on primary action buttons
  const renderCurrentModal = () => {
    if (!currentModal) {
      return null;
    }

    const { component: Component, props, onError } = currentModal;

    return (
      <ModalErrorBoundary onError={onError || handleModalError}>
        <Component {...props} />
      </ModalErrorBoundary>
    );
  };

  const value: ModalQueueContextType = {
    enqueueModal,
    showModal,
    closeCurrent,
    showNext,
    clearQueue,
    cancelQueue,
    currentModal,
    hasPendingModals: queue.length > 0 || currentModal !== null,
  };

  return (
    <ModalQueueContext.Provider value={value}>
      {children}
      {renderCurrentModal()}
      {/* ARIA live region for screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>
    </ModalQueueContext.Provider>
  );
};

