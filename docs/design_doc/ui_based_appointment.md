# UI-Based Appointment System Design Document

**Version:** 1.0  
**Date:** October 31, 2025  
**Status:** Ready for Implementation

---

## Table of Contents

1. [Overview](#1-overview)
2. [User Experience Design](#2-user-experience-design)
3. [Technical Architecture](#3-technical-architecture)
4. [LINE Integration](#4-line-integration)
5. [Database Schema Changes](#5-database-schema-changes)
6. [API Design](#6-api-design)
7. [Frontend Design](#7-frontend-design)
8. [Calendar Integration](#8-calendar-integration)
9. [Implementation Strategy](#9-implementation-strategy)
10. [Implementation Phases](#10-implementation-phases)

---

## 1. Overview

### 1.1 Motivation

Based on user feedback, we are transitioning from an AI-powered chatbot appointment system to a UI-based approach. This change aims to:
- Provide more direct and intuitive appointment booking
- Reduce ambiguity in user intent interpretation
- Offer better visual feedback and control
- Simplify the technical architecture

### 1.2 Key Changes

- **Disable AI agents**: Remove `backend/src/clinic_agents` entirely
- **Replace conversational flow**: Use form-based UI instead of chat
- **Maintain LINE integration**: Use LINE LIFF (LINE Front-end Framework) for web apps inside LINE
- **Preserve core functionality**: Google Calendar sync, appointment management, admin dashboard

---

## 2. User Experience Design

### 2.1 LINE Rich Menu Configuration

Clinics configure a **Rich Menu** in their LINE Official Account with three options:

| Option | Action |
|--------|--------|
| **線上約診** | Opens LIFF app for new appointment booking |
| **預約查詢** | Opens LIFF app showing all appointments for LINE-linked patients |
| **個人設定** | Opens LIFF app for patient profile management |

**Technical Note**: Rich Menu is configured through LINE Official Account Manager or Messaging API. Each button triggers a LIFF URL with a different path/query parameter.

### 2.2 Appointment Booking Flow

#### 2.2.1 First-Time User Flow

```
1. User clicks "線上約診"
   ↓
2. LIFF app opens in full-screen browser
   ↓
3. LIFF SDK auto-authenticates with LINE (no OAuth prompt needed)
   ↓
4. System receives LINE user profile (userId, displayName)
   ↓
5. System checks LINE user ID → No existing patient record for this clinic
   ↓
6. **Registration Screen**
   - Display: "歡迎使用 {診所名稱} 線上預約系統"
   - User enters:
     * 姓名 (Legal name)
       - Note: "此為您健保卡上的姓名"
     * 手機號碼 (Phone number)
       - Placeholder: "0912-345-678"
       - Format hint: "請輸入您的手機號碼"
   - [下一步] button
   ↓
7. Create first patient record + LINE user record
   ↓
8. Redirect to appointment booking page
```

**Technical Note:** 
- LIFF automatically authenticates users without OAuth flow
- Phone number is **manually entered** by user (no LINE OAuth phone scope needed)
- No phone verification required for MVP

#### 2.2.2 Returning User Flow

```
1. User clicks "線上約診"
   ↓
2. LIFF app opens
   ↓
3. System checks LINE user ID → Link found
   ↓
4. Direct to appointment booking page
```

#### 2.2.3 Appointment Booking Steps

**Step 1: Select Appointment Type**
```
UI: Vertical list of cards
[初診評估]
[一般複診]
[徒手治療]

Each card shows:
- Type name
- Duration (for admin reference only, not shown to patient)
```

**Step 2: Select Practitioner**
```
UI: Vertical list of practitioner cards
- Only show practitioners who offer the selected type
- Include special option: [不指定治療師]

Each card shows:
- Practitioner name
- Profile photo (optional)

Filter logic:
- appointment_types table has many-to-many with users (practitioners)
- Only show practitioners where practitioner_appointment_types.appointment_type_id matches
```

**Step 3: Select Date & Time**
```
UI: Calendar + Time slot list

Calendar widget (month view):
- Current date: Highlighted with border/badge
- Dates with availability: Normal appearance (clickable)
- Dates without availability: Greyed out (not clickable)
- Selected date: Highlighted

When user selects a date:
→ Show list of available time slots for that date

Time slot list:
上午
09:00
10:00
11:00

下午
14:00
15:00
16:00
...

Availability calculation:
- Consider practitioner's default availability (practitioner_availability table)
- Subtract availability exceptions (availability_exceptions table)
- Subtract existing appointments (appointments table)
- If "不指定": Union of all qualified practitioners' availability
```

**Step 4: Select Patient**
```
UI: Dropdown + Add button

Dropdown options:
- 陳小明
- 陳媽媽
- 陳爸爸

(Sorted by creation time, oldest first)

[+ 新增就診人] Button

If "+ 新增就診人" clicked:
→ Modal appears
   - Input: 姓名 (name only)
   - [取消] [確認]
→ New patient created, associated with LINE user
→ Added to dropdown
```

**Step 5: Add Notes (Optional)**
```
UI: Text area

備註（選填）
┌─────────────────────────────┐
│                             │
│                             │
│                             │
└─────────────────────────────┘

Placeholder: "如有特殊需求，請在此說明"
Max length: 500 characters
```

**Step 6: Confirmation**
```
UI: Summary card

預約確認
─────────────────
預約類型：初診評估
治療師：王大明
日期時間：2025年11月15日 (五) 上午10:00
就診人：陳小明
備註：左肩疼痛約一週

[返回修改] [確認預約]
```

**Step 7: Success + Calendar Button**
```
UI: Success screen

✓ 預約成功

您的預約已確認
─────────────────
預約類型：初診評估
治療師：王大明
日期時間：2025年11月15日 (五) 上午10:00
就診人：陳小明

[加入行事曆]

When "加入行事曆" clicked:
→ Download .ics file
→ Phone automatically prompts to add to default calendar

Note: User can close LIFF browser window when done
```

### 2.3 Appointment Query Flow

```
1. User clicks "預約查詢"
   ↓
2. LIFF app opens
   ↓
3. Show list of all upcoming appointments for ALL patients linked to this LINE user
   ↓
4. Each appointment card shows:
   - Patient name
   - Appointment type
   - Practitioner name
   - Date & time
   - Notes (if any)
   - [取消預約] button
   ↓
5. When "取消預約" clicked:
   → Confirmation dialog: "確定要取消此預約嗎？"
   → If confirmed: 
      - Update appointment status to 'canceled_by_patient'
      - Delete event from Google Calendar via Calendar API
      - Show success message

Note: We have access to delete calendar events because we created them
via Google Calendar API with the practitioner's OAuth credentials
```

### 2.4 Personal Settings Flow

```
1. User clicks "個人設定"
   ↓
2. LIFF app opens
   ↓
3. Show list of patients linked to this LINE user (sorted by creation time)
   
   就診人管理
   
   陳小明 [刪除]
   陳媽媽 [刪除]
   陳爸爸 [刪除]
   
   [+ 新增就診人]
   ↓
4. Can add or remove any patient (must keep at least one)
   - Deletion blocked if only one patient remains
   - Confirmation dialog: "確定要刪除此就診人？刪除後該就診人的所有預約記錄將無法查詢"
```

---

## 3. Technical Architecture

### 3.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    LINE Platform                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Rich Menu    │  │ LIFF App     │  │ Messaging API│ │
│  │ (3 buttons)  │  │ (Web app)    │  │ (Reminders)  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
           │                 │                  │
           └─────────────────┼──────────────────┘
                             │
┌─────────────────────────────────────────────────────────┐
│                   Frontend (React)                      │
│  - LIFF SDK Integration                                 │
│  - Appointment booking UI                               │
│  - Appointment query UI                                 │
│  - Patient management UI                                │
└─────────────────────────────────────────────────────────┘
                             │
                             │ REST API
                             │
┌─────────────────────────────────────────────────────────┐
│                Backend (FastAPI)                        │
│  - LINE Login OAuth handler                             │
│  - LIFF endpoint protection                             │
│  - Appointment CRUD APIs                                │
│  - Availability calculation                             │
│  - Google Calendar sync                                 │
└─────────────────────────────────────────────────────────┘
                             │
                   ┌─────────┴─────────┐
                   │                   │
┌──────────────────▼───┐   ┌───────────▼──────────┐
│   PostgreSQL         │   │ Google Calendar API  │
│   (Core data)        │   │ (Practitioner sync)  │
└──────────────────────┘   └──────────────────────┘
```

### 3.2 Components Removed

- ❌ **AI Agents**: `backend/src/clinic_agents/` (entire directory)
- ❌ **Agent orchestrator**: No more workflow routing
- ❌ **Triage agent**: No more intent classification
- ❌ **Conversation history**: No more session storage
- ❌ **LINE webhook for messages**: No more message processing

### 3.3 Components Modified

- ✏️ **LINE service**: Keep for sending reminders, remove message parsing
- ✏️ **Database models**: Modify `line_users` and `patients` relationship
- ✏️ **Admin dashboard**: No changes needed

### 3.4 Components Added

- ✅ **LIFF SDK**: Frontend integration for LINE environment
- ✅ **LINE Login OAuth**: Backend handler for phone number retrieval
- ✅ **Appointment UI endpoints**: New REST APIs for booking
- ✅ **ICS file generation**: Calendar event download

---

## 4. LINE Integration

### 4.1 LINE LIFF (LINE Front-end Framework)

**What is LIFF?**
- LINE Front-end Framework allows web apps to run inside LINE messenger
- Provides access to LINE user profile without explicit OAuth
- Full-screen, half-screen, or tall view options

**LIFF Setup:**
1. Create LIFF app in LINE Developers Console
2. Register endpoint URLs:
   - `https://yourdomain.com/liff/appointment`
   - `https://yourdomain.com/liff/query`
   - `https://yourdomain.com/liff/settings`
3. Get LIFF ID (e.g., `1234567890-abcdefgh`)
4. Initialize LIFF SDK in React app:

```typescript
import liff from '@line/liff';

await liff.init({ liffId: '1234567890-abcdefgh' });

if (!liff.isLoggedIn()) {
  liff.login();
}

const profile = await liff.getProfile();
// profile.userId, profile.displayName, profile.pictureUrl
```

**LIFF Permissions:**
- `profile`: Get user ID and display name (default)
- `openid`: Get ID token
- `email`: Get email address (requires approval)

**Note**: LIFF **cannot** directly get phone number. Must use LINE Login OAuth with special scope.

### 4.2 LIFF Authentication (No OAuth Required)

**How LIFF Authentication Works:**
- LIFF SDK automatically authenticates users when app opens
- No OAuth flow or user consent prompts needed
- Provides: `userId`, `displayName`, `pictureUrl`
- **Does NOT provide phone number** (requires separate OAuth with business verification)

**Our Approach:**
- Use LIFF for user identification only
- **Phone number collected via manual input** (no verification for MVP)
- Simpler implementation, no business verification delays

**Authentication Flow:**
```javascript
// Frontend: LIFF initialization
await liff.init({ liffId: LIFF_ID });

if (!liff.isLoggedIn()) {
  liff.login();  // Auto-redirects, no consent screen
}

// Get profile
const profile = await liff.getProfile();
// { userId: "U...", displayName: "...", pictureUrl: "..." }

// Send to backend
const response = await fetch('/api/auth/liff-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    line_user_id: profile.userId,
    display_name: profile.displayName,
    clinic_id: CLINIC_ID  // From LIFF URL or context
  })
});

const { token, is_first_time } = await response.json();

if (is_first_time) {
  // Show registration form (name + phone input)
  navigate('/register');
} else {
  // Proceed to booking
  navigate('/book');
}
```

**Backend Token Generation:**
```python
# Backend: /api/auth/liff-login
@router.post("/api/auth/liff-login")
async def liff_login(
    line_user_id: str,
    display_name: str,
    clinic_id: int
):
    # ✅ Validate clinic_id exists and is active
    clinic = db.query(Clinic).filter_by(
        id=clinic_id,
        is_active=True  # Assuming we add this field for clinic lifecycle management
    ).first()

    if not clinic:
        raise HTTPException(404, "Clinic not found or inactive")

    # Get or create LINE user
    line_user = db.query(LineUser).filter_by(
        line_user_id=line_user_id
    ).first()

    if not line_user:
        line_user = LineUser(
            line_user_id=line_user_id,
            display_name=display_name
        )
        db.add(line_user)
        db.commit()

    # Check if patient exists for this clinic
    patient = db.query(Patient).filter_by(
        line_user_id=line_user.id,
        clinic_id=clinic_id
    ).first()

    is_first_time = patient is None

    # Generate JWT with validated clinic context
    token = create_jwt({
        "line_user_id": line_user_id,
        "clinic_id": clinic_id,  # ✅ Validated clinic ID
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(days=7)
    })

    return {
        "token": token,
        "is_first_time": is_first_time,
        "display_name": display_name,
        "clinic_id": clinic_id
    }
```

**Key Benefits:**
- ✅ No business verification required
- ✅ Immediate implementation
- ✅ Works for all clinics
- ✅ Simple user experience
- ⚠️ Phone number not verified (acceptable for MVP)

### 4.3 Multi-Clinic Architecture

**Industry Best Practice: Single LIFF App with URL-based Clinic Context**

Based on research, creating separate LIFF apps per clinic is not the best practice. Instead, use a **single shared LIFF app** with clinic context passed via URL parameters. This is more maintainable, cost-effective, and follows SaaS architecture patterns.

**Architecture:**
```
Single LIFF App (one LIFF ID for all clinics)
    ↓
Rich Menu URLs contain clinic context: ?clinic_id=123
    ↓
Frontend extracts clinic_id from URL
    ↓
Backend validates and scopes all operations
```

**Rich Menu Configuration (Per Clinic):**
```
LINE Rich Menu → "線上約診" button
    ↓
Opens: https://liff.line.me/YOUR_LIFF_ID?clinic_id=123
```

**Frontend Clinic Context Extraction:**
```javascript
// Extract clinic context from URL
const urlParams = new URLSearchParams(window.location.search);
const clinicId = urlParams.get('clinic_id');

if (!clinicId) {
  // Error: Invalid access
  showError("請從診所的LINE官方帳號進入");
  return;
}

// Include in all API requests
const response = await fetch('/api/auth/liff-login', {
  method: 'POST',
  body: JSON.stringify({
    access_token: liff.getAccessToken(),
    line_user_id: profile.userId,
    display_name: profile.displayName,
    clinic_id: clinicId  // From URL parameter
  })
});
```

**Backend Clinic Validation:**
```python
@liff_login
def liff_login(request: LiffLoginRequest, db: Session):
    # ✅ Validate clinic_id exists and is active
    clinic = db.query(Clinic).filter_by(
        id=request.clinic_id,
        is_active=True  # Assuming we add this field
    ).first()

    if not clinic:
        raise HTTPException(404, "Clinic not found or inactive")

    # ✅ No line_liff_id needed - single shared LIFF app

    # Create JWT with validated clinic context
    jwt_payload = {
        'line_user_id': request.line_user_id,
        'clinic_id': clinic.id,  # Validated clinic ID
        'iat': now,
        'exp': now + timedelta(days=7)
    }

    token = jwt.encode(jwt_payload, SECRET_KEY, algorithm='HS256')
    return {'access_token': token}
```

**Security Benefits:**
- ✅ **Trusted Source**: Clinic context from validated URL parameter
- ✅ **Backend Validation**: Clinic existence and status verified
- ✅ **Tamper-Proof**: JWT signed with validated clinic_id
- ✅ **No External Dependencies**: No LINE API calls needed for clinic lookup
- ✅ **Fast Authentication**: Direct database lookup

**Advantages Over Multiple LIFF Apps:**
| Aspect | Single LIFF App + URL Params | Multiple LIFF Apps |
|--------|------------------------------|---------------------|
| **Setup Complexity** | ⭐ Low (one-time setup) | ⭐⭐⭐ High (per clinic) |
| **Maintenance** | ⭐ Easy (single codebase) | ⭐⭐⭐ Difficult (N apps) |
| **Deployment** | ⭐ Deploy once | ⭐⭐⭐ Deploy N times |
| **Scalability** | ⭐ Excellent | ⭐⭐ Limited |
| **Cost** | ⭐ Low | ⭐⭐⭐ High |
| **Security** | ⭐ Good (with validation) | ⭐⭐ Slightly better isolation |
| **Clinic Isolation** | ⭐ Enforced by backend | ⭐ Enforced by separate apps |

**Data Isolation:**
- One LINE user can have multiple patient records across different clinics
- Each patient record has `clinic_id` + `line_user_id`
- API queries always filter by both: `WHERE clinic_id = ? AND line_user_id = ?`
- Example:
  ```
  LINE User "U123" at Clinic A → Patient 1 (clinic_id=1, line_user_id=1)
  LINE User "U123" at Clinic B → Patient 2 (clinic_id=2, line_user_id=1)
  ```
- Clinic A only sees Patient 1, Clinic B only sees Patient 2

### 4.4 LINE Rich Menu Configuration

Clinics need to configure their LINE Rich Menu to include three buttons for the LIFF app. We provide two flexible options.

#### **Option 1: Manual Configuration (Recommended for Existing Menus)**

**Best for**: Clinics with existing rich menus who want to add our buttons

**Setup:**
1. Provide clinic with LIFF URLs (include their clinic_id):
   ```
   線上約診: https://liff.line.me/{SHARED_LIFF_ID}?clinic_id={clinic_id}&mode=book
   預約查詢: https://liff.line.me/{SHARED_LIFF_ID}?clinic_id={clinic_id}&mode=query
   個人設定: https://liff.line.me/{SHARED_LIFF_ID}?clinic_id={clinic_id}&mode=settings
   ```

2. Clinic admin manually configures via LINE Official Account Manager:
   - Navigate to **選單** (Rich Menu) settings
   - Either create new menu or edit existing menu
   - Add our 3 buttons to their layout
   - Set button actions to our LIFF URLs

3. Provide setup guide with:
   - Step-by-step instructions with screenshots
   - Recommended button layout (visual guide)
   - LIFF URLs ready to copy/paste

**Advantages:**
- ✅ Non-destructive: Doesn't affect existing menu
- ✅ Flexible: Can integrate with other buttons
- ✅ Clinic has full control over layout and design

#### **Option 2: Programmatic Pre-Built Menu (Safe, Non-Activated)**

**Best for**: New clinics or automated onboarding flow

**How it works:**
```python
# During clinic onboarding - create but DON'T activate
from linebot import LineBotApi
from linebot.models import RichMenu, RichMenuArea, RichMenuBounds, URIAction, RichMenuSize

api = LineBotApi(channel_access_token)

# Create rich menu
rich_menu_id = api.create_rich_menu(
    RichMenu(
        size=RichMenuSize(width=2500, height=1686),
        selected=False,  # ✅ Important: Don't auto-activate
        name="診所預約系統",
        chat_bar_text="選單",
        areas=[
            RichMenuArea(
                bounds=RichMenuBounds(x=0, y=0, width=833, height=1686),
                action=URIAction(uri=f'https://liff.line.me/{SHARED_LIFF_ID}?clinic_id={clinic_id}&mode=book')
            ),
            RichMenuArea(
                bounds=RichMenuBounds(x=833, y=0, width=834, height=1686),
                action=URIAction(uri=f'https://liff.line.me/{SHARED_LIFF_ID}?clinic_id={clinic_id}&mode=query')
            ),
            RichMenuArea(
                bounds=RichMenuBounds(x=1667, y=0, width=833, height=1686),
                action=URIAction(uri=f'https://liff.line.me/{SHARED_LIFF_ID}?clinic_id={clinic_id}&mode=settings')
            ),
        ]
    )
)

# Upload menu image
with open('menu_image.png', 'rb') as f:
    api.set_rich_menu_image(rich_menu_id, 'image/png', f)

# ✅ STOP HERE - Don't call set_default_rich_menu()
# Store rich_menu_id in database
db.execute(
    "UPDATE clinics SET line_rich_menu_id = ? WHERE id = ?",
    (rich_menu_id, clinic_id)
)
```

**What happens:**
- ✅ Rich menu is created in LINE's system
- ✅ Clinic's existing menu **remains active** (unchanged)
- ✅ New menu appears in LINE OA Manager as an option
- ✅ **Zero impact** on current setup - completely non-destructive

**Clinic activation options:**
1. **Activate as-is**: Go to LINE OA Manager → Select our menu → Set as default
2. **Edit then activate**: Modify our template → Customize → Activate
3. **Use as reference**: Copy settings to their existing menu
4. **Keep inactive**: Leave our menu dormant, use manual configuration instead

**Show clinic admin after creation:**
```
✓ 您的專屬選單已準備完成！

選項一：啟用預設選單（推薦新診所）
→ 前往 LINE 官方帳號後台 > 選單 >
  選擇「診所預約系統」> 設為預設選單

選項二：整合至現有選單（推薦有現有選單的診所）
→ 手動將以下按鈕加入您的現有選單：
  • 線上約診: https://liff.line.me/{SHARED_LIFF_ID}?clinic_id={clinic_id}&mode=book
  • 預約查詢: https://liff.line.me/{SHARED_LIFF_ID}?clinic_id={clinic_id}&mode=query
  • 個人設定: https://liff.line.me/{SHARED_LIFF_ID}?clinic_id={clinic_id}&mode=settings

[查看詳細設定教學]
```

#### **Database Schema Addition**

Add to `clinics` table:
```sql
ALTER TABLE clinics 
ADD COLUMN line_rich_menu_id VARCHAR(255);  -- Store programmatically created menu ID
```

#### **Comparison**

| Aspect | Option 1: Manual | Option 2: Programmatic |
|--------|------------------|------------------------|
| **Impact on existing menu** | None - clinic adds to existing | None - doesn't activate automatically |
| **Flexibility** | Complete control | Template-based, can be edited |
| **Setup time** | 5-10 minutes manual work | Instant creation, clinic activates later |
| **Best for** | Clinics with existing menus | New clinics or standardized setup |
| **Risk** | Zero risk | Zero risk (non-activated) |

**Recommendation**: 
- Implement both options
- Default to Option 2 (programmatic) during onboarding for convenience
- Always provide Option 1 instructions for clinics who prefer manual control
- Store `line_rich_menu_id` for tracking which clinics use our pre-built menu

### 4.5 LINE Messaging API (Notifications Only)

**Keep for:**
- **Appointment reminders**: Configurable timing (from clinic settings page, already implemented)
- **Clinic-initiated cancellations**: When clinic admin cancels an appointment through admin dashboard, send LINE message to patient
- **Google Calendar deletions**: When therapist deletes appointment from Google Calendar, send LINE message to patient (webhook-triggered)

**Example:**
```python
from linebot import LineBotApi
from linebot.models import TextSendMessage

api = LineBotApi(channel_access_token)

# Send reminder (timing from clinic settings)
api.push_message(
    to=line_user_id,
    messages=TextSendMessage(
        text=f"提醒您，{hours_before}小時後有預約，地點：XX診所，治療師：王大明"
    )
)

# Send clinic cancellation notification
api.push_message(
    to=line_user_id,
    messages=TextSendMessage(
        text="您的預約已被診所取消：2025/11/15 上午10:00 - 王大明治療師。如需重新預約，請點選「線上約診」"
    )
)
```

**Not needed:**
- ~~Appointment confirmation messages~~ (handled in LIFF UI)
- ~~Patient cancellation notifications~~ (handled in LIFF UI)

**Remove:**
- Webhook event handling for text messages
- Message parsing and intent detection
- Conversational responses

---

## 5. Database Schema Changes

### 5.1 Modified Relationship: LineUser to Patient (1-to-Many)

**Current (One-to-One):**
```sql
-- Current: line_users table
CREATE TABLE line_users (
  id SERIAL PRIMARY KEY,
  line_user_id VARCHAR(255) UNIQUE NOT NULL,
  patient_id INTEGER UNIQUE REFERENCES patients(id)  -- ❌ UNIQUE constraint
);
```

**New (One-to-Many):**
```sql
-- Modified: line_users table
CREATE TABLE line_users (
  id SERIAL PRIMARY KEY,
  line_user_id VARCHAR(255) UNIQUE NOT NULL,
  phone_number VARCHAR(50) NOT NULL,  -- ✅ Added: from LINE Login OAuth
  display_name VARCHAR(255),           -- ✅ Added: from LIFF profile
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_line_users_line_user_id ON line_users(line_user_id);
CREATE INDEX idx_line_users_phone ON line_users(phone_number);
```

**Multi-Clinic Support:**
- One LINE account = One `line_users` record (OAuth done once)
- One LINE user can create multiple patient records across different clinics
- Clinic isolation: Each clinic only sees their own patient records via `clinic_id` filtering
- Example: User registers at Clinic A (Patient 1), then at Clinic B (Patient 2)
  - Both patients have same `line_user_id`
  - Clinic A queries filter `clinic_id = A` → sees only Patient 1
  - Clinic B queries filter `clinic_id = B` → sees only Patient 2
  - Privacy maintained through database-level isolation

### 5.2 Modified: Patients Table

**Current:**
```sql
CREATE TABLE patients (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id),
  full_name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_clinic_patient_phone UNIQUE (clinic_id, phone_number)
);

-- Relationship: patients.line_user (one-to-one via line_users.patient_id)
```

**New:**
```sql
CREATE TABLE patients (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id),
  full_name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(50),              -- ✅ Nullable (additional patients don't need phone)
  line_user_id INTEGER REFERENCES line_users(id),  -- ✅ Added: foreign key to line_users
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ✅ Partial unique index (only when phone_number is not null)
-- This prevents multiple NULL values from violating uniqueness
CREATE UNIQUE INDEX uq_clinic_patient_phone 
ON patients(clinic_id, phone_number) 
WHERE phone_number IS NOT NULL;

CREATE INDEX idx_patients_line_user ON patients(line_user_id);
CREATE INDEX idx_patients_clinic ON patients(clinic_id);
CREATE INDEX idx_patients_created_at ON patients(created_at);  -- For sorting in UI
```

**Key Changes:**
- `phone_number`: Nullable (manual input during registration, only first patient typically has phone)
- `line_user_id`: FK to `line_users` (establishes one-to-many relationship)
- No `is_primary` field - sort by `created_at` in UI (oldest first)
- **Partial unique index**: Allows multiple NULL phone numbers while enforcing uniqueness for non-NULL values
- First patient gets phone from manual input during registration

### 5.3 Modified: Appointments Table

**Add `notes` field:**
```sql
ALTER TABLE appointments 
ADD COLUMN notes TEXT;
```

**Full schema (for reference):**
```sql
-- appointments reference calendar_events for timing
CREATE TABLE appointments (
  calendar_event_id INTEGER PRIMARY KEY REFERENCES calendar_events(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  appointment_type_id INTEGER NOT NULL REFERENCES appointment_types(id),
  status VARCHAR(50) NOT NULL,  -- 'confirmed', 'canceled_by_patient', 'canceled_by_clinic'
  notes TEXT  -- ✅ Added: patient notes
);
```

### 5.4 New: Practitioner-AppointmentType Mapping (Many-to-Many)

**Purpose**: Track which appointment types each practitioner can offer

```sql
CREATE TABLE practitioner_appointment_types (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_type_id INTEGER NOT NULL REFERENCES appointment_types(id) ON DELETE RESTRICT,  -- ⚠️ RESTRICT prevents deletion
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_practitioner_type UNIQUE (user_id, appointment_type_id)
);

CREATE INDEX idx_practitioner_types_user ON practitioner_appointment_types(user_id);
CREATE INDEX idx_practitioner_types_type ON practitioner_appointment_types(appointment_type_id);
```

**Usage:**
- Admin dashboard: Configure which types each practitioner offers (Clinic Admin only)
- Practitioner settings page: Practitioners configure their own offered types
- Booking UI: Filter practitioners by selected appointment type
- Warning system: Show warning if practitioner hasn't configured any types (similar to availability warning)

**Deletion Protection:**
- `ON DELETE RESTRICT` on `appointment_type_id`: Prevents deleting appointment types with active references
- Database will reject deletion if any practitioners are offering this type
- Application shows user-friendly error: "無法刪除此預約類型，因為有治療師正在提供此服務"

### 5.5 Schema Changes Summary

| Table | Change | Reason |
|-------|--------|--------|
| `line_users` | Add `display_name` | Store LINE profile data |
| `line_users` | Remove `patient_id` FK | Enable one-to-many relationship |
| `line_users` | Remove `phone_number` | Phone collected via manual input, stored in patients |
| `patients` | Add `line_user_id` FK | Link to LINE user (one-to-many) |
| `patients` | Make `phone_number` nullable | Manual input, not all patients need phone |
| `patients` | Use partial unique index | Allow multiple NULL phone numbers |
| `clinics` | Add `line_rich_menu_id` VARCHAR(255) | Track programmatically created menu |
| `clinics` | Add `is_active` BOOLEAN DEFAULT true | Enable/disable clinic access for maintenance |
| `appointments` | Add `notes` TEXT | Store patient-provided notes (備註) |
| `practitioner_appointment_types` | New table | Many-to-many: practitioners ↔ types |

**Implementation Note**: Fresh database - no migration scripts needed.

---

## 6. API Design

### 6.1 Authentication & User Management

#### **POST /api/auth/liff-login**

**Purpose**: Authenticate LIFF user and create/update LINE user record

**Request:**
```json
{
  "line_user_id": "U1234567890abcdef",
  "display_name": "陳小明",
  "liff_access_token": "eyJhbGc..."  // For verification
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 604800,  // 7 days in seconds
  "is_first_time": true,
  "display_name": "陳小明",
  "clinic_id": 1
}
```

**JWT Payload Structure:**
```json
{
  "line_user_id": "U1234567890abcdef",
  "clinic_id": 1,  // Critical for multi-tenant isolation
  "iat": 1730000000,  // Issued at
  "exp": 1730604800   // Expires at (7 days later)
}
```

**Logic:**
1. **Validate clinic_id** (from URL parameter):
   ```python
   # clinic_id comes from frontend URL parameter (?clinic_id=123)
   clinic = db.query(Clinic).filter_by(
       id=clinic_id,
       is_active=True  # Ensure clinic is active
   ).first()

   if not clinic:
       raise HTTPException(404, "Clinic not found or inactive")
   ```

2. **Verify LIFF token** (prevent token forgery):
   ```python
   response = requests.get(
       'https://api.line.me/oauth2/v2.1/verify',
       params={'access_token': liff_access_token}
   )
   if response.status_code != 200:
       raise Unauthorized("Invalid LIFF token")

   verified_data = response.json()
   # Verify line_user_id matches
   if verified_data['sub'] != line_user_id:
       raise Unauthorized("Line user ID mismatch")
   ```

3. Get or create LINE user:
   ```python
   line_user = db.query(LineUser).filter_by(
       line_user_id=line_user_id
   ).first()
   
   if not line_user:
       line_user = LineUser(
           line_user_id=line_user_id,
           display_name=display_name
       )
       db.add(line_user)
       db.commit()
   ```

4. Check if patient exists for this clinic:
   ```python
   patient = db.query(Patient).filter_by(
       line_user_id=line_user.id,
       clinic_id=clinic_id
   ).first()

   is_first_time = patient is None
   ```

5. Generate JWT with clinic_id:
   ```python
   from datetime import datetime, timedelta
   import jwt
   
   payload = {
       "line_user_id": line_user_id,
       "clinic_id": clinic_id,
       "iat": datetime.utcnow(),
       "exp": datetime.utcnow() + timedelta(days=7)
   }
   
   token = jwt.encode(
       payload,
       settings.JWT_SECRET,
       algorithm="HS256"
   )
   ```

5. Return token + metadata

**Security Notes:**
- LIFF token verification prevents impersonation attacks
- JWT includes `clinic_id` for authorization on all subsequent requests
- Token expires in 7 days (refresh mechanism TBD)

#### **POST /api/patients/primary**

**Purpose**: Create first patient after first-time LIFF authentication

**Headers:**
```
Authorization: Bearer {JWT_TOKEN}
```

**Request:**
```json
{
  "full_name": "陳小明",
  "phone_number": "0912345678"  // Manual input by user
}
```

**Response:**
```json
{
  "patient_id": 123,
  "full_name": "陳小明",
  "phone_number": "0912345678",
  "created_at": "2025-11-01T10:30:00Z"
}
```

**Logic:**
1. Extract `line_user_id` and `clinic_id` from JWT:
   ```python
   payload = verify_jwt(token)
   line_user_id = payload['line_user_id']
   clinic_id = payload['clinic_id']
   ```

2. Get LINE user record:
   ```python
   line_user = db.query(LineUser).filter_by(
       line_user_id=line_user_id
   ).first()
   if not line_user:
       raise NotFound("LINE user not found")
   ```

3. Validate phone number format (optional):
   ```python
   import re
   if phone_number and not re.match(r'^09\d{8}$', phone_number):
       raise ValueError("Invalid phone number format")
   ```

4. Create patient record:
   ```python
   patient = Patient(
       line_user_id=line_user.id,
       phone_number=phone_number,  # From user input
       full_name=full_name,
       clinic_id=clinic_id  # From JWT
   )
   db.add(patient)
   db.commit()
   ```

5. Return patient info

**Notes:**
- `clinic_id` comes from JWT (not request body) for security
- Phone number is **manually entered** by user (no verification)
- First patient typically has phone number, additional patients may not
- Phone format validation is optional for MVP

#### **POST /api/patients**

**Purpose**: Add additional patient to LINE user account

**Headers:**
```
Authorization: Bearer {JWT_WITH_LINE_USER_ID}
```

**Request:**
```json
{
  "clinic_id": 1,
  "full_name": "陳媽媽"
}
```

**Response:**
```json
{
  "patient_id": 124,
  "full_name": "陳媽媽"
}
```

**Logic:**
1. Extract `line_user_id` from JWT
2. Create patient record:
   - `line_user_id`: from JWT
   - `phone_number`: NULL (additional patients don't have phone)
   - `clinic_id`: from request
3. Return patient info

#### **GET /api/patients**

**Purpose**: Get all patients linked to LINE user

**Headers:**
```
Authorization: Bearer {JWT_WITH_LINE_USER_ID}
```

**Response:**
```json
{
  "patients": [
    {
      "id": 123,
      "full_name": "陳小明",
      "created_at": "2025-11-01T10:00:00+08:00"
    },
    {
      "id": 124,
      "full_name": "陳媽媽",
      "created_at": "2025-11-02T14:30:00+08:00"
    }
  ]
}
```

**Logic:**
- Get patients for this LINE user and clinic
- Sort by `created_at` ASC (oldest first = first registered patient shows first)
- Don't include `phone_number` in response (privacy - all under same LINE account)

#### **DELETE /api/patients/{patient_id}**

**Purpose**: Remove patient from LINE user account

**Headers:**
```
Authorization: Bearer {JWT_WITH_LINE_USER_ID}
```

**Response:**
```json
{
  "success": true,
  "message": "Patient removed"
}
```

**Logic:**
1. Verify patient belongs to this LINE user and clinic (via JWT + `clinic_id`)
2. Check if this is the last patient for this LINE user at this clinic:
   ```sql
   SELECT COUNT(*) FROM patients 
   WHERE line_user_id = ? AND clinic_id = ?
   ```
   - If count = 1: Block deletion with error "至少需保留一位就診人"
   - If count > 1: Proceed with deletion
3. Delete patient record or set `line_user_id` to NULL (soft delete preserves appointment history)

### 6.2 Appointment Type & Practitioner

#### **GET /api/clinics/{clinic_id}/appointment-types**

**Purpose**: Get all appointment types for clinic

**Response:**
```json
{
  "appointment_types": [
    {
      "id": 1,
      "name": "初診評估",
      "duration_minutes": 60
    },
    {
      "id": 2,
      "name": "一般複診",
      "duration_minutes": 30
    }
  ]
}
```

#### **GET /api/clinics/{clinic_id}/practitioners**

**Purpose**: Get practitioners filtered by appointment type

**Query Parameters:**
- `appointment_type_id`: Filter by type (optional)

**Response:**
```json
{
  "practitioners": [
    {
      "id": 5,
      "full_name": "王大明",
      "picture_url": "https://...",
      "offered_types": [1, 2]  // IDs of types this practitioner offers
    },
    {
      "id": 6,
      "full_name": "李小華",
      "picture_url": "https://...",
      "offered_types": [1]
    }
  ]
}
```

**Logic:**
```sql
-- Get practitioners offering specific appointment type
SELECT DISTINCT u.* 
FROM users u
INNER JOIN practitioner_appointment_types pat ON u.id = pat.user_id
WHERE u.clinic_id = ?
  AND u.is_active = true
  AND pat.appointment_type_id = ?
  AND 'practitioner' = ANY(u.roles);
```

**Code Reuse**: Availability calculation logic from `backend/src/clinic_agents/tools/availability_tools.py` can be adapted for this endpoint.

### 6.3 Availability & Booking

#### **GET /api/availability**

**Purpose**: Get available time slots for date + practitioner + type

**Query Parameters:**
- `clinic_id`: Required
- `date`: YYYY-MM-DD format
- `appointment_type_id`: Required
- `practitioner_id`: Optional (if null, get union of all qualified practitioners)

**Response:**
```json
{
  "date": "2025-11-15",
  "slots": [
    {
      "start_time": "09:00",
      "end_time": "10:00",
      "practitioner_id": 5,
      "practitioner_name": "王大明"
    },
    {
      "start_time": "10:00",
      "end_time": "11:00",
      "practitioner_id": 5,
      "practitioner_name": "王大明"
    },
    {
      "start_time": "10:00",
      "end_time": "11:00",
      "practitioner_id": 6,
      "practitioner_name": "李小華"
    }
  ]
}
```

**Availability Calculation Algorithm:**
1. Get appointment type duration (e.g., 60 minutes)
2. Query `practitioner_availability` for default weekly schedule
3. Apply date to get specific time slots for the requested date
4. Subtract `availability_exceptions` (practitioner time off on this date)
5. Subtract existing `appointments` via `calendar_events` (already booked slots)
6. If `practitioner_id` is null (user selected "不指定"):
   - Get all practitioners offering this appointment type
   - Union their availability for the date
   - Deduplicate overlapping time slots
7. Return list of available slots with practitioner info

**Performance Optimizations:**

1. **Response Caching** (10-minute TTL):
   ```python
   from functools import lru_cache
   from cachetools import TTLCache
   import hashlib
   
   # Cache key: clinic_id + date + appointment_type_id + practitioner_id
   availability_cache = TTLCache(maxsize=1000, ttl=600)  # 10 minutes
   
   @router.get("/api/availability")
   async def get_availability(
       clinic_id: int,
       date: str,
       appointment_type_id: int,
       practitioner_id: Optional[int] = None
   ):
       # Generate cache key
       cache_key = f"{clinic_id}:{date}:{appointment_type_id}:{practitioner_id}"
       
       # Check cache
       if cache_key in availability_cache:
           return availability_cache[cache_key]
       
       # Calculate availability
       slots = calculate_availability(...)
       
       # Store in cache
       availability_cache[cache_key] = slots
       
       return slots
   ```

2. **Database Indexes**:
   ```sql
   -- Fast conflict checking
   CREATE INDEX idx_calendar_events_practitioner_date 
   ON calendar_events(practitioner_id, date);
   
   -- Fast appointment type lookup
   CREATE INDEX idx_practitioner_appointment_types_type 
   ON practitioner_appointment_types(appointment_type_id);
   
   -- Fast availability lookup
   CREATE INDEX idx_practitioner_availability_user 
   ON practitioner_availability(user_id);
   ```

3. **Date Range Limits**:
   ```python
   from datetime import datetime, timedelta
   
   # Validate date is within reasonable range
   requested_date = datetime.strptime(date, '%Y-%m-%d').date()
   today = datetime.now().date()
   max_date = today + timedelta(days=90)  # 90 days ahead
   
   if requested_date < today:
       raise ValueError("Cannot book appointments in the past")
   if requested_date > max_date:
       raise ValueError("最多只能預約 90 天內的時段")
   ```

4. **Rate Limiting** (per LINE user):
   ```python
   from slowapi import Limiter
   from slowapi.util import get_remote_address
   
   limiter = Limiter(key_func=get_remote_address)
   
   @router.get("/api/availability")
   @limiter.limit("60/minute")  # 60 requests per minute per user
   async def get_availability(...):
       ...
   ```

5. **Query Optimization**:
   - Use `SELECT COUNT(*)` instead of fetching all rows for conflict checks
   - Batch query all practitioners' availability in one query
   - Use database-level date arithmetic instead of Python loops

#### **POST /api/appointments**

**Purpose**: Create new appointment

**Headers:**
```
Authorization: Bearer {JWT_WITH_LINE_USER_ID}
```

**Request:**
```json
{
  "clinic_id": 1,
  "patient_id": 123,
  "appointment_type_id": 1,
  "practitioner_id": 5,  // Can be null if user selected "不指定"
  "start_time": "2025-11-15T09:00:00+08:00",
  "notes": "左肩疼痛約一週"
}
```

**Response:**
```json
{
  "appointment_id": 456,
  "calendar_event_id": 789,
  "patient_name": "陳小明",
  "practitioner_name": "王大明",
  "appointment_type_name": "初診評估",
  "start_time": "2025-11-15T09:00:00+08:00",
  "end_time": "2025-11-15T10:00:00+08:00",
  "notes": "左肩疼痛約一週"
}
```

**Transaction Logic:**
```python
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;

# 1. Verify patient belongs to LINE user
patient = db.query(Patient).filter_by(
    id=patient_id, 
    line_user_id=line_user_id_from_jwt
).first()
if not patient:
    raise 403 Forbidden

# 2. If practitioner_id is null ("不指定")
if practitioner_id is None:
    # Find all qualified practitioners
    candidates = db.query(User).join(PractitionerAppointmentTypes).filter(
        PractitionerAppointmentTypes.appointment_type_id == appointment_type_id,
        User.is_active == True
    ).all()
    
    # Filter by availability at requested time
    available = [p for p in candidates if check_availability(p, start_time)]
    
    if not available:
        ROLLBACK;
        raise 409 "無可用治療師"
    
    # Assign to practitioner with least appointments that day
    practitioner_id = min(
        available, 
        key=lambda p: count_appointments_on_date(p, date(start_time))
    ).id

# 3. Lock practitioner's schedule and check conflicts
SELECT * FROM calendar_events 
WHERE practitioner_id = ? AND date = ?
FOR UPDATE;

conflicts = db.query(CalendarEvent).filter(
    CalendarEvent.practitioner_id == practitioner_id,
    CalendarEvent.start_time < end_time,
    CalendarEvent.end_time > start_time
).count()

if conflicts > 0:
    ROLLBACK;
    raise 409 "時段已被預約"

# 4. Calculate end_time
appointment_type = db.query(AppointmentType).get(appointment_type_id)
end_time = start_time + timedelta(minutes=appointment_type.duration_minutes)

# 5. Create calendar_event
calendar_event = CalendarEvent(...)
db.add(calendar_event)
db.flush()  # Get calendar_event.id

# 6. Create appointment
appointment = Appointment(
    patient_id=patient_id,
    practitioner_id=practitioner_id,
    appointment_type_id=appointment_type_id,
    start_time=start_time,
    end_time=end_time,
    notes=notes,
    status='confirmed'
)
db.add(appointment)

# 7. Commit appointment first (don't block on Google Calendar)
db.commit()

# 8. Sync to Google Calendar (best-effort, non-blocking)
try:
    google_event_id = google_calendar_service.create_event(
        practitioner=practitioner,
        appointment=appointment,
        patient=patient,
        notes=notes
    )
    # Update calendar_event with Google event ID
    calendar_event.google_event_id = google_event_id
    calendar_event.sync_status = 'synced'
    db.commit()
except GoogleAuthError as e:
    # Practitioner needs to reconnect Google Calendar
    logger.error(f"Google Calendar auth failed: {e}")
    calendar_event.sync_status = 'auth_failed'
    calendar_event.sync_error = str(e)
    db.commit()
    
    # Notify clinic admin (don't fail the booking)
    notify_admin(
        clinic_id=clinic_id,
        message=f"治療師 {practitioner.full_name} 需要重新連接 Google Calendar"
    )
except GoogleCalendarError as e:
    # Temporary failure - retry later
    logger.error(f"Google Calendar sync failed: {e}")
    calendar_event.sync_status = 'pending_retry'
    calendar_event.sync_error = str(e)
    db.commit()
    
    # Schedule background retry
    schedule_calendar_sync_retry(calendar_event.id)

# 9. Return appointment details (booking successful regardless of sync)
return AppointmentResponse(...)
```

**Error Responses:**
- `403 Forbidden`: Patient doesn't belong to LINE user
- `409 Conflict`: Time slot already booked

**Important Design Decision:**
- ✅ **Booking succeeds even if Google Calendar sync fails**
- Sync failures are logged and retried in background
- Prevents blocking users when practitioner's Google auth expires
- Better UX: User gets confirmation immediately

**Calendar Event Sync Status:**
- `synced`: Successfully synced to Google Calendar
- `auth_failed`: Practitioner needs to reconnect Google Calendar
- `pending_retry`: Temporary failure, will retry
- `null`: Not yet attempted

**Background Retry Logic:**
```python
# Celery/background job to retry failed syncs
@celery_app.task
def retry_calendar_sync(calendar_event_id):
    calendar_event = db.query(CalendarEvent).get(calendar_event_id)
    
    if calendar_event.sync_status != 'pending_retry':
        return
    
    try:
        google_event_id = google_calendar_service.create_event(...)
        calendar_event.google_event_id = google_event_id
        calendar_event.sync_status = 'synced'
        calendar_event.sync_error = None
        db.commit()
    except Exception as e:
        # Retry up to 3 times with exponential backoff
        if calendar_event.retry_count < 3:
            calendar_event.retry_count += 1
            db.commit()
            retry_calendar_sync.apply_async(
                args=[calendar_event_id],
                countdown=60 * (2 ** calendar_event.retry_count)  # 2min, 4min, 8min
            )
        else:
            # Give up after 3 retries
            calendar_event.sync_status = 'failed'
            db.commit()
```

#### **GET /api/appointments**

**Purpose**: Get all appointments for LINE user's patients

**Headers:**
```
Authorization: Bearer {JWT_WITH_LINE_USER_ID}
```

**Query Parameters:**
- `upcoming_only`: Boolean (default true)

**Response:**
```json
{
  "appointments": [
    {
      "id": 456,
      "patient_id": 123,
      "patient_name": "陳小明",
      "practitioner_name": "王大明",
      "appointment_type_name": "初診評估",
      "start_time": "2025-11-15T09:00:00+08:00",
      "end_time": "2025-11-15T10:00:00+08:00",
      "status": "confirmed",
      "notes": "左肩疼痛約一週"
    }
  ]
}
```

**Logic:**
1. Extract `line_user_id` from JWT
2. Get all patient IDs for this LINE user
3. Query appointments for these patients
4. Filter by status and date if `upcoming_only`
5. Return list

#### **DELETE /api/appointments/{appointment_id}**

**Purpose**: Cancel appointment

**Headers:**
```
Authorization: Bearer {JWT_WITH_LINE_USER_ID}
```

**Response:**
```json
{
  "success": true,
  "message": "Appointment canceled"
}
```

**Transaction Logic:**
```python
BEGIN TRANSACTION;

# 1. Verify appointment's patient belongs to LINE user
appointment = db.query(Appointment).filter_by(id=appointment_id).first()
if not appointment:
    raise 404 "預約不存在"

patient = db.query(Patient).filter_by(
    id=appointment.patient_id,
    line_user_id=line_user_id_from_jwt
).first()
if not patient:
    raise 403 "無權限取消此預約"

# 2. Get calendar event details
calendar_event = db.query(CalendarEvent).filter_by(
    appointment_id=appointment_id
).first()

# 3. Update appointment status
appointment.status = 'canceled_by_patient'
appointment.canceled_at = datetime.utcnow()

# 4. Delete from Google Calendar
practitioner = db.query(User).get(appointment.practitioner_id)

try:
    from services.google_calendar_service import GoogleCalendarService
    
    # Decrypt practitioner's Google Calendar credentials
    gcal_service = GoogleCalendarService(
        access_token=decrypt(practitioner.google_access_token),
        refresh_token=decrypt(practitioner.google_refresh_token)
    )
    
    # Delete event
    gcal_service.delete_event(
        calendar_id='primary',
        event_id=calendar_event.google_event_id
    )
except GoogleCalendarError as e:
    # Log error but don't fail the cancellation
    # Appointment is already marked as canceled in our database
    logger.error(f"Failed to delete Google Calendar event: {e}")

COMMIT;

# 5. Return success
return {"success": true, "message": "預約已取消"}
```

**Error Responses:**
- `403 Forbidden`: Appointment doesn't belong to LINE user's patient
- `404 Not Found`: Appointment doesn't exist
- Google Calendar deletion failures are logged but don't block cancellation

**Note**: LIFF UI displays success message, no LINE notification needed (per requirements)

**Note**: We have access to delete events because:
- Events were created using practitioner's OAuth credentials
- We store encrypted credentials in `users.gcal_credentials`
- Google Calendar API allows deleting events we created

### 6.4 Calendar Export

#### **GET /api/appointments/{appointment_id}/ics**

**Purpose**: Generate ICS file for calendar download

**Response:**
```
Content-Type: text/calendar
Content-Disposition: attachment; filename="appointment.ics"

BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Clinic Bot//Appointment//EN
BEGIN:VEVENT
UID:appointment-456@clinicbot.com
DTSTAMP:20251031T120000Z
DTSTART:20251115T010000Z
DTEND:20251115T020000Z
SUMMARY:初診評估 - 王大明治療師
DESCRIPTION:診所：XX診所\n治療師：王大明\n預約類型：初診評估\n\n備註：左肩疼痛約一週
LOCATION:XX診所地址
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR
```

**Logic:**
- Include appointment notes (備註) in DESCRIPTION field if provided
- Format: Multi-line description with notes at the end

**Usage:**
- Frontend creates download link: `<a href="/api/appointments/456/ics" download>`
- On mobile: Browser prompts to add to default calendar app
- Works on iOS (Apple Calendar), Android (Google Calendar), etc.

---

## 7. Frontend Design

### 7.1 Technology Stack

- **Framework**: React 18+ with TypeScript
- **Build Tool**: Vite (existing)
- **UI Library**: Tailwind CSS (existing) + shadcn/ui components
- **LINE SDK**: `@line/liff` (npm package)
- **Routing**: React Router v6
- **State Management**: React Query + Zustand (lightweight)
- **Form Handling**: React Hook Form + Zod validation
- **Calendar Widget**: `react-day-picker` or similar

### 7.2 Project Structure

```
frontend/src/
├── liff/                    # ✅ New: LIFF app pages
│   ├── appointment/
│   │   ├── AppointmentFlow.tsx
│   │   ├── Step1SelectType.tsx
│   │   ├── Step2SelectPractitioner.tsx
│   │   ├── Step3SelectDateTime.tsx
│   │   ├── Step4SelectPatient.tsx
│   │   ├── Step5AddNotes.tsx
│   │   ├── Step6Confirmation.tsx
│   │   └── Step7Success.tsx
│   ├── query/
│   │   ├── AppointmentList.tsx
│   │   └── AppointmentCard.tsx
│   ├── settings/
│   │   ├── PatientManagement.tsx
│   │   └── AddPatientModal.tsx
│   ├── auth/
│   │   ├── FirstTimeRegister.tsx
│   │   └── NameEntry.tsx
│   └── LiffApp.tsx          # Main entry point
├── components/              # Existing admin components
├── pages/                   # Existing admin pages
├── hooks/
│   ├── useLiff.ts           # ✅ New: LIFF SDK hook
│   ├── useLineAuth.ts       # ✅ New: LINE auth hook
│   └── useAuth.tsx          # Existing admin auth
├── services/
│   ├── liffApi.ts           # ✅ New: LIFF-specific API calls
│   └── api.ts               # Existing admin API
└── utils/
    └── icsGenerator.ts      # ✅ New: ICS file generation
```

### 7.3 LIFF Integration

**Hook: `useLiff.ts`**
```typescript
import { useEffect, useState } from 'react';
import liff from '@line/liff';

export const useLiff = () => {
  const [isReady, setIsReady] = useState(false);
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    const initLiff = async () => {
      try {
        await liff.init({ liffId: import.meta.env.VITE_LIFF_ID });
        
        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }
        
        const userProfile = await liff.getProfile();
        setProfile(userProfile);
        setIsReady(true);
      } catch (error) {
        console.error('LIFF initialization failed', error);
      }
    };
    
    initLiff();
  }, []);

  return { isReady, profile, liff };
};
```

**Component: `LiffApp.tsx`**
```typescript
import { useLiff } from '@/hooks/useLiff';
import { useLineAuth } from '@/hooks/useLineAuth';
import { useSearchParams } from 'react-router-dom';

export const LiffApp = () => {
  const { isReady, profile } = useLiff();
  const { isAuthenticated, isFirstTime } = useLineAuth(profile?.userId);
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode'); // 'book', 'query', 'settings'

  if (!isReady) {
    return <LoadingSpinner />;
  }

  if (isFirstTime) {
    return <FirstTimeRegister />;
  }

  switch (mode) {
    case 'book':
      return <AppointmentFlow />;
    case 'query':
      return <AppointmentList />;
    case 'settings':
      return <PatientManagement />;
    default:
      return <Navigate to="?mode=book" />;
  }
};
```

### 7.4 Multi-Step Form Pattern

**State Management with Zustand:**
```typescript
// stores/appointmentStore.ts
import { create } from 'zustand';

interface AppointmentState {
  step: number;
  appointmentTypeId: number | null;
  practitionerId: number | null;
  date: string | null;
  startTime: string | null;
  patientId: number | null;
  notes: string;
  
  setStep: (step: number) => void;
  setAppointmentType: (id: number) => void;
  setPractitioner: (id: number | null) => void;
  setDateTime: (date: string, time: string) => void;
  setPatient: (id: number) => void;
  setNotes: (notes: string) => void;
  reset: () => void;
}

export const useAppointmentStore = create<AppointmentState>((set) => ({
  step: 1,
  appointmentTypeId: null,
  practitionerId: null,
  date: null,
  startTime: null,
  patientId: null,
  notes: '',
  
  setStep: (step) => set({ step }),
  setAppointmentType: (id) => set({ appointmentTypeId: id, step: 2 }),
  setPractitioner: (id) => set({ practitionerId: id, step: 3 }),
  setDateTime: (date, time) => set({ date, startTime: time, step: 4 }),
  setPatient: (id) => set({ patientId: id, step: 5 }),
  setNotes: (notes) => set({ notes, step: 6 }),
  reset: () => set({
    step: 1,
    appointmentTypeId: null,
    practitionerId: null,
    date: null,
    startTime: null,
    patientId: null,
    notes: ''
  }),
}));
```

### 7.5 Calendar Download Implementation

**Utility: `icsGenerator.ts`**
```typescript
export const downloadAppointmentICS = (appointment: Appointment) => {
  const { id, start_time, end_time, appointment_type_name, practitioner_name, notes, clinic_address } = appointment;
  
  // Build description with notes if provided
  let description = `診所：${appointment.clinic_name}\\n治療師：${practitioner_name}\\n預約類型：${appointment_type_name}`;
  if (notes) {
    description += `\\n\\n備註：${notes}`;
  }
  
  const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Clinic Bot//Appointment//EN
BEGIN:VEVENT
UID:appointment-${id}@clinicbot.com
DTSTAMP:${formatICSDate(new Date())}
DTSTART:${formatICSDate(start_time)}
DTEND:${formatICSDate(end_time)}
SUMMARY:${appointment_type_name} - ${practitioner_name}
DESCRIPTION:${description}
LOCATION:${clinic_address || ''}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

  const blob = new Blob([icsContent], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'appointment.ics';
  link.click();
  URL.revokeObjectURL(url);
};

const formatICSDate = (date: Date | string): string => {
  const d = new Date(date);
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
};
```

**Component: `Step7Success.tsx`**
```tsx
import { downloadAppointmentICS } from '@/utils/icsGenerator';

export const Step7Success = ({ appointment }: { appointment: Appointment }) => {
  return (
    <div className="success-screen">
      <CheckCircle className="text-green-500 w-16 h-16" />
      <h2>預約成功</h2>
      
      <div className="appointment-summary">
        <p>預約類型：{appointment.appointment_type_name}</p>
        <p>治療師：{appointment.practitioner_name}</p>
        <p>日期時間：{formatDateTime(appointment.start_time)}</p>
        <p>就診人：{appointment.patient_name}</p>
      </div>
      
      <button onClick={() => downloadAppointmentICS(appointment)}>
        加入行事曆
      </button>
      
      {/* User can close LIFF window when done - no button needed */}
    </div>
  );
};
```

---

## 8. Calendar Integration

### 8.1 ICS File Format

**What is ICS?**
- iCalendar format (`.ics` file)
- Universal standard for calendar events
- Supported by all major calendar apps (Google, Apple, Outlook)

**How it works on mobile:**
1. User clicks "加入行事曆"
2. Browser downloads `.ics` file
3. Operating system detects calendar file
4. Automatically prompts: "Add to Calendar?"
5. User selects calendar app (default or choose)
6. Event added to selected calendar

**No email required:**
- File download triggers OS calendar integration
- Works with phone's default calendar app
- iOS: Apple Calendar, Google Calendar, etc.
- Android: Google Calendar, Samsung Calendar, etc.

**ICS Content Includes:**
- Event title: `{appointment_type} - {practitioner_name}`
- Date/time: Start and end times
- Description: Patient notes (備註) if provided
- Location: Clinic address

### 8.2 Alternative: Web Share Target API

**For better UX on mobile:**
```typescript
// Check if Web Share API is available
if (navigator.share) {
  const icsBlob = new Blob([icsContent], { type: 'text/calendar' });
  const file = new File([icsBlob], 'appointment.ics', { type: 'text/calendar' });
  
  await navigator.share({
    title: '預約確認',
    text: '您的預約已確認',
    files: [file]
  });
} else {
  // Fallback to download
  downloadICS();
}
```

**Benefits:**
- Native share sheet on mobile
- Better UX than file download
- Still falls back to download if not supported

### 8.3 Google Calendar Deep Link (Alternative)

**Direct link to add event:**
```
https://calendar.google.com/calendar/render?action=TEMPLATE&text=初診評估&dates=20251115T010000Z/20251115T020000Z&details=預約確認&location=XX診所
```

**Pros:**
- Opens directly in Google Calendar (if installed)
- Works on both mobile and desktop

**Cons:**
- Google-specific (not universal)
- Doesn't work for Apple Calendar, Outlook, etc.
- User must be logged into Google

**Recommendation**: Use ICS file as primary method, Google Calendar link as optional alternative

---

## 9. Implementation Strategy

### 9.1 Database Setup

**Approach**: Fresh database deployment (pre-launch, no existing data to migrate).

**New Schema SQL:**
```sql
-- line_users table (already exists, just needs new columns)
CREATE TABLE line_users (
  id SERIAL PRIMARY KEY,
  line_user_id VARCHAR(255) UNIQUE NOT NULL,
  phone_number VARCHAR(50) NOT NULL,
  display_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- patients table (modify existing)
CREATE TABLE patients (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id),
  full_name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(50),  -- Nullable
  line_user_id INTEGER REFERENCES line_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_clinic_patient_phone UNIQUE (clinic_id, phone_number)
);

-- clinics table (add rich menu tracking)
ALTER TABLE clinics 
ADD COLUMN line_rich_menu_id VARCHAR(255);  -- Store programmatically created menu ID

-- appointments table (add notes column)
ALTER TABLE appointments ADD COLUMN notes TEXT;

-- New: practitioner-appointment type mapping
CREATE TABLE practitioner_appointment_types (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_type_id INTEGER NOT NULL REFERENCES appointment_types(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_practitioner_type UNIQUE (user_id, appointment_type_id)
);

-- Indexes
CREATE INDEX idx_line_users_line_user_id ON line_users(line_user_id);
CREATE INDEX idx_patients_line_user ON patients(line_user_id);
CREATE INDEX idx_patients_clinic ON patients(clinic_id);
CREATE INDEX idx_patients_created_at ON patients(created_at);
CREATE INDEX idx_practitioner_types_user ON practitioner_appointment_types(user_id);
CREATE INDEX idx_practitioner_types_type ON practitioner_appointment_types(appointment_type_id);
```

### 9.2 Code Changes

**Remove:**
```bash
# Delete entire AI agent directory
rm -rf backend/src/clinic_agents/
```

**Modify:**
- `backend/src/api/webhooks.py`: Remove message webhook, keep Google Calendar webhook
- `backend/src/main.py`: Remove agent routes
- `backend/src/models/line_user.py`: Update schema
- `backend/src/models/patient.py`: Update schema

**Add:**
- `backend/src/api/liff.py`: New LIFF endpoints
- `frontend/src/liff/`: New LIFF app pages
- LINE Login OAuth handler
- ICS generation utility

### 9.3 Deployment

**Single deployment with:**
1. New database schema
2. Backend with LIFF APIs (no AI agents)
3. Frontend with LIFF app
4. LINE Rich Menu configured
5. LIFF app registered

**Deployment Note**: Clean slate implementation - no backward compatibility concerns

### 9.4 Security Measures

#### 9.4.1 LIFF Token Verification

**Purpose**: Prevent token forgery and impersonation attacks

**Implementation**:
```python
import requests
from fastapi import HTTPException, Header

async def verify_liff_token(liff_access_token: str = Header(..., alias="X-LIFF-Access-Token")):
    """
    Verify LIFF access token with LINE API
    Call this as a dependency on all LIFF endpoints
    """
    response = requests.get(
        'https://api.line.me/oauth2/v2.1/verify',
        params={'access_token': liff_access_token}
    )
    
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid LIFF token")
    
    data = response.json()
    
    # Verify token hasn't expired
    if data.get('expires_in', 0) <= 0:
        raise HTTPException(status_code=401, detail="LIFF token expired")
    
    return {
        'line_user_id': data['sub'],
        'liff_id': data['client_id']
    }

# Use as dependency
@router.post("/api/auth/liff-login")
async def liff_login(
    line_user_id: str,
    display_name: str,
    liff_data: dict = Depends(verify_liff_token)
):
    # Verify line_user_id matches token
    if liff_data['line_user_id'] != line_user_id:
        raise HTTPException(status_code=403, detail="Line user ID mismatch")
    ...
```

#### 9.4.2 JWT Authentication

**Token Structure**:
```json
{
  "line_user_id": "U1234567890abcdef",
  "clinic_id": 1,
  "iat": 1730000000,
  "exp": 1730604800
}
```

**Token Generation**:
```python
import jwt
from datetime import datetime, timedelta

def create_jwt(line_user_id: str, clinic_id: int) -> str:
    payload = {
        "line_user_id": line_user_id,
        "clinic_id": clinic_id,
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(days=7)
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")
```

**Token Verification**:
```python
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()

def verify_jwt(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.JWT_SECRET,
            algorithms=["HS256"]
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
```

**Token Storage**:
```typescript
// Frontend: Store in localStorage
localStorage.setItem('jwt_token', token);

// Include in all API requests
const response = await fetch('/api/appointments', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('jwt_token')}`,
    'Content-Type': 'application/json'
  }
});
```

#### 9.4.3 Authorization Checks

**Multi-Tenant Isolation**:
```python
def verify_patient_ownership(
    patient_id: int,
    jwt_payload: dict = Depends(verify_jwt)
) -> Patient:
    """Verify patient belongs to LINE user AND clinic"""
    line_user_id = jwt_payload['line_user_id']
    clinic_id = jwt_payload['clinic_id']
    
    patient = db.query(Patient).filter_by(
        id=patient_id,
        clinic_id=clinic_id
    ).first()
    
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    # Get LINE user
    line_user = db.query(LineUser).filter_by(
        line_user_id=line_user_id
    ).first()
    
    if patient.line_user_id != line_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    return patient
```

**Apply to all endpoints**:
```python
@router.get("/api/patients/{patient_id}")
async def get_patient(
    patient_id: int,
    patient: Patient = Depends(verify_patient_ownership)
):
    return patient

@router.get("/api/appointments")
async def get_appointments(jwt_payload: dict = Depends(verify_jwt)):
    # Get all patients for this LINE user at this clinic
    line_user = db.query(LineUser).filter_by(
        line_user_id=jwt_payload['line_user_id']
    ).first()
    
    patients = db.query(Patient).filter_by(
        line_user_id=line_user.id,
        clinic_id=jwt_payload['clinic_id']
    ).all()
    
    # Return appointments for these patients only
    ...
```

#### 9.4.4 Rate Limiting

**Per-Endpoint Limits**:
```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Initialize limiter
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Apply to availability endpoint (high frequency)
@router.get("/api/availability")
@limiter.limit("60/minute")  # 60 requests per minute
async def get_availability(...):
    ...

# Apply to booking endpoint (lower frequency)
@router.post("/api/appointments")
@limiter.limit("10/minute")  # 10 bookings per minute
async def create_appointment(...):
    ...

# Apply to auth endpoint
@router.post("/api/auth/liff-login")
@limiter.limit("30/minute")  # 30 login attempts per minute
async def liff_login(...):
    ...
```

**Redis-Based Rate Limiting** (for production):
```python
from slowapi.util import get_ipaddr
from redis import Redis

redis_client = Redis(host='localhost', port=6379, decode_responses=True)

def get_user_identifier(request: Request):
    # Use LINE user ID from JWT if authenticated
    auth_header = request.headers.get('Authorization')
    if auth_header:
        try:
            token = auth_header.split(' ')[1]
            payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
            return payload['line_user_id']
        except:
            pass
    # Fallback to IP address
    return get_ipaddr(request)

limiter = Limiter(
    key_func=get_user_identifier,
    storage_uri=f"redis://localhost:6379"
)
```

#### 9.4.5 Input Validation

**Request Validation with Pydantic**:
```python
from pydantic import BaseModel, validator, constr
import re

class PatientCreate(BaseModel):
    full_name: constr(min_length=1, max_length=255)
    phone_number: constr(regex=r'^09\d{8}$')
    
    @validator('full_name')
    def validate_name(cls, v):
        # Strip whitespace
        v = v.strip()
        if not v:
            raise ValueError('Name cannot be empty')
        # Basic XSS prevention
        if '<' in v or '>' in v:
            raise ValueError('Invalid characters in name')
        return v

class AppointmentCreate(BaseModel):
    patient_id: int
    appointment_type_id: int
    practitioner_id: Optional[int]
    start_time: datetime
    notes: Optional[constr(max_length=500)]  # Limit notes length
    
    @validator('notes')
    def sanitize_notes(cls, v):
        if v:
            # Basic XSS prevention
            v = v.replace('<', '&lt;').replace('>', '&gt;')
        return v
    
    @validator('start_time')
    def validate_time(cls, v):
        # Must be in future
        if v < datetime.now():
            raise ValueError('Cannot book appointments in the past')
        # Must be within 90 days
        if v > datetime.now() + timedelta(days=90):
            raise ValueError('Cannot book more than 90 days in advance')
        return v
```

#### 9.4.6 SQL Injection Prevention

**Using SQLAlchemy ORM** (safe by default):
```python
# ✅ Safe - parameterized query
patients = db.query(Patient).filter_by(
    clinic_id=clinic_id,
    phone_number=phone_number
).all()

# ❌ NEVER do this - vulnerable to SQL injection
patients = db.execute(
    f"SELECT * FROM patients WHERE phone_number = '{phone_number}'"
)
```

**Raw SQL** (when needed):
```python
# ✅ Safe - use parameters
from sqlalchemy import text

result = db.execute(
    text("SELECT * FROM patients WHERE phone_number = :phone"),
    {"phone": phone_number}
)

# ❌ NEVER do this
result = db.execute(
    f"SELECT * FROM patients WHERE phone_number = '{phone_number}'"
)
```

#### 9.4.7 HTTPS & Security Headers

**Production Requirements**:
```python
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

# Force HTTPS in production
if settings.ENVIRONMENT == "production":
    app.add_middleware(HTTPSRedirectMiddleware)

# Set security headers
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

# CORS (restrict to LIFF domains)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://liff.line.me",
        settings.FRONTEND_URL
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)
```

#### 9.4.8 Secrets Management

**Environment Variables**:
```bash
# .env (NEVER commit to git)
JWT_SECRET=generate-random-256-bit-key-here
DATABASE_URL=postgresql://user:pass@localhost/clinic_bot
LINE_CHANNEL_ID=1234567890
LINE_CHANNEL_SECRET=your-channel-secret
LINE_CHANNEL_ACCESS_TOKEN=your-access-token
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Generate JWT secret
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

**Loading Secrets**:
```python
from pydantic import BaseSettings

class Settings(BaseSettings):
    JWT_SECRET: str
    DATABASE_URL: str
    LINE_CHANNEL_ID: str
    LINE_CHANNEL_SECRET: str
    LINE_CHANNEL_ACCESS_TOKEN: str
    ENVIRONMENT: str = "development"
    
    class Config:
        env_file = ".env"

settings = Settings()
```

#### 9.4.9 Logging & Monitoring

**Security Event Logging**:
```python
import logging

security_logger = logging.getLogger('security')

# Log authentication attempts
@router.post("/api/auth/liff-login")
async def liff_login(...):
    security_logger.info(
        f"LIFF login attempt: line_user_id={line_user_id}, "
        f"clinic_id={clinic_id}, ip={request.client.host}"
    )
    ...

# Log authorization failures
def verify_patient_ownership(...):
    if patient.line_user_id != line_user.id:
        security_logger.warning(
            f"Unauthorized access attempt: line_user_id={line_user_id}, "
            f"patient_id={patient_id}, ip={request.client.host}"
        )
        raise HTTPException(status_code=403, detail="Access denied")
```

**Sensitive Data Protection**:
```python
# Never log passwords, tokens, or full phone numbers
security_logger.info(
    f"Patient created: id={patient.id}, "
    f"phone=***{patient.phone_number[-4:]}"  # Only last 4 digits
)
```

---

## 10. Implementation Phases

### Phase 1: Database & API Foundation (Week 1-2)

**Tasks:**
- [ ] Database migration script
- [ ] Test migration on staging database
- [ ] Update SQLAlchemy models
- [ ] Create new API endpoints (6.1, 6.2, 6.3, 6.4)
- [ ] **Clinic admin appointment management:**
  - [ ] `GET /api/clinic/appointments` - List appointments for admin dashboard
  - [ ] `DELETE /api/clinic/appointments/{appointment_id}` - Cancel appointment with LINE notification
- [ ] **LINE notification service for clinic cancellations**
- [ ] Update Google Calendar webhook to send LINE notifications for therapist deletions
- [ ] Unit tests for new APIs
- [ ] Remove AI agent code

**Deliverables:**
- Working REST APIs for appointment booking
- Patient management APIs functional
- Database schema updated

### Phase 2: LIFF Frontend (Week 2-3)

**Tasks:**
- [ ] Setup LIFF app in LINE Developers Console
- [ ] Install `@line/liff` package
- [ ] Build LIFF entry point (`LiffApp.tsx`)
- [ ] Build multi-step appointment flow (Steps 1-7)
- [ ] Build appointment query UI
- [ ] Build patient management UI
- [ ] Implement ICS file generation
- [ ] **Update clinic admin dashboard:**
  - [ ] Add appointment cancellation functionality to calendar view
  - [ ] Update appointment details modal with cancel button
  - [ ] Implement LINE notification integration for clinic cancellations

**Deliverables:**
- Functional LIFF app for all three features
- Calendar download working on mobile

### Phase 3: LINE Integration (Week 3-4)

**Tasks:**
- [ ] Create LINE Login channel
- [ ] Apply for `phone` scope permission
- [ ] Implement OAuth callback handler
- [ ] Setup Rich Menu in LINE Official Account
- [ ] Configure LIFF URLs in Rich Menu
- [ ] Update reminder service (remove webhook message handling)
- [ ] Keep Google Calendar webhook

**Deliverables:**
- Rich Menu live in LINE
- Phone number retrieval working
- Reminders still functional

### Phase 4: Testing & Quality Assurance (Week 4-5)

**4.1 Functional Testing**
- [ ] **First-time user registration**
  - [ ] LIFF auto-authentication works
  - [ ] Registration form validates phone number format
  - [ ] Patient record created correctly
  - [ ] JWT token generated and stored
- [ ] **Returning user login**
  - [ ] JWT valid → Direct to booking
  - [ ] JWT expired → Re-authenticate
  - [ ] Multi-clinic support (same LINE user, different clinics)
- [ ] **Appointment booking flow (all steps)**
  - [ ] Step 1: Appointment types load
  - [ ] Step 2: Practitioners filter by type
  - [ ] Step 2: "不指定" option works
  - [ ] Step 3: Calendar shows availability
  - [ ] Step 3: Dates without availability are grayed out
  - [ ] Step 4: Time slots grouped by 上午/下午
  - [ ] Step 5: Patient selection + add new patient
  - [ ] Step 6: Notes field (max 500 chars)
  - [ ] Step 7: Confirmation page shows all details
  - [ ] Step 8: Booking succeeds
  - [ ] Step 8: ICS download works
- [ ] **Appointment query**
  - [ ] View all appointments for all patients
  - [ ] Notes display correctly
  - [ ] Cancel appointment → Google Calendar deleted
- [ ] **Patient management**
  - [ ] Add new patient
  - [ ] Delete patient (validates last patient rule)
  - [ ] Phone number uniqueness enforced
- [ ] **Clinic admin appointment management**
  - [ ] Admin can view all clinic appointments in calendar
  - [ ] Appointment details modal shows [編輯] [取消預約] buttons
  - [ ] Cancel appointment sends LINE notification to patient
  - [ ] Cancelled appointment status changes to 'canceled_by_clinic'
  - [ ] Google Calendar event deleted when clinic cancels
- [ ] **LINE notifications for cancellations**
  - [ ] Patient cancellation → No LINE notification (handled in LIFF UI)
  - [ ] Clinic admin cancellation → LINE message sent to patient
  - [ ] Google Calendar therapist deletion → LINE message sent to patient

**4.2 Edge Case Testing**
- [ ] **Double booking prevention**
  - [ ] Concurrent booking attempts → One succeeds, one fails with 409
  - [ ] Row-level locking works correctly
- [ ] **No availability scenarios**
  - [ ] No practitioners offer selected type → Show message
  - [ ] Selected date fully booked → Show empty state
  - [ ] Practitioner not configured types → Not shown in list
- [ ] **Patient deletion validation**
  - [ ] Last patient → Block deletion
  - [ ] Patient with future appointments → Block deletion
  - [ ] Soft delete preserves appointment history
- [ ] **Appointment type deletion**
  - [ ] Referenced by practitioners → Block with clear error
  - [ ] Has future appointments → Block with clear error
- [ ] **Google Calendar sync failure**
  - [ ] Auth expired → Booking succeeds, sync_status = 'auth_failed'
  - [ ] Network error → Booking succeeds, retry scheduled
  - [ ] Admin notified of sync failures
- [ ] **LIFF initialization failure**
  - [ ] Not in LINE app → Show error message
  - [ ] LIFF ID mismatch → Graceful error
  - [ ] Network timeout → Retry logic
- [ ] **Invalid JWT scenarios**
  - [ ] Expired token → 401, redirect to login
  - [ ] Tampered token → 401, reject
  - [ ] Missing token → 401, require auth

**4.3 Security Testing**
- [ ] **LIFF token verification**
  - [ ] Valid token → Accepted
  - [ ] Invalid token → 401 Unauthorized
  - [ ] Expired token → 401 Unauthorized
  - [ ] Token for different clinic → Rejected
- [ ] **Authorization bypass attempts**
  - [ ] Access other user's patients → 403 Forbidden
  - [ ] Access other clinic's data → 404 Not Found
  - [ ] Modify patient_id in booking → Validated, rejected if not owned
- [ ] **SQL injection attempts**
  - [ ] Malicious input in name field → Sanitized
  - [ ] SQL in notes field → Escaped
  - [ ] Verify all inputs use parameterized queries
- [ ] **XSS prevention**
  - [ ] `<script>` in notes → Escaped in UI
  - [ ] HTML tags in name → Stripped/escaped
- [ ] **Rate limiting enforcement**
  - [ ] 61st availability request in 1 min → 429 Too Many Requests
  - [ ] 11th booking attempt in 1 min → 429
  - [ ] Rate limit per LINE user (not IP)
- [ ] **CSRF protection**
  - [ ] LIFF token verification prevents CSRF
  - [ ] JWT includes clinic_id (no parameter tampering)

**4.4 Performance Testing**
- [ ] **Availability query performance**
  - [ ] Single practitioner, single date: < 200ms
  - [ ] Multiple practitioners ("不指定"), single date: < 500ms
  - [ ] Cache hit: < 50ms
- [ ] **Booking transaction performance**
  - [ ] End-to-end booking: < 2 seconds
  - [ ] Google Calendar sync doesn't block response
- [ ] **Concurrent load**
  - [ ] 100 concurrent users browsing: System stable
  - [ ] 10 concurrent bookings for same slot: Only 1 succeeds
  - [ ] Database connection pool handles load
- [ ] **Database query optimization**
  - [ ] All queries use appropriate indexes
  - [ ] No N+1 query problems
  - [ ] EXPLAIN ANALYZE on complex queries

**4.5 Browser/Device Testing**
- [ ] **LINE app on iOS**
  - [ ] iOS 15, 16, 17 (latest)
  - [ ] LIFF opens correctly
  - [ ] Calendar download works (iOS Calendar)
  - [ ] Date picker works
  - [ ] Keyboard doesn't cover inputs
- [ ] **LINE app on Android**
  - [ ] Android 10, 11, 12, 13
  - [ ] LIFF opens correctly
  - [ ] Calendar download works (Google Calendar)
  - [ ] Date picker works
  - [ ] Back button behavior correct
- [ ] **Screen sizes**
  - [ ] Small phones (iPhone SE, Galaxy A series)
  - [ ] Large phones (iPhone Pro Max, Galaxy S series)
  - [ ] Tablets (responsive but not primary focus)
- [ ] **Orientations**
  - [ ] Portrait (primary)
  - [ ] Landscape (acceptable degradation)
- [ ] **Network conditions**
  - [ ] 4G/5G: Fast, smooth
  - [ ] 3G: Slow but functional
  - [ ] Offline: Show appropriate error

**4.6 Accessibility Testing**
- [ ] **Screen reader support** (basic)
  - [ ] Form labels read correctly
  - [ ] Error messages announced
  - [ ] Button states clear
- [ ] **Keyboard navigation**
  - [ ] Tab order logical
  - [ ] Enter key submits forms
  - [ ] Escape key closes modals
- [ ] **Visual accessibility**
  - [ ] Color contrast meets WCAG AA (4.5:1 minimum)
  - [ ] Font sizes readable (minimum 14px)
  - [ ] Touch targets >= 44x44px

**4.7 User Acceptance Testing**
- [ ] Pilot with 2-3 real patients per clinic
- [ ] Gather feedback on UX flow
- [ ] Identify pain points
- [ ] Measure completion rate (target: > 90%)
- [ ] Measure time to book (target: < 3 minutes)

**Deliverables:**
- ✅ All functional tests passing
- ✅ Security tests passed
- ✅ Performance benchmarks met
- ✅ Cross-device compatibility verified
- ✅ User acceptance approved

### Phase 5: Deployment & Production Launch (Week 5)

**5.1 Pre-Deployment Checklist**
- [ ] **Code review completed**
- [ ] **All tests passing** (unit, integration, e2e)
- [ ] **Security audit completed**
- [ ] **Performance benchmarks met**
- [ ] **Database backup verified**
- [ ] **Rollback procedure documented**
- [ ] **Monitoring/alerting configured**
- [ ] **Support team trained**

**5.2 Staging Deployment** (Day 1)
- [ ] Deploy database schema to staging
- [ ] Deploy backend API to staging
- [ ] Deploy LIFF frontend to staging
- [ ] Create staging LIFF app in LINE Developers
- [ ] Configure staging Rich Menu (test LINE account)
- [ ] Smoke test all critical flows
- [ ] Load test staging environment
- [ ] Fix any issues found

**5.3 Production Deployment** (Day 2-3)

**Step-by-Step Procedure:**

1. **Enable Maintenance Mode** (5 min)
   ```bash
   # Display maintenance page to users
   kubectl scale deployment frontend --replicas=0
   # Or set maintenance flag
   ```

2. **Backup Database** (10 min)
   ```bash
   pg_dump -h $DB_HOST -U $DB_USER $DB_NAME > backup_$(date +%Y%m%d_%H%M%S).sql
   # Upload to S3/Cloud Storage
   aws s3 cp backup_*.sql s3://backups/clinic-bot/
   ```

3. **Deploy Database Migration** (15 min)
   ```bash
   # Run migration script
   alembic upgrade head
   
   # Verify tables created
   psql -c "\dt"
   psql -c "SELECT COUNT(*) FROM line_users"
   ```

4. **Deploy Backend API** (10 min)
   ```bash
   # Build and push Docker image
   docker build -t clinic-bot-api:v2.0.0 .
   docker push clinic-bot-api:v2.0.0
   
   # Update Kubernetes deployment
   kubectl set image deployment/api api=clinic-bot-api:v2.0.0
   kubectl rollout status deployment/api
   ```

5. **Deploy LIFF Frontend** (10 min)
   ```bash
   # Build production bundle
   npm run build
   
   # Deploy to hosting (Vercel/Netlify/S3+CloudFront)
   vercel --prod
   # Or
   aws s3 sync dist/ s3://liff-app-bucket/
   aws cloudfront create-invalidation --distribution-id XXX --paths "/*"
   ```

6. **Create Production LIFF App** (5 min once)
   - Log in to LINE Developers Console (once for all clinics)
   - Create single shared LIFF app
   - Copy LIFF ID: `SHARED_LIFF_ID`
   - No database updates needed (single shared app)

7. **Configure Rich Menus** (10 min per clinic)
   - Option A: Programmatic creation
     ```python
     python scripts/create_rich_menu.py --clinic_id=1
     ```
   - Option B: Send setup instructions to clinic admin

8. **Smoke Test Production** (15 min)
   - [ ] Test LINE account can open LIFF
   - [ ] Registration flow works
   - [ ] Book test appointment
   - [ ] Verify Google Calendar sync
   - [ ] Cancel test appointment
   - [ ] Verify calendar event deleted

9. **Disable Maintenance Mode** (2 min)
   ```bash
   kubectl scale deployment frontend --replicas=3
   ```

10. **Monitor Initial Traffic** (2 hours)
    - Watch error logs
    - Monitor API latency
    - Check database connections
    - Verify no 500 errors

**5.4 Rollback Procedure** (If Deployment Fails)

**Scenario 1: Database Migration Failed**
```bash
# Rollback migration
alembic downgrade -1

# Restore from backup
psql $DB_NAME < backup_YYYYMMDD_HHMMSS.sql

# Abort deployment
```

**Scenario 2: Backend API Issues (5xx errors)**
```bash
# Rollback to previous version
kubectl rollout undo deployment/api

# Verify old version running
kubectl get pods
kubectl logs deployment/api
```

**Scenario 3: LIFF App Issues**
```bash
# Rollback frontend
vercel rollback

# Or revert to previous S3 version
aws s3 cp s3://backups/frontend/previous/ s3://liff-app-bucket/ --recursive
aws cloudfront create-invalidation --distribution-id XXX --paths "/*"
```

**Scenario 4: Critical Bug Found Post-Deployment**
```bash
# Quick fix: Enable maintenance mode
kubectl scale deployment frontend --replicas=0

# Or: Temporarily disable clinic access
UPDATE clinics SET is_active = false WHERE id = PROBLEMATIC_CLINIC_ID;

# Fix bug
# Redeploy
# Re-enable
```

**5.5 Post-Deployment Monitoring** (Week 1)

**Day 1-3 (Intensive Monitoring):**
- [ ] Monitor every 2 hours
- [ ] Check error rates: Target < 0.1%
- [ ] Check API latency: p95 < 1s, p99 < 3s
- [ ] Verify booking success rate: > 95%
- [ ] Check Google Calendar sync: > 99%
- [ ] Monitor rate limiting: No false positives

**Week 1 (Regular Monitoring):**
- [ ] Daily error log review
- [ ] Daily performance metrics check
- [ ] User feedback collection
- [ ] Support ticket review

**Key Metrics to Track:**
- Booking completion rate
- Average booking time
- API response times (p50, p95, p99)
- Error rates by endpoint
- Google Calendar sync success rate
- User satisfaction (survey)

**5.6 Support & Documentation**

**Support Preparation:**
- [ ] Create FAQ document for common issues
- [ ] Train support team on new LIFF flow
- [ ] Set up monitoring dashboard for support team
- [ ] Create troubleshooting playbook

**User Documentation:**
- [ ] Update clinic admin guide
- [ ] Create patient user guide (with screenshots)
- [ ] Video tutorial for booking flow (optional)

**5.7 Gradual Rollout (Recommended)**

If possible, deploy to clinics gradually:

**Week 5:**
- Deploy to 1-2 pilot clinics
- Monitor closely for issues
- Gather feedback

**Week 6:**
- Fix any issues found
- Deploy to 5-10 more clinics
- Continue monitoring

**Week 7-8:**
- Deploy to remaining clinics in batches
- Full production rollout complete

**Deliverables:**
- ✅ Production system live
- ✅ All clinics migrated to LIFF
- ✅ AI chatbot deprecated
- ✅ Monitoring and alerting active
- ✅ Support team prepared
- ✅ Rollback procedure tested

**Total Timeline: 5-8 weeks** (depending on gradual rollout)

---

## Appendix A: Admin Dashboard Updates

### A.1 Practitioner Settings Page (New Section)

**Add to existing practitioner availability page:**

```
治療師設定 - 王大明

┌─────────────────────────────────────────┐
│ 提供的預約類型                           │
├─────────────────────────────────────────┤
│ ☑ 初診評估 (60分鐘)                     │
│ ☑ 一般複診 (30分鐘)                     │
│ ☐ 徒手治療 (45分鐘)                     │
│                                          │
│ [儲存變更]                               │
└─────────────────────────────────────────┘

⚠️ 警告：您尚未設定提供的預約類型
   患者將無法選擇您進行預約

┌─────────────────────────────────────────┐
│ 預設可預約時段                           │
├─────────────────────────────────────────┤
│ [Current availability settings...]      │
└─────────────────────────────────────────┘
```

**Warning Logic:**
- Show warning if practitioner has no appointment types configured
- Similar to current default availability warning
- Hide warning once at least one type is selected

**API Endpoint:**
```
PUT /api/clinic/practitioners/{practitioner_id}/appointment-types
Body: { "appointment_type_ids": [1, 2] }
```

### A.2 Appointment Details in Admin Dashboard

**Update existing appointment calendar view to show notes:**

```
預約詳情
─────────────────
患者：陳小明
治療師：王大明
預約類型：初診評估
時間：2025/11/15 上午10:00-11:00
狀態：已確認

備註：
左肩疼痛約一週

[編輯] [取消預約]
```

**Google Calendar Event:**
- Event title: `陳小明 - 初診評估`
- Event description includes notes:
  ```
  患者：陳小明
  電話：0912-345-678
  預約類型：初診評估

  備註：
  左肩疼痛約一週
  ```

#### **API Endpoints for Clinic Admin Appointment Management**

##### **GET /api/clinic/appointments**

**Purpose**: Get all appointments for the clinic (admin view)

**Auth**: Clinic admin JWT

**Query Parameters:**
- `date` (optional): Filter by specific date (YYYY-MM-DD)
- `practitioner_id` (optional): Filter by practitioner
- `status` (optional): Filter by status ('confirmed', 'canceled_by_patient', 'canceled_by_clinic')

**Response:**
```json
{
  "appointments": [
    {
      "appointment_id": 123,
      "calendar_event_id": 456,
      "patient_name": "陳小明",
      "patient_phone": "0912345678",
      "practitioner_name": "王大明",
      "appointment_type_name": "初診評估",
      "start_time": "2025-11-15T10:00:00+08:00",
      "end_time": "2025-11-15T11:00:00+08:00",
      "status": "confirmed",
      "notes": "左肩疼痛約一週",
      "created_at": "2025-11-10T14:30:00+08:00"
    }
  ]
}
```

##### **DELETE /api/clinic/appointments/{appointment_id}**

**Purpose**: Cancel appointment by clinic admin

**Auth**: Clinic admin JWT

**Process:**
1. Verify clinic admin has permission for this clinic
2. Find appointment and verify it belongs to clinic
3. Update status to `'canceled_by_clinic'`
4. Delete corresponding Google Calendar event
5. Send LINE notification to patient
6. Return success response

**LINE Notification:**
```python
# Send clinic cancellation notification
api.push_message(
    to=patient.line_user.line_user_id,
    messages=TextSendMessage(
        text=f"您的預約已被診所取消：{formatted_date_time} - {practitioner_name}治療師。如需重新預約，請點選「線上約診」"
    )
)
```

**Response:**
```json
{
  "success": true,
  "message": "預約已取消，已通知患者",
  "appointment_id": 123
}
```

**Error Cases:**
- 403: No permission to cancel this appointment
- 404: Appointment not found
- 409: Appointment already cancelled

#### **Google Calendar Webhook Integration**

**Purpose**: Detect when therapists cancel appointments directly in Google Calendar and notify patients via LINE.

**Webhook Endpoint**: `POST /webhook/gcal`

**Process:**
1. Google sends push notification when calendar event is deleted
2. Webhook identifies the therapist and appointment
3. Updates appointment status to `'canceled_by_clinic'`
4. Sends LINE notification to patient with cancellation details
5. Logs the clinic-initiated cancellation

**LINE Notification Example:**
```python
# When therapist deletes from Google Calendar
api.push_message(
    to=patient.line_user.line_user_id,
    messages=TextSendMessage(
        text=f"您的預約已被取消：{formatted_date_time} - {practitioner_name}治療師。如需重新預約，請點選「線上約診」"
    )
)
```

**Webhook Headers Processed:**
- `X-Goog-Resource-State`: "exists", "sync", "not_exists"
- `X-Goog-Resource-ID`: Google Calendar watch resource ID
- `X-Goog-Channel-ID`: Channel identifier

**Error Handling:**
- Invalid resource ID → Log warning, return OK
- Missing Google Calendar credentials → Log warning, return OK
- LINE API failure → Log error, continue (don't fail webhook)
- Database errors → Log error, return 500

---

## Appendix B: Edge Cases & Error Handling

### B.1 Appointment Type Deletion

**Scenario**: Admin tries to delete appointment type that practitioners are offering

**Handling:**
1. Check if any `practitioner_appointment_types` reference this type
2. If yes: Block deletion with error
   ```json
   {
     "error": "無法刪除此預約類型",
     "message": "以下治療師正在提供此服務：王大明、李小華",
     "action": "請先移除治療師的此服務設定"
   }
   ```
3. If no: Check if any future appointments use this type
4. If yes: Block deletion with error
   ```json
   {
     "error": "無法刪除此預約類型",
     "message": "有 3 個未來的預約使用此類型",
     "action": "請等待預約完成後再刪除"
   }
   ```
5. Only allow deletion if no references exist

**Alternative**: Soft delete (mark as inactive) instead of hard delete

### B.2 Patient Deletion

**Scenario**: Patient is deleted from LINE user's account

**Handling:**
1. Check if patient has any future appointments
2. If yes: Block deletion with error
   ```json
   {
     "error": "無法刪除此就診人",
     "message": "此就診人有 2 個未來的預約",
     "action": "請先取消所有預約後再刪除"
   }
   ```
3. If no future appointments: Allow deletion
4. What happens to past appointments?
   - **Option A** (Recommended): Set `line_user_id` to NULL but keep patient record
     - Preserves appointment history for clinic records
     - Patient data remains in database but unlinked from LINE
   - **Option B**: Hard delete patient and cascade delete appointments
     - Clean but loses historical data

**Recommendation**: Use Option A (soft delete) to preserve appointment history

**SQL:**
```sql
-- Soft delete: Unlink from LINE user
UPDATE patients 
SET line_user_id = NULL 
WHERE id = ? AND line_user_id = ?;

-- Patient record remains in database for historical purposes
-- Clinic can still see past appointments in their records
```

### B.3 Practitioner Deletion/Deactivation

**Scenario**: Practitioner is removed from clinic or deactivated

**Handling:**
1. Check for future appointments
2. If yes: Block deletion/deactivation
   ```json
   {
     "error": "無法移除此治療師",
     "message": "此治療師有 5 個未來的預約",
     "action": "請先取消或重新分配預約"
   }
   ```
3. Cascade delete `practitioner_appointment_types` (ON DELETE CASCADE already set)
4. Past appointments remain linked (for historical records)

### B.4 Appointment Type Not Configured

**Scenario**: Practitioner hasn't configured any appointment types

**Handling:**
- Show warning in practitioner settings page
- Don't show this practitioner in booking UI
- Filter query:
  ```sql
  SELECT DISTINCT u.* 
  FROM users u
  INNER JOIN practitioner_appointment_types pat ON u.id = pat.user_id
  WHERE u.clinic_id = ? 
    AND pat.appointment_type_id = ?
    AND u.is_active = true
  ```
- If no practitioners offer a type: Show message in booking UI
  ```
  目前沒有治療師提供此服務
  請選擇其他預約類型或聯繫診所
  ```

### B.5 No Availability for Selected Type + Practitioner + Date

**Scenario**: User selects date but no time slots available

**Handling:**
- Show empty state:
  ```
  此日期無可用時段
  請選擇其他日期
  ```
- If "不指定治療師" and still no slots:
  ```
  此日期所有治療師皆已額滿
  請選擇其他日期
  ```

### B.6 Double Booking Race Condition

**Scenario**: Two patients try to book the same slot simultaneously

**Handling:**
1. Use database transaction with row-level locking
2. Check availability within transaction
3. First transaction succeeds, second fails
4. Return error to second user:
   ```json
   {
     "error": "此時段已被預約",
     "message": "請選擇其他時段",
     "available_slots": [...]  // Return nearby available slots
   }
   ```

**SQL:**
```sql
BEGIN;
-- Lock calendar_events table for this practitioner + time range
SELECT 1 FROM calendar_events 
WHERE user_id = ? 
  AND start_time < ? 
  AND end_time > ?
FOR UPDATE;

-- If no conflict, insert
INSERT INTO calendar_events ...;
COMMIT;
```

### B.7 LINE User ID Change

**Scenario**: User changes LINE account or gets banned

**Handling:**
- LINE user IDs are stable and don't change
- If user uninstalls/reinstalls LINE, ID remains same
- If user gets new LINE account, they must re-register (new LINE user record)
- Old appointments remain in database unaffected

### B.8 Clinic Deletion

**Scenario**: Clinic subscription ends or clinic closes

**Handling:**
- Soft delete: Set `clinic.is_active = false`
- Disable LIFF access (show "診所服務已停用" message)
- Keep all historical data
- CASCADE delete relationships when hard deleting:
  - Appointments
  - Patients
  - Practitioner availability
  - Appointment types
  - Calendar events

**Note**: Implement soft delete for production safety

---

## Appendix C: LINE LIFF Resources

- **LIFF Documentation**: https://developers.line.biz/en/docs/liff/overview/
- **LIFF SDK Reference**: https://developers.line.biz/en/reference/liff/
- **LINE Login Documentation**: https://developers.line.biz/en/docs/line-login/overview/
- **Rich Menu API**: https://developers.line.biz/en/reference/messaging-api/#rich-menu

## Appendix D: ICS Format Reference

- **iCalendar RFC**: https://datatracker.ietf.org/doc/html/rfc5545
- **ICS Format Guide**: https://icalendar.org/

## Appendix E: Removed Components

**Files to delete:**
```
backend/src/clinic_agents/
├── __init__.py
├── agents/
│   ├── __init__.py
│   ├── account_linking_agent.py
│   ├── appointment_agent.py
│   └── triage_agent.py
├── clinic_readiness.py
├── context.py
├── history_utils.py
├── line_user_utils.py
├── orchestrator.py
├── session_utils.py
├── tools/
│   ├── __init__.py
│   ├── appointment_tools.py
│   ├── availability_tools.py
│   ├── calendar_tools.py
│   ├── cancel_appointment.py
│   ├── datetime_tools.py
│   └── patient_tools.py
└── workflow_handlers.py
```

**Functions to update:**
- `backend/src/api/webhooks.py`: Remove message webhook handler, keep calendar webhook
- `backend/src/main.py`: Remove agent-related imports and routes

---

**End of Design Document**

