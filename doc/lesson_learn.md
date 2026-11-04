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

---

# 2026-11-04 更正：真正根因是 V1 plugin API 不相容 V2

> 上面「原因」章節的推測不完整。實際 log 顯示 loader 已找到 `index.js`，失敗點在 export 形狀，不在檔名或 bundle。

## 證據

```
level=WARN message="failed to load plugin"
target=/Users/wclin/.config/opencode/plugins/opencode-mem-decision
cause="Cause([Fail(PluginModule.LoadError:
Plugin must export a default definition with an id and an effect or setup function.
(cause: SchemaError(Missing key at ["default"]["effect"] Missing key at ["default"]["setup"])))])"
```

環境：OpenCode **v2.2.0**。

## 根因

1. plugin 使用 **V1 形狀** `export default { id, server }`。
2. V2 要求 `export default Plugin.define({ id, setup(ctx) {...} })`，且套件是 `@opencode/plugin`，不是 `@opencode-ai/plugin`。
3. V1 的 `tool()` helper 也不能用。V2 要用 `ctx.tool.transform((editor) => editor.add(...))`，`input` 是 JSON Schema，`execute` 回傳 `{ content }`。
4. 另一個中間錯誤：從 `@opencode-ai/plugin/dist/promise/index.js` 匯入 `createPlugin`，該 export 不存在，會得到 `SyntaxError: Export named 'createPlugin' not found`。

## 修正

```js
import { Plugin } from "@opencode/plugin";

export default Plugin.define({
  id: "opencode-mem-decision",
  async setup(ctx) {
    const config = loadConfig(ctx.options || {});
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "memory",
        description: "Manage cross-session memories and knowledge",
        input: { type: "object", properties: { /* ... */ }, required: ["mode"] },
        execute: async (input) => ({ content: await run(input) }),
      });
    });
  },
});
```

- 舊 hook 對應：`session.idle` → `ctx.event.subscribe({ types: ["session.idle"] })`；`experimental.session.compacting` → `ctx.session.hook("compaction", ...)`。
- plugin options 從 `ctx.options` 讀，不是第二個參數。
- `setup` 可回傳 cleanup function，用來關閉 server、abort subscription。

## 驗證方式

```sh
opencode service restart
grep "opencode-mem-decision" ~/.local/share/opencode/log/opencode.log | tail
```

成功標準：有 `loading plugin`，**沒有** `failed to load plugin`，且 `memory` tool 出現在工具清單。

## 這次踩到的其他坑

1. **改錯地方**：實際載入的是 `~/.config/opencode/plugins/opencode-mem-decision/` 全域副本，不是 repo。改 repo 後必須同步 `index.js`、`package.json`、`src/`，並在全域目錄 `npm install`。
2. **web server 永遠不啟動**：原本條件是 `webServerHost !== "127.0.0.1"`，預設值就是 `127.0.0.1`，所以永遠 false。改成 host 非空即啟動。
3. **`~` 沒展開**：`path.join("~/.opencode-memory", ...)` 會建出字面 `~` 目錄。改用 `os.homedir()`。
4. **partial config 覆蓋預設**：`{...DEFAULT_CONFIG, ...userConfig}` 會讓只給 `chatMessage.enabled` 的設定洗掉其他預設欄位。要 deep merge。
5. **V2 tool 回傳形狀**：直接回傳物件/字串會錯，必須 `{ content }`。

## 檢查清單

- [ ] 套件依賴是 `@opencode/plugin` 2.x
- [ ] default export 是 `Plugin.define({ id, setup })`
- [ ] tool 用 `ctx.tool.transform` 註冊，input 是 JSON Schema
- [ ] `execute` 回傳 `{ content }`
- [ ] 同步到 `~/.config/opencode/plugins/` 全域目錄
- [ ] log 無 `failed to load plugin`
- [ ] `npm test` 全綠
