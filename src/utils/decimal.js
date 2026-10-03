const Decimal = require('decimal.js');

// Configure Decimal.js for financial arithmetic: 20 digits precision, HALF_UP rounding
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

function toDecimal(val) {
  if (val === null || val === undefined || val === '') return new Decimal(0);
  return new Decimal(val);
}

function formatCurrency(val) {
  const d = toDecimal(val);
  return d.toFixed(2);
}

function add(a, b) {
  return toDecimal(a).plus(toDecimal(b)).toFixed(2);
}

function subtract(a, b) {
  return toDecimal(a).minus(toDecimal(b)).toFixed(2);
}

function multiply(a, b) {
  return toDecimal(a).times(toDecimal(b)).toFixed(2);
}

function divide(a, b) {
  const denom = toDecimal(b);
  if (denom.isZero()) throw new Error('Division by zero in financial arithmetic');
  return toDecimal(a).dividedBy(denom).toFixed(2);
}

function percentageOf(amount, percentage) {
  return toDecimal(amount).times(toDecimal(percentage)).dividedBy(100).toFixed(2);
}

module.exports = {
  Decimal,
  toDecimal,
  formatCurrency,
  add,
  subtract,
  multiply,
  divide,
  percentageOf
};
