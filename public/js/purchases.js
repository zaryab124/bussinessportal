// Purchases & Inventory Movements Controller
const PurchasesModule = {
  purchases: [],
  movements: [],
  allProducts: [],

  async init() {
    this.bindEvents();
    await this.loadPurchases();
  },

  bindEvents() {
    // Navigation links
    const navPurchases = document.getElementById('nav-purchases');
    if (navPurchases) {
      navPurchases.addEventListener('click', (e) => {
        e.preventDefault();
        this.showPurchasesView();
      });
    }

    const navMovements = document.getElementById('nav-movements');
    if (navMovements) {
      navMovements.addEventListener('click', (e) => {
        e.preventDefault();
        this.showMovementsView();
      });
    }

    // PO submission
    const poForm = document.getElementById('create-po-form');
    if (poForm) {
      poForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleCreatePurchase();
      });
    }

    // Movements filter
    const moveFilter = document.getElementById('movements-filter-type');
    if (moveFilter) {
      moveFilter.addEventListener('change', () => {
        this.loadMovements();
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

  showPurchasesView() {
    this.hideAllPanels();
    document.getElementById('nav-purchases')?.classList.add('active');
    document.getElementById('purchases-panel')?.classList.remove('hidden');
    this.loadPurchases();
  },

  showMovementsView() {
    this.hideAllPanels();
    document.getElementById('nav-movements')?.classList.add('active');
    document.getElementById('movements-panel')?.classList.remove('hidden');
    this.loadMovements();
  },

  async loadPurchases() {
    const tableBody = document.getElementById('purchases-table-body');
    if (!tableBody) return;

    try {
      tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">Loading purchase orders...</td></tr>';
      const res = await API.getPurchases();
      this.purchases = res.purchases || [];
      this.renderPurchasesTable();
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger-color);">${err.message}</td></tr>`;
    }
  },

  renderPurchasesTable() {
    const tableBody = document.getElementById('purchases-table-body');
    if (!tableBody) return;

    if (this.purchases.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted);">No purchase orders recorded yet.</td></tr>';
      return;
    }

    tableBody.innerHTML = this.purchases.map(po => {
      const dateStr = new Date(po.purchase_date).toLocaleDateString();
      return `
        <tr>
          <td>
            <strong style="color: var(--accent-color); font-family: monospace;">${po.purchase_order_number}</strong>
          </td>
          <td>${dateStr}</td>
          <td><strong>${po.supplier_name || 'Standard Supplier'}</strong></td>
          <td>${po.item_count} item(s)</td>
          <td style="font-weight: 700; color: #10b981;">Rs. ${po.total_cost}</td>
          <td>
            <div style="display: flex; gap: 6px; align-items: center;">
              <span class="badge-status status-active">${po.status}</span>
              <button class="btn btn-secondary btn-sm" onclick="PurchasesModule.openPurchaseDetails(${po.id})">Details</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  async openNewPurchaseModal() {
    // Load products list for dropdown
    const res = await API.getProducts({ status: 'all' });
    this.allProducts = res.products || [];

    const container = document.getElementById('po-items-container');
    container.innerHTML = '';
    this.addItemRow(); // Start with 1 row

    document.getElementById('po-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('po-supplier').value = '';
    document.getElementById('po-notes').value = '';
    document.getElementById('modal-create-po').classList.remove('hidden');
    this.updateTotal();
  },

  addItemRow() {
    const container = document.getElementById('po-items-container');
    const rowIndex = container.children.length;

    const row = document.createElement('div');
    row.className = 'po-item-row';
    row.style = 'display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 40px; gap: 8px; margin-bottom: 8px; align-items: center;';

    const productOptions = this.allProducts.map(p =>
      `<option value="${p.id}" data-cost="${p.purchase_cost_per_unit}">${p.name} (${p.sku})</option>`
    ).join('');

    row.innerHTML = `
      <select class="form-control po-prod-select" required onchange="PurchasesModule.onProductSelect(this)">
        <option value="">Select product...</option>
        ${productOptions}
      </select>
      <input type="number" class="form-control po-qty-input" placeholder="Qty" min="1" value="1" required oninput="PurchasesModule.updateTotal()">
      <input type="number" step="0.01" class="form-control po-cost-input" placeholder="Unit Cost (Rs.)" min="0" required oninput="PurchasesModule.updateTotal()">
      <div class="po-item-subtotal" style="font-weight: 600; text-align: right; color: var(--text-primary);">Rs. 0.00</div>
      <button type="button" class="btn btn-danger btn-sm" onclick="PurchasesModule.removeItemRow(this)">&times;</button>
    `;

    container.appendChild(row);
  },

  removeItemRow(btn) {
    const container = document.getElementById('po-items-container');
    if (container.children.length > 1) {
      btn.closest('.po-item-row').remove();
      this.updateTotal();
    } else {
      alert('A purchase order must contain at least one line item.');
    }
  },

  onProductSelect(selectEl) {
    const selectedOption = selectEl.options[selectEl.selectedIndex];
    const defaultCost = selectedOption.getAttribute('data-cost');
    const row = selectEl.closest('.po-item-row');
    const costInput = row.querySelector('.po-cost-input');

    if (defaultCost && !costInput.value) {
      costInput.value = parseFloat(defaultCost).toFixed(2);
    }
    this.updateTotal();
  },

  updateTotal() {
    let grandTotal = 0;
    const rows = document.querySelectorAll('.po-item-row');

    rows.forEach(row => {
      const qty = parseFloat(row.querySelector('.po-qty-input').value) || 0;
      const cost = parseFloat(row.querySelector('.po-cost-input').value) || 0;
      const subtotal = qty * cost;

      row.querySelector('.po-item-subtotal').textContent = `Rs. ${subtotal.toFixed(2)}`;
      grandTotal += subtotal;
    });

    const totalEl = document.getElementById('po-grand-total');
    if (totalEl) totalEl.textContent = `Rs. ${grandTotal.toFixed(2)}`;
  },

  async handleCreatePurchase() {
    const alertEl = document.getElementById('create-po-alert');
    alertEl.classList.add('hidden');

    const supplierName = document.getElementById('po-supplier').value.trim();
    const purchaseDate = document.getElementById('po-date').value;
    const notes = document.getElementById('po-notes').value.trim();

    const rows = document.querySelectorAll('.po-item-row');
    const items = [];

    for (const row of rows) {
      const productId = row.querySelector('.po-prod-select').value;
      const quantity = parseInt(row.querySelector('.po-qty-input').value, 10);
      const unitCost = parseFloat(row.querySelector('.po-cost-input').value);

      if (!productId) {
        alertEl.textContent = 'Please select a product for all rows.';
        alertEl.classList.remove('hidden');
        return;
      }

      items.push({ productId, quantity, unitCost });
    }

    try {
      const res = await API.createPurchase({ supplierName, purchaseDate, items, notes });
      if (res.success) {
        document.getElementById('modal-create-po').classList.add('hidden');
        await this.loadPurchases();
        if (window.InventoryModule) {
          await window.InventoryModule.loadStats();
          await window.InventoryModule.loadProducts();
        }
      } else {
        alertEl.textContent = res.message || 'Error recording PO.';
        alertEl.classList.remove('hidden');
      }
    } catch (err) {
      alertEl.textContent = err.message || 'Server error.';
      alertEl.classList.remove('hidden');
    }
  },

  async openPurchaseDetails(id) {
    try {
      const res = await API.getPurchase(id);
      const po = res.purchase;

      document.getElementById('po-detail-number').textContent = po.purchase_order_number;
      document.getElementById('po-detail-supplier').textContent = po.supplier_name;
      document.getElementById('po-detail-date').textContent = new Date(po.purchase_date).toLocaleDateString();
      document.getElementById('po-detail-total').textContent = `Rs. ${po.total_cost}`;
      document.getElementById('po-detail-recorder').textContent = po.recorder_name || 'Admin';

      const itemsBody = document.getElementById('po-detail-items-body');
      itemsBody.innerHTML = po.items.map(it => `
        <tr>
          <td><strong style="color: var(--accent-color); font-family: monospace;">${it.sku}</strong></td>
          <td>${it.product_name}</td>
          <td>${it.quantity}</td>
          <td>Rs. ${it.unit_cost}</td>
          <td style="font-weight: 600;">Rs. ${it.total_cost}</td>
        </tr>
      `).join('');

      document.getElementById('modal-po-details').classList.remove('hidden');
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  },

  async loadMovements() {
    const tableBody = document.getElementById('movements-table-body');
    if (!tableBody) return;

    const filterType = document.getElementById('movements-filter-type')?.value;

    try {
      tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">Loading inventory movement logs...</td></tr>';
      const res = await API.getInventoryMovements({ movementType: filterType, limit: 100 });
      this.movements = res.movements || [];

      if (this.movements.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted);">No inventory movements recorded yet.</td></tr>';
        return;
      }

      tableBody.innerHTML = this.movements.map(m => {
        let typeBadge = '<span class="badge-status status-active">Purchase In</span>';
        if (m.movement_type === 'sale_out') typeBadge = '<span class="badge-status status-deactivated">Sale Out</span>';
        if (m.movement_type === 'damage_loss') typeBadge = '<span class="badge-status status-deactivated">Damage Loss</span>';
        if (m.movement_type.startsWith('adjustment')) typeBadge = '<span class="badge-status status-suspended">Adjustment</span>';

        const dateStr = new Date(m.created_at).toLocaleString();

        return `
          <tr>
            <td><small style="color: var(--text-muted);">${dateStr}</small></td>
            <td><strong style="color: var(--accent-color); font-family: monospace;">${m.sku}</strong></td>
            <td>${m.product_name}</td>
            <td>${typeBadge}</td>
            <td style="font-weight: 700;">${m.quantity} units</td>
            <td>Rs. ${m.unit_cost}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger-color);">${err.message}</td></tr>`;
    }
  }
};

window.PurchasesModule = PurchasesModule;
document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('user:authenticated', () => {
    PurchasesModule.init();
  });
});
