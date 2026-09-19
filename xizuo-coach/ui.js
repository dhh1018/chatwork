/* ============================================================
 * ui.js — 界面构件(对话之外的那两件事)
 * ------------------------------------------------------------
 *   1) 习作图片:压缩 + 逐页识别 —— 纯工具,不渲染任何面板。
 *      图片长什么样、识别结果怎么校对,全部由 chat.js 放进对话消息里。
 *   2) 接口设置弹层(密钥只能用密码框输入,所以留这一个弹层,
 *      但入口也只出现在对话里)。
 *   3) 批改结果卡片的结构化渲染 + 复制 / 导出 / 打印。
 *
 * 对外接口见文件末尾的 XZ_UI;两条回调由 chat.js 注入:
 *   hooks.toast(msg)        提示
 *   hooks.onFiles(files)    收到图片文件(选图 / 拖入 / 粘贴),交给对话去发
 * ============================================================ */
(function (root) {
  'use strict';

  var global = root || (typeof window !== 'undefined' ? window : globalThis);
  var LLM = global.XZ_LLM, XIMG = global.XZ_IMG;

  var LEVEL = {
    good: { t: '达成', c: 'ok' },
    part: { t: '部分达成', c: 'warn' },
    poor: { t: '待突破', c: 'bad' }
  };

  var hooks = {
    toast: function () { },
    onFiles: function () { }
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(m) { hooks.toast(m); }

  /* ============================================================
   * 一、习作图片:压缩 → 逐页识别(结果交给对话渲染)
   * ========================================================== */

  function pickImages() {
    var fi = $('fileInput');
    if (fi) fi.click();
  }

  /**
   * 文件 → 压缩后的图片项。返回纯数据,不做任何界面动作。
   * → { ok:[{name,src,w,h}], failed:[原因], skipped:数量 }
   */
  function compressFiles(files) {
    var out = { ok: [], failed: [], skipped: 0 };
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return Promise.resolve(out);

    var usable = [];
    list.forEach(function (f) { if (XIMG.isImageFile(f)) usable.push(f); else out.skipped++; });
    if (usable.length > XIMG.MAX_PAGES) {
      out.skipped += usable.length - XIMG.MAX_PAGES;
      usable = usable.slice(0, XIMG.MAX_PAGES);
    }
    if (!usable.length) return Promise.resolve(out);

    return Promise.all(usable.map(function (f) {
      return XIMG.compress(f).then(function (r) {
        return { name: f.name || '图片', src: r.src, w: r.w, h: r.h };
      }, function (e) {
        out.failed.push((e && e.message) || String(e));
        return null;
      });
    })).then(function (items) {
      items.forEach(function (it) { if (it) out.ok.push(it); });
      return out;
    });
  }

  /**
   * 逐页识别。items: [{src}]（按页序）
   * opts: { signal, onPage(i, total), onDelta(d, i) }
   * → { pages:[{text,err,unreadable,notes}], ok, fail, aborted }
   * 一页失败不影响其他页;识别只负责"把字变成文字",不参与任何评价。
   */
  function ocrPages(items, opts) {
    opts = opts || {};
    var pages = (items || []).map(function () {
      return { text: '', err: '', unreadable: false, notes: [] };
    });
    var ok = 0, fail = 0;
    var chain = Promise.resolve();

    pages.forEach(function (piece, i) {
      chain = chain.then(function () {
        if (opts.signal && opts.signal.aborted) return;
        if (opts.onPage) opts.onPage(i, pages.length);
        return Promise.resolve(LLM.ocrImage({
          imageUrl: items[i].src,
          index: i + 1,
          total: pages.length,
          signal: opts.signal,
          onDelta: function (d) {
            piece.text += d;
            if (opts.onDelta) opts.onDelta(d, i);
          }
        })).then(function (r) {
          if (opts.signal && opts.signal.aborted) { piece.text = ''; return; }
          if (r && r.unreadable) {
            piece.unreadable = true; piece.text = '';
            piece.err = '这一页没有读出作文文字 —— 可能是拍得偏暗、发糊,或者画面里没有字。重拍一张再发我也可以。';
            fail++;
          } else {
            piece.text = (r && r.text) || '';
            piece.notes = (r && r.notes) || [];
            if (piece.text) ok++; else { piece.err = '这一页没有读到文字。'; fail++; }
          }
        }, function (e) {
          if (opts.signal && opts.signal.aborted) { piece.text = ''; return; }
          piece.err = (e && e.message) || String(e);
          fail++;
        });
      });
    });

    return chain.then(function () {
      return { pages: pages, ok: ok, fail: fail, aborted: !!(opts.signal && opts.signal.aborted) };
    });
  }

  function openZoom(url) {
    if (!url || !$('zoomImg')) return;
    $('zoomImg').src = url;
    $('zoomBox').hidden = false;
  }

  /** 图片入口:只说两件事 —— 选到文件了、拖进来或粘贴了。怎么用由对话决定。 */
  function initAttach() {
    var btn = $('imgBtn'), fi = $('fileInput');
    if (btn) btn.addEventListener('click', pickImages);
    if (fi) {
      fi.addEventListener('change', function () {
        if (this.files && this.files.length) hooks.onFiles(this.files);
        this.value = '';
      });
    }

    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) hooks.onFiles(dt.files);
    });

    /* 截图后直接粘贴。输入框里粘的是"带文字的富文本"时不抢,按文字处理。 */
    document.addEventListener('paste', function (e) {
      var cb = e.clipboardData;
      if (!cb) return;
      var files = [];
      Array.prototype.forEach.call(cb.files || [], function (f) { if (XIMG.isImageFile(f)) files.push(f); });
      if (!files.length && cb.items) {
        Array.prototype.forEach.call(cb.items, function (it) {
          if (it.kind === 'file' && /^image\//i.test(it.type)) { var f = it.getAsFile(); if (f) files.push(f); }
        });
      }
      if (!files.length) return;
      var t = e.target;
      var inField = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT');
      var plain = cb.getData ? (cb.getData('text/plain') || '') : '';
      if (inField && plain.replace(/\s/g, '')) return;
      e.preventDefault();
      hooks.onFiles(files);
    });

    if ($('zoomBox')) $('zoomBox').addEventListener('click', function () { this.hidden = true; });
  }

  /* ============================================================
   * 二、接口设置:平台通道为默认,自带密钥可覆盖
   * ========================================================== */

  function fillPresetOptions() {
    if (!$('aiPreset')) return;
    $('aiPreset').innerHTML = LLM.PRESETS.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
    }).join('');
    $('aiTemp').innerHTML = LLM.TEMPS.map(function (t) {
      return '<option value="' + t.v + '">' + esc(t.t) + '</option>';
    }).join('');
  }

  /** 通道状态行:一行说清"现在到底谁在说话"。它只说状态,不是操作入口。 */
  function renderChannelLine(el) {
    if (!el) return;
    var st = LLM ? LLM.statusText() : { on: false, text: '接口层未加载' };
    el.innerHTML = '<span class="dot ' + (st.on ? 'on' : 'off') + '"></span><span class="ai-line-text">' + esc(st.text) + '</span>' +
      (st.on ? '' : '<span class="ai-line-tip">对我说一句「设置」就能接通大模型</span>');
  }

  function openSettings() {
    var c = LLM.loadConfig();
    $('aiOn').checked = !!c.enabled;
    $('aiPreset').value = c.presetId;
    $('aiBase').value = c.baseUrl;
    $('aiModel').value = c.model;
    $('aiVision').value = c.visionModel || '';
    $('aiKey').value = c.apiKey || '';
    $('aiTemp').value = String(c.temperature);
    $('aiSession').checked = !!c.sessionOnly;
    $('aiMsg').textContent = '';
    var cl = $('chLine');
    if (cl) {
      var st = LLM.statusText();
      cl.innerHTML = '当前通道:<b>' + esc(st.text) + '</b>' +
        (st.on ? '' : '<br><span class="subnote">没有可用通道时,批改仍由本地检测引擎完成,并且只能用提问引导、不能回答自由追问。</span>');
    }
    $('setModal').hidden = false;
    syncPresetNote();
  }
  function closeSettings() { $('setModal').hidden = true; }

  function syncPresetNote() {
    var p = LLM.preset($('aiPreset').value);
    $('aiPresetNote').textContent = p.note || '';
    var cur = LLM.loadConfig();
    if (!cur.baseUrl || cur.presetId !== p.id) {
      $('aiBase').value = p.baseUrl;
      $('aiModel').value = p.model;
      $('aiVision').value = p.vision || '';
    }
    $('aiVisionNote').textContent = p.vision
      ? '留空则关闭自带识图,改用平台通道的识图模型。手写作文必须由视觉模型识别,普通文字模型不行。'
      : '这个服务商没有视觉模型;留空则自动使用平台通道的识图模型。';
  }

  function collectSettings() {
    return {
      enabled: $('aiOn').checked,
      presetId: $('aiPreset').value,
      baseUrl: $('aiBase').value.trim(),
      model: $('aiModel').value.trim(),
      visionModel: $('aiVision').value.trim(),
      apiKey: $('aiKey').value.trim(),
      temperature: parseFloat($('aiTemp').value) || 0.5,
      sessionOnly: $('aiSession').checked
    };
  }

  /** 画一张写着已知文字的测试图,验证"这个模型到底能不能读图" */
  function makeProbeImage() {
    var words = ['习作批改', '作文本子', '五年级', '小学习作'];
    var w = words[Math.floor((new Date().getTime() / 1000 | 0)) % words.length];
    var c = document.createElement('canvas');
    c.width = 620; c.height = 170;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111111';
    g.font = '64px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
    g.textBaseline = 'middle';
    g.fillText(w, 34, 88);
    return { url: c.toDataURL('image/jpeg', 0.9), word: w };
  }

  function initSettings() {
    fillPresetOptions();
    if ($('setClose')) $('setClose').addEventListener('click', closeSettings);
    if ($('setModal')) $('setModal').addEventListener('click', function (e) { if (e.target === this) closeSettings(); });
    if ($('aiPreset')) $('aiPreset').addEventListener('change', syncPresetNote);

    if ($('aiSave')) $('aiSave').addEventListener('click', function () {
      var c = collectSettings();
      if (c.enabled && (!c.baseUrl || !c.model)) { $('aiMsg').textContent = '启用前请填写接口地址与模型名'; $('aiMsg').className = 'ai-msg bad'; return; }
      if (c.enabled && !LLM.isRelative(c.baseUrl) && !c.apiKey) { $('aiMsg').textContent = '启用前请填写 API Key(或改填自建代理地址)'; $('aiMsg').className = 'ai-msg bad'; return; }
      LLM.saveConfig(c);
      /* 通道变了,输入区那行状态要跟着变,否则用户看到的是旧结论 */
      renderChannelLine($('aiLine'));
      $('aiMsg').textContent = c.enabled ? '已保存,自有通道优先于平台通道' : '已保存(使用平台通道)';
      $('aiMsg').className = 'ai-msg ok';
      toast('接口设置已保存');
      setTimeout(closeSettings, 700);
    });

    if ($('aiTest')) $('aiTest').addEventListener('click', function () {
      var msg = $('aiMsg');
      LLM.saveConfig(collectSettings());
      msg.textContent = '正在测试连接…'; msg.className = 'ai-msg';
      var self = this; self.disabled = true;
      LLM.testConnection().then(function (r) {
        self.disabled = false;
        msg.textContent = r.msg;
        msg.className = 'ai-msg ' + (r.ok ? 'ok' : 'bad');
      });
    });

    if ($('aiTestVision')) $('aiTestVision').addEventListener('click', function () {
      var msg = $('aiMsg');
      LLM.saveConfig(collectSettings());
      if (!LLM.isVisionReady()) { msg.textContent = '当前没有可用的识图通道:平台通道未提供识图模型,也没有填自带视觉模型'; msg.className = 'ai-msg bad'; return; }
      msg.textContent = '正在用一张写着已知文字的测试图验证识图能力…'; msg.className = 'ai-msg';
      var self = this; self.disabled = true;
      var probe = makeProbeImage();
      LLM.ocrImage({ imageUrl: probe.url, index: 1, total: 1, maxTokens: 60, timeout: 60000 }).then(function (r) {
        self.disabled = false;
        var got = String(r.text || '').replace(/[\s\u3000]/g, '');
        var okv = got.indexOf(probe.word) !== -1;
        msg.textContent = okv
          ? '识图正常:测试图上的「' + probe.word + '」被正确读出,可以用了。'
          : '接口通了,但读出的内容不对(返回:' + (got.slice(0, 16) || '空') + ')。请确认用的是视觉模型,而不是纯文字模型。';
        msg.className = 'ai-msg ' + (okv ? 'ok' : 'bad');
      }, function (e) {
        self.disabled = false;
        msg.textContent = '识图失败:' + ((e && e.message) || e);
        msg.className = 'ai-msg bad';
      });
    });

    if ($('aiClear')) $('aiClear').addEventListener('click', function () {
      LLM.clearKey();
      $('aiKey').value = '';
      renderChannelLine($('aiLine'));
      $('aiMsg').textContent = '已从本机清除密钥'; $('aiMsg').className = 'ai-msg ok';
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if ($('setModal') && !$('setModal').hidden) closeSettings();
    });
  }

  /* ============================================================
   * 三、批改结果卡片
   * ========================================================== */

  function roleBar(roleInfo, role) {
    return '<div class="badge-role">' + (role === 'teacher' ? '老师模式' : '学生模式') + ' —— ' +
      esc(roleInfo && roleInfo.reason ? roleInfo.reason : '') + '</div>';
  }
  function srcBar(ctx) {
    if (!ctx || !ctx.imgSrc) return '';
    return '<div class="src-bar">原文来自图片识别(共 ' + ctx.imgSrc.pages + ' 页),已按校对后的文字批改。若识别有出入,请改好原文重新发我。</div>';
  }
  function metaGrid(items) {
    return '<div class="meta-grid">' + items.map(function (i) {
      return '<div><span>' + esc(i[0]) + '</span><b>' + esc(i[1]) + '</b></div>';
    }).join('') + '</div>';
  }
  function aiMetaBar(meta) {
    if (!meta) return '';
    var iss = meta.issues || {};
    var okQuotes = iss.quoteDropped ? '有 ' + iss.quoteDropped + ' 处引文未通过校验,已换用原文里的句子' : '引文全部通过逐字校验';
    var badges = [(meta.channel || meta.model), (meta.ms / 1000).toFixed(1) + ' 秒', okQuotes];
    if (iss.demoBlocked) badges.push('拦截 ' + iss.demoBlocked + ' 处代写内容');
    if (iss.sectionsMissing && iss.sectionsMissing.length) badges.push('结构提示:' + iss.sectionsMissing.join('、'));
    var h = '<div class="ai-meta">' + badges.filter(Boolean).map(function (b) { return '<span>' + esc(b) + '</span>'; }).join('') + '</div>';
    if (meta.raw) {
      h += '<details class="more ai-rawwrap"><summary>查看大模型原始输出(未校验,仅用于复核)</summary><pre class="ai-raw">' + esc(meta.raw) + '</pre></details>';
    }
    return h;
  }
  function diffHtml(unit, an, prev) {
    if (!prev || !prev.levels || !prev.levels.length) return '';
    var up = [], stay = [];
    var order = { poor: 0, part: 1, good: 2 };
    an.focusLevels.forEach(function (f, i) {
      var before = prev.levels[i];
      if (!before) return;
      if (order[f.level] > order[before]) up.push(unit.focus[i].label);
      if (before !== 'good' && order[f.level] <= order[before]) stay.push(unit.focus[i].label);
    });
    if (!up.length && !stay.length) return '';
    var out = '<div class="diff">本次与上次提交对比:';
    if (up.length) out += ' <span class="up">已改善 —— ' + esc(up.join('、')) + '</span>';
    if (stay.length) out += (up.length ? ';' : '') + ' <span class="stay">仍需努力 —— ' + esc(stay.join('、')) + '</span>';
    return out + '</div>';
  }

  function teacherHtml(r, ctx) {
    var h = r.header;
    var s = '';
    s += roleBar(ctx.roleInfo, 'teacher');
    s += srcBar(ctx);
    s += aiMetaBar(ctx.aiMeta);
    s += metaGrid([['单元', r.unit.no], ['字数', h.chars + ' 字'], ['段落', h.paras + ' 段'], ['句子', h.sents + ' 句']]);
    s += diffHtml(r.unit, { focusLevels: r.trainPoints.map(function (t) { return { level: t.level }; }) }, ctx.prev);

    s += '<div class="sec"><h2>单元训练点</h2>';
    s += r.trainPoints.map(function (t) {
      var L = LEVEL[t.level];
      return '<div class="tp"><div class="lb">' + esc(t.label) +
        (t.notes.length ? '<div class="bs">检测依据:' + esc(t.notes.join(' / ')) + '</div>' : '') +
        '</div><span class="chip ' + L.c + '">' + L.t + '</span></div>';
    }).join('') + '</div>';

    s += '<div class="sec"><h2>两个优点</h2>';
    if (r.strengths && r.strengths.length) {
      s += r.strengths.map(function (x, i) {
        return '<div class="card quote"><p class="q">' + (i + 1) + '.「' + esc(x.quote) + '」</p>' +
          '<p class="w">写得好的地方:' + esc(x.why) + '。对应训练点:' + esc(x.focus) + '。</p></div>';
      }).join('');
    } else {
      s += '<div class="card note-block">全文以概括性叙述为主,细节描写还不多,暂未提取到足够突出的句子。建议先从"写出具体的样子、动作或感受"入手。</div>';
    }
    s += '</div>';

    s += '<div class="sec"><h2>一个主要问题</h2>';
    s += '<div class="card ' + (r.problem.level === 'poor' ? 'badcard' : 'warncard') + '">' +
      '<p class="q" style="margin:0 0 8px;font-size:14px;line-height:1.75">「' + esc(r.problem.quote) + '」</p>' +
      '<div class="note-block">' +
      '<div><strong>对应训练点:</strong>' + esc(r.problem.focus) + '</div>' +
      '<div><strong>问题归因:</strong>' + esc(r.problem.cause) + '</div>' +
      (r.problem.basis ? '<div><strong>检测依据:</strong>' + esc(r.problem.basis) + '</div>' : '') +
      '</div></div>';
    s += '<div class="card note-block"><strong>怎么改:</strong>' + esc(r.problem.advice) + '</div>';
    if (r.problem.demo) {
      s += '<div class="card note-block demo"><strong>示范改写(仅供参考,建议不直接发给学生):</strong>' + esc(r.problem.demo) + '</div>';
    }
    s += '</div>';

    if (r.advance && r.advance.length) {
      s += '<div class="sec"><h2>下一步可以再上一层楼</h2>';
      s += r.advance.map(function (a) {
        var L = LEVEL[a.level];
        return '<div class="card"><div style="display:flex;gap:10px;align-items:flex-start"><div style="flex:1">' +
          '<strong style="font-size:14px">' + esc(a.focus) + '</strong>' +
          '<div class="note-block" style="margin-top:4px">' + esc(a.advice) + '</div></div>' +
          '<span class="chip ' + L.c + '">' + L.t + '</span></div></div>';
      }).join('');
      s += '</div>';
    }

    s += '<div class="sec"><h2>面批金句</h2><div class="quotes"><ol>' +
      (r.quotes || []).map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol></div></div>';

    if (r.disagreements && r.disagreements.length) {
      s += '<details class="more"><summary>大模型对判定有 ' + r.disagreements.length + ' 条不同看法(供参考,未改变上面的判定)</summary><div class="inner"><ul>' +
        r.disagreements.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div></details>';
    }

    if (r.pitfalls && r.anchors) {
      s += '<details class="more"><summary>本单元常见问题与课文写法锚点(供面批时备用)</summary><div class="inner">' +
        '<div><strong>本单元常见问题</strong><ul>' + r.pitfalls.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>' +
        (r.anchors.length ? '<div style="margin-top:8px"><strong>课文写法锚点</strong><ul>' + r.anchors.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>' : '') +
        '</div></details>';
    }

    s += toolbarHtml();
    return s;
  }

  function studentHtml(r, ctx) {
    var h = r.header;
    var s = '';
    s += roleBar(ctx.roleInfo, 'student');
    s += srcBar(ctx);
    s += aiMetaBar(ctx.aiMeta);
    s += metaGrid([['单元', r.unit.no], ['字数', h.chars + ' 字'], ['段落', h.paras + ' 段'], ['句子', h.sents + ' 句']]);

    s += '<div class="sec"><h2>我读到的亮点</h2>';
    if (r.highlight) {
      s += '<div class="card quote"><p class="q">「' + esc(r.highlight.quote) + '」</p><p class="w">' + esc(r.highlight.why) + '</p></div>';
    } else {
      s += '<div class="card note-block">' + esc(r.highlightFallback) + '</div>';
    }
    s += '</div>';

    s += '<div class="sec"><h2>想一想(先回答,再动手改)</h2><ol class="qlist">' +
      r.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol>' +
      '<p class="promise">这一页不会给你现成的句子 —— 想清楚上面几个问题,自己动笔改。</p></div>';

    s += '<div class="sec"><h2>自我检查清单</h2><ul class="checklist">' +
      r.checklist.map(function (c) {
        return '<li><span class="box"></span><span>' + esc(c.label) +
          '<div class="hintline">' + esc(c.hint) + '</div></span></li>';
      }).join('') + '</ul></div>';

    s += '<div class="sec"><div class="card note-block">' + esc(r.closing) + '</div></div>';
    s += toolbarHtml();
    return s;
  }

  function toolbarHtml() {
    return '<div class="toolbar">' +
      '<button type="button" data-act="copy">复制全文</button>' +
      '<button type="button" data-act="md">导出 Markdown</button>' +
      '<button type="button" data-act="print">打印 / 存为 PDF</button>' +
      '</div>';
  }

  function reportHtml(report, ctx) {
    return report.role === 'teacher' ? teacherHtml(report, ctx) : studentHtml(report, ctx);
  }

  function toMarkdown(r, ctx) {
    ctx = ctx || {};
    var L = function (l) { return LEVEL[l].t; };
    var out = [];
    out.push('# 习作批改' + (r.role === 'teacher' ? '报告' : '修改引导'));
    out.push('');
    out.push('- 单元:' + r.unit.no + '《' + r.unit.title + '》');
    if (ctx.aiMeta) out.push('- 生成方式:大模型增强(' + (ctx.aiMeta.channel || ctx.aiMeta.model) + '),训练点判定与检测依据由本地引擎给出,引文已逐字校验');
    else out.push('- 生成方式:本地检测引擎(未接通大模型)');
    if (ctx.imgSrc) out.push('- 原文来源:图片识别(共 ' + ctx.imgSrc.pages + ' 页),已按校对后的文字批改');
    if (r.role === 'teacher') {
      out.push('- 字数:' + r.header.chars + ' 字 / ' + r.header.paras + ' 段 / ' + r.header.sents + ' 句');
      out.push('');
      out.push('## 一、单元训练点');
      r.trainPoints.forEach(function (t) { out.push('- [' + L(t.level) + '] ' + t.label + (t.notes.length ? '(检测依据:' + t.notes.join(' / ') + ')' : '')); });
      out.push('');
      out.push('## 二、两个优点');
      if (r.strengths && r.strengths.length) r.strengths.forEach(function (x, i) { out.push((i + 1) + '. 「' + x.quote + '」——' + x.why + '(对应训练点:' + x.focus + ')'); });
      else out.push('全文以概括性叙述为主,细节描写还不多。');
      out.push('');
      out.push('## 三、一个主要问题');
      out.push('> 「' + r.problem.quote + '」');
      out.push('');
      out.push('- 对应训练点:' + r.problem.focus);
      out.push('- 问题归因:' + r.problem.cause);
      if (r.problem.basis) out.push('- 检测依据:' + r.problem.basis);
      out.push('');
      out.push('## 四、修改建议');
      out.push(r.problem.advice);
      if (r.problem.demo) { out.push(''); out.push('> 示范改写(建议不直接发给学生):' + r.problem.demo); }
      (r.advance || []).forEach(function (a) { out.push(''); out.push('- [' + L(a.level) + '] ' + a.focus + ':' + a.advice); });
      out.push('');
      out.push('## 五、面批金句');
      (r.quotes || []).forEach(function (q) { out.push('- ' + q); });
      if (r.disagreements && r.disagreements.length) {
        out.push(''); out.push('## 附:大模型的不同看法(未改变上述判定)');
        r.disagreements.forEach(function (d) { out.push('- ' + d); });
      }
      if (r.pitfalls) {
        out.push('');
        out.push('## 附:本单元常见问题');
        r.pitfalls.forEach(function (p) { out.push('- ' + p); });
      }
    } else {
      out.push('- 字数:' + r.header.chars + ' 字 / ' + r.header.paras + ' 段');
      out.push('');
      out.push('## 我读到的亮点');
      out.push(r.highlight ? '「' + r.highlight.quote + '」——' + r.highlight.why : r.highlightFallback);
      out.push('');
      out.push('## 想一想');
      r.questions.forEach(function (q, i) { out.push((i + 1) + '. ' + q); });
      out.push('');
      out.push('## 自我检查清单');
      r.checklist.forEach(function (c) { out.push('- [ ] ' + c.label + '(' + c.hint + ')'); });
      out.push('');
      out.push(r.closing);
    }
    out.push('');
    out.push('---');
    out.push('由「习作批改助手」生成,批改依据单元训练点逐条检测,判断可复核。');
    return out.join('\n');
  }

  function bindToolbar(container, report, ctx) {
    var box = container.querySelector('.toolbar');
    if (!box) return;
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'print') { window.print(); return; }
      var md = toMarkdown(report, ctx);
      if (act === 'copy') {
        if (navigator.clipboard) navigator.clipboard.writeText(md).then(function () { toast('已复制到剪贴板'); }, function () { toast('复制失败,请手动选择'); });
        else toast('当前浏览器不支持一键复制');
      } else if (act === 'md') {
        var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (report.role === 'teacher' ? '批改报告_' : '修改引导_') + report.unit.title + '.md';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
        toast('已导出 Markdown');
      }
    });
  }

  /* ============================================================
   * 初始化
   * ========================================================== */
  function init(opts) {
    opts = opts || {};
    if (opts.toast) hooks.toast = opts.toast;
    if (opts.onFiles) hooks.onFiles = opts.onFiles;
    initSettings();
    initAttach();
  }

  global.XZ_UI = {
    init: init,
    compressFiles: compressFiles,
    ocrPages: ocrPages,
    openZoom: openZoom,
    renderChannelLine: renderChannelLine,
    openSettings: openSettings,
    reportHtml: reportHtml,
    bindToolbar: bindToolbar
  };
})(typeof window !== 'undefined' ? window : this);
