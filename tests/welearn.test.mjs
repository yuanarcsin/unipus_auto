import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const extension = new URL('../AutoUnipus/extension/', import.meta.url);
const template = JSON.parse(readFileSync(new URL('templates/welearn.json', extension)));

test('WE Learn template matches the main site and courseware frame', () => {
  const window = { location: { href: 'https://welearn.sflep.com/' } };
  runInNewContext(readFileSync(new URL('modules/site-matcher.js', extension), 'utf8'),
    { window, URL, console });
  window.siteMatcher.registerTemplate(template);
  assert.equal(window.siteMatcher.matchTemplate('https://welearn.sflep.com/Student/Study.aspx')?.siteId, 'welearn');
  assert.equal(window.siteMatcher.matchTemplate('https://centercourseware.sflep.com/book/index.html#/10/4-1')?.siteId, 'welearn');
  assert.equal(window.siteMatcher.matchTemplate('https://notwelearn.sflep.com/'), null);
});

test('background proxy only reads WE Learn course data HTML', async () => {
  const requests = [];
  const chrome = {
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
    action: { onClicked: { addListener() {} } },
    sidePanel: { setPanelBehavior() {} },
  };
  const context = { chrome, URL, console, fetch: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, text: async () => '<tab></tab>' };
  } };
  runInNewContext(readFileSync(new URL('background.js', extension), 'utf8'), context);
  const sender = { url: 'https://welearn.sflep.com/Student/Study.aspx' };
  const valid = 'https://centercourseware.sflep.com/book/data/10/4-1.html';
  assert.equal(await context.fetchWelearnData(valid, sender), '<tab></tab>');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.credentials, 'include');
  await assert.rejects(context.fetchWelearnData('https://example.org/data/1.html', sender));
  await assert.rejects(context.fetchWelearnData('https://centercourseware.sflep.com/private/1.html', sender));
  await assert.rejects(context.fetchWelearnData(valid, { url: 'https://example.org/' }));
  assert.equal(requests.length, 1);
});

test('DeepSeek reference requests use the documented JSON chat mode', async () => {
  const requests = [];
  const chrome = {
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
    action: { onClicked: { addListener() {} } },
    sidePanel: { setPanelBehavior() {} },
  };
  const context = { chrome, URL, console, fetch: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ choices: [
      { message: { content: '{"sections":[{"title":"问题 1","role":"","lines":["I feel better."]}]}' } },
    ] }) };
  } };
  runInNewContext(readFileSync(new URL('background.js', extension), 'utf8'), context);
  const result = await context.callAI({ baseUrl: 'https://api.deepseek.com',
    apiKey: 'test-key', model: 'deepseek-flash' }, 'sample prompt', 'reference');
  assert.match(result, /I feel better/);
  assert.equal(requests[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.model, 'deepseek-flash');
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(body.thinking.type, 'disabled');
  assert.equal(body.max_tokens, 4096);
  assert.match(body.messages[0].content, /JSON/);
});

test('Unit 4 mixed choice tabs fill the intended options in order', () => {
  const clicks = Array.from({ length: 6 }, (_, group) =>
    Array.from({ length: group === 0 ? 7 : 4 }, () => 0));
  const choices = clicks.map((group, choiceIndex) => ({
    querySelector(selector) {
      if (selector !== 'ol') return null;
      return { querySelectorAll() {
        return group.map((_, optionIndex) => ({
          click() { clicks[choiceIndex][optionIndex]++; },
        }));
      } };
    },
  }));
  const stem = { querySelectorAll(selector) {
    return selector === 'et-choice' ? choices : [];
  } };
  const window = { location: { hostname: 'centercourseware.sflep.com', hash: '#/4/2-2' } };
  const document = { querySelectorAll(selector) {
    return selector === 'et-stem' ? [stem] : [];
  } };
  runInNewContext(readFileSync(new URL('modules/welearn-api.js', extension), 'utf8'),
    { window, document, console, NodeList: class {}, HTMLCollection: class {} });
  const answers = [
    { type: 'multiple', indexes: [0, 2, 3, 5, 6] },
    { type: 'multiple', indexes: [1] },
    { type: 'multiple', indexes: [0] },
    { type: 'single', key: 'C' },
    { type: 'single', key: 'B' },
    { type: 'single', key: 'D' },
  ];
  const result = window.welearnAPI.autoFillAnswers(answers);
  assert.equal(result.clicked, 6);
  assert.equal(result.total, 6);
  assert.equal(clicks[0].join(','), '1,0,1,1,0,1,1');
  assert.equal(clicks[1][1], 1);
  assert.equal(clicks[2][0], 1);
  assert.equal(clicks[3][2], 1);
  assert.equal(clicks[4][1], 1);
  assert.equal(clicks[5][3], 1);
});

test('Unit 4 fill and true/false controls receive the intended input', () => {
  class Input {
    constructor() { this.tagName = 'INPUT'; this.events = []; }
    get value() { return this._value || ''; }
    set value(value) { this._value = value; }
    dispatchEvent(event) { this.events.push(event.type); }
  }
  class Event { constructor(type) { this.type = type; } }
  const input = new Input();
  const tofClicks = [0, 0];
  const stem = { querySelectorAll(selector) {
    if (selector === 'et-blank') return [{ querySelector() { return input; } }];
    if (selector === 'et-tof') return [{ querySelectorAll() {
      return [0, 1].map((index) => ({ click() { tofClicks[index]++; } }));
    } }];
    return [];
  } };
  const window = {
    location: { hostname: 'centercourseware.sflep.com', hash: '#/4/2-3' },
    HTMLInputElement: Input,
  };
  const document = { querySelectorAll(selector) {
    return selector === 'et-stem' ? [stem] : [];
  } };
  runInNewContext(readFileSync(new URL('modules/welearn-api.js', extension), 'utf8'),
    { window, document, Event, console, NodeList: class {}, HTMLCollection: class {} });
  const result = window.welearnAPI.autoFillAnswers([
    { type: 'fill', answers: ['exercise', 'walking'] },
    { type: 'tof', key: 'T', answers: ['True'] },
  ]);
  assert.equal(result.clicked, 2);
  assert.equal(input.value, 'exercise');
  assert.equal(input.events.join(','), 'input,change');
  assert.equal(tofClicks.join(','), '1,0');
});

test('text reference exercises generate a preview without filling any answer', async () => {
  const reference = { type: 'open_ended', title: '问题 1',
    instruction: 'Write a short response.',
    prompts: ['How do you stay healthy?'],
    lines: ['I exercise regularly.'] };
  const sent = [];
  let listener;
  let fillCount = 0;
  let finish;
  const preview = new Promise((resolve) => { finish = resolve; });
  const chrome = { runtime: {
    onMessage: { addListener(fn) { listener = fn; } },
    sendMessage(message, callback) {
      sent.push(message);
      if (message.action === 'generateReferenceScript') {
        callback({ success: true, data: JSON.stringify({ sections: [
          { title: '问题 1', role: '', lines: ['I exercise regularly to stay healthy.'] },
        ] }) });
      }
      if (message.type === 'referenceScripts') finish(message);
    },
  } };
  const window = { location: { href: 'https://centercourseware.sflep.com/book/index.html#/4/2-1' },
    addEventListener() {},
    siteMatcher: { matchTemplate: () => ({ siteId: 'welearn' }) },
    templateManager: { _initialized: true, async init() {}, async updateStats() {} },
    welearnAPI: { async getAnswers() { return { answers: [], references: [reference] }; },
      autoFillAnswers() { fillCount++; } },
  };
  const document = { body: {}, addEventListener() {} };
  class MutationObserver { observe() {} }
  runInNewContext(readFileSync(new URL('content.js', extension), 'utf8'),
    { chrome, window, document, MutationObserver, console, URL, setTimeout });
  listener({ action: 'start', config: { baseUrl: 'https://api.deepseek.com',
    apiKey: 'test-key', model: 'deepseek-flash' } }, {}, () => {});
  const result = await preview;
  assert.equal(result.aiGenerated, true);
  assert.equal(result.hasKeyedAnswers, false);
  assert.equal(result.sections[0].lines[0], 'I exercise regularly to stay healthy.');
  assert.equal(fillCount, 0);
  const request = sent.find((message) => message.action === 'generateReferenceScript');
  const input = JSON.parse(request.prompt);
  assert.equal(input.exercises[0].questions[0], 'How do you stay healthy?');
  assert.equal(input.exercises[0].referenceText[0], 'I exercise regularly.');
  assert.equal(sent.some((message) => message.type === 'complete'), false);
});

test('reference preview panel shows the question, source text and AI sample', async () => {
  const elements = new Map();
  const makeElement = () => ({ textContent: '', hidden: true, innerHTML: '',
    className: '', scrollTop: 0, scrollHeight: 0,
    classList: { add() {}, remove() {} },
    addEventListener() {}, append() {}, appendChild() {}, scrollIntoView() {} });
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    addEventListener() {}, createElement: makeElement, querySelectorAll() { return []; },
  };
  let listener;
  const chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    storage: { sync: { async get() { return {}; } } } };
  const context = { document, chrome, window: { location: {} }, navigator: {}, console, URL };
  runInNewContext(readFileSync(new URL('popup.js', extension), 'utf8'), context);
  await context.renderModelList();
  const modelList = elements.get('modelList').innerHTML;
  assert.match(modelList, /deepseek-flash/);
  assert.match(modelList, /edit-model-btn/);
  assert.doesNotMatch(modelList, /delete-model-btn/);
  listener({ type: 'referenceScripts', aiGenerated: true,
    references: [{ type: 'open_ended', title: '问题 1',
      instruction: 'Write a short response.',
      prompts: ['How do you stay healthy?'],
      lines: ['I exercise regularly.'] }],
    sections: [{ title: '问题 1', role: '', lines: ['I exercise every day.'] }],
  });
  const preview = elements.get('recordingContent').textContent;
  assert.equal(elements.get('recordingPanel').hidden, false);
  assert.match(preview, /How do you stay healthy\?/);
  assert.match(preview, /I exercise regularly\./);
  assert.match(preview, /I exercise every day\./);
  assert.equal(elements.get('statusText').textContent, '示例稿已生成');
});
