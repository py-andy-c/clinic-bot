# Design Document: LLM-Powered LINE Bot for Physical Therapy Clinics

**Version:** 4.0
**Date:** October 16, 2025
**Author:** Gemini

## 1. Overview

This document provides a detailed technical design for the LLM-powered LINE Bot service as specified in PRD Version 5.0. The system is designed to provide a conversational interface for patients to manage physical therapy appointments, an integrated Google Calendar experience for therapists, and a web-based administration platform for clinic staff.

The project will be structured as a monorepo, containing both the backend and frontend code, and will be deployed using a developer-centric stack (Railway and Vercel) for rapid initial development and iteration.

## 2. Goals and Non-Goals

### 2.1. Goals
*   To build a robust webhook service to process incoming messages from the LINE Platform.
*   To integrate a Large Language Model (LLM) for natural language understanding and conversation management using a tool-based approach.
*   To provide seamless, bi-directional synchronization with therapists' Google Calendars.
*   To develop a secure, multi-tenant web application for clinic administration with Google OAuth for login.
*   To design a database schema that is normalized and efficient for core operations.

### 2.2. Non-Goals (for this version)
*   The system will not process payments directly. Subscription management is designed but payment gateway integration is future work.
*   The system will not have a complex Role-Based Access Control (RBAC) system. All authenticated admins have the same permissions.

## 3. System Architecture

The system is composed of several key services that work in concert.



### 3.1. Components

1.  **LINE Platform:** The external, user-facing messaging platform.
2.  **Admin Web Frontend (React/Vite on Vercel):** An SPA providing the UI for clinic administrators. It handles user authentication and communicates with the Backend Service.
3.  **Backend Service (Python/FastAPI on Railway):** The core of the application.
    *   **Webhook Handlers:** Endpoints for LINE messages and Google Calendar push notifications.
    *   **Admin API:** Secure RESTful endpoints for the Admin Frontend.
    *   **Core Logic:** Manages business logic, state, and orchestrates calls between services.
    *   **Google Calendar Service:** A dedicated module for all Google Calendar API interactions.
    *   **LLM Service:** A module that manages the interaction with an external LLM, including prompt construction and tool/function call handling.
4.  **PostgreSQL Database (Railway):** A managed PostgreSQL instance provided by Railway, co-located with the backend service.
5.  **External Services:** Google Calendar API, Google AI Platform (Gemini API), Google Identity Services (for admin login).

## 4. API Design

### 4.1. Webhook Endpoints

*   `POST /webhook/line`: Single entry point for LINE Messaging API events. Validates `X-Line-Signature`.
*   `POST /webhook/gcal`: Receives push notifications from Google Calendar for calendar changes.

### 4.2. Admin REST API

All endpoints are prefixed with `/api/admin` and require an authenticated session established via Google OAuth.

*   **Authentication**
    *   `GET /auth/google/login`: Initiates the Google OAuth2 flow for an admin user.
    *   `GET /auth/google/callback`: The redirect URI for Google. The backend exchanges the code for user info, verifies the user is a registered admin, and creates a session (e.g., JWT).
    *   `POST /auth/logout`: Invalidates the session.
*   **Therapists**
    *   `POST /therapists`: Invite a new therapist via email.
    *   `GET /therapists`: List all therapists.
    *   `GET /therapists/{id}/gcal/auth`: Initiates the Google Calendar OAuth2 flow for a specific therapist.
*   **Settings & Patients**
    *   `GET /settings`: Retrieve clinic settings.
    *   `PUT /settings`: Update clinic settings.
    *   `GET /patients`: List patients and their LINE link status.

## 5. Database Schema Design

The schema is multi-tenant, with most tables having a `clinic_id`.

```sql
CREATE TABLE clinics (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    line_channel_id VARCHAR(255) UNIQUE NOT NULL,
    line_channel_secret VARCHAR(255) NOT NULL,
    subscription_status VARCHAR(50) DEFAULT 'trial', -- 'trial', 'active', 'past_due', 'canceled'
    trial_ends_at TIMESTAMPTZ,
    stripe_customer_id VARCHAR(255), -- For future payment integration
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE clinic_admins (
    id SERIAL PRIMARY KEY,
    clinic_id INTEGER REFERENCES clinics(id),
    email VARCHAR(255) UNIQUE NOT NULL,
    google_subject_id VARCHAR(255) UNIQUE NOT NULL, -- Stable unique ID from Google
    full_name VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE therapists (
    id SERIAL PRIMARY KEY,
    clinic_id INTEGER REFERENCES clinics(id),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    gcal_credentials JSONB, -- Stores encrypted OAuth2 refresh_token, access_token, etc.
    gcal_sync_enabled BOOLEAN DEFAULT FALSE,
    gcal_watch_resource_id VARCHAR(255), -- To manage Google Push Notifications channel
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- The clinic's official list of patients
CREATE TABLE patients (
    id SERIAL PRIMARY KEY,
    clinic_id INTEGER REFERENCES clinics(id),
    full_name VARCHAR(255) NOT NULL,
    phone_number VARCHAR(50) NOT NULL,
    UNIQUE (clinic_id, phone_number)
);

-- Maps a LINE platform identity to a patient in the clinic's system
CREATE TABLE line_users (
    id SERIAL PRIMARY KEY,
    line_user_id VARCHAR(255) UNIQUE NOT NULL,
    patient_id INTEGER REFERENCES patients(id) UNIQUE -- Enforces 1-to-1 mapping
);

CREATE TABLE appointment_types (
    id SERIAL PRIMARY KEY,
    clinic_id INTEGER REFERENCES clinics(id),
    name VARCHAR(255) NOT NULL,
    duration_minutes INTEGER NOT NULL
);

CREATE TABLE appointments (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER REFERENCES patients(id),
    therapist_id INTEGER REFERENCES therapists(id),
    appointment_type_id INTEGER REFERENCES appointment_types(id),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'confirmed', 'canceled_by_patient', 'canceled_by_clinic'
    gcal_event_id VARCHAR(255)
);
```

## 6. LLM Interaction Design

*(Details on System Prompt, Context Injection, and Tools remain as specified in the previous version)*

## 7. Implementation Milestones

### Milestone 1: Foundational Setup & Core Backend
*   **Goal:** Establish the project structure, database, and core service connections.
*   **Tasks:**
    *   Initialize Git repository with the monorepo structure.
    *   Set up Python/FastAPI project in `backend/`.
    *   Define database schema and set up Alembic for migrations.
    *   Implement core ORM models (Clinic, Therapist, Patient).
    *   Implement a basic LINE webhook endpoint that can receive and log messages.
    *   Implement the Google OAuth2 flow for *therapists* to grant calendar access.

### Milestone 2: Core Patient-Facing Functionality (Chatbot MVP)
*   **Goal:** Enable a patient to successfully book a new appointment via conversation.
*   **Tasks:**
    *   Integrate the LLM service wrapper (e.g., for Gemini API).
    *   Implement the system prompt construction logic.
    *   Implement the first LLM tools: `get_therapist_availability` and `create_appointment`.
    *   Implement the patient identification and phone number linking flow.
    *   End-to-end testing: A user can start a conversation, link their account, and book an appointment which appears on the therapist's calendar.

### Milestone 3: Full Chatbot Functionality & Admin Platform Scaffolding
*   **Goal:** Complete the chatbot's conversational capabilities and begin the admin interface.
*   **Tasks:**
    *   Implement remaining LLM tools: `get_existing_appointments`, `cancel_appointment`, `get_last_appointment_therapist`.
    *   Implement the therapist-initiated cancellation flow (`/webhook/gcal`).
    *   Set up the React frontend project in `frontend/`.
    *   Implement Admin Authentication using Google OAuth.
    *   Build the Admin API endpoints and frontend UI for Therapist Management (viewing, inviting, checking sync status).

### Milestone 4: Full Admin Feature Set & Pre-Launch Polish
*   **Goal:** Complete the administration platform and harden the system for production.
*   **Tasks:**
    *   Build Admin UI and APIs for the Settings page (Appointment Types, Clinic Hours).
    *   Build Admin UI and APIs for Patient Management (viewing patients and their link status).
    *   Implement the embedded Google Calendar view on the admin dashboard.
    *   Integrate structured logging and error tracking (Sentry).
    *   Configure CI/CD pipelines for Vercel and Railway.

### Milestone 5: Launch & Post-Launch
*   **Goal:** Onboard the first beta clinic and iterate based on feedback.
*   **Tasks:**
    *   Deploy to production on Vercel and Railway.
    *   Onboard the first pilot clinic and provide support.
    *   Monitor system performance, error rates, and user feedback.
    *   Begin planning and implementation of post-launch features, starting with the Stripe integration for billing.

## 8. Code/Folder Structure

The project will be structured as a monorepo to simplify development and dependency management between the frontend and backend.

```
clinic-bot/
├── backend/                      # Python/FastAPI backend application
│   ├── alembic/
│   │   ├── versions/
│   │   └── env.py
│   ├── src/
│   │   ├── api/
│   │   ├── core/
│   │   ├── crud/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── main.py
│   ├── tests/
│   ├── .env.example
│   ├── Dockerfile                # For Railway deployment
│   └── requirements.txt
│
├── frontend/                     # React/Vite frontend application
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── .env.example
│   ├── index.html
│   └── package.json
│
└── .gitignore                    # Root gitignore for both projects
```

## 9. Development and Deployment Strategy

### 9.1. Local Development (Script-Based)

This approach runs all services directly on the host machine for simplicity and speed.

#### 9.1.1. Prerequisites
*   Python 3.12+ and `venv` installed.
*   Node.js and `npm` (or `yarn`) installed.
*   A local PostgreSQL server instance installed and running.
*   `ngrok` CLI installed.

#### 9.1.2. Backend Setup (`backend/` directory)
1.  **Navigate to Backend Directory:** `cd backend`
2.  **Create Virtual Environment & Install Dependencies:**
    ```bash
    python -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    ```
3.  **Configure Environment:** Copy `backend/.env.example` to `backend/.env` and update it with your local database URL and API keys.
4.  **Run Migrations:** `alembic upgrade head`
5.  **Run Server:** In one terminal, run the backend server with hot reload:
    ```bash
    uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload
    ```

#### 9.1.3. Frontend Setup (`frontend/` directory)
1.  **Navigate to Frontend Directory:** `cd frontend`
2.  **Install Dependencies:** `npm install`
3.  **Configure Environment:** Copy `frontend/.env.example` to `frontend/.env` to set the backend API URL for development.
4.  **Run Server:** In a second terminal, run the frontend dev server:
    ```bash
    npm run dev
    ```

### 9.2. Testing with LINE and `ngrok`

`ngrok` is used to expose the local backend to the public internet for webhook testing.

1.  **Start your local backend server** on `localhost:8000`.
2.  **Start `ngrok`** in a third terminal:
    ```bash
    ngrok http 8000
    ```3.  **Configure LINE Webhook:** Take the public HTTPS URL provided by `ngrok` (e.g., `https://random.ngrok-free.app`) and set it in your LINE Developers Console as `https://random.ngrok-free.app/webhook/line`.
4.  **Test:** Send messages to your LINE Official Account. The requests will be tunneled to your local FastAPI application.

### 9.3. Production Deployment (Vercel + Railway)

This strategy leverages specialized platforms for an optimal developer experience and rapid deployment.

#### 9.3.1. Frontend Deployment (Vercel)
1.  **Connect Repository:** Connect the monorepo Git repository (e.g., on GitHub) to your Vercel account.
2.  **Configure Project:**
    *   Vercel will automatically detect the React/Vite project.
    *   Set the **Root Directory** to `frontend`.
    *   Set the build command (`npm run build`) and output directory (`dist`).
3.  **Set Environment Variables:** In the Vercel project settings, add the production backend URL (e.g., `VITE_API_BASE_URL=https://your-backend.up.railway.app`).
4.  **Deploy:** Pushing to the `main` branch will automatically trigger a deployment. Vercel will also create preview deployments for every pull request.

#### 9.3.2. Backend & Database Deployment (Railway)
1.  **Connect Repository:** Connect the same monorepo Git repository to your Railway account.
2.  **Create Project:** Create a new project from the repository.
3.  **Add Services:**
    *   **PostgreSQL Database:** Add a new PostgreSQL service. Railway will automatically provision it and provide connection credentials.
    *   **Backend Service:** Add a new service pointing to the Git repository.
4.  **Configure Backend Service:**
    *   In the service settings, set the **Root Directory** to `backend`.
    *   Railway will detect the `Dockerfile` and use it to build and deploy the application.
    *   In the **Variables** tab, add all the required environment variables from your `.env` file (API keys, secrets). Use the private database URL provided by the Railway PostgreSQL service for `DATABASE_URL`.
    *   Generate a public domain for the service.
5.  **Configure Production Webhooks:**
    *   Use the public domain from Railway (e.g., `https://your-backend.up.railway.app`) and configure it in the LINE Developers Console and Google Cloud Console as the production webhook and redirect URI.
