const practitioners = [
    { id: 1, name: '陳大文', color: '#3b82f6', schedule: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }] },
    { id: 2, name: '林美玲', color: '#10b981', schedule: [{ start: '10:00', end: '15:00' }, { start: '16:00', end: '20:00' }] },
    { id: 3, name: '張志遠', color: '#f59e0b', schedule: [{ start: '08:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }
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

    // Generate 14 days around the selected date
    const startDate = new Date(selectedDate);
    startDate.setDate(startDate.getDate() - 3);

    for (let i = 0; i < 14; i++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        const isSelected = date.toDateString() === selectedDate.toDateString();

        html += `
            <div class="date-item ${isSelected ? 'active' : ''}" onclick="changeDate('${date.toISOString()}')">
                <span style="font-size:10px; opacity: 0.8">${days[date.getDay()]}</span>
                <span style="font-weight:700; font-size:16px">${date.getDate()}</span>
            </div>
        `;
    }
    strip.innerHTML = html;
}

function changeDate(dateIso) {
    selectedDate = new Date(dateIso);
    renderDateStrip();
    renderGrid();

    const displayStr = `${selectedDate.getFullYear()}年${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`;
    const titleEl = document.querySelector('.date-navigator h1');
    if (titleEl) titleEl.innerText = displayStr;
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
        html += `<div class="time-label">${h}:00</div>`;
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
            for (let m = 0; m < 60; m += 30) {
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
    document.getElementById('add-fab').onclick = () => {
        alert('開啟新增預約視窗');
    };

    document.getElementById('today-fab').onclick = () => {
        selectedDate = new Date();
        renderDateStrip();
        renderGrid();

        // Auto-scroll to 9 AM
        const viewport = document.getElementById('main-viewport');
        const slot9am = document.getElementById('slot-9am');
        if (slot9am && viewport) {
            viewport.scrollTop = slot9am.offsetTop - 60;
        }

        const displayStr = `${selectedDate.getFullYear()}年${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`;
        const titleEl = document.querySelector('.date-navigator h1');
        if (titleEl) titleEl.innerText = displayStr;
    };

    document.getElementById('settings-fab').onclick = () => {
        document.getElementById('settings-drawer').classList.add('open');
    };

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

window.onload = initCalendar;
