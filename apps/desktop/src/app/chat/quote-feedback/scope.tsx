import { type ReactNode, useMemo, useRef } from 'react'

import { quoteFeedbackKey, type QuoteFeedbackScope } from '@/store/quote-feedback'

import { QuoteFeedbackContext } from './context'
import { QuoteSelectionToolbar } from './toolbar'

interface QuoteFeedbackProviderProps {
  children: ReactNode
  scope: QuoteFeedbackScope
  enabled?: boolean
}

/** One capture/feedback scope per chat surface; never resolved from global focus at click time. */
export function QuoteFeedbackProvider({ children, scope, enabled = true }: QuoteFeedbackProviderProps) {
  const root = useRef<HTMLDivElement>(null)
  const key = quoteFeedbackKey(scope)
  const value = useMemo(() => ({ key, root, enabled }), [key, enabled])

  return (
    <QuoteFeedbackContext.Provider value={value}>
      <div className="contents" data-slot="quote-feedback-surface" ref={root}>
        {children}
      </div>
      <QuoteSelectionToolbar />
    </QuoteFeedbackContext.Provider>
  )
}
