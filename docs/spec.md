# 日報規格（2026-10 版）

取代原本只寫在 Cowork 排程 prompt 裡的規格。程式裡對應的設定在 `config/digest_config.json`（`configVersion: 2`），配額由 `src/pipeline/quota.ts` 強制執行。

## 5 區 45 篇（顯示順序）

| 區塊 | 篇數 | 色系 | 配額 |
|---|---|---|---|
| 🏢 企業動態：國際科技巨頭 | 10 | tier0 深藍 | 以 AI 為主軸 ≤ 5（即至少 5 篇與 AI 無關） |
| 🍔 餐飲・飲料產業 | 10 | tier4 橘棕（border `#d35400`、bg `#fdf2e9`） | 以 AI 為主軸 ≤ 2 |
| 🧭 領導・組織・工作方式 | 10 | tier1 紅 | 以 AI 為主軸 ≤ 4，以非 AI 角度為主 |
| 🟡 第二級 | 8 | tier2 黃 | AI 開發實務 ≤ 2 |
| 🟢 生活版 | 7 | tier3 綠 | 心理學＋親子教育 ≥ 4；其他（魂系遊戲／健身／投資）≤ 3 |

全份以 AI 為主軸 ≤ 15 篇。

## 硬性規則（回饋不能推翻）

- 上表的配額由程式強制，不靠模型自律：選文時每則候選都要標主題標籤，程式依標籤挑選、超標時用同區備選遞補。
- **寧缺勿濫**：某區找不到足夠的好內容就少收，頁尾寫明篇數和原因；不拿 AI 新聞或重複事件硬湊。
- 排除純財報、股價新聞。同一個持續事件只收新進展。
- 去重：URL 為硬條件（30 天窗口），事件相似為軟條件。

## 追蹤名單

- 企業區：Google、Musk 系（Tesla／SpaceX／X）、Apple、Microsoft、OpenAI、Anthropic、NVIDIA（含黃仁勳）、Meta、Amazon、Netflix、Uber、Disney、Intel、Salesforce、Coinbase。
- 餐飲區：`config/food_watchlist.md`。

## 每張卡片

全份連續編號 1–45、可點的標題、來源和日期、事實摘要（含具體數據）、觀點 hook、虛線分隔的原始連結列。

## 頁尾

- 配比與去重規則。
- **關於篇數**：少收的區塊列出「實收／目標」與原因（含配額造成的取捨），以及全份 AI 主軸篇數。

## 來源（第 2 步）

- 收集每 4 小時一次（出日報前也會先跑），來源清單在 `digest_config.sources`，可在設定頁編輯。
- RSS：woshipm、INSIDE、TechCrunch、極客公園、Bloomberg Tech、WIRED（含 Gear）、Gizmodo、InfoQ、iThome、Slashdot、The Verge、Fast Company、HBR（http）、Lifehacker、MIT SMR、TechNews、PsyPost、NRN，加上 Cowork 實際常用的 Fortune、Restaurant Dive、Food Dive、HR Dive。
- Google News：沒有 RSS 的站用 `site:` 查（數位時代、經理人、親子天下、Restaurant Business）；追蹤企業／人物各一條（企業區 11 條、餐飲區 9 條）。連結是 Google 轉址，選中後才解回原文網址。
- 篩選：專屬來源一律評分；綜合來源要命中關鍵字／人名才評分。Haiku 只看標題＋摘要給「區塊＋0–10 分」；只對選中的文章抓全文。
- 某區候選不足（< 名額 × 2）時，用該區 `queries` 跑 Google News 補搜尋。
- 暫不收：36氪、機器之心、新智元、微軟研究院AI頭條（找不到 feed、幾乎全是 AI）；VentureBeat（429）；Just Drinks（403）。

## 尚未做（依開發順序）

- 第 3 步：🎬 影音重點（YouTube 逐字稿摘要，不佔 45 篇名額）。
- 第 4 步：👍👎 存進資料庫、依回饋調整選文（規則見 `config/feedback_rules.md`），頁尾加「本期已套用回饋」。
- 第 5 步：「💬 我的評論」草稿。
