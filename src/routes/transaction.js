const express = require('express');
const router = express.Router();
const TransactionController = require('../controllers/transactionController');

// GET /api/transaction/list?wallet=address - Get transactions for wallet
router.get('/list', async (req, res) => {
    await TransactionController.getTransactions(req, res);
});

// POST /api/transaction/mock - Create mock transactions for testing
router.post('/mock', async (req, res) => {
    await TransactionController.createMockTransactions(req, res);
});

module.exports = router;