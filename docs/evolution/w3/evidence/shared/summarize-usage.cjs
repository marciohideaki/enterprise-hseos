'use strict';
// usage: node summarize-usage.cjs <campaign-dir> [--price-in <usd-per-million> --price-out <usd-per-million>]
// Sums the usage recorded in <campaign-dir>/provider-requests.jsonl by the shared fetch guard. Prices are declared by the operator.
const fs = require('node:fs');
const path = require('node:path');
const { sumUsage } = require('./usage-from-sse.cjs');
const [dir, ...rest] = process.argv.slice(2);
if (!dir) throw new Error('usage: node summarize-usage.cjs <campaign-dir> [--price-in N --price-out N]');
const option = (name) => {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : Number(rest[index + 1]);
};
const lines = fs
  .readFileSync(path.join(dir, 'provider-requests.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
process.stdout.write(
  `${JSON.stringify(sumUsage(lines, { priceInPerMillion: option('--price-in'), priceOutPerMillion: option('--price-out') }), null, 2)}\n`,
);
