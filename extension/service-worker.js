const EDITABLE_FIELDS = new Set(["isAccept", "replay", "status"]);
const API_URL = "https://discord-users-list.onrender.com";
const LEGACY_LOCAL_KEY = "registeredUsers";
const LEGACY_SYNC_PREFIX = "user:";
const API_MIGRATION_KEY = "legacyRecordsImportedToMongo";
let mutationQueue = Promise.resolve();

chrome.storage.local.remove("apiToken").catch((error) => {
  console.error("Failed to remove the retired API token setting:", error);
});
chrome.storage.local.remove("apiUrl").catch((error) => {
  console.error("Failed to remove the retired API URL setting:", error);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!Number.isInteger(tab.windowId) || tab.windowId < 0) {
    console.error("Cannot open the registered users panel without a browser window.");
    return;
  }

  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.error("Failed to open the registered users panel:", error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      console.error("Registered users operation failed:", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "The operation failed."
      });
    });

  return true;
});

async function handleMessage(message) {
  if (message.type === "profile:get") {
    const stored = await chrome.storage.local.get("chromeProfile");
    return { ok: true, chromeProfile: stored.chromeProfile || "" };
  }

  if (message.type === "profile:set") {
    const chromeProfile = typeof message.chromeProfile === "string"
      ? message.chromeProfile.trim()
      : "";
    await chrome.storage.local.set({ chromeProfile });
    return { ok: true };
  }

  if (message.type === "users:list") {
    return { ok: true, records: await listUsers() };
  }

  if (message.type === "users:registered") {
    return { ok: true };
  }

  if (message.type === "users:register") {
    return serializeMutation(() => registerUser(message));
  }

  if (message.type === "users:update") {
    return serializeMutation(() => updateUser(message));
  }

  if (message.type === "users:delete") {
    return serializeMutation(() => deleteUser(message.otherUser));
  }

  return { ok: false, error: "Unknown operation." };
}

function serializeMutation(operation) {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.catch(() => {});
  return result;
}

async function requestApi(method, path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Database API returned an invalid response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(payload.error || `Database API request failed (HTTP ${response.status}).`);
  }
  return payload;
}

async function listUsers() {
  await importLegacyRecordsIfNeeded();
  const response = await requestApi("GET", "/api/users");
  if (!Array.isArray(response.records)) {
    throw new Error("Database API returned an invalid records list.");
  }
  return response.records.map(normalizeRecord);
}

async function importLegacyRecordsIfNeeded() {
  const state = await chrome.storage.local.get(API_MIGRATION_KEY);
  if (state[API_MIGRATION_KEY] === API_URL) {
    return;
  }

  const [localData, syncData] = await Promise.all([
    chrome.storage.local.get(LEGACY_LOCAL_KEY),
    chrome.storage.sync.get(null)
  ]);
  const localRecords = Array.isArray(localData[LEGACY_LOCAL_KEY])
    ? localData[LEGACY_LOCAL_KEY]
    : [];
  const syncRecords = Object.entries(syncData)
    .filter(([key]) => key.startsWith(LEGACY_SYNC_PREFIX))
    .map(([, record]) => record);
  const records = [...localRecords, ...syncRecords]
    .map(normalizeRecord)
    .filter((record) => record.otherUser && record.server);

  if (records.length > 0) {
    for (let start = 0; start < records.length; start += 100) {
      await requestApi("POST", "/api/users/import", {
        records: records.slice(start, start + 100)
      });
    }
  }
  await chrome.storage.local.set({ [API_MIGRATION_KEY]: API_URL });
}

function normalizeRecord(record) {
  return {
    date: typeof record.date === "string" ? record.date : "",
    server: typeof record.server === "string" ? record.server : record.servername || "",
    chromeProfile: typeof record.chromeProfile === "string" ? record.chromeProfile : "",
    myUser: typeof record.myUser === "string" ? record.myUser : "",
    otherUser: typeof record.otherUser === "string" ? record.otherUser : record.username || "",
    isAccept: record.isAccept === "true" ? "true" : "false",
    replay: Number.isSafeInteger(record.replay) && record.replay >= 0 ? record.replay : 0,
    status: record.status === "dead" ? "dead" : "living"
  };
}

async function registerUser(message) {
  const record = normalizeRecord({
    date: localDateString(),
    server: message.server,
    chromeProfile: message.chromeProfile,
    myUser: message.myUser,
    otherUser: message.otherUser,
    isAccept: "false",
    replay: 0,
    status: "living"
  });

  if (!record.otherUser || !record.server || !record.chromeProfile) {
    return { ok: false, error: "Chrome profile, other user, and server are required." };
  }

  await importLegacyRecordsIfNeeded();
  const response = await requestApi("POST", "/api/users", record);
  return {
    ok: true,
    duplicate: response.duplicate === true,
    record: normalizeRecord(response.record || record)
  };
}

async function updateUser(message) {
  const otherUser = typeof message.otherUser === "string" ? message.otherUser.trim() : "";
  const field = message.field;
  if (!otherUser || !EDITABLE_FIELDS.has(field)) {
    return { ok: false, error: "Invalid user or field." };
  }

  let value;
  if (field === "isAccept") {
    if (message.value !== "true" && message.value !== "false") {
      return { ok: false, error: "isAccept must be Yes or No." };
    }
    value = message.value;
  } else if (field === "replay") {
    value = Number(message.value);
    if (!Number.isSafeInteger(value) || value < 0) {
      return { ok: false, error: "Replay must be a non-negative integer." };
    }
  } else {
    if (message.value !== "living" && message.value !== "dead") {
      return { ok: false, error: "Status must be living or dead." };
    }
    value = message.value;
  }

  await requestApi("PATCH", "/api/users", { otherUser, field, value });
  return { ok: true };
}

async function deleteUser(otherUser) {
  if (typeof otherUser !== "string" || !otherUser.trim()) {
    return { ok: false, error: "Invalid other user." };
  }
  await requestApi("DELETE", "/api/users", { otherUser });
  return { ok: true };
}

function localDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
