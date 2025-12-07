// Навигация по страницам
function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const pages = document.querySelectorAll('.page');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            const pageName = link.getAttribute('data-page');
            
            // Обновляем активные классы
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            pages.forEach(page => page.classList.remove('active'));
            document.getElementById(`${pageName}-page`).classList.add('active');
            
            // Загружаем данные для страницы
            if (pageName === 'my-tickets') {
                loadMyTickets();
            } else if (pageName === 'admin') {
                loadAdminTickets();
            }
        });
    });
}

// Загрузка моих заявок
async function loadMyTickets() {
    try {
        const response = await fetch('/api/tickets/my');
        if (response.ok) {
            const tickets = await response.json();
            displayTickets(tickets, 'ticketsList');
        }
    } catch (error) {
        console.error('Error loading tickets:', error);
        document.getElementById('ticketsList').innerHTML = 
            '<p class="error">Ошибка загрузки заявок</p>';
    }
}

// Загрузка всех заявок для админа
async function loadAdminTickets() {
    try {
        const response = await fetch('/api/admin/tickets');
        if (response.ok) {
            const tickets = await response.json();
            displayAdminTickets(tickets);
        }
    } catch (error) {
        console.error('Error loading admin tickets:', error);
        document.getElementById('adminTickets').innerHTML = 
            '<p class="error">Ошибка загрузки заявок</p>';
    }
}

// Отображение заявок
function displayTickets(tickets, containerId) {
    const container = document.getElementById(containerId);
    
    if (!tickets || tickets.length === 0) {
        container.innerHTML = '<p>Заявок пока нет</p>';
        return;
    }
    
    container.innerHTML = tickets.map(ticket => `
        <div class="ticket">
            <div class="ticket-header">
                <span class="ticket-id">#${ticket.id}</span>
                <span class="ticket-status status-${getStatusClass(ticket.status)}">
                    ${ticket.status}
                </span>
                <span class="ticket-date">${new Date(ticket.created_at).toLocaleDateString()}</span>
            </div>
            <div class="ticket-details">
                <div><strong>Тип проблемы:</strong> ${ticket.problem_type_name}</div>
                <div><strong>Кабинет:</strong> ${ticket.cabinet}</div>
                <div><strong>Описание:</strong> ${ticket.description}</div>
                ${ticket.comments ? `<div><strong>Комментарии:</strong> ${ticket.comments}</div>` : ''}
                ${ticket.main_executor ? `<div><strong>Исполнитель:</strong> ${ticket.main_executor}</div>` : ''}
            </div>
        </div>
    `).join('');
}

// Отображение заявок для админа с возможностью управления
function displayAdminTickets(tickets) {
    const container = document.getElementById('adminTickets');
    
    if (!tickets || tickets.length === 0) {
        container.innerHTML = '<p>Заявок пока нет</p>';
        return;
    }
    
    container.innerHTML = `
        <table class="tickets-table">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Дата</th>
                    <th>Пользователь</th>
                    <th>Тип</th>
                    <th>Кабинет</th>
                    <th>Статус</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>
                ${tickets.map(ticket => `
                    <tr>
                        <td>#${ticket.id}</td>
                        <td>${new Date(ticket.created_at).toLocaleDateString()}</td>
                        <td>${ticket.user_full_name || 'Не указан'}</td>
                        <td>${ticket.problem_type_name}</td>
                        <td>${ticket.cabinet}</td>
                        <td>
                            <select class="status-select" data-id="${ticket.id}">
                                <option value="открыта" ${ticket.status === 'открыта' ? 'selected' : ''}>Открыта</option>
                                <option value="в работе" ${ticket.status === 'в работе' ? 'selected' : ''}>В работе</option>
                                <option value="назначена" ${ticket.status === 'назначена' ? 'selected' : ''}>Назначена</option>
                                <option value="требует уточнения" ${ticket.status === 'требует уточнения' ? 'selected' : ''}>Требует уточнения</option>
                                <option value="отложена" ${ticket.status === 'отложена' ? 'selected' : ''}>Отложена</option>
                                <option value="выполнена" ${ticket.status === 'выполнена' ? 'selected' : ''}>Выполнена</option>
                                <option value="закрыта" ${ticket.status === 'закрыта' ? 'selected' : ''}>Закрыта</option>
                                <option value="отказана" ${ticket.status === 'отказана' ? 'selected' : ''}>Отказана</option>
                                <option value="архив" ${ticket.status === 'архив' ? 'selected' : ''}>Архив</option>
                            </select>
                        </td>
                        <td>
                            <button class="btn btn-secondary btn-sm" onclick="showTicketDetails(${ticket.id})">
                                Подробнее
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="assignTicket(${ticket.id})">
                                Назначить
                            </button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    // Добавляем обработчики изменения статуса
    document.querySelectorAll('.status-select').forEach(select => {
        select.addEventListener('change', async (e) => {
            const ticketId = e.target.getAttribute('data-id');
            const status = e.target.value;
            
            try {
                const response = await fetch(`/api/admin/tickets/${ticketId}/status`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ status })
                });
                
                if (response.ok) {
                    alert('Статус обновлен');
                } else {
                    const error = await response.json();
                    alert(error.error || 'Ошибка обновления статуса');
                }
            } catch (error) {
                console.error('Error updating status:', error);
                alert('Ошибка подключения к серверу');
            }
        });
    });
}

// Вспомогательные функции
function getStatusClass(status) {
    const statusMap = {
        'открыта': 'open',
        'в работе': 'in-progress',
        'назначена': 'assigned',
        'требует уточнения': 'open',
        'отложена': 'assigned',
        'выполнена': 'done',
        'закрыта': 'closed',
        'отказана': 'closed',
        'архив': 'closed'
    };
    
    return statusMap[status] || 'open';
}

// Функции для админа
async function showTicketDetails(ticketId) {
    try {
        const response = await fetch(`/api/tickets/${ticketId}`);
        if (response.ok) {
            const ticket = await response.json();
            
            let details = `
                <h3>Заявка #${ticket.id}</h3>
                <p><strong>Статус:</strong> ${ticket.status}</p>
                <p><strong>Пользователь:</strong> ${ticket.user_full_name}</p>
                <p><strong>Тип проблемы:</strong> ${ticket.problem_type_name}</p>
                <p><strong>Кабинет:</strong> ${ticket.cabinet}</p>
                <p><strong>Телефон:</strong> ${ticket.phone || 'Не указан'}</p>
                <p><strong>Email:</strong> ${ticket.email || 'Не указан'}</p>
                <p><strong>Описание:</strong> ${ticket.description}</p>
                <p><strong>Комментарии:</strong> ${ticket.comments || 'Нет'}</p>
                <p><strong>Дата создания:</strong> ${new Date(ticket.created_at).toLocaleString()}</p>
            `;
            
            if (ticket.files && ticket.files.length > 0) {
                details += '<p><strong>Файлы:</strong></p><ul>';
                ticket.files.forEach(file => {
                    details += `<li><a href="${file}" target="_blank">${file.split('/').pop()}</a></li>`;
                });
                details += '</ul>';
            }
            
            alert(details);
        }
    } catch (error) {
        console.error('Error showing ticket details:', error);
        alert('Ошибка загрузки деталей заявки');
    }
}

async function assignTicket(ticketId) {
    const mainExecutor = prompt('Введите главного исполнителя:');
    if (!mainExecutor) return;
    
    const executor = prompt('Введите дополнительного исполнителя (не обязательно):', '');
    
    try {
        const response = await fetch(`/api/admin/tickets/${ticketId}/assign`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                main_executor: mainExecutor, 
                executor: executor || null 
            })
        });
        
        if (response.ok) {
            alert('Исполнитель назначен');
            loadAdminTickets();
        } else {
            const error = await response.json();
            alert(error.error || 'Ошибка назначения исполнителя');
        }
    } catch (error) {
        console.error('Error assigning ticket:', error);
        alert('Ошибка подключения к серверу');
    }
}

// Инициализация при загрузке страницы
window.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    
    // Если открыта страница моих заявок, загружаем их
    if (document.getElementById('my-tickets-page').classList.contains('active')) {
        loadMyTickets();
    }
    
    // Если открыта админ панель, загружаем заявки
    if (document.getElementById('admin-page').classList.contains('active')) {
        loadAdminTickets();
    }
});

// Экспортируем функции для использования в консоли
window.showTicketDetails = showTicketDetails;
window.assignTicket = assignTicket;