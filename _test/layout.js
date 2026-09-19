/* ============================================================
 * _test/layout.js — 界面布局回归(纯静态检查 styles.css)
 * ------------------------------------------------------------
 * 这些断言守的是"页面骨架"本身,不是业务逻辑:
 *   - 对话区高度必须由 flex 撑开,不许再写死 calc(100vh - Npx)
 *     (页头换行或手机地址栏伸缩时,写死的高度会把输入条挤出屏幕)
 *   - 页头与对话区必须共用同一条宽度轴(--shell),左右边线对齐
 *   - 气泡/附注的阅读宽度必须在合理区间,不许满宽铺开
 *   - 输入条是一个整体容器,内部控件不再各自成边框
 *   - 打印样式必须仍然覆盖骨架
 * 改动 styles.css 后请一并跑这个,避免布局硬伤回归。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'xizuo-coach') + path.sep;
const css = fs.readFileSync(DIR + 'styles.css', 'utf8');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function block(sel) {
  const re = new RegExp('(?:^|\\n)\\s*' + esc(sel) + '\\s*\\{');
  const m = re.exec(css);
  if (!m) return null;
  const j = css.indexOf('{', m.index);
  const k = css.indexOf('}', j);
  return css.slice(j + 1, k);
}
function has(sel, re, name) {
  const b = block(sel);
  if (b === null) { fail++; console.log('  FAIL  ' + name + '  (未找到规则 ' + sel + ')'); return; }
  ok(re.test(b), name);
}

console.log('\n[1] 页面骨架:高度自适应,不写死视口高度');
ok(!/calc\(100vh\s*-/.test(css), '没有 calc(100vh - Npx) 之类的写死高度');
ok(/height:\s*100dvh/.test(css), 'body 用 100dvh 撑满视口');
ok(/@supports not \(height: 100dvh\)/.test(css), '为不支持 dvh 的浏览器留了 100vh 兜底');
ok(/body\s*\{[^}]*overflow:\s*hidden/.test(css), 'body 不整页滚动(滚动发生在消息区内部)');

console.log('\n[2] 对话面板:由 flex 撑开剩余空间');
has('.chat-panel', /flex:\s*1 1 auto/, 'chat-panel 用 flex 撑满');
has('.chat-panel', /min-height:\s*0/, 'chat-panel 有 min-height:0');
ok(!/\.chat-panel\s*\{[^}]*\n\s*height:/.test(css), 'chat-panel 不写 height');
has('main.chatwrap', /display:\s*flex/, 'chatwrap 是 flex 容器');
has('main.chatwrap', /min-height:\s*0/, 'chatwrap 有 min-height:0');
has('.msglist', /flex:\s*1 1 auto/, 'msglist 吃掉面板剩余高度');

console.log('\n[3] 宽度轴统一:页头与对话框左右边线对齐');
const shells = [...css.matchAll(/--shell:\s*([^;]+);/g)].map(m => m[1].trim());
ok(shells.length === 2, '--shell 恰好定义两次(桌面 + 窄屏),实际 ' + shells.length);
ok(shells[0] === '820px', '桌面宽度轴 = 820px,实际 ' + shells[0]);
has('header.top', /max-width:\s*var\(--shell\)/, '页头用 --shell');
has('main.chatwrap', /max-width:\s*var\(--shell\)/, '对话区用 --shell');
has('header.top', /padding:\s*20px 16px/, '页头左右内边距 = 16px');
has('main.chatwrap', /padding:\s*0 16px/, '对话区左右内边距 = 16px');
ok(!/1240px/.test(css), '没有残留的 1240px');
ok(!/920px/.test(css), '没有残留的 920px');

console.log('\n[4] 阅读宽度:消息不满宽铺开');
has('.bubble', /max-width:\s*78%/, '气泡最大 78%');
has('.bubble', /border-top-left-radius:\s*5px/, '气泡有朝向说话人的尖角');
has('.msg.me .bubble', /border-top-right-radius:\s*5px/, '自己的气泡尖角在右侧');
has('.msg.k-note .bubble', /max-width:\s*88%/, '附注宽度跟着收窄');

console.log('\n[5] 输入区:输入条是一个整体容器');
has('.inputrow', /border-radius:\s*14px/, '输入条整体圆角');
ok(/\.inputrow:focus-within/.test(css), '聚焦时输入条整体高亮');
has('.attach', /border:\s*0/, '＋ 按钮无边框');
has('.attach', /width:\s*36px/, '＋ 按钮 36px');
has('#input', /border:\s*0/, '输入框无自身边框');
has('#input', /background:\s*transparent/, '输入框背景透明');
has('#sendBtn', /padding:\s*8px 18px/, '发送按钮尺寸收小');

console.log('\n[6] 对话区拼成一张卡片');
has('.msglist', /border-radius:\s*var\(--radius\) var\(--radius\) 0 0/, '消息区上圆角');
has('.msglist', /border-bottom:\s*0/, '消息区下边框去掉');
has('.msglist', /scroll-behavior:\s*smooth/, '保留平滑滚动(chat.js 的 scrollIntoView 依赖)');
has('.composer', /border-radius:\s*0 0 var\(--radius\) var\(--radius\)/, '输入区下圆角');
has('.composer', /border-top:\s*0/, '输入区上边框去掉');

console.log('\n[7] 窄屏与打印');
const mobile = css.slice(css.indexOf('@media (max-width: 640px)'), css.indexOf('@supports not'));
ok(/--shell:\s*100%/.test(mobile), '窄屏宽度轴 = 100%');
ok(/padding:\s*0 10px 10px/.test(mobile), '窄屏对话区留白收紧');
const printB = css.slice(css.lastIndexOf('@media print'));
ok(css.lastIndexOf('@media print') > css.lastIndexOf('--shell'), 'print 块在文件末尾(优先级最高)');
ok(/body\s*\{[^}]*display:\s*block/.test(printB), 'print 下恢复 block 布局');
ok(/body\s*\{[^}]*height:\s*auto/.test(printB), 'print 下解除视口高度限制');
ok(/\.chat-panel\s*\{[^}]*display:\s*block/.test(printB), 'print 下面板恢复 block');

console.log('\n[8] 语法');
const open = (css.match(/\{/g) || []).length, close = (css.match(/\}/g) || []).length;
ok(open === close, '花括号配平 (' + open + '/' + close + ')');

console.log('\n通过 ' + pass + ' / 失败 ' + fail + '  (共 ' + (pass + fail) + ' 项)');
console.log('='.repeat(30) + '\n');
process.exit(fail ? 1 : 0);
