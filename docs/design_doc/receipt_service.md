# Receipt Generation Service Design Document

## Overview

This document describes the design for a receipt generation service that allows clinic users to generate receipts for appointments after checkout. Patients can view and download receipts via LIFF, and clinic users can manage receipts through the clinic dashboard.

## Taiwan Legal Requirements

### Physical Therapy Act (物理治療師法)
- **Article 27**: Physical therapy clinics must provide fee statements and receipts (收費明細表及收據) when collecting fees
- **Article 25**: Physical therapy records must be preserved for at least 10 years

### Receipt Types
- **Original Receipt (正本)**: First-issued receipt for a transaction
- **Reissued Receipt (補發)**: Replacement receipt when original is lost
  - Must be clearly marked as "補發" (reissue)
  - Should include "與正本相符" (matches original) notation
  - Original receipt should be marked as invalid if reissued

### Receipt Lifecycle
1. **Creation**: Receipt created when appointment is checked out
2. **Invalidation (作廢)**: Receipt can be voided if errors occur
   - Must be clearly marked (e.g., "X" or "Annulled")
   - Cannot be deleted, only invalidated
   - Audit trail must be maintained
3. **Reissue (補發)**: Original can be reissued if lost
   - Original must be marked as invalid
   - New receipt clearly labeled as reissue
   - Both receipts must be preserved for audit

### Audit Requirements
- All receipt operations must be logged with:
  - Timestamp
  - User who performed the action
  - Reason (for invalidation/reissue)
- Receipts must be preserved for at least 10 years
- Original receipts cannot be deleted, only invalidated

## Data Model

### Receipt Table
```python
class Receipt(Base):
    id: int (PK)
    appointment_id: int (FK to appointments)
    clinic_id: int (FK to clinics)
    patient_id: int (FK to patients)
    
    # Receipt metadata
    receipt_number: str (unique per clinic, e.g., "R-2024-001")
    receipt_type: str ("original" | "reissue")
    original_receipt_id: int? (FK to receipts, if this is a reissue)
    
    # Financial information
    total_amount: Decimal
    payment_method: str ("cash" | "card" | "transfer" | "other")
    payment_date: datetime
    
    # Receipt items (JSONB)
    items: List[ReceiptItem]  # Service name, quantity, unit price, subtotal
    
    # Status
    status: str ("active" | "voided" | "reissued")
    voided_at: datetime?
    voided_by_user_id: int? (FK to users)
    void_reason: str?
    
    # Audit fields
    created_at: datetime
    created_by_user_id: int (FK to users)
    updated_at: datetime
    
    # PDF storage (optional - see PDF Generation Strategy below)
    pdf_url: str? (path to generated PDF, if storing PDFs)
    pdf_generated_at: datetime?
```

### Receipt Item Structure
```python
class ReceiptItem(BaseModel):
    service_name: str  # From appointment_type.name
    quantity: int (default: 1)
    unit_price: Decimal
    subtotal: Decimal
    description: str? (optional notes)
```

## Business Logic

### Receipt Creation Flow

1. **Checkout Trigger**
   - Clinic user clicks "Checkout" on an appointment
   - System validates:
     - Appointment exists and is confirmed
     - Appointment hasn't been checked out already
     - User has permission to create receipts

2. **Receipt Generation**
   - Generate unique receipt number: `R-{YYYY}-{NNNN}` (e.g., "R-2024-0001")
   - Create receipt record with:
     - `receipt_type: "original"`
     - `status: "active"`
     - Items from appointment (appointment type, quantity, price)
     - Payment method (default: "cash" for now)
     - Payment date = current timestamp
   - Generate PDF receipt (see PDF Generation Strategy)
   - Store PDF URL (if storing PDFs) or mark as ready for on-demand generation

3. **Receipt Numbering**
   - Sequential per clinic per year
   - Format: `R-{YYYY}-{NNNN}`
   - Reset counter at start of each year
   - Must be unique per clinic

### Receipt Invalidation (作廢)

**When**: Receipt has errors or needs to be voided

**Process**:
1. Validate: Receipt is active (not already voided/reissued)
2. Mark receipt as `status: "voided"`
3. Set `voided_at`, `voided_by_user_id`, `void_reason`
4. Generate audit log entry
5. Original receipt remains in database (not deleted)
6. If needed, create new receipt with corrected information

**Restrictions**:
- Cannot void receipt that has been reissued
- Cannot void receipt after certain time period (configurable, e.g., 30 days)
- Requires admin role or special permission

### Receipt Reissue (補發)

**When**: Patient loses original receipt and requests replacement

**Process**:
1. Validate: Original receipt exists and is active
2. Mark original receipt as `status: "reissued"`
3. Create new receipt with:
   - `receipt_type: "reissue"`
   - `original_receipt_id: <original_receipt.id>`
   - Same financial information as original
   - Receipt number: `R-{YYYY}-{NNNN}-補`
4. Generate PDF with "補發" watermark/notation (see PDF Generation Strategy)
5. Both receipts remain in database for audit

**Display**:
- Reissued receipts clearly show "補發" (Reissue) label
- Original receipt shows "已補發" (Reissued) status
- Both receipts link to each other

### Receipt Viewing

**Clinic Dashboard**:
- List all receipts (filterable by date, patient, status)
- View receipt details
- Download PDF
- Invalidate receipt (with reason)
- Reissue receipt

**LIFF (Patient View)**:
- List patient's own receipts
- Filter by date range
- View receipt details
- Download PDF
- Request reissue (creates request, clinic user approves)

## API Endpoints

### Clinic Dashboard APIs

```
POST /api/clinic/receipts
  - Create receipt for appointment
  - Body: { appointment_id, payment_method, items? }

GET /api/clinic/receipts
  - List receipts (with filters: date_range, patient_id, status)
  
GET /api/clinic/receipts/{receipt_id}
  - Get receipt details
  
GET /api/clinic/receipts/{receipt_id}/pdf
  - Download receipt PDF
  
POST /api/clinic/receipts/{receipt_id}/void
  - Invalidate receipt
  - Body: { reason }
  
POST /api/clinic/receipts/{receipt_id}/reissue
  - Reissue receipt
  - Body: { reason? }
```

### LIFF APIs

```
GET /api/liff/receipts
  - List patient's receipts (with filters: date_range)
  
GET /api/liff/receipts/{receipt_id}
  - Get receipt details
  
GET /api/liff/receipts/{receipt_id}/pdf
  - Download receipt PDF
  
POST /api/liff/receipts/{receipt_id}/reissue-request
  - Request reissue (creates pending request)
```

## PDF Generation Strategy

### Option 1: Store PDFs (Recommended)

**Approach**: Generate PDF when receipt is created and store it (e.g., S3, local filesystem, or database as blob).

**Pros**:
- **Audit compliance**: Preserves exact document issued at time of creation (immutable)
- **Performance**: Fast retrieval, no generation delay
- **Data integrity**: If receipt data changes later (e.g., patient name correction), original PDF remains unchanged
- **Consistency**: Same PDF every time, even if template changes
- **Offline access**: PDFs can be backed up separately

**Cons**:
- Storage costs (minimal for PDFs, ~50-200KB each)
- Storage management complexity
- Need to handle storage failures

**Recommendation**: **Use this approach** for compliance and audit requirements.

### Option 2: Generate On-Demand

**Approach**: Generate PDF from receipt data when user requests it.

**Pros**:
- No storage costs
- Simpler architecture (no storage layer)
- Always reflects current receipt data

**Cons**:
- **Audit risk**: If receipt data changes, PDF changes (violates immutability principle)
- Performance: Generation delay on each request (100-500ms)
- CPU usage: More server load for frequent access
- Template changes: Old receipts would render with new template

**Recommendation**: Only use if storage is a major constraint and you can guarantee receipt data immutability.

### Hybrid Approach

Generate and cache PDF on first access, then serve cached version:
- Generate on first download request
- Store in cache (Redis, filesystem, or object storage)
- Serve cached version for subsequent requests
- Still maintains immutability if receipt data is locked after creation

### Implementation Recommendation

**For Phase 1**: Start with on-demand generation for simplicity, but design receipt data model to be immutable after creation.

**For Production**: Migrate to stored PDFs for audit compliance:
- Generate PDF immediately after receipt creation
- Store in object storage (S3, GCS) or filesystem
- Store URL/path in `pdf_url` field
- If PDF generation fails, receipt creation still succeeds (PDF can be generated later)

**Data Immutability**: Regardless of approach, receipt data should be immutable after creation:
- Lock receipt fields after creation (no updates to amount, items, patient_id)
- Only allow status changes (voided, reissued)
- This ensures on-demand generation produces consistent results

## Receipt PDF Format

### Required Information
- Clinic name and information (address, phone)
- Receipt number (with "補發" notation if reissue)
- Issue date
- Patient information (name, phone)
- Service items (name, quantity, unit price, subtotal)
- Total amount
- Payment method
- "與正本相符" stamp if reissue
- Clinic seal/stamp area (for printing)

### Design Considerations
- Professional, clean layout
- Print-friendly (A4 size)
- Include QR code for verification (optional)
- Watermark for reissued receipts

## Permissions

### Clinic Users
- **Admin/Practitioner**: Create, view, download, invalidate, reissue receipts
- **View-only role**: View and download receipts only

### Patients (LIFF)
- View own receipts only
- Download own receipts
- Request reissue (requires clinic approval)

## Audit Trail

All receipt operations must log:
- Action type (create, void, reissue, view, download)
- User ID and user type
- Timestamp
- Receipt ID
- Reason (for void/reissue)
- IP address (optional, for security)

Store in separate `receipt_audit_log` table or append-only log.

## Implementation Phases

### Phase 1: Basic Receipt Creation
- Receipt model and database migration
- Receipt creation API
- Basic PDF generation
- Receipt listing and viewing

### Phase 2: Receipt Management
- Receipt invalidation
- Receipt reissue
- Receipt number management
- Enhanced PDF with reissue notation

### Phase 3: Patient Access
- LIFF receipt viewing
- LIFF receipt download
- Reissue request flow

### Phase 4: Advanced Features
- Receipt templates customization
- QR code verification
- Receipt search and filtering
- Receipt export (CSV/Excel)

## Security Considerations

- Receipt numbers must be sequential and non-guessable
- PDFs should include tamper-evident features
- Receipt invalidation requires audit logging
- Patients can only access their own receipts
- Rate limiting on PDF generation (if on-demand)
- Receipt data immutability after creation (lock financial fields)
- Receipt data encryption at rest (if storing sensitive info)

## Future Enhancements

- Integration with accounting systems
- Multiple payment methods (card, transfer)
- Receipt email delivery
- Receipt templates per clinic
- Batch receipt generation
- Receipt statistics and reporting
- Integration with tax reporting systems
