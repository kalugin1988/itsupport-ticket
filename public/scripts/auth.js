// Проверяем, авторизован ли пользователь
async function checkAuth() {
    try {
        const response = await fetch('/api/user');
        if (response.ok) {
            const data = await response.json();
            return data.user;
        }
        return null;
    } catch (error) {
        console.error('Auth check error:', error);
        return null;
    }
}

// Авторизация
async function login(username, password) {
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            return { success: true, user: data.user };
        } else {
            return { success: false, error: data.error || 'Ошибка авторизации' };
        }
    } catch (error) {
        console.error('Login error:', error);
        return { success: false, error: 'Ошибка подключения к серверу' };
    }
}

// Выход
async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login.html';
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// Инициализация страницы логина
if (document.getElementById('loginForm')) {
    const loginForm = document.getElementById('loginForm');
    const messageEl = document.getElementById('message');
    
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        messageEl.className = 'message';
        messageEl.textContent = '';
        
        const result = await login(username, password);
        
        if (result.success) {
            messageEl.className = 'message success';
            messageEl.textContent = 'Авторизация успешна! Перенаправление...';
            
            setTimeout(() => {
                window.location.href = '/';
            }, 1000);
        } else {
            messageEl.className = 'message error';
            messageEl.textContent = result.error || 'Ошибка авторизации';
        }
    });
}

// Инициализация главной страницы
if (document.getElementById('logoutBtn')) {
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    // Проверяем авторизацию при загрузке
    window.addEventListener('DOMContentLoaded', async () => {
        const user = await checkAuth();
        
        if (!user) {
            window.location.href = '/login.html';
            return;
        }
        
        // Отображаем информацию о пользователе
        const userFullNameEl = document.getElementById('userFullName');
        if (userFullNameEl) {
            userFullNameEl.textContent = user.full_name;
            
            // Если пользователь админ, показываем админские элементы
            if (user.role === 'admin') {
                document.querySelectorAll('.admin-only').forEach(el => {
                    el.style.display = 'block';
                });
            }
        }
    });
}