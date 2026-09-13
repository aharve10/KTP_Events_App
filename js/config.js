/* ==========================================================================
   Chapter + Firebase configuration.
   ==========================================================================
   The Firebase client config below is safe to expose — it identifies the
   project to the browser SDK, not authenticates anything. Real access control
   lives in firestore.rules.
   ========================================================================== */

export const firebaseConfig = {
  apiKey:            "AIzaSyA5B36fM9hnFUPh6Lzo6Wzd6ZLCzD9M2Ss",
  authDomain:        "ktp-project-44937.firebaseapp.com",
  projectId:         "ktp-project-44937",
  storageBucket:     "ktp-project-44937.firebasestorage.app",
  messagingSenderId: "840256759183",
  appId:             "1:840256759183:web:75202b14e018c5959517fa",
};

/* --------------------------------------------------------------------------
   Chapter settings
   -------------------------------------------------------------------------- */

export const CHAPTER = {
  name: "Kappa Theta Pi",
  school: "Syracuse University",
  siteUrl: "https://www.ktpcuse.com/",
};

/**
 * Only these email domains may create an account.
 * This is ALSO enforced server-side in firestore.rules — if you change it here,
 * change the matching line there too, or the change has no real effect.
 * Set to an empty array [] to allow any email (also remove the rules check).
 */
export const ALLOWED_EMAIL_DOMAINS = ["syr.edu", "g.syr.edu"];

/* --------------------------------------------------------------------------
   Home hero band
   --------------------------------------------------------------------------

   Photos that rotate across the top of Home. One is picked at random per page
   load — it does not auto-advance, so it never moves while someone is reading.

   Drop the image files in assets/photos/ and list them here. Files you commit
   under assets/photos/ are permanent; Google Photos and Drive links tend to
   break within months, so avoid those.

   Landscape crops work best — the band is 3:1 and the image is centre-cropped.
   Leave the array empty to turn the band off entirely. If a file is missing or
   fails to load, the band removes itself rather than showing a broken image.
*/
export const HERO_IMAGES = [
  { src: "assets/photos/beak-n-skiff.jpg", alt: "Chapter at Beak & Skiff apple orchard" },
  { src: "assets/photos/Pie_a_pi.jpg",     alt: "Pie a Pi philanthropy event on the Hendricks steps" },
  { src: "assets/photos/ski-trip.jpg",     alt: "Brothers at the top of the ski hill" },
];

/**
 * Officer titles offered on the Profile page. Cosmetic only — the title you
 * pick is a label, not a permission. Officer access is the shared passcode,
 * so adding a title here doesn't grant anyone anything on its own.
 *
 * Every filled position on the Fall 2026 org chart. Ordered chairs → directors
 * → exec, alphabetical inside each tier, because this renders as one <select>
 * and a dozen options are easier to scan grouped than in chart order.
 *
 * Dropping a title from this list is safe: it only controls what the dropdown
 * offers when someone first claims officer access. A title already saved on a
 * profile is stored text and keeps displaying either way — so the removed
 * positions (Public Relations, NME, Tech Educator, Web Developer, Treasurer,
 * Secretary, Historian, Scholarship) won't blank out anyone's existing badge.
 * There's also an "Other" option appended in views/profile.js for anything
 * that gets created mid-year before it lands here.
 */
export const OFFICER_TITLES = [
  "Alumni Relations Chair",
  "Brotherhood Chair",
  "Community Service Chair",
  "DEI Chair",
  "Philanthropy Chair",
  "Sunshine Chair",
  "Director of Engagement",
  "Director of Membership",
  "Director of Professional Development",
  "Director of Technology",
  "Vice President",
  "President",
];

/* --------------------------------------------------------------------------
   Event lifecycle defaults (officers can override per event)
   -------------------------------------------------------------------------- */

export const DEFAULTS = {
  /** "Going" RSVPs needed for an event to be considered on. */
  threshold: 8,
  /** Decision deadline = event start minus this many days. */
  decisionLeadDays: 2,
  /** How far ahead recurring series pre-generate instances. */
  seriesHorizonDays: 35,
  /** An event counts as "newly added" for this many days. */
  newForDays: 3,
  /** "Upcoming" banner window. */
  upcomingWindowDays: 14,
};

export const CATEGORIES = [
  { id: "athletics",    label: "SU Athletics" },
  { id: "social",       label: "Social" },
  { id: "brotherhood",  label: "Brotherhood" },
  { id: "philanthropy", label: "Philanthropy" },
  { id: "professional", label: "Professional" },
  { id: "rush",         label: "Rush" },
  { id: "other",        label: "Other" },
];

/* --------------------------------------------------------------------------
   Profile specifications
   `key` values are what officer aggregate counts are grouped by — don't rename
   them after people have set them, or existing profiles lose their grouping.
   -------------------------------------------------------------------------- */

export const SPEC_PRESETS = [
  { key: "no_alcohol", label: "Doesn't drink",        hint: "Counted for bars, tailgates, anything alcohol-centric." },
  { key: "under_21",   label: "Under 21",             hint: "Flags venues that are 21+." },
  { key: "vegetarian", label: "Vegetarian",           hint: "Food orders and catering." },
  { key: "vegan",      label: "Vegan",                hint: "Food orders and catering." },
  { key: "halal",      label: "Halal",                hint: "Food orders and catering." },
  { key: "kosher",     label: "Kosher",               hint: "Food orders and catering." },
  { key: "gluten_free",label: "Gluten-free",          hint: "Food orders and catering." },
  { key: "allergy",    label: "Food allergy",         hint: "Add the specific allergy in the note field." },
  { key: "needs_ride", label: "Needs a ride",         hint: "Anything off campus." },
  { key: "has_car",    label: "Can drive others",     hint: "Helps plan carpools." },
  { key: "budget",     label: "Prefers low-cost events", hint: "Ticketed or paid events." },
];
