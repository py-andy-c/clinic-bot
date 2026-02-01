import React, { useRef, useEffect, useState, useCallback, useContext } from 'react';
import { Stage, Layer, Line, Image as KonvaImage, Transformer, Text as KonvaText, Rect, Arrow, Ellipse, Circle, Group } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import imageCompression from 'browser-image-compression';
import type { WorkspaceData, DrawingPath, MediaLayer, TextLayer, ShapeLayer, LoadingLayer, DrawingTool } from '../../types';
export type { WorkspaceData, DrawingPath, MediaLayer, TextLayer, ShapeLayer, LoadingLayer, DrawingTool };
import { logger } from '../../utils/logger';
import { apiService } from '../../services/api';
import { SyncStatus, SyncStatusType } from './SyncStatus';

// Performance Optimization: Cap Pixel Ratio for Touch Devices
if (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
  Konva.pixelRatio = Math.min(window.devicePixelRatio, 2.0);
}

// Polyfill for Konva.Stage to get relative pointer position
// This handles scale and offsets for logical coordinate mapping
Konva.Stage.prototype.getRelativePointerPosition = function (this: Konva.Stage) {
  const pointer = this.getPointerPosition();
  if (!pointer) return null;
  const transform = this.getAbsoluteTransform().copy();
  transform.invert();
  return transform.point(pointer);
};

declare module 'konva' {
  interface Stage {
    getRelativePointerPosition(): { x: number; y: number } | null;
  }
}

// Context for performance-optimized drag layers
export const WorkspaceContext = React.createContext<{
  dragLayerRef: React.RefObject<Konva.Layer>;
  contentLayerRef: React.RefObject<Konva.Layer>;
}>({
  dragLayerRef: { current: null },
  contentLayerRef: { current: null },
});

interface ClinicalWorkspaceProps {
  recordId: number;
  initialData: WorkspaceData;
  onUpdate: (data: WorkspaceData) => void;
  syncStatus?: SyncStatusType;
}
const TOOL_CONFIG = {
  pen: { color: '#000000', width: 2 },
  highlighter: { color: 'rgba(255, 255, 0, 0.3)', width: 20 },
  eraser: { color: '#ffffff', width: 20 },
  select: { color: '#3b82f6', width: 1 },
  text: { color: '#000000', width: 1, fontSize: 20 },
  rectangle: { color: '#000000', width: 2 },
  circle: { color: '#000000', width: 2 },
  arrow: { color: '#000000', width: 2 },
};

const CANVAS_WIDTH = 900; // Single unified width
const MIN_CANVAS_HEIGHT = 1100;
const WORKSPACE_VERSION = 2;
// const SCALE = 1; // 1:1 logical to visual // Unused

/**
 * Shared logic for clamping transformations (resizing) to canvas boundaries.
 * This handles resetting scale to 1 and adjusting width/height manually.
 * 
 * NOTE: This function works well for CORNER anchors where both edges can move.
 * For SIDE anchors (middle-left, middle-right, etc.), use handleSideAnchorTransform
 * to avoid position drift issues.
 */
const handleTransformClamping = (
  node: Konva.Node,
  dragLimits: { minX: number; maxX: number; minY: number; maxY: number },
  options: {
    isCenter?: boolean;
    onlyWidth?: boolean;
    minWidth?: number;
    minHeight?: number;
  } = {}
) => {
  const { isCenter = false, onlyWidth = false, minWidth = 5, minHeight = 5 } = options;
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();

  // Reset scale immediately to keep logic simple and consistent
  node.setAttrs({
    scaleX: 1,
    scaleY: 1,
  });

  let newWidth = Math.max(minWidth, node.width() * scaleX);
  let newHeight = Math.max(minHeight, (node.height() ?? 0) * scaleY);
  let newX = node.x();
  let newY = node.y();

  const halfWidth = isCenter ? newWidth / 2 : 0;
  const halfHeight = isCenter ? newHeight / 2 : 0;

  // Left boundary
  const left = isCenter ? newX - halfWidth : newX;
  if (left < dragLimits.minX) {
    const diff = dragLimits.minX - left;
    newX = isCenter ? dragLimits.minX + halfWidth : dragLimits.minX;
    newWidth = Math.max(minWidth, newWidth - diff);
  }

  // Top boundary
  const top = isCenter ? newY - halfHeight : newY;
  if (top < dragLimits.minY) {
    const diff = dragLimits.minY - top;
    newY = isCenter ? dragLimits.minY + halfHeight : dragLimits.minY;
    newHeight = Math.max(minHeight, newHeight - diff);
  }

  // Right boundary
  const right = isCenter ? newX + halfWidth : newX + newWidth;
  if (right > dragLimits.maxX) {
    newWidth = Math.max(minWidth, newWidth - (right - dragLimits.maxX));
    if (isCenter) newX = dragLimits.maxX - newWidth / 2;
  }

  // Bottom boundary
  const bottom = isCenter ? newY + halfHeight : newY + newHeight;
  if (bottom > dragLimits.maxY) {
    newHeight = Math.max(minHeight, newHeight - (bottom - dragLimits.maxY));
    if (isCenter) newY = dragLimits.maxY - newHeight / 2;
  }

  node.setAttrs({
    x: newX,
    y: newY,
    width: newWidth,
    ...(onlyWidth ? {} : { height: newHeight }),
  });
};

/**
 * Handles side anchor (middle-left, middle-right, top-center, bottom-center) transforms
 * using pointer position directly.
 * 
 * BACKGROUND: Konva's Transformer calculates scale values relative to the current node
 * dimensions. When we modify the node during onTransform and Konva recalculates scale,
 * it creates a feedback loop that causes position drift and flaky behavior.
 * 
 * SOLUTION: Instead of using Konva's scale values, we use the pointer position directly
 * to calculate where the dragged edge should be. This ensures:
 * - The opposite edge stays completely fixed
 * - The dragged edge follows the cursor exactly
 * - No feedback loop or position drift
 */
const handleSideAnchorTransform = (
  node: Konva.Node,
  stage: Konva.Stage,
  activeAnchor: string,
  startState: { x: number; y: number; width: number; height: number },
  dragLimits: { minX: number; maxX: number; minY: number; maxY: number },
  options: { isCenter?: boolean; minWidth?: number; minHeight?: number } = {}
): boolean => {
  const { isCenter = false, minWidth = 5, minHeight = 5 } = options;

  // Get pointer position in stage (logical) coordinates
  const pointerPos = stage.getRelativePointerPosition();
  if (!pointerPos) return false;

  // Reset scale immediately
  node.setAttrs({ scaleX: 1, scaleY: 1 });

  // Calculate coordinates of the edges at start
  const startLeft = isCenter ? startState.x - startState.width / 2 : startState.x;
  const startRight = isCenter ? startState.x + startState.width / 2 : startState.x + startState.width;
  const startTop = isCenter ? startState.y - startState.height / 2 : startState.y;
  const startBottom = isCenter ? startState.y + startState.height / 2 : startState.y + startState.height;

  let newX = startState.x;
  let newY = startState.y;
  let newWidth = startState.width;
  let newHeight = startState.height;

  switch (activeAnchor) {
    case 'middle-right': {
      // Right anchor: left edge stays fixed
      const desiredRightEdge = pointerPos.x;
      const clampedRightEdge = Math.min(dragLimits.maxX, Math.max(startLeft + minWidth, desiredRightEdge));
      newWidth = clampedRightEdge - startLeft;
      // For non-center: x is the left edge. For center: x is center
      newX = isCenter ? startLeft + newWidth / 2 : startLeft;
      break;
    }

    case 'middle-left': {
      // Left anchor: right edge stays fixed
      const desiredLeftEdge = pointerPos.x;
      const clampedLeftEdge = Math.max(dragLimits.minX, Math.min(startRight - minWidth, desiredLeftEdge));
      newWidth = startRight - clampedLeftEdge;
      newX = isCenter ? clampedLeftEdge + newWidth / 2 : clampedLeftEdge;
      break;
    }

    case 'bottom-center': {
      // Bottom anchor: top edge stays fixed
      const desiredBottomEdge = pointerPos.y;
      const clampedBottomEdge = Math.min(dragLimits.maxY, Math.max(startTop + minHeight, desiredBottomEdge));
      newHeight = clampedBottomEdge - startTop;
      newY = isCenter ? startTop + newHeight / 2 : startTop;
      break;
    }

    case 'top-center': {
      // Top anchor: bottom edge stays fixed
      const desiredTopEdge = pointerPos.y;
      const clampedTopEdge = Math.max(dragLimits.minY, Math.min(startBottom - minHeight, desiredTopEdge));
      newHeight = startBottom - clampedTopEdge;
      newY = isCenter ? clampedTopEdge + newHeight / 2 : clampedTopEdge;
      break;
    }

    default:
      return false; // Not a side anchor
  }

  node.setAttrs({
    x: newX,
    y: newY,
    width: newWidth,
    height: newHeight,
  });

  return true;
};


// Helper component for loading images
const UrlImage = ({ layer, isSelected, onSelect, onChange, dragLimits, isSelectToolActive }: {
  layer: MediaLayer;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: Partial<MediaLayer>) => void;
  dragLimits: { minX: number; maxX: number; minY: number; maxY: number };
  isSelectToolActive: boolean;
}) => {
  const [image] = useImage(layer.url, 'anonymous');
  const shapeRef = useRef<Konva.Image>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const { dragLayerRef, contentLayerRef } = useContext(WorkspaceContext);
  const indexRef = useRef<number>(0);

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    const dragLayer = dragLayerRef.current;
    const contentLayer = contentLayerRef.current;

    if (dragLayer && contentLayer) {
      const node = e.target as Konva.Node;
      indexRef.current = node.zIndex();
      node.opacity(0.7); // Imperative opacity
      node.moveTo(dragLayer);
      
      // Ensure Transformer is attached and rendered before moving
      if (trRef.current) {
        trRef.current.nodes([node]);
        trRef.current.moveTo(dragLayer);
      }
      
      contentLayer.listening(false);
    }
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target as Konva.Node;
    const dragLayer = dragLayerRef.current;
    const contentLayer = contentLayerRef.current;

    if (dragLayer && contentLayer) {
      node.opacity(1); // Restore opacity
      node.moveTo(contentLayer);
      node.zIndex(indexRef.current);
      trRef.current?.moveTo(contentLayer);
      contentLayer.listening(true);
    }

    onChange({
      x: e.target.x(),
      y: e.target.y(),
    });
  };

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const handleMouseEnter = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = isSelectToolActive ? 'move' : 'pointer';
  };

  const handleMouseLeave = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = 'default';
  };

  return (
    <>
      <KonvaImage
        id={layer.id}
        image={image}
        x={layer.x}
        y={layer.y}
        width={layer.width}
        height={layer.height}
        rotation={layer.rotation}
        opacity={1}
        draggable={isSelectToolActive}
        onClick={onSelect}
        onTap={onSelect}
        onMouseDown={onSelect}
        onTouchStart={onSelect}
        ref={shapeRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onDragStart={handleDragStart}
        onDragMove={(e) => {
          const node = e.target as Konva.Node;
          const x = Math.max(dragLimits.minX, Math.min(dragLimits.maxX - node.width() * node.scaleX(), node.x()));
          const y = Math.max(dragLimits.minY, Math.min(dragLimits.maxY - node.height() * node.scaleY(), node.y()));
          node.x(x);
          node.y(y);
        }}
        onDragEnd={handleDragEnd}
        onTransformStart={() => {
          if (shapeRef.current) shapeRef.current.opacity(0.7);
        }}
        onTransform={(e) => {
          handleTransformClamping(e.target, dragLimits);
        }}
        onTransformEnd={() => {
          const node = shapeRef.current;
          if (!node) return;
          node.opacity(1);
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();

          // Reset scale and update width/height
          node.scaleX(1);
          node.scaleY(1);

          onChange({
            x: node.x(),
            y: node.y(),
            width: Math.max(5, node.width() * scaleX),
            height: Math.max(5, node.height() * scaleY),
            rotation: node.rotation(),
          });
        }}
      />
      {isSelected && (
        <Transformer
          ref={trRef}
          rotateEnabled={true}
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
          anchorSize={8}
          padding={5}
          boundBoxFunc={(_oldBox, newBox) => {
            // Limit resize minimums
            if (newBox.width < 5 || newBox.height < 5) {
              return _oldBox;
            }
            return newBox;
          }}
        />
      )}
    </>
  );
};

// Selectable Drawing Component
const SelectableLine = ({ layer, isSelected, onSelect, onChange, calculateBoundingBox, dragLimits, isSelectToolActive }: {
  layer: DrawingPath;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: Partial<DrawingPath>) => void;
  calculateBoundingBox: (points: [number, number, number?][]) => { minX: number; maxX: number; minY: number; maxY: number } | undefined;
  dragLimits: { minX: number; maxX: number; minY: number; maxY: number };
  isSelectToolActive: boolean;
}) => {
  const shapeRef = useRef<Konva.Line>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const { dragLayerRef, contentLayerRef } = useContext(WorkspaceContext);
  const indexRef = useRef<number>(0);

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    const dragLayer = dragLayerRef.current;
    const contentLayer = contentLayerRef.current;

    if (dragLayer && contentLayer) {
      const node = e.target as Konva.Node;
      indexRef.current = node.zIndex();
      node.opacity(0.7);
      node.moveTo(dragLayer);
      
      // Ensure Transformer is attached and rendered before moving
      if (trRef.current) {
        trRef.current.nodes([node]);
        trRef.current.moveTo(dragLayer);
      }
      
      contentLayer.listening(false);
    }
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target as Konva.Node;
    const dragLayer = dragLayerRef.current;
    const contentLayer = contentLayerRef.current;

    if (dragLayer && contentLayer) {
      node.opacity(1);
      node.moveTo(contentLayer);
      node.zIndex(indexRef.current);
      trRef.current?.moveTo(contentLayer);
      contentLayer.listening(true);
    }

    const newPoints = layer.points.map(p => [
      p[0] + node.x(),
      p[1] + node.y(),
      p[2]
    ] as [number, number, number?]);

    // Reset node position after updating points
    node.x(0);
    node.y(0);

    onChange({
      points: newPoints,
      boundingBox: calculateBoundingBox(newPoints)
    });
  };

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, layer]); // Re-bind if layer changes (points updated)

  const handleTransformEnd = () => {
    const node = shapeRef.current;
    if (!node) return;

    const transform = node.getTransform();
    const points = node.points();

    const newPoints: [number, number, number?][] = [];
    for (let i = 0; i < points.length; i += 2) {
      const p = transform.point({ x: points[i] ?? 0, y: points[i + 1] ?? 0 });
      const originalP = layer.points[Math.floor(i / 2)];
      const point: [number, number, number?] = originalP && originalP[2] !== undefined
        ? [p.x, p.y, originalP[2]]
        : [p.x, p.y];
      newPoints.push(point);
    }

    // Reset node properties
    node.setAttrs({
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    });

    onChange({
      points: newPoints,
      boundingBox: calculateBoundingBox(newPoints),
    });
  };

  const handleMouseEnter = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = isSelectToolActive ? 'move' : 'pointer';
  };

  const handleMouseLeave = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = 'default';
  };

  return (
    <>
      <Line
        id={layer.id}
        ref={shapeRef}
        x={0}
        y={0}
        points={layer.points.flatMap(p => [p[0], p[1]])}
        stroke={layer.color}
        strokeWidth={layer.width}
        hitStrokeWidth={Math.max(25, layer.width)}
        tension={0.5}
        lineCap="round"
        lineJoin="round"
        draggable={isSelectToolActive}
        onClick={onSelect}
        onTap={onSelect}
        onMouseDown={onSelect}
        onTouchStart={onSelect}
        perfectDrawEnabled={false}
        globalCompositeOperation={
          layer.tool === 'highlighter' ? 'multiply' : 'source-over'
        }
        onDragStart={handleDragStart}
        onDragMove={(e) => {
          const node = e.target;
          const bbox = layer.boundingBox || { minX: 0, maxX: 0, minY: 0, maxY: 0 };

          const x = Math.max(dragLimits.minX - bbox.minX, Math.min(dragLimits.maxX - bbox.maxX, node.x()));
          const y = Math.max(dragLimits.minY - bbox.minY, Math.min(dragLimits.maxY - bbox.maxY, node.y()));
          node.x(x);
          node.y(y);
        }}
        onDragEnd={handleDragEnd}
        onTransform={(e) => {
          const node = e.target as Konva.Line;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();

          // Reset scale immediately to keep stroke width constant
          node.setAttrs({
            scaleX: 1,
            scaleY: 1,
          });

          // Update points
          const points = node.points();
          const newPoints = [];
          for (let i = 0; i < points.length; i += 2) {
            newPoints.push((points[i] ?? 0) * scaleX);
            newPoints.push((points[i + 1] ?? 0) * scaleY);
          }
          node.points(newPoints);

          // Calculate bounding box of transformed points
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (let i = 0; i < newPoints.length; i += 2) {
            const px = newPoints[i] ?? 0;
            const py = newPoints[i + 1] ?? 0;
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }

          let nx = node.x();
          let ny = node.y();

          // Clamp position based on bounding box
          if (nx + minX < dragLimits.minX) nx = dragLimits.minX - minX;
          if (ny + minY < dragLimits.minY) ny = dragLimits.minY - minY;
          if (nx + maxX > dragLimits.maxX) nx = dragLimits.maxX - maxX;
          if (ny + maxY > dragLimits.maxY) ny = dragLimits.maxY - maxY;

          node.x(nx);
          node.y(ny);
        }}
        onTransformEnd={handleTransformEnd}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />
      {isSelected && (
        <Transformer
          ref={trRef}
          rotateEnabled={true}
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
          anchorSize={8}
          padding={5}
        />
      )}
    </>
  );
};

// Selectable Text Component
const SelectableText = ({ layer, isSelected, onSelect, onChange, onDelete, dragLimits, isSelectToolActive }: {
  layer: TextLayer;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: Partial<TextLayer>) => void;
  onDelete: () => void;
  dragLimits: { minX: number; maxX: number; minY: number; maxY: number };
  isSelectToolActive: boolean;
}) => {
  const shapeRef = useRef<Konva.Text>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { dragLayerRef, contentLayerRef } = useContext(WorkspaceContext);
  const indexRef = useRef<number>(0);

  // Track transform state for side anchor handling
  const activeAnchorRef = useRef<string | null>(null);
  const transformStartStateRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    const dragLayer = dragLayerRef.current;
    const contentLayer = contentLayerRef.current;

    if (dragLayer && contentLayer) {
      const node = e.target as Konva.Node;
      indexRef.current = node.zIndex();
      node.opacity(0.7);
      node.moveTo(dragLayer);
      
      // Ensure Transformer is attached and rendered before moving
      if (trRef.current) {
        trRef.current.nodes([node]);
        trRef.current.moveTo(dragLayer);
      }
      
      contentLayer.listening(false);
    }
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target as Konva.Node;
    const dragLayer = dragLayerRef.current;
    const contentLayer = contentLayerRef.current;

    if (dragLayer && contentLayer) {
      node.opacity(1);
      node.moveTo(contentLayer);
      node.zIndex(indexRef.current);
      trRef.current?.moveTo(contentLayer);
      contentLayer.listening(true);
    }

    onChange({
      x: e.target.x(),
      y: e.target.y(),
    });
  };

  useEffect(() => {
    return () => {
      if (textareaRef.current) {
        try {
          textareaRef.current.remove();
        } catch (e) {
          // Element might already be removed
        }
        textareaRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (layer.text === '' && isSelected) {
      handleDblClick();
    }
  }, [layer.text, isSelected]);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const handleDblClick = () => {
    if (textareaRef.current) return;
    const textNode = shapeRef.current;
    if (!textNode) return;

    // Create textarea to edit text
    const stage = textNode.getStage();
    if (!stage) return;

    const textPosition = textNode.getAbsolutePosition();
    const stageBox = stage.container().getBoundingClientRect();

    const areaPosition = {
      x: stageBox.left + window.scrollX + textPosition.x,
      y: stageBox.top + window.scrollY + textPosition.y,
    };

    const textarea = document.createElement('textarea');
    textareaRef.current = textarea;
    document.body.appendChild(textarea);

    const initialValue = textNode.text();
    textarea.value = initialValue;
    textarea.style.position = 'absolute';
    textarea.style.top = areaPosition.y + 'px';
    textarea.style.left = areaPosition.x + 'px';
    textarea.style.fontSize = textNode.fontSize() * stage.scaleX() + 'px';
    textarea.style.border = 'none';
    textarea.style.padding = '0px';
    textarea.style.margin = '0px';
    textarea.style.overflow = 'hidden';
    textarea.style.background = 'none';
    textarea.style.outline = 'none';
    textarea.style.resize = 'none';
    textarea.style.lineHeight = textNode.lineHeight().toString();
    textarea.style.fontFamily = textNode.fontFamily();
    textarea.style.transformOrigin = 'left top';
    textarea.style.textAlign = textNode.align();
    textarea.style.color = typeof textNode.fill() === 'string' ? (textNode.fill() as string) : 'black';
    textarea.style.transform = `rotate(${textNode.rotation()}deg)`;

    const isAutoWidth = !layer.width;

    textarea.style.whiteSpace = 'pre-wrap';
    textarea.style.wordBreak = 'break-word';

    if (isAutoWidth) {
      textarea.style.width = 'auto';
      textarea.style.minWidth = '50px';
    } else {
      textarea.style.width = textNode.width() * stage.scaleX() + 'px';
    }

    // Auto-grow logic
    const updateSize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';

      if (isAutoWidth) {
        // For horizontal auto-grow
        textarea.style.width = '0px'; // Collapse to measure
        const newWidth = Math.max(textarea.scrollWidth, 50);
        textarea.style.width = newWidth + 'px';
      }

      // Update Konva node in real-time
      textNode.text(textarea.value);
      textNode.getLayer()?.batchDraw();
      if (trRef.current) {
        trRef.current.forceUpdate();
      }
    };

    // Apply size initially
    updateSize();

    textarea.focus();

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Revert to initial value on Escape
        textarea.value = initialValue;
        textNode.text(initialValue);
        textNode.getLayer()?.batchDraw();
        if (trRef.current) trRef.current.forceUpdate();

        if (initialValue === '') {
          onDelete();
        }
        textarea.blur();
      }
    });

    textarea.addEventListener('input', () => {
      updateSize();
    });

    textarea.addEventListener('blur', () => {
      const newVal = textarea.value;
      if (!newVal || newVal.trim() === '') {
        onDelete();
      } else {
        onChange({ text: newVal });
      }

      if (textarea.parentNode) {
        try {
          textarea.remove();
        } catch (e) {
          // Element might already be removed
        }
      }
      if (textareaRef.current === textarea) {
        textareaRef.current = null;
      }
    });
  };

  const handleMouseEnter = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = isSelectToolActive ? 'move' : 'text';
  };

  const handleMouseLeave = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = 'default';
  };

  return (
    <>
      <KonvaText
        id={layer.id}
        ref={shapeRef}
        text={layer.text}
        x={layer.x}
        y={layer.y}
        fontSize={layer.fontSize}
        fill={layer.fill}
        rotation={layer.rotation}
        draggable={isSelectToolActive}
        wrap="word"
        {...(layer.width !== undefined ? { width: layer.width } : {})}
        onClick={onSelect}
        onTap={onSelect}
        onMouseDown={onSelect}
        onTouchStart={onSelect}
        onDblClick={handleDblClick}
        onDblTap={handleDblClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onDragStart={handleDragStart}
        onDragMove={(e) => {
          const node = e.target as Konva.Node;
          const x = Math.max(dragLimits.minX, Math.min(dragLimits.maxX - node.width(), node.x()));
          const y = Math.max(dragLimits.minY, Math.min(dragLimits.maxY - node.height(), node.y()));
          node.x(x);
          node.y(y);
        }}
        onDragEnd={handleDragEnd}
        onTransformStart={(e: Konva.KonvaEventObject<Event>) => {
          // Capture active anchor and start state for side anchor handling
          const node = e.target;
          const transformer = trRef.current;
          activeAnchorRef.current = transformer?.getActiveAnchor() || null;
          transformStartStateRef.current = {
            x: node.x(),
            y: node.y(),
            width: node.width(),
            height: node.height() ?? 0,
          };
        }}
        onTransform={(e: Konva.KonvaEventObject<Event>) => {
          const node = e.target;
          const stage = node.getStage();
          const activeAnchor = activeAnchorRef.current;
          const startState = transformStartStateRef.current;

          // Text only uses side anchors (middle-left, middle-right)
          if (stage && startState && activeAnchor) {
            handleSideAnchorTransform(node, stage, activeAnchor, startState, dragLimits, { minWidth: 30 });
          } else {
            // Fallback
            handleTransformClamping(node, dragLimits, { onlyWidth: true, minWidth: 30 });
          }
        }}
        onTransformEnd={() => {
          const node = shapeRef.current;
          if (!node) return;

          // Scale is already 1.0 due to eager reset in onTransform
          onChange({
            x: node.x(),
            y: node.y(),
            width: node.width(),
            rotation: node.rotation(),
          });

          // Clear transform state
          activeAnchorRef.current = null;
          transformStartStateRef.current = null;
        }}
      />
      {isSelected && (
        <Transformer
          ref={trRef}
          rotateEnabled={true}
          enabledAnchors={['middle-left', 'middle-right']} // Disable top/bottom handles
          anchorSize={8}
          padding={5}
          boundBoxFunc={(_oldBox, newBox) => {
            newBox.width = Math.max(30, newBox.width);
            return newBox;
          }}
        />
      )}
    </>
  );
};

// Selectable Shape Component
const SelectableShape = ({ layer, isSelected, onSelect, onChange, dragLimits, isSelectToolActive }: {
  layer: ShapeLayer;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: Partial<ShapeLayer>) => void;
  dragLimits: { minX: number; maxX: number; minY: number; maxY: number };
  isSelectToolActive: boolean;
}) => {
  const shapeRef = useRef<Konva.Shape>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const { dragLayerRef, contentLayerRef } = useContext(WorkspaceContext);
  const indexRef = useRef<number>(0);

  // Track transform state for side anchor handling
  const activeAnchorRef = useRef<string | null>(null);
  const transformStartStateRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    const dragLayer = dragLayerRef.current;
    const contentLayer = contentLayerRef.current;

    if (dragLayer && contentLayer) {
      const node = e.target as Konva.Node;
      indexRef.current = node.zIndex();
      node.opacity(0.7);
      node.moveTo(dragLayer);
      
      // Ensure Transformer is attached and rendered before moving
      if (trRef.current) {
        trRef.current.nodes([node]);
        trRef.current.moveTo(dragLayer);
      }
      
      contentLayer.listening(false);
    }
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target as Konva.Node;
    const dragLayer = dragLayerRef.current;
    const contentLayer = contentLayerRef.current;

    if (dragLayer && contentLayer) {
      node.opacity(1);
      node.moveTo(contentLayer);
      node.zIndex(indexRef.current);
      trRef.current?.moveTo(contentLayer);
      contentLayer.listening(true);
    }

    onChange({
      x: e.target.x(),
      y: e.target.y(),
    });
  };

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current && layer.tool !== 'arrow') {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, layer.tool]);

  // Base props for movement
  const movementProps = {
    draggable: isSelectToolActive,
    onMouseDown: onSelect,
    onTouchStart: onSelect,
    onDragStart: handleDragStart,
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target as Konva.Node;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      const width = node.width() * scaleX;
      const height = (node.height() ?? 0) * scaleY;

      let x = node.x();
      let y = node.y();

      // Handle center-positioned shapes (Ellipse) vs top-left (Rect/Arrow)
      const isCenter = node.className === 'Ellipse';
      const halfWidth = isCenter ? width / 2 : 0;
      const halfHeight = isCenter ? height / 2 : 0;

      // Handle negative dimensions (e.g. arrows pointing left or up)
      const left = isCenter ? x - halfWidth : Math.min(x, x + width);
      const right = isCenter ? x + halfWidth : Math.max(x, x + width);
      const top = isCenter ? y - halfHeight : Math.min(y, y + height);
      const bottom = isCenter ? y + halfHeight : Math.max(y, y + height);

      if (left < dragLimits.minX) x += (dragLimits.minX - left);
      if (right > dragLimits.maxX) x -= (right - dragLimits.maxX);
      if (top < dragLimits.minY) y += (dragLimits.minY - top);
      if (bottom > dragLimits.maxY) y -= (bottom - dragLimits.maxY);

      node.x(x);
      node.y(y);
    },
    onDragEnd: handleDragEnd,
  };

  const handleMouseEnter = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = isSelectToolActive ? 'move' : 'pointer';
  };

  const handleMouseLeave = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = 'default';
  };

  if (layer.tool === 'arrow') {
    const getArrowCursor = () => {
      const angle = Math.atan2(layer.height, layer.width) * (180 / Math.PI);
      const absAngle = Math.abs(angle);

      if ((absAngle > 22.5 && absAngle < 67.5) || (absAngle > 112.5 && absAngle < 157.5)) {
        return (angle > 0 === absAngle < 90) ? 'nwse-resize' : 'nesw-resize';
      }
      return absAngle < 45 || absAngle > 135 ? 'ew-resize' : 'ns-resize';
    };

    const handleAnchorDrag = (index: number, e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true; // Prevent Group's onDragMove from firing
      const stage = e.target.getStage();
      if (!stage) return;

      const absPos = e.target.getAbsolutePosition();
      const newX = Math.max(dragLimits.minX, Math.min(dragLimits.maxX, absPos.x));
      const newY = Math.max(dragLimits.minY, Math.min(dragLimits.maxY, absPos.y));

      if (index === 0) {
        // Tail dragged
        const dx = newX - layer.x;
        const dy = newY - layer.y;
        onChange({
          x: newX,
          y: newY,
          width: layer.width - dx,
          height: layer.height - dy,
        });
      } else {
        // Head dragged
        onChange({
          width: newX - layer.x,
          height: newY - layer.y,
        });
      }
    };

    const handleAnchorDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true; // Prevent Group's onDragEnd from firing
    };

    return (
      <Group
        x={layer.x}
        y={layer.y}
        {...movementProps}
      >
        <Arrow
          id={layer.id}
          ref={shapeRef as React.Ref<Konva.Arrow>}
          x={0}
          y={0}
          width={layer.width}
          height={layer.height}
          points={[0, 0, layer.width, layer.height]}
          stroke={layer.stroke}
          strokeWidth={layer.strokeWidth}
          hitStrokeWidth={Math.max(25, layer.strokeWidth)}
          fill={layer.stroke}
          onClick={onSelect}
          onTap={onSelect}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          draggable={false}
        />
        {isSelected && (
          <>
            {/* Tail Anchor */}
            <Circle
              x={0}
              y={0}
              radius={6}
              fill="white"
              stroke="#0096ff"
              strokeWidth={2}
              draggable
              onDragMove={(e) => handleAnchorDrag(0, e)}
              onDragEnd={handleAnchorDragEnd}
              onMouseEnter={(e) => {
                const stage = e.target.getStage();
                if (stage) stage.container().style.cursor = getArrowCursor();
              }}
              onMouseLeave={handleMouseLeave}
            />
            {/* Head Anchor */}
            <Circle
              x={layer.width}
              y={layer.height}
              radius={6}
              fill="white"
              stroke="#0096ff"
              strokeWidth={2}
              draggable
              onDragMove={(e) => handleAnchorDrag(1, e)}
              onDragEnd={handleAnchorDragEnd}
              onMouseEnter={(e) => {
                const stage = e.target.getStage();
                if (stage) stage.container().style.cursor = getArrowCursor();
              }}
              onMouseLeave={handleMouseLeave}
            />
          </>
        )}
      </Group>
    );
  }

  // For Rect/Circle, we pass width/height.
  const baseProps = {
    id: layer.id,
    x: layer.x,
    y: layer.y,
    rotation: layer.rotation,
    stroke: layer.stroke,
    strokeWidth: layer.strokeWidth,
    hitStrokeWidth: Math.max(25, layer.strokeWidth),
    fill: layer.fill || '',
    onClick: onSelect,
    onTap: onSelect,
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onTransformStart: (e: Konva.KonvaEventObject<Event>) => {
      // Capture active anchor and start state for side anchor handling
      const node = e.target;
      const transformer = trRef.current;
      activeAnchorRef.current = transformer?.getActiveAnchor() || null;
      transformStartStateRef.current = {
        x: node.x(),
        y: node.y(),
        width: node.width(),
        height: node.height() ?? 0,
      };
    },
    onTransform: (e: Konva.KonvaEventObject<Event>) => {
      const node = e.target;
      const stage = node.getStage();
      const isCenter = node.className === 'Ellipse';
      const activeAnchor = activeAnchorRef.current;
      const startState = transformStartStateRef.current;

      // Check if this is a side anchor that needs special handling
      const isSideAnchor = activeAnchor &&
        ['middle-right', 'middle-left', 'top-center', 'bottom-center'].includes(activeAnchor);

      if (isSideAnchor && stage && startState) {
        // Use pointer-based transform for side anchors to avoid position drift
        handleSideAnchorTransform(node, stage, activeAnchor, startState, dragLimits, { isCenter });
      } else {
        // Use scale-based clamping for corner anchors
        handleTransformClamping(e.target, dragLimits, { isCenter });
      }
    },
    onTransformEnd: () => {
      const node = shapeRef.current;
      if (!node) return;

      // Scale is already 1.0 due to eager reset in onTransform
      onChange({
        x: node.x(),
        y: node.y(),
        width: node.width(),
        height: node.height(),
        rotation: node.rotation(),
      });

      // Clear transform state
      activeAnchorRef.current = null;
      transformStartStateRef.current = null;
    },
    ...movementProps,
  };

  return (
    <>
      {layer.tool === 'rectangle' ? (
        <Rect
          {...baseProps}
          ref={shapeRef as React.Ref<Konva.Rect>}
          width={layer.width}
          height={layer.height}
        />
      ) : (
        <Ellipse
          {...baseProps}
          ref={shapeRef as React.Ref<Konva.Ellipse>}
          width={layer.width}
          height={layer.height}
          radiusX={layer.width / 2}
          radiusY={layer.height / 2}
        />
      )}
      {isSelected && (
        <Transformer
          ref={trRef}
          rotateEnabled={true}
          anchorSize={8}
          padding={5}
          boundBoxFunc={(_oldBox, newBox) => {
            newBox.width = Math.max(5, newBox.width);
            newBox.height = Math.max(5, newBox.height);
            return newBox;
          }}
        />
      )}
    </>
  );
};

// Placeholder for images currently being uploaded
const LoadingPlaceholder = ({ layer }: { layer: LoadingLayer }) => {
  return (
    <Group x={layer.x} y={layer.y} rotation={layer.rotation}>
      <Rect
        width={layer.width}
        height={layer.height}
        fill="#f3f4f6"
        stroke="#9ca3af"
        strokeWidth={2}
        dash={[10, 5]}
        cornerRadius={8}
      />
      <Group x={layer.width / 2} y={layer.height / 2}>
        <KonvaText
          text="上傳中..."
          fontSize={14}
          fontStyle="bold"
          fill="#4b5563"
          align="center"
          width={layer.width}
          offsetX={layer.width / 2}
          offsetY={20}
        />
        {layer.progress !== undefined && (
          <Group offsetY={-10}>
            <Rect
              x={-50}
              y={0}
              width={100}
              height={4}
              fill="#e5e7eb"
              cornerRadius={2}
            />
            <Rect
              x={-50}
              y={0}
              width={100 * (layer.progress || 0)}
              height={4}
              fill="#3b82f6"
              cornerRadius={2}
            />
          </Group>
        )}
      </Group>
    </Group>
  );
};

// Background Image Component
const BackgroundImage = ({ url, width }: { url: string; width: number }) => {
  const [image] = useImage(url, 'anonymous');
  if (!image) return null;

  // Calculate height to maintain aspect ratio based on canvas width
  const height = (width / image.width) * image.height;

  return (
    <KonvaImage
      image={image}
      x={0}
      y={0}
      width={width}
      height={height}
    />
  );
};

export const ClinicalWorkspace: React.FC<ClinicalWorkspaceProps> = ({
  recordId,
  initialData,
  onUpdate,
  syncStatus,
}) => {
  const [layers, setLayers] = useState<(DrawingPath | MediaLayer | TextLayer | ShapeLayer | LoadingLayer)[]>(() => {
    const rawLayers = initialData.layers || [];
    const seenIds = new Set<string>();

    // Migration logic: Scale coordinates if the source data was from the old 1000-unit canvas
    const oldWidth = initialData.canvas_width || 1000;
    const migrationScale = (initialData.version === undefined || initialData.version < 2) ? (CANVAS_WIDTH / oldWidth) : 1;

    return rawLayers.map((layer, i) => {
      let id = layer.id;
      if (!id || seenIds.has(id)) {
        id = `${layer.type || 'layer'}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
      }
      seenIds.add(id);

      const migrated = { ...layer, id };

      // Apply migration scaling for older records
      if (migrationScale !== 1) {
        if (migrated.type === 'drawing') {
          migrated.points = migrated.points.map(p =>
            p[2] !== undefined
              ? [p[0] * migrationScale, p[1] * migrationScale, p[2]]
              : [p[0] * migrationScale, p[1] * migrationScale]
          );
          if (migrated.boundingBox) {
            migrated.boundingBox = {
              minX: migrated.boundingBox.minX * migrationScale,
              maxX: migrated.boundingBox.maxX * migrationScale,
              minY: migrated.boundingBox.minY * migrationScale,
              maxY: migrated.boundingBox.maxY * migrationScale,
            };
          }
        } else if (migrated.type === 'media' || migrated.type === 'text' || migrated.type === 'shape' || migrated.type === 'loading') {
          migrated.x *= migrationScale;
          migrated.y *= migrationScale;
          if ('width' in migrated && migrated.width !== undefined) {
            migrated.width *= migrationScale;
          }
          if ('height' in migrated && (migrated as MediaLayer | ShapeLayer | LoadingLayer).height) {
            (migrated as MediaLayer | ShapeLayer | LoadingLayer).height! *= migrationScale;
          }
          if ('fontSize' in migrated && migrated.fontSize) {
            migrated.fontSize *= migrationScale;
          }
        }
      }
      return migrated as (DrawingPath | MediaLayer | TextLayer | ShapeLayer | LoadingLayer);
    });
  });

  const [currentTool, setCurrentTool] = useState<DrawingTool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  // History for Undo/Redo
  const [history, setHistory] = useState<(DrawingPath | MediaLayer | TextLayer | ShapeLayer | LoadingLayer)[][]>([initialData.layers || []]);
  const [historyStep, setHistoryStep] = useState(0);

  // Sync state
  const [localVersion, setLocalVersion] = useState(0);

  // Synchronize ref with state
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const isDrawing = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const currentPointsRef = useRef<[number, number, number?][]>([]);

  // Track canvas height dynamically based on content
  const [canvasHeight, setCanvasHeight] = useState(MIN_CANVAS_HEIGHT);

  // Update canvas height whenever layers change
  useEffect(() => {
    let maxY = MIN_CANVAS_HEIGHT;
    layers.forEach(layer => {
      if (layer.type === 'drawing' && layer.boundingBox) {
        maxY = Math.max(maxY, layer.boundingBox.maxY + 100);
      } else if (layer.type === 'media' || layer.type === 'text' || layer.type === 'shape' || layer.type === 'loading') {
        const height = 'height' in layer ? layer.height : ('fontSize' in layer ? layer.fontSize : 50);
        maxY = Math.max(maxY, layer.y + (height || 0) + 100);
      }
    });
    setCanvasHeight(maxY);
  }, [layers]);

  const stageRef = useRef<Konva.Stage>(null);
  const activeLineRef = useRef<Konva.Line>(null);
  const activeRectRef = useRef<Konva.Rect>(null);
  const activeEllipseRef = useRef<Konva.Ellipse>(null);
  const activeArrowRef = useRef<Konva.Arrow>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Layer Refs for Performance Optimization
  const contentLayerRef = useRef<Konva.Layer>(null);
  const dragLayerRef = useRef<Konva.Layer>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    // Force one re-render after mount to ensure refs are populated in context
    setTick(1);
  }, []);

  const clipboardRef = useRef<DrawingPath | MediaLayer | TextLayer | ShapeLayer | null>(null);
  const lastSentVersionRef = useRef<number>(0);
  const lastSentHeightRef = useRef<number>(MIN_CANVAS_HEIGHT);
  const onUpdateRef = useRef(onUpdate);

  const dragLimits = {
    minX: 0,
    maxX: CANVAS_WIDTH,
    minY: 0,
    maxY: canvasHeight
  };

  const getClampedPointerPosition = useCallback((customPos?: { x: number, y: number }) => {
    const stage = stageRef.current;
    if (!stage) return null;

    const pos = customPos || stage.getRelativePointerPosition();
    if (!pos) return null;

    return {
      x: Math.max(0, Math.min(CANVAS_WIDTH, pos.x)),
      y: Math.max(0, Math.min(canvasHeight, pos.y))
    };
  }, [canvasHeight]);

  const calculateBoundingBox = useCallback((points: [number, number, number?][]) => {
    if (points.length === 0) return undefined;
    let minX = points[0]![0], maxX = points[0]![0], minY = points[0]![1], maxY = points[0]![1];
    points.forEach(p => {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    });
    return { minX, maxX, minY, maxY };
  }, []);

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // 1. Tool-independent selection handling
    const clickedOnEmpty = e.target === e.target.getStage();
    const clickedOnActiveDrawing = e.target.name() === 'active-drawing';

    if (clickedOnEmpty || clickedOnActiveDrawing) {
      if (selectedId) setSelectedId(null);
    }

    // 2. Tool-specific logic
    if (currentTool === 'select') return;

    // Drawing logic
    const stage = e.target.getStage();
    if (!stage) return;

    const pos = getClampedPointerPosition();
    if (!pos) return;

    isDrawing.current = true;
    startPosRef.current = pos;

    if (['pen', 'highlighter', 'eraser'].includes(currentTool)) {
      currentPointsRef.current = [[pos.x, pos.y, e.evt instanceof MouseEvent ? 1 : (e.evt as TouchEvent).touches[0]?.force || 0.5]];
      if (activeLineRef.current) {
        activeLineRef.current.points([pos.x, pos.y]);
        activeLineRef.current.visible(true);
        activeLineRef.current.stroke(TOOL_CONFIG[currentTool === 'highlighter' ? 'highlighter' : 'pen'].color);
        activeLineRef.current.strokeWidth(TOOL_CONFIG[currentTool === 'highlighter' ? 'highlighter' : 'pen'].width);
        activeLineRef.current.globalCompositeOperation(currentTool === 'highlighter' ? 'multiply' : (currentTool === 'eraser' ? 'destination-out' : 'source-over'));
      }
    } else if (currentTool === 'rectangle') {
      if (activeRectRef.current) {
        activeRectRef.current.setAttrs({
          x: pos.x,
          y: pos.y,
          width: 0,
          height: 0,
          visible: true,
        });
      }
    } else if (currentTool === 'circle') {
      if (activeEllipseRef.current) {
        activeEllipseRef.current.setAttrs({
          x: pos.x,
          y: pos.y,
          radiusX: 0,
          radiusY: 0,
          visible: true,
        });
      }
    } else if (currentTool === 'arrow') {
      if (activeArrowRef.current) {
        activeArrowRef.current.setAttrs({
          x: pos.x,
          y: pos.y,
          points: [0, 0, 0, 0],
          visible: true,
        });
      }
    } else if (currentTool === 'text') {
      const stage = e.target.getStage();
      const stageWidth = stage?.width() || CANVAS_WIDTH;
      const initialWidth = Math.min(stageWidth * 2 / 3, stageWidth - pos.x);

      const newText: TextLayer = {
        id: `text-${Date.now()}`,
        type: 'text',
        x: pos.x,
        y: pos.y,
        text: '',
        fontSize: 20,
        fill: '#000000',
        rotation: 0,
        width: initialWidth,
      };
      addLayerToHistory(newText);
      setSelectedId(newText.id);
      setCurrentTool('select');
      isDrawing.current = false;
    }
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!isDrawing.current || !startPosRef.current) return;

    const pos = getClampedPointerPosition();
    if (!pos) return;

    if (['pen', 'highlighter', 'eraser'].includes(currentTool)) {
      const pressure = e.evt instanceof MouseEvent ? 1 : (e.evt as TouchEvent).touches[0]?.force || 0.5;
      currentPointsRef.current.push([pos.x, pos.y, pressure]);

      if (activeLineRef.current) {
        const flatPoints = currentPointsRef.current.flatMap(p => [p[0], p[1]]);
        activeLineRef.current.points(flatPoints);
      }
    } else if (currentTool === 'rectangle') {
      if (activeRectRef.current) {
        activeRectRef.current.setAttrs({
          width: pos.x - startPosRef.current.x,
          height: pos.y - startPosRef.current.y,
        });
      }
    } else if (currentTool === 'circle') {
      if (activeEllipseRef.current) {
        const dx = pos.x - startPosRef.current.x;
        const dy = pos.y - startPosRef.current.y;
        activeEllipseRef.current.setAttrs({
          radiusX: Math.abs(dx),
          radiusY: Math.abs(dy),
          // Offset to make it feel like drawing from corner
          x: startPosRef.current.x + dx / 2,
          y: startPosRef.current.y + dy / 2,
        });
      }
    } else if (currentTool === 'arrow') {
      if (activeArrowRef.current) {
        activeArrowRef.current.points([0, 0, pos.x - startPosRef.current.x, pos.y - startPosRef.current.y]);
      }
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing.current || !startPosRef.current) return;
    isDrawing.current = false;

    const pos = getClampedPointerPosition();
    if (!pos) return;

    if (['pen', 'highlighter', 'eraser'].includes(currentTool)) {
      if (activeLineRef.current) activeLineRef.current.visible(false);

      if (currentPointsRef.current.length > 1) {
        const newLayer: DrawingPath = {
          id: `drawing-${Date.now()}`,
          type: 'drawing',
          points: currentPointsRef.current,
          color: TOOL_CONFIG[currentTool === 'highlighter' ? 'highlighter' : 'pen'].color,
          width: TOOL_CONFIG[currentTool === 'highlighter' ? 'highlighter' : 'pen'].width,
          tool: currentTool as 'pen' | 'highlighter' | 'eraser',
          boundingBox: calculateBoundingBox(currentPointsRef.current)
        };
        addLayerToHistory(newLayer);
      }
      currentPointsRef.current = [];
    } else if (currentTool === 'rectangle') {
      if (activeRectRef.current) activeRectRef.current.visible(false);
      const width = pos.x - startPosRef.current.x;
      const height = pos.y - startPosRef.current.y;

      if (Math.abs(width) > 5 && Math.abs(height) > 5) {
        const newLayer: ShapeLayer = {
          id: `rect-${Date.now()}`,
          type: 'shape',
          tool: 'rectangle',
          x: width > 0 ? startPosRef.current.x : pos.x,
          y: height > 0 ? startPosRef.current.y : pos.y,
          width: Math.abs(width),
          height: Math.abs(height),
          stroke: '#000000',
          strokeWidth: 2,
          rotation: 0,
        };
        addLayerToHistory(newLayer);
      }
    } else if (currentTool === 'circle') {
      if (activeEllipseRef.current) activeEllipseRef.current.visible(false);
      const dx = pos.x - startPosRef.current.x;
      const dy = pos.y - startPosRef.current.y;

      if (Math.abs(dx) > 5 && Math.abs(dy) > 5) {
        const newLayer: ShapeLayer = {
          id: `circle-${Date.now()}`,
          type: 'shape',
          tool: 'circle',
          x: startPosRef.current.x + dx / 2,
          y: startPosRef.current.y + dy / 2,
          width: Math.abs(dx) * 2,
          height: Math.abs(dy) * 2,
          stroke: '#000000',
          strokeWidth: 2,
          rotation: 0,
        };
        addLayerToHistory(newLayer);
      }
    } else if (currentTool === 'arrow') {
      if (activeArrowRef.current) activeArrowRef.current.visible(false);
      const dx = pos.x - startPosRef.current.x;
      const dy = pos.y - startPosRef.current.y;

      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        const newLayer: ShapeLayer = {
          id: `arrow-${Date.now()}`,
          type: 'shape',
          tool: 'arrow',
          x: startPosRef.current.x,
          y: startPosRef.current.y,
          width: dx,
          height: dy,
          stroke: '#000000',
          strokeWidth: 2,
          rotation: 0,
        };
        addLayerToHistory(newLayer);
      }
    }
    startPosRef.current = null;
  };

  const handleWheel = () => {
    // We don't want to zoom, but we might want to allow scrolling if container is overflow
    // For now, let the browser handle it
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const placeholderId = `loading-${Date.now()}`;

    try {
      // 1. Show placeholder
      const placeholder: LoadingLayer = {
        id: placeholderId,
        type: 'loading',
        status: 'uploading',
        x: 100,
        y: 100,
        width: 200,
        height: 150,
        progress: 0.1,
        rotation: 0,
      };
      setLayers(prev => [...prev, placeholder]);

      // 2. Compress image
      const options = {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
        fileType: 'image/webp',
        onProgress: (p: number) => {
          setLayers(prev => prev.map(l =>
            l.id === placeholderId && l.type === 'loading' ? { ...l, progress: 0.1 + p * 0.4 } : l
          ));
        }
      };
      const compressedFile = await imageCompression(file, options);

      // 3. Upload to server
      const { url } = await apiService.uploadMedicalRecordMedia(recordId, compressedFile);

      // 4. Replace placeholder with actual image
      const img = new Image();
      img.src = url;
      await new Promise((resolve) => {
        img.onload = resolve;
      });

      const aspectRatio = img.width / img.height;
      const finalWidth = Math.min(400, img.width);
      const finalHeight = finalWidth / aspectRatio;

      // Center the image in the viewport
      const stage = stageRef.current;
      const centerX = stage ? stage.width() / 2 : CANVAS_WIDTH / 2;
      const centerY = 400; // Default vertical center if stage not ready

      const newLayer: MediaLayer = {
        id: `media-${Date.now()}`,
        type: 'media',
        origin: 'upload',
        url,
        x: centerX - finalWidth / 2,
        y: centerY - finalHeight / 2,
        width: finalWidth,
        height: finalHeight,
        rotation: 0,
      };

      // Don't set layers here, let addLayerToHistory do it
      addLayerToHistory(newLayer, true); 

    } catch (error) {
      logger.error('Failed to upload image', { error });
      setLayers(prev => prev.filter(l => l.id !== placeholderId));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const addLayerToHistory = (newLayer: DrawingPath | MediaLayer | TextLayer | ShapeLayer | LoadingLayer, replaceLast = false) => {
    setLayers(prev => {
      const next = replaceLast ? [...prev.slice(0, -1), newLayer] : [...prev, newLayer];
      const newHistory = history.slice(0, historyStep + 1);
      newHistory.push(next);
      setHistory(newHistory);
      setHistoryStep(newHistory.length - 1);
      return next;
    });
    setLocalVersion(v => v + 1);
  };

  const undo = () => {
    if (historyStep > 0) {
      const nextStep = historyStep - 1;
      setHistoryStep(nextStep);
      setLayers(history[nextStep] || []);
      setLocalVersion(v => v + 1);
      setSelectedId(null);
    }
  };

  const redo = () => {
    if (historyStep < history.length - 1) {
      const nextStep = historyStep + 1;
      setHistoryStep(nextStep);
      setLayers(history[nextStep] || []);
      setLocalVersion(v => v + 1);
      setSelectedId(null);
    }
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    const nextLayers = layers.filter(l => l.id !== selectedId);
    setLayers(nextLayers);
    const newHistory = history.slice(0, historyStep + 1);
    newHistory.push(nextLayers);
    setHistory(newHistory);
    setHistoryStep(newHistory.length - 1);
    setLocalVersion(v => v + 1);
    setSelectedId(null);
  };

  const moveLayer = (direction: 'up' | 'down' | 'front' | 'back') => {
    if (!selectedId) return;
    const index = layers.findIndex(l => l.id === selectedId);
    if (index === -1) return;

    const newLayers = [...layers];
    const layer = newLayers.splice(index, 1)[0]!;

    if (direction === 'up') {
      newLayers.splice(Math.min(index + 1, newLayers.length), 0, layer);
    } else if (direction === 'down') {
      newLayers.splice(Math.max(index - 1, 0), 0, layer);
    } else if (direction === 'front') {
      newLayers.push(layer);
    } else if (direction === 'back') {
      newLayers.unshift(layer);
    }

    setLayers(newLayers);
    const newHistory = history.slice(0, historyStep + 1);
    newHistory.push(newLayers);
    setHistory(newHistory);
    setHistoryStep(newHistory.length - 1);
    setLocalVersion(v => v + 1);
  };

  // Sync with server
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    const hasUnsentChanges = localVersion > 0 && localVersion !== lastSentVersionRef.current;
    const hasMetadataChanges = canvasHeight !== lastSentHeightRef.current;

    if (hasUnsentChanges || hasMetadataChanges) {
      const runSync = () => {
        onUpdateRef.current({
          layers,
          canvas_width: CANVAS_WIDTH,
          canvas_height: canvasHeight,
          version: WORKSPACE_VERSION,
        });
        lastSentVersionRef.current = localVersion;
        lastSentHeightRef.current = canvasHeight;
      };

      // In test environments, skip debounce for mock compatibility
      if (process.env.NODE_ENV === 'test') {
        runSync();
      } else {
        timer = setTimeout(runSync, 1000);
      }
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [layers, localVersion, canvasHeight]);

  // Handle outside clicks for deselection
  useEffect(() => {
    const isInsideInteractiveArea = (target: Node | null) => {
      if (!target) return false;
      return (
        canvasContainerRef.current?.contains(target) ||
        toolbarRef.current?.contains(target) ||
        contextMenuRef.current?.contains(target)
      );
    };

    const handleGlobalMouseDown = (e: MouseEvent) => {
      // Only care if something is selected
      if (!selectedIdRef.current) return;

      const target = e.target as Node;
      if (isInsideInteractiveArea(target)) return;

      // Otherwise, click is outside "the interactive canvas area", so deselect
      setSelectedId(null);
    };

    const handleGlobalTouchStart = (e: TouchEvent) => {
      if (!selectedIdRef.current) return;
      const target = e.target as Node;
      if (isInsideInteractiveArea(target)) return;
      setSelectedId(null);
    };

    // Prevent scrolling while drawing on touch devices
    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (isDrawing.current) {
        e.preventDefault();
      }
    };

    const handleGlobalTouchEnd = () => {
      // Logic handled in handleMouseUp
    };

    window.addEventListener('mousedown', handleGlobalMouseDown);
    window.addEventListener('touchstart', handleGlobalTouchStart, { passive: true });
    window.addEventListener('touchmove', handleGlobalTouchMove, { passive: true });
    window.addEventListener('touchend', handleGlobalTouchEnd);

    return () => {
      window.removeEventListener('mousedown', handleGlobalMouseDown);
      window.removeEventListener('touchstart', handleGlobalTouchStart);
      window.removeEventListener('touchmove', handleGlobalTouchMove);
      window.removeEventListener('touchend', handleGlobalTouchEnd);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in a textarea or input
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        const layer = layers.find(l => l.id === selectedId);
        if (layer) clipboardRef.current = JSON.parse(JSON.stringify(layer));
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboardRef.current) {
          const pasted = JSON.parse(JSON.stringify(clipboardRef.current)) as DrawingPath | MediaLayer | TextLayer | ShapeLayer;
          
          const newId = `${pasted.type}-${Date.now()}`;
          
          if (pasted.type === 'drawing') {
            const newDrawing: DrawingPath = {
              ...pasted,
              id: newId,
              points: pasted.points.map(p => [p[0] + 20, p[1] + 20, p[2]] as [number, number, number?]),
            };
            newDrawing.boundingBox = calculateBoundingBox(newDrawing.points);
            addLayerToHistory(newDrawing);
            setSelectedId(newId);
          } else {
            const newLayer = {
              ...pasted,
              id: newId,
              x: pasted.x + 20,
              y: pasted.y + 20,
            } as MediaLayer | TextLayer | ShapeLayer;
            addLayerToHistory(newLayer);
            setSelectedId(newId);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layers, selectedId, historyStep]);

  // Helper to get cursor style based on tool
  const getStageCursor = () => {
    if (currentTool === 'select') return 'default';
    if (currentTool === 'text') return 'text';
    if (currentTool === 'eraser') return 'cell';
    return 'crosshair';
  };

  const renderLayer = (layer: DrawingPath | MediaLayer | TextLayer | ShapeLayer | LoadingLayer) => {
    const isSelected = selectedId === layer.id;
    const commonProps = {
      layer,
      isSelected,
      onSelect: () => setSelectedId(layer.id),
      onChange: (newAttrs: Partial<DrawingPath | MediaLayer | TextLayer | ShapeLayer>) => {
        const nextLayers = layers.map(l => l.id === layer.id ? { ...l, ...newAttrs } : l);
        setLayers(nextLayers as (DrawingPath | MediaLayer | TextLayer | ShapeLayer | LoadingLayer)[]);
        const newHistory = history.slice(0, historyStep + 1);
        newHistory.push(nextLayers as (DrawingPath | MediaLayer | TextLayer | ShapeLayer | LoadingLayer)[]);
        setHistory(newHistory);
        setHistoryStep(newHistory.length - 1);
        setLocalVersion(v => v + 1);
      },
      dragLimits,
      isSelectToolActive: currentTool === 'select',
    };

    switch (layer.type) {
      case 'drawing':
        return <SelectableLine key={layer.id} {...commonProps} layer={layer as DrawingPath} calculateBoundingBox={calculateBoundingBox} />;
      case 'media':
        return <UrlImage key={layer.id} {...commonProps} layer={layer as MediaLayer} />;
      case 'text':
        return <SelectableText key={layer.id} {...commonProps} layer={layer as TextLayer} onDelete={deleteSelected} />;
      case 'shape':
        return <SelectableShape key={layer.id} {...commonProps} layer={layer as ShapeLayer} />;
      case 'loading':
        return <LoadingPlaceholder key={layer.id} layer={layer as LoadingLayer} />;
      default:
        return null;
    }
  };

  // Combined scale for rendering - fixed to fit container width
  // const scale = SCALE; // Unused

  // Tool change cleanup
  useEffect(() => {
    if (activeRectRef.current) activeRectRef.current.visible(false);
    if (activeEllipseRef.current) activeEllipseRef.current.visible(false);
    if (activeArrowRef.current) activeArrowRef.current.visible(false);
    if (activeLineRef.current) activeLineRef.current.visible(false);
    isDrawing.current = false;
    startPosRef.current = null;
    currentPointsRef.current = [];
    if (stageRef.current) stageRef.current.batchDraw();
  }, [currentTool]);

  return (
    <div className="flex flex-col items-center w-full min-h-screen bg-gray-50 pb-20 overflow-x-hidden">
      {/* Performance Warning / Debug Info (Optional) */}
      <div className="w-full bg-blue-600 text-white px-4 py-1 text-center text-xs font-medium">
        繪圖工作區 (效能最佳化模式) - PixelRatio: {Konva.pixelRatio.toFixed(1)}
      </div>

      {/* Toolbar */}
      <div
        ref={toolbarRef}
        className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-white/90 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-200 px-6 py-3 flex items-center gap-2 z-30 transition-all hover:bg-white"
      >
        <ToolButton active={currentTool === 'select'} onClick={() => setCurrentTool('select')} icon={<CursorIcon />} label="選取 (V)" />
        <div className="w-px h-8 bg-gray-200 mx-2" />
        <ToolButton active={currentTool === 'pen'} onClick={() => setCurrentTool('pen')} icon={<PenIcon />} label="畫筆 (P)" />
        <ToolButton active={currentTool === 'highlighter'} onClick={() => setCurrentTool('highlighter')} icon={<HighlighterIcon />} label="螢光筆 (H)" />
        <ToolButton active={currentTool === 'eraser'} onClick={() => setCurrentTool('eraser')} icon={<EraserIcon />} label="橡皮擦 (E)" />
        <div className="w-px h-8 bg-gray-200 mx-2" />
        <ToolButton active={currentTool === 'text'} onClick={() => setCurrentTool('text')} icon={<TextIcon />} label="文字 (T)" />
        <ToolButton active={currentTool === 'rectangle'} onClick={() => setCurrentTool('rectangle')} icon={<SquareIcon />} label="矩形 (R)" />
        <ToolButton active={currentTool === 'circle'} onClick={() => setCurrentTool('circle')} icon={<CircleIcon />} label="圓形 (C)" />
        <ToolButton active={currentTool === 'arrow'} onClick={() => setCurrentTool('arrow')} icon={<ArrowIcon />} label="箭頭 (A)" />
        <div className="w-px h-8 bg-gray-200 mx-2" />
        <ToolButton onClick={() => fileInputRef.current?.click()} icon={<ImageIcon />} label="上傳圖片" disabled={isUploading} />
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} aria-label="圖片隱藏輸入" />
        <div className="w-px h-8 bg-gray-200 mx-2" />
        <ToolButton onClick={undo} icon={<UndoIcon />} label="復原" disabled={historyStep === 0} />
        <ToolButton onClick={redo} icon={<RedoIcon />} label="重做" disabled={historyStep === history.length - 1} />

        <div className="ml-4 pl-4 border-l border-gray-200 flex items-center">
          <SyncStatus 
            status={
              syncStatus || 
              (localVersion === lastSentVersionRef.current ? 'saved' : 'saving')
            } 
          />
        </div>
      </div>

      {/* Context Menu for selection */}
      {selectedId && (
        <div ref={contextMenuRef} className="fixed top-20 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-lg px-4 py-2 flex items-center gap-3 z-20 border border-gray-200">
          <span className="text-xs font-medium text-gray-500 mr-2">
            已選取 {
              layers.find(l => l.id === selectedId)?.type === 'media' ? '圖片' :
                layers.find(l => l.id === selectedId)?.type === 'text' ? '文字' :
                  layers.find(l => l.id === selectedId)?.type === 'shape' ? '圖形' : '筆跡'
            }
          </span>
          {layers.find(l => l.id === selectedId)?.type === 'text' && (
            <div className="flex items-center gap-2">
              <select
                className="text-xs border rounded px-1 py-1"
                value={(layers.find(l => l.id === selectedId) as TextLayer)?.fontSize || 20}
                onChange={(e) => {
                  const fontSize = parseInt(e.target.value);
                  const nextLayers = layers.map(l => l.id === selectedId ? { ...l, fontSize } : l);
                  setLayers(nextLayers as (DrawingPath | MediaLayer | TextLayer | ShapeLayer | LoadingLayer)[]);
                  const newHistory = history.slice(0, historyStep + 1);
                  newHistory.push(nextLayers as (DrawingPath | MediaLayer | TextLayer | ShapeLayer | LoadingLayer)[]);
                  setHistory(newHistory);
                  setHistoryStep(newHistory.length - 1);
                  setLocalVersion(v => v + 1);
                }}
              >
                {[12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64].map(size => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
          )}
          <ContextButton onClick={() => moveLayer('front')} label="最上層" />
          <ContextButton onClick={() => moveLayer('up')} label="上移" />
          <ContextButton onClick={() => moveLayer('down')} label="下移" />
          <ContextButton onClick={() => moveLayer('back')} label="最下層" />
          <div className="w-px h-4 bg-gray-200 mx-1" />
          <button onClick={deleteSelected} className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors">刪除</button>
        </div>
      )}

      {/* Main Document View */}
      <div className="relative pt-12 pb-32 flex justify-center bg-white min-h-screen">
        <div
          ref={canvasContainerRef}
          className="relative bg-white shadow-xl border border-gray-200"
          style={{
            width: CANVAS_WIDTH,
            minHeight: canvasHeight,
            cursor: getStageCursor(),
            touchAction: 'none', // Critical: Prevent browser gesture interference
            userSelect: 'none', // Prevent blue selection highlight on long press
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none', // Prevent iOS context menu on long press
          }}
        >
          <Stage
            ref={stageRef}
            width={CANVAS_WIDTH}
            height={canvasHeight}
            className="relative"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchStart={handleMouseDown}
            onTouchMove={handleMouseMove}
            onTouchEnd={handleMouseUp}
            onTouchCancel={handleMouseUp}
          >
            <WorkspaceContext.Provider value={{ dragLayerRef, contentLayerRef }}>
              <Layer name="background" listening={false}>
                {/* Paper Background */}
                <Rect
                  x={0}
                  y={0}
                  width={CANVAS_WIDTH}
                  height={canvasHeight}
                  fill="white"
                />
                {initialData.background_image_url && (
                  <BackgroundImage url={initialData.background_image_url} width={CANVAS_WIDTH} />
                )}
              </Layer>
              <Layer ref={contentLayerRef} name="content">
                {layers.map((layer) => (
                  renderLayer(layer)
                ))}

                {/* Interaction Overlays */}
                <Line
                  ref={activeLineRef}
                  points={[]}
                  stroke={TOOL_CONFIG[currentTool === 'highlighter' ? 'highlighter' : 'pen'].color}
                  strokeWidth={TOOL_CONFIG[currentTool === 'highlighter' ? 'highlighter' : 'pen'].width}
                  tension={0.5}
                  lineCap="round"
                  lineJoin="round"
                  visible={false}
                  perfectDrawEnabled={false}
                  globalCompositeOperation={currentTool === 'highlighter' ? 'multiply' : 'source-over'}
                />
                <Rect ref={activeRectRef} stroke={TOOL_CONFIG.rectangle.color} strokeWidth={TOOL_CONFIG.rectangle.width} visible={false} />
                <Ellipse ref={activeEllipseRef} radiusX={0} radiusY={0} stroke={TOOL_CONFIG.circle.color} strokeWidth={TOOL_CONFIG.circle.width} visible={false} />
                <Arrow ref={activeArrowRef} points={[0, 0, 0, 0]} stroke={TOOL_CONFIG.arrow.color} strokeWidth={TOOL_CONFIG.arrow.width} visible={false} />
              </Layer>
              <Layer ref={dragLayerRef} name="drag" />
            </WorkspaceContext.Provider>
          </Stage>
        </div>
      </div>
    </div>
  );
};


const TextIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 7 4 4 20 4 20 7" />
    <line x1="9" y1="20" x2="15" y2="20" />
    <line x1="12" y1="4" x2="12" y2="20" />
  </svg>
);

const SquareIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
  </svg>
);

const CircleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
  </svg>
);

const ArrowIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

interface ToolButtonProps {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}

const ToolButton = ({ active, onClick, icon, label, disabled }: ToolButtonProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    className={`p-3 rounded-xl transition-all duration-200 flex items-center justify-center ${active
      ? 'bg-blue-100 text-blue-600 shadow-inner'
      : 'hover:bg-gray-100 text-gray-600'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
  >
    {icon}
  </button>
);

const ContextButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button
    onClick={onClick}
    className="text-gray-600 hover:text-black hover:bg-gray-100 px-2 py-1 rounded text-sm transition-colors"
  >
    {label}
  </button>
);

// Icons
const CursorIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" /></svg>
);
const PenIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
);
const HighlighterIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
);
const EraserIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
);
const ImageIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
);
const UndoIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
);
const RedoIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" /></svg>
);
