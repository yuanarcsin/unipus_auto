// Background Service Worker
// Handles API calls to avoid CORS issues

// 初始化
chrome.runtime.onInstalled.addListener(() => {
  // 设置侧边栏行为：点击图标时打开侧边栏
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// 点击插件图标时打开侧边栏
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'callAI') {
    callAI(request.config, request.prompt, 'answer')
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === 'analyzeHTML') {
    callAI(request.config, request.prompt, 'analyze')
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function callAI(config, prompt, mode = 'answer') {
  const { baseUrl, apiKey, model } = config;

  // 如果baseUrl不包含完整路径，添加/chat/completions
  let url = baseUrl.replace(/\/$/, '');
  if (!url.endsWith('/chat/completions')) {
    url += '/chat/completions';
  }
  
  // 根据模式选择不同的系统提示
  const systemPrompts = {
    answer: `你是一个专业的答题助手。用户会给你题目，你需要分析题目并给出正确答案。

请严格按照以下JSON格式返回答案：
{
  "type": "single|multiple|fill",
  "answer": "答案内容",
  "explanation": "简短解释"
}

对于不同题型的答案格式：
- 单选题(single): answer为选项字母，如 "A" 或 "B"
- 多选题(multiple): answer为选项字母数组，如 ["A", "B", "C"]
- 填空题(fill): answer为填空内容，如果有多个空，用数组表示 ["答案1", "答案2"]

注意：
1. 只返回JSON，不要有其他内容
2. 确保JSON格式正确
3. 答案要准确`,

    analyze: `你是一个专业的网页结构分析助手。你需要分析HTML页面结构，识别其中的题目结构（单选题、多选题、填空题）。

【重要】这一步只需要识别题目结构，不需要给出答案！

分析要点：
1. 识别所有题目，提取完整的题干文本
2. 识别每道题的选项或输入框
3. 为每个可交互元素（选项、输入框）生成精确的CSS选择器
4. 不要分析答案，答案会在后续步骤单独获取

只返回JSON格式，不要有其他内容。确保JSON格式正确。`
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: systemPrompts[mode] || systemPrompts.answer
        },
        {
          role: 'user',
          content: prompt
        }
      ],
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMsg = `API请求失败 (${response.status})`;
    
    // 打印详细错误到控制台
    console.error('[AI答题助手] API请求失败:', {
      status: response.status,
      statusText: response.statusText,
      url: url,
      response: errorText
    });
    
    // 解析错误信息
    try {
      const errorJson = JSON.parse(errorText);
      const msg = errorJson.error?.message || errorJson.message || '';
      
      console.error('[AI答题助手] 解析后的错误:', errorJson);
      
      if (response.status === 401) {
        errorMsg = 'API Key无效，请检查配置';
      } else if (response.status === 403) {
        errorMsg = 'API访问被拒绝，请检查: 1)API Key是否有效 2)账户是否有余额 3)API服务是否正常';
      } else if (response.status === 429) {
        errorMsg = 'API请求过于频繁，请稍后重试';
      } else if (response.status === 500 || response.status === 502 || response.status === 503) {
        errorMsg = 'API服务暂时不可用，请稍后重试';
      } else if (msg) {
        errorMsg = `API错误: ${msg}`;
      }
    } catch (e) {
      // 无法解析JSON，使用原始错误
      console.error('[AI答题助手] 无法解析错误响应:', errorText);
    }
    
    throw new Error(errorMsg);
  }

  const data = await response.json();
  
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('API返回格式错误');
  }

  return data.choices[0].message.content;
}

// 发送统计事件
async function sendStats(event) {
  try {
    await fetch('https://d.yikfun.de5.net/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event })
    });
  } catch (e) {
    // 静默失败，不影响主功能
  }
}

// 监听统计事件
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'trackStats') {
    sendStats(request.event).then(() => sendResponse({ success: true }));
    return true;
  }
});
