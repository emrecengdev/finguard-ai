"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Upload,
  Trash2,
  Loader2,
  CloudUpload,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Plus,
  BookOpen,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { uploadPdf, deleteDocument, type DocumentInfo } from "@/lib/api";
import { extractPdfTextWithScribe } from "@/lib/ocr";
import { t } from "@/lib/i18n";
import { SAMPLE_DOCS } from "@/lib/sample-documents";
import { useAppStore } from "@/store/useAppStore";
import { ShinyButton } from "@/components/ui/shiny-button";
import { ShineBorder } from "@/components/ui/shine-border";

interface SidebarProps {
  documents: DocumentInfo[];
  onDocumentsChange: () => void;
  isBackendOnline: boolean;
  selectedDocumentFilename: string | null;
  onSelectDocument: (document: DocumentInfo) => void;
}

const spring = { type: "spring" as const, stiffness: 320, damping: 28 };

export function Sidebar({
  documents,
  onDocumentsChange,
  isBackendOnline,
  selectedDocumentFilename,
  onSelectDocument,
}: SidebarProps) {
  const locale = useAppStore((s) => s.locale);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState(t("upload.processing", locale));
  const [poolOpen, setPoolOpen] = useState(true);
  const [addingFromPool, setAddingFromPool] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadZoneRef = useRef<HTMLDivElement>(null);
  const samplePoolRef = useRef<HTMLDivElement>(null);

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setUploadError(t("upload.only_pdf", locale));
        return;
      }

      setIsUploading(true);
      setUploadError(null);
      setUploadSuccess(null);
      setUploadStatus(t("upload.extracting", locale));

      try {
        try {
          const result = await uploadPdf(file);
          setUploadSuccess(
            `${result.filename} — ${result.pages} ${t("kb.pages", locale)}, ${result.chunks} ${t("kb.chunks_label", locale)}`
          );
          onDocumentsChange();
        } catch (nativeErr) {
          const msg =
            nativeErr instanceof Error ? nativeErr.message : t("upload.failed", locale);
          if (!msg.toLowerCase().includes("no extractable text found"))
            throw nativeErr;

          setUploadStatus(t("upload.ocr_detected", locale));
          const ocrResult = await extractPdfTextWithScribe(file);
          setUploadStatus(t("upload.ocr_complete", locale));
          const result = await uploadPdf(file, {
            ocrPages: ocrResult.pages,
            ocrEngine: ocrResult.engine,
          });
          setUploadSuccess(
            `${result.filename} — ${result.pages} ${t("kb.pages", locale)}, ${result.chunks} ${t("kb.chunks_label", locale)}`
          );
          onDocumentsChange();
        }
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : t("upload.failed", locale)
        );
      } finally {
        setIsUploading(false);
        setUploadStatus(t("upload.processing", locale));
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [onDocumentsChange, locale]
  );

  const handleDelete = useCallback(
    async (filename: string) => {
      setDeletingFile(filename);
      try {
        await deleteDocument(filename);
        onDocumentsChange();
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : t("upload.delete_failed", locale)
        );
      } finally {
        setDeletingFile(null);
      }
    },
    [onDocumentsChange, locale]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (!isBackendOnline) return;
      handleUpload(e.dataTransfer.files);
    },
    [handleUpload, isBackendOnline]
  );

  const openUploadPicker = useCallback(() => {
    if (!isBackendOnline) return;
    fileInputRef.current?.click();
  }, [isBackendOnline]);

  useEffect(() => {
    const handleUploadIntent = () => {
      uploadZoneRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      openUploadPicker();
    };

    const handleSamplePoolIntent = () => {
      setPoolOpen(true);
      samplePoolRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    };

    window.addEventListener("finguard:open-upload", handleUploadIntent);
    window.addEventListener("finguard:open-sample-pool", handleSamplePoolIntent);

    return () => {
      window.removeEventListener("finguard:open-upload", handleUploadIntent);
      window.removeEventListener("finguard:open-sample-pool", handleSamplePoolIntent);
    };
  }, [openUploadPicker]);

  return (
    <div className="flex h-full flex-col px-4 py-6">

      {/* ── Logo & Mobile Toggle ───────────────────────────── */}
      <div className="flex items-center justify-between px-2 mb-8 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex size-[26px] items-center justify-center rounded-full bg-slate-200 dark:bg-[#1e1c26] text-slate-800 dark:text-[#f3f3f4]">
            <Sparkles size={14} fill="currentColor" />
          </div>
          <span className="font-medium text-[17px] tracking-wide text-slate-900 dark:text-[#f3f3f4]">
            FinGuard AI
          </span>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${
          isBackendOnline
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
        }`}>
          {isBackendOnline ? t("status.online", locale) : t("status.offline", locale)}
        </span>
      </div>

      {/* ── New Chat Button ──────────────────────────────── */}
      <ShinyButton
        className="mb-8 w-full shrink-0 !px-4 !py-3 rounded-xl bg-white/60 dark:bg-[#0f172a] hover:bg-white dark:hover:bg-[#1e293b]"
        onClick={() => window.location.reload()}
      >
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-3">
            <Plus size={16} className="text-slate-500 dark:text-[#a19fad]" />
            <span className="capitalize">New Chat</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400 dark:text-[#6b6975] bg-slate-100 dark:bg-[#121117] px-2 py-0.5 rounded-md border border-black/5 dark:border-white/[0.02]">⌘N</span>
        </div>
      </ShinyButton>

      {/* ── Fixed Upload Action ─────────────────────────── */}
      <div className="mb-4 shrink-0 px-1">
        <motion.div
          ref={uploadZoneRef}
          onDragOver={(e) => {
            e.preventDefault();
            if (!isBackendOnline) return;
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          whileTap={{ scale: 0.985 }}
          className={`group relative flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[14px] p-3.5 text-center transition-all duration-200 ${isDragOver
            ? "bg-emerald-500/10 dark:bg-primary/10"
            : "bg-white/60 hover:bg-white dark:bg-[#0f172a]/50 dark:hover:bg-[#0f172a]"
            }`}
          onClick={() => {
            if (!isBackendOnline) return;
            openUploadPicker();
          }}
        >
          <ShineBorder
            className="pointer-events-none opacity-50 transition-opacity duration-300 group-hover:opacity-100"
            shineColor={["#10b981", "#3b82f6", "#0ea5e9"]}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />

          {isUploading ? (
            <div className="flex flex-col items-center gap-1.5 py-0.5">
              <Loader2 className="size-4.5 animate-spin text-emerald-500 dark:text-primary" />
              <span className="text-[10px] font-medium text-slate-500 dark:text-[#8e8c95]">{uploadStatus}</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 py-0.5">
              <div className={`flex size-7 items-center justify-center rounded-lg transition-colors ${isDragOver ? "bg-emerald-100 text-emerald-600 dark:bg-primary/20 dark:text-primary" : "bg-slate-100 text-slate-400 group-hover:text-slate-600 dark:bg-[#1e293b] dark:text-slate-400 dark:group-hover:text-slate-200"}`}>
                {isDragOver ? <CloudUpload size={15} /> : <Upload size={15} />}
              </div>
              <span className="text-[11px] font-medium text-slate-700 dark:text-[#d1d0d5]">
                {isBackendOnline ? t("upload.title", locale) : t("status.offline", locale)}
              </span>
              <span className="text-[9px] text-slate-400 dark:text-[#6b6975]">
                {isBackendOnline
                  ? t("upload.hint", locale)
                  : "Backend unavailable. Upload actions are paused."}
              </span>
            </div>
          )}
        </motion.div>

        <AnimatePresence>
          {uploadError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-400"
            >
              <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={1.5} />
              <span>{uploadError}</span>
            </motion.div>
          )}
          {uploadSuccess && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-400"
            >
              <CheckCircle2 className="mt-px size-3.5 shrink-0" strokeWidth={1.5} />
              <span>{uploadSuccess}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Scrollable Document List & Samples ────────────── */}
      <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-1 pb-4">

        {/* Knowledge Base Section */}
        <div>
          <h3 className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-[#6b6975]">
            {t("kb.title", locale)}
          </h3>

          <div className="space-y-1">
            <AnimatePresence initial={false}>
              {documents.map((doc) => (
                <motion.div
                  key={doc.filename}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={spring}
                  className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-[10px] px-3 py-2.5 text-[13px] font-medium transition-colors ${
                    selectedDocumentFilename === doc.filename
                      ? "bg-sky-500/10 text-slate-900 ring-1 ring-sky-300/40 dark:bg-sky-400/10 dark:text-[#f1f5f9] dark:ring-sky-400/18"
                      : "bg-transparent text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-[#94a3b8] dark:hover:bg-[#1e293b] dark:hover:text-[#f1f5f9]"
                  }`}
                  onClick={() => onSelectDocument(doc)}
                >
                  <FileText
                    className={`size-4 shrink-0 ${
                      selectedDocumentFilename === doc.filename
                        ? "text-sky-600 dark:text-sky-300"
                        : "text-slate-400 group-hover:text-emerald-600 dark:text-[#6b6975] dark:group-hover:text-primary"
                    }`}
                    strokeWidth={1.5}
                  />

                  <div className="flex min-w-0 flex-1 flex-col truncate">
                    <span className="truncate text-slate-700 dark:text-[#d1d0d5]" title={doc.filename}>
                      {doc.filename}
                    </span>
                    <span className="text-[10px] font-mono font-medium tracking-wide text-slate-400 dark:text-[#6b6975]">
                      {doc.pages}p • {doc.chunks}c
                    </span>
                  </div>

                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={deletingFile === doc.filename}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDelete(doc.filename);
                        }}
                        className="size-7 shrink-0 rounded-lg text-slate-400 dark:text-[#6b6975] opacity-0 transition-all hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 group-hover:opacity-100 disabled:opacity-50"
                      >
                        {deletingFile === doc.filename ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" strokeWidth={1.5} />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="border-black/5 dark:border-white/[0.05] bg-white dark:bg-[#121117] text-slate-800 dark:text-white">
                      {t("kb.remove", locale)}
                    </TooltipContent>
                  </Tooltip>
                </motion.div>
              ))}
            </AnimatePresence>

          </div>
        </div>

        {/* ── Sample Document Pool ─────────────────────── */}
        {(() => {
          const loadedNames = new Set(documents.map((d) => d.filename));
          const available = SAMPLE_DOCS.filter((s) => !loadedNames.has(s.file));
          if (available.length === 0) return null;

          return (
            <div ref={samplePoolRef} className="shrink-0">
            <button
              onClick={() => setPoolOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-[#6b6975] hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <BookOpen size={12} />
                {t("pool.title", locale)}
              </div>
              <ChevronDown size={12} className={`transition-transform duration-200 ${poolOpen ? "rotate-180" : ""}`} />
            </button>

            <AnimatePresence initial={false}>
              {poolOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={spring}
                  className="overflow-hidden"
                >
                  <div className="space-y-1 pb-2">
                    {available.map((sample) => (
                      <div
                        key={sample.id}
                        className="flex items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-[12px] bg-transparent hover:bg-white/60 dark:hover:bg-[#1e293b] transition-colors"
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="font-medium text-slate-700 dark:text-[#d1d0d5] truncate">{sample.name}</span>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-slate-400 dark:text-[#6b6975]">
                            <span className="truncate">{sample.desc}</span>
                            <span className="size-1 rounded-full bg-slate-300 dark:bg-slate-700" />
                            <span>{sample.pages} sayfa</span>
                            {sample.tone === "summary" ? (
                              <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-600 dark:bg-amber-400/10 dark:text-amber-300">
                                Ozet
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={addingFromPool === sample.id || !isBackendOnline}
                          onClick={async () => {
                            setAddingFromPool(sample.id);
                            try {
                              const res = await fetch(`/samples/${sample.file}`);
                              const blob = await res.blob();
                              const file = new File([blob], sample.file, { type: "application/pdf" });
                              await uploadPdf(file);
                              onDocumentsChange();
                            } catch (err) {
                              setUploadError(
                                err instanceof Error ? err.message : t("upload.failed", locale)
                              );
                            } finally {
                              setAddingFromPool(null);
                            }
                          }}
                          className="shrink-0 h-7 px-3 text-[11px] font-medium rounded-lg text-emerald-600 dark:text-primary hover:bg-emerald-500/10 dark:hover:bg-primary/10"
                        >
                          {addingFromPool === sample.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            t("pool.add", locale)
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            </div>
          );
        })()}
      </div>

      {/* ── Compact Metrics ─────────────────────────────── */}
      <div className="mt-3 shrink-0 rounded-2xl border border-black/5 dark:border-white/[0.04] bg-white/60 dark:bg-[#0f172a] p-4">
        <div className="flex gap-4 text-slate-500 dark:text-[#7d7b86]">
          <div className="flex flex-col">
            <span className="text-[18px] font-semibold text-slate-900 dark:text-white">{documents.length}</span>
            <span className="text-[10px] uppercase tracking-wider">{t("metrics.documents", locale)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[18px] font-semibold text-slate-900 dark:text-white">
              {documents.reduce((sum, d) => sum + d.chunks, 0).toLocaleString()}
            </span>
            <span className="text-[10px] uppercase tracking-wider">{t("metrics.chunks", locale)}</span>
          </div>
        </div>
      </div>

    </div>
  );
}
