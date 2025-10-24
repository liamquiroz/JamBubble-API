// src/realtime/presence/job/presence.sweeper.js
import { sweepPresence } from "../../presence/presence.service.js";

let intervalHandle = null;

export function startPresenceSweeper() {
  if (intervalHandle) return;
  // Run every 60s
  intervalHandle = setInterval(() => {
    sweepPresence(console).catch((e) => console.error("[presence] sweeper error:", e.message));
  }, 60_000);
  console.log("[presence] sweeper started (60s)");
}

export function stopPresenceSweeper() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
