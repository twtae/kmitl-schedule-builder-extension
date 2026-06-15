## 0.4.0
- Add premium, site-wide dark mode support for `regis.reg.kmitl.ac.th`
- Inject styling immediately at `document_start` to prevent flash of light theme
- Enhance visual contrast and colors for Main Page, Pre-registration, Maintain Status, Payment, Questionnaire, and Timetable views
- Add a Dark Mode toggle switch inside the extension popup menu

## 0.3.1
- Mark selected classes that cause conflicts or duplicate-section warnings directly in the KMITL teaching table

## 0.3.0
- Add real-time conflict and duplicate error badges to the launcher and modal header
- Stabilize UI rendering to prevent input focus loss during state updates
- Simplify course color-coding into distinct "Gen-Ed" and "Major" categories
- Remove distracting pulse animations for a cleaner aesthetic
- Fix modal layering issue to correctly overlap the sidebar launcher
- Remove theme selection and standardize on the default light theme
- Consolidate export actions into a unified dropdown menu
- Remove legacy calendar sync features (Google Calendar, iCal)
- Improve Sharable Link reliability by switching to query parameter routing

## 0.2.0
- Add extension icons for Chrome extension list and toolbar display
- Limit Schedule Builder initialization to `https://regis.reg.kmitl.ac.th/#/teach_table`
- Clean up extension UI when navigating away from the teach table route
- Reinitialize safely when navigating back to the teach table route
- Detect SPA route changes that do not emit a normal hashchange event

## 0.1.0
- Add subject row selection
- Add timetable modal
- Add conflict detection
- Add copy exports
- Add PNG export
