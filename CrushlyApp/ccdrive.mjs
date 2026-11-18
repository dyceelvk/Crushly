import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath:'/usr/bin/chromium', args:['--no-sandbox','--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport:{width:1440,height:900} });
const page = await ctx.newPage();
const bad=[];
page.on('console', m=>{ if(m.type()==='error') bad.push(m.text().slice(0,180)); });
page.on('pageerror', e=>bad.push('PAGEERROR '+String(e).slice(0,160)));

await page.goto('https://control.rielincos.com/login', { waitUntil:'domcontentloaded' });
await page.waitForTimeout(6000);
// wait for turnstile token to be filled
let tok='';
for (let i=0;i<20;i++){ tok = await page.locator('input[name="cf-turnstile-response"], input[name="captchaToken"]').first().inputValue().catch(()=> ''); if (tok) break; await page.waitForTimeout(1500); }
console.log('turnstile token len:', tok.length);
if (!tok) { await page.screenshot({path:'/home/user/shots/cc-02-login-blocked.png'}); console.log('BLOCKED at captcha'); await browser.close(); process.exit(0); }

await page.fill('#email','rielosinc@gmail.com');
await page.fill('#password','HolUpp!Admin2026');
await page.screenshot({path:'/home/user/shots/cc-02-login-filled.png'});
await page.locator('button[type="submit"], button:has-text("Sign in")').first().click();
await page.waitForURL(u=>!u.pathname.includes('/login'), {timeout:45000}).catch(()=>console.log('no nav after submit'));
await page.waitForTimeout(3500);
console.log('after login url:', page.url());
await page.screenshot({path:'/home/user/shots/cc-03-landed.png'});
const t = await page.locator('body').innerText();
console.log('landed text:', t.replace(/\s+/g,' ').slice(0,300));
if (bad.length) console.log('console errors:', bad.slice(0,5));
await browser.close();
