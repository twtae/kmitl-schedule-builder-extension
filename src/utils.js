/**
 * KMITL Schedule Builder — Shared Utilities
 *
 * Constants, helpers and day/time utilities shared across all modules.
 * Loaded first in the content_scripts array so every other module can
 * reference these globals.
 */

/* ───────────── Storage keys ───────────── */

const KSB_STORAGE_KEY = "kmitl_schedule_builder_selected_subjects";
const KSB_CATEGORY_OVERRIDES_KEY = "kmitl_schedule_builder_category_overrides";
const KSB_OFFLINE_CACHE_KEY = "kmitl_schedule_builder_offline_cache";
const KSB_SEMESTER_START_KEY = "kmitl_schedule_builder_semester_start";
const DARK_MODE_STORAGE_KEY = "kmitl_schedule_builder_dark_mode_enabled";

/* ───────────── Extension flags ───────────── */

const KSB_EXTENSION_FLAG = "data-kmitl-schedule-builder-processed";
const KSB_EXTENSION_PROCESSED_VALUE = "true";
const KSB_CHECKBOX_WRAPPER_SELECTOR = ".ksb-checkbox-wrapper";
const KSB_EXTENSION_STYLE_ID = "kmitl-schedule-builder-style";
const KSB_ROUTE_CHECK_INTERVAL_MS = 250;

/* ───────────── Parsing constants ───────────── */

const KSB_SUBJECT_CARD_CANDIDATE_SELECTOR = "div, li, article, section";
const KSB_SUBJECT_ID_PATTERN = /\b\d{8}\b/;
const KSB_TIME_RANGE_PATTERN = /(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/;
const KSB_SECTION_PATTERN = /section\s*\(([^)]+)\)/i;

const KSB_SUBJECT_TABLE_COLUMNS = {
    subjectCode: 0,
    subjectName: 1,
    credits: 2,
    group: 3,
    classTime: 4,
    room: 5,
    building: 6,
    teacher: 7,
    examInfo: 8,
    condition: 9,
    note: 10,
    capacity: 11,
    enrolled: 12,
    queue: 13,
    registered: 14,
};

/* ───────────── Day maps ───────────── */

const KSB_THAI_DAY_MAP = {
    "จันทร์": "Mon",
    "อังคาร": "Tue",
    "พุธ": "Wed",
    "พฤหัสบดี": "Thu",
    "ศุกร์": "Fri",
    "เสาร์": "Sat",
    "อาทิตย์": "Sun",
};

const KSB_DAY_KEY_MAP = {
    mon: "Mon", monday: "Mon",
    tue: "Tue", tuesday: "Tue",
    wed: "Wed", wednesday: "Wed",
    thu: "Thu", thursday: "Thu",
    fri: "Fri", friday: "Fri",
    sat: "Sat", saturday: "Sat",
    sun: "Sun", sunday: "Sun",
};

const KSB_TIMETABLE_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KSB_TIMETABLE_DAY_LABELS = {
    Mon: "Mon", Tue: "Tue", Wed: "Wed", Thu: "Thu",
    Fri: "Fri", Sat: "Sat", Sun: "Sun",
};

/* ───────────── JS day index → key ───────────── */

const KSB_JS_DAY_INDEX_MAP = {
    0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed",
    4: "Thu", 5: "Fri", 6: "Sat",
};

/* ───────────── Grid constants ───────────── */

const KSB_TIMETABLE_START_MINUTE = 8 * 60;
const KSB_TIMETABLE_END_MINUTE = 23 * 60;
const KSB_TIMETABLE_SLOT_MINUTES = 30;
const KSB_TIMETABLE_FIRST_SLOT_COLUMN = 2;

/* ───────────── Debug flags ───────────── */

const KSB_DEBUG_PARSING = false;
const KSB_DEBUG_UI = false;

/* ───────────── Utility functions ───────────── */

function ksbEscapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function ksbNormalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function ksbTimeToMinutes(value) {
    const timeMatch = ksbNormalizeWhitespace(value).match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) return null;
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

function ksbMinutesToTimeLabel(minutes) {
    const hours = Math.floor(minutes / 60);
    const minutePart = minutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutePart).padStart(2, "0")}`;
}

function ksbNormalizeDayKey(value) {
    const normalizedValue = ksbNormalizeWhitespace(value);
    if (!normalizedValue) return "";
    const thaiDayKey = ksbNormalizeThaiDayToKey(normalizedValue);
    if (thaiDayKey) return thaiDayKey;
    return KSB_DAY_KEY_MAP[normalizedValue.toLowerCase()] || "";
}

function ksbNormalizeThaiDayToKey(dayText) {
    const normalizedDayText = ksbNormalizeWhitespace(dayText).replace(/^วัน/, "");
    return KSB_THAI_DAY_MAP[normalizedDayText] || "";
}

function ksbNormalizeSubjectIdPart(value) {
    return ksbNormalizeWhitespace(value || "")
        .toLowerCase()
        .replace(/[|]/g, "/");
}

/* ───────────── Subject display helpers ───────────── */

function ksbGetSubjectDisplayCode(subject) {
    return subject.subjectCode || subject.code || "";
}

function ksbGetSubjectDisplayName(subject) {
    return subject.subjectName || subject.name || "Unknown Subject";
}

function ksbGetSubjectDisplayClassType(subject) {
    const classType = subject.classType || subject.type || "unknown";
    const labels = {
        theory: "ทฤษฎี", practical: "ปฏิบัติ", seminar: "สัมมนา",
        "ทฤษฎี": "ทฤษฎี", "ปฏิบัติ": "ปฏิบัติ", "สัมมนา": "สัมมนา",
        unknown: "ไม่ทราบประเภท",
    };
    return labels[classType] || labels.unknown;
}

function ksbGetSubjectDisplayDay(subject) {
    return subject.dayText || subject.day || "";
}

function ksbGetSubjectStartTime(subject) {
    return subject.startTime || subject.start || "";
}

function ksbGetSubjectEndTime(subject) {
    return subject.endTime || subject.end || "";
}

function ksbGetSubjectDisplayLocation(subject) {
    return [subject.room, subject.building].filter(Boolean).join(" / ");
}

/* ───────────── Storage helpers ───────────── */

async function ksbStorageGet(key) {
    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
            const result = await chrome.storage.local.get(key);
            return result[key];
        }
    } catch (err) {
        if (KSB_DEBUG_UI) console.warn("[KSB] chrome.storage.local.get failed:", err);
    }
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : undefined;
    } catch (err) {
        if (KSB_DEBUG_UI) console.warn("[KSB] localStorage.getItem failed:", err);
        return undefined;
    }
}

async function ksbStorageSet(key, value) {
    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.set) {
            await chrome.storage.local.set({ [key]: value });
            return;
        }
    } catch (err) {
        if (KSB_DEBUG_UI) console.warn("[KSB] chrome.storage.local.set failed:", err);
    }
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
        if (KSB_DEBUG_UI) console.warn("[KSB] localStorage.setItem failed:", err);
    }
}

async function ksbCopyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand("copy");
            textArea.remove();
            return true;
        } catch (copyErr) {
            textArea.remove();
            return false;
        }
    }
}


/* ───────────── Icon renderer ───────────── */

function ksbRenderIcon(name) {
    const icons = {
        calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
        refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
        clear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`,
        close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
        copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
        download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
        groups: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>`,
        list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`,
        warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
        conflict: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
        info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
        selected: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
        open: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 22 3 22 10"></polyline><line x1="10" y1="14" x2="22" y2="2"></line></svg>`,
        moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`,
        sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
        share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>`,
        register: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>`,
        credits: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`,
        wifi_off: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.56 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>`,
        swap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>`,
        compare: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`,
        upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`,
        palette: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" stroke="none"></circle><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" stroke="none"></circle><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" stroke="none"></circle><circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" stroke="none"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path></svg>`,
        "chevron-down": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
    };
    const svg = icons[name] || "";
    if (!svg) return "";
    return `<span class="ksb-icon" aria-hidden="true">${svg}</span>`;
}
