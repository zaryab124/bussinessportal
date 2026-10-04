// Unified Portal Dashboard Controller (Phase 9)
const DashboardModule = {
  adminStats: null,
  ownerStats: null,

  async init() {
    this.bindEvents();
  },

  bindEvents() {
    const navOverview = document.getElementById('nav-overview');
    if (navOverview) {
      navOverview.addEventListener('click', (e) => {
        e.preventDefault();
        this.showDashboard();
      });
    }

    window.addEventListener('user:authenticated', () => {
      this.showDashboard();
    });
  },

  showDashboard() {
    const user = API.getUser();
    if (!user) return;

    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById('nav-overview')?.classList.add('active');

    // Hide subpanels
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

    if (user.role === 'super_admin') {
      document.getElementById('admin-view')?.classList.remove('hidden');
      document.getElementById('admin-overview-panel')?.classList.remove('hidden');
      document.getElementById('owner-view')?.classList.add('hidden');
      this.loadAdminDashboard();
    } else {
      document.getElementById('admin-view')?.classList.add('hidden');
      document.getElementById('owner-view')?.classList.remove('hidden');
      this.loadOwnerDashboard();
    }
  },

  async loadAdminDashboard() {
    try {
      const res = await API.getAdminDashboard();
      if (!res.success || !res.stats) return;

      const s = res.stats;
      this.adminStats = s;

      // Update Top KPIs
      const kpiItems = document.getElementById('kpi-total-items');
      const kpiUnits = document.getElementById('kpi-total-units');
      const kpiValuation = document.getElementById('kpi-total-valuation');
      const kpiLowStock = document.getElementById('kpi-low-stock');

      if (kpiItems) kpiItems.textContent = `${(s.productStatusCounts?.available || 0) + (s.productStatusCounts?.partiallySold || 0) + (s.productStatusCounts?.soldOut || 0)} Items`;
      if (kpiUnits) kpiUnits.textContent = `${s.totalAvailableUnits || 0} In Hand`;
      if (kpiValuation) kpiValuation.textContent = `Rs. ${s.inventoryValuation}`;
      if (kpiLowStock) kpiLowStock.textContent = `${s.productStatusCounts?.soldOut || 0} Sold Out`;

      // Render Admin Performance & Top Products in Admin Overview Panel
      const container = document.getElementById('admin-dashboard-dynamic-content');
      if (container) {
        container.innerHTML = `
          <!-- Business Financial Health Grid -->
          <div class="stat-grid" style="margin-bottom: 20px;">
            <div class="stat-card">
              <div class="stat-label">Confirmed Gross Sales</div>
              <div class="stat-value" style="color: var(--accent-color);">Rs. ${s.grossRevenue}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Cost of Goods Sold (COGS)</div>
              <div class="stat-value" style="color: var(--text-secondary);">Rs. ${s.costOfGoodsSold}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Business Net Profit</div>
              <div class="stat-value text-success" style="font-size: 1.4rem;">Rs. ${s.netDistributableProfit}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Brand Reinvestment Pool</div>
              <div class="stat-value" style="color: #f59e0b;">Rs. ${s.totalReinvestmentReserve}</div>
            </div>
          </div>

          <!-- Monthly Performance Breakdown -->
          <div class="card" style="margin-bottom: 20px;">
            <h3 style="margin-bottom: 12px;">Monthly Sales & Profit Performance</h3>
            <div class="data-table-wrapper">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Transactions</th>
                    <th>Gross Revenue</th>
                    <th>Cost of Goods</th>
                    <th>Direct Expenses</th>
                    <th>Net Profit</th>
                  </tr>
                </thead>
                <tbody>
                  ${(s.monthlyPerformance || []).length === 0 ? '<tr><td colspan="6" style="text-align: center; padding: 15px; color: var(--text-secondary);">No sales recorded yet.</td></tr>' : s.monthlyPerformance.map(m => `
                    <tr>
                      <td><strong>${m.month}</strong></td>
                      <td>${m.saleCount}</td>
                      <td><strong>Rs. ${m.revenue}</strong></td>
                      <td style="color: var(--text-secondary);">Rs. ${m.cogs}</td>
                      <td style="color: #f59e0b;">Rs. ${m.expenses}</td>
                      <td style="color: #10b981; font-weight: 700;">Rs. ${m.netProfit}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Best-Performing Products by Profit -->
          <div class="card">
            <h3 style="margin-bottom: 12px;">Top-Performing Products by Net Profit</h3>
            <div class="data-table-wrapper">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Units Sold</th>
                    <th>Revenue</th>
                    <th>COGS</th>
                    <th>Net Profit</th>
                  </tr>
                </thead>
                <tbody>
                  ${(s.topProducts || []).length === 0 ? '<tr><td colspan="6" style="text-align: center; padding: 15px; color: var(--text-secondary);">No products sold yet.</td></tr>' : s.topProducts.map(p => `
                    <tr>
                      <td><strong style="font-family: monospace;">${p.sku}</strong></td>
                      <td>${p.name}</td>
                      <td>${p.unitsSold} units</td>
                      <td>Rs. ${p.totalRevenue}</td>
                      <td style="color: var(--text-secondary);">Rs. ${p.totalCogs}</td>
                      <td style="color: #10b981; font-weight: 700;">Rs. ${p.totalProfit}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }
    } catch (err) {
      console.error('[AdminDashboard Error]', err);
    }
  },

  async loadOwnerDashboard() {
    try {
      const res = await API.getOwnerDashboard();
      if (!res.success || !res.stats) return;

      const s = res.stats;
      this.ownerStats = s;

      // Update Owner KPI Cards
      const shareEl = document.getElementById('owner-kpi-share');
      const allocatedEl = document.getElementById('owner-kpi-allocated');
      const settledEl = document.getElementById('owner-kpi-settled');
      const payableEl = document.getElementById('owner-kpi-payable');
      const investedEl = document.getElementById('owner-kpi-invested');
      const invValEl = document.getElementById('owner-kpi-inventory-val');
      const busRevEl = document.getElementById('owner-kpi-bus-revenue');
      const busProfitEl = document.getElementById('owner-kpi-bus-net-profit');

      if (shareEl) shareEl.textContent = `${s.ownerSharePercentage}%`;
      if (allocatedEl) allocatedEl.textContent = `Rs. ${s.allocatedProfit}`;
      if (settledEl) settledEl.textContent = `Rs. ${s.settledProfit}`;
      if (payableEl) payableEl.textContent = `Rs. ${s.outstandingPayable}`;
      if (investedEl) investedEl.textContent = `Rs. ${s.contributedCapital}`;
      if (invValEl) invValEl.textContent = `Rs. ${s.businessInventoryValuation}`;
      if (busRevEl) busRevEl.textContent = `Rs. ${s.businessSalesRevenue}`;
      if (busProfitEl) busProfitEl.textContent = `Rs. ${s.businessNetProfit}`;

      // Render Dynamic Owner Workspace Tables
      const container = document.getElementById('owner-dashboard-dynamic-content');
      if (container) {
        container.innerHTML = `
          <!-- Monthly Profit Allocations -->
          <div class="card" style="margin-bottom: 20px;">
            <h3 style="margin-bottom: 12px;">Your Monthly Profit Performance</h3>
            <div class="data-table-wrapper">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Sales Transactions</th>
                    <th>Your Allocated Net Profit</th>
                  </tr>
                </thead>
                <tbody>
                  ${(s.monthlyPerformance || []).length === 0 ? '<tr><td colspan="3" style="text-align: center; padding: 15px; color: var(--text-secondary);">No profit allocations in this period.</td></tr>' : s.monthlyPerformance.map(m => `
                    <tr>
                      <td><strong>${m.month}</strong></td>
                      <td>${m.allocationCount} confirmed transactions</td>
                      <td style="color: #10b981; font-weight: 700; font-size: 1.05rem;">Rs. ${m.allocatedProfit}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Recent Allocated Transactions -->
          <div class="card" style="margin-bottom: 20px;">
            <h3 style="margin-bottom: 12px;">Recent Profit Allocations from Business Sales</h3>
            <div class="data-table-wrapper">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Sale Invoice</th>
                    <th>Date</th>
                    <th>Sale Revenue</th>
                    <th>Business Net Profit</th>
                    <th>Your Allocated Share</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${(s.recentAllocations || []).length === 0 ? '<tr><td colspan="6" style="text-align: center; padding: 15px; color: var(--text-secondary);">No transaction allocations yet.</td></tr>' : s.recentAllocations.map(a => `
                    <tr>
                      <td><strong style="font-family: monospace; color: var(--accent-color);">${a.sale_invoice_number || 'Sale'}</strong></td>
                      <td>${new Date(a.created_at).toLocaleDateString()}</td>
                      <td>Rs. ${a.total_revenue || '0.00'}</td>
                      <td>Rs. ${a.sale_net_profit || '0.00'}</td>
                      <td style="color: #10b981; font-weight: 700;">Rs. ${a.allocated_amount}</td>
                      <td><span class="badge" style="text-transform: capitalize;">${a.status}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Investment Contributions & Capital Grid -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; flex-wrap: wrap;">
            <div class="card">
              <h3 style="margin-bottom: 12px;">Your Contributed Capital</h3>
              <div class="data-table-wrapper">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(s.investments || []).length === 0 ? '<tr><td colspan="4" style="text-align: center; padding: 15px; color: var(--text-secondary);">No capital records registered.</td></tr>' : s.investments.map(i => `
                      <tr>
                        <td>${new Date(i.investment_date).toLocaleDateString()}</td>
                        <td><span class="badge" style="text-transform: capitalize;">${i.investment_type}</span></td>
                        <td style="font-weight: 700; color: #38bdf8;">Rs. ${i.amount}</td>
                        <td style="font-size: 0.85rem; color: var(--text-secondary);">${i.notes || '-'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Settlement Payouts -->
            <div class="card">
              <h3 style="margin-bottom: 12px;">Settlement Payouts Received</h3>
              <div class="data-table-wrapper">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Code</th>
                      <th>Amount</th>
                      <th>Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(s.settlements || []).length === 0 ? '<tr><td colspan="4" style="text-align: center; padding: 15px; color: var(--text-secondary);">No settlements recorded yet.</td></tr>' : s.settlements.map(settle => `
                      <tr>
                        <td>${new Date(settle.settlement_date).toLocaleDateString()}</td>
                        <td><strong style="font-family: monospace;">${settle.settlement_code || '-'}</strong></td>
                        <td style="font-weight: 700; color: #10b981;">Rs. ${settle.amount}</td>
                        <td><span class="badge">${settle.payment_method}</span></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      }
    } catch (err) {
      console.error('[OwnerDashboard Error]', err);
    }
  }
};

window.DashboardModule = DashboardModule;

document.addEventListener('DOMContentLoaded', () => {
  DashboardModule.init();
});
