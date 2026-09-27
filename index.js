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
const accConfig = new Map(); // For /acc tokens

function defaultConfig() {
    return {
        tokens: [],
        tokenNames: [],
        webhookUsers: "",
        webhookRL: "",
        delayMs: 20000, 
        isRunning: false,
        checkedUsernames: new Set(),
        foundQueue: [],
        fastSend: false,
        totalTokensAdded: 0,
        invalidTokensCount: 0
    };
}

function defaultAccConfig() {
    return { token: null };
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

// Headers specifically for the Token Joiner (spoofs Discord Desktop Client)
const joinerHeaders = {
    'authority': 'discord.com',
    'accept': '*/*',
    'accept-language': 'sv,sv-SE;q=0.9',
    'content-type': 'application/json',
    'origin': 'https://discord.com',
    'referer': 'https://discord.com/',
    'sec-ch-ua': '"Not?A_Brand";v="8", "Chromium";v="108"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9016 Chrome/108.0.5359.215 Electron/22.3.12 Safari/537.36',
    'x-debug-options': 'bugReporterEnabled',
    'x-discord-locale': 'sv-SE',
    'x-discord-timezone': 'Europe/Stockholm',
    'x-super-properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiRGlzY29yZCBDbGllbnQiLCJyZWxlYXNlX2NoYW5uZWwiOiJzdGFibGUiLCJjbGllbnRfdmVyc2lvbiI6IjEuMC45MDE2Iiwib3NfdmVyc2lvbiI6IjEwLjAuMTkwNDUiLCJvc19hcmNoIjoieDY0Iiwic3lzdGVtX2xvY2FsZSI6InN2IiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV09XNjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIGRpc2NvcmQvMS4wLjkwMTYgQ2hyb21lLzEwOC4wLjUzNTkuMjE1IEVsZWN0cm9uLzIyLjMuMTIgU2FmYXJpLzUzNy4zNiIsImJyb3dzZXJfdmVyc2lvbiI6IjIyLjMuMTIiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjoyMTg2MDQsIm5hdGl2ZV9idWlsZF9udW1iZXIiOjM1MjM2LCJjbGllbnRfZXZlbnRfc291cmNlIjpudWxsfQ=='
};

function randomUsername(length) {
    let username = "";
    for (let i = 0; i < length; i++) {
        username += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return username;
}

function randStr(length) {
    let s = "";
    for (let i = 0; i < length; i++) {
        s += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return s;
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

async function sendWebhook(webhookUrl, payload, isRateLimit, userId) {
    if (!webhookUrl) return;
    try {
        await axios.post(webhookUrl, payload, { timeout: 8000 });
    } catch (error) {
        if (error.response) {
            if (error.response.status === 429) {
                const retryAfter = Number(error.response.data?.retry_after) || 5;
                await sleep(retryAfter * 1000);
                return sendWebhook(webhookUrl, payload, isRateLimit, userId);
            } else if (error.response.status === 404 || error.response.status === 403 || error.response.status >= 500) {
                const hookType = isRateLimit ? "Rate Limit" : "Users Found";
                if (userId) await sendDM(userId, `Your ${hookType} webhook is invalid, deleted, or unreachable. Please update it in the bot config.`);
            }
        }
    }
}

// ─── /acc LOGIC ────────────────────────────────────────────────────────────

async function getAccountInfo(token) {
    const res = await axios.get(`${API_BASE}/users/@me`, { headers: createHeaders(token), timeout: 8000 });
    return res.data;
}

async function getDMs(token) {
    const res = await axios.get(`${API_BASE}/users/@me/channels`, { headers: createHeaders(token), timeout: 8000 });
    return res.data.filter(c => c.type === 1);
}

async function getGuilds(token) {
    const res = await axios.get(`${API_BASE}/users/@me/guilds`, { headers: createHeaders(token), timeout: 8000 });
    return res.data;
}

async function joinServer(token, invite) {
    const code = invite.replace(/https?:\/\/(www\.)?discord\.(gg|com\/invite)\//i, "").split("/")[0].trim();
    
    // Fetch cookies first
    const site = await axios.get("https://discord.com", { headers: joinerHeaders, timeout: 8000 });
    const cookies = site.headers['set-cookie'];
    if (cookies) {
        const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');
        joinerHeaders['cookie'] = cookieStr;
    }
    
    joinerHeaders['Authorization'] = token;
    await axios.post(`${API_BASE}/invites/${code}`, { session_id: randStr(32) }, { headers: joinerHeaders, timeout: 8000 });
}

// ─── SNIPER LOGIC ────────────────────────────────────────────────────────────

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
            await sendWebhook(config.webhookUsers, payload, false, userId);
            
            if (!config.fastSend && (config.foundQueue.length > 0 || config.isRunning)) {
                for (let i = 0; i < Math.floor(config.delayMs / 1000); i++) {
                    if (config.fastSend || !config.isRunning) break;
                    await sleep(1000);
                }
            }
        } else {
            await sleep(1000);
        }
    }
    config.fastSend = false;
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

        if (checksOnToken >= 90) {
            tokenIndex++;
            checksOnToken = 0;
            if (tokenIndex >= config.tokens.length) {
                tokenIndex = 0;
                await sendWebhook(config.webhookRL, { content: "All tokens have been used 90 times. Waiting 1 hour before resuming." }, true, userId);
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
            const res = await axios.post(`${API_BASE}/users/@me/pomelo-attempt`, { username }, { headers: createHeaders(token), timeout: 8000 });
            checksOnToken++; totalChecks++;
            if (res.data?.taken === false) {
                const time = Math.floor(Date.now() / 1000);
                config.foundQueue.push({ username, time });
            }
        } catch (error) {
            if (error.response) {
                if (error.response.status === 400) { checksOnToken++; totalChecks++; }
                else if (error.response.status === 429) {
                    const retryAfter = Number(error.response.data?.retry_after) || 5;
                    await sendWebhook(config.webhookRL, { content: `Rate limited. Waiting ${retryAfter}s before retrying.` }, true, userId);
                    await sleep(retryAfter * 1000);
                } else if (error.response.status === 401 || error.response.status === 403) {
                    await sendDM(userId, `Token \`${token.slice(0, 15)}...\` has become invalid and was removed.`);
                    config.tokens.splice(tokenIndex, 1);
                    config.invalidTokensCount++;
                    if (tokenIndex >= config.tokens.length) tokenIndex = 0;
                    continue;
                } else await sleep(5000);
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
            { name: "acc", description: "Open the automated accounts panel." }
        ]);
        console.log("Global slash commands registered successfully.");
    } catch (err) {
        console.error("Failed to register global commands:", err);
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        const userId = interaction.user.id;

        // ── AUTH: ONLY COMMANDS ARE LOCKED ─────────────────────────────
        if (interaction.isChatInputCommand() && interaction.commandName === "2nip3r" && userId !== AUTHORIZED_USER_ID) {
            return interaction.reply({ flags: 64, content: "Only the bot owner can deploy the sniper interface." }).catch(() => {});
        }
        if (interaction.isChatInputCommand() && interaction.commandName === "acc" && userId !== AUTHORIZED_USER_ID) {
            return interaction.reply({ flags: 64, content: "Only the bot owner can deploy the accounts interface." }).catch(() => {});
        }

        if (!userConfig.has(userId)) userConfig.set(userId, defaultConfig());
        if (!accConfig.has(userId)) accConfig.set(userId, defaultAccConfig());
        
        const config = userConfig.get(userId);
        const acc = accConfig.get(userId);

        // ── /token-info COMMAND ────────────────────────────────────────
        if (interaction.isChatInputCommand() && interaction.commandName === "token-info") {
            const modal = { custom_id: "token_info_modal", title: "Token Info", components: [ { type: 1, components: [{ type: 4, custom_id: "ti_token", style: 1, label: "Account Token", required: true }] } ] };
            return interaction.showModal(modal);
        }

        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "token_info_modal") {
            await interaction.deferReply({ flags: 64 });
            const token = interaction.fields.getTextInputValue("ti_token").trim();
            try {
                const res = await axios.get(`${API_BASE}/users/@me`, { headers: { Authorization: token, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }, timeout: 8000 });
                const data = res.data;
                const createdAt = new Date(Number((BigInt(data.id) >> 22n) + 1420070400000n));
                const avatarUrl = data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.${data.avatar.startsWith("a_") ? "gif" : "png"}?size=256` : null;
                const nitroLabel = {0: "None", 1: "Classic", 2: "Nitro", 3: "Basic"}[data.premium_type] ?? "Unknown";
                const embed = { title: "Token Info", color: 0x5865F2, thumbnail: avatarUrl ? { url: avatarUrl } : undefined, fields: [
                    { name: "Username", value: `${data.username}${data.discriminator !== "0" ? `#${data.discriminator}` : ""}`, inline: true },
                    { name: "User ID", value: `\`${data.id}\``, inline: true },
                    { name: "Created", value: `<t:${Math.floor(createdAt.getTime() / 1000)}:F>`, inline: false },
                    { name: "Email", value: data.email || "Not available", inline: true },
                    { name: "Phone", value: data.phone || "Not registered", inline: true },
                    { name: "Email Verified", value: data.verified ? "Yes" : "No", inline: true },
                    { name: "2FA Enabled", value: data.mfa_enabled ? "Yes" : "No", inline: true },
                    { name: "Nitro", value: nitroLabel, inline: true },
                    { name: "Flags", value: `\`${data.flags ?? 0}\``, inline: true }
                ]};
                return interaction.editReply({ embeds: [embed] });
            } catch (err) {
                return interaction.editReply({ content: `Invalid or expired token.\nHTTP ${err?.response?.status ?? "N/A"}` });
            }
        }

        // ── /2nip3r COMMAND ───────────────────────────────────────────
        if (interaction.isChatInputCommand() && interaction.commandName === "2nip3r") {
            const mainContainer = {
                type: 17, accent_color: 1, components: [
                    { type: 10, content: "## 𝐮ֆ𝐞𝐫𝐬" },
                    { type: 14, divider: true, spacing: true },
                    { type: 10, content: "-# • usernames ֆnip3r free ♱\n-# • 📣 •\n-# • provided by Papi KooH\n-# • 📢 •" },
                    { type: 14, divider: true, spacing: true },
                    { type: 1, components: [{ type: 2, style: 1, label: "ֆnip3r", custom_id: "open_config" }] }
                ]
            };
            await interaction.channel.send({ flags: 32768, components: [mainContainer] }).catch(console.error);
            return interaction.reply({ flags: 64, content: "Sniper interface deployed." }).catch(console.error);
        }

        // ── Sniper Buttons (Existing) ─────────────────────────────────
        if (interaction.isButton() && interaction.customId === "open_config") {
            const configContainer = { type: 17, accent_color: 1, components: [
                { type: 10, content: "## configure" }, { type: 14, divider: true, spacing: true },
                { type: 1, components: [
                    { type: 2, style: 2, label: "Tokens", custom_id: "modal_tokens" },
                    { type: 2, style: 2, label: "Webhooks", custom_id: "modal_webhooks" },
                    { type: 2, style: 2, label: "Delay 𝐮ֆ𝐞𝐫𝐬", custom_id: "modal_delay" },
                    { type: 2, style: 3, label: "Start ֆnip3r", custom_id: "start_sniper" },
                    { type: 2, style: 4, label: "Stop ֆnip3r", custom_id: "stop_sniper" }
                ]},
                { type: 1, components: [ { type: 2, style: 2, label: "Info", custom_id: "view_info" } ] }
            ]};
            return interaction.reply({ flags: 32768 | 64, components: [configContainer] });
        }

        if (interaction.isButton() && interaction.customId === "view_info") {
            const tokensList = config.tokenNames.length > 0 ? config.tokenNames.join(", ") : "None";
            const webhooksStatus = `Users: ${config.webhookUsers ? "Set" : "Not Set"}\nRate Limits: ${config.webhookRL ? "Set" : "Not Set"}`;
            const delayStr = config.delayMs >= 60000 ? `${config.delayMs / 60000}m` : `${config.delayMs / 1000}s`;
            const infoContainer = { type: 17, accent_color: 1, components: [
                { type: 10, content: "## bot info" }, { type: 14, divider: true, spacing: true },
                { type: 10, content: `**Sniper Status:** ${config.isRunning ? "Active" : "Inactive"}\n**Tokens Put:** ${config.totalTokensAdded}\n**Functional Tokens:** ${config.tokens.length}\n**Invalid Tokens:** ${config.invalidTokensCount}\n**Delay:** ${delayStr}\n**Webhooks:**\n${webhooksStatus}\n**Valid Accounts:** ${tokensList}` }
            ]};
            return interaction.reply({ flags: 32768 | 64, components: [infoContainer] });
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
            await interaction.deferReply({ flags: 64 });
            const tokens = [], names = []; let providedCount = 0;
            for (let i = 1; i <= 5; i++) {
                const t = interaction.fields.getTextInputValue(`token${i}`);
                if (t && t.trim()) {
                    providedCount++;
                    try { const res = await axios.get(`${API_BASE}/users/@me`, { headers: createHeaders(t.trim()), timeout: 8000 }); tokens.push(t.trim()); names.push(res.data.username); } catch (err) {}
                }
            }
            config.tokens = tokens; config.tokenNames = names; config.totalTokensAdded = providedCount; config.invalidTokensCount = providedCount - tokens.length;
            return interaction.editReply({ content: `Tokens updated. Valid accounts: ${names.join(", ") || "None"}` });
        }

        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "submit_webhooks") {
            await interaction.deferReply({ flags: 64 });
            config.webhookUsers = interaction.fields.getTextInputValue("hook_users").trim();
            config.webhookRL = interaction.fields.getTextInputValue("hook_rl").trim();
            return interaction.editReply({ content: "Webhooks updated." });
        }

        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "submit_delay") {
            await interaction.deferReply({ flags: 64 });
            const val = interaction.fields.getTextInputValue("delay_value").trim().toLowerCase();
            const num = parseInt(val); let ms = 20000;
            if (val.endsWith("s")) ms = num * 1000; else if (val.endsWith("m")) ms = num * 60000; else if (val.endsWith("h")) ms = num * 3600000; else ms = num * 1000;
            if (ms < 20000) ms = 20000; config.delayMs = ms;
            return interaction.editReply({ content: `Delay updated to ${val} (min 20s).` });
        }

        if (interaction.isButton() && interaction.customId === "start_sniper") {
            if (config.isRunning) return interaction.reply({ flags: 64, content: "Sniper is already running." });
            if (!config.tokens.length) return interaction.reply({ flags: 64, content: "No valid tokens configured." });
            runSniper(userId);
            return interaction.reply({ flags: 64, content: "Sniper started." });
        }

        if (interaction.isButton() && interaction.customId === "stop_sniper") {
            if (!config.isRunning) return interaction.reply({ flags: 64, content: "Sniper is not running." });
            if (config.foundQueue.length > 0) {
                const confirmContainer = { type: 17, accent_color: 1, components: [
                    { type: 10, content: `## confirm stop\n\nThere are **${config.foundQueue.length}** users in the queue. What do you want to do?` },
                    { type: 14, divider: true, spacing: true },
                    { type: 1, components: [
                        { type: 2, style: 4, label: "Stop ֆnip3r", custom_id: "confirm_stop" },
                        { type: 2, style: 3, label: "Send everything to the webhook.", custom_id: "send_all" },
                        { type: 2, style: 2, label: "view all users", custom_id: "view_all" }
                    ]}
                ]};
                return interaction.reply({ flags: 32768 | 64, components: [confirmContainer] });
            } else {
                config.isRunning = false;
                return interaction.reply({ flags: 64, content: "Sniper stopped. Queue was empty." });
            }
        }

        if (interaction.isButton() && interaction.customId === "confirm_stop") {
            config.isRunning = false; config.foundQueue = [];
            return interaction.update({ content: "Sniper stopped totally. Queue discarded.", components: [] });
        }

        if (interaction.isButton() && interaction.customId === "send_all") {
            await interaction.deferUpdate();
            config.isRunning = false; config.fastSend = true;
            while (config.foundQueue.length > 0) await sleep(1000);
            config.fastSend = false;
            return interaction.followUp({ flags: 64, content: "All queued users sent to webhook rapidly. Sniper fully stopped." });
        }

        if (interaction.isButton() && interaction.customId === "view_all") {
            const usersList = config.foundQueue.map(item => item.username).join("\n") || "No users in queue.";
            const viewContainer = { type: 17, accent_color: 1, components: [
                { type: 10, content: "## USERS" }, { type: 14, divider: true, spacing: true },
                { type: 10, content: usersList }
            ]};
            return interaction.reply({ flags: 32768 | 64, components: [viewContainer] });
        }

        // ── /acc COMMAND ───────────────────────────────────────────────
        if (interaction.isChatInputCommand() && interaction.commandName === "acc") {
            const embed = {
                title: "automated accounts",
                image: { url: "https://i.postimg.cc/rmTcLcf2/IMG-6380.gif" },
                color: 0x2B2D31
            };
            const row = { type: 1, components: [
                { type: 2, style: 1, label: "Login", custom_id: "acc_login" },
                { type: 2, style: 2, label: "functions", custom_id: "acc_functions" },
                { type: 2, style: 4, label: "Log out", custom_id: "acc_logout" }
            ]};
            await interaction.channel.send({ embeds: [embed], components: [row] }).catch(console.error);
            return interaction.reply({ flags: 64, content: "Account panel deployed." }).catch(console.error);
        }

        // ── /acc BUTTONS ───────────────────────────────────────────────
        if (interaction.isButton() && interaction.customId === "acc_login") {
            const modal = { custom_id: "acc_login_modal", title: "Login - Account Token", components: [
                { type: 1, components: [{ type: 4, custom_id: "acc_token", style: 1, label: "Account Token", required: true }] }
            ]};
            return interaction.showModal(modal);
        }

        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "acc_login_modal") {
            await interaction.deferReply({ flags: 64 });
            const token = interaction.fields.getTextInputValue("acc_token").trim();
            try {
                const data = await getAccountInfo(token);
                acc.token = token;
                
                const dms = await getDMs(token);
                const guilds = await getGuilds(token);
                const nitroLabel = {0: "None", 1: "Classic", 2: "Nitro", 3: "Basic"}[data.premium_type] ?? "Unknown";
                const createdAt = new Date(Number((BigInt(data.id) >> 22n) + 1420070400000n));
                
                const embed = {
                    title: "Login Successful",
                    color: 0x57F287,
                    thumbnail: { url: `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.${data.avatar.startsWith("a_") ? "gif" : "png"}?size=256` },
                    fields: [
                        { name: "Username", value: `${data.username}`, inline: true },
                        { name: "User ID", value: `\`${data.id}\``, inline: true },
                        { name: "Created", value: `<t:${Math.floor(createdAt.getTime() / 1000)}:F>`, inline: false },
                        { name: "Email", value: data.email || "Not available", inline: true },
                        { name: "Phone", value: data.phone || "Not registered", inline: true },
                        { name: "Open DMs", value: `${dms.length}`, inline: true },
                        { name: "Servers", value: `${guilds.length}`, inline: true },
                        { name: "Nitro", value: nitroLabel, inline: true },
                        { name: "2FA Enabled", value: data.mfa_enabled ? "Yes" : "No", inline: true }
                    ]
                };
                return interaction.editReply({ embeds: [embed] });
            } catch (err) {
                return interaction.editReply({ content: `Invalid or expired token.\nHTTP ${err?.response?.status ?? "N/A"}` });
            }
        }

        if (interaction.isButton() && interaction.customId === "acc_logout") {
            acc.token = null;
            return interaction.reply({ flags: 64, content: "Logged out. Token removed from memory." });
        }

        if (interaction.isButton() && interaction.customId === "acc_functions") {
            if (!acc.token) {
                return interaction.reply({ flags: 64, embeds: [{ title: "Error", description: "No token found. Please use the **Login** button first.", color: 0xED4245 }] });
            }
            
            const menu = {
                type: 1, components: [{
                    type: 3, custom_id: "acc_select_menu",
                    placeholder: "Choose an option",
                    options: [
                        { label: "Join a server", value: "acc_join", emoji: "🔗", description: "Join a server using the token joiner" },
                        { label: "Delete DMs", value: "acc_deldms", emoji: "🗑️", description: "Close all open DM channels" },
                        { label: "Send DMs", value: "acc_senddms", emoji: "📨", description: "Send a message to all open DMs" },
                        { label: "Leave All Servers", value: "acc_leaveall", emoji: "🚪", description: "Leave all servers the account is in" },
                        { label: "View servers", value: "acc_viewservers", emoji: "🌐", description: "List all servers the account is in" },
                        { label: "Change status", value: "acc_setstatus", emoji: "🔆", description: "Change the account status" },
                        { label: "Account check", value: "acc_check", emoji: "✅", description: "Verify if the token is valid" }
                    ]
                }]
            };
            return interaction.reply({ flags: 64, components: [menu] });
        }

        // ── /acc SELECT MENU ───────────────────────────────────────────
        if (interaction.isStringSelectMenu() && interaction.customId === "acc_select_menu") {
            const value = interaction.values[0];
            const token = acc.token;
            
            // Modals
            if (value === "acc_join") return interaction.showModal({ custom_id: "acc_join_modal", title: "Join Server", components: [{ type: 1, components: [{ type: 4, custom_id: "invite_code", style: 1, label: "Server Invite Link or Code", required: true }] }] });
            if (value === "acc_senddms") return interaction.showModal({ custom_id: "acc_senddms_modal", title: "Send DMs", components: [{ type: 1, components: [{ type: 4, custom_id: "dm_message", style: 2, label: "Message to send", required: true }] }] });
            if (value === "acc_setstatus") return interaction.showModal({ custom_id: "acc_setstatus_modal", title: "Change Status", components: [{ type: 1, components: [{ type: 4, custom_id: "status_value", style: 1, label: "Status (online, idle, dnd, invisible)", required: true }] }] });

            // Defers
            await interaction.deferReply({ flags: 64 });
            
            if (value === "acc_check") {
                try {
                    const data = await getAccountInfo(token);
                    return interaction.editReply({ content: `✅ **Valid Token**\nUser: **${data.username}** (\`${data.id}\`)\nEmail: \`${data.email || "N/A"}\`` });
                } catch (err) {
                    return interaction.editReply({ content: `❌ **Invalid or expired token.**` });
                }
            }

            if (value === "acc_viewservers") {
                try {
                    const guilds = await getGuilds(token);
                    if (!guilds.length) return interaction.editReply({ content: "The account is not in any server." });
                    const list = guilds.map((g, i) => `**${i + 1}.** ${g.name} — \`${g.id}\``).join("\n");
                    const chunks = [];
                    let current = "";
                    for (const line of list.split("\n")) {
                        if ((current + "\n" + line).length > 4000) { chunks.push(current); current = line; } else current += (current ? "\n" : "") + line;
                    }
                    if (current) chunks.push(current);
                    const embeds = chunks.map((chunk, i) => ({ color: 0x5865F2, title: i === 0 ? `Servers (${guilds.length} total)` : null, description: chunk }));
                    return interaction.editReply({ embeds });
                } catch (err) {
                    return interaction.editReply({ content: `❌ **Error:** \`${err.message}\`` });
                }
            }

            if (value === "acc_deldms") {
                try {
                    const dms = await getDMs(token);
                    if (!dms.length) return interaction.editReply({ content: "No open DMs to delete." });
                    let deleted = 0;
                    for (const ch of dms) {
                        try { await axios.delete(`${API_BASE}/channels/${ch.id}`, { headers: createHeaders(token), timeout: 8000 }); deleted++; } catch {}
                        await sleep(400);
                    }
                    return interaction.editReply({ content: `✅ **Done!** Closed **${deleted}** DM channel(s).` });
                } catch (err) {
                    return interaction.editReply({ content: `❌ **Error:** \`${err.message}\`` });
                }
            }

            if (value === "acc_leaveall") {
                try {
                    const guilds = await getGuilds(token);
                    if (!guilds.length) return interaction.editReply({ content: "No servers to leave." });
                    let left = 0;
                    for (const g of guilds) {
                        try { await axios.delete(`${API_BASE}/users/@me/guilds/${g.id}`, { headers: createHeaders(token), timeout: 8000 }); left++; } catch {}
                        await sleep(500);
                    }
                    return interaction.editReply({ content: `✅ **Done!** Left **${left}** server(s).` });
                } catch (err) {
                    return interaction.editReply({ content: `❌ **Error:** \`${err.message}\`` });
                }
            }
        }

        // ── /acc MODALS SUBMITS ────────────────────────────────────────
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "acc_join_modal") {
            await interaction.deferReply({ flags: 64 });
            const invite = interaction.fields.getTextInputValue("invite_code").trim();
            const token = acc.token;
            try {
                await joinServer(token, invite);
                return interaction.editReply({ content: `✅ **Done!** Joined server via invite \`${invite}\`.` });
            } catch (err) {
                return interaction.editReply({ content: `❌ **Error joining server:** \`${err.response?.data?.message || err.message}\`` });
            }
        }

        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "acc_senddms_modal") {
            await interaction.deferReply({ flags: 64 });
            const message = interaction.fields.getTextInputValue("dm_message").trim();
            const token = acc.token;
            try {
                const dms = await getDMs(token);
                if (!dms.length) return interaction.editReply({ content: "No open DMs to send to." });
                let sent = 0, failed = 0;
                for (const ch of dms) {
                    try { await axios.post(`${API_BASE}/channels/${ch.id}/messages`, { content: message }, { headers: createHeaders(token), timeout: 8000 }); sent++; } catch { failed++; }
                    await sleep(1200);
                }
                return interaction.editReply({ content: `✅ **Done!** Sent to **${sent}** DM(s). Failed: **${failed}**.` });
            } catch (err) {
                return interaction.editReply({ content: `❌ **Error:** \`${err.message}\`` });
            }
        }

        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "acc_setstatus_modal") {
            await interaction.deferReply({ flags: 64 });
            const status = interaction.fields.getTextInputValue("status_value").trim().toLowerCase();
            const token = acc.token;
            const valid = ["online", "idle", "dnd", "invisible"];
            if (!valid.includes(status)) return interaction.editReply({ content: `❌ **Invalid status.** Use one of: \`online\`, \`idle\`, \`dnd\`, \`invisible\`.` });
            try {
                await axios.patch(`${API_BASE}/users/@me/settings`, { status }, { headers: createHeaders(token), timeout: 8000 });
                return interaction.editReply({ content: `✅ **Status changed to \`${status}\` successfully!**` });
            } catch (err) {
                return interaction.editReply({ content: `❌ **Error:** \`${err.response?.data?.message || err.message}\`` });
            }
        }

    } catch (err) {
        console.error("Interaction Error:", err);
        if (interaction.isRepliable() && !interaction.replied) {
            await interaction.reply({ content: "An error occurred while processing your request.", flags: 64 }).catch(()=>{});
        } else if (interaction.isRepliable() && interaction.deferred) {
            await interaction.editReply({ content: "An error occurred while processing your request." }).catch(()=>{});
        }
    }
});

client.login(BOT_TOKEN);
