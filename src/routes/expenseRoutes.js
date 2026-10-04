const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const {
  createExpense,
  getExpenses,
  getExpenseById,
  deleteExpense
} = require('../controllers/expenseController');

// All routes require authentication
router.use(authMiddleware);

// Super admin and business owner can view expenses (transparency of business costs)
router.get('/', getExpenses);
router.get('/:id', getExpenseById);

// Only Super Admin can record or delete expenses
router.post('/', requireRole('super_admin'), createExpense);
router.delete('/:id', requireRole('super_admin'), deleteExpense);

module.exports = router;
