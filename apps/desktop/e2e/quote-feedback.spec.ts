import type { Locator, Page } from '@playwright/test'

import { setupMockBackend, waitForAppReady } from './fixtures'
import { collectErrorBanners, expect, test } from './test'

interface QuoteFeedbackWindow extends Window {
  hermesDesktop?: {
    api<T>(request: { path: string }): Promise<T>
    getRecentLogs(): Promise<{ lines: string[] }>
  }
}

/** Use Chromium mouse selection, not a fabricated selection event or a replaced component. */
async function selectPassage(page: Page, passage: Locator) {
  await passage.scrollIntoViewIfNeeded()

  const rect = await passage.evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const bounds = range.getBoundingClientRect()

    return { left: bounds.left, right: bounds.right, y: bounds.top + bounds.height / 2 }
  })

  await page.mouse.move(rect.left, rect.y)
  await page.mouse.down()
  await page.mouse.move(rect.right + 1, rect.y, { steps: 12 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Add to chat', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add to chat', exact: true }).click()
}

test('chat passages accumulate as editable feedback and become one explicit, persisted user message', async () => {
  test.setTimeout(150_000)
  const first = 'Validate the core experience first.'
  const second = 'Keep a broad range of game genres.'

  const fixture = await setupMockBackend({
    mockServer: { replyForPrompt: prompt => prompt.includes('Start quote feedback check') ? `${first}\n\n${second}` : 'Feedback received.' }
  })

  const { page, mock } = fixture

  try {
    await waitForAppReady(fixture)
    const composer = page.locator('[data-slot="composer-root"] [contenteditable="true"]').filter({ visible: true }).first()
    await composer.fill('Start quote feedback check')
    await composer.press('Enter')
    const answers = page.locator('[data-slot="aui_assistant-message-content"]').filter({ visible: true })
    await expect(answers.filter({ hasText: first })).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('[data-message-streaming="true"]')).toHaveCount(0)
    const stored = await page.evaluate(() => decodeURIComponent(location.hash.slice(2).split('?')[0]!))

    await selectPassage(page, answers.locator('p').filter({ hasText: first }))
    await page.getByRole('textbox', { name: 'Your feedback — Quote 1' }).fill('先验证玩法，不急着商业化。')
    await selectPassage(page, answers.locator('p').filter({ hasText: second }))
    await page.getByRole('textbox', { name: 'Your feedback — Quote 2' }).fill('保留跨类型候选。')
    await expect(page.getByRole('button', { name: '2 quoted passages', exact: true })).toBeVisible()
    expect(mock.receivedPrompts.some(prompt => prompt.includes('先验证玩法'))).toBe(false)
    await page.screenshot({ path: test.info().outputPath('two-quotes-before-send.png') })

    await page.locator('[data-slot="sidebar"] button[aria-label="New session"]').first().click()
    await expect(page.locator('[data-slot="quote-feedback-panel"]').filter({ visible: true })).toHaveCount(0)
    await expect(composer).toHaveText('')
    await page.locator('[data-slot="sidebar"] button').filter({ hasText: 'Start quote feedback check' }).first().click()
    await expect(page.getByRole('textbox', { name: 'Your feedback — Quote 1' })).toHaveValue('先验证玩法，不急着商业化。')

    // The same session is resumed from SQLite; feedback snapshots and notes
    // must survive the renderer lifetime rather than living in a DOM Range.
    await page.reload()
    await waitForAppReady(fixture)
    await expect(page.getByRole('textbox', { name: 'Your feedback — Quote 1' })).toHaveValue('先验证玩法，不急着商业化。')
    await expect(page.getByRole('textbox', { name: 'Your feedback — Quote 2' })).toHaveValue('保留跨类型候选。')

    // Observe the real scroll call; preserve Chromium's implementation.
    await page.evaluate(() => {
      const original = Element.prototype.scrollIntoView

      Element.prototype.scrollIntoView = function (options) {
        document.documentElement.dataset.quoteSourceScrolled = this.getAttribute('data-message-id') ?? ''
        original.call(this, options)
      }
    })
    await page.getByRole('button', { name: 'Show source of quote 1', exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.quoteSourceScrolled)).toBeTruthy()

    await page.getByRole('button', { name: 'Remove quote 2', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Your feedback — Quote 2' })).toHaveCount(0)
    await selectPassage(page, answers.locator('p').filter({ hasText: second }))
    await page.getByRole('textbox', { name: 'Your feedback — Quote 3' }).fill('保留跨类型候选，并继续查证。')
    await composer.fill('Please address both comments.')
    await page.getByRole('button', { name: 'Add all to draft', exact: true }).click()
    await expect(composer).toContainText('Please address both comments.')
    await expect(composer).toContainText(first)
    await expect(composer).toContainText(second)
    await expect(composer).toContainText('先验证玩法，不急着商业化。')
    await expect(composer).toContainText('保留跨类型候选，并继续查证。')
    await expect(page.locator('[data-slot="quote-feedback-panel"]')).toHaveCount(0)
    expect(mock.receivedPrompts.some(prompt => prompt.includes('先验证玩法'))).toBe(false)

    await composer.press('Enter')
    await expect(answers.filter({ hasText: 'Feedback received.' })).toBeVisible({ timeout: 60_000 })
    await expect.poll(() => mock.receivedPrompts.some(prompt => prompt.includes('先验证玩法') && prompt.includes('保留跨类型候选，并继续查证。'))).toBe(true)

    const persisted = await page.evaluate(async sessionId => {
      const response = await (window as QuoteFeedbackWindow).hermesDesktop!.api<{ messages: { role: string; content: string }[] }>({ path: `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=20` })

      return response.messages.filter(message => message.role === 'user').map(message => message.content)
    }, stored)

    expect(persisted).toHaveLength(2)
    expect(persisted[1]).toContain('Please address both comments.')
    expect(persisted[1]!.match(/先验证玩法，不急着商业化。/g)).toHaveLength(1)
    expect(persisted[1]!.match(/保留跨类型候选，并继续查证。/g)).toHaveLength(1)
    await page.screenshot({ path: test.info().outputPath('feedback-sent.png') })
    await test.info().attach('persisted-quote-feedback', { body: JSON.stringify({ stored, userTurns: persisted }, null, 2), contentType: 'application/json' })
    expect(await collectErrorBanners(page)).toEqual([])
  } catch (error) {
    const logs = await page.evaluate(() => (window as QuoteFeedbackWindow).hermesDesktop!.getRecentLogs())
    await test.info().attach('desktop-logs', { body: logs.lines.join('\n'), contentType: 'text/plain' })
    console.error(logs.lines.slice(-35).join('\n'))

    throw error
  } finally {
    await fixture.cleanup()
  }
})
