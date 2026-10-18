/* 在报错的豆包页面 Console 粘贴本文件全部内容；只读取状态，不点击、不删除。 */
(() => {
  'use strict';
  const failure = window.doubaoCleaner?.status?.failedCheckbox;
  const id = failure?.id || '56649943652989954';
  const rows = '[data-testid="send_message"], [data-testid="receive_message"]';
  const area = document.querySelector('[data-container-name="conversation-message-area"]');
  const readProps = element => {
    const key = Object.keys(element).find(name => name.startsWith('__reactProps$') || name.startsWith('__reactEventHandlers$'));
    return key ? element[key] : null;
  };
  const events = props => Object.fromEntries([
    'onClick', 'onClickCapture', 'onChange', 'onPointerDown', 'onPointerDownCapture', 'onMouseDown', 'onKeyDown',
  ].map(name => [name, typeof props?.[name] === 'function']));
  const inspect = input => {
    const wrapper = input.closest('.semi-checkbox') || input;
    const bounds = wrapper.getBoundingClientRect();
    const style = getComputedStyle(wrapper);
    const fiberKey = Object.keys(wrapper).find(name => name.startsWith('__reactFiber$'));
    const components = [];
    let fiber = fiberKey ? wrapper[fiberKey] : null;
    for (let index = 0; fiber && index < 14; index++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      const type = fiber.type;
      if (type && typeof type !== 'string') {
        components.push({
          name: type.displayName || type.name || type.render?.displayName || type.render?.name || 'anonymous',
          checked: typeof props?.checked === 'boolean' ? props.checked : null,
          disabled: typeof props?.disabled === 'boolean' ? props.disabled : null,
          onChange: typeof props?.onChange === 'function',
          events: events(props),
        });
      }
    }
    const ancestors = [];
    for (let current = wrapper, index = 0; current && index < 7; index++, current = current.parentElement) {
      const currentStyle = getComputedStyle(current);
      ancestors.push({
        tag: current.tagName,
        testid: current.dataset.testid || null,
        ariaHidden: current.getAttribute('aria-hidden'),
        pointerEvents: currentStyle.pointerEvents,
        display: currentStyle.display,
        visibility: currentStyle.visibility,
        events: events(readProps(current)),
      });
    }
    return {
      connected: input.isConnected,
      nativeChecked: input.checked,
      ariaChecked: input.getAttribute('aria-checked'),
      disabled: input.disabled,
      ariaDisabled: input.getAttribute('aria-disabled'),
      wrapperClass: wrapper.className,
      pointerEvents: style.pointerEvents,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      inViewport: bounds.bottom > 0 && bounds.top < innerHeight && bounds.right > 0 && bounds.left < innerWidth,
      inputEvents: events(readProps(input)),
      wrapperEvents: events(readProps(wrapper)),
      ancestors,
      components,
    };
  };
  const inputs = area ? Array.from(area.querySelectorAll('[data-attr="select-mode"] input[type="checkbox"]')) : [];
  const targets = inputs.filter(input => input.closest(rows)?.querySelector('[data-testid="message_content"][data-message-id]')?.dataset.messageId === id);
  const result = {
    id, failure: failure || null,
    totalCheckboxes: inputs.length,
    selectedCheckboxes: inputs.filter(input => input.getAttribute('aria-checked') === 'true' || input.checked).length,
    sameIdCount: targets.length,
    modalOpen: !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]'),
    scrollTop: area?.querySelector('[data-testid="message-list"] .scroller')?.scrollTop ?? null,
    targets: targets.map(inspect),
  };
  const output = JSON.stringify(result, null, 2);
  console.log('[豆包清理] 只读诊断（请复制下面完整文本）：\n' + output);
  return output;
})();
