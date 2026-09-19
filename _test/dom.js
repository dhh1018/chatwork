/* ============================================================
 * dom.js — 对话式批改机器人:整页集成测试(jsdom)
 * ------------------------------------------------------------
 * 把整页(index.html + 全部脚本)放进 jsdom 里跑,按对话的顺序逐段验证:
 *   A 启动:先问身份            G 追问的引文闸与多轮上下文
 *   B 先发作文、后认身份        H 学生模式:只提问、不代写
 *   C 选身份 → 收文             I 平台免密钥通道(伪造平台 SDK)
 *   D 选单元 → 本地报告         J 图片:识别结果绝不自动发送
 *   E 无大模型时的追问          K 会话恢复:重开一页接着聊
 *   F 自带密钥 + 大模型增强
 *
 * 三条不能破的规矩,在这里都要被真的按一遍:
 *   1) 训练点判定来自本地引擎;  2) 引用逐字来自原文;  3) 学生模式不代写。
 * ============================================================ */
const fs = require('fs'), vm = require('vm');
const { JSDOM } = require('C:/Users/admin/.workbuddy/binaries/node/workspace/node_modules/jsdom');

const DIR = 'F:/mygit/chatwork/xizuo-coach/';
const SCRIPTS = ['kb.js', 'engine.js', 'img.js', 'cloud.js', 'llm.js', 'ui.js', 'chat.js'];
/* 剥掉外链 script(CDN 的 SDK 在测试里由伪造实现替代),其余按 index.html 的顺序手工注入 */
const HTML = fs.readFileSync(DIR + 'index.html', 'utf8').replace(/<script\s+src="[^"]+"\s*><\/script>/g, '');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function has(h, n) { return String(h).indexOf(n) !== -1; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 2000)) { if (fn()) return true; await sleep(12); }
  return false;
}
function flat(s) { return String(s).replace(/[\s\u3000]/g, ''); }
function quotes(html) { return (String(html).match(/「([^」]*)」/g) || []).map(s => s.slice(1, -1)); }
/** 卡片正文(去掉"原始输出"折叠区,那里面本来就允许留着未校验的内容) */
function bodyOf(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('details.more').forEach(d => d.remove());
  return c.innerHTML;
}

/* ------------------------------------------------------------
 * 测试素材
 * ---------------------------------------------------------- */
const ESSAY = `介绍一种事物
猫是一种很常见的动物。
我家养了一只猫。它的毛是黑白相间的,很漂亮。它的眼睛很亮,很好看。它很可爱,我很喜欢它。
猫喜欢吃鱼,也喜欢吃猫粮。它很爱干净,经常舔自己的毛。它还会抓老鼠,很有用。
我每天放学回家第一件事就是去看它。它有时候会趴在我腿上睡觉。我觉得养猫很有意思。
总之,猫是一种很可爱的动物,大家都可以养一只试试。`;

const AI_TEACHER_TEXT = [
  '## 优点一',
  '引文:「它有时候会趴在我腿上睡觉」',
  '点评:这一句写出了具体的动作,读者能看见那一幕,对应训练点"抓住事物的主要特点"。',
  '## 优点二',
  '引文:「猫的眼睛像两颗蓝宝石一样亮」',
  '点评:写出了猫的样子。',
  '## 主要问题',
  '训练点:抓住事物的主要特点',
  '引文:「猫是一种很常见的动物」',
  '归因:全文停在概括上,没有把特点展开。',
  '建议:挑一个特点往下写一层,把当时看见的样子写进去。',
  '示范:无需示范',
  '## 面批金句',
  '1. 你写它趴在你腿上的那一句,老师一看就看见了。',
  '2. 我们再往前一步,把它的样子多写一处。',
  '3. 你最熟悉它,再多说一句就好。',
  '## 异议',
  '无'
].join('\n');

const AI_STUDENT_TEXT = [
  '## 亮点',
  '引文:「它有时候会趴在我腿上睡觉」',
  '点评:这一句把动作写下来了,读者能看见那一幕。',
  '## 提问',
  '1. 它趴在你腿上的时候,你看到了什么?',
  '2. 你当时心里在想什么?',
  '3. 那一天的猫和平时有什么不一样?',
  '## 寄语',
  '你已经把画面写出来了,再往下多问自己一句就好。'
].join('\n');

/* ------------------------------------------------------------
 * 页面工厂:每个用例拿一页干净的 DOM
 * ---------------------------------------------------------- */
function makePage(opt) {
  opt = opt || {};
  const p = { errors: [] };
  const dom = new JSDOM(HTML, { url: 'https://xizuo.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  p.dom = dom; p.w = w;
  w.addEventListener('error', e => p.errors.push('error: ' + e.message));
  dom.virtualConsole.on('jsdomError', e => p.errors.push('jsdomError: ' + e.message));

  /* 补齐 jsdom 没实现的浏览器能力 */
  if (!w.TextEncoder) w.TextEncoder = TextEncoder;
  if (!w.TextDecoder) w.TextDecoder = TextDecoder;
  if (!w.AbortController) w.AbortController = AbortController;
  w.Element.prototype.scrollIntoView = function () { };

  w.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  if (opt.sdk) w.WorkBuddyCloud = opt.sdk;
  if (opt.preload) Object.keys(opt.preload).forEach(k => w.localStorage.setItem(k, opt.preload[k]));

  const ctx = dom.getInternalVMContext();
  SCRIPTS.forEach(f => {
    try { vm.runInContext(fs.readFileSync(DIR + f, 'utf8'), ctx, { filename: f }); }
    catch (e) { fail++; console.log('  脚本执行失败 ' + f + ' → ' + e.message); }
  });

  /* jsdom 没有 canvas:把依赖画布的两处换成等价实现,其余逻辑(含纯函数)照常跑 */
  if (w.XZ_IMG) {
    w.XZ_IMG.compress = f => Promise.resolve({
      src: 'data:image/jpeg;base64,SRC_' + encodeURIComponent(f.name),
      w: 1600, h: 1200, origW: 3024, origH: 4032, scaled: true
    });
    w.XZ_IMG.exportDataUrl = item => Promise.resolve({ url: 'data:image/jpeg;base64,PAGE' + item.id, w: 1200, h: 1600 });
  }

  p.$ = id => w.document.getElementById(id);
  p.all = sel => Array.from(p.$('msgList').querySelectorAll(sel));
  p.q = sel => p.$('msgList').querySelector(sel);
  p.ql = sel => { const l = p.$('msgList').querySelectorAll(sel); return l[l.length - 1]; };
  p.msgs = () => p.$('msgList').querySelectorAll('.msg');
  p.bot = () => p.$('msgList').textContent;
  p.last = () => { const l = p.msgs(); return l[l.length - 1]; };
  p.click = el => el.dispatchEvent(new w.Event('click', { bubbles: true }));
  p.send = text => { p.$('input').value = text; p.click(p.$('sendBtn')); };
  p.cards = () => p.$('msgList').querySelectorAll('.msg.k-card');
  p.actIds = () => p.all('.qbtn').map(b => b.getAttribute('data-act'));
  return p;
}
/** 等 boot() 跑起来。jsdom 里 DOMContentLoaded 可能已经过了,补一次派发。 */
async function bootPage(p) {
  if (await waitFor(() => p.msgs().length > 0, 350)) return;
  p.w.document.dispatchEvent(new p.w.Event('DOMContentLoaded'));
  await waitFor(() => p.msgs().length > 0, 350);
}
/** 伪造的流式 SSE 响应(fetch 路径) */
function sse(text, w, size) {
  const enc = new w.TextEncoder();
  const frames = (String(text).match(new RegExp('[\\s\\S]{1,' + (size || 26) + '}', 'g')) || [''])
    .map(t => 'data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n');
  let i = 0;
  return () => Promise.resolve({
    ok: true, status: 200,
    headers: { get: () => 'text/event-stream' },
    body: { getReader: () => ({ read: () => Promise.resolve(i < frames.length ? { done: false, value: enc.encode(frames[i++]) } : { done: true }) }) }
  });
}

(async function () {
  /* ========================================================= */
  console.log('\n[A] 启动:先问身份,再做别的');
  const p = makePage();
  await bootPage(p);

  ok(!!p.w.XZ_KB && !!p.w.XZ_ENGINE && !!p.w.XZ_LLM && !!p.w.XZ_CLOUD && !!p.w.XZ_UI, '六个模块均挂载到 window');
  ok(p.msgs().length === 1, '初始只有一条消息,实际 ' + p.msgs().length);
  ok(has(p.bot(), '习作批改机器人'), '开场自报家门');
  ok(p.all('.qbtn').length === 2, '给出两个身份快捷按钮');
  ok(p.actIds().every(x => x.indexOf('role:') === 0), '按钮是身份动作:' + p.actIds().join(','));
  ok(p.$('roleChip').textContent === '身份:未选择', '顶栏身份为未选择:' + p.$('roleChip').textContent);
  ok(p.$('unitChip').textContent === '单元:未选择', '顶栏单元为未选择');
  ok(has(p.$('aiLine').textContent, '本地检测引擎'), '未配置时状态行如实说明走本地引擎:' + p.$('aiLine').textContent.trim());
  ok(p.errors.length === 0, '初始化无脚本错误', p.errors.join(' | '));

  /* ========================================================= */
  console.log('\n[B] 先发作文、后认身份(顺序错了也不丢东西)');
  p.send(ESSAY);
  ok(!!p.q('.msg.me'), '用户的话以消息形式出现');
  ok(has(p.last().textContent, '这篇我先收着'), '先把作文收下,不越权替用户定身份');
  ok(p.last().querySelectorAll('.qbtn').length === 2, '并再次把身份选择摆出来');
  ok(p.cards().length === 0, '没有身份就不出批改(不猜)');
  ok(/约 \d+ 字/.test(p.bot()), '报出收下的字数,让人放心');

  /* ========================================================= */
  console.log('\n[C] 选身份 → 立刻要单元(不重复要作文)');
  p.click(p.ql('[data-act="role:teacher"]'));
  ok(has(p.bot(), '老师模式'), '确认老师模式');
  ok(has(p.bot(), '你刚才发的那篇我先收着'), '把已收到的作文接上,不必重发');
  const unitActs = p.actIds().filter(x => x.indexOf('unit:') === 0);
  ok(unitActs.length === 17, '给出 16 个单元 + 通用标准共 17 个选择,实际 ' + unitActs.length);
  ok(unitActs.indexOf('unit:generic') !== -1, '含"不确定是哪个单元"的出口');
  ok(has(p.bot(), '这是哪个单元的习作'), '明确问单元,而不是自己猜一个');
  ok(p.$('unitChip').textContent === '单元:未选择', '还没定之前 chip 不谎报');
  ok(p.cards().length === 0, '单元未定就不出批改');

  /* ========================================================= */
  console.log('\n[D] 选单元 → 本地引擎出报告');
  p.click(p.ql('[data-act="unit:5a-5"]'));
  await sleep(20);
  ok(p.cards().length === 1, '选定单元后立刻出一张批改卡片');
  const card1 = p.cards()[0];
  const h1 = bodyOf(card1);
  ok(has(h1, '单元训练点') && has(h1, '两个优点') && has(h1, '一个主要问题') && has(h1, '面批金句'), '老师模式五段结构齐全');
  ok(has(h1, '老师模式'), '卡片标明本次身份');
  ok(has(h1, '检测依据'), '每条训练点附检测依据,可逐条复核');
  ok(has(h1, '字数'), '给出字数/段落/句数');
  ok(!has(h1, '想一想') && !has(h1, '自我检查清单'), '不混入学生模式的段落');
  const q1 = quotes(h1);
  ok(q1.length > 0 && q1.every(x => flat(ESSAY).indexOf(flat(x)) !== -1), '卡片里每条「」引用都逐字来自原文');
  ok(!/分数|等级|排名|星级/.test(h1), '不出现分数等级排名星级');
  ok(!/\d+\s*分(?![钟析])/.test(h1), '不出现任何形式的打分');
  ok(p.$('roleChip').textContent === '身份:老师', '顶栏身份已更新');
  ok(p.$('unitChip').textContent === '单元:第五单元(习作单元)《介绍一种事物》', '顶栏单元已更新:' + p.$('unitChip').textContent);
  ok(has(p.bot(), '本地检测引擎'), '说明这份由本地引擎给出,不冒充大模型');
  const sv1 = JSON.parse(p.w.localStorage.getItem('xz_chat_v1') || 'null');
  ok(sv1 && sv1.role === 'teacher' && sv1.unitId === '5a-5', '会话写入本机存储(免登录前提下的取舍)');
  ok(p.errors.length === 0, '本地批改路径无脚本错误', p.errors.join(' | '));

  /* ========================================================= */
  console.log('\n[E] 没有大模型时的追问:只答能答的,不硬编');
  p.send('这篇怎么改?');
  ok(has(p.last().textContent, '改法'), '能回答"怎么改",且来自单元档案与本次检测');
  p.send('本单元的训练点是什么?');
  ok(has(p.last().textContent, '本次对照的训练点'), '能列出本单元训练点与判定');
  p.send('今天天气不错');
  ok(has(p.last().textContent, '只能回答这固定的几类问题'), '超出范围时如实说明,不硬编');
  ok(!!p.last().querySelector('[data-act="open-set"]'), '并给出接通大模型的入口');
  p.click(p.last().querySelector('[data-act="open-set"]'));
  ok(p.$('setModal').hidden === false, '点一下就能打开接口设置');
  ok(has(p.$('chLine').textContent, '当前通道'), '设置面板里说清当前通道:' + p.$('chLine').textContent.trim().slice(0, 40));

  /* ========================================================= */
  console.log('\n[F] 自带密钥 + 大模型增强(流式)');
  p.$('aiOn').checked = true;
  p.$('aiPreset').value = 'deepseek';
  p.$('aiBase').value = 'https://api.deepseek.com/v1';
  p.$('aiModel').value = 'deepseek-chat';
  p.$('aiKey').value = 'sk-demo-1234567890';
  p.click(p.$('aiSave'));
  await sleep(30);
  ok(has(p.$('aiLine').textContent, '自带密钥已启用'), '保存后状态行立刻更新,不留旧结论:' + p.$('aiLine').textContent.trim());
  const lg = JSON.parse(p.w.localStorage.getItem('xz_llm_cfg') || 'null');
  ok(lg && lg.enabled === true && lg.model === 'deepseek-chat', '配置写入本机存储');
  await sleep(720);
  ok(p.$('setModal').hidden === true, '保存后自动收起设置面板');

  const reqs = [];
  p.w.fetch = function (url, opt) { reqs.push({ url: url, body: JSON.parse(opt.body) }); return sse(AI_TEACHER_TEXT, p.w)(); };
  p.send(ESSAY);
  ok(has(p.last().textContent, '这是一篇新的习作'), 'ready 阶段收到整篇时按新作文处理,不当成追问');
  ok(!!p.ql('[data-act="unit:5a-5"]'), '并要求先确认单元');
  p.click(p.ql('[data-act="unit:5a-5"]'));
  const cards2 = p.cards();
  const card2 = cards2[cards2.length - 1];
  ok(!!card2.querySelector('.card-body').innerHTML.length, '本地报告先渲染,不白屏等大模型');
  ok(!!p.$('msgList').querySelector('.msg.k-stream .ai-raw'), '增强时先出现流式输出区');
  ok(p.$('sendBtn').disabled === true, '生成期间不允许再发(避免串轮)');
  ok(await waitFor(() => !!card2.querySelector('.ai-meta'), 3000), '增强完成并出现校验信息条');
  ok(!p.$('msgList').querySelector('.msg.k-stream'), '完成后流式气泡收起');
  ok(p.$('sendBtn').disabled === false, '生成结束后发送按钮恢复');
  const h2 = bodyOf(card2);
  ok(has(h2, '写出了具体的动作'), '采用了大模型给出的点评措辞');
  ok(has(h2, '单元训练点'), '训练点判定仍是本地引擎给的(判定权不外移)');
  ok(!has(h2, '示范改写'), '"无需示范"没有被渲染成空段落');
  ok(!has(h2, '猫的眼睛像两颗蓝宝石'), '正文里不出现编造引文');
  ok(has(card2.innerHTML, '猫的眼睛像两颗蓝宝石'), '编造引文只留在原始输出折叠区供教师复核');
  const meta = card2.querySelector('.ai-meta').textContent;
  ok(has(meta, 'deepseek-chat'), '标注实际使用的模型:' + meta.trim());
  ok(has(meta, '未通过校验'), '显性披露引文校验结果');
  const q2 = quotes(h2);
  ok(q2.length > 0 && q2.every(x => flat(ESSAY).indexOf(flat(x)) !== -1), '增强后正文的每条引用仍能对上原文');
  ok(reqs.length === 1 && reqs[0].body.messages[0].role === 'system', '请求以 system 打头');
  ok(has(reqs[0].body.messages[1].content, '<<<ESSAY'), '把学生原文一并送进去');
  ok(has(reqs[0].body.messages[1].content, '不得推翻'), '并声明训练点判定不得推翻');
  ok(p.$('unitChip').textContent.indexOf('介绍一种事物') !== -1, '会话仍在同一单元上');

  /* ========================================================= */
  console.log('\n[G] 追问:编造的引用过不去,原文的引用留得下');
  const TEACHER_REPLY = '这一处最值得说:「它有时候会趴在我腿上睡觉」,那句话里有画面。不过「猫的眼睛像两颗蓝宝石一样亮」这句我没有在原文里看到。';
  p.w.fetch = function (url, opt) { reqs.push({ url: url, body: JSON.parse(opt.body) }); return sse(TEACHER_REPLY, p.w)(); };
  p.send('第二个问题怎么跟学生说?');
  ok(!!p.$('msgList').querySelector('.msg.k-stream .ai-raw'), '追问时先出现流式输出区');
  ok(await waitFor(() => !p.$('msgList').querySelector('.msg.k-stream'), 3000), '追问完成,流式气泡收起');
  const ansHtml = p.last().innerHTML;
  ok(has(ansHtml, '它有时候会趴在我腿上睡觉'), '原文里有的引用被保留');
  ok(!has(ansHtml, '猫的眼睛像两颗蓝宝石一样亮'), '编造的引用被拦下');
  ok(has(ansHtml, '（原文里没有这一句）'), '拦下处显式标出,不静默改字');
  ok(has(ansHtml, '未通过逐字校验'), '并说明有几处被拦:' + p.last().querySelector('.mini').textContent.trim());
  const lastReq = reqs[reqs.length - 1].body;
  ok(lastReq.messages[0].role === 'system', '追问同样以 system 打头');
  ok(has(lastReq.messages[0].content, '学生原文'), '追问时把原文一起带上');
  ok(/达成|部分达成|待突破/.test(lastReq.messages[0].content), '并把训练点判定一并注入(判定权不外移)');
  ok(has(lastReq.messages[0].content, '同行说话'), '老师模式的对话纪律随请求下发');
  ok(lastReq.messages[lastReq.messages.length - 1].role === 'user', '最后一轮是用户这句话');

  /* ========================================================= */
  console.log('\n[H] 学生模式:只提问、不代写');
  p.click(p.$('roleChip'));
  ok(has(p.last().textContent, '切换身份'), '点顶栏身份 chip 可随时切换');
  p.click(p.ql('[data-act="role:student"]'));
  ok(has(p.bot(), '学生模式'), '切到学生模式');
  ok(has(p.bot(), '我不会替你写'), '一开始就把"不代写"说在前面');
  p.w.fetch = function (url, opt) { reqs.push({ url: url, body: JSON.parse(opt.body) }); return sse(AI_STUDENT_TEXT, p.w)(); };
  p.send(ESSAY);
  p.click(p.ql('[data-act="unit:5a-5"]'));
  const cards3 = p.cards();
  const card3 = cards3[cards3.length - 1];
  ok(await waitFor(() => !!card3.querySelector('.ai-meta'), 3000), '学生模式卡片完成增强');
  const h3 = bodyOf(card3);
  ok(has(h3, '想一想') && has(h3, '自我检查清单'), '给出提问与自查清单');
  ok(!has(h3, '面批金句') && !has(h3, '单元训练点'), '不泄漏老师模式的段落');
  ok(has(h3, '不会给你现成的句子'), '明确声明不代写');
  const q3 = quotes(h3);
  ok(q3.length > 0 && q3.every(x => flat(ESSAY).indexOf(flat(x)) !== -1), '学生模式的引用同样逐字来自原文');
  ok(q3.every(x => x.length <= 40), '没有成段照搬的成品文字');

  /* 反代写闸:模型想给成品句,也落不到界面上 */
  const STUDENT_REPLY = '你可以把「猫是一种很常见的动物」改成「我家那只黑白相间的猫很可爱」,这样更好。';
  p.w.fetch = function (url, opt) { reqs.push({ url: url, body: JSON.parse(opt.body) }); return sse(STUDENT_REPLY, p.w)(); };
  p.send('帮我改一句');
  ok(await waitFor(() => !p.$('msgList').querySelector('.msg.k-stream'), 3000), '学生追问完成');
  const sHtml = p.last().innerHTML;
  const sReq = reqs[reqs.length - 1].body;
  ok(!has(sHtml, '我家那只黑白相间的猫'), '模型给的成品句被拦下,没有落到界面上');
  ok(has(sHtml, '这里由你自己动笔'), '拦下处换成了明确的"不代写"说明');
  ok(has(sHtml, '拦下 1 处代写内容'), '并告诉用户拦了几处:' + ((p.last().querySelector('.mini') || {}).textContent || ''));
  ok(has(sReq.messages[0].content, '绝不代写'), '学生模式的对话纪律随请求下发');
  ok(has(sReq.messages[0].content, '一次最多问 3 个问题'), '并限制提问数量,避免一串问题砸下来');

  /* ========================================================= */
  console.log('\n[I] 平台免密钥通道:不填任何东西也能用');
  const CP = { init: null, body: null, calls: 0, mode: 'ok', text: AI_TEACHER_TEXT, models: [{ id: 'wb-text', name: '平台文本模型' }, { id: 'wb-vision', name: '平台识图模型', supportsImages: true }] };
  const sdk = {
    createWorkBuddyCloud(opts) {
      CP.init = opts;
      return {
        llm: {
          models: { list: () => Promise.resolve(CP.models) },
          chat: {
            completions: {
              create(body) {
                CP.body = body; CP.calls++;
                if (CP.mode === 'authfail') {
                  /* 真实 SDK 的鉴权类错误常常是"返回一个稍后 reject 的 Promise" */
                  const e = new Error('nope'); e.error = { code: 'auth_unauthorized' };
                  return Promise.reject(e);
                }
                const parts = String(CP.text).match(/[\s\S]{1,24}/g) || [''];
                let i = 0;
                return {
                  [Symbol.asyncIterator]() {
                    return {
                      next: () => Promise.resolve(i < parts.length
                        ? { value: { choices: [{ delta: { content: parts[i++] } }] }, done: false }
                        : { value: undefined, done: true })
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
  const q = makePage({ sdk: sdk });
  await bootPage(q);
  await sleep(40);
  ok(has(q.$('aiLine').textContent, '平台通道'), '没填任何密钥,默认就有通道');
  ok(has(q.$('aiLine').textContent, 'wb-text'), '状态行给出实际模型名:' + q.$('aiLine').textContent.trim());
  ok(has(q.$('aiLine').textContent, 'wb-vision'), '并标明识图模型可用');
  ok(q.w.XZ_LLM.channel().type === 'platform', '通道路由为 platform');
  ok(CP.init.endpoint === q.w.XZ_CLOUD.PUBLIC_CONFIG.endpoint, 'SDK 用 publicConfig.endpoint 初始化');

  q.click(q.ql('[data-act="role:teacher"]'));
  q.send(ESSAY);
  q.click(q.ql('[data-act="unit:5a-5"]'));
  const qcards = q.cards();
  const card4 = qcards[qcards.length - 1];
  ok(await waitFor(() => !!card4.querySelector('.ai-meta'), 3000), '平台通道完成流式增强');
  ok(CP.calls === 1, '平台通道被真正调用一次');
  ok(CP.body.stream === true, '平台通道强制流式(平台不支持非流式)');
  ok(CP.body.messages[0].role === 'system', 'messages[0] 必须是 system(平台硬约束)');
  ok(CP.body.stream_options && CP.body.stream_options.include_usage === true, '请求用量回执,便于排障');
  const convId = CP.body.conversationId;
  ok(!!convId, '首次批改带上应用自持的会话 id');
  ok(has(bodyOf(card4), '单元训练点'), '平台通道下判定仍来自本地引擎');

  q.send('这句好在哪儿?');
  ok(await waitFor(() => CP.calls === 2, 3000), '追问发出第二次平台请求');
  ok(await waitFor(() => !q.$('msgList').querySelector('.msg.k-stream'), 3000), '平台下的追问也正常收尾');
  ok(CP.body.conversationId === convId, '追问复用同一个会话 id,多轮不断线');
  ok(has(CP.body.messages[0].content, '同行说话'), '多轮时系统提示与上下文仍然完整');

  CP.mode = 'authfail';
  q.send('再问一句');
  ok(await waitFor(() => has(q.bot(), '被授权'), 3000), '平台鉴权失败也给出人话提示');
  ok(has(q.bot(), '没能接上大模型'), '明确告知这次没接上,不静默失败');
  ok(has(q.bot(), '固定的几类问题'), '并回落到本地能答的那几类问题上');
  ok(q.errors.length === 0, '平台通道路径无脚本错误', q.errors.join(' | '));

  /* ========================================================= */
  console.log('\n[J] 图片:识别结果绝不自动发送');
  const mkFile = (name, type) => ({ name: name, type: type || 'image/jpeg', size: 900000 });
  function feed(input, files) {
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new p.w.Event('change', { bubbles: true }));
  }
  ok(p.$('thumbs').hidden === true, '初始没有图片');
  feed(p.$('fileInput'), [mkFile('p1.jpg')]);
  ok(await waitFor(() => p.$('thumbs').querySelectorAll('.thumb').length === 1, 2000), '图片进入缩略图栏');
  ok(p.$('ocrModal').hidden === false, '来图后自动打开校对面板');
  ok(has(p.$('ocrBody').innerHTML, '第 1 页'), '校对面板按页生成');
  const OCR_TEXT = '这句话只在图片校对里出现,不在任何已发送的消息里。';
  const before = p.msgs().length;
  const ta = p.$('ocrBody').querySelector('textarea');
  ta.value = OCR_TEXT;
  ta.dispatchEvent(new p.w.Event('input', { bubbles: true }));
  ok(has(p.$('ocrSum').textContent, '已识别 1'), '汇总行同步:' + p.$('ocrSum').textContent.trim());
  ok(p.$('ocrApply').disabled === false, '有文字后"放入输入框"可用');
  p.click(p.$('ocrApply'));
  ok(has(p.$('input').value, '这句话只在图片校对里出现'), '校对结果只填进输入框');
  ok(p.$('ocrModal').hidden === true, '采用后收起校对面板');
  ok(p.msgs().length === before, '没有新增任何消息 —— 识别结果不会被当成正文自动发出去');
  ok(!has(p.bot(), '这句话只在图片校对里出现'), '消息流里也找不到它');
  ok(p.errors.length === 0, '图片流程无脚本错误', p.errors.join(' | '));

  /* ========================================================= */
  console.log('\n[K] 会话恢复:重开一页还能接着聊');
  const savedJson = p.w.localStorage.getItem('xz_chat_v1');
  const sv2 = JSON.parse(savedJson);
  const p2 = makePage({ preload: { 'xz_chat_v1': savedJson } });
  await bootPage(p2);
  ok(has(p2.bot(), '接着上次的聊'), '重开后接着上次的会话,不从头开始');
  ok(p2.cards().length >= 1, '上次的批改卡片被恢复渲染');
  ok(p2.$('roleChip').textContent === '身份:' + (sv2.role === 'teacher' ? '老师' : '学生'), '顶栏恢复身份:' + p2.$('roleChip').textContent);
  ok(p2.$('unitChip').textContent !== '单元:未选择', '顶栏恢复单元:' + p2.$('unitChip').textContent);
  ok(!!p2.ql('[data-act="new-essay"]'), '并给出"再批一篇"的出口');
  ok(p2.errors.length === 0, '恢复路径无脚本错误', p2.errors.join(' | '));

  console.log('\n==============================');
  console.log('通过 ' + pass + ' / 失败 ' + fail + '  (共 ' + (pass + fail) + ' 项)');
  console.log('==============================');
  process.exit(fail ? 1 : 0);
})();
