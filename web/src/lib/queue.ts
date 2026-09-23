// Generic offline write queue with the same contract as the workouts
// queue in workouts.ts: saves land locally first; a flush POSTs each entry
// and drops only what the server can never accept (400/422). Auth expiry
// and transient failures stay queued. Entries are keyed so a re-save
// replaces its predecessor instead of queueing twice.

import type { Api } from './api'
import { storageKey } from './storage'

export interface Queue<T> {
  load(): T[]
  enqueue(item: T): void
  flush(api: Api): Promise<{ flushed: number; remaining: number }>
}

export function makeQueue<T>(
  key: string,
  path: string,
  idOf: (item: T) => string,
): Queue<T> {
  const load = (): T[] => {
    try {
      return JSON.parse(localStorage.getItem(storageKey(key)) ?? '[]')
    } catch {
      return []
    }
  }
  const save = (list: T[]) =>
    localStorage.setItem(storageKey(key), JSON.stringify(list))

  return {
    load,
    enqueue(item) {
      const list = load().filter((x) => idOf(x) !== idOf(item))
      list.push(item)
      save(list)
    },
    async flush(api) {
      const pending = load()
      const remaining: T[] = []
      let flushed = 0
      for (const item of pending) {
        try {
          const res = await api.send('POST', path, item)
          if (res.ok || res.status === 400 || res.status === 422) {
            flushed += res.ok ? 1 : 0
          } else {
            remaining.push(item)
          }
        } catch {
          remaining.push(item)
        }
      }
      save(remaining)
      return { flushed, remaining: remaining.length }
    },
  }
}
