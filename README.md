# 🚀 抖音下载 (Douyin-DL)

<a href="https://github.com/xiaohuitongxue88-ctrl/douyin-downloader" target="_blank">👉 GitHub 开源主页</a> | <a href="https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/issues" target="_blank">🐛 提交问题反馈</a>

一款功能强大、界面精致的抖音（Douyin）网页版增强下载工具。支持无水印视频下载、图集打包、弹幕导出、作者主页批量下载，并原生支持与 Aria2 及 AB Download Manager 联动。

[![最新版本](https://img.shields.io/badge/版本-v1.0.7-orange?style=flat&logo=tampermonkey)](#)
[![开源协议](https://img.shields.io/badge/许可证-MIT-green)](#)
[![支持下载器](https://img.shields.io/badge/外部下载器-Aria2%20%7C%20ABDM-blue)](#)
[![UI框架](https://img.shields.io/badge/UI-Preact%20%7C%20CSS--in--JS-black)](#)

> 💡 **V1.0.7 更新亮点**：修复批量管理器选择/检查器同步问题，恢复一级下载记录入口；新增状态悬浮信息与作者作品一次性完整扫描/全选功能。

---

### ✨ 核心功能特性

* 🎬 **全场景媒体下载**：支持无水印视频、高清图集、封面大图及背景原声提取。
* 📦 **强大的批量下载器**：
  * 在作者主页一键扫描全部作品，支持快速全选。
  * 独立的“下载任务中心”悬浮胶囊，实时显示下载进度与失败重试管理。
* ⚡ **多协议下载器联动**：
  * 内置浏览器流式下载（自动降级兼容）。
  * 原生支持推送到 **Aria2 RPC** 与 **AB Download Manager**，轻松应对大批量下载。
* 💬 **弹幕与数据导出**：
  * 一键将当前视频弹幕导出为标准的 **.ass 字幕文件**（含颜色与时间轴）。
  * 内置“媒体资源/作品信息/JSON”检查器，方便技术同好获取原始数据。
* 🎨 **原生级无感交互 (GPU Safe)**：
  * 采用 Graphite Cobalt 设计系统，无毛玻璃、无高占用动画，适合长时间挂机运行。
  * 快捷键支持：按下 `M` 键即可秒下当前媒体！

---

**📸 界面预览与功能演示**

**1. 播放页悬浮插件与快速下载**
> 在视频播放页右下角自动注入“插件”入口，点击即可快速调出下载与配置菜单。
![播放页插件入口](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/images/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260805114600_342_86.png?raw=true)

---

**2. 媒体资源与清晰度解析**
> 支持独立弹窗查看高清封面、不同分辨率视频源、音轨提取及原始 JSON 数据。
![媒体资源解析](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/images/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260805114623_343_86.png?raw=true)

---

**3. 作者主页批量扫描与选择**
> 进入作者主页后自动唤起批量控制面板，支持一键全选、扫描全部作品及勾选下载。
![需求反馈与交流群](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/images/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260805114758_346_86.png?raw=true)

![作者主页批量扫描](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/images/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260805114735_345_86.png?raw=true)

---

**4. 批量下载任务管理中心**
> 独立的任务管理弹窗，实时查看下载进度、下载速度，支持暂停、重试与失败排查。
![批量下载任务中心](https://github.com/xiaohuitongxue88-ctrl/douyin-downloader/blob/main/images/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260805114758_346_86.png?raw=true)

---

### 📖 安装与使用指南

1. **安装环境**：请确保您的浏览器已安装 Tampermonkey (油猴) 扩展程序。
2. **获取脚本**：点击上方的安装按钮完成脚本添加。
3. **如何使用**：
   * **单文件下载**：打开任意抖音视频播放页，点击右下角功能栏的 **[插件]** 按钮，或直接按下键盘 **`M` 键**。
   * **批量下载**：进入任意作者主页，右下角会自动出现“插件”控制面板，点击展开即可扫描并管理批量下载任务。
   * **高级设置**：在弹出的控制面板中点击“设置”，可配置自定义文件名规则（如 `${nickname}_${short_id}`）、清晰度策略及外部下载器参数。

---

### 💬 交流与反馈

在使用过程中遇到任何 Bug、有好的功能建议，或者单纯想进行技术交流，欢迎加入我们的 QQ 群：

<a target="_blank" href="https://qm.qq.com/cgi-bin/qm/qr?k=-SMNW4O5qbcPHHzFZLARGrN-7IX_5OCS&jump_from=webapi&authKey=w6zQgg9u7I7LyFPJda67hr6MWML+9x0xAV4VbZRE5F9ypeiPCkfOMa05yLhgQ/1N"><img border="0" src="https://pub.idqqimg.com/wpa/images/group.png" alt="人生自古誰无死" title="人生自古誰无死"></a>

*(若加群链接失效，您也可以在 GitHub 的 Issues 中留言反馈)*

---

### 🙏 特别鸣谢 (Acknowledgments)

本项目的发展离不开开源社区的分享精神。在此，向原作者 **zhzLuke96** 表达最诚挚的感谢！

本脚本是在其优秀的开源项目基础上，进行了深度的 UI 重构、逻辑优化与二次开发的成果。正是原作者前期的探索启发与无私奉献的代码，才有了当前版本更为丰富和稳定的体验。饮水思源，向开源前辈致敬！

* 🌟 原项目指路：<a href="https://github.com/zhzLuke96/douyin-dl-user-js" target="_blank">zhzLuke96/douyin-dl-user-js</a>

---

### ⚖️ 免责声明 (Disclaimer)

> **本项目秉持开源、共享、免费的原则，仅供学术探讨与合法的个人数据备份使用。**
>
> 1. **合法合规**：请严格遵守所在地法律法规及相关平台的用户服务协议。严禁将本脚本用于商业侵权、大规模数据爬取牟利或其他非法用途。
> 2. **风险自担**：因使用者不当使用本工具而导致的账号异常、版权纠纷、网络安全风险或其他附带后果，均由使用者自行承担，开发者概不负责。
> 3. **反商业化**：严禁任何人对本脚本进行倒卖、二次打包付费转售或恶意修改后冒充原作者进行收费传播。
> 4. **版权尊重**：下载之媒体资源（含视频、图集、音乐等）版权均归原作者及平台所有，切勿用于未授权的商业剪辑或二次分发。
