// src/controllers/jsonRegistryController.js
// GET /api/json/:name → fetches and returns parsed JSON by name from registry.

import registry from "../registry/jsonFiles.js";
import { URL } from "url";

// Node 18+ has global fetch and AbortController
const AbortController = globalThis.AbortController;

function isCloudinaryHttpsUrl(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && host.includes("res.cloudinary.com");
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, { timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    return res;
  } finally {
    clearTimeout(id);
  }
}

export async function getByName(req, res) {
  try {
    const name = String(req.params.name || "").trim();
    const url = registry[name];

    if (!name || !url) {
      return res.status(404).json({ message: "Unknown JSON name" });
    }
    if (!isCloudinaryHttpsUrl(url)) {
      return res.status(422).json({ message: "Registry URL must be an HTTPS Cloudinary URL" });
    }

    const response = await fetchWithTimeout(url, { timeoutMs: 8000 });
    if (!response.ok) {
      return res
        .status(502)
        .json({ message: `Upstream fetch failed with status ${response.status}` });
    }

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({ message: "Invalid JSON from source" });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      message:
        process.env.NODE_ENV === "development"
          ? String(err)
          : "Internal server error",
    });
  }
}
