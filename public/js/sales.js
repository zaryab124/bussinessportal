// Sales Management Controller (Phase 6)
const SalesModule = {
  sales: [],
  allProducts: [],

  async init() {
    this.bindEvents();
  },

  bindEvents() {
    const navSales = document.getElementById('nav-sales');
    if (navSales) {
      navSales.addEventListener('click', (e) => {
        e.preventDefault();
        this.showSalesView();
      });
    }

    // Filter changes
    const statusFilter = document.getElementById('sales-filter-status');
    if (statusFilter) {
      statusFilter.addEventListener('change', () => this.loadSales());
    }

    const payStatusFilter = document.getElementById('sales-filter-pay-status');
    if (payStatusFilter) {
      payStatusFilter.addEventListener('change', () => this.loadSales());
    }

    // Create sale form submission
    const saleForm = document.getElementById('create-sale-form');
    if (saleForm) {
      saleForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleCreateSale();
      });
    }

    // Direct expenses input live update
    const expInput = document.getElementById('sale-direct-expenses');
    if (expInput) {
      expInput.addEventListener('input', () => this.recalculateTotals());
    }

    // Cancel sale form submission
    const cancelForm = document.getElementById('cancel-sale-form');
    if (cancelForm) {
      cancelForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleCancelSale();
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
    document.getElementById('expenses-panel')?.classList.add('hidden');
    document.getElementById('settlements-panel')?.classList.add('hidden');
    document.getElementById('audit-panel')?.classList.add('hidden');
    document.getElementById('owner-view')?.classList.add('hidden');
  },

  showSalesView() {
    this.hideAllPanels();
    document.getElementById('nav-sales')?.classList.add('active');
    document.getElementById('sales-panel')?.classList.remove('hidden');

    const user = API.getUser();
    const isSuperAdmin = user && user.role === 'super_admin';
    const newSaleBtn = document.getElementById('btn-open-new-sale');
    if (newSaleBtn) {
      newSaleBtn.style.display = isSuperAdmin ? 'inline-block' : 'none';
    }

    this.loadSales();
  },

  async loadSales() {
    const tbody = document.getElementById('sales-table-body');
    if (!tbody) return;

    try {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">Loading sales register...</td></tr>';

      const status = document.getElementById('sales-filter-status')?.value || 'all';
      const paymentStatus = document.getElementById('sales-filter-pay-status')?.value || 'all';

      const res = await API.getSales({ status, paymentStatus });
      this.sales = res.sales || [];

      if (this.sales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--text-secondary);">No sales transactions found.</td></tr>';
        return;
      }

      const user = API.getUser();
      const isSuperAdmin = user && user.role === 'super_admin';

      tbody.innerHTML = this.sales.map(s => {
        let statusBadge = '<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #6ee7b7;">Confirmed</span>';
        if (s.status === 'cancelled') {
          statusBadge = '<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #fca5a5;">Cancelled</span>';
        }

        const overrideTag = s.price_override_approved ? '<br><small style="color: #f59e0b; font-weight: 600;">⚠️ Price Override</small>' : '';

        return `
          <tr>
            <td>
              <strong style="font-family: monospace; color: var(--accent-color);">${s.sale_invoice_number}</strong>
              ${overrideTag}
            </td>
            <td>${new Date(s.sale_date).toLocaleDateString()}</td>
            <td>${s.customer_reference || '<span style="color: var(--text-muted);">-</span>'}</td>
            <td><strong>Rs. ${s.total_revenue}</strong></td>
            <td style="color: var(--text-secondary);">Rs. ${s.total_cost_of_goods}</td>
            <td style="color: #10b981; font-weight: 700;">Rs. ${s.net_profit}</td>
            <td>${statusBadge}</td>
            <td style="white-space: nowrap;">
              <button class="btn btn-secondary btn-sm" onclick="SalesModule.openSaleDetails(${s.id})" title="View Invoice">
                View
              </button>
              ${isSuperAdmin && s.status === 'confirmed' ? `
                <button class="btn btn-danger btn-sm" onclick="SalesModule.openCancelModal(${s.id}, '${s.sale_invoice_number}')" title="Cancel Sale">
                  Cancel
                </button>
              ` : ''}
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('[Sales Load Error]', err);
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--danger-color); padding: 20px;">Error: ${err.message}</td></tr>`;
    }
  },

  async openNewSaleModal() {
    const alertBox = document.getElementById('create-sale-alert');
    if (alertBox) alertBox.classList.add('hidden');

    // Default values
    document.getElementById('sale-invoice-number').value = '';
    document.getElementById('sale-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('sale-customer').value = '';
    document.getElementById('sale-direct-expenses').value = '0.00';
    document.getElementById('sale-payment-method').value = 'cash';
    document.getElementById('sale-payment-status').value = 'paid';

    // Reset override fields
    document.getElementById('sale-override-group').classList.add('hidden');
    document.getElementById('sale-override-check').checked = false;
    document.getElementById('sale-override-reason').value = '';

    // Load available products for selection
    try {
      const prodRes = await API.getProducts({ status: 'Available' });
      const partiallyRes = await API.getProducts({ status: 'Partially Sold' });
      const combined = [...(prodRes.products || []), ...(partiallyRes.products || [])];
      this.allProducts = combined.filter(p => p.quantity_available > 0);

      const container = document.getElementById('sale-items-container');
      if (container) {
        container.innerHTML = '';
        this.addItemRow();
      }

      this.recalculateTotals();
      document.getElementById('modal-create-sale').classList.remove('hidden');
    } catch (err) {
      alert('Failed to load products: ' + err.message);
    }
  },

  addItemRow() {
    const container = document.getElementById('sale-items-container');
    if (!container) return;

    const rowId = 'sale-row-' + Math.random().toString(36).substring(2, 8);
    const row = document.createElement('div');
    row.id = rowId;
    row.className = 'sale-item-row';
    row.style = 'display: grid; grid-template-columns: 2fr 1fr 1.2fr 1fr 40px; gap: 8px; margin-bottom: 8px; align-items: center;';

    const options = this.allProducts.map(p => `
      <option value="${p.id}" data-cost="${p.purchase_cost_per_unit}" data-min="${p.min_selling_price}" data-max="${p.max_selling_price}" data-avail="${p.quantity_available}">
        ${p.sku} - ${p.name} (Avail: ${p.quantity_available})
      </option>
    `).join('');

    row.innerHTML = `
      <div>
        <select class="form-control sale-prod-select" required onchange="SalesModule.handleProductSelect('${rowId}')">
          <option value="">-- Choose Product --</option>
          ${options}
        </select>
        <div class="price-range-badge" style="font-size: 0.72rem; color: var(--accent-color); margin-top: 2px;"></div>
      </div>
      <div>
        <input type="number" class="form-control sale-qty-input" placeholder="Qty" min="1" value="1" required oninput="SalesModule.handleItemInput('${rowId}')">
        <small class="max-avail-hint" style="font-size: 0.7rem; color: var(--text-muted);"></small>
      </div>
      <div>
        <input type="number" step="0.01" class="form-control sale-price-input" placeholder="Price" min="0.01" required oninput="SalesModule.handleItemInput('${rowId}')">
        <small class="price-warning-hint" style="font-size: 0.7rem; color: #f59e0b; font-weight: 600;"></small>
      </div>
      <div style="text-align: right; font-weight: 600; font-size: 0.9rem;" class="sale-row-subtotal">
        Rs. 0.00
      </div>
      <div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="SalesModule.removeItemRow('${rowId}')" style="padding: 4px 8px;">&times;</button>
      </div>
    `;

    container.appendChild(row);
  },

  removeItemRow(rowId) {
    const row = document.getElementById(rowId);
    if (row) {
      row.remove();
      this.recalculateTotals();
    }
  },

  handleProductSelect(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;

    const select = row.querySelector('.sale-prod-select');
    const selectedOption = select.selectedOptions[0];
    const badge = row.querySelector('.price-range-badge');
    const availHint = row.querySelector('.max-avail-hint');
    const priceInput = row.querySelector('.sale-price-input');
    const qtyInput = row.querySelector('.sale-qty-input');

    if (!selectedOption || !selectedOption.value) {
      if (badge) badge.textContent = '';
      if (availHint) availHint.textContent = '';
      priceInput.value = '';
      this.recalculateTotals();
      return;
    }

    const minPrice = selectedOption.getAttribute('data-min');
    const maxPrice = selectedOption.getAttribute('data-max');
    const avail = selectedOption.getAttribute('data-avail');

    if (badge) {
      badge.textContent = `Range: Rs. ${minPrice} – Rs. ${maxPrice}`;
    }
    if (availHint) {
      availHint.textContent = `Max: ${avail}`;
      qtyInput.max = avail;
    }

    // Default selling price to minPrice
    if (!priceInput.value || Number(priceInput.value) === 0) {
      priceInput.value = minPrice;
    }

    this.handleItemInput(rowId);
  },

  handleItemInput(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;

    const select = row.querySelector('.sale-prod-select');
    const selectedOption = select?.selectedOptions[0];
    const priceInput = row.querySelector('.sale-price-input');
    const qtyInput = row.querySelector('.sale-qty-input');
    const subtotalEl = row.querySelector('.sale-row-subtotal');
    const warningEl = row.querySelector('.price-warning-hint');

    const qty = parseInt(qtyInput?.value, 10) || 0;
    const price = parseFloat(priceInput?.value) || 0;

    const subtotal = (qty * price).toFixed(2);
    if (subtotalEl) subtotalEl.textContent = `Rs. ${subtotal}`;

    // Price range verification
    if (selectedOption && selectedOption.value) {
      const minPrice = parseFloat(selectedOption.getAttribute('data-min')) || 0;
      const maxPrice = parseFloat(selectedOption.getAttribute('data-max')) || 0;

      if (price < minPrice || price > maxPrice) {
        if (warningEl) warningEl.textContent = '⚠️ Outside range';
      } else {
        if (warningEl) warningEl.textContent = '';
      }
    }

    this.recalculateTotals();
  },

  recalculateTotals() {
    let grandRevenue = 0;
    let grandCogs = 0;
    let hasOutOfRangeItem = false;

    const rows = document.querySelectorAll('.sale-item-row');
    rows.forEach(row => {
      const select = row.querySelector('.sale-prod-select');
      const selectedOption = select?.selectedOptions[0];
      const qtyInput = row.querySelector('.sale-qty-input');
      const priceInput = row.querySelector('.sale-price-input');

      const qty = parseInt(qtyInput?.value, 10) || 0;
      const price = parseFloat(priceInput?.value) || 0;

      if (selectedOption && selectedOption.value && qty > 0) {
        const unitCost = parseFloat(selectedOption.getAttribute('data-cost')) || 0;
        const minPrice = parseFloat(selectedOption.getAttribute('data-min')) || 0;
        const maxPrice = parseFloat(selectedOption.getAttribute('data-max')) || 0;

        grandRevenue += qty * price;
        grandCogs += qty * unitCost;

        if (price < minPrice || price > maxPrice) {
          hasOutOfRangeItem = true;
        }
      }
    });

    const expensesInput = document.getElementById('sale-direct-expenses');
    const expenses = parseFloat(expensesInput?.value) || 0;

    const grossProfit = grandRevenue - grandCogs;
    const netProfit = grossProfit - expenses;

    // Update displays
    document.getElementById('sale-calc-revenue').textContent = `Rs. ${grandRevenue.toFixed(2)}`;
    document.getElementById('sale-calc-cogs').textContent = `Rs. ${grandCogs.toFixed(2)}`;
    document.getElementById('sale-calc-expenses').textContent = `Rs. ${expenses.toFixed(2)}`;
    document.getElementById('sale-calc-net-profit').textContent = `Rs. ${netProfit.toFixed(2)}`;

    // Show/hide override section if any item is out of range
    const overrideGroup = document.getElementById('sale-override-group');
    if (overrideGroup) {
      if (hasOutOfRangeItem) {
        overrideGroup.classList.remove('hidden');
        document.getElementById('sale-override-reason').required = true;
      } else {
        overrideGroup.classList.add('hidden');
        document.getElementById('sale-override-reason').required = false;
      }
    }
  },

  async handleCreateSale() {
    const alertBox = document.getElementById('create-sale-alert');
    if (alertBox) alertBox.classList.add('hidden');

    try {
      const rows = document.querySelectorAll('.sale-item-row');
      const items = [];

      rows.forEach(row => {
        const select = row.querySelector('.sale-prod-select');
        const qty = parseInt(row.querySelector('.sale-qty-input')?.value, 10);
        const price = row.querySelector('.sale-price-input')?.value;

        if (select && select.value && qty > 0) {
          items.push({
            productId: parseInt(select.value, 10),
            quantity: qty,
            unitSellingPrice: price
          });
        }
      });

      if (items.length === 0) {
        throw new Error('Please add at least one valid product item to this sale.');
      }

      const overrideGroup = document.getElementById('sale-override-group');
      const isOverrideVisible = !overrideGroup.classList.contains('hidden');
      const priceOverrideApproved = isOverrideVisible ? document.getElementById('sale-override-check').checked : false;
      const priceOverrideReason = isOverrideVisible ? document.getElementById('sale-override-reason').value.trim() : null;

      if (isOverrideVisible && (!priceOverrideApproved || !priceOverrideReason)) {
        throw new Error('One or more products have a selling price outside the configured range. You must check "Authorized Price Override" and document the reason.');
      }

      const payload = {
        saleInvoiceNumber: document.getElementById('sale-invoice-number').value.trim() || undefined,
        saleDate: document.getElementById('sale-date').value,
        customerReference: document.getElementById('sale-customer').value.trim() || undefined,
        paymentMethod: document.getElementById('sale-payment-method').value,
        paymentStatus: document.getElementById('sale-payment-status').value,
        directExpenses: document.getElementById('sale-direct-expenses').value || '0.00',
        priceOverrideApproved,
        priceOverrideReason,
        items
      };

      const res = await API.createSale(payload);
      if (!res.success) throw new Error(res.message);

      document.getElementById('modal-create-sale').classList.add('hidden');
      await this.loadSales();
      if (window.InventoryModule) {
        await window.InventoryModule.loadStats();
      }
    } catch (err) {
      console.error('[CreateSale Error]', err);
      if (alertBox) {
        alertBox.textContent = err.message;
        alertBox.classList.remove('hidden');
      }
    }
  },

  async openSaleDetails(id) {
    try {
      const res = await API.getSale(id);
      if (!res.success || !res.sale) throw new Error(res.message);

      const s = res.sale;
      document.getElementById('sale-detail-invoice').textContent = s.sale_invoice_number;
      document.getElementById('sale-detail-date').textContent = new Date(s.sale_date).toLocaleDateString();
      document.getElementById('sale-detail-customer').textContent = s.customer_reference || 'N/A';
      document.getElementById('sale-detail-payment').textContent = `${s.payment_method.toUpperCase()} (${s.payment_status.toUpperCase()})`;
      document.getElementById('sale-detail-revenue').textContent = `Rs. ${s.total_revenue}`;
      document.getElementById('sale-detail-cogs').textContent = `Rs. ${s.total_cost_of_goods}`;
      document.getElementById('sale-detail-expenses').textContent = `Rs. ${s.total_direct_expenses}`;
      document.getElementById('sale-detail-profit').textContent = `Rs. ${s.net_profit}`;
      document.getElementById('sale-detail-recorder').textContent = s.recorder_name || 'System';

      const overrideBox = document.getElementById('sale-detail-override-info');
      if (s.price_override_approved) {
        overrideBox.innerHTML = `<strong>Authorized Price Override:</strong> ${s.price_override_reason}`;
        overrideBox.classList.remove('hidden');
      } else {
        overrideBox.classList.add('hidden');
      }

      const tbody = document.getElementById('sale-detail-items-body');
      tbody.innerHTML = (s.items || []).map(it => `
        <tr>
          <td><strong style="font-family: monospace;">${it.sku}</strong></td>
          <td>${it.product_name}</td>
          <td>${it.quantity}</td>
          <td>Rs. ${it.unit_purchase_cost}</td>
          <td>Rs. ${it.unit_selling_price}</td>
          <td>Rs. ${it.subtotal_revenue}</td>
          <td style="color: #10b981; font-weight: 700;">Rs. ${it.subtotal_profit}</td>
        </tr>
      `).join('');

      document.getElementById('modal-sale-details').classList.remove('hidden');
    } catch (err) {
      alert('Failed to load sale details: ' + err.message);
    }
  },

  openCancelModal(id, invoiceNumber) {
    document.getElementById('cancel-sale-id').value = id;
    document.getElementById('cancel-sale-invoice-label').textContent = invoiceNumber;
    document.getElementById('cancel-sale-reason').value = '';
    document.getElementById('cancel-sale-alert').classList.add('hidden');
    document.getElementById('modal-cancel-sale').classList.remove('hidden');
  },

  async handleCancelSale() {
    const alertBox = document.getElementById('cancel-sale-alert');
    if (alertBox) alertBox.classList.add('hidden');

    const id = document.getElementById('cancel-sale-id').value;
    const reason = document.getElementById('cancel-sale-reason').value.trim();

    if (!reason) {
      if (alertBox) {
        alertBox.textContent = 'A documented cancellation reason is required.';
        alertBox.classList.remove('hidden');
      }
      return;
    }

    try {
      const res = await API.cancelSale(id, reason);
      if (!res.success) throw new Error(res.message);

      document.getElementById('modal-cancel-sale').classList.add('hidden');
      await this.loadSales();
      if (window.InventoryModule) {
        await window.InventoryModule.loadStats();
      }
    } catch (err) {
      console.error('[CancelSale Error]', err);
      if (alertBox) {
        alertBox.textContent = err.message;
        alertBox.classList.remove('hidden');
      }
    }
  }
};

window.SalesModule = SalesModule;

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  SalesModule.init();
});
