# 第三方许可与代码来源声明

本文件记录 **抖音下载（网页版）2.1.0** 中仍需保留的历史来源、第三方资源许可，以及 2.1.0 的来源审计（Provenance Audit）。

项目从 2.1.0 起整体以 **GNU GPL v3 (`GPL-3.0-only`)** 分发。该变更不撤回任何已经依据旧版本 MIT 许可证合法取得的权利；历史来源代码和第三方资源仍分别保留其原许可证要求与版权声明。

## 一、历史实现：len / douyin-dl-user-js — MIT

当前项目的历史代码基线包含来自 `douyin-dl-user-js` 的 MIT 授权实现。2.1.0 虽对任务调度、状态机、恢复和 UI 等区域进行了大规模重构，但仍保留部分历史实现，因此继续保留上游版权与 MIT 许可声明。

- Copyright (c) 2024 len
- 上游项目：`https://github.com/zhzLuke96/douyin-dl-user-js`
- 许可证：MIT

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## 二、ItsHover SparklesIcon / CopyIcon — Apache-2.0

2.1.0 的 Sparkles / Copy 微交互包含基于 ItsHover 资源适配的 SVG/CSS 动效。项目保留其来源和许可证信息。

- Copyright 2026 ItsHover
- SparklesIcon：`https://github.com/itshover/itshover/blob/master/icons/sparkles-icon.tsx`
- CopyIcon：`https://github.com/itshover/itshover/blob/master/icons/copy-icon.tsx`
- 许可证：Apache-2.0
- 项目内修改：作用域化原生 SVG/CSS 动画、颜色、键盘交互和 reduced-motion 处理。

Apache License 2.0 正文：`https://www.apache.org/licenses/LICENSE-2.0`

## 三、Lucide icon paths — ISC

界面图标路径包含 Lucide Icons 资源，按 ISC License 保留声明。

- 来源：`https://github.com/lucide-icons/lucide`
- 许可证：ISC
- 当前脚本内保留了 Lucide / ISC 必要 notice。

ISC License

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

## 四、Feather-derived icon paths — MIT

部分图标路径源自 Feather Icons 系列设计，继续按 MIT 保留其许可声明。

- Copyright (c) 2013-present Cole Bemis
- 来源：`https://github.com/feathericons/feather`
- 许可证：MIT

MIT 条款与本文件第一节所列 MIT 授权条件相同；分发时仍需保留对应版权与许可声明。

---

# 2.1.0 来源审计 / Provenance Audit

本审计用于说明 2.1.0 的来源边界，不以“修改了多少百分比”作为删除历史版权声明的依据。

## A. 历史实现

以下区域仍包含或延续 2.0.x / 1.0.x 历史实现和上游 MIT 代码结构，因此继续视为衍生实现并保留历史 MIT notice：

- 抖音页面媒体解析与历史兼容路径；
- 浏览器 / aria2 / AB Download Manager 下载适配中的既有实现；
- 图集打包、弹幕转换、媒体详情等既有能力中未被完全替换的部分；
- 页面兼容选择器及旧版本迁移逻辑中继续使用的部分。

## B. 2.1.0 重写 / 新增实现

2.1.0 新增或重构的项目层包括：

- `UnifiedTaskStore` 单一任务状态源；
- `TaskScheduler` 统一队列与单执行器；
- `TaskGroupPolicy` 批量任务组派生状态；
- `MediaRecoveryCoordinator`、Work / Resource Identity 与有界自愈策略；
- `ResumePolicy` 的严格 Range / 206 / Content-Range 安全校验；
- 页面中断持久化与重新加载恢复模型；
- 作者页 `ProfileIncrementalIndex` 增量数据模型和低资源监听；
- Task Center 状态操作模型与 Ambient Task Status；
- 2.1.0 青瓷白 / shadcn 风格的信息层级、字体、间距与条件显示策略。

这些 2.1.0 新增/重构部分由 **小辉同學** 作为本项目 2.1.0 产品设计与实现的一部分，以 `GPL-3.0-only` 随项目分发。

## C. 第三方资源

第三方资源与历史来源不因项目整体切换到 GPLv3 而失去其原有版权或 attribution：

- len 历史代码：MIT；
- ItsHover SparklesIcon / CopyIcon：Apache-2.0；
- Lucide：ISC；
- Feather-derived paths：MIT。

Userscript 单文件分发版本仍内嵌必要 notice；本文件作为仓库中的集中说明，不用于替代脚本中分发时必须保留的声明。
