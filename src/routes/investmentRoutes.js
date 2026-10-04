const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const {
  createInvestment,
  getInvestments
} = require('../controllers/investmentController');

router.use(authMiddleware);

// Get investments (owner-isolated for business owners, all for admin)
router.get('/', getInvestments);

// Only Super Admin can record capital investments
router.post('/', requireRole('super_admin'), createInvestment);

module.exports = router;
