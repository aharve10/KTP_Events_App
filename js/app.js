/* ==========================================================================
   App shell: setup gate → auth → router. Views are plain modules exporting
   render() (returns HTML) and optionally mount(root, rerender).
   ========================================================================== */

import {
  isConfigured, auth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile, sendPasswordResetEmail,
  friendlyError,
} from "./firebase.js";
import { ALLOWED_EMAIL_DOMAINS } from "./config.js";
import { $, $$, esc, initials, toast, debounce } from "./util.js";
import * as store from "./store.js";
import { initModal, bindCardActions, closeModal } from "./components.js";
import { officerHandlers } from "./officer.js";

import * as HomeView     from "./views/home.js";
import * as ProfileView  from "./views/profile.js";
import * as PastView     from "./views/past.js";
import * as CalendarView from "./views/calendar.js";
import * as AdminView    from "./views/admin.js";

const ROUTES = {
  home:     { title: "Home",            view: HomeView },
  calendar: { title: "Calendar",        view: CalendarView },
  past:     { title: "Previous Events", view: PastView },
  profile:  { title: "Profile",         view: ProfileView },
  admin:    { title: "Manage",          view: AdminView },
};

const currentRoute = () => {
  const key = (location.hash.replace(/^#\/?/, "").split("/")[0] || "home");
  return ROUTES[key] ? key : "home";
};

/* ------------------------------- Setup gate ------------------------------- */

function showSetupGate() {
  $("#boot").hidden = true;
  const gate = $("#setup-gate");
  gate.hidden = false;
  gate.innerHTML = `
    <div class="gate-card">
      <h1>One step left</h1>
      <p class="page-sub" style="margin-bottom:18px">
        The app is built and ready — it just needs your Firebase project so RSVPs are shared
        across everyone instead of living in one browser.
      </p>
      <ol>
        <li>Create a free project at <a href="https://console.firebase.google.com" target="_blank" rel="noopener">console.firebase.google.com</a> (no card needed).</li>
        <li><strong>Build → Authentication → Get started</strong>, enable <strong>Email/Password</strong>.</li>
        <li><strong>Build → Firestore Database → Create database</strong>, production mode.</li>
        <li><strong>Project settings → Your apps → Web (&lt;/&gt;)</strong> and copy the <code>firebaseConfig</code> values.</li>
        <li>Paste them into <code>js/config.js</code>.</li>
        <li>Copy <code>firestore.rules</code> into <strong>Firestore → Rules → Publish</strong>.</li>
        <li>Open <a href="tools/passcode.html">tools/passcode.html</a>, hash your officer passcode, and save it
            to Firestore as <code>config/officer</code> → field <code>codeHash</code>.</li>
      </ol>
      <p class="page-sub" style="margin-top:16px">
        Full walkthrough, including deploying the shareable link, is in <code>README.md</code>.
      </p>
    </div>`;
}

/* --------------------------------- Auth --------------------------------- */

let authMode = "signin";

function initAuth() {
  const screen = $("#auth-screen");
  const form = $("#auth-form");
  const err = $("#auth-err");

  const setMode = (mode) => {
    authMode = mode;
    $$(".seg-btn", screen).forEach((b) => b.classList.toggle("is-active", b.dataset.mode === mode));
    $("#f-name").hidden = mode !== "signup";
    $("#f-grad").hidden = mode !== "signup";
    $("[name=displayName]", form).required = mode === "signup";
    $("[name=password]", form).autocomplete = mode === "signup" ? "new-password" : "current-password";
    $("#auth-submit").textContent = mode === "signup" ? "Create account" : "Sign in";
    err.hidden = true;
  };

  $$(".seg-btn", screen).forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  const fail = (msg) => { err.textContent = msg; err.hidden = false; };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const fd = new FormData(form);
    const email = String(fd.get("email") || "").trim().toLowerCase();
    const password = String(fd.get("password") || "");
    const name = String(fd.get("displayName") || "").trim();

    if (authMode === "signup") {
      if (name.length < 2) return fail("Enter your full name — brothers see it on RSVP lists.");
      if (ALLOWED_EMAIL_DOMAINS.length) {
        const ok = ALLOWED_EMAIL_DOMAINS.some((d) => email.endsWith("@" + d));
        if (!ok) return fail(`Use your ${ALLOWED_EMAIL_DOMAINS.map((d) => "@" + d).join(" or ")} email.`);
      }
    }

    const btn = $("#auth-submit");
    btn.disabled = true;
    btn.textContent = authMode === "signup" ? "Creating…" : "Signing in…";
    try {
      if (authMode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
        if (fd.get("gradYear")) sessionStorage.setItem("ktp:gradYear", String(fd.get("gradYear")));
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      // onAuthStateChanged takes it from here.
    } catch (ex) {
      fail(friendlyError(ex));
      btn.disabled = false;
      btn.textContent = authMode === "signup" ? "Create account" : "Sign in";
    }
  });

  $("#auth-reset").addEventListener("click", async () => {
    const email = String(new FormData(form).get("email") || "").trim();
    if (!email) return fail("Type your email above first, then tap this.");
    try {
      await sendPasswordResetEmail(auth, email);
      toast("Password reset email sent — check your inbox.");
    } catch (ex) { fail(friendlyError(ex)); }
  });

  setMode("signin");
}

/* --------------------------------- Shell --------------------------------- */

let navBound = false;

function initShell() {
  if (navBound) return;
  navBound = true;

  const sidebar = $("#sidebar");
  const scrim = $("#scrim");
  const toggle = $("#nav-toggle");

  const setNav = (open) => {
    sidebar.classList.toggle("is-open", open);
    scrim.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => setNav(!sidebar.classList.contains("is-open")));
  scrim.addEventListener("click", () => setNav(false));
  $("#sb-nav").addEventListener("click", (e) => { if (e.target.closest("a")) setNav(false); });

  $("#signout").addEventListener("click", async () => {
    setNav(false);
    try { await signOut(auth); } catch { toast("Couldn't sign out.", "err"); }
  });

  // One delegated listener handles every event-card action, wherever the card
  // is rendered. Bound at document.body rather than #view because the calendar's
  // day modal renders full event cards into #modal-body, which is a sibling of
  // #app — RSVP buttons in there were silently doing nothing.
  bindCardActions(document.body, rerender, {
    ...officerHandlers(rerender),
    jump: (id) => {
      const card = document.querySelector(`[data-event="${CSS.escape(id)}"]`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.animate(
          [{ boxShadow: "0 0 0 3px rgba(34,46,119,.45)" }, { boxShadow: "0 0 0 3px rgba(34,46,119,0)" }],
          { duration: 1400, easing: "ease-out" }
        );
      } else {
        location.hash = "#/calendar";
      }
    },
  });

  window.addEventListener("hashchange", () => { closeModal(); rerender(true); });
}

/* --------------------------------- Render --------------------------------- */

let rendering = false;

function rerender(scrollTop = false) {
  if (rendering || !store.state.ready) return;
  rendering = true;
  try {
    const key = currentRoute();
    const route = ROUTES[key];
    const view = $("#view");

    // Preserve scroll across live-data re-renders; reset on navigation.
    const y = window.scrollY;

    $("#topbar-name").textContent = route.title;
    document.title = `${route.title} · KTP Events`;
    $$(".sb-link").forEach((a) => a.classList.toggle("is-active", a.dataset.route === key));
    $$(".officer-only").forEach((n) => (n.hidden = !store.isOfficer()));

    const p = store.state.profile;
    $("#sb-username").textContent = p?.displayName || store.state.user?.email || "—";
    $("#sb-userrole").textContent = p?.isOfficer ? (p.officerTitle || "Officer") : "Member";
    $("#sb-avatar").textContent = initials(p?.displayName || store.state.user?.email);

    view.innerHTML = route.view.render();
    route.view.mount?.(view, () => rerender());

    if (scrollTop) window.scrollTo(0, 0);
    else window.scrollTo(0, y);
  } catch (e) {
    console.error("render failed", e);
    $("#view").innerHTML = `<div class="empty">Something went wrong drawing this page.
      <br><span class="mono">${esc(e.message || "")}</span></div>`;
  } finally {
    rendering = false;
  }
}

const rerenderSoon = debounce(() => rerender(), 40);

/* ---------------------------------- Boot ---------------------------------- */

function showAuth() {
  $("#boot").hidden = true;
  $("#app").hidden = true;
  $("#auth-screen").hidden = false;
  closeModal();
  const btn = $("#auth-submit");
  btn.disabled = false;
  btn.textContent = authMode === "signup" ? "Create account" : "Sign in";
}

function showApp() {
  $("#boot").hidden = true;
  $("#auth-screen").hidden = true;
  $("#app").hidden = false;
}

async function boot() {
  if (!isConfigured) return showSetupGate();

  initAuth();
  initModal();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      store.teardown();
      showAuth();
      return;
    }

    $("#boot").hidden = false;
    $(".boot-msg").textContent = "Loading chapter data…";

    try {
      await store.start(user);
    } catch (e) {
      console.error("startup failed", e);
      $(".boot-msg").textContent = "Couldn't load. Check Firestore rules.";
      toast(friendlyError(e), "err");
      return;
    }

    // Grad year captured at signup, applied once the profile doc exists.
    const pending = sessionStorage.getItem("ktp:gradYear");
    if (pending && store.state.profile && !store.state.profile.gradYear) {
      sessionStorage.removeItem("ktp:gradYear");
      store.saveProfileBasics({
        displayName: store.state.profile.displayName || user.displayName || "",
        gradYear: pending,
      }).catch(() => {});
    }

    initShell();
    if (!location.hash) location.hash = "#/home";
    showApp();
    rerender(true);
    store.subscribe(rerenderSoon);
  });
}

// Re-evaluate derived statuses periodically so a deadline passing while the
// page is open actually flips the badge without a refresh.
setInterval(() => { if (store.state.ready) rerenderSoon(); }, 60000);

boot();
