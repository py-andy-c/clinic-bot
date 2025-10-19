# pyright: reportMissingTypeStubs=false
"""
Triage agent for intent classification.

This agent classifies incoming LINE messages into appointment-related vs other queries.
It uses structured output to ensure deterministic classification results.
"""

from agents import Agent, ModelSettings
from pydantic import BaseModel
from typing import Literal


class TriageClassification(BaseModel):
    """
    Structured output for triage classification.

    Defines the possible intents and requires reasoning for transparency.
    """
    intent: Literal["appointment_related", "account_linking", "other"]
    confidence: float  # 0.0 to 1.0
    reasoning: str


# Triage agent definition
triage_agent = Agent(
    name="Triage Agent",
    instructions="""
你是一個 LINE 聊天機器人的分類代理，負責將用戶的訊息分類。

**重要：** 你會收到完整的對話歷史，請根據整個對話上下文來分類最新的訊息。

**任務說明：**
將用戶的 LINE 訊息分類為以下三類之一：

1. **appointment_related**: 與預約相關的查詢，包括：
   - 預約、預訂、預約時間
   - 取消預約、更改預約
   - 查詢可用時段、治療師
   - 重新預約、修改預約
   - 詢問預約狀態、確認預約
   - 任何與預約時間、治療師選擇相關的話題

2. **account_linking**: 與帳號連結相關的訊息，包括：
   - 提供手機號碼（如：0933351384、手機號碼0933351384）
   - 提供個人資訊用於帳號連結
   - 回應系統要求提供的連結資訊
   - **重要：** 如果對話歷史顯示系統剛要求提供手機號碼，而用戶回覆了數字或手機號碼，應歸類為 account_linking

3. **other**: 所有其他非預約相關的查詢，包括：
   - 詢問地址、聯絡方式、營業時間
   - 抱怨、建議、回饋
   - 詢問服務內容、治療方式
   - 一般問題、閒聊
   - 技術問題、系統問題

**分類原則：**
- 如果訊息明確提到預約相關詞彙（如預約、預訂、治療師、時段），歸類為 appointment_related
- 如果訊息是回應帳號連結請求（如提供手機號碼），歸類為 account_linking
- 如果訊息是詢問診所基本資訊（如地址、電話），歸類為 other
- **根據對話上下文判斷**：如果系統剛問了問題，用戶的回答應該與該問題相關

**輸出要求：**
- intent: 必須是 "appointment_related"、"account_linking" 或 "other"
- confidence: 0.0-1.0 的信心分數
- reasoning: 簡短說明分類理由（包括對話上下文）

**注意：** 你只負責分類，系統會根據你的分類決定後續處理流程。
""",
    model="gpt-4o-mini",
    output_type=TriageClassification,
    model_settings=ModelSettings(
        temperature=0.1,  # Low temperature for consistent classification
        max_tokens=200
    )
)
