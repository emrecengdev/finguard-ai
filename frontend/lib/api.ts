/**
 * FinGuard AI — API Client
 * Handles communication with the FastAPI backend via Next.js JWT Handshake.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
}

export interface OcrPagePayload {
    page: number;
    text: string;
}

export interface UploadPdfOptions {
    ocrPages?: OcrPagePayload[];
    ocrEngine?: string;
}

// ─── Auth Helper ────────────────────────────────────────────────────

async function getAuthToken(): Promise<string> {
    try {
        const res = await fetch("/api/auth/token");
        if (!res.ok) throw new Error("Failed to fetch token");
        const data = await res.json();
        return data.token;
    } catch (e) {
        console.error("JWT Handshake error:", e);
        return "";
    }
}

// ─── API Functions ──────────────────────────────────────────────────

export async function sendMessage(message: string, sessionId: string = "default"): Promise<ChatResponse> {
    const token = await getAuthToken();
    const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ message, session_id: sessionId }),
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
    onStep: (step: AgentStep) => void,
    onResponse: (data: { response: string; guardrail_passed: boolean; sources: ChatSource[] }) => void,
    onError: (error: string) => void,
): Promise<void> {
    const token = await getAuthToken();
    const res = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ message, session_id: sessionId }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `Stream request failed (${res.status})`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (line.startsWith("event: ")) {
                continue;
            }
            if (line.startsWith("data: ")) {
                const data = line.slice(6);
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.node) {
                        onStep(parsed as AgentStep);
                    } else if (parsed.response !== undefined) {
                        onResponse(parsed);
                    } else if (parsed.detail) {
                        onError(parsed.detail);
                    }
                } catch {
                    // skip malformed data
                }
            }
        }
    }
}

export async function uploadPdf(file: File, options: UploadPdfOptions = {}): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append("file", file);
    if (options.ocrPages && options.ocrPages.length > 0) {
        formData.append("ocr_pages", JSON.stringify(options.ocrPages));
        formData.append("ocr_engine", options.ocrEngine || "unknown");
    }

    const token = await getAuthToken();
    const res = await fetch(`${API_BASE}/upload_pdf`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`
        },
        body: formData,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `Upload failed (${res.status})`);
    }

    return res.json();
}

export async function getDocuments(): Promise<DocumentInfo[]> {
    const token = await getAuthToken();
    const res = await fetch(`${API_BASE}/documents`, {
        headers: { "Authorization": `Bearer ${token}` }
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `Failed to fetch documents (${res.status})`);
    }

    return res.json();
}

export async function deleteDocument(filename: string): Promise<void> {
    const token = await getAuthToken();
    const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(filename)}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `Delete failed (${res.status})`);
    }
}

export async function healthCheck(): Promise<boolean> {
    try {
        const token = await getAuthToken();
        const res = await fetch(`${API_BASE}/health`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        return res.ok;
    } catch {
        return false;
    }
}
