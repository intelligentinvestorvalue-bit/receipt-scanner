/**
 * Durable Vision API rate limiting.
 *
 * Prefer Upstash Redis when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 * are set (shared across all serverless instances). Falls back to /tmp with a
 * warning — that path is NOT reliable under multi-instance deploys.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export const MONTHLY_CAP = 950;
export const SCAN_WINDOW_MS = 60_000;
export const MAX_SCANS_PER_WINDOW = 20;

export type LimitResult = "ok" | "rate" | "monthly";

const TMP_DIR = "/tmp/receipt-scanner";
const COUNTER_FILE = join(TMP_DIR, "scan-counter.json");

interface ScanCounter {
  month: string;
  count: number;
  timestamps: number[];
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function hasUpstash(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

async function getRedis() {
  const { Redis } = await import("@upstash/redis");
  return Redis.fromEnv();
}

/** Check limits without incrementing. */
export async function checkScanLimits(): Promise<LimitResult> {
  if (hasUpstash()) {
    return checkUpstash();
  }
  console.warn(
    "[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set — using /tmp fallback (unreliable across instances)"
  );
  return checkTmp();
}

/** Record one successful Vision scan (increments counters). */
export async function recordSuccessfulScan(): Promise<void> {
  if (hasUpstash()) {
    await recordUpstash();
    return;
  }
  recordTmp();
}

async function checkUpstash(): Promise<LimitResult> {
  const redis = await getRedis();
  const month = currentMonth();
  const monthlyKey = `receipt-scanner:scans:${month}`;
  const windowKey = `receipt-scanner:scans:window`;

  const monthlyCount = Number((await redis.get(monthlyKey)) ?? 0);
  if (monthlyCount >= MONTHLY_CAP) return "monthly";

  const now = Date.now();
  // Prune old timestamps and count recent ones
  await redis.zremrangebyscore(windowKey, 0, now - SCAN_WINDOW_MS);
  const recent = await redis.zcard(windowKey);
  if (recent >= MAX_SCANS_PER_WINDOW) return "rate";

  return "ok";
}

async function recordUpstash(): Promise<void> {
  const redis = await getRedis();
  const month = currentMonth();
  const monthlyKey = `receipt-scanner:scans:${month}`;
  const windowKey = `receipt-scanner:scans:window`;
  const now = Date.now();
  const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

  const pipe = redis.pipeline();
  pipe.incr(monthlyKey);
  // Expire monthly key ~40 days after first use in that month
  pipe.expire(monthlyKey, 40 * 24 * 60 * 60);
  pipe.zadd(windowKey, { score: now, member });
  pipe.zremrangebyscore(windowKey, 0, now - SCAN_WINDOW_MS);
  pipe.expire(windowKey, Math.ceil(SCAN_WINDOW_MS / 1000) + 5);
  await pipe.exec();
}

function readCounter(): ScanCounter {
  try {
    return JSON.parse(readFileSync(COUNTER_FILE, "utf8")) as ScanCounter;
  } catch {
    return { month: "", count: 0, timestamps: [] };
  }
}

function writeCounter(c: ScanCounter) {
  try {
    mkdirSync(TMP_DIR, { recursive: true });
    writeFileSync(COUNTER_FILE, JSON.stringify(c));
  } catch {
    /* best effort */
  }
}

function normalizeCounter(c: ScanCounter): ScanCounter {
  const month = currentMonth();
  if (c.month !== month) {
    return { month, count: 0, timestamps: [] };
  }
  return c;
}

function checkTmp(): LimitResult {
  const nowMs = Date.now();
  const c = normalizeCounter(readCounter());

  if (c.count >= MONTHLY_CAP) return "monthly";

  c.timestamps = c.timestamps.filter((t) => t > nowMs - SCAN_WINDOW_MS);
  if (c.timestamps.length >= MAX_SCANS_PER_WINDOW) return "rate";

  writeCounter(c);
  return "ok";
}

function recordTmp(): void {
  const nowMs = Date.now();
  const c = normalizeCounter(readCounter());
  c.timestamps = c.timestamps.filter((t) => t > nowMs - SCAN_WINDOW_MS);
  c.timestamps.push(nowMs);
  c.count++;
  writeCounter(c);
}
