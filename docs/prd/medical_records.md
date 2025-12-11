# Medical Records Feature - Product Requirements Document

## Executive Summary

This PRD defines requirements for a comprehensive medical records system that enables physical therapy clinics to create, manage, and maintain digital medical records for patient visits. The system will support both text-based and drawing-based workflows, allowing clinics to transition from their current Notability-based workflow while maintaining essential drawing capabilities.

**Key Goals:**
- Enable clinics to create customizable medical record templates
- Support both form-based and drawing-based record creation
- Provide seamless cross-device editing experience
- Enable PDF export with proper text rendering (Chinese and English as text, not images)
- Support pre-appointment patient data collection
- Design with future AI agent integration in mind

**MVP Scope:**
- Forms, file uploads, and drawing capabilities are all required for MVP
- Drawing quality: "Good enough" (does not need to match iPad/Apple Pencil)
- Pre-appointment forms: LINE delivery only
- Record sharing: Clinic-internal only
- Offline support: Not required for MVP
- Compliance: Not required for MVP
- **File Storage**: Files are stored at patient level (not attached to individual records)

---

## Background & Context

### Current State
- Clinics currently use **Notability on iPad with Apple Pencil** for medical records
- Workflow: Upload PDF template → Write/draw directly on PDF
- Some clinics use **Google Docs** for text-based records
- Clinics are willing to migrate to web-based solution
- Clinics want to maintain basic drawing capabilities

### User Personas

**Primary Users:**
1. **Practitioners/Therapists** - Create and edit medical records during/after appointments
2. **Clinic Administrators** - Create templates, manage clinic settings
3. **Patients** (future) - Fill pre-appointment forms

**Device Usage:**
- **Tablet** (iPad, Android tablets) - Primary device for drawing/annotation
- **Desktop** - Form filling, template creation
- **Mobile Phone** - Quick form updates, photo uploads

---

## User Stories

### US-1: Patient File Management
**As a** clinic user  
**I want to** upload files (photos, PDFs, x-rays, 診斷證明) under a patient's profile  
**So that** I can store and reference patient-related documents in one place

**Acceptance Criteria:**
- User can upload multiple file types (images, PDFs)
- Files are organized under patient profile
- User can view, download, and delete uploaded files
- Files are accessible when creating medical records

### US-2: Appointment-Based Medical Records
**As a** practitioner  
**I want to** create a medical record for a specific appointment  
**So that** I can document the visit and link it to the appointment context

**Acceptance Criteria:**
- User can create medical record from appointment detail page
- Record is automatically linked to appointment
- Record shows appointment date, patient, and practitioner information
- User can view all records for a specific appointment

### US-3: Standalone Medical Records
**As a** practitioner  
**I want to** create a medical record that is not associated with an appointment  
**So that** I can document patient information outside of scheduled visits

**Acceptance Criteria:**
- User can create medical record from patient profile page
- Record is not required to be linked to an appointment
- Record can be linked to an appointment later if needed

### US-4: Template Selection
**As a** practitioner  
**I want to** choose which template to use when creating a new medical record  
**So that** I can use the appropriate form structure for different types of visits

**Acceptance Criteria:**
- User sees list of available templates when creating record
- User can preview template structure before selection
- Default template can be set per clinic
- User can create record without template (blank form - contains only basic information header, no template structure)

### US-5: Template Creation
**As a** clinic administrator  
**I want to** create and customize medical record templates  
**So that** practitioners can use standardized forms for consistent documentation

**Acceptance Criteria:**
- User can create new template with custom name
- User can add text sections, form fields, and drawing areas
- User can arrange elements in desired order
- User can save template for reuse
- User can edit existing templates
- User can duplicate templates
- User can delete unused templates

### US-6: Form Elements in Templates
**As a** clinic administrator  
**I want to** add various form elements to templates  
**So that** practitioners can efficiently capture structured data

**Acceptance Criteria:**
- User can add text input fields
- User can add textarea (multi-line text)
- User can add dropdown/select fields with custom options
- User can add checkbox fields
- User can add radio button groups
- User can add number/date/time fields
- All fields support labels in any language (Chinese, English, or mixed)

### US-7: Drawing Areas in Templates
**As a** clinic administrator  
**I want to** add drawing areas to templates  
**So that** practitioners can annotate and draw directly in medical records

**Acceptance Criteria:**
- User can add drawing area component to template
- User can specify drawing area size (small, medium, large, or custom dimensions)
- User can embed background image in drawing area (e.g., human body anatomy)
- Drawing area supports pencil and highlighter modes
- Drawing area is tablet-friendly (isolated scrolling)

### US-8: Drawing on Medical Records
**As a** practitioner  
**I want to** draw and annotate in drawing areas  
**So that** I can visually document patient conditions and treatment plans

**Acceptance Criteria:**
- User can draw with pencil tool
- User can highlight with highlighter tool
- User can add text annotations
- User can add shapes (circles, arrows, lines)
- User can erase drawings
- User can undo/redo actions
- Drawing does not interfere with page scrolling
- Drawing works well on tablets with stylus

### US-9: Photo Upload in Drawing Areas
**As a** practitioner  
**I want to** upload photos to drawing areas and annotate on them  
**So that** I can mark up patient photos or reference images

**Acceptance Criteria:**
- User can upload photo from device (camera or gallery)
- Photo appears in drawing area
- User can draw/annotate on top of photo
- User can resize/move photo within drawing area
- User can remove photo from drawing area

### US-10: PDF Upload in Drawing Areas
**As a** practitioner  
**I want to** upload PDF files to drawing areas and annotate on them  
**So that** I can use existing PDF templates and mark them up

**Acceptance Criteria:**
- User can upload PDF file
- PDF renders in drawing area
- User can navigate between PDF pages
- User can draw/annotate on PDF pages
- Annotations are saved per page
- Annotated PDF is included when exporting the whole medical record to PDF

### US-11: Embedded Images in Templates
**As a** clinic administrator  
**I want to** embed images (e.g., human body anatomy) in drawing areas  
**So that** practitioners can annotate on standard reference images

**Acceptance Criteria:**
- User can upload image when creating template
- Image is embedded in drawing area
- Image appears as background when practitioners use template
- Practitioners can draw on top of embedded image
- Embedded image cannot be removed by practitioners (template-level)

### US-12: Tablet-Friendly Drawing
**As a** practitioner using a tablet  
**I want to** draw without accidentally scrolling the page  
**So that** I can create accurate annotations

**Acceptance Criteria:**
- Drawing gestures do not trigger page scroll
- Page scrolling is disabled when drawing mode is active
- Clear visual indication when drawing mode is active
- User can toggle between drawing and scrolling modes
- Touch/stylus input is responsive and accurate

### US-13: PDF Export
**As a** practitioner  
**I want to** export medical records to PDF  
**So that** I can share, print, or archive records

**Acceptance Criteria:**
- User can export complete medical record to PDF
- PDF includes all text content (template text, form values)
- PDF includes all form fields with values
- PDF includes all drawing areas with annotations
- PDF preserves layout and formatting
- PDF supports both English and Chinese text (no image conversion)
- PDF is searchable (text is selectable, not rasterized)
- PDF file size is reasonable for sharing

### US-14: Multi-Language Text Support
**As a** clinic user  
**I want to** use Chinese, English, or both in medical records  
**So that** I can document in the language most appropriate for each case

**Acceptance Criteria:**
- User can input text in Chinese, English, or mixed languages
- No special bilingual label requirements (users can use any language for labels)
- PDF export preserves all text correctly (Chinese and English)
- Chinese characters are rendered as text in PDF, not converted to images
- English text is rendered as text in PDF, not converted to images
- Text is searchable in exported PDFs
- System works well with Chinese, English, or mixed content

### US-15: Auto-Save
**As a** practitioner  
**I want** my medical record changes to be automatically saved  
**So that** I don't lose work if I accidentally close the page

**Acceptance Criteria:**
- Changes are saved automatically with debouncing (e.g., 2-3 seconds after last change)
- User sees visual indicator when saving/saved
- User can manually save if needed
- Draft state is preserved even if user navigates away
- Auto-save works for both form fields and drawing areas

### US-16: Cross-Device Sync
**As a** practitioner  
**I want to** edit a medical record on one device and see changes on another device  
**So that** I can start on phone and continue on tablet

**Acceptance Criteria:**
- Changes sync across devices in near real-time (within 5-10 seconds)
- User sees indicator when another device is editing
- Conflicts are resolved gracefully (last-write-wins or merge strategy)
- User can see edit history/version if needed
- Sync works for both form fields and drawing areas

### US-17: Basic Information Injection
**As a** practitioner  
**I want** basic patient and appointment information to be automatically included in medical records  
**So that** I don't have to manually enter repetitive information

**Acceptance Criteria:**
- Basic information is always automatically injected into every medical record:
  - Patient name
  - Appointment date/time (if record is linked to appointment)
  - Practitioner name
  - Clinic name
  - Current date/time (if not linked to appointment)
- Basic information is displayed at the top of the record (header section)
- Basic information is visible in template preview
- Basic information injection works for both appointment-linked and standalone records

### US-18: Pre-Appointment Patient Forms
**As a** clinic administrator  
**I want to** create patient data collection templates and send them to patients  
**So that** patients can provide information before their appointment

**Acceptance Criteria:**
- User can create "patient form" template type (separate from medical record templates)
- User can link form template to appointment types
- User can configure when to send forms (immediately, X hours before, etc.)
- System automatically sends form link via LINE when conditions are met
- User can manually send form link to patient
- Patient can fill form on mobile device
- Patient-submitted form is stored as an attachment in patient's file list
- User can view patient-submitted form from patient profile (in attachments list)
- User can view/reference patient form while editing medical records (future UX enhancement)
- **Note**: No field mapping - patient form is a reference document, not auto-filled into medical records

### US-19: Medical Record Viewing
**As a** clinic user  
**I want to** view medical records for a patient  
**So that** I can review patient history and previous visit documentation

**Acceptance Criteria:**
- User can view all records for a patient (easily accessible from patient page)
- Records are sorted by date (newest first)
- User can filter records by date range
- **Search**: Not required for MVP (can be added in future)
- User can view record details (no separate read-only mode - all users can edit)
- User can see which appointment a record is linked to (if any)
- User can see who created/edited the record
- **Record Completion Indicator**: Show indicator on appointments/calendar if record exists
- **Accessibility**: Records remain accessible indefinitely (no archiving from user perspective)

### US-20: Medical Record Editing
**As a** clinic user  
**I want to** edit existing medical records  
**So that** I can update documentation or correct errors

**Acceptance Criteria:**
- All clinic users can edit all records (no permission restrictions for MVP)
- Changes are tracked (who edited, when)
- User can see edit history
- Editing preserves all existing content
- User can add new content to existing records
- Records can be edited at any time (no draft/finalized status)
- Records persist even if linked appointment is cancelled

---

## Functional Requirements

### FR-1: Patient File Management

#### FR-1.1: File Upload
- Support file types: Images (JPEG, PNG, HEIC), PDFs
- **Image Compression**: Automatically compress images on upload (no hard size limit, but optimize for storage and performance)
- Upload progress indicator
- Multiple file selection
- Drag-and-drop upload support
- **Record Size Limits** (proposed):
  - Maximum sections per record: 50 (reasonable limit)
  - Maximum drawing strokes per drawing area: 1000 (performance consideration)
  - **Note**: Files are patient-level (not record attachments), so no file attachment limit per record
  - Maximum total record size: 50 MB (for form data and drawing data)
  - Clear error messages if limits exceeded

#### FR-1.2: File Organization
- Files organized under patient profile
- Files sorted by upload date (newest first)
- **Note**: No file categorization or tagging for MVP (can be added in future)

#### FR-1.3: File Access
- Files are stored at **patient level** (not attached to individual medical records)
- Files accessible from patient profile page
- Files accessible when creating/editing medical records (can be referenced/linked)
- Files can be linked/referenced in medical records (especially in drawing areas)
- Files can be downloaded
- Files can be deleted: **Soft delete with recovery period** (e.g., 30 days)
- **File Recovery**: Deleted files can be recovered within recovery period (30 days, fixed for MVP)
- **File Deletion Warning**: Show which records reference file before deletion
- **Permissions**: All clinic users can upload/delete files (no restrictions for MVP)
- **Patient Deletion**: If patient is deleted, medical records are preserved (for legal/audit reasons)
- **Patient Forms as Attachments**: Submitted patient forms are stored in patient's file list
- **Future UX Enhancement**: While editing medical records, users can view/reference patient attachments (including patient forms) in a side panel or overlay

### FR-2: Medical Record Templates

#### FR-2.1: Template Structure
- Template consists of ordered sections
- Each section can contain:
  - Static text (title, subtitle, paragraph)
  - Form fields (text, textarea, dropdown, checkbox, radio, number, date, time)
  - Drawing areas (with optional embedded background image)
- Sections can be reordered
- Sections can be added/removed
- System provides standard template library (initial evaluation, follow-up, progress note, etc.)
- Clinics can customize standard templates or create new ones
- **Note**: All clinic users can create templates (no permission restrictions for MVP)

#### FR-2.2: Template Elements

**Text Elements:**
- Title (large text, bold)
- Subtitle (medium text, bold)
- Paragraph (regular text)
- **Language Support**: Users can use Chinese, English, or mixed - no special bilingual requirements

**Form Fields:**
- Text input (single line)
- Textarea (multi-line)
- Dropdown/Select (single selection from options)
- Checkbox (boolean)
- Checkbox group (multiple selections)
- Radio group (single selection from options)
- Number input
- Date picker
- Time picker
- All fields support:
  - Label (users can use any language - Chinese, English, or mixed)
  - Placeholder text (users can use any language - Chinese, English, or mixed)
  - Required/optional flag (for display only, no validation enforcement in MVP)
  - **Default value**: Can be set in template, pre-filled but editable by users
  - Validation rules (basic)
- **Field Dependencies**: Not supported in MVP (no conditional show/hide based on other fields)
- **Language Support**: System works well with Chinese, English, or mixed content - no special bilingual functions needed

**Drawing Areas:**
- Size options: Small, Medium, Large, Custom (width × height)
  - **Small**: ~400×300px (suitable for small annotations)
  - **Medium**: ~800×600px (standard size for most use cases)
  - **Large**: ~1200×900px (for detailed drawings)
  - **Custom**: User-defined dimensions (with reasonable min/max limits, e.g., 200×200px to 2000×2000px)
- Optional embedded background image
- Background image uploaded during template creation
- **Background Image Locking**: Template-embedded backgrounds are locked (cannot be removed/changed by practitioners)
- **User-Uploaded Backgrounds**: Users can upload/remove background images in drawing areas when creating records
  - **Note**: One background image per drawing area at a time (uploading new one replaces existing)
- **Patient Files in Drawing**: Users can reference patient-level files as backgrounds in drawing areas
- **Note**: Patient forms do NOT have drawing areas (medical record templates only)

#### FR-2.3: Template Management
- Create new template (all clinic users can create)
- Edit existing template (all clinic users can edit)
- **Duplicate template**: Users can duplicate templates to create variations
- Delete template: **Prevent deletion if records are using it** (show count of records using template)
  - When attempting to delete, system shows count: "This template is used by X records"
  - If user wants to delete template with existing records, they must first delete or reassign all records using it
  - No "force delete" option - deletion prevention is strict to maintain data integrity
  - **Note**: For MVP, showing count is sufficient; detailed list of records can be added in future
- Set default template per clinic
- Access standard template library
- **Standard Template Usage**: Standard templates can be customized by clinics (clinic creates a copy/customized version)
- Standard templates serve as starting points - clinics can duplicate and modify them
- **Template Updates**: If system updates standard templates, clinic copies are not affected (they are independent)
- **Section Reordering**: Users can reorder sections in templates (drag-and-drop or up/down buttons)
- **Template Versioning**: When template is edited, existing records keep the old template structure (no migration)
- **Template Organization**: Flat list (no categories/tags for MVP)
- **Template Preview**: Basic preview mode when creating/editing templates
  - Preview shows where basic information (patient name, date, practitioner, etc.) will be automatically injected
  - Preview displays basic info in header section with sample data (e.g., "Patient: [Sample Name]", "Date: [Sample Date]")
  - Preview shows how basic info will appear in actual records
- **Template Usage Tracking**: Not required for MVP (can show usage count in future)

### FR-3: Medical Record Creation

#### FR-3.1: Record Creation Flow
1. User selects "Create Medical Record"
2. User selects template (or "Blank")
3. System creates record with template structure
4. System automatically injects basic information (patient name, date, practitioner, clinic name) at the top of the record
5. User fills form fields and drawing areas
6. User can reference/link patient files in drawing areas (files are patient-level, not record attachments)
7. **Future UX Enhancement**: User can view/reference patient attachments (including patient forms) while editing record
8. System auto-saves as user works (no draft/finalized status - all records are equal)
9. Records can be created at any time (before, during, or after appointment)
10. Records persist even if linked appointment is cancelled
11. Quick access to create record from appointment view
12. **Record Duplication**: Users can duplicate/clone existing records (useful for follow-up visits)
    - Duplication copies everything: basic info (keeps same patient/date), form data, drawings, and all content
    - User can then edit the duplicated record as needed (including changing basic info if needed)
13. **Patient Form Reference**: Patient forms are stored as attachments - users can view them while editing records (no auto-fill)

#### FR-3.2: Basic Information Injection
- **Always Injected**: Basic information is automatically injected into every medical record (no configuration needed)
- **Basic Information Includes**:
  - Patient name
  - Appointment date/time (if record is linked to appointment)
  - Practitioner name
  - Clinic name
  - Current date/time (if record is not linked to appointment)
- **Display Location**: Basic information is displayed at the top of the record (header section)
- **Always Shown**: All basic info fields are always shown (use "N/A" or empty if not available, e.g., appointment date if not linked)
- **Template Preview**: Basic information injection is visible in template preview (shows where basic info will appear)
- **User Control**: Basic information is displayed and can be edited by users (editable)
- **No Variables**: No template variables or configurable auto-fill - basic info is always injected automatically

#### FR-3.3: Long Form Handling
- **UI Approach**: Simple scrolling bar is sufficient for MVP
- Forms with many sections use standard page scrolling
- No need for collapsible sections, tabs, or complex navigation for MVP

#### FR-3.4: Record Linking
- Record can be linked to appointment (optional)
- Record can be linked to patient (required)
- **One-to-One Linking**: One record can be linked to only one appointment (not multiple)
- Record can be standalone (not linked to appointment)
- Record can be linked to appointment later
- Record can be unlinked from appointment (with confirmation)
- **Change Patient**: Record's patient can be changed after creation (with confirmation) - useful for corrections
- **Record Persistence**: Records persist even if linked appointment is cancelled (soft-deleted appointments remain visible)
- **No Integration**: Medical records are separate from appointment notes (no linking)

### FR-4: Drawing Functionality

#### FR-4.1: Drawing Tools
- **Pencil**: Freehand drawing with configurable color and width
- **Highlighter**: Semi-transparent drawing with configurable color and width
- **Text**: Add text annotations with configurable font, size, color
- **Shapes**: Add circles, rectangles, arrows, lines
- **Eraser**: Erase parts of drawing
- **Undo/Redo**: Limited undo/redo steps (e.g., 50 steps per drawing area)
  - Undo/redo history persists across saves (user can undo actions from previous session)
  - When undo limit is reached, oldest actions are discarded (FIFO - first in, first out)
- **Drawing Presets**: No favorite presets for MVP (basic tools only)
- **Tool Memory**: System remembers last used tool/color/size per user session (not saved as favorite, just session memory for convenience)
- **Note**: Drawing quality should be "good enough" - does not need to match iPad/Apple Pencil quality

#### FR-4.2: Drawing Area Features
- **Zoom/Pan Controls** (Tablet-first):
  - Pinch-to-zoom on touch devices (primary)
  - Mouse wheel zoom on desktop
  - Pan with drag gesture (when not in drawing mode)
  - Zoom controls (buttons or slider) for precise control
  - Reset zoom button
- Clear all drawings
- Background image/PDF support
- Multi-page PDF support (navigate between pages)
- **Large Multi-Page PDF Handling**: 
  - If user uploads large multi-page PDF to drawing area:
    - System should handle it gracefully (allow upload)
    - User can navigate between pages
    - Each page can be annotated separately
    - If PDF is too large for drawing area, system should:
      - Allow zoom/pan to view different parts
      - Show page navigation controls
      - Optionally warn user if PDF is very large (performance consideration)
- **Pageless Mode**: Records use pageless/infinite canvas for editing and viewing
- **Multi-Page Support**: Records can span multiple "pages" (sections) but editing is pageless
- **Drawing Performance**: System should handle reasonable number of strokes (use judgement for optimization)
- **Device Support**: Drawing areas are tablet-first, best effort for desktop and mobile

#### FR-4.3: Tablet Optimization
- Touch/stylus input support
- Pressure sensitivity (if device supports)
- Palm rejection (ignore palm touches while drawing)
- Isolated scrolling (drawing mode disables page scroll)
- Visual indicator for drawing mode
- Responsive touch input
- **Priority**: Tablet experience is primary, desktop and mobile should be "good enough"
- **Drawing Area Sizing**: Fixed sizes (small, medium, large) and custom sizes for MVP - prioritize tablet experience

### FR-5: File Integration in Drawing Areas

#### FR-5.1: Photo Upload
- Upload from device camera
- Upload from device gallery
- Support common image formats (JPEG, PNG, HEIC)
- Image appears as background in drawing area
- User can draw/annotate on image
- User can resize/move image
- User can remove image

#### FR-5.2: PDF Upload
- Upload PDF file
- PDF renders in drawing area
- Navigate between PDF pages
- Draw/annotate on each page separately
- Annotations saved per page
- Annotated PDF is included when exporting the whole medical record to PDF

#### FR-5.3: Embedded Images in Templates
- Template creator can upload image during template creation
- Image is embedded in drawing area
- Image appears as background when template is used
- Practitioners cannot remove embedded image
- Practitioners can draw on top of embedded image

### FR-6: PDF Export

#### FR-6.1: Export Content
- **Whole Medical Record Export Only**: Export complete medical record as single PDF
- All template static text
- All form field labels and values
- All drawing areas with annotations
- All embedded images
- All uploaded photos/PDFs (as rendered)
- Proper layout and formatting
- **Pageless to PDF**: Convert pageless editing view to paginated PDF (best effort, quality not top priority)
- **Multi-Page Handling**: Handle multi-page records appropriately in PDF export
- **Language Support**: Chinese and English text rendered as text (not images) in PDF export
- **Note**: No individual drawing area export, no annotated PDF export of individual components - only whole record export

#### FR-6.2: Export Quality
- High-resolution output (suitable for printing)
- **Language Support**: Chinese and English text rendered as text (not images) - system works with any language
- Text is searchable (not rasterized)
- Proper font rendering for Chinese and English characters
- Reasonable file size (< 5 MB for typical record)

#### FR-6.3: Export Options
- Export single record to PDF
- **PDF File Naming**: Uses Chinese with predefined pattern
  - Pattern: `病歷_[患者姓名]_[日期].pdf` (e.g., `病歷_張三_2025-01-15.pdf`)
  - Date format: YYYY-MM-DD
  - If patient name contains special characters, use sanitized version
- **Export Progress**: Show progress indicator during PDF export (especially for large records with many drawings)
- **MVP**: PDF export only (no JSON, CSV, or other formats)
- **Future**: Batch export, export options can be added later

### FR-7: Auto-Save and Sync

#### FR-7.1: Auto-Save
- Debounced auto-save (2-3 seconds after last change)
- Save both form data and drawing data
- Visual indicator (saving... / saved)
- Manual save option available
- Draft state preserved on navigation

#### FR-7.2: Cross-Device Sync
- Near real-time sync (5-10 second delay)
- **Conflict Resolution**: Start with simple approach (last-write-wins or basic merge)
- Visual indicator when another device is editing
- Edit history/version tracking (who edited, when)
- Optimistic updates (show changes immediately, sync in background)
- **Network Failure Handling**:
  - Show connection status indicator
  - If network fails during auto-save: Show error notification, queue changes for retry
  - **Disallow offline editing**: If connection lost, show warning and prevent further editing until connection restored
  - Warn user before closing if unsaved changes exist
  - Simple retry mechanism for failed saves
- **Note**: Online-only for MVP (offline support not required)

### FR-8: Pre-Appointment Patient Forms

#### FR-8.1: Form Template Creation
- Create "patient form" template type (separate from medical record templates)
- Form can contain standard form fields (no drawing areas)
- Form fields can have labels in any language (Chinese, English, or mixed)
- Form template is created similar to medical record template (form builder UI)
- Form template is saved and can be reused
- **Note**: Usually there is one patient form template per clinic, but multiple medical record templates

#### FR-8.2: Form Configuration and Sending
- **Link Form to Appointment Type**: Clinic user can link a patient form template to specific appointment types
- **Timing Configuration**: Clinic user can configure when to send form:
  - Immediately after appointment booking
  - X hours before appointment (e.g., 24 hours, 48 hours)
  - Specific time before appointment (e.g., 9 AM the day before)
- **Automatic Sending**: System automatically sends form link via LINE when conditions are met
- **Manual Sending**: Clinic user can also manually send form link to patient via LINE
- Form link is unique and secure (one-time use - becomes invalid after patient submits form)
- Clinic can issue multiple links for same appointment if needed (each link allows one submission)
- **Form Status Tracking**: System tracks which patients have received, opened, and completed forms

#### FR-8.3: Patient Form Filling
- Patient receives form link via LINE message
- Patient clicks link to open form in mobile-optimized web interface
- Patient can fill form on mobile device (responsive layout)
- Form fields support Chinese, English, or mixed input
- Patient can save draft and return later (draft saved with unique link)
- Patient can submit form when complete
- **Form Submission**: Once submitted, form data is locked (patient cannot edit)
- **No Submission Deadline**: Patient can submit form at any time (before or after appointment)
- **Form Editing**: Only clinic users can edit submitted forms (patient cannot edit after submission)

#### FR-8.4: Form Storage and Access
- **Storage as Patient Attachment**: When patient submits form, it is stored as an attachment in the patient's file list
- **Form Display**: Submitted form is displayed as a viewable document in patient attachments
- **Form Metadata**: Form shows:
  - Submission date/time
  - Linked appointment (if applicable)
  - Form template name
  - Patient name
- **Access Points**:
  - Patient profile page (in attachments list)
  - Appointment detail page (if form linked to appointment)
- **Multiple Forms**: Patient can have multiple submitted forms
  - One submission per form link (link becomes invalid after submission)
  - If clinic issues multiple links (e.g., for same appointment or different appointments), all submissions are kept
  - Each submission is stored as separate attachment
- **No Field Mapping**: Patient form is a reference document - no automatic field mapping or pre-filling into medical records

#### FR-8.5: Form Workflow Example
1. **Clinic Setup**:
   - Clinic user creates "Initial Evaluation Form" template with fields (chief complaint, pain level, etc.)
   - Clinic user links form template to "Initial Evaluation" appointment type
   - Clinic user sets timing: "Send 24 hours before appointment"

2. **Patient Books Appointment**:
   - Patient books "Initial Evaluation" appointment for tomorrow
   - System automatically sends form link via LINE 24 hours before appointment

3. **Patient Fills Form**:
   - Patient receives LINE message with form link
   - Patient clicks link, fills form on mobile
   - Patient submits form
   - Form is stored as attachment in patient's file list
   - Form is linked to the appointment

4. **Clinic Creates Medical Record**:
   - Practitioner opens appointment detail page
   - Clicks "Create Medical Record"
   - Selects "Initial Evaluation" template
   - **Future UX**: Practitioner can view/reference patient form (and other attachments) while editing record
   - Practitioner manually enters information into medical record (referencing patient form if needed)
   - Practitioner completes record


---

## Non-Functional Requirements

### NFR-1: Performance
- Page load time: < 2 seconds for medical record view
- Drawing responsiveness: < 100ms latency for drawing strokes
- Auto-save: Complete within 3 seconds
- Cross-device sync: < 10 seconds delay
- PDF export: Complete within 30 seconds for typical record

### NFR-2: Scalability
- Support 1000+ medical records per clinic
- Support 100+ templates per clinic
- Support concurrent editing by multiple users
- Support large file uploads (up to 10 MB)

### NFR-3: Reliability
- Auto-save success rate: > 99%
- Data loss prevention: Zero data loss on auto-save
- Cross-device sync reliability: > 99.5%
- PDF export success rate: > 99%

### NFR-4: Security
- Patient data encryption at rest
- Secure file upload (virus scanning, file type validation)
- Access control (only authorized clinic users can view/edit)
- Audit logging (who created/edited records, when)
- **Note**: Compliance requirements (HIPAA, Taiwan regulations) not required for MVP

### NFR-5: Usability
- Intuitive UI (minimal training required)
- **Device Support**:
  - **Everything except drawing areas**: Responsive and friendly on all devices (desktop, tablet, mobile) - auto-resize
  - **Drawing areas**: Tablet-first experience, best effort for desktop and mobile
- Clear visual feedback for all actions
- **Error Messages**: User-friendly, actionable error messages
  - Messages in appropriate language (Chinese/English based on user preference or system default)
  - Tell user what to do (actionable, not just technical error codes)
  - Avoid technical jargon

### NFR-6: Accessibility
- Keyboard navigation support
- Screen reader compatibility (for form fields)
- High contrast mode support
- Touch target sizes: Minimum 44×44 pixels

### NFR-7: Browser Compatibility
- Support modern browsers (Chrome, Safari, Firefox, Edge)
- Support mobile browsers (iOS Safari, Chrome Mobile)
- Support tablet browsers (iPad Safari, Android Chrome)
- Graceful degradation for older browsers

---

## User Experience Requirements

### UX-1: Drawing Experience
- **Primary Goal**: Match or exceed Notability-like drawing experience
- Smooth, responsive drawing strokes
- No lag or jitter
- Accurate touch/stylus input
- Clear visual feedback
- Intuitive tool selection

### UX-2: Form Filling Experience
- Fast, responsive form interactions
- Clear field labels and placeholders
- Helpful validation messages
- Auto-focus next field when appropriate
- Keyboard shortcuts for power users

### UX-3: Cross-Device Experience
- Seamless transition between devices
- Consistent UI across devices
- Optimized for each device type (mobile, tablet, desktop)
- Clear indication of sync status

### UX-4: Template Creation Experience
- Visual template builder (drag-and-drop)
- Live preview of template
- **Preview Shows Basic Info**: Template preview displays where basic information (patient name, date, practitioner, clinic) will be automatically injected
- Easy element reordering
- Clear element configuration options
- Template testing before saving

### UX-5: Medical Record Viewing
- Clean, readable layout
- Easy navigation between sections
- Quick access to related information (patient, appointment)
- Print-friendly view
- Export options easily accessible

---

## Future Considerations

### FC-1: AI Agent Integration
**Design for future AI capabilities:**
- Medical records should be structured in a way that AI can read and understand
- Form schema should be machine-readable (JSON Schema)
- Drawing annotations should have semantic meaning where possible
- Text content should be searchable and indexable
- Consider adding metadata tags for AI processing

**Potential AI Features:**
- AI can read medical record and extract key information
- AI can suggest form field values based on patient history
- AI can generate summaries of medical records
- AI can identify patterns across multiple records
- AI can assist with documentation (auto-complete, suggestions)

### FC-2: Advanced Drawing Features
- More drawing tools (shapes, stamps, templates)
- Layer support for drawings
- Drawing templates/stamps library
- Collaborative drawing (multiple users drawing simultaneously)
- Improved drawing quality to match iPad/Apple Pencil experience

### FC-3: Advanced Template Features
- Conditional fields (show/hide based on other field values)
- Calculated fields (auto-calculate based on other fields)
- Template versioning and migration
- Template sharing between clinics

### FC-4: Reporting and Analytics
- Generate reports from medical records
- Analytics on common conditions/treatments
- Export data for research (anonymized)
- Trend analysis over time

### FC-5: Integration with External Systems
- Export to EMR systems
- Import from other systems
- Integration with billing systems
- Integration with insurance systems

### FC-6: Compliance Features
- HIPAA compliance features
- Taiwan medical record regulations compliance
- Enhanced audit logging
- Data retention policies
- Patient data export/deletion (GDPR-like features)

### FC-7: Attachment Reference While Editing
- **View/Reference Attachments**: While editing medical records, users can view patient attachments (files, patient forms) in a side panel or overlay
- **Quick Access**: Easy access to view patient forms and other files without leaving the record editing interface
- **Reference Integration**: Seamless experience to reference patient information while documenting
- **Note**: This is a future UX enhancement, not required for MVP

---

## Decisions & Clarifications

### D1: Drawing Quality Expectations
**Decision**: "Good enough" quality is acceptable for MVP. Does not need to match iPad/Apple Pencil quality.

**Rationale**: Focus on functionality over perfection. Can iterate based on user feedback.

### D2: PDF Template Support
**Decision**: Support both clinic-uploaded custom PDFs and standard templates provided by the system.

**Rationale**: Provides flexibility while reducing setup burden for clinics.

### D3: Drawing Complexity
**Decision**: MVP includes basic drawing tools (pencil, highlighter, text, shapes, eraser). Advanced features can be added later.

**Rationale**: Covers essential use cases while keeping MVP scope manageable.

### D4: Mobile vs Tablet Usage
**Decision**: Optimize for tablet first (primary use case), ensure mobile works well for form filling.

**Rationale**: Drawing is primarily tablet-based, but forms should work on all devices.

### D5: Offline Support
**Decision**: Online-only is acceptable for MVP. Offline support can be added later if needed.

**Rationale**: Reduces development complexity while meeting core needs.

### D6: Compliance Requirements
**Decision**: Compliance requirements not needed for MVP. Will be addressed in future phases.

**Rationale**: Focus on core functionality first, add compliance features as needed.

### D7: Pre-Appointment Form Delivery
**Decision**: LINE only for MVP. Email/SMS can be added later if needed.

**Rationale**: Leverages existing LINE integration, reduces integration complexity.

### D8: Record Sharing
**Decision**: Clinic-internal only for MVP. External sharing can be added later if needed.

**Rationale**: Simplifies access control and security requirements.

### D9: Record Versioning
**Decision**: Track edit history (who edited, when) for audit purposes. Full versioning can be added later.

**Rationale**: Provides basic audit trail without complex version management.

### D10: Drawing Data Storage
**Decision**: Store as vector data (JSON), render to image for PDF export.

**Rationale**: Balances storage efficiency, editability, and export quality.

---

## Success Metrics

### Adoption Metrics
- % of clinics using medical records feature
- % of appointments with medical records
- Average records per clinic per month
- Template usage distribution

### Usage Metrics
- Average time to create medical record
- % of records with drawings vs text-only
- % of records using templates vs blank
- Cross-device usage patterns

### Quality Metrics
- Auto-save success rate
- Cross-device sync success rate
- PDF export success rate
- User-reported issues/bugs

### User Satisfaction
- User satisfaction score (survey)
- Feature request frequency
- Support ticket volume
- User retention (clinic continues using feature)

---

## Dependencies

### Technical Dependencies
- File storage system (AWS S3 or equivalent)
- PDF generation library
- Drawing/annotation library (react-konva or equivalent)
- Real-time sync infrastructure (WebSockets or equivalent)

### Integration Dependencies
- LINE integration (for pre-appointment forms)
- Patient management system (existing)
- Appointment system (existing)
- User authentication/authorization (existing)

### External Dependencies
- Browser support for drawing APIs
- Device support for touch/stylus input
- Network connectivity for sync

---

## Risks and Mitigations

### Risk 1: Drawing Quality Not Meeting Expectations
**Mitigation**: 
- Set clear expectations upfront ("good enough" quality for MVP)
- Provide demo/prototype early for feedback
- Iterate based on user feedback
- Focus on functionality over perfection for MVP

### Risk 2: Performance Issues with Large Drawings
**Mitigation**:
- Optimize drawing data storage (vector format)
- Implement lazy loading for large records
- Limit drawing complexity if needed
- Provide performance monitoring

### Risk 3: Cross-Device Sync Conflicts
**Mitigation**:
- Implement clear conflict resolution strategy
- Show visual indicators when conflicts occur
- Provide manual merge option if needed
- Track edit history for debugging

### Risk 4: PDF Export Quality Issues
**Mitigation**:
- Test extensively with bilingual content
- Ensure proper font rendering
- Optimize file size
- Provide export preview before final export

### Risk 5: Adoption Challenges
**Mitigation**:
- Provide training materials
- Offer migration assistance from Notability
- Provide standard template library to reduce setup burden
- Mobile-optimized pre-appointment forms for better patient experience
- Gather feedback early and often

### Risk 6: MVP Scope Too Large (Forms + Files + Drawing)
**Mitigation**:
- Prioritize core features for each component
- Start with basic drawing tools, add advanced features later
- Use proven libraries for drawing (react-konva) to reduce development time
- Focus on "good enough" quality rather than perfection
- Phased rollout: Core forms first, then drawing, then advanced features

---

## MVP Scope Summary

### Included in MVP
✅ **Forms**: Full form functionality with all field types  
✅ **File Uploads**: Patient profile file uploads (files stored at patient level, can be referenced in records)  
✅ **Drawing**: Basic drawing tools (pencil, highlighter, text, shapes, eraser)  
✅ **Templates**: Template creation and management (all users can create)  
✅ **PDF Export**: Export medical records to PDF (Chinese and English text rendered as text, not images)  
✅ **Auto-Save**: Debounced auto-save for forms and drawings (no draft/finalized status)  
✅ **Cross-Device Sync**: Near real-time sync across devices  
✅ **Pre-Appointment Forms**: LINE-based patient data collection (clinic-configurable timing)  
✅ **Standard Template Library**: Pre-built templates for common use cases  
✅ **Version History**: Basic edit tracking (who, when)  
✅ **Record Completion Indicator**: Show indicator on appointments if record exists  
✅ **Quick Access**: Easy access to create/view records from appointment and patient pages  
✅ **Pageless Editing**: Pageless/infinite canvas for editing and viewing  
✅ **Multi-Page Records**: Support for records spanning multiple sections  
✅ **Record Duplication**: Users can duplicate/clone existing records  
✅ **Template Preview**: Basic preview mode when creating/editing templates  
✅ **File Recovery**: Soft delete with recovery period for deleted files  
✅ **Long Form Handling**: Simple scrolling bar for forms with many sections  
✅ **Patient Forms as Attachments**: Submitted patient forms stored in patient file list  

### Excluded from MVP
❌ **Offline Support**: Online-only for MVP  
❌ **Compliance Features**: HIPAA/Taiwan regulations not required for MVP  
❌ **External Sharing**: Clinic-internal only for MVP  
❌ **Advanced Drawing**: Advanced tools, layers, collaborative drawing  
❌ **Email/SMS Forms**: LINE-only for pre-appointment forms  
❌ **Search Functionality**: Not required for MVP (can be added in future)  
❌ **Required Field Validation**: No required fields for MVP  
❌ **Bulk Operations**: Not required for MVP  
❌ **Template Variables**: No configurable variables - basic info is always automatically injected  
❌ **Record Reminders**: No automatic reminders to create records  
❌ **Archiving UI**: Records remain accessible indefinitely (storage optimization can be backend-only)  
❌ **Form Field Dependencies**: No conditional show/hide fields for MVP  
❌ **Drawing Presets**: No favorite colors/sizes for MVP  
❌ **Record Comparison**: Side-by-side comparison not needed for MVP  
❌ **Template Categories**: Flat list only (no categories/tags)  
❌ **Record Statistics/Analytics**: Not required for MVP  
❌ **Template Usage Tracking**: Not required for MVP  
❌ **Bulk Record Export**: Export all records for patient not required for MVP  
❌ **Field Mapping**: No field mapping between patient forms and medical records  
❌ **Auto-Fill from Patient Forms**: Patient forms are reference documents only, not auto-filled  
❌ **Attachment Reference UI**: Viewing attachments while editing records is future enhancement  
❌ **Bilingual Label Requirements**: No special bilingual support needed - users can use any language  
❌ **Read-Only Mode**: Not needed - all users can edit  
❌ **Export Drawing as Image**: Not needed - only whole record PDF export  
❌ **Export Annotated PDF**: Not needed - only whole record PDF export  
❌ **Export Individual Drawing Areas**: Not needed - only whole record PDF export  
❌ **File Categorization**: Not needed for MVP - files organized by upload date only  

### Quality Expectations
- **Drawing Quality**: "Good enough" - functional but does not need to match iPad/Apple Pencil
- **Performance**: Responsive and usable, but optimization can be iterative
- **Mobile Forms**: Mobile-optimized for patient pre-appointment forms
- **Device Support**: Everything except drawing areas works on all devices (desktop, tablet, mobile) with auto-resize. Drawing areas are tablet-first, best effort for other devices
- **PDF Export**: Best effort quality (not top priority), handles pageless to paginated conversion. Chinese and English text rendered as text (not images)
- **Error Handling**: Simple approach - show notifications, queue retries, prevent offline editing
- **Template Deletion**: Prevent if records exist (show count)
- **File Deletion**: Soft delete with 30-day recovery period
- **Undo/Redo**: Limited to 50 steps per drawing area (persists across saves)
- **Zoom/Pan**: Tablet-first (pinch-to-zoom primary, mouse wheel for desktop)
- **Image Compression**: Automatic compression on upload (no hard size limits)
- **Language Support**: No special bilingual functions - system works with Chinese, English, or mixed content

---

## Appendix

### A. Glossary
- **Medical Record**: A document containing patient visit documentation
- **Template**: A reusable structure for creating medical records
- **Drawing Area**: A canvas component where users can draw/annotate
- **Form Field**: An input element in a template (text, dropdown, etc.)
- **Basic Information Injection**: Automatic injection of basic patient/appointment information (patient name, date, practitioner, clinic) into every medical record
- **Pre-Appointment Form**: A form sent to patients before their appointment
- **Standard Template Library**: Pre-built templates provided by the system

### B. Related Documents
- Medical Records Proposal (technical implementation options)
- Medical Records Storage Analysis (cost and storage considerations)
- Medical Record Storage Format (data structure specifications)

### C. Revision History
- **v1.6** (2025-01-XX): Final clarifications and decisions
  - Basic information is editable (not read-only)
  - Record duplication copies everything (basic info keeps same patient/date, form data, drawings)
  - Removed file categorization feature
  - PDF export uses Chinese file naming pattern: `病歷_[患者姓名]_[日期].pdf`
  - Patient forms: No submission deadline, only clinic can edit after submission
  - Patient forms: One submission per link (link invalid after submission), multiple links = multiple submissions kept
  - Record patient can be changed after creation (with confirmation)
  - Standard templates: Clinic copies are independent (system updates don't affect clinic copies)
  - Added PDF export progress indicator, drawing tool session memory, and user-friendly error messages
  - Clarified drawing area sizes (including custom), undo/redo behavior, template deletion, and other implementation details
- **v1.5** (2025-01-XX): Simplified basic information injection
  - Removed Auto-Fill Variables feature (no configurable template variables)
  - Basic information (patient name, date, practitioner, clinic) is always automatically injected
  - Basic information displayed at top of record (header section)
  - Template preview shows where basic information will appear
- **v1.4** (2025-01-XX): Simplified pre-appointment form workflow
  - Removed complex field mapping between patient forms and medical records
  - Patient forms now stored as attachments in patient file list
  - Patient forms are reference documents only (no auto-fill)
  - Added future UX enhancement: View/reference attachments while editing records
  - Simplified form workflow - one form template per clinic typically, multiple medical records per patient
- **v1.3** (2025-01-XX): Language support and workflow clarifications
  - Removed bilingual label requirements - users can use any language
  - Updated language support: System works with Chinese, English, or mixed (no special functions)
  - Removed read-only mode requirement
  - Changed image handling: Automatic compression instead of size limits
  - Clarified device support: Everything except drawing areas works on all devices
  - Removed individual drawing/PDF export features - only whole record export
  - Added pre-appointment form workflow with timing configuration (field mapping removed in v1.4)
  - Added large multi-page PDF handling in drawing areas
  - Updated PDF export to ensure Chinese/English text not converted to images
- **v1.2** (2025-01-XX): Final clarifications and refinements
  - Clarified file storage: Files are patient-level, not record attachments
  - Added patient deletion handling (records preserved)
  - Added template duplication and section reordering
  - Added default values for form fields
  - Clarified background image locking (template vs user-uploaded)
  - Added patient form integration with medical records
  - Excluded record statistics/analytics from MVP
  - Added all final clarifications from stakeholder feedback
- **v1.1** (2025-01-XX): Updated with clarifications and design decisions
  - Clarified MVP scope: Forms, files, and drawing all required
  - Set drawing quality expectation: "Good enough"
  - Set pre-appointment forms: LINE only
  - Set record sharing: Internal only
  - Set offline support: Not required for MVP
  - Set compliance: Not required for MVP
  - Added standard template library feature
  - Added mobile-first forms requirement
  - Added version history tracking
- **v1.0** (2025-01-XX): Initial PRD creation
