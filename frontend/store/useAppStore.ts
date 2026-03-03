import { create } from "zustand";
import type { Locale } from "@/lib/i18n";

export type AgentNode =
    | "router"
    | "rag"
    | "tool"
    | "guardrail"
    | "synthesizer"
    | "idle";

interface AppState {
    activeAgent: AgentNode;
    setActiveAgent: (agent: AgentNode) => void;
    isProcessing: boolean;
    setIsProcessing: (status: boolean) => void;
    isMobileSidebarOpen: boolean;
    setMobileSidebarOpen: (open: boolean) => void;
    locale: Locale;
    setLocale: (locale: Locale) => void;
}

export const useAppStore = create<AppState>((set) => ({
    activeAgent: "idle",
    setActiveAgent: (agent) => set({ activeAgent: agent }),
    isProcessing: false,
    setIsProcessing: (status) => set({ isProcessing: status }),
    isMobileSidebarOpen: false,
    setMobileSidebarOpen: (open) => set({ isMobileSidebarOpen: open }),
    locale: "tr",
    setLocale: (locale) => set({ locale }),
}));
