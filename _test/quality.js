const fs = require('fs');
const vm = require('vm');
const path = require('path');

const dir = 'F:/mygit/chatwork/xizuo-coach';
const ctx = { window: {}, console: console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'kb.js'), 'utf8'), ctx, { filename: 'kb.js' });
vm.runInContext(fs.readFileSync(path.join(dir, 'engine.js'), 'utf8'), ctx, { filename: 'engine.js' });
const KB = ctx.window.XZ_KB, ENG = ctx.window.XZ_ENGINE;
const unitOf = id => KB.books[id.slice(0, 2)].units.find(u => u.id === id);

const good5a5 = `猫
猫是我们身边最常见的动物之一。它身上有三个特别的地方。
猫的体重不大。我家那只橘猫重 4.5 千克,比邻居家的白猫重了将近一倍。
猫的听觉很灵敏。它能听到人耳听不到的高频声音,相当于装了一台全天候的雷达。
猫的眼睛会发光。夜里看过去,像两颗绿色的玻璃球。有一次我把猫粮袋藏在柜子最里面,隔着两堵墙撕开一个小口,它立刻跳下沙发跑到厨房门口等我。
猫还很爱干净。它每天要花三四个小时舔毛,舌头上的倒刺像一把小梳子,能把灰尘梳下来。
正因为这些特点,猫既能当猎手,又能当家里的宝贝。`;

const plain5a5 = `介绍一种事物
猫是一种很常见的动物。
我家养了一只猫。它的毛是黑白相间的,很漂亮。它的眼睛很亮,很好看。它很可爱,我很喜欢它。
猫喜欢吃鱼,也喜欢吃猫粮。它很爱干净,经常舔自己的毛。它还会抓老鼠,很有用。
我每天放学回家第一件事就是去看它。它有时候会趴在我腿上睡觉。我觉得养猫很有意思。
总之,猫是一种很可爱的动物,大家都可以养一只试试。`;

const letter5a6 = `妈妈:
您好!
有些话我憋了很久,想借这封信跟您说。
上个月我数学考了 68 分,回家路上我一直在想您会怎么骂我。推开门的时候,我低着头,手一直抠着书包带。您没有骂我,只是把汤盛好放在我面前,说:先吃饭,吃完我们一起看看错在哪儿。那一刻我鼻子一酸,汤是热的,我喝得很慢。
妈妈,我想对您说:谢谢您。以后我会把错题抄在本子上,不让您再陪我熬到十一点。
祝您身体健康!
您的女儿 小雨
2026 年 9 月 18 日`;

const cartoon5a2 = `"漫画"老师
如果要给我们班的李老师画一幅漫画,我一定把她画成一个会瞬移的人。
李老师的腿不长,走路却快得不可思议。有一次下课,我明明看见她在办公室门口和人说话,等我一低头再抬头,她已经站在教室后门了,像一阵风。
她还有一句口头禅:这道题,我再讲最后一遍。一节数学课她能说七遍。每次说的时候,她都会把粉笔举得高高的,眉毛一挑,像要宣布一件大事。
最让我佩服的是她的耳朵。有一次我在最后一排小声和同桌说了一句话,她头也不回地说:你俩课后来找我。简直比雷达还灵。
这样的李老师,画进漫画里一定特别好看。`;

const angry5b4 = `他生气了
那天下午,弟弟的积木塔被我不小心碰倒了。
一开始他没说话,只是盯着地上的积木。他的脸慢慢涨红,嘴唇紧紧抿成一条线,两只手攥成了拳头,指节都发白了。
你赔。他从牙缝里挤出两个字,声音低得吓人。
我从来没见过他这样。他的胸口一起一伏,呼吸越来越重,连耳朵尖都是红的。我想他大概是又气又急,又觉得委屈,才说不出更多的话。
我蹲下来,一块一块把积木捡起来。他站了一会儿,忽然也蹲了下来。`;

const caseList = [
  ['5a-5', '好文', good5a5, ['good', 'good', 'good', 'good']],
  ['5a-5', '平庸文', plain5a5, ['part', 'poor', 'good', 'good']],
  ['5a-6', '好文', letter5a6, ['good', 'good', 'good']],
  ['5a-2', '好文', cartoon5a2, ['good', 'good', 'good']],
  ['5b-4', '好文', angry5b4, ['good', 'good', 'part']]
];

const M = { good: 0, part: 1, poor: 2 };

console.log('=== 定向质量测试(期望值 vs 实际) ===');
let bad = 0;
for (const [uid, tag, essay, expect] of caseList) {
  const u = unitOf(uid);
  const an = ENG.analyze(u, essay);
  const got = an.focusLevels.map(f => f.level);
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  if (!ok) bad++;
  console.log((ok ? 'PASS ' : 'DIFF ') + uid + ' ' + tag + '  实际=' + got.map(g => M[g]).join('') + ' 期望=' + expect.map(g => M[g]).join(''));
  if (!ok) an.focusLevels.forEach((f, i) => console.log('    - ' + u.focus[i].label + ' → ' + f.level + '  [' + f.notes.join(' | ') + ']'));
}

console.log('\n=== 五上第五单元 · 好文 完整老师报告 ===');
const u = unitOf('5a-5');
const t = ENG.buildTeacher(u, ENG.analyze(u, good5a5));
console.log(JSON.stringify({
  训练点: t.trainPoints.map(x => x.label + ' → ' + x.level + '  (' + x.notes.join('; ') + ')'),
  两个优点: t.strengths.map(x => x.quote + '  ‖ ' + x.why),
  主要问题: t.problem,
  金句: t.quotes
}, null, 1));

console.log('\n=== 五上第五单元 · 平庸文 老师报告 ===');
const t2 = ENG.buildTeacher(u, ENG.analyze(u, plain5a5));
console.log(JSON.stringify({
  训练点: t2.trainPoints.map(x => x.label + ' → ' + x.level),
  两个优点: t2.strengths.map(x => x.quote + '  ‖ ' + x.why),
  主要问题: t2.problem,
  金句: t2.quotes
}, null, 1));

console.log('\n=== 学生模式(平庸文) ===');
console.log(JSON.stringify(ENG.buildStudent(u, ENG.analyze(u, plain5a5)), null, 1));

console.log('\n=== 全单元崩溃测试 ===');
let err = 0, n = 0;
for (const bk of Object.keys(KB.books)) for (const unit of KB.books[bk].units) {
  for (const e of [good5a5, letter5a6, angry5b4]) {
    n++;
    try {
      const an = ENG.analyze(unit, e);
      const tr = ENG.buildTeacher(unit, an), st = ENG.buildStudent(unit, an);
      const src = e.replace(/\s/g, '');
      tr.strengths.forEach(x => { if (!src.includes(x.quote.replace(/\s/g, ''))) throw new Error('引文不在原文'); });
      if (tr.problem.quote && !src.includes(tr.problem.quote.replace(/\s/g, ''))) throw new Error('问题引文不在原文');
      if (st.highlight && !src.includes(st.highlight.quote.replace(/\s/g, ''))) throw new Error('学生引文不在原文');
      if (st.questions.length !== 3) throw new Error('提问数=' + st.questions.length);
      if (!st.questions.every(q => q && q.length > 8)) throw new Error('提问为空');
    } catch (e2) { err++; console.log('FAIL ' + unit.id + ' -> ' + e2.message); }
  }
}
console.log('用例 ' + n + ' ,异常 ' + err + ' ,与期望不一致 ' + bad);

console.log('\n=== 身份识别 ===');
[['请批改本次习作并给出评语,全班同学都要交', 'teacher'],
 ['我写的这篇作文不知道哪里不好,怎么改', 'student'],
 ['我的心爱之物是一只文具盒', 'teacher']].forEach(([txt, exp]) => {
  const r = ENG.detectRole(txt);
  console.log((r.role === exp ? 'PASS ' : 'DIFF ') + '→ ' + r.role + ' : ' + r.reason);
});
