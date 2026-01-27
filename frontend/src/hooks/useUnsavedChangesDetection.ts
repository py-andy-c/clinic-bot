import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext';
import { useModal } from '../contexts/ModalContext';

interface UseUnsavedChangesDetectionProps {
  hasUnsavedChanges: () => boolean;
}

export const useUnsavedChangesDetection = ({ hasUnsavedChanges }: UseUnsavedChangesDetectionProps) => {
  const { setHasUnsavedChanges } = useUnsavedChanges();
  const { confirm } = useModal();

  // Sync the context state whenever hasUnsavedChanges changes
  useEffect(() => {
    setHasUnsavedChanges(hasUnsavedChanges());
  }, [hasUnsavedChanges, setHasUnsavedChanges]);

  // Block internal navigation (React Router)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges() && currentLocation.pathname !== nextLocation.pathname
  );

  // Handle blocked navigation
  useEffect(() => {
    if (blocker.state === 'blocked') {
      const handleBlocked = async () => {
        const confirmed = await confirm('您有未儲存的變更，確定要離開嗎？', '確認離開');
        if (confirmed) {
          blocker.proceed();
        } else {
          blocker.reset();
        }
      };
      handleBlocked();
    }
  }, [blocker, confirm]);

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
