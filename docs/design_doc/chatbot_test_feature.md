# Chatbot Test Feature - Complete Design Document

## Overview

Allow clinic users to quickly test the chatbot with their current settings before saving, so they can see how the AI will respond to patient questions.

**Goal**: Allow clinic users to quickly test their chatbot settings before saving, so they can verify the AI responses match their expectations.

**Key Feature**: One-click test interface that opens a chat-like modal where users can have a conversation with the AI using their current (unsaved) settings.

## User Goals

- Quickly verify chatbot responses match expectations
- Test different scenarios without affecting real patients
- Iterate on settings and see immediate results
- Build confidence in the chatbot configuration

## Design Principles

1. **Quick Access**: One-click access from settings page
2. **Real-time Testing**: Test with current (unsaved) settings
3. **LINE-like Interface**: Familiar messaging UI matching actual LINE experience
4. **Clear Boundaries**: Obvious that this is a test, not real patient interaction
5. **No Persistence**: Test conversations don't affect real chatbot sessions
6. **Auto-Reset on Settings Change**: Modal closes when settings edited (ensures fresh session)

---

## Core Design Decisions

### ✅ What We're Building

1. **Test Button** in ChatSettings component
   - Visible only when `chat_enabled === true`
   - Positioned after all settings fields
   - Clear call-to-action: "開啟測試視窗"

2. **Chat Modal** overlay
   - Desktop: Centered modal (~800px × 600px)
   - Mobile: Full-screen overlay
   - LINE-like interface with message bubbles
   - Real-time conversation with AI

3. **Settings Source**
   - **Use current unsaved settings** from frontend state
   - Allows iterative testing without saving
   - Users can adjust settings and retest immediately
   - Settings are only saved to database when "儲存更變" button is clicked

4. **Test Session Management**
   - Ephemeral sessions (not persisted)
   - Session ID: `"test-{clinic_id}-{user_id}"`
   - **Auto-close modal when any chat setting is edited** (forces fresh session)
   - Conversation resets when modal closes/reopens
   - "重新開始對話" button to reset mid-session

### ❌ What We're NOT Building (Phase 1)

- Saving test conversations
- Multiple test scenarios simultaneously
- Performance analytics
- Export functionality
- A/B testing different configurations

---

## UI/UX Design

### 1. Entry Point

**Location**: In `ChatSettings` component, after the "啟用 AI 聊天功能" toggle

**Visual Design**:
```
┌─────────────────────────────────────────────────────────┐
│  AI 聊天功能                                    [儲存更變] │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  [✓] 啟用 AI 聊天功能                                     │
│                                                           │
│  ┌─────────────────────────────────────────────────┐     │
│  │  診所介紹                                       │     │
│  │  [Textarea...]                                 │     │
│  └─────────────────────────────────────────────────┘     │
│                                                           │
│  [More fields...]                                         │
│                                                           │
│  ┌─────────────────────────────────────────────────┐     │
│  │  🧪 測試聊天機器人                               │     │
│  │                                                   │     │
│  │  點擊此按鈕來測試您的聊天機器人設定                │     │
│  │                                                   │     │
│  │  [ 開啟測試視窗 ]                                 │     │
│  └─────────────────────────────────────────────────┘     │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

**Design Details**:
- Light blue/gray background box (#EFF6FF)
- Icon: 🧪 or chat bubble icon
- Button: Primary style, clearly labeled
- Only visible when `chat_enabled === true`
- Positioned after all the settings fields, before the save button

### 2. Test Chat Interface

**Modal/Overlay Design**:
- Full-screen overlay on mobile, centered modal on desktop
- Modal size: ~800px wide, ~600px tall (desktop)
- Close button in top-right corner
- Clear header: "測試聊天機器人"

**Desktop Layout**:
```
┌──────────────────────────────────────────────────────────────┐
│  測試聊天機器人                                        [×]    │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│  ℹ️ 使用當前設定進行測試 | 此為測試模式，不會影響實際病患對話  │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                                                          │ │
│  │  🤖 AI                                                   │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │ 您好，我是 [診所名稱] 的AI小幫手。我可以為您提供  │  │ │
│  │  │ 診所資訊與健康相關的建議，有什麼可以幫忙的嗎？🙂  │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │                                                          │ │
│  │                                    ┌──────────────────┐  │ │
│  │                                    │ 我肩膀很痛        │  │ │
│  │                                    └──────────────────┘  │ │
│  │                                    👤 您                │ │
│  │                                                          │ │
│  │  🤖 AI                                                   │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │ 您好，肩膀疼痛是很常見的問題。為了能給您更精準的  │  │ │
│  │  │ 建議，方便請您回覆幾個問題嗎？                     │  │ │
│  │  │                                                      │  │ │
│  │  │ 1️⃣ 疼痛的確切位置在哪？                             │  │ │
│  │  │ 2️⃣ 什麼時候比較痛？                                 │  │ │
│  │  │ 3️⃣ 除了痛，還有其他感覺嗎？                          │  │ │
│  │  │                                                      │  │ │
│  │  │ ⚠️ 以上為初步建議，無法取代專業醫療評估...          │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │                                                          │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [輸入訊息...]                              [ 傳送 ]    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                                │
│  [ 重新開始對話 ]                                              │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

**Mobile Layout**:
```
┌─────────────────────────────────────┐
│  測試聊天機器人              [×]     │
├─────────────────────────────────────┤
│  ℹ️ 使用當前設定進行測試             │
│  此為測試模式，不會影響實際病患對話  │
├─────────────────────────────────────┤
│                                      │
│  🤖 AI                               │
│  ┌────────────────────────────────┐ │
│  │ 您好，我是 [診所名稱] 的AI小幫手│ │
│  │ 我可以為您提供診所資訊與健康相關│ │
│  │ 的建議，有什麼可以幫忙的嗎？🙂 │ │
│  └────────────────────────────────┘ │
│                                      │
│              ┌────────────────────┐  │
│              │ 我肩膀很痛         │  │
│              └────────────────────┘  │
│              👤 您                   │
│                                      │
│  ┌────────────────────────────────┐ │
│  │ [輸入訊息...]        [ 傳送 ]   │ │
│  └────────────────────────────────┘ │
│                                      │
│  [ 重新開始對話 ]                    │
│                                      │
└─────────────────────────────────────┘
```

**Key Features**:

1. **Message Bubbles** (LINE-like design):
   - User messages: Right-aligned, LINE green background (#00C300 or #06C755)
   - AI messages: Left-aligned, white (#FFFFFF) or light gray (#F5F5F5) background
   - Rounded corners matching LINE style
   - Timestamp (optional, subtle)
   - Typing indicator when AI is responding (LINE-style animated dots)

2. **Input Area**:
   - Text input at bottom
   - Send button (LINE green #00C300) or Enter key
   - Character limit indicator (optional)
   - Disabled while AI is responding

3. **Header Information**:
   - "使用當前設定進行測試" (Testing with current settings)
   - Warning: "此為測試模式，不會影響實際病患對話"
   - Option to "重新開始對話" (Reset conversation)

4. **Loading States**:
   - Typing indicator: "正在思考... ●●●" (LINE-style animated dots)
   - Disable input during processing

**Empty State**:
```
┌──────────────────────────────────────────────────────────────┐
│  測試聊天機器人                                        [×]    │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                                                          │ │
│  │  (Empty chat area - no example questions)               │ │
│  │                                                          │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [輸入訊息...]                              [ 傳送 ]    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

**Loading State**:
```
[Previous messages...]

              ┌────────────────────┐
              │ 我膝蓋痛怎麼辦？   │
              └────────────────────┘
              👤 您

🤖 AI
┌──────────────────────────────────────────────────────────┐
│ 正在思考... ●●●                                          │
└──────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ [輸入訊息...]                    [ 傳送 ] (disabled)   │
└────────────────────────────────────────────────────────┘
```

**Error State**:
```
[Previous messages...]

              ┌────────────────────┐
              │ 我膝蓋痛怎麼辦？   │
              └────────────────────┘
              👤 您

┌────────────────────────────────────────────────────────┐
│ ⚠️ 無法取得回應                                          │
│                                                          │
│ 抱歉，我暫時無法處理您的訊息。請稍後再試，或直接聯繫診所。│
│                                                          │
│ [ 重試 ]                                                 │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ [輸入訊息...]                              [ 傳送 ]    │
└────────────────────────────────────────────────────────┘
```

**Note**: Error message matches the actual LINE endpoint error message.

### 3. Visual Design Specifications

**Color Scheme (LINE-like)**:
- **User messages**: LINE green (#00C300 or #06C755) background, white text
- **AI messages**: White (#FFFFFF) or light gray (#F5F5F5) background, dark text
- **Test button box**: Light blue (#EFF6FF) background
- **Modal header**: White background, gray border
- **Input field**: White background, gray border
- **Send button**: LINE green (#00C300), white text
- **Close button**: Gray (#6B7280)
- **Typing indicator**: LINE-style animated dots

**Typography**:
- **Header**: 18px, semibold
- **Messages**: 14px, regular
- **Input**: 14px, regular
- **Helper text**: 12px, gray

**Spacing**:
- **Message bubbles**: 12px margin between messages
- **Modal padding**: 24px
- **Input area**: 16px padding
- **Button spacing**: 8px between buttons

---

## User Experience Flow

**Flow 1: Quick Test**
1. User configures chat settings (unsaved, in frontend state)
2. User clicks "開啟測試視窗"
3. Modal opens with empty chat
4. User types a test message (e.g., "我肩膀很痛")
5. AI responds based on current unsaved settings
6. User can continue conversation or close

**Flow 2: Iterative Testing**
1. User tests chatbot
2. Notices something to improve
3. User edits any chat setting field
4. **Test modal automatically closes** (forces fresh session)
5. User adjusts settings
6. User reopens test modal (fresh conversation with new settings)
7. Tests again with new settings

**Flow 3: Multiple Scenarios**
1. User tests one scenario
2. Clicks "重新開始對話"
3. Tests different scenario
4. Compares responses

**Complete Flow Diagram**:
```
1. User configures chat settings (unsaved, in frontend state)
   ↓
2. User clicks "開啟測試視窗"
   ↓
3. Modal opens with empty chat
   ↓
4. User types test message
   ↓
5. AI responds based on current unsaved settings
   ↓
6. User continues conversation or closes modal
   ↓
7. (Optional) User edits any chat setting → modal auto-closes
   ↓
8. User reopens modal → fresh session with new settings
   ↓
9. User clicks "儲存更變" → settings saved to database
```

---

## Technical Architecture

### Frontend Components

1. **ChatSettings.tsx** (existing)
   - Add test button section
   - Add state for test modal visibility
   - Watch for chat settings changes → auto-close modal

2. **ChatTestModal.tsx** (new)
   - Chat interface component
   - Message list rendering (LINE-like bubbles)
   - Input handling
   - API integration
   - Loading and error states

### Backend API

**New Endpoint**: `POST /api/clinic/chat/test`

```python
Request:
{
  "message": "我肩膀很痛",
  "session_id": "test-123-456"  # Optional
}

Response:
{
  "response": "您好，肩膀疼痛是很常見的問題...",
  "session_id": "test-123-456"
}
```

**Implementation Notes**:
- Use `ClinicAgentService.process_message()` with test session ID
- Pass current unsaved settings from frontend (not from database)
- Settings are only saved to database when "儲存更變" button is clicked
- No database persistence for test sessions
- Rate limiting: ~20 messages per test session
- Use same error messages as actual LINE endpoint

**Key Technical Details**:
- Use test session ID: `"test-{clinic_id}-{user_id}"`
- Use current unsaved settings from frontend state (allows iterative testing)
- Settings are only saved to database when "儲存更變" button is clicked
- No persistence - test sessions are ephemeral
- Rate limiting: Maybe 10-20 messages per test session
- Timeout: Test sessions expire after 30 minutes of inactivity

**Settings Source**:
- **Decision**: Use current unsaved settings from frontend state
- This allows users to test settings before saving
- When user edits any chat setting → test modal automatically closes
- When user reopens modal → fresh session with new settings

---

## Edge Cases & Error Handling

**Error Scenarios**:
1. **Chat disabled**: Show message "請先啟用 AI 聊天功能"
2. **API error**: Use same error message as actual LINE endpoint: "抱歉，我暫時無法處理您的訊息。請稍後再試，或直接聯繫診所。"
3. **Timeout**: Show "回應時間過長，請稍後再試"
4. **Empty message**: Disable send button
5. **Network error**: Show retry option with same error message format

**Empty State**:
- When chat is empty: Show empty chat interface with just input field
- No example questions (user starts naturally)
- Clean, minimal interface matching LINE style

---

## Mobile Considerations

**Mobile Layout**:
- Full-screen overlay (not modal)
- Bottom sheet style (slides up from bottom)
- Input field fixed at bottom
- Messages scrollable area above
- Close button in header

**Touch Interactions**:
- Swipe down to close (optional)
- Tap outside to close (with confirmation)
- Keyboard handling: Input moves up with keyboard

---

## Accessibility

- ARIA labels for all buttons
- Keyboard navigation support
- Screen reader announcements for new messages
- Focus management when modal opens/closes
- High contrast mode support
- Escape key to close modal

---

## Implementation Phases

### Phase 1: Basic Test Interface (MVP)
- [x] Test button in ChatSettings
- [x] Chat modal with basic UI
- [x] Send/receive messages
- [x] Use current unsaved settings from frontend
- [x] Basic error handling (matching actual endpoint)
- [x] Auto-close modal when settings change

### Phase 2: Enhanced Features
- [ ] LINE-like UI styling (message bubbles, colors)
- [ ] Conversation reset button
- [ ] Typing indicator (LINE-style animated dots)
- [ ] Better loading states
- [ ] Keyboard shortcuts (Enter to send)

### Phase 3: Advanced Features
- [ ] Conversation history in test
- [ ] Export test conversation
- [ ] Multiple test scenarios
- [ ] Performance metrics

---

## Files to Create/Modify

### New Files
- `frontend/src/components/ChatTestModal.tsx`
- `backend/src/api/clinic.py` (add test endpoint)

### Modified Files
- `frontend/src/components/ChatSettings.tsx` (add test button, watch for settings changes)
- `backend/src/services/clinic_agent/service.py` (maybe add test mode flag)

---

## Design Decisions Resolved

1. **Settings Source**: Use unsaved settings from frontend or saved from backend?
   - **Decision**: Use unsaved settings for iterative testing
   - Settings only saved to database when "儲存更變" button is clicked

2. **Session Clearing**: When should test session be cleared?
   - **Decision**: Auto-close modal when any chat setting is edited
   - This ensures LLM doesn't reference previous messages generated with old settings
   - User can immediately reopen to test with new settings

3. **Rate Limiting**: How many test messages per session?
   - **Decision**: 20 messages (reasonable for testing)

4. **Error Handling**: What happens if API fails?
   - **Decision**: Use same error message as actual LINE endpoint: "抱歉，我暫時無法處理您的訊息。請稍後再試，或直接聯繫診所。"
   - Allow retry option

5. **UI Design**: Should it match LINE interface?
   - **Decision**: Yes, make test experience as close to actual LINE experience as possible
   - LINE-like message bubbles, colors, and styling
   - Same error messages

6. **Mobile Experience**: Full-screen or modal?
   - **Decision**: Full-screen overlay on mobile, modal on desktop

7. **Empty State**: Show example questions?
   - **Decision**: No, show empty chat interface with just input field

---

## Alternative Designs Considered

### Option A: Inline Preview
- Show preview responses inline in settings
- **Rejected**: Too cluttered, doesn't show conversation flow

### Option B: Separate Test Page
- Dedicated test page in settings
- **Rejected**: Too many clicks, breaks workflow

### Option C: Side Panel
- Slide-out panel from right
- **Rejected**: Takes up too much space, mobile unfriendly

### **Chosen: Modal Overlay**
- ✅ Doesn't disrupt settings page
- ✅ Focused testing experience
- ✅ Easy to open/close
- ✅ Works well on mobile and desktop

---

## Success Criteria

- ✅ Users can test chatbot within 2 clicks
- ✅ Test interface loads in < 2 seconds
- ✅ AI responses appear within 5-10 seconds
- ✅ Clear visual distinction between test and real chat
- ✅ Works smoothly on mobile and desktop
- ✅ Test session completion rate > 70%
- ✅ Average messages per test session: 3-5
- ✅ Users report increased confidence in settings

---

## Future Enhancements

1. **Save Test Conversations**: Allow saving test scenarios
2. **A/B Testing**: Test multiple setting configurations
3. **Analytics**: Show response quality metrics
4. **Template Scenarios**: Pre-built test scenarios
5. **Export Results**: Download test conversation as PDF

---

## Next Steps

1. Review this design with stakeholders
2. Get approval on technical approach
3. Create detailed component specifications
4. Implement backend API endpoint
5. Implement frontend components
6. Test and iterate
