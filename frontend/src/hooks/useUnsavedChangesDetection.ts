import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext';

interface UseUnsavedChangesDetectionProps {
  hasUnsavedChanges: () => boolean;
}

export const useUnsavedChangesDetection = ({ hasUnsavedChanges }: UseUnsavedChangesDetectionProps) => {
  const location = useLocation();
  const { setHasUnsavedChanges } = useUnsavedChanges();

  // Update context when changes are detected
  useEffect(() => {
    setHasUnsavedChanges(hasUnsavedChanges());
  }, [hasUnsavedChanges, setHasUnsavedChanges]);

  // Warn user if they try to leave with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '您有未儲存的變更，確定要離開嗎？';
        return '您有未儲存的變更，確定要離開嗎？';
      }
      return undefined;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Block browser back/forward navigation if there are unsaved changes
  useEffect(() => {
    const handlePopState = () => {
      if (hasUnsavedChanges()) {
        const confirmed = window.confirm('您有未儲存的變更，確定要離開嗎？');
        if (!confirmed) {
          // Push the current state back to prevent navigation
          window.history.pushState(null, '', location.pathname);
        }
      }
    };

    // Block browser back/forward navigation
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [location.pathname, hasUnsavedChanges]);
};
