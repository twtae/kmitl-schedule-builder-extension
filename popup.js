document.addEventListener('DOMContentLoaded', async () => {
    const statsDiv = document.getElementById('credit-summary');

    // Load credits if available
    const subjects = await ksbStorageGet(KSB_STORAGE_KEY) || [];
    if (subjects.length > 0) {
        statsDiv.innerHTML = `<strong>${subjects.length}</strong> subjects selected`;
    }

    // Initialize Dark Mode Toggle
    const darkToggle = document.getElementById('dark-mode-toggle');
    const isDark = await ksbStorageGet(DARK_MODE_STORAGE_KEY);
    
    darkToggle.checked = Boolean(isDark);
    if (isDark) {
        document.body.classList.add('dark');
    } else {
        document.body.classList.remove('dark');
    }

    darkToggle.addEventListener('change', async () => {
        const enabled = darkToggle.checked;
        await ksbStorageSet(DARK_MODE_STORAGE_KEY, enabled);
        if (enabled) {
            document.body.classList.add('dark');
        } else {
            document.body.classList.remove('dark');
        }
    });
});
