const messages = global._messages || (global._messages = []);
const online   = global._online   || (global._online   = {});
const OFFLINE_MS = 90000; // 90s (heartbeat теперь каждые 60s)

function pruneOffline(topic) {
    const now = Date.now();
    if (!online[topic]) return;
    for (const uid in online[topic])
        if (now - online[topic][uid].lastSeen > OFFLINE_MS)
            delete online[topic][uid];
}

function getOnlineList(topic) {
    pruneOffline(topic);
    return Object.entries(online[topic] || {}).map(([uid, v]) => ({ uid, ...v }));
}

function send(res, code, data) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.status(code).json(data);
}

module.exports = async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") { res.status(200).end(); return; }

    const url    = req.url || "/";
    const [path] = url.split("?");
    const clean  = path.replace(/\/+$/, "");
    const params = new URLSearchParams(url.includes("?") ? url.split("?")[1] : "");

    // GET /ping — оставляем для первого коннекта
    if (req.method === "GET" && (clean === "/ping" || clean === "")) {
        const topic   = params.get("topic");
        const uid     = params.get("uid");
        const display = params.get("display") || uid;
        const name    = params.get("name") || uid;
        if (topic && uid) {
            if (!online[topic]) online[topic] = {};
            online[topic][uid] = { display, name, lastSeen: Date.now() };
        }
        send(res, 200, { ok: true, onlineList: getOnlineList(topic || "") });
        return;
    }

    // GET /messages — обновляет lastSeen сам, отдельный heartbeat не нужен
    if (req.method === "GET" && clean === "/messages") {
        const topic   = params.get("topic");
        const after   = parseInt(params.get("after") || "0", 10);
        const myUid   = params.get("uid") || "";
        const display = params.get("display") || myUid;
        const name    = params.get("name") || myUid;

        if (!topic) { send(res, 400, { error: "missing topic" }); return; }

        // /messages сам обновляет lastSeen — heartbeat отдельно не нужен
        if (myUid) {
            if (!online[topic]) online[topic] = {};
            online[topic][myUid] = { display, name, lastSeen: Date.now() };
        }

        const result = messages.filter(m => {
            if (m.topic !== topic || m.id <= after) return false;
            if (m.msgType === "public") return true;
            if (m.msgType === "private") return m.toUid === myUid || m.uid === myUid;
            return false;
        });

        // onlineList всегда — клиент должен знать кто ушёл офлайн
        send(res, 200, {
            messages: result,
            onlineList: getOnlineList(topic)
        });
        return;
    }

    // POST /send
    if (req.method === "POST" && clean === "/send") {
        const body = req.body || {};
        const { topic, msgType, display, name, uid, toUid, text, time } = body;
        if (!topic || !uid) { send(res, 400, { error: "missing fields" }); return; }
        if (!online[topic]) online[topic] = {};
        online[topic][uid] = { display: display || uid, name: name || uid, lastSeen: Date.now() };
        if (msgType === "ping" || !text) { send(res, 200, { ok: true }); return; }
        if (!global._nextId) global._nextId = 1;
        const msg = {
            id: global._nextId++,
            topic,
            msgType: msgType || "public",
            display: display || uid,
            name: name || uid,
            uid,
            toUid: toUid || null,
            text,
            time: time || new Date().toISOString().substr(11, 5)
        };
        messages.push(msg);
        if (messages.length > 500) messages.shift();
        send(res, 200, { ok: true, id: msg.id });
        return;
    }

    send(res, 404, { error: "not found" });
};
