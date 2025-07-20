const { PublicKey } = require('@solana/web3.js');
const fileService = require('../services/fileService');

class WalletController {

    static async saveWallet(req, res) {
        try {
            const { address, source } = req.body;

            if (!address) {
                return res.status(400).json({
                    success: false,
                    error: 'Wallet address is required'
                });
            }

            console.log(`Processing wallet: ${address} from ${source || 'unknown'}`);

            // Validate Solana address
            let isValid = false;
            try {
                const publicKey = new PublicKey(address);
                isValid = PublicKey.isOnCurve(publicKey);
            } catch (error) {
                isValid = false;
            }

            if (!isValid) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid Solana wallet address'
                });
            }

            // Save to file
            const result = await fileService.saveWallet(address, { source });

            res.json({
                success: true,
                message: result.isNew ? 'New wallet saved' : 'Existing wallet updated',
                data: {
                    address,
                    source: source || 'unknown',
                    isNew: result.isNew,
                    timestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            console.error('Wallet save error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to save wallet',
                details: error.message
            });
        }
    }

    static async getWallets(req, res) {
        try {
            const wallets = await fileService.getAllWallets();

            res.json({
                success: true,
                data: {
                    wallets,
                    count: wallets.length
                }
            });

        } catch (error) {
            console.error('Get wallets error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve wallets'
            });
        }
    }

    static async getStats(req, res) {
        try {
            const stats = await fileService.getStats();

            res.json({
                success: true,
                data: stats
            });

        } catch (error) {
            console.error('Stats error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get statistics'
            });
        }
    }
}

module.exports = WalletController;