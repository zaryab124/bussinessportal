// Owner Accounts Management Controller for Admin Dashboard
const OwnersModule = {
  owners: [],

  async init() {
    const user = API.getUser();
    if (!user || user.role !== 'super_admin') return;

    this.bindEvents();
    await this.loadOwners();
  },

  bindEvents() {
    // Nav switch
    const navOwners = document.getElementById('nav-owners');
    if (navOwners) {
      navOwners.addEventListener('click', (e) => {
        e.preventDefault();
        this.showView();
      });
    }

    const navOverview = document.getElementById('nav-overview');
    if (navOverview) {
      navOverview.addEventListener('click', (e) => {
        e.preventDefault();
        this.hideView();
      });
    }

    // Create Owner form
    const createForm = document.getElementById('create-owner-form');
    if (createForm) {
      createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleCreateOwner();
      });
    }
  },

  showView() {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById('nav-owners')?.classList.add('active');
    
    document.getElementById('admin-overview-panel')?.classList.add('hidden');
    document.getElementById('inventory-management-panel')?.classList.add('hidden');
    document.getElementById('purchases-panel')?.classList.add('hidden');
    document.getElementById('movements-panel')?.classList.add('hidden');
    document.getElementById('sales-panel')?.classList.add('hidden');
    document.getElementById('reports-panel')?.classList.add('hidden');
    document.getElementById('profit-panel')?.classList.add('hidden');
    document.getElementById('owners-management-panel')?.classList.remove('hidden');
    this.loadOwners();
  },

  hideView() {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById('nav-overview')?.classList.add('active');

    document.getElementById('owners-management-panel')?.classList.add('hidden');
    document.getElementById('admin-overview-panel')?.classList.remove('hidden');
  },

  async loadOwners() {
    const tableBody = document.getElementById('owners-table-body');
    if (!tableBody) return;

    try {
      tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 24px;">Loading accounts...</td></tr>';
      const res = await API.getOwners();
      if (!res.success || !res.owners) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--danger-color);">Failed to load owners.</td></tr>';
        return;
      }

      this.owners = res.owners;
      this.renderTable();
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger-color);">${err.message}</td></tr>`;
    }
  },

  renderTable() {
    const tableBody = document.getElementById('owners-table-body');
    if (!tableBody) return;

    if (this.owners.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 24px;">No business owners configured yet.</td></tr>';
      return;
    }

    tableBody.innerHTML = this.owners.map(o => {
      const statusBadge = o.status === 'active'
        ? '<span class="badge-status status-active">Active</span>'
        : o.status === 'suspended'
        ? '<span class="badge-status status-suspended">Suspended</span>'
        : '<span class="badge-status status-deactivated">Deactivated</span>';

      const createdDate = new Date(o.created_at).toLocaleDateString();

      return `
        <tr>
          <td style="font-weight: 600;">#${o.id}</td>
          <td>
            <div style="font-weight: 600;">${o.full_name}</div>
            <small style="color: var(--text-muted);">${o.email}</small>
          </td>
          <td>${o.phone || '<span style="color: var(--text-muted);">None</span>'}</td>
          <td>${statusBadge}</td>
          <td>${createdDate}</td>
          <td>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary btn-sm" onclick="OwnersModule.openEdit(${o.id})">Edit</button>
              <button class="btn btn-secondary btn-sm" onclick="OwnersModule.toggleStatus(${o.id}, '${o.status}')">
                ${o.status === 'active' ? 'Suspend' : 'Activate'}
              </button>
              <button class="btn btn-secondary btn-sm" onclick="OwnersModule.openResetPassword(${o.id})">Reset Pass</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  async handleCreateOwner() {
    const alertEl = document.getElementById('create-owner-alert');
    alertEl.classList.add('hidden');

    const email = document.getElementById('new-owner-email').value.trim();
    const fullName = document.getElementById('new-owner-name').value.trim();
    const phone = document.getElementById('new-owner-phone').value.trim();
    const password = document.getElementById('new-owner-password').value;

    try {
      const res = await API.createOwner({ email, fullName, phone, password });
      if (res.success) {
        document.getElementById('create-owner-form').reset();
        document.getElementById('modal-create-owner').classList.add('hidden');
        await this.loadOwners();
      } else {
        alertEl.textContent = res.message || 'Error creating owner.';
        alertEl.classList.remove('hidden');
      }
    } catch (err) {
      alertEl.textContent = err.message || 'Server error.';
      alertEl.classList.remove('hidden');
    }
  },

  async toggleStatus(id, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    if (!confirm(`Are you sure you want to mark this account as ${newStatus}?`)) return;

    try {
      await API.updateOwnerStatus(id, newStatus);
      await this.loadOwners();
    } catch (err) {
      alert(`Error updating status: ${err.message}`);
    }
  },

  openEdit(id) {
    const owner = this.owners.find(o => o.id === id);
    if (!owner) return;

    const modal = document.getElementById('modal-edit-owner');
    document.getElementById('edit-owner-id').value = owner.id;
    document.getElementById('edit-owner-name').value = owner.full_name;
    document.getElementById('edit-owner-phone').value = owner.phone || '';
    modal.classList.remove('hidden');
  },

  async handleUpdateOwner(e) {
    e.preventDefault();
    const id = document.getElementById('edit-owner-id').value;
    const fullName = document.getElementById('edit-owner-name').value.trim();
    const phone = document.getElementById('edit-owner-phone').value.trim();

    try {
      await API.updateOwner(id, { fullName, phone });
      document.getElementById('modal-edit-owner').classList.add('hidden');
      await this.loadOwners();
    } catch (err) {
      alert(`Error updating owner: ${err.message}`);
    }
  },

  openResetPassword(id) {
    const newPass = prompt('Enter a new password for this business owner (min 8 chars):');
    if (!newPass) return;
    if (newPass.length < 8) {
      alert('Password must be at least 8 characters long.');
      return;
    }

    API.resetOwnerPassword(id, newPass)
      .then(() => alert('Password reset successfully.'))
      .catch(err => alert(`Error: ${err.message}`));
  }
};

window.OwnersModule = OwnersModule;
document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('user:authenticated', () => {
    OwnersModule.init();
  });
});
