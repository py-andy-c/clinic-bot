"""
Dashboard service for clinic metrics and statistics.

This module provides methods to aggregate and calculate various metrics
for the clinic dashboard, including patient, appointment, and message statistics.
"""

import logging
from datetime import date, datetime
from typing import List, Dict, Any, Optional
from calendar import monthrange

from sqlalchemy.orm import Session
from sqlalchemy import func, and_

from models import (
    Patient, Appointment, CalendarEvent, AppointmentType,
    UserClinicAssociation, User, LinePushMessage, LineAiReply
)
from utils.datetime_utils import taiwan_now, TAIWAN_TZ
from core.constants import DASHBOARD_PAST_MONTHS_COUNT

logger = logging.getLogger(__name__)


def _resolve_practitioner_name(
    practitioner_name: Optional[str],
    user_email: Optional[str],
    user_id: int
) -> str:
    """
    Resolve practitioner display name with fallback logic.
    
    Priority:
    1. UserClinicAssociation.full_name (if available)
    2. User.email (if association is missing)
    3. Fallback to "未知治療師 (ID: {user_id})"
    
    Args:
        practitioner_name: Full name from UserClinicAssociation (may be None)
        user_email: Email from User (may be None)
        user_id: User ID for fallback
        
    Returns:
        Display name for the practitioner
    """
    if practitioner_name:
        return practitioner_name
    if user_email:
        return user_email
    return f"未知治療師 (ID: {user_id})"


def _filter_fade_out_items(
    stats: List[Dict[str, Any]],
    id_key: str,
    is_deleted_key: str,
    keep_active_with_zero: bool = True
) -> List[Dict[str, Any]]:
    """
    Filter out deleted/inactive items that have no data in displayed months.
    
    Fade-out logic:
    - Active items always appear (even with 0 count) if keep_active_with_zero=True
    - Deleted/inactive items only appear if they have appointments in any displayed month
    
    Args:
        stats: List of statistics dictionaries
        id_key: Key for the ID field (e.g., 'appointment_type_id', 'user_id')
        is_deleted_key: Key for the deleted/inactive flag (e.g., 'is_deleted', 'is_active')
        keep_active_with_zero: If True, active items always appear even with 0 count
        
    Returns:
        Filtered list of statistics
    """
    # Find IDs that have data (count > 0) in any month
    ids_with_data = {
        stat[id_key]
        for stat in stats
        if stat.get('count', 0) > 0
    }
    
    # Filter: keep active items OR items with data
    filtered: List[Dict[str, Any]] = []
    for stat in stats:
        # For appointment types: is_deleted=False means active
        # For practitioners: is_active=True means active
        # The logic is inverted for appointment types (is_deleted) vs practitioners (is_active)
        if is_deleted_key == 'is_deleted':
            # Appointment types: is_deleted=False means active
            is_active = not stat.get(is_deleted_key, False)
        else:
            # Practitioners: is_active=True means active
            is_active = stat.get(is_deleted_key, True)
        
        has_data = stat[id_key] in ids_with_data
        
        # Keep if: (active AND keep_active_with_zero) OR has_data
        if (is_active and keep_active_with_zero) or has_data:
            filtered.append(stat)
    
    return filtered


# Event type display names mapping
EVENT_TYPE_DISPLAY_NAMES = {
    # To Patients
    'appointment_confirmation': '預約確認',
    'appointment_cancellation': '預約取消',
    'appointment_edit': '預約調整',
    'appointment_reminder': '預約提醒',
    'availability_notification': '空檔通知',
    # To Practitioners
    'new_appointment_notification': '新預約通知',
    'appointment_cancellation_notification': '預約取消通知',
    'appointment_edit_notification': '預約調整通知',
    'daily_appointment_reminder': '每日預約提醒',
    # To Admins
    'auto_assigned_notification': '待審核預約通知',
}


class MonthInfo:
    """Month information for dashboard metrics."""
    
    def __init__(self, year: int, month: int, is_current: bool = False):
        self.year = year
        self.month = month
        self.is_current = is_current
        self.display_name = f"{year}年{month}月"
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "year": self.year,
            "month": self.month,
            "display_name": self.display_name,
            "is_current": self.is_current
        }
    
    def start_date(self) -> date:
        """Get the first day of the month."""
        return date(self.year, self.month, 1)
    
    def end_date(self) -> date:
        """Get the last day of the month."""
        _, last_day = monthrange(self.year, self.month)
        return date(self.year, self.month, last_day)


def get_months_for_dashboard() -> List[MonthInfo]:
    """
    Get list of months for dashboard display: past N months + current month.
    
    Uses DASHBOARD_PAST_MONTHS_COUNT constant to determine number of past months.
    
    Returns:
        List of MonthInfo objects, ordered from oldest to newest
    """
    now = taiwan_now()
    current_year = now.year
    current_month = now.month
    
    months: List[MonthInfo] = []
    
    # Add past N months (using constant)
    for i in range(DASHBOARD_PAST_MONTHS_COUNT, 0, -1):
        month = current_month - i
        year = current_year
        
        if month <= 0:
            month += 12
            year -= 1
        
        months.append(MonthInfo(year, month, is_current=False))
    
    # Add current month
    months.append(MonthInfo(current_year, current_month, is_current=True))
    
    return months


class DashboardService:
    """Service for dashboard metrics and statistics."""
    
    @staticmethod
    def get_active_patients_by_month(
        db: Session,
        clinic_id: int,
        months: List[MonthInfo]
    ) -> List[Dict[str, Any]]:
        """
        Get active patients count for each month.
        
        Active patients are defined as patients who have at least one
        non-cancelled appointment in that month.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            months: List of MonthInfo objects
            
        Returns:
            List of dictionaries with 'month' (MonthInfo dict) and 'count' (int)
        """
        results: List[Dict[str, Any]] = []
        
        for month_info in months:
            # Query distinct patients with non-cancelled appointments in this month
            count = db.query(
                func.count(func.distinct(Patient.id))
            ).join(
                Appointment, Appointment.patient_id == Patient.id
            ).join(
                CalendarEvent, CalendarEvent.id == Appointment.calendar_event_id
            ).filter(
                Patient.clinic_id == clinic_id,
                # Note: Patient.is_deleted is NOT filtered - patient deletion is only for LIFF filtering,
                # clinic-side dashboard should include all patients for accurate historical statistics
                Appointment.status == 'confirmed',
                func.date_part('year', CalendarEvent.date) == month_info.year,
                func.date_part('month', CalendarEvent.date) == month_info.month
            ).scalar() or 0
            
            results.append({
                'month': month_info.to_dict(),
                'count': count
            })
        
        return results
    
    @staticmethod
    def get_new_patients_by_month(
        db: Session,
        clinic_id: int,
        months: List[MonthInfo]
    ) -> List[Dict[str, Any]]:
        """
        Get new patients count for each month.
        
        New patients are defined as patients created in that calendar month
        (based on created_at timestamp in Taiwan timezone).
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            months: List of MonthInfo objects
            
        Returns:
            List of dictionaries with 'month' (MonthInfo dict) and 'count' (int)
        """
        results: List[Dict[str, Any]] = []
        
        for month_info in months:
            # Calculate start and end of month in Taiwan timezone
            start_datetime = datetime.combine(
                month_info.start_date(),
                datetime.min.time()
            ).replace(tzinfo=TAIWAN_TZ)
            
            # Get last day of month
            _, last_day = monthrange(month_info.year, month_info.month)
            end_date = date(month_info.year, month_info.month, last_day)
            end_datetime = datetime.combine(
                end_date,
                datetime.max.time()
            ).replace(tzinfo=TAIWAN_TZ)
            
            # Query patients created in this month
            count = db.query(func.count(Patient.id)).filter(
                Patient.clinic_id == clinic_id,
                # Note: Patient.is_deleted is NOT filtered - patient deletion is only for LIFF filtering,
                # clinic-side dashboard should include all patients for accurate historical statistics
                Patient.created_at >= start_datetime,
                Patient.created_at <= end_datetime
            ).scalar() or 0
            
            results.append({
                'month': month_info.to_dict(),
                'count': count
            })
        
        return results
    
    @staticmethod
    def get_appointments_by_month(
        db: Session,
        clinic_id: int,
        months: List[MonthInfo]
    ) -> List[Dict[str, Any]]:
        """
        Get non-cancelled appointments count for each month.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            months: List of MonthInfo objects
            
        Returns:
            List of dictionaries with 'month' (MonthInfo dict) and 'count' (int)
        """
        results: List[Dict[str, Any]] = []
        
        for month_info in months:
            # Query non-cancelled appointments in this month
            count = db.query(func.count(Appointment.calendar_event_id)).join(
                CalendarEvent, CalendarEvent.id == Appointment.calendar_event_id
            ).filter(
                CalendarEvent.clinic_id == clinic_id,
                Appointment.status == 'confirmed',
                func.date_part('year', CalendarEvent.date) == month_info.year,
                func.date_part('month', CalendarEvent.date) == month_info.month
            ).scalar() or 0
            
            results.append({
                'month': month_info.to_dict(),
                'count': count
            })
        
        return results
    
    @staticmethod
    def get_cancellation_rate_by_month(
        db: Session,
        clinic_id: int,
        months: List[MonthInfo]
    ) -> List[Dict[str, Any]]:
        """
        Get cancellation breakdown for each month.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            months: List of MonthInfo objects
            
        Returns:
            List of dictionaries with cancellation statistics for each month
        """
        results: List[Dict[str, Any]] = []
        
        for month_info in months:
            # Query all appointments in this month (including cancelled)
            appointments_query = db.query(
                Appointment.status,
                func.count(Appointment.calendar_event_id).label('count')
            ).join(
                CalendarEvent, CalendarEvent.id == Appointment.calendar_event_id
            ).filter(
                CalendarEvent.clinic_id == clinic_id,
                func.date_part('year', CalendarEvent.date) == month_info.year,
                func.date_part('month', CalendarEvent.date) == month_info.month
            ).group_by(Appointment.status)
            
            # Aggregate counts
            canceled_by_clinic_count = 0
            canceled_by_patient_count = 0
            total_count = 0
            
            for status, count in appointments_query.all():
                total_count += count
                if status == 'canceled_by_clinic':
                    canceled_by_clinic_count = count
                elif status == 'canceled_by_patient':
                    canceled_by_patient_count = count
            
            total_canceled_count = canceled_by_clinic_count + canceled_by_patient_count
            
            # Calculate percentages
            canceled_by_clinic_percentage = (
                (canceled_by_clinic_count / total_count * 100) if total_count > 0 else 0.0
            )
            canceled_by_patient_percentage = (
                (canceled_by_patient_count / total_count * 100) if total_count > 0 else 0.0
            )
            total_cancellation_rate = (
                (total_canceled_count / total_count * 100) if total_count > 0 else 0.0
            )
            
            results.append({
                'month': month_info.to_dict(),
                'canceled_by_clinic_count': canceled_by_clinic_count,
                'canceled_by_clinic_percentage': round(canceled_by_clinic_percentage, 1),
                'canceled_by_patient_count': canceled_by_patient_count,
                'canceled_by_patient_percentage': round(canceled_by_patient_percentage, 1),
                'total_canceled_count': total_canceled_count,
                'total_cancellation_rate': round(total_cancellation_rate, 1)
            })
        
        return results
    
    @staticmethod
    def get_appointment_type_stats_by_month(
        db: Session,
        clinic_id: int,
        months: List[MonthInfo]
    ) -> List[Dict[str, Any]]:
        """
        Get appointment type statistics for each month.
        
        Includes both active and deleted appointment types. Active types always appear
        even with 0 appointments. Deleted types only appear if they have appointments
        in any displayed month.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            months: List of MonthInfo objects
            
        Returns:
            List of dictionaries with appointment type statistics for each month.
            Each dict includes 'is_deleted' flag.
        """
        results: List[Dict[str, Any]] = []
        
        # Get all appointment types for this clinic (active and deleted)
        all_appointment_types = db.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic_id
        ).all()
        
        # Build map of appointment type ID to (name, is_deleted)
        type_info_map = {
            at.id: (at.name, at.is_deleted)
            for at in all_appointment_types
        }
        
        # Track which types have appointments in any displayed month
        types_with_appointments: set[int] = set()
        
        for month_info in months:
            # Query appointment type counts for this month (includes deleted types)
            type_counts = db.query(
                Appointment.appointment_type_id,
                func.count(Appointment.calendar_event_id).label('count')
            ).join(
                CalendarEvent, CalendarEvent.id == Appointment.calendar_event_id
            ).join(
                AppointmentType, AppointmentType.id == Appointment.appointment_type_id
            ).filter(
                CalendarEvent.clinic_id == clinic_id,
                Appointment.status == 'confirmed',
                func.date_part('year', CalendarEvent.date) == month_info.year,
                func.date_part('month', CalendarEvent.date) == month_info.month
            ).group_by(
                Appointment.appointment_type_id
            ).all()
            
            # Track types with appointments
            for appointment_type_id, _ in type_counts:
                types_with_appointments.add(appointment_type_id)
            
            # Calculate total for percentage calculation
            total_count = sum(count for _, count in type_counts)
            
            # Build results for this month from actual appointments
            for appointment_type_id, count in type_counts:
                type_name, is_deleted = type_info_map.get(
                    appointment_type_id,
                    ("未知服務類型", True)  # Fallback for missing types
                )
                percentage = (count / total_count * 100) if total_count > 0 else 0.0
                
                results.append({
                    'month': month_info.to_dict(),
                    'appointment_type_id': appointment_type_id,
                    'appointment_type_name': type_name,
                    'count': count,
                    'percentage': round(percentage, 1),
                    'is_deleted': is_deleted
                })
        
        # Add active appointment types with 0 appointments (they always appear)
        for appointment_type_id, (type_name, is_deleted) in type_info_map.items():
            if not is_deleted:  # Active types
                # Check if already in results (has appointments in some month)
                has_data = any(
                    r['appointment_type_id'] == appointment_type_id
                    for r in results
                )
                
                if not has_data:
                    # Add 0 counts for all months
                    for month_info in months:
                        results.append({
                            'month': month_info.to_dict(),
                            'appointment_type_id': appointment_type_id,
                            'appointment_type_name': type_name,
                            'count': 0,
                            'percentage': 0.0,
                            'is_deleted': False
                        })
        
        return results
    
    @staticmethod
    def get_practitioner_stats_by_month(
        db: Session,
        clinic_id: int,
        months: List[MonthInfo]
    ) -> List[Dict[str, Any]]:
        """
        Get practitioner statistics for each month.
        
        Includes both active and inactive practitioners. Uses LEFT JOIN to handle
        missing UserClinicAssociation records (defensive programming).
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            months: List of MonthInfo objects
            
        Returns:
            List of dictionaries with practitioner statistics for each month.
            Each dict includes 'is_active' flag.
        """
        results: List[Dict[str, Any]] = []
        
        # Track which practitioners have appointments in any displayed month
        practitioners_with_appointments: set[int] = set()
        
        for month_info in months:
            # Query practitioner appointment counts for this month
            # Use LEFT JOIN to include appointments even if UserClinicAssociation is missing
            practitioner_counts = db.query(
                CalendarEvent.user_id,
                UserClinicAssociation.full_name,
                UserClinicAssociation.is_active,
                User.email.label('user_email'),
                func.count(Appointment.calendar_event_id).label('count')
            ).join(
                Appointment, Appointment.calendar_event_id == CalendarEvent.id
            ).outerjoin(
                UserClinicAssociation,
                and_(
                    UserClinicAssociation.user_id == CalendarEvent.user_id,
                    UserClinicAssociation.clinic_id == clinic_id
                )
            ).outerjoin(
                User, User.id == CalendarEvent.user_id
            ).filter(
                CalendarEvent.clinic_id == clinic_id,
                Appointment.status == 'confirmed',
                func.date_part('year', CalendarEvent.date) == month_info.year,
                func.date_part('month', CalendarEvent.date) == month_info.month
            ).group_by(
                CalendarEvent.user_id,
                UserClinicAssociation.full_name,
                UserClinicAssociation.is_active,
                User.email
            ).all()
            
            # Track practitioners with appointments
            for user_id, _, _, _, _ in practitioner_counts:
                practitioners_with_appointments.add(user_id)
            
            # Calculate total for percentage calculation
            total_count = sum(count for _, _, _, _, count in practitioner_counts)
            
            # Build results for this month
            for user_id, practitioner_name, is_active, user_email, count in practitioner_counts:
                # Resolve practitioner display name with fallback logic
                display_name = _resolve_practitioner_name(practitioner_name, user_email, user_id)
                # is_active is None if association is missing, treat as inactive
                is_practitioner_active = is_active if is_active is not None else False
                
                percentage = (count / total_count * 100) if total_count > 0 else 0.0
                
                results.append({
                    'month': month_info.to_dict(),
                    'user_id': user_id,
                    'practitioner_name': display_name,
                    'count': count,
                    'percentage': round(percentage, 1),
                    'is_active': is_practitioner_active
                })
        
        return results
    
    @staticmethod
    def get_paid_messages_by_month(
        db: Session,
        clinic_id: int,
        months: List[MonthInfo]
    ) -> List[Dict[str, Any]]:
        """
        Get paid messages (push messages) breakdown by event type for each month.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            months: List of MonthInfo objects
            
        Returns:
            List of dictionaries with message statistics for each month,
            grouped by recipient_type and event_type
        """
        results: List[Dict[str, Any]] = []
        
        for month_info in months:
            # Calculate start and end of month in Taiwan timezone
            start_datetime = datetime.combine(
                month_info.start_date(),
                datetime.min.time()
            ).replace(tzinfo=TAIWAN_TZ)
            
            # Get last day of month
            _, last_day = monthrange(month_info.year, month_info.month)
            end_date = date(month_info.year, month_info.month, last_day)
            end_datetime = datetime.combine(
                end_date,
                datetime.max.time()
            ).replace(tzinfo=TAIWAN_TZ)
            
            # Query push messages grouped by recipient_type and event_type
            message_counts = db.query(
                LinePushMessage.recipient_type,
                LinePushMessage.event_type,
                LinePushMessage.trigger_source,
                func.count(LinePushMessage.id).label('count')
            ).filter(
                LinePushMessage.clinic_id == clinic_id,
                LinePushMessage.created_at >= start_datetime,
                LinePushMessage.created_at <= end_datetime
            ).group_by(
                LinePushMessage.recipient_type,
                LinePushMessage.event_type,
                LinePushMessage.trigger_source
            ).all()
            
            # Build results for this month
            for recipient_type, event_type, trigger_source, count in message_counts:
                event_display_name = EVENT_TYPE_DISPLAY_NAMES.get(
                    event_type,
                    event_type  # Fallback to event_type if not in mapping
                )
                
                results.append({
                    'month': month_info.to_dict(),
                    'recipient_type': recipient_type,
                    'event_type': event_type,
                    'event_display_name': event_display_name,
                    'trigger_source': trigger_source,
                    'count': count
                })
        
        return results
    
    @staticmethod
    def get_ai_reply_messages_by_month(
        db: Session,
        clinic_id: int,
        months: List[MonthInfo]
    ) -> List[Dict[str, Any]]:
        """
        Get AI reply messages (free messages) for each month.
        
        AI replies are tracked in LineAiReply table, which persists indefinitely
        (unlike LineMessage which is cleaned up after 10 days) to maintain
        accurate historical dashboard statistics.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            months: List of MonthInfo objects
            
        Returns:
            List of dictionaries with AI reply message statistics for each month
        """
        results: List[Dict[str, Any]] = []
        
        for month_info in months:
            # Calculate start and end of month in Taiwan timezone
            start_datetime = datetime.combine(
                month_info.start_date(),
                datetime.min.time()
            ).replace(tzinfo=TAIWAN_TZ)
            
            # Get last day of month
            _, last_day = monthrange(month_info.year, month_info.month)
            end_date = date(month_info.year, month_info.month, last_day)
            end_datetime = datetime.combine(
                end_date,
                datetime.max.time()
            ).replace(tzinfo=TAIWAN_TZ)
            
            # Query AI reply messages from LineAiReply table
            count = db.query(func.count(LineAiReply.id)).filter(
                LineAiReply.clinic_id == clinic_id,
                LineAiReply.created_at >= start_datetime,
                LineAiReply.created_at <= end_datetime
            ).scalar() or 0
            
            # AI replies don't have recipient_type, event_type, or trigger_source
            results.append({
                'month': month_info.to_dict(),
                'recipient_type': None,
                'event_type': None,
                'event_display_name': 'AI 回覆訊息',
                'trigger_source': None,
                'count': count
            })
        
        return results
    
    @staticmethod
    def get_clinic_metrics(
        db: Session,
        clinic_id: int
    ) -> Dict[str, Any]:
        """
        Get all dashboard metrics for a clinic.
        
        This method aggregates all metrics by calling individual service methods
        and returns them in the format expected by the API response.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            
        Returns:
            Dictionary with all metrics, ready to be converted to ClinicDashboardMetricsResponse
        """
        months = get_months_for_dashboard()
        
        # Get all metrics
        active_patients = DashboardService.get_active_patients_by_month(
            db, clinic_id, months
        )
        new_patients = DashboardService.get_new_patients_by_month(
            db, clinic_id, months
        )
        appointments = DashboardService.get_appointments_by_month(
            db, clinic_id, months
        )
        cancellation_rate = DashboardService.get_cancellation_rate_by_month(
            db, clinic_id, months
        )
        appointment_type_stats = DashboardService.get_appointment_type_stats_by_month(
            db, clinic_id, months
        )
        practitioner_stats = DashboardService.get_practitioner_stats_by_month(
            db, clinic_id, months
        )
        paid_messages = DashboardService.get_paid_messages_by_month(
            db, clinic_id, months
        )
        ai_reply_messages = DashboardService.get_ai_reply_messages_by_month(
            db, clinic_id, months
        )
        
        # Apply fade-out logic: exclude deleted/inactive items with no appointments in displayed months
        # Active appointment types always appear (even with 0 appointments)
        appointment_type_stats_filtered = _filter_fade_out_items(
            appointment_type_stats,
            id_key='appointment_type_id',
            is_deleted_key='is_deleted',
            keep_active_with_zero=True
        )
        
        # Inactive practitioners only appear if they have appointments in any displayed month
        practitioner_stats_filtered = _filter_fade_out_items(
            practitioner_stats,
            id_key='user_id',
            is_deleted_key='is_active',
            keep_active_with_zero=False  # Inactive practitioners don't always appear
        )
        
        return {
            'months': [m.to_dict() for m in months],
            'active_patients_by_month': active_patients,
            'new_patients_by_month': new_patients,
            'appointments_by_month': appointments,
            'cancellation_rate_by_month': cancellation_rate,
            'appointment_type_stats_by_month': appointment_type_stats_filtered,
            'practitioner_stats_by_month': practitioner_stats_filtered,
            'paid_messages_by_month': paid_messages,
            'ai_reply_messages_by_month': ai_reply_messages
        }

