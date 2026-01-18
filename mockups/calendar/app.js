// 10 predefined colors for selected practitioners/resources
const PREDEFINED_COLORS = [
    '#3b82f6', // Blue
    '#10b981', // Green
    '#f59e0b', // Yellow
    '#ef4444', // Red
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#06b6d4', // Cyan
    '#84cc16', // Lime
    '#f97316', // Orange
    '#6366f1'  // Indigo
];

const practitioners = [
    { id: 1, name: '陳大文', schedule: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }] },
    { id: 2, name: '林美玲', schedule: [{ start: '10:00', end: '15:00' }, { start: '16:00', end: '20:00' }] },
    { id: 3, name: '張志遠', schedule: [{ start: '08:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
    { id: 4, name: '李佳穎', schedule: [{ start: '09:00', end: '17:00' }] },
    { id: 5, name: '周杰瑞', schedule: [{ start: '13:00', end: '21:00' }] }
];

const resources = [
    { id: 1, name: '治療室1', type: '治療室' },
    { id: 2, name: '治療室2', type: '治療室' },
    { id: 3, name: '治療室3', type: '治療室' },
    { id: 4, name: '設備A', type: '設備' },
    { id: 5, name: '設備B', type: '設備' }
];

const mockAppointments = [
    {
        pId: 1,
        patient: '王小明',
        appointmentType: '全身按摩',
        resources: ['治療室1'],
        start: '09:30',
        end: '10:30',
        notes: '初診'
    },
    {
        pId: 2,
        patient: '張美華',
        appointmentType: '針灸治療',
        resources: ['治療室2', '設備A'],
        start: '10:00',
        end: '11:00',
        notes: '第三次治療'
    },
    {
        pId: 3,
        patient: '李大華',
        appointmentType: '推拿治療',
        resources: ['治療室1'],
        start: '14:00',
        end: '15:00'
    },
    {
        pId: 4,
        patient: '陳小雅',
        appointmentType: '中醫調理',
        resources: ['治療室3', '設備B'],
        start: '15:30',
        end: '16:30',
        notes: '複診'
    },
    {
        pId: 5,
        patient: '林志偉',
        appointmentType: '整脊治療',
        resources: ['治療室2'],
        start: '16:00',
        end: '17:00'
    },
    {
        pId: 1,
        patient: '黃小姐',
        appointmentType: '芳香療法',
        resources: ['治療室1'],
        start: '13:30',
        end: '14:30',
        notes: '舒緩壓力'
    }
];

const mockExceptions = [
    { pId: 1, title: '午休', start: '12:00', end: '13:00' },
    { pId: 2, title: '進修研習', start: '13:00', end: '15:00' },
    { pId: 3, title: '會議', start: '11:00', end: '12:00' }
];

const mockResourceBookings = [
    { rId: 1, title: '設備維護', start: '10:00', end: '11:00', notes: '定期保養' },
    { rId: 2, title: '清潔中', start: '14:00', end: '15:00' },
    { rId: 3, title: '維修中', start: '11:30', end: '12:30', notes: '緊急維修' }
];

// Constants
const DAYS_OF_WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const CALENDAR_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const SCROLL_OFFSET = 60;
const AUTO_SCROLL_DELAY = 100;

// Selected calendars state
let selectedPractitioners = [1, 2, 3, 4, 5]; // Match HTML checkbox states
let selectedResources = [1, 2]; // Default to some resources

// Color assignment for selected items (practitioners and resources)
let assignedColors = new Map(); // itemId -> color

// Current view state
let currentView = 'day'; // 'day', 'week', 'month'

let selectedDate = new Date("2026-01-19");
let displayMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1); // Month currently displayed in mini calendar

// Helper function to convert time string (HH:MM) to pixel position
function timeToPixels(timeString) {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
}

// Helper function to create positioned calendar element
function createCalendarElement(startTime, endTime, className, content, tooltip = '') {
    const top = timeToPixels(startTime);
    const height = timeToPixels(endTime) - top;

    const div = document.createElement('div');
    div.className = className;
    div.style.top = `${top}px`;
    div.style.height = `${height}px`;
    div.innerHTML = content;
    if (tooltip) div.title = tooltip;

    return div;
}

// Color management functions
function assignColorsToSelectedItems() {
    assignedColors.clear();

    // Combine selected practitioners and resources
    const selectedItems = [
        ...selectedPractitioners.map(id => ({ type: 'practitioner', id })),
        ...selectedResources.map(id => ({ type: 'resource', id }))
    ];

    // Assign colors to selected items (max 10 total)
    selectedItems.slice(0, 10).forEach((item, index) => {
        assignedColors.set(`${item.type}-${item.id}`, PREDEFINED_COLORS[index]);
    });
}

function getItemColor(itemType, itemId) {
    return assignedColors.get(`${itemType}-${itemId}`);
}

// Initialize colors on load
assignColorsToSelectedItems();

// Update indicator styling for a filter item
function updateIndicator(item, type) {
    const checkbox = item.querySelector('input[type="checkbox"]');
    const indicator = item.querySelector('.filter-indicator');
    const id = parseInt(checkbox.dataset[type]);

    if (checkbox.checked) {
        const color = getItemColor(type, id);
        indicator.style.background = color || '#e5e7eb';
        indicator.style.border = 'none';
    } else {
        indicator.style.background = 'transparent';
        indicator.style.border = '1px solid #d1d5db';
    }
}

// Update sidebar indicators with assigned colors
function updateSidebarIndicators() {
    document.querySelectorAll('.practitioner-filter-item').forEach(item =>
        updateIndicator(item, 'practitioner'));
    document.querySelectorAll('.resource-filter-item').forEach(item =>
        updateIndicator(item, 'resource'));
}

function initCalendar() {
    renderCalendarView();
    updateSidebarIndicators(); // Update colors for initially selected items
    setupEventListeners();

    // Auto-scroll to 9 AM
    setTimeout(() => {
        const viewport = document.getElementById('main-viewport');
        const slot9am = document.getElementById('slot-9am');
        if (slot9am && viewport) {
            viewport.scrollTop = slot9am.offsetTop - SCROLL_OFFSET;
        }
    }, AUTO_SCROLL_DELAY);
}

// Sidebar toggle functions
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');

    if (sidebar.classList.contains('open')) {
        closeSidebar();
    } else {
        openSidebar();
    }
}

function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');

    sidebar.classList.add('open');
    backdrop.classList.add('open');

    // Prevent body scroll when sidebar is open on mobile
    document.body.style.overflow = 'hidden';
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');

    sidebar.classList.remove('open');
    backdrop.classList.remove('open');

    // Restore body scroll
    document.body.style.overflow = '';
}

function renderDateStrip() {
    const strip = document.getElementById('date-strip');
    const monthYearDisplay = document.getElementById('date-strip-month-year');
    if (!strip) return;

    // Update month/year display based on current view
    if (monthYearDisplay) {
        const year = selectedDate.getFullYear();
        const month = selectedDate.getMonth();

        if (currentView === 'day') {
            monthYearDisplay.textContent = `${year}年${month + 1}月`;
        } else if (currentView === 'week') {
            monthYearDisplay.textContent = `${year}年${month + 1}月`;
        } else if (currentView === 'month') {
            monthYearDisplay.textContent = `${year}年${month + 1}月`;
        }
    }

    let html = '';

    if (currentView === 'day') {
        // Apple Style: Fixed 7-day strip based on the start of the current week
        const startOfWeek = new Date(selectedDate);
        startOfWeek.setDate(selectedDate.getDate() - selectedDate.getDay());

        for (let i = 0; i < 7; i++) {
            const date = new Date(startOfWeek);
            date.setDate(startOfWeek.getDate() + i);
            const isSelected = date.toDateString() === selectedDate.toDateString();
            const isToday = date.toDateString() === new Date().toDateString();

            html += `
                <div class="date-item ${isSelected ? 'active' : ''} ${isToday ? 'is-today' : ''}" onclick="changeDate('${date.toISOString()}')">
                    <span class="day-label">${DAYS_OF_WEEK[date.getDay()]}</span>
                    <span class="date-label">${date.getDate()}</span>
                </div>
            `;
        }
    } else if (currentView === 'week') {
        // For week view, show empty date strip (dates are in header below)
        html = '';
    } else if (currentView === 'month') {
        // For month view, show month navigation controls or simplified view
        const prevMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1);
        const nextMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1);

        html = `
            <div class="month-nav-item" onclick="changeDate('${prevMonth.toISOString()}')">
                ‹ ${prevMonth.getMonth() + 1}月
            </div>
            <div class="month-nav-item current-month">
                ${selectedDate.getFullYear()}年${selectedDate.getMonth() + 1}月
            </div>
            <div class="month-nav-item" onclick="changeDate('${nextMonth.toISOString()}')">
                ${nextMonth.getMonth() + 1}月 ›
            </div>
        `;
    }

    strip.innerHTML = html;
}

function renderCalendar(containerId, monthYearId, clickHandler) {
    const calendar = document.getElementById(containerId);
    const monthYearLabel = document.getElementById(monthYearId);

    if (!calendar || !monthYearLabel) return;

    // Use displayMonth for mini calendar, selectedDate for main date strip
    const displayDate = containerId === 'mini-calendar' ? displayMonth : selectedDate;
    const year = displayDate.getFullYear();
    const month = displayDate.getMonth();
    const monthText = `${year}年${month + 1}月`;

    // Update month/year label
    monthYearLabel.textContent = monthText;

    // Get first day of month and number of days
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    
    // Get the weekday of the first day (0 = Sunday, 6 = Saturday)
    let firstDayOfWeek = firstDay.getDay();
    
    // Adjust for Monday-first calendar (0 = Monday, 6 = Sunday)
    if (firstDayOfWeek === 0) firstDayOfWeek = 6;
    else firstDayOfWeek--;

    // Get previous month's last days for padding
    const prevMonth = new Date(year, month, 0);
    const daysInPrevMonth = prevMonth.getDate();

    // Build calendar HTML
    let html = '';
    
    // Weekday headers (Mon-Sun)
    CALENDAR_WEEKDAYS.forEach(day => {
        html += `<div class="weekday">${day}</div>`;
    });

    // Previous month padding
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
        const day = daysInPrevMonth - i;
        html += `<div class="day other-month">${day}</div>`;
    }

    // Current month days
    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
        const currentDate = new Date(year, month, day);
        const isToday = currentDate.toDateString() === today.toDateString();
        const isSelected = currentDate.toDateString() === selectedDate.toDateString();
        
        let classes = 'day';
        if (isToday) classes += ' today';
        if (isSelected) classes += ' selected';
        
        html += `<div class="${classes}" onclick="${clickHandler}(${year}, ${month}, ${day})">${day}</div>`;
    }

    // Next month padding to complete the grid (6 weeks = 42 cells)
    const totalCells = 42;
    const currentCells = firstDayOfWeek + daysInMonth;
    const nextMonthDays = totalCells - currentCells;
    
    for (let day = 1; day <= nextMonthDays; day++) {
        html += `<div class="day other-month">${day}</div>`;
    }

    calendar.innerHTML = html;
}

function renderMiniCalendar() {
    renderCalendar('mini-calendar', 'sidebar-month-year', 'selectDate');
}


function navigateMonth(direction, updateCallback) {
    const currentMonth = displayMonth.getMonth();
    const currentYear = displayMonth.getFullYear();

    let newMonth, newYear;
    if (direction === 'prev') {
        newMonth = currentMonth - 1;
        newYear = newMonth < 0 ? currentYear - 1 : currentYear;
        if (newMonth < 0) newMonth = 11; // December
    } else {
        newMonth = currentMonth + 1;
        newYear = newMonth > 11 ? currentYear + 1 : currentYear;
        if (newMonth > 11) newMonth = 0; // January
    }

    // Update display month without changing selected date
    displayMonth = new Date(newYear, newMonth, 1);

    // Update the appropriate calendar(s)
    if (updateCallback) {
        updateCallback();
    } else {
        // Default: update both calendars and other components
        renderMiniCalendar();
        renderDateStrip();
        renderCalendarView();
    }
}

// Desktop sidebar navigation
function navigateSidebarMonth(direction) {
    navigateMonth(direction, () => {
        renderMiniCalendar();
        renderDateStrip();
        renderCalendarView();
    });
}


function selectDate(year, month, day, shouldCloseModal = false) {
    selectedDate = new Date(year, month, day);
    displayMonth = new Date(year, month, 1); // Sync display month with selected date
    renderDateStrip();
    renderMiniCalendar();
    renderGrid();
    
    if (shouldCloseModal) {
        closeMobileDatePicker();
    }
}

function selectDateFromMobile(year, month, day) {
    selectDate(year, month, day, true);
}

function changeDate(dateIso) {
    selectedDate = new Date(dateIso);
    displayMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1); // Sync display month
    renderCalendarView();
}

function renderHeaders() {
    const headerRow = document.getElementById('resource-headers');

    // Sort selected items by ID to maintain sidebar order (same as checkbox order)
    const sortedPractitioners = [...selectedPractitioners].sort((a, b) => a - b);
    const sortedResources = [...selectedResources].sort((a, b) => a - b);

    const headers = [
        ...sortedPractitioners.map(pId => {
            const practitioner = practitioners.find(p => p.id === pId);
            return {
                name: practitioner.name,
                type: 'practitioner',
                id: pId
            };
        }),
        ...sortedResources.map(rId => {
            const resource = resources.find(r => r.id === rId);
            return {
                name: resource.name,
                type: 'resource',
                id: rId
            };
        })
    ];

    headerRow.innerHTML = headers.map(h => {
        // Get assigned color for this item
        const color = getItemColor(h.type, h.id) || '#e5e7eb';
        return `
            <div class="resource-header ${h.name.length > 4 ? 'long-name' : ''}" data-type="${h.type}" style="border-bottom-color: ${color}">
                ${h.name}
            </div>
        `;
    }).join('');
}

function renderTimeLabels() {
    const timeLabels = document.getElementById('time-labels');
    if (!timeLabels) return;

    let html = '';

    if (currentView === 'day' || currentView === 'week') {
        // Show time labels for daily and weekly views
        for (let h = 0; h <= 23; h++) {
            const label = h === 0 ? '' : `<span>${h}</span>`;
            html += `<div class="time-label">${label}</div>`;
        }
    }
    // For month view, no time labels needed

    timeLabels.innerHTML = html;
}


function renderCalendarView() {
    if (currentView === 'day') {
        renderDailyView();
    } else if (currentView === 'week') {
        renderWeeklyView();
    } else if (currentView === 'month') {
        renderMonthlyView();
    }

    // Update time labels for current view
    renderTimeLabels();

    // Update date strip for current view
    renderDateStrip();

    // Update mini calendar
    renderMiniCalendar();
}

function renderDailyView() {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    // Sort selected items by ID to maintain sidebar order
    const sortedPractitioners = [...selectedPractitioners].sort((a, b) => a - b);
    const sortedResources = [...selectedResources].sort((a, b) => a - b);

    // Render columns for selected practitioners and resources in sidebar order
    const selectedCalendars = [
        ...sortedPractitioners.map(pId => ({
            id: pId,
            type: 'practitioner',
            data: practitioners.find(p => p.id === pId)
        })),
        ...sortedResources.map(rId => ({
            id: rId,
            type: 'resource',
            data: resources.find(r => r.id === rId)
        }))
    ];

    selectedCalendars.forEach(calendar => {
        if (!calendar.data) return;

        const col = document.createElement('div');
        col.className = calendar.type === 'practitioner' ? 'practitioner-column' : 'resource-column';

        if (calendar.type === 'practitioner') {
            // Practitioner columns show working hours and appointments
            const practitioner = calendar.data;
            for (let h = 0; h <= 23; h++) {
                for (let m = 0; m < 60; m += 15) {
                    const slot = document.createElement('div');
                    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                    const isAvailable = practitioner.schedule.some(interval => timeStr >= interval.start && timeStr < interval.end);
                    slot.className = `time-slot ${!isAvailable ? 'unavailable' : ''}`;
                    if (h === 9 && m === 0) slot.id = 'slot-9am';
                    col.appendChild(slot);
                }
            }

            // Add exceptions and appointments for practitioners
            mockExceptions.filter(ex => ex.pId === calendar.id).forEach(ex => col.appendChild(createBox(ex, 'exception-layer')));
            mockAppointments.filter(app => app.pId === calendar.id).forEach(app => col.appendChild(createAppointmentBox(app, calendar.id)));
        } else {
            // Resource columns - no default availability styling since resources don't have predefined schedules
            for (let h = 0; h <= 23; h++) {
                for (let m = 0; m < 60; m += 15) {
                    const slot = document.createElement('div');
                    slot.className = 'time-slot'; // All slots are neutral since resources don't have availability constraints
                    if (h === 9 && m === 0) slot.id = 'slot-9am';
                    col.appendChild(slot);
                }
            }

            // Resources can have their own bookings/appointments
            // For demo purposes, we'll show some mock resource bookings
            getResourceBookings(calendar.id).forEach(booking => col.appendChild(createResourceBookingBox(booking, calendar.id)));
        }

        grid.appendChild(col);
    });

    // Re-render headers to match selected calendars
    renderHeaders();
}

function renderWeeklyView() {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    // Get the 7 days of the current week (Mon-Sun)
    const weekStart = getWeekStart(selectedDate);
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
        const day = new Date(weekStart);
        day.setDate(weekStart.getDate() + i);
        weekDays.push(day);
    }

    // Create 7 day columns directly in the grid (same structure as daily view)
    weekDays.forEach(day => {
        const dayCol = document.createElement('div');
        dayCol.className = 'practitioner-column'; // Use same class as daily view

        // Add time slots with same 15-minute granularity as daily view
        for (let h = 0; h <= 23; h++) {
            for (let m = 0; m < 60; m += 15) {
                const slot = document.createElement('div');
                slot.className = 'time-slot';

                // Mark as unavailable outside typical business hours (9AM-6PM)
                const isBusinessHour = h >= 9 && h <= 18;
                if (!isBusinessHour) {
                    slot.classList.add('unavailable');
                }

                dayCol.appendChild(slot);
            }
        }

        grid.appendChild(dayCol);
    });

    // Add all events from selected practitioners and resources
    addEventsToWeeklyView();

    // Update headers for week view
    renderWeeklyHeaders(weekDays);
}

function renderMonthlyView() {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    // Get month info
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();

    // Calculate calendar grid (6 weeks × 7 days)
    const startDate = new Date(firstDay);
    startDate.setDate(firstDay.getDate() - firstDay.getDay()); // Start from Sunday

    // Create 6 weeks × 7 days grid
    for (let week = 0; week < 6; week++) {
        const weekRow = document.createElement('div');
        weekRow.className = 'month-week-row';

        for (let day = 0; day < 7; day++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(startDate.getDate() + (week * 7) + day);

            const dayCell = document.createElement('div');
            dayCell.className = 'month-day-cell';

            // Check if this day is in the current month
            const isCurrentMonth = currentDate.getMonth() === month;
            if (!isCurrentMonth) {
                dayCell.classList.add('other-month');
            }

            // Add date number
            const dateNumber = document.createElement('div');
            dateNumber.className = 'month-date-number';
            dateNumber.textContent = currentDate.getDate();
            dayCell.appendChild(dateNumber);

            // Add events container
            const eventsContainer = document.createElement('div');
            eventsContainer.className = 'month-day-events';
            dayCell.appendChild(eventsContainer);

            weekRow.appendChild(dayCell);
        }

        grid.appendChild(weekRow);
    }

    // Add events to monthly view
    addEventsToMonthlyView();

    // Update headers for month view
    renderMonthlyHeaders();
}

function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday start
    return new Date(d.setDate(diff));
}

function addEventsToWeeklyView() {
    const grid = document.getElementById('calendar-grid');

    // Get all events from selected practitioners and resources
    const allEvents = [];

    // Practitioner appointments
    selectedPractitioners.forEach(pId => {
        mockAppointments.filter(app => app.pId === pId).forEach(app => {
            allEvents.push({
                ...app,
                type: 'practitioner',
                sourceId: pId,
                color: getItemColor('practitioner', pId)
            });
        });
        mockExceptions.filter(ex => ex.pId === pId).forEach(ex => {
            allEvents.push({
                ...ex,
                type: 'exception',
                sourceId: pId,
                color: '#f59e0b' // Orange for exceptions
            });
        });
    });

    // Resource bookings
    selectedResources.forEach(rId => {
        getResourceBookings(rId).forEach(booking => {
            allEvents.push({
                ...booking,
                type: 'resource',
                sourceId: rId,
                color: getItemColor('resource', rId)
            });
        });
    });

    // Position events in the weekly grid
    allEvents.forEach(event => {
        // For demo purposes, distribute events across the week
        // In a real app, you'd use the actual event dates
        const dayIndex = event.sourceId % 7; // Simple distribution: 0-6 for the 7 days

        if (dayIndex >= 0 && dayIndex < 7) {
            const dayColumn = grid.children[dayIndex];
            if (dayColumn) {
                const eventElement = createWeeklyEventElement(event);
                dayColumn.appendChild(eventElement);
            }
        }
    });
}

function addEventsToMonthlyView() {
    const grid = document.getElementById('calendar-grid');

    // Get all events from selected practitioners and resources
    const allEvents = [];

    // Practitioner appointments
    selectedPractitioners.forEach(pId => {
        mockAppointments.filter(app => app.pId === pId).forEach(app => {
            allEvents.push({
                ...app,
                type: 'practitioner',
                sourceId: pId,
                color: getItemColor('practitioner', pId)
            });
        });
    });

    // Resource bookings
    selectedResources.forEach(rId => {
        getResourceBookings(rId).forEach(booking => {
            allEvents.push({
                ...booking,
                type: 'resource',
                sourceId: rId,
                color: getItemColor('resource', rId)
            });
        });
    });

    // Group events by date
    const eventsByDate = {};
    allEvents.forEach(event => {
        const dateKey = selectedDate.toISOString().split('T')[0]; // For demo, assume current month
        if (!eventsByDate[dateKey]) {
            eventsByDate[dateKey] = [];
        }
        eventsByDate[dateKey].push(event);
    });

    // Add events to corresponding day cells
    Object.keys(eventsByDate).forEach(dateKey => {
        const events = eventsByDate[dateKey];
        const date = new Date(dateKey);
        const dayOfMonth = date.getDate();

        // Find the corresponding cell in the month grid
        let targetCell = null;
        const weekRows = grid.querySelectorAll('.month-week-row');
        weekRows.forEach(row => {
            const cells = row.querySelectorAll('.month-day-cell');
            cells.forEach(cell => {
                const dateNumber = cell.querySelector('.month-date-number');
                if (dateNumber && parseInt(dateNumber.textContent) === dayOfMonth) {
                    targetCell = cell.querySelector('.month-day-events');
                }
            });
        });

        if (targetCell) {
            events.slice(0, 3).forEach(event => { // Show max 3 events per day
                const eventElement = createMonthlyEventElement(event);
                targetCell.appendChild(eventElement);
            });

            if (events.length > 3) {
                const moreElement = document.createElement('div');
                moreElement.className = 'month-more-events';
                moreElement.textContent = `+${events.length - 3} more`;
                targetCell.appendChild(moreElement);
            }
        }
    });
}

function createWeeklyEventElement(event) {
    const [startHour, startMinute] = event.start.split(':').map(Number);
    const [endHour, endMinute] = event.end.split(':').map(Number);

    const div = document.createElement('div');
    div.className = 'calendar-event'; // Use same class as daily view
    div.style.background = event.color || '#e5e7eb';

    // Calculate position in pixels (same as daily view: 20px per 15-minute slot)
    const startSlot = (startHour * 4) + Math.floor(startMinute / 15);
    const endSlot = (endHour * 4) + Math.floor(endMinute / 15);
    const topOffset = startSlot * 20; // 20px per slot
    const height = Math.max((endSlot - startSlot) * 20, 20); // Minimum 20px height

    div.style.top = `${topOffset}px`;
    div.style.height = `${height}px`;

    // Event content (same format as daily view)
    let title = '';
    if (event.type === 'practitioner') {
        title = `${event.patient} | ${event.appointmentType}`;
    } else if (event.type === 'resource') {
        const resource = resources.find(r => r.id === event.sourceId);
        title = `[${resource?.name || '資源'}] ${event.title}`;
    } else if (event.type === 'exception') {
        title = event.title;
    }

    div.innerHTML = `<div class="event-title">${title}</div>`;
    return div;
}

function createMonthlyEventElement(event) {
    const div = document.createElement('div');
    div.className = 'month-event';
    div.style.background = event.color || '#e5e7eb';

    let title = '';
    if (event.type === 'practitioner') {
        title = `${event.patient} | ${event.appointmentType}`;
    } else if (event.type === 'resource') {
        title = event.title;
    }

    div.innerHTML = `<div class="month-event-title">${title}</div>`;
    return div;
}

function renderWeeklyHeaders(weekDays) {
    const headerRow = document.getElementById('resource-headers');
    headerRow.innerHTML = '';

    weekDays.forEach(day => {
        const dayName = DAYS_OF_WEEK[day.getDay()];
        const dateNum = day.getDate();

        const header = document.createElement('div');
        header.className = 'resource-header';
        header.innerHTML = `
            <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 2px;">${dayName}</div>
            <div style="font-size: 14px; font-weight: 700;">${dateNum}</div>
        `;
        headerRow.appendChild(header);
    });
}

function renderMonthlyHeaders() {
    const headerRow = document.getElementById('resource-headers');
    headerRow.innerHTML = '';

    DAYS_OF_WEEK.forEach(day => {
        const header = document.createElement('div');
        header.className = 'month-weekday-header';
        header.textContent = day;
        headerRow.appendChild(header);
    });
}

function createAppointmentBox(appointment, practitionerId) {
    // Follow production naming pattern: {PatientName} | {AppointmentType} {ResourceNames} | {Notes}
    const resourceText = appointment.resources && appointment.resources.length > 0 ? ` ${appointment.resources.join(' ')}` : '';
    const title = `${appointment.patient} | ${appointment.appointmentType}${resourceText}`;
    const displayText = appointment.notes ? `${title} | ${appointment.notes}` : title;

    // Get assigned color for this practitioner
    const color = getItemColor('practitioner', practitionerId);

    const div = createCalendarElement(
        appointment.start,
        appointment.end,
        'calendar-event',
        `<div class="event-title">${displayText}</div>`,
        `${displayText} - ${appointment.start}-${appointment.end}`
    );
    div.style.background = color || '#e5e7eb'; // Fallback to gray if no color assigned

    return div;
}

function createBox(data, className) {
    return createCalendarElement(
        data.start,
        data.end,
        className,
        data.title
    );
}

function setupEventListeners() {
    // Menu FAB Handler - Toggle sidebar on mobile
    document.getElementById('menu-fab').onclick = () => {
        toggleSidebar();
    };

    // Sidebar backdrop click handler - close sidebar
    document.getElementById('sidebar-backdrop').onclick = () => {
        closeSidebar();
    };

    // Sidebar action handlers
    const sidebarAddBtn = document.getElementById('sidebar-add-btn');
    if (sidebarAddBtn) sidebarAddBtn.onclick = () => {
        openCreateModal(9, 0);
        closeSidebar(); // Close sidebar after action on mobile
    };

    const sidebarTodayBtn = document.getElementById('sidebar-today-btn');
    if (sidebarTodayBtn) sidebarTodayBtn.onclick = () => {
        selectedDate = new Date();
        displayMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1); // Sync display month
        renderDateStrip();
        renderMiniCalendar();
        renderCalendarView();

        // Auto-scroll to 9 AM
        const viewport = document.getElementById('main-viewport');
        const slot9am = document.getElementById('slot-9am');
        if (slot9am && viewport) {
            viewport.scrollTop = slot9am.offsetTop - 60;
        }

        closeSidebar(); // Close sidebar after action on mobile
    };

    const sidebarExceptionBtn = document.getElementById('sidebar-exception-btn');
    if (sidebarExceptionBtn) sidebarExceptionBtn.onclick = () => {
        alert('新增休診時段 modal would open here');
        closeSidebar(); // Close sidebar after action on mobile
    };


    // Update sidebar month/year click handler
    const sidebarMonthYear = document.getElementById('sidebar-month-year');

    if (sidebarMonthYear) {
        sidebarMonthYear.onclick = (e) => {
            e.preventDefault(); // Would open full month picker in production
        };
    }

    // Update date strip month/year click handler
    const dateStripMonthYear = document.getElementById('date-strip-month-year');



    // Add month navigation handlers
    const prevMonthBtn = document.getElementById('prev-month-btn');
    const nextMonthBtn = document.getElementById('next-month-btn');
    
    if (prevMonthBtn) {
        prevMonthBtn.onclick = () => navigateSidebarMonth('prev');
    }
    
    if (nextMonthBtn) {
        nextMonthBtn.onclick = () => navigateSidebarMonth('next');
    }


    const mobileMenuTrigger = document.getElementById('mobile-menu-trigger');
    if (mobileMenuTrigger) {
        mobileMenuTrigger.onclick = (e) => {
            e.preventDefault(); // Would open global navigation menu in production
        };
    }



    // View switcher buttons
    document.querySelectorAll('.view-option-compact').forEach(button => {
        button.onclick = () => {
            const newView = button.dataset.view;
            switchView(newView);
        };
    });

    // Practitioner filter checkboxes
    document.querySelectorAll('input[data-practitioner]').forEach(checkbox => {
        checkbox.onchange = function() {
            const practitionerId = parseInt(this.dataset.practitioner);
            togglePractitioner(practitionerId, this.checked);
        };
    });

    // Resource filter checkboxes
    document.querySelectorAll('input[data-resource]').forEach(checkbox => {
        checkbox.onchange = function() {
            const resourceId = parseInt(this.dataset.resource);
            toggleResource(resourceId, this.checked);
        };
    });



}


function toggleItem(type, id, checked) {
    const array = type === 'practitioner' ? selectedPractitioners : selectedResources;
    const selector = `input[data-${type}="${id}"]`;

    if (checked) {
        // Check if adding this would exceed the limit (practitioners + resources <= 10)
        if (selectedPractitioners.length + selectedResources.length >= 10) {
            alert('最多只能選擇 10 個治療師或資源');
            // Uncheck the checkbox
            document.querySelector(selector).checked = false;
            return;
        }
        if (!array.includes(id)) {
            array.push(id);
        }
    } else {
        const index = type === 'practitioner' ? selectedPractitioners : selectedResources;
        index.splice(index.indexOf(id), 1);
    }

    // Update colors and indicators
    assignColorsToSelectedItems();
    updateSidebarIndicators();
    renderGrid();
}

function togglePractitioner(id, checked) {
    toggleItem('practitioner', id, checked);
}

function toggleResource(id, checked) {
    toggleItem('resource', id, checked);
}

// Simplified view switching - only updates button states since only day view is implemented
function switchView(view) {
    // Update current view state
    currentView = view;

    // Update active state of view buttons
    document.querySelectorAll('.view-option-compact').forEach(button => {
        button.classList.remove('active');
        if (button.dataset.view === view) {
            button.classList.add('active');
        }
    });

    // Re-render calendar with new view
    renderCalendarView();
}

function getResourceBookings(resourceId) {
    return mockResourceBookings.filter(booking => booking.rId === resourceId);
}

function createResourceBookingBox(booking, resourceId) {
    // Find the resource name
    const resource = resources.find(r => r.id === resourceId);
    const resourceName = resource ? resource.name : `資源${resourceId}`;

    // Get assigned color for this resource
    const resourceColor = getItemColor('resource', resourceId);

    // Format according to production pattern: [{ResourceName}] {EventTitle} | {Notes}
    const displayTitle = booking.title;
    const displayText = booking.notes ? `[${resourceName}] ${displayTitle} | ${booking.notes}` : `[${resourceName}] ${displayTitle}`;

    const div = createCalendarElement(
        booking.start,
        booking.end,
        'resource-booking',
        `<div class="booking-title">${displayText}</div>`,
        `${displayText} - ${booking.start}-${booking.end}`
    );
    div.style.background = resourceColor || '#e5e7eb'; // Fallback to gray if no color assigned

    return div;
}



window.onload = initCalendar;
