const http = require("http");

// ── In-memory storage ──────────────────────────────────────────
const messages = [];   // { id, topic, msgType, display, name, uid, toUid, text, time }
const online   = {};   // topic → { uid: { display, name, lastSeen } }
let   nextId   = 1;

const MAX_MESSAGES = 500;   // global cap to avoid memory leak
const OFFLINE_MS   = 30000; // player considered offline after 30s no ping

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

    // CORS preflight
    if (method === "OPTIONS") { json(res, 200, {}); return; }

    // ── POST /send  ────────────────────────────────────────────
    // Body: { topic, msgType, display, name, uid, toUid?, text, time }
    if (method === "POST" && path === "/send") {
        let body;
        try { body = await readBody(req); }
        catch { json(res, 400, { error: "bad json" }); return; }

        const { topic, msgType, display, name, uid, toUid, text, time } = body;
        if (!topic || !uid) { json(res, 400, { error: "missing fields" }); return; }

        // Register / update online presence
        if (!online[topic]) online[topic] = {};
        online[topic][uid] = { display: display || uid, name: name || uid, lastSeen: Date.now() };

        // ping = just update presence, no message stored
        if (msgType === "ping" || !text) { json(res, 200, { ok: true }); return; }

        const msg = {
            id: nextId++,
            topic,
            msgType: msgType || "public",
            display: display || uid,
            name:    name    || uid,
            uid,
            toUid:   toUid  || null,
            text,
            time:    time   || new Date().toISOString().substr(11,5)
        };

        messages.push(msg);
        if (messages.length > MAX_MESSAGES) messages.shift();

        json(res, 200, { ok: true, id: msg.id });
        return;
    }

    // ── GET /messages?topic=X&after=N&uid=ME  ─────────────────
    // Returns messages for this topic since id > after
    // Filters: public ones + private ones where toUid==me or uid==me
    if (method === "GET" && path === "/messages") {
        const topic = url.searchParams.get("topic");
        const after = parseInt(url.searchParams.get("after") || "0", 10);
        const myUid = url.searchParams.get("uid") || "";

        if (!topic) { json(res, 400, { error: "missing topic" }); return; }

        // Update lastSeen for this uid (heartbeat)
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

    // ── GET /online?topic=X  ───────────────────────────────────
    if (method === "GET" && path === "/online") {
        const topic = url.searchParams.get("topic");
        if (!topic) { json(res, 400, { error: "missing topic" }); return; }
        json(res, 200, { onlineList: getOnlineList(topic) });
        return;
    }

    // ── GET /ping?topic=X&uid=Y&display=Z&name=W  ─────────────
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
