# pyright: reportMissingTypeStubs=false
"""
Clinic agent service for processing patient messages via LINE.

This service uses OpenAI Agent SDK to generate AI-powered responses
to patient inquiries, with conversation history stored in PostgreSQL.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine, AsyncSession
from sqlalchemy import text
from agents import Agent, ModelSettings, Runner, RunConfig
from agents.extensions.memory import SQLAlchemySession
from openai.types.shared.reasoning import Reasoning

from models import Clinic
from models.clinic import ChatSettings
from core.config import DATABASE_URL
from core.constants import (
    CHAT_MAX_HISTORY_HOURS,
    CHAT_MIN_HISTORY_MESSAGES,
    CHAT_MAX_HISTORY_MESSAGES,
    CHAT_SESSION_EXPIRY_HOURS
)
from .utils import trim_session
from .prompts.base_system_prompt import BASE_SYSTEM_PROMPT

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


def _build_clinic_context(clinic: Clinic, chat_settings_override: Optional[ChatSettings] = None) -> str:
    """
    Build clinic context string for the AI agent in XML format.
    
    Includes clinic name, display name, address, phone, services, and
    detailed chat settings information in structured XML format.
    
    Args:
        clinic: Clinic entity
        chat_settings_override: Optional ChatSettings to use instead of clinic's saved settings
        
    Returns:
        str: Formatted clinic context string in XML format
    """
    validated_settings = clinic.get_validated_settings()
    chat_settings = chat_settings_override if chat_settings_override is not None else validated_settings.chat_settings
    
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
    
    if chat_settings.service_item_selection_guide:
        xml_parts.append(f"  <服務項目選擇指南>{chat_settings.service_item_selection_guide}</服務項目選擇指南>")
    
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
    
    if chat_settings.ai_guidance:
        xml_parts.append(f"  <AI指引>{chat_settings.ai_guidance}</AI指引>")
    
    xml_parts.append("</診所資訊>")
    
    return "\n".join(xml_parts)


def _build_agent_instructions(clinic: Clinic, chat_settings_override: Optional[ChatSettings] = None) -> str:
    """
    Build agent instructions with clinic context.
    
    Args:
        clinic: Clinic entity
        chat_settings_override: Optional ChatSettings to use instead of clinic's saved settings
        
    Returns:
        str: Complete agent instructions with clinic context
    """
    clinic_context = _build_clinic_context(clinic, chat_settings_override)
    clinic_name = clinic.effective_display_name

    return BASE_SYSTEM_PROMPT.format(clinic_name=clinic_name, clinic_context=clinic_context)


def _create_clinic_agent(clinic: Clinic, chat_settings_override: Optional[ChatSettings] = None) -> Agent:
    """
    Create clinic-specific agent with clinic context in instructions.
    
    Creates a new agent for each call to ensure fresh clinic context.
    
    Args:
        clinic: Clinic entity
        chat_settings_override: Optional ChatSettings to use instead of clinic's saved settings
        
    Returns:
        Agent: Clinic-specific agent with context in instructions
    """
    # Build instructions with clinic context
    instructions = _build_agent_instructions(clinic, chat_settings_override)
    
    # Create agent with clinic-specific instructions
    agent = Agent(
        name=f"Clinic Agent - {clinic.name}",
        instructions=instructions,
        model="gpt-5-mini",
        model_settings=ModelSettings(
            reasoning=Reasoning(
                effort="low",
                summary="auto",
            ),
            verbosity="low"
        )  
    )
    
    return agent


# Constants
FALLBACK_ERROR_MESSAGE = "抱歉，我暫時無法處理您的訊息。請稍後再試，或直接聯繫診所。"


class ClinicAgentService:
    """
    Service for processing patient messages through AI agent.
    
    This service manages conversation history per LINE user per clinic
    using OpenAI Agent SDK's SQLAlchemySession for persistence.
    """
    
    @staticmethod
    async def process_message(
        session_id: str,
        message: str,
        clinic: Clinic,
        chat_settings_override: Optional[ChatSettings] = None
    ) -> str:
        """
        Process a message and generate AI response.
        
        This unified method handles both actual LINE messages and test messages.
        For test mode, provide chat_settings_override to use unsaved settings.
        
        Limits conversation history to the last 25 messages to manage
        token usage and keep context relevant. Includes clinic-specific
        context (name, address, phone, services) in the agent's knowledge.
        
        Args:
            session_id: Session ID for conversation continuity (format: "{clinic_id}-{line_user_id}" for LINE, "test-{clinic_id}-{user_id}" for tests)
            message: Message text
            clinic: Clinic entity
            chat_settings_override: Optional ChatSettings to use instead of clinic's saved settings (for test mode)
            
        Returns:
            str: AI-generated response text
            
        Raises:
            Exception: If agent processing fails
        """
        try:
            # Get async engine for SDK
            engine = get_async_engine()
            
            # Create SQLAlchemySession for conversation persistence
            session = SQLAlchemySession(
                session_id=session_id,
                engine=engine,
                create_tables=True
            )
            
            # Limit conversation history using time-based filtering
            # This helps manage token usage and keeps context relevant
            # Filtered items are validated to ensure they start with a legal item type
            await trim_session(
                session=session,
                session_id=session_id,
                engine=engine,
                max_items=CHAT_MAX_HISTORY_MESSAGES,
                max_age_hours=CHAT_MAX_HISTORY_HOURS,
                min_items=CHAT_MIN_HISTORY_MESSAGES,
                session_expiry_hours=CHAT_SESSION_EXPIRY_HOURS
            )
            
            # Create clinic-specific agent with context in system prompt
            # Use chat_settings_override if provided (test mode), otherwise use clinic's saved settings
            agent = _create_clinic_agent(clinic, chat_settings_override=chat_settings_override)
            
            # Determine if this is a test mode based on session_id prefix
            is_test_mode = session_id.startswith("test-")
            
            # Build trace metadata
            trace_metadata = {"clinic_id": str(clinic.id)}
            if is_test_mode:
                trace_metadata["test_mode"] = "true"
            
            # Run agent with session (SDK handles conversation history automatically)
            # Note: When using session memory, pass input as string, not list
            # The SDK will automatically manage conversation history
            # Clinic context is already in the agent's instructions (system prompt)
            result = await Runner.run(
                agent,
                input=message,  # Pass user message directly - context is in system prompt
                session=session,
                run_config=RunConfig(trace_metadata=trace_metadata)
            )
            
            # Extract response text
            response_text = result.final_output_as(str)
            
            # Log with appropriate context
            if is_test_mode:
                logger.info(
                    f"Generated test response for clinic_id={clinic.id}, "
                    f"session_id={session_id}, "
                    f"response_length={len(response_text)}"
                )
            else:
                logger.info(
                    f"Generated response for clinic_id={clinic.id}, "
                    f"session_id={session_id}, "
                    f"response_length={len(response_text)}"
                )
            
            return response_text
            
        except Exception as e:
            logger.exception(
                f"Error processing message for clinic_id={clinic.id}, "
                f"session_id={session_id}: {e}"
            )
            # Return fallback message
            return FALLBACK_ERROR_MESSAGE
    
    @staticmethod
    async def _delete_test_session(session_id: str) -> None:
        """
        Internal method to delete a test session from the database.
        
        Only deletes sessions with 'test-' prefix for safety.
        This ensures we never accidentally delete production LINE sessions.
        
        Used internally by cleanup_old_test_sessions().
        
        Args:
            session_id: Session ID to delete (must start with 'test-')
        """
        if not session_id.startswith("test-"):
            raise ValueError(f"Cannot delete non-test session: {session_id}")
        
        try:
            engine = get_async_engine()
            session = SQLAlchemySession(
                session_id=session_id,
                engine=engine,
                create_tables=False  # Don't create tables if session doesn't exist
            )
            
            # Clear all items from the session
            await session.clear_session()
            
            logger.debug(f"Deleted test session: {session_id}")
            
        except Exception as e:
            logger.warning(f"Error deleting test session {session_id}: {e}")
            # Don't raise - continue with other sessions
    
    @staticmethod
    async def cleanup_old_test_sessions(max_age_hours: int = 1) -> int:
        """
        Delete all test sessions older than max_age_hours (Option C: time-based cleanup).
        
        This is a simple time-based approach that deletes all test sessions
        older than the threshold. It's reliable and doesn't depend on SDK internals.
        
        Args:
            max_age_hours: Maximum age in hours before deletion (default: 1 hour)
            
        Returns:
            int: Number of sessions deleted
        """
        try:
            engine = get_async_engine()
            # Use timezone-naive datetime to match database column (timestamp without time zone)
            # Convert UTC-aware datetime to naive to match database column type
            cutoff_time = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=max_age_hours)
            
            # Query SDK's agent_sessions table to find old test sessions
            # SDK uses its own metadata, so we need to query directly
            # Note: SDK table structure may vary, so we handle errors gracefully
            old_session_ids: List[str] = []
            try:
                async with AsyncSession(engine) as async_session:
                    # Query for test sessions older than cutoff
                    # SDK table name is typically 'agent_sessions' with 'session_id' and 'created_at' columns
                    # We'll query by session_id prefix and check created_at
                    # If table structure differs, we'll fall back to deleting all test sessions
                    query = text("""
                        SELECT session_id 
                        FROM agent_sessions 
                        WHERE session_id LIKE 'test-%'
                        AND created_at < :cutoff_time
                    """)
                    
                    result = await async_session.execute(query, {"cutoff_time": cutoff_time})
                    old_session_ids = [row[0] for row in result.fetchall()]
            except Exception as e:
                logger.warning(f"Could not query SDK sessions table (may not exist yet): {e}")
                # If query fails, we'll just skip cleanup this time
                # This is acceptable - cleanup will retry on next run
                return 0
            
            deleted_count = 0
            for session_id in old_session_ids:
                try:
                    await ClinicAgentService._delete_test_session(session_id)
                    deleted_count += 1
                except Exception as e:
                    logger.warning(f"Failed to delete test session {session_id}: {e}")
                    # Continue with other sessions
            
            if deleted_count > 0:
                logger.info(f"Cleaned up {deleted_count} old test sessions (older than {max_age_hours} hours)")
            
            return deleted_count
            
        except Exception as e:
            logger.exception(f"Error during test session cleanup: {e}")
            # Don't raise - cleanup failures shouldn't break the app
            return 0

