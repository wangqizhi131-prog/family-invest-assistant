# 云部署说明

目标：把家庭投资助手放到云服务器上。这样手机只需要打开一个 HTTPS 网址，不需要和电脑在同一网络，也不需要你的电脑开机。

## 推荐方案

优先用 Render、Railway、Fly.io 这类能跑 Node 服务的平台。项目已经包含：

- `server.mjs`：同时提供网页和 API。
- `render.yaml`：Render 一键部署蓝图。
- `Dockerfile`：Docker 平台通用部署。
- `.env.example`：云端环境变量模板。

## 必填环境变量

```text
APP_SECRET=一串很长的随机密钥
DATA_DIR=/var/data
MARKET_PROVIDER=itick
STRICT_REALTIME=true
ITICK_TOKEN=你的授权行情接口Token
ITICK_BASE_URL=https://api-free.itick.org
ITICK_FUND_REGION=CN
PORT=8787
```

`APP_SECRET` 用来签登录状态，不能公开。`DATA_DIR` 必须指向云平台的持久化磁盘，否则平台重启后账户和持仓可能丢失。

## 实时行情原则

真正“避免虚假数据”的做法是：只把授权数据源返回的数据标记为可交易依据。

- 配置 `ITICK_TOKEN` 后，服务端会尝试走授权行情接口。
- 没有 `ITICK_TOKEN`，或接口没有返回可识别价格时，接口会返回 `verified:false`。
- 前端看到 `verified:false` 会自动暂停具体买卖建议，只允许校对持仓。
- 公开接口和兜底数据不能伪装成实时行情。

基金尤其要注意：很多平台只提供净值或估算净值，不等于支付宝最终确认净值。交易前仍要以支付宝或基金公司确认页为准。

## 接入授权行情 Token

拿到 iTick 或兼容服务商的 Token 后，不要写进 GitHub。用本地脚本写入 Render 环境变量：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/set-render-market-token.ps1 -Token "你的Token"
tools\render-cli\cli_v2.17.0.exe deploys create srv-d82hdojrjlhs73dh2i8g -o json --confirm
```

重新部署后检查：

```powershell
Invoke-RestMethod "https://family-invest-assistant.onrender.com/api/health"
Invoke-RestMethod "https://family-invest-assistant.onrender.com/api/market?funds=021190&stocks=sh600000"
```

`hasAuthorizedMarketToken` 应为 `true`。具体品种只有在授权接口实际返回价格时才会显示 `verified:true`。

## Render 部署步骤

1. 把这个项目上传到 GitHub 私有仓库。
2. 在 Render 创建 Blueprint，选择仓库里的 `render.yaml`。
3. 创建后在环境变量里填入 `ITICK_TOKEN`。
4. 确认磁盘挂载路径是 `/var/data`。
5. 部署完成后，Render 会给一个 `https://...onrender.com` 网址，手机直接打开即可。

如果 Render 工作区暂时没有付款方式，可以先用 `render-free.yaml` 创建临时服务。这个版本能得到公网网址，但没有持久化磁盘，服务休眠或重启后账户和持仓可能丢失，只适合试用。

## 本地快速公网访问

`npm run public` 仍然保留，适合临时给手机试用。但这不是最终方案，因为电脑必须开机，隧道地址也可能变化。
