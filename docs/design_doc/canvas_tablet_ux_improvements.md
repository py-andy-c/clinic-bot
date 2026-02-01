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
| Input Type | Action (One Finger) | Action (Two Fingers) | Action (3+ Fingers) |
| :--- | :--- | :--- | :--- |
| **Finger (Touch)** | Active Tool (Draw/Erase/Select) | **Pan & Pinch-to-Zoom** | Ignored / Cancel Action |
| **Apple Pencil (Stylus)** | **Always Active Tool** | N/A (Treated as single point) | N/A |
| **Palm** | Ignored (Palm Rejection) | Ignored | Ignored |

## 3. Proposed UX: The "Pro-Note" Hybrid

### 3.1 Interaction Model
We will implement a hybrid model that prioritizes drawing while allowing seamless navigation:

1.  **Inside Canvas Boundaries**:
    - **One Finger**: Executes the currently selected tool (Pen, Highlighter, Eraser, etc.).
    - **Two Fingers**: 
        - **Panning**: Moves the "paper" (scrolls the page/container).
        - **Pinching**: Zooms the canvas in/out (centered at midpoint).
    - **Apple Pencil**: Always draws, even if the user's palm is touching the screen.
2.  **Outside Canvas Boundaries**:
    - Standard browser scrolling is preserved for toolbars, headers, and margins.

### 3.2 State Transitions & Safety
To prevent accidental "stray marks" and ensure a smooth experience:
- **Gesture Lock**: Once a one-finger action (drawing) or a two-finger action (panning/zooming) starts, the mode is "locked" until all fingers are lifted.
- **Stroke Cancellation**: If a user is drawing with one finger and adds a second, the current drawing stroke is immediately cancelled and deleted.
- **Hysteresis**: A small movement threshold (e.g., 5-10 pixels) must be met before committing to a "Draw" vs. "Pan" action to avoid micro-movements triggering accidental strokes.
- **Visual Feedback**: The cursor or a subtle overlay indicator should change when entering "Panning Mode" to reassure the user.

### 3.3 Tool-Specific Behavior
- **Selection Tool**: One finger moves/transforms objects; two fingers scroll/zoom.
- **Text Tool**: One finger taps to place/edit text; two fingers scroll/zoom.
- **Pen/Eraser**: One finger draws/erases; two fingers scroll/zoom.

## 4. Proposed Technical Changes

### 4.1 CSS Configuration
Apply `touch-action: none` to the Konva `Stage` container. This is critical to prevent the mobile browser (Safari/Chrome) from intercepting touch events for native scrolling.

### 4.2 Gesture Detection (`ClinicalWorkspace.tsx`)
Modify the `onTouchStart`, `onTouchMove`, and `onTouchEnd` handlers:
- **Multi-Touch Check**: Detect `e.touches.length`.
- **Scrolling/Zooming Logic**: 
    - Use `requestAnimationFrame` to ensure smooth, high-performance updates.
    - If two touches are detected, calculate both the **delta** (for panning) and the **distance change** (for zooming).
    - Implement a simple velocity-based **inertia** for panning to give a premium feel.
- **Input Filtering**: Use `e.evt.pointerType` to identify if the input is `pen` or `touch`.

### 4.3 Palm Rejection
- **Pen Priority**: If a `pen` input is detected, temporarily ignore all `touch` inputs for ~500ms.
- **Radius Check**: If supported by the device, ignore any touch with a large `radiusX` or `radiusY` (> 20px), as these typically represent a palm or side of the hand.

## 5. Success Criteria
- Users can draw a continuous line with a finger without the page moving.
- Users can scroll through a long medical record using two fingers without switching tools.
- Apple Pencil input is smooth and unaffected by resting a hand on the screen.
