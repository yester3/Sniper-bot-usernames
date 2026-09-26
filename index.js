const { Client, GatewayIntentBits, Events, InteractionType } = require("discord.js");
const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN;
const AUTHORIZED_USER_ID = "1539880648326651929";

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const API_BASE = "https://discord.com/api/v9";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CHARS = "abcdefghijklmnopqrstuvwxyz";

const userConfig = new Map();

function defaultConfig() {
    return {
        tokens: [],
        tokenNames: [],
        webhookUsers: "",
        webhookRL: "",
        delayMs: 20000, // 20 seconds default
        isRunning: false,
        checkedUsernames: new Set(),
        foundQueue: [],
        fastSend: false
    };
}

function createHeaders(token) {
    const superProperties = Buffer.from(JSON.stringify({
        os: "Windows",
        browser: "Chrome",
        device: "",
        system_locale: "en-US",
        browser_user_agent: USER_AGENT,
        browser_version: "120.0.0.0",
        os_version: "10",
        release_channel: "stable",
        client_build_number: 222963,
        client_event_source: null
    })).toString("base64");

    return {
        Authorization: token,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "X-Super-Properties": superProperties,
        "X-Discord-Locale": "en-US",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: "https://discord.com",
        Referer: "https://discord.com/"
    };
}

function randomUsername(length) {
    let username = "";
    for (let i = 0; i < length; i++) {
        username += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return username;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function sendDM(userId, content) {
    try {
        const dm = await axios.post(`${API_BASE}/users/@me/channels`, 
            { recipient_id: userId },
            { headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" } }
        );
        await axios.post(`${API_BASE}/channels/${dm.data.id}/messages`, 
            { content },
            { headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" } }
        );
    } catch (err) {
        console.error("Failed to send DM:", err.message);
    }
}

async function sendWebhook(webhookUrl, payload, isRateLimit = false) {
    if (!webhookUrl) return;
    try {
        await axios.post(webhookUrl, payload, { timeout: 8000 });
    } catch (error) {
        if (error.response) {
            if (error.response.status === 429) {
                const retryAfter = Number(error.response.data?.retry_after) || 5;
                await sleep(retryAfter * 1000);
                return sendWebhook(webhookUrl, payload, isRateLimit);
            } else if (error.response.status === 404 || error.response.status === 403 || error.response.status >= 500) {
                const hookType = isRateLimit ? "Rate Limit" : "Users Found";
                await sendDM(AUTHORIZED_USER_ID, `Your ${hookType} webhook is invalid, deleted, or unreachable. Please update it in the bot config.`);
            }
        }
    }
}

async function runQueueProcessor(userId) {
    const config = userConfig.get(userId);
    if (!config) return;

    while (config.isRunning || config.foundQueue.length > 0) {
        if (config.foundQueue.length > 0) {
            const { username, time } = config.foundQueue.shift();
            
            const payload = {
                embeds: [{
                    title: "user found",
                    description: `\`${username}\`\n${username}\n\`\`\`${username}\`\`\`\n\nFound: <t:${time}:R>`,
                    color: 1
                }]
            };
            
            await sendWebhook(config.webhookUsers, payload, false);
            
            // Wait the delay ONLY if fastSend is false and sniper is still running
            if (!config.fastSend && (config.foundQueue.length > 0 || config.isRunning)) {
                // Break sleep into 1s chunks to respond to fastSend instantly
                for (let i = 0; i < Math.floor(config.delayMs / 1000); i++) {
                    if (config.fastSend || !config.isRunning) break;
                    await sleep(1000);
                }
            }
        } else {
            await sleep(1000);
        }
    }
    
    config.fastSend = false; // Reset flag when done
    console.log("[Sender] Queue processor stopped.");
}

async function runSniper(userId) {
    const config = userConfig.get(userId);
    if (!config || !config.tokens.length) return;

    config.isRunning = true;
    let tokenIndex = 0;
    let checksOnToken = 0;
    let totalChecks = 0;

    runQueueProcessor(userId);

    while (config.isRunning) {
        if (config.tokens.length === 0) {
            await sendDM(userId, "All tokens have become invalid. The sniper has stopped automatically. Please update your tokens.");
            config.isRunning = false;
            break;
        }

        if (checksOnToken >= 100) {
            console.log(`[Sniper] Token ${tokenIndex + 1} reached 100 checks. Rotating...`);
            tokenIndex++;
            checksOnToken = 0;
            if (tokenIndex >= config.tokens.length) {
                tokenIndex = 0;
                console.log("[Sniper] All tokens exhausted. Waiting 1 hour before resuming.");
                await sendWebhook(config.webhookRL, { content: "All tokens have been used 100 times. Waiting 1 hour before resuming." }, true);
                for (let i = 0; i < 3600; i++) {
                    if (!config.isRunning) break;
                    await sleep(1000);
                }
                continue;
            }
        }

        const token = config.tokens[tokenIndex];
        const username = randomUsername(5);

        if (config.checkedUsernames.has(username)) continue;
        config.checkedUsernames.add(username);

        try {
            const res = await axios.post(
                `${API_BASE}/users/@me/pomelo-attempt`,
                { username },
                { headers: createHeaders(token), timeout: 8000 }
            );

            checksOnToken++;
            totalChecks++;

            if (res.data?.taken === false) {
                console.log(`[Sniper] Found available user: ${username}. Added to queue.`);
                const time = Math.floor(Date.now() / 1000);
                config.foundQueue.push({ username, time });
            }
        } catch (error) {
            if (error.response) {
                if (error.response.status === 400) {
                    checksOnToken++;
                    totalChecks++;
                } else if (error.response.status === 429) {
                    const retryAfter = Number(error.response.data?.retry_after) || 5;
                    console.warn(`[Sniper] Rate limited. Waiting ${retryAfter}s.`);
                    await sendWebhook(config.webhookRL, { content: `Rate limited. Waiting ${retryAfter}s before retrying.` }, true);
                    await sleep(retryAfter * 1000);
                } else if (error.response.status === 401 || error.response.status === 403) {
                    console.warn(`[Sniper] Token ${tokenIndex + 1} invalid. Removing and notifying.`);
                    await sendDM(userId, `Token \`${token.slice(0, 15)}...\` has become invalid and was removed.`);
                    config.tokens.splice(tokenIndex, 1);
                    if (tokenIndex >= config.tokens.length) tokenIndex = 0;
                    continue;
                } else {
                    console.error("[Sniper] Unknown API error:", error.response.status);
                    await sleep(5000);
                }
            } else {
                await sleep(5000);
            }
        }

        if (totalChecks % 50 === 0) {
            console.log(`[Sniper] Heartbeat: Total checks: ${totalChecks} | Current token checks: ${checksOnToken}`);
        }

        await sleep(1500);
    }
    
    console.log("[Sniper] Stopped.");
}

client.once(Events.ClientReady, async (c) => {
    console.log(`Logged in as ${c.user.tag}`);
    try {
        await c.application.commands.set([
            {
                name: "2nip3r",
                description: "Open the username sniper interface."
            }
        ]);
        console.log("Global slash command registered successfully.");
    } catch (err) {
        console.error("Failed to register global command:", err);
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.user.id !== AUTHORIZED_USER_ID) {
        if (interaction.isChatInputCommand() || interaction.isButton() || interaction.type === InteractionType.ModalSubmit) {
            return interaction.reply({ flags: 64, content: "You are not authorized to use this bot." }).catch(() => {});
        }
        return;
    }

    if (!userConfig.has(interaction.user.id)) {
        userConfig.set(interaction.user.id, defaultConfig());
    }
    const config = userConfig.get(interaction.user.id);

    // Slash Command
    if (interaction.isChatInputCommand() && interaction.commandName === "2nip3r") {
        const mainContainer = {
            type: 17,
            accent_color: 1,
            components: [
                { type: 10, content: "## 𝐮ֆ𝐞𝐫𝐬" },
                { type: 14, divider: true, spacing: true },
                { type: 10, content: "-# • usernames ֆnip3r free ♱\n-# • 📣 •\n-# • provided by Papi Koah\n-# • 📢 •" },
                { type: 14, divider: true, spacing: true },
                { type: 1, components: [{ type: 2, style: 1, label: "ֆnip3r", custom_id: "open_config" }] }
            ]
        };
        
        await interaction.channel.send({ flags: 32768, components: [mainContainer] }).catch(console.error);
        return interaction.reply({ flags: 64, content: "Sniper interface deployed." }).catch(console.error);
    }

    // Button: Open Config
    if (interaction.isButton() && interaction.customId === "open_config") {
        const configContainer = {
            type: 17,
            accent_color: 1,
            components: [
                { type: 10, content: "## configure" },
                { type: 14, divider: true, spacing: true },
                { type: 1, components: [
                    { type: 2, style: 2, label: "Tokens", custom_id: "modal_tokens" },
                    { type: 2, style: 2, label: "Webhooks", custom_id: "modal_webhooks" },
                    { type: 2, style: 2, label: "Delay 𝐮ֆ𝐞𝐫𝐬", custom_id: "modal_delay" },
                    { type: 2, style: 3, label: "Start ֆnip3r", custom_id: "start_sniper" },
                    { type: 2, style: 4, label: "Stop ֆnip3r", custom_id: "stop_sniper" }
                ]}
            ]
        };
        return interaction.reply({ flags: 32768 | 64, components: [configContainer] });
    }

    // Button: Open Tokens Modal
    if (interaction.isButton() && interaction.customId === "modal_tokens") {
        const modal = {
            custom_id: "submit_tokens",
            title: "Configure Tokens",
            components: [
                { type: 1, components: [{ type: 4, custom_id: "token1", style: 1, label: "Token 1 (Required)", required: true }] },
                { type: 1, components: [{ type: 4, custom_id: "token2", style: 1, label: "Token 2", required: false }] },
                { type: 1, components: [{ type: 4, custom_id: "token3", style: 1, label: "Token 3", required: false }] },
                { type: 1, components: [{ type: 4, custom_id: "token4", style: 1, label: "Token 4", required: false }] },
                { type: 1, components: [{ type: 4, custom_id: "token5", style: 1, label: "Token 5", required: false }] }
            ]
        };
        return interaction.showModal(modal);
    }

    // Button: Open Webhooks Modal
    if (interaction.isButton() && interaction.customId === "modal_webhooks") {
        const modal = {
            custom_id: "submit_webhooks",
            title: "Configure Webhooks",
            components: [
                { type: 1, components: [{ type: 4, custom_id: "hook_users", style: 1, label: "Users Found Webhook", required: true }] },
                { type: 1, components: [{ type: 4, custom_id: "hook_rl", style: 1, label: "Rate Limit Webhook", required: true }] }
            ]
        };
        return interaction.showModal(modal);
    }

    // Button: Open Delay Modal
    if (interaction.isButton() && interaction.customId === "modal_delay") {
        const modal = {
            custom_id: "submit_delay",
            title: "Configure Delay",
            components: [
                { type: 1, components: [{ type: 4, custom_id: "delay_value", style: 1, label: "Delay (e.g., 20s, 2m, 1h)", required: true, value: "20s" }] }
            ]
        };
        return interaction.showModal(modal);
    }

    // Modal Submit: Tokens
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "submit_tokens") {
        await interaction.deferReply({ flags: 64 });
        const tokens = [];
        const names = [];
        for (let i = 1; i <= 5; i++) {
            const t = interaction.fields.getTextInputValue(`token${i}`);
            if (t && t.trim()) {
                try {
                    const res = await axios.get(`${API_BASE}/users/@me`, { headers: createHeaders(t.trim()), timeout: 8000 });
                    tokens.push(t.trim());
                    names.push(res.data.username);
                } catch (err) {}
            }
        }
        config.tokens = tokens;
        config.tokenNames = names;
        return interaction.editReply({ content: `Tokens updated. Valid accounts: ${names.join(", ") || "None"}` });
    }

    // Modal Submit: Webhooks
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "submit_webhooks") {
        await interaction.deferReply({ flags: 64 });
        config.webhookUsers = interaction.fields.getTextInputValue("hook_users").trim();
        config.webhookRL = interaction.fields.getTextInputValue("hook_rl").trim();
        return interaction.editReply({ content: "Webhooks updated." });
    }

    // Modal Submit: Delay
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "submit_delay") {
        await interaction.deferReply({ flags: 64 });
        const val = interaction.fields.getTextInputValue("delay_value").trim().toLowerCase();
        const num = parseInt(val);
        let ms = 20000;
        if (val.endsWith("s")) ms = num * 1000;
        else if (val.endsWith("m")) ms = num * 60000;
        else if (val.endsWith("h")) ms = num * 3600000;
        else ms = num * 1000;
        if (ms < 20000) ms = 20000; // Enforce 20s minimum
        config.delayMs = ms;
        return interaction.editReply({ content: `Delay updated to ${val} (min 20s).` });
    }

    // Button: Start Sniper
    if (interaction.isButton() && interaction.customId === "start_sniper") {
        if (config.isRunning) return interaction.reply({ flags: 64, content: "Sniper is already running." });
        if (!config.tokens.length) return interaction.reply({ flags: 64, content: "No valid tokens configured." });
        runSniper(interaction.user.id);
        return interaction.reply({ flags: 64, content: "Sniper started." });
    }

    // Button: Stop Sniper (Check Queue)
    if (interaction.isButton() && interaction.customId === "stop_sniper") {
        if (!config.isRunning) return interaction.reply({ flags: 64, content: "Sniper is not running." });
        
        if (config.foundQueue.length > 0) {
            const confirmContainer = {
                type: 17,
                accent_color: 1,
                components: [
                    { type: 10, content: `## confirm stop\n\nThere are **${config.foundQueue.length}** users in the queue. What do you want to do?` },
                    { type: 14, divider: true, spacing: true },
                    { type: 1, components: [
                        { type: 2, style: 4, label: "Stop ֆnip3r", custom_id: "confirm_stop" },
                        { type: 2, style: 3, label: "Send everything to the webhook.", custom_id: "send_all" },
                        { type: 2, style: 2, label: "view all users", custom_id: "view_all" }
                    ]}
                ]
            };
            return interaction.reply({ flags: 32768 | 64, components: [confirmContainer] });
        } else {
            config.isRunning = false;
            return interaction.reply({ flags: 64, content: "Sniper stopped. Queue was empty." });
        }
    }

    // Button: Confirm Stop
    if (interaction.isButton() && interaction.customId === "confirm_stop") {
        config.isRunning = false;
        config.foundQueue = []; // Discard queue
        return interaction.update({ content: "Sniper stopped totally. Queue discarded.", components: [] });
    }

    // Button: Send Everything
    if (interaction.isButton() && interaction.customId === "send_all") {
        await interaction.deferUpdate();
        config.isRunning = false; // Stop sniper from finding more
        config.fastSend = true;   // Tell queue processor to skip delays
        
        // Wait for queue to drain
        while (config.foundQueue.length > 0) {
            await sleep(1000);
        }
        
        config.fastSend = false;
        return interaction.followUp({ flags: 64, content: "All queued users sent to webhook rapidly. Sniper fully stopped." });
    }

    // Button: View All
    if (interaction.isButton() && interaction.customId === "view_all") {
        const usersList = config.foundQueue.map(item => item.username).join("\n") || "No users in queue.";
        const viewContainer = {
            type: 17,
            accent_color: 1,
            components: [
                { type: 10, content: "## USERS" },
                { type: 14, divider: true, spacing: true },
                { type: 10, content: usersList }
            ]
        };
        return interaction.reply({ flags: 32768 | 64, components: [viewContainer] });
    }
});

client.login(BOT_TOKEN);
