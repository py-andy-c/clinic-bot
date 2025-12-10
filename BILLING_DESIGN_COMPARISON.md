# Billing Scenario Design Comparison

## Executive Summary

This document compares different billing scenario designs for the clinic management system, analyzing their strengths, weaknesses, and use cases. It also proposes new design alternatives that address identified limitations.

## Existing Designs Comparison

| Aspect | Design 1: Original (Flat) | Design 2: Hierarchical | Design 3: Simple (Editable) |
|--------|---------------------------|------------------------|----------------------------|
| **Structure** | Practitioner → List of Scenarios | Service Item → Practitioner → List of Scenarios | Service Item → Practitioner → Single Editable Scenario |
| **Complexity** | Low | High | Medium |
| **Flexibility** | High - Any item can select any scenario | Medium - Scenarios tied to service/practitioner | High - Amount/profit fully editable |
| **Error Prevention** | Low - No mapping validation | High - Enforced hierarchy | Medium - Auto-population helps |
| **Auditability** | Medium - Only "其他" needs review | High - Only "其他" needs review | Low - All entries need manual review |
| **User Experience** | Simple selection | Sequential selection (3 steps) | Sequential selection (2 steps + edit) |
| **Setup Complexity** | Low - Flat list per practitioner | High - Nested structure per service | Medium - One scenario per service/practitioner |
| **Use Case** | Small clinics, simple needs | Large clinics, complex pricing | Medium clinics, need flexibility |
| **Main Strength** | Simple and flexible | Prevents errors, clear structure | Simple yet flexible |
| **Main Weakness** | Can select wrong scenario | More complex to set up | Hard to audit (all editable) |

### Detailed Analysis

#### Design 1: Original (Flat)
**Structure:**
- Each practitioner has a flat list of billing scenarios
- Each scenario has: 名稱, 金額, 分潤
- During checkout: User selects item type, then any scenario from the practitioner's list

**Pros:**
- Simple to understand and set up
- Very flexible - can mix and match scenarios
- Fast to configure

**Cons:**
- No validation - user can accidentally select wrong scenario (e.g., "初診" scenario for "運動治療" item)
- Potential for billing errors
- Less structured

#### Design 2: Hierarchical
**Structure:**
- Service Item → Practitioner → List of Scenarios
- Each service item expands to show practitioners who offer it
- Each practitioner shows their scenarios for that service
- During checkout: Select service → Select practitioner → Select scenario

**Pros:**
- Strong error prevention - scenarios are tied to specific services
- Clear structure and organization
- Easy to audit - only "其他" scenarios need review
- Prevents accidental wrong selections

**Cons:**
- More complex to set up and maintain
- Requires more clicks during checkout (3-step process)
- Can be overwhelming for simple use cases

#### Design 3: Simple (Editable)
**Structure:**
- Service Item → Practitioner → Single Scenario (amount/profit)
- Each service/practitioner pair has one default scenario
- During checkout: Select service → Select practitioner → Auto-populated editable fields

**Pros:**
- Simple structure - one scenario per service/practitioner
- Flexible - amounts can be edited
- Fast checkout process
- Auto-population reduces errors

**Cons:**
- Hard to audit - practitioners can edit any value
- No audit trail for changes
- Owner must review all entries, not just exceptions
- Potential for inconsistent billing

## Proposed New Designs

### Design 4: Predefined with Override Flag

**Structure:**
- Similar to Design 3 (Service Item → Practitioner → Single Scenario)
- Each scenario has editable amount/profit fields
- **New Feature:** "Override" checkbox/toggle
- When override is enabled, the entry is flagged for audit
- Owner only needs to review flagged entries

**Pros:**
- Simple structure like Design 3
- Better auditability - only overridden entries need review
- Maintains flexibility
- Clear audit trail

**Cons:**
- Requires user to remember to check override
- Still allows editing without flagging

**Implementation:**
```javascript
{
  serviceItem: "初診",
  practitioner: "陳志明",
  defaultAmount: 2200,
  defaultProfit: 600,
  amount: 2200,  // editable
  profit: 600,   // editable
  isOverridden: false  // auto-set to true if amount/profit differs from default
}
```

---

### Design 5: Scenario Templates with Validation

**Structure:**
- Similar to Design 1 (Flat list per practitioner)
- **New Feature:** Each scenario has "applicable services" list
- During checkout: Only scenarios applicable to selected service item are shown
- User can still select "其他" for custom scenarios

**Pros:**
- Maintains simplicity of Design 1
- Prevents wrong scenario selection
- Flexible with "其他" option
- Easy to audit (only "其他" needs review)

**Cons:**
- Requires maintaining service mappings per scenario
- Slightly more setup than Design 1

**Implementation:**
```javascript
{
  practitioner: "陳志明",
  scenarios: [
    {
      name: "初診",
      amount: 2200,
      profit: 600,
      applicableServices: ["初診"]  // Only shown for 初診 items
    },
    {
      name: "初診優惠",
      amount: 1800,
      profit: 300,
      applicableServices: ["初診"]
    },
    {
      name: "其他",
      amount: 0,
      profit: 0,
      applicableServices: ["*"]  // Available for all services
    }
  ]
}
```

---

### Design 6: Hybrid - Predefined with Custom Override

**Structure:**
- Service Item → Practitioner → Default Scenario (like Design 3)
- **New Feature:** "使用自訂金額" toggle
- When enabled, shows custom amount/profit fields
- Default scenario is always visible for reference
- Custom overrides are flagged for audit

**Pros:**
- Best of both worlds - default values + flexibility
- Clear visual distinction between default and custom
- Easy audit - only custom entries need review
- Prevents accidental edits to defaults

**Cons:**
- Slightly more complex UI
- Two-step process for custom amounts

**Implementation:**
```javascript
{
  serviceItem: "初診",
  practitioner: "陳志明",
  defaultAmount: 2200,
  defaultProfit: 600,
  useCustom: false,
  customAmount: 0,
  customProfit: 0,
  finalAmount: 2200,  // defaultAmount or customAmount
  finalProfit: 600    // defaultProfit or customProfit
}
```

---

### Design 7: Audit Trail with Change Tracking

**Structure:**
- Similar to Design 3 (Simple Editable)
- **New Feature:** Track all changes with timestamp and user
- Show "original" vs "modified" values
- Owner can see what was changed and by whom
- Flag entries where amount/profit differs significantly from default

**Pros:**
- Full transparency and auditability
- Maintains flexibility
- Historical record of changes
- Can set thresholds for automatic flagging

**Cons:**
- More complex backend implementation
- Requires user tracking
- More data to store

**Implementation:**
```javascript
{
  serviceItem: "初診",
  practitioner: "陳志明",
  defaultAmount: 2200,
  defaultProfit: 600,
  amount: 2000,  // edited
  profit: 550,   // edited
  changes: [
    {
      field: "amount",
      oldValue: 2200,
      newValue: 2000,
      changedBy: "user123",
      changedAt: "2025-01-15T10:30:00Z"
    }
  ],
  needsAudit: true  // auto-flagged if change > threshold
}
```

---

### Design 8: Role-Based with Approval Workflow

**Structure:**
- Similar to Design 3 (Simple Editable)
- **New Feature:** Role-based permissions
- Practitioners can edit within ±10% of default
- Changes beyond threshold require owner approval
- Owner can set approval rules per service/practitioner

**Pros:**
- Prevents unauthorized large changes
- Maintains flexibility for small adjustments
- Clear approval workflow
- Good auditability

**Cons:**
- More complex permission system
- Requires approval workflow implementation
- May slow down checkout process

**Implementation:**
```javascript
{
  serviceItem: "初診",
  practitioner: "陳志明",
  defaultAmount: 2200,
  defaultProfit: 600,
  amount: 2000,  // -9% change, within threshold
  profit: 550,   // -8% change, within threshold
  requiresApproval: false,
  approvalStatus: "auto-approved"
}
```

---

## Recommendation Matrix

| Design | Best For | Complexity | Auditability | Flexibility | Error Prevention |
|--------|----------|------------|--------------|-------------|------------------|
| **Design 1** | Small clinics, simple needs | ⭐ Low | ⭐⭐ Medium | ⭐⭐⭐ High | ⭐ Low |
| **Design 2** | Large clinics, complex pricing | ⭐⭐⭐ High | ⭐⭐⭐ High | ⭐⭐ Medium | ⭐⭐⭐ High |
| **Design 3** | Medium clinics, need flexibility | ⭐⭐ Medium | ⭐ Low | ⭐⭐⭐ High | ⭐⭐ Medium |
| **Design 4** | Medium clinics, need auditability | ⭐⭐ Medium | ⭐⭐⭐ High | ⭐⭐⭐ High | ⭐⭐ Medium |
| **Design 5** | Small-medium clinics | ⭐ Low | ⭐⭐⭐ High | ⭐⭐⭐ High | ⭐⭐⭐ High |
| **Design 6** | Most clinics (recommended) | ⭐⭐ Medium | ⭐⭐⭐ High | ⭐⭐⭐ High | ⭐⭐⭐ High |
| **Design 7** | Large clinics, strict audit | ⭐⭐⭐ High | ⭐⭐⭐ High | ⭐⭐⭐ High | ⭐⭐ Medium |
| **Design 8** | Clinics with approval needs | ⭐⭐⭐ High | ⭐⭐⭐ High | ⭐⭐ Medium | ⭐⭐⭐ High |

## Top Recommendations

### 🥇 **Design 6: Hybrid - Predefined with Custom Override**
**Why:** Best balance of simplicity, flexibility, and auditability. Clear visual distinction between default and custom values makes auditing easy.

### 🥈 **Design 5: Scenario Templates with Validation**
**Why:** Addresses Design 1's main weakness (wrong scenario selection) while maintaining simplicity. Easy to audit since only "其他" needs review.

### 🥉 **Design 4: Predefined with Override Flag**
**Why:** Improves Design 3's auditability significantly while maintaining its simplicity. Auto-flagging reduces manual work.

## Implementation Considerations

1. **User Training:** Design 6 and 8 require more user training
2. **Backend Complexity:** Design 7 and 8 require more backend infrastructure
3. **Migration Path:** Consider how to migrate from existing design
4. **Performance:** Design 2 and 7 may have performance implications with large datasets
5. **Mobile UX:** Design 6's toggle may be better suited for desktop

## Next Steps

1. **Stakeholder Review:** Present designs to clinic owners and practitioners
2. **Prototype:** Build quick prototypes of top 2-3 designs
3. **User Testing:** Test with actual users to validate assumptions
4. **Cost-Benefit Analysis:** Evaluate implementation effort vs. benefits
5. **Decision:** Select design based on clinic size, needs, and resources
