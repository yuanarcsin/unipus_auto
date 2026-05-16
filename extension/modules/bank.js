// 题库模块 — chrome.storage.local 存储题目→答案映射
// Key format: "qbank|{siteId}|{qHash}"
// qHash = first 40 chars of question text, stripped
(function () {
  "use strict";

  const STORAGE_KEY = "qbank";
  const MAX_ENTRIES = 2000;

  function qHash(text) {
    return (text || "").replace(/\s+/g, " ").trim().substring(0, 40);
  }

  function makeKey(siteId, text) {
    return `qbank|${siteId || "unknown"}|${qHash(text)}`;
  }

  async function loadBank() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data[STORAGE_KEY] || {};
  }

  async function saveBank(bank) {
    // 限制条数
    const keys = Object.keys(bank);
    if (keys.length > MAX_ENTRIES) {
      const sorted = keys.sort((a, b) => (bank[b].ts || 0) - (bank[a].ts || 0));
      for (const k of sorted.slice(0, keys.length - MAX_ENTRIES)) {
        delete bank[k];
      }
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: bank });
  }

  // 查题库
  async function query(siteId, questionText) {
    const bank = await loadBank();
    const key = makeKey(siteId, questionText);

    // 精确匹配
    if (bank[key]) return bank[key];

    // 模糊匹配（前30字符相同）
    const prefix = qHash(questionText).substring(0, 30);
    for (const [k, v] of Object.entries(bank)) {
      if (k.includes(prefix)) {
        console.log("[题库] 模糊匹配:", k);
        return v;
      }
    }
    return null;
  }

  // 存入题库
  async function store(siteId, questionText, answer, questionType) {
    const bank = await loadBank();
    const key = makeKey(siteId, questionText);
    bank[key] = {
      question: questionText.substring(0, 200),
      type: questionType,
      answer: answer,
      ts: Date.now(),
    };
    await saveBank(bank);
    console.log("[题库] 已存入:", key.substring(0, 60));
  }

  // 删除
  async function remove(siteId, questionText) {
    const bank = await loadBank();
    const key = makeKey(siteId, questionText);
    delete bank[key];
    await saveBank(bank);
  }

  // 导出 JSON
  async function exportBank() {
    const bank = await loadBank();
    return JSON.stringify(bank, null, 2);
  }

  // 导入 JSON
  async function importBank(jsonStr) {
    const data = JSON.parse(jsonStr);
    const bank = await loadBank();
    Object.assign(bank, data);
    await saveBank(bank);
    return Object.keys(data).length;
  }

  // 获取数量
  async function count() {
    const bank = await loadBank();
    return Object.keys(bank).length;
  }

  // 清空
  async function clear() {
    await chrome.storage.local.remove(STORAGE_KEY);
  }

  // 暴露到 window
  window.questionBank = {
    query,
    store,
    remove,
    exportBank,
    importBank,
    count,
    clear,
  };

  console.log("[题库] 模块已加载");
})();
