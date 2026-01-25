require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const auth = require('./auth');
const tickets = require('./tickets');
const restapi = require('./restapi');
const fsService = require('./fs-service');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== КОНФИГУРАЦИЯ ==========

// Настройка сессий
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'itsupport-secret-key-' + Date.now(),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 часа
    }
};

if (app.get('env') === 'production') {
    app.set('trust proxy', 1); // trust first proxy
    sessionConfig.cookie.secure = true;
}

app.use(session(sessionConfig));

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Логирование запросов
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} - IP: ${req.ip}`);
    next();
});

// REST API маршруты (требуют API ключа)
app.use('/api/v1', restapi);

// ========== MIDDLEWARE ДЛЯ ПРОВЕРКИ АВТОРИЗАЦИИ ==========

const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }
        return res.redirect('/login.html');
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Доступ запрещен. Требуются права администратора' });
    }
    next();
};

// ========== МАРШРУТЫ АВТОРИЗАЦИИ ==========

app.post('/api/login', auth.login);
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Ошибка при выходе' });
        }
        res.json({ success: true, message: 'Вы успешно вышли' });
    });
});

app.get('/api/user', (req, res) => {
    if (req.session.user) {
        res.json({ 
            user: {
                ...req.session.user,
                isAdmin: req.session.user.role === 'admin'
            }
        });
    } else {
        res.status(401).json({ error: 'Не авторизован' });
    }
});

// Получение контактов пользователя с автосохранением
app.get('/api/user/contacts', requireAuth, async (req, res) => {
    try {
        const contacts = await db.getUserContacts(req.session.user.id);
        
        // Если контактов нет, создаем пустую запись
        if (!contacts) {
            await db.updateUserContacts(req.session.user.id, { phone: '', email: '' });
            res.json({ phone: '', email: '' });
        } else {
            res.json(contacts);
        }
    } catch (error) {
        console.error('Get user contacts error:', error);
        res.status(500).json({ error: 'Ошибка при получении контактов' });
    }
});

// Обновление контактов пользователя
app.put('/api/user/contacts', requireAuth, async (req, res) => {
    try {
        const { phone, email } = req.body;
        
        await db.updateUserContacts(req.session.user.id, { 
            phone: phone || '', 
            email: email || '' 
        });
        
        res.json({ success: true, message: 'Контакты обновлены' });
    } catch (error) {
        console.error('Update user contacts error:', error);
        res.status(500).json({ error: 'Ошибка при обновлении контактов' });
    }
});

// ========== МАРШРУТЫ ДЛЯ ЗАЯВОК ==========

// Создание заявки
app.post('/api/tickets', requireAuth, tickets.createTicket);

// Получение заявок пользователя
app.get('/api/tickets/my', requireAuth, tickets.getMyTickets);

// Получение конкретной заявки
app.get('/api/tickets/:id', requireAuth, tickets.getTicketById);

// Обновление заявки пользователем
app.put('/api/tickets/:id', requireAuth, tickets.updateTicket);

// Добавление файлов к заявке
app.post('/api/tickets/:id/files', requireAuth, tickets.addFilesToTicket);

// Удаление файла из заявки
app.delete('/api/tickets/:ticketId/files/:fileNumber', requireAuth, tickets.deleteTicketFile);

// Скачивание файла через прокси
app.get('/api/tickets/:id/files/:fileNumber/download', requireAuth, async (req, res) => {
    try {
        const { id: ticketId, fileNumber } = req.params;
        
        const ticket = await db.getTicketById(ticketId, req.session.user.id);
        if (!ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        const isOwner = ticket.user_id === req.session.user.id;
        const isAdmin = req.session.user.role === 'admin';
        
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: 'Нет доступа к этой заявке' });
        }
        
        // Перенаправляем на FS с токеном
        const downloadUrl = `${process.env.FS_BASE_URL}/api/download/${fileNumber}`;
        
        // Для браузеров - перенаправление
        if (req.headers.accept?.includes('text/html')) {
            return res.redirect(downloadUrl);
        }
        
        // Для API - возвращаем URL
        res.json({ 
            success: true, 
            downloadUrl: downloadUrl,
            directUrl: `${process.env.FS_BASE_URL}/api/download/${fileNumber}?token=${process.env.FS_TOKEN?.substring(0, 8)}...`
        });
        
    } catch (error) {
        console.error('Download file error:', error);
        res.status(500).json({ error: 'Ошибка при скачивании файла' });
    }
});

// ========== СПРАВОЧНИКИ ==========

// Типы проблем
app.get('/api/problem-types', requireAuth, tickets.getProblemTypes);

// Список кабинетов
app.get('/api/cabinets', requireAuth, tickets.getCabinets);

// Добавление нового кабинета
app.post('/api/cabinets', requireAuth, requireAdmin, tickets.addCabinet);

// ========== АДМИНИСТРАТИВНЫЕ МАРШРУТЫ ==========

// Получение всех заявок
app.get('/api/admin/tickets', requireAuth, requireAdmin, tickets.getAllTickets);

// Обновление статуса заявки
app.put('/api/admin/tickets/:id/status', requireAuth, requireAdmin, tickets.updateTicketStatus);

// Назначение исполнителя
app.put('/api/admin/tickets/:id/assign', requireAuth, requireAdmin, tickets.assignTicket);

// Статистика
app.get('/api/admin/stats', requireAuth, requireAdmin, async (req, res) => {
    try {
        const stats = await db.getStats();
        res.json(stats);
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ error: 'Ошибка при получении статистики' });
    }
});

// Поиск заявок
app.get('/api/admin/search', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim() === '') {
            return res.status(400).json({ error: 'Поисковый запрос обязателен' });
        }
        
        const results = await db.searchTickets(q.trim());
        res.json(results);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Ошибка при поиске' });
    }
});

// ========== ФАЙЛОВЫЙ СЕРВИС ==========

// Статус файлового сервиса
app.get('/api/fs/status', requireAuth, async (req, res) => {
    try {
        const status = await fsService.checkConnection();
        res.json(status);
    } catch (error) {
        console.error('FS status error:', error);
        res.status(500).json({ 
            connected: false, 
            error: error.message 
        });
    }
});

// Статистика файлового сервиса
app.get('/api/fs/stats', requireAuth, requireAdmin, async (req, res) => {
    try {
        const stats = await fsService.getStats();
        res.json(stats);
    } catch (error) {
        console.error('FS stats error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Поиск файлов в FS
app.get('/api/fs/files', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { login, service, date } = req.query;
        
        let url = `${process.env.FS_BASE_URL}/api/files`;
        if (login) {
            url = `${process.env.FS_BASE_URL}/api/files/${login}`;
        }
        
        const params = new URLSearchParams();
        if (service) params.append('service', service);
        if (date) params.append('date', date);
        
        if (params.toString()) {
            url += `?${params.toString()}`;
        }
        
        const response = await fetch(url, {
            headers: { 'X-API-Token': process.env.FS_TOKEN }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('FS files search error:', error);
        res.status(500).json({ 
            error: 'Ошибка при поиске файлов',
            details: error.message 
        });
    }
});

// ========== ЗАЩИЩЕННЫЕ HTML СТРАНИЦЫ ==========

// Главная страница (создание заявки)
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Страница моих заявок
app.get('/my-tickets', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'my-tickets.html'));
});

// Админ панель
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Страница с деталями заявки
app.get('/ticket/:id', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ticket-details.html'));
});

// Документация API
app.get('/api/docs', (req, res) => {
    res.json({
        name: 'IT Support API',
        version: '1.0.0',
        description: 'REST API для управления заявками технической поддержки',
        endpoints: {
            // GET методы
            'GET /api/v1/tickets': {
                description: 'Получить список всех заявок',
                parameters: {
                    page: 'Номер страницы (по умолчанию 1)',
                    limit: 'Количество записей на странице (по умолчанию 50)',
                    'X-API-KEY': 'Секретный API ключ в заголовках'
                },
                example: 'curl -H "X-API-KEY: your_secret_key" http://localhost:3000/api/v1/tickets?page=1&limit=10'
            },
            'GET /api/v1/tickets/:id': {
                description: 'Получить заявку по ID со всей информацией и файлами',
                parameters: {
                    id: 'ID заявки',
                    'X-API-KEY': 'Секретный API ключ в заголовках'
                }
            },
            'GET /api/v1/tickets/:id/status': {
                description: 'Получить текущий статус заявки',
                parameters: {
                    id: 'ID заявки',
                    'X-API-KEY': 'Секретный API ключ в заголовках'
                }
            },
            
            // PUT/PATCH методы
            'PUT /api/v1/tickets/:id/status': {
                description: 'Изменить статус заявки',
                method: 'PUT',
                parameters: {
                    id: 'ID заявки',
                    'X-API-KEY': 'Секретный API ключ в заголовках'
                },
                request_body: {
                    status: 'Новый статус (обязательно)',
                    comment: 'Комментарий к изменению статуса',
                    changed_by: 'Кто изменил статус'
                },
                example: `curl -X PUT -H "Content-Type: application/json" -H "X-API-KEY: your_secret_key" \\
  -d '{"status": "в работе", "comment": "Приступил к работе", "changed_by": "Интеграция"}' \\
  http://localhost:3000/api/v1/tickets/1/status`
            },
            
            'PATCH /api/v1/tickets/:id': {
                description: 'Частичное обновление заявки',
                method: 'PATCH',
                parameters: {
                    id: 'ID заявки',
                    'X-API-KEY': 'Секретный API ключ в заголовках'
                },
                request_body: {
                    status: 'Новый статус',
                    main_executor: 'Главный исполнитель',
                    executor: 'Дополнительный исполнитель',
                    comment: 'Комментарий',
                    description: 'Описание проблемы'
                }
            },
            
            'PUT /api/v1/tickets/:id/assign': {
                description: 'Назначить исполнителя заявке',
                method: 'PUT',
                parameters: {
                    id: 'ID заявки',
                    'X-API-KEY': 'Секретный API ключ в заголовках'
                },
                request_body: {
                    main_executor: 'Главный исполнитель (обязательно)',
                    executor: 'Дополнительный исполнитель',
                    comment: 'Комментарий к назначению',
                    assigned_by: 'Кто назначил'
                }
            },
            
            // Другие методы
            'GET /api/v1/stats': {
                description: 'Получить статистику по заявкам'
            },
            'GET /api/v1/search': {
                description: 'Поиск заявок',
                parameters: {
                    q: 'Поисковый запрос',
                    status: 'Фильтр по статусу',
                    start_date: 'Дата начала (YYYY-MM-DD)',
                    end_date: 'Дата окончания (YYYY-MM-DD)'
                }
            },
            
            // Файловый сервис
            'GET /api/fs/status': {
                description: 'Получить статус подключения к файловому сервису',
                authentication: 'Требуется авторизация'
            },
            'GET /api/fs/stats': {
                description: 'Получить статистику файлового сервиса',
                authentication: 'Требуются права администратора'
            }
        },
        status_codes: {
            'открыта': 'Заявка создана',
            'в работе': 'Исполнитель приступил к работе',
            'назначена': 'Исполнитель назначен',
            'требует уточнения': 'Требуется дополнительная информация',
            'отложена': 'Работа отложена',
            'выполнена': 'Работа выполнена',
            'закрыта': 'Заявка закрыта',
            'отказана': 'В выполнении отказано',
            'архив': 'Заявка перемещена в архив'
        },
        authentication: {
            web: 'Сессионные куки',
            api: 'API Key в заголовке X-API-KEY',
            fs: 'Статический токен из переменной окружения FS_TOKEN'
        },
        file_service: {
            base_url: process.env.FS_BASE_URL || 'Не настроен',
            service_name: process.env.FS_SERVICE_NAME || 'itsupport',
            max_file_size: '100MB',
            max_files_per_ticket: 10,
            supported_formats: 'Изображения, документы, архивы'
        },
        rate_limiting: 'Без ограничений',
        contact: {
            email: 'kalugin66@ya.ru',
            phone: '+7 (912) 272-60-19'
        }
    });
});

// ========== МАРШРУТЫ ДЛЯ ОБЩЕДОСТУПНЫХ ФАЙЛОВ ==========

// Отдаем загруженные файлы (для локального хранения, если FS недоступен)
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use('/temp_uploads', express.static(path.join(__dirname, 'public', 'temp_uploads')));

// ========== ОБРАБОТКА ОШИБОК ==========

// 404 - не найден
app.use((req, res) => {
    console.log(`404: ${req.method} ${req.url}`);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        res.status(404).json({ error: 'Ресурс не найден' });
    } else {
        res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    }
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('Ошибка сервера:', err);
    
    // Multer ошибки
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Размер файла превышает 100MB' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Можно загрузить не более 10 файлов' });
    }
    
    const statusCode = err.status || 500;
    const message = process.env.NODE_ENV === 'development' 
        ? err.message 
        : 'Внутренняя ошибка сервера';
    
    res.status(statusCode).json({ 
        error: message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// ========== ЗАПУСК СЕРВЕРА ==========

async function startServer() {
    try {
        // Создаем необходимые папки
        const folders = [
            path.join(__dirname, 'public', 'temp_uploads'),
            path.join(__dirname, 'public', 'uploads'),
            path.join(__dirname, 'data')
        ];
        
        folders.forEach(folder => {
            if (!fs.existsSync(folder)) {
                fs.mkdirSync(folder, { recursive: true });
                console.log(`Создана папка: ${folder}`);
            }
        });
        
        // Инициализация базы данных
        console.log('='.repeat(60));
        console.log('Инициализация базы данных...');
        await db.init();
        
        // Проверка подключения к файловому сервису
        console.log('\nПроверка подключения к файловому сервису...');
        const fsStatus = await fsService.checkConnection();
        
        console.log('='.repeat(60));
        console.log('НАСТРОЙКИ ФАЙЛОВОГО СЕРВИСА:');
        console.log('='.repeat(60));
        console.log(`URL: ${process.env.FS_BASE_URL || 'Не настроен'}`);
        console.log(`Сервис: ${process.env.FS_SERVICE_NAME || 'itsupport'}`);
        console.log(`Токен: ${process.env.FS_TOKEN ? '✓ Настроен' : '✗ Не настроен'}`);
        
        if (fsStatus.connected) {
            console.log('Статус: ✓ ПОДКЛЮЧЕНО');
            console.log(`Сообщение: ${fsStatus.message}`);
            
            if (fsStatus.stats) {
                console.log(`Файлов в системе: ${fsStatus.stats.total_files || 0}`);
                console.log(`Общий размер: ${formatFileSize(fsStatus.stats.total_size || 0)}`);
            }
        } else {
            console.log('Статус: ✗ НЕДОСТУПЕН');
            console.log(`Ошибка: ${fsStatus.error}`);
            console.log('⚠ Внимание: Файлы будут сохраняться локально');
        }
        console.log('='.repeat(60));
        
        // Генерация логина и пароля суперадмина
        const superadmin = auth.generateSuperadmin();
        console.log('\n' + '='.repeat(60));
        console.log('УЧЕТНЫЕ ДАННЫЕ СУПЕРАДМИНА:');
        console.log('='.repeat(60));
        console.log(`Логин: ${superadmin.username}`);
        console.log(`Пароль: ${superadmin.password}`);
        console.log('='.repeat(60));
        console.log('ВАЖНО: Сохраните эти данные в безопасном месте!');
        console.log('='.repeat(60) + '\n');
        
        // Запуск сервера
        app.listen(PORT, () => {
            console.log('='.repeat(60));
            console.log(`СЕРВЕР ЗАПУЩЕН!`);
            console.log('='.repeat(60));
            console.log(`Локальный URL: http://localhost:${PORT}`);
            console.log(`Сетевой URL: http://${getLocalIP()}:${PORT}`);
            console.log(`Рабочая директория: ${process.cwd()}`);
            console.log(`Тип БД: ${db.dbType === 'postgres' ? 'PostgreSQL' : 'SQLite'}`);
            console.log(`Файловый сервис: ${fsStatus.connected ? 'АКТИВЕН' : 'ЛОКАЛЬНЫЙ'}`);
            console.log('='.repeat(60));
            console.log('\nОСНОВНЫЕ МАРШРУТЫ:');
            console.log('  /                - Создание заявки');
            console.log('  /my-tickets      - Мои заявки');
            console.log('  /admin           - Админ панель');
            console.log('  /login.html      - Авторизация');
            console.log('\nAPI МАРШРУТЫ:');
            console.log('  POST   /api/login                     - Авторизация');
            console.log('  POST   /api/tickets                   - Создание заявки');
            console.log('  GET    /api/tickets/my                - Мои заявки');
            console.log('  GET    /api/fs/status                 - Статус файлового сервиса');
            console.log('  GET    /api/admin/tickets             - Все заявки (админ)');
            console.log('  GET    /api/docs                      - Документация API');
            console.log('\nCLI СКРИПТЫ:');
            console.log('  npm run upload   <файл>              - Загрузка файла в FS');
            console.log('  npm run download <номер-файла>       - Скачивание файла');
            console.log('  npm run list                          - Список файлов');
            console.log('  npm run stats                         - Статистика FS');
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('Ошибка запуска сервера:', error);
        process.exit(1);
    }
}

// Функция для получения локального IP адреса
function getLocalIP() {
    const interfaces = require('os').networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// Функция для форматирования размера файла
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Функция для очистки старых временных файлов
function cleanupOldFiles() {
    const tempDir = path.join(__dirname, 'public', 'temp_uploads');
    
    if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000; // 1 день
        
        let deletedCount = 0;
        files.forEach(file => {
            const filePath = path.join(tempDir, file);
            try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > oneDay) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            } catch (error) {
                console.error(`Ошибка при удалении ${file}:`, error);
            }
        });
        
        if (deletedCount > 0) {
            console.log(`Очищено ${deletedCount} старых временных файлов`);
        }
    }
}

// Запускаем очистку каждые 6 часов
setInterval(cleanupOldFiles, 6 * 60 * 60 * 1000);

// Функция для проверки доступности FS при запуске
async function checkFSOnStartup() {
    try {
        const status = await fsService.checkConnection();
        if (status.connected) {
            console.log('[FS] Сервис доступен');
        } else {
            console.warn('[FS] Сервис недоступен, используем локальное хранение');
        }
    } catch (error) {
        console.error('[FS] Ошибка проверки:', error.message);
    }
}

// Проверяем FS при запуске и каждые 30 минут
setTimeout(checkFSOnStartup, 5000);
setInterval(checkFSOnStartup, 30 * 60 * 1000);

// Запускаем сервер
startServer();

module.exports = app;