import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

import { setTelegramWebhook, sendTyping, sendTelegramMessage } from "./telegram";
import { createUtils, AppState } from "./utils";
import { createRouter } from "./routes";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const CONFIG_EXAMPLE_PATH = path.join(__dirname, "..", "config.example.json");

// DATA_DIR: where runtime files live.
// Defaults to project root for local dev; set to /app/data in Docker.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "..");

const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const LOG_FILE = path.join(DATA_DIR, "monitor.log");
const MONITOR_PATH = path.join(__dirname, "monitor.js");
const PROJECT_ROOT = path.join(__dirname, "..");
const STATUS_PATH = path.join(DATA_DIR, "status.json");
const MONITOR_STATE_PATH = path.join(DATA_DIR, "monitor_state.json");

// ── Bootstrap data directory & config files ───────────────────────────────────

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(CONFIG_PATH) || fs.statSync(CONFIG_PATH).size === 0) {
  if (fs.existsSync(CONFIG_EXAMPLE_PATH)) {
    fs.copyFileSync(CONFIG_EXAMPLE_PATH, CONFIG_PATH);
    console.log("config.json created from config.example.json. Update your settings via the dashboard.");
  } else {
    console.warn("Warning: Neither config.json nor config.example.json found.");
  }
}

const HISTORY_PATH = path.join(DATA_DIR, "history.json");
if (!fs.existsSync(HISTORY_PATH) || fs.statSync(HISTORY_PATH).size === 0) {
  fs.writeFileSync(HISTORY_PATH, "[]", "utf-8");
}

// ── Shared state & utilities ──────────────────────────────────────────────────

const USE_XVFB = process.env.USE_XVFB === "true";
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const state: AppState = {
  monitorProcess: null,
  loginProcess: null,
  xvfbProcess: null,
  vncProcess: null,
  novncProcess: null,
  loginStatus: "idle",
};

const { saveMonitorState, loadMonitorState, stopVncStack, detectSavedSession, logBuffer, addToLog } = createUtils({
  MONITOR_STATE_PATH,
  CONFIG_PATH,
  PROJECT_ROOT,
  LOG_FILE,
  state,
});

state.loginStatus = detectSavedSession() ? "done" : "idle";

// ── Mount routes ──────────────────────────────────────────────────────────────

app.use(
  createRouter({
    CONFIG_PATH,
    MONITOR_PATH,
    PROJECT_ROOT,
    STATUS_PATH,
    USE_XVFB,
    sleep,
    state,
    logBuffer,
    addToLog,
    saveMonitorState,
    stopVncStack,
    setTelegramWebhook,
    sendTyping,
    sendTelegramMessage,
  }),
);

// ── Start server ──────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Web Dashboard is running at http://localhost:${PORT}`);
  console.log(`To access from other devices in the local network: http://<pi-ip-address>:${PORT}`);

  // Auto-register Telegram webhook if configured
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as {
      telegram_token?: string;
      telegram_webhook_url?: string;
      telegram_chat_id?: string | number;
    };
    if (config.telegram_token && !config.telegram_token.includes("YOUR_TELEGRAM") && config.telegram_webhook_url) {
      await setTelegramWebhook(config.telegram_token, config.telegram_webhook_url);
    }
  } catch (_) {}

  // Auto-start monitor if it was running before restart
  const prevState = loadMonitorState();
  if (prevState.running) {
    console.log("Previous state was running — auto-starting monitor...");
    state.monitorProcess = spawn("node", [MONITOR_PATH], { cwd: PROJECT_ROOT });
    state.monitorProcess.stdout!.on("data", (data: Buffer) => addToLog(data.toString()));
    state.monitorProcess.stderr!.on("data", (data: Buffer) => addToLog(data.toString()));
    state.monitorProcess.on("close", (code: number | null) => {
      addToLog(`\n[Auto-restart] Monitor stopped (Exit Code: ${code})\n`);
      state.monitorProcess = null;
    });

    // Notify via Telegram after a short delay to let the bot register first
    setTimeout(async () => {
      try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as {
          telegram_token?: string;
          telegram_chat_id?: string | number;
        };
        if (cfg.telegram_token && !cfg.telegram_token.includes("YOUR_TELEGRAM")) {
          await sendTelegramMessage(cfg.telegram_token, String(cfg.telegram_chat_id), `🔄 <b>Server restarted</b> — Monitor auto-resumed.`);
        }
      } catch (_) {}
    }, 3000);
  }
});
