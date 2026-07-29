// ── PORTAL APLIKASI ──
// Halaman induk (launcher): menampilkan ikon setiap aplikasi, klik → aplikasi terbuka.
//
// Menambah aplikasi baru cukup dengan menambah satu entri pada APPS di bawah.
// Bila salah satu aplikasi dipindah ke domain/host lain, ubah `url`-nya saja.

const APPS = [
  {
    nama: "Jurnal Mengajar",
    desc: "Jurnal mengajar guru & absensi siswa madrasah",
    url: "https://mtsimamsyafiitrk.github.io/JurnalGuru/",
    tone: "sage",
    // Ikon garis gaya Feather (MIT), inline agar tetap tampil saat offline.
    ico: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  },
  {
    nama: "Daftar Hadir Guru",
    desc: "Pencatatan kehadiran mengajar halaqah pesantren",
    url: "https://mtsimamsyafiitrk.github.io/DaftarHadirGuru/",
    tone: "teal",
    ico: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><polyline points="9 13 11 15 15 11"/>',
  },
];

const CHEVRON = '<polyline points="9 18 15 12 9 6"/>';
const DOWNLOAD = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>';

function svg(paths, size, sw = 2) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

function renderApps() {
  document.getElementById("app-grid").innerHTML = APPS.map(a => `
    <a class="app-tile" data-tone="${a.tone}" href="${a.url}">
      <span class="app-ico">${svg(a.ico, 40, 1.7)}</span>
      <span class="app-nama">${a.nama}</span>
      <span class="app-desc">${a.desc}</span>
      <span class="app-buka">Buka ${svg(CHEVRON, 13)}</span>
    </a>
  `).join("");
}

// ── Tombol pasang portal ke layar utama (Android/desktop) ──
// iOS tidak mendukung beforeinstallprompt; di sana tombol tetap tersembunyi
// dan pemasangan dilakukan lewat menu "Tambahkan ke Layar Utama" Safari.
function setupInstall() {
  const btn = document.getElementById("btn-install");
  btn.querySelector(".btn-install-ico").innerHTML = svg(DOWNLOAD, 16);
  let deferred = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });

  btn.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    btn.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    deferred = null;
    btn.hidden = true;
  });
}

renderApps();
setupInstall();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}
