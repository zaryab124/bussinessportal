const express = require('express');
const router = express.Router();
const exportController = require('../controllers/exportController');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// Super Admin full business exports
router.get('/products', authMiddleware, requireRole('super_admin'), exportController.exportProducts);
router.get('/sales', authMiddleware, requireRole('super_admin'), exportController.exportSales);
router.get('/purchases', authMiddleware, requireRole('super_admin'), exportController.exportPurchases);
router.get('/expenses', authMiddleware, requireRole('super_admin'), exportController.exportExpenses);
router.get('/ledger', authMiddleware, requireRole('super_admin'), exportController.exportLedger);
router.get('/settlements', authMiddleware, requireRole('super_admin'), exportController.exportSettlements);

// Owner exports (also accessible to Super Admin) with strict horizontal isolation
router.get('/owner/allocations', authMiddleware, requireRole('business_owner', 'super_admin'), exportController.exportOwnerAllocations);
router.get('/owner/settlements', authMiddleware, requireRole('business_owner', 'super_admin'), exportController.exportOwnerSettlements);

module.exports = router;
