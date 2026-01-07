# ESLint Plugin: Clinic Cache

**⚠️ OBSOLETE - Migrated to React Query**

This ESLint plugin was designed to warn when clinic-specific endpoints were used with the old `useApiData` hook without explicit `activeClinicId` in dependencies.

**Status**: All components have been migrated from `useApiData` to React Query hooks. This plugin is no longer needed as React Query automatically handles clinic-specific caching.

## Purpose

This rule serves as a **warning** (not error) to:
- Educate developers about clinic-specific endpoints
- Catch edge cases where auto-injection might not work
- Encourage explicit inclusion of `activeClinicId` for maintainability

**Note**: The `useApiData` hook automatically injects `activeClinicId` for clinic-specific endpoints (Option 1 implementation), so this rule is primarily educational and defensive.

## Rule: `require-clinic-id-in-deps`

### What it checks

Warns when:
- `useApiData` is called with a clinic-specific endpoint
- The `dependencies` array doesn't explicitly include `activeClinicId` or `user?.active_clinic_id`

### Clinic-specific endpoints

The rule detects clinic-specific endpoints by:
1. **Method name matching**: `getClinicSettings`, `getMembers`, `getPractitioners`, etc.
2. **URL pattern matching**: `/clinic/*`, `/appointments/*`, `/patients/*`, etc.

### Examples

#### ❌ Will warn

```typescript
// Missing activeClinicId in dependencies
const { data } = useApiData(
  () => apiService.getClinicSettings(),
  {
    dependencies: [isLoading], // Missing activeClinicId
  }
);
```

#### ✅ Won't warn

```typescript
// Has activeClinicId in dependencies
const { data } = useApiData(
  () => apiService.getClinicSettings(),
  {
    dependencies: [isLoading, activeClinicId], // ✓ Includes activeClinicId
  }
);

// Or with user?.active_clinic_id
const { data } = useApiData(
  () => apiService.getClinicSettings(),
  {
    dependencies: [isLoading, user?.active_clinic_id], // ✓ Includes clinic ID
  }
);
```

## Configuration

The rule is configured in `.eslintrc.cjs`:

```javascript
plugins: ['react-refresh', 'eslint-plugin-clinic-cache'],
rules: {
  'clinic-cache/require-clinic-id-in-deps': 'warn',
}
```

**Note**: A symlink is required for ESLint to find the plugin. The symlink is created automatically or can be created manually:

```bash
cd frontend
ln -sf ../eslint-plugin-clinic-cache node_modules/eslint-plugin-clinic-cache
```

## Maintenance

When adding new clinic-specific endpoints:
1. Update `CLINIC_SPECIFIC_METHODS` in `index.js`
2. Update `CLINIC_SPECIFIC_URL_PATTERNS` if needed
3. Also update the same lists in `frontend/src/hooks/useApiData.ts`

