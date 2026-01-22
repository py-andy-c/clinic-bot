import React from 'react';
import { CalendarView, CalendarViews } from '../../types/calendar';
import { getPractitionerColor } from '../../utils/practitionerColors';
import { getResourceColorById } from '../../utils/resourceColorUtils';
import { CompactMultiSelect } from './CompactMultiSelect';
import styles from './CalendarSidebar.module.css';

interface Practitioner {
  id: number;
  full_name: string;
}

interface Resource {
  id: number;
  name: string;
}

interface CalendarSidebarProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  practitioners: Practitioner[];
  selectedPractitioners: number[];
  onPractitionersChange: (ids: number[]) => void;
  resources: Resource[];
  selectedResources: number[];
  onResourcesChange: (ids: number[]) => void;
  currentUserId: number | null;
  isOpen: boolean;
  onClose: () => void;
}

const CalendarSidebar: React.FC<CalendarSidebarProps> = ({
  view,
  onViewChange,
  practitioners,
  selectedPractitioners,
  onPractitionersChange,
  resources,
  selectedResources,
  onResourcesChange,
  currentUserId,
  isOpen,
  onClose,
}) => {
  const handleViewChange = (newView: CalendarView) => {
    onViewChange(newView);
  };


  return (
    <>
      {/* Mobile overlay */}
      <div
        className={styles.sidebarOverlay}
        onClick={onClose}
        style={{
          '--sidebar-overlay-opacity': isOpen ? '1' : '0',
          '--sidebar-overlay-visibility': isOpen ? 'visible' : 'hidden',
        } as React.CSSProperties}
      />

      {/* Sidebar */}
      <div
        className={styles.sidebar}
        style={{
          '--sidebar-translate-x': isOpen ? '0' : '-100%',
        } as React.CSSProperties}
        role="complementary"
        aria-label="Calendar sidebar with view controls and filters"
        data-testid="calendar-sidebar"
      >
        <div className={styles.sidebarContent}>
          {/* View Switcher */}
          <div className={styles.sidebarSection}>
            <span className={styles.sidebarSectionTitle}>模式</span>
            <div className={styles.viewOptionsRow} role="radiogroup" aria-label="Calendar view selection">
              <button
                className={`${styles.viewOption} ${view === CalendarViews.MONTH ? styles.viewOptionActive : ''}`}
                onClick={() => handleViewChange(CalendarViews.MONTH)}
                role="radio"
                aria-checked={view === CalendarViews.MONTH}
                aria-label="Switch to monthly view"
              >
                月
              </button>
              <button
                className={`${styles.viewOption} ${view === CalendarViews.WEEK ? styles.viewOptionActive : ''}`}
                onClick={() => handleViewChange(CalendarViews.WEEK)}
                role="radio"
                aria-checked={view === CalendarViews.WEEK}
                aria-label="Switch to weekly view"
              >
                週
              </button>
              <button
                className={`${styles.viewOption} ${view === CalendarViews.DAY ? styles.viewOptionActive : ''}`}
                onClick={() => handleViewChange(CalendarViews.DAY)}
                role="radio"
                aria-checked={view === CalendarViews.DAY}
                aria-label="Switch to daily view"
              >
                日
              </button>
            </div>
          </div>

          {/* Practitioner Filters */}
          <div className={styles.sidebarSection}>
            <h3 className={styles.sidebarSectionTitle}>
              顯示治療師 ({selectedPractitioners.length}/10)
            </h3>
            <CompactMultiSelect
              selectedItems={selectedPractitioners
                .sort((a, b) => {
                  // Current user appears first
                  if (a === currentUserId) return -1;
                  if (b === currentUserId) return 1;
                  return 0;
                })
                .map(id => {
                  const practitioner = practitioners.find(p => p.id === id);
                  return {
                    id,
                    name: practitioner?.full_name || '',
                    color: getPractitionerColor(id, -1, selectedPractitioners) || '#6b7280'
                  };
                })}
              allItems={practitioners
                .sort((a, b) => {
                  // Current user appears first
                  if (a.id === currentUserId) return -1;
                  if (b.id === currentUserId) return 1;
                  return 0;
                })
                .map(p => ({ id: p.id, name: p.full_name }))}
              onSelectionChange={onPractitionersChange}
              maxSelections={10}
              placeholder="搜尋治療師..."
              data-testid="practitioner-multiselect"
            />
          </div>

          {/* Resource Filters */}
          <div className={styles.sidebarSection}>
            <h3 className={styles.sidebarSectionTitle}>
              顯示資源 ({selectedResources.length}/10)
            </h3>
            <CompactMultiSelect
              selectedItems={selectedResources.map(id => {
                const resource = resources.find(r => r.id === id);
                return {
                  id,
                  name: resource?.name || '',
                  color: getResourceColorById(id, selectedResources) || '#6b7280'
                };
              })}
              allItems={resources.map(r => ({ id: r.id, name: r.name }))}
              onSelectionChange={onResourcesChange}
              maxSelections={10}
              placeholder="搜尋資源..."
              data-testid="resource-multiselect"
            />
          </div>
        </div>
      </div>

    </>
  );
};

export default CalendarSidebar;