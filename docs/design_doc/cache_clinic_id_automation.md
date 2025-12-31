# Preventing Missing Clinic ID in Cache Keys

## Problem

When using `useApiData` for clinic-specific endpoints, developers must manually include `activeClinicId` in the dependencies array. Missing this causes stale data when switching clinics, leading to bugs like showing service items from the wrong clinic.

## Options

### Option 1: Auto-inject Clinic ID in useApiData (Recommended)

**Approach**: Modify `useApiData` to automatically include `activeClinicId` in cache keys for known clinic-specific endpoints.

**Implementation**:
- Define a set of clinic-specific method names (e.g., `getClinicSettings`, `getMembers`, `getPractitioners`)
- In `getCacheKey()`, check if method name is clinic-specific
- If yes, automatically append `user?.active_clinic_id` to dependencies before generating cache key
- Use `useAuth()` hook inside `useApiData` to access current clinic ID

**Pros**:
- Zero developer effort - works automatically
- Prevents entire class of bugs
- Backward compatible (existing code continues working)

**Cons**:
- Requires maintaining list of clinic-specific endpoints
- Slight performance overhead (checking method names)
- Less explicit - developers might not realize clinic ID is included

**Migration**: None needed - works with existing code.

---

### Option 2: Typed Wrapper Hooks

**Approach**: Create specialized hooks like `useClinicApiData()` that automatically include clinic ID.

**Implementation**:
```typescript
export function useClinicApiData<T>(
  fetchFn: () => Promise<T>,
  options: UseApiDataOptions<T> = {}
) {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  
  return useApiData(fetchFn, {
    ...options,
    dependencies: [...(options.dependencies || []), activeClinicId],
  });
}
```

**Pros**:
- Explicit and clear intent
- Type-safe
- Easy to migrate incrementally

**Cons**:
- Requires migration of existing code
- Developers must remember to use `useClinicApiData` instead of `useApiData`
- Two hooks to maintain

**Migration**: Replace `useApiData` with `useClinicApiData` for clinic-specific calls.

---

### Option 3: Enhanced sharedFetchFunctions

**Approach**: Make `sharedFetchFunctions` clinic-aware by binding clinic context.

**Implementation**:
- Modify `sharedFetchFunctions` to be factory functions that accept clinic ID
- Update `useApiData` to detect `sharedFetchFunctions` usage and auto-include clinic ID
- Or: Create `createClinicFetchFunctions(clinicId)` that returns bound functions

**Pros**:
- Centralized clinic context management
- Clear separation between clinic-specific and global endpoints

**Cons**:
- Requires refactoring all `sharedFetchFunctions` usage
- More complex API

**Migration**: Replace `sharedFetchFunctions.getClinicSettings()` with clinic-aware version.

---

### Option 4: ESLint Rule + TypeScript Types

**Approach**: Add linting/type checking to catch missing clinic IDs at development time.

**Implementation**:
- Create ESLint rule that flags `useApiData` calls with clinic-specific method names missing `activeClinicId` in dependencies
- Add TypeScript utility types to mark clinic-specific fetch functions

**Pros**:
- Catches issues early
- No runtime changes
- Educational - teaches developers the pattern

**Cons**:
- Doesn't prevent bugs, only detects them
- Requires maintaining list of clinic-specific endpoints
- Can have false positives/negatives

**Migration**: Add linting rule, fix existing violations.

---

### Option 5: Hybrid: Auto-inject + Linting

**Approach**: Combine Option 1 (auto-inject) with Option 4 (linting) for defense in depth.

**Implementation**:
- Auto-inject clinic ID for known clinic-specific endpoints (Option 1)
- Add ESLint rule to warn when clinic-specific endpoints are used without explicit clinic ID dependency (catches edge cases)
- Document which endpoints are clinic-specific

**Pros**:
- Best of both worlds - automatic prevention + early detection
- Handles 95% of cases automatically
- Linting catches edge cases and educates developers

**Cons**:
- Most complex to implement
- Requires maintaining endpoint list in two places

**Migration**: Implement auto-inject first, add linting rule, document.

---

## Recommendation

**Option 1 (Auto-inject) + Option 4 (Linting)** - Hybrid approach:

1. **✅ Completed**: Implemented auto-injection in `useApiData` for common clinic-specific endpoints
2. **✅ Completed**: Added ESLint rule to catch edge cases and educate developers
3. **Future**: Consider Option 2 (typed wrappers) for new code if pattern becomes common

This provides automatic prevention for the common case while maintaining developer awareness and catching edge cases.

## Implementation Status

- ✅ **Option 1**: Auto-injection implemented in `useApiData.ts`
- ✅ **Option 4**: ESLint rule implemented in `eslint-plugin-clinic-cache/`

## Implementation Details (Option 1)

### Approach: URL Pattern Matching (Preferred)

Instead of method name parsing, extract the actual endpoint URL from the axios request and match against URL patterns. This is more robust and handles wrapped/memoized functions.

```typescript
// Clinic-specific URL patterns (matches backend routes)
const CLINIC_SPECIFIC_URL_PATTERNS = [
  /^\/clinic\//,           // /clinic/settings, /clinic/members, etc.
  /^\/appointments/,       // Appointment endpoints are clinic-scoped
  /^\/patients/,           // Patient endpoints are clinic-scoped
  /^\/dashboard\/metrics/, // Dashboard metrics are clinic-specific
  // Add more patterns as needed
];

function isClinicSpecificEndpoint(url: string): boolean {
  return CLINIC_SPECIFIC_URL_PATTERNS.some(pattern => pattern.test(url));
}
```

### Alternative: Method Name Fallback

If URL extraction is not feasible, use method name matching as fallback:

```typescript
const CLINIC_SPECIFIC_METHODS = new Set([
  'getClinicSettings',
  'getMembers',
  'getPractitioners',
  'getServiceTypeGroups',
  'getAutoAssignedAppointments',
  'getDashboardMetrics',
  'getBatchPractitionerStatus',
  // Add more as needed - document in code comments
]);
```

### URL Extraction Strategy

**Option A: Extract from function execution** (requires async inspection)
- Call function with mock to capture URL (not recommended - side effects)

**Option B: Extract from axios interceptor** (recommended)
- Use axios request interceptor to capture URL before request
- Store URL in a WeakMap keyed by the fetch function
- Retrieve URL in `getCacheKey` from WeakMap

**Option C: Add metadata to fetch functions** (explicit)
- Add `__clinicSpecific: true` property to fetch functions
- Check for this property in `getCacheKey`

### Modified getCacheKey
```typescript
function getCacheKey(
  fetchFn: () => Promise<any>, 
  dependencies?: DependencyList,
  activeClinicId?: number | null,
  endpointUrl?: string | null  // Extracted from axios interceptor or metadata
): string {
  // ... existing code ...
  
  // Determine if endpoint is clinic-specific
  const isClinicSpecific = endpointUrl 
    ? isClinicSpecificEndpoint(endpointUrl)
    : (methodMatch && CLINIC_SPECIFIC_METHODS.has(methodMatch[1]));
  
  if (isClinicSpecific) {
    // Auto-inject clinic ID for clinic-specific endpoints
    // Note: null is included (differentiates "no clinic" vs "clinic 1")
    let effectiveDeps = dependencies || [];
    if (activeClinicId !== undefined) {
      effectiveDeps = [...effectiveDeps, activeClinicId];
    }
    // Use effectiveDeps for cache key generation
  }
  
  // ... rest of existing code ...
}
```

### Modified useApiData
```typescript
export function useApiData<T>(...) {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  
  // Note: useAuth() is already used in many components, so this dependency is acceptable
  // It won't cause unnecessary re-renders since user object reference is stable
  
  // Extract endpoint URL from fetch function metadata or axios interceptor
  const endpointUrl = extractEndpointUrl(fetchFn);
  
  // Pass activeClinicId and endpointUrl to getCacheKey
  const cacheKey = getCacheKey(fetchFn, currentDeps, activeClinicId, endpointUrl);
  // ... rest of existing code ...
}
```

## Addressing Feedback Concerns

### 1. Method Name Parsing Fragility
**Solution**: Prefer URL pattern matching over method name parsing. If method names must be used, document limitations and add fallback detection.

### 2. Maintenance Burden
**Solution**: 
- Use URL patterns (e.g., `/clinic/*`) to auto-detect clinic-specific endpoints
- Document all clinic-specific endpoints in code comments
- Consider deriving list from backend route definitions if available

### 3. useAuth Dependency
**Solution**: 
- `useAuth()` is already used throughout the codebase, so adding it to `useApiData` is consistent
- User object reference is stable, so won't cause unnecessary re-renders
- Document this dependency clearly

### 4. Null Handling
**Solution**: 
- Explicitly include `null` in cache keys (differentiates "no clinic" vs "clinic 1")
- Document this behavior: `activeClinicId !== undefined` means both `null` and numbers are included

### 5. Testing Requirements
**Test Cases**:
- Clinic switching scenarios (verify cache keys change)
- Null/undefined clinic ID cases
- Non-clinic-specific endpoints (should not auto-inject)
- Wrapped/memoized functions (verify URL extraction works)
- Edge cases with method name fallback

## Migration Notes

- **Backward Compatible**: Existing code continues working
- **Gradual Enhancement**: Can start with method name matching, migrate to URL patterns later
- **Documentation**: Update developer docs to explain auto-injection behavior

