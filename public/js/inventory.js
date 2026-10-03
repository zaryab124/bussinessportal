// Inventory & Stock Management Module
const InventoryModule = {
  products: [],
  currentFilters: {
    status: 'all',
    category: 'all',
    search: ''
  },

  async init() {
    this.bindEvents();
    await this.loadStats();
    await this.loadProducts();
  },

  bindEvents() {
    // Navigation
    const navInventory = document.getElementById('nav-inventory');
    if (navInventory) {
      navInventory.addEventListener('click', (e) => {
        e.preventDefault();
        this.showView();
      });
    }

    // Search and filters
    const searchInput = document.getElementById('inventory-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.currentFilters.search = e.target.value;
        this.loadProducts();
      });
    }

    const statusFilter = document.getElementById('inventory-filter-status');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        this.currentFilters.status = e.target.value;
        this.loadProducts();
      });
    }

    // Create product form
    const createForm = document.getElementById('create-product-form');
    if (createForm) {
      createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleCreateProduct();
      });
    }

    // Edit product form
    const editForm = document.getElementById('edit-product-form');
    if (editForm) {
      editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleUpdateProduct();
      });
    }

    // Adjust stock form
    const adjustForm = document.getElementById('adjust-stock-form');
    if (adjustForm) {
      adjustForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleAdjustStock();
      });
    }
  },

  showView() {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById('nav-inventory')?.classList.add('active');

    document.getElementById('admin-overview-panel')?.classList.add('hidden');
    document.getElementById('owners-management-panel')?.classList.add('hidden');
    document.getElementById('inventory-management-panel')?.classList.remove('hidden');

    this.loadStats();
    this.loadProducts();
  },

  async loadStats() {
    try {
      const res = await API.getProductStats();
      if (!res.success || !res.stats) return;

      const s = res.stats;
      const totalItemsEl = document.getElementById('kpi-total-items');
      const totalUnitsEl = document.getElementById('kpi-total-units');
      const totalValuationEl = document.getElementById('kpi-total-valuation');
      const lowStockEl = document.getElementById('kpi-low-stock');

      if (totalItemsEl) totalItemsEl.textContent = `${s.totalItems} Items`;
      if (totalUnitsEl) totalUnitsEl.textContent = `${s.totalAvailableUnits} Units In Hand`;
      if (totalValuationEl) totalValuationEl.textContent = `Rs. ${s.totalInventoryValuation}`;
      if (lowStockEl) lowStockEl.textContent = `${s.lowStockCount} Items Low`;
    } catch (err) {
      console.error('[Inventory Stats Error]', err);
    }
  },

  async loadProducts() {
    const tableBody = document.getElementById('inventory-table-body');
    if (!tableBody) return;

    try {
      tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 24px;">Loading stock listings...</td></tr>';
      const res = await API.getProducts(this.currentFilters);
      if (!res.success || !res.products) {
        tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--danger-color);">Failed to load products.</td></tr>';
        return;
      }

      this.products = res.products;
      this.renderTable();
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger-color);">${err.message}</td></tr>`;
    }
  },

  renderTable() {
    const tableBody = document.getElementById('inventory-table-body');
    if (!tableBody) return;

    const user = API.getUser();
    const isAdmin = user && user.role === 'super_admin';

    if (this.products.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">No products match the selected criteria.</td></tr>';
      return;
    }

    tableBody.innerHTML = this.products.map(p => {
      let statusClass = 'status-active';
      if (p.status === 'Partially Sold') statusClass = 'status-suspended';
      if (p.status === 'Sold Out') statusClass = 'status-deactivated';
      if (p.status === 'Archived') statusClass = 'status-archived';

      const actions = isAdmin ? `
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary btn-sm" onclick="InventoryModule.openMedia(${p.id})">Media</button>
          <button class="btn btn-secondary btn-sm" onclick="InventoryModule.openEdit(${p.id})">Edit</button>
          <button class="btn btn-secondary btn-sm" onclick="InventoryModule.openAdjust(${p.id})">Adjust</button>
          ${p.status !== 'Archived' ? `<button class="btn btn-secondary btn-sm" onclick="InventoryModule.archive(${p.id})">Archive</button>` : ''}
        </div>
      ` : `
        <button class="btn btn-secondary btn-sm" onclick="InventoryModule.openMedia(${p.id})">View Media</button>
      `;

      return `
        <tr>
          <td>
            <div style="font-weight: 700; font-family: monospace; color: var(--accent-color);">${p.sku}</div>
            <small style="color: var(--text-muted);">${p.category || 'General'}</small>
          </td>
          <td>
            <div style="font-weight: 600;">${p.name}</div>
            <small style="color: var(--text-secondary);">${p.condition || 'New'} &bull; ${p.location || 'Warehouse'}</small>
          </td>
          <td style="font-weight: 600;">
            Rs. ${p.purchase_cost_per_unit}
          </td>
          <td style="color: #60a5fa; font-weight: 600;">
            Rs. ${p.min_selling_price} &ndash; ${p.max_selling_price}
          </td>
          <td>
            <div style="font-weight: 700; font-size: 0.95rem;">
              ${p.quantity_available} <span style="font-weight: normal; color: var(--text-muted); font-size: 0.8rem;">/ ${p.quantity_purchased}</span>
            </div>
            <small style="color: var(--text-muted);">Valuation: Rs. ${p.inventory_valuation}</small>
          </td>
          <td>
            <span class="badge-status ${statusClass}">${p.status}</span>
          </td>
          <td>${actions}</td>
        </tr>
      `;
    }).join('');
  },

  async handleCreateProduct() {
    const alertEl = document.getElementById('create-product-alert');
    alertEl.classList.add('hidden');

    const sku = document.getElementById('new-prod-sku').value.trim();
    const name = document.getElementById('new-prod-name').value.trim();
    const category = document.getElementById('new-prod-category').value.trim();
    const condition = document.getElementById('new-prod-condition').value.trim();
    const location = document.getElementById('new-prod-location').value.trim();
    const supplier = document.getElementById('new-prod-supplier').value.trim();
    const purchaseCostPerUnit = parseFloat(document.getElementById('new-prod-cost').value);
    const quantityPurchased = parseInt(document.getElementById('new-prod-qty').value, 10);
    const minSellingPrice = parseFloat(document.getElementById('new-prod-min-price').value);
    const maxSellingPrice = parseFloat(document.getElementById('new-prod-max-price').value);
    const description = document.getElementById('new-prod-desc').value.trim();

    try {
      const res = await API.createProduct({
        sku,
        name,
        category,
        condition,
        location,
        supplier,
        purchaseCostPerUnit,
        quantityPurchased,
        minSellingPrice,
        maxSellingPrice,
        description
      });

      if (res.success) {
        document.getElementById('create-product-form').reset();
        document.getElementById('modal-create-product').classList.add('hidden');
        await this.loadStats();
        await this.loadProducts();
      } else {
        alertEl.textContent = res.message || 'Failed to create product.';
        alertEl.classList.remove('hidden');
      }
    } catch (err) {
      alertEl.textContent = err.message || 'Server error.';
      alertEl.classList.remove('hidden');
    }
  },

  openEdit(id) {
    const p = this.products.find(item => item.id === id);
    if (!p) return;

    document.getElementById('edit-prod-id').value = p.id;
    document.getElementById('edit-prod-sku-display').textContent = p.sku;
    document.getElementById('edit-prod-name').value = p.name;
    document.getElementById('edit-prod-category').value = p.category || '';
    document.getElementById('edit-prod-condition').value = p.condition || 'New';
    document.getElementById('edit-prod-location').value = p.location || '';
    document.getElementById('edit-prod-supplier').value = p.supplier || '';
    document.getElementById('edit-prod-min-price').value = p.min_selling_price;
    document.getElementById('edit-prod-max-price').value = p.max_selling_price;
    document.getElementById('edit-prod-status').value = p.status;
    document.getElementById('edit-prod-desc').value = p.description || '';

    document.getElementById('modal-edit-product').classList.remove('hidden');
  },

  async handleUpdateProduct() {
    const id = document.getElementById('edit-prod-id').value;
    const name = document.getElementById('edit-prod-name').value.trim();
    const category = document.getElementById('edit-prod-category').value.trim();
    const condition = document.getElementById('edit-prod-condition').value.trim();
    const location = document.getElementById('edit-prod-location').value.trim();
    const supplier = document.getElementById('edit-prod-supplier').value.trim();
    const minSellingPrice = parseFloat(document.getElementById('edit-prod-min-price').value);
    const maxSellingPrice = parseFloat(document.getElementById('edit-prod-max-price').value);
    const status = document.getElementById('edit-prod-status').value;
    const description = document.getElementById('edit-prod-desc').value.trim();

    try {
      const res = await API.updateProduct(id, {
        name,
        category,
        condition,
        location,
        supplier,
        minSellingPrice,
        maxSellingPrice,
        status,
        description
      });

      if (res.success) {
        document.getElementById('modal-edit-product').classList.add('hidden');
        await this.loadStats();
        await this.loadProducts();
      } else {
        alert(res.message || 'Error updating product.');
      }
    } catch (err) {
      alert(`Error updating product: ${err.message}`);
    }
  },

  openAdjust(id) {
    const p = this.products.find(item => item.id === id);
    if (!p) return;

    document.getElementById('adjust-prod-id').value = p.id;
    document.getElementById('adjust-prod-name-display').textContent = `${p.name} (${p.sku})`;
    document.getElementById('adjust-prod-available-display').textContent = `${p.quantity_available} units`;
    document.getElementById('adjust-stock-form').reset();
    document.getElementById('modal-adjust-stock').classList.remove('hidden');
  },

  async handleAdjustStock() {
    const id = document.getElementById('adjust-prod-id').value;
    const adjustmentType = document.getElementById('adjust-type').value;
    const quantity = parseInt(document.getElementById('adjust-qty').value, 10);
    const reason = document.getElementById('adjust-reason').value.trim();

    try {
      const res = await API.adjustStock(id, { adjustmentType, quantity, reason });
      if (res.success) {
        document.getElementById('modal-adjust-stock').classList.add('hidden');
        await this.loadStats();
        await this.loadProducts();
      } else {
        alert(res.message || 'Adjustment failed.');
      }
    } catch (err) {
      alert(`Adjustment error: ${err.message}`);
    }
  },

  async archive(id) {
    if (!confirm('Are you sure you want to archive this product listing?')) return;

    try {
      await API.archiveProduct(id);
      await this.loadStats();
      await this.loadProducts();
    } catch (err) {
      alert(`Archive error: ${err.message}`);
    }
  },

  // Media Gallery Management
  async openMedia(productId) {
    const p = this.products.find(item => item.id === productId);
    if (!p) return;

    const modal = document.getElementById('modal-product-media');
    document.getElementById('media-product-id').value = p.id;
    document.getElementById('media-prod-name-display').textContent = `${p.name} (${p.sku})`;

    const uploadArea = document.getElementById('media-upload-section');
    const user = API.getUser();
    if (user && user.role === 'super_admin') {
      uploadArea?.classList.remove('hidden');
    } else {
      uploadArea?.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    await this.loadMedia(productId);
  },

  async loadMedia(productId) {
    const grid = document.getElementById('media-gallery-grid');
    if (!grid) return;

    grid.innerHTML = '<div style="color: var(--text-muted); padding: 12px;">Loading media...</div>';

    try {
      const res = await API.getProductMedia(productId);
      const mediaList = res.media || [];

      if (mediaList.length === 0) {
        grid.innerHTML = '<div style="color: var(--text-muted); padding: 12px;">No images or videos uploaded yet.</div>';
        return;
      }

      const user = API.getUser();
      const isAdmin = user && user.role === 'super_admin';

      grid.innerHTML = mediaList.map(m => {
        const isVid = m.media_type === 'video';
        const primaryBadge = m.is_primary ? '<span class="media-badge-primary">SHOWCASE</span>' : '';

        const mediaElement = isVid
          ? `<video src="${m.file_url}" controls class="media-thumb"></video>`
          : `<img src="${m.file_url}" alt="${m.file_name}" class="media-thumb" onclick="window.open('${m.file_url}', '_blank')">`;

        const actionBtns = isAdmin ? `
          <div class="media-actions">
            ${!isVid && !m.is_primary ? `<button class="btn btn-secondary btn-sm" style="font-size: 0.65rem; padding: 2px 6px;" onclick="InventoryModule.setPrimary(${productId}, ${m.id})">Set Showcase</button>` : '<span></span>'}
            <button class="btn btn-danger btn-sm" style="font-size: 0.65rem; padding: 2px 6px;" onclick="InventoryModule.deleteMedia(${productId}, ${m.id})">&times;</button>
          </div>
        ` : '';

        return `
          <div class="media-card">
            ${primaryBadge}
            ${mediaElement}
            <div style="padding: 4px 6px; font-size: 0.7rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${m.file_name}
            </div>
            ${actionBtns}
          </div>
        `;
      }).join('');
    } catch (err) {
      grid.innerHTML = `<div style="color: var(--danger-color); padding: 12px;">Error: ${err.message}</div>`;
    }
  },

  async handleUploadMedia(event) {
    event.preventDefault();
    const productId = document.getElementById('media-product-id').value;
    const fileInput = document.getElementById('media-file-input');
    const alertEl = document.getElementById('media-upload-alert');
    alertEl.classList.add('hidden');

    if (!fileInput.files || fileInput.files.length === 0) {
      alertEl.textContent = 'Please choose at least one photo or video file.';
      alertEl.classList.remove('hidden');
      return;
    }

    const formData = new FormData();
    for (let i = 0; i < fileInput.files.length; i++) {
      formData.append('files', fileInput.files[i]);
    }

    const submitBtn = event.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading...';

    try {
      await API.uploadProductMedia(productId, formData);
      fileInput.value = '';
      await this.loadMedia(productId);
    } catch (err) {
      alertEl.textContent = err.message || 'Upload error.';
      alertEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload Media';
    }
  },

  async setPrimary(productId, mediaId) {
    try {
      await API.setPrimaryMedia(productId, mediaId);
      await this.loadMedia(productId);
    } catch (err) {
      alert(`Error setting showcase image: ${err.message}`);
    }
  },

  async deleteMedia(productId, mediaId) {
    if (!confirm('Are you sure you want to delete this media item?')) return;
    try {
      await API.deleteProductMedia(productId, mediaId);
      await this.loadMedia(productId);
    } catch (err) {
      alert(`Error deleting media: ${err.message}`);
    }
  }
};

window.InventoryModule = InventoryModule;
document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('user:authenticated', () => {
    InventoryModule.init();
  });
});
