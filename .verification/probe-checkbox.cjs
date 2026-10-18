const { buildSync } = require('esbuild');
const { chromium } = require('playwright-core');
const path = require('node:path');
(async () => {
  const bundle = buildSync({ stdin: { resolveDir: __dirname, loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import Checkbox from '@douyinfe/semi-ui/lib/es/checkbox';
    function App() {
      const [checked,setChecked]=React.useState(false);
      return <div className="scroller" style={{height:120,overflow:'auto'}}>
        <div style={{height:500}} />
        <div data-testid="receive_message" onClick={e=>e.preventDefault()}>
          <Checkbox checked={checked} onChange={e=>{ window.changeCount++; setChecked(e.target.checked); }} />
        </div><div style={{height:500}} />
      </div>;
    }
    window.changeCount=0;createRoot(document.querySelector('#app')).render(<App/>);
  ` }, bundle: true, write: false, loader: { '.css': 'empty' }, logLevel: 'silent' }).outputFiles[0].text;
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    for (const target of ['input', '.semi-checkbox', 'prefocus-wrapper']) {
      const page = await browser.newPage();
      await page.setContent('<div id="app"></div>');
      await page.addScriptTag({ content: bundle });
      await page.waitForSelector('input');
      await page.evaluate(target=>{
        if(target==='prefocus-wrapper') {
          document.querySelector('input').focus({preventScroll:true});
          document.querySelector('.semi-checkbox').click();
        } else document.querySelector(target).click();
      },target);
      await page.waitForTimeout(100);
      console.log(target, await page.evaluate(()=>({checked:document.querySelector('input').checked,aria:document.querySelector('input').getAttribute('aria-checked'),scroll:document.querySelector('.scroller').scrollTop,changes:window.changeCount})));
      await page.close();
    }
  } finally { await browser.close(); }
})();
