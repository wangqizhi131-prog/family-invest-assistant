# 家庭投资助手

一个手机优先的家庭/亲友自用 A 股与基金决策辅助工具。

## 已支持

- 不用手机号注册账户
- 用昵称、和网站创建者的关系、访问口令登录
- 每个账户独立保存持仓
- 基金/A 股持仓新增、编辑、删除
- 支付宝持仓截图上传保存，先人工校对录入
- 行情每 60 秒刷新
- 行情数据明确显示来源和更新时间
- 未取得实时/准实时数据时，相关买卖建议自动暂停，避免兜底数据伪装成实时信号
- 构建后可由同一个后端端口提供网页和 API，适合做公网隧道
- 已加入云部署配置，可部署为手机随时访问的 HTTPS 网站

## 本地开发

```bash
npm run api
npm run dev -- --host 0.0.0.0
```

访问：

```text
http://localhost:5173
```

## 云端部署

如果要做到“跟电脑无关，手机随时访问”，需要把项目部署到云平台。项目已经准备好：

- `render.yaml`：Render 蓝图部署
- `Dockerfile`：Docker 平台通用部署
- `.env.example`：云端环境变量模板
- `DEPLOYMENT.md`：详细步骤

云端必须设置这些关键变量：

```text
APP_SECRET=一串很长的随机密钥
DATA_DIR=/var/data
MARKET_PROVIDER=itick
STRICT_REALTIME=true
ITICK_TOKEN=你的授权行情接口Token
```

没有 `ITICK_TOKEN` 时，网站仍可录入和管理持仓，但行情会标为未验证，具体买卖建议会暂停。

## 临时异地访问

本地临时试用可以运行一条命令，生成一个手机可直接打开的 HTTPS 地址。当前优先使用项目内的 Cloudflare Tunnel 工具；如果没有这个工具，脚本会回落到 localtunnel。

```powershell
npm run public
```

命令完成后，终端会显示：

```text
https://xxxx.trycloudflare.com
```

手机不用安装任何东西，直接打开这个网址即可。电脑必须保持开机，脚本启动的本地服务和隧道进程必须保持运行。

生成的网址也会保存到：

```text
REMOTE_URL.txt
```

当前已经验证过的公网地址会保存在：

```text
REMOTE_URL.txt
```

注意：这个临时地址在电脑重启、隧道进程停止或重新启动后可能会变化。长期稳定访问请按 `DEPLOYMENT.md` 做云部署。

## 本机服务

构建并用后端直接提供网页：

```bash
npm run serve
```

访问：

```text
http://localhost:8787
```

Cloudflare Tunnel 应转发：

```bash
cloudflared tunnel --url http://localhost:8787
```

## 实时数据边界

- 授权行情源返回的数据才会标记为 `verified:true`。
- 未配置授权密钥、接口报错、字段无法识别时，一律标记为 `verified:false`。
- 前端会对未验证品种暂停买入/卖出建议。
- 公开接口或历史净值不能伪装成实时行情。

## 安全边界

- “关系”只用于识别身份，不能单独当密码。
- 每个用户仍需要访问口令。
- 本地数据保存在 `data/db.json`；云端数据保存在 `DATA_DIR` 指向的持久化磁盘。
- 这是家庭内部决策辅助工具，不构成公开投资建议。
- 基金盘中估值不等于最终净值，交易前以支付宝或基金平台确认页为准。

## 下一步

- 接入真正 OCR，自动识别支付宝截图里的基金名称、金额、收益、定投计划。
- 增加管理员查看/校对亲友上传截图的页面。
- 部署到 Render/Railway/Fly 等云平台。
- 可选：把 `data/db.json` 换成 SQLite，并增加备份。
