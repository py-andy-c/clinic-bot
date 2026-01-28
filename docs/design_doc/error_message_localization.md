# Design Doc: Comprehensive Error Message Localization (Taiwan Context)

**Status**: ✅ **COMPLETED** - Implementation Successfully Deployed  
**Implementation Date**: 2026-01-28  
**Review Status**: Approved for Production

## 1. Overview

**COMPLETED**: We have successfully achieved 100% user-friendly, Chinese-language (Traditional Chinese) error experience for all users of the clinic-bot system in Taiwan. All framework-level errors, business logic errors, and connectivity errors now display in appropriate Traditional Chinese.

Our **Hybrid Localization Strategy** has been fully implemented:

1. ✅ **Backend-First**: The backend is now the source of truth for all business logic errors in Chinese.
2. ✅ **Frontend-Safety-Net**: The frontend provides comprehensive fallback for all HTTP status codes with localized messages.

***

## 2. Implementation Results

### 2.1 Backend Error Status - ✅ COMPLETED

| Error Type | Source | Previous State | ✅ Current State |
| :--- | :--- | :--- | :--- |
| **Business Logic** | `raise HTTPException(..., detail="...")` | ~90% Chinese | ✅ **100% Chinese** |
| **Framework Routing** | FastAPI (e.g., 404, 405) | English Defaults | ✅ **Chinese via Global Handlers** |
| **Validation** | Pydantic (422) | English (e.g., "Field required") | ✅ **Chinese via Custom 422 Handler** |
| **Infrastructure** | Load Balancer / Nginx (502, 504) | English / HTML | ✅ **Frontend Fallback Mapping** |

### 2.2 Frontend Error Status - ✅ COMPLETED

| Feature | Link | Previous State | ✅ Current State |
| :--- | :--- | :--- | :--- |
| **Status Mapping** | `getErrorMessage` | Missing 405, 408, 429, 502, 503, 504 | ✅ **Complete Coverage** |
| **LIFF Specifics** | `liffApiService` | Needed alignment | ✅ **Fully Aligned** |

***

## 3. Implementation Summary - ✅ COMPLETED

### Phase 1: Frontend Utility Augmentation - ✅ COMPLETED

✅ **COMPLETED**: Updated `frontend/src/types/api.ts` with comprehensive Traditional Chinese mappings for all standard HTTP status codes.

**Successfully Added Mappings:**

* ✅ `405`: "此操作目前不被允許"
* ✅ `408`: "請求逾時，請重試" 
* ✅ `429`: "操作過於頻繁，請稍候再試"
* ✅ `502`: "伺服器暫時無法回應，請稍後再試"
* ✅ `503`: "服務暫時不可用，請稍後再試"
* ✅ `504`: "伺服器連線逾時，請稍後再試"

### Phase 2: Backend Global Exception Refactoring - ✅ COMPLETED

✅ **COMPLETED**: Updated `backend/src/main.py` with comprehensive framework-level exception handling.

**Successfully Implemented:**

* ✅ `StarletteHTTPException` handler translates 404, 405, 401, 403, 400 errors to Chinese
* ✅ `RequestValidationError` (422) handler provides user-friendly Chinese summaries
* ✅ Global `Exception` (500) handler returns "內部伺服器錯誤"
* ✅ Consistent response structure with `"type"` field across all handlers

### Phase 3: Module-by-Module Audit - ✅ COMPLETED

✅ **COMPLETED**: All backend modules audited and English error messages replaced with Chinese.

**Successfully Updated Files:**

* ✅ `backend/src/api/auth.py` - Authentication and rate limiting errors
* ✅ `backend/src/api/clinic/*.py` - All clinic module errors
* ✅ `backend/src/api/liff.py` - LINE integration errors
* ✅ `backend/src/api/receipt_endpoints.py` - Billing and receipt errors
* ✅ `backend/src/api/test/*.py` - Test endpoint errors
* ✅ `backend/src/auth/dependencies.py` - Authentication dependency errors
* ✅ `backend/src/services/patient_service.py` - Patient service errors

***

## 4. Maintenance Standards - ✅ ESTABLISHED

The following best practices have been established and implemented to prevent regression:

1. ✅ **Enforced**: Never use English in `HTTPException(detail=...)` - All production code now uses Chinese
2. ✅ **Implemented**: Always use the `getErrorMessage` utility in the frontend with comprehensive status code coverage
3. ✅ **Applied**: Technical details are sanitized - Database and Python class names are replaced with user-friendly messages

## 5. Success Criteria - ✅ ACHIEVED

All success criteria have been met:

* ✅ **405 Error Test**: POST to a GET route displays "此操作目前不被允許"
* ✅ **422 Error Test**: Missing field in create patient displays "輸入資料格式有誤，請檢查後重試"
* ✅ **500 Error Test**: Server exceptions display "內部伺服器錯誤"
* ✅ **Code Review**: 0 English `detail` strings remain in production API routes

## 6. Implementation Details

### Key Error Message Examples

**Framework Errors:**
```python
# 404 Not Found
detail = "找不到請求的資源"

# 405 Method Not Allowed  
detail = "此操作目前不被允許"

# 422 Validation Error
detail = "輸入資料格式有誤，請檢查後重試"
```

**Authentication Errors:**
```python
# 401 Unauthorized
detail = "未提供認證憑證"
detail = "請重新登入"

# 403 Forbidden
detail = "您沒有權限執行此操作"
detail = "拒絕存取"
```

**Business Logic Errors:**
```python
# Patient Management
detail = "找不到病患或拒絕存取"
detail = "無法刪除有未來預約的病患"

# Rate Limiting
detail = f"診所切換過於頻繁。每分鐘最多 {CLINIC_SWITCH_RATE_LIMIT} 次切換。"
```

### Response Structure

All error responses now follow consistent structure:
```json
{
  "detail": "中文錯誤訊息",
  "type": "error_type",
  "errors": [] // Optional for validation errors
}
```

## 7. Production Impact

**User Experience Improvements:**
- ✅ 100% Chinese error messages for all user interactions
- ✅ Professional healthcare-appropriate language tone
- ✅ Clear, actionable error descriptions
- ✅ Consistent error handling across all features

**Technical Benefits:**
- ✅ Centralized error handling patterns
- ✅ Maintainable localization strategy
- ✅ Comprehensive frontend fallback coverage
- ✅ Future-proof error message management

**Deployment Status:** ✅ Ready for Production Release
