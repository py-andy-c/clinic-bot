import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { WorkspaceData, DrawingPath, MediaLayer, DrawingTool } from '../../types';
import { logger } from '../../utils/logger';
import { authStorage } from '../../utils/storage';
import { config } from '../../config/env';

import { SyncStatus, SyncStatusType } from './SyncStatus';

interface ClinicalWorkspaceProps {
  recordId: number;
  initialData: WorkspaceData;
  initialVersion: number;
  onUpdate: (data: WorkspaceData) => void;
  syncStatus?: SyncStatusType;
}

const TOOL_CONFIG = {
  pen: { color: '#000000', width: 2 },
  highlighter: { color: 'rgba(255, 255, 0, 0.3)', width: 20 },
  eraser: { color: '#ffffff', width: 20 },
  select: { color: '#3b82f6', width: 1 },
};

const LOGICAL_WIDTH = 1000;

const calculateBoundingBox = (points: [number, number, number?][]) => {
  if (points.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const firstPoint = points[0]!;
  let minX = firstPoint[0];
  let maxX = firstPoint[0];
  let minY = firstPoint[1];
  let maxY = firstPoint[1];

  for (let i = 1; i < points.length; i++) {
    const point = points[i]!;
    const [x, y] = point;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
};

const migrateWorkspaceData = (data: WorkspaceData): WorkspaceData => {
  if (!data || data.version >= 2) return data;

  const migratedLayers = (data.layers || []).map(layer => {
    if (layer.type === 'drawing') {
      const points = layer.points.map(p => {
        if (p.length === 2) {
          return [p[0], p[1], 0.5] as [number, number, number?];
        }
        return p as [number, number, number?];
      });
      return {
        ...layer,
        points,
        boundingBox: layer.boundingBox || calculateBoundingBox(points)
      };
    }
    return layer;
  });

  return {
    ...data,
    version: 2,
    canvas_width: data.canvas_width || 1000,
    layers: migratedLayers
  };
};

export const ClinicalWorkspace: React.FC<ClinicalWorkspaceProps> = ({
  recordId,
  initialData,
  initialVersion,
  onUpdate,
  syncStatus,
}) => {
  const migratedInitialData = useRef(migrateWorkspaceData(initialData));

  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentTool, setCurrentTool] = useState<DrawingTool>('pen');
  const [isDrawing, setIsDrawing] = useState(false);
  const [layers, setLayers] = useState<(DrawingPath | MediaLayer)[]>(migratedInitialData.current.layers || []);
  const [rawCanvasHeight, setRawCanvasHeight] = useState(migratedInitialData.current.canvas_height || 1000);
  const [redoStack, setRedoStack] = useState<(DrawingPath | MediaLayer)[][]>([]);
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [currentPath, setCurrentPath] = useState<DrawingPath | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<WorkspaceData | null>(null);
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [localVersion, setLocalVersion] = useState(0); // Counter for user actions
  const [serverVersion, setServerVersion] = useState(initialVersion);
  const lastUpdateVersionRef = useRef<number>(0); // Track what we last sent to parent
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);

  const COMFORT_BUFFER = 300; // Extra space at the bottom for writing
  const MIN_CANVAS_HEIGHT = 800;

  const calculateContentBottom = useCallback(() => {
    let maxBottom = 0;

    // Check all layers
    layers.forEach(layer => {
      if (layer.type === 'media') {
        maxBottom = Math.max(maxBottom, layer.y + layer.height);
      } else if (layer.type === 'drawing') {
        // Exclude eraser tool from height calculation to allow shrinking when content is erased
        if (layer.tool !== 'eraser') {
          if (layer.boundingBox) {
            maxBottom = Math.max(maxBottom, layer.boundingBox.maxY);
          } else {
            // Fallback for legacy data without boundingBox
            layer.points.forEach(point => {
              maxBottom = Math.max(maxBottom, point[1]);
            });
          }
        }
      }
    });

    // Check current active path
    if (currentPath && currentPath.tool !== 'eraser') {
      if (currentPath.boundingBox) {
        maxBottom = Math.max(maxBottom, currentPath.boundingBox.maxY);
      } else {
        currentPath.points.forEach(point => {
          maxBottom = Math.max(maxBottom, point[1]);
        });
      }
    }

    // Check background image height
    if (migratedInitialData.current.background_image_url) {
      const bgImg = images[migratedInitialData.current.background_image_url];
      if (bgImg) {
        maxBottom = Math.max(maxBottom, (LOGICAL_WIDTH / bgImg.width) * bgImg.height);
      }
    }

    return maxBottom;
  }, [layers, currentPath, images]);

  // Reactive height adjustment with debouncing
  useEffect(() => {
    const contentBottom = calculateContentBottom();
    const targetHeight = Math.max(MIN_CANVAS_HEIGHT, contentBottom + COMFORT_BUFFER);

    // Only update if the difference is significant to avoid jitter
    if (Math.abs(rawCanvasHeight - targetHeight) > 10) {
      const timer = setTimeout(() => {
        setRawCanvasHeight(targetHeight);
        // Increment local version to trigger persistence when height changes
        setLocalVersion(v => v + 1);
      }, 500); // 500ms debounce to avoid constant re-renders during drawing
      return () => clearTimeout(timer);
    }
    return;
  }, [layers, currentPath, calculateContentBottom, rawCanvasHeight]);

  const scale = canvasWidth / (migratedInitialData.current.canvas_width || 1000);
  const canvasHeight = rawCanvasHeight * scale;

  // Track network status - we don't need syncStatus state anymore
  useEffect(() => {
    const handleOnline = () => { };
    const handleOffline = () => { };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Pre-load images
  useEffect(() => {
    // Background image
    if (migratedInitialData.current.background_image_url && !images[migratedInitialData.current.background_image_url]) {
      const img = new Image();
      img.src = migratedInitialData.current.background_image_url;
      img.onload = () => {
        setImages(prev => ({ ...prev, [migratedInitialData.current.background_image_url!]: img }));
      };
      img.onerror = () => {
        logger.error(`Failed to load background image: ${migratedInitialData.current.background_image_url}`);
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
  }, [layers, migratedInitialData.current.background_image_url]); // Removed images from dependency array to avoid infinite loops

  // Handle window resize for responsive canvas
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        // Use the container width but capped at 1000px or initialData.canvas_width if provided
        const containerWidth = containerRef.current.clientWidth;
        const targetWidth = Math.min(containerWidth - 32, migratedInitialData.current.canvas_width || 1000);
        setCanvasWidth(Math.max(400, targetWidth));
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [migratedInitialData.current.canvas_width]);

  // Handle scroll for toolbar visibility
  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      // Show toolbar if the top of the workspace has entered the viewport (within 150px of bottom)
      const isVisible = rect.top < window.innerHeight - 150;
      setShowToolbar(isVisible);
    };

    handleScroll(); // Initial check
    window.addEventListener('scroll', handleScroll, { capture: true });
    return () => window.removeEventListener('scroll', handleScroll, { capture: true });
  }, []);

  // Sync layers when initialData changes (but only if we are not currently drawing)
  useEffect(() => {
    if (!isDrawing) {
      const migrated = migrateWorkspaceData(initialData);

      // If the server version is strictly greater than our local tracking of the server version,
      // it means a save was successful or another client updated the record.
      if (initialVersion > serverVersion) {
        // If we were waiting for an update and this incoming version matches what we expected
        // (or passed it), we can clear the pending update and local changes flag.
        setPendingUpdate(null);

        // Only overwrite local layers if we don't have pending local changes
        // that hasn't been acknowledged by the server yet.
        // We use initialVersion to ensure the server has caught up to our local state.
        if (localVersion <= lastUpdateVersionRef.current) {
          setLayers(migrated.layers || []);
          setRawCanvasHeight(migrated.canvas_height || 1000);
        }

        setServerVersion(initialVersion);
        migratedInitialData.current = migrated;
      } else if (initialVersion === serverVersion) {
        // Just sync the ref without triggering a re-render if versions match
        migratedInitialData.current = migrated;
      }
    }
  }, [initialData, initialVersion, isDrawing, serverVersion, localVersion]);

  const saveWorkspace = useCallback(() => {
    // ONLY send if our local version has actually increased since the last update we sent.
    // This prevents the infinite loop where a server-sync triggers a local state change
    // which in turn triggers a new save request.
    if (localVersion <= lastUpdateVersionRef.current) {
      return;
    }

    const workspaceData: WorkspaceData = {
      ...migratedInitialData.current,
      layers,
      canvas_height: rawCanvasHeight,
      version: 2,
    };

    lastUpdateVersionRef.current = localVersion;
    setPendingUpdate(workspaceData);
    onUpdate(workspaceData);
  }, [layers, rawCanvasHeight, onUpdate, localVersion]);

  // Use the saveWorkspace in place of direct onUpdate calls
  useEffect(() => {
    if (localVersion > 0) {
      saveWorkspace();
    }
  }, [localVersion, saveWorkspace]);

  // Handle local data updates for visual sync - internal status is no longer needed
  // as it is handled at the page level.
  useEffect(() => {
    // This effect is kept for potential future local side effects when pendingUpdate changes
  }, [pendingUpdate]);

  const drawLayer = useCallback((ctx: CanvasRenderingContext2D, layer: DrawingPath | MediaLayer) => {
    ctx.save();
    // Use logical coordinates for all drawing operations
    if (layer.type === 'drawing') {
      const firstPoint = layer.points[0];
      if (layer.points.length < 1 || !firstPoint) {
        ctx.restore();
        return;
      }

      ctx.strokeStyle = layer.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (layer.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }

      // If only one point, draw a dot
      if (layer.points.length === 1) {
        const [x, y, pressure = 0.5] = firstPoint;
        ctx.beginPath();
        ctx.fillStyle = layer.color;
        ctx.arc(x, y, (layer.width * pressure) / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }

      // Draw path with variable width based on pressure
      for (let i = 1; i < layer.points.length; i++) {
        const prevPoint = layer.points[i - 1]!;
        const currPoint = layer.points[i]!;
        const [x1, y1, p1 = 0.5] = prevPoint;
        const [x2, y2, p2 = 0.5] = currPoint;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);

        // Dynamic line width based on pressure
        // We use the average pressure of the two points for the segment
        ctx.lineWidth = layer.width * ((p1 + p2) / 2);
        ctx.stroke();
      }
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
  }, [layers, currentPath, drawLayer, scale, initialData.background_image_url, images, canvasHeight]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const handlePointerDown = (e: React.PointerEvent) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;

    // Prevent scrolling when drawing on touch devices
    if (currentTool !== 'select') {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Convert to logical coordinates
    const logicalX = x / scale;
    const logicalY = y / scale;
    const pressure = e.pressure || 0.5;

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
      points: [[logicalX, logicalY, pressure]],
      boundingBox: { minX: logicalX, maxX: logicalX, minY: logicalY, maxY: logicalY },
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Convert to logical coordinates
    const logicalX = x / scale;
    const logicalY = y / scale;
    const pressure = e.pressure || 0.5;

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

    const newBoundingBox = currentPath.boundingBox ? {
      minX: Math.min(currentPath.boundingBox.minX, logicalX),
      maxX: Math.max(currentPath.boundingBox.maxX, logicalX),
      minY: Math.min(currentPath.boundingBox.minY, logicalY),
      maxY: Math.max(currentPath.boundingBox.maxY, logicalY),
    } : { minX: logicalX, maxX: logicalX, minY: logicalY, maxY: logicalY };

    setCurrentPath({
      ...currentPath,
      points: [...currentPath.points, [logicalX, logicalY, pressure]],
      boundingBox: newBoundingBox,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
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
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    // Simplify path before saving to reduce data size
    const simplifiedPoints = simplifyPath(currentPath.points, 0.5);
    const simplifiedPath: DrawingPath = {
      ...currentPath,
      points: simplifiedPoints,
      boundingBox: calculateBoundingBox(simplifiedPoints),
    };

    const newLayers = [...layers, simplifiedPath];
    setLayers(newLayers);
    setCurrentPath(null);
    setRedoStack([]); // Clear redo stack on new action
    setLocalVersion(v => v + 1);
  };

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
      const token = authStorage.getAccessToken();
      const response = await fetch(`${config.apiBaseUrl}/clinic/medical-records/${recordId}/media`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'ngrok-skip-browser-warning': 'true',
        },
        body: formData,
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
    <div className="relative bg-white rounded-lg shadow min-h-screen">
      <div
        ref={containerRef}
        className="relative bg-gray-100 p-4 pb-20"
      >
        <div
          className="mx-auto shadow-lg bg-white relative"
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
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="absolute top-0 left-0 cursor-crosshair touch-none"
          />
        </div>
      </div>

      {/* Floating Toolbar Pill */}
      <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 p-2 bg-white/80 backdrop-blur-md border border-gray-200 shadow-2xl rounded-full transition-all duration-300 ${showToolbar ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'
        }`}>
        <div className="flex items-center gap-1.5 px-2">
          <button
            onClick={() => setCurrentTool('pen')}
            className={`p-2 rounded-full transition-colors ${currentTool === 'pen' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
            title="畫筆"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button
            onClick={() => setCurrentTool('highlighter')}
            className={`p-2 rounded-full transition-colors ${currentTool === 'highlighter' ? 'bg-yellow-100 text-yellow-600' : 'hover:bg-gray-100'}`}
            title="螢光筆"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </button>
          <button
            onClick={() => setCurrentTool('eraser')}
            className={`p-2 rounded-full transition-colors ${currentTool === 'eraser' ? 'bg-red-100 text-red-600' : 'hover:bg-gray-100'}`}
            title="橡皮擦"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button
            onClick={() => setCurrentTool('select')}
            className={`p-2 rounded-full transition-colors ${currentTool === 'select' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
            title="選擇/移動"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
            </svg>
          </button>

          <div className="w-px h-6 bg-gray-200 mx-1" />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className={`p-2 rounded-full hover:bg-gray-100 transition-colors ${isUploading ? 'opacity-50' : ''}`}
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

          <div className="w-px h-6 bg-gray-200 mx-1" />

          <button
            onClick={undo}
            disabled={layers.length === 0 || layers.every(l => l.type === 'media' && l.origin === 'template')}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-30"
            title="復原 (Undo)"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
          <button
            onClick={redo}
            disabled={redoStack.length === 0}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-30"
            title="重做 (Redo)"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
            </svg>
          </button>

          <button
            onClick={clearCanvas}
            disabled={layers.length === 0}
            className="p-2 rounded-full hover:bg-red-50 text-red-600 transition-colors disabled:opacity-30"
            title="清除全部"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>

          {selectedLayerId && (
            <>
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <button
                onClick={deleteSelectedLayer}
                className="p-2 rounded-full hover:bg-red-50 text-red-600 transition-colors"
                title="刪除所選圖片"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
        </div>
        <div className="pr-4 pl-2 border-l border-gray-100">
          <SyncStatus status={syncStatus || 'none'} />
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
