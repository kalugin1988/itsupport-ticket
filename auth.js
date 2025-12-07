const fetch = require('node-fetch');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

async function ldapAuth(username, password) {
    try {
        const response = await fetch('https://ldap.itschool25.ru/api/auth', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password }),
            timeout: 10000
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('LDAP auth error:', error);
        return { success: false, error: 'Ошибка подключения к серверу авторизации' };
    }
}

function generateSuperadmin() {
    const username = 'superadmin';
    const password = uuidv4().slice(0, 12); // Генерируем случайный пароль
    
    // Хешируем пароль
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);
    
    // Сохраняем в переменные окружения (в реальном приложении нужно сохранить безопасно)
    process.env.SUPERADMIN_USERNAME = username;
    process.env.SUPERADMIN_HASH = hashedPassword;
    
    return { username, password };
}

async function login(req, res) {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Логин и пароль обязательны' });
        }
        
        // Проверка суперадмина
        if (username === process.env.SUPERADMIN_USERNAME) {
            const isValid = bcrypt.compareSync(password, process.env.SUPERADMIN_HASH);
            if (isValid) {
                req.session.user = {
                    login: username,
                    full_name: 'Супер администратор',
                    role: 'admin',
                    groups: ['Администрация']
                };
                return res.json({ success: true, user: req.session.user });
            }
        }
        
        // LDAP авторизация
        const ldapResult = await ldapAuth(username, password);
        
        if (!ldapResult.success) {
            return res.status(401).json({ 
                error: ldapResult.error || 'Неверный логин или пароль' 
            });
        }
        
        // Проверяем группы доступа
        const allowedGroups = process.env.ALLOWED_GROUPS 
            ? process.env.ALLOWED_GROUPS.split(',') 
            : [];
        
        let role = 'user';
        if (ldapResult.groups && Array.isArray(ldapResult.groups)) {
            // Проверяем, есть ли у пользователя хотя бы одна группа из разрешенных
            const hasAllowedGroup = ldapResult.groups.some(group => 
                allowedGroups.includes(group.trim())
            );
            
            if (hasAllowedGroup) {
                role = 'admin';
            }
        }
        
        // Сохраняем/обновляем пользователя в БД
        const userData = {
            login: ldapResult.username,
            full_name: ldapResult.full_name,
            ldap_groups: ldapResult.groups || [],
            role
        };
        
        const user = await db.createUser(userData);
        
        // Сохраняем в сессию
        req.session.user = {
            id: user.id,
            login: user.login,
            full_name: user.full_name,
            role: user.role,
            groups: typeof user.ldap_groups === 'string' 
                ? JSON.parse(user.ldap_groups) 
                : user.ldap_groups
        };
        
        res.json({ success: true, user: req.session.user });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
}

function logout(req, res) {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка при выходе' });
        }
        res.json({ success: true });
    });
}

function getCurrentUser(req, res) {
    if (req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: 'Не авторизован' });
    }
}

module.exports = {
    login,
    logout,
    getCurrentUser,
    generateSuperadmin
};