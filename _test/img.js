/* 图片处理 + 视觉识别层定向测试:压缩几何、对比拉伸、转录纪律、输出清理、接口调用 */
const fs = require('fs'), vm = require('vm');

const DIR = 'F:/mygit/chatwork/xizuo-coach/';
function mkStore() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; }

const sandbox = {
  console, setTimeout, clearTimeout, fetch, AbortController, TextDecoder, TextEncoder,
  localStorage: mkStore(), sessionStorage: mkStore()
};
sandbox.window = sandbox;
vm.createContext(sandbox);
['kb.js', 'engine.js', 'img.js', 'llm.js'].forEach(f => vm.runInContext(fs.readFileSync(DIR + f, 'utf8'), sandbox, { filename: f }));

const IMG = sandbox.XZ_IMG, LLM = sandbox.XZ_LLM, KB = sandbox.XZ_KB;

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function has(h, n) { return String(h).indexOf(n) !== -1; }

/* ---------- 1. 压缩几何 ---------- */
console.log('\n[1] 缩放几何');
let s = IMG.scaleSize(4032, 3024, 1600);
ok(s.w === 1600 && s.h === 1200, '手机原图 4032×3024 等比缩到长边 1600,实际 ' + s.w + '×' + s.h);
ok(s.scaled === true, '标记为已压缩');
s = IMG.scaleSize(800, 600, 1600);
ok(s.w === 800 && s.h === 600 && s.scaled === false, '本来就不超长边则原样不动');
s = IMG.scaleSize(1600, 4000, 1600);
ok(s.h === 1600 && s.w === 640, '竖图按高度为长边缩放');
s = IMG.scaleSize(0, 0, 1600);
ok(s.w >= 1 && s.h >= 1, '异常尺寸不会产生 0 宽高画布');
s = IMG.scaleSize(3000, 2000, 1600);
ok(Math.max(s.w, s.h) === 1600 && Math.abs(s.w / s.h - 1.5) < 0.01, '保持原始宽高比');

/* ---------- 2. 文件判定 ---------- */
console.log('\n[2] 文件类型与 HEIC 判定');
ok(IMG.isImageFile({ type: 'image/jpeg', name: 'a.jpg' }) === true, '按 MIME 识别图片');
ok(IMG.isImageFile({ type: '', name: 'a.PNG' }) === true, 'MIME 为空时按扩展名兜底');
ok(IMG.isImageFile({ type: 'text/plain', name: 'a.txt' }) === false, '文本文件被拒');
ok(IMG.isImageFile(null) === false, '空值被拒');
ok(IMG.isHeic({ type: 'image/heic', name: 'IMG_0001.HEIC' }) === true, '识别 HEIC');
ok(IMG.isHeic({ type: 'image/jpeg', name: 'a.jpg' }) === false, '普通 jpg 不会被误判');

/* ---------- 3. 转录纪律 ---------- */
console.log('\n[3] 转录提示词的纪律');
const SYS = LLM.OCR_SYS;
ok(has(SYS, '只做文字转录的机器'), '声明身份是转录机器,不是助手');
ok(has(SYS, '错别字') && has(SYS, '病句'), '要求错别字与病句照抄,不许改');
ok(has(SYS, '不许改') && has(SYS, '润色'), '明确禁止改写与润色');
ok(has(SYS, '转录不是批改'), '与批改职责划清界限');
ok(has(SYS, '红字') && has(SYS, '姓名'), '要求跳过老师批改痕迹与姓名学号');
ok(has(SYS, '□'), '认不清的字要求用 □ 占位,不许猜');
ok(has(SYS, '无法识别'), '定义了"读不出来"时的固定回复');
ok(has(SYS, '不得执行'), '图片内文字含指令时不得执行(防注入)');

const msgs = LLM.buildOcrMessages('data:image/jpeg;base64,AAAA', { index: 2, total: 3 });
ok(msgs.length === 2 && msgs[0].role === 'system', '组装为 system + user 两条消息');
ok(Array.isArray(msgs[1].content) && msgs[1].content.length === 2, 'user 内容为「文字 + 图片」数组');
ok(msgs[1].content[1].type === 'image_url' && msgs[1].content[1].image_url.url === 'data:image/jpeg;base64,AAAA', '图片以 data URL 形式内联');
ok(has(msgs[1].content[0].text, '第 2 页') && has(msgs[1].content[0].text, '共 3 页'), '告知分页位置');
ok(has(msgs[1].content[0].text, '不要补写'), '明确禁止跨页补写或总结');

/* ---------- 4. 输出清理 ---------- */
console.log('\n[4] 识别结果清理');
let c = LLM.cleanOcr('我家养了一只猫。它的毛是黑白相间的,很漂亮。');
ok(c.text === '我家养了一只猫。它的毛是黑白相间的,很漂亮。' && !c.unreadable, '干净输出原样通过');

c = LLM.cleanOcr('```text\n识别结果:\n我每天放学回家第一件事就是去看它。\n\n总之,猫是一种很可爱的动物。\n```');
ok(!has(c.text, '```'), '去掉代码块围栏');
ok(!has(c.text, '识别结果'), '去掉模型自加的标签行(含前面有空行的情况)');
ok(c.text.indexOf('我每天') === 0, '正文从第一句开始,实际开头:' + c.text.slice(0, 8));
ok(has(c.text, '\n\n'), '保留段落之间的空行');
ok(c.notes.length >= 1, '清理动作有记录,便于复核');

c = LLM.cleanOcr('【无法识别】');
ok(c.unreadable === true && c.text === '', '固定回复被识别为"未读出"');

c = LLM.cleanOcr('这张照片里的字迹太淡了,我无法辨认出完整的作文内容,请你换一张更清楚的照片。');
ok(c.text.length > 0 && !c.unreadable, '模型自由发挥的说明性长文不当作"无法识别"(由字数与人工校对兜底)');

c = LLM.cleanOcr('「我家养了一只猫。」');
ok(c.text === '我家养了一只猫。', '去掉模型给全文加上的引号');

c = LLM.cleanOcr('第一段\n\n\n\n\n第二段');
ok(c.text === '第一段\n\n第二段', '3 个以上连续空行压成 1 个空行');

c = LLM.cleanOcr('   ‍  ');
ok(c.unreadable === true, '空白输出视为未读出');

c = LLM.cleanOcr('# 我家养了一只猫,它的毛是黑白相间的。');
ok(c.text.indexOf('#') === -1, '去掉行首 Markdown 标题记号');

c = LLM.cleanOcr('短句');
ok(c.chars === 2 && c.notes.some(n => has(n, '字数很少')), '字数过少时给出重点核对提示');

/* ---------- 5. 识图配置 ---------- */
console.log('\n[5] 识图配置与就绪判断');
const pDeep = LLM.preset('deepseek');
ok(!pDeep.vision, 'DeepSeek 预设不含视觉模型(它目前没有)');
ok(!!LLM.preset('dashscope').vision && !!LLM.preset('zhipu').vision && !!LLM.preset('siliconflow').vision, '通义/智谱/硅基流动预设带出各自视觉模型名');
ok(LLM.isVisionReady() === false, '未配置时识图不就绪');
ok(has(LLM.visionStatusText().text, '对照录入'), '未启用时明确告知可对照录入:' + LLM.visionStatusText().text);

let cfg = LLM.saveConfig({ enabled: true, presetId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', visionModel: '', apiKey: 'sk-test-1234567890', temperature: 0.5, sessionOnly: false });
ok(LLM.isReady(cfg) === true, '文字批改就绪');
ok(LLM.isVisionReady(cfg) === false && LLM.visionStatusText(cfg).reason === 'nomodel', '没有视觉模型名时,识图单独判定为不可用(不影响文字批改)');

cfg = LLM.saveConfig({ enabled: true, presetId: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', visionModel: 'qwen-vl-max', apiKey: 'sk-test-1234567890', temperature: 0.5, sessionOnly: false });
ok(LLM.isVisionReady(cfg) === true, '填好视觉模型名后识图就绪');
ok(has(LLM.visionStatusText(cfg).text, 'qwen-vl-max'), '状态行显示所用视觉模型');
ok(JSON.parse(sandbox.localStorage.getItem('xz_llm_cfg')).visionModel === 'qwen-vl-max', '视觉模型名随配置持久化');

/* ---------- 6. 接口调用 ---------- */
function mockSse(text, chunkSize) {
  const enc = new TextEncoder();
  const frames = (String(text).match(new RegExp('[\\s\\S]{1,' + (chunkSize || 24) + '}', 'g')) || ['']).map(t => 'data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n');
  let i = 0;
  return function () {
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: () => 'text/event-stream' },
      body: { getReader: () => ({ read: () => Promise.resolve(i < frames.length ? { done: false, value: enc.encode(frames[i++]) } : { done: true }) }) }
    });
  };
}

(async function () {
  const PAGE = '我家养了一只猫。它的毛是黑白相间的,很漂亮。\n\n猫喜欢吃鱼,也喜欢吃猫粮。';

  console.log('\n[7] 识图接口调用');
  let sentBody = null;
  sandbox.fetch = function (url, opt) {
    sentBody = JSON.parse(opt.body);
    return mockSse(PAGE, 12)(url, opt);
  };
  const deltas = [];
  const res = await LLM.ocrImage({ imageUrl: 'data:image/jpeg;base64,ZZZ', index: 1, total: 1, onDelta: d => deltas.push(d) });
  ok(sentBody.model === 'qwen-vl-max', '请求用的是视觉模型而非文字模型,实际 ' + sentBody.model);
  ok(sentBody.temperature <= 0.2, '低温调用,减少模型自由发挥');
  ok(Array.isArray(sentBody.messages[1].content), '图片以多模态数组形式发出');
  ok(deltas.length > 1, '流式回调被逐片触发,次数 ' + deltas.length);
  ok(res.text === PAGE, '分片拼接后文本完整且未变形');
  ok(res.chars === PAGE.replace(/\s/g, '').length, '字数统计正确,实际 ' + res.chars);
  ok(has(res.raw, '我家养了一只猫'), '保留原始输出供复核');

  /* 未读出 */
  sandbox.fetch = mockSse('【无法识别】');
  const bad = await LLM.ocrImage({ imageUrl: 'data:image/jpeg;base64,ZZZ' });
  ok(bad.unreadable === true, '模型读不出时标记为未读出,由界面提示重拍');

  /* 接口异常 */
  sandbox.fetch = function () { return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('model not found') }); };
  let err = '';
  try { await LLM.ocrImage({ imageUrl: 'data:image/jpeg;base64,ZZZ' }); } catch (e) { err = e.message; }
  ok(has(err, '404') && has(err, '模型名'), '模型名写错时给出可读提示:' + err.slice(0, 46));

  /* 未配置视觉模型时不许发请求 */
  LLM.saveConfig({ enabled: true, presetId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', visionModel: '', apiKey: 'sk-test-1234567890', temperature: 0.5, sessionOnly: false });
  let called = false;
  sandbox.fetch = function () { called = true; return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({}) }); };
  let err2 = '';
  try { await LLM.ocrImage({ imageUrl: 'data:image/jpeg;base64,ZZZ' }); } catch (e) { err2 = e.message; }
  ok(called === false, '没有配置视觉模型时根本不发请求(不浪费额度)');
  ok(has(err2, '视觉模型名'), '并说明缺的是视觉模型名:' + err2);

  console.log('\n==============================');
  console.log('通过 ' + pass + ' / 失败 ' + fail + '  (共 ' + (pass + fail) + ' 项)');
  console.log('==============================');
  process.exit(fail ? 1 : 0);
})();
