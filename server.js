require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const auth = require('./auth');
const tickets = require('./tickets');
const restapi = require('./restapi');

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
app.delete('/api/tickets/:ticketId/files/:filename', requireAuth, tickets.deleteTicketFile);

// ========== СПРАВОЧНИКИ ==========

// Типы проблем
app.get('/api/problem-types', requireAuth, tickets.getProblemTypes);

// Список кабинетов
app.get('/api/cabinets', requireAuth, tickets.getCabinets);

// Добавление нового кабинета
app.post('/api/cabinets', requireAuth, requireAdmin, tickets.addCabinet);

// Контакты пользователя
app.get('/api/user-contacts', requireAuth, tickets.getUserContacts);

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
        endpoints: {
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
                },
                example: 'curl -H "X-API-KEY: your_secret_key" http://localhost:3000/api/v1/tickets/1'
            },
            'GET /api/v1/stats': {
                description: 'Получить статистику по заявкам',
                parameters: {
                    'X-API-KEY': 'Секретный API ключ в заголовках'
                }
            },
            'GET /api/v1/search': {
                description: 'Поиск заявок',
                parameters: {
                    q: 'Поисковый запрос',
                    status: 'Фильтр по статусу',
                    start_date: 'Дата начала (YYYY-MM-DD)',
                    end_date: 'Дата окончания (YYYY-MM-DD)',
                    'X-API-KEY': 'Секретный API ключ в заголовках'
                }
            },
            'GET /api/v1/users': {
                description: 'Получить список пользователей',
                parameters: {
                    'X-API-KEY': 'Секретный API ключ в заголовках'
                }
            }
        },
        authentication: {
            method: 'API Key',
            header: 'X-API-KEY',
            parameter: 'api_key'
        },
        rate_limiting: 'Без ограничений',
        contact: {
            email: 'kalugin66@ya.ru',
            phone: '+7 (912) 272-60-19'
        }
    });
});
// ========== МАРШРУТЫ ДЛЯ ОБЩЕДОСТУПНЫХ ФАЙЛОВ ==========

// Отдаем загруженные файлы
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use('/tickets', express.static(path.join(__dirname, 'public', 'tickets')));

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
        return res.status(400).json({ error: 'Размер файла превышает 50MB' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Можно загрузить не более 7 файлов' });
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
            path.join(__dirname, 'public', 'tickets'),
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
        console.log('Инициализация базы данных...');
        await db.init();
        
        // Генерация логина и пароля суперадмина
        const superadmin = auth.generateSuperadmin();
        console.log('\n' + '='.repeat(50));
        console.log('SUPERADMIN CREDENTIALS:');
        console.log('='.repeat(50));
        console.log(`Username: ${superadmin.username}`);
        console.log(`Password: ${superadmin.password}`);
        console.log('='.repeat(50));
        console.log('ВАЖНО: Сохраните эти данные!');
        console.log('='.repeat(50) + '\n');
        
        // Запуск сервера
        app.listen(PORT, () => {
            console.log('='.repeat(50));
            console.log(`Сервер запущен!`);
            console.log(`URL: http://localhost:${PORT}`);
            console.log(`Мой IP: http://${getLocalIP()}:${PORT}`);
            console.log(`Рабочая директория: ${process.cwd()}`);
            console.log(`Папка для файлов: ${path.join(__dirname, 'public', 'tickets')}`);
            console.log('='.repeat(50));
            console.log('\nДоступные маршруты:');
            console.log('  /                - Создание заявки');
            console.log('  /my-tickets      - Мои заявки');
            console.log('  /admin           - Админ панель (только для администраторов)');
            console.log('  /login.html      - Страница авторизации');
            console.log('\nAPI маршруты:');
            console.log('  POST   /api/login                     - Авторизация');
            console.log('  POST   /api/logout                    - Выход');
            console.log('  GET    /api/user                      - Информация о текущем пользователе');
            console.log('  POST   /api/tickets                   - Создание заявки');
            console.log('  GET    /api/tickets/my                - Мои заявки');
            console.log('  GET    /api/tickets/:id               - Получение заявки');
            console.log('  GET    /api/problem-types             - Типы проблем');
            console.log('  GET    /api/cabinets                  - Список кабинетов');
            console.log('  GET    /api/admin/tickets             - Все заявки (админ)');
            console.log('  PUT    /api/admin/tickets/:id/status  - Изменение статуса (админ)');
            console.log('  GET    /api/admin/stats               - Статистика (админ)');
            console.log('='.repeat(50));
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

// Запускаем сервер
startServer();

module.exports = app;