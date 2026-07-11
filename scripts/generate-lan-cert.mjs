import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const certDir = join(root, 'certificates');
const publicDir = join(root, 'public');
const caKey = join(certDir, 'lan-ca-key.pem');
const caCert = join(certDir, 'lan-ca.pem');
const serverKey = join(certDir, 'lan-key.pem');
const serverCert = join(certDir, 'lan-cert.pem');
const csr = join(certDir, 'lan-cert.csr');
const config = join(certDir, 'lan-openssl.cnf');

function getLanIp() {
  const interfaces = networkInterfaces();
  const preferred = interfaces.en0 ?? [];
  const candidates = [...preferred, ...Object.values(interfaces).flatMap((items) => items ?? [])];
  const address = candidates.find((item) => item.family === 'IPv4' && !item.internal)?.address;
  if (!address) throw new Error('Не найден IPv4-адрес Wi-Fi. Подключись к сети и повтори запуск.');
  return address;
}

function openssl(args) {
  execFileSync('openssl', args, { stdio: 'inherit' });
}

const ip = process.env.LAN_IP || getLanIp();
mkdirSync(certDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

writeFileSync(
  config,
  `[req]\n` +
    `prompt = no\n` +
    `distinguished_name = ca_dn\n` +
    `x509_extensions = v3_ca\n\n` +
    `[ca_dn]\n` +
    `CN = GAME LAN Root CA\n\n` +
    `[v3_ca]\n` +
    `basicConstraints = critical, CA:TRUE, pathlen:0\n` +
    `keyUsage = critical, keyCertSign, cRLSign\n` +
    `subjectKeyIdentifier = hash\n\n` +
    `[server_cert]\n` +
    `basicConstraints = critical, CA:FALSE\n` +
    `keyUsage = critical, digitalSignature, keyEncipherment\n` +
    `extendedKeyUsage = serverAuth\n` +
    `subjectAltName = @alt_names\n\n` +
    `[alt_names]\n` +
    `DNS.1 = localhost\n` +
    `IP.1 = 127.0.0.1\n` +
    `IP.2 = ${ip}\n`,
  { mode: 0o600 },
);

if (!existsSync(caKey) || !existsSync(caCert)) {
  openssl([
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '3650',
    '-keyout', caKey, '-out', caCert, '-config', config, '-extensions', 'v3_ca',
  ]);
}

openssl([
  'req', '-new', '-newkey', 'rsa:2048', '-sha256', '-nodes',
  '-keyout', serverKey, '-out', csr, '-subj', `/CN=${ip}`,
]);
openssl([
  'x509', '-req', '-sha256', '-days', '365', '-in', csr,
  '-CA', caCert, '-CAkey', caKey, '-CAcreateserial',
  '-out', serverCert, '-extfile', config, '-extensions', 'server_cert',
]);

copyFileSync(caCert, join(publicDir, 'game-lan-ca.pem'));
openssl(['x509', '-in', caCert, '-outform', 'der', '-out', join(publicDir, 'game-lan-ca.cer')]);
rmSync(csr, { force: true });
rmSync(config, { force: true });

console.log(`\nGAME LAN certificate ready for ${ip}.`);
console.log(`Start: npm run dev:lan`);
console.log(`Open:  https://${ip}:3002/game`);
console.log(`iPhone CA profile: http://${ip}:3000/game-lan-ca.cer\n`);
