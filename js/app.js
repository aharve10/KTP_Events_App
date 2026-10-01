/* ==========================================================================
   App shell: auth → router. Views are plain modules exporting render()
   (returns HTML) and optionally mount(root, rerender).
   ========================================================================== */

import {
  isConfigured, auth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile, sendPasswordResetEmail,
  sendEmailVerification, reload, applyActionCode, checkActionCode,
  verifyPasswordResetCode, confirmPasswordReset, friendlyError,
} from "./firebase.js";
import { ALLOWED_EMAIL_DOMAINS, firebaseConfig } from "./config.js";
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

/* ------------------------------- Unavailable ------------------------------- */
/* Only reachable if the backend config has been cleared or corrupted. Shows a
   generic "temporarily unavailable" message — never any internals. */

function showUnavailable() {
  $("#boot").hidden = true;
  const gate = $("#setup-gate");
  gate.hidden = false;
  gate.innerHTML = `
    <div class="gate-card">
      <h1>KTP Events is temporarily unavailable</h1>
      <p class="page-sub" style="margin-top:14px">
        Try refreshing in a minute. If it stays down, message an officer.
      </p>
    </div>`;
}

/* --------------------------------- Theme --------------------------------- */

const THEME_KEY = "ktp:theme";

/**
 * The inline script in index.html has already put the right value on <html>
 * before first paint. This only handles the interactive half: filling the
 * toggle buttons, flipping the preference, and following the OS for as long as
 * nobody has expressed a preference of their own.
 *
 * Stored values are "light" / "dark" only. Absent means "follow the system",
 * which is why the toggle stores rather than clears — once you've pressed it,
 * your choice outranks the OS.
 */
function initTheme() {
  const root = document.documentElement;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const icons = $("#tpl-theme-icons");
  const buttons = $$("[data-theme-toggle]");

  // localStorage throws outright in Safari private mode, so every touch of it
  // is guarded — someone with site data locked down should still get the app.
  const stored = () => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } };

  const apply = (pref) => {
    const dark = pref === "dark" || (pref !== "light" && mq.matches);
    root.dataset.theme = dark ? "dark" : "light";
    buttons.forEach((b) => {
      b.setAttribute("aria-pressed", String(dark));
      b.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    });
  };

  buttons.forEach((b) => {
    if (icons) b.replaceChildren(icons.content.cloneNode(true));
    b.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, next); } catch { /* just won't persist */ }
      apply(next);
    });
  });

  mq.addEventListener("change", () => { if (!stored()) apply(null); });
  apply(stored());
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
        // Rules refuse unverified accounts, so the verify screen is the next stop.
        try {
          await sendEmailVerification(cred.user);
          sessionStorage.setItem("ktp:verifySent", "1");
          // onAuthStateChanged has usually painted the verify screen already.
          $("#verify-send").textContent = "Resend verification email";
        } catch (ex) {
          // Don't swallow this — otherwise the screen says "Resend" for an email that never went out.
          console.warn("verification email failed", ex);
          sessionStorage.removeItem("ktp:verifySent");
          $("#verify-send").textContent = "Send verification email";
          $("#verify-err").textContent = `Couldn't send the verification email: ${friendlyError(ex)}`;
          $("#verify-err").hidden = false;
        }
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
        // Read the ring off the theme instead of hardcoding navy, which is
        // invisible on the dark palette. Resolved here because the Web
        // Animations API takes computed values, not var() references.
        const ring = getComputedStyle(document.documentElement)
          .getPropertyValue("--focus-ring").trim() || "rgba(34,46,119,.45)";
        card.animate(
          [{ boxShadow: `0 0 0 3px ${ring}` }, { boxShadow: "0 0 0 3px transparent" }],
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
  $("#verify-screen").hidden = true;
  $("#auth-screen").hidden = false;
  closeModal();
  const btn = $("#auth-submit");
  btn.disabled = false;
  btn.textContent = authMode === "signup" ? "Create account" : "Sign in";
}

function showApp() {
  $("#boot").hidden = true;
  $("#auth-screen").hidden = true;
  $("#verify-screen").hidden = true;
  $("#app").hidden = false;
}

/* --------------------------- Email verification --------------------------- */
/* firestore.rules only admit accounts with email_verified, so an unverified
   user never gets as far as store.start() — they'd just hit permission-denied. */

function showVerify(user) {
  $("#boot").hidden = true;
  $("#app").hidden = true;
  $("#auth-screen").hidden = true;
  $("#verify-screen").hidden = false;
  closeModal();
  $("#verify-email").textContent = user.email || "your email";
  $("#verify-err").hidden = true;
  const sent = sessionStorage.getItem("ktp:verifySent");
  $("#verify-send").textContent = sent ? "Resend verification email" : "Send verification email";
  fillMailLinks(user.email || "");
}

/** Firebase sends from noreply@<authDomain> unless a custom sender is set up. */
const SENDER = `noreply@${firebaseConfig.authDomain}`;

/**
 * Point the verify screen at wherever this person's mail actually lives.
 * syr.edu is Microsoft 365, where the filter's quarantine is the usual
 * hiding place; g.syr.edu is Google Workspace.
 */
function fillMailLinks(email) {
  const domain = email.split("@")[1] || "";
  const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  const inbox = $("#verify-inbox");
  const more = $("#verify-more");
  $("#verify-sender").textContent = SENDER;

  if (domain === "g.syr.edu") {
    const search = encodeURIComponent(`from:${SENDER} in:anywhere`);
    inbox.href = `https://mail.google.com/mail/u/0/#search/${search}`;
    inbox.textContent = "Find it in Gmail";
    more.innerHTML = link("https://mail.google.com/mail/u/0/#spam", "Spam folder");
  } else {
    inbox.href = "https://outlook.office.com/mail/inbox";
    inbox.textContent = "Open Outlook";
    more.innerHTML = [
      link("https://outlook.office.com/mail/junkemail", "Junk folder"),
      link("https://security.microsoft.com/quarantine", "Quarantine"),
    ].join('<span class="sep" aria-hidden="true">·</span>');
  }
}

function initVerify() {
  const err = $("#verify-err");
  const fail = (msg) => { err.textContent = msg; err.hidden = false; };

  $("#verify-continue").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const user = auth.currentUser;
    if (!user) return;
    err.hidden = true;
    btn.disabled = true;
    try {
      await reload(user);
      if (!user.emailVerified) {
        return fail("Not verified yet — open the link in the email first. It can take a minute to arrive.");
      }
      // The cached ID token still says email_verified: false, and rules read the token.
      await user.getIdToken(true);
      await enterApp(user);
    } catch (ex) {
      fail(friendlyError(ex));
    } finally {
      btn.disabled = false;
    }
  });

  $("#verify-send").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const user = auth.currentUser;
    if (!user) return;
    err.hidden = true;
    btn.disabled = true;
    try {
      await sendEmailVerification(user);
      sessionStorage.setItem("ktp:verifySent", "1");
      btn.textContent = "Resend verification email";
      toast(`Verification email sent to ${user.email}.`);
    } catch (ex) {
      fail(friendlyError(ex));
    } finally {
      btn.disabled = false;
    }
  });

  $("#verify-signout").addEventListener("click", async () => {
    try { await signOut(auth); } catch { toast("Couldn't sign out.", "err"); }
  });
}

/* ----------------------------- Email link handler ----------------------------- */
/* Firebase's emailed links land here once the console's action URL points at
   this app. A link scanner may load this page, so nothing is applied until
   someone presses the button. */

function readActionLink() {
  const q = new URLSearchParams(location.search);
  const mode = q.get("mode");
  const code = q.get("oobCode");
  return mode && code ? { mode, code } : null;
}

/** Drop the one-time code from the address bar so it isn't bookmarked or shared. */
function clearActionLink() {
  const url = new URL(location.href);
  ["mode", "oobCode", "apiKey", "lang", "continueUrl", "tenantId"].forEach((k) => url.searchParams.delete(k));
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}

function showAction() {
  $("#boot").hidden = true;
  $("#app").hidden = true;
  $("#auth-screen").hidden = true;
  $("#verify-screen").hidden = true;
  $("#action-screen").hidden = false;
}

/** Resolves once the person is done with the link and the normal app can start. */
function handleActionLink({ mode, code }) {
  return new Promise((resolve) => {
    const title = $("#action-title");
    const body = $("#action-body");
    const err = $("#action-err");
    const form = $("#action-form");
    const pwField = $("#action-pw");
    const submit = $("#action-submit");
    const done = $("#action-done");

    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    const finish = (heading, text) => {
      title.textContent = heading;
      body.textContent = text;
      form.hidden = true;
      done.hidden = false;
      done.focus();
    };
    const broken = (ex) => {
      title.textContent = "Link didn't work";
      fail(friendlyError(ex));
      done.hidden = false;
    };
    done.addEventListener("click", () => {
      clearActionLink();
      $("#action-screen").hidden = true;
      resolve();
    });

    showAction();

    if (mode === "verifyEmail") {
      title.textContent = "Confirm your email";
      checkActionCode(auth, code).then((info) => {
        body.textContent = `Press the button to confirm ${info.data.email || "your email"} belongs to you.`;
        submit.textContent = "Confirm my email";
        form.hidden = false;
      }).catch(broken);

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        err.hidden = true;
        submit.disabled = true;
        try {
          await applyActionCode(auth, code);
          // If this browser is the one that signed up, refresh its token so the
          // rules see email_verified straight away.
          if (auth.currentUser) {
            await reload(auth.currentUser);
            await auth.currentUser.getIdToken(true);
          }
          finish("Email confirmed", "You're verified. Continue to see chapter events.");
        } catch (ex) {
          fail(friendlyError(ex));
          submit.disabled = false;
        }
      });
    } else if (mode === "resetPassword") {
      title.textContent = "Choose a new password";
      verifyPasswordResetCode(auth, code).then((email) => {
        body.textContent = `For ${email}.`;
        pwField.hidden = false;
        submit.textContent = "Save new password";
        form.hidden = false;
        $("input", pwField).focus();
      }).catch(broken);

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        err.hidden = true;
        const password = String(new FormData(form).get("password") || "");
        if (password.length < 6) return fail("Password needs to be at least 6 characters.");
        submit.disabled = true;
        try {
          await confirmPasswordReset(auth, code, password);
          finish("Password updated", "Sign in with your new password.");
        } catch (ex) {
          fail(friendlyError(ex));
          submit.disabled = false;
        }
      });
    } else {
      title.textContent = "Link not supported";
      body.textContent = "This app doesn't handle that kind of email link.";
      done.hidden = false;
    }
  });
}

/* ------------------------------ Stale-code check ------------------------------ */
/* GitHub Pages lets browsers reuse files for 10 minutes, so right after a
   deploy a refresh can still run the old code. version.json is fetched past
   every cache; if it's ahead of the version this page was built with, reload
   onto a URL the browser hasn't cached. scripts/stamp.mjs writes both. */

async function ensureFreshCode() {
  const built = document.querySelector('meta[name="app-version"]')?.content;
  if (!built) return;
  try {
    const res = await fetch("version.json", { cache: "no-store" });
    if (!res.ok) return;
    const { version } = await res.json();
    if (!version || version === built) return;
    const url = new URL(location.href);
    if (url.searchParams.get("v") === version) return; // already tried once; don't loop
    url.searchParams.set("v", version); // other params, like an oobCode, ride along
    location.replace(url.toString());
    await new Promise(() => {}); // hold here while the page navigates away
  } catch { /* offline or blocked — run what we have */ }
}

async function enterApp(user) {
  $("#verify-screen").hidden = true;
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
}

async function boot() {
  initTheme();
  await ensureFreshCode();

  if (!isConfigured) return showUnavailable();

  initAuth();
  initVerify();
  initModal();

  const action = readActionLink();
  if (action) await handleActionLink(action);

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      store.teardown();
      showAuth();
      return;
    }
    if (!user.emailVerified) {
      store.teardown();
      showVerify(user);
      return;
    }
    await enterApp(user);
  });
}

// Re-evaluate derived statuses periodically so a deadline passing while the
// page is open actually flips the badge without a refresh.
setInterval(() => { if (store.state.ready) rerenderSoon(); }, 60000);

boot();
