// Background Service Worker
// Handles API calls to avoid CORS issues

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'callAI') {
    callAI(request.config, request.prompt, 'answer')
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'analyzeHTML') {
    callAI(request.config, request.prompt, 'analyze')
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'generateReferenceScript') {
    callAI(request.config, request.prompt, 'reference')
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'fetchUnipusCrossOrigin') {
    fetchUnipusAPI(request.url, request.options)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'fetchWelearnData') {
    fetchWelearnData(request.url, sender)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'trackStats') {
    sendStats(request.event).then(() => sendResponse({ success: true }));
    return true;
  }
});

async function callAI(config, prompt, mode) {
  const { baseUrl, apiKey, model } = config;

  if (!baseUrl || !apiKey || !model) throw new Error('请先配置 AI 模型和 API Key');

  let url = baseUrl.replace(/\/$/, '');
  if (!url.endsWith('/chat/completions')) {
    url += '/chat/completions';
  }

  const systemPrompts = {
    answer: '你是一个专业的答题助手。给出准确答案，只返回JSON。',
    analyze: '你是一个专业的网页结构分析助手。识别题目结构，只返回JSON，不要返回答案。',
    reference: '你是英语练习助手。题目不一定需要录音。依据每道题的具体问题和课程参考文本，生成用户能照读或参考的简短英语示例答案。每题单独回答；参考表达中用斜杠分隔的选项须选择一种连贯组合。个人经历只能作为虚构示例，不得声称是真实经历。角色扮演分别给出 A、B 台词，保持原对话事实与顺序。参考文本不是课程官方标准答案。只返回 JSON 对象，格式示例：{"sections":[{"title":"问题 1","role":"","lines":["I had a bad cold last month."]}]}。',
  };

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompts[mode] || systemPrompts.answer },
      { role: 'user', content: prompt },
    ],
  };
  if (mode === 'reference' && new URL(url).hostname === 'api.deepseek.com') {
    body.response_format = { type: 'json_object' };
    body.thinking = { type: 'disabled' };
    body.max_tokens = 4096;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error('API请求失败 (' + response.status + '): ' + errorText.substring(0, 200));
  }

  const data = await response.json();
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('API返回格式错误');
  }

  const content = data.choices[0].message.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('AI 返回空内容，请重试');
  }
  return content;
}

async function fetchUnipusAPI(url, options) {
  options = options || {};
  const resp = await fetch(url, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body || undefined,
  });
  if (!resp.ok) {
    throw new Error('Unipus API error: ' + resp.status);
  }
  return await resp.json();
}

async function fetchWelearnData(rawUrl, sender) {
  const source = new URL(sender.url || 'https://invalid.local/');
  if (source.protocol !== 'https:' ||
      !['welearn.sflep.com', 'centercourseware.sflep.com'].includes(source.hostname)) {
    throw new Error('WE Learn 请求来源不受支持');
  }
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'centercourseware.sflep.com' ||
      url.port || !/\/data\/.+\.html$/i.test(url.pathname) ||
      url.pathname.split('/').map(decodeURIComponent).some(part => part === '.' || part === '..') ||
      url.username || url.password) {
    throw new Error('WE Learn 数据 URL 不受支持');
  }
  const response = await fetch(url.href, { credentials: 'include', redirect: 'error' });
  if (!response.ok) throw new Error('WE Learn 数据请求失败: HTTP ' + response.status);
  return response.text();
}

async function sendStats(event) {
  try {
    await fetch('https://d.yikfun.de5.net/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: event }),
    });
  } catch (e) {
    // 静默失败
  }
}
