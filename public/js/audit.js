/**
 * Audit Logs Frontend Module (Phase 10)
 */
const AuditModule = {
  currentLogs: [],

  init() {
    const navAudit = document.getElementById('nav-audit');
    if (navAudit) {
      navAudit.addEventListener('click', (e) => {
        e.preventDefault();
        this.showAuditView();
      });
    }

    const filterAction = document.getElementById('audit-filter-action');
    if (filterAction) {
      filterAction.addEventListener('change', () => this.loadAuditLogs());
    }

    const filterEntity = document.getElementById('audit-filter-entity');
    if (filterEntity) {
      filterEntity.addEventListener('change', () => this.loadAuditLogs());
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

  showAuditView() {
    this.hideAllPanels();
    document.getElementById('nav-audit')?.classList.add('active');
    document.getElementById('audit-panel')?.classList.remove('hidden');

    this.loadAuditSummary();
    this.loadAuditLogs();
  },

  async loadAuditSummary() {
    try {
      const res = await API.getAuditSummary();
      const topActionsEl = document.getElementById('audit-top-actions');
      if (topActionsEl && res.topActions) {
        topActionsEl.innerHTML = res.topActions.slice(0, 5).map(a => `
          <span class="badge" style="background: rgba(255,255,255,0.06); padding: 4px 10px; border-radius: 20px; font-size: 0.8rem; margin-right: 6px;">
            <code>${a.action}</code>: ${a.count}
          </span>
        `).join('');
      }
    } catch (err) {
      console.error('[AuditModule] Summary error:', err);
    }
  },

  async loadAuditLogs() {
    const tableBody = document.getElementById('audit-table-body');
    if (!tableBody) return;

    const action = document.getElementById('audit-filter-action')?.value || '';
    const entityType = document.getElementById('audit-filter-entity')?.value || '';

    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px;">Loading immutable audit trail...</td></tr>`;

    try {
      const res = await API.getAuditLogs({ action, entityType });
      const logs = res.logs || [];
      this.currentLogs = logs;

      const totalCountEl = document.getElementById('audit-kpi-count');
      if (totalCountEl) totalCountEl.textContent = res.totalCount || 0;

      if (logs.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--text-secondary);">No audit log entries recorded.</td></tr>`;
        return;
      }

      tableBody.innerHTML = logs.map(log => `
        <tr>
          <td><small style="color: var(--text-muted);">${new Date(log.created_at).toLocaleString()}</small></td>
          <td>
            <strong>${log.actor_name || 'System / Unauth'}</strong><br>
            <small style="color: var(--text-muted);">${log.actor_email || '-'}</small>
          </td>
          <td><span class="badge" style="background: rgba(147, 51, 234, 0.2); color: #c084fc; font-weight: 600;">${log.action}</span></td>
          <td>
            <span style="font-weight: 600; text-transform: capitalize;">${log.entity_type}</span>
            ${log.entity_id ? `<br><small style="color: var(--text-muted);">ID: ${log.entity_id}</small>` : ''}
          </td>
          <td><small style="color: var(--text-muted);">${log.ip_address || '127.0.0.1'}</small></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="AuditModule.openPayloadModal(${log.id})">
              Inspect
            </button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('[AuditModule] Load logs error:', err);
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: #ef4444;">Failed to load audit logs: ${err.message}</td></tr>`;
    }
  },

  openPayloadModal(logId) {
    const log = this.currentLogs.find(l => l.id === logId);
    if (!log) return;

    const modal = document.getElementById('modal-audit-payload');
    if (!modal) return;

    document.getElementById('audit-modal-title').textContent = `${log.action} (ID #${log.id})`;
    document.getElementById('audit-modal-actor').textContent = `${log.actor_name || 'System'} (${log.actor_role || '-'})`;
    document.getElementById('audit-modal-time').textContent = new Date(log.created_at).toLocaleString();

    const oldEl = document.getElementById('audit-modal-old-values');
    const newEl = document.getElementById('audit-modal-new-values');

    oldEl.textContent = log.old_values ? JSON.stringify(log.old_values, null, 2) : 'None';
    newEl.textContent = log.new_values ? JSON.stringify(log.new_values, null, 2) : 'None';

    modal.classList.remove('hidden');
  }
};

window.AuditModule = AuditModule;

document.addEventListener('DOMContentLoaded', () => {
  AuditModule.init();
});
