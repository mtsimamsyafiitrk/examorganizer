"""Quick smoke test untuk parser & PDF generator (tanpa AI)."""
import sys
sys.path.insert(0, 'D:/claude/exam-organizer')

from docx_parser import parse_docx, blocks_to_text
from pdf_generator import generate_soal_pdf, generate_kunci_pdf

# Test parser
print("=== Testing docx_parser ===")
blocks = parse_docx('D:/claude/exam-organizer/sample_soal.docx', 'D:/claude/exam-organizer/extracted_images/test')
print(f"Total blocks: {len(blocks)}")
text = blocks_to_text(blocks)
print(text[:300])
print("...")

# Test PDF generator with mock data
print("\n=== Testing pdf_generator ===")
mock_data = {
    "judul": "Ulangan Harian Bahasa Indonesia",
    "mata_pelajaran": "Bahasa Indonesia",
    "kelas": "VII",
    "bacaan_list": [
        {"id": "B1", "judul": "Lingkungan Bersih",
         "isi": "Lingkungan yang bersih adalah dambaan semua orang...",
         "untuk_soal": [1, 2]}
    ],
    "soal": [
        {"nomor": 1, "jenis": "pilihan_ganda", "pertanyaan": "Apa ide pokok paragraf di atas?",
         "gambar": None, "bacaan_id": "B1",
         "pilihan": {"A": "Lingkungan kotor", "B": "Lingkungan bersih dambaan", "C": "Penyakit", "D": "Kebersihan"},
         "kunci": "B"},
        {"nomor": 2, "jenis": "pilihan_ganda_kompleks", "pertanyaan": "Pilih kalimat tanya:",
         "gambar": None, "bacaan_id": None,
         "pilihan": {"A": "Siapa namamu?", "B": "Saya pergi.", "C": "Berapa umurmu?", "D": "Dia membaca."},
         "kunci": ["A", "C"]},
        {"nomor": 3, "jenis": "benar_salah",
         "pertanyaan": "Ibu kota Indonesia adalah Jakarta.",
         "gambar": None, "bacaan_id": None, "kunci": True},
        {"nomor": 4, "jenis": "penjodohan",
         "pertanyaan": "Jodohkan istilah berikut:",
         "gambar": None, "bacaan_id": None,
         "pasangan": [
             {"kiri": "Subjek", "kanan": "Pelaku"},
             {"kiri": "Predikat", "kanan": "Kata kerja"},
             {"kiri": "Objek", "kanan": "Yang dikenai"},
         ], "kunci": None},
        {"nomor": 5, "jenis": "isian",
         "pertanyaan": "Ibukota negara Republik Indonesia adalah ....",
         "gambar": None, "bacaan_id": None, "kunci": "Jakarta"},
        {"nomor": 6, "jenis": "essay",
         "pertanyaan": "Jelaskan apa yang dimaksud dengan kalimat efektif!",
         "gambar": None, "bacaan_id": None,
         "kunci": "Kalimat efektif adalah kalimat yang menggunakan kata-kata secara tepat, padat, dan jelas sehingga pesan tersampaikan dengan baik kepada pembaca.",
         "skor_maksimal": 10},
    ]
}

import os
os.makedirs('D:/claude/exam-organizer/outputs', exist_ok=True)

# Test kop sekolah
mock_kop = {
    "nama_sekolah": "SMP NEGERI 1 JAKARTA",
    "alamat": "Jl. Pendidikan No. 123, Jakarta Pusat",
    "kontak": "Telp: (021) 555-1234 | smpn1jkt@edu.id",
    "tahun": "2025/2026",
    "judul_ujian": "PENILAIAN AKHIR SEMESTER GANJIL",
    "logo_path": None,  # No logo for test
}

for layout in ('1col', '2col'):
    generate_soal_pdf(mock_data, f'D:/claude/exam-organizer/outputs/test_soal_{layout}.pdf', 'D:/claude/exam-organizer/extracted_images/test', kop=mock_kop, layout=layout)
    generate_kunci_pdf(mock_data, f'D:/claude/exam-organizer/outputs/test_kunci_{layout}.pdf', kop=mock_kop, layout=layout)
    print(f"Generated layout: {layout}")

print("\nAll OK!")
