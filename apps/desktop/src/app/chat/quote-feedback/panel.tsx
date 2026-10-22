import { useEffect, useRef, useState } from 'react'

import { composerPanelCard } from '@/components/chat/composer-dock'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { QuoteFeedbackCopy } from '@/i18n/types_quote_feedback'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import {
  $quoteFeedback,
  EMPTY_QUOTE_FEEDBACK,
  type QuoteFeedbackItem,
  removeQuoteFeedback,
  updateQuoteFeedback
} from '@/store/quote-feedback'

import { useQuoteFeedbackScope } from './context'
import { showQuoteSource } from './source'

/** Quotes are reference material; user feedback stays a separate, explicitly labelled field. */
export function quoteFeedbackText(items: readonly QuoteFeedbackItem[], copy: QuoteFeedbackCopy): string {
  return [
    copy.instruction,
    ...items.map(item => [
      `### ${copy.item(item.number)}`,
      copy.source(JSON.stringify(item.messageId)),
      `${copy.quoteLabel}:`,
      item.text.split('\n').map(line => `> ${line}`).join('\n'),
      ...(item.note.trim() ? [`${copy.feedbackLabel}:`, item.note] : [])
    ].join('\n'))
  ].join('\n\n')
}

interface QuoteFeedbackPanelProps {
  onAddToDraft: (text: string) => boolean
}

export function QuoteFeedbackPanel(props: QuoteFeedbackPanelProps) {
  const scope = useQuoteFeedbackScope()

  return scope ? <ScopedQuoteFeedbackPanel key={scope.key} {...props} /> : null
}

function ScopedQuoteFeedbackPanel({ onAddToDraft }: QuoteFeedbackPanelProps) {
  const scope = useQuoteFeedbackScope()!
  const { t } = useI18n()
  const copy = t.quoteFeedback
  const batch = useStoreSelector($quoteFeedback, batches => batches[scope.key] ?? EMPTY_QUOTE_FEEDBACK)
  const [collapsed, setCollapsed] = useState(false)
  const [error, setError] = useState('')
  const navigation = useRef<AbortController | null>(null)

  useEffect(() => () => navigation.current?.abort(), [])

  if (!batch.items.length) {
    return null
  }

  return (
    <section aria-label={copy.title(batch.items.length)} className={cn(composerPanelCard, 'mx-[5px] mb-1.5 min-w-0')} data-slot="quote-feedback-panel">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <Button aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)} size="inline" type="button" variant="text">
          <Codicon name={collapsed ? 'chevron-right' : 'chevron-down'} />
          {copy.title(batch.items.length)}
        </Button>
        <Button
          disabled={!scope.enabled}
          onClick={() => {
            const captured = batch.items

            if (!onAddToDraft(quoteFeedbackText(captured, copy))) {
              setError(copy.addFailed)

              return
            }

            captured.forEach(item => removeQuoteFeedback(scope.key, item.id))
            setError('')
          }}
          size="xs"
          type="button"
          variant="secondary"
        >
          {copy.addToDraft}
        </Button>
      </div>
      {!collapsed && (
        <div className="max-h-64 space-y-3 overflow-y-auto overscroll-contain px-3 pb-3">
          {batch.items.map(item => (
            <div className="min-w-0 space-y-1" key={item.id}>
              <div className="flex items-center justify-between gap-2 text-(--ui-text-secondary)">
                <span>{copy.item(item.number)} <span className="text-(--ui-text-tertiary)">· {copy.chars(item.text.length)}</span></span>
                <div className="flex items-center gap-1">
                  <Button
                    aria-label={copy.showSource(item.number)}
                    onClick={() => {
                      navigation.current?.abort()
                      const controller = new AbortController()
                      navigation.current = controller
                      const root = scope.root.current

                      if (!root) {
                        setError(copy.sourceUnavailable)

                        return
                      }

                      void showQuoteSource(root, item, controller.signal).then(found => {
                        if (!controller.signal.aborted) {
                          setError(found ? '' : copy.sourceUnavailable)
                        }
                      })
                    }}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  ><Codicon name="go-to-file" /></Button>
                  <Button aria-label={copy.remove(item.number)} onClick={() => removeQuoteFeedback(scope.key, item.id)} size="icon-xs" type="button" variant="ghost">
                    <Codicon name="close" />
                  </Button>
                </div>
              </div>
              <details>
                <summary className="cursor-pointer truncate text-(--ui-text-secondary)">{item.text}</summary>
                <blockquote className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-s border-(--ui-stroke-tertiary) ps-2 text-(--ui-text-secondary)">{item.text}</blockquote>
              </details>
              <Textarea
                aria-label={`${copy.feedback} — ${copy.item(item.number)}`}
                onChange={event => updateQuoteFeedback(scope.key, item.id, event.target.value)}
                placeholder={copy.feedbackPlaceholder}
                rows={2}
                value={item.note}
              />
            </div>
          ))}
          <p className="text-(--ui-text-tertiary)">{copy.hint}</p>
        </div>
      )}
      {error && <p className="px-3 pb-2 text-destructive" role="alert">{error}</p>}
    </section>
  )
}
