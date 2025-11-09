# pyright: reportMissingTypeStubs=false
"""
Clinic agent service for processing patient messages via LINE.

This service uses OpenAI Agent SDK to generate AI-powered responses
to patient inquiries, with conversation history stored in PostgreSQL.
"""

import logging
from typing import Optional

from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from sqlalchemy.orm import Session
from agents import Agent, ModelSettings, Runner, RunConfig
from agents.extensions.memory import SQLAlchemySession
from openai.types.shared.reasoning import Reasoning

from models import Clinic
from core.config import DATABASE_URL
from .utils import trim_session

logger = logging.getLogger(__name__)


# Create async engine for OpenAI Agent SDK
# SDK requires async SQLAlchemy, so we create a separate async engine
_async_engine: Optional[AsyncEngine] = None


def get_async_engine() -> AsyncEngine:
    """
    Get or create async SQLAlchemy engine for OpenAI Agent SDK.
    
    The SDK requires async SQLAlchemy, so we create a separate engine
    from the sync one used by the rest of the application.
    
    Returns:
        AsyncEngine: Async SQLAlchemy engine for SDK
    """
    global _async_engine
    if _async_engine is None:
        # Convert PostgreSQL URL to async format
        async_url = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
        _async_engine = create_async_engine(
            async_url,
            pool_pre_ping=True,
            echo=False,
        )
    return _async_engine


def _build_agent_instructions(clinic_context: str) -> str:
    """
    Build agent instructions with clinic context.
    
    Args:
        clinic_context: Formatted clinic context string
        
    Returns:
        str: Complete agent instructions with clinic context
    """
    base_instructions = """You are a helpful assistant for a physical therapy clinic.
    Your role is to:
    - Answer patient questions about the clinic
    - Provide information about services and appointment types
    - Help with general inquiries
    - Be friendly, professional, and concise
    - Formatting: Please format your response suitable for LINE messaging. Do not use markdown.
    
    Respond in Traditional Chinese (繁體中文) as this is a Taiwan-based clinic.
    Keep responses brief and conversational, suitable for LINE messaging.
    
    IMPORTANT INSTRUCTIONS:
    - Answer questions ONLY based on the clinic information provided below
    - NEVER make up, invent, or hallucinate any information about the clinic
    - If you don't know something or it's not in the provided context, politely say "抱歉，我沒有這方面的資訊，之後再由專人回覆您喔！"
    - Always refer to the clinic information provided in the XML format below for accurate details
    - When patients ask about making appointments, always direct them to use the "選單" at the bottom of the LINE official account. This is the preferred way to make appointments.
    
    Below is the information about this clinic:
    
{clinic_context}"""
    
    return base_instructions.format(clinic_context=clinic_context)


def _create_clinic_agent(clinic: Clinic, db: Session) -> Agent:
    """
    Create clinic-specific agent with clinic context in instructions.
    
    Creates a new agent for each call to ensure fresh clinic context.
    
    Args:
        clinic: Clinic entity
        db: Database session
        
    Returns:
        Agent: Clinic-specific agent with context in instructions
    """
    # Build clinic context
    clinic_context = ClinicAgentService._build_clinic_context(clinic, db)
    
    # Build instructions with clinic context
    instructions = _build_agent_instructions(clinic_context)
    
    # Create agent with clinic-specific instructions
    agent = Agent(
        name=f"Clinic Agent - {clinic.name}",
        instructions=instructions,
        model="gpt-5-nano",
        model_settings=ModelSettings(
            reasoning=Reasoning(
                effort="low",
                summary="auto"
            )
        )  
    )
    
    return agent


class ClinicAgentService:
    """
    Service for processing patient messages through AI agent.
    
    This service manages conversation history per LINE user per clinic
    using OpenAI Agent SDK's SQLAlchemySession for persistence.
    """
    
    @staticmethod
    def _build_clinic_context(clinic: Clinic, db: Session) -> str:
        """
        Build clinic context string for the AI agent in XML format.
        
        Includes clinic name, display name, address, phone, services, and
        detailed chat settings information in structured XML format.
        
        Args:
            clinic: Clinic entity
            db: Database session
            
        Returns:
            str: Formatted clinic context string in XML format
        """
        validated_settings = clinic.get_validated_settings()
        chat_settings = validated_settings.chat_settings
        
        xml_parts = ["<診所資訊>"]
        
        # Basic clinic information
        clinic_name = clinic.effective_display_name
        xml_parts.append(f"  <診所名稱>{clinic_name}</診所名稱>")
        
        if clinic.address:
            xml_parts.append(f"  <地址>{clinic.address}</地址>")
        
        if clinic.phone_number:
            xml_parts.append(f"  <電話>{clinic.phone_number}</電話>")
        
        if validated_settings.clinic_info_settings.appointment_type_instructions:
            instructions = validated_settings.clinic_info_settings.appointment_type_instructions
            xml_parts.append(f"  <預約說明>{instructions}</預約說明>")
        
        # Chat settings - detailed clinic information
        if chat_settings.clinic_description:
            xml_parts.append(f"  <診所介紹>{chat_settings.clinic_description}</診所介紹>")
        
        if chat_settings.therapist_info:
            xml_parts.append(f"  <治療師資訊>{chat_settings.therapist_info}</治療師資訊>")
        
        if chat_settings.treatment_details:
            xml_parts.append(f"  <治療項目詳情>{chat_settings.treatment_details}</治療項目詳情>")
        
        if chat_settings.operating_hours:
            xml_parts.append(f"  <營業時間>{chat_settings.operating_hours}</營業時間>")
        
        if chat_settings.location_details:
            xml_parts.append(f"  <交通資訊>{chat_settings.location_details}</交通資訊>")
        
        if chat_settings.booking_policy:
            xml_parts.append(f"  <預約與取消政策>{chat_settings.booking_policy}</預約與取消政策>")
        
        if chat_settings.payment_methods:
            xml_parts.append(f"  <付款方式>{chat_settings.payment_methods}</付款方式>")
        
        if chat_settings.equipment_facilities:
            xml_parts.append(f"  <設備與設施>{chat_settings.equipment_facilities}</設備與設施>")
        
        if chat_settings.common_questions:
            xml_parts.append(f"  <常見問題>{chat_settings.common_questions}</常見問題>")
        
        if chat_settings.other_info:
            xml_parts.append(f"  <其他資訊>{chat_settings.other_info}</其他資訊>")
        
        xml_parts.append("</診所資訊>")
        
        return "\n".join(xml_parts)
    
    @staticmethod
    async def process_message(
        line_user_id: str,
        message: str,
        clinic: Clinic,
        db: Session
    ) -> str:
        """
        Process a patient message and generate AI response.
        
        Limits conversation history to the last 10 messages to manage
        token usage and keep context relevant. Includes clinic-specific
        context (name, address, phone, services) in the agent's knowledge.
        
        Args:
            line_user_id: LINE user ID from webhook
            message: Patient's message text
            clinic: Clinic entity
            db: Database session (for fetching appointment types)
            
        Returns:
            str: AI-generated response text
            
        Raises:
            Exception: If agent processing fails
        """
        try:
            # Create session ID: format is "{clinic_id}-{line_user_id}"
            # Note: We use the LINE user ID string directly - no need to create LineUser entity
            # LineUser records are created when users first use LIFF (appointment booking)
            session_id = f"{clinic.id}-{line_user_id}"
            
            # Get async engine for SDK
            engine = get_async_engine()
            
            # Create SQLAlchemySession for conversation persistence
            session = SQLAlchemySession(
                session_id=session_id,
                engine=engine,
                create_tables=True
            )
            
            # Limit conversation history to last 10 messages
            # This helps manage token usage and keeps context relevant
            # IMPORTANT: We need to truncate carefully to preserve related items
            # (e.g., message items and their reasoning items, tool calls and results)
            MAX_HISTORY_MESSAGES = 25
            
            # Trim session to limit conversation history while preserving related items
            # This ensures message items keep their reasoning items, tool calls keep results, etc.
            await trim_session(
                session=session,
                max_items=MAX_HISTORY_MESSAGES
            )
            
            # Create clinic-specific agent with context in system prompt
            # Create fresh agent each time to ensure latest clinic context
            agent = _create_clinic_agent(clinic, db)
            
            # Run agent with session (SDK handles conversation history automatically)
            # Note: When using session memory, pass input as string, not list
            # The SDK will automatically manage conversation history
            # Clinic context is already in the agent's instructions (system prompt)
            result = await Runner.run(
                agent,
                input=message,  # Pass user message directly - context is in system prompt
                session=session,
                run_config=RunConfig(trace_metadata={"clinic_id": str(clinic.id)})
            )
            
            # Extract response text
            response_text = result.final_output_as(str)
            
            logger.info(
                f"Generated response for clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}, "
                f"response_length={len(response_text)}"
            )
            
            return response_text
            
        except Exception as e:
            logger.exception(
                f"Error processing message for clinic_id={clinic.id}, "
                f"line_user_id={line_user_id}: {e}"
            )
            # Return fallback message
            return "抱歉，我暫時無法處理您的訊息。請稍後再試，或直接聯繫診所。"

