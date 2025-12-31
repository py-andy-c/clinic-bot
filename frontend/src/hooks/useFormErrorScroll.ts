import { useCallback } from 'react';
import { FieldErrors, UseFormReturn } from 'react-hook-form';

/**
 * A hook that provides a standardized onInvalid handler for react-hook-form.
 * It finds the first error, optionally expands a collapsed section, scrolls to the field, and focuses it.
 */
export const useFormErrorScroll = () => {
  const onInvalid = useCallback((
    errors: FieldErrors<any>, 
    methods: UseFormReturn<any>,
    options: { expandType?: string; expandEventName?: string } = {}
  ) => {
    const { expandType, expandEventName = 'form-error-expand' } = options;

    // Helper to extract the first error message and path from RHF error object
    const findFirstError = (errs: Record<string, { message?: string; [key: string]: unknown } | undefined>, currentPath: string = ''): { path: string; message: string } | null => {
      for (const key in errs) {
        const error = errs[key];
        const newPath = currentPath ? `${currentPath}.${key}` : key;
        
        if (error?.message) {
          return { path: newPath, message: error.message };
        }
        
        if (typeof error === 'object' && error !== null) {
          const found = findFirstError(error, newPath);
          if (found) return found;
        }
      }
      return null;
    };

    const firstError = findFirstError(errors);
    
    if (firstError) {
      // 1. Expand the card if it's a nested error and an expandType is provided
      if (expandType && firstError.path.includes('.')) {
        const parts = firstError.path.split('.');
        // Assuming the index is the second part (e.g., resourceTypes.0.name)
        const indexStr = parts[1];
        if (indexStr !== undefined) {
          const index = parseInt(indexStr);
          if (!isNaN(index)) {
            window.dispatchEvent(new CustomEvent(expandEventName, { 
              detail: { type: expandType, index } 
            }));
          }
        }
      }

      // 2. Scroll and focus after expansion
      setTimeout(() => {
        const element = document.getElementById(firstError.path);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.focus({ preventScroll: true });
          
          // Force a validation check on this specific field to ensure red text shows
          methods.trigger(firstError.path as any);
        }
      }, 200);
    }
  }, []);

  return { onInvalid };
};

