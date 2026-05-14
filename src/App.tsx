import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bell,
  Cloud,
  Edit3,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
  WalletCards,
} from 'lucide-react'
import './App.css'

type MarketCode = 'sh' | 'sz' | 'bj'
type RiskProfile = '保守' | '均衡' | '进取'
type ActionTone = 'buy' | 'sell' | 'hold' | 'watch'

type User = {
  id: string
  realName: string
  phoneMasked: string
}

type StockBase = {
  id: string
  code: string
  market: MarketCode
  name: string
  theme: string
  note?: string
}

type Holding = StockBase & {
  cost: number
  shares: number
  targetWeight: number
  risk: RiskProfile
  planAmount: number
}

type Quote = {
  code: string
  name: string
  price?: number
  changePct?: number | null
  source: string
  updatedAt: string
  verified?: boolean
  fallback?: boolean
  warning?: string
}

type MarketData = {
  stocks: Quote[]
  updatedAt: string
}

type ImportRecord = {
  id: string
  fileName: string
  notes: string
  status: string
  createdAt: string
}

type KlineBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type AnalysisItem = {
  stock: StockBase
  quote?: Quote
  kline: { bars: KlineBar[]; warning?: string }
  technical: {
    summary: string
    trend: string
    score: number
    ma5: number
    ma10: number
    ma20: number
    change20: number
    dayChange: number
    volumeRatio: number
    support: number
    resistance: number
  }
  links: {
    newsSearch: string
    quotePage: string
    announcements: string
    policySearch: string
    regulator: string
  }
  suggestion: string
  tone: ActionTone
}

const emptyHolding: Holding = {
  id: '',
  code: '',
  market: 'sh',
  name: '',
  cost: 0,
  shares: 0,
  targetWeight: 0,
  risk: '均衡',
  theme: '',
  planAmount: 0,
  note: '',
}

const emptyWatch: StockBase = {
  id: '',
  code: '',
  market: 'sh',
  name: '',
  theme: '',
  note: '',
}

const money = (value?: number | null) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(Number(value)) ? Number(value) : 0)

const pct = (value?: number | null) =>
  Number.isFinite(Number(value)) ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}%` : '暂无'

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
})

const stockKey = (stock: Pick<StockBase, 'market' | 'code'>) => `${stock.market}${stock.code}`
const getQuote = (stock: Pick<StockBase, 'code'>, market?: MarketData) => market?.stocks.find((item) => item.code === stock.code)
const quotePrice = (holding: Holding, quote?: Quote) => quote?.price ?? holding.cost
const stockValue = (holding: Holding, market?: MarketData) => holding.shares * quotePrice(holding, getQuote(holding, market))

function AuthGate({ onAuth }: { onAuth: (token: string, user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [realName, setRealName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    const response = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ realName, phone }),
    })
    const data = await response.json()
    if (!response.ok) {
      setError(data.error || '操作失败')
      return
    }
    localStorage.setItem('a-stock-token', data.token)
    onAuth(data.token, data.user)
  }

  return (
    <main className="app-shell">
      <section className="top-panel auth-panel">
        <div className="status-row">
          <ShieldCheck size={18} />
          <span>A股实时助手</span>
        </div>
        <h1>{mode === 'register' ? '创建账户' : '登录账户'}</h1>
        <p>输入真实姓名和电话号码即可进入。不同账号的数据会分开保存在后台。</p>
      </section>

      <section className="settings-panel form-panel">
        <label>
          真实姓名
          <input value={realName} onChange={(event) => setRealName(event.target.value)} placeholder="例如 王麒智" />
        </label>
        <label>
          电话号码
          <input value={phone} inputMode="tel" onChange={(event) => setPhone(event.target.value)} placeholder="用于下次登录和区分账号" />
        </label>
        {error && <div className="inline-error">{error}</div>}
        <button onClick={submit}>{mode === 'register' ? '注册并进入' : '登录'}</button>
        <button className="secondary" onClick={() => setMode(mode === 'register' ? 'login' : 'register')}>
          {mode === 'register' ? '已有账户，去登录' : '没有账户，去注册'}
        </button>
      </section>
    </main>
  )
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('a-stock-token') || '')
  const [user, setUser] = useState<User | null>(null)
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [watchlist, setWatchlist] = useState<StockBase[]>([])
  const [imports, setImports] = useState<ImportRecord[]>([])
  const [market, setMarket] = useState<MarketData>()
  const [tab, setTab] = useState<'建议' | '行情' | '持仓' | '导入' | '设置'>('建议')
  const [holdingForm, setHoldingForm] = useState<Holding>(emptyHolding)
  const [watchForm, setWatchForm] = useState<StockBase>(emptyWatch)
  const [editingHoldingId, setEditingHoldingId] = useState('')
  const [editingWatchId, setEditingWatchId] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [analysis, setAnalysis] = useState<AnalysisItem[]>([])

  const marketKeys = useMemo(() => {
    const map = new Map<string, StockBase>()
    for (const item of [...holdings, ...watchlist]) {
      if (item.code) map.set(stockKey(item), item)
    }
    return [...map.keys()].join(',')
  }, [holdings, watchlist])

  const loadPortfolio = useCallback(async () => {
    if (!token) return
    const response = await fetch('/api/portfolio', { headers: { Authorization: `Bearer ${token}` } })
    if (response.status === 401) {
      localStorage.removeItem('a-stock-token')
      setToken('')
      return
    }
    const data = await response.json()
    setUser(data.user)
    setHoldings(data.holdings || [])
    setWatchlist(data.watchlist || [])
    setImports(data.imports || [])
  }, [token])

  const refreshMarket = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/market?${new URLSearchParams({ stocks: marketKeys }).toString()}`)
      setMarket(await response.json())
    } finally {
      setLoading(false)
    }
  }, [marketKeys])

  const loadAnalysis = useCallback(async () => {
    if (!token) return
    const response = await fetch('/api/analysis', { headers: { Authorization: `Bearer ${token}` } })
    if (response.ok) {
      const data = await response.json()
      setAnalysis(data.items || [])
    }
  }, [token])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPortfolio(), 0)
    return () => window.clearTimeout(timer)
  }, [loadPortfolio])

  useEffect(() => {
    if (!token) return
    const initial = window.setTimeout(() => void refreshMarket(), 0)
    const analysisInitial = window.setTimeout(() => void loadAnalysis(), 500)
    const timer = window.setInterval(() => void refreshMarket(), 60_000)
    const analysisTimer = window.setInterval(() => void loadAnalysis(), 120_000)
    return () => {
      window.clearTimeout(initial)
      window.clearTimeout(analysisInitial)
      window.clearInterval(timer)
      window.clearInterval(analysisTimer)
    }
  }, [loadAnalysis, refreshMarket, token])

  const totalValue = holdings.reduce((sum, holding) => sum + stockValue(holding, market), 0)
  const todayMove = holdings.reduce((sum, holding) => {
    const quote = getQuote(holding, market)
    if (!quote?.verified || !quote.changePct) return sum
    return sum + stockValue(holding, market) * (quote.changePct / 100)
  }, 0)
  const verifiedCount = market?.stocks.filter((item) => item.verified).length || 0
  const unverifiedCount = market?.stocks.filter((item) => !item.verified).length || 0
  const saveHolding = async () => {
    if (!token) return
    const method = editingHoldingId ? 'PATCH' : 'POST'
    const url = editingHoldingId ? `/api/holdings/${editingHoldingId}` : '/api/holdings'
    const response = await fetch(url, { method, headers: authHeaders(token), body: JSON.stringify(holdingForm) })
    const data = await response.json()
    if (!response.ok) {
      setMessage(data.error || '保存失败')
      return
    }
    setHoldingForm(emptyHolding)
    setEditingHoldingId('')
    setMessage('已保存持仓')
    await loadPortfolio()
    await loadAnalysis()
  }

  const lookupStock = async (code: string, target: 'holding' | 'watch') => {
    const normalized = code.replace(/\D/g, '')
    if (normalized.length !== 6) return
    setLookupLoading(true)
    try {
      const response = await fetch(`/api/stocks/lookup?${new URLSearchParams({ code: normalized }).toString()}`)
      const data = await response.json()
      if (!response.ok) {
        setMessage(data.error || '股票搜索失败')
        return
      }
      if (target === 'holding') {
        setHoldingForm((current) => ({
          ...current,
          code: data.stock.code,
          market: data.stock.market,
          name: data.stock.name,
          theme: data.stock.theme,
        }))
      } else {
        setWatchForm((current) => ({
          ...current,
          code: data.stock.code,
          market: data.stock.market,
          name: data.stock.name,
          theme: data.stock.theme,
        }))
      }
      setMessage(data.stock.quote?.verified ? '已自动填充股票信息' : data.stock.quote?.warning || '已按代码自动判断市场')
    } finally {
      setLookupLoading(false)
    }
  }

  const saveWatch = async () => {
    if (!token) return
    const method = editingWatchId ? 'PATCH' : 'POST'
    const url = editingWatchId ? `/api/watchlist/${editingWatchId}` : '/api/watchlist'
    const response = await fetch(url, { method, headers: authHeaders(token), body: JSON.stringify(watchForm) })
    const data = await response.json()
    if (!response.ok) {
      setMessage(data.error || '保存失败')
      return
    }
    setWatchForm(emptyWatch)
    setEditingWatchId('')
    setMessage('已保存自选')
    await loadPortfolio()
    await loadAnalysis()
  }

  const deleteHolding = async (id: string) => {
    if (!token) return
    await fetch(`/api/holdings/${id}`, { method: 'DELETE', headers: authHeaders(token) })
    await loadPortfolio()
    await loadAnalysis()
  }

  const deleteWatch = async (id: string) => {
    if (!token) return
    await fetch(`/api/watchlist/${id}`, { method: 'DELETE', headers: authHeaders(token) })
    await loadPortfolio()
    await loadAnalysis()
  }

  const uploadScreenshot = async (file: File) => {
    if (!token) return
    const reader = new FileReader()
    reader.onload = async () => {
      const response = await fetch('/api/imports', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ fileName: file.name, imageData: reader.result, notes: 'A股截图导入' }),
      })
      const data = await response.json()
      setMessage(response.ok ? '截图已保存，请在持仓或自选里校对录入' : data.error || '上传失败')
      await loadPortfolio()
    }
    reader.readAsDataURL(file)
  }

  const logout = () => {
    localStorage.removeItem('a-stock-token')
    setToken('')
    setUser(null)
  }

  if (!token) {
    return <AuthGate onAuth={(nextToken, nextUser) => { setToken(nextToken); setUser(nextUser) }} />
  }

  return (
    <main className="app-shell">
      <section className="top-panel">
        <div className="status-row">
          <span className="live-dot"></span>
          <span>{user ? `${user.realName} · ${user.phoneMasked}` : 'A股实时助手'}</span>
          <button className="icon-button" onClick={refreshMarket} aria-label="刷新行情">
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
          </button>
        </div>
        <div className="asset-summary">
          <div>
            <p>A股持仓市值</p>
            <h1>{money(totalValue)}</h1>
          </div>
          <div className="score-pill">
            <ShieldCheck size={16} />
            <span>{verifiedCount ? `${verifiedCount} 项实时` : '等待行情'}</span>
          </div>
        </div>
        <div className="metric-grid">
          <div><span>今日估算</span><b>{money(todayMove)}</b></div>
          <div><span>持仓数</span><b>{holdings.length}</b></div>
          <div><span>自选数</span><b>{watchlist.length}</b></div>
        </div>
      </section>

      <section className={unverifiedCount ? 'notice danger' : 'notice'}>
        <Bell size={18} />
        <span>
          {unverifiedCount
            ? '部分A股未取得可信实时行情，相关交易建议已暂停。'
            : 'A股行情每60秒刷新，建议仅作家庭内部辅助参考。'}
        </span>
      </section>

      <nav className="tabs tabs-five">
        {(['建议', '行情', '持仓', '导入', '设置'] as const).map((item) => (
          <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </nav>

      {tab === '建议' && (
        <section className="content-stack">
          {analysis.length === 0 && <article className="settings-panel"><p>先在“行情”或“持仓”里录入A股，再生成分析。</p></article>}
          {analysis.map((item) => <AnalysisCard key={`${item.stock.market}${item.stock.code}`} item={item} />)}
        </section>
      )}

      {tab === '行情' && (
        <section className="content-stack">
          <article className="settings-panel form-panel">
            <div className="setting-title"><Star size={18} /><h2>{editingWatchId ? '修改自选' : '添加自选'}</h2></div>
            <StockFields value={watchForm} onChange={setWatchForm} onLookup={(code) => lookupStock(code, 'watch')} loading={lookupLoading} />
            {message && <div className="inline-message">{message}</div>}
            <button onClick={saveWatch}><Plus size={16} />保存自选</button>
          </article>
          {watchlist.map((stock) => <StockCard key={stock.id} stock={stock} quote={getQuote(stock, market)} onEdit={() => { setWatchForm(stock); setEditingWatchId(stock.id) }} onDelete={() => deleteWatch(stock.id)} />)}
        </section>
      )}

      {tab === '持仓' && (
        <section className="content-stack">
          <article className="settings-panel form-panel">
            <div className="setting-title"><Edit3 size={18} /><h2>{editingHoldingId ? '修改持仓' : '新增持仓'}</h2></div>
            <div className="form-grid">
              <StockFields value={holdingForm} onChange={setHoldingForm} onLookup={(code) => lookupStock(code, 'holding')} loading={lookupLoading} />
              <label>持股数量<input type="number" value={holdingForm.shares} onChange={(event) => setHoldingForm({ ...holdingForm, shares: Number(event.target.value) })} /></label>
              <label>成本价<input type="number" value={holdingForm.cost} onChange={(event) => setHoldingForm({ ...holdingForm, cost: Number(event.target.value) })} /></label>
              <label>目标仓位%<input type="number" value={holdingForm.targetWeight} onChange={(event) => setHoldingForm({ ...holdingForm, targetWeight: Number(event.target.value) })} /></label>
              <label>计划金额<input type="number" value={holdingForm.planAmount} onChange={(event) => setHoldingForm({ ...holdingForm, planAmount: Number(event.target.value) })} /></label>
              <label>风险<select value={holdingForm.risk} onChange={(event) => setHoldingForm({ ...holdingForm, risk: event.target.value as RiskProfile })}><option>保守</option><option>均衡</option><option>进取</option></select></label>
              <label className="wide">备注<input value={holdingForm.note || ''} onChange={(event) => setHoldingForm({ ...holdingForm, note: event.target.value })} /></label>
            </div>
            {message && <div className="inline-message">{message}</div>}
            <button onClick={saveHolding}><Save size={16} />保存持仓</button>
            {editingHoldingId && <button className="secondary" onClick={() => { setEditingHoldingId(''); setHoldingForm(emptyHolding) }}>取消修改</button>}
          </article>

          {holdings.map((holding) => {
            const quote = getQuote(holding, market)
            return <StockCard key={holding.id} stock={holding} quote={quote} value={stockValue(holding, market)} detail={`${holding.shares} 股 · 成本 ${holding.cost}`} onEdit={() => { setHoldingForm(holding); setEditingHoldingId(holding.id) }} onDelete={() => deleteHolding(holding.id)} />
          })}
        </section>
      )}

      {tab === '导入' && (
        <section className="content-stack">
          <article className="settings-panel">
            <div className="setting-title"><Upload size={18} /><h2>A股截图导入</h2></div>
            <p>上传券商或行情软件截图后，先保存记录，再在“自选”或“持仓”里人工校对录入。</p>
            <label className="upload-box">
              <Upload size={18} />
              选择A股持仓或自选截图
              <input type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && uploadScreenshot(event.target.files[0])} />
            </label>
          </article>
          {imports.map((item) => (
            <article className="holding-card" key={item.id}>
              <div>
                <p>{item.status}</p>
                <h2>{item.fileName}</h2>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
              </div>
            </article>
          ))}
        </section>
      )}

      {tab === '设置' && (
        <section className="content-stack">
          <article className="settings-panel">
            <div className="setting-title"><Cloud size={18} /><h2>云端访问</h2></div>
            <p>当前网站托管在云端，手机打开网址即可使用。账号按真实姓名和电话号码区分，数据保存在后台。</p>
            <div className="code-line">A股-only · iTick 实时行情</div>
          </article>
          <article className="settings-panel">
            <div className="setting-title"><WalletCards size={18} /><h2>账户和数据</h2></div>
            <p>不再使用基金模块。自选股、持仓和截图导入记录按账号独立保存。</p>
            <button className="secondary" onClick={logout}><LogOut size={16} />退出登录</button>
          </article>
        </section>
      )}

      <footer className="bottom-note">
        本工具为家庭内部A股决策辅助，不构成公开投资建议。投资有风险，操作需谨慎。
      </footer>
    </main>
  )
}

function StockFields<T extends StockBase>({ value, onChange, onLookup, loading }: { value: T; onChange: (next: T) => void; onLookup: (code: string) => void; loading: boolean }) {
  return (
    <>
      <label className="wide">股票代码
        <div className="lookup-row">
          <input value={value.code} inputMode="numeric" maxLength={6} onChange={(event) => {
            const code = event.target.value.replace(/\D/g, '')
            onChange({ ...value, code })
            if (code.length === 6) onLookup(code)
          }} placeholder="输入6位代码自动搜索" />
          <button type="button" className="mini-button" onClick={() => onLookup(value.code)} disabled={loading || value.code.length !== 6}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </label>
      <label>市场<input value={value.market.toUpperCase()} readOnly /></label>
      <label>名称<input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} placeholder="自动填充" /></label>
      <label>主题<input value={value.theme} onChange={(event) => onChange({ ...value, theme: event.target.value })} placeholder="自动填充" /></label>
    </>
  )
}

function StockCard({ stock, quote, value, detail, onEdit, onDelete }: { stock: StockBase; quote?: Quote; value?: number; detail?: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <article className="holding-card">
      <div>
        <p>A股 · {quote?.verified ? quote.source : '待核验'}</p>
        <h2>{stock.name}</h2>
        <span>{stock.market.toUpperCase()} {stock.code} · {stock.theme || '未分类'} {detail ? `· ${detail}` : ''}</span>
      </div>
      <div className="holding-actions">
        <b>{value !== undefined ? money(value) : quote?.verified ? `${money(quote.price)} ${pct(quote.changePct)}` : '待刷新'}</b>
        <button onClick={onEdit} aria-label="编辑"><Edit3 size={16} /></button>
        <button onClick={onDelete} aria-label="删除"><Trash2 size={16} /></button>
      </div>
    </article>
  )
}

function AnalysisCard({ item }: { item: AnalysisItem }) {
  const bars = item.kline.bars || []
  const closes = bars.map((bar) => bar.close)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const points = closes.map((close, index) => {
    const x = closes.length <= 1 ? 0 : (index / (closes.length - 1)) * 100
    const y = max === min ? 50 : 90 - ((close - min) / (max - min)) * 80
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')

  return (
    <article className={`advice-card ${item.tone}`}>
      <div className="card-head">
        <div>
          <p>{item.stock.market.toUpperCase()} {item.stock.code} · {item.stock.theme || 'A股'}</p>
          <h2>{item.stock.name}</h2>
        </div>
        <span>{item.technical.score}</span>
      </div>
      <div className="kline-box">
        {points ? (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${item.stock.name} K线走势`}>
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : (
          <div className="empty-chart">K线暂不可用</div>
        )}
      </div>
      <div className="action-line">{item.suggestion}</div>
      <ul className="reason-list">
        <li>{item.technical.summary}</li>
        <li>支撑 {item.technical.support.toFixed(2)}，压力 {item.technical.resistance.toFixed(2)}</li>
        <li>MA5 {item.technical.ma5.toFixed(2)} / MA10 {item.technical.ma10.toFixed(2)} / MA20 {item.technical.ma20.toFixed(2)}</li>
        <li>实时 {item.quote?.verified ? `${money(item.quote.price)}，${pct(item.quote.changePct)}` : item.quote?.warning || '行情未验证'}</li>
      </ul>
      <div className="link-row">
        <a href={item.links.newsSearch} target="_blank" rel="noreferrer">新闻</a>
        <a href={item.links.announcements} target="_blank" rel="noreferrer">公告</a>
        <a href={item.links.policySearch} target="_blank" rel="noreferrer">政策</a>
        <a href={item.links.quotePage} target="_blank" rel="noreferrer">行情页</a>
      </div>
      <div className="compliance-tag">K线和新闻入口用于辅助判断，交易建议不保证预测准确。</div>
    </article>
  )
}

export default App
