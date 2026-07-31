const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const USERS_FILE = path.join(__dirname, 'users.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

function readJSON(file) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
        return [];
    } catch (e) {
        return [];
    }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

if (!fs.existsSync(USERS_FILE)) writeJSON(USERS_FILE, []);
if (!fs.existsSync(MESSAGES_FILE)) writeJSON(MESSAGES_FILE, []);

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Регистрация
app.post('/register', (req, res) => {
    const { username, nickname, password } = req.body;
    if (!username || !nickname || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    const users = readJSON(USERS_FILE);
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    const newUser = {
        id: generateId(),
        username,
        nickname,
        passwordHash: hashPassword(password),
    };
    users.push(newUser);
    writeJSON(USERS_FILE, users);
    res.json({ success: true, userId: newUser.id });
});

// Логин
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.username === username);
    if (!user || user.passwordHash !== hashPassword(password)) {
        return res.status(400).json({ error: 'Invalid credentials' });
    }
    res.json({ success: true, userId: user.id, username: user.username, nickname: user.nickname });
});

// Получить профиль
app.get('/profile/:userId', (req, res) => {
    const { userId } = req.params;
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user.id, username: user.username, nickname: user.nickname });
});

// Смена пароля
app.post('/change-password', (req, res) => {
    const { userId, oldPassword, newPassword } = req.body;
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.passwordHash !== hashPassword(oldPassword)) {
        return res.status(400).json({ error: 'Old password incorrect' });
    }
    user.passwordHash = hashPassword(newPassword);
    writeJSON(USERS_FILE, users);
    res.json({ success: true });
});

// Смена username и nickname
app.post('/update-profile', (req, res) => {
    const { userId, username, nickname } = req.body;
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (users.some(u => u.username === username && u.id !== userId)) {
        return res.status(400).json({ error: 'Username already taken' });
    }
    user.username = username;
    user.nickname = nickname;
    writeJSON(USERS_FILE, users);
    res.json({ success: true });
});

// Поиск пользователей
app.get('/search', (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    const users = readJSON(USERS_FILE);
    const results = users
        .filter(u => u.username.toLowerCase().includes(q.toLowerCase()) || 
                     u.nickname.toLowerCase().includes(q.toLowerCase()))
        .map(u => ({ id: u.id, username: u.username, nickname: u.nickname }));
    res.json(results);
});

// Получение сообщений между двумя пользователями
app.get('/messages', (req, res) => {
    const { userId, otherUserId } = req.query;
    if (!userId || !otherUserId) {
        return res.status(400).json({ error: 'Missing userId or otherUserId' });
    }
    const messages = readJSON(MESSAGES_FILE);
    const filtered = messages.filter(m =>
        (m.fromUserId === userId && m.toUserId === otherUserId) ||
        (m.fromUserId === otherUserId && m.toUserId === userId)
    );
    res.json(filtered);
});

// Отправка сообщения
app.post('/send-message', (req, res) => {
    const { fromUserId, toUserId, text } = req.body;
    if (!fromUserId || !toUserId || !text) {
        return res.status(400).json({ error: 'All fields required' });
    }
    const users = readJSON(USERS_FILE);
    if (!users.find(u => u.id === fromUserId) || !users.find(u => u.id === toUserId)) {
        return res.status(400).json({ error: 'User not found' });
    }
    const messages = readJSON(MESSAGES_FILE);
    const newMsg = {
        id: generateId(),
        fromUserId,
        toUserId,
        text,
        timestamp: Date.now()
    };
    messages.push(newMsg);
    writeJSON(MESSAGES_FILE, messages);
    res.json({ success: true, message: newMsg });
});

app.listen(PORT, () => {
    console.log(`✅ Cut-A-Rote server running on http://localhost:${PORT}`);
});