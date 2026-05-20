# Exam Organizer AI

Aplikasi web untuk merapikan soal ulangan dari file Word secara otomatis menggunakan AI.

## Fitur

- Upload file `.docx` (Microsoft Word)
- AI otomatis menganalisa & mengidentifikasi jenis soal:
  - Pilihan Ganda (A-D)
  - Pilihan Ganda Kompleks (multi jawaban)
  - Benar / Salah
  - Penjodohan
- Otomatis ekstrak gambar dan bacaan acuan
- Preview interaktif sebelum export
- Export 2 PDF terpisah: **Lembar Soal** & **Kunci Jawaban**
- 100% gratis (menggunakan Google Gemini free tier)

## Setup

### 1. Install dependencies

```bash
cd D:\claude\exam-organizer
pip install -r requirements.txt
```

### 2. Dapatkan API Key Gemini (gratis)

Buka https://aistudio.google.com/apikey lalu klik "Create API Key".

API key bisa diset di:
- **Browser** — klik tombol "⚙ API Key" di pojok kanan atas, lalu paste & simpan
- **File `.env`** — copy `.env.example` ke `.env` lalu isi `GEMINI_API_KEY=...`

### 3. Jalankan aplikasi

```bash
python app.py
```

Buka http://127.0.0.1:5000 di browser.

## Cara Pakai

1. Klik "⚙ API Key" → masukkan Gemini API key
2. Upload file `.docx` soal ulangan
3. Klik "🪄 Analisa dengan AI"
4. Tunggu beberapa detik, lalu review preview
5. Klik "📄 Export PDF Soal" untuk lembar soal
6. Klik "🔑 Export Kunci Jawaban" untuk PDF kunci terpisah

## Struktur Project

```
exam-organizer/
├── app.py                  # Flask backend
├── docx_parser.py          # Parser Word + ekstrak gambar
├── ai_analyzer.py          # Integrasi Gemini AI
├── pdf_generator.py        # Generator PDF (ReportLab)
├── requirements.txt        # Dependencies
├── templates/index.html    # UI utama
├── static/style.css        # Styling
├── static/app.js           # Logic frontend
├── uploads/                # File yang diupload
├── extracted_images/       # Gambar hasil ekstrak
└── outputs/                # PDF hasil export
```
