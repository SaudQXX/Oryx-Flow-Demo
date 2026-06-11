// ═══════════════════════════════════════════════════════════
//   ORYX FLOW — Core App Logic v21 (OXID Auth, Fixed)
// ═══════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  doc, setDoc, getDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, getDocs,
  serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ─── FIREBASE ────────────────────────────────────────────
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

// ─── CONSTANTS ───────────────────────────────────────────
const WORKER_URL   = 'https://oryx-folw.saud-qattan.workers.dev';
const HORIZON_API  = 'https://oryx-horizon.vercel.app/api/verify';
const ADMIN_OXIDS  = ['OX-JJC6WC'];
const ADMIN_EMAILS = ['saudqattan00@gmail.com'];

// ─── ADMIN CHECK ─────────────────────────────────────────
function _isAdmin(user) {
  if (!user) return false;
  return ADMIN_EMAILS.includes(user.email) || ADMIN_OXIDS.includes(user.oxid);
}
window._isAdmin = _isAdmin;

// ─── GLOBAL STATE ────────────────────────────────────────
window.OryxApp = { currentUser: null, userData: null, db };

// ─── i18n ────────────────────────────────────────────────
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
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 300); }, duration);
}
window.showToast = showToast;

// ─── OVERLAY ─────────────────────────────────────────────
function _dismissOverlay() {
  const ov = document.getElementById('loading-overlay');
  if (!ov) return;
  ov.classList.add('hidden');
  setTimeout(() => { if (ov.parentNode) ov.remove(); }, 500);
}

// ─── NAV ─────────────────────────────────────────────────
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

// ─── COIN UI ─────────────────────────────────────────────
function updateCoinUI(amount) {
  document.querySelectorAll('.js-coins').forEach(el => el.textContent = amount);
  document.querySelectorAll('.js-coin-bar').forEach(el => {
    el.style.width = `${Math.min((amount / 1000) * 100, 100)}%`;
  });
}

// ─── TROPHY UI ───────────────────────────────────────────
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
window.updateTrophyUI = updateTrophyUI;

// ─── OXID VERIFY ─────────────────────────────────────────
async function verifyOXID(oxid) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000); // 8s timeout
  try {
    const res = await fetch(`${HORIZON_API}?oxid=${encodeURIComponent(oxid)}`, {
      signal: controller.signal
    });
    clearTimeout(tid);
    if (!res.ok) return { valid: false };
    return await res.json();
  } catch (e) {
    clearTimeout(tid);
    // Network error or timeout — don't invalidate session
    return { valid: true, networkError: true };
  }
}

// ─── LOGIN ───────────────────────────────────────────────
window.loginWithOXID = async function(oxid) {
  const trimmed = (oxid || '').trim();
  if (!trimmed) throw new Error('أدخل OXID الخاص بك');
  const result = await verifyOXID(trimmed);
  if (!result.valid) throw new Error('OXID غير صحيح أو غير مفعّل');
  localStorage.setItem('oryx_oxid', trimmed);
  localStorage.setItem('oryx_user', JSON.stringify(result.user || {}));
  window.OryxApp.currentUser = { ...(result.user || {}), oxid: trimmed };
  await _loadOrCreateUserData(trimmed, result.user || {});
  showNavLoggedIn();
  return result.user;
};

// ─── LOGOUT ──────────────────────────────────────────────
window.logout = function() {
  localStorage.removeItem('oryx_oxid');
  localStorage.removeItem('oryx_user');
  window.OryxApp.currentUser = null;
  window.OryxApp.userData    = null;
  window.location.href = 'index.html';
};

// ─── USER DATA ───────────────────────────────────────────
async function _loadOrCreateUserData(oxid, horizonUser) {
  const docId = 'oxid_' + oxid.replace(/[^a-zA-Z0-9_-]/g, '_');
  window.OryxApp._userDocId = docId;
  try {
    const snap = await getDoc(doc(db, 'users', docId));
    if (snap.exists()) {
      const data = snap.data();
      if (data.coins == null) data.coins = 0;
      if (!data.maxCoins)     data.maxCoins = 1000;
      if (!data.trophies)     data.trophies = { bronze:false, silver:false, gold:false, apex:false };
      if (!data.badges)       data.badges   = [];
      window.OryxApp.userData = data;
      updateCoinUI(data.coins || 0);
      updateTrophyUI();
    } else {
      const newData = {
        oxid,
        username:    horizonUser?.name  || oxid,
        displayName: horizonUser?.name  || oxid,
        email:       horizonUser?.email || '',
        coins: 50, maxCoins: 1000,
        badges: [], hasPriority: false,
        trophies: { bronze:false, silver:false, gold:false, apex:false },
        createdAt: serverTimestamp(), lastLogin: serverTimestamp(),
        loginStreak: 1, firstDownloadRewarded: false,
        gamesUploaded: 0, canEditName: false,
      };
      await setDoc(doc(db, 'users', docId), newData);
      window.OryxApp.userData = { ...newData, createdAt: new Date(), lastLogin: new Date() };
      updateCoinUI(50);
      showToast('🎁 مرحباً! حصلت على 50 كوين كهدية ترحيبية', 'coin');
    }
  } catch (e) {
    console.error('[userData] Firestore error:', e.message);
    // Fallback in-memory — page still works
    window.OryxApp.userData = {
      oxid,
      username: horizonUser?.name || oxid, displayName: horizonUser?.name || oxid,
      email: horizonUser?.email || '',
      coins: 0, maxCoins: 1000,
      trophies: { bronze:false, silver:false, gold:false, apex:false },
      badges: [], gamesUploaded: 0,
    };
    updateCoinUI(0);
  }
}

// ─── BOOT ────────────────────────────────────────────────
// FIX: Set currentUser synchronously from localStorage FIRST,
//      then do async Firestore load. This eliminates the freeze
//      where pages wait for `currentUser !== undefined`.
(function _bootSync() {
  const oxid = localStorage.getItem('oryx_oxid');
  if (oxid) {
    let storedUser = {};
    try { storedUser = JSON.parse(localStorage.getItem('oryx_user') || '{}'); } catch (_) {}
    // Set immediately — pages can read this right away
    window.OryxApp.currentUser = { ...storedUser, oxid };
    showNavLoggedIn();
  } else {
    window.OryxApp.currentUser = null;
    showNavLoggedOut();
  }
})();

// Async part: load Firestore data + background verify
(async function _bootAsync() {
  const overlayTimer = setTimeout(_dismissOverlay, 6000);
  const page = window.location.pathname.split('/').pop() || 'index.html';

  try {
    const oxid = localStorage.getItem('oryx_oxid');

    if (oxid) {
      let storedUser = {};
      try { storedUser = JSON.parse(localStorage.getItem('oryx_user') || '{}'); } catch (_) {}

      // Load Firestore user data (needed for coins, trophies, etc.)
      await _loadOrCreateUserData(oxid, storedUser);
      showNavLoggedIn();

      // Dispatch ready event — profile.html listens for this
      window.dispatchEvent(new CustomEvent('oryxUserReady', { detail: window.OryxApp.userData }));

      // Background verify — only logs out if truly invalid (not network errors)
      verifyOXID(oxid).then(result => {
        if (!result.valid && !result.networkError) {
          console.warn('[boot] OXID invalid — logging out');
          localStorage.removeItem('oryx_oxid');
          localStorage.removeItem('oryx_user');
          window.OryxApp.currentUser = null;
          window.OryxApp.userData    = null;
          showNavLoggedOut();
          if (page === 'profile.html') window.location.href = 'login.html';
        } else if (result.user && !result.networkError) {
          localStorage.setItem('oryx_user', JSON.stringify(result.user));
          window.OryxApp.currentUser = { ...result.user, oxid };
        }
      }).catch(() => {}); // silent — network errors don't log out

    } else {
      // Not logged in
      if (page === 'profile.html') window.location.href = 'login.html';
      // Dispatch ready even when not logged in — so pages stop waiting
      window.dispatchEvent(new CustomEvent('oryxUserReady', { detail: null }));
    }

  } catch (e) {
    console.error('[boot] Error:', e);
    window.dispatchEvent(new CustomEvent('oryxUserReady', { detail: null }));
  } finally {
    clearTimeout(overlayTimer);
    _dismissOverlay();
  }
})();

// ─── COINS ───────────────────────────────────────────────
async function addCoins(amount) {
  const { userData, _userDocId } = window.OryxApp;
  if (!userData || !_userDocId) return false;
  const cur  = userData.coins  || 0;
  const max  = userData.maxCoins || 1000;
  if (cur >= max) return false;
  const next   = Math.min(cur + amount, max);
  const gained = next - cur;
  try {
    await updateDoc(doc(db, 'users', _userDocId), { coins: next });
    userData.coins = next;
    updateCoinUI(next);
    showToast(t('toast_coins', { amount: gained }) || `+${gained} كوينز 🪙`, 'coin');
    return true;
  } catch (e) { return false; }
}
window.addCoins = addCoins;

// ─── TROPHIES ────────────────────────────────────────────
const TROPHY_COINS = { bronze:20, silver:40, gold:70, apex:150 };

async function unlockTrophy(type) {
  const { currentUser, userData, _userDocId } = window.OryxApp;
  if (!currentUser || !userData || !_userDocId) return false;
  if (userData.trophies?.[type]) { showToast(t('trophy_already') || 'فتحت هذا الكأس من قبل!', 'error'); return false; }
  try {
    const upd = {}; upd[`trophies.${type}`] = true;
    await updateDoc(doc(db, 'users', _userDocId), upd);
    if (!userData.trophies) userData.trophies = {};
    userData.trophies[type] = true;
    await addCoins(TROPHY_COINS[type]);
    const all = ['bronze','silver','gold','apex'].every(tp => userData.trophies[tp]);
    if (all) { await addCoins(100); showToast(t('all_trophies_bonus') || '🏆 جمعت كل الكؤوس! +100 كوين!', 'trophy'); }
    if (type === 'apex') {
      await updateDoc(doc(db, 'users', _userDocId), { hasPriority: true });
      userData.hasPriority = true;
    }
    updateTrophyUI();
    showToast(`🏆 فتحت كأس ${type.toUpperCase()}! +${TROPHY_COINS[type]} كوين`, 'trophy');
    return true;
  } catch (e) { return false; }
}
window.unlockTrophy = unlockTrophy;

// ─── PROFILE UPDATE ──────────────────────────────────────
window.updateUserProfile = async function(updates) {
  const { _userDocId, userData } = window.OryxApp;
  if (!_userDocId) return;
  delete updates.username;
  await updateDoc(doc(db, 'users', _userDocId), updates);
  Object.assign(userData, updates);
};

// ─── DELETE ACCOUNT ──────────────────────────────────────
window.deleteAccount = async function() {
  const { currentUser, _userDocId } = window.OryxApp;
  if (!currentUser) throw new Error('غير مسجل الدخول');
  try {
    const q    = query(collection(db, 'games'), where('developerId', '==', currentUser.oxid));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const g = d.data();
      if (g.workerFileName) await _workerDelete(g.workerFileName).catch(() => {});
      if (g.thumbFileName)  await _workerDelete(g.thumbFileName).catch(() => {});
      await deleteDoc(doc(db, 'games', d.id)).catch(() => {});
    }
  } catch (e) { console.warn('[deleteAccount]:', e.message); }
  if (_userDocId) await deleteDoc(doc(db, 'users', _userDocId)).catch(() => {});
  localStorage.removeItem('oryx_oxid');
  localStorage.removeItem('oryx_user');
  window.OryxApp.currentUser = null;
  window.OryxApp.userData    = null;
  window.location.href = 'index.html';
};

// ─── WORKER UPLOAD ───────────────────────────────────────
async function _workerUpload(fileName, base64Content, progressCb, fromPercent, toPercent) {
  let fakeProgress = fromPercent;
  const step   = (toPercent - fromPercent) / 10;
  const ticker = setInterval(() => {
    fakeProgress = Math.min(fakeProgress + step, toPercent - 2);
    progressCb && progressCb(Math.round(fakeProgress));
  }, 600);
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 60_000);
  let res, data;
  try {
    res = await fetch(`${WORKER_URL}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ fileName, fileContent: base64Content }),
      signal: controller.signal
    });
    data = await res.json().catch(() => ({}));
  } catch (fetchErr) {
    if (fetchErr.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالـ Worker (60 ثانية)');
    throw new Error(`تعذّر الوصول للـ Worker: ${fetchErr.message}`);
  } finally {
    clearTimeout(timeoutId);
    clearInterval(ticker);
  }
  if (!res.ok || !data.ok) throw new Error(`فشل رفع الملف: ${data?.error || `HTTP ${res?.status}`}`);
  if (!data.url) throw new Error('Worker لم يُعد رابط الملف');
  progressCb && progressCb(toPercent);
  return data;
}

async function _workerDelete(fileName) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15_000);
  try {
    const res  = await fetch(`${WORKER_URL}/delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName }), signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.ok;
  } catch (e) { return false; }
  finally { clearTimeout(tid); }
}

// ─── UPLOAD GAME ─────────────────────────────────────────
window.uploadGame = async function(formData, progressCb) {
  const { currentUser, userData } = window.OryxApp;
  if (!currentUser) throw new Error('يجب تسجيل الدخول أولاً');
  const isAdmin = _isAdmin(currentUser);

  if (!formData.gameFile)            throw new Error('اختر ملف اللعبة');
  if (!formData.thumbnail)           throw new Error('اختر صورة الغلاف');
  if (!formData.title?.trim())       throw new Error('أدخل اسم اللعبة');
  if (!formData.description?.trim()) throw new Error('أدخل وصف اللعبة');
  if (!formData.gameFile.name.toLowerCase().endsWith('.zip'))
    throw new Error('يجب أن يكون ملف اللعبة بصيغة ZIP');
  if (!isAdmin && formData.gameFile.size > 25 * 1024 * 1024)
    throw new Error(`حجم الملف ${(formData.gameFile.size/1024/1024).toFixed(1)}MB — الحد الأقصى 25MB`);

  const devId = currentUser.oxid;
  if (!isAdmin) {
    const snap = await getDocs(query(collection(db,'games'), where('developerId','==',devId)));
    if (snap.size >= 3) throw new Error('وصلت للحد الأقصى — 3 ألعاب');
  }

  const dupSnap = await getDocs(query(collection(db,'games'),
    where('developerId','==',devId), where('title','==',formData.title.trim())));
  if (!dupSnap.empty) throw new Error('لديك لعبة بنفس الاسم — اختر اسماً مختلفاً');

  progressCb && progressCb(5);
  const ts            = Date.now();
  const safeName      = formData.gameFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const gameFileName  = `${devId}_${ts}_${safeName}`;
  const thumbExt      = (formData.thumbnail.name.split('.').pop() || 'jpg').toLowerCase();
  const thumbFileName = `thumb_${devId}_${ts}.${thumbExt}`;

  progressCb && progressCb(10);
  const zipB64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result.split(',')[1]);
    r.onerror = () => rej(new Error('فشل قراءة ملف اللعبة'));
    r.readAsDataURL(formData.gameFile);
  });
  progressCb && progressCb(15);

  let gameFileURL;
  try {
    const result = await _workerUpload(gameFileName, zipB64, progressCb, 15, 65);
    gameFileURL  = result.url;
  } catch (e) { throw new Error('فشل رفع اللعبة — ' + e.message); }

  let thumbnailURL = '';
  try {
    const thumbB64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = e => res(e.target.result.split(',')[1]);
      r.onerror = () => rej(new Error('فشل قراءة الصورة'));
      r.readAsDataURL(formData.thumbnail);
    });
    const thumbResult = await _workerUpload(thumbFileName, thumbB64, progressCb, 65, 85);
    thumbnailURL = thumbResult.url;
  } catch (e) { console.warn('[uploadGame] Thumbnail skipped:', e.message); }

  progressCb && progressCb(87);
  const gameDoc = {
    title: formData.title.trim(), description: formData.description.trim(),
    genre: formData.genre || '', platform: formData.platform || 'pc',
    videoURL: formData.videoURL || '',
    developerId: devId,
    developerName:    userData?.username    || 'Unknown',
    developerDisplay: userData?.displayName || '',
    gameFileURL, thumbnailURL,
    workerFileName: gameFileName, thumbFileName,
    createdAt: serverTimestamp(), downloads: 0,
    trophiesAvailable: { bronze:true, silver:true, gold:true, apex:true }
  };

  let docRef;
  try {
    docRef = await addDoc(collection(db, 'games'), gameDoc);
  } catch (e) { throw new Error(`خطأ Firestore: ${e.message}`); }

  try {
    await updateDoc(doc(db, 'users', window.OryxApp._userDocId), {
      gamesUploaded: (userData?.gamesUploaded || 0) + 1
    });
    if (userData) userData.gamesUploaded = (userData?.gamesUploaded || 0) + 1;
  } catch (_) {}

  progressCb && progressCb(100);
  return { id: docRef.id, ...gameDoc };
};

// ─── DELETE GAME ─────────────────────────────────────────
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
    await updateDoc(doc(db,'users',window.OryxApp._userDocId),{gamesUploaded:n}).catch(()=>{});
    ud.gamesUploaded = n;
  }
};

// ─── LOAD GAMES ──────────────────────────────────────────
window.loadAllGames = async function() {
  try {
    const snap = await getDocs(collection(db, 'games'));
    const games = [];
    snap.forEach(d => games.push({ id: d.id, ...d.data() }));
    return games.sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
  } catch (e) { console.error('[loadAllGames]', e.message); return []; }
};

window.loadUserGames = async function(devId) {
  try {
    const snap = await getDocs(query(collection(db,'games'), where('developerId','==',devId)));
    const games = [];
    snap.forEach(d => games.push({ id: d.id, ...d.data() }));
    return games.sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
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
  try { await updateDoc(doc(db,'games',gameId), { downloads: increment(1) }); } catch (_) {}
  if (currentUser && userData && !userData.firstDownloadRewarded && _userDocId) {
    try {
      await addCoins(30);
      await updateDoc(doc(db,'users',_userDocId), { firstDownloadRewarded: true });
      userData.firstDownloadRewarded = true;
    } catch (_) {}
  }
};

// ─── MISC ────────────────────────────────────────────────
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
