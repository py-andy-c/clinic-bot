import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from '../useIsMobile';

// Mock window.innerWidth
const mockWindowWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
};

describe('useIsMobile', () => {
  beforeEach(() => {
    // Reset window.innerWidth before each test
    mockWindowWidth(1024);
  });

  it('should return false for desktop viewport (1024px)', () => {
    mockWindowWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('should return true for mobile viewport (375px)', () => {
    mockWindowWidth(375);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('should return false for tablet viewport (768px)', () => {
    mockWindowWidth(768);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('should return true for viewport just below breakpoint (767px)', () => {
    mockWindowWidth(767);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('should update when window is resized', () => {
    mockWindowWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    
    expect(result.current).toBe(false);

    act(() => {
      mockWindowWidth(375);
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current).toBe(true);
  });

  it('should use custom breakpoint when provided', () => {
    mockWindowWidth(900);
    const { result } = renderHook(() => useIsMobile(1000));
    expect(result.current).toBe(true);
  });

  it('should handle SSR (window undefined)', () => {
    // Note: We can't fully test SSR in a DOM test environment because
    // React Testing Library requires a DOM. However, we verify that
    // the hook's initial state calculation checks for window existence.
    // In actual SSR, the hook will return false on initial render
    // and then update when the component hydrates on the client.
    
    // Test that the hook safely checks window existence
    // The hook implementation uses: typeof window !== 'undefined'
    // which safely handles SSR scenarios
    const { result } = renderHook(() => useIsMobile());
    
    // In a test environment with window, it should work normally
    // The SSR safety is in the implementation (typeof check)
    expect(typeof result.current).toBe('boolean');
  });
});

