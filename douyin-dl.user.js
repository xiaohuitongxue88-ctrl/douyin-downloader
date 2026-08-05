// ==UserScript==
// @name          抖音网页版增强下载工具
// @namespace     https://github.com/xiaohuitongxue88-ctrl/douyin-downloader
// @version       1.0.9
// @description   基于开源项目 douyin-dl-user-js 的稳定增强维护版；支持无水印视频、图集批量下载、原声音频提取、弹幕 ASS 导出、作者主页批量任务及断点恢复。
// @author        小辉同學
// @match         https://*.douyin.com/*
// @icon          data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiMxMTE1MWMiLz48cGF0aCBkPSJNMTcgMTdoMTFjMTEgMCAxOCA1IDE4IDE1cy03IDE1LTE4IDE1SDE3em0xMCAyM2M3IDAgMTAtMiAxMC04cy0zLTgtMTAtOGgtMnYxNnoiIGZpbGw9IiM4ZmE3ZmYiLz48L3N2Zz4=
// @license       MIT
// @require       https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.umd.js
// @run-at        document-idle
// @noframes
// @grant         GM_xmlhttpRequest
// @grant         GM.xmlHttpRequest
// @grant         GM_download
// @grant         GM.download
// @grant         unsafeWindow
// @connect       *
// ==/UserScript==

/*
 * 派生与版权说明
 *
 * 本脚本基于 zhzLuke96/douyin-dl-user-js 修改：
 * https://github.com/zhzLuke96/douyin-dl-user-js
 *
 * 原项目许可证：MIT License
 * Copyright (c) 2024 len
 *
 * 主要增强：事件驱动任务中心、Chrome 文件系统流式写入、下载恢复与暂停、
 * 作者主页批量任务管理、低资源 DOM 观察、中文状态反馈及交互稳定性修复。
 * 修改部分 Copyright (c) 2026 小辉同學。
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const requires = this;

(function () {
  "use strict";

  // #region tools function
  /*
   * 模板字符串函数
   * 用于占位标记用来触发编辑器高亮和格式化，没有实际作用
   *
   * @type {function(strings: TemplateStringsArray, ...values: any[]): string}}
   *
   * NOTE: 虽然都叫 HTML 但是和 htm 里面的不一样
   */
  const html = (strings, ...values) => String.raw(strings, ...values);
  /**
   * 安全渲染用户可配置模板。
   *
   * 仅支持界面中公开的 `${变量名}` / `${对象.属性}` 占位符，不执行任意
   * JavaScript。这样既保留原有命名和目录模板，又避免 localStorage 中的模板
   * 被当作代码执行。
   *
   * @param {Record<string, any>} context
   * @param {string} template
   * @returns {string}
   */
  const renderTemplate = (context, template) => {
    let source = String(template ?? "").trim();
    if (source.startsWith("`") && source.endsWith("`") && source.length >= 2) {
      source = source.slice(1, -1);
    }

    return source.replace(
      /\$\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\}/g,
      (_match, path) => {
        const value = path.split(".").reduce(
          (current, key) => (current == null ? undefined : current[key]),
          context
        );
        return value == null ? "" : String(value);
      }
    );
  };

  /** 获取并校验 @require 注入的 Preact 运行时。 */
  const getHtmPreact = () => {
    const runtime = requires?.htmPreact;
    if (!runtime?.html || !runtime?.render) {
      throw new Error("界面组件加载失败，请检查网络后刷新页面");
    }
    return runtime;
  };

  /**
   * 复制文本，Clipboard API 不可用时使用隐藏文本框兜底。
   * @param {string} value
   */
  async function copyText(value) {
    const text = String(value ?? "");
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    Object.assign(textarea.style, {
      position: "fixed",
      left: "-9999px",
      opacity: "0",
    });
    document.body.appendChild(textarea);
    textarea.select();
    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }
  /**
   * 日期格式化函数
   *
   * @type {(date: Date, format?: string) => string}
   */
  const formatDate = (date, format = "YYYY-MM-DD HH:mm:ss") => {
    const o = {
      YYYY: date.getFullYear(),
      MM: ("0" + (date.getMonth() + 1)).slice(-2),
      DD: ("0" + date.getDate()).slice(-2),
      HH: ("0" + date.getHours()).slice(-2),
      mm: ("0" + date.getMinutes()).slice(-2),
      ss: ("0" + date.getSeconds()).slice(-2),
    };
    return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (m) => o[m]);
  };

  const isProfilePagePath = (pathname = location.pathname) =>
    pathname.startsWith("/user/");

  /**
   * GPU Safe 单实例 Toast。
   *
   * 为兼容旧调用仍保留 target 参数，但新版不再读取 target 的
   * getBoundingClientRect / offsetWidth / offsetHeight，也不创建多个 fixed 浮层。
   * @param {HTMLElement|string|null} [_target]
   * @param {number} [defaultDuration=2000]
   */
  const ToastCenter = {
    el: null,
    timer: null,

    ensure() {
      if (this.el?.isConnected) return this.el;
      if (!document.body) return null;

      const el = document.createElement("div");
      el.className = "dy-dl-toast dy-dl-toast-v1";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
      this.el = el;
      return el;
    },

    update(message, duration = 2000) {
      const el = this.ensure();
      if (!el) return;

      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }

      el.textContent = String(message || "");
      el.style.display = "block";

      if (duration > 0) {
        this.timer = setTimeout(() => {
          if (this.el) this.el.style.display = "none";
          this.timer = null;
        }, duration);
      }
    },

    close() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.el) this.el.style.display = "none";
    },
  };

  function createToast(_target, defaultDuration = 2000) {
    return {
      update: (message, duration = defaultDuration) =>
        ToastCenter.update(message, duration),
      close: () => ToastCenter.close(),
    };
  }


  // =============================================================================
  // 产品级确认/信息对话框
  // =============================================================================
  /**
   * 替代下载任务 UI 中的原生 alert / confirm。
   * 返回 Promise<boolean>：主操作为 true，取消/关闭为 false。
   */
  const ProductDialog = {
    active: null,

    open({
      icon = "info",
      title = "提示",
      message = "",
      detail = "",
      primaryLabel = "确定",
      secondaryLabel = "取消",
      danger = false,
      hideSecondary = false,
    } = {}) {
      this.close(false);

      return new Promise((resolve) => {
        const previouslyFocused =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const overlay = document.createElement("div");
        overlay.className = "dy-dl-product-dialog-overlay-v106";
        overlay.innerHTML = `
          <section class="dy-dl-product-dialog-v106" role="dialog" aria-modal="true" aria-labelledby="dy-dl-dialog-title-v106">
            <div class="dy-dl-product-dialog-icon-v106">${iconMarkup(icon)}</div>
            <div class="dy-dl-product-dialog-copy-v106">
              <h3 id="dy-dl-dialog-title-v106"></h3>
              <p class="dy-dl-product-dialog-message-v106"></p>
              <p class="dy-dl-product-dialog-detail-v106"></p>
            </div>
            <div class="dy-dl-product-dialog-actions-v106">
              <button type="button" class="dy-dl-btn-v106 dy-dl-btn-secondary-v106 dy-dl-product-dialog-secondary-v106"></button>
              <button type="button" class="dy-dl-btn-v106 dy-dl-btn-primary-v106 dy-dl-product-dialog-primary-v106"></button>
            </div>
          </section>`;

        const titleEl = overlay.querySelector("h3");
        const messageEl = overlay.querySelector(".dy-dl-product-dialog-message-v106");
        const detailEl = overlay.querySelector(".dy-dl-product-dialog-detail-v106");
        const primary = overlay.querySelector(".dy-dl-product-dialog-primary-v106");
        const secondary = overlay.querySelector(".dy-dl-product-dialog-secondary-v106");
        const iconEl = overlay.querySelector(".dy-dl-product-dialog-icon-v106");

        titleEl.textContent = String(title || "提示");
        messageEl.textContent = String(message || "");
        detailEl.textContent = String(detail || "");
        detailEl.hidden = !detail;
        primary.textContent = String(primaryLabel || "确定");
        secondary.textContent = String(secondaryLabel || "取消");
        secondary.hidden = Boolean(hideSecondary);
        primary.classList.toggle("dy-dl-btn-danger-v106", Boolean(danger));
        iconEl.dataset.tone = danger ? "danger" : icon === "warning" ? "warning" : "info";

        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          document.removeEventListener("keydown", onKeyDown, true);
          overlay.remove();
          if (this.active?.overlay === overlay) this.active = null;
          previouslyFocused?.focus?.();
          resolve(Boolean(value));
        };
        const onKeyDown = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        };

        primary.addEventListener("click", () => finish(true));
        secondary.addEventListener("click", () => finish(false));
        overlay.addEventListener("click", (event) => {
          if (event.target === overlay) finish(false);
        });
        document.addEventListener("keydown", onKeyDown, true);
        document.body.appendChild(overlay);
        primary.focus();

        this.active = { overlay, finish };
      });
    },

    close(value = false) {
      this.active?.finish?.(value);
    },
  };

  // =============================================================================
  // V1.0.5 统一下载任务中心
  // =============================================================================
  const DownloadFormat = {
    bytes(value) {
      const n = Number(value || 0);
      if (!Number.isFinite(n) || n <= 0) return "0 B";
      const units = ["B", "KB", "MB", "GB", "TB"];
      const index = Math.min(
        units.length - 1,
        Math.floor(Math.log(n) / Math.log(1024))
      );
      const scaled = n / Math.pow(1024, index);
      const digits = index === 0 ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      return `${scaled.toFixed(digits)} ${units[index]}`;
    },

    speed(value) {
      const n = Number(value || 0);
      return n > 0 ? `${this.bytes(n)}/s` : "--";
    },

    eta(seconds) {
      const n = Number(seconds);
      if (!Number.isFinite(n) || n < 0) return "--";
      if (n < 60) return `约 ${Math.max(1, Math.ceil(n))} 秒`;
      const minutes = Math.floor(n / 60);
      const remain = Math.ceil(n % 60);
      return `约 ${minutes} 分 ${remain} 秒`;
    },

    method(value) {
      const map = {
        file_system: "Chrome 流式写入",
        gm_download: "Tampermonkey 下载",
        native: "浏览器原生下载",
        blob: "Blob 兼容下载",
        aria2: "aria2 RPC",
        abdm: "AB Download Manager",
      };
      return map[value] || value || "浏览器下载";
    },
  };

  // =============================================================================
  // Lucide SVG 图标集中配置区
  // =============================================================================
  /**
   * 【以后修改图标的位置】
   * 搜索 UI_ICONS 即可统一修改任务中心、作者页浮动面板和播放器“插件”按钮。
   * 所有图标均以内嵌 SVG 形式存在，不会从外部网站加载，也不会增加网络请求。
   * SVG 使用 currentColor，具体颜色由各按钮 CSS 控制。
   */
  const UI_ICONS = Object.freeze({
    download: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>`,
    downloadCloud: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 13v8"/><path d="m8 17 4 4 4-4"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><path d="M16 13H8"/></svg>`,
    package: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
    settings: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
    chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`,
    chevronUp: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>`,
    list: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="m18 9 3 3-3 3"/></svg>`,
    listChecks: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="m17 9 2 2 4-4"/><path d="m17 15 2 2 4-4"/></svg>`,
    search: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
    filter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18"/><path d="M7 12h10"/><path d="M10 20h4"/></svg>`,
    pause: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/></svg>`,
    play: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>`,
    retry: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`,
    cancel: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,
    close: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    success: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`,
    warning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
    error: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`,
    info: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
    folder: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
    send: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`,
    history: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>`,
    scan: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/></svg>`,
    image: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  });

  const iconMarkup = (name, className = "") => {
    const svg = UI_ICONS[name] || "";
    return className ? svg.replace("<svg ", `<svg class="${className}" `) : svg;
  };

  /**
   * 单文件下载进度卡。
   * - 仅下载任务进行时存在可见更新；
   * - 没有 setInterval / rAF 循环；
   * - 网络分块事件最多约每 220ms 刷新一次；
   * - 完成后自动隐藏。
   */
  /**
   * V1.0.5 统一下载任务中心。
   *
   * 显示层级：
   * 1. 胶囊：长期下载时仅占用很小区域；
   * 2. 紧凑卡：显示当前文件、速度、大小、剩余时间；
   * 3. 批量列表：由作者主页批量管理器负责，点击胶囊可重新打开。
   *
   * 设计约束：
   * - 无毛玻璃、无 transform 动画、无 rAF 循环；
   * - 下载进度仍由真实事件驱动；
   * - 关闭批量管理器不会终止下载；
   * - 失败时保留胶囊和“重新下载”入口。
   */
  const UnifiedTaskCenter = {
    root: null,
    nodes: {},
    hideTimer: 0,
    collapseTimer: 0,
    cancelHandler: null,
    retryHandler: null,
    retryLabel: "重新下载",
    managerOpener: null,
    managerVisible: false,
    lastPaintAt: 0,
    lastPayload: null,
    view: "capsule",
    pointerInside: false,
    kind: "single",

    ensure() {
      if (this.root?.isConnected) return this.root;
      if (!document.body) return null;

      const root = document.createElement("section");
      root.className = "dy-dl-task-center-v106";
      root.hidden = true;
      root.dataset.view = "capsule";
      root.innerHTML = `
        <button type="button" class="dy-dl-task-capsule-v106" aria-label="打开下载任务">
          <span class="dy-dl-task-capsule-icon-v106">${iconMarkup("download")}</span>
          <span class="dy-dl-task-capsule-text-v106">下载任务</span>
          <span class="dy-dl-task-capsule-progress-v106"><i></i></span>
        </button>

        <div class="dy-dl-task-panel-v106">
          <header class="dy-dl-task-panel-header-v106">
            <div class="dy-dl-task-panel-title-group-v106">
              <strong class="dy-dl-task-title-v106">下载任务</strong>
              <span class="dy-dl-task-method-v106"></span>
            </div>
            <button type="button" class="dy-dl-icon-btn-v106 dy-dl-task-minimize-v106" aria-label="缩小进度卡" title="缩小">${iconMarkup("chevronDown")}</button>
          </header>

          <div class="dy-dl-task-state-row-v106">
            <span class="dy-dl-task-state-icon-v106">${iconMarkup("download")}</span>
            <span class="dy-dl-task-status-v106">准备中</span>
            <strong class="dy-dl-task-percent-v106">0%</strong>
          </div>

          <div class="dy-dl-task-track-v106"><div class="dy-dl-task-fill-v106"></div></div>

          <div class="dy-dl-task-metrics-v106">
            <span class="dy-dl-task-size-v106">0 B</span>
            <span class="dy-dl-task-speed-v106">--</span>
            <span class="dy-dl-task-eta-v106">--</span>
          </div>

          <div class="dy-dl-task-actions-v106">
            <button type="button" class="dy-dl-btn-v106 dy-dl-btn-primary-v106 dy-dl-task-retry-v106" hidden>${iconMarkup("retry")}<span>重新下载</span></button>
            <button type="button" class="dy-dl-btn-v106 dy-dl-btn-secondary-v106 dy-dl-task-cancel-v106">${iconMarkup("cancel")}<span>取消</span></button>
          </div>
        </div>`;

      document.body.appendChild(root);
      this.root = root;
      this.nodes = {
        capsule: root.querySelector(".dy-dl-task-capsule-v106"),
        capsuleText: root.querySelector(".dy-dl-task-capsule-text-v106"),
        capsuleFill: root.querySelector(".dy-dl-task-capsule-progress-v106 i"),
        title: root.querySelector(".dy-dl-task-title-v106"),
        method: root.querySelector(".dy-dl-task-method-v106"),
        status: root.querySelector(".dy-dl-task-status-v106"),
        stateIcon: root.querySelector(".dy-dl-task-state-icon-v106"),
        percent: root.querySelector(".dy-dl-task-percent-v106"),
        fill: root.querySelector(".dy-dl-task-fill-v106"),
        size: root.querySelector(".dy-dl-task-size-v106"),
        speed: root.querySelector(".dy-dl-task-speed-v106"),
        eta: root.querySelector(".dy-dl-task-eta-v106"),
        cancel: root.querySelector(".dy-dl-task-cancel-v106"),
        minimize: root.querySelector(".dy-dl-task-minimize-v106"),
        retry: root.querySelector(".dy-dl-task-retry-v106"),
      };

      root.addEventListener("mouseenter", () => {
        this.pointerInside = true;
        clearTimeout(this.collapseTimer);
      });
      root.addEventListener("mouseleave", () => {
        this.pointerInside = false;
        this._scheduleAutoCollapse();
      });
      this.nodes.capsule.addEventListener("click", () => {
        if (this.kind === "batch") {
          this.managerOpener?.();
        } else {
          this.expand();
        }
      });
      this.nodes.minimize.addEventListener("click", () => this.minimize());
      this.nodes.cancel.addEventListener("click", () => this.cancelHandler?.());
      this.nodes.retry.addEventListener("click", () => {
        const handler = this.retryHandler;
        if (typeof handler !== "function") return;
        Promise.resolve(handler()).catch((error) => {
          console.error("[dy-dl]任务操作失败：", error);
          ToastCenter.update(`操作失败：${error?.message || error}`, 2600);
        });
      });

      return root;
    },

    attachManagerOpener(opener) {
      this.managerOpener = typeof opener === "function" ? opener : null;
    },

    setManagerVisible(visible) {
      this.managerVisible = Boolean(visible);
      const root = this.ensure();
      if (!root || this.kind !== "batch") return;

      // V1.0.7 产品规则：批量管理器本身已经展示完整进度时，左下角胶囊完全隐藏；
      // 管理器关闭/最小化后，胶囊才重新接管当前批量任务状态。
      if (this.managerVisible) {
        root.hidden = true;
        return;
      }

      if (this.lastPayload && this.lastPayload.phase && this.lastPayload.phase !== "idle") {
        root.hidden = false;
        this.update({ ...this.lastPayload, batch: true }, true);
        this.minimize();
      }
    },

    setCancel(handler, label = "取消") {
      this.cancelHandler = typeof handler === "function" ? handler : null;
      if (!this.nodes.cancel) return;
      this.nodes.cancel.hidden = !this.cancelHandler;
      this.nodes.cancel.innerHTML = `${iconMarkup("cancel")}<span>${label}</span>`;
    },

    setRetry(handler, label = "重新下载") {
      this.retryHandler = typeof handler === "function" ? handler : null;
      this.retryLabel = label || "重新下载";
      if (!this.nodes.retry) return;
      this.nodes.retry.hidden = !this.retryHandler;
      const iconName = /继续|检查/.test(this.retryLabel) ? "play" : "retry";
      this.nodes.retry.innerHTML = `${iconMarkup(iconName)}<span>${this.retryLabel}</span>`;
    },

    minimize() {
      const root = this.ensure();
      if (!root) return;
      this.view = "capsule";
      root.dataset.view = "capsule";
      clearTimeout(this.collapseTimer);
    },

    expand() {
      const root = this.ensure();
      if (!root) return;
      if (this.kind === "batch") {
        this.minimize();
        this.managerOpener?.();
        return;
      }
      this.view = "expanded";
      root.dataset.view = "expanded";
      clearTimeout(this.collapseTimer);
      this._scheduleAutoCollapse();
    },

    hide() {
      clearTimeout(this.hideTimer);
      clearTimeout(this.collapseTimer);
      if (this.root) this.root.hidden = true;
      this.lastPayload = null;
      this.setCancel(null);
      this.setRetry(null);
    },

    _scheduleAutoCollapse() {
      const phase = this.lastPayload?.phase || "";
      if (
        this.kind === "batch" ||
        this.collapseTimer ||
        this.pointerInside ||
        this.view !== "expanded" ||
        ["failed", "cancelled", "paused"].includes(phase)
      ) return;
      this.collapseTimer = setTimeout(() => {
        this.collapseTimer = 0;
        if (!this.pointerInside && !this.root?.hidden) this.minimize();
      }, 5000);
    },

    _phaseIcon(phase) {
      if (phase === "completed") return "success";
      if (["failed", "unavailable"].includes(phase)) return "error";
      if (phase === "paused") return "pause";
      if (["retrying", "waiting_data", "validating_resume"].includes(phase)) return "warning";
      return "download";
    },

    _capsuleText(payload, percent) {
      if (payload.batch) {
        const processed = Number(payload.processed || 0);
        const total = Number(payload.taskTotal || 0);
        const failed = Number(payload.failed || 0);
        if (payload.phase === "paused") return `已暂停 · ${processed}/${total || 0}`;
        if (payload.phase === "failed" || failed > 0) return `${processed} 项完成 · ${failed} 项失败`;
        if (payload.phase === "completed") return `已完成 · ${processed}/${total || processed}`;
        return `下载中 · ${processed}/${total || 0} · ${Math.round(percent || 0)}%`;
      }
      if (payload.phase === "completed") return "下载完成";
      if (payload.phase === "failed") return "下载失败 · 点击查看";
      if (payload.phase === "paused") return "已暂停 · 点击展开";
      if (payload.phase === "cancelled") return "任务已取消";
      return `下载中 · ${Math.round(percent || 0)}%`;
    },

    update(payload = {}, force = false) {
      const root = this.ensure();
      if (!root) return;
      const now = performance.now();
      if (!force && now - this.lastPaintAt < 220) return;
      this.lastPaintAt = now;

      clearTimeout(this.hideTimer);
      const previousPhase = this.lastPayload?.phase || "";
      this.kind = payload.batch || Number(payload.taskTotal || 0) > 1 ? "batch" : "single";
      this.lastPayload = { ...payload, batch: this.kind === "batch" };

      // 产品规则：空闲状态不显示任务胶囊。
      if (payload.phase === "idle" || !payload.phase) {
        this.hide();
        return;
      }

      // 批量管理器打开时仍保存最新 payload，但不重复渲染左下角胶囊。
      if (this.kind === "batch" && this.managerVisible) {
        root.hidden = true;
        return;
      }

      root.hidden = false;
      root.dataset.phase = payload.phase;

      const loaded = Number(payload.loaded || 0);
      const total = Number(payload.total || 0);
      const percent = Number.isFinite(payload.percent)
        ? Math.max(0, Math.min(100, payload.percent))
        : total > 0
        ? Math.max(0, Math.min(100, (loaded / total) * 100))
        : 0;

      const suppressRate = ["validating_resume", "paused", "connecting"].includes(payload.phase) && !payload.hasTransferData;
      this.nodes.title.textContent = payload.filename || (this.kind === "batch" ? "批量下载" : "下载任务");
      this.nodes.method.textContent = DownloadFormat.method(payload.method);
      this.nodes.status.textContent = payload.status || "正在下载";
      this.nodes.stateIcon.innerHTML = iconMarkup(this._phaseIcon(payload.phase));
      this.nodes.percent.textContent = total > 0 ? `${Math.round(percent)}%` : "";
      this.nodes.fill.style.width = `${percent}%`;
      this.nodes.capsuleFill.style.width = `${percent}%`;
      this.nodes.size.textContent = total > 0
        ? `${DownloadFormat.bytes(loaded)} / ${DownloadFormat.bytes(total)}`
        : DownloadFormat.bytes(loaded);
      this.nodes.speed.textContent = suppressRate ? "--" : DownloadFormat.speed(payload.speed);
      this.nodes.eta.textContent = suppressRate ? "--" : DownloadFormat.eta(payload.eta);
      this.nodes.capsuleText.textContent = this._capsuleText(this.lastPayload, percent);
      this.nodes.capsule.querySelector(".dy-dl-task-capsule-icon-v106").innerHTML = iconMarkup(this._phaseIcon(payload.phase));

      if (["completed", "submitted"].includes(payload.phase)) this.setCancel(null);

      // 批量任务永远只使用胶囊；完整信息只在管理器中展示。
      if (this.kind === "batch") {
        this.minimize();
      } else if (["preparing", "connecting", "downloading", "retrying", "waiting_data", "validating_resume"].includes(payload.phase)) {
        const activePhases = ["preparing", "connecting", "downloading", "retrying", "waiting_data", "validating_resume"];
        if (!activePhases.includes(previousPhase)) this.expand();
      }
      this._scheduleAutoCollapse();
    },

    updateBatch(snapshot = {}) {
      const run = snapshot.run || null;
      const counts = snapshot.counts || {};
      const current = run?.current || {};
      const processed = Number(run?.processed || 0);
      const total = Number(run?.total || 0);
      const failed = Number(counts.failed || 0);

      // 无活动任务、无失败、非刚完成：任务胶囊完全隐藏。
      if (!snapshot.jobRunning && !snapshot.canResume && !run && snapshot.statusLabel !== "已完成" && failed <= 0) {
        this.hide();
        return;
      }

      let phase = "idle";
      let status = snapshot.statusLabel || "待开始";
      if (snapshot.jobRunning) {
        phase = current.phase || "downloading";
        status = current.status || "正在下载";
      } else if (snapshot.statusLabel === "已暂停") {
        phase = "paused";
        status = snapshot.resumeStatus || "批量任务已暂停";
      } else if (snapshot.statusLabel === "已完成") {
        phase = failed > 0 ? "failed" : "completed";
        status = failed > 0 ? `批量任务结束，${failed} 项需要处理` : "批量下载完成";
      } else if (failed > 0) {
        phase = "failed";
        status = `${failed} 项任务需要处理`;
      }

      this.update({
        ...current,
        filename: current.filename || `批量下载 · ${snapshot.profileName || "当前作者"}`,
        batch: true,
        method: current.method || "",
        phase,
        status,
        percent: Number.isFinite(current.percent) ? current.percent : 0,
        processed,
        taskTotal: total,
        selected: Number(counts.selected || 0),
        failed,
      }, true);

      this.setRetry(null);
      this.setCancel(null);
      this.minimize();

      if (phase === "completed") {
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => this.hide(), 5000);
      }
    },

    finish(payload = {}) {
      this.update(payload, true);
      this.setCancel(null);
      clearTimeout(this.hideTimer);
      if (payload.phase === "failed") {
        this.minimize();
        return;
      }
      this.hideTimer = setTimeout(() => this.hide(), payload.batch ? 5000 : 3000);
    },
  };

  // 保留旧名称，避免后续下载器大量调用点发生无意义改动。
  const DownloadProgressCenter = UnifiedTaskCenter;

  /** 当前活动下载的取消入口。批量“暂停”也会调用这里。 */
  const DownloadRuntime = {
    cancelHandler: null,

    setCancel(handler) {
      this.cancelHandler = typeof handler === "function" ? handler : null;
    },

    clearCancel(handler = null) {
      if (!handler || this.cancelHandler === handler) this.cancelHandler = null;
    },

    // mode: pause = 尽量保存部分文件；cancel = 用户明确取消。
    cancelActive(mode = "cancel") {
      const handler = this.cancelHandler;
      if (typeof handler === "function") handler(mode);
    },
  };


  /**
   * V1.0.5 下载恢复策略。
   *
   * 自动重试：
   * - 第一次失败等待 3 秒；
   * - 第二次失败等待 10 秒；
   * - 再次失败后交给人工“重新下载”。
   *
   * 无数据监测：
   * - 20 秒没有新字节：仅提示；
   * - 90 秒没有新字节：中止当前连接并进入重试。
   */
  const DownloadRecoveryPolicy = {
    RETRY_DELAYS: Object.freeze([3000, 10000]),
    NO_DATA_WARN_MS: 20000,
    NO_DATA_RECONNECT_MS: 90000,

    _statusFrom(value) {
      const direct = Number(value?.httpStatus || value?.status || 0);
      if (Number.isFinite(direct) && direct > 0) return direct;

      const text = String(
        value?.reason ||
          value?.message ||
          value?.error?.message ||
          value?.error ||
          ""
      );
      const match = text.match(/\bHTTP\s+(\d{3})\b/i);
      return match ? Number(match[1]) : 0;
    },

    classify(value = {}) {
      const status = this._statusFrom(value);
      const text = String(
        value?.reason ||
          value?.message ||
          value?.error?.message ||
          value?.error ||
          ""
      ).toLowerCase();

      if (
        value?.method === "aria2" &&
        value?.reason === "aria2_status_failed"
      ) {
        return {
          code: "aria2_status_unknown",
          retryable: false,
          refreshable: false,
          unavailable: false,
          status,
          message:
            "aria2 状态查询失败，任务可能仍在下载，请先检查 aria2",
        };
      }

      if (value?.cancelled || /cancel|abort|user_cancelled/.test(text)) {
        return {
          code: "cancelled",
          retryable: false,
          refreshable: false,
          unavailable: false,
          status,
          message: "已取消",
        };
      }

      if (navigator.onLine === false || value?.offline) {
        return {
          code: "offline",
          retryable: true,
          refreshable: false,
          unavailable: false,
          status,
          message: "网络已断开，等待恢复",
        };
      }

      if (status === 410) {
        return {
          code: "gone",
          retryable: false,
          refreshable: true,
          unavailable: true,
          status,
          message:
            "作品已不可用，可能被作者删除、设为私密或被平台下架",
        };
      }

      if (status === 404) {
        return {
          code: "not_found",
          retryable: false,
          refreshable: true,
          unavailable: false,
          status,
          message: "资源地址不存在，正在尝试刷新作品链接",
        };
      }

      if (status === 401 || status === 403) {
        return {
          code: "forbidden",
          retryable: false,
          refreshable: true,
          unavailable: false,
          status,
          message:
            "访问被拒绝，可能是链接过期、登录权限、地区限制或防盗链",
        };
      }

      if (status === 429) {
        return {
          code: "rate_limited",
          retryable: true,
          refreshable: false,
          unavailable: false,
          status,
          message: "请求过于频繁，等待服务器允许后重试",
        };
      }

      if ([500, 502, 503, 504].includes(status)) {
        return {
          code: "server_busy",
          retryable: true,
          refreshable: false,
          unavailable: false,
          status,
          message: "服务器暂时不可用，稍后重试",
        };
      }

      if (/stall|no_data|暂无数据/.test(text)) {
        return {
          code: "stalled",
          retryable: true,
          refreshable: false,
          unavailable: false,
          status,
          message: "连接长时间没有数据，准备重新连接",
        };
      }

      if (/timeout|timed out/.test(text)) {
        return {
          code: "timeout",
          retryable: true,
          refreshable: false,
          unavailable: false,
          status,
          message: "连接超时，准备重新连接",
        };
      }

      if (
        /network|failed to fetch|load failed|connection|econn|socket/.test(text) ||
        value?.error?.name === "TypeError"
      ) {
        return {
          code: "network",
          retryable: true,
          refreshable: false,
          unavailable: false,
          status,
          message: "网络连接失败",
        };
      }

      return {
        code: "unknown",
        retryable: false,
        refreshable: false,
        unavailable: false,
        status,
        message: value?.message || value?.reason || "下载失败",
      };
    },

    retryDelay(attemptIndex, retryAfterMs = 0) {
      if (Number(retryAfterMs) > 0) return Number(retryAfterMs);
      return this.RETRY_DELAYS[Math.max(0, Math.min(
        this.RETRY_DELAYS.length - 1,
        attemptIndex
      ))];
    },

    async wait(ms, signal, onTick = null) {
      const duration = Math.max(0, Number(ms || 0));
      if (!duration) return;

      await new Promise((resolve, reject) => {
        let timer = 0;

        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener?.("abort", onAbort);
        };

        const onAbort = () => {
          cleanup();
          reject(new DOMException("已取消", "AbortError"));
        };

        if (signal?.aborted) {
          onAbort();
          return;
        }

        try {
          onTick?.(duration);
        } catch {}

        signal?.addEventListener?.("abort", onAbort, { once: true });
        timer = setTimeout(() => {
          cleanup();
          resolve();
        }, duration);
      });
    },

    async waitForOnline(signal, onStatus = null) {
      if (navigator.onLine !== false) return;

      try {
        onStatus?.("网络已断开，等待恢复");
      } catch {}

      await new Promise((resolve, reject) => {
        const cleanup = () => {
          window.removeEventListener("online", onOnline);
          signal?.removeEventListener?.("abort", onAbort);
        };

        const onOnline = () => {
          cleanup();
          resolve();
        };

        const onAbort = () => {
          cleanup();
          reject(new DOMException("已取消", "AbortError"));
        };

        if (signal?.aborted) {
          onAbort();
          return;
        }

        window.addEventListener("online", onOnline, { once: true });
        signal?.addEventListener?.("abort", onAbort, { once: true });
      });
    },

    unavailableMessage(classification, refreshAttempted = false) {
      if (classification?.code === "gone") return classification.message;

      if (classification?.code === "not_found" && refreshAttempted) {
        return (
          "作品已不可用，可能被作者删除、设为私密、平台下架，" +
          "或当前账号/地区无权访问"
        );
      }

      if (classification?.code === "forbidden" && refreshAttempted) {
        return (
          "作品仍可能存在，但当前账号、地区或下载链接无权访问"
        );
      }

      return classification?.message || "下载失败";
    },
  };

  class DownloadHttpError extends Error {
    constructor(response, url = "") {
      super(`HTTP ${response?.status || 0} ${response?.statusText || ""}`.trim());
      this.name = "DownloadHttpError";
      this.httpStatus = Number(response?.status || 0);
      this.url = url;
      this.retryAfterMs = 0;

      const retryAfter = response?.headers?.get?.("retry-after") || "";
      if (/^\d+$/.test(retryAfter)) {
        this.retryAfterMs = Number(retryAfter) * 1000;
      } else if (retryAfter) {
        const date = Date.parse(retryAfter);
        if (Number.isFinite(date)) this.retryAfterMs = Math.max(0, date - Date.now());
      }
    }
  }

  class DownloadStallError extends Error {
    constructor(message = "下载长时间没有数据") {
      super(message);
      this.name = "DownloadStallError";
      this.reason = "stalled";
    }
  }
  /**
   * 规范化文件名，移除非法字符，处理保留名称，限制长度
   * @param {string} name - 原始文件名（不包含路径）
   * @param {Object} [options] - 可选配置
   * @param {string} [options.replacementChar='_'] - 替换非法字符的字符
   * @param {number} [options.maxLength=255] - 最大文件名长度（不含扩展名的部分会优先截断）
   * @returns {string} 规范化后的文件名
   */
  function normalizeFilename(name, options = {}) {
    const { replacementChar = "_", maxLength = 255 } = options;

    if (typeof name !== "string") return "";

    // 1. 分离基本名和扩展名（最后一个点之后的部分）
    const lastDotIndex = name.lastIndexOf(".");
    let baseName = name;
    let extension = "";

    if (lastDotIndex > 0 && lastDotIndex < name.length - 1) {
      baseName = name.slice(0, lastDotIndex);
      extension = name.slice(lastDotIndex);
    }

    // 2. 替换非法字符：Windows 保留字符 + 路径分隔符 + 控制字符。
    // 使用字符码判断控制字符，避免静态检查器把正则误判为隐藏控制代码。
    let cleanBase = Array.from(baseName, (char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || code === 127 || /[\\/:*?"<>|]/.test(char)
        ? replacementChar
        : char;
    }).join("");

    // 3. 处理 Windows 保留设备名（如 CON, PRN, AUX, NUL, COM1 等）
    const reservedNames = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\..*)?$/i;
    if (reservedNames.test(cleanBase)) {
      cleanBase = replacementChar + cleanBase;
    }

    // 4. 去除首尾空格和点号（某些文件系统不允许结尾点）
    cleanBase = cleanBase.trim().replace(/^\.+/, "").replace(/\.+$/, "");

    // 5. 防止空字符串
    if (cleanBase.length === 0) {
      cleanBase = "file";
    }

    // 6. 合并连续的 replacementChar 为单个（可选，视觉更干净）
    if (replacementChar) {
      const escapedReplacement = replacementChar.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );
      const multiReplacement = new RegExp(
        `(?:${escapedReplacement}){2,}`,
        "g"
      );
      cleanBase = cleanBase.replace(multiReplacement, replacementChar);
    }

    // 7. 长度限制（优先保留扩展名）
    const maxBaseLength = maxLength - extension.length;
    if (maxBaseLength > 0 && cleanBase.length > maxBaseLength) {
      cleanBase = cleanBase.slice(0, maxBaseLength);
    }

    // 8. 重新组合
    let result = cleanBase + extension;

    // 最后再次确保结果不为空（极端情况）
    if (result.length === 0) {
      result = "file";
    }

    return result;
  }

  /**
   * 根据真实响应类型判断原声音频扩展名。
   *
   * 不能把所有音频强行命名为 MP3：抖音返回的原声可能是 MP3、M4A、
   * AAC、WebM、Ogg 等格式。类型无法确认时只按 URL 中可信扩展名判断，
   * 最后才使用兼容性较好的 M4A 作为兜底。
   */
  function resolveAudioFileMeta(contentType = "", url = "", fallbackExt = "m4a") {
    const mime = String(contentType || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const mimeMap = {
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/mp4": "m4a",
      "audio/x-m4a": "m4a",
      "audio/mp4a-latm": "m4a",
      "video/mp4": "m4a",
      "audio/aac": "aac",
      "audio/x-aac": "aac",
      "audio/aacp": "aac",
      "audio/vnd.dlna.adts": "aac",
      "audio/ogg": "ogg",
      "application/ogg": "ogg",
      "audio/webm": "webm",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/flac": "flac",
      "audio/x-flac": "flac",
    };

    let urlExt = "";
    try {
      urlExt =
        new URL(url, location.href).pathname
          .match(/\.([a-z0-9]{2,5})$/i)?.[1]
          ?.toLowerCase() || "";
    } catch {}

    const supportedExt = /^(?:mp3|m4a|aac|ogg|opus|webm|wav|flac)$/i;
    const safeFallback = supportedExt.test(String(fallbackExt || ""))
      ? String(fallbackExt).toLowerCase()
      : "m4a";
    const ext =
      mimeMap[mime] ||
      (supportedExt.test(urlExt) ? urlExt : safeFallback);
    const normalizedMime =
      mime && (mime.startsWith("audio/") || mime === "video/mp4")
        ? mime
        : ext === "mp3"
        ? "audio/mpeg"
        : ext === "m4a"
        ? "audio/mp4"
        : `audio/${ext}`;

    return { ext, mime: normalizedMime };
  }
  /**
   * @param {Function} func - The function to debounce.
   * @param {number} wait - Delay in milliseconds.
   */
  function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }

  /**
   * @typedef {Object.<string, string | number | CSSObject | null | false>} CSSObject
   * 说明：
   * - key: CSS 属性（camelCase）或选择器（如 'span', '&:hover', '.item', '> div'）
   * - value:
   *    - string | number → 样式值
   *    - CSSObject → 嵌套样式
   *    - null | false → 忽略（用于条件控制）
   */

  /**
   * @typedef {CSSObject | Array<CSSObject | null | false>} CSSInput
   */

  /**
   * 创建一个极简 CSS-in-JS 工具
   *
   * 特性：
   * - 支持嵌套选择器（子元素 / 伪类 / &）
   * - 支持数组合并（条件样式）
   * - 自动生成 className（hash）
   * - 自动去重（相同样式只插入一次）
   *
   * @returns {(input: CSSInput) => string} css 函数，返回 className
   *
   * @example
   * const css = createCSS()
   *
   * const cls = css({
   *   color: 'red',
   *   fontSize: '14px'
   * })
   *
   * el.className = cls
   */
  function createCSS() {
    const style = document.createElement("style");
    document.head.appendChild(style);
    const sheet = style.sheet;

    /** @type {Map<string, string>} */
    const cache = new Map();

    /** @param {string} s */
    const kebab = (s) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

    /** @param {string} s */
    const hash = (s) => {
      let h = 0,
        i = s.length;
      while (i) h = (h * 31 + s.charCodeAt(--i)) | 0;
      return "c" + (h >>> 0).toString(36);
    };

    /**
     * 合并输入（支持数组）
     * @param {CSSInput} input
     * @returns {CSSObject}
     */
    const merge = (input) =>
      Array.isArray(input)
        ? input.filter(Boolean).reduce((a, b) => Object.assign(a, merge(b)), {})
        : input || {};

    /**
     * 构建 CSS 规则（递归）
     * @param {string} selector
     * @param {CSSObject} obj
     */
    function build(selector, obj) {
      let body = "";

      for (const k in obj) {
        const v = obj[k];
        if (v == null || v === false) continue;

        if (typeof v === "object") {
          const sel = k.includes("&")
            ? k.replace(/&/g, selector)
            : `${selector} ${k}`;

          build(sel, /** @type {CSSObject} */ (v));
        } else {
          body += `${kebab(k)}:${v};`;
        }
      }

      if (body) {
        sheet.insertRule(`${selector}{${body}}`, sheet.cssRules.length);
      }
    }

    /**
     * 生成 className
     * @param {CSSInput} input
     * @returns {string}
     *
     * @example
     * const cls = css({
     *   color: 'red'
     * })
     */
    return function css(input) {
      const obj = merge(input);
      const key = JSON.stringify(obj);

      if (cache.has(key)) return cache.get(key);

      const className = hash(key);
      build(`.${className}`, obj);

      cache.set(key, className);
      return className;
    };
  }
  // #endregion

  // #region 主题样式
  /**
   * Graphite Cobalt（石墨钴蓝）设计系统。
   *
   * 设计原则：
   * - 与抖音原生红色体系明显区分；
   * - 一个界面只保留一个主要操作色；
   * - 成功/警告/错误色只表达状态，不用于装饰普通按钮；
   * - 无毛玻璃、无持续动画，适合长时间运行。
   *
   * 以后需要调整全局配色，请优先搜索：theme.colors
   */
  const theme = {
    colors: {
      primary: "#5B7CFA",
      primaryHover: "#6E8CFF",
      primaryLight: "#9AAEFF",
      primaryPressed: "#4968DD",
      primarySoft: "#18213E",
      primaryBorder: "#344B8E",

      bgBase: "#0B0E13",
      bgOverlay: "#11151C",
      bgNav: "#141922",
      bgFieldset: "#171C25",
      bgControl: "#1E2530",
      bgHover: "#252D39",

      borderLight: "#2B3441",
      borderMedium: "#3B4656",
      borderInput: "#424C5A",

      textPrimary: "#F4F7FB",
      textSecondary: "#B2BBC8",
      textMuted: "#7F8998",
      textDim: "#596270",

      success: "#36B887",
      warning: "#D9A347",
      danger: "#DF6670",
      info: "#58A0FF",
      paused: "#A58BC8",
    },
    spacing: {
      xs: "4px",
      sm: "8px",
      md: "12px",
      lg: "16px",
      xl: "20px",
      xxl: "24px",
      xxxl: "32px",
    },
    borderRadius: {
      sm: "8px",
      md: "12px",
      lg: "16px",
      full: "999px",
    },
    fontSize: {
      xs: "12px",
      sm: "13px",
      md: "14px",
      lg: "18px",
    },
    shadow: {
      panel: "0 12px 36px rgba(0,0,0,.34)",
    },
  };
  // #endregion

  // #region 事件
  /**
   * @template {Record<string, any[]>} Events
   */
  class Emitter {
    constructor() {
      /** @type {Map<keyof Events, Set<Function>>} */
      this.events = new Map();
    }

    /**
     * @template {keyof Events} K
     * @param {K} event
     * @param {(...args: Events[K]) => void} handler
     * @returns {() => void} unsubscribe
     */
    on(event, handler) {
      let set = this.events.get(event);
      if (!set) {
        set = new Set();
        this.events.set(event, set);
      }
      set.add(handler);

      return () => this.off(event, handler);
    }

    /**
     * @template {keyof Events} K
     * @param {K} event
     * @param {(...args: Events[K]) => void} handler
     */
    off(event, handler) {
      const set = this.events.get(event);
      if (!set) return;

      set.delete(handler);

      if (set.size === 0) {
        this.events.delete(event);
      }
    }

    /**
     * @template {keyof Events} K
     * @param {K} event
     * @param {...Events[K]} args
     */
    emit(event, ...args) {
      const set = this.events.get(event);
      if (!set) return;

      // 防止 emit 过程中修改
      for (const fn of [...set]) {
        fn(...args);
      }
    }

    /**
     * @template {keyof Events} K
     * @param {K} event
     * @param {(...args: Events[K]) => void} handler
     * @returns {() => void}
     */
    once(event, handler) {
      const wrap = (...args) => {
        handler(...args);
        this.off(event, wrap);
      };

      return this.on(event, wrap);
    }

    /**
     * 清空某个事件或全部
     * @param {keyof Events} [event]
     */
    clear(event) {
      if (event) {
        this.events.delete(event);
      } else {
        this.events.clear();
      }
    }

    /**
     * @template {any} T
     * @param {keyof Events} event
     * @param {((...args: Events[keyof Events]) => T) | null} getter
     * @returns {T}
     */
    useEvent(event, getter) {
      /**
       * @type {import('preact/hooks')}
       */
      const { useState, useEffect } = getHtmPreact();
      const [state, setState] = useState(getter || (() => null));
      useEffect(() => {
        const off = this.on(event, (...args) => {
          if (getter) {
            const next = getter?.(...args);
            setState(next);
          } else {
            // state 只用第一个值
            setState(args[0]);
          }
        });
        return () => off();
      }, []);
      return state;
    }
  }
  // #endregion

  // #region 配置管理
  class Config {
    static defaults = {
      filename_template: "`${nickname}_${short_id}_${tags}_${desc}`",
    };
    static global = new Config();

    /**
     * @type {Emitter<{
     *    config_change: []
     * }>}
     */
    events = new Emitter();

    features = {
      /**
       * 下载视频分辨率策略
       * 可以选默认，最高清晰度，最小清晰度，和一些其他预设分辨率
       *
       * @type {"default" | "max" | "min" | "1080P" | "720P" | "360P" | "2K" | "4K" | "max_file" | "min_file"}
       */
      download_video_mode: "default",
      /**
       * 文件名模板
       *
       *
       */
      filename_template: Config.defaults.filename_template,
      /**
       * 最大文件名长度
       */
      filename_max_length: 64,
      /**
       * 视频下载编码偏好
       *
       * 1. 默认，无偏好 "default"
       * 2. 只下载 h264 "h264"
       * 3. 只下载 h265 "h265"
       * 4. 优先 h264 "h264_prefer"
       * 5. 优先 h265 "h265_prefer"
       */
      video_download_codecs: "default",
      /**
       * 图片转码编码偏好
       *
       * 1. 默认，无偏好 "default"
       * 2. 转码为 png "png"
       * 3. 转码为 jpg "jpg"
       * 4. 转码为 webp "webp"
       */
      image_convert_codecs: "default",
      /**
       * 图片尺寸压缩偏好
       *
       * 1. 默认，无偏好 "default"
       * 2. 最大边小于 2k "2k_max"
       * 3. 最大边小于 1k "1k_max"
       * 4. 最大边小于 960 "960_max"
       * 5. 最大边小于 640 "640_max"
       * 5. 最大边小于 512 "512_max"
       */
      image_resize_codecs: "default",
      /**
       * 图片压缩率 必须开启转码或者尺寸压缩才有用
       *
       * 默认 80
       * 推荐 60 以上
       */
      image_quality: 80,
      /**
       * 使用什么下载器 默认为使用浏览器下载，可以配置其他下载
       *
       * @type {"browser" | "abdm" | "aria2"}
       */
      using_downloader: "browser",
      /**
       * 下载器配置
       *
       * 不同下载器有不同的配置
       */
      downloader_config: {
        browser: {
          /**
           * 浏览器下载模式：
           * auto        Chrome/Chromium 文件系统流式 -> GM_download -> 原生直链 -> Blob
           * file_system 强制优先文件系统流式，不支持时仍自动兜底
           * gm_download Tampermonkey 下载接口优先
           * native      浏览器原生直链
           * blob        旧版 Blob 兼容模式
           */
          mode: "auto",
        },
        abdm: {
          dir: {
            // 不同类型的下载地址
            video: "`./douyin/${user_dir}/videos`",
            image: "`./douyin/${user_dir}/images`",
            other: "`./douyin/${user_dir}/others`",
          },
          domain: "http://localhost",
          port: "15151",
        },
        aria2: {
          dir: {
            // 不同类型的下载地址
            video: "`./douyin/${user_dir}/videos`",
            image: "`./douyin/${user_dir}/images`",
            other: "`./douyin/${user_dir}/others`",
          },
          domain: "http://localhost",
          port: "6800",
          path: "/jsonrpc",
          token: "",
        },
      },
      /**
       * 是否开启作者页面下载器
       *
       * 默认关闭
       */
      enable_profile_downloader: false,
    };

    _key = "__douyin-dl-user-js__";

    constructor() {
      try {
        this.load();
      } catch (error) {
        console.error(error);
      }
    }

    toJSON() {
      return {
        features: this.features,
      };
    }

    load() {
      if (localStorage.getItem(this._key)) {
        const data = JSON.parse(localStorage.getItem(this._key));
        this.features = {
          ...this.features,
          ...data.features,
        };

        // V1.0.0：旧 convert_webp_to_png 已由 image_convert_codecs 完全取代。
        delete this.features.convert_webp_to_png;

        // V1.0.4：旧配置可能没有 browser 节点，做深层默认合并。
        this.features.downloader_config = {
          abdm: this.features.downloader_config?.abdm || {},
          aria2: this.features.downloader_config?.aria2 || {},
          ...(this.features.downloader_config || {}),
          browser: {
            mode: "auto",
            ...(this.features.downloader_config?.browser || {}),
          },
        };
      }
    }

    save() {
      localStorage.setItem(this._key, JSON.stringify(this.toJSON()));
      this.events.emit("config_change");
    }

    clone_features() {
      return JSON.parse(JSON.stringify(this.features));
    }
  }
  // #endregion

  // #region 下载历史管理
  class DownloadHistory {
    static STORAGE_KEY = "__douyin-dl-history__";
    static MAX_ITEMS = 50; // 最多保存50条记录

    static get() {
      try {
        const data = localStorage.getItem(this.STORAGE_KEY);
        return data ? JSON.parse(data) : [];
      } catch {
        return [];
      }
    }

    static add(media, downloadTime = Date.now()) {
      const history = this.get();
      const coverUrl =
        media?.video?.originCoverUrlList?.[1] ||
        media?.video?.originCoverUrlList?.[0] ||
        media?.video?.cover?.urlList?.[0] ||
        media?.cover?.urlList?.[0] ||
        media?.images?.[0]?.urlList?.[0] ||
        "";
      const record = {
        id: media.awemeId || `hist_${Date.now()}_${Math.random()}`,
        desc: media.desc || "(无描述)",
        shareUrl: media.shareInfo?.shareUrl || "",
        downloadTime,
        coverUrl,
        authorNickname: media.authorInfo?.nickname || "",
        mediaType: Array.isArray(media.images) && media.images.length ? "album" : "video",
        media: {
          // 仅保存历史列表显示所需的最小字段，避免 localStorage 体积膨胀。
          awemeId: media.awemeId,
          desc: media.desc,
          shareUrl: media.shareInfo?.shareUrl,
          authorNickname: media.authorInfo?.nickname,
          coverUrl,
          mediaType: Array.isArray(media.images) && media.images.length ? "album" : "video",
        },
      };
      history.unshift(record); // 最新在前
      if (history.length > this.MAX_ITEMS) history.pop();
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
      return record;
    }

    static clear() {
      localStorage.removeItem(this.STORAGE_KEY);
    }
  }
  // #endregion

  class ProfileDownloadState {
    static STORAGE_PREFIX = "__douyin-dl-profile-state__:";

    static _storage_key(profileKey) {
      return `${this.STORAGE_PREFIX}${profileKey}`;
    }

    static create_default(profile = {}) {
      return {
        version: 2,
        /** @type {string} */
        profileKey: profile.profileKey || "",
        /** @type {string} */
        secUid: profile.secUid || "",
        /** @type {string} */
        profileName: profile.profileName || "",
        /** @type {string} */
        tabKey: profile.tabKey || "post",
        status: "idle",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastRunAt: 0,
        completedAt: 0,
        /** @type {string[]} */
        knownIds: [],
        /** @type {string[]} */
        downloadedIds: [],
        /** 外部下载器/原生直链已接受，但脚本无法确认最终完成的任务 */
        submittedItems: {},
        /** @type {Record<string, object>} */
        failedItems: {},
      };
    }

    static load(profileKey, profile = {}) {
      try {
        const raw = localStorage.getItem(this._storage_key(profileKey));
        if (!raw) {
          return this.create_default({
            ...profile,
            profileKey,
          });
        }
        const parsed = JSON.parse(raw);
        return {
          ...this.create_default({
            ...profile,
            profileKey,
          }),
          ...parsed,
          profileKey,
          secUid: profile.secUid || parsed.secUid || "",
          profileName: profile.profileName || parsed.profileName || "",
          tabKey: profile.tabKey || parsed.tabKey || "post",
          knownIds: Array.isArray(parsed.knownIds) ? parsed.knownIds : [],
          downloadedIds: Array.isArray(parsed.downloadedIds)
            ? parsed.downloadedIds
            : [],
          submittedItems:
            parsed.submittedItems && typeof parsed.submittedItems === "object"
              ? parsed.submittedItems
              : {},
          failedItems:
            parsed.failedItems && typeof parsed.failedItems === "object"
              ? parsed.failedItems
              : {},
        };
      } catch (error) {
        console.error("[dy-dl]加载作者下载状态失败", error);
        return this.create_default({
          ...profile,
          profileKey,
        });
      }
    }

    static save(profileKey, state) {
      const nextState = {
        ...state,
        updatedAt: Date.now(),
      };
      localStorage.setItem(
        this._storage_key(profileKey),
        JSON.stringify(nextState)
      );
      return nextState;
    }

    static reset(profileKey) {
      localStorage.removeItem(this._storage_key(profileKey));
    }
  }

  // #region 图片转码压缩
  /**
   * @typedef {"default"|"png"|"jpg"|"webp"} ImageConvertCodecs
   * @typedef {"default"|"2k_max"|"1k_max"|"960_max"|"640_max"|"512_max"} ImageResizeCodecs
   *
   * @typedef {Object} ImageConfig
   * @property {ImageConvertCodecs} image_convert_codecs
   * @property {ImageResizeCodecs} image_resize_codecs
   * @property {number} image_quality
   */

  class ImageProcessor {
    /**
     * @param {Partial<ImageConfig>} config
     */
    constructor(config = {}) {
      /** @type {ImageConfig} */
      this.config = Object.assign(
        {
          image_convert_codecs: "default",
          image_resize_codecs: "default",
          image_quality: 80,
        },
        config
      );

      this.resizeMap = {
        "2k_max": 2048,
        "1k_max": 1024,
        "960_max": 960,
        "640_max": 640,
        "512_max": 512,
      };
    }

    /**
     * 根据配置判断是否需要压缩转码
     * @param {number} width
     * @param {number} height
     * @returns {boolean}
     */
    is_need_convert(width, height) {
      const { image_convert_codecs, image_resize_codecs } = this.config;
      const need_format = image_convert_codecs !== "default";
      const resize_target = this.resizeMap[image_resize_codecs] ?? Infinity;
      const need_resize = width > resize_target || height > resize_target;
      return need_format || need_resize;
    }

    /**
     * 主入口
     * @param {File|Blob} file
     * @returns {Promise<{blob:Blob,outputType:string}>}
     */
    async process(file) {
      const bitmap = await createImageBitmap(file);

      try {
        let { width, height } = bitmap;

        if (!this.is_need_convert(width, height)) {
          return { blob: file, outputType: file.type || "application/octet-stream" };
        }

        // 1. resize
        ({ width, height } = this._resize(width, height));

        const canvas = this._createCanvas(width, height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("浏览器无法创建图片处理画布");

        const outputType = this._getOutputType(file.type);

        // 2. 透明背景处理
        if (outputType === "image/jpeg") {
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, width, height);
        }

        ctx.drawImage(bitmap, 0, 0, width, height);

        // 3. encode
        const blob = await this._toBlob(canvas, outputType);
        return { blob, outputType };
      } finally {
        // 批量处理图集时及时释放 GPU/位图内存。
        bitmap.close?.();
      }
    }

    /**
     * resize 逻辑
     * @private
     */
    _resize(width, height) {
      const mode = this.config.image_resize_codecs;
      const maxEdge = this.resizeMap[mode];

      if (!maxEdge) return { width, height };

      const scale = Math.min(1, maxEdge / Math.max(width, height));

      return {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
      };
    }

    /**
     * canvas 创建（兼容 fallback）
     * @private
     */
    _createCanvas(width, height) {
      if (typeof OffscreenCanvas !== "undefined") {
        return new OffscreenCanvas(width, height);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }

    /**
     * 输出格式决策
     * @private
     */
    _getOutputType(inputType) {
      const codec = this.config.image_convert_codecs;

      if (codec === "png") return "image/png";
      if (codec === "jpg") return "image/jpeg";
      if (codec === "webp") return "image/webp";

      // default 策略
      if (inputType === "image/png") return "image/png";
      if (inputType === "image/webp") return "image/webp";

      return "image/jpeg";
    }

    /**
     * 质量归一化
     * @private
     */
    _normalizeQuality() {
      const q = this.config.image_quality;
      if (!q) return 0.8;
      return Math.min(1, Math.max(0.1, q / 100));
    }

    /**
     * toBlob 封装（兼容 HTMLCanvas）
     * @private
     */
    _toBlob(canvas, type) {
      const quality = this._normalizeQuality();

      // OffscreenCanvas
      if (canvas.convertToBlob) {
        return canvas.convertToBlob({ type, quality });
      }

      // HTMLCanvas fallback
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("图片编码失败，浏览器未返回有效文件"));
        }, type, quality);
      });
    }
  }
  // #endregion

  // V1.0.0：已删除未启用的 XhrInterceptor / AwemeHub 历史代码。

  // #region 下载器
  class Downloader {
    constructor() {}

    _getWindowFunction(name) {
      const candidates = [];
      try {
        if (typeof unsafeWindow !== "undefined") candidates.push(unsafeWindow);
      } catch {}
      candidates.push(window);

      for (const target of candidates) {
        try {
          const fn = target?.[name];
          if (typeof fn === "function") return fn.bind(target);
        } catch {}
      }
      return null;
    }

    _getGMDownload() {
      try {
        if (typeof GM_download === "function") return GM_download;
      } catch {}
      try {
        if (typeof GM !== "undefined" && typeof GM.download === "function") {
          return GM.download.bind(GM);
        }
      } catch {}
      return null;
    }

    _isUserCancelled(error) {
      return Boolean(
        error &&
          (error.name === "AbortError" ||
            /cancel|abort/i.test(String(error.message || error)))
      );
    }

    _browserMode() {
      return (
        Config.global.features.downloader_config?.browser?.mode || "auto"
      );
    }

    _needsImagePostprocess() {
      const features = Config.global.features;
      return (
        (features.image_convert_codecs || "default") !== "default" ||
        (features.image_resize_codecs || "default") !== "default"
      );
    }

    _guessMeta(url, filenameInput = "", options = {}) {
      let parsed = null;
      try {
        parsed = new URL(url, location.href);
      } catch {}

      const urlPath = parsed?.pathname || "";
      const urlExt = (urlPath.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();
      const fileKind = options.fileKind ||
        (options.media?.images?.length ? "image" : "video");
      const isImage =
        fileKind === "image" ||
        (!/^(?:audio|video)$/i.test(fileKind) &&
          /^(?:jpg|jpeg|png|webp|gif|avif)$/i.test(urlExt));
      const isAudio =
        fileKind === "audio" ||
        (!/^(?:image|video)$/i.test(fileKind) &&
          /^(?:mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(urlExt));
      const isVideo =
        fileKind === "video" ||
        (!/^(?:audio|image)$/i.test(fileKind) &&
          /^(?:mp4|mov|m4v|webm)$/i.test(urlExt));

      let ext = urlExt;
      let mime = "application/octet-stream";

      if (isImage) {
        const convert = Config.global.features.image_convert_codecs || "default";
        if (convert === "png") ext = "png";
        else if (convert === "jpg") ext = "jpeg";
        else if (convert === "webp") ext = "webp";
        else if (!/^(?:jpg|jpeg|png|webp|gif|avif)$/i.test(ext)) ext = "webp";

        mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      } else if (isAudio) {
        const audioMeta = resolveAudioFileMeta(
          options.forcedMime || "",
          url,
          options.forcedExtension || urlExt || "m4a"
        );
        ext = audioMeta.ext;
        mime = audioMeta.mime;
      } else if (isVideo) {
        if (!/^(?:mp4|mov|m4v|webm)$/i.test(ext)) ext = "mp4";
        mime = ext === "webm" ? "video/webm" : "video/mp4";
      } else if (!ext) {
        ext = "bin";
      }

      let base = normalizeFilename(filenameInput || urlPath.split("/").pop() || "download");
      base = base.replace(/\.[^/.]+$/, "");
      const filename = normalizeFilename(`${base}.${ext}`);

      return {
        filename,
        filename_base: base,
        ext,
        mime,
        isImage,
        isVideo,
        isAudio,
      };
    }

    _createProgressEmitter(options, meta, method) {
      const state = {
        startedAt: performance.now(),
        lastLoaded: 0,
        lastAt: performance.now(),
        lastEmitAt: 0,
      };

      const emit = (partial = {}, force = false) => {
        const now = performance.now();
        const loaded = Number(partial.loaded || 0);
        const total = Number(partial.total || 0);
        const deltaBytes = Math.max(0, loaded - state.lastLoaded);
        const deltaSeconds = Math.max(0.001, (now - state.lastAt) / 1000);
        const suppressRate = Boolean(partial.suppressRate) || partial.phase === "validating_resume";
        const speed = suppressRate
          ? 0
          : Number.isFinite(partial.speed)
          ? partial.speed
          : deltaBytes > 0
          ? deltaBytes / deltaSeconds
          : 0;
        const eta = suppressRate
          ? NaN
          : Number.isFinite(partial.eta)
          ? partial.eta
          : total > loaded && speed > 0
          ? (total - loaded) / speed
          : NaN;
        const percent = Number.isFinite(partial.percent)
          ? partial.percent
          : total > 0
          ? (loaded / total) * 100
          : NaN;

        const phase = partial.phase || "downloading";
        const payload = {
          filename: meta.filename,
          method,
          phase,
          status:
            options.progressLabels?.[phase] ||
            partial.status ||
            "正在下载",
          loaded,
          total,
          speed,
          eta,
          percent,
          taskIndex: options.taskIndex || 0,
          taskTotal: options.taskTotal || 0,
          batch: Boolean(options.batch),
          attempt: Number(partial.attempt || 0),
          resumeAvailable: Boolean(partial.resumeAvailable),
          resumeCapability: partial.resumeCapability || "",
          hasTransferData: Boolean(partial.hasTransferData),
          media: options.media || null,
        };

        if (!force && now - state.lastEmitAt < 220) return;
        state.lastEmitAt = now;
        state.lastLoaded = loaded;
        state.lastAt = now;

        try {
          options.onProgress?.(payload);
        } catch (error) {
          console.warn("[dy-dl]进度回调异常：", error);
        }

        if (options.showGlobalProgress !== false) {
          DownloadProgressCenter.update(payload, force);
        }
      };

      const setCancel = (handler) => {
        DownloadRuntime.setCancel(handler);
        try {
          options.onCancelReady?.(handler);
        } catch {}
        if (options.showGlobalProgress !== false) {
          DownloadProgressCenter.setCancel(handler);
        }
      };

      const clearCancel = (handler) => {
        DownloadRuntime.clearCancel(handler);
        if (options.showGlobalProgress !== false) {
          DownloadProgressCenter.setCancel(null);
        }
      };

      const reset = (baseLoaded = 0) => {
        const now = performance.now();
        state.startedAt = now;
        state.lastLoaded = Number(baseLoaded || 0);
        state.lastAt = now;
        state.lastEmitAt = 0;
      };

      return { emit, setCancel, clearCancel, reset };
    }

    async get_headers(url) {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          credentials: "same-origin",
        });
        return response.headers;
      } catch {
        return new Headers();
      }
    }

    async prepare_filename(dl_url, filename_input = "", options = {}) {
      if (dl_url.startsWith("//")) {
        dl_url = `${window.location.protocol}${dl_url}`;
      }

      const guessed = this._guessMeta(dl_url, filename_input, options);
      const headers = await this.get_headers(dl_url);
      const content_disposition = headers.get("content-disposition") || "";
      const content_type = headers.get("content-type") || guessed.mime;
      const content_length = headers.get("content-length") || "";
      const imagex_fmt = headers.get("Imagex-Fmt") || "";
      const isImage =
        guessed.isImage ||
        (!guessed.isAudio && (!!imagex_fmt || content_type.startsWith("image/")));
      const isVideo =
        guessed.isVideo ||
        (!guessed.isAudio && content_type.startsWith("video/"));
      const isAudio = guessed.isAudio || content_type.startsWith("audio/");
      const isWebP =
        imagex_fmt.includes("2webp") ||
        dl_url.includes(".webp") ||
        content_type.includes("webp");

      let determinedFileExt = guessed.ext;
      if (isAudio) {
        determinedFileExt = resolveAudioFileMeta(
          content_type,
          dl_url,
          guessed.ext
        ).ext;
      }
      const dispositionMatch = content_disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
      if (dispositionMatch?.[1]) {
        try {
          const candidate = decodeURIComponent(dispositionMatch[1].replace(/^"|"$/g, ""));
          const ext = candidate.split(".").pop()?.toLowerCase();
          if (ext && /^[a-z0-9]{2,5}$/i.test(ext)) determinedFileExt = ext;
        } catch {}
      }

      let filename = guessed.filename;
      const filename_base = filename.replace(/\.[^/.]+$/, "");
      if (!new RegExp(`\\.${determinedFileExt}$`, "i").test(filename)) {
        filename = normalizeFilename(`${filename_base}.${determinedFileExt}`);
      }

      return {
        filename,
        ext: determinedFileExt,
        isImage,
        isVideo,
        isAudio,
        isWebP,
        headers,
        content_length,
        content_type,
        filename_base,
      };
    }

    async download_blob(blob, filename) {
      const link = document.createElement("a");
      link.style.display = "none";
      link.download = filename;
      link.href = URL.createObjectURL(blob);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    }

    async download_postprocess(blob, content_type) {
      if (content_type.startsWith("image/")) {
        const processor = new ImageProcessor(Config.global.clone_features());
        const { blob: new_blob, outputType } = await processor.process(blob);
        return { blob: new_blob, output_type: outputType };
      }
      return { blob, output_type: content_type };
    }

    /**
     * Chrome/Chromium 批量下载目录选择。
     * 必须直接由用户点击调用；取消属于用户意图，不自动降级偷偷下载。
     */
    async prepareBrowserBatchContext(options = {}) {
      if (Config.global.features.using_downloader !== "browser") {
        return { kind: "external", batch: true };
      }

      const mode = this._browserMode();
      if (mode !== "auto" && mode !== "file_system") {
        return { kind: "fallback", batch: true };
      }

      const picker = this._getWindowFunction("showDirectoryPicker");
      if (!picker) return { kind: "fallback", batch: true };

      let retrySensitiveDirectory = true;
      while (true) {
        try {
          const handle = await picker({
            id: "douyin-dl-batch-directory",
            mode: "readwrite",
            // 仅作为打开位置提示；Chrome 仍可能禁止直接授权桌面根目录。
            startIn: "desktop",
          });
          return { kind: "directory", directoryHandle: handle, batch: true };
        } catch (error) {
          if (this._isUserCancelled(error)) {
            return { kind: "cancelled", cancelled: true, batch: true };
          }

          const message = String(error?.message || error || "");
          const sensitiveDirectory =
            error?.name === "NotAllowedError" ||
            /system file|系统文件|sensitive|not allowed|permission/i.test(message);

          if (sensitiveDirectory) {
            const retry =
              retrySensitiveDirectory &&
              (await ProductDialog.open({
                icon: "warning",
                title: "这个目录不能直接写入",
                message: "Chrome 不允许网页写入桌面根目录或其它敏感系统目录。",
                detail: "请先在桌面新建一个普通子文件夹（例如“抖音下载”），再重新选择；也可以改用浏览器默认下载目录。",
                primaryLabel: "重新选择目录",
                secondaryLabel: "使用默认目录",
              }));
            retrySensitiveDirectory = false;
            if (retry) continue;

            createToast(null).update(
              "已改用浏览器默认下载目录；如需桌面保存，请选择桌面的普通子文件夹",
              3500
            );
            return { kind: "fallback", batch: true, sensitiveDirectory: true, error };
          }

          console.warn("[dy-dl]目录选择不可用，自动降级：", error);
          createToast(null).update("目录授权失败，已改用浏览器默认下载目录", 2600);
          return { kind: "fallback", batch: true, error };
        }
      }
    }

    async _readChunkWithWatch(reader, progress, signal, loaded, total) {
      let warnTimer = 0;
      let reconnectTimer = 0;

      const readPromise = reader.read();
      const timeoutPromise = new Promise((_, reject) => {
        warnTimer = setTimeout(() => {
          progress.emit(
            {
              phase: "waiting_data",
              status: "网络暂无数据，仍在等待服务器",
              loaded,
              total,
            },
            true
          );
        }, DownloadRecoveryPolicy.NO_DATA_WARN_MS);

        reconnectTimer = setTimeout(() => {
          reject(new DownloadStallError());
          try {
            reader.cancel("stalled");
          } catch {}
        }, DownloadRecoveryPolicy.NO_DATA_RECONNECT_MS);
      });

      if (signal?.aborted) {
        clearTimeout(warnTimer);
        clearTimeout(reconnectTimer);
        throw new DOMException("已取消", "AbortError");
      }

      try {
        return await Promise.race([readPromise, timeoutPromise]);
      } finally {
        clearTimeout(warnTimer);
        clearTimeout(reconnectTimer);
      }
    }

    async _readResponseToChunks(response, progress, signal) {
      const reader = response.body?.getReader?.();
      const total = Number(response.headers.get("content-length") || 0);
      const chunks = [];
      let loaded = 0;

      if (!reader) {
        const blob = await response.blob();
        progress.emit({ loaded: blob.size, total: blob.size }, true);
        return { blob, loaded: blob.size, total: blob.size };
      }

      while (true) {
        if (signal?.aborted) throw new DOMException("已取消", "AbortError");
        const { done, value } = await this._readChunkWithWatch(
          reader,
          progress,
          signal,
          loaded,
          total
        );
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        progress.emit({ loaded, total, hasTransferData: true });
      }

      return {
        blob: new Blob(chunks, {
          type:
            response.headers.get("content-type") ||
            "application/octet-stream",
        }),
        loaded,
        total,
      };
    }

    async _streamResponseToWriter(
      response,
      writer,
      progress,
      signal,
      options = {}
    ) {
      const reader = response.body?.getReader?.();
      const remainingTotal = Number(
        response.headers.get("content-length") || 0
      );
      const baseLoaded = Number(options.baseLoaded || 0);
      const total = Number(options.total || 0) ||
        (remainingTotal > 0 ? baseLoaded + remainingTotal : 0);
      let loaded = baseLoaded;

      if (!reader) {
        const blob = await response.blob();
        await writer.write(blob);
        loaded += blob.size;
        options.onCheckpoint?.(loaded);
        progress.emit({ loaded, total: total || loaded, hasTransferData: true }, true);
        return { loaded, total: total || loaded };
      }

      while (true) {
        if (signal?.aborted) throw new DOMException("已取消", "AbortError");
        const { done, value } = await this._readChunkWithWatch(
          reader,
          progress,
          signal,
          loaded,
          total
        );
        if (done) break;

        await writer.write(value);
        loaded += value.byteLength;
        options.onCheckpoint?.(loaded);
        progress.emit({ loaded, total, hasTransferData: true });
      }

      return { loaded, total };
    }

    async _downloadViaFileSystem(url, meta, options) {
      const progress = this._createProgressEmitter(
        options,
        meta,
        "file_system"
      );
      let fileHandle =
        options.__fileHandle ||
        options.__resumeState?.fileHandle ||
        null;

      if (!fileHandle) {
        try {
          if (options.browserContext?.directoryHandle) {
            fileHandle =
              await options.browserContext.directoryHandle.getFileHandle(
                meta.filename,
                { create: true }
              );
          } else {
            const picker = this._getWindowFunction("showSaveFilePicker");
            if (!picker) {
              return {
                ok: false,
                unavailable: true,
                method: "file_system",
              };
            }

            // 先弹保存框，再开始网络下载。
            fileHandle = await picker({
              id: "douyin-dl-single-file",
              suggestedName: meta.filename,
              types: [
                {
                  description: meta.isVideo
                    ? "视频文件"
                    : meta.isImage
                    ? "图片文件"
                    : meta.isAudio
                    ? "音频文件"
                    : "文件",
                  accept: {
                    [meta.mime]: [`.${meta.ext}`],
                  },
                },
              ],
              excludeAcceptAllOption: false,
            });
          }

          options.__fileHandle = fileHandle;
        } catch (error) {
          if (this._isUserCancelled(error)) {
            const payload = {
              filename: meta.filename,
              method: "file_system",
              phase: "cancelled",
              status: "已取消",
            };
            progress.emit(payload, true);
            if (options.showGlobalProgress !== false) {
              DownloadProgressCenter.finish(payload);
            }
            return {
              ok: false,
              cancelled: true,
              method: "file_system",
              reason: "user_cancelled",
            };
          }

          return {
            ok: false,
            unavailable: true,
            method: "file_system",
            error,
          };
        }
      }

      const controller = new AbortController();
      const cancel = (mode = "cancel") => {
        options.__abortMode = mode;
        controller.abort();
      };
      progress.setCancel(cancel);

      let writer = null;
      let response = null;
      let currentLoaded = 0;
      let expectedTotal = 0;
      let committedPartial = false;
      let responseEtag = "";
      let responseLastModified = "";

      const forceRestartCurrent = Boolean(options.__forceRestartCurrent);
      const originalResume =
        options.__resumeState?.fileHandle === fileHandle
          ? options.__resumeState
          : null;

      // “重新下载当前文件”只清除当前文件的断点上下文，保留目录和 FileHandle。
      if (forceRestartCurrent) {
        options.__resumeState = null;
        options.__forceRestartCurrent = false;
      }

      const previousResume = forceRestartCurrent ? null : originalResume;
      const canAttemptResume =
        Boolean(previousResume?.offset > 0) &&
        Boolean(previousResume?.etag || previousResume?.lastModified) &&
        !meta.isImage &&
        !this._needsImagePostprocess();

      let resumeOffset = canAttemptResume
        ? Number(previousResume.offset || 0)
        : 0;

      currentLoaded = resumeOffset;
      expectedTotal = Number(previousResume?.total || 0);

      try {
        const headers = new Headers();
        let baseLoaded = 0;
        let totalOverride = 0;

        const makePausedResumeResult = async ({
          capability,
          status,
          reason,
          httpStatus = 0,
        }) => {
          try { await response?.body?.cancel?.(); } catch {}

          const resumeState = previousResume
            ? {
                ...previousResume,
                fileHandle,
                url,
                capability,
                updatedAt: Date.now(),
              }
            : null;
          options.__resumeState = resumeState;

          const payload = {
            filename: meta.filename,
            method: "file_system",
            phase: "paused",
            status,
            loaded: Number(previousResume?.offset || currentLoaded || 0),
            total: Number(previousResume?.total || expectedTotal || 0),
            speed: 0,
            eta: NaN,
            suppressRate: true,
            resumeAvailable: capability === "supported",
            resumeCapability: capability,
          };
          progress.emit(payload, true);

          return {
            ok: false,
            cancelled: true,
            paused: true,
            method: "file_system",
            reason,
            message: status,
            httpStatus,
            loaded: payload.loaded,
            total: payload.total,
            resumeAvailable: capability === "supported",
            resumeCapability: capability,
            retryContext: {
              __fileHandle: fileHandle,
              __resumeState: resumeState,
              __browserMethod: "file_system",
            },
          };
        };

        if (resumeOffset > 0) {
          const validator = previousResume.etag || previousResume.lastModified || "";
          if (!validator) {
            return await makePausedResumeResult({
              capability: "unsupported",
              reason: "resume_validator_missing",
              status: "当前服务器未提供可验证的文件标识，无法安全续传",
            });
          }

          headers.set("Range", `bytes=${resumeOffset}-`);
          headers.set("If-Range", validator);
          progress.emit(
            {
              phase: "validating_resume",
              status: `正在检查服务器是否支持断点续传（已保留 ${DownloadFormat.bytes(resumeOffset)}）`,
              loaded: resumeOffset,
              total: Number(previousResume.total || 0),
              speed: 0,
              eta: NaN,
              suppressRate: true,
              resumeCapability: "checking",
            },
            true
          );

          const validationController = new AbortController();
          const relayAbort = () => validationController.abort(controller.signal.reason);
          controller.signal.addEventListener("abort", relayAbort, { once: true });
          let validationTimedOut = false;
          const validationTimer = setTimeout(() => {
            validationTimedOut = true;
            validationController.abort(new DOMException("续传检查超时", "TimeoutError"));
          }, 8000);

          try {
            response = await fetch(url, {
              signal: validationController.signal,
              credentials: "same-origin",
              headers,
            });
          } catch (error) {
            if (validationTimedOut) {
              return await makePausedResumeResult({
                capability: "network_unavailable",
                reason: "resume_validation_timeout",
                status: "续传检查超时，已保持暂停；请稍后重新检查",
              });
            }
            throw error;
          } finally {
            clearTimeout(validationTimer);
            controller.signal.removeEventListener("abort", relayAbort);
          }

          if (response.status === 416) {
            const range = response.headers.get("content-range") || "";
            const totalMatch = range.match(/\*\/(\d+)$/);
            const remoteTotal = Number(totalMatch?.[1] || 0);
            if (remoteTotal > 0 && resumeOffset >= remoteTotal) {
              options.__resumeState = null;
              const payload = {
                filename: meta.filename,
                method: "file_system",
                phase: "completed",
                status: "文件已完整下载",
                loaded: remoteTotal,
                total: remoteTotal,
                percent: 100,
              };
              progress.emit(payload, true);
              if (options.showGlobalProgress !== false) DownloadProgressCenter.finish(payload);
              return { ok: true, completed: true, method: "file_system", filename: meta.filename };
            }
            return await makePausedResumeResult({
              capability: "invalid_range",
              reason: "resume_range_invalid",
              status: "服务器返回的断点范围无效，无法安全继续",
              httpStatus: 416,
            });
          }

          if (response.status === 200) {
            return await makePausedResumeResult({
              capability: "unsupported",
              reason: "resume_unsupported",
              status: "服务器不支持此文件断点续传，请重新下载当前文件",
              httpStatus: 200,
            });
          }

          if (!response.ok) throw new DownloadHttpError(response, url);

          if (response.status !== 206) {
            return await makePausedResumeResult({
              capability: "unsupported",
              reason: "resume_unverified_response",
              status: `服务器未返回有效的断点响应（HTTP ${response.status}）`,
              httpStatus: response.status,
            });
          }

          const range = response.headers.get("content-range") || "";
          const match = range.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
          const start = Number(match?.[1] ?? -1);
          const remoteTotal = match?.[3] && match[3] !== "*" ? Number(match[3]) : 0;
          if (!match || start !== resumeOffset) {
            return await makePausedResumeResult({
              capability: "invalid_range",
              reason: "resume_range_mismatch",
              status: "服务器返回的断点位置与本地文件不一致，无法安全继续",
              httpStatus: 206,
            });
          }

          baseLoaded = resumeOffset;
          totalOverride = remoteTotal || resumeOffset + Number(response.headers.get("content-length") || 0);
          options.__resumeState = {
            ...previousResume,
            capability: "supported",
            updatedAt: Date.now(),
          };

          // 续传连接确认后重新建立速度采样基线，避免把暂停前累计字节算成瞬时速度。
          progress.reset(resumeOffset);
        } else {
          progress.emit({ phase: "connecting", status: "正在连接", speed: 0, eta: NaN }, true);
          response = await fetch(url, {
            signal: controller.signal,
            credentials: "same-origin",
            headers,
          });
          if (!response.ok) throw new DownloadHttpError(response, url);
        }

        writer = await fileHandle.createWritable({
          keepExistingData: resumeOffset > 0,
        });

        if (resumeOffset > 0) {
          await writer.seek(resumeOffset);
        } else {
          await writer.truncate(0);
          await writer.seek(0);
        }

        const contentType =
          response.headers.get("content-type") ||
          meta.mime;
        const shouldProcessImage =
          contentType.startsWith("image/") &&
          this._needsImagePostprocess();

        let transfer = {
          loaded: baseLoaded,
          total: totalOverride,
        };

        responseEtag =
          response.headers.get("etag") ||
          previousResume?.etag ||
          "";
        responseLastModified =
          response.headers.get("last-modified") ||
          previousResume?.lastModified ||
          "";

        if (shouldProcessImage) {
          // 图片转码必须获得完整原图，不能用部分文件续传。
          progress.emit(
            {
              phase: "downloading",
              status: "正在下载图片",
            },
            true
          );

          const read = await this._readResponseToChunks(
            response,
            progress,
            controller.signal
          );

          currentLoaded = read.loaded;

          progress.emit(
            {
              phase: "processing",
              status: "正在处理图片",
              loaded: read.loaded,
              total: read.total || read.loaded,
            },
            true
          );

          const processed = await this.download_postprocess(
            read.blob,
            contentType
          );

          progress.emit(
            {
              phase: "writing",
              status: "正在写入文件",
              loaded: read.loaded,
              total: read.total || read.loaded,
            },
            true
          );

          await writer.write(processed.blob);
          transfer = read;
        } else {
          progress.emit(
            {
              phase: "downloading",
              status:
                resumeOffset > 0
                  ? "正在继续下载"
                  : "正在下载",
              loaded: resumeOffset,
              total: totalOverride,
              resumeAvailable: resumeOffset > 0,
              resumeCapability: resumeOffset > 0 ? "supported" : "",
              hasTransferData: false,
            },
            true
          );

          currentLoaded = resumeOffset;

          transfer = await this._streamResponseToWriter(
            response,
            writer,
            progress,
            controller.signal,
            {
              baseLoaded: resumeOffset,
              total: totalOverride,
              onCheckpoint: (loaded) => {
                currentLoaded = loaded;
              },
            }
          );
        }

        expectedTotal =
          transfer.total ||
          transfer.loaded;

        await writer.close();
        writer = null;
        options.__resumeState = null;

        const payload = {
          filename: meta.filename,
          method: "file_system",
          phase: "completed",
          status: "下载完成",
          loaded: transfer.loaded,
          total: expectedTotal,
          percent: 100,
        };

        progress.emit(payload, true);

        if (options.showGlobalProgress !== false) {
          DownloadProgressCenter.finish(payload);
        }

        return {
          ok: true,
          completed: true,
          method: "file_system",
          filename: meta.filename,
        };
      } catch (error) {
        const classification =
          DownloadRecoveryPolicy.classify(error);

        if (this._isUserCancelled(error) && options.__abortMode === "pause") {
          // 暂停不是普通取消：尽量提交已经写入的部分文件，并保存当前会话续传信息。
          if (writer && currentLoaded > resumeOffset && !meta.isImage) {
            try {
              await writer.close();
              writer = null;
              options.__resumeState = {
                fileHandle,
                url,
                offset: currentLoaded,
                total:
                  expectedTotal ||
                  Number(previousResume?.total || 0) ||
                  (resumeOffset + Number(response?.headers?.get?.("content-length") || 0)),
                etag: responseEtag || previousResume?.etag || "",
                lastModified: responseLastModified || previousResume?.lastModified || "",
                updatedAt: Date.now(),
              };
            } catch (commitError) {
              console.warn("[dy-dl]暂停时保存部分文件失败：", commitError);
              try { await writer?.abort?.(commitError); } catch {}
              writer = null;
              options.__resumeState = null;
            }
          } else {
            try { await writer?.abort?.(error); } catch {}
            writer = null;
          }

          const hasResumeCandidate = Boolean(
            options.__resumeState?.offset > 0 &&
            (options.__resumeState?.etag || options.__resumeState?.lastModified)
          );
          if (hasResumeCandidate && options.__resumeState) {
            options.__resumeState.capability = "unknown";
          }
          const resumeCapability = hasResumeCandidate ? "unknown" : "unsupported";
          const payload = {
            filename: meta.filename,
            method: "file_system",
            phase: "paused",
            status: hasResumeCandidate
              ? "已暂停，尚未检查服务器是否支持断点续传"
              : "已暂停，当前资源无法安全断点续传",
            loaded: currentLoaded,
            total: expectedTotal,
            speed: 0,
            eta: NaN,
            suppressRate: true,
            resumeAvailable: false,
            resumeCapability,
          };
          progress.emit(payload, true);
          return {
            ok: false,
            cancelled: true,
            paused: true,
            method: "file_system",
            reason: "paused",
            loaded: currentLoaded,
            total: expectedTotal,
            resumeAvailable: false,
            resumeCapability,
            retryContext: {
              __fileHandle: fileHandle,
              __resumeState: options.__resumeState || null,
              __browserMethod: "file_system",
            },
          };
        }

        if (this._isUserCancelled(error)) {
          try { await writer?.abort?.(error); } catch {}
          const payload = {
            filename: meta.filename,
            method: "file_system",
            phase: "cancelled",
            status: "已取消",
            loaded: currentLoaded,
            total: expectedTotal,
          };
          progress.emit(payload, true);
          return { ok: false, cancelled: true, method: "file_system", reason: "cancelled" };
        }

        // 只有真正写入了一部分视频文件，才保存当前会话续传状态。
        // 网络错误/超时/无数据时关闭写入流，提交已写入部分；
        // 下次必须经过 206 + Content-Range 严格验证后才会追加。
        if (
          writer &&
          currentLoaded > resumeOffset &&
          !meta.isImage &&
          ["offline", "network", "timeout", "stalled", "server_busy"]
            .includes(classification.code)
        ) {
          try {
            await writer.close();
            committedPartial = true;
            writer = null;

            options.__resumeState = {
              fileHandle,
              url,
              offset: currentLoaded,
              total:
                expectedTotal ||
                Number(previousResume?.total || 0) ||
                (
                  resumeOffset +
                  Number(
                    response?.headers?.get?.(
                      "content-length"
                    ) || 0
                  )
                ),
              etag:
                responseEtag ||
                response?.headers?.get?.("etag") ||
                previousResume?.etag ||
                "",
              lastModified:
                responseLastModified ||
                response?.headers?.get?.("last-modified") ||
                previousResume?.lastModified ||
                "",
              capability: "unknown",
              updatedAt: Date.now(),
            };
          } catch (commitError) {
            console.warn(
              "[dy-dl]保存部分文件失败，无法续传：",
              commitError
            );
            try {
              await writer?.abort?.(commitError);
            } catch {}
            writer = null;
            options.__resumeState = null;
          }
        } else {
          try {
            await writer?.abort?.(error);
          } catch {}
          writer = null;
        }

        const result = {
          ok: false,
          retrySource: true,
          recoverable: classification.retryable,
          refreshable: classification.refreshable,
          unavailable: classification.unavailable,
          method: "file_system",
          error,
          reason: classification.code,
          message: classification.message,
          httpStatus:
            error?.httpStatus ||
            classification.status ||
            0,
          retryAfterMs:
            error?.retryAfterMs || 0,
          loaded: currentLoaded,
          total: expectedTotal,
          resumeAvailable:
            Boolean(
              committedPartial &&
                options.__resumeState?.offset > 0 &&
                (
                  options.__resumeState?.etag ||
                  options.__resumeState?.lastModified
                )
            ),
          resumeCapability:
            options.__resumeState?.capability ||
            (options.__resumeState?.offset > 0 ? "unknown" : "unsupported"),
          resumeState:
            options.__resumeState || null,
        };

        progress.emit(
          {
            phase: "failed",
            status:
              result.resumeCapability === "unknown"
                ? `${classification.message}；已保留部分文件，可在任务管理器中检查续传能力`
                : classification.message,
            loaded: currentLoaded,
            total: expectedTotal,
            resumeAvailable: false,
            resumeCapability: result.resumeCapability,
          },
          true
        );

        if (options.showGlobalProgress !== false) {
          DownloadProgressCenter.finish({
            filename: meta.filename,
            method: "file_system",
            phase: "failed",
            status:
              result.resumeCapability === "unknown"
                ? `${classification.message}；已保留部分文件，可在任务管理器中检查续传能力`
                : classification.message,
            loaded: currentLoaded,
            total: expectedTotal,
          });
        }

        return result;
      } finally {
        progress.clearCancel(cancel);
      }
    }

    async _downloadViaGM(url, meta, options) {
      const gmDownload = this._getGMDownload();
      if (!gmDownload) return { ok: false, unavailable: true, method: "gm_download" };

      const progress = this._createProgressEmitter(options, meta, "gm_download");
      progress.emit({ phase: "waiting", status: options.batch ? "正在提交浏览器下载" : "等待选择保存位置" }, true);

      return new Promise((resolve) => {
        let handle = null;
        let settled = false;

        const finish = (result) => {
          if (settled) return;
          settled = true;
          progress.clearCancel(cancel);
          resolve(result);
        };

        const cancel = (mode = "cancel") => {
          options.__abortMode = mode;
          try { handle?.abort?.(); } catch {}
          if (options.showGlobalProgress !== false) {
            DownloadProgressCenter.finish({
              filename: meta.filename,
              method: "gm_download",
              phase: "failed",
              status: "已取消",
            });
          }
          finish({ ok: false, cancelled: true, paused: options.__abortMode === "pause", method: "gm_download", reason: options.__abortMode === "pause" ? "paused" : "cancelled" });
        };

        progress.setCancel(cancel);

        try {
          handle = gmDownload({
            url,
            name: meta.filename,
            saveAs: !options.batch,
            conflictAction: "uniquify",
            onprogress: (event) => {
              const loaded = Number(event?.loaded || event?.done || 0);
              const total = Number(event?.total || event?.totalSize || 0);
              progress.emit({
                phase: "downloading",
                status: "正在下载",
                loaded,
                total,
              });
            },
            onload: () => {
              progress.emit({
                phase: "completed",
                status: "下载完成",
                percent: 100,
              }, true);
              if (options.showGlobalProgress !== false) DownloadProgressCenter.finish({
                filename: meta.filename,
                method: "gm_download",
                phase: "completed",
                status: "下载完成",
                percent: 100,
              });
              finish({ ok: true, completed: true, method: "gm_download", filename: meta.filename });
            },
            onerror: (error) => {
              const message = String(error?.error || error?.details || error || "");
              if (/cancel|abort/i.test(message)) {
                if (options.showGlobalProgress !== false) {
                  DownloadProgressCenter.finish({
                    filename: meta.filename,
                    method: "gm_download",
                    phase: "failed",
                    status: "已取消",
                  });
                }
                finish({ ok: false, cancelled: true, method: "gm_download", reason: "cancelled" });
                return;
              }
              const unavailable = /not_enabled|not_whitelisted|not_permitted|not_supported|disabled/i.test(message);
              finish({ ok: false, unavailable, retrySource: !unavailable, method: "gm_download", error });
            },
            ontimeout: () => finish({ ok: false, retrySource: true, method: "gm_download", reason: "timeout" }),
          });
        } catch (error) {
          finish({ ok: false, unavailable: true, method: "gm_download", error });
        }
      });
    }

    async _downloadViaNative(url, meta, options) {
      if (meta.isImage && this._needsImagePostprocess()) {
        return { ok: false, unavailable: true, method: "native" };
      }

      const progress = this._createProgressEmitter(options, meta, "native");
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = meta.filename;
        // 跨域地址可能忽略 download 属性；新标签页可避免下载失败时把抖音页面顶走。
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();

        progress.emit({
          phase: "submitted",
          status: "已交给浏览器，无法读取进度",
          percent: 100,
        }, true);
        if (options.showGlobalProgress !== false) DownloadProgressCenter.finish({
          filename: meta.filename,
          method: "native",
          phase: "submitted",
          status: "已交给浏览器",
          percent: 100,
        });
        return { ok: true, submitted: true, completed: false, method: "native", filename: meta.filename };
      } catch (error) {
        return { ok: false, unavailable: true, method: "native", error };
      }
    }

    async _downloadViaBlob(url, meta, options) {
      const progress = this._createProgressEmitter(options, meta, "blob");
      const controller = new AbortController();
      const cancel = (mode = "cancel") => {
        options.__abortMode = mode;
        controller.abort();
      };
      progress.setCancel(cancel);
      progress.emit({ phase: "connecting", status: "兼容模式：正在连接" }, true);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          credentials: "same-origin",
        });
        if (!response.ok) throw new DownloadHttpError(response, url);

        const read = await this._readResponseToChunks(response, progress, controller.signal);
        const contentType = response.headers.get("content-type") || meta.mime;
        progress.emit({ phase: "processing", status: meta.isImage ? "正在处理图片" : "正在准备文件", loaded: read.loaded, total: read.total || read.loaded }, true);
        const processed = await this.download_postprocess(read.blob, contentType);
        await this.download_blob(processed.blob, meta.filename);
        progress.emit({ phase: "completed", status: "下载完成", loaded: read.loaded, total: read.total || read.loaded, percent: 100 }, true);
        if (options.showGlobalProgress !== false) DownloadProgressCenter.finish({
          filename: meta.filename,
          method: "blob",
          phase: "completed",
          status: "下载完成",
          loaded: read.loaded,
          total: read.total || read.loaded,
          percent: 100,
        });
        return { ok: true, completed: true, method: "blob", filename: meta.filename };
      } catch (error) {
        if (this._isUserCancelled(error)) {
          return { ok: false, cancelled: true, paused: options.__abortMode === "pause", method: "blob", reason: options.__abortMode === "pause" ? "paused" : "cancelled" };
        }
        return { ok: false, retrySource: true, method: "blob", error, reason: "blob_failed" };
      } finally {
        progress.clearCancel(cancel);
      }
    }

    async download_using_browser(url, filename_input, options = {}) {
      const meta = this._guessMeta(url, filename_input, options);
      const mode = this._browserMode();
      const orderMap = {
        auto: ["file_system", "gm_download", "native", "blob"],
        file_system: ["file_system", "gm_download", "native", "blob"],
        gm_download: ["gm_download", "native", "blob"],
        native: ["native", "blob"],
        blob: ["blob"],
      };
      const order = orderMap[mode] || orderMap.auto;

      // 一次 download_file 的多个备用 URL 共用同一下载实现和同一文件句柄。
      const selected = options.__browserMethod;
      const methods = selected ? [selected] : order;
      let lastFailure = null;

      for (let index = 0; index < methods.length; index++) {
        const method = methods[index];
        if (method === "file_system" && options.batch && !options.browserContext?.directoryHandle) {
          continue;
        }

        let result;
        if (method === "file_system") result = await this._downloadViaFileSystem(url, meta, options);
        else if (method === "gm_download") result = await this._downloadViaGM(url, meta, options);
        else if (method === "native") result = await this._downloadViaNative(url, meta, options);
        else result = await this._downloadViaBlob(url, meta, options);

        if (result.cancelled) return result;
        if (result.ok) {
          options.__browserMethod = method;
          return result;
        }
        lastFailure = result;
        if (result.retrySource) {
          const hasPartialFile = Boolean(
            Number(result.loaded || 0) > 0 ||
            result.resumeAvailable ||
            Number(options.__resumeState?.offset || 0) > 0
          );

          // 已经写入部分文件时必须留在当前实现中恢复，避免产生重复文件。
          if (hasPartialFile) {
            options.__browserMethod = method;
            return result;
          }

          // 连接尚未写入数据时，继续尝试 GM_download / 原生下载 / Blob。
          if (index < methods.length - 1) continue;
          options.__browserMethod = method;
          return result;
        }
        if (!result.unavailable) return result;
      }

      return lastFailure || { ok: false, reason: "no_browser_download_method" };
    }

    async download_one_url(url, filename_input, options = {}) {
      const { using_downloader, downloader_config } = Config.global.features;
      if (using_downloader === "browser") {
        return this.download_using_browser(url, filename_input, options);
      }

      if (using_downloader === "aria2" || using_downloader === "abdm") {
        const launcher = new DownloaderLauncher({
          abdmList: [
            {
              domain: downloader_config.abdm?.domain ?? "http://localhost",
              port: downloader_config.abdm?.port ?? "15151",
              dir: "",
            },
          ],
          aria2List: [
            {
              domain: downloader_config.aria2?.domain ?? "http://localhost",
              port: downloader_config.aria2?.port ?? "6800",
              path: downloader_config.aria2?.path ?? "/jsonrpc",
              token: downloader_config.aria2?.token ?? "",
              dir: "",
            },
          ],
        });

        return launcher.invoke_download(
          url,
          using_downloader,
          downloader_config[using_downloader]?.dir,
          {
            ...options,
            filename_input,
            media: options.media,
          }
        );
      }

      throw new Error(`[dy-dl]未知下载器: ${using_downloader}`);
    }

    async download_file(
      source,
      filename_input = "",
      fallback_src = [],
      options = {}
    ) {
      let sources = [source, ...fallback_src].filter(
        (item) =>
          typeof item === "string" &&
          item.length > 0
      );
      sources = Array.from(new Set(sources));

      const recoveryController =
        new AbortController();

      const recoveryCancel = (mode = "cancel") => {
        options.__abortMode = mode;
        recoveryController.abort();
      };

      const showRecoveryStatus = (
        status,
        extra = {}
      ) => {
        const payload = {
          filename:
            normalizeFilename(
              filename_input || "download"
            ),
          method:
            options.__browserMethod ||
            Config.global.features
              .using_downloader ||
            "browser",
          phase: "retrying",
          status,
          loaded: Number(
            options.__resumeState?.offset ||
            extra.loaded ||
            0
          ),
          total: Number(
            options.__resumeState?.total ||
            extra.total ||
            0
          ),
          batch: Boolean(options.batch),
          taskIndex:
            options.taskIndex || 0,
          taskTotal:
            options.taskTotal || 0,
          ...extra,
        };

        try {
          options.onProgress?.(payload);
        } catch {}

        if (
          options.showGlobalProgress !== false
        ) {
          DownloadProgressCenter.update(
            payload,
            true
          );
        }
      };

      const activateRecoveryCancel = () => {
        DownloadRuntime.setCancel(
          recoveryCancel
        );
        try {
          options.onCancelReady?.(
            recoveryCancel
          );
        } catch {}

        if (
          options.showGlobalProgress !== false
        ) {
          DownloadProgressCenter.setCancel(
            recoveryCancel
          );
        }
      };

      let lastResult = {
        ok: false,
        reason: "no_source",
      };
      let refreshAttempted = false;
      let sourceIndex = 0;

      try {
        while (
          sourceIndex < sources.length
        ) {
          const url =
            sources[sourceIndex];

          let networkAttempt = 0;

          while (true) {
            if (
              recoveryController.signal.aborted
            ) {
              return {
                ok: false,
                cancelled: true,
                paused: options.__abortMode === "pause",
                reason: options.__abortMode === "pause" ? "paused" : "cancelled",
                retryContext: {
                  __fileHandle: options.__fileHandle || null,
                  __resumeState: options.__resumeState || null,
                  __browserMethod: options.__browserMethod || null,
                },
              };
            }

            const result =
              await this.download_one_url(
                url,
                filename_input,
                options
              );

            lastResult =
              result || lastResult;

            if (
              result?.ok ||
              result?.cancelled
            ) {
              return result;
            }

            const classification =
              DownloadRecoveryPolicy.classify(
                result || {}
              );

            lastResult = {
              ...lastResult,
              failureCode:
                classification.code,
              message:
                result?.message ||
                classification.message,
              httpStatus:
                result?.httpStatus ||
                classification.status ||
                0,
              retryable:
                classification.retryable,
              refreshable:
                classification.refreshable,
              unavailable:
                classification.unavailable,
              resumeAvailable: Boolean(result?.resumeAvailable),
              resumeCapability:
                result?.resumeCapability ||
                options.__resumeState?.capability ||
                (options.__resumeState?.offset > 0 ? "unknown" : "unsupported"),
            };

            // 403 / 404 / 410：
            // 先从当前播放器或作者主页卡片重新解析作品，
            // 获得新媒体 URL 后再重试，避免把过期 CDN 链接误判为删除。
            if (
              classification.refreshable &&
              typeof options.refreshSources ===
                "function" &&
              !refreshAttempted
            ) {
              refreshAttempted = true;
              showRecoveryStatus(
                "下载链接可能已过期，正在刷新作品信息"
              );

              let refreshed = [];

              try {
                refreshed =
                  await options.refreshSources({
                    result: lastResult,
                    url,
                  });
              } catch (error) {
                console.warn(
                  "[dy-dl]刷新媒体链接失败：",
                  error
                );
              }

              refreshed =
                Array.isArray(refreshed)
                  ? refreshed.filter(
                      (item) =>
                        typeof item ===
                          "string" &&
                        item.length > 0
                    )
                  : [];

              if (refreshed.length) {
                sources = Array.from(
                  new Set([
                    ...refreshed,
                    ...sources,
                  ])
                );
                sourceIndex = 0;
                networkAttempt = 0;
                options.__browserMethod =
                  options.__browserMethod ||
                  null;
                continue;
              }

              if (
                classification.code ===
                  "gone" ||
                classification.code ===
                  "not_found"
              ) {
                lastResult.unavailable =
                  true;
                lastResult.reason =
                  "target_unavailable";
                lastResult.message =
                  DownloadRecoveryPolicy
                    .unavailableMessage(
                      classification,
                      true
                    );
              } else if (
                classification.code ===
                "forbidden"
              ) {
                lastResult.reason =
                  "access_denied";
                lastResult.message =
                  DownloadRecoveryPolicy
                    .unavailableMessage(
                      classification,
                      true
                    );
              }
            }

            // 网络类错误自动重试两次。
            const allowAutomaticRetry =
              !(
                result?.method ===
                  "gm_download" &&
                !options.batch
              );

            if (
              allowAutomaticRetry &&
              classification.retryable &&
              networkAttempt <
                DownloadRecoveryPolicy
                  .RETRY_DELAYS.length
            ) {
              activateRecoveryCancel();

              if (
                navigator.onLine === false
              ) {
                showRecoveryStatus(
                  "网络已断开，等待恢复"
                );

                await DownloadRecoveryPolicy
                  .waitForOnline(
                    recoveryController.signal,
                    (status) =>
                      showRecoveryStatus(
                        status
                      )
                  );
              }

              const delay =
                DownloadRecoveryPolicy
                  .retryDelay(
                    networkAttempt,
                    result?.retryAfterMs
                  );

              showRecoveryStatus(
                `下载失败，${Math.ceil(
                  delay / 1000
                )} 秒后自动重试（${
                  networkAttempt + 1
                }/2）`,
                {
                  loaded:
                    result?.loaded || 0,
                  total:
                    result?.total || 0,
                  resumeAvailable:
                    Boolean(
                      result?.resumeAvailable
                    ),
                }
              );

              await DownloadRecoveryPolicy.wait(
                delay,
                recoveryController.signal
              );

              networkAttempt++;
              continue;
            }

            break;
          }

          sourceIndex++;
        }
      } catch (error) {
        if (
          this._isUserCancelled(error)
        ) {
          return {
            ok: false,
            cancelled: true,
            paused: options.__abortMode === "pause",
            reason: options.__abortMode === "pause" ? "paused" : "cancelled",
            retryContext: {
              __fileHandle: options.__fileHandle || null,
              __resumeState: options.__resumeState || null,
              __browserMethod: options.__browserMethod || null,
            },
          };
        }

        lastResult = {
          ...lastResult,
          ok: false,
          error,
          reason:
            lastResult.reason ||
            "recovery_failed",
          message:
            lastResult.message ||
            String(
              error?.message || error
            ),
        };
      } finally {
        DownloadRuntime.clearCancel(
          recoveryCancel
        );
      }

      const finalClassification =
        DownloadRecoveryPolicy.classify(
          lastResult
        );

      if (
        refreshAttempted &&
        ["not_found", "gone"].includes(
          finalClassification.code
        )
      ) {
        lastResult.unavailable = true;
        lastResult.retryable = false;
        lastResult.reason =
          "target_unavailable";
        lastResult.message =
          DownloadRecoveryPolicy
            .unavailableMessage(
              finalClassification,
              true
            );
      } else if (
        refreshAttempted &&
        finalClassification.code ===
          "forbidden"
      ) {
        lastResult.reason =
          "access_denied";
        lastResult.message =
          DownloadRecoveryPolicy
            .unavailableMessage(
              finalClassification,
              true
            );
      }

      lastResult.retryContext = {
        __fileHandle:
          options.__fileHandle || null,
        __resumeState:
          options.__resumeState || null,
        __browserMethod:
          options.__browserMethod || null,
      };

      try {
        options.onFailure?.(
          lastResult
        );
      } catch {}

      if (
        !options.silent &&
        !lastResult.cancelled
      ) {
        void ProductDialog.open({
          icon: "warning",
          title: "下载未完成",
          message:
            lastResult.message ||
            "所有下载方式均未成功。",
          detail: "您可以检查网络和登录状态后，在任务中心点击“重新下载”。",
          primaryLabel: "我知道了",
          hideSecondary: true,
        });
      }

      return lastResult;
    }
  }
  // #endregion

  // #endregion

  // #region Modal
  /**
   * 通用模态框。
   *
   * V1.0.1 修复：
   * 1. 所有媒体详情、设置、任务管理、关于/反馈面板自动拥有独立关闭按钮；
   * 2. 支持 Esc 关闭；
   * 3. 关闭时尝试卸载 Preact，避免组件事件残留；
   * 4. 关闭按钮放在 root 外层 frame 中，不会被 Preact render 覆盖掉。
   */
  class Modal {
    /**
     * @param {(root: HTMLElement, overlay: HTMLElement) => any} callback
     */
    constructor(callback) {
      this.closed = false;
      this.previouslyFocused =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      this.overlay = document.createElement("div");
      this.overlay.className = "dy-dl-modal-overlay-v1";

      // frame 负责定位关闭按钮，root 继续给业务组件直接 render。
      this.frame = document.createElement("div");
      this.frame.className = "dy-dl-modal-frame-v101";
      this.frame.setAttribute("role", "dialog");
      this.frame.setAttribute("aria-modal", "true");

      this.root = document.createElement("div");
      this.root.className = "dy-dl-modal-root-v1";

      this.closeButton = document.createElement("button");
      this.closeButton.type = "button";
      this.closeButton.className = "dy-dl-modal-close-v101";
      this.closeButton.setAttribute("aria-label", "关闭弹窗");
      this.closeButton.title = "关闭";
      this.closeButton.innerHTML = iconMarkup("close");

      // 点击 modal 内容不传给 overlay。
      this.frame.addEventListener("click", (event) => {
        event.stopPropagation();
      });

      // 点击遮罩空白区域仍然可以关闭。
      this.overlay.addEventListener("click", () => this.close());

      this.closeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      });

      this._onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
      };

      document.addEventListener("keydown", this._onKeyDown, true);

      this.frame.appendChild(this.root);
      this.frame.appendChild(this.closeButton);
      this.overlay.appendChild(this.frame);
      document.body.appendChild(this.overlay);

      if (typeof callback === "function") {
        callback(this.root, this.overlay);
      }

      this.closeButton.focus();
    }

    close() {
      if (this.closed) return;
      this.closed = true;

      document.removeEventListener("keydown", this._onKeyDown, true);

      // 如果 root 内由 Preact 挂载，关闭时主动卸载。
      try {
        const render = getHtmPreact().render;
        if (typeof render === "function") {
          render(null, this.root);
        }
      } catch (error) {
        console.debug("[dy-dl]卸载 Modal Preact 失败，可忽略：", error);
      }

      this.overlay?.remove();
      this.previouslyFocused?.focus?.();
    }
  }
  // #endregion

  // =============================================================================
  // 关于 / 需求反馈 信息面板
  // =============================================================================

  /**
   * =====================================================================
   * 【用户可自行修改的信息区域】
   *
   * 以后如果你想修改维护者、项目仓库、交流群、免责声明、反馈说明，
   * 只需要搜索：ABOUT_PANEL_CONTENT
   * 然后修改下面这些中文字符串即可，不需要查其它代码。
   * =====================================================================
   */
  const ABOUT_PANEL_CONTENT = Object.freeze({
    title: "抖音下载 · 关于 / 需求反馈",
    subtitle: "稳定增强维护版",
    version: "V1.0.9",

    // ---- 项目与联系信息 ----
    maintainer: "小辉同學",
    projectName: "xiaohuitongxue88-ctrl/douyin-downloader",
    projectUrl: "https://github.com/xiaohuitongxue88-ctrl/douyin-downloader",
    groupUrl:
      "https://qm.qq.com/cgi-bin/qm/qr?k=CBGX0IIrsC_zYKVZj8VC5h8oTHi3RFIl&jump_from=webapi&authKey=yQui9pH2urgUtzrPje4pxQQci5C6Vlfe/socd6ELHzeKfII4G+VQs65rqNYLblFU",

    // ---- MIT 来源说明：界面低调展示，源码内保留完整版权与许可 ----
    upstreamName: "douyin-dl-user-js",
    upstreamUrl: "https://github.com/zhzLuke96/douyin-dl-user-js",

    // ---- 免费分享说明 ----
    shareNote:
      "本脚本坚持免费、无偿分享，不提供任何收费授权，也不要求用户付费获取脚本。",

    // ---- 免责声明：以后需要调整免责声明，就改这里 ----
    disclaimer:
      "本脚本仅供个人学习、技术研究及合法的个人内容备份使用。请使用者自行遵守所在地法律法规、抖音平台规则及相关内容版权要求。严禁将本脚本用于侵权、违法用途，严禁倒卖、付费转售或恶意修改后冒充他人或项目官方进行收费传播。因使用者不当使用本脚本而产生的账号、版权、网络、数据或其它风险与后果，由使用者自行承担。",

    // ---- 反馈建议 ----
    feedback:
      "如需反馈 Bug 或提出功能建议，请在脚本发布页的反馈区说明：脚本版本、页面类型、复现步骤、浏览器版本、截图及必要的控制台报错。",

    // ---- 隐私提醒 ----
    privacy:
      "请勿在反馈邮件或截图中提供账号密码、Cookie、Token、验证码、身份证件或其它敏感信息。",

    // ---- 功能摘要：可自行增删 ----
    features: [
      "视频 / 图集 / 图片下载",
      "提取并下载作品原声音频",
      "媒体详情与多清晰度资源查看",
      "弹幕导出为 ASS",
      "作者主页批量选择与下载",
      "浏览器 / AB Download Manager / aria2 下载器",
      "快捷键 M：下载当前媒体",
    ],
  });

  const AboutPanel = {
    escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    },

    open() {
      const modal = new Modal((root, overlay) => {
        overlay.style.zIndex = "999999";

        const fullscreenElement = document.fullscreenElement;
        if (fullscreenElement) {
          fullscreenElement.appendChild(overlay);
        }

        root.classList.add("dy-dl-about-root-v101");
      });

      const info = ABOUT_PANEL_CONTENT;
      const featureHtml = info.features
        .map(
          (item) =>
            `<li><span class="dy-dl-about-dot"></span>${this.escapeHtml(
              item
            )}</li>`
        )
        .join("");

      modal.root.innerHTML = `
        <div class="dy-dl-about-panel-v101">
          <header class="dy-dl-about-header">
            <div class="dy-dl-about-logo">DY</div>
            <div class="dy-dl-about-heading">
              <div class="dy-dl-about-title">${this.escapeHtml(info.title)}</div>
              <div class="dy-dl-about-subtitle">
                ${this.escapeHtml(info.subtitle)}
                <span class="dy-dl-about-version">${this.escapeHtml(
                  info.version
                )}</span>
              </div>
            </div>
            <span class="dy-dl-about-free">免费无偿分享</span>
          </header>

          <section class="dy-dl-about-project-card">
            <div class="dy-dl-about-info-row">
              <div class="dy-dl-about-info-label">维护者</div>
              <div class="dy-dl-about-info-value">${this.escapeHtml(
                info.maintainer
              )}</div>
            </div>

            <div class="dy-dl-about-info-row">
              <div class="dy-dl-about-info-label">项目仓库</div>
              <div class="dy-dl-about-info-value">
                <a target="_blank" rel="noopener noreferrer" href="${this.escapeHtml(
                  info.projectUrl
                )}">${this.escapeHtml(info.projectName)}</a>
              </div>
            </div>

            <div class="dy-dl-about-info-row">
              <div class="dy-dl-about-info-label">交流群</div>
              <div class="dy-dl-about-info-value">
                <a class="dy-dl-about-group-link" target="_blank" rel="noopener noreferrer" href="${this.escapeHtml(
                  info.groupUrl
                )}">加入 QQ 交流群</a>
              </div>
            </div>
          </section>

          <div class="dy-dl-about-attribution">
            基于
            <a target="_blank" rel="noopener noreferrer" href="${this.escapeHtml(
              info.upstreamUrl
            )}">${this.escapeHtml(info.upstreamName)}</a>
            （MIT 许可）改进
          </div>

          <section class="dy-dl-about-section">
            <div class="dy-dl-about-section-title">主要功能</div>
            <ul class="dy-dl-about-features">
              ${featureHtml}
            </ul>
          </section>

          <section class="dy-dl-about-section dy-dl-about-share-box">
            <div class="dy-dl-about-section-title">免费分享说明</div>
            <p>${this.escapeHtml(info.shareNote)}</p>
          </section>

          <section class="dy-dl-about-section">
            <div class="dy-dl-about-section-title">反馈建议</div>
            <p>${this.escapeHtml(info.feedback)}</p>
            <div class="dy-dl-about-privacy">
              <strong>隐私提醒：</strong>${this.escapeHtml(info.privacy)}
            </div>
          </section>

          <section class="dy-dl-about-section dy-dl-about-disclaimer">
            <div class="dy-dl-about-section-title">免责声明</div>
            <p>${this.escapeHtml(info.disclaimer)}</p>
          </section>

          <footer class="dy-dl-about-footer">
            <span>脚本版本 ${this.escapeHtml(info.version)}</span>
            <span>·</span>
            <span>免费分享 · 请尊重原创与版权</span>
          </footer>
        </div>
      `;

      return modal;
    },
  };

  // #region 下载器唤醒
  /**
   * 下载器唤醒工具类
   * 支持：IDM、Aria2、BitComet、AB Download Manager
   */
  class DownloaderLauncher {
    /**
     * @param {Object} config 全局配置（可选，也可在调用方法时传入具体配置）
     * @param {Array} config.idmList IDM配置列表，默认 [{ id: "1", default: true }]
     * @param {Array} config.aria2List Aria2配置列表
     * @param {Array} config.bitcometList BitComet配置列表
     * @param {Array} config.abdmList ABDM配置列表
     * @param {string} config.curlTerminal 终端类型，默认 "wc" (Windows CMD)
     */
    constructor(config = {}) {
      this.config = {
        idmList: config.idmList || [{ id: "1" }],
        aria2List: config.aria2List || [
          {
            domain: "http://localhost",
            port: "6800",
            path: "/jsonrpc",
            token: "",
            dir: "",
          },
        ],
        bitcometList: config.bitcometList || [
          {
            domain: "http://localhost",
            port: "8080",
            path: "/panel/task_add_httpftp_result",
            authName: "",
            authPass: "",
            dir: "",
          },
        ],
        abdmList: config.abdmList || [
          {
            domain: "http://localhost",
            port: "15151",
            dir: "",
          },
        ],
        curlTerminal: config.curlTerminal || "wc", // wc, wp, lt, ls, mt
      };
    }

    // ==================== 简化入口 ====================
    /**
     * 简化入口
     * @param {string} url
     * @param {"idm" | "aria2" | "bc" | "abdm"} dl_name 下载器名称
     * @param {void | null | {video: string, image: string, other: string}} dir_config 下载文件夹配置
     */
    _resolve_dir_template(input, context, fallback = "") {
      if (typeof input !== "string") return fallback;

      const raw = input.trim();
      if (!raw) return fallback;

      if (!raw.includes("${") && !raw.startsWith("`")) {
        return raw;
      }

      try {
        const resolved = renderTemplate(context, raw);
        return typeof resolved === "string" && resolved.trim()
          ? resolved
          : fallback;
      } catch (error) {
        console.error("[dy-dl]解析下载目录模板失败", error);
        return fallback;
      }
    }

    /**
     * 简化入口
     * @param {string} url
     * @param {"idm" | "aria2" | "bc" | "abdm"} dl_name 下载器名称
     * @param {void | null | {video: string, image: string, other: string}} dir_config 下载文件夹配置
     * @param {{filename_input?: string, media?: import("./types").DouyinMedia.MediaRoot | null}} [options]
     */
    async invoke_download(url, dl_name = "abdm", dir_config, options = {}) {
      const media = options.media || mediaHandler.current_media;
      const input_filename =
        options.filename_input ||
        (media ? mediaHandler._build_filename(media) : "download");

      const initialProgress = {
        filename: normalizeFilename(input_filename),
        method: dl_name,
        phase: "preparing",
        status: "正在获取文件信息",
        loaded: 0,
        total: 0,
        percent: 0,
      };
      options.onProgress?.(initialProgress);
      if (options.showGlobalProgress !== false) {
        DownloadProgressCenter.update(initialProgress, true);
      }

      let prepared;
      try {
        prepared = await mediaHandler.downloader.prepare_filename(
          url,
          normalizeFilename(input_filename),
          options
        );
      } catch {
        prepared = mediaHandler.downloader._guessMeta(
          url,
          normalizeFilename(input_filename),
          options
        );
      }

      const { filename, isVideo, isImage, isAudio } = prepared;
      const authorInfo = media?.authorInfo || {};
      const userId =
        authorInfo.uid || media?.authorUserId || authorInfo.secUid || "unknown";
      const nickname = authorInfo.nickname || "unknown";
      const user_dir = normalizeFilename(`${userId}_${nickname}`);
      const mediaType = isVideo ? "video" : isImage ? "image" : "other";
      const defaultDir = isVideo
        ? `./douyin/${user_dir}/videos`
        : isImage
        ? `./douyin/${user_dir}/images`
        : isAudio
        ? `./douyin/${user_dir}/audio`
        : `./douyin/${user_dir}/others`;
      const dirContext = {
        media,
        filename,
        filename_base: input_filename,
        user_dir,
        author_info: authorInfo,
        uid: userId,
        nickname,
        aweme_id: media?.awemeId || "",
        desc: media?.desc || "",
      };
      const resolvedDir = this._resolve_dir_template(
        dir_config?.[mediaType],
        dirContext,
        defaultDir
      );

      if (dl_name === "abdm") {
        const ok = await this.launchABDM(url, filename, {}, { dir: resolvedDir });
        const payload = {
          filename,
          method: "abdm",
          phase: ok ? "submitted" : "failed",
          status: ok ? "已提交 ABDM" : "ABDM 提交失败",
          percent: ok ? 100 : 0,
        };
        options.onProgress?.(payload);
        if (options.showGlobalProgress !== false) DownloadProgressCenter.finish(payload);
        return ok
          ? { ok: true, submitted: true, completed: false, method: "abdm", filename }
          : { ok: false, method: "abdm", reason: "abdm_submit_failed" };
      }

      if (dl_name === "aria2") {
        return this.launchAria2(url, filename, {}, { dir: resolvedDir }, options);
      }

      throw new Error(`Unknown download name: ${dl_name}`);
    }

    // ==================== 辅助方法 ====================
    /**
     * 获取默认配置项
     * @param {string} type idm | aria2 | bitcomet | abdm
     * @returns {Object} 默认配置对象
     */
    getDefaultConfig(type) {
      const listMap = {
        idm: this.config.idmList,
        aria2: this.config.aria2List,
        bitcomet: this.config.bitcometList,
        abdm: this.config.abdmList,
      };
      const list = listMap[type];
      if (!list) throw new Error(`Unknown type: ${type}`);
      const defaultItem = list.find((item) => item.default) || list[0];
      return defaultItem;
    }

    /**
     * 标准化请求头：转换为对象，添加常用默认头
     * @param {Object|string} headers 原始头
     * @param {boolean} addDefault 是否添加默认头（DNT, Cache-Control等）
     * @returns {Object}
     */
    static normalizeHeaders(headers = {}, addDefault = false) {
      if (typeof headers === "string") {
        const raw = {};
        headers.split(/[\r\n]+/).forEach((line) => {
          if (!line.trim() || !line.includes(":")) return;
          const [key, ...parts] = line.split(":");
          raw[key.trim().toLowerCase()] = parts.join(":").trim();
        });
        headers = raw;
      }
      const newHeaders = {};
      for (let key in headers) {
        let value = headers[key];
        if (typeof value === "object") value = JSON.stringify(value);
        else value = String(value);
        const normalizedKey = key
          .toLowerCase()
          .split("-")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join("-");
        newHeaders[normalizedKey] = value;
      }
      if (addDefault) return newHeaders;
      return {
        Dnt: "",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Expires: "0",
        Cookie: document.cookie,
        "User-Agent": navigator.userAgent,
        Origin: location.origin,
        Referer: `${location.origin}/`,
        ...newHeaders,
      };
    }

    /**
     * 可跨域 xmlhttpRequest 请求
     * @author hmjz100
     * @description 封装 `GreaseMonkey-Compatible_xmlhttpRequest` 实现的跨域请求，与原始函数参数相同，支持回调和 await 两种用法
     * @param {Object} option - 请求配置对象
     * @returns {XMLHttpRequest|Promise} 请求对象实例或 Promise
     */
    static xmlHttpRequest(option) {
      let xmlHttpRequest =
        typeof GM_xmlhttpRequest === "function"
          ? GM_xmlhttpRequest
          : typeof GM?.xmlHttpRequest === "function"
          ? GM.xmlHttpRequest
          : null;
      if (!xmlHttpRequest || typeof xmlHttpRequest !== "function")
        throw new Error("GreaseMonkey 兼容 XMLHttpRequest 不可用。");

      return xmlHttpRequest({ withCredentials: true, ...option });
    }

    /**
     * 发送HTTP请求 使用 gm-xmlhttpRequest 发起跨域请求 aria2 需要这个不然没法请求
     * @param {string} url
     * @param {Object} options fetch选项
     * @returns {Promise<Object>}
     */
    static request_cors(url, options = {}) {
      return new Promise((resolve, reject) => {
        const {
          method = "GET",
          headers = {},
          body,
          timeout = 30000,
          responseType,
        } = options;

        this.xmlHttpRequest({
          method,
          url,
          headers,
          data: body,
          timeout,
          responseType, // 可选：'json' / 'blob' / 'arraybuffer'

          onload: (res) => {
            let data = res.response;

            // fallback 解析（当没指定 responseType 时）
            if (!responseType) {
              const contentType = res.responseHeaders || "";

              if (contentType.includes("application/json")) {
                try {
                  data = JSON.parse(res.responseText);
                } catch (e) {
                  data = res.responseText;
                }
              } else {
                data = res.responseText;
              }
            }

            resolve({
              status: res.status,
              data,
              headers: res.responseHeaders,
            });
          },

          onerror: (err) => {
            reject(err);
          },

          ontimeout: () => {
            reject(new Error("Request timeout"));
          },
        });
      });
    }

    /**
     * 发送HTTP请求 默认用这个请求，不需要权限
     * @param {string} url
     * @param {Object} options fetch选项
     * @returns {Promise<Object>}
     */
    static async request(url, options = {}) {
      const response = await fetch(url, options);
      let data;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        data = await response.text();
      }
      return { status: response.status, data };
    }

    /**
     * 格式化文件大小（用于调试）
     * @param {number} bytes
     * @returns {string}
     */
    static formatSize(bytes) {
      if (bytes === 0) return "0 B";
      const k = 1024;
      const sizes = ["B", "KB", "MB", "GB", "TB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    /**
     * 生成cURL命令
     * @param {string} link
     * @param {string} filename
     * @param {Object} headers 额外请求头
     * @param {string} terminal 终端类型 wc|wp|lt|ls|mt
     * @returns {string}
     */
    static toCurlCommand(link, filename, headers = {}, terminal = "wc") {
      const curlCmd = terminal !== "wp" ? "curl" : "curl.exe";
      const headerArgs = Object.entries(headers)
        .map(([k, v]) => `-H "${k}: ${v}"`)
        .join(" ");
      const safeFilename = filename.replace(/[!?&|`"'*/:<>\\]/g, "_");
      return `${curlCmd} -L -C - "${link}" -o "${safeFilename}" ${headerArgs}`.trim();
    }

    /**
     * 生成BC链接（比特彗星专用）
     * @param {string} link
     * @param {string} filename
     * @param {Object} headers 额外请求头（将被编码进协议）
     * @returns {string}
     */
    static toBitCometLink(link, filename, headers = {}) {
      const safeFilename = filename.replace(/[!?&|`"'*/:<>\\]/g, "_");
      const query = new URLSearchParams();
      query.append("url", link);
      for (const [k, v] of Object.entries(headers)) {
        query.append(k, v);
      }
      const queryStr = query.toString();
      const bcData = `AA/${encodeURIComponent(safeFilename)}/?${queryStr}ZZ`;
      const base64Data = btoa(unescape(encodeURIComponent(bcData)));
      return `bc://http/${base64Data}`;
    }

    // ==================== 唤醒方法 ====================

    /**
     * 发送到 IDM
     * @param {string} link 下载链接
     * @param {string} filename 文件名
     * @param {number} filesize 文件大小（字节）
     * @param {Object} headers 请求头（可选）
     * @param {Object} idmConfig 可选，覆盖默认配置
     * @returns {Promise<boolean>} 是否成功
     */
    async launchIDM(link, filename, filesize, headers = {}, idmConfig = null) {
      const config = { ...this.getDefaultConfig("idm"), ...idmConfig };
      const clientId = config.id;
      if (!clientId) throw new Error("IDM client id missing");

      const seq = (this._idmSeq = (this._idmSeq || 1) + 1);
      const time = Date.now();
      const url = `http://127.0.0.1:1001/client/${clientId}?seq=${seq}`;
      const ext = filename.split(".").pop().toUpperCase();

      const normHeaders = DownloaderLauncher.normalizeHeaders(headers);
      let headersText =
        Object.entries(normHeaders)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n") + "\n";

      const format = (key, val) => {
        if (val === undefined || val === null) return "";
        const strVal = String(val);
        const len = new Blob([strVal]).size;
        return `${key}=${len}:${strVal}`;
      };

      const fields = [
        format(4, ext),
        format(6, link),
        format(7, location.origin),
        format(11, headersText),
        format(100, filename),
        format(122, 4),
      ];
      const data = `MSG#${seq}#13#1#10241:${
        seq + 1000
      }:0:${time}:0:1:2:${filesize}:0,${fields.join(",")};`;

      try {
        const res = await DownloaderLauncher.request(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: data,
        });
        return res.data === `${seq}:3;`;
      } catch (e) {
        console.error("IDM launch failed", e);
        return false;
      }
    }

    /**
     * 发送到 Aria2
     * @param {string} link
     * @param {string} filename
     * @param {Object} headers 请求头（将转为 --header 数组）
     * @param {Object} aria2Config 可选，覆盖默认配置
     * @returns {Promise<boolean>}
     */
    async launchAria2(
      link,
      filename,
      headers = {},
      aria2Config = null,
      options = {}
    ) {
      const config = { ...this.getDefaultConfig("aria2"), ...aria2Config };
      const url = `${config.domain}:${config.port}${config.path}`;
      const headerList = Object.entries(
        DownloaderLauncher.normalizeHeaders(headers)
      ).map(([key, value]) => `${key}: ${value}`);

      const rpc = async (method, params = []) => {
        const tokenParams = config.token ? [`token:${config.token}`, ...params] : params;
        const res = await DownloaderLauncher.request_cors(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: Date.now(),
            jsonrpc: "2.0",
            method,
            params: tokenParams,
          }),
        });
        if (res.data?.error) throw new Error(res.data.error.message || "aria2 RPC error");
        return res.data?.result;
      };

      let gid = "";
      try {
        gid = await rpc("aria2.addUri", [
          [link],
          {
            dir: config.dir || undefined,
            out: filename,
            header: headerList,
          },
        ]);
      } catch (error) {
        console.error("Aria2 launch failed", error);
        return { ok: false, method: "aria2", reason: "aria2_submit_failed", error };
      }

      if (!gid) return { ok: false, method: "aria2", reason: "aria2_missing_gid" };

      let cancelled = false;
      const cancel = async () => {
        cancelled = true;
        try { await rpc("aria2.forceRemove", [gid]); } catch {}
      };
      DownloadRuntime.setCancel(cancel);
      options.onCancelReady?.(cancel);
      if (options.showGlobalProgress !== false) DownloadProgressCenter.setCancel(cancel);

      const emit = (partial, force = false) => {
        const payload = { filename, method: "aria2", ...partial };
        options.onProgress?.(payload);
        if (options.showGlobalProgress !== false) DownloadProgressCenter.update(payload, force);
      };

      emit({ phase: "submitted", status: "已提交 aria2，等待下载", percent: 0 }, true);

      try {
        while (!cancelled) {
          const status = await rpc("aria2.tellStatus", [
            gid,
            ["status", "totalLength", "completedLength", "downloadSpeed", "errorCode", "errorMessage"],
          ]);
          const total = Number(status?.totalLength || 0);
          const loaded = Number(status?.completedLength || 0);
          const speed = Number(status?.downloadSpeed || 0);
          const percent = total > 0 ? (loaded / total) * 100 : 0;
          const eta = total > loaded && speed > 0 ? (total - loaded) / speed : NaN;

          if (status?.status === "complete") {
            const payload = { phase: "completed", status: "aria2 下载完成", loaded, total: total || loaded, speed, eta: 0, percent: 100 };
            emit(payload, true);
            if (options.showGlobalProgress !== false) DownloadProgressCenter.finish({ filename, method: "aria2", ...payload });
            return { ok: true, completed: true, method: "aria2", gid, filename };
          }

          if (status?.status === "error" || status?.status === "removed") {
            const reason = status?.errorMessage || `aria2 ${status?.status}`;
            emit({ phase: "failed", status: `aria2 失败：${reason}`, loaded, total, speed, eta, percent }, true);
            return { ok: false, method: "aria2", gid, reason };
          }

          emit({ phase: "downloading", status: status?.status === "paused" ? "aria2 已暂停" : "aria2 正在下载", loaded, total, speed, eta, percent });
          await new Promise((resolve) => {
            setTimeout(resolve, 900);
          });
        }

        return { ok: false, cancelled: true, method: "aria2", gid, reason: "cancelled" };
      } catch (error) {
        console.error("Aria2 status failed", error);
        return { ok: false, method: "aria2", gid, reason: "aria2_status_failed", error };
      } finally {
        DownloadRuntime.clearCancel(cancel);
        if (options.showGlobalProgress !== false) DownloadProgressCenter.setCancel(null);
      }
    }

    /**
     * 发送到比特彗星 (BitComet)
     * @param {string} link
     * @param {string} filename
     * @param {Object} headers 请求头（将转为表单字段）
     * @param {Object} bitcometConfig 可选，覆盖默认配置
     * @returns {Promise<boolean>}
     */
    async launchBitComet(link, filename, headers = {}, bitcometConfig = null) {
      const config = {
        ...this.getDefaultConfig("bitcomet"),
        ...bitcometConfig,
      };
      const url = `${config.domain}:${config.port}${config.path}`;
      const formData = new URLSearchParams();
      formData.append("url", link);
      if (config.dir) formData.append("save_path", config.dir);
      formData.append("file_name", filename);
      formData.append("connection", "200");
      const normHeaders = DownloaderLauncher.normalizeHeaders(headers);
      for (const [k, v] of Object.entries(normHeaders)) {
        formData.append(k, v);
      }
      const auth = btoa(`${config.authName}:${config.authPass}`);
      try {
        const res = await DownloaderLauncher.request(url, {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData,
        });
        // 比特彗星成功时返回空或特定字符串；失败包含 "Add task failed!"
        return !res.data.includes("Add task failed!");
      } catch (e) {
        // 网络错误无法证明任务已创建，不能把未知状态伪报为成功。
        console.error("BitComet launch failed", e);
        return false;
      }
    }

    /**
     * 发送到 AB Download Manager
     * @param {string} link
     * @param {string} filename
     * @param {Object} headers 请求头
     * @param {Object} abdmConfig 可选，覆盖默认配置
     * @returns {Promise<boolean>}
     */
    async launchABDM(link, filename, headers = {}, abdmConfig = null) {
      const config = { ...this.getDefaultConfig("abdm"), ...abdmConfig };
      const url = `${config.domain}:${config.port}/start-headless-download`;
      const normHeaders = DownloaderLauncher.normalizeHeaders(headers);
      const payload = {
        downloadSource: {
          link: link,
          headers: normHeaders,
          downloadPage: normHeaders["Referer"] || location.href,
        },
        name: filename,
      };
      if (config.dir) payload.folder = config.dir;
      try {
        // 这里其实用 非cors跳过 也可以，但是fetch会报错...所以也用cors版本算了...
        const res = await DownloaderLauncher.request_cors(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify(payload),
        });
        return res.data === "OK";
      } catch (e) {
        console.error("ABDM launch failed", e);
        return false;
      }
    }

    // 以下是同步命令生成方法（不实际唤醒）
    getCurlCommand(link, filename, headers = {}) {
      return DownloaderLauncher.toCurlCommand(
        link,
        filename,
        headers,
        this.config.curlTerminal
      );
    }

    getBitCometLink(link, filename, headers = {}) {
      return DownloaderLauncher.toBitCometLink(link, filename, headers);
    }

    getAria2Command(link, filename, headers = {}) {
      const headerArgs = Object.entries(headers)
        .map(([k, v]) => `--header "${k}: ${v}"`)
        .join(" ");
      const safeFilename = filename.replace(/[!?&|`"'*/:<>\\]/g, "_");
      return `aria2c "${link}" --out "${safeFilename}" ${headerArgs}`.trim();
    }
  }

  // #endregion

  // #region Media Detail Model

  // 媒体详情 modal
  const MediaModalComponents = (() => {
    /**
     * @type {import('preact/hooks')}
     */
    const { useState, useRef, useEffect, html } = getHtmPreact();
    /**
     * @type {import('preact').h}
     */
    // --- 初始化 CSS-in-JS 工具 ---
    const css = createCSS();

    // --- 生成所有样式类名（静态 + 动态变体）---
    const styles = {
      container: css({
        display: "flex",
        flexDirection: "column",
        height: "80vh",
        overflow: "hidden",
        background: theme.colors.bgOverlay,
        borderRadius: theme.borderRadius.lg,
        color: theme.colors.textPrimary,
      }),

      nav: css({
        display: "flex",
        borderBottom: `1px solid ${theme.colors.borderLight}`,
        background: theme.colors.bgNav,
        flexShrink: 0,
      }),

      navBtnBase: css({
        padding: `${theme.spacing.md} ${theme.spacing.xl}`,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        borderBottom: `2px solid transparent`,
        fontWeight: "normal",
        color: theme.colors.textSecondary,
      }),

      navBtnActive: css({
        background: "rgba(255,255,255,0.08)",
        borderBottomColor: theme.colors.primary,
        fontWeight: "bold",
        color: theme.colors.primary,
      }),

      content: css({
        flexGrow: 1,
        minWidth: 0,
        overflowY: "auto",
        padding: theme.spacing.xxl,
      }),

      fieldset: css({
        border: `1px solid ${theme.colors.borderMedium}`,
        borderRadius: theme.borderRadius.md,
        marginBottom: theme.spacing.xl,
        padding: theme.spacing.lg,
        background: theme.colors.bgFieldset,
      }),

      legend: css({
        fontWeight: "bold",
        padding: `0 ${theme.spacing.sm}`,
        color: "rgba(255,255,255,0.9)",
        background: "rgba(18,18,20,0.8)",
        borderRadius: theme.borderRadius.full,
        fontSize: theme.fontSize.sm,
      }),

      row: css({
        display: "flex",
        padding: `${theme.spacing.sm} 0`,
        fontSize: theme.fontSize.sm,
        borderBottom: `1px solid rgba(255,255,255,0.08)`,
        alignItems: "center",
        gap: theme.spacing.sm,
        minWidth: 0,
      }),

      label: css({
        width: "112px",
        flex: "0 0 112px",
        color: theme.colors.textMuted,
        fontWeight: 600,
      }),

      value: css({
        flex: "1 1 auto",
        minWidth: 0,
        color: theme.colors.textSecondary,
        wordBreak: "break-all",
        overflowWrap: "anywhere",
      }),

      // 通用按钮。增加 whiteSpace/flexShrink，避免 SecUID 等长文本把按钮挤成两行。
      btn: css({
        padding: `${theme.spacing.xs} ${theme.spacing.md}`,
        fontSize: theme.fontSize.xs,
        cursor: "pointer",
        border: `1px solid rgba(255,255,255,0.3)`,
        background: "rgba(255,255,255,0.08)",
        color: theme.colors.textPrimary,
        borderRadius: theme.borderRadius.full,
        marginLeft: theme.spacing.sm,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }),

      // 作者信息中的复制按钮单独锁定最小宽度，避免“复制”变成竖排/两行。
      copyBtn: css({
        minWidth: "64px",
        padding: `${theme.spacing.xs} ${theme.spacing.md}`,
        fontSize: theme.fontSize.xs,
        cursor: "pointer",
        border: `1px solid rgba(255,255,255,0.3)`,
        background: "rgba(255,255,255,0.08)",
        color: theme.colors.textPrimary,
        borderRadius: theme.borderRadius.full,
        whiteSpace: "nowrap",
        flex: "0 0 auto",
      }),

      // 作者头像右侧信息区域。
      authorMeta: css({
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: "9px",
        minWidth: 0,
      }),

      authorName: css({
        margin: 0,
        color: theme.colors.textPrimary,
        fontSize: "19px",
        lineHeight: 1.25,
        fontWeight: 700,
      }),

      // “访问主页”使用独立样式，不再继承通用 btn 的 marginLeft。
      authorHomeBtn: css({
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "30px",
        padding: `0 ${theme.spacing.md}`,
        border: `1px solid rgba(255,255,255,0.28)`,
        borderRadius: theme.borderRadius.full,
        background: "rgba(255,255,255,0.08)",
        color: theme.colors.textPrimary,
        textDecoration: "none",
        fontSize: theme.fontSize.xs,
        lineHeight: 1,
        whiteSpace: "nowrap",
        cursor: "pointer",
      }),

      img: css({
        maxWidth: "100px",
        maxHeight: "80px",
        objectFit: "cover",
        borderRadius: theme.borderRadius.sm,
        border: `1px solid ${theme.colors.borderInput}`,
      }),

      table: css({
        width: "100%",
        fontSize: theme.fontSize.xs,
        borderCollapse: "collapse",
        background: "rgba(0,0,0,0.2)",
        borderRadius: theme.borderRadius.sm,
        overflow: "hidden",
      }),

      th: css({
        border: `1px solid ${theme.colors.borderLight}`,
        padding: theme.spacing.sm,
        background: "rgba(0,0,0,0.4)",
        textAlign: "left",
        color: "rgba(255,255,255,0.9)",
      }),

      td: css({
        border: `1px solid ${theme.colors.borderLight}`,
        padding: theme.spacing.sm,
        color: theme.colors.textSecondary,
      }),

      // 额外提取的辅助类（原内联样式）
      flexRow: css({ display: "flex", gap: "15px", alignItems: "center" }),
      flexWrap: css({ display: "flex", gap: "6px", flexWrap: "wrap" }),
      imgCover: css({ width: "120px", borderRadius: "4px" }),
      authorHeader: css({
        display: "flex",
        gap: "18px",
        marginBottom: "22px",
        alignItems: "center",
        minWidth: 0,
      }),
      jsonPre: css({
        background: "rgba(0,0,0,0.3)",
        padding: "10px",
        overflow: "auto",
        maxHeight: "100%",
        fontSize: "12px",
        wordBreak: "break-all",
        whiteSpace: "pre-wrap",
        border: `1px solid ${theme.colors.borderInput}`,
        borderRadius: theme.borderRadius.sm,
        cursor: "text",
        color: "#ddd",
      }),
      danmakuContainer: css({
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.md,
      }),
      danmakuHeader: css({
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }),
      danmakuTitle: css({ margin: 0 }),
      danmakuButtonGroup: css({ display: "flex", gap: theme.spacing.sm }),
      danmakuEmpty: css({
        textAlign: "center",
        padding: theme.spacing.xl,
        color: theme.colors.textDim,
      }),
      danmakuTableWrapper: css({
        maxHeight: "500px",
        overflowY: "auto",
        border: "1px solid #ddd",
        borderRadius: "4px",
      }),
    };

    // 辅助函数：根据 active 状态返回导航按钮类名
    const navBtnClass = (active) =>
      active
        ? `${styles.navBtnBase} ${styles.navBtnActive}`
        : styles.navBtnBase;

    // --- 辅助函数 ---
    const fmt = {
      ts: (ts) => (ts ? new Date(ts * 1000).toLocaleString() : "N/A"),
      num: (n) => (n > 10000 ? (n / 10000).toFixed(1) + " 万" : n || 0),
      size: (s) => (s ? (s / 1024 / 1024).toFixed(2) + " MB" : "-"),
    };

    // ms 转 ASS 时间格式 (HH:MM:SS.mm)
    const msToAssTime = (ms) => {
      const hours = Math.floor(ms / 3600000);
      const minutes = Math.floor((ms % 3600000) / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      const centiseconds = Math.floor((ms % 1000) / 10);
      return `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${centiseconds
        .toString()
        .padStart(2, "0")}`;
    };

    // --- 原子组件 ---

    // 基础键值对
    const KeyValue = ({ label, children }) => html`
      <div className=${styles.row}>
        <strong className=${styles.label}>${label}</strong>
        <span className=${styles.value}>${children || "-"}</span>
      </div>
    `;

    // 可复制的键值对
    const Copyable = ({ label, value }) => {
      const [copied, setCopied] = useState(false);

      const handleCopy = async () => {
        if (!value) return;

        try {
          await navigator.clipboard.writeText(String(value));
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch (error) {
          console.warn("[dy-dl]复制失败：", error);
          createToast(null, "复制失败");
        }
      };

      if (!value) return html`<${KeyValue} label=${label} />`;

      return html`
        <div className=${styles.row}>
          <strong className=${styles.label}>${label}</strong>
          <span className=${styles.value} title=${String(value)}>
            ${value}
          </span>
          <button
            type="button"
            className=${styles.copyBtn}
            onClick=${handleCopy}
          >
            ${copied ? "已复制" : "复制"}
          </button>
        </div>
      `;
    };

    // 表格组件
    const Table = ({ headers, rows }) => html`
      <table className=${styles.table}>
        <thead>
          <tr>
            ${headers.map((h) => html`<th className=${styles.th}>${h}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (row) =>
              html`<tr>
                ${row.map(
                  (cell) => html`<td className=${styles.td}>${cell}</td>`
                )}
              </tr>`
          )}
        </tbody>
      </table>
    `;

    // --- Tab 内容组件 ---
    /**
     * Launcher 配置
     */
    const launchers = [
      {
        key: "browser",
        label: "打开",
        buildUrl: (url) => url,
      },
      {
        key: "copy",
        label: "复制",
        buildUrl: () => null,
        action: async (url) => {
          const ok = await copyText(url);
          ToastCenter.update(ok ? "链接已复制" : "复制失败，请手动复制", 1800);
        },
      },
      {
        key: "potplayer",
        label: "PotPlayer",
        buildUrl: (url) => "potplayer://" + url,
      },
      {
        key: "abdm",
        label: "abdm",
        buildUrl: () => null,
        action: async (url) => {
          const launcher = new DownloaderLauncher();
          await launcher.invoke_download(url, "abdm");
        },
      },
      {
        key: "aria2",
        label: "aria2",
        buildUrl: () => null,
        action: async (url) => {
          const launcher = new DownloaderLauncher();
          await launcher.invoke_download(url, "aria2");
        },
      },
    ];

    /**
     * 通用唤醒按钮组
     */
    const LaunchButtons = ({ url, launchers }) => {
      return html`
        <div className=${styles.flexWrap}>
          ${launchers.map((l) => {
            const href = l.buildUrl?.(url, {});

            if (l.action) {
              return html`
                <button
                  className=${styles.btn}
                  onClick=${() => l.action(url, {})}
                >
                  ${l.label}
                </button>
              `;
            }

            if (href) {
              return html`
                <a href=${href} target="_blank">
                  <button className=${styles.btn}>${l.label}</button>
                </a>
              `;
            }

            return null;
          })}
        </div>
      `;
    };

    /**
     * @type {((_:{media: import("./types").DouyinMedia.MediaRoot | null, filenameBase: string})) => any}
     */
    const MediaTab = ({ media, filenameBase }) => {
      if (!media) return "无媒体信息";
      const { video, images, music } = media;

      /**
       * 视频部分
       */
      const VideoSection = () => {
        if (!video?.bitRateList?.length) return null;

        const coverUrl =
          video.originCoverUrlList?.[1] || video.originCoverUrlList?.[0];

        const videoLaunchers = launchers;

        return html`
          <fieldset className=${styles.fieldset}>
            <legend className=${styles.legend}>视频封面</legend>
            <div className=${styles.flexRow}>
              <img src=${coverUrl} className=${styles.imgCover} />
              <div>
                <p><strong>分辨率:</strong> ${video.width} × ${video.height}</p>
                <div style="margin-top: 10px;">
                  <a href=${coverUrl} target="_blank" className=${styles.btn}>
                    新标签打开
                  </a>
                  <a
                    href=${coverUrl}
                    download=${`cover_${filenameBase}.jpeg`}
                    className=${styles.btn}
                  >
                    下载封面
                  </a>
                </div>
              </div>
            </div>
          </fieldset>

          <fieldset className=${styles.fieldset}>
            <legend className=${styles.legend}>视频源</legend>
            <${Table}
              headers=${[
                "清晰度",
                "分辨率",
                "编码",
                "FPS",
                "码率(kbps)",
                "大小",
                "操作",
              ]}
              rows=${video.bitRateList.map((v) => [
                v.gearName,
                `${v.width}×${v.height}`,
                (v.isH265 ? "H.265" : "H.264") +
                  (v.format === "dash" ? " dash" : ""),
                v.fps,
                (v.bitRate / 1000).toFixed(0),
                fmt.size(v.dataSize),
                v.playApi
                  ? html`
                      <${LaunchButtons}
                        url=${v.playApi}
                        launchers=${videoLaunchers}
                      />
                    `
                  : "-",
              ])}
            />
          </fieldset>
        `;
      };

      // 图片部分
      const ImageSection = () => {
        if (!images?.length) return null;
        return html`
          <fieldset className=${styles.fieldset}>
            <legend className=${styles.legend}>图集 (${images.length}P)</legend>
            <${Table}
              headers=${["#", "类型", "预览", "分辨率", "大小", "下载"]}
              rows=${images.map((img, i) => {
                const isVid = !!img.video;
                const thumb = isVid
                  ? img.video.originCoverUrlList?.[0]
                  : img.urlList?.[0];
                const dl = isVid
                  ? img.video.playAddr?.[0]?.src
                  : img.urlList?.[0];
                return [
                  i + 1,
                  isVid ? "视频" : "图片",
                  html`<img
                    src=${thumb}
                    className=${styles.img}
                    loading="lazy"
                  />`,
                  isVid
                    ? `${img.video.width}×${img.video.height}`
                    : `${img.width}×${img.height}`,
                  isVid ? fmt.size(img.video.dataSize) : `-`,
                  dl ? html`<a href=${dl} target="_blank">链接</a>` : "-",
                ];
              })}
            />
          </fieldset>
        `;
      };

      // 音乐部分
      const MusicSection = () => {
        if (!music) return null;
        const dl_url = music.playUrl?.urlList?.[0] || "";
        return html`
          <fieldset className=${styles.fieldset}>
            <legend className=${styles.legend}>作品原声</legend>
            <div className=${styles.flexRow}>
              <img
                src=${music.coverThumb?.urlList?.[0]}
                style="width:60px; height:60px; border-radius:4px;"
                loading="lazy"
              />
              <div style="flex:1">
                <${KeyValue} label="标题">${music.title}</${KeyValue}>
                <${KeyValue} label="作者">${music.author}</${KeyValue}>
                <${KeyValue} label="时长">${music.duration} 秒</${KeyValue}>
                ${
                  dl_url &&
                  html`<button
                    type="button"
                    className=${styles.btn}
                    onClick=${() => mediaHandler.extract_original_audio()}
                  >
                    下载原声音频
                  </button>`
                }
                ${
                  dl_url &&
                  html`<audio controls preload="metadata" style="width:100%">
                    <source src=${dl_url} />
                  </audio>`
                }
              </div>
            </div>
          </fieldset>
        `;
      };

      return html`
        <div>
          <${VideoSection} />
          <${ImageSection} />
          <${MusicSection} />
        </div>
      `;
    };

    const AUTHOR_FOLLOWER_KEYS = Object.freeze([
      "followerCount",
      "follower_count",
      "fansCount",
      "fans_count",
      "mplatformFollowersCount",
      "mplatform_followers_count",
      "followerNum",
      "follower_num",
    ]);
    const AUTHOR_FAVORITE_KEYS = Object.freeze([
      "totalFavorited",
      "total_favorited",
      "totalFavoritedCount",
      "total_favorited_count",
      "favoritedCount",
      "favorited_count",
      "likedCount",
      "liked_count",
      "likeCount",
      "like_count",
    ]);

    /**
     * 作者统计字段兼容读取。
     *
     * 抖音 Web 不同页面/播放器版本的 authorInfo 字段并不完全一致：
     * 有的使用 camelCase，有的使用 snake_case，还有的把统计放在
     * author.stats / author.statistics 中。因此这里做有限、多字段兼容。
     */
    const readAuthorNumber = (author, media, keys) => {
      const sources = [
        author,
        author?.stats,
        author?.statistics,
        author?.userStats,
        author?.user_stats,
        media?.authorInfo,
        media?.authorInfo?.stats,
        media?.authorInfo?.statistics,
        media?.authorStats,
        media?.author_stats,
      ].filter(Boolean);

      for (const source of sources) {
        for (const key of keys) {
          const value = source?.[key];

          if (
            value !== undefined &&
            value !== null &&
            value !== "" &&
            Number.isFinite(Number(value))
          ) {
            return Number(value);
          }
        }
      }

      return null;
    };

    // 作者主页统计按 SecUID 缓存 10 分钟，避免反复开关详情页造成重复请求。
    const authorProfileCache = new Map();
    const AUTHOR_PROFILE_CACHE_TTL = 10 * 60 * 1000;

    const hasCompleteAuthorStats = (profile) =>
      readAuthorNumber(profile, null, AUTHOR_FOLLOWER_KEYS) != null &&
      readAuthorNumber(profile, null, AUTHOR_FAVORITE_KEYS) != null;

    /**
     * 合并不同数据通道返回的作者资料。
     *
     * 抖音有时会把 user 与 statistics 分开放置，或在接口降级时只返回一项
     * 统计。这里分别选择可信度最高的粉丝数和获赞数，避免“找到获赞数后就
     * 提前结束”，导致粉丝数一直显示为“—”。
     */
    const mergeAuthorProfiles = (...profiles) => {
      const valid = profiles.filter(
        (profile) => profile && typeof profile === "object"
      );
      if (!valid.length) return null;

      const result = Object.assign({}, ...valid);
      for (const profile of valid) {
        const followerCount = readAuthorNumber(
          profile,
          null,
          AUTHOR_FOLLOWER_KEYS
        );
        const totalFavorited = readAuthorNumber(
          profile,
          null,
          AUTHOR_FAVORITE_KEYS
        );
        if (result.followerCount == null && followerCount != null) {
          result.followerCount = followerCount;
        }
        if (result.totalFavorited == null && totalFavorited != null) {
          result.totalFavorited = totalFavorited;
        }
      }
      return result;
    };

    /**
     * 从接口或页面预载 JSON 中寻找作者统计对象。
     * 只做有深度和节点上限的遍历，避免处理异常大对象时占用过多资源。
     */
    const selectAuthorProfile = (payload, secUid) => {
      if (!payload || typeof payload !== "object") return null;

      const expectedId = String(secUid || "");
      const queue = [{ value: payload, depth: 0 }];
      const seen = new Set();
      let cursor = 0;
      let visited = 0;
      let best = null;
      let bestScore = -1;
      let bestFollower = null;
      let bestFollowerScore = -1;
      let bestFavorite = null;
      let bestFavoriteScore = -1;

      while (cursor < queue.length && visited < 2500) {
        const { value, depth } = queue[cursor++];
        if (!value || typeof value !== "object" || seen.has(value)) continue;
        seen.add(value);
        visited++;

        const followerCount = readAuthorNumber(value, null, AUTHOR_FOLLOWER_KEYS);
        const totalFavorited = readAuthorNumber(
          value,
          null,
          AUTHOR_FAVORITE_KEYS
        );
        const candidateId = String(
          value.secUid ||
            value.sec_uid ||
            value.secUserId ||
            value.sec_user_id ||
            ""
        );

        if (followerCount != null || totalFavorited != null) {
          const idMatches = expectedId && candidateId === expectedId;
          const idConflicts = expectedId && candidateId && candidateId !== expectedId;
          let score = followerCount != null && totalFavorited != null ? 12 : 5;
          if (idMatches) score += 30;
          if (idConflicts) score -= 30;
          if (value.nickname || value.nickName || value.uid) score += 3;
          score -= depth * 0.2;

          if (followerCount != null && score > bestFollowerScore) {
            bestFollowerScore = score;
            bestFollower = followerCount;
          }
          if (totalFavorited != null && score > bestFavoriteScore) {
            bestFavoriteScore = score;
            bestFavorite = totalFavorited;
          }
          if (score > bestScore) {
            bestScore = score;
            best = { ...value };
          }
        }

        if (depth >= 8) continue;
        const priorityKeys = [
          "user",
          "userInfo",
          "user_info",
          "author",
          "authorInfo",
          "author_info",
          "stats",
          "statistics",
          "data",
        ];
        const pushed = new Set();
        for (const key of priorityKeys) {
          const child = value[key];
          if (child && typeof child === "object") {
            queue.push({ value: child, depth: depth + 1 });
            pushed.add(child);
          }
        }
        for (const child of Array.isArray(value) ? value : Object.values(value)) {
          if (child && typeof child === "object" && !pushed.has(child)) {
            queue.push({ value: child, depth: depth + 1 });
          }
        }
      }

      return bestFollower != null || bestFavorite != null
        ? {
            ...(best || {}),
            followerCount: bestFollower,
            totalFavorited: bestFavorite,
          }
        : null;
    };

    const getAuthorPageWindow = () => {
      try {
        if (typeof unsafeWindow !== "undefined") return unsafeWindow;
      } catch {}
      return window;
    };

    const readCookieValue = (name) => {
      const prefix = `${name}=`;
      const part = String(document.cookie || "")
        .split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith(prefix));
      return part ? decodeURIComponent(part.slice(prefix.length)) : "";
    };

    /**
     * 从抖音页面已经发出的同源接口请求中复用公开设备参数。
     * 不读取响应内容，不监听网络，也不持续轮询；只在打开作者信息且缺少统计
     * 时读取一次 Performance 记录，以提高官方资料接口的成功率。
     */
    const collectAuthorApiContext = () => {
      const currentScreen = getAuthorPageWindow()?.screen;
      const context = new URLSearchParams({
        device_platform: "webapp",
        aid: "6383",
        channel: "channel_pc_web",
        publish_video_strategy_type: "2",
        source: "channel_pc_web",
        pc_client_type: "1",
        cookie_enabled: navigator.cookieEnabled ? "true" : "false",
        browser_language: navigator.language || "zh-CN",
        browser_platform: navigator.platform || "Win32",
        browser_online: navigator.onLine === false ? "false" : "true",
        screen_width: String(currentScreen?.width || 1920),
        screen_height: String(currentScreen?.height || 1080),
      });
      const reusableKeys = new Set([
        "device_platform",
        "aid",
        "channel",
        "pc_client_type",
        "version_code",
        "version_name",
        "cookie_enabled",
        "screen_width",
        "screen_height",
        "browser_language",
        "browser_platform",
        "browser_name",
        "browser_version",
        "browser_online",
        "engine_name",
        "engine_version",
        "os_name",
        "os_version",
        "cpu_core_num",
        "device_memory",
        "platform",
        "downlink",
        "effective_type",
        "round_trip_time",
        "webid",
        "verifyFp",
        "fp",
        "msToken",
      ]);

      try {
        const pageWindow = getAuthorPageWindow();
        const entries = pageWindow.performance?.getEntriesByType?.("resource") || [];
        for (let index = entries.length - 1; index >= 0; index--) {
          const entryUrl = new URL(entries[index]?.name || "", location.href);
          if (
            entryUrl.origin !== location.origin ||
            !entryUrl.pathname.startsWith("/aweme/v1/web/")
          ) {
            continue;
          }
          for (const [key, value] of entryUrl.searchParams) {
            if (reusableKeys.has(key) && value) context.set(key, value);
          }
          break;
        }
      } catch {}

      const msToken = readCookieValue("msToken");
      if (msToken && !context.has("msToken")) context.set("msToken", msToken);
      return context;
    };

    const extractAuthorSignature = (result, fallbackName) => {
      if (!result) return null;
      if (typeof result === "string") {
        try {
          const signedUrl = new URL(result, location.href);
          for (const key of ["a_bogus", "X-Bogus", "_signature"]) {
            const value = signedUrl.searchParams.get(key);
            if (value) return { name: key, value };
          }
        } catch {}
        return result.length > 8
          ? { name: fallbackName, value: result }
          : null;
      }
      if (typeof result !== "object") return null;

      for (const key of ["a_bogus", "X-Bogus", "_signature", "signature"]) {
        const value = result[key] ?? result.data?.[key];
        if (typeof value === "string" && value.length > 8) {
          return { name: key === "signature" ? fallbackName : key, value };
        }
      }
      return null;
    };

    /**
     * 使用抖音网页自身已加载的签名模块为作者资料请求补充动态签名。
     * 签名函数由抖音页面提供；找不到或调用失败时静默退回普通同源请求。
     */
    const signAuthorApiUrl = async (inputUrl) => {
      const url = new URL(inputUrl);
      const pageWindow = getAuthorPageWindow();
      let sdk = pageWindow?.byted_acrawler;

      // document-idle 时签名模块通常已经存在；最多短等 1.2 秒，不常驻轮询。
      for (let waited = 0; !sdk && waited < 1200; waited += 100) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        sdk = pageWindow?.byted_acrawler;
      }
      if (!sdk) return url.href;

      const query = url.searchParams.toString();
      const attempts = [];
      if (typeof sdk.frontierSign === "function") {
        attempts.push(
          { fallbackName: "a_bogus", run: () => sdk.frontierSign(query) },
          {
            fallbackName: "X-Bogus",
            run: () => sdk.frontierSign({ url: url.href }),
          }
        );
      }
      if (typeof sdk.sign === "function") {
        attempts.push(
          { fallbackName: "_signature", run: () => sdk.sign({ url: url.href }) },
          { fallbackName: "_signature", run: () => sdk.sign(url.href) }
        );
      }

      for (const attempt of attempts) {
        try {
          const result = await Promise.resolve(attempt.run());
          const signature = extractAuthorSignature(result, attempt.fallbackName);
          if (signature) {
            url.searchParams.set(signature.name, signature.value);
            return url.href;
          }
        } catch {}
      }
      return url.href;
    };

    const fetchAuthorResource = async (url, type, outerSignal) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      outerSignal?.addEventListener("abort", abort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 8000);

      try {
        const response = await fetch(url, {
          credentials: "include",
          headers: {
            Accept: type === "json" ? "application/json" : "text/html",
          },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await (type === "json" ? response.json() : response.text());
      } catch (error) {
        if (timedOut && !outerSignal?.aborted && error?.name === "AbortError") {
          throw new Error("作者资料请求超时");
        }
        throw error;
      } finally {
        clearTimeout(timer);
        outerSignal?.removeEventListener("abort", abort);
      }
    };

    /**
     * 按需补取作者主页统计。
     *
     * 第一通道读取同源作者资料接口；若接口因页面版本或风控不可用，再从作者
     * 主页预载 JSON 中读取。两条通道均失败时只在作者信息页显示原因，不弹窗。
     */
    const loadAuthorProfile = async (secUid, signal) => {
      const key = String(secUid || "").trim();
      if (!key) throw new Error("缺少作者标识");

      const cached = authorProfileCache.get(key);
      if (cached && Date.now() - cached.savedAt < AUTHOR_PROFILE_CACHE_TTL) {
        return cached.data;
      }

      let lastError = null;
      let collectedProfile = null;
      try {
        const apiUrl = new URL("/aweme/v1/web/user/profile/other/", location.origin);
        const apiContext = collectAuthorApiContext();
        apiContext.set("publish_video_strategy_type", "2");
        apiContext.set("source", "channel_pc_web");
        apiContext.set("personal_center_strategy", "1");
        apiContext.set("sec_user_id", key);
        apiUrl.search = apiContext.toString();

        const signedApiUrl = await signAuthorApiUrl(apiUrl.href);
        const candidates = [...new Set([signedApiUrl, apiUrl.href])];
        let apiReturnedProfile = false;

        // 签名请求优先；若页面签名模块版本不兼容，再保留原普通请求兜底。
        for (const candidateUrl of candidates) {
          try {
            const payload = await fetchAuthorResource(
              candidateUrl,
              "json",
              signal
            );
            const profile = selectAuthorProfile(payload, key);
            if (profile) apiReturnedProfile = true;
            collectedProfile = mergeAuthorProfiles(collectedProfile, profile);
            if (hasCompleteAuthorStats(collectedProfile)) {
              authorProfileCache.set(key, {
                data: collectedProfile,
                savedAt: Date.now(),
              });
              return collectedProfile;
            }
          } catch (error) {
            if (error?.name === "AbortError") throw error;
            lastError = error;
          }
        }
        lastError = new Error(
          apiReturnedProfile
            ? "作者接口仅返回部分统计"
            : lastError?.message || "作者接口未返回统计数据"
        );
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        lastError = error;
      }

      try {
        const pageUrl = new URL(`/user/${encodeURIComponent(key)}`, location.origin);
        const pageText = await fetchAuthorResource(pageUrl.href, "text", signal);
        const page = new DOMParser().parseFromString(pageText, "text/html");
        const scripts = [
          page.querySelector("#__UNIVERSAL_DATA_FOR_REHYDRATION__")?.textContent,
          page.querySelector("#RENDER_DATA")?.textContent,
          ...Array.from(page.querySelectorAll('script[type="application/json"]'))
            .slice(0, 8)
            .map((script) => script.textContent),
        ].filter(Boolean);

        for (const raw of scripts) {
          const variants = [raw];
          try {
            const decoded = decodeURIComponent(raw);
            if (decoded !== raw) variants.push(decoded);
          } catch {}

          for (const candidateText of variants) {
            try {
              const payload = JSON.parse(candidateText);
              const profile = selectAuthorProfile(payload, key);
              collectedProfile = mergeAuthorProfiles(collectedProfile, profile);
              if (hasCompleteAuthorStats(collectedProfile)) {
                authorProfileCache.set(key, {
                  data: collectedProfile,
                  savedAt: Date.now(),
                });
                return collectedProfile;
              }
            } catch {}
          }
        }
        lastError = new Error(
          collectedProfile
            ? "作者主页仅返回部分统计"
            : "作者主页未包含可读取的统计数据"
        );
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        lastError = error;
      }

      // 部分数据仍交给界面使用，但不写入缓存，便于用户点击重试后重新请求。
      if (collectedProfile) return collectedProfile;
      throw lastError || new Error("作者统计暂时不可用");
    };

    const AuthorTab = ({ author, media }) => {
      const [profileState, setProfileState] = useState({
        secUid: "",
        status: "idle",
        data: null,
        message: "",
      });
      const [retryToken, setRetryToken] = useState(0);
      const secUid = String(
        author?.secUid ||
          author?.sec_uid ||
          media?.authorInfo?.secUid ||
          media?.authorInfo?.sec_uid ||
          ""
      );
      const baseFollowerCount = readAuthorNumber(
        author,
        media,
        AUTHOR_FOLLOWER_KEYS
      );
      const baseTotalFavorited = readAuthorNumber(
        author,
        media,
        AUTHOR_FAVORITE_KEYS
      );

      useEffect(() => {
        if (
          !author ||
          !secUid ||
          (baseFollowerCount != null && baseTotalFavorited != null)
        ) {
          return undefined;
        }

        const controller = new AbortController();
        let active = true;
        setProfileState({
          secUid,
          status: "loading",
          data: null,
          message: "",
        });

        loadAuthorProfile(secUid, controller.signal)
          .then((data) => {
            if (!active) return;
            const completedData = mergeAuthorProfiles(
              {
                followerCount: baseFollowerCount,
                totalFavorited: baseTotalFavorited,
              },
              data
            );
            if (hasCompleteAuthorStats(completedData)) {
              authorProfileCache.set(secUid, {
                data: completedData,
                savedAt: Date.now(),
              });
            }
            setProfileState({
              secUid,
              status: "ready",
              data: completedData,
              message: "",
            });
          })
          .catch((error) => {
            if (!active || error?.name === "AbortError") return;
            setProfileState({
              secUid,
              status: "failed",
              data: null,
              message: error?.message || "作者统计暂时不可用",
            });
          });

        return () => {
          active = false;
          controller.abort();
        };
      }, [
        secUid,
        baseFollowerCount,
        baseTotalFavorited,
        retryToken,
      ]);

      if (!author) return html`<div>无作者信息</div>`;

      const fetchedProfile =
        profileState.secUid === secUid ? profileState.data : null;
      const followerCount =
        baseFollowerCount ??
        readAuthorNumber(fetchedProfile, null, AUTHOR_FOLLOWER_KEYS);
      const totalFavorited =
        baseTotalFavorited ??
        readAuthorNumber(fetchedProfile, null, AUTHOR_FAVORITE_KEYS);
      const needsRemoteStats =
        followerCount == null || totalFavorited == null;
      const retryProfile = () => {
        if (secUid) authorProfileCache.delete(secUid);
        setRetryToken((value) => value + 1);
      };

      return html`
        <div className=${styles.authorHeader}>
          <img
            src=${author.avatarThumb?.urlList?.[0]}
            style="width:80px;height:80px;border-radius:50%;object-fit:cover;flex:0 0 80px;"
          />
          <div className=${styles.authorMeta}>
            <h3 className=${styles.authorName}>
              ${author.nickname || "未知作者"}
            </h3>
            ${
              author.secUid
                ? html`
                    <a
                      href=${`https://www.douyin.com/user/${author.secUid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className=${styles.authorHomeBtn}
                    >
                      访问主页
                    </a>
                  `
                : null
            }
          </div>
        </div>
        <${KeyValue} label="认证"
          >${author.customVerify || author.enterpriseVerifyReason}</${KeyValue}
        >
        <${Copyable} label="UID" value=${author.uid} />
        <${Copyable} label="SecUID" value=${author.secUid} />
        <${KeyValue} label="粉丝数">
          ${followerCount == null ? "-" : fmt.num(followerCount)}
        </${KeyValue}>
        <${KeyValue} label="获赞数">
          ${totalFavorited == null ? "-" : fmt.num(totalFavorited)}
        </${KeyValue}>
        ${
          needsRemoteStats && !secUid
            ? html`<div className="dy-dl-author-stat-status" data-state="failed">
                当前作品未带作者主页标识，无法补取统计
              </div>`
            : null
        }
        ${
          needsRemoteStats && profileState.status === "loading"
            ? html`<div className="dy-dl-author-stat-status" data-state="loading">
                正在获取作者主页统计…
              </div>`
            : null
        }
        ${
          needsRemoteStats && profileState.status === "failed"
            ? html`<div className="dy-dl-author-stat-status" data-state="failed">
                <span>主页统计暂时无法读取</span>
                <button
                  type="button"
                  className="dy-dl-author-stat-retry"
                  onClick=${retryProfile}
                >
                  重试
                </button>
              </div>`
            : null
        }
        ${
          needsRemoteStats && profileState.status === "ready"
            ? html`<div className="dy-dl-author-stat-status" data-state="failed">
                <span>作者主页仅返回了部分统计</span>
                <button
                  type="button"
                  className="dy-dl-author-stat-retry"
                  onClick=${retryProfile}
                >
                  重新获取
                </button>
              </div>`
            : null
        }
      `;
    };

    const PostTab = ({ media }) => html`
      <fieldset className=${styles.fieldset}>
        <legend className=${styles.legend}>描述</legend>
        <div style="white-space: pre-wrap; line-height: 1.5;">
          ${media.desc || "无描述"}
        </div>
      </fieldset>
      <fieldset className=${styles.fieldset}>
        <legend className=${styles.legend}>数据统计</legend>
        <${KeyValue} label="发布时间">${fmt.ts(media.createTime)}</${KeyValue}>
        <${Copyable} label="分享链接" value=${media.shareInfo?.shareUrl} />
        <${KeyValue} label="点赞">${fmt.num(
      media.stats?.diggCount
    )}</${KeyValue}>
        <${KeyValue} label="评论">${fmt.num(
      media.stats?.commentCount
    )}</${KeyValue}>
        <${KeyValue} label="收藏">${fmt.num(
      media.stats?.collectCount
    )}</${KeyValue}>
        <${KeyValue} label="分享">${fmt.num(
      media.stats?.shareCount
    )}</${KeyValue}>
      </fieldset>
      <fieldset className=${styles.fieldset}>
        <legend className=${styles.legend}>ID 信息</legend>
        <${Copyable} label="Aweme ID" value=${media.awemeId} />
        <${Copyable} label="Group ID" value=${media.groupId} />
      </fieldset>
      <fieldset className=${styles.fieldset}>
        <legend className=${styles.legend}>权限 / 状态</legend>
        <${KeyValue} label="允许评论"
          >${media.awemeControl?.canComment ? "是" : "否"}</${KeyValue}
        >
        <${KeyValue} label="允许分享"
          >${media.awemeControl?.canShare ? "是" : "否"}</${KeyValue}
        >
        <${KeyValue} label="允许下载"
          >${media.download?.allowDownload ? "是" : "否"}</${KeyValue}
        >
        <${KeyValue} label="私密视频"
          >${media.isPrivate ? "是" : "否"}</${KeyValue}
        >
      </fieldset>
    `;

    const JsonTab = ({ data }) => {
      const codeRef = useRef(null);
      const selectAll = () => {
        const range = document.createRange();
        range.selectNodeContents(codeRef.current);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      };

      return html`
        <fieldset
          style=${{
            overflow: "hidden",
            border: "1px solid #ddd",
            borderRadius: "4px",
            padding: "10px",
            maxHeight: "100%",
          }}
        >
          <legend className=${styles.legend}>
            原始数据
            <button onClick=${selectAll} className=${styles.btn}>全选</button>
            <button onClick=${() => console.log(data)} className=${styles.btn}>
              输出到控制台
            </button>
          </legend>
          <pre className=${styles.jsonPre}>
            <code ref=${codeRef}>${JSON.stringify(data, null, 2)}</code>
          </pre>
        </fieldset>
      `;
    };

    const DanmakuTab = () => {
      const [danmakuList, setDanmakuList] = useState([]);
      const [loading, setLoading] = useState(false);

      const fetchDanmaku = () => {
        try {
          setLoading(true);
          const player = mediaHandler.player;
          if (!player || !player.danmaku || !player.danmaku.main) {
            setDanmakuList([]);
            return;
          }
          const rawData = player.danmaku.main.data || [];
          const formatted = rawData.map((item, idx) => ({
            index: idx + 1,
            startTime: item.start,
            startTimeStr: msToAssTime(item.start),
            text: item.text || "",
            color: item.style?.color || "#FFFFFF",
            fontSize: item.style?.fontSize || 20,
            raw: item,
            uid: item.user_id || 0,
            score: item.score || 0,
          }));
          setDanmakuList(formatted);
        } catch (err) {
          console.error("获取弹幕失败", err);
          setDanmakuList([]);
        } finally {
          setLoading(false);
        }
      };

      const copySingleText = async (text) => {
        const ok = await copyText(text);
        ToastCenter.update(ok ? "弹幕文本已复制" : "复制失败，请重试", 1800);
      };

      const copyAllText = async () => {
        const allText = danmakuList.map((item) => item.text).join("\n");
        const ok = await copyText(allText);
        ToastCenter.update(
          ok ? `已复制 ${danmakuList.length} 条弹幕文本` : "复制失败，请重试",
          2000
        );
      };

      const copyAllJSON = async () => {
        const jsonStr = JSON.stringify(
          danmakuList.map((item) => item.raw),
          null,
          2
        );
        const ok = await copyText(jsonStr);
        ToastCenter.update(ok ? "弹幕 JSON 数据已复制" : "复制失败，请重试", 1800);
      };

      useEffect(() => {
        fetchDanmaku();
      }, []);

      return html`
        <div className=${styles.danmakuContainer}>
          <div className=${styles.danmakuHeader}>
            <h4 className=${styles.danmakuTitle}>
              弹幕列表 (${danmakuList.length}条)
            </h4>
            <div className=${styles.danmakuButtonGroup}>
              <button
                className=${styles.btn}
                onClick=${fetchDanmaku}
                disabled=${loading}
              >
                刷新
              </button>
              <button
                className=${styles.btn}
                onClick=${copyAllText}
                disabled=${danmakuList.length === 0}
              >
                复制全部文本
              </button>
              <button
                className=${styles.btn}
                onClick=${copyAllJSON}
                disabled=${danmakuList.length === 0}
              >
                复制 JSON
              </button>
            </div>
          </div>
          ${loading &&
          html`<div className=${styles.danmakuEmpty}>加载中...</div>`}
          ${!loading &&
          danmakuList.length === 0 &&
          html`
            <div className=${styles.danmakuEmpty}>
              暂无弹幕数据，请确保正在播放一个视频且弹幕已加载。
            </div>
          `}
          ${!loading &&
          danmakuList.length > 0 &&
          html`
            <div className=${styles.danmakuTableWrapper}>
              <table className=${styles.table}>
                <thead>
                  <tr>
                    <th className=${styles.th}>#</th>
                    <th className=${styles.th}>时间</th>
                    <th className=${styles.th}>UID</th>
                    <th className=${styles.th}>内容</th>
                    <th className=${styles.th}>评分</th>
                    <th className=${styles.th}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  ${danmakuList.map(
                    (item) => html`
                      <tr key=${item.index}>
                        <td className=${styles.td}>${item.index}</td>
                        <td className=${styles.td}>${item.startTimeStr}</td>
                        <td className=${styles.td}>${item.uid}</td>
                        <td className=${styles.td} title=${item.text}>
                          ${item.text}
                        </td>
                        <td className=${styles.td}>${item.score.toFixed(2)}</td>
                        <td className=${styles.td}>
                          <button
                            className=${styles.btn}
                            onClick=${() => copySingleText(item.text)}
                          >
                            复制
                          </button>
                        </td>
                      </tr>
                    `
                  )}
                </tbody>
              </table>
            </div>
          `}
        </div>
      `;
    };

    // --- 主入口组件 ---
    const App = ({ media, filenameBase }) => {
      const [activeTab, setActiveTab] = useState("media");

      const tabs = [
        { id: "media", title: "媒体资源", Comp: MediaTab },
        { id: "author", title: "作者信息", Comp: AuthorTab },
        { id: "post", title: "作品信息", Comp: PostTab },
        { id: "danmaku", title: "弹幕列表", Comp: DanmakuTab },
        { id: "json", title: "JSON", Comp: JsonTab },
      ];

      const getProps = (id) => {
        switch (id) {
          case "author":
            return {
              author: media.authorInfo,
              media,
            };
          case "json":
            return { data: media };
          default:
            return { media, filenameBase };
        }
      };

      const ActiveComp = tabs.find((t) => t.id === activeTab).Comp;

      return html`
        <div className=${styles.container}>
          <nav className=${styles.nav}>
            ${tabs.map(
              (t) => html`
                <button
                  onClick=${() => setActiveTab(t.id)}
                  className=${navBtnClass(activeTab === t.id)}
                >
                  ${t.title}
                </button>
              `
            )}
          </nav>
          <div className=${styles.content}>
            <${ActiveComp} ...${getProps(activeTab)} />
          </div>
        </div>
      `;
    };

    return { App };
  })();
  // #endregion

  // 配置 config modal
  // #region Config Modal Components
  const ConfigModalComponents = (() => {
    /**
     * @type {import('preact/hooks')}
     */
    const { useState, useEffect, useMemo, html } = getHtmPreact();
    /**
     * @type {import('preact').h}
     */
    const cssFn = createCSS();

    const classNames = {
      // 容器
      container: cssFn({
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        background: theme.colors.bgOverlay,
        borderRadius: theme.borderRadius.lg,
        color: theme.colors.textPrimary,
      }),

      // 导航栏
      nav: cssFn({
        width: "172px",
        flex: "0 0 172px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        padding: "18px 12px",
        borderRight: `1px solid ${theme.colors.borderLight}`,
        background: theme.colors.bgNav,
      }),

      navBtn: cssFn({
        minHeight: "38px",
        padding: "0 12px",
        border: "1px solid transparent",
        borderRadius: "9px",
        background: "transparent",
        cursor: "pointer",
        textAlign: "left",
        fontWeight: 600,
        color: theme.colors.textMuted,
        "&:hover": {
          background: theme.colors.bgHover,
          color: theme.colors.textSecondary,
        },
      }),

      navBtnActive: cssFn({
        background: theme.colors.primarySoft,
        borderColor: theme.colors.primaryBorder,
        fontWeight: 700,
        color: theme.colors.primaryLight,
      }),

      // 内容区
      content: cssFn({
        flex: "1 1 auto",
        minWidth: 0,
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        padding: theme.spacing.xl,
        scrollbarGutter: "stable",
      }),

      // 表单区块
      fieldset: cssFn({
        border: `1px solid ${theme.colors.borderMedium}`,
        borderRadius: theme.borderRadius.md,
        marginBottom: theme.spacing.xl,
        padding: theme.spacing.lg,
        background: theme.colors.bgFieldset,
      }),

      legend: cssFn({
        fontWeight: "bold",
        padding: `0 ${theme.spacing.sm}`,
        color: "rgba(255,255,255,0.9)",
        background: "rgba(18,18,20,0.8)",
        borderRadius: theme.borderRadius.full,
        fontSize: theme.fontSize.sm,
      }),

      row: cssFn({
        display: "flex",
        alignItems: "center",
        marginBottom: "14px",
      }),

      label: cssFn({
        width: "120px",
        flexShrink: 0,
        color: "rgba(255,255,255,0.85)",
        fontSize: theme.fontSize.sm,
      }),

      // 输入框基础样式
      inputBase: cssFn({
        flex: 1,
        padding: `${theme.spacing.sm} ${theme.spacing.md}`,
        background: "rgba(255,255,255,0.08)",
        border: `1px solid ${theme.colors.borderInput}`,
        borderRadius: theme.borderRadius.sm,
        color: theme.colors.textPrimary,
        fontSize: theme.fontSize.sm,
        outline: "none",
        "&:focus": {
          borderColor: theme.colors.primary,
        },
      }),

      select: cssFn({
        flex: 1,
        padding: `${theme.spacing.sm} ${theme.spacing.md}`,
        background: "rgba(255,255,255,0.08)",
        border: `1px solid ${theme.colors.borderInput}`,
        borderRadius: theme.borderRadius.sm,
        color: theme.colors.textPrimary,
        fontSize: theme.fontSize.sm,
        outline: "none",
        cursor: "pointer",
        // select 的 option 样式（优化）
        "& option": {
          background: "#2c2c2e",
          color: theme.colors.textPrimary,
          padding: theme.spacing.sm,
        },
      }),

      checkbox: cssFn({
        marginRight: theme.spacing.sm,
        accentColor: theme.colors.primary,
      }),

      btn: cssFn({
        padding: `6px 16px`,
        background: theme.colors.primary,
        color: theme.colors.textPrimary,
        border: "none",
        borderRadius: theme.borderRadius.full,
        cursor: "pointer",
        fontSize: theme.fontSize.xs,
        "&:hover": {
        },
      }),

      btnDanger: cssFn({
        padding: `6px 16px`,
        background: "rgba(254,44,85,0.2)",
        color: theme.colors.primaryLight,
        border: `1px solid rgba(254,44,85,0.5)`,
        borderRadius: theme.borderRadius.full,
        cursor: "pointer",
        fontSize: theme.fontSize.xs,
        "&:hover": {
          background: "rgba(254,44,85,0.3)",
        },
      }),

      table: cssFn({
        width: "100%",
        fontSize: theme.fontSize.sm,
        borderCollapse: "collapse",
      }),

      th: cssFn({
        border: `1px solid ${theme.colors.borderLight}`,
        padding: theme.spacing.sm,
        background: "rgba(0,0,0,0.3)",
        textAlign: "left",
        color: "rgba(255,255,255,0.9)",
      }),

      td: cssFn({
        border: `1px solid ${theme.colors.borderLight}`,
        padding: theme.spacing.sm,
        color: theme.colors.textSecondary,
      }),

      range: cssFn({
        flex: 1,
        marginRight: "10px",
      }),

      rangeValue: cssFn({
        width: "40px",
        textAlign: "center",
        color: theme.colors.textPrimary,
      }),

      // 辅助布局
      flexBetween: cssFn({
        display: "flex",
        justifyContent: "space-between",
        marginBottom: "15px",
      }),

      hintText: cssFn({
        fontSize: theme.fontSize.xs,
        color: theme.colors.textDim,
        marginTop: "5px",
      }),

      codeBlock: cssFn({
        fontSize: theme.fontSize.xs,
        background: "rgba(0,0,0,0.4)",
        padding: "2px 4px",
        borderRadius: "4px",
      }),

      hr: cssFn({
        margin: `${theme.spacing.sm} 0`,
      }),
    };

    /**
     * 基本设置页
     * @param {{config: Config, onConfigChange: Function}} param0
     * @returns
     */
    const SettingsTab = ({ config, onConfigChange }) => {
      const [filenameTemplate, setFilenameTemplate] = useState(
        config.features.filename_template
      );
      const [filename_len, set_filename_len] = useState(
        config.features.filename_max_length
      );
      const [videoMode, setVideoMode] = useState(
        config.features.download_video_mode
      );
      const [videoCodec, setVideoCodec] = useState(
        config.features.video_download_codecs || "default"
      );
      const [imageConvertCodec, setImageConvertCodec] = useState(
        config.features.image_convert_codecs || "default"
      );
      const [imageResize, setImageResize] = useState(
        config.features.image_resize_codecs || "default"
      );
      const [imageQuality, setImageQuality] = useState(
        config.features.image_quality !== undefined
          ? config.features.image_quality
          : 80
      );
      const [using_downloader, set_UsingDownloader] = useState(
        config.features.using_downloader || "browser"
      );
      const [browserDownloadMode, setBrowserDownloadMode] = useState(
        config.features.downloader_config?.browser?.mode || "auto"
      );
      // const [showProfilePanel, setShowProfilePanel] = useState(
      //   config.features.enable_profile_downloader !== false
      // );

      // filename 实时刷新测试
      const filename_test = useMemo(() => {
        try {
          return mediaHandler._build_filename(
            mediaHandler.current_media,
            filenameTemplate,
            filename_len,
            true
          );
        } catch (error) {
          console.error(error);
          return `ERROR: ${error.message}`;
        }
      }, [filenameTemplate, filename_len]);

      const handleSave = () => {
        config.features.filename_template = filenameTemplate;
        config.features.filename_max_length = filename_len;
        config.features.download_video_mode = videoMode;
        config.features.video_download_codecs = videoCodec;
        config.features.image_convert_codecs = imageConvertCodec;
        config.features.image_resize_codecs = imageResize;
        config.features.image_quality = imageQuality;
        config.features.using_downloader = using_downloader;
        config.features.downloader_config = config.features.downloader_config || {};
        config.features.downloader_config.browser = {
          ...(config.features.downloader_config.browser || {}),
          mode: browserDownloadMode,
        };
        // config.features.enable_profile_downloader = showProfilePanel;
        config.save();
        ToastCenter.update("设置已保存", 1800);
      };

      return html`
        <div>
          <div
            className=${classNames.flexBetween}
            style="justify-content: flex-end;"
          >
            <button className=${classNames.btn} onClick=${handleSave}>
              保存设置
            </button>
          </div>

          <fieldset className=${classNames.fieldset}>
            <legend className=${classNames.legend}>下载器配置</legend>
            <div className=${classNames.row}>
              <label className=${classNames.label}>下载器：</label>
              <select
                className=${classNames.select}
                value=${using_downloader}
                onChange=${(e) => set_UsingDownloader(e.target.value)}
              >
                <option value="browser">默认（浏览器）</option>
                <option value="abdm">AB Download Manager</option>
                <option value="aria2">Aria2</option>
              </select>
            </div>
            ${using_downloader === "browser"
              ? html`
                  <div className=${classNames.row}>
                    <label className=${classNames.label}>浏览器模式：</label>
                    <select
                      className=${classNames.select}
                      value=${browserDownloadMode}
                      onChange=${(e) => setBrowserDownloadMode(e.target.value)}
                    >
                      <option value="auto">自动选择（Chrome 流式优先）</option>
                      <option value="file_system">文件系统流式优先</option>
                      <option value="gm_download">Tampermonkey 下载优先</option>
                      <option value="native">浏览器原生直链</option>
                      <option value="blob">Blob 兼容模式</option>
                    </select>
                  </div>
                  <div className=${classNames.hintText}>
                    推荐“自动选择”：Chrome/Chromium 先选择保存位置再流式写入；
                    其它浏览器自动降级到 GM_download、原生直链或 Blob。
                  </div>
                `
              : null}
            <div className=${classNames.hintText}>
              如果选择非浏览器下载，之后的下载将会发起rpc调用你部署的外部下载器。
              <br />注意：使用外部下载器时，图片压缩转码功能不可用。
            </div>
          </fieldset>

          <fieldset className=${classNames.fieldset}>
            <legend className=${classNames.legend}>文件命名</legend>
            <div className=${classNames.row}>
              <label className=${classNames.label}>模板：</label>
              <input
                type="text"
                className=${classNames.inputBase}
                value=${filenameTemplate}
                onInput=${(e) => setFilenameTemplate(e.target.value)}
                placeholder=${`例：\${nickname}_\${short_id}`}
              />
            </div>
            <div className=${classNames.hintText} style="margin-top: 5px;">
              可用变量：<code className=${classNames.codeBlock}>nickname</code>,
              <code className=${classNames.codeBlock}>short_id</code>,
              <code className=${classNames.codeBlock}>tags</code>,
              <code className=${classNames.codeBlock}>desc</code>,
              <code className=${classNames.codeBlock}>aweme_id</code>,
              <code className=${classNames.codeBlock}>create_date_YYYYMMDD</code
              >,
              <code className=${classNames.codeBlock}>now_YYYYMMDD_HHmmss</code>
              等。
            </div>
            <div className=${classNames.row}>
              <label className=${classNames.label}>文件名长度：</label>
              <input
                type="number"
                max=${128}
                min=${12}
                className=${classNames.inputBase}
                value=${filename_len}
                onInput=${(e) => set_filename_len(e.target.value)}
              />
            </div>
            <div className=${classNames.hintText} style="margin-top: 5px;">
              <hr className=${classNames.hr} />
              当前文件名：<code className=${classNames.codeBlock}
                >${filename_test}</code
              >
            </div>
          </fieldset>

          <fieldset className=${classNames.fieldset}>
            <legend className=${classNames.legend}>视频下载设置</legend>
            <div className=${classNames.row}>
              <label className=${classNames.label}>分辨率策略：</label>
              <select
                className=${classNames.select}
                value=${videoMode}
                onChange=${(e) => setVideoMode(e.target.value)}
              >
                <option value="default">默认（智能选择）</option>
                <option value="max">最高清晰度</option>
                <option value="min">最低清晰度</option>
                <option value="max_file">最大文件</option>
                <option value="min_file">最小文件</option>
                <option value="1080P">1080P</option>
                <option value="720P">720P</option>
                <option value="540P">540P</option>
                <option value="360P">360P</option>
                <option value="2K">2K</option>
                <option value="4K">4K</option>
              </select>
            </div>
            <div className=${classNames.row}>
              <label className=${classNames.label}>编码偏好：</label>
              <select
                className=${classNames.select}
                value=${videoCodec}
                onChange=${(e) => setVideoCodec(e.target.value)}
              >
                <option value="default">默认（无偏好）</option>
                <option value="h264">只下载 H264</option>
                <option value="h265">只下载 H265</option>
                <option value="h264_prefer">优先 H264</option>
                <option value="h265_prefer">优先 H265</option>
              </select>
            </div>
            <div className=${classNames.hintText}>
              注意：实际下载时根据可用地址匹配，若不支持所选编码或分辨率则回退。
            </div>
          </fieldset>

          <fieldset className=${classNames.fieldset}>
            <legend className=${classNames.legend}>图片下载设置</legend>
            <div className=${classNames.row}>
              <label className=${classNames.label}>转码编码偏好：</label>
              <select
                className=${classNames.select}
                value=${imageConvertCodec}
                onChange=${(e) => setImageConvertCodec(e.target.value)}
              >
                <option value="default">默认（保持原格式）</option>
                <option value="png">转码为 PNG</option>
                <option value="jpg">转码为 JPG</option>
                <option value="webp">转码为 WebP</option>
              </select>
            </div>
            <div className=${classNames.row}>
              <label className=${classNames.label}>尺寸压缩偏好：</label>
              <select
                className=${classNames.select}
                value=${imageResize}
                onChange=${(e) => setImageResize(e.target.value)}
              >
                <option value="default">默认（无压缩）</option>
                <option value="2k_max">最大边小于 2K</option>
                <option value="1k_max">最大边小于 1K</option>
                <option value="960_max">最大边小于 960</option>
                <option value="640_max">最大边小于 640</option>
                <option value="512_max">最大边小于 512</option>
              </select>
            </div>
            <div className=${classNames.row}>
              <label className=${classNames.label}>压缩率：</label>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value=${imageQuality}
                className=${classNames.range}
                onInput=${(e) => setImageQuality(parseInt(e.target.value, 10))}
              />
              <span className=${classNames.rangeValue}>${imageQuality}%</span>
            </div>
            <div className=${classNames.hintText}>
              注意：压缩率仅当转码或尺寸压缩开启时生效，推荐 60% 以上。
            </div>
          </fieldset>
        </div>
      `;
    };

    // 下载历史页
    const HistoryTab = () => {
      const [history, setHistory] = useState([]);

      useEffect(() => {
        loadHistory();
      }, []);

      const loadHistory = () => {
        setHistory(DownloadHistory.get());
      };

      const clearHistory = async () => {
        const ok = await ProductDialog.open({
          icon: "warning",
          title: "清空下载记录？",
          message: "这会删除脚本保存的下载历史列表。",
          detail: "已经保存到磁盘的文件不会被删除。",
          primaryLabel: "清空下载记录",
          secondaryLabel: "取消",
          danger: true,
        });
        if (ok) {
          DownloadHistory.clear();
          setHistory([]);
        }
      };

      const formatTime = (ts) => new Date(ts).toLocaleString();

      return html`
        <div>
          <div class="${classNames.flexBetween}">
            <h3 style="margin: 0;">下载记录（最多50条）</h3>
            <button class="${classNames.btnDanger}" onClick=${clearHistory}>
              清空历史
            </button>
          </div>
          ${history.length === 0
            ? html`<p class="${classNames.emptyHistory}">暂无下载记录</p>`
            : html`
                <table class="${classNames.table}">
                  <thead>
                    <tr>
                      <th class="${classNames.th}">描述</th>
                      <th class="${classNames.th}">分享链接</th>
                      <th class="${classNames.th}">下载时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${history.map(
                      (item) => html`
                        <tr>
                          <td class="${classNames.td}">${item.desc || "-"}</td>
                          <td class="${classNames.td}">
                            <a
                              href=${item.shareUrl}
                              target="_blank"
                              rel="noopener"
                              >链接</a
                            >
                          </td>
                          <td class="${classNames.td}">
                            ${formatTime(item.downloadTime)}
                          </td>
                        </tr>
                      `
                    )}
                  </tbody>
                </table>
              `}
        </div>
      `;
    };

    // ========== 下载器配置 Tab（与 SettingsTab 风格一致） ==========
    const DownloaderConfigTab = ({ config, onConfigChange }) => {
      // 获取当前配置（深拷贝防止直接修改）
      const downloaderConfig = config.features.downloader_config || {
        browser: {},
        abdm: {
          dir: {
            video: "`./douyin/${user_dir}/videos`",
            image: "`./douyin/${user_dir}/images`",
            other: "`./douyin/${user_dir}/others`",
          },
          domain: "http://localhost",
          port: "15151",
        },
        aria2: {
          dir: {
            video: "`./douyin/${user_dir}/videos`",
            image: "`./douyin/${user_dir}/images`",
            other: "`./douyin/${user_dir}/others`",
          },
          domain: "http://localhost",
          port: "6800",
          path: "/jsonrpc",
          token: "",
        },
      };

      // ABDM 配置状态
      const [abdmDomain, setAbdmDomain] = useState(
        downloaderConfig.abdm?.domain || "http://localhost"
      );
      const [abdmPort, setAbdmPort] = useState(
        downloaderConfig.abdm?.port || "15151"
      );
      const [abdmDirVideo, setAbdmDirVideo] = useState(
        downloaderConfig.abdm?.dir?.video || "`./douyin/${user_dir}/videos`"
      );
      const [abdmDirImage, setAbdmDirImage] = useState(
        downloaderConfig.abdm?.dir?.image || "`./douyin/${user_dir}/images`"
      );
      const [abdmDirOther, setAbdmDirOther] = useState(
        downloaderConfig.abdm?.dir?.other || "`./douyin/${user_dir}/others`"
      );

      // Aria2 配置状态
      const [aria2Domain, setAria2Domain] = useState(
        downloaderConfig.aria2?.domain || "http://localhost"
      );
      const [aria2Port, setAria2Port] = useState(
        downloaderConfig.aria2?.port || "6800"
      );
      const [aria2Path, setAria2Path] = useState(
        downloaderConfig.aria2?.path || "/jsonrpc"
      );
      const [aria2Token, setAria2Token] = useState(
        downloaderConfig.aria2?.token || ""
      );
      const [aria2DirVideo, setAria2DirVideo] = useState(
        downloaderConfig.aria2?.dir?.video || "`./douyin/${user_dir}/videos`"
      );
      const [aria2DirImage, setAria2DirImage] = useState(
        downloaderConfig.aria2?.dir?.image || "`./douyin/${user_dir}/images`"
      );
      const [aria2DirOther, setAria2DirOther] = useState(
        downloaderConfig.aria2?.dir?.other || "`./douyin/${user_dir}/others`"
      );

      // 保存配置
      const handleSave = () => {
        if (!config.features.downloader_config) {
          config.features.downloader_config = {};
        }
        config.features.downloader_config.abdm = {
          domain: abdmDomain,
          port: abdmPort,
          dir: {
            video: abdmDirVideo,
            image: abdmDirImage,
            other: abdmDirOther,
          },
        };
        config.features.downloader_config.aria2 = {
          domain: aria2Domain,
          port: aria2Port,
          path: aria2Path,
          token: aria2Token,
          dir: {
            video: aria2DirVideo,
            image: aria2DirImage,
            other: aria2DirOther,
          },
        };
        config.save();
        ToastCenter.update("下载器配置已保存", 1800);
        if (onConfigChange) onConfigChange();
      };

      // 重置为默认值
      const handleReset = async () => {
        const ok = await ProductDialog.open({
          icon: "warning",
          title: "重置下载器配置？",
          message: "AB Download Manager 和 aria2 的地址、端口、目录及 Token 将恢复默认值。",
          detail: "此次操作只修改当前表单；请再点击“保存设置”才会正式生效。",
          primaryLabel: "恢复默认值",
          secondaryLabel: "取消",
          danger: true,
        });
        if (!ok) return;

        setAbdmDomain("http://localhost");
        setAbdmPort("15151");
        setAbdmDirVideo("`./douyin/${user_dir}/videos`");
        setAbdmDirImage("`./douyin/${user_dir}/images`");
        setAbdmDirOther("`./douyin/${user_dir}/others`");
        setAria2Domain("http://localhost");
        setAria2Port("6800");
        setAria2Path("/jsonrpc");
        setAria2Token("");
        setAria2DirVideo("`./douyin/${user_dir}/videos`");
        setAria2DirImage("`./douyin/${user_dir}/images`");
        setAria2DirOther("`./douyin/${user_dir}/others`");
        ToastCenter.update("已恢复默认值，请点击“保存设置”生效", 2200);
      };

      return html`
        <div>
          <!-- 顶部操作栏 -->
          <div style="text-align: right; margin-bottom: 15px;">
            <button className=${classNames.btn} onClick=${handleSave}>
              保存设置
            </button>
            <button
              className=${classNames.btnDanger}
              onClick=${handleReset}
              style="margin-left: 8px;"
            >
              重置默认
            </button>
          </div>

          <!-- ABDM 配置区块 -->
          <fieldset className=${classNames.fieldset}>
            <legend className=${classNames.legend}>
              AB Download Manager (ABDM)
            </legend>
            <div className=${classNames.row}>
              <label className=${classNames.label}>服务地址：</label>
              <input
                type="text"
                className=${classNames.inputBase}
                value=${abdmDomain}
                onInput=${(e) => setAbdmDomain(e.target.value)}
                placeholder="http://localhost"
              />
            </div>
            <div className=${classNames.row}>
              <label className=${classNames.label}>端口：</label>
              <input
                type="text"
                className=${classNames.inputBase}
                value=${abdmPort}
                onInput=${(e) => setAbdmPort(e.target.value)}
                placeholder="15151"
              />
            </div>
          </fieldset>

          <!-- Aria2 配置区块 -->
          <fieldset className=${classNames.fieldset}>
            <legend className=${classNames.legend}>Aria2 RPC</legend>
            <div className=${classNames.row}>
              <label className=${classNames.label}>服务地址：</label>
              <input
                type="text"
                className=${classNames.inputBase}
                value=${aria2Domain}
                onInput=${(e) => setAria2Domain(e.target.value)}
                placeholder="http://localhost"
              />
            </div>
            <div className=${classNames.row}>
              <label className=${classNames.label}>端口：</label>
              <input
                type="text"
                className=${classNames.inputBase}
                value=${aria2Port}
                onInput=${(e) => setAria2Port(e.target.value)}
                placeholder="6800"
              />
            </div>
            <div className=${classNames.row}>
              <label className=${classNames.label}>路径：</label>
              <input
                type="text"
                className=${classNames.inputBase}
                value=${aria2Path}
                onInput=${(e) => setAria2Path(e.target.value)}
                placeholder="/jsonrpc"
              />
            </div>
            <div className=${classNames.row}>
              <label className=${classNames.label}>Token：</label>
              <input
                type="text"
                className=${classNames.inputBase}
                value=${aria2Token}
                onInput=${(e) => setAria2Token(e.target.value)}
                placeholder="可选"
              />
            </div>
          </fieldset>

          <div
            className=${classNames.hintText}
            style="padding: 8px; border-radius: 4px;"
          >
            注意：需要在“基本设置”中选择对应的下载器（browser/abdm/aria2）后，此处配置才会生效。
          </div>
        </div>
      `;
    };

    // 主组件
    const App = ({ config, onClose, initialTab = "settings" }) => {
      const [activeTab, setActiveTab] = useState(initialTab || "settings");

      const tabs = [
        { id: "settings", title: "基本设置" },
        { id: "downloader", title: "下载器配置" },
        { id: "history", title: "下载历史" },
      ];
      const current_tab = {
        settings: html`<${SettingsTab}
          config=${config}
          onConfigChange=${() => {}}
        />`,
        history: html`<${HistoryTab} />`,
        downloader: html`<${DownloaderConfigTab}
          config=${config}
          onConfigChange=${() => {}}
        />`,
      }[activeTab];

      return html`
        <div className=${classNames.container}>
          <nav className=${classNames.nav}>
            ${tabs.map(
              (tab) => html`
                <button
                  className=${`${classNames.navBtn} ${
                    activeTab === tab.id ? classNames.navBtnActive : ""
                  }`}
                  onClick=${() => setActiveTab(tab.id)}
                >
                  ${tab.title}
                </button>
              `
            )}
          </nav>
          <div className=${classNames.content}>${current_tab}</div>
        </div>
      `;
    };

    return { App };
  })();
  // #endregion

  // #region Floating Action Panel
  const FloatingPanelComponents = (() => {
    const { useCallback, html } = getHtmPreact();
    const css = createCSS();
    const icon = (name) => html`<span class="dy-dl-inline-icon-v106" dangerouslySetInnerHTML=${{ __html: UI_ICONS[name] || "" }}></span>`;

    const styles = {
      panel: ({ expanded }) => css({
        position: "fixed",
        right: "24px",
        bottom: "78px",
        zIndex: 999999,
        width: expanded ? "292px" : "auto",
        maxWidth: "calc(100vw - 32px)",
        fontFamily: 'system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
        color: theme.colors.textPrimary,
      }),
      shell: css({
        padding: "16px",
        border: `1px solid ${theme.colors.borderLight}`,
        borderRadius: theme.borderRadius.lg,
        background: theme.colors.bgOverlay,
        boxShadow: theme.shadow.panel,
      }),
      head: css({ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }),
      heading: css({ minWidth: 0 }),
      title: css({ margin: 0, fontSize: "14px", fontWeight: 700, lineHeight: 1.3 }),
      author: css({ marginTop: "4px", color: theme.colors.textMuted, fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
      iconButton: css({
        width: "30px", height: "30px", display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: `1px solid ${theme.colors.borderLight}`, borderRadius: "8px", background: theme.colors.bgControl,
        color: theme.colors.textSecondary, cursor: "pointer",
      }),
      stats: css({
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "16px",
      }),
      stat: css({ padding: "10px 11px", border: `1px solid ${theme.colors.borderLight}`, borderRadius: "10px", background: theme.colors.bgFieldset }),
      statLabel: css({ color: theme.colors.textMuted, fontSize: "11px" }),
      statValue: css({ marginTop: "3px", fontSize: "16px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }),
      primary: css({
        width: "100%", minHeight: "38px", marginTop: "14px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px",
        border: "none", borderRadius: "9px", background: theme.colors.primary, color: "#fff", fontSize: "13px", fontWeight: 650, cursor: "pointer",
      }),
      secondaryRow: css({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "8px" }),
      secondary: css({
        minHeight: "34px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "7px",
        border: `1px solid ${theme.colors.borderLight}`, borderRadius: "9px", background: theme.colors.bgControl,
        color: theme.colors.textSecondary, fontSize: "12px", fontWeight: 600, cursor: "pointer",
      }),
      footer: css({ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${theme.colors.borderLight}` }),
      light: css({
        minHeight: "30px", display: "inline-flex", alignItems: "center", gap: "6px", padding: "0 9px",
        border: "1px solid transparent", borderRadius: "8px", background: "transparent", color: theme.colors.textMuted,
        fontSize: "11px", cursor: "pointer",
      }),
      plugin: css({
        minHeight: "34px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "0 13px",
        border: `1px solid ${theme.colors.primaryBorder}`, borderRadius: "9px", background: theme.colors.primarySoft,
        color: "#8FA7FF", fontSize: "13px", fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 24px rgba(0,0,0,.28)",
      }),
    };

    const App = ({ mediaHandler, profilePageHandler }) => {
      const manager = profilePageHandler.downloadManager;
      const snapshot = manager.useEvent("stateChanged", () => manager.getSnapshot());
      const expanded = Config.global.events.useEvent("config_change", () => Config.global.features.enable_profile_downloader);
      const expand = useCallback(() => { Config.global.features.enable_profile_downloader = true; Config.global.save(); });
      const collapse = useCallback(() => { Config.global.features.enable_profile_downloader = false; Config.global.save(); });
      const openSettings = () => mediaHandler.open_config_modal();
      const openManager = () => profilePageHandler.open_job_modal();
      const toggleAll = async () => {
        if (snapshot.counts.is_selected_all) {
          manager.markSelectAll(false);
          return;
        }
        if (!snapshot.counts.hasReportedTotal || snapshot.counts.known < snapshot.counts.reportedTotal) {
          await manager.scanAll({ selectAllAfter: true }).catch((error) => ToastCenter.update(`扫描失败：${error?.message || error}`, 2800));
          return;
        }
        manager.markSelectAll(true);
      };
      const scanAll = () => snapshot.discovery?.running
        ? manager.cancelDiscoveryScan()
        : manager.scanAll().catch((error) => ToastCenter.update(`扫描失败：${error?.message || error}`, 2800));
      const start = () => manager.startJob().catch((error) => ToastCenter.update(`启动失败：${error?.message || error}`, 2600));
      const pause = () => manager.stopJob();

      if (!expanded) {
        return html`<div class=${styles.panel({ expanded: false })}><button type="button" class=${styles.plugin} onClick=${expand} title="打开抖音媒体工作台">${icon("download")}<span>插件</span></button></div>`;
      }

      return html`
        <aside class=${styles.panel({ expanded: true })}>
          <div class=${styles.shell}>
            <header class=${styles.head}>
              <div class=${styles.heading}>
                <h3 class=${styles.title}>批量下载</h3>
                <div class=${styles.author}>${snapshot.profileName || "当前作者"}</div>
              </div>
              <button type="button" class=${styles.iconButton} onClick=${collapse} title="收起面板" aria-label="收起批量下载面板">${icon("chevronDown")}</button>
            </header>

            <div class=${styles.stats}>
              <div class=${styles.stat}><div class=${styles.statLabel}>已选择</div><div class=${styles.statValue}>${snapshot.counts.selected}</div></div>
              <div class=${styles.stat}><div class=${styles.statLabel}>已载入</div><div class=${styles.statValue}>${snapshot.counts.known}${snapshot.counts.reportedTotal > snapshot.counts.known ? ` / ${snapshot.counts.reportedTotal}` : ""}</div></div>
            </div>

            ${snapshot.jobRunning
              ? html`<button type="button" class=${styles.primary} onClick=${pause}>${icon("pause")}<span>暂停下载</span></button>`
              : html`<button type="button" class=${styles.primary} onClick=${snapshot.canResume ? openManager : start}>${icon(snapshot.canResume ? "listChecks" : "download")}<span>${snapshot.canResume ? "处理暂停任务" : "开始下载"}</span></button>`}

            <div class=${styles.secondaryRow}>
              <button type="button" class=${styles.secondary} onClick=${openManager}>${icon("listChecks")}<span>管理任务</span></button>
              <button type="button" class=${styles.secondary} onClick=${toggleAll} disabled=${snapshot.jobRunning}>${icon("listChecks")}<span>${snapshot.counts.is_selected_all ? "取消全选" : "全选作品"}</span></button>
            </div>

            ${!snapshot.jobRunning && (!snapshot.counts.hasReportedTotal || snapshot.counts.known < snapshot.counts.reportedTotal || snapshot.discovery?.running) ? html`
              <button type="button" class=${styles.secondary} style=${{ width: "100%", marginTop: "8px" }} onClick=${scanAll}>
                ${icon(snapshot.discovery?.running ? "cancel" : "scan")}
                <span>${snapshot.discovery?.running ? `停止扫描 · ${snapshot.counts.known}/${snapshot.counts.hasReportedTotal ? snapshot.counts.reportedTotal : "?"}` : `扫描全部作品 · ${snapshot.counts.known}/${snapshot.counts.hasReportedTotal ? snapshot.counts.reportedTotal : "?"}`}</span>
              </button>` : null}

            <footer class=${styles.footer}>
              <button type="button" class=${styles.light} onClick=${openSettings}>${icon("settings")}<span>设置</span></button>
              <button type="button" class=${styles.light} onClick=${collapse}>${icon("chevronDown")}<span>收起</span></button>
            </footer>
          </div>
        </aside>`;
    };

    return { App };
  })();
  // #endregion

  class FloatingPanel {
    /**
     * @param {{mediaHandler: MediaHandler, profilePageHandler: ProfilePageHandler}} options
     */
    constructor(options) {
      this.mediaHandler = options.mediaHandler;
      this.profilePageHandler = options.profilePageHandler;
      this.root = document.createElement("div");
      this.root.className = "dy-dl-floating-panel-root";
      document.body.appendChild(this.root);

      this.mounted = false;

      // V1.0.0：不再每秒轮询 #sliderVideo；由 DOMPatcher 增量事件触发同步。
      this.lastHidden = null;
    }

    mount() {
      if (this.mounted) return;

      /**
       * @type {import('preact')}
       */
      const { html, render } = getHtmPreact();
      const { App } = FloatingPanelComponents;
      render(
        html`<${App}
          mediaHandler=${this.mediaHandler}
          profilePageHandler=${this.profilePageHandler}
        />`,
        this.root
      );

      this.mounted = true;
      this.syncVisibility();
    }

    unmount() {
      if (!this.mounted) return;
      this.mounted = false;
      /**
       * @type {import('preact')}
       */
      const { render } = getHtmPreact();
      render(null, this.root);
    }

    hide() {
      if (!this.mounted) return;
      this.root.hidden = true;
    }

    show() {
      if (!this.mounted) return;
      this.root.hidden = false;
    }

    syncVisibility() {
      const onProfilePage = isProfilePagePath();
      if (!this.mounted) {
        if (onProfilePage) this.mount();
        return;
      }

      const shouldHide =
        !onProfilePage || Boolean(document.querySelector("#sliderVideo"));
      if (this.lastHidden === shouldHide) return;

      this.lastHidden = shouldHide;
      if (shouldHide) this.hide();
      else this.show();
    }
  }

  // #region 主入口组件 ---
  /**
   * 这个类是主要逻辑
   *
   * 包含如何解析操作、解析从player里提取的media对象
   */
  class MediaHandler {
    /** @type {import("./types").DouyinPlayer.PlayerInstance | null} */
    player = null;
    /** @type {import("./types").DouyinMedia.MediaRoot | null} */
    current_media = null;
    downloading = false;
    /** @type {Downloader} */
    downloader;
    /** @type {HTMLElement | null} */
    $btn = null; // Corresponds to downloader_status.$btn from original, not actively used for UI updates by original logic

    /**
     * @param {Downloader} downloader
     */
    constructor(downloader) {
      this.downloader = downloader;
      this.download_current_media = this._lock_download(
        this._download_current_media_logic.bind(this)
      );
      this.extract_original_audio = this._lock_download(
        this._extract_original_audio_logic.bind(this)
      );
    }

    /**
     * @param {string} bigintStr
     */
    static toShortId(bigintStr) {
      try {
        return BigInt(bigintStr).toString(36);
      } catch (error) {
        return bigintStr;
      }
    }

    /**
     * 文件名
     *
     * [nickname] + [short_id] + [tags] + [desc]
     * max length: 64
     *
     * @param {import("./types").DouyinMedia.MediaRoot} media
     */
    _build_filename(
      media = this.current_media,
      filename_template = Config.global.features.filename_template ||
        Config.defaults.filename_template,
      filename_max_length = Config.global.features.filename_max_length || 64,
      throw_err = false
    ) {
      if (!media) return "douyin_media";

      const {
        authorInfo = {},
        awemeId = "media",
        desc = "",
        textExtra = [],
      } = media;
      const nickname = authorInfo.nickname || "douyin";

      const short_id = MediaHandler.toShortId(awemeId);
      const tag_list =
        textExtra?.map((x) => x.hashtagName).filter(Boolean) || [];
      const tags = tag_list.map((x) => "#" + x).join("_");
      let rawDesc = desc || "";
      tag_list.forEach((t) => {
        const safeTag = String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        rawDesc = rawDesc.replace(new RegExp(`#${safeTag}\\s*`, "g"), "");
      });
      rawDesc = rawDesc.trim().replace(/[#/?<>\\:*|":]/g, ""); // Sanitize illegal characters

      // 渲染文件名用的上下文
      const context = {
        nickname,
        short_id,
        tags,
        desc: rawDesc,
        aweme_id: awemeId,
        media,
        author_info: media.authorInfo,
        uid: media.authorUserId,
        music_name: media.music?.musicName || "",
        now_date: new Date(),
        create_date: new Date(media.createTime * 1000),
      };
      // 添加格式化之后的时间
      context.now_YYYYMMDD = formatDate(context.now_date, "YYYYMMDD");
      context.now_YYYYMMDD_HHmmss = formatDate(
        context.now_date,
        "YYYYMMDD_HHmmss"
      );
      context.create_date_YYYYMMDD = formatDate(
        context.create_date,
        "YYYYMMDD"
      );
      context.create_date_YYYYMMDD_HHmmss = formatDate(
        context.create_date,
        "YYYYMMDD_HHmmss"
      );

      let baseName = "";
      try {
        baseName = renderTemplate(context, filename_template);
      } catch (error) {
        if (throw_err) throw error;
        console.error(`[dy-dl] Error rendering filename template:`);
        console.error(error);
        baseName = renderTemplate(context, Config.defaults.filename_template);
      }
      if (baseName.length > filename_max_length) {
        baseName = baseName.slice(0, filename_max_length);
      }

      // NOTE: 文件名截断问题，如果包含 "." 可能导致浏览器误判后缀名 #41
      baseName = baseName.replace(/\./g, "_");

      return baseName;
    }

    _boundPlayer = null;
    _boundPlayerUpdate = null;

    _update_current_media_from_player() {
      if (this.player?.config?.awemeInfo) {
        this.current_media = this.player.config.awemeInfo;
        return this.current_media;
      }
      return null;
    }

    _unbind_player_events() {
      if (!this._boundPlayer || !this._boundPlayerUpdate) return;

      try {
        this._boundPlayer.off?.("play", this._boundPlayerUpdate);
        this._boundPlayer.off?.("seeked", this._boundPlayerUpdate);
      } catch (error) {
        // 某些播放器版本没有 off，旧实例卸载后由页面自行回收。
      }

      this._boundPlayer = null;
      this._boundPlayerUpdate = null;
    }

    _bind_player_events() {
      if (!this.player || this._boundPlayer === this.player) {
        this._update_current_media_from_player();
        return;
      }

      this._unbind_player_events();

      const player = this.player;
      const update = () => {
        if (this.player === player) {
          this._update_current_media_from_player();
        }
      };

      this._boundPlayer = player;
      this._boundPlayerUpdate = update;

      update();

      try {
        player.on?.("play", update);
        player.on?.("seeked", update);
      } catch (error) {
        console.warn("[dy-dl]播放器事件绑定失败", error);
      }
    }

    /**
     * V1.0.0：按需刷新播放器。
     *
     * 旧版每秒永久轮询 window.player；新版只在播放器 DOM 出现、用户打开菜单、
     * 下载/查看详情/截图等真实操作发生时调用，因此页面静置时没有播放器轮询。
     */
    refresh_player() {
      let pageWindow = window;
      try {
        if (typeof unsafeWindow !== "undefined") pageWindow = unsafeWindow;
      } catch (error) {}

      // @ts-ignore
      const currentPlayer = window.player || pageWindow?.player || null;

      if (this.player !== currentPlayer) {
        this._unbind_player_events();
        this.player = currentPlayer;
        if (this.player) this._bind_player_events();
      } else {
        this._update_current_media_from_player();
      }

      return this.player;
    }

    _flag_start_download() {
      this.downloading = true;
      return () => {
        this.downloading = false;
      };
    }

    _lock_download(download_fn) {
      return async (...args) => {
        if (this.downloading) {
          ToastCenter.update("已有下载任务正在进行，请先等待、暂停或取消当前任务", 2400);
          return;
        }
        const releaseLock = this._flag_start_download();
        try {
          await download_fn(...args);
        } finally {
          // Small delay before releasing lock, as in original script
          await new Promise((r) => {
            setTimeout(r, 300);
          });
          releaseLock();
        }
      };
    }

    _format_toast_message(prefix, message) {
      return prefix ? `${prefix} ${message}` : message;
    }

    /**
     * 从 video 对象上取得所有 url，支持分辨率策略 + 编码偏好
     * 先按 codec 筛选，再按分辨率模式筛选
     *
     * @param {import("./types").DouyinMedia.DouyinPlayerVideo | null | undefined} video_obj
     * @returns {string[]} 视频播放地址数组
     */
    _get_video_urls(video_obj) {
      if (video_obj === null || video_obj === undefined) {
        return [];
      }

      const mode = Config.global.features.download_video_mode || "default";
      const codecPref =
        Config.global.features.video_download_codecs || "default";

      // ====================== 辅助函数 ======================
      const extractUrlsFromBitRate = (bitRate) => {
        const urls = [];
        if (bitRate.playApi) urls.push(bitRate.playApi);
        if (Array.isArray(bitRate.playAddr)) {
          urls.push(...bitRate.playAddr.map((addr) => addr.src));
        }
        return urls.filter(Boolean);
      };

      const isH265 = (bitRate) => {
        return (
          bitRate.isH265 === 1 ||
          (bitRate.gearName || "").toLowerCase().includes("h265") ||
          (bitRate.videoFormat || "").toLowerCase().includes("h265") ||
          (bitRate.format || "").toLowerCase().includes("h265")
        );
      };

      // 如果 bitRateList 为空，直接回退默认逻辑
      if (!video_obj.bitRateList || video_obj.bitRateList.length === 0) {
        console.warn("[dy-dl] bitRateList 为空，使用默认地址");
        return this._get_video_urls_default(video_obj);
      }

      // 第零步，过滤掉所有 dash 格式，因为这种需要手动合并音频，不太方便，我们这里也做不到...
      const bitRateList = video_obj.bitRateList.filter(
        (x) => x.format !== "dash"
      );

      // ====================== 第一步：按 codec 偏好筛选 ======================
      let candidates = [...bitRateList];

      if (codecPref !== "default") {
        const isPrefer = codecPref.endsWith("_prefer");
        const wantH265 = codecPref.includes("h265");

        const codecMatches = candidates.filter((bitRate) => {
          return isH265(bitRate) === wantH265;
        });

        if (codecMatches.length > 0) {
          candidates = codecMatches; // 找到对应编码，使用它
        } else if (!isPrefer) {
          // 严格模式（非 prefer）但没找到 → 直接回退
          console.warn(
            `[dy-dl] 未找到 ${
              wantH265 ? "H265" : "H264"
            } 编码的视频，使用默认地址`
          );
          return this._get_video_urls_default(video_obj);
        }
        // prefer 模式下没找到就继续使用全部 candidates
      }

      // ====================== 第二步：按分辨率模式筛选 ======================
      if (mode !== "default" && candidates.length > 1) {
        /**
         *
         * @param {import("./types").DouyinMedia.FluffyBitRateList} a
         */
        const vsizeof = (a) => (a?.width || 0) * (a?.height || 0);
        /**
         *
         * @param {import("./types").DouyinMedia.FluffyBitRateList} a
         */
        const vfilesizeof = (a) => a.dataSize || 0;

        // 通用方法：根据比较函数排序，并过滤出与第一个元素值相同的项
        const sortAndFilter = (getValue, compare) => {
          candidates.sort(compare);
          const target = getValue(candidates[0]);
          candidates = candidates.filter((item) => getValue(item) === target);
        };

        switch (mode) {
          case "max":
            // 按分辨率面积降序，取最大尺寸
            sortAndFilter(vsizeof, (a, b) => vsizeof(b) - vsizeof(a));
            break;

          case "min":
            // 按分辨率面积升序，取最小尺寸
            sortAndFilter(vsizeof, (a, b) => vsizeof(a) - vsizeof(b));
            break;

          case "max_file":
            // 按文件大小降序，取最大文件
            sortAndFilter(
              vfilesizeof,
              (a, b) => vfilesizeof(b) - vfilesizeof(a)
            );
            break;

          case "min_file":
            // 按文件大小升序，取最小文件
            sortAndFilter(
              vfilesizeof,
              (a, b) => vfilesizeof(a) - vfilesizeof(b)
            );
            break;

          default: {
            // 按清晰度关键字匹配（1080P、720P 等）
            const keywordMap = {
              "1080P": ["1080"],
              "720P": ["720"],
              "540P": ["540"],
              "360P": ["360"],
              "2K": ["2k", "2048"],
              "4K": ["4K", "4096"],
            };
            const keywords = keywordMap[mode] || [];
            if (keywords.length > 0) {
              const matched = candidates.filter((bitRate) => {
                const gearName = (bitRate.gearName || "").toLowerCase();
                return keywords.some((kw) =>
                  gearName.includes(kw.toLowerCase())
                );
              });
              if (matched.length > 0) candidates = matched;
            }
            break;
          }
        }
      }

      // ====================== 提取最终 URL ======================
      const allUrls = [];
      candidates.forEach((bitRate) => {
        allUrls.push(...extractUrlsFromBitRate(bitRate));
      });

      // 补充顶层 playApi / playApiH265（兜底）
      if (codecPref === "default" || codecPref.includes("h264")) {
        if (video_obj.playApi) allUrls.push(video_obj.playApi);
      }
      if (codecPref === "default" || codecPref.includes("h265")) {
        if (video_obj.playApiH265) allUrls.push(video_obj.playApiH265);
      }

      const result = Array.from(new Set(allUrls.filter(Boolean)));

      if (result.length === 0) {
        console.warn("[dy-dl] 未能提取到有效视频地址，回退默认模式");
        return this._get_video_urls_default(video_obj);
      }

      return result;
    }

    /**
     * 默认的 URL 提取逻辑
     *
     * @param {import("./types").DouyinMedia.DouyinPlayerVideo | null | undefined} video_obj
     * @returns {string[]} 视频播放地址数组
     */
    _get_video_urls_default(video_obj) {
      const sources = [];
      if (video_obj.playApi) sources.push(video_obj.playApi);
      if (Array.isArray(video_obj.playAddr)) {
        sources.push(...video_obj.playAddr.map((x) => x.src));
      }
      if (video_obj.bitRateList) {
        video_obj.bitRateList
          .filter((x) => x.format !== "dash")
          .forEach((x) => {
            if (x.playApi) sources.push(x.playApi);
          });
      }
      if (video_obj.playApiH265) sources.push(video_obj.playApiH265);

      return Array.from(new Set(sources.filter(Boolean)));
    }

    /**
     * 提取作品原声候选地址。
     *
     * 抖音不同播放器版本会混用 camelCase / snake_case；这里只读取 music
     * 对象中的原始播放地址，不从视频流转码，也不会下载视频画面。
     */
    _get_original_audio_urls(media = this.current_media) {
      const music = media?.music;
      if (!music) return [];

      const playSources = [
        music.playUrl,
        music.play_url,
        music.playAddr,
        music.play_addr,
      ].filter(Boolean);
      const urls = [];
      const append = (value) => {
        if (typeof value === "string" && value.trim()) {
          urls.push(value.trim());
        }
      };

      for (const source of playSources) {
        if (typeof source === "string") {
          append(source);
          continue;
        }

        const lists = [
          source.urlList,
          source.url_list,
          source.urls,
        ];
        for (const list of lists) {
          if (Array.isArray(list)) list.forEach(append);
        }
        append(source.url);
        append(source.src);
      }

      return Array.from(new Set(urls));
    }

    /**
     * 以极小网络开销确认原声音频真实格式。
     *
     * 优先 HEAD；CDN 不支持 HEAD 时再请求 1 字节 Range。只探测前两个候选
     * 地址，每次最多等待 5 秒，避免菜单操作被长时间阻塞。
     */
    async _probe_original_audio_meta(urls) {
      const candidates = Array.isArray(urls) ? urls.slice(0, 2) : [];

      for (const url of candidates) {
        for (const method of ["HEAD", "GET"]) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          try {
            const response = await fetch(url, {
              method,
              credentials: "same-origin",
              headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
              signal: controller.signal,
            });
            const contentType = response.headers.get("content-type") || "";
            if (method === "GET") {
              try {
                await response.body?.cancel();
              } catch {}
            }
            if (
              response.ok &&
              /^(?:audio\/|video\/mp4)/i.test(contentType.trim())
            ) {
              return resolveAudioFileMeta(contentType, url);
            }
          } catch {
            // 跨域 CDN 可能拒绝探测；继续尝试备用地址或按 URL 判断。
          } finally {
            clearTimeout(timer);
          }
        }
      }

      return resolveAudioFileMeta("", candidates[0] || "");
    }

    /** 下载当前作品原声音频。 */
    async _extract_original_audio_logic() {
      this.refresh_player();
      const mediaSnapshot = this.current_media;
      if (!mediaSnapshot) {
        ToastCenter.update("暂未读取到当前作品，请先播放视频或等待页面加载", 2400);
        return { ok: false, reason: "missing_media" };
      }

      const urls = this._get_original_audio_urls(mediaSnapshot);
      if (!urls.length) {
        ToastCenter.update("当前作品未检测到可下载的原声音频", 2400);
        return { ok: false, reason: "missing_audio" };
      }

      ToastCenter.update("正在获取原声音频", 0);
      const audioMeta = await this._probe_original_audio_meta(urls);
      const filenameBase = `原声_${this._build_filename(mediaSnapshot)}`;

      let result;
      try {
        result = await this.downloader.download_file(
          urls[0],
          filenameBase,
          urls.slice(1),
          {
            media: mediaSnapshot,
            fileKind: "audio",
            forcedExtension: audioMeta.ext,
            forcedMime: audioMeta.mime,
            progressLabels: {
              connecting: "正在连接原声音频",
              downloading: "正在下载原声",
              processing: "正在保存原声",
              completed: "原声已保存",
            },
            refreshSources: async () => {
              this.refresh_player();
              return this.current_media?.awemeId === mediaSnapshot.awemeId
                ? this._get_original_audio_urls(this.current_media)
                : [];
            },
          }
        );
      } catch (error) {
        console.error("[dy-dl]原声音频下载失败：", error);
        ToastCenter.update(
          `原声音频下载失败：${error?.message || "请稍后重试"}`,
          3000
        );
        return { ok: false, reason: "audio_download_failed", error };
      }

      if (result?.completed) {
        ToastCenter.update("原声已保存", 1800);
      } else if (result?.submitted) {
        ToastCenter.update("原声下载任务已提交", 2200);
      } else if (!result?.cancelled) {
        ToastCenter.update(result?.message || "原声音频下载失败，请稍后重试", 2600);
      }

      return result;
    }

    /**
     * 抖音作品有两种形式：
     * 1. 单图、单视频
     * 2. 图集
     *
     * 如果是图集形式，必须从 images 这个数组里面取字段，其他字段都有可能是 fallback 值
     */
    async _download_media_logic(media, options = {}) {
      const {
        toastTarget = document.querySelector(".dy-dl-video-btn"),
        toast = null,
        toastPrefix = "",
        alertOnFail = true,
        addHistory = true,
        onProgress = null,
        onCancelReady = null,
        browserContext: incomingBrowserContext = null,
        batch = false,
        taskIndex = 0,
        taskTotal = 0,
        refreshMedia = null,
        recoveryContext = null,
      } = options;

      if (!media) {
        if (alertOnFail) {
          void ProductDialog.open({
            icon: "info",
            title: "暂未读取到当前作品",
            message: "请先播放一次视频，或等待页面加载完成后再试。",
            primaryLabel: "我知道了",
            hideSecondary: true,
          });
        }
        return { ok: false, reason: "missing_media" };
      }

      const { video, images } = media;
      const filename_base = this._build_filename(media);
      const isAlbum = Array.isArray(images) && images.length > 0;
      const total = isAlbum ? images.length : 1;
      const scopedToast = toast || createToast(toastTarget, 5000);
      const toastUpdate = (message, duration = 5000) =>
        scopedToast.update(this._format_toast_message(toastPrefix, message), duration);

      let browserContext = incomingBrowserContext;
      if (
        isAlbum &&
        !browserContext &&
        Config.global.features.using_downloader === "browser"
      ) {
        browserContext = await this.downloader.prepareBrowserBatchContext({
          suggestedName: filename_base,
        });
        if (browserContext?.cancelled) {
          toastUpdate("已取消", 1600);
          return { ok: false, cancelled: true, reason: "user_cancelled" };
        }
      }

      const commonOptions = {
        silent: !alertOnFail,
        media,
        onProgress,
        onCancelReady,
        browserContext,
        batch: batch || isAlbum,
        showGlobalProgress: !batch,
        taskIndex,
        taskTotal,
        ...(recoveryContext || {}),
      };

      let completedCount = 0;
      let submittedCount = 0;
      let failedCount = 0;
      let lastMethod = "";
      let lastFailure = null;

      const recordResult = (result) => {
        if (!result) {
          failedCount++;
          lastFailure = {
            ok: false,
            reason: "empty_result",
            message: "下载器没有返回结果",
          };
          return;
        }

        lastMethod = result.method || lastMethod;

        if (result.completed) {
          completedCount++;
        } else if (result.submitted) {
          submittedCount++;
        } else if (!result.ok) {
          failedCount++;
          lastFailure = result;
        }
      };

      const getRefreshedMedia = async () => {
        if (typeof refreshMedia === "function") {
          const refreshed = await refreshMedia(media);
          if (refreshed?.awemeId) return refreshed;
        }

        // 单视频页面兜底：按需刷新当前播放器中的 awemeInfo。
        this.refresh_player();
        if (
          this.current_media?.awemeId &&
          this.current_media.awemeId === media.awemeId
        ) {
          return this.current_media;
        }

        return null;
      };

      if (isAlbum) {
        for (let index = 0; index < images.length; index++) {
          const imageItem = images[index];
          const itemFilename = `${filename_base}_${index + 1}`;
          toastUpdate(`处理图集 (${index + 1}/${total})`);

          if (imageItem?.video) {
            const urls = this._get_video_urls(imageItem.video);
            if (!urls.length) {
              failedCount++;
              continue;
            }
            const result = await this.downloader.download_file(
              urls[0],
              itemFilename,
              urls,
              {
                ...commonOptions,
                fileKind: "video",
                refreshSources: async () => {
                  const fresh = await getRefreshedMedia();
                  const freshItem = fresh?.images?.[index];
                  return this._get_video_urls(freshItem?.video);
                },
              }
            );
            if (result?.cancelled) return result;
            recordResult(result);
            continue;
          }

          const urls =
            imageItem?.urlList?.filter(Boolean) ||
            imageItem?.downloadUrlList?.filter(Boolean) ||
            [];
          if (!urls.length) {
            failedCount++;
            continue;
          }
          const result = await this.downloader.download_file(
            urls[0],
            itemFilename,
            urls,
            {
              ...commonOptions,
              fileKind: "image",
              refreshSources: async () => {
                const fresh = await getRefreshedMedia();
                const freshItem = fresh?.images?.[index];
                return (
                  freshItem?.urlList?.filter(Boolean) ||
                  freshItem?.downloadUrlList?.filter(Boolean) ||
                  []
                );
              },
            }
          );
          if (result?.cancelled) return result;
          recordResult(result);
        }
      } else {
        const urls = this._get_video_urls(video);
        if (urls.length) {
          const result = await this.downloader.download_file(
            urls[0],
            filename_base,
            urls,
            {
              ...commonOptions,
              fileKind: "video",
              refreshSources: async () => {
                const fresh = await getRefreshedMedia();
                return this._get_video_urls(fresh?.video);
              },
            }
          );
          if (result?.cancelled) return result;
          recordResult(result);
        } else {
          failedCount++;
        }
      }

      const ok = completedCount + submittedCount > 0;
      const completed =
        completedCount === total && submittedCount === 0 && failedCount === 0;
      const submitted =
        submittedCount === total && completedCount === 0 && failedCount === 0;
      const mixed =
        failedCount === 0 && completedCount > 0 && submittedCount > 0;
      const partial = failedCount > 0 && ok;

      if (ok && addHistory) DownloadHistory.add(media);

      if (completed) toastUpdate(isAlbum ? "图集下载完成" : "下载完成", 1800);
      else if (submitted || mixed) toastUpdate("任务已提交下载器", 2200);
      else if (partial) toastUpdate("部分文件下载失败", 2600);
      else if (alertOnFail) {
        void ProductDialog.open({
          icon: "warning",
          title: "当前作品下载失败",
          message: lastFailure?.message || "可用下载地址均未成功。",
          detail: "请检查网络或登录状态，也可以在任务中心点击“重新下载”。",
          primaryLabel: "我知道了",
          hideSecondary: true,
        });
      }

      return {
        ok,
        completed,
        submitted,
        mixed,
        partial,
        method: lastMethod,
        completedCount,
        submittedCount,
        failedCount,
        reason: ok
          ? partial
            ? "partial_failed"
            : ""
          : lastFailure?.reason || "no_valid_media",
        message:
          lastFailure?.message ||
          lastFailure?.status ||
          "",
        httpStatus:
          Number(lastFailure?.httpStatus || 0),
        retryable:
          Boolean(lastFailure?.retryable),
        unavailable:
          Boolean(lastFailure?.unavailable),
        resumeAvailable:
          Boolean(lastFailure?.resumeAvailable),
        retryContext:
          lastFailure?.retryContext ||
          null,
        failure:
          lastFailure,
      };
    }

    async _download_current_media_logic() {
      this.refresh_player();

      const mediaSnapshot = this.current_media;
      const recoveryContext =
        this._singleRetryContext || null;

      this._singleRetryContext = null;
      DownloadProgressCenter.setRetry(null);

      const result = await this._download_media_logic(
        mediaSnapshot,
        {
          toastTarget:
            document.querySelector(
              ".dy-dl-video-btn"
            ),
          alertOnFail: true,
          addHistory: true,
          batch: false,
          recoveryContext,
          refreshMedia: async () => {
            this.refresh_player();
            return this.current_media?.awemeId ===
              mediaSnapshot?.awemeId
              ? this.current_media
              : null;
          },
        }
      );

      if (
        result?.completed ||
        result?.submitted ||
        result?.mixed
      ) {
        this._singleRetryContext = null;
        DownloadProgressCenter.setRetry(null);
        return result;
      }

      if (
        !result?.cancelled &&
        mediaSnapshot
      ) {
        this._singleRetryContext =
          result?.retryContext ||
          result?.failure?.retryContext ||
          null;

        const label =
          result?.resumeAvailable
            ? "继续下载"
            : "重新下载";

        DownloadProgressCenter.setRetry(
          () => this.download_current_media(),
          label
        );

        DownloadProgressCenter.finish({
          filename:
            this._build_filename(
              mediaSnapshot
            ),
          method: result?.method || "",
          phase: "failed",
          status:
            result?.message ||
            "下载失败，可重新下载",
          loaded:
            result?.failure?.loaded || 0,
          total:
            result?.failure?.total || 0,
        });
      }

      return result;
    }

    // 下载封面
    async download_thumb() {
      this.refresh_player();
      if (!this.current_media) {
        ToastCenter.update("暂未读取到当前作品，请先播放视频或等待页面加载", 2400);
        return;
      }
      const { video = {} } = this.current_media;
      // 第一个是压缩的，所以用第二个
      const covers = Array.isArray(video.originCoverUrlList)
        ? video.originCoverUrlList
        : [];
      const thumb = covers[1] || covers[0] || video.cover?.urlList?.[0] || "";
      if (!thumb) {
        ToastCenter.update("当前作品没有可用封面地址", 2200);
        return;
      }
      const filename_base = this._build_filename(this.current_media);
      this.downloader.download_file(thumb, `thumb_${filename_base}`, [], {
        media: this.current_media,
        fileKind: "image",
      });
    }

    // 显示媒体详情
    async show_media_details() {
      this.refresh_player();
      if (!this.current_media) {
        ToastCenter.update("暂未读取到当前作品，请先播放视频或等待页面加载", 2400);
        return;
      }

      // 1. 创建 Modal
      const modal = new Modal((root, overlay) => {
        // issues #18 fix z-index
        overlay.style.zIndex = 999999;
        // 全屏兼容
        const $fullscreenElement = document.fullscreenElement;
        if ($fullscreenElement) {
          $fullscreenElement.appendChild(overlay);
        }
      });

      // 2. 准备数据
      const filenameBase = this._build_filename(this.current_media);
      const { App } = MediaModalComponents;

      // 3. 挂载 UI (使用 Preact render)
      // 注意：需要确保容器有尺寸，或者 Modal 类本身处理了 root 的基础样式
      // 这里简单加一个 inline style 确保 root 撑开
      modal.root.style.width = "800px";
      modal.root.style.maxWidth = "90vw";
      modal.root.style.background = "transparent";
      modal.root.style.boxShadow = "none";
      modal.root.style.borderRadius = "8px";
      modal.root.style.overflow = "hidden";

      const { html, render } = getHtmPreact();
      render(
        html`<${App}
          media=${this.current_media}
          filenameBase=${filenameBase}
        />`,
        modal.root
      );
    }
    async open_config_modal(initialTab = "settings") {
      // V1.0.7：设置中心统一由外层控制响应式尺寸，内部仅负责左右栏布局。
      // 修复旧版 650px 外壳强塞 820px 内容导致右侧设置被裁切的问题。
      const modal = new Modal((root, overlay) => {
        overlay.style.zIndex = 999999;
        const $fullscreenElement = document.fullscreenElement;
        if ($fullscreenElement) {
          $fullscreenElement.appendChild(overlay);
        }
      });
      modal.root.style.width = "min(940px, 94vw)";
      modal.root.style.height = "min(760px, 88vh)";
      modal.root.style.maxWidth = "94vw";
      modal.root.style.maxHeight = "88vh";
      modal.root.style.background = "transparent";
      modal.root.style.boxShadow = "none";
      modal.root.style.borderRadius = "16px";
      modal.root.style.overflow = "hidden";

      const { html, render } = getHtmPreact();
      render(
        html`<${ConfigModalComponents.App} config=${Config.global} initialTab=${initialTab} />`,
        modal.root
      );
    }

    init() {
      // 只做一次初始探测；后续由 DOMPatcher 和用户操作按需刷新。
      this.refresh_player();
    }
  }
  // #endregion

  // #region TooltipsButton
  class TooltipsButton {
    /**
     * 播放器右下角“插件”菜单。
     *
     * V1.0.1 修复：
     * - 不再完全依赖抖音 xgplayer 自己的 hover 行为；
     * - 自己维护 open 状态；
     * - 菜单 pointer-events 强制可用；
     * - 菜单项点击时阻断播放器父层事件，避免“看得到但点不中”。
     *
     * NOTE: dy-dl-video-btn 用于标记是否已经注入。
     */
    static _html_base = (that) => html`
      <xg-icon
        class="xgplayer-playclarity-setting dy-dl-video-btn"
        data-state="normal"
        data-index="11"
      >
        <div class="gear isSmoothSwitchClarityLogin dy-dl-plugin-gear-v101">
          <div class="virtual dy-dl-plugin-menu-v101"></div>
          <div class="btn dy-dl-plugin-trigger-v101" tabindex="0" role="button" aria-label="打开插件菜单"></div>
        </div>
      </xg-icon>
    `;

    /**
     * @param {string} label
     * @param {{label?: string, callback?: Function, html?: string, render?: Function}[]} items
     * @param {Function} onclick
     */
    constructor(label, items, onclick) {
      this.label = label;
      this.items = items;
      this.onclick = onclick;
    }

    render() {
      const root = DOMPatcher.render_html(TooltipsButton._html_base(this));

      /** @type {HTMLElement} */
      const gear = root.querySelector(".dy-dl-plugin-gear-v101");
      const itemsList = root.querySelector(".dy-dl-plugin-menu-v101");
      const button = root.querySelector(".dy-dl-plugin-trigger-v101");

      if (button) {
        button.innerHTML = `${iconMarkup("download", "dy-dl-plugin-trigger-icon-v105")}<span>${this.label || "插件"}</span>`;
        button.title = "打开插件菜单";
      }

      let closeTimer = 0;

      const clearCloseTimer = () => {
        if (closeTimer) {
          clearTimeout(closeTimer);
          closeTimer = 0;
        }
      };

      const openMenu = () => {
        clearCloseTimer();
        gear?.classList.add("dy-dl-plugin-open-v101");
        root?.classList.add("dy-dl-plugin-open-v101");
      };

      const closeMenu = () => {
        clearCloseTimer();
        gear?.classList.remove("dy-dl-plugin-open-v101");
        root?.classList.remove("dy-dl-plugin-open-v101");
      };

      const scheduleClose = () => {
        clearCloseTimer();
        closeTimer = setTimeout(closeMenu, 180);
      };

      // 鼠标在按钮/菜单之间移动时保持菜单打开。
      gear?.addEventListener("mouseenter", openMenu);
      gear?.addEventListener("mouseleave", scheduleClose);
      itemsList?.addEventListener("mouseenter", openMenu);
      itemsList?.addEventListener("mouseleave", scheduleClose);

      // 防止 xgplayer 控制条抢走菜单项的 pointer/mouse/click。
      for (const eventName of ["pointerdown", "mousedown", "mouseup"]) {
        itemsList?.addEventListener(eventName, (event) => {
          event.stopPropagation();
        });
      }

      // 渲染菜单项
      for (const item of this.items) {
        if (item.html) {
          const element = DOMPatcher.render_html(item.html);
          element.classList.add("dy-dl-plugin-item-v101");
          itemsList.appendChild(element);
          continue;
        }

        if (item.render) {
          const element = item.render();
          element?.classList?.add("dy-dl-plugin-item-v101");
          itemsList.appendChild(element);
          continue;
        }

        const menuItem = DOMPatcher.render_html(
          `<div class="item dy-dl-plugin-item-v101" role="button" tabindex="0">${item.label}</div>`
        );

        const activate = (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          closeMenu();

          try {
            item.callback?.(event);
          } catch (error) {
            console.error("[dy-dl]插件菜单执行失败：", error);
            createToast(null, "操作失败，请查看控制台");
          }
        };

        menuItem.addEventListener("click", activate);
        menuItem.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            activate(event);
          }
        });

        itemsList.appendChild(menuItem);
      }

      // 点击“插件”也可固定打开 / 关闭，避免仅 hover 不稳定。
      button?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const isOpen = gear?.classList.contains("dy-dl-plugin-open-v101");

        if (isOpen) {
          closeMenu();
        } else {
          openMenu();
        }

        this.onclick?.(event);
      });

      return root;
    }
  }

  // #region Profile Page Handler
  class ProfileDataService {
    static FEED_CARD_SELECTOR =
      '.waterfall-videoCardContainer[href], [href*="/video/"][target="_blank"], [href*="/note/"][target="_blank"]';

    feedMediaCache = new Map();

    static findReactFiber(node) {
      let current = node;
      while (current instanceof HTMLElement) {
        const fiberKey = Object.keys(current).find((key) =>
          key.startsWith("__reactFiber$")
        );
        if (fiberKey) return current[fiberKey];
        current = current.parentElement;
      }
      return null;
    }

    static getAwemeIdFromHref(href = "") {
      const match = href.match(/\/(?:video|note)\/(\d+)/);
      return match?.[1] || "";
    }


    _profileTotalCache = { value: 0, at: 0 };

    static parseCompactCount(text = "") {
      const raw = String(text || "").trim().replace(/,/g, "");
      const match = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*([万wW]?)/);
      if (!match) return 0;
      const value = Number(match[1] || 0);
      if (!Number.isFinite(value)) return 0;
      return Math.round(value * (/万|w/i.test(match[2] || "") ? 10000 : 1));
    }

    /**
     * 读取作者页官方显示的作品总数（例如“作品 288”）。
     * 只作为扫描进度上限，不伪造已经成功获取的媒体数量。
     */
    getProfileReportedTotal(force = false) {
      if (!this.isProfilePage()) return 0;
      const now = performance.now();
      if (!force && now - this._profileTotalCache.at < 1800) {
        return this._profileTotalCache.value || 0;
      }

      let total = 0;
      const candidates = document.querySelectorAll(
        '[role="tab"], [class*="tab" i], button, a'
      );
      for (const element of candidates) {
        const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
        const match = text.match(/(?:^|\s)作品\s*([0-9]+(?:\.[0-9]+)?\s*[万wW]?)(?:\s|$)/);
        if (!match) continue;
        const value = ProfileDataService.parseCompactCount(match[1]);
        if (value > total && value < 1000000) total = value;
      }

      this._profileTotalCache = { value: total, at: now };
      return total;
    }

    _findCardByAwemeId(awemeId) {
      if (!awemeId) return null;
      return document.querySelector(
        `[href*="/video/${awemeId}"], [href*="/note/${awemeId}"]`
      );
    }

    getDomPreviewUrl(awemeId) {
      const card = this._findCardByAwemeId(awemeId);
      const img = card?.querySelector?.("img");
      return String(img?.currentSrc || img?.src || "").trim();
    }

    /**
     * 统一作品预览图解析：优先抖音视频 originCover，再兼容其它封面字段、图集首图，
     * 最后读取当前真实卡片 <img>。管理器只保存 URL，不强引用整份 React 媒体对象。
     */
    resolvePreviewUrl(media) {
      if (!media) return "";
      return (
        media?.video?.originCoverUrlList?.[1] ||
        media?.video?.originCoverUrlList?.[0] ||
        media?.video?.cover?.urlList?.[0] ||
        media?.video?.dynamicCover?.urlList?.[0] ||
        media?.cover?.urlList?.[0] ||
        media?.images?.[0]?.urlList?.[0] ||
        this.getDomPreviewUrl(media.awemeId) ||
        ""
      );
    }

    _extractFeedMedia(card) {
      let fiber = ProfileDataService.findReactFiber(card);
      let depth = 0;

      // 防止未来 React 结构异常时无界向父 Fiber 遍历。
      while (fiber && depth < 20) {
        const props = fiber.memoizedProps;
        const candidate =
          props?.awemeInfo ||
          props?.itemInfo?.awemeInfo ||
          (props?.itemInfo?.awemeId ? props.itemInfo : null);

        if (candidate?.awemeId) {
          this.feedMediaCache.set(candidate.awemeId, candidate);
          return candidate;
        }

        fiber = fiber.return;
        depth++;
      }

      const awemeId = ProfileDataService.getAwemeIdFromHref(
        card.getAttribute("href")
      );
      return awemeId ? this.feedMediaCache.get(awemeId) || null : null;
    }

    collectCurrentFeedMedia() {
      const medias = [];
      const seen = new Set();
      document
        .querySelectorAll(ProfileDataService.FEED_CARD_SELECTOR)
        .forEach((card) => {
          const media = this._extractFeedMedia(
            /** @type {HTMLElement} */ (card)
          );
          if (!media?.awemeId || seen.has(media.awemeId)) return;
          seen.add(media.awemeId);
          this.feedMediaCache.set(media.awemeId, media);
          medias.push(media);
        });
      return medias;
    }

    /**
     * 根据作品 ID 重新从当前作者主页卡片提取媒体信息。
     *
     * 用于 403/404/410 后刷新可能已过期的 CDN URL。
     * 不发起全站网络 Hook，只读取页面当前已有的 React Fiber 数据。
     */
    refreshMedia(awemeId) {
      if (!awemeId) return null;

      const selector = [
        `[href*="/video/${awemeId}"]`,
        `[href*="/note/${awemeId}"]`,
      ].join(",");

      const card = document.querySelector(selector);

      if (card instanceof HTMLElement) {
        const media = this._extractFeedMedia(card);
        if (media?.awemeId) {
          this.feedMediaCache.set(
            media.awemeId,
            media
          );
          return media;
        }
      }

      // 再进行一次窄化主页卡片采集，兼容 DOM 刚更新的情况。
      this.collectCurrentFeedMedia();

      return (
        this.feedMediaCache.get(awemeId) ||
        null
      );
    }

    isProfilePage() {
      return isProfilePagePath(); // 外部工具函数
    }

    getProfileContext() {
      if (!this.isProfilePage()) return null;

      const pathSecUid = location.pathname.replace(/^\/user\//, "").trim();
      const scannedMedia = this.collectCurrentFeedMedia().find(
        (media) => media?.authorInfo?.secUid
      );
      const secUid =
        pathSecUid && pathSecUid !== "self"
          ? pathSecUid
          : scannedMedia?.authorInfo?.secUid || pathSecUid || "";
      const titleName = document.title.split("的抖音")[0]?.trim() || "";
      const profileName = scannedMedia?.authorInfo?.nickname || titleName;
      const activeTab =
        new URLSearchParams(location.search).get("showTab") || "post";
      const profileKey = `${secUid || pathSecUid || "self"}:${activeTab}`;

      return { secUid, profileName, tabKey: activeTab, profileKey };
    }

    _findScrollContainer() {
      const firstCard = document.querySelector(
        ProfileDataService.FEED_CARD_SELECTOR
      );
      let current =
        firstCard instanceof HTMLElement ? firstCard.parentElement : null;
      while (current instanceof HTMLElement) {
        const style = window.getComputedStyle(current);
        const isScrollable =
          ["auto", "scroll", "overlay"].includes(style.overflowY) &&
          current.scrollHeight > current.clientHeight + 100;
        if (isScrollable) return current;
        current = current.parentElement;
      }
      return (
        document.querySelector(".route-scroll-container") ||
        document.querySelector(".parent-route-container") ||
        document.scrollingElement ||
        document.documentElement
      );
    }

    captureScrollPosition() {
      const container = this._findScrollContainer();
      if (!container) return null;
      const isDocumentScroll =
        container === document.body ||
        container === document.documentElement ||
        container === document.scrollingElement;
      return {
        container,
        isDocumentScroll,
        top: isDocumentScroll ? window.scrollY : container.scrollTop,
      };
    }

    restoreScrollPosition(state) {
      if (!state?.container) return;
      try {
        if (state.isDocumentScroll) {
          window.scrollTo({ top: state.top || 0, behavior: "auto" });
        } else if (state.container.isConnected) {
          state.container.scrollTo({ top: state.top || 0, behavior: "auto" });
        }
      } catch {}
    }

    async scrollPageOnce() {
      const container = this._findScrollContainer();
      if (!container) return false;

      const isDocumentScroll =
        container === document.body ||
        container === document.documentElement ||
        container === document.scrollingElement;

      const beforeTop = isDocumentScroll ? window.scrollY : container.scrollTop;
      const clientHeight = isDocumentScroll
        ? window.innerHeight
        : container.clientHeight;
      const scrollHeight = container.scrollHeight;
      const maxTop = Math.max(0, scrollHeight - clientHeight);
      const nextTop = Math.min(
        beforeTop + Math.max(clientHeight * 0.85, 480),
        maxTop
      );

      if (nextTop <= beforeTop + 4) return false;

      if (isDocumentScroll) {
        window.scrollTo({ top: nextTop, behavior: "auto" });
      } else {
        container.scrollTo({ top: nextTop, behavior: "auto" });
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 1200);
      });
      return true;
    }
  }

  /**
   * 事件定义（供外部订阅）
   * @typedef {{
   *   stateChanged: [ProfileDownloadManager],
   *   countsUpdated: [object],
   *   progressUpdated: [object],
   *   jobStarted: [],
   *   jobStopped: [],
   *   jobCompleted: [],
   * }} Events
   */

  /**
   * @extends {Emitter<Events>}
   */
  class ProfileDownloadManager extends Emitter {
    /** @type {MediaHandler} */
    mediaHandler;
    /** @type {ProfileDataService} */
    dataService;

    /**
     * @type {ReturnType<typeof ProfileDownloadState["create_default"]> | null}
     */
    jobState = null;
    jobRunning = false;
    jobStopRequested = false;
    jobPauseRequested = false;
    jobCancelRequested = false;

    /** 暂停后的运行计划，只保存在当前页面会话。 */
    pausedRun = null;

    /** 稳定任务快照：页面虚拟列表卸载卡片后，管理器仍能显示完整队列。 */
    taskSnapshots = new Map();

    /** 完成后的活动进度清理计时器（一次性，不是永久轮询）。 */
    completionCleanupTimer = 0;

    /**
     * V1.0.7 一次性完整扫描状态。
     * 只有用户点击“扫描全部/全选全部”时运行，结束后没有后台扫描计时器。
     */
    discoveryScan = {
      running: false,
      cancelRequested: false,
      selectAllAfter: false,
      scanned: 0,
      total: 0,
      message: "",
    };

    /** @type {Set<string>} 选中的媒体 */
    selectedIds = new Set();

    /** 本次批量任务运行时进度，不写入 localStorage。 */
    currentRun = null;

    /**
     * 当前页面会话中保留上一次 Chrome 目录句柄。
     * 失败任务重试时可继续写入同一目录，不重复弹选择框。
     */
    browserContext = null;

    /** 失败任务的非持久化恢复信息，例如 FileHandle / Range 断点。 */
    failureRuntime = new Map();

    /** 仅重试指定任务时使用，不写入 localStorage。 */
    pendingOverride = null;

    _lastProgressEmitAt = 0;

    /**
     * @param {{ mediaHandler: MediaHandler, dataService: ProfileDataService }} deps
     */
    constructor({ mediaHandler, dataService }) {
      super();
      this.mediaHandler = mediaHandler;
      this.dataService = dataService;

      // 不再每 5 秒全量扫描作者主页。
      this.collectOnScroll = throttle(
        this.collect.bind(this),
        900
      );
      window.addEventListener(
        "wheel",
        this.collectOnScroll,
        { passive: true }
      );
      window.addEventListener(
        "touchend",
        this.collectOnScroll,
        { passive: true }
      );
    }

    _publishTaskCenter() {
      try {
        UnifiedTaskCenter.updateBatch(
          this.getSnapshot()
        );
      } catch (error) {
        console.warn(
          "[dy-dl]更新统一任务中心失败：",
          error
        );
      }
    }

    collect() {
      if (!this.dataService.isProfilePage()) {
        return;
      }

      const prev =
        this.jobState?.knownIds.length ||
        0;

      const mediaList =
        this.dataService
          .collectCurrentFeedMedia();

      this.mergeMediaIntoState(
        mediaList
      );

      let snapshotUpdated = false;
      mediaList.forEach((media) => {
        const before = this.taskSnapshots.get(media?.awemeId || "");
        const beforeCover = before?.coverUrl || "";
        const beforeDesc = before?.desc || "";
        const next = this._rememberTaskSnapshot(media);
        if (next && (next.coverUrl !== beforeCover || next.desc !== beforeDesc)) {
          snapshotUpdated = true;
        }
      });

      const changed =
        (this.jobState?.knownIds.length ||
          0) - prev;

      if (changed || snapshotUpdated) {
        this.emit("stateChanged");
        this.emit(
          "countsUpdated",
          this.getCounts()
        );
        this._publishTaskCenter();
      }
    }

    _ensureJobState(
      profile =
        this.dataService
          .getProfileContext()
    ) {
      if (!profile) {
        this.jobState = null;
        return null;
      }

      if (
        !this.jobState ||
        (
          !this.jobRunning &&
          this.jobState.profileKey !==
            profile.profileKey
        )
      ) {
        const profileChanged =
          Boolean(
            this.jobState?.profileKey &&
            this.jobState.profileKey !==
              profile.profileKey
          );

        this.jobState =
          ProfileDownloadState.load(
            profile.profileKey,
            profile
          );

        if (profileChanged) {
          this.browserContext = null;
          this.failureRuntime.clear();
          this.pendingOverride = null;
          this.pausedRun = null;
          this.currentRun = null;
          this.taskSnapshots.clear();
        }
      }

      return this.jobState;
    }

    _saveJobState() {
      if (!this.jobState?.profileKey) {
        return this.jobState;
      }

      this.jobState =
        ProfileDownloadState.save(
          this.jobState.profileKey,
          this.jobState
        );

      return this.jobState;
    }

    _rememberTaskSnapshot(media, queueIndex = 0) {
      if (!media?.awemeId) return null;
      const previous = this.taskSnapshots.get(media.awemeId) || {};
      const coverUrl =
        this.dataService.resolvePreviewUrl(media) ||
        previous.coverUrl || "";
      const snapshot = {
        ...previous,
        awemeId: media.awemeId,
        queueIndex: Number(queueIndex || previous.queueIndex || 0),
        desc: media.desc || previous.desc || MediaHandler.toShortId(media.awemeId),
        coverUrl,
        createTime: Number(media.createTime || previous.createTime || 0),
        type: Array.isArray(media.images) && media.images.length ? "album" : "video",
      };
      this.taskSnapshots.set(media.awemeId, snapshot);
      return snapshot;
    }

    getTaskSnapshot(awemeId) {
      return this.taskSnapshots.get(awemeId) || null;
    }

    getTaskSnapshotIds() {
      return Array.from(this.taskSnapshots.keys());
    }

    mergeMediaIntoState(mediaList) {
      if (!this.jobState) return;

      const knownIds =
        new Set(
          this.jobState.knownIds || []
        );

      mediaList.forEach((media) => {
        if (media?.awemeId) {
          knownIds.add(media.awemeId);
        }
      });

      this.jobState.knownIds =
        Array.from(knownIds);
    }

    markDownloaded(media) {
      if (
        !this.jobState ||
        !media?.awemeId
      ) {
        return;
      }

      const downloadedIds =
        new Set(
          this.jobState.downloadedIds ||
          []
        );

      downloadedIds.add(media.awemeId);

      this.jobState.downloadedIds =
        Array.from(downloadedIds);

      delete this.jobState
        .submittedItems?.[media.awemeId];
      delete this.jobState
        .failedItems?.[media.awemeId];

      this.failureRuntime.delete(
        media.awemeId
      );
    }

    markSubmitted(media, result = {}) {
      if (
        !this.jobState ||
        !media?.awemeId
      ) {
        return;
      }

      this.jobState.submittedItems =
        this.jobState.submittedItems ||
        {};

      this.jobState.submittedItems[
        media.awemeId
      ] = {
        method:
          result.method ||
          "external",
        updatedAt: Date.now(),
        desc: media.desc || "",
      };

      delete this.jobState
        .failedItems?.[media.awemeId];

      this.failureRuntime.delete(
        media.awemeId
      );
    }

    markFailed(media, failure = {}) {
      if (
        !this.jobState ||
        !media?.awemeId
      ) {
        return;
      }

      const result =
        typeof failure === "string"
          ? { reason: failure }
          : failure || {};

      const classification =
        DownloadRecoveryPolicy.classify(
          result
        );

      const previous =
        this.jobState.failedItems?.[
          media.awemeId
        ] || {};

      this.jobState.failedItems =
        this.jobState.failedItems ||
        {};

      this.jobState.failedItems[
        media.awemeId
      ] = {
        count:
          Number(previous.count || 0) +
          1,
        reason:
          result.reason ||
          classification.code,
        code:
          result.failureCode ||
          classification.code,
        message:
          result.message ||
          classification.message,
        httpStatus:
          Number(
            result.httpStatus ||
            classification.status ||
            0
          ),
        retryable:
          result.retryable !== undefined
            ? Boolean(result.retryable)
            : Boolean(
                classification.retryable
              ),
        unavailable:
          Boolean(
            result.unavailable ||
            classification.unavailable
          ),
        resumeAvailable:
          Boolean(
            result.resumeAvailable
          ),
        method:
          result.method || "",
        loaded:
          Number(
            result.failure?.loaded ||
            result.loaded ||
            0
          ),
        total:
          Number(
            result.failure?.total ||
            result.total ||
            0
          ),
        updatedAt: Date.now(),
        desc:
          media.desc ||
          previous.desc ||
          "",
      };

      this.failureRuntime.set(
        media.awemeId,
        {
          retryContext:
            result.retryContext ||
            result.failure
              ?.retryContext ||
            null,
          result,
        }
      );
    }

    removeFailed(awemeId) {
      if (
        !this.jobState?.failedItems?.[
          awemeId
        ]
      ) {
        return false;
      }

      delete this.jobState
        .failedItems[awemeId];

      this.failureRuntime.delete(
        awemeId
      );

      this._saveJobState();
      this.emit("stateChanged", this);
      this.emit(
        "countsUpdated",
        this.getCounts()
      );
      this._publishTaskCenter();
      return true;
    }

    getFailure(awemeId) {
      return (
        this.jobState?.failedItems?.[
          awemeId
        ] || null
      );
    }

    async retryFailed(
      awemeIds = null
    ) {
      if (this.jobRunning) {
        throw new Error(
          "当前批量任务仍在运行中。"
        );
      }

      const allFailed =
        Object.keys(
          this.jobState?.failedItems ||
            {}
        );

      const requested =
        Array.isArray(awemeIds)
          ? awemeIds
          : allFailed;

      const ids = requested.filter(
        (id) =>
          Boolean(
            this.jobState?.failedItems?.[
              id
            ]
          )
      );

      if (!ids.length) {
        createToast(null).update(
          "没有可重试的失败任务",
          1800
        );
        return;
      }

      this.pendingOverride = ids;
      this.selectedIds =
        new Set(ids);

      await this.startJob({
        onlyIds: ids,
        reuseBrowserContext: true,
      });
    }

    markSelect(awemeId, selected) {
      const changed = selected
        ? !this.selectedIds.has(
            awemeId
          )
        : this.selectedIds.has(
            awemeId
          );

      if (selected) {
        this.selectedIds.add(awemeId);
        const media = this.dataService.feedMediaCache.get(awemeId);
        if (media) this._rememberTaskSnapshot(media);
      } else {
        this.selectedIds.delete(
          awemeId
        );
      }

      if (changed) {
        if (selected && !this.jobRunning && !this.pausedRun && this.jobState?.status === "completed") {
          this.jobState.status = "idle";
          this.currentRun = null;
          this._saveJobState();
        }
        this.emit("stateChanged");
        this.emit(
          "countsUpdated",
          this.getCounts()
        );
        this._publishTaskCenter();
      }
    }

    markSelectAll(selected) {
      if (!selected) {
        this.selectedIds.clear();
      } else {
        this.jobState?.knownIds?.forEach((awemeId) => {
          this.selectedIds.add(awemeId);
          const media = this.dataService.feedMediaCache.get(awemeId);
          if (media) this._rememberTaskSnapshot(media);
        });
      }

      if (selected && !this.jobRunning && !this.pausedRun && this.jobState?.status === "completed") {
        this.jobState.status = "idle";
        this.currentRun = null;
        this._saveJobState();
      }
      this.emit("stateChanged");
      this.emit(
        "countsUpdated",
        this.getCounts()
      );
      this._publishTaskCenter();
    }

    isSelectAll() {
      return (
        this.selectedIds.size > 0 &&
        this.selectedIds.size ===
          this.jobState?.knownIds
            ?.length
      );
    }

    _isFeedSelected(awemeId) {
      return this.selectedIds.has(
        awemeId
      );
    }

    getCounts() {
      const known = this.jobState?.knownIds?.length || 0;
      const officialTotal = this.dataService.getProfileReportedTotal() || 0;
      const reportedTotal = Math.max(known, officialTotal || 0);
      return {
        known,
        reportedTotal,
        hasReportedTotal: officialTotal > 0,
        downloaded:
          this.jobState?.downloadedIds
            ?.length || 0,
        submitted:
          Object.keys(
            this.jobState
              ?.submittedItems || {}
          ).length,
        failed:
          Object.keys(
            this.jobState
              ?.failedItems || {}
          ).length,
        selected:
          this.selectedIds.size,
        is_selected_all:
          this.isSelectAll() && (!officialTotal || known >= officialTotal),
      };
    }

    getStorageSummary() {
      const using = Config.global.features.using_downloader || "browser";
      const cfg = Config.global.features.downloader_config || {};
      if (using === "browser") {
        if (this.browserContext?.kind === "directory" && this.browserContext?.directoryHandle?.name) {
          return {
            method: "Chrome 流式写入",
            location: this.browserContext.directoryHandle.name,
            detail: "Chrome 已授权文件夹（浏览器不会向网页暴露完整 Windows 绝对路径）",
          };
        }
        if (this.browserContext?.kind === "fallback") {
          return { method: "浏览器下载", location: "浏览器默认下载目录", detail: "当前任务使用浏览器默认保存位置" };
        }
        return { method: "浏览器下载", location: "尚未选择保存位置", detail: "开始批量任务时将选择目录或使用浏览器默认目录" };
      }

      const dirConfig = cfg?.[using]?.dir;
      const location = typeof dirConfig === "string"
        ? dirConfig
        : dirConfig?.video || dirConfig?.image || dirConfig?.other || "下载器配置目录";
      return {
        method: using === "aria2" ? "aria2 RPC" : "AB Download Manager",
        location: String(location || "下载器配置目录").replace(/^`|`$/g, ""),
        detail: "保存位置来自下载器配置",
      };
    }

    cancelDiscoveryScan() {
      if (!this.discoveryScan.running) return false;
      this.discoveryScan.cancelRequested = true;
      this.discoveryScan.message = "正在停止扫描…";
      this.emit("stateChanged", this);
      return true;
    }

    async scanAll(options = {}) {
      if (!this.dataService.isProfilePage()) {
        throw new Error("请在作者主页中扫描作品。");
      }
      if (this.discoveryScan.running) return;
      if (this.jobRunning) {
        throw new Error("批量下载正在运行，请在任务完成或暂停后再扫描全部作品。");
      }

      this._ensureJobState();
      const selectAllAfter = Boolean(options.selectAllAfter);
      const restoreState = this.dataService.captureScrollPosition();
      this.discoveryScan = {
        running: true,
        cancelRequested: false,
        selectAllAfter,
        scanned: this.jobState?.knownIds?.length || 0,
        total: this.dataService.getProfileReportedTotal(true) || 0,
        message: "正在载入作者作品…",
      };
      this.emit("stateChanged", this);
      this.emit("countsUpdated", this.getCounts());

      let stableRounds = 0;
      let steps = 0;
      try {
        this.collect();
        while (!this.discoveryScan.cancelRequested && steps < 480) {
          const before = this.jobState?.knownIds?.length || 0;
          const reported = this.dataService.getProfileReportedTotal() || this.discoveryScan.total || 0;
          this.discoveryScan.scanned = before;
          this.discoveryScan.total = Math.max(reported, before);

          if (reported > 0 && before >= reported) break;

          const moved = await this.dataService.scrollPageOnce();
          this.collect();
          const after = this.jobState?.knownIds?.length || 0;
          this.discoveryScan.scanned = after;
          this.discoveryScan.total = Math.max(
            this.dataService.getProfileReportedTotal() || 0,
            this.discoveryScan.total || 0,
            after
          );
          this.discoveryScan.message = `正在扫描作品 ${after}${this.discoveryScan.total ? ` / ${this.discoveryScan.total}` : ""}`;
          this.emit("stateChanged", this);
          this.emit("countsUpdated", this.getCounts());

          if (after > before) stableRounds = 0;
          else stableRounds += 1;

          // 到达当前底部时给抖音一次继续懒加载的机会；连续无新增后才停止。
          if (!moved && stableRounds < 4) {
            await new Promise((resolve) => {
              setTimeout(resolve, 950);
            });
            this.collect();
            const late = this.jobState?.knownIds?.length || 0;
            if (late > after) stableRounds = 0;
          }

          if ((!moved && stableRounds >= 4) || stableRounds >= 7) break;
          steps += 1;
        }

        if (!this.discoveryScan.cancelRequested && selectAllAfter) {
          this.selectedIds = new Set(this.jobState?.knownIds || []);
          for (const awemeId of this.selectedIds) {
            const media = this.dataService.feedMediaCache.get(awemeId);
            if (media) this._rememberTaskSnapshot(media);
          }
        }
      } finally {
        const cancelled = this.discoveryScan.cancelRequested;
        this.dataService.restoreScrollPosition(restoreState);
        const known = this.jobState?.knownIds?.length || 0;
        const reported = this.dataService.getProfileReportedTotal(true) || 0;
        this.discoveryScan = {
          running: false,
          cancelRequested: false,
          selectAllAfter: false,
          scanned: known,
          total: Math.max(known, reported),
          message: cancelled
            ? `扫描已停止 · 已载入 ${known}${reported ? ` / ${reported}` : ""}`
            : `扫描完成 · 已载入 ${known}${reported ? ` / ${reported}` : ""}`,
        };
        this.emit("stateChanged", this);
        this.emit("countsUpdated", this.getCounts());
        this._publishTaskCenter();
      }
    }

    getSnapshot(profileNameFallback = "当前作者主页") {
      const isProfilePage = this.dataService.isProfilePage();
      const profile = !this.jobRunning && isProfilePage
        ? this.dataService.getProfileContext()
        : null;
      const profileName = this.jobState?.profileName || profile?.profileName || profileNameFallback;

      const statusLabel = this.jobRunning
        ? "进行中"
        : this.jobPauseRequested || this.pausedRun
        ? "已暂停"
        : this.jobState?.status === "completed"
        ? "已完成"
        : "待开始";

      const counts = this.getCounts();
      const run = this.currentRun
        ? {
            ...this.currentRun,
            current: this.currentRun.current ? { ...this.currentRun.current } : null,
            items: Array.isArray(this.currentRun.items)
              ? this.currentRun.items.map((item) => ({ ...item }))
              : [],
          }
        : null;

      const pausedState = this.pausedRun?.recoveryContext?.__resumeState || null;
      const resumeCapability = this.pausedRun
        ? this.pausedRun.queueBoundary
          ? "queue_ready"
          : pausedState?.capability || (pausedState?.offset > 0 ? "unknown" : "unsupported")
        : "none";
      const resumeStatusMap = {
        queue_ready: "已在任务之间暂停，可从下一项继续",
        unknown: "已暂停，续传能力尚未检查",
        checking: "正在检查断点续传",
        supported: "已确认支持断点续传",
        unsupported: "服务器不支持断点续传",
        invalid_range: "断点范围无效，需要重新下载当前文件",
        network_unavailable: "续传检查未完成，请稍后重新检查",
        none: "",
      };

      return {
        jobRunning: this.jobRunning,
        profileName,
        statusLabel,
        counts,
        run,
        canResume: Boolean(this.pausedRun),
        resumeCapability,
        resumeStatus: resumeStatusMap[resumeCapability] || "已暂停",
        resumeBytes: Number(pausedState?.offset || 0),
        discovery: { ...this.discoveryScan },
        storage: this.getStorageSummary(),
        resume: this.pausedRun ? () => this.resumeJob() : null,
        restartCurrent: this.pausedRun ? () => this.restartPausedCurrent() : null,
        cancel: this.pausedRun ? () => this.cancelJob() : null,
        summary:
          `${statusLabel} 选择/发现: ${counts.selected}/${counts.known}\n` +
          `已完成: ${counts.downloaded} 已提交: ${counts.submitted} 失败: ${counts.failed}`,
      };
    }

    resetState() {
      const profile =
        this.dataService
          .getProfileContext();

      if (!profile) return false;

      if (this.jobRunning) {
        this.stopJob();
      }

      ProfileDownloadState.reset(
        profile.profileKey
      );

      this.jobState =
        ProfileDownloadState
          .create_default(profile);

      this.currentRun = null;
      this.pausedRun = null;
      this.pendingOverride = null;
      this.failureRuntime.clear();
      this.browserContext = null;
      this.taskSnapshots.clear();
      this.discoveryScan = { running: false, cancelRequested: false, selectAllAfter: false, scanned: 0, total: 0, message: "" };
      clearTimeout(this.completionCleanupTimer);

      this.collect();
      this.emit("stateChanged", this);
      this._publishTaskCenter();
      return true;
    }

    stopJob() {
      if (!this.jobRunning) return;
      this.jobPauseRequested = true;
      this.jobStopRequested = true;
      DownloadRuntime.cancelActive("pause");

      if (this.jobState?.profileKey) {
        this.jobState.status = "paused";
        this._saveJobState();
      }

      this.emit("jobStopped");
      this.emit("stateChanged", this);
      this._publishTaskCenter();
    }

    cancelJob() {
      this.jobCancelRequested = true;
      this.jobPauseRequested = false;
      this.jobStopRequested = true;
      DownloadRuntime.cancelActive("cancel");
      this.pausedRun = null;
      if (!this.jobRunning) this.currentRun = null;
      if (this.jobState?.profileKey) {
        this.jobState.status = "idle";
        this._saveJobState();
      }
      this.emit("stateChanged", this);
      this._publishTaskCenter();
    }

    async resumeJob() {
      if (!this.pausedRun) {
        throw new Error("没有可继续的暂停任务。请重新选择作品后开始下载。");
      }
      const state = this.pausedRun?.recoveryContext?.__resumeState || null;
      const capability = state?.capability || (state?.offset > 0 ? "unknown" : "unsupported");
      if (["unsupported", "invalid_range"].includes(capability)) {
        throw new Error("当前文件已确认无法安全续传，请使用“重新下载当前文件”。");
      }
      return this.startJob({ resume: true, reuseBrowserContext: true });
    }

    async restartPausedCurrent() {
      if (!this.pausedRun) {
        throw new Error("没有可重新下载的暂停任务。");
      }
      this.pausedRun = {
        ...this.pausedRun,
        recoveryContext: {
          ...(this.pausedRun.recoveryContext || {}),
          __forceRestartCurrent: true,
          __resumeState: null,
        },
      };
      return this.startJob({ resume: true, reuseBrowserContext: true });
    }

    async startJob(options = {}) {
      if (!this.dataService.isProfilePage()) throw new Error("请在作者主页中使用批量下载。");
      if (this.jobRunning) return;
      if (this.mediaHandler.downloading) throw new Error("当前已有下载任务在进行中。");

      clearTimeout(this.completionCleanupTimer);
      const resumePlan = options.resume ? this.pausedRun : null;
      const requestedIds = resumePlan
        ? resumePlan.queueIds
        : Array.isArray(options.onlyIds)
        ? options.onlyIds
        : this.pendingOverride;

      if (!(options.reuseBrowserContext && this.browserContext)) {
        this.browserContext = await this.mediaHandler.downloader.prepareBrowserBatchContext({
          suggestedName: this.dataService.getProfileContext()?.profileName || "douyin",
        });
      }

      if (this.browserContext?.cancelled) {
        createToast(null).update("已取消选择保存目录", 1700);
        this.browserContext = null;
        return;
      }

      const releaseLock = this.mediaHandler._flag_start_download();
      this.jobRunning = true;
      this.jobStopRequested = false;
      this.jobPauseRequested = false;
      this.jobCancelRequested = false;
      this.pendingOverride = null;
      if (resumePlan) this.pausedRun = null;

      this.emit("jobStarted");
      this.emit("stateChanged", this);
      this._publishTaskCenter();

      try {
        await this._runDownloadLoop(requestedIds, resumePlan);
      } finally {
        this.jobRunning = false;
        this.jobStopRequested = false;
        this.jobPauseRequested = false;
        this.jobCancelRequested = false;
        DownloadRuntime.clearCancel();
        releaseLock();
        this.emit("stateChanged", this);
        this._publishTaskCenter();
      }
    }

    _setRunItem(
      awemeId,
      patch = {}
    ) {
      if (
        !this.currentRun?.items
      ) {
        return;
      }

      const item =
        this.currentRun.items.find(
          (entry) =>
            entry.awemeId === awemeId
        );

      if (item) {
        Object.assign(item, patch);
      }
    }

    _emitProgress(
      progress,
      force = false
    ) {
      const now = performance.now();

      if (
        !force &&
        now -
          this._lastProgressEmitAt <
          500
      ) {
        return;
      }

      this._lastProgressEmitAt = now;

      if (this.currentRun) {
        this.currentRun.current = {
          ...progress,
          batch: true,
        };

        if (
          this.currentRun.currentAwemeId
        ) {
          this._setRunItem(
            this.currentRun
              .currentAwemeId,
            {
              phase:
                progress.phase ||
                "downloading",
              status:
                progress.status ||
                "正在下载",
              percent:
                Number.isFinite(
                  progress.percent
                )
                  ? progress.percent
                  : 0,
              loaded:
                Number(
                  progress.loaded ||
                  0
                ),
              total:
                Number(
                  progress.total ||
                  0
                ),
              method:
                progress.method || "",
              resumeAvailable: Boolean(progress.resumeAvailable),
              resumeCapability: progress.resumeCapability || "",
            }
          );
        }
      }

      const runSnapshot =
        this.currentRun
          ? {
              ...this.currentRun,
              current: {
                ...this.currentRun
                  .current,
              },
            }
          : null;

      this.emit(
        "progressUpdated",
        runSnapshot
      );

      this._publishTaskCenter();
    }

    async _runDownloadLoop(onlyIds = null, resumePlan = null) {
      const profile = this.dataService.getProfileContext();
      if (!profile) throw new Error("无法获取作者信息。");
      this._ensureJobState(profile);

      this.jobState.status = "running";
      this.jobState.lastRunAt = Date.now();
      this.jobState.completedAt = 0;
      this._saveJobState();

      const downloadedSet = new Set(this.jobState.downloadedIds || []);
      const submittedSet = new Set(Object.keys(this.jobState.submittedItems || {}));
      const sourceIds = resumePlan
        ? Array.from(resumePlan.queueIds || [])
        : Array.isArray(onlyIds)
        ? onlyIds
        : Array.from(this.selectedIds);
      const pendingIds = resumePlan
        ? sourceIds
        : sourceIds.filter((id) => !downloadedSet.has(id) && !submittedSet.has(id));

      let startIndex = Number(resumePlan?.nextIndex || 0);
      if (resumePlan?.currentRun) {
        this.currentRun = {
          ...resumePlan.currentRun,
          current: resumePlan.currentRun.current ? { ...resumePlan.currentRun.current } : null,
          items: (resumePlan.currentRun.items || []).map((item) => ({ ...item })),
        };
      } else {
        this.currentRun = {
          total: pendingIds.length,
          processed: 0,
          completed: 0,
          submitted: 0,
          failed: 0,
          currentIndex: 0,
          currentAwemeId: "",
          current: null,
          items: pendingIds.map((awemeId, index) => {
            const media = this.dataService.feedMediaCache.get(awemeId) || this.dataService.refreshMedia(awemeId);
            const snap = media ? this._rememberTaskSnapshot(media, index + 1) : this.getTaskSnapshot(awemeId);
            return {
              awemeId,
              index: index + 1,
              queueIndex: index + 1,
              desc: snap?.desc || "作品待加载",
              coverUrl: snap?.coverUrl || "",
              createTime: snap?.createTime || 0,
              type: snap?.type || "video",
              phase: "waiting",
              status: "等待中",
              percent: 0,
              loaded: 0,
              total: 0,
            };
          }),
        };
      }

      this.emit("stateChanged", this);
      this._publishTaskCenter();

      if (!pendingIds.length) {
        this.jobState.status = "completed";
        this.jobState.completedAt = Date.now();
        this._saveJobState();
        this.currentRun = null;
        this.emit("jobCompleted");
        this.emit("stateChanged", this);
        this._publishTaskCenter();
        return;
      }

      for (let index = startIndex; index < pendingIds.length; index++) {
        const awemeId = pendingIds[index];

        if (this.jobCancelRequested) {
          this.jobState.status = "idle";
          this.pausedRun = null;
          this.currentRun = null;
          this._saveJobState();
          return;
        }

        // 用户可能恰好在两个文件切换的间隙点击暂停。此时没有活动网络请求，
        // 直接保存队列边界，不能再启动下一项下载。
        if (this.jobPauseRequested) {
          this.jobState.status = "paused";
          this.currentRun.currentIndex = index;
          this.currentRun.currentAwemeId = awemeId;
          this.currentRun.current = {
            filename:
              this.getTaskSnapshot(awemeId)?.desc ||
              MediaHandler.toShortId(awemeId),
            phase: "paused",
            status: "已暂停，可从下一项继续",
            loaded: 0,
            total: 0,
            percent: 0,
            batch: true,
            taskIndex: index + 1,
            taskTotal: pendingIds.length,
          };
          this._setRunItem(awemeId, {
            phase: "paused",
            status: "已暂停，可从此项继续",
          });
          this.pausedRun = {
            queueIds: pendingIds,
            nextIndex: index,
            currentAwemeId: awemeId,
            recoveryContext: null,
            queueBoundary: true,
            currentRun: {
              ...this.currentRun,
              current: { ...this.currentRun.current },
              items: this.currentRun.items.map((item) => ({ ...item })),
            },
          };
          this._saveJobState();
          this.emit("stateChanged", this);
          this._publishTaskCenter();
          return;
        }

        let media = this.dataService.feedMediaCache.get(awemeId) || this.dataService.refreshMedia(awemeId);
        if (media) this._rememberTaskSnapshot(media, index + 1);

        this.currentRun.currentIndex = index + 1;
        this.currentRun.currentAwemeId = awemeId;
        this.currentRun.current = {
          filename: media?.desc || this.getTaskSnapshot(awemeId)?.desc || MediaHandler.toShortId(awemeId),
          phase: "preparing",
          status: "正在准备",
          loaded: 0,
          total: 0,
          percent: 0,
          batch: true,
          taskIndex: index + 1,
          taskTotal: pendingIds.length,
        };
        this._setRunItem(awemeId, {
          filename: this.currentRun.current.filename,
          phase: "preparing",
          status: "正在准备",
        });
        this._emitProgress(this.currentRun.current, true);

        if (!media) {
          const unavailable = {
            reason: "target_unavailable",
            failureCode: "not_found",
            message: "作品已不可用，可能被作者删除、设为私密、平台下架，或当前账号/地区无权访问",
            unavailable: true,
            retryable: false,
          };
          this.markFailed({ awemeId, desc: this.getTaskSnapshot(awemeId)?.desc || "作品不可用" }, unavailable);
          this.currentRun.failed++;
          this.currentRun.processed++;
          this._setRunItem(awemeId, { phase: "unavailable", status: unavailable.message, percent: 0, unavailable: true });
          this._saveJobState();
          this.emit("countsUpdated", this.getCounts());
          this._publishTaskCenter();
          continue;
        }

        const runtimeFailure = this.failureRuntime.get(awemeId);
        const resumeContext =
          resumePlan?.currentAwemeId === awemeId
            ? resumePlan.recoveryContext
            : runtimeFailure?.retryContext || null;

        const result = await this.mediaHandler._download_media_logic(media, {
          toastTarget: null,
          toast: { update: () => {} },
          toastPrefix: "批量下载",
          alertOnFail: false,
          addHistory: true,
          batch: true,
          taskIndex: index + 1,
          taskTotal: pendingIds.length,
          browserContext: this.browserContext,
          recoveryContext: resumeContext,
          refreshMedia: async () => {
            media = this.dataService.refreshMedia(awemeId);
            if (media) this._rememberTaskSnapshot(media, index + 1);
            return media;
          },
          onCancelReady: (handler) => DownloadRuntime.setCancel(handler),
          onProgress: (progress) => this._emitProgress(progress),
        });

        if (
          result?.paused ||
          (this.jobPauseRequested &&
            !result?.completed &&
            !result?.submitted &&
            !result?.mixed)
        ) {
          this.jobState.status = "paused";
          const resumeCapability =
            result?.resumeCapability ||
            result?.retryContext?.__resumeState?.capability ||
            (result?.retryContext?.__resumeState?.offset > 0 ? "unknown" : "unsupported");
          const pausedStatus = {
            unknown: "已暂停，续传能力尚未检查",
            supported: "已暂停，可从断点继续",
            unsupported: "已暂停，服务器不支持断点续传",
            invalid_range: "已暂停，断点范围无效",
            network_unavailable: "已暂停，续传检查未完成",
          }[resumeCapability] || "已暂停";
          this._setRunItem(awemeId, {
            phase: "paused",
            status: pausedStatus,
            resumeAvailable: resumeCapability === "supported",
            resumeCapability,
          });
          this.pausedRun = {
            queueIds: pendingIds,
            nextIndex: index,
            currentAwemeId: awemeId,
            recoveryContext: result?.retryContext || null,
            currentRun: {
              ...this.currentRun,
              current: {
                ...(this.currentRun.current || {}),
                phase: "paused",
                status: pausedStatus,
                speed: 0,
                eta: NaN,
                resumeCapability,
              },
              items: this.currentRun.items.map((item) => ({ ...item })),
            },
          };
          this._saveJobState();
          this.emit("stateChanged", this);
          this._publishTaskCenter();
          return;
        }

        if (result?.cancelled || this.jobCancelRequested) {
          this.jobState.status = "idle";
          this.pausedRun = null;
          this.currentRun = null;
          this._saveJobState();
          this.emit("stateChanged", this);
          this._publishTaskCenter();
          return;
        }

        if (result?.completed) {
          this.markDownloaded(media);
          this.currentRun.completed++;
          this.selectedIds.delete(awemeId);
          this._setRunItem(awemeId, { phase: "completed", status: "已完成", percent: 100 });
        } else if (result?.submitted || result?.mixed) {
          this.markSubmitted(media, result);
          this.currentRun.submitted++;
          this.selectedIds.delete(awemeId);
          this._setRunItem(awemeId, { phase: "submitted", status: "已提交下载器", percent: 100 });
        } else {
          this.markFailed(media, result || { reason: "download_failed" });
          this.currentRun.failed++;
          this.selectedIds.add(awemeId);
          const failure = this.getFailure(awemeId);
          this._setRunItem(awemeId, {
            phase: failure?.unavailable ? "unavailable" : "failed",
            status: failure?.message || "下载失败",
            percent: 0,
            retryable: failure?.retryable,
            resumeAvailable: failure?.resumeAvailable,
            unavailable: failure?.unavailable,
          });
        }

        this.currentRun.processed++;
        this.currentRun.current = {
          ...(this.currentRun.current || {}),
          phase: result?.completed ? "completed" : result?.submitted || result?.mixed ? "submitted" : result?.unavailable ? "unavailable" : "failed",
          status: result?.completed ? "已完成" : result?.submitted || result?.mixed ? "已提交下载器" : result?.message || "失败",
          percent: result?.completed || result?.submitted || result?.mixed ? 100 : 0,
          batch: true,
        };
        this._emitProgress(this.currentRun.current, true);
        this._saveJobState();
        this.emit("countsUpdated", this.getCounts());
        this._publishTaskCenter();
        await new Promise((resolve) => {
          setTimeout(resolve, 280);
        });
      }

      this.jobState.status = "completed";
      this.jobState.completedAt = Date.now();
      this.pausedRun = null;
      // 顶部活动文件信息立即清空，任务行历史继续保留。
      if (this.currentRun) this.currentRun.current = null;
      this._saveJobState();
      this.emit("jobCompleted");
      this.emit("stateChanged", this);
      this._publishTaskCenter();

      const completedRun = this.currentRun;
      clearTimeout(this.completionCleanupTimer);
      this.completionCleanupTimer = setTimeout(() => {
        if (!this.jobRunning && this.jobState?.status === "completed" && this.currentRun === completedRun) {
          this.currentRun = null;
          this.emit("stateChanged", this);
          this._publishTaskCenter();
        }
      }, 6000);
    }
  }

  // ========== 批量下载管理模态框 ==========
  const ProfileJobModalComponents = (() => {
    const { useState, useEffect, useMemo, useCallback, html } = getHtmPreact();
    const css = createCSS();
    const icon = (name) => html`<span class="dy-dl-inline-icon-v106" dangerouslySetInnerHTML=${{ __html: UI_ICONS[name] || "" }}></span>`;

    const c = {
      app: css({
        width: "min(1180px, 92vw)", height: "min(760px, 88vh)", display: "flex", flexDirection: "column", overflow: "hidden",
        border: `1px solid ${theme.colors.borderLight}`, borderRadius: theme.borderRadius.lg, background: theme.colors.bgOverlay,
        color: theme.colors.textPrimary, boxShadow: theme.shadow.panel,
        fontFamily: 'system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      }),
      header: css({ padding: "20px 22px 16px", borderBottom: `1px solid ${theme.colors.borderLight}` }),
      headerTop: css({ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "18px", paddingRight: "42px" }),
      titleGroup: css({ display: "flex", gap: "12px", minWidth: 0 }),
      titleIcon: css({ width: "36px", height: "36px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "10px", background: theme.colors.primarySoft, color: "#8FA7FF" }),
      title: css({ margin: 0, fontSize: "18px", fontWeight: 720, lineHeight: 1.25 }),
      subtitle: css({ marginTop: "4px", color: theme.colors.textMuted, fontSize: "12px" }),
      statusTag: css({ minHeight: "28px", display: "inline-flex", alignItems: "center", gap: "6px", padding: "0 10px", borderRadius: theme.borderRadius.full, border: `1px solid ${theme.colors.borderLight}`, background: theme.colors.bgControl, color: theme.colors.textSecondary, fontSize: "11px", fontWeight: 650 }),
      statusWrap: css({ position: "relative", display: "inline-flex", '&:hover [data-role="status-tip"]': { opacity: 1, visibility: "visible" }, '&:focus-within [data-role="status-tip"]': { opacity: 1, visibility: "visible" } }),
      statusTooltip: css({ position: "absolute", zIndex: 30, top: "36px", right: 0, width: "300px", padding: "12px 13px", border: `1px solid ${theme.colors.borderMedium}`, borderRadius: "11px", background: theme.colors.bgFieldset, boxShadow: theme.shadow.panel, opacity: 0, visibility: "hidden", pointerEvents: "none", color: theme.colors.textSecondary, fontSize: "11px", lineHeight: 1.55 }),
      tooltipTitle: css({ color: theme.colors.textPrimary, fontSize: "12px", fontWeight: 700, marginBottom: "8px" }),
      tooltipRow: css({ display: "grid", gridTemplateColumns: "74px minmax(0,1fr)", gap: "8px", padding: "3px 0" }),
      tooltipKey: css({ color: theme.colors.textMuted }),
      tooltipValue: css({ color: theme.colors.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
      overview: css({ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "end", gap: "16px", marginTop: "17px" }),
      progressHead: css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", color: theme.colors.textSecondary, fontSize: "12px" }),
      track: css({ height: "5px", marginTop: "8px", borderRadius: "999px", overflow: "hidden", background: theme.colors.bgControl }),
      fill: css({ height: "100%", background: theme.colors.primary }),
      counters: css({ display: "flex", gap: "16px", color: theme.colors.textMuted, fontSize: "11px", fontVariantNumeric: "tabular-nums" }),
      body: css({ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 2.15fr) minmax(300px, 1fr)" }),
      listPane: css({ minWidth: 0, display: "flex", flexDirection: "column", borderRight: `1px solid ${theme.colors.borderLight}` }),
      toolbar: css({ display: "flex", alignItems: "center", gap: "10px", padding: "14px 16px", borderBottom: `1px solid ${theme.colors.borderLight}`, background: theme.colors.bgNav }),
      searchWrap: css({ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "8px", minHeight: "36px", padding: "0 11px", border: `1px solid ${theme.colors.borderLight}`, borderRadius: "9px", background: theme.colors.bgControl, color: theme.colors.textMuted }),
      search: css({ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: theme.colors.textPrimary, fontSize: "12px" }),
      select: css({ minHeight: "36px", padding: "0 10px", border: `1px solid ${theme.colors.borderLight}`, borderRadius: "9px", background: theme.colors.bgControl, color: theme.colors.textSecondary, outline: "none", fontSize: "12px" }),
      list: css({ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px" }),
      row: ({ selected }) => css({
        display: "grid", gridTemplateColumns: "28px 48px minmax(0,1fr) auto", alignItems: "center", gap: "11px", minHeight: "66px", padding: "8px 10px", marginBottom: "4px",
        border: `1px solid ${selected ? theme.colors.primaryBorder : "transparent"}`, borderRadius: "11px", background: selected ? theme.colors.primarySoft : "transparent", cursor: "pointer",
        '&:hover': { background: selected ? theme.colors.primarySoft : theme.colors.bgFieldset },
      }),
      checkbox: css({ width: "17px", height: "17px", accentColor: theme.colors.primary, cursor: "pointer" }),
      cover: css({ width: "44px", height: "54px", objectFit: "cover", borderRadius: "8px", background: theme.colors.bgControl }),
      coverPlaceholder: css({ width: "44px", height: "54px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "8px", border: `1px solid ${theme.colors.borderLight}`, background: theme.colors.bgControl, color: theme.colors.textDim, '& svg': { width: "18px", height: "18px" } }),
      rowCopy: css({ minWidth: 0 }),
      desc: css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px", fontWeight: 600 }),
      meta: css({ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px", color: theme.colors.textMuted, fontSize: "10px" }),
      state: ({ tone }) => css({
        minHeight: "26px", display: "inline-flex", alignItems: "center", gap: "5px", padding: "0 8px", borderRadius: theme.borderRadius.full,
        border: `1px solid ${tone === "success" ? "#285F4B" : tone === "danger" ? "#6E323A" : tone === "warning" ? "#6A552B" : tone === "info" ? theme.colors.primaryBorder : theme.colors.borderLight}`,
        background: tone === "success" ? "#142B24" : tone === "danger" ? "#2B181C" : tone === "warning" ? "#2A2417" : tone === "info" ? theme.colors.primarySoft : theme.colors.bgControl,
        color: tone === "success" ? "#78D8AF" : tone === "danger" ? "#F09AA1" : tone === "warning" ? "#E7BE6A" : tone === "info" ? "#9AAEFF" : theme.colors.textSecondary,
        fontSize: "10px", whiteSpace: "nowrap",
      }),
      empty: css({ padding: "48px 20px", textAlign: "center", color: theme.colors.textMuted, fontSize: "12px" }),
      inspector: css({ minWidth: 0, overflowY: "auto", padding: "18px", background: theme.colors.bgBase }),
      inspectorEyebrow: css({ color: theme.colors.textMuted, fontSize: "10px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }),
      inspectorTitle: css({ margin: "8px 0 4px", fontSize: "15px", lineHeight: 1.45, fontWeight: 700, wordBreak: "break-word" }),
      inspectorMeta: css({ color: theme.colors.textMuted, fontSize: "11px" }),
      card: css({ marginTop: "16px", padding: "14px", border: `1px solid ${theme.colors.borderLight}`, borderRadius: "12px", background: theme.colors.bgFieldset }),
      cardHead: css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "10px" }),
      cardLabel: css({ color: theme.colors.textMuted, fontSize: "11px", fontWeight: 650 }),
      bigState: css({ display: "flex", alignItems: "center", gap: "8px", color: theme.colors.textPrimary, fontSize: "13px", fontWeight: 650 }),
      metrics: css({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "12px" }),
      metric: css({ padding: "9px 10px", borderRadius: "9px", background: theme.colors.bgControl }),
      metricLabel: css({ color: theme.colors.textMuted, fontSize: "10px" }),
      metricValue: css({ marginTop: "4px", color: theme.colors.textSecondary, fontSize: "12px", fontVariantNumeric: "tabular-nums" }),
      note: ({ tone = "info" }) => css({
        marginTop: "12px", padding: "10px 11px", borderLeft: `3px solid ${tone === "danger" ? theme.colors.danger : tone === "warning" ? theme.colors.warning : theme.colors.info}`,
        borderRadius: "7px", background: theme.colors.bgControl, color: theme.colors.textSecondary, fontSize: "11px", lineHeight: 1.65,
      }),
      actions: css({ display: "flex", flexDirection: "column", gap: "8px", marginTop: "14px" }),
      primary: css({ minHeight: "38px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", border: "none", borderRadius: "9px", background: theme.colors.primary, color: "#fff", fontSize: "12px", fontWeight: 680, cursor: "pointer" }),
      secondary: css({ minHeight: "36px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", border: `1px solid ${theme.colors.borderLight}`, borderRadius: "9px", background: theme.colors.bgControl, color: theme.colors.textSecondary, fontSize: "12px", fontWeight: 620, cursor: "pointer" }),
      dangerLink: css({ minHeight: "32px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "7px", border: "1px solid transparent", borderRadius: "8px", background: "transparent", color: theme.colors.textMuted, fontSize: "11px", cursor: "pointer", '&:hover': { color: theme.colors.danger, background: "#24161A" } }),
      footer: css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 16px", borderTop: `1px solid ${theme.colors.borderLight}`, color: theme.colors.textMuted, fontSize: "10px", background: theme.colors.bgNav }),
      footerActions: css({ display: "flex", gap: "8px" }),
      light: css({ minHeight: "30px", display: "inline-flex", alignItems: "center", gap: "6px", padding: "0 9px", border: `1px solid ${theme.colors.borderLight}`, borderRadius: "8px", background: theme.colors.bgControl, color: theme.colors.textSecondary, fontSize: "11px", cursor: "pointer" }),
    };

    const statusDescriptor = (item, runtimeItem) => {
      if (runtimeItem && runtimeItem.phase !== "waiting") {
        const phase = runtimeItem.phase;
        if (phase === "completed") return { label: "已完成", tone: "success", icon: "success" };
        if (phase === "submitted") return { label: "已提交", tone: "info", icon: "send" };
        if (["failed", "unavailable"].includes(phase)) return { label: phase === "unavailable" ? "作品不可用" : "下载失败", tone: "danger", icon: "error" };
        if (phase === "paused") return { label: "已暂停", tone: "warning", icon: "pause" };
        return { label: `${runtimeItem.status || "处理中"}${runtimeItem.percent > 0 && runtimeItem.percent < 100 ? ` ${Math.round(runtimeItem.percent)}%` : ""}`, tone: "info", icon: "download" };
      }
      if (item.downloaded) return { label: "已完成", tone: "success", icon: "success" };
      if (item.submitted) return { label: "已提交", tone: "info", icon: "send" };
      if (item.failed) return { label: item.failed.unavailable ? "作品不可用" : "下载失败", tone: "danger", icon: "error" };
      return { label: "等待中", tone: "neutral", icon: "info" };
    };

    const App = ({ profilePageHandler }) => {
      const { downloadManager, dataService } = profilePageHandler;
      const [snapshot, setSnapshot] = useState(() => downloadManager.getSnapshot());
      const [rawMediaList, setRawMediaList] = useState([]);
      const [searchText, setSearchText] = useState("");
      const [typeFilter, setTypeFilter] = useState("all");
      const [selectedTaskId, setSelectedTaskId] = useState("");

      const buildMediaList = useCallback(() => {
        const ids = new Set([
          ...downloadManager.getTaskSnapshotIds(),
          ...Object.keys(downloadManager.jobState?.failedItems || {}),
          ...(downloadManager.currentRun?.items || []).map((item) => item.awemeId),
        ]);
        for (const id of downloadManager.jobState?.knownIds || []) {
          if (dataService.feedMediaCache.has(id)) ids.add(id);
        }
        const runOrder = new Map((downloadManager.currentRun?.items || []).map((item, index) => [item.awemeId, Number(item.queueIndex || item.index || index + 1)]));
        return Array.from(ids).map((id) => {
          const failed = downloadManager.jobState?.failedItems?.[id];
          const cached = dataService.feedMediaCache.get(id);
          const snap = downloadManager.getTaskSnapshot(id);
          const media = cached || {
            awemeId: id,
            desc: snap?.desc || failed?.desc || "作品信息暂不可用",
            createTime: snap?.createTime || 0,
            images: snap?.type === "album" ? [{}] : [],
            video: snap?.type === "video" ? {} : null,
            cover: snap?.coverUrl ? { urlList: [snap.coverUrl] } : null,
          };
          return {
            awemeId: id,
            media,
            taskSnapshot: snap,
            downloaded: downloadManager.jobState?.downloadedIds?.includes(id) || false,
            submitted: downloadManager.jobState?.submittedItems?.[id],
            failed,
            selected: downloadManager.selectedIds.has(id),
            type: snap?.type || (media.images?.length ? "album" : "video"),
            queueIndex: runOrder.get(id) || snap?.queueIndex || 0,
          };
        }).sort((a, b) => (a.queueIndex || Number.MAX_SAFE_INTEGER) - (b.queueIndex || Number.MAX_SAFE_INTEGER) || (b.media.createTime || 0) - (a.media.createTime || 0));
      }, [downloadManager, dataService]);

      const refresh = useCallback(() => {
        const next = downloadManager.getSnapshot();
        setSnapshot(next);
        const list = buildMediaList();
        setRawMediaList(list);
        setSelectedTaskId((previous) => {
          if (previous && list.some((item) => item.awemeId === previous)) return previous;
          return next.run?.currentAwemeId || list.find((item) => item.selected)?.awemeId || list[0]?.awemeId || "";
        });
      }, [buildMediaList, downloadManager]);

      useEffect(() => {
        refresh();
        const progress = () => setSnapshot(downloadManager.getSnapshot());
        const a = downloadManager.on("stateChanged", refresh);
        const b = downloadManager.on("countsUpdated", refresh);
        const d = downloadManager.on("progressUpdated", progress);
        return () => { a(); b(); d(); };
      }, [refresh]);

      const run = snapshot.run;
      const runtimeMap = useMemo(() => new Map((run?.items || []).map((item) => [item.awemeId, item])), [run]);
      const filtered = useMemo(() => rawMediaList.filter((item) => {
        if (typeFilter !== "all" && item.type !== typeFilter) return false;
        const q = searchText.trim().toLowerCase();
        if (!q) return true;
        return (item.media.desc || "").toLowerCase().includes(q) || String(item.awemeId).toLowerCase().includes(q) || MediaHandler.toShortId(item.awemeId).toLowerCase().includes(q);
      }), [rawMediaList, typeFilter, searchText]);

      const selectedItem = rawMediaList.find((item) => item.awemeId === selectedTaskId) || rawMediaList.find((item) => item.awemeId === run?.currentAwemeId) || rawMediaList[0] || null;
      const selectedRuntime = selectedItem ? runtimeMap.get(selectedItem.awemeId) : null;
      const selectedStatus = selectedItem ? statusDescriptor(selectedItem, selectedRuntime) : null;
      const current = run?.current || null;
      const totalTasks = Number(run?.total || 0);
      const processed = Number(run?.processed || 0);
      const settledCount = Number(snapshot.counts.downloaded || 0) + Number(snapshot.counts.submitted || 0) + Number(snapshot.counts.failed || 0);
      const idleSelectedTotal = !snapshot.jobRunning && !snapshot.canResume && snapshot.counts.selected > 0 ? snapshot.counts.selected : 0;
      const effectiveTotal = totalTasks || run?.items?.length || idleSelectedTotal || settledCount || 0;
      const effectiveProcessed = totalTasks > 0 ? processed : snapshot.statusLabel === "已完成" ? settledCount : 0;
      const overallPercent = effectiveTotal > 0 ? Math.min(100, (effectiveProcessed / effectiveTotal) * 100) : 0;
      const resumeCapability = snapshot.resumeCapability || "none";
      const canStartSelected = !snapshot.jobRunning && !snapshot.canResume && snapshot.counts.selected > 0;
      const storage = snapshot.storage || {};
      const tooltipTask = current?.filename || selectedRuntime?.filename || selectedItem?.media?.desc || "等待任务";
      const tooltipMethod = DownloadFormat.method(current?.method || selectedRuntime?.method || storage.method);

      const handleStart = () => downloadManager.startJob().catch((e) => ToastCenter.update(`启动失败：${e?.message || e}`, 2800));
      const handlePause = () => downloadManager.stopJob();
      const handleResume = () => downloadManager.resumeJob().catch((e) => ToastCenter.update(e?.message || String(e), 2800));
      const handleRestartCurrent = async () => {
        const bytes = DownloadFormat.bytes(snapshot.resumeBytes || current?.loaded || 0);
        const ok = await ProductDialog.open({
          icon: "warning",
          title: "重新下载当前文件？",
          message: `此操作将清空当前文件中已经写入的 ${bytes}。`,
          detail: "已经完成的其它任务不会受到影响，队列顺序和保存目录保持不变。",
          primaryLabel: "重新下载当前文件",
          secondaryLabel: "保持暂停",
          danger: true,
        });
        if (ok) downloadManager.restartPausedCurrent().catch((e) => ToastCenter.update(`重新下载失败：${e?.message || e}`, 2800));
      };
      const handleCancel = async () => {
        const ok = await ProductDialog.open({ icon: "warning", title: "取消批量任务？", message: "当前任务和剩余队列将停止。", detail: "已经完成的文件不会被删除。", primaryLabel: "取消任务", secondaryLabel: "继续保留", danger: true });
        if (ok) downloadManager.cancelJob();
      };
      const handleReset = async () => {
        const ok = await ProductDialog.open({ icon: "warning", title: "重置任务状态？", message: "将清除当前作者的已完成、已提交和失败任务标记。", detail: "下载记录列表和已经保存到磁盘的文件不会被删除。", primaryLabel: "重置任务状态", secondaryLabel: "取消", danger: true });
        if (ok) { downloadManager.resetState(); refresh(); }
      };
      const openHistory = () => profilePageHandler.mediaHandler.open_config_modal("history");
      const handleFailureDetail = async (item) => {
        const f = item?.failed;
        if (!f) return;
        await ProductDialog.open({
          icon: f.unavailable ? "warning" : "error",
          title: f.unavailable ? "作品当前无法访问" : "下载未完成",
          message: f.message || f.reason || "未知错误",
          detail: [f.httpStatus ? `HTTP ${f.httpStatus}` : "", f.loaded ? `已下载 ${DownloadFormat.bytes(f.loaded)}${f.total ? ` / ${DownloadFormat.bytes(f.total)}` : ""}` : "", `自动尝试 ${Math.max(0, Number(f.count || 1) - 1)} 次`].filter(Boolean).join(" · "),
          primaryLabel: "知道了",
          hideSecondary: true,
        });
      };
      const handleRemove = async (id) => {
        const ok = await ProductDialog.open({ icon: "warning", title: "移除失败记录？", message: "只会从任务列表移除记录，不会删除磁盘文件。", primaryLabel: "移除记录", secondaryLabel: "取消", danger: true });
        if (ok) downloadManager.removeFailed(id);
      };

      const resumePrimary = ["supported", "queue_ready"].includes(resumeCapability) ? { label: "继续下载", icon: "play", action: handleResume }
        : ["unsupported", "invalid_range"].includes(resumeCapability) ? { label: "重新下载当前文件", icon: "downloadCloud", action: handleRestartCurrent }
        : resumeCapability === "network_unavailable" ? { label: "重新检查", icon: "retry", action: handleResume }
        : { label: "检查并继续", icon: "play", action: handleResume };

      return html`
        <div class=${c.app}>
          <header class=${c.header}>
            <div class=${c.headerTop}>
              <div class=${c.titleGroup}>
                <span class=${c.titleIcon}>${icon("package")}</span>
                <div><h2 class=${c.title}>批量下载</h2><div class=${c.subtitle}>${snapshot.profileName || "当前作者"} · ${effectiveTotal || snapshot.counts.selected || 0} 个任务</div></div>
              </div>
              <span class=${c.statusWrap}>
                <button type="button" class=${c.statusTag} aria-label="查看当前任务状态详情">
                  ${icon(snapshot.jobRunning ? "download" : snapshot.canResume ? "pause" : snapshot.statusLabel === "已完成" ? "success" : "info")}<span>${snapshot.statusLabel}</span>
                </button>
                <div class=${c.statusTooltip} data-role="status-tip" role="tooltip">
                  <div class=${c.tooltipTitle}>${snapshot.jobRunning ? "当前正在执行批量下载" : snapshot.canResume ? "批量任务已暂停" : snapshot.statusLabel === "已完成" ? "本批任务已完成" : "批量任务待命"}</div>
                  <div class=${c.tooltipRow}><span class=${c.tooltipKey}>任务进度</span><span class=${c.tooltipValue}>${effectiveProcessed} / ${effectiveTotal || 0}</span></div>
                  <div class=${c.tooltipRow}><span class=${c.tooltipKey}>当前作品</span><span class=${c.tooltipValue} title=${tooltipTask}>${tooltipTask}</span></div>
                  <div class=${c.tooltipRow}><span class=${c.tooltipKey}>下载方式</span><span class=${c.tooltipValue}>${tooltipMethod}</span></div>
                  <div class=${c.tooltipRow}><span class=${c.tooltipKey}>保存位置</span><span class=${c.tooltipValue} title=${storage.location || ""}>${storage.location || "尚未选择"}</span></div>
                  <div class=${c.tooltipRow}><span class=${c.tooltipKey}>说明</span><span class=${c.tooltipValue} title=${storage.detail || ""}>${storage.detail || "状态由真实下载事件更新"}</span></div>
                </div>
              </span>
            </div>
            <div class=${c.overview}>
              <div>
                <div class=${c.progressHead}><span>总进度</span><strong>${effectiveProcessed} / ${effectiveTotal || 0}</strong></div>
                <div class=${c.track}><div class=${c.fill} style=${{ width: `${overallPercent}%` }}></div></div>
              </div>
              <div class=${c.counters}><span>完成 ${snapshot.counts.downloaded}</span><span>已提交 ${snapshot.counts.submitted}</span><span>失败 ${snapshot.counts.failed}</span></div>
            </div>
          </header>

          <main class=${c.body}>
            <section class=${c.listPane}>
              <div class=${c.toolbar}>
                <label class=${c.searchWrap}>${icon("search")}<input class=${c.search} value=${searchText} onInput=${(e) => setSearchText(e.target.value)} placeholder="搜索作品或 ID" /></label>
                <select class=${c.select} value=${typeFilter} onChange=${(e) => setTypeFilter(e.target.value)}><option value="all">全部类型</option><option value="video">视频</option><option value="album">图集</option></select>
              </div>
              <div class=${c.list}>
                ${filtered.map((item) => {
                  const runtime = runtimeMap.get(item.awemeId);
                  const state = statusDescriptor(item, runtime);
                  const cover = item.taskSnapshot?.coverUrl || dataService.resolvePreviewUrl(item.media) || "";
                  const selected = item.awemeId === selectedTaskId;
                  return html`<div class=${c.row({ selected })} onClick=${() => setSelectedTaskId(item.awemeId)} key=${item.awemeId}>
                    <input type="checkbox" class=${c.checkbox} checked=${item.selected} onClick=${(e) => e.stopPropagation()} onChange=${(e) => { const checked = e.target.checked; downloadManager.markSelect(item.awemeId, checked); if (checked) setSelectedTaskId(item.awemeId); }} />
                    ${cover ? html`<img class=${c.cover} src=${cover} loading="lazy" alt="作品预览" onError=${(e) => { e.currentTarget.style.display = "none"; e.currentTarget.nextElementSibling && (e.currentTarget.nextElementSibling.style.display = "inline-flex"); }} /><span class=${c.coverPlaceholder} style=${{ display: "none" }}>${icon("image")}</span>` : html`<span class=${c.coverPlaceholder}>${icon("image")}</span>`}
                    <div class=${c.rowCopy}><div class=${c.desc} title=${item.media.desc || ""}>${item.media.desc || "作品信息暂不可用"}</div><div class=${c.meta}><span>${item.type === "album" ? "图集" : "视频"}</span><span>ID ${MediaHandler.toShortId(item.awemeId)}</span></div></div>
                    <span class=${c.state({ tone: state.tone })}>${icon(state.icon)}<span>${state.label}</span></span>
                  </div>`;
                })}
                ${filtered.length === 0 ? html`<div class=${c.empty}>${rawMediaList.length ? "没有匹配的任务" : "暂无任务。请在作者主页选择作品后开始下载。"}</div>` : null}
              </div>
            </section>

            <aside class=${c.inspector}>
              <div class=${c.inspectorEyebrow}>任务检查器</div>
              ${selectedItem ? html`
                <h3 class=${c.inspectorTitle}>${selectedItem.media.desc || "作品信息暂不可用"}</h3>
                <div class=${c.inspectorMeta}>${selectedItem.type === "album" ? "图集" : "视频"} · ID ${MediaHandler.toShortId(selectedItem.awemeId)}</div>

                <section class=${c.card}>
                  <div class=${c.cardHead}><span class=${c.cardLabel}>当前状态</span><span class=${c.state({ tone: selectedStatus.tone })}>${icon(selectedStatus.icon)}<span>${selectedStatus.label}</span></span></div>
                  <div class=${c.bigState}>${icon(selectedStatus.icon)}<span>${selectedRuntime?.status || selectedStatus.label}</span></div>
                  ${selectedRuntime?.total > 0 ? html`<div class=${c.track}><div class=${c.fill} style=${{ width: `${Math.max(0, Math.min(100, selectedRuntime.percent || 0))}%` }}></div></div>` : null}
                  <div class=${c.metrics}>
                    <div class=${c.metric}><div class=${c.metricLabel}>已下载</div><div class=${c.metricValue}>${DownloadFormat.bytes(selectedRuntime?.loaded || selectedItem.failed?.loaded || 0)}${selectedRuntime?.total || selectedItem.failed?.total ? ` / ${DownloadFormat.bytes(selectedRuntime?.total || selectedItem.failed?.total || 0)}` : ""}</div></div>
                    <div class=${c.metric}><div class=${c.metricLabel}>下载方式</div><div class=${c.metricValue}>${DownloadFormat.method(selectedRuntime?.method || selectedItem.submitted?.method || current?.method)}</div></div>
                  </div>
                </section>

                ${snapshot.canResume && selectedItem.awemeId === run?.currentAwemeId ? html`
                  <div class=${c.note({ tone: ["unsupported", "invalid_range"].includes(resumeCapability) ? "warning" : "info" })}>
                    ${resumeCapability === "queue_ready" ? "队列已在两个文件之间安全暂停，可直接从下一项继续。" : resumeCapability === "unknown" ? `已保留 ${DownloadFormat.bytes(snapshot.resumeBytes)}，尚未检查服务器是否支持安全续传。` : resumeCapability === "supported" ? "服务器已确认支持断点续传。" : resumeCapability === "network_unavailable" ? "续传检查因网络或超时未完成，部分文件仍被保留。" : "服务器无法提供有效断点数据。重新下载只会清空当前文件，不影响已完成任务。"}
                  </div>
                  <div class=${c.actions}><button class=${c.primary} onClick=${resumePrimary.action}>${icon(resumePrimary.icon)}<span>${resumePrimary.label}</span></button>${snapshot.resumeBytes > 0 && !["unsupported", "invalid_range"].includes(resumeCapability) ? html`<button class=${c.secondary} onClick=${handleRestartCurrent}>${icon("downloadCloud")}<span>重新下载当前文件</span></button>` : null}<button class=${c.dangerLink} onClick=${handleCancel}>${icon("cancel")}<span>取消批量任务</span></button></div>
                ` : snapshot.jobRunning && selectedItem.awemeId === run?.currentAwemeId ? html`<div class=${c.actions}><button class=${c.secondary} onClick=${handlePause}>${icon("pause")}<span>暂停下载</span></button></div>` : selectedItem.failed ? html`
                  <div class=${c.note({ tone: selectedItem.failed.unavailable ? "warning" : "danger" })}>${selectedItem.failed.message || selectedItem.failed.reason || "下载未完成"}</div>
                  <div class=${c.actions}><button class=${c.primary} onClick=${() => downloadManager.retryFailed([selectedItem.awemeId]).catch((e) => ToastCenter.update(`重试失败：${e?.message || e}`, 2600))}>${icon(selectedItem.failed.unavailable ? "retry" : "downloadCloud")}<span>${selectedItem.failed.unavailable ? "重新检测并下载" : "重新下载"}</span></button><button class=${c.secondary} onClick=${() => handleFailureDetail(selectedItem)}>${icon("info")}<span>查看原因</span></button><button class=${c.dangerLink} onClick=${() => handleRemove(selectedItem.awemeId)}>${icon("cancel")}<span>移除失败记录</span></button></div>
                ` : canStartSelected ? html`<div class=${c.actions}><button class=${c.primary} onClick=${handleStart}>${icon("download")}<span>开始下载已选 ${snapshot.counts.selected} 项</span></button></div>` : null}
              ` : canStartSelected ? html`<div class=${c.actions}><button class=${c.primary} onClick=${handleStart}>${icon("download")}<span>开始下载已选 ${snapshot.counts.selected} 项</span></button></div>` : html`<div class=${c.empty}>选择左侧任务以查看详情和可用操作。</div>`}
            </aside>
          </main>

          <footer class=${c.footer}>
            <span>Chrome 会先选择保存目录；aria2 显示真实进度；ABDM 仅能确认任务已提交。</span>
            <div class=${c.footerActions}><button class=${c.light} onClick=${openHistory}>${icon("history")}<span>下载记录</span></button><button class=${c.light} onClick=${() => profilePageHandler.mediaHandler.open_config_modal()}>${icon("settings")}<span>设置</span></button><button class=${c.light} onClick=${handleReset}>${icon("retry")}<span>重置任务状态</span></button><button class=${c.light} onClick=${() => profilePageHandler.taskModal?.close()}>${icon("chevronDown")}<span>最小化</span></button></div>
          </footer>
        </div>`;
    };

    return { App };
  })();

  class ProfilePageHandler {
    /** @type {MediaHandler} */
    mediaHandler;
    /** @type {ProfileDataService} */
    dataService;
    /** @type {ProfileDownloadManager} */
    downloadManager;

    /**
     * @param {{ mediaHandler: MediaHandler }} options
     */
    constructor(options) {
      this.mediaHandler = options.mediaHandler;
      this.dataService = new ProfileDataService();
      this.downloadManager = new ProfileDownloadManager({
        mediaHandler: this.mediaHandler,
        dataService: this.dataService,
      });
      this.floating_ui = new FloatingPanel({
        mediaHandler: this.mediaHandler,
        profilePageHandler: this,
      });

      // V1.0.4：胶囊点击后可随时重新打开同一个批量任务管理器。
      UnifiedTaskCenter.attachManagerOpener(() =>
        this.open_job_modal()
      );
    }

    mount_ui() {
      if (!this.dataService.isProfilePage()) {
        return;
      }
      this.floating_ui.mount();

      this.downloadManager._ensureJobState();
    }

    /**
     * 用于展示进度以及提供控制
     */
    open_job_modal() {
      this.downloadManager._ensureJobState();

      // 单实例：旧管理器仍存在时直接恢复显示，不重复订阅事件。
      if (
        this.taskModal &&
        !this.taskModal.closed &&
        this.taskModal.overlay?.isConnected
      ) {
        this.taskModal.overlay.style.display = "flex";
        this.taskModal.root?.focus?.();
        UnifiedTaskCenter.setManagerVisible(true);
        return this.taskModal;
      }

      // 清理已关闭或失效的旧引用。
      if (this.taskModal?.overlay?.isConnected) {
        try {
          this.taskModal.close();
        } catch {}
      }
      this.taskModal = null;

      try {
        if (
          !getHtmPreact().render ||
          !getHtmPreact().html
        ) {
          throw new Error(
            "Preact 组件未加载，无法显示批量下载管理器"
          );
        }

        const modal = new Modal((root, overlay) => {
          overlay.style.zIndex = "999999";
          root.style.padding = "0";
          root.style.overflow = "hidden";
          root.style.background = "transparent";
          root.style.borderRadius = "12px";
          root.setAttribute("tabindex", "-1");

          const { html, render } = getHtmPreact();

          render(
            html`<${ProfileJobModalComponents.App}
              profilePageHandler=${this}
            />`,
            root
          );
        });

        const originalClose = modal.close.bind(modal);
        modal.close = () => {
          if (modal.closed) return;
          originalClose();
          if (this.taskModal === modal) {
            this.taskModal = null;
          }
          UnifiedTaskCenter.setManagerVisible(false);

          // 关闭的是界面，不是下载任务。
          // 批量任务仍在运行时保留胶囊。
          if (this.downloadManager.jobRunning) {
            UnifiedTaskCenter.minimize();
          }
        };

        this.taskModal = modal;
        UnifiedTaskCenter.setManagerVisible(true);
        return modal;
      } catch (error) {
        console.error(
          "[dy-dl]打开批量下载管理器失败：",
          error
        );

        createToast(null).update(
          `管理器打开失败：${
            error?.message || error
          }`,
          3000
        );

        UnifiedTaskCenter.update(
          {
            batch: true,
            phase: "failed",
            status: `管理器打开失败：${
              error?.message || error
            }`,
            filename: "批量下载管理器",
          },
          true
        );

        return null;
      }
    }

  }
  // #endregion

  // #region DOM Patcher
  class DOMPatcher {
    /** @type {Downloader} */
    downloader;
    /** @type {MediaHandler} */
    mediaHandler;
    /** @type {DanmakuHandler} */
    danmakuHandler;
    /** @type {ProfilePageHandler} */
    profilePageHandler;
    /** @type {MutationObserver} */
    observer;

    feed_card_selector_cls = "dy-dl-feed-selector";

    /**
     * @param {{downloader: Downloader, mediaHandler: MediaHandler, danmakuHandler: DanmakuHandler, profilePageHandler: ProfilePageHandler}} options
     */
    constructor(options) {
      const {
        downloader,
        mediaHandler,
        danmakuHandler,
        profilePageHandler,
      } = options;
      this.downloader = downloader;
      this.mediaHandler = mediaHandler;
      this.danmakuHandler = danmakuHandler;
      this.profilePageHandler = profilePageHandler;
      this.observer = new MutationObserver(this._handleMutations.bind(this));

      // V1.0.0：MutationObserver 只收集节点，普通任务分批处理。
      this.pendingRoots = new Set();
      this.flushTimer = null;
      this.profileDirty = false;
      this.visibilityDirty = false;

      Config.global.events.on(
        "config_change",
        this._on_config_change.bind(this)
      );
    }

    /**
     *
     * @param node {HTMLElement}
     * @returns {HTMLImageElement | null}
     */
    static findImage(node) {
      let img;
      let current = node;
      while (current) {
        img = current.querySelector("img");
        if (img) return img;
        current =
          current.parentNode instanceof HTMLElement ? current.parentNode : null;
      }
      return null;
    }

    /**
     *
     * @param html {string}
     * @returns {HTMLElement}
     */
    static render_html(html) {
      const div = document.createElement("div");
      div.innerHTML = html.trim();
      return /** @type {HTMLElement} */ (div.children[0]);
    }

    _on_config_change() {
      this._sync_feed_cards();
    }

    _sync_feed_cards() {
      const feed_cards = document.body.querySelectorAll(
        ProfileDataService.FEED_CARD_SELECTOR
      );
      for (const feed_card of feed_cards) {
        this._handleProfileCard(feed_card);
      }
    }

    /**
     * MutationObserver 回调：只收集 Element，不做 querySelectorAll 展开扫描。
     * @param {MutationRecord[]} mutations
     */
    _handleMutations(mutations) {
      let hasDomChange = false;

      for (const mutation of mutations) {
        if (mutation.addedNodes?.length || mutation.removedNodes?.length) {
          hasDomChange = true;
        }

        for (const node of mutation.addedNodes || []) {
          if (!(node instanceof HTMLElement)) continue;

          this._enqueueRoot(node);

          // class/tag 级轻判断，不在 Observer 回调中搜索整个子树。
          if (
            node.matches?.(ProfileDataService.FEED_CARD_SELECTOR) ||
            node.localName === "li"
          ) {
            this.profileDirty = true;
          }
        }
      }

      if (hasDomChange) {
        // sliderVideo 显隐在新增/删除时都需要同步。
        this.visibilityDirty = true;
        this._scheduleFlush();
      }
    }

    _enqueueRoot(root) {
      if (!(root instanceof HTMLElement)) return;

      // 祖先已排队则不保存子节点。
      for (const existing of this.pendingRoots) {
        if (existing === root || existing.contains(root)) return;
      }

      // 新 root 是祖先时，删除已排队后代。
      for (const existing of Array.from(this.pendingRoots)) {
        if (root.contains(existing)) this.pendingRoots.delete(existing);
      }

      this.pendingRoots.add(root);

      // 软上限，避免抖音虚拟列表瞬间插入大量节点时长期持有 DOM 引用。
      while (this.pendingRoots.size > 96) {
        const first = this.pendingRoots.values().next().value;
        if (!first) break;
        this.pendingRoots.delete(first);
      }

      this._scheduleFlush();
    }

    _scheduleFlush() {
      if (this.flushTimer) return;
      this.flushTimer = setTimeout(() => this._flushQueue(), 28);
    }

    _flushQueue() {
      this.flushTimer = null;

      // 抖音是单页应用：站内进入或离开作者主页时不会重新加载脚本。
      // 每批 DOM 变更只做一次轻量路由同步，确保面板及时挂载/隐藏。
      if (this.profilePageHandler.dataService.isProfilePage()) {
        this.profilePageHandler.mount_ui();
      } else {
        this.profilePageHandler.floating_ui.syncVisibility();
      }

      const roots = [];
      for (const root of this.pendingRoots) {
        roots.push(root);
        if (roots.length >= 24) break;
      }

      for (const root of roots) {
        this.pendingRoots.delete(root);
        this._processAddedRoot(root);
      }

      if (this.profileDirty) {
        this.profileDirty = false;
        this.profilePageHandler.downloadManager.collect();
      }

      if (this.visibilityDirty) {
        this.visibilityDirty = false;
        this.profilePageHandler.floating_ui.syncVisibility();
      }

      if (this.pendingRoots.size) this._scheduleFlush();
    }

    _processAddedRoot(elementNode) {
      if (!(elementNode instanceof HTMLElement) || !elementNode.isConnected) {
        return;
      }

      // Tooltip for emoticons
      if (elementNode.classList.contains("semi-portal")) {
        const tooltipNode = elementNode.querySelector(".semi-tooltip-wrapper");
        if (tooltipNode) {
          setTimeout(() => {
            this._handleTooltip(/** @type {HTMLElement} */ (tooltipNode));
          }, 0);
        }
      }

      // 图片查看 Modal
      if (
        elementNode.parentElement === document.body &&
        elementNode.classList.length === 0
      ) {
        setTimeout(() => this._handleModal(elementNode), 0);
      }

      // 播放器插件入口；同时刷新一次 player/current_media。
      if (
        elementNode.localName === "xg-controls" ||
        elementNode.querySelector("xg-controls")
      ) {
        this.mediaHandler.refresh_player();
        this._handleXgControl(elementNode);
      }

      // 作者主页卡片
      if (elementNode.matches(ProfileDataService.FEED_CARD_SELECTOR)) {
        this._handleProfileCard(elementNode);
        this.profileDirty = true;
      }

      if (elementNode.localName === "li" || elementNode.children.length) {
        const feedCards = elementNode.querySelectorAll(
          ProfileDataService.FEED_CARD_SELECTOR
        );
        if (feedCards.length) {
          feedCards.forEach((dom) => this._handleProfileCard(dom));
          this.profileDirty = true;
        }
      }
    }

    /**
     * @param {HTMLElement} modalNode
     */
    _handleModal(modalNode) {
      const close_icon = modalNode.querySelector("#svg_icon_ic_close");
      const img = modalNode.querySelector("img");
      const container =
        img?.closest('div[style*="transform: scale(1)"] > div') ||
        img?.parentElement;

      if (!close_icon || !img || !container) return;
      if (container.querySelector(".dy-dl-modal-btn")) return;

      const downloadButton = document.createElement("div");
      downloadButton.textContent = "下载图片";
      downloadButton.className = "LV01TNDE dy-dl-modal-btn dy-dl-native-lite-btn";
      downloadButton.addEventListener("click", (e) => {
        e.stopPropagation();
        const imgSrc = img.src;
        this.downloader.download_file(imgSrc, "douyin_image", [], {
          fileKind: "image",
        });
      });
      container.appendChild(downloadButton);
    }

    /**
     * @param {HTMLElement} tooltipNode
     */
    _handleTooltip(tooltipNode) {
      const tooltipContent = tooltipNode.querySelector(".semi-tooltip-content");
      if (!tooltipContent) return;

      if (!tooltipContent.textContent?.includes("添加到表情")) return;

      const imgNode = DOMPatcher.findImage(tooltipNode);
      if (!imgNode?.src) return;

      if (tooltipContent.querySelector(".download-button")) return;

      const downloadButton = document.createElement("div");
      downloadButton.textContent = "下载表情包";
      downloadButton.className =
        "LV01TNDE download-button dy-dl-tooltip-download";

      downloadButton.addEventListener("click", (e) => {
        e.stopPropagation();
        const imgSrc = imgNode.src;
        this.downloader.download_file(imgSrc, "douyin_emoticon", [], {
          fileKind: "image",
        });
      });

      tooltipContent.appendChild(downloadButton);
    }

    /**
     * @param {HTMLElement} xg_control_node
     */
    _handleXgControl(xg_control_node) {
      this.mediaHandler.refresh_player();
      const right_grid = xg_control_node.querySelector(".xg-right-grid");
      if (!right_grid) return;
      if (right_grid.querySelector(".dy-dl-video-btn")) return;

      const btn = new TooltipsButton(
        "插件",
        [
          {
            html: `<div class="xgTips item"><span>快捷键：</span><span class="shortcutKey">M</span>`,
          },
          {
            label: "需求/反馈",
            callback: () => {
              // V1.0.1：不再跳转外部网页，改为脚本内信息面板。
              AboutPanel.open();
            },
          },
          {
            label: "设置",
            callback: () => {
              this.mediaHandler.open_config_modal();
            },
          },
          {
            label: "媒体详情",
            callback: () => {
              this.mediaHandler.show_media_details();
            },
          },
          {
            label: "提取原声",
            callback: () => {
              this.mediaHandler.extract_original_audio();
            },
          },
          {
            label: "下载弹幕",
            callback: () => {
              this.mediaHandler.refresh_player();
              if (!this.mediaHandler.player) {
                ToastCenter.update("暂未读取到播放器，请先播放视频后再导出弹幕", 2400);
                return;
              }
              if (!this.mediaHandler.current_media) {
                ToastCenter.update("暂未读取到当前作品，请等待页面加载后再试", 2400);
                return;
              }
              const content = this.danmakuHandler.getDanmakuAssFileContent(
                this.mediaHandler.player
              );
              if (!content) return;
              const filename = this.mediaHandler._build_filename(
                this.mediaHandler.current_media
              );
              const blob = new Blob([content], { type: "text/plain" });
              this.downloader.download_blob(blob, `${filename}.ass`);
            },
          },
          {
            label: "下载",
            callback: () => {
              this.mediaHandler.download_current_media();
            },
          },
        ],
        (e) => {}
      );
      const downloadButton = btn.render();

      const qualitySwitch = right_grid.querySelector(
        ".xgplayer-quality-setting"
      );
      const volumeControl = right_grid.querySelector(".xgplayer-volume");
      if (qualitySwitch) {
        right_grid.insertBefore(downloadButton, qualitySwitch);
      } else if (volumeControl) {
        right_grid.insertBefore(downloadButton, volumeControl);
      } else {
        right_grid.appendChild(downloadButton);
      }
    }

    /**
     *
     * @param {HTMLElement} card
     */
    _handleProfileCard(card) {
      const dom = card.querySelector("." + this.feed_card_selector_cls);
      if (!Config.global.features.enable_profile_downloader) {
        // remove
        dom?.remove();
        return;
      } else if (dom) {
        // pass 已经有了跳过
        return;
      }
      // add
      const media = this.profilePageHandler.dataService._extractFeedMedia(card);
      const { awemeId } = media || {};
      if (!awemeId) {
        // 跳过
        return;
      }

      // 优先寻找网站本来就有的 relative 宿主，不修改卡片 position。
      const relativeHost =
        card.classList.contains("relative")
          ? card
          : card.querySelector(":scope > .relative, :scope > a.relative");

      const badge = document.createElement("label");
      badge.className = this.feed_card_selector_cls;
      badge.dataset.placement = relativeHost ? "overlay" : "inline";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "dy-dl-feed-checkbox";
      checkbox.checked =
        this.profilePageHandler.downloadManager._isFeedSelected(awemeId);

      const label = document.createElement("span");
      label.className = "dy-dl-feed-select-label";
      label.textContent = "选择";

      const stopCardJump = (event) => {
        event.stopPropagation();
      };

      ["click", "mousedown", "mouseup", "touchstart"].forEach((eventName) => {
        badge.addEventListener(eventName, stopCardJump);
      });

      checkbox.addEventListener("change", (event) => {
        event.stopPropagation();
        this.profilePageHandler.downloadManager.markSelect(
          awemeId,
          checkbox.checked
        );
      });

      badge.append(checkbox, label);
      if (relativeHost) relativeHost.appendChild(badge);
      else card.insertAdjacentElement("afterbegin", badge);

      const off = this.profilePageHandler.downloadManager.on(
        "countsUpdated",
        () => {
          if (!badge.parentElement) {
            off();
            return;
          }
          checkbox.checked =
            this.profilePageHandler.downloadManager._isFeedSelected(awemeId);
        }
      );
    }

    startObserving() {
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      // 初始只扫描明确目标；后续全部走增量队列。
      this.mediaHandler.refresh_player();

      document
        .querySelectorAll("xg-controls")
        .forEach((controls) =>
          this._handleXgControl(/** @type {HTMLElement} */ (controls))
        );

      if (Config.global.features.enable_profile_downloader) {
        this._sync_feed_cards();
        this.profilePageHandler.downloadManager.collect();
      }

      this.profilePageHandler.floating_ui.syncVisibility();
    }
  }
  // #endregion

  // #region HotkeyManager
  class HotkeyManager {
    constructor() {}
    /**
     * @param {string} key
     * @param {Function} fn
     */
    addHotkey(key, fn) {
      const callback = (ev) => {
        if (ev.key.toLowerCase() !== key.toLowerCase()) return;
        if (
          ev.defaultPrevented ||
          ev.repeat ||
          ev.isComposing ||
          ev.ctrlKey ||
          ev.metaKey ||
          ev.altKey
        ) {
          return;
        }

        if (document.querySelector('[role="dialog"]')) return;

        const activeElement = /** @type {HTMLElement} */ (
          document.activeElement
        );
        if (activeElement) {
          // Check if activeElement is not null
          const tagName = activeElement.tagName;
          const isInputElement =
            tagName === "INPUT" ||
            tagName === "TEXTAREA" ||
            tagName === "SELECT" ||
            tagName === "BUTTON" ||
            activeElement.isContentEditable;
          if (isInputElement) return;

          // 脚本弹窗打开时，M 键应服务于当前界面，不能在后台误触下载。
          if (
            activeElement.closest?.(
              '[role="dialog"], .dy-dl-modal-overlay-v1, .dy-dl-product-dialog-overlay-v106'
            )
          ) {
            return;
          }
        }

        ev.preventDefault();
        fn();
      };
      document.addEventListener("keydown", callback);
      const dispose = () => document.removeEventListener("keydown", callback);
      return { dispose };
    }
  }
  // #endregion

    /**
   * 将毫秒时间戳转换为 ASS 格式的时间字符串 (H:MM:SS.ss)
   */
  function msToAssTime(ms) {
    if (ms < 0) ms = 0;
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const centiseconds = Math.round((ms % 1000) / 10);
    const pad = (num, length = 2) => num.toString().padStart(length, "0");
    return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`;
  }

  /**
   * 将 HEX 颜色 (#RRGGBB) 转换为 ASS 格式的颜色字符串 (&HBBGGRR&)
   */
  function hexToAssColor(hex) {
    if (!hex || !hex.startsWith("#")) return "&H00FFFFFF";
    const r = hex.substring(1, 3);
    const g = hex.substring(3, 5);
    const b = hex.substring(5, 7);
    return `&H${b}${g}${r}&`;
  }

  // #region 弹幕相关
  /**
   * 弹幕相关
   */
  class DanmakuHandler {
    /**
     * 将弹幕 JSON 数据转换为 ASS 文件，优化视觉表现
     * @param {Array<Object>} danmakuData - 弹幕数据数组
     * @param {Object} [options] - 可选配置项
     * @param {string} [options.title="Danmaku"] - ASS 文件标题
     * @param {number} [options.playResX=1920] - 视频宽度
     * @param {number} [options.playResY=1080] - 视频高度
     * @param {string} [options.font="Microsoft YaHei"] - 默认字体
     * @param {number} [options.baseFontSize=20] - JSON中的基准字号，用于布局计算
     * @param {number} [options.fontSizeMultiplier=2.5] - 字体大小缩放倍率，将JSON中的字号放大
     * @param {number} [options.lineHeightRatio=1.2] - 行高与字号的比例，用于计算轨道高度
     * @param {number} [options.topMargin=10] - 弹幕区域距离屏幕顶部的边距
     * @param {number} [options.maxTracks=15] - 最大轨道数
     * @returns {string} - 生成的 ASS 文件内容字符串
     */
    convertDanmakuToAss(danmakuData, options = {}) {
      // --- 1. 设置默认配置 ---
      const config = {
        title: "Danmaku",
        playResX: 1920,
        playResY: 1080,
        font: "Microsoft YaHei",
        baseFontSize: 20, // 假设JSON中大部分字体大小是20px
        fontSizeMultiplier: 2.5, // 将20px放大到50，在1080p下是合适的尺寸
        lineHeightRatio: 1.2, // 1.2倍行高，间距更紧凑
        topMargin: 10,
        maxTracks: 15,
        ...options,
      };

      // --- 2. 动态计算布局参数 ---
      // 计算用于布局的基准字体大小和轨道高度
      const layoutFontSize = config.baseFontSize * config.fontSizeMultiplier;
      const trackHeight = layoutFontSize * config.lineHeightRatio;

      // --- 3. 构建 ASS 文件头部 ---
      const header = `[Script Info]
; Script generated by JavaScript Danmaku Converter V3
Title: ${config.title}
ScriptType: v4.00+
PlayResX: ${config.playResX}
PlayResY: ${config.playResY}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${config.font},${layoutFontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

      // --- 4. 轨道管理与弹幕生成 ---
      const tracks = new Array(config.maxTracks).fill(0);
      const sortedData = [...danmakuData].sort((a, b) => a.start - b.start);

      const events = sortedData
        .map((dm) => {
          if (!dm.start || !dm.text || !dm.duration || !dm.style) {
            return null;
          }

          // 计算这条弹幕实际渲染的字体大小
          const actualFontSize =
            (parseInt(dm.style.fontSize) || config.baseFontSize) *
            config.fontSizeMultiplier;

          // 估算弹幕文本的像素宽度（使用0.6作为中文字符宽高比的近似值）
          const textWidth = dm.text.length * actualFontSize * 0.6;

          const speed = (config.playResX + textWidth) / dm.duration;
          if (speed <= 0) return null;

          const timeToClearRightEdge = textWidth / speed;

          let trackIndex = -1;
          for (let i = 0; i < config.maxTracks; i++) {
            if (tracks[i] <= dm.start) {
              trackIndex = i;
              break;
            }
          }
          if (trackIndex === -1) {
            let earliestFreeTime = Infinity;
            for (let i = 0; i < config.maxTracks; i++) {
              if (tracks[i] < earliestFreeTime) {
                earliestFreeTime = tracks[i];
                trackIndex = i;
              }
            }
          }

          tracks[trackIndex] = dm.start + timeToClearRightEdge;

          // 计算正确的Y坐标
          // yPos应该是文本的垂直中心点在其轨道内的位置
          // 轨道中心点 = 顶部边距 + 已占用的轨道高度 + 当前轨道高度的一半
          const yPos =
            config.topMargin + trackIndex * trackHeight + trackHeight / 2;

          const startTime = msToAssTime(dm.start);
          const endTime = msToAssTime(dm.start + dm.duration);
          const assColor = hexToAssColor(dm.style.color);

          const startX = config.playResX + textWidth / 2;
          const endX = -textWidth / 2;

          const assText = `{\\move(${startX}, ${yPos}, ${endX}, ${yPos})}{\\c${assColor}\\fs${actualFontSize}}${dm.text}`;

          return `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${assText}`;
        })
        .filter(Boolean)
        .join("\n");

      return header + events;
    }

    /**
     *
     * @param {import("./types").DouyinPlayer.PlayerInstance} player
     */
    getDanmakuList(player) {
      // 当前只能读取播放器已经加载的弹幕；长视频尚未加载的后续弹幕不会被导出。

      return player?.danmaku?.main?.data || [];
    }

    /**
     * 获取视频宽高
     *
     * NOTE： 这里主要是获取比例
     *
     * @param {import("./types").DouyinPlayer.PlayerInstance} player
     */
    getMediaSize(player) {
      const width = Number(
        player?.sizeInfo?.width || player?.video?.videoWidth || 1920
      );
      const height = Number(
        player?.sizeInfo?.height || player?.video?.videoHeight || 1080
      );
      return { width, height };
    }

    /**
     * 获取弹幕 ass 文件
     *
     * @param {import("./types").DouyinPlayer.PlayerInstance} player
     */
    getDanmakuAssFileContent(player) {
      const list = this.getDanmakuList(player);
      if (!list || list.length === 0) {
        ToastCenter.update("当前视频没有弹幕，或弹幕尚未加载完成", 2400);
        return null;
      }
      const size = this.getMediaSize(player);
      return this.convertDanmakuToAss(list, {
        title: "由抖音网页版增强下载工具导出",
        playResX: size.width,
        playResY: size.height,
      });
    }
  }
  // #endregion

  // #region V1.0.0 GPU Safe 静态样式
  function installNativeLiteStyles() {
    if (document.getElementById("dy-dl-native-lite-style-v1")) return;

    const style = document.createElement("style");
    style.id = "dy-dl-native-lite-style-v1";
    style.textContent = `
      .dy-dl-toast-v1 {
        position: fixed;
        right: 18px;
        bottom: 20px;
        z-index: 999999;
        display: none;
        max-width: min(78vw, 360px);
        box-sizing: border-box;
        padding: 7px 11px;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 9px;
        background: #202327;
        box-shadow: 0 4px 12px rgba(0,0,0,.20);
        color: #fff;
        font: 650 12px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
        pointer-events: none;
        user-select: none;
        white-space: normal;
      }

      /* ================================================================
       * V1.0.5 统一下载任务中心 / 胶囊
       * 无毛玻璃、无 transform 动画、无永久计时器。
       * ================================================================ */
      .dy-dl-task-center-v104 {
        position: fixed;
        left: 18px;
        bottom: 18px;
        z-index: 2147483000;
        box-sizing: border-box;
        color: #eef0f3;
        font-family: system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
      }

      .dy-dl-task-center-v104[hidden] {
        display: none !important;
      }

      .dy-dl-task-capsule-v104 {
        min-width: 150px;
        max-width: min(230px, calc(100vw - 36px));
        height: 36px;
        display: none;
        align-items: center;
        gap: 8px;
        padding: 0 12px;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 999px;
        background: #1d2025;
        box-shadow: 0 5px 16px rgba(0,0,0,.25);
        color: #eef0f3;
        cursor: pointer;
        user-select: none;
      }

      .dy-dl-task-center-v104[data-view="capsule"] .dy-dl-task-capsule-v104 {
        display: inline-flex;
      }

      .dy-dl-task-capsule-icon-v104 {
        width: 16px;
        height: 16px;
        display: inline-flex;
        color: #bf086a;
      }

      .dy-dl-task-capsule-icon-v104 svg,
      .dy-dl-task-head-actions-v104 svg,
      .dy-dl-task-actions-v104 svg,
      .dy-dl-inline-icon-v105 svg {
        width: 14px;
        height: 14px;
        display: block;
        flex: 0 0 14px;
      }

      .dy-dl-task-capsule-text-v104 {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
        font-weight: 700;
      }

      .dy-dl-task-panel-v104 {
        width: min(390px, calc(100vw - 36px));
        box-sizing: border-box;
        padding: 13px 14px;
        border: 1px solid rgba(255,255,255,.15);
        border-radius: 12px;
        background: #1d2025;
        box-shadow: 0 8px 24px rgba(0,0,0,.28);
      }

      .dy-dl-task-center-v104[data-view="capsule"] .dy-dl-task-panel-v104 {
        display: none;
      }

      .dy-dl-task-head-v104 {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }

      .dy-dl-task-heading-v104 {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .dy-dl-task-title-v104 {
        max-width: 238px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
      }

      .dy-dl-task-method-v104 {
        color: #9097a2;
        font-size: 10px;
      }

      .dy-dl-task-head-actions-v104,
      .dy-dl-task-actions-v104 {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .dy-dl-task-head-actions-v104 button,
      .dy-dl-task-actions-v104 button {
        min-height: 27px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 8px;
        border: 1px solid rgba(255,255,255,.15);
        border-radius: 7px;
        background: #292d33;
        color: #e8eaed;
        font-size: 10px;
        cursor: pointer;
        white-space: nowrap;
      }

      .dy-dl-task-cancel-v104:hover {
        border-color: rgba(239,68,68,.65) !important;
        color: #fecaca !important;
      }

      .dy-dl-task-retry-v104 {
        border-color: rgba(245,158,11,.55) !important;
        color: #fde68a !important;
      }

      .dy-dl-task-status-v104 {
        margin-top: 9px;
        color: #cbd0d7;
        font-size: 11px;
        line-height: 1.45;
      }

      .dy-dl-task-track-v104 {
        height: 6px;
        margin-top: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: #343840;
      }

      .dy-dl-task-fill-v104 {
        width: 0;
        height: 100%;
        background: #fe2c55;
      }

      .dy-dl-task-metrics-v104 {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        margin-top: 8px;
        color: #9299a4;
        font-size: 10px;
      }

      .dy-dl-task-actions-v104 {
        margin-top: 10px;
      }

      .dy-dl-task-center-v104[data-phase="completed"] .dy-dl-task-fill-v104 {
        background: #22c55e;
      }

      .dy-dl-task-center-v104[data-phase="failed"] .dy-dl-task-fill-v104,
      .dy-dl-task-center-v104[data-phase="unavailable"] .dy-dl-task-fill-v104 {
        background: #ef4444;
      }

      .dy-dl-task-center-v104[data-phase="submitted"] .dy-dl-task-fill-v104 {
        background: #3b82f6;
      }

      .dy-dl-task-center-v104[data-phase="retrying"] .dy-dl-task-fill-v104,
      .dy-dl-task-center-v104[data-phase="waiting_data"] .dy-dl-task-fill-v104 {
        background: #f59e0b;
      }

      .dy-dl-task-center-v104[data-phase="idle"] .dy-dl-task-fill-v104,
      .dy-dl-task-center-v104[data-phase="paused"] .dy-dl-task-fill-v104 {
        background: #bf086a;
      }

      .dy-dl-inline-icon-v105 {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: currentColor;
      }

      .dy-dl-modal-overlay-v1 {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        background: rgba(0,0,0,.56);
      }

      .dy-dl-modal-root-v1 {
        min-width: 300px;
        min-height: 150px;
        padding: 20px;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 10px;
        background: #202124;
        box-shadow: 0 8px 24px rgba(0,0,0,.28);
      }

      /* ================================================================
       * V1.0.1 通用 Modal 外框与关闭按钮
       * 关闭按钮位于 Preact root 外部，不会被 render() 覆盖。
       * ================================================================ */
      .dy-dl-modal-frame-v101 {
        position: relative;
        display: inline-block;
        max-width: 94vw;
        max-height: 92vh;
      }

      .dy-dl-modal-close-v101 {
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 2147483000;
        width: 34px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 9px;
        background: #25282d;
        box-shadow: 0 3px 10px rgba(0,0,0,.24);
        color: #f5f5f5;
        font: 500 25px/1 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
        cursor: pointer;
        user-select: none;
      }

      .dy-dl-modal-close-v101:hover {
        border-color: rgba(254,44,85,.72);
        background: #32252a;
        color: #fff;
      }

      /* ================================================================
       * V1.0.1 插件菜单
       * 不依赖 xgplayer 的 pointer-events / hover 逻辑。
       * ================================================================ */
      .dy-dl-video-btn,
      .dy-dl-plugin-gear-v101 {
        overflow: visible !important;
        pointer-events: auto !important;
      }

      .dy-dl-video-btn {
        width: auto !important;
        min-width: 68px !important;
      }

      .dy-dl-plugin-gear-v101 {
        position: relative !important;
      }

      .dy-dl-plugin-trigger-v101 {
        min-height: 30px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 6px !important;
        padding: 0 9px !important;
        border: 1px solid #bf086a !important;
        border-radius: 8px !important;
        background: #211820 !important;
        color: #bf086a !important;
        box-shadow: 0 2px 8px rgba(0,0,0,.24) !important;
        font-size: 12px !important;
        font-weight: 800 !important;
        line-height: 1 !important;
        cursor: pointer !important;
        pointer-events: auto !important;
        user-select: none !important;
      }

      .dy-dl-plugin-trigger-v101:hover,
      .dy-dl-plugin-trigger-v101:focus-visible {
        background: #bf086a !important;
        color: #fff !important;
        outline: 2px solid rgba(255,255,255,.72) !important;
        outline-offset: 2px !important;
      }

      .dy-dl-plugin-trigger-icon-v105 {
        width: 16px !important;
        height: 16px !important;
        display: block !important;
        flex: 0 0 16px !important;
      }

      .dy-dl-plugin-menu-v101 {
        position: absolute !important;
        right: 0 !important;
        bottom: calc(100% + 10px) !important;
        z-index: 2147482000 !important;

        display: none !important;
        min-width: 156px !important;
        padding: 8px !important;

        border: 1px solid rgba(255,255,255,.12) !important;
        border-radius: 11px !important;
        background: #292b2f !important;
        box-shadow: 0 8px 22px rgba(0,0,0,.28) !important;

        pointer-events: auto !important;
        visibility: visible !important;
        opacity: 1 !important;
      }

      .dy-dl-plugin-open-v101 .dy-dl-plugin-menu-v101,
      .dy-dl-plugin-gear-v101.dy-dl-plugin-open-v101
        > .dy-dl-plugin-menu-v101 {
        display: block !important;
      }

      .dy-dl-plugin-item-v101 {
        box-sizing: border-box !important;
        width: 100% !important;
        min-height: 34px !important;
        display: flex !important;
        align-items: center !important;
        padding: 7px 10px !important;
        border-radius: 8px !important;
        color: #e7e9ed !important;
        font-size: 13px !important;
        line-height: 1.25 !important;
        cursor: pointer !important;
        pointer-events: auto !important;
        user-select: none !important;
      }

      .dy-dl-plugin-item-v101:hover {
        background: #3a3d42 !important;
        color: #fff !important;
      }

      .dy-dl-plugin-item-v101.xgTips {
        cursor: default !important;
        color: #aeb3bd !important;
      }

      /* ================================================================
       * V1.0.1 “关于 / 需求反馈”信息面板
       *
       * 注意：文字内容不要在 CSS 里改。
       * 维护者 / 项目仓库 / 交流群 / 免责声明请搜索 ABOUT_PANEL_CONTENT 修改。
       * ================================================================ */
      .dy-dl-about-root-v101 {
        width: min(680px, 90vw) !important;
        max-width: 90vw !important;
        max-height: 86vh !important;
        min-height: 0 !important;
        padding: 0 !important;
        overflow: auto !important;
        background: #17191d !important;
        border: 1px solid rgba(255,255,255,.10) !important;
        border-radius: 14px !important;
      }

      .dy-dl-about-panel-v101 {
        box-sizing: border-box;
        padding: 26px;
        padding-top: 24px;
        color: #e8eaed;
        font-family: system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
      }

      .dy-dl-about-header {
        display: flex;
        align-items: center;
        gap: 14px;
        padding-right: 42px;
        margin-bottom: 22px;
      }

      .dy-dl-about-logo {
        width: 46px;
        height: 46px;
        flex: 0 0 46px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(254,44,85,.45);
        border-radius: 13px;
        background: #252127;
        color: #ff315f;
        font-weight: 850;
        letter-spacing: -.5px;
      }

      .dy-dl-about-heading {
        min-width: 0;
        flex: 1;
      }

      .dy-dl-about-title {
        color: #fff;
        font-size: 20px;
        font-weight: 800;
        line-height: 1.25;
      }

      .dy-dl-about-subtitle {
        margin-top: 4px;
        color: #979da8;
        font-size: 12px;
      }

      .dy-dl-about-version {
        display: inline-block;
        margin-left: 7px;
        padding: 2px 7px;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 999px;
        color: #c8ccd3;
        background: #222429;
      }

      .dy-dl-about-free {
        flex: 0 0 auto;
        padding: 5px 9px;
        border: 1px solid rgba(16,185,129,.32);
        border-radius: 999px;
        background: #16251f;
        color: #86efac;
        font-size: 11px;
        font-weight: 700;
      }

      .dy-dl-about-project-card,
      .dy-dl-about-section {
        box-sizing: border-box;
        border: 1px solid rgba(255,255,255,.09);
        border-radius: 11px;
        background: #1e2025;
      }

      .dy-dl-about-project-card {
        overflow: hidden;
      }

      .dy-dl-about-info-row {
        min-height: 48px;
        display: grid;
        grid-template-columns: 88px minmax(0, 1fr);
        align-items: center;
        gap: 14px;
        padding: 0 15px;
        border-bottom: 1px solid rgba(255,255,255,.07);
      }

      .dy-dl-about-info-row:last-child {
        border-bottom: 0;
      }

      .dy-dl-about-info-label,
      .dy-dl-about-section-title {
        color: #9aa0aa;
        font-size: 11px;
        font-weight: 700;
      }

      .dy-dl-about-section-title {
        margin-bottom: 7px;
      }

      .dy-dl-about-info-value {
        min-width: 0;
        color: #f5f6f7;
        font-size: 13px;
        font-weight: 700;
        word-break: break-all;
      }

      .dy-dl-about-info-value a,
      .dy-dl-about-attribution a {
        color: #8fa7ff;
        text-decoration: none;
      }

      .dy-dl-about-info-value a:hover,
      .dy-dl-about-attribution a:hover {
        color: #b8c5ff;
        text-decoration: underline;
      }

      .dy-dl-about-group-link {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 0 10px;
        border: 1px solid rgba(91,124,250,.42);
        border-radius: 8px;
        background: rgba(91,124,250,.12);
        color: #aebcff !important;
        font-size: 11px;
        text-decoration: none !important;
      }

      .dy-dl-about-group-link:hover {
        border-color: rgba(91,124,250,.72);
        background: rgba(91,124,250,.20);
      }

      .dy-dl-about-attribution {
        margin: 8px 2px 2px;
        color: #767f8d;
        font-size: 10px;
        line-height: 1.6;
      }

      .dy-dl-about-section {
        margin-top: 10px;
        padding: 14px 15px;
      }

      .dy-dl-about-section p {
        margin: 0;
        color: #c3c7cf;
        font-size: 12px;
        line-height: 1.75;
      }

      .dy-dl-about-features {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 16px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .dy-dl-about-features li {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        color: #cbd0d8;
        font-size: 12px;
        line-height: 1.45;
      }

      .dy-dl-about-dot {
        width: 6px;
        height: 6px;
        flex: 0 0 6px;
        margin-top: 5px;
        border-radius: 50%;
        background: #ff2c55;
      }

      .dy-dl-about-share-box {
        border-color: rgba(16,185,129,.18);
        background: #19221f;
      }

      .dy-dl-about-privacy {
        margin-top: 10px;
        padding: 9px 11px;
        border-left: 3px solid #f59e0b;
        border-radius: 5px;
        background: #29251d;
        color: #e6d3a1;
        font-size: 11px;
        line-height: 1.6;
      }

      .dy-dl-about-disclaimer {
        border-color: rgba(245,158,11,.16);
      }

      .dy-dl-about-footer {
        display: flex;
        justify-content: center;
        gap: 8px;
        padding-top: 15px;
        color: #777e89;
        font-size: 10px;
      }

      @media (max-width: 650px) {
        .dy-dl-about-features {
          grid-template-columns: 1fr;
        }

        .dy-dl-about-info-row {
          grid-template-columns: 72px minmax(0, 1fr);
          gap: 10px;
        }

        .dy-dl-about-free {
          display: none;
        }

        .dy-dl-about-panel-v101 {
          padding: 19px;
        }
      }



      /* ================================================================
       * V1.0.6 Graphite Cobalt 产品设计系统
       * ================================================================ */
      :root {
        --dy-dl-primary: #5B7CFA;
        --dy-dl-primary-hover: #6E8CFF;
        --dy-dl-primary-soft: #18213E;
        --dy-dl-primary-border: #344B8E;
        --dy-dl-bg-base: #0B0E13;
        --dy-dl-bg-panel: #11151C;
        --dy-dl-bg-card: #171C25;
        --dy-dl-bg-control: #1E2530;
        --dy-dl-bg-hover: #252D39;
        --dy-dl-border: #2B3441;
        --dy-dl-border-strong: #3B4656;
        --dy-dl-text: #F4F7FB;
        --dy-dl-text-secondary: #B2BBC8;
        --dy-dl-text-muted: #7F8998;
        --dy-dl-success: #36B887;
        --dy-dl-warning: #D9A347;
        --dy-dl-danger: #DF6670;
        --dy-dl-info: #58A0FF;
      }

      .dy-dl-inline-icon-v106,
      .dy-dl-inline-icon-v105 {
        width: 16px;
        height: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 16px;
      }
      .dy-dl-inline-icon-v106 svg,
      .dy-dl-inline-icon-v105 svg { width: 16px; height: 16px; display: block; }

      .dy-dl-btn-v106 {
        min-height: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 13px;
        border-radius: 9px;
        font: 650 12px/1 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
        cursor: pointer;
      }
      .dy-dl-btn-v106 svg { width: 16px; height: 16px; }
      .dy-dl-btn-primary-v106 { border: 1px solid transparent; background: var(--dy-dl-primary); color: #fff; }
      .dy-dl-btn-primary-v106:hover { background: var(--dy-dl-primary-hover); }
      .dy-dl-btn-secondary-v106 { border: 1px solid var(--dy-dl-border); background: var(--dy-dl-bg-control); color: var(--dy-dl-text-secondary); }
      .dy-dl-btn-secondary-v106:hover { border-color: var(--dy-dl-border-strong); background: var(--dy-dl-bg-hover); color: var(--dy-dl-text); }
      .dy-dl-btn-danger-v106 { background: var(--dy-dl-danger) !important; color: #fff !important; }
      .dy-dl-icon-btn-v106 { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 1px solid var(--dy-dl-border); border-radius: 8px; background: var(--dy-dl-bg-control); color: var(--dy-dl-text-secondary); cursor: pointer; }
      .dy-dl-icon-btn-v106 svg { width: 16px; height: 16px; }
      .dy-dl-btn-v106:focus-visible,
      .dy-dl-icon-btn-v106:focus-visible,
      .dy-dl-plugin-trigger-v101:focus-visible { outline: 2px solid #8FA7FF !important; outline-offset: 2px; }

      /* 产品级对话框 */
      .dy-dl-product-dialog-overlay-v106 { position: fixed; inset: 0; z-index: 2147483646; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,.66); }
      .dy-dl-product-dialog-v106 { width: min(460px, calc(100vw - 40px)); box-sizing: border-box; padding: 22px; display: grid; grid-template-columns: 40px minmax(0,1fr); gap: 14px; border: 1px solid var(--dy-dl-border); border-radius: 16px; background: var(--dy-dl-bg-panel); box-shadow: 0 12px 36px rgba(0,0,0,.38); color: var(--dy-dl-text); font-family: system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
      .dy-dl-product-dialog-icon-v106 { width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; border-radius: 11px; background: var(--dy-dl-primary-soft); color: #8FA7FF; }
      .dy-dl-product-dialog-icon-v106[data-tone="warning"] { background: #2A2417; color: #E7BE6A; }
      .dy-dl-product-dialog-icon-v106[data-tone="danger"] { background: #2B181C; color: #F09AA1; }
      .dy-dl-product-dialog-icon-v106 svg { width: 20px; height: 20px; }
      .dy-dl-product-dialog-copy-v106 h3 { margin: 0; font-size: 16px; font-weight: 720; }
      .dy-dl-product-dialog-message-v106 { margin: 9px 0 0; color: var(--dy-dl-text-secondary); font-size: 13px; line-height: 1.65; }
      .dy-dl-product-dialog-detail-v106 { margin: 8px 0 0; color: var(--dy-dl-text-muted); font-size: 11px; line-height: 1.6; }
      .dy-dl-product-dialog-actions-v106 { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }

      /* Toast：顶部中央、低干扰 */
      .dy-dl-toast-v1 { right: 0 !important; left: 0 !important; top: 18px !important; bottom: auto !important; width: max-content !important; margin: 0 auto !important; max-width: min(520px, calc(100vw - 36px)) !important; padding: 9px 13px !important; border-color: var(--dy-dl-border) !important; border-radius: 10px !important; background: var(--dy-dl-bg-panel) !important; color: var(--dy-dl-text-secondary) !important; box-shadow: 0 10px 30px rgba(0,0,0,.32) !important; font-size: 12px !important; transform: none !important; }

      /* 任务中心：批量永远胶囊，单文件才显示紧凑卡 */
      .dy-dl-task-center-v106 { position: fixed; left: 20px; bottom: 20px; z-index: 2147483000; color: var(--dy-dl-text); font-family: system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
      .dy-dl-task-center-v106[hidden] { display: none !important; }
      .dy-dl-task-capsule-v106 { position: relative; min-width: 168px; max-width: min(240px, calc(100vw - 40px)); height: 38px; display: none; align-items: center; gap: 9px; padding: 0 13px; overflow: hidden; border: 1px solid var(--dy-dl-border); border-radius: 999px; background: var(--dy-dl-bg-panel); box-shadow: 0 10px 28px rgba(0,0,0,.32); color: var(--dy-dl-text-secondary); cursor: pointer; }
      .dy-dl-task-center-v106[data-view="capsule"] .dy-dl-task-capsule-v106 { display: inline-flex; }
      .dy-dl-task-capsule-icon-v106 { width: 17px; height: 17px; display: inline-flex; color: #8FA7FF; }
      .dy-dl-task-capsule-icon-v106 svg { width: 17px; height: 17px; }
      .dy-dl-task-capsule-text-v106 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 680; }
      .dy-dl-task-capsule-progress-v106 { position: absolute; left: 12px; right: 12px; bottom: 0; height: 2px; background: #232A35; }
      .dy-dl-task-capsule-progress-v106 i { display: block; width: 0; height: 100%; background: var(--dy-dl-primary); }
      .dy-dl-task-panel-v106 { width: min(370px, calc(100vw - 40px)); padding: 15px; border: 1px solid var(--dy-dl-border); border-radius: 14px; background: var(--dy-dl-bg-panel); box-shadow: 0 12px 36px rgba(0,0,0,.35); }
      .dy-dl-task-center-v106[data-view="capsule"] .dy-dl-task-panel-v106 { display: none; }
      .dy-dl-task-panel-header-v106 { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .dy-dl-task-panel-title-group-v106 { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      .dy-dl-task-title-v106 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
      .dy-dl-task-method-v106 { color: var(--dy-dl-text-muted); font-size: 10px; }
      .dy-dl-task-state-row-v106 { display: flex; align-items: center; gap: 8px; margin-top: 15px; }
      .dy-dl-task-state-icon-v106 { width: 17px; height: 17px; color: #8FA7FF; }
      .dy-dl-task-state-icon-v106 svg { width: 17px; height: 17px; }
      .dy-dl-task-status-v106 { flex: 1; min-width: 0; color: var(--dy-dl-text-secondary); font-size: 12px; }
      .dy-dl-task-percent-v106 { font-size: 12px; font-variant-numeric: tabular-nums; }
      .dy-dl-task-track-v106 { height: 5px; margin-top: 10px; overflow: hidden; border-radius: 999px; background: var(--dy-dl-bg-control); }
      .dy-dl-task-fill-v106 { width: 0; height: 100%; background: var(--dy-dl-primary); }
      .dy-dl-task-metrics-v106 { display: flex; gap: 14px; margin-top: 9px; color: var(--dy-dl-text-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
      .dy-dl-task-actions-v106 { display: flex; gap: 8px; margin-top: 14px; }
      .dy-dl-task-center-v106[data-phase="completed"] .dy-dl-task-state-icon-v106,
      .dy-dl-task-center-v106[data-phase="completed"] .dy-dl-task-capsule-icon-v106 { color: var(--dy-dl-success); }
      .dy-dl-task-center-v106[data-phase="failed"] .dy-dl-task-state-icon-v106,
      .dy-dl-task-center-v106[data-phase="failed"] .dy-dl-task-capsule-icon-v106 { color: var(--dy-dl-danger); }
      .dy-dl-task-center-v106[data-phase="paused"] .dy-dl-task-state-icon-v106,
      .dy-dl-task-center-v106[data-phase="paused"] .dy-dl-task-capsule-icon-v106 { color: var(--dy-dl-paused, #A58BC8); }

      /* 通用 Modal 外壳 */
      .dy-dl-modal-overlay-v1 { background: rgba(0,0,0,.68) !important; }
      .dy-dl-modal-root-v1 { border-color: var(--dy-dl-border) !important; background: var(--dy-dl-bg-panel) !important; box-shadow: 0 12px 36px rgba(0,0,0,.38) !important; color: var(--dy-dl-text) !important; }
      .dy-dl-modal-close-v101 { top: 12px !important; right: 12px !important; width: 32px !important; height: 32px !important; border-color: var(--dy-dl-border) !important; border-radius: 8px !important; background: var(--dy-dl-bg-control) !important; color: var(--dy-dl-text-secondary) !important; box-shadow: none !important; font-size: 0 !important; }
      .dy-dl-modal-close-v101 svg { width: 17px !important; height: 17px !important; }
      .dy-dl-modal-close-v101:hover { border-color: var(--dy-dl-border-strong) !important; background: var(--dy-dl-bg-hover) !important; color: var(--dy-dl-text) !important; }

      /* 播放页插件入口：钴蓝工具按钮，与抖音原生控件区分 */
      .dy-dl-plugin-trigger-v101 { min-height: 30px !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; gap: 7px !important; padding: 0 10px !important; border: 1px solid var(--dy-dl-primary-border) !important; border-radius: 8px !important; background: var(--dy-dl-primary-soft) !important; color: #9AAEFF !important; font-size: 12px !important; font-weight: 700 !important; cursor: pointer !important; }
      .dy-dl-plugin-trigger-v101:hover { background: var(--dy-dl-primary) !important; border-color: var(--dy-dl-primary) !important; color: #fff !important; }
      .dy-dl-plugin-trigger-icon-v105 { width: 17px !important; height: 17px !important; }
      .dy-dl-plugin-menu-v101 { border-color: var(--dy-dl-border) !important; background: var(--dy-dl-bg-panel) !important; box-shadow: 0 12px 32px rgba(0,0,0,.36) !important; }
      .dy-dl-plugin-item-v101 { color: var(--dy-dl-text-secondary) !important; }
      .dy-dl-plugin-item-v101:hover { background: var(--dy-dl-bg-hover) !important; color: var(--dy-dl-text) !important; }

      /* 作者页选择控件 */
      .dy-dl-feed-selector { border-color: var(--dy-dl-border-strong) !important; background: var(--dy-dl-bg-panel) !important; color: var(--dy-dl-text-secondary) !important; box-shadow: 0 6px 18px rgba(0,0,0,.24); }
      .dy-dl-feed-checkbox { accent-color: var(--dy-dl-primary) !important; }


      .dy-dl-about-root-v101 { background: var(--dy-dl-bg-panel) !important; border-color: var(--dy-dl-border) !important; }
      .dy-dl-about-logo { border-color: var(--dy-dl-primary-border) !important; background: var(--dy-dl-primary-soft) !important; color: #9AAEFF !important; }
      .dy-dl-about-project-card, .dy-dl-about-section { border-color: var(--dy-dl-border) !important; background: var(--dy-dl-bg-card) !important; }
      .dy-dl-about-dot { background: var(--dy-dl-primary) !important; }

      .dy-dl-author-stat-status { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 8px; color: var(--dy-dl-text-muted); font-size: 11px; }
      .dy-dl-author-stat-status[data-state="failed"] { color: var(--dy-dl-warning); }
      .dy-dl-author-stat-retry { min-height: 26px; padding: 0 9px; border: 1px solid var(--dy-dl-border); border-radius: 7px; background: var(--dy-dl-bg-control); color: var(--dy-dl-text-secondary); font: 650 11px/1 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; cursor: pointer; }
      .dy-dl-author-stat-retry:hover { border-color: var(--dy-dl-primary-border); background: var(--dy-dl-bg-hover); color: var(--dy-dl-text); }

      @media (max-width: 820px) {
        .dy-dl-product-dialog-v106 { grid-template-columns: 34px minmax(0,1fr); padding: 18px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .dy-dl-btn-v106, .dy-dl-icon-btn-v106, .dy-dl-plugin-trigger-v101 { transition: none !important; }
      }


      .dy-dl-native-lite-btn {
        position: absolute;
        right: 35px;
        bottom: 35px;
        z-index: 999999;
        padding: 6px 11px;
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 8px;
        background: #202327;
        color: #fff;
        font-size: 14px;
        cursor: pointer;
      }

      .dy-dl-tooltip-download {
        cursor: pointer;
        padding-top: 4px;
      }

      .dy-dl-feed-selector {
        z-index: 5;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border: 1px solid rgba(255,255,255,.24);
        border-radius: 999px;
        background: #202327;
        color: #fff;
        font: 650 12px/1 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
        cursor: pointer;
        user-select: none;
      }

      .dy-dl-feed-selector[data-placement="overlay"] {
        position: absolute;
        top: 10px;
        left: 10px;
      }

      .dy-dl-feed-selector[data-placement="inline"] {
        position: static;
        width: max-content;
        margin: 6px 0;
      }

      .dy-dl-feed-checkbox {
        margin: 0;
        cursor: pointer;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }
  // #endregion

  // #region 启动
  // ========== Main Script Logic =============

  installNativeLiteStyles();

  const downloader = new Downloader();
  const mediaHandler = new MediaHandler(downloader);
  const danmakuHandler = new DanmakuHandler();
  const profilePageHandler = new ProfilePageHandler({
    mediaHandler,
  });
  const domPatcher = new DOMPatcher({
    downloader,
    mediaHandler,
    danmakuHandler,
    profilePageHandler,
  });
  const hotkeyManager = new HotkeyManager();

  mediaHandler.init(); // Starts player detection
  domPatcher.startObserving(); // Starts DOM observation and initial scan
  profilePageHandler.mount_ui();

  hotkeyManager.addHotkey("m", () => mediaHandler.download_current_media());
  // #endregion
  console.log("[dy-dl] V1.0.9 稳定增强版已启动");
})();
