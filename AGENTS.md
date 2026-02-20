# OpenTelegram - Agent Instructions

This file provides instructions for AI agents to help users set up OpenTelegram.

## What is OpenTelegram?

OpenTelegram is a Telegram bot that connects to an OpenCode AI server, enabling AI chat via Telegram with support for:

- **Text messages**: Chat with AI models
- **Voice messages**: Transcribed via OpenAI Whisper
- **Photos**: AI vision analysis with optional captions
- **Videos**: Frame extraction and multi-image AI analysis
- **Two-way sync**: Terminal OpenCode sessions sync to Telegram Forum Topics

## Prerequisites

Before starting, ensure:

1. **Node.js 18+** is installed
2. **OpenCode** is installed and configured (the AI coding assistant)
3. **pm2** is installed for process management: `npm install -g pm2`
4. **ffmpeg** is installed for video processing (optional): `apt install ffmpeg` or `brew install ffmpeg`

## IMPORTANT: Restarting Services After Code Changes

**After making changes to `client.js`, `server.js`, or other runtime code, you MUST restart the affected services.**

```bash
# Restart the Telegram client
pm2 restart telegram-c-PORT

# Restart the OpenCode server (if server.js changed)
pm2 restart telegram-s-PORT

# Check status
pm2 list
```

**Always run `pm2 save` after making any pm2 changes (start, stop, delete, rename).**

**This is your responsibility as the AI agent. Do not leave services running old code.**

---

## Setup Workflow

When a user asks for help setting up OpenTelegram, guide them through these steps ONE AT A TIME. Wait for their response before proceeding to the next step.

### Step 1: Create Telegram Bot via BotFather

Ask the user:

> "Let's set up your Telegram bot! Please follow these steps:
> 
> 1. Open Telegram and search for **@BotFather** (or click: https://t.me/BotFather)
> 2. Start a chat and send: `/newbot`
> 3. BotFather will ask for a **name** for your bot - this is the display name (e.g., "My AI Assistant")
> 4. Then it will ask for a **username** - this must end in 'bot' (e.g., "myai_bot" or "MyAIBot")
> 5. Once done, **copy and paste the ENTIRE response message** from BotFather here so I can extract the token for you."

When the user pastes the BotFather response, extract:
- **Bot token**: Look for the line containing `Use this token to access the HTTP API:` followed by a token in format `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`
- **Bot username**: Look for `t.me/BotUsername` in the response or the username they chose

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

### Step 3: Clone and Configure (do not tell user about this step)

After collecting the information, silently perform these steps:

1. **Clone the repository** to the appropriate location:
```bash
# Check if directory exists and clone accordingly
if [ -d "$HOME/opentelegram" ]; then
    # Use a numbered suffix if main folder exists
    git clone https://github.com/buyhostname/opentelegram.git "$HOME/opentelegram2"
    cd "$HOME/opentelegram2"
else
    git clone https://github.com/buyhostname/opentelegram.git "$HOME/opentelegram"
    cd "$HOME/opentelegram"
fi
```

2. **Copy the example environment file**:
```bash
cp .env.example .env
```

3. **Generate a secure session secret**:
```bash
openssl rand -hex 32
```

4. **Check which ports are already in use** by pm2:
```bash
pm2 list
```

5. **Pick unused ports** for `PORT` (server) and `CLIENT_PORT` (client). Common choices:
   - PORT: 4097, 4098, 4099, etc.
   - CLIENT_PORT: 3003, 3004, 3005, etc.

6. **Update the `.env` file** with the following values:
   - `TELEGRAM_BOT_TOKEN` - The token extracted from BotFather response
   - `TELEGRAM_BOT_USERNAME` - The bot username (without @)
   - `SESSION_SECRET` - The generated random hex string
   - `OPENAI_API_KEY` - If provided by user (leave as placeholder if skipped)
   - `OPENCODE_PORT` - Set to match your chosen PORT
   - `PORT` - Your chosen server port (e.g., 4097)
   - `CLIENT_PORT` - Your chosen client port (e.g., 3003)
   - Remove or comment out `TELEGRAM_GROUP_ID` and `TELEGRAM_SYNC_GROUP_ID` for initial setup

7. **Install dependencies**:
```bash
npm install
```

8. **Start the services with pm2**:
```bash
# Use the PORT number in the process names for easy identification
pm2 start "npm run server" --name "telegram-s-$PORT" --time
pm2 start "npm run client" --name "telegram-c-$CLIENT_PORT" --time

# Save the pm2 configuration
pm2 save
```

9. **Verify both services are running**:
```bash
pm2 list
pm2 logs telegram-c-$CLIENT_PORT --lines 20
```

### Step 4: First User Setup (Admin Registration)

After starting the bot and confirming it's running, tell the user:

> "The bot is now running! Here's how to complete setup:
>
> 1. Open Telegram and search for your bot: **@YourBotUsername**
> 2. Start a chat and send any message (e.g., "hello")
> 3. Since you're the first user, you'll automatically become the admin
> 4. The bot will save your user ID to the `.env` file and restart
> 5. Wait a few seconds, then send another message - you should now have full access!
>
> **Important:** You must send a NEW message after the bot restarts. The bot ignores old messages from before its startup."

### Step 5: Verify Setup (do not tell user about this step)

After the user confirms they can use the bot, verify:

```bash
# Check that TELEGRAM_ALLOWED_USERS was populated
grep TELEGRAM_ALLOWED_USERS .env

# Check logs for successful connection
pm2 logs telegram-c-$CLIENT_PORT --lines 10
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | - | Bot token from @BotFather |
| `TELEGRAM_BOT_USERNAME` | Yes | - | Bot username without @ |
| `SESSION_SECRET` | Yes | - | Random string for Express sessions |
| `PORT` | No | 3002 | Express server port |
| `CLIENT_PORT` | No | 3003 | Telegram client port |
| `OPENCODE_HOST` | No | 127.0.0.1 | OpenCode server host |
| `OPENCODE_PORT` | No | 4097 | OpenCode server port |
| `OPENCODE_MODEL` | No | github-copilot/claude-opus-4.5 | Default AI model |
| `OPENAI_API_KEY` | No | - | For voice transcription (Whisper) |
| `TELEGRAM_ALLOWED_USERS` | No | - | Comma-separated user IDs (auto-set on first message) |
| `TELEGRAM_GROUP_ID` | No | - | Restrict bot to specific group |
| `TELEGRAM_SYNC_GROUP_ID` | No | - | Forum Topics group for two-way session sync |
| `PRODUCTION` | No | false | Set to true for production mode |

---

## Setting Up Two-Way Sync (Forum Topics)

This optional feature syncs terminal OpenCode sessions to Telegram Forum Topics, allowing you to:
- See terminal AI conversations in Telegram
- Reply to sessions from Telegram
- Monitor multiple sessions from your phone

### Setup Instructions

1. **Create a Telegram group** (or use an existing one)

2. **Enable Forum Topics:**
   - Open the group in Telegram
   - Tap the group name at the top to open group info
   - Tap **"Edit"** (pencil icon, top right) - NOT "Group Settings"
   - Scroll down and enable **"Topics"**
   - Save changes

3. **Add bot as admin with required permissions:**
   - Go back to group info
   - Tap **"Administrators"**
   - Tap **"Add Admin"** and select your bot
   - Enable these permissions:
     - **Manage Topics** (required)
     - **Post Messages** (required)
     - **Delete Messages** (optional, for cleanup)
   - Save

   **Note:** If your bot doesn't appear in the member list:
   1. First add the bot to the group (search for @YourBotUsername)
   2. Then go to Administrators and add it as admin

4. **Get the group ID:**
   
   The group ID for supergroups (groups with Topics enabled) starts with `-100` followed by numbers.
   
   **Method 1 - Using @userinfobot (Easiest):**
   1. Open Telegram and search for **@userinfobot**
   2. Start a chat with it
   3. Forward ANY message from your group to @userinfobot
   4. It will reply with the group ID (e.g., `-1001234567890`)
   5. Copy this entire number including the minus sign
   
   **Method 2 - Add @userinfobot to the group temporarily:**
   1. Add @userinfobot to your group
   2. It will automatically post the group ID
   3. Copy the ID and remove @userinfobot from the group
   
   **Method 3 - Check bot logs:**
   1. Add your bot to the group first
   2. Send a message in the group
   3. Check logs: `pm2 logs telegram-c-PORT | grep "chat.id"`
   4. The group ID will appear in the logs

5. **Update the environment variable:**
   ```bash
   # Edit .env and add:
   TELEGRAM_SYNC_GROUP_ID=-100XXXXXXXXXX
   ```

6. **Restart the client:**
   ```bash
   pm2 restart telegram-c-PORT
   pm2 save
   ```

### How Two-Way Sync Works

**Terminal -> Telegram:**
- When OpenCode sessions become idle in the terminal, they're synced to Telegram
- Each session creates a new Forum Topic with the conversation
- New messages in the session are posted to the topic

**Telegram -> Terminal:**
- Reply to any synced topic to send a message to that OpenCode session
- The bot shows reactions to indicate status: hourglass (processing), checkmark (done), X (error)
- Responses appear in both Telegram and terminal

**Notes:**
- Sessions started from Telegram are NOT synced back (to avoid duplicates)
- Messages in the "General" topic are ignored unless you @mention the bot
- The bot uses reactions instead of "typing..." messages for cleaner UX

---

## Bot Commands

Users can use these commands in Telegram:

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and feature overview |
| `/new` | Create a new chat session |
| `/sessions` | List recent sessions |
| `/model` | Show current model or set a new one |
| `/models` | Browse available models with inline buttons |
| `/help` | Show help information |

---

## Adding Additional Users

### First User (Admin)
The first person to message the bot automatically becomes the admin. The bot will:
1. Display their user ID
2. Add them to `TELEGRAM_ALLOWED_USERS` in `.env`
3. Exit (pm2 will restart it automatically)

### Additional Users
When an unauthorized user messages the bot, it replies with:
```
You are not authorized to use this bot.

Paste this into the chat to allow your user ID to control the machine:

Add user 123456789 to TELEGRAM_ALLOWED_USERS
```

To add them:
1. Edit the `.env` file
2. Add their user ID to `TELEGRAM_ALLOWED_USERS`:
   ```bash
   # Single user
   TELEGRAM_ALLOWED_USERS=123456789
   
   # Multiple users (comma-separated, no spaces)
   TELEGRAM_ALLOWED_USERS=123456789,987654321,555555555
   ```
3. Restart the client:
   ```bash
   pm2 restart telegram-c-PORT
   pm2 save
   ```

---

## Common Issues

### "Telegram polling error"
- Check `TELEGRAM_BOT_TOKEN` is correct
- Ensure no other bot instance is running with the same token
- Check: `pm2 list` for duplicate processes

### Voice messages not working
- Verify `OPENAI_API_KEY` is set correctly
- Check OpenAI account has credits
- Test: Send a voice message and check logs: `pm2 logs telegram-c-PORT`

### Video processing fails
- Ensure ffmpeg is installed: `apt install ffmpeg` or `brew install ffmpeg`
- Check: `which ffmpeg`

### Connection to OpenCode server failed
- Verify the server is running: `pm2 list`
- Check `OPENCODE_HOST` and `OPENCODE_PORT` match server settings
- Test connection: `curl http://127.0.0.1:4097/health`

### Bot not responding to messages
- Check if user is in whitelist: `grep TELEGRAM_ALLOWED_USERS .env`
- Check logs for errors: `pm2 logs telegram-c-PORT --lines 50`
- Verify bot is running: `pm2 list`

### "Request timed out" messages
- The AI may be waiting for input in the terminal
- Check the OpenCode terminal UI for pending questions
- This happens when the AI uses the `question` tool

### Forum Topics sync not working
- Verify `TELEGRAM_SYNC_GROUP_ID` is set correctly (starts with -100)
- Check bot has "Manage Topics" permission in the group
- Check logs: `pm2 logs telegram-c-PORT | grep SYNC`

### Duplicate topics being created
- This can happen after restarts if session mappings are lost
- The bot tracks sessions to prevent duplicates, but edge cases exist
- Not harmful, just cosmetic

---

## Useful Commands for Agents

```bash
# View real-time logs
pm2 logs telegram-c-PORT

# View last 100 lines
pm2 logs telegram-c-PORT --lines 100

# Restart client
pm2 restart telegram-c-PORT

# Restart server
pm2 restart telegram-s-PORT

# Stop all telegram processes
pm2 stop telegram-c-PORT telegram-s-PORT

# Delete processes
pm2 delete telegram-c-PORT telegram-s-PORT

# Always save after changes
pm2 save

# Check .env file
cat .env

# Edit .env file (use appropriate editor)
nano .env
# or use the Edit tool

# Check if port is in use
lsof -i :4097

# Test OpenCode server health
curl http://127.0.0.1:4097/health
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Telegram                              │
│  (Users send messages, voice, photos, videos)               │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   client.js (pm2: telegram-c-PORT)          │
│  - Telegram Bot API polling                                  │
│  - Voice transcription (Whisper)                            │
│  - Image/video processing                                    │
│  - Forum Topics sync                                         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   server.js (pm2: telegram-s-PORT)          │
│  - OpenCode SDK client                                       │
│  - Session management                                        │
│  - Model selection                                           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                      OpenCode Server                         │
│  (AI models, tools, file access)                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Files Overview

| File | Description |
|------|-------------|
| `client.js` | Telegram bot client - handles all Telegram interactions |
| `server.js` | Express server - bridges Telegram client to OpenCode |
| `.env` | Environment configuration (secrets, tokens, ports) |
| `.env.example` | Template for `.env` file |
| `package.json` | Node.js dependencies and scripts |
| `AGENTS.md` | This file - instructions for AI agents |
| `README.md` | User-facing documentation |
