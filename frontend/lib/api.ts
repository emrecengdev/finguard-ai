/**
 * FinGuard AI — API Client
 * Handles communication with the FastAPI backend via Next.js JWT Handshake.
 */

import type { Locale } from "@/lib/i18n";

// ─── Types ──────────────────────────────────────────────────────────

export interface AgentStep {
    node: string;
    status: "analyzing" | "searching" | "executing" | "composing" | "checking" | "complete" | "error" | "flagged" | "skipped";
    detail: string;
}

export interface ChatSource {
    source: string;
    page: number;
    rerank_score: number;
}

export interface ChatResponse {
    response: string;
    agent_steps: AgentStep[];
    guardrail_passed: boolean;
    sources: ChatSource[];
}

export interface DocumentInfo {
    filename: string;
    pages: number;
    chunks: number;
}

export interface UploadResponse {
    filename: string;
    pages: number;
    chunks: number;
    extraction_mode: string;
    ocr_engine: string;
    status: string;
    bm25_mode?: string;
    embedding_requests?: number;
    timings_ms?: Record<string, number>;
}

export interface OcrPagePayload {
    page: number;
    text: string;
}

export interface UploadPdfOptions {
    ocrPages?: OcrPagePayload[];
    ocrEngine?: string;
}

interface UploadSessionResponse {
    uploadUrl: string;
    token: string;
    expiresInSeconds: number;
}

interface ChatRequestPayload {
    message: string;
    session_id: string;
    locale: Locale;
}

interface StreamHandlers {
    onError: (error: string) => void;
    onResponse: (data: { response: string; guardrail_passed: boolean; sources: ChatSource[] }) => void;
    onStep: (step: AgentStep) => void;
}

function handleStreamPayload(
    eventName: string,
    payload: string,
    handlers: StreamHandlers
) {
    if (!payload) return;

    try {
        const parsed = JSON.parse(payload);
        if (eventName === "agent_step" || parsed.node) {
            handlers.onStep(parsed as AgentStep);
            return;
        }

        if (eventName === "response" || parsed.response !== undefined) {
            handlers.onResponse(parsed);
            return;
        }

        if (eventName === "error" || parsed.detail) {
            handlers.onError(parsed.detail || "Unknown stream error");
        }
    } catch {
        if (eventName === "error") {
            handlers.onError(payload);
        }
    }
}

// ─── API Functions ──────────────────────────────────────────────────

export async function sendMessage(
    message: string,
    sessionId: string = "default",
    locale: Locale = "tr",
): Promise<ChatResponse> {
    const payload: ChatRequestPayload = { message, session_id: sessionId, locale };
    const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `Chat request failed (${res.status})`);
    }

    return res.json();
}

export async function streamMessage(
    message: string,
    sessionId: string = "default",
    locale: Locale = "tr",
    onStep: (step: AgentStep) => void,
    onResponse: (data: { response: string; guardrail_passed: boolean; sources: ChatSource[] }) => void,
    onError: (error: string) => void,
): Promise<void> {
    const payload: ChatRequestPayload = { message, session_id: sessionId, locale };
    const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `Stream request failed (${res.status})`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let pendingEvent = "message";
    let pendingData: string[] = [];

    const flushEvent = () => {
        if (pendingData.length === 0) {
            pendingEvent = "message";
            return;
        }

        handleStreamPayload(
            pendingEvent,
            pendingData.join("\n"),
            { onError, onResponse, onStep }
        );
        pendingEvent = "message";
        pendingData = [];
    };

    const processLine = (rawLine: string) => {
        const line = rawLine.replace(/\r$/, "");
        if (line === "") {
            flushEvent();
            return;
        }

        if (line.startsWith("event:")) {
            pendingEvent = line.slice(6).trim();
            return;
        }

        if (line.startsWith("data:")) {
            pendingData.push(line.slice(5).trimStart());
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            processLine(line);
        }
    }

    if (buffer) {
        processLine(buffer);
    }

    flushEvent();
}

export async function uploadPdf(file: File, options: UploadPdfOptions = {}): Promise<UploadResponse> {
    const buildFormData = () => {
        const formData = new FormData();
        formData.append("file", file);
        if (options.ocrPages && options.ocrPages.length > 0) {
            formData.append("ocr_pages", JSON.stringify(options.ocrPages));
            formData.append("ocr_engine", options.ocrEngine || "unknown");
        }
        return formData;
    };

    const tryDirectUpload = async (): Promise<UploadResponse> => {
        const sessionRes = await fetch("/api/upload/session", {
            method: "POST",
        });

        if (!sessionRes.ok) {
            throw new TypeError("Direct upload session unavailable");
        }

        const session = (await sessionRes.json()) as UploadSessionResponse;
        const directRes = await fetch(session.uploadUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${session.token}`,
            },
            body: buildFormData(),
        });

        if (!directRes.ok) {
            const err = await directRes.json().catch(() => ({ detail: "Unknown error" }));
            throw new Error(err.detail || `Upload failed (${directRes.status})`);
        }

        return directRes.json();
    };

    try {
        return await tryDirectUpload();
    } catch (error) {
        if (!(error instanceof TypeError)) {
            throw error;
        }
        console.warn("Direct upload failed, falling back to proxy route:", error);
    }

    const res = await fetch("/api/upload", {
        method: "POST",
        body: buildFormData(),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `Upload failed (${res.status})`);
    }

    return res.json();
}

export async function getDocuments(): Promise<DocumentInfo[]> {
    const res = await fetch("/api/documents");

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `Failed to fetch documents (${res.status})`);
    }

    return res.json();
}

export async function deleteDocument(filename: string): Promise<void> {
    const res = await fetch(`/api/documents/${encodeURIComponent(filename)}`, {
        method: "DELETE",
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `Delete failed (${res.status})`);
    }
}

export async function healthCheck(): Promise<boolean> {
    try {
        const res = await fetch("/api/health");
        if (!res.ok) {
            return false;
        }

        const data = await res.json().catch(() => ({ ok: false }));
        return Boolean(data.ok);
    } catch {
        return false;
    }
}
