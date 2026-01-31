# Design Doc: Medical Record Canvas Text Box UX Improvements

## 1. Problem Statement

The current text box implementation in the medical record canvas (`ClinicalWorkspace.tsx`) has a suboptimal user experience compared to industry standards (e.g., Google Slides, PowerPoint, Figma).

Specific user pain points:
1.  **Persistent Placeholder**: New text boxes appear with "點擊編輯" (Click to edit). If left unedited, this text remains in the final record.
2.  **No Auto-grow**: The text box does not automatically expand or wrap lines as the user types.
3.  **Incorrect Resizing Behavior**: Resizing the text box scales the text (stretching it or changing font size) instead of reflowing the text (adjusting line wraps) while keeping font size constant.
4.  **Fixed Font Size**: Users cannot adjust the font size for new or existing text boxes.

## 2. Current Implementation Analysis (Post-Implementation Gaps)

The current implementation uses `Konva.Text` within `ClinicalWorkspace.tsx`. While core reflowing is implemented, several UX issues remain:

*   **Delayed Updates**: The canvas node only updates its content and size on `blur`. This prevents the selection box (Transformer) from growing in real-time as the user types.
*   **Infinite Horizontal Growth**: By using `width: undefined`, text boxes do not wrap automatically. They continue to grow horizontally until the user manually resizes them.
*   **Editor/Canvas Mismatch**: The `textarea` editor uses `whiteSpace: 'pre'` for auto-width boxes, which explicitly disables the line wrapping expected in slide-like tools.
*   **Height Lag**: Since the canvas doesn't update in real-time, the vertical growth is not visible until editing is finished.

## 3. Industry Standards & Best Practices

Reviewing popular applications like Google Slides, PowerPoint, and Figma reveals the following standard behaviors:

| Feature | Standard Behavior | Current Behavior |
| :--- | :--- | :--- |
| **Creation** | Click to create. Cursor appears. **No default text**. If user clicks away without typing, the box is removed. | Creates box with "點擊編輯". Persists even if not edited. |
| **Typing** | Box grows horizontally (if single line) or vertically (if wrapped). | Box has fixed size. Text might be clipped or require manual resize. |
| **Resizing** | **Reflows text**. Changing width adjusts the wrapping boundary. Font size remains **fixed**. | **Scales text**. Changing width stretches the text or increases font size. |
| **Font Size** | Controlled via toolbar/menu. Independent of box dimensions. | Coupled with box resizing. No explicit control. |

## 4. Proposed Improvements (Updated & Refined)

### 4.1. Lifecycle & Placeholder
*   **Action**: Update the text tool creation logic.
*   **Behavior**:
    1.  When "Text" tool is active and user clicks:
        *   Create a text node with empty string `""`.
        *   Immediately enter "Edit Mode" (focus the textarea).
    2.  **Empty State**: If the user finishes editing (blurs) and the text is empty, **delete the text layer** automatically.

### 4.2. Auto-Growing & Real-time Wrapping
*   **Action**: Sync the `textarea` overlay and `Konva.Text` in real-time.
*   **Identified Gaps**:
    *   Current implementation only updates canvas on `blur`, creating a disconnected experience.
    *   `undefined` width leads to infinite horizontal growth (point-text style) which is often not desired for notes.
*   **Refined Behavior**:
    1.  **Dynamic Default Width**: New text boxes should be initialized with a width of **2/3 of the canvas width** (approx. 667px for a 1000px canvas).
    2.  **Boundary Awareness**: If the text box is inserted near the right edge of the canvas, the width must automatically shrink so that it does not overflow the canvas boundary. Formula: `Math.min(defaultWidth, CANVAS_WIDTH - insertionX)`.
    3.  **Real-time Sync**: The `input` event on the `textarea` should propagate changes to the `Konva.Text` node immediately (or with minimal debounce). This ensures the canvas and its selection box grow as the user types.
    4.  **Wrapping Logic**: Use `whiteSpace: 'pre-wrap'` for the editor and `wrap: 'word'` for Konva to ensure consistent line breaking.
    5.  **Height Sync**: The height of both the editor and the canvas node should always be driven by the content (`scrollHeight`).

### 4.3. Resizing = Reflowing (Not Scaling)
*   **Action**: Change `Transformer` configuration and `onTransform` logic.
*   **Behavior**:
    *   Configure `Transformer` to **ignore scaling** for Text nodes, or handle it differently.
    *   Actually, `Konva.Text` resizing is tricky. The `Transformer` provides scale.
    *   **Implementation**:
        *   In `onTransform`, we calculate the new width based on `node.width() * node.scaleX()`.
        *   We set the `width` of the text node to this new value.
        *   **Crucially**, we reset `scaleX` and `scaleY` back to `1` immediately.
        *   We do **NOT** change `fontSize`.
        *   This forces the `Konva.Text` to re-wrap the text within the new width.
    *   **Height**: We generally don't want to restrict height for text. Text should grow vertically as needed. **We will disable the top/bottom resize handles** (using `enabledAnchors: ['middle-left', 'middle-right']`). Height is purely determined by the content.

### 4.4. Font Size Control
*   **Action**: Add a Font Size control to the toolbar.
*   **UI**:
    *   When a text node is selected, show a dropdown or input for Font Size (e.g., 12, 14, 16, 20, 24, 32).
    *   Default size: 20 (current default).
*   **Logic**: Updating this value updates the `fontSize` property of the selected layer.

## 5. Technical Implementation Plan

1.  **Refactor `SelectableText`**:
    *   Modify `handleDblClick` to support auto-sizing textarea.
    *   Update `Transformer` logic in `onTransform` / `onTransformEnd` to update `width` only, resetting scale, to achieve reflow.
    *   Ensure `Konva.Text` uses `width` for wrapping.

2.  **Update `ClinicalWorkspace`**:
    *   **Creation**: Modify `handleMouseDown` for 'text' tool.
        *   Create with empty text.
        *   Trigger editing immediately (might need a state flag or ref to trigger `handleDblClick` logic programmatically after creation).
        *   Or, simpler: Create with " " (space) and select it? No, empty is better.
        *   Implement "Delete if empty on blur" logic in the `onChange` handler of `SelectableText`.

3.  **Add Font Size Control**:
    *   Add state `selectedFontSize` (derived from `selectedId`).
    *   Add UI in the floating toolbar (only visible when text selected).

4.  **Migration/Compatibility**:
    *   Existing text nodes will have fixed widths/scales. The new logic should handle them gracefully (resetting scale to 1 and applying effective width/size).

## 6. Edge Cases
*   **Very narrow width**: Prevent resizing width below a minimum (e.g., 20px) to avoid infinite vertical growth.
*   **Pasted text**: Ensure pasting large text in the textarea expands it correctly.
*   **Mobile/Touch**: Ensure the textarea overlay works on touch devices.

