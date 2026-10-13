import { create } from 'zustand'

export interface Todo { id: string; text: string; done: boolean; due: number | null }

const KEY = 'lokey.todos.v1'

function load(): Todo[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter(t => t && typeof t.id === 'string' && typeof t.text === 'string') : []
  } catch { return [] }
}

/** "call mum @18:30" -> text + due timestamp (today, or tomorrow if that time already passed). */
export function parseTodo(raw: string, now = new Date()): { text: string; due: number | null } {
  const m = raw.match(/\s*@(\d{1,2}):(\d{2})\s*$/)
  const h = m ? +m[1] : 0, min = m ? +m[2] : 0
  if (!m || h > 23 || min > 59 || !raw.slice(0, m.index).trim()) return { text: raw.trim(), due: null }
  const d = new Date(now)
  d.setHours(h, min, 0, 0)
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
  return { text: raw.slice(0, m.index).trim(), due: d.getTime() }
}

interface TodoState {
  items: Todo[]
  add: (raw: string) => void
  toggle: (id: string) => void
  remove: (id: string) => void
}

export const useTodos = create<TodoState>(set => ({
  items: load(),
  add: raw => {
    const { text, due } = parseTodo(raw)
    if (text) set(s => ({ items: [...s.items, { id: crypto.randomUUID(), text, done: false, due }] }))
  },
  toggle: id => set(s => ({ items: s.items.map(t => (t.id === id ? { ...t, done: !t.done } : t)) })),
  remove: id => set(s => ({ items: s.items.filter(t => t.id !== id) })),
}))

useTodos.subscribe(s => { try { localStorage.setItem(KEY, JSON.stringify(s.items)) } catch { /* ignore */ } })
