import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { WorkspaceData, DrawingPath, MediaLayer, DrawingTool } from '../../types';
import { logger } from '../../utils/logger';

interface ClinicalWorkspaceProps {
  recordId: number;
  initialData: WorkspaceData;
  onUpdate: (data: WorkspaceData) => void;
  isSaving?: boolean;
}

const TOOL_CONFIG = {
  pen: { color: '#000000', width: 2 },
  highlighter: { color: 'rgba(255, 255, 0, 0.3)', width: 20 },
  eraser: { color: '#ffffff', width: 20 },
};

export const ClinicalWorkspace: React.FC<ClinicalWorkspaceProps> = ({
  recordId,
  initialData,
  onUpdate,
  isSaving = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
    }
  }, [initialData.layers, isDrawing]);

  const drawLayer = useCallback((ctx: CanvasRenderingContext2D, layer: DrawingPath | MediaLayer) => {
    if (layer.type === 'drawing') {
      const firstPoint = layer.points[0];
      if (layer.points.length < 2 || !firstPoint) return;
      
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
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
        ctx.rotate((layer.rotation * Math.PI) / 180);
        ctx.drawImage(img, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
        ctx.restore();
      }
    }
  }, [images]);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';

    // Draw background image if exists
    if (initialData.background_image_url) {
      const bgImg = images[initialData.background_image_url];
      if (bgImg) {
        // Draw centered or scaled? Let's assume centered at 0,0 or covering top area
        ctx.drawImage(bgImg, 0, 0);
      }
    }

    // Draw all layers
    layers.forEach(layer => drawLayer(ctx, layer));

    // Draw current path if drawing
    if (currentPath) {
      drawLayer(ctx, currentPath);
    }
  }, [layers, currentPath, drawLayer]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
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

    setIsDrawing(true);
    setCurrentPath({
      type: 'drawing',
      tool: currentTool,
      color: TOOL_CONFIG[currentTool].color,
      width: TOOL_CONFIG[currentTool].width,
      points: [[x, y]],
    });
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !currentPath) return;

    const canvas = canvasRef.current;
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

    setCurrentPath({
      ...currentPath,
      points: [...currentPath.points, [x, y]],
    });
  };

  const handleMouseUp = () => {
    if (!isDrawing || !currentPath) return;

    setIsDrawing(false);
    const newLayers = [...layers, currentPath];
    setLayers(newLayers);
    setCurrentPath(null);
    setRedoStack([]); // Clear redo stack on new action

    // Update will be handled by the useEffect below
  };

  // Debounced update to parent
  useEffect(() => {
    // Only update if layers have changed from initialData
    if (JSON.stringify(layers) === JSON.stringify(initialData.layers)) return;

    const timer = setTimeout(() => {
      onUpdate({
        ...initialData,
        layers,
      });
    }, 3000); // 3 seconds debounce

    return () => clearTimeout(timer);
  }, [layers, initialData, onUpdate]);

  const clearCanvas = () => {
    if (window.confirm('確定要清除所有繪圖與上傳的圖片嗎？（背景範本將會保留）')) {
      const baseLayers = layers.filter(l => l.type === 'media' && l.origin === 'template');
      setLayers(baseLayers);
      onUpdate({
        ...initialData,
        layers: baseLayers,
      });
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
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    
    const nextLayers = redoStack[redoStack.length - 1];
    if (!nextLayers) return;

    setRedoStack(prev => prev.slice(0, -1));
    setLayers(nextLayers);
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
      onUpdate({
        ...initialData,
        layers: newLayers,
      });
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
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={initialData.canvas_height || 1000}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchMove={handleMouseMove}
          onTouchEnd={handleMouseUp}
          className="bg-white mx-auto shadow-sm cursor-crosshair touch-none"
        />
      </div>
    </div>
  );
};
