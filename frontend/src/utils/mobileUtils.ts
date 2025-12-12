/**
 * Utility functions for mobile detection
 */

/**
 * Check if current viewport is mobile size
 * @param breakpoint - The width breakpoint in pixels (default: 768)
 * @returns boolean indicating if current viewport is mobile
 */
export function isMobileViewport(breakpoint: number = 768): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.innerWidth < breakpoint;
}

/**
 * Get current viewport width
 * @returns viewport width in pixels, or 0 if window is undefined
 */
export function getViewportWidth(): number {
  if (typeof window === 'undefined') {
    return 0;
  }
  return window.innerWidth;
}





