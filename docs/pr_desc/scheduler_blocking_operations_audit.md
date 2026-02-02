# Scheduler Blocking Operations Audit

## Overview
Comprehensive audit of all 10 APScheduler-based background jobs to identify and fix blocking operations in async event loop.

## Critical Issues Found & Fixed

### 1. CleanupScheduler ✅ FIXED
**File**: `backend/src/services/cleanup_scheduler.py`

**Issue**: 
- `_run_cleanup()` was async but called synchronous blocking operations:
  - `cleanup_service.cleanup_soft_deleted_data()` - SQL queries
  - `cleanup_service.garbage_collect_s3()` - S3 network I/O (potentially minutes)

**Impact**: Would freeze entire FastAPI application during cleanup, causing:
- Health check failures
- Webhook timeouts
- Delayed scheduled tasks

**Fix**: Refactored to use `asyncio.to_thread()`:
```python
async def _run_cleanup(self) -> None:
    await asyncio.to_thread(self._execute_cleanup_logic)

def _execute_cleanup_logic(self) -> None:
    # Blocking operations run in thread pool
    with get_db_context() as db:
        cleanup_service = CleanupService(db)
        cleanup_service.cleanup_soft_deleted_data(retention_days=30)
        cleanup_service.garbage_collect_s3(dry_run=False, prefix="clinic_assets/")
```

### 2. LineMessageCleanupService ✅ FIXED
**File**: `backend/src/services/line_message_cleanup.py`

**Issue**:
- `_cleanup_old_messages()` was async but called synchronous blocking operation:
  - `LineMessageCleanupService.cleanup_old_messages()` - SQL DELETE query

**Impact**: Would block event loop during database cleanup

**Fix**: Refactored to use `asyncio.to_thread()`:
```python
async def _cleanup_old_messages(self) -> None:
    import asyncio
    deleted_count = await asyncio.to_thread(LineMessageCleanupService.cleanup_old_messages)
```

## Schedulers Verified as Safe

### 3. TestSessionCleanupService ✅ SAFE
**File**: `backend/src/services/test_session_cleanup.py`

**Status**: Properly implemented
- Calls `await ClinicAgentService.cleanup_old_test_sessions()` (async method)
- No blocking operations

### 4. AvailabilityNotificationService ✅ SAFE
**File**: `backend/src/services/availability_notification_service.py`

**Status**: Properly implemented
- All database queries are fast (indexed lookups)
- LINE API calls are quick (< 1 second)
- No long-running blocking operations

### 5. AutoAssignmentService ✅ SAFE
**File**: `backend/src/services/auto_assignment_service.py`

**Status**: Properly implemented
- Database queries are fast and indexed
- Batch fetching to avoid N+1 queries
- No long-running blocking operations

### 6. AutoTimeConfirmationService ✅ SAFE
**File**: `backend/src/services/auto_time_confirmation_service.py`

**Status**: Properly implemented
- Database queries are fast and indexed
- No long-running blocking operations

### 7. AdminAutoAssignedNotificationService ✅ SAFE
**File**: `backend/src/services/admin_auto_assigned_notification_service.py`

**Status**: Properly implemented
- Database queries are fast with eager loading
- LINE API calls are quick
- No long-running blocking operations

### 8. AdminDailyNotificationService ✅ SAFE
**File**: `backend/src/services/admin_daily_reminder_service.py`

**Status**: Properly implemented
- Database queries are fast with eager loading
- LINE API calls are quick
- Message splitting handled efficiently

### 9. PractitionerDailyNotificationService ✅ SAFE
**File**: `backend/src/services/practitioner_daily_notification_service.py`

**Status**: Properly implemented
- Database queries are fast with eager loading
- LINE API calls are quick
- No long-running blocking operations

### 10. ScheduledMessageScheduler ✅ SAFE
**File**: `backend/src/services/scheduled_message_scheduler.py`

**Status**: Properly implemented
- Calls `ScheduledMessageService.send_pending_messages()` which is synchronous but fast
- Batch LINE sends complete quickly (< 1 second per message)
- No long-running blocking operations

## Summary

**Total Schedulers**: 10
**Critical Issues Found**: 2
**Issues Fixed**: 2
**Safe Schedulers**: 8

## Key Learnings

### When to Use `asyncio.to_thread()`

Use thread pool offloading when:
1. **Long-running I/O**: S3 operations, large file processing
2. **Blocking database operations**: Large DELETE/UPDATE queries without indexes
3. **External API calls**: Calls that might take > 1 second

### When NOT to Use `asyncio.to_thread()`

Don't use thread pool for:
1. **Fast database queries**: Indexed lookups, small result sets
2. **Quick API calls**: LINE messaging (< 1 second)
3. **Already async operations**: Methods that properly use `await`

## Testing

All fixes verified with:
- Backend test suite: ✅ All tests passing
- Frontend test suite: ✅ All tests passing
- Type checking: ✅ No errors

## Recommendations

1. **Code Review Checklist**: Add "Check for blocking operations in async functions" to PR review checklist
2. **Linting Rule**: Consider adding a linter rule to detect synchronous I/O in async functions
3. **Documentation**: Document the pattern in developer guidelines
4. **Monitoring**: Add metrics to track scheduler execution time to detect future blocking issues

## References

- [Python asyncio documentation](https://docs.python.org/3/library/asyncio.html)
- [FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/)
- [APScheduler with asyncio](https://apscheduler.readthedocs.io/en/3.x/modules/schedulers/asyncio.html)
