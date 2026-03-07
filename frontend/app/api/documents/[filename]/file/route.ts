import { NextRequest, NextResponse } from "next/server";
import { fetchBackend, readBackendError } from "@/lib/server/backend";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ filename: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { filename } = await context.params;

  try {
    const backendResponse = await fetchBackend(
      `/documents/${encodeURIComponent(filename)}/file`,
      { method: "GET" },
    );

    if (!backendResponse.ok) {
      const detail = await readBackendError(
        backendResponse,
        "Failed to load the requested PDF document.",
      );
      return NextResponse.json({ detail }, { status: backendResponse.status });
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      backendResponse.headers.get("Content-Type") ?? "application/pdf",
    );

    const contentDisposition = backendResponse.headers.get("Content-Disposition");
    if (contentDisposition) {
      headers.set("Content-Disposition", contentDisposition);
    }

    const contentLength = backendResponse.headers.get("Content-Length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    headers.set("Cache-Control", "no-store");

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      headers,
    });
  } catch (error) {
    console.error("Document file proxy failed:", error);
    return NextResponse.json(
      { detail: "Document preview is currently unavailable." },
      { status: 500 },
    );
  }
}
