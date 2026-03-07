"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  PenTool,
  Route,
  ShieldCheck,
  Sparkles,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Progress } from "@/components/ui/progress";
import type { AgentStep } from "@/lib/api";
import { t, type Locale, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type NodeState = "idle" | "processing" | "success" | "warning" | "error";
type VisualStep = AgentStep & { receivedAt?: number };

interface PipelineStageTone {
  accentText: string;
  surfaceClass: string;
  ringClass: string;
}

interface PipelineStage {
  id: string;
  icon: LucideIcon;
  labelKey: TranslationKey;
  tone: PipelineStageTone;
}

interface ProcessedStage {
  stage: PipelineStage;
  state: NodeState;
  rawStatus: AgentStep["status"] | null;
  detail: string | null;
}

interface StageCopy {
  summary: string;
  meta: string;
}

const STAGES: PipelineStage[] = [
  {
    id: "router",
    icon: Route,
    labelKey: "agent.router",
    tone: {
      accentText: "text-indigo-700 dark:text-indigo-300",
      surfaceClass: "border-indigo-200/90 bg-indigo-50/90 dark:border-indigo-400/18 dark:bg-indigo-500/10",
      ringClass: "bg-indigo-500/10 text-indigo-600 ring-indigo-200/90 dark:bg-indigo-400/12 dark:text-indigo-300 dark:ring-indigo-400/18",
    },
  },
  {
    id: "rag",
    icon: BookOpen,
    labelKey: "agent.knowledge",
    tone: {
      accentText: "text-sky-700 dark:text-sky-300",
      surfaceClass: "border-sky-200/90 bg-sky-50/90 dark:border-sky-400/18 dark:bg-sky-500/10",
      ringClass: "bg-sky-500/10 text-sky-600 ring-sky-200/90 dark:bg-sky-400/12 dark:text-sky-300 dark:ring-sky-400/18",
    },
  },
  {
    id: "tool",
    icon: Wrench,
    labelKey: "agent.tool",
    tone: {
      accentText: "text-amber-700 dark:text-amber-300",
      surfaceClass: "border-amber-200/90 bg-amber-50/90 dark:border-amber-400/18 dark:bg-amber-500/10",
      ringClass: "bg-amber-500/10 text-amber-600 ring-amber-200/90 dark:bg-amber-400/12 dark:text-amber-300 dark:ring-amber-400/18",
    },
  },
  {
    id: "synthesizer",
    icon: PenTool,
    labelKey: "agent.synthesizer",
    tone: {
      accentText: "text-emerald-700 dark:text-emerald-300",
      surfaceClass: "border-emerald-200/90 bg-emerald-50/90 dark:border-emerald-400/18 dark:bg-emerald-500/10",
      ringClass: "bg-emerald-500/10 text-emerald-600 ring-emerald-200/90 dark:bg-emerald-400/12 dark:text-emerald-300 dark:ring-emerald-400/18",
    },
  },
  {
    id: "guardrail",
    icon: ShieldCheck,
    labelKey: "agent.guardrail",
    tone: {
      accentText: "text-teal-700 dark:text-teal-300",
      surfaceClass: "border-teal-200/90 bg-teal-50/90 dark:border-teal-400/18 dark:bg-teal-500/10",
      ringClass: "bg-teal-500/10 text-teal-600 ring-teal-200/90 dark:bg-teal-400/12 dark:text-teal-300 dark:ring-teal-400/18",
    },
  },
];

const ALWAYS_VISIBLE_STAGE_IDS = ["router", "rag", "synthesizer", "guardrail"];

const STATUS_KEY_MAP: Record<AgentStep["status"], TranslationKey> = {
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

const PSEUDO_STATUS_BY_STAGE: Record<string, AgentStep["status"]> = {
  router: "analyzing",
  rag: "searching",
  tool: "executing",
  synthesizer: "composing",
  guardrail: "checking",
};

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function shortenFilename(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized.length <= 28) return normalized;
  return `${normalized.slice(0, 25)}...`;
}

function extractSources(detail: string): string[] {
  const match = detail.match(/from:\s*(.+)$/i);
  if (!match) return [];

  return Array.from(
    new Set(
      match[1]
        .split(",")
        .map((item) => item.trim().replace(/\(p\.\d+\)/gi, "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 2);
}

function summarizeStageDetail(
  stageId: string,
  detail: string | null,
  state: NodeState,
  locale: Locale,
): StageCopy {
  const isTr = locale === "tr";

  if (!detail) {
    if (state === "idle") {
      return {
        summary: isTr ? "Henüz devreye girmedi" : "Not engaged yet",
        meta: t("chat.pipeline_pending", locale),
      };
    }

    if (state === "success") {
      return {
        summary: isTr ? "Aşama tamamlandı" : "Stage completed",
        meta: t("chat.pipeline_ready", locale),
      };
    }

    return {
      summary: t("chat.pipeline_waiting", locale),
      meta: t("chat.pipeline_live", locale),
    };
  }

  const normalized = detail.toLowerCase();

  if (stageId === "router") {
    if (normalized.includes("route: rag")) {
      return {
        summary: isTr ? "Belge tabanlı sorguya yönlendirdi" : "Routed the query to document retrieval",
        meta: isTr ? "Soru, bilgi tabanı sorgusu olarak tanındı" : "Detected a retrieval-based request",
      };
    }

    if (normalized.includes("route: tool")) {
      return {
        summary: isTr ? "Araç akışını devreye aldı" : "Activated the tool workflow",
        meta: isTr ? "İşlem gerektiren bir istek belirlendi" : "Detected an action-oriented request",
      };
    }

    return {
      summary: isTr ? "İsteği analiz edip yön seçti" : "Analyzed the request and selected a route",
      meta: isTr ? "İlk karar katmanı tamamlandı" : "Initial decision layer completed",
    };
  }

  if (stageId === "rag") {
    const countMatch = detail.match(/Found\s+(\d+)/i);
    const sources = extractSources(detail);

    if (countMatch) {
      return {
        summary: isTr
          ? `${countMatch[1]} ilgili belge parçası bulundu`
          : `${countMatch[1]} relevant document chunks found`,
        meta: sources.length > 0
          ? (isTr ? `Kaynak: ${sources.map(shortenFilename).join(", ")}` : `Source: ${sources.map(shortenFilename).join(", ")}`)
          : (isTr ? "Kaynak belgeler hazırlandı" : "Source documents prepared"),
      };
    }

    if (normalized.includes("no relevant")) {
      return {
        summary: isTr ? "Eşleşen belge içeriği bulunamadı" : "No matching document content found",
        meta: isTr ? "Sorgu ile ilgili parça dönmedi" : "No relevant chunks were returned",
      };
    }

    if (normalized.includes("failed")) {
      return {
        summary: isTr ? "Bilgi tabanı sorgusu başarısız" : "Retrieval step failed",
        meta: isTr ? "Belge parçası alınamadı" : "Document chunks could not be fetched",
      };
    }
  }

  if (stageId === "tool") {
    if (normalized.startsWith("error")) {
      return {
        summary: isTr ? "Araç çalıştırması başarısız" : "Tool execution failed",
        meta: isTr ? "İşlem tekrar denenmeli" : "The action should be retried",
      };
    }

    return {
      summary: isTr ? "Araç çalıştırması tamamlandı" : "Tool execution completed",
      meta: isTr ? "İşlem sonucu yanıta aktarıldı" : "Result forwarded to the response",
    };
  }

  if (stageId === "synthesizer") {
    if (normalized.includes("error")) {
      return {
        summary: isTr ? "Yanıt üretimi başarısız" : "Response generation failed",
        meta: isTr ? "Kaynaklı yanıt kurulamadı" : "Grounded response could not be composed",
      };
    }

    return {
      summary: isTr ? "Kaynaklı yanıt oluşturdu" : "Composed a grounded response",
      meta: isTr ? "Belgelere dayalı çıktı hazırlandı" : "Prepared a response grounded in documents",
    };
  }

  if (stageId === "guardrail") {
    if (normalized.includes("passed")) {
      return {
        summary: isTr ? "Uyum kontrolünden geçti" : "Passed the compliance check",
        meta: isTr ? "Yanıt paylaşılmaya uygun" : "The response is safe to show",
      };
    }

    if (normalized.includes("flagged")) {
      return {
        summary: isTr ? "Uyum uyarısı oluşturdu" : "Raised a compliance warning",
        meta: isTr ? "Yanıt ek gözden geçirme istiyor" : "The response needs additional review",
      };
    }

    if (normalized.includes("failed") || normalized.includes("blocked")) {
      return {
        summary: isTr ? "Uyum doğrulaması tamamlanamadı" : "Compliance verification could not finish",
        meta: isTr ? "Yanıt güvenlik nedeniyle sınırlandı" : "The response was constrained for safety",
      };
    }
  }

  return {
    summary: detail,
    meta: isTr ? "Sistem çıktısı" : "System output",
  };
}

function determineStage(
  stageId: string,
  steps: VisualStep[],
  allAllowedIds: string[],
): ProcessedStage {
  const stage = STAGES.find((candidate) => candidate.id === stageId)!;
  const step = steps.find((candidate) => candidate.node === stageId);

  if (!step) {
    const myIndex = allAllowedIds.indexOf(stageId);
    const hasFollowing = steps.some((candidate) => allAllowedIds.indexOf(candidate.node) > myIndex);

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

  return {
    stage,
    state,
    rawStatus: step.status,
    detail: step.detail || null,
  };
}

function badgeClasses(state: NodeState) {
  switch (state) {
    case "success":
      return "border-emerald-200/90 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300";
    case "warning":
      return "border-amber-200/90 bg-amber-500/10 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300";
    case "error":
      return "border-rose-200/90 bg-rose-500/10 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-300";
    case "processing":
      return "border-sky-200/90 bg-sky-500/10 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-300";
    default:
      return "border-slate-200/90 bg-white/78 text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400";
  }
}

function stateIcon(state: NodeState) {
  if (state === "success") return CheckCircle2;
  if (state === "warning") return AlertTriangle;
  if (state === "error") return XCircle;
  if (state === "processing") return Activity;
  return Sparkles;
}

function getStatusLabel(stage: ProcessedStage, locale: Locale) {
  if (stage.rawStatus) {
    return t(STATUS_KEY_MAP[stage.rawStatus], locale);
  }

  if (stage.state === "processing") return t("chat.pipeline_live", locale);
  if (stage.state === "success") return t("agent_status.complete", locale);

  return t("chat.pipeline_pending", locale);
}

export const PipelineVisualizer = memo(function PipelineVisualizer({
  steps,
  locale,
  isStreaming = false,
  startedAt,
}: {
  steps: VisualStep[];
  locale: Locale;
  isStreaming?: boolean;
  startedAt?: Date;
}) {
  const reduceMotion = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isStreaming) return;

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isStreaming]);

  const activeIds = useMemo(() => {
    if (steps.length === 0) return ALWAYS_VISIBLE_STAGE_IDS;

    const seen = new Set(steps.map((step) => step.node));
    return STAGES.filter(
      (stage) => ALWAYS_VISIBLE_STAGE_IDS.includes(stage.id) || seen.has(stage.id),
    ).map((stage) => stage.id);
  }, [steps]);

  const actualStages = useMemo(
    () => activeIds.map((id) => determineStage(id, steps, activeIds)),
    [activeIds, steps],
  );

  const startedAtMs = startedAt?.getTime() ?? steps[0]?.receivedAt ?? now;
  const elapsedMs = Math.max(0, now - startedAtMs);

  const displayedStages = useMemo(() => {
    if (!(isStreaming && steps.length === 0)) return actualStages;

    const stageIndex = Math.min(
      Math.floor(elapsedMs / 2000),
      actualStages.length - 1,
    );

    return actualStages.map((entry, index) => {
      if (index < stageIndex) {
        return {
          ...entry,
          state: "success" as const,
          rawStatus: "complete" as const,
        };
      }

      if (index === stageIndex) {
        return {
          ...entry,
          state: "processing" as const,
          rawStatus: PSEUDO_STATUS_BY_STAGE[entry.stage.id] ?? "analyzing",
          detail: t("chat.pipeline_waiting", locale),
        };
      }

      return entry;
    });
  }, [actualStages, elapsedMs, isStreaming, locale, steps.length]);

  const stageCards = useMemo(() => {
    return displayedStages.map((entry) => ({
      ...entry,
      copy: summarizeStageDetail(entry.stage.id, entry.detail, entry.state, locale),
    }));
  }, [displayedStages, locale]);

  const progressValue = useMemo(() => {
    if (stageCards.length === 0) return 0;

    if (isStreaming && steps.length === 0) {
      const stageIndex = Math.min(Math.floor(elapsedMs / 2000), stageCards.length - 1);
      const stageProgress = (elapsedMs % 2000) / 2000;
      return ((stageIndex + 0.15 + stageProgress * 0.5) / stageCards.length) * 100;
    }

    const completed = stageCards.filter((stage) =>
      ["success", "warning", "error"].includes(stage.state),
    ).length;
    const processing = stageCards.some((stage) => stage.state === "processing") ? 0.35 : 0;

    if (!isStreaming) {
      return completed === stageCards.length ? 100 : ((completed + processing) / stageCards.length) * 100;
    }

    return Math.max(12, ((completed + processing) / stageCards.length) * 100);
  }, [elapsedMs, isStreaming, stageCards, steps.length]);

  const liveStage = stageCards.find((stage) => stage.state === "processing")
    ?? [...stageCards].reverse().find((stage) => stage.state !== "idle")
    ?? stageCards[0];

  const leadKey = isStreaming ? "chat.pipeline_current" : "chat.pipeline_latest";
  const leadSummary = liveStage?.copy.summary ?? t("chat.pipeline_waiting", locale);
  const leadMeta = liveStage?.copy.meta ?? t("chat.pipeline_ready", locale);

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="relative overflow-hidden rounded-[26px] border border-slate-200/80 bg-white/78 p-4 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.35)] backdrop-blur-lg dark:border-white/[0.07] dark:bg-[#0f172a]/68 dark:shadow-[0_24px_60px_-34px_rgba(2,6,23,0.78)]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.10),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.08),transparent_30%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.14),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.10),transparent_24%)]" />

      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
              {t("chat.pipeline_title", locale)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                {isStreaming ? t("chat.pipeline_live", locale) : t("chat.pipeline_done", locale)}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  isStreaming
                    ? "border-sky-200/90 bg-sky-500/10 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-300"
                    : "border-emerald-200/90 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300",
                )}
              >
                <span className={cn("size-1.5 rounded-full", isStreaming ? "bg-sky-500" : "bg-emerald-500")} />
                {isStreaming ? t("chat.pipeline_live", locale) : t("chat.pipeline_ready", locale)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/76 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
            <Clock3 className="size-3.5" strokeWidth={1.8} />
            <span>{t("chat.pipeline_elapsed", locale)}</span>
            <span className="font-mono text-slate-900 dark:text-slate-100">
              {formatElapsed(elapsedMs)}
            </span>
          </div>
        </div>

        <div className="mt-4">
          <Progress
            value={progressValue}
            aria-label={t("chat.pipeline_title", locale)}
            className="h-2.5 border border-white/50 bg-slate-200/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)] dark:border-white/[0.06] dark:bg-white/[0.06]"
          />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
          {stageCards.map((entry) => {
            const StatusIcon = stateIcon(entry.state);
            const longLabel = locale === "tr"
              ? `${t(entry.stage.labelKey, locale)} Ajanı`
              : `${t(entry.stage.labelKey, locale)} Agent`;

            return (
              <article
                key={entry.stage.id}
                className={cn(
                  "min-h-[148px] rounded-[22px] border p-3.5",
                  entry.state === "idle"
                    ? "border-slate-200/85 bg-white/72 dark:border-white/[0.06] dark:bg-white/[0.04]"
                    : entry.stage.tone.surfaceClass,
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-2xl ring-1",
                      entry.state === "idle"
                        ? "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-white/[0.06] dark:text-slate-400 dark:ring-white/[0.05]"
                        : entry.stage.tone.ringClass,
                    )}
                  >
                    <entry.stage.icon className="size-4.5" strokeWidth={1.9} />
                  </div>

                  <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold whitespace-nowrap", badgeClasses(entry.state))}>
                    <StatusIcon className="size-3" strokeWidth={2} />
                    {getStatusLabel(entry, locale)}
                  </span>
                </div>

                <div className="mt-4">
                  <div className={cn("text-[11px] font-semibold uppercase tracking-[0.22em]", entry.state === "idle" ? "text-slate-400 dark:text-slate-500" : entry.stage.tone.accentText)}>
                    {longLabel}
                  </div>
                  <div className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">
                    {entry.copy.summary}
                  </div>
                  <div className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300/88">
                    {entry.copy.meta}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-[22px] border border-slate-200/80 bg-white/76 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-white/[0.06] dark:bg-white/[0.04]">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900">
            {liveStage ? (
              <liveStage.stage.icon className="size-4.5" strokeWidth={1.9} />
            ) : (
              <Sparkles className="size-4.5" strokeWidth={1.9} />
            )}
          </div>

          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              {t(leadKey, locale)}
            </div>
            <div className="mt-1 text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">
              {leadSummary}
            </div>
            <div className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300/88">
              {leadMeta}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
});
