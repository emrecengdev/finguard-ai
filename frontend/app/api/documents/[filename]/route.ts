import { NextRequest, NextResponse } from "next/server";
import { fetchBackend, readBackendError } from "@/lib/server/backend";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ filename: string }>;
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { filename } = await context.params;

  try {
    const backendResponse = await fetchBackend(
      `/documents/${encodeURIComponent(filename)}`,
      { method: "DELETE" }
    );

    if (!backendResponse.ok) {
      const detail = await readBackendError(
        backendResponse,
        "Failed to delete the requested document."
      );
      return NextResponse.json({ detail }, { status: backendResponse.status });
    }

    const payload = await backendResponse.json();
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Delete document proxy failed:", error);
    return NextResponse.json(
      { detail: "Document deletion is currently unavailable." },
      { status: 500 }
    );
  }
}
