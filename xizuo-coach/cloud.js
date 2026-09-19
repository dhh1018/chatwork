/* ============================================================
 * cloud.js — 平台免密钥大模型通道
 * ------------------------------------------------------------
 * 作用:让师生打开链接就能对话,不需要自己申请和填写任何密钥。
 *
 * 三条纪律:
 *   1) 前端只持有 publicConfig(开通云服务时下发),不持有任何长期密钥;
 *      endpoint 一律来自 publicConfig,不得改写、不得从 location 推断。
 *   2) 每次对话请求的 messages[0] 必须是 system 消息,否则平台会直接拒绝。
 *   3) 平台通道不是"万能代理":它属于本应用,不对外转发。
 *
 * 与 llm.js 的分工:
 *   llm.js  = 自带密钥通道(BYO Key),由使用者填写,优先级更高;
 *   cloud.js = 平台通道,默认通道,无需任何配置。
 *   两者都通过 llm.js 的统一入口 generateText() 被调用。
 * ============================================================ */
(function (root) {
  'use strict';

  var global = root || (typeof window !== 'undefined' ? window : globalThis);

  /* 云服务开通结果返回的 publicConfig —— 这三个值是唯一可以随前端下发的配置。
   * endpoint 必须与应用的线上域名一致(服务端做精确 Origin 校验)。
   * 重新开通云服务会返回新的值,届时替换这里即可。 */
  var PUBLIC_CONFIG = {
    resourceId: 'wbcs_OdnQZpDGxggcVC3oKpRxik',
    endpoint: 'https://composition-coach.app.workbuddy.host',
    publishableKey: 'wbpk_iIG7THnYRJjEwtbV2QqZ9s_OoUtsINRK8asVk4ncBrlNcqdVS4koyih'
  };

  var S = {
    client: null,
    models: null,
    textId: '',
    visionId: '',
    loading: null,
    err: ''
  };

  function sdkRoot() { return global.WorkBuddyCloud || null; }
  function hasSdk() { return !!sdkRoot(); }

  function client() {
    if (S.client) return S.client;
    var W = sdkRoot();
    if (!W || typeof W.createWorkBuddyCloud !== 'function') return null;
    try {
      S.client = W.createWorkBuddyCloud({
        endpoint: PUBLIC_CONFIG.endpoint,
        publishableKey: PUBLIC_CONFIG.publishableKey
      });
    } catch (e) {
      S.client = null;
      S.err = '云服务客户端初始化失败:' + ((e && e.message) || e);
    }
    return S.client;
  }

  function codeOf(e) {
    return String((e && e.error && e.error.code) || (e && e.code) || '').trim();
  }
  /** 按错误码前缀给出人话;分不清时回原始信息,但不暴露内部栈 */
  function errText(e) {
    var code = codeOf(e) || 'unknown';
    var raw = String((e && e.message) || e || '');
    if (/^auth_/.test(code)) return '这个应用还没有被授权使用平台模型(错误 ' + code + ')。请到设置里填自己的密钥,或联系应用创建者。';
    if (/^quota_/.test(code)) return (/rate_limited/.test(code) ? '请求太频繁,请稍等几秒再试。' : '平台额度已用完(错误 ' + code + ')。可在设置里填自己的密钥继续使用。');
    if (/^request_/.test(code)) return '请求参数或模型不匹配(错误 ' + code + ')。' + raw.slice(0, 120);
    if (/^gateway_|^model_/.test(code)) return '平台模型服务暂时不可用(错误 ' + code + '),可以稍后重试。';
    if (/^internal_/.test(code)) return '平台内部错误(错误 ' + code + ')。';
    if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) return '无法连接平台通道,请检查网络后刷新页面。';
    return raw || '平台通道调用失败(' + code + ')';
  }

  function isQuota(e) { return /^quota_/.test(codeOf(e)); }

  /** 拉取可用模型列表;空列表是合法结果,必须显式处理 */
  function loadModels() {
    if (S.models) return Promise.resolve(S.models);
    if (S.loading) return S.loading;
    var c = client();
    if (!c) {
      return Promise.reject(new Error(hasSdk() ? (S.err || '云服务客户端不可用') : '平台通道脚本未加载,请检查网络后刷新页面'));
    }
    S.loading = Promise.resolve().then(function () {
      return c.llm.models.list();
    }).then(function (list) {
      var all = Array.isArray(list) ? list : [];
      S.models = all;
      var usable = all.filter(function (m) { return m && m.disabled !== true && m.enabled !== false; });
      S.textId = usable.length ? usable[0].id : '';
      S.visionId = '';
      for (var i = 0; i < usable.length; i++) {
        if (usable[i].supportsImages === true) { S.visionId = usable[i].id; break; }
      }
      S.loading = null;
      return all;
    }, function (e) {
      S.loading = null;
      S.err = errText(e);
      throw new Error(S.err);
    });
    return S.loading;
  }

  function textModel() { return S.textId; }
  function visionModel() { return S.visionId; }

  /** 平台通道是否可用(已加载脚本且已拉到一个可用文本模型) */
  function readySync() { return !!client() && !!S.textId; }
  function visionReadySync() { return !!client() && !!S.visionId; }

  /**
   * 流式对话。opts: { messages, model, temperature, maxTokens, maxTokensField, onDelta, signal, conversationId }
   * 返回完整文本;失败抛错(错误文本已翻成人话)。
   */
  function chat(opts) {
    opts = opts || {};
    var c = client();
    if (!c) return Promise.reject(new Error('平台通道不可用'));
    var messages = opts.messages;
    if (!messages || !messages.length || !messages[0] || messages[0].role !== 'system') {
      return Promise.reject(new Error('平台通道要求 messages[0] 必须是 system 消息'));
    }
    var model = opts.model || S.textId;
    if (!model) return Promise.reject(new Error('平台暂未提供可用模型'));

    var body = {
      model: model,
      messages: messages,
      stream: true,
      stream_options: { include_usage: true }
    };
    if (typeof opts.temperature === 'number') body.temperature = opts.temperature;
    if (opts.topP !== undefined) body.top_p = opts.topP;
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.conversationId) body.conversationId = opts.conversationId;

    var timeout = opts.timeout || 90000;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { } }, timeout);
    if (opts.signal) {
      if (opts.signal.aborted) ctrl.abort();
      else opts.signal.addEventListener('abort', function () { try { ctrl.abort(); } catch (e) { } });
    }
    body.signal = ctrl.signal;

    var out = '';
    var emit = function (d) { if (!d) return; out += d; if (opts.onDelta) opts.onDelta(d); };

    /* SDK 返回的是异步可迭代对象,必须用 for await 消费 ——
     * 直接对返回对象调 .next() 是错的,可迭代对象本身没有 next。 */
    return (async function () {
      var stream;
      /* create() 可能同步抛错,也可能返回一个稍后 reject 的 Promise
       * (鉴权、额度类错误常常是后者)。两者都必须走同一套人话翻译,
       * 否则用户看到的是 SDK 的原始错误对象。 */
      try {
        stream = c.llm.chat.completions.create(body);
        stream = await stream;   /* 兼容返回 Promise 的实现 */
      } catch (e) {
        clearTimeout(timer);
        throw new Error(errText(e));
      }
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
        clearTimeout(timer);
        var only = chunkText(stream);
        if (only) emit(only);
        return out;
      }
      try {
        for await (const chunk of stream) {
          var t = chunkText(chunk);
          if (t) emit(t);
        }
        return out;
      } catch (e) {
        var msg = errText(e);
        if (out) { var er = new Error(msg); er.partial = out; throw er; }
        throw new Error(msg);
      } finally {
        clearTimeout(timer);
      }
    })();
  }

  /** 从 chunk 里取正文增量;reasoning_content 不计入可见正文 */
  function chunkText(chunk) {
    try {
      if (!chunk) return '';
      if (typeof chunk === 'string') return chunk;
      var choice = chunk.choices && chunk.choices[0];
      if (!choice) return '';
      if (choice.delta && typeof choice.delta.content === 'string') return choice.delta.content;
      if (choice.message && typeof choice.message.content === 'string') return choice.message.content;
      return '';
    } catch (e) { return ''; }
  }

  function statusText() {
    if (!hasSdk()) return { on: false, text: '平台通道脚本未加载(检查网络后刷新)' };
    if (S.err && !S.textId) return { on: false, text: '平台通道不可用:' + S.err };
    if (!S.textId) return { on: false, text: '平台通道尚未就绪' };
    return {
      on: true,
      text: '平台通道已接通 · 模型 ' + S.textId + (S.visionId ? ' · 识图 ' + S.visionId : ' · 该平台无识图模型')
    };
  }

  global.XZ_CLOUD = {
    PUBLIC_CONFIG: PUBLIC_CONFIG,
    hasSdk: hasSdk,
    loadModels: loadModels,
    chat: chat,
    textModel: textModel,
    visionModel: visionModel,
    readySync: readySync,
    visionReadySync: visionReadySync,
    statusText: statusText,
    isQuota: isQuota,
    errText: errText
  };
})(typeof window !== 'undefined' ? window : this);
