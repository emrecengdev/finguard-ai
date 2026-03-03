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
    "chat.welcome": {
        tr: "FinGuard'a iş hukuku, İK politikası ve bankacılık uyumu hakkında sorun.",
        en: "Ask FinGuard about labor law, HR policy, and compliance.",
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
    "chat.error_prefix": { tr: "Hata", en: "Error" },
    "chat.error_generic": { tr: "Beklenmeyen hata oluştu", en: "Unexpected failure" },

    // ─── Suggestions ──────────────────────────────────
    "suggestion.1": {
        tr: "Türk İş Kanunu'na göre yıllık izin hakları nelerdir?",
        en: "Annual leave rights under Turkish Labor Law",
    },
    "suggestion.2": {
        tr: "EMP-0042 çalışanının izin hakkını kontrol et",
        en: "Check leave entitlement for employee EMP-0042",
    },
    "suggestion.3": {
        tr: "250.000 TL kredi riski hesapla",
        en: "Calculate credit risk for 250,000 TRY exposure",
    },
    "suggestion.4": {
        tr: "Fazla mesai sınırları ve hafta sonu çalışma kuralları",
        en: "Overtime limits and weekend work regulations",
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
