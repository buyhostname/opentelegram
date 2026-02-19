import dotenv from 'dotenv';
import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import TelegramBot from 'node-telegram-bot-api';
import { createOpencodeClient } from '@opencode-ai/sdk/client';
import OpenAI from 'openai';
import fs from 'fs';
import os from 'os';
import { execSync, spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file fresh (override any cached values)
dotenv.config({ path: path.join(__dirname, '.env'), override: true });

const app = express();

// OpenCode client - connects to running server
const opencode = createOpencodeClient({
    baseUrl: `http://${process.env.OPENCODE_HOST || '127.0.0.1'}:${process.env.OPENCODE_PORT || 4096}`,
    timeout: 600000 // 10 minutes timeout for long operations
});

console.log(`OpenCode client connecting to http://${process.env.OPENCODE_HOST || '127.0.0.1'}:${process.env.OPENCODE_PORT || 4096}`);

// Telegram bot setup (polling mode for receiving messages)
let telegramBot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('Telegram bot initialized with polling');
}

// OpenAI client for Whisper voice transcription
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Store active sessions (chatId -> sessionId mapping)
const userSessions = new Map();

// Store user model preferences (chatId -> modelId mapping)
const userModels = new Map();

// Store models temporarily for callback lookups (indexed)
let modelIndex = new Map();

// Track bot start time to ignore old messages after restart
const botStartTime = Math.floor(Date.now() / 1000);

// Parse allowed users whitelist from environment
const allowedUsers = process.env.TELEGRAM_ALLOWED_USERS
    ? process.env.TELEGRAM_ALLOWED_USERS.split(',').map(id => id.trim()).filter(id => id && id !== '0')
    : [];

if (allowedUsers.length > 0) {
    console.log(`User whitelist enabled: ${allowedUsers.length} user(s) allowed`);
} else {
    console.log('No users in whitelist - first user to message will become admin');
}

// Add user to .env file and exit (for first-time setup)
function addUserToEnvAndExit(userId) {
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    
    // Read existing .env if it exists
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Check if TELEGRAM_ALLOWED_USERS already exists (not commented out)
    const envVarRegex = /^TELEGRAM_ALLOWED_USERS=.*$/m;
    if (envVarRegex.test(envContent)) {
        // Replace the existing line
        envContent = envContent.replace(
            envVarRegex,
            `TELEGRAM_ALLOWED_USERS=${userId}`
        );
    } else {
        // Append to the file
        envContent += `\n# User whitelist - only these user IDs can use the bot\nTELEGRAM_ALLOWED_USERS=${userId}\n`;
    }
    
    fs.writeFileSync(envPath, envContent);
    console.log(`Added user ${userId} to .env as admin. Exiting for restart...`);
    process.exit(0);
}

// Check if a user is authorized to use the bot
// Returns true if authorized, false otherwise (and sends unauthorized message)
async function checkUserAuthorized(msg) {
    const userId = msg.from?.id;
    const chatId = msg.chat.id;
    const msgTime = msg.date || 0;
    
    // Ignore messages sent before bot started (old messages from queue after restart)
    if (msgTime < botStartTime) {
        console.log(`Ignoring old message from ${userId} (msg time: ${msgTime}, bot start: ${botStartTime})`);
        return false;
    }
    
    // If no allowlist configured, first user becomes admin
    if (allowedUsers.length === 0 && userId) {
        await telegramBot.sendMessage(chatId,
            `You are the first user to message this bot.\n\n` +
            `Adding you as admin (user ID: ${userId}).\n\n` +
            `The bot will restart now. Please message again in a few seconds.`
        );
        addUserToEnvAndExit(userId);
        return false; // Won't reach here, but for safety
    }
    
    // Check if user is in whitelist
    if (userId && allowedUsers.includes(String(userId))) {
        return true;
    }
    
    // User not authorized - send message they can paste back to the agent
    await telegramBot.sendMessage(chatId,
        `You are not authorized to use this bot.\n\n` +
        `Paste this into the chat to allow your user ID to control the machine:\n\n` +
        `Add user ${userId} to TELEGRAM_ALLOWED_USERS`
    );
    
    return false;
}

// Get the current model for a user (falls back to env default)
function getUserModel(chatId) {
    return userModels.get(chatId) || process.env.OPENCODE_MODEL || 'opencode/minimax-m2.5-free';
}

// Parse model ID string (provider/model) into { providerID, modelID } object
function parseModelId(modelStr) {
    const [providerID, ...rest] = modelStr.split('/');
    const modelID = rest.join('/'); // Handle model IDs that may contain '/'
    return { providerID, modelID };
}

// Dynamic model loading
async function getAvailableModels() {
    try {
        const { data } = await opencode.config.providers();
        const models = [];
        
        for (const provider of data.providers) {
            if (provider.models && typeof provider.models === 'object') {
                for (const modelId of Object.keys(provider.models)) {
                    models.push({
                        id: `${provider.id}/${modelId}`,
                        name: `${provider.name} ${modelId}`
                    });
                }
            }
        }
        
        // Update model index for callback lookups
        modelIndex.clear();
        models.forEach((model, idx) => modelIndex.set(idx, model));
        
        console.log(`Loaded ${models.length} models from OpenCode server`);
        return models;
    } catch (error) {
        console.error('Error loading models:', error);
        return [];
    }
}

// Stream events and send progress updates to user
async function streamWithProgress(chatId, sessionId, parts, modelObj, context = '') {
    let progressMessageId = null;
    
    // Send initial progress message
    try {
        const msg = await telegramBot.sendMessage(chatId, context ? `${context}\n\n⏳ Processing...` : '⏳ Processing...');
        progressMessageId = msg.message_id;
    } catch (e) {
        // Ignore progress message errors
    }
    
    // Send the prompt and wait for response
    try {
        const result = await opencode.session.prompt({
            path: { id: sessionId },
            body: { 
                parts,
                model: modelObj
            }
        });
        
        // Delete progress message
        if (progressMessageId) {
            try {
                await telegramBot.deleteMessage(chatId, progressMessageId);
            } catch (e) {
                // Ignore delete errors
            }
        }
        
        if (result?.error) {
            throw new Error(`OpenCode API error: ${JSON.stringify(result.error)}`);
        }
        
        return result?.data;
    } catch (error) {
        // Delete progress message on error
        if (progressMessageId) {
            try {
                await telegramBot.deleteMessage(chatId, progressMessageId);
            } catch (e) {
                // Ignore
            }
        }
        throw error;
    }
}

// Extract video frames with progress callback
async function extractFrames(videoPath, framesDir, videoDuration, onProgress) {
    return new Promise((resolve, reject) => {
        const framePattern = path.join(framesDir, 'frame_%03d.jpg');
        
        const args = [
            '-i', videoPath,
            '-vf', 'fps=1/2',
            '-q:v', '2',
            '-progress', 'pipe:1',  // Output progress to stdout
            '-nostats',
            framePattern
        ];
        
        console.log(`[VIDEO DEBUG] Running ffmpeg with args:`, args);
        const startTime = Date.now();
        
        if (onProgress) onProgress('starting', 0);
        
        const ffmpeg = spawn('ffmpeg', args);
        
        let lastProgress = 0;
        let stderrData = '';
        
        ffmpeg.stdout.on('data', (data) => {
            const output = data.toString();
            // Parse progress output - look for out_time_ms
            const timeMatch = output.match(/out_time_ms=(\d+)/);
            if (timeMatch && videoDuration > 0) {
                const currentTimeMs = parseInt(timeMatch[1]);
                const currentTimeSec = currentTimeMs / 1000000;
                const progress = Math.min(99, Math.round((currentTimeSec / videoDuration) * 100));
                if (progress > lastProgress) {
                    lastProgress = progress;
                    console.log(`[VIDEO DEBUG] FFmpeg progress: ${progress}%`);
                    if (onProgress) onProgress('progress', progress);
                }
            }
        });
        
        ffmpeg.stderr.on('data', (data) => {
            stderrData += data.toString();
        });
        
        ffmpeg.on('close', (code) => {
            const elapsed = Date.now() - startTime;
            if (code === 0) {
                console.log(`[VIDEO DEBUG] FFmpeg completed in ${elapsed}ms`);
                if (onProgress) onProgress('done', 100);
                resolve();
            } else {
                console.error(`[VIDEO DEBUG] FFmpeg failed with code ${code}`);
                console.error(`[VIDEO DEBUG] FFmpeg stderr:`, stderrData);
                reject(new Error(`ffmpeg failed with code ${code}: ${stderrData.slice(-500)}`));
            }
        });
        
        ffmpeg.on('error', (error) => {
            console.error(`[VIDEO DEBUG] FFmpeg spawn error:`, error);
            reject(new Error(`ffmpeg failed to start: ${error.message}`));
        });
        
        // Timeout after 60 seconds
        setTimeout(() => {
            ffmpeg.kill('SIGKILL');
            reject(new Error('ffmpeg timed out after 60 seconds'));
        }, 60000);
    });
}

// Handle /start command
if (telegramBot) {
    telegramBot.onText(/\/start/, async (msg) => {
        if (!await checkUserAuthorized(msg)) return;
        
        const chatId = msg.chat.id;
        const currentModel = getUserModel(chatId);
        await telegramBot.sendMessage(chatId, 
            `Welcome to OpenTelegram!\n\n` +
            `I connect you to OpenCode AI assistant.\n\n` +
            `*Current Model:* \`${currentModel}\`\n\n` +
            `Commands:\n` +
            `/new - Start a new session\n` +
            `/sessions - List your sessions\n` +
            `/models - Browse available models\n` +
            `/model - Show/set current model\n` +
            `/help - Show help\n\n` +
            `Features:\n` +
            `- Text messages: Chat with the AI\n` +
            `- Voice messages: Send voice to transcribe and chat\n` +
            `- Photos: Send images with optional caption for AI analysis\n` +
            `- Videos: Send videos to extract frames and analyze\n\n` +
            `Just send me any message, voice note, photo, or video to chat with the AI!`,
            { parse_mode: 'Markdown' }
        );
    });

    // Handle /new command - create new session
    telegramBot.onText(/\/new/, async (msg) => {
        if (!await checkUserAuthorized(msg)) return;
        
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
        if (!await checkUserAuthorized(msg)) return;
        
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
        if (!await checkUserAuthorized(msg)) return;
        
        const chatId = msg.chat.id;
        await telegramBot.sendMessage(chatId,
            `*OpenTelegram Help*\n\n` +
            `This bot connects you to OpenCode AI assistant.\n\n` +
            `*Commands:*\n` +
            `/start - Welcome message\n` +
            `/new - Start a new chat session\n` +
            `/sessions - List recent sessions\n` +
            `/model - Show current model and set a new one\n` +
            `/models - Browse and select available models\n` +
            `/help - Show this help\n\n` +
            `*Features:*\n` +
            `*Text Messages:* Send any text to chat with the AI\n` +
            `*Voice Messages:* Send a voice note to transcribe and chat\n` +
            `*Photos:* Send images with optional caption for AI analysis\n\n` +
            `*How to use:*\n` +
            `- Send text messages to chat with OpenCode AI\n` +
            `- Send voice messages to transcribe and get AI responses\n` +
            `- Send photos with optional captions for AI image analysis\n` +
            `- Send videos to extract frames and analyze\n\n` +
            `*Tips:*\n` +
            `- Use /new to start fresh\n` +
            `- Long responses may be split into multiple messages\n` +
            `- Voice messages are transcribed using OpenAI Whisper\n` +
            `- Images are saved to the server and analyzed by the AI\n` +
            `- Videos are processed with ffmpeg to extract frames for analysis`,
            { parse_mode: 'Markdown' }
        );
    });

    // Handle /model command - show current model or set new one
    telegramBot.onText(/\/model(?:\s+(.+))?/, async (msg, match) => {
        if (!await checkUserAuthorized(msg)) return;
        
        const chatId = msg.chat.id;
        const modelArg = match[1]?.trim();
        const currentModel = getUserModel(chatId);

        if (modelArg) {
            const models = await getAvailableModels();
            const model = models.find(m => m.id === modelArg || m.name.toLowerCase().includes(modelArg.toLowerCase()));
            if (model) {
                // Set the user's model preference
                userModels.set(chatId, model.id);
                await telegramBot.sendMessage(chatId,
                    `✅ *Model set to:* ${model.name}\n\n` +
                    `ID: \`${model.id}\`\n\n` +
                    `Your next message will use this model.`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await telegramBot.sendMessage(chatId,
                    `Model "${modelArg}" not found in the available list.\n\n` +
                    `Run \`/models\` to see all available models.`
                );
            }
        } else {
            await telegramBot.sendMessage(chatId,
                `*Current Model:*\n\`${currentModel}\`\n\n` +
                `Run \`/models\` to see and select other models.\n` +
                `Or use \`/model <model-id>\` to set a specific model.`,
                { parse_mode: 'Markdown' }
            );
        }
    });

    // Handle /models command - show inline keyboard with model options
    telegramBot.onText(/\/models/, async (msg) => {
        if (!await checkUserAuthorized(msg)) return;
        
        const chatId = msg.chat.id;
        const currentModel = getUserModel(chatId);

        const models = await getAvailableModels();
        
        if (models.length === 0) {
            await telegramBot.sendMessage(chatId, 'Unable to load models. Please try again later.');
            return;
        }

        const keyboard = models.slice(0, 50).map((model, idx) => [{
            text: (model.id === currentModel ? '✓ ' : '') + model.name,
            callback_data: `m_${idx}`
        }]);
        
        // Add pagination if more than 50 models
        if (models.length > 50) {
            keyboard.push([{ text: '➡️ More models (51-100)', callback_data: 'page_1' }]);
        }

        await telegramBot.sendMessage(chatId,
            `*Available Models* (${models.length} total)\n\n` +
            `Tap a model to select it.\n\n` +
            `Current: \`${currentModel}\``,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );
    });

    // Handle callback queries from inline keyboard
    telegramBot.on('callback_query', async (callbackQuery) => {
        const { data, message } = callbackQuery;
        const chatId = message.chat.id;
        
        // Handle pagination
        if (data && data.startsWith('page_')) {
            const page = parseInt(data.replace('page_', ''), 10);
            const pageSize = 50;
            const start = page * pageSize;
            const end = start + pageSize;
            const currentModel = getUserModel(chatId);
            
            const models = await getAvailableModels();
            const pageModels = models.slice(start, end);
            
            const keyboard = pageModels.map((model, idx) => [{
                text: (model.id === currentModel ? '✓ ' : '') + model.name,
                callback_data: `m_${start + idx}`
            }]);
            
            // Add navigation buttons
            const nav = [];
            if (page > 0) {
                nav.push({ text: '⬅️ Previous', callback_data: `page_${page - 1}` });
            }
            if (end < models.length) {
                nav.push({ text: '➡️ Next', callback_data: `page_${page + 1}` });
            }
            if (nav.length > 0) keyboard.push(nav);
            
            await telegramBot.answerCallbackQuery(callbackQuery.id);
            await telegramBot.editMessageText(
                `*Available Models* (${models.length} total, showing ${start + 1}-${Math.min(end, models.length)})\n\n` +
                `Tap a model to select it.\n\n` +
                `Current: \`${currentModel}\``,
                {
                    chat_id: chatId,
                    message_id: message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
            return;
        }
        
        // Handle model selection
        if (data && data.startsWith('m_')) {
            const idx = parseInt(data.replace('m_', ''), 10);
            const model = modelIndex.get(idx);
            
            if (model) {
                // Set the user's model preference (no server restart needed)
                userModels.set(chatId, model.id);
                
                await telegramBot.answerCallbackQuery(callbackQuery.id, {
                    text: `Model set: ${model.name}`,
                    show_alert: false
                });
                
                await telegramBot.editMessageText(
                    `✅ *Model Changed*\n\n` +
                    `*${model.name}*\n` +
                    `\`${model.id}\`\n\n` +
                    `Your next message will use this model.`,
                    {
                        chat_id: chatId,
                        message_id: message.message_id,
                        parse_mode: 'Markdown'
                    }
                );
            } else {
                await telegramBot.answerCallbackQuery(callbackQuery.id, {
                    text: 'Model not found. Try /models again.',
                    show_alert: true
                });
            }
        }
    });

    // Handle regular messages
    telegramBot.on('message', async (msg) => {
        // Skip commands
        if (msg.text && msg.text.startsWith('/')) return;
        
        // Skip voice, audio, photo, and video messages - handled by separate events
        if (msg.voice || msg.audio || msg.photo || msg.video) return;
        
        // Check authorization
        if (!await checkUserAuthorized(msg)) return;
        
        const chatId = msg.chat.id;
        const text = msg.text;

        if (!text) {
            // Don't show error for voice/audio (they're handled separately)
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

            // Send message to OpenCode using streaming progress
            const userModel = getUserModel(chatId);
            const modelObj = parseModelId(userModel);
            const response = await streamWithProgress(
                chatId, 
                sessionId, 
                [{ type: 'text', text }], 
                modelObj,
                `🤔 Processing your message...`
            );

            console.log(`Prompt with model ${userModel} (${JSON.stringify(modelObj)}), response:`, JSON.stringify(response, null, 2));

            // Extract text from the response
            let responseText = '';
            
            if (response && response.parts) {
                // Response has parts array
                responseText = response.parts
                    .filter(p => p.type === 'text')
                    .map(p => p.text)
                    .join('\n');
            } else if (response && response.content) {
                // Response has content
                if (typeof response.content === 'string') {
                    responseText = response.content;
                } else if (Array.isArray(response.content)) {
                    responseText = response.content
                        .filter(p => p.type === 'text')
                        .map(p => p.text)
                        .join('\n');
                }
            }

            if (responseText) {
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
                    await telegramBot.sendMessage(chatId, responseText);
                }
            } else {
                await telegramBot.sendMessage(chatId, 'No response received. Please try again.');
            }

        } catch (error) {
            console.error('Error processing message:', error);
            await telegramBot.sendMessage(chatId, `Error: ${error.message}`);
        }
    });

    // Handle voice messages
    telegramBot.on('voice', async (msg) => {
        if (!await checkUserAuthorized(msg)) return;
        
        const chatId = msg.chat.id;
        
        if (!process.env.OPENAI_API_KEY) {
            await telegramBot.sendMessage(chatId, 'Voice input is not configured. Please add OPENAI_API_KEY to the environment.');
            return;
        }
        
        try {
            // Send typing indicator
            await telegramBot.sendChatAction(chatId, 'typing');
            
            // Get voice file info
            const voiceFileId = msg.voice.file_id;
            const voiceFile = await telegramBot.getFile(voiceFileId);
            const voiceFileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${voiceFile.file_path}`;
            
            // Download the voice file
            const response = await fetch(voiceFileUrl);
            const voiceBuffer = Buffer.from(await response.arrayBuffer());
            
            // Save to temp file
            const tempFile = path.join(os.tmpdir(), `voice_${Date.now()}.ogg`);
            fs.writeFileSync(tempFile, voiceBuffer);
            
            // Transcribe with Whisper
            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(tempFile),
                model: 'whisper-1',
            });
            
            // Clean up temp file
            fs.unlinkSync(tempFile);
            
            const transcribedText = transcription.text;
            
            if (!transcribedText || transcribedText.trim().length === 0) {
                await telegramBot.sendMessage(chatId, 'Could not transcribe the voice message. Please try again.');
                return;
            }
            
            // Show the transcribed text
            await telegramBot.sendMessage(chatId, `🎤 *Voice Transcription:*\n_${transcribedText}_`, { parse_mode: 'Markdown' });
            
            // Process the transcribed text like a regular message
            let sessionId = userSessions.get(chatId);
            
            if (!sessionId) {
                // Create new session automatically
                const { data: newSession } = await opencode.session.create({});
                sessionId = newSession.id;
                userSessions.set(chatId, sessionId);
            }
            
            // Send typing indicator
            await telegramBot.sendChatAction(chatId, 'typing');
            
            // Send message to OpenCode using streaming progress
            const userModel = getUserModel(chatId);
            const modelObj = parseModelId(userModel);
            const aiResponse = await streamWithProgress(
                chatId, 
                sessionId, 
                [{ type: 'text', text: transcribedText }], 
                modelObj,
                `🎤 Voice: "${transcribedText.substring(0, 50)}${transcribedText.length > 50 ? '...' : ''}"`
            );
            
            // Extract text from the response
            let responseText = '';
            
            if (aiResponse && aiResponse.parts) {
                responseText = aiResponse.parts
                    .filter(p => p.type === 'text')
                    .map(p => p.text)
                    .join('\n');
            } else if (aiResponse && aiResponse.content) {
                if (typeof aiResponse.content === 'string') {
                    responseText = aiResponse.content;
                } else if (Array.isArray(aiResponse.content)) {
                    responseText = aiResponse.content
                        .filter(p => p.type === 'text')
                        .map(p => p.text)
                        .join('\n');
                }
            }
            
            if (responseText) {
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
                    await telegramBot.sendMessage(chatId, responseText);
                }
            } else {
                await telegramBot.sendMessage(chatId, 'No response received. Please try again.');
            }
            
        } catch (error) {
            console.error('Error processing voice message:', error);
            await telegramBot.sendMessage(chatId, `Error processing voice message: ${error.message}`);
        }
    });

    // Handle photo messages
    telegramBot.on('photo', async (msg) => {
        if (!await checkUserAuthorized(msg)) return;
        
        const chatId = msg.chat.id;
        const caption = msg.caption || '';
        
        console.log(`[PHOTO DEBUG] Received photo message from chatId: ${chatId}`);
        console.log(`[PHOTO DEBUG] Caption: "${caption}"`);
        console.log(`[PHOTO DEBUG] Photo array length: ${msg.photo?.length || 0}`);
        
        try {
            // Send typing indicator
            await telegramBot.sendChatAction(chatId, 'typing');
            
            // Get the largest photo size (best quality)
            const photos = msg.photo;
            const largestPhoto = photos[photos.length - 1];
            const photoFileId = largestPhoto.file_id;
            console.log(`[PHOTO DEBUG] Largest photo file_id: ${photoFileId}, size: ${largestPhoto.file_size} bytes`);
            
            // Get file info and download URL
            console.log(`[PHOTO DEBUG] Getting file info from Telegram...`);
            const photoFile = await telegramBot.getFile(photoFileId);
            console.log(`[PHOTO DEBUG] Got file info:`, photoFile);
            
            const photoFileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${photoFile.file_path}`;
            console.log(`[PHOTO DEBUG] Download URL: ${photoFileUrl.substring(0, 100)}...`);
            
            // Download the photo
            console.log(`[PHOTO DEBUG] Downloading photo...`);
            const response = await fetch(photoFileUrl);
            const photoBuffer = Buffer.from(await response.arrayBuffer());
            console.log(`[PHOTO DEBUG] Downloaded ${photoBuffer.length} bytes`);
            
            // Save to uploads folder with unique filename
            const fileExt = path.extname(photoFile.file_path) || '.jpg';
            const fileName = `photo_${chatId}_${Date.now()}${fileExt}`;
            const uploadPath = path.join(__dirname, 'uploads', fileName);
            fs.writeFileSync(uploadPath, photoBuffer);
            
            console.log(`[PHOTO DEBUG] Photo saved to: ${uploadPath}`);
            
            // Get or create session
            let sessionId = userSessions.get(chatId);
            console.log(`[PHOTO DEBUG] Current session for chatId ${chatId}: ${sessionId || 'none (will create new)'}`);
            
            if (!sessionId) {
                // Create new session automatically
                console.log(`[PHOTO DEBUG] Creating new session...`);
                const { data: newSession } = await opencode.session.create({});
                sessionId = newSession.id;
                userSessions.set(chatId, sessionId);
                console.log(`[PHOTO DEBUG] New session created: ${sessionId}`);
            }
            
            // Send typing indicator
            await telegramBot.sendChatAction(chatId, 'typing');
            
            // Prepare message parts - include image as base64 and optional caption
            // Order matters: text prompt should come BEFORE image for most vision models
            const parts = [];
            
            const promptText = caption.trim() ? caption : 'What do you see in this image?';
            parts.push({ type: 'text', text: promptText });
            console.log(`[PHOTO DEBUG] Added text part: "${promptText}"`);
            
            // Use file part with local file URL
            const mimeType = fileExt === '.png' ? 'image/png' : 'image/jpeg';
            const fileUrl = `file://${uploadPath}`;
            console.log(`[PHOTO DEBUG] Using file URL: ${fileUrl}, MIME type: ${mimeType}`);
            
            parts.push({ 
                type: 'file', 
                mime: mimeType,
                url: fileUrl,
                filename: fileName
            });
            console.log(`[PHOTO DEBUG] Added file part to request`);
            
            // Send to OpenCode
            const userModel = getUserModel(chatId);
            const modelObj = parseModelId(userModel);
            console.log(`[PHOTO DEBUG] User model: ${userModel}`);
            console.log(`[PHOTO DEBUG] Parsed model object:`, modelObj);
            console.log(`[PHOTO DEBUG] Session ID: ${sessionId}`);
            console.log(`[PHOTO DEBUG] Request parts:`, JSON.stringify(parts.map(p => ({ ...p, source: p.source ? { ...p.source, data: p.source.data.substring(0, 50) + '...' } : undefined })), null, 2));
            
            console.log(`[PHOTO DEBUG] Sending prompt to OpenCode with streaming...`);
            let aiResponse;
            try {
                const context = `📸 Photo Analysis\n💬 ${promptText.substring(0, 100)}${promptText.length > 100 ? '...' : ''}`;
                aiResponse = await streamWithProgress(chatId, sessionId, parts, modelObj, context);
                console.log(`[PHOTO DEBUG] OpenCode response received`);
            } catch (promptError) {
                console.error(`[PHOTO DEBUG] ERROR during opencode.session.prompt():`, promptError);
                console.error(`[PHOTO DEBUG] Error message:`, promptError.message);
                console.error(`[PHOTO DEBUG] Error stack:`, promptError.stack);
                throw promptError;
            }
            
            // Extract text from the response
            let responseText = '';
            console.log(`[PHOTO DEBUG] Extracting text from response...`);
            console.log(`[PHOTO DEBUG] Response type:`, typeof aiResponse);
            console.log(`[PHOTO DEBUG] Response has parts:`, !!aiResponse?.parts);
            console.log(`[PHOTO DEBUG] Response has content:`, !!aiResponse?.content);
            
            if (aiResponse && aiResponse.parts) {
                console.log(`[PHOTO DEBUG] Found ${aiResponse.parts.length} parts in response`);
                responseText = aiResponse.parts
                    .filter(p => p.type === 'text')
                    .map(p => p.text)
                    .join('\n');
            } else if (aiResponse && aiResponse.content) {
                if (typeof aiResponse.content === 'string') {
                    responseText = aiResponse.content;
                } else if (Array.isArray(aiResponse.content)) {
                    responseText = aiResponse.content
                        .filter(p => p.type === 'text')
                        .map(p => p.text)
                        .join('\n');
                }
            }
            
            console.log(`[PHOTO DEBUG] Extracted response text length: ${responseText.length}`);
            console.log(`[PHOTO DEBUG] Response text preview: "${responseText.substring(0, 100)}${responseText.length > 100 ? '...' : ''}"`);
            
            if (responseText && responseText.trim()) {
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
                    await telegramBot.sendMessage(chatId, responseText);
                }
            } else if (aiResponse && aiResponse.parts && aiResponse.parts.length === 0) {
                console.log(`[PHOTO DEBUG] Empty parts array - model may not support images`);
                await telegramBot.sendMessage(chatId, 'The AI model returned an empty response. This model may not support image analysis. Try using a vision-capable model like gpt-4o or claude-3-5-sonnet.');
            } else if (aiResponse === null || aiResponse === undefined) {
                console.log(`[PHOTO DEBUG] Response is null/undefined`);
                await telegramBot.sendMessage(chatId, 'No response from the AI. Please try again or check if the server is running.');
            } else {
                await telegramBot.sendMessage(chatId, `Image received but the AI didn't return text. Response structure: ${Object.keys(aiResponse || {}).join(', ')}`);
            }
            
        } catch (error) {
            console.error('[PHOTO DEBUG] FATAL ERROR processing photo message:', error);
            console.error('[PHOTO DEBUG] Error message:', error.message);
            console.error('[PHOTO DEBUG] Error stack:', error.stack);
            console.error('[PHOTO DEBUG] Error object keys:', Object.keys(error));
            if (error.response) {
                console.error('[PHOTO DEBUG] Error response:', error.response);
            }
            if (error.code) {
                console.error('[PHOTO DEBUG] Error code:', error.code);
            }
            await telegramBot.sendMessage(chatId, `Error processing photo: ${error.message}`);
        }
    });

    // Handle video messages
    telegramBot.on('video', async (msg) => {
        if (!await checkUserAuthorized(msg)) return;
        
        const chatId = msg.chat.id;
        const caption = msg.caption || '';
        
        console.log(`[VIDEO DEBUG] Received video message from chatId: ${chatId}`);
        console.log(`[VIDEO DEBUG] Caption: "${caption}"`);
        console.log(`[VIDEO DEBUG] Video info:`, {
            file_id: msg.video.file_id,
            file_unique_id: msg.video.file_unique_id,
            file_size: msg.video.file_size,
            width: msg.video.width,
            height: msg.video.height,
            duration: msg.video.duration,
            mime_type: msg.video.mime_type
        });
        
        let progressMsgId = null;
        
        try {
            // Send initial progress message
            const progressMsg = await telegramBot.sendMessage(chatId, 
                `🎬 Processing video...\n⏱️ Duration: ${msg.video.duration}s\n📦 Size: ${(msg.video.file_size / 1024 / 1024).toFixed(2)} MB\n\n⏳ Step 1/3: Downloading...`
            );
            progressMsgId = progressMsg.message_id;
            
            // Get video file info
            const videoFileId = msg.video.file_id;
            console.log(`[VIDEO DEBUG] Getting file info from Telegram...`);
            const videoFile = await telegramBot.getFile(videoFileId);
            console.log(`[VIDEO DEBUG] Got file info:`, videoFile);
            
            const videoFileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${videoFile.file_path}`;
            console.log(`[VIDEO DEBUG] Download URL: ${videoFileUrl.substring(0, 100)}...`);
            
            // Download the video
            console.log(`[VIDEO DEBUG] Downloading video...`);
            const response = await fetch(videoFileUrl);
            const videoBuffer = Buffer.from(await response.arrayBuffer());
            console.log(`[VIDEO DEBUG] Downloaded ${videoBuffer.length} bytes`);
            
            // Save to temp file
            const fileExt = path.extname(videoFile.file_path) || '.mp4';
            const tempVideoPath = path.join(os.tmpdir(), `video_${chatId}_${Date.now()}${fileExt}`);
            fs.writeFileSync(tempVideoPath, videoBuffer);
            console.log(`[VIDEO DEBUG] Video saved to: ${tempVideoPath}`);
            
            // Create frames directory
            const framesDir = path.join(os.tmpdir(), `frames_${chatId}_${Date.now()}`);
            fs.mkdirSync(framesDir, { recursive: true });
            
            // Track last progress update to avoid rate limiting
            let lastProgressUpdate = 0;
            const videoDuration = msg.video.duration;
            const videoSize = (msg.video.file_size / 1024 / 1024).toFixed(2);
            
            // Progress callback for ffmpeg
            const onProgress = async (status, percent) => {
                const now = Date.now();
                // Rate limit updates to every 2 seconds to avoid Telegram rate limits
                if (status === 'progress' && now - lastProgressUpdate < 2000) {
                    return;
                }
                lastProgressUpdate = now;
                
                let progressText;
                if (status === 'starting') {
                    progressText = `🎬 Processing video...\n⏱️ Duration: ${videoDuration}s\n📦 Size: ${videoSize} MB\n\n⏳ Step 2/3: Starting conversion...`;
                } else if (status === 'progress') {
                    progressText = `🎬 Processing video...\n⏱️ Duration: ${videoDuration}s\n📦 Size: ${videoSize} MB\n\n⏳ Step 2/3: Converting... ${percent}%`;
                } else if (status === 'done') {
                    progressText = `🎬 Processing video...\n⏱️ Duration: ${videoDuration}s\n📦 Size: ${videoSize} MB\n\n✅ Step 2/3: Conversion done!`;
                }
                
                try {
                    await telegramBot.editMessageText(progressText, { chat_id: chatId, message_id: progressMsgId });
                } catch (e) {
                    // Ignore edit errors (rate limiting, message not modified, etc.)
                }
            };
            
            // Extract frames using ffmpeg with progress
            console.log(`[VIDEO DEBUG] Extracting frames with ffmpeg...`);
            try {
                await extractFrames(tempVideoPath, framesDir, msg.video.duration, onProgress);
                console.log(`[VIDEO DEBUG] Frames extracted successfully`);
            } catch (ffmpegError) {
                console.error(`[VIDEO DEBUG] FFmpeg error:`, ffmpegError.message);
                throw new Error(`Failed to extract frames: ${ffmpegError.message}`);
            }
            
            // Get list of extracted frames
            const frameFiles = fs.readdirSync(framesDir)
                .filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))
                .sort()
                .slice(0, 5); // Limit to 5 frames max
            
            console.log(`[VIDEO DEBUG] Extracted ${frameFiles.length} frames`);
            
            if (frameFiles.length === 0) {
                throw new Error('No frames could be extracted from the video');
            }
            
            // Update progress
            await telegramBot.editMessageText(
                `🎬 Processing video...\n⏱️ Duration: ${msg.video.duration}s\n📊 Extracted ${frameFiles.length} frames\n\n⏳ Step 3/3: Analyzing with AI...`,
                { chat_id: chatId, message_id: progressMsgId }
            );
            
            // Get or create session
            let sessionId = userSessions.get(chatId);
            console.log(`[VIDEO DEBUG] Current session for chatId ${chatId}: ${sessionId || 'none (will create new)'}`);
            
            if (!sessionId) {
                console.log(`[VIDEO DEBUG] Creating new session...`);
                const { data: newSession } = await opencode.session.create({});
                sessionId = newSession.id;
                userSessions.set(chatId, sessionId);
                console.log(`[VIDEO DEBUG] New session created: ${sessionId}`);
            }
            
            // Send typing indicator
            await telegramBot.sendChatAction(chatId, 'typing');
            
            // Prepare message parts
            const parts = [];
            
            const promptText = caption.trim() 
                ? caption 
                : `I've extracted ${frameFiles.length} frames from a ${msg.video.duration}-second video. Please analyze these frames and describe what you see.`;
            parts.push({ type: 'text', text: promptText });
            console.log(`[VIDEO DEBUG] Added text part: "${promptText}"`);
            
            // Add each frame as a file part
            for (const frameFile of frameFiles) {
                const framePath = path.join(framesDir, frameFile);
                const fileUrl = `file://${framePath}`;
                parts.push({ 
                    type: 'file', 
                    mime: 'image/jpeg',
                    url: fileUrl,
                    filename: frameFile
                });
                console.log(`[VIDEO DEBUG] Added frame: ${frameFile}`);
            }
            
            // Delete progress message before sending to AI
            try {
                await telegramBot.deleteMessage(chatId, progressMsgId);
            } catch (e) {
                // Ignore delete errors
            }
            progressMsgId = null;
            
            // Send to OpenCode with streaming progress
            const userModel = getUserModel(chatId);
            const modelObj = parseModelId(userModel);
            console.log(`[VIDEO DEBUG] User model: ${userModel}`);
            console.log(`[VIDEO DEBUG] Sending prompt with ${parts.length} parts...`);
            
            let aiResponse;
            try {
                const context = `🎬 Video Analysis\n📊 Extracted ${frameFiles.length} frames\n⏱️ Duration: ${msg.video.duration}s`;
                aiResponse = await streamWithProgress(chatId, sessionId, parts, modelObj, context);
                console.log(`[VIDEO DEBUG] OpenCode response received`);
                console.log(`[VIDEO DEBUG] Response type:`, typeof aiResponse);
                console.log(`[VIDEO DEBUG] Response keys:`, aiResponse ? Object.keys(aiResponse) : 'null');
                console.log(`[VIDEO DEBUG] Full response:`, JSON.stringify(aiResponse, null, 2).substring(0, 1000));
            } catch (promptError) {
                console.error(`[VIDEO DEBUG] ERROR during opencode.session.prompt():`, promptError);
                throw promptError;
            }
            
            // Extract text from the response
            let responseText = '';
            
            if (aiResponse && aiResponse.parts) {
                responseText = aiResponse.parts
                    .filter(p => p.type === 'text')
                    .map(p => p.text)
                    .join('\n');
            } else if (aiResponse && aiResponse.content) {
                if (typeof aiResponse.content === 'string') {
                    responseText = aiResponse.content;
                } else if (Array.isArray(aiResponse.content)) {
                    responseText = aiResponse.content
                        .filter(p => p.type === 'text')
                        .map(p => p.text)
                        .join('\n');
                }
            }
            
            console.log(`[VIDEO DEBUG] Extracted response text length: ${responseText.length}`);
            console.log(`[VIDEO DEBUG] Response text preview: ${responseText.substring(0, 200)}`);
            
            if (responseText && responseText.trim()) {
                // Split long messages (Telegram limit is 4096)
                const maxLen = 4000;
                if (responseText.length > maxLen) {
                    const chunks = [];
                    for (let i = 0; i < responseText.length; i += maxLen) {
                        chunks.push(responseText.slice(i, i + maxLen));
                    }
                    console.log(`[VIDEO DEBUG] Sending ${chunks.length} message chunks`);
                    for (const chunk of chunks) {
                        await telegramBot.sendMessage(chatId, chunk);
                    }
                } else {
                    console.log(`[VIDEO DEBUG] Sending single message response`);
                    await telegramBot.sendMessage(chatId, responseText);
                }
                console.log(`[VIDEO DEBUG] Response sent successfully`);
            } else if (aiResponse && aiResponse.parts && aiResponse.parts.length === 0) {
                console.log(`[VIDEO DEBUG] Empty parts array - model may not support images`);
                await telegramBot.sendMessage(chatId, 'The AI model returned an empty response. This model may not support video/image analysis. Try using a vision-capable model like gpt-4o or claude-3-5-sonnet with /model command.');
            } else if (aiResponse === null || aiResponse === undefined) {
                console.log(`[VIDEO DEBUG] Response is null/undefined`);
                await telegramBot.sendMessage(chatId, 'No response from the AI. Please try again or check if the server is running.');
            } else {
                console.log(`[VIDEO DEBUG] No text in response, structure: ${Object.keys(aiResponse || {}).join(', ')}`);
                await telegramBot.sendMessage(chatId, `Video received and frames extracted, but the AI didn't return text. Try using a vision-capable model with /model command.`);
            }
            
            // Cleanup temp files
            try {
                fs.unlinkSync(tempVideoPath);
                frameFiles.forEach(f => fs.unlinkSync(path.join(framesDir, f)));
                fs.rmdirSync(framesDir);
                console.log(`[VIDEO DEBUG] Cleaned up temp files`);
            } catch (cleanupError) {
                console.error(`[VIDEO DEBUG] Cleanup error:`, cleanupError);
            }
            
        } catch (error) {
            console.error('[VIDEO DEBUG] FATAL ERROR processing video message:', error);
            console.error('[VIDEO DEBUG] Error message:', error.message);
            console.error('[VIDEO DEBUG] Error stack:', error.stack);
            
            // Clean up progress message on error
            if (progressMsgId) {
                try {
                    await telegramBot.deleteMessage(chatId, progressMsgId);
                } catch (e) {
                    // Ignore
                }
            }
            
            await telegramBot.sendMessage(chatId, `❌ Error processing video: ${error.message}`);
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
