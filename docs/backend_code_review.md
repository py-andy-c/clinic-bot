# Backend Code Review: backend/src

**Date:** October 31, 2025  
**Reviewer:** AI Code Review Assistant  
**Scope:** Complete backend/src directory analysis

## Executive Summary

The backend codebase demonstrates solid architecture and clean code principles overall. The service layer pattern is well-implemented, authentication is comprehensive, and the code is generally well-organized. However, there are significant opportunities for improvement in areas of code duplication, error handling consistency, and architectural patterns.

**Key Strengths:**
- Clean separation of concerns (API, services, models, auth)
- Comprehensive authentication and authorization system
- Good use of Pydantic for validation
- Service layer encapsulates business logic well
- Multi-tenant clinic isolation properly enforced

**Priority Issues:**
1. **HIGH**: Significant code duplication (especially cancellation notifications)
2. **HIGH**: Inconsistent error handling and logging patterns
3. **MEDIUM**: Missing request ID tracing for debugging
4. **MEDIUM**: Some security concerns (hardcoded error messages, token management)
5. **MEDIUM**: Performance issues with N+1 queries in several endpoints

---

## 1. Code Duplication Issues

### 1.1 Cancellation Notification Logic (HIGH PRIORITY)

**Issue:** Nearly identical notification code appears in three places:
- `api/clinic.py:_send_clinic_cancellation_notification()` (lines 1088-1124)
- `api/webhooks.py:_send_gcal_cancellation_notification()` (lines 212-248)
- Both functions have 95% identical code

**Current Code Smell:**
```python
# In clinic.py
def _send_clinic_cancellation_notification(db: Session, appointment: Appointment, practitioner: User) -> None:
    try:
        patient = appointment.patient
        if not patient.line_user:
            logger.info(f"Patient {patient.id} has no LINE user, skipping notification")
            return
        
        clinic = patient.clinic
        local_tz = timezone(timedelta(hours=8))
        local_datetime = appointment.calendar_event.start_datetime.astimezone(local_tz)
        formatted_datetime = local_datetime.strftime("%m/%d (%a) %H:%M")
        
        from services.line_service import LINEService
        line_service = LINEService(
            channel_secret=clinic.line_channel_secret,
            channel_access_token=clinic.line_channel_access_token
        )
        message = f"您的預約已被診所取消：{formatted_datetime} - {practitioner.full_name}治療師。如需重新預約，請點選「線上約診」"
        line_service.send_text_message(patient.line_user.line_user_id, message)
        logger.info(f"Sent clinic cancellation LINE notification to patient {patient.id} for appointment {appointment.calendar_event_id}")
    except Exception as e:
        logger.exception(f"Failed to send clinic cancellation notification: {e}")
        raise

# Nearly identical in webhooks.py
```

**Recommendation:**
Create a dedicated notification service:

```python
# services/notification_service.py
from typing import Optional
from enum import Enum

class CancellationSource(Enum):
    CLINIC = "clinic"
    GCAL = "gcal"
    PATIENT = "patient"

class NotificationService:
    """Service for sending LINE notifications to patients."""
    
    @staticmethod
    def send_appointment_cancellation(
        db: Session,
        appointment: Appointment,
        practitioner: User,
        source: CancellationSource
    ) -> bool:
        """
        Send appointment cancellation notification to patient.
        
        Args:
            db: Database session
            appointment: Cancelled appointment
            practitioner: Practitioner who had the appointment
            source: Source of cancellation (clinic/gcal/patient)
            
        Returns:
            True if notification sent successfully, False otherwise
        """
        try:
            patient = appointment.patient
            if not patient.line_user:
                logger.info(f"Patient {patient.id} has no LINE user, skipping notification")
                return False
            
            clinic = patient.clinic
            
            # Format datetime
            formatted_datetime = NotificationService._format_appointment_datetime(
                appointment.calendar_event.start_datetime
            )
            
            # Generate message based on source
            message = NotificationService._get_cancellation_message(
                formatted_datetime, 
                practitioner.full_name,
                source
            )
            
            # Send notification
            line_service = NotificationService._get_line_service(clinic)
            line_service.send_text_message(patient.line_user.line_user_id, message)
            
            logger.info(
                f"Sent {source.value} cancellation notification to patient {patient.id} "
                f"for appointment {appointment.calendar_event_id}"
            )
            return True
            
        except Exception as e:
            logger.exception(f"Failed to send cancellation notification: {e}")
            return False
    
    @staticmethod
    def _format_appointment_datetime(dt: datetime) -> str:
        """Format datetime for Taiwan timezone (UTC+8)."""
        local_tz = timezone(timedelta(hours=8))
        local_datetime = dt.astimezone(local_tz)
        return local_datetime.strftime("%m/%d (%a) %H:%M")
    
    @staticmethod
    def _get_cancellation_message(
        formatted_datetime: str,
        practitioner_name: str,
        source: CancellationSource
    ) -> str:
        """Generate appropriate cancellation message."""
        base = f"{formatted_datetime} - {practitioner_name}治療師"
        
        if source == CancellationSource.CLINIC:
            return f"您的預約已被診所取消：{base}。如需重新預約，請點選「線上約診」"
        elif source == CancellationSource.GCAL:
            return f"您的預約已被取消：{base}。如需重新預約，請點選「線上約診」"
        else:
            return f"您的預約已取消：{base}"
    
    @staticmethod
    def _get_line_service(clinic: Clinic) -> 'LINEService':
        """Get LINE service for clinic."""
        from services.line_service import LINEService
        return LINEService(
            channel_secret=clinic.line_channel_secret,
            channel_access_token=clinic.line_channel_access_token
        )
```

**Usage in existing code:**
```python
# In clinic.py and webhooks.py
from services.notification_service import NotificationService, CancellationSource

# Replace function calls:
NotificationService.send_appointment_cancellation(
    db, 
    appointment, 
    practitioner,
    CancellationSource.CLINIC  # or CancellationSource.GCAL
)
```

**Benefits:**
- Eliminates 50+ lines of duplicated code
- Single source of truth for notification logic
- Easier to add new notification types
- Better testability
- Consistent error handling

---

### 1.2 Permission Checking Duplication (MEDIUM PRIORITY)

**Issue:** Permission checking logic is duplicated across multiple endpoints in `api/practitioner_calendar.py` and `api/clinic.py`.

**Example from practitioner_calendar.py (lines 220-225, 272-277, 377-382, etc.):**
```python
# This pattern repeats 8+ times
if current_user.user_type == 'clinic_user' and not current_user.has_role("admin"):
    if current_user.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own availability"
        )
```

**Recommendation:**
Create reusable permission decorators or dependency functions:

```python
# auth/permissions.py
from functools import wraps
from typing import Callable

def require_self_or_admin(user_id_param: str = "user_id"):
    """
    Dependency that ensures user is either viewing their own data or is an admin.
    
    Args:
        user_id_param: Name of the path parameter containing the user_id
    """
    def dependency(
        user_id: int,
        current_user: UserContext = Depends(get_current_user)
    ) -> UserContext:
        if current_user.is_system_admin():
            return current_user
            
        if current_user.user_type == 'clinic_user':
            if current_user.has_role("admin"):
                return current_user
            
            if current_user.user_id == user_id:
                return current_user
        
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You can only access your own data"
        )
    
    return dependency

# Usage:
@router.get("/practitioners/{user_id}/availability/default")
async def get_default_schedule(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_self_or_admin())
):
    # Permission check already done by dependency
    ...
```

---

### 1.3 Time Formatting Duplication (LOW PRIORITY)

**Issue:** Time formatting functions duplicated between services:
- `practitioner_calendar.py`: `_format_time()`, `_parse_time()` (lines 126-135)
- `availability_service.py`: `_format_time()`, `_parse_time()` (lines 463-472)

**Recommendation:**
Move to shared utility module:

```python
# utils/datetime_utils.py (ALREADY EXISTS - use it!)
from datetime import time

def format_time_hhmm(time_obj: time) -> str:
    """Format time object to HH:MM string."""
    return time_obj.strftime('%H:%M')

def parse_time_hhmm(time_str: str) -> time:
    """Parse time string in HH:MM format to time object."""
    hour, minute = map(int, time_str.split(':'))
    return time(hour, minute)

def check_time_overlap(
    start1: time, 
    end1: time, 
    start2: time, 
    end2: time
) -> bool:
    """Check if two time intervals overlap."""
    return start1 < end2 and start2 < end1
```

Then import from both files:
```python
from utils.datetime_utils import format_time_hhmm, parse_time_hhmm, check_time_overlap
```

**✅ DONE** - Code duplication issues have been resolved by:
- Creating centralized `NotificationService` in `services/notification_service.py`
- Extracting permission dependencies to `auth/permissions.py`
- Adding shared datetime utilities to `utils/datetime_utils.py`
- Removing duplicate notification and time formatting code across the codebase

---

## 2. Error Handling Inconsistencies

### 2.1 Inconsistent Exception Handling Pattern (HIGH PRIORITY)

**Issue:** Three different error handling patterns used across the codebase:

**Pattern 1 - Specific re-raise (Good):**
```python
# api/liff.py
except HTTPException:
    raise
except Exception as e:
    logger.error(f"LIFF login error: {e}")
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Authentication failed"
    )
```

**Pattern 2 - Generic catch-all (Inconsistent):**
```python
# api/system.py
except HTTPException:
    raise
except Exception:
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Failed to create clinic"
    )
```

**Pattern 3 - No error context (Bad):**
```python
# api/clinic.py line 141
except Exception:
    logger.exception("Error getting members list")
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="無法取得成員列表"
    )
```

**Recommendation:**
Standardize error handling with a consistent pattern and create error utilities:

```python
# utils/error_handling.py
from typing import Optional
import uuid
from datetime import datetime

class APIError(Exception):
    """Base exception for API errors with tracking."""
    
    def __init__(
        self, 
        message: str, 
        status_code: int = 500,
        error_code: Optional[str] = None,
        details: Optional[dict] = None
    ):
        self.message = message
        self.status_code = status_code
        self.error_code = error_code or f"ERR_{status_code}"
        self.details = details or {}
        self.error_id = str(uuid.uuid4())
        self.timestamp = datetime.utcnow()
        super().__init__(self.message)

def handle_service_error(
    error: Exception,
    operation: str,
    user_message: str,
    logger: logging.Logger,
    include_trace: bool = False
) -> HTTPException:
    """
    Standard error handler for service operations.
    
    Args:
        error: The caught exception
        operation: Description of operation that failed
        user_message: User-friendly error message
        logger: Logger instance
        include_trace: Whether to include stack trace in logs (dev only)
        
    Returns:
        HTTPException with appropriate status code
    """
    error_id = str(uuid.uuid4())
    
    # Log with context
    logger.error(
        f"Operation failed: {operation} | "
        f"Error ID: {error_id} | "
        f"Error: {str(error)}",
        exc_info=include_trace
    )
    
    # Return user-friendly error
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={
            "message": user_message,
            "error_id": error_id,
            "timestamp": datetime.utcnow().isoformat()
        }
    )

# Usage:
try:
    # ... operation ...
    pass
except HTTPException:
    raise
except ValueError as e:
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=str(e)
    )
except Exception as e:
    raise handle_service_error(
        error=e,
        operation="create_patient",
        user_message="Failed to create patient",
        logger=logger
    )
```

---

### 2.2 Missing Request ID Tracing (MEDIUM PRIORITY)

**Issue:** No request ID tracking makes debugging production issues very difficult. When errors occur, there's no way to trace the request flow through logs.

**Recommendation:**
Add request ID middleware:

```python
# core/middleware.py
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
import logging

logger = logging.getLogger(__name__)

class RequestIDMiddleware(BaseHTTPMiddleware):
    """Middleware to add unique request ID to all requests."""
    
    async def dispatch(self, request: Request, call_next):
        # Generate or extract request ID
        request_id = request.headers.get('X-Request-ID', str(uuid.uuid4()))
        
        # Add to request state
        request.state.request_id = request_id
        
        # Add to logging context (use contextvars for thread safety)
        from contextvars import ContextVar
        _request_id_ctx_var: ContextVar[str] = ContextVar('request_id', default='')
        _request_id_ctx_var.set(request_id)
        
        # Log request
        logger.info(
            f"Request started: {request.method} {request.url.path} "
            f"[Request ID: {request_id}]"
        )
        
        # Process request
        response = await call_next(request)
        
        # Add request ID to response headers
        response.headers['X-Request-ID'] = request_id
        
        # Log response
        logger.info(
            f"Request completed: {request.method} {request.url.path} "
            f"[Request ID: {request_id}] [Status: {response.status_code}]"
        )
        
        return response

# Add to main.py:
from core.middleware import RequestIDMiddleware
app.add_middleware(RequestIDMiddleware)
```

---

### 2.3 Rollback Inconsistency (LOW PRIORITY)

**Issue:** Some error handlers call `db.rollback()`, others don't. This is inconsistent and can lead to transaction state issues.

**Examples:**
- `api/clinic.py:198` - Has rollback
- `api/clinic.py:334` - Has rollback  
- `api/clinic.py:438` - NO rollback (line 438-443)

**Recommendation:**
Use transaction context manager consistently:

```python
# core/database.py
from contextlib import contextmanager
from sqlalchemy.orm import Session

@contextmanager
def transactional_session(db: Session):
    """Context manager for transactional operations."""
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise

# Usage:
@router.post("/settings")
async def update_settings(
    settings: Dict[str, Any],
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    try:
        with transactional_session(db):
            # All operations here
            # Auto-commit on success, auto-rollback on exception
            pass
    except HTTPException:
        raise
    except Exception as e:
        # Error already rolled back
        raise handle_service_error(...)
```

---

## 3. Security Concerns

### 3.1 Hardcoded Error Messages Leak Information (MEDIUM PRIORITY)

**Issue:** Error messages reveal internal implementation details.

**Examples:**
```python
# auth/dependencies.py:119-124
if not user.is_active:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="帳戶已被停用，請聯繫診所管理員重新啟用"  # Reveals account status
    )

# api/clinic.py:227-228
if not member:
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="找不到成員"  # Reveals existence
    )
```

**Recommendation:**
Use generic error messages and separate internal logging:

```python
# constants/error_messages.py
# User-facing messages (generic)
USER_MESSAGES = {
    "AUTHENTICATION_FAILED": "認證失敗，請重新登入",
    "ACCESS_DENIED": "存取被拒絕",
    "RESOURCE_NOT_FOUND": "找不到資源",
    "OPERATION_FAILED": "操作失敗",
}

# Internal error codes for logging
ERROR_CODES = {
    "USER_INACTIVE": "ERR_001",
    "USER_NOT_FOUND": "ERR_002",
    "MEMBER_NOT_FOUND": "ERR_003",
    # ...
}

# Usage:
if not user.is_active:
    logger.warning(
        f"Login attempt for inactive user: {user.email} "
        f"[Code: {ERROR_CODES['USER_INACTIVE']}]"
    )
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=USER_MESSAGES["AUTHENTICATION_FAILED"]
    )
```

---

### 3.2 Token Management Security (MEDIUM PRIORITY)

**Issue:** Refresh token lookup has potential timing attack vulnerability in linear scan fallback (auth.py:295-305).

**Current Code:**
```python
# Fast HMAC lookup
refresh_token_record = db.query(RefreshToken).filter(
    RefreshToken.hmac_key == expected_hmac,
    ...
).first()

if refresh_token_record and jwt_service.verify_refresh_token_hash(...):
    pass
else:
    # Fallback: Linear scan ALL valid tokens (timing attack risk)
    valid_tokens = db.query(RefreshToken).filter(...).all()
    for token_record in valid_tokens:
        if jwt_service.verify_refresh_token_hash(...):
            refresh_token_record = token_record
            break
```

**Issue:** The linear scan fallback creates timing differences based on database size, which could leak information.

**Recommendation:**
1. Remove fallback after HMAC migration period
2. Add rate limiting for refresh attempts
3. Add constant-time comparison for token validation

```python
# Add to core/config.py
REFRESH_TOKEN_MAX_ATTEMPTS = 5  # per user per hour

# In auth.py
from datetime import datetime, timezone
import secrets

# Track failed attempts (use Redis in production)
_refresh_attempts = {}  # Simple in-memory for demo

@router.post("/refresh")
async def refresh_access_token(...):
    # Rate limiting
    client_id = request.client.host if request.client else "unknown"
    attempts_key = f"{client_id}:{datetime.now(timezone.utc).hour}"
    
    if attempts_key in _refresh_attempts:
        if _refresh_attempts[attempts_key] >= REFRESH_TOKEN_MAX_ATTEMPTS:
            # Use constant time delay
            await asyncio.sleep(0.5)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many refresh attempts"
            )
    
    # ... existing logic ...
    
    # On failure, increment attempts
    if not refresh_token_record:
        _refresh_attempts[attempts_key] = _refresh_attempts.get(attempts_key, 0) + 1
        # Constant time delay
        await asyncio.sleep(secrets.choice([0.1, 0.15, 0.2]))  # Random within range
        raise HTTPException(...)
```

---

### 3.3 Missing Input Sanitization (LOW PRIORITY)

**Issue:** Some user inputs aren't properly sanitized, though Pydantic validators help.

**Examples:**
```python
# api/liff.py:64-77 - Good XSS prevention
@field_validator('full_name')
@classmethod
def validate_name(cls, v: str) -> str:
    if '<' in v or '>' in v:
        raise ValueError('Invalid characters in name')
    return v

# But missing in other places:
# api/clinic.py:448 - Settings update has Dict[str, Any] with no validation
async def update_settings(
    settings: Dict[str, Any],  # No validation!
    ...
):
```

**Recommendation:**
Create comprehensive input validation:

```python
# utils/validators.py
import re
from typing import Any

class InputValidator:
    """Centralized input validation utilities."""
    
    @staticmethod
    def sanitize_text(text: str, max_length: int = 500) -> str:
        """Sanitize text input for XSS prevention."""
        if not text:
            return text
        
        # Remove potentially dangerous characters
        text = text.strip()
        if '<' in text or '>' in text or '&' in text:
            raise ValueError("Invalid characters in input")
        
        # Enforce length limit
        if len(text) > max_length:
            raise ValueError(f"Input too long (max {max_length} characters)")
        
        return text
    
    @staticmethod
    def validate_phone(phone: str) -> str:
        """Validate phone number format."""
        # Remove common separators
        cleaned = re.sub(r'[-\s()+]', '', phone)
        
        # Check if it's digits only
        if not cleaned.isdigit():
            raise ValueError("Invalid phone number format")
        
        # Check reasonable length (8-15 digits for international)
        if not (8 <= len(cleaned) <= 15):
            raise ValueError("Phone number length invalid")
        
        return phone  # Return original format
    
    @staticmethod
    def validate_settings_dict(settings: Dict[str, Any]) -> Dict[str, Any]:
        """Validate settings dictionary."""
        allowed_keys = {
            'appointment_types', 
            'notification_settings',
            'business_hours'
        }
        
        # Check for unexpected keys
        unexpected = set(settings.keys()) - allowed_keys
        if unexpected:
            raise ValueError(f"Unexpected settings keys: {unexpected}")
        
        # Validate each section
        if 'appointment_types' in settings:
            if not isinstance(settings['appointment_types'], list):
                raise ValueError("appointment_types must be a list")
        
        return settings
```

---

## 4. Performance Issues

### 4.1 N+1 Query Problems (MEDIUM PRIORITY)

**Issue:** Multiple endpoints have N+1 query problems where they iterate over results and make additional database calls.

**Example 1 - `clinic.py:list_members` (lines 115-136):**
```python
members = db.query(User).filter(
    User.clinic_id == current_user.clinic_id
).all()

member_list = [
    MemberResponse(
        id=member.id,
        email=member.email,
        full_name=member.full_name,
        roles=member.roles,  # Lazy loaded if not eagerly fetched
        gcal_sync_enabled=member.gcal_sync_enabled,
        ...
    )
    for member in members
]
```

**Example 2 - `appointment_service.py:list_appointments_for_line_user` (lines 294-321):**
```python
appointments = query.order_by(CalendarEvent.start_time).all()

# Then iterates and queries for each appointment:
for appointment in appointments:
    practitioner = db.query(User).get(appointment.calendar_event.user_id)  # N+1!
    appointment_type = db.query(AppointmentType).get(appointment.appointment_type_id)  # N+1!
    patient = db.query(Patient).get(appointment.patient_id)  # N+1!
```

**Recommendation:**
Use eager loading with SQLAlchemy's `joinedload` or `selectinload`:

```python
# In appointment_service.py
from sqlalchemy.orm import joinedload, selectinload

def list_appointments_for_line_user(...):
    # Build query with eager loading
    query = db.query(Appointment)\
        .join(CalendarEvent)\
        .options(
            joinedload(Appointment.patient).joinedload(Patient.line_user),
            joinedload(Appointment.appointment_type),
            joinedload(Appointment.calendar_event).joinedload(CalendarEvent.user)
        )\
        .filter(Appointment.patient_id.in_(patient_ids))
    
    # Now everything is loaded in one query!
    appointments = query.order_by(CalendarEvent.start_time).all()
    
    result = []
    for appointment in appointments:
        # No additional queries needed - data already loaded
        result.append({
            "id": appointment.calendar_event_id,
            "patient_name": appointment.patient.full_name,
            "practitioner_name": appointment.calendar_event.user.full_name,
            ...
        })
```

---

### 4.2 Redundant Database Calls (LOW PRIORITY)

**Issue:** Some endpoints query the same data multiple times.

**Example - `clinic.py:list_clinic_appointments` (lines 988-1033):**
```python
# Gets appointments with filters
appointments = query.order_by(CalendarEvent.start_time.desc()).all()

# Then in loop:
for appointment in appointments:
    practitioner = db.query(User).get(appointment.calendar_event.user_id)  # Already joined!
```

**Recommendation:**
Use the already-joined data from the query:

```python
# Modify query to use proper joins and select
query = db.query(Appointment, User, Patient)\
    .join(CalendarEvent)\
    .join(Patient)\
    .join(User, CalendarEvent.user_id == User.id)\
    .filter(User.clinic_id == clinic_id)

# Now we get tuples with all data
results = query.order_by(CalendarEvent.start_time.desc()).all()

formatted = []
for appointment, practitioner, patient in results:
    # All data already loaded, no additional queries
    formatted.append({
        'practitioner_name': practitioner.full_name,
        'patient_name': patient.full_name,
        ...
    })
```

---

### 4.3 Missing Database Indexes (MEDIUM PRIORITY)

**Issue:** Several query patterns suggest missing indexes based on the query filters used.

**Recommended Indexes:**
```python
# models/calendar_event.py
# Add composite indexes:
Index('ix_calendar_event_user_date_type', 
      'user_id', 'date', 'event_type')
Index('ix_calendar_event_gcal_event_id', 
      'gcal_event_id')

# models/appointment.py
Index('ix_appointment_patient_status', 
      'patient_id', 'status')
Index('ix_appointment_calendar_event_status', 
      'calendar_event_id', 'status')

# models/patient.py
Index('ix_patient_line_clinic', 
      'line_user_id', 'clinic_id')

# models/user.py
Index('ix_user_clinic_active_roles', 
      'clinic_id', 'is_active', 'roles')  # For JSONB, may need GIN index
```

**Add index migration:**
```python
# alembic/versions/xxxx_add_performance_indexes.py
def upgrade():
    # Calendar events
    op.create_index(
        'ix_calendar_event_user_date_type',
        'calendar_events',
        ['user_id', 'date', 'event_type']
    )
    
    # Appointments
    op.create_index(
        'ix_appointment_patient_status',
        'appointments',
        ['patient_id', 'status']
    )
    
    # Users - For JSONB roles column, use GIN index
    op.execute(
        "CREATE INDEX ix_user_roles_gin ON users USING GIN (roles)"
    )
```

---

## 5. Architecture & Design Patterns

### 5.1 Missing Repository Pattern (MEDIUM PRIORITY)

**Issue:** Database queries are mixed into service layer, making testing difficult and violating separation of concerns.

**Current Pattern (Service directly uses DB):**
```python
# services/appointment_service.py
class AppointmentService:
    @staticmethod
    def create_appointment(db: Session, ...):
        # Direct DB queries in service
        appointment_type = db.query(AppointmentType).filter_by(...).first()
        candidates = db.query(User).filter(...).all()
        # ...
```

**Recommended Pattern:**
Introduce repository layer for data access:

```python
# repositories/appointment_repository.py
class AppointmentRepository:
    """Data access layer for appointments."""
    
    def __init__(self, db: Session):
        self.db = db
    
    def get_appointment_type(self, type_id: int, clinic_id: int) -> Optional[AppointmentType]:
        """Get appointment type by ID and clinic."""
        return self.db.query(AppointmentType).filter_by(
            id=type_id,
            clinic_id=clinic_id
        ).first()
    
    def get_practitioners_for_type(
        self, 
        clinic_id: int, 
        type_id: int
    ) -> List[User]:
        """Get all practitioners offering a specific appointment type."""
        return self.db.query(User).filter(
            User.clinic_id == clinic_id,
            User.is_active == True,
            User.roles.contains(['practitioner'])
        ).join(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.appointment_type_id == type_id
        ).all()
    
    def create_appointment(
        self, 
        calendar_event: CalendarEvent,
        appointment: Appointment
    ) -> Appointment:
        """Create appointment and calendar event atomically."""
        self.db.add(calendar_event)
        self.db.flush()
        
        appointment.calendar_event_id = calendar_event.id
        self.db.add(appointment)
        self.db.flush()
        
        return appointment

# services/appointment_service.py
class AppointmentService:
    """Business logic for appointments."""
    
    def __init__(self, repository: AppointmentRepository):
        self.repo = repository
    
    def create_appointment(self, ...):
        # Business logic only
        appointment_type = self.repo.get_appointment_type(type_id, clinic_id)
        if not appointment_type:
            raise ValueError("Appointment type not found")
        
        # Validation, calculations, etc.
        end_time = start_time + timedelta(minutes=appointment_type.duration_minutes)
        
        # Create via repository
        calendar_event = CalendarEvent(...)
        appointment = Appointment(...)
        
        return self.repo.create_appointment(calendar_event, appointment)
```

**Benefits:**
- Clear separation: Repository = data access, Service = business logic
- Easier to test services with mock repositories
- Centralized query logic
- Can swap database implementations

---

### 5.2 Lack of DTOs/Domain Models (LOW PRIORITY)

**Issue:** API endpoints work directly with database models, tightly coupling API contracts to database schema.

**Current:**
```python
# Returns database model directly
patient = db.query(Patient).first()
return patient  # Pydantic will serialize this
```

**Recommendation:**
Use Data Transfer Objects (DTOs):

```python
# api/dtos/patient_dtos.py
from pydantic import BaseModel
from datetime import datetime

class PatientDTO(BaseModel):
    """Data transfer object for patient."""
    id: int
    full_name: str
    phone_number: Optional[str]
    created_at: datetime
    
    @classmethod
    def from_model(cls, patient: Patient) -> 'PatientDTO':
        """Create DTO from database model."""
        return cls(
            id=patient.id,
            full_name=patient.full_name,
            phone_number=patient.phone_number,
            created_at=patient.created_at
        )

# Usage:
@router.get("/patients/{patient_id}")
async def get_patient(...) -> PatientDTO:
    patient = db.query(Patient).filter_by(id=patient_id).first()
    if not patient:
        raise HTTPException(...)
    return PatientDTO.from_model(patient)
```

---

### 5.3 Missing Service Interfaces (LOW PRIORITY)

**Issue:** Services are static methods, making dependency injection and testing harder.

**Recommendation:**
Use dependency injection with interfaces:

```python
# services/interfaces.py
from abc import ABC, abstractmethod

class INotificationService(ABC):
    """Interface for notification service."""
    
    @abstractmethod
    def send_appointment_cancellation(
        self,
        appointment: Appointment,
        practitioner: User,
        source: str
    ) -> bool:
        pass

# services/notification_service.py
class NotificationService(INotificationService):
    """LINE notification service implementation."""
    
    def __init__(self, line_client_factory: Callable):
        self.line_client_factory = line_client_factory
    
    def send_appointment_cancellation(...):
        # Implementation
        pass

# Dependency injection in main.py or dependencies.py
def get_notification_service() -> INotificationService:
    """Dependency injection for notification service."""
    return NotificationService(
        line_client_factory=lambda clinic: LINEService(
            channel_secret=clinic.line_channel_secret,
            channel_access_token=clinic.line_channel_access_token
        )
    )

# Usage in endpoints:
@router.delete("/appointments/{appointment_id}")
async def cancel_appointment(
    appointment_id: int,
    notification_service: INotificationService = Depends(get_notification_service),
    db: Session = Depends(get_db)
):
    # ...
    notification_service.send_appointment_cancellation(...)
```

---

## 6. Testing Improvements

### 6.1 Missing Unit Test Coverage for Services (HIGH PRIORITY)

**Issue:** Services contain complex business logic but many lack dedicated unit tests. They're only tested through integration tests.

**Example - Untested scenarios:**
- `AppointmentService._assign_practitioner()` - Complex load balancing logic (lines 146-248)
- `AvailabilityService._calculate_slots_from_schedule()` - Time slot calculations (lines 280-350)

**Recommendation:**
Add comprehensive unit tests:

```python
# tests/unit/test_appointment_service.py
import pytest
from unittest.mock import Mock, MagicMock
from services.appointment_service import AppointmentService
from models import User, CalendarEvent

class TestAppointmentService:
    """Unit tests for AppointmentService."""
    
    def test_assign_practitioner_selects_least_loaded(self):
        """Should assign practitioner with fewest appointments."""
        # Arrange
        db_mock = Mock()
        service = AppointmentService()
        
        practitioner1 = Mock(spec=User, id=1)
        practitioner2 = Mock(spec=User, id=2)
        candidates = [practitioner1, practitioner2]
        
        # Mock query to return different counts
        def mock_count(*args, **kwargs):
            if practitioner1.id in str(args):
                return 3  # practitioner1 has 3 appointments
            return 1  # practitioner2 has 1 appointment
        
        db_mock.query.return_value.filter.return_value.count = mock_count
        
        # Act
        selected = service._assign_practitioner(
            db_mock, 1, 1, None, datetime.now(), datetime.now()
        )
        
        # Assert
        assert selected == practitioner2.id
    
    def test_assign_practitioner_checks_availability(self):
        """Should skip practitioners with time conflicts."""
        # Similar mock-based test
        pass
```

---

### 6.2 Test Data Builders Missing (MEDIUM PRIORITY)

**Issue:** Test setup is verbose and duplicated across test files.

**Current Pattern:**
```python
# tests/integration/test_liff_integration.py
# Repeated in many tests:
patient = Patient(
    clinic_id=clinic.id,
    line_user_id=line_user.id,
    full_name="Test Patient",
    phone_number="0912345678"
)
db.add(patient)
db.commit()
```

**Recommendation:**
Create test data builders:

```python
# tests/builders.py
from datetime import datetime, timezone
from typing import Optional

class PatientBuilder:
    """Builder for creating test Patient instances."""
    
    def __init__(self):
        self._clinic_id = 1
        self._line_user_id = 1
        self._full_name = "Test Patient"
        self._phone_number = "0912345678"
    
    def with_clinic(self, clinic_id: int) -> 'PatientBuilder':
        self._clinic_id = clinic_id
        return self
    
    def with_line_user(self, line_user_id: int) -> 'PatientBuilder':
        self._line_user_id = line_user_id
        return self
    
    def with_name(self, name: str) -> 'PatientBuilder':
        self._full_name = name
        return self
    
    def build(self, db: Session) -> Patient:
        """Build and persist patient."""
        patient = Patient(
            clinic_id=self._clinic_id,
            line_user_id=self._line_user_id,
            full_name=self._full_name,
            phone_number=self._phone_number
        )
        db.add(patient)
        db.commit()
        db.refresh(patient)
        return patient

# Usage in tests:
def test_patient_creation(db):
    patient = PatientBuilder()\
        .with_name("Custom Name")\
        .with_clinic(2)\
        .build(db)
    
    assert patient.full_name == "Custom Name"
```

---

## 7. Code Organization

### 7.1 Large API Files (MEDIUM PRIORITY)

**Issue:** Some API files are very large:
- `practitioner_calendar.py`: 842 lines
- `liff.py`: 533 lines  
- `auth.py`: 532 lines

**Recommendation:**
Split into logical sub-modules:

```
api/
├── auth/
│   ├── __init__.py
│   ├── oauth.py          # OAuth login/callback
│   ├── tokens.py         # Token refresh/verify
│   └── dev.py            # Dev login endpoints
├── clinic/
│   ├── __init__.py
│   ├── members.py        # Member management
│   ├── settings.py       # Settings management
│   ├── appointments.py   # Appointment viewing/cancellation
│   └── availability.py   # Practitioner availability
├── liff/
│   ├── __init__.py
│   ├── auth.py           # LIFF authentication
│   ├── patients.py       # Patient management
│   └── appointments.py   # Appointment booking
└── practitioner/
    ├── __init__.py
    ├── schedule.py       # Default schedule management
    ├── calendar.py       # Calendar views
    └── exceptions.py     # Availability exceptions
```

**Benefits:**
- Easier navigation
- Clearer responsibility boundaries
- Smaller files are easier to understand
- Better code organization

---

### 7.2 Config vs Constants Confusion (LOW PRIORITY)

**Issue:** `core/config.py` and `core/constants.py` have overlapping purposes.

**Current:**
- `config.py`: Environment variables + some constants (CORS_ORIGINS)
- `constants.py`: Application constants (MAX_STRING_LENGTH, DEFAULT_REMINDER_HOURS_BEFORE)

**Recommendation:**
Clear separation:

```python
# core/config.py - ONLY environment variables
"""Configuration loaded from environment."""
DATABASE_URL = os.getenv("DATABASE_URL", ...)
API_BASE_URL = os.getenv("API_BASE_URL", ...)
# ... only env vars

# core/constants.py - ONLY application constants
"""Application-wide constants."""
MAX_STRING_LENGTH = 255
DEFAULT_REMINDER_HOURS_BEFORE = 24
APPOINTMENT_SLOT_INCREMENT_MINUTES = 15
MIN_APPOINTMENT_ADVANCE_HOURS = 2
MAX_APPOINTMENT_ADVANCE_DAYS = 90

# core/settings.py - Configuration classes (optional but recommended)
"""Application settings with validation."""
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    """Application settings with type validation."""
    database_url: str
    api_base_url: str
    jwt_secret_key: str
    environment: str = "development"
    
    class Config:
        env_file = ".env"

settings = Settings()
```

---

## 8. Documentation

### 8.1 Missing API Documentation Standards (MEDIUM PRIORITY)

**Issue:** Docstring quality varies significantly. Some functions have excellent docs, others minimal.

**Good Example:**
```python
# availability_service.py:32-54
def get_available_slots(
    db: Session,
    date: str,
    appointment_type_id: int,
    practitioner_ids: Optional[List[int]] = None,
    clinic_id: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Get available time slots for booking.
    
    Args:
        db: Database session
        date: Date in YYYY-MM-DD format
        appointment_type_id: Appointment type ID
        practitioner_ids: Optional list of specific practitioner IDs to check
        clinic_id: Optional clinic ID for filtering
    
    Returns:
        List of available slot dictionaries
    
    Raises:
        HTTPException: If validation fails
    """
```

**Bad Example:**
```python
# clinic.py:283
@router.delete("/members/{user_id}")
async def remove_member(
    user_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """Soft delete a team member by marking them as inactive."""
    # Minimal documentation, no Args/Returns/Raises
```

**Recommendation:**
Enforce documentation standard:

```python
# Create docs/docstring_template.md
"""
Standard docstring template for all functions:

For API endpoints:
'''
Brief one-line description.

Detailed description explaining the endpoint's purpose, behavior,
and any important considerations.

**Authentication:** Required role/permission level
**Rate Limiting:** If applicable

Args:
    param_name: Type and description
    another_param: Type and description

Returns:
    Description of return value/response model

Raises:
    HTTPException: When and why (status codes)
    ValueError: When and why

Example:
    ```python
    # Show example usage
    response = await endpoint(param1, param2)
    ```
'''
"""

# Add to CI/CD - docstring linter
# Run: pydocstyle backend/src --convention=google
```

---

### 8.2 Missing Architecture Documentation (HIGH PRIORITY)

**Issue:** No high-level architecture documentation explaining the system design, data flow, or key design decisions.

**Recommendation:**
Create architecture documentation:

```markdown
# docs/backend_architecture.md

## System Architecture

### Layer Overview
```
┌─────────────────────────────────────┐
│         API Layer (FastAPI)         │
│  - Request validation (Pydantic)    │
│  - Authentication/Authorization     │
│  - Response formatting              │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│        Service Layer                │
│  - Business logic                   │
│  - Transaction coordination         │
│  - External service integration     │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│    Repository Layer (Future)        │
│  - Data access abstraction          │
│  - Query optimization               │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      Models Layer (SQLAlchemy)      │
│  - Database schema                  │
│  - Relationships                    │
└─────────────────────────────────────┘
```

### Authentication Flow
[Diagram showing OAuth flow]

### Appointment Booking Flow
[Sequence diagram]

### Key Design Decisions
1. **Multi-tenancy via clinic_id**: ...
2. **Service layer pattern**: ...
3. **JWT + Refresh tokens**: ...
```

---

## 9. Specific Code Improvements

### 9.1 `auth/dependencies.py` Line 115-124 - Unreachable Code

**Issue:** Code structure has unreachable block due to early return:

```python
if not user:
    raise HTTPException(...)

    # This code is UNREACHABLE
    if not user.is_active:
        raise HTTPException(...)
```

**Fix:**
```python
if not user:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="User not found"
    )

# Now reachable
if not user.is_active:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="帳戶已被停用，請聯繫診所管理員重新啟用"
    )
```

---

### 9.2 `auth.py` Line 204-206 - Dummy User ID for System Admins

**Issue:** Creates a dummy user ID from email hash for system admins, which is fragile:

```python
# For system admins, we don't have a user record
dummy_user_id = hash(email) % 1000000  # Hash collision risk!
```

**Recommendation:**
Use a dedicated system admin sessions table or use negative IDs:

```python
# Option 1: Dedicated table
class SystemAdminSession(Base):
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, index=True)
    refresh_tokens = relationship("RefreshToken")

# Option 2: Use negative user_id for system admins
SYSTEM_ADMIN_USER_ID_OFFSET = -1000000

def get_system_admin_user_id(email: str) -> int:
    """Get deterministic user ID for system admin."""
    # Use stable hash
    email_hash = int(hashlib.sha256(email.encode()).hexdigest()[:8], 16)
    return SYSTEM_ADMIN_USER_ID_OFFSET - (email_hash % 999999)
```

---

### 9.3 `appointment_service.py` - Hardcoded Load Balancing

**Issue:** Line balancing uses simple "count appointments" which doesn't account for appointment duration:

```python
# Line 239-246
selected_practitioner = min(
    available_candidates,
    key=lambda p: db.query(CalendarEvent).filter(
        CalendarEvent.user_id == p.id,
        CalendarEvent.date == start_time.date(),
        CalendarEvent.event_type == 'appointment'
    ).count()  # Count only, ignores duration!
)
```

**Recommendation:**
Account for total time, not just count:

```python
def calculate_practitioner_load(
    db: Session,
    practitioner_id: int,
    target_date: date
) -> int:
    """Calculate practitioner load in minutes."""
    from sqlalchemy import func
    
    result = db.query(
        func.sum(
            func.extract('epoch', CalendarEvent.end_time) - 
            func.extract('epoch', CalendarEvent.start_time)
        ).label('total_minutes')
    ).filter(
        CalendarEvent.user_id == practitioner_id,
        CalendarEvent.date == target_date,
        CalendarEvent.event_type == 'appointment'
    ).scalar()
    
    return int(result / 60) if result else 0

# Then use:
selected_practitioner = min(
    available_candidates,
    key=lambda p: calculate_practitioner_load(db, p.id, start_time.date())
)
```

---

### 9.4 `clinic.py` Line 460-474 - Delete Before Insert Pattern

**Issue:** Deletes all appointment types before inserting new ones. This breaks foreign key relationships if appointments reference these types.

```python
# Delete existing appointment types
db.query(AppointmentType).filter(
    AppointmentType.clinic_id == current_user.clinic_id
).delete()

# Add new appointment types
for at_data in appointment_types_data:
    appointment_type = AppointmentType(...)
    db.add(appointment_type)
```

**Recommendation:**
Use upsert pattern:

```python
def update_appointment_types(
    db: Session,
    clinic_id: int,
    new_types: List[Dict]
) -> List[AppointmentType]:
    """Update appointment types using upsert pattern."""
    existing_types = {
        at.id: at 
        for at in db.query(AppointmentType).filter_by(clinic_id=clinic_id).all()
    }
    
    updated_ids = set()
    
    # Update or create
    for type_data in new_types:
        type_id = type_data.get('id')
        
        if type_id and type_id in existing_types:
            # Update existing
            at = existing_types[type_id]
            at.name = type_data['name']
            at.duration_minutes = type_data['duration_minutes']
            updated_ids.add(type_id)
        else:
            # Create new
            at = AppointmentType(
                clinic_id=clinic_id,
                name=type_data['name'],
                duration_minutes=type_data['duration_minutes']
            )
            db.add(at)
    
    # Delete types not in update
    for type_id, at in existing_types.items():
        if type_id not in updated_ids:
            # Check for dependencies first
            has_appointments = db.query(Appointment).filter_by(
                appointment_type_id=type_id
            ).first()
            
            if has_appointments:
                # Mark as inactive instead of deleting
                at.is_active = False
            else:
                db.delete(at)
    
    db.commit()
```

---

## 10. Recommendations Summary

### High Priority (Fix First)

1. **Eliminate notification code duplication** - Create `NotificationService`
2. **Fix unreachable code in auth** - Line 115-124 in `dependencies.py`
3. **Add request ID tracing** - For production debugging
4. **Standardize error handling** - Consistent pattern across all endpoints
5. **Add missing architecture docs** - For onboarding and maintenance

### Medium Priority (Next Sprint)

1. **Add N+1 query fixes** - Use eager loading
2. **Implement permission checking helpers** - Reduce duplication
3. **Add database indexes** - For performance
4. **Security hardening** - Generic error messages, rate limiting
5. **Split large API files** - Better organization

### Low Priority (Technical Debt)

1. **Introduce repository pattern** - Better separation of concerns
2. **Add comprehensive unit tests** - For service layer
3. **Create test data builders** - Reduce test setup duplication
4. **Consolidate utility functions** - Use existing `datetime_utils.py`
5. **Clean up config/constants** - Clear separation

---

## Conclusion

The backend codebase is well-structured with good separation of concerns and solid authentication. The main areas for improvement are:

1. **Code reuse** - Significant duplication in notification and permission logic
2. **Error handling** - Needs standardization and request tracing
3. **Performance** - N+1 queries and missing indexes
4. **Testing** - More unit test coverage needed
5. **Documentation** - Architecture and API docs

Implementing the high-priority recommendations will significantly improve maintainability and debugging capabilities. The codebase is in good shape overall and these improvements will make it production-ready at scale.

---

## Appendix: Quick Wins

These can be done immediately with minimal risk:

1. Add request ID middleware (30 minutes)
2. Create `NotificationService` to eliminate duplication (2 hours)
3. Fix unreachable code in `dependencies.py` (5 minutes)
4. Add database indexes (1 hour)
5. Consolidate time formatting functions (30 minutes)
6. Create architecture diagram (1 hour)

**Total effort for quick wins: ~5 hours**
**Expected impact: Significant improvement in maintainability and debugging**

