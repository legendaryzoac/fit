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
  deload. Focus muscles (up to 3) ramp +1 set/week through accumulation,
  as far as the budget in §6a allows; the ramp itself freezes for the last
  hard week (new volume before a deload has nowhere to be adapted to). The
  ramp spreads across a muscle's lifts, compound first, rather than piling
  onto one. The same feedback engine, scoped to the meso's own sessions,
  can trim the plan. Its cuts carry into that frozen week unchanged —
  zeroing them made the peak week the *lowest*-volume hard week.
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

## 6a. How fast volume may grow

The set landmarks are absolute, but tolerance for *change* is relative,
and "+1 set per week" is not one rate — it is +50% a week on a 2-set lift
and +12% on an 8-set one. Four rails bound a focus muscle's ramp; the
tightest wins.

| Rail | Value | Why |
|---|---|---|
| Block total per session | +3 sets | RP's own stated figure |
| Proportional weekly growth | ≤ +50% of the authored weekly volume | fastest rate anyone has studied |
| Weekly MRV headroom | to MRV, no further | §1 landmarks |
| Per-session cap | to 8 direct sets | §2 |

The proportional and MRV rails are **divided by training frequency**: the
landmarks are weekly figures, so a muscle trained twice a week must not
take the week's increase twice. That alone doubled the intended rate for
anyone on an upper/lower or push/pull split.

- **The ramp is the only thing that adds.** RP is explicit that set
  increases happen "if warranted" rather than on a schedule, and cautions
  against pre-planned automatic increases. The engine used to schedule a
  ramp *and* add the feedback delta on top, so a focus muscle rated "easy,
  not enough volume" went from 4 weekly sets to 12 in two weeks. Inside a
  block, feedback may now only hold or cut; "too easy" every week is
  information about where the *next* block should start. Cuts always pass
  through — backing off must never be blocked.
- **The ramp can't eat other lifts.** Bounding it by the remaining
  per-session cap stops a ramping compound from squeezing the isolations
  out of the day, which is what used to happen once a day was already at
  8 sets for that muscle.
- **Non-focus muscles hold what you authored**, full stop — a block that
  isn't about your chest is not the place to quietly grow it.
- **Calibration.** Enes 2024/2025 is the fastest progression actually
  studied: +4–6 sets per week every fortnight off a 22-set base (≈9–13% a
  week). It bought extra *strength* but no significant extra hypertrophy
  (CSA and muscle thickness showed no between-group differences), while
  training strain rose dose-dependently (6S > 4S > fixed) and the fastest
  group reported the least pleasant sessions. So ~50% per block is a
  ceiling, not a target. Scarpelli 2020 points the same way: volume
  individualized to 1.2× habitual beat a fixed 22 sets/week. The one
  documented exemption is a floor of +1 set — below ~4 weekly sets a
  single set is coarser than the percentage, and standing still there
  helps nobody.

## 6b. Per-set rep targets and mid-block edits

- **A session has a shape, not a number.** A prescription carries one rep
  target per set, and each set progresses off *its own* last performance:
  a 12/10 session earns 13/11, never a flat 13/13 that quietly asks three
  extra reps of the back-off set. The branch that fires (double
  progression, RIR re-base, deload) picks the *rule*; the rule then runs
  over every set the athlete logged. Sets beyond what the anchor logged
  repeat its last one — the same rule the ghost column uses.
- **Two rails stop the shape from decaying.** A plan that only ever
  repeats what happened can only ever fall: simulated over two blocks
  against an athlete who drops a rep on every back-off set, the shape-only
  rule reached 10/3/3. So no set is prescribed below the window bottom
  while the headline is at or above it, and none is prescribed more than
  one rep above what that set actually did. A slot that comes in short
  therefore holds, then climbs back a rep a week, while the rest of the
  session keeps progressing — verified: 16/14/12 → 19/17/12 when the last
  set misses by one every week.
- **The check-off adopts exactly what the row was showing**, effort
  included. An unrated set is a set the engine has to guess the effort of
  later (§7), and the guess it makes for a meso session is precisely the
  week's target — so writing it down changes no math, it just stops the
  athlete having to type what the app already knew.
- **Swapping a lift mid-session is a first-class move.** Targets are
  recomputed as the exercise list changes rather than frozen at session
  start, so a lift dropped in halfway gets ghosts and a target like any
  lift the block planned: load anchored to its own last outing (re-based
  for effort, §7), reps shaped by that session, and a set count of what
  the plan would have given it — its own last set count plus this week's
  ramp if it lands on a focus muscle, still bounded by the per-muscle
  session cap. Focus steers **volume, not load**, per RP: a shoulder block
  gives cable raises more sets, not a bigger jump per set.

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
- **Rails**: max −12% / +5% per step, enforced *after* snapping to a real
  plate step — clamping the multiplier alone lets rounding overshoot it.
  The correction rounds to the nearest step (a 3% intent must not cost a
  whole plate), and when no step fits inside the rails the load simply
  holds rather than moving the wrong way. A session that missed its rep
  target can never earn a heavier load. The 45 lb barbell floor is a
  "can't go under an empty bar" guard, not a minimum prescription — it
  only applies once the anchor is already at bar weight, since names like
  hip thrust and good morning are also logged with dumbbells and
  machines. Bodyweight moves are exempt (mass isn't a dial).
- **Across a block boundary** a completed block carries +2% forward. Without
  it the opening re-base exactly mirrors the ramp just climbed and a block
  nets zero — six simulated blocks opened at the same weight every time.
  A block whose reps fell short carries nothing.
- **Rails bind per direction.** The cut floor and raise ceiling cross over
  on light loads (a 7 lb dumbbell yields floor 7.5 above ceiling 5), so
  each is applied only on its own side; otherwise a small cut got dragged
  to −44%.
- **Reps can't run away.** When the plate step is too coarse the lift
  chases reps, but once reps pass the window top by 3 the step is taken
  anyway — a 30 lb lateral raise for 39 reps is not the lift anyone
  intended. Simulated: 30×16→23, then 35×10, then 40×10.
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
- RP, "Optimizing Hypertrophy: The Case for Increasing Sets in Mesocycles"
  (rpstrength.com/blogs/articles/in-defense-of-set-increases-within-the-hypertrophy-mesocycle):
  start ≈3 sets/muscle/session, end ≈8; advanced lifters "only move about
  2-3 sets per muscle per session TOTAL" across a 4-week accumulation
  phase, and progression is "IF WARRANTED" rather than pre-planned
- Enes et al. 2024, MSSE (pubmed.ncbi.nlm.nih.gov/37796222): constant vs
  +4 vs +6 sets/week every fortnight, 12 weeks — strength favored the
  progressive arms, CSA and thickness showed no between-group difference
- Enes et al. 2025, J Sports Sci (pubmed.ncbi.nlm.nih.gov/39869076):
  same design in females from a 22-set/week base
- Enes et al., J Human Kinetics — psychophysiological responses in the
  same cohort (jhk.termedia.pl, article 209051): all groups began at 22
  weekly quad sets; 4S reached 42 and 6S reached 52 by week 12; strain
  followed 6S > 4S > fixed

## 7. Recovery is outside this engine

Recovery sessions (kind `recovery`: guided stretch and mobility routines,
foam rolling, breathwork, and quick logs like sauna or a cold shower) are
deliberately invisible to everything above. The stretch catalog in
`web/src/lib/stretches.ts` is never registered in `makeMuscleLookup`, so
no hold counts as a working set, enters a weekly volume landmark, or moves
a prescription. Stretching does not build muscle at any practical dose
(Arntz 2024) and does not reduce soreness (Cochrane 2011), so there is
nothing for the engine to credit.

What recovery does share with training is the load currency: every kind
can carry a whole-session CR-10 (`sessionRpe`), and `web/src/lib/wellness.ts`
computes Foster's weekly load, monotony and strain from effort × minutes
across lifting and recovery alike. No acute:chronic workload ratio is
computed anywhere; the literature has dismissed it (Impellizzeri 2020).

The daily check-in (sleep, energy, soreness, stress on 1–5, higher is
better, plus a 0–10 Perceived Recovery Status before a session) is a
status indicator shown beside the load history. It does not yet feed the
decision table in §3; if it ever does, the defensible rule is gentle
(hold load or drop a set when PRS ≤ 3), not a volume change.
