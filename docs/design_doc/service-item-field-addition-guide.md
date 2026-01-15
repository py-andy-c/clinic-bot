# Adding a New Field to Service Item Edit Modal

## Overview
This guide outlines the essential changes needed to add a new field to the service item (appointment type) edit modal. Based on the `allow_multiple_time_slot_selection` field implementation.

## Frontend Changes

### 1. ServiceItemEditModal Component

#### Form Schema
Add the field to the Zod schema:
```typescript
allow_multiple_time_slot_selection: z.boolean().optional(),
```

#### Default Values
Add to both the `defaultValues` object and the `reset()` call:
```typescript
allow_multiple_time_slot_selection: appointmentType.allow_multiple_time_slot_selection ?? false,
```

#### UI Component
Add the form field component:
```jsx
<FormField
  control={control}
  name="allow_multiple_time_slot_selection"
  render={({ field }) => (
    <FormItem>
      <FormLabel>允許患者選擇多個時段</FormLabel>
      <FormControl>
        <Checkbox
          checked={field.value}
          onCheckedChange={field.onChange}
        />
      </FormControl>
      <FormDescription>病患預約時可選擇多個偏好時段供診所確認</FormDescription>
    </FormItem>
  )}
/>
```

#### onUpdate Handler
Include the field in the updated item object:
```typescript
allow_multiple_time_slot_selection: currentValues.allow_multiple_time_slot_selection ?? false,
```

### 2. Settings Service Items Page

Include the field in the save payload:
```typescript
allow_multiple_time_slot_selection: item.allow_multiple_time_slot_selection ?? false,
```

## Backend Changes

### 1. Response Model
Add the field to `AppointmentTypeResponse`:
```python
allow_multiple_time_slot_selection: bool = False
```

### 2. Settings API GET Response
Include the field in the response constructor:
```python
allow_multiple_time_slot_selection=at.allow_multiple_time_slot_selection,
```

### 3. Settings API Update Logic
Handle the field in the appointment type update logic:
```python
if "allow_multiple_time_slot_selection" in incoming_data:
    raw_value = incoming_data.get("allow_multiple_time_slot_selection")
    if raw_value is not None:
        existing_type.allow_multiple_time_slot_selection = bool(raw_value)
```

For new appointment types:
```python
allow_multiple_time_slot_selection=at_data.get("allow_multiple_time_slot_selection", False),
```

### 4. Database Model
Add the field to the `AppointmentType` model:
```python
allow_multiple_time_slot_selection: Mapped[bool] = mapped_column(default=False)
```

## Testing
- Run `./run_tests.sh` to ensure all tests pass
- Verify the field saves and loads correctly
- Test both true and false values

## Common Issues
1. **Field not saving**: Check all locations (frontend save payload, backend update logic, database model)
2. **UI not updating**: Verify defaultValues and form schema include the field
3. **Type errors**: Ensure TypeScript and Pydantic types match

## Checklist
- [ ] Frontend form schema updated
- [ ] Default values set in both places
- [ ] UI component added
- [ ] onUpdate handler includes field
- [ ] Save payload includes field
- [ ] Backend response model updated
- [ ] GET response includes field
- [ ] Update logic handles field
- [ ] Database model has field
- [ ] Tests pass