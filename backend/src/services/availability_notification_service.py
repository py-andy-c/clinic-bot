"""
Availability notification service for waitlist functionality.

Handles creation, checking, and sending of availability notifications
when appointment slots become available.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, date, timedelta, time
from typing import List, Dict, Optional
from collections import defaultdict

from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_

from models import (
    AvailabilityNotification, LineUser, Patient, AppointmentType,
    Appointment, CalendarEvent, Clinic
)
from services.availability_service import AvailabilityService
from services.line_service import LINEService
from utils.datetime_utils import taiwan_now, TAIWAN_TZ, format_datetime
from utils.query_helpers import filter_by_role
from models.user_clinic_association import UserClinicAssociation
from shared_types.availability import Slot, TimeWindow
from core.config import LIFF_ID

logger = logging.getLogger(__name__)


@dataclass
class NotificationListItem:
    """Notification item for listing."""
    id: int
    date: str  # ISO format date string
    appointment_type_names: List[str]  # List of appointment type names
    practitioner_names: List[str]  # List of practitioner names (empty if "不指定")
    time_windows: List[str]
    expires_at: str  # ISO format datetime string
    status: str


# Time window definitions
# Note: Boundaries are exclusive for end times to avoid overlap.
# A slot at exactly 12:00 belongs to afternoon, not morning.
# A slot at exactly 18:00 belongs to evening, not afternoon.
TIME_WINDOWS: Dict[str, TimeWindow] = {
    "morning": TimeWindow(start=time(8, 0), end=time(12, 0), display="上午"),      # [08:00, 12:00)
    "afternoon": TimeWindow(start=time(12, 0), end=time(18, 0), display="下午"),  # [12:00, 18:00)
    "evening": TimeWindow(start=time(18, 0), end=time(22, 0), display="晚上"),    # [18:00, 22:00)
}


class AvailabilityNotificationService:
    """
    Service for managing availability notifications.
    
    Handles creating notification requests, checking for available slots,
    and sending notifications to users when slots become available.
    """

    @staticmethod
    def create_notification(
        db: Session,
        line_user_id: int,
        clinic_id: int,
        appointment_type_id: int,
        date: date,
        time_windows: List[str],
        practitioner_id: Optional[int] = None
    ) -> tuple[AvailabilityNotification, bool]:
        """
        Create a notification request with duplicate checking.
        
        If a notification already exists for the same line_user, appointment_type,
        practitioner, and date, the time windows will be merged (combined and deduplicated).
        
        Args:
            db: Database session
            line_user_id: LINE user ID
            clinic_id: Clinic ID
            appointment_type_id: Appointment type ID
            date: Date for notification
            time_windows: List of time windows ["morning", "afternoon", "evening"]
            practitioner_id: Optional practitioner ID (None for "不指定")
            
        Returns:
            Tuple of (AvailabilityNotification, was_created: bool)
            was_created is True if notification was newly created, False if updated
            
        Raises:
            HTTPException: If validation fails
        """
        # Validate time windows
        valid_windows = set(TIME_WINDOWS.keys())
        if not time_windows or not all(w in valid_windows for w in time_windows):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的時段選擇"
            )
        
        # Validate appointment type
        appointment_type = db.query(AppointmentType).filter(
            AppointmentType.id == appointment_type_id,
            AppointmentType.clinic_id == clinic_id,
            AppointmentType.is_deleted == False
        ).first()
        
        if not appointment_type:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到預約類型"
            )
        
        # Validate practitioner if specified
        if practitioner_id:
            from models import User
            query = db.query(User).join(UserClinicAssociation).filter(
                User.id == practitioner_id,
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True
            )
            query = filter_by_role(query, 'practitioner')
            practitioner = query.first()
            
            if not practitioner:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="找不到治療師"
                )
        
        # Check for existing notification with same line_user, date, and time_windows
        # (regardless of appointment_type or practitioner - we'll merge them)
        existing = db.query(AvailabilityNotification).filter(
            AvailabilityNotification.line_user_id == line_user_id,
            AvailabilityNotification.clinic_id == clinic_id,
            AvailabilityNotification.date == date,
            AvailabilityNotification.status == 'active'
        ).first()
        
        # Calculate expiration (end of requested date)
        expires_at = datetime.combine(date, time(23, 59, 59)).replace(tzinfo=TAIWAN_TZ)
        
        # Prepare practitioner_ids list (empty list means "不指定")
        new_practitioner_ids = [practitioner_id] if practitioner_id else []
        
        if existing:
            # Merge time windows: combine existing and new, remove duplicates, sort
            existing_windows = set(existing.time_windows)
            new_windows = set(time_windows)
            merged_windows = sorted(list(existing_windows | new_windows))
            
            # Merge appointment_type_ids: combine existing and new, remove duplicates, sort
            existing_appointment_type_ids = set(existing.appointment_type_ids)
            existing_appointment_type_ids.add(appointment_type_id)
            merged_appointment_type_ids = sorted(list(existing_appointment_type_ids))
            
            # Merge practitioner_ids: combine existing and new, remove duplicates, sort
            existing_practitioner_ids = set(existing.practitioner_ids)
            existing_practitioner_ids.update(new_practitioner_ids)
            merged_practitioner_ids = sorted(list(existing_practitioner_ids))
            
            # Update existing notification with merged data
            existing.time_windows = merged_windows
            existing.appointment_type_ids = merged_appointment_type_ids
            existing.practitioner_ids = merged_practitioner_ids
            existing.expires_at = expires_at
            existing.last_notified_at = None  # Reset notification timestamp
            db.commit()
            db.refresh(existing)
            logger.info(f"Updated notification {existing.id} for date {date}, merged appointment_types: {merged_appointment_type_ids}, practitioners: {merged_practitioner_ids}, time_windows: {merged_windows}")
            return (existing, False)  # False = was updated
        else:
            # Create new notification
            notification = AvailabilityNotification(
                line_user_id=line_user_id,
                clinic_id=clinic_id,
                appointment_type_ids=[appointment_type_id],
                practitioner_ids=new_practitioner_ids,
                date=date,
                time_windows=time_windows,
                status='active',
                created_at=taiwan_now(),
                expires_at=expires_at
            )
            db.add(notification)
            db.commit()
            db.refresh(notification)
            logger.info(f"Created notification {notification.id} for date {date}")
            return (notification, True)  # True = was created

    @staticmethod
    def _find_matching_notifications(
        db: Session,
        clinic_id: int,
        date: date,
        practitioner_id: int
    ) -> List[AvailabilityNotification]:
        """
        Find all active notifications matching the criteria.
        
        Returns notifications where:
        - practitioner_ids is empty (any practitioner/"不指定") OR
        - practitioner_id is in practitioner_ids list
        
        Includes notifications for all appointment types.
        Filters out expired notifications.
        """
        now = taiwan_now()
        all_notifications = db.query(AvailabilityNotification).filter(
            AvailabilityNotification.clinic_id == clinic_id,
            AvailabilityNotification.date == date,
            AvailabilityNotification.status == 'active',
            AvailabilityNotification.expires_at > now  # Filter expired notifications
        ).all()
        
        # Filter by practitioner: match if practitioner_ids is empty OR practitioner_id is in the list
        matching = []
        for notification in all_notifications:
            # Empty practitioner_ids means "不指定" (any practitioner)
            if not notification.practitioner_ids:
                matching.append(notification)
            elif practitioner_id in notification.practitioner_ids:
                matching.append(notification)
        
        return matching

    @staticmethod
    def _get_line_service(
        db: Session,
        clinic_id: int
    ) -> LINEService | None:
        """
        Get LINE service for clinic with validation.
        
        Returns:
            LINEService if clinic exists and has credentials, None otherwise
        """
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            logger.warning(f"Clinic {clinic_id} not found, skipping notifications")
            return None
        
        if not clinic.line_channel_secret or not clinic.line_channel_access_token:
            logger.warning(f"Clinic {clinic_id} missing LINE credentials, skipping notifications")
            return None
        
        line_service = LINEService(
            channel_secret=clinic.line_channel_secret,
            channel_access_token=clinic.line_channel_access_token
        )
        
        return line_service

    @staticmethod
    def _group_slots_by_time_window(
        slots: List[Slot]
    ) -> Dict[str, List[Slot]]:
        """
        Group slots by time window (morning, afternoon, evening).
        
        Args:
            slots: List of slot objects with 'start_time' in "HH:MM" format (Taiwan time)
            
        Returns:
            Dictionary mapping window names to lists of slots
        """
        slots_by_window: Dict[str, List[Slot]] = defaultdict(list)
        
        for slot in slots:
            # Parse "HH:MM" format time string (already in Taiwan time)
            try:
                slot_time = datetime.strptime(slot.start_time, '%H:%M').time()
            except ValueError:
                # Fallback: try parsing as ISO format if needed
                try:
                    slot_time = datetime.fromisoformat(slot.start_time).time()
                except ValueError:
                    logger.warning(f"Invalid time format: {slot.start_time}")
                    continue
            
            # Assign slot to appropriate time window
            # Note: Boundaries are handled so 12:00 belongs to afternoon, 18:00 belongs to evening
            for window_name, window_def in TIME_WINDOWS.items():
                # Use <= for start (inclusive) and < for end (exclusive)
                # This ensures 12:00 goes to afternoon, 18:00 goes to evening
                if window_def.start <= slot_time < window_def.end:
                    slots_by_window[window_name].append(slot)
                    break  # Slot belongs to exactly one window
        
        return slots_by_window

    @staticmethod
    def _should_send_notification(
        db: Session,
        notification: AvailabilityNotification,
        date: date,
        now: datetime,
        slots_by_window: Dict[str, List[Slot]],
        existing_appointment: Optional[Appointment] = None
    ) -> tuple[bool, Dict[str, List[Slot]]]:
        """
        Check if notification should be sent and get matching time windows with slots.
        
        Checks:
        - Expiration (don't send if notification is expired)
        - Rate limiting (don't send if notified in last hour)
        - Daily limit (max 3 notifications per user per day)
        - User already has appointment for this date
        - Requested time windows have available slots
        
        Args:
            db: Database session
            notification: Notification to check
            date: Date to check
            now: Current time
            slots_by_window: Available slots grouped by time window
            existing_appointment: Optional pre-fetched appointment for this patient/date
                (for optimization - avoids query if provided)
        
        Returns:
            Tuple of (should_send, matching_slots_by_window)
            If should_send is False, matching_slots_by_window will be empty
            The keys of matching_slots_by_window are the matching window names
        """
        # Check expiration
        if notification.expires_at <= now:
            return (False, {})
        
        # Rate limiting: Don't send if notified in last hour
        if notification.last_notified_at:
            time_since_notification = now - notification.last_notified_at
            if time_since_notification < timedelta(hours=1):
                return (False, {})
        
        # Daily limit: Max 3 notifications per user per day
        today_start = datetime.combine(now.date(), time(0, 0)).replace(tzinfo=TAIWAN_TZ)
        notifications_today = db.query(AvailabilityNotification).filter(
            AvailabilityNotification.line_user_id == notification.line_user_id,
            AvailabilityNotification.last_notified_at >= today_start,
            AvailabilityNotification.last_notified_at.isnot(None)
        ).count()
        
        if notifications_today >= 3:
            logger.debug(f"Daily limit reached for user {notification.line_user_id}")
            return (False, {})
        
        # Check if user already has appointment for this date
        # Use pre-fetched appointment if provided, otherwise query
        if existing_appointment is None:
            # Check if line_user has any appointment on this date (via Patient relationship)
            has_appointment = db.query(Appointment).join(CalendarEvent).join(Patient).filter(
                Patient.line_user_id == notification.line_user_id,
                Appointment.status == 'confirmed',
                CalendarEvent.date == date
            ).first()
        else:
            has_appointment = existing_appointment
        
        if has_appointment:
            # Cancel notification
            notification.status = 'fulfilled'
            db.commit()
            return (False, {})
        
        # Check if any requested time window has available slots
        matching_slots_by_window: Dict[str, List[Slot]] = {}
        for window_name in notification.time_windows:
            if window_name in slots_by_window and slots_by_window[window_name]:
                matching_slots_by_window[window_name] = slots_by_window[window_name]
        
        if not matching_slots_by_window:
            return (False, {})
        
        return (True, matching_slots_by_window)

    @staticmethod
    def _generate_liff_url(
        clinic_id: int,
        date: date,
        appointment_type_id: int,
        practitioner_id: Optional[int] = None,
        time_windows: Optional[List[str]] = None
    ) -> str:
        """
        Generate LIFF URL for booking with pre-filled parameters.
        
        Args:
            clinic_id: Clinic ID
            date: Date for booking
            appointment_type_id: Appointment type ID
            practitioner_id: Optional practitioner ID
            time_windows: Optional list of time window names
            
        Returns:
            LIFF URL string
        """
        if not LIFF_ID:
            logger.warning("LIFF_ID not configured, notification will not include booking URL")
            return ""
        
        params = {
            "clinic_id": str(clinic_id),
            "mode": "book",
            "date": date.isoformat(),
            "appointment_type_id": str(appointment_type_id)
        }
        
        if practitioner_id:
            params["practitioner_id"] = str(practitioner_id)
        
        if time_windows and len(time_windows) == 1:
            # If only one time window, include it in URL for filtering
            params["time_window"] = time_windows[0]
        
        query_string = "&".join(f"{k}={v}" for k, v in params.items())
        return f"https://liff.line.me/{LIFF_ID}?{query_string}"

    @staticmethod
    def _format_notification_message(
        date: date,
        matching_slots_by_window: Dict[str, List[Slot]],
        clinic_id: int,
        appointment_type_ids: List[int],
        practitioner_ids: List[int],
        current_appointment_type_id: int,
        current_practitioner_id: int
    ) -> str:
        """
        Format notification message for LINE with available slots and practitioner name.
        
        Args:
            date: Date of available slots
            matching_slots_by_window: Dictionary mapping window names to their available slots.
            clinic_id: Clinic ID for LIFF URL generation
            appointment_type_ids: List of all appointment type IDs in the notification
            practitioner_ids: List of practitioner IDs (empty means "不指定")
            current_appointment_type_id: The appointment type ID for which slots are available
            current_practitioner_id: The practitioner ID for which slots are available
            
        Returns:
            Formatted message string
        """
        # Format window displays (preserve order from dict keys)
        window_displays: List[str] = []
        window_names: List[str] = []
        for window_name in matching_slots_by_window.keys():
            if window_name in TIME_WINDOWS:
                window_displays.append(TIME_WINDOWS[window_name].display)
                window_names.append(window_name)
        window_display = "、".join(window_displays)
        
        # Format date
        formatted_date = format_datetime(datetime.combine(date, time(12, 0)))
        
        # Collect all available slots and format them
        all_slots: List[Slot] = []
        for slots in matching_slots_by_window.values():
            all_slots.extend(slots)
        
        # Sort slots by start time
        all_slots.sort(key=lambda s: s.start_time)
        
        # Extract practitioner name(s) from slots
        # Note: All slots should have the same practitioner_name since they come from
        # get_available_slots_for_practitioner which only returns slots for one practitioner.
        # We handle multiple names defensively, but this should never occur.
        practitioner_names: set[str] = set()
        for slot in all_slots:
            practitioner_names.add(slot.practitioner_name)
        
        # Format slots as time strings (e.g., "09:00", "10:30")
        slot_times: List[str] = [slot.start_time for slot in all_slots]
        
        # Build notification message
        message_parts = [
            f"【可用時段通知】",
            f"您關注的 {formatted_date} {window_display}時段 現在有可用預約！\n"
        ]
        
        # Add practitioner name if available
        # Defensive: Handle multiple practitioners even though logically there should only be one
        if practitioner_names:
            if len(practitioner_names) == 1:
                practitioner_display = list(practitioner_names)[0]
                message_parts.append(f"治療師：{practitioner_display}\n")
            elif len(practitioner_names) > 1:
                # Multiple practitioners (should never occur, but handled defensively)
                practitioner_display = "、".join(sorted(practitioner_names))
                message_parts.append(f"治療師：{practitioner_display}\n")
        
        if slot_times:
            # Group slots nicely (show up to 10 slots, then "...還有更多")
            display_slots = slot_times[:10]
            slots_display = "、".join(display_slots)
            if len(slot_times) > 10:
                slots_display += f" 等 {len(slot_times)} 個時段"
            message_parts.append(f"可用時段：{slots_display}\n")
        
        # Generate LIFF URL for booking (use current appointment type and practitioner)
        liff_url = AvailabilityNotificationService._generate_liff_url(
            clinic_id=clinic_id,
            date=date,
            appointment_type_id=current_appointment_type_id,
            practitioner_id=current_practitioner_id if current_practitioner_id else None,
            time_windows=window_names
        )
        
        if liff_url:
            message_parts.append(f"立即預約 → {liff_url}")
        else:
            message_parts.append("請透過選單中的預約系統進行預約。")
        
        return "\n".join(message_parts)

    @staticmethod
    def _send_notification_message(
        db: Session,
        notification: AvailabilityNotification,
        line_user: LineUser,
        line_service: LINEService,
        message: str,
        now: datetime
    ) -> bool:
        """
        Send notification message via LINE.
        
        Args:
            db: Database session
            notification: Notification to send
            line_user: LINE user to send to
            line_service: LINE service instance
            message: Message text to send
            now: Current time (for updating last_notified_at)
            
        Returns:
            True if sent successfully, False otherwise
        """
        try:
            line_service.send_text_message(line_user.line_user_id, message)
            
            # Update notification
            notification.last_notified_at = now
            db.commit()
            
            logger.info(f"Sent notification {notification.id} to LINE user {line_user.line_user_id}")
            return True
            
        except Exception as e:
            logger.exception(f"Failed to send notification {notification.id}: {e}")
            return False

    @staticmethod
    def check_and_notify(
        db: Session,
        clinic_id: int,
        date: date,
        practitioner_id: int
    ) -> int:
        """
        Check for available slots and send notifications to matching users.
        
        This is called when an appointment is cancelled or availability changes.
        It finds all active notifications matching the criteria (for all appointment types)
        and sends notifications if slots are available in the requested time windows.
        
        Note: practitioner_id is always required because CalendarEvent.user_id is
        always set (even with auto-assignment, a practitioner is assigned).
        
        Args:
            db: Database session
            clinic_id: Clinic ID
            date: Date to check
            practitioner_id: Practitioner ID (required - appointments always have a practitioner)
            
        Returns:
            Number of notifications sent
        """
        # Find matching notifications (for all appointment types)
        notifications = AvailabilityNotificationService._find_matching_notifications(
            db, clinic_id, date, practitioner_id
        )
        
        if not notifications:
            return 0
        
        # Get LINE service
        line_service = AvailabilityNotificationService._get_line_service(
            db, clinic_id
        )
        if not line_service:
            return 0
        
        # Collect all unique appointment_type_ids from all notifications
        all_appointment_type_ids = set()
        for notification in notifications:
            all_appointment_type_ids.update(notification.appointment_type_ids)
        
        # Batch fetch LINE users and appointments to optimize queries
        line_user_ids = list(set(n.line_user_id for n in notifications))
        
        # Batch fetch LINE users
        line_users = db.query(LineUser).filter(LineUser.id.in_(line_user_ids)).all()
        line_users_by_id = {u.id: u for u in line_users}
        
        # Batch fetch appointments for all line users on this date
        existing_appointments = db.query(Appointment).join(CalendarEvent).join(Patient).filter(
            Patient.line_user_id.in_(line_user_ids),
            Appointment.status == 'confirmed',
            CalendarEvent.date == date
        ).all()
        appointments_by_line_user = {a.patient.line_user_id: a for a in existing_appointments}
        
        # Process notifications: check availability for each appointment type
        notifications_sent = 0
        now = taiwan_now()
        date_str = date.isoformat()
        
        # Track which notifications we've already sent to avoid duplicates
        sent_notification_ids: set[int] = set()
        
        for appointment_type_id in all_appointment_type_ids:
            try:
                # Get available slots for this appointment type (already filtered by booking restrictions)
                filtered_slots = AvailabilityService.get_available_slots_for_practitioner(
                    db=db,
                    practitioner_id=practitioner_id,
                    date=date_str,
                    appointment_type_id=appointment_type_id,
                    clinic_id=clinic_id
                )
                
                # Group slots by time window
                slots_by_window = AvailabilityNotificationService._group_slots_by_time_window(
                    filtered_slots
                )
                
                # Process each notification that includes this appointment type
                for notification in notifications:
                    # Skip if already sent
                    if notification.id in sent_notification_ids:
                        continue
                    
                    # Skip if this notification doesn't include this appointment type
                    if appointment_type_id not in notification.appointment_type_ids:
                        continue
                    
                    # Check if notification should be sent (using batched appointment check)
                    should_send, matching_slots_by_window = AvailabilityNotificationService._should_send_notification(
                        db, notification, date, now, slots_by_window, appointments_by_line_user.get(notification.line_user_id)
                    )
                    
                    if not should_send:
                        continue
                    
                    # Get LINE user from batched lookup
                    line_user = line_users_by_id.get(notification.line_user_id)
                    
                    if not line_user:
                        logger.warning(f"LINE user {notification.line_user_id} not found")
                        continue
                    
                    # Format and send message (include all appointment types and practitioners)
                    message = AvailabilityNotificationService._format_notification_message(
                        date=date,
                        matching_slots_by_window=matching_slots_by_window,
                        clinic_id=clinic_id,
                        appointment_type_ids=notification.appointment_type_ids,
                        practitioner_ids=notification.practitioner_ids,
                        current_appointment_type_id=appointment_type_id,
                        current_practitioner_id=practitioner_id
                    )
                    
                    if AvailabilityNotificationService._send_notification_message(
                        db, notification, line_user, line_service, message, now
                    ):
                        notifications_sent += 1
                        sent_notification_ids.add(notification.id)
            except Exception as e:
                # Log error but continue processing other appointment types
                logger.exception(f"Error processing notifications for appointment_type {appointment_type_id}: {e}")
                continue
        
        return notifications_sent

    @staticmethod
    def cancel_on_appointment_creation(
        db: Session,
        line_user_id: int,
        date: date
    ) -> None:
        """
        Cancel notifications when user creates appointment for that date.
        
        Args:
            db: Database session
            line_user_id: LINE user ID
            date: Date of appointment
        """
        notifications = db.query(AvailabilityNotification).filter(
            AvailabilityNotification.line_user_id == line_user_id,
            AvailabilityNotification.date == date,
            AvailabilityNotification.status == 'active'
        ).all()
        
        for notification in notifications:
            notification.status = 'fulfilled'
        
        if notifications:
            db.commit()
            logger.info(f"Cancelled {len(notifications)} notifications for appointment on {date}")

    @staticmethod
    def list_notifications(
        db: Session,
        line_user_id: int,
        clinic_id: int,
        status: Optional[str] = 'active'
    ) -> List[NotificationListItem]:
        """
        List notifications for a LINE user.
        
        Args:
            db: Database session
            line_user_id: LINE user ID
            clinic_id: Clinic ID
            status: Optional status filter (default: 'active')
            
        Returns:
            List of notification items
        """
        query = db.query(AvailabilityNotification).filter(
            AvailabilityNotification.line_user_id == line_user_id,
            AvailabilityNotification.clinic_id == clinic_id
        )
        
        if status:
            query = query.filter(AvailabilityNotification.status == status)
        
        notifications = query.order_by(AvailabilityNotification.date).all()
        
        result: List[NotificationListItem] = []
        for notification in notifications:
            # Get appointment type names
            appointment_type_names: List[str] = []
            for appointment_type_id in notification.appointment_type_ids:
                appointment_type = db.query(AppointmentType).filter(
                    AppointmentType.id == appointment_type_id
                ).first()
                if appointment_type:
                    appointment_type_names.append(appointment_type.name)
            
            # Get practitioner names
            practitioner_names: List[str] = []
            if notification.practitioner_ids:
                for practitioner_id in notification.practitioner_ids:
                    association = db.query(UserClinicAssociation).filter(
                        UserClinicAssociation.user_id == practitioner_id,
                        UserClinicAssociation.clinic_id == clinic_id,
                        UserClinicAssociation.is_active == True
                    ).first()
                    if association:
                        practitioner_names.append(association.full_name)
            
            result.append(NotificationListItem(
                id=notification.id,
                date=notification.date.isoformat(),
                appointment_type_names=appointment_type_names if appointment_type_names else ["未知"],
                practitioner_names=practitioner_names,
                time_windows=notification.time_windows,
                expires_at=notification.expires_at.isoformat(),
                status=notification.status
            ))
        
        return result

