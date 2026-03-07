"use client";

import type { ComponentPropsWithoutRef } from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import {
  Loader2,
  User,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Share,
  Upload,
  Sparkles,
  Mic,
  ArrowUp,
  Volume2,
  VolumeX,
  Network,
  Cpu,
} from "lucide-react";
import { PipelineVisualizer } from "@/components/PipelineVisualizer";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { TypingAnimation } from "@/components/ui/typing-animation";
import { ShinyButton } from "@/components/ui/shiny-button";
import {
  streamMessage,
  type AgentStep,
  type ChatSource,
  type DocumentInfo,
} from "@/lib/api";
import { t } from "@/lib/i18n";
import { useAppStore } from "@/store/useAppStore";
import { useVoice } from "@/hooks/useVoice";

// ─── Types ──────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  agentSteps?: UIAgentStep[];
  sources?: ChatSource[];
  guardrailPassed?: boolean;
  isLoading?: boolean;
}

interface UIAgentStep extends AgentStep {
  receivedAt?: number;
}

interface SourceEntry {
  source: string;
  page: number;
  rerank_score: number;
}

interface SourceGroup {
  source: string;
  entries: SourceEntry[];
  maxScore: number;
}

// ─── Constants ──────────────────────────────────────────────────

const spring = { type: "spring" as const, stiffness: 300, damping: 26 };

const INLINE_SOURCE_RE = /\[Source:\s*([^\],]+),\s*Page\s*(\d+)\]/gi;

// ─── Helpers ────────────────────────────────────────────────────

function normalizeMarkdown(content: string, stripSources: boolean): string {
  let s = content.replace(/\r\n/g, "\n").replace(/<br\s*\/?>/gi, "\n");
  if (stripSources) s = s.replace(INLINE_SOURCE_RE, "");
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildSourceGroups(sources: ChatSource[]): SourceGroup[] {
  const dedup = new Map<string, SourceEntry>();
  for (const s of sources) {
    const k = `${s.source}::${s.page}`;
    const ex = dedup.get(k);
    if (!ex || s.rerank_score > ex.rerank_score)
      dedup.set(k, { source: s.source, page: s.page, rerank_score: s.rerank_score });
  }
  const grouped = new Map<string, SourceEntry[]>();
  for (const e of dedup.values()) {
    const a = grouped.get(e.source) || [];
    a.push(e);
    grouped.set(e.source, a);
  }
  return Array.from(grouped.entries())
    .map(([source, entries]) => ({
      source,
      entries: entries.sort((a, b) => b.rerank_score - a.rerank_score),
      maxScore: Math.max(...entries.map((e) => e.rerank_score)),
    }))
    .sort((a, b) => b.maxScore - a.maxScore);
}

function scoreColor(s: number) {
  if (s >= 2.8) return "text-primary";
  if (s >= 1.5) return "text-amber-500";
  return "text-muted-foreground";
}

function buildTranscript(messages: Message[]) {
  return messages
    .map((message) => {
      const heading = message.role === "assistant" ? "## FinGuard AI" : "## User";
      const sources =
        message.sources && message.sources.length > 0
          ? `\n\nSources: ${message.sources
            .map((source) => `${source.source} p.${source.page}`)
            .join(", ")}`
          : "";

      return `${heading}\nTime: ${message.timestamp.toISOString()}\n\n${message.content}${sources}`;
    })
    .join("\n\n---\n\n");
}

function messageWidthClass(role: Message["role"]) {
  return role === "assistant"
    ? "mr-auto max-w-[min(100%,920px)] items-start"
    : "ml-auto max-w-[min(72%,560px)] items-end";
}

// ─── Sub-components ─────────────────────────────────────────────

function SourcePills({ sources }: { sources: ChatSource[] }) {
  const groups = buildSourceGroups(sources);
  if (!groups.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-2">
      {groups.map((g) => (
        <span
          key={g.source}
          className="inline-flex items-center gap-1 rounded-xl border border-slate-200/85 bg-white/78 px-2.5 py-1 font-mono text-[10px] text-slate-600 shadow-sm dark:border-white/[0.06] dark:bg-background/45 dark:text-muted-foreground"
        >
          {g.source}
          {g.entries.map((e) => (
            <span key={e.page} className={`font-semibold ${scoreColor(e.rerank_score)}`}>
              p.{e.page}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

function SuggestionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <ShinyButton
      onClick={onClick}
      className="flex flex-1 items-center justify-center !rounded-full bg-white/80 dark:bg-[#121117] !px-4 !py-2.5 hover:bg-slate-50 dark:hover:bg-[#1a1822] active:scale-[0.98]"
    >
      <div className="flex w-full items-center justify-center gap-2 text-[13px] font-medium text-slate-700 dark:text-[#d1d0d5]">
        <span className="text-[#8e8c95]">{icon}</span>
        <span className="line-clamp-1 tracking-normal capitalize">{label}</span>
      </div>
    </ShinyButton>
  );
}

// ─── Markdown overrides ─────────────────────────────────────────

const md: Record<string, React.FC<ComponentPropsWithoutRef<never>>> = {
  h1: ({ children, ...p }: ComponentPropsWithoutRef<"h1">) => (
    <h1 className="mb-2 text-lg font-semibold tracking-tight text-slate-900 dark:text-white/90" {...p}>{children}</h1>
  ),
  h2: ({ children, ...p }: ComponentPropsWithoutRef<"h2">) => (
    <h2 className="mb-2 text-base font-semibold tracking-tight text-slate-900 dark:text-white/90" {...p}>{children}</h2>
  ),
  h3: ({ children, ...p }: ComponentPropsWithoutRef<"h3">) => (
    <h3 className="mb-1.5 text-sm font-semibold text-slate-700 dark:text-white/80" {...p}>{children}</h3>
  ),
  p: ({ children, ...p }: ComponentPropsWithoutRef<"p">) => (
    <p className="mb-2 max-w-[65ch] leading-relaxed last:mb-0" {...p}>{children}</p>
  ),
  ul: ({ children, ...p }: ComponentPropsWithoutRef<"ul">) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0" {...p}>{children}</ul>
  ),
  ol: ({ children, ...p }: ComponentPropsWithoutRef<"ol">) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0" {...p}>{children}</ol>
  ),
  li: ({ children, ...p }: ComponentPropsWithoutRef<"li">) => <li {...p}>{children}</li>,
  strong: ({ children, ...p }: ComponentPropsWithoutRef<"strong">) => (
    <strong className="font-semibold text-slate-900 dark:text-white" {...p}>{children}</strong>
  ),
  code: ({ children, className, ...p }: ComponentPropsWithoutRef<"code"> & { inline?: boolean }) => {
    if (!className?.includes("language-"))
      return <code className="rounded-md border border-slate-200 bg-slate-100/95 px-1.5 py-0.5 font-mono text-xs text-slate-700 dark:border-white/[0.05] dark:bg-black/30 dark:text-white/80" {...p}>{children}</code>;
    return <code className="block overflow-x-auto rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs text-slate-100 dark:border-white/[0.05] dark:bg-black/50 dark:text-zinc-300" {...p}>{children}</code>;
  },
  a: ({ href, children, ...p }: ComponentPropsWithoutRef<"a">) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline decoration-primary/50 underline-offset-2 transition-colors hover:text-primary/80" {...p}>{children}</a>
  ),
  blockquote: ({ children, ...p }: ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote className="mb-2 rounded-r-lg border-l-2 border-primary/30 bg-slate-100/95 px-3 py-2 text-slate-700 dark:border-primary/40 dark:bg-primary/10 dark:text-white/70" {...p}>{children}</blockquote>
  ),
  table: ({ children, ...p }: ComponentPropsWithoutRef<"table">) => (
    <div className="mb-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-white/[0.05]"><table className="min-w-full border-collapse text-xs" {...p}>{children}</table></div>
  ),
  thead: ({ children, ...p }: ComponentPropsWithoutRef<"thead">) => (
    <thead className="bg-slate-100 text-slate-600 dark:bg-black/30 dark:text-white/60" {...p}>{children}</thead>
  ),
  tbody: ({ children, ...p }: ComponentPropsWithoutRef<"tbody">) => <tbody {...p}>{children}</tbody>,
  tr: ({ children, ...p }: ComponentPropsWithoutRef<"tr">) => (
    <tr className="border-t border-slate-200 dark:border-white/[0.05]" {...p}>{children}</tr>
  ),
  th: ({ children, ...p }: ComponentPropsWithoutRef<"th">) => (
    <th className="px-2.5 py-1.5 text-left font-semibold" {...p}>{children}</th>
  ),
  td: ({ children, ...p }: ComponentPropsWithoutRef<"td">) => (
    <td className="px-2.5 py-1.5 align-top" {...p}>{children}</td>
  ),
};

// ─── Main Chat ──────────────────────────────────────────────────

interface ChatProps {
  documents: DocumentInfo[];
}

export function Chat({ documents }: ChatProps) {
  const locale = useAppStore((s) => s.locale);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { speakingMsgId, isListening, canListen, speakText, stopSpeaking, startListening, stopListening } = useVoice();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const openUploadPicker = useCallback(() => {
    window.dispatchEvent(new Event("finguard:open-upload"));
  }, []);

  const openSamplePool = useCallback(() => {
    window.dispatchEvent(new Event("finguard:open-sample-pool"));
  }, []);

  const exportTranscript = useCallback(() => {
    if (messages.length === 0) return;

    const blob = new Blob([buildTranscript(messages)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `finguard-chat-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }, [messages]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    };

    const asstId = `a-${Date.now()}`;
    const assistantMsg: Message = {
      id: asstId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isLoading: true,
      agentSteps: [],
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsLoading(true);

    try {
      await streamMessage(
        trimmed,
        "default",
        locale,
        (step) => {
          const enrichedStep: UIAgentStep = {
            ...step,
            receivedAt: Date.now(),
          };
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstId
                ? { ...m, agentSteps: [...(m.agentSteps || []), enrichedStep] }
                : m
            )
          );
        },
        (data) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstId
                ? {
                  ...m,
                  content: data.response,
                  guardrailPassed: data.guardrail_passed,
                  sources: data.sources,
                  isLoading: false,
                }
                : m
            )
          );
        },
        (error) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstId
                ? { ...m, content: `${t("chat.error_prefix", locale)}: ${error}`, isLoading: false }
                : m
            )
          );
        }
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === asstId
            ? {
              ...m,
              content: `${t("chat.error_prefix", locale)}: ${err instanceof Error ? err.message : t("chat.error_generic", locale)}`,
              isLoading: false,
            }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [input, isLoading, locale]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden w-full">

      {/* ── Top Bar ──────────────────────────────────────── */}
      <div className="flex items-center justify-between p-6 z-50 relative pointer-events-auto w-full shrink-0">
        <div className="flex items-center gap-2 rounded-full border border-black/5 dark:border-white/[0.04] bg-white/80 dark:bg-[#121117] px-4 py-2 text-[13px] font-medium text-slate-700 dark:text-[#d1d0d5] shadow-sm">
          <span>FinGuard AI</span>
          <ChevronDown size={14} className="text-slate-400 dark:text-[#6b6975]" />
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <LanguageSwitcher />
          <button
            onClick={exportTranscript}
            disabled={messages.length === 0}
            className="flex items-center gap-2 rounded-full border border-black/5 dark:border-white/[0.04] bg-white/80 dark:bg-[#121117] px-4 py-2 text-[13px] font-medium text-slate-700 dark:text-[#d1d0d5] shadow-sm transition-colors hover:bg-slate-50 dark:hover:bg-[#1a1822] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>Export</span>
            <Share size={14} className="text-slate-400 dark:text-[#6b6975]" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {messages.length === 0 ? (
          /* ── Empty State Hero ────────────────────────────── */
          <div className="flex h-full flex-col items-center justify-center px-8 z-10 -mt-20">
            {/* System Architecture Bento Box (Nano Banana Pro 3 Aesthetic) */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 20 }}
              className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-3xl relative px-4"
            >
              {/* Background Glow */}
              <div className="absolute -inset-4 bg-gradient-to-r from-emerald-500/10 via-purple-500/10 to-teal-500/10 blur-2xl -z-10 rounded-full" />

              {/* Step 1: Orchestration */}
              <motion.div
                whileHover={{ y: -4 }}
                className="flex flex-col items-center justify-center rounded-[24px] border border-white/40 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-xl p-6 shadow-xl relative overflow-hidden group"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="h-12 w-12 rounded-full bg-purple-100/80 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-4 border border-purple-200/50 dark:border-purple-500/30">
                  <Network size={22} strokeWidth={1.5} />
                </div>
                <h3 className="text-[15px] font-semibold text-slate-800 dark:text-slate-200 mb-1.5 text-center">Multi-Agent Orchestration</h3>
                <p className="text-[13px] text-slate-500 dark:text-slate-400 text-center leading-relaxed">
                  {locale === "tr" ? "LangGraph ile akıllı görev dağıtımı ve çoklu ajan koordinasyonu." : "Intelligent routing & multi-agent coordination powered by LangGraph."}
                </p>
              </motion.div>

              {/* Step 2: Legal RAG */}
              <motion.div
                whileHover={{ y: -4 }}
                className="flex flex-col items-center justify-center rounded-[24px] border border-white/40 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-xl p-6 shadow-xl relative overflow-hidden group"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-lime-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="h-12 w-12 rounded-full bg-lime-100/80 dark:bg-lime-500/20 text-lime-600 dark:text-lime-400 flex items-center justify-center mb-4 border border-lime-200/50 dark:border-lime-500/30">
                  <Upload size={22} strokeWidth={1.5} />
                </div>
                <h3 className="text-[15px] font-semibold text-slate-800 dark:text-slate-200 mb-1.5 text-center">Article-Aware RAG</h3>
                <p className="text-[13px] text-slate-500 dark:text-slate-400 text-center leading-relaxed">
                  {locale === "tr" ? "Vektör ve BM25 hibrit arama ile madde bazlı semantik analiz." : "Hybrid Vector + BM25 search with semantic legal chunking."}
                </p>
              </motion.div>

              {/* Step 3: Inference */}
              <motion.div
                whileHover={{ y: -4 }}
                className="flex flex-col items-center justify-center rounded-[24px] border border-white/40 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-xl p-6 shadow-xl relative overflow-hidden group"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="h-12 w-12 rounded-full bg-emerald-100/80 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-4 border border-emerald-200/50 dark:border-emerald-500/30">
                  <Cpu size={22} strokeWidth={1.5} />
                </div>
                <h3 className="text-[15px] font-semibold text-slate-800 dark:text-slate-200 mb-1.5 text-center">Fast CPU Inference</h3>
                <p className="text-[13px] text-slate-500 dark:text-slate-400 text-center leading-relaxed">
                  {locale === "tr" ? "ONNX ve INT8 kuantizasyon ile anında yerel çıkarım." : "ONNX + INT8 quantization for instantaneous local responses."}
                </p>
              </motion.div>
            </motion.div>

            <TypingAnimation
              as="h1"
              className="text-[32px] text-slate-800 dark:text-white font-medium mb-3 tracking-tight"
              duration={40}
              startOnView={true}
            >
              {t("chat.welcome", locale)}
            </TypingAnimation>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-[15px] text-muted-foreground mb-10 text-center max-w-md"
            >
              {documents.length === 0
                ? t("chat.welcome_empty", locale)
                : t("chat.welcome_loaded", locale)}
            </motion.p>

            {documents.length === 0 && (
              <motion.div
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2, ...spring }}
                className="mb-5 flex w-full max-w-[800px] flex-wrap justify-center gap-3"
              >
                <SuggestionButton
                  icon={<Upload size={14} />}
                  label={t("suggestion.upload", locale)}
                  onClick={openUploadPicker}
                />
                <SuggestionButton
                  icon={<Sparkles size={14} />}
                  label={t("suggestion.sample_pool", locale)}
                  onClick={openSamplePool}
                />
              </motion.div>
            )}
          </div>
        ) : (
          /* ── Messages List ────────────────────────────────── */
          <div
            ref={scrollRef}
            className="custom-scrollbar h-full min-h-0 overflow-y-auto overflow-x-hidden px-5 py-2 lg:px-8 z-10"
          >
            <div className="w-full space-y-6 pb-24">
              <AnimatePresence mode="popLayout">
                {messages.map((msg) => {
                  const hasSources = Boolean(msg.sources?.length);
                  const normalized = normalizeMarkdown(msg.content, hasSources);

                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={spring}
                      className={`flex w-full flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"}`}
                    >
                      <div className={`mb-1 flex items-center gap-2 px-1 ${msg.role === "user" ? "self-end" : "self-start"}`}>
                        {msg.role === "assistant" ? (
                          <>
                            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-emerald-100 dark:bg-primary/20 text-emerald-600 dark:text-primary">
                              <Sparkles className="size-3.5" strokeWidth={2} />
                            </div>
                            <span className="text-xs font-semibold text-slate-800 dark:text-white/90">FinGuard AI</span>
                          </>
                        ) : (
                          <>
                            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-white/60">
                              <User className="size-3.5" strokeWidth={2} />
                            </div>
                            <span className="text-xs font-semibold text-slate-800 dark:text-white/90">{t("chat.you", locale)}</span>
                          </>
                        )}
                      </div>

                      <div className={`flex w-full flex-col gap-3 ${messageWidthClass(msg.role)}`}>
                        {msg.role === "assistant" && msg.agentSteps && msg.agentSteps.length > 0 && (
                          <div className="w-full">
                            <PipelineVisualizer
                              steps={msg.agentSteps}
                              locale={locale}
                              isStreaming={Boolean(msg.isLoading)}
                              startedAt={msg.timestamp}
                            />
                          </div>
                        )}

                        {msg.isLoading && !msg.content && (!msg.agentSteps || msg.agentSteps.length === 0) && (
                          <div className="w-full opacity-60">
                            <PipelineVisualizer
                              steps={[]}
                              locale={locale}
                              isStreaming={true}
                              startedAt={msg.timestamp}
                            />
                          </div>
                        )}

                        {normalized && (
                          msg.role === "assistant" ? (
                            <div
                              className="w-full rounded-[24px] border border-slate-200/90 bg-white/88 px-5 py-4 text-[15px] leading-relaxed shadow-[0_20px_40px_-28px_rgba(15,23,42,0.25)] dark:border-white/[0.04] dark:bg-[#15131c]/82"
                            >
                              <div className="relative z-10 pointer-events-auto text-slate-700 dark:text-[#e2e2e2]">
                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={md}>
                                  {normalized}
                                </ReactMarkdown>
                              </div>
                            </div>
                          ) : (
                            <div
                              className="w-fit rounded-[24px] px-5 py-4 text-[15px] leading-relaxed shadow-sm bg-emerald-100 dark:bg-white/10 text-emerald-900 dark:text-white"
                            >
                              <p>{normalized}</p>
                            </div>
                          )
                        )}

                        {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                          <SourcePills sources={msg.sources} />
                        )}

                        {msg.role === "assistant" && normalized && !msg.isLoading && (
                          <div className="flex items-center gap-2 px-2">
                            {msg.guardrailPassed !== undefined && (
                              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
                                {msg.guardrailPassed ? (
                                  <>
                                    <CheckCircle2 className="size-3 text-emerald-500" strokeWidth={1.5} />
                                    {t("chat.compliance_ok", locale)}
                                  </>
                                ) : (
                                  <>
                                    <AlertTriangle className="size-3 text-amber-500" strokeWidth={1.5} />
                                    {t("chat.compliance_flag", locale)}
                                  </>
                                )}
                              </div>
                            )}
                            <button
                              onClick={() => speakingMsgId === msg.id ? stopSpeaking() : speakText(normalized, msg.id)}
                              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all ${speakingMsgId === msg.id
                                ? "border-emerald-500/20 bg-emerald-100 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/20 dark:text-emerald-300"
                                : "border-black/5 bg-white/70 text-slate-600 hover:bg-white hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                                }`}
                            >
                              <span className={`flex size-5 items-center justify-center rounded-full ${speakingMsgId === msg.id ? "bg-emerald-500/12" : "bg-slate-200/80 dark:bg-white/[0.08]"}`}>
                                {speakingMsgId === msg.id ? <VolumeX size={12} /> : <Volume2 size={12} />}
                              </span>
                              {speakingMsgId === msg.id ? (
                                t("voice.stop_response", locale)
                              ) : (
                                t("voice.play_response", locale)
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* ── Floating Input Area ────────────────────────── */}
      <div className="z-20 flex w-full shrink-0 px-5 pb-5 pt-2 lg:px-8">
        <div
          className="relative flex w-full flex-col rounded-[28px] border border-black/5 bg-white/78 px-4 py-3 shadow-xl shadow-black/5 ring-1 ring-white/50 backdrop-blur-xl transition-all dark:border-white/[0.08] dark:bg-[#15131c]/78 dark:ring-0 dark:shadow-2xl dark:shadow-black/40"
        >
          <div className="absolute right-3 top-3 flex items-center gap-2">
            <button
              onClick={() => {
                if (!canListen) return;
                if (isListening) {
                  stopListening();
                } else {
                  startListening((transcript) => {
                    setInput((prev) => (prev ? prev + " " : "") + transcript);
                    inputRef.current?.focus();
                  });
                }
              }}
              disabled={!canListen}
              className={`flex h-10 items-center gap-2 rounded-full border px-2.5 transition-all disabled:cursor-not-allowed disabled:opacity-60 ${isListening
                ? "border-emerald-500/50 bg-emerald-100 text-emerald-700 shadow-[0_0_18px_rgba(16,185,129,0.18)] dark:bg-emerald-500/20 dark:text-emerald-300"
                : "border-black/5 bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:border-white/[0.02] dark:bg-[#1e1c26] dark:text-[#a4a2ad] dark:hover:bg-white/10 dark:hover:text-white"
                }`}
            >
              <span className={`flex size-6 items-center justify-center rounded-full ${isListening ? "bg-emerald-500/15" : "bg-white/70 dark:bg-white/[0.06]"}`}>
                <Mic size={15} />
              </span>
              <span className="hidden min-w-0 flex-col items-start leading-none sm:flex">
                <span className="text-[11px] font-semibold">
                  {isListening ? t("voice.listening", locale) : t("voice.dictate", locale)}
                </span>
                <span className="mt-1 text-[10px] font-normal text-slate-500 dark:text-[#7d7b86]">
                  {canListen
                    ? (isListening ? t("voice.tap_to_stop", locale) : t("voice.tap_to_speak", locale))
                    : t("voice.not_supported", locale)}
                </span>
              </span>
            </button>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="flex size-10 items-center justify-center rounded-full bg-emerald-600 text-white shadow-[0_0_20px_rgba(16,185,129,0.25)] transition-all hover:bg-emerald-500 disabled:opacity-50 disabled:shadow-none active:scale-95"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp size={18} strokeWidth={2.5} />
              )}
            </button>
          </div>

          <div className="relative flex gap-3 pr-28 sm:pr-44">
            <Sparkles size={20} className="mt-1 shrink-0 text-emerald-500" strokeWidth={2} />
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder={t("chat.placeholder", locale)}
              className="custom-scrollbar min-h-[54px] w-full resize-none bg-transparent pt-0.5 text-[15px] font-normal text-slate-900 outline-none placeholder:text-slate-400 dark:text-[#e2e2e2] dark:placeholder:text-[#6b6975]"
              rows={1}
            />
          </div>

          <AnimatePresence initial={false}>
            {isListening && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="mt-3 flex items-center gap-2 rounded-2xl border border-emerald-500/15 bg-emerald-500/8 px-3 py-2 text-[11px] text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300"
              >
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-current opacity-75 animate-pulse" />
                  <span className="size-2 rounded-full bg-current opacity-55 animate-pulse [animation-delay:120ms]" />
                  <span className="size-2 rounded-full bg-current opacity-35 animate-pulse [animation-delay:240ms]" />
                </span>
                <span>{t("voice.live_hint", locale)}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
