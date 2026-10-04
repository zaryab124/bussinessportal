// API Client module
const API = {
  getToken() {
    return localStorage.getItem('token');
  },

  setToken(token) {
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  },

  getUser() {
    const userStr = localStorage.getItem('user');
    try {
      return userStr ? JSON.parse(userStr) : null;
    } catch {
      return null;
    }
  },

  setUser(user) {
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      localStorage.removeItem('user');
    }
  },

  clearSession() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(endpoint, {
        ...options,
        headers
      });

      const data = await response.json();

      if (response.status === 401) {
        this.clearSession();
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }

      if (!response.ok) {
        throw new Error(data.message || `Request failed with status ${response.status}`);
      }

      return data;
    } catch (err) {
      console.error(`[API Request Error] ${endpoint}:`, err);
      throw err;
    }
  },

  // Auth endpoints
  async login(email, password) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  },

  async getMe() {
    return this.request('/api/auth/me', {
      method: 'GET'
    });
  },

  async changePassword(currentPassword, newPassword) {
    return this.request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  },

  async logout() {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } finally {
      this.clearSession();
    }
  },

  // Owner management endpoints
  async getOwners() {
    return this.request('/api/users/owners', { method: 'GET' });
  },

  async getOwner(id) {
    return this.request(`/api/users/owners/${id}`, { method: 'GET' });
  },

  async createOwner(data) {
    return this.request('/api/users/owners', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async updateOwner(id, data) {
    return this.request(`/api/users/owners/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async updateOwnerStatus(id, status) {
    return this.request(`/api/users/owners/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
  },

  async resetOwnerPassword(id, newPassword) {
    return this.request(`/api/users/owners/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword })
    });
  },

  // Products and inventory endpoints
  async getProducts(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.append('status', params.status);
    if (params.category) query.append('category', params.category);
    if (params.search) query.append('search', params.search);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/api/products${qs}`, { method: 'GET' });
  },

  async getProductStats() {
    return this.request('/api/products/stats', { method: 'GET' });
  },

  async getProduct(id) {
    return this.request(`/api/products/${id}`, { method: 'GET' });
  },

  async createProduct(data) {
    return this.request('/api/products', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async updateProduct(id, data) {
    return this.request(`/api/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async adjustStock(id, data) {
    return this.request(`/api/products/${id}/adjust`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async archiveProduct(id) {
    return this.request(`/api/products/${id}/archive`, {
      method: 'DELETE'
    });
  },

  // Product media endpoints
  async getProductMedia(productId) {
    return this.request(`/api/products/${productId}/media`, { method: 'GET' });
  },

  async uploadProductMedia(productId, formData) {
    const token = this.getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/products/${productId}/media`, {
      method: 'POST',
      headers,
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Upload failed');
    return data;
  },

  async setPrimaryMedia(productId, mediaId) {
    return this.request(`/api/products/${productId}/media/${mediaId}/primary`, {
      method: 'PATCH'
    });
  },

  async deleteProductMedia(productId, mediaId) {
    return this.request(`/api/products/${productId}/media/${mediaId}`, {
      method: 'DELETE'
    });
  },

  // Purchase orders and movement logs endpoints
  async getPurchases() {
    return this.request('/api/purchases', { method: 'GET' });
  },

  async getPurchase(id) {
    return this.request(`/api/purchases/${id}`, { method: 'GET' });
  },

  async createPurchase(data) {
    return this.request('/api/purchases', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async getInventoryMovements(params = {}) {
    const query = new URLSearchParams();
    if (params.productId) query.append('productId', params.productId);
    if (params.movementType) query.append('movementType', params.movementType);
    if (params.limit) query.append('limit', params.limit);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/api/purchases/movements/all${qs}`, { method: 'GET' });
  },

  // Sales endpoints
  async getSales(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.append('status', params.status);
    if (params.paymentStatus) query.append('paymentStatus', params.paymentStatus);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/api/sales${qs}`, { method: 'GET' });
  },

  async getSale(id) {
    return this.request(`/api/sales/${id}`, { method: 'GET' });
  },

  async createSale(data) {
    return this.request('/api/sales', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async cancelSale(id, cancellationReason) {
    return this.request(`/api/sales/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ cancellationReason })
    });
  },

  // Financial ledger and profit engine endpoints
  async getLedgerEntries(params = {}) {
    const query = new URLSearchParams();
    if (params.accountCategory) query.append('accountCategory', params.accountCategory);
    if (params.entryType) query.append('entryType', params.entryType);
    if (params.referenceType) query.append('referenceType', params.referenceType);
    if (params.startDate) query.append('startDate', params.startDate);
    if (params.endDate) query.append('endDate', params.endDate);
    if (params.limit) query.append('limit', params.limit);
    if (params.offset) query.append('offset', params.offset);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/api/ledger${qs}`, { method: 'GET' });
  },

  async getFinancialSummary() {
    return this.request('/api/ledger/summary', { method: 'GET' });
  },

  async recordTraceableAdjustment(data) {
    return this.request('/api/ledger/adjustment', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Profit sharing and reinvestment rules endpoints
  async getActiveProfitRule() {
    return this.request('/api/profit/rules/active', { method: 'GET' });
  },

  async getProfitRulesHistory() {
    return this.request('/api/profit/rules/history', { method: 'GET' });
  },

  async createProfitRule(data) {
    return this.request('/api/profit/rules', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async getProfitAllocations(params = {}) {
    const query = new URLSearchParams();
    if (params.ownerId) query.append('ownerId', params.ownerId);
    if (params.allocationType) query.append('allocationType', params.allocationType);
    if (params.periodMonth) query.append('periodMonth', params.periodMonth);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/api/profit/allocations${qs}`, { method: 'GET' });
  },

  async getReinvestmentReserves() {
    return this.request('/api/profit/reinvestment', { method: 'GET' });
  },

  // Dashboard analytics endpoints
  async getAdminDashboard() {
    return this.request('/api/dashboard/admin', { method: 'GET' });
  },

  async getOwnerDashboard() {
    return this.request('/api/dashboard/owner', { method: 'GET' });
  },

  // Operating Expenses endpoints
  async getExpenses(params = {}) {
    const query = new URLSearchParams();
    if (params.category) query.append('category', params.category);
    if (params.startDate) query.append('startDate', params.startDate);
    if (params.endDate) query.append('endDate', params.endDate);
    if (params.search) query.append('search', params.search);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/api/expenses${qs}`, { method: 'GET' });
  },

  async createExpense(data) {
    return this.request('/api/expenses', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async deleteExpense(id, reason) {
    return this.request(`/api/expenses/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason })
    });
  },

  // Owner Settlements (Payouts) endpoints
  async getSettlements(params = {}) {
    const query = new URLSearchParams();
    if (params.owner_id) query.append('owner_id', params.owner_id);
    if (params.startDate) query.append('startDate', params.startDate);
    if (params.endDate) query.append('endDate', params.endDate);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/api/settlements${qs}`, { method: 'GET' });
  },

  async getOwnerBalances() {
    return this.request('/api/settlements/balances', { method: 'GET' });
  },

  async createSettlement(data) {
    return this.request('/api/settlements', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Owner Capital Investments endpoints
  async getInvestments(params = {}) {
    const query = new URLSearchParams();
    if (params.owner_id) query.append('owner_id', params.owner_id);
    if (params.type) query.append('type', params.type);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/api/investments${qs}`, { method: 'GET' });
  },

  async createInvestment(data) {
    return this.request('/api/investments', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Audit Logs endpoints (Super Admin)
  async getAuditLogs(params = {}) {
    const query = new URLSearchParams();
    if (params.action) query.append('action', params.action);
    if (params.entityType) query.append('entityType', params.entityType);
    if (params.userId) query.append('userId', params.userId);
    if (params.startDate) query.append('startDate', params.startDate);
    if (params.endDate) query.append('endDate', params.endDate);
    if (params.limit) query.append('limit', params.limit);
    if (params.offset) query.append('offset', params.offset);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/api/audit-logs${qs}`, { method: 'GET' });
  },

  async getAuditSummary() {
    return this.request('/api/audit-logs/summary', { method: 'GET' });
  },

  // Export endpoints
  async downloadExport(endpoint, defaultFilename = 'export.csv') {
    const token = this.getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(endpoint, { headers });
    if (!res.ok) {
      throw new Error(`Export failed with HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }
};

window.API = API;
