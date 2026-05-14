const quoteCache = new Map()
const quoteCacheTtlMs = 30_000

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
    },
  })

const nowIso = () => new Date().toISOString()
const createId = (prefix) => `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
const normalizeCode = (value) => String(value || '').trim().replace(/\D/g, '')
const normalizePhone = (value) => String(value || '').trim().replace(/\D/g, '')
const asNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}
const inferMarket = (code) => {
  if (/^(60|68|90)/.test(code)) return 'sh'
  if (/^(00|30|20)/.test(code)) return 'sz'
  if (/^(43|83|87|88|92)/.test(code)) return 'bj'
  return 'sh'
}
const normalizeMarket = (value, code = '') => {
  const market = String(value || '').toLowerCase()
  return ['sh', 'sz', 'bj'].includes(market) ? market : inferMarket(code)
}
const phoneMasked = (phone) => (phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone)
const publicUser = (user) => ({ id: user.id, realName: user.real_name, phoneMasked: phoneMasked(user.phone) })

const bytesToBase64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
const base64UrlToBytes = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return bytesToBase64Url(new Uint8Array(signature))
}

async function tokenFor(env, user) {
  const payload = {
    userId: user.id,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,
  }
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `${body}.${await hmac(env.APP_SECRET || 'cloudflare-dev-secret', body)}`
}

async function verifyToken(env, token) {
  const [body, signature] = String(token || '').split('.')
  if (!body || !signature) return null
  const expected = await hmac(env.APP_SECRET || 'cloudflare-dev-secret', body)
  const left = base64UrlToBytes(signature)
  const right = base64UrlToBytes(expected)
  if (left.length !== right.length) return null
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index]
  if (diff !== 0) return null
  const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')))
  if (!payload.userId || asNumber(payload.expiresAt) < Date.now()) return null
  return payload
}

async function requireAuth(request, env) {
  const token = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const payload = await verifyToken(env, token)
  if (!payload) return { error: json({ error: '请先登录' }, 401) }
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.userId).first()
  if (!user) return { error: json({ error: '账户不存在' }, 401) }
  return { user }
}

const validateIdentityInput = ({ realName, phone }) => {
  if (!String(realName || '').trim()) return '请输入真实姓名'
  if (normalizePhone(phone).length < 7) return '请输入有效电话号码'
  return ''
}

const validateStockInput = (stock) => {
  if (stock.code.length !== 6) return '请输入6位股票代码'
  if (!stock.name) return '请填写股票名称'
  return ''
}

const stockFromRow = (row) => ({
  id: row.id,
  code: row.code,
  market: row.market,
  name: row.name,
  theme: row.theme || '',
  note: row.note || '',
})

const holdingFromRow = (row) => ({
  ...stockFromRow(row),
  cost: row.cost || 0,
  shares: row.shares || 0,
  targetWeight: row.target_weight || 0,
  risk: row.risk || '均衡',
  planAmount: row.plan_amount || 0,
})

const normalizeStockInput = (input, existing = {}) => {
  const code = normalizeCode(input.code ?? existing.code)
  const market = normalizeMarket(input.market ?? existing.market, code)
  return {
    ...existing,
    code,
    market,
    name: String(input.name ?? existing.name ?? code).trim() || code,
    theme: String(input.theme ?? existing.theme ?? '').trim(),
    note: String(input.note ?? existing.note ?? '').trim(),
  }
}

const normalizeHolding = (input, existing = {}) => ({
  ...normalizeStockInput(input, existing),
  cost: asNumber(input.cost ?? existing.cost),
  shares: asNumber(input.shares ?? existing.shares),
  targetWeight: asNumber(input.targetWeight ?? existing.target_weight ?? existing.targetWeight),
  risk: ['保守', '均衡', '进取'].includes(input.risk) ? input.risk : existing.risk || '均衡',
  planAmount: asNumber(input.planAmount ?? existing.plan_amount ?? existing.planAmount),
})

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

async function fetchJson(url, token) {
  const headers = token ? { Authorization: `Bearer ${token}`, token } : {}
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('market-timeout'), 8000)
  let response
  try {
    response = await fetch(url, { headers, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('行情接口响应超时')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) {
    const error = new Error(`行情接口返回 ${response.status}`)
    error.status = response.status
    throw error
  }
  return response.json()
}

async function withQuoteCache(key, producer) {
  const cached = quoteCache.get(key)
  if (cached && Date.now() - cached.savedAt < quoteCacheTtlMs) return cached.value
  const value = await producer()
  quoteCache.set(key, { savedAt: Date.now(), value })
  return value
}

const itickUrl = (env, pathName, params) => {
  const url = new URL(pathName, env.ITICK_BASE_URL || 'https://api-free.itick.org')
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value)
  }
  if (env.ITICK_TOKEN) url.searchParams.set('token', env.ITICK_TOKEN)
  return url
}

async function queryItickStock(env, { market, code }) {
  if (!env.ITICK_TOKEN) return providerMissingQuote(code)
  const region = market === 'sh' ? 'SH' : market === 'sz' ? 'SZ' : 'BJ'
  return withQuoteCache(`itick-stock-${region}-${code}`, async () => {
    try {
      const payload = extractObject(await fetchJson(itickUrl(env, '/stock/quote', { region, code }), env.ITICK_TOKEN))
      const price = pickNumber(payload, ['price', 'last', 'latestPrice', 'lastPrice', 'close', 'ld', 'p'])
      if (price === null) throw new Error('行情接口缺少价格字段')
      return {
        code,
        name: String(payload.name || payload.symbolName || payload.securityName || code),
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
        warning: error?.status === 429 ? '授权行情接口当前限流，稍后会自动重试' : `授权行情接口未返回可用A股报价：${error?.message || '未知错误'}`,
      }
    }
  })
}

async function fetchStockName(stock) {
  try {
    const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get')
    url.searchParams.set('fltt', '2')
    url.searchParams.set('invt', '2')
    url.searchParams.set('fields', 'f12,f14')
    url.searchParams.set('secids', `${stock.market === 'sh' ? '1' : '0'}.${stock.code}`)
    const payload = await fetchJson(url)
    const row = payload?.data?.diff?.find((item) => String(item.f12) === stock.code)
    return String(row?.f14 || '').trim()
  } catch {
    return ''
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

async function enrichStock(env, stock) {
  if (!stock.code) return stock
  const quote = await queryItickStock(env, { market: stock.market, code: stock.code })
  const metadataName = quote.name && quote.name !== stock.code ? quote.name : await fetchStockName(stock)
  const name = stock.name && stock.name !== stock.code ? stock.name : metadataName || stock.code
  return { ...stock, name, theme: stock.theme || autoTheme(stock.code, name), quote }
}

async function queryItickKline(env, { market, code, limit = 60 }) {
  if (!env.ITICK_TOKEN) return { bars: [], warning: '未配置授权实时行情密钥，无法获取K线' }
  const region = market === 'sh' ? 'SH' : market === 'sz' ? 'SZ' : 'BJ'
  return withQuoteCache(`itick-kline-${region}-${code}-${limit}`, async () => {
    try {
      const payload = await fetchJson(itickUrl(env, '/stock/kline', { region, code, kType: 8, limit }), env.ITICK_TOKEN)
      return {
        bars: (Array.isArray(payload?.data) ? payload.data : []).map((item) => ({
          time: item.t,
          open: asNumber(item.o),
          high: asNumber(item.h),
          low: asNumber(item.l),
          close: asNumber(item.c),
          volume: asNumber(item.v),
          turnover: asNumber(item.tu),
        })),
      }
    } catch (error) {
      return { bars: [], warning: error?.status === 429 ? 'K线接口当前限流，稍后会自动重试' : `K线接口不可用：${error?.message || '未知错误'}` }
    }
  })
}

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)

function analyzeKline(bars) {
  const closes = bars.map((bar) => bar.close).filter((value) => value > 0)
  const volumes = bars.map((bar) => bar.volume).filter((value) => value > 0)
  const last = bars.at(-1)
  const prev = bars.at(-2)
  const ma5 = average(closes.slice(-5))
  const ma10 = average(closes.slice(-10))
  const ma20 = average(closes.slice(-20))
  const recentHigh = Math.max(...bars.slice(-20).map((bar) => bar.high), 0)
  const recentLow = Math.min(...bars.slice(-20).map((bar) => bar.low).filter((value) => value > 0))
  const change20 = closes.length >= 20 ? ((closes.at(-1) - closes.at(-20)) / closes.at(-20)) * 100 : 0
  const volumeRatio = volumes.length >= 10 ? (volumes.at(-1) || 0) / average(volumes.slice(-10, -1)) : 1
  const dayChange = last && prev ? ((last.close - prev.close) / prev.close) * 100 : 0
  let score = 50
  if (last?.close > ma5) score += 8
  if (ma5 > ma10) score += 8
  if (ma10 > ma20) score += 8
  if (change20 > 8) score += 8
  if (change20 < -8) score -= 10
  if (volumeRatio > 1.6 && dayChange > 0) score += 6
  if (volumeRatio > 1.8 && dayChange < 0) score -= 8
  if (last?.close < ma20) score -= 8
  score = Math.max(5, Math.min(95, Math.round(score)))
  const trend = score >= 68 ? '偏强' : score <= 38 ? '偏弱' : '震荡'
  return {
    summary: `${trend}走势，20日涨跌 ${change20.toFixed(2)}%，量能 ${(volumeRatio || 1).toFixed(2)} 倍`,
    trend,
    score,
    ma5,
    ma10,
    ma20,
    change20,
    dayChange,
    volumeRatio,
    support: Number.isFinite(recentLow) ? recentLow : 0,
    resistance: recentHigh,
  }
}

const analysisLinks = (stock) => {
  const keyword = encodeURIComponent(`${stock.name || ''} ${stock.code}`.trim())
  return {
    newsSearch: `https://so.eastmoney.com/news/s?keyword=${keyword}`,
    quotePage: `https://quote.eastmoney.com/${stock.market}${stock.code}.html`,
    announcements: `https://data.eastmoney.com/notices/stock/${stock.code}.html`,
    policySearch: `https://www.gov.cn/zhengce/zuixin/?q=${encodeURIComponent(stock.theme || stock.name || stock.code)}`,
    regulator: 'https://www.csrc.gov.cn/',
  }
}

async function buildStockAnalysis(env, stock) {
  const enriched = await enrichStock(env, stock)
  const kline = await queryItickKline(env, { market: enriched.market, code: enriched.code, limit: 80 })
  const technical = analyzeKline(kline.bars)
  const quote = enriched.quote
  let suggestion = '观察'
  let tone = 'watch'
  if (quote?.verified && technical.score >= 70 && technical.volumeRatio < 2.5) {
    suggestion = '趋势偏强，可小仓位跟踪，不追高'
    tone = 'buy'
  } else if (quote?.verified && technical.score <= 38) {
    suggestion = '趋势偏弱，优先控制仓位'
    tone = 'sell'
  } else if (quote?.verified) {
    suggestion = '震荡区间，等待突破或回踩确认'
    tone = 'hold'
  }
  return { stock: { id: stock.id, code: enriched.code, market: enriched.market, name: enriched.name, theme: enriched.theme, note: enriched.note }, quote, kline, technical, links: analysisLinks(enriched), suggestion, tone }
}

const parseStocks = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^(sh|sz|bj)?(\d{6})$/)
      if (!match) return null
      return { market: match[1] || inferMarket(match[2]), code: match[2] }
    })
    .filter(Boolean)

async function readBody(request) {
  return request.headers.get('content-type')?.includes('application/json') ? request.json() : {}
}

async function handleApi(request, env) {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method.toUpperCase()

  if (method === 'OPTIONS') return json({ ok: true })

  if (path === '/api/health') {
    return json({ ok: true, time: nowIso(), marketProvider: env.MARKET_PROVIDER || 'itick', strictRealtime: String(env.STRICT_REALTIME || '').toLowerCase() === 'true', hasAuthorizedMarketToken: Boolean(env.ITICK_TOKEN), assetScope: 'a-stocks-only', storage: 'cloudflare-d1' })
  }

  if (path === '/api/auth/register' && method === 'POST') {
    const body = await readBody(request)
    const error = validateIdentityInput(body)
    if (error) return json({ error }, 400)
    const realName = String(body.realName).trim()
    const phone = normalizePhone(body.phone)
    let user = await env.DB.prepare('SELECT * FROM users WHERE real_name = ? AND phone = ?').bind(realName, phone).first()
    if (!user) {
      user = { id: createId('user'), real_name: realName, phone, created_at: nowIso() }
      await env.DB.prepare('INSERT INTO users (id, real_name, phone, created_at) VALUES (?, ?, ?, ?)').bind(user.id, user.real_name, user.phone, user.created_at).run()
    }
    return json({ token: await tokenFor(env, user), user: publicUser(user) })
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const body = await readBody(request)
    const error = validateIdentityInput(body)
    if (error) return json({ error }, 400)
    const user = await env.DB.prepare('SELECT * FROM users WHERE real_name = ? AND phone = ?').bind(String(body.realName).trim(), normalizePhone(body.phone)).first()
    if (!user) return json({ error: '真实姓名或电话号码不正确' }, 401)
    return json({ token: await tokenFor(env, user), user: publicUser(user) })
  }

  if (path === '/api/market') {
    const stocks = parseStocks(url.searchParams.get('stocks'))
    return json({ stocks: await Promise.all(stocks.map((stock) => queryItickStock(env, stock))), updatedAt: nowIso() })
  }

  if (path === '/api/market/kline') {
    const stock = parseStocks(url.searchParams.get('stock') || url.searchParams.get('stocks')).at(0)
    if (!stock) return json({ error: '请输入股票代码' }, 400)
    const kline = await queryItickKline(env, { ...stock, limit: asNumber(url.searchParams.get('limit'), 60) })
    return json({ stock, bars: kline.bars, warning: kline.warning, analysis: analyzeKline(kline.bars), updatedAt: nowIso() })
  }

  if (path === '/api/stocks/lookup') {
    const code = normalizeCode(url.searchParams.get('code'))
    if (code.length !== 6) return json({ error: '请输入6位股票代码' }, 400)
    return json({ stock: await enrichStock(env, { code, market: inferMarket(code), name: code, theme: '' }) })
  }

  const auth = await requireAuth(request, env)
  if (auth.error) return auth.error
  const user = auth.user

  if (path === '/api/session') return json({ user: publicUser(user) })

  if (path === '/api/portfolio') {
    const holdings = await env.DB.prepare('SELECT * FROM holdings WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all()
    const watch = await env.DB.prepare('SELECT * FROM watchlist WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all()
    const imports = await env.DB.prepare('SELECT * FROM imports WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(user.id).all()
    return json({ user: publicUser(user), holdings: holdings.results.map(holdingFromRow), watchlist: watch.results.map(stockFromRow), imports: imports.results.map((row) => ({ id: row.id, fileName: row.file_name, notes: row.notes, status: row.status, createdAt: row.created_at })) })
  }

  if (path === '/api/analysis') {
    const holdings = (await env.DB.prepare('SELECT * FROM holdings WHERE user_id = ?').bind(user.id).all()).results.map(holdingFromRow)
    const watch = (await env.DB.prepare('SELECT * FROM watchlist WHERE user_id = ?').bind(user.id).all()).results.map(stockFromRow)
    const stocks = new Map()
    for (const stock of [...holdings, ...watch]) stocks.set(`${stock.market}${stock.code}`, stock)
    return json({ items: await Promise.all([...stocks.values()].map((stock) => buildStockAnalysis(env, stock))), updatedAt: nowIso() })
  }

  if (path === '/api/holdings' && method === 'POST') {
    const input = await enrichStock(env, normalizeHolding(await readBody(request)))
    const error = validateStockInput(input)
    if (error) return json({ error }, 400)
    const id = createId('holding')
    await env.DB.prepare('INSERT INTO holdings (id,user_id,code,market,name,theme,note,cost,shares,target_weight,risk,plan_amount,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id, user.id, input.code, input.market, input.name, input.theme, input.note, input.cost, input.shares, input.targetWeight, input.risk, input.planAmount, nowIso()).run()
    return json({ holding: { ...input, id } })
  }

  const holdingMatch = path.match(/^\/api\/holdings\/([^/]+)$/)
  if (holdingMatch && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM holdings WHERE id = ? AND user_id = ?').bind(holdingMatch[1], user.id).run()
    return json({ ok: true })
  }
  if (holdingMatch && method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM holdings WHERE id = ? AND user_id = ?').bind(holdingMatch[1], user.id).first()
    if (!existing) return json({ error: '持仓不存在' }, 404)
    const input = await enrichStock(env, normalizeHolding(await readBody(request), existing))
    const error = validateStockInput(input)
    if (error) return json({ error }, 400)
    await env.DB.prepare('UPDATE holdings SET code=?,market=?,name=?,theme=?,note=?,cost=?,shares=?,target_weight=?,risk=?,plan_amount=? WHERE id=? AND user_id=?').bind(input.code, input.market, input.name, input.theme, input.note, input.cost, input.shares, input.targetWeight, input.risk, input.planAmount, holdingMatch[1], user.id).run()
    return json({ holding: { ...input, id: holdingMatch[1] } })
  }

  if (path === '/api/watchlist' && method === 'POST') {
    const input = await enrichStock(env, normalizeStockInput(await readBody(request)))
    const error = validateStockInput(input)
    if (error) return json({ error }, 400)
    const id = createId('watch')
    await env.DB.prepare('INSERT INTO watchlist (id,user_id,code,market,name,theme,note,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, user.id, input.code, input.market, input.name, input.theme, input.note, nowIso()).run()
    return json({ stock: { ...input, id } })
  }

  const watchMatch = path.match(/^\/api\/watchlist\/([^/]+)$/)
  if (watchMatch && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM watchlist WHERE id = ? AND user_id = ?').bind(watchMatch[1], user.id).run()
    return json({ ok: true })
  }
  if (watchMatch && method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM watchlist WHERE id = ? AND user_id = ?').bind(watchMatch[1], user.id).first()
    if (!existing) return json({ error: '自选股不存在' }, 404)
    const input = await enrichStock(env, normalizeStockInput(await readBody(request), existing))
    const error = validateStockInput(input)
    if (error) return json({ error }, 400)
    await env.DB.prepare('UPDATE watchlist SET code=?,market=?,name=?,theme=?,note=? WHERE id=? AND user_id=?').bind(input.code, input.market, input.name, input.theme, input.note, watchMatch[1], user.id).run()
    return json({ stock: { ...input, id: watchMatch[1] } })
  }

  if (path === '/api/imports' && method === 'POST') {
    const body = await readBody(request)
    if (!String(body.fileName || '').trim() || !String(body.imageData || '').startsWith('data:image/')) return json({ error: '请上传A股持仓或自选截图' }, 400)
    const record = { id: createId('import'), fileName: String(body.fileName).trim(), notes: String(body.notes || '').trim(), status: '已保存，待人工校对', createdAt: nowIso() }
    await env.DB.prepare('INSERT INTO imports (id,user_id,file_name,notes,status,created_at) VALUES (?,?,?,?,?,?)').bind(record.id, user.id, record.fileName, record.notes, record.status, record.createdAt).run()
    return json({ importRecord: record })
  }

  return json({ error: '接口不存在' }, 404)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) return handleApi(request, env)
    return env.ASSETS.fetch(request)
  },
}
