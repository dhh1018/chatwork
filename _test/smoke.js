const fs = require('fs');
const vm = require('vm');
const path = require('path');

const dir = 'F:/mygit/chatwork/xizuo-coach';
const ctx = { window: {}, console: console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'kb.js'), 'utf8'), ctx, { filename: 'kb.js' });
vm.runInContext(fs.readFileSync(path.join(dir, 'engine.js'), 'utf8'), ctx, { filename: 'engine.js' });

const KB = ctx.window.XZ_KB, ENG = ctx.window.XZ_ENGINE;

const essays = {
  good: `我的心爱之物
我的心爱之物是一只旧旧的文具盒,是爸爸今年生日送我的。
它是深蓝色的,上面印着一只跃起的海豚,拉链头已经被我摸得发亮。盒盖的边角磨白了一小块,那是我每天放进书包时蹭出来的。打开它,里面分两层:上层躺着三支削好的铅笔,下层是我攒了半年的橡皮屑和一张小纸条。
那天爸爸把文具盒递给我时,我注意到他的手指上有几道新的划痕——他刚下班就去了文具店。我把文具盒贴在脸上,塑料壳凉凉的,心里却是热乎乎的。从那以后,每次写作业,我都会先把桌面擦干净,再轻轻把它摆好。
这就是我的心爱之物,它不贵,却装着爸爸的那几道划痕。`,

  plain: `介绍一种事物
猫是一种很常见的动物。
我家养了一只猫。它的毛是黑白相间的,很漂亮。它的眼睛很亮,很好看。它很可爱,我很喜欢它。
猫喜欢吃鱼,也喜欢吃猫粮。它很爱干净,经常舔自己的毛。它还会抓老鼠,很有用。
我每天放学回家第一件事就是去看它。它有时候会趴在我腿上睡觉。我觉得养猫很有意思。
总之,猫是一种很可爱的动物,大家都可以养一只试试。`,

  weak: `介绍一种事物
猫是一种动物。猫很可爱。猫有很多种颜色。猫会叫。猫喜欢吃东西。猫喜欢睡觉。我很喜欢猫。猫是一种很好的动物。所以我们要喜欢猫。`
};

function levelOf(an) {
  const m = { good: 0, part: 1, poor: 2 };
  return an.focusLevels.map(f => m[f.level]).join('');
}

let errors = 0, allGood = 0, allPoor = 0, total = 0;
const rows = [];

for (const bk of Object.keys(KB.books)) {
  for (const unit of KB.books[bk].units) {
    for (const key of Object.keys(essays)) {
      total++;
      try {
        const an = ENG.analyze(unit, essays[key]);
        const t = ENG.buildTeacher(unit, an);
        const s = ENG.buildStudent(unit, an);
        if (!t.trainPoints.length || !s.questions.length) throw new Error('空报告');
        // 引文必须能在原文中找到
        const src = essays[key].replace(/\s/g, '');
        (t.strengths || []).forEach(x => { if (!src.includes(x.quote.replace(/\s/g, ''))) throw new Error('引文不在原文:' + x.quote); });
        if (t.problem.quote && !src.includes(t.problem.quote.replace(/\s/g, ''))) throw new Error('问题引文不在原文:' + t.problem.quote);
        if (s.highlight && !src.includes(s.highlight.quote.replace(/\s/g, ''))) throw new Error('学生模式引文不在原文');
        const lv = levelOf(an);
        if (/-*0{2,}/.test(lv) && !/[12]/.test(lv)) { }
        if (lv.indexOf('0') === -1) allGood++;
        if (lv.indexOf('0') === -1 && lv.indexOf('1') === -1) allPoor++;
        rows.push([unit.id, key, lv, t.problem.focus.slice(0, 14)].join('\t'));
      } catch (e) {
        errors++;
        console.log('FAIL ' + unit.id + ' / ' + key + ' -> ' + e.message);
      }
    }
  }
}

console.log('\n=== 单元\t样例\t三级序列(0达成/1部分/2待突破)\t定位到的主要问题 ===');
console.log(rows.join('\n'));
console.log('\n用例数 ' + total + ' ,异常 ' + errors + ' ,三项全达成的用例 ' + allGood + ' ,全部待突破的用例 ' + allPoor);

console.log('\n=== 样例输出:五上第五单元《介绍一种事物》 / good ===');
const u = KB.books['5a'].units[4];
const an = ENG.analyze(u, essays.good);
const t = ENG.buildTeacher(u, an);
console.log(JSON.stringify({
  训练点: t.trainPoints.map(x => x.label + ' → ' + x.level + ' (' + x.notes.join(';') + ')'),
  优点: t.strengths,
  主要问题: t.problem,
  金句: t.quotes
}, null, 1));

console.log('\n=== 学生模式输出(同一篇) ===');
console.log(JSON.stringify(ENG.buildStudent(u, an), null, 1));

console.log('\n=== 身份识别 ===');
console.log(JSON.stringify(ENG.detectRole('请批改一下本次习作,给出评语,全班同学都要')));
console.log(JSON.stringify(ENG.detectRole('我写的这篇作文不知道哪里不好,怎么改')));
console.log(JSON.stringify(ENG.detectRole('我的心爱之物是一只文具盒')));
