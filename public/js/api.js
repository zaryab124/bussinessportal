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
  }
};

window.API = API;
