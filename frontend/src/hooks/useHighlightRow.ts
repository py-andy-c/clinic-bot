import { useEffect, useRef, useState } from 'react';

/**
 * Hook for highlighting and scrolling to a row by data attribute.
 * Returns the highlighted row ID and a function to set it.
 */
export const useHighlightRow = (targetId: string | null, dataAttribute: string) => {
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const timeoutRefs = useRef<Array<NodeJS.Timeout>>([]);

  useEffect(() => {
    if (!targetId) {
      setHighlightedId(null);
      return;
    }

    // Clear any existing timeouts
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];

    // Scroll to and highlight the target row after a short delay
    const scrollTimeout = setTimeout(() => {
      const element = document.querySelector(`[${dataAttribute}="${targetId}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedId(targetId);
        
        // Remove highlight after 2 seconds
        const highlightTimeout = setTimeout(() => {
          setHighlightedId(null);
        }, 2000);
        
        timeoutRefs.current.push(highlightTimeout);
      }
    }, 100);

    timeoutRefs.current.push(scrollTimeout);

    // Cleanup function
    return () => {
      timeoutRefs.current.forEach(clearTimeout);
      timeoutRefs.current = [];
      setHighlightedId(null);
    };
  }, [targetId, dataAttribute]);

  return highlightedId;
};

