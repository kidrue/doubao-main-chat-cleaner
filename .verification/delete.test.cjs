const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, '豆包主对话批量删除.js');
const { buildSync } = require('esbuild');

for (const mode of ['after-bottom', 'already-open']) {
test(`真实删除确认框 HTML：${mode}，主区 aria-hidden 时仍只确认一次`, async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    const html = fs.readFileSync(path.join(root, '删除确认框.txt'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    await page.setContent(html);
    const dialogHTML = await page.locator('[role="dialog"][data-slot="dialog-content"]').evaluate(element => element.outerHTML);
    assert.match(dialogHTML, /是否删除该条消息/);
    await page.setContent('<main><div data-container-name="conversation-message-area"><div data-testid="message-list"><div class="scroller" style="height:120px;overflow:auto"><div data-testid="union_message"><div data-testid="send_message" data-attr="select-mode"><input type="checkbox" checked><div data-testid="message_content" data-message-id="dialog-1">message</div></div></div></div></div></div><button id="bottom">删除</button></main><div id="portals"></div>');
    await page.evaluate(({ mode, dialogHTML }) => {
      window.dialogStats = { bottom: 0, confirmed: 0, cancelled: 0 };
      const show = () => {
        document.querySelector('main').setAttribute('aria-hidden', 'true');
        document.body.style.pointerEvents = 'none';
        const render = () => {
          document.querySelector('#portals').innerHTML = dialogHTML;
          const dialog = document.querySelector('[role="dialog"]');
          const buttons = Array.from(dialog.querySelectorAll('[data-slot="dialog-footer"] button'));
          buttons.find(element => element.textContent.trim() === '取消').onclick = () => { dialogStats.cancelled++; };
          buttons.find(element => element.textContent.trim() === '删除').onclick = event => {
            dialogStats.confirmed++;
            event.currentTarget.dataset.loading = 'true';
            setTimeout(() => {
              dialog.remove(); document.querySelector('[data-testid="union_message"]').remove();
              document.querySelector('main').removeAttribute('aria-hidden');
              document.querySelector('#bottom').hidden = true;
              document.body.style.pointerEvents = '';
            }, 60);
          };
        };
        if (mode === 'already-open') render();
        else setTimeout(render, 30);
      };
      document.querySelector('#bottom').onclick = () => { dialogStats.bottom++; show(); };
      if (mode === 'already-open') show();
    }, { mode, dialogHTML });
    await page.evaluate(fs.readFileSync(scriptPath, 'utf8').replace('void api.start();', '/* 手动测试启动 */'));
    const status = await page.evaluate(() => doubaoCleaner.start({ maxBatches: 1, scrollDelay: 5, actionDelay: 5, batchDelay: 5, settleDelay: 5, pollInterval: 10, timeout: 500 }));
    assert.equal(status.reason, 'limit', status.error);
    assert.deepEqual(await page.evaluate(() => dialogStats), { bottom: mode === 'already-open' ? 0 : 1, confirmed: 1, cancelled: 0 });
    assert.equal(status.removedFromView, 1);
    assert.equal(await page.locator('[role="dialog"]').count(), 0);
  } finally { await browser.close(); }
});
}

for (const mode of ['normal', 'cancel-input-default', 'restored-legacy', 'blocked-click', 'rejected-change', 'partial-permanent', 'partial-transient']) {
test(`真实 React/Semi 受控复选框：${mode}，提交正确状态且不滚动虚拟列表`, async () => {
  const bundle = buildSync({ stdin: { resolveDir: __dirname, loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import Checkbox from '@douyinfe/semi-ui/lib/es/checkbox';
    function App() {
      const partial=window.testMode.startsWith('partial-');
      const [messages,setMessages]=React.useState(partial?['semi-1','semi-2','semi-3','semi-4','bad']:['semi-1','semi-2','semi-3']);
      const [selected,setSelected]=React.useState(partial?messages.slice(0,4):window.testMode==='restored-legacy'?messages:[]);
      const [selecting,setSelecting]=React.useState(true);
      const [menu,setMenu]=React.useState(false);
      React.useLayoutEffect(()=>{
        if(window.testMode==='restored-legacy') document.querySelectorAll('input').forEach(input=>{input.checked=false;});
      },[]);
      return <><main onClickCapture={e=>{
        if(window.testMode==='blocked-click'&&e.target.closest('.semi-checkbox'))e.stopPropagation();
      }}><div data-container-name="conversation-message-area"><div data-testid="message-list">
        <div className="scroller" style={{height:120,overflow:'auto'}}><div style={{height:500}} />
        {messages.map(id=><div data-testid="union_message" key={id}>
          <div data-testid="receive_message" data-attr={selecting?'select-mode':''}
            onClick={e=>{if(window.testMode==='cancel-input-default')e.preventDefault();}}>
            {selecting&&<Checkbox checked={selected.includes(id)} onChange={e=>{
              window.semiStats.changes.push(id);
              if(window.testMode==='rejected-change'||id==='bad'&&(window.testMode==='partial-permanent'||messages.length>1))return;
              setSelected(current=>e.target.checked?[...current,id]:current.filter(item=>item!==id));
            }}/>}<div data-testid="message_content" data-message-id={id}>message</div>
            {!selecting&&<button data-testid="message_action_more" onPointerOver={()=>setMenu(true)}>...</button>}
          </div></div>)}<div style={{height:500}} />
        </div></div></div><button hidden={!selecting} disabled={!selected.length} onClick={()=>{
          window.semiStats.submitted.push([...selected]);
          window.semiStats.scrollAtSubmit=document.querySelector('.scroller').scrollTop;
          setMessages(messages.filter(id=>!selected.includes(id)));setSelecting(false);
        }}>删除</button></main>{menu&&<div role="menu"><div role="menuitem" data-testid="message_action_delete" onClick={()=>{setMenu(false);setSelected([]);setSelecting(true);}}>删除</div></div>}</>;
    }
    createRoot(document.querySelector('#app')).render(<App/>);
  ` }, bundle: true, write: false, loader: { '.css': 'empty' }, logLevel: 'silent' }).outputFiles[0].text;
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page=await browser.newPage();
    await page.route('**/*',route=>route.abort());
    await page.setContent('<div id="app"></div>');
    await page.evaluate(mode=>{window.testMode=mode;window.semiStats={changes:[],submitted:[],scrollAtSubmit:null};},mode);
    await page.addScriptTag({content:bundle});
    await page.waitForSelector('.semi-checkbox');
    await page.evaluate(fs.readFileSync(scriptPath,'utf8').replace('void api.start();','/* 手动测试启动 */'));
    const status=await page.evaluate(mode=>doubaoCleaner.start({batchSize:mode.startsWith('partial-')?100:2,maxBatches:mode.startsWith('partial-')?10:1,maxStalledRounds:mode==='rejected-change'?1:2,checkboxTimeout:60,emptyChecks:2,scrollDelay:5,actionDelay:5,pollInterval:10,timeout:250,settleDelay:5,batchDelay:5}),mode);
    if(mode.startsWith('partial-')){
      const stats=await page.evaluate(()=>semiStats);
      assert.deepEqual(stats.submitted[0],['semi-1','semi-2','semi-3','semi-4'],'未能勾选坏记录时仍应提交已选中的四条');
      if(mode==='partial-permanent'){
        assert.equal(status.reason,'stalled');
        assert.equal(status.batches,1);
        assert.equal(status.removedFromView,4);
        assert.deepEqual(stats.submitted,[['semi-1','semi-2','semi-3','semi-4']]);
        assert.deepEqual(status.deferredMessageIds,['bad']);
        assert.equal(status.stalledRounds,2);
        assert.match(status.error,/未处理/);
        assert.deepEqual(await page.locator('[data-message-id]').evaluateAll(elements=>elements.map(element=>element.dataset.messageId)),['bad']);
      }else{
        assert.equal(status.reason,'empty',status.error);
        assert.equal(status.removedFromView,5);
        assert.deepEqual(stats.submitted,[['semi-1','semi-2','semi-3','semi-4'],['bad']]);
      }
      return;
    }
    if(mode==='rejected-change'){
      assert.equal(status.reason,'stalled');
      const stats=await page.evaluate(()=>semiStats);
      assert.deepEqual(stats.submitted,[],'组件拒绝更改状态时不能提交删除');
      assert.deepEqual(stats.changes,['semi-1','semi-1','semi-2','semi-2','semi-3','semi-3'],'每条消息只进行一次组件回调恢复');
      assert.equal(await page.locator('input').first().getAttribute('aria-checked'),'false');
      assert.equal(await page.locator('input').first().isChecked(),false);
      return;
    }
    assert.equal(status.reason,'limit',status.error);
    const stats=await page.evaluate(()=>semiStats);
    assert.deepEqual(stats.submitted,[['semi-1','semi-2']]);
    assert.equal(stats.scrollAtSubmit,0,'勾选不应触发 input.focus 导致列表跳动');
    assert.deepEqual(stats.changes,mode==='restored-legacy'?['semi-3']:['semi-1','semi-2']);
    if(mode==='blocked-click')assert.equal(status.checkboxRecoveries,2);
  }finally{await browser.close();}
});
}

for (const mode of ['pointerdown', 'delayed-hover', 'replaced-trigger', 'pointerdown-remount', 'during-menu-wait', 'continuous-remount', 'selection-at-deadline', 'late-selection', 'never-select']) {
test(`Radix 菜单触发：${mode}，不会漏发按下事件或关闭已展开的菜单`, async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent('<main><div data-container-name="conversation-message-area"><div data-testid="message-list"><div class="scroller" style="height:200px;overflow:auto"><div data-testid="union_message"><div data-testid="receive_message"><div data-testid="message_content" data-message-id="radix-1"></div></div></div></div></div></div><button id="submit" hidden>删除</button></main>');
    await page.evaluate(mode => {
      window.menuStats = { down: 0, submitted: 0, menuSelected: 0 };
      const row = document.querySelector('[data-testid="receive_message"]');
      let outer = document.createElement('button');
      outer.setAttribute('aria-haspopup', 'menu');
      outer.setAttribute('aria-expanded', 'false');
      outer.setAttribute('data-slot', 'dropdown-menu-trigger');
      outer.setAttribute('aria-controls', 'radix-menu');
      // React 可生成嵌套按钮 DOM；setContent 解析 HTML 会改写这种嵌套，必须动态构造。
      const inner = document.createElement('button');
      inner.dataset.testid = 'message_action_more';
      inner.dataset.triggerType = 'hover';
      inner.textContent = '...';
      outer.append(inner);
      row.append(outer);
      if (mode === 'replaced-trigger') {
        inner.addEventListener('pointerover', () => setTimeout(() => {
          const replacement = outer.cloneNode(true);
          outer.replaceWith(replacement);
          outer = replacement;
          outer.addEventListener('pointerdown', openMenu);
        }, 30), { once: true });
      }
      const openMenu = event => {
        if (event.button !== 0 || event.ctrlKey) return;
        if (event.type === 'pointerdown') menuStats.down++;
        event.preventDefault();
        if (outer.getAttribute('aria-expanded') === 'true') {
          outer.setAttribute('aria-expanded', 'false');
          return;
        }
        outer.setAttribute('aria-expanded', 'true');
        if (mode === 'pointerdown-remount' || mode === 'continuous-remount') {
          const replacement = outer.cloneNode(true);
          outer.replaceWith(replacement);
          outer = replacement;
          outer.addEventListener('pointerdown', openMenu);
          if (mode === 'continuous-remount') {
            outer.setAttribute('aria-expanded', 'false');
            return;
          }
        }
        if (mode === 'during-menu-wait' && menuStats.down === 1) setTimeout(() => {
          const replacement = outer.cloneNode(true);
          outer.replaceWith(replacement);
          outer = replacement;
          outer.setAttribute('aria-expanded', 'false');
          outer.addEventListener('pointerdown', openMenu);
        }, 10);
        setTimeout(() => {
          if (outer.getAttribute('aria-expanded') !== 'true') return;
          const menu = document.createElement('div');
          menu.id = 'radix-menu'; menu.setAttribute('role', 'menu');
          menu.innerHTML = '<div role="menuitem" data-testid="message_action_delete">删除</div>';
          menu.firstElementChild.onclick = () => {
            menuStats.menuSelected++;
            menu.remove(); outer.remove();
            const enter = () => {
              row.dataset.attr = 'select-mode';
              row.insertAdjacentHTML('afterbegin', '<input type="checkbox">');
              document.querySelector('#submit').hidden = false;
            };
            if (mode === 'selection-at-deadline') {
              const originalNow = Date.now.bind(Date);
              let bias = 0;
              Date.now = () => originalNow() + bias;
              setTimeout(() => { enter(); bias = 1000; }, 5);
            } else if (mode === 'late-selection') {
              setTimeout(enter, 320);
            } else if (mode !== 'never-select') {
              enter();
            }
          };
          document.body.append(menu);
        }, mode === 'delayed-hover' ? 450 : 30);
      };
      outer.addEventListener('pointerdown', openMenu);
      if (mode === 'delayed-hover') outer.addEventListener('pointerover', openMenu);
      document.querySelector('#submit').onclick = () => {
        menuStats.submitted++;
        document.querySelector('[data-testid="union_message"]').remove();
        document.querySelector('#submit').hidden = true;
      };
    }, mode);
    await page.evaluate(fs.readFileSync(scriptPath, 'utf8').replace('void api.start();', '/* 手动测试启动 */'));
    const status = await page.evaluate(() => doubaoCleaner.start({ scrollDelay: 5, actionDelay: 5, settleDelay: 5, batchDelay: 5, pollInterval: 10, timeout: 250, maxBatches: 1 }));
    if (mode === 'continuous-remount') {
      assert.equal(status.reason, 'error');
      assert.match(status.error, /重新定位 3 次/);
      assert.deepEqual(await page.evaluate(() => menuStats), { down: 3, submitted: 0, menuSelected: 0 });
      return;
    }
    if (mode === 'never-select') {
      assert.equal(status.reason, 'error');
      assert.match(status.error, /消息选择模式的复选框/);
      assert.equal(status.selectionDiagnostics.areas[0].modes, 0);
      assert.equal(status.selectionDiagnostics.areas[0].checkboxes, 0);
      assert.deepEqual(await page.evaluate(() => menuStats), { down: 1, submitted: 0, menuSelected: 1 });
      return;
    }
    assert.equal(status.reason, 'limit', status.error);
    if (mode === 'late-selection') assert.equal(status.selectionWaitRecoveries, 1);
    assert.deepEqual(await page.evaluate(() => menuStats), { down: mode === 'delayed-hover' ? 0 : mode === 'during-menu-wait' ? 2 : 1, submitted: 1, menuSelected: 1 });
  } finally { await browser.close(); }
});
}

// 测试只在隔离的本地页面运行，禁止外部请求。
test('串行删除虚拟列表、跳过已选项、处理确认、拒绝重复启动', async () => {
  assert.ok(fs.existsSync(scriptPath), '尚未实现控制台删除脚本');
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent(`<main data-container-name="main"><div data-container-name="conversation-message-area"><div data-testid="message-list"><div class="scroller" style="height:200px;overflow:auto"></div></div></div><button id="delete" hidden>删除</button></main><input id="unrelated" type="checkbox"><div id="portals"></div>`);
    await page.evaluate(() => {
      window.model = { ids: ['1','2','3','4','5'], requests: 0, maxRequests: 0, batches: 0, selected: [], clicks: {}, cancelled: false };
      const scroller = document.querySelector('.scroller');
      const button = document.querySelector('#delete');
      const portals = document.querySelector('#portals');
      window.render = (select = false) => {
        scroller.innerHTML = model.ids.slice(0, 3).map(id => `<div data-testid="union_message"><div data-testid="send_message" data-attr="${select ? 'select-mode' : ''}">${select ? `<input type="checkbox" ${id === model.ids[0] ? 'checked' : ''}>` : ''}<div data-testid="message_content" data-message-id="${id}"></div>${select ? '' : '<button data-testid="message_action_more" data-trigger-type="hover">...</button>'}</div></div>`).join('');
        button.hidden = !select;
        scroller.querySelectorAll('input').forEach(input => input.addEventListener('click', () => { const id = input.parentElement.querySelector('[data-message-id]').dataset.messageId; model.clicks[id] = (model.clicks[id] || 0) + 1; }));
        scroller.querySelectorAll('[data-testid="message_action_more"]').forEach(el => el.addEventListener('pointerover', () => {
          portals.innerHTML = '<div role="menu"><div role="menuitem" data-testid="message_action_delete">删除</div></div>';
          portals.firstElementChild.firstElementChild.onclick = () => { portals.innerHTML = ''; render(true); };
        }));
      };
      button.onclick = () => {
        const ids = Array.from(scroller.querySelectorAll('input:checked')).map(input => input.parentElement.querySelector('[data-message-id]').dataset.messageId);
        portals.innerHTML = '<div role="alertdialog">确定删除所选消息？<button>确认删除</button></div>';
        portals.querySelector('button').onclick = () => {
          portals.innerHTML = ''; model.requests++; model.maxRequests = Math.max(model.requests, model.maxRequests); model.batches++;
          setTimeout(() => { model.ids = model.ids.filter(id => !ids.includes(id)); model.selected.push(...ids); model.requests--; render(); }, 80);
        };
      };
      render();
    });
    // 安装脚本的自动启动在测试中替换成可控启动。
    await page.evaluate(fs.readFileSync(scriptPath, 'utf8').replace('void api.start();', '/* 手动测试启动 */'));
    const result = await page.evaluate(async () => {
      const first = doubaoCleaner.start({ batchSize: 2, actionDelay: 15, scrollDelay: 25, settleDelay: 30, batchDelay: 25, pollInterval: 15, timeout: 2000, emptyChecks: 2 });
      const duplicate = await doubaoCleaner.start();
      const status = await first;
      return { duplicate, status, model, unrelated: document.querySelector('#unrelated').checked };
    });
    assert.equal(result.model.ids.length, 0);
    assert.equal(new Set(result.model.selected).size, 5);
    assert.equal(result.model.maxRequests, 1);
    assert.ok(result.model.batches >= 3);
    assert.equal(result.duplicate, false);
    assert.equal(result.unrelated, false);
    assert.equal(result.status.reason, 'empty');
    assert.ok(Object.values(result.model.clicks).every(count => count === 1));

    await page.evaluate(() => { model.ids = ['a','b']; render(); });
    const stopped = await page.evaluate(async () => {
      const run = doubaoCleaner.start({ actionDelay: 100, scrollDelay: 300 });
      setTimeout(() => doubaoCleaner.stop(), 30);
      return await run;
    });
    assert.equal(stopped.reason, 'stopped');
    assert.deepEqual(await page.evaluate(() => model.ids), ['a','b']);

    // 删除请求卡住时，必须停止，不能再次点击删除或重复提交。
    await page.evaluate(() => {
      model.ids = ['slow-1','slow-2']; render(); model.submitCount = 0;
      document.querySelector('#delete').onclick = () => { model.submitCount++; };
    });
    const timeout = await page.evaluate(() => doubaoCleaner.start({ batchSize: 2, actionDelay: 5, scrollDelay: 5, pollInterval: 10, timeout: 150 }));
    assert.equal(timeout.reason, 'error');
    assert.match(timeout.error, /等待超时/);
    assert.equal(await page.evaluate(() => model.submitCount), 1);

    // 从已进入选择模式的页面重启时，取消超量预选，再提交有限的一批。
    await page.evaluate(() => {
      model.ids = ['pre-1','pre-2','pre-3']; render(true);
      document.querySelectorAll('.scroller input').forEach(input => { input.checked = true; });
      model.lastBatchSize = 0;
      document.querySelector('#delete').onclick = () => {
        const selected = Array.from(document.querySelectorAll('.scroller input:checked'));
        model.lastBatchSize = selected.length;
        const ids = selected.map(input => input.parentElement.querySelector('[data-message-id]').dataset.messageId);
        model.ids = model.ids.filter(id => !ids.includes(id)); render();
      };
    });
    const limited = await page.evaluate(() => doubaoCleaner.start({ batchSize: 2, actionDelay: 5, scrollDelay: 5, settleDelay: 5, batchDelay: 5, pollInterval: 10, timeout: 200, maxBatches: 1 }));
    assert.equal(limited.reason, 'limit');
    assert.equal(await page.evaluate(() => model.lastBatchSize), 2);
    assert.equal(await page.evaluate(() => model.ids.length), 1);

    const navigated = await page.evaluate(async () => {
      const run = doubaoCleaner.start({ scrollDelay: 100 });
      setTimeout(() => { location.hash = 'other-chat'; }, 20);
      return await run;
    });
    assert.equal(navigated.reason, 'error');
    assert.match(navigated.error, /页面地址已改变/);
  } finally { await browser.close(); }
});

test('用户提供的三个 HTML 状态具有精确定位所需的结构', async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    for (const file of ['默认.txt', '点击了会话的扩展按钮.txt', '点击了删除选项.txt']) {
      const html = fs.readFileSync(path.join(root, file), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      await page.setContent(html);
      assert.equal(await page.locator('[data-container-name="conversation-message-area"]').count(), 1);
      assert.equal(await page.locator('[data-testid="message-list"] .scroller').count(), 1);
      if (file === '默认.txt') assert.ok(await page.locator('[data-testid="message-list"] [data-testid="message_action_more"]').count());
      if (file === '点击了会话的扩展按钮.txt') assert.equal(await page.locator('[data-testid="message_action_delete"]').count(), 1);
      if (file === '点击了删除选项.txt') {
        assert.ok(await page.locator('[data-testid="message-list"] [data-attr="select-mode"] input[type="checkbox"]').count());
        assert.equal(await page.locator('main button').filter({ hasText: /^删除$/ }).count(), 1);
      }
    }
  } finally { await browser.close(); }
});
