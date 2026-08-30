# KTP Events

RSVP app for **Kappa Theta Pi, Syracuse University** — brotherhood and social events,
with name-attached RSVPs so social proof does the work, and an archive that tells next
year's chair what actually pulled people.

Built as a plain static site: no build step, no `npm install`, no Node required.
Everything shared (accounts, RSVPs, profiles) lives in Firebase.

---

## What's in here

```
index.html            the whole app shell
assets/styles.css     design tokens + all styling
assets/photos/        chapter photos — hero band and per-event images (see the README in there)
js/
  config.js           ← the only file you must edit
  firebase.js         SDK bootstrap (pinned to 11.10.0)
  util.js             dates, formatting, DOM helpers
  lifecycle.js        the termination system + recurrence maths (pure functions)
  store.js            all Firestore reads/writes; the in-memory mirror views render from
  components.js       event card, roster, modal
  officer.js          officer-only forms and overrides
  seed.js             starter data
  views/              home, calendar, past, profile, admin
firestore.rules       paste into the Firebase console — this is the real enforcement
tools/passcode.html   generates the SHA-256 hash of your officer passcode
```

---

## Setup — about 15 minutes, once

### 1. Create the Firebase project

1. <https://console.firebase.google.com> → **Add project**. Name it anything (`ktp-events`).
   Google Analytics is optional — say no, it's simpler.
   The free **Spark** plan covers this comfortably; no credit card.
2. **Build → Authentication → Get started → Email/Password → Enable → Save.**
   Leave "Email link (passwordless)" off — the free tier throttles outbound email hard,
   which would break sign-in for a 40-person chapter.
3. **Build → Firestore Database → Create database.** Pick a location near you
   (`nam5 (us-central)` is fine) and choose **Production mode**.

### 2. Wire the app to it

4. **⚙ Project settings → Your apps → Web (`</>`)**. Register the app (nickname `ktp-events`,
   skip Firebase Hosting for now). Firebase shows a `firebaseConfig` block.
5. Open **`js/config.js`** and paste those six values over the `PASTE_…` placeholders.

Until you do this, the app shows a setup checklist instead of the sign-in screen —
that's expected, not an error.

### 3. Lock it down

6. **Firestore Database → Rules**, replace everything with the contents of
   **`firestore.rules`**, then **Publish**.

   This is what actually enforces the permissions. Without it, Firestore in production
   mode denies everything and the app won't load.

### 4. Set the officer passcode

7. Open **`tools/passcode.html`** (see *Running it locally* below), type the passcode you'll
   share with the other three officers, and copy the hash.
8. In Firestore → **Start collection**:
   - Collection ID: `config`
   - Document ID: `officer` ← type it, don't use auto-ID
   - Field `codeHash`, type **string**, value = the hash

   The passcode itself is never stored anywhere and never sent over the network — only its
   hash, compared server-side against a document no client can read.

### 5. Deploy

See below. Then, back in Firebase: **Authentication → Settings → Authorized domains → Add
domain** and add your live domain. Sign-in fails without this.

### 6. First run

Sign up with your own `@syr.edu` email → **Profile → Officer access** → enter the passcode →
**Manage → Load starter data**.

---

## Deploying the shareable link

You have no Node installed, so these are all drag-and-drop / web-UI routes.

**Fastest — Netlify Drop.** Go to <https://app.netlify.com/drop> and drag the whole
`KTP_Events_App` folder onto the page. You get a URL immediately. Create a free account when
prompted so the site sticks around and you can rename it to something like
`ktp-events.netlify.app`. To update later, drag the folder again.

**Most durable — GitHub Pages.** Create a repo at <https://github.com/new>, use
**uploading an existing file** to drag the folder contents in, then
**Settings → Pages → Source: Deploy from a branch → `main` / `root`**. You get
`https://<you>.github.io/<repo>/`. Free forever, and next year's chair can be added as a
collaborator instead of inheriting a personal account.

**If you ever install Node**, `npm i -g firebase-tools && firebase deploy` gives you
Firebase Hosting on the same project — one less service to hand off.

Whichever you pick, add the domain to Firebase's authorized-domains list (step 5).

> Do not put the folder in a public repo *and* worry about the `firebaseConfig` being
> visible — those keys are meant to be public. The security rules are what protect the data,
> which is why step 3 isn't optional.

---

## Running it locally

The app uses ES modules, which browsers refuse to load over `file://`. Serve it:

```bash
python -m http.server 5173
```

Then open <http://localhost:5173>. `localhost` counts as a secure origin, so the passcode
hashing tool works there too: <http://localhost:5173/tools/passcode.html>.

---

## How the pieces work

### RSVPs

Three states: **Going**, **Still deciding**, and no response. All name-attached — the point is
that people can see who else is in.

"Still deciding" is deliberately public by name. Someone waiting on two specific brothers to
commit can see them sitting in the undecided column and go poke them, which is the whole
mechanism by which an event fills.

### The termination system

Every event carries an **interest threshold** and a **decision deadline** (defaults: 8 people,
2 days before). Status is *derived*, never stored, so nothing gets stuck stale just because
nobody had the app open when a deadline passed:

| Situation | Status |
|---|---|
| Going ≥ threshold | **Confirmed** |
| Under threshold, before deadline | **Collecting** |
| Under threshold, deadline passed, event hasn't started | **At risk** — banner, warning colour, "Needs 3 more people by Friday or this won't happen" |
| Under threshold when the start time arrives | **Cancelled — low interest**, auto-archived |
| Going ≥ threshold when the start time arrives | **Happened** |

Officers override any of it at any time: **Force on** (happens regardless of count),
**Cancel** (kills it now, with a reason shown to everyone), **Extend deadline**, or set an
explicit outcome on something already in the past.

### Recurring events

A **series** is a template. It keeps 35 days of instances generated ahead, each with its own
fresh RSVP list. Instance IDs are deterministic (`s-<seriesId>-<date>`), so:

- two people opening the app at once can't create duplicate weeks;
- editing one week's instance never gets clobbered by the template — generation only ever
  *creates* docs that don't exist;
- pausing or ending a series stops new instances without touching the ones already out there.

Generation runs in members' browsers, not on a server (Cloud Functions need a paid plan).
The security rules allow a member's browser to create a series instance *only* if every field
matches the template exactly and it starts with an empty RSVP list.

### Profile specifications & privacy

Each spec is **private by default**. Flip it to **Shown** and it renders as a badge next to
your name everywhere you appear on an RSVP list — "Andrew `Under 21`".

Regardless of that setting, officers see **aggregate counts** for anyone Going or Still
deciding — "3 don't drink · 2 under 21" — so a bar crawl gets planned around real constraints.
Names are never attached to a spec its owner kept private. Enforced in `firestore.rules`:
`userSpecs/{uid}` is readable by its owner and by officers, and the public profile only ever
carries the specs their owner marked *Shown*.

### Officers

Seven titles — brotherhood chair, philanthropy chair, new member educator chair, director of
engagement, director of membership, VP, president — listed in `js/config.js` → `OFFICER_TITLES`.
The title is only a label: access is gated by one shared
passcode entered on the Profile page. It's per-account: entering it once flags *your* account,
and you can step down from the same page.

**Rotating it** (do this at the end of your term): generate a new hash in
`tools/passcode.html`, overwrite `config/officer.codeHash`, then delete the documents in the
`officerClaims` collection to force everyone to re-enter it.

### Archive

Past events land in **Previous Events** automatically. Each keeps its final RSVP list and
outcome. Officers can additionally record **who actually showed up** — a separate field from
who RSVP'd, including walk-ons who never responded — so cards read "18 RSVP'd, 12 attended".

Filter by type, outcome, date range or keyword and the summary strip recomputes for that
slice: how many happened, how many died on low interest, average RSVP, average turnout, show
rate, and the best draw. That's the "bowling pulls 15+, weekday trivia never breaks 8"
question, answered without re-running a survey.

---

## Things you'll probably want to change

| What | Where |
|---|---|
| Photos in the Home hero band | `js/config.js` → `HERO_IMAGES`. Put the files in `assets/photos/` and list them; one is picked at random per page load. Empty array turns the band off. A missing or broken file removes the band rather than showing a broken image, so a typo fails quietly — check the browser console if it vanishes unexpectedly. |
| Per-event photos | No config needed — officers paste a URL into the event form. Relative paths like `assets/photos/bowling.jpg` are permanent; external links must be `https://`. Google Photos and Drive links usually rot within months. |
| Default threshold / deadline lead time | `js/config.js` → `DEFAULTS` |
| Which email domains can sign up | `js/config.js` → `ALLOWED_EMAIL_DOMAINS` **and** the `isMember()` regex in `firestore.rules` — both, or the change isn't real |
| Event categories | `js/config.js` → `CATEGORIES` |
| The list of profile specs | `js/config.js` → `SPEC_PRESETS` (don't rename existing `key` values — that orphans people's saved settings) |
| Seed events and their dates | `js/seed.js` |
| Colours and type | `assets/styles.css` → the `:root` block at the top |

### About the seed data

`Manage → Load starter data` adds weekly **Men's Soccer** and **Football at the Dome** series,
a **Syracuse Mets Dollar Thursday**, and three **open brotherhood social slots** — with dates
computed relative to whenever you press the button, not hardcoded.

**These are placeholders.** They don't reflect the real SU athletics schedule or your rush
calendar. Edit the times and locations, or delete what doesn't apply. Pressing the button
twice is safe — it skips anything whose title already exists.

---

## Design notes

Palette and type were sampled from the live chapter site at <https://www.ktpcuse.com>:

| Token | Value | Site usage |
|---|---|---|
| `--ink` | `#11334B` | body text |
| `--navy` | `#081359` | nav, headings |
| `--blue` | `#222E77` | links, accents |
| `--muted` | `#52697A` | secondary text |
| `--bg` | `#FFFFFF` | base |

Worth knowing: **there is no Syracuse orange on the chapter site.** It's navy on white.
The only warm colour in this app is a muted rust (`--risk`, `#A8451A`) used strictly to flag
at-risk events, where it's carrying information rather than decoration.

The site sets type in `futura-pt` and `hypatia-sans-pro`, both Adobe Typekit and locked to
the ktpcuse.com domain, so they can't be reused here. **Jost** (Google Fonts) is a
geometric Futura substitute and is a close match. Nav treatment copies the site: uppercase,
700 weight, `0.2em` tracking, flat `0px`-radius buttons.

---

## Reliability notes

- **Nothing is per-device.** Accounts are real Firebase Auth accounts; RSVPs and profiles are
  in Firestore. Clearing your browser doesn't lose anything.
- **RSVP counts can't drift.** Setting an RSVP runs as a Firestore transaction that updates the
  RSVP document and the event's tally together, so two phones tapping at once can't double-count.
- **Live updates.** RSVPs stream in over snapshot listeners — you see someone commit without
  refreshing. Derived statuses also re-evaluate every 60 seconds, so a deadline passing while
  the page is open flips the badge on its own.
- **Free tier headroom.** A ~50-person chapter with a few events a week is far inside Spark
  limits (50k document reads/day). The app keeps live listeners only on upcoming events and
  lazy-loads archived RSVP lists on demand.
