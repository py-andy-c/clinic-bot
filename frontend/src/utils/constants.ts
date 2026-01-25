/**
 * Shared stable constants to prevent referential instability and infinite re-render loops in React.
 * 
 * Use these instead of inline [] or {} literal fallbacks in props or hook dependencies.
 */

export const EMPTY_ARRAY: any[] = [];
export const EMPTY_OBJECT: Record<string, any> = {};
export const CALENDAR_GRID_TIME_COLUMN_WIDTH = 28; // px
