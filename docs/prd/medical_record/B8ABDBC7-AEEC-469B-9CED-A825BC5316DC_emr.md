# AI-Native EMR System: Strategic Proposal & Roadmap for Taiwan Clinics

**UUID**: `B8ABDBC7-AEEC-469B-9CED-A825BC5316DC`\
**Date**: 2026-02-01\
**Version**: 1.0\
**Target Market**: Physical Therapy & Rehabilitation Clinics in Taiwan

***

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Market Analysis: Taiwan Healthcare Context](#2-market-analysis-taiwan-healthcare-context)
3. [Competitive Landscape](#3-competitive-landscape)
4. [Technical Feasibility Analysis](#4-technical-feasibility-analysis)
5. [Feature Brainstorming](#5-feature-brainstorming)
6. [Strategic Options](#6-strategic-options)
7. [Recommended Roadmap](#7-recommended-roadmap)
8. [Phase 1: Detailed Implementation Plan](#8-phase-1-detailed-implementation-plan)
9. [Risk Mitigation](#9-risk-mitigation)
10. [Success Metrics](#10-success-metrics)
11. [Future Vision: AI-Native EMR](#11-future-vision-ai-native-emr)
12. [Appendix](#12-appendix)

***

## 1. Executive Summary

### Vision

Transform our clinic appointment management platform into a comprehensive, **AI-native Electronic Medical Record (EMR)** system designed specifically for **Taiwan's healthcare ecosystem**. The ultimate vision is an "invisible EMR" where documentation happens automatically through ambient intelligence, allowing practitioners to focus entirely on patient care.

### Core Philosophy

1. **Start Simple, Scale Intelligently**: Begin with basic file management and note-taking, then progressively layer AI capabilities
2. **Leverage LINE Ubiquity**: Taiwan's near-universal LINE adoption is our strategic advantage
3. **Clinic-First Onboarding**: Reduce friction to adoption by solving immediate pain points before introducing complex features
4. **AI as Assistant, Not Replacement**: AI enhances, organizes, and suggests—but practitioners always have final control

### Key Differentiators

| Competitor Approach | Our Approach |
|---------------------|--------------|
| Standalone EMR systems | Integrated appointment + EMR + LINE ecosystem |
| Desktop-first | Mobile-first with LINE as patient interface |
| Manual data entry | Auto-capture from LINE + voice transcription |
| US/international focus | Taiwan-specific (繁體中文, FHIR roadmap, NHI awareness) |

***

## 2. Market Analysis: Taiwan Healthcare Context

### 2.1 Taiwan EMR Market Overview

| Metric | Value | Source |
|--------|-------|--------|
| Taiwan EHR Market (2023) | USD 6.3M | Industry Reports |
| Asia-Pacific EMR Market | USD 3.12B (2024) → USD 5.05B (2032) | DataBridge |
| EMR Adoption (Hospitals) | 90% | 2015 Data |
| EMR Adoption (Clinics) | 70% | 2015 Data |
| Interoperable EHR Clinics | 53.6% (5,244 of 9,782 private clinics) | 2016 NIH Study |

### 2.2 Taiwan Healthcare System Characteristics

#### Government Initiatives

* **Taiwan Electronic Medical Record Exchange Center (EEC)**: Established 2011, facilitates EMR sharing between institutions
* **Taiwan Medical Information Standards Platform**: Launched March 2025, standardizing medical data using **FHIR** (Fast Healthcare Interoperability Resources)
* **Goal**: Unify EMR formats across 23 medical centers within 2 years, enabling cloud-based record access

#### National Health Insurance (NHI) Integration

* Clinics can access **NHI MediCloud System** for patient medication history (6 months), surgical records, allergies
* Patient consent via NHI IC card is required for cross-institution data retrieval
* Future: CQL (Clinical Quality Language) for automated compliance verification

#### Physical Therapy Specific

* **Referral Model**: Doctor's order required for PT services (limits direct access)
* **Heavy Visual Documentation**: Progress photos, range of motion videos critical
* **Hands-On Nature**: Practitioners cannot type during treatment

### 2.3 Taiwan User Behavior

| Behavior | Implication for EMR |
|----------|---------------------|
| **LINE is ubiquitous** (95%+ penetration) | Use LINE as patient data capture channel |
| **Patients share X-rays, prescriptions via LINE** | Auto-capture and organize these files |
| **Practitioners use personal phones for photos** | Need a way to transfer photos to patient records |
| **Small clinics lack IT resources** | Must be plug-and-play, no complex setup |
| **Trust in face-to-face relationships** | AI suggestions, not AI decisions |

### 2.4 Pain Points (Current State)

1. **Data Fragmentation**
   * Patient photos in practitioner's phone gallery
   * Chat history scattered across LINE conversations
   * Appointment data in booking system
   * Notes in paper files or Google Docs

2. **Documentation Burden**
   * Writing SOAP notes takes 10-15 minutes per patient
   * Time pressure leads to incomplete records
   * Notes written from memory hours later

3. **Retrieval Difficulty**
   * "What did we do last session?" requires digging through chat/paper
   * No timeline view of patient progress
   * Difficult to prepare for appointments

4. **Compliance Anxiety**
   * Unclear what format records should be in
   * Fear of government audits
   * Want to be "FHIR ready" but don't know how

***

## 3. Competitive Landscape

### 3.1 Taiwan EMR Vendors

| Vendor | Focus | Strengths | Weaknesses |
|--------|-------|-----------|------------|
| **Cerner/Veradigm** | Hospital | Market leaders, comprehensive | Expensive, complex, not clinic-focused |
| **Vision Asia Medical** | Small hospitals/clinics | HIT systems for small providers | Legacy design, limited AI |
| **Techgroup** | Clinics | Affordable solutions | Basic functionality |
| **Dr.AI (台灣)** | AI-native documentation | SOAP generation, speech-to-text | May not have LINE integration |
| **QOCA (Quanta)** | Telemedicine | Hardware + software | Different focus area |

### 3.2 Our Differentiation

```
Traditional EMR          Our Platform
─────────────           ─────────────
Standalone              LINE-integrated ecosystem
Data entry required     Auto-capture from LINE chat
Desktop-first           Mobile-first
Complex setup           Plug-and-play
Generic templates       PT/Rehab specific templates
```

### 3.3 Competitive Moat Strategy

1. **LINE Integration**: Deep integration that competitors would take years to replicate
2. **Existing Customer Base**: Leverage current clinics using our appointment system
3. **AI Differentiation**: Taiwan-specific Mandarin voice models, local context
4. **Gradual Lock-in**: Free basic features → paid AI features → mission-critical data

***

## 4. Technical Feasibility Analysis

### 4.1 LINE Messaging API: File Handling

#### Current Capabilities

* Text message handling: ✅ Fully implemented
* Image/file webhook events: ⚠️ Not yet implemented

#### Required Changes for File Capture

| Aspect | Details |
|--------|---------|
| **Webhook Events** | Handle `message.type` = `image`, `video`, `file`, `audio` |
| **Content Download** | `GET https://api-data.line.me/v2/bot/message/{messageId}/content` |
| **Time Window** | Content must be downloaded within ~7 days before LINE deletes |
| **File Limits** | Images: 10MB max. Videos: 200MB, 5 min max via app |
| **Storage** | Need S3/R2/GCS for persistent storage |

#### Implementation Effort

* **Backend**: 2-3 weeks (webhook upgrade, S3 integration, file model)
* **Frontend**: 2 weeks (file gallery, upload UI)

**Verdict**: ✅ High feasibility. Standard webhook/storage work.

### 4.2 Web App vs Native App (Recording & Photos)

#### The Challenge: "Pocket Recording"

The ideal scenario: Practitioner starts recording, puts phone in pocket, treats patient, recording continues.

| Platform | Background Recording | Photo Access | Effort |
|----------|---------------------|--------------|--------|
| **Web App (PWA/LIFF)** | ❌ Unreliable (iOS kills background tabs) | ✅ Camera API | Low |
| **Web + Wake Lock API** | ⚠️ Works if screen stays on (dimmed) | ✅ Camera API | Low |
| **React Native** | ✅ Foreground service (Android), ⚠️ iOS tricky | ✅ Full access | Medium |
| **Flutter** | ✅ Same as RN | ✅ Full access | Medium |
| **Native iOS/Android** | ✅ Full control | ✅ Full control | High |

#### PWA Limitations

* **iOS Safari**: Minimizing tab or screen lock stops MediaRecorder
* **Workaround**: Screen Wake Lock API + keep app in foreground
* **User Experience**: Phone screen stays on (can be dimmed), must stay in pocket unlocked

#### Native App Considerations

* **Android**: Can use Foreground Service with persistent notification
* **iOS**: "Audio" background mode works, but apps may still be killed on memory pressure
* **Cross-platform**: React Native preferred (JS ecosystem matches frontend)

#### Recommended Approach (Phased)

```
Phase 1-2: Web App + Wake Lock
├── Sufficient for clinic-based recording
├── No app store friction
└── Rapid iteration

Phase 3+: React Native Companion App
├── Only if web proves unreliable
├── Focused app for: recording, quick photos, upload
└── All other features stay in web
```

**Verdict**: Start web, build native only if needed.

### 4.3 AI Transcription & SOAP Generation

#### Speech-to-Text (Mandarin)

| Service | Accuracy (Mandarin) | Cost | Notes |
|---------|---------------------|------|-------|
| **OpenAI Whisper** | ~95-98% (general) | $0.006/min | Standard choice, proven |
| **Notta AI** | 98.86% claimed | Subscription | Taiwan-focused |
| **Dr.AI Platform** | Not public | Subscription | Taiwan medical-specific |
| **Custom fine-tuned** | Can exceed 98% | High dev cost | Future option |

#### SOAP Note Generation

* Use GPT-4o/Claude with medical prompt engineering
* Input: Transcription + patient history + appointment context
* Output: Draft SOAP note for review

#### Technical Requirements

* Audio upload to cloud storage
* Async transcription job
* LLM processing for structure
* Human-in-the-loop review

**Verdict**: ✅ Feasible. Medical Mandarin transcription is mature enough.

### 4.4 FHIR Compatibility (Future-Proofing)

Taiwan is standardizing on **FHIR R4**. While not immediately required for small clinics, designing data models with FHIR mappings provides:

1. **Future interoperability** with government systems
2. **Export capability** to other providers
3. **Compliance positioning** ("FHIR-ready")

| FHIR Resource | Our Equivalent |
|---------------|----------------|
| Patient | `Patient` model |
| Encounter | `Appointment` + `MedicalRecord` |
| Observation | `VitalSign`, `Assessment` |
| DocumentReference | `PatientFile` |
| Practitioner | `User` (practitioner role) |

**Recommendation**: Add `fhir_resource_type` and `fhir_export_data` fields to core models for future compatibility.

***

## 5. Feature Brainstorming

### 5.1 Core EMR Features

#### Patient Medical Profile (Expanded PatientDetailPage)

* \[ ] Demographics tab (existing: name, phone, birthday, gender, notes)
* \[ ] Medical history tab (conditions, allergies, medications)
* \[ ] Timeline tab (chronological view of all interactions)
* \[ ] Files tab (photos, documents, X-rays)
* \[ ] Insurance info (NHI card number, optional)

#### Clinical Notes

* \[ ] Rich text editor with formatting
* \[ ] Template system (SOAP, Initial Eval, Progress Note)
* \[ ] Photo/file attachment to specific notes
* \[ ] Practitioner signature/timestamp
* \[ ] Link notes to appointments (1:1 or standalone)

#### File Management

* \[ ] File gallery view (grid/list toggle)
* \[ ] File categorization (X-ray, prescription, progress photo, etc.)
* \[ ] Upload from device
* \[ ] Auto-capture from LINE
* \[ ] Before/after comparison view
* \[ ] Download/export capability

#### Template Management

* \[ ] Clinic-defined templates
* \[ ] Structured fields (pain scale 1-10, ROM measurements)
* \[ ] Free-text areas
* \[ ] Template versioning
* \[ ] Default templates per appointment type

### 5.2 LINE Integration Features

#### Auto-Capture from LINE

* \[ ] Image messages → Patient file vault
* \[ ] PDF/file attachments → Patient documents
* \[ ] Video messages → Patient media (with storage limits)
* \[ ] "Select messages → Add to record" feature

#### Patient-Initiated Data

* \[ ] Daily check-in prompts (pain level, exercise completion)
* \[ ] Photo uploads (home exercise photos)
* \[ ] Symptom tracking via LINE chatbot

#### Practitioner-Initiated via LINE

* \[ ] "Ask patient to send X-ray" → Creates task/reminder
* \[ ] Follow-up message with exercise instructions → Auto-saved to record

### 5.3 AI-Powered Features

#### Voice Recording & Transcription

* \[ ] "Start Session" button during appointment
* \[ ] Background recording with Wake Lock
* \[ ] Automatic transcription post-session
* \[ ] Manual transcript editing

#### AI SOAP Generation

* \[ ] Input: Transcription + context
* \[ ] Output: Draft SOAP note
* \[ ] One-click "Generate Note" button
* \[ ] Always requires practitioner review/edit

#### Smart Summaries

* \[ ] Pre-appointment summary: "Last 3 visits, key concerns"
* \[ ] Treatment timeline generation
* \[ ] "What has the patient tried?"

#### RAG-Powered Search

* \[ ] "Has this patient complained about knee pain before?"
* \[ ] Search across all notes, transcripts, chat history
* \[ ] Citation to original source

### 5.4 Visit-Specific Features (PT/Rehab)

#### Progress Tracking

* \[ ] Body diagram annotations
* \[ ] Range of motion tracking (degrees)
* \[ ] Pain scale history charts
* \[ ] Before/after photo comparisons

#### Exercise Prescription

* \[ ] Exercise library (images/videos)
* \[ ] Create exercise program per patient
* \[ ] Send program via LINE
* \[ ] Track patient compliance

#### Treatment Protocol Templates

* \[ ] Standard protocols for common conditions
* \[ ] Protocol-linked appointments
* \[ ] Progress against protocol milestones

***

## 6. Strategic Options

### Option A: Minimal EMR (Fastest to Market)

**Scope**: Files + Basic Notes only

* Add file gallery to patient profile
* Simple note textarea (markdown supported)
* LINE file auto-capture
* No templates, no AI

**Timeline**: 4-6 weeks
**Risk**: May feel "too basic" to switch from current solutions
**Best For**: Validation that clinics want centralized files

***

### Option B: Structured EMR (Recommended)

**Scope**: Files + Templated Notes + LINE Integration

* File gallery with categorization
* Template-based note editor
* Appointment-linked notes
* LINE file auto-capture
* Clinic-configurable templates

**Timeline**: 8-12 weeks
**Risk**: Moderate scope, reasonable timeline
**Best For**: Real value proposition, differentiates from competitors

***

### Option C: AI-Native EMR (Maximum Vision)

**Scope**: Option B + AI Features

* Everything in Option B
* Voice recording + transcription (web-first)
* AI SOAP generation
* Pre-appointment summaries
* RAG search

**Timeline**: 16-24 weeks
**Risk**: Complex, may delay core features
**Best For**: Long-term differentiation, but high execution risk

***

### Recommendation: Option B with AI Hooks

Build Option B **with architectural hooks** for AI features:

* Design models to store transcriptions, AI outputs
* Keep UI extensible for "Generate Note" buttons
* Implement AI features in Phase 2-3

***

## 7. Recommended Roadmap

### Overall Timeline

```
                  Phase 1          Phase 2          Phase 3          Phase 4
                 (Weeks 1-8)     (Weeks 9-16)     (Weeks 17-24)    (Months 7-12)
                 ────────────    ────────────     ────────────     ────────────
Files            ████████████
Notes            ████████████    ████████████
LINE Capture     ████████████
Templates                        ████████████
Voice/AI                                          ████████████
Smart Features                                                     ████████████
Native App                                        ████████████     (if needed)
```

***

### Phase 1: Digital Foundation (Weeks 1-8)

**Goal**: Replace paper records and scattered files with centralized patient profiles.

#### Milestone 1.1: Patient File Management (Weeks 1-4)

* \[ ] Patient File model (storage URL, type, source, metadata)
* \[ ] S3/R2 integration for file storage
* \[ ] Frontend: File gallery tab in PatientDetailPage
* \[ ] Upload files from browser
* \[ ] File preview (images, PDFs)
* \[ ] File categorization (X-ray, prescription, progress, other)

#### Milestone 1.2: LINE File Auto-Capture (Weeks 3-6)

* \[ ] Upgrade LINE webhook to handle image/file/video events
* \[ ] Download content from LINE API, upload to S3
* \[ ] Associate files with patient (via LINE user → Patient link)
* \[ ] "Unassigned Files" queue for files without patient match
* \[ ] Admin UI to assign orphan files

#### Milestone 1.3: Basic Clinical Notes (Weeks 5-8)

* \[ ] MedicalRecord model (patient, practitioner, content, appointment link)
* \[ ] Rich text editor in frontend (TipTap or Quill)
* \[ ] Create/edit/delete notes
* \[ ] Link notes to appointments (optional)
* \[ ] Notes timeline view in patient profile

#### Phase 1 Deliverables

* ✅ Clinics can upload/view patient files centrally
* ✅ LINE-sent images auto-saved to patient profiles
* ✅ Practitioners can write/edit clinical notes
* ✅ All data in one place (not scattered)

***

### Phase 2: Structured Notes & Templates (Weeks 9-16)

**Goal**: Enable efficient documentation with templates, linking notes to visits.

#### Milestone 2.1: Template System (Weeks 9-12)

* \[ ] MedicalRecordTemplate model (clinic, name, structure/schema)
* \[ ] Template editor in clinic settings
* \[ ] SOAP template (default)
* \[ ] Initial Evaluation template (default)
* \[ ] Progress Note template (default)
* \[ ] Custom template fields (text, number, scale, checkbox)

#### Milestone 2.2: Enhanced Note Editor (Weeks 11-14)

* \[ ] Template selector when creating note
* \[ ] Dynamic form generation from template
* \[ ] Mixed structured + free-text areas
* \[ ] Photo attachment to specific sections
* \[ ] Quick note from appointment view

#### Milestone 2.3: Patient Timeline (Weeks 13-16)

* \[ ] Combined timeline: appointments + notes + files
* \[ ] Chronological view
* \[ ] Filter by type
* \[ ] Search within patient history
* \[ ] Export patient record (PDF)

#### Phase 2 Deliverables

* ✅ Clinics have standardized note templates
* ✅ Notes tied to appointments
* ✅ Complete patient history timeline
* ✅ Exportable patient records

***

### Phase 3: AI Assistance (Weeks 17-24)

**Goal**: Reduce documentation burden with AI, improve preparation.

#### Milestone 3.1: Voice Recording (Weeks 17-19)

* \[ ] "Record Session" button in appointment/note view
* \[ ] MediaRecorder API with Wake Lock
* \[ ] Audio upload to cloud storage
* \[ ] Recording status indicator
* \[ ] Stop & save functionality

#### Milestone 3.2: Transcription (Weeks 19-22)

* \[ ] Integration with OpenAI Whisper API
* \[ ] Async transcription job processing
* \[ ] Transcription attached to note
* \[ ] Manual edit capability
* \[ ] Speaker diarization (optional enhancement)

#### Milestone 3.3: AI Note Generation (Weeks 21-24)

* \[ ] "Generate SOAP Note" button
* \[ ] LLM processing (GPT-4o or Claude)
* \[ ] Context injection (patient history, appointment type)
* \[ ] Draft preview with edit ability
* \[ ] Clear "AI-Generated" labeling
* \[ ] Human confirmation required before save

#### Phase 3 Deliverables

* ✅ Voice recording during sessions
* ✅ Automatic transcription
* ✅ AI-drafted SOAP notes
* ✅ Significant time savings

***

### Phase 4: Advanced Intelligence (Months 7-12)

**Goal**: Proactive AI assistance, deep insights.

#### Planned Features

* \[ ] Pre-appointment summaries ("Patient Andy is returning for frozen shoulder...")
* \[ ] RAG search across all patient data
* \[ ] Treatment recommendations based on similar patients
* \[ ] Exercise program suggestions
* \[ ] Follow-up message drafting
* \[ ] Trend analysis and alerts
* \[ ] React Native companion app (if web recording proves insufficient)

***

## 8. Phase 1: Detailed Implementation Plan

### 8.1 Backend Changes

#### New Models

```python
# Patient File
class PatientFile(Base):
    id: int
    patient_id: FK -> Patient
    clinic_id: FK -> Clinic
    file_type: Enum('image', 'document', 'video', 'audio', 'other')
    category: Enum('xray', 'prescription', 'progress_photo', 'lab_result', 'other')
    storage_key: str  # S3 key
    storage_url: str  # Signed URL or CDN URL
    original_filename: str
    mime_type: str
    file_size_bytes: int
    source: Enum('line', 'web_upload', 'practitioner_upload')
    line_message_id: Optional[str]  # If from LINE
    uploaded_by_user_id: Optional[FK]  # If uploaded by clinic user
    metadata: JSONB  # Extensible: dimensions, thumbnail_url, etc.
    created_at: datetime
    is_deleted: bool
```

```python
# Medical Record (Clinical Note)
class MedicalRecord(Base):
    id: int
    patient_id: FK -> Patient
    clinic_id: FK -> Clinic
    practitioner_id: FK -> User
    appointment_id: Optional[FK -> Appointment]  # Nullable for standalone notes
    template_id: Optional[FK -> MedicalRecordTemplate]
    visit_date: date
    content: JSONB  # Structured content matching template, or {body: "markdown"}
    status: Enum('draft', 'final', 'amended')
    version: int  # For versioning/amendments
    created_at: datetime
    updated_at: datetime
    signed_at: Optional[datetime]
    is_deleted: bool
```

```python
# Medical Record Template
class MedicalRecordTemplate(Base):
    id: int
    clinic_id: FK -> Clinic
    name: str  # e.g., "SOAP Note", "Initial Evaluation"
    description: Optional[str]
    structure: JSONB  # Schema for fields
    is_default: bool  # Apply by default for new appointments?
    is_active: bool
    display_order: int
    created_at: datetime
    updated_at: datetime
```

#### Storage Integration (S3/R2)

```python
# services/file_storage_service.py
class FileStorageService:
    def upload_file(file: UploadFile, clinic_id: int, patient_id: int) -> PatientFile
    def download_file(file_id: int) -> StreamingResponse
    def get_signed_url(storage_key: str, expires_in: int = 3600) -> str
    def delete_file(file_id: int) -> bool
```

#### LINE Webhook Upgrade

```python
# In line_webhook.py, update extract_message_data:
def handle_line_message(payload):
    message_type = payload['message']['type']
    
    if message_type == 'text':
        # Existing logic
        
    elif message_type in ('image', 'video', 'audio', 'file'):
        message_id = payload['message']['id']
        content = line_service.get_message_content(message_id)
        
        # Find patient from LINE user
        patient = patient_service.find_by_line_user(line_user_id, clinic_id)
        
        # Upload to S3 and create PatientFile
        file_storage_service.upload_from_line(
            content=content,
            message_id=message_id,
            patient=patient,  # May be None → goes to "unassigned"
            clinic_id=clinic_id
        )
```

### 8.2 Frontend Changes

#### Patient Detail Page Overhaul

```typescript
// pages/PatientDetailPage.tsx structure:
<PatientDetailPage>
  <PatientHeader name, status, quick-actions />
  
  <Tabs value={activeTab}>
    <Tab value="overview">
      <PatientInfoSection />      // Existing
      <PatientNotesSection />     // Existing (migrate to summary)
      <QuickActions />            // Create note, upload file, etc.
    </Tab>
    
    <Tab value="timeline">
      <PatientTimeline />         // NEW: Chronological everything
    </Tab>
    
    <Tab value="notes">
      <PatientMedicalRecords />   // NEW: Clinical notes list
    </Tab>
    
    <Tab value="files">
      <PatientFileGallery />      // NEW: File management
    </Tab>
    
    <Tab value="appointments">
      <PatientAppointmentsList /> // Existing, move to tab
    </Tab>
  </Tabs>
</PatientDetailPage>
```

#### New Components

| Component | Description |
|-----------|-------------|
| `PatientFileGallery` | Grid/list of files with preview, categorization |
| `FileUploader` | Drag-drop or click upload component |
| `FilePreviewModal` | Large view of selected file |
| `PatientMedicalRecords` | List of clinical notes with filtering |
| `MedicalRecordEditor` | Rich text editor with template support |
| `PatientTimeline` | Unified chronological view |
| `UnassignedFilesQueue` | Admin view for orphan LINE files |

### 8.3 API Endpoints

```
# Patient Files
POST   /clinic/patients/{id}/files          # Upload file
GET    /clinic/patients/{id}/files          # List files
GET    /clinic/files/{file_id}              # Get file details
GET    /clinic/files/{file_id}/download     # Download file content
PATCH  /clinic/files/{file_id}              # Update metadata/category
DELETE /clinic/files/{file_id}              # Soft delete

# Unassigned Files (from LINE without patient match)
GET    /clinic/files/unassigned             # List unassigned files
POST   /clinic/files/{file_id}/assign       # Assign to patient

# Medical Records
POST   /clinic/patients/{id}/medical-records    # Create record
GET    /clinic/patients/{id}/medical-records    # List records
GET    /clinic/medical-records/{id}             # Get record
PATCH  /clinic/medical-records/{id}             # Update record
DELETE /clinic/medical-records/{id}             # Delete record

# Templates (Clinic Settings)
POST   /clinic/medical-record-templates         # Create template
GET    /clinic/medical-record-templates         # List templates
PATCH  /clinic/medical-record-templates/{id}    # Update template
DELETE /clinic/medical-record-templates/{id}    # Delete template
```

***

## 9. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **LINE API changes** | Low | High | Abstract LINE calls, monitor deprecation notices |
| **Storage costs grow quickly** | Medium | Medium | Implement storage quotas per clinic, tiered pricing |
| **Web recording unreliable** | Medium | Medium | Phase 3 native app fallback, clear user expectations |
| **AI transcription errors** | Medium | Medium | Always require human review, "draft" status |
| **Adoption resistance** | Medium | High | Start with power users, collect testimonials |
| **FHIR requirements change** | Low | Medium | Design with FHIR mappings from start |
| **Scope creep** | High | Medium | Strict phase gates, user validation between phases |

***

## 10. Success Metrics

### Phase 1 Metrics

| Metric | Target |
|--------|--------|
| Clinics using file upload | 30% of active clinics |
| Files uploaded per clinic/month | > 50 |
| Clinical notes created/month | > 20 per active clinic |
| User satisfaction (survey) | > 4.0/5.0 |

### Phase 2 Metrics

| Metric | Target |
|--------|--------|
| Template usage rate | > 70% of notes use templates |
| Average note completion time | < 5 minutes (vs 10-15 baseline) |
| LINE file auto-capture rate | > 80% of LINE images captured |

### Phase 3 Metrics

| Metric | Target |
|--------|--------|
| Voice recording usage | > 30% of appointments |
| AI note generation usage | > 50% when transcription available |
| Note accuracy (user edits) | < 30% significant edits |
| Time saved per session | > 5 minutes |

***

## 11. Future Vision: AI-Native EMR

### The "Invisible EMR" Experience

**Before Visit**:

> "Good morning, Dr. Chen. You have 8 appointments today. First up at 9:00 is 王小明 for frozen shoulder follow-up (visit #4). Last session: 15° ROM improvement, reported 40% pain reduction with home exercises. Suggest checking lateral rotation today."

**During Visit**:

> Practitioner taps "Start Session" and pockets phone. Audio records ambient conversation. Phone stays in pocket. Practitioner can snap photos with quick camera gesture.

**After Visit**:

> System processes recording. Draft SOAP note appears:
>
> * S: Patient reports continued improvement, mild discomfort with overhead reaching
> * O: \[Measurements entered from structured prompts]
> * A: Progressing as expected, ROM 160° flexion, 30° external rotation
> * P: Continue current exercises, add isometric strengthening, follow-up in 1 week

> Practitioner reviews, makes minor edits, clicks "Finalize".

**Follow-up**:

> AI proposes follow-up message: "王先生好，今天感謝您來診所。記得每天做3次的肩膀伸展運動喔！有任何問題隨時用LINE跟我們說。" Practitioner approves, system schedules via existing follow-up message system.

### Long-Term Capabilities

1. **Multi-patient context**: "Show me all frozen shoulder patients who used ultrasound treatment"
2. **Outcome prediction**: "Based on similar patients, expected recovery time is 8-10 weeks"
3. **Protocol automation**: Auto-populate note fields based on selected treatment protocol
4. **Insurance coding suggestions**: (Phase 4+) "Recommend NHI code xxx for this treatment"
5. **Cross-clinic benchmarking**: (With permission) "Your frozen shoulder outcomes are 15% above average"

***

## 12. Appendix

### A.1 SOAP Note Template Example

```json
{
  "name": "SOAP Note (物理治療)",
  "structure": {
    "sections": [
      {
        "id": "subjective",
        "label": "Subjective (主觀)",
        "fields": [
          {"id": "chief_complaint", "type": "text", "label": "主訴"},
          {"id": "pain_level", "type": "scale", "label": "疼痛指數", "min": 0, "max": 10},
          {"id": "patient_report", "type": "textarea", "label": "病人陳述"}
        ]
      },
      {
        "id": "objective",
        "label": "Objective (客觀)",
        "fields": [
          {"id": "rom_measurements", "type": "textarea", "label": "活動度測量"},
          {"id": "strength_tests", "type": "textarea", "label": "肌力測試"},
          {"id": "observations", "type": "textarea", "label": "觀察"}
        ]
      },
      {
        "id": "assessment",
        "label": "Assessment (評估)",
        "fields": [
          {"id": "progress", "type": "select", "label": "進步狀況", "options": ["改善", "持平", "退步"]},
          {"id": "analysis", "type": "textarea", "label": "分析"}
        ]
      },
      {
        "id": "plan",
        "label": "Plan (計畫)",
        "fields": [
          {"id": "treatment_today", "type": "textarea", "label": "今日治療"},
          {"id": "home_exercises", "type": "textarea", "label": "居家運動"},
          {"id": "next_appointment", "type": "text", "label": "下次預約"}
        ]
      }
    ]
  }
}
```

### A.2 Data Model Relationships

```
Patient (1) ───< (N) PatientFile
    │
    └───< (N) MedicalRecord ───> (1) MedicalRecordTemplate
                │
                └───< (N) MedicalRecordMedia (photos in notes)
                
Appointment ────> (0..1) MedicalRecord (optional link)

LineMessage ────> (0..1) PatientFile (if image/file captured)
```

### A.3 Technology Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Frontend | React + TypeScript + Vite | Current stack |
| Backend | Python + FastAPI | Current stack |
| Database | PostgreSQL | current, add JSONB for flexible schemas |
| File Storage | Cloudflare R2 or AWS S3 | S3-compatible, cost-effective |
| AI/ML | OpenAI API (Whisper, GPT-4o) | Start with API, self-host later if needed |
| Mobile (future) | React Native | Matches frontend expertise |

### A.4 References

* [Taiwan EHR Market Report](https://www.medicaldevice-network.com)
* [LINE Messaging API Documentation](https://developers.line.biz/en/docs/messaging-api/)
* [FHIR R4 Specification](https://www.hl7.org/fhir/)
* [Taiwan Medical Information Standards Platform](https://www.taiwan-healthcare.org/)
* [OpenAI Whisper](https://openai.com/research/whisper)

***

*Document prepared by AI Assistant based on market research, codebase analysis, and user requirements. Last updated: 2026-02-01*
