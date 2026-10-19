import { beforeEach, expect, it } from 'vitest'

import {
  $queuedPromptsBySession,
  enqueueQueuedPrompt,
  getQueuedPrompts,
  isSteerableEntry,
  simulateComposerQueueReloadForTests
} from './composer-queue'
import { readPendingSubmissions, reconcilePendingSubmissions, retainQueuedSubmission } from './pending-submissions'
import { $sessions } from './session'

const SESSION = 'recovery'
const INPUT = 'widget-input'
const TEXT = 'Run exact widget text Ω'
const receipt = { admission_id: 'admission', input_id: INPUT, status: 'queued', user: TEXT, controls: ['steer', 'replace'] }

beforeEach(() => {
  window.localStorage.clear()
  $queuedPromptsBySession.set({})
  $sessions.set([])
})

it.each([true, false])('folds an admitted row and its retained input into one owner card (owner first=%s)', ownerFirst => {
  const snapshot = [
    { admission_id: 'older', input_id: 'older-input', status: 'queued', user: 'older' },
    receipt,
    { admission_id: 'later', input_id: 'later-input', status: 'queued', user: 'later' }
  ]

  const attachment = { id: 'image', kind: 'image' as const, label: 'shot.png', previewUrl: 'blob:retained-image' }

  if (ownerFirst) { reconcilePendingSubmissions(SESSION, snapshot) }
  // A stale window/older renderer can still mirror its input after observing the owner's card.
  enqueueQueuedPrompt(SESSION, { id: INPUT, text: TEXT, displayText: '/widget', attachments: [attachment] })
  reconcilePendingSubmissions(SESSION, snapshot)
  reconcilePendingSubmissions(SESSION, snapshot)

  const entries = getQueuedPrompts(SESSION)
  expect(entries.map(entry => entry.id)).toEqual(['older', 'admission', 'later'])
  expect(entries[1]).toMatchObject({
    text: TEXT, displayText: '/widget', attachments: [attachment], submissionId: INPUT,
    serverStatus: 'queued', serverControls: ['steer', 'replace']
  })
  expect(entries.every(entry => !isSteerableEntry(entry))).toBe(true)
})

it.each(['started', 'retired'])('does not resurrect a late local retry of a %s admission on repeated snapshots', status => {
  reconcilePendingSubmissions(SESSION, [{ ...receipt, status: 'started' }], { epoch: 'e', sequence: 10 })

  if (status === 'retired') {
    reconcilePendingSubmissions(SESSION, [], { epoch: 'e', sequence: 12 })
  }

  enqueueQueuedPrompt(SESSION, { id: INPUT, text: TEXT, attachments: [] })
  const snapshot = status === 'retired' ? [] : [{ ...receipt, status: 'started' }]
  reconcilePendingSubmissions(SESSION, snapshot, { epoch: 'e', sequence: 13 })
  reconcilePendingSubmissions(SESSION, snapshot, { epoch: 'e', sequence: 14 })
  expect(getQueuedPrompts(SESSION)).toEqual([])
  // Retired input aliases remain after their text is discarded, including across renderer reload.
  expect(readPendingSubmissions(SESSION).admission).toMatchObject({ submissionId: INPUT, status })
  simulateComposerQueueReloadForTests()
  retainQueuedSubmission(SESSION, { id: INPUT, text: TEXT, attachments: [] })
  expect(getQueuedPrompts(SESSION)).toEqual([])
})

it('keeps a retained input authoritative when an older empty snapshot predates its admission', () => {
  reconcilePendingSubmissions(SESSION, [receipt], { epoch: 'e', sequence: 10 })
  enqueueQueuedPrompt(SESSION, { id: INPUT, text: TEXT, attachments: [] })
  reconcilePendingSubmissions(SESSION, [], { epoch: 'e', sequence: 7 })
  expect(getQueuedPrompts(SESSION).map(({ id, serverStatus }) => ({ id, serverStatus })))
    .toEqual([{ id: 'admission', serverStatus: 'queued' }])
})

it('retains only one exact retry and never conflates equal text with another submission', () => {
  retainQueuedSubmission(SESSION, { id: INPUT, text: TEXT, attachments: [] })
  retainQueuedSubmission(SESSION, { id: INPUT, text: TEXT, attachments: [] })
  retainQueuedSubmission(SESSION, { id: 'separate-input', text: TEXT, attachments: [] })
  simulateComposerQueueReloadForTests()
  expect(getQueuedPrompts(SESSION).map(({ id, submissionId }) => ({ id, submissionId }))).toEqual([
    { id: INPUT, submissionId: INPUT },
    { id: 'separate-input', submissionId: 'separate-input' }
  ])
  expect(getQueuedPrompts(SESSION).every(entry => !isSteerableEntry(entry))).toBe(true)
  reconcilePendingSubmissions(SESSION, [receipt])
  expect(getQueuedPrompts(SESSION).map(entry => entry.id)).toEqual(['admission', 'separate-input'])
})
