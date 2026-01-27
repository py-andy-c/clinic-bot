# Number Input Standards

This document defines the UX standards for all number input fields in the frontend application.

## Core Principles

All number inputs should provide a consistent, user-friendly experience that prevents common input mistakes.

## Required Behaviors

### 1. Wheel Protection

**Problem:** When a user scrolls the page with a trackpad/mouse wheel while a number input is focused, the value changes unintentionally.

**Solution:** All number inputs must prevent scroll wheel from changing values.

```tsx
import { preventScrollWheelChange } from '../utils/inputUtils';

<input
  type="number"
  onWheel={preventScrollWheelChange}
  ...
/>
```

### 2. Empty-to-Type Support

**Problem:** When using `parseInt(e.target.value) || 0` pattern, users cannot clear the field to type a new value - it immediately resets to the fallback.

**Solution:** Use the `useNumberInput` hook or `NumberInput` component which allows the field to be empty while typing, then falls back to a default value on blur.

```tsx
import { useNumberInput } from '../hooks/useNumberInput';

const quantityInput = useNumberInput(
  quantity,
  setQuantity,
  { fallback: 1, parseFn: 'parseInt', min: 1 }
);

<input
  type="number"
  value={quantityInput.displayValue}
  onChange={quantityInput.onChange}
  onBlur={quantityInput.onBlur}
  onWheel={preventScrollWheelChange}
/>
```

Or use the `NumberInput` component directly:

```tsx
import { NumberInput } from '../components/shared/NumberInput';

<NumberInput
  value={quantity}
  onChange={setQuantity}
  fallback={1}
  min={1}
/>
```

### 3. Step Size Standards

Use appropriate step sizes based on the type of value:

| Value Type | Step | Examples |
|------------|------|----------|
| Minutes | 5 | `duration_minutes`, `step_size_minutes` |
| Currency (TWD) | 10 | `amount`, `revenue_share`, prices |
| Quantity/Count | 1 | `quantity`, `occurrenceCount` |
| Hours | 1 | `hours_after`, `reminder_hours_before` |
| Days | 1 | `days_after`, `max_booking_window_days` |

```tsx
<input type="number" step="5" />   // Minutes
<input type="number" step="10" />  // Currency
<input type="number" step="1" />   // Others (default)
```

### 4. No Decimal Points for TWD

Taiwan Dollar uses whole numbers only (smallest unit is $1). Ensure:
- Use `parseFn: 'parseInt'` in `useNumberInput`
- Use `formatCurrency()` from `utils/currencyUtils` for display

## Implementation Patterns

### Pattern A: React Hook Form with register()

For inputs using react-hook-form's `register()`, just add wheel protection:

```tsx
<input
  type="number"
  step="5"
  {...register('duration_minutes', { valueAsNumber: true })}
  onWheel={preventScrollWheelChange}
/>
```

Note: `register()` uses an uncontrolled pattern that naturally allows empty-to-type.

### Pattern B: Controlled Input with useNumberInput

For controlled inputs that need empty-to-type behavior:

```tsx
const amountInput = useNumberInput(
  amount,
  setAmount,
  { fallback: 0, parseFn: 'parseInt', min: 0, round: true }
);

<input
  type="number"
  step="10"
  value={amountInput.displayValue}
  onChange={amountInput.onChange}
  onBlur={amountInput.onBlur}
  onWheel={preventScrollWheelChange}
/>
```

### Pattern C: FormInput Component

The `FormInput` component automatically adds wheel protection for `type="number"`:

```tsx
<FormInput
  name="booking_restriction_settings.step_size_minutes"
  type="number"
  min="5"
  max="60"
  step="5"
/>
```

### Pattern D: NumberInput Component

The `NumberInput` component includes all standards by default:

```tsx
<NumberInput
  value={price}
  onChange={setPrice}
  fallback={0}
  parseFn="parseInt"
  min={0}
  round={true}
  step={10}
/>
```

## Utilities Reference

| Utility | Location | Purpose |
|---------|----------|---------|
| `preventScrollWheelChange` | `utils/inputUtils.ts` | Prevents wheel scroll from changing value |
| `useNumberInput` | `hooks/useNumberInput.ts` | Hook for empty-to-type behavior |
| `NumberInput` | `components/shared/NumberInput.tsx` | Pre-built component with all standards |
| `formatCurrency` | `utils/currencyUtils.ts` | Format numbers as TWD currency |

## Checklist for New Number Inputs

- [ ] Has `onWheel={preventScrollWheelChange}` or uses `NumberInput`/`FormInput`
- [ ] Allows empty-to-type (uses `useNumberInput`, `NumberInput`, or `register()`)
- [ ] Has appropriate `step` attribute (5 for minutes, 10 for currency, 1 for others)
- [ ] Has `min` and `max` constraints where applicable
- [ ] Uses `parseInt` for whole numbers (no decimals for TWD)
