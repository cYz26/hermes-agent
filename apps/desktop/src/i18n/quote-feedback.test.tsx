import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { BUNDLED_LOCALES, TRANSLATIONS } from './catalog'
import { I18nProvider, useI18n } from './context'
import { registerAppLocale, resetAppLocaleRegistry, resolveTranslations } from './registry'
import { setRuntimeI18nLocale, translateNow } from './runtime'
import type { BundledLocale } from './types'

const addToChatLabels = {
  en: 'Add to chat',
  zh: '添加到聊天',
  'zh-hant': '加入聊天',
  ja: 'チャットに追加',
  ar: 'إضافة إلى المحادثة',
  ru: 'Добавить в чат',
  fr: 'Ajouter au chat',
  de: 'Zum Chat hinzufügen',
  es: 'Añadir al chat'
} satisfies Record<BundledLocale, string>

const stringFields = [
  'addToChat',
  'feedback',
  'feedbackPlaceholder',
  'addToDraft',
  'hint',
  'sourceUnavailable',
  'addFailed',
  'tooLong',
  'instruction',
  'quoteLabel',
  'feedbackLabel'
] as const

function QuoteFeedbackProbe() {
  const { t } = useI18n()

  return (
    <section>
      <button type="button">{t.quoteFeedback.addToChat}</button>
      <h2>{t.quoteFeedback.title(2)}</h2>
      <h3>{t.quoteFeedback.item(1)}</h3>
      <label htmlFor="feedback">{t.quoteFeedback.feedback}</label>
      <textarea id="feedback" placeholder={t.quoteFeedback.feedbackPlaceholder} />
      <button type="button">{t.quoteFeedback.addToDraft}</button>
      <p>{t.quoteFeedback.hint}</p>
    </section>
  )
}

afterEach(() => {
  cleanup()
  resetAppLocaleRegistry()
  setRuntimeI18nLocale('en')
})

it('serves native quote-feedback copy in every bundled locale and applies live catalog overrides', () => {
  for (const locale of BUNDLED_LOCALES) {
    const copy = resolveTranslations(locale).quoteFeedback

    expect(copy, `${locale} must provide quote-feedback translations`).toBeDefined()

    for (const field of stringFields) {
      expect(copy[field], `${locale}.${field}`).toBeTypeOf('string')
      expect(copy[field].trim(), `${locale}.${field}`).not.toBe('')

      if (locale !== 'en') {
        expect(copy[field], `${locale}.${field} must not fall back to English`).not.toBe(
          TRANSLATIONS.en.quoteFeedback[field]
        )
      }
    }

    for (const count of [0, 1, 2, 5, 11, 21]) {
      expect(copy.title(count)).toContain(String(count))
      expect(copy.chars(count)).toContain(String(count))
    }

    for (const number of [1, 2]) {
      expect(copy.item(number)).toContain(String(number))
      expect(copy.remove(number)).toContain(String(number))
      expect(copy.showSource(number)).toContain(String(number))
    }

    expect(copy.source('message:42/source')).toContain('message:42/source')

    render(
      <I18nProvider configClient={null} initialLocale={locale}>
        <QuoteFeedbackProbe />
      </I18nProvider>
    )

    expect(screen.getByRole('button', { name: addToChatLabels[locale] })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(copy.title(2))
    expect(screen.getByRole('textbox', { name: copy.feedback }).getAttribute('placeholder')).toBe(
      copy.feedbackPlaceholder
    )
    expect(screen.getByRole('button', { name: copy.addToDraft })).toBeTruthy()
    expect(screen.getByText(copy.hint)).toBeTruthy()
    cleanup()
  }

  expect(TRANSLATIONS.en.quoteFeedback.title(1)).toBe('1 quoted passage')
  expect(TRANSLATIONS.en.quoteFeedback.title(2)).toBe('2 quoted passages')
  expect(TRANSLATIONS.en.quoteFeedback.item(1)).toBe('Quote 1')
  expect(TRANSLATIONS.en.quoteFeedback.addToDraft).toBe('Add all to draft')
  expect(TRANSLATIONS.en.quoteFeedback.hint).toBe('Add to your draft, then send when ready.')
  expect(TRANSLATIONS.zh.quoteFeedback.title(2)).toBe('2 段引用')
  expect(TRANSLATIONS.zh.quoteFeedback.item(1)).toBe('引用 1')
  expect(TRANSLATIONS.zh.quoteFeedback.addToDraft).toBe('全部加入草稿')
  expect(TRANSLATIONS.zh.quoteFeedback.hint).toBe('加入草稿后，确认并手动发送。')

  render(
    <I18nProvider configClient={null} initialLocale="zh">
      <QuoteFeedbackProbe />
    </I18nProvider>
  )

  let dispose = () => {}

  act(() => {
    dispose = registerAppLocale(
      'zh',
      {
        translations: {
          'quoteFeedback.addToChat': '加入引用草稿',
          'quoteFeedback.title': '{0} 条引用待处理',
          'quoteFeedback.item': '摘录 {0}',
          'quoteFeedback.feedbackPlaceholder': '这里填写反馈（可选）'
        }
      },
      'backend'
    )
  })

  try {
    expect(screen.getByRole('button', { name: '加入引用草稿' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('2 条引用待处理')
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('摘录 1')
    expect(screen.getByPlaceholderText('这里填写反馈（可选）')).toBeTruthy()
    expect(screen.getByRole('button', { name: '全部加入草稿' })).toBeTruthy()
    expect(translateNow('quoteFeedback.title', 2)).toBe('2 条引用待处理')
    expect(translateNow('quoteFeedback.source', 'message:42/source')).toBe(
      TRANSLATIONS.zh.quoteFeedback.source('message:42/source')
    )
  } finally {
    act(() => dispose())
  }

  expect(screen.getByRole('button', { name: '添加到聊天' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('2 段引用')
  expect(translateNow('quoteFeedback.title', 2)).toBe('2 段引用')
})
