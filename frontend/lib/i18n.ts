/**
 * FinGuard AI — Lightweight i18n
 * Turkish (default) + English
 */

export type Locale = "tr" | "en";

const translations = {
    // ─── Brand ────────────────────────────────────────
    "brand.name": { tr: "FinGuard AI", en: "FinGuard AI" },
    "brand.tagline": { tr: "Belge Zekası Merkezi", en: "Document Intelligence" },
    "brand.version": { tr: "v2", en: "v2" },

    // ─── Status ───────────────────────────────────────
    "status.online": { tr: "Bağlı", en: "Online" },
    "status.offline": { tr: "Bağlantı Yok", en: "Offline" },

    // ─── Metrics ──────────────────────────────────────
    "metrics.documents": { tr: "Belge", en: "Documents" },
    "metrics.chunks": { tr: "Parça", en: "Chunks" },

    // ─── Upload ───────────────────────────────────────
    "upload.title": { tr: "PDF yükleyin veya tıklayın", en: "Drop PDF or click to upload" },
    "upload.hint": { tr: "Taranmış dosyalar otomatik OCR'den geçer", en: "Scanned files trigger OCR automatically" },
    "upload.extracting": { tr: "PDF'den metin çıkarılıyor...", en: "Extracting text from PDF..." },
    "upload.ocr_detected": { tr: "Taranmış PDF algılandı. OCR çalışıyor...", en: "Scanned PDF detected. Running OCR..." },
    "upload.ocr_complete": { tr: "OCR tamamlandı. Yükleniyor...", en: "OCR complete. Uploading..." },
    "upload.processing": { tr: "PDF işleniyor...", en: "Processing PDF..." },
    "upload.only_pdf": { tr: "Yalnızca PDF dosyaları kabul edilir.", en: "Only PDF files are accepted." },
    "upload.failed": { tr: "Yükleme başarısız", en: "Upload failed" },
    "upload.delete_failed": { tr: "Silme başarısız", en: "Delete failed" },

    // ─── Knowledge Base ───────────────────────────────
    "kb.title": { tr: "Bilgi Tabanı", en: "Knowledge Base" },
    "kb.empty_title": { tr: "Henüz belge yok", en: "No documents yet" },
    "kb.empty_desc": { tr: "Bağlam oluşturmak için PDF yükleyin", en: "Upload PDFs to build your retrieval context" },
    "kb.remove": { tr: "Belgeyi kaldır", en: "Remove document" },
    "kb.pages": { tr: "sf.", en: "pg" },
    "kb.chunks_label": { tr: "parça", en: "chunks" },

    // ─── Chat ─────────────────────────────────────────
    "chat.header": { tr: "Akıllı Sohbet", en: "Agentic Chat" },
    "chat.badge": { tr: "Çoklu-Ajan Hattı", en: "Multi-Agent Pipeline" },
    "chat.label": { tr: "Uyum Asistanı", en: "Compliance Copilot" },
    "chat.you": { tr: "Siz", en: "You" },
    "chat.welcome": {
        tr: "FinGuard AI'ya hoş geldiniz",
        en: "Welcome to FinGuard AI",
    },
    "chat.welcome_empty": {
        tr: "Başlamak için sol panelden bir PDF belgesi yükleyin veya örnek belgelerden birini ekleyin.",
        en: "Upload a PDF from the sidebar or add a sample document to get started.",
    },
    "chat.welcome_loaded": {
        tr: "Yüklü belgeleriniz hakkında sorular sorun.",
        en: "Ask questions about your loaded documents.",
    },
    "chat.welcome_desc": {
        tr: "Sorularınız Yönlendirici, Bilgi, Araç ve Güvence ajanlarından geçerek kaynaklı yanıt döner.",
        en: "Each query runs through Router, Knowledge, Tooling, and Guardrail agents before returning a cited answer.",
    },
    "chat.placeholder": {
        tr: "İş kanunu, İK uyumu veya bankacılık mevzuatı hakkında sorun...",
        en: "Ask about labor law, HR compliance, or banking regulation...",
    },
    "chat.disclaimer": {
        tr: "FinGuard AI hatalı bilgi üretebilir. Uyuma dair kritik çıktıları hukuk danışmanınızla doğrulayın.",
        en: "FinGuard AI may produce inaccurate information. Validate compliance-critical outputs with legal counsel.",
    },
    "chat.composing": { tr: "Yanıt oluşturuluyor...", en: "Composing response..." },
    "chat.compliance_ok": { tr: "Uyum doğrulandı", en: "Compliance verified" },
    "chat.compliance_flag": { tr: "Uyum uyarısı", en: "Compliance flagged" },
    "chat.pipeline_title": { tr: "Ajan Akışı", en: "Agent Pipeline" },
    "chat.pipeline_live": { tr: "Ajanlar çalışıyor", en: "Agents running" },
    "chat.pipeline_done": { tr: "Ajan akışı tamamlandı", en: "Agent pipeline complete" },
    "chat.pipeline_elapsed": { tr: "Süre", en: "Elapsed" },
    "chat.pipeline_current": { tr: "Aktif ajan", en: "Active agent" },
    "chat.pipeline_latest": { tr: "Son ajan çıktısı", en: "Latest agent update" },
    "chat.pipeline_waiting": {
        tr: "Belge tabanlı yanıt hazırlanıyor",
        en: "Preparing a document-grounded response",
    },
    "chat.pipeline_ready": { tr: "Yanıt hazır", en: "Response ready" },
    "chat.pipeline_pending": { tr: "Beklemede", en: "Pending" },
    "chat.error_prefix": { tr: "Hata", en: "Error" },
    "chat.error_generic": { tr: "Beklenmeyen hata oluştu", en: "Unexpected failure" },

    // ─── Suggestions (Empty State) ─────────────────────
    "suggestion.upload": {
        tr: "Sol panelden bir PDF belgesi yükleyin",
        en: "Upload a PDF document from the sidebar",
    },
    "suggestion.sample_pool": {
        tr: "Örnek belgelerden birini ekleyin",
        en: "Add a document from samples",
    },

    // ─── Suggestions (Loaded State) ──────────────────
    "suggestion.ask_about": {
        tr: "{{doc}} hakkında soru sor",
        en: "Ask about {{doc}}",
    },
    "suggestion.summarize": {
        tr: "{{doc}} belgesini özetle",
        en: "Summarize {{doc}}",
    },
    "suggestion.compare": {
        tr: "Belgeler arasındaki farkları karşılaştır",
        en: "Compare differences between documents",
    },

    // ─── Sample Pool ─────────────────────────────────
    "pool.title": {
        tr: "Örnek Belgeler",
        en: "Sample Documents",
    },
    "pool.add": {
        tr: "Bilgi tabanına ekle",
        en: "Add to knowledge base",
    },
    "pool.adding": {
        tr: "Ekleniyor...",
        en: "Adding...",
    },
    "pool.loaded": {
        tr: "Yüklü",
        en: "Loaded",
    },

    // ─── Agent Steps ──────────────────────────────────
    "agent.router": { tr: "Yönlendirici", en: "Router" },
    "agent.knowledge": { tr: "Bilgi", en: "Knowledge" },
    "agent.tool": { tr: "Araç", en: "Tool" },
    "agent.synthesizer": { tr: "Sentezleyici", en: "Synthesizer" },
    "agent.guardrail": { tr: "Güvence", en: "Guardrail" },

    "agent_status.analyzing": { tr: "Analiz ediliyor", en: "Analyzing" },
    "agent_status.searching": { tr: "Aranıyor", en: "Retrieving" },
    "agent_status.executing": { tr: "Çalıştırılıyor", en: "Executing" },
    "agent_status.composing": { tr: "Yanıt yazılıyor", en: "Composing" },
    "agent_status.checking": { tr: "Doğrulanıyor", en: "Validating" },
    "agent_status.complete": { tr: "Tamamlandı", en: "Done" },
    "agent_status.error": { tr: "Hata", en: "Error" },
    "agent_status.flagged": { tr: "Uyarı", en: "Flagged" },
    "agent_status.skipped": { tr: "Atlandı", en: "Skipped" },

    // ─── Language ─────────────────────────────────────
    "lang.tr": { tr: "Türkçe", en: "Turkish" },
    "lang.en": { tr: "İngilizce", en: "English" },

    // ─── Voice ────────────────────────────────────────
    "voice.listening": { tr: "Dinleniyor...", en: "Listening..." },
    "voice.speaking": { tr: "Okunuyor...", en: "Speaking..." },
    "voice.dictate": { tr: "Sesli giriş", en: "Voice input" },
    "voice.tap_to_speak": { tr: "Konuşarak yazdır", en: "Tap to dictate" },
    "voice.tap_to_stop": { tr: "Dinlemeyi durdur", en: "Tap to stop listening" },
    "voice.live_hint": { tr: "Konuşun, metne çevirelim", en: "Speak and we will turn it into text" },
    "voice.play_response": { tr: "Sesli dinle", en: "Play response" },
    "voice.stop_response": { tr: "Sesi durdur", en: "Stop audio" },
    "voice.not_supported": {
        tr: "Tarayıcınız ses tanımayı desteklemiyor",
        en: "Your browser does not support speech recognition",
    },
    "voice.tts_error": {
        tr: "Sesli yanıt oluşturulamadı",
        en: "Could not generate voice response",
    },

    // ─── Mobile ───────────────────────────────────────
    "mobile.menu": { tr: "Menü", en: "Menu" },
} as const;

export type TranslationKey = keyof typeof translations;

/**
 * Return the translated string for a key in a given locale.
 */
export function t(key: TranslationKey, locale: Locale): string {
    const entry = translations[key];
    return entry?.[locale] ?? key;
}
