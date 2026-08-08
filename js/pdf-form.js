// ── FORMULIR CETAK: JURNAL & DAFTAR HADIR KOSONG ──
// Untuk guru yang tidak bisa online: admin mencetak sekali di awal semester,
// guru mengisinya dengan tangan, lalu disalin ke aplikasi saat ada koneksi.
//
// Isi berkas:
//  1. Lembar jurnal mengajar kosong — identitas guru & mapel sengaja dibiarkan
//     titik-titik agar satu berkas bisa difotokopi untuk semua guru.
//  2. Lembar daftar hadir per rombel — nama siswa SUDAH tercetak (bagian yang
//     paling melelahkan bila ditulis tangan), kolom pertemuan dikosongkan.
//
// Library jsPDF + autoTable dipakai bersama modul pdf-jurnal.js (lazy dari CDN).

import { ensurePDF, wa, SAGE } from "./pdf-jurnal.js";
import { KBC_VALUES, ABSEN_STATUS } from "./constants.js";
import { dk, fmtTanggal } from "./utils.js";

const M = 12;            // margin kiri/kanan (mm)
const TINGGI_BARIS = 13; // tinggi baris jurnal — cukup untuk tulisan tangan

// Titik-titik isian: dipakai untuk data yang sengaja dikosongkan.
const TITIK = '.'.repeat(60);

// Baris identitas "Label : isian" pada bagian atas lembar.
function barisIdentitas(doc, pairs, x, labelW, y0, lebarNilai) {
  pairs.forEach(([label, nilai], i) => {
    const y = y0 + i * 5;
    doc.setFont('helvetica', 'normal').setFontSize(9.5).text(label, x, y);
    doc.text(':', x + labelW, y);
    if (nilai) doc.setFont('helvetica', 'bold');
    doc.text(nilai || TITIK, x + labelW + 3, y, { maxWidth: lebarNilai });
  });
}

// Kop madrasah di setiap lembar formulir.
function kop(doc, sekolah, judul, PW) {
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(0, 0, 0);
  doc.text(judul, PW / 2, 15, { align: 'center' });
  doc.setFontSize(11.5);
  doc.text(wa(sekolah.nama || '').toUpperCase(), PW / 2, 20.5, { align: 'center' });
  doc.setFont('helvetica', 'normal').setFontSize(9);
  doc.text('Kurikulum Merdeka berbasis KBC (Kurikulum Berbasis Cinta)', PW / 2, 25, { align: 'center' });
  doc.text(`Tahun Pelajaran ${wa(sekolah.tahunPelajaran || '-')}  -  Semester ${wa(sekolah.semester || '-')}`,
    PW / 2, 29.5, { align: 'center' });
  doc.setDrawColor(...SAGE).setLineWidth(0.8);
  doc.line(M, 32, PW - M, 32);
  doc.setLineWidth(0.25);
  doc.line(M, 33.2, PW - M, 33.2);
}

// Kop ringkas untuk halaman lanjutan.
function kopLanjutan(doc, teks, PW) {
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(0, 0, 0);
  doc.text(wa(teks) + ' (lanjutan)', M, 11);
  doc.setDrawColor(...SAGE).setLineWidth(0.4);
  doc.line(M, 12.8, PW - M, 12.8);
}

// Blok tanda tangan guru & kepala madrasah. `ruang` mengatur tinggi ruang
// tanda tangan (lembar daftar hadir dibuat lebih ringkas agar muat sehalaman).
function blokTtd(doc, sekolah, y, PW, ruang = 27) {
  const kota = wa(sekolah.kota || '').trim();
  const kolom = (x, baris1, baris2, nama, nip, align) => {
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(0, 0, 0);
    doc.text(baris1, x, y, { align });
    doc.text(baris2, x, y + 5, { align });
    doc.setFont('helvetica', 'bold');
    doc.text(nama || '(..............................................)', x, y + ruang, { align });
    doc.setFont('helvetica', 'normal').setFontSize(8.5);
    doc.text('NIP. ' + (nip || '.........................'), x, y + ruang + 5, { align });
  };
  kolom(M, 'Mengetahui,', 'Kepala Madrasah',
    wa(sekolah.kepala || ''), wa(sekolah.nipKepala || ''), 'left');
  // Tanggal & nama guru dikosongkan — diisi guru saat menandatangani.
  kolom(PW - M, (kota ? kota + ', ' : '') + '....................................',
    'Guru Mata Pelajaran', '', '', 'right');
}

// ── 1. LEMBAR JURNAL KOSONG ──

// Susunan kolom tabel jurnal kosong — dipakai saat mengukur maupun mencetak.
function opsiTabelJurnal(body, kopHalaman) {
  return {
    head: [
      [
        { content: 'No', rowSpan: 2 },
        { content: 'Hari / Tanggal', rowSpan: 2 },
        { content: 'Jam\nke', rowSpan: 2 },
        { content: 'Rombel', rowSpan: 2 },
        { content: 'Mata Pelajaran', rowSpan: 2 },
        { content: 'Materi & Tujuan Pembelajaran', rowSpan: 2 },
        { content: 'Kegiatan / Metode / Asesmen', rowSpan: 2 },
        { content: 'KBC\n(kode)', rowSpan: 2 },
        { content: 'Kehadiran', colSpan: 4 },
      ],
      ['H', 'S', 'I', 'A'],
    ],
    body,
    startY: 65,
    margin: { top: 16, left: M, right: M, bottom: 14 },
    theme: 'grid',
    styles: {
      font: 'helvetica', fontSize: 8, cellPadding: 1.6, valign: 'top',
      minCellHeight: TINGGI_BARIS,
      lineColor: [150, 150, 150], lineWidth: 0.15, textColor: [25, 25, 25],
    },
    headStyles: {
      fillColor: SAGE, textColor: [255, 255, 255], fontStyle: 'bold',
      fontSize: 7.6, halign: 'center', valign: 'middle',
      lineColor: [255, 255, 255], lineWidth: 0.15, minCellHeight: 5,
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 24 },
      2: { cellWidth: 10, halign: 'center' },
      3: { cellWidth: 13, halign: 'center' },
      4: { cellWidth: 24 },
      5: { cellWidth: 72 },
      6: { cellWidth: 70 },
      7: { cellWidth: 14, halign: 'center' },
      8: { cellWidth: 9.5, halign: 'center' },
      9: { cellWidth: 9.5, halign: 'center' },
      10: { cellWidth: 9.5, halign: 'center' },
      11: { cellWidth: 9.5, halign: 'center' },
    },
    didDrawPage: kopHalaman,
  };
}

function barisKosong(n) {
  return Array.from({ length: n }, (_, i) => [i + 1, '', '', '', '', '', '', '', '', '', '', '']);
}

// Berapa baris kosong yang muat agar hasilnya PAS sebanyak halaman diminta,
// dengan sisa ruang untuk blok tanda tangan di halaman terakhir. Diukur pada
// dokumen sekali pakai — lebih andal daripada menebak dari tinggi baris,
// dan tetap benar bila tata letak tabel diubah.
function barisMuat(jsPDF, halaman, PH) {
  const ukur = (n) => {
    const uji = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    uji.autoTable(opsiTabelJurnal(barisKosong(n)));
    return { hal: uji.internal.getNumberOfPages(), akhir: uji.lastAutoTable?.finalY || 0 };
  };
  // Jumlah halaman naik monoton terhadap jumlah baris, jadi aman dicari biner.
  let lo = 1, hi = halaman * 15 + 5;
  while (lo < hi) {
    const tengah = Math.ceil((lo + hi) / 2);
    if (ukur(tengah).hal <= halaman) lo = tengah; else hi = tengah - 1;
  }
  // Lalu kurangi beberapa baris terakhir sampai blok tanda tangan ikut muat.
  while (lo > 1 && ukur(lo).akhir + 10 + 42 > PH - 14) lo--;
  return lo;
}

function lembarJurnal(doc, { sekolah, halaman, PW, PH, jsPDF }) {
  kop(doc, sekolah, 'FORMULIR JURNAL MENGAJAR GURU', PW);
  barisIdentitas(doc, [['Nama Guru', ''], ['NIP / NUPTK', ''], ['Mata Pelajaran', '']], M, 30, 40, 92);
  barisIdentitas(doc, [
    ['Semester', `${wa(sekolah.semester || '-')} - TP ${wa(sekolah.tahunPelajaran || '-')}`],
    ['Rombel / Kelas', ''],
    ['Bulan', ''],
  ], PW / 2 + 6, 33, 40, 92);

  // Kode KBC dicetak sebagai legenda supaya guru cukup menulis angkanya.
  doc.setFont('helvetica', 'normal').setFontSize(7.6).setTextColor(70, 70, 70);
  doc.text('Kode KBC: ' + KBC_VALUES.map((v, i) => `${i + 1}=${wa(v.label)}`).join('  ·  '), M, 57.5);
  doc.text('Kehadiran: ' + ABSEN_STATUS.map(s => `${s.key}=${s.label}`).join('  ·  ')
    + '  (tulis jumlah siswa pada tiap kolom; rincian per siswa pada lembar daftar hadir)', M, 61.5);
  doc.setTextColor(0, 0, 0);

  // Nomor urut baris tetap dicetak agar mudah dirujuk saat disalin ke aplikasi.
  doc.autoTable(opsiTabelJurnal(
    barisKosong(barisMuat(jsPDF, halaman, PH)),
    (data) => { if (data.pageNumber > 1) kopLanjutan(doc, 'Formulir Jurnal Mengajar', PW); },
  ));

  let y = (doc.lastAutoTable?.finalY || 65) + 10;
  if (y + 42 > PH - 14) { doc.addPage(); kopLanjutan(doc, 'Formulir Jurnal Mengajar', PW); y = 24; }
  blokTtd(doc, sekolah, y, PW);
}

// ── 2. LEMBAR DAFTAR HADIR PER ROMBEL ──
function lembarHadir(doc, { sekolah, rombel, siswa, kolomPertemuan, PW, PH }) {
  doc.addPage();
  kop(doc, sekolah, 'DAFTAR HADIR SISWA', PW);
  barisIdentitas(doc, [['Rombel / Kelas', wa(rombel)], ['Mata Pelajaran', '']], M, 30, 40, 92);
  barisIdentitas(doc, [
    ['Nama Guru', ''],
    ['Bulan', ''],
  ], PW / 2 + 6, 33, 40, 92);

  doc.setFont('helvetica', 'normal').setFontSize(7.6).setTextColor(70, 70, 70);
  doc.text('Tulis ' + ABSEN_STATUS.map(s => `${s.key} (${s.label})`).join(', ')
    + ' pada kolom pertemuan. Tanggal pertemuan diisi pada baris judul kolom.', M, 50);
  doc.setTextColor(0, 0, 0);

  // Lebar kolom pertemuan menyesuaikan sisa halaman agar selalu pas.
  const lebarTetap = 8 + 62 + 4 * 9;
  const lebarPertemuan = Math.max(5, (PW - 2 * M - lebarTetap) / kolomPertemuan);
  const kolomStyles = {
    0: { cellWidth: 8, halign: 'center' },
    1: { cellWidth: 62 },
  };
  for (let i = 0; i < kolomPertemuan; i++) {
    kolomStyles[2 + i] = { cellWidth: lebarPertemuan, halign: 'center' };
  }
  for (let i = 0; i < 4; i++) {
    kolomStyles[2 + kolomPertemuan + i] = { cellWidth: 9, halign: 'center', fillColor: [244, 248, 246] };
  }

  const head = [
    [
      { content: 'No', rowSpan: 2 },
      { content: 'Nama Siswa', rowSpan: 2 },
      { content: 'Pertemuan ke- / Tanggal', colSpan: kolomPertemuan },
      { content: 'Jumlah', colSpan: 4 },
    ],
    [
      ...Array.from({ length: kolomPertemuan }, (_, i) => String(i + 1)),
      ...ABSEN_STATUS.map(s => s.key),
    ],
  ];
  const body = siswa.map((s, i) => [
    i + 1, wa(s.nama), ...Array(kolomPertemuan + 4).fill(''),
  ]);
  if (!body.length) body.push([1, TITIK.slice(0, 40), ...Array(kolomPertemuan + 4).fill('')]);

  doc.autoTable({
    head, body,
    startY: 53.5,
    margin: { top: 16, left: M, right: M, bottom: 14 },
    theme: 'grid',
    styles: {
      // Baris cukup lapang untuk menulis H/S/I/A, tetapi tetap mengupayakan
      // satu rombel muat dalam satu halaman.
      font: 'helvetica', fontSize: 8, cellPadding: 1.2, valign: 'middle',
      minCellHeight: 6.2, lineColor: [150, 150, 150], lineWidth: 0.15, textColor: [25, 25, 25],
    },
    headStyles: {
      fillColor: SAGE, textColor: [255, 255, 255], fontStyle: 'bold',
      fontSize: 7.4, halign: 'center', valign: 'middle',
      lineColor: [255, 255, 255], lineWidth: 0.15, minCellHeight: 5,
    },
    columnStyles: kolomStyles,
    didDrawPage: (data) => {
      if (data.pageNumber > doc.__halamanAwalHadir) kopLanjutan(doc, `Daftar Hadir ${rombel}`, PW);
    },
  });

  // Tanda tangan hanya dicetak bila masih muat — jangan sampai memakan satu
  // halaman sendiri, karena lembar ini difotokopi banyak untuk tiap bulan.
  const y = (doc.lastAutoTable?.finalY || 53.5) + 7;
  if (y + 26 <= PH - 12) blokTtd(doc, sekolah, y, PW, 16);
}

/**
 * Bangun berkas formulir cetak satu semester.
 * @param {object}  o
 * @param {object}  o.sekolah         pengaturan sekolah (nama, TP, semester, kota, kepala, nipKepala)
 * @param {number}  o.halamanJurnal   jumlah halaman lembar jurnal kosong
 * @param {number}  o.kolomPertemuan  jumlah kolom pertemuan pada daftar hadir
 * @param {Array}   o.rombel          [{rombel, siswa:[{nama}]}] — nama siswa ikut tercetak
 * @returns {Promise<object>} instance jsPDF
 */
export async function buildFormulirPDF({ sekolah, halamanJurnal = 6, kolomPertemuan = 20, rombel = [] }) {
  const jsPDF = await ensurePDF();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();

  lembarJurnal(doc, { sekolah, halaman: Math.max(1, halamanJurnal), PW, PH, jsPDF });
  for (const r of rombel) {
    doc.__halamanAwalHadir = doc.internal.getNumberOfPages() + 1;
    lembarHadir(doc, { sekolah, rombel: r.rombel, siswa: r.siswa || [], kolomPertemuan, PW, PH });
  }

  // Nomor halaman & catatan cetak.
  const n = doc.internal.getNumberOfPages();
  const tglCetak = fmtTanggal(dk());
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(120, 120, 120);
    doc.text(`Halaman ${p} dari ${n}`, PW - M, PH - 6, { align: 'right' });
    doc.text(`Formulir isian manual - dicetak ${tglCetak}`, M, PH - 6);
  }
  return doc;
}

export function namaFileFormulir(sekolah) {
  const smt = String(sekolah?.semester || '').toLowerCase() || 'semester';
  const tp = String(sekolah?.tahunPelajaran || '').replace(/\W+/g, '-');
  return `formulir_jurnal_${smt}_${tp}.pdf`;
}
