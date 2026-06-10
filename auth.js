// ═══════════════════════════════════════════════════════
//   ORYX FLOW — نظام OXID Authentication
//   يستبدل Firebase Auth بالكامل
//   يعتمد على: https://oryx-horizon.vercel.app/api/verify
// ═══════════════════════════════════════════════════════

const OXID_KEY        = 'oryx_oxid';
const USER_KEY        = 'oryx_user';
const HORIZON_API     = 'https://oryx-horizon.vercel.app/api/verify';
const LOGIN_PAGE      = 'login.html';
const PROFILE_PAGE    = 'profile.html';

// ── بيانات المستخدم الحالي في الذاكرة ──
window.OryxAuth = {
  user: null,        // { name, email, oxid }
  ready: false,      // هل انتهى التحقق؟
};

// ── الدالة الرئيسية: تحقق من OXID المحفوظ ──
async function initOxidAuth() {
  const oxid = localStorage.getItem(OXID_KEY);

  if (!oxid) {
    // ما في OXID — المستخدم غير مسجّل
    window.OryxAuth.user  = null;
    window.OryxAuth.ready = true;
    _updateNavUI(false);
    return null;
  }

  try {
    const res  = await fetch(`${HORIZON_API}?oxid=${encodeURIComponent(oxid)}`);
    const data = await res.json();

    if (data.valid && data.user) {
      window.OryxAuth.user  = data.user;
      window.OryxAuth.ready = true;
      _updateNavUI(true, data.user);
      return data.user;
    } else {
      // OXID منتهي الصلاحية أو غير صحيح — امسحه
      localStorage.removeItem(OXID_KEY);
      localStorage.removeItem(USER_KEY);
      window.OryxAuth.user  = null;
      window.OryxAuth.ready = true;
      _updateNavUI(false);
      return null;
    }
  } catch (_) {
    // خطأ في الشبكة — نعتبره غير مسجل مؤقتاً
    window.OryxAuth.ready = true;
    _updateNavUI(false);
    return null;
  }
}

// ── تسجيل الدخول بـ OXID ──
async function loginWithOxid(oxid) {
  if (!oxid || !oxid.trim()) throw new Error('OXID_EMPTY');

  const res  = await fetch(`${HORIZON_API}?oxid=${encodeURIComponent(oxid.trim())}`);
  const data = await res.json();

  if (!data.valid) throw new Error('OXID_INVALID');

  // حفظ في localStorage
  localStorage.setItem(OXID_KEY, oxid.trim());
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));

  window.OryxAuth.user  = data.user;
  window.OryxAuth.ready = true;
  _updateNavUI(true, data.user);

  return data.user;
}

// ── تسجيل الخروج ──
function logoutOxid() {
  localStorage.removeItem(OXID_KEY);
  localStorage.removeItem(USER_KEY);
  window.OryxAuth.user  = null;
  _updateNavUI(false);
  window.location.href = LOGIN_PAGE;
}

// ── تحديث الـ Navbar حسب حالة الدخول ──
function _updateNavUI(isLoggedIn, user) {
  document.querySelectorAll('.nav-logged-in').forEach(el => {
    el.classList.toggle('hidden', !isLoggedIn);
  });
  document.querySelectorAll('.nav-logged-out').forEach(el => {
    el.classList.toggle('hidden', isLoggedIn);
  });

  if (isLoggedIn && user) {
    // اسم المستخدم في الـ navbar إذا موجود
    document.querySelectorAll('.js-user-name').forEach(el => {
      el.textContent = user.name || user.oxid;
    });
    // عرض OXID مختصر
    document.querySelectorAll('.js-oxid-short').forEach(el => {
      el.textContent = user.oxid.substring(0, 8) + '...';
    });
  }
}

// ── توافق مع الكود القديم (app.js) ──
// بعض الصفحات تتحقق من window.OryxApp.currentUser
window.OryxApp = window.OryxApp || {};
Object.defineProperty(window.OryxApp, 'currentUser', {
  get() { return window.OryxAuth.user; },
  configurable: true
});
Object.defineProperty(window.OryxApp, 'userData', {
  get() { return window.OryxAuth.user; },
  configurable: true
});

// ── تعريض الدوال عالمياً ──
window.loginWithOxid  = loginWithOxid;
window.logoutOxid     = logoutOxid;
window.logout         = logoutOxid;   // توافق مع الكود القديم
window.initOxidAuth   = initOxidAuth;

// ── تشغيل التحقق تلقائياً عند تحميل الصفحة ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOxidAuth);
} else {
  initOxidAuth();
}
