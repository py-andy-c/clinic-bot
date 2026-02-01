# Design Doc: Canvas Tablet & Mobile UX Improvements

## 1. Problem Statement
The current medical record canvas implementation suffers from poor tablet and mobile user experience. Specifically, the system fails to distinguish between a **drawing stroke** and a **page scroll gesture**. 

### Key Issues:
- **Input Conflict**: Touching the canvas with a finger or Apple Pencil often triggers a page scroll instead of a drawing stroke.
- **Lack of Gestures**: There is no support for standard multi-touch gestures (e.g., two-finger panning), making it difficult to navigate long documents while using drawing tools.
- **Palm Interference**: Lack of robust palm rejection causes accidental strokes when the user rests their hand on the screen to write.

## 2. Research & Industry Standards

### 2.1 Popular Apps (Notability, GoodNotes, Procreate)
Modern note-taking and drawing apps follow a "Gesture-First" interaction model:
- **Input Differentiation**: They distinguish between `stylus` (Apple Pencil) and `touch` (Finger).
- **Two-Finger Navigation**: One finger is for tools (drawing, erasing); two fingers are for navigation (panning, zooming).
- **Touch-Action Hijacking**: They disable default browser/OS touch behaviors (like scrolling) within the drawing area to prevent accidental interruptions.
- **Palm Rejection**: They prioritize stylus input and ignore large-area touch inputs that resemble a palm.

### 2.2 Standard Interaction Table
| Input Type | Action (One Finger) | Action (Two Fingers) |
| :--- | :--- | :--- |
| **Finger (Touch)** | Active Tool (Draw/Erase/Select) | **Pan/Scroll Workspace** |
| **Apple Pencil (Stylus)** | **Always Active Tool** | N/A (Treated as single point) |
| **Palm** | Ignored (Palm Rejection) | Ignored |

## 3. Proposed UX: The "Pro-Note" Hybrid

### 3.1 Interaction Model
We will implement a hybrid model that prioritizes drawing while allowing seamless navigation:

1.  **Inside Canvas Boundaries**:
    - **One Finger**: Executes the currently selected tool (Pen, Highlighter, Eraser, etc.).
    - **Two Fingers**: Moves the "paper" (scrolls the page/container).
    - **Apple Pencil**: Always draws, even if the user's palm is touching the screen.
2.  **Outside Canvas Boundaries**:
    - Standard browser scrolling is preserved for toolbars, headers, and margins.

### 3.2 Tool-Specific Behavior
- **Selection Tool**: One finger moves/transforms objects; two fingers scroll.
- **Text Tool**: One finger taps to place/edit text; two fingers scroll.
- **Pen/Eraser**: One finger draws/erases; two fingers scroll.

## 4. Proposed Technical Changes

### 4.1 CSS Configuration
Apply `touch-action: none` to the Konva `Stage` container. This is critical to prevent the mobile browser (Safari/Chrome) from intercepting touch events for native scrolling.

### 4.2 Gesture Detection (`ClinicalWorkspace.tsx`)
Modify the `onTouchStart`, `onTouchMove`, and `onTouchEnd` handlers:
- **Multi-Touch Check**: Detect `e.touches.length`.
- **Scrolling Logic**: If two touches are detected, calculate the delta between frames and manually update the `window.scrollBy` or container scroll position.
- **Input Filtering**: Use `e.evt.pointerType` to identify if the input is `pen` or `touch`.

### 4.3 Palm Rejection
- Implement a "Pen Priority" window. If a `pen` input is detected, temporarily ignore all `touch` inputs for ~500ms to prevent palm strokes. (Partially implemented, needs refinement).

## 5. Success Criteria
- Users can draw a continuous line with a finger without the page moving.
- Users can scroll through a long medical record using two fingers without switching tools.
- Apple Pencil input is smooth and unaffected by resting a hand on the screen.
