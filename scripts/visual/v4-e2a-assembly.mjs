import { chromium } from 'playwright-core';
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage({viewport:{width:1800,height:1050},deviceScaleFactor:1});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5188/tests/harness/e2a-assembly/',{waitUntil:'networkidle'});
  if (await page.locator('canvas').count() !== 6 || errors.length) throw new Error(`Capture failed: ${errors.join('; ')}`);
  await page.screenshot({path:'reports/fidelity-v4/e2a-1/assembly-comparison.png',fullPage:true});
} finally { await browser.close(); }
