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
//  jm_config/sekolah {nama, tahunPelajaran, semester, rombel[], mapel[]}
//  jm_guru/{id}      {nama, nip, username, pwHash, mapel[]}
//  jm_siswa/{id}     {nama, rombel, nisn}
//  jm_jurnal/{id}    {guruId, guruNama, tanggal, jamKe, rombel, mapel,
//                     materi, tujuan, kegiatan, metode, asesmen,
//                     kbc[], kbcCatatan, refleksi,
//                     absen{siswaId:H|S|I|A}, rekap{H,S,I,A},
//                     createdAt, updatedAt}
// ═══════════════════════════════════════════════════════════════

import {
  fs, doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where
} from "./js/firebase.js";
import {
  MONTHS, TODAY, ADMIN_DEFAULT_PW, GURU_DEFAULT_PW,
  KBC_VALUES, METODE_LIST, ASESMEN_LIST, ABSEN_STATUS, ABSEN_MAP, DEFAULT_SEKOLAH
} from "./js/constants.js";
import { hashPw, uid, dk, esc, fmtTanggal, cmpRombel, cmpNama, hitungRekap } from "./js/utils.js";
import { showLoading, hideLoading, showToast, showScreen, openModal, closeModal, togglePw } from "./js/ui-helpers.js";
import { ico, initIcons } from "./js/icons.js";

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
    showScreen('admin');
    aNav('home');
  } else {
    document.getElementById('g-header-sub').textContent =
      `${currentUser.nama} · TP ${sekolah.tahunPelajaran} ${sekolah.semester}`;
    showScreen('guru');
    initJurnalForm();
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
  return `
  <div class="item" style="cursor:pointer" onclick="lihatJurnal('${j.id}')">
    <div class="avatar">${esc(j.rombel || '?')}</div>
    <div class="grow">
      <div class="t1">${esc(j.mapel)} — ${esc(j.materi)}</div>
      <div class="t2">${showGuru ? esc(j.guruNama) + ' · ' : ''}${esc(fmtTanggal(j.tanggal))}${j.jamKe ? ' · Jam ke-' + esc(j.jamKe) : ''}${kbcBadge}</div>
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
  const rSel = document.getElementById('j-rombel');
  rSel.innerHTML = `<option value="">— pilih rombel —</option>` +
    rombelList().map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
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

function renderAbsenList() {
  const rombel = document.getElementById('j-rombel').value;
  const wrap = document.getElementById('absen-list');
  const counter = document.getElementById('absen-counter');
  if (!rombel) { wrap.innerHTML = `<div class="empty">Pilih rombel terlebih dahulu.</div>`; counter.textContent = ''; absenState = {}; return; }
  const siswa = siswaByRombel(rombel);
  if (!siswa.length) { wrap.innerHTML = `<div class="empty">Belum ada data siswa untuk rombel ${esc(rombel)}.<br>Hubungi admin untuk mengunggah data siswa.</div>`; counter.textContent = ''; absenState = {}; return; }
  // Pertahankan status yang sudah dipilih; siswa baru default Hadir.
  const prev = absenState; absenState = {};
  for (const s of siswa) absenState[s.id] = prev[s.id] || 'H';
  counter.textContent = `${siswa.length} siswa`;
  wrap.innerHTML = siswa.map((s, i) => `
    <div class="absen-row">
      <div style="width:22px;text-align:right;font-size:12px;font-weight:800;color:var(--muted)">${i + 1}</div>
      <div class="absen-nama">${esc(s.nama)}<div class="absen-nisn">NISN ${esc(s.nisn || '-')}</div></div>
      <div class="absen-btns" id="ab-${s.id}">${absenBtnsHTML(s.id)}</div>
    </div>`).join('');
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
  const rombel = document.getElementById('j-rombel').value;
  const mapel = document.getElementById('j-mapel').value;
  const materi = document.getElementById('j-materi').value.trim();
  if (!tanggal || !rombel || !mapel || !materi) { showToast('Tanggal, rombel, mapel, dan materi wajib diisi.', false); return; }
  if (!Object.keys(absenState).length) { showToast('Tidak ada siswa pada rombel ini — absensi kosong.', false); return; }
  const now = Date.now();
  const data = {
    guruId: currentUser.id,
    guruNama: currentUser.nama,
    tanggal, rombel, mapel, materi,
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
  document.getElementById('j-rombel').value = '';
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
    document.getElementById('j-rombel').value = j.rombel;
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
      <div class="section-title">${ico('book',15)} Riwayat Jurnal</div>
      <div class="filter-row">
        <input id="riw-bulan" class="input" type="month" value="${bulan}" onchange="gRiwayatBulan(this.value)"/>
      </div>
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
    const siswa = siswaByRombel(j.rombel);
    const namaSiswa = Object.fromEntries(siswaList.map(s => [s.id, s.nama]));
    const absenRows = Object.entries(j.absen || {})
      .map(([sid, st]) => ({ nama: namaSiswa[sid] || '(siswa terhapus)', st }))
      .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
    const r = j.rekap || hitungRekap(j.absen);
    const row = (l, v) => v ? `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase">${l}</div><div style="font-size:13.5px;font-weight:600;line-height:1.5">${esc(v)}</div></div>` : '';
    const canEdit = currentUser.role === 'guru' && j.guruId === currentUser.id;
    const canDel = canEdit || currentUser.role === 'admin';
    document.getElementById('mj-body').innerHTML = `
      ${row('Guru', j.guruNama)}
      ${row('Tanggal', fmtTanggal(j.tanggal) + (j.jamKe ? ' · Jam ke-' + j.jamKe : ''))}
      ${row('Rombel / Mapel', j.rombel + ' — ' + j.mapel)}
      ${row('Materi', j.materi)}
      ${row('Tujuan Pembelajaran', j.tujuan)}
      ${row('Kegiatan', j.kegiatan)}
      ${row('Metode / Asesmen', [j.metode, j.asesmen].filter(Boolean).join(' · '))}
      <div style="margin-bottom:8px"><div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase">Nilai Cinta (KBC)</div>${kbcHTML}</div>
      ${row('Wujud Penerapan KBC', j.kbcCatatan)}
      ${row('Refleksi / Catatan', j.refleksi)}
      <div style="margin:10px 0 6px;font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase">
        Absensi — H:${r.H} S:${r.S} I:${r.I} A:${r.A} (${Object.keys(j.absen || {}).length} siswa)</div>
      <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:12px;padding:4px 12px">
        ${absenRows.map(a => { const m = ABSEN_MAP[a.st] || {}; return `
          <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bg2);font-size:12.5px;font-weight:600">
            <span>${esc(a.nama)}</span>
            <span class="badge" style="background:${m.bg};color:${m.color}">${m.label || a.st}</span>
          </div>`; }).join('')}
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
    </div>`;
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
        ${filter ? `<button class="btn-ghost" style="color:var(--rose2)" onclick="hapusSiswaRombel('${esc(filter)}')">${ico('trash',13)} Hapus rombel ini</button>` : ''}
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
    </div>`;
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
        <button class="btn-ghost" onclick="exportJurnalBulan()">${ico('download',13)} Ekspor bulan</button>
      </div>
      <div class="filter-row">
        <input class="input" type="date" value="${tgl}" onchange="aJurnalTgl(this.value)"/>
        <select class="input" onchange="aJurnalGuru(this.value)">
          <option value="">Semua guru</option>
          ${guruList.map(g => `<option value="${g.id}" ${g.id === guruF ? 'selected' : ''}>${esc(g.nama)}</option>`).join('')}
        </select>
      </div>
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
    const rows = list.map(j => ({
      Tanggal: j.tanggal, 'Jam ke': j.jamKe || '', Guru: j.guruNama, Rombel: j.rombel,
      Mapel: j.mapel, Materi: j.materi, 'Tujuan Pembelajaran': j.tujuan || '',
      Kegiatan: j.kegiatan || '', Metode: j.metode || '', Asesmen: j.asesmen || '',
      'Nilai KBC': (j.kbc || []).map(kbcLabel).join(', '), 'Penerapan KBC': j.kbcCatatan || '',
      Refleksi: j.refleksi || '',
      Hadir: j.rekap?.H ?? 0, Sakit: j.rekap?.S ?? 0, Izin: j.rekap?.I ?? 0, Alpa: j.rekap?.A ?? 0,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Jurnal ' + ym);
    xlsxDownload(wb, `jurnal_mengajar_${ym}.xlsx`);
  } catch (e) { console.error(e); showToast('Gagal ekspor.', false); }
  hideLoading();
}

// ═══════════════════ REKAP ABSENSI (guru & admin) ═══════════════════
function renderARekap() { renderRekapPage('page-a-rekap', false); }

function renderRekapPage(pageId, guruOnly) {
  const el = document.getElementById(pageId);
  const ym = el.dataset.ym || dk().slice(0, 7);
  const rombel = el.dataset.rombel || '';
  const mapel = el.dataset.mapel || '';
  const mapelOpts = guruOnly && currentUser.mapel?.length ? currentUser.mapel : sekolah.mapel;
  el.innerHTML = `
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
  renderRekapPage(pageId, guruOnly);
}

async function hitungRekapData(pageId, guruOnly) {
  const el = document.getElementById(pageId);
  const ym = el.dataset.ym || dk().slice(0, 7);
  const rombel = el.dataset.rombel;
  const mapel = el.dataset.mapel || '';
  let list = await jurnalByRange(ym + '-01', ym + '-31');
  list = list.filter(j => j.rombel === rombel);
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

// ═══════════════════ ADMIN: PENGATURAN ═══════════════════
function renderASet() {
  // Daftar rombel/mapel selalu dari data tersimpan (perubahan dipersist langsung
  // oleh setAddItem/setDelItem, tidak menunggu tombol Simpan).
  aSetState = { rombel: [...(sekolah.rombel || [])], mapel: [...(sekolah.mapel || [])] };
  // Jangan reset isian identitas yang sedang diedit saat halaman dirender ulang.
  const curNama = document.getElementById('set-nama')?.value;
  const curTp = document.getElementById('set-tp')?.value;
  const curSmt = document.getElementById('set-smt')?.value || sekolah.semester;
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
    </div>
    <div class="card">
      <div class="section-title">${ico('tag',15)} Daftar Rombel</div>
      <div class="hint" style="margin-bottom:8px">Klik nama rombel untuk mengelola: ganti nama, atur anggota, dan migrasi siswa ke rombel setingkat. Perubahan langsung tersimpan otomatis; menghapus rombel tidak menghapus data siswanya.</div>
      <div class="kbc-wrap" style="margin-bottom:10px">
        ${aSetState.rombel.map(r => `<div class="chip on"><span style="cursor:pointer" title="Kelola rombel" onclick="kelolaRombel('${esc(r)}')">${esc(r)}</span><span style="cursor:pointer;display:inline-flex" title="Hapus" onclick="setDelItem('rombel','${esc(r)}')">${ico('x', 13)}</span></div>`).join('') || '<span class="hint">Belum ada rombel.</span>'}
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
        ${aSetState.mapel.map(m => `<div class="chip on">${esc(m)}<span style="cursor:pointer;display:inline-flex" title="Hapus" onclick="setDelItem('mapel','${esc(m)}')">${ico('x', 13)}</span></div>`).join('') || '<span class="hint">Belum ada mapel.</span>'}
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
    await saveSekolahDoc({ [kind]: list });
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
  showLoading('Menyimpan...');
  try {
    await saveSekolahDoc({
      nama, tahunPelajaran: tp,
      semester: document.getElementById('set-smt').value,
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

function tingkatOf(r) { const n = parseInt(r); return isNaN(n) ? null : n; }

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
  aSiswaFilter, openModalSiswa, simpanSiswa, hapusSiswa, hapusSiswaRombel,
  openModalUpload, downloadTemplateSiswa, prosesUploadSiswa,
  aJurnalTgl, aJurnalGuru, exportJurnalBulan,
  rekapSet, exportRekap,
  setAddItem, setDelItem, simpanSekolah, simpanAdmin,
  kelolaRombel, renameRombel, migrasiSiswa, masukkanSiswa,
  mrToggle, mrAddToggle, mrPilihSemua, mrSetSumber,
  closeModal, openModal,
});

init();
