import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useTranscriptWindow } from '@/components/assistant-ui/thread/transcript-window'
import { isElementInHiddenPane, usePaneVisible } from '@/components/pane-shell/pane-visibility'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { addQuoteFeedback, type QuotedPassage } from '@/store/quote-feedback'

import { useQuoteFeedbackScope } from './context'
import { captureQuotedPassage } from './selection'

interface QuoteCandidate {
  key: string
  passage: QuotedPassage
  left: number
  top: number
}

/** Rare selection events only; streaming tokens never drive document-wide scans. */
export function QuoteSelectionToolbar() {
  const scope = useQuoteFeedbackScope()
  const visible = usePaneVisible()
  const { t } = useI18n()
  const { currentMessages } = useTranscriptWindow()
  const [candidate, setCandidate] = useState<QuoteCandidate | null>(null)
  const [error, setError] = useState('')
  const toolbar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!scope?.enabled || !visible) {
      return
    }

    const capture = () => {
      const root = scope.root.current

      if (!root || isElementInHiddenPane(root)) {
        setCandidate(null)

        return
      }

      const selection = window.getSelection()
      const passage = captureQuotedPassage(root, selection)

      if (!passage || !selection) {
        setCandidate(null)

        return
      }

      const rect = selection.getRangeAt(0).getBoundingClientRect()
      setError('')
      setCandidate({
        key: scope.key,
        passage,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 180)),
        top: rect.bottom + 44 < window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - 38)
      })
    }

    const pointerUp = (event: PointerEvent) => {
      if (!toolbar.current?.contains(event.target as Node)) {
        capture()
      }
    }

    const keyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift' || event.key.startsWith('Arrow')) {
        capture()
      }
    }

    const dismiss = () => setCandidate(null)

    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss()
      }
    }

    document.addEventListener('pointerup', pointerUp)
    document.addEventListener('keyup', keyUp)
    document.addEventListener('keydown', keyDown)
    document.addEventListener('scroll', dismiss, { capture: true, passive: true })
    window.addEventListener('resize', dismiss)

    return () => {
      document.removeEventListener('pointerup', pointerUp)
      document.removeEventListener('keyup', keyUp)
      document.removeEventListener('keydown', keyDown)
      document.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [scope, visible])

  if (!candidate || !scope?.enabled || !visible || candidate.key !== scope.key) {
    return null
  }

  return createPortal(
    <div
      className="fixed z-50"
      data-slot="quote-selection-toolbar"
      ref={toolbar}
      style={{ left: candidate.left, top: candidate.top }}
    >
      <Button
        onClick={() => {
          const rowId = currentMessages.find(message => message.id === candidate.passage.messageId)?.rowId
          const added = addQuoteFeedback(scope.key, { ...candidate.passage, ...(rowId === undefined ? {} : { rowId }) })

          if (!added) {
            setError(t.quoteFeedback.tooLong)

            return
          }

          window.getSelection()?.removeAllRanges()
          setCandidate(null)
        }}
        onPointerDown={event => event.preventDefault()}
        size="xs"
        type="button"
        variant="floating"
      >
        <Codicon name="quote" />
        {t.quoteFeedback.addToChat}
      </Button>
      {error && <p className="mt-1 max-w-64 rounded bg-popover p-2 text-xs text-popover-foreground shadow-md" role="alert">{error}</p>}
    </div>,
    document.body
  )
}
