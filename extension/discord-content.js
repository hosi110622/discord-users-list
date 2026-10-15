(() => {
  let ctrlPressed = false;
  let pointerActive = false;
  let ctrlDrag = false;
  let dragged = false;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let dragSelection = "";
  let promptHost = null;
  let notificationHost = null;

  document.addEventListener("keydown", (event) => {
    if (event.key === "Control") {
      ctrlPressed = true;
      if (pointerActive) {
        ctrlDrag = true;
      }
    }
  }, true);

  document.addEventListener("keyup", (event) => {
    if (event.key === "Control") {
      ctrlPressed = false;
    }
  }, true);

  window.addEventListener("blur", () => {
    ctrlPressed = false;
    pointerActive = false;
    ctrlDrag = false;
    dragged = false;
    dragSelection = "";
  });

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    pointerActive = true;
    ctrlDrag = ctrlPressed || event.ctrlKey;
    dragged = false;
    dragSelection = "";
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
  }, true);

  document.addEventListener("pointermove", (event) => {
    if (!pointerActive) {
      return;
    }

    if (Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY) > 3) {
      dragged = true;
    }
    if (ctrlPressed || event.ctrlKey) {
      ctrlDrag = true;
    }
  }, true);

  document.addEventListener("selectionchange", () => {
    if (pointerActive && ctrlDrag) {
      dragSelection = getSelectedText() || dragSelection;
    }
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "discord:get-details") {
      sendResponse(getCurrentServerDetails());
      return false;
    }

    if (message?.type === "discord:get-username") {
      sendResponse(getCurrentUsername());
      return false;
    }

    return false;
  });

  document.addEventListener("mouseup", (event) => {
    const isCtrlDrag = dragged && (ctrlDrag || ctrlPressed || event.ctrlKey);
    const clientX = event.clientX;
    const clientY = event.clientY;
    const selectedBeforeMouseup = getSelectedText();

    if (!isCtrlDrag) {
      resetDrag();
      return;
    }

    const username = selectedBeforeMouseup || dragSelection;
    resetDrag();

    window.setTimeout(() => {
      const selectedUsername = getSelectedText() || username;
      if (!selectedUsername) {
        return;
      }

      showSavePrompt(
        selectedUsername,
        getCurrentServerName(),
        getCurrentUsername() || "",
        clientX,
        clientY
      );
    }, 0);
  }, true);

  function getSelectedText() {
    return window.getSelection()?.toString().replace(/\s+/g, " ").trim() || "";
  }

  function resetDrag() {
    pointerActive = false;
    ctrlDrag = false;
    dragged = false;
    dragSelection = "";
  }

  function getCurrentServerDetails() {
    const selected = document.querySelector(
      '[role="treeitem"][aria-selected="true"][data-list-item-id^="guildsnav"]'
    );

    if (!selected) {
      return null;
    }

    const listItemId = selected.getAttribute("data-list-item-id") || "";
    const guildMatch = listItemId.match(/^guildsnav__+(\d+)$/);
    if (!guildMatch) {
      return null;
    }

    const candidates = [
      selected.getAttribute("title"),
      selected.getAttribute("aria-label"),
      selected.closest('[role="group"]')?.getAttribute("aria-label"),
      ...Array.from(selected.querySelectorAll("[aria-label], [title]"))
        .flatMap((element) => [
          element.getAttribute("title"),
          element.getAttribute("aria-label")
        ]),
      selected.textContent
    ];

    const name = candidates
      .map((candidate) => candidate
        ?.replace(/\s+/g, " ")
        .trim()
        .replace(/^\d[\d,]*\s+mentions?,\s*/i, "")
        .replace(/,\s*voice call active\b.*$/i, "")
        .trim())
      .find((candidate) => candidate && !/^(servers|direct messages)$/i.test(candidate));

    if (!name) {
      return null;
    }

    const currentUrl = new URL(window.location.href);
    const currentGuild = currentUrl.pathname.match(/^\/channels\/(\d+)(?:\/|$)/);
    const url = currentGuild?.[1] === guildMatch[1]
      ? currentUrl.href
      : `https://discord.com/channels/${guildMatch[1]}`;
    return { name, url };
  }

  function getCurrentServerName() {
    return getCurrentServerDetails()?.name || "";
  }

  function getCurrentUsername() {
    const panel = document.querySelector(
      'section[aria-label="User status and settings"]'
    );
    const subtext = panel?.querySelector('[class*="panelSubtextContainer"]');
    const nameElement = subtext?.querySelector('[class*="hovered"]');
    return (nameElement?.textContent || subtext?.textContent)
      ?.replace(/\s+/g, " ")
      .trim()
      .replace(/\s*online$/i, "")
      .trim() || null;
  }

  async function showSavePrompt(otherUser, server, myUser, clientX, clientY) {
    let chromeProfile = "";
    try {
      const response = await chrome.runtime.sendMessage({ type: "profile:get" });
      if (!response?.ok) {
        throw new Error(response?.error || "Could not load the Chrome profile name.");
      }
      chromeProfile = response.chromeProfile;
    } catch (error) {
      showNotification(error instanceof Error
        ? error.message
        : "Could not load the Chrome profile name.");
      return;
    }

    removePrompt();
    promptHost = document.createElement("div");
    promptHost.style.cssText = [
      "all:initial",
      "position:fixed",
      "z-index:2147483647",
      `left:${Math.max(8, Math.min(clientX, window.innerWidth - 300))}px`,
      `top:${Math.max(8, Math.min(clientY, window.innerHeight - 200))}px`
    ].join(";");

    const shadow = promptHost.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .card {
          box-sizing: border-box; width: 284px; padding: 14px;
          border: 1px solid #45474f; border-radius: 8px;
          color: #f2f3f5; background: #232428;
          box-shadow: 0 6px 24px #0009;
          font: 13px/1.45 system-ui, sans-serif;
        }
        .value { margin: 8px 0; overflow-wrap: anywhere; }
        .label { color: #b5bac1; font-size: 11px; font-weight: 600; }
        .buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
        button {
          border: 0; border-radius: 4px; padding: 6px 12px;
          color: white; background: #4e5058; cursor: pointer;
          font: 600 12px system-ui, sans-serif;
        }
        button.save { background: #5865f2; }
        button:disabled { cursor: wait; opacity: .65; }
        .error { color: #f2a6a6; margin-top: 8px; }
      </style>
      <div class="card" role="dialog" aria-label="Save Discord user">
        <div>Save this information?</div>
        <div class="value"><span class="label">Other user</span><br><span class="other-user"></span></div>
        <div class="value"><span class="label">My user</span><br><span class="my-user"></span></div>
        <div class="value"><span class="label">Server</span><br><span class="server"></span></div>
        <div class="value"><span class="label">Chrome profile</span><br><span class="chrome-profile"></span></div>
        <div class="buttons">
          <button type="button" class="cancel">Cancel</button>
          <button type="button" class="save">Save</button>
        </div>
        <div class="error" role="status"></div>
      </div>`;

    shadow.querySelector(".other-user").textContent = otherUser;
    shadow.querySelector(".my-user").textContent = myUser || "Not detected";
    shadow.querySelector(".server").textContent = server || "Not detected";
    shadow.querySelector(".chrome-profile").textContent = chromeProfile || "Not entered";
    shadow.querySelector(".cancel").addEventListener("click", removePrompt);
    shadow.querySelector(".save").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const error = shadow.querySelector(".error");
      button.disabled = true;
      error.textContent = "";

      try {
        if (!server || !chromeProfile) {
          throw new Error("Enter a Chrome profile name and select a server before saving.");
        }

        const response = await chrome.runtime.sendMessage({
          type: "users:register",
          otherUser,
          myUser,
          server,
          chromeProfile
        });

        if (!response?.ok) {
          throw new Error(response?.error || "Could not save this user.");
        }

        removePrompt();
        showNotification(response.duplicate
          ? "This user is already registered."
          : "Successfully registered.");
      } catch (saveError) {
        error.textContent = saveError instanceof Error
          ? saveError.message
          : "Could not save this user.";
        button.disabled = false;
      }
    });

    document.documentElement.append(promptHost);
  }

  function removePrompt() {
    promptHost?.remove();
    promptHost = null;
  }

  function showNotification(message) {
    notificationHost?.remove();
    const host = document.createElement("div");
    host.style.cssText =
      "all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647";
    notificationHost = host;
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        div {
          padding: 10px 16px; border: 1px solid #45474f; border-radius: 6px;
          color: #f2f3f5; background: #232428; box-shadow: 0 4px 16px #0008;
          font: 13px system-ui, sans-serif;
        }
      </style>
      <div role="status" aria-live="polite"></div>`;
    shadow.querySelector("div").textContent = message;
    document.documentElement.append(host);
    window.setTimeout(() => {
      host.remove();
      if (notificationHost === host) {
        notificationHost = null;
      }
    }, 3000);
  }
})();
