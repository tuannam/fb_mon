import fs from "fs";
import path from "path";
import { ChildProcess } from "child_process";

export interface AppState {
  monitorProcess: ChildProcess | null;
  loginProcess: ChildProcess | null;
  xvfbProcess: ChildProcess | null;
  vncProcess: ChildProcess | null;
  novncProcess: ChildProcess | null;
  loginStatus: "idle" | "waiting" | "done" | "error";
}

interface UtilsContext {
  MONITOR_STATE_PATH: string;
  CONFIG_PATH: string;
  PROJECT_ROOT: string;
  LOG_FILE: string;
  state: AppState;
}

export interface Utils {
  saveMonitorState: (running: boolean) => void;
  loadMonitorState: () => { running: boolean };
  stopVncStack: () => void;
  detectSavedSession: () => boolean;
  logBuffer: string[];
  addToLog: (text: string) => void;
}

/**
 * Creates state-aware utility functions bound to the given paths and state object.
 * Also initialises the in-memory log buffer from disk.
 */
export function createUtils({ MONITOR_STATE_PATH, CONFIG_PATH, PROJECT_ROOT, LOG_FILE, state }: UtilsContext): Utils {
  // ── Monitor State ───────────────────────────────────────────────────────────

  function saveMonitorState(running: boolean): void {
    try {
      fs.writeFileSync(MONITOR_STATE_PATH, JSON.stringify({ running }), "utf-8");
    } catch (_) {}
  }

  function loadMonitorState(): { running: boolean } {
    try {
      return JSON.parse(fs.readFileSync(MONITOR_STATE_PATH, "utf-8")) as { running: boolean };
    } catch (_) {
      return { running: false };
    }
  }

  // ── VNC Stack ───────────────────────────────────────────────────────────────

  function stopVncStack(): void {
    [state.novncProcess, state.vncProcess, state.xvfbProcess].forEach((p) => {
      if (p) {
        try {
          p.kill("SIGTERM");
        } catch (_) {}
      }
    });
    state.xvfbProcess = null;
    state.vncProcess = null;
    state.novncProcess = null;
  }

  // ── Session Detection ───────────────────────────────────────────────────────

  function detectSavedSession(): boolean {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as { user_data_dir?: string };
      const userDataDir = config.user_data_dir || "./fb_profile";
      const profileDir = path.isAbsolute(userDataDir) ? userDataDir : path.resolve(PROJECT_ROOT, userDataDir);
      // Playwright saves a 'Default/Cookies' file inside the profile when logged in
      return fs.existsSync(path.join(profileDir, "Default", "Cookies"));
    } catch (_) {
      return false;
    }
  }

  // ── Log Buffer ──────────────────────────────────────────────────────────────

  const logBuffer: string[] = [];

  // Pre-populate with the last 200 lines from disk
  if (fs.existsSync(LOG_FILE)) {
    try {
      const lines = fs.readFileSync(LOG_FILE, "utf-8").split("\n");
      logBuffer.push(...lines.slice(-200).map((l) => l + "\n"));
    } catch (e) {
      console.error("Error reading log file on startup:", e);
    }
  }

  function addToLog(text: string): void {
    logBuffer.push(text);
    if (logBuffer.length > 500) logBuffer.shift();
    try {
      fs.appendFileSync(LOG_FILE, text);
    } catch (e) {
      console.error("Error writing log file:", e);
    }
  }

  return { saveMonitorState, loadMonitorState, stopVncStack, detectSavedSession, logBuffer, addToLog };
}
