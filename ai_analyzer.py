"""AI analyzer menggunakan Google Gemini (SDK baru: google-genai) untuk menganalisa soal ulangan."""
import json
import re
from google import genai
from google.genai import types


SYSTEM_PROMPT = """Kamu adalah AI yang ahli dalam menganalisa dan merapikan soal ulangan sekolah berbahasa Indonesia.

TUGAS:
Diberikan teks mentah dari file Word soal ulangan, ekstrak dan rapikan menjadi struktur JSON.

JENIS SOAL YANG DIKENAL:
1. "pilihan_ganda" - Pilihan A, B, C, D (atau A-E). Satu jawaban benar.
2. "pilihan_ganda_kompleks" - Pilihan boleh dicentang lebih dari satu (multiple correct answers).
3. "benar_salah" - Pernyataan dengan jawaban Benar atau Salah.
4. "penjodohan" - Mencocokkan item kiri dengan item kanan.
5. "isian" - Soal isian singkat. Ciri: ada titik-titik (...) di tengah/akhir kalimat, atau eksplisit "isilah", "lengkapi", "jawablah dengan singkat". Jawaban berupa kata/frasa pendek.
6. "essay" - Soal uraian panjang. Ciri: eksplisit "uraikan", "jelaskan", "deskripsikan", "sebutkan dan jelaskan", "bagaimana cara", "mengapa". Jawaban berupa paragraf.

ATURAN:
- Identifikasi nomor soal (1, 2, 3, ...) dari teks.
- Jika ada BACAAN/WACANA/TEKS ACUAN sebelum sekelompok soal, masukkan ke field "bacaan" dan referensikan ke nomor soal mana saja yang menggunakannya.
- Jika ada placeholder gambar berbentuk "[GAMBAR: nama_file.png]" di dekat soal, simpan nama file tersebut di field "gambar" pada soal terkait.
- Untuk pilihan ganda, ekstrak opsi A, B, C, D (dan E jika ada). Coba tebak kunci jawaban jika ada penanda seperti garis bawah, tanda bintang, atau eksplisit "Jawaban: B".
- Untuk pilihan ganda kompleks, ekstrak semua opsi dan kunci (bisa lebih dari satu).
- Untuk benar/salah, ekstrak pernyataan dan kunci jawabannya (true/false).
- Untuk penjodohan, ekstrak pasangan kiri-kanan.
- Bersihkan typo ringan dan formatting yang aneh, tapi JANGAN ubah substansi soal.
- **PENTING — TEKS NON-LATIN**: Jika teks soal/pilihan mengandung huruf Arab (ا ب ت), Hanzi (汉字), Cyrillic, atau script lainnya, **WAJIB pertahankan apa adanya** dalam JSON. JANGAN translit, JANGAN kosongkan, JANGAN ganti dengan placeholder. Pertahankan harakat (fatha, kasra, sukun, tanwin, dll) dan diakritik.
- **PENTING — PILIHAN JAWABAN**: Jika setelah label "A.", "B.", "C.", "D." terdapat teks (apa pun bentuknya: Latin, Arab, angka, simbol), masukkan ke field pilihan. **JANGAN biarkan pilihan kosong** kecuali memang benar-benar tidak ada teks di sumber. Jika ragu, masukkan teks apa adanya.

OUTPUT WAJIB JSON dengan struktur:
{
  "judul": "judul ulangan jika ada, atau null",
  "mata_pelajaran": "mata pelajaran jika terdeteksi, atau null",
  "kelas": "kelas jika ada, atau null",
  "bacaan_list": [
    {"id": "B1", "judul": "judul bacaan", "isi": "...", "untuk_soal": [1,2,3]}
  ],
  "soal": [
    {
      "nomor": 1,
      "jenis": "pilihan_ganda",
      "pertanyaan": "...",
      "gambar": "namafile.png" atau null,
      "bacaan_id": "B1" atau null,
      "pilihan": {"A": "...", "B": "...", "C": "...", "D": "..."},
      "kunci": "B"
    },
    {
      "nomor": 2,
      "jenis": "pilihan_ganda_kompleks",
      "pertanyaan": "...",
      "gambar": null,
      "bacaan_id": null,
      "pilihan": {"A": "...", "B": "...", "C": "...", "D": "..."},
      "kunci": ["A", "C"]
    },
    {
      "nomor": 3,
      "jenis": "benar_salah",
      "pertanyaan": "...",
      "gambar": null,
      "bacaan_id": null,
      "kunci": true
    },
    {
      "nomor": 4,
      "jenis": "penjodohan",
      "pertanyaan": "Jodohkan pernyataan berikut",
      "gambar": null,
      "bacaan_id": null,
      "pasangan": [
        {"kiri": "Ibukota Indonesia", "kanan": "Jakarta"},
        {"kiri": "Ibukota Jepang", "kanan": "Tokyo"}
      ]
    },
    {
      "nomor": 5,
      "jenis": "isian",
      "pertanyaan": "Hasil dari 12 + 7 = ....",
      "gambar": null,
      "bacaan_id": null,
      "kunci": "19"
    },
    {
      "nomor": 6,
      "jenis": "essay",
      "pertanyaan": "Jelaskan proses fotosintesis pada tumbuhan!",
      "gambar": null,
      "bacaan_id": null,
      "kunci": "Fotosintesis adalah proses pembuatan makanan oleh tumbuhan hijau dengan bantuan cahaya matahari. Klorofil menyerap cahaya untuk mengubah air dan karbondioksida menjadi glukosa dan oksigen.",
      "skor_maksimal": 10
    }
  ]
}

Jika tidak bisa menentukan kunci jawaban, isi dengan null. JANGAN mengarang jawaban.
KEMBALIKAN HANYA JSON, tidak ada penjelasan lain, tidak ada markdown code fence."""


# Urutan fallback model (dari paling baru/cepat ke yang paling kompatibel)
MODEL_CANDIDATES = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-flash-latest",
    "gemini-2.5-pro",
]


def _try_generate(client, prompt, model_name):
    return client.models.generate_content(
        model=model_name,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            temperature=0.2,
            response_mime_type="application/json",
        ),
    )


def list_available_models(api_key):
    """List all generative models user has access to."""
    client = genai.Client(api_key=api_key)
    models = []
    for m in client.models.list():
        actions = getattr(m, "supported_actions", None) or []
        if not actions or "generateContent" in actions:
            models.append(m.name)
    return models


def _is_quota_error(err):
    msg = str(err).lower()
    return any(s in msg for s in (
        "429", "quota", "resource_exhausted", "rate limit",
        "rate_limit", "exceeded", "too many"
    ))


def _is_model_missing_error(err):
    msg = str(err).lower()
    return any(s in msg for s in ("404", "not found", "not supported", "unavailable"))


def analyze_exam(raw_text, api_key=None):
    """
    Send raw exam text to Gemini, get structured JSON back.

    api_key can be:
      - str (single key)
      - list of str (multi-key rotation: try next key if quota exhausted)
    """
    if not api_key:
        raise ValueError("API key Gemini wajib diisi")

    if isinstance(api_key, str):
        api_keys = [api_key]
    else:
        api_keys = [k for k in api_key if k and k.strip()]
        if not api_keys:
            raise ValueError("Minimal satu API key wajib diisi")

    prompt = f"Berikut teks mentah soal ulangan:\n\n{raw_text}\n\nKeluarkan JSON sesuai struktur yang ditentukan."

    last_err = None
    response = None
    quota_errors = []

    for key_idx, key in enumerate(api_keys):
        client = genai.Client(api_key=key.strip())
        # Try each model with this key
        model_quota_exhausted = False
        for model_name in MODEL_CANDIDATES:
            try:
                response = _try_generate(client, prompt, model_name)
                break
            except Exception as e:
                last_err = e
                if _is_quota_error(e):
                    # Quota habis untuk key ini → lanjut ke key berikutnya, bukan model lain
                    quota_errors.append(f"Key #{key_idx + 1}: quota habis")
                    model_quota_exhausted = True
                    break
                if _is_model_missing_error(e):
                    continue
                raise
        if response is not None:
            break
        if not model_quota_exhausted:
            # Tidak ada satupun model jalan untuk key ini (bukan karena quota) — coba key lain
            continue

    if response is None:
        msg = f"Semua API key gagal. Error terakhir: {last_err}"
        if quota_errors:
            msg += f"\n\nQuota habis: {', '.join(quota_errors)}"
            msg += "\n\nSolusi: tunggu reset (24 jam), enable billing di Google Cloud, atau tambah key baru."
        raise RuntimeError(msg)

    text = (response.text or "").strip()
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        match = re.search(r'\{[\s\S]*\}', text)
        if match:
            data = json.loads(match.group(0))
        else:
            raise ValueError(f"AI tidak mengembalikan JSON valid: {e}\n\nResponse: {text[:500]}")

    return _normalize(data)


def _normalize(data):
    """Pastikan struktur konsisten dengan default values."""
    data.setdefault("judul", None)
    data.setdefault("mata_pelajaran", None)
    data.setdefault("kelas", None)
    data.setdefault("bacaan_list", [])
    data.setdefault("soal", [])

    for s in data["soal"]:
        s.setdefault("nomor", 0)
        s.setdefault("jenis", "pilihan_ganda")
        s.setdefault("pertanyaan", "")
        s.setdefault("gambar", None)
        s.setdefault("bacaan_id", None)
        s.setdefault("kunci", None)
        if s["jenis"] in ("pilihan_ganda", "pilihan_ganda_kompleks"):
            s.setdefault("pilihan", {})
        if s["jenis"] == "penjodohan":
            s.setdefault("pasangan", [])
        if s["jenis"] == "essay":
            s.setdefault("skor_maksimal", None)

    data["soal"].sort(key=lambda x: x.get("nomor", 0))
    return data
