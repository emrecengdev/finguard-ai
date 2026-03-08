import { NextResponse } from "next/server";
import { createBackendAuthToken, getPublicBackendApiUrl } from "@/lib/server/backend";

export const runtime = "nodejs";

export async function POST() {
  try {
    const token = await createBackendAuthToken({
      sub: "finguard-upload",
      scope: "upload",
      expiresIn: "90s",
    });

    return NextResponse.json(
      {
        uploadUrl: getPublicBackendApiUrl("/upload_pdf"),
        token,
        expiresInSeconds: 90,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Upload session creation failed:", error);
    return NextResponse.json(
      { detail: "Upload session is currently unavailable." },
      { status: 500 },
    );
  }
}
