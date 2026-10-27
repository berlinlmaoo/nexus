import { describe, it, expect } from 'vitest'
import { undoneTarget } from '@/lib/status-sections'
import { updateTaskSchema } from '@/lib/validations'

// Un-done goes back to the status and section the task had right before Done (owner, 27 Oct 2026, option B).
const sections = [
  { id: 'todo', taskStatus: 'TODO', position: 0 },
  { id: 'doing', taskStatus: 'IN_PROGRESS', position: 1 },
  { id: 'review', taskStatus: 'IN_REVIEW', position: 2 },
  { id: 'waiting', taskStatus: 'IN_PROGRESS', position: 3 }, // a custom section in the In progress group
  { id: 'done', taskStatus: 'DONE', position: 4 },
]

describe('undoneTarget', () => {
  it('In progress → Done → un-done = In progress, back in its section', () => {
    expect(undoneTarget({ statusBeforeDone: 'IN_PROGRESS', taskListIdBeforeDone: 'doing' }, sections, 'done')).toEqual({ status: 'IN_PROGRESS', sectionId: 'doing' })
  })
  it('a custom section comes back too, not the first section of its status', () => {
    expect(undoneTarget({ statusBeforeDone: 'IN_PROGRESS', taskListIdBeforeDone: 'waiting' }, sections, 'done')).toEqual({ status: 'IN_PROGRESS', sectionId: 'waiting' })
  })
  it('In review comes back as In review', () => {
    expect(undoneTarget({ statusBeforeDone: 'IN_REVIEW', taskListIdBeforeDone: 'review' }, sections, 'done')).toEqual({ status: 'IN_REVIEW', sectionId: 'review' })
  })
  it('unknown (created as Done, or done before the trigger) → null: the caller keeps To Do', () => {
    expect(undoneTarget({ statusBeforeDone: null, taskListIdBeforeDone: null }, sections, 'done')).toBeNull()
    expect(undoneTarget({}, sections, 'done')).toBeNull()
  })
  it('a remembered Complete status is never brought back', () => {
    expect(undoneTarget({ statusBeforeDone: 'CANCELLED', taskListIdBeforeDone: 'done' }, sections, 'done')).toBeNull()
  })
  it('the section was deleted since → the remembered status, in the section that status gets', () => {
    expect(undoneTarget({ statusBeforeDone: 'IN_REVIEW', taskListIdBeforeDone: 'gone' }, sections, 'done')).toEqual({ status: 'IN_REVIEW', sectionId: 'review' })
  })
  it('the section now stands for another status → the section wins (sections are the status options)', () => {
    const edited = sections.map((s) => (s.id === 'doing' ? { ...s, taskStatus: 'IN_REVIEW' } : s))
    expect(undoneTarget({ statusBeforeDone: 'IN_PROGRESS', taskListIdBeforeDone: 'doing' }, edited, 'done')).toEqual({ status: 'IN_REVIEW', sectionId: 'doing' })
  })
  it('plain sections (no status): the status comes back, the task stays where it is', () => {
    const plain = [{ id: 'a', taskStatus: null, position: 0 }, { id: 'b', taskStatus: null, position: 1 }]
    expect(undoneTarget({ statusBeforeDone: 'IN_PROGRESS', taskListIdBeforeDone: 'a' }, plain, 'a')).toEqual({ status: 'IN_PROGRESS', sectionId: null })
    expect(undoneTarget({ statusBeforeDone: 'IN_PROGRESS', taskListIdBeforeDone: 'a' }, plain, 'b')).toEqual({ status: 'IN_PROGRESS', sectionId: 'a' })
  })
  it('through a linked project (no sections): status only', () => {
    expect(undoneTarget({ statusBeforeDone: 'IN_PROGRESS', taskListIdBeforeDone: 'doing' }, [], null)).toEqual({ status: 'IN_PROGRESS', sectionId: null })
  })
})

describe('updateTaskSchema exactStatus', () => {
  it('accepts exactStatus (a status picked from a list) and still accepts the old body', () => {
    expect(updateTaskSchema.safeParse({ status: 'TODO', exactStatus: true }).success).toBe(true)
    expect(updateTaskSchema.safeParse({ status: 'TODO' }).success).toBe(true)
    expect(updateTaskSchema.safeParse({ status: 'TODO', exactStatus: 'yes' }).success).toBe(false)
  })
})
