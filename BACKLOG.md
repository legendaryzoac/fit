# Backlog

User-reported issues and requests, logged 2026-07-03. Not yet scheduled.

## Bugs / polish

1. **Recovery-score baseline label mismatch** — header says "7-day baseline"
   (and the data really is 7-day), but the chart *tooltip* hardcodes
   "30-day baseline" for every TrendChart. Fix: baseline label becomes a
   TrendChart prop. (`web/src/components/Charts.tsx` formatter.)
2. **Hover underlines** — "Sign out" (header) and "source" (footer) should not
   underline on hover; drop the `hover:underline` classes.
3. **Exercise-chip scrollbar** — the horizontal chip row in Strength analytics
   shows a bright default scrollbar when it overflows (not demo-specific;
   Windows default scrollbar). Style with thin/dark scrollbar CSS.
4. **Strain color in Load vs recovery** — amber/gold reads off-putting; switch
   strain bars to a blue or purple.

## Features

5. **Template visibility & management** — templates are only reachable inside
   the Start-workout flow. Add a manage surface (e.g. "Manage" screen) to
   view, edit, and delete templates. Template *editing* doesn't exist yet at
   all (create/delete only).
6. **Session editing ergonomics**
   - Drag-to-reorder exercises while creating/editing a workout (switch the
     order mid-session).
   - Edit a saved custom exercise (fix a typo'd name or wrong muscle group) —
     likely lives on the same manage surface as templates.
   - Remove individual sets during a session — the per-set ✕ was lost in the
     session-screen rewrite (exercises can be removed, single sets cannot).
7. **Captured page pagination** — currently renders up to 60 sessions in one
   list; paginate or "load more" in small pages.
8. **Step count** — display daily steps if obtainable. Honest constraint:
   WHOOP deliberately does not measure or expose steps in its API, so this
   needs a different source — a future Garmin/Fitbit adapter (the ingestion
   layer is already vendor-neutral) or a phone-health integration, which a
   PWA cannot reach on iOS. Park until a second wearable adapter exists.
