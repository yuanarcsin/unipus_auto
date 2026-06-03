# AI 自动答题助手

智能浏览器答题插件，自动识别网页题目并通过 AI 大模型获取答案并填入。

## 功能

- **题目识别** — 自动识别单选、多选、填空、选词填空
- **AI 答题** — 调用 AI 大模型分析题目并填入答案
- **API 直取** — U 校园等平台支持从服务端 API 直接获取正解（准确率 100%）
- **站点模板** — 预设常见平台的 DOM 结构，秒级完成题目识别
- **自定义模型** — 兼容所有 OpenAI 格式的 API 服务
- **题库缓存** — 已答题目自动缓存，复用无需重复请求

## 支持的平台

| 平台 | 策略 | 准确率 |
|------|------|--------|
| U校园 (Unipus) | API 直取 + 模板扫描 | ~100% |
| 问卷星 (WJX) | 模板扫描 + AI | 高 |
| 腾讯问卷 | 模板扫描 + AI | 高 |
| WE Learn | 数据 HTML 解析 | ~100% |
| 其他站点 | AI 分析 | 依赖模型 |

## 下载与安装

### 获取源码

```bash
git clone https://github.com/yuanarcsin/unipus_auto.git
```

### 加载扩展

**Edge 浏览器：**

1. 地址栏打开 `edge://extensions/`
2. 开启左下角「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择 `AutoUnipus/extension/` 文件夹

**Chrome 浏览器：**

1. 地址栏打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `AutoUnipus/extension/` 文件夹

### 验证安装

扩展图标出现在工具栏即安装成功。打开 U 校园练习页，点击扩展图标打开面板。

## 使用方法

### 首次配置

1. 点击工具栏扩展图标打开面板
2. 在「API 设置」中填入 API Base URL 和 Key
3. 点击「保存」

### 自动答题流程

1. 打开 U 校园练习页面
2. 点击扩展图标 → 点击「扫描题目」
3. 确认扫描到的题目数量
4. 点击「开始答题」

### U 校园快速路径（推荐）

对于 U 校园页面，扩展自动从服务端 API 获取正解，无需 AI 调用：

1. 页面加载后，扩展自动检测 U 校园页面
2. 从 URL 提取课程和任务 ID
3. 调用 `/course/api/v3/answer/...` 接口获取加密答案
4. AES-128-ECB 解密后填入页面

## 配置说明

### AI 模型设置

兼容所有 OpenAI 格式的 API：

| 字段 | 说明 |
|------|------|
| API Base URL | API 服务地址，如 `https://api.openai.com/v1` |
| API Key | 调用密钥 |
| 模型名 | 如 `gpt-4o`、`deepseek-chat` 等 |

### 站点模板

模板位于 `templates/` 目录，每个 JSON 文件定义一个站点：

- `unipus.json` — U 校园
- `wjx.json` — 问卷星
- `tencent.json` — 腾讯问卷
- `welearn.json` — WE Learn

## 支持的文件结构

```
extension/
├── manifest.json       # 扩展配置 (MV3)
├── background.js       # Service Worker — AI 调用、代理请求
├── content.js          # 内容脚本 — 题目扫描、答案填入
├── content.css         # 注入样式
├── popup.html          # 控制面板
├── popup.js            # 面板逻辑
├── modules/
│   ├── bank.js         # 题库存储
│   ├── scanner-enhanced.js  # 增强扫描器
│   ├── site-matcher.js # URL 站点匹配
│   ├── template-manager.js  # 模板管理
│   ├── unipus-api.js   # U校园 AES/JWT 客户端
│   └── welearn-api.js  # WE Learn 数据 HTML 解析
├── templates/
│   ├── unipus.json
│   ├── wjx.json
│   ├── tencent.json
│   └── welearn.json
└── icons/
```

## 常见问题

### 扫描不到题目？
可能是站 DOM 结构与模板不匹配。尝试刷新页面，或等待自动 AI 分析兜底。

### 答案不正确？
U 校园 API 直取的答案准确率 100%；AI 模式下的答案依赖模型质量。

### 扩展图标不显示？
确认扩展已启用。部分页面（如 `chrome://` 开头的页面）扩展无法运行。

## 许可

本项目基于 [AI-ANSWER-ASSISTANT](https://github.com/rehuan/AI-ANSWER-ASSISTANT) 和 [AutoUnipus](https://github.com/CXRunfree/AutoUnipus) 改造。

[GPL-3.0 License](./LICENSE)

> 仅供学习研究，不得用于非法用途。
