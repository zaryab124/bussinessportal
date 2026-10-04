const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// Super Admin business dashboard
router.get('/admin', authMiddleware, requireRole('super_admin'), dashboardController.getAdminDashboardStats);

// Business Owner private financial dashboard
router.get('/owner', authMiddleware, requireRole('business_owner'), dashboardController.getOwnerDashboardStats);

module.exports = router;
