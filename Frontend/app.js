const API_URL = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || 'http://localhost:3000/api';

function getAuthHeaders() {
    if (typeof Auth !== 'undefined') {
        return Auth.getAuthHeaders();
    }
    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(url, options = {}) {
    if (typeof Auth !== 'undefined') {
        await Auth.refreshSessionIfNeeded();
    }

    const headers = {
        ...getAuthHeaders(),
        ...(options.headers || {})
    };

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401) {
        forceLogoutToLogin();
        throw new Error('Unauthorized');
    }

    if (res.status === 503) {
        const errBody = await res.clone().json().catch(() => ({}));
        console.error('Server configuration error:', errBody.message || res.statusText);
        alert(errBody.message || 'Server is misconfigured. Check Backend/.env and restart npm start.');
        throw new Error('Server misconfigured');
    }

    return res;
}

function forceLogoutToLogin() {
    if (typeof Auth !== 'undefined') {
        Auth.clearAuthStorage();
    } else {
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('supabase_session');
    }
    window.location.href = 'login.html';
}

// --- Monthly history grouping helpers ---
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function getOrderHistoryDate(item) {
    const raw = item.createdAt || item.date || item.deliveryDate;
    const parsed = raw ? new Date(raw) : null;
    return parsed && !isNaN(parsed.getTime()) ? parsed : new Date(0);
}

function getMonthYearKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthYearLabel(date) {
    return `${MONTH_LABELS[date.getMonth()]} ${date.getFullYear()}`;
}

function sortOrdersByDateDesc(orders) {
    return [...orders].sort((a, b) => getOrderHistoryDate(b) - getOrderHistoryDate(a));
}

function appendMonthDividerRow(tbody, label, colspan) {
    const dividerRow = document.createElement('tr');
    dividerRow.className = 'month-divider-row';
    dividerRow.innerHTML = `
        <td colspan="${colspan}">
            <div class="month-history-divider" aria-label="${label}">
                <span class="month-history-divider__line"></span>
                <span class="month-history-divider__label">${label}</span>
                <span class="month-history-divider__line"></span>
            </div>
        </td>
    `;
    tbody.appendChild(dividerRow);
}

function renderTableWithMonthGroups(tbody, orders, colspan, buildRowHtml, getDate = getOrderHistoryDate) {
    if (!tbody) return;
    tbody.innerHTML = '';

    const sorted = sortOrdersByDateDesc(orders);
    let lastMonthKey = null;

    sorted.forEach(item => {
        const itemDate = getDate(item);
        const monthKey = getMonthYearKey(itemDate);

        if (monthKey !== lastMonthKey) {
            appendMonthDividerRow(tbody, formatMonthYearLabel(itemDate), colspan);
            lastMonthKey = monthKey;
        }

        const row = document.createElement('tr');
        row.innerHTML = buildRowHtml(item);
        tbody.appendChild(row);
    });
}

// --- UI Navigation ---
function showSection(sectionId, clickedEl) {
    const section = document.getElementById(sectionId);
    if (!section) return;

    document.querySelectorAll('.page-section').forEach(sec => {
        sec.classList.remove('active-section');
    });
    section.classList.add('active-section');

    document.querySelectorAll('.nav-links li').forEach(li => {
        li.classList.remove('active');
    });

    const activeNav = clickedEl || document.querySelector(`.nav-links li[data-section="${sectionId}"]`);
    if (activeNav) activeNav.classList.add('active');

    if (window.innerWidth <= 900 && typeof closeSidebar === 'function') {
        closeSidebar();
    }
}

// --- Dashboard Data & Chart ---
let revenueChart = null; // Global chart instance
let expenditureCache = [];

async function loadDashboard() {
    try {
        const response = await apiFetch(`${API_URL}/dashboard`);
        const data = await response.json();

        document.getElementById('today-sales').innerText = `LKR ${Number(data.todaySales || 0).toLocaleString()}`;
        document.getElementById('pending-payments').innerText = `LKR ${Number(data.pendingPayments || 0).toLocaleString()}`;
        document.getElementById('new-orders').innerText = Number(data.newOrders || 0);
        document.getElementById('ready-orders').innerText = Number(data.readyToDeliver || 0);

        const totalExpenditureEl = document.getElementById('total-expenditures');
        if (totalExpenditureEl) {
            totalExpenditureEl.innerText = `LKR ${Number(data.totalExpenditures || 0).toLocaleString()}`;
        }

        const netRevenueEl = document.getElementById('net-revenue');
        if (netRevenueEl) {
            netRevenueEl.innerText = `LKR ${Number(data.netRevenue || 0).toLocaleString()}`;
        }

        // Fetch default 6-month chart data
        fetchChartData(180);
    } catch (error) {
        console.error("Error loading dashboard data:", error);
    }
}



function renderChart(labels, dataPoints) {
    const ctx = document.getElementById('incomeChart').getContext('2d');

    // Destroy previous instance to prevent glitches
    if (revenueChart) {
        revenueChart.destroy();
    }

    const numericData = (dataPoints || []).map(v => Number(v) || 0);
    const maxValue = numericData.length ? Math.max(...numericData) : 0;
    const ySuggestedMax = maxValue === 0 ? 10 : Math.ceil(maxValue * 1.15);
    const yStepSize = maxValue === 0 ? 1
        : maxValue <= 10 ? 1
        : maxValue <= 100 ? 10
        : maxValue <= 1000 ? 100
        : maxValue <= 10000 ? 1000
        : Math.ceil(maxValue / 10 / 1000) * 1000;

    // Create Gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(108, 92, 231, 0.4)'); // Primary color semi-transparent
    gradient.addColorStop(1, 'rgba(108, 92, 231, 0.0)'); // Fades to transparent

    revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Monthly Revenue (LKR)',
                data: numericData,
                borderColor: '#6c5ce7',
                backgroundColor: gradient,
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#6c5ce7',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false // Hide default legend for a cleaner look
                },
                tooltip: {
                    backgroundColor: 'rgba(30, 30, 45, 0.9)',
                    padding: 12,
                    callbacks: {
                        label: function (context) {
                            return ` LKR ${context.parsed.y.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false // Hide X-axis grid lines
                    }
                },
                y: {
                    beginAtZero: true,
                    suggestedMax: ySuggestedMax,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)',
                        borderDash: [5, 5]
                    },
                    ticks: {
                        stepSize: yStepSize,
                        precision: 0,
                        callback: function (value) {
                            if (!Number.isInteger(value)) return '';
                            return 'LKR ' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}

// Fetch dynamic chart data
async function fetchChartData(rangeDays, btnElement = null) {
    if (btnElement) {
        document.querySelectorAll('.filter-pill').forEach(btn => btn.classList.remove('active'));
        btnElement.classList.add('active');
    }

    try {
        const response = await apiFetch(`${API_URL}/dashboard/chart?range=${rangeDays}`);
        const chartData = await response.json();
        renderChart(chartData.labels, chartData.data);
    } catch (error) {
        console.error("Error fetching dynamic chart data:", error);
    }
}

// --- Submit/Edit Framing Order ---
document.getElementById('framing-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const additionalServices = [];
    const taskRows = document.querySelectorAll('#framing-tasks-container .service-row');
    taskRows.forEach(row => {
        const description = (row.querySelector('.dynamic-framing-desc').value || '').trim();
        const amount = parseFloat(row.querySelector('.dynamic-framing-amount').value) || 0;
        if (description || amount > 0) {
            additionalServices.push({ description, amount });
        }
    });

    const payload = {
        customerName: document.getElementById('f-name').value,
        phone: document.getElementById('f-phone').value,
        description: document.getElementById('f-desc').value,
        deliveryDate: document.getElementById('f-date').value,
        price: parseFloat(document.getElementById('f-price').value) || 0,
        advance: parseFloat(document.getElementById('f-advance').value) || 0,
        additionalServices: additionalServices,
        notes: document.getElementById('f-notes').value,
    };

    const editId = document.getElementById('f-edit-id').value;
    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${API_URL}/orders/framing/${editId}` : `${API_URL}/framing`;

    try {
        const res = await apiFetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to save printing order');
        alert(editId ? 'Order Updated Successfully!' : 'Order Saved Successfully!');
        e.target.reset(); // Clear form
        document.getElementById('framing-tasks-container').innerHTML = '';

        // Reset edit states
        document.getElementById('f-edit-id').value = '';
        document.getElementById('framing-form-title').innerHTML = '<span style="margin-right: 8px;">➕</span> Add New Framing Order';
        document.querySelector('#framing-form button[type="submit"]').innerText = '✨ Save Order';
        if (document.getElementById('f-remaining')) document.getElementById('f-remaining').value = '';
        if (document.getElementById('f-price')) document.getElementById('f-price').value = '';

        // Refresh Dashboard and Framing List
        loadDashboard();
        loadFramingOrders();
        loadAllOrders('all');
        loadOrderStatusTab();
    } catch (error) {
        console.error("Error saving order:", error);
    }
});

// --- Submit/Edit Photo Shoot Booking ---
document.getElementById('shoot-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const additionalServices = [];
    const serviceRows = document.querySelectorAll('#additional-services-container .service-row');
    serviceRows.forEach(row => {
        const name = row.querySelector('.dynamic-service-name').value;
        const price = parseFloat(row.querySelector('.dynamic-service-price').value) || 0;
        if (name || price > 0) {
            additionalServices.push({ name, price });
        }
    });

    const payload = {
        customerName: document.getElementById('ps-name').value,
        phone: document.getElementById('ps-phone').value,
        eventType: document.getElementById('ps-event').value,
        date: document.getElementById('ps-date').value,
        time: document.getElementById('ps-time').value,
        location: document.getElementById('ps-location').value,
        price: document.getElementById('ps-total').value,
        advance: document.getElementById('ps-advance').value,
        additionalServices: additionalServices,
        note1: document.getElementById('ps-note1').value,
        note2: document.getElementById('ps-note2').value
    };

    const editId = document.getElementById('ps-edit-id').value;
    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${API_URL}/orders/shoot/${editId}` : `${API_URL}/shoots`;

    try {
        const res = await apiFetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        alert(editId ? 'Booking Updated Successfully!' : 'Booking Saved Successfully!');
        e.target.reset();
        document.getElementById('additional-services-container').innerHTML = '';

        document.getElementById('ps-edit-id').value = '';
        document.getElementById('shoot-form-title').innerHTML = '<span style="margin-right: 8px;">➕</span> Add New Photo Shoot Booking';
        document.querySelector('#shoot-form button[type="submit"]').innerText = '✨ Save';
        if (document.getElementById('ps-remaining')) document.getElementById('ps-remaining').value = '';

        loadDashboard();
        loadShootBookings();
        loadAllOrders('all');
        loadOrderStatusTab();
    } catch (error) {
        console.error("Error saving shoot booking:", error);
    }
});

// --- Submit Photo Editing Order ---
// --- Submit / Edit Photo Editing Order ---
document.getElementById('editing-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const additionalServices = [];
    const taskRows = document.querySelectorAll('#editing-tasks-container .service-row');
    taskRows.forEach(row => {
        const description = row.querySelector('.dynamic-task-desc').value;
        const amount = parseFloat(row.querySelector('.dynamic-task-amount').value) || 0;
        if (description || amount > 0) {
            additionalServices.push({ description, amount });
        }
    });

    const payload = {
        customerName: document.getElementById('e-name').value,
        phone: document.getElementById('e-phone').value,
        title: document.getElementById('e-title').value,
        deliveryDate: document.getElementById('e-date').value,
        price: document.getElementById('e-price').value,
        advance: document.getElementById('e-advance').value,
        additionalServices: additionalServices,
        note1: document.getElementById('e-note1').value,
        note2: document.getElementById('e-note2').value,
    };

    const editId = document.getElementById('e-edit-id').value;
    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${API_URL}/orders/editing/${editId}` : `${API_URL}/editing`;

    try {
        const res = await apiFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        alert(editId ? 'Order Updated Successfully!' : 'Editing Order Saved Successfully!');
        e.target.reset();
        document.getElementById('editing-tasks-container').innerHTML = '';

        document.getElementById('e-edit-id').value = '';
        document.getElementById('editing-form-title').innerHTML = '<span style="margin-right: 8px;">➕</span> Add New Editing Order';
        document.querySelector('#editing-form button[type="submit"]').innerText = '✨ Save Order';
        if (document.getElementById('e-remaining')) document.getElementById('e-remaining').value = '';
        document.getElementById('e-status').value = 'Pending';

        loadDashboard();
        loadEditingOrders();
        loadAllOrders('all');
        loadOrderStatusTab();
    } catch (error) {
        console.error("Error saving editing order:", error);
    }
});


// --- UI Helper Functions ---
function calculateFramingTotal() {
    let total = 0;
    document.querySelectorAll('#framing-tasks-container .dynamic-framing-amount').forEach(input => {
        total += parseFloat(input.value) || 0;
    });
    document.getElementById('f-price').value = total.toFixed(2);
    calculateFramingRemaining();
}

function addFramingTaskRow(description = '', amount = '') {
    const container = document.getElementById('framing-tasks-container');
    const row = document.createElement('div');
    row.className = 'service-row';
    row.innerHTML = `
        <input type="text" placeholder="Description (e.g. A4 Print, Mug)" class="dynamic-framing-desc" value="${description}">
        <input type="number" placeholder="Amount (LKR)" class="dynamic-framing-amount service-price" value="${amount}" oninput="calculateFramingTotal()">
        <button type="button" class="btn-remove" onclick="removeFramingTaskRow(this)">X</button>
    `;
    container.appendChild(row);
    calculateFramingTotal();
}

function removeFramingTaskRow(buttonEl) {
    const row = buttonEl.closest('.service-row');
    if (row) row.remove();
    calculateFramingTotal();
}

function calculateEditingTotal() {
    let total = 0;
    document.querySelectorAll('.dynamic-task-amount').forEach(input => {
        total += parseFloat(input.value) || 0;
    });
    document.getElementById('e-price').value = total;
    calculateEditingRemaining();
}

function addEditingTaskRow(description = '', amount = '') {
    const container = document.getElementById('editing-tasks-container');
    const row = document.createElement('div');
    row.className = 'service-row';
    row.innerHTML = `
        <input type="text" placeholder="Description (e.g. Color Correction)" class="dynamic-task-desc" value="${description}">
        <input type="number" placeholder="Amount (LKR)" class="dynamic-task-amount service-price" value="${amount}" oninput="calculateEditingTotal()">
        <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calculateEditingTotal()">X</button>
    `;
    container.appendChild(row);
    calculateEditingTotal();
}
function calculateShootTotal() {
    let additionalTotal = 0;
    document.querySelectorAll('.dynamic-service-price').forEach(input => {
        additionalTotal += parseFloat(input.value) || 0;
    });

    const total = additionalTotal;
    document.getElementById('ps-total').value = total;
    calculateRemaining();
}

function addServiceRow(name = '', price = '') {
    const container = document.getElementById('additional-services-container');
    const row = document.createElement('div');
    row.className = 'service-row';
    row.innerHTML = `
        <input type="text" placeholder="Service Name (e.g. Transport)" class="dynamic-service-name" value="${name}">
        <input type="number" placeholder="Amount (LKR)" class="dynamic-service-price service-price" value="${price}" oninput="calculateShootTotal()">
        <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calculateShootTotal()">X</button>
    `;
    container.appendChild(row);
    calculateShootTotal();
}

function calculateRemaining() {
    const total = parseFloat(document.getElementById('ps-total').value) || 0;
    const advance = parseFloat(document.getElementById('ps-advance').value) || 0;
    const balance = total - advance;
    document.getElementById('ps-remaining').value = balance;
}

function calculateEditingRemaining() {
    const total = parseFloat(document.getElementById('e-price').value) || 0;
    const advance = parseFloat(document.getElementById('e-advance').value) || 0;
    const balance = total - advance;
    document.getElementById('e-remaining').value = balance;
    const statusEl = document.getElementById('e-status');
    if (statusEl) statusEl.value = (balance <= 0 && total > 0) ? 'Completed' : 'Pending';
}

// Explicit event listeners for real-time math
document.getElementById('f-price').addEventListener('input', calculateFramingRemaining);
document.getElementById('f-advance').addEventListener('input', calculateFramingRemaining);

document.getElementById('ps-total').addEventListener('input', calculateRemaining);
document.getElementById('ps-advance').addEventListener('input', calculateRemaining);

document.getElementById('e-price').addEventListener('input', calculateEditingRemaining);
document.getElementById('e-advance').addEventListener('input', calculateEditingRemaining);

// --- Load Framing Orders ---
async function loadFramingOrders() {
    try {
        const response = await apiFetch(`${API_URL}/orders`);
        const allOrders = await response.json();
        const orders = allOrders.filter(o => o.orderType === 'framing');

        const tbody = document.getElementById('framing-orders-table');
        renderTableWithMonthGroups(tbody, orders, 8, (order) => {
            const statusBadge = order.status === 'Completed'
                ? `<span class="badge status-completed">Completed</span>`
                : `<span class="badge status-pending">Pending</span>`;
            const deliveryLabel = order.deliveryDate
                ? new Date(order.deliveryDate).toLocaleDateString()
                : 'N/A';

            return `
                <td><div class="color-dot ${order.colorLabel || 'none'}"></div>#${order.id}</td>
                <td style="font-weight: 600;">${order.customerName}</td>
                <td>${order.description || ''}</td>
                <td>${deliveryLabel}</td>
                <td>LKR ${order.totalPrice}</td>
                <td style="color:var(--danger); font-weight:bold;">LKR ${order.balance}</td>
                <td>${statusBadge}</td>
                <td>
                    <div style="display:flex; gap:5px; align-items:center;">
                        <button class="btn-small" style="background:#00b894; color:white; border:none;" onclick="viewFramingOrder(${order.id})">View</button>
                        <button class="btn-small" style="background:#4b6584; color:white; border:none;" onclick="printOrderReceipt(${order.id})">Print</button>
                        <button class="btn-small btn-outline" onclick="editFramingOrder(${order.id})">Edit</button>
                        <button class="btn-small" style="background:#ff6b6b; color:white; border:none;" onclick="deleteFramingOrder(${order.id})">Delete</button>
                        <div class="inline-color-picker" style="margin-left:5px;">
                            <div class="picker-dot red ${order.colorLabel === 'red' ? 'active' : ''}" onclick="quickAssignColor(${order.id}, 'red', event)"></div>
                            <div class="picker-dot yellow ${order.colorLabel === 'yellow' ? 'active' : ''}" onclick="quickAssignColor(${order.id}, 'yellow', event)"></div>
                            <div class="picker-dot green ${order.colorLabel === 'green' ? 'active' : ''}" onclick="quickAssignColor(${order.id}, 'green', event)"></div>
                        </div>
                    </div>
                </td>
            `;
        });
    } catch (error) {
        console.error("Error loading framing orders:", error);
    }
}

function calculateFramingRemaining() {
    const total = parseFloat(document.getElementById('f-price').value) || 0;
    const advance = parseFloat(document.getElementById('f-advance').value) || 0;
    if (document.getElementById('f-remaining')) {
        document.getElementById('f-remaining').value = (total - advance).toFixed(2);
    }
}

// Framing Order Management (Edit & Delete)
async function deleteFramingOrder(id) {
    if (!confirm('Are you sure you want to delete this order?')) return;
    try {
        await apiFetch(`${API_URL}/orders/framing/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        loadFramingOrders();
        loadDashboard();
        loadAllOrders('all');
    } catch (e) { console.error(e); }
}

async function editFramingOrder(id) {
    try {
        const response = await apiFetch(`${API_URL}/orders`);
        const allOrders = await response.json();
        const orders = allOrders.filter(o => o.orderType === 'framing');
        const order = orders.find(o => o.id === id);
        if (!order) return;

        document.getElementById('f-edit-id').value = order.id;
        document.getElementById('f-name').value = order.customerName;
        document.getElementById('f-phone').value = order.phone || '';
        document.getElementById('f-desc').value = order.description || '';
        document.getElementById('f-date').value = order.deliveryDate;
        document.getElementById('f-price').value = order.totalPrice;
        document.getElementById('f-advance').value = order.advancePaid || order.advance || 0;
        document.getElementById('f-notes').value = order.notes;

        document.getElementById('framing-tasks-container').innerHTML = '';
        if (order.additionalServices && order.additionalServices.length > 0) {
            order.additionalServices.forEach(s => addFramingTaskRow(s.description, s.amount));
        }
        calculateFramingRemaining();

        document.getElementById('framing-form-title').innerHTML = '<span style="margin-right: 8px;">✏️</span> Edit Framing Order';
        document.querySelector('#framing-form button[type="submit"]').innerText = '💾 Update Order';

        showSection('framing'); // Ensure user is seeing framing tab to edit
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { document.error(e); }
}

async function viewFramingOrder(id) {
    try {
        const response = await apiFetch(`${API_URL}/orders`);
        const allOrders = await response.json();
        const orders = allOrders.filter(o => o.orderType === 'framing');
        const order = orders.find(o => o.id === id);
        if (!order) return;

        document.getElementById('v-order-id').innerText = order.id;
        document.getElementById('v-name').innerText = order.customerName;
        document.getElementById('v-phone').innerText = order.phone || 'N/A';
        document.getElementById('v-desc').innerText = order.description || '';
        document.getElementById('v-date').innerText = new Date(order.deliveryDate).toLocaleDateString();
        document.getElementById('v-price').innerText = order.totalPrice;
        document.getElementById('v-advance').innerText = order.advancePaid || order.advance || 0;
        document.getElementById('v-balance').innerText = order.balance;
        document.getElementById('v-status').innerHTML = order.status === 'Completed'
            ? '<span style="color:#50cd89; font-weight:bold;">Completed</span>'
            : '<span style="color:#f1416c; font-weight:bold;">Pending</span>';

        const servicesList = document.getElementById('vf-services-list');
        servicesList.innerHTML = '';
        if (order.additionalServices && order.additionalServices.length > 0) {
            let html = '<p><strong>Services:</strong></p><ul style="margin-top: 5px; padding-left: 20px;">';
            order.additionalServices.forEach(service => {
                const description = service.description || service.name || '';
                const amount = service.amount ?? service.price ?? 0;
                html += `<li>${description}: LKR ${amount}</li>`;
            });
            html += '</ul>';
            servicesList.innerHTML = html;
        }

        document.getElementById('v-notes').innerText = order.notes || 'None';

        // Format WhatsApp Number
        let phone = order.phone ? order.phone.replace(/[\s-]/g, '') : '';
        const waLink = document.getElementById('v-whatsapp');

        if (phone) {
            if (phone.startsWith('0')) {
                phone = '+94' + phone.substring(1);
            } else if (!phone.startsWith('+')) {
                phone = '+94' + phone;
            }
            waLink.href = `https://wa.me/${phone.replace('+', '')}`;
            waLink.style.display = 'inline-block';
        } else {
            waLink.style.display = 'none';
        }

        document.getElementById('view-framing-modal').classList.add('active');
    } catch (e) {
        console.error(e);
    }
}

function closeViewModal() {
    document.getElementById('view-framing-modal').classList.remove('active');
}

// --- Load Shoot Bookings ---
async function loadShootBookings() {
    try {
        const response = await apiFetch(`${API_URL}/orders`);
        const allOrders = await response.json();
        const orders = allOrders.filter(o => o.orderType === 'shoot');

        const tbody = document.getElementById('shoots-table');
        renderTableWithMonthGroups(tbody, orders, 7, (order) => {
            const eventDate = order.date ? new Date(order.date).toLocaleDateString() : 'N/A';
            return `
                <td><div class="color-dot ${order.colorLabel || 'none'}"></div>#${order.id}</td>
                <td style="font-weight: 600;">${order.customerName}</td>
                <td>${order.eventType}</td>
                <td>${eventDate}</td>
                <td>LKR ${order.totalPrice}</td>
                <td style="color:var(--danger); font-weight:bold;">LKR ${order.balance}</td>
                <td>
                    <div style="display:flex; gap:5px; align-items:center;">
                        <button class="btn-small" style="background:#00b894; color:white; border:none;" onclick="viewShootBooking(${order.id})">View</button>
                        <button class="btn-small" style="background:#4b6584; color:white; border:none;" onclick="printShootReceipt(${order.id})">Print</button>
                        <button class="btn-small btn-outline" onclick="editShootBooking(${order.id})">Edit</button>
                        <button class="btn-small" style="background:#ff6b6b; color:white; border:none;" onclick="deleteShootBooking(${order.id})">Delete</button>
                        <div class="inline-color-picker" style="margin-left:5px;">
                            <div class="picker-dot red ${order.colorLabel === 'red' ? 'active' : ''}" onclick="quickAssignShootColor(${order.id}, 'red', event)"></div>
                            <div class="picker-dot yellow ${order.colorLabel === 'yellow' ? 'active' : ''}" onclick="quickAssignShootColor(${order.id}, 'yellow', event)"></div>
                            <div class="picker-dot green ${order.colorLabel === 'green' ? 'active' : ''}" onclick="quickAssignShootColor(${order.id}, 'green', event)"></div>
                        </div>
                    </div>
                </td>
            `;
        });
    } catch (error) {
        console.error("Error loading shoot bookings:", error);
    }
}

// Shoot Booking Management
async function deleteShootBooking(id) {
    if (!confirm('Are you sure you want to delete this booking?')) return;
    try {
        await apiFetch(`${API_URL}/orders/shoot/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        loadShootBookings();
        loadDashboard();
    } catch (e) { console.error(e); }
}

async function editShootBooking(id) {
    try {
        const response = await apiFetch(`${API_URL}/orders`);
        const allOrders = await response.json();
        const order = allOrders.find(o => o.id === id && o.orderType === 'shoot');
        if (!order) return;

        document.getElementById('ps-edit-id').value = order.id;
        document.getElementById('ps-name').value = order.customerName;
        document.getElementById('ps-phone').value = order.phone || '';
        document.getElementById('ps-event').value = order.eventType;
        document.getElementById('ps-date').value = order.date;
        document.getElementById('ps-time').value = order.time || '';
        document.getElementById('ps-location').value = order.location;
        document.getElementById('ps-total').value = order.totalPrice;
        document.getElementById('ps-advance').value = order.advancePaid || order.advance || 0;

        document.getElementById('additional-services-container').innerHTML = '';
        if (order.additionalServices && order.additionalServices.length > 0) {
            order.additionalServices.forEach(s => addServiceRow(s.name, s.price));
        }

        document.getElementById('ps-note1').value = order.note1 || '';
        document.getElementById('ps-note2').value = order.note2 || '';

        calculateRemaining();

        document.getElementById('shoot-form-title').innerHTML = '<span style="margin-right: 8px;">✏️</span> Edit Photo Shoot Booking';
        document.querySelector('#shoot-form button[type="submit"]').innerText = '💾 Update Booking';

        showSection('shoots');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { console.error(e); }
}

async function viewShootBooking(id) {
    try {
        const response = await apiFetch(`${API_URL}/orders`);
        const allOrders = await response.json();
        const order = allOrders.find(o => o.id === id && o.orderType === 'shoot');
        if (!order) return;

        document.getElementById('vs-order-id').innerText = order.id;
        document.getElementById('vs-name').innerText = order.customerName;
        document.getElementById('vs-phone').innerText = order.phone || 'N/A';
        document.getElementById('vs-event').innerText = order.eventType;
        document.getElementById('vs-date').innerText = new Date(order.date).toLocaleDateString();
        document.getElementById('vs-time').innerText = order.time || 'N/A';
        document.getElementById('vs-location').innerText = order.location || 'N/A';
        document.getElementById('vs-price').innerText = order.totalPrice;
        document.getElementById('vs-advance').innerText = order.advancePaid || order.advance || 0;
        document.getElementById('vs-balance').innerText = order.balance;

        const servicesList = document.getElementById('vs-services-list');
        let servicesHTML = '<p><strong>Services:</strong></p><ul style="margin-top: 5px; padding-left: 20px;">';
        if (order.additionalServices && order.additionalServices.length > 0) {
            order.additionalServices.forEach(service => {
                const description = service.description || service.name || '';
                const amount = service.amount ?? service.price ?? 0;
                servicesHTML += `<li>${description}: LKR ${amount}</li>`;
            });
        }
        servicesHTML += '</ul>';
        servicesList.innerHTML = servicesHTML;

        document.getElementById('vs-note1').innerText = order.note1 || 'None';
        document.getElementById('vs-note2').innerText = order.note2 || 'None';

        let phone = order.phone ? order.phone.replace(/[\s-]/g, '') : '';
        const waLink = document.getElementById('vs-whatsapp');
        if (phone) {
            if (phone.startsWith('0')) phone = '+94' + phone.substring(1);
            else if (!phone.startsWith('+')) phone = '+94' + phone;
            waLink.href = `https://wa.me/${phone.replace('+', '')}`;
            waLink.style.display = 'inline-block';
        } else {
            waLink.style.display = 'none';
        }

        document.getElementById('view-shoot-modal').classList.add('active');
    } catch (e) {
        console.error(e);
    }
}

function closeShootViewModal() {
    document.getElementById('view-shoot-modal').classList.remove('active');
}

async function quickAssignShootColor(id, color, event) {
    const pickerContainer = event.target.parentElement;
    const isAlreadyActive = event.target.classList.contains('active');

    pickerContainer.querySelectorAll('.picker-dot').forEach(dot => dot.classList.remove('active'));

    const newColor = isAlreadyActive ? '' : color;

    if (!isAlreadyActive) {
        event.target.classList.add('active');
    }

    const row = pickerContainer.closest('tr');
    if (row) {
        const orderIdDot = row.querySelector('.color-dot');
        if (orderIdDot) orderIdDot.className = `color-dot ${newColor || 'none'}`;
    }

    try {
        await apiFetch(`${API_URL}/shoots/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({ colorLabel: newColor })
        });
    } catch (e) {
        console.error("Error quick assigning shoot color:", e);
        loadShootBookings();
    }
}

async function quickAssignEditingColor(id, color, event) {
    const pickerContainer = event.target.parentElement;
    const isAlreadyActive = event.target.classList.contains('active');

    pickerContainer.querySelectorAll('.picker-dot').forEach(dot => dot.classList.remove('active'));

    const newColor = isAlreadyActive ? '' : color;

    if (!isAlreadyActive) {
        event.target.classList.add('active');
    }

    const row = pickerContainer.closest('tr');
    if (row) {
        const dot = row.querySelector('.color-dot');
        if (dot) dot.className = `color-dot ${newColor || 'none'}`;
    }

    try {
        await apiFetch(`${API_URL}/editing/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ colorLabel: newColor })
        });
        const currentFilterBtn = document.querySelector('.filter-btn.active');
        const filterId = currentFilterBtn ? currentFilterBtn.id.replace('filter-', '') : 'all';
        await loadAllOrders(filterId);
    } catch (e) {
        console.error("Error quick assigning editing color:", e);
        loadEditingOrders();
    }
}

async function printShootReceipt(id) {
    try {
        const response = await apiFetch(`${API_URL}/orders`);
        const allOrders = await response.json();
        const order = allOrders.find(o => o.id === id && o.orderType === 'shoot');
        if (!order) return;

        let additionalRows = '';
        if (order.additionalServices && order.additionalServices.length > 0) {
            order.additionalServices.forEach(service => {
                const description = service.description || service.name || '';
                const amount = service.amount ?? service.price ?? 0;
                additionalRows += `<div class="details-row"><span>${description}</span><span>LKR ${amount}</span></div>`;
            });
        }

        const receiptHTML = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Receipt - Booking #${order.id}</title>
                <style>
                    body { font-family: 'Courier New', Courier, monospace; margin: 0; padding: 20px; color: #000; background: #fff; }
                    .receipt-container { max-width: 400px; margin: 0 auto; padding: 20px; border: 1px dashed #ccc; }
                    h2 { text-align: center; margin-bottom: 5px; font-size: 24px; }
                    .shop-subtitle { text-align: center; font-size: 14px; margin-bottom: 20px; border-bottom: 1px dashed #000; padding-bottom: 10px; }
                    .details-row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 14px; }
                    .divider { border-bottom: 1px dashed #000; margin: 15px 0; }
                    .financials .details-row { font-size: 15px; }
                    .total-row { font-weight: bold; font-size: 16px; border-top: 1px dashed #000; padding-top: 5px; }
                    .footer-msg { text-align: center; margin-top: 20px; font-size: 13px; font-style: italic; }
                </style>
            </head>
            <body>
                <div class="receipt-container">
                    <h2>Studio Gray Shades</h2>
                    <div class="shop-subtitle">Photography Booking Receipt</div>
                    
                    <div class="details-row">
                        <span><strong>Booking ID:</strong> #${order.id}</span>
                        <span><strong>Date:</strong> ${new Date().toLocaleDateString()}</span>
                    </div>
                    
                    <div class="divider"></div>
                    
                    <div class="details-row">
                        <span><strong>Customer:</strong></span>
                        <span>${order.customerName}</span>
                    </div>
                    <div class="details-row">
                        <span><strong>Phone:</strong></span>
                        <span>${order.phone || 'N/A'}</span>
                    </div>
                    
                    <div class="divider"></div>
                    
                    <div style="margin-bottom: 10px;"><strong>Event Details:</strong></div>
                    <div class="details-row">
                        <span><strong>Event Title:</strong></span>
                        <span>${order.eventType}</span>
                    </div>
                    <div class="details-row">
                        <span><strong>Event Date:</strong></span>
                        <span>${new Date(order.date).toLocaleDateString()} at ${order.time}</span>
                    </div>
                    <div class="details-row">
                        <span><strong>Location:</strong></span>
                        <span>${order.location}</span>
                    </div>
                    
                    <div class="divider"></div>
                    
                    <div style="margin-bottom: 10px;"><strong>Services:</strong></div>
                    <div style="font-size: 14px; margin-bottom: 10px;">
                        ${additionalRows}
                    </div>
                    
                    <div class="divider"></div>
                    
                    <div class="financials">
                        <div class="details-row">
                            <span>Total Price:</span>
                            <span>LKR ${order.totalPrice}</span>
                        </div>
                        <div class="details-row">
                            <span>Advance Paid:</span>
                            <span>LKR ${order.advancePaid || order.advance || 0}</span>
                        </div>
                        <div class="details-row total-row">
                            <span>Remaining Balance:</span>
                            <span>LKR ${order.balance}</span>
                        </div>
                    </div>
                    
                    <div class="divider"></div>
                    
                    <div class="footer-msg">
                        Thank you for choosing Studio Gray Shades!
                    </div>
                </div>
            </body>
            </html>
        `;

        const printWindow = window.open('', '_blank', 'width=600,height=800');
        if (printWindow) {
            printWindow.document.open();
            printWindow.document.write(receiptHTML);
            printWindow.document.close();

            setTimeout(() => {
                printWindow.focus();
                printWindow.print();
                printWindow.onafterprint = () => printWindow.close();
            }, 250);
        } else {
            alert('Popup blocked. Please allow popups to print receipts.');
        }
    } catch (e) {
        console.error("Error generating receipt:", e);
    }
}

// --- Print Framing Order Receipt ---
async function printOrderReceipt(id) {
    try {
        const response = await apiFetch(`${API_URL}/orders`);
        const allOrders = await response.json();
        const orders = allOrders.filter(o => o.orderType === 'framing');
        const order = orders.find(o => o.id === id);
        if (!order) return;

        let additionalRows = '';
        if (order.additionalServices && order.additionalServices.length > 0) {
            order.additionalServices.forEach(service => {
                const description = service.description || service.name || '';
                const amount = service.amount ?? service.price ?? 0;
                additionalRows += `<div class="details-row"><span>${description}</span><span>LKR ${amount}</span></div>`;
            });
        }

        const receiptHTML = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Receipt - Order #${order.id}</title>
                <style>
                    body {
                        font-family: 'Courier New', Courier, monospace;
                        margin: 0;
                        padding: 20px;
                        color: #000;
                        background: #fff;
                    }
                    .receipt-container {
                        max-width: 400px;
                        margin: 0 auto;
                        padding: 20px;
                        border: 1px dashed #ccc;
                    }
                    h2 {
                        text-align: center;
                        margin-bottom: 5px;
                        font-size: 24px;
                    }
                    .shop-subtitle {
                        text-align: center;
                        font-size: 14px;
                        margin-bottom: 20px;
                        border-bottom: 1px dashed #000;
                        padding-bottom: 10px;
                    }
                    .details-row {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 5px;
                        font-size: 14px;
                    }
                    .divider {
                        border-bottom: 1px dashed #000;
                        margin: 15px 0;
                    }
                    .financials .details-row {
                        font-size: 15px;
                    }
                    .total-row {
                        font-weight: bold;
                        font-size: 16px;
                        border-top: 1px dashed #000;
                        padding-top: 5px;
                    }
                    .footer-msg {
                        text-align: center;
                        margin-top: 20px;
                        font-size: 13px;
                        font-style: italic;
                    }
                </style>
            </head>
            <body>
                <div class="receipt-container">
                    <h2>Studio Gray Shades</h2>
                    <div class="shop-subtitle">Photography & Framing</div>
                    
                    <div class="details-row">
                        <span><strong>Order ID:</strong> #${order.id}</span>
                        <span><strong>Date:</strong> ${new Date().toLocaleDateString()}</span>
                    </div>
                    
                    <div class="divider"></div>
                    
                    <div class="details-row">
                        <span><strong>Customer:</strong></span>
                        <span>${order.customerName}</span>
                    </div>
                    <div class="details-row">
                        <span><strong>Phone:</strong></span>
                        <span>${order.phone || 'N/A'}</span>
                    </div>
                    
                    <div class="divider"></div>
                    
                    <div style="margin-bottom: 10px;"><strong>Order Details:</strong></div>
                    <div style="font-size: 14px; margin-bottom: 10px;">
                        ${order.description || 'N/A'}
                    </div>
                    
                    <div style="margin-bottom: 10px;"><strong>Services:</strong></div>
                    <div style="font-size: 14px; margin-bottom: 10px;">
                        ${additionalRows}
                    </div>

                    <div class="details-row">
                        <span><strong>Delivery Date:</strong></span>
                        <span>${new Date(order.deliveryDate).toLocaleDateString()}</span>
                    </div>
                    
                    <div class="divider"></div>
                    
                    <div class="financials">
                        <div class="details-row">
                            <span>Total Price:</span>
                            <span>LKR ${order.totalPrice}</span>
                        </div>
                        <div class="details-row">
                            <span>Advance Paid:</span>
                            <span>LKR ${order.advancePaid || order.advance || 0}</span>
                        </div>
                        <div class="details-row total-row">
                            <span>Remaining Balance:</span>
                            <span>LKR ${order.balance}</span>
                        </div>
                    </div>
                    
                    <div class="divider"></div>
                    
                    <div class="footer-msg">
                        Thank you for choosing Studio Gray Shades!
                    </div>
                </div>
            </body>
            </html>
        `;

        const printWindow = window.open('', '_blank', 'width=600,height=800');
        if (printWindow) {
            printWindow.document.open();
            printWindow.document.write(receiptHTML);
            printWindow.document.close();

            setTimeout(() => {
                printWindow.focus();
                printWindow.print();
                printWindow.onafterprint = () => printWindow.close();
            }, 250);
        } else {
            alert('Popup blocked. Please allow popups to print receipts.');
        }
    } catch (e) {
        console.error("Error generating receipt:", e);
    }
}

// --- Load All Orders Filter ---
let masterAllOrdersArray = [];
let currentAllOrdersFilter = 'all';

async function loadAllOrders(filter = null) {
    if (filter) {
        currentAllOrdersFilter = filter;
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.getElementById(`filter-${filter}`);
        if (activeBtn) activeBtn.classList.add('active');
    }

    try {
        const response = await apiFetch(`${API_URL}/orders`);
        const allOrders = await response.json();
        masterAllOrdersArray = allOrders.filter(o => o.orderType === 'framing' || o.orderType === 'shoot' || o.orderType === 'editing');
        
        applyAllOrdersFilters();
    } catch (e) {
        console.error("Error loading all orders:", e);
    }
}

function clearAllOrdersFilters() {
    const searchInput = document.getElementById('all-orders-search');
    const dateInput = document.getElementById('all-orders-date-filter');
    if (searchInput) searchInput.value = '';
    if (dateInput) dateInput.value = '';
    applyAllOrdersFilters();
}

function applyAllOrdersFilters() {
    let baseOrders = masterAllOrdersArray;

    // Compute label counts
    const lc = {
        red: { framing: 0, shoot: 0, editing: 0 },
        yellow: { framing: 0, shoot: 0, editing: 0 },
        green: { framing: 0, shoot: 0, editing: 0 }
    };
    baseOrders.forEach(o => { if (o.colorLabel && lc[o.colorLabel]) lc[o.colorLabel][o.orderType]++; });
    const tot = c => c.framing + c.shoot + c.editing;

    const filterAllBtn = document.getElementById('filter-all');
    if(filterAllBtn) filterAllBtn.innerText = `All (${baseOrders.length})`;
    
    const redEl = document.getElementById('filter-red-count');
    const yelEl = document.getElementById('filter-yellow-count');
    const grnEl = document.getElementById('filter-green-count');
    if (redEl) redEl.textContent = `(${tot(lc.red)} · 🖼️${lc.red.framing} 📸${lc.red.shoot} 🎨${lc.red.editing})`;
    if (yelEl) yelEl.textContent = `(${tot(lc.yellow)} · 🖼️${lc.yellow.framing} 📸${lc.yellow.shoot} 🎨${lc.yellow.editing})`;
    if (grnEl) grnEl.textContent = `(${tot(lc.green)} · 🖼️${lc.green.framing} 📸${lc.green.shoot} 🎨${lc.green.editing})`;

    // Category filter
    let orders = baseOrders;
    let titleText = 'All Orders';
    const filter = currentAllOrdersFilter;

    if (filter === 'type-framing') { orders = orders.filter(o => o.orderType === 'framing'); titleText = '🖼️ Framing Orders'; }
    else if (filter === 'type-shoot') { orders = orders.filter(o => o.orderType === 'shoot'); titleText = '📸 Photo Shoot Bookings'; }
    else if (filter === 'type-editing') { orders = orders.filter(o => o.orderType === 'editing'); titleText = '🎨 Editing Orders'; }
    else if (filter === 'red') { orders = orders.filter(o => o.colorLabel === 'red'); titleText = '🔴 Red Label Orders'; }
    else if (filter === 'yellow') { orders = orders.filter(o => o.colorLabel === 'yellow'); titleText = '🟡 Yellow Label Orders'; }
    else if (filter === 'green') { orders = orders.filter(o => o.colorLabel === 'green'); titleText = '🟢 Green Label Orders'; }
    else if (filter === 'status-completed') { orders = orders.filter(o => o.status === 'Completed'); titleText = '✅ Completed Orders'; }
    else if (filter === 'status-pending') { orders = orders.filter(o => o.status !== 'Completed'); titleText = '⏳ Pending / Booked Orders'; }

    // Advanced Search and Date filters
    const searchInput = document.getElementById('all-orders-search');
    const dateFilter = document.getElementById('all-orders-date-filter');
    
    const searchText = (searchInput ? searchInput.value : '').toLowerCase().trim();
    const filterDate = dateFilter ? dateFilter.value : '';

    if (searchText || filterDate) {
        orders = orders.filter(order => {
            let matchSearch = true;
            if (searchText) {
                const name = (order.customerName || '').toLowerCase();
                const phone = (order.phone || '').toLowerCase();
                const title = (order.title || order.eventType || order.description || '').toLowerCase();
                const price = String(order.totalPrice || '').toLowerCase();
                
                matchSearch = name.includes(searchText) || phone.includes(searchText) || title.includes(searchText) || price.includes(searchText);
            }

            let matchDate = true;
            if (filterDate) {
                const oDate = order.date || order.createdAt || order.deliveryDate;
                if (oDate) {
                    const d = new Date(oDate);
                    const yyyy = d.getFullYear();
                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                    const orderYm = `${yyyy}-${mm}`;
                    matchDate = (orderYm === filterDate);
                } else {
                    matchDate = false;
                }
            }

            return matchSearch && matchDate;
        });
    }

    const titleEl = document.getElementById('all-orders-title');
    if (titleEl) titleEl.textContent = `${titleText} (${orders.length})`;

    renderOrdersView(orders);
}

function renderOrdersView(orders) {
    const tbody = document.getElementById('all-orders-table');
    renderTableWithMonthGroups(tbody, orders, 6, (order) => {
        const isShoot = order.orderType === 'shoot';
        const isEditing = order.orderType === 'editing';
        const statusBadge = order.status === 'Completed'
            ? `<span class="badge status-completed">Completed</span>`
            : `<span class="badge status-pending">${order.status || 'Pending'}</span>`;
        const typeBadge = isShoot
            ? `<span style="background:rgba(108,92,231,0.15);color:var(--primary-color);padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;">📸 Shoot</span>`
            : isEditing
                ? `<span style="background:rgba(253,203,110,0.2);color:#e17055;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;">🎨 Editing</span>`
                : `<span style="background:rgba(0,184,148,0.15);color:#00b894;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;">🖼️ Framing</span>`;
        const description = isShoot ? `${order.eventType || ''}`
            : isEditing ? `${order.title || ''}`
                : (order.description || '');
        const dateDisplay = isShoot
            ? (order.date ? new Date(order.date).toLocaleDateString() : 'N/A')
            : (order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString() : 'N/A');
        const colorDot = order.colorLabel ? `<div class="color-dot ${order.colorLabel}" style="display:inline-block;margin-right:4px;"></div>` : '';
        const viewFn = isShoot ? `viewShootBooking(${order.id})` : isEditing ? `viewEditingOrder(${order.id})` : `viewFramingOrder(${order.id})`;
        const printFn = isShoot ? `printShootReceipt(${order.id})` : isEditing ? `printEditingReceipt(${order.id})` : `printOrderReceipt(${order.id})`;
        const editFn = isShoot ? `editShootBooking(${order.id})` : isEditing ? `editEditingOrder(${order.id})` : `editFramingOrder(${order.id})`;

        return `
            <td>${typeBadge}<br><small style="color:var(--text-muted);">${colorDot}#${order.id}</small></td>
            <td style="font-weight:600;">${order.customerName}</td>
            <td>${description}</td>
            <td>${dateDisplay}</td>
            <td>${statusBadge}</td>
            <td>
                <div style="display:flex;gap:5px;align-items:center;">
                    <button class="btn-small" style="background:#00b894;color:white;border:none;" onclick="${viewFn}">View</button>
                    <button class="btn-small" style="background:#4b6584;color:white;border:none;" onclick="${printFn}">Print</button>
                    <button class="btn-small btn-outline" onclick="${editFn}">Edit</button>
                </div>
            </td>
        `;
    });
}


// --- Editing Orders CRUD ---
async function loadEditingOrders() {
    try {
        const response = await apiFetch(`${API_URL}/orders`);
        const allOrders = await response.json();
        const orders = allOrders.filter(o => o.orderType === 'editing');

        const tbody = document.getElementById('editing-orders-table');
        renderTableWithMonthGroups(tbody, orders, 8, (order) => {
            const statusBadge = order.status === 'Completed'
                ? `<span class="badge status-completed">Completed</span>`
                : `<span class="badge status-pending">${order.status || 'Pending'}</span>`;
            const deliveryLabel = order.deliveryDate
                ? new Date(order.deliveryDate).toLocaleDateString()
                : 'N/A';

            return `
                <td><div class="color-dot ${order.colorLabel || 'none'}"></div>#${order.id}</td>
                <td style="font-weight:600;">${order.customerName}</td>
                <td>${order.title || ''}</td>
                <td>${deliveryLabel}</td>
                <td>LKR ${order.totalPrice}</td>
                <td style="color:var(--danger); font-weight:bold;">LKR ${order.balance}</td>
                <td>${statusBadge}</td>
                <td>
                    <div style="display:flex; gap:5px; align-items:center;">
                        <button class="btn-small" style="background:#00b894; color:white; border:none;" onclick="viewEditingOrder(${order.id})">View</button>
                        <button class="btn-small" style="background:#4b6584; color:white; border:none;" onclick="printEditingReceipt(${order.id})">Print</button>
                        <button class="btn-small btn-outline" onclick="editEditingOrder(${order.id})">Edit</button>
                        <button class="btn-small" style="background:#ff6b6b; color:white; border:none;" onclick="deleteEditingOrder(${order.id})">Delete</button>
                        <div class="inline-color-picker" style="margin-left:5px;">
                            <div class="picker-dot red ${order.colorLabel === 'red' ? 'active' : ''}" onclick="quickAssignEditingColor(${order.id}, 'red', event)"></div>
                            <div class="picker-dot yellow ${order.colorLabel === 'yellow' ? 'active' : ''}" onclick="quickAssignEditingColor(${order.id}, 'yellow', event)"></div>
                            <div class="picker-dot green ${order.colorLabel === 'green' ? 'active' : ''}" onclick="quickAssignEditingColor(${order.id}, 'green', event)"></div>
                        </div>
                    </div>
                </td>
            `;
        });
    } catch (e) {
        console.error('Error loading editing orders:', e);
    }
}

async function deleteEditingOrder(id) {
    if (!confirm('Are you sure you want to delete this editing order?')) return;
    try {
        await apiFetch(`${API_URL}/orders/editing/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        loadEditingOrders();
        loadDashboard();
    } catch (e) { console.error(e); }
}

async function editEditingOrder(id) {
    try {
        const response = await apiFetch(`${API_URL}/orders`);
        const allOrders = await response.json();
        const order = allOrders.find(o => o.id === id && o.orderType === 'editing');
        if (!order) return;

        document.getElementById('e-edit-id').value = order.id;
        document.getElementById('e-name').value = order.customerName;
        document.getElementById('e-phone').value = order.phone || '';
        document.getElementById('e-title').value = order.title || '';
        document.getElementById('e-date').value = order.deliveryDate || '';
        document.getElementById('e-price').value = order.totalPrice;
        document.getElementById('e-advance').value = order.advancePaid || order.advance || 0;

        document.getElementById('editing-tasks-container').innerHTML = '';
        if (order.additionalServices && order.additionalServices.length > 0) {
            order.additionalServices.forEach(t => addEditingTaskRow(t.description, t.amount));
        }

        document.getElementById('e-note1').value = order.note1 || '';
        document.getElementById('e-note2').value = order.note2 || '';
        calculateEditingRemaining();

        document.getElementById('editing-form-title').innerHTML = '<span style="margin-right: 8px;">✏️</span> Edit Editing Order';
        document.querySelector('#editing-form button[type="submit"]').innerText = '💾 Update Order';

        showSection('editing');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { console.error(e); }
}

async function viewEditingOrder(id) {
    try {
        const response = await apiFetch(`${API_URL}/orders`);
        const allOrders = await response.json();
        const order = allOrders.find(o => o.id === id && o.orderType === 'editing');
        if (!order) return;

        document.getElementById('ve-order-id').innerText = order.id;
        document.getElementById('ve-name').innerText = order.customerName;
        document.getElementById('ve-phone').innerText = order.phone || 'N/A';
        document.getElementById('ve-title').innerText = order.title || 'N/A';
        document.getElementById('ve-date').innerText = order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString() : 'N/A';
        document.getElementById('ve-price').innerText = order.totalPrice;
        document.getElementById('ve-advance').innerText = order.advancePaid || order.advance || 0;
        document.getElementById('ve-balance').innerText = order.balance;
        document.getElementById('ve-status').innerHTML = order.status === 'Completed'
            ? '<span style="color:#50cd89; font-weight:bold;">Completed</span>'
            : `<span style="color:#f1416c; font-weight:bold;">${order.status || 'Pending'}</span>`;

        const servicesList = document.getElementById('ve-services-list');
        servicesList.innerHTML = '';
        if (order.additionalServices && order.additionalServices.length > 0) {
            let html = '<p><strong>Services:</strong></p><ul style="margin-top: 5px; padding-left: 20px;">';
            order.additionalServices.forEach(s => {
                html += `<li>${s.description}: LKR ${s.amount}</li>`;
            });
            html += '</ul>';
            servicesList.innerHTML = html;
        }

        document.getElementById('ve-note1').innerText = order.note1 || 'None';
        document.getElementById('ve-note2').innerText = order.note2 || 'None';

        let phone = order.phone ? order.phone.replace(/[\s-]/g, '') : '';
        const waLink = document.getElementById('ve-whatsapp');
        if (phone) {
            if (phone.startsWith('0')) phone = '+94' + phone.substring(1);
            else if (!phone.startsWith('+')) phone = '+94' + phone;
            waLink.href = `https://wa.me/${phone.replace('+', '')}`;
            waLink.style.display = 'inline-block';
        } else {
            waLink.style.display = 'none';
        }

        document.getElementById('view-editing-modal').classList.add('active');
    } catch (e) { console.error(e); }
}

function closeEditingViewModal() {
    document.getElementById('view-editing-modal').classList.remove('active');
}

async function printEditingReceipt(id) {
    try {
        const response = await apiFetch(`${API_URL}/orders`);
        const allOrders = await response.json();
        const order = allOrders.find(o => o.id === id && o.orderType === 'editing');
        if (!order) return;

        const receiptHTML = `
            <!DOCTYPE html><html lang="en"><head>
            <meta charset="UTF-8"><title>Receipt - Editing #${order.id}</title>
            <style>
                body { font-family: 'Courier New', monospace; margin: 0; padding: 20px; color: #000; }
                .receipt-container { max-width: 400px; margin: 0 auto; padding: 20px; border: 1px dashed #ccc; }
                h2 { text-align: center; font-size: 24px; }
                .shop-subtitle { text-align: center; font-size: 14px; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 20px; }
                .details-row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 14px; }
                .divider { border-bottom: 1px dashed #000; margin: 15px 0; }
                .total-row { font-weight: bold; font-size: 16px; border-top: 1px dashed #000; padding-top: 5px; }
                .footer-msg { text-align: center; margin-top: 20px; font-size: 13px; font-style: italic; }
            </style></head><body>
            <div class="receipt-container">
                <h2>Studio Gray Shades</h2>
                <div class="shop-subtitle">Photo Editing Receipt</div>
                <div class="details-row"><span><strong>Order ID:</strong> #${order.id}</span><span><strong>Date:</strong> ${new Date().toLocaleDateString()}</span></div>
                <div class="divider"></div>
                <div class="details-row"><span><strong>Customer:</strong></span><span>${order.customerName}</span></div>
                <div class="details-row"><span><strong>Phone:</strong></span><span>${order.phone || 'N/A'}</span></div>
                <div class="divider"></div>
                <div class="details-row"><span><strong>Title:</strong></span><span>${order.title || 'N/A'}</span></div>
                <div class="details-row"><span><strong>Delivery Date:</strong></span><span>${order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString() : 'N/A'}</span></div>
                <div class="divider"></div>
                
                <div style="margin-bottom: 10px;"><strong>Service Breakdown:</strong></div>
                <div style="font-size: 14px; margin-bottom: 10px;">
                    ${(order.additionalServices || []).map(s => `<div class="details-row"><span>${s.description}</span><span>LKR ${s.amount}</span></div>`).join('')}
                </div>
                
                <div class="divider"></div>
                <div class="details-row"><span>Total Price:</span><span>LKR ${order.totalPrice}</span></div>
                <div class="details-row"><span>Advance Paid:</span><span>LKR ${order.advancePaid || 0}</span></div>
                <div class="details-row total-row"><span>Remaining Balance:</span><span>LKR ${order.balance}</span></div>
                <div class="divider"></div>
                <div class="footer-msg">Thank you for choosing Studio Gray Shades!</div>
            </div></body></html>`;

        const printWindow = window.open('', '_blank', 'width=600,height=800');
        if (printWindow) {
            printWindow.document.open();
            printWindow.document.write(receiptHTML);
            printWindow.document.close();
            setTimeout(() => { printWindow.focus(); printWindow.print(); printWindow.onafterprint = () => printWindow.close(); }, 250);
        } else {
            alert('Popup blocked. Please allow popups to print receipts.');
        }
    } catch (e) { console.error('Error generating editing receipt:', e); }
}

// --- Expenditure Feature ---
const expenseForm = document.getElementById('expense-form');
if (expenseForm) {
    expenseForm.addEventListener('submit', handleExpenseSubmit);
}

async function handleExpenseSubmit(e) {
    e.preventDefault();

    const editId = document.getElementById('exp-edit-id') ? document.getElementById('exp-edit-id').value : '';
    const payload = {
        date: document.getElementById('exp-date').value,
        title: document.getElementById('exp-title').value.trim(),
        note: document.getElementById('exp-note').value.trim(),
        price: parseFloat(document.getElementById('exp-price').value) || 0
    };

    try {
        const method = editId ? 'PUT' : 'POST';
        const url = editId ? `${API_URL}/expenditures/${editId}` : `${API_URL}/expenditures`;
        const res = await apiFetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Failed to save expense');

        alert(editId ? 'Expense updated successfully!' : 'Expense saved successfully!');
        resetExpenseForm();

        await loadExpenditures();
        loadDashboard();
    } catch (error) {
        console.error('Error saving expense:', error);
        alert('Failed to save expense.');
    }
}

function resetExpenseForm() {
    const form = document.getElementById('expense-form');
    if (form) form.reset();
    const editEl = document.getElementById('exp-edit-id');
    if (editEl) editEl.value = '';
    const titleEl = document.getElementById('expense-form-title');
    if (titleEl) titleEl.innerHTML = '<span style="margin-right:8px;">➕</span> Add New Expense';
    const submitBtn = document.querySelector('#expense-form button[type="submit"]');
    if (submitBtn) submitBtn.innerText = 'Save Expense';
}

async function loadExpenditures() {
    try {
        const response = await apiFetch(`${API_URL}/expenditures`);
        const expenditures = await response.json();

        const tbody = document.getElementById('expense-history-table');
        if (!tbody) return;

        expenditureCache = Array.isArray(expenditures) ? expenditures : [];
        tbody.innerHTML = '';

        expenditureCache.forEach(exp => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${exp.date ? new Date(exp.date).toLocaleDateString() : 'N/A'}</td>
                <td style="font-weight: 600;">${exp.title || ''}</td>
                <td>${exp.note || '-'}</td>
                <td style="font-weight: bold; color: #ff4757;">LKR ${Number(exp.price || 0).toLocaleString()}</td>
                <td>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <button class="btn-small" style="background:#00b894; color:white; border:none;" onclick="viewExpense(${exp.id})">View</button>
                        <button class="btn-small btn-outline" onclick="editExpense(${exp.id})">Edit</button>
                        <button class="btn-small" style="background:#ff6b6b; color:white; border:none;" onclick="deleteExpense(${exp.id})">Delete</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Error loading expenditures:', error);
    }
}

function viewExpense(id) {
    const exp = expenditureCache.find(item => String(item.id) === String(id));
    if (!exp) return alert('Expense not found.');
    alert(
        `Expense Details\n\n` +
        `Date: ${exp.date ? new Date(exp.date).toLocaleDateString() : 'N/A'}\n` +
        `Description: ${exp.title || '-'}\n` +
        `Note: ${exp.note || '-'}\n` +
        `Amount: LKR ${Number(exp.price || 0).toLocaleString()}`
    );
}

function editExpense(id) {
    const exp = expenditureCache.find(item => String(item.id) === String(id));
    if (!exp) return alert('Expense not found.');

    const editEl = document.getElementById('exp-edit-id');
    if (editEl) editEl.value = exp.id;
    document.getElementById('exp-date').value = exp.date ? String(exp.date).slice(0, 10) : '';
    document.getElementById('exp-title').value = exp.title || '';
    document.getElementById('exp-note').value = exp.note || '';
    document.getElementById('exp-price').value = Number(exp.price || 0);

    const titleEl = document.getElementById('expense-form-title');
    if (titleEl) titleEl.innerHTML = '<span style="margin-right:8px;">✏️</span> Edit Expense';
    const submitBtn = document.querySelector('#expense-form button[type="submit"]');
    if (submitBtn) submitBtn.innerText = 'Update Expense';

    showSection('expenditure');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteExpense(id) {
    if (!confirm('Are you sure you want to delete this expense?')) return;

    try {
        const res = await apiFetch(`${API_URL}/expenditures/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('Failed to delete expense');
        await loadExpenditures();
        loadDashboard();
        alert('Expense deleted successfully!');
    } catch (error) {
        console.error('Error deleting expense:', error);
        alert('Failed to delete expense.');
    }
}

// Initialize app
window.onload = () => {
    loadDashboard();
    loadFramingOrders();
    loadShootBookings();
    loadEditingOrders();
    loadAllOrders('all');
    loadOrderStatusTab();
    loadNotes();
    loadExpenditures();
    loadBookings();
    loadUpcomingBookings();
    loadUnsettledOrders();
};



// --- Order Status Engine ---
async function loadOrderStatusTab() {
    try {
        const response = await apiFetch(`${API_URL}/orders`);
        const allOrders = await response.json();

        let pendingOrders = [];
        let completedOrders = [];

        allOrders.forEach(order => {
            if (order.status === 'Completed') {
                completedOrders.push(order);
            } else {
                pendingOrders.push(order);
            }
        });

        // Sort descending
        pendingOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        completedOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const renderRow = (order) => {
            const isShoot = order.orderType === 'shoot';
            const isEditing = order.orderType === 'editing';

            const statusBadge = order.status === 'Completed'
                ? `<span class="badge status-completed">Completed</span>`
                : `<span class="badge status-pending">${order.status || 'Pending'}</span>`;

            const typeBadge = isShoot
                ? `<span style="background:rgba(108,92,231,0.15);color:var(--primary-color);padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;">📸 Shoot</span>`
                : isEditing
                    ? `<span style="background:rgba(253,203,110,0.2);color:#e17055;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;">🎨 Editing</span>`
                    : `<span style="background:rgba(0,184,148,0.15);color:#00b894;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;">🖼️ Framing</span>`;

            const description = isShoot ? `${order.eventType || ''}`
                : isEditing ? `${order.title || ''}`
                    : (order.description || '');

            const dateDisplay = isShoot
                ? (order.date ? new Date(order.date).toLocaleDateString() : 'N/A')
                : (order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString() : 'N/A');

            const colorDot = order.colorLabel ? `<div class="color-dot ${order.colorLabel}" style="display:inline-block;margin-right:4px;"></div>` : '';

            const viewFn = isShoot ? `viewShootBooking(${order.id})` : isEditing ? `viewEditingOrder(${order.id})` : `viewFramingOrder(${order.id})`;
            const printFn = isShoot ? `printShootReceipt(${order.id})` : isEditing ? `printEditingReceipt(${order.id})` : `printOrderReceipt(${order.id})`;
            const editFn = isShoot ? `editShootBooking(${order.id})` : isEditing ? `editEditingOrder(${order.id})` : `editFramingOrder(${order.id})`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><small style="color:var(--text-muted);">${colorDot}#${order.id}</small></td>
                <td>${typeBadge}</td>
                <td style="font-weight:600;">${order.customerName}</td>
                <td>${description}</td>
                <td>${dateDisplay}</td>
                <td>${statusBadge}</td>
                <td>
                    <div style="display:flex;gap:5px;align-items:center;">
                        <button class="btn-small" style="background:#00b894;color:white;border:none;" onclick="${viewFn}">View</button>
                        <button class="btn-small" style="background:#4b6584;color:white;border:none;" onclick="${printFn}">Print</button>
                        <button class="btn-small btn-outline" onclick="${editFn}">Edit</button>
                    </div>
                </td>
            `;
            return tr;
        };

        const pendingTbody = document.getElementById('pending-orders-table');
        if (pendingTbody) {
            pendingTbody.innerHTML = '';
            pendingOrders.forEach(o => pendingTbody.appendChild(renderRow(o)));
        }

        const completedTbody = document.getElementById('completed-orders-table');
        if (completedTbody) {
            completedTbody.innerHTML = '';
            completedOrders.forEach(o => completedTbody.appendChild(renderRow(o)));
        }
    } catch (e) {
        console.error("Error loading order status tab:", e);
    }
}

// --- Quick Assign Color Label ---
async function quickAssignColor(id, color, event) {
    // Optimistic UI update
    const pickerContainer = event.target.parentElement;
    const isAlreadyActive = event.target.classList.contains('active');

    pickerContainer.querySelectorAll('.picker-dot').forEach(dot => dot.classList.remove('active'));

    const newColor = isAlreadyActive ? '' : color;

    if (!isAlreadyActive) {
        event.target.classList.add('active');
    }

    // Update the static color dot next to the Order ID in the current row
    const row = pickerContainer.closest('tr');
    if (row) {
        const orderIdDot = row.querySelector('.color-dot');
        if (orderIdDot) {
            orderIdDot.className = `color-dot ${newColor || 'none'}`;
        }
    }

    try {
        await apiFetch(`${API_URL}/framing/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({ colorLabel: newColor })
        });

        // Refresh counts and lists globally in realtime
        const currentFilterBtn = document.querySelector('.filter-btn.active');
        const filterId = currentFilterBtn ? currentFilterBtn.id.replace('filter-', '') : 'all';
        await loadAllOrders(filterId);
    } catch (e) {
        console.error("Error quick assigning color:", e);
        // Fallback UI refresh in case of failure
        loadFramingOrders();
    }
}

// --- Account settings (Supabase Auth) ---
const adminSettingsForm = document.getElementById('admin-settings-form');
if (adminSettingsForm) {
    adminSettingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const newEmail = document.getElementById('settings-new-email').value.trim();
        const newPassword = document.getElementById('settings-new-pass').value;

        if (!newEmail || !newPassword) {
            alert('New email and password cannot be blank.');
            return;
        }

        if (typeof Auth === 'undefined') {
            alert('Auth module not loaded.');
            return;
        }

        try {
            await Auth.refreshSessionIfNeeded();
            const supabase = Auth.getSupabaseClient();
            const { data, error } = await supabase.auth.updateUser({
                email: newEmail,
                password: newPassword
            });

            if (error) {
                alert('Failed: ' + error.message);
                return;
            }

            if (data.session) {
                Auth.saveSession(data.session);
            }

            alert('Account updated successfully. If your email changed, check your inbox to confirm it, then sign in again.');
            adminSettingsForm.reset();
            await Auth.signOut();
            window.location.href = 'login.html';
        } catch (error) {
            console.error('Error updating account:', error);
            alert('Error updating account: ' + (error.message || 'Unknown error'));
        }
    });
}

// --- Notes Feature Logic ---
document.getElementById('note-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const editId = document.getElementById('note-edit-id').value;
    const payload = {
        title: document.getElementById('note-title').value,
        description: document.getElementById('note-desc').value
    };

    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${API_URL}/notes/${editId}` : `${API_URL}/notes`;

    try {
        const res = await apiFetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            alert(editId ? 'Note Updated Successfully!' : 'Note Saved Successfully!');
            e.target.reset();
            document.getElementById('note-edit-id').value = '';
            document.getElementById('note-form-title').innerText = '➕ Add New Note';
            document.querySelector('#note-form button[type="submit"]').innerText = 'Save Note';
            loadNotes();
        }
    } catch (error) {
        console.error("Error saving note:", error);
    }
});

async function loadNotes() {
    try {
        const response = await apiFetch(`${API_URL}/notes`);
        const notes = await response.json();

        const container = document.getElementById('notes-container');
        if (!container) return;

        container.innerHTML = '';

        notes.sort((a, b) => new Date(b.date) - new Date(a.date)); // Newest first

        if (notes.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted);">No notes saved yet.</p>';
            return;
        }

        notes.forEach(note => {
            const dateObj = new Date(note.date);
            const dateStr = dateObj.toLocaleDateString() + ' at ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const card = document.createElement('div');
            card.style.cssText = 'background: white; border-radius: 12px; padding: 20px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); border-left: 4px solid var(--primary-color); display: flex; flex-direction: column; gap: 10px;';
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <h4 style="margin: 0; color: #1e1e2d; font-size: 1.1rem;">${note.title}</h4>
                    <span style="font-size: 0.8rem; color: var(--text-muted);">${dateStr}</span>
                </div>
                <p style="margin: 0; color: #5a5a6b; font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap;">${note.description}</p>
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
                    <button class="btn-outline btn-small" style="padding: 5px 15px;" onclick="editNote(${note.id})">Edit</button>
                    <button class="btn-small" style="background:#ff6b6b; color:white; border:none; padding: 5px 15px;" onclick="deleteNote(${note.id})">Delete</button>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (error) {
        console.error("Error loading notes:", error);
    }
}

async function editNote(id) {
    try {
        const response = await apiFetch(`${API_URL}/notes`);
        const notes = await response.json();
        const note = notes.find(n => n.id === id);
        if (!note) return;

        document.getElementById('note-edit-id').value = note.id;
        document.getElementById('note-title').value = note.title;
        document.getElementById('note-desc').value = note.description;

        document.getElementById('note-form-title').innerText = '✏️ Edit Note';
        document.querySelector('#note-form button[type="submit"]').innerText = '💾 Update Note';

        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        console.error("Error fetching note for edit:", error);
    }
}

async function deleteNote(id) {
    if (!confirm('Are you sure you want to delete this note?')) return;
    try {
        const res = await apiFetch(`${API_URL}/notes/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            loadNotes();
        }
    } catch (error) {
        console.error("Error deleting note:", error);
    }
}

// --- Local Booking Logic (Standalone) ---

function addBookingServiceRow(name = '', price = '') {
    const container = document.getElementById('booking-services-container');
    const row = document.createElement('div');
    row.className = 'service-row';
    row.innerHTML = `
        <input type="text" placeholder="Service Name (e.g. Extra Album)" class="dynamic-booking-name" value="${name}" style="font-family: 'Outfit', sans-serif;">
        <input type="number" placeholder="Price (LKR)" class="dynamic-booking-price service-price" value="${price}" style="font-family: 'Outfit', sans-serif;">
        <button type="button" class="btn-remove" onclick="this.parentElement.remove()" style="font-family: 'Outfit', sans-serif;">X</button>
    `;
    container.appendChild(row);
}

document.getElementById('booking-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const additionalServices = [];
    let totalPrice = 0;
    const serviceRows = document.querySelectorAll('#booking-services-container .service-row');
    serviceRows.forEach(row => {
        const name = row.querySelector('.dynamic-booking-name').value;
        const price = parseFloat(row.querySelector('.dynamic-booking-price').value) || 0;
        if (name || price > 0) {
            additionalServices.push({ name, price });
            totalPrice += price;
        }
    });

    const editId = document.getElementById('bk-edit-id').value;
    const payload = {
        customerName: document.getElementById('bk-name').value,
        phone: document.getElementById('bk-phone').value,
        eventTitle: document.getElementById('bk-event').value,
        date: document.getElementById('bk-date').value,
        additionalServices: additionalServices,
        totalPrice: totalPrice
    };

    try {
        const method = editId ? 'PUT' : 'POST';
        const url = editId ? `${API_URL}/bookings/${editId}` : `${API_URL}/bookings`;
        const res = await apiFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) throw new Error('Failed to save booking');
        
        alert(editId ? 'Booking Updated Successfully!' : 'Booking Saved Successfully!');

        e.target.reset();
        document.getElementById('booking-services-container').innerHTML = '';
        document.getElementById('bk-edit-id').value = '';
        document.getElementById('booking-form-title').innerHTML = '<span style="margin-right: 8px;">➕</span> Add New Booking';
        document.querySelector('#booking-form button[type="submit"]').innerText = 'Save Booking';
        
        loadBookings();
        loadUpcomingBookings();
    } catch (err) {
        console.error(err);
        alert('Error saving booking.');
    }
});

async function loadBookings() {
    const tbody = document.getElementById('bookings-table');
    if (!tbody) return;

    try {
        const res = await apiFetch(`${API_URL}/bookings`);
        const bookings = await res.json();
        
        renderTableWithMonthGroups(
            tbody,
            bookings,
            6,
            (booking) => {
                const bookingDate = booking.date ? new Date(booking.date).toLocaleDateString() : 'N/A';
                return `
                <td>#${booking.id.slice(-6)}</td>
                <td style="font-weight: 600;">${booking.customerName}</td>
                <td>${booking.eventTitle}</td>
                <td>${bookingDate}</td>
                <td>LKR ${booking.totalPrice}</td>
                <td>
                    <div style="display:flex; gap:5px; align-items:center;">
                        <button class="btn-small" style="background:#00b894; color:white; border:none; font-family: 'Outfit', sans-serif;" onclick="viewBooking('${booking.id}')">View</button>
                        <button class="btn-small btn-outline" style="font-family: 'Outfit', sans-serif;" onclick="editBooking('${booking.id}')">Edit</button>
                        <button class="btn-small" style="background:#ff6b6b; color:white; border:none; font-family: 'Outfit', sans-serif;" onclick="deleteBooking('${booking.id}')">Delete</button>
                    </div>
                </td>
            `;
            },
            (booking) => getOrderHistoryDate({ createdAt: booking.createdAt, date: booking.date })
        );
    } catch (err) {
        console.error("Error loading bookings:", err);
    }
}

async function deleteBooking(id) {
    if (!confirm('Are you sure you want to delete this booking?')) return;
    try {
        const res = await apiFetch(`${API_URL}/bookings/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error('Failed to delete');
        loadBookings();
        loadUpcomingBookings();
    } catch (err) {
        console.error(err);
    }
}

async function viewBooking(id) {
    try {
        const res = await apiFetch(`${API_URL}/bookings`);
        const bookings = await res.json();
        const booking = bookings.find(b => b.id === id);
        if (!booking) return;

        document.getElementById('vb-order-id').innerText = booking.id.slice(-6);
        document.getElementById('vb-name').innerText = booking.customerName;
        document.getElementById('vb-phone').innerText = booking.phone || 'N/A';
        document.getElementById('vb-event').innerText = booking.eventTitle;
        document.getElementById('vb-date').innerText = new Date(booking.date).toLocaleDateString();
        document.getElementById('vb-price').innerText = booking.totalPrice;

        const servicesList = document.getElementById('vb-services-list');
        let servicesHTML = '<p><strong>Services:</strong></p><ul style="margin-top: 5px; padding-left: 20px;">';
        if (booking.additionalServices && booking.additionalServices.length > 0) {
            booking.additionalServices.forEach(service => {
                servicesHTML += `<li>${service.name || ''}: LKR ${service.price || 0}</li>`;
            });
        } else {
            servicesHTML += `<li>No additional services</li>`;
        }
        servicesHTML += '</ul>';
        servicesList.innerHTML = servicesHTML;

        let phone = booking.phone ? booking.phone.replace(/[\s-]/g, '') : '';
        const waLink = document.getElementById('vb-whatsapp');
        if (phone) {
            if (phone.startsWith('0')) phone = '+94' + phone.substring(1);
            else if (!phone.startsWith('+')) phone = '+94' + phone;
            waLink.href = `https://wa.me/${phone.replace('+', '')}`;
            waLink.style.display = 'inline-block';
        } else {
            waLink.style.display = 'none';
        }

        document.getElementById('view-booking-modal').classList.add('active');
    } catch (err) {
        console.error(err);
    }
}

function closeBookingViewModal() {
    document.getElementById('view-booking-modal').classList.remove('active');
}

async function editBooking(id) {
    try {
        const res = await apiFetch(`${API_URL}/bookings`);
        const bookings = await res.json();
        const booking = bookings.find(b => b.id === id);
        if (!booking) return;

        document.getElementById('bk-edit-id').value = booking.id;
        document.getElementById('bk-name').value = booking.customerName;
        document.getElementById('bk-phone').value = booking.phone || '';
        document.getElementById('bk-event').value = booking.eventTitle;
        document.getElementById('bk-date').value = booking.date;

        document.getElementById('booking-services-container').innerHTML = '';
        if (booking.additionalServices && booking.additionalServices.length > 0) {
            booking.additionalServices.forEach(s => addBookingServiceRow(s.name, s.price));
        }

        document.getElementById('booking-form-title').innerHTML = '<span style="margin-right: 8px;">✏️</span> Edit Booking';
        document.querySelector('#booking-form button[type="submit"]').innerText = '💾 Update Booking';

        showSection('booking');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
        console.error(err);
    }
}

async function loadUpcomingBookings() {
    const tbody = document.getElementById('upcoming-bookings-table');
    if (!tbody) return;

    try {
        const res = await apiFetch(`${API_URL}/bookings/upcoming`);
        const upcoming = await res.json();
        
        tbody.innerHTML = '';
        if (upcoming.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding: 20px;">No upcoming bookings found.</td></tr>';
            return;
        }

        upcoming.forEach(booking => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span style="background:rgba(108,92,231,0.1); color:var(--primary-color); padding:4px 8px; border-radius:6px; font-weight:600;">${new Date(booking.date).toLocaleDateString()}</span></td>
                <td style="font-weight: 600;">${booking.customerName}</td>
                <td>${booking.eventTitle}</td>
                <td>${booking.phone || 'N/A'}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Error loading upcoming bookings:", err);
    }
}

// --- Unsettled Orders ---

function calculateUoTotal() {
    let total = 0;
    document.querySelectorAll('#uo-services-container .dynamic-uo-amount').forEach(input => {
        total += parseFloat(input.value) || 0;
    });
    calculateUoRemaining(total);
}

function calculateUoRemaining(total = null) {
    if (total === null) {
        total = 0;
        document.querySelectorAll('#uo-services-container .dynamic-uo-amount').forEach(input => {
            total += parseFloat(input.value) || 0;
        });
    }
    const advance = parseFloat(document.getElementById('uo-advance').value) || 0;
    document.getElementById('uo-balance').value = (total - advance).toFixed(2);
}

function addUoServiceRow(description = '', price = '') {
    const container = document.getElementById('uo-services-container');
    const row = document.createElement('div');
    row.className = 'service-row';
    row.innerHTML = `
        <input type="text" placeholder="Description" class="dynamic-uo-desc" value="${description}">
        <input type="number" placeholder="Amount (LKR)" class="dynamic-uo-amount service-price" value="${price}" oninput="calculateUoTotal()">
        <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calculateUoTotal()">X</button>
    `;
    container.appendChild(row);
    calculateUoTotal();
}

async function loadUnsettledOrders() {
    try {
        const response = await apiFetch(`${API_URL}/unsettled-orders`);
        const orders = await response.json();

        const tbody = document.getElementById('unsettled-orders-table');
        if (!tbody) return;

        renderTableWithMonthGroups(tbody, orders, 8, (order) => {
            const orderDate = order.date ? new Date(order.date).toLocaleDateString() : 'N/A';
            return `
                <td>#${order.id}</td>
                <td style="font-weight: 600;">${order.customerName}</td>
                <td>${order.title}</td>
                <td>${orderDate}</td>
                <td>LKR ${order.totalPrice}</td>
                <td>LKR ${order.advancePaid}</td>
                <td style="color:var(--danger); font-weight:bold;">LKR ${order.balance}</td>
                <td>
                    <div style="display:flex; gap:5px; align-items:center;">
                        <button class="btn-small" style="background:#00b894; color:white; border:none;" onclick="viewUnsettledOrder(${order.id})">View</button>
                        <button class="btn-small btn-outline" onclick="editUnsettledOrder(${order.id})">Edit</button>
                        <button class="btn-small" style="background:#ff6b6b; color:white; border:none;" onclick="deleteUnsettledOrder(${order.id})">Delete</button>
                    </div>
                </td>
            `;
        });
    } catch (error) {
        console.error("Error loading unsettled orders:", error);
    }
}

document.getElementById('unsettled-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const additionalServices = [];
    const taskRows = document.querySelectorAll('#uo-services-container .service-row');
    taskRows.forEach(row => {
        const description = row.querySelector('.dynamic-uo-desc').value;
        const price = parseFloat(row.querySelector('.dynamic-uo-amount').value) || 0;
        if (description || price > 0) {
            additionalServices.push({ description, price });
        }
    });

    const payload = {
        customerName: document.getElementById('uo-name').value,
        date: document.getElementById('uo-date').value,
        phone: document.getElementById('uo-phone').value,
        title: document.getElementById('uo-title').value,
        advance: document.getElementById('uo-advance').value,
        additionalServices: additionalServices
    };

    const editId = document.getElementById('uo-edit-id').value;
    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${API_URL}/unsettled-orders/${editId}` : `${API_URL}/unsettled-orders`;

    try {
        const res = await apiFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) throw new Error('Failed to save unsettled order');
        
        alert(editId ? 'Unsettled Order Updated Successfully!' : 'Unsettled Order Saved Successfully!');
        e.target.reset();
        document.getElementById('uo-services-container').innerHTML = '';

        document.getElementById('uo-edit-id').value = '';
        document.getElementById('unsettled-form-title').innerHTML = '<span style="margin-right: 8px;">➕</span> Add New Unsettled Order';
        document.querySelector('#unsettled-form button[type="submit"]').innerText = 'Save Unsettled Order';
        document.getElementById('uo-balance').value = '';

        loadUnsettledOrders();
    } catch (error) {
        console.error("Error saving unsettled order:", error);
    }
});

async function viewUnsettledOrder(id) {
    try {
        const res = await apiFetch(`${API_URL}/unsettled-orders`);
        const orders = await res.json();
        const order = orders.find(o => o.id === id);
        if (!order) return;

        document.getElementById('vuo-order-id').innerText = order.id;
        document.getElementById('vuo-name').innerText = order.customerName;
        document.getElementById('vuo-phone').innerText = order.phone || 'N/A';
        document.getElementById('vuo-title').innerText = order.title;
        document.getElementById('vuo-date').innerText = new Date(order.date).toLocaleDateString();
        document.getElementById('vuo-price').innerText = order.totalPrice;
        document.getElementById('vuo-advance').innerText = order.advancePaid;
        document.getElementById('vuo-balance').innerText = order.balance;

        const servicesList = document.getElementById('vuo-services-list');
        let servicesHTML = '<p><strong>Items/Services:</strong></p><ul style="margin-top: 5px; padding-left: 20px;">';
        if (order.additionalServices && order.additionalServices.length > 0) {
            order.additionalServices.forEach(service => {
                servicesHTML += `<li>${service.description}: LKR ${service.price}</li>`;
            });
        }
        servicesHTML += '</ul>';
        servicesList.innerHTML = servicesHTML;

        let phone = order.phone ? order.phone.replace(/[\s-]/g, '') : '';
        const waLink = document.getElementById('vuo-whatsapp');
        if (phone) {
            if (phone.startsWith('0')) phone = '+94' + phone.substring(1);
            else if (!phone.startsWith('+')) phone = '+94' + phone;
            waLink.href = `https://wa.me/${phone.replace('+', '')}`;
            waLink.style.display = 'inline-block';
        } else {
            waLink.style.display = 'none';
        }

        document.getElementById('view-unsettled-modal').classList.add('active');
    } catch (err) {
        console.error(err);
    }
}

function closeUnsettledViewModal() {
    document.getElementById('view-unsettled-modal').classList.remove('active');
}

async function editUnsettledOrder(id) {
    try {
        const res = await apiFetch(`${API_URL}/unsettled-orders`);
        const orders = await res.json();
        const order = orders.find(o => o.id === id);
        if (!order) return;

        document.getElementById('uo-edit-id').value = order.id;
        document.getElementById('uo-name').value = order.customerName;
        document.getElementById('uo-phone').value = order.phone || '';
        document.getElementById('uo-title').value = order.title;
        document.getElementById('uo-date').value = order.date;
        document.getElementById('uo-advance').value = order.advancePaid;

        document.getElementById('uo-services-container').innerHTML = '';
        if (order.additionalServices && order.additionalServices.length > 0) {
            order.additionalServices.forEach(s => addUoServiceRow(s.description, s.price));
        }

        calculateUoTotal();

        document.getElementById('unsettled-form-title').innerHTML = '<span style="margin-right: 8px;">✏️</span> Edit Unsettled Order';
        document.querySelector('#unsettled-form button[type="submit"]').innerText = '💾 Update Order';

        showSection('unsettled-orders');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
        console.error(err);
    }
}

async function deleteUnsettledOrder(id) {
    if (!confirm('Are you sure you want to delete this order?')) return;
    try {
        await apiFetch(`${API_URL}/unsettled-orders/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        loadUnsettledOrders();
    } catch (e) { console.error(e); }
}
