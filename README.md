# Jurnal Mengajar Guru

Aplikasi web (PWA) jurnal mengajar guru untuk madrasah — **Kurikulum Merdeka Kemenag berbasis KBC (Kurikulum Berbasis Cinta)** — dengan absensi siswa yang diisi oleh masing-masing guru mata pelajaran saat masuk kelas.

## Kelas Gabungan — isi sekali, laporan tetap per rombel

Tiap tingkat terbagi menjadi dua rombel (7A & 7B, 8A & 8B, …), tetapi proses
belajarnya berlangsung di **satu ruang**. Karena itu guru **tidak perlu mengisi
dua kali**: pilih kelas **7A+7B**, daftar siswa kedua rombel muncul sekali
(dengan pemisah per rombel), lalu simpan — satu pertemuan, satu kali isi.

Yang tetap **dipisah per rombel**:

| Keluaran | Bentuk pemisahan |
|---|---|
| Rekap absensi (guru & admin) | Dipilih per rombel; hanya siswa rombel itu yang dihitung |
| Excel jurnal sebulan (admin) | Satu pertemuan gabungan → satu baris per rombel, kehadiran masing-masing |
| PDF jurnal bulanan per guru | Kolom Rombel dan H/S/I/A dirinci per rombel pada baris pertemuan yang sama |
| Leger & ekspor Excel nilai | Satu tabel/lembar per rombel, siap disalin ke template RDM |
| Salin kolom nilai / NA / deskripsi | Tombol salin terpisah untuk tiap rombel |
| Rekap nilai admin | Kelengkapan & leger tetap satu baris per guru × mapel × rombel |

Penggabungan diatur admin di **Setelan → Daftar Rombel** (*Gabungkan rombel
setingkat saat pengisian*), dan mengelompokkan rombel berdasarkan angka
tingkatnya. Bila dimatikan, pengisian kembali per rombel seperti semula.
Jurnal dan penilaian lama tidak ikut berubah — semuanya tetap terbaca sesuai
cakupan aslinya.

## Fitur

### 👨‍🏫 Guru
- **Isi jurnal mengajar** per pertemuan: tanggal, jam ke, kelas (rombel tunggal atau gabungan seperti 7A+7B), mapel, materi/topik, tujuan pembelajaran (TP), kegiatan, metode/model, dan asesmen.
- **Integrasi Nilai Cinta (KBC)**: pilih nilai cinta yang diintegrasikan (Cinta Allah & Rasul-Nya, Cinta Ilmu, Cinta Diri & Sesama, Cinta Lingkungan, Cinta Tanah Air) beserta wujud penerapannya.
- **Absensi siswa** langsung di dalam jurnal: pilih kelas → daftar siswa muncul otomatis (dikelompokkan per rombel bila kelasnya gabungan) → tandai Hadir/Sakit/Izin/Alpa (default Hadir). Rekap kehadiran disimpan per rombel.
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
- **Input per kelas + mapel**: daftar siswa muncul otomatis, tinggal isi angka
  0–100. Nilai kosong berarti belum dinilai dan tidak ikut dihitung. Kelas
  gabungan (7A+7B) cukup diisi sekali; leger, salinan kolom, dan ekspornya
  tetap terpisah per rombel mengikuti template RDM.
- **Urutan siswa bisa disamakan dengan template Excel RDM** (Nama A–Z atau NISN,
  diatur admin) sehingga satu kolom nilai bisa disalin sekaligus tanpa tergeser.
- **Salin per kolom** ke papan klip (satu nilai per baris) — untuk di-*paste*
  langsung ke satu kolom di template RDM. Tersedia juga untuk kolom NA dan deskripsi.
- **Leger & deskripsi**: rata-rata tiap komponen, Nilai Akhir berbobot, predikat
  KKTP, dan **deskripsi capaian otomatis** (menyorot penilaian tertinggi dan
  terendah) yang tinggal disalin ke kolom deskripsi RDM.
- **Ekspor Excel** multi-sheet: `Formatif`, `Sumatif LM`, `SAS`, dan `Leger` —
  satu set lembar per rombel bila kelasnya gabungan (mis. `Leger 7A`, `Leger 7B`).

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
- **Rekap** dua tab: **Absensi** seluruh rombel, dan **Nilai** (lihat di bawah). Keduanya bisa diekspor ke Excel.
- **Formulir cetak** untuk guru yang tidak bisa online — lihat bagian di bawah.
- **Pengaturan**: identitas madrasah, tahun pelajaran/semester, kota & nama/NIP kepala madrasah (dipakai pada kop dan kolom tanda tangan PDF), **pengaturan penilaian** (batas tuntas KKTP default + per mapel, bobot Nilai Akhir, urutan siswa pada ekspor), daftar rombel + **penggabungan rombel setingkat saat pengisian**, daftar mapel, akun admin.

#### Rekap Nilai (tab Nilai di menu Rekap admin)

- **Kelengkapan penilaian** — satu baris per guru × rombel × mapel: berapa
  penilaian tiap jenis sudah dibuat dan berapa persen siswa sudah dinilai.
  Kolom SAS bertanda merah bila Sumatif Akhir Semester belum dibuat, sehingga
  guru yang belum selesai gampang ditagih menjelang tenggat rapor.
- **Rincian nilai per guru** — ketuk satu baris untuk melihat seluruh nilai
  siswa pada mapel itu. **Hanya baca**; perubahan tetap lewat akun gurunya.
- **Leger per rombel lintas mapel** — Nilai Akhir tiap mapel untuk satu rombel,
  dipakai wali kelas dan kurikulum mencocokkan dengan RDM. Angka merah berarti
  di bawah batas tuntas KKTP mapel tersebut.
- **Ekspor Excel gabungan** — satu berkas berisi lembar `Kelengkapan` plus
  lembar leger untuk tiap rombel yang sudah punya nilai.

Rekap ini hanya mencakup tahun pelajaran & semester yang sedang berjalan, sama
seperti menu Nilai milik guru.

#### Formulir cetak — untuk guru yang tidak bisa online

Tombol **Formulir cetak** di menu Monitor Jurnal menghasilkan satu berkas PDF
siap fotokopi untuk dipakai sepanjang semester:

- **Lembar jurnal kosong** (A4 landscape) — kolom sama dengan jurnal digital,
  baris dibuat tinggi agar nyaman ditulis tangan, dilengkapi legenda kode KBC
  (1–5) sehingga guru cukup menulis angkanya. Jumlah halaman ditentukan admin
  dan hasilnya **pas** sebanyak itu, dengan blok tanda tangan di halaman terakhir.
- **Lembar daftar hadir per rombel** — **nama siswa sudah tercetak** (bagian
  yang paling merepotkan bila ditulis ulang), dengan kolom pertemuan kosong
  (jumlah kolom diatur admin) plus kolom jumlah H/S/I/A.

Nama guru dan mata pelajaran sengaja **dikosongkan** (titik-titik) agar satu
berkas cukup difotokopi untuk semua guru; identitas madrasah, tahun pelajaran,
semester, dan nama kepala madrasah tetap tercetak otomatis. Isian manual ini
nantinya tinggal disalin ke aplikasi saat guru mendapat koneksi.

## Teknologi
- HTML/CSS/JavaScript murni (tanpa build step) — bisa dihosting di GitHub Pages.
- **Firebase Firestore** sebagai basis data (koleksi berawalan `jm_`).
- PWA: bisa dipasang di HP (Android/iOS) dan desktop.
- SheetJS (dimuat lazy) untuk template/upload/ekspor Excel.
- jsPDF + jsPDF-AutoTable (dimuat lazy, hanya saat tombol ekspor PDF ditekan) untuk laporan jurnal bulanan dan formulir cetak — A4 landscape.

## Struktur Data Firestore

| Koleksi/Dokumen | Isi |
|---|---|
| `jm_config/admin` | `{username, pwHash}` |
| `jm_config/sekolah` | `{nama, tahunPelajaran, semester, kota, kepala, nipKepala, kktpMin, kktpMapel{mapel: 0..100}, bobot{formatif,sumatif,sas}, urutSiswa, gabungRombel, rombel[], mapel[]}` |
| `jm_guru/{id}` | `{nama, nip, username, pwHash, mapel[]}` |
| `jm_siswa/{id}` | `{nama, rombel, nisn}` |
| `jm_jurnal/{id}` | jurnal + `rombelGabung[]` + `absen{siswaId: H\|S\|I\|A}` + `rekap{H,S,I,A}` + `rekapRombel{rombel:{H,S,I,A}}` |
| `jm_nilai/{id}` | satu kolom penilaian: `{guruId, mapel, rombel, rombelGabung[], tahunPelajaran, semester, jenis, nama, urut, nilai{siswaId: 0..100}}` |

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
