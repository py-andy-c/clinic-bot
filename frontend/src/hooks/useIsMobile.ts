import { useState, useEffect } from 'react';

/**
 * Hook to detect if the current viewport is mobile size
 * @param breakpoint - The width breakpoint in pixels (default: 768)
 * @returns boolean indicating if current viewport is mobile
 */
export function useIsMobile(breakpoint: number = 768): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    // Only access window on client side
    if (typeof window === 'undefined') {
      return false;
    }
    return window.innerWidth < breakpoint;
  });

  useEffect(() => {
    // Only set up listener on client side
    if (typeof window === 'undefined') {
      return;
    }

    const handleResize = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };

    // Set initial value
    handleResize();

    // Add event listener
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [breakpoint]);

  return isMobile;
}

