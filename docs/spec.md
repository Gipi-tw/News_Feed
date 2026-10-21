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

- 收集每天一次（台北 05:00，`sources.collectCron`）；出日報時只有當天凌晨那次沒成功才補跑。來源清單在 `digest_config.sources`，可在設定頁編輯。高流量 RSS（TechCrunch、The Verge 等只給最新 10–20 篇）一天抓一次會漏掉部分文章，候選常不夠時可改成一天兩次。
- 評分與選文會帶入完整的興趣輪廓（不再只取開頭 1,500 字），並用提示快取降低重複成本。
- RSS：woshipm、INSIDE、TechCrunch、極客公園、Bloomberg Tech、WIRED（含 Gear）、Gizmodo、InfoQ、iThome、Slashdot、The Verge、Fast Company、HBR（http）、Lifehacker、MIT SMR、TechNews、PsyPost、NRN，加上 Cowork 實際常用的 Fortune、Restaurant Dive、Food Dive、HR Dive。
- Google News：沒有 RSS 的站用 `site:` 查（數位時代、經理人、親子天下、Restaurant Business）；追蹤企業／人物各一條（企業區 11 條、餐飲區 9 條）。企業區與餐飲區的查詢都加上組織／經營類關鍵字（精品咖啡除外），避開促銷、菜單、股價閒聊；烈酒查詢另外排除 Red Bull 的賽車和球隊新聞。連結是 Google 轉址，選中後才解回原文網址。
- 篩選：專屬來源一律評分；綜合來源要命中關鍵字／人名才評分。Haiku 只看標題＋摘要給「區塊＋0–10 分」；只對選中的文章抓全文。
- 某區候選不足（< 名額 × 2）時，用該區 `queries` 跑 Google News 補搜尋。
- 暫不收：36氪、機器之心、新智元、微軟研究院AI頭條（找不到 feed、幾乎全是 AI）；VentureBeat（429）；Just Drinks（403）。

## 🎬 影音重點（第 3 步）

- 頻道清單在 `digest_config.videos.channels`（16 個；BBC Learning English、Easy English Audio、Chill Story Cafe 是練英文用的，刻意不摘要）。
- 每天 05:00 收集時一起跑：讀各頻道的「影片」分頁找新片（頻道 RSS 從 10 月中起常回 404／500；影片分頁本來就不含 Shorts，還看得到片長）。只收 15 分鐘以上、3 天內上的片。
- 逐字稿用 Supadata（`mode=native`、`lang=en`，每支 1 點，跟片長無關；雲端主機直接抓 YouTube 字幕會被擋）。每天能抓幾支，是把本月剩下的點數平均分到月底（保留 3 點），所以不會月初就用完。
- 摘要用 Haiku（帶完整興趣輪廓）：一句話重點、3–5 個關鍵觀點（附時間戳連結）、數據或金句、Hook、值不值得看全片／建議看哪幾段。
- 日報裡獨立一區，不佔 45 篇名額；沒摘要成的新片（沒字幕、額度不足）列在最後，不會默默消失。
- 逐字稿保留 14 天，摘要永久保留。

## 不做

- 第 5 步「💬 我的評論」草稿：2026-10-21 決定不做。

## 尚未做

- 第 4 步：👍👎 存進資料庫、依回饋調整選文（規則見 `config/feedback_rules.md`），頁尾加「本期已套用回饋」。
