"""PDF generator menggunakan ReportLab. Buat dua PDF: soal & kunci jawaban."""
import os
import re
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (
    BaseDocTemplate, SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak,
    KeepTogether, Table, TableStyle, Frame, PageTemplate, NextPageTemplate
)
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT, TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from PIL import Image as PILImage

try:
    import arabic_reshaper
    from bidi.algorithm import get_display
    ARABIC_SUPPORT = True
except ImportError:
    ARABIC_SUPPORT = False


# Register fonts
def _register_fonts():
    """
    Register dua font:
    - Regular Unicode font (Arial untuk Latin, Tahoma fallback)
    - ArialUni khusus untuk Arabic glyphs

    Return: dict {regular, bold, arabic}
    """
    fonts = {"regular": "Helvetica", "bold": "Helvetica-Bold", "arabic": "Helvetica"}

    # Regular & bold pakai Arial
    if os.path.exists(r"C:\Windows\Fonts\arial.ttf"):
        try:
            pdfmetrics.registerFont(TTFont("AppRegular", r"C:\Windows\Fonts\arial.ttf"))
            fonts["regular"] = "AppRegular"
        except Exception:
            pass
    if os.path.exists(r"C:\Windows\Fonts\arialbd.ttf"):
        try:
            pdfmetrics.registerFont(TTFont("AppBold", r"C:\Windows\Fonts\arialbd.ttf"))
            fonts["bold"] = "AppBold"
        except Exception:
            pass

    # Arabic font khusus — pakai ArialUni atau Tahoma
    arabic_candidates = [
        r"C:\Windows\Fonts\ARIALUNI.ttf",
        r"C:\Windows\Fonts\arabtype.ttf",
        r"C:\Windows\Fonts\tahoma.ttf",
    ]
    for path in arabic_candidates:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont("AppArabic", path))
                fonts["arabic"] = "AppArabic"
                break
            except Exception:
                continue

    # Daftarkan family agar <b> bekerja
    if fonts["regular"] != "Helvetica":
        try:
            registerFontFamily(fonts["regular"],
                               normal=fonts["regular"],
                               bold=fonts["bold"],
                               italic=fonts["regular"],
                               boldItalic=fonts["bold"])
        except Exception:
            pass

    return fonts


FONTS = _register_fonts()
BASE_FONT = FONTS["regular"]
BASE_FONT_BOLD = FONTS["bold"]
ARABIC_FONT = FONTS["arabic"]


# Regex untuk deteksi karakter Arabic (Unicode blocks)
_ARABIC_RE = re.compile(r'[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]')


def _has_arabic(text):
    return bool(text and _ARABIC_RE.search(text))


def _shape_arabic(text):
    """Reshape & apply BiDi untuk Arabic text agar render dengan benar di ReportLab."""
    if not text or not ARABIC_SUPPORT:
        return text
    if not _has_arabic(text):
        return text
    try:
        reshaped = arabic_reshaper.reshape(text)
        return get_display(reshaped)
    except Exception:
        return text


# Faktor pembesar font untuk teks Arab (12pt → 18pt)
ARABIC_FONT_SCALE = 1.5


def _wrap_for_paragraph(text, base_size=11):
    """
    Untuk dipanggil sebelum text masuk ke Paragraph.
    Kalau ada Arab di dalamnya, bungkus segmen Arab dengan
    <font name='AppArabic' size='N'>...</font> dengan size = base_size * ARABIC_FONT_SCALE.
    """
    if not text:
        return ""
    if not _has_arabic(text):
        return text

    arab_size = round(base_size * ARABIC_FONT_SCALE)

    if not ARABIC_SUPPORT:
        # Tanpa reshaper, minimal pakai font yang punya glyph Arab + size lebih besar
        return f'<font name="{ARABIC_FONT}" size="{arab_size}">{text}</font>'

    # Split per kata, kelompokkan continuous Arabic runs
    result = []
    buf_arab = []
    buf_latin = []

    def flush_arab():
        if buf_arab:
            seg = " ".join(buf_arab)
            shaped = _shape_arabic(seg)
            result.append(f'<font name="{ARABIC_FONT}" size="{arab_size}">{shaped}</font>')
            buf_arab.clear()

    def flush_latin():
        if buf_latin:
            result.append(" ".join(buf_latin))
            buf_latin.clear()

    for word in text.split(" "):
        if _has_arabic(word):
            flush_latin()
            buf_arab.append(word)
        else:
            flush_arab()
            buf_latin.append(word)

    flush_arab()
    flush_latin()
    return " ".join(result)


def _styles():
    base = getSampleStyleSheet()
    styles = {
        "title": ParagraphStyle(
            "title", parent=base["Title"], fontSize=16,
            alignment=TA_CENTER, spaceAfter=6,
            fontName=BASE_FONT_BOLD
        ),
        "kop_title": ParagraphStyle(
            "kop_title", parent=base["Title"], fontSize=14,
            alignment=TA_CENTER, spaceAfter=2, fontName=BASE_FONT_BOLD
        ),
        "kop_sub": ParagraphStyle(
            "kop_sub", parent=base["Normal"], fontSize=10,
            alignment=TA_CENTER, spaceAfter=1,
            fontName=BASE_FONT
        ),
        "answer_section": ParagraphStyle(
            "answer_section", parent=base["Heading3"], fontSize=11,
            spaceBefore=10, spaceAfter=4, textColor=colors.HexColor("#1a4480"),
            fontName=BASE_FONT_BOLD
        ),
        "header": ParagraphStyle(
            "header", parent=base["Normal"], fontSize=11,
            alignment=TA_CENTER, spaceAfter=4,
            fontName=BASE_FONT
        ),
        "section": ParagraphStyle(
            "section", parent=base["Heading2"], fontSize=13,
            spaceBefore=12, spaceAfter=6, textColor=colors.HexColor("#1a4480"),
            fontName=BASE_FONT_BOLD
        ),
        "bacaan_title": ParagraphStyle(
            "bacaan_title", parent=base["Normal"], fontSize=11,
            spaceBefore=8, spaceAfter=4, fontName=BASE_FONT_BOLD,
            textColor=colors.HexColor("#333")
        ),
        "bacaan": ParagraphStyle(
            "bacaan", parent=base["Normal"], fontSize=10,
            alignment=TA_JUSTIFY, leftIndent=12, rightIndent=12,
            backColor=colors.HexColor("#f3f4f6"), borderPadding=8,
            spaceAfter=8,
            fontName=BASE_FONT
        ),
        "question": ParagraphStyle(
            "question", parent=base["Normal"], fontSize=11,
            alignment=TA_JUSTIFY, spaceBefore=6, spaceAfter=4,
            fontName=BASE_FONT
        ),
        "choice": ParagraphStyle(
            "choice", parent=base["Normal"], fontSize=10.5,
            leftIndent=20, spaceAfter=2,
            fontName=BASE_FONT
        ),
        "answer": ParagraphStyle(
            "answer", parent=base["Normal"], fontSize=11,
            spaceAfter=4, fontName=BASE_FONT_BOLD,
            textColor=colors.HexColor("#1a4480")
        ),
    }
    return styles


JENIS_LABEL = {
    "pilihan_ganda": "PILIHAN GANDA",
    "pilihan_ganda_kompleks": "PILIHAN GANDA KOMPLEKS (boleh lebih dari satu jawaban)",
    "benar_salah": "BENAR / SALAH",
    "penjodohan": "PENJODOHAN",
    "isian": "ISIAN SINGKAT",
    "essay": "URAIAN",
}


def _scale_image(path, max_width=None, max_height_cm=10, layout="1col"):
    """
    Return ReportLab Image scaled to fit within content area.
    max_width: jika None, pakai _content_width(layout). Untuk 2col akan dibatasi lebar 1 kolom.
    """
    try:
        with PILImage.open(path) as im:
            w, h = im.size
        if max_width is None:
            # Reserve sedikit padding (95% of content width)
            max_width = _content_width(layout) * 0.95
        max_h = max_height_cm * cm
        ratio = min(max_width / w, max_h / h, 1.0)
        return Image(path, width=w * ratio, height=h * ratio)
    except Exception:
        return None


def _escape(text):
    if text is None:
        return ""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _format_text(text, base_size=11):
    """
    Escape XML, lalu wrap Arabic segments dengan font khusus + reshaping.

    base_size: ukuran font teks utama (untuk skala font Arab 1.5x).
    Default 11 = ukuran 'question' style.
    """
    if text is None:
        return ""
    esc = _escape(text)
    return _wrap_for_paragraph(esc, base_size=base_size)


def _build_kop_header(kop, styles):
    """Build kop sekolah (logo + nama sekolah + alamat + kontak) as flowables."""
    if not kop:
        return []

    elements = []
    logo_path = kop.get("logo_path")
    has_logo = logo_path and os.path.exists(logo_path)

    nama = kop.get("nama_sekolah", "").strip()
    alamat = kop.get("alamat", "").strip()
    kontak = kop.get("kontak", "").strip()
    tahun = kop.get("tahun", "").strip()

    if not (has_logo or nama or alamat or kontak):
        return []

    # Kop layout: logo kiri, text tengah
    text_paras = []
    if nama:
        text_paras.append(Paragraph(_escape(nama.upper()), styles["kop_title"]))
    if alamat:
        text_paras.append(Paragraph(_escape(alamat), styles["kop_sub"]))
    if kontak:
        text_paras.append(Paragraph(_escape(kontak), styles["kop_sub"]))
    if tahun:
        text_paras.append(Paragraph(f"<b>Tahun Pelajaran {_escape(tahun)}</b>", styles["kop_sub"]))

    if has_logo:
        try:
            with PILImage.open(logo_path) as im:
                w, h = im.size
            max_dim = 2.2 * cm
            ratio = min(max_dim / w, max_dim / h)
            logo_img = Image(logo_path, width=w * ratio, height=h * ratio)
            kop_table = Table(
                [[logo_img, text_paras]],
                colWidths=[2.8 * cm, None],
            )
            kop_table.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (0, 0), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
            ]))
            elements.append(kop_table)
        except Exception:
            elements.extend(text_paras)
    else:
        elements.extend(text_paras)

    # Garis pemisah tebal di bawah kop
    from reportlab.platypus import HRFlowable
    elements.append(HRFlowable(width="100%", thickness=2, color=colors.black, spaceBefore=2, spaceAfter=2))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.black, spaceBefore=0, spaceAfter=6))
    return elements


def _build_answer_sheet(data, kop, styles):
    """Build LEMBAR JAWABAN: kop + identitas + grid jawaban per jenis soal."""
    elements = []

    # 1) Kop header
    elements.extend(_build_kop_header(kop, styles))

    # 2) Judul Lembar Jawaban
    judul_ujian = (kop or {}).get("judul_ujian", "").strip() or "LEMBAR JAWABAN"
    if judul_ujian.upper() != "LEMBAR JAWABAN":
        elements.append(Paragraph(_escape(judul_ujian.upper()), styles["kop_title"]))
        elements.append(Paragraph("LEMBAR JAWABAN", styles["kop_sub"]))
    else:
        elements.append(Paragraph("LEMBAR JAWABAN", styles["kop_title"]))
    elements.append(Spacer(1, 0.3 * cm))

    # 3) Identitas peserta — layout 2 kolom rapi (label : value)
    mapel = data.get("mata_pelajaran") or ""
    kelas = data.get("kelas") or ""
    # Tampilkan value kalau auto-fill, kosong kalau perlu diisi siswa
    mapel_val = _format_text(mapel, base_size=10) if mapel else ""
    kelas_val = _format_text(str(kelas), base_size=10) if kelas else ""

    identitas = Table(
        [
            ["Nama",           ":", "",         "Hari/Tanggal", ":", ""],
            ["Kelas",          ":", kelas_val,  "Waktu",        ":", ""],
            ["Mata Pelajaran", ":", mapel_val,  "Nilai",        ":", ""],
        ],
        colWidths=[3.0 * cm, 0.3 * cm, 5.5 * cm, 2.8 * cm, 0.3 * cm, 5.0 * cm],
    )
    identitas.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("FONTNAME", (0, 0), (-1, -1), BASE_FONT),
        ("FONTNAME", (0, 0), (0, -1), BASE_FONT_BOLD),
        ("FONTNAME", (3, 0), (3, -1), BASE_FONT_BOLD),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, -1), "CENTER"),
        ("ALIGN", (4, 0), (4, -1), "CENTER"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        # Garis bawah dotted untuk kolom isian (value)
        ("LINEBELOW", (2, 0), (2, -1), 0.7, colors.black, None, (1, 2)),
        ("LINEBELOW", (5, 0), (5, -1), 0.7, colors.black, None, (1, 2)),
        ("BOX", (0, 0), (-1, -1), 1.0, colors.black),
        ("LINEAFTER", (2, 0), (2, -1), 0.5, colors.grey),
    ]))
    elements.append(identitas)
    elements.append(Spacer(1, 0.4 * cm))

    # 4) Petunjuk
    elements.append(Paragraph(
        "<b>Petunjuk:</b> Untuk Pilihan Ganda, silanglah (X) huruf jawaban yang Anda anggap benar. "
        "Untuk Isian/Uraian, tulislah jawaban Anda di tempat yang disediakan.",
        styles["kop_sub"]
    ))
    elements.append(Spacer(1, 0.3 * cm))

    # 5) Grid jawaban — group by jenis
    groups = _group_by_jenis(data["soal"])
    for jenis, soal_list in groups:
        elements.append(Paragraph(JENIS_LABEL.get(jenis, jenis.upper()), styles["answer_section"]))

        if jenis == "pilihan_ganda":
            elements.append(_build_pg_grid(soal_list, complex=False))
        elif jenis == "pilihan_ganda_kompleks":
            elements.append(_build_pg_grid(soal_list, complex=True))
        elif jenis == "benar_salah":
            elements.append(_build_bs_grid(soal_list))
        elif jenis == "penjodohan":
            elements.append(_build_penjodohan_grid(soal_list))
        elif jenis == "isian":
            elements.append(_build_isian_grid(soal_list))
        elif jenis == "essay":
            elements.extend(_build_essay_grid(soal_list))

    return elements


def _build_pg_grid(soal_list, complex=False):
    """
    Layout PG ala lembar jawaban sekolah:
    Setiap nomor punya baris dengan huruf A B C D (text biasa) yang bisa dilingkari/disilang.
    Disusun 2 kolom (jika soal banyak) supaya hemat tempat.
    """
    # Cari max pilihan (apakah ada E juga?)
    keys = ["A", "B", "C", "D"]
    for s in soal_list:
        if s.get("pilihan", {}).get("E"):
            keys = ["A", "B", "C", "D", "E"]
            break

    # Build cell konten: "1.  A   B   C   D"
    cells = []
    for s in soal_list:
        nomor = s.get("nomor", "")
        # Spacing yang seragam dengan font monospace-like
        letters = "   ".join(keys)
        cells.append(f"<b>{nomor:>3}.</b>   {letters}")

    # Susun 2 kolom kalau soal > 6, sisanya 1 kolom
    if len(cells) > 6:
        # Pecah jadi 2 kolom
        mid = (len(cells) + 1) // 2
        left = cells[:mid]
        right = cells[mid:]
        # Padding kalau ganjil
        while len(right) < len(left):
            right.append("")
        rows = []
        for l, r in zip(left, right):
            rows.append([
                Paragraph(l, ParagraphStyle('pg', fontName=BASE_FONT, fontSize=11, leading=18)),
                Paragraph(r, ParagraphStyle('pg', fontName=BASE_FONT, fontSize=11, leading=18)),
            ])
        tbl = Table(rows, colWidths=[8.5 * cm, 8.5 * cm])
        tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LINEBETWEEN", (0, 0), (0, -1), 0.3, colors.lightgrey),
        ]))
    else:
        rows = [[Paragraph(c, ParagraphStyle('pg', fontName=BASE_FONT, fontSize=11, leading=18))] for c in cells]
        tbl = Table(rows, colWidths=[17 * cm])
        tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))

    if complex:
        # Note di atas tabel
        from reportlab.platypus import KeepTogether
        note = Paragraph(
            "<i>(PG Kompleks: boleh memilih lebih dari satu huruf)</i>",
            ParagraphStyle('note', fontName=BASE_FONT, fontSize=9,
                           textColor=colors.HexColor("#92400e"), spaceAfter=4)
        )
        return KeepTogether([note, tbl])
    return tbl


def _build_bs_grid(soal_list):
    """Format Benar/Salah ala lembar jawaban: '1. B  S' per nomor, 2-3 kolom."""
    cells = []
    for s in soal_list:
        nomor = s.get("nomor", "")
        cells.append(f"<b>{nomor:>3}.</b>   B   S")

    # 3 kolom kalau banyak
    if len(cells) > 6:
        per_col = (len(cells) + 2) // 3
        cols = [cells[i*per_col:(i+1)*per_col] for i in range(3)]
        # Pad
        max_len = max(len(c) for c in cols)
        for c in cols:
            while len(c) < max_len:
                c.append("")
        rows = []
        for i in range(max_len):
            rows.append([
                Paragraph(cols[j][i] if i < len(cols[j]) else "",
                          ParagraphStyle('bs', fontName=BASE_FONT, fontSize=11, leading=18))
                for j in range(3)
            ])
        tbl = Table(rows, colWidths=[5.7 * cm] * 3)
    else:
        rows = [[Paragraph(c, ParagraphStyle('bs', fontName=BASE_FONT, fontSize=11, leading=18))] for c in cells]
        tbl = Table(rows, colWidths=[17 * cm])

    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return tbl


def _build_penjodohan_grid(soal_list):
    """Penjodohan: '1. ___' per item kiri. Siswa isi huruf jawaban."""
    cells = []
    for s in soal_list:
        nomor = s.get("nomor", "")
        pasangan = s.get("pasangan", [])
        if pasangan:
            for i in range(len(pasangan)):
                label = f"{nomor}.{i+1}" if len(pasangan) > 1 else str(nomor)
                cells.append(f"<b>{label:>5}.</b>   _____")
        else:
            cells.append(f"<b>{nomor:>3}.</b>   _____")

    # 2-3 kolom
    if len(cells) > 6:
        per_col = (len(cells) + 1) // 2
        left = cells[:per_col]
        right = cells[per_col:]
        while len(right) < len(left):
            right.append("")
        rows = []
        for l, r in zip(left, right):
            rows.append([
                Paragraph(l, ParagraphStyle('pj', fontName=BASE_FONT, fontSize=11, leading=18)),
                Paragraph(r, ParagraphStyle('pj', fontName=BASE_FONT, fontSize=11, leading=18)),
            ])
        tbl = Table(rows, colWidths=[8.5 * cm, 8.5 * cm])
    else:
        rows = [[Paragraph(c, ParagraphStyle('pj', fontName=BASE_FONT, fontSize=11, leading=18))] for c in cells]
        tbl = Table(rows, colWidths=[17 * cm])

    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return tbl


def _build_isian_grid(soal_list):
    """Isian: nomor + garis jawaban horizontal yang konsisten."""
    from reportlab.platypus import HRFlowable

    # Pakai Table dengan 2 kolom: nomor + garis
    rows = []
    for s in soal_list:
        nomor = s.get("nomor", "")
        nomor_p = Paragraph(
            f"<b>{nomor}.</b>",
            ParagraphStyle('isn', fontName=BASE_FONT, fontSize=11, leading=14, alignment=TA_LEFT)
        )
        # Garis lebar penuh kolom
        line = HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#666666"))
        rows.append([nomor_p, line])
    tbl = Table(rows, colWidths=[1.2 * cm, 15.8 * cm])
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return tbl


def _build_essay_grid(soal_list, lines_per_question=5):
    """
    Essay: nomor + N baris garis simetris untuk menulis.
    Pakai HRFlowable agar setiap garis lebar penuh dan sama panjang.
    Jarak antar baris dipadatkan.
    """
    from reportlab.platypus import HRFlowable

    elements = []
    for idx, s in enumerate(soal_list):
        nomor = s.get("nomor", "")
        skor = s.get("skor_maksimal")
        header = f"<b>{nomor}.</b>"
        if skor:
            header += f' <font size="8" color="#92400e">(Skor maks: {skor})</font>'

        # Header soal
        elements.append(Paragraph(
            header,
            ParagraphStyle('eh', fontName=BASE_FONT, fontSize=11, leading=14, spaceAfter=4)
        ))

        # N garis horizontal: lebar penuh content area, jarak kecil & seragam
        for _ in range(lines_per_question):
            elements.append(HRFlowable(
                width="100%",
                thickness=0.5,
                color=colors.HexColor("#666666"),
                spaceBefore=8,    # jarak antar baris ~8 pt (sebelumnya leading=22 = ~22pt!)
                spaceAfter=0,
            ))

        # Spacing antar soal essay
        if idx < len(soal_list) - 1:
            elements.append(Spacer(1, 0.4 * cm))

    return elements


def _build_header(data, styles, doc_type="soal", show_identity=False):
    """Header: judul ulangan + Kelas + Mata Pelajaran (per baris)."""
    elements = []
    judul = data.get("judul") or "LEMBAR SOAL ULANGAN"
    if doc_type == "kunci":
        judul = "KUNCI JAWABAN — " + judul
    elements.append(Paragraph(_format_text(judul, base_size=16), styles["title"]))

    # Tampilkan Kelas dan Mapel di baris terpisah, center-aligned
    if data.get("kelas"):
        elements.append(Paragraph(
            f"<b>Kelas: {_format_text(str(data['kelas']), base_size=11)}</b>",
            styles["header"]
        ))
    if data.get("mata_pelajaran"):
        elements.append(Paragraph(
            f"<b>Mata Pelajaran: {_format_text(data['mata_pelajaran'], base_size=11)}</b>",
            styles["header"]
        ))

    if show_identity and doc_type == "soal":
        info_table = Table(
            [["Nama:", "_______________________", "Kelas:", "_______________"]],
            colWidths=[1.5 * cm, 7 * cm, 1.5 * cm, 5 * cm],
        )
        info_table.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("FONTNAME", (0, 0), (-1, -1), BASE_FONT),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
        ]))
        elements.append(info_table)

    elements.append(Spacer(1, 0.4 * cm))
    return elements


def _group_by_jenis(soal_list):
    """Group questions by jenis, preserving order."""
    groups = {}
    order = []
    for s in soal_list:
        j = s.get("jenis", "pilihan_ganda")
        if j not in groups:
            groups[j] = []
            order.append(j)
        groups[j].append(s)
    return [(j, groups[j]) for j in order]


def _render_bacaan(bacaan, styles):
    elements = []
    judul = bacaan.get("judul") or "Bacaan"
    elements.append(Paragraph(_format_text(judul, base_size=11), styles["bacaan_title"]))
    elements.append(Paragraph(_format_text(bacaan.get("isi", ""), base_size=10), styles["bacaan"]))
    return elements


def _render_soal(s, styles, image_dir, layout="1col"):
    """
    Render satu soal: HANYA pertanyaan + pilihan TEXT.
    Tidak ada lingkaran/kotak/garis pengisian — semua jawaban diisi di Lembar Jawaban.
    Tabel & gambar otomatis menyesuaikan lebar layout (1 kolom = full width, 2 kolom = setengah).
    """
    parts = []
    content_w = _content_width(layout)
    nomor = s.get("nomor", "")
    pertanyaan_fmt = _format_text(s.get("pertanyaan", ""), base_size=11)
    parts.append(Paragraph(f"<b>{nomor}.</b> {pertanyaan_fmt}", styles["question"]))

    if s.get("gambar"):
        img_path = s["gambar"]
        if not os.path.isabs(img_path):
            img_path = os.path.join(image_dir, os.path.basename(img_path))
        if os.path.exists(img_path):
            # Untuk 2col, batasi tinggi gambar juga
            max_h = 6 if layout == "2col" else 10
            img = _scale_image(img_path, max_height_cm=max_h, layout=layout)
            if img:
                parts.append(Spacer(1, 0.15 * cm))
                parts.append(img)
                parts.append(Spacer(1, 0.15 * cm))

    jenis = s.get("jenis")
    if jenis in ("pilihan_ganda", "pilihan_ganda_kompleks"):
        for key in ["A", "B", "C", "D", "E"]:
            if key in s.get("pilihan", {}):
                val = _format_text(s["pilihan"][key], base_size=10)
                parts.append(Paragraph(f"<b>{key}.</b> {val}", styles["choice"]))
    elif jenis == "penjodohan":
        pasangan = s.get("pasangan", [])
        if pasangan:
            # Tabel 2 kolom: lebar masing-masing kolom = (content_width - small gap) / 2
            gap = 0.3 * cm
            col_w = (content_w - gap) / 2
            rows = [["Kolom A", "Kolom B"]]
            kiri_items = [p.get("kiri", "") for p in pasangan]
            kanan_items = [p.get("kanan", "") for p in pasangan]
            max_len = max(len(kiri_items), len(kanan_items))
            # Style choice yang lebih kecil untuk muat di kolom sempit
            cell_style = ParagraphStyle(
                'cell', parent=styles["choice"],
                fontSize=9 if layout == "2col" else 10,
                leftIndent=0
            )
            for i in range(max_len):
                kiri = f"{i+1}. {_format_text(kiri_items[i], base_size=cell_style.fontSize)}" if i < len(kiri_items) else ""
                kanan = f"{chr(65+i)}. {_format_text(kanan_items[i], base_size=cell_style.fontSize)}" if i < len(kanan_items) else ""
                rows.append([
                    Paragraph(kiri, cell_style) if kiri else "",
                    Paragraph(kanan, cell_style) if kanan else "",
                ])
            tbl = Table(rows, colWidths=[col_w, col_w])
            tbl.setStyle(TableStyle([
                ("FONTSIZE", (0, 0), (-1, 0), 9 if layout == "2col" else 10),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e5e7eb")),
                ("FONTNAME", (0, 0), (-1, 0), BASE_FONT_BOLD),
                ("ALIGN", (0, 0), (-1, 0), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("GRID", (0, 0), (-1, -1), 0.3, colors.grey),
            ]))
            parts.append(tbl)
    elif jenis == "essay":
        skor = s.get("skor_maksimal")
        if skor:
            parts.append(Paragraph(f"<i>Skor maksimal: {skor}</i>", styles["choice"]))
    # benar_salah, isian → cukup pertanyaan saja, semua diisi di lembar jawaban

    parts.append(Spacer(1, 0.2 * cm))
    return parts


PAGE_MARGIN = 1 * cm  # margin semua sisi
SOAL_HEADER_HEIGHT = 2.6 * cm  # ruang untuk header "LEMBAR SOAL ULANGAN" di top page


def _content_width(layout="1col"):
    """Lebar isi yang tersedia (untuk tabel/image scaling)."""
    page_w, _ = A4
    usable = page_w - 2 * PAGE_MARGIN
    if layout == "2col":
        gutter = 0.6 * cm
        return (usable - gutter) / 2
    return usable


def _make_soal_frames(layout, top_offset=0):
    """
    Buat frame(s) untuk halaman soal.
    top_offset: ruang dikurangi dari atas (untuk reserve header area).
    """
    page_w, page_h = A4
    usable_w = page_w - 2 * PAGE_MARGIN
    usable_h = page_h - 2 * PAGE_MARGIN - top_offset
    bottom_y = PAGE_MARGIN

    if layout == "2col":
        gutter = 0.6 * cm
        col_w = (usable_w - gutter) / 2
        return [
            Frame(PAGE_MARGIN, bottom_y, col_w, usable_h,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=14,
                  id="soal_col1"),
            Frame(PAGE_MARGIN + col_w + gutter, bottom_y, col_w, usable_h,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=14,
                  id="soal_col2"),
        ]
    return [Frame(
        PAGE_MARGIN, bottom_y, usable_w, usable_h,
        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=14,
        id="soal_single"
    )]


def _draw_soal_header(canvas, doc):
    """
    Gambar HEADER soal di canvas (full-width, di atas frame kolom).
    Hanya untuk halaman pertama soal.
    """
    data = getattr(doc, "_soal_data", {})
    page_w, page_h = A4

    canvas.saveState()

    # Title "LEMBAR SOAL ULANGAN"
    judul = data.get("judul") or "LEMBAR SOAL ULANGAN"
    canvas.setFont(BASE_FONT_BOLD, 16)
    canvas.setFillColor(colors.black)
    y = page_h - PAGE_MARGIN - 0.5 * cm
    canvas.drawCentredString(page_w / 2, y, judul)

    # Kelas
    if data.get("kelas"):
        canvas.setFont(BASE_FONT_BOLD, 11)
        y -= 0.7 * cm
        canvas.drawCentredString(page_w / 2, y, f"Kelas: {data['kelas']}")

    # Mata Pelajaran
    if data.get("mata_pelajaran"):
        canvas.setFont(BASE_FONT_BOLD, 11)
        y -= 0.55 * cm
        canvas.drawCentredString(page_w / 2, y, f"Mata Pelajaran: {data['mata_pelajaran']}")

    # Garis pemisah di bawah header
    y -= 0.45 * cm
    canvas.setStrokeColor(colors.HexColor("#1a4480"))
    canvas.setLineWidth(0.8)
    canvas.line(PAGE_MARGIN, y, page_w - PAGE_MARGIN, y)

    canvas.restoreState()

    # Tetap gambar nomor halaman
    _draw_page_number(canvas, doc)


def _draw_page_number(canvas, doc):
    """Footer: nomor halaman pojok kanan bawah (mulai dari 1 di halaman soal).

    Karena lembar jawaban adalah page 1, halaman soal pertama = page 2.
    Kita display sebagai "Halaman 1" (offset -1).
    """
    canvas.saveState()
    canvas.setFont(BASE_FONT, 9)
    canvas.setFillColor(colors.grey)
    # Offset: lembar jawaban = page 1 absolut. Halaman soal nomor sendiri dimulai dari 1.
    offset = getattr(doc, "_soal_page_offset", 0)
    soal_page = canvas.getPageNumber() - offset
    if soal_page < 1:
        soal_page = canvas.getPageNumber()
    canvas.drawRightString(A4[0] - PAGE_MARGIN, PAGE_MARGIN * 0.5,
                           f"Halaman {soal_page}")
    canvas.restoreState()


def _draw_blank(canvas, doc):
    """Footer kosong untuk halaman lembar jawaban (tanpa nomor halaman)."""
    pass


def generate_soal_pdf(data, output_path, image_dir, kop=None, layout="1col"):
    """
    Generate PDF dengan struktur:
    - Page 1 = Lembar Jawaban (1 kolom, ada kop)
    - Page 2 (soal page 1) = Header "LEMBAR SOAL ULANGAN" di top + daftar soal (1 atau 2 kolom) di bawah
    - Page 3+ (soal page 2+) = Daftar soal lanjutan (1 atau 2 kolom), tanpa repeat header

    Footer page number "Halaman 1, 2, 3..." di pojok kanan bawah halaman soal saja.
    """
    styles = _styles()
    page_w, page_h = A4
    usable_w = page_w - 2 * PAGE_MARGIN
    usable_h_full = page_h - 2 * PAGE_MARGIN

    # Frame untuk lembar jawaban (1 kolom, full content area)
    answer_frame = Frame(
        PAGE_MARGIN, PAGE_MARGIN, usable_w, usable_h_full,
        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
        id="answer_sheet"
    )
    answer_template = PageTemplate(id="AnswerSheet", frames=[answer_frame], onPage=_draw_blank)

    # Frame untuk SOAL halaman pertama (dengan reserve untuk header)
    soal_first_frames = _make_soal_frames(layout, top_offset=SOAL_HEADER_HEIGHT)
    soal_first_template = PageTemplate(
        id="SoalFirst",
        frames=soal_first_frames,
        onPage=_draw_soal_header,  # gambar header + page number
        autoNextPageTemplate="SoalCont",  # halaman berikutnya pakai template tanpa header
    )

    # Frame untuk SOAL halaman 2+ (full height, hanya page number di footer)
    soal_cont_frames = _make_soal_frames(layout, top_offset=0)
    soal_cont_template = PageTemplate(
        id="SoalCont",
        frames=soal_cont_frames,
        onPage=_draw_page_number,
    )

    doc = BaseDocTemplate(
        output_path, pagesize=A4,
        leftMargin=PAGE_MARGIN, rightMargin=PAGE_MARGIN,
        topMargin=PAGE_MARGIN, bottomMargin=PAGE_MARGIN,
        pageTemplates=[answer_template, soal_first_template, soal_cont_template],
    )
    # Attach data ke doc agar callback header bisa baca
    doc._soal_data = data
    # Offset page number: lembar jawaban = 1 halaman → halaman soal pertama (absolut page 2) tampil sbg "Halaman 1"
    doc._soal_page_offset = 1

    elements = []

    # HALAMAN 1: LEMBAR JAWABAN
    elements.extend(_build_answer_sheet(data, kop or {}, styles))

    # Switch ke template SoalFirst untuk halaman berikutnya
    elements.append(NextPageTemplate("SoalFirst"))
    elements.append(PageBreak())

    # HALAMAN SOAL: Header sudah di-draw oleh canvas (onPage),
    # langsung mulai dengan daftar soal — TIDAK perlu _build_header sebagai flowable lagi.

    bacaan_map = {b.get("id"): b for b in data.get("bacaan_list", [])}
    used_bacaan = set()

    groups = _group_by_jenis(data["soal"])
    for jenis, soal_list in groups:
        elements.append(Paragraph(JENIS_LABEL.get(jenis, jenis.upper()), styles["section"]))
        for s in soal_list:
            bid = s.get("bacaan_id")
            if bid and bid in bacaan_map and bid not in used_bacaan:
                elements.extend(_render_bacaan(bacaan_map[bid], styles))
                used_bacaan.add(bid)
            elements.extend(_render_soal(s, styles, image_dir, layout=layout))

    doc.build(elements)
    return output_path


def generate_kunci_pdf(data, output_path, kop=None, layout="1col"):
    """Generate PDF kunci jawaban dengan page number footer."""
    styles = _styles()
    page_w, page_h = A4
    usable_w = page_w - 2 * PAGE_MARGIN
    usable_h = page_h - 2 * PAGE_MARGIN

    if layout == "2col":
        gutter = 0.6 * cm
        col_w = (usable_w - gutter) / 2
        frames = [
            Frame(PAGE_MARGIN, PAGE_MARGIN, col_w, usable_h,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=14),
            Frame(PAGE_MARGIN + col_w + gutter, PAGE_MARGIN, col_w, usable_h,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=14),
        ]
    else:
        frames = [Frame(
            PAGE_MARGIN, PAGE_MARGIN, usable_w, usable_h,
            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=14
        )]

    template = PageTemplate(id="Kunci", frames=frames, onPage=_draw_page_number)

    doc = BaseDocTemplate(
        output_path, pagesize=A4,
        leftMargin=PAGE_MARGIN, rightMargin=PAGE_MARGIN,
        topMargin=PAGE_MARGIN, bottomMargin=PAGE_MARGIN,
        pageTemplates=[template],
    )

    elements = []
    if kop and (kop.get("nama_sekolah") or kop.get("logo_path")):
        elements.extend(_build_kop_header(kop, styles))
    elements.extend(_build_header(data, styles, "kunci"))

    groups = _group_by_jenis(data["soal"])
    for jenis, soal_list in groups:
        elements.append(Paragraph(JENIS_LABEL.get(jenis, jenis.upper()), styles["section"]))
        for s in soal_list:
            nomor = s.get("nomor")
            kunci = s.get("kunci")
            text = _format_kunci(s, kunci)
            elements.append(Paragraph(f"<b>{nomor}.</b> {text}", styles["answer"]))

    doc.build(elements)
    return output_path


def _format_kunci(s, kunci):
    jenis = s.get("jenis")
    if kunci is None:
        return "<i>(belum ditentukan)</i>"
    if jenis == "pilihan_ganda":
        return f"{kunci}"
    if jenis == "pilihan_ganda_kompleks":
        if isinstance(kunci, list):
            return ", ".join(kunci)
        return str(kunci)
    if jenis == "benar_salah":
        return "BENAR" if kunci is True or str(kunci).lower() in ("benar", "true") else "SALAH"
    if jenis == "penjodohan":
        pasangan = s.get("pasangan", [])
        lines = []
        for i, p in enumerate(pasangan):
            lines.append(f"{i+1} → {p.get('kanan', '')}")
        return "<br/>".join(lines)
    if jenis == "essay":
        skor = s.get("skor_maksimal")
        text = _format_text(str(kunci))
        if skor:
            text = f"<font size=9>(Skor maks: {skor})</font><br/>{text}"
        return text
    if jenis == "isian":
        return _format_text(str(kunci))
    return _format_text(str(kunci))
