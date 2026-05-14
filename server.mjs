import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const port = Number(process.env.PORT || 8787)
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data')
const dbFile = path.join(dataDir, 'db.json')
const distDir = path.join(__dirname, 'dist')
const appSecret = process.env.APP_SECRET || 'local-dev-secret-change-before-cloud'
const strictRealtime = String(process.env.STRICT_REALTIME || '').toLowerCase() === 'true'
const marketProvider = (process.env.MARKET_PROVIDER || 'itick').toLowerCase()
const quoteCache = new Map()
const quoteCacheTtlMs = Number(process.env.QUOTE_CACHE_TTL_MS || 45_000)

app.use(cors())
app.use(express.json({ limit: '12mb' }))

const defaultDb = () => ({
  users: [],
  holdings: {},
  watchlist: {},
  imports: {},
})

const ensureDb = () => {
  mkdirSync(dataDir, { recursive: true })
  if (!existsSync(dbFile)) writeDb(defaultDb())
}

const readDb = () => {
  ensureDb()
  const parsed = JSON.parse(readFileSync(dbFile, 'utf8'))
  return {
    ...defaultDb(),
    ...parsed,
    users: parsed.users || [],
    holdings: parsed.holdings || {},
    watchlist: parsed.watchlist || {},
    imports: parsed.imports || {},
  }
}

function writeDb(db) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(dbFile, `${JSON.stringify(db, null, 2)}\n`, 'utf8')
}

const nowIso = () => new Date().toISOString()
const createId = (prefix) => `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
const normalizeCode = (value) => String(value || '').trim().replace(/\D/g, '')
const normalizePhone = (value) => String(value || '').trim().replace(/\D/g, '')
const normalizeMarket = (value) => {
  const market = String(value || '').toLowerCase()
  return ['sh', 'sz', 'bj'].includes(market) ? market : 'sh'
}
const inferMarket = (code) => {
  if (/^(60|68|90)/.test(code)) return 'sh'
  if (/^(00|30|20)/.test(code)) return 'sz'
  if (/^(43|83|87|88|92)/.test(code)) return 'bj'
  return 'sh'
}
const asNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}
const phoneMasked = (phone) => (phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone)

const publicUser = (user) => ({
  id: user.id,
  realName: user.realName,
  phoneMasked: phoneMasked(user.phone),
})

const signPayload = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', appSecret).update(body).digest('base64url')
  return `${body}.${signature}`
}

const verifyToken = (token) => {
  const [body, signature] = String(token || '').split('.')
  if (!body || !signature) return null
  const expected = crypto.createHmac('sha256', appSecret).update(body).digest('base64url')
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  if (!payload.userId || asNumber(payload.expiresAt) < Date.now()) return null
  return payload
}

const tokenFor = (user) =>
  signPayload({
    userId: user.id,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,
  })

const requireAuth = (req, res, next) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const payload = verifyToken(token)
  if (!payload) {
    res.status(401).json({ error: '请先登录' })
    return
  }
  const db = readDb()
  const user = db.users.find((item) => item.id === payload.userId)
  if (!user) {
    res.status(401).json({ error: '账户不存在' })
    return
  }
  req.db = db
  req.user = user
  next()
}

const validateIdentityInput = ({ realName, phone }) => {
  if (!String(realName || '').trim()) return '请输入真实姓名'
  const normalizedPhone = normalizePhone(phone)
  if (normalizedPhone.length < 7) return '请输入有效电话号码'
  return ''
}

const findUser = (db, realName, phone) =>
  db.users.find(
    (user) =>
      user.realName === String(realName || '').trim() &&
      user.phone === normalizePhone(phone),
  )

const normalizeStockInput = (input, existing = {}) => {
  const code = normalizeCode(input.code ?? existing.code)
  const market = input.market || existing.market ? normalizeMarket(input.market ?? existing.market) : inferMarket(code)
  return {
    ...existing,
    code,
    market,
    name: String(input.name ?? existing.name ?? code).trim() || code,
    theme: String(input.theme ?? existing.theme ?? '').trim(),
    note: String(input.note ?? existing.note ?? '').trim(),
  }
}

const enrichStock = async (stock) => {
  if (!stock.code) return stock
  const quote = await queryItickStock({ market: stock.market, code: stock.code })
  return {
    ...stock,
    name: stock.name && stock.name !== stock.code ? stock.name : quote.name || stock.code,
    theme: stock.theme || autoTheme(stock.code, quote.name),
    quote,
  }
}

const autoTheme = (code, name = '') => {
  if (/银行/.test(name)) return '银行'
  if (/证券|券商/.test(name)) return '证券'
  if (/电力|能源/.test(name)) return '能源'
  if (/科技|软件|信息/.test(name)) return '科技'
  if (/^(60|68)/.test(code)) return '沪市A股'
  if (/^(00|30)/.test(code)) return '深市A股'
  if (/^(43|83|87|88|92)/.test(code)) return '北交所'
  return 'A股'
}

const normalizeHolding = (input, existing = {}) => ({
  ...normalizeStockInput(input, existing),
  cost: asNumber(input.cost ?? existing.cost),
  shares: asNumber(input.shares ?? existing.shares),
  targetWeight: asNumber(input.targetWeight ?? existing.targetWeight),
  risk: ['保守', '均衡', '进取'].includes(input.risk) ? input.risk : existing.risk || '均衡',
  planAmount: asNumber(input.planAmount ?? existing.planAmount),
})

const stockValue = (holding, quote) => holding.shares * (quote?.price ?? holding.cost)

const providerMissingQuote = (code, name = code) => ({
  code,
  name,
  source: 'unavailable',
  updatedAt: nowIso(),
  verified: false,
  fallback: true,
  warning: '未配置授权实时行情密钥，A股实时数据未验证，已暂停交易建议',
})

const extractObject = (payload) => {
  if (!payload || typeof payload !== 'object') return {}
  if (payload.data && typeof payload.data === 'object') return Array.isArray(payload.data) ? payload.data[0] || {} : payload.data
  if (payload.result && typeof payload.result === 'object') return Array.isArray(payload.result) ? payload.result[0] || {} : payload.result
  return payload
}

const pickNumber = (object, keys) => {
  for (const key of keys) {
    const number = Number(object?.[key])
    if (Number.isFinite(number)) return number
  }
  return null
}

const pickString = (object, keys, fallback) => {
  for (const key of keys) {
    const value = object?.[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return fallback
}

const fetchJson = async (url, token) => {
  const headers = token ? { Authorization: `Bearer ${token}`, token } : {}
  const response = await fetch(url, { headers })
  if (!response.ok) {
    const error = new Error(`行情接口返回 ${response.status}`)
    error.status = response.status
    throw error
  }
  return response.json()
}

const withQuoteCache = async (key, producer) => {
  const cached = quoteCache.get(key)
  if (cached && Date.now() - cached.savedAt < quoteCacheTtlMs) return cached.value
  const value = await producer()
  quoteCache.set(key, { savedAt: Date.now(), value })
  return value
}

const buildItickUrl = (pathName, params) => {
  const base = process.env.ITICK_BASE_URL || 'https://api-free.itick.org'
  const url = new URL(pathName, base)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value)
  }
  if (process.env.ITICK_TOKEN) url.searchParams.set('token', process.env.ITICK_TOKEN)
  return url
}

const queryItickStock = async ({ market, code }) => {
  if (!process.env.ITICK_TOKEN) return providerMissingQuote(code)
  const region = market === 'sh' ? 'SH' : market === 'sz' ? 'SZ' : 'BJ'
  return withQuoteCache(`itick-stock-${region}-${code}`, async () => {
    const url = buildItickUrl('/stock/quote', { region, code })
    try {
      const payload = extractObject(await fetchJson(url, process.env.ITICK_TOKEN))
      const price = pickNumber(payload, ['price', 'last', 'latestPrice', 'lastPrice', 'close', 'ld', 'p'])
      if (price === null) throw new Error('行情接口缺少价格字段')
      return {
        code,
        name: pickString(payload, ['name', 'symbolName', 'securityName'], code),
        price,
        changePct: pickNumber(payload, ['changePct', 'percent', 'rate', 'change_percent', 'chp']),
        source: 'itick',
        updatedAt: nowIso(),
        verified: true,
      }
    } catch (error) {
      return {
        ...providerMissingQuote(code),
        source: 'itick-error',
        warning:
          error?.status === 429
            ? '授权行情接口当前限流，稍后会自动重试；为避免虚假数据，已暂停交易建议'
            : `授权行情接口未返回可用A股报价：${error?.message || '未知错误'}`,
      }
    }
  })
}

const parseStocks = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^(sh|sz|bj)?(\d{6})$/)
      if (!match) return null
      return { market: match[1] || 'sh', code: match[2] }
    })
    .filter(Boolean)

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    time: nowIso(),
    dataDir,
    marketProvider,
    strictRealtime,
    hasAuthorizedMarketToken: Boolean(process.env.ITICK_TOKEN),
    assetScope: 'a-stocks-only',
  })
})

app.post('/api/auth/register', (req, res) => {
  const error = validateIdentityInput(req.body || {})
  if (error) {
    res.status(400).json({ error })
    return
  }
  const db = readDb()
  const realName = String(req.body.realName).trim()
  const phone = normalizePhone(req.body.phone)
  let user = findUser(db, realName, phone)
  if (!user) {
    user = { id: createId('user'), realName, phone, createdAt: nowIso() }
    db.users.push(user)
    db.holdings[user.id] = []
    db.watchlist[user.id] = []
    db.imports[user.id] = []
    writeDb(db)
  }
  res.json({ token: tokenFor(user), user: publicUser(user) })
})

app.post('/api/auth/login', (req, res) => {
  const error = validateIdentityInput(req.body || {})
  if (error) {
    res.status(400).json({ error })
    return
  }
  const db = readDb()
  const user = findUser(db, req.body.realName, req.body.phone)
  if (!user) {
    res.status(401).json({ error: '真实姓名或电话号码不正确' })
    return
  }
  res.json({ token: tokenFor(user), user: publicUser(user) })
})

app.get('/api/session', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

app.get('/api/portfolio', requireAuth, (req, res) => {
  res.json({
    user: publicUser(req.user),
    holdings: req.db.holdings[req.user.id] || [],
    watchlist: req.db.watchlist[req.user.id] || [],
    imports: req.db.imports[req.user.id] || [],
  })
})

app.get('/api/stocks/lookup', async (req, res) => {
  const code = normalizeCode(req.query.code)
  if (code.length !== 6) {
    res.status(400).json({ error: '请输入6位股票代码' })
    return
  }
  const base = { code, market: inferMarket(code), name: code, theme: '' }
  const stock = await enrichStock(base)
  res.json({ stock })
})

app.post('/api/holdings', requireAuth, async (req, res) => {
  const holding = await enrichStock(normalizeHolding(req.body || {}))
  if (!holding.code || !holding.name) {
    res.status(400).json({ error: '请填写股票代码和名称' })
    return
  }
  holding.id = createId('holding')
  holding.createdAt = nowIso()
  req.db.holdings[req.user.id] = [...(req.db.holdings[req.user.id] || []), holding]
  writeDb(req.db)
  res.json({ holding })
})

app.patch('/api/holdings/:id', requireAuth, async (req, res) => {
  const holdings = req.db.holdings[req.user.id] || []
  const index = holdings.findIndex((item) => item.id === req.params.id)
  if (index === -1) {
    res.status(404).json({ error: '持仓不存在' })
    return
  }
  const holding = { ...(await enrichStock(normalizeHolding(req.body || {}, holdings[index]))), id: holdings[index].id, createdAt: holdings[index].createdAt }
  holdings[index] = holding
  req.db.holdings[req.user.id] = holdings
  writeDb(req.db)
  res.json({ holding })
})

app.delete('/api/holdings/:id', requireAuth, (req, res) => {
  req.db.holdings[req.user.id] = (req.db.holdings[req.user.id] || []).filter((item) => item.id !== req.params.id)
  writeDb(req.db)
  res.json({ ok: true })
})

app.post('/api/watchlist', requireAuth, async (req, res) => {
  const stock = await enrichStock(normalizeStockInput(req.body || {}))
  if (!stock.code || !stock.name) {
    res.status(400).json({ error: '请填写股票代码和名称' })
    return
  }
  stock.id = createId('watch')
  stock.createdAt = nowIso()
  req.db.watchlist[req.user.id] = [...(req.db.watchlist[req.user.id] || []), stock]
  writeDb(req.db)
  res.json({ stock })
})

app.patch('/api/watchlist/:id', requireAuth, async (req, res) => {
  const watchlist = req.db.watchlist[req.user.id] || []
  const index = watchlist.findIndex((item) => item.id === req.params.id)
  if (index === -1) {
    res.status(404).json({ error: '自选股不存在' })
    return
  }
  const stock = { ...(await enrichStock(normalizeStockInput(req.body || {}, watchlist[index]))), id: watchlist[index].id, createdAt: watchlist[index].createdAt }
  watchlist[index] = stock
  req.db.watchlist[req.user.id] = watchlist
  writeDb(req.db)
  res.json({ stock })
})

app.delete('/api/watchlist/:id', requireAuth, (req, res) => {
  req.db.watchlist[req.user.id] = (req.db.watchlist[req.user.id] || []).filter((item) => item.id !== req.params.id)
  writeDb(req.db)
  res.json({ ok: true })
})

app.post('/api/imports', requireAuth, (req, res) => {
  if (!String(req.body?.fileName || '').trim() || !String(req.body?.imageData || '').startsWith('data:image/')) {
    res.status(400).json({ error: '请上传A股持仓或自选截图' })
    return
  }
  const importRecord = {
    id: createId('import'),
    fileName: String(req.body.fileName).trim(),
    notes: String(req.body.notes || '').trim(),
    status: '已保存，待人工校对',
    createdAt: nowIso(),
  }
  req.db.imports[req.user.id] = [importRecord, ...(req.db.imports[req.user.id] || [])].slice(0, 50)
  writeDb(req.db)
  res.json({ importRecord })
})

app.get('/api/market', async (req, res) => {
  const stocks = parseStocks(req.query.stocks)
  let stockQuotes = []
  if (marketProvider === 'itick') {
    stockQuotes = await Promise.all(stocks.map((stock) => queryItickStock(stock)))
  } else {
    stockQuotes = stocks.map((stock) => providerMissingQuote(stock.code))
  }
  res.json({ stocks: stockQuotes, updatedAt: nowIso() })
})

app.get('/api/advice', requireAuth, async (req, res) => {
  const holdings = req.db.holdings[req.user.id] || []
  const stocks = holdings.map((holding) => `${holding.market}${holding.code}`)
  const quotes = await Promise.all(parseStocks(stocks.join(',')).map((stock) => queryItickStock(stock)))
  const total = holdings.reduce((sum, holding) => {
    const quote = quotes.find((item) => item.code === holding.code)
    return sum + stockValue(holding, quote)
  }, 0)
  const advice = holdings.map((holding) => {
    const quote = quotes.find((item) => item.code === holding.code)
    const value = stockValue(holding, quote)
    const gain = holding.cost > 0 ? (((quote?.price ?? holding.cost) - holding.cost) / holding.cost) * 100 : 0
    const weight = total > 0 ? (value / total) * 100 : 0
    if (!quote?.verified) {
      return {
        id: holding.id,
        stock: holding,
        tone: 'watch',
        action: '实时行情未验证，暂不执行交易',
        confidence: 30,
        reasons: [quote?.warning || '行情源暂不可用'],
      }
    }
    if ((quote.changePct ?? 0) <= -1.5 && weight + 2 < holding.targetWeight && holding.planAmount > 0) {
      return {
        id: holding.id,
        stock: holding,
        tone: 'buy',
        action: `可考虑分批加仓 ${holding.planAmount.toFixed(0)} 元`,
        confidence: 70,
        reasons: [`今日涨跌 ${Number(quote.changePct).toFixed(2)}%`, `当前仓位约 ${weight.toFixed(1)}%，低于目标 ${holding.targetWeight}%`],
      }
    }
    if (gain >= 18 || weight > holding.targetWeight + 4) {
      return {
        id: holding.id,
        stock: holding,
        tone: 'sell',
        action: `可考虑减仓约 ${(value * 0.15).toFixed(0)} 元`,
        confidence: 66,
        reasons: [`相对成本 ${gain.toFixed(2)}%`, `当前仓位约 ${weight.toFixed(1)}%，目标 ${holding.targetWeight}%`],
      }
    }
    return {
      id: holding.id,
      stock: holding,
      tone: 'hold',
      action: '暂不交易，继续观察',
      confidence: 55,
      reasons: [`今日涨跌 ${Number(quote.changePct ?? 0).toFixed(2)}%`, `相对成本 ${gain.toFixed(2)}%`],
    }
  })
  res.json({ advice, updatedAt: nowIso() })
})

if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(port, () => {
  console.log(`A-share investment assistant is running at http://localhost:${port}`)
})
