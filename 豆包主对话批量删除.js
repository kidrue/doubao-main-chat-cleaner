/* 在豆包「主对话」页面的开发者工具 Console 中粘贴本文件全部内容。
 * 粘贴后立即开始删除。停止：doubaoCleaner.stop()
 * 再次启动：doubaoCleaner.start({ batchSize: 20, batchDelay: 2500 })
 * 仅操作当前页面主消息区；不会自动切换左侧会话。
 */
(() => {
  'use strict';

  if (window.doubaoCleaner?.running) {
    console.warn('[豆包清理] 已有任务运行，不能重复启动。停止：doubaoCleaner.stop()');
    return window.doubaoCleaner;
  }

  const defaults = Object.freeze({
    batchSize: 100,        // 一批最多选择多少条消息；并发始终为 1
    actionDelay: 180,     // 两次勾选之间的间隔（毫秒）
    scrollDelay: 1000,    // 每次滚到顶部后等待虚拟列表渲染
    settleDelay: 2000,    // 删除后等待页面稳定
    batchDelay: 2500,     // 两批之间休息
    pollInterval: 200,
    timeout: 30000,       // 某一步超时后停止，避免盲目重试删除
    checkboxTimeout: 1500, // 点击或恢复后的勾选状态等待上限
    maxStalledRounds: 2,  // 连续无消息可删时停止，避免反复卡在同一条
    emptyChecks: 3,       // 连续多少次没有消息才结束
    maxBatches: Infinity,
  });
  const version = '2026-10-17.8';
  const selectors = {
    area: '[data-container-name="conversation-message-area"]',
    list: '[data-testid="message-list"]',
    more: '[data-testid="message_action_more"]',
    menuDelete: '[data-testid="message_action_delete"]',
    content: '[data-testid="message_content"][data-message-id]',
    checkbox: '[data-attr="select-mode"] input[type="checkbox"]',
  };
  let running = false;
  let stopped = false;
  let config;
  let pageURL;
  let lastStatus = null;

  const log = (...args) => console.log('[豆包清理]', ...args);
  const text = element => (element.textContent || '').replace(/\s+/g, '').trim();
  const all = (root, selector) => Array.from(root.querySelectorAll(selector));
  const enabled = element => !element.disabled &&
    element.getAttribute('aria-disabled') !== 'true' &&
    element.getAttribute('data-disabled') !== 'true' &&
    element.getAttribute('data-loading') !== 'true' &&
    !element.hasAttribute('disabled');
  function rendered(element) {
    if (!element?.isConnected || !element.getClientRects().length) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      !element.closest('[hidden]');
  }
  function visible(element) {
    return rendered(element) && !element.closest('[aria-hidden="true"]');
  }
  function check() {
    if (stopped) throw new Error('STOP_REQUESTED');
    if (location.href !== pageURL) throw new Error('页面地址已改变，停止操作。');
  }
  async function sleep(ms) {
    const end = Date.now() + ms;
    do {
      check();
      await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(0, end - Date.now()))));
    } while (Date.now() < end);
    check();
  }
  async function waitFor(read, description, timeout = config.timeout) {
    const deadline = Date.now() + timeout;
    for (;;) {
      check();
      const result = read();
      if (result) return result;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(config.pollInterval, remaining));
    }
    const error = new Error(`等待超时：${description}。请检查页面状态。`);
    error.code = 'WAIT_TIMEOUT';
    throw error;
  }
  function area(allowModal = false) {
    // 弹窗打开时只允许读取被 aria-hidden 遮挡的主区，不在其后方操作。
    const found = all(document, selectors.area).filter(allowModal ? rendered : visible);
    if (found.length !== 1) throw new Error('未找到唯一的主消息区，请打开主对话页面。');
    return found[0];
  }
  function main() {
    const element = area().closest('main, [data-container-name="main"]');
    if (!element) throw new Error('找不到主对话容器。');
    return element;
  }
  function list() { return area().querySelector(selectors.list); }
  function ids() {
    return new Set(all(area(), selectors.content).map(element => element.dataset.messageId));
  }
  function boxes(allowModal = false) { return all(area(allowModal), selectors.checkbox); }
  function isChecked(input) {
    // Semi 的受控状态写在 aria-checked；input 原生激活可能被 preventDefault 回滚。
    const state = input.getAttribute('aria-checked');
    if (state === 'true' || state === 'false') return state === 'true';
    return input.checked;
  }
  function selecting() { return !!area().querySelector('[data-attr="select-mode"]'); }
  function selectionReady() {
    const currentAreas = all(document, selectors.area).filter(visible);
    return currentAreas.length === 1 && !!currentAreas[0].querySelector(selectors.checkbox);
  }
  function selectionSnapshot() {
    return {
      capturedAt: new Date().toISOString(),
      areas: all(document, selectors.area).map(element => ({
        visible: visible(element),
        modes: element.querySelectorAll('[data-attr="select-mode"]').length,
        checkboxes: element.querySelectorAll('input[type="checkbox"]').length,
        selectionCheckboxes: element.querySelectorAll(selectors.checkbox).length,
      })),
      menuDeleteItems: all(document, selectors.menuDelete).map(element => ({
        visible: visible(element),
        state: element.closest('[role="menu"]')?.getAttribute('data-state') ?? null,
        disabled: element.getAttribute('data-disabled'),
      })),
      dialogs: all(document, '[role="dialog"], [role="alertdialog"]').map(element => ({
        visible: visible(element),
        state: element.getAttribute('data-state'),
        title: element.querySelector('[data-slot="dialog-title"]')?.textContent?.trim() ?? null,
      })),
    };
  }
  async function waitForSelection() {
    try {
      await waitFor(selectionReady, '消息选择模式的复选框');
    } catch (error) {
      check();
      if (error.code !== 'WAIT_TIMEOUT') throw error;
      log('选择模式仍在渲染，追加一次有限等待；不重复点击菜单。');
      try {
        await waitFor(selectionReady, '消息选择模式的复选框', Math.min(config.timeout, 5000));
      } catch (finalError) {
        check();
        lastStatus.selectionDiagnostics = selectionSnapshot();
        console.error('[豆包清理] 选择模式诊断：', JSON.stringify(lastStatus.selectionDiagnostics));
        throw finalError;
      }
      lastStatus.selectionWaitRecoveries++;
    }
    await sleep(config.actionDelay);
  }
  function messageID(input) {
    const row = input.closest('[data-testid="send_message"], [data-testid="receive_message"]') ||
      input.closest('[data-testid="union_message"]');
    const id = row?.querySelector(selectors.content)?.dataset.messageId;
    if (!id) throw new Error('复选框无法对应到消息 ID，停止以免误选。');
    return id;
  }
  function click(element) {
    check();
    if (!element?.isConnected || !enabled(element)) throw new Error('目标按钮失效或仍在加载。');
    element.click();
  }
  function menuTrigger(button) {
    const selector = '[data-slot="dropdown-menu-trigger"], [aria-haspopup="menu"]';
    return button.closest(selector) || button.parentElement?.closest(selector) || button;
  }
  function pressMenuTrigger(trigger) {
    check();
    if (!trigger.isConnected || !enabled(trigger)) return false;
    const rect = trigger.getBoundingClientRect();
    const init = {
      bubbles: true, cancelable: true, view: window,
      button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
    };
    // Radix 在外层触发器的 pointerdown 中展开菜单，单独 .click() 不会触发。
    const allowed = trigger.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 1 }));
    const events = [];
    if (allowed) events.push(new MouseEvent('mousedown', { ...init, buttons: 1 }));
    events.push(new PointerEvent('pointerup', { ...init, buttons: 0 }));
    if (allowed) events.push(new MouseEvent('mouseup', { ...init, buttons: 0 }));
    for (const event of events) {
      if (!trigger.isConnected || !enabled(trigger)) return false;
      trigger.dispatchEvent(event);
    }
    if (!trigger.isConnected || !enabled(trigger)) return false;
    click(trigger);
    return true;
  }
  async function top() {
    // 只驱动主消息列表。不会滚动侧栏，也不会预加载全部历史记录。
    for (let pass = 0; pass < 2; pass++) {
      const current = list();
      if (!current) { await sleep(config.scrollDelay); continue; }
      const scroller = current.querySelector('.scroller') ||
        all(current, 'div').find(element => /auto|scroll/.test(getComputedStyle(element).overflowY));
      if (!scroller) throw new Error('主消息列表滚动容器不存在，页面结构可能已改变。');
      check();
      scroller.scrollTo({ top: 0, behavior: 'instant' });
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(config.scrollDelay);
    }
  }
  async function enterSelect() {
    if (selectionReady()) return;
    if (selecting()) { await waitForSelection(); return; }
    const findItem = () => all(document, selectors.menuDelete).find(element => visible(element) && enabled(element));
    const findMore = () => {
      const currentArea = all(document, selectors.area).find(visible);
      const currentList = currentArea?.querySelector(selectors.list);
      return currentList && all(currentList, selectors.more).find(element => visible(element) && enabled(element));
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      check();
      if (selectionReady()) return;
      let item = findItem();
      if (!item) {
        let button = await waitFor(findMore, '消息的“更多”按钮');
        const row = button.closest('[data-testid="union_message"]') || button;
        for (const element of [row, button]) {
          if (!element.isConnected) continue;
          element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
          element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
          element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        }
        await sleep(Math.max(350, config.actionDelay));
        if (selectionReady()) return;
        item = findItem();
        if (!item) {
          // 跨过 await 后只使用重新查询到的节点，旧按钮可能已被虚拟列表卸载。
          button = findMore();
          if (!button) { await sleep(config.pollInterval); continue; }
          const trigger = menuTrigger(button);
          if (trigger.getAttribute('aria-expanded') !== 'true' && trigger.dataset.state !== 'open') {
            if (!pressMenuTrigger(trigger)) {
              await sleep(config.pollInterval);
              continue;
            }
          }
          try {
            item = await waitFor(() => {
              const currentItem = findItem();
              if (currentItem) return currentItem;
              if (!trigger.isConnected) {
                const error = new Error('等待菜单时触发器被替换。');
                error.code = 'MENU_NODE_REPLACED';
                throw error;
              }
              return false;
            }, '消息菜单中的“删除”');
          } catch (error) {
            check();
            if (error.code !== 'MENU_NODE_REPLACED') throw error;
            await sleep(config.pollInterval);
            continue;
          }
        }
      }
      // await 返回后菜单项也可能重建，再查询一次再点击。
      item = findItem();
      if (!item) { await sleep(config.pollInterval); continue; }
      click(item);
      await waitForSelection();
      return;
    }
    if (selectionReady()) return;
    throw new Error('消息菜单节点连续变化，重新定位 3 次后仍未进入选择模式。');
  }
  async function selectBatch() {
    lastStatus.deferredMessageIds = [];
    // 接管已打开的选择模式时，先清掉多余的预选，确保批量上限生效。
    let checked = boxes().filter(isChecked);
    for (const input of checked.slice(config.batchSize)) {
      await setCheckbox(messageID(input), false);
    }
    const attempted = new Set();
    while ((checked = boxes().filter(isChecked)).length < config.batchSize) {
      const next = boxes().find(input => !isChecked(input) && enabled(input) && !attempted.has(messageID(input)));
      if (!next) break;
      const id = messageID(next);
      attempted.add(id);
      try {
        await setCheckbox(id, true);
      } catch (error) {
        check();
        if (error.code !== 'CHECKBOX_REJECTED') throw error;
        lastStatus.deferredMessageIds.push(id);
        lastStatus.checkboxFailures++;
        console.warn(`[豆包清理] 消息 ${id} 本批无法勾选，暂缓处理，继续核对其余已选消息。`);
      }
    }
    checked = boxes().filter(isChecked);
    if (checked.length > config.batchSize) throw new Error('所选消息超过批量上限，停止。');
    return checked.map(messageID);
  }
  async function setCheckbox(id, desired) {
    check();
    const input = boxes().find(element => messageID(element) === id);
    if (!input || !enabled(input)) throw new Error(`消息 ${id} 的复选框不存在或已禁用。`);
    if (isChecked(input) === desired) return;
    // Semi 的点击处理器挂在外层 span。先无滚动聚焦，避免其 focus() 驱动虚拟列表跳动。
    input.focus({ preventScroll: true });
    click(input.closest('.semi-checkbox') || input);
    try {
      const updated = () => boxes().some(element => messageID(element) === id && isChecked(element) === desired);
      const description = `${desired ? '勾选' : '取消勾选'}消息 ${id}`;
      try {
        await waitFor(updated, description, Math.min(config.timeout, config.checkboxTimeout, 1000));
      } catch (error) {
        check();
        if (error.code !== 'WAIT_TIMEOUT') throw error;
        // 仅恢复选择状态；不改写 checked 或 React 内部状态，也不直接调用删除接口。
        const current = boxes().find(element => messageID(element) === id);
        if (!current || !enabled(current)) throw error;
        if (isChecked(current) !== desired) {
          const component = controlledCheckbox(current);
          if (!component) throw error;
          log(`消息 ${id} 的点击未更新状态，尝试一次组件 onChange 恢复。`);
          const nativeEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
          const notify = component.props.onChange;
          notify({
            target: { ...component.props, checked: desired },
            currentTarget: current.closest('.semi-checkbox') || current,
            nativeEvent,
            stopPropagation: () => nativeEvent.stopPropagation(),
            preventDefault: () => nativeEvent.preventDefault(),
          });
          await waitFor(updated, description, Math.min(config.timeout, config.checkboxTimeout));
          lastStatus.checkboxRecoveries++;
        }
      }
    } catch (error) {
      check();
      const current = boxes().find(element => messageID(element) === id);
      lastStatus.failedCheckbox = {
        id, desired, found: !!current,
        nativeChecked: current?.checked ?? null,
        ariaChecked: current?.getAttribute('aria-checked') ?? null,
        scrollTop: list()?.querySelector('.scroller')?.scrollTop ?? null,
        selectedCheckboxes: boxes().filter(isChecked).length,
        componentChecked: current ? controlledCheckbox(current)?.props.checked ?? null : null,
      };
      if (error.code === 'WAIT_TIMEOUT' && desired && current && !isChecked(current)) {
        error.code = 'CHECKBOX_REJECTED';
        console.warn('[豆包清理] 暂缓消息的复选框诊断：', lastStatus.failedCheckbox);
      } else {
        console.error('[豆包清理] 复选框诊断：', lastStatus.failedCheckbox);
      }
      throw error;
    }
    await sleep(config.actionDelay);
  }
  function controlledCheckbox(input) {
    const wrapper = input.closest('.semi-checkbox');
    if (!wrapper) return null;
    const key = Object.keys(wrapper).find(name => name.startsWith('__reactFiber$'));
    let fiber = key ? wrapper[key] : null;
    // 诊断确认线上控件是 React 受控组件；只找最近的 checked/onChange 组件。
    for (let depth = 0; fiber && depth < 12; depth++, fiber = fiber.return) {
      if (!fiber.type || typeof fiber.type === 'string') continue;
      const props = fiber.stateNode?.props || fiber.memoizedProps;
      if (typeof props?.checked !== 'boolean' || typeof props.onChange !== 'function') continue;
      if (props.disabled || props.readOnly) return null;
      return { props };
    }
    return null;
  }
  function deleteButton() {
    // 排除消息正文中的按钮和菜单项，只认主区外层的底部按钮。
    const found = all(main(), 'button').filter(element => visible(element) &&
      /^删除(?:[（(]?\d+[）)]?)?$/.test(text(element)) &&
      !element.closest(`${selectors.list}, [role="dialog"], [role="alertdialog"], [role="menu"]`));
    if (found.length > 1) throw new Error('匹配到多个底部删除按钮，停止。');
    return found.find(enabled);
  }
  function deletionDialogs() {
    return all(document, '[role="dialog"], [role="alertdialog"], .semi-modal-content')
      .filter(element => visible(element) && element.dataset.state !== 'closed' && /删除/.test(text(element)));
  }
  function confirmation() {
    const buttons = new Set(deletionDialogs().flatMap(dialog => {
      const footer = dialog.querySelector('[data-slot="dialog-footer"]') || dialog;
      return all(footer, 'button, [role="button"]');
    })
      .filter(element => visible(element) && enabled(element) && /^(?:确认删除|确定删除|删除|确认|确定)$/.test(text(element))));
    if (buttons.size > 1) throw new Error('确认弹窗存在多个候选按钮，请手动检查。');
    return [...buttons][0];
  }
  async function deleteBatch(selected) {
    if (!deletionDialogs().length) {
      const button = await waitFor(deleteButton, '底部可用的“删除”按钮');
      click(button); // 本批仅提交一次；已有确认框时直接接管，不重复提交。
    }
    let confirmed = false;
    await waitFor(() => {
      const confirm = confirmation();
      if (confirm && !confirmed) {
        click(confirm);
        confirmed = true;
        return false;
      }
      // Radix 打开确认框后会隐藏主区的无障碍树；关闭并恢复主区后再核对结果。
      if (deletionDialogs().length || !all(document, selectors.area).some(visible)) return false;
      if (selecting()) return false;
      const remaining = ids();
      return selected.every(id => !remaining.has(id));
    }, '退出选择模式，且所选消息离开当前列表');
    await sleep(config.settleDelay);
    const remaining = ids();
    if (selected.some(id => remaining.has(id))) throw new Error('所选消息重新出现，可能删除失败，已停止。');
  }

  const api = {
    version,
    diagnose() { return { version, status: api.status, ...selectionSnapshot() }; },
    get running() { return running; },
    get status() { return lastStatus ? { ...lastStatus } : null; },
    defaults,
    stop() {
      stopped = true;
      log('已请求停止；已发出的删除请求无法撤回。');
    },
    async start(options = {}) {
      if (running) { console.warn('[豆包清理] 任务正在运行，忽略重复启动。'); return false; }
      config = { ...defaults, ...options };
      if (!Number.isInteger(config.batchSize) || config.batchSize < 1 || config.batchSize > 100) {
        throw new Error('batchSize 必须为 1～100 的整数。');
      }
      for (const key of ['actionDelay', 'scrollDelay', 'settleDelay', 'batchDelay', 'pollInterval', 'timeout', 'checkboxTimeout']) {
        if (!Number.isFinite(config[key]) || config[key] < (['pollInterval', 'timeout', 'checkboxTimeout'].includes(key) ? 1 : 0)) {
          throw new Error(`${key} 必须是有效的毫秒数。`);
        }
      }
      if (!Number.isInteger(config.emptyChecks) || config.emptyChecks < 1 ||
          !Number.isInteger(config.maxStalledRounds) || config.maxStalledRounds < 1 ||
          !(config.maxBatches === Infinity || Number.isInteger(config.maxBatches) && config.maxBatches >= 1)) {
        throw new Error('emptyChecks、maxStalledRounds、maxBatches 必须为正整数（maxBatches 也可为 Infinity）。');
      }
      running = true;
      stopped = false;
      pageURL = location.href;
      lastStatus = {
        version, batches: 0, removedFromView: 0, checkboxRecoveries: 0,
        checkboxFailures: 0, deferredMessageIds: [], stalledRounds: 0, selectionWaitRecoveries: 0,
        reason: 'running', error: null,
      };
      let empty = 0;
      log(`版本 ${version} 开始：并发 1，每批最多 ${config.batchSize} 条。停止：doubaoCleaner.stop()`);
      try {
        area(deletionDialogs().length > 0);
        while (lastStatus.batches < config.maxBatches) {
          check();
          let selected;
          if (deletionDialogs().length) {
            lastStatus.deferredMessageIds = [];
            selected = boxes(true).filter(isChecked).map(messageID);
            if (!selected.length || selected.length > config.batchSize) {
              throw new Error('已打开的确认框无法对应到批量上限内的所选消息，请取消弹窗后再启动。');
            }
            log('接管已打开的消息删除确认框。');
          } else {
            await top();
            const count = ids().size;
            if (!count && !selecting()) {
              empty++;
              if (empty >= config.emptyChecks) {
                lastStatus.reason = 'empty';
                lastStatus.deferredMessageIds = [];
                log(`连续 ${empty} 次未发现消息，结束。请刷新页面核对历史是否已清空。`);
                break;
              }
              await sleep(config.batchDelay);
              continue;
            }
            await enterSelect();
            selected = await selectBatch();
          }
          empty = 0;
          if (!selected.length) {
            lastStatus.stalledRounds++;
            if (!lastStatus.deferredMessageIds.length) lastStatus.deferredMessageIds = [...ids()];
            if (lastStatus.stalledRounds >= config.maxStalledRounds) {
              lastStatus.reason = 'stalled';
              lastStatus.error = `连续 ${lastStatus.stalledRounds} 轮没有可删除的选中消息；仍有消息未处理：${lastStatus.deferredMessageIds.slice(0, 10).join(', ') || '当前列表中的消息'}。未全部清空。`;
              console.warn('[豆包清理] 已停止：', lastStatus.error);
              break;
            }
            log('本轮没有可删除的选中消息；等待后重新定位重试。');
            await sleep(config.batchDelay);
            continue;
          }
          log(`第 ${lastStatus.batches + 1} 批：选择 ${selected.length} 条，提交删除。`);
          await deleteBatch(selected);
          lastStatus.batches++;
          lastStatus.removedFromView += selected.length;
          lastStatus.stalledRounds = 0;
          log(`已处理 ${lastStatus.batches} 批，${lastStatus.removedFromView} 条消息已离开当前列表。`);
          await sleep(config.batchDelay);
        }
        if (lastStatus.reason === 'running') lastStatus.reason = 'limit';
      } catch (error) {
        lastStatus.reason = stopped ? 'stopped' : 'error';
        lastStatus.error = stopped ? null : error.message;
        if (stopped) log('任务已停止。');
        else console.error('[豆包清理] 已停止：', error.message);
      } finally {
        running = false;
      }
      return { ...lastStatus };
    },
  };

  window.doubaoCleaner = api;
  void api.start();
  return api;
})();
