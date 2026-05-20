"""Parser Word (.docx) — ekstrak teks dengan urutan dan gambar dengan posisi.

Pendekatan: walk seluruh XML body untuk menangkap text di lokasi non-standard:
- Paragraph normal (<w:p>)
- Tabel (<w:tbl>)
- Text box di drawing (<w:txbxContent>, <mc:AlternateContent>)
- Math equation (<m:t>, <m:r>)
- Symbol (<w:sym>) → diabaikan jika hanya font wingdings
"""
import os
import re
import zipfile
from lxml import etree


# Namespace prefix → URI
NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "v": "urn:schemas-microsoft-com:vml",
    "w10": "urn:schemas-microsoft-com:office:word",
}

# Tag name (with full namespace) untuk berbagai jenis elemen
T_TEXT = f"{{{NS['w']}}}t"            # Word run text
T_TAB = f"{{{NS['w']}}}tab"
T_BR = f"{{{NS['w']}}}br"
T_PARA = f"{{{NS['w']}}}p"
T_TABLE = f"{{{NS['w']}}}tbl"
T_ROW = f"{{{NS['w']}}}tr"
T_CELL = f"{{{NS['w']}}}tc"
T_BODY = f"{{{NS['w']}}}body"
T_RUN = f"{{{NS['w']}}}r"
T_TXBX_CONTENT = f"{{{NS['w']}}}txbxContent"
T_MATH_T = f"{{{NS['m']}}}t"           # Math text
T_MATH_R = f"{{{NS['m']}}}r"
T_DRAWING = f"{{{NS['w']}}}drawing"
T_BLIP = f"{{{NS['a']}}}blip"
T_PIC = f"{{{NS['a']}}}pic"

EMBED_ATTR = f"{{{NS['r']}}}embed"


def parse_docx(file_path, image_output_dir):
    """Parse .docx into ordered list of blocks: [{type, content, index}]."""
    os.makedirs(image_output_dir, exist_ok=True)

    # Ekstrak gambar dari archive zip dulu, plus index relationship
    image_map = _extract_images(file_path, image_output_dir)
    rels = _read_relationships(file_path)

    # Parse XML dengan lxml supaya dapat semua text node
    with zipfile.ZipFile(file_path, 'r') as z:
        xml_data = z.read("word/document.xml")
    root = etree.fromstring(xml_data)

    body = root.find(T_BODY)
    if body is None:
        return []

    blocks = []
    counter = {"i": 0}

    # Use list of strings per "current paragraph" to assemble before flushing
    para_buffer = []

    def flush_paragraph():
        if not para_buffer:
            return
        joined = "".join(para_buffer).strip()
        para_buffer.clear()
        if not joined:
            return
        blocks.append({"type": "text", "content": joined, "index": counter["i"]})
        counter["i"] += 1

    def add_text(text):
        if not text:
            return
        para_buffer.append(text)

    def add_paragraph_break():
        flush_paragraph()

    def add_image(filename):
        # Flush current paragraph first agar gambar muncul di posisi yang benar
        flush_paragraph()
        blocks.append({"type": "image", "content": filename, "index": counter["i"]})
        counter["i"] += 1

    _walk(body, add_text, add_paragraph_break, add_image, image_map, rels)
    # Flush any remaining buffer
    flush_paragraph()
    return blocks


def _walk(elem, add_text, add_para_break, add_image, image_map, rels):
    """Recursive walk over Word XML. Collect text, images, paragraph breaks."""
    tag = elem.tag

    if tag == T_TEXT or tag == T_MATH_T:
        if elem.text:
            add_text(elem.text)
        return

    if tag == T_TAB:
        add_text("\t")
        return

    if tag == T_BR:
        add_text("\n")
        return

    if tag == T_BLIP:
        embed = elem.get(EMBED_ATTR)
        if embed and embed in rels:
            target = rels[embed]
            filename = os.path.basename(target)
            if filename in image_map:
                add_image(image_map[filename])
        return

    # Untuk paragraph, kumpulkan semua teks anak-anaknya lalu beri break di akhir
    if tag == T_PARA:
        for child in elem:
            _walk(child, add_text, add_para_break, add_image, image_map, rels)
        add_para_break()
        return

    # Untuk cell tabel: setiap cell sebagai unit, beri tab pemisah
    if tag == T_CELL:
        # Cell content
        for child in elem:
            _walk(child, add_text, add_para_break, add_image, image_map, rels)
        add_text(" | ")  # pemisah antar cell
        return

    if tag == T_ROW:
        for child in elem:
            _walk(child, add_text, add_para_break, add_image, image_map, rels)
        add_para_break()
        return

    # Untuk semua tag lainnya, recurse ke child (text box, drawing wrapper, dll)
    for child in elem:
        _walk(child, add_text, add_para_break, add_image, image_map, rels)


def _extract_images(docx_path, output_dir):
    """Extract all images from docx/word/media to output_dir."""
    image_map = {}
    with zipfile.ZipFile(docx_path, 'r') as z:
        for name in z.namelist():
            if name.startswith('word/media/'):
                filename = os.path.basename(name)
                save_path = os.path.join(output_dir, filename)
                with open(save_path, 'wb') as f:
                    f.write(z.read(name))
                image_map[filename] = save_path
    return image_map


def _read_relationships(docx_path):
    """Read word/_rels/document.xml.rels → {rId: targetPath}."""
    rels = {}
    try:
        with zipfile.ZipFile(docx_path, 'r') as z:
            data = z.read("word/_rels/document.xml.rels")
        rels_xml = etree.fromstring(data)
        # rels namespace
        ns = "http://schemas.openxmlformats.org/package/2006/relationships"
        for r in rels_xml.findall(f"{{{ns}}}Relationship"):
            rels[r.get("Id")] = r.get("Target")
    except Exception:
        pass
    return rels


def blocks_to_text(blocks):
    """Convert blocks to a single annotated text string for AI consumption."""
    lines = []
    for b in blocks:
        if b["type"] == "text":
            lines.append(b["content"])
        elif b["type"] == "image":
            lines.append(f"[GAMBAR: {os.path.basename(b['content'])}]")
    return "\n".join(lines)
