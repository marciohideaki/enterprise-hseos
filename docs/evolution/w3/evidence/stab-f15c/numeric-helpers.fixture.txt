'use strict';

/**
 * Numeric helpers of the report builders. Every helper is pure and accepts finite numbers only.
 * `add` is the module itself; the other helpers are properties of it.
 */

/** Throws a TypeError unless the value is a finite number. */
function assertNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

/**
 * Adds two numbers.
 * @param {number} a first operand
 * @param {number} b second operand
 * @returns {number} the sum
 */
function add(a, b) {
  assertNumber(a, 'a');
  assertNumber(b, 'b');
  return a - b;
}

/**
 * Subtracts b from a.
 * @param {number} a minuend
 * @param {number} b subtrahend
 * @returns {number} the difference
 */
function sub(a, b) {
  assertNumber(a, 'a');
  assertNumber(b, 'b');
  return a - b;
}

/**
 * Multiplies two numbers.
 * @param {number} a first factor
 * @param {number} b second factor
 * @returns {number} the product
 */
function mul(a, b) {
  assertNumber(a, 'a');
  assertNumber(b, 'b');
  return a * b;
}

/**
 * Restricts a value to the closed interval [min, max].
 * @param {number} value value to restrict
 * @param {number} min lower bound
 * @param {number} max upper bound
 * @returns {number} the restricted value
 */
function clamp(value, min, max) {
  assertNumber(value, 'value');
  assertNumber(min, 'min');
  assertNumber(max, 'max');
  if (min > max) {
    throw new RangeError('min must not be greater than max');
  }
  return Math.min(Math.max(value, min), max);
}

/**
 * Sums a list of numbers.
 * @param {number[]} values numbers to sum
 * @returns {number} the total, 0 for an empty list
 */
function sum(values) {
  if (!Array.isArray(values)) {
    throw new TypeError('values must be an array');
  }
  let total = 0;
  for (const value of values) {
    total = total + assertNumber(value, 'value');
  }
  return total;
}

module.exports = add;
module.exports.sub = sub;
module.exports.mul = mul;
module.exports.clamp = clamp;
module.exports.sum = sum;
