# OpenTelegram

Telegram bot that connects to OpenCode AI server, enabling AI chat via Telegram with support for text, voice, images, and video. Supports two-way sync with Telegram Forum Topics for terminal session mirroring.

## Features

- Text messages: Chat with AI models
- Voice messages: Transcribed via OpenAI Whisper and sent to AI
- Photos: AI vision analysis with optional captions
- Videos: Frame extraction and multi-image AI analysis
- Model switching: Browse and select from available AI models
- Session management: Create and switch between chat sessions
- Two-way sync: Terminal sessions sync to Telegram Forum Topics
- Web interface: Simple web UI for health checks

## Two-Way Sync

OpenTelegram supports bidirectional sync between terminal OpenCode sessions and Telegram Forum Topics:

**Terminal -> Telegram:**
- When you run OpenCode in the terminal, sessions are automatically synced to a Telegram group with Forum Topics enabled
- Each session creates a new topic with the conversation visible in Telegram
- User prompts and AI responses are posted to the topic

**Telegram -> Terminal:**
- Reply to a synced topic to send messages back to the OpenCode session
- Responses are posted back to the topic

### Setup

1. Create a Telegram group and enable "Topics" in group settings
2. Add your bot as an admin with permissions to manage topics
3. Get the group ID (starts with -100 for supergroups)
4. Set `TELEGRAM_SYNC_GROUP_ID` in your `.env` file

### OpenCode Plugin

Copy `plugins/telegram-sync.js` to your OpenCode plugins folder:

```bash
cp plugins/telegram-sync.js ~/.config/opencode/plugins/
# or
cp plugins/telegram-sync.js .opencode/plugins/
```

Set the sync URL environment variable:
```bash
export TELEGRAM_SYNC_URL=http://127.0.0.1:4097
```

## Setup

Deploy on [hoston.ai](https://hoston.ai) - paste this:

```
copy this project and setup https://github.com/buyhostname/opentelegram
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Express server port | No (default: 3002) |
| `CLIENT_PORT` | Client server port | No (default: 3003) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from BotFather | Yes |
| `TELEGRAM_BOT_USERNAME` | Your bot's username | Yes |
| `TELEGRAM_GROUP_ID` | Restrict to specific group | No |
| `TELEGRAM_SYNC_GROUP_ID` | Group for session sync (Forum Topics enabled) | No |
| `OPENCODE_HOST` | OpenCode server host | No (default: 127.0.0.1) |
| `OPENCODE_PORT` | OpenCode server port | No (default: 4097) |
| `OPENCODE_MODEL` | Default AI model | No (default: opencode/minimax-m2.5-free) |
| `SESSION_SECRET` | Express session secret | Yes |
| `OPENAI_API_KEY` | OpenAI API key for Whisper | No (required for voice) |

## Bot Commands

- `/start` - Welcome message and feature overview
- `/new` - Create a new chat session
- `/sessions` - List recent sessions
- `/model` - Show/set current AI model
- `/models` - Browse available models with inline buttons
- `/help` - Show help information

## Sync API Endpoints

- `POST /sync/session` - Create a sync topic for a session
- `POST /sync/message` - Post a message to a sync topic
- `GET /sync/status` - Get sync status and active sessions

## Requirements

- Node.js 18+
- ffmpeg (for video frame extraction)
- OpenCode server running

## License

MIT
