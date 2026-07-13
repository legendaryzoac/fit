// One shared context, created (ideally) on a user-gesture stack: iOS starts
// gesture-less contexts suspended, which would mute every beep fired from
// the background lock-screen driver.
let ctx: AudioContext | null = null

function sharedContext(): AudioContext {
  if (ctx && ctx.state === 'closed') ctx = null
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  return ctx
}

/**
 * Call from a user-gesture handler (e.g. session start) so the shared
 * context is unlocked before background ticks need to beep through it.
 */
export function primeCue(): void {
  try {
    sharedContext()
  } catch {
    /* no WebAudio — cue() falls back to vibration only */
  }
}

/** Best-effort chirp + vibration on section changes; silence is acceptable. */
export function cue(times: number) {
  try {
    navigator.vibrate?.(
      Array.from({ length: times }, () => [150, 100]).flat(),
    )
  } catch {
    /* no vibration support */
  }
  try {
    const ctx = sharedContext()
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      const t = ctx.currentTime + i * 0.25
      gain.gain.setValueAtTime(0.001, t)
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
      osc.start(t)
      osc.stop(t + 0.22)
    }
  } catch {
    /* autoplay policy — vibration already fired */
  }
}
