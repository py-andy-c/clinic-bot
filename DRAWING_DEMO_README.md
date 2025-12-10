# Drawing Demo - Testing Instructions

## Overview

A demo page showcasing react-konva drawing capabilities for medical records. This demonstrates what the editing experience would look like in the final implementation.

## Access the Demo

### Local Development

1. **Start the frontend dev server:**
   ```bash
   cd frontend
   npm run dev
   ```

2. **Access the demo page:**
   - On your computer: `http://localhost:5173/demo/drawing`
   - On iPad (same network): `http://[YOUR_IP]:5173/demo/drawing`
     - Find your IP: `ifconfig | grep "inet "` (Mac) or `ipconfig` (Windows)
     - Example: `http://192.168.1.100:5173/demo/drawing`

### Network Access

The Vite dev server is configured to listen on `0.0.0.0`, which means it's accessible from other devices on your local network.

**To find your computer's IP address:**
- Mac/Linux: Run `ifconfig | grep "inet "` in terminal
- Windows: Run `ipconfig` in command prompt
- Look for the IP address under your active network adapter (usually starts with 192.168.x.x or 10.0.x.x)

## Features Demonstrated

### Drawing Tools
- ✏️ **Pen**: Freehand drawing with touch/stylus support
- ⭕ **Circle**: Draw circles by clicking and dragging
- ▭ **Rectangle**: Draw rectangles by clicking and dragging
- ➡️ **Arrow**: Draw arrows from start to end point
- 📝 **Text**: Add text annotations (click to place, then type)
- 🧹 **Eraser**: Erase by drawing over content

### Controls
- **Color Picker**: Choose from preset colors or custom color
- **Brush Size**: Adjustable from 1-20px
- **Undo/Redo**: History management
- **Upload Image**: Upload background images (x-rays, body diagrams, etc.) to draw on
- **Clear**: Clear entire canvas
- **Export**: Save drawing as PNG image

### Touch Support
- Full touch/stylus support for iPad
- Works with Apple Pencil
- Responsive to touch gestures

## Testing on iPad

1. Make sure your iPad is on the same Wi-Fi network as your development machine
2. Find your computer's IP address (see above)
3. Open Safari on iPad and navigate to: `http://[YOUR_IP]:5173/demo/drawing`
4. Test drawing with:
   - Finger touch
   - Apple Pencil (if available)
   - Different tools and colors
   - Image upload and annotation

## What to Test

1. **Basic Drawing**: Try freehand drawing with pen tool
2. **Shapes**: Test circle, rectangle, and arrow tools
3. **Text**: Add text annotations
4. **Image Annotation**: Upload an image and draw on it
5. **Touch Experience**: Evaluate how it feels compared to Notability
6. **Performance**: Check for lag or responsiveness issues
7. **Export**: Test exporting drawings as images

## Known Limitations

- **No pressure sensitivity**: Web browsers don't support pressure sensitivity, so all strokes have uniform width
- **Touch precision**: May not be as precise as native iPad apps
- **Performance**: Large drawings with many elements may have some lag
- **Text input**: Currently requires keyboard input (could be improved with on-screen keyboard)

## Next Steps

Based on your testing feedback, we can:
1. Adjust brush sizes and tool behaviors
2. Add more drawing tools (highlighter, different line styles)
3. Improve mobile/touch experience
4. Add PDF template support
5. Integrate with medical record forms

## Questions to Consider

1. Is the drawing experience acceptable for medical record use?
2. How does it compare to Notability in terms of usability?
3. What features are missing that you need?
4. Is the touch/stylus responsiveness good enough?
5. Would you prefer typing over drawing for text?
