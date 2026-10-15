const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("routes cloud record operations through the configured API", async () => {
  const localStore = {};
  const remoteRecords = new Map();
  let messageListener;
  const local = {
    async get(keys) {
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.filter((key) => key in localStore)
        .map((key) => [key, localStore[key]]));
    },
    async set(values) {
      Object.assign(localStore, values);
    }
  };
  const chrome = {
    action: { onClicked: { addListener() {} } },
    sidePanel: { async open() {} },
    runtime: { onMessage: { addListener(listener) { messageListener = listener; } } },
    storage: { local, sync: {
      async get() { return {}; }
    } }
  };

  const fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    let status = 200;
    let body = {};
    const input = options.body ? JSON.parse(options.body) : {};

    if (options.method === "GET" && path === "/api/users") {
      body = { records: Array.from(remoteRecords.values()) };
    } else if (options.method === "POST" && path === "/api/users/import") {
      body = { ok: true, imported: 0 };
    } else if (options.method === "POST" && path === "/api/users") {
      const key = input.otherUser.trim().toLowerCase();
      if (remoteRecords.has(key)) {
        body = { ok: true, duplicate: true };
      } else {
        remoteRecords.set(key, input);
        body = { ok: true, duplicate: false };
      }
    } else if (options.method === "PATCH" && path === "/api/users") {
      const record = remoteRecords.get(input.otherUser.trim().toLowerCase());
      if (!record) {
        status = 404;
        body = { error: "This user is no longer registered." };
      } else {
        record[input.field] = input.value;
        body = { ok: true };
      }
    } else if (options.method === "DELETE" && path === "/api/users") {
      remoteRecords.delete(input.otherUser.trim().toLowerCase());
      body = { ok: true };
    } else {
      status = 404;
      body = { error: "Endpoint not found." };
    }

    return {
      ok: status >= 200 && status < 300,
      status,
      async json() { return body; }
    };
  };

  const extensionWorker = path.join(__dirname, "..", "..", "extension", "service-worker.js");
  vm.runInNewContext(fs.readFileSync(extensionWorker, "utf8"), {
    chrome,
    fetch,
    URL,
    console
  });

  const send = (message) => new Promise((resolve) => {
    messageListener(message, {}, resolve);
  });

  const connection = await send({
    type: "cloud:set-settings",
    apiUrl: "https://example.onrender.com",
    apiToken: "test-token"
  });
  assert.equal(connection.ok, true);

  const created = await send({
    type: "users:register",
    server: "Guild",
    chromeProfile: "Profile A",
    myUser: "Me",
    otherUser: "Other"
  });
  assert.equal(created.duplicate, false);

  const duplicate = await send({
    type: "users:register",
    server: "Guild",
    chromeProfile: "Profile B",
    myUser: "Someone",
    otherUser: " other "
  });
  assert.equal(duplicate.duplicate, true);

  assert.equal((await send({
    type: "users:update",
    otherUser: "OTHER",
    field: "replay",
    value: 4
  })).ok, true);
  assert.equal((await send({ type: "users:list" })).records[0].replay, 4);
  assert.equal((await send({ type: "users:delete", otherUser: "Other" })).ok, true);
  assert.equal((await send({ type: "users:list" })).records.length, 0);
});
