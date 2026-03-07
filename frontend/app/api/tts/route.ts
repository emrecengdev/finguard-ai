import { NextRequest, NextResponse } from "next/server";
import { enforceSameOrigin, takeRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    if (!enforceSameOrigin(req)) {
        return NextResponse.json(
            { error: "Cross-origin TTS requests are not allowed" },
            { status: 403 }
        );
    }

    const rateLimit = takeRateLimit({
        bucket: "tts",
        limit: 6,
        request: req,
        windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Too many TTS requests. Please wait before trying again." },
            {
                status: 429,
                headers: {
                    "Retry-After": String(rateLimit.retryAfterSeconds),
                    "X-RateLimit-Remaining": "0",
                },
            }
        );
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;

    if (!apiKey || !voiceId) {
        return NextResponse.json(
            { error: "ElevenLabs configuration is incomplete" },
            { status: 500 }
        );
    }

    try {
        const { text } = await req.json();

        if (!text || typeof text !== "string") {
            return NextResponse.json({ error: "Text is required" }, { status: 400 });
        }

        // Limit text to 2500 chars (ElevenLabs free tier limit per request)
        const trimmedText = text.slice(0, 2500);

        const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "xi-api-key": apiKey,
                },
                body: JSON.stringify({
                    text: trimmedText,
                    model_id: "eleven_flash_v2_5",
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75,
                        style: 0.4,
                        use_speaker_boost: true,
                    },
                }),
            }
        );

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("ElevenLabs error:", response.status, errorBody);
            return NextResponse.json(
                { error: `ElevenLabs API error: ${response.status}` },
                { status: response.status }
            );
        }

        const audioBuffer = await response.arrayBuffer();

        return new NextResponse(audioBuffer, {
            status: 200,
            headers: {
                "Content-Type": "audio/mpeg",
                "Cache-Control": "no-store",
                "X-RateLimit-Remaining": String(rateLimit.remaining),
            },
        });
    } catch (error) {
        console.error("TTS error:", error);
        return NextResponse.json({ error: "TTS generation failed" }, { status: 500 });
    }
}
