const { query } = require('../config/db');
const { comparePassword, hashPassword, generateToken } = require('../utils/security');
const { logAudit } = require('../utils/auditLogger');

async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.'
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const userRes = await query(
      'SELECT id, email, password_hash, full_name, role, status FROM users WHERE email = $1',
      [cleanEmail]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials provided.'
      });
    }

    const user = userRes.rows[0];

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: `Account is ${user.status}. Please contact an administrator.`
      });
    }

    const isMatch = await comparePassword(password, user.password_hash);
    if (!isMatch) {
      await logAudit({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entityType: 'users',
        entityId: user.id,
        newValues: { reason: 'Incorrect password' },
        req
      });

      return res.status(401).json({
        success: false,
        message: 'Invalid credentials provided.'
      });
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role
    });

    await logAudit({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      entityType: 'users',
      entityId: user.id,
      newValues: { email: user.email, role: user.role },
      req
    });

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        status: user.status
      }
    });
  } catch (err) {
    console.error('[Login Controller Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.'
    });
  }
}

async function getMe(req, res) {
  try {
    const permRes = await query(
      'SELECT permission FROM roles_permissions WHERE role = $1',
      [req.user.role]
    );

    const permissions = permRes.rows.map(r => r.permission);

    return res.json({
      success: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        fullName: req.user.full_name,
        role: req.user.role,
        status: req.user.status,
        permissions
      }
    });
  } catch (err) {
    console.error('[GetMe Controller Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Unable to retrieve user session details.'
    });
  }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required.'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long.'
      });
    }

    const userRes = await query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    const user = userRes.rows[0];
    const isMatch = await comparePassword(currentPassword, user.password_hash);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Existing password does not match.'
      });
    }

    const newHash = await hashPassword(newPassword);

    await query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newHash, req.user.id]
    );

    await logAudit({
      userId: req.user.id,
      action: 'PASSWORD_CHANGED',
      entityType: 'users',
      entityId: req.user.id,
      req
    });

    return res.json({
      success: true,
      message: 'Password changed successfully.'
    });
  } catch (err) {
    console.error('[ChangePassword Controller Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update password.'
    });
  }
}

async function logout(req, res) {
  try {
    if (req.user) {
      await logAudit({
        userId: req.user.id,
        action: 'LOGOUT',
        entityType: 'users',
        entityId: req.user.id,
        req
      });
    }
    return res.json({
      success: true,
      message: 'Logged out successfully.'
    });
  } catch (err) {
    console.error('[Logout Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Error during logout.'
    });
  }
}

module.exports = {
  login,
  getMe,
  changePassword,
  logout
};
