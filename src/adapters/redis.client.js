// src/adapters/redis.client.js
import Redis from "ioredis";
import { error, log, warn } from "../utils/logger.js";

let singleton = {
    mode: null,
    client: null,
    pub: null,
    sub: null,
};

function parseClusterNodes(env = ""){
    return env
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .map(pair => {
            const [host, portStr] = pair.split(":");
            return { host, port: Number(portStr || 6379) };
        });
}

function buildCommonOptions() {
    const useTLS = String(process.env.REDIS_TLS || "false").toLowerCase() === "true";
    return useTLS ? { tls: {} } : {};
}

export function getRedis() {
    if (singleton.client) return singleton.client;

    const clusterNodes = parseClusterNodes(process.env.REDIS_CLUSTER_NODES || "");
    const common = buildCommonOptions();

    if (clusterNodes.length > 0) {
        singleton.mode = "cluster";
        singleton.client = new Redis.Cluster(clusterNodes, {
            redisOptions: {
                ...common,
                maxRetriesPerRequest: 3,
                connectTimeout: 12_000,
                enableReadyCheck: true,
            },
            clusterRetryStrategy: (times) => Math.min(1000 * times, 10_000),
        });
    } else {
        singleton.mode = "single";
        const url = process.env.REDIS_URL;
        if (!url) {
            throw new Error("REDIS_URL is not set (and REDIS_CLUSTER_NODE is empty).");
        }
        singleton.client = new Redis(url, {
            ...common,
            maxRetriesPerRequest: 3,
            connectTimeout: 12_000,
            enableReadyCheck: true,
            retryStrategy(times) {
                return Math.min(1000 * times, 10_000);
            },
        });
    }

    singleton.client.on("connect", () => {
        log(`[redis] ${singleton.mode} connected`);
    });
    singleton.client.on("error", (err) => {
        error("[redis] error", err.message);
    });
    singleton.client.on("end", () => {
        warn("[redis] connection ended");
    });

    return singleton.client;

}

export function getRedisPubSub() {
    if (singleton.pub && singleton.sub) return { pub: singleton.pub, sub: singleton.sub };

    const clusterNodes = parseClusterNodes(process.env.REDIS_CLUSTER_NODES || "");
    const common = buildCommonOptions();

    if (clusterNodes.length > 0) {
        singleton.pug = new Redis.Cluster(clusterNodes, { redisOptions: { ...common } });
        singleton.sub = new Redis.Cluster(clusterNodes, { redisOptions: { ...common } });
    } else {
        const url = process.env.REDIS_URL;
        if (!url) throw new Error("REDIS_URL is not set for pub/sub. ");
        singleton.pub = new Redis(url, { ...common });
        singleton.sub = new Redis(url, { ...common });
    }

    const tag = singleton.mode || (clusterNodes.length ? "cluster" : "single");
    singleton.pub.on("error", (e) => error(`[redis-pub:${tag}]`, e.message));
    singleton.sub.on("error", (e) => error(`[redis-sub:${tag}]`, e.message));

    return { pub: singleton.pub, sub: singleton.sub };
}

export async function closeRedis() {
    const tasks = [];
    if (singleton.sub) tasks.push(singleton.sub.quit().catch(() => singleton.sub.disconnect()));
    if (singleton.pub) tasks.push(singleton.pub.quit().catch(() => singleton.pub.disconnect()));
    if (singleton.client) tasks.push(singleton.client.quit().catch(() => singleton.client.disconnect()));
    try {
        await Promise.all(tasks);
    } catch { }
}