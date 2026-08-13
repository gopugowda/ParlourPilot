// Minimal stub for 'react-native' used by whatsappInvoice.ts under node.
const state = { alerts: [], opened: [] };

// Simulate web environment so sendWhatsAppInvoice uses window.open path.
global.window = global.window || {};
global.window.open = (url) => { state.opened.push(url); return { closed: false }; };
Object.defineProperty(global.window, 'location', {
  configurable: true,
  value: { set href(v) { state.opened.push(v); }, get href() { return ''; } },
});

module.exports = {
  Alert: {
    alert: (title, body) => { state.alerts.push({ title, body }); },
  },
  Linking: {
    canOpenURL: async () => true,
    openURL: async (url) => { state.opened.push(url); },
  },
  Platform: { OS: 'web' },
  __alerts: state.alerts,
  __opened: state.opened,
  __reset() { state.alerts.length = 0; state.opened.length = 0; },
};
