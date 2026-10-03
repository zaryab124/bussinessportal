// Authentication and Session UI Handler
document.addEventListener('DOMContentLoaded', async () => {
  const authSection = document.getElementById('auth-section');
  const dashboardSection = document.getElementById('dashboard-section');
  const loginForm = document.getElementById('login-form');
  const loginAlert = document.getElementById('login-alert');
  const logoutBtn = document.getElementById('logout-btn');
  const userFullNameEl = document.getElementById('user-full-name');
  const userRoleBadgeEl = document.getElementById('user-role-badge');
  const adminView = document.getElementById('admin-view');
  const ownerView = document.getElementById('owner-view');

  function showAlert(msg, type = 'danger') {
    loginAlert.className = `alert alert-${type}`;
    loginAlert.textContent = msg;
    loginAlert.classList.remove('hidden');
  }

  function hideAlert() {
    loginAlert.classList.add('hidden');
    loginAlert.textContent = '';
  }

  function renderSession(user) {
    authSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');

    userFullNameEl.textContent = user.fullName || user.email;
    userRoleBadgeEl.textContent = user.role === 'super_admin' ? 'Super Admin' : 'Business Owner';
    userRoleBadgeEl.className = `badge-role ${user.role}`;

    if (user.role === 'super_admin') {
      adminView.classList.remove('hidden');
      ownerView.classList.add('hidden');
      document.getElementById('role-notice').textContent = 'Administrator Portal - Full Access to Inventory, Sales, Finances, and Audit Logs.';
    } else {
      adminView.classList.add('hidden');
      ownerView.classList.remove('hidden');
      document.getElementById('role-notice').textContent = `Owner Private Dashboard - Authorized access for ${user.fullName}.`;
    }
  }

  function renderLoggedOut() {
    dashboardSection.classList.add('hidden');
    authSection.classList.remove('hidden');
    hideAlert();
  }

  // Check existing session
  const token = API.getToken();
  if (token) {
    try {
      const res = await API.getMe();
      if (res.success && res.user) {
        API.setUser(res.user);
        renderSession(res.user);
      } else {
        API.clearSession();
        renderLoggedOut();
      }
    } catch (err) {
      API.clearSession();
      renderLoggedOut();
    }
  } else {
    renderLoggedOut();
  }

  // Handle Login submission
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();

      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;

      const submitBtn = loginForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Authenticating...';

      try {
        const res = await API.login(email, password);
        if (res.success && res.token) {
          API.setToken(res.token);
          API.setUser(res.user);
          renderSession(res.user);
        } else {
          showAlert(res.message || 'Login failed.');
        }
      } catch (err) {
        showAlert(err.message || 'Authentication error.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    });
  }

  // Quick fill buttons for testing/demo
  window.fillLogin = (email, pass) => {
    document.getElementById('login-email').value = email;
    document.getElementById('login-password').value = pass;
    hideAlert();
  };

  // Handle Logout
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await API.logout();
      renderLoggedOut();
    });
  }

  // Global listener for session expiry
  window.addEventListener('auth:expired', () => {
    renderLoggedOut();
    showAlert('Session expired. Please sign in again.', 'warning');
  });
});
