const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// List all owners (Super Admin only)
router.get('/owners', authMiddleware, requireRole('super_admin'), userController.listOwners);

// Create new owner (Super Admin only)
router.post('/owners', authMiddleware, requireRole('super_admin'), userController.createOwner);

// Get specific owner (Super Admin or Self)
router.get('/owners/:id', authMiddleware, userController.getOwnerById);

// Update owner details (Super Admin or Self)
router.put('/owners/:id', authMiddleware, userController.updateOwner);

// Update owner status (Super Admin only)
router.patch('/owners/:id/status', authMiddleware, requireRole('super_admin'), userController.updateOwnerStatus);

// Reset owner password (Super Admin only)
router.post('/owners/:id/reset-password', authMiddleware, requireRole('super_admin'), userController.resetOwnerPassword);

module.exports = router;
