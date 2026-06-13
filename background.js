const PLAYBACK_PAGE = 'playback/index.html';

async function executeInMainContext(tabId) {
  // Chrome MV3: scripting.executeScript with world:'MAIN'
  if (chrome.scripting && chrome.scripting.executeScript) {
    return new Promise((resolve) => {
      try {
        chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
            try {
              return (window._docs_flag_initialData &&
                      window._docs_flag_initialData.info_params &&
                      window._docs_flag_initialData.info_params.token) || '';
            } catch(e) { return ''; }
          },
        }, (results) => {
          resolve(results?.[0]?.result ?? '');
        });
      } catch(e) { resolve(''); }
    });
  }

  // Firefox MV2: tabs.executeScript runs in MAIN context by default
  if (chrome.tabs && chrome.tabs.executeScript) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.executeScript(tabId, {
          code: `(() => { try { return window._docs_flag_initialData && window._docs_flag_initialData.info_params && window._docs_flag_initialData.info_params.token || '' } catch(e) { return '' } })()`,
          runAt: 'document_end',
        }, (results) => {
          resolve(results?.[0] ?? '');
        });
      } catch(e) { resolve(''); }
    });
  }

  return '';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'get-token') {
    executeInMainContext(sender.tab.id)
      .then(token => sendResponse({ token: token || '' }))
      .catch(() => sendResponse({ token: '' }));
    return true;
  }

  if (message.action === 'open-playback') {
    chrome.tabs.create({
      url: chrome.runtime.getURL(`${PLAYBACK_PAGE}?session=${message.sessionKey}`)
    });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
