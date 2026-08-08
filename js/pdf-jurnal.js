// ── EKSPOR PDF: LAPORAN JURNAL BULANAN PER GURU ──
// Menghasilkan berkas PDF siap cetak/tanda tangan: kop madrasah, identitas
// guru, tabel jurnal per pertemuan selama satu bulan, lalu blok tanda tangan.
//
// Library jsPDF + autoTable dimuat lazy dari CDN (pola yang sama dengan
// SheetJS untuk ekspor Excel) supaya tidak membebani muat awal aplikasi.

import { MONTHS, DF, KBC_VALUES } from "./constants.js";
import { dk, fmtTanggal, rombelDoc } from "./utils.js";

const CDN_JSPDF = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
const CDN_AUTOTABLE = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js';

// Warna kop & header tabel (sage, mengikuti tema aplikasi).
export const SAGE = [90, 155, 134];

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res();
    s.onerror = () => rej(new Error('Gagal memuat ' + src));
    document.head.appendChild(s);
  });
}

let _pdfLoad = null;
// Muat jsPDF lalu plugin autoTable (urutan wajib: plugin butuh window.jspdf).
export function ensurePDF() {
  if (window.jspdf?.jsPDF?.API?.autoTable) return Promise.resolve(window.jspdf.jsPDF);
  if (!_pdfLoad) {
    _pdfLoad = loadScript(CDN_JSPDF)
      .then(() => loadScript(CDN_AUTOTABLE))
      .then(() => {
        if (!window.jspdf?.jsPDF?.API?.autoTable) throw new Error('Library PDF tidak lengkap');
        return window.jspdf.jsPDF;
      })
      .catch(e => { _pdfLoad = null; throw e; });
  }
  return _pdfLoad;
}

// Font bawaan jsPDF memakai WinAnsi. Guru sering menyalin teks dari Word yang
// mengandung kutip/strip "pintar" — ganti ke padanan ASCII agar tidak jadi
// karakter aneh di PDF.
export function wa(s) {
  return String(s ?? '')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\u00a0/g, ' ');
}

// "2026-07" → "Juli 2026"
export function namaBulan(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return `${MONTHS[m - 1] || ''} ${y}`;
}

// "2026-07-29" → "Rabu\n29-07-2026" (dua baris agar kolom tetap sempit)
function tglSel(key) {
  if (!key) return '-';
  const [y, m, d] = key.split('-').map(Number);
  const hari = DF[new Date(y, m - 1, d).getDay()];
  return `${hari}\n${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;
}

const kbcLabel = k => KBC_VALUES.find(v => v.key === k)?.label || k;

/**
 * Bangun dokumen PDF laporan jurnal bulanan seorang guru.
 * @param {object} o
 * @param {object} o.sekolah  pengaturan sekolah (nama, tahunPelajaran, semester, kota, kepala, nipKepala)
 * @param {object} o.guru     {nama, nip, mapel[]}
 * @param {string} o.ym       bulan "YYYY-MM"
 * @param {Array}  o.list     jurnal bulan tsb (akan diurutkan berdasar tanggal)
 * @returns {Promise<object>} instance jsPDF
 */
export async function buildJurnalBulananPDF({ sekolah, guru, ym, list }) {
  const jsPDF = await ensurePDF();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth();   // 297 mm
  const PH = doc.internal.pageSize.getHeight();  // 210 mm
  const M = 12;                                  // margin kiri/kanan

  const rows = [...list].sort((a, b) =>
    (a.tanggal || '').localeCompare(b.tanggal || '') || (a.createdAt || 0) - (b.createdAt || 0));

  // ── Kop madrasah (halaman 1) ──
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(0, 0, 0);
  doc.text('JURNAL MENGAJAR GURU', PW / 2, 15, { align: 'center' });
  doc.setFontSize(12);
  doc.text(wa(sekolah.nama || '').toUpperCase(), PW / 2, 21, { align: 'center' });
  doc.setFont('helvetica', 'normal').setFontSize(9);
  doc.text('Kurikulum Merdeka berbasis KBC (Kurikulum Berbasis Cinta)', PW / 2, 26, { align: 'center' });
  doc.text(`Tahun Pelajaran ${wa(sekolah.tahunPelajaran || '-')}  -  Semester ${wa(sekolah.semester || '-')}`,
    PW / 2, 30.5, { align: 'center' });
  doc.setDrawColor(...SAGE).setLineWidth(0.8);
  doc.line(M, 33, PW - M, 33);
  doc.setLineWidth(0.25);
  doc.line(M, 34.2, PW - M, 34.2);

  // ── Identitas guru & periode (dua kolom) ──
  const total = { H: 0, S: 0, I: 0, A: 0 };
  for (const j of rows) {
    const r = j.rekap || {};
    for (const k of ['H', 'S', 'I', 'A']) total[k] += r[k] || 0;
  }
  const kiri = [
    ['Nama Guru', wa(guru.nama || '-')],
    ['NIP / NUPTK', wa(guru.nip || '-')],
    ['Mata Pelajaran', wa((guru.mapel || []).join(', ') || '-')],
  ];
  const kanan = [
    ['Bulan', namaBulan(ym)],
    ['Jumlah Pertemuan', `${rows.length} pertemuan`],
    ['Rekap Kehadiran', `H ${total.H}  |  S ${total.S}  |  I ${total.I}  |  A ${total.A}`],
  ];
  doc.setFontSize(9.5);
  const barisIdentitas = (pairs, x, labelW) => pairs.forEach(([l, v], i) => {
    const y = 41 + i * 5;
    doc.setFont('helvetica', 'normal').text(l, x, y);
    doc.text(':', x + labelW, y);
    doc.setFont('helvetica', 'bold').text(v, x + labelW + 3, y, { maxWidth: 92 });
  });
  barisIdentitas(kiri, M, 30);
  barisIdentitas(kanan, PW / 2 + 6, 33);

  // Kop ringkas untuk setiap halaman selain halaman pertama.
  const kopLanjutan = () => {
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(0, 0, 0);
    doc.text(`Jurnal Mengajar - ${wa(guru.nama || '')} - ${namaBulan(ym)} (lanjutan)`, M, 11);
    doc.setDrawColor(...SAGE).setLineWidth(0.4);
    doc.line(M, 12.8, PW - M, 12.8);
  };

  // ── Tabel jurnal ──
  const head = [
    [
      { content: 'No', rowSpan: 2 },
      { content: 'Hari / Tanggal', rowSpan: 2 },
      { content: 'Jam\nke', rowSpan: 2 },
      { content: 'Rombel', rowSpan: 2 },
      { content: 'Mata Pelajaran', rowSpan: 2 },
      { content: 'Materi & Tujuan Pembelajaran', rowSpan: 2 },
      { content: 'Kegiatan / Metode / Asesmen', rowSpan: 2 },
      { content: 'Integrasi Nilai Cinta (KBC)', rowSpan: 2 },
      { content: 'Kehadiran', colSpan: 4 },
    ],
    ['H', 'S', 'I', 'A'],
  ];

  const body = rows.map((j, i) => {
    const materi = [
      wa(j.materi || '-'),
      j.tujuan ? 'TP: ' + wa(j.tujuan) : '',
    ].filter(Boolean).join('\n');
    const kegiatan = [
      wa(j.kegiatan || ''),
      j.metode ? 'Metode: ' + wa(j.metode) : '',
      j.asesmen ? 'Asesmen: ' + wa(j.asesmen) : '',
    ].filter(Boolean).join('\n') || '-';
    const kbc = [
      (j.kbc || []).map(kbcLabel).join(', '),
      j.kbcCatatan ? wa(j.kbcCatatan) : '',
    ].filter(Boolean).join('\n') || '-';
    // Kelas gabungan (7A+7B) diisi sekali, tetapi kehadirannya dicetak
    // terpisah: tiap rombel satu baris di dalam sel — nama rombel dan angka
    // H/S/I/A sejajar, sehingga jumlah pertemuan tetap apa adanya.
    const rombel = rombelDoc(j);
    const gabungan = rombel.length > 1;
    const rekapR = j.rekapRombel || {};
    const sel = (kunci) => gabungan
      ? rombel.map(r => rekapR[r]?.[kunci] ?? 0).join('\n')
      : (j.rekap?.[kunci] ?? 0);
    return [
      i + 1, tglSel(j.tanggal), wa(j.jamKe || '-'),
      wa(rombel.join('\n') || j.rombel || '-'), wa(j.mapel || '-'),
      materi, kegiatan, kbc,
      sel('H'), sel('S'), sel('I'), sel('A'),
    ];
  });

  doc.autoTable({
    head, body,
    startY: 58,
    margin: { top: 16, left: M, right: M, bottom: 16 },
    theme: 'grid',
    styles: {
      font: 'helvetica', fontSize: 7.2, cellPadding: 1.6, valign: 'top',
      lineColor: [190, 190, 190], lineWidth: 0.15, textColor: [25, 25, 25], overflow: 'linebreak',
    },
    headStyles: {
      fillColor: SAGE, textColor: [255, 255, 255], fontStyle: 'bold',
      fontSize: 7.4, halign: 'center', valign: 'middle', lineColor: [255, 255, 255], lineWidth: 0.15,
    },
    alternateRowStyles: { fillColor: [246, 250, 248] },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 24 },
      2: { cellWidth: 11, halign: 'center' },
      3: { cellWidth: 13, halign: 'center' },
      4: { cellWidth: 28 },
      5: { cellWidth: 60 },
      6: { cellWidth: 53 },
      7: { cellWidth: 40 },
      8: { cellWidth: 9, halign: 'center' },
      9: { cellWidth: 9, halign: 'center' },
      10: { cellWidth: 9, halign: 'center' },
      11: { cellWidth: 9, halign: 'center' },
    },
    // Halaman lanjutan: judul ringkas agar tetap jelas saat dicetak terpisah.
    didDrawPage: (data) => { if (data.pageNumber > 1) kopLanjutan(); },
  });

  // ── Catatan kelas gabungan + blok tanda tangan ──
  // Rombel setingkat belajar di satu ruang: satu pertemuan dicatat sekali,
  // kehadirannya dirinci per rombel pada baris yang bersesuaian.
  const adaGabungan = rows.some(j => rombelDoc(j).length > 1);
  const BLOK_H = 42 + (adaGabungan ? 8 : 0);
  let y = (doc.lastAutoTable?.finalY || 58) + 10;
  // Jangan sampai blok tanda tangan terpotong: pindahkan utuh ke halaman baru.
  if (y + BLOK_H > PH - 14) { doc.addPage(); kopLanjutan(); y = 24; }
  if (adaGabungan) {
    doc.setFont('helvetica', 'italic').setFontSize(7.5).setTextColor(90, 90, 90);
    doc.text('Catatan: rombel setingkat belajar dalam satu ruang, sehingga satu pertemuan dicatat sekali. '
      + 'Kolom Rombel dan Kehadiran dirinci per rombel pada baris yang sama.', M, y, { maxWidth: PW - 2 * M });
    doc.setTextColor(0, 0, 0);
    y += 8;
  }

  const kota = wa(sekolah.kota || '').trim();
  const tglCetak = fmtTanggal(dk());
  const kolomTtd = (x, baris1, baris2, nama, nip, align) => {
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(0, 0, 0);
    doc.text(baris1, x, y, { align });
    doc.text(baris2, x, y + 5, { align });
    doc.setFont('helvetica', 'bold');
    const namaTeks = nama || '(..............................................)';
    doc.text(namaTeks, x, y + 27, { align });
    doc.setFont('helvetica', 'normal').setFontSize(8.5);
    doc.text('NIP. ' + (nip || '.........................'), x, y + 32, { align });
  };
  kolomTtd(M, 'Mengetahui,', 'Kepala Madrasah',
    wa(sekolah.kepala || ''), wa(sekolah.nipKepala || ''), 'left');
  kolomTtd(PW - M, (kota ? kota + ', ' : '') + tglCetak, 'Guru Mata Pelajaran',
    wa(guru.nama || ''), wa(guru.nip || ''), 'right');

  // ── Nomor halaman (setelah jumlah halaman final diketahui) ──
  const n = doc.internal.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(120, 120, 120);
    doc.text(`Halaman ${p} dari ${n}`, PW - M, PH - 6, { align: 'right' });
    doc.text(`Dicetak: ${tglCetak}`, M, PH - 6);
  }

  return doc;
}

// Nama berkas: jurnal_mengajar_nama_guru_2026-07.pdf
export function namaFilePDF(namaGuru, ym) {
  const slug = String(namaGuru || 'guru').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'guru';
  return `jurnal_mengajar_${slug}_${ym}.pdf`;
}

// PWA standalone iOS: doc.save() (blob) kadang gagal → fallback data URI.
export function pdfDownload(doc, filename) {
  if (window.navigator.standalone) {
    const a = document.createElement('a');
    a.href = doc.output('datauristring');
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    return;
  }
  doc.save(filename);
}
