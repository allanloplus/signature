# Allan's簽名工作坊

純前端靜態網站（無建置步驟）。函式庫放在 `vendor/`，不使用 CDN。

## 每次更新都要做
修改網站後，必須同步更新 `index.html` 頁尾（`<footer class="site-foot">`）：
- 「更新日期」改為當下的台灣時間，格式 `YYYY/MM/DD HH:MM`（`TZ=Asia/Taipei date '+%Y/%m/%d %H:%M'`）。
- 「版本」格式 `allanlo-YYYYMMDD-NN`：同一天內 NN 遞增（01、02…），換日則日期更新並從 01 重新起算。
- 「初版日期：2026/11/22」與「系統設計」不變。

目前版本：allanlo-20261122-01

## 注意
- 絕不提交任何簽名圖檔。簽名只存在使用者裝置的 localStorage。
- 維持 `index.html` 的 CSP（`connect-src 'self'`），不得加入對外連線。
