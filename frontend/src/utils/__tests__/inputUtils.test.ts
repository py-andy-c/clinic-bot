/**
 * Unit tests for input utility functions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { preventScrollWheelChange } from '../inputUtils';
import React from 'react';

describe('preventScrollWheelChange', () => {
  let mockInput: HTMLInputElement;
  let mockWheelEvent: React.WheelEvent<HTMLInputElement>;

  beforeEach(() => {
    // Create a mock input element
    mockInput = document.createElement('input');
    mockInput.type = 'number';
    mockInput.blur = vi.fn();

    // Create a mock wheel event
    mockWheelEvent = {
      currentTarget: mockInput,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.WheelEvent<HTMLInputElement>;

    // Reset document.activeElement mock
    Object.defineProperty(document, 'activeElement', {
      value: null,
      writable: true,
      configurable: true,
    });
  });

  it('should blur input when it is focused and wheel event occurs', () => {
    // Set the input as the active element (focused)
    Object.defineProperty(document, 'activeElement', {
      value: mockInput,
      writable: true,
      configurable: true,
    });

    // Call the function
    preventScrollWheelChange(mockWheelEvent);

    // Verify blur was called
    expect(mockInput.blur).toHaveBeenCalledTimes(1);
  });

  it('should not blur input when it is not focused', () => {
    // Set a different element as active (input is not focused)
    const otherElement = document.createElement('div');
    Object.defineProperty(document, 'activeElement', {
      value: otherElement,
      writable: true,
      configurable: true,
    });

    // Call the function
    preventScrollWheelChange(mockWheelEvent);

    // Verify blur was NOT called
    expect(mockInput.blur).not.toHaveBeenCalled();
  });

  it('should not blur input when activeElement is null', () => {
    // Set activeElement to null (no element focused)
    Object.defineProperty(document, 'activeElement', {
      value: null,
      writable: true,
      configurable: true,
    });

    // Call the function
    preventScrollWheelChange(mockWheelEvent);

    // Verify blur was NOT called
    expect(mockInput.blur).not.toHaveBeenCalled();
  });

  it('should handle case where currentTarget is different from activeElement', () => {
    // Set a different element as active
    const otherInput = document.createElement('input');
    Object.defineProperty(document, 'activeElement', {
      value: otherInput,
      writable: true,
      configurable: true,
    });

    // Call the function
    preventScrollWheelChange(mockWheelEvent);

    // Verify blur was NOT called on the event's currentTarget
    expect(mockInput.blur).not.toHaveBeenCalled();
  });

  it('should work with number input type', () => {
    mockInput.type = 'number';
    Object.defineProperty(document, 'activeElement', {
      value: mockInput,
      writable: true,
      configurable: true,
    });

    preventScrollWheelChange(mockWheelEvent);

    expect(mockInput.blur).toHaveBeenCalledTimes(1);
  });

  it('should handle multiple rapid wheel events', () => {
    Object.defineProperty(document, 'activeElement', {
      value: mockInput,
      writable: true,
      configurable: true,
    });

    // Simulate multiple wheel events
    preventScrollWheelChange(mockWheelEvent);
    preventScrollWheelChange(mockWheelEvent);
    preventScrollWheelChange(mockWheelEvent);

    // Each event should blur (though after first blur, activeElement changes)
    // But the function checks activeElement each time, so it should still work
    expect(mockInput.blur).toHaveBeenCalled();
  });
});

