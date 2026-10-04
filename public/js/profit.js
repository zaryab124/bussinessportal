// Profit Sharing & Reinvestment Controller (Phase 8)
const ProfitModule = {
  activeRule: null,
  allocations: [],
  ownersList: [],

  async init() {
    this.bindEvents();
  },

  bindEvents() {
    const navProfit = document.getElementById('nav-profit');
    if (navProfit) {
      navProfit.addEventListener('click', (e) => {
        e.preventDefault();
        this.showProfitView();
      });
    }

    const typeFilter = document.getElementById('profit-filter-type');
    if (typeFilter) {
      typeFilter.addEventListener('change', () => this.loadAllocations());
    }

    const ruleForm = document.getElementById('config-rule-form');
    if (ruleForm) {
      ruleForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleCreateRule();
      });
    }

    const reinvInput = document.getElementById('rule-reinvestment-input');
    if (reinvInput) {
      reinvInput.addEventListener('input', () => this.recalculateRuleSum());
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

  showProfitView() {
    this.hideAllPanels();
    document.getElementById('nav-profit')?.classList.add('active');
    document.getElementById('profit-panel')?.classList.remove('hidden');

    const user = API.getUser();
    const isSuperAdmin = user && user.role === 'super_admin';
    const configBtn = document.getElementById('btn-open-config-rule');
    if (configBtn) {
      configBtn.style.display = isSuperAdmin ? 'inline-block' : 'none';
    }

    this.loadActiveRule();
    this.loadReinvestmentReserve();
    this.loadAllocations();
  },

  async loadActiveRule() {
    try {
      const res = await API.getActiveProfitRule();
      if (!res.success || !res.rule) return;

      const r = res.rule;
      this.activeRule = r;

      const nameEl = document.getElementById('rule-display-name');
      const verEl = document.getElementById('rule-display-version');
      const reinvEl = document.getElementById('rule-display-reinv');
      const ownersListEl = document.getElementById('rule-display-owners-list');

      if (nameEl) nameEl.textContent = r.rule_name;
      if (verEl) verEl.textContent = `Version ${r.version}`;
      if (reinvEl) reinvEl.textContent = `${r.reinvestment_percentage}%`;

      if (ownersListEl) {
        ownersListEl.innerHTML = (r.owners || []).map(o => `
          <div style="background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="color: var(--text-primary); font-size: 0.9rem;">${o.owner_name}</strong>
              <small style="color: var(--text-muted); display: block; font-size: 0.75rem;">${o.owner_email}</small>
            </div>
            <span class="badge" style="background: rgba(59, 130, 246, 0.2); color: #93c5fd; font-size: 0.85rem; font-weight: 700;">
              ${o.percentage}%
            </span>
          </div>
        `).join('');
      }
    } catch (err) {
      console.error('[LoadActiveRule Error]', err);
    }
  },

  async loadReinvestmentReserve() {
    try {
      const res = await API.getReinvestmentReserves();
      if (!res.success) return;

      const poolEl = document.getElementById('profit-reinv-pool');
      if (poolEl) poolEl.textContent = `Rs. ${res.totalReserve}`;
    } catch (err) {
      console.error('[LoadReserve Error]', err);
    }
  },

  async loadAllocations() {
    const tbody = document.getElementById('allocations-table-body');
    if (!tbody) return;

    try {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">Loading profit allocations...</td></tr>';

      const allocationType = document.getElementById('profit-filter-type')?.value || 'all';
      const res = await API.getProfitAllocations({ allocationType });
      this.allocations = res.allocations || [];

      if (this.allocations.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-secondary);">No profit allocations recorded yet.</td></tr>';
        return;
      }

      tbody.innerHTML = this.allocations.map(a => {
        const isReinv = a.allocation_type === 'brand_reinvestment';
        const recipient = isReinv
          ? '<strong style="color: #f59e0b;">Brand Reinvestment Reserve</strong>'
          : `<strong>${a.owner_name}</strong> <small style="color: var(--text-muted);">(${a.owner_email})</small>`;

        const typeBadge = isReinv
          ? '<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24;">Brand Reserve</span>'
          : '<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #6ee7b7;">Partner Share</span>';

        return `
          <tr>
            <td><strong style="font-family: monospace; color: var(--accent-color);">${a.sale_invoice_number || 'Periodic Close'}</strong></td>
            <td>${new Date(a.created_at).toLocaleDateString()}</td>
            <td>${recipient}</td>
            <td>${typeBadge}</td>
            <td style="font-weight: 700; color: #10b981;">Rs. ${a.allocated_amount}</td>
            <td><span class="badge" style="text-transform: capitalize;">${a.status}</span></td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('[LoadAllocations Error]', err);
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger-color); padding: 20px;">Error: ${err.message}</td></tr>`;
    }
  },

  async openConfigRuleModal() {
    const alertBox = document.getElementById('config-rule-alert');
    if (alertBox) alertBox.classList.add('hidden');

    try {
      // Fetch current owners to build percentage input rows
      const ownersRes = await API.getOwners();
      const owners = (ownersRes.owners || []).filter(o => o.status === 'active');
      this.ownersList = owners;

      const container = document.getElementById('rule-owners-inputs-container');
      if (container) {
        container.innerHTML = owners.map(o => `
          <div class="form-group rule-owner-input-row" data-owner-id="${o.id}" style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px; align-items: center; margin-bottom: 8px;">
            <div>
              <strong>${o.full_name}</strong>
              <small style="color: var(--text-muted); display: block;">${o.email}</small>
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 4px;">
                <input type="number" step="0.01" min="0" max="100" class="form-control rule-owner-pct-input" value="33.00" required oninput="ProfitModule.recalculateRuleSum()">
                <span style="font-weight: 600;">%</span>
              </div>
            </div>
          </div>
        `).join('');
      }

      document.getElementById('rule-name-input').value = `Rule Version ${(this.activeRule?.version || 1) + 1} (${new Date().toLocaleDateString()})`;
      document.getElementById('rule-reinvestment-input').value = '34.00';
      document.getElementById('rule-notes-input').value = '';

      this.recalculateRuleSum();
      document.getElementById('modal-configure-profit-rule').classList.remove('hidden');
    } catch (err) {
      alert('Failed to prepare rule configuration: ' + err.message);
    }
  },

  recalculateRuleSum() {
    const reinvVal = parseFloat(document.getElementById('rule-reinvestment-input')?.value) || 0;
    let sum = reinvVal;

    const ownerInputs = document.querySelectorAll('.rule-owner-pct-input');
    ownerInputs.forEach(inp => {
      sum += parseFloat(inp.value) || 0;
    });

    const sumDisplay = document.getElementById('rule-sum-display');
    const submitBtn = document.getElementById('btn-submit-rule');

    if (sumDisplay) {
      sumDisplay.textContent = `${sum.toFixed(2)}%`;
      if (Math.abs(sum - 100.00) < 0.001) {
        sumDisplay.style.color = '#10b981';
        if (submitBtn) submitBtn.disabled = false;
      } else {
        sumDisplay.style.color = '#ef4444';
        if (submitBtn) submitBtn.disabled = true;
      }
    }
  },

  async handleCreateRule() {
    const alertBox = document.getElementById('config-rule-alert');
    if (alertBox) alertBox.classList.add('hidden');

    try {
      const ruleName = document.getElementById('rule-name-input').value.trim();
      const reinvestmentPercentage = document.getElementById('rule-reinvestment-input').value;
      const notes = document.getElementById('rule-notes-input').value.trim();

      const ownerRows = document.querySelectorAll('.rule-owner-input-row');
      const owners = [];
      ownerRows.forEach(row => {
        const ownerId = parseInt(row.getAttribute('data-owner-id'), 10);
        const pct = row.querySelector('.rule-owner-pct-input')?.value;
        owners.push({ ownerId, percentage: pct });
      });

      const res = await API.createProfitRule({
        ruleName,
        reinvestmentPercentage,
        notes,
        owners
      });

      if (!res.success) throw new Error(res.message);

      document.getElementById('modal-configure-profit-rule').classList.add('hidden');
      await this.loadActiveRule();
      await this.loadAllocations();
    } catch (err) {
      console.error('[CreateRule Error]', err);
      if (alertBox) {
        alertBox.textContent = err.message;
        alertBox.classList.remove('hidden');
      }
    }
  }
};

window.ProfitModule = ProfitModule;

document.addEventListener('DOMContentLoaded', () => {
  ProfitModule.init();
});
