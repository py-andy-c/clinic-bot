# Billing System Design Document

## Overview

This document describes the design for adding billing and receipt functionality to the clinic management system. The system will support multiple billing scenarios per practitioner per service item, checkout workflows, and receipt generation.


## Objectives

1. **Service Item Management**: Extend appointment types to service items with billing configuration
2. **Billing Scenarios**: Support multiple pricing options per practitioner per service (e.g., regular price, discounts)
3. **Checkout Workflow**: Allow clinic admins to process payments and generate receipts for appointments
4. **Receipt Management**: Store and display receipts with itemized billing
5. **Practitioner Assignment**: Move practitioner-service assignment from profile page to service item settings (admin-only)
6. **Accounting Dashboard**: Provide admin-only dashboard for auditing billing data, tracking revenue, and reviewing practitioner billing scenario selections

## Current State

### Appointment Types
- Currently stored in `appointment_types` table
- Fields: `id`, `clinic_id`, `name`, `duration_minutes`, `is_deleted`, `deleted_at`
- Managed in clinic settings page
- Practitioners select which types they offer in their profile page

### Practitioner-AppointmentType Mapping
- Stored in `practitioner_appointment_types` table
- Many-to-many relationship
- Currently managed by practitioners in their profile

## Database Schema Changes

### 1. Add Receipt Settings to Clinic Settings

Add new `ReceiptSettings` to clinic settings JSONB structure:

```python
class ReceiptSettings(BaseModel):
    """Schema for receipt settings."""
    custom_notes: Optional[str] = Field(default=None, max_length=2000, description="Custom notes to append at the end of receipts")
    show_stamp: bool = Field(default=False, description="Whether to display a stamp with clinic name and checkout date on receipts")
```

**Settings Structure:**
- Added to `clinic.settings` JSONB column under `receipt_settings` key
- Default: `custom_notes: null`, `show_stamp: false`

### 2. Extend `appointment_types` Table

Rename conceptually to "service items" but keep table name for backward compatibility. Add new fields:

```sql
ALTER TABLE appointment_types ADD COLUMN receipt_name VARCHAR(255);
ALTER TABLE appointment_types ADD COLUMN allow_patient_booking BOOLEAN DEFAULT TRUE;
ALTER TABLE appointment_types ADD COLUMN description TEXT;
ALTER TABLE appointment_types ADD COLUMN scheduling_buffer_minutes INTEGER DEFAULT 0;
```

**New Fields:**
- `receipt_name`: Name to display on receipt (can differ from `name`)
- `allow_patient_booking`: Whether patients can book this service via LIFF (default: true)
- `description`: Service description shown on LIFF
- `scheduling_buffer_minutes`: Additional minutes added to duration for scheduling (default: 0)

**Migration Notes:**
- `receipt_name` defaults to `name` for existing records
- `allow_patient_booking` defaults to `true` for existing records
- `scheduling_buffer_minutes` defaults to `0` for existing records

### 3. New Table: `billing_scenarios`

Stores billing scenarios for each practitioner-service combination.

```sql
CREATE TABLE billing_scenarios (
    id SERIAL PRIMARY KEY,
    practitioner_appointment_type_id INTEGER NOT NULL REFERENCES practitioner_appointment_types(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,  -- 金額: amount charged to patient
    revenue_share DECIMAL(10, 2) NOT NULL,  -- 分潤: revenue share to clinic
    is_default BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(practitioner_appointment_type_id, name) WHERE is_deleted = FALSE
);

CREATE INDEX idx_billing_scenarios_practitioner_type ON billing_scenarios(practitioner_appointment_type_id);
CREATE INDEX idx_billing_scenarios_deleted ON billing_scenarios(is_deleted);

-- Add check constraint for revenue_share validation
ALTER TABLE billing_scenarios ADD CONSTRAINT chk_revenue_share_le_amount 
    CHECK (revenue_share <= amount);
```

**Fields:**
- `practitioner_appointment_type_id`: Links to practitioner-service combination
- `name`: Scenario name (e.g., "原價", "九折", "會員價")
- `amount`: Amount charged to patient (shown on receipt)
- `revenue_share`: Revenue share to clinic (internal only, must be <= amount)
- `is_default`: Default scenario for this practitioner-service
- Soft delete support

**Validation Constraints:**
- `revenue_share <= amount` (enforced at database and application level)
- `amount > 0`
- `revenue_share >= 0`

### 4. New Table: `receipts`

Stores receipt information for appointments with complete immutable snapshot.

**Design Rationale:**
- Uses JSONB snapshot pattern to ensure immutability when dependencies change (patient name, clinic name, service names, etc.)
- Extracts frequently queried fields to columns for performance
- Complies with Taiwan legal requirements:
  - Physical Therapists Act (物理治療師法) Article 27
  - Medical Care Act (醫療法) Article 22
  - Commercial Accounting Act (商業會計法)
- Maintains complete audit trail
- Supports receipt voiding for corrections while preserving audit trail

```sql
CREATE TABLE receipts (
    id SERIAL PRIMARY KEY,
    appointment_id INTEGER NOT NULL REFERENCES appointments(calendar_event_id) ON DELETE RESTRICT,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
    
    -- Frequently queried fields (extracted from JSONB for performance)
    receipt_number VARCHAR(50) NOT NULL,  -- Sequential receipt number (e.g., "2024-00001")
    issue_date TIMESTAMP WITH TIME ZONE NOT NULL,  -- Receipt issue date
    total_amount DECIMAL(10, 2) NOT NULL,  -- Total amount charged to patient
    total_revenue_share DECIMAL(10, 2) NOT NULL,  -- Total revenue share (internal)
    
    -- Complete immutable snapshot (stores all data as it existed at creation time)
    receipt_data JSONB NOT NULL,
    
    -- Voiding support (for accounting dashboard and audit trail)
    is_voided BOOLEAN DEFAULT FALSE,  -- Whether receipt has been voided
    voided_at TIMESTAMP WITH TIME ZONE,  -- Timestamp when receipt was voided
    voided_by_user_id INTEGER REFERENCES users(id),  -- Admin user who voided the receipt
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraint: Only one active (non-voided) receipt per appointment
    -- Multiple voided receipts allowed for audit trail
    UNIQUE(appointment_id) WHERE is_voided = FALSE,
    UNIQUE(clinic_id, receipt_number)  -- Receipt numbers unique per clinic
);

CREATE INDEX idx_receipts_receipt_number ON receipts(receipt_number);
CREATE INDEX idx_receipts_issue_date ON receipts(issue_date);
CREATE INDEX idx_receipts_appointment ON receipts(appointment_id);
CREATE INDEX idx_receipts_clinic ON receipts(clinic_id);
CREATE INDEX idx_receipts_voided ON receipts(is_voided);
CREATE INDEX idx_receipts_voided_at ON receipts(voided_at);

-- GIN index for JSONB queries
CREATE INDEX idx_receipts_data_gin ON receipts USING GIN (receipt_data);

-- Database trigger to enforce receipt_data immutability
-- Only allow updates to voiding-related fields, prevent receipt_data modifications
CREATE OR REPLACE FUNCTION prevent_receipt_data_modification()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow updates only to voiding fields
  IF OLD.receipt_data IS DISTINCT FROM NEW.receipt_data THEN
    RAISE EXCEPTION 'receipt_data is immutable and cannot be modified after creation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER receipt_data_immutability_trigger
  BEFORE UPDATE ON receipts
  FOR EACH ROW
  EXECUTE FUNCTION prevent_receipt_data_modification();
```

**Voiding Support:**
- `is_voided`: Whether receipt has been voided (default: false)
- `voided_at`: Timestamp when receipt was voided (null if not voided)
- `voided_by_user_id`: Admin user who voided the receipt (null if not voided)
- `reason`: Optional reason for voiding (stored in `receipt_data` JSONB under `void_info.reason`)
- **Important**: Voided receipts **keep their original receipt number** (gapless sequencing for audit compliance)
- Voided receipts remain in database for audit trail
- Voided receipts are excluded from accounting calculations
- Voiding is irreversible (maintains audit integrity)
- **Re-issuing**: After voiding, a new receipt can be created for the same appointment (gets new sequential receipt number)

**Database Constraints:**
- `UNIQUE(appointment_id) WHERE is_voided = FALSE`: Ensures only one active receipt per appointment
- Multiple voided receipts allowed per appointment (for audit trail of corrections)
- `ON DELETE RESTRICT` on `appointment_id`: Prevents appointment deletion if receipts exist (maintains audit trail)

**Receipt Data JSONB Structure:**

The `receipt_data` JSONB column stores a complete snapshot of all receipt information as it existed at creation time:

```json
{
  "receipt_number": "2024-00001",
  "issue_date": "2024-01-15T10:30:00+08:00",
  "visit_date": "2024-01-15T09:00:00+08:00",
  "clinic": {
    "id": 1,
    "display_name": "ABC復健診所"
  },
  "patient": {
    "id": 5,
    "name": "王小明"
  },
  "checked_out_by": {
    "id": 7,
    "name": "Admin User",
    "email": "admin@clinic.com"
  },
  "items": [
    {
      "item_type": "service_item",
      "service_item": {
        "id": 1,
        "name": "初診評估",
        "receipt_name": "初診評估"
      },
      "practitioner": {
        "id": 3,
        "name": "Dr. Smith"
      },
      "billing_scenario": {
        "id": 10,
        "name": "原價"
      },
      "amount": 1000.00,
      "revenue_share": 300.00,
      "display_order": 0
    },
    {
      "item_type": "other",
      "item_name": "額外服務",
      "practitioner": null,
      "amount": 500.00,
      "revenue_share": 150.00,
      "display_order": 1
    }
  ],
  "totals": {
    "total_amount": 1500.00,
    "total_revenue_share": 450.00
  },
  "payment_method": "cash",
  "custom_notes": "地址：123 Main St, Taipei\n電話：02-1234-5678\n統一編號：12345678",
  "stamp": {
    "enabled": true
  },
  "void_info": {
    "voided": false,
    "voided_at": null,
    "voided_by": null,
    "reason": null
  }
}
```

**Mandatory Fields (Taiwan Legal Requirements):**
- ✅ Receipt number (收據編號) - sequential, unique per clinic
- ✅ Issue date (開立日期) - when receipt is created
- ✅ Visit date (看診日期) - appointment date/time
- ✅ Clinic display name (診所名稱) - from `clinic.display_name`
- ✅ Patient name (病患姓名)
- ✅ Itemized service list with amounts (服務項目及費用)
- ✅ Total amount (總費用)
- ✅ Payment method (付款方式)
- ✅ Checkout user (開立收據者) - signature/stamp equivalent
- ✅ Clinic address and phone (地址、電話) - recommended in custom notes (prompt users to add)

**Optional Fields:**
- Custom notes (收據備註) - clinic-configured notes appended to receipt (stored in snapshot at creation time)
  - **Recommendation**: Clinics should include address (地址), phone (電話), and tax ID (統一編號) in custom notes for compliance
  - System should prompt users to add these fields in receipt settings UI
  - These fields are optional but recommended for legal compliance
- Stamp (印章) - clinic name and checkout date stamp (stored in snapshot at creation time)
  - Only included if `show_stamp` setting is enabled
  - Uses `clinic.display_name` and `issue_date` from receipt data (already in snapshot)
  - Immutable - reflects state at creation time

**Immutability:**
- Receipts are **never modified** after creation
- All data stored as snapshot at creation time
- No dependency on foreign keys that can change
- If correction needed: create new receipt and void old one (future enhancement)

**Retention Period:**
- **Minimum 10 years** (Physical Therapists Act Article 25 requirement for physical therapy clinics)
- Accounting records: 5-10 years depending on type
- Consider archival system for receipts >10 years old (move to cheaper storage tier while maintaining access)

## API Changes

### 1. Service Item Management

**GET `/api/clinic/settings`**
- Include new service item fields in response
- Include billing scenarios in nested structure
- Include receipt settings (custom notes)

**PUT `/api/clinic/settings`**
- Accept new service item fields
- Handle practitioner assignment (move from profile page)
- Accept billing scenarios for each practitioner-service combination
- Accept receipt settings (custom notes)

**New Endpoints:**

**GET `/api/clinic/service-items`**
- Get all service items with practitioners and billing scenarios
- **Access Control**: 
  - **Admin users**: Can see all billing scenarios for all practitioners
  - **Non-admin users**: Cannot see billing scenarios at all (empty list or filtered out)
  - **Rationale**: Billing scenarios contain sensitive financial information (分潤) that should remain internal to clinic administration

**PUT `/api/clinic/service-items/{id}`**
- Update service item fields
- Update practitioner assignments
- Update billing scenarios
- **Access Control**: Admin-only

**POST `/api/clinic/service-items/{id}/practitioners/{practitioner_id}/billing-scenarios`**
- Create new billing scenario
- **Access Control**: Admin-only

**PUT `/api/clinic/service-items/{id}/practitioners/{practitioner_id}/billing-scenarios/{scenario_id}`**
- Update billing scenario
- **Access Control**: Admin-only

**DELETE `/api/clinic/service-items/{id}/practitioners/{practitioner_id}/billing-scenarios/{scenario_id}`**
- Soft delete billing scenario
- **Access Control**: Admin-only

### 2. Checkout API

**POST `/api/appointments/{appointment_id}/checkout`**
- **Access Control**: Admin-only
- **Validation**: 
  - All items must satisfy `revenue_share <= amount`
  - Appointment must exist and not be cancelled
  - Appointment must not already have an active (non-voided) receipt
  - At least one item required
  - All items must have amount > 0
  - Payment method must be provided and valid
  - Returns 400 Bad Request if validation fails
- **Concurrent Checkout Protection**:
  - Use database-level locking to prevent race conditions
  - Check for existing active receipt with `SELECT ... FOR UPDATE` on appointment
  - If another admin is checking out, return 409 Conflict with message: "Another user is currently processing checkout for this appointment"
  - Implementation: Use PostgreSQL row-level locking or optimistic locking with version field
- **Receipt Number Generation**: 
  - Format: `{YYYY}-{NNNNN}` (e.g., "2024-00001")
  - Sequential per clinic per year
  - Auto-generated by system using PostgreSQL sequences (atomic, thread-safe)
  - Uses current date's year (not appointment date) for receipt number
  - **Year Transition**: If checkout spans year boundary, receipt number uses year from `issue_date` (current timestamp)
  - **Edge Case**: If sequence reaches 99,999 in a year, system should alert admin (future enhancement: support 6+ digits or alternative numbering)
- **Snapshot Creation**:
  - Captures all data at creation time (clinic display_name, patient name, service names, practitioner names, etc.)
  - Includes clinic's custom receipt notes from receipt settings (clinic should include address and phone in custom notes)
  - Includes stamp enabled flag (if enabled, uses `clinic.display_name` and `issue_date` from receipt data)
  - Stores complete snapshot in `receipt_data` JSONB column
  - Extracts frequently queried fields to columns
  - **Issue Date**: Uses current timestamp (not appointment date)
  - **Visit Date**: Also includes appointment date/time in snapshot as `visit_date` for legal compliance (看診日期)
```json
{
  "items": [
    {
      "item_type": "service_item",
      "service_item_id": 1,
      "practitioner_id": 5,
      "billing_scenario_id": 10,
      "amount": 1000.00,
      "revenue_share": 300.00,
      "is_custom_scenario": false
    },
    {
      "item_type": "other",
      "item_name": "額外服務",
      "practitioner_id": null,
      "amount": 500.00,
      "revenue_share": 150.00,
      "is_custom_scenario": true
    }
  ],
  "payment_method": "cash"
}
```

**Payment Method Values:**
- Valid values: `"cash"`, `"card"`, `"transfer"`, `"other"`
- Required field
- Stored in receipt snapshot (immutable)

**Response:**
```json
{
  "receipt_id": 123,
  "receipt_number": "2024-00001",
  "total_amount": 1500.00,
  "total_revenue_share": 450.00,
  "created_at": "2024-01-15T10:30:00Z"
}
```

**GET `/api/appointments/{appointment_id}/receipt`**
- Get receipt details with items
- **Access Control**: Admin-only (receipts contain revenue_share information)
- **Behavior**: Returns the **active (non-voided) receipt** for the appointment, if exists
  - If appointment has multiple receipts (voided + active), returns only the active one
  - If all receipts are voided, returns the most recent voided receipt (for viewing)
  - If no receipt exists, returns 404
- **Response includes**:
  - `is_voided`: Boolean indicating if receipt is voided
  - `voided_at`: Timestamp if voided (null otherwise)
  - `voided_by`: User info if voided (null otherwise)
  - `void_reason`: Reason for voiding if provided (null otherwise)
- **Use Case**: Used by appointment modal to determine which receipt to display and which buttons to show

**GET `/api/receipts/{receipt_id}/download`**
- Download receipt as PDF
- **Access Control**: Admin-only
- **Response**: PDF file with `Content-Type: application/pdf`
- **Filename**: `receipt_{receipt_number}.pdf` (e.g., "receipt_2024-00001.pdf")
- **Content**: Formatted receipt with all information from immutable snapshot
  - Receipt number, issue date
  - Clinic information (display name)
  - Patient information (name)
  - Itemized list with amounts
  - Total amount
  - Payment method
  - Custom notes (if present)
  - Stamp (if enabled)
  - Voided status (if voided)
- **Formatting**: Professional receipt layout suitable for printing
- **Language**: Traditional Chinese (繁體中文)

**POST `/api/receipts/{receipt_id}/void`**
- Void a receipt (admin-only)
- **Request Body**: `{ "reason": "Optional reason for voiding" }`
- **Response**: 
  ```json
  {
    "receipt_id": 123,
    "voided": true,
    "voided_at": "2024-01-20T15:30:00+08:00",
    "voided_by": {
      "id": 7,
      "name": "Admin User",
      "email": "admin@clinic.com"
    },
    "reason": "Customer requested correction"
  }
  ```
- **Validation**: 
  - Receipt must exist
  - Receipt must not already be voided
  - User must be admin
- **Side Effects**:
  - Sets `is_voided = true`
  - Sets `voided_at` to current timestamp
  - Sets `voided_by_user_id` to current user
  - Stores `reason` in receipt_data JSONB (if provided)
  - Appointment becomes available for re-checkout (new receipt can be created)

**GET `/api/appointments/{appointment_id}/receipt` Response:**
```json
{
  "receipt_id": 123,
  "receipt_number": "2024-00001",
  "appointment_id": 456,
  "issue_date": "2024-01-15T10:30:00+08:00",
  "visit_date": "2024-01-15T09:00:00+08:00",
  "total_amount": 1500.00,
  "total_revenue_share": 450.00,
  "created_at": "2024-01-15T10:30:00Z",
  "checked_out_by": {
    "id": 7,
    "full_name": "Admin User"
  },
  "clinic": {
    "id": 1,
    "display_name": "ABC復健診所"
  },
  "patient": {
    "id": 5,
    "name": "王小明"
  },
  "items": [
    {
      "item_type": "service_item",
      "service_item": {
        "id": 1,
        "name": "初診評估",
        "receipt_name": "初診評估"
      },
      "practitioner": {
        "id": 5,
        "name": "Dr. Smith"
      },
      "billing_scenario": {
        "id": 10,
        "name": "原價"
      },
      "amount": 1000.00,
      "revenue_share": 300.00,
      "display_order": 0
    }
  ],
  "payment_method": "cash",
  "custom_notes": "地址：123 Main St, Taipei\n電話：02-1234-5678\n統一編號：12345678",
  "stamp": {
    "enabled": true
  },
  "void_info": {
    "voided": false,
    "voided_at": null,
    "voided_by": null,
    "reason": null
  }
}
```

**Note:** Response includes complete snapshot data from `receipt_data` JSONB column.

### 3. Receipt PDF Download

**GET `/api/receipts/{receipt_id}/download`**

Download receipt as PDF file.

**Access Control:** Admin-only

**Response:**
- Content-Type: `application/pdf`
- Content-Disposition: `attachment; filename="receipt_{receipt_number}.pdf"`
- Binary PDF file content

**PDF Content:**
- **Header:**
  - Clinic display name (診所名稱)
  - Receipt number (收據編號)
  - Visit date (看診日期) - appointment date/time
  - Issue date (開立日期) - receipt creation timestamp
  - Voided status indicator (if voided) - clearly marked with "已作廢" (VOIDED) watermark/stamp
  - Voided information (if voided):
    - Voided date (作廢日期)
    - Voided by (作廢者)
    - Void reason (作廢原因) - if provided
- **Body:**
  - Patient name (病患姓名)
  - Itemized list:
    - Service item name (receipt_name)
    - Practitioner (if applicable)
    - Amount per item
  - Total amount (總費用)
  - Payment method (付款方式)
- **Footer:**
  - Custom notes (收據備註) - if present
  - Stamp (印章) - if enabled (clinic name and issue date)
  - Checkout user (開立收據者)

**PDF Styling:**
- Professional receipt layout suitable for printing
- Clear typography and spacing
- Traditional Chinese font support
- All data from immutable snapshot (reflects state at creation time)

**Implementation:**
- **Technology**: Use Python PDF library (e.g., `reportlab`, `weasyprint`, or `xhtml2pdf`)
- **Approach**: 
  1. Fetch receipt from database (including `receipt_data` JSONB)
  2. Extract all data from immutable snapshot
  3. Check `is_voided` flag and include void information in PDF if voided
  4. Generate HTML template with receipt data (including void status if applicable)
  5. Convert HTML to PDF
  6. Return PDF as binary response
- **Voided Receipt PDF:**
  - Clearly mark receipt as "已作廢" (VOIDED) with prominent watermark/stamp
  - Include voided date, voided by user, and reason (if provided)
  - Maintain all original receipt data for audit purposes
- **Error Handling:**
  - Receipt not found → 404
  - Receipt access denied → 403
  - PDF generation failure → 500 (with error logging)
- **Performance:**
  - PDF generation should be fast (< 1 second for typical receipts)
  - Consider caching generated PDFs (optional optimization for frequently accessed receipts)

### 4. Accounting Dashboard API

**GET `/api/accounting/summary`**

Get aggregated accounting statistics for a date range.

**Query Parameters:**
- `start_date` (required): Start date (YYYY-MM-DD)
- `end_date` (required): End date (YYYY-MM-DD)
- `practitioner_id` (optional): Filter by specific practitioner

**Access Control:** Admin-only

**Response:**
```json
{
  "date_range": {
    "start_date": "2024-01-01",
    "end_date": "2024-01-31"
  },
  "summary": {
    "total_revenue": 150000.00,
    "total_revenue_share": 45000.00,
    "receipt_count": 150,
    "voided_receipt_count": 2
  },
  "by_practitioner": [
    {
      "practitioner_id": 3,
      "practitioner_name": "Dr. Smith",
      "total_revenue": 50000.00,
      "total_revenue_share": 15000.00,
      "receipt_count": 50
    }
  ],
  "by_service_item": [
    {
      "service_item_id": 1,
      "service_item_name": "初診評估",
      "receipt_name": "初診評估",
      "total_revenue": 80000.00,
      "total_revenue_share": 24000.00,
      "receipt_count": 80
    }
  ]
}
```

**Implementation Notes:**
- Query receipts where `is_voided = false` and `issue_date` within range
- Aggregate from `receipt_data` JSONB:
  - Extract `items[]` array
  - Sum `amount` and `revenue_share` per practitioner
  - Sum `amount` and `revenue_share` per service item
- Use PostgreSQL JSONB aggregation functions

**GET `/api/accounting/practitioner/{practitioner_id}/details`**

Get detailed accounting items for a specific practitioner in a date range.

**Query Parameters:**
- `start_date` (required): Start date (YYYY-MM-DD)
- `end_date` (required): End date (YYYY-MM-DD)

**Access Control:** Admin-only

**Response:**
```json
{
  "practitioner": {
    "id": 3,
    "name": "Dr. Smith"
  },
  "date_range": {
    "start_date": "2024-01-01",
    "end_date": "2024-01-31"
  },
  "summary": {
    "total_revenue": 50000.00,
    "total_revenue_share": 15000.00,
    "receipt_count": 50
  },
  "items": [
    {
      "receipt_id": 123,
      "receipt_number": "2024-00001",
      "issue_date": "2024-01-15T10:30:00+08:00",
      "patient_name": "王小明",
      "service_item": {
        "id": 1,
        "name": "初診評估",
        "receipt_name": "初診評估"
      },
      "billing_scenario": {
        "id": 10,
        "name": "原價"
      },
      "amount": 1000.00,
      "revenue_share": 300.00
    }
  ],
  "by_service_item": [
    {
      "service_item_id": 1,
      "service_item_name": "初診評估",
      "receipt_name": "初診評估",
      "total_revenue": 30000.00,
      "total_revenue_share": 9000.00,
      "item_count": 30
    }
  ]
}
```

**Implementation Notes:**
- Query receipts where `is_voided = false`, `issue_date` within range
- Filter `receipt_data.items[]` where `practitioner.id` matches
- Extract item details including billing scenario information
- Group by service item for summary view

## Frontend Changes

### 1. Settings Page Restructure

**New Section: "服務項目設定"**
- Move appointment types section here
- Rename "預約類型" to "服務類型"
- Add new fields for each service item:
  - 項目名稱 (name)
  - 收據項目名稱 (receipt_name)
  - 開放病患自行預約 (allow_patient_booking) - checkbox
  - 說明 (description) - textarea
  - 服務時長 (duration_minutes) - number input
  - 排程緩衝時間 (scheduling_buffer_minutes) - number input
  - Display: "50分 (+10分)" format when buffer > 0

**Practitioner Assignment (Admin Only)**
- Under each service item, show list of practitioners
- Add/remove practitioners who offer this service
- For each practitioner, show billing scenarios section

**Billing Scenarios Management (Admin Only)**
- Under each practitioner for each service item:
  - List of billing scenarios
  - Add new scenario button
  - Each scenario shows: name, 金額, 分潤
  - Edit/delete buttons
  - Mark default scenario
  - **Access Control**: Only admins can view/edit billing scenarios
  - **Non-admin practitioners**: Cannot see billing scenarios (even their own) in settings
  - Billing scenarios are only visible during checkout (admin-only operation)

**New Section: "收據設定" (Receipt Settings)**
- **Access Control**: Admin-only
- **Custom Notes Field**:
  - Textarea input for custom notes (收據備註)
  - Max length: 2000 characters
  - Optional field (can be empty)
  - Description: "此備註將顯示在所有收據的底部。建議包含地址、電話、統一編號等資訊。"
  - **Prompt users**: Display helper text encouraging clinics to include:
    - Address (地址)
    - Phone (電話)
    - Tax ID (統一編號) - if applicable
  - These notes will be appended to all receipts created after saving
  - Notes are stored in receipt snapshot at creation time (immutable)
  - **Note**: These fields are optional but recommended for legal compliance
- **Show Stamp Toggle**:
  - Checkbox: "顯示印章" (Show Stamp)
  - Default: unchecked (false)
  - Description: "在收據上顯示印章，包含診所名稱及結帳日期"
  - When enabled, receipts will display a stamp with:
    - Clinic display name (診所名稱) - from `clinic.display_name` in receipt snapshot
    - Issue date (開立日期) - from `issue_date` in receipt snapshot
  - Only the `enabled` flag is stored in snapshot; stamp uses data already in receipt

### 2. Appointment Modal Changes

**Before Checkout:**
- Show: 編輯, 刪除, 結帳 buttons
- Hide: 檢視收據 button

**Checkout Modal (Admin Only):**
- **Access Control**: Only admins can access checkout functionality
- Default item: Auto-add service item from appointment type
  - Service item: Pre-selected (show receipt_name)
  - Practitioner: Pre-selected from appointment
  - Billing scenario: Show dropdown (default scenario selected)
  - **Validation**: Show error if revenue_share > amount
- Add item button:
  - Service item dropdown (show receipt_name)
  - Practitioner dropdown (filtered by service item, can be null)
  - Billing scenario dropdown (filtered by practitioner + service item)
  - Or "其他" scenario option (custom amount/revenue_share)
  - **Validation**: Enforce revenue_share <= amount
- Add other service button:
  - Same as add item, but can select any service item
- Add other item button:
  - Custom name input
  - Practitioner dropdown (all practitioners, can be null)
  - Only "其他" billing scenario (custom amount/revenue_share)
  - **Validation**: Enforce revenue_share <= amount
- Display:
  - List of items with remove button
  - Subtotal: Receipt amount (clearly labeled "收據金額")
  - Subtotal: Revenue share (clearly labeled "分潤 (內部)" with visual distinction)
- Checkout button: Process and show confirmation
- **Client-side validation**: Validate revenue_share <= amount before submission

**After Checkout (Receipt Active):**
- Show: 檢視收據 button
- Hide: 編輯, 刪除, 結帳 buttons
- **Note**: Appointment has an active (non-voided) receipt

**After Receipt Voided:**
- Show: 檢視收據 button (shows voided receipt with voided status)
- Show: 重新開立收據 button (Re-issue Receipt) - allows creating new receipt
- Hide: 編輯, 刪除 buttons (appointment cannot be edited/deleted if it has any receipt, voided or not)
  - **Rationale**: Receipts are legal documents; appointments with receipts should not be modified/deleted to maintain audit integrity
  - **Database Constraint**: `ON DELETE RESTRICT` prevents appointment deletion if receipts exist
- **Note**: Appointment has a voided receipt; new receipt can be created via re-issue

**Receipt View Modal:**
- Display receipt details (from immutable snapshot):
  - Receipt number (收據編號)
  - Visit date (看診日期) - appointment date/time
  - Issue date (開立日期) - receipt creation timestamp
  - **Voided Status Banner** (if voided):
    - Prominent visual indicator: "已作廢" (VOIDED) in red/warning color
    - Voided date (作廢日期): When receipt was voided
    - Voided by (作廢者): User who voided the receipt
    - Void reason (作廢原因): Optional reason if provided
    - **Visual Design**: Clear, prominent banner at top of receipt to prevent confusion
  - Clinic information:
    - Clinic display name (診所名稱) - from `clinic.display_name`
  - Patient information:
    - Patient name (病患姓名)
  - Items list:
    - Item name (receipt_name for service items)
    - Practitioner (if applicable)
    - Amount
  - Total amount (總費用)
  - Payment method (付款方式)
  - Custom notes (收據備註) - if clinic has custom notes configured (address, phone, tax ID, etc.)
  - Stamp (印章) - if enabled in settings at receipt creation time:
    - Display clinic display name and issue date in stamp format
    - Styled as a stamp/chop (印章) visual element
    - Uses `clinic.display_name` and `issue_date` from snapshot (immutable)
  - Issue date (開立日期) - from `issue_date` in receipt
  - Checked out by (開立收據者) - from `checked_out_by` in snapshot
- **Note**: All data displayed from immutable snapshot - reflects state at receipt creation time
- **Custom Notes**: Displayed at the bottom of receipt if present in snapshot
- **Stamp**: Displayed if `stamp.enabled` is true in snapshot (based on setting at creation time)
- **Action Buttons**:
  - **Download PDF Button** (always available):
    - Button: "下載收據" (Download Receipt)
    - Triggers download of receipt as PDF
    - Uses `/api/receipts/{receipt_id}/download` endpoint
    - Downloads file with name: `receipt_{receipt_number}.pdf`
    - PDF contains all receipt information in printable format
    - **Note**: PDF will clearly show voided status if receipt is voided
  - **Void Receipt Button** (only if receipt is NOT voided, admin-only):
    - Button: "作廢收據" (Void Receipt)
    - Opens confirmation dialog:
      - Title: "確認作廢收據" (Confirm Void Receipt)
      - Message: "確定要作廢此收據嗎？此操作無法復原。作廢後可以重新開立新收據。" (Are you sure you want to void this receipt? This action cannot be undone. After voiding, you can re-issue a new receipt.)
      - Optional reason field: "作廢原因" (Reason for voiding) - text input, optional
      - Buttons: "取消" (Cancel), "確認作廢" (Confirm Void)
    - On confirmation:
      - Calls `POST /api/receipts/{receipt_id}/void` with reason (if provided)
      - Closes receipt view modal
      - Updates appointment modal to show "重新開立收據" button
      - Shows success notification: "收據已作廢" (Receipt voided)

### 3. Receipt Re-issuing

**Re-issue Receipt Flow:**
- **Trigger**: User clicks "重新開立收據" (Re-issue Receipt) button in appointment modal (shown when receipt is voided)
- **Behavior**: Opens checkout modal (same as initial checkout)
  - User can add/modify billing items
  - Creates new receipt with new receipt number (sequential, next in sequence)
  - Original voided receipt remains in database (preserves audit trail)
  - New receipt is independent of voided receipt
- **After Re-issuing**:
  - Appointment modal shows "檢視收據" button (for new active receipt)
  - "重新開立收據" button is hidden (receipt is now active)
  - User can view both receipts:
    - Current active receipt via "檢視收據" button
    - Voided receipt via accounting dashboard or receipt history (future enhancement)

**Multiple Receipts per Appointment:**
- An appointment can have multiple receipts in its history:
  - One active receipt (most recent, not voided)
  - Zero or more voided receipts (historical records)
- Appointment modal always shows the active receipt (if exists)
- Voided receipts are accessible via accounting dashboard for audit purposes

### 4. LIFF Changes

**Service Item Display:**
- Show `description` field when available
- Show duration as `duration_minutes` (not including buffer)
- Filter out service items where `allow_patient_booking = false`

**Scheduling:**
- Use `duration_minutes + scheduling_buffer_minutes` for calendar slot calculation
- Display only `duration_minutes` to patient

### 5. Profile Page Changes

**Remove Practitioner Appointment Types Section:**
- Remove `PractitionerAppointmentTypes` component from profile page
- This functionality moves to service item settings (admin-only)

### 6. Accounting Dashboard Frontend

**Accounting Dashboard Page**

**Location:** New page at `/accounting` (or `/dashboard/accounting`)

**Access Control:** Admin-only (hide from navigation for non-admins)

**Layout:**

1. **Date Range Selector**
   - Start date picker
   - End date picker
   - Default: Current month (first day to last day)
   - Apply button to refresh data

2. **Summary Cards**
   - Total Revenue (總收入)
   - Total Revenue Share (總抽成)
   - Receipt Count (收據數量)
   - Voided Receipt Count (已作廢收據數量) - if any

3. **By Practitioner Table**
   - Columns: Practitioner Name, Total Revenue, Total Revenue Share, Receipt Count
   - Sortable columns
   - Click practitioner name to view details

4. **By Service Item Table**
   - Columns: Service Item Name, Receipt Name, Total Revenue, Total Revenue Share, Receipt Count
   - Sortable columns

5. **Voided Receipts Section** (if any voided receipts in date range)
   - Separate section showing voided receipts
   - Columns: Receipt Number, Issue Date, Patient Name, Total Amount, Voided Date, Voided By, Reason
   - Clearly marked as "已作廢" (VOIDED) with visual distinction
   - Purpose: Audit trail visibility
   - **Note**: Voided receipts are excluded from all revenue calculations but visible for audit purposes

6. **Practitioner Details Modal**
   - Triggered by clicking practitioner name
   - Shows:
     - Practitioner summary (total revenue, revenue share, receipt count)
     - Breakdown by service item (table)
     - Individual receipt items (expandable list):
       - Receipt number, date, patient name
       - Service item, billing scenario
       - Amount, revenue share
     - Purpose: Audit billing scenario selection

**UI Components:**
- Use existing table components from codebase
- Date picker component (reuse from calendar)
- Loading states during data fetch
- Error handling for API failures

**Data Flow:**
1. User selects date range
2. Click "Apply" or auto-fetch on date change
3. Fetch summary data from `/api/accounting/summary`
4. Display summary cards and tables
5. On practitioner click, fetch details from `/api/accounting/practitioner/{id}/details`
6. Display details in modal

**Query Implementation:**

PostgreSQL JSONB aggregation example:
```sql
-- Aggregate revenue by practitioner
SELECT 
  jsonb_array_elements(receipt_data->'items') AS item,
  (jsonb_array_elements(receipt_data->'items')->>'practitioner')::jsonb->>'id' AS practitioner_id,
  (jsonb_array_elements(receipt_data->'items')->>'practitioner')::jsonb->>'name' AS practitioner_name,
  (jsonb_array_elements(receipt_data->'items')->>'amount')::decimal AS amount,
  (jsonb_array_elements(receipt_data->'items')->>'revenue_share')::decimal AS revenue_share
FROM receipts
WHERE clinic_id = :clinic_id
  AND is_voided = false
  AND issue_date >= :start_date
  AND issue_date <= :end_date
  AND jsonb_array_elements(receipt_data->'items')->>'practitioner' IS NOT NULL;
```

**Performance Considerations:**
- Use GIN index on `receipt_data` for JSONB queries
- Consider materialized views for frequently accessed aggregations
- Cache summary data for current month (refresh on new receipts)
- Limit date range queries (e.g., max 1 year at a time)

**Business Logic:**

1. **Voided Receipt Exclusion:**
   - All accounting queries filter `is_voided = false`
   - Voided receipts are excluded from all calculations
   - Voided receipt count shown separately for transparency

2. **Revenue Share Calculation:**
   - Sum of `revenue_share` from all items in receipts
   - Per-practitioner: Sum of items where `practitioner.id` matches
   - Per-service-item: Sum of items where `service_item.id` matches

3. **Billing Scenario Audit:**
   - Details view shows which billing scenario was selected for each item
   - Allows admin to verify practitioners are using correct scenarios
   - Shows scenario name from snapshot (immutable)

4. **Date Range Validation:**
   - Start date must be <= end date
   - Maximum range: 1 year (to prevent performance issues)
   - Default to current month if not specified

## Business Logic

### 1. Service Item Duration Display

**Internal (Admin Platform):**
- Display: `{duration_minutes}分 (+{scheduling_buffer_minutes}分)` if buffer > 0
- Display: `{duration_minutes}分` if buffer = 0

**LIFF (Patient):**
- Display: `{duration_minutes}分` (never show buffer)
- Scheduling uses: `duration_minutes + scheduling_buffer_minutes`

### 2. Billing Scenario Defaults

- First scenario created for a practitioner-service combination is default
- Only one default per practitioner-service combination
- When default is deleted, next scenario becomes default (or none if empty)

### 3. Checkout Validation

- At least one item required
- All items must have amount > 0
  - **Note**: This prevents checkout with default/migrated billing scenarios that have amount=0, enforcing admin configuration
- All items must have revenue_share >= 0
- **Business Rule**: `revenue_share <= amount` for all items (revenue share cannot exceed amount charged)
- Appointment must exist and not be cancelled
- Appointment must not already have an active (non-voided) receipt
  - **Note**: Voided receipts are allowed; only active receipts prevent new checkout
- Payment method must be provided and valid (one of: "cash", "card", "transfer", "other")

### 4. Billing Scenario Validation

- **Business Rule**: `revenue_share <= amount` (revenue share cannot exceed amount charged)
- Amount must be > 0
- Revenue share must be >= 0
- Scenario name is required and must be unique per practitioner-service combination (excluding deleted)

### 5. Receipt Voiding and Re-issuing

**Voiding Rules:**
- Only admins can void receipts
- Voiding is irreversible (maintains audit integrity)
- Voided receipts keep their original receipt number (gapless sequencing)
- Voided receipts are excluded from all accounting calculations
- Voided receipts remain visible for audit purposes (shown in separate section in accounting dashboard)
- **Time Limits**: No time limit currently enforced (future enhancement: consider configurable time limit with admin override)

**Re-issuing Rules:**
- After voiding, appointment becomes available for re-checkout
- New receipt gets new sequential receipt number (independent of voided receipt)
- Multiple receipts can exist for same appointment (one active, others voided)
- Appointment modal always shows active receipt (if exists)
- Voided receipts accessible via accounting dashboard
- **Note**: Re-issuing (補發) for lost receipts is left for future work

**Appointment Modal State Logic:**
1. **No receipt**: Show 編輯, 刪除, 結帳 buttons
2. **Active receipt**: Show 檢視收據 button, hide 編輯, 刪除, 結帳
3. **Voided receipt (no active)**: Show 檢視收據 (shows voided), 重新開立收據 buttons, hide 編輯, 刪除
4. **Active + voided receipts**: Show 檢視收據 (shows active), hide 編輯, 刪除, 結帳

**Payment Restrictions:**
- **No partial payments**: Each appointment must have exactly one receipt (full payment only)
- **No multiple receipts per appointment**: Only one active receipt allowed per appointment
- **Future enhancement**: Consider supporting partial payments and multiple receipts per appointment if needed

### 6. Receipt Immutability

**Legal Requirements (Taiwan):**
- **Commercial Accounting Act**: Alterations or destruction of accounting records is strictly prohibited
- **Medical Care Act**: Medical records (including receipts) must be retained for at least 7 years
- **Electronic Data Processing**: Original and previous data versions must be preserved; audit trails required

**Implementation:**
- Receipts are **never modified** after creation (immutable)
- Complete snapshot stored in `receipt_data` JSONB column at creation time
- All referenced data (patient name, clinic name, service names, etc.) stored as snapshots
- No dependency on foreign keys that can change
- **Database Enforcement**: PostgreSQL trigger prevents modifications to `receipt_data` after creation
  - Only voiding-related fields (`is_voided`, `voided_at`, `voided_by_user_id`) can be updated
  - Attempts to modify `receipt_data` will raise database exception
- **Voiding**: If correction needed, receipt can be voided (sets `is_voided = true`, preserves all data for audit)
- Voided receipts remain in database but are excluded from accounting calculations
- Receipt deletion should be restricted (admin-only, with audit trail)
- **Retention**: Minimum 10 years (Physical Therapists Act Article 25 for physical therapy clinics), consider archival system for receipts >10 years old

**Snapshot Pattern:**
- Stores all data as it existed at receipt creation time
- Ensures receipt remains accurate even if:
  - Patient name changes
  - Clinic name/address changes
  - Service item names change
  - Practitioner names change
  - Receipt settings change (stamp enabled/disabled, custom notes)
  - Any other referenced data changes
- Stamp data (clinic name and checkout date) is captured at creation time and remains immutable

## Data Migration

### 1. Existing Appointment Types

```sql
-- Add new columns with defaults
UPDATE appointment_types 
SET receipt_name = name,
    allow_patient_booking = TRUE,
    scheduling_buffer_minutes = 0
WHERE receipt_name IS NULL;
```

### 2. Existing Practitioner-AppointmentType Mappings

- Keep existing `practitioner_appointment_types` records
- Create default billing scenario for each:
  - Name: "原價" (or "Default")
  - Amount: 0 (to be set by admin - required before checkout can be used)
  - Revenue share: 0 (to be set by admin - required before checkout can be used)
  - Mark as default (`is_default = true`)
- **Rationale**: Ensures all practitioner-service combinations have at least one billing scenario, but admins must configure actual pricing before checkout can be used
- **Validation**: Checkout will fail if amount is 0 (enforces admin configuration)

### 3. Receipt Settings

- Add `receipt_settings` to clinic settings JSONB with default structure:
  ```json
  {
    "receipt_settings": {
      "custom_notes": null,
      "show_stamp": false
    }
  }
  ```
- Existing clinics: Initialize with `custom_notes: null`, `show_stamp: false`

### 4. Receipt Number Sequence

- Create sequence per clinic per year for receipt numbers
- Format: `{YYYY}-{NNNNN}` (5 digits for serial number, supports up to 99,999 receipts per year per clinic)
- Initialize sequence for current year
- Use PostgreSQL sequences for thread-safe atomic number generation
- Example: `CREATE SEQUENCE receipt_number_seq_clinic_1_2024 START 1;`
- **Note**: Voided receipts keep their original number; sequence never skips (gapless sequencing for audit compliance)

## Implementation Phases

### Phase 1: Database & Models ✅ DONE
1. ✅ Create database migrations
2. ✅ Add database trigger for receipt_data immutability enforcement
3. ✅ Update SQLAlchemy models
4. ✅ Update Pydantic schemas

### Phase 2: Backend API ✅ DONE
1. ✅ Update service item endpoints
2. ✅ Create billing scenario endpoints
3. ✅ Create checkout/receipt endpoints
   - ✅ Add concurrent checkout protection (row-level locking)
   - ✅ Include visit_date in receipt snapshot
4. ✅ Update appointment queries to include receipt status
5. ✅ Add receipt settings to clinic settings API
6. ✅ Implement receipt PDF generation endpoint
   - ✅ Include both visit_date and issue_date in PDF

### Phase 3: Frontend Settings ✅ DONE
1. ✅ Restructure settings page
2. ✅ Add service item fields
3. ✅ Move practitioner assignment to service items
4. ✅ Add billing scenario management
5. ✅ Add receipt settings section (custom notes)

### Phase 4: Checkout Flow ✅ DONE
1. ✅ Add checkout button to appointment modal
2. ✅ Create checkout modal UI
3. ✅ Implement checkout API integration
4. ✅ Add receipt view modal
5. ✅ Add PDF download functionality to receipt view
6. ✅ Add receipt voiding functionality (void button, confirmation dialog)
7. ✅ Add re-issue receipt functionality (重新開立收據 button)
8. ✅ Update appointment modal state logic (handle voided receipts)

### Phase 5: LIFF Updates ✅ DONE
1. ✅ Filter service items by `allow_patient_booking`
2. ✅ Update duration display
3. ✅ Use buffer for scheduling

### Phase 6: Profile Page Cleanup ✅ DONE
1. ✅ Remove practitioner appointment types from profile
2. ✅ Update permissions (admin-only for service item management)

### Phase 7: Accounting Dashboard ✅ DONE
1. ✅ Create accounting API endpoints
2. ✅ Implement JSONB aggregation queries
3. ✅ Build accounting dashboard frontend
4. ✅ Add voided receipts section to dashboard (separate from revenue calculations)
5. ✅ Add receipt voiding functionality
6. ✅ Add monitoring for receipt number sequence limits

## Access Control Summary

### Billing Scenarios Visibility
- **Admin users**: Can view and manage all billing scenarios for all practitioners
- **Non-admin practitioners**: Cannot view billing scenarios in settings (even their own)
- **Rationale**: Billing scenarios contain sensitive financial information (分潤) that should remain internal to clinic administration

### Checkout Access
- **Admin users only**: Only admins can perform checkout operations
- **Non-admin users**: Cannot access checkout functionality

### Service Item Management
- **Admin users only**: Only admins can manage service items, practitioner assignments, and billing scenarios
- **Non-admin practitioners**: Cannot modify service item settings

### Receipt Settings
- **Admin users only**: Only admins can configure receipt settings (custom notes)
- **Non-admin users**: Cannot view or modify receipt settings

### Accounting Dashboard
- **Admin users only**: Only admins can access accounting dashboard
- **Non-admin users**: Cannot view accounting data or void receipts

## Receipt Number Generation

**Format**: `{YYYY}-{NNNNN}` (e.g., "2024-00001")

**Industry Best Practices:**
- Sequential numbering is required for audit compliance (Taiwan tax regulations)
- Year-prefixed format facilitates chronological organization and year-based auditing
- Annual reset prevents extremely long numbers and provides clear fiscal year boundaries
- **Gapless sequencing**: Voided receipts keep their original number; sequence never skips numbers
- Leading zeros maintain consistent formatting (00001, 00002, 00003)

**Implementation:**
- Sequential per clinic per year
- Auto-increment within year using database sequence or atomic counter
- Reset to 00001 at start of each year
- Unique constraint: `(clinic_id, receipt_number)`
- **Thread-safe**: Use database sequences or row-level locking to prevent duplicate numbers in multi-user environment

**Generation Logic:**
1. Get current year
2. Use PostgreSQL sequence or atomic counter for clinic + year
3. Increment sequence number atomically
4. Format as `{YYYY}-{NNNNN}` with zero-padding (5 digits)

**Voided Receipts:**
- Voided receipts **keep their original receipt number**
- Sequence continues without gaps: 2024-00001, 2024-00002 (voided), 2024-00003, etc.
- Gaps in sequence would raise audit concerns (suggest missing documents)
- Voided status is tracked via `is_voided` flag, not by number reuse

**Database Sequence Example:**
```sql
-- Create sequence per clinic per year
CREATE SEQUENCE receipt_number_seq_clinic_1_2024 START 1;

-- Generate next number
SELECT EXTRACT(YEAR FROM NOW()) || '-' || 
       LPAD(nextval('receipt_number_seq_clinic_1_2024')::text, 5, '0');
```

## Edge Cases and Special Considerations

### 1. Appointment Deletion with Receipts
- **Constraint**: `ON DELETE RESTRICT` on `appointment_id` foreign key
- **Behavior**: Appointments with receipts (voided or active) cannot be deleted
- **Rationale**: Receipts are legal documents requiring 7+ year retention; deleting appointments would violate audit requirements
- **User Action**: If deletion needed, receipts must be voided first (but voided receipts still prevent deletion to maintain audit trail)
- **Alternative**: Consider soft-deleting appointments instead of hard deletion

### 2. Receipt Number Sequence Exhaustion
- **Current Limit**: 99,999 receipts per clinic per year (5-digit serial number)
- **Edge Case**: If a clinic generates >99,999 receipts in a year, sequence will fail
- **Mitigation**: 
  - Monitor receipt count and alert admin when approaching limit (e.g., >90,000)
  - Future enhancement: Support 6+ digits or alternative numbering scheme
  - Consider: Very large clinics may need higher capacity

### 3. Year Transition During Checkout
- **Scenario**: Checkout initiated in one year, completed in next year
- **Behavior**: Receipt number uses year from `issue_date` (current timestamp when receipt is created)
- **Result**: Receipt number reflects actual issue date, not appointment date
- **Rationale**: Receipts are issued at checkout time, not appointment time
- **Implementation**: Use `EXTRACT(YEAR FROM NOW())` when generating receipt number (atomic operation)
- **Edge Case**: If checkout occurs at exactly midnight on New Year's Eve, receipt number will use the new year (correct behavior)

### 4. Deleted Practitioner/Service Item in Historical Receipts
- **Scenario**: Practitioner or service item is deleted after receipt creation
- **Behavior**: Historical receipts remain intact (data stored in immutable snapshot)
- **Display**: Receipts show practitioner/service name from snapshot, even if entity is deleted
- **Rationale**: Immutability ensures receipts remain accurate regardless of data changes

### 5. Multiple Active Receipts Prevention
- **Database Constraint**: `UNIQUE(appointment_id) WHERE is_voided = FALSE`
- **Behavior**: Only one active (non-voided) receipt allowed per appointment
- **Multiple Voided Receipts**: Allowed for audit trail (e.g., multiple corrections)
- **Validation**: API enforces this constraint; returns 400 if active receipt exists
- **Concurrent Checkout Protection**: 
  - Use `SELECT ... FOR UPDATE` to lock appointment row during checkout
  - Prevents race condition when multiple admins attempt checkout simultaneously
  - Returns 409 Conflict if another user is currently processing checkout

### 6. Payment Method Validation
- **Valid Values**: `"cash"`, `"card"`, `"transfer"`, `"other"`
- **Required**: Payment method must be provided in checkout request
- **Storage**: Stored in receipt snapshot (immutable)
- **Future Enhancement**: Could add more granular payment tracking (card type, transaction ID, etc.)

### 7. Receipt Deletion Policy
- **Current Design**: Receipts are never deleted (immutability requirement)
- **Legal Requirement**: 10-year minimum retention (Physical Therapists Act Article 25 for physical therapy clinics)
- **Database**: `ON DELETE RESTRICT` prevents cascade deletion
- **Voiding**: Only way to "remove" receipt from active use (voided receipts remain in database)
- **Future Enhancement**: Consider archival system for receipts >10 years old (move to cheaper storage tier while maintaining access)

### 8. Refunds and Negative Amounts
- **Current Design**: Not supported (no partial payments, no refunds)
- **Future Enhancement**: If refunds are needed:
  - Option 1: Create separate refund receipt linked to original receipt
  - Option 2: Void original receipt and create new receipt with negative amount (if legally allowed)
  - Option 3: Create separate refund transaction type
  - **Recommendation**: Verify with legal counsel on refund receipt requirements in Taiwan
  - **Note**: Refunds are left for future work

## Open Questions

1. **Receipt Modification**: ✅ Resolved - Receipts are immutable. If correction needed, void the receipt and create a new one (re-issue). This maintains audit trail while allowing corrections.
2. **Receipt Deletion**: ✅ Resolved - Receipts are never deleted (immutability + 7+ year retention requirement). Use voiding instead. Consider archival for old receipts.
3. **Default Billing Scenarios**: ✅ Resolved - Create default scenarios with amount=0 and revenue_share=0 during migration. Admins must configure actual pricing before checkout can be used. Checkout validation enforces amount > 0.
4. **Receipt Export**: ✅ Implemented - PDF download functionality (see Receipt View Modal section)
5. **Receipt Voiding**: ✅ Resolved - Use separate `is_voided` boolean field for efficient querying
6. **Appointment Deletion with Receipts**: ✅ Resolved - Use `ON DELETE RESTRICT` to prevent deletion. Consider soft-delete for appointments.

## Future Enhancements

1. **Receipt Download**: ✅ Implemented - PDF download with formatted receipt layout
2. **Receipt Templates**: Customizable receipt formatting per clinic
3. **Payment Methods**: Enhanced tracking (cash, card, transfer, etc.)
4. **Receipt History**: View all receipts for a patient with search/filter
5. **Billing Reports**: ✅ Implemented - Accounting dashboard with revenue analytics
6. **Receipt Voiding**: ✅ Implemented - Voiding with audit trail, confirmation dialog, and reason capture (see Receipt View Modal section)
7. **Receipt Re-issuing**: ✅ Implemented - After voiding, new receipt can be created with new sequential number (see Receipt Re-issuing section)
8. **Receipt Correction**: ✅ Resolved - Void original receipt and create new one (re-issue) to maintain audit trail
9. **Receipt Reissuing (補發)**: Support for reissuing lost receipts (separate from voiding for errors)
10. **Receipt Audit Log**: Detailed audit log table for all receipt operations (create, view, download, void, reissue)
11. **Receipt Search/Filtering**: Search functionality for receipts by patient name, receipt number, date range
12. **Receipt Export**: CSV/Excel export for accounting software integration
13. **Receipt Voiding Time Limits**: Configurable time limit for voiding (e.g., 30 days) with admin override
14. **Partial Payments**: Support for multiple receipts per appointment (installments)
15. **Refunds**: Support for refund receipts or negative amounts



