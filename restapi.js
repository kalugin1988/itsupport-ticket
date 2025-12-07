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

// Валидация статусов
const validStatuses = [
    'открыта', 'в работе', 'назначена', 'требует уточнения', 
    'отложена', 'выполнена', 'закрыта', 'отказана', 'архив'
];

function validateStatus(status) {
    return validStatuses.includes(status);
}

// ========== GET МЕТОДЫ ==========

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
            problem_type: ticket.problem_type_name,
            _links: {
                self: `/api/v1/tickets/${ticket.id}`,
                update_status: `/api/v1/tickets/${ticket.id}/status`
            }
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
                    url: `${req.protocol}://${req.headers.host}${filePath}`,
                    path: filePath,
                    filename: filePath.split('/').pop(),
                    download_url: `${req.protocol}://${req.headers.host}/api/v1/tickets/${ticketId}/files/${filePath.split('/').pop()}/download`
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
                },
                _links: {
                    self: `/api/v1/tickets/${ticketId}`,
                    update_status: `/api/v1/tickets/${ticketId}/status`,
                    assign: `/api/v1/tickets/${ticketId}/assign`
                },
                _actions: {
                    allowed_statuses: validStatuses.filter(s => s !== ticket.status),
                    can_assign: !ticket.main_executor,
                    can_archive: ticket.status !== 'архив'
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

// ========== PUT/PATCH МЕТОДЫ ДЛЯ ИЗМЕНЕНИЯ СТАТУСА ==========

// Получение текущего статуса заявки
router.get('/tickets/:id/status', verifyApiKey, async (req, res) => {
    try {
        const ticketId = req.params.id;
        
        const sql = `SELECT status FROM tickets WHERE id = ${db.dbType === 'postgres' ? '$1' : '?'}`;
        const tickets = await db.query(sql, [ticketId]);
        
        if (tickets.length === 0) {
            return res.status(404).json({
                error: 'Заявка не найдена',
                message: `Заявка с ID ${ticketId} не существует`
            });
        }
        
        res.json({
            success: true,
            data: {
                ticket_id: ticketId,
                current_status: tickets[0].status,
                allowed_statuses: validStatuses,
                _links: {
                    update: `/api/v1/tickets/${ticketId}/status`,
                    ticket: `/api/v1/tickets/${ticketId}`
                }
            },
            meta: {
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('API Error getting ticket status:', error);
        res.status(500).json({
            error: 'Внутренняя ошибка сервера',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Изменение статуса заявки
router.put('/tickets/:id/status', verifyApiKey, async (req, res) => {
    try {
        const ticketId = req.params.id;
        const { status, comment, changed_by } = req.body;
        
        // Валидация входных данных
        if (!status) {
            return res.status(400).json({
                error: 'Не указан статус',
                message: 'Поле status обязательно для заполнения'
            });
        }
        
        if (!validateStatus(status)) {
            return res.status(400).json({
                error: 'Неверный статус',
                message: `Допустимые значения статуса: ${validStatuses.join(', ')}`,
                allowed_statuses: validStatuses
            });
        }
        
        // Проверяем существование заявки
        const checkSql = `SELECT status, comments FROM tickets WHERE id = ${db.dbType === 'postgres' ? '$1' : '?'}`;
        const tickets = await db.query(checkSql, [ticketId]);
        
        if (tickets.length === 0) {
            return res.status(404).json({
                error: 'Заявка не найдена',
                message: `Заявка с ID ${ticketId} не существует`
            });
        }
        
        const currentTicket = tickets[0];
        const oldStatus = currentTicket.status;
        
        // Если статус не изменился
        if (oldStatus === status) {
            return res.status(400).json({
                error: 'Статус не изменился',
                message: `Текущий статус уже "${status}"`,
                data: {
                    ticket_id: ticketId,
                    status: status
                }
            });
        }
        
        // Обновляем статус
        await db.updateTicketStatus(ticketId, status);
        
        // Добавляем комментарий, если он есть
        let newComments = currentTicket.comments || '';
        if (comment && comment.trim() !== '') {
            const changedBy = changed_by || 'API Система';
            const statusComment = `\n[Смена статуса через API от ${changedBy}]: ${comment.trim()} (${new Date().toLocaleString()})`;
            newComments += statusComment;
            await db.updateTicketInfo(ticketId, { comments: newComments });
        }
        
        // Логируем изменение статуса
        console.log(`[API] Статус заявки #${ticketId} изменен с "${oldStatus}" на "${status}"`);
        
        // Получаем обновленную заявку
        const updatedSql = `
            SELECT t.*, u.login as user_login, u.full_name as user_full_name
            FROM tickets t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.id = ${db.dbType === 'postgres' ? '$1' : '?'}
        `;
        const updatedTickets = await db.query(updatedSql, [ticketId]);
        const updatedTicket = updatedTickets[0];
        
        res.json({
            success: true,
            message: 'Статус заявки успешно обновлен',
            data: {
                ticket_id: ticketId,
                old_status: oldStatus,
                new_status: status,
                changed_at: new Date().toISOString(),
                changed_by: changed_by || 'API Система',
                comment: comment || null,
                ticket: {
                    id: updatedTicket.id,
                    status: updatedTicket.status,
                    cabinet: updatedTicket.cabinet,
                    description: updatedTicket.description,
                    user: {
                        login: updatedTicket.user_login,
                        full_name: updatedTicket.user_full_name
                    },
                    timestamps: {
                        created: updatedTicket.created_at,
                        assigned: updatedTicket.assigned_at,
                        in_progress: updatedTicket.in_progress_at,
                        completed: updatedTicket.completed_at
                    }
                },
                _links: {
                    ticket: `/api/v1/tickets/${ticketId}`,
                    status_history: `/api/v1/tickets/${ticketId}/status/history`
                }
            },
            meta: {
                timestamp: new Date().toISOString(),
                request_id: req.headers['x-request-id'] || generateRequestId()
            }
        });
        
    } catch (error) {
        console.error('API Error updating ticket status:', error);
        res.status(500).json({
            error: 'Внутренняя ошибка сервера',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Альтернативный метод для изменения статуса (PATCH)
router.patch('/tickets/:id', verifyApiKey, async (req, res) => {
    try {
        const ticketId = req.params.id;
        const { status, comment, changed_by, ...otherFields } = req.body;
        
        // Если в запросе есть статус, меняем его
        if (status) {
            if (!validateStatus(status)) {
                return res.status(400).json({
                    error: 'Неверный статус',
                    message: `Допустимые значения статуса: ${validStatuses.join(', ')}`
                });
            }
            
            // Проверяем существование заявки
            const checkSql = `SELECT status, comments FROM tickets WHERE id = ${db.dbType === 'postgres' ? '$1' : '?'}`;
            const tickets = await db.query(checkSql, [ticketId]);
            
            if (tickets.length === 0) {
                return res.status(404).json({
                    error: 'Заявка не найдена'
                });
            }
            
            const currentTicket = tickets[0];
            
            // Обновляем статус
            await db.updateTicketStatus(ticketId, status);
            
            // Добавляем комментарий
            if (comment && comment.trim() !== '') {
                const changedBy = changed_by || 'API Система';
                const newComments = (currentTicket.comments || '') + 
                    `\n[Обновление через API от ${changedBy}]: ${comment.trim()} (${new Date().toLocaleString()})`;
                await db.updateTicketInfo(ticketId, { comments: newComments });
            }
        }
        
        // Обновляем другие поля, если они есть
        if (Object.keys(otherFields).length > 0) {
            // Проверяем разрешенные поля для обновления
            const allowedFields = ['main_executor', 'executor', 'comments', 'description'];
            const updates = {};
            
            for (const [key, value] of Object.entries(otherFields)) {
                if (allowedFields.includes(key)) {
                    updates[key] = value;
                }
            }
            
            if (Object.keys(updates).length > 0) {
                await db.updateTicketInfo(ticketId, updates);
            }
        }
        
        // Получаем обновленную заявку
        const updatedSql = `SELECT * FROM tickets WHERE id = ${db.dbType === 'postgres' ? '$1' : '?'}`;
        const updatedTickets = await db.query(updatedSql, [ticketId]);
        
        res.json({
            success: true,
            message: 'Заявка успешно обновлена',
            data: updatedTickets[0],
            meta: {
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('API Error updating ticket:', error);
        res.status(500).json({
            error: 'Внутренняя ошибка сервера',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Назначение исполнителя
router.put('/tickets/:id/assign', verifyApiKey, async (req, res) => {
    try {
        const ticketId = req.params.id;
        const { main_executor, executor, comment, assigned_by } = req.body;
        
        if (!main_executor) {
            return res.status(400).json({
                error: 'Не указан главный исполнитель',
                message: 'Поле main_executor обязательно для заполнения'
            });
        }
        
        // Проверяем существование заявки
        const checkSql = `SELECT status, comments, main_executor FROM tickets WHERE id = ${db.dbType === 'postgres' ? '$1' : '?'}`;
        const tickets = await db.query(checkSql, [ticketId]);
        
        if (tickets.length === 0) {
            return res.status(404).json({
                error: 'Заявка не найдена'
            });
        }
        
        const currentTicket = tickets[0];
        
        // Обновляем исполнителей
        const updates = {
            main_executor: main_executor.trim(),
            executor: executor ? executor.trim() : null,
            assigned_at: new Date().toISOString()
        };
        
        await db.updateTicketInfo(ticketId, updates);
        
        // Меняем статус на "назначена", если он еще "открыта"
        if (currentTicket.status === 'открыта') {
            await db.updateTicketStatus(ticketId, 'назначена');
        }
        
        // Добавляем комментарий
        if (comment && comment.trim() !== '') {
            const assignedBy = assigned_by || 'API Система';
            const newComments = (currentTicket.comments || '') + 
                `\n[Назначение через API от ${assignedBy}]: ${comment.trim()} (${new Date().toLocaleString()})`;
            await db.updateTicketInfo(ticketId, { comments: newComments });
        }
        
        // Получаем обновленную заявку
        const updatedSql = `SELECT * FROM tickets WHERE id = ${db.dbType === 'postgres' ? '$1' : '?'}`;
        const updatedTickets = await db.query(updatedSql, [ticketId]);
        
        res.json({
            success: true,
            message: 'Исполнитель успешно назначен',
            data: {
                ticket_id: ticketId,
                main_executor: main_executor,
                executor: executor,
                assigned_at: updates.assigned_at,
                assigned_by: assigned_by || 'API Система',
                ticket: updatedTickets[0]
            },
            meta: {
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('API Error assigning ticket:', error);
        res.status(500).json({
            error: 'Внутренняя ошибка сервера',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ========== ДОПОЛНИТЕЛЬНЫЕ МЕТОДЫ ==========

// Получение истории изменений статуса (упрощенная версия)
router.get('/tickets/:id/status/history', verifyApiKey, async (req, res) => {
    try {
        const ticketId = req.params.id;
        
        // В реальном приложении здесь нужно иметь таблицу для истории изменений
        // Для демонстрации вернем текущий статус и информацию из комментариев
        const sql = `
            SELECT 
                status,
                comments,
                assigned_at,
                in_progress_at,
                completed_at,
                archived_at,
                created_at
            FROM tickets 
            WHERE id = ${db.dbType === 'postgres' ? '$1' : '?'}
        `;
        
        const tickets = await db.query(sql, [ticketId]);
        
        if (tickets.length === 0) {
            return res.status(404).json({
                error: 'Заявка не найдена'
            });
        }
        
        const ticket = tickets[0];
        
        // Формируем историю из временных меток
        const history = [
            {
                status: 'создана',
                timestamp: ticket.created_at,
                type: 'creation'
            }
        ];
        
        if (ticket.assigned_at) {
            history.push({
                status: 'назначена',
                timestamp: ticket.assigned_at,
                type: 'assignment'
            });
        }
        
        if (ticket.in_progress_at) {
            history.push({
                status: 'в работе',
                timestamp: ticket.in_progress_at,
                type: 'progress'
            });
        }
        
        if (ticket.completed_at) {
            history.push({
                status: 'выполнена',
                timestamp: ticket.completed_at,
                type: 'completion'
            });
        }
        
        if (ticket.archived_at) {
            history.push({
                status: 'архив',
                timestamp: ticket.archived_at,
                type: 'archival'
            });
        }
        
        // Сортируем по времени
        history.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        res.json({
            success: true,
            data: {
                ticket_id: ticketId,
                current_status: ticket.status,
                history: history,
                comment_analysis: ticket.comments ? 'Комментарии содержат историю изменений' : 'Нет комментариев'
            },
            meta: {
                timestamp: new Date().toISOString(),
                note: 'Для полной истории необходима отдельная таблица статусов'
            }
        });
        
    } catch (error) {
        console.error('API Error getting status history:', error);
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
        
        res.json({
            success: true,
            data: {
                total_tickets: total,
                by_status: statusStats,
                by_problem_type: typeStats,
                status_options: validStatuses
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

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

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