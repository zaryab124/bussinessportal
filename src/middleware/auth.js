const { verifyToken } = require('../utils/security');
const { query } = require('../config/db');

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. No token provided.'
      });
    }

    const token = authHeader.substring(7).trim();
    const decoded = verifyToken(token);

    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session token.'
      });
    }

    const userRes = await query(
      'SELECT id, email, full_name, role, status FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User account not found.'
      });
    }

    const user = userRes.rows[0];

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: `Account is ${user.status}. Please contact an administrator.`
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('[AuthMiddleware Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Authentication verification failure.'
    });
  }
}

module.exports = authMiddleware;
