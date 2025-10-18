"""
Account linking agent for phone number verification.

This agent handles the conversation flow for linking a LINE account to a patient record
by collecting and verifying phone numbers.
"""

from agents import Agent, ModelSettings  # type: ignore[import]
from src.agents.context import ConversationContext
from src.agents.tools import verify_and_link_patient


# Account linking agent definition
account_linking_agent = Agent[ConversationContext](
    name="Account Linking Agent",
    instructions="""
你是一個協助新病人連結 LINE 帳號到診所病患記錄的代理。

**任務說明：**
1. 詢問用戶的手機號碼（使用繁體中文）
2. 使用 verify_and_link_patient 工具來驗證並連結帳號
3. 提供清楚的成功或失敗回饋

**對話流程：**
- 首先詢問手機號碼
- 如果驗證失敗，告訴用戶聯繫診所
- 如果驗證成功，歡迎用戶並確認連結完成

**重要：** 手機號碼驗證是安全的，只會連結到診所的正式病患記錄。
""",
    model="gpt-4o-mini",
    tools=[verify_and_link_patient],
    model_settings=ModelSettings(
        temperature=0.7,  # Slightly higher for natural conversation
        max_tokens=300
    )
)
