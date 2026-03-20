const http = require("http");

// ── In-memory storage ──────────────────────────────────────────
const messages = [];
const online   = {};
let   nextId   = 1;

const MAX_MESSAGES = 500;
const OFFLINE_MS   = 30000;

// ── Badwords & Mute ────────────────────────────────────────────
const BAD_WORDS = [
    "fuck", "fucking", "shit", "bitch", "bitches",
    "nigger", "nigga", "faggot", "cunt", "ass",
    "dick", "cock", "pussy", "whore", "retard"
];

const muted = {};
const MUTE_DURATION = 60 * 60 * 1000;

function isMuted(uid) {
    if (!muted[uid]) return false;
    if (Date.now() > muted[uid]) {
        delete muted[uid];
        return false;
    }
    return true;
}

function containsBadWord(text) {
    const lower = text.toLowerCase();
    return BAD_WORDS.some(word => lower.includes(word));
}

// ── Helpers ────────────────────────────────────────────────────
function json(res, code, data) {
    res.writeHead(code, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    });
    res.end(JSON.stringify(data));
}

function pruneOffline(topic) {
    const now = Date.now();
    if (!online[topic]) return;
    for (const uid in online[topic]) {
        if (now - online[topic][uid].lastSeen > OFFLINE_MS) {
            delete online[topic][uid];
        }
    }
}

function getOnlineList(topic) {
    pruneOffline(topic);
    const list = [];
    for (const uid in online[topic]) {
        list.push({ uid, ...online[topic][uid] });
    }
    return list;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
            try { resolve(JSON.parse(body)); }
            catch { reject(new Error("Invalid JSON")); }
        });
    });
}

// ── Router ─────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    const url    = new URL(req.url, "http://localhost");
    const path   = url.pathname;
    const method = req.method;

    if (method === "OPTIONS") { json(res, 200, {}); return; }

    // ── POST /send ─────────────────────────────────────────────
    if (method === "POST" && path === "/send") {
        let body;
        try { body = await readBody(req); }
        catch { json(res, 400, { error: "bad json" }); return; }

        const { topic, msgType, display, name, uid, toUid, text, time } = body;
        if (!topic || !uid) { json(res, 400, { error: "missing fields" }); return; }

        if (!online[topic]) online[topic] = {};
        online[topic][uid] = { display: display || uid, name: name || uid, lastSeen: Date.now() };

        if (msgType === "ping" || !text) { json(res, 200, { ok: true }); return; }

        // Проверка мута
        if (isMuted(uid)) {
            const remaining = Math.ceil((muted[uid] - Date.now()) / 60000);
            json(res, 403, { error: "muted", minutesLeft: remaining });
            return;
        }

        // Проверка плохих слов
        if (containsBadWord(text)) {
            muted[uid] = Date.now() + MUTE_DURATION;
            json(res, 403, { error: "muted", minutesLeft: 60 });
            return;
        }

        const msg = {
            id: nextId++,
            topic,
            msgType: msgType || "public",
            display: display || uid,
            name:    name    || uid,
            uid,
            toUid:   toUid  || null,
            text,
            time:    time   || new Date().toISOString().substr(11, 5)
        };

        messages.push(msg);
        if (messages.length > MAX_MESSAGES) messages.shift();

        json(res, 200, { ok: true, id: msg.id });
        return;
    }

    // ── GET /messages ──────────────────────────────────────────
    if (method === "GET" && path === "/messages") {
        const topic = url.searchParams.get("topic");
        const after = parseInt(url.searchParams.get("after") || "0", 10);
        const myUid = url.searchParams.get("uid") || "";

        if (!topic) { json(res, 400, { error: "missing topic" }); return; }

        if (myUid) {
            if (!online[topic]) online[topic] = {};
            if (online[topic][myUid]) {
                online[topic][myUid].lastSeen = Date.now();
            }
        }

        const result = messages.filter(m => {
            if (m.topic !== topic) return false;
            if (m.id <= after) return false;
            if (m.msgType === "public" || m.msgType === "join") return true;
            if (m.msgType === "private") {
                return m.toUid === myUid || m.uid === myUid;
            }
            return false;
        });

        json(res, 200, { messages: result, onlineList: getOnlineList(topic) });
        return;
    }

    // ── GET /online ────────────────────────────────────────────
    if (method === "GET" && path === "/online") {
        const topic = url.searchParams.get("topic");
        if (!topic) { json(res, 400, { error: "missing topic" }); return; }
        json(res, 200, { onlineList: getOnlineList(topic) });
        return;
    }

    // ── GET /ping ──────────────────────────────────────────────
    if (method === "GET" && path === "/ping") {
        const topic   = url.searchParams.get("topic");
        const uid     = url.searchParams.get("uid");
        const display = url.searchParams.get("display") || uid;
        const name    = url.searchParams.get("name")    || uid;
        if (topic && uid) {
            if (!online[topic]) online[topic] = {};
            online[topic][uid] = { display, name, lastSeen: Date.now() };
        }
        json(res, 200, { ok: true, onlineList: getOnlineList(topic) });
        return;
    }

    json(res, 404, { error: "not found" });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Chat relay running on port " + PORT));
