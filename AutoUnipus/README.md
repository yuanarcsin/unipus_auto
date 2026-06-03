# Unipus Auto — U 校园智能答题助手

基于大模型 API 的 U 校园（Unipus）自动答题工具，支持**浏览器扩展**和**独立脚本**两种方式。

## 功能

- 识别题型：选词填空、单选、多选、填空、翻译、句子改写
- 调用 DeepSeek / OpenAI 兼容 API 获取答案
- 答案填入页面（辅助模式，不自动提交）
- 题库缓存：做过自动存，再遇到直接复用
- Unipus 站点模板优先匹配，识别更快更准

## 快速开始

### 浏览器扩展（推荐）

1. Edge 打开 `edge://extensions`（Chrome: `chrome://extensions`）
2. 开启"开发人员模式"
3. "加载解压缩的扩展" → 选择 `extension/` 文件夹
4. 点扩展图标 → 设置 → 填入 API Key → 保存
5. 打开 U 校园练习页 → 点扩展 → 扫描 → 开始答题

### 独立脚本

```bash
set DEEPSEEK_API_KEY=sk-xxxx
python test_llm_solve.py
```

## 文件结构

```
├── AutoUnipus.py           # 原 Playwright 版主入口
├── test_llm_solve.py       # LLM 独立答题脚本
├── test_run.py             # route 劫持穷举测试
├── test_auto_bruteforce.py # 自动穷举原型
├── test_solve_done.py      # 已验证的穷举原型
├── config/selectors.json   # Unipus DOM 选择器
├── utils/                  # 工具模块
├── res/                    # 资源
├── account.json            # 账户配置
└── extension/              # 浏览器扩展
    ├── manifest.json       # MV3 配置
    ├── background.js       # AI API 调用
    ├── content.js          # 题目扫描 + 答案填入
    ├── popup.html/js       # 控制面板
    ├── modules/
    │   ├── bank.js         # 题库存储
    │   └── ...
    └── templates/
        └── unipus.json     # Unipus 站点模板
```

## 已知问题

- 选词填空填入操作偶有偏差，需人工核对
- 单选/多选题 DOM 选择器未充分测试
- 翻译/改写题 LLM 答案质量依赖 prompt 调优
- 题库管理界面未完成
- 提交后未自动检测正误反馈

## 来源与协议

本项目基于以下开源项目：

| 项目 | 作者 | 协议 |
|---|---|---|
| [AutoUnipus](https://github.com/CXRunfree/AutoUnipus) | CXRunfree | BSD 3-Clause |
| [AI-ANSWER-ASSISTANT](https://github.com/rehuan/AI-ANSWER-ASSISTANT) | rehuan | GPL-3.0 |

扩展部分（`extension/`）基于 AI-ANSWER-ASSISTANT 改造。因包含 GPL-3.0 代码，**整体项目遵循 GPL-3.0**。[LICENSE](LICENSE) | [LICENSE.BSD](LICENSE.BSD)

## 声明

本项目仅用于学习研究，不得用于非法用途。
