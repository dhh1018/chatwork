/* 习作批改助手 · 本地批改引擎
 * 设计原则:
 *   1. 全部判断由可复查的文本检测得出,引文只能来自原文,不存在编造;
 *   2. 每一条训练点判断都附带「检测依据」,教师可自行复核;
 *   3. 老师模式与学生的输出契约严格分离,学生模式不产出任何成品段落。
 */
(function (global) {
  'use strict';

  /* ============ 词库 ============ */
  const FAM = {
    simile: { w: ['像', '好像', '仿佛', '犹如', '如同', '宛如', '似的', '似乎'] },
    sense: { w: ['看', '听', '闻', '尝', '摸', '颜色', '味道', '声音', '香气', '凉', '烫', '暖', '柔软', '粗糙', '亮', '暗', '刺眼', '冰冷', '热乎乎', '甜甜'], x: ['漂亮', '明亮', '响亮'] },
    action: { w: ['跑', '走', '跳', '抓', '拿', '放', '推', '拉', '掂', '摸', '递', '捧', '转', '抬', '低', '皱', '咬', '拍', '抱', '挥', '挪', '蹲', '站', '拎', '塞', '举', '撑', '按', '拽', '扯', '踢', '冲', '弯', '讲', '翻', '端', '搬', '碰', '喝', '吃', '捡', '抄', '叹', '揉', '摆', '写', '画'], x: ['放学', '放心', '放假', '放晴', '走神', '走运', '讲话', '讲理'] },
    expression: { w: ['脸', '眼', '眉', '嘴', '笑', '哭', '瞪', '眯', '牙', '低头', '点头', '摇头', '神情', '表情', '目光', '嘴角', '额头', '汗'] },
    inner: { w: ['心想', '心里', '觉得', '以为', '担心', '害怕', '期待', '犹豫', '后悔', '明白', '记得', '希望', '盼望', '暗暗', '偷偷', '忍不住'] },
    emotion: { w: ['喜欢', '高兴', '开心', '快乐', '难过', '伤心', '生气', '着急', '紧张', '自豪', '骄傲', '感动', '怀念', '舍不得', '心疼', '温暖', '幸福', '失望', '委屈', '安心', '踏实', '眼眶', '谢谢', '感谢', '对不起', '抱歉', '一酸', '不敢', '怕', '愣', '松了一口气', '手心', '心跳', '脸红', '想您', '惦记', '眼泪', '鼻子'] },
    dialogue: { w: ['说', '问', '喊', '叫', '嘟囔', '嘀咕', '念叨', '告诉', '嘱咐', '叮嘱'] },
    timeSeq: { w: ['先', '接着', '然后', '后来', '最后', '一会儿', '不久', '早上', '中午', '傍晚', '夜里', '第二天', '来自', '那天', '这时'] },
    spaceSeq: { w: ['远处', '近处', '前面', '后面', '上面', '下面', '左边', '右边', '近前', '四周', '天边', '脚下', '头顶', '走进', '穿过', '绕过', '路边', '身旁', '尽头'] },
    future: { w: ['未来', '二十年', '20年', '以后', '将来', '机器人', '飞船', '飞行器', '智能', '虚拟', '全息', '无人', '太空', '海底', '空中', '自动'] },
    changeWord: { w: ['渐渐', '慢慢', '缓缓', '忽然', '突然', '一下子', '升起', '落下', '飘', '流动', '移动', '散开', '聚拢', '摇', '晃'] },
    conclusion: { w: ['所以', '因此', '这让我', '让我明白', '让我懂得', '我明白了', '我懂得了', '从此', '启示', '道理', '感悟'] },
    method: { w: ['调查', '查阅', '搜集', '统计', '访问', '采访', '实验', '问卷', '资料', '询问', '记录'] },
    question: { w: ['为什么', '是什么', '怎样', '如何', '是不是', '有没有', '多少'] },
    reasonWord: { w: ['因为', '之所以', '特别是', '值得', '吸引', '打动', '精彩', '有趣', '有道理', '耐人寻味', '原因'] },
    aspect: { w: ['位置', '地点', '历史', '年代', '建于', '结构', '外形', '特点', '价值', '意义', '故事', '传说', '文化', '作用', '组成', '规模', '现状'] },
    picture: { w: ['画中', '图上', '画面', '漫画里', '有一个人', '画面中', '一只', '一个男人', '女人', '孩子', '旁白', '图中'] },
    letter: { w: ['此致', '敬礼', '祝您', '您好', '亲爱的', '敬爱的', '想念', '请允许'] },
    connect: { w: ['我也有', '我也曾', '记得有一次', '我想起', '这让我想到', '我小时候', '我就想起', '我们身边', '生活里', '现实中'] },
    change: { w: ['以前', '从前', '原来', '现在', '如今', '从此', '再也', '不再', '后来'] },
    twist: { w: ['可是', '但是', '然而', '没想到', '不料', '突然', '忽然', '就在这时', '正在这时', '偏偏', '谁知'] },
    solution: { w: ['于是', '终于', '办法', '想到', '猛地', '灵机一动', '赶紧', '连忙', '只好', '冷静', '观察'] },
    side: { w: ['别人', '大家', '同学', '旁人', '纷纷', '连连', '称赞', '惊讶', '都笑', '都说', '羡慕'] },
    trait: { w: ['幽默', '严厉', '温柔', '热心', '粗心', '节俭', '勤劳', '调皮', '认真', '固执', '耐心', '细心', '开朗', '话多', '爱笑', '急脾气'] },
    keyMoment: { w: ['那一刻', '那时', '就在这时', '一下子', '顿时', '刹那间', '一瞬间', '忽然间', '就在此时'] },
    exagger: { w: ['简直', '不得了', '飞快', '闪电', '震天', '翻天覆地', '神速', '比谁都快', '一秒钟', '半秒钟', '绝了'] },
    vague: { w: ['很', '非常', '特别', '十分', '真的', '挺好', '好看', '好玩', '好吃', '好多', '很好', '最', '之一', '一定'] },
    avoid: { w: ['照抄', '百度', '资料显示', '据统计表明'] }
  };
  const RE = {
    number: /\d+(?:\.\d+)?\s*(?:米|厘米|毫米|千米|公里|千克|公斤|吨|克|岁|年|月|日|小时|分钟|秒|万|亿|%|％|摄氏度|年代|余公里|米高|平方米|平方公里|多种|多个|多次)/g,
    bookTitle: /《[^》]{1,30}》/g,
    compare: /比[^,。!?！?]{0,12}(?:大|小|高|低|长|短|重|轻|快|慢|多|少)|相当于|等于|是[^,。!?！?]{0,8}的\d+(?:\.\d+)?倍|不如|超过/g,
    example: /例如|比如|譬如|举个例子|有一次|就拿|来说说|打个比方/g
  };

  /* ============ 文本工具 ============ */
  function norm(t) {
    return String(t || '').replace(/\r/g, '').replace(/[ \t\u3000]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  function countHits(text, fam) {
    const f = FAM[fam];
    if (!f) return 0;
    let t = text;
    if (f.x) {
      for (let k = 0; k < f.x.length; k++) t = t.split(f.x[k]).join('');
    }
    let n = 0;
    for (const w of f.w) {
      let i = -1;
      while ((i = t.indexOf(w, i + 1)) !== -1) n++;
    }
    return n;
  }
  function hasFam(text, fam) { return countHits(text, fam) > 0; }
  function sentsWith(ctx, fam) { return ctx.sents.filter(function (s) { return hasFam(s.t, fam); }); }
  function reCount(text, re) { const m = text.match(re); return m ? m.length : 0; }
  function pct(r) { return Math.round(r * 100) + '%'; }
  function lvl(n, good, part) { return n >= good ? 'good' : (n >= part ? 'part' : 'poor'); }
  function uniq(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); }
  function hash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; }

  function makeCtx(essay) {
    const text = norm(essay);
    let paras = text.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!paras.length) paras = [text];
    const sents = [];
    paras.forEach(function (p, pi) {
      let buf = '';
      for (let i = 0; i < p.length; i++) {
        const ch = p[i];
        buf += ch;
        if ('。！？!?…'.indexOf(ch) !== -1) {
          const t = buf.trim();
          if (t) sents.push({ t: t, pi: pi, len: t.length });
          buf = '';
        }
      }
      const t = buf.trim();
      if (t) sents.push({ t: t, pi: pi, len: t.length });
    });
    if (sents.length <= 1 && text.length > 80) {
      sents.length = 0;
      paras.forEach(function (p, pi) {
        const parts = p.split(/[，,]/);
        let buf = '';
        parts.forEach(function (seg) {
          buf += (buf ? '，' : '') + seg;
          if (buf.length >= 24) { sents.push({ t: buf, pi: pi, len: buf.length }); buf = ''; }
        });
        if (buf) sents.push({ t: buf, pi: pi, len: buf.length });
      });
    }
    const lens = sents.map(function (s) { return s.len; });
    const avgLen = lens.length ? lens.reduce(function (a, b) { return a + b; }, 0) / lens.length : 0;
    return {
      text: text, paras: paras, sents: sents,
      chars: text.replace(/\s/g, '').length,
      paraCount: paras.length,
      sentCount: sents.length,
      avgLen: avgLen,
      maxLen: lens.length ? Math.max.apply(null, lens) : 0
    };
  }

  function vividScore(s) {
    let v = 0;
    if (s.len >= 18) v++;
    if (hasFam(s.t, 'simile')) v++;
    if (hasFam(s.t, 'action')) v++;
    if (hasFam(s.t, 'sense')) v++;
    if (reCount(s.t, RE.number)) v++;
    if (hasFam(s.t, 'dialogue') || hasFam(s.t, 'inner')) v++;
    if (/[黑白红黄蓝绿紫灰金银]|[软硬凉热香甜苦辣]/.test(s.t)) v++;
    return v;
  }
  function vagueScore(s) {
    let v = 0;
    for (const w of FAM.vague.w) { let i = -1; while ((i = s.t.indexOf(w, i + 1)) !== -1) v++; }
    return v;
  }
  function strongSents(ctx) {
    return ctx.sents.slice()
      .map(function (s) { return { s: s, v: vividScore(s) }; })
      .filter(function (x) { return x.v >= 2 && x.s.len >= 14; })
      .sort(function (a, b) { return b.v - a.v || b.s.len - a.s.len; })
      .map(function (x) { return x.s; });
  }
  function weakSents(ctx) {
    return ctx.sents.slice()
      .filter(function (s) { return s.len >= 12 && vividScore(s) <= 1; })
      .sort(function (a, b) { return (vagueScore(b) - vagueScore(a)) || (b.len - a.len); });
  }

  /* ============ 检测器 ============ */
  const DET = {

    detail: function (ctx) {
      const vivid = ctx.sents.filter(function (s) { return vividScore(s) >= 2; });
      const mid = ctx.sents.filter(function (s) { return vividScore(s) === 1; });
      const r = ctx.sentCount ? vivid.length / ctx.sentCount : 0;
      const level = vivid.length >= 3 ? 'good' : (vivid.length >= 1 || mid.length >= 6 ? 'part' : 'poor');
      return { level: level, evidence: vivid.slice(0, 2).map(function (s) { return s.t; }),
        note: '全文 ' + ctx.sentCount + ' 句,细节较具体的 ' + vivid.length + ' 句(占 ' + pct(r) + '),有细节但偏笼统的 ' + mid.length + ' 句' };
    },

    sense: function (ctx) {
      const hits = sentsWith(ctx, 'sense');
      const r = ctx.sentCount ? hits.length / ctx.sentCount : 0;
      return { level: lvl(hits.length, 4, 2), evidence: hits.slice(0, 2).map(function (s) { return s.t; }),
        note: '含看、听、闻、触等感官描写的句子 ' + hits.length + ' 句(占 ' + pct(r) + ')' };
    },

    emotion: function (ctx) {
      const hits = sentsWith(ctx, 'emotion');
      const withEvent = hits.filter(function (s) { return hasFam(s.t, 'action') || hasFam(s.t, 'dialogue') || hasFam(s.t, 'inner'); });
      const n = hits.length + withEvent.length;
      return { level: lvl(n, 4, 2), evidence: (withEvent.length ? withEvent : hits).slice(0, 2).map(function (s) { return s.t; }),
        note: '情感词出现 ' + hits.length + ' 处,其中与具体动作或对话结合的 ' + withEvent.length + ' 处' };
    },

    event: function (ctx) {
      const sents = sentsWith(ctx, 'action');
      const hasTime = hasFam(ctx.text, 'timeSeq');
      const hasPerson = /我|他|她|我们|他们|妈妈|爸爸|老师/.test(ctx.text);
      let score = (sents.length >= 3 ? 2 : sents.length >= 1 ? 1 : 0) + (hasTime ? 1 : 0) + (hasPerson ? 1 : 0);
      return { level: lvl(score, 4, 2), evidence: sents.slice(0, 2).map(function (s) { return s.t; }),
        note: '动作描写句 ' + sents.length + ' 句,时间线索' + (hasTime ? '有' : '无') + ',人物' + (hasPerson ? '明确' : '不明确') };
    },

    character: function (ctx) {
      const general = /总是|从来|一向|每次|每天|都[会能要]|一.{0,4}就|最[让令我]|从不|很有/;
      const trait = ctx.sents.filter(function (s) { return hasFam(s.t, 'trait') || general.test(s.t); });
      const look = ctx.sents.filter(function (s) { return hasFam(s.t, 'expression') || /穿着|个子|头发|戴|瘦|胖|高矮/.test(s.t); });
      const n = trait.length + look.length;
      return { level: lvl(n, 4, 2), evidence: (trait.length ? trait : look).slice(0, 2).map(function (s) { return s.t; }),
        note: '点明人物特点的句子 ' + trait.length + ' 句,人物外貌或神态描写 ' + look.length + ' 句' };
    },

    multiAngle: function (ctx) {
      const fams = ['action', 'expression', 'dialogue', 'inner'];
      const present = fams.filter(function (f) { return sentsWith(ctx, f).length > 0; });
      const names = { action: '动作', expression: '神态', dialogue: '语言', inner: '心理' };
      return { level: lvl(present.length, 3, 2),
        evidence: sentsWith(ctx, present[0] || 'action').slice(0, 2).map(function (s) { return s.t; }),
        note: '已用到的描写角度:' + (present.map(function (f) { return names[f]; }).join('、') || '暂未识别到') + '(共 ' + present.length + ' 种)' };
    },

    inner: function (ctx) {
      const hits = sentsWith(ctx, 'inner');
      return { level: lvl(hits.length, 3, 1), evidence: hits.slice(0, 2).map(function (s) { return s.t; }),
        note: '心理描写句 ' + hits.length + ' 句' };
    },

    exaggeration: function (ctx) {
      const hits = sentsWith(ctx, 'exagger');
      const simile = sentsWith(ctx, 'simile');
      const n = hits.length + (simile.length >= 2 ? 1 : 0);
      return { level: lvl(n, 2, 1), evidence: (hits.length ? hits : simile).slice(0, 2).map(function (s) { return s.t; }),
        note: '夸张语气的句子 ' + hits.length + ' 句,打比方 ' + simile.length + ' 处' };
    },

    dialogue: function (ctx) {
      const hits = sentsWith(ctx, 'dialogue');
      return { level: lvl(hits.length, 3, 1), evidence: hits.slice(0, 2).map(function (s) { return s.t; }),
        note: '含对话或说话的句子 ' + hits.length + ' 句' };
    },

    conciseness: function (ctx) {
      const longSents = ctx.sents.filter(function (s) { return s.len > 40; });
      const dlg = sentsWith(ctx, 'dialogue');
      const score = (ctx.avgLen <= 24 ? 2 : ctx.avgLen <= 32 ? 1 : 0) + (longSents.length <= 1 ? 1 : 0) + (dlg.length <= 1 ? 1 : 0);
      return { level: lvl(score, 4, 2), evidence: longSents.slice(0, 2).map(function (s) { return s.t; }),
        note: '平均句长 ' + Math.round(ctx.avgLen) + ' 字,超长句 ' + longSents.length + ' 句,对话 ' + dlg.length + ' 句' };
    },

    plotChain: function (ctx) {
      const seq = sentsWith(ctx, 'timeSeq');
      const twist = sentsWith(ctx, 'twist');
      const n = seq.length + twist.length;
      return { level: lvl(n, 3, 1), evidence: (seq.concat(twist)).slice(0, 3).map(function (s) { return s.t; }),
        note: '情节推进的连接句 ' + seq.length + ' 句,转折 ' + twist.length + ' 处,全文分 ' + ctx.paraCount + ' 段' };
    },

    order: function (ctx) {
      const t = sentsWith(ctx, 'timeSeq').length, s = sentsWith(ctx, 'spaceSeq').length;
      const kind = (t >= 2) && (s >= 2) ? 2 : (t + s >= 3 ? 1 : 0);
      return { level: lvl(kind, 2, 1), evidence: sentsWith(ctx, s > t ? 'spaceSeq' : 'timeSeq').slice(0, 2).map(function (x) { return x.t; }),
        note: '时间顺序线索 ' + t + ' 处,空间顺序线索 ' + s + ' 处' };
    },

    imagination: function (ctx) {
      const hits = sentsWith(ctx, 'future');
      const novel = ctx.paras.filter(function (p) { return /机器人|飞行|虚拟|全息|智能|无人|太空|海底|自动/.test(p); });
      const n = hits.length + (novel.length >= 2 ? 1 : 0);
      return { level: lvl(n, 4, 2), evidence: hits.slice(0, 3).map(function (s) { return s.t; }),
        note: '未来想象类词语出现 ' + hits.length + ' 处,涉及新奇场景的段落 ' + novel.length + ' 段' };
    },

    scene: function (ctx) {
      const sense = sentsWith(ctx, 'sense').length;
      const space = sentsWith(ctx, 'spaceSeq').length;
      const change = sentsWith(ctx, 'changeWord');
      const sc = (sense >= 3 ? 2 : sense >= 1 ? 1 : 0) + (space >= 2 ? 1 : 0) + (change.length >= 2 ? 2 : change.length >= 1 ? 1 : 0);
      return { level: lvl(sc, 4, 2), evidence: change.slice(0, 2).map(function (s) { return s.t; }),
        note: '感官描写 ' + sense + ' 句,方位词 ' + space + ' 处,景物的变化描写 ' + change.length + ' 句' };
    },

    paragraphs: function (ctx) {
      const withLead = ctx.paras.filter(function (p) {
        const first = p.split(/[。！？!?…]/)[0];
        return first && first.length <= 28 && p.length > first.length + 8;
      }).length;
      const leadRatio = ctx.paraCount ? withLead / ctx.paraCount : 0;
      const sc = (ctx.paraCount >= 4 ? 2 : ctx.paraCount === 3 ? 1 : 0) + (leadRatio >= 0.5 ? 1 : 0);
      return { level: lvl(sc, 3, 1), evidence: [],
        note: '全文 ' + ctx.paraCount + ' 段,' + withLead + ' 段段首有概括性的中心句(占 ' + pct(leadRatio) + ')' };
    },

    explainMethods: function (ctx) {
      const m = {
        '打比方': sentsWith(ctx, 'simile').length,
        '列数字': reCount(ctx.text, RE.number),
        '作比较': reCount(ctx.text, RE.compare),
        '举例子': reCount(ctx.text, RE.example)
      };
      const used = Object.keys(m).filter(function (k) { return m[k] > 0; });
      const detail = Object.keys(m).map(function (k) { return k + ' ' + m[k] + ' 处'; }).join('、');
      const ev = sentsWith(ctx, 'simile').slice(0, 1).map(function (s) { return s.t; });
      return { level: lvl(used.length, 2, 1), evidence: ev, note: '说明方法使用情况:' + detail };
    },

    copyRisk: function (ctx) {
      const longSents = ctx.sents.filter(function (s) { return s.len > 45; });
      const terms = (ctx.text.match(/[，,、]?(?:据|研究表明|相关资料|资料显示|据统计|由于|因此具有|具有重要的)/g) || []).length;
      const selfRef = countHits(ctx.text, 'inner') + (ctx.text.match(/我/g) || []).length;
      let risk = 0;
      if (longSents.length >= 4) risk += 2; else if (longSents.length >= 2) risk += 1;
      if (terms >= 2) risk += 2; else if (terms >= 1) risk += 1;
      if (selfRef <= 2) risk += 1;
      const level = risk >= 3 ? 'poor' : risk >= 2 ? 'part' : 'good';
      const tail = risk > 0 ? '(套语偏多、自己的话偏少,说明资料还没被消化)' : '';
      return { level: level, evidence: longSents.slice(0, 2).map(function (s) { return s.t; }),
        note: '超长句 ' + longSents.length + ' 句,书面套语 ' + terms + ' 处,第一人称表述 ' + selfRef + ' 处' + tail };
    },

    letter: function (ctx) {
      const first = ctx.paras[0] || '';
      const callOk = first.length <= 16 && !/[。！？!?…]/.test(first);
      const greetOk = /您好|你好|见字如面|最近/.test(ctx.text);
      const endOk = /此致|敬礼|祝您|祝您们|祝/.test(ctx.text);
      const signOk = /[\u4e00-\u9fa5]{2,4}\s*$/.test(ctx.text.trim()) || /\d{4}\s*年\s*\d{1,2}\s*月/.test(ctx.text);
      const n = [callOk, greetOk, endOk, signOk].filter(Boolean).length;
      const miss = [];
      if (!callOk) miss.push('称呼');
      if (!greetOk) miss.push('问候语');
      if (!endOk) miss.push('祝福语');
      if (!signOk) miss.push('署名或日期');
      return { level: lvl(n, 4, 3), evidence: [], note: '书信四要素已具备 ' + n + ' 项' + (miss.length ? ',缺少:' + miss.join('、') : '') };
    },

    appeal: function (ctx) {
      const want = ctx.sents.filter(function (s) { return /我想对|我希望|我想说|请您|我会|别|不要|能不能|好吗|谢谢您|谢谢您们/.test(s.t); });
      const layers = ctx.paraCount >= 4 ? 1 : 0;
      const score = (want.length >= 2 ? 2 : want.length >= 1 ? 1 : 0) + layers;
      return { level: lvl(score, 3, 2), evidence: want.slice(0, 2).map(function (s) { return s.t; }),
        note: '明确的诉求或心里话 ' + want.length + ' 句,全文分 ' + ctx.paraCount + ' 段' };
    },

    book: function (ctx) {
      const titles = uniq((ctx.text.match(RE.bookTitle) || []));
      const plot = sentsWith(ctx, 'action').length + (ctx.text.match(/主人公|故事|情节|讲述了|写到|作者|书中|书里/g) || []).length;
      const n = (titles.length ? 2 : 0) + (plot >= 3 ? 2 : plot >= 1 ? 1 : 0);
      return { level: lvl(n, 4, 2), evidence: [],
        note: '书名或篇名 ' + (titles.length ? titles.join('、') : '未出现') + ',书中具体内容指涉 ' + plot + ' 处' };
    },

    reason: function (ctx) {
      const hits = sentsWith(ctx, 'reasonWord');
      const long = hits.filter(function (s) { return s.len >= 20; });
      const n = hits.length + (long.length >= 2 ? 1 : 0);
      return { level: lvl(n, 4, 2), evidence: hits.slice(0, 2).map(function (s) { return s.t; }),
        note: '陈述理由的句子 ' + hits.length + ' 句,其中展开较充分的 ' + long.length + ' 句' };
    },

    connect: function (ctx) {
      const hits = sentsWith(ctx, 'connect');
      const firstPerson = (ctx.text.match(/我|自己/g) || []).length;
      const n = hits.length + (firstPerson >= 6 ? 1 : 0);
      return { level: lvl(n, 2, 1), evidence: hits.slice(0, 2).map(function (s) { return s.t; }),
        note: '联系自身或生活的句子 ' + hits.length + ' 句,第一人称表述 ' + firstPerson + ' 处' };
    },

    change: function (ctx) {
      const words = sentsWith(ctx, 'change');
      const before = /以前|从前|原来|那时/.test(ctx.text);
      const after = /现在|如今|从此|再也|不再/.test(ctx.text);
      const n = words.length + (before && after ? 2 : 0);
      return { level: lvl(n, 4, 2), evidence: words.slice(0, 3).map(function (s) { return s.t; }),
        note: '前后对比标志词 ' + words.length + ' 处,' + (before && after ? '已形成"以前—现在"的对照' : (before || after ? '只有单一时间指向,缺少对照' : '未识别到前后对照')) };
    },

    research: function (ctx) {
      const method = sentsWith(ctx, 'method');
      const q = /为什么|是什么|怎样|如何|多少|是不是|有没有/.test(ctx.text);
      const n = method.length + (q ? 1 : 0);
      return { level: lvl(n, 4, 2), evidence: method.slice(0, 2).map(function (s) { return s.t; }),
        note: '研究方法的表述 ' + method.length + ' 处,研究问题' + (q ? '明确' : '不明确') };
    },

    data: function (ctx) {
      const n = reCount(ctx.text, RE.number);
      const facts = sentsWith(ctx, 'method').length + (ctx.text.match(/年|朝代|时期|统计|数据|比例/g) || []).length;
      const sc = (n >= 3 ? 2 : n >= 1 ? 1 : 0) + (facts >= 2 ? 1 : 0);
      return { level: lvl(sc, 3, 1), evidence: [],
        note: '具体数字或量词 ' + n + ' 处,事实性表述 ' + facts + ' 处' };
    },

    conclusion: function (ctx) {
      const tail = ctx.paras.slice(-2).join('');
      const inTail = /所以|因此|让我|明白|懂得|启示|道理|感悟|从此|这就是我/.test(tail);
      const all = sentsWith(ctx, 'conclusion');
      const sc = (inTail ? 2 : 0) + (all.length >= 2 ? 1 : 0) + (ctx.paraCount >= 3 ? 1 : 0);
      return { level: lvl(sc, 3, 1), evidence: all.slice(0, 2).map(function (s) { return s.t; }),
        note: '结尾两段中' + (inTail ? '有' : '没有') + '明确的结论或启示句,全文结论性表述 ' + all.length + ' 处' };
    },

    keyMoment: function (ctx) {
      const hits = sentsWith(ctx, 'keyMoment');
      const expanded = hits.filter(function (s) {
        return s.pi !== undefined && ctx.paras[s.pi] && ctx.paras[s.pi].length > s.len + 25;
      });
      const n = hits.length + expanded.length;
      return { level: lvl(n, 3, 1), evidence: hits.slice(0, 2).map(function (s) { return s.t; }),
        note: '聚焦关键时刻的表述 ' + hits.length + ' 处,其中该处有展开描写的 ' + expanded.length + ' 处' };
    },

    twist: function (ctx) {
      const hits = sentsWith(ctx, 'twist');
      const danger = ctx.sents.filter(function (s) { return /危险|危急|危险|陷|困|断|黑|冷|饿|迷路|塌|掉|摔/.test(s.t); });
      const n = hits.length + (danger.length ? 1 : 0);
      return { level: lvl(n, 3, 1), evidence: (danger.concat(hits)).slice(0, 2).map(function (s) { return s.t; }),
        note: '情节转折 ' + hits.length + ' 处,险情描写 ' + danger.length + ' 句' };
    },

    solution: function (ctx) {
      const hits = sentsWith(ctx, 'solution');
      const think = sentsWith(ctx, 'inner');
      const n = hits.length + (think.length ? 1 : 0);
      return { level: lvl(n, 3, 1), evidence: hits.slice(0, 2).map(function (s) { return s.t; }),
        note: '求解动作的表述 ' + hits.length + ' 处,人物的思考过程 ' + think.length + ' 句' };
    },

    aspects: function (ctx) {
      const fam = FAM.aspect.w;
      const used = uniq(fam.filter(function (w) { return ctx.text.indexOf(w) !== -1; }));
      const paras = ctx.paras.filter(function (p) { return p.length >= 30; });
      const sc = (used.length >= 3 ? 2 : used.length >= 1 ? 1 : 0) + (paras.length >= 3 ? 1 : 0);
      return { level: lvl(sc, 3, 1), evidence: [],
        note: '已涉及的介绍方面:' + (used.slice(0, 6).join('、') || '暂未识别到') + '(共 ' + used.length + ' 个方面)' };
    },

    picture: function (ctx) {
      const hits = sentsWith(ctx, 'picture');
      const inPic = /画|漫画|图/.test(ctx.text);
      const n = hits.length + (inPic ? 1 : 0);
      return { level: lvl(n, 3, 1), evidence: hits.slice(0, 2).map(function (s) { return s.t; }),
        note: '对画面的描述 ' + hits.length + ' 句' + (inPic ? ',已点明"画"' : ',未出现"画"字,画面交代不清') };
    },

    side: function (ctx) {
      const hits = sentsWith(ctx, 'side');
      return { level: lvl(hits.length, 2, 1), evidence: hits.slice(0, 2).map(function (s) { return s.t; }),
        note: '旁人反应或侧面烘托的句子 ' + hits.length + ' 句' };
    }
  };

  /* ============ 学生模式提问模板(按检测项定制) ============ */
  const ASK = {
    detail: function (ev) { return '读你写的「' + ev + '」,读者明白你的意思了,但眼前还没有画面。当时你眼睛看到的是什么?能不能再补一句?'; },
    sense: function () { return '这一处你写到了看到的,那还听到了什么声音、闻到了什么气味、手上是什么感觉?'; },
    emotion: function (ev) { return '你写了「' + ev + '」。当时你心里是什么感觉?先别写"我很高兴",写写你的身体有什么反应?'; },
    event: function (ev) { return '「' + ev + '」这件事,你能说清楚是"什么时候、在哪里、谁做了什么"吗?先在心里说一遍,再写下来。'; },
    character: function () { return '如果你只留一句话形容他,你会留哪一句?这句话里有没有一个具体的动作?'; },
    multiAngle: function () { return '现在你主要是在"讲"这个人。能不能把他说的一句话、做的一个动作、脸上的一个变化写进来?'; },
    inner: function () { return '他做这个动作的时候,你觉得他心里在想什么?你是从哪一个细节猜出来的?'; },
    exaggeration: function () { return '这个地方如果再夸张一点,你会怎么放大?比如速度、声音、表情。'; },
    dialogue: function () { return '当时他(你)说了什么?把原话写进来,加上说话时的语气,会比转述更有现场感。'; },
    conciseness: function (ev) { return '「' + ev + '」这句可以更短。如果只留最关键的一半,你留哪一半?'; },
    plotChain: function () { return '把故事的时间线理一理:先发生什么、接着什么、最后什么。中间有没有断掉的地方?'; },
    order: function () { return '你是站在哪里看的?视线从哪儿开始、最后落在哪儿?把你的观察顺序写出来。'; },
    imagination: function () { return '你写的这个变化,能不能说清楚它解决了现在的什么问题?这样读者才会觉得想象有道理。'; },
    scene: function (ev) { return '这段时间里,「' + ev + '」这处景物有什么东西在变化?把变化的过程写下来。'; },
    paragraphs: function () { return '你现在整段写下来。试试看:这一段到底在说几件事?能不能一件事一段?'; },
    explainMethods: function (ev) { return '要让读者"知道有多大""有多重",你打算用什么办法?举例子、列数字、作比较还是打比方?先挑一个用上。'; },
    copyRisk: function (ev) { return '「' + ev + '」这一句读起来像资料。如果让你用自己的话讲给同学听,你会怎么说?'; },
    letter: function () { return '先检查四样东西:称呼、问候语、祝福语、署名和日期。缺哪一样?'; },
    appeal: function () { return '这封信你最想让对方做什么、或者知道什么?把这句话直接写出来,摆在一眼能看到的地方。'; },
    book: function () { return '你要推荐的这本书,书名和作者先说清楚了吗?你最有感触的是哪一处?'; },
    reason: function (ev) { return '「' + ev + '」这是你的理由。它后面有没有书里的(或生活中的)具体例子?'; },
    connect: function () { return '这一段道理很好。你自己有没有类似的经历?写一件,读后感才真正是你的。'; },
    change: function () { return '在这件事之前你是谁、之后你是谁?能不能写出一处"以前会……这次却……"的对照?'; },
    research: function () { return '你研究的问题一句话怎么说?打算用什么办法找到答案?'; },
    data: function () { return '你调查到的数字是多少?把它写进来,结论才站得住。'; },
    conclusion: function (ev) { return '读到这里,你自己得出的结论是什么?别停在"我很感动",再往前说一句。'; },
    keyMoment: function () { return '"那一刻"到底是哪一秒?把那一秒放慢:你的手在做什么?眼睛看着哪里?'; },
    twist: function () { return '故事到这里太顺了。能不能安排一次意外,让读者跟着紧张一下?'; },
    solution: function () { return '这个办法是怎么想出来的?先写他看到了什么,再写他怎么想的,办法才可信。'; },
    aspects: function () { return '你打算从哪几个方面介绍?位置、历史、结构、价值,还是故事?一个方面一段试试。'; },
    picture: function () { return '如果读者没看过这幅画,你能靠文字让他"看见"吗?画里有谁、在做什么、旁边写着什么?'; },
    side: function () { return '这件事发生时,旁边的人是什么反应?加一笔,人物会立起来。'; }
  };

  /* ============ 报告生成 ============ */
  function analyze(unit, essay) {
    const ctx = makeCtx(essay);
    const results = unit.checks.map(function (c) {
      const fn = DET[c.det];
      const r = fn ? fn(ctx, c.opts || {}) : { level: 'part', evidence: [], note: '该项暂无法自动检测' };
      return { f: c.f, det: c.det, advice: c.advice, level: r.level, evidence: r.evidence || [], note: r.note || '' };
    });
    const focusLevels = unit.focus.map(function (f, i) {
      const rs = results.filter(function (r) { return r.f === i; });
      if (!rs.length) return { level: 'good', notes: [], det: null };
      const order = { poor: 0, part: 1, good: 2 };
      let worst = rs[0];
      rs.forEach(function (r) { if (order[r.level] < order[worst.level]) worst = r; });
      return { level: worst.level, notes: rs.map(function (r) { return r.note; }).filter(Boolean), det: worst };
    });
    return { ctx: ctx, results: results, focusLevels: focusLevels, essay: ctx.text };
  }

  function isSummary(t) { return /^(总之|所以|因此|总而言之|这就是|我明白了|我懂得了|通过这次|最后)/.test(t); }

  function whyStrong(s) {
    const act = countHits(s.t, 'action');
    const sen = countHits(s.t, 'sense');
    if (hasFam(s.t, 'simile')) return '用上了打比方,画面一下子就出来了';
    if (sen >= 2 || /颜色|味道|声音|香气|气味|柔软|粗糙|刺眼|热乎乎/.test(s.t)) return '看得见、摸得着,观察很细';
    if (hasFam(s.t, 'dialogue')) return '把原话写进来了,读着像在现场';
    if (reCount(s.t, RE.number)) return '用上了具体数字,很有分量';
    if (act >= 2) return '动作写得连贯,读者能跟着做出来';
    if (hasFam(s.t, 'inner')) return '写出了心里的想法,一点不假';
    if (hasFam(s.t, 'emotion')) return '把心里的感受写出来了';
    if (/[黑白红黄蓝绿紫灰金银]|[软硬凉热香甜苦辣]/.test(s.t)) return '注意到了颜色和质感,说明你在仔细观察';
    if (act === 1) return '有具体的动作,画面开始动起来了';
    return '句子完整,表达清楚';
  }

  function buildTeacher(unit, an) {
    const ctx = an.ctx;

    let pool = strongSents(ctx).slice();
    if (pool.length < 2) {
      const used = pool.map(function (s) { return s.t; });
      ctx.sents.slice()
        .filter(function (s) { return s.len >= 12 && used.indexOf(s.t) === -1 && !isSummary(s.t); })
        .map(function (s) { return { s: s, v: vividScore(s) }; })
        .sort(function (a, b) { return b.v - a.v || b.s.len - a.s.len; })
        .forEach(function (x) { if (pool.length < 2) pool.push(x.s); });
    }
    const strengths = pool.slice(0, 2).map(function (s, i) {
      return { quote: s.t, why: whyStrong(s), focus: unit.focus[i % unit.focus.length].label };
    });

    const ORDER = { poor: 0, part: 1, good: 2 };
    let worstIdx = 0;
    an.focusLevels.forEach(function (fl, i) { if (ORDER[fl.level] < ORDER[an.focusLevels[worstIdx].level]) worstIdx = i; });
    const fl = an.focusLevels[worstIdx];
    const det = fl.det;
    const usedQuotes = strengths.map(function (s) { return s.quote; });
    const weakPool = weakSents(ctx)
      .filter(function (s) { return usedQuotes.indexOf(s.t) === -1; })
      .sort(function (a, b) {
        const sa = isSummary(a.t) ? 1 : 0, sb = isSummary(b.t) ? 1 : 0;
        if (sa !== sb) return sa - sb;
        return (vagueScore(b) - vagueScore(a)) || (b.len - a.len);
      });
    const allGood = an.focusLevels.every(function (f) { return f.level === 'good'; });

    let problem;
    if (allGood) {
      problem = {
        focus: '本次未发现明显问题',
        level: 'good',
        quote: '',
        cause: '本单元 ' + unit.focus.length + ' 条训练点在文中都基本落实了。',
        basis: '',
        advice: '可以往前再走一步:找一两处仍然偏概括的句子,把它换成能看见的画面;再读一遍开头和结尾,看看有没有更有味道的说法。'
      };
    } else {
      const ev = weakPool[0] ? weakPool[0].t
        : ((det && det.evidence && det.evidence[0]) ? det.evidence[0] : (ctx.sents[0] ? ctx.sents[0].t : ''));
      problem = {
        focus: unit.focus[worstIdx].label,
        level: fl.level,
        quote: ev,
        cause: fl.level === 'poor'
          ? '本单元的这一条训练点在文中基本没有展开,属于"还没练到"。'
          : '已经有意识去做了,但还没有做到位,属于"练了但不够"。',
        basis: det ? det.note : '',
        advice: det ? det.advice : '把这一处展开写具体。'
      };
    }

    const advance = [];
    an.focusLevels.forEach(function (f, i) {
      if (f.level !== 'good' && i !== worstIdx) advance.push({ focus: unit.focus[i].label, level: f.level, advice: f.det ? f.det.advice : '' });
    });

    const h = hash(ctx.text + unit.id);
    const praiseLines = [
      '你写「' + (strengths[0] ? strengths[0].quote : '') + '」这一句,老师读到这里停了一下——' + (strengths[0] ? strengths[0].why : '能看出你在认真写') + '。',
      '先说要表扬的:「' + (strengths[0] ? strengths[0].quote : '') + '」,' + (strengths[0] ? strengths[0].why : '') + ',这就是会写的样子。',
      '这篇里我最想给你画圈的是「' + (strengths[0] ? strengths[0].quote : '') + '」,' + (strengths[0] ? strengths[0].why : '') + '。'
    ];
    const nudgeLines = allGood ? [
      '这篇已经相当扎实了,下一稿我们试着往"更耐读"上走一步。',
      '本单元的训练点你都练到了,接下来练的是"味道"。',
      '这一篇可以当范文片段来读了,再打磨一两处说法会更好。'
    ] : [
      '如果能把' + problem.focus + '再补一补,这篇' + unit.title + '就更站得住了。',
      '下一稿我们只做一件事:把' + problem.focus + '写具体。',
      '你已经会写了,下一步只是把' + problem.focus + '这里再往下挖一寸。'
    ];
    const quotes = [
      praiseLines[h % praiseLines.length],
      nudgeLines[(h >> 3) % nudgeLines.length],
      '改完这一处,你会发现自己比想象中会写。'
    ];
    if (ctx.sentCount < 6) {
      quotes.length = 2;
      quotes.push('这次内容还比较短,先把想说的事写完整,我们再一起打磨。');
    }

    return {
      role: 'teacher',
      header: {
        unit: unit.no + '《' + unit.title + '》',
        focusCount: unit.focus.length,
        chars: ctx.chars, paras: ctx.paraCount, sents: ctx.sentCount, avgLen: Math.round(ctx.avgLen)
      },
      trainPoints: unit.focus.map(function (f, i) {
        return { label: f.label, level: an.focusLevels[i].level, notes: an.focusLevels[i].notes };
      }),
      strengths: strengths,
      problem: problem,
      advance: advance,
      quotes: quotes,
      pitfalls: unit.pitfalls,
      anchors: unit.anchors
    };
  }

  function buildStudent(unit, an) {
    const ctx = an.ctx;
    const strong = strongSents(ctx);
    const weak = weakSents(ctx).sort(function (a, b) {
      const sa = isSummary(a.t) ? 1 : 0, sb = isSummary(b.t) ? 1 : 0;
      if (sa !== sb) return sa - sb;
      return (vagueScore(b) - vagueScore(a)) || (b.len - a.len);
    });
    const order = { poor: 0, part: 1, good: 2 };
    const sorted = an.focusLevels.map(function (f, i) { return { f: f, i: i }; })
      .sort(function (a, b) { return order[a.f.level] - order[b.f.level]; });

    const qs = [];
    sorted.forEach(function (x) {
      if (x.f.level === 'good') return;
      const det = x.f.det;
      if (!det) return;
      const ev = (det.evidence && det.evidence[0]) ? det.evidence[0] : (weak[0] ? weak[0].t : '');
      const fn = ASK[det.det];
      qs.push(fn ? fn(ev) : '关于' + unit.focus[x.i].label + ',你觉得自己写到位了吗?哪里还可以再补一句?');
    });
    unit.questions.forEach(function (q) { qs.push(q); });
    qs.push('把这篇从头读一遍,哪一句你自己也觉得还可以更具体?');
    const questions = uniq(qs.filter(Boolean)).slice(0, 3);

    const checklist = unit.focus.map(function (f, i) {
      return { label: f.label, hint: an.focusLevels[i].level === 'good' ? '已经做到,再审一遍' : '这一条要重点自评' };
    });

    return {
      role: 'student',
      header: {
        unit: unit.no + '《' + unit.title + '》',
        chars: ctx.chars, paras: ctx.paraCount, sents: ctx.sentCount
      },
      highlight: strong[0] ? { quote: strong[0].t, why: whyStrong(strong[0]) } : null,
      highlightFallback: strong[0] ? '' : '这次的内容还比较短,老师先不急着夸,我们一起把它写长一点。',
      questions: questions,
      checklist: checklist,
      closing: '先别急着抄改。把上面的问题在心里过一遍,自己动手改。改完把新的一版发给我,我们再一起看一遍。'
    };
  }

  /* ============ 身份识别 ============ */
  const T_SIG = ['全班', '批改', '评语', '点评', '讲评', '本次习作', '学生姓名', '学号', '等级', '范文', '字数要求', '我们班', '批阅', '各位老师', '评分标准', '本次作文'];
  const S_SIG = ['我写的', '我不知道', '帮我看看', '怎么改', '我不会', '老师说我', '写得好不好', '写不下去', '怎么写', '我是学生', '我想改', '我该', '我写的对吗'];

  function detectRole(text) {
    const t = T_SIG.filter(function (w) { return text.indexOf(w) !== -1; });
    const s = S_SIG.filter(function (w) { return text.indexOf(w) !== -1; });
    if (t.length > s.length) return { role: 'teacher', confident: true, reason: '识别到教师语境用语:' + t.join('、') };
    if (s.length > t.length) return { role: 'student', confident: true, reason: '识别到学生语境用语:' + s.join('、') };
    return { role: 'teacher', confident: false, reason: '未发现明确的身份线索,已按老师模式输出;也可以手动切换' };
  }

  /* ============ 对外接口 ============ */
  global.XZ_ENGINE = {
    analyze: analyze,
    buildTeacher: buildTeacher,
    buildStudent: buildStudent,
    detectRole: detectRole
  };
})(window);
