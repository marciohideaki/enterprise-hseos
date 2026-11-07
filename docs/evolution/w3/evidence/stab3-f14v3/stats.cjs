'use strict';
// Exact conditional stratified test for the F14 v3 campaign (pre-registered in docs/evolution/w3/stab2/T4.md).
// Unit of analysis: the task. Within a task, the promoted successes follow a hypergeometric distribution given the margins
// (n per condition, total successes of the task). The statistic is the sum of promoted successes over tasks; its null
// distribution is the convolution of the per-task hypergeometrics. Two-sided p = sum of the probabilities <= the observed one.
// A pooled Fisher test over all runs is forbidden: it treats runs of one task as independent evidence about the rule.

const EPSILON = 1e-12;

function logChoose(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  let total = 0;
  for (let index = 1; index <= k; index += 1) total += Math.log(n - k + index) - Math.log(index);
  return total;
}

/** P(X = k) where X counts promoted successes among `promotedN` of `promotedN + controlN` runs holding `successes` successes. */
function hypergeometricPmf({ promotedN, controlN, successes }, k) {
  const total = promotedN + controlN;
  const log = logChoose(successes, k) + logChoose(total - successes, promotedN - k) - logChoose(total, promotedN);
  return Number.isFinite(log) ? Math.exp(log) : 0;
}

function stratumDistribution(stratum) {
  const { promotedN, controlN, successes } = stratum;
  const out = new Map();
  for (let k = Math.max(0, successes - controlN); k <= Math.min(promotedN, successes); k += 1) out.set(k, hypergeometricPmf(stratum, k));
  return out;
}

function convolve(left, right) {
  const out = new Map();
  for (const [a, pa] of left) for (const [b, pb] of right) out.set(a + b, (out.get(a + b) || 0) + pa * pb);
  return out;
}

function validateTask(task) {
  for (const key of ['promoted', 'control']) {
    const cell = task?.[key];
    if (
      !cell ||
      !Number.isInteger(cell.n) ||
      !Number.isInteger(cell.successes) ||
      cell.n < 1 ||
      cell.successes < 0 ||
      cell.successes > cell.n
    )
      throw new TypeError(`task ${task?.id}: invalid ${key} cell`);
  }
}

/** tasks: [{ id, promoted: { n, successes }, control: { n, successes } }]. */
function stratifiedExactTest(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) throw new TypeError('at least one task is required');
  let distribution = new Map([[0, 1]]);
  let observed = 0;
  for (const task of tasks) {
    validateTask(task);
    observed += task.promoted.successes;
    distribution = convolve(
      distribution,
      stratumDistribution({
        promotedN: task.promoted.n,
        controlN: task.control.n,
        successes: task.promoted.successes + task.control.successes,
      }),
    );
  }
  const observedProbability = distribution.get(observed) ?? 0;
  let p = 0;
  for (const probability of distribution.values()) if (probability <= observedProbability * (1 + EPSILON)) p += probability;
  return { observed_sum: observed, p: Math.min(1, p), observed_probability: observedProbability, tasks: tasks.length };
}

const THRESHOLDS = Object.freeze({ promotedMin: 4, controlMax: 1, alpha: 0.05 });

/** Pre-registered success: in EVERY task promoted >= 4 and control <= 1 (with n = 5), and the stratified p < 0.05. */
function evaluateCriterion(tasks, thresholds = THRESHOLDS) {
  const test = stratifiedExactTest(tasks);
  const per_task = tasks.map((task) => ({
    id: task.id,
    promoted: `${task.promoted.successes}/${task.promoted.n}`,
    control: `${task.control.successes}/${task.control.n}`,
    pass: task.promoted.successes >= thresholds.promotedMin && task.control.successes <= thresholds.controlMax,
  }));
  const success = per_task.every((item) => item.pass) && test.p < thresholds.alpha;
  return { success, p: test.p, observed_sum: test.observed_sum, per_task, thresholds };
}

module.exports = { hypergeometricPmf, stratifiedExactTest, evaluateCriterion, THRESHOLDS };
