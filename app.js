// ═══════════════════════════════════════════════════════════
//   ORYX FLOW — Core App Logic v20 (OXID Auth)
//   Auth: Oryx Horizon OXID verification (no Firebase Auth)
//   Storage: Firestore (games only) + Cloudflare Worker
// ═══════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  doc, setDoc, getDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, getDocs,
  serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ─── FIREBASE (Firestore only — no Auth) ─────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyDg-bOQ-2KC_5pVTcDNR3dpYP5iSfPySZs",
  authDomain:        "oryx-flow-demo.firebaseapp.com",
  projectId:         "oryx-flow-demo",
  storageBucket:     "oryx-flow-demo.firebasestorage.app",
  messagingSenderId: "1089268230839",
  appId:             "1:1089268230839:web:6c15c362126532044f3b32"
};
const fbApp = initializeApp(firebaseConfig);
const db    = getFirestore(fbApp);

// ─── CLOUDFLARE WORKER ───────────────────────────────────
const WORKER_URL = 'https://oryx-folw.saud-qattan.workers.dev';

// ─── HORIZON API ─────────────────────────────────────────
const HORIZON_API = 'https://oryx-horizon.vercel.app/api/verify';

// ─── GLOBAL STATE ────────────────────────────────────────
// currentUser = { oxid, name, email } | null
window.OryxApp = { currentUser: null, userData: null, db };

// ─── i18n HELPER ─────────────────────────────────────────
const t = (k, v = {}) => window.i18n ? window.i18n.t(k, v) : k;

// ─── TOAST ───────────────────────────────────────────────
function showToast(msg, type = 'default', duration = 3500) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const icons = { default: '⚡', success: '✅', error: '❌', coin: '🪙', trophy: '🏆' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <span class="toast-icon">${icons[type] || '⚡'}</span>
    <span class="toast-msg">${msg}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;
  c.appendChild(el);
  setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 300); }, duration);
}
window.showToast = showToast;

// ─── OVERLAY HELPER ──────────────────────────────────────
function _dismissOverlay() {
  const ov = document.getElementById('loading-overlay');
  if (ov) { ov.classList.add('hidden'); setTimeout(() => ov.remove(), 500); }
}

// ─── OXID AUTH ───────────────────────────────────────────

// Verify OXID with Horizon API
async function verifyOXID(oxid) {
  const res = await fetch(`${HORIZON_API}?oxid=${encodeURIComponent(oxid)}`);
  if (!res.ok) throw new Error('تعذّر الوصول لنظام التحقق');
  return await res.json(); // { valid, user? }
}

// Login with OXID
window.loginWithOXID = async function(oxid) {
  const trimmed = (oxid || '').trim();
  if (!trimmed) throw new Error('أدخل OXID الخاص بك');

  const result = await verifyOXID(trimmed);
  if (!result.valid) throw new Error('OXID غير صحيح أو غير مفعّل');

  // Save to localStorage
  localStorage.setItem('oryx_oxid', trimmed);
  localStorage.setItem('oryx_user', JSON.stringify(result.user));

  window.OryxApp.currentUser = { ...result.user, oxid: trimmed };
  await _loadOrCreateUserData(trimmed, result.user);
  showNavLoggedIn();
  return result.user;
};

// Logout
window.logout = function() {
  localStorage.removeItem('oryx_oxid');
  localStorage.removeItem('oryx_user');
  window.OryxApp.currentUser = null;
  window.OryxApp.userData    = null;
  window.location.href = 'index.html';
};

// Get stored OXID
function _getStoredOXID() {
  return localStorage.getItem('oryx_oxid') || null;
}

// ─── USER DATA (Firestore keyed by OXID) ─────────────────
async function _loadOrCreateUserData(oxid, horizonUser) {
  const docId = 'oxid_' + oxid.replace(/[^a-zA-Z0-9_-]/g, '_');
  try {
    const snap = await getDoc(doc(db, 'users', docId));
    if (snap.exists()) {
      const data = snap.data();
      if (!data.coins && data.coins !== 0) data.coins = 0;
      if (!data.maxCoins) data.maxCoins = 1000;
      if (!data.trophies) data.trophies = { bronze: false, silver: false, gold: false, apex: false };
      if (!data.badges)   data.badges   = [];
      window.OryxApp.userData = data;
      // Store docId for updates
      window.OryxApp._userDocId = docId;
      updateCoinUI(data.coins || 0);
      updateTrophyUI();
    } else {
      // First time — create doc
      const newData = {
        oxid,
        username:    horizonUser?.name || oxid,
        displayName: horizonUser?.name || oxid,
        email:       horizonUser?.email || '',
        coins: 50, maxCoins: 1000,
        badges: [], hasPriority: false,
        trophies: { bronze: false, silver: false, gold: false, apex: false },
        createdAt:             serverTimestamp(),
        lastLogin:             serverTimestamp(),
        loginStreak:           1,
        firstDownloadRewarded: false,
        gamesUploaded:         0,
        canEditName:           false,
      };
      await setDoc(doc(db, 'users', docId), newData);
      window.OryxApp.userData    = { ...newData, createdAt: new Date(), lastLogin: new Date() };
      window.OryxApp._userDocId  = docId;
      updateCoinUI(50);
      showToast('🎁 مرحباً! حصلت على 50 كوين كهدية ترحيبية', 'coin');
    }
  } catch (e) {
    console.error('[_loadOrCreateUserData] Firestore error:', e.message);
    // Fallback — safe in-memory only
    window.OryxApp.userData = {
      oxid, username: horizonUser?.name || oxid,
      displayName: horizonUser?.name || oxid,
      email: horizonUser?.email || '',
      coins: 0, maxCoins: 1000,
      trophies: { bronze: false, silver: false, gold: false, apex: false },
      badges: [], gamesUploaded: 0,
    };
    window.OryxApp._userDocId = docId;
    updateCoinUI(0);
  }
}

// ─── BOOT: check localStorage on every page load ─────────
(async function _boot() {
  const _overlayTimeout = setTimeout(_dismissOverlay, 8000);
  const page = window.location.pathname.split('/').pop();

  try {
    const oxid = _getStoredOXID();

    if (oxid) {
      // ── STEP 1: Trust localStorage immediately so profile.html loads fast ──
      const storedUser = JSON.parse(localStorage.getItem('oryx_user') || '{}');
      window.OryxApp.currentUser = { ...storedUser, oxid };
      await _loadOrCreateUserData(oxid, storedUser);
      showNavLoggedIn();
      window.dispatchEvent(new CustomEvent('oryxUserReady', { detail: window.OryxApp.userData }));
      console.log('[boot] ✅ Loaded from localStorage — user:', oxid);

      // ── STEP 2: Verify in background (don't block page load) ──
      verifyOXID(oxid).then(result => {
        if (!result.valid) {
          // OXID expired — clear and redirect only if on protected page
          console.warn('[boot] OXID no longer valid — logging out');
          localStorage.removeItem('oryx_oxid');
          localStorage.removeItem('oryx_user');
          window.OryxApp.currentUser = null;
          window.OryxApp.userData    = null;
          if (page === 'profile.html') window.location.href = 'login.html';
        } else if (result.user) {
          // Refresh stored user with latest Horizon data
          localStorage.setItem('oryx_user', JSON.stringify(result.user));
          window.OryxApp.currentUser = { ...result.user, oxid };
        }
      }).catch(e => console.warn('[boot] Background verify failed (network?):', e.message));

    } else {
      // No OXID stored — logged out
      window.OryxApp.currentUser = null;
      showNavLoggedOut();
      if (page === 'profile.html') window.location.href = 'login.html';
    }

  } catch (e) {
    console.error('[boot] Error:', e);
    window.OryxApp.currentUser = null;
    showNavLoggedOut();
  } finally {
    clearTimeout(_overlayTimeout);
    _dismissOverlay();
    console.log('[boot] overlay dismissed');
  }
})();

// ─── COIN SYSTEM ─────────────────────────────────────────
async function addCoins(amount) {
  const { userData, _userDocId } = window.OryxApp;
  if (!userData || !_userDocId) return false;
  const cur = userData.coins || 0;
  const max = userData.maxCoins || 1000;
  if (cur >= max) return false;
  const next   = Math.min(cur + amount, max);
  const gained = next - cur;
  try {
    await updateDoc(doc(db, 'users', _userDocId), { coins: next });
    userData.coins = next;
    updateCoinUI(next);
    showToast(t('toast_coins', { amount: gained }), 'coin');
    return true;
  } catch (e) { return false; }
}
window.addCoins = addCoins;

function updateCoinUI(amount) {
  document.querySelectorAll('.js-coins').forEach(el => { el.textContent = amount; });
  document.querySelectorAll('.js-coin-bar').forEach(el => {
    el.style.width = `${Math.min((amount / 1000) * 100, 100)}%`;
  });
}

// ─── TROPHY SYSTEM ───────────────────────────────────────
const TROPHY_COINS = { bronze: 20, silver: 40, gold: 70, apex: 150 };

async function unlockTrophy(type) {
  const { currentUser, userData, _userDocId } = window.OryxApp;
  if (!currentUser || !userData || !_userDocId) return false;
  if (userData.trophies?.[type]) { showToast(t('trophy_already'), 'error'); return false; }
  try {
    const upd = {}; upd[`trophies.${type}`] = true;
    await updateDoc(doc(db, 'users', _userDocId), upd);
    if (!userData.trophies) userData.trophies = {};
    userData.trophies[type] = true;
    await addCoins(TROPHY_COINS[type]);
    const all = ['bronze','silver','gold','apex'].every(tp => userData.trophies[tp]);
    if (all) { await addCoins(100); showToast(t('all_trophies_bonus'), 'trophy'); }
    if (type === 'apex') {
      await updateDoc(doc(db, 'users', _userDocId), { hasPriority: true });
      userData.hasPriority = true;
    }
    updateTrophyUI();
    showToast(t('trophy_unlocked', { type: type.toUpperCase(), coins: TROPHY_COINS[type] }), 'trophy');
    return true;
  } catch (e) { return false; }
}
window.unlockTrophy = unlockTrophy;

function updateTrophyUI() {
  const { userData } = window.OryxApp;
  if (!userData) return;
  ['bronze','silver','gold','apex'].forEach(type => {
    document.querySelectorAll(`[data-trophy="${type}"]`).forEach(el => {
      el.classList.toggle('locked',    !userData.trophies?.[type]);
      el.classList.toggle('unlocked', !!userData.trophies?.[type]);
    });
  });
}

// ─── NAV HELPERS ─────────────────────────────────────────
function showNavLoggedIn() {
  document.querySelectorAll('.nav-logged-out').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-logged-in').forEach(el => el.classList.remove('hidden'));
  const ud = window.OryxApp.userData;
  if (ud) updateCoinUI(ud.coins || 0);
}
function showNavLoggedOut() {
  document.querySelectorAll('.nav-logged-out').forEach(el => el.classList.remove('hidden'));
  document.querySelectorAll('.nav-logged-in').forEach(el => el.classList.add('hidden'));
}

// ─── UPDATE USER PROFILE ─────────────────────────────────
window.updateUserProfile = async function(updates) {
  const { _userDocId, userData } = window.OryxApp;
  if (!_userDocId) return;
  delete updates.username; // username = oxid-linked, not editable
  await updateDoc(doc(db, 'users', _userDocId), updates);
  Object.assign(userData, updates);
};

// ─── DELETE ACCOUNT ──────────────────────────────────────
window.deleteAccount = async function() {
  const { currentUser, _userDocId } = window.OryxApp;
  if (!currentUser) throw new Error('غير مسجل الدخول');
  const uid = currentUser.oxid;

  // Delete all user games
  try {
    const q    = query(collection(db, 'games'), where('developerId', '==', uid));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const g = d.data();
      if (g.workerFileName) await _workerDelete(g.workerFileName).catch(() => {});
      if (g.thumbFileName)  await _workerDelete(g.thumbFileName).catch(() => {});
      await deleteDoc(doc(db, 'games', d.id)).catch(() => {});
    }
  } catch (e) { console.warn('[deleteAccount] games:', e.message); }

  // Delete user doc
  if (_userDocId) {
    try { await deleteDoc(doc(db, 'users', _userDocId)); } catch (_) {}
  }

  localStorage.removeItem('oryx_oxid');
  localStorage.removeItem('oryx_user');
  window.OryxApp.currentUser = null;
  window.OryxApp.userData    = null;
  window.location.href = 'index.html';
};

// ═══════════════════════════════════════════════════════════
//   GAME SYSTEM
// ═══════════════════════════════════════════════════════════

async function _workerUpload(fileName, base64Content, progressCb, fromPercent, toPercent) {
  console.log(`[_workerUpload] Uploading "${fileName}" via Worker...`);
  let fakeProgress = fromPercent;
  const step = (toPercent - fromPercent) / 10;
  const ticker = setInterval(() => {
    fakeProgress = Math.min(fakeProgress + step, toPercent - 2);
    progressCb && progressCb(Math.round(fakeProgress));
  }, 600);
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => { controller.abort(); }, 60_000);
  let res, data;
  try {
    res = await fetch(`${WORKER_URL}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fileName, fileContent: base64Content }),
      signal:  controller.signal
    });
    data = await res.json().catch(() => ({}));
  } catch (fetchErr) {
    if (fetchErr.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالـ Worker (60 ثانية)');
    throw new Error(`تعذّر الوصول للـ Worker: ${fetchErr.message}`);
  } finally {
    clearTimeout(timeoutId);
    clearInterval(ticker);
  }
  if (!res.ok || !data.ok) {
    const reason = data?.error || data?.message || `HTTP ${res?.status}`;
    throw new Error(`فشل رفع الملف عبر Worker: ${reason}`);
  }
  if (!data.url) throw new Error('Worker لم يُعد رابط الملف');
  progressCb && progressCb(toPercent);
  return data;
}

async function _workerDelete(fileName) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 15_000);
  try {
    const res  = await fetch(`${WORKER_URL}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fileName }),
      signal:  controller.signal
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.ok;
  } catch (e) {
    console.warn('[_workerDelete] Non-fatal error:', e.message);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

const ADMIN_OXIDS  = ['OX-JJC6WC'];
const ADMIN_EMAILS = ['saudqattan00@gmail.com'];
function _isAdmin(user) {
  if (!user) return false;
  return ADMIN_EMAILS.includes(user.email) || ADMIN_OXIDS.includes(user.oxid);
}
window._isAdmin = _isAdmin;

window.uploadGame = async function(formData, progressCb) {
  const { currentUser, userData } = window.OryxApp;
  if (!currentUser) throw new Error('يجب تسجيل الدخول أولاً');

  const isAdmin = _isAdmin(currentUser);

  if (!formData.gameFile)            throw new Error('اختر ملف اللعبة');
  if (!formData.thumbnail)           throw new Error('اختر صورة الغلاف');
  if (!formData.title?.trim())       throw new Error('أدخل اسم اللعبة');
  if (!formData.description?.trim()) throw new Error('أدخل وصف اللعبة');
  if (!formData.gameFile.name.toLowerCase().endsWith('.zip')) throw new Error('يجب أن يكون ملف اللعبة بصيغة ZIP');
  if (!isAdmin && formData.gameFile.size > 25 * 1024 * 1024)
    throw new Error(`حجم الملف ${(formData.gameFile.size/1024/1024).toFixed(1)}MB — الحد الأقصى 25MB`);

  const devId = currentUser.oxid;

  if (!isAdmin) {
    const _lq    = query(collection(db, 'games'), where('developerId', '==', devId));
    const _lsnap = await getDocs(_lq);
    if (_lsnap.size >= 3) throw new Error('Upload limit reached (max 3 games)');
  }

  const dupQ = query(collection(db, 'games'), where('developerId', '==', devId), where('title', '==', formData.title.trim()));
  if (!(await getDocs(dupQ)).empty) throw new Error('لديك لعبة بنفس الاسم — اختر اسماً مختلفاً');

  progressCb && progressCb(5);

  const ts            = Date.now();
  const safeName      = formData.gameFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const gameFileName  = `${devId}_${ts}_${safeName}`;
  const thumbExt      = (formData.thumbnail.name.split('.').pop() || 'jpg').toLowerCase();
  const thumbFileName = `thumb_${devId}_${ts}.${thumbExt}`;

  progressCb && progressCb(10);

  const zipB64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = () => reject(new Error('فشل قراءة ملف اللعبة'));
    reader.readAsDataURL(formData.gameFile);
  });
  progressCb && progressCb(15);

  let gameFileURL;
  try {
    const result = await _workerUpload(gameFileName, zipB64, progressCb, 15, 65);
    gameFileURL = result.url;
  } catch (e) { throw new Error('فشل رفع اللعبة — ' + e.message); }

  let thumbnailURL = '';
  try {
    const thumbB64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result.split(',')[1]);
      reader.onerror = () => reject(new Error('فشل قراءة الصورة'));
      reader.readAsDataURL(formData.thumbnail);
    });
    const thumbResult = await _workerUpload(thumbFileName, thumbB64, progressCb, 65, 85);
    thumbnailURL = thumbResult.url;
  } catch (e) { console.warn('[uploadGame] Thumbnail skipped:', e.message); }

  progressCb && progressCb(87);

  const gameDoc = {
    title:            formData.title.trim(),
    description:      formData.description.trim(),
    genre:            formData.genre    || '',
    platform:         formData.platform || 'pc',
    videoURL:         formData.videoURL || '',
    developerId:      devId,
    developerName:    userData?.username    || 'Unknown',
    developerDisplay: userData?.displayName || '',
    gameFileURL,
    thumbnailURL,
    workerFileName:   gameFileName,
    thumbFileName:    thumbFileName,
    createdAt:        serverTimestamp(),
    downloads:        0,
    trophiesAvailable: { bronze: true, silver: true, gold: true, apex: true }
  };

  let docRef;
  try {
    docRef = await addDoc(collection(db, 'games'), gameDoc);
  } catch (fsErr) {
    console.error('[uploadGame] addDoc FAILED:', fsErr.code, fsErr.message);
    throw new Error(`خطأ Firestore [${fsErr.code}]: ${fsErr.message}`);
  }

  try {
    await updateDoc(doc(db, 'users', window.OryxApp._userDocId), {
      gamesUploaded: (userData?.gamesUploaded || 0) + 1
    });
    if (userData) userData.gamesUploaded = (userData?.gamesUploaded || 0) + 1;
  } catch (_) {}

  progressCb && progressCb(100);
  return { id: docRef.id, ...gameDoc };
};

window.deleteGame = async function(gameDocId, gameData) {
  const { currentUser } = window.OryxApp;
  if (!currentUser || gameData.developerId !== currentUser.oxid)
    throw new Error('غير مصرح — لا يمكنك حذف هذه اللعبة');
  if (gameData.workerFileName) await _workerDelete(gameData.workerFileName);
  if (gameData.thumbFileName)  await _workerDelete(gameData.thumbFileName);
  await deleteDoc(doc(db, 'games', gameDocId));
  const ud = window.OryxApp.userData;
  if (ud && window.OryxApp._userDocId) {
    const n = Math.max(0, (ud.gamesUploaded || 1) - 1);
    await updateDoc(doc(db, 'users', window.OryxApp._userDocId), { gamesUploaded: n }).catch(() => {});
    ud.gamesUploaded = n;
  }
};

window.loadAllGames = async function() {
  try {
    const snap  = await getDocs(collection(db, 'games'));
    const games = [];
    snap.forEach(d => games.push({ id: d.id, ...d.data() }));
    return games.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  } catch (e) { console.error('[loadAllGames]', e.message); return []; }
};

window.loadUserGames = async function(devId) {
  try {
    const q    = query(collection(db, 'games'), where('developerId', '==', devId));
    const snap = await getDocs(q);
    const games = [];
    snap.forEach(d => games.push({ id: d.id, ...d.data() }));
    return games.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  } catch (e) { console.error('[loadUserGames]', e.message); return []; }
};

window.loadGame = async function(gameId) {
  try {
    const snap = await getDoc(doc(db, 'games', gameId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (e) { console.error('[loadGame]', e.message); return null; }
};

window.trackDownload = async function(gameId) {
  const { currentUser, userData, _userDocId } = window.OryxApp;
  try { await updateDoc(doc(db, 'games', gameId), { downloads: increment(1) }); } catch (_) {}
  if (currentUser && userData && !userData.firstDownloadRewarded && _userDocId) {
    try {
      await addCoins(30);
      await updateDoc(doc(db, 'users', _userDocId), { firstDownloadRewarded: true });
      userData.firstDownloadRewarded = true;
    } catch (_) {}
  }
};

window.checkCapacity = function() {
  if (Math.random() < 0.1) { window.location.href = 'waiting.html'; return true; }
  return false;
};

window.addEventListener('scroll', () => {
  document.querySelector('.navbar')?.classList.toggle('scrolled', window.scrollY > 50);
});

function escapeHTML(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}
window.escapeHTML = escapeHTML;