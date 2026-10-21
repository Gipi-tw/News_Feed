# gipi-digest — 個人內容爬蟲與摘要日報

每天台北 08:00 自動執行：新聞搜尋 → Claude 選文 → 事實摘要＋觀點 Hook → 依口吻風格指南生成「我的評論」→ 風格 lint → 存檔 → 私人網站（需登入）呈現。

單一使用者、私人系統。版型 100% 比照已驗收的範本（`config/template_reference.html`）。

## 技術棧

- **Next.js 15**（App Router）＋ TypeScript — pipeline 與網站同一專案
- **Prisma + SQLite** — 單一使用者，DB 在持久卷
- **Anthropic API** — 選文／摘要用 `claude-sonnet-4-6`，口吻評論用 `claude-opus-4-8`
- **搜尋層可抽換** — Brave（主）／Serper（繁中備援）／Mock（離線）
- **部署** — Docker → Fly.io；每日排程由 app 自己在 prod 主機上觸發（`src/lib/scheduler.ts`）

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
| `digest_config` (JSON) | 5 區配比 10/10/10/8/7、標籤配額（AI 上限等）、全域排除規則、查詢字串、搜尋來源、排程 cron。`configVersion` 比 DB 新時，部署後會自動換新並備份舊版 |

## 環境變數

見 `.env.example`。重點：`ANTHROPIC_API_KEY`、`BRAVE_API_KEY`/`SERPER_API_KEY`、`AUTH_USERNAME`/`AUTH_PASSWORD_HASH`/`AUTH_SECRET`、`CRON_SECRET`、`DATABASE_URL`、（選）`RESEND_API_KEY`/`NOTIFY_EMAIL`：每天把整份日報寄到信箱，失敗時寄通知；沒有驗證網域時，Resend 只能寄給開帳號用的那個信箱（見 `docs/spec.md`「📧 每天寄信」）。

## 部署（Fly.io）

```bash
fly launch --no-deploy            # 建 app（沿用本 fly.toml；改 app 名）
fly volumes create digest_data --size 1 --region nrt
fly secrets set \
  ANTHROPIC_API_KEY=... \
  SUPADATA_API_KEY=...   # 🎬 影片逐字稿；沒設的話影片只列標題 \
  BRAVE_API_KEY=...      # 選用：只有 provider=brave 才用 \
  AUTH_USERNAME=gipi AUTH_PASSWORD_HASH='$2b$...' \
  AUTH_SECRET=$(openssl rand -hex 32) \
  CRON_SECRET=$(openssl rand -hex 32) \
  RESEND_API_KEY=... NOTIFY_EMAIL=...   # 選用：每天寄信
fly deploy
```

開機時 `docker-entrypoint.sh` 會跑 `prisma db push` 建表（idempotent）。

## 排程（每日 08:00 台北）

prod 主機常駐（`auto_stop_machines = "off"`），由 app 內建排程每分鐘檢查一次：到了 `digest_config.scheduleCron`（預設 `0 8 * * *`，時區 `timezone`）就跑當天的日報，每天只試一次。主機在 08:00 之後 4 小時內重啟，也會補跑當天這一期。只在 production 啟動（`next dev` 不會跑），設 `DIGEST_SCHEDULER=off` 可關閉。

不用 GitHub Actions 排程的原因：6 月實測每次晚 60–80 分鐘才觸發，而且公開 repo 60 天沒有 commit 會被自動停用。`.github/workflows/daily-digest.yml` 只留手動觸發，打 `/api/cron`（repo Secrets：`APP_BASE_URL`、`CRON_SECRET`，與 Fly secret 相同）。

`/api/cron` 以 `Authorization: Bearer $CRON_SECRET` 自我驗證；失敗會記在 `RunLog` 並（若設定）發 email。排程失敗時也可在首頁按「⚡ 立即產生今日日報」補跑。

## Pipeline 架構

```
runCollect()  (src/collect/index.ts) — 每天台北 05:00 一次；出日報時若當天沒收集成功才補跑
  1. 抓 digest_config.sources 裡的 RSS（23 個）與 Google News 查詢（24 條）
  2. 以連結去重後存進 Item 表（保留 14 天）
  3. 初篩：專屬來源一律通過；綜合來源要命中關鍵字／人名
  4. Haiku 只看標題＋摘要，給每則「最適合的區塊＋0–10 分」

runDigest()  (src/pipeline/index.ts) — 每天 08:00
  1. 讀設定（interest_profile / digest_config）
  2. 候選：各區取 48 小時內、分數 ≥ minScore 的收集文章；不夠就用該區 queries 跑 Google News 補搜尋
  3. selectForTier    — 每區排序＋標主題標籤（含近 30 天標題避免重複事件）
  4. resolveLinks     — Google News 轉址解回原文網址，再做 URL 去重
  5. enforceQuotas    — 程式強制配額（AI 上限等），超標用備選遞補
  6. enrichCandidates — 只對選中的抓全文（readability）
  7. summarizeTier    — 事實摘要 + 觀點 Hook
  8. saveDigest       — 存 DB（含頁尾 notes）+ 更新去重索引 + 標記已用的 Item
  9. notifyDigestReady— （選）email
```

`digest_config.search.provider` 也可改回 `claude`（Claude 內建 web_search）或第三方搜尋。來源健康檢查：`npx tsx scripts/check-sources.ts`（PR 改到來源時 GitHub Actions 會自動跑）。

## 驗收對照（SPEC §7）

- [x] cron 觸發後產出完整日報，無人工介入
- [x] URL 級零重複（30 天窗口）
- [x] 評論通過風格 lint（字數／結尾非反問／含「我覺得」／含保留語氣／無「我之前就說過」）— 未過會標記並可手動編輯
- [x] 版型比照範本，手機可閱讀與展開／複製
- [x] 未登入無法存取任何頁面或 API（middleware）
- [x] 失敗有 retry（評論）與錯誤通知 + RunLog 自診
