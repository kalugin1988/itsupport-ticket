const fs = require('fs');
const path = require('path');

let db;
let dbType;

async function init() {
    // Проверяем наличие переменных окружения для PostgreSQL
    if (process.env.PG_HOST && process.env.PG_USER && process.env.PG_PASSWORD) {
        await initPostgres();
        dbType = 'postgres';
    } else {
        await initSQLite();
        dbType = 'sqlite';
    }
    await createTables();
    console.log(`Используется база данных: ${dbType === 'postgres' ? 'PostgreSQL' : 'SQLite'}`);
}

async function initPostgres() {
    const { Client, Pool } = require('pg');
    const databaseName = process.env.PG_DATABASE || 'itsupport';
    
    console.log('Попытка подключения к PostgreSQL...');
    
    // Сначала пробуем подключиться к существующей базе данных
    const pool = new Pool({
        host: process.env.PG_HOST,
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        database: databaseName,
        port: process.env.PG_PORT || 5432,
    });
    
    try {
        await pool.query('SELECT NOW()');
        console.log(`Подключение к PostgreSQL (${databaseName}) успешно`);
        db = pool;
        return;
    } catch (error) {
        console.log(`База данных ${databaseName} не найдена, пытаемся создать...`);
    }
    
    // Если база не найдена, пытаемся создать ее
    const adminClient = new Client({
        host: process.env.PG_HOST,
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        database: 'postgres',
        port: process.env.PG_PORT || 5432,
    });
    
    try {
        await adminClient.connect();
        
        // Создаем базу данных
        await adminClient.query(`CREATE DATABASE ${databaseName}`);
        console.log(`База данных ${databaseName} создана`);
        await adminClient.end();
        
        // Подключаемся к созданной базе
        const newPool = new Pool({
            host: process.env.PG_HOST,
            user: process.env.PG_USER,
            password: process.env.PG_PASSWORD,
            database: databaseName,
            port: process.env.PG_PORT || 5432,
        });
        
        await newPool.query('SELECT NOW()');
        console.log(`Подключение к созданной базе ${databaseName} успешно`);
        db = newPool;
        
    } catch (createError) {
        console.error('Не удалось создать базу данных PostgreSQL:', createError);
        console.log('Переключаемся на SQLite...');
        await initSQLite();
        dbType = 'sqlite';
    }
}

async function initSQLite() {
    const sqlite3 = require('sqlite3').verbose();
    
    // Создаем папку data, если ее нет
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const dbPath = path.join(dataDir, 'itsupport.db');
    
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Ошибка подключения к SQLite:', err);
                reject(err);
            } else {
                console.log(`Подключение к SQLite успешно: ${dbPath}`);
                // Включаем поддержку foreign keys
                db.run('PRAGMA foreign_keys = ON', (err) => {
                    if (err) console.error('Ошибка включения foreign keys:', err);
                });
                // Включаем кэширование для лучшей производительности
                db.run('PRAGMA cache_size = 10000');
                resolve();
            }
        });
    });
}

async function query(sql, params = []) {
    if (dbType === 'postgres') {
        try {
            const result = await db.query(sql, params);
            return result.rows;
        } catch (error) {
            console.error('PostgreSQL ошибка запроса:', error);
            console.error('SQL:', sql);
            console.error('Параметры:', params);
            throw error;
        }
    } else {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('SQLite ошибка запроса:', err);
                    console.error('SQL:', sql);
                    console.error('Параметры:', params);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
}

async function run(sql, params = []) {
    if (dbType === 'postgres') {
        try {
            const result = await db.query(sql, params);
            return {
                lastID: result.rows[0] ? result.rows[0].id : null,
                changes: result.rowCount
            };
        } catch (error) {
            console.error('PostgreSQL ошибка выполнения:', error);
            console.error('SQL:', sql);
            console.error('Параметры:', params);
            throw error;
        }
    } else {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function(err) {
                if (err) {
                    console.error('SQLite ошибка выполнения:', err);
                    console.error('SQL:', sql);
                    console.error('Параметры:', params);
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }
}

async function createTables() {
    console.log('Создание таблиц...');
    
    try {
        // Таблица пользователей
        if (dbType === 'postgres') {
            await run(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    login VARCHAR(100) UNIQUE NOT NULL,
                    full_name VARCHAR(200),
                    ldap_groups TEXT[],
                    role VARCHAR(50) DEFAULT 'user',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
        } else {
            await run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    login VARCHAR(100) UNIQUE NOT NULL,
                    full_name VARCHAR(200),
                    ldap_groups TEXT,
                    role VARCHAR(50) DEFAULT 'user',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
        }

        // Таблица типов проблем
        await run(`
            CREATE TABLE IF NOT EXISTS problem_types (
                id ${dbType === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
                name VARCHAR(100) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица кабинетов
        await run(`
            CREATE TABLE IF NOT EXISTS cabinets (
                id ${dbType === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
                number VARCHAR(20) UNIQUE NOT NULL,
                added_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица контактов пользователей
        await run(`
            CREATE TABLE IF NOT EXISTS user_contacts (
                id ${dbType === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
                user_id INTEGER,
                phone VARCHAR(50),
                email VARCHAR(100),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id)
            )
        `);

        // Таблица заявок
        if (dbType === 'postgres') {
            await run(`
                CREATE TABLE IF NOT EXISTS tickets (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER,
                    problem_type_id INTEGER,
                    cabinet VARCHAR(50) NOT NULL,
                    phone VARCHAR(50),
                    email VARCHAR(100),
                    description TEXT NOT NULL,
                    comments TEXT,
                    status VARCHAR(50) DEFAULT 'открыта',
                    main_executor VARCHAR(100),
                    executor VARCHAR(100),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    assigned_at TIMESTAMP,
                    in_progress_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    archived_at TIMESTAMP,
                    files TEXT[]
                )
            `);
        } else {
            await run(`
                CREATE TABLE IF NOT EXISTS tickets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    problem_type_id INTEGER,
                    cabinet VARCHAR(50) NOT NULL,
                    phone VARCHAR(50),
                    email VARCHAR(100),
                    description TEXT NOT NULL,
                    comments TEXT,
                    status VARCHAR(50) DEFAULT 'открыта',
                    main_executor VARCHAR(100),
                    executor VARCHAR(100),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    assigned_at TIMESTAMP,
                    in_progress_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    archived_at TIMESTAMP,
                    files TEXT
                )
            `);
        }

        // Добавляем начальные типы проблем
        const defaultProblemTypes = [
            'компьютер', 'принтер', 'проектор', 'интернет', 
            'электронный дневник', 'интерактивная панель', 
            'авторизация в пк', 'авторизация в школьных сервисах'
        ];
        
        for (const type of defaultProblemTypes) {
            if (dbType === 'postgres') {
                await run(`
                    INSERT INTO problem_types (name) VALUES ($1)
                    ON CONFLICT (name) DO NOTHING
                `, [type]);
            } else {
                await run(`
                    INSERT OR IGNORE INTO problem_types (name) VALUES (?)
                `, [type]);
            }
        }

        console.log('Таблицы созданы успешно');
    } catch (error) {
        console.error('Ошибка создания таблиц:', error);
        throw error;
    }
}

// ========== ФУНКЦИИ ДЛЯ РАБОТЫ С ПОЛЬЗОВАТЕЛЯМИ ==========

async function getUserByLogin(login) {
    const users = await query('SELECT * FROM users WHERE login = $1', [login]);
    return users[0];
}

async function getUserById(id) {
    const users = await query('SELECT * FROM users WHERE id = $1', [id]);
    return users[0];
}

async function createUser(user) {
    const { login, full_name, ldap_groups, role } = user;
    
    if (dbType === 'postgres') {
        const sql = `
            INSERT INTO users (login, full_name, ldap_groups, role) 
            VALUES ($1, $2, $3, $4) 
            ON CONFLICT (login) DO UPDATE SET 
            full_name = EXCLUDED.full_name, 
            ldap_groups = EXCLUDED.ldap_groups, 
            role = EXCLUDED.role, 
            updated_at = CURRENT_TIMESTAMP 
            RETURNING *
        `;
        const result = await query(sql, [login, full_name, ldap_groups, role]);
        return result[0];
    } else {
        const groupsStr = JSON.stringify(ldap_groups);
        const sql = `
            INSERT INTO users (login, full_name, ldap_groups, role) 
            VALUES (?, ?, ?, ?) 
            ON CONFLICT(login) DO UPDATE SET 
            full_name = excluded.full_name, 
            ldap_groups = excluded.ldap_groups, 
            role = excluded.role, 
            updated_at = CURRENT_TIMESTAMP
        `;
        await run(sql, [login, full_name, groupsStr, role]);
        return await getUserByLogin(login);
    }
}

// ========== ФУНКЦИИ ДЛЯ РАБОТЫ С ЗАЯВКАМИ ==========

async function createTicket(ticket) {
    let filesStr;
    if (dbType === 'postgres') {
        filesStr = ticket.files || [];
        const sql = `
            INSERT INTO tickets (
                user_id, problem_type_id, cabinet, phone, email, 
                description, comments, files
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        `;
        
        const result = await query(sql, [
            ticket.user_id, ticket.problem_type_id, ticket.cabinet,
            ticket.phone, ticket.email, ticket.description,
            ticket.comments, filesStr
        ]);
        
        return result[0].id;
    } else {
        filesStr = ticket.files ? JSON.stringify(ticket.files) : null;
        const sql = `
            INSERT INTO tickets (
                user_id, problem_type_id, cabinet, phone, email, 
                description, comments, files
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const result = await run(sql, [
            ticket.user_id, ticket.problem_type_id, ticket.cabinet,
            ticket.phone, ticket.email, ticket.description,
            ticket.comments, filesStr
        ]);
        
        return result.lastID;
    }
}

async function getTicketById(id, userId = null) {
    let sql = `
        SELECT t.*, p.name as problem_type_name, u.full_name as user_full_name, u.login as user_login
        FROM tickets t
        LEFT JOIN problem_types p ON t.problem_type_id = p.id
        LEFT JOIN users u ON t.user_id = u.id
        WHERE t.id = ${dbType === 'postgres' ? '$1' : '?'}
    `;
    
    const params = [id];
    
    if (userId) {
        sql += ` AND t.user_id = ${dbType === 'postgres' ? '$2' : '?'}`;
        params.push(userId);
    }
    
    const tickets = await query(sql, params);
    return tickets[0];
}

async function getUserTickets(userId) {
    const sql = `
        SELECT t.*, p.name as problem_type_name
        FROM tickets t
        LEFT JOIN problem_types p ON t.problem_type_id = p.id
        WHERE t.user_id = ${dbType === 'postgres' ? '$1' : '?'} 
        AND t.status != 'архив'
        ORDER BY t.created_at DESC
    `;
    return await query(sql, [userId]);
}

async function getAllTickets() {
    const sql = `
        SELECT t.*, p.name as problem_type_name, 
               u.full_name as user_full_name, u.login as user_login
        FROM tickets t
        LEFT JOIN problem_types p ON t.problem_type_id = p.id
        LEFT JOIN users u ON t.user_id = u.id
        WHERE t.status != 'архив'
        ORDER BY t.created_at DESC
    `;
    return await query(sql);
}

async function updateTicketStatus(id, status) {
    const updates = { status };
    const timestampColumns = {
        'в работе': 'in_progress_at',
        'назначена': 'assigned_at',
        'выполнена': 'completed_at',
        'закрыта': 'completed_at',
        'архив': 'archived_at'
    };
    
    if (timestampColumns[status]) {
        updates[timestampColumns[status]] = new Date().toISOString();
    }
    
    let setClause = '';
    const values = [];
    let index = 1;
    
    for (const [key, value] of Object.entries(updates)) {
        setClause += `${key} = ${dbType === 'postgres' ? `$${index}` : '?'}, `;
        values.push(value);
        index++;
    }
    
    setClause = setClause.slice(0, -2); // Удаляем последнюю запятую и пробел
    values.push(id);
    
    const sql = `UPDATE tickets SET ${setClause} WHERE id = ${dbType === 'postgres' ? `$${index}` : '?'}`;
    await run(sql, values);
}

async function updateTicketInfo(ticketId, updates) {
    const fields = Object.keys(updates);
    if (fields.length === 0) return;
    
    const setClause = fields.map((field, index) => {
        return `${field} = ${dbType === 'postgres' ? `$${index + 1}` : '?'}`;
    }).join(', ');
    
    const values = fields.map(field => updates[field]);
    values.push(ticketId);
    
    const sql = `UPDATE tickets SET ${setClause} WHERE id = ${dbType === 'postgres' ? `$${values.length}` : '?'}`;
    await run(sql, values);
}

async function updateTicketFiles(ticketId, files) {
    if (dbType === 'postgres') {
        await run('UPDATE tickets SET files = $1 WHERE id = $2', [files, ticketId]);
    } else {
        const filesStr = files && files.length > 0 ? JSON.stringify(files) : null;
        await run('UPDATE tickets SET files = ? WHERE id = ?', [filesStr, ticketId]);
    }
}

// ========== ФУНКЦИИ ДЛЯ ТИПОВ ПРОБЛЕМ И КАБИНЕТОВ ==========

async function getProblemTypes() {
    return await query('SELECT * FROM problem_types ORDER BY name');
}

async function getCabinets() {
    return await query('SELECT * FROM cabinets ORDER BY number');
}

async function addCabinet(number, userId) {
    if (dbType === 'postgres') {
        return await run(
            'INSERT INTO cabinets (number, added_by) VALUES ($1, $2) ON CONFLICT (number) DO NOTHING',
            [number, userId]
        );
    } else {
        return await run(
            'INSERT OR IGNORE INTO cabinets (number, added_by) VALUES (?, ?)',
            [number, userId]
        );
    }
}

// ========== ФУНКЦИИ ДЛЯ КОНТАКТОВ ПОЛЬЗОВАТЕЛЕЙ ==========

async function getUserContacts(userId) {
    const contacts = await query(
        `SELECT * FROM user_contacts WHERE user_id = ${dbType === 'postgres' ? '$1' : '?'}`,
        [userId]
    );
    return contacts[0];
}

async function updateUserContacts(userId, contacts) {
    const existing = await getUserContacts(userId);
    
    if (existing) {
        await run(
            `UPDATE user_contacts SET phone = ${dbType === 'postgres' ? '$1' : '?'}, 
            email = ${dbType === 'postgres' ? '$2' : '?'}, 
            updated_at = CURRENT_TIMESTAMP WHERE user_id = ${dbType === 'postgres' ? '$3' : '?'}`,
            [contacts.phone, contacts.email, userId]
        );
    } else {
        await run(
            `INSERT INTO user_contacts (user_id, phone, email) 
            VALUES (${dbType === 'postgres' ? '$1, $2, $3' : '?, ?, ?'})`,
            [userId, contacts.phone, contacts.email]
        );
    }
}

// ========== ДОПОЛНИТЕЛЬНЫЕ ФУНКЦИИ ==========

async function getStats() {
    const stats = {};
    
    // Общее количество заявок
    const totalTickets = await query('SELECT COUNT(*) as count FROM tickets WHERE status != "архив"');
    stats.totalTickets = totalTickets[0]?.count || 0;
    
    // Заявки по статусам
    const statusStats = await query(`
        SELECT status, COUNT(*) as count 
        FROM tickets 
        WHERE status != 'архив'
        GROUP BY status
        ORDER BY count DESC
    `);
    stats.byStatus = statusStats;
    
    // Заявки по типам проблем
    const typeStats = await query(`
        SELECT p.name, COUNT(t.id) as count
        FROM tickets t
        LEFT JOIN problem_types p ON t.problem_type_id = p.id
        WHERE t.status != 'архив'
        GROUP BY p.name
        ORDER BY count DESC
    `);
    stats.byType = typeStats;
    
    // Количество пользователей
    const userCount = await query('SELECT COUNT(*) as count FROM users');
    stats.userCount = userCount[0]?.count || 0;
    
    return stats;
}

async function searchTickets(searchTerm, userId = null) {
    let sql = `
        SELECT t.*, p.name as problem_type_name, u.full_name as user_full_name
        FROM tickets t
        LEFT JOIN problem_types p ON t.problem_type_id = p.id
        LEFT JOIN users u ON t.user_id = u.id
        WHERE (t.description LIKE $1 OR t.cabinet LIKE $1 OR t.comments LIKE $1)
        AND t.status != 'архив'
    `;
    
    const params = [`%${searchTerm}%`];
    
    if (userId) {
        sql += ` AND t.user_id = $${params.length + 1}`;
        params.push(userId);
    }
    
    sql += ' ORDER BY t.created_at DESC';
    
    return await query(sql, params);
}

module.exports = {
    init,
    query,
    run,
    get dbType() { return dbType; },
    
    // Пользователи
    getUserByLogin,
    getUserById,
    createUser,
    
    // Заявки
    createTicket,
    getTicketById,
    getUserTickets,
    getAllTickets,
    updateTicketStatus,
    updateTicketInfo,
    updateTicketFiles,
    
    // Проблемные типы и кабинеты
    getProblemTypes,
    getCabinets,
    addCabinet,
    
    // Контакты пользователей
    getUserContacts,
    updateUserContacts,
    
    // Дополнительные функции
    getStats,
    searchTickets
};