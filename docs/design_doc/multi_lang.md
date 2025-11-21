# Multi-Language Support for LIFF App

## Overview

This document outlines the design for adding multi-language support to the LIFF (LINE Front-end Framework) application. The app will support two languages: Traditional Chinese (繁體中文) and English, with Traditional Chinese as the default language.

## Objectives

1. **User Experience**: Allow users to select their preferred language when entering the app
2. **Comprehensive Translation**: Translate all user-facing messages, including:
   - UI labels and buttons
   - Error messages
   - Success messages
   - Form placeholders
   - Confirmation dialogs
   - Status messages
3. **Preference Persistence**: Store user language preference in database for immediate use and future LINE message personalization

## Supported Languages

1. **繁體中文 (Traditional Chinese)** - Default language
2. **English** - Secondary language

### Language Detection Priority

1. User's saved preference from database (`line_user.preferred_language`)
2. Default to Traditional Chinese (繁體中文) if no preference exists

**Note**: Since 95% of users will use Traditional Chinese, we skip browser language detection and default directly to Traditional Chinese.

## Architecture

### Frontend Structure

```
frontend/src/
├── i18n/
│   ├── index.ts              # i18n configuration and initialization
│   ├── locales/
│   │   ├── zh-TW.ts          # Traditional Chinese translations
│   │   └── en.ts             # English translations
│   └── hooks/
│       └── useTranslation.ts # React hook for translations
├── liff/
│   └── components/
│       └── LanguageSelector.tsx  # Language selection component
└── contexts/
    └── LanguageContext.tsx       # Language context provider
```

### Translation Library

**Recommended**: Use a lightweight i18n solution. Options:
- **react-i18next** (most popular, feature-rich)
- **i18next** (core library, can be used standalone)
- **Custom solution** (simple key-value store with React context)

**Recommendation**: Use `react-i18next` for its maturity, TypeScript support, and React integration.

### Storage Strategy

**Decision**: Use database storage from the start, skip localStorage entirely.

**Rationale**:
- 95% of users will use Traditional Chinese (default), so no need for localStorage fallback
- Database column will be needed soon anyway for LINE message personalization
- Simpler implementation without localStorage migration logic
- Single source of truth in database

**Implementation**:
- Add `preferred_language` field to `LineUser` model immediately
- Store preference per LINE user account in database
- Default to `'zh-TW'` (Traditional Chinese) if no preference exists
- Load preference from database on LIFF login
- **Store immediately to database** when user selects a different language from the dropdown
- No localStorage needed

## Translation Scope

### Components Requiring Translation

#### 1. Home Page (`LiffHome.tsx`)
- Menu items: "新增預約", "預約管理", "就診人管理", "空位提醒"
- Descriptions for each menu item

#### 2. Appointment Flow (`AppointmentFlow.tsx` and steps)
- Step names: "選擇類型", "選擇治療師", "選擇時間", "選擇就診人", "備註", "確認預約"
- Headers: "新增預約"
- Button labels: "確認預約", "預約中...", "完成"
- Error messages: "無法載入預約類型", "無法載入治療師列表", etc.
- Status messages: "目前沒有可用的預約類型", "目前沒有治療師提供此服務"
- Form labels and placeholders

#### 3. Appointment List (`AppointmentList.tsx`)
- Headers: "預約管理"
- Empty state: "目前沒有預約", "點選「新增預約」來預約您的就診時間"
- Status labels: "已確認", "已取消", "診所取消"
- Action buttons: "取消預約"
- Confirmation dialogs: "確定要取消此預約嗎？", "確認取消"
- Error messages: "無法載入預約記錄", "取消預約失敗，請稍後再試"

#### 4. Patient Management (`PatientManagement.tsx`)
- Headers: "就診人管理", "編輯就診人", "新增就診人"
- Form labels: "姓名", "手機號碼", "生日"
- Placeholders: "請輸入姓名", "請輸入手機號碼 (0912345678)"
- Buttons: "確認", "取消", "編輯", "刪除", "更新中...", "新增就診人"
- Error messages: "請輸入姓名", "請輸入手機號碼", "無法載入就診人列表"
- Confirmation dialogs: "確定要刪除就診人「{name}」？", "確認刪除"
- Alert messages: "至少需保留一位就診人", "無法刪除", "刪除就診人失敗，請稍後再試"

#### 5. Notifications Flow (`NotificationsFlow.tsx`, `AddNotification.tsx`, `ManageNotifications.tsx`)
- Headers: "空位提醒", "新增提醒"
- Labels: "預約類型", "選擇日期與時段"
- Buttons: "新增", "刪除"
- Messages: "當有可用時段時，我們會透過 LINE 通知您"
- Error messages: "無法載入提醒列表", "無法載入預約類型", "請選擇預約類型"

#### 6. Status Components (`StatusComponents.tsx`)
- Error messages: "發生錯誤", "重試"
- Invalid access: "存取無效", "請從診所的LINE官方帳號進入此應用程式"
- **Note**: These are currently hardcoded and must be translated using `useTranslation()` hook

#### 7. Modal Context Messages
- All `showAlert` and `showConfirm` calls throughout LIFF components must use translation keys
- Examples:
  - `'確定要取消此預約嗎？'` → `t('appointment.confirmCancel')`
  - `'確認取消'` → `t('appointment.cancelTitle')`
  - `'至少需保留一位就診人'` → `t('patient.errors.cannotDeleteLast')`
  - `'無法刪除'` → `t('patient.errors.cannotDeleteTitle')`
- **Affected files**: `PatientManagement.tsx`, `AppointmentList.tsx`, `ManageNotifications.tsx`, `Step7Success.tsx`, and others using `useModal()` hook

#### 8. Time Window Labels
- `ManageNotifications.tsx` has hardcoded time window labels:
  ```typescript
  const TIME_WINDOW_LABELS: Record<string, string> = {
    morning: '上午',
    afternoon: '下午',
    evening: '晚上',
  };
  ```
- Must be moved to translation keys: `t('timeWindow.morning')`, etc.


#### 8. Date/Time Formatting
- Use consistent date/time format across all languages to keep it similar
- Use `moment.js` with locale support (already in dependencies)
- **Format**: Use a consistent format like "YYYY-MM-DD HH:mm" or "YYYY年MM月DD日 HH:mm" across all languages
- **Decision**: Keep date/time format similar across languages for consistency and easier parsing

### Error Message Translation Strategy

#### Backend Error Messages
- **Decision**: Translate backend error messages on the frontend
- Backend currently returns error messages in Traditional Chinese
- **Implementation**: Map backend error messages to translation keys in frontend

**Error Translation Utility Example**:
```typescript
// frontend/src/utils/errorTranslation.ts
import { TFunction } from 'i18next';
import { getErrorMessage, ApiErrorType } from '../types/api';

const BACKEND_ERROR_MAP: Record<string, string> = {
  '診所不存在或已停用': 'error.clinicNotFound',
  '認證失敗': 'error.authFailed',
  '無法載入預約類型': 'error.loadAppointmentTypes',
  '無法載入治療師列表': 'error.loadPractitioners',
  '無法載入預約記錄': 'error.loadAppointments',
  '無法載入就診人列表': 'error.loadPatients',
  '取消預約失敗': 'error.cancelAppointmentFailed',
  '至少需保留一位就診人': 'error.cannotDeleteLastPatient',
  '無法刪除此就診人，因為該就診人尚有未來的預約記錄': 'error.cannotDeletePatientWithAppointments',
  // Add more mappings as needed
};

/**
 * Translate backend error messages to user's selected language.
 * Integrates with existing getErrorMessage utility for consistent error extraction.
 */
export function translateBackendError(
  error: ApiErrorType,  // Use same type as getErrorMessage accepts
  t: TFunction
): string {
  // First extract the error message using existing utility
  const errorMessage = getErrorMessage(error);
  
  // Then translate it
  const translationKey = BACKEND_ERROR_MAP[errorMessage];
  if (translationKey) {
    return t(translationKey);
  }
  
  // Fallback: return original message (in Traditional Chinese)
  // This ensures users always see an error message, even if not translated yet
  return errorMessage;
}
```

- **Benefits**: 
  - No backend changes required initially
  - Centralized error translation logic
  - Easy to maintain and extend
  - Graceful fallback to original message if translation missing

#### Frontend Error Messages
- All frontend-generated error messages must use translation keys
- Use `t('error.loadingFailed')` instead of hardcoded strings

## Language Selection UI

### Initial Language Selection

**Decision**: No modal popup. Display in Traditional Chinese by default, allow users to change via dropdown.

**Rationale**: 
- 95% of users will use Traditional Chinese, so they won't need to select a language
- No need for intrusive modal that blocks interaction
- Users who need a different language can easily change it via dropdown

**Implementation**:
- **Default**: App displays in Traditional Chinese (繁體中文) immediately
- **Language Selector**: Add a language dropdown/button on the **home page only** (`LiffHome.tsx`)
  - **Placement**: Top-right corner of the home page
  - **Rationale**: Since 95% of users use Traditional Chinese, they won't need to change language. Placing it only on the home page prevents accidental language changes during actions (unless user uses two devices concurrently).
  - Shows current language (e.g., "繁體中文" or flag icon)
  - Dropdown menu with options:
    - 🇹🇼 繁體中文
    - 🇬🇧 English
- **No modal**: Users are not prompted to select language on first visit
- **Immediate save**: When user selects a different language, save to database immediately

### Language Selector Component

```typescript
// frontend/src/liff/components/LanguageSelector.tsx
// Place in LiffHome.tsx (home page only)

import { FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { liffApiService } from '../../services/liffApi';
import { isValidLanguage } from '../../utils/languageUtils';
import { translateBackendError } from '../../utils/errorTranslation';

export const LanguageSelector: FC = () => {
  const { i18n, t } = useTranslation();
  const [isUpdating, setIsUpdating] = useState(false);
  
  const handleLanguageChange = async (newLanguage: string) => {
    if (!isValidLanguage(newLanguage)) {
      return; // Invalid language code
    }
    
    // Optimistic update
    i18n.changeLanguage(newLanguage);
    setIsUpdating(true);
    
    try {
      await liffApiService.updateLanguagePreference(newLanguage);
    } catch (error) {
      // Show error but keep UI updated (user intent is clear)
      const errorMessage = translateBackendError(error, t);
      // Show toast/notification (implement based on your notification system)
      console.error('Failed to save language preference:', errorMessage);
    } finally {
      setIsUpdating(false);
    }
  };
  
  const currentLanguage = i18n.language;
  
  return (
    <div className="relative">
      <button
        disabled={isUpdating}
        className="flex items-center space-x-2 px-3 py-2 rounded-md hover:bg-gray-100"
        aria-label={t('common.selectLanguage')}
        aria-haspopup="true"
      >
        {/* Language flag/icon and current language display */}
        {/* Dropdown menu with language options */}
      </button>
    </div>
  );
};
```

**Key Features**:
- Display current language flag/icon on home page (top-right)
- Dropdown menu with: 🇹🇼 繁體中文, 🇬🇧 English
- Optimistic UI update for instant feedback
- Loading state during API call
- Error handling with user-friendly messages
- Accessibility: ARIA labels and keyboard navigation

## Implementation Plan

### Phase 1: Setup and Core Infrastructure

1. **Install Dependencies**
   ```bash
   npm install react-i18next i18next
   ```
   **Note**: We don't need `i18next-browser-languagedetector` since we default to Traditional Chinese and load preference from database.

2. **Create Translation Files**
   - Create `frontend/src/i18n/locales/zh-TW.ts`
   - Create `frontend/src/i18n/locales/en.ts`
   - Structure translations by feature/component

3. **Configure i18n**
   - Initialize i18next with default language 'zh-TW'
   - **Initialization Sequence**:
     1. Initialize i18n with default language ('zh-TW')
     2. Perform LIFF login
     3. If `preferred_language` is returned from API and differs from default, change i18n language
     4. If API call fails or no preference, keep default
   - Configure missing key handler to log warnings in development
   
   **Implementation Example**:
   ```typescript
   // In LiffApp.tsx or useLineAuth hook
   useEffect(() => {
     const initializeLanguage = async () => {
       // 1. Initialize with default
       i18n.changeLanguage('zh-TW');
       
       // 2. After LIFF login completes
       if (loginResponse?.preferred_language) {
         i18n.changeLanguage(loginResponse.preferred_language);
       }
     };
     
     if (loginResponse) {
       initializeLanguage();
     }
   }, [loginResponse]);
   ```

4. **Create i18n Configuration**
   - Create `frontend/src/i18n/index.ts` with i18n setup:
     ```typescript
     // frontend/src/i18n/index.ts
     import i18n from 'i18next';
     import { initReactI18next } from 'react-i18next';
     import zhTW from './locales/zh-TW';
     import en from './locales/en';

     i18n
       .use(initReactI18next)
       .init({
         resources: {
           'zh-TW': { translation: zhTW },
           'en': { translation: en },
         },
         lng: 'zh-TW', // Default language
         fallbackLng: 'zh-TW',
         interpolation: {
           escapeValue: false, // React already escapes
         },
         missingKeyHandler: (lng, ns, key) => {
           if (process.env.NODE_ENV === 'development') {
             console.warn(`Missing translation: ${key} for language: ${lng}`);
           }
         },
       });

     export default i18n;
     ```
   - **Note**: react-i18next provides built-in context via `I18nextProvider` and `useTranslation` hook
   - No custom `LanguageContext` needed unless tracking additional state (loading, errors, analytics)

### Phase 2: Translation Implementation

1. **Extract All Hardcoded Strings**
   - Audit all LIFF components for hardcoded Chinese text
   - Create translation keys for each string
   - Organize keys by component/feature

2. **Translate Components**
   - Replace hardcoded strings with `t()` calls
   - Start with most visible components (Home, Appointment Flow)
   - Progress through all components systematically

3. **Translate Error Messages**
   - Map backend error messages to translation keys
   - Create error message translation utilities
   - Ensure all error states show translated messages

### Phase 3: Language Selection UI

1. **Create LanguageSelector Component**
   - Design and implement language selector UI (dropdown)
   - Add to home page (`LiffHome.tsx`) in top-right corner
   - **Note**: Language selector only appears on home page, not on other pages

2. **Implement Preference Persistence**
   - **Add API method** to `LiffApiService` in `frontend/src/services/liffApi.ts`:
     ```typescript
     async updateLanguagePreference(language: string): Promise<{ preferred_language: string }> {
       const response = await this.client.put('/liff/language-preference', { language });
       return response.data;
     }
     ```
   - **Frontend validation**: Validate language code before API call
     ```typescript
     // frontend/src/utils/languageUtils.ts
     export const VALID_LANGUAGES = ['zh-TW', 'en'] as const;
     export type LanguageCode = typeof VALID_LANGUAGES[number];
     
     export function isValidLanguage(code: string): code is LanguageCode {
       return VALID_LANGUAGES.includes(code as LanguageCode);
     }
     ```
   - Save to database immediately when user selects language
   - Load preference from database on app initialization (via LIFF login API)
   - Handle API errors gracefully:
     - Show toast/notification error message
     - Keep UI in new language (don't revert - user intent is clear)
     - Log error for monitoring
     - Allow retry
   - Update UI immediately on language change (optimistic update)
   - Show loading state on language selector during API call
   - Disable language selector during save to prevent rapid changes

### Phase 4: Testing and Refinement

1. **Test All Languages**
   - Verify all translations display correctly
   - Test language switching in real-time
   - Verify database persistence (preference saved and loaded correctly)

2. **UI/UX Testing**
   - Ensure language selector is accessible
   - Test on different screen sizes
   - Verify text doesn't overflow in different languages

3. **Error Handling**
   - Test error messages in all languages
   - Verify fallback to default language if translation missing

## Database Integration

### Database Schema Changes

#### Add to `LineUser` Model

```python
# backend/src/models/line_user.py

class LineUser(Base):
    # ... existing fields ...
    
    preferred_language: Mapped[Optional[str]] = mapped_column(
        String(10), 
        nullable=True,
        server_default='zh-TW'  # Database-level default, matches migration
    )
    """
    User's preferred language for UI and LINE messages.
    
    Values: 'zh-TW' (Traditional Chinese), 'en' (English)
    Default: 'zh-TW'
    """
```

#### Migration

Create Alembic migration to add `preferred_language` column to `line_users` table.

```python
# alembic/versions/XXXX_add_preferred_language_to_line_users.py

def upgrade() -> None:
    op.add_column(
        'line_users',
        sa.Column(
            'preferred_language',
            sa.String(10),
            nullable=True,
            server_default='zh-TW'  # Database-level default for existing rows
        )
    )

def downgrade() -> None:
    op.drop_column('line_users', 'preferred_language')
```

**Note**: 
- `server_default='zh-TW'` ensures existing rows get Traditional Chinese as default
- This should be implemented as part of Phase 1, not as a future enhancement

### API Changes

#### Update LiffLoginResponse Model

```python
# backend/src/api/liff.py

class LiffLoginResponse(BaseModel):
    """Response model for LIFF authentication."""
    access_token: str
    token_type: str = "Bearer"
    expires_in: int = 604800  # 7 days
    is_first_time: bool
    display_name: str
    clinic_id: int
    preferred_language: Optional[str] = 'zh-TW'  # User's preferred language, defaults to Traditional Chinese
```

#### Update LIFF Login Endpoint

```python
# backend/src/api/liff.py

@router.post("/auth/liff-login", response_model=LiffLoginResponse)
async def liff_login(
    request: LiffLoginRequest,
    db: Session = Depends(get_db)
):
    # ... existing logic ...
    # (LineUser is created/retrieved earlier in the login flow)
    # (is_first_time is calculated based on patient existence)
    
    # Return user's preferred language if available
    preferred_language = line_user.preferred_language or 'zh-TW'
    
    return LiffLoginResponse(
        access_token=access_token,
        is_first_time=is_first_time,
        display_name=request.display_name,
        clinic_id=clinic.id,
        preferred_language=preferred_language
    )
```

#### Add Language Preference Update Endpoint

```python
# backend/src/api/liff.py

class LanguagePreferenceRequest(BaseModel):
    """Request model for updating language preference."""
    language: str
    
    @field_validator('language')
    @classmethod
    def validate_language(cls, v: str) -> str:
        if v not in ['zh-TW', 'en']:
            raise ValueError("Invalid language code. Must be 'zh-TW' or 'en'")
        return v

@router.put("/language-preference")
async def update_language_preference(
    request: LanguagePreferenceRequest,  # Use Pydantic model in request body (matches codebase pattern)
    line_user: LineUser = Depends(get_current_line_user),
    db: Session = Depends(get_db)
):
    """
    Update LINE user's language preference.
    
    Note: get_current_line_user requires LineUser to exist (created during LIFF login).
    This endpoint is only accessible after successful login, so LineUser will always exist.
    """
    try:
        # Update LineUser record
        # Language code is already validated by Pydantic model
        line_user.preferred_language = request.language
        db.commit()
        db.refresh(line_user)
        return {"preferred_language": request.language}
    except Exception as e:
        db.rollback()
        logger.exception(f"Failed to update language preference: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to update language preference"
        )
```

**Note**: 
- The endpoint path will be `/liff/language-preference` based on the router prefix configuration
- Uses request body with Pydantic model (consistent with other PUT endpoints in codebase)
- `get_current_line_user` does NOT create LineUser - it requires authentication, so LineUser must already exist from LIFF login

### Frontend Integration

1. **Load Preference from API**
   - On LIFF login, check API response for `preferred_language`
   - **Update TypeScript interface** in `frontend/src/services/liffApi.ts`:
     ```typescript
     export interface LiffLoginResponse {
       access_token: string;
       token_type: string;
       expires_in: number;
       is_first_time: boolean;
       display_name: string;
       clinic_id: number;
       preferred_language?: string;  // Optional for backward compatibility
     }
     ```
   - If available, use database preference
   - If not available (null or undefined), default to 'zh-TW'
   - Initialize i18n with the loaded preference

2. **Save Preference to Database**
   - **When**: Immediately when user selects a different language from the dropdown
   - **Implementation flow**:
     1. User selects language from dropdown
     2. Frontend updates UI immediately (optimistic update)
     3. Frontend calls `PUT /liff/language-preference` with request body `{ language: selectedLanguage }`
     4. Backend updates `line_user.preferred_language` field
     5. If API call fails, show error message but keep UI updated (user can retry)
   - **No localStorage**: All preferences stored in database only

3. **When is Language Preference Saved to Database?**
   - **Immediately** when user selects a different language from the language dropdown
   - The `LineUser` record is created during:
     - **LIFF login** (when user first authenticates) - this is the primary creation point
     - **Patient creation** (via `get_current_line_user_with_clinic` which can create LineUser if missing)
   - **Important**: The language preference endpoint uses `get_current_line_user`, which does NOT create LineUser
     - It requires authentication, so LineUser must already exist from LIFF login
     - If LineUser doesn't exist, the endpoint will return 401 Unauthorized
     - This is expected behavior since language preference can only be set after login

## Translation Key Structure

### Recommended Structure

```typescript
// Example structure for translations
// Naming Convention:
// - Use camelCase for keys: selectType, not select_type
// - Use dot notation for hierarchy: appointment.steps.selectType
// - Group by feature/component: appointment.errors.*, patient.form.*
// - Use descriptive names: loadAppointmentTypes, not loadTypes

{
  common: {
    confirm: "確認",
    cancel: "取消",
    retry: "重試",
    save: "儲存",
    delete: "刪除",
    edit: "編輯",
    add: "新增",
    loading: "載入中...",
    error: "發生錯誤",
    success: "成功"
  },
  home: {
    title: "新增預約",
    description: "預約新的就診時間",
    // ...
  },
  appointment: {
    steps: {
      selectType: "選擇類型",
      selectPractitioner: "選擇治療師",
      selectDateTime: "選擇時間",
      selectPatient: "選擇就診人",
      addNotes: "備註",
      confirmation: "確認預約"
    },
    errors: {
      loadTypes: "無法載入預約類型，請稍後再試",
      loadPractitioners: "無法載入治療師列表，請稍後再試",
      loadAppointments: "無法載入預約記錄",
      cancelFailed: "取消預約失敗，請稍後再試"
    },
    confirmation: {
      title: "確認預約",
      message: "您確定要預約 {practitioner} 於 {date} 的 {type} 嗎？",
      // Interpolation example: t('appointment.confirmation.message', { practitioner: 'Dr. Smith', date: '2024-01-15', type: 'Consultation' })
    }
  },
  patient: {
    form: {
      name: {
        label: "姓名",
        placeholder: "請輸入姓名",
        error: {
          required: "請輸入姓名",
          invalid: "姓名格式不正確"
        }
      },
      phone: {
        label: "手機號碼",
        placeholder: "請輸入手機號碼 (0912345678)",
        error: {
          required: "請輸入手機號碼",
          invalid: "手機號碼格式不正確"
        }
      }
    },
    errors: {
      loadFailed: "無法載入就診人列表",
      deleteFailed: "刪除就診人失敗，請稍後再試",
      cannotDeleteLast: "至少需保留一位就診人",
      cannotDeleteWithAppointments: "無法刪除此就診人，因為該就診人尚有未來的預約記錄。\n\n請先刪除或取消相關預約後再試。"
    }
  },
  error: {
    clinicNotFound: "診所不存在或已停用",
    authFailed: "認證失敗",
    loadAppointmentTypes: "無法載入預約類型，請稍後再試",
    loadPractitioners: "無法載入治療師列表，請稍後再試",
    loadAppointments: "無法載入預約記錄",
    cancelAppointmentFailed: "取消預約失敗，請稍後再試",
    cannotDeleteLastPatient: "至少需保留一位就診人",
    cannotDeletePatientWithAppointments: "無法刪除此就診人，因為該就診人尚有未來的預約記錄。\n\n請先刪除或取消相關預約後再試。"
  }
  // ... more sections
}
```

**Missing Translation Fallback Strategy**:
- If a translation key is missing, react-i18next will show the key itself (e.g., `appointment.steps.selectType`)
- In production, log missing keys for monitoring
- During development, use i18next's `missingKeyHandler` to log warnings
- Always fallback to Traditional Chinese if translation file fails to load

## Technical Considerations

### Date/Time Localization

- **Decision**: Keep date/time format similar across all languages for consistency
- Use `moment.js` with locale support (already in dependencies)
- Use a consistent format: **"YYYY-MM-DD HH:mm"** (e.g., "2024-01-15 14:30") across all languages
- This format is universal, easy to parse, and works well for both languages
- Avoid locale-specific date formats to maintain consistency and easier parsing
- Only translate date/time labels (e.g., "Date", "Time") but keep the format similar

### Number Formatting

- Use `Intl.NumberFormat` for number formatting
- Consider locale-specific number formats if needed

### RTL Support

- Not required for current languages (all LTR)
- Design should be flexible for future RTL languages if needed

### Performance

- Lazy load translation files if needed
- Cache translations in memory
- Minimize re-renders when switching languages

### Accessibility

- Ensure language selector is keyboard accessible
- Use proper ARIA labels for language selection
- Maintain focus management during language changes

### Language Switching During User Actions

**Decision**: Language selector is only available on the home page, so users are unlikely to change language in the middle of an action (unless using two devices concurrently).

**If language change occurs**:
- Language change updates UI immediately (optimistic update)
- Form data is preserved (language change doesn't reset forms)
- User can continue their current action in the new language
- No warning dialog needed - language change is non-destructive

**Multiple Tabs/Devices**:
- Language preference changes are saved to database immediately
- Other open tabs/devices will use the new preference on next app initialization (page refresh or new session)
- This is expected behavior - language changes take effect on next login for other devices

**Token Expiration During Language Change**:
- If JWT token expires while changing language, API call will fail with 401
- Error handler will show authentication error
- User will need to re-authenticate; language change will be lost and revert to previous preference

## Testing Strategy

### Unit Tests

- Test translation key resolution
- Test language switching logic
- Test API integration for saving/loading preferences

### Integration Tests

- Test language selection flow
- Test preference loading from database on app initialization
- Test saving preference to database when user changes language
- Test error message translation
- Test fallback to default language if database preference is null

### Manual Testing Checklist

- [ ] All UI text is translated in both languages
- [ ] Language selector works correctly (dropdown on home page only)
- [ ] Preference loads from database on app initialization
- [ ] Preference saves to database immediately when user changes language
- [ ] App defaults to Traditional Chinese if no preference exists
- [ ] Error messages display in selected language
- [ ] Date/time formatting is consistent across languages
- [ ] No text overflow in any language
- [ ] Language switching updates UI immediately
- [ ] No modal popup on first visit (defaults to Traditional Chinese)

## Migration Path

### For Existing Users

1. **No Breaking Changes**: Existing users will default to Traditional Chinese (since `preferred_language` will be null)
2. **Gradual Adoption**: Users can opt-in to language selection via dropdown
3. **Database Migration**: 
   - Existing `LineUser` records will have `preferred_language = null`
   - Default to 'zh-TW' when null
   - No migration needed - users can select language when they want

### Backward Compatibility

- Always fallback to Traditional Chinese if translation missing
- Support partial translations during development
- Log missing translation keys for monitoring

## Success Metrics

1. **User Adoption**: Track language preference distribution
2. **Error Rate**: Monitor missing translation errors
3. **User Satisfaction**: Collect feedback on language support
4. **Performance**: Monitor app load time with i18n

## Future Enhancements

1. **Additional Languages**: Easy to add more languages with current architecture
2. **Backend Localization**: Extend to LINE message localization
3. **Auto-detection**: Improve browser language detection
4. **Regional Variants**: Support for simplified Chinese, regional English variants
5. **Admin UI Localization**: Extend to admin interface if needed

## Design Decisions

### Storage Strategy
**Decision**: Use database storage from the start, skip localStorage entirely.
- **Rationale**: 
  - 95% of users will use Traditional Chinese (default), so no need for localStorage fallback
  - Database column will be needed soon anyway for LINE message personalization
  - Simpler implementation without localStorage migration logic
  - Single source of truth in database
- Add `preferred_language` column to `LineUser` model as part of Phase 1
- Store preference immediately to database when user selects a different language from dropdown
- Default to 'zh-TW' if no preference exists in database

### Date/Time Formats
**Decision**: Keep date/time format similar across all languages for consistency.
- Use consistent format: **"YYYY-MM-DD HH:mm"** (e.g., "2024-01-15 14:30") across all languages
- This format is universal, easy to parse programmatically, and works well for all three languages
- Only translate date/time labels (e.g., "Date", "Time") but keep the format similar

### Error Message Translation
**Decision**: Translate backend error messages on the frontend.
- Map backend error messages/codes to translation keys in frontend
- No backend changes required initially
- Centralized error translation logic

### Clinic Information Localization
**Decision**: Leave for future implementation.
- Clinic names, addresses, and other clinic-specific information will remain in their original language for now
- Can be extended in the future if needed

### First-Time User Language Selection
**Decision**: No modal popup. Display in Traditional Chinese by default, allow users to change via dropdown.
- **Rationale**: 95% of users will use Traditional Chinese, so they won't need to select a language
- App displays in Traditional Chinese immediately (no prompt)
- Language selector dropdown in app header (top-right corner) for users who want to change
- When user selects a different language, save to database immediately

## References

- [react-i18next Documentation](https://react.i18next.com/)
- [i18next Documentation](https://www.i18next.com/)
- [LIFF Documentation](https://developers.line.biz/en/docs/liff/)
- [Moment.js Locales](https://momentjs.com/docs/#/i18n/)

