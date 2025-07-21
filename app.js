const express = require('express');
const cors = require('cors');
const { Connection, PublicKey } = require('@solana/web3.js');

const app = express();
const PORT = 3001;

// Solana connection - бесплатные RPC с лучшими лимитами
const FREE_RPC_ENDPOINTS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana',
    'https://solana-mainnet.g.alchemy.com/v2/demo',
    'https://mainnet.helius-rpc.com/?api-key=demo'
];

// Выбираем случайный RPC для распределения нагрузки
const SOLANA_RPC = FREE_RPC_ENDPOINTS[Math.floor(Math.random() * FREE_RPC_ENDPOINTS.length)];
console.log(`Using RPC: ${SOLANA_RPC}`);

const connection = new Connection(SOLANA_RPC, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000
});

// CORS
app.use(cors());
app.use(express.json());

// Helper function to format addresses
function formatTransactionAddress(address) {
    if (!address || address === 'Unknown' || address.length < 8) {
        return address;
    }
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

// Get real transactions from Solana mainnet
async function getRealTransactions(walletAddress) {
    try {
        console.log(`Fetching REAL transactions for wallet: ${walletAddress}`);
        console.log(`Using RPC: ${SOLANA_RPC}`);

        const publicKey = new PublicKey(walletAddress);

        // Get signatures (последние 10 транзакций)
        console.log('Getting signatures...');
        const signatures = await connection.getSignaturesForAddress(publicKey, {
            limit: 10,
            commitment: 'confirmed'
        });

        console.log(`Found ${signatures.length} signatures`);

        if (signatures.length === 0) {
            console.log('No transactions found for this wallet');
            return [];
        }

        const transactions = [];

        // Process each transaction with retry logic
        for (let i = 0; i < Math.min(signatures.length, 5); i++) {
            const signatureInfo = signatures[i];

            try {
                console.log(`Processing transaction ${i + 1}/${signatures.length}: ${signatureInfo.signature}`);

                // Retry logic for each transaction
                let tx = null;
                let retries = 3;

                while (retries > 0 && !tx) {
                    try {
                        tx = await connection.getTransaction(signatureInfo.signature, {
                            maxSupportedTransactionVersion: 0,
                            commitment: 'confirmed'
                        });
                        break;
                    } catch (error) {
                        retries--;
                        if (retries > 0) {
                            console.log(`Retry ${3 - retries} for transaction ${signatureInfo.signature}`);
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        } else {
                            throw error;
                        }
                    }
                }

                if (!tx || !tx.meta) {
                    console.log(`Transaction ${signatureInfo.signature} not found or incomplete`);
                    continue;
                }

                // Find wallet's account index
                const accountKeys = tx.transaction.message.accountKeys || tx.transaction.message.staticAccountKeys;
                const walletIndex = accountKeys.findIndex(key => key.toBase58() === walletAddress);

                if (walletIndex === -1) {
                    console.log(`Wallet not found in transaction ${signatureInfo.signature}`);
                    continue;
                }

                // Calculate balance change
                const preBalance = tx.meta.preBalances[walletIndex] || 0;
                const postBalance = tx.meta.postBalances[walletIndex] || 0;
                const balanceChange = (postBalance - preBalance) / 1000000000; // Convert lamports to SOL

                console.log(`Transaction ${signatureInfo.signature}: ${balanceChange} SOL change`);

                // Skip very small changes (dust/fees)
                if (Math.abs(balanceChange) < 0.0001) {
                    console.log(`Skipping dust transaction: ${balanceChange} SOL`);
                    continue;
                }

                // Determine other party address
                let otherAddress = 'Unknown';
                if (accountKeys.length > 1) {
                    // Get the other main account that's not our wallet
                    const otherKey = accountKeys.find(key => key.toBase58() !== walletAddress);
                    if (otherKey) {
                        otherAddress = otherKey.toBase58();
                    }
                }

                const transaction = {
                    id: signatureInfo.signature,
                    wallet: walletAddress,
                    type: balanceChange > 0 ? 'received' : 'sent',
                    amount: Math.abs(balanceChange).toFixed(6),
                    token: 'SOL',
                    address: formatTransactionAddress(otherAddress),
                    timestamp: new Date((signatureInfo.blockTime || Date.now() / 1000) * 1000).toISOString(),
                    signature: signatureInfo.signature
                };

                transactions.push(transaction);
                console.log(`Added transaction: ${transaction.type} ${transaction.amount} SOL`);

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 300));

            } catch (error) {
                console.error(`Error processing transaction ${signatureInfo.signature}:`, error.message);
                continue;
            }
        }

        // Sort by timestamp (newest first)
        transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        console.log(`Successfully processed ${transactions.length} real transactions`);
        return transactions;

    } catch (error) {
        console.error('Error fetching real transactions:', error);

        // If all else fails, return empty array
        return [];
    }
}

// Routes
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'CNServer is running!',
        timestamp: new Date().toISOString()
    });
});

// Get transactions
app.get('/api/transaction/list', async (req, res) => {
    try {
        const { wallet } = req.query;

        if (!wallet) {
            return res.status(400).json({
                success: false,
                error: 'Wallet address is required'
            });
        }

        // Get real transactions from Solana
        const transactions = await getRealTransactions(wallet);

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
});

// Mock endpoint (for testing if needed)
app.post('/api/transaction/mock', async (req, res) => {
    res.json({
        success: true,
        message: 'Using real transactions now, mock not needed'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`
🚀 CNServer Started Successfully!
🌐 Server URL: http://localhost:${PORT}

Available Endpoints:
- GET  /                      - Server info
- GET  /api/transaction/list  - Get transactions 
- POST /api/transaction/mock  - Create mock transactions

Ready to accept requests!
    `);
});

module.exports = app;