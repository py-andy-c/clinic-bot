# pyright: reportMissingTypeStubs=false
"""
Workflow orchestrator for multi-agent LINE conversations.

This module coordinates the flow between triage, account linking, and appointment agents.
It handles conversation state management, agent routing, and response formatting.
"""

import logging
from typing import Optional
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session

from agents import Runner, RunConfig, trace

from clinic_agents.context import ConversationContext
from clinic_agents.agents import triage_agent
from clinic_agents.line_user_utils import get_or_create_line_user, get_patient_from_line_user
from clinic_agents.history_utils import smart_history_callback
from clinic_agents.session_utils import get_session_storage
from clinic_agents.workflow_handlers import handle_account_linking_flow, handle_appointment_flow
from models.clinic import Clinic

logger = logging.getLogger(__name__)


async def handle_line_message(
    db: Session,
    clinic: Clinic,
    line_user_id: str,
    message_text: str
) -> Optional[str]:
    """
    Orchestrate agent workflow: Triage → Account Linking (if needed) → Appointment Agent.

    This is the main entry point for processing LINE messages. It coordinates
    the workflow between different agents based on conversation state and intent.

    Args:
        db: Database session for all operations
        clinic: Clinic context for the conversation
        line_user_id: LINE platform user identifier
        message_text: The user's message text

    Returns:
        Response text to send back via LINE, or None to send no response
    """
    # Wrap entire workflow in trace for observability
    with trace("LINE message workflow"):
        # 1. Get or create line_user and check linking status
        line_user = get_or_create_line_user(db, line_user_id, clinic.id)
        patient = get_patient_from_line_user(db, line_user)
        is_linked = patient is not None

        # 2. Create conversation context
        # Use Taiwan timezone directly (UTC+8) since this is Taiwan-only service
        taiwan_tz = timezone(timedelta(hours=8))
        context = ConversationContext(
            db_session=db,
            clinic=clinic,
            patient=patient,
            line_user_id=line_user_id,
            is_linked=is_linked,
            current_datetime=datetime.now(taiwan_tz)
        )

        # 3. Log input message
        logger.info(f"📝 Input message: {message_text}")

        # 4. Get session for this LINE user (auto-manages conversation history)
        session = get_session_storage(line_user_id)

        # 5. Run triage agent with limited history callback
        logger.debug(f"🤖 Running triage agent")
        triage_result = await Runner.run(
            triage_agent,
            input=message_text,
            context=context,
            session=session,
            run_config=RunConfig(
                session_input_callback=smart_history_callback,
                trace_metadata={
                    "__trace_source__": "line-webhook",
                    "clinic_id": clinic.id,
                    "line_user_id": line_user_id,
                    "step": "triage"
                }
            )
        )

        # 6. Route based on classification (WORKFLOW ORCHESTRATION)
        intent = triage_result.final_output.intent
        logger.info(f"Triage result: {intent} (confidence: {triage_result.final_output.confidence})")
        logger.info(f"Reasoning: {triage_result.final_output.reasoning}")
        response_text: Optional[str] = None

        if intent == "appointment_related":
            # Handle appointment-related queries
            response_text = await handle_appointment_flow(
                db, context, session, is_linked, message_text, clinic, line_user_id
            )
            if response_text is None:
                logger.debug("❌ Clinic not ready")
                return None  # Clinic not ready, no response
        elif intent == "account_linking":
            # Handle account linking queries (e.g., providing phone number)
            response_text = await handle_account_linking_flow(
                db, context, session, message_text, clinic, line_user_id
            )
        else:
            # Non-appointment/non-account-linking query - DO NOT respond
            logger.debug(f"🚫 Non-appointment query - not responding")
            response_text = None

        # 7. Log agent response
        logger.info(f"📤 Agent response: {response_text}")

        return response_text
