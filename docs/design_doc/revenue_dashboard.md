# Revenue Dashboard - Business Logic & Technical Design

## Overview

The Revenue Dashboard consists of two pages:
1. **Business Insights (業務洞察)**: Revenue trends, service item breakdowns, practitioner performance
2. **Revenue Distribution (診所分潤審核)**: Item-level revenue distribution with filtering and pagination

Both dashboards calculate revenue based on **valid (non-voided) receipts** filtered by **visit_date** (appointment/service date) in Taiwan timezone.

---

## Key Business Logic & Product Expectations

### Date Filtering

**Rule: Use `visit_date` (appointment date), NOT `issue_date` (checkout date)**

- **Rationale**: Revenue should be attributed to the date when service was provided, not when payment was received
- **Implementation**: 
  - `visit_date` column in `receipts` table (indexed for performance)
  - Falls back to `issue_date` if `visit_date` is missing (edge cases)
  - All date filtering uses Taiwan timezone

### Service Item Name Display

**Rule: Display `name` for standard items, `receipt_name` for custom items**

- **Standard Items** (service_item):
  - **Display**: Prefer current `name` from clinic settings (`appointment_types`)
  - **Fallback**: Historical `service_item_name` from receipt snapshot (for deleted items)
  - **Backend provides**: Both `service_item_name` (historical) and `receipt_name` (from snapshot)
  - **Rationale**: Show current name for active items, historical name for deleted items

- **Custom Items** (other):
  - **Display**: Always use `receipt_name` (same as `item_name`)
  - **Styling**: Italic with "(自訂)" suffix
  - **Rationale**: Custom items don't have a "current" name in settings

### Data Source

- **Base Query**: Receipts where `is_voided = False` and `clinic_id` matches active clinic
- **Date Filtering**: SQL query on `visit_date` column (indexed, efficient)
- **Timezone**: All dates converted to Taiwan timezone before comparison

### Revenue Calculations

- **Total Revenue**: Sum of `amount × quantity` for all items (after filters)
- **Total Clinic Share**: Sum of `revenue_share × quantity` for all items
- **Receipt Count**: Unique receipt IDs (one receipt = one count, regardless of item count)
- **Service Item Count**: Includes zero-revenue items (free services are counted)
- **Item Count**: Total quantity of all items (sum of `quantity` fields)

### Zero Revenue Items

- **Included in**: Service item count metric
- **Excluded from**: Breakdown tables (only show items with `total_revenue > 0`)
- **Rationale**: Count metric should reflect all services provided, but breakdown focuses on revenue-generating items

### Filtering Logic

1. **Date Range**: Always applied (required filter)
2. **Practitioner**: Optional - can filter by specific practitioner or "無治療師" (no practitioner)
3. **Service Item**: Optional - can filter by standard item ID or custom item name (`custom:name` format)
4. **Show Overwritten Only**: Revenue Distribution only - filters to items with `billing_scenario == "其他"`

### Dropdown Options

- **Standard Items**: Loaded from `appointment_types` in clinic settings (always shown)
- **Custom Items**: Extracted from unfiltered business insights data (ensures all custom items appear)
- **Practitioners**: Extracted from filtered data (only shows practitioners with data in date range)
- **Null Practitioner**: Shown if any items have no practitioner assigned

### Granularity Selection

- **Daily**: Date range ≤ 31 days
- **Weekly**: Date range ≤ 130 days
- **Monthly**: Date range > 130 days

**Rationale**: Appropriate granularity for different time ranges (detailed for short ranges, aggregated for long ranges)

---

## Technical Design

### Architecture: Calculation Engine Pattern

The implementation follows a modular calculation engine pattern:

```
Receipts → Extractor → Filters → Calculators → Engine → API Response
```

### Components

1. **ReceiptItemExtractor** (`dashboard_extractor.py`)
   - Extracts structured `ReceiptItem` objects from `Receipt` entities
   - Handles edge cases: missing data, malformed receipts, NULL visit_date
   - Fallback chain: `visit_date` column → `receipt_data->>'visit_date'` → `issue_date`

2. **FilterApplicator** (`dashboard_filters.py`)
   - Applies filters: practitioner, service item, billing scenario
   - Reusable across both dashboards

3. **Calculators** (`dashboard_calculators.py`)
   - `SummaryMetricsCalculator`: Total revenue, receipt count, service item count, etc.
   - `RevenueTrendCalculator`: Time-series revenue data with granularity
   - `ServiceItemBreakdownCalculator`: Aggregated breakdown by service item
   - `PractitionerBreakdownCalculator`: Aggregated breakdown by practitioner

4. **Engines** (`dashboard_engine.py`)
   - `BusinessInsightsEngine`: Orchestrates business insights calculations
   - `RevenueDistributionEngine`: Orchestrates revenue distribution with pagination/sorting
   - Both use shared extractor, filters, and calculators

### Type Safety

- **TypedDict**: Used throughout for type safety without runtime overhead
- **Key Types**:
  - `ReceiptItem`: Extracted item structure
  - `DashboardFilters`: Filter criteria
  - `SummaryMetrics`: Summary statistics
  - `ServiceItemBreakdown`: Service item aggregation
  - `PractitionerBreakdown`: Practitioner aggregation

### Validation

- **Environment-Aware**: Fails loudly in dev/test, logs warnings in production
- **Checks**:
  - Total revenue = sum of all items
  - Breakdown totals = summary totals
  - Percentages sum to 100 (within rounding tolerance)
  - Receipt count = unique receipt IDs

### Database Schema

- **`visit_date` Column**: Indexed timestamp column for efficient date filtering
- **Migration**: Backfills from `receipt_data->>'visit_date'`, falls back to `issue_date`
- **Receipt Creation**: Populates `visit_date` column automatically

### Performance

- **SQL Filtering**: Uses indexed `visit_date` column (no Python-side filtering needed)
- **Efficient Queries**: Direct SQL date range queries with timezone conversion
- **No Expansion Window**: Exact date matching (no ±2 day expansion needed)

---

## Implementation Details

### Receipt Item Extraction

Each receipt item is extracted with:
- **Financial**: `amount`, `revenue_share`, `quantity`
- **Identification**: `service_item_id`, `service_item_name`, `receipt_name`, `item_name`
- **Metadata**: `receipt_id`, `receipt_number`, `visit_date`, `patient_name`
- **Relations**: `practitioner_id`, `practitioner_name`, `billing_scenario_name`

### Name Field Handling

- **`service_item_name`**: Historical `name` from receipt snapshot (for deleted items)
- **`receipt_name`**: `receipt_name` or `name` from receipt snapshot (for display)
- **Frontend Logic**: 
  - Standard items: `settings.appointment_types[].name` (current) → `service_item_name` (historical fallback)
  - Custom items: `receipt_name` (always)

### Constants

- **`CALCULATION_TOLERANCE`**: `Decimal('0.01')` (1 cent tolerance for revenue calculations)
- **`PERCENTAGE_ROUNDING_TOLERANCE`**: `1` (1% tolerance for percentage sums)

---

## Testing

- **Unit Tests**: Comprehensive coverage for all calculators and extractor
- **Property-Based Tests**: Validates accounting invariants (total = sum of items, etc.)
- **Integration Tests**: Full flow from API to response

---

## Key Files

- **Services**: `business_insights_service.py`, `dashboard_engine.py`
- **Calculators**: `dashboard_calculators.py`
- **Extractor**: `dashboard_extractor.py`
- **Filters**: `dashboard_filters.py`
- **Types**: `dashboard_types.py`
- **Migration**: `add_visit_date_column_to_receipts.py`
- **Tests**: `test_dashboard_*.py`

---

## Notes

- All calculations use `Decimal` for precision (no floating-point errors)
- All dates are timezone-aware (Taiwan timezone)
- Receipt data is immutable (snapshot at creation time)
- Zero-revenue items are included in counts but filtered from display breakdowns

