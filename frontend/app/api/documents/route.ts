import { NextResponse } from "next/server";
import { fetchBackend, readBackendError } from "@/lib/server/backend";

export const runtime = "nodejs";

export async function GET() {
  try {
    const backendResponse = await fetchBackend("/documents");

    if (!backendResponse.ok) {
      const detail = await readBackendError(
        backendResponse,
        "Failed to load documents."
      );
      return NextResponse.json({ detail }, { status: backendResponse.status });
    }

    const payload = await backendResponse.json();
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Documents proxy failed:", error);
    return NextResponse.json(
      { detail: "Document service is currently unavailable." },
      { status: 500 }
    );
  }
}
