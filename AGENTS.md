# OpenTelegram - Agent Instructions

This file provides instructions for AI agents to help users set up OpenTelegram.

## Setup Workflow

When a user asks for help setting up OpenTelegram, guide them through these steps ONE AT A TIME. Wait for their response before proceeding to the next step.

### Step 1: Create Telegram Bot via BotFather

Ask the user:

> "Let's set up your Telegram bot! Please follow these steps:
> 
> 1. Open Telegram and search for **@BotFather** (or click: https://t.me/BotFather)
> 2. Start a chat and send: `/newbot`
> 3. BotFather will ask for a **name** for your bot - this is the display name (e.g., "My Example Site")
> 4. Then it will ask for a **username** - this must end in 'bot' (e.g., "examplesite_bot" or "ExampleSiteBot")
> 5. Once done, **copy and paste the ENTIRE response message** from BotFather here so I can extract the token for you."

When the user pastes the BotFather response, extract:
- **Bot token**: Look for the line containing `Use this token to access the HTTP API:` followed by a token in format `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`
- **Bot username**: Look for `@username` in the response or the username they chose

Example BotFather response to parse:
```
Done! Congratulations on your new bot. You will find it at t.me/ExampleSiteBot. You can now add a description, about section and profile picture for your bot, see /setname, /setdescription and /setuserpic.

Use this token to access the HTTP API:
1234567890:ABCdefGHIjklMNOpqrsTUVwxyz-1234567890
Keep your token secure and store it safely, it can be used by anyone to control your bot.

For a description of the Bot API, see this page: https://core.telegram.org/bots/api
```

### Step 2: Get OpenAI API Key (Optional - for voice messages)

Ask the user:

> "Do you want to enable voice message support? This requires an OpenAI API key for Whisper transcription.
> 
> If yes:
> 1. Go to: https://platform.openai.com/api-keys
> 2. Create a new API key
> 3. Copy and paste the key here
> 
> If you don't need voice messages, just say 'skip'."

### Step 3: Configure Environment

After collecting the information:

1. Check if `.env` exists:
```bash
cat .env 2>/dev/null || echo "No .env file found"
```

2. If `.env` doesn't exist, copy from example:
```bash
cp .env.example .env
```

3. Generate a session secret:
```bash
openssl rand -hex 32
```

4. Update the `.env` file with:
   - `TELEGRAM_BOT_TOKEN` - Extracted from BotFather response
   - `TELEGRAM_BOT_USERNAME` - Extracted from BotFather response (without @)
   - `SESSION_SECRET` - The generated random string
   - `OPENAI_API_KEY` - If provided by user

### Step 4: Verify and Start

Before starting, verify the `.env` is correctly configured, then:

```bash
# Install dependencies if needed
npm install

# Terminal 1: Start OpenCode server
npm run server

# Terminal 2: Start the client (Telegram bot + web)
npm run client
```

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| TELEGRAM_BOT_TOKEN | Yes | Bot token from @BotFather |
| TELEGRAM_BOT_USERNAME | Yes | Bot username without @ |
| SESSION_SECRET | Yes | Random string for sessions |
| OPENAI_API_KEY | No | For voice transcription - get from https://platform.openai.com/api-keys |
| TELEGRAM_GROUP_ID | No | Restrict to specific group |
| OPENCODE_HOST | No | Server host (default: 127.0.0.1) |
| OPENCODE_PORT | No | Server port (default: 4097) |
| OPENCODE_MODEL | No | Default AI model |
| PORT | No | Web server port (default: 3002) |
| CLIENT_PORT | No | Client port (default: 3003) |

## Common Issues

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
