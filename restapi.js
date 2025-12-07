const express = require('express');
const db = require('./db');

const router = express.Router();

// Middleware для проверки API ключа
const verifyApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (!apiKey) {
        return res.status(401).json({
            error: 'API ключ отсутствует',
            message: 'Необходимо предоставить API ключ в заголовке X-API-KEY или параметре api_key'
        });
    }
    
    if (apiKey !== process.env.API_SECRET) {
        return res.status(403).json({
            error: 'Неверный API ключ',
            message: 'Указанный API ключ недействителен'
        });
    }
    
    next();
};

// Получение списка всех заявок с пагинацией
router.get('/tickets', verifyApiKey, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        
        // Получаем общее количество заявок
        const totalResult = await db.query('SELECT COUNT(*) as count FROM tickets WHERE status != "архив"');
        const total = totalResult[0]?.count || 0;
        
        // Получаем заявки с пагинацией
        let sql = `
            SELECT 
                t.id,
                t.cabinet,
                t.description,
                t.status,
                t.created_at,
                t.assigned_at,
                t.in_progress_at,
                t.completed_at,
                t.main_executor,
                t.executor,
                u.login as user_login,
                u.full_name as user_full_name,
                p.name as problem_type_name
            FROM tickets t
            LEFT JOIN users u ON t.user_id = u.id
            LEFT JOIN problem_types p ON t.problem_type_id = p.id
            WHERE t.status != 'архив'
            ORDER BY t.created_at DESC
        `;
        
        if (db.dbType === 'postgres') {
            sql += ` LIMIT $1 OFFSET $2`;
            var tickets = await db.query(sql, [limit, offset]);
        } else {
            sql += ` LIMIT ? OFFSET ?`;
            var tickets = await db.query(sql, [limit, offset]);
        }
        
        // Форматируем данные для API
        const formattedTickets = tickets.map(ticket => ({
            id: ticket.id,
            cabinet: ticket.cabinet,
            description: ticket.description.substring(0, 200) + (ticket.description.length > 200 ? '...' : ''),
            status: ticket.status,
            created_at: ticket.created_at,
            assigned_at: ticket.assigned_at,
            in_progress_at: ticket.in_progress_at,
            completed_at: ticket.completed_at,
            main_executor: ticket.main_executor,
            executor: ticket.executor,
            user: {
                login: ticket.user_login,
                full_name: ticket.user_full_name
            },
            problem_type: ticket.problem_type_name
        }));
        
        res.json({
            success: true,
            data: formattedTickets,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            },
            meta: {
                count: formattedTickets.length,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('API Error getting tickets:', error);
        res.status(500).json({
            error: 'Внутренняя ошибка сервера',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Получение заявки по ID со всей информацией
router.get('/tickets/:id', verifyApiKey, async (req, res) => {
    try {
        const ticketId = req.params.id;
        
        const sql = `
            SELECT 
                t.*,
                u.login as user_login,
                u.full_name as user_full_name,
                u.ldap_groups as user_groups,
                p.name as problem_type_name,
                uc.phone as user_phone,
                uc.email as user_email
            FROM tickets t
            LEFT JOIN users u ON t.user_id = u.id
            LEFT JOIN problem_types p ON t.problem_type_id = p.id
            LEFT JOIN user_contacts uc ON t.user_id = uc.user_id
            WHERE t.id = ${db.dbType === 'postgres' ? '$1' : '?'}
        `;
        
        const tickets = await db.query(sql, [ticketId]);
        
        if (tickets.length === 0) {
            return res.status(404).json({
                error: 'Заявка не найдена',
                message: `Заявка с ID ${ticketId} не существует`
            });
        }
        
        const ticket = tickets[0];
        
        // Обработка файлов
        let files = [];
        if (ticket.files) {
            if (typeof ticket.files === 'string') {
                try {
                    files = JSON.parse(ticket.files);
                } catch (e) {
                    files = [];
                }
            } else {
                files = ticket.files;
            }
        }
        
        // Обработка групп пользователя
        let userGroups = [];
        if (ticket.user_groups) {
            if (typeof ticket.user_groups === 'string') {
                try {
                    userGroups = JSON.parse(ticket.user_groups);
                } catch (e) {
                    userGroups = [];
                }
            } else {
                userGroups = ticket.user_groups;
            }
        }
        
        // Форматирование ответа
        const response = {
            success: true,
            data: {
                id: ticket.id,
                cabinet: ticket.cabinet,
                phone: ticket.phone,
                email: ticket.email,
                description: ticket.description,
                comments: ticket.comments,
                status: ticket.status,
                main_executor: ticket.main_executor,
                executor: ticket.executor,
                created_at: ticket.created_at,
                assigned_at: ticket.assigned_at,
                in_progress_at: ticket.in_progress_at,
                completed_at: ticket.completed_at,
                archived_at: ticket.archived_at,
                files: files.map(filePath => ({
                    url: `http://${req.headers.host}${filePath}`,
                    path: filePath,
                    filename: filePath.split('/').pop()
                })),
                user: {
                    id: ticket.user_id,
                    login: ticket.user_login,
                    full_name: ticket.user_full_name,
                    groups: userGroups,
                    contacts: {
                        phone: ticket.user_phone,
                        email: ticket.user_email
                    }
                },
                problem_type: {
                    id: ticket.problem_type_id,
                    name: ticket.problem_type_name
                },
                timestamps: {
                    created: ticket.created_at,
                    assigned: ticket.assigned_at,
                    in_progress: ticket.in_progress_at,
                    completed: ticket.completed_at,
                    archived: ticket.archived_at
                }
            },
            meta: {
                timestamp: new Date().toISOString(),
                request_id: req.headers['x-request-id'] || generateRequestId()
            }
        };
        
        res.json(response);
        
    } catch (error) {
        console.error('API Error getting ticket:', error);
        res.status(500).json({
            error: 'Внутренняя ошибка сервера',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Получение статистики по заявкам
router.get('/stats', verifyApiKey, async (req, res) => {
    try {
        // Общая статистика
        const totalResult = await db.query('SELECT COUNT(*) as count FROM tickets WHERE status != "архив"');
        const total = totalResult[0]?.count || 0;
        
        // Статистика по статусам
        const statusStats = await db.query(`
            SELECT status, COUNT(*) as count 
            FROM tickets 
            WHERE status != 'архив'
            GROUP BY status
            ORDER BY count DESC
        `);
        
        // Статистика по типам проблем
        const typeStats = await db.query(`
            SELECT p.name, COUNT(t.id) as count
            FROM tickets t
            LEFT JOIN problem_types p ON t.problem_type_id = p.id
            WHERE t.status != 'архив'
            GROUP BY p.name
            ORDER BY count DESC
        `);
        
        // Статистика по дням (последние 30 дней)
        const daysStats = await db.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as count
            FROM tickets
            WHERE created_at >= DATE('now', '-30 days')
            AND status != 'архив'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `);
        
        res.json({
            success: true,
            data: {
                total_tickets: total,
                by_status: statusStats,
                by_problem_type: typeStats,
                last_30_days: daysStats
            },
            meta: {
                timestamp: new Date().toISOString(),
                period: 'all_time'
            }
        });
        
    } catch (error) {
        console.error('API Error getting stats:', error);
        res.status(500).json({
            error: 'Внутренняя ошибка сервера',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Поиск заявок
router.get('/search', verifyApiKey, async (req, res) => {
    try {
        const { q, status, start_date, end_date } = req.query;
        
        let sql = `
            SELECT 
                t.id,
                t.cabinet,
                t.description,
                t.status,
                t.created_at,
                u.login as user_login,
                u.full_name as user_full_name,
                p.name as problem_type_name
            FROM tickets t
            LEFT JOIN users u ON t.user_id = u.id
            LEFT JOIN problem_types p ON t.problem_type_id = p.id
            WHERE t.status != 'архив'
        `;
        
        const params = [];
        let paramCount = 1;
        
        if (q) {
            sql += ` AND (t.description LIKE ${db.dbType === 'postgres' ? `$${paramCount}` : '?'} 
                     OR t.cabinet LIKE ${db.dbType === 'postgres' ? `$${paramCount}` : '?'} 
                     OR t.comments LIKE ${db.dbType === 'postgres' ? `$${paramCount}` : '?'} 
                     OR u.full_name LIKE ${db.dbType === 'postgres' ? `$${paramCount}` : '?'})`;
            params.push(`%${q}%`);
            paramCount++;
        }
        
        if (status) {
            sql += ` AND t.status = ${db.dbType === 'postgres' ? `$${paramCount}` : '?'}`;
            params.push(status);
            paramCount++;
        }
        
        if (start_date) {
            sql += ` AND DATE(t.created_at) >= ${db.dbType === 'postgres' ? `$${paramCount}` : '?'}`;
            params.push(start_date);
            paramCount++;
        }
        
        if (end_date) {
            sql += ` AND DATE(t.created_at) <= ${db.dbType === 'postgres' ? `$${paramCount}` : '?'}`;
            params.push(end_date);
            paramCount++;
        }
        
        sql += ' ORDER BY t.created_at DESC LIMIT 100';
        
        const tickets = await db.query(sql, params);
        
        res.json({
            success: true,
            data: tickets,
            meta: {
                count: tickets.length,
                timestamp: new Date().toISOString(),
                query: { q, status, start_date, end_date }
            }
        });
        
    } catch (error) {
        console.error('API Error searching tickets:', error);
        res.status(500).json({
            error: 'Внутренняя ошибка сервера',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Получение пользователей
router.get('/users', verifyApiKey, async (req, res) => {
    try {
        const users = await db.query(`
            SELECT 
                id,
                login,
                full_name,
                role,
                created_at,
                updated_at
            FROM users
            ORDER BY created_at DESC
        `);
        
        res.json({
            success: true,
            data: users,
            meta: {
                count: users.length,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('API Error getting users:', error);
        res.status(500).json({
            error: 'Внутренняя ошибка сервера',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Генерация ID запроса
function generateRequestId() {
    return 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Middleware для логирования запросов
router.use((req, res, next) => {
    const requestId = req.headers['x-request-id'] || generateRequestId();
    req.requestId = requestId;
    
    console.log(`[API] ${new Date().toISOString()} ${req.method} ${req.path} - ID: ${requestId}`);
    next();
});

// Обработка 404 для API
router.use('*', verifyApiKey, (req, res) => {
    res.status(404).json({
        error: 'Ресурс не найден',
        message: `Путь ${req.originalUrl} не существует`,
        request_id: req.requestId
    });
});

// Обработка ошибок
router.use((err, req, res, next) => {
    console.error(`[API Error] ${req.requestId}:`, err);
    
    res.status(err.status || 500).json({
        error: 'Внутренняя ошибка сервера API',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined,
        request_id: req.requestId,
        timestamp: new Date().toISOString()
    });
});

module.exports = router;