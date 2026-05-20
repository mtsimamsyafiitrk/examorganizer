import sys
sys.path.insert(0, 'D:/claude/exam-organizer')
from pdf_generator import _has_arabic, _wrap_for_paragraph, _format_text, ARABIC_FONT

samples = [
    "كَتَبَ",
    'Penulisan kata "Madrosatun" (مَدْرَسَةٌ) yang benar adalah...',
    "A. تَ",
    "B. تـ",
]

with open('D:/claude/exam-organizer/debug_wrap.txt', 'w', encoding='utf-8') as f:
    f.write(f"ARABIC_FONT = {ARABIC_FONT}\n\n")
    for s in samples:
        f.write(f"INPUT: {s}\n")
        f.write(f"has_arabic: {_has_arabic(s)}\n")
        f.write(f"wrapped: {_wrap_for_paragraph(s)}\n")
        f.write(f"format_text: {_format_text(s)}\n\n")

print("Debug written to debug_wrap.txt")
