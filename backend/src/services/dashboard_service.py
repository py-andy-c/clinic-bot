"""
Dashboard service for clinic metrics and statistics.

This module provides methods to aggregate and calculate various metrics
for the clinic dashboard, including patient, appointment, and message statistics.
"""

import logging
from datetime import date, datetime, timedelta
from typing import List, Dict, Any
from calendar import monthrange

from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_, case, distinct

from models import (
    Patient, Appointment, CalendarEvent, AppointmentType,
    UserClinicAssociation, User, LinePushMessage, LineMessage
)
from utils.datetime_utils import taiwan_now, TAIWAN_TZ

logger = logging.getLogger(__name__)

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
    Get list of months for dashboard display: past 3 months + current month.
    
    Returns:
        List of MonthInfo objects, ordered from oldest to newest
    """
    now = taiwan_now()
    current_year = now.year
    current_month = now.month
    
    months = []
    
    # Add past 3 months
    for i in range(3, 0, -1):
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
        results = []
        
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
                Patient.is_deleted == False,
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
        results = []
        
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
                Patient.is_deleted == False,
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
        results = []
        
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
        results = []
        
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
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            months: List of MonthInfo objects
            
        Returns:
            List of dictionaries with appointment type statistics for each month
        """
        results = []
        
        for month_info in months:
            # Query appointment type counts for this month
            type_counts = db.query(
                Appointment.appointment_type_id,
                AppointmentType.name,
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
                Appointment.appointment_type_id,
                AppointmentType.name
            ).all()
            
            # Calculate total for percentage calculation
            total_count = sum(count for _, _, count in type_counts)
            
            # Build results for this month
            for appointment_type_id, appointment_type_name, count in type_counts:
                percentage = (count / total_count * 100) if total_count > 0 else 0.0
                
                results.append({
                    'month': month_info.to_dict(),
                    'appointment_type_id': appointment_type_id,
                    'appointment_type_name': appointment_type_name,
                    'count': count,
                    'percentage': round(percentage, 1)
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
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            months: List of MonthInfo objects
            
        Returns:
            List of dictionaries with practitioner statistics for each month
        """
        results = []
        
        for month_info in months:
            # Query practitioner appointment counts for this month
            practitioner_counts = db.query(
                CalendarEvent.user_id,
                UserClinicAssociation.full_name,
                func.count(Appointment.calendar_event_id).label('count')
            ).join(
                Appointment, Appointment.calendar_event_id == CalendarEvent.id
            ).join(
                UserClinicAssociation,
                and_(
                    UserClinicAssociation.user_id == CalendarEvent.user_id,
                    UserClinicAssociation.clinic_id == clinic_id,
                    UserClinicAssociation.is_active == True
                )
            ).filter(
                CalendarEvent.clinic_id == clinic_id,
                Appointment.status == 'confirmed',
                func.date_part('year', CalendarEvent.date) == month_info.year,
                func.date_part('month', CalendarEvent.date) == month_info.month
            ).group_by(
                CalendarEvent.user_id,
                UserClinicAssociation.full_name
            ).all()
            
            # Calculate total for percentage calculation
            total_count = sum(count for _, _, count in practitioner_counts)
            
            # Build results for this month
            for user_id, practitioner_name, count in practitioner_counts:
                percentage = (count / total_count * 100) if total_count > 0 else 0.0
                
                results.append({
                    'month': month_info.to_dict(),
                    'user_id': user_id,
                    'practitioner_name': practitioner_name,
                    'count': count,
                    'percentage': round(percentage, 1)
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
        results = []
        
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
        
        AI replies are stored in LineMessage table where is_from_user=False.
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            months: List of MonthInfo objects
            
        Returns:
            List of dictionaries with AI reply message statistics for each month
        """
        results = []
        
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
            
            # Query AI reply messages (is_from_user=False)
            count = db.query(func.count(LineMessage.id)).filter(
                LineMessage.clinic_id == clinic_id,
                LineMessage.is_from_user == False,
                LineMessage.created_at >= start_datetime,
                LineMessage.created_at <= end_datetime
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

