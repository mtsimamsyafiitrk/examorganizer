import sys
sys.path.insert(0, 'D:/claude/exam-organizer')
from pdf_generator import _format_text

# Test font size wrapping at different base sizes
tests = [
    ('Penulisan kata "Madrosatun" (مَدْرَسَةٌ) adalah...', 11),  # question
    ('A. مَدْرَسَةٌ', 10),  # choice
    ('Header كَتَبَ', 16),  # title
]

with open('D:/claude/exam-organizer/debug_arab_size.txt', 'w', encoding='utf-8') as f:
    for text, size in tests:
        result = _format_text(text, base_size=size)
        f.write(f"base_size={size}, expected_arab_size={round(size*1.5)}\n")
        f.write(f"OUTPUT: {result}\n\n")

print("OK, written to debug_arab_size.txt")
