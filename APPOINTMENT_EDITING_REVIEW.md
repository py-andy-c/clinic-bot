# Appointment Editing Business Logic Review

## Current Implementation Analysis

### What We Have

1. **Practitioner-Specific Cache Keys** (`${practitionerId}-${date}`)
   - Prevents cache pollution when switching practitioners
   - Allows cache reuse when switching back to a previously selected practitioner
   - Requires updating cache keys in 5 files

2. **Practitioner Status Check** (`getPractitionerStatus`)
   - Pre-flight check before fetching slots
   - Catches "no availability configured" early
   - Shows error: "此治療師尚未設定每日可預約時段"
   - Adds extra API call

3. **Batch API 404 Error Handling**
   - Catches "doesn't offer appointment type"
   - Shows error: "此治療師不提供此預約類型"
   - Handles error after batch API call

4. **Cache Clearing on Practitioner Change**
   - Clears cache when practitioner changes
   - Clears cache when error detected
   - Multiple clearing points

### User Flow Analysis

**Typical appointment editing flow:**
1. User opens edit modal (practitioner already selected)
2. User may change practitioner
3. User selects date/time
4. User saves

**Key observation:** Users rarely switch back and forth between practitioners in a single editing session.

## Simplification Opportunities

### Option 1: Remove Practitioner-Specific Cache Keys (Simplest)

**Change:**
- Use date-only cache keys
- Always clear entire cache when practitioner changes
- Accept cache loss when switching back (rare case)

**Benefits:**
- Simpler code (no practitioner ID in cache keys)
- Fewer places to update
- Still prevents cache pollution (cache is cleared on change)

**Trade-offs:**
- Lose cache when switching back to previous practitioner (acceptable for rare case)

**Files to change:**
- Remove practitioner ID from cache keys in 5 files
- Keep cache clearing logic (already exists)

### Option 2: Remove Practitioner Status Check

**Change:**
- Remove `getPractitionerStatus` call
- Let batch API handle all errors
- Show error message based on batch API response

**Benefits:**
- One less API call
- Simpler error handling (single path)
- Fewer state variables

**Trade-offs:**
- Slightly slower error feedback (after batch API call instead of before)
- Need to detect "no availability" vs "doesn't offer type" from batch response

**Current behavior:**
- Status check: Returns `has_availability: false` → immediate error
- Batch API: Returns empty slots → no error (just empty calendar)

**Issue:** Batch API returns empty slots (not an error) when practitioner has no availability configured. So we can't distinguish between:
- "No availability configured" (should show error)
- "No slots available for these dates" (should show empty calendar)

**Conclusion:** Status check is actually necessary for good UX - it provides immediate feedback for a common error case.

### Option 3: Hybrid Approach (Recommended)

**Keep:**
- Practitioner status check (good UX, immediate feedback)
- Cache clearing on practitioner change (already works)

**Simplify:**
- Remove practitioner-specific cache keys
- Use date-only keys + always clear cache on practitioner change

**Rationale:**
- Cache reuse when switching back is rare (users don't typically switch back and forth)
- Simpler code (no practitioner ID in keys)
- Still prevents cache pollution (cache is cleared)
- Status check provides good UX

## Recommended Simplification

### Remove Practitioner-Specific Cache Keys

**Why:**
1. Users rarely switch back to a previously selected practitioner
2. Cache clearing on practitioner change already prevents pollution
3. Simpler code (5 fewer places to maintain practitioner ID in keys)
4. Same user experience (cache is cleared anyway)

**Implementation:**
1. Change cache keys from `${practitionerId}-${date}` to `date`
2. Keep cache clearing effect (already clears on practitioner change)
3. Remove practitioner ID from all cache lookups

**Files to change:**
- `DateTimePicker.tsx` - Remove practitioner ID from cache keys
- `useDateSlotSelection.ts` - Remove practitioner ID from cache lookups
- `RescheduleFlow.tsx` - Remove practitioner ID from cache keys
- `Step3SelectDateTime.tsx` - Remove practitioner ID from cache keys

**Keep:**
- Practitioner status check (good UX)
- Cache clearing on practitioner change (prevents pollution)
- Error handling (necessary)

## Code Complexity Comparison

### Current (with practitioner-specific keys):
- Cache key format: `${practitionerId}-${date}` (5 files)
- Cache clearing: On practitioner change
- Status check: Yes
- Error handling: Two paths (status check + batch API)

### Simplified (date-only keys):
- Cache key format: `date` (simpler)
- Cache clearing: On practitioner change (same)
- Status check: Yes (same)
- Error handling: Two paths (same)

### Complexity Reduction:
- **5 files** → Simpler cache key format
- **~20 lines** → Fewer lines of code
- **Same functionality** → No user-facing changes

## Conclusion

**We are slightly over-engineering the cache solution.**

The practitioner-specific cache keys add complexity for a rare use case (switching back to a previously selected practitioner). Since we already clear the cache on practitioner change, we can simplify by using date-only keys without losing functionality.

**Recommendation:** Simplify cache keys to date-only, keep everything else.

