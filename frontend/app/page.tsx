"use client";

import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "@/components/sidebar";
import { Chat } from "@/components/chat";
import { PdfViewerPanel } from "@/components/pdf-viewer-panel";
import { getDocuments, healthCheck, type DocumentInfo } from "@/lib/api";
import { isSamplePreviewDocument, type ViewerDocument } from "@/lib/sample-documents";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

export default function Dashboard() {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [isBackendOnline, setIsBackendOnline] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<ViewerDocument | null>(null);
  const { isMobileSidebarOpen, setMobileSidebarOpen } = useAppStore();

  useEffect(() => {
    let active = true;

    const refreshState = async () => {
      const online = await healthCheck();
      if (!active) return;
      setIsBackendOnline(online);

      if (!online) {
        setDocuments([]);
        return;
      }

      try {
        const docs = await getDocuments();
        if (active) {
          setDocuments(docs);
          setSelectedDocument((current) => {
            if (!current) return current;
            if (isSamplePreviewDocument(current)) {
              return docs.find((doc) => doc.filename === current.filename) ?? current;
            }
            const nextSelected = docs.find((doc) => doc.filename === current.filename);
            return nextSelected ?? null;
          });
        }
      } catch {
        if (active) setDocuments([]);
      }
    };

    const interval = setInterval(refreshState, 30_000);
    void refreshState();

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const handleDocumentsChange = () => {
    void (async () => {
      try {
        const docs = await getDocuments();
        setDocuments(docs);
        setSelectedDocument((current) => {
          if (!current) return current;
          if (isSamplePreviewDocument(current)) {
            return docs.find((doc) => doc.filename === current.filename) ?? current;
          }
          const nextSelected = docs.find((doc) => doc.filename === current.filename);
          return nextSelected ?? null;
        });
      } catch {
        setDocuments([]);
        setSelectedDocument(null);
      }
    })();
  };

  const sidebarContent = (
    <Sidebar
      documents={documents}
      onDocumentsChange={handleDocumentsChange}
      isBackendOnline={isBackendOnline}
      selectedDocumentFilename={selectedDocument?.filename ?? null}
      onSelectDocument={(document) => setSelectedDocument(document)}
    />
  );

  return (
    <main
      className={cn(
        "relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden font-sans transition-[padding] duration-500",
        selectedDocument ? "p-1.5 sm:p-2 md:p-3" : "p-2 sm:p-4 md:p-5",
      )}
    >
      <div
        className={cn(
          "relative flex min-h-0 w-full overflow-hidden rounded-[28px] border border-black/5 bg-background/58 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-background/60 dark:shadow-[0_20px_80px_rgba(0,0,0,0.6)]",
          selectedDocument
            ? "h-[calc(100dvh-0.75rem)] max-w-[1820px] sm:h-[calc(100dvh-1rem)] md:h-[calc(100dvh-1.5rem)]"
            : "h-[calc(100dvh-1rem)] max-w-[1480px] sm:h-[calc(100dvh-2rem)] md:h-[calc(100dvh-2.5rem)] md:max-h-[980px]",
        )}
      >
        <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.32),transparent_24%,rgba(147,197,253,0.08)_100%)] dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.06),transparent_28%,rgba(46,196,182,0.08)_100%)]" />

        {/* ── Mobile top bar ─────────────────────────────── */}
        <div className="absolute left-0 right-0 top-0 z-50 flex h-14 items-center border-b border-border bg-background/50 px-4 backdrop-blur-xl lg:hidden">
          <Sheet
            open={isMobileSidebarOpen}
            onOpenChange={setMobileSidebarOpen}
          >
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl text-muted-foreground hover:text-white"
              >
                <Menu className="size-5" strokeWidth={1.5} />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[340px] border-border bg-sidebar p-0">
              {sidebarContent}
            </SheetContent>
          </Sheet>
          <span className="ml-3 font-mono text-xs font-semibold tracking-wider text-foreground/90">
            FinGuard AI
          </span>
        </div>

        {/* ── Desktop sidebar ────────────────────────────── */}
        <AnimatePresence>
          <motion.aside
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className={cn(
              "hidden shrink-0 flex-col border-r border-white/[0.04] bg-sidebar/74 backdrop-blur-xl lg:flex",
              selectedDocument
                ? "w-[228px] xl:w-[248px] 2xl:w-[268px]"
                : "w-[248px] xl:w-[288px] 2xl:w-[320px]",
            )}
          >
            {sidebarContent}
          </motion.aside>
        </AnimatePresence>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white/8 pt-14 transition-colors duration-700 dark:bg-[#020916]/14 lg:pt-0">
          {/* Main Background with massive soft emerald glow */}
          <div
            className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_30%,rgba(16,185,129,0.06)_0%,transparent_70%)] dark:bg-[radial-gradient(circle_at_50%_30%,rgba(16,185,129,0.12)_0%,transparent_70%)] transition-all duration-700"
          />

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.08 }}
            className={cn(
              "relative z-10 flex min-h-0 min-w-0 flex-1 flex-col",
              selectedDocument ? "p-2.5 lg:p-3.5" : "p-3 lg:p-4",
            )}
          >
            {selectedDocument ? (
              <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(460px,0.98fr)_minmax(560px,1.02fr)] xl:grid-cols-[minmax(560px,1fr)_minmax(760px,1.08fr)] 2xl:grid-cols-[minmax(620px,1fr)_minmax(920px,1.12fr)]">
                <div className="min-h-0">
                  <PdfViewerPanel
                    document={selectedDocument}
                    onClose={() => setSelectedDocument(null)}
                  />
                </div>
                <div className="min-h-0 overflow-hidden rounded-[28px] border border-black/5 bg-white/10 dark:border-white/[0.04] dark:bg-[#020916]/10">
                  <Chat documents={documents} />
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-hidden rounded-[28px] border border-black/5 bg-white/10 dark:border-white/[0.04] dark:bg-[#020916]/10">
                <Chat documents={documents} />
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </main>
  );
}
