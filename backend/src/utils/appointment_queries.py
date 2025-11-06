"""
Utility functions for consistent appointment queries.

This module contains reusable query functions that ensure common appointment
query patterns (like future/upcoming appointment filtering) are applied
consistently across all services and APIs.
"""

from sqlalchemy.orm import Session, Query
from sqlalchemy import or_, and_

from models import Appointment, CalendarEvent
from utils.datetime_utils import taiwan_now


def filter_future_appointments(query: Query[Appointment]) -> Query[Appointment]:
    """
    Apply filter to only include future/upcoming appointments.

    An appointment is considered "future" if:
    - Its date is after today, OR
    - Its date is today AND its start time is after the current time

    Uses Taiwan timezone for consistent time comparisons.

    Args:
        query: Base query for Appointment (must be joined with CalendarEvent)

    Returns:
        Query filtered to only include future/upcoming appointments
    """
    # Use Taiwan timezone for consistent comparison
    taiwan_current = taiwan_now()
    today = taiwan_current.date()
    current_time = taiwan_current.time()

    return query.filter(
        or_(
            CalendarEvent.date > today,
            and_(CalendarEvent.date == today, CalendarEvent.start_time > current_time)
        )
    )


def count_future_appointments_for_patient(
    db: Session,
    patient_id: int,
    status: str = "confirmed"
) -> int:
    """
    Count future/upcoming appointments for a specific patient.

    Args:
        db: Database session
        patient_id: Patient ID
        status: Appointment status to filter by (default: "confirmed")

    Returns:
        Count of future appointments for the patient
    """
    query = db.query(Appointment).join(
        CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
    ).filter(
        Appointment.patient_id == patient_id,
        Appointment.status == status
    )

    return filter_future_appointments(query).count()


def count_future_appointments_for_appointment_type(
    db: Session,
    appointment_type_id: int,
    status: str = "confirmed"
) -> int:
    """
    Count future/upcoming appointments for a specific appointment type.

    Args:
        db: Database session
        appointment_type_id: Appointment type ID
        status: Appointment status to filter by (default: "confirmed")

    Returns:
        Count of future appointments for the appointment type
    """
    query = db.query(Appointment).join(
        CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
    ).filter(
        Appointment.appointment_type_id == appointment_type_id,
        Appointment.status == status
    )

    return filter_future_appointments(query).count()


def count_past_appointments_for_appointment_type(
    db: Session,
    appointment_type_id: int,
    status: str = "confirmed"
) -> int:
    """
    Count past/completed appointments for a specific appointment type.

    Args:
        db: Database session
        appointment_type_id: Appointment type ID
        status: Appointment status to filter by (default: "confirmed")

    Returns:
        Count of past appointments for the appointment type
    """
    query = db.query(Appointment).join(
        CalendarEvent, Appointment.calendar_event_id == CalendarEvent.id
    ).filter(
        Appointment.appointment_type_id == appointment_type_id,
        Appointment.status == status
    )

    # Use Taiwan timezone for consistent comparison
    taiwan_current = taiwan_now()
    today = taiwan_current.date()
    current_time = taiwan_current.time()

    return query.filter(
        or_(
            CalendarEvent.date < today,
            and_(CalendarEvent.date == today, CalendarEvent.start_time < current_time)
        )
    ).count()
