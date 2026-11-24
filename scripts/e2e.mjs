import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = join(root, 'output', 'playwright')
const python = existsSync(join(root, '.venv', 'bin', 'python')) ? join(root, '.venv', 'bin', 'python') : 'python3'
const children = []
let browser
let page
let workDir
let succeeded = false

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

function startService(args, env = {}) {
  const child = spawn(python, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => logs.push(chunk.toString()))
  }
  children.push({ child, logs })
  return child
}

async function waitForHealth(url) {
  let lastError
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  throw new Error(`服务启动失败：${url}${lastError ? `（${lastError.message}）` : ''}`)
}

async function stopServices() {
  for (const { child } of children.reverse()) {
    if (child.exitCode !== null || child.signalCode) continue
    child.kill('SIGTERM')
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      delay(3000).then(() => child.kill('SIGKILL')),
    ])
  }
}

async function configureMock(page, mockUrl) {
  await page.getByRole('button', { name: 'API 设置' }).click()
  const sections = page.locator('.settings-section')
  const image = sections.nth(0)
  const llm = sections.nth(1)
  const imageModel = image.locator('.n-form-item').filter({ hasText: '模型' }).locator('.n-select')
  const llmModel = llm.locator('.n-form-item').filter({ hasText: '模型' }).locator('.n-select')
  await image.locator('input').nth(0).fill(`${mockUrl}/v1`)
  await image.locator('input').nth(1).fill('sk-mock-local')
  await llm.locator('input').nth(0).fill(`${mockUrl}/v1`)
  await llm.locator('input').nth(1).fill('sk-mock-local')
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/config/test') && response.request().postDataJSON().target === 'image'),
    image.getByRole('button', { name: '拉取模型' }).click(),
  ])
  await page.getByText('发现 2 个模型', { exact: true }).waitFor()
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/config/test') && response.request().postDataJSON().target === 'llm'),
    llm.getByRole('button', { name: '拉取模型' }).click(),
  ])
  await page.getByText('发现 2 个模型', { exact: true }).last().waitFor()
  await imageModel.click()
  await page.locator('.n-base-select-option').filter({ hasText: 'mock-sprite-sheet' }).click()
  assert.match(await imageModel.innerText(), /mock-sprite-sheet/)
  await llmModel.click()
  await llmModel.locator('input').fill('mock-prompt-polish')
  await llmModel.locator('input').press('Enter')
  assert.match(await llmModel.innerText(), /mock-prompt-polish/)
  await image.getByRole('button', { name: '测试连通' }).click()
  await page.getByText('连接成功，发现 2 个模型', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存设置' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
}

async function createArcher(page) {
  await page.getByRole('button', { name: '新建角色' }).click()
  await page.getByPlaceholder('例如：绿兜帽弓箭手').fill('E2E 弓箭手')
  await page.getByRole('button', { name: '创建并开始' }).click()
  await page.getByRole('heading', { name: '制作待机母版' }).waitFor()
  assert.match(page.url(), /\/projects\/[a-f0-9]{32}\/actions\/idle\/create$/)
}

async function workflowSteps(page) {
  return page.locator('.workflow-step').evaluateAll(elements => elements.map(element => ({
    done: element.classList.contains('done'),
    active: element.classList.contains('active'),
  })))
}

async function generateAndAssertEditor(page, heading) {
  await page.getByRole('button', { name: '开始生成' }).click()
  await page.waitForURL(/\/projects\/[a-f0-9]{32}\/actions\/[a-z0-9_]+\/editor/, { timeout: 30000 })
  await page.locator('.frame-card').first().waitFor({ state: 'visible' })
  assert.equal(await page.locator('.frame-card').count(), 8)
  assert.equal(await page.locator('.editor-heading h1').innerText(), heading)
  assert.equal(await page.locator('.n-modal').count(), 0)
  assert.ok(await page.evaluate(() => document.body.scrollHeight < 5000), '画布不应把页面撑到异常高度')
  assert.ok((await page.locator('.action-list').boundingBox())?.height < 180, '动作列表应保持紧凑')
  assert.equal(await page.locator('.editor-sidebar').count(), 0)
  assert.equal(await page.locator('.editor-page > .project-identity').count(), 1)
  assert.equal(await page.locator('.app-header .project-identity').count(), 0)
  assert.equal(await page.locator('.frame-strip').locator('xpath=ancestor::div[contains(@class, "n-scrollbar")][1]').count(), 1)
  assert.equal(await page.locator('.action-strip').locator('xpath=ancestor::div[contains(@class, "n-scrollbar")][1]').count(), 1)
  const timelineBox = await page.locator('.timeline-panel').boundingBox()
  assert.ok(timelineBox && timelineBox.y < 850, `时间轴应出现在笔记本首屏，当前 y=${timelineBox?.y}`)
}

try {
  await mkdir(artifacts, { recursive: true })
  workDir = await mkdtemp(join(artifacts, 'e2e-work-'))
  const backendPort = await freePort()
  const mockPort = await freePort()
  const backendUrl = `http://127.0.0.1:${backendPort}`
  const mockUrl = `http://127.0.0.1:${mockPort}`

  startService(['bridge/server.py', '--port', String(backendPort)], { PIXEL_ATELIER_WORK: workDir })
  startService(['tools/mock_api.py', '--port', String(mockPort)])
  await Promise.all([waitForHealth(`${backendUrl}/health`), waitForHealth(`${mockUrl}/health`)])

  const chromeCandidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean)
  const executablePath = chromeCandidates.find(candidate => existsSync(candidate))
  browser = await chromium.launch({ headless: true, executablePath })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto(backendUrl)
  await page.waitForURL(/\/works$/)
  assert.equal(await page.getByRole('navigation', { name: '当前角色导航' }).count(), 0)
  assert.equal(await page.locator('.project-identity').count(), 0)
  assert.equal(await page.getByText('未选择角色', { exact: true }).count(), 0)
  await configureMock(page, mockUrl)
  await createArcher(page)
  assert.equal(await page.getByRole('navigation', { name: '当前角色导航' }).count(), 1)
  await page.locator('.reference-upload input[type="file"]').setInputFiles([
    join(root, 'examples', 'knight', 'idle', 'atlas.png'),
    join(root, 'examples', 'knight', 'run', 'atlas.png'),
  ])
  await page.locator('.reference-thumb').nth(1).waitFor()
  assert.equal(await page.locator('.reference-thumb').count(), 2)
  await page.getByRole('button', { name: '移除参考图 atlas.png' }).first().click()
  assert.equal(await page.locator('.reference-thumb').count(), 1)
  await page.locator('.reference-upload input[type="file"]').setInputFiles([join(root, 'examples', 'knight', 'idle', 'atlas.png')])
  await page.locator('.reference-thumb').nth(1).waitFor()
  assert.equal(await page.locator('.reference-thumb').count(), 2)
  await page.locator('.idle-reference').screenshot({ path: join(artifacts, 'e2e-references.png') })
  await page.locator('.prompt-preview summary').click()
  assert.match(await page.locator('.prompt-preview pre').innerText(), /参考表包含 2 张同一角色的参考图/)
  await generateAndAssertEditor(page, '待机母版')

  await page.reload()
  await page.locator('.frame-card').first().waitFor({ state: 'visible' })
  assert.equal(await page.locator('.editor-heading h1').innerText(), '待机母版')
  assert.match(page.url(), /\/projects\/[a-f0-9]{32}\/actions\/idle\/editor$/)

  await page.getByRole('button', { name: '查看动作图表' }).click()
  await page.waitForURL(/\/projects\/[a-f0-9]{32}\/actions\/idle\/create$/)
  await page.getByRole('heading', { name: '查看动作图表' }).waitFor()
  assert.deepEqual(await workflowSteps(page), [
    { done: true, active: false },
    { done: true, active: false },
    { done: false, active: true },
    { done: false, active: false },
  ])
  await page.locator('.sheet-preview img').waitFor({ state: 'visible' })
  await page.locator('.sheet-prompt summary').click()
  const promptScroll = await page.locator('.sheet-prompt .n-scrollbar-container').evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  assert.ok(promptScroll.clientHeight <= 280, '制作稿滚动区应限制高度')
  assert.ok(promptScroll.scrollHeight > promptScroll.clientHeight, '长制作稿应使用内部滚动')
  await page.screenshot({ path: join(artifacts, 'e2e-sheet.png'), fullPage: true })
  await page.getByRole('button', { name: '编辑帧' }).click()
  await page.waitForURL(/\/projects\/[a-f0-9]{32}\/actions\/idle\/editor/)
  await page.locator('.frame-card').first().waitFor({ state: 'visible' })

  await page.getByRole('button', { name: '复制当前动作' }).click()
  await page.getByRole('heading', { name: '待机母版 · 副本', exact: true }).waitFor()
  await page.locator('.editor-page[aria-busy="false"]').waitFor()
  await page.getByRole('button', { name: '删除当前动作' }).click()
  await page.getByRole('button', { name: '确认删除当前动作' }).click()
  await page.getByRole('heading', { name: '待机母版', exact: true }).waitFor()
  await page.locator('.editor-page[aria-busy="false"]').waitFor()

  const stage = page.locator('.sprite-stage')
  assert.equal(await stage.innerText(), 'FRAME 01 / 8')
  await page.getByRole('button', { name: '播放动画' }).click()
  await page.waitForTimeout(350)
  assert.notEqual(await stage.innerText(), 'FRAME 01 / 8')
  await page.getByRole('button', { name: '暂停动画' }).click()

  await page.getByRole('button', { name: '选择第 3 帧' }).click()
  const duration = page.getByRole('textbox', { name: '当前帧停留时长' })
  const offset = page.getByRole('textbox', { name: '水平偏移' })
  await duration.fill('120')
  await duration.press('Tab')
  await offset.fill('4')
  await offset.press('Tab')
  await page.waitForFunction(() => document.querySelector('.save-state')?.textContent !== '已自动保存')
  await page.waitForFunction(() => document.querySelector('.save-state')?.textContent === '已自动保存')
  await page.reload()
  await page.locator('.frame-card').first().waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '选择第 3 帧' }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前帧停留时长' }).inputValue(), '120')
  assert.equal(await page.getByRole('textbox', { name: '水平偏移' }).inputValue(), '4')

  const idleFinalizeBar = page.locator('.idle-finalize-bar')
  await idleFinalizeBar.getByRole('button', { name: '定稿待机并设为母版' }).click()
  await page.getByText('色板已冻结', { exact: true }).waitFor()
  const updateMaster = idleFinalizeBar.getByRole('button', { name: '更新母版' })
  await updateMaster.waitFor()
  await page.locator('.stage-badge').filter({ hasText: 'FRAME 03 / 8' }).waitFor()
  await page.getByRole('button', { name: '选择第 2 帧' }).click()
  await page.locator('.stage-badge').filter({ hasText: 'FRAME 02 / 8' }).waitFor()
  await updateMaster.click()
  const projectId = page.url().match(/\/projects\/([a-f0-9]{32})\//)[1]
  assert.deepEqual(await page.evaluate(async id => {
    const project = await (await fetch(`/project/${id}`)).json()
    return project.masterBasis
  }, projectId), { action: 'idle', frame: 1 })

  await page.getByRole('button', { name: '复制当前动作' }).click()
  await page.getByRole('heading', { name: '待机母版 · 副本', exact: true }).waitFor()
  assert.match(page.url(), /\/actions\/idle_2\/editor$/)
  await idleFinalizeBar.getByRole('button', { name: '更换为当前待机母版' }).click()
  assert.deepEqual(await page.evaluate(async id => {
    const project = await (await fetch(`/project/${id}`)).json()
    return project.masterBasis
  }, projectId), { action: 'idle_2', frame: 0 })
  await page.locator('.action-chip').first().click()
  await page.getByRole('heading', { name: '待机母版', exact: true }).waitFor()
  await idleFinalizeBar.getByRole('button', { name: '更换为当前待机母版' }).click()
  await page.locator('.action-chip').filter({ hasText: '待机母版 · 副本' }).click()
  await page.getByRole('heading', { name: '待机母版 · 副本', exact: true }).waitFor()
  await page.getByRole('button', { name: '删除当前动作' }).click()
  await page.getByRole('button', { name: '确认删除当前动作' }).click()
  await page.getByRole('heading', { name: '待机母版', exact: true }).waitFor()
  await idleFinalizeBar.getByRole('button', { name: '更新母版' }).waitFor()

  await page.locator('.editor-heading').getByRole('button', { name: '导出当前动作' }).click()
  await page.locator('.n-modal').waitFor({ state: 'visible' })
  assert.match(await page.locator('.export-stats strong').innerText(), /^8 帧/)
  const gifUrl = await page.getByRole('link', { name: '下载 GIF' }).getAttribute('href')
  const zipUrl = await page.getByRole('link', { name: '下载完整资源包' }).getAttribute('href')
  const downloads = await page.evaluate(async urls => Promise.all(urls.map(async url => {
    const response = await fetch(url)
    return { status: response.status, type: response.headers.get('content-type'), bytes: (await response.arrayBuffer()).byteLength }
  })), [gifUrl, zipUrl])
  assert.deepEqual(downloads.map(item => item.status), [200, 200])
  assert.ok(downloads.every(item => item.bytes > 100))
  await page.keyboard.press('Escape')
  await page.locator('.n-modal').waitFor({ state: 'hidden' })

  await page.getByRole('button', { name: /行走.*待制作.*制作/ }).click()
  await page.waitForURL(/\/projects\/[a-f0-9]{32}\/actions\/walk\/create/)
  await page.getByText('角色母版已锁定', { exact: true }).waitFor()
  await generateAndAssertEditor(page, '行走')
  const walkDeepLink = page.url()
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), '外层页面不应滚动')
  const contentScroll = page.locator('.app-content-scroll > .n-scrollbar-container')
  assert.ok(await contentScroll.evaluate(element => element.scrollHeight > element.clientHeight), '行走编辑内容应在内部滚动')
  await page.locator('.editor-page[aria-busy="false"]').waitFor()
  await page.locator('.editor-heading').hover()
  await page.mouse.wheel(0, 600)
  await page.waitForFunction(() => document.querySelector('.app-content-scroll > .n-scrollbar-container')?.scrollTop > 0)
  assert.equal(await page.evaluate(() => window.scrollY), 0, '滚动只发生在内容区')
  assert.equal((await page.locator('.app-header').boundingBox())?.y, 0, '顶栏应保持固定')
  await page.getByRole('navigation', { name: '全局导航' }).getByRole('button', { name: '作品' }).evaluate(button => button.click())
  await page.waitForURL(/\/works$/)
  await page.waitForFunction(() => document.querySelector('.app-content-scroll > .n-scrollbar-container')?.scrollTop === 0)
  assert.equal(await page.evaluate(() => window.scrollY), 0, '切换页面类型后内容区应回到页首')
  assert.equal(await page.getByRole('navigation', { name: '当前角色导航' }).count(), 0)
  assert.equal(await page.locator('.project-identity').count(), 0)
  assert.equal(await page.getByText('未选择角色', { exact: true }).count(), 0)
  assert.equal(await page.locator('.project-identity').getByText('E2E 弓箭手', { exact: true }).count(), 0)
  await page.screenshot({ path: join(artifacts, 'e2e-works.png'), fullPage: true })
  const originalProjectId = walkDeepLink.match(/\/projects\/([a-f0-9]{32})\//)?.[1]

  await page.getByRole('button', { name: '新建角色' }).click()
  await page.getByPlaceholder('例如：绿兜帽弓箭手').fill('E2E 导入目标')
  await page.locator('.template-option').filter({ hasText: '空白角色' }).click()
  await page.getByRole('button', { name: '创建并开始' }).click()
  await page.waitForURL(/\/projects\/[a-f0-9]{32}\/actions\/idle\/create$/)
  await page.getByRole('button', { name: '导入母版作为参考' }).click()
  const importDialog = page.locator('.master-import-modal')
  await importDialog.waitFor()
  assert.match(await importDialog.locator('.import-note').innerText(), /不会定稿当前角色/)
  await importDialog.locator('.master-option').filter({ hasText: 'E2E 弓箭手' }).click()
  await importDialog.locator('.master-preview img').waitFor()
  await page.screenshot({ path: join(artifacts, 'e2e-master-import.png') })
  await importDialog.getByRole('button', { name: '使用这个参考母版' }).click()
  await importDialog.waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.reference-thumb').count(), 1)
  assert.match(await page.locator('.reference-thumb').innerText(), /E2E 弓箭手 · 待机母版/)
  assert.match(await page.locator('.reference-thumb').innerText(), /其他角色母版/)
  await generateAndAssertEditor(page, '待机母版')
  const importedFinalizeBar = page.locator('.idle-finalize-bar')
  await importedFinalizeBar.waitFor()
  const importedFinalize = importedFinalizeBar.getByRole('button', { name: '定稿待机并设为母版' })
  assert.ok(await importedFinalize.count() > 0, '待机编辑页必须提供定稿入口')
  const importedContentScroll = page.locator('.app-content-scroll > .n-scrollbar-container')
  await importedContentScroll.evaluate(element => { element.scrollTop = element.scrollHeight * 0.55 })
  assert.ok(await importedFinalize.evaluate(button => {
    const rect = button.getBoundingClientRect()
    const container = document.querySelector('.app-content-scroll > .n-scrollbar-container').getBoundingClientRect()
    return rect.top >= container.top && rect.bottom <= container.bottom
  }), '滚到帧编辑中段后仍应看得到定稿母版入口')
  await importedFinalize.click()
  await page.getByText('色板已冻结', { exact: true }).waitFor()
  await importedFinalizeBar.getByRole('button', { name: '更新母版' }).waitFor()
  await page.getByRole('button', { name: '查看动作图表' }).click()
  await page.waitForURL(/\/projects\/[a-f0-9]{32}\/actions\/idle\/create$/)
  await page.locator('.next-card h2').filter({ hasText: '检查并交付' }).waitFor()
  assert.deepEqual(await workflowSteps(page), Array.from({ length: 4 }, () => ({ done: true, active: false })))
  await page.getByRole('navigation', { name: '全局导航' }).getByRole('button', { name: '作品' }).click()
  await page.waitForURL(/\/works$/)

  await page.locator('.project-card').filter({ hasText: 'E2E 弓箭手' }).getByRole('button', { name: '复制' }).click()
  const cloneCard = page.locator('.project-card').filter({ hasText: 'E2E 弓箭手 · 副本' })
  await cloneCard.waitFor()
  await cloneCard.getByRole('button', { name: '打开' }).click()
  await page.waitForURL(/\/projects\/[a-f0-9]{32}\/actions\/idle\/create/)
  const cloneProjectId = page.url().match(/\/projects\/([a-f0-9]{32})\//)?.[1]
  assert.ok(cloneProjectId && cloneProjectId !== originalProjectId)
  assert.equal(await page.locator('.project-identity').getByText('E2E 弓箭手 · 副本', { exact: true }).count(), 1)
  await page.goto(walkDeepLink)
  await page.locator('.frame-card').first().waitFor({ state: 'visible' })
  assert.equal(await page.locator('.editor-heading h1').innerText(), '行走')
  await page.screenshot({ path: join(artifacts, 'e2e-editor.png'), fullPage: true })
  assert.equal(await page.getByText('2 / 9 动作', { exact: true }).count(), 1)

  await page.setViewportSize({ width: 390, height: 844 })
  const horizontalScrolls = await page.evaluate(() => ['.action-strip', '.frame-strip'].map(selector => {
    const content = document.querySelector(selector)
    const container = content.closest('.n-scrollbar-container')
    return { selector, scrollWidth: container.scrollWidth, clientWidth: container.clientWidth }
  }))
  assert.ok(horizontalScrolls.every(item => item.scrollWidth > item.clientWidth), '窄屏动作条与时间轴应可横向滚动')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '窄屏页面不应横向溢出')
  await page.screenshot({ path: join(artifacts, 'e2e-editor-mobile.png'), fullPage: true })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${backendUrl}/#/projects/${originalProjectId}/actions/shoot_right/create`)
  await page.getByRole('button', { name: '开始生成' }).waitFor()
  await fetch(`${mockUrl}/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ return_url: true, fail_downloads: 3 }),
  })
  const beforeInterruptedGeneration = await fetch(`${mockUrl}/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  }).then(response => response.json())
  await page.getByRole('button', { name: '开始生成' }).click()
  await page.locator('.job-alert').waitFor({ timeout: 30000 })
  const resumeButton = page.getByRole('button', { name: '继续下载（不重新生图）' })
  await resumeButton.waitFor()
  const afterInterruptedGeneration = await fetch(`${mockUrl}/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  }).then(response => response.json())
  assert.equal(afterInterruptedGeneration.generation_requests - beforeInterruptedGeneration.generation_requests, 1)
  await fetch(`${mockUrl}/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fail_downloads: 0 }),
  })
  await resumeButton.click()
  await page.waitForURL(/\/projects\/[a-f0-9]{32}\/actions\/shoot_right\/editor/, { timeout: 30000 })
  await page.locator('.frame-card').first().waitFor({ state: 'visible' })
  assert.equal(await page.locator('.frame-card').count(), 8)
  const afterResume = await fetch(`${mockUrl}/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  }).then(response => response.json())
  assert.equal(afterResume.generation_requests, afterInterruptedGeneration.generation_requests, '继续下载不应重新请求生图')
  assert.deepEqual(errors, [])

  console.log(JSON.stringify({
    ok: true,
    autoSliceFrames: 8,
    persistedFrame: { duration: 120, offsetX: 4 },
    masterFrozen: true,
    exports: downloads,
    secondAction: '行走',
    sheetPreview: true,
    routeDeepLink: true,
    characterSwitch: true,
    globalPageClearsCharacter: true,
    multipleReferences: true,
    importedMasterAsReference: true,
    downloadResumeWithoutRegeneration: true,
    screenshot: 'output/playwright/e2e-editor.png',
  }, null, 2))
  succeeded = true
} catch (error) {
  console.error(error)
  if (page) {
    console.error('页面地址：', page.url())
    console.error('保存状态：', await page.locator('.save-state').allTextContents())
    console.error('页面尾部：', (await page.locator('body').innerText()).slice(-1200))
    await page.screenshot({ path: join(artifacts, 'e2e-failure.png'), fullPage: true })
  }
  if (workDir) console.error(`测试工作目录已保留：${workDir}`)
  process.exitCode = 1
} finally {
  await browser?.close()
  await stopServices()
  if (succeeded && workDir) await rm(workDir, { recursive: true, force: true })
}
