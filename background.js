// DialFlow service worker
async function openDash() {
  const url = chrome.runtime.getURL('dashboard.html');
  const tabs = await chrome.tabs.query({ url });
  if (tabs[0]) { await chrome.tabs.update(tabs[0].id, { active: true }); await chrome.windows.update(tabs[0].windowId, { focused: true }); }
  else chrome.tabs.create({ url });
}
chrome.action.onClicked.addListener(openDash);
chrome.runtime.onMessage.addListener((m, sender) => {
  if (m.type === 'open-dashboard') openDash();
  if (m.type === 'open-side' && sender.tab) chrome.sidePanel.open({ tabId: sender.tab.id }).catch(openDash);
});

// Ticker: messages are not throttled in hidden tabs the way timers are
const ports = new Set(); let timer = null;
chrome.runtime.onConnect.addListener(p => {
  if (p.name !== 'tick') return;
  ports.add(p); p.onMessage.addListener(() => {});
  p.onDisconnect.addListener(() => { ports.delete(p); if (!ports.size && timer) { clearInterval(timer); timer = null; } });
  if (!timer) timer = setInterval(() => ports.forEach(x => { try { x.postMessage('t'); } catch (e) {} }), 500);
});

// Automatic backups every 30 minutes (keeps the 5 most recent)
chrome.alarms.create('snap', { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== 'snap') return;
  const all = await chrome.storage.local.get(null);
  if (!all.leads || !all.leads.length) return;
  const skip = ['hb', 'msg', 'diag', 'phase', 'owner', 'backups', 'voiceLast', 'answerStat'];
  const data = {}; for (const k of Object.keys(all)) if (!skip.includes(k)) data[k] = all[k];
  const backups = (all.backups || []); backups.push({ ts: Date.now(), leads: all.leads.length, data });
  while (backups.length > 5) backups.shift();
  await chrome.storage.local.set({ backups });
});
