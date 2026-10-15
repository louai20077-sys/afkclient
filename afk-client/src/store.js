const fs = require('fs'), path = require('path');
const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA, { recursive: true });
const file = n => path.join(DATA, n);
const read = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
const write = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v, null, 2));
module.exports = { DATA, read, write };
