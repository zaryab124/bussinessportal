const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../src/server');
const { query } = require('../src/config/db');

let server;
let baseUrl;
let adminToken;
let owner1Token;
let owner2Token;
let owner1Id;
let owner2Id;

test.before(async () => {
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Admin login
  const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@business.local', password: 'Admin@123456' })
  });
  const adminData = await adminRes.json();
  adminToken = adminData.token;

  // Owner 1 login
  const owner1Res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner1@business.local', password: 'Owner1@123456' })
  });
  const owner1Data = await owner1Res.json();
  owner1Token = owner1Data.token;
  owner1Id = owner1Data.user.id;

  // Owner 2 login
  const owner2Res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner2@business.local', password: 'Owner2@123456' })
  });
  const owner2Data = await owner2Res.json();
  owner2Token = owner2Data.token;
  owner2Id = owner2Data.user.id;
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test('1. Operating Expenses: Admin can record an operating expense and double-entry ledger lines are posted', async () => {
  const expensePayload = {
    category: 'packaging',
    amount: '450.00',
    expense_date: '2026-10-04',
    description: 'Custom logo protective bubble wrap boxes'
  };

  const res = await fetch(`${baseUrl}/api/expenses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify(expensePayload)
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.expense.id);
  assert.equal(data.expense.category, 'packaging');
  assert.equal(data.expense.amount, '450.00');

  // Verify financial_ledger balanced entries: DEBIT expense & CREDIT asset
  const ledgerRes = await query(`
    SELECT * FROM financial_ledger
    WHERE reference_type = 'expense' AND reference_id = $1
    ORDER BY id ASC
  `, [data.expense.id]);

  assert.equal(ledgerRes.rows.length, 2);
  const debitLine = ledgerRes.rows.find(l => l.entry_type === 'DEBIT');
  const creditLine = ledgerRes.rows.find(l => l.entry_type === 'CREDIT');

  assert.ok(debitLine);
  assert.equal(debitLine.account_category, 'expense');
  assert.equal(debitLine.amount, '450.00');

  assert.ok(creditLine);
  assert.equal(creditLine.account_category, 'asset');
  assert.equal(creditLine.amount, '450.00');
});

test('2. RBAC & Validation: Expense validation and Owner cannot record expenses', async () => {
  // Invalid payload (negative amount)
  const invalidRes = await fetch(`${baseUrl}/api/expenses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ category: 'utilities', amount: '-50.00' })
  });
  assert.equal(invalidRes.status, 400);

  // Business owner attempt to create expense must be 403 Forbidden
  const ownerCreateRes = await fetch(`${baseUrl}/api/expenses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${owner1Token}`
    },
    body: JSON.stringify({ category: 'utilities', amount: '100.00' })
  });
  assert.equal(ownerCreateRes.status, 403);

  // Business owner CAN view expenses (transparency of operating deductions)
  const ownerGetRes = await fetch(`${baseUrl}/api/expenses`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });
  assert.equal(ownerGetRes.status, 200);
  const ownerGetData = await ownerGetRes.json();
  assert.equal(ownerGetData.success, true);
  assert.ok(Array.isArray(ownerGetData.expenses));
});

test('3. Traceable Expense Reversal: Admin can reverse expense with audit justification', async () => {
  // Create an expense to reverse
  const createRes = await fetch(`${baseUrl}/api/expenses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ category: 'office', amount: '120.00', description: 'Accidental duplicate entry' })
  });
  const createData = await createRes.json();
  const expId = createData.expense.id;

  // Reversal without reason must fail
  const failRes = await fetch(`${baseUrl}/api/expenses/${expId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ reason: '' })
  });
  assert.equal(failRes.status, 400);

  // Reversal with valid reason
  const reverseRes = await fetch(`${baseUrl}/api/expenses/${expId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ reason: 'Duplicate vendor receipt confirmed with accounts department' })
  });
  assert.equal(reverseRes.status, 200);
  const reverseData = await reverseRes.json();
  assert.equal(reverseData.success, true);

  // Verify reversing ledger entries exist with is_traceable_adjustment = true
  const revLedgerRes = await query(`
    SELECT * FROM financial_ledger
    WHERE reference_type = 'expense_cancellation' AND reference_id = $1
  `, [expId]);

  assert.equal(revLedgerRes.rows.length, 2);
  const debitAsset = revLedgerRes.rows.find(l => l.entry_type === 'DEBIT');
  const creditExpense = revLedgerRes.rows.find(l => l.entry_type === 'CREDIT');

  assert.ok(debitAsset);
  assert.equal(debitAsset.account_category, 'asset');
  assert.equal(debitAsset.is_traceable_adjustment, true);

  assert.ok(creditExpense);
  assert.equal(creditExpense.account_category, 'expense');
  assert.equal(creditExpense.is_traceable_adjustment, true);
});

test('4. Owner Profit Settlement: Admin records payout, validates payable limit, posts distribution ledger', async () => {
  // Seed a profit allocation to ensure Owner 1 has an allocated balance
  await query(`
    INSERT INTO profit_allocations (
      period_month, owner_id, allocated_amount, allocation_type, status
    ) VALUES ($1, $2, $3, $4, $5)
  `, ['2026-10', owner1Id, '1500.00', 'owner_share', 'allocated']);

  // Check balances endpoint
  const balRes = await fetch(`${baseUrl}/api/settlements/balances`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(balRes.status, 200);
  const balData = await balRes.json();
  const owner1Bal = balData.balances.find(b => b.ownerId === owner1Id);
  assert.ok(owner1Bal);

  // Attempt to payout more than outstanding payable balance without override should be rejected
  const excessiveRes = await fetch(`${baseUrl}/api/settlements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      owner_id: owner1Id,
      amount: '999999.00',
      settlement_date: '2026-10-04',
      payment_method: 'Bank Transfer'
    })
  });
  assert.equal(excessiveRes.status, 400);

  // Record valid payout of Rs. 500.00
  const settleRes = await fetch(`${baseUrl}/api/settlements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      owner_id: owner1Id,
      amount: '500.00',
      settlement_date: '2026-10-04',
      payment_method: 'Bank Transfer',
      reference_note: 'Q3 Partial Distribution IMPS #88721'
    })
  });

  assert.equal(settleRes.status, 201);
  const settleData = await settleRes.json();
  assert.equal(settleData.success, true);
  assert.ok(settleData.settlement.id);

  // Verify double-entry ledger lines: DEBIT distribution, CREDIT asset
  const ledgerRes = await query(`
    SELECT * FROM financial_ledger
    WHERE reference_type = 'settlement' AND reference_id = $1
    ORDER BY id ASC
  `, [settleData.settlement.id]);

  assert.equal(ledgerRes.rows.length, 2);
  const debitDist = ledgerRes.rows.find(l => l.entry_type === 'DEBIT');
  const creditAsset = ledgerRes.rows.find(l => l.entry_type === 'CREDIT');

  assert.ok(debitDist);
  assert.equal(debitDist.account_category, 'distribution');
  assert.equal(debitDist.amount, '500.00');

  assert.ok(creditAsset);
  assert.equal(creditAsset.account_category, 'asset');
  assert.equal(creditAsset.amount, '500.00');
});

test('5. Settlements: Override authorized for advance payout exceeding outstanding balance', async () => {
  const advanceRes = await fetch(`${baseUrl}/api/settlements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      owner_id: owner2Id,
      amount: '3000.00',
      settlement_date: '2026-10-04',
      payment_method: 'Bank Transfer',
      reference_note: 'Approved partnership advance draw',
      force_override: true,
      override_reason: 'Approved by board resolution #2026-08 as emergency partner draw against future profits'
    })
  });

  assert.equal(advanceRes.status, 201);
  const advanceData = await advanceRes.json();
  assert.equal(advanceData.success, true);
  assert.equal(advanceData.settlement.amount, '3000.00');
});

test('6. Strict Horizontal Isolation: Owner 1 and Owner 2 cannot view each others settlements', async () => {
  // Owner 1 settlement query
  const res1 = await fetch(`${baseUrl}/api/settlements`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  // Ensure NO records belonging to owner 2 are returned
  const hasOwner2 = data1.settlements.some(s => s.owner_id === owner2Id);
  assert.equal(hasOwner2, false, 'Owner 1 must never receive Owner 2 settlements');

  // Owner 2 settlement query
  const res2 = await fetch(`${baseUrl}/api/settlements`, {
    headers: { 'Authorization': `Bearer ${owner2Token}` }
  });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  // Ensure NO records belonging to owner 1 are returned
  const hasOwner1 = data2.settlements.some(s => s.owner_id === owner1Id);
  assert.equal(hasOwner1, false, 'Owner 2 must never receive Owner 1 settlements');

  // Owner cannot record settlements
  const unauthPost = await fetch(`${baseUrl}/api/settlements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${owner1Token}`
    },
    body: JSON.stringify({ owner_id: owner1Id, amount: '100.00', payment_method: 'Cash' })
  });
  assert.equal(unauthPost.status, 403);
});

test('7. Owner Capital Investments: Admin records capital contribution, posts Equity ledger', async () => {
  const investPayload = {
    owner_id: owner1Id,
    amount: '50000.00',
    investment_date: '2026-10-04',
    investment_type: 'additional',
    notes: 'Secondary capital injection for inventory expansion'
  };

  const res = await fetch(`${baseUrl}/api/investments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify(investPayload)
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.investment.id);
  assert.equal(data.investment.amount, '50000.00');

  // Verify double-entry ledger lines: DEBIT asset (Cash) & CREDIT equity (Capital)
  const ledgerRes = await query(`
    SELECT * FROM financial_ledger
    WHERE reference_type = 'investment' AND reference_id = $1
    ORDER BY id ASC
  `, [data.investment.id]);

  assert.equal(ledgerRes.rows.length, 2);
  const debitAsset = ledgerRes.rows.find(l => l.entry_type === 'DEBIT');
  const creditEquity = ledgerRes.rows.find(l => l.entry_type === 'CREDIT');

  assert.ok(debitAsset);
  assert.equal(debitAsset.account_category, 'asset');
  assert.equal(debitAsset.amount, '50000.00');

  assert.ok(creditEquity);
  assert.equal(creditEquity.account_category, 'equity');
  assert.equal(creditEquity.amount, '50000.00');

  // Strict isolation test for investments
  const owner2InvestRes = await fetch(`${baseUrl}/api/investments`, {
    headers: { 'Authorization': `Bearer ${owner2Token}` }
  });
  const owner2InvestData = await owner2InvestRes.json();
  const containsOwner1 = owner2InvestData.investments.some(inv => inv.owner_id === owner1Id);
  assert.equal(containsOwner1, false, 'Owner 2 must not see Owner 1 investments');
});

test('8. Immutable Audit Logs: Super Admin inspection and RBAC restriction for owners', async () => {
  // Super admin can inspect audit logs
  const adminRes = await fetch(`${baseUrl}/api/audit-logs`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(adminRes.status, 200);
  const adminData = await adminRes.json();
  assert.equal(adminData.success, true);
  assert.ok(adminData.totalCount > 0);
  assert.ok(Array.isArray(adminData.logs));

  // Verify summary endpoint
  const summaryRes = await fetch(`${baseUrl}/api/audit-logs/summary`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(summaryRes.status, 200);
  const summaryData = await summaryRes.json();
  assert.equal(summaryData.success, true);
  assert.ok(summaryData.topActions);

  // Business owner must be rejected with 403 Forbidden
  const ownerRes = await fetch(`${baseUrl}/api/audit-logs`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });
  assert.equal(ownerRes.status, 403);
});
