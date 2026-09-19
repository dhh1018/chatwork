(function () {
  'use strict';

  var KB = window.XZ_KB, ENG = window.XZ_ENGINE, LLM = window.XZ_LLM, XIMG = window.XZ_IMG;
  var LEVEL = {
    good: { t: '达成', c: 'ok' },
    part: { t: '部分达成', c: 'warn' },
    poor: { t: '待突破', c: 'bad' }
  };
  var state = {
    role: 'auto', book: '5a', unitId: null, report: null, roleInfo: null, aiBusy: false, aiCtrl: null,
    images: [], ocrBusy: false, ocrCtrl: null, imgSrc: null
  };
  var imgSeq = 0;
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('on'); }, 2400);
  }
  function unitList(bookId) { return KB.books[bookId].units; }
  function currentUnit() {
    var list = unitList(state.book);
    for (var i = 0; i < list.length; i++) if (list[i].id === state.unitId) return list[i];
    return list[0];
  }
  function store(key, val) { try { if (val === undefined) { return JSON.parse(localStorage.getItem(key)); } localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; } }

  /* ---------- 初始化 ---------- */
  function fillBooks() {
    var sel = $('bookSel');
    sel.innerHTML = Object.keys(KB.books).map(function (k) {
      return '<option value="' + k + '">' + esc(KB.books[k].name) + '</option>';
    }).join('');
    sel.value = state.book;
  }
  function fillUnits() {
    var sel = $('unitSel');
    var list = unitList(state.book);
    if (!list.some(function (u) { return u.id === state.unitId; })) state.unitId = list[0].id;
    sel.innerHTML = list.map(function (u) {
      return '<option value="' + u.id + '">' + esc(u.no + ' · ' + u.title) + '</option>';
    }).join('');
    sel.value = state.unitId;
    renderBrief();
  }
  function renderBrief() {
    var u = currentUnit();
    $('unitBrief').innerHTML =
      '<b>' + esc(u.no + '《' + u.title + '》') + '</b><br>' +
      esc(u.task) +
      '<ul>' + u.focus.map(function (f) { return '<li>' + esc(f.label) + '</li>'; }).join('') + '</ul>';
  }

  /* ---------- 习作图片 ----------
   * 图片是"来源",正文才是唯一权威。识别结果必须经人工校对并主动采用,
   * 才会进入正文 —— 识别错了却直接拿去批改,是这条链路唯一真正的风险。
   * ------------------------------ */

  function itemById(id) {
    for (var i = 0; i < state.images.length; i++) if (String(state.images[i].id) === String(id)) return state.images[i];
    return null;
  }
  function itemIndex(item) { return state.images.indexOf(item); }
  function charsOf(item) { return (item.text || '').replace(/[\s\u3000]/g, '').length; }

  /** 计算"真正要送出去的那张图"（应用旋转与增强）；无操作时直接用原图,不做无谓重编码 */
  function prepare(item) {
    if (!item.src) return Promise.resolve(item);
    if (!item.rot && !item.enh) { item.shown = item.src; return Promise.resolve(item); }
    return XIMG.exportDataUrl(item).then(function (r) {
      item.shown = r.url; item.outW = r.w; item.outH = r.h;
      return item;
    }, function () { item.shown = item.src; return item; });
  }

  function addFiles(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var room = XIMG.MAX_PAGES - state.images.length;
    if (room <= 0) { toast('单次最多 ' + XIMG.MAX_PAGES + ' 页,请先移除一些'); return; }

    var usable = [], skipped = 0;
    list.forEach(function (f) { if (XIMG.isImageFile(f)) usable.push(f); else skipped++; });
    if (usable.length > room) { skipped += usable.length - room; usable = usable.slice(0, room); }
    if (!usable.length) { toast('没有可用的图片文件(支持 jpg / png / webp / 截图)'); return; }

    $('imgCount').textContent = '处理中…';
    var failed = [];
    Promise.all(usable.map(function (f) {
      return XIMG.compress(f).then(function (r) {
        return {
          id: ++imgSeq, name: f.name || '图片', src: r.src, w: r.w, h: r.h,
          origW: r.origW, origH: r.origH, scaled: !!r.scaled,
          rot: 0, enh: false, status: 'idle', text: '', shown: '', err: '', notes: []
        };
      }, function (e) {
        var msg = (e && e.message) || String(e);
        failed.push(msg);
        return null;
      });
    })).then(function (items) {
      items.forEach(function (it) { if (it) state.images.push(it); });
      var ok = items.filter(Boolean).length;
      if (failed.length) toast(failed.length + ' 张读取失败:' + failed[0].slice(0, 46));
      else if (ok) toast('已添加 ' + ok + ' 张图片' + (ok > 1 ? ',请确认页序正确' : ''));
      if (skipped) toast((skipped ? skipped + ' 个文件被跳过。' : '') + (failed[0] || ''));
      if (!ok) return;
      renderThumbs();
      openOcr();
    });
  }

  function renderThumbs() {
    var box = $('thumbs'), acts = $('imgActions');
    if (!state.images.length) {
      box.hidden = true; box.innerHTML = '';
      acts.hidden = true;
      $('imgCount').textContent = '未添加';
      renderImgHint();
      return;
    }
    box.hidden = false; acts.hidden = false;
    $('imgCount').textContent = state.images.length + ' 页';
    box.innerHTML = state.images.map(function (it, i) {
      var st = it.status;
      var label = st === 'ok' ? charsOf(it) + ' 字' : st === 'run' ? '识别中' : st === 'fail' ? '失败' : '待识别';
      var cls = st === 'ok' ? 'ok' : st === 'fail' ? 'bad' : st === 'run' ? 'run' : '';
      var img = it.shown || it.src;
      return '<div class="thumb" data-id="' + it.id + '">' +
        '<div class="thumb-img" data-act="open" title="点击打开校对面板">' +
        (img ? '<img src="' + esc(img) + '" alt="第 ' + (i + 1) + ' 页">' : '<div class="thumb-bad">!</div>') +
        '<span class="thumb-no">' + (i + 1) + '</span>' +
        '</div>' +
        '<div class="thumb-st ' + cls + '">' + esc(label) + '</div>' +
        '<button type="button" class="thumb-del" data-act="del" aria-label="移除第 ' + (i + 1) + ' 页">×</button>' +
        '</div>';
    }).join('');
    renderImgHint();
  }

  function renderImgHint() {
    var h = $('imgHint');
    if (!state.images.length) {
      h.textContent = '手写习作建议每页拍一张、拍正、光线均匀;识别准确率会明显提高。图片不会保存到本机,刷新页面即消失。';
      return;
    }
    var vs = LLM ? LLM.visionStatusText() : { on: false, text: '' };
    h.textContent = vs.on
      ? '识别结果必须对照图片校对一遍再用 —— 识别错了,批改就跟着批错。'
      : '当前未配置视觉模型,可打开校对面板对着图片把文字录入;配好视觉模型即可自动识别。';
  }

  /* ----- 校对面板 ----- */
  function openOcr() {
    if (!state.images.length) { toast('先添加习作图片'); return; }
    renderOcr();
    $('ocrModal').hidden = false;
  }
  function closeOcr() { $('ocrModal').hidden = true; }
  function renderOcr() { renderOcrBar(); renderOcrBody(); renderOcrSum(); }

  function renderOcrBar() {
    var vs = LLM ? LLM.visionStatusText() : { on: false, text: '接口层未加载' };
    var html = '<span class="dot ' + (vs.on ? 'on' : 'off') + '"></span><span class="ocr-status">' + esc(vs.text) + '</span>';
    html += '<span class="grow"></span>';
    if (state.ocrBusy) {
      html += '<button type="button" class="ghost sm" data-act="stop">停止识别</button>';
    } else if (vs.on) {
      var undone = state.images.filter(function (i) { return i.src && i.status !== 'ok'; }).length;
      var done = state.images.filter(function (i) { return i.status === 'ok'; }).length;
      html += '<button type="button" class="ghost sm" data-act="runall">' +
        (done && undone ? '识别未完成的 ' + undone + ' 页' : '识别全部页面') + '</button>';
    } else {
      html += '<button type="button" class="linkbtn" data-act="setting">去填视觉模型</button>';
    }
    $('ocrBar').innerHTML = html;
  }

  function renderOcrBody() {
    $('ocrBody').innerHTML = state.images.map(function (it, i) {
      var st = it.status;
      var stTxt = st === 'ok' ? '已识别 · ' + charsOf(it) + ' 字' : st === 'run' ? '识别中…' : st === 'fail' ? '识别失败' : '尚未识别';
      var img = it.shown || it.src;
      return '<div class="ocr-page" data-id="' + it.id + '">' +
        '<div class="ocr-tools">' +
        '<span class="pgno">第 ' + (i + 1) + ' 页</span>' +
        '<span class="ocr-st ' + st + '">' + esc(stTxt) + '</span>' +
        '<span class="grow"></span>' +
        '<button type="button" class="ghost sm" data-act="rot" title="每点一次向左转 90°">旋转</button>' +
        '<button type="button" class="ghost sm' + (it.enh ? ' on' : '') + '" data-act="enh" title="灰度化并拉伸对比度,拍暗了的照片会清楚很多">' + (it.enh ? '已增强' : '增强') + '</button>' +
        '<button type="button" class="ghost sm" data-act="page">识本页</button>' +
        '<button type="button" class="ghost sm" data-act="up"' + (i === 0 ? ' disabled' : '') + '>前移</button>' +
        '<button type="button" class="ghost sm" data-act="down"' + (i === state.images.length - 1 ? ' disabled' : '') + '>后移</button>' +
        '<button type="button" class="ghost sm" data-act="del">移除</button>' +
        '</div>' +
        '<div class="ocr-pair">' +
        '<div class="ocr-imgwrap">' +
        (img
          ? '<img src="' + esc(img) + '" data-act="zoom" alt="第 ' + (i + 1) + ' 页习作图片">'
          : '<div class="ocr-imgbad">' + esc(it.err || '图片读取失败') + '</div>') +
        (it.scaled ? '<div class="ocr-imgmeta">原图 ' + it.origW + '×' + it.origH + ' → 已压缩为 ' + it.w + '×' + it.h + '</div>' : '') +
        '</div>' +
        '<div class="ocr-textwrap">' +
        '<textarea class="ocr-text" data-act="text" placeholder="识别结果会出现在这里。没有视觉模型时,请对着左边的照片把文字打进来 —— 错别字、病句、标点都照原样,不要顺手改对。">' + esc(it.text || '') + '</textarea>' +
        (it.err ? '<div class="ocr-err">' + esc(it.err) + '</div>' : '') +
        (it.notes && it.notes.length ? '<div class="ocr-note">' + esc(it.notes.join(';')) + '</div>' : '') +
        '</div>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function renderOcrSum() {
    var pages = state.images.length;
    var done = state.images.filter(function (i) { return i.status === 'ok'; }).length;
    var merged = mergedOcrText(false);
    var total = merged.replace(/[\s\u3000]/g, '').length;
    $('ocrSum').innerHTML = '共 <b>' + pages + '</b> 页 · 已识别 <b>' + done + '</b> 页 · 合入正文 <b>' + total + '</b> 字';
    $('ocrApply').disabled = !total;
  }

  /** 按当前页序拼合各页文字;forApply 时遵守"页间分段"开关 */
  function mergedOcrText(forApply) {
    var sep = '\n\n';
    if (forApply) {
      var cb = $('ocrPara');
      if (cb && !cb.checked) sep = '\n';
    }
    return state.images.map(function (i) {
      return String(i.text || '').replace(/^\s+|\s+$/g, '');
    }).filter(Boolean).join(sep);
  }

  /* ----- 识别编排 ----- */
  function runOcr(targets) {
    if (state.ocrBusy) return;
    if (!LLM || !LLM.isVisionReady()) {
      toast('先填写视觉模型名与密钥,才能自动识别');
      openSettings();
      return;
    }
    var todo;
    if (targets && targets.length) {
      todo = targets.filter(function (i) { return i.src; });
    } else {
      todo = state.images.filter(function (i) { return i.src && i.status !== 'ok'; });
      if (!todo.length) { toast('所有页面都已识别。要重识某一页,点该页的「识本页」'); return; }
    }
    if (!todo.length) { toast('没有可识别的图片'); return; }

    var ctrl = new AbortController();
    state.ocrCtrl = ctrl;
    state.ocrBusy = true;
    renderOcrBar(); renderOcrBody(); renderOcrSum();

    var i = 0, okN = 0, failN = 0;

    function step() {
      if (ctrl.signal.aborted || i >= todo.length) return Promise.resolve();
      var item = todo[i++];
      item.status = 'run'; item.err = ''; item.notes = []; item.buf = '';
      renderOcrBar(); renderThumbs();
      renderOcrBody();
      var ta = $('ocrBody').querySelector('.ocr-page[data-id="' + item.id + '"] textarea');
      if (ta) ta.value = '';

      return XIMG.exportDataUrl(item).then(function (r) {
        item.shown = r.url;
        return LLM.ocrImage({
          imageUrl: r.url,
          index: itemIndex(item) + 1,
          total: state.images.length,
          signal: ctrl.signal,
          onDelta: function (d) {
            item.buf += d;
            var box = $('ocrBody').querySelector('.ocr-page[data-id="' + item.id + '"] textarea');
            if (box) { box.value = item.buf; box.scrollTop = box.scrollHeight; }
          }
        });
      }).then(function (r) {
        if (ctrl.signal.aborted) { item.status = 'idle'; item.text = ''; return; }
        if (r.unreadable) {
          item.status = 'fail'; item.text = '';
          item.err = '这张图里没有读出作文文字(画面可能过暗、过糊,或拍的不是作文)。可重拍后点「识本页」重试,或直接在右侧手工录入。';
          failN++;
        } else {
          item.status = 'ok'; item.text = r.text; item.notes = r.notes || [];
          okN++;
        }
      }, function (e) {
        if (ctrl.signal.aborted) { item.status = 'idle'; item.text = ''; return; }
        item.status = 'fail'; item.notes = [];
        item.err = ((e && e.message) || String(e)) + ' 可点「识本页」重试。';
        failN++;
      }).then(function () {
        item.buf = '';
        renderOcrBody();
        return step();
      });
    }

    return step().then(function () {
      state.ocrBusy = false;
      state.ocrCtrl = null;
      renderOcrBar(); renderOcrBody(); renderOcrSum(); renderThumbs();
      if (ctrl.signal.aborted) { toast('已停止识别'); return; }
      if (!failN) toast('识别完成:' + okN + ' 页,请逐页对照图片校对');
      else toast('识别完成:' + okN + ' 页成功,' + failN + ' 页失败可重试');
    });
  }

  function stopOcr() {
    if (state.ocrCtrl) { try { state.ocrCtrl.abort(); } catch (e) { } }
  }

  /* ----- 逐页操作 ----- */
  function updatePageVisual(item) {
    var page = $('ocrBody').querySelector('.ocr-page[data-id="' + item.id + '"]');
    if (page) {
      var img = page.querySelector('img');
      if (img) img.src = item.shown || item.src;
      var enh = page.querySelector('button[data-act="enh"]');
      if (enh) { enh.textContent = item.enh ? '已增强' : '增强'; enh.classList.toggle('on', !!item.enh); }
    }
    var th = $('thumbs').querySelector('.thumb[data-id="' + item.id + '"] img');
    if (th) th.src = item.shown || item.src;
  }

  function moveItem(item, dir) {
    var i = itemIndex(item), j = i + dir;
    if (i < 0 || j < 0 || j >= state.images.length) return;
    state.images[i] = state.images[j];
    state.images[j] = item;
    var sc = $('ocrBody').scrollTop;
    renderOcrBody(); renderThumbs(); renderOcrSum();
    $('ocrBody').scrollTop = sc;
    toast('已' + (dir < 0 ? '前移' : '后移') + ',当前第 ' + (j + 1) + ' 页');
  }

  function removeItem(item) {
    var i = itemIndex(item);
    if (i < 0) return;
    state.images.splice(i, 1);
    renderThumbs(); renderOcrSum();
    if (!state.images.length) { closeOcr(); toast('图片已清空'); return; }
    var sc = $('ocrBody').scrollTop;
    renderOcrBody(); renderOcrBar();
    $('ocrBody').scrollTop = sc;
  }

  function openZoom(item) {
    var src = item.shown || item.src;
    if (!src) return;
    $('zoomImg').src = src;
    $('zoomBox').hidden = false;
  }

  /* ----- 采用到正文 ----- */
  function applyOcr() {
    var text = mergedOcrText(true);
    if (!text) { toast('还没有可用文字:先识别,或对着图片录入'); return; }
    var mode = (document.querySelector('input[name=ocrMode]:checked') || {}).value || 'replace';
    var ta = $('essay');
    var out = text;
    if (mode === 'append') {
      var cur = ta.value.replace(/^\s+|\s+$/g, '');
      if (cur) out = cur + '\n\n' + text;
    }
    ta.value = out;
    $('charCount').textContent = out.replace(/\s/g, '').length + ' 字';
    state.imgSrc = { pages: state.images.length, ts: Date.now() };
    closeOcr();
    ta.focus();
    toast('已写入正文 ' + out.replace(/\s/g, '').length + ' 字,校对无误后再开始批改');
  }

  function clearImages() {
    stopOcr();
    state.images = [];
    renderThumbs();
    closeOcr();
    toast('图片已清空');
  }

  /* ---------- 大模型状态 ---------- */
  function renderAiStatus() {
    if (!LLM) { $('aiLine').innerHTML = ''; return; }
    var st = LLM.statusText();
    $('aiLine').innerHTML = '<span class="dot ' + (st.on ? 'on' : 'off') + '"></span>' + esc(st.text) +
      '<button type="button" class="linkbtn" id="aiLineSet">设置</button>';
    var b = $('aiLineSet');
    if (b) b.addEventListener('click', openSettings);
  }

  /* ---------- 运行 ---------- */
  function run() {
    var essay = $('essay').value.trim();
    if (essay.length < 30) {
      if (state.images.length) {
        toast('正文还是空的:先在「识别图片文字」里识别或录入,再点「采用到正文」');
        openOcr();
      } else {
        toast('习作原文太短了,先把文章粘贴进来或上传习作照片');
      }
      return;
    }
    if (essay.length > 6000) { toast('单次最多处理 6000 字,请分段批改'); return; }

    var unit = currentUnit();
    var note = $('note').value.trim();
    var roleInfo;
    if (state.role === 'auto') roleInfo = ENG.detectRole(essay + ' ' + note);
    else roleInfo = { role: state.role, confident: true, reason: '已手动选定' + (state.role === 'teacher' ? '老师模式' : '学生模式') };

    var an = ENG.analyze(unit, essay);
    var local = roleInfo.role === 'teacher' ? ENG.buildTeacher(unit, an) : ENG.buildStudent(unit, an);
    local.unit = unit;

    var prev = store('xz_last_' + unit.id);
    state.report = { report: local, roleInfo: roleInfo, prev: prev, unit: unit };
    render(local, roleInfo, prev, null);

    store('xz_last_' + unit.id, { levels: an.focusLevels.map(function (f) { return f.level; }), ts: Date.now() });
    var hist = store('xz_history') || [];
    hist.unshift({ unit: unit.no + '《' + unit.title + '》', role: roleInfo.role, chars: an.ctx.chars, ts: Date.now() });
    store('xz_history', hist.slice(0, 30));

    if (LLM && LLM.isReady()) {
      aiEnhance({ unit: unit, bookName: KB.books[state.book].name, essay: essay, note: note, local: local, roleInfo: roleInfo, prev: prev });
    } else if (LLM && LLM.loadConfig().enabled) {
      toast('大模型配置不完整,本次由本地引擎完成');
    }
  }

  function render(report, roleInfo, prev, aiMeta) {
    var el = $('result');
    el.innerHTML = (roleInfo.role === 'teacher' ? teacherHtml(report, roleInfo, prev, aiMeta) : studentHtml(report, roleInfo, prev, aiMeta));
    bindToolbar(report);
    if (window.innerWidth <= 900) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 大模型增强调用 ---------- */
  function aiEnhance(ctx) {
    var cfg = LLM.loadConfig();
    if (state.aiCtrl) { try { state.aiCtrl.abort(); } catch (e) { } }
    var ctrl = new AbortController();
    state.aiCtrl = ctrl;
    state.aiBusy = true;

    var box = document.createElement('div');
    box.className = 'ai-box';
    box.innerHTML = '<div class="ai-head"><span class="spinner"></span><b>大模型增强批改中</b>' +
      '<span class="ai-model">' + esc(cfg.model) + '</span>' +
      '<button type="button" class="linkbtn" data-act="abort">停止</button></div>' +
      '<pre class="ai-raw"></pre>' +
      '<p class="ai-tip">本地报告已生成,大模型只负责把检测结果讲得更贴合学生;判定与引文仍以本地检测为准。</p>';
    var el = $('result');
    el.insertBefore(box, el.firstChild);
    box.querySelector('[data-act="abort"]').addEventListener('click', function () { ctrl.abort(); });

    var pre = box.querySelector('.ai-raw');
    var btn = $('runBtn');
    btn.disabled = true; btn.textContent = '批改中…';

    LLM.run({
      role: ctx.roleInfo.role, unit: ctx.unit, bookName: ctx.bookName, essay: ctx.essay, note: ctx.note,
      local: ctx.local, signal: ctrl.signal,
      onDelta: function (d) { pre.textContent += d; pre.scrollTop = pre.scrollHeight; }
    }).then(function (r) {
      state.aiBusy = false;
      btn.disabled = false; btn.textContent = '开始批改';
      r.report.aiMeta = { model: cfg.model, ms: r.ms, raw: r.raw, issues: r.issues };
      state.report = { report: r.report, roleInfo: ctx.roleInfo, prev: ctx.prev, unit: ctx.unit };
      render(r.report, ctx.roleInfo, ctx.prev, r.report.aiMeta);
      toast('大模型增强完成 · 引文已逐字校验');
    }, function (e) {
      state.aiBusy = false;
      btn.disabled = false; btn.textContent = '开始批改';
      var msg = (e && e.message) || String(e);
      box.remove();
      var n = document.createElement('div');
      n.className = 'ai-fail';
      n.innerHTML = '<b>大模型增强未生效,已回退到本地检测报告(内容完整可用)</b>' +
        '<div class="reason">' + esc(msg) + '</div>' +
        '<button type="button" class="linkbtn" id="aiFailSet">检查接口设置</button>';
      var el2 = $('result');
      el2.insertBefore(n, el2.firstChild);
      n.querySelector('#aiFailSet').addEventListener('click', openSettings);
    });
  }

  /* ---------- 设置面板 ---------- */
  function fillPresetOptions() {
    $('aiPreset').innerHTML = LLM.PRESETS.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
    }).join('');
    $('aiTemp').innerHTML = LLM.TEMPS.map(function (t) {
      return '<option value="' + t.v + '">' + esc(t.t) + '</option>';
    }).join('');
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
      ? '留空则关闭图片自动识别。手写作文必须由视觉模型识别,普通文字模型不行。'
      : '这个服务商没有视觉模型,图片无法自动识别(仍可上传后对照录入)。想自动识别请换用通义千问、智谱 GLM 或硅基流动。';
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

  /** 画一张写着已知文字的测试图,用来验证"这个模型到底能不能读图" */
  function makeProbeImage() {
    var words = ['习作批改', '作文本子', '五年级', '小学习作'];
    var w = words[Math.floor(state.images.length + (new Date().getTime() / 1000 | 0)) % words.length];
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
    $('setBtn').addEventListener('click', openSettings);
    $('setClose').addEventListener('click', closeSettings);
    $('setModal').addEventListener('click', function (e) { if (e.target === this) closeSettings(); });
    $('aiPreset').addEventListener('change', syncPresetNote);
    $('aiSave').addEventListener('click', function () {
      var c = collectSettings();
      if (c.enabled && (!c.baseUrl || !c.model)) { $('aiMsg').textContent = '启用前请填写接口地址与模型名'; $('aiMsg').className = 'ai-msg bad'; return; }
      if (c.enabled && !LLM.isRelative(c.baseUrl) && !c.apiKey) { $('aiMsg').textContent = '启用前请填写 API Key(或改填自建代理地址)'; $('aiMsg').className = 'ai-msg bad'; return; }
      LLM.saveConfig(c);
      renderAiStatus();
      $('aiMsg').textContent = c.enabled ? '已保存,下次批改将由大模型增强' : '已保存(当前使用本地引擎)';
      $('aiMsg').className = 'ai-msg ok';
      toast('接口设置已保存');
      setTimeout(closeSettings, 700);
    });
    $('aiTest').addEventListener('click', function () {
      var msg = $('aiMsg');
      if (!$('aiBase').value.trim() || !$('aiModel').value.trim()) { msg.textContent = '先填接口地址与模型名'; msg.className = 'ai-msg bad'; return; }
      LLM.saveConfig(collectSettings());
      msg.textContent = '正在测试连接…'; msg.className = 'ai-msg';
      this.disabled = true;
      var self = this;
      LLM.testConnection().then(function (r) {
        self.disabled = false;
        msg.textContent = r.msg;
        msg.className = 'ai-msg ' + (r.ok ? 'ok' : 'bad');
      });
    });
    $('aiTestVision').addEventListener('click', function () {
      var msg = $('aiMsg');
      if (!$('aiVision').value.trim()) { msg.textContent = '先填视觉模型名(例如 qwen-vl-max、glm-4v-plus)'; msg.className = 'ai-msg bad'; return; }
      LLM.saveConfig(collectSettings());
      if (!LLM.isVisionReady()) { msg.textContent = '识图配置不完整:接口地址、密钥、视觉模型名都要填好'; msg.className = 'ai-msg bad'; return; }
      msg.textContent = '正在用一张写着已知文字的测试图验证识图能力…'; msg.className = 'ai-msg';
      var self = this; self.disabled = true;
      var probe = makeProbeImage();
      LLM.ocrImage({ imageUrl: probe.url, index: 1, total: 1, maxTokens: 60, timeout: 60000 }).then(function (r) {
        self.disabled = false;
        var got = String(r.text || '').replace(/[\s\u3000]/g, '');
        var ok = got.indexOf(probe.word) !== -1;
        msg.textContent = ok
          ? '识图正常:测试图上的「' + probe.word + '」被正确读出,可以用了。'
          : '接口通了,但读出的内容不对(返回:' + (got.slice(0, 16) || '空') + ')。请确认填的是视觉模型,而不是纯文字模型。';
        msg.className = 'ai-msg ' + (ok ? 'ok' : 'bad');
      }, function (e) {
        self.disabled = false;
        msg.textContent = '识图失败:' + ((e && e.message) || e);
        msg.className = 'ai-msg bad';
      });
    });
    $('aiClear').addEventListener('click', function () {
      LLM.clearKey();
      $('aiKey').value = '';
      renderAiStatus();
      var msg = $('aiMsg'); msg.textContent = '已从本机清除密钥'; msg.className = 'ai-msg ok';
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('setModal').hidden) closeSettings(); });
  }

  /* ---------- 公共片段 ---------- */
  function roleBar(roleInfo, role) {
    return '<div class="badge-role">已识别为 <b>' + (role === 'teacher' ? '老师模式' : '学生模式') + '</b> —— ' +
      esc(roleInfo.reason) + ' <span style="margin-left:auto;color:var(--text-3)">可随时切换</span></div>';
  }
  /** 原文来自图片时的显性提示:读者要能一眼看出结论建立在"识别+人工校对"的文本上 */
  function srcBar() {
    if (!state.imgSrc) return '';
    return '<div class="src-bar">原文来自图片识别(共 ' + state.imgSrc.pages + ' 页),已按校对后的文字批改。若识别有出入,请修改正文后重新批改。</div>';
  }
  function metaGrid(items) {
    return '<div class="meta-grid">' + items.map(function (i) {
      return '<div><span>' + esc(i[0]) + '</span><b>' + esc(i[1]) + '</b></div>';
    }).join('') + '</div>';
  }
  function aiMetaBar(meta) {
    if (!meta) return '';
    var iss = meta.issues || {};
    var okQuotes = (iss.quoteDropped ? '有 ' + iss.quoteDropped + ' 处引文未通过校验,已换用本地引擎选定的原句' : '引文全部通过逐字校验');
    var badges = ['模型 ' + meta.model, (meta.ms / 1000).toFixed(1) + ' 秒', okQuotes];
    if (iss.demoBlocked) badges.push('拦截 ' + iss.demoBlocked + ' 处代写内容');
    if (iss.sectionsMissing && iss.sectionsMissing.length) badges.push('结构提示:' + iss.sectionsMissing.join('、'));
    var h = '<div class="ai-meta">' + badges.map(function (b) { return '<span>' + esc(b) + '</span>'; }).join('') + '</div>';
    if (meta.raw) {
      h += '<details class="more ai-rawwrap"><summary>查看大模型原始输出(未校验,仅用于复核)</summary><pre class="ai-raw">' + esc(meta.raw) + '</pre></details>';
    }
    return h;
  }
  function diffHtml(unit, an, prev) {
    if (!prev || !prev.levels || !prev.levels.length) return '';
    var up = [], stay = [];
    an.focusLevels.forEach(function (f, i) {
      var before = prev.levels[i];
      if (!before) return;
      var order = { poor: 0, part: 1, good: 2 };
      if (order[f.level] > order[before]) up.push(unit.focus[i].label);
      if (before !== 'good' && order[f.level] <= order[before]) stay.push(unit.focus[i].label);
    });
    if (!up.length && !stay.length) return '';
    var out = '<div class="diff">本次与上次提交对比:';
    if (up.length) out += ' <span class="up">已改善 —— ' + esc(up.join('、')) + '</span>';
    if (stay.length) out += (up.length ? ';' : '') + ' <span class="stay">仍需努力 —— ' + esc(stay.join('、')) + '</span>';
    return out + '</div>';
  }

  /* ---------- 老师模式 ---------- */
  function teacherHtml(r, roleInfo, prev, aiMeta) {
    var h = r.header;
    var s = '';
    s += roleBar(roleInfo, 'teacher');
    s += srcBar();
    s += aiMetaBar(aiMeta);
    s += metaGrid([['单元', r.unit.no], ['字数', h.chars + ' 字'], ['段落', h.paras + ' 段'], ['句子', h.sents + ' 句']]);
    s += diffHtml(r.unit, { focusLevels: r.trainPoints.map(function (t) { return { level: t.level }; }) }, prev ? { levels: prev.levels } : null);

    s += '<div class="sec"><h2>单元训练点</h2>';
    s += r.trainPoints.map(function (t) {
      var L = LEVEL[t.level];
      return '<div class="tp"><div class="lb">' + esc(t.label) +
        (t.notes.length ? '<div class="bs">检测依据:' + esc(t.notes.join(' / ')) + '</div>' : '') +
        '</div><span class="chip ' + L.c + '">' + L.t + '</span></div>';
    }).join('') + '</div>';

    s += '<div class="sec"><h2>两个优点</h2>';
    if (r.strengths.length) {
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
      r.quotes.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol></div></div>';

    if (r.disagreements && r.disagreements.length) {
      s += '<details class="more"><summary>大模型对判定有 ' + r.disagreements.length + ' 条不同看法(供参考,未改变上面的判定)</summary><div class="inner"><ul>' +
        r.disagreements.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div></details>';
    }

    s += '<details class="more"><summary>本单元常见问题与课文写法锚点(供面批时备用)</summary><div class="inner">' +
      '<div><strong>本单元常见问题</strong><ul>' + r.pitfalls.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>' +
      '<div style="margin-top:8px"><strong>课文写法锚点</strong><ul>' + r.anchors.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>' +
      '</div></details>';

    s += toolbarHtml();
    return s;
  }

  /* ---------- 学生模式 ---------- */
  function studentHtml(r, roleInfo, prev, aiMeta) {
    var h = r.header;
    var s = '';
    s += roleBar(roleInfo, 'student');
    s += srcBar();
    s += aiMetaBar(aiMeta);
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

  /* ---------- 工具 ---------- */
  function toMarkdown(r) {
    var L = function (l) { return LEVEL[l].t; };
    var out = [];
    out.push('# 习作批改' + (r.role === 'teacher' ? '报告' : '修改引导'));
    out.push('');
    out.push('- 单元:' + r.unit.no + '《' + r.unit.title + '》');
    if (r.aiMeta) out.push('- 生成方式:大模型增强(' + r.aiMeta.model + '),训练点判定与检测依据由本地引擎给出,引文已逐字校验');
    else out.push('- 生成方式:本地检测引擎');
    if (state.imgSrc) out.push('- 原文来源:图片识别(共 ' + state.imgSrc.pages + ' 页),已按校对后的文字批改');
    if (r.role === 'teacher') {
      out.push('- 字数:' + r.header.chars + ' 字 / ' + r.header.paras + ' 段 / ' + r.header.sents + ' 句');
      out.push('');
      out.push('## 一、单元训练点');
      r.trainPoints.forEach(function (t) { out.push('- [' + L(t.level) + '] ' + t.label + (t.notes.length ? '(检测依据:' + t.notes.join(' / ') + ')' : '')); });
      out.push('');
      out.push('## 二、两个优点');
      if (r.strengths.length) r.strengths.forEach(function (x, i) { out.push((i + 1) + '. 「' + x.quote + '」——' + x.why + '(对应训练点:' + x.focus + ')'); });
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
      r.quotes.forEach(function (q) { out.push('- ' + q); });
      if (r.disagreements && r.disagreements.length) {
        out.push(''); out.push('## 附:大模型的不同看法(未改变上述判定)');
        r.disagreements.forEach(function (d) { out.push('- ' + d); });
      }
      out.push('');
      out.push('## 附:本单元常见问题');
      r.pitfalls.forEach(function (p) { out.push('- ' + p); });
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

  function bindToolbar(report) {
    var box = $('result').querySelector('.toolbar');
    if (!box) return;
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'print') { window.print(); return; }
      var md = toMarkdown(report);
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

  /* ---------- 图片相关事件 ---------- */
  function initImages() {
    if (!XIMG) return;

    $('pickBtn').addEventListener('click', function (e) { e.stopPropagation(); $('fileInput').click(); });
    $('shotBtn').addEventListener('click', function (e) { e.stopPropagation(); $('camInput').click(); });
    $('dropZone').addEventListener('click', function () { $('fileInput').click(); });
    ['fileInput', 'camInput'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        if (this.files && this.files.length) addFiles(this.files);
        this.value = '';
      });
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      $('dropZone').addEventListener(ev, function (e) { e.preventDefault(); this.classList.add('on'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      $('dropZone').addEventListener(ev, function (e) { e.preventDefault(); this.classList.remove('on'); });
    });
    $('dropZone').addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) { e.preventDefault(); });

    /* 粘贴截图:粘贴到输入框里仍按文字处理,不抢 */
    document.addEventListener('paste', function (e) {
      var cb = e.clipboardData;
      if (!cb) return;
      var t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      var files = [];
      Array.prototype.forEach.call(cb.files || [], function (f) { if (XIMG.isImageFile(f)) files.push(f); });
      if (!files.length && cb.items) {
        Array.prototype.forEach.call(cb.items, function (it) {
          if (it.kind === 'file' && /^image\//i.test(it.type)) { var f = it.getAsFile(); if (f) files.push(f); }
        });
      }
      if (!files.length) return;
      e.preventDefault();
      addFiles(files);
    });

    $('thumbs').addEventListener('click', function (e) {
      var box = e.target.closest('.thumb');
      if (!box) return;
      var item = itemById(box.getAttribute('data-id'));
      if (!item) return;
      if (e.target.closest('button[data-act="del"]')) { removeItem(item); return; }
      openOcr();
    });

    $('ocrBtn').addEventListener('click', openOcr);
    $('imgClear').addEventListener('click', clearImages);
    $('ocrClose').addEventListener('click', closeOcr);
    $('ocrModal').addEventListener('click', function (e) { if (e.target === this) closeOcr(); });
    $('ocrApply').addEventListener('click', applyOcr);
    $('ocrPara').addEventListener('change', renderOcrSum);
    $('ocrBar').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'runall') runOcr(null);
      else if (act === 'stop') stopOcr();
      else if (act === 'setting') openSettings();
    });

    $('ocrBody').addEventListener('input', function (e) {
      var ta = e.target.closest('textarea[data-act="text"]');
      if (!ta) return;
      var page = ta.closest('.ocr-page');
      if (!page) return;
      var item = itemById(page.getAttribute('data-id'));
      if (!item) return;
      item.text = ta.value;
      if (item.status !== 'ok' && ta.value.trim()) { /* 手工录入也算完成 */ item.status = 'ok'; item.err = ''; }
      var st = page.querySelector('.ocr-st');
      if (st) st.textContent = '已录入 · ' + charsOf(item) + ' 字';
      renderOcrSum();
      renderThumbs();
    });

    $('ocrBody').addEventListener('click', function (e) {
      var page = e.target.closest('.ocr-page');
      if (!page) return;
      var item = itemById(page.getAttribute('data-id'));
      if (!item) return;
      if (e.target.closest('img[data-act="zoom"]')) { openZoom(item); return; }
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'rot') {
        item.rot = (item.rot + 270) % 360;
        prepare(item).then(function () { updatePageVisual(item); });
      } else if (act === 'enh') {
        item.enh = !item.enh;
        prepare(item).then(function () { updatePageVisual(item); });
      } else if (act === 'up') moveItem(item, -1);
      else if (act === 'down') moveItem(item, 1);
      else if (act === 'del') removeItem(item);
      else if (act === 'page') runOcr([item]);
    });

    $('zoomBox').addEventListener('click', function () { this.hidden = true; });
    renderThumbs();
  }

  /* ---------- 事件绑定 ---------- */
  function init() {
    fillBooks();
    state.unitId = (store('xz_unit') || {}).id || unitList(state.book)[0].id;
    fillUnits();
    if (LLM) { initSettings(); renderAiStatus(); }

    $('bookSel').addEventListener('change', function () {
      state.book = this.value;
      state.unitId = unitList(state.book)[0].id;
      fillUnits();
    });
    $('unitSel').addEventListener('change', function () {
      state.unitId = this.value;
      renderBrief();
      store('xz_unit', { id: state.unitId });
    });
    $('roleSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      state.role = b.getAttribute('data-role');
    });
    $('essay').addEventListener('input', function () {
      if (!this.value.trim()) state.imgSrc = null;
      $('charCount').textContent = this.value.replace(/\s/g, '').length + ' 字';
    });
    $('runBtn').addEventListener('click', run);
    $('clearBtn').addEventListener('click', function () {
      $('essay').value = ''; $('note').value = ''; $('charCount').textContent = '0 字';
      state.imgSrc = null;
      state.images = []; renderThumbs(); closeOcr();
      $('result').innerHTML = '<div class="empty">已清空。重新粘贴原文或上传习作图片即可再次批改。</div>';
    });
    initImages();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
