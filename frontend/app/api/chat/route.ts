import { NextRequest, NextResponse } from "next/server";
import { fetchBackend, readBackendError } from "@/lib/server/backend";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const backendResponse = await fetchBackend("/chat", {
      body: rawBody,
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!backendResponse.ok) {
      const detail = await readBackendError(backendResponse, "Chat request failed.");
      return NextResponse.json({ detail }, { status: backendResponse.status });
    }

    const payload = await backendResponse.json();
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Chat proxy failed:", error);
    return NextResponse.json(
      { detail: "Chat service is currently unavailable." },
      { status: 500 }
    );
  }
}
