# PDF Receipt Generation - Research & Options

## Requirements Summary

1. **Chinese text support**: Proper Traditional Chinese character rendering
2. **Complete text display**: Never truncate - handle long text/lists with wrapping, size adjustment, or multi-page overflow
3. **A4 page size**: Standard A4 format, adapt layout to use more of the A4 width (not narrow thermal receipt format)
4. **Voided receipt watermark**: Overlay watermark on entire page
5. **Template flexibility**: Standardized template with options (stamp visibility for now, may add more in future)
6. **Immutability (CRITICAL)**: Receipts MUST be immutable. PDF generation must use ONLY the `receipt_data` JSONB field to ensure reproducibility even if dependencies change (patient name, clinic info, service item names, stamp settings, etc.). For future image/logo support, store image version/URL in JSONB and maintain all versions when clinics update. Only receipt CONTENT needs to be immutable - styling changes (font size, line width, etc.) are acceptable when re-generating.
7. **LIFF display requirement**: Patients need to view receipts in LIFF (LINE Front-end Framework). Need to support both HTML page display and PDF download. Consistency between HTML display and PDF download is important.
8. **Clinic preview requirement (FUTURE)**: Clinic users need to preview receipts in HTML when changing settings in clinic settings page. Preview must match the actual PDF receipt. Consistency between HTML preview and PDF is critical.

## Current State

- ✅ **IMPLEMENTED**: Using WeasyPrint with HTML/CSS templates
- ✅ **IMPLEMENTED**: Chinese text rendering with NotoSansTC font (subsetted, 290KB)
- ✅ **IMPLEMENTED**: Proper text wrapping and multi-page handling via CSS
- ✅ **IMPLEMENTED**: Template matches reference design with A4 layout
- ✅ **IMPLEMENTED**: Receipt PDF download endpoint (`/api/receipts/{receipt_id}/download`)
- ✅ **IMPLEMENTED**: LIFF HTML display endpoint (`/api/receipts/{receipt_id}/html`)
- ✅ **IMPLEMENTED**: Page-break protection (stamps/images don't split)
- ✅ **IMPLEMENTED**: Voided receipt watermark overlay
- ✅ **IMPLEMENTED**: Stamp visibility toggle
- ✅ **IMPLEMENTED**: PDF metadata (title, author, subject, creation date)
- ⚠️ **FUTURE**: Clinic preview feature (HTML preview in settings page)
- ⚠️ **FUTURE**: Image support (logos, stamps from cloud storage)

## Deployment Context

- **Current platform**: Railway (container-based deployment)
- **Future migration**: Likely to similar container-based platforms (Render, Fly.io, AWS ECS, Cloud Run, etc.)
- **Architecture**: Web app backend (not serverless/edge functions)
- **Impact**: System dependencies (WeasyPrint, Playwright) are easily handled in Dockerfiles. Deployment complexity is not a major concern for container-based platforms.

---

## Option 1: ReportLab Enhanced

**Approach**: Use ReportLab's `platypus` framework with proper Chinese font embedding.

**Pros:**
- ✅ Full programmatic control over layout and positioning
- ✅ Excellent multi-page support with automatic pagination
- ✅ Built-in watermark support via canvas overlays
- ✅ Good performance (pure Python, no external processes)
- ✅ Easy image embedding (logos, stamps) via `Image` flowable
- ✅ Mature, stable library with active maintenance
- ✅ Supports CID fonts and TTF font embedding for Chinese

**Cons:**
- ❌ Requires manual layout calculations (but `platypus` helps)
- ❌ Need to embed Chinese fonts (TTF files)
- ❌ Template changes require code updates (not HTML-based)
- ❌ More verbose code for complex layouts

**Chinese Font Support:**
- Use `reportlab.pdfbase.ttfonts.TTFont` to embed fonts
- Options: Noto Sans TC, Microsoft JhengHei, or other Traditional Chinese fonts
- Fonts can be bundled with application or loaded from system

**Text Overflow Handling:**
- `Paragraph` flowable with automatic word wrapping
- `Table` flowable for itemized lists with automatic page breaks
- `repeatRows` parameter for repeating table headers across pages
- `KeepTogether` to prevent section breaks
- Custom flowables for dynamic content sections

**Implementation Notes:**
- Use `SimpleDocTemplate` with A4 page size
- Custom `PageTemplate` for watermark on voided receipts
- Template structure in code with configuration flags for customization
- Font registration at application startup

**Deployment:** Simple - pure Python, no system dependencies

---

## Option 2: WeasyPrint (HTML/CSS to PDF)

**Approach**: Convert HTML/CSS templates to PDF using WeasyPrint.

**Pros:**
- ✅ HTML/PDF consistency: Same template for display, preview, and PDF download
- ✅ CSS handles text wrapping, overflow, and multi-page automatically
- ✅ Easy template maintenance (edit HTML/CSS files)
- ✅ Good Chinese font support via CSS `@font-face`
- ✅ Natural handling of long content with CSS `page-break` properties
- ✅ Watermarks via CSS (background-image with opacity or `::before` pseudo-element)
- ✅ Jinja2 templates for dynamic content injection

**Cons:**
- ❌ Requires system dependencies (Cairo, Pango, GDK-PixBuf)
- ❌ Less precise control compared to ReportLab
- ❌ Performance slower than ReportLab (renders HTML like a browser)
- ❌ Some CSS features may not be fully supported
- ⚠️ Deployment complexity: Requires system packages in Dockerfile (not an issue for Railway/container-based platforms)

**Chinese Font Support:**
- Use CSS `@font-face` declarations
- Fonts must be available as files (TTF/OTF)
- WeasyPrint uses Pango for text rendering (good Unicode support)

**Text Overflow Handling:**
- CSS `overflow-wrap`, `word-break` for text wrapping
- CSS `page-break-inside: avoid` for section integrity
- Automatic pagination handled by WeasyPrint

**Implementation Notes:**
- Use Jinja2 templates to inject receipt data into HTML
- CSS `@page` rules for A4 sizing
- Watermark via CSS `::before` or background-image
- Template files separate from code logic

**Deployment:** Requires system packages:
- **Docker/Railway**: Add to Dockerfile (standard practice, not a blocker)
  ```dockerfile
  RUN apt-get update && apt-get install -y \
      python3-cffi python3-brotli libpango-1.0-0 libpangoft2-1.0-0
  ```
- **Local dev (macOS)**: `brew install cairo pango gdk-pixbuf`
- **Local dev (Linux)**: `apt-get install python3-cffi python3-brotli libpango-1.0-0 libpangoft2-1.0-0`
- **Serverless platforms**: May be challenging (requires system dependencies)
- **Note**: For Railway and similar container-based platforms (Render, Fly.io, AWS ECS, Cloud Run), system dependencies are easily handled in Dockerfile. Only problematic for serverless platforms (Lambda, Cloud Functions).

---

## Option 3: Playwright (Browser-based PDF)

**Approach**: Use Playwright to render HTML in headless browser and generate PDF.

**Pros:**
- ✅ Perfect HTML/CSS rendering (uses real browser engine)
- ✅ Excellent Chinese font support (uses system fonts or web fonts)
- ✅ CSS handles all text wrapping and pagination automatically
- ✅ Easy template maintenance (HTML/CSS files)
- ✅ Supports all modern CSS features
- ✅ Watermarks via CSS (same as WeasyPrint)
- ✅ Can use web fonts (Google Fonts, etc.) without bundling

**Cons:**
- ❌ Requires browser runtime (Chromium) - larger Docker images
- ❌ Slower performance (spawns browser process)
- ❌ More resource-intensive (memory, CPU)
- ❌ Additional dependency (`playwright` package + browser)
- ❌ More complex deployment (browser binaries)

**Chinese Font Support:**
- Uses system fonts or web fonts
- Can load fonts from CDN (Google Fonts) or local files
- Excellent rendering quality

**Text Overflow Handling:**
- Browser engine handles all text flow automatically
- CSS `@page` for pagination
- Most reliable text wrapping (uses real browser)

**Implementation Notes:**
- Use Jinja2 templates for HTML generation
- `playwright.async_api` for async PDF generation
- CSS `@page` rules for A4 sizing
- Watermark via CSS

**Deployment:** 
- Requires `playwright` package
- Must install browser: `playwright install chromium`
- Docker images ~300MB+ larger
- **Railway/Container platforms**: Works fine (browser can be installed in Dockerfile)
- **Serverless**: Not suitable (requires browser runtime)
- May need additional system dependencies

---

## Option 4: xhtml2pdf (pisa) - Not Recommended

**Approach**: HTML/CSS to PDF using xhtml2pdf.

**Pros:**
- ✅ Pure Python, no system dependencies
- ✅ HTML/CSS template approach

**Cons:**
- ❌ Less maintained, limited development activity
- ❌ Weaker CSS support compared to WeasyPrint
- ❌ Chinese font support may be problematic
- ❌ Known issues with complex layouts
- ❌ Limited documentation

**Verdict:** Not recommended due to maintenance concerns and limited features.

---

## Option 5: pdfkit/wkhtmltopdf - Not Recommended

**Approach**: HTML to PDF using wkhtmltopdf wrapper (pdfkit).

**Pros:**
- ✅ HTML/CSS template approach
- ✅ Simple API

**Cons:**
- ❌ **Unmaintained**: wkhtmltopdf project is largely abandoned
- ❌ Limited modern CSS support
- ❌ Chinese font support issues
- ❌ Requires external binary installation
- ❌ Known rendering inconsistencies
- ❌ No active development

**Verdict:** Not recommended due to maintenance concerns and abandonment.

---

## Comparison Matrix

| Feature | ReportLab | WeasyPrint | Playwright |
|---------|-----------|------------|------------|
| **Chinese Text** | ✅ (with font embedding) | ✅ (with font files) | ✅ (excellent) |
| **Text Overflow** | ✅ (manual handling) | ✅ (automatic) | ✅ (automatic) |
| **A4 Support** | ✅ | ✅ | ✅ |
| **Watermark** | ✅ (canvas overlay) | ✅ (CSS) | ✅ (CSS) |
| **Template Flexibility** | ❌ (code-based) | ✅ (HTML/CSS) | ✅ (HTML/CSS) |
| **HTML/PDF Consistency** | ❌ (separate implementations) | ✅ (single template) | ✅ (single template) |
| **Performance** | ⭐⭐⭐⭐⭐ (<100ms) | ⭐⭐⭐ (200-500ms) | ⭐⭐ (500-1000ms) |
| **Deployment Complexity** | ⭐ (simple) | ⭐⭐ (system deps in Dockerfile - fine for Railway) | ⭐⭐⭐ (browser in Dockerfile - fine for Railway) |
| **Maintenance** | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **Image Support** | ✅ (easy) | ✅ | ✅ |
| **Multi-page** | ✅ (excellent) | ✅ | ✅ |

---

## Recommendation

### Primary Recommendation: **WeasyPrint (Option 2)** - STRONGLY RECOMMENDED

**Rationale Based on Latest Requirements:**

1. **HTML/PDF consistency requirements (NEW, CRITICAL)**: 
   - **LIFF display**: Patients need to view receipts in LIFF (HTML) and download PDF
   - **Clinic preview (FUTURE)**: Clinic users preview receipts in HTML when changing settings
   - **Perfect consistency**: Same HTML/CSS template used for HTML display, preview, and PDF generation
   - **Single source of truth**: One template ensures HTML display, preview, and PDF download are identical
   - **Simpler architecture**: Render HTML for display/preview, convert same HTML to PDF for download
   - **PDF download in LIFF**: PDF downloads work in LIFF (standard browser download behavior)
   - **Recommended approach**: Show HTML page initially, generate PDF on download click (better UX, faster initial load)
   - **Preview accuracy**: Clinic preview matches actual PDF exactly (same template)

2. **Reliable rendering (PRIMARY GOAL)**: CSS handles text wrapping automatically - browser-like rendering is very reliable for ensuring all text displays without truncation. The browser rendering engine (Pango) is battle-tested and handles edge cases automatically (long words, mixed languages, etc.). Less code means fewer bugs.

3. **Immutability requirement**: Both handle this equally well (read from JSONB only). Template-based approach (Jinja2 + HTML) makes it very clear that data comes from JSONB - template variables are explicitly from `receipt_data`.

4. **Simpler implementation for reliable text rendering**: 
   - WeasyPrint: Write HTML/CSS template → inject JSONB data → CSS handles all text flow automatically
   - ReportLab: Write flowables, manually measure text, implement wrapping logic, handle edge cases, etc.
   - For the primary goal (reliable rendering), automatic CSS handling is less error-prone than manual implementation

5. **Abundant documentation**: HTML/CSS has extensive online resources, perfect for AI coding agents.

6. **Performance**: 200-500ms is well within <2s requirement. The performance difference (<100ms vs 200-500ms) is negligible for your use case. HTML display is instant (no PDF generation needed).

7. **Deployment**: System dependencies are easily handled in Dockerfile for Railway (not a blocker).

8. **Image support**: Standard HTML `<img>` tags work. For cloud storage images, just use URLs from JSONB.

9. **Watermark**: CSS can handle voided receipt watermark (see implementation notes for verification requirements and fallback approaches).

**Key Implementation Strategy:**
- Create HTML/CSS template (A4 width, proper styling, mobile-responsive for LIFF)
- Use Jinja2 to inject `receipt_data` JSONB into template (with auto-escaping enabled)
- **HTML display**: Render template directly for LIFF viewing (fast, no PDF generation)
- **Clinic preview**: Render same template with preview data (matches actual PDF)
- **PDF download**: Convert same template to PDF using WeasyPrint on download click
- CSS handles all text wrapping, pagination automatically
- Conditional rendering for stamp visibility based on `receipt_data.stamp.enabled`
- Watermark via CSS for voided receipts (appears on all pages) - verify implementation early
- Font embedding via CSS `@font-face` (Noto Sans TC, subsetted)
- Error handling: Validate receipt_data structure, handle missing fonts/images gracefully

**⚠️ CRITICAL: Early Proof-of-Concept Required**
Before full implementation, create a minimal proof-of-concept that tests:
- WeasyPrint's Chinese font rendering with Noto Sans TC
- Watermark appears on all pages of multi-page receipts (test all approaches)
- Text wrapping with very long Chinese text
- Table header repetition across pages (CSS `thead`)
- Same HTML template renders identically in browser (for LIFF) and WeasyPrint (for PDF)
- Test in actual LINE LIFF environment for PDF download behavior

**WeasyPrint CSS Feature Verification:**
While WeasyPrint has good CSS support, it doesn't support ALL CSS features that a real browser does. Verify these features work:
- ✅ Text wrapping (`overflow-wrap`, `word-break`) - should work
- ✅ Page breaks (`page-break-*`) - should work
- ⚠️ Pseudo-elements (`::before`, `::after`) - verify watermark approach
- ⚠️ Transforms (`transform`, `rotate`) - verify watermark rotation
- ⚠️ Flexbox/Grid - not needed for simple receipt layout, but verify if used
- ✅ Table headers (`thead`) - verify repetition across pages
- ✅ Font embedding (`@font-face`) - should work

**Recommendation**: Test critical CSS features early. If a feature doesn't work, have a fallback approach ready.

### Strong Alternative: **ReportLab Enhanced (Option 1)**

**Consider ReportLab if:**
- You prefer programmatic control and want to ensure every aspect of rendering
- You want the absolute fastest performance (<100ms)
- You want pure Python deployment (no system dependencies)

**Trade-offs for LIFF requirement:**
- **Consistency challenge**: Need to maintain TWO separate implementations:
  - HTML template for LIFF display
  - ReportLab code for PDF generation
  - Must ensure they match (more maintenance, higher risk of inconsistency)
- **More complex architecture**: Two code paths to maintain
- More code to write and maintain
- Need to manually handle text wrapping and edge cases (more room for bugs)
- More complex implementation for reliable text rendering
- Full control means full responsibility for edge cases

**LIFF considerations with ReportLab:**
- Would need separate HTML template for display anyway
- PDF download works in LIFF, but consistency between HTML and PDF is harder to maintain
- More development and maintenance overhead

### Not Recommended: **Playwright (Option 3)**

**Why:** Overkill for this use case. Browser overhead not justified when WeasyPrint provides similar HTML/CSS benefits with better performance.

---

## Implementation Notes

### WeasyPrint Implementation (Recommended)

**Font Embedding:**
```css
@font-face {
  font-family: 'NotoSansTC';
  src: url('/fonts/NotoSansTC-Regular.ttf') format('truetype');
}

body {
  font-family: 'NotoSansTC', 'Microsoft JhengHei', Arial, sans-serif;
}
```

**Template Structure:**
- Jinja2 template with `receipt_data` JSONB injected
- HTML structure matching receipt layout
- CSS for styling, text wrapping, pagination
- Conditional rendering: `{% if receipt_data.stamp.enabled %}`
- **Security**: Enable Jinja2 auto-escaping by default to prevent XSS
```python
from jinja2 import Environment, FileSystemLoader

env = Environment(
    loader=FileSystemLoader('templates'),
    autoescape=True  # Enable auto-escaping
)
```

**Multi-page Handling:**
- CSS `@page` rules for A4 sizing and margins
- CSS `page-break-inside: avoid` for section integrity
- CSS `page-break-after: auto` for automatic pagination
- ⚠️ **VERIFICATION REQUIRED**: Table headers with CSS `thead` - test with 100+ items to verify headers repeat correctly across pages. If `thead` doesn't work in WeasyPrint, may need to manually repeat headers in template logic.

**Page Break Issues & Solutions:**

During implementation and testing, we discovered a critical issue with absolutely positioned elements (like stamps) splitting across pages. This section documents the issue, testing scenarios, and the solution.

**Problem: Stamp Splitting Across Pages**

When a receipt has enough content to push the stamp near a page boundary, the stamp (which uses `position: absolute` inside a `position: relative` container) can be split across two pages, with part of the stamp on page 1 and part on page 2.

**Root Cause:**
- The `.stamp-container` uses `position: relative`
- The `.stamp` element uses `position: absolute` inside that container
- When the container spans a page boundary, WeasyPrint can split the container, causing the absolutely positioned stamp to be split across pages
- Without page-break protection, WeasyPrint treats the container as a normal block element that can be broken

**Testing Scenarios:**

We conducted extensive testing to reproduce and fix the issue:

1. **Initial Discovery**: Found stamp splitting in `test_receipt.pdf` with 2 items + logo + 120px stamp
2. **Reproduction Attempts**: 
   - Tried various item counts (1 item, 30 items, 88 items)
   - Tried different stamp sizes (120px, 300px, 500px, 600px, 960px)
   - Tried with/without logo
   - Tried interleaving items and images
3. **Key Finding**: The split only occurred when:
   - Using exact same data as `test_receipt.pdf` (2 items, logo, 120px stamp)
   - No wrapper div around stamp container
   - No page-break protection
4. **Why Larger Stamps Didn't Split**: When stamp was too large (600px+), WeasyPrint moved the entire stamp to page 2 instead of attempting to split it
5. **Why Smaller Content Didn't Split**: With less content (1 item, no logo), the stamp fit entirely on page 1, so no split occurred

**The Solution:**

The fix requires two components:

1. **Wrapper Div in Normal Flow**: Wrap the stamp container in a normal-flow div (not absolutely positioned)
2. **Page-Break Protection**: Apply `page-break-inside: avoid` to the wrapper

**HTML Structure:**
```html
<div class="stamp-wrapper">
    <div class="stamp-container">
        <div class="stamp">
            <!-- stamp content -->
        </div>
    </div>
</div>
```

**CSS:**
```css
/* Essential: Wrapper div with page-break protection */
.stamp-wrapper {
    page-break-inside: avoid;
    break-inside: avoid;
}

/* Additional protection on container (recommended) */
.stamp-container {
    position: relative;
    margin: 30px 0;
    min-height: 100px;
    page-break-inside: avoid;
    break-inside: avoid;
    page-break-before: avoid;
    break-before: avoid;
    page-break-after: avoid;
    break-after: avoid;
}

.stamp {
    position: absolute;
    right: 0;
    width: 120px;
    height: 120px;
    /* Protection on stamp element (optional but recommended) */
    page-break-inside: avoid;
    break-inside: avoid;
}
```

**Why This Works:**

1. **Normal Flow Element**: The wrapper div is in normal document flow (not absolutely positioned), which WeasyPrint handles reliably for page breaks
2. **Container Protection**: `page-break-inside: avoid` on the wrapper prevents the wrapper from being split
3. **Cascading Protection**: When the wrapper is protected, the container and stamp inside move together as a unit
4. **Defense in Depth**: Additional protection on container and stamp provides extra safety

**Essential vs. Optional:**

- **Essential**: Wrapper div + `page-break-inside: avoid` on wrapper
- **Optional but Recommended**: Additional protection on container and stamp element

**Application to Other Elements:**

This same approach should be applied to prevent other critical elements from splitting:
- Images (logo, stamp images)
- Payment summary sections
- Clinic info sections
- Any other elements that should not be split across pages

**Example for Images:**
```css
.image-wrapper {
    page-break-inside: avoid;
    break-inside: avoid;
}

img {
    page-break-inside: avoid;
    break-inside: avoid;
    max-width: 100%;
    max-height: 250mm;  /* Ensure fits on A4 page */
    height: auto;
}
```

**Note**: Images in normal flow are less likely to split than absolutely positioned elements, but applying the same protection ensures reliability.

**Text Overflow Strategy:**
- CSS `overflow-wrap: break-word` for long words
- CSS `word-break: break-word` for Chinese text
- CSS handles all text flow automatically
- No manual measurement needed

**Watermark Implementation:**

⚠️ **VERIFICATION REQUIRED**: Test watermark implementation early in proof-of-concept. WeasyPrint's CSS support may have limitations with `::before` pseudo-elements.

**Primary Approach (CSS `::before`):**
```css
.voided-watermark::before {
  content: "已作廢";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-45deg);
  font-size: 120px;
  color: rgba(255, 0, 0, 0.2);
  z-index: 1000;
}
```

**Fallback Approach 1 (CSS `@page` with background):**
```css
@page {
  @top-center {
    content: "已作廢";
    color: rgba(255, 0, 0, 0.2);
    font-size: 120px;
    transform: rotate(-45deg);
  }
}
```

**Fallback Approach 2 (Fixed-position overlay div):**
```html
<div class="voided-watermark-overlay">
  <div class="watermark-text">已作廢</div>
</div>
```
```css
.voided-watermark-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1000;
}
.watermark-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-45deg);
  font-size: 120px;
  color: rgba(255, 0, 0, 0.2);
}
```

**Multi-page Watermark**: Ensure watermark appears on ALL pages. Test with 3+ page receipts. Use `@page` rules or fixed positioning that spans all pages.

**PDF Generation:**
```python
from weasyprint import HTML
from jinja2 import Template

# Render template with JSONB data
template = Template(html_template_string)
html_content = template.render(receipt_data=receipt_data)

# Generate PDF
pdf_bytes = HTML(string=html_content).write_pdf()
```

### ReportLab Implementation (Alternative)

**Font Embedding:**
```python
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics

# Register Chinese font at startup
pdfmetrics.registerFont(TTFont('ChineseFont', 'path/to/chinese-font.ttf'))
```

**Multi-page Handling:**
- Use `SimpleDocTemplate` with automatic page breaks
- Custom `PageTemplate` for watermark on voided receipts
- Use `Table` with `repeatRows` for repeating headers across pages
- Use `Paragraph` for automatic text wrapping

**Text Overflow Strategy:**
- Measure text width before rendering
- Auto-reduce font size if content too long
- Use `KeepTogether` for critical sections
- Automatic page breaks for long item lists

---

## Implementation Considerations

### Font Management

**Option A: Bundle Fonts (Recommended)**
- Bundle font files (Noto Sans TC, Microsoft JhengHei) with application
- Ensures consistency across all deployment environments
- Noto Sans TC is open source (SIL Open Font License) - verify license allows commercial use
- Fonts stored in application directory (e.g., `backend/fonts/`)
- **Font Subsetting**: Noto Sans TC is large (~15MB+). Use font subsetting tools (e.g., `pyftsubset` from fonttools) to include only Traditional Chinese characters, reducing file size significantly while maintaining all needed characters.
- **Version Pinning**: Track font file versions/hashes to ensure consistency

**Option B: Use System Fonts**
- Use fonts available in deployment environment
- May vary across systems (Windows vs Linux vs macOS)
- Less reliable for consistent rendering

**Recommendation:** Bundle subsetted fonts for consistency and reliability.

**Font Fallback Strategy:**
1. Primary: Noto Sans TC (bundled, subsetted)
2. Fallback 1: Microsoft JhengHei (if available on system)
3. Fallback 2: Arial Unicode MS or system sans-serif
4. Log warnings when fallbacks are used

### Template Organization

**Recommended Structure:**
```
backend/
  ├── templates/
  │   └── receipts/
  │       ├── receipt.html (Jinja2 template)
  │       └── receipt.css (or embedded in HTML)
  └── fonts/
      └── NotoSansTC-Regular.ttf (subsetted)
```

**Template Structure:**
- Separate HTML and CSS files for easier maintenance
- Jinja2 template with `receipt_data` JSONB injected
- Document template variable structure (what fields are available from `receipt_data`)
- Consider template inheritance if multiple receipt types are needed in future

### Template Customization

- **Current**: Only stamp visibility toggle (`show_stamp` from `receipt_data.stamp.enabled`)
- **Future**: May add more customization options (field visibility, etc.)
- **WeasyPrint approach**: Conditional rendering in Jinja2 template:
  ```jinja2
  {% if receipt_data.stamp.enabled %}
    <div class="stamp-container">...</div>
  {% endif %}
  ```
- **Future images**: HTML `<img>` tags with URLs from JSONB (cloud storage)
- Template structure: HTML/CSS with conditional rendering based on JSONB config

### Immutability Requirements

**CRITICAL**: Receipts must be immutable and reproducible.

- **Data Source**: PDF generation MUST use ONLY `receipt_data` JSONB field
- **No External Dependencies**: Do not query related tables (clinic, patient, service_items, etc.) - all data must come from JSONB snapshot
- **Reproducibility**: Receipt should be reproducible at any time, even if:
  - Patient name changes
  - Clinic info changes
  - Service item names change
  - Stamp settings change
  - Related records are deleted
- **Future Images**: When supporting logo/stamp images:
  - Store image version/URL in `receipt_data` JSONB at receipt creation time
  - Maintain all image versions when clinics update logos/stamps
  - Reference images from JSONB snapshot (not current clinic settings)
- **Styling Changes**: Only receipt CONTENT must be immutable. Styling changes (font size, line width, layout adjustments) are acceptable when re-generating PDFs.

### Testing Strategy

**Text Rendering:**
- Test with very long clinic names, patient names, item lists
- Test with maximum text in all fields
- Test with various Chinese character combinations
- Test edge cases: empty fields, single character names, very long item descriptions
- Test special characters (emojis, symbols, punctuation)
- Test mixed languages (Chinese + English)

**Layout & Pagination:**
- Test A4 page boundaries and multi-page scenarios
- Test table pagination (headers should repeat on each page - automatic with CSS `thead`)
- Test very long item lists spanning many pages
- Test multi-page with watermark (watermark should appear on all pages)
- **CRITICAL**: Test stamp positioning near page boundaries (2 items + logo + stamp should trigger split without fix)
- Test that page-break protection prevents stamp/image splitting
- Test with various content lengths to ensure elements don't split

**Features:**
- Test voided receipt watermark (visibility, positioning, opacity, all pages)
- Test stamp visibility toggle (enabled/disabled)
- Test font rendering with different Chinese fonts
- Test image embedding (logos, stamps) when implemented
- Test with missing/null values in receipt_data
- Test with malformed receipt_data (error handling)

**Data Integrity:**
- Test immutability: Generate PDF, change source data, regenerate PDF (should be identical)
- Test with deleted related records (should still generate from JSONB)
- Test date/time formatting consistency
- Test currency formatting

**Performance:**
- Test PDF generation time (<2s requirement)
- Test concurrent PDF generation requests
- Test with very large receipt_data JSONB

**Error Handling:**
- Test with missing font files (should fallback to system fonts, log warning)
- Test with unavailable image URLs (cloud storage) - should show placeholder or skip gracefully
- Test with invalid receipt_data structure (should return clear error message)
- Test PDF generation failure scenarios (should log error, return appropriate HTTP status)
- Test timeout handling for slow image URLs
- Test retry logic for transient failures (image loading)

**Visual Regression Testing:**
- Generate PDFs for test cases and store as reference
- Compare generated PDFs against reference PDFs in CI/CD
- Test with real-world edge cases (very long names, special characters, etc.)
- Automated testing of PDF structure (text extraction, page count verification)

---

## Answers to Key Questions

1. **Font licensing**: Bundle open-source fonts (Noto Sans TC) with app for consistency across environments. Noto Sans TC uses SIL Open Font License - allows free redistribution.

2. **Template update frequency**: Won't change template often. **Primary goal: reliable rendering** (long text, line wrapping, etc. must be reliable). Image support also needed.

3. **Performance requirements**: Less than 2 seconds is acceptable. Faster is good to have but not required. (All options meet this: ReportLab <100ms, WeasyPrint 200-500ms, Playwright 500-1000ms)

4. **Deployment environment**: Railway (container-based) - system dependencies are not a blocker. Only matters if migrating to serverless platforms.

5. **Team expertise**: Primarily use AI coding agents. As long as there are abundant references online, either approach is fine.

6. **Layout format**: Adapt layout to use more of A4 width (not narrow thermal receipt format).

7. **Image storage**: Cloud storage for future logo/stamp uploads.

8. **Customization options**: Only stamp visibility for now. May add more in the future.

9. **Error handling**: Standard error handling (use judgment - log errors, return appropriate HTTP responses).

10. **Data access**: PDF generator should access `receipt_data` JSONB directly (use judgment on helper functions for data extraction/formatting).

11. **LIFF display requirement**: 
    - Patients need to view receipts in LIFF (LINE Front-end Framework)
    - Need to support both HTML page display and PDF download
    - Consistency between HTML display and PDF download is important
    - Question: Show HTML page initially and generate PDF on download click, or generate PDF initially?
    - Question: Will PDF download work in LIFF?
    - Answer: Show HTML initially, generate PDF on download click (better UX). PDF downloads work in LIFF.

12. **Clinic preview requirement (FUTURE)**: 
    - Clinic users need to preview receipts in HTML when changing settings in clinic settings page
    - Preview must match the actual PDF receipt exactly
    - Consistency between HTML preview and PDF is critical
    - This further strengthens the need for single-template approach (WeasyPrint)

---

## Re-Evaluation Summary

**Key Requirements:**
1. **Primary goal: Reliable rendering** (long text, line wrapping must be reliable)
2. **HTML/PDF consistency requirements (NEW, CRITICAL)**: 
   - LIFF display: HTML page + PDF download
   - Clinic preview (FUTURE): HTML preview when changing settings
   - Consistency between HTML and PDF is critical
3. **Immutability**: Must use ONLY `receipt_data` JSONB
4. **Performance**: <2s acceptable (both meet this)
5. **Layout**: Adapt to A4 width (not narrow thermal format)
6. **Image support**: Needed for future logo/stamp uploads
7. **Abundant documentation**: For AI coding agents

**Why WeasyPrint is STRONGLY Better for This Use Case:**

1. **HTML/PDF consistency requirements (CRITICAL)**: 
   - **LIFF display**: Patients view HTML in LIFF, download PDF
   - **Clinic preview (FUTURE)**: Clinic users preview HTML when changing settings
   - **Perfect consistency**: Same HTML/CSS template for display, preview, and PDF = guaranteed consistency
   - **Single source of truth**: One template ensures HTML display, preview, and PDF download are identical
   - **Simpler architecture**: One template, multiple outputs (HTML for display/preview, PDF for download)
   - **Better UX**: Show HTML initially (instant), generate PDF on download click
   - **Preview accuracy**: Clinic preview matches actual PDF exactly (same template)
   - **PDF download works in LIFF**: Standard browser download behavior

2. **Reliable rendering (PRIMARY GOAL)**: CSS automatic text wrapping is more reliable than manual programmatic handling. Browser-like rendering (Pango engine) handles edge cases automatically (long words, mixed languages, Chinese text, etc.). Less code = fewer bugs.

3. **Simpler implementation**: Template-based approach (HTML/CSS + Jinja2) is simpler than programmatic layout. CSS handles text flow automatically, reducing implementation complexity.

4. **Immutability clarity**: Template variables come from JSONB - makes it very clear you're only using immutable data. Template structure enforces data source.

5. **Performance difference negligible**: <100ms vs 200-500ms doesn't matter when <2s is acceptable. HTML display is instant (no PDF generation needed).

6. **Deployment**: System dependencies easily handled in Dockerfile for Railway (not a blocker).

7. **Abundant documentation**: HTML/CSS has extensive online resources, perfect for AI coding agents.

**ReportLab Trade-offs for HTML/PDF consistency:**
- Would need separate HTML template for display/preview + ReportLab code for PDF
- Must maintain consistency between multiple implementations (more maintenance, higher risk)
- More complex architecture with multiple code paths
- Clinic preview might not match PDF exactly (different implementations)

**Conclusion**: **WeasyPrint is STRONGLY the better choice** because:
1. The HTML/PDF consistency requirements (LIFF display + clinic preview + PDF download) strongly favor WeasyPrint's single-template approach
2. One template ensures perfect consistency across all use cases (display, preview, download)
3. It better aligns with the primary goal (reliable rendering)
4. Automatic CSS text wrapping is more reliable than manual programmatic handling
5. Simpler implementation with guaranteed consistency between HTML and PDF

---

## Edge Cases & Considerations

### Data Validation
- **Malformed receipt_data**: Validate JSONB structure before PDF generation, return clear error messages
- **Missing required fields**: Handle gracefully (show placeholder or skip section)
- **Null/empty values**: Define default behavior (empty string, "N/A", or skip field)
- **Invalid data types**: Validate and convert types (e.g., dates, numbers)
- **Template validation**: Validate template syntax and structure in tests

### Image Handling

**Image Loading from Cloud Storage:**
- **CORS requirements**: Ensure cloud storage URLs are accessible from backend server (CORS configured)
- **Authentication**: Use signed URLs or ensure images are publicly accessible
- **Image optimization**: Resize/compress images before storing in cloud storage (not during PDF generation)
- **Image caching**: Consider downloading images once and caching locally to avoid repeated network calls
- **Supported formats**: Specify supported formats (PNG, JPG) and max dimensions
- **Timeout handling**: Define timeout for image fetching (e.g., 5 seconds), handle gracefully on timeout

**Error Handling for Images:**
- **404/timeout**: Show placeholder image or skip image section gracefully
- **CORS errors**: Log error, show placeholder or skip
- **Large images**: Optimize before embedding to avoid PDF bloat (max dimensions, compression)
- **Missing image URLs in JSONB**: Handle gracefully when image URL is missing (skip or placeholder)
- **Retry strategy**: Retry transient failures (network issues) with exponential backoff, max 3 retries

**Image Placeholder Strategy:**
- Option 1: Show empty space (skip image)
- Option 2: Show "Image unavailable" text
- Option 3: Show placeholder image (gray box with icon)
- **Recommendation**: Skip image section gracefully (cleanest approach)

### Font & Rendering
- **Missing font files**: Fallback to system fonts, log warning
- **Font loading errors**: Graceful degradation to available fonts
- **Very long text**: CSS handles automatically, but test edge cases (10,000+ character fields)
- **Special characters**: Ensure proper encoding (UTF-8) for emojis, symbols

### Performance & Scalability

**Performance Monitoring:**
- **Metrics to track**: PDF generation time, success rate, file size, concurrent requests
- **Alerting thresholds**: Alert if generation time >2s, failure rate >10%
- **Performance regression detection**: Track metrics over time, alert on degradation
- **Scaling considerations**: PDF generation is CPU-intensive
  - Consider async PDF generation for non-critical paths (queue-based)
  - Monitor resource usage (CPU, memory)
  - Consider rate limiting if needed (per user/clinic)
  - Set up alerts if generation time exceeds threshold

**Very Large Receipts:**
- Test with 100+ items, very long text fields
- Monitor performance degradation
- Consider async generation for very large receipts if needed

**PDF File Size:**
- Monitor size, optimize if needed (image compression, font subsetting)
- Track file sizes over time
- Alert if file size exceeds reasonable threshold (e.g., 5MB)

**Caching Strategy:**

**Recommendation: Don't cache PDFs** - Receipts are immutable and PDF generation is fast enough (200-500ms). Regenerating ensures consistency and simplicity.

**If caching is needed:**
- **Cache key**: Hash of entire `receipt_data` JSONB (ensures immutability)
- **Cache invalidation**: Only invalidate if `receipt_data` changes (which shouldn't happen due to immutability) or template version changes
- **Cache TTL**: Could be very long or indefinite since receipts are immutable
- **Cache storage**: Consider cloud storage (S3, etc.) for cached PDFs if volume is high
- **HTML caching**: Consider caching HTML rendering for LIFF display (faster response, can use standard HTTP caching)

### Multi-page Scenarios
- **Watermark on all pages**: Ensure voided receipt watermark appears on every page
- **Table headers**: Verify headers repeat on each page (automatic with CSS `thead`)
- **Page breaks**: Test section integrity (don't break in middle of critical sections)
- **Page numbering**: Consider adding page numbers for multi-page receipts
- **Stamp splitting**: Ensure stamp never splits across pages (use wrapper div + page-break protection)
- **Image splitting**: Ensure images never split across pages (apply page-break protection)
- **Section integrity**: Test that payment summary, clinic info, and other critical sections don't split

### Error Handling

**PDF Generation Failures:**
- Log errors with sufficient context for debugging
- Return appropriate HTTP status (500 for server errors, 400 for invalid data)
- Don't expose internal errors to users (return user-friendly error messages in Chinese)
- Consider fallback to simplified PDF if full generation fails (optional)

**Template Rendering Errors:**
- Validate Jinja2 template syntax in tests
- Handle missing variables gracefully (show empty or default value)
- Enable Jinja2 auto-escaping to prevent XSS
- Validate template structure before rendering

**Resource Failures:**
- **Missing fonts**: Fallback to system fonts, log warning
- **Missing WeasyPrint system libraries**: Return clear error message, check dependencies at startup
- **Memory issues**: Monitor memory usage for very large receipts, consider async generation for very large receipts

**Retry Strategy:**
- **Transient failures**: Retry image loading with exponential backoff (max 3 retries)
- **PDF generation**: Don't retry (likely not transient), return error immediately
- **Timeout handling**: Define timeouts for image fetching (5s), PDF generation (10s)

### Immutability Edge Cases
- **Receipt regenerated after data changes**: Should produce identical PDF (test this)
- **Deleted related records**: PDF should still generate from JSONB snapshot
- **Image versioning**: When clinic updates logo, old receipts should still use old image URL from JSONB
- **Timezone handling**: Ensure dates in PDF match original receipt_data (no timezone conversion)

### LIFF & Mobile Considerations
- **Mobile responsiveness**: HTML template should be readable on mobile LIFF
- **PDF download on mobile**: Test download behavior in LINE app
- **Print vs screen**: Consider print-specific CSS for better PDF output
- **Touch interactions**: Ensure download button is easily tappable

---

## Open Questions - Answered

1. **PDF metadata**: ✅ **Answer**: Include basic metadata:
   - Title: "Receipt {receipt_number}" or "收據 {receipt_number}"
   - Author: Clinic display name from `receipt_data`
   - Subject: Receipt number
   - Creation date: Receipt issue date from `receipt_data`

2. **PDF accessibility**: ✅ **Answer**: Add semantic HTML structure for better screen reader support:
   - Proper headings (`<h1>`, `<h2>`, etc.)
   - Alt text for images (when implemented)
   - Proper document structure
   - Consider PDF/A compliance if needed for archival purposes

3. **Caching strategy**: ✅ **Answer**: Don't cache PDFs (see Performance & Scalability section). Consider caching HTML rendering for LIFF display.

4. **Rate limiting**: ✅ **Answer**: Monitor first, implement if needed. Consider rate limiting per user/clinic if abuse is detected.

5. **PDF file size limits**: ✅ **Answer**: Monitor file sizes, alert if exceeds reasonable threshold (e.g., 5MB). Optimize with font subsetting and image compression.

6. **Print optimization**: ✅ **Answer**: Use print-specific CSS (`@media print`) for better print output. Consider print margins and color profiles.

7. **Error recovery**: ✅ **Answer**: Don't retry PDF generation (not transient). Retry image loading (transient failures) with exponential backoff, max 3 retries.

8. **Monitoring**: ✅ **Answer**: Track PDF generation time, success rate, file size, concurrent requests. Set up alerts for thresholds (see Performance Monitoring section).

9. **File naming**: ✅ **Answer**: Standardize PDF filename format: `receipt_{receipt_id}_{receipt_number}.pdf` or `receipt_{receipt_number}.pdf`

---

## Implementation Phases

**Phase 1: Foundation (Proof-of-Concept)**
- Set up WeasyPrint with system dependencies
- Create basic HTML/CSS template (A4 width)
- Test Chinese font rendering (Noto Sans TC, subsetted)
- Test text wrapping with long Chinese text
- Verify watermark implementation (test all approaches)
- Verify table header repetition across pages
- Test HTML rendering in browser vs WeasyPrint PDF (consistency check)

**Phase 2: Core Features**
- ✅ Implement full receipt template with all fields
- ✅ Add stamp visibility toggle
- ✅ Implement voided receipt watermark (multi-page)
- ✅ Add proper error handling (fonts, images, malformed data)
- ✅ Implement PDF metadata (title, author, subject, creation date)
- ✅ Test with real receipt_data JSONB

**Phase 3: Multi-page & Edge Cases**
- Test and fix multi-page scenarios
- Handle very long item lists
- Test edge cases (empty fields, special characters, mixed languages)
- Implement proper error messages (Chinese)
- Add performance monitoring

**Phase 4: Integration & Optimization**
- ✅ Integrate with LIFF display (HTML rendering)
- ⚠️ Integrate with clinic preview feature - **FUTURE** (marked as future requirement)
- ⚠️ Add image support (logos, stamps from cloud storage) - **FUTURE**
- ✅ Optimize font subsetting (font already subsetted to 290KB)
- ⚠️ Add caching for HTML rendering (if needed) - **NOT NEEDED** (design doc recommends no caching)
- ⚠️ Performance optimization and monitoring - **BASIC** (error handling in place, monitoring can be added later)

---

## Dependencies

### Python Packages
```txt
weasyprint>=60.0  # Pin exact version for consistency
jinja2>=3.1.0     # Pin exact version for template rendering consistency
fonttools>=4.0.0  # For font subsetting (pyftsubset)
```

### System Dependencies (Dockerfile)
```dockerfile
RUN apt-get update && apt-get install -y \
    python3-cffi \
    python3-brotli \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    && rm -rf /var/lib/apt/lists/*
```

### Font Files
- Noto Sans TC (Traditional Chinese) - subsetted using `pyftsubset`
- Store in `backend/fonts/` directory
- Track font file version/hash for consistency

### Version Pinning
- Pin all dependencies to specific versions in `requirements.txt`
- Pin WeasyPrint version to ensure consistent rendering
- Pin Jinja2 version for template rendering consistency
- Track font file hashes/versions

---

## Testing & Validation Summary

### Proof-of-Concept Testing

**Initial Setup:**
- Created proof-of-concept scripts to test critical WeasyPrint features
- Verified Chinese font rendering with Noto Sans TC
- Tested text wrapping with long Chinese text
- Verified watermark display on all pages
- Confirmed table header repetition across pages
- Validated Jinja2 template rendering with receipt data

**HTML/PDF Consistency Testing:**
- Created test script to generate both HTML and PDF from the same template
- Verified visual consistency between HTML display and PDF output
- Confirmed that same template works for both LIFF display and PDF download
- Tested with real receipt data structure matching `receipt_data` JSONB

### Page Break Issue Discovery & Resolution

**Issue Discovery:**
- Discovered stamp splitting across pages during testing
- Stamp (absolutely positioned) was being cut in half when container spanned page boundary
- Issue occurred with specific content configuration (2 items + logo + 120px stamp)

**Testing Scenarios:**
1. **Initial Reproduction Attempts:**
   - Tried various item counts (1, 30, 88 items) - didn't trigger split
   - Tried different stamp sizes (120px, 300px, 500px, 600px, 960px)
   - Tried with/without logo
   - Tried interleaving items and images across multiple pages

2. **Key Findings:**
   - **Too little content**: With 1 item and no logo, stamp fit entirely on page 1 (no split)
   - **Too large stamp**: With 600px+ stamp, WeasyPrint moved entire stamp to page 2 (no split)
   - **Exact match needed**: Only exact same configuration as `test_receipt.pdf` triggered split (2 items + logo + 120px stamp)
   - **Wrapper div effect**: Initially, wrapper div prevented split even without explicit protection (layout side effect)

3. **Root Cause Analysis:**
   - Absolutely positioned elements (`position: absolute`) inside relative containers can split when container spans page boundary
   - WeasyPrint treats the container as a normal block element that can be broken
   - Without page-break protection, container splitting causes absolutely positioned child to split

**Solution Development:**
1. **Initial Attempt**: Added `page-break-inside: avoid` to `.stamp-container` - didn't work alone
2. **Second Attempt**: Added comprehensive page-break properties to container - still didn't work
3. **Final Solution**: Added wrapper div in normal flow + `page-break-inside: avoid` on wrapper - **WORKED**

**Why Wrapper Div is Essential:**
- Wrapper div is in normal document flow (not absolutely positioned)
- WeasyPrint handles page breaks on normal-flow elements more reliably
- `page-break-inside: avoid` on wrapper prevents wrapper from splitting
- When wrapper is protected, container and stamp inside move together as a unit

**Final Solution:**
- **Essential**: Wrapper div + `page-break-inside: avoid` on wrapper
- **Recommended**: Additional protection on container and stamp element for defense in depth
- **Application**: Same approach applies to images and other critical elements

### Jinja2 Template Rendering Issue

**Issue Discovery:**
- During testing, HTML tags were visible in the generated PDF (e.g., `<tr>`, `<td>`, `<div>`)
- Tags appeared as literal text in the PDF output
- Issue occurred when using pre-rendered HTML strings in Jinja2 templates

**Root Cause:**
- Template was using pre-rendered HTML strings (e.g., `items_html = "<tr>...</tr>"`)
- HTML string was inserted into template using `{{ items_html }}`
- With `autoescape=True` in Jinja2 environment, all HTML tags were escaped
- Escaped HTML (`&lt;tr&gt;`, `&lt;td&gt;`, etc.) was rendered as literal text in PDF

**Solution:**
1. **Use Data Objects, Not Pre-rendered HTML**: Instead of generating HTML strings, create data structures:
   ```python
   items_data = []
   for i in range(count):
       items_data.append({
           "item_type": "service_item",
           "service_item": {"receipt_name": "項目 1"},
           "amount": 100.00
       })
   ```

2. **Use Jinja2 Loops in Template**: Render HTML using Jinja2 template syntax:
   ```jinja2
   {% for item in receipt_data['items'] %}
   <tr>
       <td>{{ item.service_item.receipt_name }}</td>
       <td>${{ "%.0f"|format(item.amount) }}</td>
   </tr>
   {% endfor %}
   ```

3. **Keep autoescape=True**: Maintain security by keeping auto-escaping enabled
   - Jinja2 will automatically escape user data (preventing XSS)
   - Template syntax (`{% %}`) is not escaped, only data (`{{ }}`)

**Key Learnings:**
- Never inject pre-rendered HTML strings into Jinja2 templates when `autoescape=True`
- Always use data structures and let Jinja2 render the HTML
- Template syntax is safe from escaping, only data values are escaped
- This approach is more secure and maintainable

### Key Learnings

1. **Absolutely Positioned Elements**: Require special handling for page breaks - wrapper div in normal flow is essential
2. **Normal Flow Elements**: Images in normal flow are less likely to split, but should still have protection
3. **Testing Approach**: Need exact reproduction of issue conditions to test fixes effectively
4. **WeasyPrint Behavior**: Larger elements may be moved entirely to next page rather than split (different behavior than smaller elements)
5. **Defense in Depth**: Multiple layers of page-break protection provide better reliability
6. **Jinja2 Template Rendering**: Always use data structures with Jinja2 loops, never inject pre-rendered HTML strings when `autoescape=True`

### Implementation Checklist

When implementing the receipt template, ensure:

- [x] All absolutely positioned elements (stamps) are wrapped in normal-flow divs
- [x] Wrapper divs have `page-break-inside: avoid` protection
- [x] Containers have `page-break-inside: avoid` protection
- [x] Images have `page-break-inside: avoid` protection
- [x] Critical sections (payment summary, clinic info) have page-break protection
- [x] Test with content that pushes elements to page boundaries
- [x] Verify no elements split across pages in generated PDFs
- [x] Use data structures (not pre-rendered HTML) with Jinja2 templates
- [x] Keep `autoescape=True` in Jinja2 environment for security
- [x] Use Jinja2 template syntax (`{% for %}`) to render HTML, not string interpolation
- [x] Verify no HTML tags appear as text in generated PDFs

### Implementation Status Summary

**Completed (Phase 1-2 Core - ALL ITEMS):**
- ✅ WeasyPrint setup and dependencies
- ✅ Receipt HTML template with all fields
- ✅ Chinese font rendering (NotoSansTC subsetted, 290KB)
- ✅ Text wrapping and multi-page support
- ✅ Voided receipt watermark
- ✅ Stamp visibility toggle
- ✅ Page-break protection (stamps/images don't split)
- ✅ PDF download endpoint (`/api/receipts/{receipt_id}/download`)
- ✅ LIFF HTML display endpoint (`/api/receipts/{receipt_id}/html`)
- ✅ Error handling
- ✅ PDF metadata (title, author, subject, creation date) - Implemented via WeasyPrint's `write_pdf()` metadata parameter
- ✅ Tests (PDF generation, HTML generation, voided receipts)

**Future (Phase 4):**
- ⚠️ Clinic preview feature - Marked as future requirement in design doc
- ⚠️ Image support (logos, stamps from cloud storage) - Marked as future requirement

