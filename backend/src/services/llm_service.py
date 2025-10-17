"""
LLM Service for conversational appointment booking.

This module provides integration with Google's Gemini API for natural language
understanding and conversation management using a tool-based approach.
"""

import logging
import os
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta, date
from enum import Enum

# pyright: reportUnknownMemberType=false, reportGeneralTypeIssues=false

import google.generativeai as genai
from sqlalchemy.orm import Session
from google.generativeai.types import FunctionDeclaration, Tool

from ..core.config import settings
from ..models.clinic import Clinic
from ..models.therapist import Therapist
from ..models.appointment_type import AppointmentType
from ..models.appointment import Appointment


class IntentClassification(str, Enum):
    """Enum for intent classification results."""
    APPOINTMENT = "appointment"
    OTHER = "other"


logger = logging.getLogger(__name__)


class LLMTool:
    """Base class for LLM tools."""

    def __init__(self, name: str, description: str, parameters: Dict[str, Any]):
        super().__init__()
        self.name = name
        self.description = description
        self.parameters = parameters

    def to_gemini_tool(self) -> FunctionDeclaration:
        """Convert the tool to a Gemini FunctionDeclaration."""
        return FunctionDeclaration(
            name=self.name,
            description=self.description,
            parameters=self.parameters,
        )

    def execute(self, **kwargs: Any) -> Any:
        """Execute the tool with given parameters."""
        raise NotImplementedError("Subclasses must implement execute method")


class GetTherapistAvailabilityTool(LLMTool):
    """Tool to get therapist availability for appointment booking."""

    def __init__(self, db: Session, clinic_id: int):
        super().__init__(
            name="get_therapist_availability",
            description="Get available time slots for therapists at the clinic. Use this when a patient wants to book an appointment and needs to see available times.",
            parameters={
                "type": "object",
                "properties": {
                    "therapist_name": {
                        "type": "string",
                        "description": "Name of the therapist (optional - if not specified, show all therapists)"
                    },
                    "appointment_type": {
                        "type": "string",
                        "description": "Type of appointment (e.g., '初診評估', '一般複診', '徒手治療')"
                    },
                    "date": {
                        "type": "string",
                        "description": "Date in YYYY-MM-DD format (optional - if not specified, check today and next 7 days)"
                    }
                },
                "required": ["appointment_type"]
            }
        )
        self.db = db
        self.clinic_id = clinic_id

    def execute(self, therapist_name: Optional[str] = None, appointment_type: str = "", date: Optional[str] = None, **kwargs: Any) -> Dict[str, Any]:
        """Get therapist availability for the specified parameters."""
        try:
            # Get appointment type
            appt_type = self.db.query(AppointmentType).filter(
                AppointmentType.clinic_id == self.clinic_id,
                AppointmentType.name == appointment_type
            ).first()

            if not appt_type:
                return {
                    "success": False,
                    "error": f"Appointment type '{appointment_type}' not found"
                }

            # Get therapists
            therapists_query = self.db.query(Therapist).filter(Therapist.clinic_id == self.clinic_id)
            if therapist_name:
                therapists_query = therapists_query.filter(Therapist.name.ilike(f"%{therapist_name}%"))

            therapists = therapists_query.all()

            if not therapists:
                return {
                    "success": False,
                    "error": f"No therapists found matching '{therapist_name}'" if therapist_name else "No therapists found"
                }

            # Determine date range
            if date:
                try:
                    start_date = datetime.strptime(date, "%Y-%m-%d").date()
                    end_date = start_date
                except ValueError:
                    return {"success": False, "error": "Invalid date format. Use YYYY-MM-DD"}
            else:
                start_date = datetime.now().date()
                end_date = start_date + timedelta(days=7)

            availability: list[dict[str, Any]] = []

            for therapist in therapists:
                therapist_slots = self._get_therapist_slots(therapist, appt_type, start_date, end_date)
                if therapist_slots:
                    availability.append({
                        "therapist": therapist.name,
                        "slots": therapist_slots
                    })

            return {
                "success": True,
                "availability": availability,
                "appointment_type": appointment_type,
                "duration_minutes": appt_type.duration_minutes
            }

        except Exception as e:
            logger.error(f"Error getting therapist availability: {e}")
            return {"success": False, "error": "Failed to retrieve availability"}

    def _get_therapist_slots(self, therapist: Therapist, appt_type: AppointmentType, start_date: date, end_date: date) -> List[Dict[str, Any]]:
        """
        Generate available time slots for a therapist based on simulated clinic hours
        and existing appointments.
        
        This is a mock implementation that will be replaced by Google Calendar API integration.
        """
        slots: List[Dict[str, Any]] = []
        
        # 1. Simulate clinic hours and slotting configuration
        clinic_open_am = datetime.min.time().replace(hour=9, minute=0)
        clinic_close_am = datetime.min.time().replace(hour=12, minute=0)
        clinic_open_pm = datetime.min.time().replace(hour=14, minute=0)
        clinic_close_pm = datetime.min.time().replace(hour=18, minute=0)
        slot_interval_minutes = 15  # Generate potential slots every 15 minutes
        appointment_duration = timedelta(minutes=int(appt_type.duration_minutes)) # type: ignore

        days_range = (end_date - start_date).days + 1
        for days_ahead in range(days_range):
            current_date = start_date + timedelta(days=days_ahead)

            # Skip weekends
            if current_date.weekday() >= 5:  # Saturday = 5, Sunday = 6
                continue

            # 2. Generate slot candidates for the day
            candidate_slots: List[datetime] = []
            
            # Morning candidates
            current_time = datetime.combine(current_date, clinic_open_am)
            while current_time.time() < clinic_close_am:
                candidate_slots.append(current_time)
                current_time += timedelta(minutes=slot_interval_minutes)

            # Afternoon candidates
            current_time = datetime.combine(current_date, clinic_open_pm)
            while current_time.time() < clinic_close_pm:
                candidate_slots.append(current_time)
                current_time += timedelta(minutes=slot_interval_minutes)

            # 3. Validate each candidate slot
            for slot_start_time in candidate_slots:
                slot_end_time = slot_start_time + appointment_duration

                # Check if the slot fits within clinic hours
                is_in_morning_block = (slot_start_time.time() >= clinic_open_am and slot_end_time.time() <= clinic_close_am)
                is_in_afternoon_block = (slot_start_time.time() >= clinic_open_pm and slot_end_time.time() <= clinic_close_pm)
                
                if not (is_in_morning_block or is_in_afternoon_block):
                    continue

                # Check for conflicts with existing appointments
                therapist_id = int(therapist.id) # type: ignore
                is_available = self._check_slot_availability(therapist_id, slot_start_time, int(appointment_duration.total_seconds() / 60))

                if is_available:
                    slots.append({
                        "date": slot_start_time.strftime("%Y-%m-%d"),
                        "time": slot_start_time.strftime("%H:%M"),
                        "datetime": slot_start_time.isoformat()
                    })

        return slots[:10]  # Limit to 10 slots for response size

    def _check_slot_availability(self, therapist_id: int, start_time: datetime, duration_minutes: int) -> bool:
        """Check if a time slot is available (not conflicting with existing appointments)."""
        end_time = start_time + timedelta(minutes=duration_minutes)

        # Check for conflicting appointments
        conflicting_appointment = self.db.query(Appointment).filter(
            Appointment.therapist_id == therapist_id,
            Appointment.status.in_(['confirmed']),  # Only check confirmed appointments
            Appointment.start_time < end_time,
            Appointment.end_time > start_time
        ).first()

        return conflicting_appointment is None


class CreateAppointmentTool(LLMTool):
    """Tool to create a new appointment."""

    def __init__(self, db: Session, clinic_id: int, patient_id: int):
        super().__init__(
            name="create_appointment",
            description="Create a new appointment for the patient. Use this when the patient has confirmed all details and wants to book the appointment.",
            parameters={
                "type": "object",
                "properties": {
                    "therapist_name": {
                        "type": "string",
                        "description": "Name of the therapist"
                    },
                    "appointment_type": {
                        "type": "string",
                        "description": "Type of appointment (e.g., '初診評估', '一般複診', '徒手治療')"
                    },
                    "date": {
                        "type": "string",
                        "description": "Date in YYYY-MM-DD format"
                    },
                    "time": {
                        "type": "string",
                        "description": "Time in HH:MM format (24-hour)"
                    }
                },
                "required": ["therapist_name", "appointment_type", "date", "time"]
            }
        )
        self.db = db
        self.clinic_id = clinic_id
        self.patient_id = patient_id

    def execute(self, therapist_name: str = "", appointment_type: str = "", date: str = "", time: str = "", **kwargs: Any) -> Dict[str, Any]:
        """Create a new appointment."""
        try:
            # Parse date and time
            try:
                appointment_date = datetime.strptime(date, "%Y-%m-%d").date()
                appointment_time = datetime.strptime(time, "%H:%M").time()
                start_datetime = datetime.combine(appointment_date, appointment_time)
            except ValueError as e:
                return {"success": False, "error": f"Invalid date/time format: {e}"}

            # Get therapist
            therapist = self.db.query(Therapist).filter(
                Therapist.clinic_id == self.clinic_id,
                Therapist.name.ilike(f"%{therapist_name}%")
            ).first()

            if not therapist:
                return {"success": False, "error": f"Therapist '{therapist_name}' not found"}

            # Get appointment type
            appt_type = self.db.query(AppointmentType).filter(
                AppointmentType.clinic_id == self.clinic_id,
                AppointmentType.name == appointment_type
            ).first()

            if not appt_type:
                return {"success": False, "error": f"Appointment type '{appointment_type}' not found"}

            # Calculate end time
            duration = int(appt_type.duration_minutes)  # type: ignore
            end_datetime = start_datetime + timedelta(minutes=duration)

            # Check availability again (double-check)
            conflicting_appointment = self.db.query(Appointment).filter(
                Appointment.therapist_id == therapist.id,
                Appointment.status.in_(['confirmed']),
                Appointment.start_time < end_datetime,
                Appointment.end_time > start_datetime
            ).first()

            if conflicting_appointment:
                return {"success": False, "error": "Time slot is no longer available"}

            # Create appointment
            appointment = Appointment(
                patient_id=self.patient_id,
                therapist_id=therapist.id,
                appointment_type_id=appt_type.id,
                start_time=start_datetime,
                end_time=end_datetime,
                status="confirmed"
            )

            self.db.add(appointment)
            self.db.commit()
            self.db.refresh(appointment)

            return {
                "success": True,
                "appointment_id": appointment.id,
                "therapist": therapist.name,
                "appointment_type": appt_type.name,
                "date": date,
                "time": time,
                "duration": appt_type.duration_minutes
            }

        except Exception as e:
            logger.error(f"Error creating appointment: {e}")
            self.db.rollback()
            return {"success": False, "error": "Failed to create appointment"}


class LLMService:
    """Service for handling LLM-powered conversations."""

    def __init__(self) -> None:
        super().__init__()
        # Check environment variable directly to avoid settings loading issues during tests
        gemini_api_key = os.environ.get('GEMINI_API_KEY') or settings.gemini_api_key
        if not gemini_api_key:
            raise ValueError("GEMINI_API_KEY environment variable is required")

        genai.configure(api_key=gemini_api_key)  # type: ignore
        self.model = genai.GenerativeModel(model_name=settings.gemini_model)

    def _classify_message_intent(self, conversation_contents: List[Any]) -> IntentClassification:
        """
        Classify the intent of a user message using conversation context and structured output.

        Args:
            conversation_contents: Full conversation contents including the current message

        Returns:
            IntentClassification enum value: APPOINTMENT or OTHER
        """
        try:

            # System prompt for intent classification
            system_prompt = """
你是一個意圖分類器，專門判斷用戶訊息是否與預約門診相關。

你的任務是分析用戶的訊息和對話歷史，判斷意圖並以結構化格式回應。

規則：
- 如果訊息明確表達想要預約門診、看診、治療、掛號等意圖，則分類為 "appointment"
- 如果訊息是問候、一般對話、抱怨、不相關的問題、詢問診所資訊等，則分類為 "other"
- 預約相關的關鍵字包括：預約、預約門診、想預約、預約時間、預約治療、初診、複診、看診、治療、掛號
- 考慮對話歷史脈絡來判斷意圖（例如用戶回覆"好的"可能是同意預約）

請直接回應分類結果。
"""

            # Use structured output for intent classification
            response = self.model.generate_content(  # type: ignore
                conversation_contents,
                system_instruction=system_prompt,  # type: ignore
                response_mime_type="text/x.enum",  # type: ignore
                response_schema=IntentClassification  # type: ignore
            )

            # Parse the structured response
            result = response.parsed  # type: ignore
            if result and isinstance(result, IntentClassification):
                return result

            # Fallback to text parsing if structured parsing fails
            text_result = response.text.strip()  # type: ignore
            try:
                return IntentClassification(text_result.lower())
            except ValueError:
                return IntentClassification.OTHER

        except Exception as e:
            logger.error(f"Error classifying message intent: {e}")
            return IntentClassification.OTHER  # Default to other on error

    def process_message(
        self,
        message: str,
        clinic_id: int,
        patient_id: Optional[int],
        db: Session,
        conversation_history: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Process a user message using the Gemini API with function calling.

        Args:
            message: The user's message
            clinic_id: ID of the clinic
            patient_id: ID of the patient (if linked)
            db: Database session
            conversation_history: Previous conversation messages

        Returns:
            Dict containing the final response and any tool results.
            Special protocol: Returns {"response": "NON_APPOINTMENT_MESSAGE", "success": true, "intent": "other"}
            for non-appointment related messages.
        """
        conversation_history = conversation_history or []
        try:
            # 1. Build conversation contents once for both intent classification and main processing
            conversation_contents = self._build_conversation_context(conversation_history)
            conversation_contents.append({
                "role": "user",
                "parts": [{"text": message}]
            })

            # 2. First, classify if the message is appointment-related
            intent_classification = self._classify_message_intent(conversation_contents)
            if intent_classification != IntentClassification.APPOINTMENT:
                return {
                    "response": "NON_APPOINTMENT_MESSAGE",
                    "success": True,
                    "intent": intent_classification.value
                }

            # 3. If appointment-related, proceed with full processing
            system_prompt = self._build_system_prompt(clinic_id, patient_id, db)
            available_tools, tool_executors = self._get_available_tools(db, clinic_id, patient_id)

            # 4. Send the full conversation to the model with system instruction
            response = self.model.generate_content(  # type: ignore
                conversation_contents,
                system_instruction=system_prompt,  # type: ignore
                tools=available_tools
            )
            response_part = response.candidates[0].content.parts[0]  # type: ignore

            tool_results = []

            # 5. Handle function calls if the model requests them
            while hasattr(response_part, 'function_call') and response_part.function_call.name:  # type: ignore
                function_call = response_part.function_call  # type: ignore
                tool_name = function_call.name  # type: ignore
                tool_args = {key: value for key, value in function_call.args.items()}  # type: ignore

                logger.info(f"LLM wants to call tool: {tool_name} with args: {tool_args}")

                if tool_name in tool_executors:
                    # Execute the tool
                    tool_function = tool_executors[tool_name]
                    result = tool_function.execute(**tool_args)
                    tool_results.append({"tool_name": tool_name, "result": result})

                    # 6. Add the function call and response to conversation history
                    conversation_contents.extend([
                        {
                            "role": "model",
                            "parts": [response_part]
                        },
                        {
                            "role": "user",
                            "parts": [
                                genai.types.Part( # type: ignore
                                    function_response=genai.types.FunctionResponse( # type: ignore
                                        name=tool_name,
                                        response=result
                                    )
                                )
                            ]
                        }
                    ])

                    # 7. Send the updated conversation back to the model
                    response = self.model.generate_content(  # type: ignore
                        conversation_contents,
                        system_instruction=system_prompt,  # type: ignore
                        tools=available_tools
                    )
                    response_part = response.candidates[0].content.parts[0]  # type: ignore
                else:
                    logger.error(f"LLM requested unknown tool: {tool_name}")
                    # If tool not found, break and return a default error message
                    return {
                        "response": "抱歉，我無法執行該操作。",
                        "tool_results": tool_results,
                        "success": False
                    }

            # 8. Return the final text response from the model
            final_response = response_part.text  # type: ignore
            return {
                "response": final_response,
                "tool_results": tool_results,
                "success": True
            }

        except Exception as e:
            logger.error(f"Error processing message with LLM: {e}")
            return {
                "response": "抱歉，系統目前無法處理您的請求。請稍後再試。",
                "tool_results": [],
                "success": False,
                "error": str(e)
            }

    def _get_available_tools(self, db: Session, clinic_id: int, patient_id: Optional[int]) -> tuple[Optional[List[Tool]], Dict[str, LLMTool]]:
        """Get available tools based on patient link status."""
        tool_executors: Dict[str, LLMTool] = {}
        if patient_id:
            get_availability_tool = GetTherapistAvailabilityTool(db, clinic_id)
            create_appointment_tool = CreateAppointmentTool(db, clinic_id, patient_id)
            tool_executors = {
                get_availability_tool.name: get_availability_tool,
                create_appointment_tool.name: create_appointment_tool,
            }
        
        if not tool_executors:
            return None, {}

        gemini_tools = Tool(
            function_declarations=[
                tool.to_gemini_tool() for tool in tool_executors.values()
            ]
        )
        return [gemini_tools], tool_executors

    def _build_system_prompt(self, clinic_id: int, patient_id: Optional[int], db: Session) -> str:
        """Build the system prompt for the LLM."""
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        clinic_name = clinic.name if clinic else "診所"

        prompt_parts = [
            f"你是 {clinic_name} 的 LINE 智慧客服機器人，專門協助病患預約門診。",
            "",
            "你的任務是：",
            "1. 親切有禮地回應病患的問題",
            "2. 協助病患預約看診時間",
            "3. 提供清晰的選項讓病患選擇",
            "4. 使用繁體中文與病患溝通",
            "",
            "重要規則：",
            "- 時間格式使用 24 小時制",
            "- 日期格式使用 MM/DD(星期) 例如：10/17(五)",
            "- 回應要簡潔但資訊完整",
        ]

        if patient_id:
            # Patient is linked - show appointment capabilities
            prompt_parts.extend([
                "",
                "病患已連結帳號，可以進行預約操作。",
                "可用的功能：",
                "- 查詢治療師空檔時間",
                "- 預約門診",
                "",
                "預約流程：",
                "1. 詢問想要的治療項目",
                "2. 顯示可用的治療師和時間",
                "3. 讓病患選擇特定的時間",
                "4. 確認預約並建立記錄"
            ])

            # Add therapist and appointment type information
            therapists = db.query(Therapist).filter(Therapist.clinic_id == clinic_id).all()
            if therapists:
                therapist_names = [str(therapist.name) for therapist in therapists]
                prompt_parts.append(f"可用的治療師：{', '.join(therapist_names)}")

            appt_types = db.query(AppointmentType).filter(AppointmentType.clinic_id == clinic_id).all()
            if appt_types:
                type_info: list[str] = []
                for appt_type_item in appt_types:
                    type_info.append(f"{appt_type_item.name}({appt_type_item.duration_minutes}分鐘)")
                prompt_parts.append(f"治療項目：{', '.join(type_info)}")

        else:
            # Patient not linked - focus on account linking
            prompt_parts.extend([
                "",
                "病患尚未連結帳號。",
                "首要任務：協助病患連結帳號",
                "",
                "帳號連結流程：",
                "1. 請病患提供在診所登記的手機號碼",
                "2. 驗證手機號碼是否匹配診所記錄",
                "3. 成功連結後，說明可以開始預約",
                "",
                "如果病患想預約但尚未連結帳號，請先引導他們進行帳號連結。"
            ])

        return "\n".join(prompt_parts)

    def _build_conversation_context(
        self,
        history: List[Dict[str, Any]]
    ) -> List[Any]:
        """Build conversation history for the Gemini chat session."""
        messages: List[Any] = []

        # Add conversation history (limit to last 10 messages for context)
        for msg in history[-10:]:
            role = msg.get("role", "user")
            content = msg.get("content")

            if isinstance(content, str):
                # Convert to Gemini Content format
                from google.generativeai.types import ContentDict
                content_dict: ContentDict = {
                    "role": role,
                    "parts": [{"text": content}]
                }
                messages.append(content_dict)

        return messages


# Global LLM service instance - lazy initialization
_llm_service_instance: Optional[LLMService] = None

def get_llm_service() -> LLMService:
    """Get or create the LLM service instance."""
    global _llm_service_instance
    if _llm_service_instance is None:
        _llm_service_instance = LLMService()
    return _llm_service_instance

# For backward compatibility, create a lazy instance
class _LazyLLMService:
    """Lazy wrapper for LLM service to avoid initialization on import."""

    def __init__(self):
        super().__init__()
        self._instance: Optional[LLMService] = None

    def __getattr__(self, name: str) -> Any:
        if self._instance is None:
            self._instance = LLMService()
        return getattr(self._instance, name)

llm_service = _LazyLLMService()
