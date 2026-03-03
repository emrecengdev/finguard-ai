"use client";

import { memo, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Route,
    BookOpen,
    Wrench,
    PenTool,
    ShieldCheck,
    CheckCircle2,
    XCircle,
    type LucideIcon,
    AlertTriangle,
} from "lucide-react";
import type { AgentStep } from "@/lib/api";
import { t, type TranslationKey, type Locale } from "@/lib/i18n";

// ─── Types ──────────────────────────────────────────────────────

interface PipelineStage {
    id: string;
    icon: LucideIcon;
    labelKey: TranslationKey;
    colorClass: string;
    shadowColor: string;
}

const STAGES: PipelineStage[] = [
    {
        id: "router",
        icon: Route,
        labelKey: "agent.router",
        colorClass: "text-violet-500",
        shadowColor: "rgba(139, 92, 246, 0.4)",
    },
    {
        id: "rag",
        icon: BookOpen,
        labelKey: "agent.knowledge",
        colorClass: "text-cyan-500",
        shadowColor: "rgba(6, 182, 212, 0.4)",
    },
    {
        id: "tool",
        icon: Wrench,
        labelKey: "agent.tool",
        colorClass: "text-amber-500",
        shadowColor: "rgba(245, 158, 11, 0.4)",
    },
    {
        id: "synthesizer",
        icon: PenTool,
        labelKey: "agent.synthesizer",
        colorClass: "text-emerald-500",
        shadowColor: "rgba(16, 185, 129, 0.4)",
    },
    {
        id: "guardrail",
        icon: ShieldCheck,
        labelKey: "agent.guardrail",
        colorClass: "text-teal-500",
        shadowColor: "rgba(20, 184, 166, 0.4)",
    },
];

const STATUS_KEY_MAP: Record<string, TranslationKey> = {
    analyzing: "agent_status.analyzing",
    searching: "agent_status.searching",
    executing: "agent_status.executing",
    composing: "agent_status.composing",
    checking: "agent_status.checking",
    complete: "agent_status.complete",
    error: "agent_status.error",
    flagged: "agent_status.flagged",
    skipped: "agent_status.skipped",
};

type NodeState = "idle" | "processing" | "success" | "warning" | "error";

interface ProcessedStage {
    stage: PipelineStage;
    state: NodeState;
    rawStatus: string | null;
    detail: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────

function determineStage(
    stageId: string,
    steps: AgentStep[],
    allAllowedIds: string[]
): ProcessedStage {
    const stage = STAGES.find((s) => s.id === stageId)!;
    const step = steps.find((s) => s.node === stageId);

    if (!step) {
        // Check if a subsequent stage in the pipeline is active/done. If so, this was implicitly completed or fast-tracked.
        const myIdx = allAllowedIds.indexOf(stageId);
        const hasFollowing = steps.some((s) => allAllowedIds.indexOf(s.node) > myIdx);
        return {
            stage,
            state: hasFollowing ? "success" : "idle",
            rawStatus: null,
            detail: null,
        };
    }

    let state: NodeState = "processing";
    if (step.status === "error") state = "error";
    else if (step.status === "flagged") state = "warning";
    else if (step.status === "complete") state = "success";
    else if (step.status === "skipped") state = "idle";

    return { stage, state, rawStatus: step.status, detail: step.detail || null };
}

// ─── SVG + Framer Motion Extracted Components ───────────────────

const NodeSVG = memo(function NodeSVG({
    state,
    colorClass,
    shadowColor,
    icon: Icon,
}: {
    state: NodeState;
    colorClass: string;
    shadowColor: string;
    icon: LucideIcon;
}) {
    const isProc = state === "processing";
    const isSucc = state === "success";
    const isWarn = state === "warning";
    const isErr = state === "error";

    const colorStr = isErr ? "text-rose-500" : isWarn ? "text-amber-500" : colorClass;
    const filterStyle =
        isProc || isSucc || isWarn || isErr
            ? { filter: `drop-shadow(0 0 8px ${isErr ? "rgba(244,63,94,0.5)" : isWarn ? "rgba(245,158,11,0.5)" : shadowColor})` }
            : {};

    return (
        <div className={`relative flex size-12 items-center justify-center ${colorStr}`}>
            {/* Liquid glass background core */}
            <div
                className={`absolute inset-0.5 rounded-full backdrop-blur-md transition-colors duration-700 ${isErr
                        ? "bg-rose-500/10"
                        : isWarn
                            ? "bg-amber-500/10"
                            : isSucc || isProc
                                ? "bg-current/10"
                                : "bg-muted/40"
                    }`}
            />

            {/* Main SVG Vector Layer */}
            <svg
                className="absolute inset-0 size-12 overflow-visible"
                viewBox="0 0 48 48"
                style={filterStyle}
            >
                {/* Base track */}
                <circle cx="24" cy="24" r="22" className="fill-none stroke-border/50" strokeWidth="1" />

                <AnimatePresence>
                    {/* Active dashed orbiting ring */}
                    {isProc && (
                        <motion.circle
                            key="proc-ring"
                            cx="24"
                            cy="24"
                            r="22"
                            className="fill-none stroke-current"
                            strokeWidth="1.5"
                            strokeDasharray="6 6"
                            initial={{ opacity: 0, rotate: -90 }}
                            animate={{ opacity: 1, rotate: 270 }}
                            exit={{ opacity: 0 }}
                            transition={{
                                rotate: { duration: 3, repeat: Infinity, ease: "linear" },
                                opacity: { duration: 0.3 }
                            }}
                            style={{ originX: "24px", originY: "24px" }}
                        />
                    )}

                    {/* Complete solid wrapping ring */}
                    {(isSucc || isWarn || isErr) && (
                        <motion.circle
                            key="done-ring"
                            cx="24"
                            cy="24"
                            r="22"
                            className="fill-none stroke-current"
                            strokeWidth="1.5"
                            strokeDasharray="140" // ~2*pi*22 = 138.2
                            initial={{ strokeDashoffset: 140 }}
                            animate={{ strokeDashoffset: 0 }}
                            transition={{ duration: 0.8, ease: "anticipate" }}
                        />
                    )}

                    {/* Micro-animations: Orbiting data particles when processing */}
                    {isProc && (
                        <motion.g
                            key="particles"
                            animate={{ rotate: 360 }}
                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                            style={{ originX: "24px", originY: "24px" }}
                        >
                            <circle cx="24" cy="2" r="2" className="fill-current" />
                            <circle cx="24" cy="46" r="1.5" className="fill-current opacity-60" />
                        </motion.g>
                    )}
                </AnimatePresence>
            </svg>

            {/* Internal Icon with morph transitions */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={isSucc ? "succ" : isErr ? "err" : isWarn ? "warn" : "icon"}
                    initial={{ scale: 0.3, opacity: 0, rotate: -45 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0.3, opacity: 0, rotate: 45 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="relative z-10"
                >
                    {isSucc ? (
                        <CheckCircle2 className="size-4.5" strokeWidth={2.5} />
                    ) : isErr ? (
                        <XCircle className="size-4.5" strokeWidth={2.5} />
                    ) : isWarn ? (
                        <AlertTriangle className="size-4.5" strokeWidth={2.5} />
                    ) : (
                        <Icon className={`size-4.5 ${state === "idle" ? "text-muted-foreground/50" : "text-current"}`} strokeWidth={1.5} />
                    )}
                </motion.div>
            </AnimatePresence>
        </div>
    );
});

const ConnectionLine = memo(function ConnectionLine({
    fromState,
    toState,
    fromColor,
}: {
    fromState: NodeState;
    toState: NodeState;
    fromColor: string;
}) {
    const isFilled = fromState !== "idle" && fromState !== "processing";
    const isActiveConnection = isFilled && toState === "processing";

    return (
        <div className={`relative flex h-12 flex-1 items-center px-2 ${fromColor}`}>
            <svg className="h-[2px] w-full overflow-visible" preserveAspectRatio="none">
                {/* Subdued base rail */}
                <line x1="0" y1="1" x2="100%" y2="1" className="stroke-border/50" strokeWidth="2" />

                {/* Painted rail */}
                <motion.line
                    x1="0" y1="1" x2="100%" y2="1"
                    className="stroke-current"
                    strokeWidth="2"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: isFilled ? 1 : 0 }}
                    transition={{ duration: 0.8, ease: "anticipate" }}
                />

                {/* Traveling signal burst (micro-animation) */}
                <AnimatePresence>
                    {isActiveConnection && (
                        <motion.g
                            initial={{ x: "0%" }}
                            animate={{ x: "100%" }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                        >
                            <circle
                                cx="0" cy="1" r="2.5"
                                className="fill-current"
                                style={{ filter: "drop-shadow(0 0 5px currentColor)" }}
                            />
                            {/* Comet tail effect */}
                            <line x1="-15" y1="1" x2="0" y2="1" className="stroke-current" strokeWidth="2" opacity="0.3" />
                        </motion.g>
                    )}
                </AnimatePresence>
            </svg>
        </div>
    );
});

// ─── Main Visualizer Component ──────────────────────────────────

export const PipelineVisualizer = memo(function PipelineVisualizer({
    steps,
    locale,
}: {
    steps: AgentStep[];
    locale: Locale;
}) {
    const activeIds = useMemo(() => {
        const s = new Set(steps.map((x) => x.node));
        return STAGES.filter((x) => x.id === "router" || x.id === "synthesizer" || x.id === "guardrail" || s.has(x.id)).map(x => x.id);
    }, [steps]);

    const stagesData = useMemo(() => {
        return activeIds.map((id) => determineStage(id, steps, activeIds));
    }, [activeIds, steps]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 4, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
            className="relative w-full overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card/80 to-muted/20 px-4 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl"
        >
            <div className="flex items-start justify-between">
                {stagesData.map((data, i) => (
                    <div key={data.stage.id} className="flex min-w-0 flex-1 items-start">
                        <div className="flex flex-col items-center">
                            {/* Node Hex/Circle */}
                            <NodeSVG
                                state={data.state}
                                icon={data.stage.icon}
                                colorClass={data.stage.colorClass}
                                shadowColor={data.stage.shadowColor}
                            />

                            {/* Text Labels */}
                            <div className="mt-3 flex flex-col items-center text-center">
                                <span className={`font-mono text-[9px] font-bold uppercase tracking-[0.15em] ${data.state === "idle" ? "text-muted-foreground/40" : data.stage.colorClass}`}>
                                    {t(data.stage.labelKey, locale)}
                                </span>

                                <div className="relative mt-1 h-3 w-16 overflow-hidden">
                                    <AnimatePresence mode="popLayout">
                                        {data.state === "processing" && data.rawStatus && (
                                            <motion.span
                                                key="proc"
                                                initial={{ y: 15, opacity: 0 }}
                                                animate={{ y: 0, opacity: 1 }}
                                                exit={{ y: -15, opacity: 0 }}
                                                className="absolute inset-0 block text-[9px] font-medium text-muted-foreground"
                                            >
                                                {STATUS_KEY_MAP[data.rawStatus] ? t(STATUS_KEY_MAP[data.rawStatus], locale) : data.rawStatus}...
                                            </motion.span>
                                        )}
                                        {data.detail && (data.state === "success" || data.state === "error") && (
                                            <motion.span
                                                key="det"
                                                initial={{ y: 15, opacity: 0 }}
                                                animate={{ y: 0, opacity: 1 }}
                                                className="absolute inset-0 block truncate px-1 text-[9px] text-muted-foreground/60"
                                                title={data.detail}
                                            >
                                                {data.detail}
                                            </motion.span>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </div>

                        {/* Connection Line */}
                        {i < stagesData.length - 1 && (
                            <ConnectionLine
                                fromState={data.state}
                                toState={stagesData[i + 1].state}
                                fromColor={data.stage.colorClass}
                            />
                        )}
                    </div>
                ))}
            </div>
        </motion.div>
    );
});
