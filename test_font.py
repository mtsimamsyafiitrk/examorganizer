"""Verifikasi apakah ArialUni benar-benar punya glyph Arab."""
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from fontTools.ttLib import TTFont as FTFont

# Cek dengan fontTools apakah ArialUni punya glyph untuk char Arab
ARABIC_CHARS = ['تَ', 'ج', 'ق', 'ت', 'كَتَبَ', 'مَدْرَسَةٌ']

font_path = r'C:\Windows\Fonts\ARIALUNI.ttf'
print(f"Loading: {font_path}")

try:
    tt = FTFont(font_path)
    cmap = tt['cmap'].getBestCmap()
    with open('D:/claude/exam-organizer/font_check.txt', 'w', encoding='utf-8') as f:
        for s in ARABIC_CHARS:
            result = []
            for c in s:
                code = ord(c)
                has = code in cmap
                result.append(f"{c}={'YES' if has else 'NO'}({code:04X})")
            f.write(' '.join(result) + '\n')
    print("Font check written to font_check.txt")
except Exception as e:
    print(f"Error: {e}")

# Render PDF langsung dengan reportlab
pdfmetrics.registerFont(TTFont('ArialUni', font_path))
c = canvas.Canvas("D:/claude/exam-organizer/outputs/test_font.pdf")
c.setFont('ArialUni', 24)
y = 700
for s in ARABIC_CHARS:
    c.drawString(50, y, f"Test: {s}")
    y -= 40
c.save()
print("PDF test_font.pdf generated.")
