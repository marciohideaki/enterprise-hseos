'use strict';
// Literal credential-shaped vectors for the campaign evidence filter. Kept under test/fixtures, which the security gate excludes.

const FLAGGED = [
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
  'sk-proj-abcdefghij-klmnopqrst_uvwxyz012345',
  'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
  'github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz',
  'xoxb-1234567890-abcdefghij',
  `AIza${'a'.repeat(35)}`,
  'password=hunter2',
  'DB_PASSWD: "s3cretvalue"',
  'secret=abcd1234',
  'aws_secret_access_key = wJalrXUtnFEMI',
  'postgres://user:pass@db.example.invalid/app',
  'AKIAABCDEFGHIJKLMNOP',
  'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  '-----BEGIN PRIVATE KEY-----',
  'api_key=abcd1234efgh',
  'apikey: "abcdefgh"',
  'token: ghx9abc123def',
  'Authorization: Basic dXNlcjpwYXNzd29yZA==',
  `npm_${'a'.repeat(36)}`,
  `sk_live_${'a'.repeat(20)}`,
  `rk_live_${'b'.repeat(20)}`,
  `glpat-${'c'.repeat(20)}`,
];
const BENIGN = [
  'const password = hash(x);',
  'const token = nextToken;',
  'password = hashedPassword',
  '"max_tokens": 2000000',
  'token: string',
  'const apiKey = options.apiKey;',
  'prefixAKIAABCDEFGHIJKLMNOPQ',
  'see https://example.invalid/docs for the secret handshake',
];

module.exports = {
  FLAGGED,
  BENIGN,
  OPENSSH_PRIVATE_KEY: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc',
  RSA_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----',
  ANTHROPIC_TOKEN_TEXT: 'token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
  PROJECT_TOKEN_TEXT: 'api token sk-proj-abcdefghij-klmnopqrst_uvwxyz012345',
};
