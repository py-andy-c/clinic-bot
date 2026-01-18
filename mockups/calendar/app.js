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
    { id: 5, name: '周杰瑞', schedule: [{ start: '13:00', end: '21:00' }] },
    { id: 6, name: '測試醫師', schedule: [{ start: '09:00', end: '18:00' }] }
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
    // Two overlapping appointments (pId: 4, dayIndex: 4)
    {
        pId: 4,
        patient: '趙先生',
        appointmentType: '針灸治療',
        resources: ['治療室1'],
        start: '14:00',
        end: '15:00',
        notes: '慢性疼痛'
    },
    {
        pId: 4,
        patient: '錢小姐',
        appointmentType: '推拿按摩',
        resources: ['治療室1'],
        start: '14:30',
        end: '15:30',
        notes: '肩頸僵硬'
    },
    // Three overlapping appointments (pId: 5, dayIndex: 5)
    {
        pId: 5,
        patient: '孫太太',
        appointmentType: '芳香療法',
        resources: ['治療室2'],
        start: '10:00',
        end: '11:00',
        notes: '放鬆治療'
    },
    {
        pId: 5,
        patient: '周先生',
        appointmentType: '中醫調理',
        resources: ['治療室2'],
        start: '10:15',
        end: '11:15',
        notes: '體質調養'
    },
    {
        pId: 5,
        patient: '吳小姐',
        appointmentType: '熱敷治療',
        resources: ['治療室2'],
        start: '10:30',
        end: '11:30',
        notes: '肌肉放鬆'
    },
    // Appointment overlapping with availability exception (pId: 2, overlaps with '進修研習' 13:00-15:00)
    {
        pId: 2,
        patient: '鄭先生',
        appointmentType: '復健治療',
        resources: ['治療室2'],
        start: '14:00',
        end: '15:00',
        notes: '運動傷害復健'
    },
    // Super long event name to test ellipsis (pId: 6, dayIndex: 0)
    {
        pId: 6,
        patient: '測試超長名稱患者',
        appointmentType: '極其冗長的治療項目名稱測試用於驗證文字截斷功能是否正常運作',
        resources: ['治療室1'],
        start: '11:00',
        end: '12:00',
        notes: '這是一個非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常長的備註文字用來測試多行文字的省略號顯示效果'
    },
    {
        pId: 1,
        patient: '黃小姐',
        appointmentType: '芳香療法',
        resources: ['治療室1'],
        start: '13:30',
        end: '14:30',
        notes: '舒緩壓力'
    },
    // Overlapping events for testing (same dayIndex: 1 % 7 = 1, 8 % 7 = 1)
    {
        pId: 8,
        patient: '劉小姐',
        appointmentType: '頭痛治療',
        resources: ['治療室1'],
        start: '09:00',
        end: '10:00',
        notes: '偏頭痛'
    },
    {
        pId: 15, // 15 % 7 = 1, same day as pId 8
        patient: '張先生',
        appointmentType: '腰痛復健',
        resources: ['治療室2'],
        start: '09:15',
        end: '10:15',
        notes: '椎間盤突出'
    },
    {
        pId: 22, // 22 % 7 = 1, same day
        patient: '李太太',
        appointmentType: '膝蓋按摩',
        resources: ['治療室3'],
        start: '09:30',
        end: '10:30',
        notes: '退化性關節炎'
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
let selectedPractitioners = [1, 2, 3, 4, 5, 6]; // Match HTML checkbox states
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
    // Adjust layout based on view
    const timeColumn = document.getElementById('time-labels');
    const timeCorner = document.querySelector('.time-corner');
    const calendarGrid = document.getElementById('calendar-grid');

    if (currentView === 'month') {
        // Monthly view: hide time elements
        if (timeColumn) timeColumn.style.display = 'none';
        if (timeCorner) timeCorner.style.display = 'none';
        // Calendar grid displays week rows as blocks
        if (calendarGrid) calendarGrid.style.display = 'block';
    } else {
        // Daily/Weekly views: show time elements
        if (timeColumn) timeColumn.style.display = 'block';
        if (timeCorner) timeCorner.style.display = 'block';
        // Calendar grid displays day columns as flex items
        if (calendarGrid) calendarGrid.style.display = 'flex';
    }

    if (currentView === 'day') {
        renderTimeBasedView('daily');
    } else if (currentView === 'week') {
        renderTimeBasedView('weekly');
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


// Shared function for rendering time-based views (daily and weekly)
function renderTimeBasedView(viewType) {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    let columns = [];

    if (viewType === 'daily') {
        // Sort selected items by ID to maintain sidebar order
        const sortedPractitioners = [...selectedPractitioners].sort((a, b) => a - b);
        const sortedResources = [...selectedResources].sort((a, b) => a - b);

        // Render columns for selected practitioners and resources in sidebar order
        columns = [
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
    } else if (viewType === 'weekly') {
        // Get the 7 days of the current week (Mon-Sun)
        const weekStart = getWeekStart(selectedDate);
        columns = [];
        for (let i = 0; i < 7; i++) {
            const day = new Date(weekStart);
            day.setDate(weekStart.getDate() + i);
            columns.push({
                id: i,
                type: 'day',
                data: { date: day, dayName: DAYS_OF_WEEK[day.getDay()], dateNum: day.getDate() }
            });
        }
    }

    // Render columns
    columns.forEach(column => {
        const col = document.createElement('div');
        col.className = 'practitioner-column'; // Use same class for all column types

        // Add time slots (same for all column types in time-based views)
        for (let h = 0; h <= 23; h++) {
            for (let m = 0; m < 60; m += 15) {
                const slot = document.createElement('div');
                slot.className = 'time-slot';

                // Mark unavailable time slots
                if (viewType === 'daily' && column.type === 'practitioner') {
                    // Daily view: check specific practitioner availability
                    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                    const isAvailable = column.data.schedule.some(interval => timeStr >= interval.start && timeStr < interval.end);
                    if (!isAvailable) {
                        slot.classList.add('unavailable');
                    }
                } else if (viewType === 'weekly') {
                    // Weekly view: show default business hours (9AM-6PM)
                    const isBusinessHour = h >= 9 && h <= 18;
                    if (!isBusinessHour) {
                        slot.classList.add('unavailable');
                    }
                }

                if (h === 9 && m === 0) slot.id = 'slot-9am';
                col.appendChild(slot);
            }
        }

        // Add events using shared overlapping logic
        addEventsToTimeBasedView(col, column, viewType);

        grid.appendChild(col);
    });

    // Update headers
    if (viewType === 'daily') {
        renderHeaders();
    } else if (viewType === 'weekly') {
        renderWeeklyHeaders(columns.map(col => col.data.date));
    }
}

// Shared function for adding events to time-based views with overlapping logic
function addEventsToTimeBasedView(columnElement, column, viewType) {
    let events = [];

    if (viewType === 'daily') {
        if (column.type === 'practitioner') {
            // Add exceptions and appointments for practitioners
            mockExceptions.filter(ex => ex.pId === column.id).forEach(ex => {
                events.push({
                    ...ex,
                    type: 'exception',
                    sourceId: column.id
                });
            });
            mockAppointments.filter(app => app.pId === column.id).forEach(app => {
                events.push({
                    ...app,
                    type: 'practitioner',
                    sourceId: column.id,
                    color: getItemColor('practitioner', column.id)
                });
            });
        } else if (column.type === 'resource') {
            // Add resource bookings
            getResourceBookings(column.id).forEach(booking => {
                events.push({
                    ...booking,
                    type: 'resource',
                    sourceId: column.id,
                    color: getItemColor('resource', column.id)
                });
            });
        }
    } else if (viewType === 'weekly') {
        // Get events for this specific day
        const dayIndex = column.id;

        // Practitioner appointments for this day
        selectedPractitioners.forEach(pId => {
            mockAppointments.filter(app => app.pId === pId).forEach(app => {
                if ((pId % 7) === dayIndex) { // Distribute across days for demo
                    events.push({
                        ...app,
                        type: 'practitioner',
                        sourceId: pId,
                        color: getItemColor('practitioner', pId)
                    });
                }
            });
            mockExceptions.filter(ex => ex.pId === pId).forEach(ex => {
                if ((pId % 7) === dayIndex) {
                    events.push({
                        ...ex,
                        type: 'exception',
                        sourceId: pId
                    });
                }
            });
        });

        // Resource bookings for this day
        selectedResources.forEach(rId => {
            getResourceBookings(rId).forEach(booking => {
                if ((rId % 7) === dayIndex) {
                    events.push({
                        ...booking,
                        type: 'resource',
                        sourceId: rId,
                        color: getItemColor('resource', rId)
                    });
                }
            });
        });
    }

    // Separate exceptions from regular events
    const regularEvents = events.filter(event => event.type !== 'exception');
    const exceptionEvents = events.filter(event => event.type === 'exception');

    // Handle exceptions first (always full-width, no overlapping)
    exceptionEvents.forEach(exception => {
        const exceptionElement = viewType === 'daily' ?
            createBox(exception, 'exception-layer') :
            createWeeklyEventElement(exception);
        columnElement.appendChild(exceptionElement);
    });

    // Handle regular events with overlapping logic
    if (regularEvents.length === 1) {
        // Single event - full width
        const eventElement = viewType === 'daily' ?
            createAppointmentBox(regularEvents[0], regularEvents[0].sourceId) :
            createWeeklyEventElement(regularEvents[0]);
        columnElement.appendChild(eventElement);
    } else if (regularEvents.length > 1) {
        // Multiple events - group by time overlap and handle each group
        const overlappingGroups = groupOverlappingEvents(regularEvents);
        overlappingGroups.forEach(group => {
            if (group.length === 1) {
                // Single event in this time slot - full width
                const eventElement = viewType === 'daily' ?
                    createAppointmentBox(group[0], group[0].sourceId) :
                    createWeeklyEventElement(group[0]);
                columnElement.appendChild(eventElement);
            } else {
                // Multiple overlapping events - use overlapping treatment
                renderOverlappingEventGroup(group, columnElement, viewType);
            }
        });
    }
}

// Shared overlapping event rendering for both daily and weekly views
function renderOverlappingEventGroup(group, containerElement, viewType) {
    const numEvents = group.length;

    group.forEach((event, index) => {
        const eventElement = viewType === 'daily' ?
            createAppointmentBox(event, event.sourceId) :
            createWeeklyEventElement(event);

        // Calculate width and position for horizontal overlap that spans full width
        const overlapPercent = 12; // 12% horizontal overlap between events (doubled)
        const totalOverlap = (numEvents - 1) * overlapPercent; // Total overlap space
        const eventWidth = Math.max(100 - totalOverlap, 30); // Width to reach 100% span, minimum 30%

        eventElement.style.width = `${eventWidth}%`;
        eventElement.style.left = `${index * overlapPercent}%`;
        eventElement.style.zIndex = 10 + index; // Higher z-index for later events

        // Semi-transparent for overlapping events
        if (numEvents > 1) {
            eventElement.style.opacity = '0.8';
        }

        containerElement.appendChild(eventElement);
    });
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


// Group events that overlap in time
function groupOverlappingEvents(events) {
    const groups = [];

    // Sort events by start time
    events.sort((a, b) => {
        const [aHour, aMin] = a.start.split(':').map(Number);
        const [bHour, bMin] = b.start.split(':').map(Number);
        const aTime = aHour * 60 + aMin;
        const bTime = bHour * 60 + bMin;
        return aTime - bTime;
    });

    events.forEach(event => {
        let addedToGroup = false;

        // Check if this event overlaps with any existing group
        for (const group of groups) {
            if (eventsOverlap(event, group[0])) {
                group.push(event);
                addedToGroup = true;
                break;
            }
        }

        // If no overlap, create new group
        if (!addedToGroup) {
            groups.push([event]);
        }
    });

    return groups;
}

// Check if two events overlap
function eventsOverlap(event1, event2) {
    const [start1Hour, start1Min] = event1.start.split(':').map(Number);
    const [end1Hour, end1Min] = event1.end.split(':').map(Number);
    const [start2Hour, start2Min] = event2.start.split(':').map(Number);
    const [end2Hour, end2Min] = event2.end.split(':').map(Number);

    const start1 = start1Hour * 60 + start1Min;
    const end1 = end1Hour * 60 + end1Min;
    const start2 = start2Hour * 60 + start2Min;
    const end2 = end2Hour * 60 + end2Min;

    return start1 < end2 && end1 > start2;
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

    // Use exception-layer for availability exceptions, calendar-event for regular events
    if (event.type === 'exception') {
        div.className = 'exception-layer';
    } else {
        div.className = 'calendar-event'; // Single consistent class for all calendar events
        div.style.background = event.color || '#e5e7eb';
    }

    // Calculate position in pixels (same as daily view: 20px per 15-minute slot)
    const startSlot = (startHour * 4) + Math.floor(startMinute / 15);
    const endSlot = (endHour * 4) + Math.floor(endMinute / 15);
    const topOffset = startSlot * 20; // 20px per slot
    const height = Math.max((endSlot - startSlot) * 20, 20); // Minimum 20px height

    div.style.top = `${topOffset}px`;
    div.style.height = `${height}px`;
    div.style.position = 'absolute';
    div.style.left = '0';
    div.style.width = '100%'; // Default full width, will be overridden for overlapping events

    // Calculate dynamic line clamping based on event height
    const lineHeight = 13.2; // 11px font-size * 1.2 line-height
    const padding = 8; // top + bottom padding
    const availableHeight = height;
    const maxLines = Math.max(1, Math.floor((availableHeight - padding) / lineHeight));

    // Event content - more representative naming pattern for weekly view
    let title = '';
    if (event.type === 'practitioner') {
        // Include primary resource: Patient | AppointmentType Resource | Notes (if available)
        const primaryResource = event.resources && event.resources.length > 0 ? event.resources[0] : '';
        const resourceText = primaryResource ? ` ${primaryResource}` : '';
        const baseTitle = `${event.patient} | ${event.appointmentType}${resourceText}`;
        title = event.notes ? `${baseTitle} | ${event.notes}` : baseTitle;
    } else if (event.type === 'resource') {
        const resource = resources.find(r => r.id === event.sourceId);
        const resourceName = resource?.name || '資源';
        const baseTitle = `[${resourceName}] ${event.title}`;
        title = event.notes ? `${baseTitle} | ${event.notes}` : baseTitle;
    } else if (event.type === 'exception') {
        title = event.title;
    }

    // Create title element with dynamic line clamping
    const titleElement = document.createElement('div');
    titleElement.className = 'event-title';
    titleElement.textContent = title;

    // Apply dynamic line clamping based on available height
    if (maxLines >= 2) {
        titleElement.style.display = '-webkit-box';
        titleElement.style.webkitLineClamp = Math.min(maxLines, 10).toString(); // Cap at reasonable maximum
        titleElement.style.webkitBoxOrient = 'vertical';
        titleElement.style.textOverflow = 'ellipsis';
    }

    div.appendChild(titleElement);
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

    // Create title element with dynamic line clamping
    const titleElement = document.createElement('div');
    titleElement.className = 'month-event-title';
    titleElement.textContent = title;

    // For monthly events, limit to 1 line to fit more events
    titleElement.style.display = '-webkit-box';
    titleElement.style.webkitLineClamp = '1';
    titleElement.style.webkitBoxOrient = 'vertical';
    titleElement.style.textOverflow = 'ellipsis';

    div.appendChild(titleElement);
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
        '', // We'll add the title element dynamically
        `${displayText} - ${appointment.start}-${appointment.end}`
    );

    // Calculate dynamic line clamping based on event height
    const lineHeight = 13.2; // 11px font-size * 1.2 line-height
    const padding = 8; // top + bottom padding
    const height = parseInt(div.style.height) || 40; // Extract numeric height from style
    const maxLines = Math.max(1, Math.floor((height - padding) / lineHeight));

    // Create title element with dynamic line clamping
    const titleElement = document.createElement('div');
    titleElement.className = 'event-title';
    titleElement.textContent = displayText;

    // Apply dynamic line clamping based on available height
    if (maxLines >= 2) {
        titleElement.style.display = '-webkit-box';
        titleElement.style.webkitLineClamp = Math.min(maxLines, 10).toString(); // Cap at reasonable maximum
        titleElement.style.webkitBoxOrient = 'vertical';
        titleElement.style.textOverflow = 'ellipsis';
    }

    div.appendChild(titleElement);
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
