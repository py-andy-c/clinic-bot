# pyright: reportMissingTypeStubs=false
import logging
import json
from typing import Optional, Any, Dict, cast
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session

from agents import Runner, RunConfig
from clinic_agents.context import ConversationContext
from clinic_agents.agents import appointment_agent, account_linking_agent
from clinic_agents.line_user_utils import get_patient_from_line_user
from clinic_agents.history_utils import smart_history_callback
from clinic_agents.clinic_readiness import check_clinic_readiness_for_appointments
from models.clinic import Clinic
from models.line_user import LineUser

logger = logging.getLogger(__name__)


async def handle_account_linking_flow(
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

    # Run account linking agent with limited history callback
    linking_result = await Runner.run(
        account_linking_agent,
        input=message_text,
        context=context,
        session=session,
        run_config=RunConfig(
            session_input_callback=smart_history_callback,
            trace_metadata={
                "__trace_source__": "line-webhook",
                "clinic_id": clinic.id,
                "line_user_id": line_user_id,
                "step": "account_linking"
            }
        )
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


async def handle_appointment_flow(
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
            # Use Taiwan timezone directly (UTC+8) since this is Taiwan-only service
            taiwan_tz = timezone(timedelta(hours=8))
            context = ConversationContext(
                db_session=db,
                clinic=context.clinic,
                patient=patient,
                line_user_id=context.line_user_id,
                is_linked=True,
                current_datetime=datetime.now(taiwan_tz)
            )

            # Then: Run appointment agent with limited history callback
            response = await Runner.run(
                appointment_agent,
                input=message_text,
                context=context,
                session=session,
                run_config=RunConfig(
                    session_input_callback=smart_history_callback,
                    trace_metadata={
                        "__trace_source__": "line-webhook",
                        "clinic_id": clinic.id,
                        "line_user_id": line_user_id,
                        "step": "appointment_after_linking"
                    }
                )
            )
            return response.final_output_as(str)  # type: ignore
        else:
            # Linking failed, return linking agent's response
            return linking_result.final_output_as(str)  # type: ignore
    else:
        # Already linked: Go directly to appointment agent with limited history callback
        response = await Runner.run(
            appointment_agent,
            input=message_text,
            context=context,
            session=session,
            run_config=RunConfig(
                session_input_callback=smart_history_callback,
                trace_metadata={
                    "__trace_source__": "line-webhook",
                    "clinic_id": clinic.id,
                    "line_user_id": line_user_id,
                    "step": "appointment"
                }
            )
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
