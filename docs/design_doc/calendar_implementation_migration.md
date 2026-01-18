# Calendar Implementation Migration: From React Big Calendar to Mock UI Design

## Overview

This document outlines the implementation plan for migrating the clinic calendar from its current React Big Calendar-based implementation to match the production-ready mock UI design. The mock UI demonstrates superior user experience with unified sticky grid architecture, compact space-efficient design, and better mobile optimization.

**Goal:** Achieve pixel-perfect visual fidelity with the mock UI while preserving all existing production functionality including modals, state management, caching, and backend integration.

---

## Key Migration Decisions

### Features NOT Being Ported

Based on analysis of the mock UI design and current implementation, the following features will **not** be migrated:

#### 1. Touch/Swipe Gestures for Mobile Navigation
**Decision:** Remove swipe navigation entirely
**Rationale:**
- Mock UI relies exclusively on click-based navigation (buttons + mini calendar modal)
- Wide side-by-side practitioner view in daily view would conflict with horizontal swiping
- Horizontal swiping reserved for navigating between practitioners instead of dates
- Simplifies implementation and removes gesture complexity

#### 2. Column Width Synchronization in Week View
**Decision:** Remove complex synchronization logic
**Rationale:**
- Mock UI uses simple flex layout (`flex: 1`) with `min-width` properties
- CSS automatically handles column width alignment between headers and body
- Eliminates 100+ lines of complex ResizeObserver synchronization code
- Better performance and maintainability

#### 3. Auto-scroll to 9AM Functionality
**Decision:** Fix mock UI "bug" - always scroll to current time instead of 9AM
**Rationale:**
- Mock UI has inconsistent behavior: scrolls to 9AM on load but current time on "today" button
- Current time scrolling is more user-friendly and practical
- Aligns with modern calendar applications that show current context
- Fixes the identified inconsistency in mock UI implementation

### Features Being Enhanced During Migration

#### Current Time Indicator & Auto-scroll
- **Implementation:** Scroll to current time on initial load AND when navigating to today
- **Enhancement:** Fix mock UI inconsistency by using current time consistently
- **Benefit:** Users see relevant current time context instead of arbitrary 9AM position

---

## Layout Constraints & Resolution

### ClinicLayout Constraints Analysis

The current ClinicLayout applies standard page layout constraints that prevent the calendar from achieving the mock UI's compact, edge-to-edge design:

```jsx
// Current ClinicLayout structure
<main className="max-w-7xl mx-auto py-2 md:py-6 sm:px-6 lg:px-8">
  <div className="px-4 py-2 md:py-6 sm:px-0 md:max-w-4xl md:mx-auto">
    {children} {/* Calendar content constrained here */}
  </div>
</main>
```

**Layout Issues:**
- **Width Constraints**: `max-w-7xl` (1280px) → `max-w-4xl` (896px) on desktop
- **Centering**: `mx-auto` centers content instead of full-width utilization
- **Padding Layers**: Multiple padding layers prevent edge-to-edge layout
- **Header Gap**: 24-48px gap between header and calendar content
- **Not Compact**: Calendar doesn't "touch the header directly and the left/right" as intended

### Chosen Solution: Calendar-Specific Layout Override

**Recommendation:** Implement a `CalendarLayout` wrapper component that overrides ClinicLayout constraints while preserving the shared header infrastructure.

**Why This Approach:**
- **Isolated Change**: Only affects calendar page, no risk to other clinic pages
- **Clean Implementation**: Proper React component, not CSS hacks
- **Maintainable**: Clear separation of concerns
- **Minimal Risk**: No changes to shared ClinicLayout component
- **Future-Proof**: Can be extended if other pages need full-width layout

**Implementation Strategy:**
1. **CalendarLayout Component**: Wraps calendar content to override ClinicLayout padding
2. **Full-Width Reset**: Uses negative margins to counteract centering and max-width constraints
3. **Header Integration**: Positions calendar directly below 64px ClinicLayout header
4. **Preserved Functionality**: Maintains all header navigation, user menu, and mobile behaviors

---

## Color Assignment Strategy

### Extended Color Palette for 10 Practitioners + 10 Resources

**Color Palette:** Extended 20-color palette to support separate limits for practitioners and resources
```typescript
// Extended palette: 10 primary + 10 secondary colors
const CALENDAR_COLORS = [
  // Primary set (practitioners - first 10)
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  // Secondary set (resources - next 10)
  '#7c3aed', '#be123c', '#ea580c', '#65a30d', '#0891b2',
  '#c2410c', '#7c2d12', '#365314', '#1e3a8a', '#581c87'
];
```

### Assignment Logic with Deselection/Reselection Handling

**Strategy:** Priority-based assignment with color persistence for better UX
```typescript
function assignCalendarColors(
  selectedPractitioners: number[],
  selectedResources: number[]
): Map<string, string> {
  const colors = new Map<string, string>();

  // Priority 1: Assign to practitioners (first 10 colors)
  selectedPractitioners.slice(0, 10).forEach((id, index) => {
    colors.set(`practitioner-${id}`, CALENDAR_COLORS[index]);
  });

  // Priority 2: Assign to resources (next 10 colors)
  selectedResources.slice(0, 10).forEach((id, index) => {
    const colorIndex = 10 + index; // Colors 10-19
    colors.set(`resource-${id}`, CALENDAR_COLORS[colorIndex]);
  });

  return colors;
}
```

### Deselection/Reselection Behavior

**Color Persistence:** When items are deselected and reselected, they maintain their assigned colors
- **Practitioners:** Always get colors 0-9 based on selection order
- **Resources:** Always get colors 10-19 based on selection order
- **Benefit:** Users get consistent visual feedback - same practitioner/resource always appears in the same color

**Example:**
1. Select Practitioner A → Gets color #3b82f6 (index 0)
2. Deselect Practitioner A
3. Select Practitioner B → Gets color #3b82f6 (index 0, now assigned to B)
4. Reselect Practitioner A → Gets next available color #10b981 (index 1)

**Why This Approach:**
- **Predictable:** Same item types get same color ranges
- **Scalable:** Supports 10 practitioners + 10 resources = 20 total
- **User-Friendly:** Color consistency for frequently used items
- **Simple:** No complex persistence logic required

---

## Current Implementation Context

### Calendar Architecture Overview

**Core Components:**
- `CalendarView.tsx` (~1800 lines): Main calendar component with complex state management
- `AvailabilityPage.tsx`: Page wrapper handling practitioner/resource selection
- `CalendarComponents.tsx`: Custom React Big Calendar components
- `calendar/` directory: 17 modal components for CRUD operations

**Key Production Features:**
- Multi-view calendar (day/week/month) with seamless switching
- Advanced state management with localStorage persistence
- Batch API calls with 5-minute TTL caching and request deduplication
- Complex modal system (appointment creation/editing/deletion, exceptions, conflicts)
- Auto-scroll to current time (Taiwan timezone)
- Practitioner/resource filtering with max selection limits
- Receipt management and checkout integration
- Conflict detection and real-time validation

### Mock UI Superior Design

**Key Improvements:**
- **Unified Sticky Grid:** Single viewport with CSS `position: sticky` for perfect alignment
- **Compact Design:** 28px time gutter, dynamic column widths, efficient space usage
- **Event Overlapping:** Smart percentage-based overlapping (15%/12%/calculated)
- **Current Time Indicator:** Taiwan timezone red line with auto-scroll
- **Integrated Sidebar:** View switcher and filters in fixed 240px sidebar
- **Mini Calendar Modal:** Clickable date display with direct date selection
- **Performance Optimized:** 70% DOM query reduction via cached references

**Visual Architecture:**
```
Global Header (64px - preserved for consistency)
├── Sidebar (240px fixed)
│   ├── View Switcher (月/週/日)
│   ├── Practitioner Filters (checkboxes)
│   └── Resource Filters (checkboxes)
├── Calendar Content
│   ├── Date Strip (navigation + actions)
│   ├── Unified Grid Viewport
│   │   ├── Sticky Header Row
│   │   ├── Sticky Time Column (28px)
│   │   └── Flexible Resource Columns
│   └── Mini Calendar Modal
```

---

## Migration Approach: React Grid Hybrid

### Chosen Strategy

**Implementation:** Replace React Big Calendar's grid rendering system with a custom React implementation that exactly matches the mock UI's unified sticky grid architecture, while preserving all existing React state management, modal functionality, and backend integration.

**Why This Approach:**
- Achieves pixel-perfect visual fidelity with the mock UI design
- Preserves all existing production functionality without regression
- Maintains React ecosystem benefits (TypeScript, testing, debugging)
- Enables moderate technical debt cleanup without complete rewrite
- Provides future-proof foundation for enhancements

### Technical Architecture

```
New Calendar Architecture:
ClinicLayout (preserved - global header)
└── CalendarLayout (new - overrides padding for full-width)
    └── AvailabilityPage (existing state management)
        ├── CalendarSidebar (new - replaces selector dropdown)
        │   ├── ViewSwitcher component
        │   ├── PractitionerFilter checkboxes
        │   └── ResourceFilter checkboxes
        ├── CalendarDateStrip (new - replaces toolbar)
        │   ├── Navigation arrows
        │   ├── Date display with mini calendar trigger
        │   └── Action buttons (+預約, +休診, 今, settings)
        ├── CalendarGrid (new - replaces React Big Calendar)
        │   ├── StickyHeader (time + resource headers)
        │   ├── TimeColumn (28px sticky left)
        │   └── ResourceColumns[] (flex layout)
        │       └── TimeSlots + Events (overlapping logic)
        ├── Modals (all existing - preserved)
        └── Inline action buttons (replaces FAB)
```

### Key Technical Decisions

#### 1. Grid Implementation
- **Custom CSS Grid:** Use CSS Grid for month view, Flexbox for time-based views
- **Sticky Positioning:** CSS `position: sticky` for headers and time column
- **Event Overlapping:** Port mock's overlapping logic to React components
- **Auto-scaling Columns:** Simple flex layout eliminates complex width synchronization
- **Performance:** React.memo, useMemo, and virtual scrolling for large datasets

#### 2. State Management Preservation
- **Maintain Existing:** Keep all current Redux/Zustand state and localStorage persistence
- **Add Grid State:** New state for grid-specific features (scroll position, time indicator)
- **Unified Updates:** Single source of truth for calendar data

#### 3. Modal System Integration
- **Preserve All Modals:** All 17 existing modal components remain unchanged
- **Event Triggers:** Calendar events trigger existing modal workflows
- **State Sync:** Modal content updates when calendar data refreshes

#### 4. API & Caching Integration
- **Preserve Caching:** Maintain existing 5-minute TTL cache with batch endpoints
- **Request Deduplication:** Keep in-flight request prevention logic
- **Error Handling:** Maintain 404 graceful handling for clinic switches

---

## Implementation Plan

### Phase 1: Foundation Setup (Week 1)

#### 1.1 Create CalendarLayout Component
**File:** `frontend/src/components/calendar/CalendarLayout.tsx`

**Requirements:**
- Override ClinicLayout padding and centering constraints
- Enable full-width, edge-to-edge calendar layout
- Position calendar directly below 64px ClinicLayout header
- Maintain all ClinicLayout header functionality
- Handle mobile responsive behavior properly

#### 1.2 Create Calendar Grid Component
**File:** `frontend/src/components/calendar/CalendarGrid.tsx`

**Requirements:**
- Implement unified sticky grid layout matching mock UI
- Support all three views: daily, weekly, monthly
- Handle dynamic column width calculation
- Include current time indicator (Taiwan timezone)
- Support event overlapping logic from mock UI

#### 1.3 Create Sidebar Component
**File:** `frontend/src/components/calendar/CalendarSidebar.tsx`

**Requirements:**
- Fixed 240px width matching mock UI
- View switcher (月/週/日 buttons)
- Practitioner filter checkboxes with color indicators
- Resource filter checkboxes with color indicators
- Mobile overlay behavior
- State persistence integration

#### 1.4 Create Date Strip Component
**File:** `frontend/src/components/calendar/CalendarDateStrip.tsx`

**Requirements:**
- Left-aligned navigation with date/time display
- Right-aligned action buttons (+預約, +休診, 今, settings)
- Mini calendar modal integration
- Mobile-responsive design

#### 1.5 Update Page Layout
**File:** `frontend/src/pages/AvailabilityPage.tsx`

**Changes:**
- Remove React Big Calendar dependency
- Integrate new sidebar, date strip, and grid components
- Maintain all existing modal functionality
- Replace FAB with inline action buttons (matches mock UI)
- Remove mobile chip components (sidebar handles selection display)

### Phase 2: Core Functionality Integration (Week 2)

#### 2.1 Event Rendering System
**Implement event rendering matching mock UI:**
- Dynamic event overlapping (15%/12%/calculated percentages)
- Color-coded events by practitioner/resource
- Smart text truncation with line clamping
- Exception events (gray background, dashed border)
- Resource events (dashed border pattern)

#### 2.2 Navigation and State Management
**Integrate with existing systems:**
- View switching (day/week/month)
- Date navigation (prev/next/today)
- Mini calendar modal
- State persistence (localStorage)
- URL parameter handling

#### 2.3 Mobile Responsiveness
**Ensure mobile compatibility:**
- Sidebar overlay behavior
- Touch gesture support
- FAB integration
- Responsive grid layout

### Phase 3: Advanced Features (Week 3)

#### 3.1 Performance Optimizations
**Implement mock UI performance features:**
- DOM element caching (7 frequently accessed elements)
- Reduced API calls (~70% reduction)
- Efficient re-rendering logic
- Memory management (no orphaned listeners/references)

#### 3.2 Event Interactions
**Maintain all production interactions:**
- Event click → open EventModal
- Slot click → navigate or create appointment
- Drag/drop support (if needed)
- Keyboard navigation

#### 3.3 Current Time Indicator
**Implement Taiwan timezone features:**
- Red line indicator showing current time
- Auto-scroll to position indicator optimally
- Hide when viewing past dates

### Phase 4: Testing and Polish (Week 4)

#### 4.1 Comprehensive Testing
**Test all functionality:**
- All three view modes (day/week/month)
- Event creation, editing, deletion
- Practitioner/resource filtering
- Mobile responsiveness
- Performance benchmarks

#### 4.2 Visual Accuracy
**Ensure exact match to mock UI:**
- Pixel-perfect alignment
- Color consistency
- Typography matching
- Spacing and layout

#### 4.3 Accessibility
**Maintain accessibility standards:**
- ARIA labels
- Keyboard navigation
- Screen reader support
- Touch targets (44px minimum)

---

## Features to Port: Comprehensive Checklist

### Core Calendar Features
- [ ] Multi-view support (day/week/month) with seamless switching
- [ ] Current time indicator with Taiwan timezone
- [ ] Dynamic event overlapping and stacking
- [ ] Practitioner/resource filtering with color coding (10 practitioners + 10 resources)
- [ ] Mini calendar modal for date navigation
- [ ] Action buttons integration (+預約, +休診, 今, settings)

### State Management & Persistence
- [ ] View and date state persistence (localStorage)
- [ ] Practitioner selection (primary + additional, max 10)
- [ ] Resource selection (max 10, separate from practitioners)
- [ ] Clinic-specific state isolation
- [ ] URL parameter handling

### Modal System (17 Components)
- [ ] EventModal (view/edit/delete events)
- [ ] CreateAppointmentModal (complex form with validation)
- [ ] EditAppointmentModal (with conflict checking)
- [ ] ExceptionModal (availability exceptions)
- [ ] DeleteConfirmationModal
- [ ] CancellationNoteModal/PreviewModal
- [ ] CheckoutModal/ReceiptListModal/ReceiptViewModal
- [ ] PractitionerSelectionModal/ServiceItemSelectionModal
- [ ] ConflictModal/NotificationModal

### API Integration & Caching
- [ ] Batch calendar endpoints (/calendar/batch)
- [ ] Resource calendar endpoints (/calendar/batch-resource)
- [ ] 5-minute TTL caching with smart invalidation
- [ ] Request deduplication (in-flight prevention)
- [ ] Error handling (404 graceful for clinic switches)

### Data Transformation & Events
- [ ] Complex event data structure (appointments/exceptions/resources)
- [ ] Color assignment (practitioner/resource specific)
- [ ] Receipt status integration (active/inactive tracking)
- [ ] Tooltip formatting with rich event details
- [ ] Auto-assigned appointment handling

### Mobile Optimization
- [ ] Inline action buttons (+預約, +休診, 今, settings)
- [ ] Responsive layouts (sidebar overlay on mobile)
- [ ] Touch-optimized interactions
- [ ] Adaptive UI components

### Advanced Features
- [ ] Conflict detection and real-time validation
- [ ] Receipt management and checkout flows
- [ ] Notification system integration
- [ ] Keyboard navigation support
- [ ] Auto-scroll to current time (Taiwan timezone)

---

## Code Deprecation Plan

### Components to Remove After Migration

**Desktop Selection Components:**
- `CalendarSelector.tsx` - Replaced by new `CalendarSidebar.tsx` with integrated filters
- Legacy dropdown selection UI no longer needed

**Mobile Chip Components:**
- `PractitionerChips.tsx` - Mobile chip display replaced by sidebar filter state
- `ResourceChips.tsx` - Mobile chip display replaced by sidebar filter state
- Chips were workaround for mobile selection; sidebar provides better UX

**Old Calendar Infrastructure:**
- `CalendarView.tsx` - Replaced by new `CalendarGrid.tsx` + supporting components
- `CalendarComponents.tsx` - Custom React Big Calendar components no longer needed
- `calendar.css` - React Big Calendar styles replaced by new component-specific CSS modules

**Hooks and Utilities (Partial):**
- Remove React Big Calendar dependencies from `CalendarView.tsx`
- Legacy column width synchronization logic in `useEffect`
- Touch gesture handling code (replaced by click navigation)

### Migration Strategy for Deprecation

**Phase 4 (Post-Migration Cleanup):**
- Remove deprecated components after 2-week stabilization period
- Update all imports and references
- Clean up unused CSS classes and styles
- Remove legacy calendar routes and redirects
- Update documentation and remove references to old components

**Safe Removal Checklist:**
- [ ] All new calendar functionality verified working
- [ ] No remaining imports of deprecated components
- [ ] User acceptance testing completed
- [ ] Performance benchmarks confirm no regressions
- [ ] Rollback plan documented (feature flags remain for 30 days)

**Replaced Components:**
- `FloatingActionButton.tsx` - replaced by inline action buttons in date strip
- `PractitionerChips.tsx` - replaced by sidebar checkboxes
- `ResourceChips.tsx` - replaced by sidebar checkboxes

**Preserved Components:**
- All modal components (EventModal, CreateAppointmentModal, etc.) - functionality preserved
- `AvailabilityPage.tsx` - refactored but core logic maintained
- State management hooks - enhanced but not replaced
- API integration utilities - maintained with improvements

---

## Success Criteria

### Visual Fidelity
- [ ] Exact pixel-perfect match with mock UI design
- [ ] Full-width, edge-to-edge layout (no ClinicLayout padding)
- [ ] Calendar touches header directly (no gap)
- [ ] Consistent color scheme, typography, and spacing
- [ ] Smooth animations and transitions
- [ ] Proper responsive behavior across all screen sizes

### Functional Completeness
- [ ] All calendar views (day/week/month) render correctly
- [ ] Event creation/editing/deletion flows work identically
- [ ] Practitioner and resource filtering functions properly (max 10 practitioners + max 10 resources separately)
- [ ] All modals open and function correctly
- [ ] State persistence maintained across sessions

### Performance Requirements
- [ ] No performance regression vs current implementation
- [ ] Smooth 60fps scrolling in all views
- [ ] Efficient event rendering for large datasets
- [ ] Mobile-optimized performance
- [ ] Reduced DOM queries (70% target)

### Code Quality
- [ ] TypeScript strict mode compliance
- [ ] Clean, maintainable component architecture
- [ ] Comprehensive test coverage (unit/integration/e2e)
- [ ] Proper error boundaries and logging
- [ ] Documentation for complex algorithms

---

## Risk Assessment & Mitigation

### Medium-Risk Areas

#### 1. Event Overlapping Logic Implementation
**Risk:** Complex overlapping calculations could have edge cases
**Mitigation:**
- Comprehensive unit tests for all overlapping scenarios
- Extensive manual testing with various event combinations
- Fallback to simple stacking if overlapping fails
- User acceptance testing for visual correctness

#### 2. Modal State Synchronization
**Risk:** Modals might not update correctly when calendar data refreshes
**Mitigation:**
- Preserve existing synchronization logic
- Add comprehensive integration tests
- Implement proper error boundaries
- Clear user feedback for state inconsistencies

#### 3. Performance with Large Datasets
**Risk:** Many practitioners + events could cause slowdowns
**Mitigation:**
- Virtual scrolling implementation for time slots
- React.memo and useMemo optimization
- Performance monitoring during development
- Load testing with realistic data volumes

#### 4. Mobile Interaction Complexity
**Risk:** Wide practitioner columns may require horizontal scrolling on mobile
**Mitigation:**
- Test horizontal scrolling behavior on various mobile devices
- Ensure touch targets remain accessible
- Verify action buttons are properly positioned in date strip
- User testing for mobile calendar navigation patterns

### Rollback Strategy
**Immediate Rollback:**
- Feature flag to switch between implementations
- Keep current calendar as backup component
- Database backup before deployment

**Gradual Rollout:**
- Internal testing first
- Beta user group testing
- Full rollout with performance monitoring
- A/B testing if needed

---

## Timeline & Effort Estimation

### Development Timeline
**Week 1:** Foundation (CalendarLayout, calendar grid, sidebar, date strip)
**Week 2:** Core functionality (events, caching, navigation)
**Week 3:** Modal integration and advanced features
**Week 4:** Testing, polish, and deployment

### Effort Breakdown
- **Week 1 (Foundation):** 1 week (1 developer)
- **Week 2 (Core Integration):** 1 week (1 developer)
- **Week 3 (Advanced Features):** 1 week (1 developer)
- **Week 4 (Testing & Polish):** 1 week (1 developer + QA)

**Total Development Effort:** 4 weeks (1 developer)
**Testing Effort:** 1 week (QA engineer)
**Grand Total:** 5 weeks

### Team Composition
- **Primary Developer:** Experienced React/TypeScript developer
- **QA Engineer:** For comprehensive testing and validation
- **Optional:** Additional developer for parallel development

---

## Conclusion

The React Grid Hybrid approach provides the optimal path to achieving pixel-perfect visual fidelity with the mock UI while preserving all critical production functionality. By implementing a custom calendar grid that matches the mock UI exactly while maintaining the existing React architecture for state management and modals, we achieve:

**Key Benefits:**
1. **Superior User Experience:** Unified sticky grid, compact full-width design, improved mobile UX (removed confusing swipe gestures)
2. **Layout Constraints Resolved:** Calendar-specific layout override achieves edge-to-edge design while preserving shared header
3. **Zero Functional Regressions:** All existing features preserved through careful integration
4. **Technical Debt Cleanup:** Removed complex column synchronization and inconsistent auto-scroll behavior
5. **Maintainable Architecture:** Clean, modern React implementation without library constraints
6. **Performance Improvements:** Reduced DOM queries, efficient rendering, better mobile performance
7. **Future-Proof Foundation:** Full control for future enhancements and customizations

**Success Factors:**
- Comprehensive testing strategy covering all edge cases
- Phased implementation with clear milestones and deprecation plan
- Risk mitigation through preserved architecture
- Performance monitoring and optimization
- User acceptance validation with updated selection limits (10 practitioners + 10 resources separately)

This migration will transform the calendar from a functional but technically constrained implementation into a modern, performant, and visually superior component that delights users while maintaining all the robust functionality they depend on. By strategically removing outdated patterns (swipe navigation, complex synchronization) and fixing UX inconsistencies (auto-scroll behavior), we deliver a cleaner, more intuitive calendar experience.