# OpenTelegram

Telegram bot that connects to OpenCode AI server, enabling AI chat via Telegram with support for text, voice, images, and video.

## Features

- Text messages: Chat with AI models
- Voice messages: Transcribed via OpenAI Whisper and sent to AI
- Photos: AI vision analysis with optional captions
- Videos: Frame extraction and multi-image AI analysis
- Model switching: Browse and select from available AI models
- Session management: Create and switch between chat sessions
- Web interface: Simple web UI for health checks

## Setup

### Quick Setup

Deploy on [hoston.ai](https://hoston.ai) - paste this:

```
copy this project and setup https://github.com/buyhostname/opentelegram
```

### Manual Setup

1. Clone the repository:
```bash
git clone https://github.com/buyhostname/opentelegram.git
cd opentelegram
```

2. Install dependencies:
```bash
npm install
```

3. Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
```

4. Edit `.env` with your values:
   - `TELEGRAM_BOT_TOKEN` - Get from [@BotFather](https://t.me/BotFather)
   - `TELEGRAM_BOT_USERNAME` - Your bot's username
   - `TELEGRAM_GROUP_ID` - (Optional) Group ID for restricted access
   - `OPENAI_API_KEY` - For voice transcription (Whisper)
   - `SESSION_SECRET` - Change to a secure random string

5. Start the OpenCode server:
```bash
npm run server
```

6. In another terminal, start the client:
```bash
npm run client
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Express server port | No (default: 3002) |
| `CLIENT_PORT` | Client server port | No (default: 3003) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from BotFather | Yes |
| `TELEGRAM_BOT_USERNAME` | Your bot's username | Yes |
| `TELEGRAM_GROUP_ID` | Restrict to specific group | No |
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

## Requirements

- Node.js 18+
- ffmpeg (for video frame extraction)
- OpenCode server running

## License

MIT
