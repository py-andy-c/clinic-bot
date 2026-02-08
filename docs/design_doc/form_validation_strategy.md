# Form Validation & Required Field Enforcement Strategy

## Overview

This document outlines the strategy for enforcing "Required" fields in dynamic forms (Patient Forms and Medical Records). The goal is to balance **Data Quality** (ensuring extensive data collection) with **Operational Flexibility** (allowing practitioners to work non-linearly).

## Core Philosophy: Context-Based Enforcement

We distinguish validation logic based on the **Actor** (Who is filling the form?) rather than the **Form Type**.

| Actor | Context | Enforcement Level | Behavior |
| :--- | :--- | :--- | :--- |
| **Patient** | LIFF (External) | **Strict** | **Blocking**. Patients cannot submit the form until all required fields are filled. |
| **Clinic Staff** | Admin Portal (Internal) | **Loose** | **Non-Blocking**. Staff can save incomplete forms at any time ("Create empty, edit later"). |

## Detailed Behaviors

### 1. Patient Side (LIFF)

* **Goal**: Ensure the clinic receives a complete dataset from the patient.
* **Workflow**:
  1. Patient opens the form via LINE.
  2. Patient fills out fields.
  3. Patient clicks "Submit".
* **Validation**:
  * **Mechanism**: The frontend `submit` action checks all fields marked as `required` in the template.
  * **UI**:
    * Required fields are marked with `*`.
    * Submit button triggers validation.
    * If fields are missing:
      * Submission is **blocked**.
      * UI scrolls to the first error.
      * Fields show red error borders and "Required" messages.
  * **Backend**: The `POST /submit` endpoint performs a secondary validation check to reject incomplete payloads (400 Bad Request).

### 2. Clinic Side (Medical Records & Admin Patient Forms)

* **Goal**: Allow practitioners to document iteratively without friction. Support the "Create empty, edit later" pattern.
* **Workflow**:
  1. Staff creates a record (often empty or minimal) before/during a visit.
  2. Staff saves the record to minimize data loss.
  3. Staff returns later to complete the documentation.
* **Validation**:
  * **Mechanism**: The frontend allows saving `null` or empty values for required fields.
  * **Visual Feedback**:
    * **Initial State**: Clean UI. Only red asterisks (`*`) next to labels indicate required fields. No yellow banners or inline warnings are shown to avoid distraction.
  * **Save Action**:
    * **Always Allowed**. The "Save" button is never disabled due to missing required fields.
    * **Post-Save Feedback (Warn on Save)**:
      * If required fields are missing, the save **succeeds**, but an alert/toast appears:
        > "Medical record updated successfully.
        >
        > Note: 3 required fields are incomplete:
        > • Field A
        > • Field B"

## Field Types and Data Validation

### Supported Field Types and Their Data Formats

Our system supports the following field types, each with specific data formats:

| Field Type | Data Format | Example Valid Values | Example Invalid Values |
|------------|-------------|---------------------|----------------------|
| `text` | String | `"John Doe"`, `"123"` | `""` (empty), `"   "` (whitespace only) |
| `textarea` | String | `"Long description..."` | `""` (empty), `"   "` (whitespace only) |
| `number` | Number | `42`, `0`, `3.14` | `NaN`, `""` (empty string), `"abc"` |
| `date` | String (ISO date) | `"2024-01-15"` | `""` (empty), invalid dates |
| `dropdown` | String | `"Option A"` | `""` (empty) |
| `radio` | String | `"Option B"` | `""` (empty) |
| `checkbox` | **Array of strings** | `["Option 1", "Option 2"]` | `[]` (empty array), `false`, `true` |

### Important: Checkbox Fields Are Always Arrays

**Critical Design Decision**: The `checkbox` field type **always produces arrays**, never booleans.

* **Single checkbox**: Still produces an array with 0 or 1 elements: `[]` or `["checked"]`
* **Multiple checkboxes**: Produces an array with 0 to N elements: `[]`, `["A"]`, `["A", "B"]`
* **Never produces booleans**: The value is never `true` or `false`

**Implementation Note**: React Hook Form with multiple checkboxes of the same name automatically produces an array. See `MedicalRecordDynamicForm.tsx` line 108:

```typescript
// Multiple checkboxes with same name and different values
// automatically produce an array in react-hook-form
```

**Why This Matters**:

* Backend validation checks for empty arrays (`[]`), not boolean `false`
* Frontend schema uses `z.array(z.string())`, not `z.boolean()`
* Tests that check `boolean false` are for hypothetical future features, not current behavior

### Validation Rules for Required Fields

When a field is marked as `required: true`, the following rules apply:

| Field Type | Valid (Passes) | Invalid (Fails) |
|------------|---------------|-----------------|
| `text`, `textarea`, `dropdown`, `radio`, `date` | Non-empty string after trimming | `null`, `undefined`, `""`, `"   "` (whitespace) |
| `number` | Any number including `0` | `null`, `undefined`, `NaN`, `""` (empty string) |
| `checkbox` | Non-empty array | `null`, `undefined`, `[]` (empty array) |

**Special Cases**:

* **Zero is valid**: For number fields, `0` is a valid value (e.g., "0 cigarettes per day")
* **Whitespace is trimmed**: `"   "` is treated as empty for text fields
* **Empty arrays fail**: For checkboxes, `[]` means nothing was selected, which fails validation

### Frontend Validation Implementation

The frontend uses Zod with `z.preprocess()` to handle data transformation and validation:

**Text Fields** (strict mode):

```typescript
z.preprocess(
  (val) => {
    if (val === null || val === undefined) return undefined;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      return trimmed === '' ? undefined : trimmed;
    }
    return val;
  },
  z.string({ required_error: '此欄位為必填' }).min(1, '此欄位為必填')
)
```

**Number Fields** (strict mode):

```typescript
z.preprocess(
  (val) => {
    if (val === null || val === undefined || val === '') return undefined;
    const num = Number(val);
    return isNaN(num) ? undefined : num; // Reject NaN
  },
  z.number({ 
    required_error: '此欄位為必填',
    invalid_type_error: '請輸入有效數字'
  })
)
```

**Checkbox Fields** (strict mode):

```typescript
z.preprocess(
  (val) => {
    if (Array.isArray(val)) return val;
    if (val === null || val === undefined) return [];
    if (typeof val === 'boolean') return []; // Defensive: convert unexpected booleans to empty array
    return [String(val)];
  },
  z.array(z.string()).min(1, '此欄位為必填')
)
```

### Backend Validation Implementation

The backend validation is simpler and focuses on the actual data types we receive:

```python
def validate_record_values(template_fields, values):
    for field in template_fields:
        if field.get('required', False):
            value = values.get(field['id'])
            
            # Check if value is missing or empty
            # Note: Zero (0) and False are valid values, only None/empty string/empty array are invalid
            is_valid = True
            if value is None:
                is_valid = False
            elif isinstance(value, str) and not value.strip():
                is_valid = False
            elif isinstance(value, list) and not value:
                is_valid = False
            # Numbers (including 0) are valid
            # Booleans are not used in our system, but would be valid if they were
                
            if not is_valid:
                errors.append(f"必填欄位未填寫: {field_label}")
```

**Why Boolean Handling Isn't Explicit**:

* Our system never produces boolean values for form fields
* Checkboxes produce arrays, not booleans
* If a boolean somehow appears, it would pass validation (fall through to `is_valid = True`)
* This is defensive and correct - we don't want to reject unexpected but valid data

### Performance Optimization

**Schema Memoization**: The Zod schema is expensive to create, so we memoize it separately from validation:

```typescript
// Schema only recreates when fields change (not on every keystroke)
const strictSchema = useMemo(
  () => createDynamicSchema(record?.template_snapshot?.fields, true),
  [record?.template_snapshot?.fields]
);

// Validation uses the cached schema (fast)
const validationWarnings = useMemo(() => {
  const result = strictSchema.safeParse({ values, appointment_id });
  // Extract warnings...
}, [strictSchema, values, appointment_id]);
```

This ensures that typing in a form field doesn't trigger expensive schema recreation.

## Implementation Logic

### Frontend (Schema Generation)

The dynamic Zod schema generator (`createDynamicSchema`) will accept a `strictMode` boolean flag.

```typescript
const createDynamicSchema = (fields: TemplateField[], strictMode: boolean) => {
  // ...
  fields.forEach(field => {
    let fieldSchema = z.string();
    
    // Only apply non-nullable/required logic if strictMode is TRUE
    if (!strictMode) {
      fieldSchema = fieldSchema.optional().nullable(); 
    } else if (field.required) {
      fieldSchema = fieldSchema.min(1, "Required");
    }
    // ...
  });
  // ...
}
```

* **LIFF Pages**: Call with `strictMode: true`.
* **Admin/Clinic Pages**: Call with `strictMode: false`.

### Backend (Server-Side Validation)

For patient forms submitted via LIFF, the backend performs secondary validation to ensure data integrity:

**Validation Utility** (`backend/src/utils/template_validation.py`):

```python
def validate_record_values(template_fields: List[Dict[str, Any]], values: Dict[str, Any]) -> List[str]:
    """
    Validate that all required fields in the template are present and non-empty in values.
    Returns a list of error messages for missing required fields.
    """
    # Checks for None, empty strings, and empty arrays
    # Returns list of error messages like "必填欄位未填寫: {field_label}"
```

**Usage** (`backend/src/api/liff.py`):

* Called in `POST /liff/patient-forms/:accessToken/submit`
* Called in `PUT /liff/patient-forms/:accessToken` (update)
* Returns `400 Bad Request` if validation fails
* **Not used** for clinic-side medical record endpoints (non-blocking)

### Why Clinic Endpoints Skip Backend Validation

**Design Decision**: Clinic-side medical record endpoints (`POST /clinic/patients/:id/medical-records`, `PUT /clinic/medical-records/:id`) **intentionally do not perform server-side required field validation**.

**Rationale**:

1. **Trust Model**: Clinic users are authenticated internal staff with proper authorization. Unlike external patient submissions, there's no security risk from incomplete data.

2. **Operational Flexibility**: The core design philosophy is "Create empty, edit later." Backend validation would block this workflow and force practitioners to complete forms before saving.

3. **Frontend Responsibility**: The frontend provides non-blocking warnings (post-save alerts) to guide users without preventing saves. This is sufficient for internal use.

4. **Data Integrity**: While required fields may be empty, the data structure itself is validated (correct types, valid appointment IDs, etc.) by Pydantic models.

**Security Note**: This is not a security vulnerability because:

* Clinic endpoints require authentication and clinic-specific authorization
* Only trusted internal users can access these endpoints
* The worst case is incomplete medical records, not data corruption or unauthorized access
* Frontend validation provides adequate data quality guidance

### Future: "Finalizing" Records

In the future, if we need to enforce completeness on the clinic side (e.g., for insurance reporting), we can introduce a specific **"Finalize"** or **"Sign Off"** action.

* **Save**: Continues to be non-blocking (Draft).
* **Finalize**: Enforces strict validation (Blocking).
