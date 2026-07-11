// LAN HTTPS server — lets the Game HUD open on another device (e.g. the M3) over
// the local network with a SECURE CONTEXT, so getUserMedia (mic/camera/music/
// voice-signature) works. Wraps the production Next build with a self-signed
// cert (certificates/lan-*.pem, SAN covers localhost + 127.0.0.1 + the LAN IP).
// Bound to 0.0.0.0 → reachable from the LAN; dangerous /api routes stay
// token-gated. Run after `npm run build`:  node server-lan.mjs
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import next from 'next';

const port = Number(process.env.PORT || 3002);
const host = '0.0.0.0';

const app = next({ dev: false, hostname: host, port });
const handle = app.getRequestHandler();

await app.prepare();

const options = {
  key: readFileSync('./certificates/lan-key.pem'),
  cert: readFileSync('./certificates/lan-cert.pem'),
};

createServer(options, (req, res) => handle(req, res)).listen(port, host, () => {
  console.log(`▲ LAN HTTPS ready on https://${host}:${port}  (open https://<this-mac-ip>:${port}/game)`);
});
