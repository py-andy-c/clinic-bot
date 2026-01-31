import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ClinicalWorkspace } from '../ClinicalWorkspace';
import { apiService } from '../../../services/api';
import imageCompression from 'browser-image-compression';

// Mock browser-image-compression
vi.mock('browser-image-compression', () => ({
  default: vi.fn().mockImplementation((file) => Promise.resolve(file)),
}));

// Mock apiService
vi.mock('../../../services/api', () => ({
  apiService: {
    uploadMedicalRecordMedia: vi.fn(),
  },
}));

// Mock Canvas API
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  scale: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  drawImage: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  strokeRect: vi.fn(),
  fillRect: vi.fn(),
});

describe('ClinicalWorkspace', () => {
  const mockInitialData = {
    layers: [],
    canvas_width: 1000,
    canvas_height: 1000,
    version: 2,
  };

  const mockOnUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock URL.createObjectURL and revokeObjectURL
    global.URL.createObjectURL = vi.fn().mockReturnValue('mock-url');
    global.URL.revokeObjectURL = vi.fn();
    
    // Mock Image naturalWidth/Height
    // @ts-expect-error Mocking Image global
    global.Image = class {
      onload: () => void = () => { };
      set src(_: string) {
        setTimeout(() => this.onload(), 0);
      }
      naturalWidth = 800;
      naturalHeight = 600;
      width = 800;
      height = 600;
    };
  });

  it('renders correctly', () => {
    render(
      <ClinicalWorkspace
        recordId={1}
        initialData={mockInitialData}
        initialVersion={1}
        onUpdate={mockOnUpdate}
      />
    );
    expect(screen.getByTitle('畫筆')).toBeDefined();
  });

  it('compresses image before upload', async () => {
    const mockFile = new File(['foo'], 'test.png', { type: 'image/png' });
    vi.mocked(apiService.uploadMedicalRecordMedia).mockResolvedValue({ id: 'media-1', url: 'uploaded-url', filename: 'test.png' });

    render(
      <ClinicalWorkspace
        recordId={1}
        initialData={mockInitialData}
        initialVersion={1}
        onUpdate={mockOnUpdate}
      />
    );

    const input = screen.getByTitle('上傳圖片').nextElementSibling as HTMLInputElement;
    fireEvent.change(input, { target: { files: [mockFile] } });

    await waitFor(() => {
      expect(imageCompression).toHaveBeenCalledWith(mockFile, expect.objectContaining({
        useWebWorker: true,
        fileType: 'image/webp',
      }));
    });

    await waitFor(() => {
      expect(apiService.uploadMedicalRecordMedia).toHaveBeenCalled();
    });
  });

  it('maintains aspect ratio after compression', async () => {
    const mockFile = new File(['foo'], 'test.png', { type: 'image/png' });
    vi.mocked(apiService.uploadMedicalRecordMedia).mockResolvedValue({ id: 'media-1', url: 'uploaded-url', filename: 'test.png' });

    render(
      <ClinicalWorkspace
        recordId={1}
        initialData={mockInitialData}
        initialVersion={1}
        onUpdate={mockOnUpdate}
      />
    );

    const input = screen.getByTitle('上傳圖片').nextElementSibling as HTMLInputElement;
    fireEvent.change(input, { target: { files: [mockFile] } });

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledWith(expect.objectContaining({
        layers: expect.arrayContaining([
          expect.objectContaining({
            type: 'media',
            width: 400, // Max width cap
            height: 300, // Maintained 800:600 ratio (400:300)
          })
        ])
      }));
    });
  });
});
