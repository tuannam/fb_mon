import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { AppState } from "./utils";
import { setTelegramWebhook, sendTyping, sendTelegramMessage } from "./telegram";

interface Config {
  keywords?: string[];
  location_id?: string;
  max_price?: number;
  check_interval_min?: number;
  telegram_token?: string;
  telegram_chat_id?: string | number;
  telegram_webhook_url?: string;
  user_data_dir?: string;
  [key: string]: unknown;
}

interface StatusFile {
  nextScanAt?: number;
}

export interface HandlerContext {
  CONFIG_PATH: string;
  MONITOR_PATH: string;
  PROJECT_ROOT: string;
  STATUS_PATH: string;
  USE_XVFB: boolean;
  sleep: (ms: number) => Promise<void>;
  state: AppState;
  logBuffer: string[];
  addToLog: (text: string) => void;
  saveMonitorState: (running: boolean) => void;
  stopVncStack: () => void;
  setTelegramWebhook: typeof setTelegramWebhook;
  sendTyping: typeof sendTyping;
  sendTelegramMessage: typeof sendTelegramMessage;
}

export function createHandlers(ctx: HandlerContext) {
  const {
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
  } = ctx;

  // ── Config ──────────────────────────────────────────────────────────────────

  function getConfig(req: Request, res: Response): void {
    if (!fs.existsSync(CONFIG_PATH)) {
      res.status(404).json({ error: "Config file not found" });
      return;
    }
    try {
      const data = fs.readFileSync(CONFIG_PATH, "utf-8");
      res.json(JSON.parse(data));
    } catch (e) {
      res.status(500).json({ error: `Failed to read config: ${(e as Error).message}` });
    }
  }

  async function updateConfig(req: Request, res: Response): Promise<void> {
    try {
      const newConfig = req.body as Config;
      if (!newConfig.keywords || !Array.isArray(newConfig.keywords)) {
        res.status(400).json({ error: "Keywords must be an array" });
        return;
      }

      let currentConfig: Config = {};
      if (fs.existsSync(CONFIG_PATH)) {
        currentConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Config;
      }

      const mergedConfig: Config = { ...currentConfig, ...newConfig };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(mergedConfig, null, 2), "utf-8");
      addToLog(
        `[${new Date().toLocaleString("sv-SE", { timeZone: process.env.TZ || "Australia/Melbourne", hour12: false }).substring(0, 19)}] Configuration updated via Web UI.\n`,
      );

      if (mergedConfig.telegram_token && !mergedConfig.telegram_token.includes("YOUR_TELEGRAM")) {
        await setTelegramWebhook(mergedConfig.telegram_token, mergedConfig.telegram_webhook_url || "");
      }

      res.json({ success: true, config: mergedConfig });
    } catch (e) {
      res.status(500).json({ error: `Failed to save config: ${(e as Error).message}` });
    }
  }

  // ── Logs & Status ────────────────────────────────────────────────────────────

  function getLogs(req: Request, res: Response): void {
    res.json({ logs: logBuffer });
  }

  function getStatus(req: Request, res: Response): void {
    res.json({
      running: state.monitorProcess !== null,
      pid: state.monitorProcess ? state.monitorProcess.pid : null,
    });
  }

  // ── Monitor Control ──────────────────────────────────────────────────────────

  function startMonitor(req: Request, res: Response): void {
    if (state.monitorProcess) {
      res.status(400).json({ error: "Monitor is already running" });
      return;
    }

    const timestamp = new Date().toLocaleString();
    addToLog(`\n[${timestamp}] --- Launching Monitor Process via Web UI ---\n`);

    state.monitorProcess = spawn("node", [MONITOR_PATH], { cwd: PROJECT_ROOT });
    state.monitorProcess.stdout!.on("data", (data: Buffer) => addToLog(data.toString()));
    state.monitorProcess.stderr!.on("data", (data: Buffer) => addToLog(data.toString()));
    state.monitorProcess.on("close", (code: number | null) => {
      const exitTimestamp = new Date().toLocaleString();
      addToLog(`\n[${exitTimestamp}] --- Monitor Process stopped (Exit Code: ${code}) ---\n`);
      state.monitorProcess = null;
    });

    saveMonitorState(true);
    res.json({ success: true, running: true });
  }

  function stopMonitor(req: Request, res: Response): void {
    if (!state.monitorProcess) {
      res.status(400).json({ error: "Monitor is not running" });
      return;
    }

    const timestamp = new Date().toLocaleString();
    addToLog(`\n[${timestamp}] --- Terminating Monitor Process via Web UI ---\n`);

    state.monitorProcess.kill("SIGINT");
    state.monitorProcess = null;

    saveMonitorState(false);
    res.json({ success: true, running: false });
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  function testTelegram(req: Request, res: Response): void {
    const timestamp = new Date().toLocaleString();
    addToLog(`\n[${timestamp}] --- Initiating Telegram Connection Test ---\n`);

    const proc = spawn("node", [MONITOR_PATH, "--test-telegram"], { cwd: PROJECT_ROOT });
    let output = "";
    proc.stdout.on("data", (data: Buffer) => {
      output += data.toString();
      addToLog(data.toString());
    });
    proc.stderr.on("data", (data: Buffer) => {
      output += data.toString();
      addToLog(data.toString());
    });
    proc.on("close", (code: number | null) => res.json({ success: code === 0, output }));
  }

  function dryRun(req: Request, res: Response): void {
    const timestamp = new Date().toLocaleString();
    addToLog(`\n[${timestamp}] --- Running Manual Scraper Dry-Run ---\n`);

    const proc = spawn("node", [MONITOR_PATH, "--dry-run"], { cwd: PROJECT_ROOT });
    let output = "";
    proc.stdout.on("data", (data: Buffer) => {
      output += data.toString();
      addToLog(data.toString());
    });
    proc.stderr.on("data", (data: Buffer) => {
      output += data.toString();
      addToLog(data.toString());
    });
    proc.on("close", (code: number | null) => res.json({ success: code === 0, output }));
  }

  // ── Login ────────────────────────────────────────────────────────────────────

  function getLoginStatus(req: Request, res: Response): void {
    res.json({
      status: state.loginStatus,
      active: state.loginProcess !== null,
      vncAvailable: USE_XVFB && state.loginProcess !== null,
    });
  }

  async function startLogin(req: Request, res: Response): Promise<void> {
    if (state.loginProcess) {
      try {
        state.loginProcess.kill("SIGTERM");
      } catch (_) {}
      state.loginProcess = null;
    }
    stopVncStack();

    state.loginStatus = "waiting";
    const timestamp = new Date().toLocaleString();
    addToLog(`\n[${timestamp}] --- Opening Facebook Login Browser via Web UI ---\n`);

    const spawnEnv: NodeJS.ProcessEnv = { ...process.env };

    if (USE_XVFB) {
      addToLog("[System] Starting virtual display (Xvfb)...\n");
      state.xvfbProcess = spawn("Xvfb", [":99", "-screen", "0", "1280x800x24"], { stdio: "ignore" });
      await sleep(1000);

      state.vncProcess = spawn("x11vnc", ["-display", ":99", "-nopw", "-listen", "localhost", "-forever", "-shared", "-quiet"], { stdio: "ignore" });
      await sleep(600);

      const novncPaths = ["/usr/share/novnc", "/usr/share/novnc/utils"];
      const novncWeb = novncPaths.find((p) => fs.existsSync(p)) || "/usr/share/novnc";
      state.novncProcess = spawn("websockify", ["--web", novncWeb, "6080", "localhost:5900"], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      await sleep(400);

      spawnEnv.DISPLAY = ":99";
      addToLog("[System] VNC viewer ready — open http://<server-ip>:6080/vnc.html in your browser to see the login window.\n");
    }

    state.loginProcess = spawn("node", [MONITOR_PATH, "--login"], {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: spawnEnv,
    });
    state.loginProcess.stdout!.on("data", (data: Buffer) => addToLog(data.toString()));
    state.loginProcess.stderr!.on("data", (data: Buffer) => addToLog(data.toString()));
    state.loginProcess.on("close", (code: number | null) => {
      const exitTimestamp = new Date().toLocaleString();
      addToLog(`\n[${exitTimestamp}] --- Login process ended (Exit Code: ${code}) ---\n`);
      state.loginProcess = null;
      stopVncStack();
      if (code === 0) {
        state.loginStatus = "done";
      } else {
        state.loginStatus = "error";
        setTimeout(() => {
          state.loginStatus = "idle";
        }, 10000);
      }
    });

    res.json({ success: true, status: "waiting", vncAvailable: USE_XVFB });
  }

  function confirmLogin(req: Request, res: Response): void {
    if (!state.loginProcess) {
      res.status(400).json({ error: "No active login session" });
      return;
    }

    const timestamp = new Date().toLocaleString();
    addToLog(`\n[${timestamp}] --- User confirmed login. Saving session... ---\n`);

    state.loginProcess.stdin!.write("\n");
    res.json({ success: true, message: "Login confirmation sent. Saving session..." });
  }

  function clearLoginLock(req: Request, res: Response): void {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Config;
      const userDataDir = config.user_data_dir || "./fb_profile";
      const profileDir = path.isAbsolute(userDataDir) ? userDataDir : path.resolve(PROJECT_ROOT, userDataDir);
      ["SingletonLock", "SingletonCookie", "SingletonSocket"].forEach((f) => {
        try {
          fs.unlinkSync(path.join(profileDir, f));
        } catch (_) {}
      });
      addToLog("[System] Profile lock files cleared.\n");
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  }

  // ── Telegram Webhook ─────────────────────────────────────────────────────────

  async function telegramWebhook(req: Request, res: Response): Promise<void> {
    res.sendStatus(200); // Always reply 200 fast so Telegram doesn't retry

    try {
      const update = req.body as { message?: { text?: string; chat: { id: number } } };
      const msg = update && update.message;
      if (!msg || !msg.text) return;

      let config: Config = {};
      try {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Config;
      } catch (_) {
        return;
      }

      const token = config.telegram_token!;
      const chatId = String(config.telegram_chat_id);

      // Security: only respond to the configured chat_id
      if (String(msg.chat.id) !== chatId) return;

      await sendTyping(token, chatId);
      const text = msg.text.trim();

      if (text === "/status" || text === "/s" || text.startsWith("/status@")) {
        let status: StatusFile = {};
        try {
          status = JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8")) as StatusFile;
        } catch (_) {}

        const keywords = (config.keywords || []).join(", ") || "None";
        const location = (config.location_id || "Not set").replace(/\b\w/g, (c) => c.toUpperCase());
        const maxPrice = config.max_price ? `AU$${config.max_price}` : "No limit";
        const baseMin = config.check_interval_min || 15;
        const running = state.monitorProcess !== null;

        let nextScanText = "Monitor not running";
        if (running && status.nextScanAt) {
          const diffMs = status.nextScanAt - Date.now();
          if (diffMs > 0) {
            const diffMin = Math.floor(diffMs / 60000);
            const diffSec = Math.floor((diffMs % 60000) / 1000);
            nextScanText = `${diffMin}m ${diffSec}s`;
          } else {
            nextScanText = "Scanning now...";
          }
        }

        await sendTelegramMessage(
          token,
          chatId,
          `📊 <b>Monitor Status</b>\n\n` +
            `${running ? "🟢 Running" : "🔴 Stopped"}\n\n` +
            `🔍 <b>Keywords:</b> ${keywords}\n` +
            `📍 <b>Location:</b> ${location}\n` +
            `💰 <b>Max Price:</b> ${maxPrice}\n` +
            `⏱ <b>Scan Interval:</b> ~${baseMin} min (±1–3 min jitter)\n` +
            `⏳ <b>Next scan in:</b> ${nextScanText}`,
        );
      } else if (text.startsWith("/keyword ") || text.startsWith("/k ") || text.startsWith("/keyword@")) {
        const raw = text
          .replace(/^\/(?:keyword|k)(@\S+)?\s+/, "")
          .trim()
          .replace(/^["']|["']$/g, "");

        if (!raw) {
          await sendTelegramMessage(token, chatId, `⚠️ Usage: <code>/keyword rtx 3090</code>`);
          return;
        }

        let cfg: Config = {};
        try {
          cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Config;
        } catch (_) {}
        cfg.keywords = [raw];
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
        await sendTelegramMessage(token, chatId, `✅ Keyword set to: <b>${raw}</b>`);
      } else if (text.startsWith("/maxprice ") || text.startsWith("/mp ") || text.startsWith("/maxprice@")) {
        const raw = text.replace(/^\/(?:maxprice|mp)(@\S+)?\s+/, "").trim();
        const val = parseInt(raw, 10);

        if (isNaN(val) || val < 0) {
          await sendTelegramMessage(token, chatId, `⚠️ Usage: <code>/maxprice 2000</code> (AUD, 0 = no limit)`);
          return;
        }

        let cfg: Config = {};
        try {
          cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Config;
        } catch (_) {}
        cfg.max_price = val;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
        await sendTelegramMessage(token, chatId, val === 0 ? `✅ Max price removed (no limit).` : `✅ Max price set to: <b>AU$${val}</b>`);
      } else if (text === "/start" || text.startsWith("/start@")) {
        if (state.monitorProcess) {
          await sendTelegramMessage(token, chatId, `ℹ️ Monitor is already running.`);
        } else {
          state.monitorProcess = spawn("node", [MONITOR_PATH], { cwd: PROJECT_ROOT });
          state.monitorProcess.stdout!.on("data", (data: Buffer) => addToLog(data.toString()));
          state.monitorProcess.stderr!.on("data", (data: Buffer) => addToLog(data.toString()));
          state.monitorProcess.on("close", (code: number | null) => {
            addToLog(`\n[Telegram] Monitor stopped (Exit Code: ${code})\n`);
            state.monitorProcess = null;
          });
          saveMonitorState(true);
          await sendTelegramMessage(token, chatId, `▶️ Monitor started.`);
        }
      } else if (text === "/stop" || text.startsWith("/stop@")) {
        if (!state.monitorProcess) {
          await sendTelegramMessage(token, chatId, `ℹ️ Monitor is not running.`);
        } else {
          state.monitorProcess.kill("SIGINT");
          state.monitorProcess = null;
          saveMonitorState(false);
          await sendTelegramMessage(token, chatId, `⏹ Monitor stopped.`);
        }
      } else if (text === "/help" || text === "/h" || text.startsWith("/help@")) {
        await sendTelegramMessage(
          token,
          chatId,
          `🤖 <b>Available Commands</b>\n\n` +
            `/status (or /s) — Show monitor status, keyword, next scan time\n` +
            `/start — Start the monitor\n` +
            `/stop — Stop the monitor\n` +
            `/keyword (or /k) &lt;text&gt; — Replace current keyword\n` +
            `  e.g. <code>/k rtx 4090</code>\n` +
            `/maxprice (or /mp) &lt;amount&gt; — Set max price in AUD (0 = no limit)\n` +
            `  e.g. <code>/mp 1500</code>\n` +
            `/help (or /h) — Show this message`,
        );
      }
    } catch (e) {
      console.error("Webhook handler error:", (e as Error).message);
    }
  }

  return {
    getConfig,
    updateConfig,
    getLogs,
    getStatus,
    startMonitor,
    stopMonitor,
    testTelegram,
    dryRun,
    getLoginStatus,
    startLogin,
    confirmLogin,
    clearLoginLock,
    telegramWebhook,
  };
}
