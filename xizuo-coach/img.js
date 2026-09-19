/* ============================================================
 * img.js — 习作图片处理(压缩)
 * ------------------------------------------------------------
 * 设计原则:
 *   1) 图片只在浏览器本地处理,不上传到本应用的任何服务器。
 *      只有使用者主动点"识别图片文字"时,才会把压缩后的图片发往
 *      其本人在设置里填写的接口地址。
 *   2) 压缩到长边 1600px。手机原图 4000px 直接送识别又慢又贵,
 *      而手写字在这个尺寸下依然清晰。
 *   3) 压缩后的图就是送去识别的那张图:预览里看到的、发出去的、
 *      和最终送进识别模型的,始终是同一份数据,不做二次加工。
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

  /** 文件 → { src, w, h }（src 为压缩后的 dataURL,就是送去识别的原图） */
  function compress(file, opt) {
    opt = opt || {};
    return Promise.resolve().then(function () {
      if (!isImageFile(file)) throw new Error('只接受图片文件(照片或截图)');
      if (file.size > FILE_MAX) {
        throw new Error('单张图片超过 ' + Math.round(FILE_MAX / 1048576) + 'MB,请先压缩,或直接用截图代替');
      }
      return readAsDataUrl(file).then(function (src) {
        return new Promise(function (res, rej) {
          var im = new Image();
          im.onload = function () { res(im); };
          im.onerror = function () { rej(new Error('图片无法解码')); };
          im.src = src;
        });
      });
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
        w: s.w, h: s.h
      };
    }).catch(function (e) {
      if (isHeic(file)) {
        throw new Error('这台设备拍的是 HEIC 格式,浏览器读不了。请在手机「设置 → 相机 → 格式」里改成"兼容性最佳",或先截图再上传。');
      }
      throw (e instanceof Error ? e : new Error(String(e && e.message || e)));
    });
  }

  global.XZ_IMG = {
    LONG_SIDE: LONG_SIDE, QUALITY: QUALITY, FILE_MAX: FILE_MAX, MAX_PAGES: MAX_PAGES,
    scaleSize: scaleSize,
    isImageFile: isImageFile, isHeic: isHeic,
    compress: compress
  };
})(typeof window !== 'undefined' ? window : this);
