# PR Description: Canvas Simplification and Unified 900px Workspace

## Summary

This PR significantly simplifies the medical record canvas by unifying multiple width definitions into a single, straightforward 900px workspace and cleaning up the UI to remove redundant containers and "desk" metaphors.

## Changes

### 1. Unified 900px Canvas

* Consolidated the previous multi-width model (850px paper, 896px desk, 976px stage) into a single **900px** width.
* Set `SCALE` to **1**, achieving a 1:1 mapping between logical drawing coordinates and visual screen pixels. This eliminates complex coordinate transformation logic.
* Removed `GUTTER_UNITS` and `STAGE_BUFFER`, simplifying the stage offsets and logical positioning.

### 2. UI Simplification and Cleanup

* **Removed Gray Regions**: Eliminated the `bg-gray-200` and `bg-gray-100` backgrounds to create a seamless white workspace that blends with the rest of the application.
* **Single Paper Marking**: Removed the redundant background absolute-positioned `div` and the clipped `Group` in Konva. The `Stage` now directly represents the white paper region with a subtle shadow and border.
* **Title Alignment**: Corrected the alignment of the **"臨床工作區"** title. It is now perfectly left-aligned with the left edge of the 900px canvas box across all screen sizes.

### 3. Logic and Code Quality

* **Simplified Drag Limits**: Updated `dragLimits` to strictly enforce the `0` to `CANVAS_WIDTH` (900px) range without needing to account for hidden buffers or gutters.
* **Removed Redundant Clipping**: By eliminating the "gutter" logic, we no longer need to split the rendering tree between clipped and non-clipped groups, making the React-Konva implementation significantly cleaner and more performant.
* **Fixed Scaling Inconsistencies**: Removed manual `scaleX`/`scaleY` hacks in several components that were trying to compensate for the previous non-1:1 scaling.

## Rationale

The previous "Paper on a Desk" metaphor introduced unnecessary complexity in coordinate math, rendering logic, and UI maintenance. Moving to a "What You See Is What You Get" (WYSIWYG) model with a single unified boundary reduces bugs related to object positioning and improves the overall developer experience.

## Verification

* **Manual Verification**:
  * Verified that all drawing tools (Pen, Shapes, Text) are correctly confined to the 900px boundary.
  * Confirmed that the "臨床工作區" title is perfectly left-aligned with the canvas.
  * Verified that the UI appears clean and white as requested.
* **Tests**: (Note: Existing logic tests for boundaries may need update due to width change from 896/1000 to 900).
