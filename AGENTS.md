# OpenTelegram - Agent Instructions

This file provides instructions for AI agents to help users set up OpenTelegram.

## Setup Workflow

When a user asks for help setting up OpenTelegram, follow these steps:

### 1. Check Environment Configuration

First, check if `.env` exists and what values are configured:

```bash
cat .env 2>/dev/null || echo "No .env file found"
```

If `.env` doesn't exist, copy from example:
```bash
cp .env.example .env
```

### 2. Required Configuration

Check and ask the user for any missing required values:

#### Telegram Bot Token (REQUIRED)
```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
```
- User must create a bot via [@BotFather](https://t.me/BotFather) on Telegram
- Send `/newbot` to BotFather and follow the prompts
- Copy the token provided

#### Telegram Bot Username (REQUIRED)
```
TELEGRAM_BOT_USERNAME=YourBotUsername
```
- The username chosen when creating the bot (without @)

#### Session Secret (REQUIRED)
```
SESSION_SECRET=change_this_to_a_secure_secret
```
- Generate a random string for session security
- Can generate with: `openssl rand -hex 32`

### 3. Optional Configuration

These have sensible defaults but can be customized:

#### OpenAI API Key (Optional - for voice messages)
```
OPENAI_API_KEY=your_openai_api_key_here
```
- Required only if user wants voice message transcription
- Get from https://platform.openai.com/api-keys

#### Telegram Group ID (Optional)
```
TELEGRAM_GROUP_ID=your_group_id
```
- Only needed if restricting bot to a specific group

#### OpenCode Settings (Optional)
```
OPENCODE_HOST=127.0.0.1
OPENCODE_PORT=4097
OPENCODE_MODEL=opencode/minimax-m2.5-free
```
- Defaults work for local setup

### 4. Verification Checklist

Before starting, verify:

- [ ] `.env` file exists
- [ ] `TELEGRAM_BOT_TOKEN` is set (not placeholder)
- [ ] `TELEGRAM_BOT_USERNAME` is set (not placeholder)
- [ ] `SESSION_SECRET` is changed from default
- [ ] Dependencies installed (`npm install`)
- [ ] ffmpeg is installed (for video support)

### 5. Starting the Application

```bash
# Terminal 1: Start OpenCode server
npm run server

# Terminal 2: Start the client (Telegram bot + web)
npm run client
```

### 6. Common Issues

#### "Telegram polling error"
- Check TELEGRAM_BOT_TOKEN is correct
- Ensure no other instance is running with same token

#### Voice messages not working
- Check OPENAI_API_KEY is set correctly
- Verify OpenAI account has credits

#### Video processing fails
- Ensure ffmpeg is installed: `apt install ffmpeg` or `brew install ffmpeg`

#### Connection to OpenCode server failed
- Verify server is running: `npm run server`
- Check OPENCODE_HOST and OPENCODE_PORT match server settings

## Environment Variable Summary

| Variable | Required | Description |
|----------|----------|-------------|
| TELEGRAM_BOT_TOKEN | Yes | Bot token from @BotFather |
| TELEGRAM_BOT_USERNAME | Yes | Bot username without @ |
| SESSION_SECRET | Yes | Random string for sessions |
| OPENAI_API_KEY | No | For voice transcription |
| TELEGRAM_GROUP_ID | No | Restrict to specific group |
| OPENCODE_HOST | No | Server host (default: 127.0.0.1) |
| OPENCODE_PORT | No | Server port (default: 4097) |
| OPENCODE_MODEL | No | Default AI model |
| PORT | No | Web server port (default: 3002) |
| CLIENT_PORT | No | Client port (default: 3003) |
