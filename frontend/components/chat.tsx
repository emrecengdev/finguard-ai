"use client";

import type { ComponentPropsWithoutRef } from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import {
  Send,
  Loader2,
  Bot,
  User,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Settings,
  Share,
  ImagePlus,
  Lightbulb,
  FileText,
  Sparkles,
  Paperclip,
  SlidersHorizontal,
  LayoutGrid,
  Mic,
  ArrowUp,
} from "lucide-react";
import { PipelineVisualizer } from "@/components/PipelineVisualizer";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  streamMessage,
  type AgentStep,
  type ChatSource,
} from "@/lib/api";
import { t, type TranslationKey } from "@/lib/i18n";
import { useAppStore } from "@/store/useAppStore";

// ─── Types ──────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  agentSteps?: AgentStep[];
  sources?: ChatSource[];
  guardrailPassed?: boolean;
  isLoading?: boolean;
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

const SUGGESTION_KEYS: TranslationKey[] = [
  "suggestion.1",
  "suggestion.2",
  "suggestion.3",
  "suggestion.4",
];

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

// ─── Sub-components ─────────────────────────────────────────────

function SourcePills({ sources }: { sources: ChatSource[] }) {
  const groups = buildSourceGroups(sources);
  if (!groups.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-2">
      {groups.map((g) => (
        <span
          key={g.source}
          className="inline-flex items-center gap-1 rounded-lg border border-white/[0.05] bg-background/50 px-2 py-1 font-mono text-[10px] text-muted-foreground shadow-sm"
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
    <button
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-2 rounded-full border border-black/5 dark:border-white/[0.04] bg-white/80 dark:bg-[#121117] px-4 py-2.5 text-[13px] font-medium text-slate-700 dark:text-[#d1d0d5] shadow-sm transition-colors hover:bg-slate-50 dark:hover:bg-[#1a1822] active:scale-[0.98]"
    >
      <span className="text-[#8e8c95]">{icon}</span>
      <span className="line-clamp-1">{label}</span>
    </button>
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
    <h3 className="mb-1.5 text-sm font-semibold text-white/80" {...p}>{children}</h3>
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
    <strong className="font-semibold text-white" {...p}>{children}</strong>
  ),
  code: ({ children, className, ...p }: ComponentPropsWithoutRef<"code"> & { inline?: boolean }) => {
    if (!className?.includes("language-"))
      return <code className="rounded-md border border-white/[0.05] bg-black/30 px-1.5 py-0.5 font-mono text-xs text-white/80" {...p}>{children}</code>;
    return <code className="block overflow-x-auto rounded-xl border border-white/[0.05] bg-black/50 p-3 font-mono text-xs text-zinc-300" {...p}>{children}</code>;
  },
  a: ({ href, children, ...p }: ComponentPropsWithoutRef<"a">) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline decoration-primary/50 underline-offset-2 transition-colors hover:text-primary/80" {...p}>{children}</a>
  ),
  blockquote: ({ children, ...p }: ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote className="mb-2 rounded-r-lg border-l-2 border-primary/40 bg-primary/10 px-3 py-2 text-white/70" {...p}>{children}</blockquote>
  ),
  table: ({ children, ...p }: ComponentPropsWithoutRef<"table">) => (
    <div className="mb-3 overflow-x-auto rounded-lg border border-white/[0.05]"><table className="min-w-full border-collapse text-xs" {...p}>{children}</table></div>
  ),
  thead: ({ children, ...p }: ComponentPropsWithoutRef<"thead">) => (
    <thead className="bg-black/30 text-white/60" {...p}>{children}</thead>
  ),
  tbody: ({ children, ...p }: ComponentPropsWithoutRef<"tbody">) => <tbody {...p}>{children}</tbody>,
  tr: ({ children, ...p }: ComponentPropsWithoutRef<"tr">) => (
    <tr className="border-t border-white/[0.05]" {...p}>{children}</tr>
  ),
  th: ({ children, ...p }: ComponentPropsWithoutRef<"th">) => (
    <th className="px-2.5 py-1.5 text-left font-semibold" {...p}>{children}</th>
  ),
  td: ({ children, ...p }: ComponentPropsWithoutRef<"td">) => (
    <td className="px-2.5 py-1.5 align-top" {...p}>{children}</td>
  ),
};

// ─── Main Chat ──────────────────────────────────────────────────

export function Chat() {
  const locale = useAppStore((s) => s.locale);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
        (step) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstId
                ? { ...m, agentSteps: [...(m.agentSteps || []), step] }
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
    <div className="flex h-full min-h-0 flex-1 flex-col relative w-full">

      {/* ── Top Bar ──────────────────────────────────────── */}
      <div className="flex items-center justify-between p-6 z-50 relative pointer-events-auto w-full shrink-0">
        <button className="flex items-center gap-2 rounded-full border border-black/5 dark:border-white/[0.04] bg-white/80 dark:bg-[#121117] px-4 py-2 text-[13px] font-medium text-slate-700 dark:text-[#d1d0d5] shadow-sm transition-colors hover:bg-slate-50 dark:hover:bg-[#1a1822]">
          <span>FinGuard AI</span>
          <ChevronDown size={14} className="text-slate-400 dark:text-[#6b6975]" />
        </button>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <LanguageSwitcher />
          <button className="flex items-center gap-2 rounded-full border border-black/5 dark:border-white/[0.04] bg-white/80 dark:bg-[#121117] px-4 py-2 text-[13px] font-medium text-slate-700 dark:text-[#d1d0d5] shadow-sm transition-colors hover:bg-slate-50 dark:hover:bg-[#1a1822]">
            <span>Export</span>
            <Share size={14} className="text-slate-400 dark:text-[#6b6975]" />
          </button>
        </div>
      </div>

      {messages.length === 0 ? (
        /* ── Empty State Hero ────────────────────────────── */
        <div className="flex-1 flex flex-col items-center justify-center px-8 z-10 -mt-20">
          {/* Sleek Data Core / Financial Orb */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
            className="mb-8 relative w-[76px] h-[76px]"
          >
            {/* Dark Mode Orb */}
            <div
              className="absolute inset-0 rounded-full hidden dark:block"
              style={{
                background: 'radial-gradient(circle at 35% 35%, #34d399 0%, #059669 25%, #064e3b 60%, #022c22 100%)',
                boxShadow: 'inset -8px -8px 20px rgba(0,0,0,0.8), inset 8px 8px 20px rgba(255,255,255,0.3), 0 0 40px rgba(16, 185, 129, 0.3)'
              }}
            />
            {/* Light Mode Orb */}
            <div
              className="absolute inset-0 rounded-full dark:hidden"
              style={{
                background: 'radial-gradient(circle at 35% 35%, #ffffff 0%, #d1fae5 25%, #34d399 60%, #059669 100%)',
                boxShadow: 'inset -8px -8px 20px rgba(16, 185, 129, 0.2), inset 8px 8px 20px rgba(255,255,255,0.9), 0 0 40px rgba(52, 211, 153, 0.4)'
              }}
            />
            {/* Specular Highlight */}
            <div
              className="absolute rounded-full"
              style={{
                top: '12%', left: '22%', width: '35%', height: '20%',
                background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 70%)',
                transform: 'rotate(-45deg)'
              }}
            />
          </motion.div>

          <motion.h1
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1, ...spring }}
            className="text-[32px] text-slate-800 dark:text-white font-medium mb-10 tracking-tight"
          >
            {t("chat.welcome", locale)}
          </motion.h1>

          {/* Prompt Suggestions */}
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2, ...spring }}
            className="flex w-full max-w-[800px] gap-3 mb-5 flex-wrap justify-center"
          >
            {[
              { icon: <ImagePlus size={14} />, key: SUGGESTION_KEYS[0] },
              { icon: <Lightbulb size={14} />, key: SUGGESTION_KEYS[1] },
              { icon: <FileText size={14} />, key: SUGGESTION_KEYS[2] },
            ].map((s, i) => (
              <SuggestionButton
                key={i}
                icon={s.icon}
                label={t(s.key, locale)}
                onClick={() => {
                  setInput(t(s.key, locale));
                  inputRef.current?.focus();
                }}
              />
            ))}
          </motion.div>
        </div>
      ) : (
        /* ── Messages List ────────────────────────────────── */
        <div
          ref={scrollRef}
          className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-2 lg:px-8 z-10"
        >
          <div className="mx-auto w-full max-w-4xl space-y-6 pb-6">
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
                    className={`flex flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"}`}
                  >
                    <div className="flex items-center gap-2 px-1 mb-1">
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
                          <span className="text-xs font-semibold text-slate-800 dark:text-white/90">{t("chat.label", locale)}</span>
                        </>
                      )}
                    </div>

                    <div className={`flex w-full max-w-[90%] flex-col gap-3 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                      {msg.role === "assistant" && msg.agentSteps && msg.agentSteps.length > 0 && (
                        <div className="w-full">
                          <PipelineVisualizer steps={msg.agentSteps} locale={locale} />
                        </div>
                      )}

                      {msg.isLoading && !msg.content && (!msg.agentSteps || msg.agentSteps.length === 0) && (
                        <div className="w-full opacity-60">
                          <PipelineVisualizer steps={[]} locale={locale} />
                        </div>
                      )}

                      {normalized && (
                        <div
                          className={`w-fit rounded-[24px] px-5 py-4 text-[15px] leading-relaxed shadow-sm ${msg.role === "user"
                            ? "bg-emerald-100 dark:bg-white/10 text-emerald-900 dark:text-white"
                            : "bg-white/80 dark:bg-[#15131c]/80 text-slate-800 dark:text-[#e2e2e2] border border-black/5 dark:border-white/[0.04]"
                            }`}
                        >
                          {msg.role === "assistant" ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={md}>
                              {normalized}
                            </ReactMarkdown>
                          ) : (
                            <p>{normalized}</p>
                          )}
                        </div>
                      )}

                      {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                        <SourcePills sources={msg.sources} />
                      )}

                      {msg.role === "assistant" && normalized && !msg.isLoading && msg.guardrailPassed !== undefined && (
                        <div className="flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground/60">
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
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* ── Floating Input Area ────────────────────────── */}
      <div className="flex w-full justify-center px-4 pb-6 pt-2 z-20">
        <div
          className="flex w-full max-w-[800px] flex-col relative transition-all rounded-[32px] p-4 bg-white/70 dark:bg-[#15131c]/65 backdrop-blur-xl border border-black/5 dark:border-white/[0.08] shadow-xl shadow-black/5 dark:shadow-2xl dark:shadow-black/40 ring-1 ring-white/50 dark:ring-0"
        >
          <div className="flex gap-3 px-2 pt-2 pb-14 relative">
            <Sparkles size={22} className="text-emerald-500 shrink-0 mt-0.5" strokeWidth={2} />
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder={t("chat.placeholder", locale)}
              className="w-full bg-transparent text-slate-900 dark:text-[#e2e2e2] placeholder:text-slate-400 dark:placeholder:text-[#6b6975] resize-none outline-none text-[16px] font-normal custom-scrollbar"
              rows={2}
            />
          </div>

          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pt-3 border-t border-black/5 dark:border-white/[0.05]">
            <div className="flex items-center gap-5 px-2 text-[13px] text-[#8e8c95] max-sm:hidden">
              <button className="flex items-center gap-2 transition-colors hover:text-white">
                <Paperclip size={16} />
                <span>Attach</span>
              </button>
              <button className="flex items-center gap-2 transition-colors hover:text-white">
                <SlidersHorizontal size={16} />
                <span>Settings</span>
              </button>
              <button className="flex items-center gap-2 transition-colors hover:text-white">
                <LayoutGrid size={16} />
                <span>Options</span>
              </button>
            </div>

            <div className="flex items-center justify-end w-full sm:w-auto gap-3">
              <button className="flex size-9 items-center justify-center rounded-full border border-black/5 dark:border-white/[0.02] bg-slate-100 dark:bg-[#1e1c26] text-slate-500 dark:text-[#8e8c95] transition-colors hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-800 dark:hover:text-white">
                <Mic size={16} />
              </button>
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="flex size-9 items-center justify-center rounded-full bg-emerald-600 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all hover:bg-emerald-500 disabled:opacity-50 disabled:shadow-none active:scale-95"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowUp size={18} strokeWidth={2.5} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
