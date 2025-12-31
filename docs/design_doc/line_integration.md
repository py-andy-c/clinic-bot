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

## Backend Technical Design

### API Endpoints

#### `POST /api/line/webhook`
- **Description**: LINE webhook endpoint for receiving messages and events
- **Headers**: `X-Line-Signature` (webhook signature for verification)
- **Request Body**: LINE webhook payload (events array)
- **Response**: `{ success: true }`
- **Errors**:
  - 400: Invalid signature, malformed payload
  - 500: Internal server error

#### `POST /clinic/notifications/preview`
- **Description**: Generate notification preview for appointment changes
- **Request Body**: `{ appointment_id: number, changes: object }`
- **Response**: `{ notification_preview: { message: string, recipients: string[] } }`
- **Errors**:
  - 400: Invalid appointment or changes
  - 500: Internal server error

#### `POST /clinic/notifications/send`
- **Description**: Send notification for appointment changes
- **Request Body**: `{ appointment_id: number, message: string, send_to_patient: boolean, send_to_practitioner: boolean }`
- **Response**: `{ success: true }`
- **Errors**:
  - 400: Invalid request
  - 500: LINE API error (logged, not returned to client)

#### `GET /liff/availability-notifications`
- **Description**: Get user's availability notification preferences
- **Response**: `AvailabilityNotification[]`
- **Errors**: 500

#### `POST /liff/availability-notifications`
- **Description**: Create availability notification preference
- **Request Body**: `{ appointment_type_id: number, practitioner_id?: number, time_windows: TimeWindow[], date_range: DateRange }`
- **Response**: `{ notification_id: number }`
- **Errors**:
  - 400: Validation errors
  - 500: Internal server error

#### `DELETE /liff/availability-notifications/{id}`
- **Description**: Delete availability notification preference
- **Path Parameters**: `id` (notification ID)
- **Response**: `{ success: true }`
- **Errors**: 404, 500

### Database Schema

**LineUsers Table**:
- `id`: Primary key
- `clinic_id`: Foreign key to clinics
- `line_user_id`: String (LINE user ID)
- `display_name`: String (nullable, fetched from LINE API)
- `picture_url`: String (nullable, profile picture URL)
- `status`: Enum ('active', 'inactive')
- `created_at`: DateTime
- `updated_at`: DateTime

**AvailabilityNotifications Table**:
- `id`: Primary key
- `line_user_id`: Foreign key to line_users
- `clinic_id`: Foreign key to clinics
- `appointment_type_id`: Foreign key to appointment_types
- `practitioner_id`: Foreign key to users (nullable)
- `time_windows`: JSONB (array of time window objects)
- `date_range`: JSONB (start_date, end_date)
- `last_notified_date`: Date (nullable)
- `is_active`: Boolean
- `created_at`: DateTime
- `updated_at`: DateTime

**MessageLogs Table**:
- `id`: Primary key
- `line_user_id`: Foreign key to line_users
- `clinic_id`: Foreign key to clinics
- `message_type`: Enum ('incoming', 'outgoing')
- `content`: Text
- `reply_token`: String (nullable, for reply messages)
- `trigger_source`: String (nullable, 'patient_triggered', 'clinic_triggered', 'system_triggered')
- `created_at`: DateTime

**Constraints**:
- Line user IDs unique per clinic (composite unique index)
- Availability notifications have valid date ranges and time windows
- Message logs retained for audit and debugging

### Business Logic Implementation

**LINEService** (`backend/src/services/line_service.py`):
- `verify_webhook_signature()`: Verifies LINE webhook signature
- `send_text_message()`: Sends messages via LINE Messaging API
- `get_user_profile()`: Fetches user profile from LINE API

**NotificationService** (`backend/src/services/notification_service.py`):
- `send_appointment_*()`: Methods for different appointment notifications
- `generate_notification_message()`: Creates localized notification messages
- `send_availability_notification()`: Sends slot availability alerts

**ClinicAgentService** (`backend/src/services/clinic_agent_service.py`):
- Manages OpenAI Agent SDK integration
- Handles conversation state per user per clinic
- Processes messages with clinic-specific context

**Key Business Logic**:
- Webhook signature verification ensures authenticity
- Message type detection (reply vs push) optimizes costs
- Notification rules prevent redundant messaging
- Clinic isolation maintained for all LINE users
- Thread-safe user creation prevents race conditions

---

## Frontend Technical Design

### State Management Strategy

#### Server State (API Data)
- [x] **Data Source**: LINE webhook (backend-only), notification preview API, availability notifications API
- [x] **Current Implementation**: Using `useApiData` hook for availability notifications
  - **Note**: Most LINE functionality is backend webhook processing, minimal frontend state
- [x] **Query Keys** (when migrated to React Query):
  - `['availability-notifications']` - User's notification preferences
  - `['notification-preview', appointmentId, changes]` - Notification preview
- [x] **Cache Strategy**:
  - **Current**: Custom cache with TTL (5 minutes default)
  - **Future (React Query)**:
    - `staleTime`: 5 minutes (notification preferences)
    - `cacheTime`: 10 minutes

#### Client State (UI State)
- [x] **NotificationModal State** (`frontend/src/components/NotificationModal.tsx`):
  - **State Properties**:
    - `isOpen`: Modal visibility
    - `preview`: Notification preview from backend
    - `sending`: Loading state during send
  - **Actions**:
    - Show preview, send notification, skip
  - **Usage**: Post-appointment change notification flow

- [x] **LIFF Availability Notifications State**:
  - **State Properties**: Notification preferences list, create/edit forms
  - **Usage**: LIFF patient interface for managing availability notifications

#### Form State
- [x] **NotificationModal**: Simple form with message preview and send/skip options
- [x] **Availability Notification Form**: Complex form with appointment type, practitioner, time windows, date ranges

### Component Architecture

#### Component Hierarchy
```
EventModal (appointment edit success)
  └── NotificationModal
      ├── MessagePreview
      ├── SendButton
      └── SkipButton

LiffApp (patient interface)
  └── AvailabilityNotificationsPage
      ├── NotificationPreferencesList
      ├── CreateNotificationForm
      │   ├── AppointmentTypeSelector
      │   ├── PractitionerSelector
      │   ├── TimeWindowSelector
      │   └── DateRangeSelector
      └── DeleteConfirmationModal
```

#### Component List
- [x] **NotificationModal** (`frontend/src/components/NotificationModal.tsx`)
  - **Props**: `isOpen`, `onClose`, `preview`, `onSend`, `onSkip`
  - **State**: Sending status, message customization
  - **Dependencies**: `useApiData` (send notification), modal management

- [x] **AvailabilityNotificationsPage** (LIFF component)
  - **Props**: None (LIFF context)
  - **State**: Notification preferences, form states
  - **Dependencies**: `useApiData` (CRUD operations), LIFF API calls

### User Interaction Flows

#### Flow 1: Appointment Change Notification (Clinic)
1. Clinic user edits appointment successfully
2. Backend returns `notification_preview` in response
3. `NotificationModal` opens automatically
4. User sees preview of notification message and recipients
5. User can customize message (optional)
6. User clicks "發送" to send notification
7. Notification sent via LINE API
8. Modal closes, success confirmation shown
   - **Edge case**: No LINE user → Modal shows "無 LINE 通知" message
   - **Edge case**: User clicks "略過" → Modal closes, no notification sent
   - **Error case**: LINE API fails → Error logged, user sees success (appointment saved)

#### Flow 2: Availability Notification Setup (LIFF)
1. Patient navigates to availability notifications in LIFF
2. Patient clicks "新增通知設定"
3. Patient selects appointment type
4. Patient optionally selects practitioner
5. Patient sets time windows (e.g., "每週一 10:00-12:00")
6. Patient sets date range (start/end dates)
7. Patient saves notification preference
8. System starts monitoring for available slots
   - **Edge case**: Invalid time windows → Validation error shown
   - **Edge case**: Date range in past → Error message shown

#### Flow 3: Availability Notification Receipt
1. Background scheduler finds available slot matching user preferences
2. System sends LINE notification: "您預約的時段現在有空位了！請盡快預約。"
3. User receives notification in LINE
4. User can click link to book appointment
   - **Edge case**: Multiple matches → Only one notification per day per preference
   - **Edge case**: User already booked → Notification still sent (user can manage preferences)

#### Flow 4: LINE Chatbot Interaction
1. Patient sends message to clinic's LINE official account
2. LINE webhook receives message
3. Backend processes message through AI agent
4. AI generates response with clinic context
5. Response sent back via LINE (free reply message)
6. Conversation history maintained for context
   - **Edge case**: AI response violates safety rules → Fallback response or blocked
   - **Edge case**: Clinic context unavailable → Generic response

### Edge Cases and Error Handling

#### Edge Cases
- [x] **Race Condition**: User switches clinic during notification send
  - **Solution**: Notifications scoped to appointment clinic, clinic context validated

- [x] **Concurrent Notifications**: Multiple appointment changes trigger notifications simultaneously
  - **Solution**: Each notification processed independently, no conflicts

- [x] **Component Unmount**: Notification modal unmounts during send
  - **Solution**: `useApiData` checks `isMountedRef`, prevents state updates after unmount

- [x] **Network Failure**: LINE API fails during notification send
  - **Solution**: Error logged, appointment operation succeeds, user sees success

- [x] **Stale Data**: Notification preview based on outdated appointment data
  - **Solution**: Preview generated server-side with current appointment state

- [x] **LINE User Not Linked**: Patient has no LINE account linked
  - **Solution**: No notification modal shown, operations proceed normally

- [x] **Availability Notification Duplicates**: Multiple slots match same preference same day
  - **Solution**: `last_notified_date` prevents duplicate notifications per day

- [x] **Chatbot Context Missing**: AI agent lacks clinic-specific instructions
  - **Solution**: Fallback to generic responses, error logged for admin review

#### Error Scenarios
- [x] **API Errors (4xx, 5xx)**:
  - **User Message**: "通知發送失敗" (notification send failed)
  - **Recovery Action**: User can retry or skip notification
  - **Implementation**: Error handling in notification modal

- [x] **Validation Errors**:
  - **User Message**: Field-level validation messages
  - **Field-level Errors**: Shown in availability notification forms
  - **Implementation**: Frontend validation, backend validation

- [x] **Loading States**:
  - **Initial Load**: Loading notification preview
  - **Send**: Loading during LINE API call
  - **Implementation**: Modal shows loading spinners

- [x] **Permission Errors (403)**:
  - **User Message**: "無權限發送通知"
  - **Recovery Action**: Modal shows read-only preview
  - **Implementation**: Backend permission checks

### Testing Requirements

#### E2E Tests (Playwright)
- [ ] **Test Scenario**: Appointment notification flow
  - Steps:
    1. Edit appointment as clinic user
    2. Verify notification modal appears
    3. Verify preview shows correct message and recipients
    4. Click send notification
    5. Verify success message
  - Assertions: Modal appears, preview correct, notification sent successfully

- [ ] **Test Scenario**: Notification skip option
  - Steps:
    1. Edit appointment
    2. Click "略過" in notification modal
    3. Verify modal closes without sending
  - Assertions: No notification sent, appointment edit succeeds

#### Integration Tests (MSW)
- [ ] **Test Scenario**: Notification modal with preview
  - Mock API responses: Notification preview, send success
  - User interactions: Open modal, send notification
  - Assertions: Preview displayed, send API called correctly

- [ ] **Test Scenario**: Availability notifications management
  - Mock API responses: CRUD operations for notification preferences
  - User interactions: Create, view, delete preferences
  - Assertions: Preferences managed correctly, validation works

- [ ] **Test Scenario**: Error handling
  - Mock API responses: LINE API failures, validation errors
  - User interactions: Trigger errors
  - Assertions: Errors handled gracefully, user can retry

#### Unit Tests
- [ ] **Component**: `NotificationModal`
  - Test cases: Renders preview, handles send/skip, shows loading states, error handling
- [ ] **Service**: LINE webhook processing
  - Test cases: Signature verification, event processing, chatbot integration
- [ ] **Service**: Notification service
  - Test cases: Message generation, recipient determination, LINE API integration

### Performance Considerations

- [x] **Data Loading**: 
  - Notification previews generated server-side to avoid client-side computation
  - Availability notifications fetched with pagination if needed
  - Chatbot responses cached briefly to reduce API calls

- [x] **Caching**: 
  - Current: Custom cache for availability notifications
  - Future: React Query will provide better caching

- [x] **Optimistic Updates**: 
  - Notification send uses optimistic updates (UI shows success immediately)

- [x] **Lazy Loading**: 
  - Notification modal loaded on demand
  - LIFF availability notification components loaded lazily

- [x] **Memoization**: 
  - Notification preview memoized to prevent unnecessary re-renders

---

## Integration Points

### Backend Integration
- [x] **Dependencies on other services**:
  - LINE integration depends on LINE Messaging API
  - Notifications integrate with appointment service
  - Chatbot uses OpenAI API
  - Webhooks processed asynchronously

- [x] **Database relationships**:
  - Line users linked to clinics (clinic isolation)
  - Availability notifications linked to line users and appointment types
  - Message logs for audit trail

- [x] **API contracts**:
  - LINE webhook follows LINE specification
  - Internal APIs follow REST conventions

### Frontend Integration
- [x] **Shared components used**:
  - `BaseModal`, `LoadingSpinner`
  - Form components for availability notifications

- [x] **Shared hooks used**:
  - `useApiData` (availability notifications, notification send)
  - `useModal` (notification modal)

- [x] **Shared stores used**:
  - None (minimal state management)

- [x] **Navigation/routing changes**:
  - LIFF routing includes availability notifications
  - Clinic interface integrates notification modal

---

## Security Considerations

- [x] **Authentication requirements**:
  - LINE webhooks verified with signature validation
  - Clinic users authenticated for notification operations
  - LIFF tokens validated for availability notifications

- [x] **Authorization checks**:
  - Notification permissions checked before sending
  - Clinic isolation enforced for all LINE operations
  - Admin-only operations (void receipts) protected

- [x] **Input validation**:
  - LINE webhook payloads validated
  - Notification messages sanitized
  - Availability notification preferences validated

- [x] **XSS prevention**:
  - User-generated content in LINE messages sanitized
  - HTML content properly escaped

- [x] **CSRF protection**:
  - API operations protected with authentication
  - LINE webhooks verified with signatures

- [x] **Data isolation**:
  - Clinic isolation enforced for LINE users and messages
  - User data properly scoped to clinics

---

## Summary

This document covers:
- LINE message types (free reply vs paid push messages)
- Notification rules (patient vs clinic triggered changes)
- Appointment notification overhaul (decoupled post-action flow)
- Availability notifications (user preferences, periodic monitoring)
- Proactive LINE user collection (webhook events, profile fetching)
- LINE chatbot (AI-powered responses, clinic context)
- Edge cases (notification failures, concurrent events, API failures)
- Backend technical design (webhook handler, services, database)
- Frontend technical design (notification modal, availability management)

All business rules are enforced at both frontend (UX) and backend (source of truth) levels.

**Migration Status**: This document has been migrated to the new template format. Frontend sections reflect current implementation. LINE integration is primarily backend-focused with webhook processing, with minimal frontend components for notifications and LIFF availability management.
