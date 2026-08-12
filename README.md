<div align="center">

# 🎵 Douyin Downloader

### 抖音网页版增强下载工具

无水印视频 · 高清图集 · 原声音频 · 弹幕字幕 · 作者作品批量下载

[![点赞](https://img.shields.io/github/stars/xiaohuitongxue88-ctrl/douyin-downloader?style=flat-square&logo=github&label=%E7%82%B9%E8%B5%9E&color=f5c518)](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/stargazers)
[![最近提交](https://img.shields.io/github/last-commit/xiaohuitongxue88-ctrl/douyin-downloader?style=flat-square&label=%E6%9C%80%E8%BF%91%E6%8F%90%E4%BA%A4&color=7c3aed)](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/commits/main)
[![最新版本](https://img.shields.io/github/v/release/xiaohuitongxue88-ctrl/douyin-downloader?style=flat-square&label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC&color=ea580c&include_prereleases)](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/releases/latest)
[![许可证](https://img.shields.io/github/license/xiaohuitongxue88-ctrl/douyin-downloader?style=flat-square&label=%E8%AE%B8%E5%8F%AF%E8%AF%81&color=16a34a)](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/LICENSE)

[**立即安装脚本**](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/raw/refs/heads/main/douyin-dl.user.js) · [功能概览](#-功能概览) · [界面预览](#-界面预览) · [安装指南](#-安装与使用) · [问题反馈](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/issues)

</div>

> [!IMPORTANT]
> 当前稳定版本为 **v1.0.10**。遇到问题时，请先通过上方“立即安装脚本”更新到最新版；若问题仍然存在，请在 [Issues](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/issues) 中搜索已有记录后再提交问题。

## ✨ 项目简介

Douyin Downloader 是一款面向抖音网页版的 Tampermonkey 增强脚本。它将当前作品下载、作者主页批量扫描、下载任务管理和媒体信息查看整合到统一界面中，并兼顾操作响应、长期运行稳定性与低干扰体验。

## 🚀 功能概览

| 使用场景 | 主要能力 |
| --- | --- |
| 🎬 视频作品 | 下载无水印视频、高清封面，并按清晰度选择媒体资源 |
| 🖼️ 图集作品 | 提取并批量下载高清原图 |
| 🎵 音频提取 | 下载作品原声音频或背景音乐，并按实际媒体格式保存 |
| 📦 作者主页 | 一次性扫描作者作品，支持快速全选、批量选择与提交任务 |
| 💬 弹幕导出 | 将当前视频弹幕导出为带时间轴与样式的 `.ass` 字幕文件 |
| 🧭 任务管理 | 查看下载进度、速度和任务状态，支持暂停、恢复与失败排查 |
| 🔍 信息检查 | 查看媒体资源、作品信息、作者信息及原始 JSON 数据 |
| ⚡ 下载方式 | 支持浏览器直接下载，并可选联动 Aria2 RPC 与 AB Download Manager |

### 设计与性能

- 采用 **Graphite Cobalt** 视觉体系，界面简洁，信息层级清晰。
- 采用按需加载与低资源 DOM 观察，避免无意义的常驻轮询。
- 不使用高开销毛玻璃和持续动画，降低长时间运行时的资源占用。
- 功能面板与原网页保持相对独立，尽量减少对抖音原有操作的干扰。
- 支持快捷键 `M`，快速下载当前媒体。

## 🆕 v1.0.10 更新亮点

- 修复作者信息页粉丝数量可能显示旧值、占位值或不准确数据的问题。
- 强化作者 SecUID 归属校验，避免其他作者或无归属统计覆盖当前作者信息。
- 优化作者主页统计补取与 10 分钟短时缓存，减少重复请求。
- 增加作者主页已渲染粉丝数、获赞数的兼容兜底，提升网页结构调整后的可用性。
- 全面复核单视频、图集、原声音频、弹幕 ASS、作者主页扫描、批量任务、暂停恢复与媒体详情等关键代码路径。
- 保持低资源运行策略，不新增常驻轮询或持续动画。

## 📸 界面预览

### 1. 播放页悬浮入口与快速下载

进入视频播放页后，页面右下角会显示“插件”入口，可快速打开下载及配置菜单。

![播放页插件入口](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/images/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260805114600_342_86.png?raw=true)

### 2. 媒体资源与清晰度解析

可在独立窗口中查看高清封面、不同清晰度的视频源、音轨和原始 JSON 数据。

![媒体资源解析](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/images/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260805114623_343_86.png?raw=true)

### 3. 作者主页批量扫描与选择

进入作者主页后，展开右下角批量控制面板，扫描作者作品，按需勾选并提交批量下载任务。

![批量扫描面板](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/images/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260805114735_345_86.png?raw=true)

### 4. 批量下载任务中心

通过独立任务窗口查看下载进度、速度和状态，并对失败任务进行重试或排查。

![批量下载任务中心](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/images/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260805114758_346_86.png?raw=true)

## 📖 安装与使用

### 第一步：安装 Tampermonkey

请先在 Chrome、Edge 或其他 Chromium 内核浏览器中安装 **Tampermonkey（油猴）** 扩展。

### 第二步：安装脚本

点击 [**立即安装 Douyin Downloader**](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/raw/refs/heads/main/douyin-dl.user.js)，Tampermonkey 打开安装页面后，确认版本为 `1.0.10`，再点击“安装”。

### 第三步：开始使用

- **下载当前作品**：打开任意抖音视频播放页，点击右下角“插件”，或按下快捷键 `M`。
- **提取原声音频**：在播放器的“插件”菜单或媒体详情中选择“提取原声”。
- **批量下载作品**：进入作者主页，展开右下角控制面板，扫描、选择并提交任务。
- **调整高级设置**：在控制面板中打开“设置”，配置清晰度策略、文件名规则和外部下载器。

文件名规则示例：`${nickname}_${short_id}`

### 可选：连接外部下载器

如需处理较多任务，可在设置中配置 **Aria2 RPC** 或 **AB Download Manager**。不配置外部下载器时，脚本仍可使用浏览器直接下载。

## 🌐 兼容环境

- Chrome、Edge 及其他 Chromium 内核浏览器。
- Tampermonkey 扩展。
- 抖音网页版：`https://www.douyin.com/`

> 抖音网页结构和接口可能随时调整。若功能突然失效，请先更新脚本并查看 Issues 中是否已有相关说明。

## 🛠️ 问题反馈

提交问题前，请依次完成以下检查：

1. 通过 [最新脚本地址](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/raw/refs/heads/main/douyin-dl.user.js) 重新安装或更新脚本。
2. 按 `Ctrl + F5` 强制刷新抖音网页后重新测试。
3. 在 [Issues](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/issues) 中搜索相同现象。
4. 确认问题能够重复出现，并记录具体操作步骤。

新建 Issue 时，建议同时提供：

- 浏览器与 Tampermonkey 版本；
- 出现问题的页面类型，例如播放页或作者主页；
- 从打开页面到出现问题的完整操作步骤；
- 错误截图；如方便，也可附上浏览器控制台中的相关报错。

你也可以加入 QQ 群交流：

<a href="https://qm.qq.com/cgi-bin/qm/qr?k=-SMNW4O5qbcPHHzFZLARGrN-7IX_5OCS&jump_from=webapi&authKey=w6zQgg9u7I7LyFPJda67hr6MWML+9x0xAV4VbZRE5F9ypeiPCkfOMa05yLhgQ/1N"><img src="https://pub.idqqimg.com/wpa/images/group.png" alt="加入 QQ 群：人生自古誰无死"></a>

> 若加群链接失效，请直接在 [GitHub Issues](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/issues) 中留言。

## 🙏 开源致谢

本项目基于 [zhzLuke96/douyin-dl-user-js](https://github.com/zhzLuke96/douyin-dl-user-js) 进行界面重构、逻辑优化与功能扩展。感谢原项目作者的探索与开源分享。

## 📄 开源许可证

本项目采用 [MIT License](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/LICENSE) 开源。使用、修改或分发时，请保留原有版权声明和许可证内容。

## ⚖️ 免责声明

> 本项目坚持开源、共享和免费，仅供技术研究与合法的个人数据备份使用。

1. 请遵守所在地法律法规、平台服务协议及版权规定。
2. 禁止将本项目用于商业侵权、大规模违规采集、倒卖或其他非法用途。
3. 因使用者不当操作造成的账号异常、版权纠纷、网络安全风险或其他后果，由使用者自行承担。
4. 下载内容的版权归原作者或相应权利人所有，请勿进行未经授权的商业使用或二次分发。

---

<div align="center">

如果这个项目对你有帮助，欢迎点亮一个 ⭐ Star。

[返回顶部](#-douyin-downloader)

</div>
