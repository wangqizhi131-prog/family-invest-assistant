# 部署说明

当前推荐方案是 Cloudflare Workers + Assets + D1。这个方案有免费额度，手机和电脑随时访问同一个 HTTPS 地址，数据保存在 D1，不依赖你的电脑开机。

生产站点：

```text
https://family-invest-assistant.wangqizhi131.workers.dev
```

## 当前线上状态

- Cloudflare 账号：`wangqizhi131@gmail.com`
- Worker：`family-invest-assistant`
- D1 数据库：`family-invest-assistant`
- 数据区域：APAC
- 线上存储：Cloudflare D1
- 行情源：iTick 授权 A 股实时行情

## 首次部署

1. 登录 Cloudflare：

```bash
npx wrangler login
```

2. 创建 D1 数据库：

```bash
npx wrangler d1 create family-invest-assistant
```

把返回的 `database_id` 写进 `wrangler.toml`。

3. 初始化远程数据库表：

```bash
npx wrangler d1 execute family-invest-assistant --remote --file=./schema.sql
```

4. 设置密钥：

```bash
npx wrangler secret put APP_SECRET
npx wrangler secret put ITICK_TOKEN
```

`APP_SECRET` 建议用一串很长的随机值。`ITICK_TOKEN` 是行情服务 token，不能提交到仓库。

5. 构建并部署：

```bash
npm run build
npx wrangler deploy
```

## 日常更新

修改前端或 Worker 后，运行：

```bash
npm run lint
npm run build
npm run smoke
npx wrangler deploy
```

部署后检查：

```powershell
Invoke-RestMethod "https://family-invest-assistant.wangqizhi131.workers.dev/api/health"
Invoke-RestMethod "https://family-invest-assistant.wangqizhi131.workers.dev/api/stocks/lookup?code=600000"
```

`/api/health` 应返回：

- `ok: true`
- `storage: "cloudflare-d1"`
- `hasAuthorizedMarketToken: true`
- `assetScope: "a-stocks-only"`

## 持久化说明

D1 会保存账号、自选股、持仓和截图导入记录。Render 免费 Web Service 的文件系统是临时的，不再作为长期方案使用。

如果以后要增强截图导入，建议新增 Cloudflare R2 保存原图，再接 OCR 服务识别图片内容；当前版本只保存截图文件名、备注和导入状态，避免把大图片塞进 D1。

## 安全边界

- 登录方式按用户要求简化为真实姓名 + 电话号码，不使用密码。
- 电话号码相当于登录凭据，不会在页面完整展示。
- 这是家庭内部工具，不适合作为公开注册网站直接开放给陌生人。
- 所有具体交易建议都必须基于 `verified:true` 的授权行情；行情失败时宁可提示不可用，也不伪造实时信号。

## GitHub 推送

如果网络代理导致 `git push` SSL 握手失败，可以等网络恢复后运行：

```bash
git push
```

本地提交已经存在，`git status --short --branch` 可查看当前是否仍领先远端。
