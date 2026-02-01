import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Stage, Layer, Line, Image as KonvaImage, Transformer, Text as KonvaText, Rect, Arrow, Ellipse, Circle } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import imageCompression from 'browser-image-compression';
import type { WorkspaceData, DrawingPath, MediaLayer, TextLayer, ShapeLayer, DrawingTool } from '../../types';
import { logger } from '../../utils/logger';
import { apiService } from '../../services/api';
import { SyncStatus, SyncStatusType } from './SyncStatus';

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
const SCALE = 1; // 1:1 logical to visual

/**
 * Shared logic for clamping transformations (resizing) to canvas boundaries.
 * This handles resetting scale to 1 and adjusting width/height manually.
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


// Helper component for loading images
const UrlImage = ({ layer, isSelected, onSelect, onChange, dragLimits }: {
  layer: MediaLayer;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: Partial<MediaLayer>) => void;
  dragLimits: { minX: number; maxX: number; minY: number; maxY: number };
}) => {
  const [image] = useImage(layer.url, 'anonymous');
  const shapeRef = useRef<Konva.Image>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [isMoving, setIsMoving] = useState(false);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const handleMouseEnter = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = 'move';
  };

  const handleMouseLeave = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = 'default';
  };

  return (
    <>
      <KonvaImage
        image={image}
        x={layer.x}
        y={layer.y}
        width={layer.width}
        height={layer.height}
        rotation={layer.rotation}
        opacity={isMoving ? 0.7 : 1}
        draggable={isSelected}
        onClick={onSelect}
        onTap={onSelect}
        ref={shapeRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onDragStart={() => setIsMoving(true)}
        onDragMove={(e) => {
          const node = e.target;
          const x = Math.max(dragLimits.minX, Math.min(dragLimits.maxX - node.width() * node.scaleX(), node.x()));
          const y = Math.max(dragLimits.minY, Math.min(dragLimits.maxY - node.height() * node.scaleY(), node.y()));
          node.x(x);
          node.y(y);
        }}
        onDragEnd={(e) => {
          setIsMoving(false);
          onChange({
            x: e.target.x(),
            y: e.target.y(),
          });
        }}
        onTransformStart={() => setIsMoving(true)}
        onTransform={(e) => {
          handleTransformClamping(e.target, dragLimits);
        }}
        onTransformEnd={() => {
          setIsMoving(false);
          const node = shapeRef.current;
          if (!node) return;
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
const SelectableLine = ({ layer, isSelected, onSelect, onChange, calculateBoundingBox, dragLimits }: {
  layer: DrawingPath;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: Partial<DrawingPath>) => void;
  calculateBoundingBox: (points: [number, number, number?][]) => { minX: number; maxX: number; minY: number; maxY: number } | undefined;
  dragLimits: { minX: number; maxX: number; minY: number; maxY: number };
}) => {
  const shapeRef = useRef<Konva.Line>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, layer]); // Re-bind if layer changes (points updated)

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
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
    if (stage) stage.container().style.cursor = isSelected ? 'move' : 'pointer';
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
        hitStrokeWidth={Math.max(10, layer.width)}
        tension={0.5}
        lineCap="round"
        lineJoin="round"
        draggable={isSelected}
        onClick={onSelect}
        onTap={onSelect}
        perfectDrawEnabled={false}
        globalCompositeOperation={
          layer.tool === 'highlighter' ? 'multiply' : 'source-over'
        }
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
const SelectableText = ({ layer, isSelected, onSelect, onChange, onDelete, dragLimits }: {
  layer: TextLayer;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: Partial<TextLayer>) => void;
  onDelete: () => void;
  dragLimits: { minX: number; maxX: number; minY: number; maxY: number };
}) => {
  const shapeRef = useRef<Konva.Text>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
    if (stage) stage.container().style.cursor = isSelected ? 'move' : 'text';
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
        draggable={isSelected}
        wrap="word"
        {...(layer.width !== undefined ? { width: layer.width } : {})}
        onClick={onSelect}
        onTap={onSelect}
        onDblClick={handleDblClick}
        onDblTap={handleDblClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onDragMove={(e) => {
          const node = e.target;
          const x = Math.max(dragLimits.minX, Math.min(dragLimits.maxX - node.width(), node.x()));
          const y = Math.max(dragLimits.minY, Math.min(dragLimits.maxY - node.height(), node.y()));
          node.x(x);
          node.y(y);
        }}
        onDragEnd={(e) => {
          onChange({
            x: e.target.x(),
            y: e.target.y(),
          });
        }}
        onTransform={(e) => {
          handleTransformClamping(e.target, dragLimits, { onlyWidth: true, minWidth: 30 });
        }}
        onTransformEnd={() => {
          const node = shapeRef.current;
          if (!node) return;

          // Ensure scale is 1
          node.scaleX(1);
          node.scaleY(1);

          onChange({
            x: node.x(),
            y: node.y(),
            width: node.width(),
            rotation: node.rotation(),
            // Do NOT update fontSize here
          });
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
const SelectableShape = ({ layer, isSelected, onSelect, onChange, dragLimits }: {
  layer: ShapeLayer;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: Partial<ShapeLayer>) => void;
  dragLimits: { minX: number; maxX: number; minY: number; maxY: number };
}) => {
  const shapeRef = useRef<Konva.Shape>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current && layer.tool !== 'arrow') {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, layer.tool]);

  // Base props for movement
  const movementProps = {
    draggable: isSelected,
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      const width = node.width() * scaleX;
      const height = node.height() * scaleY;

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
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      onChange({
        x: e.target.x(),
        y: e.target.y(),
      });
    },
  };

  const handleMouseEnter = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = isSelected ? 'move' : 'pointer';
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
      const stage = e.target.getStage();
      if (!stage) return;

      const pos = e.target.position();
      const newX = Math.max(dragLimits.minX, Math.min(dragLimits.maxX, pos.x));
      const newY = Math.max(dragLimits.minY, Math.min(dragLimits.maxY, pos.y));

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

    return (
      <>
        <Arrow
          id={layer.id}
          ref={shapeRef as React.Ref<Konva.Arrow>}
          x={layer.x}
          y={layer.y}
          width={layer.width}
          height={layer.height}
          points={[0, 0, layer.width, layer.height]}
          stroke={layer.stroke}
          strokeWidth={layer.strokeWidth}
          fill={layer.stroke}
          onClick={onSelect}
          onTap={onSelect}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          {...movementProps}
        />
        {isSelected && (
          <>
            {/* Tail Anchor */}
            <Circle
              x={layer.x}
              y={layer.y}
              radius={6}
              fill="white"
              stroke="#0096ff"
              strokeWidth={2}
              draggable
              onDragMove={(e) => handleAnchorDrag(0, e)}
              onMouseEnter={(e) => {
                const stage = e.target.getStage();
                if (stage) stage.container().style.cursor = getArrowCursor();
              }}
              onMouseLeave={handleMouseLeave}
            />
            {/* Head Anchor */}
            <Circle
              x={layer.x + layer.width}
              y={layer.y + layer.height}
              radius={6}
              fill="white"
              stroke="#0096ff"
              strokeWidth={2}
              draggable
              onDragMove={(e) => handleAnchorDrag(1, e)}
              onMouseEnter={(e) => {
                const stage = e.target.getStage();
                if (stage) stage.container().style.cursor = getArrowCursor();
              }}
              onMouseLeave={handleMouseLeave}
            />
          </>
        )}
      </>
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
    fill: layer.fill || '',
    onClick: onSelect,
    onTap: onSelect,
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onTransform: (e: Konva.KonvaEventObject<Event>) => {
      handleTransformClamping(e.target, dragLimits, {
        isCenter: e.target.className === 'Ellipse'
      });
    },
    onTransformEnd: () => {
      const node = shapeRef.current;
      if (!node) return;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      node.scaleX(1);
      node.scaleY(1);

      onChange({
        x: node.x(),
        y: node.y(),
        width: node.width() * scaleX,
        height: node.height() * scaleY,
        rotation: node.rotation(),
      });
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

// Background Image Component
const BackgroundImage = ({ url, width }: { url: string; width: number }) => {
  const [image] = useImage(url, 'anonymous');
  if (!image) return null;

  // Calculate height to maintain aspect ratio based on canvas width
  const height = (width / image.width) * image.height;

  return (
    <KonvaImage
      image={image}
      width={width}
      height={height}
      listening={false} // Background shouldn't intercept events
    />
  );
};

export const ClinicalWorkspace: React.FC<ClinicalWorkspaceProps> = ({
  recordId,
  initialData,
  onUpdate,
  syncStatus,
}) => {
  const [layers, setLayers] = useState<(DrawingPath | MediaLayer | TextLayer | ShapeLayer)[]>(() => {
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
        } else {
          migrated.x = (migrated.x || 0) * migrationScale;
          migrated.y = (migrated.y || 0) * migrationScale;
          if ('width' in migrated && migrated.width !== undefined) migrated.width *= migrationScale;
          if ('height' in migrated && migrated.height !== undefined) migrated.height *= migrationScale;
          if (migrated.type === 'text' && migrated.fontSize) {
            migrated.fontSize *= migrationScale;
          }
        }
      }

      return migrated as DrawingPath | MediaLayer | TextLayer | ShapeLayer;
    });
  });
  const [currentTool, setCurrentTool] = useState<DrawingTool>('pen');
  const [currentFontSize, setCurrentFontSize] = useState<number>(TOOL_CONFIG.text.fontSize);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canvasHeight, setCanvasHeight] = useState(initialData.canvas_height || MIN_CANVAS_HEIGHT);

  // Ref for the current drawing path
  const isDrawing = useRef(false);
  const currentPointsRef = useRef<number[]>([]);
  const startPosRef = useRef<{ x: number, y: number } | null>(null);
  const lastPointerPosRef = useRef<{ x: number, y: number } | null>(null);
  const deletedLayerIdsRef = useRef<Set<number | string>>(new Set());
  const lastPenTimeRef = useRef<number>(0);

  const stageRef = useRef<Konva.Stage>(null);
  const activeLineRef = useRef<Konva.Line>(null);
  const activeRectRef = useRef<Konva.Rect>(null);
  const activeEllipseRef = useRef<Konva.Ellipse>(null);
  const activeArrowRef = useRef<Konva.Arrow>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const clipboardRef = useRef<DrawingPath | MediaLayer | TextLayer | ShapeLayer | null>(null);
  const lastSentVersionRef = useRef<number>(0);
  const onUpdateRef = useRef(onUpdate);
  const initialDataRef = useRef(initialData);

  const dragLimits = {
    minX: 0,
    maxX: CANVAS_WIDTH,
    minY: 0,
    maxY: canvasHeight
  };

  const getClampedPointerPosition = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getRelativePointerPosition();
    if (!pos) return null;

    return {
      x: Math.max(dragLimits.minX, Math.min(dragLimits.maxX, pos.x)),
      y: Math.max(dragLimits.minY, Math.min(dragLimits.maxY, pos.y))
    };
  }, [dragLimits]);

  // Internal helper to render individual layers - NOT a component to prevent unmounting on re-render
  const renderLayer = (layer: DrawingPath | MediaLayer | TextLayer | ShapeLayer, index: number) => {
    if (layer.type === 'media') {
      const mediaLayer = layer as MediaLayer;
      return (
        <UrlImage
          key={mediaLayer.id}
          layer={mediaLayer}
          isSelected={mediaLayer.id === selectedId}
          onSelect={() => currentTool === 'select' && setSelectedId(mediaLayer.id)}
          onChange={(newAttrs) => {
            const newLayers = [...layers];
            newLayers[index] = { ...mediaLayer, ...newAttrs } as MediaLayer;
            updateLayers(newLayers);
            if (newAttrs.y || newAttrs.height) {
              ensureHeight((newAttrs.y || mediaLayer.y) + (newAttrs.height || mediaLayer.height));
            }
          }}
          dragLimits={dragLimits}
        />
      );
    } else if (layer.type === 'drawing') {
      const drawing = layer as DrawingPath;
      return (
        <SelectableLine
          key={drawing.id}
          layer={drawing}
          isSelected={drawing.id === selectedId}
          calculateBoundingBox={calculateBoundingBox}
          onSelect={() => currentTool === 'select' && setSelectedId(drawing.id)}
          onChange={(newAttrs) => {
            const newLayers = [...layers];
            newLayers[index] = { ...drawing, ...newAttrs } as DrawingPath;
            updateLayers(newLayers);
            if (newAttrs.points) {
              const d = newLayers[index] as DrawingPath;
              if (d.boundingBox) ensureHeight(d.boundingBox.maxY);
            }
          }}
          dragLimits={dragLimits}
        />
      );
    } else if (layer.type === 'text') {
      const textLayer = layer as TextLayer;
      return (
        <SelectableText
          key={textLayer.id}
          layer={textLayer}
          isSelected={textLayer.id === selectedId}
          onSelect={() => currentTool === 'select' && setSelectedId(textLayer.id)}
          onChange={(newAttrs) => {
            const newLayers = [...layers];
            newLayers[index] = { ...textLayer, ...newAttrs } as TextLayer;
            updateLayers(newLayers);
            if (newAttrs.y || newAttrs.fontSize) {
              ensureHeight((newAttrs.y || textLayer.y) + (newAttrs.fontSize || textLayer.fontSize) * 2);
            }
          }}
          onDelete={() => deleteSelected()}
          dragLimits={dragLimits}
        />
      );
    } else if (layer.type === 'shape') {
      const shapeLayer = layer as ShapeLayer;
      return (
        <SelectableShape
          key={shapeLayer.id}
          layer={shapeLayer}
          isSelected={shapeLayer.id === selectedId}
          onSelect={() => currentTool === 'select' && setSelectedId(shapeLayer.id)}
          onChange={(newAttrs) => {
            const newLayers = [...layers];
            newLayers[index] = { ...shapeLayer, ...newAttrs } as ShapeLayer;
            updateLayers(newLayers);
            if (newAttrs.y || newAttrs.height) {
              ensureHeight((newAttrs.y || shapeLayer.y) + (newAttrs.height || shapeLayer.height));
            }
          }}
          dragLimits={dragLimits}
        />
      );
    }
    return null;
  };

  // Keep refs in sync
  useEffect(() => {
    onUpdateRef.current = onUpdate;
    initialDataRef.current = initialData;
  }, [onUpdate, initialData]);

  // Refs for keyboard shortcuts to avoid frequent re-registration
  const layersRef = useRef(layers);
  const selectedIdRef = useRef(selectedId);

  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // Update font size when selecting text
  useEffect(() => {
    if (selectedId) {
      const layer = layers.find(l => l.id === selectedId);
      if (layer && layer.type === 'text') {
        setCurrentFontSize((layer as TextLayer).fontSize);
      }
    }
  }, [selectedId, layers]);

  const handleFontSizeChange = (size: number) => {
    setCurrentFontSize(size);
    if (selectedId) {
      const layer = layers.find(l => l.id === selectedId);
      if (layer && layer.type === 'text') {
        updateLayers(prev => prev.map(l =>
          l.id === selectedId ? { ...l, fontSize: size } : l
        ));
      }
    }
  };


  // Get stage cursor based on tool
  const getStageCursor = () => {
    switch (currentTool) {
      case 'pen':
      case 'highlighter':
      case 'rectangle':
      case 'circle':
      case 'arrow':
        return 'crosshair';
      case 'eraser': return 'cell';
      case 'text': return 'text';
      case 'select': return 'default';
      default: return 'default';
    }
  };

  // Viewport state (Fixed for Pageless model)
  const stageScale = 1;
  const stagePos = { x: 0, y: 0 };

  // Combined scale for rendering - fixed to fit container width
  const scale = SCALE;

  // History for Undo/Redo
  const [history, setHistory] = useState<(DrawingPath | MediaLayer | TextLayer | ShapeLayer)[][]>([initialData.layers || []]);
  const [historyStep, setHistoryStep] = useState(0);

  // Sync state
  const [localVersion, setLocalVersion] = useState(0);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        // Special case: Escape to blur textarea
        if (e.key === 'Escape') {
          target.blur();
        }
        return;
      }


      // Tool Switching
      if (e.key.toLowerCase() === 'v') setCurrentTool('select');
      if (e.key.toLowerCase() === 'p') { setCurrentTool('pen'); setSelectedId(null); }
      if (e.key.toLowerCase() === 'h') { setCurrentTool('select'); setSelectedId(null); }
      if (e.key.toLowerCase() === 'e') { setCurrentTool('eraser'); setSelectedId(null); }
      if (e.key.toLowerCase() === 'r') { setCurrentTool('rectangle'); setSelectedId(null); }
      if (e.key.toLowerCase() === 'o') { setCurrentTool('circle'); setSelectedId(null); }
      if (e.key.toLowerCase() === 't') { setCurrentTool('text'); setSelectedId(null); }
      if (e.key.toLowerCase() === 'i') fileInputRef.current?.click();

      // Undo/Redo (Cmd/Ctrl + Z / Shift+Z)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        e.preventDefault();
      }

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIdRef.current) {
          deleteSelected();
          e.preventDefault();
        }
      }

      // Escape to clear selection
      if (e.key === 'Escape') {
        setSelectedId(null);
      }

      // Copy/Paste (Cmd/Ctrl + C / V)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        if (selectedIdRef.current) {
          const selectedLayer = layersRef.current.find(l => l.id === selectedIdRef.current);
          if (selectedLayer) {
            clipboardRef.current = JSON.parse(JSON.stringify(selectedLayer));
            e.preventDefault();
          }
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        if (clipboardRef.current) {
          const newLayer = JSON.parse(JSON.stringify(clipboardRef.current));
          newLayer.id = `${newLayer.type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          // Offset the pasted item slightly
          newLayer.x = (newLayer.x || 0) + 20;
          newLayer.y = (newLayer.y || 0) + 20;
          if (newLayer.type === 'drawing') {
            newLayer.points = newLayer.points.map((p: [number, number, number?]) => [p[0] + 20, p[1] + 20, p[2]]);
            if (newLayer.boundingBox) {
              newLayer.boundingBox.minX += 20;
              newLayer.boundingBox.maxX += 20;
              newLayer.boundingBox.minY += 20;
              newLayer.boundingBox.maxY += 20;
            }
          }
          const finalNewLayer = newLayer;
          setLayers(prev => [...prev, finalNewLayer]);
          setSelectedId(finalNewLayer.id);
          e.preventDefault();
        }
      }

      // Select All (Cmd/Ctrl + A)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
      }

      // Nudge (Arrow Keys)
      if (selectedIdRef.current && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const nudgeAmount = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -nudgeAmount : e.key === 'ArrowRight' ? nudgeAmount : 0;
        const dy = e.key === 'ArrowUp' ? -nudgeAmount : e.key === 'ArrowDown' ? nudgeAmount : 0;

        const newLayers = layersRef.current.map(l => {
          if (l.id === selectedIdRef.current) {
            if (l.type === 'drawing') {
              const newPoints = l.points.map(p => [p[0] + dx, p[1] + dy, p[2]] as [number, number, number?]);
              return {
                ...l,
                points: newPoints,
                boundingBox: calculateBoundingBox(newPoints)
              };
            } else {
              return { ...l, x: (l.x || 0) + dx, y: (l.y || 0) + dy };
            }
          }
          return l;
        });
        updateLayers(newLayers);
        e.preventDefault();
      }
    };
    const handleKeyUp = () => {
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedId, layers, historyStep, history]); // Add dependencies needed for handlers

  // Save functionality
  const saveWorkspace = useCallback(() => {
    const workspaceData: WorkspaceData = {
      ...initialDataRef.current,
      layers,
      version: WORKSPACE_VERSION,
      local_version: localVersion,
      canvas_width: CANVAS_WIDTH,
      canvas_height: canvasHeight,
      viewport: {
        zoom: 1,
        x: 0,
        y: 0,
        scroll_top: initialDataRef.current.viewport?.scroll_top || 0
      }
    };

    onUpdateRef.current(workspaceData);
    lastSentVersionRef.current = localVersion;
  }, [layers, localVersion, canvasHeight, stageScale, stagePos]);

  // Handle syncing state to parent
  useEffect(() => {
    // Only trigger sync when internal state changes (layers, canvas height)
    const hasDrawingChanges = localVersion > lastSentVersionRef.current;

    if (hasDrawingChanges) {
      saveWorkspace();
    }
  }, [localVersion, canvasHeight, saveWorkspace]);

  // Infinite height check
  const ensureHeight = useCallback((y: number) => {
    const padding = 300;
    if (y + padding > canvasHeight) {
      setCanvasHeight(prev => {
        const next = y + padding + 500;
        if (next > prev) {
          return next;
        }
        return prev;
      });
    }
  }, [canvasHeight]);

  const updateLayers = useCallback((newLayersOrUpdater: (DrawingPath | MediaLayer | TextLayer | ShapeLayer)[] | ((prev: (DrawingPath | MediaLayer | TextLayer | ShapeLayer)[]) => (DrawingPath | MediaLayer | TextLayer | ShapeLayer)[])) => {
    // Add to history and limit size to prevent memory leaks (max 50 steps)
    const MAX_HISTORY = 50;

    setLayers(prevLayers => {
      const nextLayers = typeof newLayersOrUpdater === 'function' ? newLayersOrUpdater(prevLayers) : newLayersOrUpdater;

      setHistory(prevHistory => {
        let newHistory = prevHistory.slice(0, historyStep + 1);
        newHistory.push(nextLayers);
        if (newHistory.length > MAX_HISTORY) {
          newHistory = newHistory.slice(newHistory.length - MAX_HISTORY);
        }
        return newHistory;
      });

      setHistoryStep(prev => Math.min(prev + 1, MAX_HISTORY - 1));
      setLocalVersion(v => v + 1);

      return nextLayers;
    });
  }, [historyStep]);

  // Zoom logic disabled for pageless model
  const handleWheel = () => {
    // Zoom disabled. Let the browser handle standard scrolling.
  };

  // Tools Logic
  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // Basic palm rejection: ignore touch if a pen was recently used (within 500ms)
    // We use a safe check for pointerType as it might not exist on all event types
    const pointerType = (e.evt as unknown as PointerEvent).pointerType ||
      ((e.evt as unknown as TouchEvent).touches ? 'touch' : 'mouse');

    if (pointerType === 'pen') {
      lastPenTimeRef.current = Date.now();
    } else if (pointerType === 'touch') {
      if (Date.now() - lastPenTimeRef.current < 500) {
        return; // Ignore touch if pen was used recently
      }
    }

    const stage = e.target.getStage();
    if (!stage) return;

    // Record pointer position for panning delta calculation (supports touch)
    const pointerPos = stage.getPointerPosition();
    if (pointerPos) {
      lastPointerPosRef.current = pointerPos;
    }

    if (currentTool === 'select') {
      const clickedOnEmpty = e.target === stage;
      if (clickedOnEmpty) {
        setSelectedId(null);
      }
      return;
    }

    if (currentTool === 'text') {
      const pos = getClampedPointerPosition();
      if (!pos) return;

      const defaultWidth = CANVAS_WIDTH * (2 / 3);
      const maxWidth = dragLimits.maxX - pos.x;
      const finalWidth = Math.min(defaultWidth, maxWidth);

      const newText: TextLayer = {
        type: 'text',
        id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        text: '',
        x: pos.x,
        y: pos.y,
        fontSize: currentFontSize,
        fill: TOOL_CONFIG.text.color,
        rotation: 0,
        width: finalWidth, // Dynamic width based on canvas width and position
      };

      // Better to call updateLayers to ensure history consistency
      updateLayers(prev => [...prev, newText]);
      setCurrentTool('select');
      setSelectedId(newText.id);
      return;
    }

    // Reset selection when starting to draw or erase
    setSelectedId(null);

    isDrawing.current = true;
    deletedLayerIdsRef.current.clear();

    // Use relative pointer position to account for stage scaling
    const pos = getClampedPointerPosition();
    if (!pos) return;

    startPosRef.current = { x: pos.x, y: pos.y };

    if (currentTool === 'rectangle' || currentTool === 'circle' || currentTool === 'arrow') {
      if (currentTool === 'rectangle' && activeRectRef.current) {
        activeRectRef.current.x(pos.x);
        activeRectRef.current.y(pos.y);
        activeRectRef.current.width(0);
        activeRectRef.current.height(0);
        activeRectRef.current.visible(true);
      } else if (currentTool === 'circle' && activeEllipseRef.current) {
        activeEllipseRef.current.x(pos.x);
        activeEllipseRef.current.y(pos.y);
        activeEllipseRef.current.radiusX(0);
        activeEllipseRef.current.radiusY(0);
        activeEllipseRef.current.visible(true);
      } else if (currentTool === 'arrow' && activeArrowRef.current) {
        activeArrowRef.current.points([pos.x, pos.y, pos.x, pos.y]);
        activeArrowRef.current.visible(true);
      }
      stage.batchDraw();
      return;
    }

    const pressure = (e.evt as unknown as PointerEvent).pressure || 0.5;
    currentPointsRef.current = [pos.x, pos.y, pressure];

    // Imperatively update the active line
    if (activeLineRef.current) {
      activeLineRef.current.points([pos.x, pos.y]);
      activeLineRef.current.visible(true);
      activeLineRef.current.getLayer()?.batchDraw();
    }
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!isDrawing.current) return;

    const stage = stageRef.current;
    if (!stage) return;

    const pos = getClampedPointerPosition();
    if (!pos) return;

    if (currentTool === 'eraser') {
      const shape = stage.getIntersection(pos);
      if (shape && shape.getType() === 'Shape' && shape.id()) {
        const id = shape.id();
        if (!deletedLayerIdsRef.current.has(id)) {
          deletedLayerIdsRef.current.add(id);
          updateLayers(prev => prev.filter(l => l.id !== id));
        }
      }
      return;
    }

    if (currentTool === 'rectangle' || currentTool === 'circle' || currentTool === 'arrow') {
      if (!startPosRef.current) return;
      const dx = pos.x - startPosRef.current.x;
      const dy = pos.y - startPosRef.current.y;

      if (currentTool === 'rectangle' && activeRectRef.current) {
        activeRectRef.current.width(dx);
        activeRectRef.current.height(dy);
      } else if (currentTool === 'circle' && activeEllipseRef.current) {
        activeEllipseRef.current.setAttrs({
          x: startPosRef.current.x + dx / 2,
          y: startPosRef.current.y + dy / 2,
          radiusX: Math.abs(dx) / 2,
          radiusY: Math.abs(dy) / 2,
        });
      } else if (currentTool === 'arrow' && activeArrowRef.current) {
        activeArrowRef.current.points([startPosRef.current.x, startPosRef.current.y, pos.x, pos.y]);
      }
      stage.batchDraw();
      return;
    }

    const pressure = (e.evt as unknown as PointerEvent).pressure || 0.5;
    currentPointsRef.current = [...currentPointsRef.current, pos.x, pos.y, pressure];

    if (activeLineRef.current) {
      activeLineRef.current.points(currentPointsRef.current.filter((_, i) => i % 3 !== 2));
      activeLineRef.current.getLayer()?.batchDraw();
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;

    const stage = stageRef.current;
    if (!stage) return;
    const pos = getClampedPointerPosition();
    if (!pos || !startPosRef.current) return;

    if (activeRectRef.current) activeRectRef.current.visible(false);
    if (activeEllipseRef.current) activeEllipseRef.current.visible(false);
    if (activeArrowRef.current) activeArrowRef.current.visible(false);
    if (activeLineRef.current) activeLineRef.current.visible(false);

    let newShape: ShapeLayer | null = null;

    if (currentTool === 'rectangle') {
      const dx = pos.x - startPosRef.current.x;
      const dy = pos.y - startPosRef.current.y;

      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;

      newShape = {
        type: 'shape',
        id: `shape-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        tool: 'rectangle',
        x: dx > 0 ? startPosRef.current.x : pos.x,
        y: dy > 0 ? startPosRef.current.y : pos.y,
        width: Math.abs(dx),
        height: Math.abs(dy),
        rotation: 0,
        stroke: TOOL_CONFIG.rectangle.color,
        strokeWidth: TOOL_CONFIG.rectangle.width,
        fill: '',
      };
    } else if (currentTool === 'circle') {
      const dx = pos.x - startPosRef.current.x;
      const dy = pos.y - startPosRef.current.y;

      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;

      newShape = {
        type: 'shape',
        id: `shape-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        tool: 'circle',
        x: startPosRef.current.x + dx / 2,
        y: startPosRef.current.y + dy / 2,
        width: Math.abs(dx),
        height: Math.abs(dy),
        rotation: 0,
        stroke: TOOL_CONFIG.circle.color,
        strokeWidth: TOOL_CONFIG.circle.width,
        fill: '',
      };
    } else if (currentTool === 'arrow') {
      const dx = pos.x - startPosRef.current.x;
      const dy = pos.y - startPosRef.current.y;

      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;

      newShape = {
        type: 'shape',
        id: `shape-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        tool: 'arrow',
        x: startPosRef.current.x,
        y: startPosRef.current.y,
        width: dx,
        height: dy,
        rotation: 0,
        stroke: TOOL_CONFIG.arrow.color,
        strokeWidth: TOOL_CONFIG.arrow.width,
        fill: '',
      };
    }

    if (newShape) {
      ensureHeight(newShape.y + Math.abs(newShape.height));
      updateLayers(prev => [...prev, newShape!]);
      setCurrentTool('select');
      setSelectedId(newShape.id);
      return;
    }

    const points = currentPointsRef.current;
    if (points.length < 3) return;

    if (currentTool === 'pen' || currentTool === 'highlighter') {
      const bbox = calculateBoundingBox(pointsToTuples(points));
      const newPath: DrawingPath = {
        type: 'drawing',
        id: `path-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        tool: currentTool,
        color: TOOL_CONFIG[currentTool].color,
        width: TOOL_CONFIG[currentTool].width,
        points: pointsToTuples(points),
        boundingBox: bbox,
      };

      if (bbox) {
        ensureHeight(bbox.maxY);
      }
      updateLayers(prev => [...prev, newPath]);
    }

    currentPointsRef.current = [];
    if (stageRef.current) stageRef.current.batchDraw();
  };


  const calculateBoundingBox = (points: [number, number, number?][]) => {
    if (points.length === 0) return undefined;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(p => {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    });
    return { minX, maxX, minY, maxY };
  };

  const pointsToTuples = (flatPoints: number[]): [number, number, number?][] => {
    const tuples: [number, number, number?][] = [];
    for (let i = 0; i < flatPoints.length - 2; i += 3) {
      const x = flatPoints[i];
      const y = flatPoints[i + 1];
      const p = flatPoints[i + 2];
      if (x !== undefined && y !== undefined) {
        // Round to 1 decimal place to reduce JSON size while maintaining precision
        const tuple: [number, number, number?] = [
          Math.round(x * 10) / 10,
          Math.round(y * 10) / 10
        ];
        if (p !== undefined) {
          tuple.push(Math.round(p * 100) / 100);
        }
        tuples.push(tuple);
      }
    }
    return tuples;
  };

  const undo = useCallback(() => {
    if (historyStep === 0) return;
    const prevStep = historyStep - 1;
    const prevLayers = history[prevStep];
    if (prevLayers) {
      setLayers(prevLayers);
      setHistoryStep(prevStep);
      setLocalVersion(v => v + 1);
    }
  }, [historyStep, history]);

  const redo = useCallback(() => {
    if (historyStep === history.length - 1) return;
    const nextStep = historyStep + 1;
    const nextLayers = history[nextStep];
    if (nextLayers) {
      setLayers(nextLayers);
      setHistoryStep(nextStep);
      setLocalVersion(v => v + 1);
    }
  }, [historyStep, history]);

  // Image Upload
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('只支援圖片格式');
      return;
    }

    setIsUploading(true);
    try {
      const compressionOptions = {
        maxSizeMB: 1,
        maxWidthOrHeight: 2000,
        useWebWorker: true,
        initialQuality: 0.8,
        fileType: 'image/webp' as const,
      };

      const compressedFile = await imageCompression(file, compressionOptions);
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
          URL.revokeObjectURL(img.src);
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(compressedFile);
      });

      const data = await apiService.uploadMedicalRecordMedia(recordId, compressedFile as File);

      const maxWidth = 400;
      let width = dimensions.width;
      let height = dimensions.height;
      if (width > maxWidth) {
        const ratio = maxWidth / width;
        width = maxWidth;
        height = height * ratio;
      }

      // Calculate center of current viewport relative to canvas
      let targetX = 100;
      let targetY = 100;

      if (stageRef.current) {
        const container = stageRef.current.container();
        const rect = container.getBoundingClientRect();

        // viewport center in document coordinates
        const viewportCenterY = window.scrollY + window.innerHeight / 2;

        // canvas top in document coordinates
        const canvasTop = rect.top + window.scrollY;

        // target Y is viewport center relative to canvas top, minus half image height
        // Convert visual pixels to logical units by dividing by scale
        targetY = Math.max(20, (viewportCenterY - canvasTop) / scale - height / 2);

        // target X is horizontal center of canvas minus half image width
        targetX = Math.max(0, (CANVAS_WIDTH - width) / 2);
      }

      const newMedia: MediaLayer = {
        type: 'media',
        id: data.id,
        origin: 'upload',
        url: data.url,
        x: targetX,
        y: targetY,
        width,
        height,
        rotation: 0,
      };

      ensureHeight(newMedia.y + newMedia.height);
      updateLayers(prev => [...prev, newMedia]);
      setCurrentTool('select');
      setSelectedId(data.id);

    } catch (err) {
      logger.error('Upload error:', err);
      alert('圖片上傳失敗');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    updateLayers(prev => prev.filter(l => l.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, updateLayers]);

  const moveLayer = (direction: 'up' | 'down' | 'front' | 'back') => {
    if (!selectedId) return;

    updateLayers(prev => {
      const index = prev.findIndex(l => l.id === selectedId);
      if (index === -1) return prev;

      const newLayers = [...prev];
      const current = newLayers[index];
      if (!current) return prev;

      if (direction === 'up' && index < newLayers.length - 1) {
        const target = newLayers[index + 1];
        if (target) {
          newLayers[index] = target;
          newLayers[index + 1] = current;
        }
      } else if (direction === 'down' && index > 0) {
        const target = newLayers[index - 1];
        if (target) {
          newLayers[index] = target;
          newLayers[index - 1] = current;
        }
      } else if (direction === 'front') {
        newLayers.splice(index, 1);
        newLayers.push(current);
      } else if (direction === 'back') {
        newLayers.splice(index, 1);
        newLayers.unshift(current);
      }
      return newLayers;
    });
  };


  return (
    <div className="relative w-full bg-white min-h-screen">
      {/* Toolbar */}
      <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-white rounded-full shadow-2xl px-6 py-2 flex items-center gap-2 z-20 border border-gray-200">
        <ToolButton
          active={currentTool === 'select'}
          onClick={() => setCurrentTool('select')}
          icon={<CursorIcon />}
          label="選取 (V)"
        />
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <ToolButton
          active={currentTool === 'pen'}
          onClick={() => { setCurrentTool('pen'); setSelectedId(null); }}
          icon={<PenIcon />}
          label="畫筆 (P)"
        />
        <ToolButton
          active={currentTool === 'highlighter'}
          onClick={() => { setCurrentTool('highlighter'); setSelectedId(null); }}
          icon={<HighlighterIcon />}
          label="螢光筆"
        />
        <ToolButton
          active={currentTool === 'eraser'}
          onClick={() => { setCurrentTool('eraser'); setSelectedId(null); }}
          icon={<EraserIcon />}
          label="橡皮擦 (E)"
        />
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <ToolButton
          active={currentTool === 'rectangle'}
          onClick={() => { setCurrentTool('rectangle'); setSelectedId(null); }}
          icon={<SquareIcon />}
          label="矩形 (R)"
        />
        <ToolButton
          active={currentTool === 'circle'}
          onClick={() => { setCurrentTool('circle'); setSelectedId(null); }}
          icon={<CircleIcon />}
          label="圓形 (O)"
        />
        <ToolButton
          active={currentTool === 'arrow'}
          onClick={() => { setCurrentTool('arrow'); setSelectedId(null); }}
          icon={<ArrowIcon />}
          label="箭頭"
        />
        <ToolButton
          active={currentTool === 'text'}
          onClick={() => { setCurrentTool('text'); setSelectedId(null); }}
          icon={<TextIcon />}
          label="文字 (T)"
        />
        {(currentTool === 'text' || (selectedId && layers.find(l => l.id === selectedId)?.type === 'text')) && (
          <div className="flex items-center gap-1 ml-1 px-2 py-1 bg-gray-100 rounded-md">
            <span className="text-xs text-gray-500">Aa</span>
            <select
              value={currentFontSize}
              onChange={(e) => handleFontSizeChange(Number(e.target.value))}
              className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
            >
              {[12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64].map(size => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
        )}
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <ToolButton
          onClick={() => fileInputRef.current?.click()}
          icon={<ImageIcon />}
          label="圖片 (I)"
          disabled={isUploading}
        />
        <input
          ref={fileInputRef}
          type="file"
          id="canvas-image-upload"
          aria-label="圖片隱藏輸入"
          hidden
          accept="image/*"
          onChange={handleImageUpload}
        />
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <button onClick={undo} disabled={historyStep === 0} title="還原 (Cmd+Z)" className="p-2 hover:bg-gray-100 rounded-full disabled:opacity-30">
          <UndoIcon />
        </button>
        <button onClick={redo} disabled={historyStep === history.length - 1} title="重做 (Cmd+Shift+Z)" className="p-2 hover:bg-gray-100 rounded-full disabled:opacity-30">
          <RedoIcon />
        </button>
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <SyncStatus status={syncStatus || 'none'} />
      </div>

      {/* Context Menu for selection */}
      {selectedId && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-lg px-4 py-2 flex items-center gap-3 z-20 border border-gray-200">
          <span className="text-xs font-medium text-gray-500 mr-2">
            已選取 {
              layers.find(l => l.id === selectedId)?.type === 'media' ? '圖片' :
                layers.find(l => l.id === selectedId)?.type === 'text' ? '文字' :
                  layers.find(l => l.id === selectedId)?.type === 'shape' ? '圖形' : '筆跡'
            }
          </span>
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
          className="relative bg-white shadow-xl border border-gray-200"
          style={{
            width: CANVAS_WIDTH,
            minHeight: canvasHeight,
            cursor: getStageCursor(),
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
          >
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
            <Layer name="content">
              {layers.map((layer, i) => (
                renderLayer(layer, i)
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
