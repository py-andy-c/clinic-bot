"""
Triage agent for intent classification.

This agent classifies incoming LINE messages into appointment-related vs other queries.
It uses structured output to ensure deterministic classification results.
"""

from agents import Agent, ModelSettings  # type: ignore[import]
from pydantic import BaseModel
from typing import Literal


class TriageClassification(BaseModel):  # type: ignore[reportUntypedBaseClass]
    """
    Structured output for triage classification.

    Defines the possible intents and requires reasoning for transparency.
    """
    intent: Literal["appointment_related", "other"]
    confidence: float  # 0.0 to 1.0
    reasoning: str


# Triage agent definition
triage_agent = Agent(
    name="Triage Agent",
    instructions="""
你是一個 LINE 聊天機器人的分類代理，負責將用戶的訊息分類為預約相關或非預約相關。

**任務說明：**
將用戶的 LINE 訊息分類為以下兩類之一：

1. **appointment_related**: 與預約相關的查詢，包括：
   - 預約、預訂、預約時間
   - 取消預約、更改預約
   - 查詢可用時段、治療師
   - 重新預約、修改預約
   - 詢問預約狀態、確認預約
   - 任何與預約時間、治療師選擇相關的話題

2. **other**: 所有其他非預約相關的查詢，包括：
   - 詢問地址、聯絡方式、營業時間
   - 抱怨、建議、回饋
   - 詢問服務內容、治療方式
   - 一般問題、閒聊
   - 技術問題、系統問題

**分類原則：**
- 如果訊息明確提到預約相關詞彙（如預約、預訂、治療師、時段），歸類為 appointment_related
- 如果訊息是詢問診所基本資訊（如地址、電話），歸類為 other
- 如果不確定，優先考慮用戶意圖

**輸出要求：**
- intent: 必須是 "appointment_related" 或 "other"
- confidence: 0.0-1.0 的信心分數
- reasoning: 簡短說明分類理由

**注意：** 你只負責分類，系統會根據你的分類決定後續處理流程。
""",
    model="gpt-4o-mini",
    output_type=TriageClassification,
    model_settings=ModelSettings(
        temperature=0.1,  # Low temperature for consistent classification
        max_tokens=200
    )
)
