const http = require("node:http");
const { createHash, timingSafeEqual } = require("node:crypto");
const { MongoClient } = require("mongodb");

const PORT = Number(process.env.PORT || 3000);
const API_TOKEN = process.env.API_TOKEN || "";
const DATABASE_NAME = process.env.MONGODB_DATABASE || "discord_user_register";
const MAX_BODY_BYTES = 256 * 1024;
const EDITABLE_FIELDS = new Set(["isAccept", "replay", "status"]);
let collection;

async function start() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI must be configured.");
  }
  if (API_TOKEN.length < 32) {
    throw new Error("API_TOKEN must be at least 32 characters long.");
  }

  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  });
  await client.connect();
  collection = client.db(DATABASE_NAME).collection("registered_users");
  await collection.createIndex({ otherUserKey: 1 }, { unique: true });

  const server = http.createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      console.error("API request failed:", error.message);
      sendJson(response, error.statusCode || 500, {
        error: error.statusCode ? error.message : "The database operation failed."
      });
    });
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Discord user register API listening on port ${PORT}.`);
  });

  const close = async () => {
    server.close();
    await client.close();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

async function handleRequest(request, response) {
  addSecurityHeaders(response);
  if (!validateOrigin(request, response)) {
    sendJson(response, 403, { error: "This extension origin is not allowed." });
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url, "http://localhost");
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: "Invalid API token." });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/users") {
    const records = await collection.find({}, { projection: { _id: 0, otherUserKey: 0 } })
      .sort({ date: -1, otherUser: 1 })
      .toArray();
    sendJson(response, 200, { records });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/users") {
    await createUser(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/users/import") {
    await importUsers(request, response);
    return;
  }

  if (request.method === "PATCH" && url.pathname === "/api/users") {
    await updateUser(request, response);
    return;
  }

  if (request.method === "DELETE" && url.pathname === "/api/users") {
    await deleteUser(request, response);
    return;
  }

  sendJson(response, 404, { error: "Endpoint not found." });
}

function addSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Origin");
}

function validateOrigin(request, response) {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }

  let isExtensionOrigin = false;
  try {
    isExtensionOrigin = new URL(origin).protocol === "chrome-extension:";
  } catch {
    return false;
  }
  if (!isExtensionOrigin) {
    return false;
  }

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
  return true;
}

function isAuthorized(request) {
  const provided = request.headers.authorization || "";
  if (!provided.startsWith("Bearer ")) {
    return false;
  }
  const providedHash = createHash("sha256").update(provided.slice(7)).digest();
  const expectedHash = createHash("sha256").update(API_TOKEN).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

async function createUser(request, response) {
  const record = normalizeRecord(await readJson(request));
  if (!record) {
    sendJson(response, 400, { error: "Required record fields are invalid." });
    return;
  }

  try {
    await collection.insertOne({
      ...record,
      otherUserKey: normalizeUsername(record.otherUser)
    });
    sendJson(response, 201, { ok: true, duplicate: false, record });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await collection.findOne(
        { otherUserKey: normalizeUsername(record.otherUser) },
        { projection: { _id: 0, otherUserKey: 0 } }
      );
      sendJson(response, 200, {
        ok: true,
        duplicate: true,
        record: existing ? normalizeRecord(existing) : record
      });
      return;
    }
    throw error;
  }
}

async function importUsers(request, response) {
  const body = await readJson(request);
  if (!Array.isArray(body.records) || body.records.length > 1000) {
    sendJson(response, 400, { error: "Import must contain at most 1000 records." });
    return;
  }

  let imported = 0;
  for (const candidate of body.records) {
    const record = normalizeRecord(candidate);
    if (!record) {
      continue;
    }
    const result = await collection.updateOne(
      { otherUserKey: normalizeUsername(record.otherUser) },
      { $setOnInsert: { ...record, otherUserKey: normalizeUsername(record.otherUser) } },
      { upsert: true }
    );
    imported += result.upsertedCount;
  }

  sendJson(response, 200, { ok: true, imported });
}

async function updateUser(request, response) {
  const body = await readJson(request);
  const otherUserKey = normalizeUsername(body.otherUser);
  if (!otherUserKey || !EDITABLE_FIELDS.has(body.field)) {
    sendJson(response, 400, { error: "Invalid user or field." });
    return;
  }

  let value;
  if (body.field === "isAccept") {
    if (body.value !== "true" && body.value !== "false") {
      sendJson(response, 400, { error: "isAccept must be Yes or No." });
      return;
    }
    value = body.value;
  } else if (body.field === "replay") {
    if (!Number.isSafeInteger(body.value) || body.value < 0) {
      sendJson(response, 400, { error: "Replay must be a non-negative integer." });
      return;
    }
    value = body.value;
  } else {
    if (body.value !== "living" && body.value !== "dead") {
      sendJson(response, 400, { error: "Status must be living or dead." });
      return;
    }
    value = body.value;
  }

  const result = await collection.updateOne(
    { otherUserKey },
    { $set: { [body.field]: value } }
  );
  if (!result.matchedCount) {
    sendJson(response, 404, { error: "This user is no longer registered." });
    return;
  }
  sendJson(response, 200, { ok: true });
}

async function deleteUser(request, response) {
  const body = await readJson(request);
  const otherUserKey = normalizeUsername(body.otherUser);
  if (!otherUserKey) {
    sendJson(response, 400, { error: "Invalid other user." });
    return;
  }

  const result = await collection.deleteOne({ otherUserKey });
  if (!result.deletedCount) {
    sendJson(response, 404, { error: "This user is no longer registered." });
    return;
  }
  sendJson(response, 200, { ok: true });
}

function normalizeRecord(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const record = {
    date: typeof candidate.date === "string" ? candidate.date : "",
    server: typeof candidate.server === "string"
      ? candidate.server.trim()
      : typeof candidate.servername === "string" ? candidate.servername.trim() : "",
    chromeProfile: typeof candidate.chromeProfile === "string"
      ? candidate.chromeProfile.trim()
      : "",
    myUser: typeof candidate.myUser === "string" ? candidate.myUser.trim() : "",
    otherUser: typeof candidate.otherUser === "string"
      ? candidate.otherUser.trim()
      : typeof candidate.username === "string" ? candidate.username.trim() : "",
    isAccept: candidate.isAccept === "true" ? "true" : "false",
    replay: Number.isSafeInteger(candidate.replay) && candidate.replay >= 0
      ? candidate.replay
      : 0,
    status: candidate.status === "dead" ? "dead" : "living"
  };
  return record.server && record.otherUser ? record : null;
}

function normalizeUsername(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(response, statusCode, body) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

if (require.main === module) {
  start().catch((error) => {
    console.error("API startup failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { normalizeRecord, normalizeUsername };
