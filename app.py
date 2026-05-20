"""Flask app — Exam Organizer AI."""
import os
import re
import uuid
import json
import traceback
from pathlib import Path


# Map angka Romawi → Latin (untuk kelas)
ROMAN_TO_INT = {
    "I": "1", "II": "2", "III": "3", "IV": "4", "V": "5",
    "VI": "6", "VII": "7", "VIII": "8", "IX": "9", "X": "10",
    "XI": "11", "XII": "12",
}


def parse_filename(filename):
    """
    Parse mapel & kelas dari nama file.
    Contoh:
      "IMLA KELAS 7.docx" → {"mapel": "IMLA", "kelas": "7"}
      "Bahasa Arab Kelas VII.docx" → {"mapel": "Bahasa Arab", "kelas": "7"}
      "Matematika 8 - PAS.docx" → {"mapel": "Matematika", "kelas": "8"}
      "Soal Ulangan IPA Kelas 9.docx" → {"mapel": "IPA", "kelas": "9"}
    """
    name = os.path.splitext(os.path.basename(filename))[0]
    # Ganti underscore & separator dengan spasi DULU
    name = re.sub(r'[_-]+', ' ', name)
    # Bersihkan kata-kata umum: ulangan, soal, ujian, PAS, PTS, dll
    cleaned = re.sub(
        r'\b(soal|ulangan|ujian|pas|pts|pat|uts|uas|pakai|tes|test|harian|semester|ganjil|genap|tugas)\b',
        '', name, flags=re.IGNORECASE
    )

    # Pattern: kelas X / kls X / cl X / c X
    kelas_match = re.search(
        r'\b(?:kelas|kls|cls|class|c)\s*[:\-]?\s*([0-9IVX]+)\b',
        cleaned, flags=re.IGNORECASE
    )
    kelas = None
    if kelas_match:
        raw = kelas_match.group(1).upper()
        kelas = ROMAN_TO_INT.get(raw, raw)
        # Hapus dari cleaned agar tersisa nama mapel
        cleaned = re.sub(
            r'\b(?:kelas|kls|cls|class|c)\s*[:\-]?\s*[0-9IVX]+\b',
            '', cleaned, flags=re.IGNORECASE
        )
    else:
        # Coba pattern angka di awal/akhir saja
        m = re.search(r'(?:^|\s|-)([0-9]{1,2})(?:\s|$|-)', cleaned)
        if m:
            kelas = m.group(1)
            cleaned = cleaned.replace(m.group(0), ' ', 1)

    # Sisanya = mapel (cleanup: hapus angka, separator, double space)
    mapel = re.sub(r'[-_]', ' ', cleaned)
    mapel = re.sub(r'\s+', ' ', mapel).strip()
    # Hapus angka stand-alone yang tertinggal
    mapel = re.sub(r'\b\d+\b', '', mapel).strip()
    mapel = re.sub(r'\s+', ' ', mapel).strip()

    if not mapel:
        mapel = None
    return {"mapel": mapel, "kelas": kelas}

from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

from docx_parser import parse_docx, blocks_to_text
from ai_analyzer import analyze_exam
from pdf_generator import generate_soal_pdf, generate_kunci_pdf

load_dotenv()

BASE_DIR = Path(__file__).parent.resolve()
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
IMAGE_DIR = BASE_DIR / "extracted_images"
for d in (UPLOAD_DIR, OUTPUT_DIR, IMAGE_DIR):
    d.mkdir(exist_ok=True)

# In-memory store keyed by session_id
SESSIONS = {}

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)


@app.route("/")
def index():
    return send_from_directory("templates", "index.html")


@app.route("/static/<path:filename>")
def serve_static(filename):
    return send_from_directory("static", filename)


@app.route("/extracted_images/<session_id>/<filename>")
def serve_image(session_id, filename):
    """Serve extracted images so the preview can show them."""
    folder = IMAGE_DIR / session_id
    return send_from_directory(str(folder), filename)


@app.route("/api/check-key", methods=["GET"])
def check_key():
    has_env_key = bool(os.environ.get("GEMINI_API_KEY"))
    return jsonify({"has_env_key": has_env_key})


@app.route("/api/list-models", methods=["POST"])
def list_models():
    """Debug: list semua model Gemini yang tersedia untuk API key user."""
    body = request.get_json() or {}
    api_key = body.get("api_key") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return jsonify({"error": "API key kosong"}), 400
    try:
        from ai_analyzer import list_available_models
        models = list_available_models(api_key)
        return jsonify({"models": models})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/upload", methods=["POST"])
def upload():
    """Upload .docx, parse, send to AI, return structured data."""
    try:
        if "file" not in request.files:
            return jsonify({"error": "Tidak ada file yang diupload"}), 400
        file = request.files["file"]
        if not file.filename.lower().endswith(".docx"):
            return jsonify({"error": "File harus berformat .docx"}), 400

        # Bisa terima 'api_key' (single) atau 'api_keys' (JSON array string)
        api_keys_raw = request.form.get("api_keys")
        if api_keys_raw:
            try:
                api_keys = json.loads(api_keys_raw)
                if not isinstance(api_keys, list):
                    api_keys = [str(api_keys)]
                api_keys = [k.strip() for k in api_keys if k and str(k).strip()]
            except Exception:
                api_keys = [api_keys_raw.strip()]
        else:
            single = request.form.get("api_key") or os.environ.get("GEMINI_API_KEY")
            api_keys = [single.strip()] if single else []

        if not api_keys:
            return jsonify({"error": "API key Gemini belum diatur. Silakan masukkan API key."}), 400

        # Parse kop data (logo + text fields)
        kop_raw = request.form.get("kop")
        kop = {}
        if kop_raw:
            try:
                kop = json.loads(kop_raw)
            except Exception:
                kop = {}

        session_id = uuid.uuid4().hex[:12]
        session_upload = UPLOAD_DIR / f"{session_id}.docx"
        session_image_dir = IMAGE_DIR / session_id
        session_image_dir.mkdir(exist_ok=True)

        file.save(str(session_upload))

        # Save logo (dataURL → file) if provided
        logo_path = None
        if kop.get("logo", "").startswith("data:image"):
            try:
                import base64
                header, b64 = kop["logo"].split(",", 1)
                ext = "png"
                if "jpeg" in header or "jpg" in header:
                    ext = "jpg"
                logo_path = str(session_image_dir / f"logo.{ext}")
                with open(logo_path, "wb") as f:
                    f.write(base64.b64decode(b64))
            except Exception as e:
                print(f"Logo save error: {e}")
                logo_path = None
        kop["logo_path"] = logo_path

        # 1) Parse Word -> blocks
        blocks = parse_docx(str(session_upload), str(session_image_dir))
        raw_text = blocks_to_text(blocks)

        if not raw_text.strip():
            return jsonify({"error": "Dokumen kosong atau tidak terbaca"}), 400

        # 2) Kirim ke AI (multi-key rotation)
        data = analyze_exam(raw_text, api_key=api_keys)

        # 2b) Override mapel & kelas dari nama file (prioritas tinggi karena lebih reliable)
        filename_meta = parse_filename(file.filename)
        if filename_meta["mapel"]:
            data["mata_pelajaran"] = filename_meta["mapel"]
        if filename_meta["kelas"]:
            data["kelas"] = filename_meta["kelas"]

        # 3) Convert image paths in soal to URL-friendly path (relative)
        for s in data["soal"]:
            if s.get("gambar"):
                fn = os.path.basename(s["gambar"])
                # Pastikan file ada
                target = session_image_dir / fn
                if target.exists():
                    s["gambar_url"] = f"/extracted_images/{session_id}/{fn}"
                    s["gambar"] = str(target)
                else:
                    s["gambar"] = None
                    s["gambar_url"] = None

        SESSIONS[session_id] = {
            "data": data,
            "image_dir": str(session_image_dir),
            "kop": kop,
        }

        return jsonify({
            "session_id": session_id,
            "data": data,
            "image_base_url": f"/extracted_images/{session_id}/",
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/update", methods=["POST"])
def update_session():
    """Update edited data dari preview (sebelum export)."""
    body = request.get_json()
    session_id = body.get("session_id")
    data = body.get("data")
    if not session_id or session_id not in SESSIONS:
        return jsonify({"error": "Session tidak ditemukan"}), 404
    SESSIONS[session_id]["data"] = data
    return jsonify({"ok": True})


@app.route("/api/export/<doc_type>/<session_id>", methods=["GET"])
def export_pdf(doc_type, session_id):
    """doc_type: 'soal' atau 'kunci'."""
    if session_id not in SESSIONS:
        return jsonify({"error": "Session tidak ditemukan"}), 404
    if doc_type not in ("soal", "kunci"):
        return jsonify({"error": "Tipe dokumen tidak valid"}), 400

    sess = SESSIONS[session_id]
    data = sess["data"]
    image_dir = sess["image_dir"]
    kop = sess.get("kop", {})
    layout = request.args.get("layout", "1col")
    if layout not in ("1col", "2col"):
        layout = "1col"

    output_path = OUTPUT_DIR / f"{session_id}_{doc_type}_{layout}.pdf"
    if doc_type == "soal":
        generate_soal_pdf(data, str(output_path), image_dir, kop=kop, layout=layout)
    else:
        generate_kunci_pdf(data, str(output_path), kop=kop, layout=layout)

    return send_file(
        str(output_path),
        as_attachment=True,
        download_name=f"{doc_type}_{session_id}.pdf",
        mimetype="application/pdf",
    )


if __name__ == "__main__":
    print("=" * 60)
    print("  EXAM ORGANIZER AI — Flask Server")
    print("=" * 60)
    print(f"  Open: http://127.0.0.1:5000")
    print(f"  Get Gemini API key (gratis): https://aistudio.google.com/apikey")
    print("=" * 60)
    app.run(host="127.0.0.1", port=5000, debug=True)
