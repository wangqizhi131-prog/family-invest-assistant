# 家庭 A 股实时助手

手机优先的家庭自用 A 股看板。网站部署在 Cloudflare Workers，账户和持仓数据保存在 Cloudflare D1，手机和电脑只要打开网址就能使用，不依赖本机开机或同一局域网。

线上地址：

```text
https://family-invest-assistant.wangqizhi131.workers.dev
```

## 已支持

- 真实姓名 + 电话号码注册/登录，不同账号数据独立保存。
- 应用范围固定为 A 股，不混入其他资产模块。
- 自选股、持仓新增、编辑、删除。
- 输入 6 位股票代码自动识别市场、名称、主题，并拉取实时行情。
- 持仓截图/自选截图上传记录，后续手动校对录入。
- 交易时间行情每 30 秒刷新，非交易时间每 60 秒刷新，投资分析每 120 秒刷新。
- iTick 授权行情接入，返回 `verified:true` 的数据才用于具体建议。
- 每只自选股和持仓都生成 K 线、均线、支撑压力、新闻/公告/政策入口和交易建议。

## 本地开发

```bash
npm install
npm run api
npm run dev -- --host 0.0.0.0
```

本地访问：

```text
http://localhost:5173
```

## Cloudflare 部署

项目使用 Workers + Assets + D1：

- `worker/index.mjs`：线上 API 和静态资源入口。
- `schema.sql`：D1 数据库表结构。
- `wrangler.toml`：Cloudflare Worker、Assets、D1 配置。
- `src/App.tsx`：手机优先前端。

首次部署需要：

```bash
npx wrangler login
npx wrangler d1 create family-invest-assistant
npx wrangler d1 execute family-invest-assistant --remote --file=./schema.sql
npx wrangler secret put APP_SECRET
npx wrangler secret put ITICK_TOKEN
npm run build
npx wrangler deploy
```

`APP_SECRET` 用来签登录状态，`ITICK_TOKEN` 是授权实时行情 token，二者都不要写进 GitHub。

## 验收命令

```bash
npm run lint
npm run build
npm run smoke
npx wrangler deploy
```

线上健康检查：

```text
GET /api/health
```

正常应看到：

```json
{
  "ok": true,
  "storage": "cloudflare-d1",
  "hasAuthorizedMarketToken": true,
  "assetScope": "a-stocks-only"
}
```

## 数据边界

- D1 是当前的长期数据存储，优于 Render 免费实例的临时文件系统。
- 截图导入目前只保存上传记录，不做 OCR 自动识别；录入仍以人工校对为准。
- 若行情接口超时、限流或字段无法识别，系统会标记为未验证，并避免把不可用数据包装成实时交易信号。
- 本工具只供家庭内部辅助决策，不构成公开投资建议；投资有风险，交易需谨慎。
