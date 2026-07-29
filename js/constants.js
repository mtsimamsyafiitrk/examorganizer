// ── CONSTANTS ──
// Data statis aplikasi Jurnal Mengajar Guru.

export const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

// Label hari, lookup by JS getDay()
export const DF = ["Ahad", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export const TODAY = new Date();

// Password default admin saat pertama kali (belum ada dokumen jm_config/admin).
export const ADMIN_DEFAULT_PW = "Madras0h!";

// Password default akun guru baru / hasil reset oleh admin.
export const GURU_DEFAULT_PW = "guru123";

// ── KBC: Kurikulum Berbasis Cinta (Kemenag) ──
// Nilai-nilai cinta yang diintegrasikan dalam pembelajaran Kurikulum Merdeka madrasah.
export const KBC_VALUES = [
  { key: "allah",      label: "Cinta Allah & Rasul-Nya",  icon: "🕌" },
  { key: "ilmu",       label: "Cinta Ilmu",               icon: "📚" },
  { key: "diri",       label: "Cinta Diri & Sesama",      icon: "🤝" },
  { key: "lingkungan", label: "Cinta Lingkungan",         icon: "🌱" },
  { key: "tanahair",   label: "Cinta Tanah Air",          icon: "🇮🇩" },
];

// Metode/model pembelajaran (Kurikulum Merdeka).
export const METODE_LIST = [
  "Ceramah Interaktif", "Diskusi Kelompok", "Tanya Jawab", "Demonstrasi",
  "Praktik / Unjuk Kerja", "Problem Based Learning (PBL)",
  "Project Based Learning (PjBL)", "Discovery / Inquiry Learning",
  "Pembelajaran Berdiferensiasi", "Drill / Latihan", "Talaqqi / Hafalan", "Lainnya"
];

// Jenis asesmen.
export const ASESMEN_LIST = [
  "Tidak ada", "Asesmen Formatif", "Asesmen Sumatif",
  "Observasi", "Penugasan", "Praktik / Unjuk Kerja"
];

// ── PENILAIAN ──
// Jenis penilaian sengaja dibuat sama dengan menu Penilaian di RDM
// (Rapor Digital Madrasah) supaya tiap kolom di aplikasi ini bisa langsung
// disalin ke kolom yang bersesuaian saat guru mengisi RDM.
export const NILAI_JENIS = [
  { key: "formatif", label: "Formatif / Harian",      sheet: "Formatif",  contoh: "cth: Latihan 1, Kuis Bab 2" },
  { key: "sumatif",  label: "Sumatif Lingkup Materi", sheet: "Sumatif LM", contoh: "cth: Lingkup 1 — Bilangan Bulat" },
  { key: "sas",      label: "Sumatif Akhir Semester", sheet: "SAS",        contoh: "cth: Sumatif Akhir Semester Ganjil" },
];

export const NILAI_JENIS_MAP = Object.fromEntries(NILAI_JENIS.map(j => [j.key, j]));

// Predikat KKTP, urut dari terendah. Batas tuntas (kktpMin) diatur admin;
// rentang di atasnya dibagi tiga sama panjang — lihat kktpDari() di utils.js.
export const KKTP_PREDIKAT = [
  { kode: "D", label: "Perlu Bimbingan", color: "#a86870" },
  { kode: "C", label: "Cukup",           color: "#a8874d" },
  { kode: "B", label: "Baik",            color: "#5a8aaa" },
  { kode: "A", label: "Sangat Baik",     color: "#5a9b86" },
];

// Urutan siswa pada tabel & ekspor — samakan dengan urutan template Excel RDM
// agar nilai bisa disalin satu kolom sekaligus tanpa tergeser.
export const URUT_SISWA = [
  { key: "nama", label: "Nama (A–Z)" },
  { key: "nisn", label: "NISN" },
];

// Status kehadiran siswa.
export const ABSEN_STATUS = [
  { key: "H", label: "Hadir", color: "#5a9b86", bg: "#e8f4f0" },
  { key: "S", label: "Sakit", color: "#a8874d", bg: "#f5eedf" },
  { key: "I", label: "Izin",  color: "#5a8aaa", bg: "#e5eef5" },
  { key: "A", label: "Alpa",  color: "#a86870", bg: "#f5e8ea" },
];

export const ABSEN_MAP = Object.fromEntries(ABSEN_STATUS.map(s => [s.key, s]));

// Default pengaturan sekolah (bisa diubah admin di menu Pengaturan).
export const DEFAULT_SEKOLAH = {
  nama: "MTs Al Imam Asy-Syafi'i Tarakan",
  tahunPelajaran: "2026/2027",
  semester: "Ganjil",
  // Dipakai pada kop & blok tanda tangan laporan PDF jurnal bulanan.
  kota: "Tarakan",
  kepala: "",
  nipKepala: "",
  // Penilaian: batas tuntas KKTP, bobot nilai akhir (samakan dengan menu
  // Bobot di RDM), dan urutan siswa pada ekspor.
  kktpMin: 70,
  bobot: { formatif: 0, sumatif: 60, sas: 40 },
  urutSiswa: "nama",
  rombel: ["7A", "7B", "8A", "8B", "9A", "9B"],
  mapel: [
    "Al-Qur'an Hadis", "Akidah Akhlak", "Fikih", "Sejarah Kebudayaan Islam",
    "Bahasa Arab", "Pendidikan Pancasila", "Bahasa Indonesia", "Matematika",
    "IPA", "IPS", "Bahasa Inggris", "PJOK", "Informatika", "Seni Budaya"
  ],
};
