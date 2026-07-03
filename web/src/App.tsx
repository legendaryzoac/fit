export default function App() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-neutral-950 px-6 text-neutral-100">
      <svg viewBox="0 0 64 64" className="h-14 w-14" aria-hidden="true">
        <rect width="64" height="64" rx="14" className="fill-neutral-900" />
        <polyline
          points="8,34 20,34 26,20 34,46 40,28 44,34 56,34"
          fill="none"
          stroke="#2dd4bf"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <h1 className="text-5xl font-semibold tracking-tight">fit</h1>
      <p className="max-w-sm text-center text-neutral-400">
        Training &amp; recovery, tracked properly. Heart-rate trends, sleep, and
        strength analytics — coming online milestone by milestone.
      </p>
      <div className="rounded-full border border-teal-500/30 bg-teal-500/10 px-4 py-1.5 text-sm text-teal-300">
        M0 · infrastructure online
      </div>
      <footer className="fixed bottom-6 text-xs text-neutral-600">
        a zackwithers.com project
      </footer>
    </main>
  )
}
