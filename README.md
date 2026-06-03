# Unipus Auto

U 校园（Unipus）自动答题工具，主推浏览器扩展形式，另有 Python 独立脚本和 Java 桌面客户端。

---

## 快速开始（浏览器扩展）

适合大多数用户，无需命令行操作。

### 下载

```bash
git clone https://github.com/yuanarcsin/unipus_auto.git
```

或者点击页面右上角绿色「Code」→「Download ZIP」，解压到本地文件夹。

### 安装扩展

**Edge 浏览器：**

1. 地址栏输入 `edge://extensions/` 并回车
2. 开启左下角的「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择文件夹中的 `AutoUnipus/extension/` 目录（注意：不是根目录，是里面的 extension 文件夹）
5. 安装成功后工具栏会出现扩展图标

**Chrome 浏览器：**

1. 地址栏输入 `chrome://extensions/` 并回车
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `AutoUnipus/extension/` 目录

### 使用

1. 打开 U 校园练习页面
2. 点击工具栏的扩展图标打开面板
3. 在设置中填写你的 API Key 并保存
4. 点击「扫描题目」— 扩展会自动识别页面上的题目
5. 点击「开始答题」— 自动完成所有题目

---

## 项目说明

本项目由三个子项目组成，它们**互不依赖**，可独立使用：

### 1. 浏览器扩展（推荐）

**位置：** [AutoUnipus/extension/](AutoUnipus/extension/)

Chrome/Edge 插件，支持 U 校园、问卷星、腾讯问卷、WE Learn 等平台。自动识别题目、获取答案并填入。

**支持的平台：**

| 平台 | 策略 | 准确率 |
|------|------|--------|
| U 校园（Unipus） | 服务端 API 直取 | ~100% |
| WE Learn | 数据 HTML 解析 | ~100% |
| 问卷星（WJX） | 模板扫描 + AI | 高 |
| 腾讯问卷 | 模板扫描 + AI | 高 |
| 其他站点 | AI 分析 | 依赖模型 |

> 对于 U 校园，扩展直接从官方接口获取加密答案并解密，无需调用 AI 模型，准确率 100%。

### 2. Python 独立脚本

**位置：** [AutoUnipus/](AutoUnipus/)

适用于有 Python 环境的用户，通过 Playwright 操作浏览器。

### 3. Java 桌面应用

**位置：** [UnipusHelperPro/](UnipusHelperPro/)

一个独立的 Java 桌面客户端项目，拥有完整 GUI 界面，支持任务管理、答案获取与提交。

> ⚠️ 这是**他人开发的开源项目**，非本项目原创。原项目来自 [Duster-Cule/UnipusHelperPro](https://github.com/Duster-Cule/UnipusHelperPro)，此处仅作为子模块收录，方便统一使用。如需了解详情或提交 issue，请访问原项目仓库。

---

## 许可

本项目集合了多个开源项目的代码，许可证情况如下：

- **浏览器扩展部分** — 基于 [AI-ANSWER-ASSISTANT](https://github.com/rehuan/AI-ANSWER-ASSISTANT)（GPL-3.0）和 [AutoUnipus](https://github.com/CXRunfree/AutoUnipus)（BSD 3-Clause）改造
- **Java 桌面应用部分** — 来自 [UnipusHelperPro](https://github.com/Duster-Cule/UnipusHelperPro)，遵循其原始许可证
- **整体项目** — 因包含 GPL-3.0 代码，整体遵循 GPL-3.0 协议

详见根目录的 [LICENSE](LICENSE) 和 [LICENSE.BSD](LICENSE.BSD)。

> 本项目仅用于学习研究，请遵守相关平台的使用条款，不得用于非法用途。
