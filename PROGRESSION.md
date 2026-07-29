# Auto-progression engine

How `web/src/lib/progression.ts` decides what to recommend after each
strength session. Numbers were reconciled from Renaissance Periodization's
published volume landmarks and the set-volume dose-response literature;
where sources disagreed the more conservative number won. Key sources at
the bottom.

## 1. Weekly volume landmarks (direct working sets / muscle / week)

MV = maintenance, MEV = minimum effective, MAV = maximum adaptive range,
MRV = maximum recoverable. Intermediate defaults:

| Muscle | MV | MEV | MAV | MRV |
|---|---|---|---|---|
| Chest | 4 | 6 | 12–20 | 22 |
| Back | 8 | 10 | 14–22 | 25 |
| Quads | 6 | 8 | 12–18 | 20 |
| Hamstrings / posterior chain | 4 | 6 | 10–16 | 20 |
| Glutes | 0 | 0 | 4–12 | 16 |
| Shoulders | 4 | 8 | 12–20 | 22 |
| Rear delts | 0 | 6 | 10–16 | 20 |
| Traps | 0 | 4 | 8–16 | 20 |
| Biceps | 5 | 8 | 10–18 | 20 |
| Triceps | 4 | 6 | 10–14 | 18 |
| Calves | 6 | 8 | 12–16 | 20 |
| Core | 0 | 0 | 4–12 | 20 |
| Other / unknown | 0 | 0 | 4–12 | 16 |

Conservative reconciliations: biceps MRV 20 (classic RP says 26; Baz-Valle
2022 found no benefit past 20), shoulders pulled down to 22 because a
single bucket double-counts front-delt pressing overlap, abs pulled down
because compounds train them indirectly. Glutes MEV 0 assumes squats /
deadlifts / lunges are being logged.

## 2. Per-session dose

- Cap: **8 direct sets per muscle per session** (Remmert per-session
  meta-regression ≈ 8 direct; Krieger found diminishing returns past 6–8).
  The engine never grows a session past this — more volume means another
  training day, not a bigger day.

## 3. Feedback decision table

Asked per muscle group at the end of each strength session. The volume
answer steers **sets**, the difficulty answer steers **load** — effort is
never a reason to add sets (RP hard rule: never add sets while recovery
is poor).

| difficulty \ volume | Too little | Just enough | Too much |
|---|---|---|---|
| **Too easy** | +2 sets · add weight | +1 set · add weight | −1 set · add weight |
| **Just right** | +1 set · add reps | 0 · add reps | −1 set · hold |
| **Too hard** | 0 · hold | 0 · same weight, add a rep † | −2 sets · reduce |

† Deliberate divergence from the RP-derived table (which drops a set
here): the owner's requested rule — too hard + just enough repeats the
weight and chases a rep.

## 4. Load guidance

- Double progression: hold weight, add reps until the top of the rep
  window, then add weight (upper body +2.5–5 lb, lower body +5–10 lb,
  never a jump above ~10%; if the smallest increment is coarser than ~5%,
  add a rep instead).
- Load increases are gated on "too easy" / "just right" feedback.

## 5. Safety rails

- Weekly sets stay within [MV, MRV]; never a positive delta at or above
  MRV, never below MV.
- Set deltas clamp to ±2 per muscle per session.
- Deload cue when the same muscle reports too hard + too much two sessions
  running, or sits at MRV while reporting too hard (deloads cost nothing
  for hypertrophy — cheap insurance).
- Muscles with no ratings yet get volume-only guidance (a set added while
  under MEV), so the coach is useful before any feedback exists.

## Key sources

- RP volume-landmark guides (Israetel):
  rpstrength.com/blogs/articles/training-volume-landmarks-muscle-growth
  plus the per-muscle hypertrophy guides (chest, back, quads, hamstrings,
  glutes, delts, biceps, triceps, calves, abs, traps)
- RP app set/weight/rep algorithm:
  help.rpstrength.com/hc/en-us/articles/32600173777815
- Schoenfeld, Ogborn, Krieger 2017 — dose-response meta-analysis
  (pubmed.ncbi.nlm.nih.gov/27433992): 10+ weekly sets ≈ 9.8% growth vs
  5.4% under 5
- Baz-Valle et al. 2022 (pubmed.ncbi.nlm.nih.gov/35291645): 12–20 weekly
  sets recommended; no benefit past ~20 for most muscles
- Pelland/Remmert et al. 2024–2026 dose-response meta-regressions
  (pubmed.ncbi.nlm.nih.gov/41343037, sportrxiv preprints 460/537):
  per-session point of undetectable outcome superiority ≈ 8 direct sets
- Scarpelli et al. 2020 (pubmed.ncbi.nlm.nih.gov/32108724): individualized
  volume (1.2× habitual) beat a fixed 22 sets/week
- Enes et al. 2024 (pubmed.ncbi.nlm.nih.gov/37796222, 39665246): set
  progressions dose-response; forced increases above adequate habitual
  volume gave no benefit
- Bickel et al. 2011 (pubmed.ncbi.nlm.nih.gov/21131862): maintenance dose
  ≈ 1/9–1/3 of building volume
- Nuckols, Stronger by Science — training volume synthesis
  (strongerbyscience.com/volume)
