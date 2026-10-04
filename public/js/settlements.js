/**
 * Settlements & Capital Investments Frontend Module (Phase 10)
 */
const SettlementsModule = {
  activeTab: 'balances', // 'balances', 'settlements', 'investments'

  init() {
    const navSettlements = document.getElementById('nav-settlements');
    if (navSettlements) {
      navSettlements.addEventListener('click', (e) => {
        e.preventDefault();
        this.showSettlementsView();
      });
    }

    const formSettlement = document.getElementById('create-settlement-form');
    if (formSettlement) {
      formSettlement.addEventListener('submit', (e) => this.handleCreateSettlement(e));
    }

    const formInvestment = document.getElementById('create-investment-form');
    if (formInvestment) {
      formInvestment.addEventListener('submit', (e) => this.handleCreateInvestment(e));
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
    document.getElementById('expenses-panel')?.classList.add('hidden');
    document.getElementById('settlements-panel')?.classList.add('hidden');
    document.getElementById('audit-panel')?.classList.add('hidden');
    document.getElementById('owner-view')?.classList.add('hidden');
  },

  showSettlementsView() {
    this.hideAllPanels();
    document.getElementById('nav-settlements')?.classList.add('active');
    document.getElementById('settlements-panel')?.classList.remove('hidden');

    const user = API.getUser();
    const isSuperAdmin = user && (user.role === 'super_admin' || user.role === 'business_admin');
    const adminActions = document.getElementById('settlement-admin-actions');
    if (adminActions) {
      adminActions.style.display = isSuperAdmin ? 'flex' : 'none';
    }

    this.loadOwnerBalances();
    this.loadSettlements();
    this.loadInvestments();
  },

  async loadOwnerBalances() {
    const tableBody = document.getElementById('settlement-balances-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px;">Calculating partner financial balances...</td></tr>`;

    try {
      const res = await API.getOwnerBalances();
      const balances = res.balances || [];

      let totalAllocatedSum = 0;
      let totalSettledSum = 0;
      let totalOutstandingSum = 0;
      let totalInvestedSum = 0;

      balances.forEach(b => {
        totalAllocatedSum += parseFloat(b.totalAllocated.replace(/,/g, '')) || 0;
        totalSettledSum += parseFloat(b.totalSettled.replace(/,/g, '')) || 0;
        totalOutstandingSum += parseFloat(b.outstandingPayable.replace(/,/g, '')) || 0;
        totalInvestedSum += parseFloat(b.totalInvested.replace(/,/g, '')) || 0;
      });

      // Update KPI widgets
      const kpiAllocated = document.getElementById('settle-kpi-allocated');
      if (kpiAllocated) kpiAllocated.textContent = `Rs. ${totalAllocatedSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

      const kpiSettled = document.getElementById('settle-kpi-settled');
      if (kpiSettled) kpiSettled.textContent = `Rs. ${totalSettledSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

      const kpiOutstanding = document.getElementById('settle-kpi-outstanding');
      if (kpiOutstanding) kpiOutstanding.textContent = `Rs. ${totalOutstandingSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

      const kpiInvested = document.getElementById('settle-kpi-invested');
      if (kpiInvested) kpiInvested.textContent = `Rs. ${totalInvestedSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

      if (balances.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--text-secondary);">No partner accounts found.</td></tr>`;
        return;
      }

      const user = API.getUser();
      const isSuperAdmin = user && (user.role === 'super_admin' || user.role === 'business_admin');

      tableBody.innerHTML = balances.map(b => `
        <tr>
          <td>
            <strong>${b.name}</strong><br>
            <small style="color: var(--text-muted);">${b.email}</small>
          </td>
          <td style="font-weight: 600; color: #60a5fa;">Rs. ${b.totalInvested}</td>
          <td style="font-weight: 600; color: #a78bfa;">Rs. ${b.totalAllocated}</td>
          <td style="font-weight: 600; color: var(--text-secondary);">Rs. ${b.totalSettled}</td>
          <td style="font-weight: 700; color: #10b981; font-size: 1.05rem;">Rs. ${b.outstandingPayable}</td>
          <td>
            ${isSuperAdmin ? `
              <button class="btn btn-primary btn-sm" onclick="SettlementsModule.openPayoutModal(${b.ownerId}, '${b.name}', '${b.outstandingPayable}')">
                Pay Out
              </button>
            ` : '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #6ee7b7;">Your Account</span>'}
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('[SettlementsModule] Load balances error:', err);
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: #ef4444;">Failed to load balances: ${err.message}</td></tr>`;
    }
  },

  async loadSettlements() {
    const tableBody = document.getElementById('settlements-history-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px;">Loading payout settlements...</td></tr>`;

    try {
      const res = await API.getSettlements();
      const settlements = res.settlements || [];

      if (settlements.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-secondary);">No profit payout settlements recorded yet.</td></tr>`;
        return;
      }

      tableBody.innerHTML = settlements.map(s => `
        <tr>
          <td><strong>${s.settlement_code}</strong></td>
          <td><strong>${s.owner_name}</strong></td>
          <td style="font-weight: 700; color: #10b981;">Rs. ${s.amount}</td>
          <td>${new Date(s.settlement_date).toLocaleDateString()}</td>
          <td><span class="badge" style="background: rgba(255,255,255,0.08);">${s.payment_method}</span></td>
          <td style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${s.reference_note || ''}">
            ${s.reference_note || '<span style="color: var(--text-muted);">-</span>'}
          </td>
          <td><small>${s.recorded_by_name || 'Admin'}</small></td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('[SettlementsModule] Load settlements error:', err);
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: #ef4444;">Failed to load settlements: ${err.message}</td></tr>`;
    }
  },

  async loadInvestments() {
    const tableBody = document.getElementById('investments-history-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px;">Loading capital contributions...</td></tr>`;

    try {
      const res = await API.getInvestments();
      const investments = res.investments || [];

      if (investments.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--text-secondary);">No capital investments recorded yet.</td></tr>`;
        return;
      }

      tableBody.innerHTML = investments.map(inv => `
        <tr>
          <td><strong>${inv.owner_name}</strong></td>
          <td style="font-weight: 700; color: #60a5fa;">Rs. ${inv.amount}</td>
          <td>${new Date(inv.investment_date).toLocaleDateString()}</td>
          <td><span class="badge" style="background: rgba(96, 165, 250, 0.15); color: #93c5fd; text-transform: capitalize;">${inv.investment_type}</span></td>
          <td style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${inv.notes || ''}">
            ${inv.notes || '<span style="color: var(--text-muted);">-</span>'}
          </td>
          <td><small>${inv.recorded_by_name || 'Admin'}</small></td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('[SettlementsModule] Load investments error:', err);
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: #ef4444;">Failed to load investments: ${err.message}</td></tr>`;
    }
  },

  async populateOwnerSelect(selectElementId, defaultOwnerId = null) {
    const select = document.getElementById(selectElementId);
    if (!select) return;

    try {
      const res = await API.getOwners();
      const owners = res.owners || [];
      select.innerHTML = owners.map(o => `
        <option value="${o.id}" ${defaultOwnerId && o.id == defaultOwnerId ? 'selected' : ''}>
          ${o.name} (${o.email})
        </option>
      `).join('');
    } catch (err) {
      console.error('[SettlementsModule] Failed to populate owners select:', err);
    }
  },

  openPayoutModal(ownerId = null, ownerName = '', outstanding = '0.00') {
    const modal = document.getElementById('modal-create-settlement');
    if (!modal) return;
    document.getElementById('create-settlement-alert')?.classList.add('hidden');
    this.populateOwnerSelect('settle-owner-select', ownerId);
    document.getElementById('settle-amount-input').value = outstanding ? outstanding.replace(/,/g, '') : '';
    document.getElementById('settle-date-input').value = new Date().toISOString().slice(0, 10);
    document.getElementById('settle-method-input').value = 'Bank Transfer';
    document.getElementById('settle-note-input').value = '';
    document.getElementById('settle-override-checkbox').checked = false;
    document.getElementById('settle-override-group').classList.add('hidden');
    document.getElementById('settle-override-reason').value = '';
    modal.classList.remove('hidden');
  },

  toggleOverrideGroup() {
    const isChecked = document.getElementById('settle-override-checkbox').checked;
    const group = document.getElementById('settle-override-group');
    if (group) {
      if (isChecked) group.classList.remove('hidden');
      else group.classList.add('hidden');
    }
  },

  async handleCreateSettlement(e) {
    e.preventDefault();
    const alertEl = document.getElementById('create-settlement-alert');
    alertEl?.classList.add('hidden');

    const owner_id = document.getElementById('settle-owner-select').value;
    const amount = document.getElementById('settle-amount-input').value;
    const settlement_date = document.getElementById('settle-date-input').value;
    const payment_method = document.getElementById('settle-method-input').value;
    const reference_note = document.getElementById('settle-note-input').value;
    const force_override = document.getElementById('settle-override-checkbox').checked;
    const override_reason = document.getElementById('settle-override-reason').value;

    try {
      const res = await API.createSettlement({
        owner_id: parseInt(owner_id, 10),
        amount,
        settlement_date,
        payment_method,
        reference_note,
        force_override,
        override_reason
      });

      if (res.success) {
        document.getElementById('modal-create-settlement')?.classList.add('hidden');
        this.loadOwnerBalances();
        this.loadSettlements();
      } else {
        alertEl.textContent = res.error || 'Failed to record settlement.';
        alertEl.classList.remove('hidden');
      }
    } catch (err) {
      alertEl.textContent = err.message;
      alertEl.classList.remove('hidden');
    }
  },

  openInvestmentModal() {
    const modal = document.getElementById('modal-create-investment');
    if (!modal) return;
    document.getElementById('create-investment-alert')?.classList.add('hidden');
    this.populateOwnerSelect('invest-owner-select');
    document.getElementById('invest-amount-input').value = '';
    document.getElementById('invest-date-input').value = new Date().toISOString().slice(0, 10);
    document.getElementById('invest-type-select').value = 'additional';
    document.getElementById('invest-notes-input').value = '';
    modal.classList.remove('hidden');
  },

  async handleCreateInvestment(e) {
    e.preventDefault();
    const alertEl = document.getElementById('create-investment-alert');
    alertEl?.classList.add('hidden');

    const owner_id = document.getElementById('invest-owner-select').value;
    const amount = document.getElementById('invest-amount-input').value;
    const investment_date = document.getElementById('invest-date-input').value;
    const investment_type = document.getElementById('invest-type-select').value;
    const notes = document.getElementById('invest-notes-input').value;

    try {
      const res = await API.createInvestment({
        owner_id: parseInt(owner_id, 10),
        amount,
        investment_date,
        investment_type,
        notes
      });

      if (res.success) {
        document.getElementById('modal-create-investment')?.classList.add('hidden');
        this.loadOwnerBalances();
        this.loadInvestments();
      } else {
        alertEl.textContent = res.error || 'Failed to record investment.';
        alertEl.classList.remove('hidden');
      }
    } catch (err) {
      alertEl.textContent = err.message;
      alertEl.classList.remove('hidden');
    }
  }
};

window.SettlementsModule = SettlementsModule;

document.addEventListener('DOMContentLoaded', () => {
  SettlementsModule.init();
});
