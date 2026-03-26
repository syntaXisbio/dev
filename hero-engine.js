/**
 * SyntaxisBio Generative Hero Engine
 * Seeded particle system that cycles:
 *   cloud → HeLa cells → cloud → fingerprint → cloud → barcode → repeat
 *
 * Barcode and fingerprint use reference images (images/barcode.gif, images/fingerprint.jpg)
 * sampled the same way as the HeLa cell image — producing realistic particle targets.
 *
 * TUNABLE PARAMETERS: See CONFIG object below.
 * DISABLE ANIMATION: prefers-reduced-motion or HeroEngine.destroy()
 */
(function () {
  'use strict';

  // ─── Configuration ───────────────────────────────────────────────
  const CONFIG = {
    particleCount: 35000,
    particleCountMobile: 8000,
    particleSize: 1.3,
    particleSizeVariation: 0.6,

    noiseAmplitude: 8,
    noiseScale: 0.0015,

    convergenceSpeed: 0.008,
    convergenceSpeedMobile: 0.016,

    // Initial cloud phase (only on first load)
    initialCloudDuration: 2500,
    initialCloudDurationMobile: 1800,

    // Morph duration
    morphDuration: 5000,
    morphDurationMobile: 4000,

    // Hold durations
    holdDuration: 500,
    holdDurationMobile: 400,
    holdDurationShort: 500,
    holdDurationShortMobile: 400,

    gradientStrength: 0.88,
    bgDark: [30, 41, 59],
    bgAccent: [45, 212, 191],

    imageSrc: 'images/HeLa-I.jpg',
    barcodeSrc: 'images/barcode.gif',
    fingerprintSrc: 'images/fingerprint.jpg',
    imageSampleWidth: 500,
    imageSampleWidthMobile: 300,
    edgeWeight: 0.2,

    maxDPR: 2,
    mobileBreakpoint: 768,
    settledDrift: 0.5,
    settledFrequency: 0.0008,
  };

  // ─── Seeded RNG ──────────────────────────────────────────────────
  function generateSeed() {
    return (Date.now() ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ─── Seeded 2D Value Noise ───────────────────────────────────────
  function createNoiseField(rng, gridSize) {
    var grid = [];
    for (var i = 0; i < gridSize * gridSize; i++) grid[i] = rng() * Math.PI * 2;
    function smoothstep(t) { return t * t * (3 - 2 * t); }
    return function (x, y) {
      var gx = x % gridSize; if (gx < 0) gx += gridSize;
      var gy = y % gridSize; if (gy < 0) gy += gridSize;
      var ix = Math.floor(gx), iy = Math.floor(gy);
      var fx = gx - ix, fy = gy - iy;
      var nx = (ix + 1) % gridSize, ny = (iy + 1) % gridSize;
      var sx = smoothstep(fx), sy = smoothstep(fy);
      var a = grid[iy * gridSize + ix], b = grid[iy * gridSize + nx];
      var c = grid[ny * gridSize + ix], d = grid[ny * gridSize + nx];
      return (a + sx * (b - a)) + sy * ((c + sx * (d - c)) - (a + sx * (b - a)));
    };
  }

  // ─── Generic Image Sampler ───────────────────────────────────────
  // Loads an image, converts to grayscale, optionally inverts, returns pixel positions.
  // Used for HeLa (with Sobel edges), barcode (inverted), and fingerprint (direct).
  function sampleImage(src, sampleWidth, options, callback) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      var aspect = img.height / img.width;
      var w = sampleWidth, h = Math.round(w * aspect);
      var offscreen = document.createElement('canvas');
      offscreen.width = w; offscreen.height = h;
      var ctx = offscreen.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      var pixels = ctx.getImageData(0, 0, w, h).data;

      var gray = new Float32Array(w * h);
      var colors = [];
      for (var i = 0; i < w * h; i++) {
        var r = pixels[i*4], g = pixels[i*4+1], b = pixels[i*4+2];
        gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
        colors[i] = [r, g, b];
      }

      // If invert: we want dark pixels (e.g. black bars on white)
      if (options.invert) {
        for (var i = 0; i < gray.length; i++) gray[i] = 255 - gray[i];
      }

      var result = { positions: [], edgePositions: [], brightnessPositions: [], w: w, h: h };

      if (options.sobelEdges) {
        // Gaussian blur + Sobel for edge detection
        var blurred = new Float32Array(w * h);
        var kernel = [1,2,1,2,4,2,1,2,1];
        for (var y = 1; y < h-1; y++) for (var x = 1; x < w-1; x++) {
          var sum = 0;
          for (var ky = -1; ky <= 1; ky++) for (var kx = -1; kx <= 1; kx++)
            sum += gray[(y+ky)*w+(x+kx)] * kernel[(ky+1)*3+(kx+1)];
          blurred[y*w+x] = sum / 16;
        }
        var edges = new Float32Array(w * h); var maxEdge = 0;
        for (var y = 1; y < h-1; y++) for (var x = 1; x < w-1; x++) {
          var gx = -blurred[(y-1)*w+(x-1)] + blurred[(y-1)*w+(x+1)]
                 - 2*blurred[y*w+(x-1)] + 2*blurred[y*w+(x+1)]
                 - blurred[(y+1)*w+(x-1)] + blurred[(y+1)*w+(x+1)];
          var gy = -blurred[(y-1)*w+(x-1)] - 2*blurred[(y-1)*w+x] - blurred[(y-1)*w+(x+1)]
                 + blurred[(y+1)*w+(x-1)] + 2*blurred[(y+1)*w+x] + blurred[(y+1)*w+(x+1)];
          var mag = Math.sqrt(gx*gx + gy*gy);
          edges[y*w+x] = mag;
          if (mag > maxEdge) maxEdge = mag;
        }
        var edgeThreshold = maxEdge * 0.2;
        for (var y = 1; y < h-1; y++) for (var x = 1; x < w-1; x++) {
          if (edges[y*w+x] > edgeThreshold) {
            var c = colors[y*w+x];
            result.edgePositions.push({x:x/w, y:y/h, brightness:gray[y*w+x]/255, r:c[0], g:c[1], b:c[2]});
          }
        }
      }

      // Brightness-weighted positions (every 2nd pixel for performance)
      var maxB = 0;
      for (var i = 0; i < gray.length; i++) if (gray[i] > maxB) maxB = gray[i];
      var threshold = options.brightnessThreshold || 30;
      var step = options.sampleStep || 2;
      for (var y = 0; y < h; y += step) for (var x = 0; x < w; x += step) {
        var val = gray[y*w+x];
        if (val > threshold) {
          var c = colors[y*w+x];
          result.brightnessPositions.push({x:x/w, y:y/h, brightness:val/maxB, r:c[0], g:c[1], b:c[2]});
        }
      }

      callback(result);
    };
    img.onerror = function () {
      callback({ positions:[], edgePositions:[], brightnessPositions:[], w:sampleWidth, h:sampleWidth });
    };
    img.src = src;
  }

  // ─── IC Layout (procedural) ──────────────────────────────────────
  function generateICLayout(count, rng) {
    var positions = [];
    var margin = 0.08, chipW = 1-2*margin, chipH = 1-2*margin;

    // Die outline
    var outlineN = Math.floor(count * 0.08);
    var perim = 2*(chipW+chipH);
    for (var i = 0; i < outlineN; i++) {
      var t = (i/outlineN)*perim, px, py;
      if (t < chipW) { px = margin+t; py = margin; }
      else if (t < chipW+chipH) { px = margin+chipW; py = margin+(t-chipW); }
      else if (t < 2*chipW+chipH) { px = margin+chipW-(t-chipW-chipH); py = margin+chipH; }
      else { px = margin; py = margin+chipH-(t-2*chipW-chipH); }
      positions.push({x:px+(rng()-0.5)*0.002, y:py+(rng()-0.5)*0.002, brightness:0.6+rng()*0.3, r:100,g:180,b:170});
    }

    // Bond pads
    var padN = Math.floor(count * 0.15);
    var padsTop = 10+Math.floor(rng()*4), padsSide = 6+Math.floor(rng()*3);
    var allPads = [];
    for (var i = 0; i < padsTop; i++) {
      var x = margin+0.04+i*((chipW-0.08)/(padsTop-1));
      allPads.push({x:x,y:margin+0.015,w:0.015,h:0.01});
      allPads.push({x:x,y:margin+chipH-0.015,w:0.015,h:0.01});
    }
    for (var i = 0; i < padsSide; i++) {
      var y = margin+0.04+i*((chipH-0.08)/(padsSide-1));
      allPads.push({x:margin+0.015,y:y,w:0.01,h:0.015});
      allPads.push({x:margin+chipW-0.015,y:y,w:0.01,h:0.015});
    }
    var perPad = Math.ceil(padN/allPads.length);
    var padStart = positions.length;
    for (var p = 0; p < allPads.length && positions.length < padStart+padN; p++) {
      var pad = allPads[p];
      for (var j = 0; j < perPad; j++)
        positions.push({x:pad.x+(rng()-0.5)*pad.w, y:pad.y+(rng()-0.5)*pad.h, brightness:0.8+rng()*0.2, r:45,g:212,b:191});
    }

    // Blocks
    var blockN = Math.floor(count * 0.12);
    var numBlocks = 5+Math.floor(rng()*4);
    var blocks = [];
    for (var i = 0; i < numBlocks; i++)
      blocks.push({x:margin+0.1+rng()*(chipW-0.3), y:margin+0.1+rng()*(chipH-0.3), w:0.05+rng()*0.1, h:0.04+rng()*0.08, isTeal:rng()>0.5});
    var perBlock = Math.ceil(blockN/numBlocks);
    var bStart = positions.length;
    for (var b = 0; b < blocks.length && positions.length < bStart+blockN; b++) {
      var blk = blocks[b];
      for (var j = 0; j < perBlock; j++) {
        var peri = 2*(blk.w+blk.h), t = rng()*peri, px, py;
        if (t < blk.w) { px=blk.x+t; py=blk.y; }
        else if (t < blk.w+blk.h) { px=blk.x+blk.w; py=blk.y+(t-blk.w); }
        else if (t < 2*blk.w+blk.h) { px=blk.x+blk.w-(t-blk.w-blk.h); py=blk.y+blk.h; }
        else { px=blk.x; py=blk.y+blk.h-(t-2*blk.w-blk.h); }
        positions.push({x:px+(rng()-0.5)*0.002, y:py+(rng()-0.5)*0.002, brightness:0.6+rng()*0.3,
          r:blk.isTeal?45:200, g:blk.isTeal?212:220, b:blk.isTeal?191:235});
      }
    }

    // Traces
    var traceN = count - positions.length;
    var hTraces = [], vTraces = [];
    for (var i = 0; i < 12+Math.floor(rng()*8); i++)
      hTraces.push({x1:margin+0.03+rng()*0.1, y:margin+0.05+rng()*(chipH-0.1), x2:margin+chipW-0.03-rng()*0.1, isBus:rng()>0.75, isTeal:rng()>0.6});
    for (var i = 0; i < 10+Math.floor(rng()*6); i++)
      vTraces.push({x:margin+0.05+rng()*(chipW-0.1), y1:margin+0.03+rng()*0.1, y2:margin+chipH-0.03-rng()*0.1, isBus:rng()>0.75, isTeal:rng()>0.6});

    var allTraces = [];
    for (var i = 0; i < hTraces.length; i++) { var t=hTraces[i]; t.len=Math.abs(t.x2-t.x1); t.dir='h'; allTraces.push(t); }
    for (var i = 0; i < vTraces.length; i++) { var t=vTraces[i]; t.len=Math.abs(t.y2-t.y1); t.dir='v'; allTraces.push(t); }
    var totalLen = 0;
    for (var i = 0; i < allTraces.length; i++) totalLen += allTraces[i].len*(allTraces[i].isBus?3:1);

    var tStart = positions.length;
    for (var i = 0; i < allTraces.length && positions.length < tStart+traceN; i++) {
      var tr = allTraces[i];
      var np = Math.round((tr.len*(tr.isBus?3:1)/totalLen)*traceN);
      if (i === allTraces.length-1) np = tStart+traceN-positions.length;
      np = Math.min(np, tStart+traceN-positions.length);
      for (var j = 0; j < np; j++) {
        var t = j/np, px, py;
        if (tr.dir==='h') { px=tr.x1+(tr.x2-tr.x1)*t; py=tr.y; } else { px=tr.x; py=tr.y1+(tr.y2-tr.y1)*t; }
        if (tr.isBus) { var lane=Math.floor(rng()*3)-1; if (tr.dir==='h') py+=lane*0.004; else px+=lane*0.004; }
        var spread=(rng()-0.5)*0.001;
        if (tr.dir==='h') py+=spread; else px+=spread;
        positions.push({x:px, y:py, brightness:0.3+rng()*0.3, r:tr.isTeal?45:150, g:tr.isTeal?212:195, b:tr.isTeal?191:205});
      }
    }

    while (positions.length < count) positions.push({x:margin+rng()*chipW, y:margin+rng()*chipH, brightness:0.15, r:100,g:140,b:150});
    if (positions.length > count) positions.length = count;
    return positions;
  }

  // ─── Particle System ─────────────────────────────────────────────
  function createParticles(count, rng, canvasW, canvasH) {
    var particles = new Array(count);
    for (var i = 0; i < count; i++) {
      particles[i] = {
        x: rng() * canvasW, y: rng() * canvasH,
        targetX: canvasW * 0.5, targetY: canvasH * 0.5,
        size: CONFIG.particleSize + rng() * CONFIG.particleSizeVariation,
        alpha: 0.05 + rng() * 0.25, targetAlpha: 0.5,
        r: 200, g: 220, b: 225,
        targetR: 200, targetG: 220, targetB: 225,
        noiseOffsetX: rng() * 1000, noiseOffsetY: rng() * 1000,
      };
    }
    return particles;
  }

  // Set targets from HeLa image (edges + brightness)
  function setImageTargets(particles, edgePositions, brightnessPositions, canvasW, canvasH, rng, scale) {
    if (edgePositions.length === 0 && brightnessPositions.length === 0) return;
    scale = scale || 1.0;
    var offsetX = (1 - scale) / 2;
    var offsetY = (1 - scale) / 2;
    var edgeCount = Math.floor(particles.length * CONFIG.edgeWeight);

    var shuffled = edgePositions.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
    }

    var totalW = 0;
    for (var i = 0; i < brightnessPositions.length; i++) totalW += brightnessPositions[i].brightness;

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i], src;
      if (i < edgeCount && shuffled.length > 0) {
        src = shuffled[i % shuffled.length];
        p.targetX = (offsetX + src.x * scale + (rng()-0.5)*0.003) * canvasW;
        p.targetY = (offsetY + src.y * scale + (rng()-0.5)*0.003) * canvasH;
        p.targetAlpha = 0.6 + src.brightness * 0.4;
        p.targetR = Math.round(src.r*0.5 + 160*0.5);
        p.targetG = Math.round(src.g*0.5 + 200*0.5);
        p.targetB = Math.round(src.b*0.5 + 190*0.5);
      } else if (brightnessPositions.length > 0) {
        var r = rng() * totalW, cum = 0; src = brightnessPositions[0];
        for (var j = 0; j < brightnessPositions.length; j++) {
          cum += brightnessPositions[j].brightness;
          if (cum >= r) { src = brightnessPositions[j]; break; }
        }
        p.targetX = (offsetX + src.x * scale + (rng()-0.5)*0.006) * canvasW;
        p.targetY = (offsetY + src.y * scale + (rng()-0.5)*0.006) * canvasH;
        p.targetAlpha = 0.4 + src.brightness * 0.6;
        p.targetR = Math.round(src.r*0.5 + 160*0.5);
        p.targetG = Math.round(src.g*0.5 + 200*0.5);
        p.targetB = Math.round(src.b*0.5 + 190*0.5);
      }
    }
  }

  // Set targets from a pre-sampled reference image (barcode, fingerprint)
  function setRefImageTargets(particles, brightnessPositions, canvasW, canvasH, rng, tintR, tintG, tintB, scale) {
    if (brightnessPositions.length === 0) return;
    scale = scale || 1.0;
    // Scale and center: map [0,1] positions to [offset, offset+scale]
    var offsetX = (1 - scale) / 2;
    var offsetY = (1 - scale) / 2;

    var totalW = 0;
    for (var i = 0; i < brightnessPositions.length; i++) totalW += brightnessPositions[i].brightness;

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var r = rng() * totalW, cum = 0;
      var src = brightnessPositions[0];
      for (var j = 0; j < brightnessPositions.length; j++) {
        cum += brightnessPositions[j].brightness;
        if (cum >= r) { src = brightnessPositions[j]; break; }
      }
      p.targetX = (offsetX + src.x * scale + (rng()-0.5)*0.004) * canvasW;
      p.targetY = (offsetY + src.y * scale + (rng()-0.5)*0.004) * canvasH;
      p.targetAlpha = 0.3 + src.brightness * 0.7;
      p.targetR = tintR;
      p.targetG = tintG;
      p.targetB = tintB;
    }
  }

  // Set targets from procedural IC layout
  function setICTargets(particles, canvasW, canvasH, rng) {
    var positions = generateICLayout(particles.length, rng);
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var src = positions[i];
      p.targetX = src.x * canvasW;
      p.targetY = src.y * canvasH;
      p.targetAlpha = 0.3 + src.brightness * 0.7;
      p.targetR = Math.round(src.r * 0.5 + 180 * 0.5);
      p.targetG = Math.round(src.g * 0.5 + 220 * 0.5);
      p.targetB = Math.round(src.b * 0.5 + 210 * 0.5);
    }
  }

  // ─── Easing ──────────────────────────────────────────────────────
  function easeInOutCubic(t) {
    return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
  }

  // ─── Main Engine ─────────────────────────────────────────────────
  var engine = {
    canvas: null, ctx: null, particles: null, noise: null,
    seed: 0, rng: null,
    // Sampled data for each pattern
    helaEdges: null, helaBright: null,
    barcodeData: null,
    fingerprintData: null,
    loadedCount: 0, totalLoads: 3,
    animId: null, isMobile: false, canvasW: 0, canvasH: 0, dpr: 1,

    // Cycling state
    // Phases: 'initialCloud' → 'morph' → 'hold' → 'morph' → 'hold' → ...
    phase: 'initialCloud',
    phaseStartTime: 0,
    stepIndex: 0,
    stepTargets: ['image', 'fingerprint', 'barcode'],

    init: function () {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      this.canvas = document.getElementById('hero-canvas');
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.isMobile = window.innerWidth < CONFIG.mobileBreakpoint;
      this.dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDPR);
      this.resize();

      this.seed = generateSeed();
      this.rng = mulberry32(this.seed);
      console.log('[HeroEngine] seed:', this.seed);

      this.noise = createNoiseField(this.rng, 64);
      var count = this.isMobile ? CONFIG.particleCountMobile : CONFIG.particleCount;
      this.particles = createParticles(count, this.rng, this.canvasW, this.canvasH);

      this.stepTargets = ['image', 'fingerprint', 'barcode'];
      console.log('[HeroEngine] cycle: HeLa → fingerprint → barcode (continuous morph)');

      var self = this;
      var sampleW = this.isMobile ? CONFIG.imageSampleWidthMobile : CONFIG.imageSampleWidth;

      sampleImage(CONFIG.imageSrc, sampleW, { sobelEdges: true, brightnessThreshold: 30, sampleStep: 2 }, function (data) {
        self.helaEdges = data.edgePositions;
        self.helaBright = data.brightnessPositions;
        self.onImageLoaded();
      });

      sampleImage(CONFIG.barcodeSrc, sampleW, { invert: true, brightnessThreshold: 50, sampleStep: 1 }, function (data) {
        self.barcodeData = data.brightnessPositions;
        self.onImageLoaded();
      });

      sampleImage(CONFIG.fingerprintSrc, sampleW, { invert: false, brightnessThreshold: 30, sampleStep: 1 }, function (data) {
        self.fingerprintData = data.brightnessPositions;
        self.onImageLoaded();
      });

      this.phase = 'initialCloud';
      this.stepIndex = 0;
      this.phaseStartTime = performance.now();
      this.animate(performance.now());

      var resizeTimeout;
      window.addEventListener('resize', function () {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(function () { self.handleResize(); }, 200);
      });
    },

    onImageLoaded: function () {
      this.loadedCount++;
      if (this.loadedCount >= this.totalLoads) {
        console.log('[HeroEngine] all images loaded — barcode:',
          (this.barcodeData||[]).length, 'pts, fingerprint:',
          (this.fingerprintData||[]).length, 'pts, HeLa edges:',
          (this.helaEdges||[]).length, 'pts');
        // Set first target (HeLa)
        this.applyTargets(0);
      }
    },

    applyTargets: function (stepIdx) {
      var target = this.stepTargets[stepIdx % this.stepTargets.length];
      var rng2 = mulberry32(this.seed + stepIdx * 7919);

      if (target === 'image' && this.helaEdges) {
        setImageTargets(this.particles, this.helaEdges, this.helaBright, this.canvasW, this.canvasH, rng2, 0.6);
      } else if (target === 'barcode' && this.barcodeData) {
        setRefImageTargets(this.particles, this.barcodeData, this.canvasW, this.canvasH, rng2, 235, 240, 245, 0.6);
      } else if (target === 'fingerprint' && this.fingerprintData) {
        setRefImageTargets(this.particles, this.fingerprintData, this.canvasW, this.canvasH, rng2, 230, 230, 225);
      }
    },

    getPhaseDuration: function () {
      var m = this.isMobile;
      if (this.phase === 'initialCloud') {
        return m ? CONFIG.initialCloudDurationMobile : CONFIG.initialCloudDuration;
      } else if (this.phase === 'morph') {
        return m ? CONFIG.morphDurationMobile : CONFIG.morphDuration;
      } else { // hold
        var target = this.stepTargets[this.stepIndex % this.stepTargets.length];
        if (target === 'image') return m ? CONFIG.holdDurationMobile : CONFIG.holdDuration;
        return m ? CONFIG.holdDurationShortMobile : CONFIG.holdDurationShort;
      }
    },

    advancePhase: function (time) {
      if (this.phase === 'initialCloud') {
        // First morph: converge from cloud to first pattern (HeLa)
        this.phase = 'morph';
        this.applyTargets(this.stepIndex);
      } else if (this.phase === 'morph') {
        // Arrived at pattern — hold it
        this.phase = 'hold';
      } else if (this.phase === 'hold') {
        // Move to next pattern — morph directly (no cloud)
        this.stepIndex++;
        this.phase = 'morph';
        this.applyTargets(this.stepIndex);
      }
      this.phaseStartTime = time;
    },

    resize: function () {
      var rect = this.canvas.parentElement.getBoundingClientRect();
      this.canvasW = rect.width; this.canvasH = rect.height;
      this.canvas.width = this.canvasW * this.dpr;
      this.canvas.height = this.canvasH * this.dpr;
      this.canvas.style.width = this.canvasW + 'px';
      this.canvas.style.height = this.canvasH + 'px';
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    },

    handleResize: function () {
      this.isMobile = window.innerWidth < CONFIG.mobileBreakpoint;
      this.resize();
      this.setCurrentTargets();
    },

    drawBackground: function () {
      var ctx = this.ctx, w = this.canvasW, h = this.canvasH;
      var grad = ctx.createLinearGradient(0, 0, w, h);
      var d = CONFIG.bgDark, a = CONFIG.bgAccent, s = CONFIG.gradientStrength;
      grad.addColorStop(0, 'rgba('+d[0]+','+d[1]+','+d[2]+','+s+')');
      grad.addColorStop(1, 'rgba('+a[0]+','+a[1]+','+a[2]+','+(s*0.85)+')');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    },

    updateAndDrawParticles: function (time) {
      var ctx = this.ctx;
      var elapsed = time - this.phaseStartTime;
      var duration = this.getPhaseDuration();
      var progress = Math.min(elapsed / duration, 1);
      var easedProgress = easeInOutCubic(progress);
      var particles = this.particles;
      var w = this.canvasW, h = this.canvasH;
      var spd = this.isMobile ? CONFIG.convergenceSpeedMobile : CONFIG.convergenceSpeed;
      var phase = this.phase;

      // Delta time for frame-rate independent motion
      var dt = Math.min((time - (this._lastTime || time)) / 1000, 0.05); // cap at 50ms
      this._lastTime = time;

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];

        if (phase === 'initialCloud') {
          // Gentle drift during initial cloud
          var nx = (p.x + p.noiseOffsetX) * CONFIG.noiseScale;
          var ny = (p.y + p.noiseOffsetY) * CONFIG.noiseScale;
          var angle = this.noise(nx, ny);
          var speed = CONFIG.noiseAmplitude * dt;
          p.x += Math.cos(angle) * speed;
          p.y += Math.sin(angle) * speed;
          if (p.x < 0) p.x += w; if (p.x > w) p.x -= w;
          if (p.y < 0) p.y += h; if (p.y > h) p.y -= h;
        } else if (phase === 'morph') {
          // Smooth lerp toward current target
          var lf = spd * (1 + easedProgress * 3);
          p.x += (p.targetX - p.x) * lf;
          p.y += (p.targetY - p.y) * lf;
          p.alpha += (p.targetAlpha - p.alpha) * lf;
          p.r += (p.targetR - p.r) * lf;
          p.g += (p.targetG - p.g) * lf;
          p.b += (p.targetB - p.b) * lf;
        } else { // hold — continue easing toward target + gentle drift
          var driftX = Math.sin(time * CONFIG.settledFrequency + p.noiseOffsetX) * CONFIG.settledDrift;
          var driftY = Math.cos(time * CONFIG.settledFrequency + p.noiseOffsetY) * CONFIG.settledDrift;
          p.x += (p.targetX + driftX - p.x) * 0.08;
          p.y += (p.targetY + driftY - p.y) * 0.08;
          p.alpha += (p.targetAlpha - p.alpha) * 0.05;
          p.r += (p.targetR - p.r) * 0.05;
          p.g += (p.targetG - p.g) * 0.05;
          p.b += (p.targetB - p.b) * 0.05;
        }

        var alpha = p.alpha;
        if (phase === 'initialCloud') alpha *= 0.25 + easedProgress * 0.35;
        ctx.fillStyle = 'rgba('+Math.round(p.r)+','+Math.round(p.g)+','+Math.round(p.b)+','+alpha+')';
        ctx.fillRect(p.x - p.size*0.5, p.y - p.size*0.5, p.size, p.size);
      }
    },

    animate: function (time) {
      var self = this;
      var elapsed = time - this.phaseStartTime;
      if (elapsed >= this.getPhaseDuration()) this.advancePhase(time);

      this.ctx.clearRect(0, 0, this.canvasW, this.canvasH);
      this.drawBackground();
      this.updateAndDrawParticles(time);
      this.animId = requestAnimationFrame(function (t) { self.animate(t); });
    },

    destroy: function () {
      if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
    },
  };

  // ─── Initialize ──────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { engine.init(); });
  } else {
    engine.init();
  }

  window.HeroEngine = {
    destroy: function () { engine.destroy(); },
    getSeed: function () { return engine.seed; },
    getConfig: function () { return CONFIG; },
  };
})();
