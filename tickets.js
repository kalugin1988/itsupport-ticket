const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

// ========== КОНФИГУРАЦИЯ ПУТЕЙ ==========

const PUBLIC_DIR = path.join(__dirname, 'public');
const TICKETS_DIR = path.join(PUBLIC_DIR, 'tickets');
const TEMP_DIR = path.join(PUBLIC_DIR, 'temp_uploads');

// Создание необходимых директорий
function initUploadDirs() {
    [TICKETS_DIR, TEMP_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`Создана папка: ${dir}`);
        }
    });
}

// Инициализация при загрузке модуля
initUploadDirs();

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

// Получение пути к папке заявки
function getTicketUploadPath(ticketId, date = null) {
    const uploadDate = date ? new Date(date) : new Date();
    const dateFolder = uploadDate.toISOString().split('T')[0]; // ГГГГ-ММ-ДД
    const ticketPath = path.join(TICKETS_DIR, dateFolder, ticketId.toString());
    
    // Создаем структуру папок
    if (!fs.existsSync(ticketPath)) {
        fs.mkdirSync(ticketPath, { recursive: true });
    }
    
    return ticketPath;
}

// Получение относительного пути файла
function getRelativeFilePath(ticketId, filename, date = null) {
    const uploadDate = date ? new Date(date) : new Date();
    const dateFolder = uploadDate.toISOString().split('T')[0];
    return `/tickets/${dateFolder}/${ticketId}/${filename}`;
}

// Очистка временных файлов
function cleanupTempFiles(fileInfos) {
    if (!fileInfos) return;
    
    fileInfos.forEach(fileInfo => {
        const filePath = path.join(TEMP_DIR, fileInfo.filename);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (error) {
                console.error(`Ошибка удаления файла ${fileInfo.filename}:`, error);
            }
        }
    });
}

// Периодическая очистка старых временных файлов
function cleanupOldTempFiles() {
    try {
        if (!fs.existsSync(TEMP_DIR)) return;
        
        const files = fs.readdirSync(TEMP_DIR);
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;
        
        files.forEach(file => {
            const filePath = path.join(TEMP_DIR, file);
            try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > oneHour) {
                    fs.unlinkSync(filePath);
                }
            } catch (error) {
                console.error(`Ошибка при удалении ${file}:`, error);
            }
        });
        
        // Удаляем пустую папку
        if (fs.existsSync(TEMP_DIR) && fs.readdirSync(TEMP_DIR).length === 0) {
            fs.rmdirSync(TEMP_DIR);
        }
    } catch (error) {
        console.error('Ошибка при очистке временных файлов:', error);
    }
}

// Запускаем очистку каждые 30 минут
setInterval(cleanupOldTempFiles, 30 * 60 * 1000);

// ========== НАСТРОЙКА MULTER ДЛЯ ЗАГРУЗКИ ФАЙЛОВ ==========

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Используем временную папку
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }
        cb(null, TEMP_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        
        // Создаем безопасное имя файла
        const safeName = path.basename(file.originalname, ext)
            .replace(/[^a-z0-9]/gi, '_')
            .toLowerCase()
            .substring(0, 50);
            
        const filename = `${safeName}_${uniqueSuffix}${ext}`;
        
        // Сохраняем информацию о файле в запросе
        if (!req.uploadedFiles) req.uploadedFiles = [];
        req.uploadedFiles.push({
            originalname: file.originalname,
            filename: filename,
            size: file.size,
            mimetype: file.mimetype
        });
        
        cb(null, filename);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|bmp|pdf|doc|docx|xls|xlsx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
        cb(null, true);
    } else {
        cb(new Error('Недопустимый тип файла. Разрешены: изображения, PDF, документы'));
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
        files: 7 // Максимум 7 файлов
    },
    fileFilter: fileFilter
});

// ========== ОСНОВНЫЕ ФУНКЦИИ ==========

// Создание заявки
async function createTicket(req, res) {
    try {
        upload.array('files', 7)(req, res, async (err) => {
            if (err instanceof multer.MulterError) {
                cleanupTempFiles(req.uploadedFiles);
                
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ 
                        error: 'Размер файла превышает 50MB' 
                    });
                } else if (err.code === 'LIMIT_FILE_COUNT') {
                    return res.status(400).json({ 
                        error: 'Можно загрузить не более 7 файлов' 
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
            
            // Валидация обязательных полей
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
                
                // Получаем дату создания заявки
                const ticket = await db.getTicketById(ticketId);
                const createdDate = ticket.created_at;
                
                // Обработка файлов
                let movedFiles = [];
                if (req.uploadedFiles && req.uploadedFiles.length > 0) {
                    movedFiles = await moveFilesToTicketFolder(ticketId, req.uploadedFiles, createdDate);
                    
                    // Обновляем пути к файлам в БД
                    const filePaths = movedFiles.map(f => f.path);
                    await db.updateTicketFiles(ticketId, filePaths);
                    
                    console.log(`Загружено ${movedFiles.length} файлов для заявки #${ticketId}`);
                }
                
                // Обновляем контакты пользователя
                if (phone || email) {
                    await db.updateUserContacts(req.session.user.id, { 
                        phone: phone || '', 
                        email: email || '' 
                    });
                    
                    // Обновляем данные в сессии
                    req.session.user.contacts = { phone, email };
                }
                
                res.json({ 
                    success: true, 
                    ticketId, 
                    message: 'Заявка успешно создана',
                    files: movedFiles.length
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
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера' 
        });
    }
}

// Перемещение файлов в папку заявки
async function moveFilesToTicketFolder(ticketId, tempFiles, createdDate) {
    const ticketPath = getTicketUploadPath(ticketId, createdDate);
    const movedFiles = [];
    
    for (const fileInfo of tempFiles) {
        const oldPath = path.join(TEMP_DIR, fileInfo.filename);
        const newPath = path.join(ticketPath, fileInfo.filename);
        
        try {
            if (!fs.existsSync(oldPath)) {
                console.error(`Файл не найден: ${oldPath}`);
                continue;
            }
            
            // Перемещаем файл
            fs.renameSync(oldPath, newPath);
            
            // Сохраняем информацию о файле
            const relativePath = getRelativeFilePath(ticketId, fileInfo.filename, createdDate);
            movedFiles.push({
                name: fileInfo.originalname,
                path: relativePath,
                size: fileInfo.size,
                filename: fileInfo.filename
            });
            
        } catch (error) {
            console.error(`Ошибка при перемещении файла ${fileInfo.filename}:`, error);
        }
    }
    
    return movedFiles;
}

// Получение заявок пользователя
async function getMyTickets(req, res) {
    try {
        const tickets = await db.getUserTickets(req.session.user.id);
        
        // Обработка файлов
        const processedTickets = tickets.map(ticket => {
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
            
            // Форматирование дат
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
                created_at_formatted: formattedDate,
                status_text: getStatusText(ticket.status)
            };
        });
        
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
        
        // Проверка прав доступа
        const isOwner = ticket.user_id === req.session.user.id;
        const isAdmin = req.session.user.role === 'admin';
        
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: 'Нет доступа к этой заявке' });
        }
        
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
        
        // Форматирование дат
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

// Обновление заявки
async function updateTicket(req, res) {
    try {
        const ticketId = req.params.id;
        const { description, comments } = req.body;
        
        // Получаем текущую заявку
        const ticket = await db.getTicketById(ticketId, req.session.user.id);
        
        if (!ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        // Проверка прав на редактирование
        const canEdit = ticket.user_id === req.session.user.id && 
                       ['открыта', 'требует уточнения'].includes(ticket.status);
        
        if (!canEdit) {
            return res.status(403).json({ 
                error: 'Заявку нельзя редактировать в текущем статусе' 
            });
        }
        
        // Обновляем заявку
        await db.updateTicketInfo(ticketId, { description, comments });
        
        res.json({ 
            success: true, 
            message: 'Заявка обновлена',
            ticketId 
        });
        
    } catch (error) {
        console.error('Update ticket error:', error);
        res.status(500).json({ 
            error: 'Ошибка при обновлении заявки' 
        });
    }
}

// Добавление файлов к заявке
async function addFilesToTicket(req, res) {
    try {
        const ticketId = req.params.id;
        
        upload.array('files', 7)(req, res, async (err) => {
            if (err) {
                cleanupTempFiles(req.uploadedFiles);
                return res.status(400).json({ 
                    error: err.message || 'Ошибка загрузки файлов' 
                });
            }
            
            try {
                // Получаем текущую заявку
                const ticket = await db.getTicketById(ticketId, req.session.user.id);
                
                if (!ticket) {
                    cleanupTempFiles(req.uploadedFiles);
                    return res.status(404).json({ error: 'Заявка не найдена' });
                }
                
                // Проверка прав
                const isOwner = ticket.user_id === req.session.user.id;
                const isAdmin = req.session.user.role === 'admin';
                
                if (!isOwner && !isAdmin) {
                    cleanupTempFiles(req.uploadedFiles);
                    return res.status(403).json({ error: 'Нет доступа к этой заявке' });
                }
                
                // Получаем существующие файлы
                let existingFiles = [];
                if (ticket.files) {
                    if (typeof ticket.files === 'string') {
                        try {
                            existingFiles = JSON.parse(ticket.files);
                        } catch (e) {
                            existingFiles = [];
                        }
                    } else {
                        existingFiles = ticket.files;
                    }
                }
                
                // Проверяем лимит файлов
                if (existingFiles.length + (req.uploadedFiles?.length || 0) > 7) {
                    cleanupTempFiles(req.uploadedFiles);
                    return res.status(400).json({ 
                        error: `Максимум 7 файлов. Уже загружено: ${existingFiles.length}` 
                    });
                }
                
                // Перемещаем файлы
                let newFiles = [];
                if (req.uploadedFiles && req.uploadedFiles.length > 0) {
                    newFiles = await moveFilesToTicketFolder(ticketId, req.uploadedFiles, ticket.created_at);
                    
                    // Объединяем файлы
                    const newFilePaths = newFiles.map(f => f.path);
                    const allFiles = [...existingFiles, ...newFilePaths];
                    
                    // Обновляем БД
                    await db.updateTicketFiles(ticketId, allFiles);
                }
                
                res.json({ 
                    success: true, 
                    message: 'Файлы успешно добавлены',
                    added: newFiles.length,
                    totalFiles: existingFiles.length + newFiles.length
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
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера' 
        });
    }
}

// Удаление файла из заявки
async function deleteTicketFile(req, res) {
    try {
        const { ticketId, filename } = req.params;
        
        // Получаем заявку
        const ticket = await db.getTicketById(ticketId, req.session.user.id);
        
        if (!ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        // Проверка прав
        const isOwner = ticket.user_id === req.session.user.id;
        const isAdmin = req.session.user.role === 'admin';
        
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: 'Нет доступа к этой заявке' });
        }
        
        // Получаем текущие файлы
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
        
        // Находим и удаляем файл
        const fileIndex = files.findIndex(f => f.includes(filename));
        if (fileIndex === -1) {
            return res.status(404).json({ error: 'Файл не найден' });
        }
        
        // Удаляем физический файл
        const filePath = files[fileIndex];
        const fullPath = path.join(PUBLIC_DIR, filePath.substring(1)); // Убираем первый /
        
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
        
        // Удаляем из списка
        files.splice(fileIndex, 1);
        
        // Обновляем БД
        await db.updateTicketFiles(ticketId, files);
        
        res.json({ 
            success: true, 
            message: 'Файл удален',
            remainingFiles: files.length
        });
        
    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({ 
            error: 'Ошибка при удалении файла' 
        });
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
        res.status(500).json({ 
            error: 'Ошибка при получении типов проблем' 
        });
    }
}

// Получение списка кабинетов
async function getCabinets(req, res) {
    try {
        const cabinets = await db.getCabinets();
        res.json(cabinets);
    } catch (error) {
        console.error('Get cabinets error:', error);
        res.status(500).json({ 
            error: 'Ошибка при получении списка кабинетов' 
        });
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
        res.status(500).json({ 
            error: 'Ошибка при добавлении кабинета' 
        });
    }
}

// Получение контактов пользователя
async function getUserContacts(req, res) {
    try {
        const contacts = await db.getUserContacts(req.session.user.id);
        res.json(contacts || { phone: '', email: '' });
    } catch (error) {
        console.error('Get user contacts error:', error);
        res.status(500).json({ 
            error: 'Ошибка при получении контактов' 
        });
    }
}

// ========== АДМИНИСТРАТИВНЫЕ ФУНКЦИИ ==========

// Получение всех заявок
async function getAllTickets(req, res) {
    try {
        const tickets = await db.getAllTickets();
        
        // Обработка и форматирование
        const processedTickets = tickets.map(ticket => {
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
                created_at_formatted: formattedDate,
                user_info: ticket.user_full_name || `Пользователь #${ticket.user_id}`,
                status_text: getStatusText(ticket.status)
            };
        });
        
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
        
        // Получаем текущую заявку
        const ticket = await db.getTicketById(ticketId);
        if (!ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        // Обновляем статус
        await db.updateTicketStatus(ticketId, status);
        
        // Добавляем комментарий
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
        res.status(500).json({ 
            error: 'Ошибка при обновлении статуса' 
        });
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
        
        // Получаем текущую заявку
        const ticket = await db.getTicketById(ticketId);
        if (!ticket) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        // Обновляем исполнителей
        const updates = {
            main_executor: main_executor.trim(),
            executor: executor ? executor.trim() : null,
            assigned_at: new Date().toISOString()
        };
        
        await db.updateTicketInfo(ticketId, updates);
        
        // Меняем статус при необходимости
        if (ticket.status === 'открыта') {
            await db.updateTicketStatus(ticketId, 'назначена');
        }
        
        // Добавляем комментарий
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
        res.status(500).json({ 
            error: 'Ошибка при назначении исполнителя' 
        });
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

module.exports = {
    // Основные функции
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
    getUserContacts,
    
    // Административные функции
    getAllTickets,
    updateTicketStatus,
    assignTicket
};