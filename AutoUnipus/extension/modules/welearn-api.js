// WE Learn API 模块 — 数据 HTML 解析正解 + DOM 自动填入
// 优先在 iframe 内同源取数据，回退到 bg 跨域代理

(function () {
  "use strict";

  // ======================== 环境检测 ========================

  function isInIframe() {
    return (
      window.location.hostname === "centercourseware.sflep.com" &&
      Boolean(window.location.hash)
    );
  }

  // ======================== 页面信息提取 ========================

  function extractPageInfo() {
    const result = { dataUrl: null, route: null };
    const params = new URLSearchParams(window.location.search);
    result.cid = params.get("cid");
    result.classid = params.get("classid");
    result.tid = params.get("tid");
    result.sco = params.get("sco");

    let source = null;
    if (isInIframe()) {
      source = new URL(window.location.href);
    } else {
      for (const iframe of document.querySelectorAll("iframe[src]")) {
        try {
          const candidate = new URL(iframe.getAttribute("src"), window.location.href);
          if (candidate.hostname === "centercourseware.sflep.com") {
            source = candidate;
            break;
          }
        } catch (_) {}
      }
    }

    if (!source || source.protocol !== "https:" ||
        source.hostname !== "centercourseware.sflep.com") return result;

    const route = source.hash.replace(/^#\/?/, "").split("?")[0].replace(/^\/+/, "");
    if (!route || route.split("/").some((part) => part === "." || part === "..")) return result;
    result.route = route;
    result.dataUrl = new URL("data/" + route + ".html", new URL("./", source)).href;

    return result;
  }

  function observedDataUrls() {
    if (!window.performance?.getEntriesByType) return [];
    return window.performance.getEntriesByType("resource")
      .map((entry) => {
        try { return new URL(entry.name); } catch (_) { return null; }
      })
      .filter((url) => url && url.protocol === "https:" &&
        url.hostname === "centercourseware.sflep.com" &&
        /\/data\/.+\.html$/i.test(url.pathname))
      .map((url) => url.href)
      .reverse();
  }

  // ======================== 数据 HTML 抓取 ========================

  async function fetchDataHtml(url) {
    if (isInIframe()) {
      // iframe 内同源，直接 fetch
      console.log("[welearn-api] iframe 同源抓取:", url);
      const resp = await fetch(url, { credentials: "same-origin" });
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
            if (!response?.success) return reject(new Error(response?.error || "WE Learn 请求无响应"));
            resolve(response.data);
          }
        );
      });
    }
  }

  // ======================== HTML 答案解析 ========================

  function parseAnswers(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const titles = Array.from(doc.querySelectorAll("ul[header] li"),
      (li) => li.textContent.trim());
    const tabs = Array.from(doc.querySelectorAll("tab"));
    const regions = tabs.length ? tabs : [doc.body];
    const results = [];

    regions.forEach((region, tabIdx) => {
      const tabName = tabs.length ? (titles[tabIdx] || "Tab " + (tabIdx + 1)) : "";
      // 保持资源 HTML 中的题目顺序，避免选择与填空混排时错位。
      region.querySelectorAll("et-choice, et-blank, et-tof").forEach((node) => {
        if (node.tagName !== "ET-CHOICE" && node.closest("et-choice")) return;
        const direction = node.closest("et-stem")?.querySelector("et-direction") ||
          region.querySelector("et-direction");
        const questionText = direction?.textContent.trim() || "";
        const common = { questionText, tabName };

        if (node.tagName === "ET-CHOICE") {
          const key = node.getAttribute("key")?.trim() || "";
          if (node.hasAttribute("multi")) {
            const options = Array.from(node.querySelectorAll("li"),
              (li) => li.textContent.trim());
            const indexes = key.split(",").map((part) => Number(part.trim()) - 1);
            if (!indexes.length || indexes.some((index) =>
              !Number.isInteger(index) || index < 0 || index >= options.length)) return;
            results.push({ ...common, type: "multiple", key, indexes,
              answers: indexes.map((index) => options[index]) });
          } else if (node.hasAttribute("join")) {
            const index = Number.parseInt(key, 10) - 1;
            if (!Number.isInteger(index) || index < 0) return;
            const options = Array.from(node.querySelectorAll("span"),
              (span) => span.textContent.trim());
            results.push({ ...common, type: "blank_choice", key,
              answers: [options[index] || key],
              questionIndex: Number.parseInt(node.getAttribute("index"), 10) || null });
          } else {
            const letter = key.toUpperCase();
            if (!/^[A-Z]$/.test(letter)) return;
            const options = Array.from(node.querySelectorAll("li"),
              (li) => li.textContent.trim());
            const index = letter.charCodeAt(0) - 65;
            results.push({ ...common, type: "single", key: letter,
              answers: [options[index] || letter],
              questionIndex: Number.parseInt(node.getAttribute("index"), 10) || null });
          }
        } else if (node.tagName === "ET-BLANK") {
          const raw = node.textContent.trim();
          const answers = raw.split("|").map((value) => value.trim()).filter(Boolean);
          if (answers.length) results.push({ ...common, type: "fill", answers });
        } else if (node.tagName === "ET-TOF") {
          const key = node.getAttribute("key")?.trim().toUpperCase();
          if (key === "T" || key === "F") {
            results.push({ ...common, type: "tof", key,
              answers: [key === "T" ? "True" : "False"] });
          }
        }
      });
    });

    return results;
  }

  // 按题目与参考区块配对；参考文本并不以录音控件为前提。
  function parseReferenceExercises(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const references = [];
    const pageInstruction = doc.querySelector("et-direction")?.textContent.trim() || "";

    doc.querySelectorAll("et-reveal").forEach((reveal) => {
      const item = reveal.closest("et-stem li, et-question, .question, .exercise-item") ||
        reveal.parentElement;
      if (!item) return;
      const promptNode = item.querySelector(":scope > p, :scope > et-question, :scope > .prompt");
      const question = promptNode?.textContent.trim() || Array.from(item.children)
        .filter((child) => child !== reveal && !child.contains(reveal) &&
          !child.matches("et-recorder, et-choice, et-blank, et-tof, input, textarea, button"))
        .map((child) => child.textContent.trim()).find(Boolean) || "";
      if (!question) return;
      const listed = Array.from(reveal.querySelectorAll("li"));
      const examples = (listed.length ? listed :
        Array.from(reveal.querySelectorAll("p"))).map((node) => node.textContent.trim())
        .filter(Boolean);
      if (!examples.length && reveal.textContent.trim()) examples.push(reveal.textContent.trim());
      if (!examples.length) return;
      const instruction = item.closest("tab")?.querySelector("et-direction")
        ?.textContent.trim() || pageInstruction;
      references.push({
        type: "open_ended", title: "问题 " + (references.length + 1), instruction,
        prompts: [question], lines: examples,
      });
    });

    doc.querySelectorAll("et-follow-me").forEach((exercise) => {
      const lines = exercise.textContent.split("|").map((line) => line.trim()).filter(Boolean);
      if (lines.length) references.push({
        type: "read_aloud", title: "跟读参考文本", instruction: pageInstruction,
        prompts: lines.slice(), lines,
      });
    });

    const titles = Array.from(doc.querySelectorAll("ul[header] > li"),
      (li) => li.textContent.trim());
    doc.querySelectorAll("et-talk").forEach((exercise, index) => {
      const lines = Array.from(exercise.querySelectorAll("flow"), (flow) => ({
        role: flow.getAttribute("role") || "",
        text: flow.textContent.trim(),
      })).filter((line) => line.text);
      if (lines.length) references.push({
        type: "role_play",
        title: titles[index] || "对话 " + (index + 1),
        instruction: pageInstruction,
        prompts: lines.filter((line) => /[?？]/.test(line.text))
          .map((line) => ({ role: line.role, text: line.text })),
        lines,
      });
    });
    return references;
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
        if (a.type === "multiple") {
          if (choiceIdx >= allChoiceOLs.length) return;
          const ol = allChoiceOLs[choiceIdx++];
          if (!ol.querySelectorAll) return;
          const lis = ol.querySelectorAll("li");
          let clicked = 0;
          for (const index of a.indexes) {
            if (lis[index]) {
              lis[index].click();
              clicked++;
            }
          }
          if (clicked === a.indexes.length) {
            results.push({ i, type: "multi_click", indexes: a.indexes, ok: true });
          }
        } else if (a.type === "single") {
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
    const observed = observedDataUrls();
    const expectedPath = info.dataUrl ? new URL(info.dataUrl).pathname : null;
    const sameRoute = expectedPath ? observed.filter((url) =>
      new URL(url).pathname === expectedPath) : [];
    // SPA 可能保留上一课件/课程的 Performance 记录，绝不能拿旧答案兜底。
    const urls = [...new Set([...sameRoute, info.dataUrl].filter(Boolean))];
    if (!urls.length) throw new Error("未定位到 WE Learn 课程数据请求；请打开具体练习页");

    let lastError = null;
    for (const url of urls) {
      try {
        const html = await fetchDataHtml(url);
        const answers = parseAnswers(html);
        const references = parseReferenceExercises(html);
        if (answers.length || references.length) {
          return { info, answers, references, sourceUrl: url };
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(lastError ?
      "课程数据未包含可解析的正解（" + lastError.message + "）" :
      "课程数据未包含可解析的正解；需核对当前课程 Network 响应格式");
  }

  // ======================== 导出 ========================

  window.welearnAPI = {
    isInIframe,
    extractPageInfo,
    fetchDataHtml,
    parseAnswers,
    parseReferenceExercises,
    parseRecordingReferences: parseReferenceExercises,
    autoFillAnswers,
    getAnswers,
  };

  console.log("[welearn-api] 模块已加载, iframe:", isInIframe());
})();
