const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { getAuditLogs, getAuditSummary } = require('../controllers/auditController');

// All audit routes strictly restricted to Super Admin
router.use(authMiddleware);
router.use(requireRole('super_admin'));

router.get('/', getAuditLogs);
router.get('/summary', getAuditSummary);

module.exports = router;
