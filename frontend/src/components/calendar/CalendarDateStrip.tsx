import React, { useState, useEffect, useRef } from 'react';
import { CalendarView, CalendarViews } from '../../types/calendar';
import moment from 'moment-timezone';
import { useIsMobile } from '../../hooks/useIsMobile';
import styles from './CalendarDateStrip.module.css';

interface CalendarDateStripProps {
  view: CalendarView;
  currentDate: Date;
  onDateChange: (date: Date) => void;
  onCreateAppointment: () => void;
  onCreateException: () => void;
  onToday: () => void;
  onSettings: () => void;
  isPractitioner: boolean;
}

const CalendarDateStrip: React.FC<CalendarDateStripProps> = ({
  view,
  currentDate,
  onDateChange,
  onCreateAppointment,
  onCreateException,
  onToday,
  onSettings,
  isPractitioner,
}) => {
  const [showMiniCalendar, setShowMiniCalendar] = useState(false);
  const [showFabMenu, setShowFabMenu] = useState(false);
  const [fabMenuPosition, setFabMenuPosition] = useState<'right' | 'left'>('right');
  const fabRef = useRef<HTMLButtonElement>(null);
  const isMobile = useIsMobile(1025); // Hide settings button on desktop (≥1025px)

  // Focus management and boundary detection for FAB
  useEffect(() => {
    if (showFabMenu && fabRef.current) {
      fabRef.current.focus();

      // Boundary detection for menu positioning
      const fabRect = fabRef.current.getBoundingClientRect();
      const menuWidth = 140; // min-width from CSS
      const viewportWidth = window.innerWidth;

      // If menu would overflow right edge, position it on the left
      if (fabRect.right + menuWidth > viewportWidth) {
        setFabMenuPosition('left');
      } else {
        setFabMenuPosition('right');
      }
    }
  }, [showFabMenu]);

  // Keyboard navigation for FAB
  const handleFabKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setShowFabMenu(false);
      fabRef.current?.focus();
    } else if (event.key === 'ArrowDown' && showFabMenu) {
      event.preventDefault();
      // Focus first menu item
      const firstMenuItem = document.querySelector('[data-fab-menu-item="0"]') as HTMLElement;
      firstMenuItem?.focus();
    }
  };

  const handleMenuItemKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === 'Escape') {
      setShowFabMenu(false);
      fabRef.current?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prevIndex = index - 1;
      if (prevIndex >= 0) {
        const prevItem = document.querySelector(`[data-fab-menu-item="${prevIndex}"]`) as HTMLElement;
        prevItem?.focus();
      } else {
        fabRef.current?.focus();
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = index + 1;
      const nextItem = document.querySelector(`[data-fab-menu-item="${nextIndex}"]`) as HTMLElement;
      if (nextItem) {
        nextItem.focus();
      }
    }
  };

  const handlePrev = () => {
    const newDate = moment(currentDate).tz('Asia/Taipei');

    if (view === CalendarViews.MONTH) {
      newDate.subtract(1, 'month');
    } else if (view === CalendarViews.WEEK) {
      newDate.subtract(1, 'week');
    } else {
      newDate.subtract(1, 'day');
    }

    onDateChange(newDate.toDate());
  };

  const handleNext = () => {
    const newDate = moment(currentDate).tz('Asia/Taipei');

    if (view === CalendarViews.MONTH) {
      newDate.add(1, 'month');
    } else if (view === CalendarViews.WEEK) {
      newDate.add(1, 'week');
    } else {
      newDate.add(1, 'day');
    }

    onDateChange(newDate.toDate());
  };

  const getDateDisplay = () => {
    const date = moment(currentDate).tz('Asia/Taipei');
    const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const weekday = weekdayNames[date.day()];

    if (view === CalendarViews.DAY) {
      return `${date.month() + 1}月${date.date()}日(${weekday})`;
    } else if (view === CalendarViews.WEEK) {
      return `${date.year()}年${date.month() + 1}月`;
    } else {
      return `${date.year()}年${date.month() + 1}月`;
    }
  };

  const handleDateClick = () => {
    setShowMiniCalendar(!showMiniCalendar);
  };

  const handleMiniCalendarDateSelect = (year: number, month: number, day: number) => {
    const selectedDate = moment.tz([year, month, day], 'Asia/Taipei');
    onDateChange(selectedDate.toDate());
    setShowMiniCalendar(false);
  };

  return (
    <>
      <div className={styles.dateStripContainer} data-testid="calendar-date-strip">
        <nav className={styles.dateNavigation} aria-label="Calendar date navigation">
          <button
            className={styles.navButton}
            onClick={handlePrev}
            aria-label={`Go to previous ${view === CalendarViews.DAY ? 'day' : view === CalendarViews.WEEK ? 'week' : 'month'}`}
          >
            ‹
          </button>
          <button
            className={styles.dateDisplay}
            onClick={handleDateClick}
            aria-label={`Current date: ${getDateDisplay()}. Click to open mini calendar`}
          >
            {getDateDisplay()}
          </button>
          <button
            className={styles.navButton}
            onClick={handleNext}
            aria-label={`Go to next ${view === CalendarViews.DAY ? 'day' : view === CalendarViews.WEEK ? 'week' : 'month'}`}
          >
            ›
          </button>
        </nav>

        <div className={styles.actionButtons} role="toolbar" aria-label="Calendar actions">
          {!isMobile && (
            <>
              <button className={styles.actionBtn} onClick={onCreateAppointment} aria-label="Create new appointment" title="Create Appointment">
                <span className={styles.actionIcon} aria-hidden="true">+</span>
                <span>預約</span>
              </button>
              {isPractitioner && (
                <button className={styles.actionBtn} onClick={onCreateException} aria-label="Create availability exception" title="Create Availability Exception">
                  <span className={styles.actionIcon} aria-hidden="true">+</span>
                  <span>休診</span>
                </button>
              )}
            </>
          )}
          <button className={styles.actionBtn} onClick={onToday} aria-label="Jump to today's date" title="Jump to Today">
            <span>今</span>
          </button>
          {isMobile && (
            <button className={styles.actionBtn} onClick={onSettings} aria-label="Open calendar settings" title="Open Settings">
              <span className={styles.actionIcon}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Floating Action Button - only on mobile */}
      {isMobile && (
        <div className={styles.fabContainer}>
          <button
            ref={fabRef}
            className={`${styles.fab} ${showFabMenu ? styles.fabActive : ''}`}
            onClick={() => setShowFabMenu(!showFabMenu)}
            onKeyDown={handleFabKeyDown}
            aria-label="Create appointment or exception"
            aria-expanded={showFabMenu}
            aria-haspopup="menu"
            title="Create appointment or exception"
          >
            <span className={styles.fabIcon} aria-hidden="true">
              {showFabMenu ? '×' : '+'}
            </span>
          </button>

          {showFabMenu && (
            <div
              className={`${styles.fabMenu} ${fabMenuPosition === 'left' ? styles.fabMenuLeft : ''}`}
              role="menu"
              aria-label="Create options"
            >
              <button
                className={styles.fabCloseButton}
                onClick={() => setShowFabMenu(false)}
                aria-label="Close menu"
                title="Close menu"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
              <button
                className={styles.fabMenuItem}
                data-fab-menu-item="0"
                onClick={() => {
                  onCreateAppointment();
                  // Keep menu open for multiple selections
                }}
                onKeyDown={(e) => handleMenuItemKeyDown(e, 0)}
                aria-label="Create new appointment"
                role="menuitem"
              >
                + 預約
              </button>
              {isPractitioner && (
                <button
                  className={styles.fabMenuItem}
                  data-fab-menu-item="1"
                  onClick={() => {
                    onCreateException();
                    // Keep menu open for multiple selections
                  }}
                  onKeyDown={(e) => handleMenuItemKeyDown(e, 1)}
                  aria-label="Create availability exception"
                  role="menuitem"
                >
                  + 休診
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mini Calendar Modal */}
      {showMiniCalendar && (
        <div className={styles.miniCalendarModal} onClick={() => setShowMiniCalendar(false)} data-testid="mini-calendar-modal">
          <div className={styles.miniCalendarContent} onClick={(e) => e.stopPropagation()}>
            <MiniCalendar
              currentDate={currentDate}
              onDateSelect={handleMiniCalendarDateSelect}
            />
          </div>
        </div>
      )}
    </>
  );
};

// Mini Calendar Component
interface MiniCalendarProps {
  currentDate: Date;
  onDateSelect: (year: number, month: number, day: number) => void;
}

const MiniCalendar: React.FC<MiniCalendarProps> = ({ currentDate, onDateSelect }) => {
  const [displayMonth, setDisplayMonth] = useState(currentDate);

  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

  const handlePrevMonth = () => {
    const newDate = moment(displayMonth).subtract(1, 'month');
    setDisplayMonth(newDate.toDate());
  };

  const handleNextMonth = () => {
    const newDate = moment(displayMonth).add(1, 'month');
    setDisplayMonth(newDate.toDate());
  };

  const generateCalendarDays = () => {
    const year = displayMonth.getFullYear();
    const month = displayMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();

    // Get weekday of first day (0 = Sunday, 6 = Saturday) - using Sunday-first
    const firstDayOfWeek = firstDay.getDay();

    const prevMonth = new Date(year, month, 0);
    const daysInPrevMonth = prevMonth.getDate();

    const days = [];

    // Previous month padding
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      days.push({
        day,
        isCurrentMonth: false,
        isToday: false,
        isSelected: false,
        date: new Date(year, month - 1, day)
      });
    }

    // Current month days
    const today = moment().tz('Asia/Taipei');
    const selectedMoment = moment(currentDate).tz('Asia/Taipei');

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateMoment = moment(date).tz('Asia/Taipei');
      const isToday = dateMoment.isSame(today, 'day');
      const isSelected = dateMoment.isSame(selectedMoment, 'day');

      days.push({
        day,
        isCurrentMonth: true,
        isToday,
        isSelected,
        date
      });
    }

    // Next month padding to fill 6 weeks
    const totalCells = 42;
    const remainingCells = totalCells - days.length;
    for (let day = 1; day <= remainingCells; day++) {
      days.push({
        day,
        isCurrentMonth: false,
        isToday: false,
        isSelected: false,
        date: new Date(year, month + 1, day)
      });
    }

    return days;
  };

  const calendarDays = generateCalendarDays();

  return (
    <div>
      <div className={styles.miniCalendarHeader}>
        <button className={styles.monthNavBtn} onClick={handlePrevMonth}>
          ‹
        </button>
        <span className={styles.currentMonthLabel}>
          {displayMonth.getFullYear()}年{displayMonth.getMonth() + 1}月
        </span>
        <button className={styles.monthNavBtn} onClick={handleNextMonth}>
          ›
        </button>
      </div>

      <div className={styles.miniCalendar}>
        {weekdays.map(day => (
          <div key={day} className={styles.weekday}>
            {day}
          </div>
        ))}

        {calendarDays.map((dayInfo, index) => (
          <div
            key={index}
            className={`${styles.day} ${!dayInfo.isCurrentMonth ? styles.dayOtherMonth : ''} ${
              dayInfo.isToday ? styles.dayToday : ''
            } ${dayInfo.isSelected ? styles.daySelected : ''} ${
              dayInfo.isToday && dayInfo.isSelected ? styles.dayTodaySelected : ''
            }`}
            onClick={() => dayInfo.isCurrentMonth && onDateSelect(
              dayInfo.date.getFullYear(),
              dayInfo.date.getMonth(),
              dayInfo.date.getDate()
            )}
          >
            {dayInfo.day}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CalendarDateStrip;