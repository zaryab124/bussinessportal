const { query } = require('../config/db');
const { hashPassword } = require('../utils/security');
const { logAudit } = require('../utils/auditLogger');

// List all business owners (Super Admin only)
async function listOwners(req, res) {
  try {
    const result = await query(`
      SELECT id, email, full_name, role, status, phone, created_at, updated_at
      FROM users
      WHERE role = 'business_owner'
      ORDER BY id ASC
    `);

    return res.json({
      success: true,
      owners: result.rows
    });
  } catch (err) {
    console.error('[ListOwners Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve owner accounts.'
    });
  }
}

// Get single owner details (Super Admin or Self only)
async function getOwnerById(req, res) {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) {
      return res.status(400).json({ success: false, message: 'Invalid owner ID.' });
    }

    // Strict account isolation: owners can ONLY access their own account
    if (req.user.role === 'business_owner' && req.user.id !== targetId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You cannot view another owner\'s private account.'
      });
    }

    const result = await query(`
      SELECT id, email, full_name, role, status, phone, created_at, updated_at
      FROM users
      WHERE id = $1 AND role = 'business_owner'
    `, [targetId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Owner account not found.'
      });
    }

    return res.json({
      success: true,
      owner: result.rows[0]
    });
  } catch (err) {
    console.error('[GetOwnerById Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch owner details.'
    });
  }
}

// Create new owner account (Super Admin only)
async function createOwner(req, res) {
  try {
    const { email, password, fullName, phone } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        message: 'Email, initial password, and full name are required.'
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long.'
      });
    }

    // Check email uniqueness
    const existing = await query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'A user account with this email already exists.'
      });
    }

    const passwordHash = await hashPassword(password);

    const insertRes = await query(`
      INSERT INTO users (email, password_hash, full_name, role, status, phone)
      VALUES ($1, $2, $3, 'business_owner', 'active', $4)
      RETURNING id, email, full_name, role, status, phone, created_at
    `, [cleanEmail, passwordHash, String(fullName).trim(), phone ? String(phone).trim() : null]);

    const newOwner = insertRes.rows[0];

    // Audit log
    await logAudit({
      userId: req.user.id,
      action: 'OWNER_CREATED',
      entityType: 'users',
      entityId: newOwner.id,
      newValues: { email: newOwner.email, fullName: newOwner.full_name, role: newOwner.role },
      req
    });

    return res.status(201).json({
      success: true,
      message: 'Owner account created successfully.',
      owner: newOwner
    });
  } catch (err) {
    console.error('[CreateOwner Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to create owner account.'
    });
  }
}

// Update owner details
async function updateOwner(req, res) {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) {
      return res.status(400).json({ success: false, message: 'Invalid owner ID.' });
    }

    // Strict account isolation: owners can ONLY update their own contact details
    if (req.user.role === 'business_owner' && req.user.id !== targetId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You cannot modify another owner\'s account.'
      });
    }

    const { fullName, phone } = req.body;

    const existingRes = await query(
      'SELECT id, email, full_name, phone, role, status FROM users WHERE id = $1 AND role = \'business_owner\'',
      [targetId]
    );

    if (existingRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Owner account not found.' });
    }

    const existing = existingRes.rows[0];
    const updatedName = fullName !== undefined ? String(fullName).trim() : existing.full_name;
    const updatedPhone = phone !== undefined ? String(phone).trim() : existing.phone;

    const updateRes = await query(`
      UPDATE users
      SET full_name = $1, phone = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING id, email, full_name, role, status, phone, updated_at
    `, [updatedName, updatedPhone, targetId]);

    const updated = updateRes.rows[0];

    await logAudit({
      userId: req.user.id,
      action: 'OWNER_UPDATED',
      entityType: 'users',
      entityId: targetId,
      oldValues: { fullName: existing.full_name, phone: existing.phone },
      newValues: { fullName: updated.full_name, phone: updated.phone },
      req
    });

    return res.json({
      success: true,
      message: 'Owner account updated successfully.',
      owner: updated
    });
  } catch (err) {
    console.error('[UpdateOwner Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update owner account.'
    });
  }
}

// Update owner status (Super Admin only: active, suspended, deactivated)
async function updateOwnerStatus(req, res) {
  try {
    const targetId = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (isNaN(targetId)) {
      return res.status(400).json({ success: false, message: 'Invalid owner ID.' });
    }

    const validStatuses = ['active', 'suspended', 'deactivated'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const existingRes = await query(
      'SELECT id, email, status FROM users WHERE id = $1 AND role = \'business_owner\'',
      [targetId]
    );

    if (existingRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Owner account not found.' });
    }

    const existing = existingRes.rows[0];

    await query(`
      UPDATE users
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [status, targetId]);

    await logAudit({
      userId: req.user.id,
      action: 'OWNER_STATUS_CHANGED',
      entityType: 'users',
      entityId: targetId,
      oldValues: { status: existing.status },
      newValues: { status },
      req
    });

    return res.json({
      success: true,
      message: `Owner account status updated to ${status}.`,
      status
    });
  } catch (err) {
    console.error('[UpdateOwnerStatus Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update owner status.'
    });
  }
}

// Reset owner password (Super Admin only)
async function resetOwnerPassword(req, res) {
  try {
    const targetId = parseInt(req.params.id, 10);
    const { newPassword } = req.body;

    if (isNaN(targetId)) {
      return res.status(400).json({ success: false, message: 'Invalid owner ID.' });
    }

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long.'
      });
    }

    const existingRes = await query(
      'SELECT id, email FROM users WHERE id = $1 AND role = \'business_owner\'',
      [targetId]
    );

    if (existingRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Owner account not found.' });
    }

    const passwordHash = await hashPassword(newPassword);

    await query(`
      UPDATE users
      SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [passwordHash, targetId]);

    await logAudit({
      userId: req.user.id,
      action: 'OWNER_PASSWORD_RESET',
      entityType: 'users',
      entityId: targetId,
      req
    });

    return res.json({
      success: true,
      message: 'Owner password has been reset successfully.'
    });
  } catch (err) {
    console.error('[ResetOwnerPassword Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to reset owner password.'
    });
  }
}

module.exports = {
  listOwners,
  getOwnerById,
  createOwner,
  updateOwner,
  updateOwnerStatus,
  resetOwnerPassword
};
