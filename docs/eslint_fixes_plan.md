# ESLint Issues Summary & Fix Plan

## Current Status
- **Total Issues**: 538 (479 errors, 59 warnings)
- **Auto-fixable**: 12 errors

## Issue Breakdown

### Critical Issues (Must Fix First)
1. **React Hooks Rules Violations** (~20 errors)
   - Hooks called conditionally (after early returns)
   - Files: `PractitionerAssignmentConfirmationModal.tsx`, `PractitionerAssignmentPromptModal.tsx`, `PractitionerSelector.tsx`, `ResourceChips.tsx`, `MembersPage.tsx`, `PatientsPage.tsx` (test)

### High Priority
2. **TypeScript `any` Types** (~300+ errors)
   - `@typescript-eslint/no-explicit-any` violations across codebase
   - Most common issue, affects type safety

3. **React Hooks Dependencies** (59 warnings)
   - Missing dependencies in `useEffect`, `useMemo`, `useCallback`
   - Can cause stale closures and bugs

### Medium Priority
4. **Unused Variables** (~30 errors)
   - `@typescript-eslint/no-unused-vars`
   - Dead code that should be removed

5. **Variable Declarations** (~5 errors)
   - `prefer-const` - variables that should be `const`

6. **Console Statements** (~15 errors)
   - `no-console` in `errorTracking.ts` and `logger.ts`
   - Should use proper logging utilities

### Low Priority
7. **Regex Escapes** (4 errors)
   - `no-useless-escape` in `patientFormValidation.ts`

8. **TypeScript Comments** (2 errors)
   - `@typescript-eslint/ban-ts-comment` - use `@ts-expect-error` instead of `@ts-ignore`

## Phased Fix Plan

### Phase 1: Critical Fixes (Week 1)
**Goal**: Fix React Hooks violations that can cause runtime bugs

1. Fix conditional hook calls in:
   - `PractitionerAssignmentConfirmationModal.tsx`
   - `PractitionerAssignmentPromptModal.tsx`
   - `PractitionerSelector.tsx`
   - `ResourceChips.tsx`
   - `MembersPage.tsx`
   - Test files with hook violations

**Approach**: Move all hooks to top of component, before any conditional returns

### Phase 2: Auto-fixable & Quick Wins (Week 1)
**Goal**: Fix issues that can be automated or are trivial

1. Run `npm run lint -- --fix` to auto-fix 12 errors
2. Fix `prefer-const` issues (5 errors)
3. Fix `no-useless-escape` in regex (4 errors)
4. Replace `@ts-ignore` with `@ts-expect-error` (2 errors)

### Phase 3: Type Safety (Weeks 2-3)
**Goal**: Replace `any` types with proper types

1. **High-impact files first**:
   - `api.ts` (service layer)
   - `CalendarView.tsx` (complex component)
   - `CheckoutModal.tsx`
   - `CreateAppointmentModal.tsx`
   - `EditAppointmentModal.tsx`

2. **Then address**:
   - Component files
   - Page files
   - Utility files
   - Test files (lower priority)

**Approach**: 
- Use existing types from `schemas/api.ts` where possible
- Create specific types for event handlers, callbacks
- Use `unknown` with type guards when type is truly unknown

### Phase 4: React Hooks Dependencies (Week 3)
**Goal**: Fix missing dependencies in hooks

1. Review all `useEffect` hooks
2. Review all `useMemo` hooks
3. Review all `useCallback` hooks

**Approach**:
- Add missing dependencies
- Use `useCallback`/`useMemo` to stabilize function/object dependencies
- Add ESLint disable comments only when intentional (with explanation)

### Phase 5: Code Cleanup (Week 4)
**Goal**: Remove dead code and fix remaining issues

1. Remove unused variables and imports
2. Fix console statements:
   - Replace with proper logging in `errorTracking.ts`
   - Review `logger.ts` - may be intentional for development

## Execution Strategy

### Per-Phase Process
1. Create feature branch: `fix/eslint-phase-{N}`
2. Fix issues in that phase
3. Run `./run_frontend_tests.sh` to verify
4. Commit with clear message
5. Merge to main

### Tools
- `npm run lint -- --fix` for auto-fixable issues
- `npm run lint` to check progress
- `./run_frontend_tests.sh` to ensure no regressions

### Success Metrics
- Phase 1: 0 critical hook violations
- Phase 2: 23 fewer errors
- Phase 3: ~300 fewer errors
- Phase 4: 0 hook dependency warnings
- Phase 5: 0 remaining errors

## Estimated Timeline
- **Total**: 4 weeks
- **Phase 1**: 2-3 days (critical)
- **Phase 2**: 1 day
- **Phase 3**: 1.5-2 weeks (largest effort)
- **Phase 4**: 3-4 days
- **Phase 5**: 2-3 days

