# pyright: reportMissingTypeStubs=false
"""
Clinic agent service for processing patient messages via LINE.

This service uses OpenAI Agent SDK to generate AI-powered responses
to patient inquiries, with conversation history stored in PostgreSQL.
"""

import logging
from typing import Optional

from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from agents import Agent, ModelSettings, Runner, RunConfig
from agents.extensions.memory import SQLAlchemySession

from models import Clinic
from core.config import DATABASE_URL

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


# Initialize clinic agent
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
    model="gpt-4o-mini",
    model_settings=ModelSettings()
)


class ClinicAgentService:
    """
    Service for processing patient messages through AI agent.
    
    This service manages conversation history per LINE user per clinic
    using OpenAI Agent SDK's SQLAlchemySession for persistence.
    """
    
    @staticmethod
    async def process_message(
        line_user_id: str,
        message: str,
        clinic: Clinic
    ) -> str:
        """
        Process a patient message and generate AI response.
        
        Args:
            line_user_id: LINE user ID from webhook
            message: Patient's message text
            clinic: Clinic entity
            
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
            
            # Run agent with session (SDK handles conversation history automatically)
            # Note: When using session memory, pass input as string, not list
            # The SDK will automatically manage conversation history
            result = await Runner.run(
                clinic_agent,
                input=message,  # Pass as string when using session memory
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

