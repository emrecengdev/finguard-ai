import { NextRequest, NextResponse } from "next/server";
import { fetchBackend, readBackendError } from "@/lib/server/backend";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const backendResponse = await fetchBackend("/chat/stream", {
      body: rawBody,
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!backendResponse.ok || !backendResponse.body) {
      const detail = await readBackendError(
        backendResponse,
        "Streaming chat request failed."
      );
      return NextResponse.json({ detail }, { status: backendResponse.status || 500 });
    }

    const responseHeaders = new Headers();
    responseHeaders.set(
      "Content-Type",
      backendResponse.headers.get("content-type") ?? "text/event-stream; charset=utf-8"
    );
    responseHeaders.set("Cache-Control", "no-cache, no-transform");
    responseHeaders.set("Connection", "keep-alive");

    return new NextResponse(backendResponse.body, {
      headers: responseHeaders,
      status: backendResponse.status,
    });
  } catch (error) {
    console.error("Chat stream proxy failed:", error);
    return NextResponse.json(
      { detail: "Streaming chat service is currently unavailable." },
      { status: 500 }
    );
  }
}
