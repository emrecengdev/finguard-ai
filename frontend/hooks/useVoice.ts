"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseVoiceReturn {
    /** Whether TTS audio is currently playing */
    isSpeaking: boolean;
    /** The message ID currently being spoken */
    speakingMsgId: string | null;
    /** Whether STT is actively listening */
    isListening: boolean;
    /** Whether the browser can do speech recognition */
    canListen: boolean;
    /** Speak a text aloud via ElevenLabs TTS */
    speakText: (text: string, msgId: string) => Promise<void>;
    /** Stop current TTS playback */
    stopSpeaking: () => void;
    /** Start STT listening (Web Speech API) */
    startListening: (onTranscript: (text: string) => void) => void;
    /** Stop STT listening */
    stopListening: () => void;
}

/**
 * Strip markdown formatting for cleaner TTS output.
 */
function stripMarkdown(md: string): string {
    return md
        .replace(/[#*_`>[\]()~|]/g, "")
        .replace(/\n+/g, ". ")
        .trim();
}

export function useVoice(): UseVoiceReturn {
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
    const [isListening, setIsListening] = useState(false);
    const [canListen, setCanListen] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioUrlRef = useRef<string | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognitionRef = useRef<any>(null);

    // ─── TTS (ElevenLabs) ──────────────────────────────────────────

    const releaseAudioResources = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = "";
            audioRef.current = null;
        }

        if (audioUrlRef.current) {
            URL.revokeObjectURL(audioUrlRef.current);
            audioUrlRef.current = null;
        }
    }, []);

    const stopSpeaking = useCallback(() => {
        releaseAudioResources();
        setIsSpeaking(false);
        setSpeakingMsgId(null);
    }, [releaseAudioResources]);

    const speakText = useCallback(
        async (text: string, msgId: string) => {
            // Toggle off if same message
            if (audioRef.current) {
                releaseAudioResources();
            }
            if (speakingMsgId === msgId) {
                setIsSpeaking(false);
                setSpeakingMsgId(null);
                return;
            }

            const cleanText = stripMarkdown(text);
            if (!cleanText) return;

            setIsSpeaking(true);
            setSpeakingMsgId(msgId);

            try {
                const res = await fetch("/api/tts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: cleanText }),
                });

                if (!res.ok) throw new Error(`TTS: ${res.status}`);

                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                audioUrlRef.current = url;
                const audio = new Audio(url);
                audioRef.current = audio;

                audio.onended = () => {
                    releaseAudioResources();
                    setIsSpeaking(false);
                    setSpeakingMsgId(null);
                };
                audio.onerror = () => {
                    releaseAudioResources();
                    setIsSpeaking(false);
                    setSpeakingMsgId(null);
                };

                await audio.play();
            } catch (err) {
                console.error("TTS error:", err);
                releaseAudioResources();
                setIsSpeaking(false);
                setSpeakingMsgId(null);
            }
        },
        [releaseAudioResources, speakingMsgId]
    );

    // ─── STT (Web Speech API) ─────────────────────────────────────

    const stopListening = useCallback(() => {
        const recognition = recognitionRef.current;
        recognitionRef.current = null;
        recognition?.stop?.();
        setIsListening(false);
    }, []);

    const startListening = useCallback(
        (onTranscript: (text: string) => void) => {
            const SR =
                typeof window !== "undefined"
                    ? (window as unknown as Record<string, unknown>).SpeechRecognition ||
                    (window as unknown as Record<string, unknown>).webkitSpeechRecognition
                    : null;

            if (!SR) return;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const recognition = new (SR as any)();
            recognition.lang = "tr-TR";
            recognition.interimResults = false;
            recognition.maxAlternatives = 1;

            recognition.onstart = () => setIsListening(true);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            recognition.onresult = (e: any) => {
                const transcript = e.results[0][0].transcript;
                onTranscript(transcript);
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            recognition.onerror = (e: any) => {
                console.error("STT error:", e.error);
                setIsListening(false);
            };
            recognition.onend = () => setIsListening(false);

            recognitionRef.current = recognition;
            recognition.start();
        },
        []
    );

    useEffect(() => {
        const SR =
            typeof window !== "undefined"
                ? (window as unknown as Record<string, unknown>).SpeechRecognition ||
                (window as unknown as Record<string, unknown>).webkitSpeechRecognition
                : null;
        setCanListen(Boolean(SR));
    }, []);

    useEffect(() => {
        return () => {
            releaseAudioResources();
            const recognition = recognitionRef.current;
            recognitionRef.current = null;
            recognition?.abort?.();
        };
    }, [releaseAudioResources]);

    return {
        isSpeaking,
        speakingMsgId,
        isListening,
        canListen,
        speakText,
        stopSpeaking,
        startListening,
        stopListening,
    };
}
