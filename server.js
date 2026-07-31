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
const BLOCKS_FILE = path.join(__dirname, 'blocks.json'); // блокировки

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
if (!fs.existsSync(BLOCKS_FILE)) writeJSON(BLOCKS_FILE, {}); // { userId: [blockedId, ...] }

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// ---- Регистрация ----
app.post('/register', (req, res) => {
    const { username, nickname, password } = req.body;
    if (!username || !nickname || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    const users = readJSON(USERS_FILE);
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    // если username == 'fxz' — даём галочку
    const verified = username === 'fxz';
    const newUser = {
        id: generateId(),
        username,
        nickname,
        passwordHash: hashPassword(password),
        verified: verified
    };
    users.push(newUser);
    writeJSON(USERS_FILE, users);
    res.json({ success: true, userId: newUser.id });
});

// ---- Логин ----
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
    res.json({ success: true, userId: user.id, username: user.username, nickname: user.nickname, verified: user.verified || false });
});

// ---- Профиль ----
app.get('/profile/:userId', (req, res) => {
    const { userId } = req.params;
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user.id, username: user.username, nickname: user.nickname, verified: user.verified || false });
});

// ---- Смена пароля ----
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

// ---- Смена username/nickname ----
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

// ---- Поиск пользователей ----
app.get('/search', (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    const users = readJSON(USERS_FILE);
    const results = users
        .filter(u => u.username.toLowerCase().includes(q.toLowerCase()) || 
                     u.nickname.toLowerCase().includes(q.toLowerCase()))
        .map(u => ({ id: u.id, username: u.username, nickname: u.nickname, verified: u.verified || false }));
    res.json(results);
});

// ---- Получение списка диалогов (все, с кем есть сообщения) ----
app.get('/dialogs', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const messages = readJSON(MESSAGES_FILE);
    const users = readJSON(USERS_FILE);
    // Собираем всех участников, с которыми у данного пользователя есть переписка
    const partners = new Set();
    messages.forEach(m => {
        if (m.fromUserId === userId) partners.add(m.toUserId);
        if (m.toUserId === userId) partners.add(m.fromUserId);
    });
    const result = [];
    partners.forEach(id => {
        const u = users.find(u => u.id === id);
        if (u) {
            result.push({
                id: u.id,
                username: u.username,
                nickname: u.nickname,
                verified: u.verified || false,
                avatar_color: '#007bff' // можно рандомизировать
            });
        }
    });
    // Сортируем по времени последнего сообщения (новые сверху)
    result.sort((a, b) => {
        const lastA = messages.filter(m => (m.fromUserId === a.id && m.toUserId === userId) || (m.fromUserId === userId && m.toUserId === a.id));
        const lastB = messages.filter(m => (m.fromUserId === b.id && m.toUserId === userId) || (m.fromUserId === userId && m.toUserId === b.id));
        const timeA = lastA.length ? lastA[lastA.length-1].timestamp : 0;
        const timeB = lastB.length ? lastB[lastB.length-1].timestamp : 0;
        return timeB - timeA;
    });
    res.json(result);
});

// ---- Получение сообщений между двумя пользователями ----
app.get('/messages', (req, res) => {
    const { userId, otherUserId } = req.query;
    if (!userId || !otherUserId) {
        return res.status(400).json({ error: 'Missing userId or otherUserId' });
    }
    // Проверка блокировки: если пользователь заблокирован, не отдаём сообщения
    const blocks = readJSON(BLOCKS_FILE);
    if (blocks[userId] && blocks[userId].includes(otherUserId)) {
        return res.json([]); // пустой список
    }
    if (blocks[otherUserId] && blocks[otherUserId].includes(userId)) {
        return res.json([]);
    }
    const messages = readJSON(MESSAGES_FILE);
    const filtered = messages.filter(m =>
        (m.fromUserId === userId && m.toUserId === otherUserId) ||
        (m.fromUserId === otherUserId && m.toUserId === userId)
    );
    res.json(filtered);
});

// ---- Отправка сообщения ----
app.post('/send-message', (req, res) => {
    const { fromUserId, toUserId, text } = req.body;
    if (!fromUserId || !toUserId || !text) {
        return res.status(400).json({ error: 'All fields required' });
    }
    const users = readJSON(USERS_FILE);
    const fromUser = users.find(u => u.id === fromUserId);
    const toUser = users.find(u => u.id === toUserId);
    if (!fromUser || !toUser) {
        return res.status(400).json({ error: 'User not found' });
    }
    // Проверка блокировки
    const blocks = readJSON(BLOCKS_FILE);
    if (blocks[fromUserId] && blocks[fromUserId].includes(toUserId)) {
        return res.status(403).json({ error: 'You have blocked this user' });
    }
    if (blocks[toUserId] && blocks[toUserId].includes(fromUserId)) {
        return res.status(403).json({ error: 'You are blocked by this user' });
    }
    const messages = readJSON(MESSAGES_FILE);
    const newMsg = {
        id: generateId(),
        fromUserId,
        toUserId,
        text,
        timestamp: Date.now(),
        deleted: false // флаг удаления для всех
    };
    messages.push(newMsg);
    writeJSON(MESSAGES_FILE, messages);
    res.json({ success: true, message: newMsg });
});

// ---- Удаление сообщения для всех (только автор может удалить) ----
app.post('/delete-message', (req, res) => {
    const { messageId, userId } = req.body;
    if (!messageId || !userId) {
        return res.status(400).json({ error: 'Missing data' });
    }
    const messages = readJSON(MESSAGES_FILE);
    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex === -1) {
        return res.status(404).json({ error: 'Message not found' });
    }
    const msg = messages[msgIndex];
    if (msg.fromUserId !== userId) {
        return res.status(403).json({ error: 'You are not the author' });
    }
    // Помечаем как удалённое (или полностью удаляем)
    messages.splice(msgIndex, 1); // удаляем навсегда
    writeJSON(MESSAGES_FILE, messages);
    res.json({ success: true });
});

// ---- Блокировка пользователя ----
app.post('/block', (req, res) => {
    const { userId, blockUserId } = req.body;
    if (!userId || !blockUserId) {
        return res.status(400).json({ error: 'Missing data' });
    }
    const blocks = readJSON(BLOCKS_FILE);
    if (!blocks[userId]) blocks[userId] = [];
    if (!blocks[userId].includes(blockUserId)) {
        blocks[userId].push(blockUserId);
        writeJSON(BLOCKS_FILE, blocks);
    }
    res.json({ success: true });
});

// ---- Разблокировка ----
app.post('/unblock', (req, res) => {
    const { userId, blockUserId } = req.body;
    const blocks = readJSON(BLOCKS_FILE);
    if (blocks[userId]) {
        blocks[userId] = blocks[userId].filter(id => id !== blockUserId);
        writeJSON(BLOCKS_FILE, blocks);
    }
    res.json({ success: true });
});

// ---- Проверка блокировки ----
app.get('/is-blocked', (req, res) => {
    const { userId, otherUserId } = req.query;
    const blocks = readJSON(BLOCKS_FILE);
    const blocked = (blocks[userId] && blocks[userId].includes(otherUserId)) ||
                    (blocks[otherUserId] && blocks[otherUserId].includes(userId));
    res.json({ blocked });
});

// ---- Запуск ----
app.listen(PORT, () => {
    console.log(`✅ Cut-A-Rote server running on http://localhost:${PORT}`);
});
