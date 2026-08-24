<div align="center">

# Douyin Downloader

### 抖音网页版增强下载工具

无水印视频 · 高清图集 · 原声音频 · 弹幕字幕 · 作者作品批量下载

[![点赞](https://img.shields.io/github/stars/xiaohuitongxue88-ctrl/douyin-downloader?style=flat-square&logo=github&label=%E7%82%B9%E8%B5%9E&color=f5c518)](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/stargazers)
[![最近提交](https://img.shields.io/github/last-commit/xiaohuitongxue88-ctrl/douyin-downloader?style=flat-square&label=%E6%9C%80%E8%BF%91%E6%8F%90%E4%BA%A4&color=7c3aed)](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/commits/main)
[![问题](https://img.shields.io/github/issues/xiaohuitongxue88-ctrl/douyin-downloader?style=flat-square&label=%E9%97%AE%E9%A2%98&color=0ea5e9)](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/issues)
[![许可证](https://img.shields.io/github/license/xiaohuitongxue88-ctrl/douyin-downloader?style=flat-square&label=%E8%AE%B8%E5%8F%AF%E8%AF%81&color=16a34a)](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/LICENSE)

[**立即安装脚本**](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/raw/refs/heads/main/douyin-dl.user.js) · [项目简介](#项目简介) · [功能架构](#功能架构) · [功能介绍与使用流程](#功能介绍与使用流程) · [安装与使用](#安装与使用) · [问题反馈](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/issues)

</div>

> [!IMPORTANT]
> 当前稳定版本：**v1.0.11**  
> 如果已安装旧版本，重新打开上方“立即安装脚本”即可更新。

## 项目简介

Douyin Downloader 是一款面向抖音网页版的增强下载工具。  
它把**当前作品下载、图集保存、原声音频提取、弹幕字幕、作者主页批量下载、任务管理**集中到一个低干扰界面中，尽量减少重复操作。

v1.0.11 重点优化了以下体验：

- 工具入口更轻量，操作更集中；
- 支持悬停提示、点击外部收起、`Esc` 关闭、面板固定；
- 当前作品资源变化后可自动重新确认，减少手动重试；
- 修复取消原声音频下载后状态残留；
- 默认文件名优先使用页面作品标题，更贴近实际页面显示。

---

## 功能架构

```text
Douyin Downloader v1.0.11
│
├─ 当前作品处理
│  ├─ 下载当前视频
│  ├─ 下载当前图集
│  ├─ 提取原声音频
│  ├─ 导出弹幕字幕
│  └─ 查看当前媒体信息
│
├─ 作者主页批量处理
│  ├─ 扫描作者作品
│  ├─ 勾选需要的作品
│  ├─ 全选 / 取消全选
│  └─ 批量提交下载任务
│
├─ 下载任务中心
│  ├─ 查看当前进度
│  ├─ 查看速度与剩余时间
│  ├─ 暂停任务
│  ├─ 恢复任务
│  └─ 失败重试
│
├─ 下载方式
│  ├─ 浏览器直接下载
│  ├─ Aria2 RPC
│  └─ AB Download Manager
│
├─ 文件与保存规则
│  ├─ 默认使用页面作品标题命名
│  ├─ 支持按需调整文件名规则
│  ├─ 自动处理 Windows 不允许的文件名符号
│  └─ 保留用户已有自定义设置
│
└─ 状态反馈与辅助能力
   ├─ 当前资源自动确认
   ├─ 资源失效后自动恢复
   ├─ 成功 / 等待 / 取消 / 异常提示
   ├─ 面板固定
   ├─ 点击外部收起
   └─ Esc 关闭当前面板
```

---

## 功能介绍与使用流程

### 1）下载当前视频

```text
打开抖音视频页面
↓
打开工具入口
↓
点击“下载当前作品”
↓
工具识别当前视频资源
↓
加入下载任务
↓
在任务中心查看进度
↓
下载完成并保存到本地
```

适用场景：普通视频作品、合集中的当前视频、需要保存无水印视频的页面。

---

### 2）下载当前图集

```text
打开图集作品页面
↓
打开工具入口
↓
点击“下载当前作品”
↓
工具识别图集中的图片资源
↓
按顺序整理图片
↓
开始下载并保存到本地
```

适用场景：图集类作品、需要按页面顺序保存多张图片。

---

### 3）提取原声音频

```text
打开目标作品页面
↓
打开工具入口
↓
点击“提取原声”
↓
工具准备当前作品音频
↓
确认保存
↓
下载音频到本地
```

补充说明：如果中途取消下载，状态提示会自动结束，不会一直停留在“正在获取原声”。

---

### 4）导出弹幕字幕

```text
打开有弹幕的视频页面
↓
打开工具入口
↓
点击弹幕相关功能
↓
工具整理当前作品弹幕内容
↓
生成可保存的字幕文件
↓
保存到本地后可直接使用
```

适用场景：需要保存弹幕内容、配合本地播放器查看字幕效果。

---

### 5）作者主页批量下载

```text
进入目标作者主页
↓
打开右侧媒体工作台
↓
扫描当前作者作品
↓
勾选需要保存的作品
↓
提交批量下载任务
↓
在任务中心统一查看与管理
```

适用场景：一次性保存同一作者的多个作品，减少重复点击。

---

### 6）下载任务管理

```text
开始下载任务
↓
任务进入任务中心
↓
查看进度 / 速度 / 剩余时间
↓
按需暂停或恢复
↓
失败时重新尝试
↓
完成后统一保存到本地
```

适用场景：单个任务、多个任务、批量任务统一管理。

---

### 7）文件命名规则

```text
打开作品页面
↓
工具读取页面作品标题
↓
将页面标题作为默认文件名主体
↓
自动处理系统不允许的符号
↓
生成最终下载文件名
```

例如页面标题为：

> 第84集：大明王朝84：贺表来了！《治安疏》是如何成为天下第一疏的？

下载文件会优先保持该标题，只对 Windows 不允许直接作为文件名的符号做兼容处理。

---

### 8）快捷操作

```text
悬停工具入口
↓
查看功能提示
↓
点击打开操作面板
↓
需要连续操作时固定面板
↓
点击页面外部自动收起
↓
按 Esc 快速关闭
```

快捷键：

- `M`：快速处理当前媒体

---

## v1.0.11 更新内容

- 整体优化工具界面与交互；
- 增加悬停提示、点击外部收起、`Esc` 关闭、面板固定；
- 优化任务中心展开、固定与自动收起体验；
- 作者主页工作台改为更低干扰的入口形式；
- 当前作品资源变化或短时失效时，支持自动重新确认；
- 修复取消原声音频下载后提示残留的问题；
- 默认下载文件名优先使用页面作品标题；
- 继续保留视频、图集、音频、弹幕、批量下载和任务管理能力。

---

## 安装与使用

### 第一步：安装 Tampermonkey

请先在 Chrome、Edge 或其他 Chromium 内核浏览器中安装 **Tampermonkey（油猴）** 扩展。

### 第二步：安装脚本

点击 [**立即安装 Douyin Downloader**](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/raw/refs/heads/main/douyin-dl.user.js)。

Tampermonkey 打开安装页面后，请确认版本为 **1.0.11**，再点击“安装”或“更新”。

### 第三步：开始使用

```text
安装脚本
↓
打开抖音网页版
↓
进入视频页 / 图集页 / 作者主页
↓
打开工具入口
↓
选择需要的功能
↓
在任务中心查看结果
```

### 可选：连接外部下载器

如果需要处理大量任务，可在设置中配置：

- Aria2 RPC
- AB Download Manager

如果不配置外部下载器，浏览器直接下载也可以正常使用。

---

## 兼容环境

- Chrome、Edge 及其他 Chromium 内核浏览器；
- Tampermonkey 扩展；
- 抖音网页版：`https://www.douyin.com/`

> 抖音网页内容和页面结构可能随平台更新发生变化。如果功能突然失效，请先更新脚本并查看 Issues 中是否已有相关说明。

---

## 问题反馈

提交问题前，建议先按下面流程检查：

```text
确认已更新到最新版本
↓
强制刷新网页后重新测试
↓
搜索 Issues 中是否已有相同现象
↓
整理复现步骤与截图
↓
再提交问题反馈
```

建议反馈时补充：

- 浏览器与 Tampermonkey 版本；
- 出现问题的页面类型；
- 从打开页面到出现问题的完整操作步骤；
- 问题截图；
- 如方便，可补充控制台报错信息。

---

## 开源致谢

本项目基于 [zhzLuke96/douyin-dl-user-js](https://github.com/zhzLuke96/douyin-dl-user-js) 持续修改与扩展。感谢原项目作者的探索与开源分享。

## 开源许可证

本项目采用 [MIT License](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/LICENSE) 开源。使用、修改或分发时，请保留适用的版权声明和许可证内容。

## 免责声明

> 本项目坚持开源、共享和免费，仅供技术研究与合法的个人数据备份使用。

1. 请遵守所在地法律法规、平台服务协议及版权规定。
2. 禁止将本项目用于商业侵权、大规模违规采集、倒卖或其他非法用途。
3. 因使用者不当操作造成的账号异常、版权纠纷、网络安全风险或其他后果，由使用者自行承担。
4. 下载内容的版权归原作者或相应权利人所有，请勿进行未经授权的商业使用或二次分发。

---

<div align="center">

如果这个项目对你有帮助，欢迎点亮一个 Star。  

[返回顶部](#douyin-downloader)

</div>
