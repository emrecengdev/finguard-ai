import type { OcrPagePayload } from "@/lib/api";

interface ScribeLike {
    init: (params?: Record<string, unknown>) => Promise<void>;
    importFiles: (files: File[]) => Promise<void>;
    recognize: (options?: Record<string, unknown>) => Promise<void>;
    clear: () => Promise<void>;
    terminate: () => Promise<void>;
    data?: {
        ocr?: {
            active?: unknown[];
        };
    };
}

export interface ScribeOcrResult {
    engine: string;
    pages: OcrPagePayload[];
}

function extractPageText(page: unknown): string {
    if (!page || typeof page !== "object") return "";
    const pageWithLines = page as { lines?: unknown[] };
    const lines = Array.isArray(pageWithLines.lines) ? pageWithLines.lines : [];

    const lineTexts: string[] = [];
    for (const line of lines) {
        if (!line || typeof line !== "object") continue;
        const lineWithWords = line as { words?: unknown[] };
        const words = Array.isArray(lineWithWords.words) ? lineWithWords.words : [];

        const wordTexts: string[] = [];
        for (const word of words) {
            if (!word || typeof word !== "object") continue;
            const text = String((word as { text?: unknown }).text ?? "").trim();
            if (text) wordTexts.push(text);
        }
        if (wordTexts.length > 0) {
            lineTexts.push(wordTexts.join(" "));
        }
    }

    return lineTexts.join("\n").trim();
}

export async function extractPdfTextWithScribe(file: File): Promise<ScribeOcrResult> {
    if (typeof window === "undefined") {
        throw new Error("Scribe OCR can only run in the browser.");
    }

    // Use non-literal dynamic import to avoid Next SSR/bundler resolving Node-only branches.
    const dynamicImport = new Function("m", "return import(m)") as (
        moduleName: string
    ) => Promise<{ default: unknown }>;
    const scribeModule = await dynamicImport("scribe.js-ocr");
    const scribe = scribeModule.default as ScribeLike;

    try {
        await scribe.init({ pdf: true, ocr: true });
        await scribe.importFiles([file]);
        await scribe.recognize({ langs: ["eng", "tur"], mode: "quality" });

        const activePages = scribe.data?.ocr?.active;
        if (!Array.isArray(activePages) || activePages.length === 0) {
            throw new Error("Scribe OCR produced no pages.");
        }

        const pages: OcrPagePayload[] = activePages
            .map((page, index) => ({
                page: index + 1,
                text: extractPageText(page),
            }))
            .filter((page) => page.text.length > 0);

        if (pages.length === 0) {
            throw new Error("Scribe OCR returned empty text.");
        }

        return {
            engine: "scribe.js-ocr",
            pages,
        };
    } finally {
        try {
            await scribe.clear();
        } catch {
            // no-op
        }
        try {
            await scribe.terminate();
        } catch {
            // no-op
        }
    }
}
