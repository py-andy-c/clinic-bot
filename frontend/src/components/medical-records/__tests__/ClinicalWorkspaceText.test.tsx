import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Konva from 'konva';
import { ClinicalWorkspace } from '../ClinicalWorkspace';

// Mock browser-image-compression
vi.mock('browser-image-compression', () => ({
  default: vi.fn().mockImplementation((file) => Promise.resolve(file)),
}));

// Mock use-image
vi.mock('use-image', () => ({
  default: vi.fn().mockImplementation(() => {
    const img = document.createElement('img');
    img.width = 800;
    img.height = 600;
    return [img];
  }),
}));

// Mock apiService
vi.mock('../../../services/api', () => ({
  apiService: {
    uploadMedicalRecordMedia: vi.fn(),
  },
}));

describe('ClinicalWorkspace Text Tool', () => {
  const mockInitialData = {
    layers: [],
    canvas_width: 1000,
    canvas_height: 1000,
    version: 2,
  };

  const mockOnUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock offsetWidth/Height
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 1000 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 800 });

    // Mock Konva Stage pointer position
    vi.spyOn(Konva.Stage.prototype, 'getPointerPosition').mockReturnValue({ x: 100, y: 100 });
    vi.spyOn(Konva.Stage.prototype, 'getRelativePointerPosition').mockReturnValue({ x: 100, y: 100 });

    // Mock getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      width: 850,
      height: 1000,
      top: 0,
      left: 0,
      bottom: 1000,
      right: 850,
      x: 0,
      y: 0,
      toJSON: () => { },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('activates text tool and shows font size control', () => {
    render(
      <ClinicalWorkspace
        recordId={1}
        initialData={mockInitialData}
        onUpdate={mockOnUpdate}
      />
    );

    // Click text tool
    const textBtn = screen.getByLabelText('文字 (T)');
    fireEvent.click(textBtn);

    // Font size control should appear
    const fontSizeSelect = screen.getByDisplayValue('20');
    expect(fontSizeSelect).toBeDefined();
  });

  it('updates font size', () => {
    render(
      <ClinicalWorkspace
        recordId={1}
        initialData={mockInitialData}
        onUpdate={mockOnUpdate}
      />
    );

    const textBtn = screen.getByLabelText('文字 (T)');
    fireEvent.click(textBtn);

    const fontSizeSelect = screen.getByDisplayValue('20') as HTMLSelectElement;
    fireEvent.change(fontSizeSelect, { target: { value: '32' } });

    expect(fontSizeSelect.value).toBe('32');
  });

  it('creates text box, handles input, and verifies auto-grow properties', async () => {
    const { container } = render(
      <ClinicalWorkspace
        recordId={1}
        initialData={mockInitialData}
        onUpdate={mockOnUpdate}
      />
    );

    // 1. Select text tool
    const textBtn = screen.getByLabelText('文字 (T)');
    fireEvent.click(textBtn);

    // 2. Click on canvas to create text box
    const stage = container.querySelector('.konvajs-content');
    expect(stage).not.toBeNull();
    
    // Simulate mousedown on stage
    fireEvent.mouseDown(stage!);
    fireEvent.mouseUp(stage!);

    // 3. Expect textarea to appear (wait for effect)
    await new Promise(resolve => setTimeout(resolve, 0));

    const textarea = document.querySelector('textarea');
    expect(textarea).not.toBeNull();
    
    // 4. Type text
    fireEvent.change(textarea!, { target: { value: 'Hello World' } });
    fireEvent.input(textarea!); 
    
    // 5. Blur to save
    fireEvent.blur(textarea!);
    
    // 6. Verify onUpdate called with new layer
    expect(mockOnUpdate).toHaveBeenCalled();
    const lastCall = mockOnUpdate.mock.calls[mockOnUpdate.mock.calls.length - 1][0];
    const textLayer = lastCall.layers.find((l: { type: string; text: string; width?: number }) => l.type === 'text');
    expect(textLayer).toBeDefined();
    expect(textLayer.text).toBe('Hello World');
    expect(textLayer.width).toBeUndefined(); // Should be undefined for auto-grow
  });
});
