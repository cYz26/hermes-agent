import { createContext, type RefObject, useContext } from 'react'

export interface QuoteFeedbackContextValue {
  key: string
  enabled: boolean
  root: RefObject<HTMLDivElement | null>
}

export const QuoteFeedbackContext = createContext<QuoteFeedbackContextValue | null>(null)
export const useQuoteFeedbackScope = () => useContext(QuoteFeedbackContext)
