import React, { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import imageCompression from 'browser-image-compression';
import type { WorkspaceData, DrawingPath, MediaLayer, DrawingTool } from '../../types';
import { logger } from '../../utils/logger';
import { apiService } from '../../services/api';
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
  const imagesRef = useRef<Record<string, HTMLImageElement>>({});
  const [imagesLoaded, setImagesLoaded] = useState(0); // Trigger re-render when images load
  const [isUploading, setIsUploading] = useState(false);
  const [localVersion, setLocalVersion] = useState(0); // Counter for user actions
  const [serverVersion, setServerVersion] = useState(initialVersion);
  const lastUpdateVersionRef = useRef<number>(0); // Track what we last sent to parent
  const acknowledgedLocalVersionRef = useRef<number>(0); // Track the last local version acknowledged by server
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);

  // Buffer canvas for flicker-free resizing
  const bufferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isBufferValidRef = useRef<boolean>(false);

  const COMFORT_BUFFER = 300; // Extra space at the bottom for writing
  const MIN_CANVAS_HEIGHT = 800;
  const HEIGHT_CHUNK_SIZE = 500; // Resize in 500px steps to reduce flicker frequency

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
      const bgImg = imagesRef.current['background'];
      if (bgImg) {
        maxBottom = Math.max(maxBottom, (LOGICAL_WIDTH / bgImg.width) * bgImg.height);
      }
    }

    return maxBottom;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, currentPath, imagesLoaded]);

  // Reactive height adjustment with debouncing and chunking
  useEffect(() => {
    const contentBottom = calculateContentBottom();
    const neededHeight = contentBottom + COMFORT_BUFFER;
    
    // Chunked height: Always round up to the next HEIGHT_CHUNK_SIZE
    // This reduces the number of times the physical canvas element is resized
    const targetHeight = Math.max(
      MIN_CANVAS_HEIGHT, 
      Math.ceil(neededHeight / HEIGHT_CHUNK_SIZE) * HEIGHT_CHUNK_SIZE
    );

    // Only update if the difference is significant to avoid jitter
    if (Math.abs(rawCanvasHeight - targetHeight) > 1) {
      const timer = setTimeout(() => {
        // Capture current canvas content to buffer before resizing
        const bgCanvas = backgroundCanvasRef.current;
        const drCanvas = drawingCanvasRef.current;
        
        if (bgCanvas && drCanvas) {
          // Create or resize buffer canvas
          if (!bufferCanvasRef.current) {
            bufferCanvasRef.current = document.createElement('canvas');
          }
          const buffer = bufferCanvasRef.current;
          buffer.width = bgCanvas.width;
          buffer.height = bgCanvas.height;
          const bCtx = buffer.getContext('2d');
          
          if (bCtx) {
            // Store current view
            bCtx.drawImage(bgCanvas, 0, 0);
            bCtx.drawImage(drCanvas, 0, 0);
            isBufferValidRef.current = true;
          }
        }

        setRawCanvasHeight(targetHeight);
        // Increment local version to trigger persistence when height changes
        setLocalVersion(v => v + 1);
      }, 300); // Reduced from 500ms to 300ms for better responsiveness
      return () => clearTimeout(timer);
    }
    return;
  }, [layers, currentPath, calculateContentBottom, rawCanvasHeight]);

  const scale = canvasWidth / (migratedInitialData.current.canvas_width || 1000);
  const canvasHeight = rawCanvasHeight * scale;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

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
  const mediaUrlsFingerprint = layers
    .filter(l => l.type === 'media')
    .map(l => (l as MediaLayer).url)
    .join('|');

  useEffect(() => {
    // Background image
    const bgUrl = initialData.background_image_url;
    if (bgUrl) {
      const existingImg = imagesRef.current['background'];
      const urlChanged = existingImg && existingImg.src !== bgUrl;

      if (!existingImg || urlChanged) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = bgUrl;
        img.onload = () => {
          imagesRef.current['background'] = img;
          setImagesLoaded(v => v + 1);
        };
        img.onerror = () => {
          logger.error(`Failed to load background image: ${bgUrl}`);
        };
      }
    }

    // Media layers
    layers.forEach(layer => {
      if (layer.type !== 'media') return;
      
      const existingImg = imagesRef.current[layer.id];
      const urlChanged = existingImg && existingImg.src !== layer.url;

      if (!existingImg || urlChanged) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = layer.url;
        img.onload = () => {
          imagesRef.current[layer.id] = img;
          setImagesLoaded(v => v + 1);
        };
        img.onerror = () => {
          logger.error(`Failed to load image: ${layer.url}`);
        };
      }
    });
  }, [mediaUrlsFingerprint, initialData.background_image_url]); // Re-run if any media URL changes or background URL changes

  // Handle window resize for responsive canvas
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const oldWidth = canvasWidth;
        // Use the container width but capped at 1000px or initialData.canvas_width if provided
        const containerWidth = containerRef.current.clientWidth;
        const targetWidth = Math.min(containerWidth - 32, migratedInitialData.current.canvas_width || 1000);
        const newWidth = Math.max(400, targetWidth);
        
        if (Math.abs(oldWidth - newWidth) > 1) {
          setCanvasWidth(newWidth);
        }
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [migratedInitialData.current.canvas_width, canvasWidth]);

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

  useEffect(() => {
    return () => { };
  }, []);

  // Sync layers when initialData changes (but only if we are not currently drawing)
  useEffect(() => {
    if (!isDrawing) {
      const migrated = migrateWorkspaceData(initialData);
      
      // Update our acknowledgment ref if the server returned a local version
      if (migrated.local_version !== undefined) {
        acknowledgedLocalVersionRef.current = Math.max(
          acknowledgedLocalVersionRef.current,
          migrated.local_version
        );
      }

      // If the server version is strictly greater than our local tracking of the server version,
      // it means a save was successful or another client updated the record.
      if (initialVersion > serverVersion) {
        // If we were waiting for an update and this incoming version matches what we expected
        // (or passed it), we can clear the pending update.
        setPendingUpdate(null);

        // CRITICAL: Only overwrite local layers if the server has acknowledged 
        // our latest local changes. This prevents the race condition where 
        // an older server response (from an earlier save) overwrites newer local state.
        if (localVersion <= acknowledgedLocalVersionRef.current) {
          // Optimization: Only update state if data actually changed to avoid unnecessary re-renders
          const newLayers = migrated.layers || [];
          const newHeight = migrated.canvas_height || 1000;
          
          // Fast path for layer comparison to avoid expensive JSON.stringify on every sync
          let layersChanged = newLayers.length !== layers.length;
          
          if (!layersChanged) {
            // Compare layers one by one. Drawing layers can be large, so we check
            // basic properties first before falling back to JSON.stringify for points.
            for (let i = 0; i < newLayers.length; i++) {
               const nl = newLayers[i];
               const ol = layers[i];
               
               if (!nl || !ol || nl.type !== ol.type) {
                 layersChanged = true;
                 break;
               }
              
              if (nl.type === 'media') {
                const nm = nl as MediaLayer;
                const om = ol as MediaLayer;
                if (nm.id !== om.id || nm.url !== om.url || nm.x !== om.x || nm.y !== om.y || 
                    nm.width !== om.width || nm.height !== om.height || nm.rotation !== om.rotation) {
                  layersChanged = true;
                  break;
                }
              } else {
                const nd = nl as DrawingPath;
                const od = ol as DrawingPath;
                if (nd.tool !== od.tool || nd.color !== od.color || nd.width !== od.width || 
                    nd.points.length !== od.points.length) {
                  layersChanged = true;
                  break;
                }
                // Only stringify points if lengths are equal but we need to be absolutely sure.
                // In most cases, points length change is enough, but we want to be correct.
                if (JSON.stringify(nd.points) !== JSON.stringify(od.points)) {
                  layersChanged = true;
                  break;
                }
              }
            }
          }
          
          if (layersChanged) {
            setLayers(newLayers);
          }
          
          if (Math.abs(newHeight - rawCanvasHeight) > 1) {
            setRawCanvasHeight(newHeight);
          }
        }

        setServerVersion(initialVersion);
        migratedInitialData.current = migrated;
      } else if (initialVersion === serverVersion) {
        // Just sync the ref without triggering a re-render if versions match
        migratedInitialData.current = migrated;
      }
    }
  }, [initialData, initialVersion, isDrawing, serverVersion, localVersion, layers, rawCanvasHeight]);

  const saveWorkspace = useCallback(() => {
    // ONLY send if our local version has actually increased since the last update we sent.
    if (localVersion <= lastUpdateVersionRef.current) {
      return;
    }

    const workspaceData: WorkspaceData = {
      ...migratedInitialData.current,
      layers,
      canvas_height: rawCanvasHeight,
      version: 2,
      // Pass our current local version as metadata so we can track acknowledgment
      local_version: localVersion,
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
      const img = imagesRef.current[layer.id];
      if (img) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
        ctx.rotate((layer.rotation * Math.PI) / 180);
        ctx.drawImage(img, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
      }
    }
    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagesLoaded]);

  const renderBackground = useCallback(() => {
    const bgCanvas = backgroundCanvasRef.current;
    if (!bgCanvas) {
      return;
    }

    const bgCtx = bgCanvas.getContext('2d');
    if (!bgCtx) return;

    let bgImageDrawn = false;

    // Clear background canvas
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

    bgCtx.save();
    bgCtx.scale(dpr * scale, dpr * scale);

    // 1. Draw Template Background
    if (initialData.background_image_url) {
      const bgImg = imagesRef.current['background'];
      if (bgImg) {
        bgCtx.drawImage(bgImg, 0, 0, LOGICAL_WIDTH, (LOGICAL_WIDTH / bgImg.width) * bgImg.height);
        bgImageDrawn = true;
      }
    }

    // 2. Draw Media Layers
    layers.forEach(layer => {
      if (layer.type === 'media') {
        const img = imagesRef.current[layer.id];
        if (img) {
          drawLayer(bgCtx, layer);
        }

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
      }
    });

    bgCtx.restore();
    // Draw placeholder if background image exists but failed to load
    if (initialData.background_image_url && !bgImageDrawn) {
      bgCtx.fillStyle = '#f3f4f6';
      bgCtx.fillRect(0, 0, LOGICAL_WIDTH, 1000);
      bgCtx.fillStyle = '#9ca3af';
      bgCtx.font = '14px Inter';
      bgCtx.fillText('Loading background...', 20, 40);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, drawLayer, scale, initialData.background_image_url, selectedLayerId, dpr, imagesLoaded]);

  const renderDrawing = useCallback(() => {
    const drawCanvas = drawingCanvasRef.current;
    if (!drawCanvas) return;

    const drawCtx = drawCanvas.getContext('2d');
    if (!drawCtx) return;

    // Clear drawing canvas
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

    drawCtx.save();
    drawCtx.scale(dpr * scale, dpr * scale);

    // Draw all drawing layers
    layers.forEach(layer => {
      if (layer.type === 'drawing') {
        drawLayer(drawCtx, layer);
      }
    });

    // Draw current path if drawing
    if (currentPath) {
      drawLayer(drawCtx, currentPath);
    }

    drawCtx.restore();
    // Removed frequent renderDrawing complete log to reduce noise
  }, [layers, currentPath, drawLayer, scale, dpr]);

  useLayoutEffect(() => {
    renderBackground();
    
    // Explicitly invalidate buffer after render is complete
    if (isBufferValidRef.current) {
      isBufferValidRef.current = false;
    }
  }, [renderBackground]);

  useLayoutEffect(() => {
    renderDrawing();
  }, [renderDrawing]);

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

    const MAX_FILE_SIZE = config.maxUploadSizeMb * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      alert(`檔案太大了 (上限 ${config.maxUploadSizeMb}MB)`);
      return;
    }

    setIsUploading(true);

    try {
      // 1. Compress the image in a Web Worker (Option B)
      const compressionOptions = {
        maxSizeMB: 1, // Target 1MB
        maxWidthOrHeight: 2000, // Max 2000px resolution
        useWebWorker: true,
        initialQuality: 0.8, // 80% quality
        fileType: 'image/webp' as const, // Convert to WebP for better compression
      };

      const compressedFile = await imageCompression(file, compressionOptions);
      logger.info(`Image compressed from ${file.size / 1024 / 1024}MB to ${compressedFile.size / 1024 / 1024}MB`);

      // 2. Get image dimensions first to respect aspect ratio
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
          URL.revokeObjectURL(img.src);
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(compressedFile);
      });

      // 3. Upload the compressed file
      const data = await apiService.uploadMedicalRecordMedia(recordId, compressedFile as File);

      // 4. Calculate appropriate initial size (max 400px width, or canvas width)
      const maxWidth = Math.min(400, LOGICAL_WIDTH - 40);
      let width = dimensions.width;
      let height = dimensions.height;

      if (width > maxWidth) {
        const ratio = maxWidth / width;
        width = maxWidth;
        height = height * ratio;
      }

      // Add new media layer at the center of the current viewport
      const scrollTop = containerRef.current?.scrollTop || 0;
      const newMediaLayer: MediaLayer = {
        type: 'media',
        id: data.id,
        origin: 'upload',
        url: data.url,
        x: (LOGICAL_WIDTH - width) / 2, // Center horizontally
        y: scrollTop + 100,
        width,
        height,
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
            width={canvasWidth * dpr}
            height={canvasHeight * dpr}
            className="absolute top-0 left-0 pointer-events-none w-full h-full"
          />
          {/* Drawing Canvas (Pen, Highlighter, Eraser) */}
          <canvas
            ref={drawingCanvasRef}
            width={canvasWidth * dpr}
            height={canvasHeight * dpr}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="absolute top-0 left-0 cursor-crosshair touch-none w-full h-full"
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
