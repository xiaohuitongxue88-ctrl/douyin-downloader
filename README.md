<div align="center">

# 🎵 Douyin Downloader

<p><strong>抖音网页版增强下载工具</strong></p>

无水印视频 · 高清图集 · 背景音乐 · 弹幕字幕 · 作者作品批量下载

[![点赞](https://img.shields.io/github/stars/xiaohuitongxue88-ctrl/douyin-downloader?style=flat-square&logo=github&label=%E7%82%B9%E8%B5%9E&color=f5c518)](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/stargazers)
[![最近提交](https://img.shields.io/github/last-commit/xiaohuitongxue88-ctrl/douyin-downloader?style=flat-square&label=%E6%9C%80%E8%BF%91%E6%8F%90%E4%BA%A4&color=7c3aed)](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/commits/main)
[![最新版本](https://img.shields.io/github/v/release/xiaohuitongxue88-ctrl/douyin-downloader?style=flat-square&label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC&color=ea580c&include_prereleases)](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/releases)
[![许可证](https://img.shields.io/github/license/xiaohuitongxue88-ctrl/douyin-downloader?style=flat-square&label=%E8%AE%B8%E5%8F%AF%E8%AF%81&color=16a34a)](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/LICENSE)
[![下载量](https://img.shields.io/github/downloads/xiaohuitongxue88-ctrl/douyin-downloader/total?style=flat-square&label=%E4%B8%8B%E8%BD%BD%E9%87%8F&color=0ea5e9)](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/releases)

[**立即安装脚本**](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/raw/refs/heads/main/douyin-dl.user.js) · [功能介绍](#-功能概览) · [界面预览](#-界面预览) · [安装指南](#-安装与使用) · [问题反馈](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/issues)

</div>

> [!IMPORTANT]
> 当前脚本版本为 **v1.0.7**。遇到问题时，请先通过上方“立即安装脚本”更新到最新版；若问题仍然存在，请先在 [Issues](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/issues) 中搜索已有记录，再提交新的问题。

## ✨ 项目简介

Douyin Downloader 是一款面向抖音网页版的 Tampermonkey 增强脚本。它把单个作品下载、作者主页批量扫描、下载任务管理和媒体信息查看整合到统一界面中，并兼顾长时间运行时的流畅度与低干扰体验。

## 🚀 功能概览

| 使用场景 | 主要能力 |
| --- | --- |
| 🎬 单个作品 | 下载无水印视频、高清图集、封面大图和背景音乐 |
| 📦 作者主页 | 一次性扫描作者作品，支持批量选择与提交下载任务 |
| 💬 弹幕导出 | 将当前视频弹幕导出为带颜色和时间轴的 `.ass` 字幕文件 |
| ⚡ 下载方式 | 支持浏览器直接下载，并可联动 Aria2 RPC 与 AB Download Manager |
| 🧭 任务管理 | 查看下载进度、速度和任务状态，支持失败任务重试与排查 |
| 🔍 信息检查 | 查看媒体资源、作品信息及原始 JSON 数据 |

### 设计与性能

- 采用 **Graphite Cobalt** 视觉体系，界面简洁、信息层级清晰。
- 不使用高开销毛玻璃和持续动画，降低长期运行时的资源占用。
- 功能面板与原网页保持相对独立，尽量减少对抖音原有操作的干扰。
- 支持快捷键 `M`，可快速下载当前媒体。

## 🆕 v1.0.7 更新亮点

- 修复批量管理器选择状态与检查器不同步的问题。
- 修复管理器与悬浮胶囊互斥、任务封面和设置窗口裁切问题。
- 恢复一级下载记录入口。
- 新增任务状态悬浮信息。
- 新增作者作品一次性完整扫描与快速全选。

## 📸 界面预览

### 1. 播放页悬浮入口与快速下载

进入视频播放页后，页面右下角会显示“插件”入口，可快速打开下载及配置菜单。

![播放页插件入口](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/images/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260805114600_342_86.png?raw=true)

### 2. 媒体资源与清晰度解析

可在独立窗口中查看高清封面、不同清晰度的视频源、音轨和原始 JSON 数据。

![媒体资源解析](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/images/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260805114623_343_86.png?raw=true)

### 3. 作者主页批量扫描与选择

1. 进入作者主页，页面右下角会自动显示批量控制面板入口。
2. 展开面板并扫描作品，按需勾选后提交批量下载任务。

![批量扫描面板](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/images/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260805114735_345_86.png?raw=true)

### 4. 批量下载任务中心

通过独立任务窗口查看下载进度、速度和状态，并对失败任务进行重试或排查。

![批量下载任务中心](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/images/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260805114758_346_86.png?raw=true)

## 📖 安装与使用

### 第一步：安装 Tampermonkey

请先在 Chrome、Edge 或其他 Chromium 内核浏览器中安装 **Tampermonkey（油猴）** 扩展。

### 第二步：安装脚本

点击 [**立即安装 Douyin Downloader**](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/raw/refs/heads/main/douyin-dl.user.js)，Tampermonkey 打开安装页面后，确认脚本版本并点击“安装”。

### 第三步：开始使用

- **下载当前作品**：打开任意抖音视频播放页，点击右下角“插件”，或按下快捷键 `M`。
- **批量下载作品**：进入作者主页，展开右下角控制面板，扫描、选择并提交任务。
- **调整高级设置**：在控制面板中打开“设置”，配置清晰度策略、文件名规则和外部下载器。

文件名规则示例：`${nickname}_${short_id}`

### 可选：连接外部下载器

如需处理较多任务，可在设置中配置 **Aria2 RPC** 或 **AB Download Manager**。不配置外部下载器时，脚本仍可使用浏览器下载方式。

## 🛠️ 问题反馈

提交问题前，请依次完成以下检查：

1. 通过 [最新脚本地址](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/raw/refs/heads/main/douyin-dl.user.js) 重新安装或更新脚本。
2. 在 [Issues](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/issues) 中搜索相同现象。
3. 确认问题能够重复出现，并记录具体操作步骤。

新建 Issue 时，建议同时提供：

- 浏览器与 Tampermonkey 版本。
- 出现问题的页面类型，例如播放页或作者主页。
- 从打开页面到出现问题的完整操作步骤。
- 错误截图；如方便，也可附上浏览器控制台中的相关报错。

你也可以加入 QQ 群交流：

<a href="https://qm.qq.com/cgi-bin/qm/qr?k=-SMNW4O5qbcPHHzFZLARGrN-7IX_5OCS&jump_from=webapi&authKey=w6zQgg9u7I7LyFPJda67hr6MWML+9x0xAV4VbZRE5F9ypeiPCkfOMa05yLhgQ/1N"><img src="https://pub.idqqimg.com/wpa/images/group.png" alt="加入 QQ 群：人生自古誰无死"></a>

> 若加群链接失效，请直接在 [GitHub Issues](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/issues) 中留言。

## 🙏 特别鸣谢

本项目基于 [zhzLuke96/douyin-dl-user-js](https://github.com/zhzLuke96/douyin-dl-user-js) 进行 UI 重构、逻辑优化与功能扩展。感谢原作者的探索与开源分享。

## 📄 开源许可证

本项目采用 [MIT License](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/LICENSE) 开源。

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
