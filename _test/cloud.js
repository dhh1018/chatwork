/* ============================================================
 * _test/cloud.js — 平台免密钥通道 + 通道路由 测试
 * 覆盖: SDK 初始化、模型选择、流式解析、system 消息强制、
 *       conversationId 传递、BYOK 覆盖、错误码翻译、识图模型解析
 * 运行: node _test/cloud.js
 * ============================================================ */
const fs = require('fs');
const vm = require('vm');

const DIR = 'F:/mygit/chatwork/xizuo-coach/';
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  FAIL  ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + '  (期望 ' + JSON.stringify(b) + ',实际 ' + JSON.stringify(a) + ')'); }
function has(s, sub, msg) { ok(String(s).indexOf(sub) !== -1, msg + '  (未找到「' + sub + '」)'); }

/* ---------- 伪造运行环境 ---------- */
global.window = global;

function memStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _dump: () => m
  };
}
global.localStorage = memStore();
global.sessionStorage = memStore();

/* ---------- 伪造平台 SDK ---------- */
const CP = { init: null, body: null, calls: 0, mode: 'ok', text: ['好', '的'], delay: 0 };

global.WorkBuddyCloud = {
  CLOUD_MODULE_PATHS: {},
  createWorkBuddyCloud(opts) {
    CP.init = opts;
    return {
      llm: {
        models: {
          list: async () => {
            if (CP.mode === 'listfail') { const e = new Error('boom'); e.error = { code: 'gateway_unavailable' }; throw e; }
            if (CP.mode === 'emptylist') return [];
            return [
              { id: 'off-model', disabled: true },
              { id: 'demo-text', name: '演示文本模型' },
              { id: 'demo-vision', name: '演示识图模型', supportsImages: true }
            ];
          }
        },
        chat: {
          completions: {
            create(body) {
              CP.body = body; CP.calls++;
              if (CP.mode === 'throw') {
                const e = new Error('quota'); e.error = { code: 'quota_rate_limited', message: 'rate limited' };
                throw e;
              }
              if (CP.mode === 'reject') {
                const e = new Error('async quota'); e.error = { code: 'quota_exhausted', message: 'exhausted' };
                return Promise.reject(e);
              }
              let i = 0;
              return {
                [Symbol.asyncIterator]() {
                  return {
                    next: async () => {
                      if (CP.mode === 'midfail' && i === 1) {
                        const e = new Error('down'); e.error = { code: 'gateway_stream_interrupted' };
                        throw e;
                      }
                      if (CP.delay) await new Promise(r => setTimeout(r, CP.delay));
                      if (i >= CP.text.length) return { value: undefined, done: true };
                      return { value: { choices: [{ delta: { content: CP.text[i++] } }] }, done: false };
                    }
                  };
                }
              };
            }
          }
        }
      }
    };
  }
};

/* 没有 SDK 的场景需要能单独验证,所以先记下原始引用 */
const REAL_SDK = global.WorkBuddyCloud;
function dropSdk() { delete global.WorkBuddyCloud; }
function restoreSdk() { global.WorkBuddyCloud = REAL_SDK; }

/* ---------- 载入被测脚本 ---------- */
function load(f) { vm.runInThisContext(fs.readFileSync(DIR + f, 'utf8'), { filename: f }); }
['kb.js', 'engine.js', 'cloud.js', 'llm.js'].forEach(load);

const CLOUD = global.XZ_CLOUD, LLM = global.XZ_LLM, KB = global.XZ_KB;
ok(!!CLOUD, 'cloud.js 已加载并导出 XZ_CLOUD');
ok(!!LLM, 'llm.js 已加载');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function () {
  console.log('\n===== 1. 平台通道:初始化与模型选择 =====');
  eq(CLOUD.hasSdk(), true, '检测到平台 SDK');
  eq(CLOUD.readySync(), false, '未拉取模型前不算就绪');

  const models = await CLOUD.loadModels();
  eq(models.length, 3, '拿到 3 个模型');
  eq(CLOUD.textModel(), 'demo-text', '文本模型跳过 disabled 项');
  eq(CLOUD.visionModel(), 'demo-vision', '识图模型取 supportsImages 的项');
  eq(CLOUD.readySync(), true, '拉取成功后平台通道就绪');
  eq(CP.init.endpoint, CLOUD.PUBLIC_CONFIG.endpoint, '客户端用 publicConfig.endpoint 初始化');
  eq(CP.init.publishableKey, CLOUD.PUBLIC_CONFIG.publishableKey, '客户端用 publicConfig.publishableKey 初始化');
  has(CP.init.endpoint, 'composition-coach', 'endpoint 与线上域名一致');

  console.log('\n===== 2. 通道路由:默认走平台 =====');
  let ch = LLM.channel();
  eq(ch.type, 'platform', '未配置密钥时走平台通道');
  eq(LLM.hasChannel(), true, '通道可用');
  has(LLM.statusText().text, '平台通道', '状态文案指明平台通道');

  console.log('\n===== 3. 平台流式生成 =====');
  const txt = await LLM.generateText({
    messages: [{ role: 'system', content: '你是批改助手' }, { role: 'user', content: '批改' }]
  });
  eq(txt, '好的', '流式增量拼成完整文本');
  eq(CP.body.stream, true, 'stream 必须为 true(平台不支持非流式)');
  eq(CP.body.messages[0].role, 'system', 'messages[0] 是 system');
  eq(CP.body.model, 'demo-text', '默认使用平台文本模型');

  const seen = [];
  await LLM.generateText({
    messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }],
    onDelta: d => seen.push(d)
  });
  eq(seen.join(''), '好的', 'onDelta 逐块回调');
  eq(CP.body.conversationId, undefined, '单轮任务不传 conversationId');

  console.log('\n===== 4. system 消息是硬约束 =====');
  let err = '';
  await LLM.generateText({ messages: [{ role: 'user', content: '没有 system' }] }).catch(e => { err = e.message; });
  has(err, 'system', '缺少 system 消息被拒绝');
  eq(CP.calls, 2, '被拒绝的请求没有真的发出去');

  console.log('\n===== 5. conversationId 用于多轮 =====');
  await LLM.generateText({
    messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }],
    conversationId: 'xz-demo-123'
  });
  eq(CP.body.conversationId, 'xz-demo-123', '多轮对话带上应用自持的会话 id');

  console.log('\n===== 6. 错误码翻译成人话 =====');
  CP.mode = 'throw';
  err = '';
  await LLM.generateText({ messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }] }).catch(e => { err = e.message; });
  has(err, '频繁', 'quota_rate_limited 提示稍后重试');
  ok(!/quota_rate_limited$/.test(err), '不把原始错误码直接甩给用户');
  eq(CLOUD.isQuota({ error: { code: 'quota_exhausted' } }), true, '识别额度类错误');

  /* SDK 也可能返回一个稍后 reject 的 Promise(鉴权、额度类错误常见形态)。
   * 这条路径同样要翻成人话,否则用户看到的是 SDK 的原始报错。 */
  CP.mode = 'reject';
  err = '';
  await LLM.generateText({ messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }] }).catch(e => { err = e.message; });
  has(err, '额度已用完', '异步 reject 的错误也翻成人话');
  ok(!/async quota/.test(err), '异步 reject 不把 SDK 原始报错甩给用户');
  CP.mode = 'ok';

  CP.mode = 'midfail';
  let partial = '';
  err = '';
  await LLM.generateText({
    messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }],
    onDelta: d => { partial += d; }
  }).catch(e => { err = e.message; partial = (e && e.partial) || partial; });
  has(err, '暂时不可用', '流中断也给人话');
  eq(partial, '好', '流中断时保留已生成内容');

  CP.mode = 'ok';
  CP.text = ['好', '的'];

  console.log('\n===== 7. 自带密钥优先于平台 =====');
  LLM.saveConfig({
    enabled: true, presetId: 'deepseek', baseUrl: 'https://api.example.com/v1',
    model: 'my-model', visionModel: '', temperature: 0.5, sessionOnly: false, apiKey: 'sk-abcdefghijklmn'
  });
  ch = LLM.channel();
  eq(ch.type, 'byok', '配好密钥后改走自带密钥通道');
  eq(LLM.statusText().text.indexOf('自带密钥') !== -1, true, '状态文案改为自带密钥');

  /* 自带密钥路径走 fetch,这里只验证它确实走了 fetch 而不是平台 */
  let fetched = null;
  global.fetch = (url, opt) => {
    fetched = { url, opt };
    return Promise.resolve({
      ok: true,
      headers: { get: () => 'text/event-stream' },
      body: {
        getReader: () => {
          let done = false;
          return { read: () => { if (done) return Promise.resolve({ done: true }); done = true; return Promise.resolve({ done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"自带"}}]}\n\n') }); } };
        }
      }
    });
  };
  const byokTxt = await LLM.generateText({
    messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]
  });
  eq(byokTxt, '自带', '自带密钥通道正常返回');
  has(fetched.url, 'api.example.com', '自带密钥通道直连用户填写的地址');
  var authHeader = fetched.opt.headers.Authorization || fetched.opt.headers.authorization;
  has(authHeader, 'Bearer sk-', '自带密钥通道带 Authorization 头');
  eq(CP.calls, 6, '自带密钥生效后没有再调用平台通道');

  console.log('\n===== 8. 密钥未填全时回落到平台 =====');
  LLM.saveConfig({ enabled: true, presetId: 'deepseek', baseUrl: 'https://api.example.com/v1', model: 'my-model', visionModel: '', temperature: 0.5, sessionOnly: false, apiKey: '' });
  eq(LLM.channel().type, 'platform', '勾了启用但没填密钥时回落到平台通道');
  LLM.clearKey();
  LLM.saveConfig({ enabled: false, presetId: 'deepseek', baseUrl: '', model: '', visionModel: '', temperature: 0.5, sessionOnly: false, apiKey: '' });

  console.log('\n===== 9. 识图模型解析 =====');
  eq(LLM.isVisionReady(), true, '平台有识图模型时识图就绪');
  has(LLM.visionStatusText().text, 'demo-vision', '状态里给出识图模型名');
  has(LLM.visionStatusText().text, '平台通道', '标明识图能力来自平台通道');

  CP.text = ['猫', '在', '睡觉'];
  const ocr = await LLM.ocrImage({ imageUrl: 'data:image/jpeg;base64,AAA', index: 1, total: 1 });
  eq(ocr.text, '猫在睡觉', '识图走平台识图模型');
  eq(CP.body.model, 'demo-vision', '识图请求用的是识图模型');
  eq(CP.body.messages[0].role, 'system', '识图请求同样以 system 开头');
  CP.text = ['好', '的'];

  console.log('\n===== 10. 平台没有识图模型时如实说明 =====');
  CLOUD.loadModels._cache = null;
  const saveModels = CLOUD.PUBLIC_CONFIG;
  /* 用一个只返回文本模型的 SDK 复现"无识图模型" */
  const backup = global.WorkBuddyCloud;
  global.WorkBuddyCloud = {
    createWorkBuddyCloud() {
      return {
        llm: {
          models: { list: async () => [{ id: 'only-text' }] },
          chat: { completions: { create() { return { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }) }; } } }
        }
      };
    }
  };
  delete require.cache;
  const fresh = { };
  vm.runInThisContext(fs.readFileSync(DIR + 'cloud.js', 'utf8'), { filename: 'cloud2.js' });
  const C2 = global.XZ_CLOUD;
  await C2.loadModels();
  eq(C2.visionModel(), '', '没有 supportsImages 的模型时识图模型为空');
  has(C2.statusText().text, '无识图模型', '状态里如实说明缺识图模型');
  global.WorkBuddyCloud = backup;
  vm.runInThisContext(fs.readFileSync(DIR + 'cloud.js', 'utf8'), { filename: 'cloud3.js' });
  await global.XZ_CLOUD.loadModels();

  console.log('\n===== 11. 模型列表为空必须显式处理 =====');
  const backup2 = global.WorkBuddyCloud;
  global.WorkBuddyCloud = {
    createWorkBuddyCloud() {
      return { llm: { models: { list: async () => [] }, chat: { completions: { create() { return { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }) }; } } } } };
    }
  };
  vm.runInThisContext(fs.readFileSync(DIR + 'cloud.js', 'utf8'), { filename: 'cloud4.js' });
  const C3 = global.XZ_CLOUD;
  await C3.loadModels();
  eq(C3.textModel(), '', '空列表 → 没有默认模型');
  let e2 = '';
  await C3.chat({ messages: [{ role: 'system', content: 's' }] }).catch(e => { e2 = e.message; });
  has(e2, '暂未提供可用模型', '空列表时报错清楚,不回退到硬编码模型名');
  global.WorkBuddyCloud = backup2;

  console.log('\n===== 12. SDK 未加载时不假装能用 =====');
  dropSdk();
  vm.runInThisContext(fs.readFileSync(DIR + 'cloud.js', 'utf8'), { filename: 'cloud5.js' });
  const C4 = global.XZ_CLOUD;
  eq(C4.hasSdk(), false, '未加载 SDK');
  eq(C4.readySync(), false, '未就绪');
  has(C4.statusText().text, '未加载', '如实提示脚本未加载');
  err = '';
  await C4.loadModels().catch(e => { err = e.message; });
  has(err, '未加载', '拉模型失败时给出可执行的提示');
  restoreSdk();

  console.log('\n===== 13. 无任何通道时的行为 =====');
  /* 重新载入 llm.js 前把 cloud 就绪状态清掉:用无模型的 cloud */
  vm.runInThisContext(fs.readFileSync(DIR + 'cloud.js', 'utf8'), { filename: 'cloud6.js' });
  const C5 = global.XZ_CLOUD;
  await C5.loadModels();
  LLM.saveConfig({ enabled: false, presetId: 'deepseek', baseUrl: '', model: '', visionModel: '', temperature: 0.5, sessionOnly: false, apiKey: '' });
  eq(LLM.hasChannel(), true, '平台通道恢复后通道可用');

  console.log('\n==============================');
  console.log('通过 ' + pass + ' / 失败 ' + fail + '  (共 ' + (pass + fail) + ' 项)');
  console.log('==============================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('\n测试脚本异常: ' + (e && e.stack || e)); process.exit(1); });
