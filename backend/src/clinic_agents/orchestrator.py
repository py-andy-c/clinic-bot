# pyright: reportMissingTypeStubs=false
"""
Workflow orchestrator for multi-agent LINE conversations.

This module coordinates the flow between triage, account linking, and appointment agents.
It handles conversation state management, agent routing, and response formatting.
"""

import logging
from typing import Optional, Any, Dict, cast, List
from dataclasses import dataclass
from sqlalchemy.orm import Session

from agents import Runner, RunConfig, trace
from agents.extensions.memory import SQLAlchemySession

from clinic_agents.context import ConversationContext
from clinic_agents.triage_agent import triage_agent
from clinic_agents.appointment_agent import appointment_agent
from clinic_agents.account_linking_agent import account_linking_agent
from clinic_agents.helpers import get_or_create_line_user, get_patient_from_line_user
from models.clinic import Clinic
from models.line_user import LineUser
from models.appointment_type import AppointmentType
from models.user import User
from models.practitioner_availability import PractitionerAvailability
# DATABASE_URL is now read dynamically in get_session_storage

logger = logging.getLogger(__name__)


@dataclass
class ClinicReadinessStatus:
    """Detailed clinic readiness status for appointments."""
    is_ready: bool
    missing_appointment_types: bool
    appointment_types_count: int
    practitioners_without_availability: List[Dict[str, Any]]  # [{"id": int, "name": str}, ...]
    practitioners_with_availability_count: int


def check_clinic_readiness_for_appointments(db: Session, clinic: Clinic) -> ClinicReadinessStatus:
    """
    Check clinic readiness for appointment booking with detailed status.

    Returns structured information about what's missing and who needs to configure availability.

    Args:
        db: Database session
        clinic: Clinic entity

    Returns:
        ClinicReadinessStatus: Detailed readiness information
    """
    # Check appointment types
    appointment_types_count = db.query(AppointmentType).filter(
        AppointmentType.clinic_id == clinic.id
    ).count()

    missing_appointment_types = appointment_types_count == 0

    # Get all practitioners
    # Note: roles.contains(['practitioner']) may not work correctly with JSON columns in SQLite
    # Use Python filtering instead
    all_users_in_clinic = db.query(User).filter(User.clinic_id == clinic.id).all()
    all_practitioners = [u for u in all_users_in_clinic if 'practitioner' in u.roles]

    # Get practitioners with availability configured
    # Note: roles.contains(['practitioner']) doesn't work reliably with SQLite JSON columns
    # So we get all users with availability and filter by role in Python
    users_with_availability = db.query(User).join(
        PractitionerAvailability,
        User.id == PractitionerAvailability.user_id
    ).filter(
        User.clinic_id == clinic.id
    ).distinct().all()

    # Filter to only practitioners in Python
    practitioners_with_availability = [
        u for u in users_with_availability
        if 'practitioner' in u.roles
    ]

    practitioners_with_availability_ids = {p.id for p in practitioners_with_availability}

    # Find practitioners without availability
    practitioners_without_availability = [
        {"id": p.id, "name": p.full_name}
        for p in all_practitioners
        if p.id not in practitioners_with_availability_ids
    ]

    is_ready = not missing_appointment_types and len(practitioners_with_availability) > 0

    return ClinicReadinessStatus(
        is_ready=is_ready,
        missing_appointment_types=missing_appointment_types,
        appointment_types_count=appointment_types_count,
        practitioners_without_availability=practitioners_without_availability,
        practitioners_with_availability_count=len(practitioners_with_availability)
    )


# Session storage factory for conversation history
# Creates SQLAlchemySession instances for individual users
def get_session_storage(line_user_id: str) -> SQLAlchemySession:
    """Get a SQLAlchemySession for the given LINE user."""
    # Read DATABASE_URL dynamically from environment
    from core.config import get_database_url
    db_url = get_database_url()

    # Convert SQLite URL to async-compatible format for SQLAlchemySession
    session_url = db_url
    if db_url.startswith("sqlite:///"):
        # Replace sqlite:/// with sqlite+aiosqlite:/// for async operations
        session_url = db_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)

    return SQLAlchemySession.from_url(
        session_id=line_user_id,
        url=session_url,
        create_tables=True
    )


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
        context = ConversationContext(
            db_session=db,
            clinic=clinic,
            patient=patient,
            line_user_id=line_user_id,
            is_linked=is_linked
        )

        # 3. Get session for this LINE user (auto-manages conversation history)
        session = get_session_storage(line_user_id)

        # 4. Run triage agent with session and trace metadata
        triage_result = await Runner.run(
            triage_agent,
            input=message_text,
            context=context,
            session=session,
            run_config=RunConfig(trace_metadata={
                "__trace_source__": "line-webhook",
                "clinic_id": clinic.id,
                "line_user_id": line_user_id,
                "step": "triage"
            })
        )

        # 5. Route based on classification (WORKFLOW ORCHESTRATION)
        intent = triage_result.final_output.intent
        logger.info(f"Triage result: {intent} (confidence: {triage_result.final_output.confidence})")
        logger.info(f"Reasoning: {triage_result.final_output.reasoning}")

        if intent == "appointment_related":
            # Handle appointment-related queries
            response_text = await _handle_appointment_flow(
                db, context, session, is_linked, message_text, clinic, line_user_id
            )
            if response_text is None:
                return None  # Clinic not ready, no response
        elif intent == "account_linking":
            # Handle account linking queries (e.g., providing phone number)
            response_text = await _handle_account_linking_flow(
                db, context, session, message_text, clinic, line_user_id
            )
        else:
            # Non-appointment/non-account-linking query - DO NOT respond
            response_text = None

        # 6. Log conversation completion
        logger.info(f"Conversation {line_user_id} completed successfully")

        return response_text


async def _handle_account_linking_flow(
    db: Session,
    context: ConversationContext,
    session: Optional[Any],
    message_text: str,
    clinic: Clinic,
    line_user_id: str
) -> str:
    """
    Handle account linking workflow.
    
    This function is called when the triage agent classifies the message as account_linking,
    which typically happens when a user provides information like phone number for account linking.
    
    Args:
        db: Database session
        context: Current conversation context
        session: SDK session for conversation history
        message_text: The original message text from the user
        clinic: The clinic object
        line_user_id: The LINE user ID
        
    Returns:
        Response text for LINE
    """
    logger.info(f"🔗 Handling account linking flow for {line_user_id}")
    
    # Run account linking agent with trace metadata
    linking_result = await Runner.run(
        account_linking_agent,
        input=message_text,
        context=context,
        session=session,
        run_config=RunConfig(trace_metadata={
            "__trace_source__": "line-webhook",
            "clinic_id": clinic.id,
            "line_user_id": line_user_id,
            "step": "account_linking"
        })
    )
    
    # Check if linking was successful
    if _is_linking_successful(linking_result):
        logger.info(f"✅ Account linking successful for {line_user_id}")
        # Note: Patient context will be refreshed on next message
        # No need to update context here as we're returning immediately
        
        # Return success message
        return linking_result.final_output_as(str)  # type: ignore
    else:
        # Linking failed or in progress, return linking agent's response
        return linking_result.final_output_as(str)  # type: ignore


async def _handle_appointment_flow(
    db: Session,
    context: ConversationContext,
    session: Optional[Any],  # SQLAlchemySession when available
    is_linked: bool,
    message_text: str,
    clinic: Clinic,
    line_user_id: str
) -> Optional[str]:
    """
    Handle appointment workflow: Check readiness → Account linking (if needed) → Appointment agent.

    Args:
        db: Database session
        context: Current conversation context
        session: SDK session for conversation history
        is_linked: Whether user account is linked
        message_text: Original user message
        clinic: Clinic object
        line_user_id: LINE user ID

    Returns:
        Response text for LINE, or None if clinic not ready
    """
    # Check clinic readiness at the start of appointment flow
    readiness = check_clinic_readiness_for_appointments(db, clinic)

    if not readiness.is_ready:
        logger.info(f"Clinic {clinic.id} not ready for appointments - blocking appointment flow for {line_user_id}")
        logger.info(f"Missing: appointment_types={readiness.missing_appointment_types}, practitioners_without_availability={len(readiness.practitioners_without_availability)}")
        return None  # No response - rely on manual reply
    # Check if account linking is needed (WORKFLOW-LEVEL CHECK)
    if not is_linked:
        # First: Run account linking agent with trace metadata
        linking_result = await Runner.run(
            account_linking_agent,
            input=message_text,
            context=context,
            session=session,
            run_config=RunConfig(trace_metadata={
                "__trace_source__": "line-webhook",
                "clinic_id": clinic.id,
                "line_user_id": line_user_id,
                "step": "account_linking"
            })
        )

        # Check if linking was successful
        if _is_linking_successful(linking_result):
            # Update context with newly linked patient
            line_user = db.query(LineUser).filter_by(
                line_user_id=context.line_user_id
            ).first()
            if line_user is not None:
                patient = get_patient_from_line_user(db, line_user)
            else:
                patient = None
            context = ConversationContext(
                db_session=db,
                clinic=context.clinic,
                patient=patient,
                line_user_id=context.line_user_id,
                is_linked=True
            )

            # Then: Run appointment agent with same message and trace metadata
            response = await Runner.run(
                appointment_agent,
                input=message_text,
                context=context,
                session=session,
                run_config=RunConfig(trace_metadata={
                    "__trace_source__": "line-webhook",
                    "clinic_id": clinic.id,
                    "line_user_id": line_user_id,
                    "step": "appointment_after_linking"
                })
            )
            return response.final_output_as(str)  # type: ignore
        else:
            # Linking failed, return linking agent's response
            return linking_result.final_output_as(str)  # type: ignore
    else:
        # Already linked: Go directly to appointment agent with trace metadata
        response = await Runner.run(
            appointment_agent,
            input=message_text,
            context=context,
            session=session,
            run_config=RunConfig(trace_metadata={
                "__trace_source__": "line-webhook",
                "clinic_id": clinic.id,
                "line_user_id": line_user_id,
                "step": "appointment"
            })
        )
        return response.final_output_as(str)  # type: ignore


def _is_linking_successful(linking_result: Any) -> bool:
    """
    Check if account linking was successful from agent result.

    Inspects tool call results in the agent's response to determine
    if the register_patient_account tool succeeded.

    Args:
        linking_result: Result from account linking agent

    Returns:
        True if linking was successful, False otherwise
    """
    import json

    # Check for successful tool calls in new_items
    for item in linking_result.new_items:
        if hasattr(item, 'output'):
            try:
                output = item.output

                # Check for SUCCESS prefix in string responses
                if isinstance(output, str):
                    if output.startswith("SUCCESS:"):
                        return True

                # Try to parse as JSON (for backward compatibility)
                try:
                    parsed = json.loads(output)
                    if isinstance(parsed, dict):
                        parsed_dict = cast(Dict[str, Any], parsed)
                        if parsed_dict.get("success") is True:
                            return True
                except json.JSONDecodeError:
                    pass

            except (AttributeError, TypeError):
                # Not a valid tool result, continue checking
                continue

    return False
