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
- **Nilai siswa (alat bantu input RDM)** — lihat bagian di bawah.
- Pengaturan data guru: data diri, data pendidikan/lulusan, dan kepegawaian (password dikelola admin).

### 📊 Nilai Siswa — alat bantu, bukan pengganti RDM

Rapor resmi tetap terbit dari **RDM (Rapor Digital Madrasah)**. Menu Nilai di sini
berfungsi sebagai *buku nilai guru*: tempat mengolah nilai sepanjang semester,
lalu memindahkannya ke RDM tanpa mengetik ulang satu per satu.

- **Jenis penilaian mengikuti menu Penilaian di RDM** — Formatif/Harian, Sumatif
  Lingkup Materi, dan Sumatif Akhir Semester (SAS, dibatasi satu per mapel per
  semester). Satu penilaian di aplikasi = satu kolom di RDM.
- **Input per rombel + mapel**: daftar siswa muncul otomatis, tinggal isi angka
  0–100. Nilai kosong berarti belum dinilai dan tidak ikut dihitung.
- **Urutan siswa bisa disamakan dengan template Excel RDM** (Nama A–Z atau NISN,
  diatur admin) sehingga satu kolom nilai bisa disalin sekaligus tanpa tergeser.
- **Salin per kolom** ke papan klip (satu nilai per baris) — untuk di-*paste*
  langsung ke satu kolom di template RDM. Tersedia juga untuk kolom NA dan deskripsi.
- **Leger & deskripsi**: rata-rata tiap komponen, Nilai Akhir berbobot, predikat
  KKTP, dan **deskripsi capaian otomatis** (menyorot penilaian tertinggi dan
  terendah) yang tinggal disalin ke kolom deskripsi RDM.
- **Ekspor Excel** multi-sheet: `Formatif`, `Sumatif LM`, `SAS`, dan `Leger`.

Nilai Akhir memakai bobot yang diatur admin — **samakan dengan menu Bobot di RDM**.
Komponen yang belum ada nilainya diabaikan dan bobotnya dinormalkan ulang, agar NA
tetap wajar saat semester masih berjalan.

Predikat KKTP memakai empat interval. **Batas tuntas ditetapkan admin per mata
pelajaran** — Matematika dan Akidah Akhlak wajar berbeda — dengan satu angka
default madrasah untuk mapel yang tidak diatur khusus (default 70). Guru tidak
dapat mengubahnya, hanya melihat batas yang berlaku pada mapelnya.

Rentang di atas batas tuntas dibagi tiga. Dengan batas 70: 70–79 Cukup, 80–89
Baik, 90–100 Sangat Baik, dan di bawah 70 Perlu Bimbingan. Predikat dihitung dari
Nilai Akhir yang sudah dibulatkan — angka yang dilaporkan ke RDM — agar angka dan
predikat yang dilihat guru selalu sejalan.

### 🛡️ Admin
- **Kelola akun guru**: tambah/edit/hapus akun, atur mapel yang diampu, atur/reset password guru (guru tidak dapat mengganti password sendiri).
- **Kelola data siswa** sederhana (Nama, Rombel, NISN): tambah manual atau **upload Excel** (template disediakan), hapus per siswa atau per rombel.
- **Monitor jurnal** semua guru per tanggal, dengan dua ekspor: **Excel sebulan** (jurnal semua guru) dan **PDF per guru** (laporan bulanan guru terpilih, format sama seperti yang dicetak guru).
- **Rekap absensi** seluruh rombel + ekspor Excel.
- **Pengaturan**: identitas madrasah, tahun pelajaran/semester, kota & nama/NIP kepala madrasah (dipakai pada kop dan kolom tanda tangan PDF), **pengaturan penilaian** (batas tuntas KKTP default + per mapel, bobot Nilai Akhir, urutan siswa pada ekspor), daftar rombel, daftar mapel, akun admin.

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
| `jm_config/sekolah` | `{nama, tahunPelajaran, semester, kota, kepala, nipKepala, kktpMin, kktpMapel{mapel: 0..100}, bobot{formatif,sumatif,sas}, urutSiswa, rombel[], mapel[]}` |
| `jm_guru/{id}` | `{nama, nip, username, pwHash, mapel[]}` |
| `jm_siswa/{id}` | `{nama, rombel, nisn}` |
| `jm_jurnal/{id}` | jurnal + `absen{siswaId: H\|S\|I\|A}` + `rekap{H,S,I,A}` |
| `jm_nilai/{id}` | satu kolom penilaian: `{guruId, mapel, rombel, tahunPelajaran, semester, jenis, nama, urut, nilai{siswaId: 0..100}}` |

## Memulai

1. Buka aplikasi, pilih tab **Admin**, login dengan username `admin` dan password default `Madras0h!`.
2. Segera ganti username/password admin di menu **Setelan**.
3. Atur identitas madrasah, tahun pelajaran, kota, nama & NIP kepala madrasah (untuk kop/tanda tangan PDF), **pengaturan penilaian** (batas KKTP default & per mapel, bobot Nilai Akhir, urutan siswa — samakan dengan RDM), daftar rombel, dan daftar mapel.
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
