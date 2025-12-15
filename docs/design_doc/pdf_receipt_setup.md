# PDF Receipt Generation - Railway Deployment Analysis

## Libraries Used

- **WeasyPrint** (>=60.0) - HTML/CSS to PDF conversion
- **Jinja2** (>=3.1.0) - Template engine
- **fonttools** (>=4.0.0) - Font subsetting (font already subsetted)

## System Dependencies

WeasyPrint requires these system libraries (must be installed at OS level, not via pip):
- **Cairo** (`libcairo2`) - Graphics rendering engine
- **Pango** (`libpango-1.0-0`) - Text layout and rendering (handles Chinese/Unicode)
- **GDK-PixBuf** (`libgdk-pixbuf2.0-0`) - Image loading library
- **libffi-dev** - Python bindings support (often required)

**Note**: Railway uses Debian-based containers, so Debian/Ubuntu package names must be used (e.g., `libcairo2` not `cairo`).

## Chinese Font Loading

**Font File**: `backend/fonts/NotoSansTC-Regular.otf` (subsetted, ~290KB)

**Current Implementation**:
```css
@font-face {
    font-family: 'NotoSansTC';
    src: url('../fonts/NotoSansTC-Regular.otf') format('opentype');
}
```

**How it works**:
1. `PDFService` sets `base_url` to `backend/` directory
2. WeasyPrint resolves CSS URLs relative to `base_url` (not template location)
3. Current path `../fonts/` from `base_url=backend/` resolves to parent directory (WRONG)
4. Should be `fonts/` relative to `base_url` → `backend/fonts/NotoSansTC-Regular.otf`

## Railway Deployment Analysis

### Current Configuration

`backend/railway.toml` uses `nixpacksPlan`:
```toml
[build.nixpacksPlan.phases.setup]
nixPkgs = ["python312", "cairo", "pango", "gdk-pixbuf"]
```

### Issues & Risks

#### ⚠️ Issue 1: System Dependencies May Not Install

**Problem**: Railway's Railpack may not reliably respect `nixpacksPlan` for system packages. Multiple Railway users report WeasyPrint failures due to missing Cairo/Pango libraries.

**Evidence**: Railway Help Station discussions show inconsistent behavior with `nixpacksPlan`. Some users succeed, others require environment variables.

**Impact**: WeasyPrint will fail to import or generate PDFs if system libraries are missing.

**Solution**: Add environment variable in Railway dashboard:
```
RAILPACK_DEPLOY_APT_PACKAGES=libcairo2 libpango-1.0-0 libgdk-pixbuf2.0-0 libffi-dev
```

**Why this works**: Railway's Railpack explicitly installs Debian/Ubuntu packages via this environment variable, which is more reliable than `nixpacksPlan` based on community reports.

**Alternative** (less common): `NIXPACKS_PKGS=cairo pango gdk-pixbuf` - may work but less reliable.

**Config Cleanup Options** (if using environment variables):
1. **Remove entire `nixpacksPlan` section** (lines 11-17):
   - Railway will auto-detect Python version from `requirements.txt` or code
   - Or use `PYTHON_VERSION` environment variable if explicit control needed
2. **Keep Python version only** in `nixpacksPlan`:
   ```toml
   [build.nixpacksPlan.phases.setup]
   nixPkgs = ["python312"]  # Only Python version, system deps via env var
   ```
3. **Remove system packages only** (keep `python312`):
   - Remove `cairo`, `pango`, `gdk-pixbuf` from `nixPkgs` array
   - Keep `python312` for explicit Python version control

**What stays in `railway.toml`**: `[build]` section with `builder = "RAILPACK"`, `[deploy]` section (startCommand, healthcheckPath, etc.), and all other configuration.

#### ⚠️ Issue 2: Font Path Resolution

**Problem**: Template uses `url('../fonts/NotoSansTC-Regular.otf')` which resolves incorrectly:
- `base_url` = `backend/`
- CSS URL = `../fonts/` → resolves to `clinic-bot/fonts/` (parent of backend) ❌
- Actual font location = `backend/fonts/NotoSansTC-Regular.otf` ✅

**Impact**: Font may not load in production, causing Chinese characters to render as boxes or fallback to system fonts.

**Solution**: Change template to:
```css
src: url('fonts/NotoSansTC-Regular.otf') format('opentype');
```

This resolves correctly: `backend/fonts/NotoSansTC-Regular.otf` relative to `base_url`.

## Railway Deployment Verification

### ✅ Will System Dependencies Be Available?

**Answer**: **Uncertain** - depends on Railway's Railpack behavior.

**Current config** (`nixpacksPlan`): May or may not work (inconsistent reports).

**Recommended**: Add `RAILPACK_DEPLOY_APT_PACKAGES` environment variable for reliability. Railway uses Debian-based containers, so Debian package names work.

**Action**: Deploy with current config, test immediately. If failures occur, add environment variable and redeploy.

### ✅ Will Fonts Load Correctly?

**Answer**: **No** - font path needs fix.

**Current path**: `../fonts/` resolves incorrectly relative to `base_url`.

**After fix**: `fonts/` will resolve correctly to `backend/fonts/NotoSansTC-Regular.otf`.

**Font file**: Already bundled in repository, will be deployed.

## Recommendations

### Before Deployment

1. **Fix font path** in `backend/templates/receipts/receipt.html`:
   - Change `url('../fonts/...')` to `url('fonts/...')`

2. **Choose system dependencies approach**:
   - **Option A (Recommended)**: Use environment variable `RAILPACK_DEPLOY_APT_PACKAGES=libcairo2 libpango-1.0-0 libgdk-pixbuf2.0-0 libffi-dev`
     - Can remove `[build.nixpacksPlan]` section from `railway.toml` (lines 11-17)
     - More reliable based on Railway user reports
   - **Option B**: Keep `nixpacksPlan` in `railway.toml` and test
     - If it works, no changes needed
     - If it fails, switch to Option A

### After Deployment

**Immediate testing** (within 5 minutes):

1. **Test PDF generation** with Chinese text via API endpoint (`/api/receipts/{receipt_id}/download`)
2. **Check Railway logs** for common error patterns:
   - `ImportError: cannot import name 'cairo'`
   - `OSError: no library called "cairo" was found`
   - `ModuleNotFoundError` related to WeasyPrint dependencies
   - Font loading errors (if WeasyPrint logs them)
3. **Verify Chinese rendering**: 
   - Characters should render correctly using NotoSansTC font
   - Should NOT show as boxes, missing characters, or fallback fonts
   - Font should be embedded in PDF (works offline)
4. **If system dependencies fail**: 
   - Add `RAILPACK_DEPLOY_APT_PACKAGES` environment variable
   - Optionally clean up `railway.toml` (remove system packages from `nixpacksPlan` or remove entire section)
   - Redeploy and verify

## Expected Behavior

### If System Dependencies Work
- WeasyPrint imports successfully at startup
- PDF generation completes without errors
- Chinese characters render using NotoSansTC font (embedded in PDF)

### If System Dependencies Fail
- WeasyPrint import fails with `ImportError` or `OSError`
- PDF generation endpoint returns 500 error
- Railway logs show missing library errors
- **Fix**: Add `RAILPACK_DEPLOY_APT_PACKAGES` environment variable and redeploy

### If Font Path Fails
- PDF generates but Chinese characters show as boxes or missing
- Font loading errors in logs (if WeasyPrint logs them)
- Fallback to system fonts (may not support Chinese)
- **Fix**: Update template font path from `../fonts/` to `fonts/`

## Confidence Assessment

- **System dependencies**: **Medium** - `nixpacksPlan` may work, but environment variable is more reliable based on community reports
- **Font loading**: **High** (after path fix) - Font file is bundled, path fix ensures correct resolution
- **Overall production readiness**: **Medium-High** - Fix font path required, prepare environment variable fallback

## Key Files

- Service: `backend/src/services/pdf_service.py`
- Template: `backend/templates/receipts/receipt.html` (needs font path fix)
- Font: `backend/fonts/NotoSansTC-Regular.otf`
- Config: `backend/railway.toml` (can remove `nixpacksPlan` section if using env vars)
- Dependencies: `backend/requirements.txt`

## Comprehensive Verification Checklist

### Before Deployment
- [ ] **Fix font path** in `backend/templates/receipts/receipt.html` (line 30):
  - Change `url('../fonts/NotoSansTC-Regular.otf')` to `url('fonts/NotoSansTC-Regular.otf')`
- [ ] **Verify font file exists**: `backend/fonts/NotoSansTC-Regular.otf` (subsetted, ~290KB)
- [ ] **Prepare environment variable**: `RAILPACK_DEPLOY_APT_PACKAGES=libcairo2 libpango-1.0-0 libgdk-pixbuf2.0-0 libffi-dev`
- [ ] **Decide on config approach**: Use env vars (cleaner) or keep `nixpacksPlan` (test first)

### After Deployment (Immediate Testing - within 5 minutes)
- [ ] **Test PDF generation** with Chinese text (clinic name, patient name, service items)
- [ ] **Verify Chinese characters render correctly** (not boxes, not missing, using NotoSansTC)
- [ ] **Check Railway logs** for:
  - WeasyPrint import errors
  - Missing library errors (`cairo`, `pango`, `gdk-pixbuf`)
  - Font loading errors
- [ ] **Verify system dependencies**: No import errors for WeasyPrint
- [ ] **Test multi-page receipts** (if applicable)
- [ ] **Test voided receipt watermark** (if applicable)
- [ ] **If errors occur**: Add environment variable, optionally clean up `railway.toml`, redeploy

## Config Cleanup (If Using Environment Variables)

If switching to `RAILPACK_DEPLOY_APT_PACKAGES` environment variable, choose one cleanup approach:

**Option 1: Remove entire `nixpacksPlan` section** (lines 11-17):
```toml
# Remove these lines:
# Specify Python version and system dependencies via nixpacksPlan (Railpack respects this)
# This replaces runtime.txt for Python version specification
# WeasyPrint requires Cairo, Pango, and GDK-PixBuf system libraries
[build.nixpacksPlan]
[build.nixpacksPlan.phases]
[build.nixpacksPlan.phases.setup]
nixPkgs = ["python312", "cairo", "pango", "gdk-pixbuf"]
```
- Railway will auto-detect Python version from `requirements.txt` or code
- Or use `PYTHON_VERSION` environment variable if explicit control needed

**Option 2: Keep Python version only**:
```toml
[build.nixpacksPlan.phases.setup]
nixPkgs = ["python312"]  # Only Python version, system deps via env var
```

**Option 3: Keep current config** and use env vars as fallback (no cleanup needed)

**What always stays in `railway.toml`**:
- `[build]` section with `builder = "RAILPACK"`
- `[deploy]` section (startCommand, healthcheckPath, healthcheckTimeout, restartPolicyType)
- All other configuration

