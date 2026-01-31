# Design Doc: Canvas & Image Optimization

## 1. Research Findings

Based on an analysis of industry leaders in canvas-based applications (Figma, Miro, Canva) and modern web performance standards, the following best practices were identified:

### 1.1 Industry Standards
- **Dual-Resolution Strategy**: Loading low-res thumbnails for initial display and lazy-loading high-res assets as they enter the viewport.
- **Layer-Based Rendering**: Decoupling static layers (backgrounds, images) from dynamic layers (pen strokes, active selections) to minimize redraw overhead.
- **WebAssembly/Web Workers**: Moving CPU-intensive tasks like image decoding and compression off the main thread to prevent UI stutter.

### 1.2 Compression Performance
- **Format Selection**: WebP and AVIF provide significantly better compression-to-quality ratios than traditional JPEG/PNG.
- **Adaptive Downsampling**: Capping image dimensions (e.g., 2000px max) to maintain clinical detail while reducing file size by 70-90%.
- **Perceptual Compression**: Utilizing algorithms that discard imperceptible data while maintaining edge sharpness, which is critical for medical imaging.

---

## 2. Options Considered

### Option A: Lightweight (Standard JPEG)
- **Strategy**: Simple canvas-based resizing to JPEG on the main thread.
- **Pros**: Zero dependencies, easy to implement.
- **Cons**: Can freeze the UI during compression; lower compression efficiency.

### Option B: Balanced (Web Worker + WebP) - **RECOMMENDED**
- **Strategy**: Use `browser-image-compression` to handle multi-threaded compression to WebP. Implement layer caching in the canvas renderer.
- **Pros**: Fluid UI during upload; excellent compression; high rendering performance.
- **Cons**: Requires one new frontend dependency.

### Option C: Professional (Dual-Stream + AVIF)
- **Strategy**: Immediate local thumbnail display with background AVIF upload and server-side tiling.
- **Pros**: Highest quality and lowest storage; instant user feedback.
- **Cons**: High complexity; requires significant backend and frontend changes.

---

## 3. Recommendation: Option B

We will implement **Option B** to provide a professional, high-performance experience with manageable complexity.

### 3.1 Implementation Plan
1. **Frontend Compression**: 
   - Integrate `browser-image-compression`.
   - Compress images to WebP (max 2000px, 80% quality) in a Web Worker before upload.
2. **Canvas Layer Caching**:
   - Refactor `ClinicalWorkspace.tsx` to only re-render the background canvas when media layers change.
   - Decouple pen stroke rendering from image rendering loops.
3. **Quality Assurance**:
   - Maintain aspect ratios during both upload and user resizing.
   - Ensure High-DPI (Retina) support is preserved.

---

## 4. Performance Goals
- **Upload Speed**: Reduce payload size by ~80% for typical mobile photos.
- **UI Responsiveness**: Maintain 60fps during drawing even with multiple images on the canvas.
- **Storage Efficiency**: Significant reduction in S3/Local storage costs over time.
