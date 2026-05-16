/**
 * KMITL Schedule Builder — Course Category Color-Coding
 *
 * Detects course categories from 8-digit subject codes using prefix
 * heuristics and assigns colors.  Users can override categories
 * via chrome.storage.local.
 */

const KSB_CATEGORY_PALETTE = {
    "gen-ed":  { label: "Gen-Ed", color: "#0d9488", bg: "#ccfbf1", border: "#0d9488" },
    "major":   { label: "Major",  color: "#f15a24", bg: "#fff3ed", border: "#f15a24" },
    "unknown": { label: "Other",  color: "#6b7280", bg: "#f3f4f6", border: "#9ca3af" },
};

let ksbCategoryOverrides = {};

async function ksbInitColorCoding() {
    const stored = await ksbStorageGet(KSB_CATEGORY_OVERRIDES_KEY);
    ksbCategoryOverrides = stored && typeof stored === "object" ? stored : {};
}

function ksbDetectCategory(subjectCode) {
    const code = ksbNormalizeWhitespace(subjectCode);
    if (!code || code.length < 8) return "unknown";

    // Check user overrides first
    if (ksbCategoryOverrides[code]) return ksbCategoryOverrides[code];

    const prefix2 = code.substring(0, 2);

    // Gen-Ed subjects typically start with 90
    if (prefix2 === "90") return "gen-ed";

    // Most other 8-digit codes are Major subjects
    return "major";
}

function ksbGetCategoryStyle(subjectCode) {
    const category = ksbDetectCategory(subjectCode);
    return KSB_CATEGORY_PALETTE[category] || KSB_CATEGORY_PALETTE["major"];
}

function ksbGetCategoryName(subjectCode) {
    const category = ksbDetectCategory(subjectCode);
    return (KSB_CATEGORY_PALETTE[category] || KSB_CATEGORY_PALETTE["unknown"]).label;
}

async function ksbSetCategoryOverride(subjectCode, category) {
    ksbCategoryOverrides[subjectCode] = category;
    await ksbStorageSet(KSB_CATEGORY_OVERRIDES_KEY, ksbCategoryOverrides);
}

function ksbRenderCategoryLegend() {
    const entries = Object.entries(KSB_CATEGORY_PALETTE)
        .filter(([key]) => key !== "unknown")
        .map(([key, val]) => {
            return `<span class="ksb-legend-item">
                <span class="ksb-legend-swatch" style="background:${val.color};"></span>
                ${ksbEscapeHtml(val.label)}
            </span>`;
        }).join("");

    return `<div class="ksb-category-legend">${ksbRenderIcon("palette")} ${entries}</div>`;
}
