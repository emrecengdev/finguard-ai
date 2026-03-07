import { NextRequest, NextResponse } from "next/server";
import { fetchBackend, readBackendError } from "@/lib/server/backend";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const incomingFormData = await request.formData();
    const uploadedFile = incomingFormData.get("file");

    if (!(uploadedFile instanceof File)) {
      return NextResponse.json(
        { detail: "A PDF file is required." },
        { status: 400 }
      );
    }

    const backendFormData = new FormData();
    backendFormData.append("file", uploadedFile, uploadedFile.name);

    const ocrPages = incomingFormData.get("ocr_pages");
    if (typeof ocrPages === "string" && ocrPages.trim()) {
      backendFormData.append("ocr_pages", ocrPages);
    }

    const ocrEngine = incomingFormData.get("ocr_engine");
    if (typeof ocrEngine === "string" && ocrEngine.trim()) {
      backendFormData.append("ocr_engine", ocrEngine);
    }

    const backendResponse = await fetchBackend("/upload_pdf", {
      body: backendFormData,
      method: "POST",
    });

    if (!backendResponse.ok) {
      const detail = await readBackendError(backendResponse, "Upload failed.");
      return NextResponse.json({ detail }, { status: backendResponse.status });
    }

    const payload = await backendResponse.json();
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Upload proxy failed:", error);
    return NextResponse.json(
      { detail: "Upload service is currently unavailable." },
      { status: 500 }
    );
  }
}
