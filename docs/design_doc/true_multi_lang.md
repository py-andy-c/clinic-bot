# Multi-Language Support Design

## Overview

This document outlines the design for comprehensive multi-language support in the clinic-bot system. The system currently has limited multi-language support in the LIFF frontend (UI labels only), but lacks translation for:
- LINE messages sent to patients
- Clinic-set content (service item names, descriptions, clinic info)
- Receipts
- Message templates with placeholders

This design extends multi-language support to all patient-facing content while maintaining a clean, optional feature that doesn't disrupt pure-Chinese clinics.

## Current State Analysis

### What's Already Translated
- **LIFF UI**: UI labels, buttons, error messages, form placeholders (via `react-i18next`)
- **Date/Time Formatting**: Weekday names in date displays (e.g., "12/25 (三)" → "12/25 (Wed)")

### What's NOT Translated

#### 1. LINE Messages
- Appointment confirmation messages
- Reminder messages
- Availability notifications
- Follow-up messages
- All message templates with placeholders

#### 2. Clinic-Set Content
- **Service Items (Appointment Types)**:
  - `name` (displayed in booking flow)
  - `description` (shown to patients)
  - `receipt_name` (on receipts)
  - Message templates (`patient_confirmation_message`, `clinic_confirmation_message`, `reminder_message`)
- **Clinic Information**:
  - `display_name` (clinic name)
  - `address` (clinic address)
  - `phone_number` (clinic phone)
  - `appointment_type_instructions` (shown to patients)
  - `appointment_notes_instructions` (shown to patients)
- **Chat Settings** (AI-facing, but may need formatting for AI context):
  - All chat settings fields (clinic_description, therapist_info, etc.) - **NOT translated** (AI-facing only)

#### 3. Receipts
- All receipt text (labels, headers, payment methods)
- Service item names on receipts
- Clinic name on receipts
- Custom notes on receipts

#### 4. Date/Time in Messages
- Date/time formatting in LINE messages (weekday translation already exists in LIFF, needs to be applied to messages)

## Design Principles

1. **Optional Feature**: Multi-language is optional. Pure-Chinese clinics see no changes.
2. **Un-intrusive UI**: Small translation icon near Chinese fields, not a centralized settings page.
3. **Per-Field Translation**: Each translatable field has its own translation UI.
4. **Frontend Auto-Translation**: Auto-translate happens in frontend, requires user confirmation, doesn't save until "儲存變更".
5. **Fallback to Chinese**: Always fallback to Chinese if translation unavailable.
6. **Extensible**: Design supports adding more languages in future, per-clinic language selection.
7. **Patient-Side Only**: Clinic users always see Chinese. Only patient-facing content is translated.

## Data Model Design

### Translation Storage Strategy

**Option A: JSONB Column per Entity** (Recommended)
- Add `translations` JSONB column to relevant tables
- Structure: `{"en": {"name": "Massage Therapy", "description": "..."}, "ja": {...}}`
- Pros: Simple, flexible, no joins needed
- Cons: Less normalized, harder to query all translations

**Option B: Separate Translation Table (Generic)**
- Create single `translations` table with `entity_type`, `entity_id`, `field_name`, `language_code`
- Pros: Normalized, easier to query across entities, better for analytics, supports bulk operations
- Cons: More complex joins, additional table to manage, requires entity_type enum

**Option C: Per-Entity Translation Tables**
- Create `appointment_type_translations`, `clinic_info_translations`, etc.
- Pros: Type-safe, clear schema
- Cons: Many tables, harder to maintain, not scalable

**Recommendation: Option A (JSONB)** - Simpler, more flexible, aligns with existing JSONB usage in clinic settings. Consider Option B if we need advanced querying/analytics in the future.

### Database Schema Changes

#### 1. AppointmentType Table
```sql
ALTER TABLE appointment_types 
ADD COLUMN translations JSONB DEFAULT '{}'::jsonb;

-- Index for efficient querying
CREATE INDEX idx_appointment_types_translations ON appointment_types USING GIN (translations);
```

Structure:
```json
{
  "en": {
    "name": "Massage Therapy",
    "description": "Relaxing full-body massage",
    "receipt_name": "Massage Therapy",
    "patient_confirmation_message": "...",
    "clinic_confirmation_message": "...",
    "reminder_message": "..."
  }
}
```

#### 2. Clinic Settings (clinic_info_settings)
Add translations to `clinic_info_settings` in `clinics.settings` JSONB:
```json
{
  "clinic_info_settings": {
    "display_name": "我的診所",
    "address": "台北市...",
    "phone_number": "02-1234-5678",
    "appointment_type_instructions": "...",
    "appointment_notes_instructions": "...",
    "translations": {
      "en": {
        "display_name": "My Clinic",
        "address": "Taipei City...",
        "phone_number": "02-1234-5678",
        "appointment_type_instructions": "...",
        "appointment_notes_instructions": "..."
      }
    }
  },
  "enabled_languages": ["zh-TW", "en"],
  "default_language": "zh-TW"
}
```

#### 2a. Service Type Groups
Add translations to `service_type_groups` table:
```sql
ALTER TABLE service_type_groups 
ADD COLUMN translations JSONB DEFAULT '{}'::jsonb;

-- Structure:
-- {
--   "en": {
--     "name": "Group Name in English"
--   }
-- }
```
**Note**: Service type groups are shown to patients in LIFF, so translation is needed.

#### 3. Receipt Settings
Add translations to `receipt_settings`:
```json
{
  "receipt_settings": {
    "custom_notes": "...",
    "translations": {
      "en": {
        "custom_notes": "...",
        "receipt_static_text": {
          "receipt_title": "Receipt",
          "receipt_number": "Receipt Number",
          "checkout_time": "Checkout Time",
          "visit_date": "Visit Date",
          "patient_name": "Name",
          "item": "Item",
          "quantity": "Quantity",
          "amount": "Amount",
          "subtotal": "Subtotal",
          "total": "Total",
          "payment_method_cash": "Cash",
          "payment_method_card": "Credit Card",
          "payment_method_transfer": "Transfer",
          "change": "Change",
          "stamp_text": "Received"
        }
      }
    }
  }
}
```

**Note**: Receipt static text translations can be stored in receipt_settings or as system constants. System constants are recommended for common labels (receipt, receipt number, etc.) to avoid duplication across clinics.

### Translation Helper Functions

Create utility functions to retrieve translated content:

```python
def get_translated_field(
    entity: Any,
    field_name: str,
    language: str,
    fallback_value: Optional[str] = None
) -> str:
    """
    Get translated field value, fallback to Chinese or provided value.
    
    Args:
        entity: Entity with translations JSONB (e.g., AppointmentType)
        field_name: Field name to translate (e.g., "name", "description")
        language: Target language code (e.g., "en")
        fallback_value: Fallback value if translation not found (defaults to Chinese field)
    
    Returns:
        Translated value or fallback
    """
    if language == "zh-TW":
        return getattr(entity, field_name) or fallback_value or ""
    
    translations = entity.translations or {}
    lang_translations = translations.get(language, {})
    translated_value = lang_translations.get(field_name)
    
    if translated_value:
        return translated_value
    
    # Fallback to Chinese
    return getattr(entity, field_name) or fallback_value or ""
```

## UI Design

### Clinic Settings UI

#### Translation Icon Pattern
For each translatable field, add a small translation icon (🌐 or language icon) next to the field label or input.

**Example: Service Item Name Field**
```
服務項目名稱 [Chinese input field] [🌐]
                                    ↑
                            Click to open translation panel
```

#### Translation Panel
When icon is clicked, show a slide-out panel or modal:

```
┌─────────────────────────────────────┐
│ 服務項目名稱 - 翻譯設定              │
├─────────────────────────────────────┤
│ 中文 (繁體)                          │
│ [Massage Therapy            ]       │
│                                     │
│ English                            │
│ [Massage Therapy            ] [自動翻譯]│
│                                     │
│ [儲存變更] [取消]                   │
└─────────────────────────────────────┘
```

**Features:**
- Shows Chinese field at top (read-only or editable, depending on context)
- Shows English field below with "自動翻譯" button
- Auto-translate button populates English field from Chinese (frontend only)
- User can edit English field
- "儲存變更" saves both Chinese and English to backend
- "取消" discards all changes

#### Message Template Translation
For message templates (confirmation, reminder), show translation UI similar to above, but:
- Template placeholders stay in Chinese (e.g., `{診所地址}`) - clinic-facing only
- Preview shows English values for placeholders
- Warning if placeholder data not translated (e.g., clinic address not translated)

**Example:**
```
患者確認訊息 - 翻譯設定
┌─────────────────────────────────────┐
│ 中文 (繁體)                          │
│ {病患姓名}，已為您預約【{服務項目}】 │
│ 於【{預約時間}】...                  │
│                                     │
│ English                            │
│ {病患姓名}, your appointment for    │
│ 【{服務項目}】is scheduled for      │
│ 【{預約時間}】...                   │
│ [自動翻譯]                          │
│                                     │
│ ⚠️ 警告: {診所地址} 尚未設定英文翻譯 │
│                                     │
│ [預覽訊息]                          │
│ ┌─────────────────────────────────┐ │
│ │ John, your appointment for       │ │
│ │ 【Massage Therapy】is scheduled │ │
│ │ for 【12/25 (Wed) 2:00 PM】... │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [儲存變更] [取消]                   │
└─────────────────────────────────────┘
```

### Receipt Language Switcher

#### LIFF Side (Patient View)
- Small language toggle button near receipt header
- Default: Patient's preferred language
- Button: "中文" / "English" toggle

#### Clinic Side (Admin View)
- Small language toggle button near receipt header
- Default: Chinese (always)
- Button: "中文" / "English" toggle

**Implementation:**
- Receipt template accepts `language` parameter
- Backend generates receipt HTML with selected language
- Frontend toggles language via query parameter or state

## Translation API Integration

### Auto-Translation Service

**Recommendation: Use browser's built-in translation or a lightweight library**

**Option 1: Backend Proxy with Google Translate API** (Recommended for Production)
- Pros: High quality, secure API key storage, can cache translations, supports placeholders
- Cons: Requires API key, costs money, needs backend endpoint
- Implementation: Backend endpoint `/api/translate` that proxies to Google Translate API

**Option 2: Frontend Translation Library (e.g., `@vitalets/google-translate-api`)**
- Pros: Free, client-side, no backend needed, good for MVP
- Cons: May violate ToS, rate limits, quality varies, API key exposed if using official library
- Use for: MVP/development, fallback when backend API unavailable

**Option 3: Hybrid Approach** (Recommended for MVP)
- Use frontend library for initial auto-translate (user confirmation required)
- Allow manual editing
- Migrate to backend proxy for production (better security, caching, quality)

**Recommendation**: Start with Option 2 for MVP, migrate to Option 1 for production.

**For Message Templates with Placeholders:**
- Translate template text, preserve placeholders: `{診所地址}` → `{診所地址}` (unchanged)
- Translate placeholder values separately when rendering
- Example: Template "地址: {診所地址}" → "Address: {診所地址}"
- When rendering: Replace `{診所地址}` with translated address value

**Placeholder Preservation Function:**
```python
def translate_template_with_placeholders(
    template: str,
    target_language: str
) -> str:
    """
    Translate message template while preserving placeholders.
    
    Example:
    Input: "您的預約已確認：{預約時間} 在 {診所名稱}"
    Output: "Your appointment is confirmed: {預約時間} at {診所名稱}"
    """
    import re
    # Extract all placeholders
    placeholders = re.findall(r'\{[^}]+\}', template)
    
    # Replace placeholders with temporary markers
    temp_template = template
    placeholder_map = {}
    for i, placeholder in enumerate(placeholders):
        marker = f"__PLACEHOLDER_{i}__"
        placeholder_map[marker] = placeholder
        temp_template = temp_template.replace(placeholder, marker, 1)
    
    # Translate template text
    translated = translate_text(temp_template, target_language)
    
    # Restore placeholders
    for marker, placeholder in placeholder_map.items():
        translated = translated.replace(marker, placeholder)
    
    return translated
```

### Translation Workflow

1. User fills Chinese field
2. User clicks translation icon
3. User clicks "自動翻譯" button
4. Frontend calls translation API (or library)
5. English field populated (not saved yet)
6. User reviews/edits English field
7. User clicks "儲存變更"
8. Backend saves both Chinese and English

## Backend Implementation

### Message Rendering

#### Update MessageTemplateService

```python
def build_confirmation_context(
    appointment: Appointment,
    patient: Patient,
    practitioner_name: str,
    clinic: Clinic,
    language: str = "zh-TW"  # Add language parameter
) -> Dict[str, Any]:
    """Build context with translated values."""
    # Get patient's preferred language
    if language == "en":
        # Use translated values
        appointment_type_name = get_translated_field(
            appointment.appointment_type, "name", "en"
        ) if appointment.appointment_type else "Appointment"
        
        clinic_name = get_translated_clinic_field(
            clinic, "display_name", "en"
        )
        clinic_address = get_translated_clinic_field(
            clinic, "address", "en"
        )
        # ... etc
    else:
        # Use Chinese (existing logic)
        ...
    
    # Format datetime with translated weekday
    formatted_datetime = format_datetime(
        start_datetime, 
        language=language
    )
    
    return {
        "病患姓名": patient.full_name,  # Keep Chinese keys for placeholders
        "服務項目": appointment_type_name,
        "預約時間": formatted_datetime,
        # ... etc
    }
```

#### Update LINE Message Sending

```python
def send_appointment_confirmation(
    appointment: Appointment,
    patient: Patient,
    language: Optional[str] = None
):
    """Send confirmation with patient's preferred language."""
    # Get patient's preferred language
    if language is None:
        language = patient.line_user.preferred_language or "zh-TW"
    
    # Get message template (translated if available)
    template = get_translated_field(
        appointment.appointment_type,
        "patient_confirmation_message",
        language,
        fallback_value=appointment.appointment_type.patient_confirmation_message
    )
    
    # Build context with translated values
    context = MessageTemplateService.build_confirmation_context(
        appointment, patient, practitioner_name, clinic, language=language
    )
    
    # Render message
    message = MessageTemplateService.render_message(template, context)
    
    # Send via LINE
    line_service.send_text_message(...)
```

### Receipt Generation

#### Update Receipt Template

Add language parameter to receipt template rendering:

```python
def generate_receipt_html(
    receipt_data: Dict[str, Any],
    void_info: Optional[Dict[str, Any]] = None,
    language: str = "zh-TW"
) -> str:
    """Generate receipt HTML with selected language."""
    # Translate receipt data
    translated_data = translate_receipt_data(receipt_data, language)
    
    # Load appropriate template (or use same template with language context)
    template = self.env.get_template('receipts/receipt.html')
    html_content = template.render(
        receipt_data=translated_data,
        void_info=void_info,
        language=language
    )
    return html_content
```

#### Receipt Template Updates

Update `receipt.html` to use language-aware labels:

```html
<div class="transaction-title">
  {% if language == 'en' %}Receipt{% else %}收據{% endif %}
</div>
<div class="transaction-info">
  <div>
    {% if language == 'en' %}Receipt Number{% else %}收據編號{% endif %}: 
    {{ receipt_data.receipt_number }}
  </div>
  <!-- etc -->
</div>
```

### Clinic Context for AI

Update `_build_clinic_context` in `clinic_agent/service.py`:

```python
def _build_clinic_context(
    clinic: Clinic, 
    chat_settings_override: Optional[ChatSettings] = None,
    include_translations: bool = False,  # New parameter
    translations: Optional[Dict[str, Any]] = None  # Pre-fetched translations
) -> str:
    """
    Build clinic context, optionally including translations.
    
    If translations are provided, use them. Otherwise, fetch if include_translations=True.
    Pre-fetching is recommended to avoid async database queries.
    """
    # ... existing code ...
    
    if include_translations:
        # Use pre-fetched translations or fetch if not provided
        if translations is None:
            # Fetch translations (requires db session - consider pre-fetching)
            translations = get_clinic_translations(clinic, "en")
        
        # Include English translations if available
        if clinic.address:
            address_zh = clinic.address
            address_en = translations.get("address") if translations else None
            if address_en and address_en != address_zh:
                xml_parts.append(f"  <地址_英文>{address_en}</地址_英文>")
        
        # Include service item translations
        if translations and "appointment_types" in translations:
            for type_translation in translations["appointment_types"]:
                xml_parts.append(f"  <服務項目_英文>")
                xml_parts.append(f"    <名稱>{type_translation.get('name')}</名稱>")
                xml_parts.append(f"  </服務項目_英文>")
    
    # ... rest of code ...
```

**Note:** Chat settings fields are NOT translated (AI-facing only). Only clinic info (address, phone, display_name) and service item names may include translations for AI context.

**Pre-fetching in process_message:**
```python
async def process_message(...):
    # Pre-fetch translations if patient language is not Chinese
    translations = None
    if patient_language != "zh-TW":
        translations = await fetch_clinic_translations(clinic, patient_language)
    
    # Build context with translations
    clinic_context = _build_clinic_context(
        clinic,
        include_translations=True,
        translations=translations
    )
```

## Frontend Implementation

### Translation UI Components

#### TranslationIcon Component
```typescript
interface TranslationIconProps {
  fieldName: string;
  chineseValue: string;
  translations: Record<string, Record<string, string>>;
  onSave: (translations: Record<string, string>) => Promise<void>;
  enabledLanguages: string[];
  entityType: 'appointment_type' | 'clinic_info' | 'service_type_group' | 'message_template';
  entityId: number;
}
```

#### TranslationPanel Component
- Slide-out panel or modal
- Shows Chinese field (read-only or editable)
- Shows translation fields for each enabled language
- Auto-translate button (per language)
- Preview for message templates
- Validation warnings for missing translations
- Save/Cancel buttons

### Translation Service

```typescript
class TranslationService {
  async autoTranslate(
    text: string,
    fromLang: string,
    toLang: string
  ): Promise<string> {
    // Option 1: Call backend proxy (recommended for production)
    // const response = await api.post('/api/translate', {
    //   text, source_language: fromLang, target_language: toLang
    // });
    // return response.data.translated_text;
    
    // Option 2: Use frontend library (for MVP)
    // Use @vitalets/google-translate-api or similar
    // Handle placeholders: preserve {診所地址} etc.
  }
  
  preservePlaceholders(
    template: string,
    translated: string
  ): string {
    // Extract placeholders, replace with markers, translate, restore
    const placeholderRegex = /\{[^}]+\}/g;
    const placeholders = template.match(placeholderRegex) || [];
    let result = translated;
    
    // Ensure all placeholders are preserved
    placeholders.forEach(placeholder => {
      if (!result.includes(placeholder)) {
        // Placeholder was lost in translation, restore it
        // Try to find similar position or append
        result = result.replace(/\{[^}]+\}/, placeholder);
      }
    });
    
    return result;
  }
}
```

### API Endpoints

#### Translation Management
```typescript
// GET /api/clinic/translations
// Query: entity_type, entity_id, field_name, language_code
// Returns: { translations: { [language_code]: string } }

// POST /api/clinic/translations
// Body: {
//   entity_type: string,
//   entity_id: number,
//   field_name: string,
//   language_code: string,
//   translated_value: string
// }

// DELETE /api/clinic/translations
// Query: entity_type, entity_id, field_name, language_code

// POST /api/clinic/translations/bulk
// Body: {
//   translations: [
//     { entity_type, entity_id, field_name, language_code, translated_value },
//     ...
//   ]
// }

// POST /api/translate (Backend proxy for translation API)
// Body: {
//   text: string,
//   source_language: string,
//   target_language: string
// }
// Returns: { translated_text: string }
```

### Receipt Language Switcher

```typescript
const ReceiptLanguageSwitcher: FC<{
  defaultLanguage: string;
  onLanguageChange: (lang: string) => void;
}> = ({ defaultLanguage, onLanguageChange }) => {
  // Toggle button: 中文 / English
  // Updates receipt view via query param or state
};
```

## Date/Time Formatting Consistency

### Update format_datetime for Messages

Ensure LINE messages use same date/time formatting as LIFF:

```python
def format_datetime(
    dt: datetime,
    language: str = "zh-TW"
) -> str:
    """Format datetime with translated weekday."""
    if language == "en":
        # Use English weekday: "12/25 (Wed) 2:00 PM"
        weekday_names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    else:
        # Use Chinese weekday: "12/25 (三) 2:00 PM"
        weekday_names = ["日", "一", "二", "三", "四", "五", "六"]
    
    weekday = weekday_names[dt.weekday()]
    # Format: "12/25 (Wed) 2:00 PM"
    return f"{dt.month}/{dt.day} ({weekday}) {dt.strftime('%I:%M %p')}"
```

## Edge Cases & Questions

### Q1: What if clinic enables English but doesn't translate all fields?
**A:** Fallback to Chinese for missing translations. Show mixed language (better than nothing).

### Q2: How to handle message template placeholders in translation?
**A:** 
- Preserve placeholders in template: `{診所地址}` stays as `{診所地址}`
- Translate placeholder values when rendering message
- Show warning in UI if placeholder data not translated

### Q3: What if patient's preferred language changes mid-session?
**A:** 
- Language preference is per-patient, stored in database
- Messages sent use patient's current preference
- LIFF UI updates immediately when language changed

### Q4: Should we translate practitioner names?
**A:** No. Practitioner names are proper nouns, not translated.

### Q5: How to handle receipt language vs patient preferred language?
**A:** 
- Receipt has separate language selector
- Default: Patient's preferred language (LIFF) or Chinese (clinic)
- User can override per-receipt view

### Q6: What about future languages (Japanese, etc.)?
**A:** 
- Design supports multiple languages via `enabled_languages` array
- Translation UI dynamically shows fields for each enabled language
- Backend translation helpers support any language code

### Q7: How to validate translation completeness?
**A:** 
- Show warnings in UI: "⚠️ English translation missing for: 服務項目名稱"
- Don't block saving (optional feature)
- Clinic can choose to translate or not

### Q8: Should we cache translations?
**A:** 
- Frontend: Cache translation API responses (avoid duplicate calls)
- Backend: No special caching needed (database queries are fast)

### Q9: How to handle translation updates?
**A:** 
- Translations are versioned with entity (same update flow)
- When clinic updates Chinese field, English translation remains (user can update separately)
- Consider "re-translate" button to update English from new Chinese

### Q10: What about bulk translation?
**A:** 
- Future enhancement: "Translate All" button in service items page
- For now, per-field translation is sufficient

### Q11: How to handle special characters in translations?
**A:** 
- Support Unicode (already handled by JSONB)
- No special encoding needed

### Q12: Should we track translation quality/status?
**A:** 
- Optional: Add `translation_status` field: "auto", "manual", "missing"
- For now, simple missing/available is sufficient

### Q13: How to handle availability notification messages?
**A:** 
- Currently hardcoded in `AvailabilityNotificationService._format_notification_message`
- Update to use patient's preferred language
- Translate appointment type name and format date with translated weekday
- Can add translation support for notification template in future

### Q14: How to handle follow-up messages?
**A:** 
- Follow-up messages are patient-facing, need translation
- Add translation support for `FollowUpMessage.message` field
- Same pattern as other message templates
- Store in `appointment_type.translations["en"]["follow_up_messages"]` or separate structure

### Q15: How to handle service type group translations?
**A:** 
- Service type groups are shown to patients in LIFF, need translation
- Add `translations` JSONB column to `service_type_groups` table
- Translate `name` field
- When displaying groups in LIFF, use translated name if available

### Q16: How to handle payment method labels in receipts?
**A:** 
- Payment methods are system-defined (cash, card, transfer, other)
- Add translation mapping in receipt service:
```python
PAYMENT_METHOD_TRANSLATIONS = {
    'zh-TW': {'cash': '現金', 'card': '信用卡', 'transfer': '轉帳', 'other': '其他'},
    'en': {'cash': 'Cash', 'card': 'Credit Card', 'transfer': 'Transfer', 'other': 'Other'}
}
```
- Use in receipt template rendering

### Q17: How to handle receipt static text translation?
**A:** 
- Receipt static text (收據, 收據編號, etc.) can be:
  - System constants (recommended for common labels)
  - Clinic-specific translations (if clinic wants custom labels)
- For system constants, create translation mapping in receipt service
- For clinic-specific, store in `receipt_settings.translations`

### Q18: How to efficiently include translations in AI context?
**A:** 
- Pre-fetch translations in `process_message` before calling `_build_clinic_context`
- Pass translations as parameter to avoid async database queries in context building
- Alternative: Include note in context that translations exist, let AI request if needed (simpler but less efficient)

## Migration Strategy

### Phase 1: Database Schema
1. Add `translations` JSONB columns
2. Add `enabled_languages` to clinic settings
3. Default: All existing data has empty translations (Chinese-only)

### Phase 2: Backend Translation Helpers
1. Implement `get_translated_field()` utilities
2. Update message rendering to use translations
3. Update receipt generation to support language parameter

### Phase 3: Frontend Translation UI
1. Add translation icon component
2. Add translation panel component
3. Integrate into service items, clinic settings pages

### Phase 4: Auto-Translation
1. Integrate translation API/library (frontend for MVP)
2. Add backend proxy endpoint for production
3. Add auto-translate button
4. Handle placeholder preservation

### Phase 5: Receipt Language Switcher
1. Add language parameter to receipt endpoints
2. Update receipt template with static text translations
3. Add payment method translation mapping
4. Add language switcher UI

### Phase 6: Additional Features
1. Service type group translation
2. Availability notification translation
3. Follow-up message translation
4. Translation validation and warnings

### Phase 7: Testing & Polish
1. Test with mixed translations (some fields translated, some not)
2. Test fallback behavior
3. Test message template rendering
4. Test receipt generation
5. Test AI context with translations
6. Test all notification types with translations

## Testing Considerations

### Unit Tests
- Translation helper functions
- Message template rendering with translations
- Receipt generation with different languages
- Fallback behavior

### Integration Tests
- LINE message sending with English preference
- Receipt viewing with language switcher
- Translation UI save/load flow

### Edge Case Tests
- Missing translations (fallback to Chinese)
- Mixed translations (some fields translated)
- Message templates with untranslated placeholders
- Receipt with untranslated service items

## Performance Considerations

### Database
- JSONB columns are efficient for translation storage
- GIN indexes support fast queries
- No significant performance impact

### Frontend
- Translation API calls should be debounced
- Cache translation results
- Lazy load translation panels

### Backend
- Translation lookups are fast (direct JSONB access)
- No additional database queries needed

## Security Considerations

### Translation Content
- Translations are user-generated content
- Sanitize HTML in translations (if supported in future)
- Validate translation JSON structure

### API Keys
- If using translation API, store keys securely
- Use environment variables
- Don't expose keys to frontend

## Future Enhancements

1. **Bulk Translation**: "Translate All" button for service items
2. **Translation Status Dashboard**: Show translation completeness
3. **Translation History**: Track translation changes
4. **More Languages**: Japanese, Korean, etc.
5. **Per-Clinic Language Selection**: Clinic chooses which languages to enable
6. **Translation Quality Indicators**: Mark translations as "needs review"
7. **AI-Powered Translation Suggestions**: Better auto-translation quality

## Translation Validation

### Missing Translation Warnings

```python
def validate_template_completeness(
    appointment_type: AppointmentType,
    language: str,
    clinic: Clinic,
    db: Session
) -> List[str]:
    """
    Validate that all required translations exist.
    
    Returns list of warnings for missing translations.
    """
    warnings = []
    
    if language != "zh-TW":
        # Check service item name
        if not get_translated_field(appointment_type, "name", language):
            warnings.append(f"Service item name not translated to {language}")
        
        # Check message templates
        if not get_translated_field(
            appointment_type, "patient_confirmation_message", language
        ):
            warnings.append(f"Patient confirmation message not translated to {language}")
        
        # Check clinic info if used in template
        template = appointment_type.patient_confirmation_message
        if "{診所地址}" in template:
            clinic_address = get_translated_clinic_field(clinic, "address", language)
            if not clinic_address:
                warnings.append(f"Clinic address not translated to {language}")
    
    return warnings
```

### UI Warnings

```typescript
// Show warnings in message template editor
{missingTranslations.length > 0 && (
  <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
    <div className="font-semibold text-yellow-800">⚠️ Missing Translations</div>
    <ul className="list-disc list-inside text-sm text-yellow-700 mt-2">
      {missingTranslations.map((warning, i) => (
        <li key={i}>{warning}</li>
      ))}
    </ul>
  </div>
)}
```

## Summary

This design provides comprehensive multi-language support while maintaining simplicity and optionality. Key features:

- **Optional**: Pure-Chinese clinics unaffected
- **Un-intrusive**: Small icons, per-field translation
- **Extensible**: Supports multiple languages, per-clinic configuration
- **Fallback**: Always falls back to Chinese
- **Patient-Focused**: Only patient-facing content translated
- **Auto-Translation**: Frontend-based with user confirmation, backend proxy for production
- **Template Support**: Handles message templates with placeholders (preserved during translation)
- **Receipt Support**: Language switcher for receipts with static text translation
- **Comprehensive**: Covers all patient-facing content (messages, receipts, service items, clinic info)
- **Validation**: Warnings for missing translations without blocking saves
- **AI Context**: Includes translations when available for better AI responses

The design balances feature richness with maintainability and user experience, incorporating best practices from multiple design approaches.

