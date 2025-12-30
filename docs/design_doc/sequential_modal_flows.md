# Sequential Modal Flows Design

## Problem Statement

When completing a flow (e.g., creating an appointment), we often need to initiate another flow immediately after (e.g., prompting for practitioner assignment). The challenge is that:

1. **Component unmounting**: When the first modal closes via `onClose()`, the parent component unmounts it, losing all state
2. **State loss**: Any state needed for the second modal (prompt flags, data) is lost when the component unmounts
3. **Timing issues**: React's asynchronous state updates and component lifecycle make it difficult to coordinate transitions

This pattern will recur across many features (appointment creation → assignment prompt, patient creation → appointment creation, etc.), so we need a robust, generalizable solution.

## Current Architecture

- **BaseModal**: Shared modal component using React portals
- **ModalContext**: Simple alert/confirm modals (single modal at a time)
- **Calendar modals**: Managed by parent component state (e.g., `CalendarView` controls `CreateAppointmentModal` visibility)
- **Issue**: Calendar modals are conditionally rendered, so closing one unmounts it immediately

## Solution Options

### Option 1: Modal Queue/Stack System (Recommended)

**Approach**: Create a centralized modal manager that maintains a queue/stack of modals. When one modal completes, it can enqueue the next modal before closing.

**Implementation**:
```typescript
// ModalQueueContext
interface QueuedModal<T = any> {
  id: string;
  component: React.ComponentType<T>;
  props: T;
  priority?: number;
  onError?: (error: Error) => void;
}

const useModalQueue = () => {
  const enqueueModal = <T,>(modal: QueuedModal<T>) => { /* ... */ };
  const dequeueModal = (id: string) => { /* ... */ };
  const closeCurrent: () => Promise<void> = async () => { /* ... */ };
  const cancelQueue = () => { /* ... */ };
};
```

**Note**: Uses **queue-based (FIFO)** ordering for sequential flows. Stack-based (LIFO) can be added later if needed for priority interrupts.

**Pros**:
- ✅ Centralized control - single source of truth
- ✅ Handles complex sequences (A → B → C)
- ✅ Prevents state loss - queue persists across unmounts
- ✅ Generalizable - works for any modal sequence
- ✅ Can handle priority/overlay management

**Cons**:
- ⚠️ Requires refactoring existing modals
- ⚠️ More complex initial setup
- ⚠️ Modal registry optional (can use direct component references)

**Best for**: Long-term solution, complex workflows, multiple sequential modals

---

### Option 2: Deferred Close Pattern

**Approach**: Instead of closing immediately, modals can defer their close until after the next modal is shown. Use a callback pattern where `onClose` accepts a `nextAction` parameter.

**Implementation**:
```typescript
interface ModalProps {
  onClose: (nextAction?: () => void) => void;
}

// In CreateAppointmentModal.handleSave:
if (shouldShowPrompt) {
  onClose(() => {
    // This callback runs after modal closes
    showAssignmentPrompt();
  });
} else {
  onClose(); // Normal close
}
```

**Pros**:
- ✅ Minimal changes to existing code
- ✅ Simple to understand
- ✅ Works with current architecture

**Cons**:
- ⚠️ Still requires parent to manage second modal
- ⚠️ Doesn't solve state persistence issue
- ⚠️ Limited to simple A → B sequences
- ⚠️ Parent component needs to handle callback

**Best for**: Quick fix, simple two-step flows, minimal refactoring

---

### Option 3: Modal State Persistence Layer

**Approach**: Use a persistence layer (Context + sessionStorage) to store modal state that needs to survive unmounts. Modals check this layer on mount and restore state.

**Implementation**:
```typescript
// ModalStateContext
const useModalState = (modalId: string) => {
  const [state, setState] = useState(() => 
    getPersistedState(modalId) || initialState
  );
  
  useEffect(() => {
    persistState(modalId, state);
  }, [state]);
  
  return [state, setState];
};
```

**Pros**:
- ✅ State survives unmounts
- ✅ Works with existing modal architecture
- ✅ Can be added incrementally

**Cons**:
- ⚠️ Doesn't solve coordination problem
- ⚠️ Still need parent to manage modal visibility
- ⚠️ sessionStorage can get stale
- ⚠️ Requires careful cleanup

**Best for**: Temporary solution, state-heavy modals, incremental adoption

---

### Option 4: Workflow State Machine

**Approach**: Use a state machine (e.g., XState) to manage workflow states and transitions. Each modal is a state, transitions define the flow.

**Implementation**:
```typescript
const workflowMachine = createMachine({
  initial: 'creatingAppointment',
  states: {
    creatingAppointment: {
      on: { COMPLETE: 'checkingAssignment' }
    },
    checkingAssignment: {
      on: { 
        PROMPT: 'showingPrompt',
        SKIP: 'done'
      }
    },
    showingPrompt: {
      on: { COMPLETE: 'done' }
    },
    done: { type: 'final' }
  }
});
```

**Pros**:
- ✅ Explicit, predictable state transitions
- ✅ Easy to visualize and debug
- ✅ Handles complex workflows well
- ✅ Type-safe with TypeScript

**Cons**:
- ⚠️ Requires learning XState
- ⚠️ More boilerplate for simple flows
- ⚠️ Overkill for simple sequences

**Best for**: Complex multi-step workflows, formal state management needs

---

### Option 5: Compound Modal Component

**Approach**: Create a wrapper component that manages multiple modals internally. The wrapper stays mounted while child modals transition.

**Implementation**:
```typescript
<ModalFlow>
  <CreateAppointmentModal 
    onComplete={(data) => {
      // Transition to next modal without unmounting wrapper
      setCurrentStep('assignment');
    }}
  />
  {currentStep === 'assignment' && (
    <AssignmentPromptModal data={appointmentData} />
  )}
</ModalFlow>
```

**Pros**:
- ✅ Keeps wrapper mounted - no state loss
- ✅ Simple for related modals
- ✅ No global state needed

**Cons**:
- ⚠️ Only works for related modals
- ⚠️ Doesn't help with modals from different features
- ⚠️ Can create deep component trees

**Best for**: Related modal sequences, feature-specific flows

---

## Recommendation

**Primary**: **Option 1 (Modal Queue/Stack System)**

**Rationale**:
1. **Generalizable**: Solves the problem for all future features
2. **Robust**: Handles complex sequences and edge cases
3. **Maintainable**: Centralized logic, easier to debug
4. **Scalable**: Can extend to handle priorities, overlays, animations

**Implementation Strategy**:
1. **Phase 1**: Build `ModalQueueContext` alongside existing system
2. **Phase 2**: Migrate `CreateAppointmentModal` → `AssignmentPromptModal` flow
3. **Phase 3**: Gradually migrate other sequential flows
4. **Phase 4**: Deprecate old pattern once all flows migrated

**Fallback**: **Option 2 (Deferred Close Pattern)** for quick fixes while building Option 1

---

## Implementation Details (Option 1)

### Core API

```typescript
interface ModalQueueContextType {
  // Enqueue a modal to show after current one closes
  enqueueModal: <T>(modal: QueuedModal<T>) => void;
  
  // Show modal immediately (replaces current if any)
  showModal: <T>(modal: QueuedModal<T>) => void;
  
  // Close current modal and show next in queue (async for cleanup)
  closeCurrent: () => Promise<void>;
  
  // Clear all queued modals (e.g., on navigation)
  clearQueue: () => void;
  
  // Cancel entire queue from within a modal
  cancelQueue: () => void;
  
  // Get current modal
  currentModal: QueuedModal | null;
  
  // Check if queue has pending modals
  hasPendingModals: boolean;
}

// Usage in CreateAppointmentModal
const { enqueueModal, closeCurrent } = useModalQueue();

const handleSave = async () => {
  await onConfirm(formData);
  
  if (shouldShowAssignmentPrompt) {
    enqueueModal<PractitionerAssignmentPromptModalProps>({
      id: 'assignment-prompt',
      component: PractitionerAssignmentPromptModal,
      props: { 
        patientId, 
        practitionerId,
        onConfirm: async () => { /* ... */ },
        onCancel: () => {
          cancelQueue(); // Cancel if user declines
        }
      }
    });
  }
  
  await closeCurrent(); // Closes CreateAppointmentModal, shows next in queue
};
```

### Type Safety

```typescript
// Generic typing ensures props match component
interface PractitionerAssignmentPromptModalProps {
  patientId: number;
  practitionerId: number;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

// TypeScript will enforce prop types match component
enqueueModal<PractitionerAssignmentPromptModalProps>({
  id: 'assignment-prompt',
  component: PractitionerAssignmentPromptModal,
  props: { /* TypeScript validates these props */ }
});
```

### Queue Management

- **Queue-based (FIFO)**: Sequential order - first enqueued shows first
- **Priority support**: High-priority modals can interrupt queue (future enhancement)
- **State persistence**: Queue stored in Context (survives unmounts)
- **Cleanup**: Auto-cleanup on navigation/unmount
- **Component references**: Direct component references preferred over string registry (better type safety, code splitting)

### Modal Registry (Optional)

Registry is **optional**. Prefer direct component references for better type safety:

```typescript
// Preferred: Direct component reference
enqueueModal({
  id: 'assignment-prompt',
  component: PractitionerAssignmentPromptModal,  // Direct reference
  props: { patientId, practitionerId }
});

// Alternative: String ID (only if code splitting needed)
enqueueModal({
  id: 'assignment-prompt',
  component: 'PractitionerAssignmentPromptModal',  // String ID
  props: { patientId, practitionerId }
});
```

### Edge Cases & Error Handling

**Navigation During Sequence**:
- Queue automatically cleared on route change
- Current modal closed gracefully
- Navigation state preserved

**Browser Back Button**:
- Each modal in queue pushes history entry
- Back button closes current modal, shows next in queue
- If queue empty, normal navigation proceeds

**Modal Render Errors**:
- Error boundary wraps queue renderer
- Failed modal removed from queue
- Next modal in queue shown automatically
- Error logged and reported

**Canceling Queue**:
```typescript
const { cancelQueue } = useModalQueue();

// Cancel entire queue (e.g., user navigates away)
cancelQueue();

// Cancel from within modal
const handleCancel = () => {
  cancelQueue();
  onClose();
};
```

**Async Operations**:
- `closeCurrent()` returns Promise to handle async cleanup
- Queue waits for current modal to fully close before showing next
- Timeout protection prevents infinite waits

### Accessibility

**Focus Management**:
- Focus automatically moves to new modal when it opens
- Previous modal's focus trap released
- Focus returns to trigger element when queue completes

**Screen Reader Announcements**:
- ARIA live regions announce modal transitions
- Modal titles announced on open
- Queue completion announced

**Keyboard Navigation**:
- ESC key closes current modal, shows next in queue
- ESC on last modal closes queue and returns focus
- Tab trapping works correctly in each modal

### Animation & UX

**Transitions**:
- Fade-out current modal (200ms)
- Fade-in next modal (200ms)
- Loading state shown during async transitions
- Smooth z-index management

**Visual Feedback**:
- Subtle loading indicator during queue processing
- No jarring modal swaps
- Consistent animation timing

### Testing Strategy

**Unit Tests**:
```typescript
describe('ModalQueue', () => {
  it('enqueues modals in FIFO order', () => { /* ... */ });
  it('handles async closeCurrent()', async () => { /* ... */ });
  it('clears queue on navigation', () => { /* ... */ });
  it('handles render errors gracefully', () => { /* ... */ });
});
```

**Integration Tests**:
- Test complete modal sequences (A → B → C)
- Verify state persistence across unmounts
- Test error recovery

**E2E Tests**:
- Full workflow: Create appointment → Assignment prompt → Confirmation
- Browser back button behavior
- Navigation interruption handling

**Mocking**:
```typescript
// Mock modal queue in tests
const mockModalQueue = {
  enqueueModal: vi.fn(),
  closeCurrent: vi.fn(),
  cancelQueue: vi.fn(),
};
```

---

## Migration Path

1. **Week 1**: Implement `ModalQueueContext` and basic queue system
   - Core queue logic with FIFO ordering
   - Error boundaries and error handling
   - Basic tests for queue operations
2. **Week 2**: Migrate appointment → assignment prompt flow
   - Update `CreateAppointmentModal` to use queue
   - Add accessibility features (focus, ARIA)
   - Integration tests for the flow
3. **Week 3**: Polish and documentation
   - Add transition animations
   - Complete test coverage
   - Update developer documentation
4. **Week 4**: Identify and migrate other sequential flows
   - Patient creation → Appointment creation
   - Other identified flows
5. **Ongoing**: Use for all new sequential modal flows

## Alternative: Simple Two-Step Pattern

For simple A → B flows where Option 1 is overkill, consider a lightweight pattern:

```typescript
// In parent component
const [nextModal, setNextModal] = useState<{type: string, props: any} | null>(null);

const handleAppointmentCreated = async () => {
  await onConfirm(formData);
  
  if (shouldShowPrompt) {
    // Don't close yet - transition to next modal
    setNextModal({ 
      type: 'assignment-prompt', 
      props: { patientId, practitionerId } 
    });
  } else {
    onClose();
  }
};

// Render logic
{nextModal ? (
  <AssignmentPromptModal 
    {...nextModal.props}
    onClose={() => {
      setNextModal(null);
      onClose(); // Now close parent modal
    }}
  />
) : (
  <CreateAppointmentModal onConfirm={handleAppointmentCreated} />
)}
```

**When to use**: Simple two-step flows, no complex sequences, minimal refactoring needed.

---

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│         ModalQueueProvider              │
│  (Context - persists across unmounts)   │
│                                         │
│  Queue: [ModalA, ModalB, ModalC]      │
│  Current: ModalA                        │
└─────────────────────────────────────────┘
              │
              ├─── ModalA (CreateAppointmentModal)
              │    │
              │    └─── onComplete() → enqueueModal(ModalB)
              │         └─── closeCurrent() → ModalA unmounts
              │
              ├─── ModalB (AssignmentPromptModal)
              │    │
              │    └─── onConfirm() → enqueueModal(ModalC)
              │         └─── closeCurrent() → ModalB unmounts
              │
              └─── ModalC (ConfirmationModal)
                   │
                   └─── onClose() → closeCurrent() → Queue empty
```

## References

- [React Design Patterns - Compound Components](https://www.uxpin.com/studio/blog/react-design-patterns/)
- [State Management Patterns in React](https://becca.is/design-patterns-for-state-management/)
- [XState Documentation](https://xstate.js.org/docs/)
- [React Portals Documentation](https://react.dev/reference/react-dom/createPortal)
- [ARIA Modal Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

