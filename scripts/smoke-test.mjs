import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = await mkdtemp(path.join(tmpdir(), 'a-stock-assistant-'))
const port = 8799
const baseUrl = `http://127.0.0.1:${port}`

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: rootDir,
  env: {
    ...process.env,
    APP_SECRET: 'smoke-test-secret',
    DATA_DIR: dataDir,
    MARKET_PROVIDER: 'itick',
    STRICT_REALTIME: 'true',
    PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''
server.stdout.on('data', (chunk) => {
  stdout += chunk.toString()
})
server.stderr.on('data', (chunk) => {
  stderr += chunk.toString()
})

const request = async (url, options = {}) => {
  const response = await fetch(`${baseUrl}${url}`, options)
  const body = await response.text()
  return { response, data: body ? JSON.parse(body) : null }
}

const waitForHealth = async () => {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`server exited early\nstdout:\n${stdout}\nstderr:\n${stderr}`)
    }
    try {
      const { response, data } = await request('/api/health')
      if (response.ok && data?.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  throw new Error(`server did not become healthy\nstdout:\n${stdout}\nstderr:\n${stderr}`)
}

try {
  await waitForHealth()

  const register = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ realName: '测试用户', phone: '13800138000' }),
  })
  assert.equal(register.response.status, 200)
  assert.ok(register.data.token)
  assert.equal(register.data.user.realName, '测试用户')
  assert.equal(register.data.user.phoneMasked, '138****8000')

  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ realName: '测试用户', phone: '13800138000' }),
  })
  assert.equal(login.response.status, 200)

  const headers = {
    Authorization: `Bearer ${register.data.token}`,
    'Content-Type': 'application/json',
  }

  const emptyPortfolio = await request('/api/portfolio', { headers })
  assert.equal(emptyPortfolio.response.status, 200)
  assert.equal(emptyPortfolio.data.holdings.length, 0)
  assert.equal(emptyPortfolio.data.watchlist.length, 0)

  const market = await request('/api/market?stocks=sh600000')
  assert.equal(market.response.status, 200)
  assert.ok(Array.isArray(market.data.stocks))

  const kline = await request('/api/market/kline?stock=sh600000&limit=20')
  assert.equal(kline.response.status, 200)
  assert.equal(kline.data.stock.code, '600000')
  assert.ok(Array.isArray(kline.data.bars))
  assert.ok(kline.data.analysis.summary)

  const lookup = await request('/api/stocks/lookup?code=600000')
  assert.equal(lookup.response.status, 200)
  assert.equal(lookup.data.stock.code, '600000')
  assert.equal(lookup.data.stock.market, 'sh')
  assert.ok(lookup.data.stock.name)
  assert.notEqual(lookup.data.stock.name, '600000')

  const watch = await request('/api/watchlist', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: '600000',
      name: '',
      note: '观察低估值银行',
    }),
  })
  assert.equal(watch.response.status, 200)
  assert.equal(watch.data.stock.code, '600000')
  assert.equal(watch.data.stock.market, 'sh')
  assert.ok(watch.data.stock.name)

  const holding = await request('/api/holdings', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: '000001',
      cost: 10.2,
      shares: 100,
      targetWeight: 20,
      risk: '均衡',
      theme: '银行',
      planAmount: 500,
      note: '核心观察仓',
    }),
  })
  assert.equal(holding.response.status, 200)
  assert.equal(holding.data.holding.shares, 100)
  assert.equal(holding.data.holding.kind, undefined)

  const update = await request(`/api/holdings/${holding.data.holding.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ targetWeight: 22, shares: 120 }),
  })
  assert.equal(update.response.status, 200)
  assert.equal(update.data.holding.targetWeight, 22)
  assert.equal(update.data.holding.shares, 120)

  const upload = await request('/api/imports', {
    method: 'POST',
    headers,
    body: JSON.stringify({ fileName: 'stock-position.png', imageData: 'data:image/png;base64,AA==', notes: 'A股持仓截图' }),
  })
  assert.equal(upload.response.status, 200)
  assert.equal(upload.data.importRecord.status, '已保存，待人工校对')

  const portfolio = await request('/api/portfolio', { headers })
  assert.equal(portfolio.response.status, 200)
  assert.equal(portfolio.data.holdings.length, 1)
  assert.equal(portfolio.data.watchlist.length, 1)

  const analysis = await request('/api/analysis', { headers })
  assert.equal(analysis.response.status, 200)
  assert.ok(analysis.data.items.length >= 2)
  assert.ok(analysis.data.items[0].links.newsSearch)
  assert.ok(analysis.data.items[0].technical.summary)

  const removeHolding = await request(`/api/holdings/${holding.data.holding.id}`, { method: 'DELETE', headers })
  assert.equal(removeHolding.response.status, 200)
  const removeWatch = await request(`/api/watchlist/${watch.data.stock.id}`, { method: 'DELETE', headers })
  assert.equal(removeWatch.response.status, 200)
} finally {
  if (server.exitCode === null) {
    server.kill()
    await new Promise((resolve) => server.once('close', resolve))
  }
  await rm(dataDir, { recursive: true, force: true })
}
