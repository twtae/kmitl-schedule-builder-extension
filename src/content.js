// Constants and utilities are now provided by src/utils.js
let pageScanScheduled = false;
let pageScanTimer = null;
let routeCheckTimer = null;
let lastRouteKey = "";
let pageObserver = null;
let scheduleBuilderInitialized = false;
let globalListenersAttached = false;
let checkboxInjectionInProgress = false;
let checkboxInjectionPending = false;
let copyStatusTimer = null;
let latestSelectedSubjects = [];
let isPanelCollapsed = true;
let showSubjectGroups = false;
let showSelectedList = false;


function applyDarkMode(enabled) {
    if (enabled) {
        document.documentElement.classList.add("ksb-dark-mode");
    } else {
        document.documentElement.classList.remove("ksb-dark-mode");
    }
}

async function init() {
    // Inject extension stylesheet unconditionally on page load so dark mode is active immediately
    injectExtensionStyles();

    // Read and apply initial dark mode preference
    try {
        const isDarkMode = await ksbStorageGet(DARK_MODE_STORAGE_KEY);
        applyDarkMode(Boolean(isDarkMode));
    } catch (err) {
        if (KSB_DEBUG_UI) console.warn("[KSB] Failed to load dark mode preference:", err);
    }

    // Set up reactive listener for changes in chrome.storage
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== "local") return;
            if (changes[DARK_MODE_STORAGE_KEY]) {
                applyDarkMode(Boolean(changes[DARK_MODE_STORAGE_KEY].newValue));
            }
        });
    }

    window.addEventListener("hashchange", handleRouteChange);
    window.addEventListener("popstate", handleRouteChange);
    
    // Initialize new modules
    try {
        await ksbInitColorCoding();
        await ksbInitOffline();
    } catch (err) {
        if (KSB_DEBUG_UI) console.warn("[KSB] Module initialization failed:", err);
    }
    
    // Check for shared links
    const sharedSubjects = ksbDecodeShareUrl();
    if (sharedSubjects) {
        if (confirm("Import shared schedule? This will replace your current one.")) {
            await saveSelectedSubjects(sharedSubjects);
            
            // Clean up URL
            const url = new URL(window.location.href);
            url.searchParams.delete("ksb_share");
            window.history.replaceState({}, "", url);
        }
    }

    startRouteWatcher();
    handleRouteChange();
    
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request) => {
        // Shared messages logic can go here if needed
    });
}

function isTeachTablePage() {
    const hashRoute = window.location.hash.slice(1);
    const isTeachTableRoute =
        hashRoute === "/teach_table" ||
        hashRoute.startsWith("/teach_table?") ||
        hashRoute.startsWith("/teach_table/");

    return window.location.origin === "https://regis.reg.kmitl.ac.th" && isTeachTableRoute;
}

function handleRouteChange() {
    lastRouteKey = getCurrentRouteKey();

    if (isTeachTablePage()) {
        initializeScheduleBuilder();
    } else {
        cleanupScheduleBuilderUi();
    }
}

function startRouteWatcher() {
    if (routeCheckTimer !== null) return;

    routeCheckTimer = window.setInterval(() => {
        const routeKey = getCurrentRouteKey();
        if (routeKey === lastRouteKey && (isTeachTablePage() || !hasScheduleBuilderUi())) {
            return;
        }

        handleRouteChange();
    }, KSB_ROUTE_CHECK_INTERVAL_MS);
}

function getCurrentRouteKey() {
    return `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function hasScheduleBuilderUi() {
    return Boolean(
        document.querySelector("#kmitl-schedule-builder-launcher") ||
        document.querySelector("#kmitl-schedule-builder-modal-overlay") ||
        document.querySelector(KSB_CHECKBOX_WRAPPER_SELECTOR) ||
        document.querySelector(`#${KSB_EXTENSION_STYLE_ID}`) ||
        document.documentElement.classList.contains("ksb-modal-is-open")
    );
}

function initializeScheduleBuilder() {
    if (!isTeachTablePage()) return;

    injectExtensionStyles();

    if (scheduleBuilderInitialized) {
        schedulePageScan();
        injectExtensionUi();
        return;
    }

    if (!pageObserver) {
        observePageChanges();
    }

    scheduleBuilderInitialized = true;
    injectCheckboxesIntoSubjectCards();
    injectExtensionUi();
}

function injectExtensionStyles() {
    if (document.querySelector(`#${KSB_EXTENSION_STYLE_ID}`)) return;

    const styleLink = document.createElement("link");
    styleLink.id = KSB_EXTENSION_STYLE_ID;
    styleLink.rel = "stylesheet";
    styleLink.href = chrome.runtime.getURL("src/style.css");
    document.documentElement.appendChild(styleLink);
}

function cleanupScheduleBuilderUi() {
    scheduleBuilderInitialized = false;
    checkboxInjectionInProgress = false;
    checkboxInjectionPending = false;
    pageScanScheduled = false;
    isPanelCollapsed = true;

    if (pageScanTimer !== null) {
        window.clearTimeout(pageScanTimer);
        pageScanTimer = null;
    }

    if (copyStatusTimer !== null) {
        window.clearTimeout(copyStatusTimer);
        copyStatusTimer = null;
    }

    if (pageObserver) {
        pageObserver.disconnect();
        pageObserver = null;
    }

    removeScheduleBuilderGlobalListeners();
    updateVisibleSubjectIssueMarkers(new Set(), new Set());
    document.querySelector("#kmitl-schedule-builder-launcher")?.remove();
    document.querySelector("#kmitl-schedule-builder-modal-overlay")?.remove();

    document.querySelectorAll(KSB_CHECKBOX_WRAPPER_SELECTOR).forEach((wrapper) => {
        const owner = wrapper.closest(`[${KSB_EXTENSION_FLAG}]`);
        if (owner) owner.removeAttribute(KSB_EXTENSION_FLAG);
        wrapper.remove();
    });

    document
        .querySelectorAll(`[${KSB_EXTENSION_FLAG}="${KSB_EXTENSION_PROCESSED_VALUE}"]`)
        .forEach((element) => element.removeAttribute(KSB_EXTENSION_FLAG));

    document.documentElement.classList.remove("ksb-modal-is-open");
}

function observePageChanges() {
    if (!document.body || pageObserver) return;

    pageObserver = new MutationObserver(() => {
        if (isTeachTablePage()) {
            schedulePageScan();
        } else {
            cleanupScheduleBuilderUi();
        }
    });

    pageObserver.observe(document.body, {
        childList: true,
        subtree: true,
    });
}

function injectExtensionUi() {
    if (!isTeachTablePage()) return;

    ensureModalShell();
    ensureSidebarLauncher();
    updateScheduleBuilderVisibility();
}

function ensureModalShell() {
    if (!isTeachTablePage()) return;

    if (document.querySelector("#kmitl-schedule-builder-panel")) {
        return;
    }

    const overlay = document.createElement("div");
    overlay.id = "kmitl-schedule-builder-modal-overlay";
    overlay.setAttribute("aria-hidden", "true");

    const panel = document.createElement("div");
    panel.id = "kmitl-schedule-builder-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "KMITL Schedule Builder");

    panel.innerHTML = `
    <div class="ksb-panel-header">
        <div class="ksb-panel-title">
            <strong>
                ${ksbRenderIcon("calendar")} KMITL Schedule Builder
                <span class="ksb-attribution">v0.3.1</span>
            </strong>
            <div id="ksb-header-credits"></div>
            <span id="ksb-selected-count-compact" class="ksb-selected-count-compact">${ksbRenderIcon("selected")} Selected: 0</span>
        </div>
		<div class="ksb-panel-actions">
            <div id="ksb-modal-error-badge"></div>
			<button id="ksb-render-button" type="button">${ksbRenderIcon("refresh")} Refresh</button>
			<button id="ksb-clear-button" type="button">${ksbRenderIcon("clear")} Clear</button>
            <button
                id="ksb-collapse-button"
                type="button"
                data-ksb-toggle-panel
                aria-label="Hide KMITL Schedule Builder modal"
                aria-expanded="true"
            >
                ${ksbRenderIcon("close")} Close
            </button>
		</div>
    </div>
    <div class="ksb-panel-body">
        <div class="ksb-panel-toolbar">
            <div class="ksb-section-toggles">
                <button
                    class="ksb-section-toggle"
                    type="button"
                    data-ksb-toggle-section="groups"
                    aria-label="Show subject groups"
                    aria-expanded="false"
                >
                    ${ksbRenderIcon("groups")} Show Groups
                </button>
                <button
                    class="ksb-section-toggle"
                    type="button"
                    data-ksb-toggle-section="selectedList"
                    aria-label="Show selected classes list"
                    aria-expanded="false"
                >
                    ${ksbRenderIcon("list")} Show List
                </button>
            </div>
        </div>
        <div class="ksb-export-actions">
            <button class="ksb-export-button" type="button" data-ksb-action="copy-reg-codes" title="Copy codes for registration page">${ksbRenderIcon("register")} Copy codes</button>
            <div class="ksb-dropdown">
                <button
                    class="ksb-export-button ksb-dropdown-toggle"
                    type="button"
                    data-ksb-toggle-dropdown="share"
                    aria-expanded="false"
                    aria-haspopup="true"
                >
                    ${ksbRenderIcon("share")} Share ${ksbRenderIcon("chevron-down")}
                </button>
                <div class="ksb-dropdown-menu">
                    <button class="ksb-dropdown-item" type="button" data-ksb-action="copy-share-link">${ksbRenderIcon("share")} Copy Share Link</button>
                    <button class="ksb-dropdown-item" type="button" data-ksb-action="download-png">${ksbRenderIcon("image")} Download Image</button>
                </div>
            </div>
            <span id="ksb-copy-status" class="ksb-copy-status" aria-live="polite"></span>
        </div>
        <div id="ksb-compare-container"></div>
        <div id="ksb-offline-banner-container"></div>
        <div id="ksb-timetable"></div>
    </div>
	`;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    document
        .querySelector("#ksb-render-button")
        .addEventListener("click", renderTimetable);

    document
        .querySelector("#ksb-clear-button")
        .addEventListener("click", clearSelectedSubjects);

    document
        .querySelector("#ksb-collapse-button")
        .addEventListener("click", closeScheduleBuilderModal);

    overlay.addEventListener("click", handleBackdropClick);

    panel.addEventListener("click", async (event) => {
        if (!(event.target instanceof Element)) return;

        const dropdownToggle = event.target.closest("[data-ksb-toggle-dropdown]");
        if (dropdownToggle instanceof HTMLElement) {
            toggleDropdown(dropdownToggle);
            return;
        }

        closeDropdownsOutside(event.target);

        const swapButton = event.target.closest("[data-ksb-swap-from]");
        if (swapButton instanceof HTMLElement) {
            const fromId = swapButton.dataset.ksbSwapFrom;
            const toSubject = JSON.parse(swapButton.dataset.ksbSwapTo);
            await handleSwapAction(fromId, toSubject);
            return;
        }

        const sectionToggle = event.target.closest("[data-ksb-toggle-section]");
        if (sectionToggle instanceof HTMLElement) {
            await togglePanelSection(sectionToggle.dataset.ksbToggleSection);
            return;
        }

        const ksbActionBtn = event.target.closest("[data-ksb-action]");
        if (ksbActionBtn instanceof HTMLElement) {
            const action = ksbActionBtn.dataset.ksbAction;
            const subjects = await getSelectedSubjects();
            
            if (action === "copy-reg-codes") {
                await handleCopyAction("codes");
            } else if (action === "copy-share-link") {
                const link = ksbEncodeShareLink(subjects);
                if (link) {
                    await ksbCopyToClipboard(link);
                    setCopyStatus("Share link copied to clipboard!");
                } else {
                    setCopyStatus("Failed to generate link");
                }
            } else if (action === "download-png") {
                await handleDownloadPngAction();
            }
            closeAllDropdowns();
            return;
        }

        const copyButton = event.target.closest("[data-ksb-copy]");
        if (copyButton instanceof HTMLElement) {
            await handleCopyAction(copyButton.dataset.ksbCopy);
            return;
        }

        const downloadButton = event.target.closest("[data-ksb-download]");
        if (downloadButton instanceof HTMLElement) {
            if (downloadButton.dataset.ksbDownload === "png") {
                await handleDownloadPngAction();
            }
            return;
        }

        const removeButton = event.target.closest("[data-ksb-remove-subject-id]");
        if (!(removeButton instanceof HTMLElement)) return;

        await removeSelectedSubject(removeButton.dataset.ksbRemoveSubjectId);
    });

    addScheduleBuilderGlobalListeners();

    updateScheduleBuilderVisibility();
}

function updateScheduleBuilderVisibility() {
    if (!isTeachTablePage()) return;

    updateModalSidebarOffset();
    updateSidebarLauncherPosition();
    updatePanelCollapsedState();
    updateSectionToggleButtons();
    renderTimetable();
}

async function injectCheckboxesIntoSubjectCards() {
    if (!isTeachTablePage()) return;

    if (checkboxInjectionInProgress) {
        checkboxInjectionPending = true;
        return;
    }

    checkboxInjectionInProgress = true;

    try {
        const cards = findSubjectCards();
        const selectedSubjects = await getSelectedSubjects();
        if (!isTeachTablePage()) return;

        ksbSetAllParsedRows(cards.map(c => parseSubjectElement(c)).filter(Boolean));
        
        cards.forEach((card) => {
            if (card.hasAttribute(KSB_EXTENSION_FLAG)) return;
            if (card.querySelector(KSB_CHECKBOX_WRAPPER_SELECTOR)) return;

            const subject = parseSubjectElement(card);
            if (!subject) return;

            card.setAttribute(KSB_EXTENSION_FLAG, KSB_EXTENSION_PROCESSED_VALUE);

            const checkboxWrapper = document.createElement("label");
            checkboxWrapper.className = "ksb-checkbox-wrapper";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "ksb-subject-checkbox";
            checkbox.dataset.subjectId = subject.id;
            checkbox.checked = isSubjectSelected(subject.id, selectedSubjects);

            checkbox.addEventListener("change", async () => {
                await toggleSelectedSubject(subject, checkbox.checked);
                await renderTimetable();
            });

            checkboxWrapper.appendChild(checkbox);
            const checkboxLabel = document.createElement("span");
            checkboxLabel.className = "ksb-checkbox-label";
            checkboxLabel.textContent = "Add";
            checkboxWrapper.appendChild(checkboxLabel);

            getCheckboxInjectionTarget(card).prepend(checkboxWrapper);
        });

        updateVisibleSubjectIssueMarkersForSubjects(selectedSubjects);
    } finally {
        checkboxInjectionInProgress = false;

        if (checkboxInjectionPending) {
            checkboxInjectionPending = false;
            schedulePageScan();
        }
    }
}

function schedulePageScan() {
    if (!isTeachTablePage()) return;
    if (pageScanScheduled) return;

    pageScanScheduled = true;

    pageScanTimer = window.setTimeout(() => {
        pageScanTimer = null;
        pageScanScheduled = false;
        if (!isTeachTablePage()) return;
        injectCheckboxesIntoSubjectCards();
        injectExtensionUi();
        updateSidebarLauncherPosition();
    }, 50);
}

function findSubjectCards() {
    /*
     * Detection is intentionally centralized here. After inspecting the real
     * KMITL DOM, update findSubjectRows or KSB_SUBJECT_CARD_CANDIDATE_SELECTOR here.
     *
     * The fallback stays text-based:
     * - visible text contains section(...)
     * - visible text contains HH:mm - HH:mm
     */
    const rows = findSubjectRows();

    // The real KMITL teaching table is table-based.
    // If rows are found, do not run broad fallback detection,
    // because fallback can accidentally detect our modal/timetable UI.
    if (rows.length > 0) {
        return rows;
    }

    const candidates = [...document.querySelectorAll(KSB_SUBJECT_CARD_CANDIDATE_SELECTOR)]
        .filter((element) => element instanceof HTMLElement)
        .filter((element) => !isInsideScheduleBuilderUi(element))
        .filter(isLikelySubjectCard);

    const fallbackCards = candidates.filter((element) => {
        return !hasSubjectCardChild(element, candidates);
    });

    return fallbackCards;
}

function findSubjectRows() {
    return [...document.querySelectorAll("tbody tr")]
        .filter((row) => row instanceof HTMLTableRowElement)
        .filter(isLikelySubjectRow);
}

function isLikelySubjectCard(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (isInsideScheduleBuilderUi(element)) return false;

    if (element instanceof HTMLTableRowElement) {
        return isLikelyKmitlTableRow(element);
    }

    return hasFallbackSubjectCardText(element);
}

function isLikelyKmitlTableRow(row) {
    return isLikelySubjectRow(row);
}

function isLikelySubjectRow(row) {
    if (isInsideScheduleBuilderUi(row)) return false;
    if (row.classList.contains("table-space-tr")) return false;

    const cells = getDirectTableCells(row);
    // Relax column count requirement (at least 8 columns should be enough for basic parsing)
    if (cells.length < 8) return false;

    const subjectCode = getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.subjectCode);
    const subjectName = getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.subjectName);
    
    // More flexible ID pattern: 7-10 digits
    const flexibleIdPattern = /\b\d{7,10}\b/;

    return (
        flexibleIdPattern.test(subjectCode) &&
        Boolean(subjectName)
    );
}

function hasSubjectCardChild(element, candidates) {
    return candidates.some((candidate) => {
        return hasSubjectCardParent(candidate, [element]);
    });
}

function hasSubjectCardParent(element, candidates) {
    return candidates.some((candidate) => {
        return candidate !== element && candidate.contains(element);
    });
}

function hasFallbackSubjectCardText(element) {
    const text = element.innerText || "";
    const hasSection = KSB_SECTION_PATTERN.test(text);
    const hasTime = KSB_TIME_RANGE_PATTERN.test(text);

    return hasSection && hasTime;
}

function isInsideScheduleBuilderUi(element) {
    if (!(element instanceof HTMLElement)) return false;

    return Boolean(
        element.closest("#kmitl-schedule-builder-modal-overlay") ||
        element.closest("#kmitl-schedule-builder-panel") ||
        element.closest("#kmitl-schedule-builder-launcher") ||
        [...element.classList].some((className) => className.startsWith("ksb-"))
    );
}

function getCheckboxInjectionTarget(element) {
    if (element instanceof HTMLTableRowElement) {
        return getDirectTableCells(element)[0] || element;
    }

    return element;
}

function parseSubjectElement(element) {
    if (element instanceof HTMLTableRowElement && isLikelySubjectRow(element)) {
        return parseSubjectRow(element);
    }

    return parseSubjectCard(element);
}

function parseSubjectRow(row) {
    const rawText = row.innerText || "";
    const groupCell = getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.group);
    const schedule = parseClassScheduleText(getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.classTime));

    if (!schedule.startTime || !schedule.endTime) return null;

    const subject = createParsedSubject({
        subjectCode: extractSubjectCode(getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.subjectCode)),
        subjectName: getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.subjectName),
        credits: getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.credits),
        section: extractSectionFromGroupCell(groupCell),
        classType: extractClassTypeFromGroupCell(groupCell),
        day: schedule.day,
        dayText: schedule.dayText,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        room: getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.room),
        building: getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.building),
        teacher: getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.teacher),
        examInfo: extractExamInfo(getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.examInfo)),
        condition: getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.condition),
        note: getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.note),
        capacity: getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.capacity),
        enrolled: getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.enrolled),
        queue: getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.queue),
        registered: getCellText(row, KSB_SUBJECT_TABLE_COLUMNS.registered),
        rawText,
    });

    debugLogParsedSubject(subject);

    return {
        ...subject,
        id: createStableSubjectId(subject),
    };
}

function parseSubjectCard(card) {
    /*
     * This parser is intentionally text-first until the real KMITL DOM is
     * inspected. If stable per-field selectors exist, replace individual
     * extract* helpers or pass selector-derived text into createParsedSubject.
    */
    const text = card.innerText || "";
    const schedule = parseClassScheduleText(text);

    const subject = createParsedSubject({
        subjectCode: extractSubjectCode(text),
        subjectName: extractSubjectName(text),
        section: extractSection(text),
        classType: extractClassType(text),
        day: schedule.day,
        dayText: schedule.dayText,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        room: extractRoom(text),
        teacher: extractTeacher(text),
        rawText: text,
    });

    if (!subject.section || !subject.startTime || !subject.endTime) return null;

    debugLogParsedSubject(subject);

    return {
        ...subject,
        id: createStableSubjectId(subject),
    };
}

function createParsedSubject(subject) {
    return {
        id: "",
        subjectCode: ksbNormalizeWhitespace(subject.subjectCode),
        subjectName: ksbNormalizeWhitespace(subject.subjectName),
        credits: ksbNormalizeWhitespace(subject.credits),
        section: ksbNormalizeWhitespace(subject.section),
        classType: subject.classType || "unknown",
        day: ksbNormalizeDayKey(subject.day),
        dayText: ksbNormalizeWhitespace(subject.dayText),
        startTime: ksbNormalizeWhitespace(subject.startTime),
        endTime: ksbNormalizeWhitespace(subject.endTime),
        room: ksbNormalizeWhitespace(subject.room),
        building: ksbNormalizeWhitespace(subject.building),
        teacher: ksbNormalizeWhitespace(subject.teacher),
        examInfo: ksbNormalizeWhitespace(subject.examInfo),
        condition: ksbNormalizeWhitespace(subject.condition),
        note: ksbNormalizeWhitespace(subject.note),
        capacity: ksbNormalizeWhitespace(subject.capacity),
        enrolled: ksbNormalizeWhitespace(subject.enrolled),
        queue: ksbNormalizeWhitespace(subject.queue),
        registered: ksbNormalizeWhitespace(subject.registered),
        rawText: subject.rawText || "",
    };
}

function extractSubjectName(text) {
    const lines = text
        .split("\n")
        .map(ksbNormalizeWhitespace)
        .filter(Boolean);

    const subjectLine = lines.find((line) => {
        return (
            /^[A-Z0-9\s:-]+$/.test(line) &&
            !line.includes(":") &&
            !line.toLowerCase().includes("section")
        );
    });

    return subjectLine || "Unknown Subject";
}

function extractSubjectCode(text) {
    const subjectIdMatch = text.match(KSB_SUBJECT_ID_PATTERN);
    return subjectIdMatch ? subjectIdMatch[0] : "";
}

function extractSection(text) {
    const explicitSectionMatch = text.match(KSB_SECTION_PATTERN);
    if (explicitSectionMatch) return explicitSectionMatch[1];

    const lineSection = text
        .split("\n")
        .map(ksbNormalizeWhitespace)
        .find((line) => /^\d+[A-Z]?(?:\s*\([^)]+\))?$/i.test(line));

    return lineSection || "";
}

function extractSectionFromGroupCell(value) {
    const sectionMatch = ksbNormalizeWhitespace(value).match(/\d+[A-Z]?/i);
    return sectionMatch ? sectionMatch[0] : "";
}

function extractClassTypeFromGroupCell(value) {
    const normalizedText = ksbNormalizeWhitespace(value).toLowerCase();

    if (/ทฤษฎี|lecture|theory/.test(normalizedText)) return "theory";
    if (/ปฏิบัติ|lab|practical/.test(normalizedText)) return "practical";
    if (/สัมมนา|seminar/.test(normalizedText)) return "seminar";

    return "unknown";
}

function extractClassType(text) {
    const normalizedText = ksbNormalizeWhitespace(text).toLowerCase();

    if (/ทฤษฎี|lecture|theory/.test(normalizedText)) return "theory";
    if (/ปฏิบัติ|lab|practical/.test(normalizedText)) return "practical";
    if (/สัมมนา|seminar/.test(normalizedText)) return "seminar";

    return "unknown";
}

function extractTimeRange(text) {
    const timeMatch = text.match(KSB_TIME_RANGE_PATTERN);

    return {
        startTime: timeMatch ? timeMatch[1] : "",
        endTime: timeMatch ? timeMatch[2] : "",
    };
}

function parseClassScheduleText(value) {
    const text = ksbNormalizeWhitespace(value);
    const timeRange = extractTimeRange(text);
    const dayText = extractThaiDayText(text);

    return {
        day: ksbNormalizeThaiDayToKey(dayText),
        dayText,
        startTime: timeRange.startTime,
        endTime: timeRange.endTime,
    };
}

function extractThaiDayText(value) {
    const text = ksbNormalizeWhitespace(value);

    return Object.keys(KSB_THAI_DAY_MAP).find((thaiDay) => {
        return text.includes(thaiDay) || text.includes(`วัน${thaiDay}`);
    }) || "";
}


function extractExamInfo(value) {
    return ksbNormalizeWhitespace(value);
}

function extractRoom(text) {
    const lines = text
        .split("\n")
        .map(ksbNormalizeWhitespace)
        .filter(Boolean);

    return (
        lines.find((line) => {
            return (
                line.includes("ห้อง") ||
                line.includes("อาคาร") ||
                line.includes("พระจอมเกล้า") ||
                line.includes("สำนัก")
            );
        }) || ""
    );
}

function extractTeacher(text) {
    const lines = text
        .split("\n")
        .map(ksbNormalizeWhitespace)
        .filter(Boolean);

    const teacherLine = lines.find((line) => {
        return /อาจารย์|ผู้สอน|teacher|instructor/i.test(line);
    });

    if (!teacherLine) return "";

    return teacherLine
        .replace(/^(อาจารย์|ผู้สอน|teacher|instructor)\s*[:：-]?\s*/i, "")
        .trim();
}

function getDirectTableCells(row) {
    return [...row.children].filter((child) => {
        return child instanceof HTMLTableCellElement;
    });
}

function getCellText(row, columnIndex) {
    const cells = getDirectTableCells(row);
    return ksbNormalizeWhitespace(cells[columnIndex]?.innerText || "");
}


function createStableSubjectId(subject) {
    /*
     * Stable IDs let storage survive page refreshes and SPA rerenders. Do not
     * use DOM index here; Angular/Vue can reorder or recreate nodes anytime.
     */
    return [
        subject.subjectCode || subject.code,
        subject.section,
        subject.classType || subject.type,
        subject.day,
        subject.startTime || subject.start,
        subject.endTime || subject.end,
        subject.room,
        subject.building,
    ]
        .map(ksbNormalizeSubjectIdPart)
        .filter(Boolean)
        .join("|");
}


function debugLogParsedSubject(subject) {
    if (!KSB_DEBUG_PARSING) return;
    console.debug("[KSB] Parsed subject", subject);
}

async function toggleSelectedSubject(subject, checked) {
    const selectedSubjects = await getSelectedSubjects();

    const nextSubjects = checked
        ? [
            ...selectedSubjects.filter((item) => item.id !== subject.id),
            subject,
        ]
        : selectedSubjects.filter((item) => item.id !== subject.id);

    try {
        await saveSelectedSubjects(nextSubjects);
    } catch (err) {
        // chrome.storage may throw 'Extension context invalidated' if the
        // extension is being reloaded/unloaded. Fail gracefully and keep
        // selected subjects in memory.
        if (KSB_DEBUG_UI) console.warn("[KSB] saveSelectedSubjects failed:", err);
        latestSelectedSubjects = normalizeSelectedSubjects(nextSubjects);
    }
}

async function getSelectedSubjects() {
    // Prefer chrome.storage.local, but gracefully fall back to localStorage
    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
            const result = await chrome.storage.local.get(KSB_STORAGE_KEY);
            const selectedSubjects = Array.isArray(result[KSB_STORAGE_KEY]) ? result[KSB_STORAGE_KEY] : [];
            const normalizedSubjects = normalizeSelectedSubjects(selectedSubjects);

            if (normalizedSubjects.length !== selectedSubjects.length) {
                // Persist normalized storage when possible.
                try {
                    await saveSelectedSubjects(normalizedSubjects);
                } catch (e) {
                    if (KSB_DEBUG_UI) console.warn("[KSB] Failed to save normalized subjects:", e);
                }
            }

            return normalizedSubjects;
        }
    } catch (err) {
        if (KSB_DEBUG_UI) console.warn("[KSB] chrome.storage.local.get failed:", err);
    }

    // Fallback to window.localStorage
    try {
        const raw = window.localStorage.getItem(KSB_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return normalizeSelectedSubjects(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
        if (KSB_DEBUG_UI) console.warn("[KSB] localStorage.getItem failed:", err);
        return [];
    }
}

async function saveSelectedSubjects(subjects) {
    const normalized = normalizeSelectedSubjects(subjects);

    // Try chrome.storage.local first, fallback to localStorage
    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.set) {
            await chrome.storage.local.set({ [KSB_STORAGE_KEY]: normalized });
            return;
        }
    } catch (err) {
        if (KSB_DEBUG_UI) console.warn("[KSB] chrome.storage.local.set failed:", err);
    }

    try {
        window.localStorage.setItem(KSB_STORAGE_KEY, JSON.stringify(normalized));
    } catch (err) {
        if (KSB_DEBUG_UI) console.warn("[KSB] localStorage.setItem failed:", err);
        // As a last resort, keep in-memory (not persisted)
        latestSelectedSubjects = normalized;
    }
}

function normalizeSelectedSubjects(subjects) {
    const subjectsById = new Map();

    subjects.forEach((subject) => {
        if (!subject || !subject.id) return;
        subjectsById.set(subject.id, subject);
    });

    return [...subjectsById.values()];
}

function isSubjectSelected(subjectId, selectedSubjects) {
    return selectedSubjects.some((subject) => subject.id === subjectId);
}

async function clearSelectedSubjects() {
    await saveSelectedSubjects([]);

    syncAllVisibleCheckboxes([]);

    await renderTimetable();
}

async function renderTimetable() {
    if (!isTeachTablePage()) return;

    await renderSelectedSubjectPanel();
}

function openScheduleBuilderModal() {
    if (!isTeachTablePage()) return;

    try {
        ensureModalShell();
        isPanelCollapsed = false;
        updateModalSidebarOffset();
        updatePanelCollapsedState();
        updateSectionToggleButtons();
        renderTimetable();
    } catch (error) {
        console.error("[KSB] Failed to open schedule builder modal", error);
    }
}

function closeScheduleBuilderModal() {
    if (!isTeachTablePage()) return;

    try {
        isPanelCollapsed = true;
        updatePanelCollapsedState();
        updateSectionToggleButtons();
        ensureSidebarLauncher();
    } catch (error) {
        console.error("[KSB] Failed to close schedule builder modal", error);
    }
}

function handleScheduleBuilderKeydown(event) {
    if (event.key !== "Escape") return;

    if (closeAllDropdowns()) {
        return;
    }

    if (isScheduleBuilderExpanded()) {
        closeScheduleBuilderModal();
    }
}

function toggleDropdown(toggleButton) {
    const dropdown = toggleButton.closest(".ksb-dropdown");
    if (!(dropdown instanceof HTMLElement)) return;

    const shouldOpen = !dropdown.classList.contains("ksb-dropdown--open");
    closeAllDropdowns();
    dropdown.classList.toggle("ksb-dropdown--open", shouldOpen);
    toggleButton.setAttribute("aria-expanded", String(shouldOpen));
}

function closeDropdownsOutside(target) {
    if (target.closest(".ksb-dropdown")) return false;
    return closeAllDropdowns();
}

function closeAllDropdowns() {
    let closedAny = false;

    document.querySelectorAll(".ksb-dropdown--open").forEach((dropdown) => {
        dropdown.classList.remove("ksb-dropdown--open");
        const toggleButton = dropdown.querySelector("[data-ksb-toggle-dropdown]");
        if (toggleButton instanceof HTMLElement) {
            toggleButton.setAttribute("aria-expanded", "false");
        }
        closedAny = true;
    });

    return closedAny;
}

function addScheduleBuilderGlobalListeners() {
    if (globalListenersAttached) return;

    document.addEventListener("keydown", handleScheduleBuilderKeydown);
    window.addEventListener("resize", updateModalSidebarOffset);
    window.addEventListener("resize", updateSidebarLauncherPosition);
    globalListenersAttached = true;
}

function removeScheduleBuilderGlobalListeners() {
    if (!globalListenersAttached) return;

    document.removeEventListener("keydown", handleScheduleBuilderKeydown);
    window.removeEventListener("resize", updateModalSidebarOffset);
    window.removeEventListener("resize", updateSidebarLauncherPosition);
    globalListenersAttached = false;
}

function isScheduleBuilderExpanded() {
    return !isPanelCollapsed;
}

function handleBackdropClick(event) {
    if (event.target?.id === "kmitl-schedule-builder-modal-overlay") {
        closeScheduleBuilderModal();
    }
}

async function togglePanelSection(sectionName) {
    if (sectionName === "groups") {
        showSubjectGroups = !showSubjectGroups;
    }

    if (sectionName === "selectedList") {
        showSelectedList = !showSelectedList;
    }

    updateSectionToggleButtons();
    await renderTimetable();
}

function updatePanelCollapsedState() {
    const overlay = document.querySelector("#kmitl-schedule-builder-modal-overlay");
    const panel = document.querySelector("#kmitl-schedule-builder-panel");
    const collapseButton = document.querySelector("#ksb-collapse-button");
    if (!overlay || !panel || !collapseButton) return;

    panel.classList.toggle("ksb-panel--collapsed", isPanelCollapsed);
    overlay.classList.toggle("ksb-modal-overlay--open", !isPanelCollapsed);
    document.documentElement.classList.toggle("ksb-modal-is-open", !isPanelCollapsed);
    overlay.setAttribute("aria-hidden", String(isPanelCollapsed));
    collapseButton.innerHTML = `${ksbRenderIcon("close")} Close`;
    collapseButton.setAttribute(
        "aria-label",
        "Hide KMITL Schedule Builder modal"
    );
    collapseButton.setAttribute("aria-expanded", String(!isPanelCollapsed));

    ensureSidebarLauncher();
}

function toggleScheduleBuilderModal() {
    if (isScheduleBuilderExpanded()) {
        closeScheduleBuilderModal();
        return;
    }

    openScheduleBuilderModal();
}

function updateSectionToggleButtons() {
    updateSectionToggleButton("groups", "Groups", showSubjectGroups);
    updateSectionToggleButton("selectedList", "List", showSelectedList);
}

function updateSectionToggleButton(sectionName, label, isVisible) {
    const button = document.querySelector(`[data-ksb-toggle-section="${sectionName}"]`);
    if (!button) return;

    const icon = sectionName === "groups" ? ksbRenderIcon("groups") : ksbRenderIcon("list");
    button.innerHTML = `${icon} ${isVisible ? "Hide" : "Show"} ${label}`;
    button.setAttribute("aria-expanded", String(isVisible));
    button.setAttribute(
        "aria-label",
        `${isVisible ? "Hide" : "Show"} ${label.toLowerCase()} section`
    );
}

function updateSelectedCountDisplay(selectedCount) {
    const compactCountElement = document.querySelector("#ksb-selected-count-compact");

    if (compactCountElement) {
        compactCountElement.innerHTML = `${ksbRenderIcon("selected")} Selected: ${selectedCount}`;
    }
    renderSidebarLauncher(selectedCount);
}

function findKmitlSidebar() {
    const sidebarSelectors = [
        "aside",
        "nav",
        "[class*='sidebar' i]",
        "[class*='side-bar' i]",
        "[class*='sidenav' i]",
        "[class*='side-nav' i]",
        "[class*='side-menu' i]",
        "[class*='menu-left' i]",
        "[class*='left-menu' i]",
        "[class*='mat-sidenav' i]",
        "[class*='ant-layout-sider' i]",
    ];

    try {
        return [...document.querySelectorAll(sidebarSelectors.join(","))]
            .filter((element) => element instanceof HTMLElement)
            .filter((element) => !element.closest("#kmitl-schedule-builder-modal-overlay"))
            .filter((element) => !element.closest("#kmitl-schedule-builder-launcher"))
            .map((element) => ({
                element,
                rect: element.getBoundingClientRect(),
            }))
            .filter(({ rect }) => {
                return (
                    rect.width >= 120 &&
                    rect.width <= 460 &&
                    rect.height >= 240 &&
                    rect.left <= 80 &&
                    rect.right < window.innerWidth * 0.55
                );
            })
            .sort((first, second) => {
                return first.rect.left - second.rect.left || second.rect.height - first.rect.height;
            })[0]?.element || null;
    } catch (error) {
        console.warn("[KSB] Failed to find sidebar", error);
        return null;
    }
}

function getSidebarWidth() {
    const sidebar = findKmitlSidebar();
    if (!sidebar) return 320;

    const rect = sidebar.getBoundingClientRect();
    return Math.max(0, Math.min(Math.round(rect.right), window.innerWidth - 48));
}

function updateModalSidebarOffset() {
    const overlay = document.querySelector("#kmitl-schedule-builder-modal-overlay");
    if (!overlay) return;

    const sidebarWidth = getSidebarWidth();
    overlay.style.setProperty("--ksb-sidebar-width", `${sidebarWidth}px`);
}

function getSidebarRect() {
    const sidebar = findKmitlSidebar();
    if (!sidebar) {
        return {
            left: 12,
            width: 260,
            top: 96,
            bottom: 16,
        };
    }

    const rect = sidebar.getBoundingClientRect();
    return {
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        top: Math.round(rect.top),
        bottom: Math.round(window.innerHeight - rect.bottom),
    };
}

function updateSidebarLauncherPosition() {
    const launcher = document.querySelector("#kmitl-schedule-builder-launcher");
    if (!launcher) return;

    const sidebarRect = getSidebarRect();
    const launcherLeft = sidebarRect.left + 12;
    const launcherWidth = Math.max(220, sidebarRect.width - 24);
    const launcherBottom = 16;

    launcher.style.setProperty("--ksb-launcher-left", `${launcherLeft}px`);
    launcher.style.setProperty("--ksb-launcher-width", `${launcherWidth}px`);
    launcher.style.setProperty("--ksb-launcher-bottom", `${launcherBottom}px`);

    if (KSB_DEBUG_UI) {
        console.debug(
            "[KSB] Launcher position updated:",
            { launcherLeft, launcherWidth, launcherBottom }
        );
    }
}

function ensureSidebarLauncher() {
    if (!isTeachTablePage()) return null;

    let launcher = document.querySelector("#kmitl-schedule-builder-launcher");
    if (!launcher) {
        launcher = createSidebarLauncher();
        document.body.appendChild(launcher);
    }

    updateSidebarLauncherPosition();
    renderSidebarLauncher(latestSelectedSubjects.length);
    return launcher;
}

function createSidebarLauncher() {
    const launcher = document.createElement("div");
    launcher.id = "kmitl-schedule-builder-launcher";
    return launcher;
}



function renderSidebarLauncher(selectedCount) {
    const launcher = document.querySelector("#kmitl-schedule-builder-launcher");
    if (!launcher) return;

    const subjects = latestSelectedSubjects;
    const conflicts = getSubjectConflicts(subjects);
    const duplicateSelections = getDuplicateSubjectSelections(subjects);
    const totalErrors = conflicts.length + duplicateSelections.length;

    const isOpen = isScheduleBuilderExpanded();
    const launcherStateKey = `${selectedCount}:${totalErrors}:${isOpen ? "open" : "closed"}`;
    if (launcher.dataset.ksbRenderState === launcherStateKey) {
        return;
    }
    launcher.dataset.ksbRenderState = launcherStateKey;
    launcher.classList.toggle("ksb-sidebar-launcher--open", isOpen);

    const buttonText = isOpen ? "Close" : "Show";
    const buttonIcon = isOpen ? ksbRenderIcon("close") : ksbRenderIcon("open");
    const buttonAriaLabel = isOpen
        ? "Close KMITL Schedule Builder"
        : "Show KMITL Schedule Builder";

    const errorBadge = totalErrors > 0
        ? `<span class="ksb-sidebar-launcher-error-badge" title="${totalErrors} conflicts/duplicates detected">
            ${ksbRenderIcon("warning")} ${totalErrors}
          </span>`
        : "";

    const launcherHtml = `
        <div class="ksb-sidebar-launcher-header">
            <div class="ksb-sidebar-launcher-title">${ksbRenderIcon("calendar")} Schedule Builder</div>
            ${errorBadge}
        </div>
        <div class="ksb-sidebar-launcher-meta">
            <span class="ksb-attribution">Made by twtae & His beloved AI</span>
            <span class="ksb-sidebar-launcher-count">${ksbRenderIcon("selected")} Selected: ${ksbEscapeHtml(selectedCount)}</span>
        </div>
        <button
            class="ksb-sidebar-launcher-button"
            type="button"
            data-ksb-open-modal="true"
            aria-label="${ksbEscapeHtml(buttonAriaLabel)}"
        >
            <span class="ksb-sidebar-launcher-button-text ksb-button-content">${buttonIcon} ${ksbEscapeHtml(buttonText)}</span>
        </button>
    `;

    launcher.innerHTML = launcherHtml;
    bindSidebarLauncherButton(launcher);
}

function bindSidebarLauncherButton(launcher) {
    const button = launcher.querySelector("[data-ksb-open-modal]");
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.dataset.ksbOpenBound === "true") return;

    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
            toggleScheduleBuilderModal();
        } catch (error) {
            console.error("[KSB] Launcher button click failed", error);
        }
    });

    button.dataset.ksbOpenBound = "true";
}

async function renderSelectedSubjectPanel() {
    if (!isTeachTablePage()) return;

    const selectedSubjects = await getSelectedSubjects();
    latestSelectedSubjects = selectedSubjects;

    const timetableElement = document.querySelector("#ksb-timetable");

    if (!timetableElement) return;

    syncAllVisibleCheckboxes(selectedSubjects);
    updateSelectedCountDisplay(selectedSubjects.length);
    updatePanelCollapsedState();
    updateSectionToggleButtons();

    if (selectedSubjects.length === 0) {
        updateVisibleSubjectIssueMarkers(new Set(), new Set());
        timetableElement.innerHTML = renderSelectedSubjectList(selectedSubjects);
        return;
    }

    const conflicts = getSubjectConflicts(selectedSubjects);
    const conflictingSubjectIds = getConflictingSubjectIds(conflicts);
    const duplicateSelections = getDuplicateSubjectSelections(selectedSubjects);
    
    // Update header credits
    const creditContainer = document.querySelector("#ksb-header-credits");
    if (creditContainer) creditContainer.innerHTML = ksbRenderCreditCounter(selectedSubjects);


    // Offline banner
    const offlineContainer = document.querySelector("#ksb-offline-banner-container");
    if (offlineContainer) offlineContainer.innerHTML = ksbRenderOfflineBanner();

    const duplicateSubjectIds = new Set();
    duplicateSelections.forEach(group => group.subjects.forEach(s => duplicateSubjectIds.add(s.id)));
    updateVisibleSubjectIssueMarkers(conflictingSubjectIds, duplicateSubjectIds);

    // Update modal error badge
    const modalErrorContainer = document.querySelector("#ksb-modal-error-badge");
    if (modalErrorContainer) {
        const totalErrors = conflicts.length + duplicateSelections.length;
        modalErrorContainer.innerHTML = totalErrors > 0 
            ? `<div class="ksb-modal-error-badge" title="${totalErrors} conflicts/duplicates detected">
                ${ksbRenderIcon("warning")} ${totalErrors} Errors
               </div>`
            : "";
    }

    timetableElement.innerHTML = `
        ${renderConflictWarnings(conflicts, selectedSubjects)}
        ${renderDuplicateSelectionWarnings(duplicateSelections)}
        ${ksbRenderCategoryLegend()}
        ${showSubjectGroups ? renderSubjectGroupSummary(selectedSubjects) : ""}
        ${renderTimetableGrid(selectedSubjects, conflictingSubjectIds, duplicateSubjectIds)}
        ${renderUnplaceableSubjects(selectedSubjects)}
        ${showSelectedList ? renderSelectedSubjectList(selectedSubjects, conflictingSubjectIds) : ""}
    `;
    
    // Save to offline cache
    ksbSaveOfflineCache(selectedSubjects);
}


async function handlePanelAction(action, button) {
    const subjects = latestSelectedSubjects;
    if (action === 'copy-reg-codes') {
        const codes = [...new Set(subjects.map(s => ksbGetSubjectDisplayCode(s)))].filter(Boolean).join('\n');
        await copyTextToClipboard(codes);
        setCopyStatus("Codes copied!");
    } else if (action === 'copy-share-link') {
        const link = ksbEncodeShareLink(subjects);
        if (link) {
            await copyTextToClipboard(link);
            setCopyStatus("Share link copied!");
        }
    }
}

async function handleSwapAction(fromId, toSubject) {
    const subjects = await getSelectedSubjects();
    const filtered = subjects.filter(s => s.id !== fromId);
    const next = [...filtered, toSubject];
    await saveSelectedSubjects(next);
    syncAllVisibleCheckboxes(next);
    renderTimetable();
}

function renderSelectedSubjectList(subjects, conflictingSubjectIds = new Set()) {
    if (subjects.length === 0) {
        return `
        <div class="ksb-empty-state">
            Select class rows from the table to build your timetable.
        </div>
        `;
    }

    return `
    <div class="ksb-selected-subject-list">
        <div class="ksb-selected-list-title">${ksbRenderIcon("list")} Selected classes</div>
        ${subjects.map((subject) => renderSelectedSubjectCard(subject, conflictingSubjectIds)).join("")}
    </div>
    `;
}

function renderTimetableGrid(subjects, conflictingSubjectIds = new Set(), duplicateSubjectIds = new Set()) {
    const placeableSubjects = getPlaceableSubjects(subjects);

    return `
    <div class="ksb-timetable-section">
        <div class="ksb-timetable-scroll">
            <div class="ksb-timetable-grid">
                ${renderTimetableHeaderSlots()}
                ${renderTimetableDayRows(placeableSubjects, conflictingSubjectIds, duplicateSubjectIds)}
            </div>
        </div>
    </div>
    `;
}

function renderTimetableHeaderSlots() {
    return `
    <div class="ksb-timetable-header">
        <div class="ksb-timetable-corner">Day</div>
        ${getTimetableSlots()
            .filter((slot) => slot.minutes % 60 === 0)
            .map((slot) => {
                return `<div class="ksb-timetable-hour" style="grid-column: ${slot.columnStart} / span 2;">${ksbEscapeHtml(slot.label)}</div>`;
            })
            .join("")}
    </div>
    `;
}

function renderTimetableDayRows(subjects, conflictingSubjectIds = new Set(), duplicateSubjectIds = new Set()) {
    return KSB_TIMETABLE_DAYS.map((day) => {
        const daySubjects = subjects.filter((subject) => {
            return getSubjectGridPlacement(subject).day === day;
        });

        return `
        <div class="ksb-timetable-row">
            <div class="ksb-timetable-day">${ksbEscapeHtml(KSB_TIMETABLE_DAY_LABELS[day])}</div>
            ${getTimetableSlots().map(renderTimetableCell).join("")}
            ${daySubjects.map((subject) => renderTimetableSubjectBlock(subject, conflictingSubjectIds, duplicateSubjectIds)).join("")}
        </div>
        `;
    }).join("");
}

function renderTimetableCell(slot) {
    return `<div class="ksb-timetable-cell" style="grid-column: ${slot.columnStart};"></div>`;
}

function renderTimetableSubjectBlock(subject, conflictingSubjectIds = new Set(), duplicateSubjectIds = new Set()) {
    const placement = getSubjectGridPlacement(subject);
    const location = ksbGetSubjectDisplayLocation(subject);
    const subjectCode = ksbGetSubjectDisplayCode(subject);
    const catStyle = ksbGetCategoryStyle(subjectCode);
    const isTimeConflict = isSubjectConflicting(subject, conflictingSubjectIds);
    const isDuplicateConflict = duplicateSubjectIds.has(subject.id);
    const isConflict = isTimeConflict || isDuplicateConflict;
    const categoryClass = `ksb-cat-${ksbDetectCategory(subjectCode)}`;
    
    const style = `
        grid-column: ${placement.columnStart} / span ${placement.columnSpan};
        --ksb-block-bg: ${catStyle.bg};
        --ksb-block-border: ${catStyle.border};
        background: var(--ksb-block-bg);
        border-color: var(--ksb-block-border);
        border-left-color: var(--ksb-block-border);
    `;

    return `
    <div
        class="ksb-timetable-block ${categoryClass}${isConflict ? " ksb-timetable-block--conflict" : ""}"
        style="${style}"
        title="${ksbEscapeHtml(ksbGetSubjectDisplayName(subject))}${isConflict ? " (Conflict/Duplicate Selection)" : ""}"
    >
        ${isConflict ? `<div class="ksb-timetable-block-conflict-icon" title="${isTimeConflict ? 'Time Overlap' : 'Duplicate Course Code'}">${ksbRenderIcon("warning")}</div>` : ""}
        <div class="ksb-timetable-block-name">${ksbEscapeHtml(ksbGetSubjectDisplayName(subject))}</div>
        <div class="ksb-timetable-block-meta">
            ${ksbEscapeHtml(ksbGetSubjectDisplayClassType(subject))}
            ${subject.section ? ` | section(${ksbEscapeHtml(subject.section)})` : ""}
        </div>
        <div class="ksb-timetable-block-time">
            ${ksbEscapeHtml(ksbGetSubjectStartTime(subject))} - ${ksbEscapeHtml(ksbGetSubjectEndTime(subject))}
        </div>
        ${location ? `<div class="ksb-timetable-block-location">${ksbEscapeHtml(location)}</div>` : ""}
    </div>
    `;
}

function renderConflictWarnings(conflicts, selectedSubjects) {
    if (conflicts.length === 0) return "";

    return `
    <div class="ksb-conflict-warning">
        <div class="ksb-conflict-title">${ksbRenderIcon("warning")} Schedule conflicts</div>
        ${conflicts.map(c => `
            ${renderConflictItem(c)}
            ${ksbRenderAlternativeSuggestions(c, selectedSubjects)}
        `).join("")}
    </div>
    `;
}

function renderConflictItem(conflict) {
    const subjectDetails = conflict.subjects.map((subject) => {
        return [
            ksbGetSubjectDisplayCode(subject),
            ksbGetSubjectDisplayName(subject),
            subject.section ? `section(${subject.section})` : "",
            ksbGetSubjectDisplayClassType(subject),
        ].filter(Boolean).join(" ");
    });

    return `
    <div class="ksb-conflict-item">
        <strong>${ksbEscapeHtml(conflict.day)} ${ksbEscapeHtml(conflict.startTime)} - ${ksbEscapeHtml(conflict.endTime)}</strong>
        <span>${subjectDetails.map(ksbEscapeHtml).join(" vs ")}</span>
    </div>
    `;
}

function getSubjectGroupKey(subject) {
    const subjectCode = ksbNormalizeSubjectIdPart(ksbGetSubjectDisplayCode(subject));
    if (subjectCode) return subjectCode;

    const rawSubjectName = ksbNormalizeWhitespace(subject.subjectName || subject.name || "");
    const subjectName = ksbNormalizeSubjectIdPart(rawSubjectName);
    return subjectName || "";
}

function groupSubjectsByCode(subjects) {
    const groups = new Map();

    subjects.forEach((subject) => {
        const groupKey = getSubjectGroupKey(subject);
        if (!groupKey) return;

        if (!groups.has(groupKey)) {
            groups.set(groupKey, []);
        }

        groups.get(groupKey).push(subject);
    });

    return groups;
}

function getSubjectGroupSummary(subjects) {
    return [...groupSubjectsByCode(subjects).entries()]
        .map(([groupKey, groupSubjects]) => ({
            groupKey,
            subjects: groupSubjects,
            classTypes: getSelectedClassTypesForGroup(groupSubjects),
        }))
        .sort((a, b) => {
            const firstLabel = ksbGetSubjectDisplayCode(a.subjects[0]) || ksbGetSubjectDisplayName(a.subjects[0]);
            const secondLabel = ksbGetSubjectDisplayCode(b.subjects[0]) || ksbGetSubjectDisplayName(b.subjects[0]);
            return firstLabel.localeCompare(secondLabel);
        });
}

function getSelectedClassTypesForGroup(groupSubjects) {
    return [...new Set(groupSubjects.map(normalizeSubjectClassTypeKey))];
}

function getDuplicateSubjectSelections(subjects) {
    const duplicates = [];

    groupSubjectsByCode(subjects).forEach((groupSubjects) => {
        const subjectsByClassType = new Map();

        groupSubjects.forEach((subject) => {
            const classType = normalizeSubjectClassTypeKey(subject);
            if (!subjectsByClassType.has(classType)) {
                subjectsByClassType.set(classType, []);
            }

            subjectsByClassType.get(classType).push(subject);
        });

        subjectsByClassType.forEach((sameTypeSubjects, classType) => {
            if (sameTypeSubjects.length < 2) return;
            if (!hasDuplicateSelectionDifference(sameTypeSubjects)) return;

            duplicates.push({
                id: [
                    getSubjectGroupKey(sameTypeSubjects[0]),
                    classType,
                    ...sameTypeSubjects.map((subject) => subject.id || ""),
                ].join("|"),
                classType,
                subjects: sameTypeSubjects,
            });
        });
    });

    return duplicates;
}

function hasDuplicateSelectionDifference(subjects) {
    const signatures = new Set(
        subjects.map((subject) => {
            return [
                ksbNormalizeSubjectIdPart(subject.section),
                ksbNormalizeSubjectIdPart(ksbGetSubjectStartTime(subject)),
                ksbNormalizeSubjectIdPart(ksbGetSubjectEndTime(subject)),
            ].join("|");
        })
    );

    return signatures.size > 1;
}

function normalizeSubjectClassTypeKey(subject) {
    const classType = subject.classType || subject.type || "unknown";
    const labels = {
        theory: "theory",
        practical: "practical",
        seminar: "seminar",
        "ทฤษฎี": "theory",
        "ปฏิบัติ": "practical",
        "สัมมนา": "seminar",
        unknown: "unknown",
    };

    return labels[classType] || "unknown";
}

function renderSubjectGroupSummary(subjects) {
    const groupSummaries = getSubjectGroupSummary(subjects);
    if (groupSummaries.length === 0) return "";

    return `
    <div class="ksb-subject-group-summary">
        <div class="ksb-subject-group-title">${ksbRenderIcon("groups")} Subject groups</div>
        ${groupSummaries.map(renderSubjectGroup).join("")}
    </div>
    `;
}

function renderSubjectGroup(groupSummary) {
    const representativeSubject = groupSummary.subjects[0];
    const subjectCode = ksbGetSubjectDisplayCode(representativeSubject);
    const subjectName = ksbGetSubjectDisplayName(representativeSubject);
    const groupHints = getSubjectGroupHints(groupSummary);

    return `
    <div class="ksb-subject-group">
        <div class="ksb-subject-group-header">
            <strong>${ksbEscapeHtml(subjectCode || subjectName)}</strong>
            ${subjectCode ? `<span>${ksbEscapeHtml(subjectName)}</span>` : ""}
            <em>${ksbEscapeHtml(String(groupSummary.subjects.length))} selected component${groupSummary.subjects.length === 1 ? "" : "s"}</em>
        </div>
        <div class="ksb-subject-group-components">
            ${groupSummary.subjects.map(renderSubjectGroupComponent).join("")}
        </div>
        ${groupHints.map((hint) => `<div class="ksb-subject-group-hint">${ksbEscapeHtml(hint)}</div>`).join("")}
    </div>
    `;
}

function renderSubjectGroupComponent(subject) {
    const details = [
        ksbGetSubjectDisplayClassType(subject),
        subject.section ? `section(${subject.section})` : "",
        ksbGetSubjectDisplayDay(subject),
        [ksbGetSubjectStartTime(subject), ksbGetSubjectEndTime(subject)].filter(Boolean).join(" - "),
    ].filter(Boolean);

    return `<div class="ksb-subject-group-component">${details.map(ksbEscapeHtml).join(" | ")}</div>`;
}

function getSubjectGroupHints(groupSummary) {
    const selectedClassTypes = new Set(groupSummary.classTypes);
    const hints = [];

    if (selectedClassTypes.has("practical") && !selectedClassTypes.has("theory")) {
        hints.push("Practical selected without theory. Check whether this subject also requires a theory section.");
    }

    if (
        selectedClassTypes.has("theory") &&
        !selectedClassTypes.has("practical") &&
        !selectedClassTypes.has("seminar")
    ) {
        hints.push("Theory selected. If this subject has practical/seminar rows, select those too if required.");
    }

    if (selectedClassTypes.has("practical")) {
        hints.push("Practical section mapping may depend on department rules. Verify before finalizing.");
    }

    return hints;
}

function renderDuplicateSelectionWarnings(duplicates) {
    if (duplicates.length === 0) return "";

    return `
    <div class="ksb-duplicate-warning">
        <div class="ksb-duplicate-title">${ksbRenderIcon("warning")} Multiple sections of same course</div>
        ${duplicates.map(renderDuplicateSelectionItem).join("")}
    </div>
    `;
}

function renderDuplicateSelectionItem(duplicate) {
    const representativeSubject = duplicate.subjects[0];
    const duplicateDetails = duplicate.subjects.map((subject) => {
        return [
            subject.section ? `section(${subject.section})` : "",
            ksbGetSubjectDisplayDay(subject),
            [ksbGetSubjectStartTime(subject), ksbGetSubjectEndTime(subject)].filter(Boolean).join(" | "),
        ].filter(Boolean).join(" | ");
    });

    return `
    <div class="ksb-duplicate-item">
        <strong>${ksbEscapeHtml(ksbGetSubjectDisplayCode(representativeSubject) || ksbGetSubjectDisplayName(representativeSubject))}</strong>
        <span>You selected multiple ${ksbEscapeHtml(ksbGetSubjectDisplayClassType(representativeSubject))} sections for the same subject. This may be intentional, but usually you only need one.</span>
        <em>${duplicateDetails.map(ksbEscapeHtml).join(" vs ")}</em>
    </div>
    `;
}

async function handleCopyAction(copyType) {
    const selectedSubjects = latestSelectedSubjects;
    if (selectedSubjects.length === 0) {
        setCopyStatus("Nothing to copy");
        return;
    }

    const copyConfig = {
        classes: {
            text: buildSelectedClassesText(selectedSubjects),
            successMessage: "Copied selected classes",
        },
        timetable: {
            text: buildTimetableSummaryText(selectedSubjects),
            successMessage: "Copied timetable summary",
        },
        groups: {
            text: buildSubjectGroupsText(selectedSubjects),
            successMessage: "Copied subject groups",
        },
        codes: {
            text: [...new Set(selectedSubjects.map((subject) => ksbGetSubjectDisplayCode(subject)))]
                .filter(Boolean)
                .join("\n"),
            successMessage: "Copied registration codes",
        },
    };
    const config = copyConfig[copyType];

    if (!config || !ksbNormalizeWhitespace(config.text)) {
        setCopyStatus("Nothing to copy");
        return;
    }

    try {
        await copyTextToClipboard(config.text);
        setCopyStatus(config.successMessage);
    } catch {
        setCopyStatus("Copy failed");
    }
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";

    document.body.appendChild(textarea);
    textarea.select();

    try {
        const copied = document.execCommand("copy");
        if (!copied) throw new Error("Clipboard copy command failed");
    } finally {
        textarea.remove();
    }
}

function setCopyStatus(message) {
    const statusElement = document.querySelector("#ksb-copy-status");
    if (!statusElement) return;

    statusElement.textContent = message;
    clearCopyStatusLater();
}

function clearCopyStatusLater() {
    window.clearTimeout(copyStatusTimer);
    copyStatusTimer = window.setTimeout(() => {
        const statusElement = document.querySelector("#ksb-copy-status");
        if (statusElement) statusElement.textContent = "";
    }, 2500);
}

function buildSelectedClassesText(subjects) {
    return [
        "KMITL Schedule Builder - Selected Classes",
        "",
        ...subjects.flatMap((subject, index) => [
            `${index + 1}. ${formatSelectedClassHeading(subject)}`,
            ...formatSubjectDetailedText(subject).map((line) => `   ${line}`),
            "",
        ]),
    ].join("\n").trim();
}

function buildTimetableSummaryText(subjects) {
    const subjectsByDay = getSubjectsSortedByDayAndTime(subjects);
    const conflicts = getSubjectConflicts(subjects);
    const unplaceableSubjects = getUnplaceableSubjects(subjects);
    const lines = ["KMITL Schedule Builder - Timetable Summary", ""];

    KSB_TIMETABLE_DAYS.forEach((day) => {
        const daySubjects = subjectsByDay.get(day) || [];

        lines.push(KSB_TIMETABLE_DAY_LABELS[day]);

        if (daySubjects.length === 0) {
            lines.push("- No selected classes");
        } else {
            daySubjects.forEach((subject) => {
                lines.push(`- ${formatSubjectTextLine(subject)}`);
            });
        }

        lines.push("");
    });

    if (conflicts.length > 0) {
        lines.push("Conflicts:");
        conflicts.forEach((conflict) => {
            lines.push(`- ${formatConflictText(conflict)}`);
        });
        lines.push("");
    }

    if (unplaceableSubjects.length > 0) {
        lines.push("Unplaceable:");
        unplaceableSubjects.forEach((subject) => {
            lines.push(`- ${formatUnplaceableText(subject)}`);
        });
    }

    return lines.join("\n").trim();
}

function buildSubjectGroupsText(subjects) {
    const groupSummaries = getSubjectGroupSummary(subjects);
    if (groupSummaries.length === 0) return "";

    return [
        "KMITL Schedule Builder - Subject Groups",
        "",
        ...groupSummaries.flatMap((groupSummary) => {
            const representativeSubject = groupSummary.subjects[0];
            const subjectHeader = [
                ksbGetSubjectDisplayCode(representativeSubject),
                ksbGetSubjectDisplayName(representativeSubject),
            ].filter(Boolean).join(" ");

            return [
                subjectHeader,
                ...groupSummary.subjects.map((subject) => `- ${formatSubjectGroupTextLine(subject)}`),
                "",
            ];
        }),
    ].join("\n").trim();
}

function getSubjectsSortedByDayAndTime(subjects) {
    const subjectsByDay = new Map(KSB_TIMETABLE_DAYS.map((day) => [day, []]));

    getPlaceableSubjects(subjects).forEach((subject) => {
        const placement = getSubjectGridPlacement(subject);
        subjectsByDay.get(placement.day).push(subject);
    });

    KSB_TIMETABLE_DAYS.forEach((day) => {
        subjectsByDay.get(day).sort((firstSubject, secondSubject) => {
            return (
                ksbTimeToMinutes(ksbGetSubjectStartTime(firstSubject)) -
                ksbTimeToMinutes(ksbGetSubjectStartTime(secondSubject))
            );
        });
    });

    return subjectsByDay;
}

function formatSelectedClassHeading(subject) {
    return [
        ksbGetSubjectDisplayCode(subject),
        ksbGetSubjectDisplayName(subject),
    ].filter(Boolean).join(" ");
}

function formatSubjectTextLine(subject) {
    return [
        [ksbGetSubjectStartTime(subject), ksbGetSubjectEndTime(subject)].filter(Boolean).join(" - "),
        [
            ksbGetSubjectDisplayCode(subject),
            ksbGetSubjectDisplayName(subject),
        ].filter(Boolean).join(" "),
        ksbGetSubjectDisplayClassType(subject),
        subject.section ? `section(${subject.section})` : "",
        ksbGetSubjectDisplayLocation(subject),
    ].filter(Boolean).join(" | ");
}

function formatSubjectDetailedText(subject) {
    return [
        `Type: ${ksbGetSubjectDisplayClassType(subject)}`,
        subject.section ? `Section: ${subject.section}` : "",
        `Time: ${[ksbGetSubjectDisplayDay(subject), [ksbGetSubjectStartTime(subject), ksbGetSubjectEndTime(subject)].filter(Boolean).join(" - ")].filter(Boolean).join(" ") || "Unknown"}`,
        ksbGetSubjectDisplayLocation(subject) ? `Room: ${ksbGetSubjectDisplayLocation(subject)}` : "",
        subject.teacher ? `Teacher: ${subject.teacher}` : "",
    ].filter(Boolean);
}

function formatSubjectGroupTextLine(subject) {
    return [
        ksbGetSubjectDisplayClassType(subject),
        subject.section ? `section(${subject.section})` : "",
        ksbGetSubjectDisplayDay(subject),
        [ksbGetSubjectStartTime(subject), ksbGetSubjectEndTime(subject)].filter(Boolean).join(" - "),
    ].filter(Boolean).join(" | ");
}

function formatConflictText(conflict) {
    const conflictSubjects = conflict.subjects.map((subject) => {
        return [
            ksbGetSubjectDisplayName(subject),
            subject.section ? `section(${subject.section})` : "",
        ].filter(Boolean).join(" ");
    });

    return `${conflict.day} ${conflict.startTime} - ${conflict.endTime} | ${conflictSubjects.join(" vs ")}`;
}

function formatUnplaceableText(subject) {
    return [
        ksbGetSubjectDisplayName(subject),
        subject.section ? `section(${subject.section})` : "",
        [ksbGetSubjectDisplayDay(subject), [ksbGetSubjectStartTime(subject), ksbGetSubjectEndTime(subject)].filter(Boolean).join(" - ")].filter(Boolean).join(" ") || "Unknown day/time",
    ].filter(Boolean).join(" | ");
}

function renderUnplaceableSubjects(subjects) {
    const unplaceableSubjects = getUnplaceableSubjects(subjects);
    if (unplaceableSubjects.length === 0) return "";

    return `
    <div class="ksb-unplaceable-subjects">
        <div class="ksb-unplaceable-title">${ksbRenderIcon("info")} Cannot place on timetable</div>
        ${unplaceableSubjects.map(renderUnplaceableSubject).join("")}
    </div>
    `;
}

function renderUnplaceableSubject(subject) {
    const details = [
        ksbGetSubjectDisplayDay(subject),
        [ksbGetSubjectStartTime(subject), ksbGetSubjectEndTime(subject)].filter(Boolean).join(" - "),
        subject.section ? `section(${subject.section})` : "",
    ].filter(Boolean);

    return `
    <div class="ksb-unplaceable-subject">
        <strong>${ksbEscapeHtml(ksbGetSubjectDisplayName(subject))}</strong>
        ${details.length ? `<span>${details.map(ksbEscapeHtml).join(" | ")}</span>` : ""}
    </div>
    `;
}

function getTimetableSlots() {
    const slots = [];

    for (
        let minutes = KSB_TIMETABLE_START_MINUTE;
        minutes < KSB_TIMETABLE_END_MINUTE;
        minutes += KSB_TIMETABLE_SLOT_MINUTES
    ) {
        slots.push({
            minutes,
            label: ksbMinutesToTimeLabel(minutes),
            columnStart:
                KSB_TIMETABLE_FIRST_SLOT_COLUMN +
                (minutes - KSB_TIMETABLE_START_MINUTE) / KSB_TIMETABLE_SLOT_MINUTES,
        });
    }

    return slots;
}

function getPlaceableSubjects(subjects) {
    return subjects.filter(isSubjectPlaceable);
}

function getUnplaceableSubjects(subjects) {
    return subjects.filter((subject) => !isSubjectPlaceable(subject));
}

function isSubjectPlaceable(subject) {
    return getSubjectGridPlacement(subject).canPlace;
}

function getSubjectTimeRange(subject) {
    const placement = getSubjectGridPlacement(subject);
    if (!placement.canPlace) return null;

    const startMinutes = ksbTimeToMinutes(ksbGetSubjectStartTime(subject));
    const endMinutes = ksbTimeToMinutes(ksbGetSubjectEndTime(subject));
    if (startMinutes === null || endMinutes === null) return null;

    return {
        day: placement.day,
        startMinutes,
        endMinutes,
        startTime: ksbGetSubjectStartTime(subject),
        endTime: ksbGetSubjectEndTime(subject),
    };
}

function doTimeRangesOverlap(a, b) {
    if (!a || !b) return false;
    if (a.day !== b.day) return false;

    return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

function getSubjectConflicts(subjects) {
    const placeableSubjects = getPlaceableSubjects(subjects);
    const conflicts = [];

    for (let firstIndex = 0; firstIndex < placeableSubjects.length; firstIndex += 1) {
        for (
            let secondIndex = firstIndex + 1;
            secondIndex < placeableSubjects.length;
            secondIndex += 1
        ) {
            const firstSubject = placeableSubjects[firstIndex];
            const secondSubject = placeableSubjects[secondIndex];
            const firstRange = getSubjectTimeRange(firstSubject);
            const secondRange = getSubjectTimeRange(secondSubject);

            if (!doTimeRangesOverlap(firstRange, secondRange)) continue;

            const startMinutes = Math.min(firstRange.startMinutes, secondRange.startMinutes);
            const endMinutes = Math.max(firstRange.endMinutes, secondRange.endMinutes);

            conflicts.push({
                id: [firstSubject.id, secondSubject.id].sort().join("|"),
                day: firstRange.day,
                startTime: ksbMinutesToTimeLabel(startMinutes),
                endTime: ksbMinutesToTimeLabel(endMinutes),
                subjects: [firstSubject, secondSubject],
            });
        }
    }

    return conflicts;
}

function getConflictingSubjectIds(conflicts) {
    const subjectIds = new Set();

    conflicts.forEach((conflict) => {
        conflict.subjects.forEach((subject) => {
            if (subject.id) subjectIds.add(subject.id);
        });
    });

    return subjectIds;
}

function isSubjectConflicting(subject, conflictingSubjectIds) {
    return Boolean(subject.id && conflictingSubjectIds.has(subject.id));
}

function getSubjectGridPlacement(subject) {
    const day = ksbNormalizeDayKey(subject.day || subject.dayText);
    const startMinutes = ksbTimeToMinutes(ksbGetSubjectStartTime(subject));
    const endMinutes = ksbTimeToMinutes(ksbGetSubjectEndTime(subject));

    if (
        !KSB_TIMETABLE_DAYS.includes(day) ||
        startMinutes === null ||
        endMinutes === null ||
        endMinutes <= startMinutes ||
        startMinutes < KSB_TIMETABLE_START_MINUTE ||
        endMinutes > KSB_TIMETABLE_END_MINUTE ||
        (startMinutes - KSB_TIMETABLE_START_MINUTE) % KSB_TIMETABLE_SLOT_MINUTES !== 0 ||
        (endMinutes - startMinutes) % KSB_TIMETABLE_SLOT_MINUTES !== 0
    ) {
        return { canPlace: false };
    }

    return {
        canPlace: true,
        day,
        columnStart:
            KSB_TIMETABLE_FIRST_SLOT_COLUMN +
            (startMinutes - KSB_TIMETABLE_START_MINUTE) / KSB_TIMETABLE_SLOT_MINUTES,
        columnSpan: (endMinutes - startMinutes) / KSB_TIMETABLE_SLOT_MINUTES,
    };
}



function renderSelectedSubjectCard(subject, conflictingSubjectIds = new Set()) {
    const subjectId = ksbEscapeHtml(subject.id || "");
    const code = ksbGetSubjectDisplayCode(subject);
    const metaParts = getSubjectCardMetaParts(subject)
        .map(ksbEscapeHtml)
        .join(" | ");
    const location = ksbGetSubjectDisplayLocation(subject);
    const teacher = ksbNormalizeWhitespace(subject.teacher);
    const conflictClass = isSubjectConflicting(subject, conflictingSubjectIds)
        ? " ksb-selected-subject--conflict"
        : "";
    const categoryClass = `ksb-cat-${ksbDetectCategory(code)}`;

    return `
    <div class="ksb-selected-subject ${categoryClass}${conflictClass}" data-ksb-selected-subject-id="${subjectId}">
        <div class="ksb-selected-subject-top">
            <div class="ksb-selected-subject-title">
                <div class="ksb-selected-subject-name">${ksbEscapeHtml(ksbGetSubjectDisplayName(subject))}</div>
                ${code ? `<div class="ksb-selected-subject-code">${ksbEscapeHtml(code)}</div>` : ""}
            </div>
            <button
                class="ksb-remove-subject-button"
                type="button"
                data-ksb-remove-subject-id="${subjectId}"
                aria-label="Remove selected subject"
            >
                Remove
            </button>
        </div>
        ${metaParts ? `<div class="ksb-selected-subject-meta">${metaParts}</div>` : ""}
        ${location ? `<div class="ksb-selected-subject-room">${ksbEscapeHtml(location)}</div>` : ""}
        ${teacher ? `<div class="ksb-selected-subject-teacher">${ksbEscapeHtml(teacher)}</div>` : ""}
    </div>
    `;
}

async function removeSelectedSubject(subjectId) {
    if (!subjectId) return;

    const selectedSubjects = await getSelectedSubjects();
    const nextSubjects = selectedSubjects.filter((subject) => subject.id !== subjectId);

    await saveSelectedSubjects(nextSubjects);
    syncVisibleCheckboxState(subjectId, false);
    await renderSelectedSubjectPanel();
}

function syncVisibleCheckboxState(subjectId, checked) {
    document.querySelectorAll(".ksb-subject-checkbox").forEach((checkbox) => {
        if (checkbox.dataset.subjectId === subjectId) {
            checkbox.checked = checked;
        }
    });
}

function syncAllVisibleCheckboxes(selectedSubjects) {
    document.querySelectorAll(".ksb-subject-checkbox").forEach((checkbox) => {
        checkbox.checked = isSubjectSelected(checkbox.dataset.subjectId, selectedSubjects);
    });
}

function updateVisibleSubjectIssueMarkersForSubjects(selectedSubjects) {
    const conflicts = getSubjectConflicts(selectedSubjects);
    const duplicateSelections = getDuplicateSubjectSelections(selectedSubjects);
    const conflictingSubjectIds = getConflictingSubjectIds(conflicts);
    const duplicateSubjectIds = new Set();

    duplicateSelections.forEach((group) => {
        group.subjects.forEach((subject) => {
            if (subject.id) duplicateSubjectIds.add(subject.id);
        });
    });

    updateVisibleSubjectIssueMarkers(conflictingSubjectIds, duplicateSubjectIds);
}

function updateVisibleSubjectIssueMarkers(conflictingSubjectIds, duplicateSubjectIds) {
    document.querySelectorAll(".ksb-subject-checkbox").forEach((checkbox) => {
        const subjectId = checkbox.dataset.subjectId || "";
        const wrapper = checkbox.closest(KSB_CHECKBOX_WRAPPER_SELECTOR);
        const sourceElement = checkbox.closest(`[${KSB_EXTENSION_FLAG}]`);
        if (!(wrapper instanceof HTMLElement) || !(sourceElement instanceof HTMLElement)) return;

        clearSubjectIssueMarker(wrapper, sourceElement);

        const isConflict = conflictingSubjectIds.has(subjectId);
        const isDuplicate = duplicateSubjectIds.has(subjectId);
        if (!isConflict && !isDuplicate) return;

        const issueTitle = isConflict
            ? "This selected class overlaps another selected class."
            : "This selected class duplicates another selected section for the same course.";

        wrapper.classList.add("ksb-checkbox-wrapper--issue");
        sourceElement.classList.add("ksb-subject-source--issue");

        if (isConflict) {
            wrapper.classList.add("ksb-checkbox-wrapper--conflict");
            sourceElement.classList.add("ksb-subject-source--conflict");
        }

        if (isDuplicate) {
            wrapper.classList.add("ksb-checkbox-wrapper--duplicate");
            sourceElement.classList.add("ksb-subject-source--duplicate");
        }

        if (!sourceElement.dataset.ksbOriginalTitle) {
            sourceElement.dataset.ksbOriginalTitle = sourceElement.getAttribute("title") || "";
        }
        sourceElement.setAttribute("title", issueTitle);

        updateCheckboxIssueLabel(wrapper, "Add");
        updateCheckboxIssueBadge(wrapper, isConflict ? "Conflict" : "Duplicate", issueTitle);
    });
}

function clearSubjectIssueMarker(wrapper, sourceElement) {
    wrapper.classList.remove(
        "ksb-checkbox-wrapper--issue",
        "ksb-checkbox-wrapper--conflict",
        "ksb-checkbox-wrapper--duplicate"
    );
    sourceElement.classList.remove(
        "ksb-subject-source--issue",
        "ksb-subject-source--conflict",
        "ksb-subject-source--duplicate"
    );

    updateCheckboxIssueLabel(wrapper, "Add");
    wrapper.querySelectorAll(".ksb-checkbox-issue-badge").forEach((badge) => badge.remove());

    const previousBadge = wrapper.previousElementSibling;
    if (previousBadge?.classList.contains("ksb-checkbox-issue-badge")) {
        previousBadge.remove();
    }

    if (sourceElement.dataset.ksbOriginalTitle !== undefined) {
        const originalTitle = sourceElement.dataset.ksbOriginalTitle;
        if (originalTitle) {
            sourceElement.setAttribute("title", originalTitle);
        } else {
            sourceElement.removeAttribute("title");
        }
        delete sourceElement.dataset.ksbOriginalTitle;
    }
}

function updateCheckboxIssueLabel(wrapper, label) {
    let labelElement = wrapper.querySelector(".ksb-checkbox-label");

    if (!labelElement) {
        labelElement = document.createElement("span");
        labelElement.className = "ksb-checkbox-label";
        labelElement.textContent = "Add";
        wrapper.appendChild(labelElement);
    }

    labelElement.textContent = label;
}

function updateCheckboxIssueBadge(wrapper, label, title) {
    let badge = wrapper.previousElementSibling;
    if (!badge?.classList.contains("ksb-checkbox-issue-badge")) {
        badge = null;
    }

    if (!badge) {
        badge = document.createElement("span");
        badge.className = "ksb-checkbox-issue-badge";
        wrapper.insertAdjacentElement("beforebegin", badge);
    }

    badge.innerHTML = `${ksbRenderIcon("warning")} <span>${ksbEscapeHtml(label)}</span>`;
    badge.setAttribute("title", title);
    badge.setAttribute("aria-label", title);
}

function getSubjectCardMetaParts(subject) {
    const timeRange = [ksbGetSubjectStartTime(subject), ksbGetSubjectEndTime(subject)]
        .filter(Boolean)
        .join(" - ");

    return [
        subject.credits,
        subject.section ? `section(${subject.section})` : "",
        ksbGetSubjectDisplayClassType(subject),
        ksbGetSubjectDisplayDay(subject),
        timeRange,
    ].filter(Boolean);
}



async function handleDownloadPngAction() {
    const selectedSubjects = latestSelectedSubjects;
    if (selectedSubjects.length === 0) {
        setCopyStatus("Nothing to download");
        return;
    }

    try {
        const canvas = buildTimetablePngCanvas(selectedSubjects);
        const filename = getTimetablePngFilename();
        downloadCanvasAsPng(canvas, filename);
        setCopyStatus("PNG downloaded");
    } catch (error) {
        console.error("[KSB] Failed to download timetable PNG", error);
        setCopyStatus("PNG download failed");
    }
}

function getTimetablePngFilename() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    return `kmitl-schedule-builder-${year}${month}${day}-${hours}${minutes}.png`;
}

function downloadCanvasAsPng(canvas, filename) {
    canvas.toBlob((blob) => {
        if (!blob) throw new Error("Failed to create blob from canvas");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, "image/png");
}

function getTimetableCanvasLayout(subjects) {
    const scale = 2;
    const margin = 32;
    const titleHeight = 56;
    const headerHeight = 36;
    const dayLabelWidth = 72;
    const slotWidth = 48;
    const rowHeight = 92;

    const slots = getCanvasTimeSlots();
    const unplaceableSubjects = getUnplaceableSubjects(subjects);

    const unplaceableHeightPerSubject = 24;
    let unplaceableSectionHeight = 0;
    if (unplaceableSubjects.length > 0) {
        unplaceableSectionHeight = 40 + (unplaceableSubjects.length * unplaceableHeightPerSubject);
    }

    const logicalWidth = margin * 2 + dayLabelWidth + slots.length * slotWidth;
    const logicalHeight = margin * 2 + titleHeight + headerHeight + KSB_TIMETABLE_DAYS.length * rowHeight + unplaceableSectionHeight;

    return {
        scale,
        margin,
        titleHeight,
        headerHeight,
        dayLabelWidth,
        slotWidth,
        rowHeight,
        logicalWidth,
        logicalHeight,
        slots,
        unplaceableSubjects
    };
}

function getCanvasTimeSlots() {
    const slots = [];
    for (let minutes = KSB_TIMETABLE_START_MINUTE; minutes < KSB_TIMETABLE_END_MINUTE; minutes += KSB_TIMETABLE_SLOT_MINUTES) {
        slots.push({
            minutes,
            label: minutes % 60 === 0 ? ksbMinutesToTimeLabel(minutes) : ""
        });
    }
    return slots;
}

function buildTimetablePngCanvas(subjects) {
    const layout = getTimetableCanvasLayout(subjects);
    const canvas = document.createElement("canvas");
    canvas.width = layout.logicalWidth * layout.scale;
    canvas.height = layout.logicalHeight * layout.scale;

    const ctx = canvas.getContext("2d");
    ctx.scale(layout.scale, layout.scale);

    drawTimetableBackground(ctx, layout);
    drawTimetableHeaders(ctx, layout, subjects.length);
    drawTimetableGridLines(ctx, layout);
    
    const conflicts = getSubjectConflicts(subjects);
    const conflictingSubjectIds = getConflictingSubjectIds(conflicts);
    drawTimetableBlocks(ctx, layout, subjects, conflictingSubjectIds);
    
    if (layout.unplaceableSubjects.length > 0) {
        drawTimetableUnplaceable(ctx, layout);
    }

    return canvas;
}

function drawTimetableBackground(ctx, layout) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, layout.logicalWidth, layout.logicalHeight);
}

function drawTimetableHeaders(ctx, layout, selectedCount) {
    ctx.fillStyle = "#f15a24";
    ctx.font = "bold 20px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("KMITL Schedule Builder", layout.margin, layout.margin);

    const titleWidth = ctx.measureText("KMITL Schedule Builder ").width;
    ctx.fillStyle = "#999999";
    ctx.font = "10px Arial, sans-serif";
    ctx.fillText("Made by twtae & His beloved AI", layout.margin + titleWidth, layout.margin + 10);

    ctx.fillStyle = "#666666";
    ctx.font = "14px Arial, sans-serif";
    ctx.fillText(`Selected: ${selectedCount}`, layout.margin, layout.margin + 28);
}

function drawTimetableGridLines(ctx, layout) {
    const startX = layout.margin + layout.dayLabelWidth;
    const startY = layout.margin + layout.titleHeight;
    const gridWidth = layout.slots.length * layout.slotWidth;
    const gridHeight = KSB_TIMETABLE_DAYS.length * layout.rowHeight;

    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(layout.margin, startY, layout.dayLabelWidth + gridWidth, layout.headerHeight);

    ctx.strokeStyle = "#dedede";
    ctx.lineWidth = 1;
    ctx.strokeRect(layout.margin, startY, layout.dayLabelWidth + gridWidth, layout.headerHeight + gridHeight);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#c9471c";
    ctx.font = "bold 12px Arial, sans-serif";
    ctx.fillText("Day", layout.margin + layout.dayLabelWidth / 2, startY + layout.headerHeight / 2);

    for (let i = 0; i < KSB_TIMETABLE_DAYS.length; i++) {
        const day = KSB_TIMETABLE_DAYS[i];
        const rowY = startY + layout.headerHeight + i * layout.rowHeight;
        
        ctx.fillStyle = i % 2 === 0 ? "#ffffff" : "#fafafa";
        ctx.fillRect(startX, rowY, gridWidth, layout.rowHeight);
        
        ctx.fillStyle = "#f7f7f7";
        ctx.fillRect(layout.margin, rowY, layout.dayLabelWidth, layout.rowHeight);

        ctx.beginPath();
        ctx.moveTo(layout.margin, rowY);
        ctx.lineTo(layout.margin + layout.dayLabelWidth + gridWidth, rowY);
        ctx.stroke();

        ctx.fillStyle = "#c9471c";
        ctx.font = "bold 12px Arial, sans-serif";
        ctx.fillText(KSB_TIMETABLE_DAY_LABELS[day], layout.margin + layout.dayLabelWidth / 2, rowY + layout.rowHeight / 2);
    }

    for (let i = 0; i <= layout.slots.length; i++) {
        const colX = startX + i * layout.slotWidth;
        
        ctx.beginPath();
        ctx.moveTo(colX, startY + layout.headerHeight);
        ctx.lineTo(colX, startY + layout.headerHeight + gridHeight);
        ctx.stroke();

        if (i % 2 === 0) {
            ctx.beginPath();
            ctx.moveTo(colX, startY);
            ctx.lineTo(colX, startY + layout.headerHeight);
            ctx.stroke();
        }

        if (i < layout.slots.length) {
            const slot = layout.slots[i];
            if (slot.label) {
                ctx.fillStyle = "#444444";
                ctx.font = "bold 11px Arial, sans-serif";
                ctx.fillText(slot.label, colX + layout.slotWidth, startY + layout.headerHeight / 2);
            }
        }
    }
}

function drawTimetableBlocks(ctx, layout, subjects, conflictingSubjectIds) {
    const placeableSubjects = getPlaceableSubjects(subjects);

    placeableSubjects.forEach(subject => {
        const placement = getSubjectCanvasPlacement(subject, layout);
        if (!placement) return;

        const isConflict = isSubjectConflicting(subject, conflictingSubjectIds);
        
        const x = placement.x + 3;
        const y = placement.y + 5;
        const w = placement.width - 6;
        const h = layout.rowHeight - 10;

        ctx.fillStyle = isConflict ? "#fffbeb" : "#fff3ed";
        ctx.fillRect(x, y, w, h);

        ctx.strokeStyle = isConflict ? "#d97706" : "#f15a24";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);

        ctx.fillStyle = isConflict ? "#d97706" : "#f15a24";
        ctx.fillRect(x, y, 4, h);

        const textX = x + 10;
        let textY = y + 8;
        
        ctx.fillStyle = "#333333";
        ctx.font = "bold 11px Arial, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        
        const title = ksbGetSubjectDisplayName(subject);
        textY = drawWrappedText(ctx, title, textX, textY, w - 16, 14, 2);
        
        textY += 4;
        
        ctx.fillStyle = "#666666";
        ctx.font = "10px Arial, sans-serif";
        
        const typeAndSection = [
            ksbGetSubjectDisplayClassType(subject),
            subject.section ? `section(${subject.section})` : ""
        ].filter(Boolean).join(" | ");
        ctx.fillText(typeAndSection, textX, textY);
        textY += 14;

        const timeRange = `${ksbGetSubjectStartTime(subject)} - ${ksbGetSubjectEndTime(subject)}`;
        ctx.fillText(timeRange, textX, textY);
        textY += 14;

        const location = ksbGetSubjectDisplayLocation(subject);
        if (location) {
            drawWrappedText(ctx, location, textX, textY, w - 16, 14, 1);
        }

        if (isConflict) {
            ctx.font = "bold 10px Arial, sans-serif";
            const tw = ctx.measureText("Conflict").width;
            const badgeX = x + w - tw - 12;
            const badgeY = y + 6;
            
            ctx.fillStyle = "#fffbeb";
            ctx.fillRect(badgeX, badgeY, tw + 8, 16);
            
            ctx.fillStyle = "#d97706";
            ctx.textBaseline = "middle";
            ctx.fillText("Conflict", badgeX + 4, badgeY + 8);
            ctx.textBaseline = "top";
        }
    });
}

function getSubjectCanvasPlacement(subject, layout) {
    const gridPlacement = getSubjectGridPlacement(subject);
    if (!gridPlacement.canPlace) return null;

    const dayIndex = KSB_TIMETABLE_DAYS.indexOf(gridPlacement.day);
    if (dayIndex === -1) return null;

    const startX = layout.margin + layout.dayLabelWidth;
    const startY = layout.margin + layout.titleHeight + layout.headerHeight;

    const colIndex = gridPlacement.columnStart - KSB_TIMETABLE_FIRST_SLOT_COLUMN;
    
    return {
        x: startX + colIndex * layout.slotWidth,
        y: startY + dayIndex * layout.rowHeight,
        width: gridPlacement.columnSpan * layout.slotWidth
    };
}

function drawTimetableUnplaceable(ctx, layout) {
    const startY = layout.margin + layout.titleHeight + layout.headerHeight + (KSB_TIMETABLE_DAYS.length * layout.rowHeight) + 24;
    
    ctx.fillStyle = "#c9471c";
    ctx.font = "bold 12px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Cannot place on timetable", layout.margin, startY);

    ctx.fillStyle = "#333333";
    let textY = startY + 20;
    
    layout.unplaceableSubjects.forEach(subject => {
        const details = [
            ksbGetSubjectDisplayDay(subject),
            [ksbGetSubjectStartTime(subject), ksbGetSubjectEndTime(subject)].filter(Boolean).join(" - "),
            subject.section ? `section(${subject.section})` : "",
        ].filter(Boolean).join(" | ");

        ctx.font = "bold 12px Arial, sans-serif";
        ctx.fillText(ksbGetSubjectDisplayName(subject), layout.margin, textY);
        
        if (details) {
            const titleWidth = ctx.measureText(ksbGetSubjectDisplayName(subject) + " ").width;
            ctx.font = "12px Arial, sans-serif";
            ctx.fillStyle = "#666666";
            ctx.fillText(details, layout.margin + titleWidth, textY);
            ctx.fillStyle = "#333333";
        }
        
        textY += 24;
    });
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = text.split(" ");
    let line = "";
    let lineCount = 0;
    let currentY = y;

    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + " ";
        const metrics = ctx.measureText(testLine);
        
        if (metrics.width > maxWidth && n > 0) {
            lineCount++;
            if (lineCount >= maxLines) {
                const ellipsisWidth = ctx.measureText("...").width;
                while (ctx.measureText(line).width + ellipsisWidth > maxWidth && line.length > 0) {
                    line = line.slice(0, -1);
                }
                ctx.fillText(line.trim() + "...", x, currentY);
                return currentY + lineHeight;
            }
            ctx.fillText(line, x, currentY);
            line = words[n] + " ";
            currentY += lineHeight;
        } else {
            line = testLine;
        }
    }
    
    if (lineCount < maxLines) {
        ctx.fillText(line, x, currentY);
        currentY += lineHeight;
    }

    return currentY;
}

init();
