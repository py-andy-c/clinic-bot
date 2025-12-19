# AI Chatbot - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for the AI-powered chatbot that handles patient inquiries via LINE messaging. The chatbot uses OpenAI Agent SDK to generate contextual responses based on clinic-specific information and conversation history.

---

## Key Business Logic

### 1. Chatbot Purpose & Modes

**Core Mission**: The chatbot serves two primary functions:
1. **Clinic Receptionist Mode**: Answer factual questions about the clinic (hours, services, location, etc.)
2. **Health Consultation Mode**: Provide general wellness information and preliminary guidance

**Dual Response Modes**: The chatbot automatically determines which mode to use based on user intent:
- **Clinic Information Mode**: For questions about clinic details, services, booking policies
- **Health Consultation Mode**: For health-related questions and symptom inquiries

**Rationale**: Separates factual clinic information from health advice, allowing different safety boundaries for each.

### 2. Safety & Boundary Rules

**Non-Overridable Core Principles** (cannot be changed by clinic settings):
- **NEVER Diagnose**: Cannot make specific medical diagnoses. Must use descriptive phrases instead (e.g., "膝蓋前側的肌腱問題" not "髕腱炎")
- **NEVER Prescribe**: Cannot recommend specific named exercises or create treatment plans
- **Strict Privacy**: Has NO ACCESS to patient records. Must state this limitation if asked
- **Always Include Disclaimer**: Every health advice response MUST end with a clear disclaimer
- **Cannot Book Appointments**: Cannot access, view, check availability for, book, cancel, or modify appointments. Must direct users to LINE menu

**Rationale**: Ensures patient safety and legal compliance while maintaining helpfulness.

### 3. Conversation History Management

**Session-Based**: Each LINE user has a separate conversation session per clinic (format: `{clinic_id}-{line_user_id}`)

**History Trimming Strategy**:
- **Preferred Window**: Keep messages from last 24 hours (`CHAT_MAX_HISTORY_HOURS`)
- **Minimum Guarantee**: Keep at least 0 messages even if older (`CHAT_MIN_HISTORY_MESSAGES`)
- **Upper Bound**: Never keep more than 35 messages (`CHAT_MAX_HISTORY_MESSAGES`)
- **Hard Cutoff**: Delete messages older than 7 days (`CHAT_SESSION_EXPIRY_HOURS`)

**Test Mode**: Test sessions use prefix `test-{clinic_id}-{user_id}` and expire after 12 hours

**Rationale**: Balances context retention with token usage and privacy (older conversations are less relevant).

### 4. Clinic Context Integration

**Clinic-Specific Information**: Each clinic can configure detailed information that the AI uses:
- Basic info: Name, address, phone, appointment type instructions
- Chat settings: Clinic description, therapist info, treatment details, service item selection guide, operating hours, location details, booking policy, payment methods, equipment/facilities, common questions, other info
- **AI Guidance**: Optional custom instructions that can override default persona and formatting (but NOT safety rules)

**Context Format**: Clinic information is formatted in XML and embedded in the system prompt

**Knowledge Priority**: Clinic-provided information takes priority over general AI knowledge. If information is not in clinic context, AI must say "抱歉，我沒有這方面的資訊。"

**Rationale**: Ensures accuracy and prevents hallucination of clinic-specific details.

### 5. Test Mode

**Purpose**: Allows clinic admins to test chatbot responses with unsaved settings before publishing

**Session ID Format**: `test-{clinic_id}-{user_id}`

**Settings Override**: Test mode can use `chat_settings_override` to test unsaved chat settings without affecting production

**Cleanup**: Test sessions are automatically cleaned up after 1 hour (configurable via `max_age_hours`)

**Rationale**: Enables safe testing of chatbot configuration changes before going live.

### 6. Message Quoting Support

**Quote Handling**: When users quote previous messages, the AI receives:
- Quoted message text (if available)
- Sender information (user vs. bot) to understand context
- User's new message

**Fallback**: If quote retrieval fails, AI is informed that user attempted to quote but content is unavailable

**Rationale**: Improves context understanding when users reference previous conversation.

---

## Edge Cases

### 1. AI Opt-Out

**Scenario**: User sends "人工回覆" to disable AI replies

**Behavior**: AI replies are disabled for 24 hours (`AI_OPT_OUT_DURATION_HOURS`). User can re-enable with "重啟AI"

**Rationale**: Gives users control over AI interaction while maintaining clinic support.

### 2. Chat Settings Not Configured

**Scenario**: Clinic has not configured chat settings

**Behavior**: Uses default settings. Chat may be disabled (`chat_enabled: false`), in which case AI does not respond

**Rationale**: Prevents AI from responding with incomplete information.

### 3. Conversation History Trimming Failure

**Scenario**: History trimming fails due to database issues

**Behavior**: Falls back to keeping all items rather than losing everything. Logs error but continues processing

**Rationale**: Better to have too much context than no context.

### 4. AI Processing Failure

**Scenario**: OpenAI API fails or agent processing errors

**Behavior**: Returns fallback error message: "抱歉，我暫時無法處理您的訊息。請稍後再試，或直接聯繫診所。"

**Rationale**: Graceful degradation ensures users always get a response.

### 5. Conflicting AI Guidance

**Scenario**: Clinic's `<AI指引>` conflicts with non-overridable safety rules

**Behavior**: Safety rules take priority. AI ignores unsafe instructions (e.g., cannot override "NEVER Diagnose" rule)

**Rationale**: Safety boundaries cannot be compromised by clinic configuration.

---

## Technical Design

### Architecture

**OpenAI Agent SDK**: Uses OpenAI Agent SDK with SQLAlchemySession for conversation persistence

**Async Database**: Requires separate async SQLAlchemy engine (different from sync engine used by rest of application)

**Agent Creation**: New agent created for each message to ensure fresh clinic context in system prompt

**Model**: Uses `gpt-5-mini` with low reasoning effort and low verbosity for cost efficiency

### Session Management

**Session ID Format**:
- Production: `{clinic_id}-{line_user_id}`
- Test: `test-{clinic_id}-{user_id}`

**Database Tables**: SDK creates `agent_sessions` and `agent_messages` tables automatically

**History Trimming**: Custom trimming logic implements priority-based filtering:
1. Hard cutoff (session_expiry_hours)
2. Preferred window (max_age_hours)
3. Minimum guarantee (min_items)
4. Upper bound (max_items)

### Clinic Context Building

**XML Format**: Clinic information formatted as XML tags for structured parsing:
```xml
<診所資訊>
  <診所名稱>...</診所名稱>
  <地址>...</地址>
  <電話>...</電話>
  ...
</診所資訊>
```

**System Prompt**: Base system prompt includes clinic context and appointment system guide. Formatted at runtime with clinic-specific information.

### Message Formatting

**Quote Support**: Messages with quotes are formatted as:
```xml
<quoted_message from="user|ai">quoted text</quoted_message>
<user_message>user's new message</user_message>
```

**Fallback**: If quote unavailable but attempted:
```xml
<quote_unavailable>用戶嘗試引用一則訊息，但無法取得該訊息的內容</quote_unavailable>
<user_message>user's message</user_message>
```

### Test Session Cleanup

**Scheduler**: Runs daily at 3 AM Taiwan time via `test_session_cleanup` scheduler

**Cleanup Logic**: Queries `agent_sessions` table for sessions with `test-` prefix older than threshold, then deletes them

**Safety**: Only deletes sessions with `test-` prefix to prevent accidental deletion of production sessions

---

## Summary

This document covers:
- Chatbot purpose and dual response modes (Clinic Receptionist vs. Health Consultation)
- Safety and boundary rules (non-diagnostic, non-prescriptive, privacy protection)
- Conversation history management (session-based, trimming strategy, test mode)
- Clinic context integration (XML format, knowledge priority, AI guidance)
- Test mode (unsaved settings testing, cleanup)
- Message quoting support
- Edge cases (opt-out, unconfigured settings, failures, conflicts)
- Technical design (OpenAI Agent SDK, async database, session management, context building, message formatting, cleanup)

All business rules are enforced at the prompt level (system prompt) and cannot be overridden by clinic settings for safety-critical rules.

