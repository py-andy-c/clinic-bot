# PR Description: Text Box UX Improvements for Medical Records

## Overview
This PR implements significant UX improvements to the text tool in the Clinical Workspace, bringing it closer to the behavior of professional design tools like Google Slides and Figma. The focus was on real-time feedback, standardized wrapping, and reflow-based resizing.

Reference Design Doc: [text_box_ux_improvements.md](file:///Users/andy/clinic-bot/docs/design_doc/text_box_ux_improvements.md)

## Issues Addressed
1.  **Delayed Feedback**: Previously, the canvas only updated after the user finished typing and blurred the text editor.
2.  **Infinite Horizontal Growth**: New text boxes grew infinitely horizontally, making them difficult to manage for longer notes.
3.  **Scaling vs. Reflowing**: Resizing a text box scaled the font size rather than reflowing the text within a new width boundary.
4.  **Inconsistent Selection**: The selection box (Transformer) did not update its dimensions in real-time as text was added.

## Changes & Fixes

### 1. Real-time Synchronization
-   **Immediate Updates**: Connected the `input` event of the overlay `textarea` to the Konva text node. The canvas now re-renders on every keystroke.
-   **Dynamic Selection Box**: Integrated `trRef.current.forceUpdate()` into the typing flow so the selection handles expand vertically as the text grows.
-   **Style Alignment**: Set `whiteSpace: 'pre-wrap'` and `wordBreak: 'break-word'` on the editor to ensure the visual representation in the editor matches the canvas exactly.

### 2. Standardized Wrapping (Area Text)
-   **Dynamic Default Width**: New text layers now initialize with a default width of **2/3 of the canvas width** (approx. 667px).
-   **Boundary Awareness**: Implemented "Edge Shrinking" logic. If a text box is inserted near the right edge, its width is automatically reduced to fit the remaining space (`Math.min(defaultWidth, CANVAS_WIDTH - x)`), matching the behavior of Google Slides.
-   **Area Text Pattern**: Transitioned from "Point Text" (auto-width) to "Area Text" (fixed-width wrapping) as the primary behavior.

### 3. Reflow-based Resizing
-   **Width-only Transformation**: Configured the Transformer to prioritize width adjustments by disabling top/bottom handles.
-   **Scale Reset**: Implemented logic in `onTransform` to apply scale changes to the `width` property and reset `scaleX`/`scaleY` to `1`. This ensures text reflows correctly without distortion or font-size changes.

### 4. Feedback-Driven Refinements
Following a technical review, the following refinements were added:
- **Escape to Cancel**: Pressing `Escape` now correctly reverts the text to its pre-edit state, even with real-time updates enabled.
- **Resource Cleanup**: Implemented a `useEffect` cleanup to ensure the overlay `textarea` is removed from the DOM if the component unmounts during an active edit session.
- **Wrapping Parity**: Explicitly set `wrap="word"` on the `KonvaText` component to ensure 1:1 visual parity with the browser-native editor.
- **Robustness**: Improved `isAutoWidth` logic to be more defensive against null/undefined values.

### 5. Integration Tests
- Updated [ClinicalWorkspaceText.test.tsx](file:///Users/andy/clinic-bot/frontend/src/components/medical-records/__tests__/ClinicalWorkspaceText.test.tsx) to:
    - Assert the new **2/3 canvas width** default.
    - **New**: Verify that text boxes shrink when created near the right edge.
    - Verify real-time canvas updates during the `input` event.
    - Verify that `Escape` correctly reverts changes and triggers appropriate cleanup.
    - Added a verification case for the reflow-based resizing logic.

## Verification
- Verified all frontend tests pass: `RUN v4.0.17 ... 11 passed (11)`.
- Manual verification of the text tool confirms smooth real-time growth, correct wrapping behavior, and proper cancellation via Escape.
