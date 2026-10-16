var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");
var app = (0, import_express.default)();
var PORT = 3e3;
app.use(import_express.default.json({ limit: "50mb" }));
app.use(import_express.default.urlencoded({ extended: true, limit: "50mb" }));
var clipboardsByEmail = /* @__PURE__ */ new Map();
var pendingDeletes = [];
var activeCrossDrags = /* @__PURE__ */ new Map();
var activeCalls = /* @__PURE__ */ new Map();
var cloudSettingsByEmail = /* @__PURE__ */ new Map();
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", serverTime: Date.now() });
});
app.get("/api/download", async (req, res) => {
  try {
    const rawUrl = String(req.query.url || "");
    const target = new URL(rawUrl);
    if (!/^https?:$/.test(target.protocol)) {
      return res.status(400).json({ error: "Only HTTP and HTTPS downloads are supported." });
    }
    const response = await fetch(target, { redirect: "follow" });
    if (!response.ok || !response.body) {
      return res.status(502).json({ error: `The website returned ${response.status}.` });
    }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 50 * 1024 * 1024) {
      return res.status(413).json({ error: "This file is larger than the 50 MB A-OS download limit." });
    }
    const disposition = response.headers.get("content-disposition") || "";
    const dispositionName = disposition.match(/filename\*?=(?:UTF-8''|["']?)([^"';]+)/i)?.[1];
    const pathName = decodeURIComponent(target.pathname.split("/").pop() || "download");
    const filename = decodeURIComponent(dispositionName || pathName || "download").replace(/[\r\n]/g, "");
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > 50 * 1024 * 1024) {
      return res.status(413).json({ error: "This file is larger than the 50 MB A-OS download limit." });
    }
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/octet-stream");
    res.setHeader("X-AOS-Filename", filename);
    res.setHeader("Cache-Control", "no-store");
    return res.send(body);
  } catch {
    return res.status(400).json({ error: "A-OS could not read that download address." });
  }
});
app.all("/api/a-applications-sync", (req, res) => {
  const email = req.query.email || req.body && req.body.email || "default";
  const normalized = email.toLowerCase().trim();
  if (req.method === "POST") {
    const existing = cloudSettingsByEmail.get(normalized) || {};
    const updated = { ...existing, ...req.body?.data || req.body || {} };
    cloudSettingsByEmail.set(normalized, updated);
    return res.json({ success: true, timestamp: Date.now(), data: updated });
  }
  const data = cloudSettingsByEmail.get(normalized) || {};
  return res.json({ success: true, data });
});
app.post("/api/sync/clipboard", (req, res) => {
  const { email, action, files, sourceScreenId } = req.body;
  if (!email || !files) {
    return res.status(400).json({ error: "Missing email or files" });
  }
  const normalizedEmail = email.toLowerCase().trim();
  const clipboardData = {
    action: action || "copy",
    files: Array.isArray(files) ? files : [files],
    sourceScreenId: sourceScreenId || "screen-1",
    sourceEmail: normalizedEmail,
    timestamp: Date.now()
  };
  clipboardsByEmail.set(normalizedEmail, clipboardData);
  res.json({ success: true, clipboard: clipboardData });
});
app.get("/api/sync/clipboard", (req, res) => {
  const email = req.query.email?.toLowerCase().trim();
  if (!email) {
    return res.status(400).json({ error: "Missing email query param" });
  }
  const clipboard = clipboardsByEmail.get(email) || null;
  res.json({ success: true, clipboard });
});
app.post("/api/sync/consume-move", (req, res) => {
  const { email, fileIds, sourceScreenId, targetScreenId } = req.body;
  if (!email || !fileIds || !Array.isArray(fileIds)) {
    return res.status(400).json({ error: "Missing email or fileIds" });
  }
  const normalized = email.toLowerCase().trim();
  pendingDeletes.push({
    email: normalized,
    sourceScreenId: sourceScreenId || "",
    fileIds,
    timestamp: Date.now()
  });
  const current = clipboardsByEmail.get(normalized);
  if (current && current.action === "cut") {
    clipboardsByEmail.delete(normalized);
  }
  res.json({ success: true, count: fileIds.length });
});
app.get("/api/sync/pending-deletes", (req, res) => {
  const email = req.query.email?.toLowerCase().trim();
  const screenId = req.query.screenId || "";
  if (!email) {
    return res.status(400).json({ error: "Missing email" });
  }
  const now = Date.now();
  const matches = [];
  const remaining = [];
  for (const item of pendingDeletes) {
    if (now - item.timestamp > 6e4) continue;
    if (item.email === email && (!item.sourceScreenId || item.sourceScreenId === screenId)) {
      matches.push(...item.fileIds);
    } else {
      remaining.push(item);
    }
  }
  pendingDeletes.length = 0;
  pendingDeletes.push(...remaining);
  res.json({ success: true, fileIdsToDelete: [...new Set(matches)] });
});
app.post("/api/sync/cross-screen-drag", (req, res) => {
  const { email, type, action, payload, sourceScreenId } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Missing email" });
  }
  const normalized = email.toLowerCase().trim();
  if (action === "end") {
    activeCrossDrags.delete(normalized);
    return res.json({ success: true, active: false });
  }
  const dragRecord = {
    id: `drag-${Date.now()}`,
    email: normalized,
    sourceScreenId: sourceScreenId || "",
    type: type || "window",
    action: action || "move",
    payload,
    timestamp: Date.now()
  };
  activeCrossDrags.set(normalized, dragRecord);
  res.json({ success: true, drag: dragRecord });
});
app.get("/api/sync/cross-screen-drag", (req, res) => {
  const email = req.query.email?.toLowerCase().trim();
  const screenId = req.query.screenId || "";
  if (!email) {
    return res.status(400).json({ error: "Missing email" });
  }
  const drag = activeCrossDrags.get(email);
  if (!drag || Date.now() - drag.timestamp > 8e3) {
    activeCrossDrags.delete(email);
    return res.json({ success: true, drag: null });
  }
  if (drag.sourceScreenId && drag.sourceScreenId === screenId) {
    return res.json({ success: true, drag: null, isSelf: true });
  }
  res.json({ success: true, drag });
});
app.post("/api/acall/call", (req, res) => {
  const { callerEmail, callerName, targetEmail, callType } = req.body;
  if (!callerEmail || !targetEmail) {
    return res.status(400).json({ error: "Missing callerEmail or targetEmail" });
  }
  const callId = `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const session = {
    callId,
    callerEmail: callerEmail.toLowerCase().trim(),
    callerName: callerName || "A-OS User",
    targetEmail: targetEmail.toLowerCase().trim(),
    callType: callType || "voice",
    status: "ringing",
    createdAt: Date.now(),
    messages: [
      {
        id: `sys-1`,
        sender: "A-Call System",
        senderEmail: "system@a-os.dev",
        text: `Call initiated (${callType === "video" ? "Video" : "Voice"}). Waiting for answer...`,
        timestamp: new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(/* @__PURE__ */ new Date())
      }
    ]
  };
  activeCalls.set(callId, session);
  res.json({ success: true, session });
});
app.get("/api/acall/poll", (req, res) => {
  const email = req.query.email?.toLowerCase().trim();
  if (!email) {
    return res.status(400).json({ error: "Missing email" });
  }
  let myCall = null;
  const now = Date.now();
  for (const [id, call] of activeCalls.entries()) {
    if (call.status === "ended" && now - call.createdAt > 3e4) {
      activeCalls.delete(id);
      continue;
    }
    if (call.targetEmail === email || call.callerEmail === email) {
      myCall = call;
      break;
    }
  }
  res.json({ success: true, call: myCall });
});
app.post("/api/acall/respond", (req, res) => {
  const { callId, answer, email } = req.body;
  const call = activeCalls.get(callId);
  if (!call) {
    return res.status(404).json({ error: "Call not found" });
  }
  if (answer === "accept") {
    call.status = "connected";
    call.messages.push({
      id: `sys-${Date.now()}`,
      sender: "A-Call System",
      senderEmail: "system@a-os.dev",
      text: "Call connected. Secure audio & chat are live.",
      timestamp: new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(/* @__PURE__ */ new Date())
    });
  } else {
    call.status = "declined";
  }
  res.json({ success: true, session: call });
});
app.post("/api/acall/end", (req, res) => {
  const { callId } = req.body;
  const call = activeCalls.get(callId);
  if (call) {
    call.status = "ended";
    call.messages.push({
      id: `sys-${Date.now()}`,
      sender: "A-Call System",
      senderEmail: "system@a-os.dev",
      text: "Call ended.",
      timestamp: new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(/* @__PURE__ */ new Date())
    });
  }
  res.json({ success: true });
});
app.post("/api/acall/chat", (req, res) => {
  const { callId, senderEmail, senderName, text } = req.body;
  const call = activeCalls.get(callId);
  if (!call) {
    return res.status(404).json({ error: "Call not found" });
  }
  const newMsg = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sender: senderName || senderEmail,
    senderEmail: senderEmail.toLowerCase().trim(),
    text,
    timestamp: new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(/* @__PURE__ */ new Date())
  };
  call.messages.push(newMsg);
  res.json({ success: true, message: newMsg, allMessages: call.messages });
});
app.post("/api/acall/remote-control/request", (req, res) => {
  const { callId, requesterEmail } = req.body;
  const call = activeCalls.get(callId);
  if (!call) {
    return res.status(404).json({ error: "Call not found" });
  }
  call.remoteControl = {
    status: "requested",
    requesterEmail: requesterEmail.toLowerCase().trim(),
    events: []
  };
  res.json({ success: true, remoteControl: call.remoteControl });
});
app.post("/api/acall/remote-control/respond", (req, res) => {
  const { callId, allow } = req.body;
  const call = activeCalls.get(callId);
  if (!call || !call.remoteControl) {
    return res.status(404).json({ error: "No active remote control request" });
  }
  call.remoteControl.status = allow ? "active" : "denied";
  res.json({ success: true, remoteControl: call.remoteControl });
});
app.post("/api/acall/remote-control/events", (req, res) => {
  const { callId, event } = req.body;
  const call = activeCalls.get(callId);
  if (!call || !call.remoteControl || call.remoteControl.status !== "active") {
    return res.status(400).json({ error: "Remote control not active" });
  }
  call.remoteControl.events.push({ ...event, time: Date.now() });
  if (call.remoteControl.events.length > 40) {
    call.remoteControl.events.splice(0, call.remoteControl.events.length - 40);
  }
  res.json({ success: true });
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[A-OS Host] Server running on http://0.0.0.0:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
