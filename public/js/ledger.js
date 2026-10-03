// Financial Ledger & Net Profit Reporting Controller (Phase 7)
const LedgerModule = {
  entries: [],
  summary: null,

  async init() {
    this.bindEvents();
  },

  bindEvents() {
    const navReports = document.getElementById('nav-reports');
    if (navReports) {
      navReports.addEventListener('click', (e) => {
        e.preventDefault();
        this.showReportsView();
      });
    }

    // Filter controls
    const catFilter = document.getElementById('ledger-filter-category');
    if (catFilter) {
      catFilter.addEventListener('change', () => this.loadLedgerEntries());
    }

    const typeFilter = document.getElementById('ledger-filter-type');
    if (typeFilter) {
      typeFilter.addEventListener('change', () => this.loadLedgerEntries());
    }

    // Adjustment modal form
    const adjForm = document.getElementById('traceable-adj-form');
    if (adjForm) {
      adjForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleRecordAdjustment();
      });
    }

    // Auto balance adjustment type dropdown
    const pTypeSelect = document.getElementById('adj-primary-type');
    const cTypeSelect = document.getElementById('adj-counter-type');
    if (pTypeSelect && cTypeSelect) {
      pTypeSelect.addEventListener('change', () => {
        cTypeSelect.value = pTypeSelect.value === 'DEBIT' ? 'CREDIT' : 'DEBIT';
      });
    }
  },

  hideAllPanels() {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById('admin-overview-panel')?.classList.add('hidden');
    document.getElementById('owners-management-panel')?.classList.add('hidden');
    document.getElementById('inventory-management-panel')?.classList.add('hidden');
    document.getElementById('purchases-panel')?.classList.add('hidden');
    document.getElementById('movements-panel')?.classList.add('hidden');
    document.getElementById('sales-panel')?.classList.add('hidden');
    document.getElementById('reports-panel')?.classList.add('hidden');
    document.getElementById('profit-panel')?.classList.add('hidden');
  },

  showReportsView() {
    this.hideAllPanels();
    document.getElementById('nav-reports')?.classList.add('active');
    document.getElementById('reports-panel')?.classList.remove('hidden');

    const user = API.getUser();
    const isSuperAdmin = user && user.role === 'super_admin';
    const adjBtn = document.getElementById('btn-open-traceable-adj');
    if (adjBtn) {
      adjBtn.style.display = isSuperAdmin ? 'inline-block' : 'none';
    }

    this.loadFinancialSummary();
    this.loadLedgerEntries();
  },

  async loadFinancialSummary() {
    try {
      const res = await API.getFinancialSummary();
      if (!res.success || !res.summary) return;

      const s = res.summary;
      this.summary = s;

      // Update KPI cards
      const grossRevEl = document.getElementById('rep-gross-revenue');
      const cogsEl = document.getElementById('rep-cogs');
      const grossProfitEl = document.getElementById('rep-gross-profit');
      const expensesEl = document.getElementById('rep-expenses');
      const netProfitEl = document.getElementById('rep-net-profit');
      const invValEl = document.getElementById('rep-inv-valuation');
      const trialBalanceEl = document.getElementById('rep-trial-balance');

      if (grossRevEl) grossRevEl.textContent = `Rs. ${s.grossRevenue}`;
      if (cogsEl) cogsEl.textContent = `Rs. ${s.costOfGoodsSold}`;
      if (grossProfitEl) grossProfitEl.textContent = `Rs. ${s.grossProfit}`;
      if (expensesEl) expensesEl.textContent = `Rs. ${s.totalBusinessExpenses}`;
      if (netProfitEl) netProfitEl.textContent = `Rs. ${s.netDistributableProfit}`;
      if (invValEl) invValEl.textContent = `Rs. ${s.inventoryValuation}`;

      if (trialBalanceEl) {
        if (s.trialBalance.isBalanced) {
          trialBalanceEl.innerHTML = `<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #6ee7b7;">✓ Trial Balance Balanced (Rs. ${s.trialBalance.totalDebits})</span>`;
        } else {
          trialBalanceEl.innerHTML = `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #fca5a5;">⚠ Unbalanced: Debits Rs. ${s.trialBalance.totalDebits} vs Credits Rs. ${s.trialBalance.totalCredits}</span>`;
        }
      }
    } catch (err) {
      console.error('[Financial Summary Error]', err);
    }
  },

  async loadLedgerEntries() {
    const tbody = document.getElementById('ledger-table-body');
    if (!tbody) return;

    try {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">Loading financial ledger...</td></tr>';

      const accountCategory = document.getElementById('ledger-filter-category')?.value || 'all';
      const entryType = document.getElementById('ledger-filter-type')?.value || 'all';

      const res = await API.getLedgerEntries({ accountCategory, entryType, limit: 150 });
      this.entries = res.entries || [];

      if (this.entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--text-secondary);">No ledger records found.</td></tr>';
        return;
      }

      tbody.innerHTML = this.entries.map(e => {
        let catColor = '#60a5fa'; // asset
        if (e.account_category === 'liability') catColor = '#f59e0b';
        if (e.account_category === 'equity') catColor = '#a855f7';
        if (e.account_category === 'revenue') catColor = '#10b981';
        if (e.account_category === 'expense') catColor = '#ef4444';

        const typeBadge = e.entry_type === 'DEBIT'
          ? '<span style="color: #38bdf8; font-weight: 700;">DEBIT</span>'
          : '<span style="color: #4ade80; font-weight: 700;">CREDIT</span>';

        const adjBadge = e.is_traceable_adjustment
          ? '<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; font-size: 0.7rem; margin-left: 6px;">Traceable Adjustment</span>'
          : '';

        return `
          <tr>
            <td><strong style="font-family: monospace; font-size: 0.82rem;">${e.entry_number}</strong></td>
            <td>${new Date(e.entry_date).toLocaleDateString()}</td>
            <td>
              <span class="badge" style="background: rgba(255, 255, 255, 0.08); color: ${catColor}; border: 1px solid ${catColor}40;">
                ${e.account_category.toUpperCase()}
              </span>
            </td>
            <td>${typeBadge}</td>
            <td><strong>Rs. ${e.amount}</strong></td>
            <td style="font-size: 0.85rem; color: var(--text-muted);">${e.reference_type} #${e.reference_id}</td>
            <td>
              <span style="font-size: 0.88rem;">${e.description}</span>
              ${adjBadge}
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('[Ledger Entries Error]', err);
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger-color); padding: 20px;">Error: ${err.message}</td></tr>`;
    }
  },

  openAdjustmentModal() {
    const alertBox = document.getElementById('traceable-adj-alert');
    if (alertBox) alertBox.classList.add('hidden');

    document.getElementById('adj-amount').value = '';
    document.getElementById('adj-reason').value = '';
    document.getElementById('adj-primary-cat').value = 'expense';
    document.getElementById('adj-primary-type').value = 'DEBIT';
    document.getElementById('adj-counter-cat').value = 'asset';
    document.getElementById('adj-counter-type').value = 'CREDIT';

    document.getElementById('modal-traceable-adjustment').classList.remove('hidden');
  },

  async handleRecordAdjustment() {
    const alertBox = document.getElementById('traceable-adj-alert');
    if (alertBox) alertBox.classList.add('hidden');

    try {
      const amount = document.getElementById('adj-amount').value;
      const justification = document.getElementById('adj-reason').value.trim();
      const primaryAccountCategory = document.getElementById('adj-primary-cat').value;
      const primaryEntryType = document.getElementById('adj-primary-type').value;
      const counterAccountCategory = document.getElementById('adj-counter-cat').value;
      const counterEntryType = document.getElementById('adj-counter-type').value;

      if (!justification) {
        throw new Error('A documented justification is mandatory for any traceable financial adjustment.');
      }

      const res = await API.recordTraceableAdjustment({
        primaryAccountCategory,
        primaryEntryType,
        counterAccountCategory,
        counterEntryType,
        amount,
        justification
      });

      if (!res.success) throw new Error(res.message);

      document.getElementById('modal-traceable-adjustment').classList.add('hidden');
      await this.loadFinancialSummary();
      await this.loadLedgerEntries();
    } catch (err) {
      console.error('[Record Adjustment Error]', err);
      if (alertBox) {
        alertBox.textContent = err.message;
        alertBox.classList.remove('hidden');
      }
    }
  }
};

window.LedgerModule = LedgerModule;

document.addEventListener('DOMContentLoaded', () => {
  LedgerModule.init();
});
