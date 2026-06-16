document.addEventListener("DOMContentLoaded", () => {
  // --- DOM Elements ---
  const settingsForm = document.getElementById("settings-form");
  const keywordTagsContainer = document.getElementById("keyword-tags-container");
  const keywordInput = document.getElementById("keyword-input");
  const locationIdInput = document.getElementById("location_id");
  const locationSelect = document.getElementById("location_select");
  const locationCustomHelp = document.getElementById("location-custom-help");
  const checkIntervalInput = document.getElementById("check_interval_min");
  const maxPriceInput = document.getElementById("max_price");
  const headlessCheckbox = document.getElementById("headless");
  const telegramTokenInput = document.getElementById("telegram_token");
  const telegramChatIdInput = document.getElementById("telegram_chat_id");
  const telegramWebhookUrlInput = document.getElementById("telegram_webhook_url");

  const btnSaveSettings = document.getElementById("btn-save-settings");
  const btnTestTelegram = document.getElementById("btn-test-telegram");
  const btnStartDaemon = document.getElementById("btn-start-daemon");
  const btnStopDaemon = document.getElementById("btn-stop-daemon");
  const btnDryRun = document.getElementById("btn-dry-run");
  const btnClearTerminal = document.getElementById("btn-clear-terminal");

  const btnStartLogin = document.getElementById("btn-start-login");
  const btnConfirmLogin = document.getElementById("btn-confirm-login");
  const btnClearLock = document.getElementById("btn-clear-lock");
  const loginStatusBadge = document.getElementById("login-status-badge");
  const loginInstructions = document.getElementById("login-instructions");

  const daemonStatusBadge = document.getElementById("daemon-status-badge");
  const terminalBody = document.getElementById("terminal-body");

  // --- State Variables ---
  let keywordsList = [];
  let lastLogsLength = 0;

  // --- Form Tag Handling ---
  function renderTags() {
    const existingTags = keywordTagsContainer.querySelectorAll(".keyword-tag");
    existingTags.forEach((tag) => tag.remove());

    keywordsList.forEach((kw, idx) => {
      const tagEl = document.createElement("div");
      tagEl.className = "keyword-tag";
      tagEl.innerHTML = `
        <span>${escapeHtml(kw)}</span>
        <span class="remove" data-index="${idx}">×</span>
      `;
      keywordTagsContainer.insertBefore(tagEl, keywordInput);
    });

    keywordTagsContainer.querySelectorAll(".keyword-tag .remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.getAttribute("data-index"), 10);
        keywordsList.splice(idx, 1);
        renderTags();
      });
    });
  }

  keywordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = keywordInput.value.trim();
      if (val && !keywordsList.includes(val)) {
        keywordsList.push(val);
        renderTags();
      }
      keywordInput.value = "";
    }
  });

  keywordInput.addEventListener("blur", () => {
    const val = keywordInput.value.trim();
    if (val && !keywordsList.includes(val)) {
      keywordsList.push(val);
      renderTags();
    }
    keywordInput.value = "";
  });

  locationSelect.addEventListener("change", () => {
    const isCustom = locationSelect.value === "custom";
    locationIdInput.style.display = isCustom ? "block" : "none";
    locationCustomHelp.style.display = isCustom ? "block" : "none";
    if (!isCustom) locationIdInput.value = "";
  });

  // --- API Communications ---

  async function loadConfig() {
    try {
      const response = await fetch("/api/config");
      if (!response.ok) throw new Error("Failed to load config");
      const config = await response.json();

      keywordsList = config.keywords || [];
      renderTags();

      const savedLocationId = config.location_id || "";
      const knownOptions = Array.from(locationSelect.options)
        .map((o) => o.value)
        .filter((v) => v && v !== "custom");
      if (!savedLocationId) {
        locationSelect.value = "";
        locationIdInput.style.display = "none";
        locationCustomHelp.style.display = "none";
      } else if (knownOptions.includes(savedLocationId)) {
        locationSelect.value = savedLocationId;
        locationIdInput.style.display = "none";
        locationCustomHelp.style.display = "none";
      } else {
        locationSelect.value = "custom";
        locationIdInput.style.display = "block";
        locationCustomHelp.style.display = "block";
        locationIdInput.value = savedLocationId;
      }
      checkIntervalInput.value = config.check_interval_min || 15;
      maxPriceInput.value = config.max_price || "";
      headlessCheckbox.checked = config.headless !== undefined ? config.headless : true;
      telegramTokenInput.value = config.telegram_token || "";
      telegramChatIdInput.value = config.telegram_chat_id || "";
      telegramWebhookUrlInput.value = config.telegram_webhook_url || "";

      writeSystemLog("System: Configuration loaded successfully.");
    } catch (e) {
      writeSystemLog(`Error: ${e.message}`, "error");
    }
  }

  async function saveConfig() {
    btnSaveSettings.disabled = true;
    btnSaveSettings.innerText = "Saving...";

    const payload = {
      keywords: keywordsList,
      location_id: locationSelect.value === "custom" ? locationIdInput.value.trim() : locationSelect.value,
      check_interval_min: parseInt(checkIntervalInput.value, 10) || 15,
      max_price: maxPriceInput.value ? parseInt(maxPriceInput.value, 10) : 0,
      headless: headlessCheckbox.checked,
      telegram_token: telegramTokenInput.value.trim(),
      telegram_chat_id: telegramChatIdInput.value.trim(),
      telegram_webhook_url: telegramWebhookUrlInput.value.trim(),
    };

    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save config");

      writeSystemLog("System: Settings saved successfully.");
      alert("Settings saved!");
    } catch (e) {
      writeSystemLog(`Save error: ${e.message}`, "error");
      alert(`Failed: ${e.message}`);
    } finally {
      btnSaveSettings.disabled = false;
      btnSaveSettings.innerText = "Save settings";
    }
  }

  btnSaveSettings.addEventListener("click", saveConfig);

  btnTestTelegram.addEventListener("click", async () => {
    btnTestTelegram.disabled = true;
    btnTestTelegram.innerText = "Sending...";
    writeSystemLog("System: Sending test message to Telegram...");

    try {
      const response = await fetch("/api/test-telegram", { method: "POST" });
      const data = await response.json();
      if (data.success) {
        writeSystemLog("System: Test message sent! Check your Telegram.", "success");
        alert("Test message sent! Please check your Telegram.");
      } else {
        throw new Error(data.output || "Test failed");
      }
    } catch (e) {
      writeSystemLog(`Telegram test error: ${e.message}`, "error");
      alert(`Test failed. Check the logs for details.`);
    } finally {
      btnTestTelegram.disabled = false;
      btnTestTelegram.innerText = "Test Telegram";
    }
  });

  btnStartDaemon.addEventListener("click", async () => {
    btnStartDaemon.disabled = true;
    writeSystemLog("System: Requesting monitor start...");

    try {
      const response = await fetch("/api/start", { method: "POST" });
      const data = await response.json();
      if (data.success) {
        writeSystemLog("System: Monitor started successfully.", "success");
      } else {
        throw new Error(data.error);
      }
    } catch (e) {
      writeSystemLog(`Start error: ${e.message}`, "error");
      btnStartDaemon.disabled = false;
    }
  });

  btnStopDaemon.addEventListener("click", async () => {
    btnStopDaemon.disabled = true;
    writeSystemLog("System: Requesting monitor stop...");

    try {
      const response = await fetch("/api/stop", { method: "POST" });
      const data = await response.json();
      if (data.success) {
        writeSystemLog("System: Monitor stopped.", "warning");
      } else {
        throw new Error(data.error);
      }
    } catch (e) {
      writeSystemLog(`Stop error: ${e.message}`, "error");
      btnStopDaemon.disabled = false;
    }
  });

  btnDryRun.addEventListener("click", async () => {
    btnDryRun.disabled = true;
    btnDryRun.innerText = "Scanning...";
    writeSystemLog("System: Starting Marketplace dry run...");

    try {
      const response = await fetch("/api/dry-run", { method: "POST" });
      const data = await response.json();
      if (data.success) {
        writeSystemLog("System: Dry run completed successfully.", "success");
      } else {
        throw new Error(data.output || "Dry run failed");
      }
    } catch (e) {
      writeSystemLog(`Dry run error: ${e.message}`, "error");
    } finally {
      btnDryRun.disabled = false;
      btnDryRun.innerText = "Dry run";
    }
  });

  btnClearTerminal.addEventListener("click", () => {
    terminalBody.innerHTML = "";
    writeSystemLog("Terminal cleared.");
  });

  const telegramHelpModal = document.getElementById("telegram-help-modal");
  document.getElementById("btn-telegram-help").addEventListener("click", () => {
    telegramHelpModal.style.display = "flex";
  });
  document.getElementById("btn-close-modal").addEventListener("click", () => {
    telegramHelpModal.style.display = "none";
  });
  telegramHelpModal.addEventListener("click", (e) => {
    if (e.target === telegramHelpModal) telegramHelpModal.style.display = "none";
  });

  document.getElementById("btn-open-getupdates").addEventListener("click", () => {
    const token = telegramTokenInput.value.trim();
    const hint = document.getElementById("getupdates-hint");
    if (!token || token.includes("YOUR_TELEGRAM")) {
      hint.style.display = "block";
      hint.style.color = "var(--danger)";
      hint.textContent = "⚠️ Please paste your Bot Token in the field first, then re-open this guide.";
      return;
    }
    const url = `https://api.telegram.org/bot${token}/getUpdates`;
    hint.style.display = "block";
    hint.style.color = "var(--text-muted)";
    hint.textContent = `Opening: ${url}`;
    window.open(url, "_blank", "noopener");
  });

  async function pollStatus() {
    try {
      const response = await fetch("/api/status");
      const data = await response.json();

      if (data.running) {
        daemonStatusBadge.innerText = "Running";
        daemonStatusBadge.className = "badge badge-running";
        btnStartDaemon.disabled = true;
        btnStopDaemon.disabled = false;
      } else {
        daemonStatusBadge.innerText = "Stopped";
        daemonStatusBadge.className = "badge badge-stopped";
        btnStartDaemon.disabled = false;
        btnStopDaemon.disabled = true;
      }
    } catch (e) {
      // Ignore poll connection drops silently
    }
  }

  async function pollLogs() {
    try {
      const response = await fetch("/api/logs");
      const data = await response.json();
      const logs = data.logs || [];

      if (logs.length < lastLogsLength) {
        terminalBody.innerHTML = "";
        lastLogsLength = 0;
      }

      if (logs.length > lastLogsLength) {
        const newLogs = logs.slice(lastLogsLength);
        newLogs.forEach((line) => {
          if (!line.trim()) return;
          const lineEl = document.createElement("div");

          const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, "");
          lineEl.className = "log-line";
          lineEl.innerText = cleanLine;

          if (line.includes("[INFO]") || line.includes("\x1b[94mINFO")) {
            lineEl.classList.add("info-log");
          } else if (line.includes("[SUCCESS]") || line.includes("\x1b[92mSUCCESS")) {
            lineEl.classList.add("success-log");
          } else if (line.includes("[WARNING]") || line.includes("\x1b[93mWARNING")) {
            lineEl.classList.add("warning-log");
          } else if (line.includes("[ERROR]") || line.includes("\x1b[91mERROR")) {
            lineEl.classList.add("error-log");
          } else if (line.startsWith("---") || line.includes("[System]")) {
            lineEl.classList.add("system-line");
          }

          terminalBody.appendChild(lineEl);
        });

        lastLogsLength = logs.length;
        terminalBody.scrollTop = terminalBody.scrollHeight;
      }
    } catch (e) {
      // Ignore log fetch errors
    }
  }

  function writeSystemLog(msg, level = "") {
    const timestamp = new Date().toLocaleString("sv-SE", { timeZone: "Australia/Melbourne", hour12: false }).substring(0, 19);
    const lineEl = document.createElement("div");
    lineEl.className = "log-line system-line";
    if (level === "error") lineEl.className = "log-line error-log";
    if (level === "success") lineEl.className = "log-line success-log";
    if (level === "warning") lineEl.className = "log-line warning-log";

    lineEl.innerText = `[${timestamp}] ${msg}`;
    terminalBody.appendChild(lineEl);
    terminalBody.scrollTop = terminalBody.scrollHeight;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  const vncLinkRow = document.getElementById("vnc-link-row");
  const vncLink = document.getElementById("vnc-link");

  btnClearLock.addEventListener("click", async () => {
    btnClearLock.disabled = true;
    writeSystemLog("System: Clearing profile lock files...");
    try {
      const response = await fetch("/api/login/clear-lock", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      writeSystemLog("System: Lock cleared. You can now try logging in again.", "success");
    } catch (e) {
      writeSystemLog(`Clear lock error: ${e.message}`, "error");
    } finally {
      btnClearLock.disabled = false;
    }
  });

  btnStartLogin.addEventListener("click", async () => {
    btnStartLogin.disabled = true;
    writeSystemLog("System: Opening Facebook login browser...");

    try {
      const response = await fetch("/api/login/start", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not open login browser");

      writeSystemLog("System: Browser opened. Please log in on the server.", "success");
      loginInstructions.style.display = "block";
      btnConfirmLogin.disabled = false;

      if (data.vncAvailable) {
        const vncUrl = `http://${location.hostname}:6080/vnc.html?autoconnect=1&resize=scale`;
        vncLink.href = vncUrl;
        vncLinkRow.style.display = "block";
        writeSystemLog(`System: VNC viewer ready → ${vncUrl}`, "success");
      } else {
        vncLinkRow.style.display = "none";
      }
    } catch (e) {
      writeSystemLog(`Login error: ${e.message}`, "error");
      btnStartLogin.disabled = false;
    }
  });

  btnConfirmLogin.addEventListener("click", async () => {
    btnConfirmLogin.disabled = true;
    writeSystemLog("System: Saving login session...");

    try {
      const response = await fetch("/api/login/confirm", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not confirm login");

      writeSystemLog("System: Confirmation sent. Closing browser and saving session...", "success");
      loginInstructions.style.display = "none";
    } catch (e) {
      writeSystemLog(`Login confirm error: ${e.message}`, "error");
      btnConfirmLogin.disabled = false;
    }
  });

  async function pollLoginStatus() {
    try {
      const response = await fetch("/api/login/status");
      const data = await response.json();

      if (data.status === "waiting") {
        loginStatusBadge.textContent = "Waiting for login";
        loginStatusBadge.className = "badge badge-running";
        btnStartLogin.disabled = true;
        btnConfirmLogin.disabled = false;
        loginInstructions.style.display = "block";
      } else if (data.status === "done") {
        loginStatusBadge.textContent = "Logged in ✓";
        loginStatusBadge.className = "badge badge-running";
        btnStartLogin.disabled = false;
        btnConfirmLogin.disabled = true;
        loginInstructions.style.display = "none";
      } else if (data.status === "error") {
        loginStatusBadge.textContent = "Login failed";
        loginStatusBadge.className = "badge badge-stopped";
        btnStartLogin.disabled = false;
        btnConfirmLogin.disabled = true;
        loginInstructions.style.display = "none";
      } else {
        loginStatusBadge.textContent = "Not authenticated";
        loginStatusBadge.className = "badge badge-stopped";
        btnStartLogin.disabled = false;
        btnConfirmLogin.disabled = true;
      }
    } catch (e) {
      // Ignore poll errors
    }
  }

  loadConfig();
  pollStatus();
  // Disable start button until first poll resolves to prevent double-click on reload
  btnStartLogin.disabled = true;
  pollLoginStatus();

  setInterval(pollStatus, 3000);
  setInterval(pollLogs, 1500);
  setInterval(pollLoginStatus, 3000);
});
