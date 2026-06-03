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

  if (request.action === 'fetchUnipusCrossOrigin') {
    fetchUnipusAPI(request.url, request.options)
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

  let url = baseUrl.replace(/\/$/, '');
  if (!url.endsWith('/chat/completions')) {
    url += '/chat/completions';
  }

  const systemPrompts = {
    answer: '你是一个专业的答题助手。给出准确答案，只返回JSON。',
    analyze: '你是一个专业的网页结构分析助手。识别题目结构，只返回JSON，不要返回答案。',
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompts[mode] || systemPrompts.answer },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error('API请求失败 (' + response.status + '): ' + errorText.substring(0, 200));
  }

  const data = await response.json();
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('API返回格式错误');
  }

  return data.choices[0].message.content;
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
