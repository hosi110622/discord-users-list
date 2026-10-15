const columns = ["date", "server", "chromeProfile", "myUser", "otherUser", "isAccept", "replay", "status"];
const recordsBody = document.getElementById("records");
const message = document.getElementById("message");
const profileInput = document.getElementById("chrome-profile");
const profileMessage = document.getElementById("profile-message");
const filters = Object.fromEntries(columns.map((column) => [column, ""]));
let registeredUsers = [];
let profileSaveVersion = 0;
let showingAllData = false;

profileInput.addEventListener("change", () => {
  void saveChromeProfile(profileInput.value);
});

document.getElementById("view-all-data").addEventListener("click", () => {
  void loadAllData();
});

chrome.runtime.onMessage.addListener((incoming) => {
  if (incoming?.type !== "users:registered" || !incoming.record) {
    return;
  }
  showingAllData = false;
  clearFilters();
  registeredUsers = [incoming.record];
  render();
  message.textContent = "Showing the newly registered user.";
});

document.querySelectorAll("[data-filter]").forEach((input) => {
  input.addEventListener("input", () => {
    filters[input.dataset.filter] = input.value.trim().toLocaleLowerCase();
    render();
  });
});

loadChromeProfile();

async function loadChromeProfile() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "profile:get" });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not load the Chrome profile name.");
    }
    const savedProfile = response.chromeProfile;
    const isAvailable = Array.from(profileInput.options)
      .some((option) => option.value && option.value === savedProfile);

    if (isAvailable) {
      profileInput.value = savedProfile;
    } else {
      profileInput.value = "";
      if (savedProfile) {
        await saveChromeProfile("");
      }
    }
  } catch (error) {
    profileMessage.textContent = error instanceof Error
      ? error.message
      : "Could not load the Chrome profile name.";
  }
}

async function saveChromeProfile(chromeProfile) {
  const version = ++profileSaveVersion;
  profileMessage.textContent = "Saving profile...";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "profile:set",
      chromeProfile
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not save the Chrome profile name.");
    }
    if (version === profileSaveVersion) {
      profileMessage.textContent = "Profile saved.";
    }
  } catch (error) {
    if (version === profileSaveVersion) {
      profileMessage.textContent = error instanceof Error
        ? error.message
        : "Could not save the Chrome profile name.";
    }
  }
}

async function loadAllData() {
  const viewAllButton = document.getElementById("view-all-data");
  viewAllButton.disabled = true;
  message.textContent = "Loading all records...";
  try {
    const response = await chrome.runtime.sendMessage({ type: "users:list" });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not load registered users.");
    }
    registeredUsers = response.records;
    showingAllData = true;
    render();
    message.textContent = `Showing all ${registeredUsers.length} registered user(s).`;
  } catch (error) {
    message.textContent = error instanceof Error
      ? error.message
      : "Could not load registered users.";
  } finally {
    viewAllButton.disabled = false;
  }
}

function clearFilters() {
  Object.keys(filters).forEach((column) => {
    filters[column] = "";
  });
  document.querySelectorAll("[data-filter]").forEach((input) => {
    input.value = "";
  });
}

function render() {
  recordsBody.replaceChildren();
  const matchingRecords = registeredUsers.filter((record) =>
    columns.every((column) => {
      const search = filters[column];
      if (!search) {
        return true;
      }
      const value = column === "isAccept"
        ? (record.isAccept === "true" ? "yes true" : "no false")
        : String(record[column] ?? "");
      return value.toLocaleLowerCase().includes(search);
    })
  );

  if (matchingRecords.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty";
    cell.colSpan = 9;
    cell.textContent = !showingAllData && registeredUsers.length === 0
      ? "Click View All Data to load registered users."
      : registeredUsers.length === 0
        ? "No registered users yet."
        : "No matching users.";
    row.append(cell);
    recordsBody.append(row);
    return;
  }

  matchingRecords.forEach((record) => recordsBody.append(createRecordRow(record)));
}

function createRecordRow(record) {
  const row = document.createElement("tr");
  appendTextCell(row, record.date, "date-cell");
  appendTextCell(row, record.server, "server-cell");
  appendTextCell(row, record.chromeProfile, "chrome-profile-cell");
  appendTextCell(row, record.myUser, "my-user-cell");
  appendTextCell(row, record.otherUser, "other-user-cell");

  const accepted = document.createElement("select");
  accepted.className = "state-select";
  accepted.setAttribute("aria-label", `Accepted for ${record.otherUser}`);
  accepted.append(
    option("false", "No"),
    option("true", "Yes")
  );
  accepted.value = record.isAccept === "true" ? "true" : "false";
  setAcceptanceStyle(accepted);
  accepted.addEventListener("change", () => {
    setAcceptanceStyle(accepted);
    updateRecord(record.otherUser, "isAccept", accepted.value, accepted);
  });
  appendControlCell(row, accepted);

  const replay = document.createElement("input");
  replay.type = "number";
  replay.className = "replay-input";
  replay.min = "0";
  replay.step = "1";
  replay.value = String(Number.isSafeInteger(record.replay) && record.replay >= 0
    ? record.replay
    : 0);
  replay.setAttribute("aria-label", `Replay count for ${record.otherUser}`);
  replay.addEventListener("change", () => {
    const parsed = Number(replay.value);
    const value = Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
    replay.value = String(value);
    updateRecord(record.otherUser, "replay", value, replay);
  });
  appendControlCell(row, replay);

  const statusSelect = document.createElement("select");
  statusSelect.className = "state-select";
  statusSelect.setAttribute("aria-label", `Status for ${record.otherUser}`);
  statusSelect.append(option("living", "living"), option("dead", "dead"));
  statusSelect.value = record.status === "dead" ? "dead" : "living";
  setStatusStyle(statusSelect);
  statusSelect.addEventListener("change", () => {
    setStatusStyle(statusSelect);
    updateRecord(record.otherUser, "status", statusSelect.value, statusSelect);
  });
  appendControlCell(row, statusSelect);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.setAttribute("aria-label", `Delete ${record.otherUser}`);
  deleteButton.addEventListener("click", () => removeRecord(record.otherUser, deleteButton));
  appendControlCell(row, deleteButton);

  return row;
}

function appendTextCell(row, value, className) {
  const cell = document.createElement("td");
  cell.className = className;
  cell.textContent = String(value ?? "");
  row.append(cell);
}

function setAcceptanceStyle(select) {
  select.classList.toggle("is-accepted", select.value === "true");
  select.classList.toggle("is-not-accepted", select.value !== "true");
}

function setStatusStyle(select) {
  select.classList.toggle("is-living", select.value === "living");
  select.classList.toggle("is-dead", select.value === "dead");
}

function appendControlCell(row, control) {
  const cell = document.createElement("td");
  cell.append(control);
  row.append(cell);
}

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

async function updateRecord(otherUser, field, value, control) {
  control.disabled = true;
  message.textContent = "";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "users:update",
      otherUser,
      field,
      value
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not update this user.");
    }
    const record = registeredUsers.find(
      (item) => item.otherUser.toLowerCase() === otherUser.toLowerCase()
    );
    if (record) {
      record[field] = value;
      render();
    }
  } catch (error) {
    message.textContent = error instanceof Error
      ? error.message
      : "Could not update this user.";
    control.disabled = false;
  }
}

async function removeRecord(otherUser, button) {
  button.disabled = true;
  message.textContent = "";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "users:delete",
      otherUser
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not delete this user.");
    }
    registeredUsers = registeredUsers.filter(
      (record) => record.otherUser.toLowerCase() !== otherUser.toLowerCase()
    );
    render();
  } catch (error) {
    message.textContent = error instanceof Error
      ? error.message
      : "Could not delete this user.";
    button.disabled = false;
  }
}
