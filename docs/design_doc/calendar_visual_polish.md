# Design Doc: Calendar Visual Polish & Modernization

## Status
- **Author**: Antigravity
- **Last Updated**: 2026-01-25
- **Status**: Proposed

## 1. Problem Statement
While the layout logic for overlapping events has been fixed, the visual design of the event cards themselves remains basic.
- **Current State**: Solid, bright blue blocks with uniform white text. Functional but generic.
- **Goal**: Elevate the aesthetic to match modern standards (Google Calendar, Apple Calendar), improving readability and visual hierarchy.

## 2. Analysis of Inspiration

### 2.1 Google Calendar
- **Aesthetic**: Material Design, clean, flat.
- **Key Features**:
    - Pastel/Muted background colors with darker text (easier on eyes than saturated solids).
    - Rounded corners (~4-6px).
    - **Typography**: Time range often precedes title or is on a separate line. Bold title.
    - **Short Events**: Changes layout to horizontal (`Time - Title`) when height is restricted.

### 2.2 Apple Calendar (macOS/iOS)
- **Aesthetic**: Premium, "Glassy" (especially in dark mode), high contrast.
- **Key Features**:
    - **Left Indicator**: A strong, colored vertical bar ("pill") on the left edge to denote calendar/category.
    - **Background**: Semi-transparent or neutral background allows the indicator to pop.
    - **Typography**: White crisp text. Strong hierarchy between Title (Bold) and Details (Regular/Light).
    - **Shadows**: Subtle drop shadows for depth.

## 3. Proposed Options

### Option A: The "Modern Clean" (Google-Inspired)
Refine the current solid blocks but use a better color system and typography.
- **Style**: Solid background colors (derived from practitioner color).
- **Typography**:
    - Time: Smaller, slightly transparent (opacity 0.9).
    - Title: Bold, larger.
- **Layout**: Standard vertical stack.

### Option B: The "Premium Glassy" (Apple-Inspired) - **Recommended**
Adopts the "Left Indicator" pattern with a semi-transparent or lighter background. This aligns with the "Rich Aesthetics" and "Glassmorphism" goals.
- **Style**:
    - **Left Border/Bar**: 3-4px wide, solid color (Practitioner Color).
    - **Background**: A lighter/desaturated version of the practitioner color (or white/dark grey with slight tint).
    - **Shadow**: Subtle shadow to lift events off the grid.
- **Typography**:
    - Clear distinction between Time (secondary) and Title (primary).
- **Pros**: Looks very professional ("Clinic" feel), easier to scan multiple practitioners because the color doesn't overwhelm the text.

### Option C: Hybrid Smart Layout
Focuses on "Short Event" handling regardless of style.
- **Logic**: If event duration < 30 mins:
    - Switch to `flex-row` (Horizontal layout).
    - Format: `[Time] · [Title]`.
    - Hide secondary details.

## 4. Detailed Recommendation
Combine **Option B (Visuals)** with **Option C (Smart Layout)**.

### 4.1 Visual Specs
- **Border Radius**: 4px (refined from 8px, looks sharper).
- **Left Indicator**: 3px solid strip.
- **Background**: `rgba(Color, 0.15)` for light mode, or `rgba(Color, 0.3)` for dark/glassy mode.
- **Text Color**: Dark grey (`#1f2937`) for readability on light backgrounds, or keep White if using dark backgrounds.

### 4.2 Typography Hierarchy
- **Time**: `font-size: 11px`, `font-weight: 500`, `opacity: 0.8`.
- **Title**: `font-size: 12px`, `font-weight: 700`.

### 4.3 Short Event Handling
- **If height < 40px** (approx 30 mins):
    - Layout: `flex-row items-center gap-1`
    - Content: `Dot Indicator` + `Title` (Time shown on hover or shortened).
- **If height < 25px** (15 mins):
    - Hide Time, show Title only.

## 5. Implementation Plan
1.  **Modify `CalendarEventComponent`**:
    - Update styling to use the "Left Indicator" pattern.
    - Use `hexToRgba` utility (need to create if missing) to generate background tints from practitioner colors.
2.  **Update `CalendarGrid.module.css`**:
    - Refine shadows and transitions.
3.  **Refine "Narrow" Logic**:
    - Ensure the new style works well with the recently implemented columnar expansion.
