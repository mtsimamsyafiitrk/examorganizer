// ═══════════════════════════════════════════════════════════════
// JURNAL MENGAJAR GURU — MTs Al Imam Asy-Syafi'i Tarakan
// Kurikulum Merdeka Kemenag berbasis KBC (Kurikulum Berbasis Cinta)
//
// Peran:
//  - Admin : kelola akun guru, data siswa (nama/rombel/NISN),
//            monitor jurnal, rekap absensi, pengaturan sekolah.
//  - Guru  : isi jurnal mengajar + absensi siswa per rombel,
//            riwayat jurnal, rekap absensi, ganti password.
//
// Data Firestore (prefix jm_ agar tidak bentrok dengan data lama):
//  jm_config/admin   {username, pwHash}
//  jm_config/sekolah {nama, tahunPelajaran, semester, gabungRombel, rombel[], mapel[]}
//  jm_guru/{id}      {nama, nip, username, pwHash, mapel[]}
//  jm_siswa/{id}     {nama, rombel, nisn}
//  jm_jurnal/{id}    {guruId, guruNama, tanggal, jamKe, rombel, rombelGabung[],
//                     mapel, materi, tujuan, kegiatan, metode, asesmen,
//                     kbc[], kbcCatatan, refleksi,
//                     absen{siswaId:H|S|I|A}, rekap{H,S,I,A},
//                     rekapRombel{rombel:{H,S,I,A}}, createdAt, updatedAt}
//  jm_nilai/{id}     satu dokumen = satu kolom penilaian (satu kali penilaian)
//                    {guruId, mapel, rombel, rombelGabung[], tahunPelajaran,
//                     semester, jenis:'formatif'|'sumatif'|'sas', nama, urut,
//                     nilai{siswaId: 0..100}, createdAt, updatedAt}
//
// Kelas gabungan: rombel setingkat (7A & 7B) belajar di satu ruang, jadi guru
// mengisi jurnal/absensi/nilai SEKALI untuk keduanya. Dokumen menyimpan
// rombelGabung[] berisi rombel yang tercakup; seluruh laporan (rekap absensi,
// Excel, PDF, leger, rekap nilai) tetap memecah angkanya per rombel.
//
// Catatan penilaian: aplikasi ini alat bantu guru, BUKAN pengganti RDM.
// Struktur jenis penilaian & urutan siswa sengaja dibuat mengikuti RDM agar
// hasilnya bisa disalin per kolom ke template Excel RDM tanpa tergeser.
// ═══════════════════════════════════════════════════════════════

import {
  fs, doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where
} from "./js/firebase.js";
import {
  MONTHS, TODAY, ADMIN_DEFAULT_PW, GURU_DEFAULT_PW,
  KBC_VALUES, METODE_LIST, ASESMEN_LIST, ABSEN_STATUS, ABSEN_MAP, DEFAULT_SEKOLAH,
  NILAI_JENIS, NILAI_JENIS_MAP, URUT_SISWA
} from "./js/constants.js";
import {
  hashPw, uid, dk, esc, escArg, fmtTanggal, cmpRombel, cmpNama, hitungRekap,
  num, rata, bulat, kktpDari, urutkanSiswa, deskripsiCapaian,
  tingkatOf, labelKelas, kelasDariRombel, rombelDoc, docPunyaRombel
} from "./js/utils.js";
import { showLoading, hideLoading, showToast, showScreen, openModal, closeModal, togglePw } from "./js/ui-helpers.js";
import { ico, initIcons } from "./js/icons.js";
import { buildJurnalBulananPDF, namaFilePDF, namaBulan, pdfDownload } from "./js/pdf-jurnal.js";
import { buildFormulirPDF, namaFileFormulir } from "./js/pdf-form.js";

// ── STATE ──
let loginRole = 'guru';
let currentUser = null;        // {role:'admin'} | {role:'guru', id, nama, username, mapel[]}
let sekolah = { ...DEFAULT_SEKOLAH };
let guruList = [];
let siswaList = [];
let absenState = {};           // {siswaId: 'H'|'S'|'I'|'A'} untuk form jurnal
let kbcState = new Set();      // nilai KBC terpilih di form jurnal
let editJurnalId = null;
let editGuruId = null;
let editSiswaId = null;
let mgMapelState = new Set();  // mapel terpilih di modal guru
let aSetState = null;          // salinan pengaturan sekolah saat diedit
let nilaiList = [];            // dokumen jm_nilai milik guru yang login
let nilaiInputState = {};      // {siswaId: '' | angka} saat mengisi satu kolom penilaian
let nilaiDirty = false;        // ada isian nilai yang belum disimpan
let nilaiSemua = [];           // seluruh jm_nilai (admin) — untuk rekap & monitoring
let nilaiSemuaLoaded = false;

const SESSION_KEY = 'jm_session';

// ── FIRESTORE HELPERS ──
async function loadSekolah() {
  const d = await getDoc(doc(fs, 'jm_config', 'sekolah'));
  sekolah = { ...DEFAULT_SEKOLAH, ...(d.exists() ? d.data() : {}) };
}
async function saveSekolahDoc(data) {
  sekolah = { ...sekolah, ...data };
  await setDoc(doc(fs, 'jm_config', 'sekolah'), sekolah);
}
async function getAdminDoc() {
  const d = await getDoc(doc(fs, 'jm_config', 'admin'));
  return d.exists() ? d.data() : null;
}
async function loadGuru() {
  const snap = await getDocs(collection(fs, 'jm_guru'));
  guruList = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(cmpNama);
}
async function loadSiswa() {
  const snap = await getDocs(collection(fs, 'jm_siswa'));
  siswaList = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => cmpRombel(a.rombel, b.rombel) || cmpNama(a, b));
}
async function jurnalByGuru(guruId) {
  const snap = await getDocs(query(collection(fs, 'jm_jurnal'), where('guruId', '==', guruId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function jurnalByTanggal(dateKey) {
  const snap = await getDocs(query(collection(fs, 'jm_jurnal'), where('tanggal', '==', dateKey)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function loadNilai(guruId) {
  const snap = await getDocs(query(collection(fs, 'jm_nilai'), where('guruId', '==', guruId)));
  nilaiList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function jurnalByRange(start, end) {
  const snap = await getDocs(query(collection(fs, 'jm_jurnal'),
    where('tanggal', '>=', start), where('tanggal', '<=', end)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Daftar rombel resmi — HANYA dari pengaturan (satu-satunya sumber kebenaran,
// agar rombel yang dihapus admin benar-benar hilang dari dropdown).
function rombelList() {
  return [...new Set(sekolah.rombel || [])].filter(Boolean).sort(cmpRombel);
}
// Rombel untuk halaman data siswa & rekap: sertakan juga rombel lama yang
// masih dipakai siswa, agar siswa "yatim" (rombelnya sudah dihapus) tetap terjangkau.
function rombelListSiswa() {
  const s = new Set([...rombelList(), ...siswaList.map(x => x.rombel)]);
  return [...s].filter(Boolean).sort(cmpRombel);
}
function siswaByRombel(r) {
  return siswaList.filter(s => s.rombel === r).sort(cmpNama);
}

// ── KELAS GABUNGAN (unit pengisian) ──
// Guru memilih "kelas" (mis. 7A+7B) sekali; laporan tetap per rombel.
function gabungAktif() {
  return sekolah.gabungRombel !== false;
}
// Kelas untuk form jurnal — hanya rombel resmi dari pengaturan.
function kelasList() {
  return kelasDariRombel(rombelList(), gabungAktif());
}
// Kelas untuk menu Nilai — ikut menyertakan rombel lama yang masih dipakai siswa.
function kelasListSiswa() {
  return kelasDariRombel(rombelListSiswa(), gabungAktif());
}
// Terjemahkan nilai dropdown menjadi kelas. Nilai lama (mis. "7A" saat
// penggabungan sudah aktif) tetap dikenali apa adanya agar jurnal/penilaian
// lama masih bisa dibuka dan diedit tanpa berubah cakupannya.
function kelasByKey(key, daftar) {
  if (!key) return null;
  const list = daftar || kelasListSiswa();
  return list.find(k => k.key === key)
    || { key, label: key, rombel: key.split('+').filter(Boolean) };
}
// Kelas yang mencakup satu dokumen jurnal/nilai (dipakai saat mengedit).
function kelasDoc(d) {
  const r = rombelDoc(d);
  return { key: labelKelas(r), label: labelKelas(r), rombel: r };
}
function siswaByKelas(kelas) {
  return (kelas?.rombel || []).flatMap(r => siswaByRombel(r));
}
// Pecah satu absen gabungan menjadi rekap per rombel, supaya laporan tetap
// terpisah walau pengisiannya sekali. Siswa yang sudah dihapus diabaikan.
function rekapPerRombel(absen, rombel) {
  const petaRombel = Object.fromEntries(siswaList.map(s => [s.id, s.rombel]));
  const hasil = Object.fromEntries((rombel || []).map(r => [r, { H: 0, S: 0, I: 0, A: 0 }]));
  for (const [sid, st] of Object.entries(absen || {})) {
    const r = hasil[petaRombel[sid]];
    if (r && r[st] !== undefined) r[st]++;
  }
  return hasil;
}
// Opsi <option> daftar kelas, menyertakan nilai terpilih yang tidak lagi ada
// di daftar (rombel lama / hasil penggabungan yang berubah).
function opsiKelas(daftar, terpilih) {
  const opts = [...daftar];
  if (terpilih && !opts.some(k => k.key === terpilih)) {
    opts.unshift({ key: terpilih, label: terpilih, rombel: terpilih.split('+') });
  }
  return opts.map(k =>
    `<option value="${esc(k.key)}" ${k.key === terpilih ? 'selected' : ''}>${esc(k.label)}</option>`).join('');
}
// Teks pendek untuk lingkaran avatar (38px): "7A+7B" → "7".
function ringkasKelas(d) {
  const r = rombelDoc(d);
  if (!r.length) return '?';
  if (r.length === 1) return r[0];
  const tk = [...new Set(r.map(tingkatOf))];
  return tk.length === 1 && tk[0] !== null ? String(tk[0]) : String(r.length) + ' rbl';
}

// ── LAZY-LOAD XLSX (hanya untuk upload/template/ekspor) ──
let _xlsxLoad = null;
function ensureXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!_xlsxLoad) {
    _xlsxLoad = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = () => res(window.XLSX);
      s.onerror = () => { _xlsxLoad = null; rej(new Error('Gagal memuat library Excel')); };
      document.head.appendChild(s);
    });
  }
  return _xlsxLoad;
}
// PWA standalone iOS: XLSX.writeFile kadang gagal → fallback via data URL.
function xlsxDownload(wb, filename) {
  try {
    if (window.navigator.standalone) {
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      const a = document.createElement('a');
      a.href = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + wbout;
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
    } else {
      XLSX.writeFile(wb, filename);
    }
  } catch (e) { showToast('Gagal mengunduh file.', false); }
}

// ── LOGIN / SESSION ──
function setLoginRole(r) {
  loginRole = r;
  document.getElementById('tab-role-guru').classList.toggle('active', r === 'guru');
  document.getElementById('tab-role-admin').classList.toggle('active', r === 'admin');
  hideLoginErr();
}
function loginErr(msg) {
  const el = document.getElementById('login-err');
  el.textContent = msg; el.style.display = 'block';
}
function hideLoginErr() { document.getElementById('login-err').style.display = 'none'; }

async function doLogin() {
  const username = document.getElementById('l-user').value.trim();
  const password = document.getElementById('l-pass').value;
  if (!username || !password) { loginErr('Username dan password wajib diisi.'); return; }
  showLoading('Memeriksa akun...');
  try {
    const pwHash = await hashPw(password);
    if (loginRole === 'admin') {
      const adm = await getAdminDoc();
      const okUser = adm ? username === adm.username : username === 'admin';
      const okPw = adm ? pwHash === adm.pwHash : password === ADMIN_DEFAULT_PW;
      if (!okUser || !okPw) { hideLoading(); loginErr('Username atau password admin salah.'); return; }
      currentUser = { role: 'admin' };
    } else {
      await loadGuru();
      const found = guruList.find(g => g.username === username && g.pwHash === pwHash);
      if (!found) { hideLoading(); loginErr('Username atau password salah.'); return; }
      currentUser = { role: 'guru', ...found };
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({ role: currentUser.role, id: currentUser.id || null }));
    document.getElementById('l-pass').value = '';
    hideLoginErr();
    await enterApp();
  } catch (e) {
    console.error(e);
    loginErr('Terjadi kesalahan koneksi. Coba lagi.');
  }
  hideLoading();
}

function doLogout() {
  localStorage.removeItem(SESSION_KEY);
  currentUser = null;
  showScreen('login');
}

async function enterApp() {
  await Promise.all([loadSekolah(), loadSiswa(), currentUser.role === 'admin' ? loadGuru() : Promise.resolve()]);
  document.getElementById('login-school').textContent = sekolah.nama;
  if (currentUser.role === 'admin') {
    document.getElementById('a-header-sub').textContent =
      `${sekolah.nama} · TP ${sekolah.tahunPelajaran} · ${sekolah.semester}`;
    // Data nilai dimuat ulang tiap masuk, dan filter rekap dimulai bersih.
    nilaiSemua = []; nilaiSemuaLoaded = false;
    for (const k of ['tab', 'detail', 'nrombel', 'ym', 'rombel', 'mapel'])
      delete document.getElementById('page-a-rekap').dataset[k];
    showScreen('admin');
    aNav('home');
  } else {
    document.getElementById('g-header-sub').textContent =
      `${currentUser.nama} · TP ${sekolah.tahunPelajaran} ${sekolah.semester}`;
    showScreen('guru');
    initJurnalForm();
    // Bersihkan filter & cache nilai milik sesi sebelumnya.
    nilaiList = [];
    nilaiInputState = {}; nilaiDirty = false;
    for (const k of ['loaded', 'kelas', 'mapel', 'open', 'jenis']) delete nilaiPage().dataset[k];
    gNav('home');
  }
}

// ── NAVIGASI ──
function navTo(prefix, page) {
  const screen = document.getElementById('screen-' + prefix);
  screen.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  screen.querySelector(`#page-${prefix === 'guru' ? 'g' : 'a'}-${page}`).classList.add('active');
  screen.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  window.scrollTo(0, 0);
}
function gNav(page) {
  navTo('guru', page);
  if (page === 'home') renderGHome();
  if (page === 'riwayat') renderGRiwayat();
  if (page === 'nilai') renderGNilai();
  if (page === 'rekap') renderGRekap();
  if (page === 'akun') renderGAkun();
}
function aNav(page) {
  navTo('admin', page);
  if (page === 'home') renderAHome();
  if (page === 'guru') renderAGuru();
  if (page === 'siswa') renderASiswa();
  if (page === 'jurnal') renderAJurnal();
  if (page === 'rekap') renderARekap();
  if (page === 'set') renderASet();
}

// ═══════════════════ GURU: BERANDA ═══════════════════
async function renderGHome() {
  const el = document.getElementById('page-g-home');
  el.innerHTML = `<div class="empty">Memuat...</div>`;
  let list = [];
  try { list = (await jurnalByTanggal(dk())).filter(j => j.guruId === currentUser.id); } catch (e) {}
  const mapelku = (currentUser.mapel && currentUser.mapel.length) ? currentUser.mapel.join(', ') : 'Semua mapel';
  el.innerHTML = `
    <div class="card card-sage">
      <div style="font-size:15px;font-weight:800">Assalamu'alaikum, ${esc(currentUser.nama)}</div>
      <div class="hint" style="margin-top:4px">${esc(fmtTanggal(dk()))} · ${esc(mapelku)}</div>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="num" style="color:var(--sage2)">${list.length}</div><div class="lbl">Jurnal hari ini</div></div>
      <div class="stat"><div class="num" style="color:var(--teal2)">${list.reduce((a, j) => a + (j.rekap?.H || 0), 0)}</div><div class="lbl">Siswa hadir tercatat</div></div>
    </div>
    <button class="btn btn-sage" style="width:100%;padding:14px;font-size:14px;margin-bottom:12px" onclick="gNav('jurnal')">${ico('pen',15)} Isi Jurnal Mengajar</button>
    <div class="card">
      <div class="section-title">${ico('book-open',15)} Jurnal Hari Ini</div>
      ${list.length ? list.map(j => jurnalItemHTML(j, false)).join('') : `<div class="empty">Belum ada jurnal hari ini.</div>`}
    </div>`;
}

function jurnalItemHTML(j, showGuru) {
  const r = j.rekap || {};
  const kbcBadge = (j.kbc || []).length ? ` · ${ico('heart', 11)} ${(j.kbc || []).length}` : '';
  const label = rombelDoc(j).join(' + ') || '?';
  return `
  <div class="item" style="cursor:pointer" onclick="lihatJurnal('${j.id}')">
    <div class="avatar">${esc(ringkasKelas(j))}</div>
    <div class="grow">
      <div class="t1">${esc(j.mapel)} — ${esc(j.materi)}</div>
      <div class="t2">${esc(label)} · ${showGuru ? esc(j.guruNama) + ' · ' : ''}${esc(fmtTanggal(j.tanggal))}${j.jamKe ? ' · Jam ke-' + esc(j.jamKe) : ''}${kbcBadge}</div>
      <div class="t2">
        <span style="color:#5a9b86">H:${r.H ?? 0}</span> · <span style="color:#a8874d">S:${r.S ?? 0}</span> ·
        <span style="color:#5a8aaa">I:${r.I ?? 0}</span> · <span style="color:#a86870">A:${r.A ?? 0}</span>
      </div>
    </div>
    <span style="color:var(--muted)">${ico('chevron',16)}</span>
  </div>`;
}

// ═══════════════════ GURU: FORM JURNAL ═══════════════════
function initJurnalForm() {
  document.getElementById('j-tanggal').value = dk();
  isiOpsiKelasJurnal();
  const mList = (currentUser.mapel && currentUser.mapel.length) ? currentUser.mapel : sekolah.mapel;
  document.getElementById('j-mapel').innerHTML = `<option value="">— pilih mapel —</option>` +
    mList.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  document.getElementById('j-metode').innerHTML =
    METODE_LIST.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  document.getElementById('j-asesmen').innerHTML =
    ASESMEN_LIST.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  renderKbcChips();
  renderAbsenList();
}

function renderKbcChips() {
  document.getElementById('j-kbc').innerHTML = KBC_VALUES.map(v =>
    `<div class="chip ${kbcState.has(v.key) ? 'on' : ''}" onclick="toggleKbc('${v.key}',this)">${v.label}</div>`
  ).join('');
}
function toggleKbc(key, el) {
  kbcState.has(key) ? kbcState.delete(key) : kbcState.add(key);
  el.classList.toggle('on', kbcState.has(key));
}

// Isi dropdown kelas pada form jurnal. `terpilih` dipakai saat mengedit jurnal
// lama yang cakupannya tidak lagi ada di daftar kelas sekarang.
function isiOpsiKelasJurnal(terpilih = '') {
  document.getElementById('j-rombel').innerHTML =
    `<option value="">— pilih kelas —</option>` + opsiKelas(kelasList(), terpilih);
  document.getElementById('j-rombel').value = terpilih;
}

// Kelas yang sedang dipilih di form jurnal.
function kelasJurnal() {
  return kelasByKey(document.getElementById('j-rombel').value, kelasList());
}

function renderAbsenList() {
  const kelas = kelasJurnal();
  const wrap = document.getElementById('absen-list');
  const counter = document.getElementById('absen-counter');
  const kosong = (msg) => { wrap.innerHTML = `<div class="empty">${msg}</div>`; counter.textContent = ''; absenState = {}; };
  if (!kelas) { kosong('Pilih kelas terlebih dahulu.'); return; }
  const siswa = siswaByKelas(kelas);
  if (!siswa.length) {
    kosong(`Belum ada data siswa untuk ${esc(kelas.label)}.<br>Hubungi admin untuk mengunggah data siswa.`);
    return;
  }
  // Pertahankan status yang sudah dipilih; siswa baru default Hadir.
  const prev = absenState; absenState = {};
  for (const s of siswa) absenState[s.id] = prev[s.id] || 'H';
  const gabungan = kelas.rombel.length > 1;
  counter.textContent = gabungan
    ? `${siswa.length} siswa · ${kelas.rombel.map(r => `${r}: ${siswaByRombel(r).length}`).join(' · ')}`
    : `${siswa.length} siswa`;
  // Daftar tetap dikelompokkan per rombel walau diisi sekali, agar guru
  // gampang mencari nama dan rekapnya jelas terpisah.
  let no = 0;
  wrap.innerHTML = kelas.rombel.map(r => {
    const anggota = siswaByRombel(r);
    if (!anggota.length) return gabungan
      ? `<div class="grup-rombel">${esc(r)} <span class="hint">— belum ada siswa</span></div>` : '';
    return (gabungan ? `<div class="grup-rombel">${esc(r)} <span class="hint">${anggota.length} siswa</span></div>` : '')
      + anggota.map(s => {
        no++;
        return `
        <div class="absen-row">
          <div style="width:22px;text-align:right;font-size:12px;font-weight:800;color:var(--muted)">${no}</div>
          <div class="absen-nama">${esc(s.nama)}<div class="absen-nisn">NISN ${esc(s.nisn || '-')}</div></div>
          <div class="absen-btns" id="ab-${s.id}">${absenBtnsHTML(s.id)}</div>
        </div>`;
      }).join('');
  }).join('');
}
function absenBtnsHTML(sid) {
  return ABSEN_STATUS.map(st => {
    const on = absenState[sid] === st.key;
    return `<button class="st-btn" onclick="setAbsen('${sid}','${st.key}')" title="${st.label}"
      style="${on ? `background:${st.color};border-color:${st.color};color:#fff` : ''}">${st.key}</button>`;
  }).join('');
}
function setAbsen(sid, st) {
  absenState[sid] = st;
  document.getElementById('ab-' + sid).innerHTML = absenBtnsHTML(sid);
}
function setSemuaAbsen(st) {
  for (const sid of Object.keys(absenState)) { absenState[sid] = st; document.getElementById('ab-' + sid).innerHTML = absenBtnsHTML(sid); }
  showToast('Semua siswa ditandai ' + ABSEN_MAP[st].label + '.');
}

async function simpanJurnal() {
  const tanggal = document.getElementById('j-tanggal').value;
  const kelas = kelasJurnal();
  const mapel = document.getElementById('j-mapel').value;
  const materi = document.getElementById('j-materi').value.trim();
  if (!tanggal || !kelas || !mapel || !materi) { showToast('Tanggal, kelas, mapel, dan materi wajib diisi.', false); return; }
  if (!Object.keys(absenState).length) { showToast('Tidak ada siswa pada kelas ini — absensi kosong.', false); return; }
  const now = Date.now();
  const data = {
    guruId: currentUser.id,
    guruNama: currentUser.nama,
    tanggal, mapel, materi,
    // rombel = label pengisian (mis. "7A+7B"); rombelGabung = rombel yang
    // benar-benar tercakup, dipakai semua laporan untuk memisah per rombel.
    rombel: kelas.label,
    rombelGabung: [...kelas.rombel],
    jamKe: document.getElementById('j-jamke').value.trim(),
    tujuan: document.getElementById('j-tujuan').value.trim(),
    kegiatan: document.getElementById('j-kegiatan').value.trim(),
    metode: document.getElementById('j-metode').value,
    asesmen: document.getElementById('j-asesmen').value,
    kbc: [...kbcState],
    kbcCatatan: document.getElementById('j-kbc-catatan').value.trim(),
    refleksi: document.getElementById('j-refleksi').value.trim(),
    absen: { ...absenState },
    rekap: hitungRekap(absenState),
    // Rekap per rombel disimpan agar laporan (mis. PDF) tetap bisa dipecah
    // walau siswanya kelak pindah rombel atau dihapus.
    rekapRombel: rekapPerRombel(absenState, kelas.rombel),
    updatedAt: now,
  };
  showLoading('Menyimpan jurnal...');
  try {
    const id = editJurnalId || uid();
    if (!editJurnalId) data.createdAt = now;
    else {
      const old = await getDoc(doc(fs, 'jm_jurnal', id));
      data.createdAt = old.exists() ? (old.data().createdAt || now) : now;
    }
    await setDoc(doc(fs, 'jm_jurnal', id), data);
    hideLoading();
    showToast(editJurnalId ? 'Jurnal berhasil diperbarui!' : 'Jurnal berhasil disimpan!');
    resetJurnalForm();
    gNav('riwayat');
  } catch (e) { console.error(e); hideLoading(); showToast('Gagal menyimpan jurnal.', false); }
}

function resetJurnalForm() {
  editJurnalId = null;
  document.getElementById('g-jurnal-form-title').innerHTML = ico('pen') + ' Isi Jurnal Mengajar';
  document.getElementById('j-batal').style.display = 'none';
  document.getElementById('j-tanggal').value = dk();
  document.getElementById('j-jamke').value = '';
  isiOpsiKelasJurnal();
  document.getElementById('j-mapel').value = '';
  for (const id of ['j-materi', 'j-tujuan', 'j-kegiatan', 'j-kbc-catatan', 'j-refleksi'])
    document.getElementById(id).value = '';
  document.getElementById('j-metode').selectedIndex = 0;
  document.getElementById('j-asesmen').selectedIndex = 0;
  kbcState = new Set(); renderKbcChips();
  absenState = {}; renderAbsenList();
}

async function editJurnal(id) {
  showLoading('Memuat jurnal...');
  try {
    const d = await getDoc(doc(fs, 'jm_jurnal', id));
    if (!d.exists()) { hideLoading(); showToast('Jurnal tidak ditemukan.', false); return; }
    const j = d.data();
    editJurnalId = id;
    document.getElementById('g-jurnal-form-title').innerHTML = ico('pencil') + ' Edit Jurnal Mengajar';
    document.getElementById('j-batal').style.display = 'block';
    document.getElementById('j-tanggal').value = j.tanggal;
    document.getElementById('j-jamke').value = j.jamKe || '';
    // Jurnal lama (sebelum penggabungan) tetap dibuka dengan cakupan aslinya.
    isiOpsiKelasJurnal(kelasDoc(j).key);
    document.getElementById('j-mapel').value = j.mapel;
    document.getElementById('j-materi').value = j.materi || '';
    document.getElementById('j-tujuan').value = j.tujuan || '';
    document.getElementById('j-kegiatan').value = j.kegiatan || '';
    document.getElementById('j-metode').value = j.metode || METODE_LIST[0];
    document.getElementById('j-asesmen').value = j.asesmen || ASESMEN_LIST[0];
    document.getElementById('j-kbc-catatan').value = j.kbcCatatan || '';
    document.getElementById('j-refleksi').value = j.refleksi || '';
    kbcState = new Set(j.kbc || []); renderKbcChips();
    absenState = { ...(j.absen || {}) };
    renderAbsenList();
    closeModal('modal-jurnal');
    gNav('jurnal');
  } catch (e) { console.error(e); showToast('Gagal memuat jurnal.', false); }
  hideLoading();
}

// ═══════════════════ GURU: RIWAYAT ═══════════════════
async function renderGRiwayat() {
  const el = document.getElementById('page-g-riwayat');
  const bulan = el.dataset.bulan || dk().slice(0, 7);
  el.innerHTML = `
    <div class="card">
      <div class="section-title" style="justify-content:space-between">
        <span>${ico('book',15)} Riwayat Jurnal</span>
        <button class="btn-ghost" onclick="exportPdfRiwayat()">${ico('download',13)} Ekspor PDF</button>
      </div>
      <div class="filter-row">
        <input id="riw-bulan" class="input" type="month" value="${bulan}" onchange="gRiwayatBulan(this.value)"/>
      </div>
      <div class="hint" style="margin-bottom:8px">Ekspor PDF menghasilkan laporan jurnal bulan terpilih lengkap dengan kop madrasah dan kolom tanda tangan, siap dicetak.</div>
      <div id="riw-list"><div class="empty">Memuat...</div></div>
    </div>`;
  try {
    const all = await jurnalByGuru(currentUser.id);
    const list = all.filter(j => (j.tanggal || '').startsWith(bulan))
      .sort((a, b) => b.tanggal.localeCompare(a.tanggal) || (b.createdAt || 0) - (a.createdAt || 0));
    document.getElementById('riw-list').innerHTML = list.length
      ? list.map(j => jurnalItemHTML(j, false)).join('')
      : `<div class="empty">Belum ada jurnal pada bulan ini.</div>`;
  } catch (e) {
    console.error(e);
    document.getElementById('riw-list').innerHTML = `<div class="empty">Gagal memuat data.</div>`;
  }
}
function gRiwayatBulan(v) {
  document.getElementById('page-g-riwayat').dataset.bulan = v;
  renderGRiwayat();
}

// ═══════════════════ DETAIL JURNAL (guru & admin) ═══════════════════
async function lihatJurnal(id) {
  showLoading('Memuat detail...');
  try {
    const d = await getDoc(doc(fs, 'jm_jurnal', id));
    if (!d.exists()) { hideLoading(); showToast('Jurnal tidak ditemukan.', false); return; }
    const j = d.data();
    const kbcHTML = (j.kbc || []).length
      ? (j.kbc || []).map(k => { const v = KBC_VALUES.find(x => x.key === k); return v ? `<span class="badge" style="background:var(--sage3);color:var(--sage2);margin:2px 3px 0 0">${v.label}</span>` : ''; }).join('')
      : '<span class="hint">—</span>';
    const rombel = rombelDoc(j);
    const petaSiswa = Object.fromEntries(siswaList.map(s => [s.id, s]));
    // Kelompokkan absensi per rombel; siswa yang sudah dihapus/pindah masuk
    // kelompok "lainnya" agar tidak hilang dari tampilan.
    const grupAbsen = new Map(rombel.map(x => [x, []]));
    for (const [sid, st] of Object.entries(j.absen || {})) {
      const s = petaSiswa[sid];
      const key = s && grupAbsen.has(s.rombel) ? s.rombel : '';
      if (!grupAbsen.has(key)) grupAbsen.set(key, []);
      grupAbsen.get(key).push({ nama: s?.nama || '(siswa terhapus)', st });
    }
    for (const arr of grupAbsen.values()) arr.sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
    const rekapR = j.rekapRombel || rekapPerRombel(j.absen, rombel);
    const r = j.rekap || hitungRekap(j.absen);
    const rekapTeks = (x) => `H:${x?.H ?? 0} S:${x?.S ?? 0} I:${x?.I ?? 0} A:${x?.A ?? 0}`;
    const row = (l, v) => v ? `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase">${l}</div><div style="font-size:13.5px;font-weight:600;line-height:1.5">${esc(v)}</div></div>` : '';
    const canEdit = currentUser.role === 'guru' && j.guruId === currentUser.id;
    const canDel = canEdit || currentUser.role === 'admin';
    document.getElementById('mj-body').innerHTML = `
      ${row('Guru', j.guruNama)}
      ${row('Tanggal', fmtTanggal(j.tanggal) + (j.jamKe ? ' · Jam ke-' + j.jamKe : ''))}
      ${row('Rombel / Mapel', (rombel.join(' + ') || '-') + ' — ' + j.mapel)}
      ${row('Materi', j.materi)}
      ${row('Tujuan Pembelajaran', j.tujuan)}
      ${row('Kegiatan', j.kegiatan)}
      ${row('Metode / Asesmen', [j.metode, j.asesmen].filter(Boolean).join(' · '))}
      <div style="margin-bottom:8px"><div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase">Nilai Cinta (KBC)</div>${kbcHTML}</div>
      ${row('Wujud Penerapan KBC', j.kbcCatatan)}
      ${row('Refleksi / Catatan', j.refleksi)}
      <div style="margin:10px 0 6px;font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase">
        Absensi — ${rekapTeks(r)} (${Object.keys(j.absen || {}).length} siswa)</div>
      ${rombel.length > 1 ? `<div class="hint" style="margin-bottom:6px">Diisi sekali untuk ${esc(rombel.join(' + '))}, rekapnya tetap terpisah:
        ${rombel.map(x => `<b>${esc(x)}</b> ${esc(rekapTeks(rekapR[x]))}`).join(' · ')}</div>` : ''}
      <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:12px;padding:4px 12px">
        ${[...grupAbsen.entries()].filter(([, rows]) => rows.length).map(([grup, rows]) => (
          (rombel.length > 1 || !grup ? `<div class="grup-rombel">${esc(grup || 'Siswa lain / sudah pindah')}</div>` : '')
          + rows.map(a => { const m = ABSEN_MAP[a.st] || {}; return `
          <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bg2);font-size:12.5px;font-weight:600">
            <span>${esc(a.nama)}</span>
            <span class="badge" style="background:${m.bg};color:${m.color}">${m.label || a.st}</span>
          </div>`; }).join('')
        )).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:14px">
        ${canEdit ? `<button class="btn btn-teal" style="flex:1" onclick="editJurnal('${id}')">${ico('pencil',14)} Edit</button>` : ''}
        ${canDel ? `<button class="btn btn-rose" style="flex:1" onclick="hapusJurnal('${id}')">${ico('trash',14)} Hapus</button>` : ''}
      </div>`;
    openModal('modal-jurnal');
  } catch (e) { console.error(e); showToast('Gagal memuat detail.', false); }
  hideLoading();
}

function hapusJurnal(id) {
  confirmAction('Hapus Jurnal', 'Jurnal beserta absensinya akan dihapus permanen. Lanjutkan?', async () => {
    showLoading('Menghapus...');
    try {
      await deleteDoc(doc(fs, 'jm_jurnal', id));
      closeModal('modal-jurnal');
      showToast('Jurnal dihapus.');
      if (currentUser.role === 'guru') renderGRiwayat(); else renderAJurnal();
    } catch (e) { showToast('Gagal menghapus.', false); }
    hideLoading();
  });
}

// ═══════════════════ GURU: REKAP & AKUN ═══════════════════
// ═══════════════════ GURU: NILAI ═══════════════════
// Alat bantu penyiapan nilai untuk diinput ke RDM — bukan pengganti rapor.
// Satu dokumen jm_nilai = satu kolom penilaian di RDM. Guru membuat kolom
// (mis. "Lingkup 1 — Bilangan Bulat"), mengisi nilai seluruh siswa, lalu
// menyalin per kolom atau mengekspor Excel dengan urutan siswa yang sudah
// disamakan dengan template RDM.

function nilaiPage() { return document.getElementById('page-g-nilai'); }

function nilaiCtx() {
  const el = nilaiPage();
  const kelas = kelasByKey(el.dataset.kelas || '', kelasListSiswa());
  return { kelas, mapel: el.dataset.mapel || '', open: el.dataset.open || '' };
}

// Kelas satu rombel saja — dipakai saat laporan (leger/ekspor/salin) harus
// dipecah walau pengisiannya gabungan.
function kelasSatu(r) {
  return { key: r, label: r, rombel: [r] };
}

// Siswa satu kelas, dikelompokkan per rombel lalu diurutkan sesuai pengaturan
// (urutan template RDM berlaku di dalam masing-masing rombel).
function siswaKelasUrut(kelas) {
  return (kelas?.rombel || []).flatMap(r => urutkanSiswa(siswaByRombel(r), sekolah.urutSiswa));
}

// Kolom penilaian yang mencakup kelas terpilih, pada TP & semester berjalan.
// Satu kolom kelas gabungan (7A+7B) muncul juga saat leger dipecah per rombel.
function kolomNilai(kelas, mapel) {
  const rombel = kelas?.rombel || [];
  return nilaiList
    .filter(n => n.mapel === mapel && rombel.some(r => docPunyaRombel(n, r))
      && n.tahunPelajaran === sekolah.tahunPelajaran && n.semester === sekolah.semester)
    .sort((a, b) => (a.urut || 0) - (b.urut || 0) || String(a.nama).localeCompare(String(b.nama), 'id'));
}

// Batas tuntas KKTP berlaku per mapel — Matematika dan Akidah Akhlak wajar
// berbeda. Mapel yang tidak diatur khusus mengikuti default madrasah.
function kktpUntuk(mapel) {
  return num(sekolah.kktpMapel?.[mapel]) ?? num(sekolah.kktpMin) ?? 70;
}

function bobotNilai() {
  const b = { ...DEFAULT_SEKOLAH.bobot, ...(sekolah.bobot || {}) };
  return { formatif: num(b.formatif) ?? 0, sumatif: num(b.sumatif) ?? 0, sas: num(b.sas) ?? 0 };
}

// NA memakai bobot dari Setelan. Komponen yang belum ada nilainya diabaikan
// dan bobotnya dinormalkan ulang, agar NA tetap wajar di tengah semester.
function hitungNA(rf, rs, sas) {
  const b = bobotNilai();
  const bagian = [[rf, b.formatif], [rs, b.sumatif], [sas, b.sas]].filter(([v, w]) => v !== null && w > 0);
  const total = bagian.reduce((a, [, w]) => a + w, 0);
  if (!total) return null;
  return bagian.reduce((a, [v, w]) => a + v * w, 0) / total;
}

function hitungLeger(kelas, mapel) {
  const kolom = kolomNilai(kelas, mapel);
  const grup = { formatif: [], sumatif: [], sas: [] };
  for (const k of kolom) if (grup[k.jenis]) grup[k.jenis].push(k);
  const siswa = siswaKelasUrut(kelas);
  const kktpMin = kktpUntuk(mapel);
  const baris = siswa.map(s => {
    const val = k => num(k.nilai?.[s.id]);
    const rf = rata(grup.formatif.map(val));
    const rs = rata(grup.sumatif.map(val));
    const sas = grup.sas.length ? val(grup.sas[0]) : null;
    const na = hitungNA(rf, rs, sas);
    // Deskripsi bersumber dari sumatif lingkup materi (itu yang masuk rapor);
    // selama sumatif belum ada, formatif dipakai agar guru tetap punya bahan.
    const sumber = grup.sumatif.length ? grup.sumatif : grup.formatif;
    return {
      s, rf, rs, sas, na,
      // Predikat mengikuti NA yang dibulatkan — angka itulah yang dilaporkan
      // ke RDM, sehingga angka dan predikat yang dilihat guru selalu sejalan.
      predikat: kktpDari(bulat(na), kktpMin),
      deskripsi: deskripsiCapaian(sumber.map(k => ({ nama: k.nama, nilai: val(k) })), kktpMin),
    };
  });
  return { kolom, grup, siswa, baris, kktpMin };
}

async function renderGNilai() {
  const el = nilaiPage();
  if (!el.dataset.loaded) {
    el.innerHTML = `<div class="empty">Memuat...</div>`;
    try {
      await loadNilai(currentUser.id);
      el.dataset.loaded = '1';
    } catch (e) {
      console.error(e);
      el.innerHTML = `<div class="empty">Gagal memuat data nilai. Periksa koneksi.</div>`;
      return;
    }
  }
  if (nilaiCtx().open) renderNilaiInput(); else renderNilaiIndex();
}

function nilaiFilter(key, val) {
  const el = nilaiPage();
  el.dataset[key] = val;
  el.dataset.open = '';
  renderGNilai();
}

function renderNilaiIndex() {
  const el = nilaiPage();
  const { kelas, mapel } = nilaiCtx();
  const mapelOpts = currentUser.mapel?.length ? currentUser.mapel : sekolah.mapel;
  el.innerHTML = `
    <div class="card card-sage">
      <div class="section-title">${ico('star', 15)} Nilai Siswa</div>
      <div class="hint" style="margin-bottom:10px">
        Alat bantu menyiapkan nilai sebelum diinput ke <b>RDM</b>. Satu penilaian di sini
        sama dengan satu kolom di RDM. Aktif untuk TP <b>${esc(sekolah.tahunPelajaran)}</b>
        semester <b>${esc(sekolah.semester)}</b>.
        ${(kelas?.rombel.length || 0) > 1 ? `<br>Kelas <b>${esc(kelas.label)}</b> diisi sekali;
          leger, salin kolom, dan ekspor tetap terpisah per rombel — samakan dengan RDM.` : ''}
      </div>
      <div class="filter-row" style="margin-bottom:0">
        <select class="input" onchange="nilaiFilter('kelas',this.value)">
          <option value="">— pilih kelas —</option>
          ${opsiKelas(kelasListSiswa(), kelas?.key || '')}
        </select>
        <select class="input" onchange="nilaiFilter('mapel',this.value)">
          <option value="">— pilih mapel —</option>
          ${mapelOpts.map(m => `<option value="${esc(m)}" ${m === mapel ? 'selected' : ''}>${esc(m)}</option>`).join('')}
        </select>
      </div>
    </div>
    ${kelas && mapel
      ? blokDaftarPenilaian(kelas, mapel) + blokLeger(kelas, mapel)
      : `<div class="card"><div class="empty">Pilih kelas dan mata pelajaran untuk mulai menilai.</div></div>`}`;
}

function blokDaftarPenilaian(kelas, mapel) {
  const { grup, siswa } = hitungLeger(kelas, mapel);
  if (!siswa.length) {
    return `<div class="card"><div class="empty">Belum ada data siswa untuk ${esc(kelas.label)}.<br>Hubungi admin untuk mengunggah data siswa.</div></div>`;
  }
  const gabungan = kelas.rombel.length > 1;
  // Template RDM disusun per rombel, jadi tombol salin dipecah per rombel
  // walau nilainya diisi sekali.
  const tombolSalin = (k) => gabungan
    ? `<div style="display:flex;gap:6px;flex-wrap:wrap;padding:0 0 10px 6px">
         ${kelas.rombel.map(r => `<button class="btn-ghost" style="padding:5px 10px"
           title="Salin nilai siswa ${esc(r)} untuk ditempel ke RDM"
           onclick="salinKolom('${k.id}','${escArg(r)}')">${ico('copy', 12)} ${esc(r)}</button>`).join('')}
       </div>`
    : '';
  return `
    <div class="card">
      <div class="section-title" style="justify-content:space-between">
        <span>${ico('clipboard', 15)} Daftar Penilaian</span>
        <span class="badge-mini">${siswa.length} siswa${gabungan ? ` · ${kelas.rombel.join(' + ')}` : ''}</span>
      </div>
      ${NILAI_JENIS.map(j => {
        const list = grup[j.key] || [];
        // SAS hanya satu per mapel per semester, sesuai RDM.
        const bisaTambah = j.key !== 'sas' || !list.length;
        return `
        <div style="margin-bottom:14px">
          <div style="font-size:12px;font-weight:800;margin-bottom:4px">${esc(j.label)}</div>
          ${list.map(k => {
            const terisi = siswa.filter(s => num(k.nilai?.[s.id]) !== null).length;
            const lengkap = terisi === siswa.length;
            const cakupan = rombelDoc(k);
            // Penilaian lama yang cuma mencakup sebagian rombel ditandai,
            // supaya guru tahu kenapa isiannya belum lengkap.
            const sebagian = gabungan && cakupan.length < kelas.rombel.length;
            return `<div class="item">
              <div class="grow" style="cursor:pointer" onclick="bukaNilai('${k.id}')">
                <div class="t1">${esc(k.nama)}</div>
                <div class="t2" style="color:${lengkap ? '#5a9b86' : ''}">${terisi}/${siswa.length} siswa terisi${
                  sebagian ? ` · hanya ${esc(cakupan.join(' + '))}` : ''}</div>
              </div>
              ${gabungan ? '' : `<button class="btn-icon" title="Salin kolom nilai" onclick="salinKolom('${k.id}')">${ico('copy', 16)}</button>`}
              <button class="btn-icon" title="Isi / ubah nilai" onclick="bukaNilai('${k.id}')">${ico('pencil', 16)}</button>
              <button class="btn-icon" title="Hapus penilaian" onclick="hapusNilai('${k.id}')">${ico('trash', 16)}</button>
            </div>
            ${tombolSalin(k)}`;
          }).join('') || `<div class="hint" style="padding:2px 0 6px">Belum ada.</div>`}
          ${bisaTambah ? `<button class="btn-ghost" onclick="bukaNilai('baru','${j.key}')">${ico('plus', 13)} Tambah ${esc(j.label)}</button>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

// Leger selalu ditampilkan PER ROMBEL — walau nilainya diisi sekali untuk
// kelas gabungan — karena inilah yang dipindahkan ke RDM (per rombel).
function blokLeger(kelas, mapel) {
  const { kolom, baris } = hitungLeger(kelas, mapel);
  if (!baris.length) return '';
  if (!kolom.length) {
    return `<div class="card"><div class="empty">Belum ada penilaian. Tambahkan penilaian di atas untuk mulai mengisi nilai.</div></div>`;
  }
  const b = bobotNilai();
  const gabungan = kelas.rombel.length > 1;
  return `
    <div class="card">
      <div class="section-title" style="justify-content:space-between">
        <span>${ico('chart', 15)} Leger &amp; Deskripsi</span>
        <button class="btn-ghost" onclick="exportNilai()">${ico('download', 13)} Ekspor Excel</button>
      </div>
      <div class="hint" style="margin-bottom:8px">
        NA = ${b.formatif}% Formatif + ${b.sumatif}% Sumatif LM + ${b.sas}% SAS ·
        batas tuntas KKTP ${esc(mapel)}: <b>${kktpUntuk(mapel)}</b>.
        Bobot &amp; KKTP diatur admin di menu Setelan — samakan dengan menu <b>Bobot</b> di RDM.
        Komponen yang belum dinilai tidak ikut dihitung.
        ${gabungan ? 'Leger dipisah per rombel agar bisa disalin langsung ke template RDM.' : ''}
      </div>
      ${kelas.rombel.map(r => tabelLeger(r, mapel, gabungan)).join('')}
    </div>`;
}

function tabelLeger(rombel, mapel, tampilJudul) {
  const { baris } = hitungLeger(kelasSatu(rombel), mapel);
  const angka = v => (v === null ? '–' : bulat(v));
  if (!baris.length) {
    return tampilJudul
      ? `<div class="grup-rombel">${esc(rombel)}</div><div class="empty">Belum ada siswa.</div>` : '';
  }
  return `
    ${tampilJudul ? `<div class="grup-rombel">${esc(rombel)} <span class="hint">${baris.length} siswa</span></div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn-ghost" onclick="salinKolom('na','${escArg(rombel)}')">${ico('copy', 13)} Salin kolom NA${tampilJudul ? ' ' + esc(rombel) : ''}</button>
      <button class="btn-ghost" onclick="salinKolom('deskripsi','${escArg(rombel)}')">${ico('copy', 13)} Salin kolom deskripsi${tampilJudul ? ' ' + esc(rombel) : ''}</button>
    </div>
    <div class="table-wrap" style="margin-bottom:14px"><table class="tbl">
      <tr><th>#</th><th>Nama</th><th class="num">F</th><th class="num">SLM</th><th class="num">SAS</th>
          <th class="num">NA</th><th class="num">Predikat</th><th>Deskripsi</th></tr>
      ${baris.map((r, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(r.s.nama)}</td>
        <td class="num">${angka(r.rf)}</td>
        <td class="num">${angka(r.rs)}</td>
        <td class="num">${angka(r.sas)}</td>
        <td class="num" style="font-weight:900">${angka(r.na)}</td>
        <td class="num">${r.predikat ? `<span class="predikat" style="background:${r.predikat.color}" title="${esc(r.predikat.label)}">${r.predikat.kode}</span>` : '–'}</td>
        <td class="desk-cell">${esc(r.deskripsi) || '<span style="color:var(--muted)">–</span>'}</td>
      </tr>`).join('')}
    </table></div>`;
}

// ── Isi nilai satu kolom ──
function bukaNilai(id, jenis) {
  const el = nilaiPage();
  const { kelas } = nilaiCtx();
  const k = id === 'baru' ? null : nilaiList.find(x => x.id === id);
  nilaiInputState = {};
  for (const s of siswaByKelas(kelas)) {
    const v = k ? num(k.nilai?.[s.id]) : null;
    nilaiInputState[s.id] = v === null ? '' : String(v);
  }
  nilaiDirty = false;
  el.dataset.open = id;
  if (jenis) el.dataset.jenis = jenis;
  renderGNilai();
}

function jumlahTerisi() {
  return Object.values(nilaiInputState).filter(v => num(v) !== null).length;
}

function renderNilaiInput() {
  const el = nilaiPage();
  const { kelas, mapel, open } = nilaiCtx();
  const baru = open === 'baru';
  const k = baru ? null : nilaiList.find(x => x.id === open);
  if (!baru && !k) { el.dataset.open = ''; renderNilaiIndex(); return; }
  const jenis = baru ? (el.dataset.jenis || 'formatif') : k.jenis;
  const j = NILAI_JENIS_MAP[jenis] || NILAI_JENIS[0];
  const siswa = siswaKelasUrut(kelas);
  const gabungan = kelas.rombel.length > 1;
  el.innerHTML = `
    <div class="card card-sage">
      <div class="section-title" style="justify-content:space-between">
        <span>${ico(baru ? 'plus' : 'pencil', 15)} ${baru ? 'Penilaian Baru' : 'Ubah Penilaian'}</span>
        <span class="badge-mini">${esc(kelas.label)} · ${esc(mapel)}</span>
      </div>
      <div class="input-wrap">
        <label>Jenis Penilaian</label>
        <select id="nk-jenis" class="input" ${baru ? '' : 'disabled'}>
          ${NILAI_JENIS.map(x => `<option value="${x.key}" ${x.key === jenis ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
        </select>
      </div>
      <div class="input-wrap">
        <label>Nama Penilaian</label>
        <input id="nk-nama" class="input" value="${esc(k ? k.nama : '')}" placeholder="${esc(j.contoh)}"/>
      </div>
      <div class="hint">Nama ini muncul sebagai judul kolom saat diekspor — pakai nama yang sama dengan di RDM agar mudah dicocokkan.</div>
    </div>

    <div class="card">
      <div class="section-title" style="justify-content:space-between">
        <span>${ico('star', 15)} Isian Nilai</span>
        <span class="badge-mini" id="nilai-terisi">${jumlahTerisi()}/${siswa.length} terisi</span>
      </div>
      <div class="hint">Skala 0–100. Kosongkan bila siswa belum dinilai — nilai kosong tidak ikut dihitung.${
        gabungan ? ' Diisi sekali untuk ' + esc(kelas.rombel.join(' + ')) + '; leger & ekspor tetap terpisah per rombel.' : ''}</div>
      <div style="margin:10px 0">
        ${barisInputNilai(kelas) || '<div class="empty">Belum ada data siswa untuk kelas ini.</div>'}
      </div>
    </div>

    <div style="display:flex;gap:10px">
      <button class="btn btn-gray" style="flex:1" onclick="tutupNilaiInput()">Batal</button>
      <button class="btn btn-sage" style="flex:2;padding:13px;font-size:14px" onclick="simpanNilaiKolom()">${ico('save', 15)} Simpan Nilai</button>
    </div>`;
}

// Daftar isian nilai, dikelompokkan per rombel pada kelas gabungan supaya
// urutannya tetap sama dengan template RDM tiap rombel.
function barisInputNilai(kelas) {
  const gabungan = kelas.rombel.length > 1;
  let no = 0;
  return kelas.rombel.map(r => {
    const anggota = urutkanSiswa(siswaByRombel(r), sekolah.urutSiswa);
    if (!anggota.length) return '';
    return (gabungan ? `<div class="grup-rombel">${esc(r)} <span class="hint">${anggota.length} siswa</span></div>` : '')
      + anggota.map(s => {
        no++;
        return `
        <div class="absen-row">
          <div style="width:22px;text-align:right;font-size:12px;font-weight:800;color:var(--muted)">${no}</div>
          <div class="absen-nama">${esc(s.nama)}<div class="absen-nisn">NISN ${esc(s.nisn || '-')}</div></div>
          <input class="input nilai-inp" type="number" min="0" max="100" inputmode="numeric"
            value="${esc(nilaiInputState[s.id] ?? '')}"
            oninput="setNilaiInput('${s.id}',this.value)" onchange="normalNilai('${s.id}',this)"/>
        </div>`;
      }).join('');
  }).join('');
}

function setNilaiInput(sid, val) {
  nilaiInputState[sid] = val;
  nilaiDirty = true;
  const badge = document.getElementById('nilai-terisi');
  if (badge) badge.textContent = `${jumlahTerisi()}/${Object.keys(nilaiInputState).length} terisi`;
}

// Rapikan isian saat kursor meninggalkan kotak: bulat & dijepit ke 0–100.
function normalNilai(sid, inp) {
  const n = num(inp.value);
  if (n === null) { inp.value = ''; setNilaiInput(sid, ''); return; }
  const v = Math.min(100, Math.max(0, Math.round(n)));
  inp.value = String(v);
  setNilaiInput(sid, String(v));
}

function tutupNilaiInput() {
  const tutup = () => { nilaiDirty = false; nilaiPage().dataset.open = ''; renderGNilai(); };
  if (nilaiDirty) {
    confirmAction('Batalkan Pengisian',
      'Ada nilai yang belum disimpan. Tinggalkan halaman ini dan buang perubahannya?', tutup);
    return;
  }
  tutup();
}

async function simpanNilaiKolom() {
  const el = nilaiPage();
  const { kelas, mapel, open } = nilaiCtx();
  const nama = document.getElementById('nk-nama').value.trim();
  if (!nama) { showToast('Nama penilaian wajib diisi.', false); return; }
  const lama = open === 'baru' ? null : nilaiList.find(x => x.id === open);
  const jenis = lama ? lama.jenis : document.getElementById('nk-jenis').value;
  const nilai = {};
  for (const [sid, v] of Object.entries(nilaiInputState)) {
    const n = num(v);
    if (n !== null) nilai[sid] = Math.min(100, Math.max(0, Math.round(n)));
  }
  const now = Date.now();
  const data = {
    guruId: currentUser.id, mapel,
    // Sama seperti jurnal: label pengisian + rombel yang tercakup, agar leger
    // dan rekap tetap bisa dipecah per rombel.
    rombel: kelas.label,
    rombelGabung: [...kelas.rombel],
    tahunPelajaran: sekolah.tahunPelajaran, semester: sekolah.semester,
    jenis, nama, nilai,
    urut: lama?.urut ?? kolomNilai(kelas, mapel).filter(x => x.jenis === jenis).length + 1,
    createdAt: lama?.createdAt || now,
    updatedAt: now,
  };
  showLoading('Menyimpan nilai...');
  try {
    const id = open === 'baru' ? uid() : open;
    await setDoc(doc(fs, 'jm_nilai', id), data);
    const idx = nilaiList.findIndex(x => x.id === id);
    if (idx >= 0) nilaiList[idx] = { id, ...data }; else nilaiList.push({ id, ...data });
    nilaiDirty = false;
    el.dataset.open = '';
    hideLoading();
    showToast(`Nilai "${nama}" tersimpan.`);
    renderGNilai();
    return;
  } catch (e) { console.error(e); showToast('Gagal menyimpan nilai.', false); }
  hideLoading();
}

function hapusNilai(id) {
  const k = nilaiList.find(x => x.id === id);
  if (!k) return;
  const cakupan = rombelDoc(k);
  confirmAction('Hapus Penilaian',
    `Hapus penilaian <b>${esc(k.nama)}</b> beserta seluruh nilai siswa di dalamnya${
      cakupan.length > 1 ? ` (mencakup <b>${esc(cakupan.join(' + '))}</b>)` : ''}? Tindakan ini tidak bisa dibatalkan.`,
    async () => {
      showLoading('Menghapus...');
      try {
        await deleteDoc(doc(fs, 'jm_nilai', id));
        nilaiList = nilaiList.filter(x => x.id !== id);
        showToast('Penilaian dihapus.');
        renderGNilai();
      } catch (e) { console.error(e); showToast('Gagal menghapus.', false); }
      hideLoading();
    });
}

// ── Salin & ekspor ──
// Disalin satu nilai per baris, urut sesuai urutan siswa terpilih, supaya bisa
// langsung di-paste ke satu kolom template Excel RDM.
async function salinTeks(teks, pesan) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(teks);
    } else {
      const ta = document.createElement('textarea');
      ta.value = teks;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    showToast(pesan);
  } catch (e) { console.error(e); showToast('Gagal menyalin ke papan klip.', false); }
}

// Salinan selalu untuk SATU rombel — template RDM disusun per rombel.
function salinKolom(id, rombel) {
  const { kelas, mapel } = nilaiCtx();
  const target = rombel || kelas?.rombel[0];
  if (!target) { showToast('Pilih kelas terlebih dahulu.', false); return; }
  const { baris } = hitungLeger(kelasSatu(target), mapel);
  if (!baris.length) { showToast('Belum ada siswa.', false); return; }
  const suffix = kelas.rombel.length > 1 ? ` (${target})` : '';
  if (id === 'na') { salinTeks(baris.map(r => bulat(r.na) ?? '').join('\n'), `Kolom NA${suffix} disalin.`); return; }
  if (id === 'deskripsi') { salinTeks(baris.map(r => r.deskripsi).join('\n'), `Kolom deskripsi${suffix} disalin.`); return; }
  const k = nilaiList.find(x => x.id === id);
  if (!k) return;
  salinTeks(baris.map(r => num(k.nilai?.[r.s.id]) ?? '').join('\n'), `Kolom "${k.nama}"${suffix} disalin.`);
}

async function exportNilai() {
  const { kelas, mapel } = nilaiCtx();
  if (!kelas || !mapel) { showToast('Pilih kelas dan mapel terlebih dahulu.', false); return; }
  showLoading('Menyiapkan ekspor...');
  try {
    const XLSX = await ensureXLSX();
    if (!kolomNilai(kelas, mapel).length) { hideLoading(); showToast('Belum ada penilaian untuk diekspor.', false); return; }
    const wb = XLSX.utils.book_new();
    const gabungan = kelas.rombel.length > 1;
    const identitas = (r, i) => ({ No: i + 1, NISN: r.s.nisn || '', Nama: r.s.nama });
    // Satu set lembar per rombel — siap disalin ke template RDM masing-masing.
    for (const rombel of kelas.rombel) {
      const { grup, baris } = hitungLeger(kelasSatu(rombel), mapel);
      if (!baris.length) continue;
      const namaSheet = (dasar) => (gabungan ? `${dasar} ${rombel}` : dasar).slice(0, 31);
      for (const j of NILAI_JENIS) {
        const list = grup[j.key] || [];
        if (!list.length) continue;
        // Nama kolom harus unik agar tidak saling menimpa di sheet.
        const dipakai = new Set();
        const judul = list.map(k => {
          let l = k.nama, n = 2;
          while (dipakai.has(l)) l = `${k.nama} (${n++})`;
          dipakai.add(l);
          return l;
        });
        const rows = baris.map((r, i) => {
          const o = identitas(r, i);
          list.forEach((k, c) => { o[judul[c]] = num(k.nilai?.[r.s.id]) ?? ''; });
          return o;
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), namaSheet(j.sheet));
      }
      const leger = baris.map((r, i) => ({
        ...identitas(r, i),
        'Rata Formatif': bulat(r.rf) ?? '',
        'Rata Sumatif LM': bulat(r.rs) ?? '',
        'SAS': r.sas ?? '',
        'Nilai Akhir': bulat(r.na) ?? '',
        'Predikat': r.predikat?.label || '',
        'Deskripsi': r.deskripsi,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(leger), namaSheet('Leger'));
    }
    if (!wb.SheetNames.length) { hideLoading(); showToast('Belum ada data siswa untuk diekspor.', false); return; }
    xlsxDownload(wb, `nilai_${kelas.label.replace(/\+/g, '-')}_${mapel.replace(/\W+/g, '')}_${sekolah.semester}.xlsx`);
    showToast('Nilai diekspor.');
  } catch (e) { console.error(e); showToast('Gagal ekspor.', false); }
  hideLoading();
}

function renderGRekap() { renderRekapPage('page-g-rekap', true); }

// Halaman Akun guru: profil/data diri saja. Password TIDAK bisa diganti
// dari sini — pengelolaan password hanya lewat akun admin.
const PENDIDIKAN_LIST = ['SMA/MA/SMK', 'D3', 'S1', 'S2', 'S3'];
const STATUS_PEG_LIST = ['GTY (Guru Tetap Yayasan)', 'GTT / Honorer', 'PNS', 'PPPK', 'Lainnya'];

function renderGAkun() {
  const u = currentUser;
  const inp = (id, label, val, extra = '') =>
    `<div class="input-wrap"><label>${label}</label><input id="${id}" class="input" value="${esc(val || '')}" ${extra}/></div>`;
  const sel = (id, label, list, val) =>
    `<div class="input-wrap"><label>${label}</label><select id="${id}" class="input">
      <option value="">— pilih —</option>
      ${list.map(x => `<option ${x === val ? 'selected' : ''}>${esc(x)}</option>`).join('')}
    </select></div>`;
  const el = document.getElementById('page-g-akun');
  el.innerHTML = `
    <div class="card card-sage">
      <div class="section-title">${ico('user',15)} Akun Saya</div>
      <div class="hint" style="font-size:13px;line-height:1.7">
        <b>${esc(u.nama)}</b><br>
        Username: <b>${esc(u.username)}</b><br>
        Mapel: ${esc((u.mapel || []).join(', ') || '-')}
      </div>
      <div class="hint" style="margin-top:8px">Nama, username, mapel, dan password dikelola oleh admin. Hubungi admin bila perlu perubahan.</div>
    </div>
    <div class="card">
      <div class="section-title">${ico('user',15)} Data Diri</div>
      ${inp('pf-nip', 'NIP / NUPTK', u.nip)}
      <div class="grid2">
        ${inp('pf-tempat-lahir', 'Tempat Lahir', u.tempatLahir)}
        ${inp('pf-tgl-lahir', 'Tanggal Lahir', u.tglLahir, 'type="date"')}
      </div>
      <div class="input-wrap"><label>Jenis Kelamin</label><select id="pf-jk" class="input">
        <option value="">— pilih —</option>
        <option ${u.jk === 'Laki-laki' ? 'selected' : ''}>Laki-laki</option>
        <option ${u.jk === 'Perempuan' ? 'selected' : ''}>Perempuan</option>
      </select></div>
      <div class="input-wrap"><label>Alamat</label><textarea id="pf-alamat" class="input" rows="2">${esc(u.alamat || '')}</textarea></div>
      <div class="grid2">
        ${inp('pf-hp', 'No. HP / WA', u.hp, 'inputmode="tel"')}
        ${inp('pf-email', 'Email', u.email, 'type="email"')}
      </div>
    </div>
    <div class="card">
      <div class="section-title">${ico('grad',15)} Data Pendidikan / Lulusan</div>
      ${sel('pf-pendidikan', 'Pendidikan Terakhir', PENDIDIKAN_LIST, u.pendidikan)}
      ${inp('pf-jurusan', 'Program Studi / Jurusan', u.jurusan)}
      ${inp('pf-kampus', 'Perguruan Tinggi / Almamater', u.kampus)}
      ${inp('pf-tahun-lulus', 'Tahun Lulus', u.tahunLulus, 'inputmode="numeric" placeholder="cth: 2018"')}
    </div>
    <div class="card">
      <div class="section-title">${ico('clipboard',15)} Data Kepegawaian</div>
      ${sel('pf-status-peg', 'Status Kepegawaian', STATUS_PEG_LIST, u.statusPeg)}
      ${inp('pf-tmt', 'TMT Mulai Mengajar', u.tmt, 'type="date"')}
    </div>
    <button class="btn btn-sage" style="width:100%;padding:13px" onclick="simpanProfilGuru()">${ico('save',14)} Simpan Data Guru</button>`;
}

async function simpanProfilGuru() {
  const v = id => document.getElementById(id).value.trim();
  const tahunLulus = v('pf-tahun-lulus');
  if (tahunLulus && !/^\d{4}$/.test(tahunLulus)) { showToast('Tahun lulus harus 4 angka, cth: 2018.', false); return; }
  const profil = {
    nip: v('pf-nip'),
    tempatLahir: v('pf-tempat-lahir'),
    tglLahir: v('pf-tgl-lahir'),
    jk: v('pf-jk'),
    alamat: v('pf-alamat'),
    hp: v('pf-hp'),
    email: v('pf-email'),
    pendidikan: v('pf-pendidikan'),
    jurusan: v('pf-jurusan'),
    kampus: v('pf-kampus'),
    tahunLulus,
    statusPeg: v('pf-status-peg'),
    tmt: v('pf-tmt'),
  };
  showLoading('Menyimpan...');
  try {
    await setDoc(doc(fs, 'jm_guru', currentUser.id), { ...stripId(currentUser), ...profil });
    Object.assign(currentUser, profil);
    showToast('Data guru berhasil disimpan.');
  } catch (e) { console.error(e); showToast('Gagal menyimpan.', false); }
  hideLoading();
}
function stripId(u) { const { id, role, ...rest } = u; return rest; }

// ═══════════════════ ADMIN: BERANDA ═══════════════════
async function renderAHome() {
  const el = document.getElementById('page-a-home');
  el.innerHTML = `<div class="empty">Memuat...</div>`;
  let today = [];
  try { today = await jurnalByTanggal(dk()); } catch (e) {}
  today.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  el.innerHTML = `
    <div class="card card-sage">
      <div style="font-size:15px;font-weight:800">${esc(sekolah.nama)}</div>
      <div class="hint" style="margin-top:3px">${esc(fmtTanggal(dk()))} · TP ${esc(sekolah.tahunPelajaran)} · Semester ${esc(sekolah.semester)}</div>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="num" style="color:var(--sage2)">${guruList.length}</div><div class="lbl">Guru</div></div>
      <div class="stat"><div class="num" style="color:var(--teal2)">${siswaList.length}</div><div class="lbl">Siswa</div></div>
      <div class="stat"><div class="num" style="color:var(--lavender2)">${rombelList().length}</div><div class="lbl">Rombel</div></div>
      <div class="stat"><div class="num" style="color:var(--amber2)">${today.length}</div><div class="lbl">Jurnal hari ini</div></div>
    </div>
    <div class="card">
      <div class="section-title">${ico('book-open',15)} Jurnal Masuk Hari Ini</div>
      ${today.length ? today.map(j => jurnalItemHTML(j, true)).join('') : `<div class="empty">Belum ada jurnal masuk hari ini.</div>`}
    </div>`;
}

// ═══════════════════ ADMIN: KELOLA GURU ═══════════════════
function renderAGuru() {
  const el = document.getElementById('page-a-guru');
  el.innerHTML = `
    <div class="card">
      <div class="section-title" style="justify-content:space-between">
        <span>${ico('users',15)} Akun Guru <span class="badge-mini">${guruList.length}</span></span>
        <button class="btn btn-sage" onclick="openModalGuru()">${ico('plus',14)} Tambah</button>
      </div>
      <div class="hint" style="margin-bottom:6px">Password guru hanya dikelola dari sini: atur lewat tombol Edit, atau reset ke <b>${GURU_DEFAULT_PW}</b> dengan tombol kunci.</div>
      ${guruList.length ? guruList.map(g => `
        <div class="item">
          <div class="avatar">${esc((g.nama || '?')[0].toUpperCase())}</div>
          <div class="grow">
            <div class="t1">${esc(g.nama)}</div>
            <div class="t2">@${esc(g.username)}${g.nip ? ' · ' + esc(g.nip) : ''}<br>${esc((g.mapel || []).join(', ') || 'Belum ada mapel')}</div>
          </div>
          <button class="btn-icon" title="Edit" onclick="openModalGuru('${g.id}')">${ico('pencil',16)}</button>
          <button class="btn-icon" title="Reset password" onclick="resetPwGuru('${g.id}')">${ico('key',16)}</button>
          <button class="btn-icon" title="Hapus" onclick="hapusGuru('${g.id}')">${ico('trash',16)}</button>
        </div>`).join('') : `<div class="empty">Belum ada akun guru. Klik tombol Tambah.</div>`}
    </div>
    <div class="card">
      <div class="section-title" style="justify-content:space-between">
        <span>${ico('clipboard',15)} Rekap Data Guru</span>
        <button class="btn-ghost" onclick="exportDataGuru()">${ico('download',13)} Ekspor Excel</button>
      </div>
      <div class="hint" style="margin-bottom:8px">Data diri, pendidikan, dan kepegawaian yang diisi masing-masing guru di menu Akun. Geser tabel ke samping untuk melihat kolom lainnya.</div>
      ${guruList.length ? rekapDataGuruTable() : `<div class="empty">Belum ada data guru.</div>`}
    </div>`;
}

// Nilai sel rekap: '-' bila belum diisi guru.
const dg = v => esc(v || '-');

function rekapDataGuruTable() {
  return `
    <div class="table-wrap"><table class="tbl" style="min-width:1250px">
      <tr>
        <th>No</th><th>Nama</th><th>NIP / NUPTK</th><th>JK</th><th>Tempat, Tgl Lahir</th>
        <th>No. HP / WA</th><th>Email</th><th>Pendidikan</th><th>Jurusan</th><th>Almamater</th>
        <th class="num">Thn Lulus</th><th>Status Kepegawaian</th><th>TMT</th><th>Mapel</th><th>Alamat</th>
      </tr>
      ${guruList.map((g, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td style="white-space:nowrap;font-weight:800">${esc(g.nama)}</td>
        <td>${dg(g.nip)}</td>
        <td class="num">${g.jk ? esc(g.jk[0]) : '-'}</td>
        <td style="white-space:nowrap">${g.tempatLahir || g.tglLahir ? `${dg(g.tempatLahir)}, ${dg(g.tglLahir)}` : '-'}</td>
        <td>${dg(g.hp)}</td>
        <td>${dg(g.email)}</td>
        <td>${dg(g.pendidikan)}</td>
        <td>${dg(g.jurusan)}</td>
        <td>${dg(g.kampus)}</td>
        <td class="num">${dg(g.tahunLulus)}</td>
        <td>${dg(g.statusPeg)}</td>
        <td style="white-space:nowrap">${dg(g.tmt)}</td>
        <td>${dg((g.mapel || []).join(', '))}</td>
        <td>${dg(g.alamat)}</td>
      </tr>`).join('')}
    </table></div>`;
}

async function exportDataGuru() {
  if (!guruList.length) { showToast('Belum ada data guru.', false); return; }
  showLoading('Menyiapkan ekspor...');
  try {
    const XLSX = await ensureXLSX();
    const rows = guruList.map((g, i) => ({
      No: i + 1,
      Nama: g.nama,
      Username: g.username,
      'NIP / NUPTK': g.nip || '',
      'Jenis Kelamin': g.jk || '',
      'Tempat Lahir': g.tempatLahir || '',
      'Tanggal Lahir': g.tglLahir || '',
      'No. HP / WA': g.hp || '',
      Email: g.email || '',
      'Pendidikan Terakhir': g.pendidikan || '',
      'Program Studi / Jurusan': g.jurusan || '',
      'Perguruan Tinggi / Almamater': g.kampus || '',
      'Tahun Lulus': g.tahunLulus || '',
      'Status Kepegawaian': g.statusPeg || '',
      'TMT Mengajar': g.tmt || '',
      'Mata Pelajaran': (g.mapel || []).join(', '),
      Alamat: g.alamat || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.max(k.length + 2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data Guru');
    xlsxDownload(wb, `rekap_data_guru_${dk()}.xlsx`);
    showToast(`Data ${guruList.length} guru diekspor.`);
  } catch (e) { console.error(e); showToast('Gagal ekspor.', false); }
  hideLoading();
}

function openModalGuru(id) {
  editGuruId = id || null;
  const g = id ? guruList.find(x => x.id === id) : null;
  document.getElementById('modal-guru-title').textContent = g ? 'Edit Guru' : 'Tambah Guru';
  document.getElementById('mg-nama').value = g?.nama || '';
  document.getElementById('mg-nip').value = g?.nip || '';
  document.getElementById('mg-user').value = g?.username || '';
  mgMapelState = new Set(g?.mapel || []);
  renderMgMapel();
  document.getElementById('mg-pass').value = '';
  document.getElementById('mg-pw-info').innerHTML = g
    ? 'Kosongkan kolom password bila tidak ingin mengubahnya. Guru tidak dapat mengganti password sendiri.'
    : `Bila kolom password dikosongkan, akun baru memakai password awal <b>${GURU_DEFAULT_PW}</b>.`;
  openModal('modal-guru');
}
function renderMgMapel() {
  document.getElementById('mg-mapel').innerHTML = sekolah.mapel.map(m =>
    `<div class="chip ${mgMapelState.has(m) ? 'on' : ''}" onclick="toggleMgMapel(this)" data-m="${esc(m)}">${esc(m)}</div>`).join('');
}
function toggleMgMapel(el) {
  const m = el.dataset.m;
  mgMapelState.has(m) ? mgMapelState.delete(m) : mgMapelState.add(m);
  el.classList.toggle('on', mgMapelState.has(m));
}

async function simpanGuru() {
  const nama = document.getElementById('mg-nama').value.trim();
  const nip = document.getElementById('mg-nip').value.trim();
  const username = document.getElementById('mg-user').value.trim().toLowerCase();
  if (!nama || !username) { showToast('Nama dan username wajib diisi.', false); return; }
  if (!/^[a-z0-9._-]{3,}$/.test(username)) { showToast('Username minimal 3 karakter (huruf/angka/titik).', false); return; }
  if (guruList.some(g => g.username === username && g.id !== editGuruId)) { showToast('Username sudah dipakai guru lain.', false); return; }
  const passBaru = document.getElementById('mg-pass').value;
  if (passBaru && passBaru.length < 6) { showToast('Password minimal 6 karakter.', false); return; }
  showLoading('Menyimpan...');
  try {
    const id = editGuruId || uid();
    const old = editGuruId ? guruList.find(g => g.id === editGuruId) : null;
    const pwHash = passBaru ? await hashPw(passBaru)
      : (old ? old.pwHash : await hashPw(GURU_DEFAULT_PW));
    // Merge dengan data lama agar profil (data diri/pendidikan) yang diisi guru tidak hilang.
    const { id: _oldId, ...oldData } = old || {};
    await setDoc(doc(fs, 'jm_guru', id), { ...oldData, nama, nip, username, pwHash, mapel: [...mgMapelState] });
    await loadGuru();
    closeModal('modal-guru');
    showToast(old
      ? 'Data guru diperbarui.' + (passBaru ? ' Password baru tersimpan.' : '')
      : `Akun guru dibuat (password: ${passBaru ? 'sesuai isian' : GURU_DEFAULT_PW}).`);
    renderAGuru();
  } catch (e) { console.error(e); showToast('Gagal menyimpan.', false); }
  hideLoading();
}

function resetPwGuru(id) {
  const g = guruList.find(x => x.id === id); if (!g) return;
  confirmAction('Reset Password', `Password <b>${esc(g.nama)}</b> akan direset menjadi <b>${GURU_DEFAULT_PW}</b>. Lanjutkan?`, async () => {
    showLoading('Mereset...');
    try {
      const pwHash = await hashPw(GURU_DEFAULT_PW);
      const { id: _, ...data } = g;
      await setDoc(doc(fs, 'jm_guru', id), { ...data, pwHash });
      await loadGuru();
      showToast('Password direset ke ' + GURU_DEFAULT_PW);
    } catch (e) { showToast('Gagal mereset.', false); }
    hideLoading();
  });
}

function hapusGuru(id) {
  const g = guruList.find(x => x.id === id); if (!g) return;
  confirmAction('Hapus Akun Guru', `Akun <b>${esc(g.nama)}</b> akan dihapus (jurnal yang sudah dibuat tetap tersimpan). Lanjutkan?`, async () => {
    showLoading('Menghapus...');
    try {
      await deleteDoc(doc(fs, 'jm_guru', id));
      await loadGuru();
      showToast('Akun guru dihapus.');
      renderAGuru();
    } catch (e) { showToast('Gagal menghapus.', false); }
    hideLoading();
  });
}

// ═══════════════════ ADMIN: KELOLA SISWA ═══════════════════
function renderASiswa() {
  const el = document.getElementById('page-a-siswa');
  const filter = el.dataset.rombel || '';
  const list = filter ? siswaByRombel(filter) : siswaList;
  el.innerHTML = `
    <div class="card">
      <div class="section-title" style="justify-content:space-between">
        <span>${ico('grad',15)} Data Siswa <span class="badge-mini">${list.length}${filter ? ' / ' + siswaList.length : ''}</span></span>
        <span style="display:flex;gap:6px">
          <button class="btn-ghost" onclick="openModalUpload()">${ico('upload',13)} Upload</button>
          <button class="btn btn-sage" onclick="openModalSiswa()">${ico('plus',14)} Tambah</button>
        </span>
      </div>
      <div class="filter-row">
        <select class="input" onchange="aSiswaFilter(this.value)">
          <option value="">Semua rombel</option>
          ${rombelListSiswa().map(r => `<option value="${esc(r)}" ${r === filter ? 'selected' : ''}>${esc(r)}</option>`).join('')}
        </select>
        ${filter ? `<button class="btn-ghost" style="color:var(--rose2)" onclick="hapusSiswaRombel('${escArg(filter)}')">${ico('trash',13)} Hapus rombel ini</button>` : ''}
      </div>
      ${list.length ? list.map(s => `
        <div class="item">
          <div class="avatar" style="font-size:12px">${esc(s.rombel)}</div>
          <div class="grow">
            <div class="t1">${esc(s.nama)}</div>
            <div class="t2">NISN ${esc(s.nisn || '-')}</div>
          </div>
          <button class="btn-icon" onclick="openModalSiswa('${s.id}')">${ico('pencil',16)}</button>
          <button class="btn-icon" onclick="hapusSiswa('${s.id}')">${ico('trash',16)}</button>
        </div>`).join('') : `<div class="empty">Belum ada data siswa.<br>Gunakan tombol Upload untuk impor dari Excel.</div>`}
    </div>
    <div class="card">
      <div class="section-title" style="justify-content:space-between">
        <span>${ico('clipboard',15)} Rekap Data Siswa${filter ? ` — ${esc(filter)}` : ''}</span>
        <button class="btn-ghost" onclick="exportDataSiswa()">${ico('download',13)} Ekspor Excel</button>
      </div>
      <div class="hint" style="margin-bottom:8px">Mengikuti filter rombel di atas. Ekspor mengunduh data yang sedang ditampilkan.</div>
      ${list.length ? `
      <div class="table-wrap"><table class="tbl">
        <tr><th>No</th><th>Nama</th><th>Rombel</th><th>NISN</th></tr>
        ${list.map((s, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td style="font-weight:800">${esc(s.nama)}</td>
          <td class="num">${esc(s.rombel)}</td>
          <td>${esc(s.nisn || '-')}</td>
        </tr>`).join('')}
      </table></div>` : `<div class="empty">Belum ada data siswa.</div>`}
    </div>`;
}

async function exportDataSiswa() {
  const filter = document.getElementById('page-a-siswa').dataset.rombel || '';
  const list = filter ? siswaByRombel(filter) : siswaList;
  if (!list.length) { showToast('Belum ada data siswa.', false); return; }
  showLoading('Menyiapkan ekspor...');
  try {
    const XLSX = await ensureXLSX();
    const rows = list.map((s, i) => ({ No: i + 1, Nama: s.nama, Rombel: s.rombel, NISN: s.nisn || '' }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 5 }, { wch: 32 }, { wch: 9 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, filter ? `Siswa ${filter}` : 'Semua Siswa');
    xlsxDownload(wb, `rekap_data_siswa${filter ? '_' + filter : ''}_${dk()}.xlsx`);
    showToast(`Data ${list.length} siswa diekspor.`);
  } catch (e) { console.error(e); showToast('Gagal ekspor.', false); }
  hideLoading();
}
function aSiswaFilter(v) {
  document.getElementById('page-a-siswa').dataset.rombel = v;
  renderASiswa();
}

function openModalSiswa(id) {
  editSiswaId = id || null;
  const s = id ? siswaList.find(x => x.id === id) : null;
  document.getElementById('modal-siswa-title').textContent = s ? 'Edit Siswa' : 'Tambah Siswa';
  document.getElementById('ms-nama').value = s?.nama || '';
  document.getElementById('ms-nisn').value = s?.nisn || '';
  const sel = document.getElementById('ms-rombel');
  sel.innerHTML = rombelListSiswa().map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  if (s) sel.value = s.rombel;
  openModal('modal-siswa');
}

async function simpanSiswa() {
  const nama = document.getElementById('ms-nama').value.trim();
  const rombel = document.getElementById('ms-rombel').value;
  const nisn = document.getElementById('ms-nisn').value.trim();
  if (!nama || !rombel) { showToast('Nama dan rombel wajib diisi.', false); return; }
  showLoading('Menyimpan...');
  try {
    const id = editSiswaId || uid();
    await setDoc(doc(fs, 'jm_siswa', id), { nama, rombel, nisn });
    await loadSiswa();
    closeModal('modal-siswa');
    showToast('Data siswa disimpan.');
    renderASiswa();
  } catch (e) { showToast('Gagal menyimpan.', false); }
  hideLoading();
}

function hapusSiswa(id) {
  const s = siswaList.find(x => x.id === id); if (!s) return;
  confirmAction('Hapus Siswa', `Hapus <b>${esc(s.nama)}</b> (${esc(s.rombel)}) dari data siswa?`, async () => {
    showLoading('Menghapus...');
    try {
      await deleteDoc(doc(fs, 'jm_siswa', id));
      await loadSiswa();
      showToast('Siswa dihapus.');
      renderASiswa();
    } catch (e) { showToast('Gagal menghapus.', false); }
    hideLoading();
  });
}

function hapusSiswaRombel(rombel) {
  const n = siswaByRombel(rombel).length;
  confirmAction('Hapus Satu Rombel', `<b>${n} siswa</b> pada rombel <b>${esc(rombel)}</b> akan dihapus permanen. Lanjutkan?`, async () => {
    showLoading('Menghapus...');
    try {
      for (const s of siswaByRombel(rombel)) await deleteDoc(doc(fs, 'jm_siswa', s.id));
      await loadSiswa();
      document.getElementById('page-a-siswa').dataset.rombel = '';
      showToast(`${n} siswa rombel ${rombel} dihapus.`);
      renderASiswa();
    } catch (e) { showToast('Gagal menghapus.', false); }
    hideLoading();
  });
}

// ── Upload siswa dari Excel ──
function openModalUpload() {
  document.getElementById('up-file').value = '';
  document.getElementById('up-preview').textContent = '';
  openModal('modal-upload');
}

async function downloadTemplateSiswa() {
  showLoading('Menyiapkan template...');
  try {
    const XLSX = await ensureXLSX();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nama', 'Rombel', 'NISN'],
      ['Ahmad Fauzan', '7A', '0123456789'],
      ['Muhammad Rizki', '7A', '0123456790'],
    ]);
    ws['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Siswa');
    xlsxDownload(wb, 'template_data_siswa.xlsx');
  } catch (e) { showToast('Gagal memuat library Excel.', false); }
  hideLoading();
}

async function prosesUploadSiswa() {
  const file = document.getElementById('up-file').files[0];
  if (!file) { showToast('Pilih file terlebih dahulu.', false); return; }
  showLoading('Membaca file...');
  try {
    const XLSX = await ensureXLSX();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const norm = k => k.toLowerCase().replace(/[^a-z]/g, '');
    const parsed = [];
    for (const r of rows) {
      let nama = '', rombel = '', nisn = '';
      for (const [k, v] of Object.entries(r)) {
        const nk = norm(k);
        if (nk.includes('nama')) nama = String(v).trim();
        else if (nk.includes('rombel') || nk.includes('kelas')) rombel = String(v).trim().toUpperCase();
        else if (nk.includes('nisn') || nk.includes('nis')) nisn = String(v).trim();
      }
      if (nama && rombel) parsed.push({ nama, rombel, nisn });
    }
    if (!parsed.length) { hideLoading(); showToast('Tidak ada baris valid. Pastikan ada kolom Nama & Rombel.', false); return; }
    showLoading(`Mengunggah ${parsed.length} siswa...`);
    const byNisn = Object.fromEntries(siswaList.filter(s => s.nisn).map(s => [s.nisn, s.id]));
    let baru = 0, update = 0;
    for (const p of parsed) {
      const existId = p.nisn && byNisn[p.nisn];
      if (existId) { await setDoc(doc(fs, 'jm_siswa', existId), p); update++; }
      else { await setDoc(doc(fs, 'jm_siswa', uid()), p); baru++; }
    }
    // Tambahkan rombel baru ke pengaturan agar muncul di semua dropdown.
    const newRombel = [...new Set([...(sekolah.rombel || []), ...parsed.map(p => p.rombel)])].sort(cmpRombel);
    if (newRombel.length !== (sekolah.rombel || []).length) await saveSekolahDoc({ rombel: newRombel });
    await loadSiswa();
    closeModal('modal-upload');
    showToast(`Upload selesai: ${baru} siswa baru, ${update} diperbarui.`);
    renderASiswa();
  } catch (e) { console.error(e); showToast('Gagal membaca file. Pastikan format .xlsx.', false); }
  hideLoading();
}

// ═══════════════════ ADMIN: MONITOR JURNAL ═══════════════════
async function renderAJurnal() {
  const el = document.getElementById('page-a-jurnal');
  const tgl = el.dataset.tgl || dk();
  const guruF = el.dataset.guru || '';
  el.innerHTML = `
    <div class="card">
      <div class="section-title" style="justify-content:space-between">
        <span>${ico('clipboard',15)} Monitor Jurnal</span>
        <span style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-ghost" onclick="exportJurnalBulan()">${ico('download',13)} Excel sebulan</button>
          <button class="btn-ghost" onclick="exportPdfJurnalGuru()">${ico('download',13)} PDF per guru</button>
          <button class="btn-ghost" onclick="openModalFormulir()">${ico('printer',13)} Formulir cetak</button>
        </span>
      </div>
      <div class="filter-row">
        <input class="input" type="date" value="${tgl}" onchange="aJurnalTgl(this.value)"/>
        <select class="input" onchange="aJurnalGuru(this.value)">
          <option value="">Semua guru</option>
          ${guruList.map(g => `<option value="${g.id}" ${g.id === guruF ? 'selected' : ''}>${esc(g.nama)}</option>`).join('')}
        </select>
      </div>
      <div class="hint" style="margin-bottom:8px">Ekspor mengikuti <b>bulan dari tanggal</b> di atas. <b>Excel sebulan</b> memuat jurnal semua guru; <b>PDF per guru</b> mencetak laporan bulanan guru yang dipilih (kop madrasah + kolom tanda tangan).</div>
      <div id="aj-list"><div class="empty">Memuat...</div></div>
    </div>`;
  try {
    let list = await jurnalByTanggal(tgl);
    if (guruF) list = list.filter(j => j.guruId === guruF);
    list.sort((a, b) => (a.guruNama || '').localeCompare(b.guruNama || '', 'id'));
    document.getElementById('aj-list').innerHTML = list.length
      ? list.map(j => jurnalItemHTML(j, true)).join('')
      : `<div class="empty">Tidak ada jurnal pada tanggal ini.</div>`;
  } catch (e) {
    console.error(e);
    document.getElementById('aj-list').innerHTML = `<div class="empty">Gagal memuat data.</div>`;
  }
}
function aJurnalTgl(v) { document.getElementById('page-a-jurnal').dataset.tgl = v; renderAJurnal(); }
function aJurnalGuru(v) { document.getElementById('page-a-jurnal').dataset.guru = v; renderAJurnal(); }

async function exportJurnalBulan() {
  const tgl = document.getElementById('page-a-jurnal').dataset.tgl || dk();
  const ym = tgl.slice(0, 7);
  showLoading('Menyiapkan ekspor...');
  try {
    const XLSX = await ensureXLSX();
    const list = (await jurnalByRange(ym + '-01', ym + '-31'))
      .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || (a.guruNama || '').localeCompare(b.guruNama || ''));
    if (!list.length) { hideLoading(); showToast('Tidak ada jurnal pada bulan ini.', false); return; }
    const kbcLabel = k => KBC_VALUES.find(v => v.key === k)?.label || k;
    // Satu pertemuan kelas gabungan menjadi satu baris per rombel, dengan
    // kehadiran masing-masing — pengisian sekali, laporan tetap terpisah.
    const rows = list.flatMap(j => {
      const rombel = rombelDoc(j);
      const rekapR = j.rekapRombel || rekapPerRombel(j.absen, rombel);
      const isi = {
        Mapel: j.mapel, Materi: j.materi, 'Tujuan Pembelajaran': j.tujuan || '',
        Kegiatan: j.kegiatan || '', Metode: j.metode || '', Asesmen: j.asesmen || '',
        'Nilai KBC': (j.kbc || []).map(kbcLabel).join(', '), 'Penerapan KBC': j.kbcCatatan || '',
        Refleksi: j.refleksi || '',
      };
      return (rombel.length ? rombel : ['']).map(r => {
        const k = (rombel.length > 1 ? rekapR[r] : j.rekap) || {};
        return {
          Tanggal: j.tanggal, 'Jam ke': j.jamKe || '', Guru: j.guruNama,
          Rombel: r || j.rombel || '',
          'Kelas Pengisian': rombel.length > 1 ? j.rombel : '',
          ...isi,
          Hadir: k.H ?? 0, Sakit: k.S ?? 0, Izin: k.I ?? 0, Alpa: k.A ?? 0,
        };
      });
    }).sort((a, b) => a.Tanggal.localeCompare(b.Tanggal)
      || String(a.Guru).localeCompare(String(b.Guru), 'id')
      || cmpRombel(a.Rombel, b.Rombel));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Jurnal ' + ym);
    xlsxDownload(wb, `jurnal_mengajar_${ym}.xlsx`);
  } catch (e) { console.error(e); showToast('Gagal ekspor.', false); }
  hideLoading();
}

// ═══════════════════ EKSPOR PDF: JURNAL BULANAN PER GURU ═══════════════════
// Dipakai dua sisi: guru mencetak jurnalnya sendiri dari menu Riwayat, admin
// mencetak jurnal guru mana pun dari menu Monitor Jurnal.

async function exportPdfJurnalBulanan(guru, ym, fetchList) {
  showLoading('Menyiapkan PDF...');
  try {
    const list = await fetchList();
    if (!list.length) {
      hideLoading();
      showToast(`Tidak ada jurnal pada ${namaBulan(ym)}.`, false);
      return;
    }
    const pdf = await buildJurnalBulananPDF({ sekolah, guru, ym, list });
    pdfDownload(pdf, namaFilePDF(guru.nama, ym));
    showToast(`PDF ${list.length} pertemuan berhasil dibuat.`);
  } catch (e) {
    console.error(e);
    showToast('Gagal membuat PDF. Periksa koneksi internet.', false);
  }
  hideLoading();
}

// Guru: jurnal miliknya sendiri, bulan yang sedang dipilih di menu Riwayat.
function exportPdfRiwayat() {
  const ym = document.getElementById('page-g-riwayat').dataset.bulan || dk().slice(0, 7);
  return exportPdfJurnalBulanan(currentUser, ym, async () =>
    (await jurnalByGuru(currentUser.id)).filter(j => (j.tanggal || '').startsWith(ym)));
}

// Admin: mengikuti filter guru & bulan (dari tanggal) di menu Monitor Jurnal.
function exportPdfJurnalGuru() {
  const el = document.getElementById('page-a-jurnal');
  const guruId = el.dataset.guru || '';
  if (!guruId) { showToast('Pilih guru terlebih dahulu untuk ekspor PDF.', false); return; }
  const guru = guruList.find(g => g.id === guruId);
  if (!guru) { showToast('Data guru tidak ditemukan.', false); return; }
  const ym = (el.dataset.tgl || dk()).slice(0, 7);
  return exportPdfJurnalBulanan(guru, ym, async () =>
    (await jurnalByRange(ym + '-01', ym + '-31')).filter(j => j.guruId === guruId));
}

// ═══════════════════ ADMIN: FORMULIR CETAK (ISIAN MANUAL) ═══════════════════
// Untuk guru yang tidak bisa online: cetak sekali di awal semester, isi tangan,
// lalu disalin ke aplikasi saat ada koneksi. Identitas guru & mapel dikosongkan
// supaya satu berkas cukup difotokopi untuk semua guru; nama siswa tetap
// tercetak karena itulah bagian yang paling repot ditulis ulang.
let mfRombel = new Set();

function openModalFormulir() {
  mfRombel = new Set(rombelListSiswa());
  renderMfRombel();
  openModal('modal-formulir');
}

function renderMfRombel() {
  const daftar = rombelListSiswa();
  document.getElementById('mf-rombel').innerHTML = daftar.length
    ? daftar.map(r => `<div class="chip ${mfRombel.has(r) ? 'on' : ''}" onclick="mfToggleRombel('${escArg(r)}')">
        ${esc(r)} <span class="hint">${siswaByRombel(r).length}</span></div>`).join('')
    : '<span class="hint">Belum ada rombel.</span>';
  const total = [...mfRombel].reduce((a, r) => a + siswaByRombel(r).length, 0);
  document.getElementById('mf-info').textContent = mfRombel.size
    ? `${mfRombel.size} lembar daftar hadir · ${total} nama siswa tercetak.`
    : 'Tidak ada rombel dipilih — berkas hanya berisi lembar jurnal kosong.';
}

function mfToggleRombel(r) {
  mfRombel.has(r) ? mfRombel.delete(r) : mfRombel.add(r);
  renderMfRombel();
}

async function unduhFormulirPDF() {
  const jepit = (id, min, max, fallback) => {
    const v = num(document.getElementById(id).value);
    return v === null ? fallback : Math.min(max, Math.max(min, Math.round(v)));
  };
  const halamanJurnal = jepit('mf-halaman', 1, 30, 6);
  const kolomPertemuan = jepit('mf-kolom', 4, 30, 20);
  showLoading('Menyiapkan formulir...');
  try {
    const rombel = rombelListSiswa()
      .filter(r => mfRombel.has(r))
      .map(r => ({ rombel: r, siswa: urutkanSiswa(siswaByRombel(r), sekolah.urutSiswa) }));
    const pdf = await buildFormulirPDF({ sekolah, halamanJurnal, kolomPertemuan, rombel });
    pdfDownload(pdf, namaFileFormulir(sekolah));
    closeModal('modal-formulir');
    showToast('Formulir cetak berhasil dibuat.');
  } catch (e) {
    console.error(e);
    showToast('Gagal membuat formulir. Periksa koneksi internet.', false);
  }
  hideLoading();
}

// ═══════════════════ REKAP ABSENSI (guru & admin) ═══════════════════
// Halaman Rekap admin punya dua tab: absensi (lama) dan nilai. Navbar admin
// sudah padat, jadi rekap nilai menumpang di sini alih-alih jadi menu baru.
function renderARekap() {
  const el = document.getElementById('page-a-rekap');
  const tab = el.dataset.tab || 'absensi';
  el.innerHTML = `
    <div class="tabbar" style="margin-bottom:12px">
      <button class="btn-tab ${tab === 'absensi' ? 'active' : ''}" onclick="aRekapTab('absensi')">${ico('check-square', 15)} Absensi</button>
      <button class="btn-tab ${tab === 'nilai' ? 'active' : ''}" onclick="aRekapTab('nilai')">${ico('star', 15)} Nilai</button>
    </div>
    <div id="a-rekap-body"></div>`;
  if (tab === 'absensi') renderRekapPage('page-a-rekap', false, 'a-rekap-body');
  else renderARekapNilai();
}

function aRekapTab(tab) {
  const el = document.getElementById('page-a-rekap');
  el.dataset.tab = tab;
  // Guru bisa saja baru mengisi nilai; ambil ulang tiap kali tab dibuka,
  // tetapi tidak saat berpindah rombel atau membuka rincian.
  if (tab === 'nilai') { nilaiSemuaLoaded = false; delete el.dataset.detail; }
  renderARekap();
}

// State filter dibaca dari elemen pageId (yang tetap ada saat tab berganti),
// sedangkan HTML ditulis ke targetId.
function renderRekapPage(pageId, guruOnly, targetId = pageId) {
  const el = document.getElementById(pageId);
  const ym = el.dataset.ym || dk().slice(0, 7);
  const rombel = el.dataset.rombel || '';
  const mapel = el.dataset.mapel || '';
  const mapelOpts = guruOnly && currentUser.mapel?.length ? currentUser.mapel : sekolah.mapel;
  document.getElementById(targetId).innerHTML = `
    <div class="card">
      <div class="section-title" style="justify-content:space-between">
        <span>${ico('chart',15)} Rekap Absensi Siswa</span>
        <button class="btn-ghost" onclick="exportRekap('${pageId}',${guruOnly})">${ico('download',13)} Ekspor</button>
      </div>
      <div class="filter-row">
        <input class="input" type="month" value="${ym}" onchange="rekapSet('${pageId}','ym',this.value,${guruOnly})"/>
        <select class="input" onchange="rekapSet('${pageId}','rombel',this.value,${guruOnly})">
          <option value="">— pilih rombel —</option>
          ${rombelListSiswa().map(r => `<option value="${esc(r)}" ${r === rombel ? 'selected' : ''}>${esc(r)}</option>`).join('')}
        </select>
        <select class="input" onchange="rekapSet('${pageId}','mapel',this.value,${guruOnly})">
          <option value="">Semua mapel</option>
          ${mapelOpts.map(m => `<option value="${esc(m)}" ${m === mapel ? 'selected' : ''}>${esc(m)}</option>`).join('')}
        </select>
      </div>
      <div id="${pageId}-tbl">${rombel ? '<div class="empty">Memuat...</div>' : '<div class="empty">Pilih rombel untuk melihat rekap.</div>'}</div>
    </div>`;
  if (rombel) buildRekapTable(pageId, guruOnly);
}
function rekapSet(pageId, key, val, guruOnly) {
  document.getElementById(pageId).dataset[key] = val;
  if (pageId === 'page-a-rekap') renderARekap();
  else renderRekapPage(pageId, guruOnly);
}

async function hitungRekapData(pageId, guruOnly) {
  const el = document.getElementById(pageId);
  const ym = el.dataset.ym || dk().slice(0, 7);
  const rombel = el.dataset.rombel;
  const mapel = el.dataset.mapel || '';
  let list = await jurnalByRange(ym + '-01', ym + '-31');
  // Jurnal kelas gabungan (mis. 7A+7B) ikut terhitung pada rekap tiap
  // rombelnya; statistik di bawah hanya menghitung siswa rombel ini.
  list = list.filter(j => docPunyaRombel(j, rombel));
  if (mapel) list = list.filter(j => j.mapel === mapel);
  if (guruOnly) list = list.filter(j => j.guruId === currentUser.id);
  const siswa = siswaByRombel(rombel);
  const stat = Object.fromEntries(siswa.map(s => [s.id, { H: 0, S: 0, I: 0, A: 0 }]));
  for (const j of list) for (const [sid, st] of Object.entries(j.absen || {}))
    if (stat[sid] && stat[sid][st] !== undefined) stat[sid][st]++;
  return { ym, rombel, mapel, pertemuan: list.length, siswa, stat };
}

async function buildRekapTable(pageId, guruOnly) {
  const target = document.getElementById(pageId + '-tbl');
  try {
    const { pertemuan, siswa, stat } = await hitungRekapData(pageId, guruOnly);
    if (!siswa.length) { target.innerHTML = '<div class="empty">Belum ada data siswa untuk rombel ini.</div>'; return; }
    if (!pertemuan) { target.innerHTML = '<div class="empty">Belum ada jurnal (pertemuan) yang cocok dengan filter ini.</div>'; return; }
    target.innerHTML = `
      <div class="hint" style="margin-bottom:8px">Jumlah pertemuan tercatat: <b>${pertemuan}</b></div>
      <div class="table-wrap"><table class="tbl">
        <tr><th>#</th><th>Nama</th><th class="num">H</th><th class="num">S</th><th class="num">I</th><th class="num">A</th><th class="num">% Hadir</th></tr>
        ${siswa.map((s, i) => {
          const t = stat[s.id]; const tot = t.H + t.S + t.I + t.A;
          const pct = tot ? Math.round(t.H / tot * 100) : 0;
          return `<tr><td>${i + 1}</td><td>${esc(s.nama)}</td>
            <td class="num" style="color:#5a9b86;font-weight:800">${t.H}</td>
            <td class="num" style="color:#a8874d">${t.S}</td>
            <td class="num" style="color:#5a8aaa">${t.I}</td>
            <td class="num" style="color:#a86870;font-weight:800">${t.A}</td>
            <td class="num" style="font-weight:800;color:${pct >= 90 ? '#5a9b86' : pct >= 75 ? '#a8874d' : '#a86870'}">${pct}%</td></tr>`;
        }).join('')}
      </table></div>`;
  } catch (e) { console.error(e); target.innerHTML = '<div class="empty">Gagal memuat rekap.</div>'; }
}

async function exportRekap(pageId, guruOnly) {
  const el = document.getElementById(pageId);
  if (!el.dataset.rombel) { showToast('Pilih rombel terlebih dahulu.', false); return; }
  showLoading('Menyiapkan ekspor...');
  try {
    const XLSX = await ensureXLSX();
    const { ym, rombel, mapel, pertemuan, siswa, stat } = await hitungRekapData(pageId, guruOnly);
    const rows = siswa.map((s, i) => {
      const t = stat[s.id]; const tot = t.H + t.S + t.I + t.A;
      return {
        No: i + 1, Nama: s.nama, NISN: s.nisn || '', Rombel: s.rombel,
        Hadir: t.H, Sakit: t.S, Izin: t.I, Alpa: t.A,
        '% Hadir': tot ? Math.round(t.H / tot * 100) + '%' : '-',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Rekap ${rombel}`);
    xlsxDownload(wb, `rekap_absensi_${rombel}_${ym}${mapel ? '_' + mapel.replace(/\W+/g, '') : ''}.xlsx`);
    showToast(`Rekap ${pertemuan} pertemuan diekspor.`);
  } catch (e) { console.error(e); showToast('Gagal ekspor.', false); }
  hideLoading();
}

// ═══════════════════ ADMIN: REKAP NILAI ═══════════════════
// Admin memakai seluruh dokumen jm_nilai (semua guru), sedangkan menu Nilai
// guru hanya memuat miliknya sendiri.

async function loadNilaiSemua() {
  const snap = await getDocs(collection(fs, 'jm_nilai'));
  nilaiSemua = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Hanya TP & semester yang sedang berjalan — sama dengan cakupan menu guru.
function nilaiAktif() {
  return nilaiSemua.filter(n =>
    n.tahunPelajaran === sekolah.tahunPelajaran && n.semester === sekolah.semester);
}

function namaGuru(guruId) {
  return guruList.find(g => g.id === guruId)?.nama || '(guru sudah dihapus)';
}

// Satu baris per kombinasi guru × mapel × rombel. Penilaian kelas gabungan
// (7A+7B) dihitung pada baris kedua rombelnya, masing-masing hanya dengan
// siswa rombel itu — pengisian sekali, pemantauan tetap per rombel.
function rekapKelengkapan() {
  const peta = new Map();
  for (const n of nilaiAktif()) {
    for (const rombel of rombelDoc(n)) {
      const k = `${n.guruId}|${n.mapel}|${rombel}`;
      if (!peta.has(k)) {
        peta.set(k, {
          kunci: k, guruId: n.guruId, mapel: n.mapel, rombel,
          formatif: 0, sumatif: 0, sas: 0, terisi: 0, sel: 0,
        });
      }
      const r = peta.get(k);
      if (r[n.jenis] !== undefined) r[n.jenis]++;
      const anggota = siswaByRombel(rombel);
      r.sel += anggota.length;
      r.terisi += anggota.filter(s => num(n.nilai?.[s.id]) !== null).length;
    }
  }
  return [...peta.values()]
    .map(r => ({ ...r, guru: namaGuru(r.guruId), persen: r.sel ? Math.round(r.terisi / r.sel * 100) : 0 }))
    .sort((a, b) => a.guru.localeCompare(b.guru, 'id')
      || cmpRombel(a.rombel, b.rombel)
      || a.mapel.localeCompare(b.mapel, 'id'));
}

// Leger satu rombel lintas mapel: NA tiap mapel per siswa.
function legerRombel(rombel) {
  const list = nilaiAktif().filter(n => docPunyaRombel(n, rombel));
  const mapelSet = [...new Set(list.map(n => n.mapel))].sort((a, b) => a.localeCompare(b, 'id'));
  const siswa = urutkanSiswa(siswaByRombel(rombel), sekolah.urutSiswa);
  const baris = siswa.map(s => {
    const na = {};
    for (const m of mapelSet) {
      const kol = list.filter(n => n.mapel === m);
      const val = k => num(k.nilai?.[s.id]);
      const sasK = kol.find(k => k.jenis === 'sas');
      na[m] = bulat(hitungNA(
        rata(kol.filter(k => k.jenis === 'formatif').map(val)),
        rata(kol.filter(k => k.jenis === 'sumatif').map(val)),
        sasK ? val(sasK) : null));
    }
    return { s, na };
  });
  return { mapelSet, siswa, baris };
}

async function renderARekapNilai() {
  const el = document.getElementById('page-a-rekap');
  const body = document.getElementById('a-rekap-body');
  if (!nilaiSemuaLoaded) {
    body.innerHTML = `<div class="empty">Memuat data nilai...</div>`;
    try { await loadNilaiSemua(); nilaiSemuaLoaded = true; }
    catch (e) { console.error(e); body.innerHTML = `<div class="empty">Gagal memuat data nilai.</div>`; return; }
  }
  if (el.dataset.detail) { renderDetailNilai(el.dataset.detail); return; }

  const rows = rekapKelengkapan();
  const rombel = el.dataset.nrombel || '';
  body.innerHTML = `
    <div class="card">
      <div class="section-title" style="justify-content:space-between">
        <span>${ico('clipboard', 15)} Kelengkapan Penilaian</span>
        <button class="btn-ghost" onclick="exportRekapNilai()">${ico('download', 13)} Ekspor Excel</button>
      </div>
      <div class="hint" style="margin-bottom:8px">
        TP ${esc(sekolah.tahunPelajaran)} semester ${esc(sekolah.semester)}.
        Ketuk satu baris untuk melihat rincian nilainya. Kolom SAS bertanda merah
        berarti Sumatif Akhir Semester belum dibuat.
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="tbl">
        <tr><th>Guru</th><th>Rombel</th><th>Mapel</th><th class="num">F</th><th class="num">SLM</th>
            <th class="num">SAS</th><th class="num">Terisi</th></tr>
        ${rows.map(r => `<tr style="cursor:pointer" onclick="bukaDetailNilai('${escArg(r.kunci)}')">
          <td>${esc(r.guru)}</td>
          <td>${esc(r.rombel)}</td>
          <td>${esc(r.mapel)}</td>
          <td class="num">${r.formatif}</td>
          <td class="num">${r.sumatif}</td>
          <td class="num" style="font-weight:900;color:${r.sas ? '#5a9b86' : '#a86870'}">${r.sas || '–'}</td>
          <td class="num" style="font-weight:800;color:${r.persen >= 100 ? '#5a9b86' : r.persen >= 50 ? '#a8874d' : '#a86870'}">${r.persen}%</td>
        </tr>`).join('')}
      </table></div>` : '<div class="empty">Belum ada guru yang mengisi nilai pada semester ini.</div>'}
    </div>

    <div class="card">
      <div class="section-title">${ico('chart', 15)} Leger Nilai per Rombel</div>
      <div class="hint" style="margin-bottom:8px">
        Nilai Akhir tiap mapel untuk satu rombel — dipakai wali kelas dan kurikulum
        mencocokkan dengan RDM. Angka merah berarti di bawah batas tuntas KKTP mapel itu.
      </div>
      <div class="filter-row">
        <select class="input" onchange="rekapSet('page-a-rekap','nrombel',this.value,false)">
          <option value="">— pilih rombel —</option>
          ${rombelListSiswa().map(r => `<option value="${esc(r)}" ${r === rombel ? 'selected' : ''}>${esc(r)}</option>`).join('')}
        </select>
      </div>
      ${rombel ? blokLegerRombel(rombel) : '<div class="empty">Pilih rombel untuk melihat leger.</div>'}
    </div>`;
}

function blokLegerRombel(rombel) {
  const { mapelSet, baris } = legerRombel(rombel);
  if (!baris.length) return `<div class="empty">Belum ada data siswa untuk rombel ${esc(rombel)}.</div>`;
  if (!mapelSet.length) return `<div class="empty">Belum ada nilai yang diisi untuk rombel ini.</div>`;
  return `
    <div class="table-wrap"><table class="tbl">
      <tr><th>#</th><th>Nama</th>${mapelSet.map(m => `<th class="num">${esc(m)}</th>`).join('')}</tr>
      ${baris.map((r, i) => `<tr>
        <td>${i + 1}</td><td>${esc(r.s.nama)}</td>
        ${mapelSet.map(m => {
          const v = r.na[m];
          if (v === null || v === undefined) return '<td class="num" style="color:var(--muted)">–</td>';
          const tuntas = v >= kktpUntuk(m);
          return `<td class="num" style="font-weight:800;color:${tuntas ? '' : '#a86870'}">${v}</td>`;
        }).join('')}
      </tr>`).join('')}
    </table></div>`;
}

// Rincian nilai satu guru pada satu mapel & rombel — hanya baca.
function bukaDetailNilai(kunci) {
  document.getElementById('page-a-rekap').dataset.detail = kunci;
  renderARekap();
}
function tutupDetailNilai() {
  delete document.getElementById('page-a-rekap').dataset.detail;
  renderARekap();
}

function renderDetailNilai(kunci) {
  const body = document.getElementById('a-rekap-body');
  const [guruId, mapel, rombel] = kunci.split('|');
  const kolom = nilaiAktif()
    .filter(n => n.guruId === guruId && n.mapel === mapel && docPunyaRombel(n, rombel))
    .sort((a, b) => NILAI_JENIS.findIndex(j => j.key === a.jenis) - NILAI_JENIS.findIndex(j => j.key === b.jenis)
      || (a.urut || 0) - (b.urut || 0));
  const siswa = urutkanSiswa(siswaByRombel(rombel), sekolah.urutSiswa);
  body.innerHTML = `
    <div class="card card-sage">
      <div class="section-title" style="justify-content:space-between">
        <span>${ico('star', 15)} Rincian Nilai</span>
        <button class="btn-ghost" onclick="tutupDetailNilai()">${ico('chevron', 13)} Kembali</button>
      </div>
      <div class="hint">
        <b>${esc(namaGuru(guruId))}</b> · ${esc(mapel)} · ${esc(rombel)} ·
        batas tuntas KKTP <b>${kktpUntuk(mapel)}</b>. Tampilan ini hanya baca —
        perubahan nilai tetap lewat akun guru yang bersangkutan.
      </div>
    </div>
    <div class="card">
      ${kolom.length ? `<div class="table-wrap"><table class="tbl">
        <tr><th>#</th><th>Nama</th>${kolom.map(k =>
          `<th class="num" title="${esc(NILAI_JENIS_MAP[k.jenis]?.label || '')}">${esc(k.nama)}</th>`).join('')}</tr>
        ${siswa.map((s, i) => `<tr>
          <td>${i + 1}</td><td>${esc(s.nama)}</td>
          ${kolom.map(k => {
            const v = num(k.nilai?.[s.id]);
            return v === null
              ? '<td class="num" style="color:var(--muted)">–</td>'
              : `<td class="num" style="font-weight:800;color:${v >= kktpUntuk(mapel) ? '' : '#a86870'}">${v}</td>`;
          }).join('')}
        </tr>`).join('')}
      </table></div>` : '<div class="empty">Belum ada penilaian.</div>'}
    </div>`;
}

async function exportRekapNilai() {
  const rows = rekapKelengkapan();
  if (!rows.length) { showToast('Belum ada nilai untuk diekspor.', false); return; }
  showLoading('Menyiapkan ekspor...');
  try {
    const XLSX = await ensureXLSX();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(r => ({
      Guru: r.guru, Rombel: r.rombel, Mapel: r.mapel,
      Formatif: r.formatif, 'Sumatif LM': r.sumatif, SAS: r.sas,
      'Terisi (%)': r.persen,
    }))), 'Kelengkapan');

    // Leger tiap rombel yang sudah punya nilai, satu sheet per rombel.
    for (const rombel of rombelListSiswa()) {
      const { mapelSet, baris } = legerRombel(rombel);
      if (!mapelSet.length || !baris.length) continue;
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(baris.map((r, i) => {
        const o = { No: i + 1, NISN: r.s.nisn || '', Nama: r.s.nama };
        for (const m of mapelSet) o[m] = r.na[m] ?? '';
        return o;
      })), `Leger ${rombel}`.slice(0, 31));
    }
    xlsxDownload(wb, `rekap_nilai_${sekolah.semester}_${sekolah.tahunPelajaran.replace('/', '-')}.xlsx`);
    showToast('Rekap nilai diekspor.');
  } catch (e) { console.error(e); showToast('Gagal ekspor.', false); }
  hideLoading();
}

// ═══════════════════ ADMIN: PENGATURAN ═══════════════════
function renderASet() {
  // Daftar rombel/mapel selalu dari data tersimpan (perubahan dipersist langsung
  // oleh setAddItem/setDelItem, tidak menunggu tombol Simpan).
  aSetState = { rombel: [...(sekolah.rombel || [])], mapel: [...(sekolah.mapel || [])] };
  // Jangan reset isian identitas yang sedang diedit saat halaman dirender ulang.
  const curNama = document.getElementById('set-nama')?.value;
  const curTp = document.getElementById('set-tp')?.value;
  const curSmt = document.getElementById('set-smt')?.value || sekolah.semester;
  const curKota = document.getElementById('set-kota')?.value;
  const curKepala = document.getElementById('set-kepala')?.value;
  const curNipKepala = document.getElementById('set-nip-kepala')?.value;
  const curKktp = document.getElementById('set-kktp')?.value;
  const curUrut = document.getElementById('set-urut')?.value;
  const curBf = document.getElementById('set-bobot-f')?.value;
  const curBs = document.getElementById('set-bobot-s')?.value;
  const curBsas = document.getElementById('set-bobot-sas')?.value;
  // KKTP per mapel: pertahankan isian yang sedang diedit; kalau halaman baru
  // dibuka, ambil dari data tersimpan. Mapel yang baru ditambah tampil kosong.
  const curKktpMapel = {};
  let sedangEdit = false;
  document.querySelectorAll('#page-a-set .kktp-mapel').forEach(el => {
    sedangEdit = true;
    curKktpMapel[el.dataset.mapel] = el.value;
  });
  const kktpDefault = curKktp ?? sekolah.kktpMin ?? 70;
  const nilaiKktpMapel = m =>
    sedangEdit ? (curKktpMapel[m] ?? '') : (sekolah.kktpMapel?.[m] ?? '');
  const el = document.getElementById('page-a-set');
  el.innerHTML = `
    <div class="card card-sage">
      <div class="section-title">${ico('building',15)} Identitas Sekolah</div>
      <div class="input-wrap"><label>Nama Sekolah/Madrasah</label><input id="set-nama" class="input" value="${esc(curNama ?? sekolah.nama)}"/></div>
      <div class="grid2">
        <div class="input-wrap"><label>Tahun Pelajaran</label><input id="set-tp" class="input" value="${esc(curTp ?? sekolah.tahunPelajaran)}" placeholder="2026/2027"/></div>
        <div class="input-wrap"><label>Semester</label>
          <select id="set-smt" class="input">
            <option ${curSmt === 'Ganjil' ? 'selected' : ''}>Ganjil</option>
            <option ${curSmt === 'Genap' ? 'selected' : ''}>Genap</option>
          </select></div>
      </div>
      <div class="hint" style="margin:2px 0 10px">Data di bawah dipakai untuk kop dan kolom tanda tangan pada laporan PDF jurnal bulanan guru.</div>
      <div class="grid2">
        <div class="input-wrap"><label>Kota / Tempat</label><input id="set-kota" class="input" value="${esc(curKota ?? sekolah.kota ?? '')}" placeholder="cth: Tarakan"/></div>
        <div class="input-wrap"><label>NIP Kepala Madrasah <span class="opt">(opsional)</span></label><input id="set-nip-kepala" class="input" value="${esc(curNipKepala ?? sekolah.nipKepala ?? '')}" placeholder="NIP / NUPTK"/></div>
      </div>
      <div class="input-wrap"><label>Nama Kepala Madrasah <span class="opt">(opsional)</span></label><input id="set-kepala" class="input" value="${esc(curKepala ?? sekolah.kepala ?? '')}" placeholder="Nama beserta gelar"/></div>
    </div>
    <div class="card">
      <div class="section-title">${ico('star',15)} Penilaian</div>
      <div class="hint" style="margin-bottom:10px">
        Dipakai pada menu Nilai milik guru; hanya admin yang dapat mengubahnya.
        Samakan bobot dengan menu <b>Bobot</b> di RDM,
        dan urutan siswa dengan urutan pada template Excel RDM agar nilai bisa disalin per kolom.
        Tersimpan bersama tombol Simpan Identitas Sekolah di bawah.
      </div>
      <div class="grid2">
        <div class="input-wrap"><label>Batas Tuntas KKTP <span class="opt">(default)</span></label>
          <input id="set-kktp" class="input" type="number" min="0" max="100" value="${esc(kktpDefault)}"
            oninput="setKktpPlaceholder(this.value)"/></div>
        <div class="input-wrap"><label>Urutan Siswa</label>
          <select id="set-urut" class="input">
            ${URUT_SISWA.map(u => `<option value="${u.key}" ${(curUrut ?? sekolah.urutSiswa) === u.key ? 'selected' : ''}>${esc(u.label)}</option>`).join('')}
          </select></div>
      </div>
      <div class="input-wrap" style="margin-bottom:2px"><label>KKTP per Mata Pelajaran</label></div>
      <div class="hint" style="margin-bottom:8px">Kosongkan bila mapel tersebut mengikuti batas tuntas default di atas.</div>
      <div class="grid2">
        ${aSetState.mapel.map(m => `
        <div class="input-wrap"><label class="opt">${esc(m)}</label>
          <input class="input kktp-mapel" data-mapel="${esc(m)}" type="number" min="0" max="100"
            placeholder="${esc(kktpDefault)}" value="${esc(nilaiKktpMapel(m))}"/></div>`).join('')
          || '<span class="hint">Belum ada mapel.</span>'}
      </div>
      <div class="input-wrap" style="margin-bottom:4px"><label>Bobot Nilai Akhir (%)</label></div>
      <div class="grid3">
        <div class="input-wrap"><label class="opt">Formatif</label>
          <input id="set-bobot-f" class="input" type="number" min="0" max="100" value="${esc(curBf ?? bobotNilai().formatif)}"/></div>
        <div class="input-wrap"><label class="opt">Sumatif LM</label>
          <input id="set-bobot-s" class="input" type="number" min="0" max="100" value="${esc(curBs ?? bobotNilai().sumatif)}"/></div>
        <div class="input-wrap"><label class="opt">SAS</label>
          <input id="set-bobot-sas" class="input" type="number" min="0" max="100" value="${esc(curBsas ?? bobotNilai().sas)}"/></div>
      </div>
    </div>
    <div class="card">
      <div class="section-title">${ico('tag',15)} Daftar Rombel</div>
      <div class="hint" style="margin-bottom:8px">Klik nama rombel untuk mengelola: ganti nama, atur anggota, dan migrasi siswa ke rombel setingkat. Perubahan langsung tersimpan otomatis; menghapus rombel tidak menghapus data siswanya.</div>
      <label style="display:flex;gap:9px;align-items:flex-start;padding:10px 12px;margin-bottom:10px;
        border:1px solid var(--border);border-radius:12px;cursor:pointer">
        <input type="checkbox" ${gabungAktif() ? 'checked' : ''} onchange="setGabungRombel(this.checked)" style="margin-top:2px"/>
        <span>
          <span style="font-size:13px;font-weight:800">Gabungkan rombel setingkat saat pengisian</span>
          <span class="hint" style="display:block;margin-top:3px">
            Dipakai bila rombel setingkat belajar dalam satu ruang. Guru mengisi jurnal, absensi,
            dan nilai <b>sekali</b> untuk ${esc(daftarKelasTeks() || '7A+7B, 8A+8B, …')} —
            laporan, rekap, dan ekspor tetap <b>dipisah per rombel</b>.
          </span>
        </span>
      </label>
      <div class="kbc-wrap" style="margin-bottom:10px">
        ${aSetState.rombel.map(r => `<div class="chip on"><span style="cursor:pointer" title="Kelola rombel" onclick="kelolaRombel('${escArg(r)}')">${esc(r)}</span><span style="cursor:pointer;display:inline-flex" title="Hapus" onclick="setDelItem('rombel','${escArg(r)}')">${ico('x', 13)}</span></div>`).join('') || '<span class="hint">Belum ada rombel.</span>'}
      </div>
      <div style="display:flex;gap:8px">
        <input id="set-add-rombel" class="input" placeholder="cth: 7C" style="flex:1"/>
        <button class="btn btn-sage" onclick="setAddItem('rombel')">${ico('plus',16)}</button>
      </div>
    </div>
    <div class="card">
      <div class="section-title">${ico('book',15)} Daftar Mata Pelajaran</div>
      <div class="hint" style="margin-bottom:8px">Perubahan langsung tersimpan otomatis.</div>
      <div class="kbc-wrap" style="margin-bottom:10px">
        ${aSetState.mapel.map(m => `<div class="chip on">${esc(m)}<span style="cursor:pointer;display:inline-flex" title="Hapus" onclick="setDelItem('mapel','${escArg(m)}')">${ico('x', 13)}</span></div>`).join('') || '<span class="hint">Belum ada mapel.</span>'}
      </div>
      <div style="display:flex;gap:8px">
        <input id="set-add-mapel" class="input" placeholder="Nama mapel baru" style="flex:1"/>
        <button class="btn btn-sage" onclick="setAddItem('mapel')">${ico('plus',16)}</button>
      </div>
    </div>
    <button class="btn btn-sage" style="width:100%;padding:13px;margin-bottom:12px" onclick="simpanSekolah()">${ico('save',14)} Simpan Identitas Sekolah</button>
    <div class="card">
      <div class="section-title">${ico('key',15)} Akun Admin</div>
      <div class="input-wrap"><label>Username Admin</label><input id="adm-user" class="input" placeholder="admin"/></div>
      <div class="input-wrap"><label>Password Baru</label><input id="adm-pw" class="input" type="password"/><button class="eye" onclick="togglePw('adm-pw',this)">${ico('eye',16)}</button></div>
      <div class="input-wrap"><label>Ulangi Password Baru</label><input id="adm-pw2" class="input" type="password"/><button class="eye" onclick="togglePw('adm-pw2',this)">${ico('eye',16)}</button></div>
      <button class="btn btn-teal" style="width:100%" onclick="simpanAdmin()">Simpan Akun Admin</button>
    </div>`;
  getAdminDoc().then(adm => { document.getElementById('adm-user').value = adm?.username || 'admin'; }).catch(() => {});
}

// Ringkasan kelas gabungan untuk ditampilkan di Setelan, mis. "7A+7B · 8A+8B".
function daftarKelasTeks() {
  return kelasDariRombel(aSetState?.rombel || rombelList(), true)
    .map(k => k.label).join(' · ');
}

// Penggabungan hanya mengubah cara pengisian; dokumen lama tidak ikut berubah,
// jadi mengaktif/menonaktifkannya aman kapan saja.
async function setGabungRombel(on) {
  showLoading('Menyimpan...');
  try {
    await saveSekolahDoc({ gabungRombel: !!on });
    showToast(on
      ? 'Pengisian digabung per tingkat. Laporan tetap dipisah per rombel.'
      : 'Pengisian kembali per rombel.');
  } catch (e) {
    console.error(e);
    showToast('Gagal menyimpan perubahan. Periksa koneksi.', false);
  }
  hideLoading();
  renderASet();
}

// Placeholder KKTP tiap mapel mengikuti angka default yang sedang diketik,
// agar admin melihat batas yang benar-benar berlaku bagi mapel kosong.
function setKktpPlaceholder(val) {
  const v = num(val);
  const teks = v === null ? '' : String(Math.min(100, Math.max(0, Math.round(v))));
  document.querySelectorAll('#page-a-set .kktp-mapel').forEach(el => { el.placeholder = teks; });
}

async function setAddItem(kind) {
  const inp = document.getElementById('set-add-' + kind);
  let v = inp.value.trim();
  if (kind === 'rombel') v = v.toUpperCase();
  if (!v) return;
  if (aSetState[kind].includes(v)) { showToast('Sudah ada di daftar.', false); return; }
  const list = [...aSetState[kind], v];
  if (kind === 'rombel') list.sort(cmpRombel);
  await persistDaftar(kind, list, `${kind === 'rombel' ? 'Rombel' : 'Mapel'} "${v}" ditambahkan.`);
  document.getElementById('set-add-' + kind).focus();
}

function setDelItem(kind, v) {
  const list = aSetState[kind].filter(x => x !== v);
  const doDelete = () =>
    persistDaftar(kind, list, `${kind === 'rombel' ? 'Rombel' : 'Mapel'} "${v}" dihapus.`);
  if (kind === 'rombel') {
    const n = siswaByRombel(v).length;
    if (n > 0) {
      confirmAction('Hapus Rombel',
        `Masih ada <b>${n} siswa</b> terdaftar di rombel <b>${esc(v)}</b>.<br>` +
        `Rombel akan hilang dari pilihan jurnal, tetapi data siswanya <b>tidak ikut terhapus</b> ` +
        `(masih bisa dilihat lewat filter di menu Siswa). Lanjutkan?`, doDelete);
      return;
    }
  }
  doDelete();
}

// Simpan daftar rombel/mapel langsung ke Firestore, lalu render ulang dari data tersimpan.
async function persistDaftar(kind, list, okMsg) {
  showLoading('Menyimpan...');
  try {
    const patch = { [kind]: list };
    // Buang KKTP milik mapel yang sudah dihapus, agar tidak menumpuk.
    if (kind === 'mapel' && sekolah.kktpMapel) {
      patch.kktpMapel = Object.fromEntries(
        Object.entries(sekolah.kktpMapel).filter(([m]) => list.includes(m)));
    }
    await saveSekolahDoc(patch);
    showToast(okMsg);
  } catch (e) {
    console.error(e);
    showToast('Gagal menyimpan perubahan. Periksa koneksi.', false);
  }
  hideLoading();
  renderASet();
}

async function simpanSekolah() {
  const nama = document.getElementById('set-nama').value.trim();
  const tp = document.getElementById('set-tp').value.trim();
  if (!nama || !tp) { showToast('Nama sekolah & tahun pelajaran wajib diisi.', false); return; }
  const jepit = id => Math.min(100, Math.max(0, num(document.getElementById(id).value) ?? 0));
  const bobot = { formatif: jepit('set-bobot-f'), sumatif: jepit('set-bobot-s'), sas: jepit('set-bobot-sas') };
  if (bobot.formatif + bobot.sumatif + bobot.sas === 0) {
    showToast('Total bobot nilai akhir tidak boleh 0.', false); return;
  }
  // Hanya mapel yang benar-benar diisi yang disimpan; sisanya ikut default.
  const kktpMapel = {};
  document.querySelectorAll('#page-a-set .kktp-mapel').forEach(el => {
    const v = num(el.value);
    if (v !== null) kktpMapel[el.dataset.mapel] = Math.min(100, Math.max(0, Math.round(v)));
  });
  showLoading('Menyimpan...');
  try {
    await saveSekolahDoc({
      nama, tahunPelajaran: tp,
      semester: document.getElementById('set-smt').value,
      kota: document.getElementById('set-kota').value.trim(),
      kepala: document.getElementById('set-kepala').value.trim(),
      nipKepala: document.getElementById('set-nip-kepala').value.trim(),
      kktpMin: jepit('set-kktp'),
      kktpMapel,
      urutSiswa: document.getElementById('set-urut').value,
      bobot,
    });
    document.getElementById('a-header-sub').textContent =
      `${sekolah.nama} · TP ${sekolah.tahunPelajaran} · ${sekolah.semester}`;
    showToast('Pengaturan disimpan.');
  } catch (e) { showToast('Gagal menyimpan.', false); }
  hideLoading();
}

async function simpanAdmin() {
  const username = document.getElementById('adm-user').value.trim().toLowerCase();
  const pw = document.getElementById('adm-pw').value;
  const pw2 = document.getElementById('adm-pw2').value;
  if (!username) { showToast('Username admin wajib diisi.', false); return; }
  if (!pw) { showToast('Isi password baru.', false); return; }
  if (pw.length < 6) { showToast('Password minimal 6 karakter.', false); return; }
  if (pw !== pw2) { showToast('Konfirmasi password tidak cocok.', false); return; }
  showLoading('Menyimpan...');
  try {
    await setDoc(doc(fs, 'jm_config', 'admin'), { username, pwHash: await hashPw(pw) });
    showToast('Akun admin diperbarui.');
    document.getElementById('adm-pw').value = '';
    document.getElementById('adm-pw2').value = '';
  } catch (e) { showToast('Gagal menyimpan.', false); }
  hideLoading();
}

// ═══════════════════ ADMIN: KELOLA ROMBEL ═══════════════════
// Klik nama rombel di Setelan → modal: ganti nama, atur anggota,
// migrasi siswa ke rombel setingkat, atau tarik siswa dari rombel lain.
let mrRombel = null;
let mrSel = new Set();     // anggota terpilih (untuk dipindahkan)
let mrAddSel = new Set();  // calon dari rombel lain (untuk dimasukkan)
let mrAddSrc = '';         // rombel sumber pada bagian "masukkan siswa"

function kelolaRombel(r) {
  mrRombel = r; mrSel = new Set(); mrAddSel = new Set(); mrAddSrc = '';
  renderModalRombel();
  openModal('modal-rombel');
}

function renderModalRombel() {
  const r = mrRombel;
  document.getElementById('mr-title').innerHTML = `${ico('tag', 17)} Kelola Rombel ${esc(r)}`;
  const anggota = siswaByRombel(r);
  const tk = tingkatOf(r);
  const target = rombelList().filter(x => x !== r && tingkatOf(x) === tk);
  const sumberList = rombelListSiswa().filter(x => x !== r);
  const calon = mrAddSrc ? siswaByRombel(mrAddSrc) : [];
  const allChecked = anggota.length > 0 && anggota.every(s => mrSel.has(s.id));
  const rowSiswa = (s, sel, fn) => `
    <label style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid var(--bg2);cursor:pointer;font-size:13px;font-weight:700">
      <input type="checkbox" ${sel.has(s.id) ? 'checked' : ''} onchange="${fn}('${s.id}',this.checked)"/>
      <span style="flex:1">${esc(s.nama)}</span><span class="hint">${esc(s.nisn || '')}</span>
    </label>`;
  document.getElementById('mr-body').innerHTML = `
    <div class="input-wrap"><label>Ganti Nama Rombel</label>
      <div style="display:flex;gap:8px">
        <input id="mr-rename" class="input" value="${esc(r)}" style="flex:1"/>
        <button class="btn btn-teal" onclick="renameRombel()">Simpan</button>
      </div>
      <div class="hint" style="margin-top:5px">Rombel semua siswanya ikut diperbarui. Jurnal lama tetap memakai nama lama.</div>
    </div>
    <div class="section-title" style="margin-top:4px">${ico('users', 15)} Anggota <span class="badge-mini">${anggota.length} siswa</span></div>
    ${anggota.length ? `
      <label class="hint" style="display:flex;align-items:center;gap:8px;margin-bottom:5px;cursor:pointer">
        <input type="checkbox" ${allChecked ? 'checked' : ''} onchange="mrPilihSemua(this.checked)"/> Pilih semua
      </label>
      <div style="max-height:190px;overflow-y:auto;border:1px solid var(--border);border-radius:12px;padding:2px 12px;margin-bottom:10px">
        ${anggota.map(s => rowSiswa(s, mrSel, 'mrToggle')).join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px">
        <select id="mr-target" class="input" style="flex:1;font-size:14px;padding:9px 12px">
          <option value="">— rombel tujuan (setingkat) —</option>
          ${target.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
        </select>
        <button class="btn btn-sage" onclick="migrasiSiswa()">${ico('repeat', 13)} Pindahkan</button>
      </div>`
    : `<div class="empty" style="padding:14px">Belum ada siswa di rombel ini.</div>`}
    <div class="section-title">${ico('plus', 15)} Masukkan Siswa dari Rombel Lain</div>
    <select class="input" style="font-size:14px;padding:9px 12px;margin-bottom:8px" onchange="mrSetSumber(this.value)">
      <option value="">— pilih rombel sumber —</option>
      ${sumberList.map(x => `<option value="${esc(x)}" ${x === mrAddSrc ? 'selected' : ''}>${esc(x)}</option>`).join('')}
    </select>
    ${mrAddSrc ? (calon.length ? `
      <div style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:12px;padding:2px 12px;margin-bottom:10px">
        ${calon.map(s => rowSiswa(s, mrAddSel, 'mrAddToggle')).join('')}
      </div>
      <button class="btn btn-teal" style="width:100%" onclick="masukkanSiswa()">${ico('check', 14)} Masukkan ke ${esc(r)}</button>`
    : `<div class="empty" style="padding:12px">Tidak ada siswa di rombel sumber.</div>`) : ''}`;
}

function mrToggle(id, on) { on ? mrSel.add(id) : mrSel.delete(id); }
function mrAddToggle(id, on) { on ? mrAddSel.add(id) : mrAddSel.delete(id); }
function mrPilihSemua(on) {
  mrSel = on ? new Set(siswaByRombel(mrRombel).map(s => s.id)) : new Set();
  renderModalRombel();
}
function mrSetSumber(v) { mrAddSrc = v; mrAddSel = new Set(); renderModalRombel(); }

async function renameRombel() {
  const lama = mrRombel;
  const baru = document.getElementById('mr-rename').value.trim().toUpperCase();
  if (!baru) { showToast('Nama rombel tidak boleh kosong.', false); return; }
  if (baru === lama) { showToast('Nama tidak berubah.', false); return; }
  if (rombelList().includes(baru)) { showToast(`Rombel ${baru} sudah ada.`, false); return; }
  const n = siswaByRombel(lama).length;
  confirmAction('Ganti Nama Rombel',
    `Rombel <b>${esc(lama)}</b> akan diganti menjadi <b>${esc(baru)}</b>. Rombel pada <b>${n} siswa</b> ikut diperbarui. Lanjutkan?`,
    async () => {
      showLoading('Mengganti nama...');
      try {
        for (const s of siswaByRombel(lama))
          await setDoc(doc(fs, 'jm_siswa', s.id), { nama: s.nama, rombel: baru, nisn: s.nisn || '' });
        const list = rombelList().map(x => x === lama ? baru : x).sort(cmpRombel);
        await saveSekolahDoc({ rombel: list });
        await loadSiswa();
        mrRombel = baru; mrSel = new Set(); mrAddSel = new Set();
        showToast(`Nama rombel diganti menjadi ${baru}.`);
        renderModalRombel(); renderASet();
      } catch (e) { console.error(e); showToast('Gagal mengganti nama.', false); }
      hideLoading();
    });
}

async function pindahkanSiswaIds(ids, target, okMsg) {
  showLoading('Menyimpan...');
  try {
    for (const id of ids) {
      const s = siswaList.find(x => x.id === id); if (!s) continue;
      await setDoc(doc(fs, 'jm_siswa', id), { nama: s.nama, rombel: target, nisn: s.nisn || '' });
    }
    await loadSiswa();
    showToast(okMsg);
  } catch (e) { console.error(e); showToast('Gagal menyimpan perubahan.', false); }
  hideLoading();
  renderModalRombel();
}

async function migrasiSiswa() {
  const target = document.getElementById('mr-target').value;
  if (!target) { showToast('Pilih rombel tujuan.', false); return; }
  if (!mrSel.size) { showToast('Centang dulu siswa yang akan dipindahkan.', false); return; }
  const n = mrSel.size; const ids = [...mrSel]; mrSel = new Set();
  await pindahkanSiswaIds(ids, target, `${n} siswa dipindahkan ke ${target}.`);
}

async function masukkanSiswa() {
  if (!mrAddSel.size) { showToast('Centang dulu siswa yang akan dimasukkan.', false); return; }
  const n = mrAddSel.size; const ids = [...mrAddSel]; mrAddSel = new Set();
  await pindahkanSiswaIds(ids, mrRombel, `${n} siswa dimasukkan ke ${mrRombel}.`);
}

// ═══════════════════ KONFIRMASI GENERIK ═══════════════════
function confirmAction(title, msgHTML, fn) {
  document.getElementById('mc-title').textContent = title;
  document.getElementById('mc-msg').innerHTML = msgHTML;
  document.getElementById('mc-ok').onclick = () => { closeModal('modal-confirm'); fn(); };
  openModal('modal-confirm');
}

// ═══════════════════ INIT ═══════════════════
async function init() {
  initIcons();
  // Enter → login
  document.getElementById('l-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  try {
    const sess = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (sess) {
      if (sess.role === 'admin') {
        currentUser = { role: 'admin' };
        await enterApp(); hideLoading(); return;
      }
      if (sess.role === 'guru' && sess.id) {
        const d = await getDoc(doc(fs, 'jm_guru', sess.id));
        if (d.exists()) {
          currentUser = { role: 'guru', id: sess.id, ...d.data() };
          await enterApp(); hideLoading(); return;
        }
        localStorage.removeItem(SESSION_KEY);
      }
    }
  } catch (e) { console.error(e); }
  showScreen('login');
  hideLoading();
}

// Service worker (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}

// Ekspos fungsi untuk atribut onclick di HTML.
Object.assign(window, {
  setLoginRole, doLogin, doLogout, togglePw, gNav, aNav,
  renderAbsenList, setAbsen, setSemuaAbsen, toggleKbc, simpanJurnal, resetJurnalForm,
  editJurnal, hapusJurnal, lihatJurnal, gRiwayatBulan, simpanProfilGuru,
  openModalGuru, toggleMgMapel, simpanGuru, resetPwGuru, hapusGuru,
  exportDataGuru, exportDataSiswa,
  aSiswaFilter, openModalSiswa, simpanSiswa, hapusSiswa, hapusSiswaRombel,
  openModalUpload, downloadTemplateSiswa, prosesUploadSiswa,
  aJurnalTgl, aJurnalGuru, exportJurnalBulan,
  exportPdfRiwayat, exportPdfJurnalGuru,
  openModalFormulir, mfToggleRombel, unduhFormulirPDF,
  rekapSet, exportRekap,
  aRekapTab, bukaDetailNilai, tutupDetailNilai, exportRekapNilai,
  nilaiFilter, bukaNilai, setNilaiInput, normalNilai, tutupNilaiInput,
  simpanNilaiKolom, hapusNilai, salinKolom, exportNilai,
  setAddItem, setDelItem, simpanSekolah, simpanAdmin, setKktpPlaceholder, setGabungRombel,
  kelolaRombel, renameRombel, migrasiSiswa, masukkanSiswa,
  mrToggle, mrAddToggle, mrPilihSemua, mrSetSumber,
  closeModal, openModal,
});

init();
