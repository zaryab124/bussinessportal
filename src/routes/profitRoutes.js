const express = require('express');
const router = express.Router();
const profitController = require('../controllers/profitController');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// Read profit rules and allocations
router.get('/rules/active', authMiddleware, profitController.getActiveRule);
router.get('/rules/history', authMiddleware, profitController.getRuleHistory);
router.get('/allocations', authMiddleware, profitController.getAllocations);
router.get('/reinvestment', authMiddleware, profitController.getReinvestmentReserves);

// Configure new profit allocation rule (Super Admin only)
router.post('/rules', authMiddleware, requireRole('super_admin'), profitController.createRule);

module.exports = router;
