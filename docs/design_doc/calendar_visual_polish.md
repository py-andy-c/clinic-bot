# Design Doc: Calendar Visual Polish & Modernization (v2 - Refined)

## 1. Context
Previous attempts to switch completely to an "Apple-style" light/transparent design felt underwhelming or didn't offer enough visual improvement over the existing solid blocks. The user has specifically requested an alternative proposal, focusing on improvements that can be learned from popular apps, while keeping "Name Visibility" as the #1 priority.

## 2. Updated Analysis

### 2.1 The "Google Calendar" approach (Solid Pastels)
Instead of the "Glassy/Transparent" look (which can look washed out if not perfect), Google uses **solid pastel colors** with dark text.
- **Why it works**: High contrast, readable text, clear blocking.
- **Relevance**: Our current implementation is "Saturated Blue + White Text". A "Pastel + Dark Text" approach might look cleaner and more professional without losing the "solidness" of the event.

### 2.2 The "Apple Calendar" Approach (Revisited)
Apple uses a solid color, but with very subtle gradients and high-quality typography.
- **Key Detail**: The padding is minimal, and the text is very crisp.

## 3. Alternative Proposal: "High-Density Professional"

Instead of changing the *style* (glass vs solid) drastically, we should focus on **Density and Typography** to maximize name visibility.

### Key Changes Proposed:
1.  **Reduce Padding**:
    - Current: ~4px or dynamic.
    - Proposed: **1px - 2px** standard padding.Maximize the content area.
2.  **Typography**:
    - **Bold User Name**: Make the patient name the dominant visual element.
    - **Remove "No Title"**: If no title exists, fallback gracefully.
3.  **Color Palette Refinement (Solid but Muted)**:
    - Instead of pure saturated colors (e.g. Blue `#3b82f6`), use slightly desaturated versions solid backgrounds. 
    - **However**, since we just reverted the Apple style, let's stick to the current solid style but **optimize the layout**.

### 4. Special Logic: "Super Dense" Layout
For very short overlapping events (< 30 mins):
- **remove** the gap between items.
- **remove** border radius (make them look like a continuous block if consecutive, or just smaller radius like 2px).
- **remove** shadows to save pixel space.

## 5. Implementation Strategy (Google Style Hybrid)

We will aim for a **Google Calendar Modern** look:
- **Rounded Corners**: 4px.
- **Background**: Solid color (current), maybe slightly lower saturation if possible, but keep white text if contrast allows.
- **Content**:
    - **Top Left**: Name (Bold).
    - **No Time**: (As requested).
    - **Font Size**: Increase slightly if space permits, or keep compact.

### Comparison
| Feature | Current | Proposal (Google Hybrid) |
| :--- | :--- | :--- |
| **Background** | Solid Saturated | Solid Saturated (Unchanged or slightly refined) |
| **Padding** | ~4px | **2px** (More space for text) |
| **Corner Radius** | 8px | **4px** (Sharper, more professional) |
| **Shadow** | None/Small | **Subtle Drop Shadow** (Depth) |
| **Text** | Normal | **Bold Name**, No Time |

This minimizes the "drastic" visual change while strictly optimizing for the user's #1 goal: **See the Name**.
