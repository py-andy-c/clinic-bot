# Facility-Based Appointment Constraints Design

## Overview

Extend the appointment system to consider facility resource constraints (e.g., treatment rooms, equipment) in addition to practitioner availability. Resources are clinic-specific and can be allocated to appointments automatically or manually.

## Goals

1. **Resource Management**: Allow clinics to define resource types and individual resources
2. **Automatic Allocation**: System automatically allocates resources when creating appointments
3. **Conflict Detection**: Resource conflicts are detected and displayed (lowest priority)
4. **Flexibility**: Clinic users can override resource constraints when needed
5. **Transparency**: Resource allocation visible to clinic users, hidden from patients

## Core Concepts

### Resource Types
- Categories of resources (e.g., "治療室" - Treatment Room, "設備" - Equipment)
- Clinic-specific
- Resource requirements are defined at the service item level (not at resource type level)

### Resources
- Individual instances of a resource type (e.g., "治療室1", "治療室2")
- Belong to a resource type
- Have a name (required, unique within type) and description (optional)
- Auto-generated names with sequential numbering

### Resource Requirements
- Defined at the service item (appointment type) level only
- Each service item specifies which resource types it needs and the quantity required
- Stored in database as appointment_type → resource_type relationships
- Example: "物理治療" appointment type requires 1 "治療室" resource

### Resource Allocation
- When an appointment is created, system allocates required resources automatically
- One appointment can use multiple resources (of same or different types)
- Allocation is stored as appointment-resource relationships

## Business Logic

### Resource Management

#### Creating Resource Types
- Clinic admin creates resource types in "設備資源" settings page
- Resource type has a name (e.g., "治療室")

#### Creating Resources
- Under each resource type, clinic admin can create resources
- Default name pattern: `{ResourceTypeName}{Number}` (e.g., "治療室1", "治療室2")
- Number is auto-generated based on existing resources of that type
- User can edit name and add description
- Name must be unique within the resource type

#### Setting Resource Requirements
- Resource requirements are set on the "服務項目" (Service Items) settings page only
- For each appointment type, admin can specify:
  - Which resource types are required
  - Quantity needed for each resource type
- Example: "物理治療" appointment type requires 1 "治療室" resource
- This is the single source of truth for resource requirements (stored in database)

### Slot Calculation with Resource Constraints

#### Available Slot Calculation
- Current logic: Check practitioner availability (default schedule, exceptions, existing appointments)
- **New**: Also check resource availability
- For each time slot:
  1. Check if practitioner is available (existing logic)
  2. Check if required resources are available:
     - Get all resource requirements for the appointment type (from service item settings)
     - For each required resource type:
       - Count how many resources of this type are already allocated during this time slot
       - Check if available quantity >= required quantity
  3. Slot is only available if both practitioner AND resources are available

#### Resource Availability Check
- For a given time slot (start_time, end_time):
  - Query all appointments that overlap with this time slot
  - **Exclude canceled appointments** (only count confirmed appointments)
  - **Exclude current appointment** when editing (use exclude_calendar_event_id parameter)
  - For each overlapping appointment, get its allocated resources
  - Count how many resources of each type are allocated
  - **Exclude soft-deleted resources** from total count (only count active resources)
  - Available quantity = Total active resources of type - Allocated resources of type

### Conflict Detection

#### Conflict Priority (Updated)
1. **Past Appointment** (Highest Priority)
2. **Appointment Conflict**
3. **Availability Exception Conflict**
4. **Outside Default Availability**
5. **Resource Conflict** (Lowest Priority) - **NEW**

#### Resource Conflict Detection
- Checked when:
  - Calculating available slots (filters out slots with resource conflicts)
  - Creating/editing appointments (shows warning)
  - Viewing appointment modal (shows warning if conflict exists)
- Resource conflict occurs when:
  - Required quantity of a resource type > Available quantity at that time
- Conflict is detected at **resource type level**, not individual resource level
- Example: If 3 rooms exist, all booked, and 4th appointment is created (bypassing constraint), all 4 appointments show resource conflict warning

#### Resource Conflict Display Format
```
⚠️ 資源不足：{ResourceTypeName}
   需要數量：{RequiredQuantity}
   可用數量：{AvailableQuantity}
   時間：{Date} {StartTime}-{EndTime}
```

### Resource Selection During Appointment Creation

#### Resource Selection Logic (Frontend Preview)
- Resource selection works the same regardless of override mode (ON or OFF)
- **Note**: This is frontend preview selection. Final allocation happens in backend when appointment is created.
- When appointment time, practitioner, and appointment type are selected:
  1. Get all required resource types and quantities (from appointment type requirements)
  2. For each required resource type:
     - Find available resources at that time slot (exclude canceled appointments, exclude current appointment if editing)
     - Auto-select the required quantity of resources (simple: first available resources)
     - If insufficient resources available, auto-select what's available and show quantity warning
  3. Selection updates in real-time as user selects time (with debouncing, ~300ms)
- If user changes time, re-allocate resources:
   - Check if currently selected resources are still available at new time
   - If yes, keep them (prefer keeping same resources)
   - If no, select new available resources
   - If some resources unavailable, keep available ones, replace unavailable ones, show warning
- When editing existing appointment:
  - System tries to keep currently allocated resources if still available at new time
  - If resources no longer available, auto-select new available resources

#### Resource Selection UI
- UI shows all resources of required types
- Available resources: Normal display, selectable
- Unavailable resources: Grayed out with indicator, but still selectable (allows bypassing constraint)
- No quantity selector needed:
  - If appointment type requires 2 rooms, system auto-selects 2 rooms by default
  - If user deselects resources and quantity falls below requirement, show warning
  - If appointment type needs 2 rooms but only 1 available, auto-select the 1 available and show quantity warning
- User can:
  - Change selected resources (select any resource, available or unavailable)
  - Deselect resources (if quantity falls below requirement, show warning)
  - Select unavailable resources (with warning, allows bypassing constraint)

### Resource Display

#### Appointment Modal
- Display allocated resources after appointment name, before clinic notes
- Format: `{ResourceName1} {ResourceName2}` (space-separated, no prefix or commas)
- If resource conflict exists, show warning icon with conflict details

#### Calendar Event Display
- Format: `{EventName} {ResourceName1} {ResourceName2} | {ClinicNotes}`
- Resource info appears after event name, before clinic notes (space-separated, no "資源：" prefix or commas)

#### Patient View (LIFF)
- **No resource information shown to patients**
- Resource concept is completely hidden
- Available slots already consider resource availability (transparent to patient)
- Availability notifications consider resource availability

### Resource Calendar View

#### Adding Resource Calendars
- On calendar page, user can add resource calendars to the view (similar to adding practitioner calendars)
- Resource calendars are hidden by default until user explicitly adds them
- Each resource can have its own calendar
- Calendar shows only active appointments using that resource (exclude canceled appointments)
- Calendar automatically displays overlapping events (double bookings) when they occur
- Visual distinction: Different color or pattern for resource calendar events
- Users can remove resource calendars from view (toggle on/off)

## User Experience

### Settings Page: 設備資源

#### Resource Type Management
- List of resource types
- Add new resource type button
- For each resource type:
  - Name
  - List of resources under this type
  - **Associated Service Items section (Read-only)**:
    - Shows which service items (appointment types) require this resource type
    - Displays service item name and required quantity
    - Prompt: "要修改資源需求，請前往「服務項目」設定頁面"
    - Link to navigate to 服務項目 page

#### Resource Management (under each resource type)
- List of resources
- "新增資源" button (creates with auto-generated name)
- For each resource:
  - Name (editable)
  - Description (optional, editable)
  - Delete button (with confirmation if resource has allocations)

### Settings Page: 服務項目

#### Resource Requirements Section
- For each appointment type, add section for resource requirements
- This is the **only place** where resource requirements can be edited
- Table showing:
  - Resource type
  - Required quantity
- Add/remove resource requirements
- Changes are saved only when "儲存設定" button is clicked (not immediately)
- This setting determines which resources are needed when creating appointments of this type

### Appointment Creation/Editing

#### Resource Selection UI (in Appointment Creation/Editing)
- **Only appears if appointment type has resource requirements**
- After selecting service type, practitioner, and time:
- Resource selection section appears
- For each required resource type:
  - Dropdown/selector showing all resources of that type
  - Selected resource(s) highlighted
  - Unavailable resources grayed out with indicator (but still selectable)
  - System auto-selects required quantity (no quantity selector needed)
- Real-time updates as time changes (debounced ~300ms)
- Warning displayed if:
  - Selected resources are unavailable
  - Selected quantity is below required quantity
- User can manually change selection or proceed with warning

#### Conflict Warnings
- When creating/editing: Show resource conflict warning in conflict detection area
- In appointment modal: Show warning icon if resource conflict exists
- Warning based on resource type (all appointments using that type show warning if conflict)

## Edge Cases and Questions

### Edge Cases

1. **Resource Deletion**
   - What if a resource is deleted while allocated to appointments?
   - **Proposal**: Prevent deletion if resource has active allocations (confirmed appointments only, exclude canceled). Show list of appointments using it. Require admin to reassign or cancel appointments first.

2. **Resource Type Deletion**
   - What if a resource type is deleted?
   - **Proposal**: Prevent deletion if any resources of this type have active allocations (confirmed appointments). Show list of affected appointments. Require admin to reassign or cancel appointments first. Do not allow cascade deletion.

3. **No Resources Available**
   - What if appointment type requires resources but no resources of that type exist?
   - **Proposal**: Show warning in slot calculation. Allow appointment creation with warning. System attempts to allocate but fails gracefully.

4. **Multiple Resources of Same Type**
   - How to allocate when appointment needs 2 rooms but only 1 available?
   - **Proposal**: Auto-select the 1 available room, show quantity warning. User can proceed or change time/resources.

5. **Recurring Appointments**
   - How to handle resource allocation for recurring appointments?
   - **Proposal**: Allocate resources for each occurrence independently. Check availability for each occurrence. Show conflicts per occurrence.

6. **Appointment Type Change**
   - What if user changes appointment type and new type requires different resources?
   - **Proposal**: Re-allocate resources based on new requirements. If previously allocated resources don't match new requirements, clear and re-allocate.

7. **Time Change**
   - What if user changes appointment time and resources are no longer available?
   - **Proposal**: Try to keep same resources if available. If not, auto-select new available resources. If none available, keep selection but mark unavailable with warning.

8. **Partial Resource Availability**
   - What if appointment needs 2 rooms, 1 is available at new time, 1 is not?
   - **Proposal**: Auto-select the available one, replace unavailable one with another available resource if possible, show quantity warning if still insufficient. User can select different resources or proceed with warning.

9. **Resource Requirements Change**
   - What if resource requirements are changed for a service item that already has appointments?
   - **Proposal**: Existing appointments keep their current resource allocations. New appointments use the updated requirements. No automatic re-allocation of existing appointments.

10. **Resource Calendar Overlap**
   - How to display when same resource is double-booked?
   - **Proposal**: Calendar automatically displays overlapping events. Show overlapping events with visual indication:
     - Reduced opacity (e.g., 70%) for overlapping events
     - Red border or warning indicator
     - Tooltip showing all overlapping appointments when hovering
     - Z-index based on appointment time (later appointments on top)
     - For 3+ simultaneous bookings, stack events with visual indication of count

11. **Appointment Cancellation**
   - What happens to resource allocations when an appointment is canceled?
   - **Proposal**: Resource allocations are released immediately when appointment is canceled. Resources become available for other appointments. Allocation records are kept for historical tracking but resources are no longer considered allocated.

12. **Resource Name Editing**
   - What if user edits resource name to conflict with another resource of the same type?
   - **Proposal**: Validate uniqueness on save. Show error if name conflicts. Prevent save until unique name is provided.

13. **Multiple Resource Types per Appointment**
   - What if an appointment needs multiple different resource types (e.g., 1 room + 1 equipment)?
   - **Proposal**: System handles this automatically. For each required resource type, allocate the required quantity. All resource types must be available for slot to be available.

14. **Edit Mode Resource Availability**
   - When editing an appointment, should we exclude it from resource availability checks?
   - **Proposal**: Yes, use exclude_calendar_event_id parameter when checking resource availability during edit. This allows keeping same resources if time doesn't change, or re-allocating if time changes.

15. **Resource Type with No Resources**
   - What if a resource type exists but has no active resources (all deleted or none created)?
   - **Proposal**: Allow appointment creation with warning. System attempts to allocate but fails gracefully. Show clear warning that no resources of this type are available.

16. **Resource Requirement Quantity Validation**
   - What if user sets quantity to 0 or negative?
   - **Proposal**: Validate minimum quantity of 1. Show error if quantity is less than 1. Prevent save until valid quantity is provided.
   - **Note**: Maximum quantity is not enforced (allows setting quantity > total resources for planning purposes). System will show conflict warnings when insufficient resources available.

17. **Resource Requirement Deletion**
   - What if a resource requirement is deleted while appointments exist that were created with that requirement?
   - **Proposal**: Existing appointments keep their current resource allocations. New appointments of that type will not require that resource. No automatic re-allocation of existing appointments.

18. **Resource Type Renaming**
   - What happens if a resource type is renamed?
   - **Proposal**: Update the name. Existing resources, requirements, and allocations remain unchanged. Only the display name changes.

19. **Resource Renaming While Allocated**
   - What if a resource is renamed while it's allocated to appointments?
   - **Proposal**: Update the name. Existing allocations remain unchanged. Only the display name changes. No impact on availability or conflicts.

20. **Concurrent Resource Allocation**
   - What if two appointments are created simultaneously for the same resource?
   - **Proposal**: Database constraints and transaction isolation handle this. First appointment gets the resource, second shows conflict warning. User can override if needed.

21. **Resource Type Name Uniqueness**
   - Should resource type names be unique within a clinic?
   - **Proposal**: Yes, resource type names should be unique within a clinic. Validate on save. Show error if name conflicts. Prevent save until unique name is provided.

22. **Resource Requirements for Deleted Appointment Types**
   - What if an appointment type is soft-deleted but still has resource requirements?
   - **Proposal**: Keep requirements in database. When appointment type is restored, requirements are still there. When appointment type is permanently deleted, cascade delete requirements.

23. **Resource Requirements for Deleted Resource Types**
   - What if a resource type is soft-deleted but still referenced in requirements?
   - **Proposal**: Show warning in service item settings that resource type is deleted. Prevent creating new appointments with this requirement (resource selection UI won't appear, but appointment can be created). Existing appointments keep their allocations. When resource type is restored, requirements work again.

24. **Resource Allocation for Auto-Assigned Appointments**
   - How does resource allocation work for auto-assigned appointments?
   - **Proposal**: Works the same way as manual appointments. System allocates required resources automatically when appointment is created. Resource selection happens after practitioner assignment.

25. **No Resource Requirements**
   - What if appointment type has no resource requirements?
   - **Proposal**: Resource selection UI does not appear. Appointment creation proceeds normally without resource allocation.

26. **Invalid Resource IDs from Frontend**
   - What if frontend sends invalid resource IDs (resource doesn't exist, wrong clinic, soft-deleted)?
   - **Proposal**: Backend validates all resource IDs. Invalid IDs are ignored. Backend auto-allocates valid resources to meet requirements. Show warning if some resources were invalid.

27. **Manual Resource Selection Below Requirement**
   - What if user manually deselects resources and quantity falls below requirement?
   - **Proposal**: Show warning but allow proceeding. Backend will attempt to allocate additional resources to meet requirement, or proceed with insufficient resources (showing conflict warning).

28. **Resource Calendar Time Range**
   - Should resource calendar show past appointments or only future?
   - **Proposal**: Show all appointments (past and future) for historical view. Filter option can be added later if needed.

### Questions for Discussion

1. **Resource Availability Windows**
   - Should resources have their own availability schedules (like practitioners)?
   - **Proposal**: Not in initial version. Resources are always available unless allocated. Can add availability windows later if needed.

2. **Resource Maintenance/Unavailability**
   - How to mark resources as temporarily unavailable (e.g., maintenance)?
   - **Proposal**: Leave as future work. Ideally should be time-based (similar to availability exceptions for practitioners), but for now resources are always available unless allocated.

3. **Resource Sharing Across Clinics**
   - Are resources clinic-specific or shared?
   - **Proposal**: Clinic-specific (matches current clinic model).

4. **Resource Capacity**
   - Can a resource handle multiple appointments simultaneously?
   - **Proposal**: No, one resource = one appointment at a time. If needed, create multiple resources.

5. **Resource Allocation Strategy**
   - How to choose which resource to allocate when multiple are available?
   - **Proposal**: Start simple - use first available resource ordered by name (deterministic). No load balancing needed initially.
   - **Future**: Can extend to round-robin, least-recently-used, or resource preferences/affinities

6. **Resource Conflict Resolution**
   - Should system suggest alternative times when resource conflict detected?
   - **Proposal**: Not in initial version. Just show warning. User can manually change time or resources.

7. **Historical Resource Allocations**
   - Should we track resource allocation history for past appointments?
   - **Proposal**: Keep allocation records even for canceled appointments (for reporting). Mark as canceled but don't delete.

8. **Resource Requirements Validation**
   - What if user sets quantity > total resources available?
   - **Proposal**: Allow it. System will always show conflict warning. Useful for planning (e.g., "we need 5 rooms but only have 3").

9. **Soft-Deleted Resources**
   - Should soft-deleted resources be excluded from allocation?
   - **Proposal**: Yes, soft-deleted resources should be excluded from availability checks and allocation. Only active resources are considered.

## Data Model (High Level)

### ResourceType
- id
- clinic_id
- name (unique within clinic_id)
- created_at, updated_at

### Resource
- id
- resource_type_id
- clinic_id
- name (unique within resource_type_id)
- description (optional)
- is_deleted (boolean, default false) - soft delete flag
- created_at, updated_at
- Note: Resource maintenance/unavailability (time-based) is left as future work. Soft-deleted resources are excluded from allocation.

### AppointmentResourceRequirement
- id
- appointment_type_id
- resource_type_id
- quantity
- created_at, updated_at
- Note: This is the single source of truth for resource requirements

### AppointmentResourceAllocation
- id
- appointment_id (calendar_event_id)
- resource_id
- created_at, updated_at

## Technical Design

### Database Models

```python
# backend/src/models/resource_type.py
class ResourceType(Base):
    __tablename__ = "resource_types"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]
    
    # Unique constraint: (clinic_id, name)
    __table_args__ = (UniqueConstraint('clinic_id', 'name', name='uq_resource_type_clinic_name'),)

# backend/src/models/resource.py
class Resource(Base):
    __tablename__ = "resources"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    resource_type_id: Mapped[int] = mapped_column(ForeignKey("resource_types.id", ondelete="RESTRICT"))
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]
    
    # Unique constraint: (resource_type_id, name)
    __table_args__ = (UniqueConstraint('resource_type_id', 'name', name='uq_resource_type_name'),)

# backend/src/models/appointment_resource_requirement.py
class AppointmentResourceRequirement(Base):
    __tablename__ = "appointment_resource_requirements"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    appointment_type_id: Mapped[int] = mapped_column(ForeignKey("appointment_types.id", ondelete="CASCADE"))
    resource_type_id: Mapped[int] = mapped_column(ForeignKey("resource_types.id", ondelete="RESTRICT"))
    quantity: Mapped[int] = mapped_column()  # Minimum 1, validated in service layer
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]
    
    # Unique constraint: (appointment_type_id, resource_type_id)
    __table_args__ = (UniqueConstraint('appointment_type_id', 'resource_type_id', name='uq_appt_resource_req'),)

# backend/src/models/appointment_resource_allocation.py
class AppointmentResourceAllocation(Base):
    __tablename__ = "appointment_resource_allocations"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    appointment_id: Mapped[int] = mapped_column(ForeignKey("calendar_events.id", ondelete="CASCADE"))  # calendar_event_id
    resource_id: Mapped[int] = mapped_column(ForeignKey("resources.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]
    
    # Unique constraint: (appointment_id, resource_id) - prevents double-booking
    __table_args__ = (UniqueConstraint('appointment_id', 'resource_id', name='uq_appt_resource_alloc'),)
```

### Core Shared Availability Logic

**Refactor**: Create shared core function that determines slot availability (practitioner + resources).

```python
# backend/src/services/availability_service.py

@dataclass
class SlotAvailabilityResult:
    """Result of checking if a time slot is available."""
    is_available: bool
    practitioner_available: bool
    resources_available: bool
    resource_conflicts: List[Dict[str, Any]]  # List of {resource_type_id, required, available}

@staticmethod
def check_slot_availability(
    db: Session,
    practitioner_id: int,
    date: date_type,
    start_time: time,
    end_time: time,
    appointment_type_id: int,
    clinic_id: int,
    schedule_data: Dict[int, Dict[str, Any]] | None = None,
    exclude_calendar_event_id: int | None = None,
    check_resources: bool = True
) -> SlotAvailabilityResult:
    """
    Core function to check if a time slot is available.
    
    Checks both practitioner availability and resource availability.
    Used by: slot calculation, conflict checking, availability notifications.
    
    Args:
        db: Database session
        practitioner_id: Practitioner ID
        date: Date to check
        start_time: Slot start time
        end_time: Slot end time
        appointment_type_id: Appointment type ID (for resource requirements)
        clinic_id: Clinic ID
        schedule_data: Pre-fetched schedule data (optional)
        exclude_calendar_event_id: Exclude this appointment from checks (for editing)
        check_resources: Whether to check resource availability (default: True)
    
    Returns:
        SlotAvailabilityResult with availability status
    """
    # 1. Check practitioner availability (existing logic)
    if schedule_data is None:
        schedule_data = AvailabilityService.fetch_practitioner_schedule_data(
            db, [practitioner_id], date, clinic_id, exclude_calendar_event_id
        )
    
    practitioner_data = schedule_data.get(practitioner_id, {
        'default_intervals': [],
        'events': []
    })
    
    default_intervals = practitioner_data['default_intervals']
    events = practitioner_data['events']
    
    practitioner_available = (
        AvailabilityService.is_slot_within_default_intervals(default_intervals, start_time, end_time)
        and not AvailabilityService.has_slot_conflicts(events, start_time, end_time)
    )
    
    # 2. Check resource availability (NEW)
    resources_available = True
    resource_conflicts = []
    
    if check_resources:
        from services.resource_service import ResourceService
        resource_result = ResourceService.check_resource_availability(
            db=db,
            appointment_type_id=appointment_type_id,
            clinic_id=clinic_id,
            start_time=datetime.combine(date, start_time),
            end_time=datetime.combine(date, end_time),
            exclude_calendar_event_id=exclude_calendar_event_id
        )
        resources_available = resource_result['is_available']
        resource_conflicts = resource_result['conflicts']
    
    is_available = practitioner_available and resources_available
    
    return SlotAvailabilityResult(
        is_available=is_available,
        practitioner_available=practitioner_available,
        resources_available=resources_available,
        resource_conflicts=resource_conflicts
    )
```

### Resource Service

```python
# backend/src/services/resource_service.py

class ResourceService:
    """Service for resource management and availability checking."""
    
    @staticmethod
    def check_resource_availability(
        db: Session,
        appointment_type_id: int,
        clinic_id: int,
        start_time: datetime,
        end_time: datetime,
        exclude_calendar_event_id: int | None = None
    ) -> Dict[str, Any]:
        """
        Check if required resources are available for a time slot.
        
        Args:
            db: Database session
            appointment_type_id: Appointment type ID
            clinic_id: Clinic ID
            start_time: Slot start datetime
            end_time: Slot end datetime
            exclude_calendar_event_id: Exclude this appointment from checks
        
        Returns:
            {
                'is_available': bool,
                'conflicts': List[{
                    'resource_type_id': int,
                    'resource_type_name': str,
                    'required_quantity': int,
                    'available_quantity': int
                }]
            }
        """
        # 1. Get resource requirements for appointment type
        requirements = db.query(AppointmentResourceRequirement).filter(
            AppointmentResourceRequirement.appointment_type_id == appointment_type_id
        ).all()
        
        if not requirements:
            return {'is_available': True, 'conflicts': []}
        
        # 2. For each required resource type, check availability
        conflicts = []
        is_available = True
        
        for req in requirements:
            # Count total active resources of this type
            total_resources = db.query(Resource).filter(
                Resource.resource_type_id == req.resource_type_id,
                Resource.clinic_id == clinic_id,
                Resource.is_deleted == False
            ).count()
            
            # Count allocated resources during this time slot
            # Note: Exclude soft-deleted calendar events and only count confirmed appointments
            allocated_count = db.query(AppointmentResourceAllocation).join(
                CalendarEvent, AppointmentResourceAllocation.appointment_id == CalendarEvent.id
            ).join(
                Appointment, CalendarEvent.id == Appointment.calendar_event_id
            ).filter(
                AppointmentResourceAllocation.resource_id.in_(
                    db.query(Resource.id).filter(
                        Resource.resource_type_id == req.resource_type_id,
                        Resource.clinic_id == clinic_id,
                        Resource.is_deleted == False
                    )
                ),
                CalendarEvent.clinic_id == clinic_id,
                CalendarEvent.is_deleted == False,  # Exclude soft-deleted calendar events
                CalendarEvent.date == start_time.date(),
                CalendarEvent.start_time < end_time.time(),
                CalendarEvent.end_time > start_time.time(),
                Appointment.status == 'confirmed'
            )
            
            if exclude_calendar_event_id:
                allocated_count = allocated_count.filter(
                    CalendarEvent.id != exclude_calendar_event_id
                )
            
            allocated_count = allocated_count.count()
            available_quantity = total_resources - allocated_count
            
            if available_quantity < req.quantity:
                is_available = False
                resource_type = db.query(ResourceType).filter(
                    ResourceType.id == req.resource_type_id
                ).first()
                conflicts.append({
                    'resource_type_id': req.resource_type_id,
                    'resource_type_name': resource_type.name if resource_type else 'Unknown',
                    'required_quantity': req.quantity,
                    'available_quantity': available_quantity
                })
        
        return {'is_available': is_available, 'conflicts': conflicts}
    
    @staticmethod
    def allocate_resources(
        db: Session,
        appointment_id: int,
        appointment_type_id: int,
        start_time: datetime,
        end_time: datetime,
        clinic_id: int,
        exclude_calendar_event_id: int | None = None
    ) -> List[int]:
        """
        Automatically allocate required resources for an appointment.
        
        Returns list of allocated resource IDs.
        """
        # Get requirements
        requirements = db.query(AppointmentResourceRequirement).filter(
            AppointmentResourceRequirement.appointment_type_id == appointment_type_id
        ).all()
        
        allocated_resource_ids = []
        
        for req in requirements:
            # Find available resources
            available_resources = ResourceService._find_available_resources(
                db, req.resource_type_id, clinic_id, start_time, end_time, exclude_calendar_event_id
            )
            
            # Allocate required quantity (simple: first available)
            to_allocate = min(req.quantity, len(available_resources))
            for i in range(to_allocate):
                allocation = AppointmentResourceAllocation(
                    appointment_id=appointment_id,
                    resource_id=available_resources[i].id
                )
                db.add(allocation)
                allocated_resource_ids.append(available_resources[i].id)
        
        return allocated_resource_ids
    
    @staticmethod
    def _find_available_resources(
        db: Session,
        resource_type_id: int,
        clinic_id: int,
        start_time: datetime,
        end_time: datetime,
        exclude_calendar_event_id: int | None = None
    ) -> List[Resource]:
        """Find available resources of a type for a time slot."""
        # Get all active resources of this type
        all_resources = db.query(Resource).filter(
            Resource.resource_type_id == resource_type_id,
            Resource.clinic_id == clinic_id,
            Resource.is_deleted == False
        ).all()
        
        # Get allocated resource IDs during this time
        # Note: Exclude soft-deleted calendar events and only count confirmed appointments
        allocated_query = db.query(AppointmentResourceAllocation.resource_id).join(
            CalendarEvent, AppointmentResourceAllocation.appointment_id == CalendarEvent.id
        ).join(
            Appointment, CalendarEvent.id == Appointment.calendar_event_id
        ).filter(
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.is_deleted == False,  # Exclude soft-deleted calendar events
            CalendarEvent.date == start_time.date(),
            CalendarEvent.start_time < end_time.time(),
            CalendarEvent.end_time > start_time.time(),
            Appointment.status == 'confirmed'
        )
        
        if exclude_calendar_event_id:
            allocated_query = allocated_query.filter(
                CalendarEvent.id != exclude_calendar_event_id
            )
        
        allocated_resource_ids = {r[0] for r in allocated_query.all()}  # Extract resource_id from tuple
        
        # Return available resources (ordered by name for deterministic selection)
        available = [r for r in all_resources if r.id not in allocated_resource_ids]
        return sorted(available, key=lambda r: r.name)  # Deterministic ordering by name
```

### Refactoring Existing Code

**1. Update `_calculate_available_slots` to use shared logic:**

```python
# Add appointment_type_id parameter to _calculate_available_slots
def _calculate_available_slots(
    db: Session,
    requested_date: date_type,
    practitioners: List[User],
    duration_minutes: int,
    clinic: Clinic,
    clinic_id: int,
    appointment_type_id: int,  # NEW: Required for resource checks
    exclude_calendar_event_id: int | None = None,
    schedule_data: Dict[int, Dict[str, Any]] | None = None,
    apply_booking_restrictions: bool = True,
    for_patient_display: bool = False
) -> List[Dict[str, Any]]:
    # ... existing code ...
    
    # Replace conflict check with shared logic:
    for slot_start, slot_end in candidate_slots:
        result = AvailabilityService.check_slot_availability(
            db=db,
            practitioner_id=practitioner.id,
            date=requested_date,
            start_time=slot_start,
            end_time=slot_end,
            appointment_type_id=appointment_type_id,
            clinic_id=clinic_id,
            schedule_data=schedule_data,
            exclude_calendar_event_id=exclude_calendar_event_id,
            check_resources=True
        )
        
        if result.is_available:
            available_slots.append({...})
```

**2. Update `check_scheduling_conflicts` to include resource conflicts:**

```python
# Add resource conflict check (lowest priority):
result = AvailabilityService.check_slot_availability(...)
if not result.resources_available:
    return {
        'has_conflict': True,
        'conflict_type': 'resource',
        'resource_conflicts': result.resource_conflicts,
        ...
    }
```

**3. Update availability notification service:**

```python
# In _fetch_availability_for_key, use check_slot_availability
# This ensures notifications consider resource availability
```

### Resource Auto-Selection Flow

**Two-Phase Process:**

**Phase 1: Preview/Selection (Frontend)**
- **When**: User selects service type, practitioner, and time in appointment creation modal
- **Who**: Frontend performs auto-selection for UI display
- **Flow**:
  1. Frontend calls `GET /clinic/appointments/resource-availability` with:
     - `appointment_type_id`
     - `practitioner_id`
     - `date` (YYYY-MM-DD)
     - `start_time` (HH:MM)
     - `end_time` (calculated from appointment type duration)
     - `exclude_calendar_event_id` (optional, for editing)
  2. Backend returns:
     - Required resource types and quantities
     - Available resources for each type at that time
     - Which resources are available/unavailable
     - Suggested allocation (auto-selected resource IDs)
  3. Frontend auto-selects:
     - For each required resource type, selects required quantity (first available)
     - If insufficient available, selects what's available and shows warning
  4. Updates happen in real-time as user changes time (debounced ~300ms)

**Phase 2: Final Allocation (Backend)**
- **When**: User confirms and creates appointment
- **Who**: Backend performs final allocation
- **Flow**:
  1. Frontend sends appointment data (including selected resource IDs) to `POST /clinic/appointments`
  2. Backend's `create_appointment` service:
     - Creates appointment
     - Calls `ResourceService.allocate_resources()` with selected resource IDs
     - Creates `AppointmentResourceAllocation` records in database
     - Validates selected resources are still available (handles race conditions)

**Endpoint for Resource Availability:**

```python
@router.get("/appointments/resource-availability")
async def get_resource_availability(
    appointment_type_id: int = Query(...),
    practitioner_id: int = Query(...),
    date: str = Query(..., description="YYYY-MM-DD"),
    start_time: str = Query(..., description="HH:MM"),
    end_time: str = Query(..., description="HH:MM"),
    exclude_calendar_event_id: int | None = Query(None),
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> ResourceAvailabilityResponse:
    """
    Get resource availability and suggested allocation for a time slot.
    
    Returns:
    {
        "requirements": [
            {
                "resource_type_id": 1,
                "resource_type_name": "治療室",
                "required_quantity": 2,
                "available_resources": [
                    {"id": 1, "name": "治療室1", "is_available": true},
                    {"id": 2, "name": "治療室2", "is_available": true},
                    {"id": 3, "name": "治療室3", "is_available": false}
                ],
                "available_quantity": 2
            }
        ],
        "suggested_allocation": [
            {"id": 1, "name": "治療室1"},
            {"id": 2, "name": "治療室2"}
        ],  # Auto-selected resources with names for display
        "total_quantity": 3,  # Total resources of this type (for context)
        "conflicts": []  # Always include, even when empty (for consistency with conflict detection format)
    }
    """
```

**Flow Diagram:**

```
User selects: Service Type + Practitioner + Time
         ↓
Frontend calls: GET /appointments/resource-availability
         ↓
Backend returns: Available resources + suggested allocation
         ↓
Frontend auto-selects: Required quantity (first available)
         ↓
UI displays: Selected resources (user can override)
         ↓
User confirms appointment
         ↓
Frontend calls: POST /clinic/appointments (with selected resource IDs)
         ↓
Backend creates appointment + allocates resources
```

### API Endpoints

```python
# backend/src/api/clinic.py

# Resource management endpoints
@router.get("/resource-types")
@router.post("/resource-types")
@router.put("/resource-types/{resource_type_id}")
@router.delete("/resource-types/{resource_type_id}")

@router.get("/resource-types/{resource_type_id}/resources")
@router.post("/resource-types/{resource_type_id}/resources")
@router.put("/resources/{resource_id}")
@router.delete("/resources/{resource_id}")

# Resource requirements (on service items page)
@router.get("/appointment-types/{appointment_type_id}/resource-requirements")
@router.post("/appointment-types/{appointment_type_id}/resource-requirements")
@router.put("/appointment-types/{appointment_type_id}/resource-requirements/{requirement_id}")
@router.delete("/appointment-types/{appointment_type_id}/resource-requirements/{requirement_id}")

# Resource availability (for appointment creation/editing)
@router.get("/appointments/resource-availability")  # NEW: For frontend auto-selection

# Resource allocation (when creating/editing appointments)
@router.get("/appointments/{appointment_id}/resources")
@router.put("/appointments/{appointment_id}/resources")  # Manual allocation override
```

### Appointment Creation/Edit Updates

```python
# backend/src/services/appointment_service.py

# In create_appointment, after creating calendar_event:
# Frontend sends selected_resource_ids in request
if appointment_type_id:
    # Get resource requirements
    requirements = db.query(AppointmentResourceRequirement).filter(
        AppointmentResourceRequirement.appointment_type_id == appointment_type_id
    ).all()
    
    if requirements:  # Only allocate if requirements exist
        if request.selected_resource_ids:
            # Validate selected resources (exist, active, correct clinic, available)
            validated_resources = ResourceService.validate_and_filter_resources(
                db, request.selected_resource_ids, clinic_id, start_time, end_time
            )
            
            # Check if validated resources meet requirements
            # If not, auto-allocate additional resources to meet requirements
            allocated_resources = ResourceService.allocate_with_selection(
                db, calendar_event.id, appointment_type_id, validated_resources,
                start_time, end_time, clinic_id
            )
        else:
            # Auto-allocate if frontend didn't provide selection
            allocated_resources = ResourceService.allocate_resources(
                db=db,
                appointment_id=calendar_event.id,
                appointment_type_id=appointment_type_id,
                start_time=start_time,
                end_time=end_time,
                clinic_id=clinic_id
            )

# In update_appointment, re-allocate if time/type changed:
if time_changed or appointment_type_changed:
    # Delete old allocations
    db.query(AppointmentResourceAllocation).filter(
        AppointmentResourceAllocation.appointment_id == appointment_id
    ).delete()
    
    # Use frontend-selected resources if provided, otherwise auto-allocate
    if request.selected_resource_ids:
        # Validate and create new allocations
        ...
    else:
        # Auto-allocate new resources
        ResourceService.allocate_resources(...)
```

### Frontend Changes

**1. Settings Page: 設備資源**
- New page: `frontend/src/pages/settings/SettingsResourcesPage.tsx`
- Resource type management UI
- Resource management UI
- Read-only service items association display

**2. Settings Page: 服務項目**
- Add resource requirements section to existing page
- Table to add/remove resource requirements

**3. Appointment Creation/Edit Modal**
- Add resource selection UI component
- Real-time resource availability checking (calls `/appointments/resource-availability`)
- Auto-selection with manual override
- Resource selection appears after service type, practitioner, and time are selected
- Updates in real-time as time changes (debounced ~300ms)
- Shows all resources of required types, with unavailable ones grayed out but still selectable

**4. Calendar Display**
- Update event display format: `{EventName} {ResourceName1} {ResourceName2} | {ClinicNotes}`
- Add resource calendar view option

**5. Conflict Detection**
- Update conflict detection to include resource conflicts (lowest priority)
- Display resource conflict warnings

### Migration Strategy

1. **Database Migration**: 
   - Create tables for resources, requirements, allocations
   - Add indexes as specified in Performance Considerations
   - Add foreign key constraints with appropriate `ON DELETE` behavior:
     - `AppointmentResourceAllocation.resource_id` → `RESTRICT` (prevent deletion if allocated)
     - `AppointmentResourceRequirement.resource_type_id` → `RESTRICT` (prevent deletion if referenced)
2. **Data Migration**:
   - Existing appointments without resource allocations: No action needed (they continue to work)
   - Existing appointment types: Default to no resource requirements (optional, backward compatible)
   - No need to backfill resource allocations for existing appointments
3. **Backend**: Implement resource service, refactor availability service
4. **API**: Add resource management endpoints
5. **Frontend**: Add settings pages, update appointment modals
6. **Testing**: Ensure all scheduling paths (slots, conflicts, notifications) work with resources

### Testing Strategy

**Unit Tests:**
- `ResourceService.check_resource_availability` with various scenarios (no requirements, insufficient resources, all available)
- `ResourceService.allocate_resources` with different resource availability states
- Resource selection logic (first available, deterministic ordering)

**Integration Tests:**
- Concurrent appointment creation for same resource (race condition handling)
- Resource allocation when appointment type changes
- Resource allocation when appointment time changes
- Resource release when appointment is canceled

**Performance Tests:**
- Slot calculation with many resources and appointments
- Resource availability queries with large datasets
- Batch resource availability checks

**Edge Case Tests:**
- All 28 documented edge cases
- Soft-deleted resources and resource types
- Invalid resource IDs from frontend
- Resource requirements exceeding available resources

### Performance Considerations

- **Batch Queries**: Resource availability checks use batch queries (similar to practitioner schedule data)
- **Caching**: Consider caching resource availability for common time ranges
- **Indexes**: Add indexes on:
  - `appointment_resource_allocations(appointment_id, resource_id)` - unique constraint
  - `appointment_resource_allocations(resource_id)` - for finding allocations by resource
  - `calendar_events(clinic_id, date, start_time, end_time, is_deleted)` - composite index for availability queries
  - `appointment_resource_requirements(appointment_type_id)` - for getting requirements
  - `resources(resource_type_id, clinic_id, is_deleted)` - composite index for resource queries
  - `appointments(calendar_event_id, status)` - for filtering confirmed appointments
- **Query Optimization**:
  - Use batch queries where possible (similar to practitioner schedule data)
  - Consider caching resource availability for common time ranges (invalidate on allocation changes)
  - Use CTEs or window functions for complex availability calculations
- **Debouncing**: Frontend debounces resource availability requests (~300ms) to avoid excessive API calls

### Additional Implementation Notes

**Resource Selection State Management:**
- Frontend maintains selected resource IDs in component state
- When time changes, frontend re-fetches availability and re-selects (preferring to keep same resources if still available)
- Selected resource IDs are sent to backend in appointment creation request

**Race Condition Handling:**
- Backend validates selected resources are still available when creating appointment
- Use database transaction with appropriate isolation level (READ COMMITTED or SERIALIZABLE)
- If ALL selected resources are unavailable, backend auto-allocates alternative resources (silently)
- If SOME selected resources are unavailable, backend uses available ones and auto-allocates for missing ones
- Frontend shows warning if backend had to change resource selection
- Database constraints prevent double-booking (unique constraint on appointment_id + resource_id)
- Consider using `SELECT FOR UPDATE` when checking availability before allocation in high-contention scenarios

**Editing Existing Appointments:**
- When editing, frontend loads currently allocated resources
- Frontend calls resource availability endpoint with `exclude_calendar_event_id` to exclude current appointment
- Frontend tries to keep same resources if still available at new time
- If resources unavailable, frontend auto-selects new available resources
- User can manually change resource selection before saving

**Recurring Appointments:**
- Each occurrence gets its own resource allocation (independent selection)
- Frontend calls resource availability endpoint for each occurrence independently
- Resource selection happens per occurrence (can be different resources for each)
- When editing one occurrence's time, system tries to keep same resources if available at new time
- If resources differ across occurrences, UI shows per-occurrence resource display
- Conflicts shown per occurrence in conflict resolution step
- When editing recurring appointments, resource selection is per-occurrence
- **Note**: No "same resource for all occurrences" option in initial version (can be added later)

**Resource Selection When Appointment Type Has No Requirements:**
- If appointment type has no resource requirements, resource selection UI does not appear
- Appointment creation proceeds normally without resource allocation
- No resource-related warnings or conflicts

**Error Handling:**
- Invalid resource IDs from frontend: Backend validates all IDs (exist, active, correct clinic, available)
- Invalid IDs are ignored, backend auto-allocates valid resources to meet requirements
- Show warning if some resources were invalid: "部分選取的資源無效，已自動重新分配"
- Resource type deleted but still referenced: Show warning in service item settings, prevent new appointments
- Concurrent allocation failures: Database constraint violation returns error, frontend shows error message

**Resource Conflict Warnings:**
- Resource conflicts are checked at resource type level (not individual resource)
- All appointments using a resource type show warning if that type has conflict
- Warnings shown in: conflict detection area, appointment modal, calendar event display
- Conflict data includes `resource_type_id` for easier frontend handling

**Soft-Delete Consistency:**
- All resource availability queries MUST filter `Resource.is_deleted == False`
- All calendar event queries MUST filter `CalendarEvent.is_deleted == False`
- Soft-deleted resources do NOT appear in resource selection UI
- Soft-deleted resource types show warning in service item settings but don't block appointment creation
- Consider using database views or query helpers to enforce soft-delete filtering consistently

**Resource Selection UI Component:**
- Component type: Multi-select dropdown or checkbox list (TBD based on number of resources)
- For many resources: Add search/filter functionality
- Accessibility: Keyboard navigation, screen reader support, ARIA labels
- Tooltip on unavailable resources: "此資源在此時間已被預約" (This resource is already booked at this time)

