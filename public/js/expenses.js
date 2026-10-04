/**
 * Expenses Management Frontend Module (Phase 10)
 */
const ExpensesModule = {
  selectedExpenseId: null,

  init() {
    const navExpenses = document.getElementById('nav-expenses');
    if (navExpenses) {
      navExpenses.addEventListener('click', (e) => {
        e.preventDefault();
        this.showExpensesView();
      });
    }

    const filterCategory = document.getElementById('expense-filter-category');
    if (filterCategory) {
      filterCategory.addEventListener('change', () => this.loadExpenses());
    }

    const filterSearch = document.getElementById('expense-filter-search');
    if (filterSearch) {
      filterSearch.addEventListener('input', () => this.loadExpenses());
    }

    const formCreate = document.getElementById('create-expense-form');
    if (formCreate) {
      formCreate.addEventListener('submit', (e) => this.handleCreateExpense(e));
    }

    const formDelete = document.getElementById('delete-expense-form');
    if (formDelete) {
      formDelete.addEventListener('submit', (e) => this.confirmDeleteExpense(e));
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

  showExpensesView() {
    this.hideAllPanels();
    document.getElementById('nav-expenses')?.classList.add('active');
    document.getElementById('expenses-panel')?.classList.remove('hidden');

    const user = API.getUser();
    const isSuperAdmin = user && (user.role === 'super_admin' || user.role === 'business_admin');
    const createBtn = document.getElementById('btn-open-create-expense');
    if (createBtn) {
      createBtn.style.display = isSuperAdmin ? 'inline-block' : 'none';
    }

    this.loadExpenses();
  },

  async loadExpenses() {
    const tableBody = document.getElementById('expenses-table-body');
    if (!tableBody) return;

    const category = document.getElementById('expense-filter-category')?.value || '';
    const search = document.getElementById('expense-filter-search')?.value || '';

    tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px;">Loading operating expenses...</td></tr>`;

    try {
      const res = await API.getExpenses({ category, search });
      const expenses = res.expenses || [];

      // Update KPI widgets
      const totalAmountEl = document.getElementById('expense-kpi-total');
      if (totalAmountEl) totalAmountEl.textContent = `Rs. ${res.totalAmount || '0.00'}`;

      const totalCountEl = document.getElementById('expense-kpi-count');
      if (totalCountEl) totalCountEl.textContent = res.totalCount || 0;

      // Update Category Pills
      const categoryBreakdownEl = document.getElementById('expense-category-breakdown');
      if (categoryBreakdownEl && res.categories) {
        categoryBreakdownEl.innerHTML = res.categories.map(c => `
          <span class="badge" style="background: rgba(255,255,255,0.06); padding: 4px 10px; border-radius: 20px; font-size: 0.8rem; margin-right: 6px;">
            <strong style="text-transform: capitalize;">${c.category}</strong>: Rs. ${c.total}
          </span>
        `).join('');
      }

      if (expenses.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--text-secondary);">No operating expenses recorded yet.</td></tr>`;
        return;
      }

      const user = API.getUser();
      const isSuperAdmin = user && (user.role === 'super_admin' || user.role === 'business_admin');

      tableBody.innerHTML = expenses.map(exp => `
        <tr>
          <td><strong>${exp.expense_code}</strong></td>
          <td><span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; text-transform: capitalize;">${exp.category}</span></td>
          <td style="font-weight: 700; color: #f87171;">Rs. ${exp.amount}</td>
          <td>${new Date(exp.expense_date).toLocaleDateString()}</td>
          <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${exp.description || ''}">
            ${exp.description || '<span style="color: var(--text-muted);">-</span>'}
            ${exp.sale_invoice_number ? `<br><small style="color: var(--accent-color);">Linked Sale: ${exp.sale_invoice_number}</small>` : ''}
          </td>
          <td><small>${exp.recorded_by_name || 'Admin'}</small></td>
          <td>
            ${isSuperAdmin ? `
              <button class="btn btn-secondary btn-sm" style="color: #ef4444;" onclick="ExpensesModule.openDeleteModal(${exp.id}, '${exp.expense_code}')">
                Reverse
              </button>
            ` : '<span style="color: var(--text-muted); font-size: 0.8rem;">View Only</span>'}
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('[ExpensesModule] Load error:', err);
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: #ef4444;">Failed to load expenses: ${err.message}</td></tr>`;
    }
  },

  openCreateModal() {
    const modal = document.getElementById('modal-create-expense');
    if (!modal) return;
    document.getElementById('create-expense-alert')?.classList.add('hidden');
    document.getElementById('exp-category-input').value = 'rent';
    document.getElementById('exp-amount-input').value = '';
    document.getElementById('exp-date-input').value = new Date().toISOString().slice(0, 10);
    document.getElementById('exp-description-input').value = '';
    modal.classList.remove('hidden');
  },

  async handleCreateExpense(e) {
    e.preventDefault();
    const alertEl = document.getElementById('create-expense-alert');
    alertEl?.classList.add('hidden');

    const category = document.getElementById('exp-category-input').value;
    const amount = document.getElementById('exp-amount-input').value;
    const expense_date = document.getElementById('exp-date-input').value;
    const description = document.getElementById('exp-description-input').value;

    try {
      const res = await API.createExpense({
        category,
        amount,
        expense_date,
        description
      });

      if (res.success) {
        document.getElementById('modal-create-expense')?.classList.add('hidden');
        this.loadExpenses();
      } else {
        alertEl.textContent = res.error || 'Failed to record expense.';
        alertEl.classList.remove('hidden');
      }
    } catch (err) {
      alertEl.textContent = err.message;
      alertEl.classList.remove('hidden');
    }
  },

  openDeleteModal(id, code) {
    this.selectedExpenseId = id;
    const modal = document.getElementById('modal-delete-expense');
    if (!modal) return;
    document.getElementById('delete-expense-alert')?.classList.add('hidden');
    document.getElementById('delete-expense-code-display').textContent = code;
    document.getElementById('delete-expense-reason-input').value = '';
    modal.classList.remove('hidden');
  },

  async confirmDeleteExpense(e) {
    e.preventDefault();
    if (!this.selectedExpenseId) return;

    const alertEl = document.getElementById('delete-expense-alert');
    alertEl?.classList.add('hidden');
    const reason = document.getElementById('delete-expense-reason-input').value;

    try {
      const res = await API.deleteExpense(this.selectedExpenseId, reason);
      if (res.success) {
        document.getElementById('modal-delete-expense')?.classList.add('hidden');
        this.selectedExpenseId = null;
        this.loadExpenses();
      } else {
        alertEl.textContent = res.error || 'Failed to reverse expense.';
        alertEl.classList.remove('hidden');
      }
    } catch (err) {
      alertEl.textContent = err.message;
      alertEl.classList.remove('hidden');
    }
  }
};

window.ExpensesModule = ExpensesModule;

document.addEventListener('DOMContentLoaded', () => {
  ExpensesModule.init();
});
