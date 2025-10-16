# Product Requirements Document (PRD): LLM-Powered LINE Bot for Physical Therapy Clinics

**Version:** 5.0
**Date:** October 16, 2025
**Author:** Gemini

## 1. Introduction

This document outlines the product requirements for an LLM-powered LINE Bot designed to automate and streamline appointment scheduling for physical therapy clinics in Taiwan. The service aims to reduce administrative overhead, minimize scheduling errors, and improve the patient experience by providing a 24/7 conversational assistant through the clinic's official LINE account. This PRD focuses on a one-to-one relationship, where each LINE user manages their own appointments.

## 2. User Personas

### 2.1. Patient (Primary User)
*   **Name:** 陳小姐 (Ms. Chen)
*   **Age:** 35
*   **Occupation:** Office Worker
*   **Needs & Goals:**
    *   Easily schedule, reschedule, and cancel her physical therapy appointments without having to call the clinic.
    *   Flexibility to book appointments based on her busy schedule.
    *   Receive timely reminders for her upcoming appointments to avoid missing them.
    *   Optionally choose her preferred therapist.
*   **Pain Points:**
    *   Frustration with waiting on hold when calling the clinic.
    *   Forgetting appointments due to a busy schedule.
    *   Difficulty finding a suitable appointment time that fits her work hours.

### 2.2. 物理治療師 (Physical Therapist)
*   **Name:** 王大明 (Wang Da-ming)
*   **Age:** 42
*   **Needs & Goals:**
    *   A clear and up-to-date view of his daily appointments, including the patient's name and the purpose of the visit.
    *   An easy way to manage and submit his available time slots.
    *   To reduce no-shows and last-minute cancellations.
    *   Seamless integration with his personal calendar (Google Calendar).
*   **Pain Points:**
    *   Manually updating his availability across different platforms.
    *   Patients not showing up for their appointments, leading to wasted time.
    *   Time spent on administrative tasks instead of patient care.

### 2.3. Clinic Administrator
*   **Name:** 李先生 (Mr. Li)
*   **Age:** 50
*   **Needs & Goals:**
    *   An efficient system to manage appointments for all therapists.
    *   To reduce the time staff spends on phone calls for appointment scheduling.
    *   A centralized platform to configure clinic-wide settings, like appointment types and durations.
    *   An overview of appointment statistics and therapist schedules.
*   **Pain Points:**
    *   High volume of phone calls for appointment management.
    *   Double bookings and scheduling conflicts.
    *   Difficulty in coordinating schedules for multiple therapists.

## 3. Detailed User & System Flows

### 3.1. Patient Onboarding & Account Linking

**Problem:** A patient's LINE display name is unreliable for identification. The system must securely link a patient's stable LINE User ID to their official patient record in the clinic's system.

**Flow:**
1.  **First Interaction:** When a user initiates a scheduling request for the first time, the bot will detect that their LINE User ID is not linked to a patient record.
2.  **Verification Prompt:** The bot will reply with: "為了確認您的身份，請輸入您在診所登記的手機號碼。" ("To verify your identity, please enter the mobile phone number you registered with the clinic.")
3.  **Backend Verification:** The system checks the entered phone number against the clinic's patient database.
4.  **Successful Linking:** If a match is found, the system securely associates the patient's LINE User ID with their patient record. The bot confirms with: "感謝您！您的帳號已成功連結，現在可以開始預約了。" ("Thank you! Your account is now linked, and you can begin scheduling.")
5.  **Failed Linking:** If the phone number is not found, the bot responds: "抱歉，找不到符合這個手機號碼的病患資料。請確認後再試一次，或直接聯繫診所。" ("Sorry, we could not find a patient record with this mobile number. Please check and try again, or contact the clinic directly.")

### 3.2. Patient Appointment Management (Conversational Flow)

#### 3.2.1. Appointment Intent & Duration
To ensure accurate scheduling, the bot will confirm the type of appointment. The user is always assumed to be booking for themselves.

1.  **Initial Request:** The user expresses intent to schedule (e.g., "我想預約").
2.  **Intent Classification & Selection:**
    *   The LLM analyzes the user's request to pre-classify intent (e.g., "First Visit" for new patients).
    *   The bot presents a list of options for confirmation: "好的，請問您想預約的項目是？\n1. 初診評估 (60分鐘)\n2. 一般複診 (30分鐘)\n3. 徒手治療 (45分鐘)\n請回覆數字選擇，不同項目的時間長度不同。" ("Okay, which service would you like to book? \n1. First Visit Assessment (60 mins)\n2. Standard Follow-up (30 mins)\n3. Manual Therapy (45 mins)\nPlease reply with the number to select. Durations vary by service.")
3.  **System Action:** The system retrieves the duration for the selected appointment type and proceeds to find available slots of the required length.

#### 3.2.2. Scheduling an Appointment

*   **Scenario: User specifies a therapist with variations.**
    *   **User Input Examples:** "我想預約王大名治療師" (Typo), "找大明" (Partial name), "跟上次一樣的治療師" ("The same therapist as last time").
    *   **System Action:** The LLM is provided with the clinic's list of therapists as context to perform a fuzzy match or query the patient's appointment history. If the input is ambiguous, the bot will ask for clarification.
    *   **Bot Response (Presenting Slots):** "好的，王大明治療師在以下時段有空檔可安排【初診評估】，請選擇：\n1. 10/23 (四) 14:00\n2. 10/23 (四) 15:00\n3. 10/24 (五) 16:00\n請直接回覆數字選擇時段。" ("Okay, Therapist Wang Da-ming has availability for a [First Visit Assessment] at the following times. Please select one:\n1. 10/23 (Thurs) 14:00\n2. 10/23 (Thurs) 15:00\n3. 10/24 (Fri) 16:00\nPlease reply with the number to choose a time slot.")
    *   **User Confirmation:** "1"
    *   **Final Confirmation:** The bot confirms all details: "好的，已為您預約【王大明治療師】，時間是【10月23日 (四) 14:00】，項目為【初診評估】。期待與您見面！" ("Okay, your appointment with [Therapist Wang Da-ming] is scheduled for [October 23 (Thurs) 14:00] for a [First Visit Assessment]. We look forward to seeing you!")

#### 3.2.3. Rescheduling & Cancellation (Edge Case Handling)

*   **Edge Case: User tries to reschedule/cancel but has no upcoming appointments.**
    *   **Bot Response:** "查詢不到您有任何即將到來的預約。您需要安排一個新的預約嗎？" ("I couldn't find any upcoming appointments for you. Would you like to schedule a new one?")

*   **Edge Case: User has multiple upcoming appointments.**
    *   **Bot Response:** "您有多個預約，請問您想更改或取消哪一個？\n1. 【10/23 (四) 14:00 - 王大明治療師】\n2. 【10/30 (四) 16:00 - 陳醫師】\n請回覆數字選擇。" ("You have multiple appointments. Which one would you like to change or cancel?\n1. [10/23 (Thurs) 14:00 - Therapist Wang]\n2. [10/30 (Thurs) 16:00 - Dr. Chen]\nPlease reply with the number to select.")

### 3.3. Google Calendar Event Details

*   **Event Title:** `[Patient Name] - [Appointment Type]` (e.g., `陳小姐 - 初診評估`)
*   **Event Description:**
    *   Patient Name: `[Patient Name]`
    *   Patient Phone: `[Patient's Registered Phone Number]`
    *   Appointment Type: `[Appointment Type]` (e.g., 初診評估)
    *   Scheduled Via: `LINE Bot`
*   **Guests:** The patient will **not** be added as a guest.
*   **Event Color:** A specific color for bot-scheduled appointments.

### 3.4. Therapist-Initiated Cancellation

**Flow:**
1.  **Therapist Action:** The therapist deletes the Google Calendar event.
2.  **Google API Trigger:** A Google Calendar Push Notification (webhook) informs our system.
3.  **System Action:** The system identifies the patient linked to the event.
4.  **Patient Notification:** The bot sends a message to the patient: "提醒您，您原訂於【10/23 (四) 14:00】與【王大明治療師】的預約已被診所取消。很抱歉造成您的不便，請問需要為您重新安排預約嗎？" ("This is a notification that your appointment with [Therapist Wang Da-ming] on [10/23 (Thurs) 14:00] has been canceled by the clinic. We apologize for the inconvenience. Would you like to reschedule?")

## 4. Backend Administration Platform (Web-based)

### 4.1. Clinic Onboarding & Login

1.  **Sign Up:** The clinic administrator signs up on our service website.
2.  **Free Trial:** A 14-day free trial is automatically activated.
3.  **Login:** Staff can log in using their email and password.

### 4.2. Platform Layout & Pages

*   **儀表板 (Dashboard):** An overview of key metrics: upcoming appointments, new patient linkings, and cancellation rates.
*   **預約行事曆 (Appointment Calendar):** This page features an embedded Google Calendar interface, displaying a consolidated, read-only view of all synced therapist calendars. This gives the admin a complete overview of the clinic's schedule.
*   **治療師管理 (Therapist Management):** A list of all therapists.
*   **病患管理 (Patient Management):** A list of registered patients, showing their name, phone number, and linked LINE account status.
*   **設定 (Settings):** Configuration for the clinic and the bot.

### 4.3. Therapist Management Flow

1.  **Add Therapist:** The admin enters the therapist's name and email.
2.  **Invite & Connect Calendar:** The therapist receives an email, sets a password, and is guided through the Google OAuth2 flow to grant calendar permissions.

### 4.4. Settings Page

*   **Appointment Types:**
    *   An interface for admins to Create, Read, Update, and Delete appointment types.
    *   For each type, the admin must define:
        *   `Service Name` (e.g., "初診評估")
        *   `Duration` in minutes (e.g., 60)
*   **Clinic Hours:** Define standard operating hours to constrain booking availability.
*   **Holidays/Closures:** A tool to block out dates or date ranges when the clinic is closed.
*   **Reminder Timing:** Configure hours before an appointment for the reminder (default: 24).

## 5. Customer Acquisition & Onboarding for Clinics

**Strategy: The Full Webhook Trial**
1.  **Clear Value Proposition:** We will communicate that to enable the full conversational AI experience, our service must become the primary message handler. This will replace any existing keyword-based auto-replies.
2.  **Guided Setup:** The admin platform will provide a step-by-step wizard to guide the clinic administrator through configuring the LINE OA webhook, copying their unique URL and pasting it into the LINE Official Account Manager.
3.  **Full Experience Trial:** Once the webhook is configured, the clinic gets the full functionality. The bot handles all appointment-related conversations and provides a standard reply for non-related queries, directing them to manual staff follow-up. This provides a true-to-life trial of the paid service.

## 6. Monetization & Billing

### 6.1. Subscription Model

*   **Free Trial:** 14-day full-featured free trial.
*   **Monthly/Annual Plans:** Tiered plans based on the number of active therapists.
    *   **Solo Practitioner:** 1-2 therapists.
    *   **Small Clinic:** 3-5 therapists.
    *   **Large Clinic:** 6+ therapists.

### 6.2. Billing User Flow & Service

1.  **Trial Conversion:** A banner in the admin dashboard will prompt for subscription.
2.  **Payment Processing:** Integration with **Stripe** for secure payment processing via Stripe Checkout.
3.  **Subscription Management:** A Stripe customer portal, linked from our platform, will handle billing management.

### 6.3. Service Authentication

*   A middleware layer will verify the LINE channel signature and check the `channel_id`. It will then check the clinic's `subscription_status`. If the status is not `active` or `trial`, the API will reject the request, ensuring only paying customers receive service.

## 7. Additional Edge Cases & Considerations

*   **Timezone Handling:** The system will be hardcoded for Taiwan's timezone (UTC+8).
*   **Concurrent Requests:** The system will use database transactions with optimistic or pessimistic locking to prevent double-booking of a single time slot.
*   **API Downtime:** Robust monitoring and alerting for our service and its dependencies (LINE API, Google Calendar API).
*   **User Input Errors:** If a user replies with an invalid option, the bot will gently re-prompt them to provide a valid selection.
