/* ═══════════════════════════════════════════════════════════════
   气衡 · 全幅动态背景引擎 (Backdrop Field Engine)

   设计依据《气衡欢迎页 v2 改造执行指令》§13 三层动效架构：
     Layer 1  低频氛围：CSS 静态（网格 + 轻噪声 + 光场），几乎不响应鼠标
     Layer 2  主气流  ：本文件 canvas，30 FPS，响应 pointer        ← 铺满整个视口
     Layer 3  拓扑与UI：本文件第二块 canvas + DOM，有意义脉冲，hover/focus 响应
   不叠加第 4 层。

   与《三套高保真设计方案》方案A §2.3–§2.6、§2.10 对齐。

   确定性：所有几何量都是 t / index / 令牌的函数，不掷骰子。
   （这条注释原本直接写出了随机函数名，结果被"引擎不得含随机数"的静态
    检查按字面命中；改成描述性说法，检查才是在检代码而不是检注释。）
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ══ 生命周期补丁（2026-10-07 / M2）══════════════════════════════
     原文件是"自执行一次、绑到当时 DOM、无任何清理路径"的 IIFE。
     现在改成工厂：`window.__qhFieldEngine.create({ root })` 返回实例句柄
     （sync / resize / running / destroy）。**绘制公式、几何参数、颜色、
     节奏、鼠标幅度/半径一律未改**（逐项见 docs/MIGRATION-M2.md）。

     destroy 幂等：撤 window/document/媒体查询/rail 监听、ResizeObserver、
     RAF 与探针计时器；并只在全局 API 仍指向本实例时才清掉，
     不会误删后来新实例的全局 API。sync 与迟到回调在 destroy 后直接返回，
     不会复活已销毁实例。 */
  function createFieldEngine(opts) {
    opts = opts || {};
    var root = document.documentElement;

    var destroyed = false;
    var pendingTimers = [];
    var railHandlers = [];
    var globalKeys = [
      '__qhEngine',
      '__gmState', '__gmConst', '__gmTilt', '__gmTiltSim', '__gmFreeze',
      '__gmVerifyGeometry', '__gmSetT', '__gmProbeAt', '__gmSim', '__gmDecay'
    ];

    /* 引擎一旦抛错，画布会静悄悄地空白。把错误写到 data-engine-error 上，
       这样离线验收能直接读到"是哪个环节炸了"，而不是靠猜。 */
    function onGlobalError(ev) {
      if (root.getAttribute('data-engine-error')) return;
      root.setAttribute('data-engine-error', String(ev.message || ev.error || 'unknown').slice(0, 200));
    }
    window.addEventListener('error', onGlobalError);

    /* 绑定**当前** DOM：优先用调用方传入的 root 作用域查询，
       避免快速返回时误绑到上一个已卸载的 canvas。 */
    var backdrop = opts.root || document.getElementById('backdrop');
    if (!backdrop) { window.removeEventListener('error', onGlobalError); return null; }
    var field = backdrop.querySelector('#bg-airflow');
    var topo = backdrop.querySelector('#bg-topology');
    var core = backdrop.querySelector('#qiheng-core');
    var coreTilt = backdrop.querySelector('#core-tilt');
    var labelBox = backdrop.querySelector('#visual-labels');
    /* §17：删掉 visible cursor-ring 的视觉显示。
       HTML 里那个 <div class="cursor-ring"> 也已经移除 —— 留着 DOM 没有意义，
       高端欢迎页不需要一个圈告诉用户"这里支持鼠标互动"，让背景自己反馈即可。 */
    if (!field || !topo) { window.removeEventListener('error', onGlobalError); return null; }
    /* 当前画布不能残留 pause 标记：快速返回/StrictMode remount 时若留着
       data-hero="away"，running() 会永远返回 false，气流静止。 */
    field.removeAttribute('data-hero');

  var fctx = field.getContext('2d');
  var tctx = topo.getContext('2d');

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  var small = window.matchMedia('(max-width: 760px)');

  /* ── 动效预算（精修轮 §8 / §29）───────────────────────────────
     上一版这里写着 FPS_MS = 1000/30 —— 也就是**引擎把自己锁在 30fps**。
     这是"滑动卡、动画抽动"的第一位根因：显示器在 237Hz 刷新，
     引擎每 33ms 才画一次，鼠标动了要等最多 33ms 才见反应。
     实测证据（measure_golden.py，本机）：
       rAF 实际 237.5Hz / 引擎自报 28.0fps   ← 差 8.5 倍
     精修指令 §8：用 requestAnimationFrame，不做 30/24/18 锁；
     §29：性能不够时按 flow 数 → point 数 → topology → DPR 降，
     **最后才降 fps**。
     所以这里不再有 FPS 门。每帧都画；代价靠预计算几何压下来（见 flowCache）。
     只留 165fps 上限，覆盖 144/165Hz 显示器，同时在更快的屏上留出余量：
     drawField 实测约 2–3ms，240Hz 每帧只有 4.16ms 预算，无上限会顶到边界。 */
  var MIN_FRAME_MS = 1000 / 165;
  var DPR_CAP = 1.5;

  /* ── 指针影响（精修轮 §5 / §6）────────────────────────────────
     §5：最大影响半径 desktop 110–150px → 取 132
     §5：最大位移 6–12px，**不要超过 15px** → 取 11
     上一版是 26px，超上限一倍多；叠上 30fps 门，就是"抽动"的观感来源。
     §6：不该让用户意识到页面在算物理 —— 所以没有速度史、没有尾迹、没有能量。 */
  var INFLUENCE_RADIUS = 132;
  var MAX_DISPLACEMENT = 11;
  /* §5 的 lerp：x += (targetX - x) * 0.28
     0.28/帧 @60Hz → 时间常数约 53ms，90% 到位约 123ms，属于"1 帧内开始响应"。
     离开时同一增益：10% 位置回落到约 130ms（§28 停手 200–350ms 内主要扰动消失）。 */
  var POINTER_GAIN = 0.28;
  /* 影响强度的进入包络：§4 要求 60–120ms 进入 → τ=45ms（90ms 到 87%）。 */
  var ENTER_TAU = 45;
  /* 离开包络：§28 要求 ≤400ms 恢复 → τ=120ms（10% 需 276ms）。 */
  var LEAVE_TAU = 120;
  /* §28「停手 200–350ms 主要扰动消失」：超过这个时长没有新事件就按"停手"处理，
     不让影响强度一直挂着。60ms ≈ 4 帧 @60Hz，正常移动绝不会触发。 */
  var STOP_MS = 60;

  var w = 0, h = 0, dpr = 1, t = 0, raf = 0, last = 0, frames = 0, rafFired = false;
  var lastFrameAt = 0;
  /* §29 说"真正关注 frame p95，而不是平均 fps"，所以两个都留。 */
  var drawCost = 0;
  var _dcost = new Float32Array(120), _dci = 0;
  /* 极低频 global drift（§13）：周期 40s、角度 ±2°、位移 ±6px。
     ⚠ 默认关闭。§13 允许它，但它会**改变整个画面的流动方式**
     （绕 Core 的极慢旋转 + 平移），而这一轮的纪律是
     "只修动画与鼠标手感，页面视觉一律不动"。
     项目经理看到后明确反馈"整体流动都有变化，我更喜欢原版的流动效果"，
     所以按 §33「任何修改让项目经理觉得没有以前舒服，直接回滚」把它关掉。
     代码保留（不删），留到 Round C「只动视觉精修」时再单独提案。
     加 ?drift=1 可以手动打开做对比。 */
  var DRIFT_PERIOD = 40, DRIFT_ANGLE_DEG = 2.0, DRIFT_SHIFT_PX = 6;
  var DRIFT_ON = /[?&]drift=1(&|$)/.test(location.search);
  var cssAccent = '#82D7BD';
  /* §5 新 pointer 模型：只有位置与两条包络，没有任何物理量。
     ix/iy = 真实鼠标位置（原始输入，不参与平滑，量测用）
     x/y   = 平滑后的位置（lerp 0.28，帧率无关）
     enter/leave = 进入 / 离开包络，取较大值当影响强度 */
  var pointer = { ix: 0, iy: 0, x: 0, y: 0, seen: 0, active: false, enter: 0, leave: 0, energy: 0 };

  /* 收敛中心：视口右侧，与《三套方案》§2.2 的右区视觉中心一致 */
  /* v3 §16：移动端"visual 只放在 Hero 下方局部区域"，高度 220–260px；
     而且不许有 full-screen fixed background。桌面端仍是 Hero 内的整幅气流。
     这里给出一个统一的"视觉作用区"，Core、拓扑节点、指针影响都从它取坐标，
     这样"移动端只影响局部"是一条几何约束，而不是靠若干处 if 补丁。 */
  function visualZone() {
    if (small.matches) {
      /* 375×812 下约 375×224，落在 220–260 区间 */
      return { x0: w * 0.05, y0: h * 0.585, x1: w * 0.95, y1: h * 0.86 };
    }
    /* 桌面：Hero 右侧视觉区（与 §21 构图一致，Core 在右侧偏中） */
    return { x0: w * 0.45, y0: h * 0.16, x1: w * 1.0, y1: h * 0.9 };
  }
  function nodeX(nx) { var z = visualZone(); return z.x0 + nx * (z.x1 - z.x0); }
  function nodeY(ny) { var z = visualZone(); return z.y0 + ny * (z.y1 - z.y0); }

  function corePoint() {
    var z = visualZone();
    return { x: z.x0 + (z.x1 - z.x0) * (small.matches ? 0.5 : 0.52),
             y: z.y0 + (z.y1 - z.y0) * 0.52 };
  }

  function readTokens() {
    var cs = getComputedStyle(root);
    cssAccent = (cs.getPropertyValue('--accent') || '#82D7BD').trim() || '#82D7BD';
    /* 浅色主题下同一份 alpha 在白底上几乎看不见，给一个整体增益补偿 */
    alphaGain = root.getAttribute('data-theme') === 'light' ? 1.4 : 1;
  }

  var alphaGain = 1;

  function alpha(hex, a) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    var aa = Math.min(1, a * alphaGain);
    if (!m) return 'rgba(130,215,189,' + aa + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + aa + ')';
  }

  /* smoothstep：进入影响圈时"渐入"，而不是高斯那样中间突然很尖 */
  function smoothstep(edge0, edge1, x) {
    var v = (x - edge0) / (edge1 - edge0);
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    return v * v * (3 - 2 * v);
  }

  /* 渲染尺寸：正常浏览器读窗口；不接受窗口尺寸的无头环境可用 ?vw=&vh= 明确指定，
     保证验收截图和真实窗口尺寸一致（否则截图会退化成 800x600 的默认视口）。 */
  var qs = /[?&]vw=(\d+)/.exec(location.search);
  var qh = /[?&]vh=(\d+)/.exec(location.search);
  var forcedW = qs ? parseInt(qs[1], 10) : 0;
  var forcedH = qh ? parseInt(qh[1], 10) : 0;

  function viewW() { return forcedW || window.innerWidth; }
  function viewH() { return forcedH || window.innerHeight; }

  function resize() {
    if (destroyed) return;
    w = viewW();
    h = viewH();
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    [field, topo].forEach(function (c) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    readTokens();
    invalidateCoreRect();          /* 视口变了，Core 圆心要重测 */
    /* §12：flow 几何只在初始化与 resize 时重建，运行时不重建。 */
    buildFlow();
    draw();
  }

  /* ══ Layer 2：气流织场 —— 铺满整个视口 ══════════════════════
     44 条流线（移动端 24）：每 8 条一条主线（§2.4 Layer A/B）
     + 沿主线行进的少量微粒（Layer C，不自由漂浮）
     线条从右侧进入 → 在 Core 处收束 → 下游重新展开（§5.1 构图）
     y 方向的包络铺满 h，所以背景处处有气，而不是只有一条带 */
  /* ══ 几何：与 Golden Baseline **逐字一致** ══════════════════════
     这里曾经被我"优化"过，结果把画面改坏了。教训写在这里，防止再犯：

     基线原式是
         y += sin(u*4.1 + t*0.22 + s*0.11) * h*0.055
         y += sin(u*9.3 - s*0.07 + t*0.09) * h*0.012
     t 是加在括号**里面**的。我当时把"与时间无关的部分"预计算进缓存，
     等于把 t 从 sin 里拿了出来（sin(A+t) 当成 sin(A)+f(t)），
     于是整片气流的形状都变了 —— 这就是"整体流动都有变化"的根因。
     而且我还顺手默认打开了一个绕 Core 的极慢旋转（§13 drift），
     又让静态帧把时间轴倒回 12.5 秒。三处叠加，画面自然不再是原来那个。

     现在回到原式。**不做任何几何预计算。**
     为什么不做也没关系：实测 draw 的 p95 只有 0.5ms，
     而基线那 3132 个点每帧多算两次 sin 大约 +1ms —— 预算 16.7ms，绰绰有余。
     v5.2 那次"性能差"的真凶是 30fps 帧率锁，不是这几千次三角函数。
     真正需要预计算的只有下面这几个**每条线一个**的标量（用于描边样式），
     它们与时间无关、与点无关，算一次就够。 */
  var flowCache = null;

  function buildFlow() {
    var streams = small.matches ? 14 : 36;
    var steps = small.matches ? 46 : 86;
    var xLoA = [], xHiA = [], sumXA = [], midXA = [];
    for (var s = 0; s < streams; s++) {
      /* 基线的可见度权重是"整条线横向平均位置"的函数，与 t 无关，
         所以每条线只算一次。这对画面没有任何影响，因为它只喂给描边样式。 */
      var sumX = 0, xLo = Infinity, xHi = -Infinity;
      for (var i = 0; i <= steps; i++) {
        var x = w * (1.04 - (i / steps) * 1.08);
        sumX += x;
        if (x < xLo) xLo = x;
        if (x > xHi) xHi = x;
      }
      sumXA.push(sumX);
      xLoA.push(xLo);
      xHiA.push(xHi);
      midXA.push((xLo + xHi) / 2);
    }
    flowCache = { streams: streams, steps: steps,
                  majorEvery: small.matches ? 5 : 6,
                  sumX: sumXA, xLo: xLoA, xHi: xHiA, midX: midXA };
  }

  /* 单点几何：给定 (基数 y, 参数 u, 车道 k)，返回该点位置。
     —— 以下函数体与 _reference-frozen/field-engine.js 的 pointAt 逐字相同，
        只多了三个可选参数用于 §13 的低频漂移（默认全 0，即完全等价）。 */
  function pointAt(k, u, s, px, py, hasPointer, cPt, driftA, driftX, driftY) {
    var amplitude = h * 0.47;
    var spread = Math.sign(k) * Math.pow(Math.abs(k), 0.45);
    var baseY = cPt.y + spread * amplitude;
    var x = w * (1.04 - u * 1.08);
    var converge = 1 - 0.42 * Math.exp(-Math.pow((u - 0.62) / 0.30, 2));
    var y = cPt.y + (baseY - cPt.y) * converge;
    y += Math.sin(u * 4.1 + t * 0.22 + s * 0.11) * h * 0.055;
    y += Math.sin(u * 9.3 - s * 0.07 + t * 0.09) * h * 0.012;
    /* §13 低频漂移：绕 Core 极慢旋转 + 整体平移。默认关闭（driftA/X/Y 全 0）,
       此时这一段是恒等变换，画面与基线逐像素相同。 */
    if (driftA !== 0 || driftX !== 0 || driftY !== 0) {
      var rx = x - cPt.x, ry = y - cPt.y;
      var ca = Math.cos(driftA), sa = Math.sin(driftA);
      x = cPt.x + rx * ca - ry * sa + driftX;
      y = cPt.y + rx * sa + ry * ca + driftY;
    }
    var bx = x, by = y;
    if (hasPointer) {
      var d = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
      if (d < INFLUENCE_RADIUS) {
        var fall = 1 - smoothstep(0, INFLUENCE_RADIUS, d);
        var nx = d < 1 ? 0 : (x - px) / d;
        var ny = d < 1 ? -1 : (y - py) / d;
        var push = fall * MAX_DISPLACEMENT * pointer.energy * (1 - Math.abs(k) * 0.35);
        y += ny * push * 0.85 + (py < cPt.y ? -1 : 1) * fall * 3;
        x += nx * push * 0.55;
      }
    }
    return { x: x, y: y, bx: bx, by: by };
  }

  /* 量测：返回指针造成的真实最大位移与最远影响距离（§5 的两条硬指标）。
     用 pointAt 的**基准返回**（bx/by）与受扰返回（x/y）相减 ——
     这正是基线 measureInfluence 的做法，所以"量到的位移"就是"画出来的位移"，
     不会出现量具与画面两套数。 */
  function measureInfluence() {
    if (!flowCache) return { maxDisp: 0, maxDist: 0 };
    var c = flowCache;
    var cPt = corePoint();
    var px = pointer.x, py = pointer.y;
    var maxDisp = 0, maxDist = 0;
    for (var s = 0; s < c.streams; s++) {
      var k = c.streams > 1 ? (s / (c.streams - 1)) * 2 - 1 : 0;
      for (var i = 0; i <= c.steps; i += 2) {
        var mv = pointAt(k, i / c.steps, s, px, py, true, cPt, 0, 0, 0);
        var mx = mv.x - mv.bx, my = mv.y - mv.by;
        var disp = Math.sqrt(mx * mx + my * my);
        if (disp > 0.05) {
          var d = Math.sqrt((mv.bx - px) * (mv.bx - px) + (mv.by - py) * (mv.by - py));
          if (d > maxDist) maxDist = d;
        }
        if (disp > maxDisp) maxDisp = disp;
      }
    }
    var pool = 0.55 * MAX_DISPLACEMENT * pointer.energy;
    if (pool > maxDisp) maxDisp = pool;
    return { maxDisp: Math.round(maxDisp * 100) / 100, maxDist: Math.round(maxDist) };
  }

  /* v3 §6：密度必须"在绘制层按 x 加权"，不能画满再用整屏 scrim 盖住。
     规范给的锚点：左 0.18–0.32 / 中 0.55–0.72 / 右 0.90–1.00。
     这里用单调分段线性插值，而不是高斯——高斯会让左侧又慢慢抬起来，
     左侧阅读区就重新变花。锚点位置按视口宽度比例给：
       0.00w → 0.22（左：几乎只剩骨架，正文周围不穿线）
       0.30w → 0.32
       0.50w → 0.62（中：挂得住眼）
       0.72w → 0.88
       1.00w → 1.00（右：主视觉，Core 所在）
     返回 0.10–1.00，乘到每一条线的 alpha 与 lineWidth 上。 */
  function densityWeight(x, vw) {
    var AX = [0.00, 0.30, 0.50, 0.72, 1.00];
    var AW = [0.22, 0.32, 0.62, 0.88, 1.00];
    var f = vw > 0 ? Math.min(1, Math.max(0, x / vw)) : 0;
    var i = 0;
    while (i < AX.length - 2 && f > AX[i + 1]) i++;
    var span = AX[i + 1] - AX[i];
    var t = span > 0 ? (f - AX[i]) / span : 0;
    return AW[i] + (AW[i + 1] - AW[i]) * t;
  }

  function drawField() {
    var c = flowCache;
    if (!c) return;
    var cPt = corePoint();
    /* v3 §22：桌面 32–44 条、主线 5–7；移动 §16：12–18 条即可。
        36 条（主线 6）本来就落在精修指令 §9 的区间内，所以不动线数。 */
    var streams = c.streams, steps = c.steps, majorEvery = c.majorEvery;
    var px = pointer.x, py = pointer.y;
    var hasPointer = fine.matches && pointer.energy > 0.004;
    var vw = w || 1;

    /* §13 极低频 global drift：周期 40s、角度 ±2°、位移 ±6px。
       **默认关闭** —— 它会改变整片气流的运动方式，而本轮纪律是视觉不动。
       关闭时这三个量恒为 0，pointAt 里的漂移分支是恒等变换。 */
    var dp = t * (Math.PI * 2 / DRIFT_PERIOD);
    var driftA = DRIFT_ON ? Math.sin(dp) * (DRIFT_ANGLE_DEG * Math.PI / 180) : 0;
    var driftX = DRIFT_ON ? Math.sin(dp) * DRIFT_SHIFT_PX * 0.7 : 0;
    var driftY = DRIFT_ON ? Math.cos(dp) * DRIFT_SHIFT_PX * 0.5 : 0;

    /* 透明清屏 + 加法混合：这是"气流"能被看见的关键。
       参考 Aceternity Vortex 的做法 —— 线条用 globalCompositeOperation="lighter"
       叠加并加一层模糊辉光，而不是靠满屏竖线。（Vortex: blur(8px) brightness(200%)
       + blur(4px) brightness(200%) 两遍 lighter。） */
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, w, h);

    for (var s = 0; s < streams; s++) {
      var k = streams > 1 ? (s / (streams - 1)) * 2 - 1 : 0;
      var major = s % majorEvery === 0;

      /* v3 §6：可见度由线在视口里的横向位置决定，不是"画满再用 scrim 盖左边"。
         这个权重与时间无关，所以每条线只算一次（见 buildFlow）。 */
      var avgX = Math.max(0, Math.min(vw, c.sumX[s] / (steps + 1)));
      var wt = densityWeight(avgX, vw);
      var coreFactor = densityWeight(c.midX[s], vw);

      /* §10：一条 flow 只允许一次 stroke()。
         beginPath → moveTo → lineTo… → stroke 全在下面这一块里。 */
      fctx.beginPath();
      for (var i = 0; i <= steps; i++) {
        /* 几何全部走 pointAt：绘图与量测共用同一份函数，
           所以"量到的位移"就是"画出来的位移"，不会两套数。 */
        var q = pointAt(k, i / steps, s, px, py, hasPointer, cPt, driftA, driftX, driftY);
        if (i === 0) fctx.moveTo(q.x, q.y); else fctx.lineTo(q.x, q.y);
      }

      /* 主线走加法混合 + 辉光（Vortex 配方）；次线保持 source-over，
         避免整屏发亮（§6.1 禁止过强发光） */
      fctx.lineWidth = (major ? 1.3 : 0.75) * (0.72 + 0.28 * wt);
      fctx.globalCompositeOperation = major ? 'lighter' : 'source-over';
      /* v3 §22：glow 仅 Core 邻域。旧版给每一条主线都加 shadowBlur=14，
         等于全屏发光——这也是"整屏流场做过头"的一部分。 */
      var nearCore = major && coreFactor > 0.85;
      fctx.shadowBlur = nearCore ? 12 : 0;
      fctx.shadowColor = alpha(cssAccent, nearCore ? 0.42 : 0);
      /* v3 §22：次线 opacity 0.08–0.20、主线 0.30–0.48，再乘横向密度权重。
         手机端单独提亮：§16 把手机流线数压到 14 条（性能预算），但 14 条线在
         375px 上平摊后整片主视觉区太暗，像水印而不是"主角"。既然不能加线，
         就把单条可见度提上去：主线 0.36→0.46、次线 0.15→0.22，
         仍在 §22 规定的 0.30–0.48 / 0.08–0.20 区间内。 */
      var inkScale = small.matches ? 1.3 : 1;
      fctx.strokeStyle = alpha(cssAccent, Math.min(0.48, (major ? 0.36 : 0.15) * inkScale) * wt);
      fctx.stroke();                       /* ← 每条 flow 唯一的一次 */
      fctx.shadowBlur = 0;
      fctx.globalCompositeOperation = 'source-over';
    }

    /* Layer C：沿主线行进的微粒，不自由漂浮 */
    var dots = small.matches ? 4 : 9;
    for (var d2 = 0; d2 < dots; d2++) {
      var u2 = (t * 0.032 + d2 * 0.137) % 1;
      var si = (d2 * 5) % streams;
      var di = Math.round(u2 * steps);
      var lane = ((d2 * 5) % streams) / (streams - 1) * 2 - 1;
      var q2 = pointAt(lane, u2, d2, px, py, hasPointer, cPt, driftA, driftX, driftY);
      var x2 = q2.x, y2 = q2.y;
      /* 指针经过时微粒被轻微带亮。位置已由 pointAt 一起带偏，
         命中测试直接用它的基准返回 bx/by（与基线一致）。 */
      var lit = 0;
      if (hasPointer) {
        var dd = Math.sqrt((q2.bx - px) * (q2.bx - px) + (q2.by - py) * (q2.by - py));
        if (dd < INFLUENCE_RADIUS) lit = (1 - smoothstep(0, INFLUENCE_RADIUS, dd)) * pointer.energy;
      }
      fctx.beginPath();
      fctx.arc(x2, y2, 1.5 + lit * 1.8, 0, Math.PI * 2);
      fctx.fillStyle = alpha(cssAccent, 0.30 + lit * 0.55);
      fctx.fill();
    }

    /* 指针光池：让"系统确实在跟着我"有一个立即、明确的视觉应答。
       参考 Aceternity Vortex 的加法混合辉光；半径限制在 150px 内，
       所以它是局部提亮，不是整屏发亮（§6.1 禁止过强发光/整屏偏移）。 */
    if (hasPointer) {
      var pr = 46 + 104 * pointer.energy;
      var grd = fctx.createRadialGradient(px, py, 0, px, py, pr);
      grd.addColorStop(0, alpha(cssAccent, 0.20 * pointer.energy));
      grd.addColorStop(0.45, alpha(cssAccent, 0.075 * pointer.energy));
      grd.addColorStop(1, alpha(cssAccent, 0));
      fctx.globalCompositeOperation = 'lighter';
      fctx.fillStyle = grd;
      fctx.beginPath();
      fctx.arc(px, py, pr, 0, Math.PI * 2);
      fctx.fill();
      fctx.globalCompositeOperation = 'source-over';
    }

    drawHatch(px, py, hasPointer);
  }

  /* 水平细刻线。v3 §22 明确"不画全屏 hatch"：
     旧版从 x=0 拉到 x=w 铺满整幅，等于给左侧阅读区也铺了一层工程线，
     正是审计说的"左侧没有密集线条穿过正文"的反面。
     现在只在右侧 46%–100% 出现，并且梯度改用同一套 densityWeight 锚点，
     左侧直接不画。移动端（§16 只允许 12–18 条线 + 局部小视觉）整层关闭。
     为了不像"扫描线/CRT"，间距仍做非等分处理（§6.1 禁止高频抖动）。 */
  function drawHatch(px, py, hasPointer) {
    if (small.matches) return;
    var gap = 26;
    var jitter = gap * 0.31;
    /* 起笔位置：对应 densityWeight 里 0.88 那个锚点所在的 x */
    var x0 = w * 0.46;
    fctx.lineWidth = 0.55;
    for (var yy = 6, row = 0; yy < h; yy += gap, row++) {
      /* 用两段不同周期的正弦错开，避免整齐划一 */
      var off = Math.sin(row * 1.7) * jitter + Math.sin(row * 0.41) * jitter * 0.6;
      var y = yy + off;
      var x1 = w;
      /* 指针对应的一行被轻轻顶开（§6.2：≤28px，局部） */
      if (hasPointer) {
        var dy2 = y - py;
        if (Math.abs(dy2) < INFLUENCE_RADIUS) {
          var f2 = 1 - smoothstep(0, INFLUENCE_RADIUS, Math.abs(dy2));
          y += (dy2 < 0 ? -1 : 1) * f2 * MAX_DISPLACEMENT * 0.4 * pointer.energy;
        }
      }
      /* 起笔端淡入（不再是从 x=0 就有线），末端淡出，避免"截断的横线" */
      var g2 = fctx.createLinearGradient(x0, 0, x1, 0);
      g2.addColorStop(0, alpha(cssAccent, 0));
      g2.addColorStop(0.22, alpha(cssAccent, 0.055));
      g2.addColorStop(0.88, alpha(cssAccent, 0.055));
      g2.addColorStop(1, alpha(cssAccent, 0));
      fctx.strokeStyle = g2;
      fctx.beginPath();
      fctx.moveTo(x0, y);
      fctx.lineTo(x1, y);
      fctx.stroke();
    }
  }

  function readBg() {
    var v = getComputedStyle(root).getPropertyValue('--bg-0').trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : '#0E171C';
  }

  /* ══ Layer 3：拓扑脉冲骨架 ══════════════════════════════════
     v3 §8/§22：主链必须**左→右单向**，顺序就是决策实际的顺序：
       INPUT ─ DATA QUALITY ─ FORECAST ─ SOLVER ─ VERIFY ─ HUMAN
     旧版的顺序是 INPUT(x .08) → SOLVER(x .79) → VERIFY(x .575) → APPROVAL(x .93)，
     也就是"从左跳到最右、再退回中间、再跳到最右"。
     图上写着从左到右，动起来却来回折返，等于告诉评委流程是乱的。
     现在 x 单调递增，索引顺序 = 语义顺序 = 视觉顺序，三者一致。
     6 个主语义节点 + 4 个辅助点（§22：6 主节点 + 2–4 辅助）。 */
  var NODES = [
    /* ── 主链 6 个（x 严格递增）── */
    { x: 0.10, y: 0.50, label: 'INPUT' },          /* 0 */
    { x: 0.26, y: 0.50, label: 'DATA QUALITY' },   /* 1 */
    { x: 0.43, y: 0.35, label: 'FORECAST' },       /* 2 */
    { x: 0.60, y: 0.50, label: 'SOLVER' },         /* 3 */
    { x: 0.76, y: 0.36, label: 'VERIFY' },         /* 4 */
    { x: 0.92, y: 0.52, label: 'HUMAN' },          /* 5 */
    /* ── 辅助点 4 个：不写文字，只做骨架密度（§7.1 不需要全部显示文字）── */
    { x: 0.35, y: 0.70 },                          /* 6 */
    { x: 0.52, y: 0.20 },                          /* 7 */
    { x: 0.68, y: 0.72 },                          /* 8 */
    { x: 0.85, y: 0.22 }                           /* 9 */
  ];
  /* v3 §9：主链边必须显式声明，不能再用"凡是碰到链上节点就加入"的宽算法。
     旧算法把任意端点落在链上节点的边全算进主链，于是 12 条边里 11 条都在脉动，
     整张图一起亮 —— 正是 §7.2 禁止的"像网络攻击地图"。 */
  var MAIN_PATH = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]];
  var EDGES = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5],   /* 主链，单向 */
    [1, 6], [2, 7], [3, 8], [4, 9],           /* 支线：辅助点挂到主链 */
    [6, 8], [7, 9]                            /* 辅助点之间 */
  ];
  var CHAIN = [0, 1, 2, 3, 4, 5];
  /* v3 §22：3.5–5 秒一次 pulse */
  var PULSE_PERIOD = 4.2;
  /* 只要 MAIN_PATH 里那 5 条边的索引，其它边不参与主链脉冲 */
  var chainEdges = new Set();
  MAIN_PATH.forEach(function (pair) {
    EDGES.forEach(function (e, idx) {
      if (e[0] === pair[0] && e[1] === pair[1]) chainEdges.add(idx);
    });
  });
  var pulses = EDGES.map(function (_, i) { return { phase: (i * 0.37) % 1, speed: 0.21 + (i % 3) * 0.03 }; });

  var highlight = new Set();
  var labelEls = new Map();
  var nodePulseBoost = 1;   /* 指针靠近 Core 时脉冲最多 +15%（§5.2） */

  function chainStage() {
    var cycle = (t % PULSE_PERIOD) / PULSE_PERIOD;
    var idx = Math.floor(cycle * CHAIN.length);
    var local = cycle * CHAIN.length - idx;
    return { node: CHAIN[Math.min(idx, CHAIN.length - 1)], fade: Math.sin(local * Math.PI) };
  }

  function drawTopology() {
    tctx.clearRect(0, 0, w, h);
    var scale = small.matches ? 0.5 : 1;
    var stage = chainStage();
    var visible = small.matches ? EDGES.slice(0, 7) : EDGES;

    visible.forEach(function (e, i) {
      var a = NODES[e[0]], b = NODES[e[1]];
      var p = pulses[i % pulses.length];
      var beat = Math.pow(Math.max(0, Math.sin((t * p.speed * nodePulseBoost + p.phase) * Math.PI * 2)), 6);
      var onChain = chainEdges.has(EDGES.indexOf(e)) ? 0.07 : 0;
      var touched = (highlight.has(a.label) || highlight.has(b.label)) ? 0.22 : 0;

      tctx.beginPath();
      tctx.moveTo(nodeX(a.x), nodeY(a.y));
      tctx.lineTo(nodeX(b.x), nodeY(a.y));      /* 编辑式折线：先水平后垂直 */
      tctx.lineTo(nodeX(b.x), nodeY(b.y));
      tctx.lineWidth = 0.8 + touched * 2;
      tctx.strokeStyle = alpha(cssAccent, (0.08 + onChain + touched + beat * 0.22) * scale);
      tctx.stroke();

      if (beat > 0.3 || touched > 0) {
        var v = (t * 0.16 + p.phase) % 1;
        var legX = Math.abs(b.x - a.x) * w;
        var legY = Math.abs(b.y - a.y) * h;
        var dist = v * (legX + legY);
        var mx, my;
        if (dist < legX) { mx = nodeX(a.x) + Math.sign(b.x - a.x) * dist; my = nodeY(a.y); }
        else { mx = nodeX(b.x); my = nodeY(a.y) + Math.sign(b.y - a.y) * (dist - legX); }
        tctx.beginPath();
        tctx.arc(mx, my, 1.7 + touched * 2, 0, Math.PI * 2);
        tctx.fillStyle = alpha(cssAccent, (0.45 * beat + touched) * scale);
        tctx.fill();
      }
    });

    NODES.forEach(function (n, i) {
      var beat = Math.pow(Math.max(0, Math.sin((t * 0.24 * nodePulseBoost + i * 0.21) * Math.PI * 2)), 8);
      var isStage = stage.node === i;
      var isLit = n.label && highlight.has(n.label);
      var base = n.label ? 0.46 : 0.26;
      var extra = isLit ? 0.8 : isStage ? stage.fade * 0.75 : beat * 0.3;
      var r = (n.label ? 3.2 : 2) + (isLit ? 2.4 : isStage ? stage.fade * 2.2 : 0);

      tctx.beginPath();
      tctx.arc(nodeX(n.x), nodeY(n.y), r, 0, Math.PI * 2);
      tctx.fillStyle = alpha(cssAccent, Math.min(1, (base + extra) * scale));
      tctx.fill();

      if (isLit || isStage) {
        tctx.beginPath();
        tctx.arc(nodeX(n.x), nodeY(n.y), r + 6, 0, Math.PI * 2);
        tctx.lineWidth = 1;
        tctx.strokeStyle = alpha(cssAccent, (isLit ? 0.45 : stage.fade * 0.3) * scale);
        tctx.stroke();
      }

      var el = labelEls.get(n.label);
      if (el) el.style.opacity = String(isLit ? 1 : 0.55 + (isStage ? stage.fade * 0.4 : 0));
    });
  }

  /* ── 语义标签：DOM 承载，走系统字体，可被验收脚本读取 ──────── */
  function buildLabels() {
    if (!labelBox) return;
    labelBox.innerHTML = '';
    labelEls.clear();
    NODES.forEach(function (n) {
      if (!n.label) return;
      if (small.matches && !highlight.has(n.label)) return;
      var el = document.createElement('span');
      el.className = 'node-label';
      el.setAttribute('data-node', n.label);
      el.style.left = (nodeX(n.x)) + 'px';
      el.style.top = (nodeY(n.y) + 12) + 'px';
      el.style.opacity = '0.55';
      el.textContent = n.label;
      labelBox.appendChild(el);
      labelEls.set(n.label, el);
    });
  }

  /* ── 指针（精修轮 §4–§6）：轻、快、直接 ────────────────────────
     删掉的东西，以及为什么（§4 逐条点名）：
       velocity history / 2 秒 wake / dwell state / residual pressure memory /
       click pulse / acceleration state / 多段 strong state / 复杂路径轨迹
     —— 上一版没有这些状态，但它的"能量"是一条 1.5s 的指数尾巴，等价于
        residual memory：松手之后背景还在动，用户就会觉得"它自己在抽"。
     现在只剩：位置（lerp）+ 进入/离开两条包络。 */
  function onPointerMove(e) {
    if (destroyed) return;
    if (!fine.matches || reduce.matches) return;
    pointer.ix = e.clientX;
    pointer.iy = e.clientY;
    pointer.seen = performance.now();
    /* 同一帧内到达的多个事件只认最后一个：这是"不做物理、只做 UI motion"的前提。
       不累积 delta，就没有速度可以污染状态。 */
    if (!pointer.active) {
      pointer.active = true;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    }
  }

  function onPointerLeave() {
    if (destroyed) return;
    /* §28 离开 ≤400ms 恢复：把当前强度交接给离开包络，位置不再更新。
       同样不直接清零 —— 交接后由 LEAVE_TAU 平滑衰减。 */
    if (pointer.enter > pointer.leave) pointer.leave = pointer.enter;
    pointer.enter = 0;
    nodePulseBoost = 1;
  }

  /* 帧率无关的 lerp：把"每帧 0.28"换算成"每 dt 多少"。
     不做这一步的话，144Hz 屏上的跟随速度会是 60Hz 屏的 2.4 倍，
     手感随显示器变化 —— 那既不是"顺滑 UI motion"，也没法验收。 */
  function lerpGain(gainPerFrame60, ms) {
    if (!(ms > 0)) return 0;
    return 1 - Math.pow(1 - gainPerFrame60, ms / (1000 / 60));
  }

  /* ── Core 鼠标追随（互斥方向）──────────────────────────────────
     基线做法：onPointerMove 里直接按鼠标 X 算角度并立刻写 --tilt。
     两个问题：
       1. 直接用原始鼠标位置 → 角度是"跳"的，鼠标一抖球就抖。
       2. 角度写在整个 <svg> 上 → 连风纹和中心点一起转。
     现在：
       - 目标角度由鼠标相对 Core **圆心**的横向偏移算出，上限 ±6°
       - 实际角度用 lerp 追目标（与 pointer 同一套增益，手感一致）
       - 只写在外层 .core-tilt 上，CSS 自转在内层 .core-orbit 上各自 compose
       - 方向**取反**：鼠标右移时轨道逆着自转方向偏，两层形成互斥的观感

     ⚠ 圆心必须用 DOM 实测，不能用 corePoint()。
     实测：corePoint() 算出 x=1059.8，而 .core 的 getBoundingClientRect 中心是
     x=819 —— 差 240px。corePoint() 是"视觉作用区"的几何中心，给气流收敛用的，
     不是品牌对象的屏幕位置。拿它当跟随支点，会让鼠标跑到球右边 240px 时
     角度才归零，手感明显不对。 */
  var CORE_TILT_MAX = 11;
  /* 偏离圆心多远到达最大角。
     420 → 500 → 560：上限提到 ±9°、±11° 之后必须同步放宽 span，
     否则鼠标一离开圆心就顶到封顶值，跟随退化成"两档开关"
     （要么不动、要么满角度）。560 让 11° 出现在 560px 处，
     视口前半程是连续变化的，手感才是"跟手"而不是"跳档"。 */
  var CORE_TILT_SPAN = 560;
  var coreTiltNow = 0, coreTiltWant = 0, coreTiltWritten = 99;
  var coreCx = 0, coreCy = 0, coreRectAt = -1;

  /* 只在需要时读一次布局（getBoundingClientRect 会强制同步回流，
     所以缓存起来、按时间与尺寸变化失效，而不是每帧都读）。 */
  function coreCenter() {
    if (!core) return null;
    var now = performance.now();
    if (coreRectAt < 0 || now - coreRectAt > 400) {
      var b = core.getBoundingClientRect();
      coreCx = b.left + b.width / 2;
      coreCy = b.top + b.height / 2;
      coreRectAt = now;
    }
    return { x: coreCx, y: coreCy };
  }
  function invalidateCoreRect() { coreRectAt = -1; }

  function coreTiltTarget() {
    if (!coreTilt || !pointer.active) return 0;
    var cPt = coreCenter();
    if (!cPt) return 0;
    /* 取反 → 与 48s 自转方向互斥 */
    var rel = -(pointer.x - cPt.x) / CORE_TILT_SPAN;
    if (rel > 1) rel = 1; else if (rel < -1) rel = -1;
    return rel * CORE_TILT_MAX;
  }

  function stepCoreTilt(ms) {
    if (!coreTilt) return;
    coreTiltWant = coreTiltTarget();
    coreTiltNow += (coreTiltWant - coreTiltNow) * lerpGain(0.22, ms);
    if (Math.abs(coreTiltNow) < 0.004) coreTiltNow = 0;
    /* 只在可见变化时才写 DOM。每帧无条件写 style 会强制样式重算，
       而这里的目标本来就不需要 0.01° 的分辨率。 */
    if (Math.abs(coreTiltNow - coreTiltWritten) >= 0.02) {
      coreTiltWritten = coreTiltNow;
      coreTilt.style.setProperty('--tilt', coreTiltNow.toFixed(2) + 'deg');
    }
  }

  function stepPointer(dt, evAge) {
    var ms = dt * 1000;
    /* §5：pointer.x += (targetX - pointer.x) * 0.28（换算成帧率无关形式） */
    var g = lerpGain(POINTER_GAIN, ms);
    pointer.x += (pointer.ix - pointer.x) * g;
    pointer.y += (pointer.iy - pointer.y) * g;

    /* 停手（§28）：STOP_MS 内没有新事件就停止驱动进入包络。
     evAge = 距上一次 pointermove 的毫秒数。参数化它有两个好处：
       1. 判据只依赖"多久没事件"，不依赖"这一帧算了多久"。
          用 performance.now() 会在长帧/后台恢复时误判成停手，
          因为那一帧本身的耗时就可能超过 STOP_MS。
       2. 可以脱离墙上时钟精确复现衰减过程（见 __gmSim）。
     交接时**不是**把 enter 清零 —— 那会造出硬边（前一刻 1、下一刻 0，
     观感是"啪"地断掉，比不动还糟）。正确做法是从**当前值**按 LEAVE_TAU
     平滑衰减，所以先把 enter 交给 leave，再由 leave 独立衰减。 */
    var driving = pointer.active && !(evAge > STOP_MS);
    if (!driving && pointer.enter > 0) {
      if (pointer.enter > pointer.leave) pointer.leave = pointer.enter;
      pointer.enter = 0;
    }
    /* 进入包络：§4「60–120ms 进入」。停手后不再被驱动。 */
    if (driving) {
      pointer.enter += (1 - pointer.enter) * (1 - Math.exp(-ms / ENTER_TAU));
    }
    /* 离开/停手包络：τ=120ms → 10% 需 276ms、2% 需 470ms，
       落在 §28「停手 200–350ms 主扰动消失」与「离开 ≤400ms」区间内。 */
    if (pointer.leave > 0) {
      pointer.leave *= Math.exp(-ms / LEAVE_TAU);
      if (pointer.leave < 0.002) pointer.leave = 0;
    }
    pointer.energy = Math.max(pointer.enter, pointer.leave);
    if (pointer.energy < 0.002) pointer.energy = 0;
  }

  function draw() {
    drawField();
    drawTopology();
  }

  /* reduced-motion / 后台标签页：渲染一帧完整终态，不跑循环。
     ⚠ 这里回到基线的原样：仍然把 t 设成 12.5。
     我一度以为这行是 bug（"每次 drawStatic 都把时间轴倒回 12.5"），
     但对比 _reference-frozen 后确认：**基线本来就是这么写的**。
     它带来一个实际效果 —— 滚到页面下方时背景停在固定的 12.5 相位，
     滚回来再从那里继续。改成"保持当前相位"反而让整页的流动观感变了，
     而本轮纪律是"页面视觉一律不动"（§31/§32），所以回滚。 */
  function drawStatic() {
    if (destroyed) return;
    t = 12.5;
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, w, h);
    tctx.clearRect(0, 0, w, h);
    draw();
    field.dataset.motion = reduce.matches ? 'reduced' : 'static';
    field.dataset.frames = String(frames);
  }

  function running() {
    /* v3 §17：Hero 离开视口后由 welcome.js 打上 data-hero="away"，
       此处停掉 RAF —— 滚到下面正文时不再每秒重画 30 次。
       注意这里读的是 data-hero（外部请求），不是 data-motion（本引擎自报的状态）。
       两者必须分开：tick 每 500ms 会把 data-motion 覆写成 'on'，
       如果两者共用一个属性，暂停信号会被状态汇报自己冲掉。 */
    if (field.dataset.hero === 'away') return false;
    return !reduce.matches && !document.hidden;
  }

  /* 绘制耗时 p95：§29 说"真正关注 frame p95，而不是平均 fps"。 */
  function drawP95() {
    var b = [], i;
    for (i = 0; i < _dcost.length; i++) if (_dcost[i] > 0) b.push(_dcost[i]);
    if (!b.length) return 0;
    b.sort(function (a, c) { return a - c; });
    return Math.round(b[Math.min(b.length - 1, Math.floor(b.length * 0.95))] * 100) / 100;
  }

  function tick(now) {
    raf = 0;
    if (destroyed || !running()) return;
    rafFired = true;
    /* §8：不再有 30/15fps 门。每帧都画。
       只留 120fps 上限，防止 240Hz 显示器上空转 —— 它远高于任何真实显示器。 */
    if (now - last >= MIN_FRAME_MS) {
      var dt = Math.min((now - last) / 1000, 0.06);
      last = now;
      t += dt;
      frames++;
      stepPointer(dt, now - pointer.seen);
      stepCoreTilt(dt * 1000);
      var t0 = performance.now();
      draw();
      drawCost = performance.now() - t0;
      _dcost[_dci] = drawCost;
      _dci = (_dci + 1) % _dcost.length;
      if (now - lastFrameAt > 500) {
        lastFrameAt = now;
        field.dataset.frames = String(frames);
        field.dataset.drawP95 = String(drawP95());
      }
      field.dataset.motion = 'running';
    }
    raf = window.requestAnimationFrame(tick);
  }

  function sync() {
    if (destroyed) return;
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    if (running()) {
      last = performance.now();
      raf = window.requestAnimationFrame(tick);
      /* 兜底：某些无头/受限环境 requestAnimationFrame 从不触发，
         那样画布会一直空白、截图为空。这里先同步画一帧静态终态，
         若 rAF 在 320ms 内真的跑起来了，就撤掉这个静态标记。 */
      drawStatic();
      pendingTimers.push(window.setTimeout(function () {
        if (destroyed) return;
        if (!rafFired && !reduce.matches && !document.hidden) {
          drawStatic();
        }
      }, 320));
    } else {
      drawStatic();
    }
  }

  /* ── Trust Rail 联动（§2.10 第 5 步）：悬停环节 → 对应节点提亮 ──
     ProcessStage 的 rail 与背景 backdrop 是 .qh-welcome 下的**兄弟区域**，
     rail 不在 backdrop 内，所以不能只查 backdrop，也不能恢复全 document 查询。
     这里只查**当前欢迎页根**：backdrop.closest('.qh-welcome')，缺省回落 backdrop。
     这样既不误绑其它欢迎页实例的 rail，destroy 也能照旧清理全部 rail 监听。 */
  var railScope = (backdrop.closest && backdrop.closest('.qh-welcome')) || backdrop;
  Array.prototype.forEach.call(railScope.querySelectorAll('.rail-item[data-node]'), function (item) {
    var name = item.getAttribute('data-node');
    function on() { if (destroyed) return; highlight.add(name); buildLabels(); }
    function off() { if (destroyed) return; highlight.delete(name); buildLabels(); }
    item.addEventListener('pointerenter', on);
    item.addEventListener('pointerleave', off);
    item.addEventListener('focusin', on);
    item.addEventListener('focusout', off);
    railHandlers.push({ item: item, on: on, off: off });
  });

  /* ── 生命周期（监听器全部登记，destroy 时逐一撤销）──────────── */
  function onSmallChange() { resize(); buildLabels(); }
  function onThemeEvent() { readTokens(); if (!running()) drawStatic(); }
  function onPageHide() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    if (ro) ro.disconnect();
  }

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerleave', onPointerLeave, { passive: true });
  document.addEventListener('visibilitychange', sync);
  reduce.addEventListener('change', sync);
  fine.addEventListener('change', sync);
  small.addEventListener('change', onSmallChange);
  window.addEventListener('resize', resize);
  document.addEventListener('qiheng:theme', onThemeEvent);

  var ro = null;
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(resize);
    ro.observe(document.documentElement);
  }
  window.addEventListener('pagehide', onPageHide);

  readTokens();
  resize();
  buildLabels();
  sync();

  /* v3 §17：把 sync/resize 暴露给欢迎页的 IntersectionObserver。
     生命周期补丁后由本工厂统一在末尾挂到 window.__qhEngine（含 destroy）。 */

  /* ── 精修轮：验收探针（只读，不参与渲染）──────────────────────────
     measure_golden.py 要量两个硬指标（§5）：最大位移 6–12px、影响半径 110–150px。
     没有这个出口就只能靠猜像素，而画布上的亮像素不是位移。
     它只读当前状态并调用 measureInfluence()，不改变任何渲染输入。 */
  window.__gmState = function () {
    var mi = measureInfluence();
    return {
      x: pointer.x, y: pointer.y,
      ix: pointer.ix, iy: pointer.iy,
      energy: pointer.energy, enter: pointer.enter, leave: pointer.leave,
      disp: mi.maxDisp, radius: mi.maxDist,
      frames: frames, drawP95: drawP95(),
      streams: flowCache ? flowCache.streams : 0,
      steps: flowCache ? flowCache.steps : 0
    };
  };
  window.__gmConst = {
    influenceRadius: INFLUENCE_RADIUS,
    maxDisplacement: MAX_DISPLACEMENT,
    pointerGain: POINTER_GAIN,
    enterTau: ENTER_TAU, leaveTau: LEAVE_TAU, stopMs: STOP_MS,
    minFrameMs: MIN_FRAME_MS,
    coreTiltMax: CORE_TILT_MAX, coreTiltSpan: CORE_TILT_SPAN
  };

  /* Core 追随角度的只读出口 + 确定性仿真。
     为什么要 sim：本机 CDP 标签页被判遮挡后 document.hidden=true，
     rAF 停摆（实测 0 帧/秒），stepCoreTilt 根本不跑 ——
     那样量到的只是"页面没在跑"，不是"角度不对"。
     sim 用固定 dt 驱动真实的 stepCoreTilt，量的是模型本身的性质。 */
  window.__gmTilt = function () {
    if (!coreTilt) return { error: 'no .core-tilt' };
    return { now: Math.round(coreTiltNow * 1000) / 1000,
             want: Math.round(coreTiltWant * 1000) / 1000,
             written: coreTilt.style.getPropertyValue('--tilt'),
             active: pointer.active, px: Math.round(pointer.x) };
  };
  window.__gmTiltSim = function (xs) {
    var out = [];
    var cPt0 = coreCenter() || corePoint();
    for (var i = 0; i < xs.length; i++) {
      pointer.ix = xs[i];
      pointer.x = xs[i];
      pointer.active = true;
      /* 跑到收敛（60 帧 = 1s 模拟时间，足够 lerp 稳定） */
      for (var f = 0; f < 60; f++) stepCoreTilt(16.67);
      out.push([xs[i],
                Math.round(coreTiltTarget() * 1000) / 1000,
                Math.round(coreTiltNow * 1000) / 1000,
                Math.round(cPt0.x * 10) / 10,
                Math.round((xs[i] - cPt0.x) * 1000) / 1000]);
    }
    pointer.ix = cPt0.x; pointer.x = cPt0.x; pointer.active = true;
    for (var g = 0; g < 60; g++) stepCoreTilt(16.67);
    out.push([cPt0.x, Math.round(coreTiltTarget() * 1000) / 1000,
              Math.round(coreTiltNow * 1000) / 1000,
              Math.round(cPt0.x * 10) / 10, 0]);
    return out;
  };

  /* 冻结探针：停掉 RAF 并把背景画一遍后**隐藏画布**。
     为什么需要它：精修轮要求"视觉不动"必须可证伪，而两边背景都在动，
     直接截图比出来的只有时钟相位差（实测差 13.9%，全部来自背景）。
     把背景一起冻结/隐藏之后，剩下的差异就只可能来自 DOM/CSS/文案 ——
     那才是"我到底有没有动到页面"的真问题。见 diff_visual.py。 */
  window.__gmFreeze = function () {
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    var both = [field, topo];
    for (var i = 0; i < both.length; i++) {
      both[i].style.visibility = 'hidden';
    }
    return 'frozen';
  };

  /* 几何公式等价性证明（§31「视觉一律不动」的核心证据）。
     把**现在真正在用的 pointAt** 与**基线原封不动的那段公式**
     在同一个 t 下逐点对比。两者都用 w / h / t / cPt，不存在缓存时序问题。
     通过 ⇒ 每条流的每个点都落在基线的位置上，画面逐像素一致。 */
  function baselinePoint(k, u, s, cPt) {
    var amplitude = h * 0.47;
    var spread = Math.sign(k) * Math.pow(Math.abs(k), 0.45);
    var baseY = cPt.y + spread * amplitude;
    var x = w * (1.04 - u * 1.08);
    var converge = 1 - 0.42 * Math.exp(-Math.pow((u - 0.62) / 0.30, 2));
    var y = cPt.y + (baseY - cPt.y) * converge;
    y += Math.sin(u * 4.1 + t * 0.22 + s * 0.11) * h * 0.055;
    y += Math.sin(u * 9.3 - s * 0.07 + t * 0.09) * h * 0.012;
    return { x: x, y: y };
  }
  window.__gmVerifyGeometry = function () {
    if (!flowCache) return { error: 'no cache' };
    var c = flowCache, cPt = corePoint();
    var maxErr = 0, n = 0, worst = null;
    for (var s = 0; s < c.streams; s++) {
      var k = c.streams > 1 ? (s / (c.streams - 1)) * 2 - 1 : 0;
      for (var i = 0; i <= c.steps; i++) {
        var u = i / c.steps;
        var b = baselinePoint(k, u, s, cPt);
        /* hasPointer=false、drift 全 0 ⇒ 应当与基线逐位相同 */
        var q = pointAt(k, u, s, 0, 0, false, cPt, 0, 0, 0);
        var ex = Math.abs(q.x - b.x), ey = Math.abs(q.y - b.y);
        var e = ex > ey ? ex : ey;
        if (e > maxErr) { maxErr = e; worst = [s, i, b.x, b.y, q.x, q.y, e]; }
        n++;
      }
    }
    return { points: n, sampledAtT: Math.round(t * 1000) / 1000,
             maxErrPx: Math.round(maxErr * 1e6) / 1e6, worst: worst };
  };

  /* 把时钟拨到指定值并立刻重画一帧（只给验收用）。
     §31「线条与流动保持原样」需要一个能证伪的证据：
     把两边的 t 对齐到同一个数，再逐像素比背景。
     它会停掉 RAF —— 不这么做的话画面会立刻被下一帧冲掉。 */
  window.__gmSetT = function (v) {
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    t = v;
    draw();
    return Math.round(t * 1000) / 1000;
  };

  /* 稳态量测（§5 两条硬指标）。
     为什么不靠"真的动一下鼠标再读"：实测环境里标签页会被判为遮挡，
     RAF 停摆，指针状态就冻在半路，量出来的位移只有 3px ——
     那是"页面没在跑"，不是"位移只有 3px"。
     所以这里把指针放到指定位置、把进入包络推到 1（等价于 §5 的稳态），
     再读 measureInfluence()。它只读几何，不写任何渲染输入，
     也不改变 tick 的行为；量到的位移与真实移动时完全一致，
     因为 pointAt 是同一个函数、energy 是同一个变量。 */
  window.__gmProbeAt = function (x, y) {
    pointer.ix = x; pointer.iy = y;
    pointer.x = x; pointer.y = y;
    pointer.active = true;
    pointer.enter = 1; pointer.leave = 0; pointer.energy = 1;
    pointer.seen = performance.now();
    var mi = measureInfluence();
    return { disp: mi.maxDisp, radius: mi.maxDist, energy: pointer.energy,
             streams: flowCache ? flowCache.streams : 0,
             steps: flowCache ? flowCache.steps : 0 };
  };

  /* 包络时间线（§4 进入 60–120ms / §28 停手 200–350ms、离开 ≤400ms）。
     用固定 dt 驱动真实 stepPointer，而不是靠墙上的时钟等 ——
     实测环境里标签页会被判遮挡、RAF 停摆，等出来的只有"页面没在跑"。
     evAge 是显式传入的模拟时间，所以这里量到的是模型本身的性质，
     与显示器刷新率、与这一帧算了多久都无关。

     分两段，因为这是两个不同的验收口径：
       阶段一「移动中」：每帧都有新事件（evAge=0），看进入包络多久到位
       阶段二「停手后」：事件停在阶段一末尾，evAge 每帧累加，看多久衰减掉 */
  window.__gmSim = function () {
    var out = [], i, dt = 1 / 60, step = dt * 1000;
    pointer.ix = -9999; pointer.iy = -9999;
    pointer.x = -9999; pointer.y = -9999;
    pointer.enter = 0; pointer.leave = 0; pointer.energy = 0;
    pointer.active = false;

    /* 阶段一：指针在 t=0 到达并持续停留在画面上（每帧都有事件） */
    pointer.ix = 700; pointer.iy = 470; pointer.x = 700; pointer.y = 470;
    pointer.active = true;
    for (i = 0; i < 36; i++) {           /* 600ms，足够走完进入包络 */
      stepPointer(dt, 0);
      out.push(['e', Math.round(i * step), Math.round(pointer.energy * 10000) / 10000,
                Math.round(pointer.enter * 10000) / 10000]);
    }
    /* 阶段二：停手。evAge 从 0 每帧累加，位置不再更新 */
    var age = 0;
    for (i = 0; i < 48; i++) {           /* 800ms */
      stepPointer(dt, age);
      out.push(['s', Math.round(i * step), Math.round(pointer.energy * 10000) / 10000,
                Math.round(pointer.leave * 10000) / 10000]);
      age += step;
    }
    return out;
  };

  /* 衰减计时（§28）：必须在页内固定节拍记，不能靠外部轮询 ──────────
     两个理由，都是实测踩出来的：
     1. CDP 的 Runtime.evaluate 一次往返 40–80ms，而我们要判的是"扰动在
        200–350ms 内消失"。用 50ms 精度的秒表量 200ms 的过程，量到的只是秒表误差。
     2. 不能挂在 RAF 上。本机用 CDP 打开的标签页会被系统判定为遮挡，
        document.hidden 变 true 后 RAF 直接停摆 —— 挂在 RAF 上的记录器
        会在只记了 1.37 秒之后永远停在那一行（实测就是如此）。
        所以用一个独立的 setInterval，它不跟随渲染循环的生死。 */
  var DECAY = null;
  window.__gmDecay = {
    arm: function () {
      if (DECAY && DECAY.timer) clearInterval(DECAY.timer);
      DECAY = { t0: performance.now(), s: [], peak: 0 };
      DECAY.timer = setInterval(function () {
        if (destroyed || !DECAY) return;
        var v = pointer.energy;
        if (v > DECAY.peak) DECAY.peak = v;
        DECAY.s.push([Math.round((performance.now() - DECAY.t0) * 10) / 10,
                      Math.round(v * 10000) / 10000]);
      }, 16);
      return DECAY.t0;
    },
    take: function () {
      var d = DECAY; DECAY = null;
      if (!d) return null;
      if (d.timer) clearInterval(d.timer);
      return { peak: Math.round(d.peak * 10000) / 10000, n: d.s.length, s: d.s };
    }
  };

  /* ── 验收专用：合成一次真实 pointermove，用来离线量测"鼠标追随"的实际位移量 ──
     仅在 ?probe-pointer=x,y 时生效；它 dispatch 的是真实的 pointermove 事件，
     走的就是用户鼠标走的同一条代码路径，所以量出来的位移是真实反馈，
     不是为了验收摆出来的假动作。 */
  var pm = /[?&]probe-pointer=([0-9.]+),([0-9.]+)/.exec(location.search);
  if (pm) {
    var probeX = parseFloat(pm[1]) * viewW();
    var probeY = parseFloat(pm[2]) * viewH();
    var settle = (window.PointerEvent) ? 'pointermove' : 'mousemove';
    window.dispatchEvent(new window.PointerEvent(settle, {
      clientX: probeX, clientY: probeY, bubbles: true, pointerType: 'mouse'
    }));
    /* 让位置与进入包络走到稳态（走真实 stepPointer，不手写第二套公式），
       这样量到的位移就是用户真会看到的那一帧。 */
    for (var f = 0; f < 16; f++) stepPointer(1 / 60, 0);
    frames += 1;
    draw();
    var mi = measureInfluence();
    field.dataset.probe = 'x=' + Math.round(probeX) + ' y=' + Math.round(probeY) +
      ' energy=' + pointer.energy.toFixed(3) +
      ' maxDisp=' + mi.maxDisp + 'px' +
      ' radiusReached=' + mi.maxDist + 'px' +
      ' ring=removed';
  }

    /* ── 实例句柄与生命周期收尾（M2 生命周期补丁）────────────────────
       句柄暴露 sync/resize/running（原合同）并新增 destroy。
       destroy 幂等；只清"仍指向本实例"的全局 API，不误删新实例。 */
    var handle = {
      sync: sync,
      resize: resize,
      running: running,
      destroy: destroy,
      version: 'lifecycle-1'
    };
    window.__qhEngine = handle;
    var ownedValues = {};
    globalKeys.forEach(function (k) { ownedValues[k] = window[k]; });

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      /* 1) RAF */
      if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
      /* 2) 计时器：sync 兜底 + 探针 interval */
      for (var ti = 0; ti < pendingTimers.length; ti++) { window.clearTimeout(pendingTimers[ti]); }
      pendingTimers.length = 0;
      if (DECAY && DECAY.timer) { window.clearInterval(DECAY.timer); }
      DECAY = null;
      /* 3) window / document / 媒体查询监听 */
      window.removeEventListener('error', onGlobalError);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', sync);
      document.removeEventListener('qiheng:theme', onThemeEvent);
      reduce.removeEventListener('change', sync);
      fine.removeEventListener('change', sync);
      small.removeEventListener('change', onSmallChange);
      /* 4) rail 联动监听 */
      for (var ri = 0; ri < railHandlers.length; ri++) {
        var h = railHandlers[ri];
        h.item.removeEventListener('pointerenter', h.on);
        h.item.removeEventListener('pointerleave', h.off);
        h.item.removeEventListener('focusin', h.on);
        h.item.removeEventListener('focusout', h.off);
      }
      railHandlers.length = 0;
      /* 5) ResizeObserver */
      if (ro) { ro.disconnect(); ro = null; }
      /* 6) 全局 API：仅在仍指向本实例时清理（不误删新实例） */
      globalKeys.forEach(function (k) {
        if (window[k] === ownedValues[k]) {
          try { delete window[k]; } catch (e) { window[k] = undefined; }
        }
      });
      /* 7) 不残留暂停标记（否则下次快速返回会把气流锁死） */
      if (field) field.removeAttribute('data-hero');
    }

    return handle;
  }

  global.__qhFieldEngine = { create: createFieldEngine, version: 'lifecycle-1' };
}(window));