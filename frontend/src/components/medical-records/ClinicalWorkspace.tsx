import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Stage, Layer, Line, Image as KonvaImage, Transformer, Text as KonvaText, Rect, Arrow, Ellipse } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import imageCompression from 'browser-image-compression';
import type { WorkspaceData, DrawingPath, MediaLayer, TextLayer, ShapeLayer, DrawingTool } from '../../types';
import { logger } from '../../utils/logger';
import { apiService } from '../../services/api';
import { SyncStatus, SyncStatusType } from './SyncStatus';

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
  text: { color: '#000000', width: 1 },
  hand: { color: '#000000', width: 1 },
  rectangle: { color: '#000000', width: 2 },
  circle: { color: '#000000', width: 2 },
  arrow: { color: '#000000', width: 2 },
};

const CANVAS_WIDTH = 1000; // Logical width for coordinates
const CONTAINER_WIDTH = 850; // Visual container width
const MIN_CANVAS_HEIGHT = 1100;
const WORKSPACE_VERSION = 2;

// Helper to calculate distance from point (px, py) to segment (x1, y1) -> (x2, y2)
const getDistanceToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2);
};

// Helper component for loading images
const UrlImage = ({ layer, isSelected, onSelect, onChange }: { 
  layer: MediaLayer; 
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: Partial<MediaLayer>) => void;
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
        onDragEnd={(e) => {
          setIsMoving(false);
          onChange({
            x: e.target.x(),
            y: e.target.y(),
          });
        }}
        onTransformStart={() => setIsMoving(true)}
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
            // Limit resize
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
const SelectableLine = ({ layer, isSelected, onSelect, onChange, calculateBoundingBox }: {
  layer: DrawingPath;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: Partial<DrawingPath>) => void;
  calculateBoundingBox: (points: [number, number, number?][]) => { minX: number; maxX: number; minY: number; maxY: number } | undefined;
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
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    
    const newPoints = layer.points.map(p => {
      const transformed = transform.point({ x: p[0], y: p[1] });
      return [transformed.x, transformed.y, p[2]] as [number, number, number?];
    });

    // Reset node properties
    node.setAttrs({
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0
    });

    onChange({
      points: newPoints,
      width: layer.width * ((scaleX + scaleY) / 2),
      boundingBox: calculateBoundingBox(newPoints)
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
        points={layer.points.flatMap(p => [p[0], p[1]])}
        stroke={layer.color}
        strokeWidth={layer.width}
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
        onDragEnd={handleDragEnd}
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
const SelectableText = ({ layer, isSelected, onSelect, onChange }: {
  layer: TextLayer;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: Partial<TextLayer>) => void;
}) => {
  const shapeRef = useRef<Konva.Text>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const handleDblClick = () => {
    const textNode = shapeRef.current;
    if (!textNode) return;

    // Create textarea to edit text
    const stage = textNode.getStage();
    if (!stage) return;

    const textPosition = textNode.getAbsolutePosition();
    const stageBox = stage.container().getBoundingClientRect();

    const areaPosition = {
      x: stageBox.left + textPosition.x,
      y: stageBox.top + textPosition.y,
    };

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    textarea.value = textNode.text();
    textarea.style.position = 'absolute';
    textarea.style.top = areaPosition.y + 'px';
    textarea.style.left = areaPosition.x + 'px';
    textarea.style.width = textNode.width() * stage.scaleX() + 'px';
    textarea.style.height = textNode.height() * stage.scaleY() + 'px';
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

    textarea.focus();

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        textarea.blur();
      }
      if (e.key === 'Escape') {
        textarea.value = textNode.text(); // Revert to original text
        textarea.blur();
      }
    });

    textarea.addEventListener('blur', () => {
      onChange({ text: textarea.value });
      document.body.removeChild(textarea);
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
        onClick={onSelect}
        onTap={onSelect}
        onDblClick={handleDblClick}
        onDblTap={handleDblClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onDragEnd={(e) => {
          onChange({
            x: e.target.x(),
            y: e.target.y(),
          });
        }}
        onTransformEnd={() => {
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
            fontSize: node.fontSize() * scaleY,
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
            newBox.width = Math.max(30, newBox.width);
            return newBox;
          }}
        />
      )}
    </>
  );
};

// Selectable Shape Component
const SelectableShape = ({ layer, isSelected, onSelect, onChange }: {
  layer: ShapeLayer;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: Partial<ShapeLayer>) => void;
}) => {
  const shapeRef = useRef<Konva.Shape>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  // For Arrow, we need to pass points. For Rect/Circle, we pass width/height.
  const baseProps = {
    id: layer.id,
    x: layer.x,
    y: layer.y,
    rotation: layer.rotation,
    stroke: layer.stroke,
    strokeWidth: layer.strokeWidth,
    fill: layer.fill || '',
    draggable: isSelected,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      onChange({
        x: e.target.x(),
        y: e.target.y(),
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
      {layer.tool === 'arrow' ? (
        <Arrow 
          {...baseProps} 
          ref={shapeRef as React.Ref<Konva.Arrow>} 
          points={[0, 0, layer.width, layer.height]} 
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        />
      ) : layer.tool === 'rectangle' ? (
        <Rect 
          {...baseProps} 
          ref={shapeRef as React.Ref<Konva.Rect>} 
          width={layer.width} 
          height={layer.height} 
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        />
      ) : (
        <Ellipse 
          {...baseProps} 
          ref={shapeRef as React.Ref<Konva.Ellipse>} 
          width={layer.width} 
          height={layer.height} 
          radiusX={layer.width / 2}
          radiusY={layer.height / 2}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
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
  const [layers, setLayers] = useState<(DrawingPath | MediaLayer | TextLayer | ShapeLayer)[]>(initialData.layers || []);
  const [currentTool, setCurrentTool] = useState<DrawingTool>('pen');
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
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  
  // Scaling factor for logical to visual container
  const baseScale = CONTAINER_WIDTH / CANVAS_WIDTH;
  
  // Get stage cursor based on tool
  const getStageCursor = () => {
    if (isPanning) return 'grabbing';
    if (isSpacePressed) return 'grab';
    switch (currentTool) {
      case 'hand': return 'grab';
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

  // Viewport state (Zoom and Pan)
  const [stageScale, setStageScale] = useState(initialData.viewport?.zoom || 1);
  const [stagePos, setStagePos] = useState({ x: initialData.viewport?.x || 0, y: initialData.viewport?.y || 0 });
  const [isPanning, setIsPanning] = useState(false);

  // Combined scale for rendering
  const scale = baseScale * stageScale;
  
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
      // Spacebar panning
      if (e.code === 'Space' && !isSpacePressed && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') {
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSpacePressed]);

  // Save functionality
  const saveWorkspace = useCallback(() => {
    const workspaceData: WorkspaceData = {
      ...initialData,
      layers,
      version: WORKSPACE_VERSION,
      local_version: localVersion,
      canvas_width: CANVAS_WIDTH,
      canvas_height: canvasHeight,
      viewport: {
        zoom: stageScale,
        x: stagePos.x,
        y: stagePos.y,
        scroll_top: window.scrollY
      }
    };

    onUpdate(workspaceData);
  }, [layers, localVersion, onUpdate, initialData, canvasHeight, stageScale, stagePos]);

  // Remove local debouncing - parent MedicalRecordEditorPage handles it
  useEffect(() => {
    if (localVersion > 0) {
      saveWorkspace();
    }
  }, [localVersion, saveWorkspace]);

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

  const updateLayers = (newLayers: (DrawingPath | MediaLayer | TextLayer | ShapeLayer)[]) => {
    // Add to history
    const newHistory = history.slice(0, historyStep + 1);
    newHistory.push(newLayers);
    setHistory(newHistory);
    setHistoryStep(newHistory.length - 1);
    
    setLayers(newLayers);
    setLocalVersion(v => v + 1);
  };

  // Zoom logic
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    // Zoom only if Ctrl/Cmd is pressed
    if (!e.evt.ctrlKey && !e.evt.metaKey) return;
    
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const zoomSpeed = 1.1;
    const newScale = e.evt.deltaY > 0 ? oldScale / zoomSpeed : oldScale * zoomSpeed;
    const boundedScale = Math.max(0.2, Math.min(5, newScale)); // Bounded between 20% and 500%

    setStageScale(boundedScale / baseScale); // Adjust stageScale relative to baseScale
    setStagePos({
      x: pointer.x - mousePointTo.x * boundedScale,
      y: pointer.y - mousePointTo.y * boundedScale,
    });
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

    if (currentTool === 'hand' || isSpacePressed) {
      isDrawing.current = true; // Use as isPanning
      setIsPanning(true);
      return;
    }

    if (currentTool === 'select') {
      const clickedOnEmpty = e.target === stage;
      if (clickedOnEmpty) {
        setSelectedId(null);
      }
      return;
    }

    if (currentTool === 'text') {
      const pos = stage.getRelativePointerPosition();
      if (!pos) return;

      const newText: TextLayer = {
        type: 'text',
        id: `text-${Date.now()}`,
        text: '點擊編輯',
        x: pos.x,
        y: pos.y,
        fontSize: 20,
        fill: TOOL_CONFIG.text.color,
        rotation: 0,
      };

      updateLayers([...layers, newText]);
      setCurrentTool('select');
      setSelectedId(newText.id);
      return;
    }

    // Reset selection when starting to draw or erase
    setSelectedId(null);

    isDrawing.current = true;
    deletedLayerIdsRef.current.clear();
    
    // Use relative pointer position to account for stage scaling
    const pos = stage.getRelativePointerPosition();
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

    const newPoints = [pos.x, pos.y];
    currentPointsRef.current = newPoints;
    
    // Imperatively update the active line
    if (activeLineRef.current) {
      activeLineRef.current.points(newPoints);
      activeLineRef.current.visible(true);
      activeLineRef.current.getLayer()?.batchDraw();
    }
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!isDrawing.current) return;
    
    const stage = stageRef.current;
    if (!stage) return;

    if (currentTool === 'hand' || isSpacePressed) {
      const pos = stage.getPointerPosition();
      if (pos && lastPointerPosRef.current) {
        const dx = pos.x - lastPointerPosRef.current.x;
        const dy = pos.y - lastPointerPosRef.current.y;
        lastPointerPosRef.current = pos;
        
        setStagePos(prev => ({ 
          x: prev.x + dx, 
          y: prev.y + dy 
        }));
      }
      return;
    }
    
    const pos = stage.getRelativePointerPosition();
    if (!pos) return;

    if (currentTool === 'rectangle' && activeRectRef.current && startPosRef.current) {
      let width = pos.x - startPosRef.current.x;
      let height = pos.y - startPosRef.current.y;
      
      if (e.evt.shiftKey) {
        const size = Math.max(Math.abs(width), Math.abs(height));
        width = width > 0 ? size : -size;
        height = height > 0 ? size : -size;
      }
      
      activeRectRef.current.width(width);
      activeRectRef.current.height(height);
      stage.batchDraw();
      return;
    }

    if (currentTool === 'circle' && activeEllipseRef.current && startPosRef.current) {
      const dx = pos.x - startPosRef.current.x;
      const dy = pos.y - startPosRef.current.y;
      
      if (e.evt.shiftKey) {
        const radius = Math.max(Math.abs(dx), Math.abs(dy));
        activeEllipseRef.current.radiusX(radius);
        activeEllipseRef.current.radiusY(radius);
      } else {
        activeEllipseRef.current.radiusX(Math.abs(dx));
        activeEllipseRef.current.radiusY(Math.abs(dy));
      }
      
      stage.batchDraw();
      return;
    }

    if (currentTool === 'arrow' && activeArrowRef.current && startPosRef.current) {
      let endX = pos.x;
      let endY = pos.y;
      
      if (e.evt.shiftKey) {
        const dx = pos.x - startPosRef.current.x;
        const dy = pos.y - startPosRef.current.y;
        const angle = Math.atan2(dy, dx);
        const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        const dist = Math.sqrt(dx * dx + dy * dy);
        endX = startPosRef.current.x + Math.cos(snappedAngle) * dist;
        endY = startPosRef.current.y + Math.sin(snappedAngle) * dist;
      }
      
      activeArrowRef.current.points([startPosRef.current.x, startPosRef.current.y, endX, endY]);
      stage.batchDraw();
      return;
    }

    // Optimization: Disable perfectDraw during interaction
    if (activeLineRef.current) {
      activeLineRef.current.perfectDrawEnabled(false);
      activeLineRef.current.listening(false); // Don't intercept own events
    }

    if (currentTool === 'eraser') {
       // Stroke-based eraser: find all lines that intersect with current pointer
       const hitRadius = TOOL_CONFIG.eraser.width / 2;
       let hasHit = false;
       
       layers.forEach((layer) => {
        if (layer.type !== 'drawing') return;
        const drawing = layer as DrawingPath;
        // Skip highlighter/pen check if we're erasing
        if (deletedLayerIdsRef.current.has(drawing.id)) return;

        // Bounding box optimization
        if (drawing.boundingBox) {
          const { minX, maxX, minY, maxY } = drawing.boundingBox;
          if (
            pos.x < minX - hitRadius ||
            pos.x > maxX + hitRadius ||
            pos.y < minY - hitRadius ||
            pos.y > maxY + hitRadius
          ) {
            return;
          }
        }

        // Detailed check
        const isHit = drawing.points.some((p, i) => {
          if (i === 0) {
            const dx = p[0] - pos.x;
            const dy = p[1] - pos.y;
            return Math.sqrt(dx * dx + dy * dy) < hitRadius;
          }
          const prev = drawing.points[i - 1];
          if (!prev) return false;
          return getDistanceToSegment(pos.x, pos.y, prev[0], prev[1], p[0], p[1]) < hitRadius;
        });

        if (isHit) {
          deletedLayerIdsRef.current.add(drawing.id);
          hasHit = true;
          
          // Imperatively hide the node for performance
          const node = stage.findOne('#' + drawing.id);
          if (node) {
            node.visible(false);
          }
        }
      });

      if (hasHit) {
         stage.batchDraw();
       }
       return;
    }
    
    currentPointsRef.current.push(pos.x, pos.y);
    
    // Live canvas extension for smoother infinite vertical growth
    if (pos.y > canvasHeight - 200) {
      ensureHeight(pos.y);
    }
    
    // Imperative update - NO React state change here
    if (activeLineRef.current) {
      activeLineRef.current.points([...currentPointsRef.current]);
      activeLineRef.current.getLayer()?.batchDraw();
    }
  };

  const handleMouseUp = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    setIsPanning(false);
    lastPointerPosRef.current = null;

    // Optimization: Re-enable perfectDraw after interaction
    if (activeLineRef.current) {
      activeLineRef.current.perfectDrawEnabled(true);
      activeLineRef.current.visible(false); // Hide the imperative line
    }

    if (currentTool === 'hand') return;
    
    if (currentTool === 'eraser') {
      if (deletedLayerIdsRef.current.size > 0) {
        const newLayers = layers.filter(layer => {
          if (layer.type === 'drawing') {
            return !deletedLayerIdsRef.current.has((layer as DrawingPath).id);
          }
          return true;
        });
        updateLayers(newLayers);
      }
      return;
    }

    const stage = stageRef.current;
    const pos = stage?.getRelativePointerPosition();
    if (!pos || !startPosRef.current) return;

    if (currentTool === 'rectangle' || currentTool === 'circle' || currentTool === 'arrow') {
      let newShape: ShapeLayer | null = null;
      
      if (currentTool === 'rectangle') {
        let width = pos.x - startPosRef.current.x;
        let height = pos.y - startPosRef.current.y;
        
        if (e.evt.shiftKey) {
          const size = Math.max(Math.abs(width), Math.abs(height));
          width = width > 0 ? size : -size;
          height = height > 0 ? size : -size;
        }

        if (Math.abs(width) < 5 && Math.abs(height) < 5) {
          if (activeRectRef.current) activeRectRef.current.visible(false);
          return;
        }
        newShape = {
          type: 'shape',
          id: `shape-${Date.now()}`,
          tool: 'rectangle',
          x: width > 0 ? startPosRef.current.x : startPosRef.current.x + width,
          y: height > 0 ? startPosRef.current.y : startPosRef.current.y + height,
          width: Math.abs(width),
          height: Math.abs(height),
          rotation: 0,
          stroke: TOOL_CONFIG.rectangle.color,
          strokeWidth: TOOL_CONFIG.rectangle.width,
        };
        if (activeRectRef.current) activeRectRef.current.visible(false);
      } else if (currentTool === 'circle') {
        const dx = pos.x - startPosRef.current.x;
        const dy = pos.y - startPosRef.current.y;
        
        let width, height;
        if (e.evt.shiftKey) {
          const radius = Math.max(Math.abs(dx), Math.abs(dy));
          width = radius * 2;
          height = radius * 2;
        } else {
          width = Math.abs(dx) * 2;
          height = Math.abs(dy) * 2;
        }

        if (width < 5 && height < 5) {
          if (activeEllipseRef.current) activeEllipseRef.current.visible(false);
          return;
        }
        newShape = {
          type: 'shape',
          id: `shape-${Date.now()}`,
          tool: 'circle',
          x: startPosRef.current.x,
          y: startPosRef.current.y,
          width: width,
          height: height,
          rotation: 0,
          stroke: TOOL_CONFIG.circle.color,
          strokeWidth: TOOL_CONFIG.circle.width,
        };
        if (activeEllipseRef.current) activeEllipseRef.current.visible(false);
      } else if (currentTool === 'arrow') {
        let endX = pos.x;
        let endY = pos.y;
        
        if (e.evt.shiftKey) {
          const dx = pos.x - startPosRef.current.x;
          const dy = pos.y - startPosRef.current.y;
          const angle = Math.atan2(dy, dx);
          const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
          const dist = Math.sqrt(dx * dx + dy * dy);
          endX = startPosRef.current.x + Math.cos(snappedAngle) * dist;
          endY = startPosRef.current.y + Math.sin(snappedAngle) * dist;
        }

        const dx = endX - startPosRef.current.x;
        const dy = endY - startPosRef.current.y;
        
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
          if (activeArrowRef.current) activeArrowRef.current.visible(false);
          return;
        }
        newShape = {
          type: 'shape',
          id: `shape-${Date.now()}`,
          tool: 'arrow',
          x: startPosRef.current.x,
          y: startPosRef.current.y,
          width: dx,
          height: dy,
          rotation: 0,
          stroke: TOOL_CONFIG.arrow.color,
          strokeWidth: TOOL_CONFIG.arrow.width,
        };
        if (activeArrowRef.current) activeArrowRef.current.visible(false);
      }

      if (newShape) {
        ensureHeight(newShape.y + newShape.height);
        updateLayers([...layers, newShape]);
        setCurrentTool('select');
        setSelectedId(newShape.id);
      }
      return;
    }

    const points = currentPointsRef.current;
    if (points.length === 0) return;

    // Check for height extension and calculate bounding box
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i];
      const y = points[i + 1];
      if (x !== undefined && y !== undefined) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    
    if (maxY !== -Infinity) {
      ensureHeight(maxY);
    }

    if (currentTool === 'pen' || currentTool === 'highlighter') {
      const newPath: DrawingPath = {
        type: 'drawing',
        id: `path-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        tool: currentTool,
        color: TOOL_CONFIG[currentTool].color,
        width: TOOL_CONFIG[currentTool].width,
        points: pointsToTuples(points),
        boundingBox: minX !== Infinity ? { minX, maxX, minY, maxY } : undefined,
      };

      const newLayers = [...layers, newPath];
      updateLayers(newLayers);
    }
    
    // Clear and hide active line
    currentPointsRef.current = [];
    if (activeLineRef.current) {
      activeLineRef.current.points([]);
      activeLineRef.current.visible(false);
      activeLineRef.current.getLayer()?.batchDraw();
    }
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
    for (let i = 0; i < flatPoints.length - 1; i += 2) {
      const x = flatPoints[i];
      const y = flatPoints[i + 1];
      if (x !== undefined && y !== undefined) {
        tuples.push([x, y]);
      }
    }
    return tuples;
  };

  const undo = () => {
    if (historyStep === 0) return;
    const prevStep = historyStep - 1;
    const prevLayers = history[prevStep];
    if (prevLayers) {
        setLayers(prevLayers);
        setHistoryStep(prevStep);
        setLocalVersion(v => v + 1);
    }
  };

  const redo = () => {
    if (historyStep === history.length - 1) return;
    const nextStep = historyStep + 1;
    const nextLayers = history[nextStep];
    if (nextLayers) {
        setLayers(nextLayers);
        setHistoryStep(nextStep);
        setLocalVersion(v => v + 1);
    }
  };

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
      updateLayers([...layers, newMedia]);
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

  const deleteSelected = () => {
    if (!selectedId) return;
    const newLayers = layers.filter(l => l.id !== selectedId);
    updateLayers(newLayers);
    setSelectedId(null);
  };
  
  const moveLayer = (direction: 'up' | 'down' | 'front' | 'back') => {
      if (!selectedId) return;
      const index = layers.findIndex(l => l.id === selectedId);
      if (index === -1) return;
      
      const newLayers = [...layers];
      const current = newLayers[index];
      if (!current) return;

      if (direction === 'up' && index < layers.length - 1) {
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
      updateLayers(newLayers);
  };

  const [zoomLevel, setZoomLevel] = useState(100);
  useEffect(() => {
    setZoomLevel(Math.round(stageScale * 100));
  }, [stageScale]);

  return (
    <div className="relative w-full bg-gray-200 min-h-full">
       {/* Toolbar */}
      <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-white rounded-full shadow-2xl px-6 py-3 flex items-center gap-4 z-20 border border-gray-200">
         <div className="flex items-center gap-2">
            <ToolButton 
                active={currentTool === 'select'} 
                onClick={() => setCurrentTool('select')} 
                icon={<CursorIcon />} 
                label="選取"
            />
             <div className="w-px h-6 bg-gray-300 mx-1" />
            <ToolButton 
                active={currentTool === 'pen'} 
                onClick={() => { setCurrentTool('pen'); setSelectedId(null); }} 
                icon={<PenIcon />} 
                label="畫筆"
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
                    label="橡皮擦"
                />
                <div className="w-px h-6 bg-gray-300 mx-1" />
                <ToolButton 
                    active={currentTool === 'rectangle'} 
                    onClick={() => { setCurrentTool('rectangle'); setSelectedId(null); }} 
                    icon={<SquareIcon />} 
                    label="矩形"
                />
                <ToolButton 
                    active={currentTool === 'circle'} 
                    onClick={() => { setCurrentTool('circle'); setSelectedId(null); }} 
                    icon={<CircleIcon />} 
                    label="圓形"
                />
                <ToolButton 
                    active={currentTool === 'arrow'} 
                    onClick={() => { setCurrentTool('arrow'); setSelectedId(null); }} 
                    icon={<ArrowIcon />} 
                    label="箭頭"
                />
                <div className="w-px h-6 bg-gray-300 mx-1" />
                <ToolButton 
                    active={currentTool === 'text'} 
                    onClick={() => { setCurrentTool('text'); setSelectedId(null); }} 
                    icon={<TextIcon />} 
                    label="文字"
                />
                <ToolButton 
                    active={currentTool === 'hand'} 
                    onClick={() => { setCurrentTool('hand'); setSelectedId(null); }} 
                    icon={<HandIcon />} 
                    label="平移"
                />
                <div className="w-px h-6 bg-gray-300 mx-1" />
                <ToolButton 
                    onClick={() => fileInputRef.current?.click()} 
                    icon={<ImageIcon />} 
                    label="圖片"
                    disabled={isUploading}
                />
            <input 
                ref={fileInputRef} 
                type="file" 
                hidden 
                accept="image/*" 
                onChange={handleImageUpload} 
            />
         </div>
         
         <div className="w-px h-6 bg-gray-300 mx-1" />
         
         <div className="flex items-center gap-2">
             <button onClick={undo} disabled={historyStep === 0} className="p-2 hover:bg-gray-100 rounded-full disabled:opacity-30">
                 <UndoIcon />
             </button>
             <button onClick={redo} disabled={historyStep === history.length - 1} className="p-2 hover:bg-gray-100 rounded-full disabled:opacity-30">
                 <RedoIcon />
             </button>
         </div>

         <div className="w-px h-6 bg-gray-300 mx-1" />
         
         <div className="flex items-center gap-2">
            <button 
              onClick={() => {
                const newScale = Math.max(0.2, stageScale / 1.1);
                setStageScale(newScale);
              }}
              className="p-1 hover:bg-gray-100 rounded"
            >
              -
            </button>
            <span className="text-xs font-mono w-10 text-center">{zoomLevel}%</span>
            <button 
              onClick={() => {
                const newScale = Math.min(5, stageScale * 1.1);
                setStageScale(newScale);
              }}
              className="p-1 hover:bg-gray-100 rounded"
            >
              +
            </button>
         </div>

         <div className="w-px h-6 bg-gray-300 mx-1" />
         <SyncStatus status={syncStatus || 'none'} />
      </div>
      
      {/* Context Menu */}
      {selectedId && (
          <div className="fixed top-6 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-lg px-4 py-2 flex items-center gap-3 z-20 animate-fade-in border border-gray-200">
              <span className="text-sm font-medium text-gray-600 mr-2">
                已選取 {
                  layers.find(l => (l.id === selectedId))?.type === 'media' ? '圖片' : 
                  layers.find(l => (l.id === selectedId))?.type === 'text' ? '文字' : 
                  layers.find(l => (l.id === selectedId))?.type === 'shape' ? '圖形' : '筆跡'
                }
              </span>
              <div className="flex items-center gap-1">
                <ContextButton onClick={() => moveLayer('front')} label="最上層" />
                <ContextButton onClick={() => moveLayer('up')} label="上移" />
                <ContextButton onClick={() => moveLayer('down')} label="下移" />
                <ContextButton onClick={() => moveLayer('back')} label="最下層" />
              </div>
              <div className="w-px h-4 bg-gray-300 mx-1" />
              <button onClick={deleteSelected} className="text-red-500 hover:text-red-700 text-sm font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors">刪除</button>
          </div>
      )}

      {/* Scrollable Container */}
      <div 
        className="relative touch-none py-12 overflow-x-auto"
      >
        {/* Paper Surface */}
        <div 
            className="bg-white mx-auto shadow-xl relative"
            style={{ 
                width: CONTAINER_WIDTH, 
                minHeight: canvasHeight * scale,
                cursor: getStageCursor()
            }}
        >
            <Stage
              ref={stageRef}
              width={CONTAINER_WIDTH}
              height={canvasHeight * scale}
              scaleX={scale}
              scaleY={scale}
              x={stagePos.x}
              y={stagePos.y}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onTouchStart={handleMouseDown}
              onTouchMove={handleMouseMove}
              onTouchEnd={handleMouseUp}
            >
              {/* Background Template Layer - Static */}
              <Layer name="background" listening={false}>
                 {initialData.background_image_url && (
                     <BackgroundImage url={initialData.background_image_url} width={CANVAS_WIDTH} />
                 )}
              </Layer>
    
              {/* Unified Content Layer - Dynamic Interleaved Z-Ordering */}
              <Layer name="content">
                {layers.map((layer, i) => {
                  if (layer.type === 'media') {
                    const mediaLayer = layer as MediaLayer;
                    return (
                      <UrlImage
                        key={mediaLayer.id}
                        layer={mediaLayer}
                        isSelected={mediaLayer.id === selectedId}
                        onSelect={() => {
                            if (currentTool === 'select') {
                                setSelectedId(mediaLayer.id);
                            }
                        }}
                        onChange={(newAttrs) => {
                          const newLayers = [...layers];
                          newLayers[i] = { ...mediaLayer, ...newAttrs } as MediaLayer;
                          updateLayers(newLayers);
                          if (newAttrs.y || newAttrs.height) {
                             ensureHeight((newAttrs.y || mediaLayer.y) + (newAttrs.height || mediaLayer.height));
                          }
                        }}
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
                        onSelect={() => {
                            if (currentTool === 'select') {
                                setSelectedId(drawing.id);
                            }
                        }}
                        onChange={(newAttrs) => {
                          const newLayers = [...layers];
                          newLayers[i] = { ...drawing, ...newAttrs } as DrawingPath;
                          updateLayers(newLayers);
                          if (newAttrs.points) {
                            const d = newLayers[i] as DrawingPath;
                            if (d.boundingBox) {
                               ensureHeight(d.boundingBox.maxY);
                            }
                          }
                        }}
                      />
                    );
                  } else if (layer.type === 'text') {
                    const textLayer = layer as TextLayer;
                    return (
                      <SelectableText
                        key={textLayer.id}
                        layer={textLayer}
                        isSelected={textLayer.id === selectedId}
                        onSelect={() => {
                          if (currentTool === 'select') {
                            setSelectedId(textLayer.id);
                          }
                        }}
                        onChange={(newAttrs) => {
                          const newLayers = [...layers];
                          newLayers[i] = { ...textLayer, ...newAttrs } as TextLayer;
                          updateLayers(newLayers);
                          if (newAttrs.y || newAttrs.fontSize) {
                            ensureHeight((newAttrs.y || textLayer.y) + (newAttrs.fontSize || textLayer.fontSize) * 2);
                          }
                        }}
                      />
                    );
                  } else if (layer.type === 'shape') {
                    const shapeLayer = layer as ShapeLayer;
                    return (
                      <SelectableShape
                        key={shapeLayer.id}
                        layer={shapeLayer}
                        isSelected={shapeLayer.id === selectedId}
                        onSelect={() => {
                          if (currentTool === 'select') {
                            setSelectedId(shapeLayer.id);
                          }
                        }}
                        onChange={(newAttrs) => {
                          const newLayers = [...layers];
                          newLayers[i] = { ...shapeLayer, ...newAttrs } as ShapeLayer;
                          updateLayers(newLayers);
                          if (newAttrs.y || newAttrs.height) {
                            ensureHeight((newAttrs.y || shapeLayer.y) + (newAttrs.height || shapeLayer.height));
                          }
                        }}
                      />
                    );
                  }
                  return null;
                })}
                
                {/* Active Previews */}
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
                   globalCompositeOperation={
                     currentTool === 'highlighter' ? 'multiply' : 'source-over'
                   }
                 />
                <Rect
                  ref={activeRectRef}
                  stroke={TOOL_CONFIG.rectangle.color}
                  strokeWidth={TOOL_CONFIG.rectangle.width}
                  visible={false}
                />
                <Ellipse
                  ref={activeEllipseRef}
                  radiusX={0}
                  radiusY={0}
                  stroke={TOOL_CONFIG.circle.color}
                  strokeWidth={TOOL_CONFIG.circle.width}
                  visible={false}
                />
                <Arrow
                  ref={activeArrowRef}
                  points={[0, 0, 0, 0]}
                  stroke={TOOL_CONFIG.arrow.color}
                  strokeWidth={TOOL_CONFIG.arrow.width}
                  visible={false}
                />
              </Layer>
            </Stage>
        </div>
      </div>
    </div>
  );
};

const HandIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v5" />
    <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v10" />
    <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>
);

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
        className={`p-3 rounded-xl transition-all duration-200 flex items-center justify-center ${
            active 
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
