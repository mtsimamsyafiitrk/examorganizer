# Jurnal Mengajar Guru

Aplikasi web (PWA) jurnal mengajar guru untuk madrasah — **Kurikulum Merdeka Kemenag berbasis KBC (Kurikulum Berbasis Cinta)** — dengan absensi siswa yang diisi oleh masing-masing guru mata pelajaran saat masuk kelas.

## Fitur

### 👨‍🏫 Guru
- **Isi jurnal mengajar** per pertemuan: tanggal, jam ke, rombel, mapel, materi/topik, tujuan pembelajaran (TP), kegiatan, metode/model, dan asesmen.
- **Integrasi Nilai Cinta (KBC)**: pilih nilai cinta yang diintegrasikan (Cinta Allah & Rasul-Nya, Cinta Ilmu, Cinta Diri & Sesama, Cinta Lingkungan, Cinta Tanah Air) beserta wujud penerapannya.
- **Absensi siswa** langsung di dalam jurnal: pilih rombel → daftar siswa muncul otomatis → tandai Hadir/Sakit/Izin/Alpa (default Hadir).
- **Riwayat jurnal** per bulan, bisa diedit/dihapus.
- **Ekspor PDF laporan jurnal bulanan**: satu klik dari menu Riwayat, menghasilkan berkas siap cetak berisi kop madrasah, identitas guru, tabel seluruh pertemuan bulan tersebut (materi, TP, kegiatan/metode/asesmen, nilai KBC, rekap kehadiran), dan kolom tanda tangan guru & kepala madrasah.
- **Rekap absensi** per rombel per bulan (khusus kelas yang diajar sendiri) + ekspor Excel.
- Pengaturan data guru: data diri, data pendidikan/lulusan, dan kepegawaian (password dikelola admin).

### 🛡️ Admin
- **Kelola akun guru**: tambah/edit/hapus akun, atur mapel yang diampu, atur/reset password guru (guru tidak dapat mengganti password sendiri).
- **Kelola data siswa** sederhana (Nama, Rombel, NISN): tambah manual atau **upload Excel** (template disediakan), hapus per siswa atau per rombel.
- **Monitor jurnal** semua guru per tanggal, dengan dua ekspor: **Excel sebulan** (jurnal semua guru) dan **PDF per guru** (laporan bulanan guru terpilih, format sama seperti yang dicetak guru).
- **Rekap absensi** seluruh rombel + ekspor Excel.
- **Pengaturan**: identitas madrasah, tahun pelajaran/semester, kota & nama/NIP kepala madrasah (dipakai pada kop dan kolom tanda tangan PDF), daftar rombel, daftar mapel, akun admin.

## Portal Aplikasi (Halaman Induk)

Folder [`portal/`](portal/) berisi **halaman induk** yang menampilkan ikon seluruh aplikasi guru —
klik salah satu ikon, aplikasi tersebut terbuka:

- **Jurnal Mengajar** (repositori ini)
- **Daftar Hadir Guru** (https://mtsimamsyafiitrk.github.io/DaftarHadirGuru/)

Alamat: **https://mtsimamsyafiitrk.github.io/JurnalGuru/portal/** — bisa dipasang sendiri ke layar
utama sebagai satu aplikasi induk (PWA terpisah dengan service worker ber-scope `portal/` saja,
sehingga tidak mengganggu aplikasi Jurnal Mengajar di root).

Daftar aplikasi diatur pada konstanta `APPS` di `portal/app.js`. Detail lihat [`portal/README.md`](portal/README.md).

## Teknologi
- HTML/CSS/JavaScript murni (tanpa build step) — bisa dihosting di GitHub Pages.
- **Firebase Firestore** sebagai basis data (koleksi berawalan `jm_`).
- PWA: bisa dipasang di HP (Android/iOS) dan desktop.
- SheetJS (dimuat lazy) untuk template/upload/ekspor Excel.
- jsPDF + jsPDF-AutoTable (dimuat lazy, hanya saat tombol ekspor PDF ditekan) untuk laporan jurnal bulanan PDF — A4 landscape.

## Struktur Data Firestore

| Koleksi/Dokumen | Isi |
|---|---|
| `jm_config/admin` | `{username, pwHash}` |
| `jm_config/sekolah` | `{nama, tahunPelajaran, semester, kota, kepala, nipKepala, rombel[], mapel[]}` |
| `jm_guru/{id}` | `{nama, nip, username, pwHash, mapel[]}` |
| `jm_siswa/{id}` | `{nama, rombel, nisn}` |
| `jm_jurnal/{id}` | jurnal + `absen{siswaId: H\|S\|I\|A}` + `rekap{H,S,I,A}` |

## Memulai

1. Buka aplikasi, pilih tab **Admin**, login dengan username `admin` dan password default `Madras0h!`.
2. Segera ganti username/password admin di menu **Setelan**.
3. Atur identitas madrasah, tahun pelajaran, kota, nama & NIP kepala madrasah (untuk kop/tanda tangan PDF), daftar rombel, dan daftar mapel.
4. Tambahkan **akun guru** (password awal: `guru123`, bisa diatur sendiri oleh admin saat menambah/mengedit guru).
5. Upload **data siswa** dari Excel (kolom: Nama, Rombel, NISN) atau input manual.
6. Guru login dan mulai mengisi jurnal mengajar + absensi.

## Pengembangan Lokal

```bash
# cukup server statis, misalnya:
npx serve .
# atau
python3 -m http.server 8000
```

Lalu buka `http://localhost:8000`.
