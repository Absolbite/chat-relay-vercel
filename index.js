// api/index.js  —  Vercel serverless handler

// ── In-memory storage (resets on cold start, fine for chat) ───
const messages = global._messages || (global._messages = []);
const online   = global._online   || (global._online   = {});
let   nextId   = global._nextId   || (global._nextId   = 1);

const MAX_MESSAGES = 500;
const OFFLINE_MS   = 30000;

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
    for (const uid in (online[topic] || {})) {
        list.push({ uid, ...online[topic][uid] });
    }
    return list;
}

function send(res, code, data) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    res.status(code).json(data);
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

    if (req.method === "OPTIONS") { res.status(200).end(); return; }

    const path = req.url.split("?")[0].replace(/\/$/, "") || "/";

    // ── POST /api/send ─────────────────────────────────────────
    if (req.method === "POST" && path.endsWith("/send")) {
        const { topic, msgType, display, name, uid, toUid, text, time } = req.body || {};
        if (!topic || !uid) { send(res, 400, { error: "missing fields" }); return; }

        if (!online[topic]) online[topic] = {};
        online[topic][uid] = { display: display || uid, name: name || uid, lastSeen: Date.now() };
        global._online = online;

        if (msgType === "ping" || !text) { send(res, 200, { ok: true }); return; }

        const msg = {
            id: global._nextId++,
            topic, msgType: msgType || "public",
            display: display || uid,
            name: name || uid,
            uid,
            toUid: toUid || null,
            text,
            time: time || new Date().toISOString().substr(11, 5)
        };
        global._messages.push(msg);
        if (global._messages.length > MAX_MESSAGES) global._messages.shift();

        send(res, 200, { ok: true, id: msg.id });
        return;
    }

    // ── GET /api/messages ──────────────────────────────────────
    if (req.method === "GET" && path.endsWith("/messages")) {
        const params = new URLSearchParams(req.url.split("?")[1] || "");
        const topic  = params.get("topic");
        const after  = parseInt(params.get("after") || "0", 10);
        const myUid  = params.get("uid") || "";

        if (!topic) { send(res, 400, { error: "missing topic" }); return; }

        if (myUid) {
            if (!online[topic]) online[topic] = {};
            if (online[topic][myUid]) {
                online[topic][myUid].lastSeen = Date.now();
                global._online = online;
            }
        }

        const result = (global._messages || []).filter(m => {
            if (m.topic !== topic || m.id <= after) return false;
            if (m.msgType === "public" || m.msgType === "join") return true;
            if (m.msgType === "private") return m.toUid === myUid || m.uid === myUid;
            return false;
        });

        send(res, 200, { messages: result, onlineList: getOnlineList(topic) });
        return;
    }

    // ── GET /api/ping ──────────────────────────────────────────
    if (req.method === "GET" && path.endsWith("/ping")) {
        const params  = new URLSearchParams(req.url.split("?")[1] || "");
        const topic   = params.get("topic");
        const uid     = params.get("uid");
        const display = params.get("display") || uid;
        const name    = params.get("name") || uid;
        if (topic && uid) {
            if (!online[topic]) online[topic] = {};
            online[topic][uid] = { display, name, lastSeen: Date.now() };
            global._online = online;
        }
        send(res, 200, { ok: true, onlineList: getOnlineList(topic) });
        return;
    }

    send(res, 404, { error: "not found" });
}
