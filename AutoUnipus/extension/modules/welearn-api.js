// WE Learn API 模块 — 数据 HTML 解析正解 + DOM 自动填入
// 优先在 iframe 内同源取数据，回退到 bg 跨域代理

(function () {
  "use strict";

  // ======================== 环境检测 ========================

  function isInIframe() {
    return (
      window.location.hostname.includes("centercourseware.sflep.com") &&
      window.location.hash
    );
  }

  // ======================== 页面信息提取 ========================

  function extractPageInfo() {
    const result = { dataUrl: null, route: null };

    if (isInIframe()) {
      // iframe 内：从 hash 推导 data URL
      const hash = (window.location.hash || "").replace(/^#\/?/, "");
      const route = hash.split("?")[0];
      result.route = route;
      result.dataUrl = "data/" + route + ".html";
    } else {
      // 主页面：从 iframe src 推导（保留 %20 编码，不用 new URL 解码）
      const params = new URLSearchParams(window.location.search);
      result.cid = params.get("cid");
      result.classid = params.get("classid");
      result.tid = params.get("tid");
      result.sco = params.get("sco");

      const iframe = document.querySelector(
        'iframe[src*="centercourseware.sflep.com"]'
      );
      if (iframe) {
        try {
          const src = iframe.src;
          // src: "https://centercourseware.sflep.com/New%20Advanced.../index.html#/10/4-1"
          // 直接字符串替换，不经过 URL 解码
          const hashPart = (src.split("#")[1] || "").replace(/^\//, "");
          const route = hashPart.split("?")[0];
          const baseUrl = src.replace(/\/index\.html.*$/, "");
          result.route = route;
          result.dataUrl = baseUrl + "/data/" + route + ".html";
        } catch (_) {}
      }
    }

    return result;
  }

  // ======================== 数据 HTML 抓取 ========================

  async function fetchDataHtml(url) {
    if (isInIframe()) {
      // iframe 内同源，直接 fetch
      console.log("[welearn-api] iframe 同源抓取:", url);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Fetch failed: " + resp.status);
      return await resp.text();
    } else {
      // 主页面跨域，通过 bg 代理
      console.log("[welearn-api] 主页面 bg 代理抓取:", url);
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: "fetchWelearnData", url },
          (response) => {
            if (chrome.runtime.lastError)
              return reject(new Error(chrome.runtime.lastError.message));
            if (!response.success) return reject(new Error(response.error));
            resolve(response.data);
          }
        );
      });
    }
  }

  // ======================== HTML 答案解析 ========================

  function parseAnswers(html) {
    const results = [];
    let currentTabName = "";

    // 提取 Tab 标题
    const tabTitles = [];
    const headerMatch = html.match(/<ul header>([\s\S]*?)<\/ul>/);
    if (headerMatch) {
      const liMatches = headerMatch[1].matchAll(
        /<li[^>]*>([^<]*)<\/li>/g
      );
      for (const m of liMatches) tabTitles.push(m[1].trim());
    }

    const tabSections = html.split(/(<tab>|<\/tab>)/);
    let tabIdx = -1;
    let inTab = false;

    for (const section of tabSections) {
      if (section === "<tab>") {
        inTab = true;
        tabIdx++;
        currentTabName = tabTitles[tabIdx] || "Tab " + (tabIdx + 1);
        continue;
      }
      if (section === "</tab>") {
        inTab = false;
        continue;
      }
      if (!inTab || !section.trim()) continue;

      const dirMatch = section.match(
        /<et-direction[^>]*>([\s\S]*?)<\/et-direction>/
      );
      const direction = dirMatch
        ? dirMatch[1].replace(/<[^>]+>/g, "").trim()
        : "";

      // et-choice：选择题 / 选词填空
      const choiceRegex =
        /<et-choice\s+([^>]*?)>([\s\S]*?)<\/et-choice>/g;
      let cm;
      while ((cm = choiceRegex.exec(section)) !== null) {
        const attrs = cm[1];
        const inner = cm[2];
        const keyMatch = attrs.match(/key\s*=\s*"([^"]*)"/);
        if (!keyMatch) continue;

        const key = keyMatch[1];
        const hasJoin = /join\s*=/.test(attrs);
        let answer, type;

        if (hasJoin) {
          // 选词填空：key 数字 → span 索引
          type = "blank_choice";
          const spans = [];
          const sr = /<span[^>]*>([^<]*)<\/span>/g;
          let sm;
          while ((sm = sr.exec(inner)) !== null)
            spans.push(sm[1].trim());
          answer = spans[parseInt(key) - 1] || key;
        } else {
          // 选择题：key 字母 → 选项索引
          type = "single";
          const opts = [];
          const lr = /<li[^>]*>([\s\S]*?)<\/li>/g;
          let lm;
          while ((lm = lr.exec(inner)) !== null)
            opts.push(lm[1].replace(/<[^>]+>/g, "").trim());
          const idx = key.toUpperCase().charCodeAt(0) - 65;
          answer = opts[idx] || key.toUpperCase();
        }

        const idxMatch = attrs.match(/index\s*=\s*"([^"]*)"/);
        results.push({
          answers: [answer],
          type: type,
          key: key,
          questionText: direction,
          tabName: currentTabName,
          questionIndex: idxMatch ? parseInt(idxMatch[1]) : null,
        });
      }

      // et-blank：填空（有/无属性均匹配，支持 | 分隔的多答案）
      const blankRegex =
        /<et-blank(?:\s+[^>]*)?>([\s\S]*?)<\/et-blank>/g;
      let bm;
      while ((bm = blankRegex.exec(section)) !== null) {
        const raw = bm[1].replace(/<[^>]+>/g, "").trim();
        if (raw) {
          results.push({
            answers: raw.split("|").map((s) => s.trim()).filter(Boolean),
            type: "fill",
            questionText: direction,
            tabName: currentTabName,
          });
        }
      }

      // et-tof：判断题 True/False
      const tofRegex = /<et-tof\s+([^>]*?)>/g;
      let tm;
      while ((tm = tofRegex.exec(section)) !== null) {
        const attrs = tm[1];
        const keyMatch = attrs.match(/key\s*=\s*"([TF])"/i);
        if (!keyMatch) continue;
        const key = keyMatch[1].toUpperCase();
        results.push({
          answers: [key === "T" ? "True" : "False"],
          type: "tof",
          key: key,
          questionText: direction,
          tabName: currentTabName,
        });
      }
    }

    return results;
  }

  // ======================== DOM 自动填入 ========================

  /**
   * 在 iframe 内自动点击正确答案
   */
  function autoFillAnswers(answerList) {
    if (!isInIframe()) {
      console.log("[welearn-api] 不在 iframe 中，跳过 DOM 自动填入");
      return { skipped: true, reason: "not in iframe" };
    }

    const results = [];
    let choiceIdx = 0;
    let blankIdx = 0;
    let tofIdx = 0;

    // 收集选择题的 ol 列表
    const stems = document.querySelectorAll("et-stem");
    const allChoiceOLs = [];
    const allBlankInputs = [];
    const allTofs = [];

    stems.forEach((stem) => {
      // 选择题选项列表
      stem.querySelectorAll("et-choice").forEach((choice) => {
        const ol = choice.querySelector("ol");
        if (ol && ol.querySelectorAll("li").length >= 2) {
          allChoiceOLs.push(ol);
        } else {
          const spans = choice.querySelectorAll("span");
          if (spans.length >= 2) {
            allChoiceOLs.push(spans);
          }
        }
      });
      // 填空输入框
      stem.querySelectorAll("et-blank").forEach((blank) => {
        const input =
          blank.querySelector("input") ||
          blank.querySelector("textarea") ||
          blank.querySelector("[contenteditable]");
        if (input) allBlankInputs.push(input);
      });
      // 判断题 et-tof 元素
      stem.querySelectorAll("et-tof").forEach((tof) => {
        const spans = tof.querySelectorAll(".controls span");
        if (spans.length >= 2) {
          allTofs.push({ el: tof, tSpan: spans[0], fSpan: spans[1] });
        }
      });
    });

    console.log(
      "[welearn-api] 找到",
      allChoiceOLs.length,
      "组选项,",
      allBlankInputs.length,
      "个填空,",
      allTofs.length,
      "个判断题"
    );

    answerList.forEach((a, i) => {
      try {
        if (a.type === "single") {
          if (choiceIdx >= allChoiceOLs.length) return;
          const ol = allChoiceOLs[choiceIdx];
          const idx = a.key.toUpperCase().charCodeAt(0) - 65;

          if (ol instanceof NodeList || Array.isArray(ol)) {
            // span 列表（错误归类为 single 的选词填空）
            if (idx >= 0 && idx < ol.length) {
              ol[idx].click();
              results.push({ i, type: "span_click", idx, ok: true });
            }
          } else {
            const lis = ol.querySelectorAll("li");
            if (idx >= 0 && idx < lis.length) {
              lis[idx].click();
              results.push({ i, type: "li_click", idx, ok: true });
            }
          }
          choiceIdx++;
        } else if (a.type === "blank_choice") {
          if (choiceIdx >= allChoiceOLs.length) return;
          const spans = allChoiceOLs[choiceIdx];
          const idx = parseInt(a.key) - 1;

          if (
            spans instanceof NodeList ||
            Array.isArray(spans) ||
            spans instanceof HTMLCollection
          ) {
            const arr = Array.from(spans);
            if (idx >= 0 && idx < arr.length) {
              arr[idx].click();
              results.push({ i, type: "span_click", idx, ok: true });
            }
          }
          choiceIdx++;
        } else if (a.type === "fill") {
          if (blankIdx >= allBlankInputs.length) return;
          const input = allBlankInputs[blankIdx];
          const val = a.answers[0];
          if (!input) { blankIdx++; return; }
          const tag = input.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA") {
            const nativeSetter =
              tag === "TEXTAREA"
                ? Object.getOwnPropertyDescriptor(
                    window.HTMLTextAreaElement.prototype, "value"
                  ).set
                : Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, "value"
                  ).set;
            nativeSetter.call(input, val);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            results.push({ i, type: "fill", val, ok: true });
          } else if (input.isContentEditable) {
            // contenteditable span/div
            input.textContent = val;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            input.dispatchEvent(new Event("blur", { bubbles: true }));
            results.push({ i, type: "fill_editable", val, ok: true });
          }
          blankIdx++;
        } else if (a.type === "tof") {
          if (tofIdx >= allTofs.length) return;
          const tof = allTofs[tofIdx];
          const targetSpan = a.key === "T" ? tof.tSpan : tof.fSpan;
          if (targetSpan) {
            targetSpan.click();
            results.push({ i, type: "tof_click", key: a.key, ok: true });
          }
          tofIdx++;
        }
      } catch (e) {
        results.push({ i, error: e.message });
      }
    });

    return {
      total: answerList.length,
      clicked: results.filter((r) => r.ok).length,
      details: results,
    };
  }

  // ======================== 一站式接口 ========================

  async function getAnswers() {
    const info = extractPageInfo();

    if (!info.dataUrl) {
      console.error("[welearn-api] 无法推导数据 HTML URL");
      return null;
    }

    console.log("[welearn-api] 数据URL:", info.dataUrl);

    const html = await fetchDataHtml(info.dataUrl);
    if (!html) {
      console.error("[welearn-api] 抓取数据 HTML 失败");
      return null;
    }

    const answers = parseAnswers(html);
    console.log(
      "[welearn-api] 解析到",
      answers.length,
      "个答案:",
      answers.map((a) => a.type + ":" + (a.answers[0] || "").substring(0, 20)).join(", ")
    );

    return { info, answers };
  }

  // ======================== 导出 ========================

  window.welearnAPI = {
    isInIframe,
    extractPageInfo,
    fetchDataHtml,
    parseAnswers,
    autoFillAnswers,
    getAnswers,
  };

  console.log("[welearn-api] 模块已加载, iframe:", isInIframe());
})();
