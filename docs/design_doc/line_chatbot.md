# LINE Chatbot Design Document

## Overview

This document describes the design for a simple chatbot that helps clinics respond to patient messages received via LINE. The chatbot uses the LINE Messaging API to receive and send messages, and the OpenAI Agent SDK to generate AI-powered responses.

## Objectives

- **MVP Goal**: Create a simple chatbot that can respond to patient inquiries via LINE messages
- **Architecture**: Keep it simple and extensible for future enhancements
- **Integration**: Leverage existing LINE SDK and OpenAI Agent SDK already in the codebase

## Architecture

### Flow Diagram

```
Patient → LINE Platform → Webhook Endpoint → AI Agent → Response → LINE Platform → Patient
```

### Components

1. **LINE Webhook Endpoint** (`/api/line/webhook`)
   - Receives POST requests from LINE when patients send messages
   - Verifies webhook signature for security
   - Extracts message content and LINE user ID
   - Identifies the clinic based on channel ID

2. **Clinic Agent Service** (`services/clinic_agent/`)
   - Manages conversation state per LINE user per clinic
   - Integrates OpenAI Agent SDK to generate responses
   - Stores and retrieves conversation history from PostgreSQL

3. **AI Agent** (using OpenAI Agent SDK)
   - Configured with clinic-specific instructions
   - Processes patient messages and generates appropriate responses
   - No tools for MVP (simple text-based responses only)

4. **LINE Service** (existing `services/line_service.py`)
   - Already handles signature verification
   - Already handles message extraction
   - Already handles sending messages

## Technical Design

### 1. Webhook Endpoint

**Location**: `backend/src/api/line_webhook.py`

**Endpoint**: `POST /api/line/webhook`

**Responsibilities**:
- Receive webhook events from LINE
- Verify signature using `LINEService.verify_signature()`
- Extract message data using `LINEService.extract_message_data()`
- Identify clinic from channel ID in webhook payload
- Route to clinic agent service
- Send response back via `LINEService.send_text_message()`

**Request Flow**:
1. LINE sends webhook with signature in `X-Line-Signature` header
2. Verify signature matches channel secret
3. Parse JSON payload to extract:
   - `events[0].source.userId` → LINE user ID
   - `events[0].message.text` → message text
   - `destination` → channel ID (to identify clinic)
4. Look up clinic by `line_channel_id`
5. Process message through clinic agent service
6. Send response back to patient

### 2. Clinic Agent Service

**Location**: `backend/src/services/clinic_agent/`

**Responsibilities**:
- Manage conversation history per LINE user per clinic
- Initialize and configure OpenAI Agent
- Process messages through agent
- Store and retrieve conversation context from PostgreSQL

**Key Methods**:
- `process_message(line_user_id: str, message: str, clinic: Clinic, engine: Engine) -> str`
  - Looks up `LineUser` by `line_user_id` (create if doesn't exist)
  - Creates or retrieves `SQLAlchemySession` with `session_id=f"{clinic.id}-{line_user_id}"`
  - Uses SDK's session to get existing conversation history
  - Runs agent with message and history using `Runner.run(agent, input, session=session)`
  - SDK automatically saves updated conversation history
  - Returns agent response

**Conversation Storage**:
- Uses OpenAI Agent SDK's `SQLAlchemySession` for session management
- SDK automatically creates and manages its own tables
- Session identified by `session_id` string (format: `f"{clinic_id}-{line_user_id}"`)
- Enables persistence across restarts and multi-turn conversations

### 3. Database Tables (Managed by OpenAI Agent SDK)

The OpenAI Agent SDK's `SQLAlchemySession` automatically creates and manages its own tables when `create_tables=True` is set. No custom Conversation model is needed.

**Tables Created by SDK**:

1. **`agent_sessions`** (or similar name):
   - `session_id`: String (primary key) - Unique session identifier
   - Stores session metadata

2. **`agent_messages`** (or similar name):
   - `id`: Primary key
   - `session_id`: String (foreign key to sessions table)
   - `message_data`: JSONB/TEXT - Stores conversation items as JSON
   - `created_at`: Timestamp - When message was added
   - Stores individual conversation items in chronological order

**Session ID Format**:
- Format: `f"{clinic_id}-{line_user_id}"`
- Example: `"1-abc123xyz"` (clinic_id=1, line_user_id="abc123xyz")
- Ensures one session per LINE user per clinic

**Design Notes**:
- SDK handles all table creation and management automatically
- No need for custom `Conversation` model
- SDK's session management provides built-in methods: `get_items()`, `add_items()`, `pop_item()`, `clear_session()`
- Conversation history is automatically persisted and retrieved by the SDK
- When processing messages, create/retrieve `SQLAlchemySession` with appropriate `session_id`

**References**:
- [OpenAI Agent SDK SQLAlchemySession Documentation](https://openai.github.io/openai-agents-python/sessions/sqlalchemy_session/)
- [SQLAlchemySession API Reference](https://openai.github.io/openai-agents-python/ref/extensions/memory/sqlalchemy_session/#agents.extensions.memory.sqlalchemy_session.SQLAlchemySession)

### 4. AI Agent Configuration

**Agent Setup** (using OpenAI Agent SDK pattern from examples):

```python
from agents import Agent, ModelSettings, Runner, RunConfig, TResponseInputItem

clinic_agent = Agent(
    name="Clinic Agent",
    instructions="""You are a helpful assistant for a physical therapy clinic.
    Your role is to:
    - Answer patient questions about the clinic
    - Provide information about services and appointment types
    - Help with general inquiries
    - Be friendly, professional, and concise
    
    Respond in Traditional Chinese (繁體中文) as this is a Taiwan-based clinic.
    Keep responses brief and conversational, suitable for LINE messaging.""",
    model="gpt-4o-mini",  # Cost-effective for MVP
    model_settings=ModelSettings(
        temperature=0.7,
        max_tokens=500,  # Keep responses concise for LINE
        store=True
    )
    # No tools for MVP - simple text-based responses only
)
```

**Agent Execution**:
- Use `Runner.run()` to process messages
- Maintain conversation history as `list[TResponseInputItem]`
- Format: `[{"role": "user", "content": [{"type": "input_text", "text": "..."}]}, ...]`

### 5. Clinic Identification

**Challenge**: LINE webhook payload includes `destination` field with channel ID, but we need to identify which clinic this belongs to.

**Solution**:
- Query `Clinic` table by `line_channel_id`
- Use clinic's `line_channel_secret` and `line_channel_access_token` for LINE service
- Each clinic has its own LINE Official Account

### 6. Error Handling

**Scenarios**:
- Invalid webhook signature → Return 401, log error
- Clinic not found → Return 404, log error
- Agent processing fails → Return generic error message to patient
- LINE API send fails → Log error, return 500 to webhook

**Fallback Response**:
- If agent fails, send: "抱歉，我暫時無法處理您的訊息。請稍後再試，或直接聯繫診所。"
- Log all errors for debugging

## Data Flow

### Message Reception

1. Patient sends message on LINE
2. LINE platform sends webhook to `/api/line/webhook`
3. Endpoint verifies signature
4. Endpoint extracts `(line_user_id, message_text, channel_id)`
5. Endpoint looks up clinic by `channel_id`
6. Endpoint calls `ClinicAgentService.process_message(line_user_id, message_text, clinic, engine)`

### Message Processing

1. Clinic agent service looks up `LineUser` by `line_user_id` string (create if doesn't exist)
2. Creates `SQLAlchemySession` with `session_id=f"{clinic.id}-{line_user_id}"`:
   ```python
   from agents.extensions.memory import SQLAlchemySession
   session = SQLAlchemySession(
       session_id=f"{clinic.id}-{line_user_id}",
       engine=engine,
       create_tables=True
   )
   ```
3. SDK automatically loads existing conversation history from database
4. Runs agent with message and session:
   ```python
   result = await Runner.run(
       clinic_agent,
       input=[{"role": "user", "content": [{"type": "input_text", "text": message}]}],
       session=session,
       run_config=RunConfig(trace_metadata={"clinic_id": clinic.id})
   )
   ```
5. SDK automatically saves updated conversation history to database
6. Extracts response text from agent result
7. Returns response text

### Message Sending

1. Endpoint receives response text from clinic agent service
2. Endpoint calls `LINEService.send_text_message(line_user_id, response_text)`
3. LINE service sends message via LINE API
4. Endpoint returns 200 OK to LINE webhook

## Implementation Details

### Dependencies

SDKs are already in `requirements.txt`:
- `openai-agents==0.3.0` ✅
- `line-bot-sdk>=3.19.0` ✅

**Additional dependency needed**:
- `openai-agents[sqlalchemy]` - For SQLAlchemySession support (or install `sqlalchemy` separately)
- `asyncpg` - PostgreSQL async driver for async SQLAlchemy (if using async engine)

### New Files

1. `backend/src/api/line_webhook.py` - Webhook endpoint
2. `backend/src/services/clinic_agent/` - Clinic agent service folder
   - `__init__.py` - Service initialization
   - `service.py` - Main clinic agent service with agent logic

### Modified Files

1. `backend/src/main.py` - Add line_webhook router

### Database Tables

**No custom tables needed!** The OpenAI Agent SDK's `SQLAlchemySession` automatically creates and manages its own tables:
- SDK creates tables when `create_tables=True` is set
- Tables are created on first use (lazy initialization)
- Tables use SDK's internal naming convention (e.g., `agent_sessions`, `agent_messages`)

**Alembic Compatibility**:
- ✅ **SDK tables work alongside Alembic** - No conflicts occur
- ✅ **SDK manages its own tables independently** - Uses its own SQLAlchemy metadata, not `Base.metadata`
- ✅ **Alembic won't track SDK tables** - This is fine and expected
- ✅ **Both can coexist in the same database** - SDK tables are created separately from Alembic-managed tables
- ℹ️ **No Alembic migration needed** - SDK handles table creation and schema changes internally
- ℹ️ **Alembic autogenerate won't detect SDK tables** - This is expected since they're not part of `Base.metadata`

**Important Notes**:
1. The SDK creates tables using its own metadata, separate from your application's `Base.metadata`
2. Alembic only tracks models registered with `Base.metadata` (your application models)
3. SDK tables are managed entirely by the SDK - you don't need to (and shouldn't) create migrations for them
4. If you need to inspect SDK tables, you can query them directly, but don't modify them via Alembic

**Async SQLAlchemy Note**: The codebase uses sync SQLAlchemy (`create_engine`), but the SDK's `SQLAlchemySession` uses async SQLAlchemy. We'll need to:
- Create an async engine for the SDK: `create_async_engine(DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://"))`
- Or use the SDK's `from_url()` method which handles engine creation internally

### Environment Variables

No new environment variables needed. Uses existing:
- `OPENAI_API_KEY` (for OpenAI Agent SDK)
- Clinic-specific LINE credentials (stored in database)

## MVP Scope

### Included

- ✅ Receive text messages from LINE
- ✅ Verify webhook signatures
- ✅ Generate AI responses using OpenAI Agent SDK
- ✅ Send responses back to patients
- ✅ Persistent conversation history (PostgreSQL)
- ✅ Multi-turn conversation context across sessions
- ✅ Clinic-specific agent configuration

### Excluded (Future Enhancements)

- ❌ Conversation history truncation/cleanup (keep all messages for MVP)
- ❌ Agent tools (no tools for MVP - simple text responses only)
- ❌ Image/media message handling
- ❌ Rich messages (buttons, carousels, etc.)
- ❌ Multi-language support beyond Traditional Chinese
- ❌ Conversation analytics
- ❌ Admin dashboard for chatbot management

## Security Considerations

1. **Webhook Signature Verification**: Always verify LINE webhook signatures before processing
2. **Clinic Isolation**: Ensure responses use correct clinic's LINE credentials
3. **Rate Limiting**: Consider adding rate limiting per LINE user to prevent abuse
4. **Error Messages**: Don't expose internal errors to patients

## Testing Strategy

1. **Unit Tests**: Test clinic agent service with mock agent responses
2. **Integration Tests**: Test webhook endpoint with mock LINE webhook payloads
3. **Manual Testing**: Use LINE test channel to send real messages

## Future Enhancements

1. **Conversation Management**: 
   - Truncate history to last N messages to prevent unbounded growth
   - Cleanup old conversations (e.g., older than 90 days)
   - Archive conversations for analytics
2. **Agent Tools**: Add tools for future features (appointment lookup, clinic hours, etc.)
3. **Rich Messages**: Use LINE rich message types (buttons, carousels)
4. **Multi-language**: Support multiple languages based on patient preference
5. **Analytics**: Track conversation metrics and common questions
6. **Admin UI**: Allow clinics to customize agent instructions

## References

- [LINE Messaging API Documentation](https://developers.line.biz/en/docs/messaging-api/)
- [OpenAI Agent SDK Documentation](https://openai.github.io/openai-agents-python/)
- Existing codebase examples: `docs/examples/agents/`
- Existing LINE service: `backend/src/services/line_service.py`

