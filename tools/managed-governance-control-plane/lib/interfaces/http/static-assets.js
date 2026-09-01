'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_ASSET_BYTES = 1024 * 1024;
const ASSETS = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/ui-schemas.json': ['ui-schemas.json', 'application/json; charset=utf-8'],
});

const SECURITY_HEADERS = Object.freeze({
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

function createStaticAssetHandler(options = {}) {
  const publicRoot = path.resolve(options.publicRoot || path.join(__dirname, '..', '..', '..', 'public'));
  return function serveStatic(request, response) {
    if (!['GET', 'HEAD'].includes(request.method)) return false;
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204, SECURITY_HEADERS);
      response.end();
      return true;
    }
    const asset = ASSETS[url.pathname];
    if (!asset) return false;
    const filePath = path.join(publicRoot, asset[0]);
    const metadata = fs.lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > MAX_ASSET_BYTES) {
      throw new Error('managed governance console asset is unsafe');
    }
    const body = fs.readFileSync(filePath);
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'cache-control': url.pathname === '/' || url.pathname === '/index.html' ? 'no-store' : 'no-cache',
      'content-length': body.length,
      'content-type': asset[1],
    });
    response.end(request.method === 'HEAD' ? undefined : body);
    return true;
  };
}

module.exports = { ASSETS, MAX_ASSET_BYTES, SECURITY_HEADERS, createStaticAssetHandler };
