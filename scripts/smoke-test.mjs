import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = await mkdtemp(path.join(tmpdir(), 'family-invest-'))
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
  let data = null
  if (body) {
    data = JSON.parse(body)
  }
  return { response, data }
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
    body: JSON.stringify({ displayName: '测试用户', relation: '本人', passcode: '1234' }),
  })
  assert.equal(register.response.status, 200)
  assert.ok(register.data.token)
  assert.equal(register.data.user.relation, '本人')

  const headers = {
    Authorization: `Bearer ${register.data.token}`,
    'Content-Type': 'application/json',
  }

  const portfolio = await request('/api/portfolio', { headers })
  assert.equal(portfolio.response.status, 200)
  assert.ok(portfolio.data.holdings.length >= 7)
  assert.equal(portfolio.data.snapshot.totalAmount, 1537.88)

  const market = await request('/api/market?funds=021190&stocks=sh600000')
  assert.equal(market.response.status, 200)
  assert.equal(market.data.funds[0].verified, false)
  assert.match(market.data.funds[0].warning, /授权|密钥|未配置/)

  const create = await request('/api/holdings', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      owner: '我',
      kind: 'stock',
      code: '600000',
      market: 'sh',
      name: '浦发银行',
      cost: 8.8,
      units: 100,
      targetWeight: 5,
      risk: '均衡',
      theme: '银行',
      planAmount: 0,
    }),
  })
  assert.equal(create.response.status, 200)
  assert.equal(create.data.holding.code, '600000')

  const update = await request(`/api/holdings/${create.data.holding.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ targetWeight: 6 }),
  })
  assert.equal(update.response.status, 200)
  assert.equal(update.data.holding.targetWeight, 6)

  const upload = await request('/api/imports', {
    method: 'POST',
    headers,
    body: JSON.stringify({ fileName: 'alipay.png', imageData: 'data:image/png;base64,AA==' }),
  })
  assert.equal(upload.response.status, 200)
  assert.equal(upload.data.importRecord.status, '已保存，待人工校对')

  const remove = await request(`/api/holdings/${create.data.holding.id}`, { method: 'DELETE', headers })
  assert.equal(remove.response.status, 200)
  assert.equal(remove.data.ok, true)
} finally {
  if (server.exitCode === null) {
    server.kill()
    await new Promise((resolve) => server.once('close', resolve))
  }
  await rm(dataDir, { recursive: true, force: true })
}
