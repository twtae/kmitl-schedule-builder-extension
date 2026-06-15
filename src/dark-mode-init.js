(function() {
    const key = "kmitl_schedule_builder_dark_mode_enabled";
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([key], function(result) {
            if (result && result[key]) {
                document.documentElement.classList.add("ksb-dark-mode");
            }
        });
    }
})();
