# Backlog

User-reported requests, logged 2026-07-03. Not yet scheduled.
(Shipped so far: the bugs/polish batch — baseline label, hover underlines,
chip-row scrollbar, strain color — and the manage surface for templates +
custom exercises, both 2026-07-04.)

## Features

1. **Session editing ergonomics**
   - Drag-to-reorder exercises while creating/editing a workout (switch the
     order mid-session).
   - Remove individual sets during a session — the per-set ✕ was lost in the
     session-screen rewrite (exercises can be removed, single sets cannot).
2. **Captured page pagination** — currently renders up to 60 sessions in one
   list; paginate or "load more" in small pages.
3. **Step count** — display daily steps if obtainable. Honest constraint:
   WHOOP deliberately does not measure or expose steps in its API, so this
   needs a different source — a future Garmin/Fitbit adapter (the ingestion
   layer is already vendor-neutral) or a phone-health integration, which a
   PWA cannot reach on iOS. Park until a second wearable adapter exists.
