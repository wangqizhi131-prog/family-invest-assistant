import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bell,
  Cloud,
  Edit3,
  LogOut,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  WalletCards,
} from 'lucide-react'
import './App.css'

type AssetKind = 'fund' | 'stock'
type RiskProfile = '保守' | '均衡' | '进取'
type ActionTone = 'buy' | 'sell' | 'hold' | 'watch'

type User = {
  id: string
  displayName: string
  relation: string
}

type Holding = {
  id: string
  owner: string
  kind: AssetKind
  code: string
  name: string
  market?: 'sh' | 'sz' | 'bj'
  cost: number
  units: number
  targetWeight: number
  risk: RiskProfile
  theme: string
  planAmount: number
  dailyPlan?: number
  planStatus?: string
}

type Quote = {
  code: string
  name: string
  price?: number
  nav?: number | null
  estimate?: number | null
  changePct?: number | null
  source: string
  updatedAt: string
  verified?: boolean
  fallback?: boolean
  warning?: string
}

type MarketData = {
  stocks: Quote[]
  funds: Quote[]
  updatedAt: string
}

type PortfolioSnapshot = {
  totalAmount?: number
  pendingBuy?: number
  pendingSell?: number
  yesterdayProfit?: number
  holdingProfit?: number
  ytdProfit?: number
  ytdReturnPct?: number
}

type ImportRecord = {
  id: string
  fileName: string
  notes: string
  status: string
  createdAt: string
}

type Advice = {
  id: string
  holding: Holding
  tone: ActionTone
  action: string
  reasons: string[]
  confidence: number
  dataLabel: string
}

const emptyHolding: Holding = {
  id: '',
  owner: '我',
  kind: 'fund',
  code: '',
  name: '',
  cost: 0,
  units: 0,
  targetWeight: 0,
  risk: '均衡',
  theme: '',
  planAmount: 0,
  dailyPlan: undefined,
  planStatus: '',
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

const getQuote = (holding: Holding, market?: MarketData) =>
  holding.kind === 'stock'
    ? market?.stocks.find((item) => item.code === holding.code)
    : market?.funds.find((item) => item.code === holding.code)

const quotePrice = (holding: Holding, quote?: Quote) => {
  if (!quote) return holding.cost
  if (holding.kind === 'stock') return quote.price ?? holding.cost
  return quote.estimate ?? quote.nav ?? holding.cost
}

const assetValue = (holding: Holding, market?: MarketData) => holding.units * quotePrice(holding, getQuote(holding, market))

function buildAdvice(holdings: Holding[], market?: MarketData): Advice[] {
  const total = holdings.reduce((sum, holding) => sum + assetValue(holding, market), 0)
  return holdings
    .map((holding) => {
      const quote = getQuote(holding, market)
      const value = assetValue(holding, market)
      const weight = total > 0 ? (value / total) * 100 : 0
      const price = quotePrice(holding, quote)
      const gain = holding.cost > 0 ? ((price - holding.cost) / holding.cost) * 100 : 0
      const day = quote?.changePct ?? 0
      const dataLabel = quote?.verified
        ? `数据源 ${quote.source}，更新时间 ${new Date(quote.updatedAt).toLocaleTimeString()}`
        : quote?.warning || '未取得实时行情，暂停生成买卖建议'

      if (!quote?.verified) {
        return {
          id: holding.id,
          holding,
          tone: 'watch' as const,
          action: '数据未验证，建议只校对持仓，不执行交易',
          reasons: ['行情源没有返回实时/准实时数据', '为避免虚假信号，本工具不会用兜底净值生成买卖建议'],
          confidence: 30,
          dataLabel,
        }
      }

      const reasons = [
        `今日涨跌 ${pct(day)}`,
        `相对成本 ${pct(gain)}`,
        `当前仓位约 ${weight.toFixed(1)}%，目标 ${holding.targetWeight}%`,
      ]

      if (day <= -1.5 && weight + 2 < holding.targetWeight && holding.planAmount > 0) {
        return {
          id: holding.id,
          holding,
          tone: 'buy' as const,
          action: `14:35-14:50 可考虑小额加仓 ${money(Math.max(10, holding.planAmount))}`,
          reasons: [...reasons, '下跌且低于目标仓位，适合用计划内资金分批处理'],
          confidence: 72,
          dataLabel,
        }
      }

      if ((gain >= 18 || weight > holding.targetWeight + 4) && value > 0) {
        return {
          id: holding.id,
          holding,
          tone: 'sell' as const,
          action: `可考虑减仓约 ${money(Math.min(value * 0.15, Math.max(20, value)))}`,
          reasons: [...reasons, '收益或仓位已超过计划，优先把组合风险降回可控区间'],
          confidence: 66,
          dataLabel,
        }
      }

      return {
        id: holding.id,
        holding,
        tone: 'hold' as const,
        action: holding.dailyPlan ? `维持每日定投 ${money(holding.dailyPlan)}` : '暂不交易，继续观察',
        reasons,
        confidence: 55,
        dataLabel,
      }
    })
    .sort((a, b) => {
      const order: Record<ActionTone, number> = { sell: 0, buy: 1, watch: 2, hold: 3 }
      return order[a.tone] - order[b.tone] || b.confidence - a.confidence
    })
}

function AuthGate({ onAuth }: { onAuth: (token: string, user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [displayName, setDisplayName] = useState('')
  const [relation, setRelation] = useState('')
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    const response = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, relation, passcode }),
    })
    const data = await response.json()
    if (!response.ok) {
      setError(data.error || '操作失败')
      return
    }
    localStorage.setItem('family-invest-token', data.token)
    onAuth(data.token, data.user)
  }

  return (
    <main className="app-shell">
      <section className="top-panel auth-panel">
        <div className="status-row">
          <ShieldCheck size={18} />
          <span>家庭投资助手</span>
        </div>
        <h1>{mode === 'register' ? '创建账户' : '登录账户'}</h1>
        <p>不用手机号。为了保护持仓数据，仍需要一个本地访问口令。</p>
      </section>

      <section className="settings-panel form-panel">
        <label>
          昵称
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如 王麒智" />
        </label>
        <label>
          和网站创建者的关系
          <input value={relation} onChange={(event) => setRelation(event.target.value)} placeholder="例如 本人、父亲、姐姐、朋友" />
        </label>
        <label>
          访问口令
          <input value={passcode} type="password" onChange={(event) => setPasscode(event.target.value)} placeholder="至少4位，不需要手机号" />
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
  const [token, setToken] = useState(() => localStorage.getItem('family-invest-token') || '')
  const [user, setUser] = useState<User | null>(null)
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot>({})
  const [imports, setImports] = useState<ImportRecord[]>([])
  const [market, setMarket] = useState<MarketData>()
  const [tab, setTab] = useState<'建议' | '持仓' | '导入' | '设置'>('建议')
  const [form, setForm] = useState<Holding>(emptyHolding)
  const [editingId, setEditingId] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const stockKey = holdings
    .filter((item) => item.kind === 'stock')
    .map((item) => `${item.market || 'sh'}${item.code}`)
    .join(',')
  const fundKey = holdings
    .filter((item) => item.kind === 'fund')
    .map((item) => item.code)
    .join(',')

  const loadPortfolio = useCallback(async () => {
    if (!token) return
    const response = await fetch('/api/portfolio', { headers: { Authorization: `Bearer ${token}` } })
    if (response.status === 401) {
      localStorage.removeItem('family-invest-token')
      setToken('')
      return
    }
    const data = await response.json()
    setUser(data.user)
    setHoldings(data.holdings || [])
    setSnapshot(data.snapshot || {})
    setImports(data.imports || [])
  }, [token])

  const refreshMarket = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ stocks: stockKey, funds: fundKey })
      const response = await fetch(`/api/market?${params.toString()}`)
      setMarket(await response.json())
    } finally {
      setLoading(false)
    }
  }, [fundKey, stockKey])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPortfolio(), 0)
    return () => window.clearTimeout(timer)
  }, [loadPortfolio])

  useEffect(() => {
    if (!token) return
    const initial = window.setTimeout(() => void refreshMarket(), 0)
    const timer = window.setInterval(() => void refreshMarket(), 60_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [refreshMarket, token])

  const totalValue = holdings.reduce((sum, holding) => sum + assetValue(holding, market), 0)
  const displayTotal = snapshot.totalAmount || totalValue
  const fallbackCount =
    (market?.funds.filter((item) => !item.verified).length || 0) +
    (market?.stocks.filter((item) => !item.verified).length || 0)
  const advices = useMemo(() => buildAdvice(holdings, market), [holdings, market])

  const saveHolding = async () => {
    if (!token) return
    const method = editingId ? 'PATCH' : 'POST'
    const url = editingId ? `/api/holdings/${editingId}` : '/api/holdings'
    const response = await fetch(url, { method, headers: authHeaders(token), body: JSON.stringify(form) })
    const data = await response.json()
    if (!response.ok) {
      setMessage(data.error || '保存失败')
      return
    }
    setForm(emptyHolding)
    setEditingId('')
    setMessage('已保存持仓')
    await loadPortfolio()
  }

  const editHolding = (holding: Holding) => {
    setForm(holding)
    setEditingId(holding.id)
    setTab('持仓')
  }

  const deleteHolding = async (id: string) => {
    if (!token) return
    await fetch(`/api/holdings/${id}`, { method: 'DELETE', headers: authHeaders(token) })
    await loadPortfolio()
  }

  const uploadScreenshot = async (file: File) => {
    if (!token) return
    const reader = new FileReader()
    reader.onload = async () => {
      const response = await fetch('/api/imports', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ fileName: file.name, imageData: reader.result }),
      })
      const data = await response.json()
      setMessage(response.ok ? '截图已保存，请在持仓表单中校对录入' : data.error || '上传失败')
      await loadPortfolio()
    }
    reader.readAsDataURL(file)
  }

  const logout = () => {
    localStorage.removeItem('family-invest-token')
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
          <span>{user ? `${user.displayName} · ${user.relation}` : '家庭投资助手'}</span>
          <button className="icon-button" onClick={refreshMarket} aria-label="刷新行情">
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
          </button>
        </div>
        <div className="asset-summary">
          <div>
            <p>估算总资产</p>
            <h1>{money(displayTotal)}</h1>
          </div>
          <div className="score-pill">
            <ShieldCheck size={16} />
            <span>{fallbackCount ? `${fallbackCount} 项待核验` : '数据已刷新'}</span>
          </div>
        </div>
        <div className="metric-grid">
          <div><span>昨日</span><b>{money(snapshot.yesterdayProfit)}</b></div>
          <div><span>持有收益</span><b>{money(snapshot.holdingProfit)}</b></div>
          <div><span>今年收益率</span><b>{pct(snapshot.ytdReturnPct)}</b></div>
        </div>
      </section>

      <section className={fallbackCount ? 'notice danger' : 'notice'}>
        <Bell size={18} />
        <span>
          {fallbackCount
            ? '有品种未取得实时/准实时行情，相关买卖建议已自动暂停。'
            : '行情每60秒刷新，基金估值仍以平台确认页为准。'}
        </span>
      </section>

      <nav className="tabs">
        {(['建议', '持仓', '导入', '设置'] as const).map((item) => (
          <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </nav>

      {tab === '建议' && (
        <section className="content-stack">
          {advices.map((advice) => (
            <article className={`advice-card ${advice.tone}`} key={advice.id}>
              <div className="card-head">
                <div>
                  <p>{advice.holding.kind === 'fund' ? '基金' : 'A股'} · {advice.holding.theme || advice.holding.code}</p>
                  <h2>{advice.holding.name}</h2>
                </div>
                <span>{advice.confidence}</span>
              </div>
              <div className="action-line">{advice.action}</div>
              <ul className="reason-list">
                {advice.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
              <div className="compliance-tag">{advice.dataLabel}</div>
            </article>
          ))}
        </section>
      )}

      {tab === '持仓' && (
        <section className="content-stack">
          <article className="settings-panel form-panel">
            <div className="setting-title">
              <Edit3 size={18} />
              <h2>{editingId ? '修改持仓' : '新增持仓'}</h2>
            </div>
            <div className="form-grid">
              <label>类型<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as AssetKind })}><option value="fund">基金</option><option value="stock">A股</option></select></label>
              <label>代码<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.trim() })} /></label>
              <label>名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label>主题<input value={form.theme} onChange={(event) => setForm({ ...form, theme: event.target.value })} /></label>
              <label>份额/股数<input type="number" value={form.units} onChange={(event) => setForm({ ...form, units: Number(event.target.value) })} /></label>
              <label>成本净值/成本价<input type="number" value={form.cost} onChange={(event) => setForm({ ...form, cost: Number(event.target.value) })} /></label>
              <label>目标仓位%<input type="number" value={form.targetWeight} onChange={(event) => setForm({ ...form, targetWeight: Number(event.target.value) })} /></label>
              <label>计划金额<input type="number" value={form.planAmount} onChange={(event) => setForm({ ...form, planAmount: Number(event.target.value) })} /></label>
              <label>风险<select value={form.risk} onChange={(event) => setForm({ ...form, risk: event.target.value as RiskProfile })}><option>保守</option><option>均衡</option><option>进取</option></select></label>
              <label className="wide">定投说明<input value={form.planStatus || ''} onChange={(event) => setForm({ ...form, planStatus: event.target.value })} /></label>
            </div>
            {message && <div className="inline-message">{message}</div>}
            <button onClick={saveHolding}><Save size={16} />保存</button>
            {editingId && <button className="secondary" onClick={() => { setEditingId(''); setForm(emptyHolding) }}>取消修改</button>}
          </article>

          {holdings.map((holding) => {
            const value = assetValue(holding, market)
            const quote = getQuote(holding, market)
            return (
              <article className="holding-card" key={holding.id}>
                <div>
                  <p>{holding.kind === 'fund' ? '基金' : 'A股'} · {quote?.verified ? quote.source : '待核验'}</p>
                  <h2>{holding.name}</h2>
                  <span>{holding.code} · {holding.theme || '未分类'} {holding.planStatus ? `· ${holding.planStatus}` : ''}</span>
                </div>
                <div className="holding-actions">
                  <b>{money(value)}</b>
                  <button onClick={() => editHolding(holding)} aria-label="编辑"><Edit3 size={16} /></button>
                  <button onClick={() => deleteHolding(holding.id)} aria-label="删除"><Trash2 size={16} /></button>
                </div>
              </article>
            )
          })}
        </section>
      )}

      {tab === '导入' && (
        <section className="content-stack">
          <article className="settings-panel">
            <div className="setting-title"><Upload size={18} /><h2>支付宝截图导入</h2></div>
            <p>先上传截图保存，再按截图内容在“持仓”里校对。下一步可以接 OCR 自动识别代码、金额、持有收益和定投计划。</p>
            <label className="upload-box">
              <Upload size={18} />
              选择支付宝持仓截图
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
            <p>正式使用建议部署到云平台。手机只需要打开云端 HTTPS 网址，不要求同一网络，也不需要这台电脑保持开机。</p>
            <div className="code-line">MARKET_PROVIDER=itick · STRICT_REALTIME=true</div>
          </article>
          <article className="settings-panel">
            <div className="setting-title"><WalletCards size={18} /><h2>账户和数据</h2></div>
            <p>账户只保存昵称、关系和本地口令哈希，不需要手机号。关系字段用于识别家人身份，不能单独当密码。</p>
            <button className="secondary" onClick={logout}><LogOut size={16} />退出登录</button>
          </article>
        </section>
      )}

      <footer className="bottom-note">
        本工具为家庭内部决策辅助，不构成公开投资建议。投资有风险，操作需谨慎。
      </footer>
    </main>
  )
}

export default App
