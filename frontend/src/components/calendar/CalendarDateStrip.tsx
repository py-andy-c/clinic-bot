import React, { useState } from 'react';
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
  const isMobile = useIsMobile(1024); // Hide settings button on desktop (≥1024px)

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

      {/* Mini Calendar Modal */}
      {showMiniCalendar && (
        <div className={styles.miniCalendarModal} onClick={() => setShowMiniCalendar(false)}>
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

  const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

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

    // Get weekday of first day (0 = Sunday, 6 = Saturday)
    let firstDayOfWeek = firstDay.getDay();
    // Adjust for Monday-first (0 = Monday, 6 = Sunday)
    if (firstDayOfWeek === 0) firstDayOfWeek = 6;
    else firstDayOfWeek--;

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
    const today = new Date();
    const selectedMoment = moment(currentDate).tz('Asia/Taipei');

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const isToday = date.toDateString() === today.toDateString();
      const isSelected = date.toDateString() === selectedMoment.toDate().toDateString();

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