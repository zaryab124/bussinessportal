const express = require('express');
const router = express.Router();
const saleController = require('../controllers/saleController');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// Read sales (Super Admin and Business Owners)
router.get('/', authMiddleware, saleController.listSales);
router.get('/:id', authMiddleware, saleController.getSaleById);

// Record confirmed sale (Super Admin only)
router.post('/', authMiddleware, requireRole('super_admin'), saleController.createSale);

// Cancel sale with inventory restoration (Super Admin only)
router.post('/:id/cancel', authMiddleware, requireRole('super_admin'), saleController.cancelSale);

module.exports = router;
