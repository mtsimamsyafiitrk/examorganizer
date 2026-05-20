import sys
sys.path.insert(0, 'D:/claude/exam-organizer')
from app import parse_filename

cases = [
    "IMLA KELAS 7.docx",
    "Bahasa Arab Kelas VII.docx",
    "Matematika 8 - PAS.docx",
    "Soal Ulangan IPA Kelas 9.docx",
    "Tes Imla Kelas VII Semester Ganjil.docx",
    "Bahasa_Indonesia_kls_10.docx",
    "ulangan harian biologi 11.docx",
    "Fiqih Kelas IX PAT Semester Genap.docx",
]

print(f"{'Input':<55} | {'Mapel':<25} | Kelas")
print("-" * 100)
for f in cases:
    r = parse_filename(f)
    print(f"{f:<55} | {str(r['mapel']):<25} | {r['kelas']}")
