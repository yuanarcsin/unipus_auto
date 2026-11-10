# WE Learn Unit 4 验证记录

日期：2026-11-08。对该课程 Unit 4 的 7 个可访问静态 SCO 资源进行核验；本轮资源读取未使用用户发送的 Cookie，未提交答案或修改成绩。教师关闭的项目不在测试范围。

| Unit 4 课件 | 路由 | 固定答案位 | 类型 |
|---|---|---:|---|
| Listening Strategy | `4/1-1` | 2 | 单选 ×2 |
| Pre-listening Task | `4/2-1` | 0 | 开放问答 ×4；每题有对应参考表达（3/3/5/1 条） |
| Listening Tasks – Conversation 1 | `4/2-2` | 6 | 多选 ×3、单选 ×3 |
| Listening Tasks – Conversation 2 | `4/2-3` | 8 | 单选 ×4、填空 ×4 |
| Speaking Tasks – Read Aloud | `4/2-4` | 0 | 无固定评分答案；可提取跟读稿 6 句 |
| Speaking Tasks – Pair Work | `4/2-5` | 0 | 无固定评分答案；可提取对话稿 2 段、15 句 |
| Test Your Listening | `4/3-1` | 6 | 判断 ×6 |
| **合计** | | **22** | |

使用 Chromium 的 `DOMParser` 对上述 7 个真实资源逐一解析；对于有题位的 `1-1`、`2-2`、`2-3`、`3-1`，还核对了页面渲染后的 `et-choice`、`et-blank`、`et-tof` 数量与填入目标结构。旧版解析器因强制要求 `<tab>`，会遗漏 `1-1` 的两道题；新版支持无 `<tab>` 页面，并按文档顺序处理单选、多选、填空和判断。

本次验证覆盖**资源读取、答案标记与参考文本解析及 DOM 目标存在性**，不等同于登录浏览器中的逐题点击、自动提交或最终评分验证。`2-1` 的四道开放题各有一个 `et-reveal` 参考区块，与题目逐一配对；这些是可选表达，不是唯一答案。`2-4` 的 `et-follow-me` 保存朗读文本；`2-5` 的 `et-talk flow` 保存带角色标记的完整台词。插件对参考文本题只展示原文与可选的 AI 示例，不代录音、不填答、不提交，也不将其冒充为固定评分答案。

额外用不含 `et-recorder` 的文字问答夹具验证相同的 `et-reveal` 配对；混合页面同时提取有 key 的客观题与参考文本题。DeepSeek 使用官方 Chat Completions 接口的 JSON 输出、关闭思考模式；未提供 API Key，因此真实模型质量与登录态最终评分未验证。

本地回归：

```sh
node --test tests/welearn.test.mjs
chromium --headless --no-sandbox --disable-gpu --disable-dev-shm-usage --virtual-time-budget=2000 --dump-dom "file://$PWD/tests/welearn-harness.html"
```

第二条命令输出应包含 `<pre id="result">PASS</pre>`。
