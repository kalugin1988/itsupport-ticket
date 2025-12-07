// Переменная для хранения данных пользователя
let userData = {};

// Инициализация при загрузке страницы
async function initTicketPage() {
    // Получаем данные пользователя
    await loadUserData();
    
    // Загружаем справочники
    await loadProblemTypes();
    await loadCabinets();
    
    // Заполняем контакты пользователя
    fillUserContacts();
    
    // Инициализируем обработчики событий
    initEventHandlers();
}

// Загрузка данных пользователя
async function loadUserData() {
    try {
        const response = await fetch('/api/user');
        if (response.ok) {
            const data = await response.json();
            userData = data.user || {};
            
            // Сохраняем данные пользователя в localStorage для быстрого доступа
            localStorage.setItem('userData', JSON.stringify(userData));
        }
    } catch (error) {
        console.error('Error loading user data:', error);
    }
}

// Загрузка контактов пользователя
async function loadUserContacts() {
    try {
        const response = await fetch('/api/user-contacts');
        if (response.ok) {
            const contacts = await response.json();
            
            // Сохраняем контакты в объекте пользователя
            userData.contacts = contacts;
            
            // Заполняем поля формы
            fillContactFields(contacts);
            
            return contacts;
        }
    } catch (error) {
        console.error('Error loading user contacts:', error);
        return null;
    }
}

// Заполнение полей контактов
function fillUserContacts() {
    // Пробуем получить контакты из localStorage
    const savedUserData = localStorage.getItem('userData');
    if (savedUserData) {
        try {
            const parsedData = JSON.parse(savedUserData);
            if (parsedData.contacts) {
                fillContactFields(parsedData.contacts);
            }
        } catch (e) {
            console.error('Error parsing saved user data:', e);
        }
    }
    
    // Всегда загружаем свежие данные с сервера
    loadUserContacts();
}

// Заполнение полей формы контактами
function fillContactFields(contacts) {
    if (!contacts) return;
    
    const phoneField = document.getElementById('phone');
    const emailField = document.getElementById('email');
    
    if (phoneField && contacts.phone) {
        phoneField.value = contacts.phone;
        phoneField.dataset.original = contacts.phone;
    }
    
    if (emailField && contacts.email) {
        emailField.value = contacts.email;
        emailField.dataset.original = contacts.email;
    }
}

// Загрузка типов проблем
async function loadProblemTypes() {
    try {
        const response = await fetch('/api/problem-types');
        if (response.ok) {
            const types = await response.json();
            const select = document.getElementById('problemType');
            
            if (select) {
                select.innerHTML = '<option value="">Выберите тип проблемы</option>';
                
                types.forEach(type => {
                    const option = document.createElement('option');
                    option.value = type.id;
                    option.textContent = type.name;
                    select.appendChild(option);
                });
            }
        }
    } catch (error) {
        console.error('Error loading problem types:', error);
    }
}

// Загрузка списка кабинетов
async function loadCabinets() {
    try {
        const response = await fetch('/api/cabinets');
        if (response.ok) {
            const cabinets = await response.json();
            const datalist = document.getElementById('cabinetList');
            
            if (datalist) {
                datalist.innerHTML = '';
                cabinets.forEach(cabinet => {
                    const option = document.createElement('option');
                    option.value = cabinet.number;
                    datalist.appendChild(option);
                });
            }
            
            // Заполняем поле кабинета, если есть сохраненное значение
            const savedCabinet = localStorage.getItem('lastCabinet');
            if (savedCabinet) {
                const cabinetField = document.getElementById('cabinet');
                if (cabinetField && !cabinetField.value) {
                    cabinetField.value = savedCabinet;
                }
            }
        }
    } catch (error) {
        console.error('Error loading cabinets:', error);
    }
}

// Инициализация обработчиков событий
function initEventHandlers() {
    const addCabinetBtn = document.getElementById('addCabinetBtn');
    if (addCabinetBtn) {
        addCabinetBtn.addEventListener('click', handleAddCabinet);
    }
    
    const ticketForm = document.getElementById('ticketForm');
    if (ticketForm) {
        ticketForm.addEventListener('submit', handleFormSubmit);
    }
    
    const fileInput = document.getElementById('files');
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }
    
    // Сохраняем выбранный кабинет при изменении
    const cabinetField = document.getElementById('cabinet');
    if (cabinetField) {
        cabinetField.addEventListener('change', function() {
            if (this.value.trim()) {
                localStorage.setItem('lastCabinet', this.value.trim());
            }
        });
    }
    
    // Сохраняем контакты при изменении
    const phoneField = document.getElementById('phone');
    const emailField = document.getElementById('email');
    
    if (phoneField) {
        phoneField.addEventListener('blur', function() {
            saveContact('phone', this.value);
        });
    }
    
    if (emailField) {
        emailField.addEventListener('blur', function() {
            saveContact('email', this.value);
        });
    }
}

// Сохранение контакта в localStorage
function saveContact(type, value) {
    const savedUserData = localStorage.getItem('userData');
    if (savedUserData) {
        try {
            const userData = JSON.parse(savedUserData);
            if (!userData.contacts) userData.contacts = {};
            userData.contacts[type] = value;
            localStorage.setItem('userData', JSON.stringify(userData));
        } catch (e) {
            console.error('Error saving contact:', e);
        }
    }
}

// Добавление нового кабинета
async function handleAddCabinet() {
    const cabinetInput = document.getElementById('cabinet');
    const cabinetNumber = cabinetInput.value.trim();
    
    if (!cabinetNumber) {
        alert('Введите номер кабинета');
        return;
    }
    
    try {
        const response = await fetch('/api/cabinets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ number: cabinetNumber })
        });
        
        if (response.ok) {
            alert(`Кабинет "${cabinetNumber}" добавлен в список`);
            
            // Обновляем список кабинетов
            await loadCabinets();
            
            // Сохраняем в localStorage
            localStorage.setItem('lastCabinet', cabinetNumber);
            
        } else {
            const error = await response.json();
            alert(error.error || 'Ошибка добавления кабинета');
        }
    } catch (error) {
        console.error('Error adding cabinet:', error);
        alert('Ошибка подключения к серверу');
    }
}

// Обработка выбора файлов
function handleFileSelect() {
    const files = this.files;
    const fileList = document.getElementById('fileList');
    
    if (!fileList) return;
    
    fileList.innerHTML = '';
    
    let totalSize = 0;
    const maxSize = 50 * 1024 * 1024; // 50MB
    const maxFiles = 7;
    
    if (files.length > maxFiles) {
        alert(`Максимум ${maxFiles} файлов`);
        this.value = '';
        return;
    }
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        totalSize += file.size;
        
        if (totalSize > maxSize) {
            alert('Общий размер файлов превышает 50MB');
            this.value = '';
            fileList.innerHTML = '';
            return;
        }
        
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <span>${file.name} (${formatFileSize(file.size)})</span>
            <button type="button" onclick="removeFile(${i})" class="remove-file-btn">×</button>
        `;
        fileList.appendChild(fileItem);
    }
}

// Удаление файла из списка
function removeFile(index) {
    const fileInput = document.getElementById('files');
    const files = Array.from(fileInput.files);
    files.splice(index, 1);
    
    const dataTransfer = new DataTransfer();
    files.forEach(file => dataTransfer.items.add(file));
    
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change'));
}

// Обработка отправки формы
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const form = e.target;
    const formData = new FormData(form);
    
    // Валидация обязательных полей
    const requiredFields = ['problem_type_id', 'cabinet', 'description'];
    const errors = [];
    
    for (const field of requiredFields) {
        if (!formData.get(field)) {
            errors.push(getFieldLabel(field));
        }
    }
    
    if (errors.length > 0) {
        alert(`Заполните обязательные поля: ${errors.join(', ')}`);
        return;
    }
    
    // Проверка файлов
    const files = formData.getAll('files');
    if (files.length > 7) {
        alert('Можно загрузить не более 7 файлов');
        return;
    }
    
    let totalSize = 0;
    for (const file of files) {
        if (file.size > 0) {
            totalSize += file.size;
        }
    }
    
    if (totalSize > 50 * 1024 * 1024) {
        alert('Общий размер файлов превышает 50MB');
        return;
    }
    
    // Показываем индикатор загрузки
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Создание...';
    submitBtn.disabled = true;
    
    try {
        const response = await fetch('/api/tickets', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Показываем уведомление
            showNotification('Заявка успешно создана!', 'success');
            
            // Сбрасываем форму
            form.reset();
            document.getElementById('fileList').innerHTML = '';
            
            // Сохраняем кабинет для будущего использования
            const cabinetValue = formData.get('cabinet');
            if (cabinetValue) {
                localStorage.setItem('lastCabinet', cabinetValue);
            }
            
            // Сохраняем контакты
            const phoneValue = formData.get('phone');
            const emailValue = formData.get('email');
            
            saveContact('phone', phoneValue);
            saveContact('email', emailValue);
            
            // Переключаемся на страницу моих заявок
            const myTicketsTab = document.querySelector('[data-page="my-tickets"]');
            if (myTicketsTab) {
                myTicketsTab.click();
            }
            
        } else {
            alert(data.error || 'Ошибка при создании заявки');
        }
    } catch (error) {
        console.error('Error creating ticket:', error);
        alert('Ошибка подключения к серверу');
    } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
}

// Создание заявки
async function createTicket(formData) {
    try {
        const response = await fetch('/api/tickets', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            return { success: true, ticketId: data.ticketId, files: data.files };
        } else {
            return { success: false, error: data.error };
        }
    } catch (error) {
        console.error('Error creating ticket:', error);
        return { success: false, error: 'Ошибка подключения к серверу' };
    }
}

// Вспомогательные функции
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFieldLabel(fieldName) {
    const labels = {
        'problem_type_id': 'Тип проблемы',
        'cabinet': 'Номер кабинета',
        'description': 'Описание проблемы'
    };
    return labels[fieldName] || fieldName;
}

function showNotification(message, type = 'info') {
    // Проверяем, есть ли уже уведомление
    let notification = document.querySelector('.notification');
    if (notification) {
        notification.remove();
    }
    
    notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Стили для уведомления
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'error' ? '#f8d7da' : type === 'success' ? '#d4edda' : '#d1ecf1'};
        color: ${type === 'error' ? '#721c24' : type === 'success' ? '#155724' : '#0c5460'};
        border-radius: 5px;
        z-index: 1000;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(notification);
    
    // Удаляем через 5 секунд
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// Добавляем CSS анимации
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .file-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        margin: 5px 0;
        background: #f8f9fa;
        border-radius: 4px;
        border: 1px solid #dee2e6;
    }
    
    .remove-file-btn {
        background: #dc3545;
        color: white;
        border: none;
        border-radius: 50%;
        width: 24px;
        height: 24px;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .remove-file-btn:hover {
        background: #c82333;
    }
`;

document.head.appendChild(style);

// Инициализация при загрузке страницы
if (document.getElementById('ticketForm')) {
    document.addEventListener('DOMContentLoaded', initTicketPage);
}

// Экспортируем функции для глобального доступа
window.removeFile = removeFile;