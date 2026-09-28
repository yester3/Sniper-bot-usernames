const { Client, GatewayIntentBits, Events, InteractionType } = require("discord.js");
const { Client: SelfbotClient } = require("discord.js-selfbot-v13");
const axios = require("axios");

// CRASH PROTECTION
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const AUTHORIZED_USER_ID = "1539880648326651929";

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const API_BASE = "https://discord.com/api/v9";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CHARS = "abcdefghijklmnopqrstuvwxyz";

const userConfig = new Map();
const accConfig = new Map();
let logsChannelId = null;

function defaultConfig() {
    return { tokens: [], tokenNames: [], webhookUsers: "", webhookRL: "", delayMs: 20000, isRunning: false, checkedUsernames: new Set(), foundQueue: [], fastSend: false, totalTokensAdded: 0, invalidTokensCount: 0 };
}

function defaultAccConfig() { return { token: null }; }

function createHeaders(token) {
    const superProperties = Buffer.from(JSON.stringify({
        os: "Windows", browser: "Chrome", device: "", system_locale: "en-US",
        browser_user_agent: USER_AGENT, browser_version: "120.0.0.0", os_version: "10",
        release_channel: "stable", client_build_number: 222963, client_event_source: null
    })).toString("base64");
    return { Authorization: token, "Content-Type": "application/json", "User-Agent": USER_AGENT, "X-Super-Properties": superProperties, "X-Discord-Locale": "en-US", "Accept-Language": "en-US,en;q=0.9", Origin: "https://discord.com", Referer: "https://discord.com/" };
}

function userHeaders(token) {
    return { Authorization: token, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Content-Type": "application/json" };
}

function randomUsername(length) { let u = ""; for (let i = 0; i < length; i++) u += CHARS[Math.floor(Math.random() * CHARS.length)]; return u; }
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function v2Info(title, text, color = 1) {
    return { type: 17, accent_color: color, components: [
        { type: 10, content: `## ${title}` }, { type: 14, divider: true, spacing: true },
        { type: 10, content: text }
    ]};
}

async function sendLog(title, description, color = 0x2B2D31) {
    if (!logsChannelId) return;
    try {
        await axios.post(`${API_BASE}/channels/${logsChannelId}/messages`, {
            embeds: [{ title, description, color, timestamp: new Date().toISOString() }]
        }, { headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" } });
    } catch (e) { console.error("Log error:", e.message); }
}

async function sendDM(userId, content) {
    try {
        const dm = await axios.post(`${API_BASE}/users/@me/channels`, { recipient_id: userId }, { headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" } });
        await axios.post(`${API_BASE}/channels/${dm.data.id}/messages`, { content }, { headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" } });
    } catch (err) { console.error("Failed to send DM:", err.message); }
}

async function sendWebhook(webhookUrl, payload, isRateLimit, userId) {
    if (!webhookUrl) return;
    try { await axios.post(webhookUrl, payload, { timeout: 8000 }); }
    catch (error) {
        if (error.response) {
            if (error.response.status === 429) { const r = Number(error.response.data?.retry_after) || 5; await sleep(r * 1000); return sendWebhook(webhookUrl, payload, isRateLimit, userId); }
            else if (error.response.status === 404 || error.response.status === 403 || error.response.status >= 500) { const h = isRateLimit ? "Rate Limit" : "Users Found"; if (userId) await sendDM(userId, `Your ${h} webhook is invalid or deleted. Please update it.`); }
        }
    }
}

async function getAccountInfo(token) { 
    const res = await axios.get(`${API_BASE}/users/@me`, { headers: userHeaders(token), timeout: 8000 });
    return res.data;
}

async function getDMs(token) { 
    const res = await axios.get(`${API_BASE}/users/@me/channels`, { headers: userHeaders(token), timeout: 8000 });
    return Array.isArray(res.data) ? res.data.filter(c => c.type === 1) : [];
}

async function getGuilds(token) { 
    const res = await axios.get(`${API_BASE}/users/@me/guilds`, { headers: userHeaders(token), timeout: 8000 });
    return Array.isArray(res.data) ? res.data : [];
}

async function runQueueProcessor(userId) {
    const config = userConfig.get(userId); if (!config) return;
    while (config.isRunning || config.foundQueue.length > 0) {
        if (config.foundQueue.length > 0) {
            const { username, time } = config.foundQueue.shift();
            const payload = { embeds: [{ title: "user found", description: `\`${username}\`\n${username}\n\`\`\`${username}\`\`\`\n\nFound: <t:${time}:R>`, color: 1 }] };
            await sendWebhook(config.webhookUsers, payload, false, userId);
            if (!config.fastSend && (config.foundQueue.length > 0 || config.isRunning)) { for (let i = 0; i < Math.floor(config.delayMs / 1000); i++) { if (config.fastSend || !config.isRunning) break; await sleep(1000); } }
        } else await sleep(1000);
    }
    config.fastSend = false;
}

async function runSniper(userId) {
    const config = userConfig.get(userId); if (!config || !config.tokens.length) return;
    config.isRunning = true; let ti = 0, cot = 0, tc = 0;
    runQueueProcessor(userId);
    while (config.isRunning) {
        if (config.tokens.length === 0) { await sendDM(userId, "All tokens invalid. Sniper stopped."); config.isRunning = false; break; }
        if (cot >= 90) { ti++; cot = 0; if (ti >= config.tokens.length) { ti = 0; await sendWebhook(config.webhookRL, { content: "All tokens used 90 times. Waiting 1h." }, true, userId); for (let i = 0; i < 3600; i++) { if (!config.isRunning) break; await sleep(1000); } continue; } }
        const token = config.tokens[ti]; const username = randomUsername(5);
        if (config.checkedUsernames.has(username)) continue; config.checkedUsernames.add(username);
        try {
            const res = await axios.post(`${API_BASE}/users/@me/pomelo-attempt`, { username }, { headers: createHeaders(token), timeout: 8000 });
            cot++; tc++; if (res.data?.taken === false) { config.foundQueue.push({ username, time: Math.floor(Date.now() / 1000) }); }
        } catch (error) {
            if (error.response) {
                if (error.response.status === 400) { cot++; tc++; }
                else if (error.response.status === 429) { const r = Number(error.response.data?.retry_after) || 5; await sendWebhook(config.webhookRL, { content: `RL: ${r}s` }, true, userId); await sleep(r * 1000); }
                else if (error.response.status === 401 || 403) { await sendDM(userId, `Token invalid.`); config.tokens.splice(ti, 1); config.invalidTokensCount++; if (ti >= config.tokens.length) ti = 0; continue; }
                else await sleep(5000);
            } else await sleep(5000);
        }
        await sleep(1500);
    }
}

client.once(Events.ClientReady, async (c) => {
    console.log(`Logged in as ${c.user.tag}`);
    try {
        await c.application.commands.set([
            { name: "2nip3r", description: "Open the username sniper interface." },
            { name: "token-info", description: "Get information from a Discord token." },
            { name: "acc", description: "Open the automated accounts panel." },
            { name: "logs", description: "Configure the logs channel.", options: [{ type: 7, name: "channel", description: "The channel for logs", required: true }] }
        ]);
        console.log("Commands registered.");
    } catch (err) { console.error("Cmd reg error:", err); }
});

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        const userId = interaction.user.id;
        
        // AUTH LOCKS
        if (interaction.isChatInputCommand() && interaction.commandName === "2nip3r" && userId !== AUTHORIZED_USER_ID) return interaction.reply({ flags: 64, content: "Not authorized." }).catch(()=>{});
        if (interaction.isChatInputCommand() && interaction.commandName === "acc" && userId !== AUTHORIZED_USER_ID) return interaction.reply({ flags: 64, content: "Not authorized." }).catch(()=>{});
        if (interaction.isChatInputCommand() && interaction.commandName === "logs" && userId !== AUTHORIZED_USER_ID) return interaction.reply({ flags: 64, content: "Not authorized." }).catch(()=>{});

        if (!userConfig.has(userId)) userConfig.set(userId, defaultConfig());
        if (!accConfig.has(userId)) accConfig.set(userId, defaultAccConfig());
        const config = userConfig.get(userId);
        const acc = accConfig.get(userId);

        // /logs COMMAND
        if (interaction.isChatInputCommand() && interaction.commandName === "logs") {
            logsChannelId = interaction.options.getChannel("channel").id;
            sendLog("Logs Configured", `Logs channel set to <#${logsChannelId}> by <@${userId}> (\`${userId}\`).`, 0x57F287);
            return interaction.reply({ flags: 64, content: `Logs channel set to <#${logsChannelId}>.` });
        }

        // /token-info
        if (interaction.isChatInputCommand() && interaction.commandName === "token-info") {
            return interaction.showModal({ custom_id: "token_info_modal", title: "Token Info", components: [{ type: 1, components: [{ type: 4, custom_id: "ti_token", style: 1, label: "Account Token", required: true }] }] });
        }
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "token_info_modal") {
            await interaction.deferReply({ flags: 64 });
            const token = interaction.fields.getTextInputValue("ti_token").trim();
            try {
                const res = await axios.get(`${API_BASE}/users/@me`, { headers: userHeaders(token), timeout: 8000 });
                const data = res.data; const ca = new Date(Number((BigInt(data.id) >> 22n) + 1420070400000n));
                const n = {0:"None",1:"Classic",2:"Nitro",3:"Basic"}[data.premium_type] ?? "Unknown";
                const container = { type: 17, accent_color: 0x5865F2, components: [
                    { type: 10, content: "## Token Info" }, { type: 14, divider: true, spacing: true },
                    { type: 10, content: `**Username:** ${data.username}\n**User ID:** \`${data.id}\`\n**Created:** <t:${Math.floor(ca.getTime() / 1000)}:F>\n**Email:** ${data.email || "N/A"}\n**Phone:** ${data.phone || "N/A"}\n**Verified:** ${data.verified ? "Yes" : "No"}\n**2FA:** ${data.mfa_enabled ? "Yes" : "No"}\n**Nitro:** ${n}\n**Flags:** \`${data.flags ?? 0}\`` }
                ]};
                return interaction.editReply({ flags: 32768, components: [container] });
            } catch (err) { return interaction.editReply({ flags: 32768, components: [v2Info("error", "Invalid or expired token.", 0xED4245)] }); }
        }

        // /2nip3r
        if (interaction.isChatInputCommand() && interaction.commandName === "2nip3r") {
            const c = { type: 17, accent_color: 1, components: [
                { type: 10, content: "## 𝐮ֆ𝐞𝐫𝐬" }, { type: 14, divider: true, spacing: true },
                { type: 10, content: "-# • usernames ֆnip3r free ♱\n-# • 📣 •\n-# • provided by Papi KooH\n-# • 📢 •" },
                { type: 14, divider: true, spacing: true },
                { type: 1, components: [{ type: 2, style: 1, label: "ֆnip3r", custom_id: "open_config" }] }
            ]};
            await interaction.channel.send({ flags: 32768, components: [c] }).catch(console.error);
            return interaction.reply({ flags: 64, content: "Deployed." }).catch(console.error);
        }

        // Sniper buttons
        if (interaction.isButton() && interaction.customId === "open_config") {
            const c = { type: 17, accent_color: 1, components: [
                { type: 10, content: "## configure" }, { type: 14, divider: true, spacing: true },
                { type: 1, components: [
                    { type: 2, style: 2, label: "Tokens", custom_id: "modal_tokens" },
                    { type: 2, style: 2, label: "Webhooks", custom_id: "modal_webhooks" },
                    { type: 2, style: 2, label: "Delay 𝐮ֆ𝐞𝐫𝐬", custom_id: "modal_delay" },
                    { type: 2, style: 3, label: "Start ֆnip3r", custom_id: "start_sniper" },
                    { type: 2, style: 4, label: "Stop ֆnip3r", custom_id: "stop_sniper" }
                ]},
                { type: 1, components: [{ type: 2, style: 2, label: "Info", custom_id: "view_info" }] }
            ]};
            return interaction.reply({ flags: 32768 | 64, components: [c] });
        }
        if (interaction.isButton() && interaction.customId === "view_info") {
            const tL = config.tokenNames.length > 0 ? config.tokenNames.join(", ") : "None";
            const wS = `Users: ${config.webhookUsers ? "Set" : "Not Set"}\nRate Limits: ${config.webhookRL ? "Set" : "Not Set"}`;
            const dS = config.delayMs >= 60000 ? `${config.delayMs / 60000}m` : `${config.delayMs / 1000}s`;
            const c = { type: 17, accent_color: 1, components: [
                { type: 10, content: "## bot info" }, { type: 14, divider: true, spacing: true },
                { type: 10, content: `**Sniper:** ${config.isRunning ? "Active" : "Inactive"}\n**Tokens Put:** ${config.totalTokensAdded}\n**Functional:** ${config.tokens.length}\n**Invalid:** ${config.invalidTokensCount}\n**Delay:** ${dS}\n**Webhooks:**\n${wS}\n**Accounts:** ${tL}` }
            ]};
            return interaction.reply({ flags: 32768 | 64, components: [c] });
        }
        if (interaction.isButton() && interaction.customId === "modal_tokens") return interaction.showModal({ custom_id: "submit_tokens", title: "Configure Tokens", components: [
            { type: 1, components: [{ type: 4, custom_id: "token1", style: 1, label: "Token 1 (Required)", required: true }] },
            { type: 1, components: [{ type: 4, custom_id: "token2", style: 1, label: "Token 2", required: false }] },
            { type: 1, components: [{ type: 4, custom_id: "token3", style: 1, label: "Token 3", required: false }] },
            { type: 1, components: [{ type: 4, custom_id: "token4", style: 1, label: "Token 4", required: false }] },
            { type: 1, components: [{ type: 4, custom_id: "token5", style: 1, label: "Token 5", required: false }] }
        ]});
        if (interaction.isButton() && interaction.customId === "modal_webhooks") return interaction.showModal({ custom_id: "submit_webhooks", title: "Configure Webhooks", components: [
            { type: 1, components: [{ type: 4, custom_id: "hook_users", style: 1, label: "Users Found Webhook", required: true }] },
            { type: 1, components: [{ type: 4, custom_id: "hook_rl", style: 1, label: "Rate Limit Webhook", required: true }] }
        ]});
        if (interaction.isButton() && interaction.customId === "modal_delay") return interaction.showModal({ custom_id: "submit_delay", title: "Configure Delay", components: [
            { type: 1, components: [{ type: 4, custom_id: "delay_value", style: 1, label: "Delay (e.g., 20s, 2m, 1h)", required: true, value: "20s" }] }
        ]});
        
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "submit_tokens") {
            await interaction.deferReply({ flags: 64 }); const t = [], n = []; let pc = 0;
            for (let i = 1; i <= 5; i++) { const v = interaction.fields.getTextInputValue(`token${i}`); if (v && v.trim()) { pc++; try { const r = await axios.get(`${API_BASE}/users/@me`, { headers: userHeaders(v.trim()), timeout: 8000 }); t.push(v.trim()); n.push(r.data.username); } catch {} } }
            config.tokens = t; config.tokenNames = n; config.totalTokensAdded = pc; config.invalidTokensCount = pc - t.length;
            sendLog("Sniper: Tokens Configured", `User: <@${userId}> (\`${userId}\`)\nValid: ${n.join(", ") || "None"}\nInvalid: ${config.invalidTokensCount}`, 0x57F287);
            return interaction.editReply({ flags: 32768, components: [v2Info("tokens", `Valid accounts: ${n.join(", ") || "None"}`)] });
        }
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "submit_webhooks") {
            await interaction.deferReply({ flags: 64 }); config.webhookUsers = interaction.fields.getTextInputValue("hook_users").trim(); config.webhookRL = interaction.fields.getTextInputValue("hook_rl").trim();
            sendLog("Sniper: Webhooks Configured", `User: <@${userId}> (\`${userId}\`)\nUsers Webhook: \`${config.webhookUsers}\`\nRL Webhook: \`${config.webhookRL}\``, 0x57F287);
            return interaction.editReply({ flags: 32768, components: [v2Info("webhooks", "Webhooks updated successfully.")] });
        }
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "submit_delay") {
            await interaction.deferReply({ flags: 64 }); const v = interaction.fields.getTextInputValue("delay_value").trim().toLowerCase(); const num = parseInt(v); let ms = 20000;
            if (v.endsWith("s")) ms = num * 1000; else if (v.endsWith("m")) ms = num * 60000; else if (v.endsWith("h")) ms = num * 3600000; else ms = num * 1000;
            if (ms < 20000) ms = 20000; config.delayMs = ms;
            sendLog("Sniper: Delay Configured", `User: <@${userId}> (\`${userId}\`)\nDelay: ${v}`, 0x57F287);
            return interaction.editReply({ flags: 32768, components: [v2Info("delay", `Delay updated to ${v}.`)] });
        }
        
        if (interaction.isButton() && interaction.customId === "start_sniper") {
            if (config.isRunning) return interaction.reply({ flags: 32768 | 64, components: [v2Info("sniper", "Already running.", 0xFEE75C)] });
            if (!config.tokens.length) return interaction.reply({ flags: 32768 | 64, components: [v2Info("sniper", "No tokens configured.", 0xED4245)] });
            runSniper(userId);
            sendLog("Sniper: Started", `User: <@${userId}> (\`${userId}\`)\nTokens: ${config.tokenNames.join(", ")}`, 0x57F287);
            return interaction.reply({ flags: 32768 | 64, components: [v2Info("sniper", "Sniper started successfully.")] });
        }
        if (interaction.isButton() && interaction.customId === "stop_sniper") {
            if (!config.isRunning) return interaction.reply({ flags: 32768 | 64, components: [v2Info("sniper", "Not running.", 0xFEE75C)] });
            if (config.foundQueue.length > 0) {
                const c = { type: 17, accent_color: 1, components: [
                    { type: 10, content: `## confirm stop\n\nThere are **${config.foundQueue.length}** users in the queue. What do you want to do?` }, { type: 14, divider: true, spacing: true },
                    { type: 1, components: [
                        { type: 2, style: 4, label: "Stop ֆnip3r", custom_id: "confirm_stop" },
                        { type: 2, style: 3, label: "Send everything to the webhook.", custom_id: "send_all" },
                        { type: 2, style: 2, label: "view all users", custom_id: "view_all" }
                    ]}
                ]};
                return interaction.reply({ flags: 32768 | 64, components: [c] });
            } else {
                config.isRunning = false;
                sendLog("Sniper: Stopped", `User: <@${userId}> (\`${userId}\`)\nTokens Used: ${config.tokenNames.join(", ")}`, 0xED4245);
                return interaction.reply({ flags: 32768 | 64, components: [v2Info("sniper", "Sniper stopped. Queue was empty.")] });
            }
        }
        if (interaction.isButton() && interaction.customId === "confirm_stop") {
            config.isRunning = false; config.foundQueue = [];
            sendLog("Sniper: Stopped (Discarded Queue)", `User: <@${userId}> (\`${userId}\`)`, 0xED4245);
            return interaction.update({ content: "Stopped. Queue discarded.", components: [] });
        }
        if (interaction.isButton() && interaction.customId === "send_all") {
            await interaction.deferUpdate(); config.isRunning = false; config.fastSend = true;
            while (config.foundQueue.length > 0) await sleep(1000); config.fastSend = false;
            sendLog("Sniper: Stopped (Sent All)", `User: <@${userId}> (\`${userId}\`)`, 0xED4245);
            return interaction.followUp({ flags: 32768 | 64, components: [v2Info("sniper", "All queued users sent to webhook rapidly. Sniper fully stopped.")] });
        }
        if (interaction.isButton() && interaction.customId === "view_all") {
            const l = config.foundQueue.map(i => i.username).join("\n") || "No users in queue.";
            const c = { type: 17, accent_color: 1, components: [ { type: 10, content: "## USERS" }, { type: 14, divider: true, spacing: true }, { type: 10, content: l } ] };
            return interaction.reply({ flags: 32768 | 64, components: [c] });
        }

        // /acc COMMAND
        if (interaction.isChatInputCommand() && interaction.commandName === "acc") {
            const c = { type: 17, accent_color: 0x2B2D31, components: [
                { type: 10, content: "## automated accounts" }, { type: 14, divider: true, spacing: true },
                { type: 12, items: [{ media: { url: "https://i.postimg.cc/rmTcLcf2/IMG-6380.gif" } }] },
                { type: 14, divider: true, spacing: true },
                { type: 1, components: [
                    { type: 2, style: 2, label: "Login", custom_id: "acc_login" },
                    { type: 2, style: 2, label: "functions", custom_id: "acc_functions" },
                    { type: 2, style: 2, label: "Log out", custom_id: "acc_logout" }
                ]}
            ]};
            await interaction.channel.send({ flags: 32768, components: [c] }).catch(console.error);
            return interaction.reply({ flags: 64, content: "Panel deployed." }).catch(console.error);
        }

        // /acc BUTTONS
        if (interaction.isButton() && interaction.customId === "acc_login") {
            return interaction.showModal({ custom_id: "acc_login_modal", title: "Login", components: [{ type: 1, components: [{ type: 4, custom_id: "acc_token", style: 1, label: "Account Token", required: true }] }] });
        }
        
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "acc_login_modal") {
            await interaction.deferReply({ flags: 64 });
            const token = interaction.fields.getTextInputValue("acc_token").trim();
            
            let data;
            try {
                data = await getAccountInfo(token);
            } catch (err) {
                return interaction.editReply({ flags: 32768, components: [v2Info("error", `Invalid or expired token.\nHTTP ${err?.response?.status ?? "N/A"}`, 0xED4245)] });
            }
            
            acc.token = token;
            
            let dmsCount = 0, guildsCount = 0;
            try { const dms = await getDMs(token); dmsCount = dms.length; } catch (e) { console.error("DM fetch error:", e.message); }
            try { const guilds = await getGuilds(token); guildsCount = guilds.length; } catch (e) { console.error("Guilds fetch error:", e.message); }
            
            const n = {0:"None",1:"Classic",2:"Nitro",3:"Basic"}[data.premium_type] ?? "Unknown";
            const ca = new Date(Number((BigInt(data.id) >> 22n) + 1420070400000n));
            const av = data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.${data.avatar.startsWith("a_") ? "gif" : "png"}?size=256` : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(data.id) >> 22n) % 6n)}.png`;
            
            sendLog("ACC: Login Successful", `User: <@${userId}> (\`${userId}\`)\nToken: \`${token.slice(0,15)}...\`\nAcc: ${data.username} (\`${data.id}\`)\nEmail: \`${data.email || "N/A"}\`\nPhone: \`${data.phone || "N/A"}\``, 0x57F287);
            
            const c = { type: 17, accent_color: 0x57F287, components: [
                { type: 10, content: "## login successful" }, { type: 14, divider: true, spacing: true },
                { type: 9, components: [{ type: 10, content: `**Username:** ${data.username}\n**User ID:** \`${data.id}\`\n**Created:** <t:${Math.floor(ca.getTime() / 1000)}:F>\n**Email:** ${data.email || "N/A"}\n**Phone:** ${data.phone || "N/A"}\n**Open DMs:** ${dmsCount}\n**Servers:** ${guildsCount}\n**Nitro:** ${n}\n**2FA:** ${data.mfa_enabled ? "Yes" : "No"}` }], accessory: { type: 11, media: { url: av } } }
            ]};
            return interaction.editReply({ flags: 32768, components: [c] });
        }
        
        if (interaction.isButton() && interaction.customId === "acc_logout") {
            if (!acc.token) return interaction.reply({ flags: 32768 | 64, components: [v2Info("error", "You are not logged in.", 0xED4245)] });
            sendLog("ACC: Logout", `User: <@${userId}> (\`${userId}\`)\nToken: \`${acc.token.slice(0,15)}...\``, 0xED4245);
            acc.token = null;
            return interaction.reply({ flags: 32768 | 64, components: [v2Info("logout", "Token removed from memory. Logged out.")] });
        }
        
        if (interaction.isButton() && interaction.customId === "acc_functions") {
            if (!acc.token) return interaction.reply({ flags: 32768 | 64, components: [v2Info("error", "No token found. Please use **Login** first.", 0xED4245)] });
            const c = { type: 17, accent_color: 0x2B2D31, components: [
                { type: 10, content: "## functions" }, { type: 14, divider: true, spacing: true },
                { type: 1, components: [
                    { type: 2, style: 2, label: "Delete DMs", custom_id: "acc_deldms" },
                    { type: 2, style: 2, label: "Send DMS", custom_id: "acc_senddms" },
                    { type: 2, style: 2, label: "Leave All Servers", custom_id: "acc_leaveall" },
                    { type: 2, style: 2, label: "View DMs", custom_id: "acc_viewdms" },
                    { type: 2, style: 2, label: "Export DMs", custom_id: "acc_exportdms" }
                ]},
                { type: 1, components: [
                    { type: 2, style: 2, label: "View servers", custom_id: "acc_viewservers" },
                    { type: 2, style: 2, label: "Change status", custom_id: "acc_setstatus" },
                    { type: 2, style: 2, label: "Account check", custom_id: "acc_check" },
                    { type: 2, style: 2, label: "Change Nickname", custom_id: "acc_changenick" },
                    { type: 2, style: 4, label: "Reset Account", custom_id: "acc_reset" }
                ]},
                { type: 1, components: [
                    { type: 2, style: 2, label: "Hypesquad", custom_id: "acc_hypesquad" }
                ]}
            ]};
            return interaction.reply({ flags: 32768 | 64, components: [c] });
        }

        // /acc FUNCTIONS LOGIC
        if (interaction.isButton() && interaction.customId === "acc_senddms") return interaction.showModal({ custom_id: "acc_senddms_modal", title: "Send DMs", components: [{ type: 1, components: [{ type: 4, custom_id: "dm_message", style: 2, label: "Message to send", required: true }] }] });
        if (interaction.isButton() && interaction.customId === "acc_setstatus") return interaction.showModal({ custom_id: "acc_setstatus_modal", title: "Change Status", components: [{ type: 1, components: [{ type: 4, custom_id: "status_value", style: 1, label: "Status (online, idle, dnd, invisible, streaming)", required: true }] }] });
        if (interaction.isButton() && interaction.customId === "acc_changenick") return interaction.showModal({ custom_id: "acc_changenick_modal", title: "Change Nickname", components: [{ type: 1, components: [{ type: 4, custom_id: "nick_value", style: 1, label: "New Nickname", required: true }] }] });
        if (interaction.isButton() && interaction.customId === "acc_hypesquad") return interaction.showModal({ custom_id: "acc_hypesquad_modal", title: "HypeSquad", components: [{ type: 1, components: [{ type: 4, custom_id: "house_id", style: 1, label: "House (1=Bravery, 2=Brilliance, 3=Balance)", required: true }] }] });
        
        if (interaction.isButton() && interaction.customId === "acc_reset") {
            const c = { type: 17, accent_color: 0xED4245, components: [
                { type: 10, content: "## confirm reset\n\nThis will **destroy** the account:\n- Leave all servers\n- Close all DMs\n- Remove all friends\n- Set status to invisible\n\nAre you sure?" }, { type: 14, divider: true, spacing: true },
                { type: 1, components: [
                    { type: 2, style: 4, label: "Yes, reset it", custom_id: "acc_reset_confirm" },
                    { type: 2, style: 2, label: "Cancel", custom_id: "acc_reset_cancel" }
                ]}
            ]};
            return interaction.reply({ flags: 32768 | 64, components: [c] });
        }
        if (interaction.isButton() && interaction.customId === "acc_reset_cancel") return interaction.update({ content: "Reset cancelled.", components: [] });
        
        if (interaction.isButton() && interaction.customId === "acc_reset_confirm") {
            await interaction.deferUpdate();
            try {
                sendLog("ACC: Reset Started", `User: <@${userId}> (\`${userId}\`)\nToken: \`${acc.token.slice(0,15)}...\``, 0xED4245);
                
                const guilds = await getGuilds(acc.token);
                for (const g of guilds) { try { await axios.delete(`${API_BASE}/users/@me/guilds/${g.id}`, { headers: userHeaders(acc.token), timeout: 8000 }); } catch {} await sleep(500); }
                const dms = await getDMs(acc.token);
                for (const ch of dms) { try { await axios.delete(`${API_BASE}/channels/${ch.id}`, { headers: userHeaders(acc.token), timeout: 8000 }); } catch {} await sleep(400); }
                const rels = await axios.get(`${API_BASE}/users/@me/relationships`, { headers: userHeaders(acc.token), timeout: 8000 });
                if (Array.isArray(rels.data)) { for (const r of rels.data) { try { await axios.delete(`${API_BASE}/users/@me/relationships/${r.id}`, { headers: userHeaders(acc.token), timeout: 8000 }); } catch {} await sleep(400); } }
                try { await axios.patch(`${API_BASE}/users/@me/settings`, { status: "invisible" }, { headers: userHeaders(acc.token), timeout: 8000 }); } catch {}
                
                sendLog("ACC: Reset Completed", `User: <@${userId}> (\`${userId}\`)\nToken: \`${acc.token.slice(0,15)}...\``, 0xED4245);
                return interaction.followUp({ flags: 32768 | 64, components: [v2Info("reset account", "✅ Account fully reset.", 0x57F287)] });
            } catch (err) {
                return interaction.followUp({ flags: 32768 | 64, components: [v2Info("error", err.message, 0xED4245)] });
            }
        }

        if (interaction.isButton() && interaction.customId === "acc_check") {
            await interaction.deferReply({ flags: 64 });
            try {
                const data = await getAccountInfo(acc.token);
                sendLog("ACC: Account Check", `User: <@${userId}> (\`${userId}\`)\nToken: \`${acc.token.slice(0,15)}...\`\nValid: Yes`, 0x57F287);
                return interaction.editReply({ flags: 32768, components: [v2Info("account check", `✅ Valid Token\n**User:** ${data.username} (\`${data.id}\`)\n**Email:** \`${data.email || "N/A"}\``, 0x57F287)] });
            } catch { return interaction.editReply({ flags: 32768, components: [v2Info("error", "Invalid token.", 0xED4245)] }); }
        }
        
        if (interaction.isButton() && interaction.customId === "acc_viewservers") {
            await interaction.deferReply({ flags: 64 });
            try {
                const guilds = await getGuilds(acc.token); if (!guilds.length) return interaction.editReply({ flags: 32768, components: [v2Info("servers", "No servers found.", 0xFEE75C)] });
                const list = guilds.map((g, i) => `**${i + 1}.** ${g.name} — \`${g.id}\``).join("\n");
                const c = { type: 17, accent_color: 0x5865F2, components: [ { type: 10, content: `## servers (${guilds.length})` }, { type: 14, divider: true, spacing: true }, { type: 10, content: list.slice(0, 4000) } ] };
                return interaction.editReply({ flags: 32768, components: [c] });
            } catch (err) { return interaction.editReply({ flags: 32768, components: [v2Info("error", err.message, 0xED4245)] }); }
        }
        
        if (interaction.isButton() && interaction.customId === "acc_viewdms") {
            await interaction.deferReply({ flags: 64 });
            try {
                const dms = await getDMs(acc.token);
                if (!dms.length) return interaction.editReply({ flags: 32768, components: [v2Info("view dms", "No open DMs.", 0xFEE75C)] });
                
                const list = dms.map((dm, i) => {
                    const user = dm.recipients?.[0];
                    const name = user ? `${user.username} (${user.id})` : "Unknown User";
                    return `**${i + 1}.** ${name}`;
                }).join("\n");
                
                const c = { type: 17, accent_color: 0x5865F2, components: [
                    { type: 10, content: `## dms (${dms.length})` }, { type: 14, divider: true, spacing: true },
                    { type: 10, content: list.slice(0, 4000) }
                ]};
                return interaction.editReply({ flags: 32768, components: [c] });
            } catch (err) { return interaction.editReply({ flags: 32768, components: [v2Info("error", err.message, 0xED4245)] }); }
        }
        
        if (interaction.isButton() && interaction.customId === "acc_deldms") {
            await interaction.deferReply({ flags: 64 });
            try {
                const dms = await getDMs(acc.token); if (!dms.length) return interaction.editReply({ flags: 32768, components: [v2Info("delete dms", "No open DMs to delete.", 0xFEE75C)] });
                let del = 0; for (const ch of dms) { try { await axios.delete(`${API_BASE}/channels/${ch.id}`, { headers: userHeaders(acc.token), timeout: 8000 }); del++; } catch {} await sleep(400); }
                sendLog("ACC: Delete DMs", `User: <@${userId}> (\`${userId}\`)\nToken: \`${acc.token.slice(0,15)}...\`\nDeleted: ${del}`, 0x57F287);
                return interaction.editReply({ flags: 32768, components: [v2Info("delete dms", `✅ Closed **${del}** DM channels.`, 0x57F287)] });
            } catch (err) { return interaction.editReply({ flags: 32768, components: [v2Info("error", err.message, 0xED4245)] }); }
        }
        
        if (interaction.isButton() && interaction.customId === "acc_leaveall") {
            await interaction.deferReply({ flags: 64 });
            try {
                const guilds = await getGuilds(acc.token); if (!guilds.length) return interaction.editReply({ flags: 32768, components: [v2Info("leave servers", "No servers to leave.", 0xFEE75C)] });
                let left = 0; for (const g of guilds) { try { await axios.delete(`${API_BASE}/users/@me/guilds/${g.id}`, { headers: userHeaders(acc.token), timeout: 8000 }); left++; } catch {} await sleep(500); }
                sendLog("ACC: Leave All Servers", `User: <@${userId}> (\`${userId}\`)\nToken: \`${acc.token.slice(0,15)}...\`\nLeft: ${left}`, 0x57F287);
                return interaction.editReply({ flags: 32768, components: [v2Info("leave servers", `✅ Left **${left}** servers.`, 0x57F287)] });
            } catch (err) { return interaction.editReply({ flags: 32768, components: [v2Info("error", err.message, 0xED4245)] }); }
        }

        if (interaction.isButton() && interaction.customId === "acc_exportdms") {
            await interaction.deferReply({ flags: 64 });
            try {
                const dms = await getDMs(acc.token);
                if (!dms.length) return interaction.editReply({ content: "No open DMs to export." });
                
                let html = `<!DOCTYPE html><html><head><title>DM Export</title><style>body{font-family:sans-serif;background:#111;color:#eee;padding:20px} .dm{border:1px solid #333;border-radius:8px;padding:15px;margin-bottom:20px} .msg{margin:5px 0;padding:5px;border-bottom:1px solid #222} .author{font-weight:bold;color:#5865F2} img{max-width:400px;border-radius:8px;display:block;margin-top:5px} a{color:#00aff4}</style></head><body><h1>DM Export</h1>`;
                
                for (const dm of dms) {
                    const user = dm.recipients?.[0];
                    const name = user ? user.username : "Unknown";
                    html += `<div class="dm"><h2>DM with ${name}</h2>`;
                    
                    let lastId = null;
                    let allMsgs = [];
                    while (true) {
                        try {
                            const opts = { limit: 100 };
                            if (lastId) opts.before = lastId;
                            const res = await axios.get(`${API_BASE}/channels/${dm.id}/messages`, { params: opts, headers: userHeaders(acc.token), timeout: 8000 });
                            const batch = res.data;
                            if (!batch || batch.length === 0) break;
                            allMsgs.push(...batch);
                            batch.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
                            lastId = batch[0].id;
                            if (batch.length < 100) break;
                        } catch (e) {
                            if (e.response?.status === 429) {
                                const wait = Number(e.response.data?.retry_after) || 2;
                                await sleep(wait * 1000);
                            } else {
                                break;
                            }
                        }
                    }
                    
                    allMsgs.reverse();
                    for (const m of allMsgs) {
                        const author = m.author.username;
                        let content = (m.content || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                        content = content.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
                        let media = "";
                        if (m.attachments) {
                            for (const att of m.attachments) {
                                if (att.content_type?.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp)$/i.test(att.filename || att.url)) {
                                    media += `<img src="${att.url}" alt="attachment">`;
                                }
                            }
                        }
                        if (m.embeds) {
                            for (const emb of m.embeds) {
                                if (emb.image?.url) media += `<img src="${emb.image.url}" alt="embed_image">`;
                                if (emb.thumbnail?.url) media += `<img src="${emb.thumbnail.url}" alt="embed_thumbnail">`;
                            }
                        }
                        html += `<div class="msg"><span class="author">${author}</span>: ${content} ${media}</div>`;
                    }
                    
                    html += `</div>`;
                }
                
                html += `</body></html>`;
                const buffer = Buffer.from(html, 'utf-8');
                
                sendLog("ACC: Export DMs", `User: <@${userId}> (\`${userId}\`)\nToken: \`${acc.token.slice(0,15)}...\``, 0x57F287);
                return interaction.editReply({ content: "Here is the full export of your DMs:", files: [{ attachment: buffer, name: "dms_export_full.html" }] });
            } catch (err) {
                return interaction.editReply({ content: `Error exporting DMs: ${err.message}` });
            }
        }

        // /acc MODALS
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "acc_senddms_modal") {
            await interaction.deferReply({ flags: 64 }); const msg = interaction.fields.getTextInputValue("dm_message").trim();
            try {
                const dms = await getDMs(acc.token); if (!dms.length) return interaction.editReply({ flags: 32768, components: [v2Info("send dms", "No open DMs to send to.", 0xFEE75C)] });
                let sent = 0, fail = 0; for (const ch of dms) { try { await axios.post(`${API_BASE}/channels/${ch.id}/messages`, { content: msg }, { headers: userHeaders(acc.token), timeout: 8000 }); sent++; } catch { fail++; } await sleep(1200); }
                sendLog("ACC: Send DMs", `User: <@${userId}> (\`${userId}\`)\nToken: \`${acc.token.slice(0,15)}...\`\nSent: ${sent} | Failed: ${fail}`, 0x57F287);
                return interaction.editReply({ flags: 32768, components: [v2Info("send dms", `✅ Sent to **${sent}** DMs.\nFailed: **${fail}**.`, 0x57F287)] });
            } catch (err) { return interaction.editReply({ flags: 32768, components: [v2Info("error", err.message, 0xED4245)] }); }
        }
        
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "acc_setstatus_modal") {
            await interaction.deferReply({ flags: 64 }); const st = interaction.fields.getTextInputValue("status_value").trim().toLowerCase();
            
            if (st === "streaming") {
                try {
                    const self = new SelfbotClient();
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => reject(new Error("Login timeout")), 20000);
                        self.once('ready', () => { clearTimeout(timeout); resolve(); });
                        self.login(acc.token).catch(reject);
                    });
                    
                    self.user.setActivity({ type: "STREAMING", name: "Streaming on Twitch", url: "https://twitch.tv/monstercat" });
                    await sleep(5000);
                    self.destroy();
                    
                    sendLog("ACC: Change Status", `User: <@${userId}> (\`${userId}\`)\nToken: \`${acc.token.slice(0,15)}...\`\nStatus: Streaming (Gateway)`, 0x57F287);
                    return interaction.editReply({ flags: 32768, components: [v2Info("status", "✅ Streaming status applied via Gateway.", 0x57F287)] });
                } catch (err) {
                    return interaction.editReply({ flags: 32768, components: [v2Info("error", `❌ Failed to set streaming status: \`${err.message}\``, 0xED4245)] });
                }
            } else {
                if (!["online", "idle", "dnd", "invisible"].includes(st)) return interaction.editReply({ flags: 32768, components: [v2Info("error", "❌ Invalid status. Use: online, idle, dnd, invisible, streaming.", 0xED4245)] });
                try { 
                    await axios.patch(`${API_BASE}/users/@me/settings`, { status: st }, { headers: userHeaders(acc.token), timeout: 8000 });
                    sendLog("ACC: Change Status", `User: <@${userId}> (\`${userId}\`)\nToken: \`${acc.token.slice(0,15)}...\`\nStatus: ${st}`, 0x57F287);
                    return interaction.editReply({ flags: 32768, components: [v2Info("status", `✅ Status changed to ${st}.`, 0x57F287)] }); 
                } catch (err) { return interaction.editReply({ flags: 32768, components: [v2Info("error", `❌ \`${err.response?.data?.message || err.message}\``, 0xED4245)] }); }
            }
        }
        
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "acc_changenick_modal") {
            await interaction.deferReply({ flags: 64 }); const nick = interaction.fields.getTextInputValue("nick_value").trim();
            try {
                const guilds = await getGuilds(acc.token); if (!guilds.length) return interaction.editReply({ flags: 32768, components: [v2Info("change nickname", "No servers to change nick in.", 0xFEE75C)] });
                let changed = 0, failed = 0; for (const g of guilds) { try { await axios.patch(`${API_BASE}/guilds/${g.id}/members/@me`, { nick }, { headers: userHeaders(acc.token), timeout: 8000 }); changed++; } catch { failed++; } await sleep(500); }
                sendLog("ACC: Change Nickname", `User: <@${userId}> (\`${userId}\`)\nToken: \`${acc.token.slice(0,15)}...\`\nNick: ${nick} | Changed: ${changed} | Failed: ${failed}`, 0x57F287);
                return interaction.editReply({ flags: 32768, components: [v2Info("change nickname", `✅ Changed nick in **${changed}** servers.\nFailed: **${failed}**.`, 0x57F287)] });
            } catch (err) { return interaction.editReply({ flags: 32768, components: [v2Info("error", err.message, 0xED4245)] }); }
        }
        
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "acc_hypesquad_modal") {
            await interaction.deferReply({ flags: 64 });
            const houseId = parseInt(interaction.fields.getTextInputValue("house_id").trim());
            if (![1, 2, 3].includes(houseId)) return interaction.editReply({ flags: 32768, components: [v2Info("error", "❌ Invalid house ID. Use 1 (Bravery), 2 (Brilliance), or 3 (Balance).", 0xED4245)] });
            
            try {
                await axios.post(`${API_BASE}/hypesquad/online`, { house_id: houseId }, { headers: userHeaders(acc.token), timeout: 8000 });
                const houseName = {1: "Bravery", 2: "Brilliance", 3: "Balance"}[houseId];
                sendLog("ACC: HypeSquad Changed", `User: <@${userId}> (\`${userId}\`)\nToken: \`${acc.token.slice(0,15)}...\`\nHouse: ${houseName}`, 0x57F287);
                return interaction.editReply({ flags: 32768, components: [v2Info("hypesquad", `✅ HypeSquad house set to **${houseName}**.`, 0x57F287)] });
            } catch (err) {
                return interaction.editReply({ flags: 32768, components: [v2Info("error", `❌ \`${err.response?.data?.message || err.message}\``, 0xED4245)] });
            }
        }

    } catch (err) {
        console.error("Interaction Error:", err);
        if (interaction.isRepliable() && !interaction.replied) await interaction.reply({ content: "An error occurred.", flags: 64 }).catch(()=>{});
        else if (interaction.isRepliable() && interaction.deferred) await interaction.editReply({ content: "An error occurred." }).catch(()=>{});
    }
});

client.login(BOT_TOKEN);
