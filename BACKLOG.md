# Backlog

All user-reported bugs and features through 2026-07-13 are shipped:
template drag + set-count input, offline data-loss fix (fresh tokens,
safer queue, pending overlay), live HR card (Web Bluetooth), minimizable
live sessions with resume bar, sticky session header, bodyweight
exercises from WHOOP body measurement, cardio stopwatch mode, the
bedtime/weekday charts relocated to Recovery, persistent nav + live
timer during workouts (sticky app header, ticking resume bar), the
opt-in lock-screen session widget (Media Session "Now Playing" card
with section countdown / elapsed time and pause-skip controls — also
keeps the page alive when locked so interval beeps fire mid-sprint),
and workouts-list pagination (20 per page).

## Parked

1. **Step count** — WHOOP's API exposes no step data; needs a future
   Garmin/Fitbit adapter (ingestion layer is already vendor-neutral) or a
   phone-health integration a PWA can't reach on iOS.
