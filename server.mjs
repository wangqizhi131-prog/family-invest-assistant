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

app.use(cors())
app.use(express.json({ limit: '12mb' }))

const defaultDb = () => ({
  users: [],
  holdings: {},
  snapshots: {},
  imports: {},
})

const seedHoldings = () => [
  {
    id: 'fund-021190',
    owner: '我',
    kind: 'fund',
    code: '021190',
    name: '南方亚太精选ETF联接(QDII)C',
    cost: 1.2878,
    units: 323.0396,
    targetWeight: 32,
    risk: '进取',
    theme: '亚太科技/QDII',
    planAmount: 0,
  },
  {
    id: 'fund-008163',
    owner: '我',
    kind: 'fund',
    code: '008163',
    name: '南方标普红利低波50ETF联接A',
    cost: 1.0674,
    units: 27.9468,
    targetWeight: 5,
    risk: '保守',
    theme: '红利低波',
    planAmount: 0,
  },
  {
    id: 'fund-025856',
    owner: '我',
    kind: 'fund',
    code: '025856',
    name: '华夏中证电网设备主题ETF联接A',
    cost: 1.3372,
    units: 206.5776,
    targetWeight: 20,
    risk: '进取',
    theme: '电网设备',
    planAmount: 0,
  },
  {
    id: 'fund-270042',
    owner: '我',
    kind: 'fund',
    code: '270042',
    name: '广发纳斯达克100ETF联接人民币(QDII)A',
    cost: 7.7788,
    units: 19.2831,
    targetWeight: 12,
    risk: '进取',
    theme: '纳斯达克100/QDII',
    planAmount: 10,
    dailyPlan: 10,
    planStatus: '每日定投，已投15期，累计150元',
  },
  {
    id: 'fund-006479',
    owner: '我',
    kind: 'fund',
    code: '006479',
    name: '广发纳斯达克100ETF联接人民币(QDII)C',
    cost: 7.4064,
    units: 32.4045,
    targetWeight: 18,
    risk: '进取',
    theme: '纳斯达克100/QDII',
    planAmount: 10,
    dailyPlan: 10,
    planStatus: '每日定投，已投24期，累计240元',
  },
  {
    id: 'fund-015897',
    owner: '我',
    kind: 'fund',
    code: '015897',
    name: '天弘中证细分化工产业主题ETF联接C',
    cost: 0.9797,
    units: 199.137,
    targetWeight: 13,
    risk: '进取',
    theme: '化工',
    planAmount: 0,
  },
  {
    id: 'fund-040046-plan',
    owner: '我',
    kind: 'fund',
    code: '040046',
    name: '华安纳斯达克100ETF联接(QDII)A',
    cost: 8.2791,
    units: 0,
    targetWeight: 0,
    risk: '进取',
    theme: '纳斯达克100/QDII',
    planAmount: 10,
    dailyPlan: 10,
    planStatus: '每日定投，已投2期，累计20元；当前可能仍在买入待确认',
  },
]

const seedSnapshot = () => ({
  totalAmount: 1537.88,
  pendingBuy: 60,
  pendingSell: 97.66,
  yesterdayProfit: 7.75,
  holdingProfit: 113.05,
  ytdProfit: 85.22,
  ytdReturnPct: 4.03,
})

const ensureDb = () => {
  mkdirSync(dataDir, { recursive: true })
  if (!existsSync(dbFile)) {
    writeDb(defaultDb())
  }
}

const readDb = () => {
  ensureDb()
  const parsed = JSON.parse(readFileSync(dbFile, 'utf8'))
  return {
    ...defaultDb(),
    ...parsed,
    users: parsed.users || [],
    holdings: parsed.holdings || {},
    snapshots: parsed.snapshots || {},
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
const normalizeMarket = (value) => {
  const market = String(value || '').toLowerCase()
  return ['sh', 'sz', 'bj'].includes(market) ? market : 'sh'
}
const asNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const hashPasscode = (passcode, salt) =>
  crypto.scryptSync(String(passcode), salt, 32).toString('hex')

const publicUser = (user) => ({
  id: user.id,
  displayName: user.displayName,
  relation: user.relation,
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

const tokenFor = (user) =>
  signPayload({
    userId: user.id,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,
  })

const findUserForLogin = (db, displayName, relation) =>
  db.users.find(
    (user) =>
      user.displayName === displayName.trim() &&
      user.relation === relation.trim(),
  )

const validateAuthInput = ({ displayName, relation, passcode }) => {
  if (!String(displayName || '').trim()) return '请输入昵称'
  if (!String(relation || '').trim()) return '请输入和网站创建者的关系'
  if (String(passcode || '').length < 4) return '访问口令至少4位'
  return ''
}

const normalizeHolding = (input, existing = {}) => {
  const kind = input.kind === 'stock' ? 'stock' : 'fund'
  const code = normalizeCode(input.code ?? existing.code)
  return {
    ...existing,
    owner: String(input.owner ?? existing.owner ?? '我').trim() || '我',
    kind,
    code,
    market: kind === 'stock' ? normalizeMarket(input.market ?? existing.market) : undefined,
    name: String(input.name ?? existing.name ?? code).trim() || code,
    cost: asNumber(input.cost ?? existing.cost),
    units: asNumber(input.units ?? existing.units),
    targetWeight: asNumber(input.targetWeight ?? existing.targetWeight),
    risk: ['保守', '均衡', '进取'].includes(input.risk) ? input.risk : existing.risk || '均衡',
    theme: String(input.theme ?? existing.theme ?? '').trim(),
    planAmount: asNumber(input.planAmount ?? existing.planAmount),
    dailyPlan:
      input.dailyPlan === undefined && existing.dailyPlan === undefined
        ? undefined
        : asNumber(input.dailyPlan ?? existing.dailyPlan),
    planStatus: String(input.planStatus ?? existing.planStatus ?? '').trim(),
  }
}

const providerMissingQuote = (code, name = code, kind = 'fund') => ({
  code,
  name,
  source: 'unavailable',
  updatedAt: nowIso(),
  verified: false,
  fallback: true,
  warning:
    kind === 'stock'
      ? '未配置授权实时行情密钥，A股实时数据未验证，已暂停交易建议'
      : '未配置授权基金行情密钥，基金实时/估值数据未验证，已暂停交易建议',
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
  if (!response.ok) throw new Error(`行情接口返回 ${response.status}`)
  return response.json()
}

const buildItickUrl = (pathName, params) => {
  const base = process.env.ITICK_BASE_URL || 'https://api.itick.io'
  const url = new URL(pathName, base)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value)
  }
  if (process.env.ITICK_TOKEN) url.searchParams.set('token', process.env.ITICK_TOKEN)
  return url
}

const queryItickStock = async ({ market, code }) => {
  if (!process.env.ITICK_TOKEN) return providerMissingQuote(code, code, 'stock')
  const region = market === 'sh' ? 'SH' : market === 'sz' ? 'SZ' : 'BJ'
  const candidates = [
    buildItickUrl('/stock/quote', { region, code }),
    buildItickUrl('/stock/tick', { region, code }),
  ]
  let lastError = null
  for (const url of candidates) {
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
      lastError = error
    }
  }
  return {
    ...providerMissingQuote(code, code, 'stock'),
    source: 'itick-error',
    warning: `授权行情接口未返回可用A股报价：${lastError?.message || '未知错误'}`,
  }
}

const queryItickFund = async (code) => {
  if (!process.env.ITICK_TOKEN) return providerMissingQuote(code, code, 'fund')
  const candidates = [
    buildItickUrl('/fund/quote', { region: process.env.ITICK_FUND_REGION || 'CN', code }),
    buildItickUrl('/fund/tick', { region: process.env.ITICK_FUND_REGION || 'CN', code }),
    buildItickUrl('/fund/quotes', { region: process.env.ITICK_FUND_REGION || 'CN', code }),
    buildItickUrl('/fund/ticks', { region: process.env.ITICK_FUND_REGION || 'CN', code }),
  ]
  let lastError = null
  for (const url of candidates) {
    try {
      const payload = extractObject(await fetchJson(url, process.env.ITICK_TOKEN))
      const nav = pickNumber(payload, ['nav', 'netValue', 'unitNav', 'dwjz', 'ld'])
      const estimate = pickNumber(payload, ['estimate', 'estimatedNav', 'gsz', 'latestPrice'])
      if (nav === null && estimate === null) throw new Error('行情接口缺少基金净值或估值字段')
      return {
        code,
        name: pickString(payload, ['name', 'fundName', 'symbolName'], code),
        nav,
        estimate,
        changePct: pickNumber(payload, ['changePct', 'percent', 'gszzl', 'chp']),
        source: 'itick',
        updatedAt: nowIso(),
        verified: true,
      }
    } catch (error) {
      lastError = error
    }
  }
  return {
    ...providerMissingQuote(code, code, 'fund'),
    source: 'itick-error',
    warning: `授权行情接口未返回可用基金报价：${lastError?.message || '未知错误'}`,
  }
}

const queryEastmoneyStocks = async (stocks) => {
  if (!stocks.length) return []
  const secids = stocks
    .map((stock) => `${stock.market === 'sh' ? '1' : stock.market === 'bj' ? '0' : '0'}.${stock.code}`)
    .join(',')
  const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get')
  url.searchParams.set('fltt', '2')
  url.searchParams.set('invt', '2')
  url.searchParams.set('fields', 'f12,f14,f2,f3')
  url.searchParams.set('secids', secids)
  try {
    const payload = await fetchJson(url)
    const rows = payload?.data?.diff || []
    return stocks.map((stock) => {
      const row = rows.find((item) => String(item.f12) === stock.code)
      if (!row) return providerMissingQuote(stock.code, stock.code, 'stock')
      return {
        code: stock.code,
        name: row.f14 || stock.code,
        price: asNumber(row.f2, null),
        changePct: asNumber(row.f3, null),
        source: 'eastmoney-public',
        updatedAt: nowIso(),
        verified: !strictRealtime,
        fallback: strictRealtime,
        warning: strictRealtime ? '当前为公开接口结果，未作为授权实时行情使用，已暂停交易建议' : undefined,
      }
    })
  } catch {
    return stocks.map((stock) => providerMissingQuote(stock.code, stock.code, 'stock'))
  }
}

const queryEastmoneyFund = async (code) => {
  try {
    const response = await fetch(`https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`)
    if (!response.ok) throw new Error(`基金估值接口返回 ${response.status}`)
    const text = await response.text()
    const match = text.match(/jsonpgz\((.*)\);?/)
    if (!match) throw new Error('基金估值接口格式不可用')
    const payload = JSON.parse(match[1])
    return {
      code,
      name: payload.name || code,
      nav: asNumber(payload.dwjz, null),
      estimate: asNumber(payload.gsz, null),
      changePct: asNumber(payload.gszzl, null),
      source: 'eastmoney-public',
      updatedAt: nowIso(),
      verified: !strictRealtime,
      fallback: strictRealtime,
      warning: strictRealtime ? '当前为公开估值接口结果，未作为授权实时行情使用，已暂停交易建议' : undefined,
    }
  } catch {
    return providerMissingQuote(code, code, 'fund')
  }
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

const parseFunds = (value) =>
  String(value || '')
    .split(',')
    .map(normalizeCode)
    .filter((code) => code.length === 6)

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    time: nowIso(),
    dataDir,
    marketProvider,
    strictRealtime,
    hasAuthorizedMarketToken: Boolean(process.env.ITICK_TOKEN),
  })
})

app.post('/api/auth/register', (req, res) => {
  const error = validateAuthInput(req.body || {})
  if (error) {
    res.status(400).json({ error })
    return
  }
  const db = readDb()
  const displayName = String(req.body.displayName).trim()
  const relation = String(req.body.relation).trim()
  if (findUserForLogin(db, displayName, relation)) {
    res.status(409).json({ error: '这个昵称和关系已经注册，请直接登录' })
    return
  }
  const salt = crypto.randomBytes(16).toString('hex')
  const user = {
    id: createId('user'),
    displayName,
    relation,
    salt,
    passHash: hashPasscode(req.body.passcode, salt),
    createdAt: nowIso(),
  }
  db.users.push(user)
  db.holdings[user.id] = db.users.length === 1 ? seedHoldings() : []
  db.snapshots[user.id] = db.users.length === 1 ? seedSnapshot() : {}
  db.imports[user.id] = []
  writeDb(db)
  res.json({ token: tokenFor(user), user: publicUser(user) })
})

app.post('/api/auth/login', (req, res) => {
  const error = validateAuthInput(req.body || {})
  if (error) {
    res.status(400).json({ error })
    return
  }
  const db = readDb()
  const user = findUserForLogin(db, String(req.body.displayName), String(req.body.relation))
  if (!user || user.passHash !== hashPasscode(req.body.passcode, user.salt)) {
    res.status(401).json({ error: '昵称、关系或口令不正确' })
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
    snapshot: req.db.snapshots[req.user.id] || {},
    imports: req.db.imports[req.user.id] || [],
  })
})

app.post('/api/holdings', requireAuth, (req, res) => {
  const holding = normalizeHolding(req.body || {})
  if (!holding.code || !holding.name) {
    res.status(400).json({ error: '请填写代码和名称' })
    return
  }
  holding.id = createId(holding.kind)
  req.db.holdings[req.user.id] = [...(req.db.holdings[req.user.id] || []), holding]
  writeDb(req.db)
  res.json({ holding })
})

app.patch('/api/holdings/:id', requireAuth, (req, res) => {
  const holdings = req.db.holdings[req.user.id] || []
  const index = holdings.findIndex((item) => item.id === req.params.id)
  if (index === -1) {
    res.status(404).json({ error: '持仓不存在' })
    return
  }
  const holding = { ...normalizeHolding(req.body || {}, holdings[index]), id: holdings[index].id }
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

app.post('/api/imports', requireAuth, (req, res) => {
  if (!String(req.body?.fileName || '').trim() || !String(req.body?.imageData || '').startsWith('data:image/')) {
    res.status(400).json({ error: '请上传支付宝截图图片' })
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
  const funds = parseFunds(req.query.funds)

  let stockQuotes = []
  let fundQuotes = []
  if (marketProvider === 'itick') {
    stockQuotes = await Promise.all(stocks.map((stock) => queryItickStock(stock)))
    fundQuotes = await Promise.all(funds.map((code) => queryItickFund(code)))
  } else if (marketProvider === 'eastmoney-public' && !strictRealtime) {
    stockQuotes = await queryEastmoneyStocks(stocks)
    fundQuotes = await Promise.all(funds.map((code) => queryEastmoneyFund(code)))
  } else {
    stockQuotes = stocks.map((stock) => providerMissingQuote(stock.code, stock.code, 'stock'))
    fundQuotes = funds.map((code) => providerMissingQuote(code, code, 'fund'))
  }

  res.json({
    stocks: stockQuotes,
    funds: fundQuotes,
    updatedAt: nowIso(),
  })
})

if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(port, () => {
  console.log(`Family investment assistant is running at http://localhost:${port}`)
})
