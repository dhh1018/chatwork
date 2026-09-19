/* ============================================================
 * img.js — 习作图片处理(压缩 / 旋转 / 增强 / 导出)
 * ------------------------------------------------------------
 * 设计原则:
 *   1) 图片只在浏览器本地处理,不上传到本应用的任何服务器。
 *      只有使用者主动点"识别图片文字"时,才会把压缩后的图片发往
 *      其本人在设置里填写的接口地址。
 *   2) 压缩到长边 1600px。手机原图 4000px 直接送识别又慢又贵,
 *      而手写字在这个尺寸下依然清晰。
 *   3) 旋转与增强统一在"导出时"应用:预览里看到的那张图,
 *      就是送去识别的那张图,不存在"看到的和送出去的不一致"。
 * ============================================================ */
(function (root) {
  'use strict';

  var global = root || (typeof window !== 'undefined' ? window : globalThis);

  var LONG_SIDE = 1600;                  /* 压缩后长边像素 */
  var QUALITY = 0.82;                    /* JPEG 质量 */
  var FILE_MAX = 15 * 1024 * 1024;       /* 单张文件上限 */
  var MAX_PAGES = 12;                    /* 单次最多页数 */
  var IMG_EXT = /\.(jpe?g|png|webp|bmp|gif|heic|heif)$/i;

  /* ---------------- 纯计算(可在 node 中直接测试) ---------------- */

  /** 等比缩放到长边不超过 longSide;本来就不超则原样返回 */
  function scaleSize(w, h, longSide) {
    longSide = longSide || LONG_SIDE;
    w = Math.max(1, Math.round(Number(w) || 0));
    h = Math.max(1, Math.round(Number(h) || 0));
    var m = Math.max(w, h);
    if (m <= longSide) return { w: w, h: h, scaled: false };
    var k = longSide / m;
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scaled: true };
  }

  /**
   * 灰度化 + 2%~98% 百分位对比拉伸,就地修改 RGBA 数组。
   * 用途:手机拍的作文常偏暗、发灰,拉伸后笔画与纸面分离,识别准确率明显提升。
   * 对比度本来就极低(拉伸区间 < 24 灰阶)时只做灰度化,不做拉伸,避免把噪点放大。
   */
  function stretchLuma(p) {
    var n = p.length >>> 2;
    if (!n) return { lo: 0, hi: 255, k: 1, stretched: false };
    var hist = new Uint32Array(256), gray = new Uint8Array(n);
    var i, j = 0, v;
    for (i = 0; i < p.length; i += 4, j++) {
      v = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0;
      if (v > 255) v = 255;
      gray[j] = v;
      hist[v]++;
    }
    var cut = Math.max(1, Math.floor(n * 0.02)), acc = 0, lo = 0, hi = 255, a;
    for (a = 0; a < 256; a++) { acc += hist[a]; if (acc >= cut) { lo = a; break; } }
    acc = 0;
    for (a = 255; a >= 0; a--) { acc += hist[a]; if (acc >= cut) { hi = a; break; } }
    var range = hi - lo;
    /* 区间过窄说明画面本身就糊或过曝,拉伸只会把噪点放大;
       区间已接近满色阶则是恒等映射,不必标记为"已拉伸"。 */
    var applies = range >= 24 && range < 255;
    var k = applies ? 255 / range : 1;
    var off = applies ? lo : 0;
    for (i = 0, j = 0; i < p.length; i += 4, j++) {
      v = (gray[j] - off) * k;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    return { lo: lo, hi: hi, k: k, stretched: applies };
  }

  function isImageFile(file) {
    if (!file) return false;
    if (/^image\//i.test(file.type || '')) return true;
    /* 有些设备传过来 type 为空,靠扩展名兜底 */
    return !file.type && IMG_EXT.test(file.name || '');
  }

  function isHeic(file) {
    return !!file && (/heic|heif/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || ''));
  }

  /* ---------------- 需要 DOM 的部分 ---------------- */

  function loadImg(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('图片无法解码')); };
      im.src = src;
    });
  }

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('读取文件失败')); };
      fr.onload = function () { resolve(String(fr.result)); };
      fr.readAsDataURL(file);
    });
  }

  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    return c;
  }

  /** 把图片按 rot 角度画进 canvas,返回实际尺寸 */
  function drawRotated(canvas, img, rot) {
    rot = ((Number(rot) || 0) % 360 + 360) % 360;
    var w = img.naturalWidth || img.width || canvas.width;
    var h = img.naturalHeight || img.height || canvas.height;
    var swap = (rot === 90 || rot === 270);
    var cw = swap ? h : w, ch = swap ? w : h;
    canvas.width = Math.max(1, cw);
    canvas.height = Math.max(1, ch);
    var g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.save();
    g.translate(canvas.width / 2, canvas.height / 2);
    g.rotate(rot * Math.PI / 180);
    g.drawImage(img, -w / 2, -h / 2, w, h);
    g.restore();
    return { w: canvas.width, h: canvas.height, rot: rot };
  }

  function enhanceCanvas(canvas) {
    var g = canvas.getContext('2d');
    var d = g.getImageData(0, 0, canvas.width, canvas.height);
    var r = stretchLuma(d.data);
    g.putImageData(d, 0, 0);
    return r;
  }

  /** 文件 → { src, w, h, origW, origH }（src 为压缩后的 dataURL,未做旋转与增强） */
  function compress(file, opt) {
    opt = opt || {};
    return Promise.resolve().then(function () {
      if (!isImageFile(file)) throw new Error('只接受图片文件(照片或截图)');
      if (file.size > FILE_MAX) {
        throw new Error('单张图片超过 ' + Math.round(FILE_MAX / 1048576) + 'MB,请先压缩,或直接用截图代替');
      }
      return readAsDataUrl(file).then(loadImg);
    }).then(function (img) {
      var ow = img.naturalWidth || img.width || 0;
      var oh = img.naturalHeight || img.height || 0;
      if (!ow || !oh) throw new Error('图片尺寸读取失败,请换一张试试');
      var s = scaleSize(ow, oh, opt.longSide || LONG_SIDE);
      var c = newCanvas(s.w, s.h);
      var g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, s.w, s.h);
      g.drawImage(img, 0, 0, s.w, s.h);
      return {
        src: c.toDataURL('image/jpeg', opt.quality || QUALITY),
        w: s.w, h: s.h, origW: ow, origH: oh, scaled: s.scaled
      };
    }).catch(function (e) {
      if (isHeic(file)) {
        throw new Error('这台设备拍的是 HEIC 格式,浏览器读不了。请在手机「设置 → 相机 → 格式」里改成"兼容性最佳",或先截图再上传。');
      }
      throw (e instanceof Error ? e : new Error(String(e && e.message || e)));
    });
  }

  /**
   * 导出真正送出去的那张图(应用旋转与增强)。
   * item: { src, rot, enh }
   * 返回 { url, w, h }
   */
  function exportDataUrl(item, opt) {
    opt = opt || {};
    return Promise.resolve().then(function () {
      return loadImg(opt.src || item.src);
    }).then(function (img) {
      var c = newCanvas(img.naturalWidth || 1, img.naturalHeight || 1);
      drawRotated(c, img, item.rot || 0);
      if (item.enh || opt.enh) enhanceCanvas(c);
      return { url: c.toDataURL('image/jpeg', opt.quality || QUALITY), w: c.width, h: c.height };
    });
  }

  global.XZ_IMG = {
    LONG_SIDE: LONG_SIDE, QUALITY: QUALITY, FILE_MAX: FILE_MAX, MAX_PAGES: MAX_PAGES,
    scaleSize: scaleSize, stretchLuma: stretchLuma,
    isImageFile: isImageFile, isHeic: isHeic,
    loadImg: loadImg, drawRotated: drawRotated, enhanceCanvas: enhanceCanvas,
    compress: compress, exportDataUrl: exportDataUrl
  };
})(typeof window !== 'undefined' ? window : this);
