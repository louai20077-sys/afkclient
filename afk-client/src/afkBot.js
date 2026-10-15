const mineflayer = require('mineflayer');
const dns = require('dns').promises;
const path = require('path');
const { DATA } = require('./store');
const { makeConnect } = require('./proxy');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const BAD_FOOD = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'suspicious_stew', 'golden_apple', 'enchanted_golden_apple', 'chorus_fruit']);

// lowercase blob of an item's names/components, used for name matching
function itemText(it) {
  if (!it) return '';
  let t = `${it.displayName || ''} ${it.customName || ''}`;
  try { t += ' ' + JSON.stringify(it.components || it.nbt || ''); } catch {}
  return t.toLowerCase();
}

class AfkBot {
  constructor(cfg, getPool) {
    this.cfg = cfg; this.getPool = getPool;
    this.status = 'stopped'; this.msa = null; this.logs = [];
    this.stopped = true; this.retry = 0; this.timers = [];
    this.buying = false; this.eating = false;
  }

  log(m) { this.logs.push(`[${new Date().toLocaleTimeString()}] ${m}`); if (this.logs.length > 300) this.logs.shift(); }

  info() { const b = this.bot; return { status: this.status, msa: this.msa, health: b?.health, food: b?.food }; }

  async start() { if (!this.stopped) return; this.stopped = false; this.retry = 0; await this.connect(); }

  stop() {
    this.stopped = true; clearTimeout(this.rejoinTimer); this.cleanup();
    try { this.bot?.quit(); } catch {}
    this.status = 'stopped'; this.log('Stopped');
  }

  cleanup() { this.timers.forEach(clearInterval); this.timers = []; }

  async connect() {
    if (this.stopped) return;
    const cfg = this.cfg;
    this.status = 'connecting'; this.cleanup();
    let [host, port] = cfg.server.split(':'); port = Number(port) || 25565;
    if (!cfg.server.includes(':')) {
      try { const s = await dns.resolveSrv('_minecraft._tcp.' + host); if (s[0]) { host = s[0].name; port = s[0].port; } } catch {}
    }
    let proxy = cfg.proxy;
    if (proxy === 'pool') { const pool = this.getPool(); proxy = pool.length ? pool[Math.floor(Math.random() * pool.length)] : ''; }
    this.log(`Connecting to ${host}:${port}${proxy ? ' via proxy ' + proxy.replace(/\/\/.*@/, '//***@') : ' (direct)'}`);
    if (proxy && !cfg.version) this.log('WARNING: set a Minecraft version, otherwise version auto-detect may ping without the proxy');

    const opts = {
      host, port, username: cfg.username, version: cfg.version || false, hideErrors: true,
      auth: cfg.auth === 'offline' ? 'offline' : 'microsoft',
      profilesFolder: path.join(DATA, 'auth', cfg.id),
      onMsaCode: d => { this.msa = d; this.log(`Microsoft login: open ${d.verification_uri} and enter code ${d.user_code}`); },
    };
    const c = makeConnect(proxy, host, port); if (c) opts.connect = c;

    const bot = mineflayer.createBot(opts); this.bot = bot;
    bot.on('spawn', () => this.onSpawn());
    bot.on('messagestr', m => { if (m.trim()) this.log('chat: ' + m.slice(0, 200)); });
    bot.on('kicked', r => this.log('Kicked: ' + (typeof r === 'string' ? r : JSON.stringify(r)).slice(0, 200)));
    bot.on('error', e => this.log('Error: ' + e.message));
    bot.on('end', reason => {
      this.cleanup(); this.buying = false; this.eating = false;
      if (this.stopped) return;
      this.status = 'reconnecting';
      const delay = Math.min(5000 * 2 ** this.retry++, 120000);
      this.log(`Disconnected (${reason}). Rejoining in ${Math.round(delay / 1000)}s`);
      this.rejoinTimer = setTimeout(() => this.connect(), delay);
    });
  }

  onSpawn() {
    if (this.status === 'online') return; // respawn / world change
    this.status = 'online'; this.msa = null; this.retry = 0; this.log('Joined server');
    const every = (ms, fn) => this.timers.push(setInterval(() => fn().catch(e => this.log('Task error: ' + e.message)), ms));
    every(1500, () => this.autoEat());
    every(1000, () => this.stuckCheck());
    every(30000, () => this.sellAxeCheck());
    this.lastPos = this.bot.entity.position.clone(); this.lastMove = Date.now(); this.lastAxeTry = Date.now() - 20000;
  }

  async autoEat() {
    const b = this.bot;
    if (this.eating || this.buying || !b.entity || b.food >= this.cfg.eatBelow) return;
    const food = b.inventory.items().find(i => b.registry.foods[i.type] && !BAD_FOOD.has(i.name));
    if (!food) return;
    this.eating = true;
    try { await b.equip(food, 'hand'); await b.consume(); this.log('Ate ' + food.name); }
    catch (e) { this.log('Eat failed: ' + e.message); }
    finally { this.eating = false; }
  }

  async stuckCheck() {
    const b = this.bot, cfg = this.cfg;
    if (!b.entity || this.buying || this.eating) { this.lastMove = Date.now(); return; }
    if (b.entity.position.distanceTo(this.lastPos) > 0.2) { this.lastPos = b.entity.position.clone(); this.lastMove = Date.now(); return; }
    if (Date.now() - this.lastMove < cfg.stuckSeconds * 1000) return;
    this.lastMove = Date.now();
    if (cfg.stuckAction === 'command' && cfg.stuckCommand) { this.log('Stuck, running ' + cfg.stuckCommand); b.chat(cfg.stuckCommand); return; }
    this.log('Stuck, jumping + moving forward');
    b.setControlState('jump', true); b.setControlState('forward', true);
    await sleep(800);
    b.setControlState('jump', false); b.setControlState('forward', false);
  }

  hasAxe() { const m = this.cfg.sellAxe.match.toLowerCase(); return this.bot.inventory.items().some(i => itemText(i).includes(m)); }

  async sellAxeCheck() {
    const sa = this.cfg.sellAxe;
    if (!sa.enabled || this.buying || this.eating || !this.bot.entity) return;
    if (this.hasAxe()) return;
    if (Date.now() - this.lastAxeTry < 120000) return; // 2 min cooldown between attempts
    this.lastAxeTry = Date.now();
    await this.buyAxe();
  }

  waitWindow(ms) {
    return new Promise((res, rej) => {
      const h = w => { clearTimeout(t); res(w); };
      const t = setTimeout(() => { this.bot.off('windowOpen', h); rej(new Error('window did not open')); }, ms);
      this.bot.once('windowOpen', h);
    });
  }

  async buyAxe() {
    const b = this.bot, sa = this.cfg.sellAxe;
    this.buying = true;
    try {
      this.log('Sell axe missing, searching auction house...');
      const p = this.waitWindow(8000); b.chat(sa.command); // register listener before chatting
      const win = await p; await sleep(800);
      const m = sa.match.toLowerCase();
      const item = win.slots.slice(0, win.inventoryStart).find(i => i && itemText(i).includes(m));
      if (!item) { this.log('No sell axe listed right now'); b.closeWindow(win); return; }
      const p2 = this.waitWindow(3000).catch(() => null); // confirm GUI (if the server has one)
      await b.clickWindow(item.slot, 0, 0);
      const win2 = await p2;
      if (win2) {
        await sleep(600);
        const words = sa.confirmMatch.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        const ok = win2.slots.slice(0, win2.inventoryStart).find(i => i && words.some(w => itemText(i).includes(w)));
        if (ok) await b.clickWindow(ok.slot, 0, 0); else this.log('Confirm button not found, adjust "confirm match"');
      }
      await sleep(1000);
      if (b.currentWindow) b.closeWindow(b.currentWindow);
      this.log(this.hasAxe() ? 'Bought sell axe' : 'Purchase not confirmed (check match / confirm settings)');
    } catch (e) { this.log('Buy failed: ' + e.message); }
    finally { this.buying = false; }
  }

  chat(msg) { if (this.bot && this.status === 'online') this.bot.chat(msg); }

  snapshot() {
    const b = this.bot;
    if (!b?.inventory || this.status !== 'online') return null;
    return {
      slots: b.inventory.slots.map(it => it ? { name: it.name, display: it.displayName, count: it.count } : null),
      held: b.quickBarSlot, health: b.health, food: b.food,
      pos: b.entity ? b.entity.position.floored() : null,
    };
  }
}
module.exports = { AfkBot };
