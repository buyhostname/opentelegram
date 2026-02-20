/**
 * Telegram Sync Plugin for OpenCode
 * 
 * Syncs OpenCode sessions to Telegram Forum Topics in a configured group.
 * 
 * Installation:
 *   Copy to ~/.config/opencode/plugins/ or .opencode/plugins/
 * 
 * Configuration:
 *   Set TELEGRAM_SYNC_URL environment variable (default: http://127.0.0.1:4097)
 */

const SYNC_URL = process.env.TELEGRAM_SYNC_URL || 'http://127.0.0.1:4097';

// Track sessions we've created topics for
const syncedSessions = new Map();

// Track the last message we posted to avoid duplicates
const lastPostedContent = new Map();

/**
 * Main plugin export
 */
export const TelegramSyncPlugin = async ({ client, $, directory }) => {
    // Use client.app.log for structured logging
    await client.app.log({
        body: {
            service: "telegram-sync",
            level: "info",
            message: `Plugin initialized for ${directory}`,
        }
    });
    
    /**
     * POST to sync endpoint using curl via $
     */
    async function postSync(endpoint, data) {
        try {
            const jsonData = JSON.stringify(data);
            const result = await $`curl -s -X POST "${SYNC_URL}${endpoint}" -H "Content-Type: application/json" -d ${jsonData}`;
            return JSON.parse(result.stdout.toString());
        } catch (error) {
            await client.app.log({
                body: {
                    service: "telegram-sync",
                    level: "error",
                    message: `POST ${endpoint} failed: ${error.message}`,
                }
            });
            return null;
        }
    }
    
    /**
     * Get session messages from client
     */
    async function getSessionMessages(sessionId) {
        try {
            const result = await client.message.list({ sessionId });
            return result?.messages || [];
        } catch (error) {
            return [];
        }
    }
    
    /**
     * Extract text content from a message
     */
    function extractMessageContent(message) {
        if (!message || !message.parts) return '';
        let content = '';
        for (const part of message.parts) {
            if (part.type === 'text') {
                content += part.text || '';
            }
        }
        return content.trim();
    }
    
    /**
     * Get the latest user prompt and assistant response pair
     */
    function getLatestExchange(messages) {
        let lastUserIdx = -1;
        let lastAssistantIdx = -1;
        
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === 'assistant' && lastAssistantIdx === -1) {
                lastAssistantIdx = i;
            }
            if (msg.role === 'user' && lastAssistantIdx !== -1) {
                lastUserIdx = i;
                break;
            }
        }
        
        if (lastUserIdx === -1 || lastAssistantIdx === -1) {
            return null;
        }
        
        return {
            userMessage: messages[lastUserIdx],
            assistantMessage: messages[lastAssistantIdx]
        };
    }
    
    return {
        event: async ({ event }) => {
            // Log ALL events to see what's coming through
            await client.app.log({
                body: {
                    service: "telegram-sync",
                    level: "debug",
                    message: `Event received: ${event.type}`,
                }
            });
            
            // Handle session.created
            if (event.type === 'session.created') {
                const session = event.properties?.session;
                if (!session) return;
                
                await client.app.log({
                    body: {
                        service: "telegram-sync",
                        level: "info",
                        message: `Session created: ${session.id}`,
                    }
                });
                
                syncedSessions.set(session.id, { topicId: null, pending: true });
            }
            
            // Handle session.idle - post the latest exchange to Telegram
            if (event.type === 'session.idle') {
                const sessionId = event.properties?.sessionId || event.properties?.session?.id;
                if (!sessionId) return;
                
                await client.app.log({
                    body: {
                        service: "telegram-sync",
                        level: "info",
                        message: `Session idle: ${sessionId}`,
                    }
                });
                
                // Get messages for this session
                const messages = await getSessionMessages(sessionId);
                if (messages.length === 0) return;
                
                const exchange = getLatestExchange(messages);
                if (!exchange) return;
                
                const userContent = extractMessageContent(exchange.userMessage);
                const assistantContent = extractMessageContent(exchange.assistantMessage);
                
                if (!userContent && !assistantContent) return;
                
                // Check if we already posted this exact content (dedup)
                const lastPosted = lastPostedContent.get(sessionId);
                if (lastPosted && 
                    lastPosted.userContent === userContent && 
                    lastPosted.assistantContent === assistantContent) {
                    return;
                }
                
                // Get or create topic
                let syncState = syncedSessions.get(sessionId);
                
                if (!syncState || !syncState.topicId) {
                    const topicName = userContent.slice(0, 50) || 'OpenCode Session';
                    
                    await client.app.log({
                        body: {
                            service: "telegram-sync",
                            level: "info",
                            message: `Creating topic: "${topicName}"`,
                        }
                    });
                    
                    const result = await postSync('/sync/session', {
                        sessionId,
                        title: topicName,
                        directory
                    });
                    
                    if (result && result.topicId) {
                        syncState = { topicId: result.topicId };
                        syncedSessions.set(sessionId, syncState);
                    } else {
                        return;
                    }
                }
                
                // Post the message exchange to the topic
                await postSync('/sync/message', {
                    sessionId,
                    topicId: syncState.topicId,
                    userContent,
                    assistantContent,
                    messageId: exchange.assistantMessage.id
                });
                
                // Track what we posted to avoid duplicates
                lastPostedContent.set(sessionId, { userContent, assistantContent });
            }
            
            // Handle session.deleted - clean up
            if (event.type === 'session.deleted') {
                const sessionId = event.properties?.sessionId;
                if (sessionId) {
                    syncedSessions.delete(sessionId);
                    lastPostedContent.delete(sessionId);
                }
            }
        }
    };
};

export default TelegramSyncPlugin;
