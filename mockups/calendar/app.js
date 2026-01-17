const practitioners = [
    { id: 1, name: '陳大文', color: '#3b82f6', schedule: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }] },
    { id: 2, name: '林美玲', color: '#10b981', schedule: [{ start: '10:00', end: '15:00' }, { start: '16:00', end: '20:00' }] },
    { id: 3, name: '張志遠', color: '#f59e0b', schedule: [{ start: '08:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
    { id: 4, name: '李佳穎', color: '#ef4444', schedule: [{ start: '09:00', end: '17:00' }] },
    { id: 5, name: '周杰瑞', color: '#8b5cf6', schedule: [{ start: '13:00', end: '21:00' }] },
    { id: 6, name: '吳佩珊', color: '#ec4899', schedule: [{ start: '10:00', end: '18:00' }] },
    { id: 7, name: '蔡睿承', color: '#06b6d4', schedule: [{ start: '14:00', end: '22:00' }] },
    { id: 8, name: '許曉晴', color: '#f97316', schedule: [{ start: '08:30', end: '16:30' }] }
];

const mockAppointments = [
    { pId: 1, patient: '王小明', start: '09:30', end: '10:30' },
    { pId: 2, patient: '張先生 (衝突)', start: '13:30', end: '14:30' }
];

const mockExceptions = [
    { pId: 1, title: '午休', start: '12:00', end: '13:00' },
    { pId: 2, title: '進修研習', start: '13:00', end: '15:00' },
];

let selectedDate = new Date("2026-01-19");

function initCalendar() {
    renderDateStrip();
    renderMiniCalendar();
    renderHeaders();
    renderTimeLabels();
    renderGrid();
    setupEventListeners();

    // Auto-scroll to 9 AM
    setTimeout(() => {
        const viewport = document.getElementById('main-viewport');
        const slot9am = document.getElementById('slot-9am');
        if (slot9am && viewport) {
            viewport.scrollTop = slot9am.offsetTop - 60; // Offset for header
        }
    }, 100);
}

function renderDateStrip() {
    const strip = document.getElementById('date-strip');
    if (!strip) return;
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    let html = '';

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
                <span class="day-label">${days[date.getDay()]}</span>
                <span class="date-label">${date.getDate()}</span>
            </div>
        `;
    }
    strip.innerHTML = html;
}

function renderMiniCalendar() {
    const miniCalendar = document.getElementById('mini-calendar');
    const monthYearLabel = document.getElementById('sidebar-month-year');
    if (!miniCalendar || !monthYearLabel) return;

    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    
    // Update month/year label
    monthYearLabel.textContent = `${year}年${month + 1}月`;

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
    const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
    weekdays.forEach(day => {
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
        
        html += `<div class="${classes}" onclick="selectDate(${year}, ${month}, ${day})">${day}</div>`;
    }

    // Next month padding to complete the grid (6 weeks = 42 cells)
    const totalCells = 42;
    const currentCells = firstDayOfWeek + daysInMonth;
    const nextMonthDays = totalCells - currentCells;
    
    for (let day = 1; day <= nextMonthDays; day++) {
        html += `<div class="day other-month">${day}</div>`;
    }

    miniCalendar.innerHTML = html;
}

function selectDate(year, month, day) {
    selectedDate = new Date(year, month, day);
    renderDateStrip();
    renderMiniCalendar();
    renderGrid();
}

function changeDate(dateIso) {
    selectedDate = new Date(dateIso);
    renderDateStrip();
    renderMiniCalendar();
    renderGrid();
}

function renderHeaders() {
    const headerRow = document.getElementById('resource-headers');
    headerRow.innerHTML = practitioners.map(p => `
        <div class="resource-header">${p.name}</div>
    `).join('');
}

function renderTimeLabels() {
    const timeLabels = document.getElementById('time-labels');
    let html = '';
    for (let h = 0; h <= 23; h++) {
        const label = h === 0 ? '' : `<span>${h}</span>`;
        html += `<div class="time-label">${label}</div>`;
    }
    timeLabels.innerHTML = html;
}

function renderGrid() {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    practitioners.forEach(p => {
        const col = document.createElement('div');
        col.className = 'practitioner-column';
        for (let h = 0; h <= 23; h++) {
            for (let m = 0; m < 60; m += 15) {
                const slot = document.createElement('div');
                const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                const isAvailable = p.schedule.some(interval => timeStr >= interval.start && timeStr < interval.end);
                slot.className = `time-slot ${!isAvailable ? 'unavailable' : ''}`;
                if (h === 9 && m === 0) slot.id = 'slot-9am';
                col.appendChild(slot);
            }
        }

        mockExceptions.filter(ex => ex.pId === p.id).forEach(ex => col.appendChild(createBox(ex, 'exception-layer')));
        mockAppointments.filter(app => app.pId === p.id).forEach(app => col.appendChild(createBox(app, `calendar-event practitioner-${p.id}`, true)));

        grid.appendChild(col);
    });
}

function createBox(data, className, isApp = false) {
    const start = data.start.split(':');
    const end = data.end.split(':');
    const top = parseInt(start[0]) * 60 + parseInt(start[1]);
    const height = (parseInt(end[0]) * 60 + parseInt(end[1])) - top;

    const div = document.createElement('div');
    div.className = className;
    div.style.top = `${top}px`;
    div.style.height = `${height}px`;
    div.innerHTML = isApp ? `<b>${data.start}</b><br>${data.patient}` : data.title;
    return div;
}

function setupEventListeners() {
    // FAB Handlers
    document.getElementById('add-fab').onclick = () => openCreateModal(9, 0);
    const sidebarAddBtn = document.getElementById('sidebar-add-btn');
    if (sidebarAddBtn) sidebarAddBtn.onclick = () => openCreateModal(9, 0);

    const todayHandler = () => {
        selectedDate = new Date();
        renderDateStrip();
        renderMiniCalendar();
        renderGrid();

        // Auto-scroll to 9 AM
        const viewport = document.getElementById('main-viewport');
        const slot9am = document.getElementById('slot-9am');
        if (slot9am && viewport) {
            viewport.scrollTop = slot9am.offsetTop - 60;
        }
    };

    document.getElementById('today-fab').onclick = todayHandler;
    const sidebarTodayBtn = document.getElementById('sidebar-today-btn');
    if (sidebarTodayBtn) sidebarTodayBtn.onclick = todayHandler;

    document.getElementById('settings-fab').onclick = () => {
        document.getElementById('settings-drawer').classList.add('open');
    };

    // Update sidebar month/year click handler
    const sidebarMonthYear = document.getElementById('sidebar-month-year');
    if (sidebarMonthYear) {
        sidebarMonthYear.onclick = () => {
            alert('📅 開啟全月份選擇器 (用於跨月/跨年快速跳轉)');
        };
    }

    const mobileMenuTrigger = document.getElementById('mobile-menu-trigger');
    if (mobileMenuTrigger) {
        mobileMenuTrigger.onclick = () => {
            document.getElementById('calendar-sidebar').classList.toggle('open');
        };
    }

    // Drawer Handlers
    document.querySelector('.close-drawer').onclick = () => {
        document.getElementById('settings-drawer').classList.remove('open');
    };

    document.getElementById('settings-drawer').onclick = (e) => {
        if (e.target.id === 'settings-drawer') {
            document.getElementById('settings-drawer').classList.remove('open');
        }
    };

    // Modal Handlers
    document.querySelector('.close-btn').onclick = () => document.getElementById('event-modal').style.display = 'none';
}

function openCreateModal(hour, minute) {
    alert(`📅 開啟新增預約視窗 (${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')})`);
}

window.onload = initCalendar;
