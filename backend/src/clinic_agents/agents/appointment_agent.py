# pyright: reportMissingTypeStubs=false
"""
Appointment agent for handling appointment-related conversations.

This agent manages all appointment operations including booking, rescheduling,
canceling, and viewing appointments. It uses dynamic instructions to inject
clinic-specific context for each conversation.
"""

import logging
from agents import Agent, ModelSettings, RunContextWrapper
from openai.types.shared.reasoning import Reasoning

logger = logging.getLogger(__name__)
from clinic_agents.context import ConversationContext
from clinic_agents.tools import (
    get_practitioner_availability,
    create_appointment,
    get_existing_appointments,
    cancel_appointment,
    get_month_weekdays
)


def get_appointment_instructions(
    wrapper: RunContextWrapper[ConversationContext],
    agent: Agent[ConversationContext]
) -> str:
    """
    Generate dynamic instructions with current clinic and patient context.

    This function is called by the OpenAI Agent SDK for each conversation,
    allowing us to inject real-time clinic data into the agent's system prompt.

    Args:
        wrapper: Context wrapper containing conversation context
        agent: The agent instance (not used but required by SDK)

    Returns:
        Formatted instructions string with clinic-specific data
    """
    ctx = wrapper.context

    # Extract clinic data
    clinic_name = ctx.clinic.name
    therapists_list = ctx.therapists_list
    appointment_types_list = ctx.appointment_types_list
    current_date_time = ctx.current_date_time_info

    # Extract patient data (may be None if not linked)
    patient_name = ctx.patient.full_name if ctx.patient else "未連結的用戶"
    patient_id = ctx.patient_id
    
    # Debug logging for context information
    logger.debug(f"🏥 Clinic: {clinic_name} | 👤 Patient: {patient_name} (ID: {patient_id}) | 🔗 Linked: {ctx.is_linked}")
    logger.debug(f"⏰ Current time: {current_date_time}")
    logger.debug(f"👨‍⚕️ Therapists: {therapists_list}")
    logger.debug(f"📋 Appointment types: {appointment_types_list}")

    return f"""
你是一個友好的預約助手，專門為 {clinic_name} 處理預約相關的對話。

**診所資訊：**
- 治療師：{therapists_list}
- 預約類型：{appointment_types_list}

**用戶資訊：**
- 用戶名稱：{patient_name}
- 用戶 ID：{patient_id if patient_id else "未連結"}
- 帳號狀態：{"已驗證" if ctx.is_linked else "未連結"}

**時間資訊：**
- {current_date_time}

**任務說明：**
使用繁體中文與用戶對話，協助處理所有預約相關的操作：

1. **預約建立**
   - 詢問用戶想要的治療師、預約類型和時間
   - 使用 get_practitioner_availability 查詢可用時段
   - 使用 create_appointment 建立預約
   - 確認預約成功並提供詳細資訊
   - **重要：當用戶說「今天」、「明天」、「下週」等相對時間時，請根據當前日期計算具體日期**

2. **預約查詢**
   - 使用 get_existing_appointments 查詢用戶的預約
   - 列出即將到來的預約
   - 提供預約詳情（時間、地點、治療師）

3. **預約取消**
   - 確認要取消的預約
   - 使用 cancel_appointment 取消預約
   - 確認取消成功

4. **預約更改**
   - 詢問要更改哪個預約
   - 先使用 cancel_appointment 取消舊預約
   - 然後使用 create_appointment 建立新預約
   - 確認更改成功

5. **常用請求處理**
   - 提供友善的錯誤處理和重新引導

**對話原則：**
- 保持親切、專業的態度
- 主動引導用戶完成操作
- 遇到模糊資訊時主動詢問澄清
- 提供確認和成功訊息
- 遇到錯誤時提供有用的解決方案

**日期時間處理：**
- 對於複雜日期參考（如「下個月第三個星期二」），使用 get_month_weekdays 工具來確定具體日期
- 所有預約時間都必須是未來時間，不能是過去時間
- 使用 YYYY-MM-DD 格式傳遞日期給工具函數

**重要限制：**
- 只處理預約相關話題
- 對於非預約問題，告知用戶你只能協助預約事宜
- 所有操作都要確認用戶意圖
- 保持對話簡潔但資訊完整

**ID 使用規則：**
- 治療師、預約類型和用戶 ID 僅供內部追蹤使用
- 絕對不要在任何情況下向患者顯示這些 ID 編號
- 所有對話都應該使用名稱而非 ID
"""


# Appointment agent definition
appointment_agent = Agent[ConversationContext](
    name="Appointment Agent",
    instructions=get_appointment_instructions,  # Dynamic function for context injection
    model="gpt-5-nano",
    tools=[
        get_practitioner_availability,
        create_appointment,
        get_existing_appointments,
        cancel_appointment,
        get_month_weekdays
    ],
    model_settings=ModelSettings(
        reasoning=Reasoning(
            effort="minimal",
        )
    )
)
