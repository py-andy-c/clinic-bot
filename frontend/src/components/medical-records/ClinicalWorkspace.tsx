import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Stage, Layer, Line, Image as KonvaImage, Transformer } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import imageCompression from 'browser-image-compression';
import type { WorkspaceData, DrawingPath, MediaLayer, DrawingTool } from '../../types';
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
  eraser: { color: '#ffffff', width: 20 }, // Not used for stroke-based eraser but kept for config consistency
  select: { color: '#3b82f6', width: 1 },
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
          boundBoxFunc={(oldBox, newBox) => {
            // Limit resize
            if (newBox.width < 5 || newBox.height < 5) {
              return oldBox;
            }
            return newBox;
          }}
        />
      )}
    </>
  );
};

// Selectable Drawing Component
const SelectableLine = ({ layer, isSelected, onSelect, onChange }: {
  layer: DrawingPath;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (newAttrs: Partial<DrawingPath>) => void;
}) => {
  const shapeRef = useRef<Konva.Line>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

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
        globalCompositeOperation={
          layer.tool === 'highlighter' ? 'multiply' : 'source-over'
        }
        onDragEnd={(e) => {
           onChange({
             points: layer.points.map(p => [
               p[0] + (e.target.x() / 1),
               p[1] + (e.target.y() / 1),
               p[2] // Preserve pressure
             ] as [number, number, number?])
           });
           // Reset position to 0 since we updated points
           e.target.x(0);
           e.target.y(0);
         }}
         onTransformEnd={() => {
           const node = shapeRef.current;
           if (!node) return;
           const scaleX = node.scaleX();
           const scaleY = node.scaleY();
           
           // Update points based on scale
           const newPoints = layer.points.map(p => [
             p[0] * scaleX,
             p[1] * scaleY,
             p[2] // Preserve pressure
           ] as [number, number, number?]);

          node.scaleX(1);
          node.scaleY(1);

          onChange({
            points: newPoints,
            width: layer.width * ((scaleX + scaleY) / 2) // Rough stroke width scaling
          });
        }}
      />
      {isSelected && (
        <Transformer
          ref={trRef}
          rotateEnabled={false} // Drawing rotation is complex with points
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
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
  const [layers, setLayers] = useState<(DrawingPath | MediaLayer)[]>(initialData.layers || []);
  const [currentTool, setCurrentTool] = useState<DrawingTool>('pen');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canvasHeight, setCanvasHeight] = useState(initialData.canvas_height || MIN_CANVAS_HEIGHT);
  
  // Ref for the current drawing path
  const isDrawing = useRef(false);
  const currentPointsRef = useRef<number[]>([]);
  const deletedLayerIdsRef = useRef<Set<number | string>>(new Set());
  
  const stageRef = useRef<Konva.Stage>(null);
  const activeLineRef = useRef<Konva.Line>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  // Scaling factor
  const scale = CONTAINER_WIDTH / CANVAS_WIDTH;
  
  // History for Undo/Redo
  const [history, setHistory] = useState<(DrawingPath | MediaLayer)[][]>([initialData.layers || []]);
  const [historyStep, setHistoryStep] = useState(0);

  // Sync state
  const [localVersion, setLocalVersion] = useState(0);

  // Save functionality
  const saveWorkspace = useCallback(() => {
    const workspaceData: WorkspaceData = {
      ...initialData,
      layers,
      version: WORKSPACE_VERSION,
      local_version: localVersion,
      canvas_width: CANVAS_WIDTH,
      canvas_height: canvasHeight,
    };

    onUpdate(workspaceData);
  }, [layers, localVersion, onUpdate, initialData, canvasHeight]);

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

  // Tools Logic
  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (currentTool === 'select') {
      const clickedOnEmpty = e.target === e.target.getStage();
      if (clickedOnEmpty) {
        setSelectedId(null);
      }
      return;
    }

    isDrawing.current = true;
    deletedLayerIdsRef.current.clear();
    const stage = e.target.getStage();
    if (!stage) return;
    
    // Use relative pointer position to account for stage scaling
    const pos = stage.getRelativePointerPosition();
    if (!pos) return;
    
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
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pos = stage.getRelativePointerPosition();
    if (!pos) return;

    if (currentTool === 'eraser') {
       // Stroke-based eraser: find all lines that intersect with current pointer
       const hitRadius = TOOL_CONFIG.eraser.width / 2;
       let hasHit = false;
       
       layers.forEach((layer) => {
        if (layer.type !== 'drawing') return;
        const drawing = layer as DrawingPath;
        if (drawing.tool === 'eraser') return;
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
    
    // Imperative update - NO React state change here
    if (activeLineRef.current) {
      activeLineRef.current.points([...currentPointsRef.current]);
      activeLineRef.current.getLayer()?.batchDraw();
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    
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

    const newPath: DrawingPath = {
      type: 'drawing',
      id: `path-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      tool: currentTool,
      color: TOOL_CONFIG[currentTool].color,
      width: TOOL_CONFIG[currentTool].width,
      points: pointsToTuples(points),
      boundingBox: minX !== Infinity ? { minX, maxX, minY, maxY } : undefined,
    };

    const newLayers = [...layers, newPath];
    updateLayers(newLayers);
    
    // Clear and hide active line
    currentPointsRef.current = [];
    if (activeLineRef.current) {
      activeLineRef.current.points([]);
      activeLineRef.current.visible(false);
      activeLineRef.current.getLayer()?.batchDraw();
    }
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

  const updateLayers = (newLayers: (DrawingPath | MediaLayer)[]) => {
    // Add to history
    const newHistory = history.slice(0, historyStep + 1);
    newHistory.push(newLayers);
    setHistory(newHistory);
    setHistoryStep(newHistory.length - 1);
    
    setLayers(newLayers);
    setLocalVersion(v => v + 1);
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
    const newLayers = layers.filter(l => {
      if (l.type === 'media') return l.id !== selectedId;
      if (l.type === 'drawing') return l.id !== selectedId;
      return true;
    });
    updateLayers(newLayers);
    setSelectedId(null);
  };
  
  const moveLayer = (direction: 'up' | 'down' | 'front' | 'back') => {
      if (!selectedId) return;
      const index = layers.findIndex(l => {
        if (l.type === 'media') return l.id === selectedId;
        if (l.type === 'drawing') return l.id === selectedId;
        return false;
      });
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
         <SyncStatus status={syncStatus || 'none'} />
      </div>
      
      {/* Context Menu */}
      {selectedId && (
          <div className="fixed top-6 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-lg px-4 py-2 flex items-center gap-3 z-20 animate-fade-in border border-gray-200">
              <span className="text-sm font-medium text-gray-600 mr-2">
                已選取 {layers.find(l => (l.type === 'media' && l.id === selectedId) || (l.type === 'drawing' && l.id === selectedId))?.type === 'media' ? '圖片' : '筆跡'}
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
                cursor: currentTool === 'select' ? 'default' : 'crosshair'
            }}
        >
            <Stage
              ref={stageRef}
              width={CONTAINER_WIDTH}
              height={canvasHeight * scale}
              scaleX={scale}
              scaleY={scale}
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
                        onSelect={() => {
                            if (currentTool === 'select') {
                                setSelectedId(drawing.id);
                            }
                        }}
                        onChange={(newAttrs) => {
                          const newLayers = [...layers];
                          newLayers[i] = { ...drawing, ...newAttrs } as DrawingPath;
                          updateLayers(newLayers);
                        }}
                      />
                    );
                  }
                  return null;
                })}
                
                {/* Current drawing path - always present but hidden when not drawing */}
                <Line
                   ref={activeLineRef}
                   points={[]}
                   stroke={TOOL_CONFIG[currentTool].color}
                   strokeWidth={TOOL_CONFIG[currentTool].width}
                   tension={0.5}
                   lineCap="round"
                   lineJoin="round"
                   visible={false}
                   globalCompositeOperation={
                     currentTool === 'highlighter' ? 'multiply' : 'source-over'
                   }
                 />
              </Layer>
            </Stage>
        </div>
      </div>
    </div>
  );
};

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
