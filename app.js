// ==================== ХРАНИЛИЩЕ ====================
const Storage = {
    dbName: 'SalonCRM',
    db: null,
    
    async init() {
        return new Promise((resolve) => {
            const request = indexedDB.open(this.dbName, 3);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('clients')) {
                    db.createObjectStore('clients', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('services')) {
                    db.createObjectStore('services', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('visits')) {
                    db.createObjectStore('visits', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('visitServices')) {
                    db.createObjectStore('visitServices', { keyPath: 'id', autoIncrement: true });
                }
                
                const tx = e.target.transaction;
                const serviceStore = tx.objectStore('services');
                serviceStore.count().onsuccess = (ev) => {
                    if (ev.target.result === 0) {
                        serviceStore.add({ name: 'Стрижка', price: 1500, duration: 60 });
                        serviceStore.add({ name: 'Окрашивание', price: 3500, duration: 120 });
                        serviceStore.add({ name: 'Маникюр', price: 1200, duration: 60 });
                        serviceStore.add({ name: 'Педикюр', price: 1800, duration: 90 });
                    }
                };
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            request.onerror = () => {
                console.error('Ошибка открытия БД');
                resolve();
            };
        });
    },
    
    async getAll(store) {
        if (!this.db) return [];
        return new Promise((resolve) => {
            const tx = this.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    },
    
    async add(store, data) {
        return new Promise((resolve) => {
            const tx = this.db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).add(data);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    },
    
    async update(store, data) {
        return new Promise((resolve) => {
            const tx = this.db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).put(data);
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        });
    },
    
    async delete(store, id) {
        return new Promise((resolve) => {
            const tx = this.db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).delete(id);
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        });
    }
};

// ==================== ПРИЛОЖЕНИЕ ====================
let currentUser = null;
let clients = [];
let services = [];
let visits = [];
let visitServices = [];
let editingClientId = null;
let editingServiceId = null;
let dateFilter = '';

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function updateStatus(msg, isError = false) {
    const el = document.getElementById('statusMessage');
    el.innerHTML = (isError ? '❌ ' : '✅ ') + msg;
    setTimeout(() => {
        if (document.getElementById('statusMessage').innerHTML.includes(msg)) {
            document.getElementById('statusMessage').innerHTML = '✅ Готово';
        }
    }, 3000);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

async function loadData() {
    clients = await Storage.getAll('clients');
    services = await Storage.getAll('services');
    visits = await Storage.getAll('visits');
    visitServices = await Storage.getAll('visitServices');
    console.log('Загружено клиентов:', clients.length);
}

async function refresh() {
    await loadData();
    renderClients();
    renderVisits();
    renderServices();
    if (currentUser === 'owner') renderFinance();
}

// ===== ФУНКЦИЯ РЕДАКТИРОВАНИЯ КЛИЕНТА =====
window.editClient = async function(id) {
    console.log('editClient вызван с ID:', id);
    const client = clients.find(c => c.id === id);
    if (!client) {
        updateStatus('Клиент не найден', true);
        return;
    }
    
    editingClientId = client.id;
    document.getElementById('clientModalTitle').innerText = '✏️ Редактировать клиента';
    document.getElementById('clientFullName').value = client.fullName || '';
    document.getElementById('clientPhone').value = client.phone || '';
    document.getElementById('clientEmail').value = client.email || '';
    document.getElementById('clientDiscount').value = client.discount || 0;
    document.getElementById('clientModal').style.display = 'flex';
};

// ===== РЕНДЕР КЛИЕНТОВ =====
function renderClients() {
    const tbody = document.getElementById('clientsTableBody');
    const search = document.getElementById('searchInput').value.toLowerCase();
    let filtered = clients.filter(c => 
        (c.fullName && c.fullName.toLowerCase().includes(search)) || 
        (c.phone && c.phone.includes(search))
    );
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Нет клиентов. Нажмите "Добавить клиента"</td></tr>';
        return;
    }
    
    tbody.innerHTML = filtered.map(c => `
        <tr>
            <td>${c.id}</td>
            <td><strong>${escapeHtml(c.fullName)}</strong></td>
            <td>${escapeHtml(c.phone)}</td>
            <td>${escapeHtml(c.email) || '—'}</td>
            <td>${c.discount || 0}%</td>
            <td class="action-buttons">
                <button class="btn btn-primary btn-sm" onclick="editClient(${c.id})" style="background:#3498db; margin-right:5px;">✏️</button>
                <button class="btn btn-danger btn-sm" onclick="deleteClient(${c.id})">🗑️</button>
            </td>
        </tr>
    `).join('');
}

// ===== СОХРАНЕНИЕ КЛИЕНТА (добавление и редактирование) =====
window.saveClient = async function() {
    const fullName = document.getElementById('clientFullName').value.trim();
    const phone = document.getElementById('clientPhone').value.trim();
    const email = document.getElementById('clientEmail').value.trim();
    const discount = parseInt(document.getElementById('clientDiscount').value) || 0;
    
    if (!fullName || !phone) {
        updateStatus('Заполните ФИО и телефон', true);
        return;
    }
    
    if (editingClientId) {
        await Storage.update('clients', { 
            id: editingClientId, 
            fullName, 
            phone, 
            email, 
            discount 
        });
        updateStatus('Клиент обновлён');
        editingClientId = null;
    } else {
        await Storage.add('clients', { fullName, phone, email, discount });
        updateStatus('Клиент добавлен');
    }
    
    closeModal('clientModal');
    await refresh();
    
    document.getElementById('clientFullName').value = '';
    document.getElementById('clientPhone').value = '';
    document.getElementById('clientEmail').value = '';
    document.getElementById('clientDiscount').value = '0';
};

function renderServices() {
    const tbody = document.getElementById('servicesTableBody');
    if (services.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Нет услуг. Нажмите "Добавить услугу"</td></tr>';
        return;
    }
    tbody.innerHTML = services.map(s => `
        <tr>
            <td>${s.id}</td>
            <td>${escapeHtml(s.name)}</td>
            <td>${s.price.toLocaleString()} ₽</td>
            <td>${s.duration || 60} мин</td>
            <td class="action-buttons">
                <button class="btn btn-danger btn-sm" onclick="deleteService(${s.id})">🗑️</button>
            </td>
        </tr>
    `).join('');
}

async function renderVisits() {
    let filteredVisits = [...visits];
    if (dateFilter) {
        filteredVisits = filteredVisits.filter(v => v.date === dateFilter);
    }
    
    const visitsWithData = [];
    for (let visit of filteredVisits) {
        const client = clients.find(c => c.id === visit.clientId);
        const servicesList = visitServices.filter(vs => vs.visitId === visit.id);
        const serviceNames = servicesList.map(vs => {
            const s = services.find(srv => srv.id === vs.serviceId);
            return s ? s.name : '—';
        });
        visitsWithData.push({
            ...visit,
            clientName: client ? client.fullName : 'Неизвестен',
            services: serviceNames.join(', ')
        });
    }
    
    visitsWithData.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    
    const tbody = document.getElementById('visitsTableBody');
    if (visitsWithData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Нет визитов. Нажмите "Добавить визит"</td></tr>';
        return;
    }
    
    tbody.innerHTML = visitsWithData.map(v => `
        <tr>
            <td>${v.id}</td>
            <td><strong>${escapeHtml(v.clientName)}</strong></td>
            <td>${v.date || '—'}</td>
            <td>${escapeHtml(v.services) || '—'}</td>
            <td>${(v.total || 0).toLocaleString()} ₽</td>
            <td>${v.paymentStatus || 'Оплачено'}</td>
            <td class="action-buttons">
                <button class="btn btn-danger btn-sm" onclick="deleteVisit(${v.id})">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function renderFinance() {
    const totalRevenue = visits.reduce((s, v) => s + (v.total || 0), 0);
    const totalVisitsCount = visits.length;
    const avgCheck = totalVisitsCount > 0 ? totalRevenue / totalVisitsCount : 0;
    
    document.getElementById('financeStats').innerHTML = `
        <div style="background: linear-gradient(135deg,#2c3e50,#1a1a2e); color: white; padding: 15px; border-radius: 12px; min-width: 150px;">
            <h4>📊 Общая выручка</h4>
            <div style="font-size: 24px; font-weight: bold;">${totalRevenue.toLocaleString()} ₽</div>
        </div>
        <div style="background: linear-gradient(135deg,#2c3e50,#1a1a2e); color: white; padding: 15px; border-radius: 12px; min-width: 150px;">
            <h4>📅 Всего визитов</h4>
            <div style="font-size: 24px; font-weight: bold;">${totalVisitsCount}</div>
        </div>
        <div style="background: linear-gradient(135deg,#2c3e50,#1a1a2e); color: white; padding: 15px; border-radius: 12px; min-width: 150px;">
            <h4>💰 Средний чек</h4>
            <div style="font-size: 24px; font-weight: bold;">${Math.round(avgCheck).toLocaleString()} ₽</div>
        </div>
    `;
    
    document.getElementById('financeTableBody').innerHTML = `
        <tr><td>Общая выручка</td><td>${totalRevenue.toLocaleString()} ₽</td></tr>
        <tr><td>Всего визитов</td><td>${totalVisitsCount}</td></tr>
        <tr><td>Средний чек</td><td>${Math.round(avgCheck).toLocaleString()} ₽</td></tr>
    `;
}

window.openAddClient = function() {
    editingClientId = null;
    document.getElementById('clientModalTitle').innerText = '➕ Добавить клиента';
    document.getElementById('clientFullName').value = '';
    document.getElementById('clientPhone').value = '';
    document.getElementById('clientEmail').value = '';
    document.getElementById('clientDiscount').value = '0';
    document.getElementById('clientModal').style.display = 'flex';
};

window.deleteClient = async function(id) {
    if (confirm('Вы уверены, что хотите удалить клиента?')) {
        await Storage.delete('clients', id);
        updateStatus('Клиент удалён');
        await refresh();
    }
};

window.openAddService = function() {
    editingServiceId = null;
    document.getElementById('serviceModalTitle').innerText = '➕ Добавить услугу';
    document.getElementById('serviceName').value = '';
    document.getElementById('servicePrice').value = '';
    document.getElementById('serviceDuration').value = '60';
    document.getElementById('serviceModal').style.display = 'flex';
};

window.saveService = async function() {
    const name = document.getElementById('serviceName').value.trim();
    const price = parseFloat(document.getElementById('servicePrice').value);
    const duration = parseInt(document.getElementById('serviceDuration').value) || 60;
    
    if (!name || isNaN(price)) {
        updateStatus('Заполните название и цену', true);
        return;
    }
    
    if (editingServiceId) {
        await Storage.update('services', { id: editingServiceId, name, price, duration });
        updateStatus('Услуга обновлена');
        editingServiceId = null;
    } else {
        await Storage.add('services', { name, price, duration });
        updateStatus('Услуга добавлена');
    }
    
    closeModal('serviceModal');
    await refresh();
};

window.deleteService = async function(id) {
    if (confirm('Удалить услугу?')) {
        await Storage.delete('services', id);
        updateStatus('Услуга удалена');
        await refresh();
    }
};

function calcVisitTotal() {
    let total = 0;
    document.querySelectorAll('#servicesChecklist input:checked').forEach(cb => {
        total += parseFloat(cb.dataset.price);
    });
    document.getElementById('visitTotalAmount').innerHTML = total.toLocaleString() + ' ₽';
}

window.openAddVisit = async function() {
    const clientSelect = document.getElementById('visitClientId');
    clientSelect.innerHTML = '<option value="">-- Выберите клиента --</option>' + 
        clients.map(c => `<option value="${c.id}">${escapeHtml(c.fullName)} (${c.phone})</option>`).join('');
    
    const checklist = document.getElementById('servicesChecklist');
    checklist.innerHTML = services.map(s => `
        <div style="display: flex; justify-content: space-between; padding: 8px; border-bottom: 1px solid #eee;">
            <label><input type="checkbox" data-service-id="${s.id}" data-price="${s.price}"> ${escapeHtml(s.name)}</label>
            <span>${s.price.toLocaleString()} ₽</span>
        </div>
    `).join('');
    
    checklist.querySelectorAll('input').forEach(cb => {
        cb.onchange = calcVisitTotal;
    });
    
    document.getElementById('visitDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('visitModal').style.display = 'flex';
    calcVisitTotal();
};

window.saveVisit = async function() {
    const clientId = parseInt(document.getElementById('visitClientId').value);
    const date = document.getElementById('visitDate').value;
    const paymentStatus = document.getElementById('visitPaymentStatus').value;
    const selectedServices = Array.from(document.querySelectorAll('#servicesChecklist input:checked')).map(cb => ({
        serviceId: parseInt(cb.dataset.serviceId),
        price: parseFloat(cb.dataset.price)
    }));
    
    if (!clientId || selectedServices.length === 0) {
        updateStatus('Выберите клиента и хотя бы одну услугу', true);
        return;
    }
    
    const total = selectedServices.reduce((s, item) => s + item.price, 0);
    const visitId = await Storage.add('visits', { clientId, date, total, paymentStatus });
    
    for (let item of selectedServices) {
        await Storage.add('visitServices', { visitId, serviceId: item.serviceId, price: item.price });
    }
    
    closeModal('visitModal');
    await refresh();
    updateStatus('Визит добавлен');
};

window.deleteVisit = async function(id) {
    if (confirm('Удалить визит?')) {
        await Storage.delete('visits', id);
        updateStatus('Визит удалён');
        await refresh();
    }
};

window.openReport = async function() {
    const report = [];
    for (let client of clients) {
        const clientVisits = visits.filter(v => v.clientId === client.id);
        const count = clientVisits.length;
        const total = clientVisits.reduce((s, v) => s + (v.total || 0), 0);
        if (count > 0) {
            report.push({ clientName: client.fullName, count, total, avg: total / count });
        }
    }
    report.sort((a, b) => b.count - a.count);
    
    const tbody = document.getElementById('reportTableBody');
    if (report.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-row">Нет данных</td></tr>';
    } else {
        tbody.innerHTML = report.map(r => `
            <tr>
                <td><strong>${escapeHtml(r.clientName)}</strong></td>
                <td>${r.count}</td>
                <td>${r.total.toLocaleString()} ₽</td>
                <td>${Math.round(r.avg).toLocaleString()} ₽</td>
            </tr>
        `).join('');
    }
    document.getElementById('reportModal').style.display = 'flex';
};

function login() {
    const role = document.getElementById('roleSelect').value;
    const pass = document.getElementById('passwordInput').value;
    
    if (pass === '123') {
        currentUser = role;
        document.getElementById('authPanel').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        
        const roles = { admin: '👑 Администратор', master: '✂️ Мастер', owner: '📊 Владелец' };
        document.getElementById('userRoleDisplay').innerHTML = roles[role];
        
        const isOwner = role === 'owner';
        const ownerTab = document.querySelector('.owner-tab');
        if (ownerTab) ownerTab.style.display = isOwner ? 'inline-block' : 'none';
        
        if (role === 'owner') renderFinance();
        updateStatus('Вход выполнен');
    } else {
        alert('Неверный пароль! Пароль: 123');
    }
}

function logout() {
    currentUser = null;
    document.getElementById('authPanel').style.display = 'block';
    document.getElementById('mainApp').style.display = 'none';
}

async function init() {
    await Storage.init();
    await loadData();
    
    document.getElementById('loginBtn').onclick = login;
    document.getElementById('logoutBtn').onclick = logout;
    document.getElementById('addClientBtn').onclick = openAddClient;
    document.getElementById('addVisitBtn').onclick = openAddVisit;
    document.getElementById('addServiceBtn').onclick = openAddService;
    document.getElementById('reportBtn').onclick = openReport;
    document.getElementById('refreshBtn').onclick = refresh;
    document.getElementById('saveClientBtn').onclick = saveClient;
    document.getElementById('saveServiceBtn').onclick = saveService;
    document.getElementById('saveVisitBtn').onclick = saveVisit;
    
    document.getElementById('clearSearchBtn').onclick = () => {
        document.getElementById('searchInput').value = '';
        renderClients();
    };
    document.getElementById('clearFilterBtn').onclick = () => {
        document.getElementById('filterDate').value = '';
        dateFilter = '';
        renderVisits();
    };
    document.getElementById('filterDate').onchange = (e) => {
        dateFilter = e.target.value;
        renderVisits();
    };
    document.getElementById('searchInput').oninput = renderClients;
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab + 'Tab').classList.add('active');
            if (btn.dataset.tab === 'finance' && currentUser === 'owner') renderFinance();
        };
    });
    
    renderClients();
    renderVisits();
    renderServices();
    updateStatus('Приложение готово');
}

init();
