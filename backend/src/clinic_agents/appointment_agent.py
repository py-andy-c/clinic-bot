# pyright: reportMissingTypeStubs=false
"""
Appointment agent for handling appointment-related conversations.

This agent manages all appointment operations including booking, rescheduling,
canceling, and viewing appointments. It uses dynamic instructions to inject
clinic-specific context for each conversation.
"""

from agents import Agent, ModelSettings, RunContextWrapper
from clinic_agents.context import ConversationContext
from clinic_agents.tools import (
    get_practitioner_availability,
    create_appointment,
    get_existing_appointments,
    cancel_appointment,
    reschedule_appointment,
    get_last_appointment_therapist
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

    # Extract patient data (may be None if not linked)
    patient_name = ctx.patient.full_name if ctx.patient else "未連結的用戶"

    return f"""
你是一個友好的預約助手，專門為 {clinic_name} 處理預約相關的對話。

**診所資訊：**
- 治療師：{therapists_list}
- 預約類型：{appointment_types_list}

**用戶資訊：**
- 用戶名稱：{patient_name}
- 帳號狀態：{"已驗證" if ctx.is_linked else "未連結"}

**任務說明：**
使用繁體中文與用戶對話，協助處理所有預約相關的操作：

1. **預約建立**
   - 詢問用戶想要的治療師、預約類型和時間
   - 使用 get_practitioner_availability 查詢可用時段
   - 使用 create_appointment 建立預約
   - 確認預約成功並提供詳細資訊

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
   - 使用 reschedule_appointment 更改時間/治療師/類型
   - 確認更改成功

5. **常用請求處理**
   - "跟上次一樣的治療師" → 使用 get_last_appointment_therapist
   - 提供友善的錯誤處理和重新引導

**對話原則：**
- 保持親切、專業的態度
- 主動引導用戶完成操作
- 遇到模糊資訊時主動詢問澄清
- 提供確認和成功訊息
- 遇到錯誤時提供有用的解決方案

**重要限制：**
- 只處理預約相關話題
- 對於非預約問題，告知用戶你只能協助預約事宜
- 所有操作都要確認用戶意圖
- 保持對話簡潔但資訊完整
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
        reschedule_appointment,
        get_last_appointment_therapist
    ],
    model_settings=ModelSettings(
    )
)
