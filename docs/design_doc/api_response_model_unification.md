# Design Doc: Practitioner API Response Unification & Consistency

## 1. Problem Statement

Currently, practitioner data and settings are inconsistent across different API endpoints. This is caused by manual field mapping and fragmented response models.

### Symptoms:

* **Visual Non-Persistence**: Settings changed by users (like `patient_booking_allowed` or `compact_schedule_enabled`) may appear to "revert" to defaults if the API endpoint used to refresh the page doesn't include those fields.
* **Fragmented Models**: `PractitionerListItemResponse`, `MemberResponse`, and `PractitionerResponse` have drifted apart, leading to different data being available in the Team Management page vs. Appointment Settings page.
* **Maintenance Tax**: Adding a single field requires manual updates in service logic, multiple response models, and API mapping logic.

## 2. Proposed Changes (Robust & Maintainable)

We will unify how practitioner settings are handled by shifting to **Nested Pydantic Models** and **User/Staff separation**.

### A. Unify Shared Response Models (Nested & Inherited)

Instead of flattening fields, we will use the existing `PractitionerSettings` model. We will also separate public data (for patients) from sensitive data (for staff).

```python
# backend/src/api/responses.py

class PractitionerPublicResponse(BaseModel):
    """Data safe for public/patient display."""
    id: int
    full_name: str
    display_name: str  # e.g. "羅安迪 院長" - formatted by backend
    offered_types: List[int]

class PractitionerFullResponse(PractitionerPublicResponse):
    """Data for clinic staff/admin dashboard."""
    roles: List[str]
    # Nested settings for consistency with Profile API
    settings: PractitionerSettings 
```

### B. Refactor Practitioner Service (Explicit Mapping)

Modify `PractitionerService` to return Pydantic objects instead of dictionaries. Avoid "magic" ORM mapping where multiple tables are involved (User + Association) to keep logic clear.

```python
# Example Service Logic
return PractitionerFullResponse(
    id=user.id,
    full_name=association.full_name,
    display_name=f"{association.full_name} {association.title}".strip(),
    roles=association.roles,
    settings=association.get_validated_settings(),
    offered_types=offered_types
)
```

### C. Eliminate Fragmented Response Models

Replace local models like `PractitionerListItemResponse` with the unified `PractitionerFullResponse`.

### D. Standardize "Nesting"

The frontend currently expects some fields at the top level and others in `.settings`. We will move everything into `.settings` to match the `Profile` API.

## 3. Implementation Plan

### Phase 1: Model Update (Completed ✅)

1. Update `backend/src/api/responses.py` with `PractitionerPublicResponse` and `PractitionerFullResponse`.
2. Ensure `PractitionerSettings` has all necessary fields (already matches DB structure).

### Phase 2: Service Layer (Completed ✅)

1. Refactor `PractitionerService.list_practitioners_for_clinic` to return `List[PractitionerFullResponse]`.
2. Centralize the `display_name` formatting logic here.

### Phase 3: API Alignment (Backend) (Completed ✅)

1. **Refactor Team Management (`/members`)**:
   * Update `backend/src/api/clinic/members.py` to use `PractitionerService` for members with the `practitioner` role.
   * Unify the response structure so that practitioners in the member list have the same nested `.settings` object as the specialized practitioner list.
2. **Standardize Specialized APIs**:
   * Delete local `PractitionerListItemResponse` and `PractitionerListResponse` in `practitioners.py`.
   * Update `list_practitioners` endpoint to return `PractitionerFullResponse` directly from the service.
3. **LIFF Clean-up**:
   * Switch `liff.py` from the deprecated `PractitionerResponse` to `PractitionerPublicResponse`.
   * Ensure the UI receives the backend-calculated `display_name` to simplify future frontend title logic.

### Phase 4: Frontend Update (Completed ✅)

1. Update `MembersPage.tsx` and `SettingsAppointmentsPage.tsx` to access fields via `.settings` (e.g., `p.settings.patient_booking_allowed` instead of `p.patient_booking_allowed`).

## 4. Expected Impact

* **Consistency**: The same practitioner data structure is used everywhere (Profile, Team, Appointments).
* **Security**: Patient-facing APIs no longer leak internal notification settings.
* **Maintenance**: Adding a new setting is now a 1-file change (update `PractitionerSettings`).
* **Persistence**: All settings will correctly persist after refresh as they are now Part of the core response.
