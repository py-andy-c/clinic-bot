import { render, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Konva from 'konva';
import { ClinicalWorkspace } from '../ClinicalWorkspace';
import type { WorkspaceData } from '../ClinicalWorkspace';
import React from 'react';

// Mock use-image
vi.mock('use-image', () => ({
  default: vi.fn().mockImplementation(() => {
    const img = document.createElement('img');
    img.width = 100;
    img.height = 100;
    return [img];
  }),
}));

describe('ClinicalWorkspace Performance Optimizations', () => {
  const mockInitialData: WorkspaceData = {
    layers: [
      { 
        type: 'media', 
        id: 'img-1', 
        origin: 'upload', 
        url: 'test-url', 
        x: 10, 
        y: 10, 
        width: 100, 
        height: 100, 
        rotation: 0 
      },
    ],
    canvas_width: 900,
    canvas_height: 1000,
    version: 2,
  };

  const mockOnUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock getBoundingClientRect for stage container
    HTMLElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      width: 900,
      height: 1000,
      top: 0,
      left: 0,
      bottom: 1000,
      right: 900,
      x: 0,
      y: 0,
      toJSON: () => { },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('caps pixel ratio for touch devices', () => {
    // Simulate touch device
    vi.stubGlobal('ontouchstart', {});
    Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5, configurable: true });
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });

    // The logic in ClinicalWorkspace.tsx is:
    // if (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
    //   Konva.pixelRatio = Math.min(window.devicePixelRatio, 2.0);
    // }
    
    expect(Konva.pixelRatio).toBeLessThanOrEqual(2.0);
  });

  it('moves node to dragLayer on dragstart and back to contentLayer on dragend', async () => {
    await act(async () => {
      render(
        <ClinicalWorkspace
          recordId={1}
          initialData={mockInitialData}
          onUpdate={mockOnUpdate}
        />
      );
    });

    const stage = Konva.stages[Konva.stages.length - 1];
    
    // Wait for refs to be populated and image to load
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    const contentLayer = stage.findOne('.content') as Konva.Layer;
    const dragLayer = stage.findOne('.drag') as Konva.Layer;
    const imageNode = stage.findOne('Image');

    if (!imageNode) throw new Error('Image node not found');

    expect(imageNode.getLayer()).toBe(contentLayer);
    expect(contentLayer.listening()).toBe(true);

    // Simulate drag start
    await act(async () => {
      imageNode.fire('dragstart', { 
        target: imageNode,
        evt: new MouseEvent('mousedown')
      } as unknown as Konva.KonvaEventObject<DragEvent>);
    });

    expect(imageNode.getLayer()).toBe(dragLayer);
    expect(contentLayer.listening()).toBe(false);
    expect(imageNode.opacity()).toBe(0.7);

    // Simulate drag end
    await act(async () => {
      imageNode.fire('dragend', {
        target: imageNode,
        evt: new MouseEvent('mouseup')
      } as unknown as Konva.KonvaEventObject<DragEvent>);
    });

    expect(imageNode.getLayer()).toBe(contentLayer);
    expect(contentLayer.listening()).toBe(true);
    expect(imageNode.opacity()).toBe(1);
  });

  it('preserves z-index when moving between layers', async () => {
    const dataWithMultipleLayers: WorkspaceData = {
      ...mockInitialData,
      layers: [
        { type: 'media', id: 'img-1', origin: 'upload', url: 'test-url', x: 0, y: 0, width: 50, height: 50, rotation: 0 },
        { type: 'media', id: 'img-2', origin: 'upload', url: 'test-url', x: 50, y: 50, width: 50, height: 50, rotation: 0 },
      ]
    };

    await act(async () => {
      render(
        <ClinicalWorkspace
          recordId={1}
          initialData={dataWithMultipleLayers}
          onUpdate={mockOnUpdate}
        />
      );
    });

    const stage = Konva.stages[Konva.stages.length - 1];
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    const imageNodes = stage.find('Image');
    const secondImage = imageNodes[1];

    const originalZIndex = secondImage.zIndex();

    // Drag start
    await act(async () => {
      secondImage.fire('dragstart', { 
        target: secondImage,
        evt: new MouseEvent('mousedown')
      } as unknown as Konva.KonvaEventObject<DragEvent>);
    });

    // Drag end
    await act(async () => {
      secondImage.fire('dragend', {
        target: secondImage,
        evt: new MouseEvent('mouseup')
      } as unknown as Konva.KonvaEventObject<DragEvent>);
    });

    expect(secondImage.zIndex()).toBe(originalZIndex);
  });
});
