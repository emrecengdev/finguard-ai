"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Upload,
  Trash2,
  Loader2,
  CloudUpload,
  CircleDot,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Menu,
  Plus,
  Crown,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { uploadPdf, deleteDocument, type DocumentInfo } from "@/lib/api";
import { extractPdfTextWithScribe } from "@/lib/ocr";
import { t } from "@/lib/i18n";
import { useAppStore } from "@/store/useAppStore";

interface SidebarProps {
  documents: DocumentInfo[];
  onDocumentsChange: () => void;
  isBackendOnline: boolean;
}

const spring = { type: "spring" as const, stiffness: 320, damping: 28 };

export function Sidebar({
  documents,
  onDocumentsChange,
  isBackendOnline,
}: SidebarProps) {
  const locale = useAppStore((s) => s.locale);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState(t("upload.processing", locale));
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      handleUpload(e.dataTransfer.files);
    },
    [handleUpload]
  );

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
        <button className="text-slate-400 dark:text-[#8e8c95] transition-colors hover:text-slate-800 dark:hover:text-white lg:hidden">
          <Menu size={18} />
        </button>
      </div>

      {/* ── New Chat Button ──────────────────────────────── */}
      <button
        className="mb-8 flex w-full shrink-0 items-center justify-between gap-3 rounded-xl border border-black/5 dark:border-white/[0.02] bg-white/60 dark:bg-[#0f172a] p-3 text-[14px] font-medium text-slate-700 dark:text-[#e0e0e0] transition-colors hover:bg-white dark:hover:bg-[#1e293b]"
        onClick={() => window.location.reload()}
      >
        <div className="flex items-center gap-3">
          <Plus size={16} className="text-slate-500 dark:text-[#a19fad]" />
          <span>New Chat</span>
        </div>
        <span className="text-[10px] font-mono text-slate-400 dark:text-[#6b6975] bg-slate-100 dark:bg-[#121117] px-2 py-0.5 rounded-md border border-black/5 dark:border-white/[0.02]">⌘N</span>
      </button>

      {/* ── Scrollable Document List & Upload ─────────────── */}
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
                  className="group relative flex w-full items-center gap-3 overflow-hidden rounded-[10px] bg-transparent px-3 py-2.5 text-[13px] font-medium text-slate-600 dark:text-[#94a3b8] transition-colors hover:bg-white/60 dark:hover:bg-[#1e293b] hover:text-slate-900 dark:hover:text-[#f1f5f9]"
                >
                  <FileText className="size-4 shrink-0 text-slate-400 dark:text-[#6b6975] group-hover:text-emerald-600 dark:group-hover:text-primary" strokeWidth={1.5} />

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
                        onClick={() => handleDelete(doc.filename)}
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

            {/* Upload Zone */}
            <motion.div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              whileTap={{ scale: 0.98 }}
              className={`group relative mt-2 flex w-full cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-[12px] border border-dashed p-4 text-center transition-all duration-200 ${isDragOver
                ? "border-emerald-500/50 bg-emerald-500/10 dark:border-primary/50 dark:bg-primary/10"
                : "border-black/5 bg-white/60 hover:border-emerald-500/30 hover:bg-white dark:border-white/[0.1] dark:bg-[#0f172a]/50 dark:hover:border-primary/30 dark:hover:bg-[#0f172a]"
                }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => handleUpload(e.target.files)}
              />

              {isUploading ? (
                <div className="flex flex-col items-center gap-2 py-1">
                  <Loader2 className="size-5 animate-spin text-emerald-500 dark:text-primary" />
                  <span className="text-[11px] font-medium text-slate-500 dark:text-[#8e8c95]">{uploadStatus}</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5 py-1">
                  <div className={`flex size-8 items-center justify-center rounded-lg transition-colors ${isDragOver ? 'bg-emerald-100 text-emerald-600 dark:bg-primary/20 dark:text-primary' : 'bg-slate-100 text-slate-400 group-hover:text-slate-600 dark:bg-[#1e293b] dark:text-slate-400 dark:group-hover:text-slate-200'}`}>
                    {isDragOver ? <CloudUpload size={16} /> : <Upload size={16} />}
                  </div>
                  <span className="text-[12px] font-medium text-slate-700 dark:text-[#d1d0d5]">
                    {t("upload.title", locale)}
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-[#6b6975]">
                    {t("upload.hint", locale)}
                  </span>
                </div>
              )}
            </motion.div>

            {/* Feedback Alerts */}
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
        </div>
      </div>

      {/* ── Premium-style Status Card ────────────────────── */}
      <div className="mt-4 shrink-0 rounded-2xl border border-black/5 dark:border-white/[0.04] bg-white/60 dark:bg-[#0f172a] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex size-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-[#1e293b] dark:text-white">
            <Crown size={14} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500 dark:text-[#7d7b86]">
              {isBackendOnline ? t("status.online", locale) : t("status.offline", locale)}
            </span>
            <CircleDot
              className={`size-3.5 ${isBackendOnline ? "animate-breathe text-emerald-500" : "text-rose-500"
                }`}
              strokeWidth={2.5}
            />
          </div>
        </div>

        <h4 className="mb-1.5 text-[13px] font-medium text-slate-800 dark:text-[#f0f0f0]">Platform Analytics</h4>

        <div className="mb-4 flex gap-4 text-slate-500 dark:text-[#7d7b86]">
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

        <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-black/5 dark:border-white/[0.02] bg-slate-100 dark:bg-[#1e293b] py-2 text-[12px] font-medium text-slate-600 dark:text-slate-200 transition-colors hover:bg-slate-200 dark:hover:bg-[#334155]">
          <Database size={13} className="text-slate-400 dark:text-slate-400" />
          <span>Manage Instances</span>
        </button>
      </div>

    </div>
  );
}
