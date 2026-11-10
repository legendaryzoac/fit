// What the coach keeps on this device: today's conversation, today's plan
// and the notes it was asked to remember. All three are plain data, so a
// change to the model, the prompt or the tools never strands them. Keys go
// through storageKey, so the demo has its own copies.
//
// Each value is read through a small cache keyed on the raw stored string:
// useSyncExternalStore gets a stable snapshot, and a switch between the
// demo and a real account (a different key) is picked up on the next read.

import { useSyncExternalStore } from 'react'
import { storageKey } from '../storage'
import { localToday } from '../weights'
import type { CoachNote, DayPlan, ThreadEntry } from './types'

const THREAD_KEY = 'fit.coachThread'
const PLAN_KEY = 'fit.coachDayPlan'
const NOTES_KEY = 'fit.coachNotes'

const MAX_THREAD = 60

const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) fn()
}

export function subscribeCoach(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(storageKey(key))
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(storageKey(key))
    else localStorage.setItem(storageKey(key), JSON.stringify(value))
  } catch {
    // storage full or unavailable: the in-memory copy still serves this page
  }
  emit()
}

/** One parsed value per key, reused while the stored string is unchanged. */
function cached<T>(parse: (raw: string | null) => T) {
  let lastKey = ''
  let lastRaw: string | null | undefined
  let value: T
  return (key: string): T => {
    const full = storageKey(key)
    const raw = read(key)
    if (full !== lastKey || raw !== lastRaw) {
      lastKey = full
      lastRaw = raw
      value = parse(raw)
    }
    return value
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// ---- thread: one conversation per local day ----

interface StoredThread {
  date: string
  entries: ThreadEntry[]
}

const EMPTY_THREAD: ThreadEntry[] = []

const threadOf = cached<StoredThread | null>((raw) => {
  const v = parseJson(raw) as StoredThread | null
  return v && typeof v.date === 'string' && Array.isArray(v.entries) ? v : null
})

export function getThread(): ThreadEntry[] {
  const t = threadOf(THREAD_KEY)
  // Yesterday's conversation is about yesterday's state
  return t && t.date === localToday() ? t.entries : EMPTY_THREAD
}

export function setThread(entries: ThreadEntry[]): void {
  write(THREAD_KEY, { date: localToday(), entries: entries.slice(-MAX_THREAD) })
}

export function clearThread(): void {
  write(THREAD_KEY, null)
}

// ---- day plan ----

const planOf = cached<DayPlan | null>((raw) => {
  const v = parseJson(raw) as DayPlan | null
  return v && typeof v.date === 'string' && Array.isArray(v.items) ? v : null
})

export function getDayPlan(): DayPlan | null {
  const p = planOf(PLAN_KEY)
  return p && p.date === localToday() ? p : null
}

export function setDayPlan(plan: DayPlan | null): void {
  write(PLAN_KEY, plan)
}

// ---- notes ----

const EMPTY_NOTES: CoachNote[] = []

const notesOf = cached<CoachNote[]>((raw) => {
  const v = parseJson(raw)
  return Array.isArray(v) ? (v as CoachNote[]) : EMPTY_NOTES
})

export function getNotes(): CoachNote[] {
  return notesOf(NOTES_KEY)
}

export function addNote(note: CoachNote): void {
  write(NOTES_KEY, [...getNotes(), note])
}

export function removeNote(id: string): void {
  write(
    NOTES_KEY,
    getNotes().filter((n) => n.id !== id),
  )
}

// ---- hooks ----

export function useThread(): ThreadEntry[] {
  return useSyncExternalStore(subscribeCoach, getThread, getThread)
}

export function useDayPlan(): DayPlan | null {
  return useSyncExternalStore(subscribeCoach, getDayPlan, getDayPlan)
}

export function useNotes(): CoachNote[] {
  return useSyncExternalStore(subscribeCoach, getNotes, getNotes)
}
