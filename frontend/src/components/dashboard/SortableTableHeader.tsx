import React from 'react';

export type SortDirection = 'asc' | 'desc' | null;

export interface SortableTableHeaderProps {
  column: string;
  currentSort: { column: string; direction: SortDirection };
  onSort: (column: string) => void;
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
  style?: React.CSSProperties;
}

export const SortableTableHeader: React.FC<SortableTableHeaderProps> = ({
  column,
  currentSort,
  onSort,
  children,
  className = '',
  align = 'left',
  style,
}) => {
  const isActive = currentSort.column === column;
  const direction = isActive ? currentSort.direction : null;

  const handleClick = () => {
    onSort(column);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSort(column);
    }
  };

  const alignClass = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  }[align];

  return (
    <th
      className={`px-2 md:px-4 py-2 md:py-3 ${alignClass} text-xs font-medium text-gray-500 uppercase sortable-header whitespace-nowrap ${className}`}
      style={style}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
    >
      <div className="flex items-center gap-1">
        <span>{children}</span>
        <span className={`sort-indicator ${isActive ? 'active' : ''}`}>
          <svg
            className="w-3 h-3 inline"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            style={{ opacity: isActive ? 1 : 0.5 }}
          >
            {direction === 'asc' ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
            )}
          </svg>
        </span>
      </div>
    </th>
  );
};
