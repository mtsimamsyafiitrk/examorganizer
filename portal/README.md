# Portal Aplikasi Guru

Halaman **induk (launcher)** untuk aplikasi-aplikasi guru Al Imam Asy-Syafi'i Tarakan.
Saat dibuka, tampil ikon setiap aplikasi — klik salah satunya, aplikasi tersebut langsung terbuka.

Aplikasi yang terdaftar saat ini:

| Aplikasi | Alamat |
|---|---|
| Jurnal Mengajar | https://mtsimamsyafiitrk.github.io/JurnalGuru/ |
| Daftar Hadir Guru | https://mtsimamsyafiitrk.github.io/DaftarHadirGuru/ |

Alamat portal (GitHub Pages): **https://mtsimamsyafiitrk.github.io/JurnalGuru/portal/**

## Sifat

- HTML/CSS/JS murni, tanpa build step — sama seperti kedua aplikasi.
- **PWA sendiri**: punya `manifest.webmanifest`, service worker, dan ikon sendiri, sehingga
  portal bisa dipasang ke layar utama sebagai satu aplikasi induk. Tersedia tombol
  *Pasang Portal di Perangkat* (Android/desktop); di iOS pakai menu **Bagikan → Tambahkan ke Layar Utama** Safari.
- Service worker portal hanya mencakup folder `portal/`, jadi tidak bentrok dengan
  service worker aplikasi Jurnal Mengajar di root repositori.
- **Mandiri**: seluruh berkas yang dibutuhkan (termasuk ikon) ada di dalam folder ini,
  sehingga folder `portal/` bisa dipindah/disalin ke repositori atau domain lain apa adanya.

## Menambah atau Mengubah Aplikasi

Semua daftar aplikasi ada di satu tempat: konstanta `APPS` pada [`app.js`](app.js).

```js
const APPS = [
  {
    nama: "Jurnal Mengajar",
    desc: "Jurnal mengajar guru & absensi siswa madrasah",
    url:  "https://mtsimamsyafiitrk.github.io/JurnalGuru/",
    tone: "sage",          // warna ikon: "sage" (hijau) atau "teal" (biru)
    ico:  '<path .../>',   // isi <svg> ikon garis 24×24 (gaya Feather)
  },
  // ...
];
```

- **Aplikasi pindah domain** → cukup ubah `url`.
- **Menambah aplikasi ketiga** → tambah satu entri. Grid ikon menyesuaikan sendiri.
  Untuk warna baru, tambahkan blok `.app-tile[data-tone="..."]` di [`styles.css`](styles.css).

Secara bawaan aplikasi dibuka di tab yang sama (tombol kembali browser mengembalikan ke portal).
Untuk membukanya di tab baru, tambahkan `target="_blank" rel="noopener"` pada elemen `<a class="app-tile">` di `renderApps()`.

## Menjadikan Portal Repositori Sendiri

Salin isi folder ini ke root repositori baru (mis. `PortalGuru`), aktifkan GitHub Pages,
lalu portal tersedia di `https://<user>.github.io/PortalGuru/`. Tidak ada berkas yang perlu diubah —
alamat kedua aplikasi sudah absolut.

## Pengembangan Lokal

```bash
# dari root repositori
python3 -m http.server 8000
# lalu buka http://localhost:8000/portal/
```
