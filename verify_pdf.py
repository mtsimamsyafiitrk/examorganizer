"""Extract text dari PDF dan cek apakah Arabic muncul."""
from pypdf import PdfReader

import sys
pdf_file = sys.argv[1] if len(sys.argv) > 1 else 'D:/claude/exam-organizer/outputs/test_arab_soal_1col.pdf'
print(f"Reading: {pdf_file}")
reader = PdfReader(pdf_file)
print(f"Pages: {len(reader.pages)}")

with open('D:/claude/exam-organizer/pdf_text.txt', 'w', encoding='utf-8') as f:
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        f.write(f"=== Page {i+1} ===\n{text}\n\n")

        # Cek font yang dipakai
        if '/Font' in page['/Resources']:
            f.write("Fonts on this page:\n")
            for fname, font in page['/Resources']['/Font'].items():
                f.write(f"  {fname}: {font.get('/BaseFont', 'unknown')}\n")
            f.write("\n")

# Hitung karakter Arabic
import re
all_text = open('D:/claude/exam-organizer/pdf_text.txt', encoding='utf-8').read()
arabic = len(re.findall(r'[؀-ۿ]', all_text))
print(f"Arabic chars detected in extracted PDF text: {arabic}")
