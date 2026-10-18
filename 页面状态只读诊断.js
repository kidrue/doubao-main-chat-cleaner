/* 在发生超时的豆包页面 Console 粘贴全文；只读取 DOM，不点击、不勾选、不删除。 */
(() => {
  'use strict';
  const all = (root, selector) => Array.from(root.querySelectorAll(selector));
  const props = element => {
    const key = Object.keys(element).find(name => name.startsWith('__reactProps$') || name.startsWith('__reactEventHandlers$'));
    return key ? element[key] : null;
  };
  function layout(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      connected: element.isConnected,
      rects: element.getClientRects().length,
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      ariaHiddenAncestor: !!element.closest('[aria-hidden="true"]'),
      hiddenAncestor: !!element.closest('[hidden]'),
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }
  function componentHandlers(element) {
    const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
    const result = [];
    let fiber = key ? element[key] : null;
    for (let depth = 0; fiber && depth < 12; depth++, fiber = fiber.return) {
      const current = fiber.stateNode?.props || fiber.memoizedProps;
      if (!fiber.type || typeof fiber.type === 'string') continue;
      result.push({
        name: fiber.type.displayName || fiber.type.name || 'anonymous',
        onClick: typeof current?.onClick === 'function',
        onSelect: typeof current?.onSelect === 'function',
        disabled: current?.disabled === true,
      });
    }
    return result;
  }
  const areas = all(document, '[data-container-name="conversation-message-area"]');
  const result = {
    version: window.doubaoCleaner?.version ?? null,
    status: window.doubaoCleaner?.status ?? null,
    isTopFrame: window === window.top,
    areaCount: areas.length,
    areas: areas.map(element => ({
      layout: layout(element),
      selectModeCount: element.querySelectorAll('[data-attr="select-mode"]').length,
      checkboxCount: element.querySelectorAll('input[type="checkbox"], [role="checkbox"]').length,
      selectionCheckboxCount: element.querySelectorAll('[data-attr="select-mode"] input[type="checkbox"]').length,
      rowStates: all(element, '[data-testid="send_message"], [data-testid="receive_message"]').slice(0, 16).map(row => ({
        type: row.dataset.testid,
        mode: row.getAttribute('data-attr'),
        id: row.querySelector('[data-message-id]')?.dataset.messageId ?? null,
      })),
    })),
    globalCheckboxes: all(document, 'input[type="checkbox"], [role="checkbox"]').slice(0, 20).map(element => ({
      tag: element.tagName,
      role: element.getAttribute('role'),
      checked: element.checked ?? null,
      ariaChecked: element.getAttribute('aria-checked'),
      mode: element.closest('[data-attr]')?.getAttribute('data-attr') ?? null,
      inMessageArea: !!element.closest('[data-container-name="conversation-message-area"]'),
      layout: layout(element),
    })),
    menuDeleteItems: all(document, '[data-testid="message_action_delete"]').map(element => ({
      role: element.getAttribute('role'),
      label: (element.textContent || '').trim().slice(0, 60),
      disabledAttribute: element.getAttribute('data-disabled'),
      menuState: element.closest('[role="menu"]')?.getAttribute('data-state') ?? null,
      layout: layout(element),
      onClick: typeof props(element)?.onClick === 'function',
      components: componentHandlers(element),
    })),
    dialogs: all(document, '[role="dialog"], [role="alertdialog"], .semi-modal-content').map(element => ({
      state: element.getAttribute('data-state'),
      title: element.querySelector('[data-slot="dialog-title"], .semi-modal-title')?.textContent?.trim().slice(0, 160) ?? null,
      buttons: all(element, 'button, [role="button"]').map(button => ({
        label: (button.textContent || button.getAttribute('aria-label') || '').trim().slice(0, 60),
        disabled: button.disabled || button.getAttribute('data-disabled') === 'true',
      })),
      layout: layout(element),
    })),
  };
  const output = JSON.stringify(result, null, 2);
  console.log('[豆包清理] 页面状态只读诊断：\n' + output);
  return output;
})();
