const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const fsService = require('./fs-service');

// ========== КОНФИГУРАЦИЯ ПУТЕЙ ==========

const PUBLIC_DIR = path.join(__dirname, 'public');
const TEMP_DIR = path.join(PUBLIC_DIR, 'temp_uploads');

// Создание необходимых директорий
function initUploadDirs() {
    [TEMP_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`Создана папка: ${dir}`);
        }
    });
}

// Инициализация при загрузке модуля
initUploadDirs();

// ========== НАСТРОЙКА MULTER ДЛЯ ЗАГРУЗКИ ФАЙЛОВ ==========

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }
        cb(null, TEMP_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        
        const safeName = path.basename(file.originalname, ext)
            .replace(/[^a-z0-9]/gi, '_')
            .toLowerCase()
            .substring(0, 50);
            
        const filename = `${safeName}_${uniqueSuffix}${ext}`;
        
        if (!req.uploadedFiles) req.uploadedFiles = [];
        req.uploadedFiles.push({
            originalname: file.originalname,
            filename: filename,
            size: file.size,
            mimetype: file.mimetype,
            path: path.join(TEMP_DIR, filename)
        });
        
        cb(null, filename);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|bmp|pdf|doc|docx|xls|xlsx|txt|zip|rar|7z/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
        cb(null, true);
    } else {
        cb(new Error('Недопустимый тип файла'));
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB
        files: 10 // Максимум 10 файлов
    },
    fileFilter: fileFilter
});

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

// Очистка временных файлов
function cleanupTempFiles(fileInfos) {
    if (!fileInfos) return;
    
    fileInfos.forEach(fileInfo => {
        if (fileInfo.path && fs.existsSync(fileInfo.path)) {
            try {
                fs.unlinkSync(fileInfo.path);
            } catch (error) {
                console.error(`Ошибка удаления файла ${fileInfo.filename}:`, error);
            }
        }
    });
}

// Форматирование информации о файле для БД
function formatFileInfoForDB(fsFiles) {
    return fsFiles
        .filter(file => file.success)
        .map(file => ({
            fileNumber: file.fileNumber,
            fileName: file.fileName,
            originalName: file.originalName,
            size: file.size,
            uploadedAt: file.uploadedAt,
            url: file.url,
            downloadUrl: file.downloadUrl
        }));
}

// Получение файлов для заявки
async function getFilesForTicket(ticketId, userId) {
    try {
        const ticket = await db.getTicketById(ticketId, userId);
        if (!ticket || !ticket.files) return [];
        
        let files = [];
        if (typeof ticket.files === 'string') {
            try {
                files = JSON.parse(ticket.files);
            } catch (e) {
                files = [];
            }
        } else {
            files = ticket.files;
        }
        
        return files;
    } catch (error) {
        console.error('Ошибка получения файлов:', error);
        return [];
    }
}

// ========== ОСНОВНЫЕ ФУНКЦИИ ==========

// Создание заявки с загрузкой файлов в FS
async function createTicket(req, res) {
    try {
        upload.array('files', 10)(req, res, async (err) => {
            if (err instanceof multer.MulterError) {
                cleanupTempFiles(req.uploadedFiles);
                
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ 
                        error: 'Размер файла превышает 100MB' 
                    });
                } else if (err.code === 'LIMIT_FILE_COUNT') {
                    return res.status(400).json({ 
                        error: 'Можно загрузить не более 10 файлов' 
                    });
                } else {
                    return res.status(400).json({ 
                        error: `Ошибка загрузки файла: ${err.message}` 
                    });
                }
            } else if (err) {
                cleanupTempFiles(req.uploadedFiles);
                return res.status(400).json({ 
                    error: err.message 
                });
            }
            
            const { 
                problem_type_id, 
                cabinet, 
                phone, 
                email, 
                description, 
                comments 
            } = req.body;
            
            // Валидация
            const errors = [];
            if (!problem_type_id) errors.push('Тип проблемы');
            if (!cabinet) errors.push('Номер кабинета');
            if (!description) errors.push('Описание проблемы');
            
            if (errors.length > 0) {
                cleanupTempFiles(req.uploadedFiles);
                return res.status(400).json({ 
                    error: `Заполните обязательные поля: ${errors.join(', ')}` 
                });
            }
            
            try {
                // Создаем заявку в БД
                const ticketData = {
                    user_id: req.session.user.id,
                    problem_type_id,
                    cabinet,
                    phone: phone || null,
                    email: email || null,
                    description,
                    comments: comments || null,
                    files: []
                };
                
                const ticketId = await db.createTicket(ticketData);
                console.log(`Создана заявка #${ticketId} пользователем ${req.session.user.login}`);
                
                let uploadedFiles = [];
                
                // Загружаем файлы в FS
                if (req.uploadedFiles && req.uploadedFiles.length > 0) {
                    const uploadResults = await fsService.uploadFiles(
                        req.uploadedFiles,
                        req.session.user.id,
                        ticketId
                    );
                    
                    // Формируем информацию о файлах для БД
                    uploadedFiles = formatFileInfoForDB(uploadResults);
                    
                    // Обновляем заявку в БД с информацией о файлах
                    await db.updateTicketFiles(ticketId, uploadedFiles);
                    
                    console.log(`Загружено ${uploadedFiles.length} файлов в FS для заявки #${ticketId}`);
                }
                
                // Обновляем контакты пользователя
                if (phone || email) {
                    await db.updateUserContacts(req.session.user.id, { 
                        phone: phone || '', 
                        email: email || '' 
                    });
                    req.session.user.contacts = { phone, email };
                }
                
                // Очищаем временные файлы
                cleanupTempFiles(req.uploadedFiles);
                
                res.json({ 
                    success: true, 
                    ticketId, 
                    message: 'Заявка успешно создана',
                    files: uploadedFiles.length,
                    uploadedFiles: uploadedFiles
                });
                
            } catch (dbError) {
                console.error('Database error:', dbError);
                cleanupTempFiles(req.uploadedFiles);
                res.status(500).json({ 
                    error: 'Ошибка при создании заявки',
                    details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
                });
            }
        });
    } catch (error) {
        console.error('Create ticket error:', error);
        cleanupTempFiles(req.uploadedFiles);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера' 
        });
    }
}

// Получение заявок пользователя
async function getMyTickets(req, res) {
    try {
        const tickets = await db.getUserTickets(req.session.user.id);
        
        const processedTickets = await Promise.all(tickets.map(async (ticket) => {
            const files = await getFilesForTicket(ticket.id, req.session.user.id);
            
            const createdDate = new Date(ticket.created_at);
            const formattedDate = createdDate.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            return {
                ...ticket,
                files,
                fileCount: files.length,
                created_at_formatted: formattedDate,
                status_text: getStatusText(ticket.status)
            };
        }));
        
        res.json(processedTickets);
    } catch (error) {
        console.error('Get tickets error:', error);
        res.status(500).json({ 
            error: 'Ошибка при получении заявок' 
        });
    }
}

// Получение заявки по ID
async function getTicketById(req, res) {
    try {
        const ticketId = req.params.id;
        const ticket = await db.getTicketById(ticketId, req.session.user.id);
        
        if (!ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        const isOwner = ticket.user_id === req.session.user.id;
        const isAdmin = req.session.user.role === 'admin';
        
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: 'Нет доступа к этой заявке' });
        }
        
        const files = await getFilesForTicket(ticketId, req.session.user.id);
        
        const formatDateTime = (dateString) => {
            if (!dateString) return null;
            const date = new Date(dateString);
            return date.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        };
        
        const processedTicket = {
            ...ticket,
            files,
            fileCount: files.length,
            created_at_formatted: formatDateTime(ticket.created_at),
            assigned_at_formatted: formatDateTime(ticket.assigned_at),
            in_progress_at_formatted: formatDateTime(ticket.in_progress_at),
            completed_at_formatted: formatDateTime(ticket.completed_at),
            status_text: getStatusText(ticket.status),
            can_edit: isOwner && ['открыта', 'требует уточнения'].includes(ticket.status)
        };
        
        res.json(processedTicket);
    } catch (error) {
        console.error('Get ticket error:', error);
        res.status(500).json({ 
            error: 'Ошибка при получении заявки' 
        });
    }
}

// Добавление файлов к существующей заявке
async function addFilesToTicket(req, res) {
    try {
        const ticketId = req.params.id;
        
        upload.array('files', 10)(req, res, async (err) => {
            if (err) {
                cleanupTempFiles(req.uploadedFiles);
                return res.status(400).json({ 
                    error: err.message || 'Ошибка загрузки файлов' 
                });
            }
            
            try {
                const ticket = await db.getTicketById(ticketId, req.session.user.id);
                
                if (!ticket) {
                    cleanupTempFiles(req.uploadedFiles);
                    return res.status(404).json({ error: 'Заявка не найдена' });
                }
                
                const isOwner = ticket.user_id === req.session.user.id;
                const isAdmin = req.session.user.role === 'admin';
                
                if (!isOwner && !isAdmin) {
                    cleanupTempFiles(req.uploadedFiles);
                    return res.status(403).json({ error: 'Нет доступа к этой заявке' });
                }
                
                const existingFiles = await getFilesForTicket(ticketId, req.session.user.id);
                
                if (existingFiles.length + (req.uploadedFiles?.length || 0) > 10) {
                    cleanupTempFiles(req.uploadedFiles);
                    return res.status(400).json({ 
                        error: `Максимум 10 файлов. Уже загружено: ${existingFiles.length}` 
                    });
                }
                
                let newFiles = [];
                if (req.uploadedFiles && req.uploadedFiles.length > 0) {
                    const uploadResults = await fsService.uploadFiles(
                        req.uploadedFiles,
                        req.session.user.id,
                        ticketId
                    );
                    
                    newFiles = formatFileInfoForDB(uploadResults);
                    const allFiles = [...existingFiles, ...newFiles];
                    
                    await db.updateTicketFiles(ticketId, allFiles);
                }
                
                cleanupTempFiles(req.uploadedFiles);
                
                res.json({ 
                    success: true, 
                    message: 'Файлы успешно добавлены',
                    added: newFiles.length,
                    totalFiles: existingFiles.length + newFiles.length,
                    newFiles: newFiles
                });
                
            } catch (error) {
                console.error('Add files error:', error);
                cleanupTempFiles(req.uploadedFiles);
                res.status(500).json({ 
                    error: 'Ошибка при добавлении файлов' 
                });
            }
        });
        
    } catch (error) {
        console.error('Add files to ticket error:', error);
        cleanupTempFiles(req.uploadedFiles);
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера' 
        });
    }
}

// Удаление файла из заявки
async function deleteTicketFile(req, res) {
    try {
        const { ticketId, fileNumber } = req.params;
        
        const ticket = await db.getTicketById(ticketId, req.session.user.id);
        
        if (!ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        const isOwner = ticket.user_id === req.session.user.id;
        const isAdmin = req.session.user.role === 'admin';
        
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: 'Нет доступа к этой заявке' });
        }
        
        const existingFiles = await getFilesForTicket(ticketId, req.session.user.id);
        const fileIndex = existingFiles.findIndex(f => f.fileNumber === fileNumber);
        
        if (fileIndex === -1) {
            return res.status(404).json({ error: 'Файл не найден в заявке' });
        }
        
        // Удаляем файл из FS
        const deleteResult = await fsService.deleteFile(fileNumber);
        if (!deleteResult.success) {
            return res.status(500).json({ 
                error: 'Не удалось удалить файл из хранилища',
                details: deleteResult.error
            });
        }
        
        // Удаляем файл из списка в БД
        existingFiles.splice(fileIndex, 1);
        await db.updateTicketFiles(ticketId, existingFiles);
        
        res.json({ 
            success: true, 
            message: 'Файл удален',
            fileNumber: fileNumber,
            remainingFiles: existingFiles.length
        });
        
    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({ 
            error: 'Ошибка при удалении файла' 
        });
    }
}

// Обновление заявки
async function updateTicket(req, res) {
    try {
        const ticketId = req.params.id;
        const { description, comments } = req.body;
        
        const ticket = await db.getTicketById(ticketId, req.session.user.id);
        if (!ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        const canEdit = ticket.user_id === req.session.user.id && 
                       ['открыта', 'требует уточнения'].includes(ticket.status);
        
        if (!canEdit) {
            return res.status(403).json({ 
                error: 'Заявку нельзя редактировать в текущем статусе' 
            });
        }
        
        await db.updateTicketInfo(ticketId, { description, comments });
        
        res.json({ 
            success: true, 
            message: 'Заявка обновлена',
            ticketId 
        });
        
    } catch (error) {
        console.error('Update ticket error:', error);
        res.status(500).json({ error: 'Ошибка при обновлении заявки' });
    }
}

// ========== АДМИНИСТРАТИВНЫЕ ФУНКЦИИ ==========

// Получение всех заявок
async function getAllTickets(req, res) {
    try {
        const tickets = await db.getAllTickets();
        
        const processedTickets = await Promise.all(tickets.map(async (ticket) => {
            const files = await getFilesForTicket(ticket.id, ticket.user_id);
            
            const createdDate = new Date(ticket.created_at);
            const formattedDate = createdDate.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            return {
                ...ticket,
                files,
                fileCount: files.length,
                created_at_formatted: formattedDate,
                user_info: ticket.user_full_name || `Пользователь #${ticket.user_id}`,
                status_text: getStatusText(ticket.status)
            };
        }));
        
        res.json(processedTickets);
    } catch (error) {
        console.error('Get all tickets error:', error);
        res.status(500).json({ 
            error: 'Ошибка при получении заявок' 
        });
    }
}

// Обновление статуса заявки
async function updateTicketStatus(req, res) {
    try {
        const ticketId = req.params.id;
        const { status, comment } = req.body;
        
        const validStatuses = [
            'открыта', 'в работе', 'назначена', 'требует уточнения', 
            'отложена', 'выполнена', 'закрыта', 'отказана', 'архив'
        ];
        
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ 
                error: `Неверный статус. Допустимые значения: ${validStatuses.join(', ')}` 
            });
        }
        
        const ticket = await db.getTicketById(ticketId);
        if (!ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        await db.updateTicketStatus(ticketId, status);
        
        if (comment && comment.trim() !== '') {
            const currentComments = ticket.comments || '';
            const adminComment = `\n[Админ ${req.session.user.full_name}]: ${comment.trim()} (${new Date().toLocaleString()})`;
            const newComments = currentComments + adminComment;
            await db.updateTicketInfo(ticketId, { comments: newComments });
        }
        
        console.log(`Статус заявки #${ticketId} изменен на "${status}" администратором ${req.session.user.login}`);
        
        res.json({ 
            success: true, 
            message: 'Статус обновлен',
            ticketId,
            status 
        });
        
    } catch (error) {
        console.error('Update ticket status error:', error);
        res.status(500).json({ error: 'Ошибка при обновлении статуса' });
    }
}

// Назначение исполнителя
async function assignTicket(req, res) {
    try {
        const ticketId = req.params.id;
        const { main_executor, executor, comment } = req.body;
        
        if (!main_executor || main_executor.trim() === '') {
            return res.status(400).json({ error: 'Главный исполнитель обязателен' });
        }
        
        const ticket = await db.getTicketById(ticketId);
        if (!ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        const updates = {
            main_executor: main_executor.trim(),
            executor: executor ? executor.trim() : null,
            assigned_at: new Date().toISOString()
        };
        
        await db.updateTicketInfo(ticketId, updates);
        
        if (ticket.status === 'открыта') {
            await db.updateTicketStatus(ticketId, 'назначена');
        }
        
        if (comment && comment.trim() !== '') {
            const currentComments = ticket.comments || '';
            const assignComment = `\n[Назначение от ${req.session.user.full_name}]: ${comment.trim()} (${new Date().toLocaleString()})`;
            const newComments = currentComments + assignComment;
            await db.updateTicketInfo(ticketId, { comments: newComments });
        }
        
        console.log(`Исполнитель назначен для заявки #${ticketId}: ${main_executor}`);
        
        res.json({ 
            success: true, 
            message: 'Исполнитель назначен',
            ticketId,
            main_executor: updates.main_executor,
            executor: updates.executor
        });
        
    } catch (error) {
        console.error('Assign ticket error:', error);
        res.status(500).json({ error: 'Ошибка при назначении исполнителя' });
    }
}

// ========== СПРАВОЧНИКИ ==========

// Получение типов проблем
async function getProblemTypes(req, res) {
    try {
        const types = await db.getProblemTypes();
        res.json(types);
    } catch (error) {
        console.error('Get problem types error:', error);
        res.status(500).json({ error: 'Ошибка при получении типов проблем' });
    }
}

// Получение списка кабинетов
async function getCabinets(req, res) {
    try {
        const cabinets = await db.getCabinets();
        res.json(cabinets);
    } catch (error) {
        console.error('Get cabinets error:', error);
        res.status(500).json({ error: 'Ошибка при получении списка кабинетов' });
    }
}

// Добавление нового кабинета
async function addCabinet(req, res) {
    try {
        const { number } = req.body;
        
        if (!number || number.trim() === '') {
            return res.status(400).json({ error: 'Номер кабинета обязателен' });
        }
        
        const cleanNumber = number.trim();
        await db.addCabinet(cleanNumber, req.session.user.id);
        
        res.json({ 
            success: true, 
            message: 'Кабинет добавлен',
            cabinet: { number: cleanNumber }
        });
        
    } catch (error) {
        console.error('Add cabinet error:', error);
        res.status(500).json({ error: 'Ошибка при добавлении кабинета' });
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function getStatusText(status) {
    const statusMap = {
        'открыта': 'Открыта',
        'в работе': 'В работе',
        'назначена': 'Назначена',
        'требует уточнения': 'Требует уточнения',
        'отложена': 'Отложена',
        'выполнена': 'Выполнена',
        'закрыта': 'Закрыта',
        'отказана': 'Отказана',
        'архив': 'Архив'
    };
    
    return statusMap[status] || status;
}

// Функция для получения информации о файловом сервисе
async function getFileServiceStatus(req, res) {
    try {
        const status = await fsService.checkConnection();
        res.json(status);
    } catch (error) {
        res.status(500).json({ 
            connected: false, 
            error: error.message 
        });
    }
}

module.exports = {
    createTicket,
    getMyTickets,
    getTicketById,
    updateTicket,
    addFilesToTicket,
    deleteTicketFile,
    
    // Справочники
    getProblemTypes,
    getCabinets,
    addCabinet,
    
    // Административные функции
    getAllTickets,
    updateTicketStatus,
    assignTicket,
    
    // Функция для получения информации о файловом сервисе
    getFileServiceStatus
};