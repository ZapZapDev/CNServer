const express = require('express');
const router = express.Router();
const WalletController = require('../controllers/walletController');

// POST /api/wallet/save - Save wallet address
router.post('/save', async (req, res) => {
    await WalletController.saveWallet(req, res);
});

// GET /api/wallet/list - Get all saved wallets
router.get('/list', async (req, res) => {
    await WalletController.getWallets(req, res);
});

// GET /api/wallet/stats - Get wallet statistics
router.get('/stats', async (req, res) => {
    await WalletController.getStats(req, res);
});

module.exports = router;