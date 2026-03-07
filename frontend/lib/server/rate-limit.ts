import type { NextRequest } from "next/server";

interface BucketState {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  bucket: string;
  limit: number;
  request: NextRequest;
  windowMs: number;
}

declare global {
  var __finguardRateLimitBuckets: Map<string, BucketState> | undefined;
}

const buckets = globalThis.__finguardRateLimitBuckets ?? new Map<string, BucketState>();

if (!globalThis.__finguardRateLimitBuckets) {
  globalThis.__finguardRateLimitBuckets = buckets;
}

export function getClientAddress(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}

export function enforceSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

export function takeRateLimit({
  bucket,
  limit,
  request,
  windowMs,
}: RateLimitOptions) {
  const now = Date.now();
  const key = `${bucket}:${getClientAddress(request)}`;
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    const nextState: BucketState = { count: 1, resetAt: now + windowMs };
    buckets.set(key, nextState);
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt: nextState.resetAt,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  buckets.set(key, current);

  return {
    allowed: true,
    remaining: Math.max(0, limit - current.count),
    resetAt: current.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}
