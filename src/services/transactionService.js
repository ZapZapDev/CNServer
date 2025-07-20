const fs = require('fs').promises;
const path = require('path');

class TransactionService {
    constructor() {
        this.transactionsFile = path.join(__dirname, '../data/transactions.json');
        this.dataDir = path.join(__dirname, '../data');
    }

    async ensureDataDirectory() {
        try {
            await fs.access(this.dataDir);
        } catch (error) {
            await fs.mkdir(this.dataDir, { recursive: true });
        }
    }

    async saveTransaction(transactionData) {
        try {
            await this.ensureDataDirectory();

            let transactions = [];
            try {
                const data = await fs.readFile(this.transactionsFile, 'utf8');
                transactions = JSON.parse(data);
            } catch (error) {
                transactions = [];
            }

            const transaction = {
                id: Date.now().toString(),
                wallet: transactionData.wallet,
                type: transactionData.type, // 'sent' or 'received'
                amount: transactionData.amount,
                token: transactionData.token, // 'SOL' or 'USDC'
                address: transactionData.address, // from/to address
                signature: transactionData.signature || null,
                timestamp: new Date().toISOString(),
                ...transactionData
            };

            transactions.unshift(transaction);
            await fs.writeFile(this.transactionsFile, JSON.stringify(transactions, null, 2));

            return { success: true, transaction };
        } catch (error) {
            throw new Error('Failed to save transaction');
        }
    }

    async getTransactions(wallet) {
        try {
            await this.ensureDataDirectory();
            const data = await fs.readFile(this.transactionsFile, 'utf8');
            const transactions = JSON.parse(data);

            return transactions.filter(tx => tx.wallet === wallet);
        } catch (error) {
            return [];
        }
    }

    // Mock some transactions for testing
    async createMockTransactions(wallet) {
        const mockTransactions = [
            {
                wallet,
                type: 'received',
                amount: 5.0,
                token: 'USDC',
                address: 'Cpr9..6MfH',
                timestamp: new Date(Date.now() - 86400000 * 10).toISOString() // 10 days ago
            },
            {
                wallet,
                type: 'received',
                amount: 0.00001,
                token: 'SOL',
                address: 'Cpr9..mVU',
                timestamp: new Date(Date.now() - 86400000 * 10).toISOString()
            },
            {
                wallet,
                type: 'sent',
                amount: 6.4,
                token: 'POL',
                address: '0x13d4..c138',
                timestamp: new Date(Date.now() - 86400000 * 11).toISOString()
            },
            {
                wallet,
                type: 'received',
                amount: 0.03017,
                token: 'SOL',
                address: '5YhL..p29w',
                timestamp: new Date(Date.now() - 86400000 * 11).toISOString()
            },
            {
                wallet,
                type: 'sent',
                amount: 0.03336,
                token: 'SOL',
                address: '+127..FA..',
                timestamp: new Date(Date.now() - 86400000 * 16).toISOString()
            }
        ];

        for (const tx of mockTransactions) {
            await this.saveTransaction(tx);
        }
    }
}

module.exports = new TransactionService();