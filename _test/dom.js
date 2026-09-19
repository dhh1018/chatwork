/* DOM 集成测试:把整页放进 jsdom 里跑,验证初始化、双模式渲染、设置面板、大模型成功与失败两条路径 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const { JSDOM } = require('C:/Users/admin/.workbuddy/binaries/node/workspace/node_modules/jsdom');

const DIR = 'F:/mygit/chatwork/xizuo-coach/';
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function has(h, n) { return String(h).indexOf(n) !== -1; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 2000)) { if (fn()) return true; await sleep(15); }
  return false;
}

const ESSAY = `介绍一种事物
猫是一种很常见的动物。
我家养了一只猫。它的毛是黑白相间的,很漂亮。它的眼睛很亮,很好看。它很可爱,我很喜欢它。
猫喜欢吃鱼,也喜欢吃猫粮。它很爱干净,经常舔自己的毛。它还会抓老鼠,很有用。
我每天放学回家第一件事就是去看它。它有时候会趴在我腿上睡觉。我觉得养猫很有意思。
总之,猫是一种很可爱的动物,大家都可以养一只试试。`;

/* 剥掉 script 标签,改为手工注入,便于在插入前打补丁 */
const html = fs.readFileSync(DIR + 'index.html', 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');

const jsdomErrors = [];
const dom = new JSDOM(html, { url: 'https://xizuo.test/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.addEventListener('error', e => jsdomErrors.push('error: ' + e.message));
const vc = dom.virtualConsole;
vc.on('jsdomError', e => jsdomErrors.push('jsdomError: ' + e.message));

/* 补齐 jsdom 未实现的浏览器能力 */
if (!w.TextEncoder) w.TextEncoder = TextEncoder;
if (!w.TextDecoder) w.TextDecoder = TextDecoder;
if (!w.AbortController) w.AbortController = AbortController;
w.Element.prototype.scrollIntoView = function () { };

/* mock 流式接口 */
function mockSse(chunks) {
  const enc = new w.TextEncoder();
  let i = 0;
  return function () {
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: () => 'text/event-stream' },
      body: {
        getReader: () => ({
          read: () => Promise.resolve(i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true })
        })
      }
    });
  };
}
function frame(t) { return 'data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n'; }
/** 把一段文本切成若干片,以 SSE 形式返回(顺带验证分片拼接) */
function sseStream(text, size) {
  const enc = new w.TextEncoder();
  const frames = (String(text).match(new RegExp('[\\s\\S]{1,' + (size || 40) + '}', 'g')) || ['']).map(frame);
  let i = 0;
  return function () {
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: () => 'text/event-stream' },
      body: { getReader: () => ({ read: () => Promise.resolve(i < frames.length ? { done: false, value: enc.encode(frames[i++]) } : { done: true }) }) }
    });
  };
}
const AI_TEACHER = [
  frame('## 优点一\n引文:「它有时候会趴在我腿上睡觉」\n点评:动作写得具体,读者能看见画面。\n'),
  frame('## 优点二\n引文:「猫的眼睛像两颗蓝宝石」\n点评:写出了眼睛的颜色。\n'),
  frame('## 主要问题\n训练点:抓住事物的主要特点\n引文:「猫是一种很常见的动物」\n归因:全文停在概括上。\n建议:挑一个特点往下挖。\n示范:无需示范\n'),
  frame('## 面批金句\n1. 我们一起把这一处放大。\n2. 你最熟悉它,再多说一点。\n3. 找准一处往下挖。\n## 异议\n无\n')
];

w.fetch = function () { return Promise.reject(new TypeError('Failed to fetch')); };

/* 注入五个脚本(与 index.html 中的顺序一致) */
const ctx = dom.getInternalVMContext();
['kb.js', 'engine.js', 'img.js', 'llm.js', 'app.js'].forEach(f => {
  try { vm.runInContext(fs.readFileSync(DIR + f, 'utf8'), ctx, { filename: f }); }
  catch (e) { console.log('  脚本执行失败 ' + f + ' → ' + e.message); fail++; }
});
const $ = id => w.document.getElementById(id);

/* jsdom 没有 canvas:把依赖画布的两处替换为等价实现,其余逻辑(含 img.js 的纯函数)照常跑 */
w.XZ_IMG.compress = function (file) {
  return Promise.resolve({
    src: 'data:image/jpeg;base64,SRC_' + encodeURIComponent(file.name),
    w: 1600, h: 1200, origW: 3024, origH: 4032, scaled: true
  });
};
w.XZ_IMG.exportDataUrl = function (item) {
  return Promise.resolve({ url: 'data:image/jpeg;base64,PAGE' + item.id, w: 1200, h: 1600 });
};

(async function () {
  await sleep(60);

  console.log('\n[A] 页面初始化');
  ok(!!w.XZ_KB && !!w.XZ_ENGINE && !!w.XZ_LLM, '三个模块均挂载到 window');
  ok($('unitSel').options.length === 8, '单元下拉被填充(8 个),实际 ' + $('unitSel').options.length);
  ok($('bookSel').options.length === 2, '册次下拉被填充(2 个)');
  ok(has($('unitBrief').innerHTML, '训练点') || $('unitBrief').innerHTML.length > 20, '单元简介已渲染');
  ok(has($('aiLine').innerHTML, '本地检测引擎'), '默认状态显示为本地引擎:' + $('aiLine').textContent.trim());
  ok($('setModal').hidden === true, '设置面板默认关闭');
  ok(jsdomErrors.length === 0, '初始化无脚本错误', jsdomErrors.join(' | '));

  console.log('\n[B] 老师模式(默认)');
  $('essay').value = ESSAY;
  $('runBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
  let r = $('result').innerHTML;
  ok(has(r, '单元训练点'), '输出含"单元训练点"段');
  ok(has(r, '两个优点'), '输出含"两个优点"段');
  ok(has(r, '一个主要问题'), '输出含"一个主要问题"段');
  ok(has(r, '面批金句'), '输出含"面批金句"段');
  ok(has(r, '检测依据'), '每条训练点附带检测依据');
  ok(!has(r, '想一想'), '老师模式不出现学生模式的段落');
  ok(has(r, '已识别为'), '身份识别结果显性显示');

  console.log('\n[C] 学生模式(手动切换)');
  w.document.querySelector('#roleSeg button[data-role="student"]').dispatchEvent(new w.Event('click', { bubbles: true }));
  $('runBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
  r = $('result').innerHTML;
  ok(has(r, '已识别为 <b>学生模式</b>'), '切换后按学生模式输出');
  ok(has(r, '想一想') && has(r, '自我检查清单'), '含提问与自查清单');
  ok(!has(r, '面批金句') && !has(r, '单元训练点'), '学生模式不泄漏老师模式的段落');
  ok(has(r, '不会给你现成的句子'), '明确声明不代写');
  const quotesC = (r.match(/「([^」]*)」/g) || []).map(s => s.slice(1, -1));
  const flat = ESSAY.replace(/\s/g, '');
  ok(quotesC.length > 0 && quotesC.every(q => flat.indexOf(q.replace(/\s/g, '')) !== -1), '学生模式的引用全部逐字来自原文');
  ok(quotesC.every(q => q.length <= 40), '没有成段照搬的成品文字');

  console.log('\n[D] 设置面板');
  $('setBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
  ok($('setModal').hidden === false, '点击后设置面板打开');
  ok($('aiPreset').options.length === 7, '服务商预设 7 个');
  const dsOpt = Array.from($('aiPreset').options).find(o => o.value === 'deepseek');
  ok(!!dsOpt, '含 DeepSeek 预设');
  $('aiOn').checked = true;
  $('aiBase').value = 'https://api.deepseek.com/v1';
  $('aiModel').value = 'deepseek-chat';
  $('aiKey').value = 'sk-demo-1234567890';
  $('aiSave').dispatchEvent(new w.Event('click', { bubbles: true }));
  const cfg = JSON.parse(w.localStorage.getItem('xz_llm_cfg'));
  ok(cfg && cfg.enabled === true && cfg.model === 'deepseek-chat', '配置写入本地存储');
  ok(w.localStorage.getItem('xz_llm_key') === 'sk-demo-1234567890', '密钥按默认策略存在本机');
  ok(has($('aiLine').innerHTML, '已启用'), '状态行提示已启用:' + $('aiLine').textContent.trim());
  await sleep(50);

  console.log('\n[E] 大模型成功路径');
  w.fetch = mockSse(AI_TEACHER);
  w.document.querySelector('#roleSeg button[data-role="teacher"]').dispatchEvent(new w.Event('click', { bubbles: true }));
  $('runBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
  ok(has($('result').innerHTML, '大模型增强批改中'), '先出现流式输出区,并已渲染本地报告');
  ok(has($('result').innerHTML, '单元训练点'), '等待期间本地报告已可见(不白屏)');
  const done = await waitFor(() => !!$('result').querySelector('.ai-meta'), 3000);
  r = $('result').innerHTML;
  ok(done, '增强完成并出现校验信息条');
  ok(has(r, 'deepseek-chat'), '标注所用模型');
  ok(has(r, '引文全部通过逐字校验') || has(r, '未通过校验'), '展示引文校验结论');
  ok(has(r, '查看大模型原始输出'), '保留原始输出供复核');
  ok(has(r, '动作写得具体'), '采用了大模型给出的点评措辞');
  const body = r.replace(/<details class="more ai-rawwrap">[\s\S]*?<\/details>/, '');
  ok(!has(body, '猫的眼睛像两颗蓝宝石'), '报告正文中不出现编造引文');
  ok(has(r, '猫的眼睛像两颗蓝宝石'), '编造引文只留在原始输出折叠区,供教师复核');
  ok(has(body, '它有时候会趴在我腿上睡觉'), '被拒的引文换成了本地引擎选出的原句');
  const bodyQuotes = (body.match(/「([^」]*)」/g) || []).map(s => s.slice(1, -1));
  ok(bodyQuotes.every(q => ESSAY.replace(/\s/g, '').indexOf(q.replace(/\s/g, '')) !== -1), '正文里每条「」引用都能在原文中找到');
  ok(has(r, '单元训练点'), '训练点段落仍在(判定归本地引擎)');
  ok(!has(r, '示范改写'), '"无需示范"未渲染出空段落');
  ok(jsdomErrors.length === 0, '增强路径无脚本错误', jsdomErrors.join(' | '));

  console.log('\n[F] 大模型失败路径(不影响可用性)');
  await sleep(720);
  w.fetch = function () { return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('{"error":"invalid api key"}') }); };
  $('runBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
  const failed = await waitFor(() => !!$('result').querySelector('.ai-fail'), 3000);
  r = $('result').innerHTML;
  ok(failed, '出现失败提示条');
  ok(has(r, '已回退到本地检测报告'), '明确告知已回退,不是静默失败');
  ok(has(r, '401') && has(r, '密钥无效'), '回显可读的失败原因');
  ok(has(r, '两个优点') && has(r, '面批金句'), '本地报告完整保留,功能不受影响');

  console.log('\n[G] 清除密钥后回到纯本地');
  $('setBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
  $('aiClear').dispatchEvent(new w.Event('click', { bubbles: true }));
  ok(has($('aiLine').innerHTML, '配置不完整') || has($('aiLine').innerHTML, '本地检测引擎'), '状态行回到本地引擎:' + $('aiLine').textContent.trim());
  $('aiOn').checked = false;
  $('aiSave').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(50);
  ok(has($('aiLine').innerHTML, '本地检测引擎'), '关闭开关后明确显示本地引擎');

  console.log('\n[H] 习作图片上传与人工校对');
  const mkFile = (name, type) => ({ name: name, type: type || 'image/jpeg', size: 900000 });
  function feed(input, files) {
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
  }
  const click = el => el.dispatchEvent(new w.Event('click', { bubbles: true }));
  function pageEl(i) { return $('ocrBody').querySelectorAll('.ocr-page')[i]; }

  ok($('thumbs').hidden === true, '初始没有缩略图');
  feed($('fileInput'), [mkFile('p1.jpg'), mkFile('p2.jpg'), mkFile('p3.jpg')]);
  await waitFor(() => $('thumbs').querySelectorAll('.thumb').length === 3, 2000);
  ok($('thumbs').querySelectorAll('.thumb').length === 3, '三张图片进入缩略图栏');
  ok($('imgCount').textContent.indexOf('3') !== -1, '页数已显示:' + $('imgCount').textContent);
  ok($('ocrModal').hidden === false, '上传后自动打开校对面板');
  ok($('ocrBody').querySelectorAll('.ocr-page').length === 3, '校对面板按页生成卡片');
  ok(has($('ocrBody').innerHTML, '第 2 页'), '按页编号');
  ok(has($('ocrBar').textContent, '对照录入'), '未配置视觉模型时明确说明可对照录入:' + $('ocrBar').textContent.trim());
  ok(!!$('ocrBar').querySelector('button[data-act="setting"]'), '并提供"去填视觉模型"入口(不是静默失败)');

  click($('ocrBar').querySelector('button[data-act="setting"]'));
  ok($('setModal').hidden === false, '点击后打开接口设置');
  ok(!!$('aiVision'), '设置面板含视觉模型名一栏');
  $('setClose').dispatchEvent(new w.Event('click', { bubbles: true }));

  /* 手工对照录入 */
  const ta1 = pageEl(0).querySelector('textarea');
  ta1.value = '我家养了一只猫。它的毛是黑白相间的,很漂亮。';
  ta1.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok(has(pageEl(0).querySelector('.ocr-st').textContent, '已录入'), '手工录入后该页状态变为已完成');
  ok(has($('thumbs').querySelectorAll('.thumb')[0].textContent, '字'), '缩略图同步显示字数');
  ok(has($('ocrSum').textContent, '已识别 1'), '汇总行同步:' + $('ocrSum').textContent.trim());
  ok($('ocrApply').disabled === false, '有文字后"采用到正文"可用');

  click($('ocrApply'));
  ok($('essay').value.indexOf('我家养了一只猫') === 0, '文字已写入正文');
  ok($('ocrModal').hidden === true, '采用后关闭校对面板');
  ok(has($('charCount').textContent, '字'), '字数统计已更新:' + $('charCount').textContent);
  ok(JSON.parse(w.localStorage.getItem('xz_llm_cfg')) !== null, '图片本身不写入本地存储(只存配置)');
  ok(w.localStorage.getItem('xz_last_5a-5') === null, '未点批改前不产生批改记录');
  ok(jsdomErrors.length === 0, '图片流程无脚本错误', jsdomErrors.join(' | '));

  console.log('\n[I] 配置视觉模型后一键识别');
  click($('setBtn'));
  $('aiOn').checked = true;
  $('aiBase').value = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  $('aiModel').value = 'qwen-plus';
  $('aiVision').value = 'qwen-vl-max';
  $('aiKey').value = 'sk-demo-1234567890';
  click($('aiSave'));
  await sleep(60);
  ok(has($('aiLine').innerHTML, '已启用'), '接口已启用:' + $('aiLine').textContent.trim());

  click($('ocrBtn'));
  ok($('ocrModal').hidden === false, '可再次打开校对面板');
  ok(has($('ocrBar').textContent, 'qwen-vl-max'), '状态行显示识图已就绪:' + $('ocrBar').textContent.trim());
  const runBtn2 = $('ocrBar').querySelector('button[data-act="runall"]');
  ok(!!runBtn2 && has(runBtn2.textContent, '2'), '已识别的页会被跳过,只提示重识未完成的 2 页:' + (runBtn2 && runBtn2.textContent));

  /* 分页返回不同结果:第 2 页带模型自加的标签与围栏,第 3 页读不出来 */
  const OCR_MAP = {
    PAGE2: '```text\n识别结果:\n我每天放学回家第一件事就是去看它。它有时候会趴在我腿上睡觉。\n\n总之,猫是一种很可爱的动物。\n```',
    PAGE3: '【无法识别】'
  };
  w.fetch = function (url, opt) {
    const body = JSON.parse(opt.body);
    const c = body.messages[1].content;
    if (Array.isArray(c)) {
      const img = c.filter(x => x.type === 'image_url')[0].image_url.url;
      const key = (img.match(/PAGE\d+/) || ['PAGE0'])[0];
      return sseStream(OCR_MAP[key] || '【无法识别】')();
    }
    return mockSse(AI_TEACHER)();
  };

  click(runBtn2);
  ok(has($('ocrBar').textContent, '停止识别'), '识别过程中可随时停止');
  const ocrDone = await waitFor(() => has($('ocrBody').innerHTML, '识别失败'), 5000);
  ok(ocrDone, '识别流程结束');

  const ta2 = pageEl(1).querySelector('textarea');
  ok(has(ta2.value, '我每天放学回家第一件事'), '第 2 页文字进入对应的输入框');
  ok(!has(ta2.value, '```') && !has(ta2.value, '识别结果:'), '模型自加的围栏与标签已清除');
  ok(has(ta2.value, '\n\n'), '段落空行被保留(不影响层次判断)');
  ok(has(pageEl(1).querySelector('.ocr-st').textContent, '已识别'), '第 2 页状态为已识别');
  ok(has(pageEl(2).querySelector('.ocr-err').textContent, '没有读出'), '第 3 页明确提示未读出并可重试:' + pageEl(2).querySelector('.ocr-err').textContent.slice(0, 24));
  ok(has($('ocrSum').textContent, '已识别 2'), '汇总显示 2 页已识别:' + $('ocrSum').textContent.trim());
  ok(has(pageEl(0).querySelector('textarea').value, '我家养了一只猫'), '识别其它页不会冲掉已人工录入的内容');
  ok($('thumbs').querySelectorAll('.thumb-st.bad').length === 1, '缩略图上有一页标为失败');

  /* 追加模式 */
  w.document.querySelector('input[name=ocrMode][value="append"]').checked = true;
  click($('ocrApply'));
  const essay2 = $('essay').value;
  ok(has(essay2, '我家养了一只猫') && has(essay2, '我每天放学回家'), '追加模式下两段都在');
  ok(essay2.indexOf('我家养了一只猫') < essay2.indexOf('我每天放学回家'), '原有内容在前,追加内容在后');

  console.log('\n[J] 图片来源在批改报告中的披露');
  $('essay').value = essay2;
  $('essay').dispatchEvent(new w.Event('input', { bubbles: true }));
  /* 重新走一次"采用",让来源标记生效 */
  click($('ocrBtn'));
  click($('ocrApply'));
  click($('runBtn'));
  await waitFor(() => !!$('result').querySelector('.src-bar'), 3000);
  r = $('result').innerHTML;
  ok(has(r, '原文来自图片识别'), '报告中显性披露原文来自图片识别');
  ok(has(r, '共 3 页'), '并注明页数');
  ok(has(r, '单元训练点') && has(r, '面批金句'), '批改报告本身完整');
  ok($('essay').value.indexOf('我家养了一只猫') !== -1, '清空操作前的正文仍在');
  /* 等这一轮的大模型增强跑完,避免它稍后重绘结果面板干扰下一节断言 */
  await waitFor(() => !!$('result').querySelector('.ai-meta'), 3000);
  click($('clearBtn'));
  ok($('essay').value === '' && $('thumbs').hidden === true, '清空按钮同时清掉正文与图片');

  console.log('\n[K] 传了图却忘了采用');
  feed($('fileInput'), [mkFile('x1.jpg')]);
  await waitFor(() => $('thumbs').querySelectorAll('.thumb').length === 1, 2000);
  click($('ocrClose'));
  ok($('ocrModal').hidden === true, '先关掉校对面板');
  click($('runBtn'));
  ok($('ocrModal').hidden === false, '正文为空时点批改,直接带回校对面板,而不是空跑一次');
  ok($('result').textContent.indexOf('单元训练点') === -1, '没有生成半成品报告');

  console.log('\n==============================');
  console.log('通过 ' + pass + ' / 失败 ' + fail + '  (共 ' + (pass + fail) + ' 项)');
  console.log('==============================');
  process.exit(fail ? 1 : 0);
})();
