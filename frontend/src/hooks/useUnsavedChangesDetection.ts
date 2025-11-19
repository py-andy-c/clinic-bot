import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext';
import { useModal } from '../contexts/ModalContext';

interface UseUnsavedChangesDetectionProps {
  hasUnsavedChanges: () => boolean;
}

export const useUnsavedChangesDetection = ({ hasUnsavedChanges }: UseUnsavedChangesDetectionProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { setHasUnsavedChanges } = useUnsavedChanges();
  const { confirm } = useModal();
  
  // Track the previous pathname to know where we're navigating from
  const prevPathRef = useRef<string>(location.pathname);

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
    const handlePopState = async () => {
      if (hasUnsavedChanges()) {
        // When popstate fires, the browser has already navigated
        // window.location.pathname is the NEW path (where we're trying to go)
        // prevPathRef.current is the OLD path (where we're coming from)
        const targetPath = window.location.pathname;
        const currentPath = prevPathRef.current;
        
        // Prevent navigation by pushing state back to the current path immediately
        window.history.pushState(null, '', currentPath);
        
        // Show modal confirmation
        const confirmed = await confirm('您有未儲存的變更，確定要離開嗎？', '確認離開');
        if (confirmed) {
          // User confirmed, navigate to the target path
          navigate(targetPath);
        }
        // If not confirmed, we've already pushed the state back, so navigation is blocked
      } else {
        // No unsaved changes, allow navigation and update the ref
        prevPathRef.current = window.location.pathname;
      }
    };

    // Block browser back/forward navigation
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [hasUnsavedChanges, confirm, navigate]);

  // Update the ref when location changes (but not from popstate)
  // This tracks the "current" path for when popstate fires
  useEffect(() => {
    prevPathRef.current = location.pathname;
  }, [location.pathname]);
};
