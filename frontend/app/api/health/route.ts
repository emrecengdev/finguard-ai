import { NextResponse } from "next/server";
import { fetchBackend } from "@/lib/server/backend";

export const runtime = "nodejs";

export async function GET() {
  try {
    const backendResponse = await fetchBackend("/health");
    return NextResponse.json(
      { ok: backendResponse.ok },
      { status: backendResponse.ok ? 200 : backendResponse.status }
    );
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
