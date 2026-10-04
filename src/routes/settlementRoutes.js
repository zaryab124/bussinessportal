const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const {
  createSettlement,
  getSettlements,
  getOwnerBalances
} = require('../controllers/settlementController');

// All settlement routes require authentication
router.use(authMiddleware);

// Get settlements (isolated per owner for business owners, all for admin)
router.get('/', getSettlements);

// Get balances (own balance for business owner, all owners for admin)
router.get('/balances', getOwnerBalances);

// Only Super Admin can record settlements (payouts)
router.post('/', requireRole('super_admin'), createSettlement);

module.exports = router;
