const express = require('express');
const router = express.Router();
const purchaseController = require('../controllers/purchaseController');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// Read purchases (Admin and Business Owners)
router.get('/', authMiddleware, purchaseController.listPurchases);
router.get('/movements/all', authMiddleware, purchaseController.listMovements);
router.get('/:id', authMiddleware, purchaseController.getPurchaseById);

// Create purchase order (Super Admin only)
router.post('/', authMiddleware, requireRole('super_admin'), purchaseController.createPurchase);

module.exports = router;
