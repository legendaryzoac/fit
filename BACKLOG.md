# Backlog

User-reported requests, logged 2026-07-03. Not yet scheduled.
(The original bugs/polish batch — baseline label, hover underlines, chip-row
scrollbar, strain color — shipped 2026-07-03.)

## Features

1. **Template visibility & management** — templates are only reachable inside
   the Start-workout flow. Add a manage surface (e.g. "Manage" screen) to
   view, edit, and delete templates. Template *editing* doesn't exist yet at
   all (create/delete only).
2. **Session editing ergonomics**
   - Drag-to-reorder exercises while creating/editing a workout (switch the
     order mid-session).
   - Edit a saved custom exercise (fix a typo'd name or wrong muscle group) —
     likely lives on the same manage surface as templates.
   - Remove individual sets during a session — the per-set ✕ was lost in the
     session-screen rewrite (exercises can be removed, single sets cannot).
3. **Captured page pagination** — currently renders up to 60 sessions in one
   list; paginate or "load more" in small pages.
4. **Step count** — display daily steps if obtainable. Honest constraint:
   WHOOP deliberately does not measure or expose steps in its API, so this
   needs a different source — a future Garmin/Fitbit adapter (the ingestion
   layer is already vendor-neutral) or a phone-health integration, which a
   PWA cannot reach on iOS. Park until a second wearable adapter exists.
