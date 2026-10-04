const express = require('express');
const router = express.Router();
const ledgerController = require('../controllers/ledgerController');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// Read financial ledger and metrics (Super Admin and Business Owners)
router.get('/', authMiddleware, ledgerController.getLedgerEntries);
router.get('/summary', authMiddleware, ledgerController.getFinancialSummary);

// Record traceable ledger adjustment (Super Admin only)
router.post('/adjustment', authMiddleware, requireRole('super_admin'), ledgerController.recordTraceableAdjustment);
router.post('/adjustments', authMiddleware, requireRole('super_admin'), ledgerController.recordTraceableAdjustment);

module.exports = router;
