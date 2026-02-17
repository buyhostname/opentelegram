import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import TelegramBot from 'node-telegram-bot-api';
import { createOpencodeClient } from '@opencode-ai/sdk/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// OpenCode client - connects to running server
const opencode = createOpencodeClient({
    baseUrl: `http://${process.env.OPENCODE_HOST || '127.0.0.1'}:${process.env.OPENCODE_PORT || 4096}`
});

console.log(`OpenCode client connecting to http://${process.env.OPENCODE_HOST || '127.0.0.1'}:${process.env.OPENCODE_PORT || 4096}`);

// Telegram bot setup (polling mode for receiving messages)
let telegramBot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('Telegram bot initialized with polling');
}

// Store active sessions (chatId -> sessionId mapping)
const userSessions = new Map();

// Handle /start command
if (telegramBot) {
    telegramBot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        await telegramBot.sendMessage(chatId, 
            `Welcome to OpenTelegram!\n\n` +
            `I connect you to OpenCode AI assistant.\n\n` +
            `Commands:\n` +
            `/new - Start a new session\n` +
            `/sessions - List your sessions\n` +
            `/help - Show help\n\n` +
            `Just send me any message to chat with the AI!`
        );
    });

    // Handle /new command - create new session
    telegramBot.onText(/\/new/, async (msg) => {
        const chatId = msg.chat.id;
        
        try {
            await telegramBot.sendMessage(chatId, 'Creating new session...');
            
            const { data: newSession } = await opencode.session.create({});
            userSessions.set(chatId, newSession.id);
            
            await telegramBot.sendMessage(chatId, 
                `New session created!\n\nSession ID: \`${newSession.id}\`\n\nSend me a message to start chatting.`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('Error creating session:', error);
            await telegramBot.sendMessage(chatId, `Error creating session: ${error.message}`);
        }
    });

    // Handle /sessions command
    telegramBot.onText(/\/sessions/, async (msg) => {
        const chatId = msg.chat.id;
        
        try {
            const { data: sessions } = await opencode.session.list();
            
            if (!sessions || sessions.length === 0) {
                await telegramBot.sendMessage(chatId, 'No sessions found. Use /new to create one.');
                return;
            }

            const sessionList = sessions.slice(0, 10).map((s, i) => 
                `${i + 1}. \`${s.id.slice(0, 8)}...\` - ${s.title || 'Untitled'}`
            ).join('\n');

            const currentSession = userSessions.get(chatId);
            await telegramBot.sendMessage(chatId, 
                `Recent sessions:\n\n${sessionList}\n\nCurrent: \`${currentSession ? currentSession.slice(0, 8) + '...' : 'none'}\``,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('Error listing sessions:', error);
            await telegramBot.sendMessage(chatId, `Error listing sessions: ${error.message}`);
        }
    });

    // Handle /help command
    telegramBot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        await telegramBot.sendMessage(chatId,
            `*OpenTelegram Help*\n\n` +
            `This bot connects you to OpenCode AI assistant.\n\n` +
            `*Commands:*\n` +
            `/start - Welcome message\n` +
            `/new - Start a new chat session\n` +
            `/sessions - List recent sessions\n` +
            `/help - Show this help\n\n` +
            `*How to use:*\n` +
            `Just send any message and I'll forward it to OpenCode AI and return the response.\n\n` +
            `*Tips:*\n` +
            `- Use /new to start fresh\n` +
            `- Long responses may be split into multiple messages`,
            { parse_mode: 'Markdown' }
        );
    });

    // Handle regular messages
    telegramBot.on('message', async (msg) => {
        // Skip commands
        if (msg.text && msg.text.startsWith('/')) return;
        
        const chatId = msg.chat.id;
        const text = msg.text;

        if (!text) {
            await telegramBot.sendMessage(chatId, 'Please send a text message.');
            return;
        }

        try {
            // Get or create session
            let sessionId = userSessions.get(chatId);
            
            if (!sessionId) {
                // Create new session automatically
                const { data: newSession } = await opencode.session.create({});
                sessionId = newSession.id;
                userSessions.set(chatId, sessionId);
            }

            // Send typing indicator
            await telegramBot.sendChatAction(chatId, 'typing');

            // Send message to OpenCode using session.prompt
            await opencode.session.prompt({
                path: { id: sessionId },
                body: { content: text }
            });

            // Get messages to find the assistant's response
            const { data: messages } = await opencode.session.messages({
                path: { id: sessionId }
            });

            // Find the last assistant message
            const assistantMessages = messages.filter(m => m.role === 'assistant');
            const lastAssistant = assistantMessages[assistantMessages.length - 1];

            if (lastAssistant && lastAssistant.content) {
                // Extract text from content parts
                let responseText = '';
                if (typeof lastAssistant.content === 'string') {
                    responseText = lastAssistant.content;
                } else if (Array.isArray(lastAssistant.content)) {
                    responseText = lastAssistant.content
                        .filter(p => p.type === 'text')
                        .map(p => p.text)
                        .join('\n');
                }

                // Split long messages (Telegram limit is 4096)
                const maxLen = 4000;
                if (responseText.length > maxLen) {
                    const parts = [];
                    for (let i = 0; i < responseText.length; i += maxLen) {
                        parts.push(responseText.slice(i, i + maxLen));
                    }
                    for (const part of parts) {
                        await telegramBot.sendMessage(chatId, part);
                    }
                } else {
                    await telegramBot.sendMessage(chatId, responseText || 'No response received.');
                }
            } else {
                await telegramBot.sendMessage(chatId, 'Processing... Response may take a moment.');
            }

        } catch (error) {
            console.error('Error processing message:', error);
            await telegramBot.sendMessage(chatId, `Error: ${error.message}`);
        }
    });

    // Error handling
    telegramBot.on('polling_error', (error) => {
        console.error('Telegram polling error:', error.message);
    });
}

// Express app setup
app.set('trust proxy', true);
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'opentelegram-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.PRODUCTION === 'true',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

const PORT = process.env.CLIENT_PORT || 3003;

// Home page
app.get('/', (req, res) => {
    res.render('index', { 
        title: 'OpenTelegram',
        botUsername: process.env.TELEGRAM_BOT_USERNAME
    });
});

// Health check
app.get('/health', async (req, res) => {
    let opencodeStatus = 'unknown';
    try {
        await opencode.session.list();
        opencodeStatus = 'connected';
    } catch {
        opencodeStatus = 'disconnected';
    }
    
    res.json({ 
        status: 'ok', 
        opencode: opencodeStatus, 
        telegram: !!telegramBot 
    });
});

// API: Send message to OpenCode
app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Create or use session
        let sid = sessionId;
        if (!sid) {
            const { data: newSession } = await opencode.session.create({});
            sid = newSession.id;
        }

        // Send prompt
        await opencode.session.prompt({
            path: { id: sid },
            body: { content: message }
        });

        res.json({ 
            success: true, 
            sessionId: sid,
            message: 'Message submitted to OpenCode'
        });
    } catch (error) {
        console.error('API chat error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: List sessions
app.get('/api/sessions', async (req, res) => {
    try {
        const { data: sessions } = await opencode.session.list();
        res.json(sessions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Page Not Found',
        status: 404,
        message: 'The page you are looking for does not exist.'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).render('error', {
        title: 'Error',
        status: err.status || 500,
        message: process.env.PRODUCTION === 'true' ? 'Something went wrong.' : err.message
    });
});

// Start Express server
app.listen(PORT, () => {
    console.log(`OpenTelegram client running on port ${PORT}`);
});
