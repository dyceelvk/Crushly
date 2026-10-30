// Browser-level regression: an HTML video with intrinsic dimensions must fit
// the frame using the same style object as VideoEditCanvas.
// Run: node --import tsx scripts/check-video-frame.cjs (Chromium required).
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { VIDEO_FRAME_FILL } = require('../src/lib/videoFrame.ts');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const results = await page.evaluate(async (style) => {
      const tests = [];
      for (const [sourceWidth, sourceHeight, width, height] of [[1280,720,300,200], [720,1280,300,500], [800,800,353,353]]) {
        document.body.innerHTML = '<div id="frame" style="position:relative;overflow:hidden"><video id="video"></video></div>';
        const frame = document.querySelector('#frame');
        const video = document.querySelector('#video');
        frame.style.width = `${width}px`; frame.style.height = `${height}px`;
        const canvas = document.createElement('canvas'); canvas.width = sourceWidth; canvas.height = sourceHeight;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0,0,sourceWidth,sourceHeight);
        const recorder = new MediaRecorder(canvas.captureStream(10)); const chunks = [];
        recorder.ondataavailable = e => chunks.push(e.data); recorder.start();
        await new Promise(r => setTimeout(r,120));
        const stopped = new Promise(r => recorder.onstop = r); recorder.stop(); await stopped;
        video.src = URL.createObjectURL(new Blob(chunks, {type:'video/webm'}));
        await new Promise((resolve,reject) => { video.onloadedmetadata=resolve; video.onerror=reject; });
        Object.assign(video.style, { ...style, objectFit: 'contain' });
        const rect = video.getBoundingClientRect(), parent = frame.getBoundingClientRect();
        tests.push({ source: `${video.videoWidth}x${video.videoHeight}`, actual: [rect.width,rect.height], expected:[parent.width,parent.height], fit: getComputedStyle(video).objectFit });
      }
      return tests;
    }, VIDEO_FRAME_FILL);
    for (const r of results) { assert.deepEqual(r.actual,r.expected); assert.equal(r.fit,'contain'); console.log(`PASS ${r.source}: video ${r.actual.join('x')} inside ${r.expected.join('x')} frame; contain`); }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
