window.KuroBus = (function () {
  const isNative = !!(window.chrome && window.chrome.webview);
  const listeners = [];

  if (isNative) {
    window.chrome.webview.addEventListener('message', (ev) => {
      try {
        const msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        if (!msg) return;
        for (let i = 0; i < listeners.length; i++) listeners[i](msg);
      } catch (e) {
        console.error('Bus parse error:', e);
      }
    });
  }

  return {
    isNative,
    send(payload) {
      if (isNative) {
        window.chrome.webview.postMessage(JSON.stringify(payload));
      }
    },
    onMessage(fn) {
      listeners.push(fn);
    },
    emitLocal(msg) {
      for (let i = 0; i < listeners.length; i++) listeners[i](msg);
    },
  };
})();
