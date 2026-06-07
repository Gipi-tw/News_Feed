# gipi-digest — 個人內容爬蟲與摘要日報

每天台北 08:00 自動執行：新聞搜尋 → Claude 選文 → 事實摘要＋觀點 Hook → 依口吻風格指南生成「我的評論」→ 風格 lint → 存檔 → 私人網站（需登入）呈現。

單一使用者、私人系統。版型 100% 比照已驗收的範本（`config/template_reference.html`）。

## 技術棧

- **Next.js 15**（App Router）＋ TypeScript — pipeline 與網站同一專案
- **Prisma + SQLite** — 單一使用者，DB 在持久卷
- **Anthropic API** — 選文／摘要用 `claude-sonnet-4-6`，口吻評論用 `claude-opus-4-8`
- **搜尋層可抽換** — Brave（主）／Serper（繁中備援）／Mock（離線）
- **部署** — Docker → Fly.io；排程用 GitHub Actions 打 `/api/cron`

## 本機開發

```bash
npm install
cp .env.example .env          # 填 ANTHROPIC_API_KEY；無搜尋 key 時 SEARCH_PROVIDER=mock
npm run hash -- '你的密碼'     # 產生 AUTH_PASSWORD_HASH 貼回 .env
npx prisma db push            # 建立 SQLite schema
npm run seed                  # 把 config/ 的設定灌進 DB（首次）
npm run digest                # CLI 跑一期完整日報（驗證 pipeline）
npm run dev                   # 啟動網站 http://localhost:3000
```

無搜尋金鑰時，`SEARCH_PROVIDER=mock` 會用合成新聞讓整條 pipeline（選文→摘要→評論→lint→存檔→網站）端到端跑通。取得 Brave key 後，把 `.env` 的 `SEARCH_PROVIDER` 留空、並在設定頁把 `search.provider` 設為 `brave` 即上線真實搜尋。

## 設定（後台可編輯，存在 DB）

`/settings` 頁可線上編輯三項 source of truth，存進 DB（首次從 `config/` 種子）：

| 設定 | 內容 |
|---|---|
| `interest_profile` | 興趣輪廓（主題權重、人物、企業名單） |
| `style_guide` | 口吻風格指南 + 自我檢核清單 |
| `digest_config` (JSON) | 各區篇數配比 12/8/10/5、全域排除規則、查詢字串、搜尋來源、排程 cron |

## 環境變數

見 `.env.example`。重點：`ANTHROPIC_API_KEY`、`BRAVE_API_KEY`/`SERPER_API_KEY`、`AUTH_USERNAME`/`AUTH_PASSWORD_HASH`/`AUTH_SECRET`、`CRON_SECRET`、`DATABASE_URL`、（選）`RESEND_API_KEY`/`NOTIFY_EMAIL`。

## 部署（Fly.io）

```bash
fly launch --no-deploy            # 建 app（沿用本 fly.toml；改 app 名）
fly volumes create digest_data --size 1 --region nrt
fly secrets set \
  ANTHROPIC_API_KEY=... \
  BRAVE_API_KEY=... \
  AUTH_USERNAME=gipi AUTH_PASSWORD_HASH='$2b$...' \
  AUTH_SECRET=$(openssl rand -hex 32) \
  CRON_SECRET=$(openssl rand -hex 32) \
  RESEND_API_KEY=...   # 選用
fly deploy
```

開機時 `docker-entrypoint.sh` 會跑 `prisma db push` 建表（idempotent）。

## 排程（每日 08:00 台北）

用 GitHub Actions（`.github/workflows/daily-digest.yml`，UTC `0 0 * * *` = 台北 08:00）打 `/api/cron`。在 repo Secrets 設：

- `APP_BASE_URL`（如 `https://gipi-digest.fly.dev`）
- `CRON_SECRET`（與 Fly secret 相同）

`/api/cron` 以 `Authorization: Bearer $CRON_SECRET` 自我驗證；失敗會記在 `RunLog` 並（若設定）發 email。cron 失敗時也可在首頁按「⚡ 立即產生今日日報」補跑。

## Pipeline 架構

```
runDigest()  (src/pipeline/index.ts)
  1. 讀設定（interest_profile / style_guide / digest_config）
  2. runSearches      — 各區查詢 × provider（繁中優先 fallback）
  3. hardFilter       — URL 硬去重（最近 30 天）
  4. selectForTier    — 每區用 snippet 選 N 篇（含近 30 天標題避免重複事件）
  5. enrichCandidates — 只對選中的抓全文（readability）
  6. summarizeTier    — 事實摘要 + 觀點 Hook
  7. generateComment  — 口吻評論 + 程式化 lint，最多重試 2 次
  8. saveDigest       — 存 DB + 更新去重索引
  9. notifyDigestReady— （選）email
```

## 驗收對照（SPEC §7）

- [x] cron 觸發後產出完整日報，無人工介入
- [x] URL 級零重複（30 天窗口）
- [x] 評論通過風格 lint（字數／結尾非反問／含「我覺得」／含保留語氣／無「我之前就說過」）— 未過會標記並可手動編輯
- [x] 版型比照範本，手機可閱讀與展開／複製
- [x] 未登入無法存取任何頁面或 API（middleware）
- [x] 失敗有 retry（評論）與錯誤通知 + RunLog 自診
