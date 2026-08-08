// ── UTILS ──
// Fungsi murni (tanpa akses DOM, tanpa side effect global).

// SHA-256 hex untuk verifikasi password.
export async function hashPw(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ID acak untuk dokumen Firestore.
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Date Key: format "YYYY-MM-DD" (waktu lokal).
export function dk(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Escape HTML untuk mencegah injeksi saat render data pengguna.
export function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// Untuk teks yang disisipkan sebagai argumen string di dalam atribut onclick,
// mis. onclick="fn('${escArg(mapel)}')". Kutip tunggal pada data (mis.
// "Al-Qur'an Hadis") harus di-escape untuk JS lebih dulu, baru untuk HTML —
// kalau hanya esc(), parser HTML mengembalikannya jadi ' dan memutus argumen.
export function escArg(s) {
  return esc(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

// "2026-07-29" → "Rabu, 29 Juli 2026"
import { MONTHS, DF, KKTP_PREDIKAT } from "./constants.js";
export function fmtTanggal(key) {
  if (!key) return '-';
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DF[dt.getDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

// Urut natural rombel: "7A" < "7B" < "8A" < "10A".
export function cmpRombel(a, b) {
  const na = parseInt(a), nb = parseInt(b);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return String(a).localeCompare(String(b), 'id');
}

// Urut nama siswa/guru (locale id).
export function cmpNama(a, b) {
  return String(a.nama).localeCompare(String(b.nama), 'id');
}

// ── KELAS GABUNGAN ──
// Rombel setingkat (7A & 7B) belajar di satu ruang, jadi guru cukup mengisi
// jurnal/absensi/nilai SEKALI untuk keduanya. Satu "kelas" = satu unit
// pengisian yang mencakup satu atau beberapa rombel. Laporan tetap dipecah
// per rombel — lihat rombelDoc()/docPunyaRombel().

// Tingkat dari nama rombel: "7A" → 7, "10B" → 10. null bila tanpa angka depan.
export function tingkatOf(r) {
  const n = parseInt(r);
  return isNaN(n) ? null : n;
}

// Label satu kelas: ["7A","7B"] → "7A+7B", ["7A"] → "7A".
export function labelKelas(rombel) {
  return [...rombel].sort(cmpRombel).join('+');
}

// Kelompokkan daftar rombel menjadi daftar kelas pengisian.
// gabung=false → tiap rombel berdiri sendiri (perilaku lama).
// Rombel tanpa angka depan selalu berdiri sendiri (tingkatnya tak diketahui).
export function kelasDariRombel(list, gabung) {
  const rs = [...new Set(list)].filter(Boolean).sort(cmpRombel);
  const kelas = (rombel) => ({ key: labelKelas(rombel), label: labelKelas(rombel), rombel });
  if (!gabung) return rs.map(r => kelas([r]));
  const peta = new Map();
  for (const r of rs) {
    const t = tingkatOf(r);
    const k = t === null ? `#${r}` : `T${t}`;
    if (!peta.has(k)) peta.set(k, []);
    peta.get(k).push(r);
  }
  return [...peta.values()].map(kelas);
}

// Daftar rombel yang tercakup satu dokumen jurnal/nilai. Dokumen lama (tanpa
// rombelGabung) tetap terbaca sebagai satu rombel.
export function rombelDoc(d) {
  const g = (d?.rombelGabung || []).filter(Boolean);
  return g.length ? [...g].sort(cmpRombel) : (d?.rombel ? [d.rombel] : []);
}

export function docPunyaRombel(d, r) {
  return rombelDoc(d).includes(r);
}

// Hitung rekap {H,S,I,A} dari objek absen {siswaId: status}.
export function hitungRekap(absen) {
  const r = { H: 0, S: 0, I: 0, A: 0 };
  for (const st of Object.values(absen || {})) if (r[st] !== undefined) r[st]++;
  return r;
}

// ── PENILAIAN ──

// Nilai tersimpan boleh kosong/null; kembalikan angka atau null.
export function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Rata-rata dari daftar nilai, mengabaikan yang kosong. null bila tak ada isi.
export function rata(arr) {
  const v = (arr || []).map(num).filter(x => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function bulat(n) {
  return n === null || n === undefined ? null : Math.round(n);
}

// Predikat KKTP dari nilai 0–100. Di bawah batas tuntas → "Perlu Bimbingan";
// sisanya dibagi tiga (kktpMin 70 → 70-79 Cukup, 80-89 Baik, 90-100 Sangat Baik).
export function kktpDari(nilai, kktpMin = 70) {
  const n = num(nilai);
  if (n === null) return null;
  if (n < kktpMin) return KKTP_PREDIKAT[0];
  const langkah = Math.max(1, (100 - kktpMin) / 3);
  const idx = Math.min(2, Math.floor((n - kktpMin) / langkah));
  return KKTP_PREDIKAT[idx + 1];
}

// Urut NISN; yang kosong ditaruh di belakang, lalu jatuh ke urutan nama.
export function cmpNisn(a, b) {
  const x = String(a.nisn || ''), y = String(b.nisn || '');
  if (!x && !y) return cmpNama(a, b);
  if (!x) return 1;
  if (!y) return -1;
  return x.localeCompare(y, 'id', { numeric: true }) || cmpNama(a, b);
}

export function urutkanSiswa(list, mode) {
  return [...list].sort(mode === 'nisn' ? cmpNisn : cmpNama);
}

// Deskripsi capaian untuk kolom deskripsi di RDM: sorot penilaian tertinggi
// dan terendah. items: [{nama, nilai}] — yang kosong diabaikan.
export function deskripsiCapaian(items, kktpMin = 70) {
  const ada = (items || []).filter(x => num(x.nilai) !== null);
  if (!ada.length) return '';
  const urut = [...ada].sort((a, b) => num(b.nilai) - num(a.nilai));
  const top = urut[0], bawah = urut[urut.length - 1];
  const awal = `Menunjukkan capaian ${kktpDari(top.nilai, kktpMin).label.toLowerCase()} pada ${top.nama}`;
  if (urut.length === 1 || top.nama === bawah.nama) return awal + '.';
  return `${awal}, dan perlu penguatan pada ${bawah.nama}.`;
}
