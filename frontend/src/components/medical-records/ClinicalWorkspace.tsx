import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { WorkspaceData, DrawingPath, MediaLayer, DrawingTool } from '../../types';
import { logger } from '../../utils/logger';

interface ClinicalWorkspaceProps {
  recordId: number;
  initialData: WorkspaceData;
  initialVersion: number;
  onUpdate: (data: WorkspaceData, version: number) => void;
  isSaving?: boolean;
}

const TOOL_CONFIG = {
  pen: { color: '#000000', width: 2 },
  highlighter: { color: 'rgba(255, 255, 0, 0.3)', width: 20 },
  eraser: { color: '#ffffff', width: 20 },
  select: { color: '#3b82f6', width: 1 },
};

const LOGICAL_WIDTH = 1000;

export const ClinicalWorkspace: React.FC<ClinicalWorkspaceProps> = ({
  recordId,
  initialData,
  initialVersion,
  onUpdate,
  isSaving = false,
}) => {
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentTool, setCurrentTool] = useState<DrawingTool>('pen');
  const [isDrawing, setIsDrawing] = useState(false);
  const [layers, setLayers] = useState<(DrawingPath | MediaLayer)[]>(initialData.layers || []);
  const [redoStack, setRedoStack] = useState<(DrawingPath | MediaLayer)[][]>([]);
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [currentPath, setCurrentPath] = useState<DrawingPath | null>(null);
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [localVersion, setLocalVersion] = useState(0); // For debouncing
  const [serverVersion, setServerVersion] = useState(initialVersion);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [isRotating, setIsRotating] = useState(false);

  const scale = canvasWidth / LOGICAL_WIDTH;
  const canvasHeight = (initialData.canvas_height || 1000) * scale;

  // Pre-load images
  useEffect(() => {
    // Background image
    if (initialData.background_image_url && !images[initialData.background_image_url]) {
      const img = new Image();
      img.src = initialData.background_image_url;
      img.onload = () => {
        setImages(prev => ({ ...prev, [initialData.background_image_url!]: img }));
      };
      img.onerror = () => {
        logger.error(`Failed to load background image: ${initialData.background_image_url}`);
      };
    }

    const mediaLayers = layers.filter(l => l.type === 'media') as MediaLayer[];
    mediaLayers.forEach(layer => {
      if (!images[layer.url]) {
        const img = new Image();
        img.src = layer.url;
        img.onload = () => {
          setImages(prev => ({ ...prev, [layer.url]: img }));
        };
        img.onerror = () => {
          logger.error(`Failed to load image: ${layer.url}`);
        };
      }
    });
  }, [layers, initialData.background_image_url]); // Removed images from dependency array to avoid infinite loops

  // Handle window resize for responsive canvas
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        // Use the container width but capped at 1000px or initialData.canvas_width if provided
        const containerWidth = containerRef.current.clientWidth;
        const targetWidth = Math.min(containerWidth - 32, initialData.canvas_width || 1000);
        setCanvasWidth(Math.max(400, targetWidth));
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [initialData.canvas_width]);

  // Sync layers when initialData changes (but only if we are not currently drawing)
  useEffect(() => {
    if (!isDrawing) {
      setLayers(initialData.layers || []);
      setServerVersion(initialVersion);
    }
  }, [initialData.layers, initialVersion, isDrawing]);

  const drawLayer = useCallback((ctx: CanvasRenderingContext2D, layer: DrawingPath | MediaLayer) => {
    ctx.save();
    // Use logical coordinates for all drawing operations
    if (layer.type === 'drawing') {
      const firstPoint = layer.points[0];
      if (layer.points.length < 2 || !firstPoint) {
        ctx.restore();
        return;
      }
      
      ctx.beginPath();
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = layer.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      if (layer.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.moveTo(firstPoint[0], firstPoint[1]);
      for (let i = 1; i < layer.points.length; i++) {
        const point = layer.points[i];
        if (point) {
          ctx.lineTo(point[0], point[1]);
        }
      }
      ctx.stroke();
    } else if (layer.type === 'media') {
      const img = images[layer.url];
      if (img) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
        ctx.rotate((layer.rotation * Math.PI) / 180);
        ctx.drawImage(img, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
      }
    }
    ctx.restore();
  }, [images]);

  const renderCanvas = useCallback(() => {
    const bgCanvas = backgroundCanvasRef.current;
    const drawCanvas = drawingCanvasRef.current;
    if (!bgCanvas || !drawCanvas) return;

    const bgCtx = bgCanvas.getContext('2d');
    const drawCtx = drawCanvas.getContext('2d');
    if (!bgCtx || !drawCtx) return;

    // Clear both canvases
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

    // Apply scaling to both
    bgCtx.save();
    bgCtx.scale(scale, scale);
    drawCtx.save();
    drawCtx.scale(scale, scale);

    // 1. Draw to Background Canvas (Images + Template Background)
    if (initialData.background_image_url) {
      const bgImg = images[initialData.background_image_url];
      if (bgImg) {
        // Draw background image scaled to fill logical width
        bgCtx.drawImage(bgImg, 0, 0, LOGICAL_WIDTH, (LOGICAL_WIDTH / bgImg.width) * bgImg.height);
      }
    }

    layers.forEach(layer => {
      if (layer.type === 'media') {
        drawLayer(bgCtx, layer);
        
        // Draw selection box if selected
        if (layer.id === selectedLayerId) {
          bgCtx.save();
          bgCtx.strokeStyle = TOOL_CONFIG.select.color;
          bgCtx.lineWidth = 2 / scale;
          bgCtx.strokeRect(layer.x - 2, layer.y - 2, layer.width + 4, layer.height + 4);
          
          // Draw resize handle (bottom-right)
          bgCtx.fillStyle = TOOL_CONFIG.select.color;
          const handleSize = 8 / scale;
          bgCtx.fillRect(
            layer.x + layer.width - handleSize / 2, 
            layer.y + layer.height - handleSize / 2, 
            handleSize, 
            handleSize
          );

          // Draw rotation handle (top-center)
          bgCtx.beginPath();
          bgCtx.arc(
            layer.x + layer.width / 2,
            layer.y - 20 / scale,
            5 / scale,
            0,
            Math.PI * 2
          );
          bgCtx.fill();
          
          // Draw line to rotation handle
          bgCtx.beginPath();
          bgCtx.moveTo(layer.x + layer.width / 2, layer.y);
          bgCtx.lineTo(layer.x + layer.width / 2, layer.y - 20 / scale);
          bgCtx.stroke();
          
          bgCtx.restore();
        }
      } else {
        drawLayer(drawCtx, layer);
      }
    });

    // 2. Draw current path if drawing (always on drawing canvas)
    if (currentPath) {
      drawLayer(drawCtx, currentPath);
    }

    bgCtx.restore();
    drawCtx.restore();
  }, [layers, currentPath, drawLayer, scale, initialData.background_image_url, images]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    let x, y;
    
    if ('touches' in e) {
      const touch = e.touches[0];
      if (!touch) return;
      x = touch.clientX - rect.left;
      y = touch.clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }

    // Convert to logical coordinates
    const logicalX = x / scale;
    const logicalY = y / scale;

    if (currentTool === 'select') {
      // If a layer is already selected, check for resize handle first
      if (selectedLayerId) {
        const selectedLayer = layers.find(l => l.type === 'media' && l.id === selectedLayerId) as MediaLayer | undefined;
        if (selectedLayer) {
          const handleSize = 12 / scale; // Larger hit area for handle
          
          // Resize handle (bottom-right)
          const hx = selectedLayer.x + selectedLayer.width;
          const hy = selectedLayer.y + selectedLayer.height;
          if (
            logicalX >= hx - handleSize && logicalX <= hx + handleSize &&
            logicalY >= hy - handleSize && logicalY <= hy + handleSize
          ) {
            setIsResizing(true);
            return;
          }

          // Rotation handle (top-center)
          const rx = selectedLayer.x + selectedLayer.width / 2;
          const ry = selectedLayer.y - 20 / scale;
          if (
            logicalX >= rx - handleSize && logicalX <= rx + handleSize &&
            logicalY >= ry - handleSize && logicalY <= ry + handleSize
          ) {
            setIsRotating(true);
            return;
          }
        }
      }

      // Hit detection for media layers (top to bottom)
      const clickedMedia = [...layers].reverse().find(l => 
        l.type === 'media' && 
        logicalX >= l.x && logicalX <= l.x + l.width &&
        logicalY >= l.y && logicalY <= l.y + l.height
      ) as MediaLayer | undefined;

      if (clickedMedia) {
        setSelectedLayerId(clickedMedia.id);
        setDragOffset({ x: logicalX - clickedMedia.x, y: logicalY - clickedMedia.y });
        setIsResizing(false);
      } else {
        setSelectedLayerId(null);
        setIsResizing(false);
      }
      return;
    }

    setIsDrawing(true);
    setCurrentPath({
      type: 'drawing',
      tool: currentTool,
      color: TOOL_CONFIG[currentTool].color,
      width: TOOL_CONFIG[currentTool].width,
      points: [[logicalX, logicalY]],
    });
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    let x, y;

    if ('touches' in e) {
      const touch = e.touches[0];
      if (!touch) return;
      x = touch.clientX - rect.left;
      y = touch.clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }

    // Convert to logical coordinates
    const logicalX = x / scale;
    const logicalY = y / scale;

    if (currentTool === 'select' && selectedLayerId) {
       if (isResizing) {
         const newLayers = layers.map(l => {
           if (l.type === 'media' && l.id === selectedLayerId) {
             return { 
               ...l, 
               width: Math.max(20, logicalX - l.x),
               height: Math.max(20, logicalY - l.y)
             };
           }
           return l;
         });
         setLayers(newLayers);
         return;
       }

       if (isRotating) {
         const selectedLayer = layers.find(l => l.type === 'media' && l.id === selectedLayerId) as MediaLayer | undefined;
         if (selectedLayer) {
           const centerX = selectedLayer.x + selectedLayer.width / 2;
           const centerY = selectedLayer.y + selectedLayer.height / 2;
           // Calculate angle in degrees
           const angle = Math.atan2(logicalY - centerY, logicalX - centerX) * (180 / Math.PI);
           // Add 90 degrees because the handle is at the top (0 degrees is to the right)
           const rotation = (angle + 90) % 360;

           const newLayers = layers.map(l => {
             if (l.type === 'media' && l.id === selectedLayerId) {
               return { ...l, rotation };
             }
             return l;
           });
           setLayers(newLayers);
         }
         return;
       }

       if (dragOffset) {
        const newLayers = layers.map(l => {
          if (l.type === 'media' && l.id === selectedLayerId) {
            return { ...l, x: logicalX - dragOffset.x, y: logicalY - dragOffset.y };
          }
          return l;
        });
        setLayers(newLayers);
        return;
      }
    }

    if (!isDrawing || !currentPath) return;

    setCurrentPath({
      ...currentPath,
      points: [...currentPath.points, [logicalX, logicalY]],
    });
  };

  const handleMouseUp = () => {
    if (currentTool === 'select') {
      if (dragOffset || isResizing || isRotating) {
        setDragOffset(null);
        setIsResizing(false);
        setIsRotating(false);
        setLocalVersion(v => v + 1);
      }
      return;
    }

    if (!isDrawing || !currentPath) return;

    setIsDrawing(false);
    
    // Simplify path before saving to reduce data size
    const simplifiedPoints = simplifyPath(currentPath.points, 0.5);
    const simplifiedPath: DrawingPath = {
      ...currentPath,
      points: simplifiedPoints,
    };
    
    const newLayers = [...layers, simplifiedPath];
    setLayers(newLayers);
    setCurrentPath(null);
    setRedoStack([]); // Clear redo stack on new action
    setLocalVersion(v => v + 1);
  };

  // Debounced update to parent
  useEffect(() => {
    if (localVersion === 0) return;

    const timer = setTimeout(() => {
      onUpdate({
        ...initialData,
        layers,
      }, serverVersion);
    }, 3000); // 3 seconds debounce

    return () => clearTimeout(timer);
  }, [localVersion, layers, initialData, onUpdate, serverVersion]);

  const clearCanvas = () => {
    if (window.confirm('確定要清除所有繪圖與上傳的圖片嗎？（背景範本將會保留）')) {
      const baseLayers = layers.filter(l => l.type === 'media' && l.origin === 'template');
      setLayers(baseLayers);
      setLocalVersion(v => v + 1);
    }
  };

  const undo = () => {
    if (layers.length === 0) return;
    
    // Find the last layer that is NOT a template base layer
    const lastNonTemplateIndex = [...layers].reverse().findIndex(l => 
      !(l.type === 'media' && l.origin === 'template')
    );

    if (lastNonTemplateIndex === -1) return; // Nothing to undo

    const actualIndex = layers.length - 1 - lastNonTemplateIndex;
    const layerToUndo = layers[actualIndex];
    if (!layerToUndo) return;

    const newLayers = layers.filter((_, i) => i !== actualIndex);
    
    setRedoStack(prev => [...prev, layers]);
    setLayers(newLayers);
    setLocalVersion(v => v + 1);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    
    const nextLayers = redoStack[redoStack.length - 1];
    if (!nextLayers) return;

    setRedoStack(prev => prev.slice(0, -1));
    setLayers(nextLayers);
    setLocalVersion(v => v + 1);
  };

  const deleteSelectedLayer = () => {
    if (!selectedLayerId) return;
    const layerToDelete = layers.find(l => l.type === 'media' && l.id === selectedLayerId) as MediaLayer | undefined;
    if (layerToDelete?.origin === 'template') {
      alert('無法刪除範本圖片');
      return;
    }
    
    setLayers(layers.filter(l => !(l.type === 'media' && l.id === selectedLayerId)));
    setSelectedLayerId(null);
    setLocalVersion(v => v + 1);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('只支援圖片格式');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`/api/clinic/medical-records/${recordId}/media`, {
        method: 'POST',
        body: formData,
        // Authentication header should be handled by a global interceptor or passed here
        // For simplicity in this demo, we assume the session cookie is used
      });

      if (!response.ok) {
        throw new Error('上傳失敗');
      }

      const data = await response.json();
      
      // Add new media layer at the center of the current viewport
      const scrollTop = containerRef.current?.scrollTop || 0;
      const newMediaLayer: MediaLayer = {
        type: 'media',
        id: data.id,
        origin: 'upload',
        url: data.url,
        x: 100, // Default position
        y: scrollTop + 100,
        width: 300, // Default size
        height: 300,
        rotation: 0,
      };

      const newLayers = [...layers, newMediaLayer];
      setLayers(newLayers);
      setLocalVersion(v => v + 1);
    } catch (err) {
      logger.error('Upload error:', err);
      alert('圖片上傳失敗');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between bg-gray-50">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentTool('pen')}
            className={`p-2 rounded ${currentTool === 'pen' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200'}`}
            title="畫筆"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button
            onClick={() => setCurrentTool('highlighter')}
            className={`p-2 rounded ${currentTool === 'highlighter' ? 'bg-yellow-100 text-yellow-600' : 'hover:bg-gray-200'}`}
            title="螢光筆"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </button>
          <button
            onClick={() => setCurrentTool('eraser')}
            className={`p-2 rounded ${currentTool === 'eraser' ? 'bg-red-100 text-red-600' : 'hover:bg-gray-200'}`}
            title="橡皮擦"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button
            onClick={() => setCurrentTool('select')}
            className={`p-2 rounded ${currentTool === 'select' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200'}`}
            title="選擇/移動"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
            </svg>
          </button>
          <div className="w-px h-6 bg-gray-300 mx-1" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className={`p-2 rounded hover:bg-gray-200 ${isUploading ? 'opacity-50' : ''}`}
            title="上傳圖片"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <div className="w-px h-6 bg-gray-300 mx-1" />
          <button
            onClick={undo}
            disabled={layers.length === 0 || layers.every(l => l.type === 'media' && l.origin === 'template')}
            className="p-2 rounded hover:bg-gray-200 disabled:opacity-30"
            title="復原 (Undo)"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
          <button
            onClick={redo}
            disabled={redoStack.length === 0}
            className="p-2 rounded hover:bg-gray-200 disabled:opacity-30"
            title="重做 (Redo)"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
            </svg>
          </button>
          <button
            onClick={clearCanvas}
            disabled={layers.length === 0}
            className="p-2 rounded hover:bg-red-50 text-red-600 disabled:opacity-30"
            title="清除全部"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          {selectedLayerId && (
            <>
              <div className="w-px h-6 bg-gray-300 mx-1" />
              <button
                onClick={deleteSelectedLayer}
                className="p-2 rounded hover:bg-red-50 text-red-600"
                title="刪除所選圖片"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {isSaving && (
            <div className="flex items-center gap-1 text-xs text-blue-600">
              <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
              儲存中...
            </div>
          )}
          <span className="text-xs text-gray-400">
            {initialData.canvas_height}px
          </span>
        </div>
      </div>

      <div 
        ref={containerRef}
        className="relative overflow-auto bg-gray-100"
        style={{ height: '600px' }}
      >
        <div 
          className="mx-auto shadow-sm bg-white relative"
          style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}
        >
          {/* Background Canvas (Images, Template Background) */}
          <canvas
            ref={backgroundCanvasRef}
            width={canvasWidth}
            height={canvasHeight}
            className="absolute top-0 left-0 pointer-events-none"
          />
          {/* Drawing Canvas (Pen, Highlighter, Eraser) */}
          <canvas
            ref={drawingCanvasRef}
            width={canvasWidth}
            height={canvasHeight}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleMouseDown}
            onTouchMove={handleMouseMove}
            onTouchEnd={handleMouseUp}
            className="absolute top-0 left-0 cursor-crosshair touch-none"
          />
        </div>
      </div>
    </div>
  );
};

/**
 * Ramer-Douglas-Peucker algorithm for path simplification
 */
function simplifyPath(points: [number, number, number?][], epsilon = 1): [number, number, number?][] {
  if (points.length <= 2) return points;

  const sqTolerance = epsilon * epsilon;

  function getSqSegDist(p: [number, number, number?], p1: [number, number, number?], p2: [number, number, number?]) {
    let x = p1[0];
    let y = p1[1];
    let dx = p2[0] - x;
    let dy = p2[1] - y;

    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = p2[0];
        y = p2[1];
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }

    dx = p[0] - x;
    dy = p[1] - y;
    return dx * dx + dy * dy;
  }

  function simplifyRecursive(
    points: [number, number, number?][],
    first: number,
    last: number,
    sqTolerance: number,
    simplified: [number, number, number?][]
  ) {
    let maxSqDist = sqTolerance;
    let index = -1;

    for (let i = first + 1; i < last; i++) {
      const sqDist = getSqSegDist(points[i]!, points[first]!, points[last]!);
      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }

    if (index !== -1) {
      simplifyRecursive(points, first, index, sqTolerance, simplified);
      simplified.push(points[index]!);
      simplifyRecursive(points, index, last, sqTolerance, simplified);
    }
  }

  const simplified: [number, number, number?][] = [points[0]!];
  simplifyRecursive(points, 0, points.length - 1, sqTolerance, simplified);
  simplified.push(points[points.length - 1]!);

  return simplified;
}
