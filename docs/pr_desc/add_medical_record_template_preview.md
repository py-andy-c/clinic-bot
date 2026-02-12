# Add Interactive Preview to Medical Record Template Editor

## Summary

This PR adds a tab-based preview feature to the Medical Record Template Editor modal, allowing clinic administrators to visualize and interact with their templates before saving. The preview provides a WYSIWYG (What You See Is What You Get) experience that closely matches how the form will appear to practitioners and patients.

## Problem

Previously, when creating or editing medical record templates, administrators had no way to preview how the form would look to end users. This made it difficult to:
- Verify field layout and ordering
- Test dropdown/radio/checkbox options
- Ensure field labels and descriptions are clear
- Validate the overall user experience

Administrators had to save the template and navigate to a medical record to see how it would actually appear, making the template design process inefficient and error-prone.

## Solution

Implemented a tab-based interface with two tabs:
1. **編輯模板 (Edit Template)** - The existing template editor
2. **預覽表單 (Preview Form)** - New interactive preview

### Key Features

**Interactive Preview**
- All form fields are fully functional and can be filled in
- Dropdown menus can be opened and options selected
- Radio buttons and checkboxes can be clicked
- Text, textarea, number, and date inputs accept user input
- Local state management keeps preview data separate from template editor

**Accurate Representation**
- Preview matches the actual medical record form layout
- Shows template name and description as header
- Displays all field types in the correct order
- Includes the photo upload section (with non-functional button for preview)
- Uses the same styling and components as production forms

**Seamless UX**
- Tab switching preserves all unsaved changes in the editor
- Preview updates in real-time as fields are added/edited
- Empty state guidance when no fields exist
- Clean, professional appearance on both mobile and desktop

## Changes Made

### Frontend

**Modified Files:**
- `frontend/src/components/MedicalRecordTemplateEditorModal.tsx`
  - Added tab navigation UI with two tabs
  - Added `activeTab` state to track current view
  - Created `FormPreview` component with interactive form rendering
  - Added local state management for preview form values
  - Implemented handlers for all input types (text, dropdown, radio, checkbox, etc.)
  - Added photo upload section to preview (non-functional button)
  - Optimized performance with targeted `watch()` and `useMemo`
  - Improved type safety by removing all `any` types
  - Integrated shared utility function for field processing

**New Files:**
- `frontend/src/utils/templateFieldUtils.ts`
  - Shared utility function `processFieldOptions()` for converting field options
  - Eliminates code duplication between preview and form submission
  - Single source of truth for options processing logic

- `frontend/tests/e2e/medical-record-template-preview.spec.ts`
  - Comprehensive E2E test suite with 7 test cases
  - Tests tab switching, field rendering, interactions, and state preservation
  - Ensures preview functionality works correctly across all scenarios

### Technical Details

**Performance Optimizations:**
- Targeted `watch()` usage: Only watches `name`, `description`, and `fields` instead of entire form
- `React.useMemo` for `processedFields` to prevent unnecessary recalculations
- Component only renders when preview tab is active
- Efficient state updates with minimal re-renders

**Type Safety:**
- Defined proper `PreviewValue` type: `string | string[] | number | undefined`
- Created `ProcessedField` type extending `TemplateFieldSchema`
- Removed all `any` types for full TypeScript safety
- Proper type inference throughout the component

**Code Quality:**
- Extracted shared utility function to eliminate duplication
- Single source of truth for field options processing
- Clean separation of concerns between editor and preview
- Well-documented code with clear comments

**Field Processing:**
- Options converted from newline-separated strings to arrays for rendering
- Shared utility function ensures consistent processing across editor and preview
- All 7 field types supported: text, textarea, number, date, dropdown, radio, checkbox
- Proper handling of required fields with asterisk indicators
- Field descriptions displayed below labels

**Responsive Design:**
- Tab navigation works seamlessly on mobile and desktop
- Preview content centered with max-width constraint
- Maintains existing edge-to-edge mobile design patterns
- Full-width tabs with clear active state indication

## Testing

- ✅ All tests pass (run_tests.sh successful)
- ✅ TypeScript compilation successful with no errors
- ✅ No console statements added
- ✅ Comprehensive E2E test suite added (7 test cases)
- ✅ Manual testing confirms:
  - Tab switching works correctly
  - All field types render and function properly
  - Dropdown options display correctly
  - Preview updates reflect editor changes
  - Mobile and desktop layouts work as expected
  - Performance is excellent with 20+ fields

## User Impact

**Positive:**
- Faster template creation workflow
- Reduced errors in template configuration
- Better understanding of end-user experience
- Immediate feedback on field ordering and layout
- Ability to test dropdown/radio/checkbox options before saving

**No Breaking Changes:**
- Existing template editor functionality unchanged
- All existing templates continue to work
- No API changes required
- No database migrations needed

## Screenshots

(Add screenshots showing:)
1. Tab navigation in the modal header
2. Edit tab with field editor
3. Preview tab with interactive form
4. Preview showing dropdown options
5. Mobile view of preview

## Future Enhancements

Potential improvements for future PRs:
- Add validation error preview (show how required field errors appear)
- Add sample data button to auto-fill preview with test data
- Add mobile/desktop view toggle for preview
- Add print preview mode
- Show character count for text fields in preview
