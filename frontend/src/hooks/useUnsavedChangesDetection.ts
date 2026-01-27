import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext';
import { useModal } from '../contexts/ModalContext';

interface UseUnsavedChangesDetectionProps {
  hasUnsavedChanges: () => boolean;
}

export const useUnsavedChangesDetection = ({ hasUnsavedChanges }: UseUnsavedChangesDetectionProps) => {
  const { setHasUnsavedChanges } = useUnsavedChanges();
  const { confirm } = useModal();

  const hasChanges = hasUnsavedChanges();

  // Sync the context state whenever hasUnsavedChanges result changes
  useEffect(() => {
    setHasUnsavedChanges(hasChanges);

    // Reset on unmount
    return () => {
      setHasUnsavedChanges(false);
    };
  }, [hasChanges, setHasUnsavedChanges]);

  // Block internal navigation (React Router)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges() && currentLocation.pathname !== nextLocation.pathname
  );

  // Track if we're currently showing the block confirmation modal
  const isHandlingBlockRef = useRef(false);

  // Handle blocked navigation
  useEffect(() => {
    if (blocker.state === 'blocked' && !isHandlingBlockRef.current) {
      const handleBlocked = async () => {
        isHandlingBlockRef.current = true;
        try {
          const confirmed = await confirm('您有未儲存的變更，確定要離開嗎？', '確認離開');
          if (confirmed) {
            blocker.proceed();
          } else {
            blocker.reset();
          }
        } finally {
          isHandlingBlockRef.current = false;
        }
      };
      handleBlocked();
    }
  }, [blocker.state, blocker.proceed, blocker.reset, confirm]);

  // Block external navigation (Browser refresh, close tab)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        // Modern browsers ignore the custom string and show their own UI
        e.returnValue = '您有未儲存的變更，確定要離開嗎？';
        return '您有未儲存的變更，確定要離開嗎？';
      }
      return undefined;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);
};
