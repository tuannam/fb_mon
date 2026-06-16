import express from "express";
import { createHandlers, HandlerContext } from "./handlers";

export function createRouter(ctx: HandlerContext): express.Router {
  const router = express.Router();
  const h = createHandlers(ctx);

  // ── Config ──────────────────────────────────────────────────────────────────
  router.get("/api/config", h.getConfig);
  router.post("/api/config", h.updateConfig);

  // ── Logs & Status ────────────────────────────────────────────────────────────
  router.get("/api/logs", h.getLogs);
  router.get("/api/status", h.getStatus);

  // ── Monitor Control ──────────────────────────────────────────────────────────
  router.post("/api/start", h.startMonitor);
  router.post("/api/stop", h.stopMonitor);

  // ── Actions ──────────────────────────────────────────────────────────────────
  router.post("/api/test-telegram", h.testTelegram);
  router.post("/api/dry-run", h.dryRun);

  // ── Login ────────────────────────────────────────────────────────────────────
  router.get("/api/login/status", h.getLoginStatus);
  router.post("/api/login/start", h.startLogin);
  router.post("/api/login/confirm", h.confirmLogin);
  router.post("/api/login/clear-lock", h.clearLoginLock);

  // ── Telegram Webhook ─────────────────────────────────────────────────────────
  router.post("/telegram-webhook", express.json(), h.telegramWebhook);

  return router;
}
