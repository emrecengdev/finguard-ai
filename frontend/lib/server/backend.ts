import { SignJWT } from "jose";

const encoder = new TextEncoder();

function requireServerEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }

  return value;
}

export function getBackendApiBaseUrl(): string {
  const configuredBaseUrl =
    process.env.BACKEND_API_URL ?? process.env.NEXT_PUBLIC_API_URL;

  if (!configuredBaseUrl) {
    throw new Error(
      "Missing required server environment variable: BACKEND_API_URL or NEXT_PUBLIC_API_URL"
    );
  }

  return configuredBaseUrl.replace(/\/+$/, "");
}

export function getBackendApiUrl(pathname: string): string {
  return `${getBackendApiBaseUrl()}${pathname}`;
}

export function getPublicBackendApiBaseUrl(): string {
  const configuredBaseUrl =
    process.env.NEXT_PUBLIC_API_URL ?? process.env.BACKEND_API_URL;

  if (!configuredBaseUrl) {
    throw new Error(
      "Missing required server environment variable: NEXT_PUBLIC_API_URL or BACKEND_API_URL"
    );
  }

  return configuredBaseUrl.replace(/\/+$/, "");
}

export function getPublicBackendApiUrl(pathname: string): string {
  return `${getPublicBackendApiBaseUrl()}${pathname}`;
}

interface CreateBackendTokenOptions {
  expiresIn?: string;
  scope?: string;
  sub?: string;
}

export async function createBackendAuthToken(
  options: CreateBackendTokenOptions = {},
): Promise<string> {
  const secret = requireServerEnv("API_JWT_SECRET");
  const issuer = requireServerEnv("API_JWT_ISSUER");
  const audience = requireServerEnv("API_JWT_AUDIENCE");
  const subject = options.sub?.trim() || "finguard-frontend";
  const expiresIn = options.expiresIn?.trim() || "60s";

  const payload: Record<string, string> = { sub: subject };
  if (options.scope?.trim()) {
    payload.scope = options.scope.trim();
  }

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(encoder.encode(secret));
}

export async function fetchBackend(
  pathname: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await createBackendAuthToken()}`);

  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(getBackendApiUrl(pathname), {
    ...init,
    cache: "no-store",
    headers,
  });
}

export async function readBackendError(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  const rawBody = await response.text();
  if (!rawBody) {
    return fallbackMessage;
  }

  try {
    const parsed = JSON.parse(rawBody) as { detail?: string };
    return parsed.detail || fallbackMessage;
  } catch {
    return rawBody;
  }
}
