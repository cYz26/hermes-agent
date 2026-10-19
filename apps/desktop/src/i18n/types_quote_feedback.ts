export interface QuoteFeedbackCopy {
  addToChat: string
  title: (count: number) => string
  item: (number: number) => string
  feedback: string
  feedbackPlaceholder: string
  addToDraft: string
  hint: string
  remove: (number: number) => string
  showSource: (number: number) => string
  sourceUnavailable: string
  addFailed: string
  tooLong: string
  chars: (count: number) => string
  instruction: string
  source: (id: string) => string
  quoteLabel: string
  feedbackLabel: string
}
