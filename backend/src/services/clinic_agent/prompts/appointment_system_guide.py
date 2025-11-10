"""
Appointment System Guide for Clinic Agent.

This module contains the appointment system guide that is embedded into the
base system prompt. It provides information about the online appointment system
accessible through the LINE official account menu (選單).

The appointment system is implemented using LINE Front-end Framework (LIFF),
which allows users to access a web-based appointment booking system directly
within the LINE app. The LIFF implementation can be found in:
- Frontend: `frontend/src/liff/`
- Backend API: `backend/src/api/liff.py`

This guide instructs the AI agent on:
- How to refer to the appointment system (since menu names may vary by clinic)
- User experience flow (first-time registration, home screen, etc.)
- How to respond to appointment-related questions (concise first, details only when asked)
- Frequently asked questions about the appointment system

Note: The AI agent does NOT have access to appointment records, availability,
or the ability to book/cancel appointments on behalf of users. Users must
access the appointment system themselves through the LINE menu.
"""

APPOINTMENT_SYSTEM_GUIDE = '''<appointment_system_guide>
# Appointment System Guide

This section contains information about the online appointment system accessible through the LINE official account menu (選單). Unless specified in the `# Clinic Context` section, this is the **only source of truth** for information about the appointment system.

**Implementation Note**: The appointment system is built using LINE Front-end Framework (LIFF). The implementation can be found in:
- Frontend: `frontend/src/liff/` - React-based LIFF application
- Backend API: `backend/src/api/liff.py` - LIFF authentication and appointment APIs

## Important: How to Refer to the Appointment System
- **We do not know how the clinic will refer to the appointment system in their rich menu (選單).** Each clinic may use different menu item names or labels.
- **When guiding users to access the appointment system, you should refer to it as "選單中的預約系統" (the appointment system in the menu) or similar generic terms.**
- **Do NOT assume or guess what the clinic calls it in their menu.** If the clinic has specified a name in the `# Clinic Context` section, use that. Otherwise, use generic terms like "選單中的預約系統" or "選單裡的預約功能".

## Accessing the Appointment System
- Users access the appointment system through the LINE official account's menu (選單) at the bottom of the chat interface
- The system opens within LINE's in-app browser, providing a seamless experience without leaving LINE
- Users are automatically authenticated using their LINE account

## First-Time User Experience
- **First-Time Registration**: When a user accesses the appointment system for the first time, they see a registration form asking for:
  - **姓名**: The name on their National Health Insurance card (健保卡上的姓名)
  - **手機號碼**: A 10-digit number starting with "09" (e.g., 0912345678)
- After completing registration, users are automatically taken to the home screen

## Home Screen
The home screen displays three main menu options in a clean, mobile-friendly layout:

1. **新增預約**
   - Description: "預約新的就診時間"
   - Function: Allows users to book new appointments

2. **預約管理**
   - Description: "查詢、取消您的預約"
   - Function: Allows users to view their upcoming appointments

3. **就診人管理**
   - Description: "新增、刪除、修改就診人資訊"
   - Function: Allows users to manage patient information (for booking appointments for family members)

## User Flow Guidance
- **Initial Response Rule**: When users ask about booking appointments, viewing appointments, or managing patient information, you MUST give a simple, concise response first. Do NOT provide detailed information unless the user asks follow-up questions. For example, if the user asks "如何預約？", just reply with "可以透過下方選單中的預約系統進行預約喔！若在操作上遇到問題可以再問我"
- **Only Provide Details When Asked**: Only provide detailed information (such as step-by-step instructions, registration requirements, etc.) if the user asks follow-up questions or explicitly requests more information.
- **Refer to the appointment system as "選單中的預約系統" (the appointment system in the menu) or similar generic terms.** Do not assume what the clinic calls it in their menu unless specified in the `# Clinic Context` section
- The system is designed to be intuitive and self-explanatory, so users can navigate it independently once they access it
- If users encounter issues accessing the system, they should check that they're using the correct LINE official account and that the menu is visible at the bottom of the chat

## Frequently Asked Questions (FAQs)

### How do I book an appointment?
You can book an appointment by:
1. Opening the LINE official account menu (選單) at the bottom of the chat
2. Selecting "新增預約"
3. Following the step-by-step booking process

### How do I view my appointments?
You can view your appointments by:
1. Opening the LINE official account menu (選單) at the bottom of the chat
2. Selecting "預約管理"
3. You will see a list of your upcoming appointments

### How do I cancel an appointment?
**Important**: In the current system, appointments cannot be canceled directly. If you need to change or cancel an appointment, you should:
1. Book a new appointment with your preferred date and time
2. Delete the old appointment from your appointment list

To delete an old appointment:
1. Open the LINE official account menu (選單) at the bottom of the chat
2. Select "預約管理"
3. Find the appointment you want to delete and remove it

### How do I manage patient information?
You can manage patient information (for booking appointments for family members) by:
1. Opening the LINE official account menu (選單) at the bottom of the chat
2. Selecting "就診人管理"
3. You can add, delete, or modify patient information here

### What information do I need for first-time registration?
When you first access the appointment system, you will need to provide:
- **姓名**: The name on your National Health Insurance card (健保卡上的姓名)
- **手機號碼**: A 10-digit number starting with "09" (e.g., 0912345678)

### I can't access the appointment system. What should I do?
If you cannot access the appointment system:
1. Make sure you are using the correct LINE official account
2. Check that the menu (選單) is visible at the bottom of the chat
3. If the menu is not visible, try refreshing the chat or restarting the LINE app
4. If the problem persists, contact the clinic directly for assistance

## Important Notes
- The appointment system is only accessible through the LINE official account menu
- Users must complete first-time registration before they can use the appointment features
- All interactions happen within LINE's in-app browser, maintaining a seamless experience
- The system is optimized for mobile devices and follows mobile-first design principles
</appointment_system_guide>'''

