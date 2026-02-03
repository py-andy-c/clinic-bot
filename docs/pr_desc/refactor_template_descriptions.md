# Refactor: Standardize Template Field Descriptions & Deprecate Placeholders

## Summary

This PR refactors the Medical Record Template system to standardize how field instructions are handled. We have deprecated the `placeholder` (提示文字) property in favor of a universal `description` (欄位說明) property. This avoids confusion for field types where placeholders are not standard (e.g., Radio, Checkbox) and fixes issues with Dropdown default values.

## Changes

### Frontend

* **Template Editor (`MedicalRecordTemplateEditorModal.tsx`)**:
  * Removed the "Placeholder" input field from the UI.
  * Added a "Description" input field for all field types.
  * Updated the Zod schema to include `description`.
* **Dynamic Form (`MedicalRecordDynamicForm.tsx`)**:
  * Updated all field renderers (Text, Textarea, Number, Date, Dropdown, Radio, Checkbox) to accept and pass the `description` prop.
  * Removed `placeholder` attribute usage from inputs.
  * Fixed Dropdown component to use a hardcoded "請選擇..." (Please select...) as the default empty option, resolving a bug where it was trying to use the placeholder text as the default value.
* **Form Components (`FormField.tsx`)**:
  * Moved the rendering of the description text to appear **immediately below the label** (above the input field). This provides better context for users before they interact with the field.
* **Types (`types/medicalRecord.ts`)**:
  * Added `description` to the `TemplateField` interface.

## Rationale

* **Consistency**: "Description" works for all field types, whereas "Placeholder" only makes sense for text-like inputs.
* **UX Improvement**: Instructions in the "Description" field remain visible while typing/selecting, unlike placeholders which disappear.
* **Bug Fix**: Dropdowns were incorrectly attempting to use placeholders as default values, leading to confusing UI behavior.

## Screenshots

(N/A - Logic and Layout changes only)

## Testing

1. Go to Settings -> Medical Record Templates.
2. Edit a template and verify "Placeholder" input is gone and "Description" input is present.
3. Add descriptions to various field types.
4. Create a new Medical Record using that template.
5. Verify that descriptions appear correctly below the field labels for all inputs.
