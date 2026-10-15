// Proxy format: socks5://user:pass@host:port | socks4://host:port | http://user:pass@host:port
const { SocksClient } = require('socks');
const net = require('net');

function parseProxy(str) {
  if (!str) return null;
  const u = new URL(str.includes('://') ? str : 'socks5://' + str);
  return {
    type: u.protocol.replace(':', ''), host: u.hostname, port: Number(u.port),
    user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password),
  };
}

// Returns a mineflayer `connect` function that tunnels through the proxy
function makeConnect(proxyStr, host, port) {
  const p = parseProxy(proxyStr);
  if (!p) return undefined;
  return client => {
    const done = socket => { client.setSocket(socket); client.emit('connect'); };
    const fail = e => client.emit('error', e);
    if (p.type.startsWith('socks')) {
      SocksClient.createConnection({
        proxy: { host: p.host, port: p.port, type: p.type === 'socks4' ? 4 : 5, userId: p.user || undefined, password: p.pass || undefined },
        command: 'connect', destination: { host, port },
      }).then(i => done(i.socket)).catch(fail);
    } else {
      const s = net.connect(p.port, p.host);
      s.once('error', fail);
      s.once('connect', () => {
        const auth = p.user ? `Proxy-Authorization: Basic ${Buffer.from(p.user + ':' + p.pass).toString('base64')}\r\n` : '';
        s.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`);
        let buf = '';
        const onData = d => {
          buf += d.toString('latin1');
          if (!buf.includes('\r\n\r\n')) return;
          s.off('data', onData);
          if (/^HTTP\/1\.[01] 200/.test(buf)) done(s);
          else { s.destroy(); fail(new Error('Proxy refused: ' + buf.split('\r\n')[0])); }
        };
        s.on('data', onData);
      });
    }
  };
}
module.exports = { makeConnect };
