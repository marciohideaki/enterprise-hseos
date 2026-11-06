'use strict';
// Reads the token usage, the finish reason and the responding model from an OpenAI-compatible SSE body.
// It parses each `data:` frame as JSON instead of matching braces with a regular expression, which broke on the nested
// `*_tokens_details` objects of real responses and left `usage` as "unreadable" in every campaign log until now.

function frames(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;
    try {
      out.push(JSON.parse(payload));
    } catch {
      out.push({ __unparsed: true });
    }
  }
  return out;
}

const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

/** Last non-null `usage` of the stream (providers send it once, in the final frame, or null in the earlier ones). */
function parseSse(text) {
  const parsed = frames(text);
  let usage = null;
  let finish = null;
  let model = null;
  for (const frame of parsed) {
    if (frame && typeof frame.usage === 'object' && frame.usage !== null) usage = frame.usage;
    const reason = frame?.choices?.at?.(-1)?.finish_reason;
    if (typeof reason === 'string') finish = reason;
    if (typeof frame?.model === 'string') model = frame.model;
  }
  return {
    usage: usage
      ? {
          prompt_tokens: count(usage.prompt_tokens),
          completion_tokens: count(usage.completion_tokens),
          total_tokens: count(usage.total_tokens),
          cached_tokens: count(usage.prompt_tokens_details?.cached_tokens),
        }
      : null,
    finish,
    model,
    unparsed_frames: parsed.filter((frame) => frame && frame.__unparsed).length,
  };
}

/** Sums the usage of many requests. A request without readable usage is counted, never treated as zero. */
function sumUsage(entries, { priceInPerMillion, priceOutPerMillion } = {}) {
  const total = { requests: 0, unreadable_requests: 0, prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 };
  for (const entry of entries) {
    total.requests += 1;
    const usage = entry?.usage;
    if (!usage || usage.prompt_tokens === null || usage.completion_tokens === null) {
      total.unreadable_requests += 1;
      continue;
    }
    total.prompt_tokens += usage.prompt_tokens;
    total.completion_tokens += usage.completion_tokens;
    total.cached_tokens += usage.cached_tokens ?? 0;
  }
  const priced = Number.isFinite(priceInPerMillion) && Number.isFinite(priceOutPerMillion);
  return {
    ...total,
    complete: total.unreadable_requests === 0,
    estimated_cost_usd: priced
      ? (total.prompt_tokens * priceInPerMillion + total.completion_tokens * priceOutPerMillion) / 1_000_000
      : null,
    note: priced
      ? 'Price declared by the operator and not verified; cached tokens are charged at the input price; this is an estimate, not an invoice.'
      : 'No price declared: tokens only.',
  };
}

module.exports = { parseSse, sumUsage };
