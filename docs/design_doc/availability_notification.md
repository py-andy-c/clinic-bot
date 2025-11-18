# Availability Notification Feature Design

## Overview
Allow LINE users to sign up for availability notifications when desired appointment slots become available. Users can set up notifications for specific appointment types, practitioners, and time windows, and receive proactive LINE messages when matching slots open up.

## User Experience

### Entry Points

1. **LIFF Home Page** (`LiffHome.tsx`)
   - Add new menu item: "空位提醒" (Availability Notifications)
   - Clicking navigates to notification management page (`mode=notifications`)

2. **Appointment Flow - Step 3** (`Step3SelectDateTime.tsx`)
   - Add button at bottom: "找不到合適時間？設定空位提醒"
   - Button redirects to "新增提醒" page with current selections pre-filled
   - Only visible when no slots are available OR user hasn't selected a time yet

### Notification Management Flow

**Main Page** (`mode=notifications`):
- Two tabs/sections:
  - "新增提醒" (Add Notification) - default view
  - "管理提醒" (Manage Notifications)

**Add Notification Page**:
- Pre-filled from appointment flow (if coming from Step 3):
  - Appointment type (required)
  - Practitioner (can be "不指定")
- User selects:
  - Time windows: 上午 (08:00-12:00), 下午 (12:00-18:00), 晚上 (18:00-22:00)
  - Date range: Up to 30 days from today
  - Multiple date + time window combinations (max 10 total)
- UI: Calendar view with time window checkboxes per day
- Validation: Max 10 windows, dates within 30 days, at least one window required

**Manage Notifications Page**:
- List all active notifications for the LINE user
- Display: Appointment type, practitioner (or "不指定"), time windows, date range
- Actions: Delete button for each notification
- Empty state: "目前沒有設定任何提醒"

### Edge Cases & UX Considerations

1. **No slots available**: Show helpful message with link to set up notification
2. **Notification limit**: Prevent creating more than 10 time windows per notification
3. **Date range**: Auto-disable dates beyond 30 days
4. **Expired notifications**: Auto-cleanup notifications past their date range
5. **Duplicate prevention**: Warn if identical notification already exists
6. **Appointment type deleted**: Handle gracefully (show "已刪除" or filter out)
7. **Practitioner removed**: Show "不指定" or filter out gracefully

## Technical Design

### Database Schema

**New Model**: `AvailabilityNotification`

```python
class AvailabilityNotification(Base):
    __tablename__ = "availability_notifications"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    line_user_id: Mapped[int] = mapped_column(ForeignKey("line_users.id"))
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id"))
    appointment_type_id: Mapped[int] = mapped_column(ForeignKey("appointment_types.id"))
    practitioner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    # NULL means "不指定" (any practitioner)
    
    # Store time windows as JSON: [{"date": "2024-01-15", "time_window": "morning"}, ...]
    time_windows: Mapped[List[Dict[str, str]]] = mapped_column(JSON)
    
    created_at: Mapped[datetime] = mapped_column(default=datetime.now(TAIWAN_TZ))
    is_active: Mapped[bool] = mapped_column(default=True)
    last_notified_date: Mapped[Optional[date]] = mapped_column(nullable=True)
    # Track last date notification was sent (for deduplication - one per day)
    
    # Relationships
    line_user: Mapped["LineUser"] = relationship()
    clinic: Mapped["Clinic"] = relationship()
    appointment_type: Mapped["AppointmentType"] = relationship()
    practitioner: Mapped[Optional["User"]] = relationship()
    
    # Indexes
    __table_args__ = (
        # Primary index for GET/POST endpoints: filter by line_user_id + clinic_id + is_active
        # Covers: GET notifications list, POST limit check
        # Order: line_user_id first (most selective), then clinic_id, then is_active
        # PostgreSQL can use left-prefix: queries filtering by (line_user_id) or (line_user_id, clinic_id) also benefit
        Index("idx_line_user_clinic_active", "line_user_id", "clinic_id", "is_active"),
    )
    
    # Index Analysis - Why other indexes are NOT needed:
    #
    # 1. idx_clinic_active: Scheduler query is `WHERE is_active = True` (gets ALL active notifications).
    #    No clinic filtering at DB level - grouping happens in Python. Index on boolean is low cardinality.
    #
    # 2. idx_active_clinic_type_practitioner: Grouping by (clinic_id, appointment_type_id, practitioner_id, date)
    #    happens in Python after fetching all active notifications. Not a SQL query pattern.
    #
    # 3. idx_active_clinic_line: Redundant with idx_line_user_clinic_active.
    #    line_user_id is more selective, so (line_user_id, clinic_id, is_active) is better.
    #
    # 4. idx_last_notified_date: Deduplication check (`last_notified_date == today`) happens in Python
    #    on already-filtered eligible_notifications list. Not a SQL WHERE clause.
    #
    # 5. idx_line_user_active: Covered by idx_line_user_clinic_active via left-prefix rule.
    #
    # Note: DELETE endpoint uses primary key (id) which is automatically indexed.
```

**Time Window Format**:
```python
[
    {"date": "2024-01-15", "time_window": "morning"},    # 上午 08:00-12:00
    {"date": "2024-01-15", "time_window": "afternoon"},  # 下午 12:00-18:00
    {"date": "2024-01-15", "time_window": "evening"},    # 晚上 18:00-22:00
    {"date": "2024-01-16", "time_window": "morning"},
]
```

### API Endpoints

**LIFF Endpoints** (`/liff/availability-notifications`):

**Request/Response Models**:
```python
from pydantic import BaseModel, field_validator
from typing import List, Optional, Literal
from datetime import date, datetime

class TimeWindowEntry(BaseModel):
    """Single time window entry."""
    date: str  # YYYY-MM-DD format
    time_window: Literal["morning", "afternoon", "evening"]
    
    @field_validator('date')
    @classmethod
    def validate_date_format(cls, v):
        try:
            datetime.strptime(v, '%Y-%m-%d').date()
        except ValueError:
            raise ValueError('日期格式錯誤，請使用 YYYY-MM-DD 格式')
        return v

class AvailabilityNotificationCreateRequest(BaseModel):
    """Request model for creating availability notification."""
    appointment_type_id: int
    practitioner_id: Optional[int] = None  # null for "不指定"
    time_windows: List[TimeWindowEntry]
    
    @field_validator('time_windows')
    @classmethod
    def validate_time_windows(cls, v):
        if len(v) > 10:
            raise ValueError('最多只能設定10個時段')
        if len(v) == 0:
            raise ValueError('至少需要設定1個時段')
        
        # Validate dates are within 30 days
        from utils.datetime_utils import taiwan_now
        from datetime import timedelta
        from core.constants import NOTIFICATION_DATE_RANGE_DAYS
        
        today = taiwan_now().date()
        max_date = today + timedelta(days=NOTIFICATION_DATE_RANGE_DAYS)
        
        for tw in v:
            tw_date = datetime.strptime(tw.date, '%Y-%m-%d').date()
            if tw_date < today:
                raise ValueError(f'日期 {tw.date} 不能是過去日期')
            if tw_date > max_date:
                raise ValueError(f'日期 {tw.date} 不能超過30天後')
        
        return v

class AvailabilityNotificationResponse(BaseModel):
    """Response model for single notification."""
    id: int
    appointment_type_id: int
    appointment_type_name: str
    practitioner_id: Optional[int]
    practitioner_name: Optional[str]  # "不指定" if None
    time_windows: List[Dict[str, str]]
    created_at: datetime
    min_date: str  # YYYY-MM-DD
    max_date: str  # YYYY-MM-DD

class AvailabilityNotificationListResponse(BaseModel):
    """Response model for notification list."""
    notifications: List[AvailabilityNotificationResponse]
    total: int
    page: int
    page_size: int

class ErrorResponse(BaseModel):
    """Standard error response format."""
    error: str
    message: str
    details: Optional[Dict[str, Any]] = None
```

1. `POST /liff/availability-notifications`
   - Create new notification
   - **Authorization**: Uses `get_current_line_user_with_clinic` dependency
   - **Security**: `clinic_id` is extracted from JWT token (not from request body)
   - Request:
     ```json
     {
       "appointment_type_id": 1,
       "practitioner_id": 2,  // null for "不指定"
       "time_windows": [
         {"date": "2024-01-15", "time_window": "morning"},
         {"date": "2024-01-15", "time_window": "afternoon"}
       ]
     }
     ```
   - Validation:
     - Max 10 time windows per notification
     - Max 10 active notifications per user (configurable)
     - Dates within 30 days from today
     - Appointment type exists and not deleted
     - Practitioner exists (if specified)
     - Check for duplicates (warn but allow)
   - Response: `AvailabilityNotificationResponse`
   - Error Responses:
     - `400 Bad Request`: Validation errors (max limits, invalid dates, etc.)
     - `404 Not Found`: Appointment type or practitioner not found
     - `403 Forbidden`: User limit reached
   - Implementation:
     ```python
     @router.post("/liff/availability-notifications", response_model=AvailabilityNotificationResponse)
     async def create_notification(
         request: AvailabilityNotificationCreateRequest,
         line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
         db: Session = Depends(get_db)
     ):
         line_user, clinic = line_user_clinic
         
         # Check user notification limit
         active_count = db.query(AvailabilityNotification).filter(
             AvailabilityNotification.line_user_id == line_user.id,
             AvailabilityNotification.clinic_id == clinic.id,
             AvailabilityNotification.is_active == True
         ).count()
         
         if active_count >= MAX_NOTIFICATIONS_PER_USER:
             raise HTTPException(
                 status_code=403,
                 detail=f"已達到提醒上限（{MAX_NOTIFICATIONS_PER_USER}個），請先刪除現有提醒"
             )
         
         # Validate appointment type exists
         appointment_type = db.query(AppointmentType).filter(
             AppointmentType.id == request.appointment_type_id,
             AppointmentType.clinic_id == clinic.id,
             AppointmentType.is_deleted == False
         ).first()
         
         if not appointment_type:
             raise HTTPException(404, "預約類型不存在")
         
         # Validate practitioner if specified
         if request.practitioner_id:
             practitioner = db.query(User).join(UserClinicAssociation).filter(
                 User.id == request.practitioner_id,
                 UserClinicAssociation.clinic_id == clinic.id,
                 UserClinicAssociation.is_active == True
             ).first()
             
             if not practitioner:
                 raise HTTPException(404, "治療師不存在")
         
         # Create notification (clinic_id from JWT token, not request)
         notification = AvailabilityNotification(
             line_user_id=line_user.id,
             clinic_id=clinic.id,  # From JWT token
             appointment_type_id=request.appointment_type_id,
             practitioner_id=request.practitioner_id,
             time_windows=[tw.model_dump() for tw in request.time_windows],
             is_active=True
         )
         
        db.add(notification)
        db.commit()
        db.refresh(notification)
        
        # Calculate min/max dates from time_windows
        dates = [tw["date"] for tw in notification.time_windows]
        
        return AvailabilityNotificationResponse(
            id=notification.id,
            appointment_type_id=notification.appointment_type_id,
            appointment_type_name=appointment_type.name,
            practitioner_id=notification.practitioner_id,
            practitioner_name=notification.practitioner.full_name if notification.practitioner else None,
            time_windows=notification.time_windows,
            created_at=notification.created_at,
            min_date=min(dates),
            max_date=max(dates)
        )
     ```

2. `GET /liff/availability-notifications`
   - List all active notifications for LINE user
   - **Authorization**: Uses `get_current_line_user_with_clinic` dependency
   - **Security**: Only returns notifications for current clinic (from JWT token)
   - Query Parameters:
     - `page`: int (default: 1, min: 1)
     - `page_size`: int (default: 20, min: 1, max: 100)
   - Response: `AvailabilityNotificationListResponse` with pagination
   - Implementation:
     ```python
     @router.get("/liff/availability-notifications", response_model=AvailabilityNotificationListResponse)
     async def list_notifications(
         page: int = Query(1, ge=1),
         page_size: int = Query(20, ge=1, le=100),
         line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
         db: Session = Depends(get_db)
     ):
         line_user, clinic = line_user_clinic
         
         query = db.query(AvailabilityNotification).filter(
             AvailabilityNotification.line_user_id == line_user.id,
             AvailabilityNotification.clinic_id == clinic.id,  # Clinic isolation
             AvailabilityNotification.is_active == True
         )
         
         total = query.count()
         notifications = query.order_by(
             AvailabilityNotification.created_at.desc()
         ).offset((page - 1) * page_size).limit(page_size).all()
         
         return AvailabilityNotificationListResponse(
             notifications=[...],
             total=total,
             page=page,
             page_size=page_size
         )
     ```

3. `DELETE /liff/availability-notifications/{notification_id}`
   - Delete notification (soft delete: set `is_active=False`)
   - **Authorization**: Uses `get_current_line_user_with_clinic` dependency
   - **Security**: Explicit check that user owns the notification
   - Response: `{"success": true, "message": "提醒已刪除"}`
   - Error Responses:
     - `404 Not Found`: Notification not found
     - `403 Forbidden`: User doesn't own this notification
   - Implementation:
     ```python
     @router.delete("/liff/availability-notifications/{notification_id}")
     async def delete_notification(
         notification_id: int,
         line_user_clinic: tuple[LineUser, Clinic] = Depends(get_current_line_user_with_clinic),
         db: Session = Depends(get_db)
     ):
         line_user, clinic = line_user_clinic
         
         notification = db.query(AvailabilityNotification).filter(
             AvailabilityNotification.id == notification_id,
             AvailabilityNotification.clinic_id == clinic.id,  # Clinic isolation
             AvailabilityNotification.is_active == True
         ).first()
         
         if not notification:
             raise HTTPException(404, "提醒不存在")
         
         # Authorization check: user must own the notification
         if notification.line_user_id != line_user.id:
             raise HTTPException(403, "無權限刪除此提醒")
         
         # Soft delete
         notification.is_active = False
         db.commit()
         
         return {"success": True, "message": "提醒已刪除"}
     ```

### Notification Service

**New Service**: `AvailabilityNotificationService`

**Scheduled Job**:
- Runs at 9:00 AM, 3:00 PM, 9:00 PM Taiwan time (3 times daily)
- Uses `AsyncIOScheduler` with `CronTrigger` (similar to `ReminderService`)
- Job: `_check_and_send_notifications()`

**Pseudo Code**:

```python
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Any
from sqlalchemy.orm import Session, joinedload

class AvailabilityNotificationService:
    def __init__(self):
        self.scheduler = AsyncIOScheduler(timezone=TAIWAN_TZ)
        self._is_started = False
    
    async def start_scheduler(self):
        """Start the notification scheduler."""
        if self._is_started:
            return
        
        # Schedule job to run at 9am, 3pm, 9pm Taiwan time
        from core.constants import NOTIFICATION_CHECK_HOURS
        
        self.scheduler.add_job(
            self._check_and_send_notifications,
            CronTrigger(hour=",".join(map(str, NOTIFICATION_CHECK_HOURS))),  # 9am, 3pm, 9pm
            id="send_availability_notifications",
            name="Send availability notifications",
            max_instances=1,
            replace_existing=True
        )
        
        self.scheduler.start()
        self._is_started = True
        logger.info("Availability notification scheduler started")
        
        # Run notification check immediately on startup to catch up on missed notifications
        # during downtime. Deduplication prevents sending duplicate notifications.
        await self._check_and_send_notifications()
    
    async def stop_scheduler(self):
        """Stop the notification scheduler."""
        if not self._is_started:
            return
        
        self.scheduler.shutdown(wait=True)
        self._is_started = False
        logger.info("Availability notification scheduler stopped")
    
    async def _check_and_send_notifications(self):
        """
        Main job function: Check all active notifications and send alerts.
        
        Called by scheduler at 9am, 3pm, 9pm Taiwan time.
        
        Performance optimization: Groups notifications by (clinic_id, appointment_type_id, 
        practitioner_id, date) to avoid redundant availability queries.
        """
        # Use fresh database session for each run
        with get_db_context() as db:
            try:
                logger.info("Checking availability notifications...")
                
                today = taiwan_now().date()
                total_notifications_checked = 0
                total_notifications_sent = 0
                total_errors = 0
                
                # 1. Fetch all active notifications with relationships pre-loaded
                active_notifications = db.query(AvailabilityNotification).filter(
                    AvailabilityNotification.is_active == True
                ).options(
                    # Pre-load relationships to avoid N+1 queries
                    joinedload(AvailabilityNotification.appointment_type),
                    joinedload(AvailabilityNotification.practitioner, innerjoin=False),  # Optional relationship
                    joinedload(AvailabilityNotification.clinic),
                    joinedload(AvailabilityNotification.line_user)
                ).all()
                
                logger.info(f"Found {len(active_notifications)} active notifications")
                
                # 2. Filter and group notifications for efficient processing
                eligible_notifications = []
                for notification in active_notifications:
                    # 2a. Check deduplication: Skip if already notified today
                    if notification.last_notified_date == today:
                        logger.debug(
                            f"Skipping notification {notification.id}: "
                            f"already notified today ({today})"
                        )
                        continue
                    
                    # 2b. Check if notification has any future dates
                    has_future_dates = False
                    for time_window_entry in notification.time_windows:
                        window_date = datetime.strptime(
                            time_window_entry["date"], 
                            "%Y-%m-%d"
                        ).date()
                        if window_date >= today:
                            has_future_dates = True
                            break
                    
                    if not has_future_dates:
                        logger.debug(
                            f"Skipping notification {notification.id}: "
                            f"all dates are in the past"
                        )
                        continue
                    
                    eligible_notifications.append(notification)
                
                if not eligible_notifications:
                    logger.info("No eligible notifications to process")
                    return
                
                # 3. Group notifications by (clinic_id, appointment_type_id, practitioner_id, date)
                # This allows us to check availability once per unique combination
                availability_cache = {}  # {(clinic_id, appointment_type_id, practitioner_id, date): slots_data}
                
                # 4. Collect all unique availability queries needed
                availability_queries = {}  # {(clinic_id, appointment_type_id, practitioner_id, date): [notification_ids]}
                
                for notification in eligible_notifications:
                    total_notifications_checked += 1
                    
                    # Extract unique date + (clinic, type, practitioner) combinations
                    for time_window_entry in notification.time_windows:
                        date_str = time_window_entry["date"]
                        window_date = datetime.strptime(date_str, "%Y-%m-%d").date()
                        
                        if window_date < today:
                            continue
                        
                        # Create cache key: (clinic_id, appointment_type_id, practitioner_id, date)
                        # practitioner_id can be None for "不指定"
                        cache_key = (
                            notification.clinic_id,
                            notification.appointment_type_id,
                            notification.practitioner_id,  # None for "不指定"
                            date_str
                        )
                        
                        if cache_key not in availability_queries:
                            availability_queries[cache_key] = []
                        availability_queries[cache_key].append(notification.id)
                
                logger.info(
                    f"Need to check {len(availability_queries)} unique availability queries "
                    f"for {len(eligible_notifications)} notifications"
                )
                
                # 5. Batch fetch availability for all unique combinations
                for cache_key, notification_ids in availability_queries.items():
                    clinic_id, appointment_type_id, practitioner_id, date_str = cache_key
                    
                    try:
                        # Check availability once per unique combination
                        if practitioner_id:
                            slots_data = AvailabilityService.get_available_slots_for_practitioner(
                                db=db,
                                practitioner_id=practitioner_id,
                                date=date_str,
                                appointment_type_id=appointment_type_id,
                                clinic_id=clinic_id
                            )
                        else:
                            slots_data = AvailabilityService.get_available_slots_for_clinic(
                                db=db,
                                clinic_id=clinic_id,
                                date=date_str,
                                appointment_type_id=appointment_type_id
                            )
                        
                        # Cache results
                        availability_cache[cache_key] = slots_data
                    
                    except Exception as e:
                        logger.error(
                            f"Error checking availability for cache_key {cache_key}: {e}"
                        )
                        # Continue with other queries
                        continue
                
                # 6. Process each notification using cached availability data
                for notification in eligible_notifications:
                    try:
                        # Collect slots for this notification using cached data
                        slots_by_date = self._collect_available_slots_from_cache(
                            notification, today, availability_cache
                        )
                        
                        # If slots found, send notification
                        if slots_by_date:
                            success = await self._send_notification(
                                db, notification, slots_by_date
                            )
                            
                            if success:
                                total_notifications_sent += 1
                                # Update last_notified_date after successful send
                                # Commit immediately to ensure atomicity.
                                # Trade-off: Slower but safer - if process crashes,
                                # only current notification might be lost, not entire batch.
                                notification.last_notified_date = today
                                db.commit()
                                logger.info(
                                    f"Sent notification {notification.id} "
                                    f"to LINE user {notification.line_user_id}"
                                )
                            else:
                                total_errors += 1
                                logger.error(
                                    f"Failed to send notification {notification.id}"
                                )
                        else:
                            logger.debug(
                                f"No slots found for notification {notification.id}"
                            )
                    
                    except Exception as e:
                        total_errors += 1
                        logger.exception(
                            f"Error processing notification {notification.id}: {e}"
                        )
                        # Continue processing other notifications
                        continue
                
                logger.info(
                    f"Notification check complete: "
                    f"checked={total_notifications_checked}, "
                    f"sent={total_notifications_sent}, "
                    f"errors={total_errors}, "
                    f"availability_queries={len(availability_queries)}"
                )
            
            except Exception as e:
                logger.exception(f"Error in notification scheduler: {e}")
    
    def _collect_available_slots_from_cache(
        self, 
        notification: AvailabilityNotification,
        today: date,
        availability_cache: Dict[tuple, List[Dict[str, Any]]]
    ) -> Dict[str, List[str]]:
        """
        Collect all available slots for a notification using cached availability data.
        
        This method uses pre-fetched availability data to avoid redundant queries.
        
        Args:
            notification: The notification to process
            today: Today's date for filtering
            availability_cache: Pre-fetched availability data keyed by 
                               (clinic_id, appointment_type_id, practitioner_id, date_str)
        
        Returns:
            Dict mapping date strings to list of slot time strings
            Example: {"2024-01-15": ["09:00", "10:00", "14:00"], ...}
        """
        slots_by_date = {}
        
        # Group time windows by date
        date_windows = {}  # {date_str: [time_window, ...]}
        
        for time_window_entry in notification.time_windows:
            date_str = time_window_entry["date"]
            time_window = time_window_entry["time_window"]
            
            # Skip past dates
            window_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            if window_date < today:
                continue
            
            if date_str not in date_windows:
                date_windows[date_str] = []
            date_windows[date_str].append(time_window)
        
        # Use cached availability data for each date
        for date_str, time_windows in date_windows.items():
            # Create cache key
            cache_key = (
                notification.clinic_id,
                notification.appointment_type_id,
                notification.practitioner_id,  # None for "不指定"
                date_str
            )
            
            # Get slots from cache (should exist if we did the batch query correctly)
            slots_data = availability_cache.get(cache_key)
            
            if not slots_data:
                # This shouldn't happen if batch query worked, but handle gracefully
                logger.warning(
                    f"No cached availability for notification {notification.id}, "
                    f"cache_key {cache_key}"
                )
                continue
            
            # Filter slots by time windows for this date
            matching_slots = []
            for time_window in time_windows:
                filtered_slots = self._filter_slots_by_time_window(
                    slots_data, time_window
                )
                # Extract just the start_time strings
                for slot in filtered_slots:
                    slot_time = slot['start_time']  # e.g., "09:00"
                    if slot_time not in matching_slots:
                        matching_slots.append(slot_time)
            
            if matching_slots:
                # Sort slots by time
                matching_slots.sort()
                slots_by_date[date_str] = matching_slots
        
        return slots_by_date
    
    def _filter_slots_by_time_window(
        self, 
        slots: List[Dict[str, Any]], 
        time_window: str
    ) -> List[Dict[str, Any]]:
        """
        Filter slots by time window (morning/afternoon/evening).
        
        Args:
            slots: List of slot dicts with 'start_time' field
            time_window: "morning", "afternoon", or "evening"
        
        Returns:
            Filtered list of slots within the time window
        """
        window_ranges = {
            "morning": (8, 12),      # 08:00-12:00
            "afternoon": (12, 18),   # 12:00-18:00
            "evening": (18, 22),     # 18:00-22:00
        }
        
        start_hour, end_hour = window_ranges[time_window]
        filtered = []
        
        for slot in slots:
            # Parse start_time (format: "HH:MM" or "HH:MM:SS")
            start_time_str = slot['start_time']
            hour, minute = map(int, start_time_str.split(':')[:2])
            
            # Check if slot is within time window
            if start_hour <= hour < end_hour:
                filtered.append(slot)
        
        return filtered
    
    async def _send_notification(
        self,
        db: Session,
        notification: AvailabilityNotification,
        slots_by_date: Dict[str, List[str]]
    ) -> bool:
        """
        Send LINE notification message with batched slots.
        
        Returns:
            True if sent successfully, False otherwise
        """
        try:
            # Get clinic for LINE service credentials
            clinic = db.query(Clinic).get(notification.clinic_id)
            if not clinic or not clinic.line_channel_secret or not clinic.line_channel_access_token:
                logger.error(f"Clinic {notification.clinic_id} missing LINE credentials")
                return False
            
            # Get LINE user
            line_user = db.query(LineUser).get(notification.line_user_id)
            if not line_user:
                logger.error(f"LINE user {notification.line_user_id} not found")
                return False
            
            # Format message
            message = self._format_notification_message(
                notification, slots_by_date, clinic
            )
            
            # Send LINE message
            line_service = LINEService(
                channel_secret=clinic.line_channel_secret,
                channel_access_token=clinic.line_channel_access_token
            )
            
            line_service.send_text_message(
                line_user_id=line_user.line_user_id,
                text=message
            )
            
            return True
        
        except Exception as e:
            logger.exception(f"Error sending notification: {e}")
            return False
    
    def _format_notification_message(
        self,
        notification: AvailabilityNotification,
        slots_by_date: Dict[str, List[str]],
        clinic: Clinic
    ) -> str:
        """
        Format batched notification message.
        
        Example output:
        【空位提醒】您關注的預約時段有新的空位了！
        
        預約類型：物理治療
        治療師：不指定
        
        可用時間：
        01/15 (一): 09:00 AM, 10:00 AM, 02:00 PM
        01/16 (二): 09:00 AM, 11:00 AM
        
        立即預約：{liff_url}
        """
        # Get appointment type name (with null check)
        if not notification.appointment_type:
            logger.error(f"Notification {notification.id} has deleted appointment type")
            return ""  # Return empty string if appointment type deleted
        
        appointment_type_name = notification.appointment_type.name
        
        # Get practitioner name
        if notification.practitioner:
            practitioner_name = notification.practitioner.full_name
        else:
            practitioner_name = "不指定"
        
        # Format slots by date
        slots_lines = []
        for date_str in sorted(slots_by_date.keys()):
            date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
            
            # Format date: "01/15 (一)"
            formatted_date = self._format_date_for_display(date_obj)
            
            # Format slots: "09:00 AM, 10:00 AM, 02:00 PM"
            formatted_slots = self._format_slots(slots_by_date[date_str])
            
            slots_lines.append(f"{formatted_date}: {formatted_slots}")
        
        # Generate LIFF URL with pre-filled parameters
        liff_url = self._generate_liff_url(notification, clinic)
        
        # Build message
        message = f"""【空位提醒】您關注的預約時段有新的空位了！

預約類型：{appointment_type_name}
治療師：{practitioner_name}

可用時間：
{chr(10).join(slots_lines)}

立即預約：{liff_url}"""
        
        return message
    
    def _format_date_for_display(self, date_obj: date) -> str:
        """Format date as 'MM/DD (weekday)'."""
        weekday_map = {
            0: '一', 1: '二', 2: '三', 3: '四', 
            4: '五', 5: '六', 6: '日'
        }
        weekday_cn = weekday_map[date_obj.weekday()]
        return f"{date_obj.strftime('%m/%d')} ({weekday_cn})"
    
    def _format_slots(self, slots: List[str]) -> str:
        """Format slot times as '09:00 AM, 10:00 AM, 02:00 PM'."""
        formatted = []
        for slot_time in slots:
            # Parse "09:00" or "09:00:00"
            hour, minute = map(int, slot_time.split(':')[:2])
            
            # Convert to 12-hour format
            if hour == 0:
                hour_12 = 12
                period = 'AM'
            elif hour < 12:
                hour_12 = hour
                period = 'AM'
            elif hour == 12:
                hour_12 = 12
                period = 'PM'
            else:
                hour_12 = hour - 12
                period = 'PM'
            
            formatted.append(f"{hour_12}:{minute:02d} {period}")
        
        return ", ".join(formatted)
    
    def _generate_liff_url(
        self, 
        notification: AvailabilityNotification,
        clinic: Clinic
    ) -> str:
        """
        Generate LIFF URL with pre-filled appointment parameters.
        
        Example: https://liff.line.me/{liff_id}?mode=book&appointment_type_id=1&practitioner_id=2
        """
        if not clinic.liff_id:
            logger.error(f"Clinic {clinic.id} missing LIFF ID")
            return ""  # Return empty string if LIFF ID missing
        
        base_url = f"https://liff.line.me/{clinic.liff_id}"
        params = {
            "mode": "book",
            "appointment_type_id": notification.appointment_type_id
        }
        
        if notification.practitioner_id:
            params["practitioner_id"] = notification.practitioner_id
        
        query_string = "&".join([f"{k}={v}" for k, v in params.items()])
        return f"{base_url}?{query_string}"
```


### Frontend Components

**New Components**:

1. `AvailabilityNotificationFlow.tsx` - Main container (similar to `AppointmentFlow.tsx`)
   - Tabs: "新增提醒" and "管理提醒"

2. `AddNotificationForm.tsx` - Add notification form
   - Pre-fill from appointment store (if available)
   - Calendar with time window selection
   - Date range picker (max 30 days)
   - Validation and submission

3. `ManageNotifications.tsx` - List and delete notifications
   - Display notifications in cards
   - Delete functionality

4. **Integration in `Step3SelectDateTime.tsx`**:
   - Add button: "找不到合適時間？設定空位提醒"
   - Navigate to add notification with current selections

**Routing**:
- Add `mode=notifications` to `LiffApp.tsx`
- Update `LiffHome.tsx` with new menu item

### Cleanup & Maintenance

1. **Auto-cleanup expired notifications**:
   - Daily job at 3 AM Taiwan time (reuse existing cleanup scheduler pattern)
   - Set `is_active=False` for notifications where all dates are in the past
   - Implementation:
     ```python
     async def cleanup_expired_notifications(self):
         """Set is_active=False for notifications where all dates are in the past."""
         with get_db_context() as db:
             try:
                 today = taiwan_now().date()
                 
                 # Get all active notifications
                 active_notifications = db.query(AvailabilityNotification).filter(
                     AvailabilityNotification.is_active == True
                 ).all()
                 
                 expired_count = 0
                 for notification in active_notifications:
                     # Check if all dates are in the past
                     all_past = True
                     for time_window_entry in notification.time_windows:
                         window_date = datetime.strptime(
                             time_window_entry["date"], 
                             "%Y-%m-%d"
                         ).date()
                         if window_date >= today:
                             all_past = False
                             break
                     
                     if all_past:
                         notification.is_active = False
                         expired_count += 1
                 
                 if expired_count > 0:
                     db.commit()
                     logger.info(f"Cleaned up {expired_count} expired notifications")
             except Exception as e:
                 logger.exception(f"Error during notification cleanup: {e}")
     ```
   - Schedule in `AvailabilityNotificationService`:
     ```python
     # In start_scheduler():
        from core.constants import NOTIFICATION_CLEANUP_HOUR
        
        self.scheduler.add_job(
            self.cleanup_expired_notifications,
            CronTrigger(hour=NOTIFICATION_CLEANUP_HOUR, minute=0),  # 3 AM Taiwan time
         id="cleanup_expired_notifications",
         name="Cleanup expired availability notifications",
         max_instances=1,
         replace_existing=True
     )
     ```

2. **Notification deduplication tracking**:
   - See "Deduplication Strategy" section below

### Error Handling

1. **API errors**: Show user-friendly messages
2. **Notification send failures**: Log errors, don't block other notifications
3. **Deleted appointment types**: Filter out or mark as inactive
4. **LINE API failures**: Retry logic (use existing LINE service error handling)

## Implementation Plan

### Phase 0: Setup & Configuration
1. Add constants to `core/constants.py`:
   ```python
   MAX_TIME_WINDOWS_PER_NOTIFICATION = 10
   MAX_NOTIFICATIONS_PER_USER = 10
   NOTIFICATION_DATE_RANGE_DAYS = 30
   NOTIFICATION_CHECK_HOURS = [9, 15, 21]  # 9am, 3pm, 9pm
   NOTIFICATION_CLEANUP_HOUR = 3  # 3 AM
   ```
2. Set up monitoring/metrics infrastructure
3. Create feature flag (if needed for gradual rollout)

### Phase 1: Backend Foundation
1. Create `AvailabilityNotification` model with:
   - All fields including `last_notified_date`
   - Proper indexes (see Database Schema section)
   - Foreign key constraints with appropriate `ondelete` behavior
2. Create database migration
3. Implement `AvailabilityNotificationService` with:
   - Scheduler setup
   - Cleanup job
   - Notification checking logic
   - Service lifecycle functions (`start_availability_notification_scheduler`, `stop_availability_notification_scheduler`)
4. Add LIFF API endpoints with:
   - Pydantic validation models (see API Endpoints section)
   - Authorization checks (clinic_id from JWT, user ownership)
   - Pagination support
   - Error handling
   - User limit validation
5. Integrate service lifecycle into `main.py`:
   ```python
   # In lifespan context manager:
   try:
       await start_availability_notification_scheduler()
       logger.info("✅ Availability notification scheduler started")
   except Exception as e:
       logger.exception(f"❌ Failed to start availability notification scheduler: {e}")
   
   # In shutdown:
   try:
       await stop_availability_notification_scheduler()
       logger.info("🛑 Availability notification scheduler stopped")
   except Exception as e:
       logger.exception(f"❌ Error stopping availability notification scheduler: {e}")
   ```
6. Add unit tests:
   - Time window filtering logic
   - Message formatting
   - URL generation
   - Deduplication logic
   - Validation logic

### Phase 2: Notification Scheduler
1. Implement scheduled job (9am, 3pm, 9pm)
2. Integrate with `AvailabilityService`
3. Implement batched notification sending logic (collect all slots, send one message per notification)
4. Add deduplication logic (Option 1: one per day)
5. Add transaction management (ensure atomicity of `last_notified_date` updates)
6. Add integration tests:
   - End-to-end notification creation → scheduling → sending
   - Multiple notifications for same slot (deduplication)
   - Notification with expired dates
   - Cross-clinic isolation
   - Error recovery scenarios

### Phase 3: Frontend
1. Add "空位提醒" menu item to LIFF home
2. Create notification management pages:
   - Add notification form with calendar UI
   - Manage notifications list with pagination
   - Loading states and error handling
3. Add button to Step 3 appointment flow:
   - Show when no slots available or user hasn't selected time
   - Pre-fill via URL parameters: `?mode=notifications&action=add&appointment_type_id=X&practitioner_id=Y`
4. Implement add/manage UI:
   - Calendar with time window selection
   - Form validation with user-friendly messages
   - Delete confirmation
5. Add navigation and routing
6. Add analytics tracking (notification creation, clicks, etc.)

### Phase 4: Polish & Testing
1. Add cleanup job for expired notifications (already in Phase 1)
2. Handle edge cases:
   - Deleted appointment types (auto-deactivate notifications)
   - Deleted practitioners (set to "不指定" or deactivate)
   - Clinic closure (handle gracefully)
3. End-to-end testing:
   - Full user flow from appointment booking to notification receipt
   - Multi-clinic user scenarios
   - Error scenarios
4. Performance optimization:
   - Load testing with 1000+ notifications
   - Query optimization
   - Monitoring and alerting setup
5. Documentation:
   - API documentation
   - User guide
   - Admin guide

## Deduplication Strategy

### Problem
Without deduplication, users could receive multiple notifications for the same available slots:
- Check at 9am: Slots available → notify
- Check at 3pm: Same slots still available → notify again (spam)
- Check at 9pm: Same slots still available → notify again (more spam)

### Options

**Option 1: Simple - One notification per day** (RECOMMENDED)
- Track `last_notified_date` per notification (single date field)
- Only send notification if we haven't sent one today for this notification
- Pros: Very simple, prevents spam, easy to implement
- Cons: Won't notify if slots change during the day (but slots rarely change that frequently)
- Implementation: Add `last_notified_date: Optional[date]` field to model

**Option 2: Track per date+window**
- Track `last_notified_at` JSON field: `{"2024-01-15_morning": "2024-01-15T09:00:00", ...}`
- Only send if we haven't notified for this specific date+window today
- Pros: More granular, can notify if different windows become available
- Cons: More complex, requires JSON field management

**Option 3: Track slot changes**
- Store last sent slots per date+window: `{"2024-01-15_morning": ["09:00", "10:00"], ...}`
- Only send if slots changed (new slots appeared or old ones disappeared)
- Pros: Most accurate, only notifies on actual changes
- Cons: Most complex, requires slot comparison logic, storage overhead

**Option 4: No deduplication**
- Send notification every time slots are found
- Pros: Simplest implementation
- Cons: High spam potential (3 notifications per day for same slots)

### Recommendation: Option 1 (Simple - One per day)

**Rationale**:
- Appointment slots don't change frequently during a day
- Users checking notifications 3x/day is sufficient
- Simple to implement and maintain
- Easy to understand and debug
- Can always upgrade to Option 2 later if needed

**Implementation**:
```python
class AvailabilityNotification(Base):
    # ... existing fields ...
    last_notified_date: Mapped[Optional[date]] = mapped_column(nullable=True)
    # Track last date we sent notification (not timestamp, just date)
```

**Logic**:
```python
def should_send_notification(notification: AvailabilityNotification, check_date: date) -> bool:
    """Check if we should send notification for this date."""
    # Only send if we haven't sent one today
    return notification.last_notified_date != check_date
```

**Update after sending**:
```python
notification.last_notified_date = taiwan_now().date()
db.commit()
```

**Note**: Batching logic is implemented in `_collect_available_slots_from_cache()` and `_format_notification_message()` methods above. See pseudo code section for details.

This approach is **simple, effective, and worth implementing**. The complexity of Options 2-3 doesn't provide enough value for the use case.

## Constants & Configuration

**Add to `backend/src/core/constants.py`**:
```python
# Availability Notification Limits
MAX_TIME_WINDOWS_PER_NOTIFICATION = 10
MAX_NOTIFICATIONS_PER_USER = 10
NOTIFICATION_DATE_RANGE_DAYS = 30

# Notification Check Times (Taiwan time)
NOTIFICATION_CHECK_HOURS = [9, 15, 21]  # 9am, 3pm, 9pm
NOTIFICATION_CLEANUP_HOUR = 3  # 3 AM
```

## Monitoring & Observability

### Metrics to Track
- `availability_notifications.active_count`: Number of active notifications
- `availability_notifications.sent_total`: Total notifications sent
- `availability_notifications.sent_success`: Successful sends
- `availability_notifications.sent_failed`: Failed sends
- `availability_notifications.scheduler_duration`: Scheduler execution time
- `availability_notifications.slots_found_avg`: Average slots found per notification
- `availability_notifications.user_engagement`: Click-through rate on notification links

### Logging Strategy
- **INFO**: Scheduler start/stop, notification sent successfully, cleanup completed
- **DEBUG**: Skipped notifications (deduplication), cache hits, individual notification processing
- **WARN**: Missing clinic credentials, expired notifications, user limit reached
- **ERROR**: Send failures, availability check errors, scheduler failures

### Alerts
- Scheduler job failures
- High notification send failure rate (>5%)
- Scheduler taking too long (>5 minutes)
- Database query timeouts

## Testing Strategy

### Unit Tests
1. **Time Window Filtering** (`_filter_slots_by_time_window`):
   - Test morning boundary (8:00, 11:59, 12:00)
   - Test afternoon boundary (12:00, 17:59, 18:00)
   - Test evening boundary (18:00, 21:59, 22:00)
   - Test edge cases (midnight, 23:59)

2. **Message Formatting** (`_format_notification_message`):
   - Single date with multiple slots
   - Multiple dates with slots
   - Empty slots (shouldn't happen but test anyway)
   - Long slot lists (formatting)

3. **Deduplication Logic**:
   - Same day check (`last_notified_date == today`)
   - Different day check
   - Null `last_notified_date` handling

4. **Validation**:
   - Time window validation (max 10, date format, date range)
   - User limit validation
   - Appointment type validation

### Integration Tests
1. **API Endpoints**:
   - Create notification with valid data
   - Create notification with invalid data (validation errors)
   - Create notification when user limit reached
   - List notifications with pagination
   - Delete own notification
   - Delete other user's notification (should fail)
   - Cross-clinic isolation

2. **Scheduler Execution**:
   - End-to-end: create → schedule → send
   - Multiple notifications for same slot (deduplication)
   - Notification with expired dates (should be skipped)
   - Notification with deleted appointment type (handle gracefully)
   - Notification with deleted practitioner (handle gracefully)
   - Clinic with no LINE credentials (skip gracefully)

3. **Cleanup Job**:
   - Expired notifications are deactivated
   - Active notifications with future dates are kept
   - Partial expiration (some dates past, some future)

### Performance Tests
- 1000+ active notifications
- Multiple clinics with many notifications
- Availability query batching effectiveness
- Scheduler execution time under load
- Database query performance

### Edge Case Tests
- Notification with all past dates
- Notification with no matching slots
- Concurrent notification creation
- Scheduler crash mid-run (idempotency)
- LINE API rate limiting
- Database connection failures

## Open Questions

1. **Deep linking**: How to pre-fill appointment flow from notification?
   - **Decision**: Use URL parameters `?mode=book&appointment_type_id=1&practitioner_id=2`
   - Simpler, survives page refresh, bookmarkable
   - Frontend reads URL params and populates appointment store

2. **Notification limits**: Per notification vs. per user?
   - **Decision**: Max 10 time windows per notification, max 10 active notifications per user
   - Prevents abuse and database bloat

3. **Deleted resources**: How to handle deleted appointment types/practitioners?
   - **Decision**: 
     - Deleted appointment type → Auto-deactivate notification (set `is_active=False`)
     - Removed practitioner → Set `practitioner_id=NULL` (treat as "不指定")
   - Add cleanup job to handle orphaned notifications

4. **Multi-clinic users**: How to handle users with multiple clinics?
   - **Decision**: Each notification is clinic-specific, filtered by `clinic_id` from JWT token
   - Users can have separate notifications per clinic
   - UI shows only current clinic's notifications

5. **Notification frequency**: Is once per day sufficient?
   - **Decision**: Yes for MVP (Option 1 deduplication)
   - Can upgrade to more frequent notifications later if needed
   - Most slots don't change multiple times per day

6. **Startup behavior**: What if system was down for multiple days?
   - **Decision**: Deduplication prevents duplicate sends
   - Will only send notifications for slots currently available
   - Users won't get spammed with old notifications

## Notes

- Notifications are per LINE user (not per patient) as specified
- Time windows use Taiwan timezone consistently
- Follows existing patterns: `ReminderService` for scheduling, `LINEService` for messaging
- Reuses `AvailabilityService` for slot checking
- Simple and maintainable design

