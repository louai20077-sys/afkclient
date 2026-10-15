const express = require('express'), crypto = require('crypto'), path = require('path');
const store = require('./store');
const { AfkBot } = require('./afkBot');

const PASS = process.env.DASHBOARD_PASSWORD;
if (!PASS) { console.error('Set the DASHBOARD_PASSWORD environment variable'); process.exit(1); }

const DEFAULTS = {
  auth: 'microsoft', server: '', version: '', proxy: '', autoStart: true, eatBelow: 14,
  stuckSeconds: 10, stuckAction: 'jump', stuckCommand: '/home',
  sellAxe: { enabled: false, command: '/ah sell axe', match: 'sell axe', confirmMatch: 'lime,emerald,confirm,green' },
};
let accounts = store.read('accounts.json', []);
let proxies = store.read('proxies.json', []);
const bots = new Map();
const save = () => store.write('accounts.json', accounts);
const merge = (base, body) => ({ ...base, ...body, sellAxe: { ...base.sellAxe, ...(body.sellAxe || {}) } });
const mk = cfg => bots.set(cfg.id, new AfkBot(cfg, () => proxies));

accounts = accounts.map(a => merge(DEFAULTS, a));
accounts.forEach(mk);

const app = express();
app.use(express.json());
app.use((req, res, next) => { // basic auth, any username, password = DASHBOARD_PASSWORD
  const h = req.headers.authorization || '';
  const given = Buffer.from(h.startsWith('Basic ') ? Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':') : '');
  const want = Buffer.from(PASS);
  if (given.length === want.length && crypto.timingSafeEqual(given, want)) return next();
  res.set('WWW-Authenticate', 'Basic realm="AFK"').status(401).send('Auth required');
});
app.use(express.static(path.join(__dirname, '..', 'public')));

const bot = (req, res) => { const b = bots.get(req.params.id); if (!b) res.status(404).send('not found'); return b; };

app.get('/api/accounts', (req, res) => res.json(accounts.map(a => ({ ...a, ...bots.get(a.id).info() }))));
app.post('/api/accounts', (req, res) => {
  const cfg = merge(DEFAULTS, { ...req.body, id: crypto.randomUUID() });
  if (!cfg.username || !cfg.server) return res.status(400).send('username and server required');
  accounts.push(cfg); mk(cfg); save(); res.json(cfg);
});
app.put('/api/accounts/:id', (req, res) => { // live-updates config; proxy/server apply on next (re)connect
  const b = bot(req, res); if (!b) return;
  const { id, ...rest } = req.body;
  Object.assign(b.cfg, merge(b.cfg, rest)); save(); res.json(b.cfg);
});
app.delete('/api/accounts/:id', (req, res) => {
  const b = bot(req, res); if (!b) return;
  b.stop(); bots.delete(b.cfg.id); accounts = accounts.filter(a => a.id !== b.cfg.id); save(); res.json({ ok: true });
});
app.post('/api/accounts/:id/start', (req, res) => { const b = bot(req, res); if (b) { b.start(); res.json({ ok: true }); } });
app.post('/api/accounts/:id/stop', (req, res) => { const b = bot(req, res); if (b) { b.stop(); res.json({ ok: true }); } });
app.post('/api/accounts/:id/restart', (req, res) => { const b = bot(req, res); if (b) { b.stop(); setTimeout(() => b.start(), 1500); res.json({ ok: true }); } });
app.get('/api/accounts/:id/inventory', (req, res) => { const b = bot(req, res); if (b) res.json(b.snapshot()); });
app.get('/api/accounts/:id/logs', (req, res) => { const b = bot(req, res); if (b) res.json(b.logs.slice(-150)); });
app.post('/api/accounts/:id/chat', (req, res) => { const b = bot(req, res); if (b) { b.chat(String(req.body.message || '').slice(0, 256)); res.json({ ok: true }); } });
app.get('/api/proxies', (req, res) => res.json(proxies));
app.put('/api/proxies', (req, res) => { proxies = (req.body.list || []).map(s => s.trim()).filter(Boolean); store.write('proxies.json', proxies); res.json(proxies); });

app.listen(process.env.PORT || 3000, () => console.log('Dashboard up'));
accounts.filter(a => a.autoStart).forEach((a, i) => setTimeout(() => bots.get(a.id)?.start(), i * 5000)); // staggered start
