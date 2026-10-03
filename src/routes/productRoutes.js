const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// Read routes: Accessible to both Super Admin and Business Owners
router.get('/', authMiddleware, productController.listProducts);
router.get('/stats', authMiddleware, productController.getProductStats);
router.get('/:id', authMiddleware, productController.getProductById);

// Modification routes: Super Admin only
router.post('/', authMiddleware, requireRole('super_admin'), productController.createProduct);
router.put('/:id', authMiddleware, requireRole('super_admin'), productController.updateProduct);
router.post('/:id/adjust', authMiddleware, requireRole('super_admin'), productController.adjustStock);
router.delete('/:id/archive', authMiddleware, requireRole('super_admin'), productController.archiveProduct);

module.exports = router;
