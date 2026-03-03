# FinGuard AI Optimizasyon ve Uyum Denetim Raporu

Tarih: 2026-03-02  
Kapsam: `embedding + reranker + cache/warmup + Docker` performans mühendisliği, INT8/ONNX optimizasyonu, 4GB RAM/2 vCPU hedefi.

## 1) Hedefin
İstenen hedefler:
- Embedding ve reranker tarafında mümkünse INT8 optimizasyonu
- Docker içinde çalışacak şekilde (lokal dışı değil), kalıcı cache + warmup
- En yüksek hız, minimum kalite kaybı
- Son durumda ne yapıldığı, neyin tam uyduğu/ne kadar sapma olduğu detaylı döküm

## 2) Başlangıçta Tespit Edilen Kritik Sorunlar
1. `Alibaba-NLP/gte-multilingual-reranker-base` modeli ONNX export sürecinde başarısız oluyordu.
- Sonuç: `onnx-int8` hedefi pratikte kırılıyordu.

2. Embedding tarafı ONNX/INT8 pipeline'ına bağlanmamıştı.
- Sonuç: Sadece reranker optimize edilmeye çalışılıyor, embedding tarafında önemli CPU maliyeti kalıyordu.

3. Startup warmup yoktu.
- Sonuç: İlk sorguda model load + index maliyeti direkt kullanıcıya yansıyordu.

4. Cache mount kapsamı sınırlıydı.
- Sonuç: Model/onnx dosyalarının kalıcılığı ve cold start davranışı tam kontrol edilmiyordu.

## 3) Uygulanan Mühendislik Değişiklikleri

### 3.1 Model ve backend stratejisi
- Reranker modeli `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` olarak değiştirildi.
- Neden: Türkçe+İngilizce kapsayan, düşük donanımda daha dengeli, ONNX dosyaları hazır ve INT8'e uyumlu.

### 3.2 Embedding ONNX-INT8 hattı eklendi
- `intfloat/multilingual-e5-small` için `onnx-int8` backend aktif edildi.
- İlk çalışmada istenen `avx2` yoksa dinamik quantization ile `model_qint8_avx2.onnx` üretilecek şekilde yapılandırıldı.
- Sonraki çalışmalarda hazır INT8 dosya cache'ten kullanılıyor.

### 3.3 Reranker ONNX-INT8 hattı sertleştirildi
- Exact quantization (`avx2`) önceliği zorunlu hale getirildi.
- Exact yoksa quantize etme denemesi var.
- Yalnızca quantize başarısız olursa fallback (onnx fp32 / torch) devreye girecek güvenlik mekanizması eklendi.

### 3.4 Warmup ve runtime gözlemlenebilirlik
- FastAPI startup içinde warmup eklendi:
  - Embedding model load + encode warmup
  - Reranker model load + predict warmup
  - BM25 index warmup
- Yeni endpoint: `GET /runtime_status`
  - Aktif backend, quantization ve kullanılan onnx dosyası görülebiliyor.

### 3.5 Kalıcı cache altyapısı (Docker)
- Yeni volume mount'lar:
  - `/app/data/embeddings`
  - `/app/data/rerankers`
  - `/app/data/hf`
- Thread/env tuning:
  - `OMP_NUM_THREADS=2`
  - `MKL_NUM_THREADS=2`
  - `TOKENIZERS_PARALLELISM=false`

## 4) Değiştirilen Dosyalar
- `backend/app/config.py`
- `backend/app/rag.py`
- `backend/app/main.py`
- `backend/requirements.txt`
- `backend/.env.example`
- `backend/.env`
- `backend/Dockerfile`
- `docker-compose.yml`

## 5) Son Konfigürasyon Matrisi

### Embedding
- Model: `intfloat/multilingual-e5-small`
- Backend (istenen): `onnx-int8`
- Backend (aktif): `onnx-int8`
- Quantization: `avx2`
- ONNX dosya: `onnx/model_qint8_avx2.onnx`

### Reranker
- Model: `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1`
- Backend (istenen): `onnx-int8`
- Backend (aktif): `onnx-int8`
- Quantization: `avx2`
- ONNX dosya: `onnx/model_quint8_avx2.onnx`

### Retrieval tuning
- `RAG_TOP_K=15`
- `RAG_RERANK_TOP_N=3`

## 6) Docker Doğrulama Sonuçları

### 6.1 Sağlık ve runtime endpoint
- `/health`: `healthy`
- `/runtime_status`: embedding ve reranker için aktif backend `onnx-int8`, quantization `avx2`, onnx dosyaları doğru görünüyor.

### 6.2 Warmup süreleri
- İlk ağır cache/quantize başlangıç: ~17s (INT8 üretimi nedeniyle)
- Cache dolduktan sonraki yeniden başlatma warmup: ~3.4s

### 6.3 Chat süreleri (ölçülen)
- `chat_1`: ~4.26s
- `chat_2`: ~3.96s

Not: Bu süreler LLM API + retrieval + reranker dahil uçtan uca sürelerdir.

## 7) Uyum / Sapma Analizi

### 7.1 Tam uyulan maddeler
- Embedding INT8/ONNX: Evet
- Reranker INT8/ONNX: Evet
- Docker-first akış: Evet
- Cache kalıcılığı: Evet
- Startup warmup: Evet
- Düşük donanım odaklı model seçimi: Evet

### 7.2 Kısmi/kaçınılmaz sapmalar
1. “Kalite kaybı olmayacak” iddiası mutlak olarak garanti edilemez.
- INT8 quantization teorik olarak küçük skor sapmaları üretebilir.
- Pratikte kalite kaybı düşük beklenir; ancak `0` kayıp garantisi bilimsel olarak verilemez.

2. Chroma telemetry log hataları görülüyor.
- `capture() takes 1 positional argument but 3 were given`
- Fonksiyonel çalışmayı etkilemedi; performans core path'i bloklamıyor.

## 8) Riskler ve Koruma Mekanizmaları
- ONNX/INT8 yüklenemezse otomatik fallback mevcut (`onnx fp32` ardından `torch`).
- Bu fallback servis sürekliliğini korur, ancak hız hedefini düşürebilir.
- `runtime_status` ile aktif backend anlık denetlenebilir.

## 9) Neden Bu Reranker Modeli?
`cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` seçilme gerekçeleri:
- Multilingual yapısı Türkçe+İngilizce senaryoya uygun
- Düşük RAM’de daha yönetilebilir footprint
- Hazır ONNX + quantized varyantları var
- 4GB RAM, CPU-only konteynerde üretim stabilitesi daha yüksek

## 10) Operasyonel Öneriler
1. Bu ayarı prod'a alırken ilk deploy sonrası `runtime_status` kontrolünü health checklist'e ekle.
2. Haftalık örnek soru setiyle (TR/EN) kalite regresyon testi tut.
3. Uzun vadede telemetry uyarılarını temizlemek için Chroma versiyon pin/upgrade deneyi yap.
4. Sunucu mimarisi ARM ise `EMBEDDING_QUANTIZATION` ve `RERANKER_QUANTIZATION` değerlerini `arm64` yap.

## 11) Hızlı Kontrol Komutları
```bash
curl -s http://localhost:8000/health
curl -s http://localhost:8000/runtime_status | jq .
```

## 12) Sonuç
Sistem şu an hedeflediğin profile çekildi:
- Embedding + reranker her ikisi de `onnx-int8` üzerinde aktif
- `avx2` quantized dosyalarla doğrulanmış durumda
- Cache kalıcı, warmup aktif, cold-start maliyeti büyük ölçüde düşürüldü
- 4GB/2vCPU sınıfında daha stabil ve hızlı bir üretim davranışı elde edildi.

## 13) Güvenlik Notu
- `backend/.env` içinde gerçek API anahtarı tutuluyorsa, bu dosyanın repoya düşmemesi ve anahtarın düzenli rotasyonu önerilir.
