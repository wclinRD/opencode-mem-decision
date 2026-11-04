# opencode-mem-decision Plugin 載入失敗教训

## 問題
`opencode-mem-decision` plugin 無法正確載入。

## 原因
1. `opencode.jsonc` 缺少 `plugins` 陣列註冊。
2. Bun ESM bundle 輸出含 `// @bun` header，OpenCode v2.2.0 plugin loader 不支援。
3. plugin entry point 使用 `plugin.js`，但 OpenCode 期望 `index.js`。
4. TypeScript source 無法直接作為 plugin entry point。

## 解決
1. 在 `opencode.jsonc` 加入 `"plugins": ["opencode-mem-decision"]`。
2. 放棄 Bun bundle，直接以 JavaScript 重寫 plugin。
3. `package.json` 設定 `"main": "index.js"`。
