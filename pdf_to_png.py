"""Convert PDF first page to PNG for visual verification."""
import sys
import subprocess
import os

pdf_path = 'D:/claude/exam-organizer/outputs/test_arab_soal.pdf'
out_path = 'D:/claude/exam-organizer/outputs/test_arab_preview.png'

# Coba pakai pdf2image (kalau ada poppler)
try:
    from pdf2image import convert_from_path
    images = convert_from_path(pdf_path, dpi=120, first_page=1, last_page=2)
    for i, img in enumerate(images):
        img.save(f'D:/claude/exam-organizer/outputs/test_arab_page{i+1}.png', 'PNG')
        print(f"Saved page {i+1}")
except Exception as e:
    print(f"pdf2image failed: {e}")
    print("Install: pip install pdf2image, plus poppler binary")
