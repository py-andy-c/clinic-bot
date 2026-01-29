# Medical Record System - PRD

## 1. Overview

### Context

Currently, many clinics using our platform rely on external tools like **Notability** to manage their medical records. This creates a fragmented workflow where appointment data and medical history are disconnected. Searching and organizing records across multiple patients in Notability is difficult and time-consuming.

### Objective

To transform our platform into a comprehensive **CRM (Customer Relationship Management)** system for clinics by integrating a native medical record system. This system will allow clinic users to create, manage, and search medical records directly within the patient profile, keeping all clinical data in one place.

### Business Value

* **Increased Retention**: Clinics are less likely to leave our platform if their core clinical data is stored within it.
* **Efficiency**: Reduces time spent switching between apps and searching for paper or digital notes elsewhere.
* **Data Integrity**: Centralizes patient history, making it easier to track progress over time.
* **Upsell Potential**: Positions the product as a full clinic management solution rather than just an appointment bot.

### Success Metrics

* % of clinics that create at least one medical record template.
* Average number of medical records per patient for active clinics.
* Reduction in reported usage of external note-taking tools (qualitative).

***

## 2. User Personas

### A. Clinic Admin

* **Goal**: Standardize the data collection process across the clinic.
* **Actions**: Create and manage medical record templates, including setting default diagrams (e.g., anatomy) for clinical notes.

### B. Clinic User (Practitioner/Assistant)

* **Goal**: Efficiently document treatment and patient progress during or after appointments.
* **Actions**: Create records using templates, draw/annotate on diagrams, view/edit patient history on mobile/tablet.

***

## 3. Product Model: The "Split" Model

The medical record follows a consistent "Split" architecture designed for clarity and flexibility:

### 3.1 Structured Header (Top Section)

The top portion of every medical record consists of structured data fields defined in the template. This is ideal for insurance data, vital signs, or specific categorical information.

* **Supported Field Types**:
  * Short Text (e.g., Blood Pressure)
  * Text Area (e.g., Symptoms)
  * Dropdown (e.g., Treatment Type)
  * Checkbox / Radio (e.g., Medical History)

### 3.2 The Clinical Workspace (Bottom Section)

The bottom portion is a single, large, free-form area inspired by **Notability**. This is where the practitioner does the bulk of their creative and clinical documentation.

* **Unified Functionality**: The Canvas and "Annotatable Image" are merged into one powerful workspace.
* **Template Backgrounds**: Admins can pre-configure a "Base Image" (e.g., a human anatomy diagram) for this workspace in the template settings.
* **Dynamic Content**:
  * **Drawing**: Smooth pen/brush tools for sketching.
  * **Image Injection**: Practitioners can upload and place photos (e.g., a patient's rash) anywhere in the workspace and annotate directly on them.
* **Growth & Pagination**: Like Notability, this workspace is vertically infinite or supports adding new "Pages" to keep the document growing for long-term treatments.

***

## 4. Key Features

### 4.1 Medical Record Templates (Settings)

* **Field Builder**: Define the structured fields for the header.
* **Workspace Config**: Upload a default background image (optional) and set the workspace behavior (scaling, default brush, etc.).

### 4.2 Patient History (Patient Detail Page)

* **Chronological Timeline**: View all past records in an easy-to-read list.
* **Continuous View**: Option to view "Full History," which stitches multiple records together into one long scrolling document, maintaining the "Notability" feel.

### 4.3 Drawing & Media Experience

* **Touch Optimization**: Specialized support for Apple Pencil and tablet gestures.
* **Media Management**: Automatic compression of user-uploaded images to maintain performance while preserving clinical detail.

***

## 5. Technical Requirements

### 5.1 Architecture

* **Responsive Design**: Mobile support for viewing/basic edits; Tablet/Desktop support for full clinical documentation.
* **Canvas Implementation**:
  * Use a layered canvas approach: Base Image Layer (Template) -> Media Layer (Uploaded Photos) -> Drawing Layer (Vector data).
  * Save drawing data as vector paths to allow scaling and future editing.
* **Storage**: Background images and user uploads stored in S3/Cloud Storage; paths and field data stored in PostgreSQL (JSON fields).

### 5.2 Performance & Sync

* **Background Snapshots**: Generate high-performance PNG/WebP previews of clinical workspaces for quick browsing in the patient history list.
* **Autosave**: Robust "Draft" state and unsaved changes detection.

***

## 6. Out of Scope (MVP)

* **Medical Grade Encryption**: Use standard industry security for Phase 1.
* **PDF Export**: In-app viewing only.
* **Offline Mode**: Web-based online access required.
* **Real-time Collaboration**: One user editing a record at a time.

***

## 7. Future Roadmap

* **Advanced Shapes**: Auto-completion for circles, rectangles, and arrows.
* **Text Injection**: Add text boxes anywhere in the Clinical Workspace.
* **OCR**: Extracting text from uploaded clinical reports.
* **Patient Sharing**: Exporting specific sections to show patients their progress.
