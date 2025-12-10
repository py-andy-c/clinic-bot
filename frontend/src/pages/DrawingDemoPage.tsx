import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Stage, Layer, Line, Circle, Rect, Arrow, Text, Image as KonvaImage } from 'react-konva';
import Konva from 'konva';
import { Document, pdfjs } from 'react-pdf';
import pdfMake from 'pdfmake/build/pdfmake';
// @ts-ignore - vfs_fonts is a JS file without types
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { logger } from '../utils/logger';

// Initialize pdfmake with default fonts
// vfs_fonts.js exports vfs directly: module.exports = vfs;
try {
  if (pdfFonts && typeof pdfFonts === 'object') {
    // pdfFonts IS the vfs object (not wrapped)
    (pdfMake as any).vfs = pdfFonts as any;
  } else {
    // Initialize empty vfs if fonts not available
    (pdfMake as any).vfs = (pdfMake as any).vfs || {};
    logger.warn('Could not load pdfmake default fonts, using empty vfs');
  }
} catch (error) {
  logger.error('Error initializing pdfmake fonts:', error);
  (pdfMake as any).vfs = (pdfMake as any).vfs || {};
}

// Configure PDF.js worker - use local file served from same origin (via ngrok)
// Vite copies files from public/ to dist/ root, backend serves it directly from /pdf.worker.min.mjs
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

type Tool = 'pen' | 'circle' | 'rect' | 'arrow' | 'text' | 'eraser';

interface DrawingLine {
  tool: 'pen' | 'eraser';
  points: number[];
  color: string;
  strokeWidth: number;
}

interface Shape {
  id: string;
  type: 'circle' | 'rect' | 'arrow' | 'text';
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
  radius?: number | undefined;
  points?: number[] | undefined;
  text?: string | undefined;
  color: string;
  strokeWidth: number;
}

const STORAGE_KEY = 'medical-record-demo-state';

interface FormData {
  chiefComplaint: string;
  vitalSigns: {
    bp: string;
    pulse: string;
    temperature: string;
  };
  assessment: string;
  treatmentPlan: string;
  notes: string;
}

interface SavedState {
  formData: FormData;
  lines: DrawingLine[];
  shapes: Shape[];
  stageSize: { width: number; height: number };
  backgroundImageDataUrl: string | null;
  pdfFileName: string | null;
  pdfFileDataUrl: string | null;
  pdfPageNumber: number;
  pdfNumPages: number | null;
  savedAt: string;
}

const DrawingDemoPage: React.FC = () => {
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [lines, setLines] = useState<DrawingLine[]>([]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
  const [backgroundImageDataUrl, setBackgroundImageDataUrl] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfFileDataUrl, setPdfFileDataUrl] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [pdfPageNumber, setPdfPageNumber] = useState(1);
  const [pdfNumPages, setPdfNumPages] = useState<number | null>(null);
  const [pdfPageImage, setPdfPageImage] = useState<HTMLImageElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [history, setHistory] = useState<{ lines: DrawingLine[]; shapes: Shape[] }[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(true);
  
  // Form data state
  const [formData, setFormData] = useState<FormData>({
    chiefComplaint: '',
    vitalSigns: {
      bp: '',
      pulse: '',
      temperature: '',
    },
    assessment: '',
    treatmentPlan: '',
    notes: '',
  });
  
  const stageRef = useRef<Konva.Stage>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const [textInput, setTextInput] = useState('');
  const [textPosition, setTextPosition] = useState<{ x: number; y: number } | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Color presets
  const colors = [
    '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
    '#FFA500', '#800080', '#FFC0CB', '#A52A2A', '#808080'
  ];

  // Save state to localStorage
  const saveState = useCallback(() => {
    try {
      const state: SavedState = {
        formData,
        lines,
        shapes,
        stageSize,
        backgroundImageDataUrl,
        pdfFileName,
        pdfFileDataUrl,
        pdfPageNumber,
        pdfNumPages,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      logger.log('State saved to localStorage');
    } catch (error) {
      logger.error('Error saving state:', error);
      // localStorage might be full or unavailable
    }
  }, [formData, lines, shapes, stageSize, backgroundImageDataUrl, pdfFileName, pdfFileDataUrl, pdfPageNumber, pdfNumPages]);

  // Create default human anatomy diagram
  const createDefaultAnatomyDiagram = useCallback((): string => {
    // Create a simple SVG human figure
    const svg = `
      <svg width="600" height="800" xmlns="http://www.w3.org/2000/svg">
        <!-- Head -->
        <circle cx="300" cy="100" r="50" fill="none" stroke="#333" stroke-width="2"/>
        <!-- Neck -->
        <line x1="300" y1="150" x2="300" y2="180" stroke="#333" stroke-width="2"/>
        <!-- Torso -->
        <rect x="250" y="180" width="100" height="200" fill="none" stroke="#333" stroke-width="2"/>
        <!-- Left arm -->
        <line x1="250" y1="220" x2="180" y2="280" stroke="#333" stroke-width="2"/>
        <line x1="180" y1="280" x2="180" y2="380" stroke="#333" stroke-width="2"/>
        <!-- Right arm -->
        <line x1="350" y1="220" x2="420" y2="280" stroke="#333" stroke-width="2"/>
        <line x1="420" y1="280" x2="420" y2="380" stroke="#333" stroke-width="2"/>
        <!-- Left leg -->
        <line x1="280" y1="380" x2="250" y2="500" stroke="#333" stroke-width="2"/>
        <line x1="250" y1="500" x2="250" y2="650" stroke="#333" stroke-width="2"/>
        <!-- Right leg -->
        <line x1="320" y1="380" x2="350" y2="500" stroke="#333" stroke-width="2"/>
        <line x1="350" y1="500" x2="350" y2="650" stroke="#333" stroke-width="2"/>
        <!-- Labels -->
        <text x="300" y="70" text-anchor="middle" font-family="Arial" font-size="14" fill="#666">頭部</text>
        <text x="300" y="300" text-anchor="middle" font-family="Arial" font-size="14" fill="#666">軀幹</text>
        <text x="150" y="330" text-anchor="middle" font-family="Arial" font-size="12" fill="#666">左臂</text>
        <text x="450" y="330" text-anchor="middle" font-family="Arial" font-size="12" fill="#666">右臂</text>
        <text x="220" y="580" text-anchor="middle" font-family="Arial" font-size="12" fill="#666">左腿</text>
        <text x="380" y="580" text-anchor="middle" font-family="Arial" font-size="12" fill="#666">右腿</text>
      </svg>
    `;
    // Convert SVG to data URL
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  }, []);

  // Load state from localStorage
  const loadState = useCallback(async () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        // No saved state - load default anatomy diagram
        const defaultDiagram = createDefaultAnatomyDiagram();
        setBackgroundImageDataUrl(defaultDiagram);
        const img = new window.Image();
        img.onload = () => {
          setBackgroundImage(img);
          setStageSize({ width: 600, height: 800 });
          setIsLoading(false);
        };
        img.onerror = () => {
          logger.error('Failed to load default anatomy diagram');
          setIsLoading(false);
        };
        img.src = defaultDiagram;
        return;
      }

      const state: SavedState = JSON.parse(saved);
      
      // Restore form data
      if (state.formData) {
        setFormData(state.formData);
      }
      
      // Restore drawing state
      setLines(state.lines || []);
      setShapes(state.shapes || []);
      setStageSize(state.stageSize || { width: 800, height: 600 });
      setPdfPageNumber(state.pdfPageNumber || 1);
      setPdfNumPages(state.pdfNumPages || null);
      setPdfFileName(state.pdfFileName || null);
      setPdfFileDataUrl(state.pdfFileDataUrl || null);
      setBackgroundImageDataUrl(state.backgroundImageDataUrl || null);

      // Restore background image if exists, otherwise load default anatomy diagram
      if (state.backgroundImageDataUrl) {
        const img = new window.Image();
        img.onload = () => {
          setBackgroundImage(img);
          setIsLoading(false);
        };
        img.onerror = () => {
          logger.error('Failed to load saved background image');
          setIsLoading(false);
        };
        img.src = state.backgroundImageDataUrl;
      } else if (!state.pdfFileDataUrl) {
        // No background image and no PDF - load default anatomy diagram
        const defaultDiagram = createDefaultAnatomyDiagram();
        setBackgroundImageDataUrl(defaultDiagram);
        const img = new window.Image();
        img.onload = () => {
          setBackgroundImage(img);
          setStageSize({ width: 600, height: 800 });
          setIsLoading(false);
        };
        img.onerror = () => {
          logger.error('Failed to load default anatomy diagram');
          setIsLoading(false);
        };
        img.src = defaultDiagram;
      } else {
        setIsLoading(false);
      }

      // Restore PDF if exists
      if (state.pdfFileDataUrl && state.pdfFileName) {
        // Convert data URL back to File object
        const response = await fetch(state.pdfFileDataUrl);
        const blob = await response.blob();
        const file = new File([blob], state.pdfFileName, { type: 'application/pdf' });
        setPdfFile(file);
        // PDF page will be rendered by the useEffect that watches pdfFile and pdfPageNumber
      }

      logger.log('State loaded from localStorage');
    } catch (error) {
      logger.error('Error loading state:', error);
      // On error, still load default anatomy diagram
      const defaultDiagram = createDefaultAnatomyDiagram();
      setBackgroundImageDataUrl(defaultDiagram);
      const img = new window.Image();
      img.onload = () => {
        setBackgroundImage(img);
        setStageSize({ width: 600, height: 800 });
        setIsLoading(false);
      };
      img.src = defaultDiagram;
    }
  }, [createDefaultAnatomyDiagram]);

  // Auto-save on changes (debounced)
  useEffect(() => {
    if (isLoading) return; // Don't save while loading
    
    const timeoutId = setTimeout(() => {
      saveState();
    }, 1000); // Debounce: save 1 second after last change

    return () => clearTimeout(timeoutId);
  }, [formData, lines, shapes, stageSize, backgroundImageDataUrl, pdfFileName, pdfFileDataUrl, pdfPageNumber, pdfNumPages, isLoading, saveState]);

  // Load state on mount
  useEffect(() => {
    loadState();
  }, [loadState]);

  // Prevent scrolling when interacting with canvas
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    // Always prevent default touch behavior on canvas to avoid scrolling
    const preventScroll = (e: TouchEvent) => {
      e.preventDefault();
    };

    // Use capture phase to catch events early
    container.addEventListener('touchstart', preventScroll, { passive: false, capture: true });
    container.addEventListener('touchmove', preventScroll, { passive: false, capture: true });
    container.addEventListener('touchend', preventScroll, { passive: false, capture: true });

    return () => {
      container.removeEventListener('touchstart', preventScroll, { capture: true });
      container.removeEventListener('touchmove', preventScroll, { capture: true });
      container.removeEventListener('touchend', preventScroll, { capture: true });
    };
  }, []);

  // Save state to history
  const saveToHistory = useCallback(() => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ lines: [...lines], shapes: [...shapes] });
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [lines, shapes, history, historyIndex]);

  // Undo
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevState = history[historyIndex - 1];
      if (prevState) {
        setLines(prevState.lines);
        setShapes(prevState.shapes);
        setHistoryIndex(historyIndex - 1);
      }
    } else if (historyIndex === 0) {
      setLines([]);
      setShapes([]);
      setHistoryIndex(-1);
    }
  }, [history, historyIndex]);

  // Redo
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1];
      if (nextState) {
        setLines(nextState.lines);
        setShapes(nextState.shapes);
        setHistoryIndex(historyIndex + 1);
      }
    }
  }, [history, historyIndex]);

  // Handle mouse/touch down
  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // Prevent default scrolling behavior on touch devices
    if (e.evt instanceof TouchEvent) {
      e.evt.preventDefault();
    }
    
    setIsDrawing(true);
    const stage = e.target.getStage();
    if (!stage) return;

    const point = stage.getPointerPosition();
    if (!point) return;

    if (tool === 'pen' || tool === 'eraser') {
      const newLine: DrawingLine = {
        tool,
        points: [point.x, point.y],
        color: tool === 'eraser' ? '#FFFFFF' : color,
        strokeWidth: tool === 'eraser' ? strokeWidth * 2 : strokeWidth,
      };
      setLines([...lines, newLine]);
    } else if (tool === 'circle' || tool === 'rect') {
      const newShape: Shape = {
        id: Date.now().toString(),
        type: tool,
        x: point.x,
        y: point.y,
        width: tool === 'rect' ? 0 : undefined,
        height: tool === 'rect' ? 0 : undefined,
        radius: tool === 'circle' ? 0 : undefined,
        color,
        strokeWidth,
      };
      setShapes([...shapes, newShape]);
    } else if (tool === 'arrow') {
      const newShape: Shape = {
        id: Date.now().toString(),
        type: 'arrow',
        x: point.x,
        y: point.y,
        points: [0, 0],
        color,
        strokeWidth,
      };
      setShapes([...shapes, newShape]);
    } else if (tool === 'text') {
      setTextPosition(point);
      setTextInput('');
      // Focus text input after a brief delay
      setTimeout(() => {
        textInputRef.current?.focus();
      }, 100);
    }
  };

  // Handle mouse/touch move
  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!isDrawing) return;

    // Prevent default scrolling behavior on touch devices
    if (e.evt instanceof TouchEvent) {
      e.evt.preventDefault();
    }

    const stage = e.target.getStage();
    if (!stage) return;

    const point = stage.getPointerPosition();
    if (!point) return;

    if (tool === 'pen' || tool === 'eraser') {
      const lastLine = lines[lines.length - 1];
      if (lastLine) {
        lastLine.points = lastLine.points.concat([point.x, point.y]);
        setLines([...lines]);
      }
    } else if (tool === 'circle' || tool === 'rect') {
      const lastShape = shapes[shapes.length - 1];
      if (lastShape && (lastShape.type === 'circle' || lastShape.type === 'rect')) {
        const width = point.x - lastShape.x;
        const height = point.y - lastShape.y;
        if (lastShape.type === 'circle') {
          lastShape.radius = Math.abs(Math.min(width, height)) / 2;
        } else {
          lastShape.width = width;
          lastShape.height = height;
        }
        setShapes([...shapes]);
      }
    } else if (tool === 'arrow') {
      const lastShape = shapes[shapes.length - 1];
      if (lastShape && lastShape.type === 'arrow') {
        lastShape.points = [point.x - lastShape.x, point.y - lastShape.y];
        setShapes([...shapes]);
      }
    }
  };

  // Handle mouse/touch up
  const handleMouseUp = () => {
    if (isDrawing) {
      setIsDrawing(false);
      saveToHistory();
    }
  };

  // Handle text input
  const handleTextSubmit = () => {
    if (textPosition && textInput.trim()) {
      const newShape: Shape = {
        id: Date.now().toString(),
        type: 'text',
        x: textPosition.x,
        y: textPosition.y,
        text: textInput,
        color,
        strokeWidth: 20, // Font size
      };
      setShapes([...shapes, newShape]);
      setTextPosition(null);
      setTextInput('');
      saveToHistory();
    }
  };

  // Clear canvas
  const handleClear = () => {
    setLines([]);
    setShapes([]);
    setHistory([]);
    setHistoryIndex(-1);
    // Note: background image/PDF are preserved
  };

  // Clear all including background
  const handleClearAll = () => {
    handleClear();
    setBackgroundImage(null);
    setBackgroundImageDataUrl(null);
    setPdfFile(null);
    setPdfFileDataUrl(null);
    setPdfFileName(null);
    setPdfPageImage(null);
    setPdfPageNumber(1);
    setPdfNumPages(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  // Manual save
  const handleManualSave = () => {
    saveState();
    alert('已儲存！');
  };

  // Handle image upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Clear PDF if uploading image
      setPdfFile(null);
      setPdfPageImage(null);
      setPdfFileDataUrl(null);
      setPdfFileName(null);
      
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        setBackgroundImageDataUrl(dataUrl);
        const img = new window.Image();
        img.onload = () => {
          setBackgroundImage(img);
          // Adjust stage size to image
          setStageSize({ width: Math.min(img.width, 1200), height: Math.min(img.height, 800) });
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle PDF upload
  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      // Clear image if uploading PDF
      setBackgroundImage(null);
      setBackgroundImageDataUrl(null);
      setPdfFile(file);
      setPdfFileName(file.name);
      setPdfPageNumber(1);
      
      // Store PDF as data URL for persistence
      const reader = new FileReader();
      reader.onload = (event) => {
        setPdfFileDataUrl(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle PDF load success
  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setPdfNumPages(numPages);
    // Render first page
    renderPdfPage(1);
  };

  // Render PDF page to image
  const renderPdfPage = async (pageNum: number) => {
    if (!pdfFile) return;

    try {
      const loadingTask = pdfjs.getDocument({ data: await pdfFile.arrayBuffer() });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(pageNum);

      const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better quality
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      if (!context) return;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
        canvas: canvas,
      };

      await page.render(renderContext).promise;

      // Convert canvas to image
      const img = new window.Image();
      img.onload = () => {
        setPdfPageImage(img);
        // Adjust stage size to PDF page
        setStageSize({ 
          width: Math.min(img.width, 1200), 
          height: Math.min(img.height, 800) 
        });
      };
      img.src = canvas.toDataURL();
    } catch (error) {
      logger.error('Error rendering PDF page:', error);
      alert('無法載入 PDF 頁面');
    }
  };

  // Handle PDF page change
  useEffect(() => {
    if (pdfFile && pdfPageNumber) {
      renderPdfPage(pdfPageNumber);
    }
  }, [pdfFile, pdfPageNumber]);

  // Export as image
  const handleExport = () => {
    const stage = stageRef.current;
    if (stage) {
      const dataURL = stage.toDataURL({ pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = `病歷記錄-${Date.now()}.png`;
      link.href = dataURL;
      link.click();
    }
  };

  // Export as PDF with form data and drawing
  const handleExportPdf = async () => {
    const stage = stageRef.current;
    if (!stage) return;

    try {
      // Load Chinese font and convert to base64
      let fontBase64 = '';
      try {
        const fontResponse = await fetch('/fonts/NotoSansTC-Regular.ttf');
        if (fontResponse.ok) {
          const fontBlob = await fontResponse.blob();
          const fontArrayBuffer = await fontBlob.arrayBuffer();
          const fontBytes = new Uint8Array(fontArrayBuffer);
          // Convert to base64
          const binaryString = Array.from(fontBytes, byte => String.fromCharCode(byte)).join('');
          fontBase64 = btoa(binaryString);
          
          // Register font with pdfmake
          (pdfMake as any).vfs['NotoSansTC-Regular.ttf'] = fontBase64;
          (pdfMake as any).fonts = {
            ...(pdfMake as any).fonts,
            NotoSansTC: {
              normal: 'NotoSansTC-Regular.ttf',
              bold: 'NotoSansTC-Regular.ttf',
              italics: 'NotoSansTC-Regular.ttf',
              bolditalics: 'NotoSansTC-Regular.ttf',
            },
          };
        }
      } catch (error) {
        logger.error('Failed to load Chinese font:', error);
        // Continue without Chinese font - pdfmake will use default
      }
      
      // Build form content
      const formFields = [
        { label: '主訴', value: formData.chiefComplaint },
        { label: '生命徵象', value: `血壓: ${formData.vitalSigns.bp || '無'}, 脈搏: ${formData.vitalSigns.pulse || '無'}, 體溫: ${formData.vitalSigns.temperature || '無'}` },
        { label: '評估', value: formData.assessment },
        { label: '治療計畫', value: formData.treatmentPlan },
        { label: '備註', value: formData.notes },
      ];
      
      const formContent: any[] = [
        {
          text: '病歷記錄',
          fontSize: 20,
          bold: true,
          margin: [0, 0, 0, 20],
          ...(fontBase64 ? { font: 'NotoSansTC' } : {}),
        },
      ];
      
      // Add form fields
      for (const field of formFields) {
        if (field.value.trim()) {
          formContent.push({
            text: field.label + ':',
            fontSize: 12,
            bold: true,
            margin: [0, 10, 0, 5],
            ...(fontBase64 ? { font: 'NotoSansTC' } : {}),
          });
          formContent.push({
            text: field.value,
            fontSize: 11,
            margin: [0, 0, 0, 10],
            ...(fontBase64 ? { font: 'NotoSansTC' } : {}),
          });
        }
      }
      
      // Get canvas as image for drawing section
      let drawingImageDataUrl = '';
      if (lines.length > 0 || shapes.length > 0 || backgroundImage || pdfPageImage) {
        // pdfmake expects the full data URL (with data:image/png;base64, prefix)
        drawingImageDataUrl = stage.toDataURL({ pixelRatio: 2 });
      }
      
      // Build PDF document definition
      const docDefinition: any = {
        content: [
          ...formContent,
          ...(drawingImageDataUrl ? [
            {
              text: '繪圖/註解',
              fontSize: 12,
              bold: true,
              margin: [0, 20, 0, 10],
              ...(fontBase64 ? { font: 'NotoSansTC' } : {}),
            },
            {
              image: drawingImageDataUrl,
              width: 500,
              alignment: 'center',
              margin: [0, 0, 0, 20],
            },
          ] : []),
        ],
        defaultStyle: {
          ...(fontBase64 ? { font: 'NotoSansTC' } : {}),
        },
        pageSize: 'A4',
        pageMargins: [40, 60, 40, 60],
      };
      
      // Generate and download PDF
      pdfMake.createPdf(docDefinition).download(`病歷記錄-${Date.now()}.pdf`);
    } catch (error) {
      logger.error('Error exporting PDF:', error);
      alert('無法匯出 PDF，請稍後再試');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl mb-2">載入中...</div>
          <div className="text-sm text-gray-600">正在恢復上次的編輯內容</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-4">
          <h1 className="text-3xl font-bold mb-2">病歷記錄示範</h1>
          <p className="text-gray-600 mb-4">
            完整的病歷記錄系統，包含表單欄位和自由繪圖/註解功能。支援 iPad 觸控和手寫筆。
            <br />
            <span className="text-sm text-blue-600">💡 編輯內容會自動儲存，離開頁面後回來會自動恢復</span>
          </p>

          {/* Form Section */}
          <div className="border-b pb-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">表單欄位</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  主訴
                </label>
                <textarea
                  value={formData.chiefComplaint}
                  onChange={(e) => setFormData({ ...formData, chiefComplaint: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 resize-y"
                  rows={2}
                  placeholder="請輸入主訴..."
                />
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    血壓
                  </label>
                  <input
                    type="text"
                    value={formData.vitalSigns.bp}
                    onChange={(e) => setFormData({
                      ...formData,
                      vitalSigns: { ...formData.vitalSigns, bp: e.target.value }
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    placeholder="120/80"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    脈搏
                  </label>
                  <input
                    type="text"
                    value={formData.vitalSigns.pulse}
                    onChange={(e) => setFormData({
                      ...formData,
                      vitalSigns: { ...formData.vitalSigns, pulse: e.target.value }
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    placeholder="72"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    體溫
                  </label>
                  <input
                    type="text"
                    value={formData.vitalSigns.temperature}
                    onChange={(e) => setFormData({
                      ...formData,
                      vitalSigns: { ...formData.vitalSigns, temperature: e.target.value }
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    placeholder="36.5"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  評估
                </label>
                <textarea
                  value={formData.assessment}
                  onChange={(e) => setFormData({ ...formData, assessment: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 resize-y"
                  rows={3}
                  placeholder="請輸入評估..."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  治療計畫
                </label>
                <textarea
                  value={formData.treatmentPlan}
                  onChange={(e) => setFormData({ ...formData, treatmentPlan: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 resize-y"
                  rows={3}
                  placeholder="請輸入治療計畫..."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  備註
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 resize-y"
                  rows={2}
                  placeholder="其他備註..."
                />
              </div>
            </div>
          </div>

          {/* Drawing Section */}
          <div className="mb-4">
            <h2 className="text-xl font-semibold mb-4">自由繪圖區</h2>

            {/* Toolbar */}
            <div className="border-b pb-4 mb-4">
            <div className="flex flex-wrap gap-4 items-center">
              {/* Tools */}
              <div className="flex gap-2">
                <button
                  onClick={() => setTool('pen')}
                  className={`px-4 py-2 rounded ${tool === 'pen' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                >
                  ✏️ 筆
                </button>
                <button
                  onClick={() => setTool('circle')}
                  className={`px-4 py-2 rounded ${tool === 'circle' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                >
                  ⭕ 圓形
                </button>
                <button
                  onClick={() => setTool('rect')}
                  className={`px-4 py-2 rounded ${tool === 'rect' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                >
                  ▭ 矩形
                </button>
                <button
                  onClick={() => setTool('arrow')}
                  className={`px-4 py-2 rounded ${tool === 'arrow' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                >
                  ➡️ 箭頭
                </button>
                <button
                  onClick={() => setTool('text')}
                  className={`px-4 py-2 rounded ${tool === 'text' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                >
                  📝 文字
                </button>
                <button
                  onClick={() => setTool('eraser')}
                  className={`px-4 py-2 rounded ${tool === 'eraser' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                >
                  🧹 橡皮擦
                </button>
              </div>

              {/* Color picker */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">顏色：</label>
                <div className="flex gap-1">
                  {colors.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-8 h-8 rounded border-2 ${color === c ? 'border-gray-800' : 'border-gray-300'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-10 h-8 rounded border"
                />
              </div>

              {/* Stroke width */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">大小：</label>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={strokeWidth}
                  onChange={(e) => setStrokeWidth(Number(e.target.value))}
                  className="w-24"
                />
                <span className="text-sm w-8">{strokeWidth}px</span>
              </div>

              {/* Actions */}
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={handleUndo}
                  disabled={historyIndex < 0}
                  className="px-4 py-2 rounded bg-gray-200 disabled:opacity-50"
                >
                  ↶ 復原
                </button>
                <button
                  onClick={handleRedo}
                  disabled={historyIndex >= history.length - 1}
                  className="px-4 py-2 rounded bg-gray-200 disabled:opacity-50"
                >
                  ↷ 重做
                </button>
                <button
                  onClick={() => imageInputRef.current?.click()}
                  className="px-4 py-2 rounded bg-gray-200"
                >
                  📷 上傳圖片
                </button>
                <button
                  onClick={() => pdfInputRef.current?.click()}
                  className="px-4 py-2 rounded bg-gray-200"
                >
                  📄 上傳 PDF
                </button>
                {pdfFile && pdfNumPages && (
                  <div className="flex items-center gap-2 px-4 py-2 rounded bg-blue-100">
                    <button
                      onClick={() => setPdfPageNumber(Math.max(1, pdfPageNumber - 1))}
                      disabled={pdfPageNumber <= 1}
                      className="px-2 py-1 rounded bg-white disabled:opacity-50"
                    >
                      ←
                    </button>
                    <span className="text-sm">
                      頁 {pdfPageNumber} / {pdfNumPages}
                    </span>
                    <button
                      onClick={() => setPdfPageNumber(Math.min(pdfNumPages, pdfPageNumber + 1))}
                      disabled={pdfPageNumber >= pdfNumPages}
                      className="px-2 py-1 rounded bg-white disabled:opacity-50"
                    >
                      →
                    </button>
                  </div>
                )}
                <button
                  onClick={handleManualSave}
                  className="px-4 py-2 rounded bg-purple-500 text-white"
                  title="手動儲存（通常會自動儲存）"
                >
                  💾 儲存
                </button>
                <button
                  onClick={handleClear}
                  className="px-4 py-2 rounded bg-red-500 text-white"
                >
                  🗑️ 清除繪圖
                </button>
                <button
                  onClick={handleClearAll}
                  className="px-4 py-2 rounded bg-red-700 text-white"
                  title="清除所有內容包括背景圖片/PDF"
                >
                  🗑️ 清除全部
                </button>
                <button
                  onClick={handleExport}
                  className="px-4 py-2 rounded bg-green-500 text-white"
                >
                  💾 匯出 PNG
                </button>
                <button
                  onClick={handleExportPdf}
                  className="px-4 py-2 rounded bg-blue-500 text-white"
                >
                  📄 匯出 PDF
                </button>
              </div>
            </div>
          </div>

          {/* Canvas */}
          <div 
            ref={canvasContainerRef}
            className="border-2 border-gray-300 rounded-lg overflow-hidden bg-white"
            style={{ 
              touchAction: 'none',
              WebkitOverflowScrolling: 'touch',
              overflow: 'hidden'
            }}
          >
            <Stage
              ref={stageRef}
              width={stageSize.width}
              height={stageSize.height}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onTouchStart={handleMouseDown}
              onTouchMove={handleMouseMove}
              onTouchEnd={handleMouseUp}
              style={{ 
                cursor: tool === 'pen' || tool === 'eraser' ? 'crosshair' : 'default',
                touchAction: 'none'
              }}
            >
              <Layer>
                {/* Background PDF page or image */}
                {pdfPageImage && (
                  <KonvaImage
                    image={pdfPageImage}
                    width={stageSize.width}
                    height={stageSize.height}
                    listening={false}
                  />
                )}
                {!pdfPageImage && backgroundImage && (
                  <KonvaImage
                    image={backgroundImage}
                    width={stageSize.width}
                    height={stageSize.height}
                    listening={false}
                  />
                )}

                {/* Drawing lines */}
                {lines.map((line, i) => (
                  <Line
                    key={i}
                    points={line.points}
                    stroke={line.color}
                    strokeWidth={line.strokeWidth}
                    tension={0.5}
                    lineCap="round"
                    lineJoin="round"
                    globalCompositeOperation={line.tool === 'eraser' ? 'destination-out' : 'source-over'}
                  />
                ))}

                {/* Shapes */}
                {shapes.map((shape) => {
                  if (shape.type === 'circle') {
                    return (
                      <Circle
                        key={shape.id}
                        x={shape.x}
                        y={shape.y}
                        radius={shape.radius || 0}
                        stroke={shape.color}
                        strokeWidth={shape.strokeWidth}
                        fill="transparent"
                      />
                    );
                  } else if (shape.type === 'rect') {
                    return (
                      <Rect
                        key={shape.id}
                        x={shape.x}
                        y={shape.y}
                        width={shape.width || 0}
                        height={shape.height || 0}
                        stroke={shape.color}
                        strokeWidth={shape.strokeWidth}
                        fill="transparent"
                      />
                    );
                  } else if (shape.type === 'arrow') {
                    return (
                      <Arrow
                        key={shape.id}
                        x={shape.x}
                        y={shape.y}
                        points={shape.points || [0, 0]}
                        stroke={shape.color}
                        strokeWidth={shape.strokeWidth}
                        fill={shape.color}
                        pointerLength={10}
                        pointerWidth={10}
                      />
                    );
                  } else if (shape.type === 'text') {
                    return (
                      <Text
                        key={shape.id}
                        x={shape.x}
                        y={shape.y}
                        text={shape.text || ''}
                        fontSize={shape.strokeWidth}
                        fill={shape.color}
                        fontFamily="Arial"
                      />
                    );
                  }
                  return null;
                })}
              </Layer>
            </Stage>
          </div>

            {/* Instructions */}
            <div className="mt-4 p-4 bg-blue-50 rounded-lg">
              <h3 className="font-semibold mb-2">使用說明：</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium mb-1">表單欄位：</h4>
                  <ul className="list-disc list-inside text-sm space-y-1 text-gray-700">
                    <li>填寫上方的表單欄位</li>
                    <li>所有欄位都是選填的</li>
                    <li>資料會自動儲存</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium mb-1">繪圖工具：</h4>
                  <ul className="list-disc list-inside text-sm space-y-1 text-gray-700">
                    <li><strong>筆：</strong>點擊/觸碰並拖曳來自由繪圖</li>
                    <li><strong>圓形/矩形：</strong>點擊並拖曳來建立形狀</li>
                    <li><strong>箭頭：</strong>點擊起點，拖曳到終點</li>
                    <li><strong>文字：</strong>點擊想要放置文字的位置，然後在下方輸入框中輸入</li>
                    <li><strong>橡皮擦：</strong>在現有內容上繪圖來清除</li>
                    <li><strong>上傳圖片/PDF：</strong>上傳背景圖片或 PDF 來繪圖</li>
                    <li><strong>匯出 PDF：</strong>將表單資料和繪圖匯出為 PDF</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Text input (hidden but functional) */}
          {textPosition && (
            <div className="mt-4">
              <div className="flex gap-2">
                <input
                  ref={textInputRef}
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleTextSubmit();
                    } else if (e.key === 'Escape') {
                      setTextPosition(null);
                      setTextInput('');
                    }
                  }}
                  placeholder="輸入文字後按 Enter..."
                  className="flex-1 px-4 py-2 border rounded"
                />
                <button
                  onClick={handleTextSubmit}
                  className="px-4 py-2 bg-blue-500 text-white rounded"
                >
                  新增文字
                </button>
                <button
                  onClick={() => {
                    setTextPosition(null);
                    setTextInput('');
                  }}
                  className="px-4 py-2 bg-gray-200 rounded"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* PDF Document (hidden, used for page count) */}
          {pdfFile && (
            <div className="hidden">
              <Document
                file={pdfFile}
                onLoadSuccess={onDocumentLoadSuccess}
                loading={<div>載入 PDF...</div>}
              />
            </div>
          )}

          {/* Hidden file inputs */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf"
            onChange={handlePdfUpload}
            className="hidden"
          />
        </div>
      </div>
    </div>
  );
};

export default DrawingDemoPage;
