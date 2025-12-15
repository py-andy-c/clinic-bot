# Dashboard Redesign - Implementation Guide

## Overview

This document outlines the unified dashboard redesign that consolidates the clinic dashboard and accounting dashboard into a single comprehensive dashboard with multiple subpages. The new dashboard follows the structure of the clinic settings page and serves four primary purposes:

1. **Business Insights (業務洞察)**: Business intelligence including revenue trends, service type performance, practitioner performance, time trends, and filtering
2. **Revenue Distribution Review (診所分潤審核)**: Review and audit revenue distribution, focusing on practitioner billing scenarios and overwritten amounts
3. **LINE Message Usage (LINE 訊息統計)**: Insights into LINE message usage (paid push messages and AI replies)

## Design Principles

- **Consistency**: All dashboard pages follow the same visual structure and styling patterns
- **Mobile-First**: Optimized for mobile devices with edge-to-edge containers and reduced padding
- **Information Hierarchy**: Use info icons and modals for explanations rather than cluttering main UI
- **Space Efficiency**: Maximum use of screen space on mobile while maintaining readability
- **Reusability**: Shared components and utilities across all dashboard pages

## Page Structure

All dashboard pages follow this consistent structure:

```
- Page Header (with info icon)
  - Title (h1)
  - Description (optional)
- Filter Section (white container)
  - Date range inputs
  - Dropdown filters (治療師, 服務項目)
  - Time range preset buttons (本月, 最近3個月, 最近6個月, 最近1年)
  - Apply button
- Summary Cards (white containers, grid layout)
- Content Sections (white containers with border-t on mobile)
  - Section title (h2) with optional info icon
  - Content (tables, charts, etc.)
```

## Styling Standards

### Container Padding
- **Outer container**: `px-0 md:px-6 md:py-6` (no horizontal padding on mobile)
- **Page header**: `px-3 md:px-0 mb-4 md:mb-6` (padding only on mobile)
- **Section containers**: `px-3 py-2 md:px-6 md:py-6` (reduced on mobile)
- **Filter section**: `px-3 py-2 md:px-4 md:py-4`
- **Modals**: `px-3 py-2 md:px-6 md:py-6`

### Typography
- **Page title (h1)**: `text-xl md:text-2xl font-semibold text-gray-900`
- **Section title (h2)**: `text-base md:text-lg font-semibold text-gray-900`
- **Summary card values**: `text-lg md:text-2xl font-semibold`
- **Table cells**: `text-xs md:text-sm`
- **Labels**: `text-xs md:text-sm`

### White Containers
- **Desktop**: `bg-white md:rounded-lg md:border md:border-gray-200 md:shadow-sm`
- **Mobile**: No borders, shadows, or rounded corners
- **Section separators**: `pt-6 border-t border-gray-200 md:pt-6 md:border-t-0` (border only on mobile)

### Responsive Grids
- **Summary cards**: `grid-cols-2 md:grid-cols-5` (business insights) or `grid-cols-1 md:grid-cols-3` (revenue distribution)
- **Filter grid**: `grid-cols-1 md:grid-cols-5`
- **Breakdown tables**: `grid-cols-1 lg:grid-cols-2`

## Component Patterns

### Info Icons and Modals
- Use consistent info icon button: `inline-flex items-center justify-center p-1 text-gray-400 hover:text-gray-600`
- Info icon size: `h-5 w-5` for section headers, `h-4 w-4` for summary cards
- Modal structure: Use `BaseModal` component pattern
- Modal padding: `px-3 py-2 md:px-6 md:py-6`

### Sortable Tables
- All sortable columns have `sortable-header` class with `onclick="handleSort('column_name')"`
- Sort indicators: SVG arrows that change direction based on sort state
- Active sort indicator: `sort-indicator active` class
- **Implementation Note**: Create reusable `SortableTableHeader` component

### Action Buttons
- "檢視預約" and "檢視收據" buttons: `text-blue-600 hover:text-blue-800 text-xs md:text-sm whitespace-nowrap`
- Separated by `|` character: `<span class="text-gray-300">|</span>`
- **Implementation Note**: These should open existing appointment and receipt modals from the clinic admin platform

### Dropdown Filters

#### Practitioner Dropdown (治療師)
```
- 全部
- ───────────── (disabled separator)
- [List of practitioners]
- ───────────── (disabled separator)
- 無 (gray text, value="null")
```

#### Service Item Dropdown (服務項目)
```
- 全部
- ───────────── (disabled separator)
- [List of standard service items]
- ───────────── (disabled separator)
- [Custom items with italic style and (自訂) label]
```

**Styling for custom items**: `font-style: italic` for name, `(自訂)` in gray: `text-xs text-gray-400`

### Time Range Presets
Standard buttons across all applicable pages:
- 本月
- 最近3個月
- 最近6個月
- 最近1年

**Styling**: `px-2 md:px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200`

## Business Insights Page

### Summary Cards (5 cards)
1. **總營收** - Total revenue (with info icon)
2. **有效收據數** - Valid receipt count (with info icon)
3. **服務項目數** - Service item count (with info icon)
4. **活躍病患** - Active patients (with info icon)
5. **平均交易金額** - Average transaction amount (with info icon)

### Revenue Trend Chart
- **Chart Library**: Use **Recharts** (already in dependencies: `recharts@3.5.1`)
- **Chart Types**:
  - Line chart for "總營收" view
  - Stacked area chart (solid colors) for "依服務項目" and "依治療師" views
- **Date Basis**: All revenue data is aggregated by **預約日期 (visit date/service date)**, not checkout date
  - Revenue is grouped by the appointment/service date when the service was provided
  - This ensures accurate business reporting based on when services were actually delivered
- **Granularity**: Auto-adjusts based on date range
  - ≤ 31 days: Daily
  - ≤ 90 days: Weekly
  - ≤ 365 days: Monthly
- **Mobile**: Horizontally scrollable with `min-width: 600px`
- **Container**: `overflow-x-auto -mx-3 md:mx-0 px-3 md:px-0`
- **Subtitle**: "依預約日期統計" displayed below chart title to clarify date basis

### Breakdown Tables
- **By Service Type (依服務項目)**: Revenue, item count, percentage
- **By Practitioner (依治療師)**: Revenue, item count, percentage
- **Percentage Format**: Whole numbers only (no decimals), e.g., `40%` not `40.0%`
- **Custom Items**: Display in italic with `(自訂)` label
- **Null Practitioner**: Display as "無" in gray text

## Revenue Distribution Page

### Summary Cards (3 cards)
1. **總營收** - Total revenue
2. **總診所分潤** - Total clinic share (blue text)
3. **收據項目數** - Receipt item count

### Receipt Details Table
- **Page Size**: 20 items per page
- **Default Sort**: Date descending (newest first)
- **Sortable Columns**: All except "操作"
- **Date Column**: Shows **預約日期 (visit date/service date)**, not checkout date
  - All filtering and sorting is based on the appointment/service date
  - This ensures consistent reporting across all dashboard pages
- **Rowspan Handling**: For receipts with multiple items, use rowspan for receipt number, date, patient, and action columns
  - **Consideration**: If receipt has >10 items, consider simpler row-per-item approach
  - **Backend**: Should return data in format that supports rowspan (grouped by receipt)
- **Columns**:
  - 收據編號 (min-width: 100px)
  - 預約日期 (min-width: 90px) - displays visit/service date
  - 病患 (min-width: 80px)
  - 項目 (min-width: 140px, allows wrapping)
  - 數量 (min-width: 60px, centered)
  - 治療師 (min-width: 100px)
  - 計費方案 (min-width: 100px)
  - 金額 (min-width: 90px, right-aligned)
  - 診所分潤 (min-width: 100px, right-aligned, blue text)
  - 操作 (min-width: 140px, centered)
- **Table Width**: `min-width: 1200px` for horizontal scrolling
- **Whitespace**: Most columns use `whitespace-nowrap` except "項目" column
- **Overwritten Items**: Yellow background (`bg-yellow-100` or `#fef3c7`)
- **Rowspan Support**: For receipts with multiple items
- **Pagination**: "顯示 1 到 20 筆，共 X 筆項目"

### Filters
- **Date Range Filters**: Labeled as "開始日期（預約日期）" and "結束日期（預約日期）" to clarify that filtering is based on appointment/service date, not checkout date
- **僅顯示覆寫計費方案**: Checkbox with info icon
- **Info Modal**: Explains what "覆寫計費方案" means (billing scenario = "其他")

## LINE Usage Page

### Structure
- Two top-level sections (not nested):
  1. **LINE 推播訊息** (with info icon)
  2. **AI 回覆訊息** (with info icon)

### Data Format
- **Format**: `count(percentage%)` e.g., `210(79%)`
- **Percentages**: Whole numbers only (rounded)
- **Time Period**: Always shows past 3 months + current month
- **No Filters**: No date range or preset buttons (monthly quota tracking)

### Table Structure
- **Sticky Left Column**: "訊息類型" column with `sticky left-0`
- **Group Headers**: `bg-gray-100` for category rows (發送給病患, 發送給治療師)
- **Event Rows**: Indented with `pl-8`
- **Subtotal Rows**: `bg-gray-50` with "小計" suffix
- **Grand Total Row**: `bg-blue-50` with "總計"
- **Current Month**: `bg-blue-50` for current month column header and cells

### Info Modals
- **LINE 推播訊息**: Explains LINE platform charges and quota limits
- **AI 回覆訊息**: Explains that AI replies don't consume LINE quota

## Charting Library: Recharts

### Recommendation
**Use Recharts** (version 3.5.1) - already in dependencies.

### Why Recharts?
✅ **Already in use**: The codebase already uses Recharts for `PatientStatsSection` and `AppointmentStatsSection`  
✅ **React-native**: Built specifically for React  
✅ **Feature-complete**: Supports line charts, stacked area charts, responsive containers  
✅ **Well-maintained**: Active development and good documentation  
✅ **TypeScript support**: Full TypeScript definitions included  
✅ **Customizable**: Easy to style and customize colors, tooltips, legends  

### Requirements Fulfillment
- ✅ **Line Charts**: `LineChart`, `Line` components
- ✅ **Stacked Area Charts**: `AreaChart`, `Area` with `stackId` prop
- ✅ **Solid Colors**: Use `fill` prop with solid colors (not gradients)
- ✅ **Responsive**: `ResponsiveContainer` wrapper
- ✅ **Custom Styling**: Full control over colors, tooltips, axes
- ✅ **Mobile Support**: Works well with responsive containers

### Implementation Example
```tsx
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';

// For total revenue (line chart)
<ResponsiveContainer width="100%" height={256}>
  <LineChart data={data}>
    <XAxis dataKey="date" />
    <YAxis />
    <Tooltip />
    <Line type="monotone" dataKey="revenue" stroke="#2563eb" fill="#2563eb" fillOpacity={0.1} />
  </LineChart>
</ResponsiveContainer>

// For stacked view (area chart)
<ResponsiveContainer width="100%" height={256}>
  <AreaChart data={data}>
    <XAxis dataKey="date" />
    <YAxis />
    <Tooltip />
    <Area type="monotone" dataKey="service1" stackId="1" stroke="#2563eb" fill="#2563eb" />
    <Area type="monotone" dataKey="service2" stackId="1" stroke="#10b981" fill="#10b981" />
  </AreaChart>
</ResponsiveContainer>
```

## Implementation Notes

### Reusable Components to Create

1. **SortableTableHeader**
   - Props: `column`, `currentSort`, `onSort`
   - Handles sort indicator display and click handling
   - Used across all sortable tables
   - **Accessibility**: Support keyboard navigation (Enter/Space to sort)
   - **Sorting**: Server-side for large datasets, client-side for small datasets (<100 rows)

2. **InfoButton**
   - Props: `ariaLabel`, `onClick`
   - Consistent info icon button styling
   - Sizes: `h-5 w-5` (default) or `h-4 w-4` (small)

3. **InfoModal**
   - Props: `title`, `content`, `isOpen`, `onClose`
   - Wraps `BaseModal` with consistent styling
   - Mobile-optimized padding

4. **TimeRangePresets**
   - Props: `onSelect`
   - Reusable preset buttons component
   - Handles date calculation logic

5. **FilterDropdown** (for 治療師 and 服務項目)
   - Props: `options`, `value`, `onChange`, `type` ('practitioner' | 'service')
   - Handles separator rendering and custom item styling

### Data Handling

1. **Date Filtering and Aggregation**:
   - **All revenue/accounting data uses 預約日期 (visit date/service date)**, not checkout date (issue_date)
   - Backend filters receipts by `visit_date` from `receipt_data` JSONB field
   - All dates are converted to Taiwan timezone (UTC+8) before filtering and aggregation
   - Date range filters are labeled as "（預約日期）" to clarify the date basis
   - This ensures consistent reporting: revenue is attributed to the date when services were provided, not when payment was processed

2. **Percentages**: Always round to whole numbers using `Math.round()`
   - Edge case: 0.5% rounds to 1% (standard rounding)
   - Zero values: Display as "0%" not "0.0%"

3. **Currency**: Format as `$ X,XXX` with commas
   - Zero values: Display as "$ 0"
   - Negative amounts: Not expected in this system, but handle gracefully if encountered

4. **Custom Service Items**: Identify by checking if item name exists in standard list
   - **Backend**: Should provide a flag or list of standard service items
   - **Matching**: Use exact case-sensitive match (backend should normalize)
   - **Display**: Custom items shown in italic with `(自訂)` label

5. **Null Practitioners**: Display as "無" with gray text (`text-gray-500`)

6. **Overwritten Items**: Identify by `billing_scenario === '其他'`
   - **Styling**: Yellow background `#fef3c7` - verify WCAG AA contrast (4.5:1 ratio)
   - Consider adding border or darker yellow if contrast insufficient

### Mobile Optimizations

1. **Table Scrolling**: All tables should be horizontally scrollable on mobile
2. **Chart Scrolling**: Revenue trend chart scrolls horizontally on mobile
3. **Container Widths**: Use `min-width` on tables to prevent excessive wrapping
4. **Whitespace**: Use `whitespace-nowrap` strategically to prevent unwanted wrapping
5. **Button Wrapping**: Filter buttons should wrap on mobile (`flex-wrap`)

### API Integration

1. **Filter State**: Manage filter state (date range, practitioner, service item, overwritten filter) in component state or URL params
   - **Recommendation**: Use URL params for shareable/bookmarkable views
   - Chart view selection (總營收/依服務項目/依治療師) can be component state
   - **Date Range**: All date filters use 預約日期 (visit date/service date) for consistency

2. **Sorting**: Pass sort parameters to API (`sort_by`, `sort_order`)
   - **Server-side sorting**: Essential for large datasets (Revenue Distribution table)
   - Sort state can persist in URL params for shareability
   - When sorting by date, sorts by visit date (預約日期), not checkout date

3. **Pagination**: Use page-based pagination (page size: 20)
   - Default sort: Date descending (newest first) - based on visit date
   - Reset to page 1 when filters change
   - Total count should reflect current filter results

4. **Data Aggregation**: Backend should handle date range aggregation and grouping
   - **Date Basis**: All aggregation uses `visit_date` from `receipt_data` JSONB, converted to Taiwan timezone
   - Backend uses `issue_date` as a first-pass filter (expanded range ±2 days) for performance, then filters by `visit_date` in Python
   - Chart granularity (daily/weekly/monthly) should be determined by backend based on date range
   - Frontend should not need to aggregate data client-side
   - All date-based filtering and aggregation is consistent across Business Insights, Revenue Distribution, and Accounting Dashboard

### Testing Considerations

1. **Responsive Design**: Test on mobile (375px), tablet (768px), and desktop (1024px+)
2. **Table Scrolling**: Verify horizontal scrolling works on mobile
3. **Chart Rendering**: Test chart rendering with different data ranges
4. **Filter Interactions**: Test all filter combinations
5. **Sort Functionality**: Test sorting on all sortable columns
6. **Modal Functionality**: Test info modals open/close correctly
7. **Edge Cases**: 
   - Empty data states (show placeholder message, e.g., "目前沒有符合條件的資料")
   - Very long custom service item names (allow wrapping in "項目" column)
   - Null practitioners (display as "無" in gray text)
   - Overwritten items (yellow background `#fef3c7` - verify WCAG AA contrast compliance)
   - Receipts with many items (rowspan limits - consider row-per-item approach if >10 items)

### Performance Considerations

1. **Chart Rendering**: Use `ResponsiveContainer` for automatic resizing
2. **Table Virtualization**: Consider virtual scrolling for large tables
   - **Threshold**: Implement if table has >1000 rows
   - Revenue Distribution table likely to benefit from virtualization
3. **Data Caching**: Cache filter results to avoid unnecessary API calls
   - Cache key: combination of all filter parameters
   - Invalidate cache when data changes (new receipts created)
4. **Lazy Loading**: Load chart data only when chart section is visible
5. **Loading States**: Show loading indicators during API calls
   - Skeleton loaders for tables
   - Spinner for charts
6. **Error Handling**: Display user-friendly error messages
   - Invalid date ranges
   - API failures
   - Network errors

## File Structure

```
frontend/src/
├── components/
│   ├── dashboard/
│   │   ├── BusinessInsightsPage.tsx
│   │   ├── RevenueDistributionPage.tsx
│   │   ├── LineUsagePage.tsx
│   │   ├── RevenueTrendChart.tsx
│   │   ├── SortableTableHeader.tsx
│   │   ├── InfoButton.tsx
│   │   ├── InfoModal.tsx
│   │   ├── TimeRangePresets.tsx
│   │   └── FilterDropdown.tsx
│   └── shared/
│       └── BaseModal.tsx (existing)
```

## Mock Files Reference

- `docs/design_doc/dashboard_mocks/business_insights.html` - Business Insights mock
- `docs/design_doc/dashboard_mocks/revenue_distribution.html` - Revenue Distribution mock
- `docs/design_doc/dashboard_mocks/line_usage.html` - LINE Usage mock

**Note**: The `business_insights.html` mock uses Chart.js for visualization purposes only. The actual implementation should use **Recharts** as specified in this design doc.

These HTML mocks serve as the definitive reference for:
- Visual design and layout
- Component structure
- Styling classes
- Data presentation format
- Interactive behavior

## Key Differences from Current Dashboard

1. **Unified Structure**: All dashboards follow the same page structure
2. **Mobile Optimization**: Edge-to-edge containers, reduced padding, horizontal scrolling
3. **Consistent Filtering**: Same filter patterns across all pages
4. **Info Modals**: Explanations moved to modals instead of inline text
5. **Table Sorting**: Consistent sortable table pattern
6. **Action Buttons**: Standardized "檢視預約" and "檢視收據" buttons
