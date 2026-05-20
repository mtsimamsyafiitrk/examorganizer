"""Test PDF generation dengan content Arabic."""
import sys
sys.path.insert(0, 'D:/claude/exam-organizer')

from pdf_generator import generate_soal_pdf, generate_kunci_pdf, BASE_FONT, ARABIC_FONT, ARABIC_SUPPORT

print(f"Latin font: {BASE_FONT}")
print(f"Arabic font: {ARABIC_FONT}")
print(f"Arabic shaping: {ARABIC_SUPPORT}")

mock_data = {
    "judul": "Ulangan Bahasa Arab",
    "mata_pelajaran": "Bahasa Arab",
    "kelas": "VII",
    "bacaan_list": [],
    "soal": [
        {"nomor": 4, "jenis": "pilihan_ganda",
         "pertanyaan": 'Bentuk huruf "Ta" (ت) di awal kata saat disambung adalah...',
         "gambar": None, "bacaan_id": None,
         "pilihan": {"A": "تَ", "B": "تـ", "C": "ـتـ", "D": "ـت"},
         "kunci": "B"},
        {"nomor": 5, "jenis": "pilihan_ganda",
         "pertanyaan": 'Manakah penyambungan huruf yang benar untuk kata "Kaa-ta-ba" (كَتَبَ)?',
         "gambar": None, "bacaan_id": None,
         "pilihan": {"A": "كَ تَ بَ", "B": "كَتَبَ", "C": "كــتــبَ", "D": "ك ت ب"},
         "kunci": "B"},
        {"nomor": 6, "jenis": "pilihan_ganda",
         "pertanyaan": 'Penulisan kata "Madrosatun" (مَدْرَسَةٌ) yang benar adalah...',
         "gambar": None, "bacaan_id": None,
         "pilihan": {"A": "مَدْرَسَةٌ", "B": "مَدْرَسَة", "C": "مدرسة", "D": "مَدرَسة"},
         "kunci": "A"},
    ]
}

mock_kop = {
    "nama_sekolah": "MTs NEGERI 1 JAKARTA",
    "alamat": "Jl. Pendidikan No. 123",
    "tahun": "2025/2026",
    "judul_ujian": "ULANGAN HARIAN BAHASA ARAB",
}

for layout in ('1col', '2col'):
    generate_soal_pdf(mock_data, f'D:/claude/exam-organizer/outputs/test_arab_soal_{layout}.pdf', 'D:/claude/exam-organizer/extracted_images/test_arab', kop=mock_kop, layout=layout)
    generate_kunci_pdf(mock_data, f'D:/claude/exam-organizer/outputs/test_arab_kunci_{layout}.pdf', kop=mock_kop, layout=layout)
    print(f'Generated {layout}')
print('PDF Arab generated (both layouts).')
