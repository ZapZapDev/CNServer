const transactionService = require('../services/transactionService');

class TransactionController {
    static async getTransactions(req, res) {
        try {
            const { wallet } = req.query;

            if (!wallet) {
                return res.status(400).json({
                    success: false,
                    error: 'Wallet address is required'
                });
            }

            const transactions = await transactionService.getTransactions(wallet);

            res.json({
                success: true,
                data: {
                    transactions,
                    count: transactions.length
                }
            });

        } catch (error) {
            console.error('Get transactions error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve transactions'
            });
        }
    }

    static async createMockTransactions(req, res) {
        try {
            const { wallet } = req.body;

            if (!wallet) {
                return res.status(400).json({
                    success: false,
                    error: 'Wallet address is required'
                });
            }

            await transactionService.createMockTransactions(wallet);

            res.json({
                success: true,
                message: 'Mock transactions created'
            });

        } catch (error) {
            console.error('Create mock transactions error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create mock transactions'
            });
        }
    }
}

module.exports = TransactionController;