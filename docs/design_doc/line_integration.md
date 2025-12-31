# LINE Integration - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for LINE integration, including the chatbot, message types, notifications, availability notifications, and proactive LINE user management.

---

## Key Business Logic

### 1. LINE Message Types

**Free Messages (Reply Messages)**:
- **Cost**: FREE
- **When**: Sent within 24 hours of a user message using `reply_token`
- **Use Case**: AI replies to patient messages
- **Implementation**: Uses `LINEService.send_text_message()` with `reply_token` parameter

**Paid Messages (Push Messages)**:
- **Cost**: PAID (consumes LINE message quota)
- **When**: Proactive notifications sent to users
- **Use Case**: Appointment confirmations, cancellations, reminders, availability alerts
- **Implementation**: Uses `LINEService.send_text_message()` without `reply_token` parameter

**Rationale**: Optimizes LINE message costs by using free reply messages when possible, reserving paid push messages for proactive notifications.

### 2. Notification Rules

**General Principle**: Skip notifications when the user already knows about the change (e.g., they see confirmation in UI).

**Patient Notifications**:
- **Patient-triggered changes**: NO notification to patient (they already see confirmation in UI)
- **Clinic-triggered changes**: YES notification to patient
- **Exception**: If clinic admin confirms auto-assignment OR changes from auto-assigned to another practitioner AND time did not change → NO notification to patient (patient still sees "不指定")

**Practitioner Notifications**:
- Always sent when appointment is manually assigned, cancelled, or edited
- Never sent for auto-assigned appointments (practitioners don't see them)

**Rationale**: Reduces redundant notifications while ensuring users are informed of changes they didn't initiate.

### 3. Appointment Notification Overhaul

**Post-Action Flow**: Notifications are decoupled from appointment modifications.

**Workflow**: Commit appointment change → Success state → Follow-up notification modal

**Benefits**:
- Appointment changes succeed even if notification fails
- User can customize notification message before sending
- Explicit "Send" vs "Skip" choice

**Implementation**: Backend returns `notification_preview` in response, frontend shows `NotificationModal` after success.

**Rationale**: Improves reliability and gives users control over notifications.

### 4. Availability Notifications

**Purpose**: Allow LINE users to sign up for availability notifications when desired appointment slots become available.

**User Flow**:
1. User sets up notification preferences (appointment type, practitioner, time windows, date range)
2. System checks for matching slots periodically (up to 3 times per day: 9am, 3pm, 9pm Taiwan time)
3. When slots become available, user receives LINE notification
4. User can manage (view/delete) their notification preferences

**Notification Rules**:
- Only one notification per day per notification preference (deduplication)
- Only sends if notification has future dates in time windows
- Checks `last_notified_date != today` to prevent duplicates

**Rationale**: Helps patients find appointments when slots become available, improving clinic utilization.

### 5. Proactive LINE User Collection

**Purpose**: Create `LineUser` database entries proactively when users interact with the clinic's official account, not just when they authenticate via LIFF.

**Implementation**:
- **Webhook Events**: Process `follow`, `unfollow`, and `message` events
- **Profile Fetching**: Fetch user profile from LINE API when `follow` event received
- **Thread-Safe**: Uses database-level locking to prevent race conditions
- **Clinic-Specific**: Each clinic has its own `LineUser` entry for the same LINE user ID (strict clinic isolation)

**Rationale**: Enables clinics to manage AI response settings and user preferences for users who haven't used LIFF yet.

### 6. LINE Chatbot

**Architecture**: Simple chatbot using OpenAI Agent SDK to generate AI-powered responses.

**Flow**: Patient → LINE Platform → Webhook Endpoint → AI Agent → Response → LINE Platform → Patient

**Components**:
1. **LINE Webhook Endpoint** (`/api/line/webhook`): Receives POST requests from LINE, verifies signature, extracts message content
2. **Clinic Agent Service**: Manages conversation state per LINE user per clinic, integrates OpenAI Agent SDK
3. **AI Agent**: Configured with clinic-specific instructions, processes patient messages

**Features**:
- Clinic-specific instructions and context
- Conversation history stored in PostgreSQL
- Test feature for admins to test chatbot responses
- Evaluation suite for systematic testing

**Rationale**: Provides automated customer service while maintaining clinic-specific context and personality.

---

## Edge Cases

### 1. Notification Failures

**Scenario**: LINE notification fails to send during appointment edit.

**Behavior**: Notification failures do NOT block the appointment edit. Appointment edit succeeds, notification failure is logged, user receives success confirmation.

**Rationale**: Notification is a side effect, not a core requirement.

### 2. Patients without LINE

**Scenario**: Patient doesn't have LINE account linked.

**Behavior**: No LINE notifications sent. Appointment operations proceed normally. No follow-up notification modal shown.

### 3. No-op Edits

**Scenario**: Edit results in no patient-facing changes (e.g., only internal clinic notes changed).

**Behavior**: Backend returns no `notification_preview`, ending the flow at "Success" state. No notification modal shown.

### 4. User Abandons Notification Step

**Scenario**: User closes notification modal without sending.

**Behavior**: Appointment change remains saved in database. This is intended behavior as data integrity is the priority.

### 5. Concurrent Webhook Events

**Scenario**: Multiple webhook events arrive simultaneously for the same user.

**Behavior**: Database-level locking prevents duplicate `LineUser` entries. Thread-safe implementation handles race conditions gracefully.

### 6. LINE API Failures

**Scenario**: LINE API fails when fetching user profile or sending message.

**Behavior**: 
- Profile fetching: Create `LineUser` with minimal info (line_user_id only), log warning
- Message sending: Log error, return error response, but don't block appointment operations

---

## Technical Design

### LINE Webhook Handler

**Endpoint**: `POST /api/line/webhook`

**Security**: Verifies webhook signature using LINE channel secret.

**Event Types**:
- `follow`: User adds official account as friend → Create `LineUser`, fetch profile
- `unfollow`: User blocks/removes account → Mark user as inactive (soft delete)
- `message`: User sends message → Process via chatbot, create `LineUser` if doesn't exist

**Implementation**: Uses `LINEService` for signature verification and message extraction.

### Notification Service

**Methods**:
- `send_appointment_confirmation()`: Sends confirmation when appointment is created
- `send_appointment_cancellation()`: Sends cancellation notification
- `send_appointment_edit_notification()`: Sends edit/reschedule notification
- `send_practitioner_appointment_notification()`: Notifies practitioner of new appointment
- `send_availability_notification()`: Sends availability alert to user

**Trigger Source Tracking**: All push messages tracked with `trigger_source` label (`patient_triggered`, `clinic_triggered`, `system_triggered`).

### Reminder Service

**Purpose**: Send appointment reminders to patients before appointments.

**Rules**:
- Runs hourly to check for appointments needing reminders
- Skips reminders for appointments created within reminder window (patient already knows)
- Marks `reminder_sent_at` after sending to prevent duplicates
- Configuration: `clinic.reminder_hours_before` (default: 24 hours)

**Rationale**: Helps patients remember appointments while avoiding redundant notifications.

### Clinic Agent Service

**Purpose**: Manages AI-powered chatbot conversations per clinic.

**Features**:
- Clinic-specific instructions and context
- Conversation history stored in PostgreSQL
- Multi-turn conversation support
- Safety boundaries and grounding in clinic context

**Test Feature**: Admins can test chatbot responses with different clinic contexts.

**Evaluation Suite**: Systematic evaluation suite with ~20 diverse test cases covering different scenarios (clinic information, health consultation, safety boundaries, etc.).

---

## Summary

This document covers:
- LINE message types (free reply messages vs paid push messages)
- Notification rules (skip when user already knows, patient vs clinic triggered)
- Appointment notification overhaul (post-action flow, decoupled from modifications)
- Availability notifications (user preferences, periodic checks, deduplication)
- Proactive LINE user collection (webhook events, profile fetching, clinic isolation)
- LINE chatbot (AI-powered responses, clinic-specific context, evaluation suite)
- Edge cases (notification failures, patients without LINE, concurrent events)
- Technical design (webhook handler, notification service, reminder service, clinic agent service)

All business rules are enforced at both frontend (UX) and backend (source of truth) levels.



