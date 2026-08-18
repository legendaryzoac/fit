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

## 6. Mesocycles (`web/src/lib/mesocycle.ts`)

Opt-in blocks layered on the engine above; ad-hoc training is untouched.

- **Shape**: N weeks (4–6 recommended, user-controlled), last week is the
  deload. Focus muscles (up to 3) ramp +1 set/week through accumulation
  (capped at +3); set additions freeze in the final accumulation week
  (new volume before a deload has nowhere to be adapted to). The same
  feedback engine, scoped to the meso's own sessions, modulates the ramp
  — only downward in the frozen week.
- **RIR ramp** (length-aware, conservative): descends to 0 in the final
  accumulation week from a cap of 3 — 4-week meso: 2→1→0; 5-week:
  3→2→1→0; 6-week: 3,3,2,1,0. Barbell compounds floor at 1 RIR.
  Surfaced as an RPE placeholder (RPE ≈ 10 − RIR).
- **Prescriptions anchor to logged actuals, unconditionally**: each
  exercise's next target builds on the lifter's last logged top set
  within the meso (overrides are absorbed, never corrected — log-anchored
  loading beat fixed plans in Graham & Cleather 2021). Double progression
  against the rep window; increments +5 lb upper / +10 lb lower, but
  never a jump over ~5% of the load — coarse-increment lifts hold weight
  and chase reps instead (evidence-equivalent for hypertrophy, Plotkin
  2022). Week 1 falls back to overall history, then body weight for BW
  moves, then "find a working weight at ~3 RIR".
- **Deload week**: half the sets, half the reps, ~90% load, explicit
  "stop far from failure" note. Overdue mesos clamp to deload
  prescriptions until wrapped up.
- **Documented divergences from the research spec**: non-focus muscles
  hold the volume the lifter authored in their template rather than being
  auto-cut to maintenance (the app never silently rewrites what the user
  programmed — feedback can still trim them); the deload keeps a flat 90%
  load rather than the spec's split-week 100%/50%; between-meso carryover
  and missed-session policies are future work.

## 7. RIR-normalized load anchoring

A set of N reps at E reps-in-reserve is roughly an (N+E)-rep max, so the
same bar weight is a *different session* at a different effort target.
Anchoring week 1 (3 RIR) to last block's near-failure set therefore
prescribes a load that is too heavy — the engine now re-bases it:

```
W_target = W_anchor × (1 + c)^(RIR_anchor − RIR_target)
```

- `c` (load per RIR step) by rep count: ≤5 reps 3.5%, 6–12 3.0%,
  13–20 2.5%, 21+ 2.0% — flatter at high reps, per Stronger by Science's
  reps-to-failure data (RTS/Helms charts run hotter and are unreliable
  above ~10 reps). One coefficient for compounds and isolations: Remmert
  & Zourdos 2023 found no RIR-accuracy difference between them.
- **Anchor effort** comes from logged RPE (RIR = 10 − RPE); failing that,
  from what that meso week actually prescribed; otherwise assume 1 RIR.
  Never assume the anchor matches the target — that was the bug. Lifters
  under-report reps-in-reserve (Halperin 2022), so a logged "0 RIR" was
  probably 1, which already biases the correction slightly light.
- **One axis per session.** When the effort target moved (ΔRIR ≠ 0) the
  RIR ramp *is* that week's progression: the re-based load stands and the
  rep target holds. Double progression only runs when ΔRIR = 0 (e.g. a
  barbell compound floored at 1 RIR across the last two weeks). The
  correction applies once per anchor and never stacks on a bumped one.
- **Rails**: max −12% / +5% per step, rounded toward the lighter plate on
  a cut, floored at an empty bar (45 lb) for barbell compounds; a session
  that missed its rep target can never earn a heavier load; bodyweight
  moves are exempt (mass isn't a dial).
- **No data at all** still prescribes no weight — "find a working weight
  (~3 RIR)" — matching RP, whose app also declines to prefill week 1 and
  lets the lifter self-select against an RPE target. Evidence supports
  prefilling elsewhere (defaults get obeyed, so they must err light) and
  RPE-anchored self-selection does not lead to under-loading (Helms 2018).

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
