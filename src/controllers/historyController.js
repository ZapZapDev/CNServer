const historyService = require('../services/historyService');
const { PublicKey } = require('@solana/web3.js');

const getHistory = async (req, res) => {
    const { wallet, page = 1, limit = 30 } = req.query;

    if (!wallet) {
        return res.status(400).json({ error: 'Wallet required' });
    }

    try {
        new PublicKey(wallet);
    } catch {
        return res.status(400).json({ error: 'Invalid wallet' });
    }

    try {
        const result = await historyService.getWalletHistory(
            wallet,
            parseInt(page),
            parseInt(limit)
        );
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch history' });
    }
};

module.exports = {
    getHistory
};