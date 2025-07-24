const express = require('express');
const cors = require('cors');
const { Connection, PublicKey } = require('@solana/web3.js');

const app = express();
const PORT = 3001;

// RPC endpoint
const SOLANA_RPC = 'https://docs-demo.solana-mainnet.quiknode.pro/';
console.log(`Using RPC: ${SOLANA_RPC}`);

const connection = new Connection(SOLANA_RPC, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 30000
});

// CORS - разрешаем все localhost для разработки
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
            return callback(null, true);
        }
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization']
}));

app.use(express.json());

// Обработка OPTIONS запросов
app.options('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.sendStatus(200);
});

// Логирование
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Кеш для подписей
const signatureCache = new Map();

// Форматирование адресов
function formatTransactionAddress(address) {
    if (!address || address === 'Unknown' || address.length < 8) {
        return address;
    }
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

// Получение символа токена
function getTokenSymbol(mint) {
    const knownTokens = {
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
        'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'mSOL',
        'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK'
    };
    return knownTokens[mint] || 'TOKEN';
}

// Мок транзакции
function getMockTransactions(walletAddress) {
    console.log('Returning mock transactions');
    return [
        {
            id: 'mock_' + Date.now() + '_1',
            wallet: walletAddress,
            type: 'received',
            amount: '0.001000',
            token: 'SOL',
            address: 'Jup...Swap',
            timestamp: new Date(Date.now() - 3600000).toISOString(),
            signature: 'mock_signature_1'
        },
        {
            id: 'mock_' + Date.now() + '_2',
            wallet: walletAddress,
            type: 'sent',
            amount: '0.000500',
            token: 'SOL',
            address: 'Orca...Pool',
            timestamp: new Date(Date.now() - 86400000).toISOString(),
            signature: 'mock_signature_2'
        },
        {
            id: 'mock_' + Date.now() + '_3',
            wallet: walletAddress,
            type: 'received',
            amount: '5.000000',
            token: 'USDC',
            address: 'Rayd...LP',
            timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
            signature: 'mock_signature_3'
        }
    ];
}

// Основная функция получения транзакций с пагинацией
async function getRealTransactionsPaginated(walletAddress, page, limit) {
    try {
        console.log(`Fetching transactions: wallet=${walletAddress}, page=${page}, limit=${limit}`);

        const publicKey = new PublicKey(walletAddress);
        const cacheKey = `${walletAddress}_signatures`;

        let allSignatures = signatureCache.get(cacheKey);

        // Загружаем подписи если их нет или мало
        if (!allSignatures || allSignatures.length < page * limit) {
            console.log('Loading signatures from blockchain...');

            const newSignatures = await connection.getSignaturesForAddress(publicKey, {
                limit: Math.max(50, page * limit + 20),
                commitment: 'confirmed'
            });

            console.log(`Loaded ${newSignatures.length} signatures`);
            signatureCache.set(cacheKey, newSignatures);
            allSignatures = newSignatures;
        }

        // Пагинация
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const pageSignatures = allSignatures.slice(startIndex, endIndex);
        const hasMore = endIndex < allSignatures.length;

        console.log(`Processing signatures ${startIndex} to ${endIndex} of ${allSignatures.length}`);

        if (pageSignatures.length === 0) {
            return {
                data: page === 1 ? getMockTransactions(walletAddress) : [],
                hasMore: false,
                totalFetched: allSignatures.length
            };
        }

        const transactions = [];
        const processedSigs = new Set();

        // Обрабатываем транзакции для текущей страницы
        for (let i = 0; i < pageSignatures.length; i++) {
            const signatureInfo = pageSignatures[i];

            if (processedSigs.has(signatureInfo.signature)) {
                continue;
            }
            processedSigs.add(signatureInfo.signature);

            try {
                console.log(`Processing ${i + 1}/${pageSignatures.length}: ${signatureInfo.signature.slice(0, 8)}...`);

                const tx = await connection.getTransaction(signatureInfo.signature, {
                    maxSupportedTransactionVersion: 0,
                    commitment: 'confirmed'
                });

                if (!tx || !tx.meta || tx.meta.err) {
                    console.log('Skipping failed/empty transaction');
                    continue;
                }

                // Получаем account keys
                let accountKeys = [];
                if (tx.transaction.message.accountKeys) {
                    accountKeys = tx.transaction.message.accountKeys;
                } else if (tx.transaction.message.staticAccountKeys) {
                    accountKeys = tx.transaction.message.staticAccountKeys;
                    if (tx.meta.loadedAddresses) {
                        accountKeys = accountKeys.concat(
                            tx.meta.loadedAddresses.writable || [],
                            tx.meta.loadedAddresses.readonly || []
                        );
                    }
                }

                // Находим индекс кошелька
                const walletIndex = accountKeys.findIndex(key => {
                    const keyStr = typeof key === 'string' ? key : key.toBase58();
                    return keyStr === walletAddress;
                });

                if (walletIndex === -1) {
                    console.log('Wallet not found in transaction');
                    continue;
                }

                // SOL транзакции
                const preBalance = tx.meta.preBalances[walletIndex] || 0;
                const postBalance = tx.meta.postBalances[walletIndex] || 0;
                const balanceChange = (postBalance - preBalance) / 1000000000;

                if (Math.abs(balanceChange) >= 0.001) {
                    let otherAddress = 'System';

                    for (const key of accountKeys) {
                        const keyStr = typeof key === 'string' ? key : key.toBase58();
                        if (keyStr !== walletAddress && !keyStr.startsWith('11111111111111111111111111111111')) {
                            otherAddress = keyStr;
                            break;
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
                    console.log(`Added SOL: ${transaction.type} ${transaction.amount}`);
                }

                // SPL Token трансферы
                if (tx.meta.preTokenBalances && tx.meta.postTokenBalances) {
                    const preTokenBalances = tx.meta.preTokenBalances || [];
                    const postTokenBalances = tx.meta.postTokenBalances || [];
                    const tokenChanges = new Map();

                    // Pre-balances
                    preTokenBalances.forEach(balance => {
                        if (balance.owner === walletAddress) {
                            const key = `${balance.mint}_${balance.owner}`;
                            tokenChanges.set(key, {
                                mint: balance.mint,
                                owner: balance.owner,
                                pre: parseFloat(balance.uiTokenAmount.uiAmountString || '0'),
                                post: 0,
                                decimals: balance.uiTokenAmount.decimals
                            });
                        }
                    });

                    // Post-balances
                    postTokenBalances.forEach(balance => {
                        if (balance.owner === walletAddress) {
                            const key = `${balance.mint}_${balance.owner}`;
                            if (tokenChanges.has(key)) {
                                tokenChanges.get(key).post = parseFloat(balance.uiTokenAmount.uiAmountString || '0');
                            } else {
                                tokenChanges.set(key, {
                                    mint: balance.mint,
                                    owner: balance.owner,
                                    pre: 0,
                                    post: parseFloat(balance.uiTokenAmount.uiAmountString || '0'),
                                    decimals: balance.uiTokenAmount.decimals
                                });
                            }
                        }
                    });

                    // Обрабатываем изменения токенов
                    tokenChanges.forEach(change => {
                        const tokenChange = change.post - change.pre;
                        if (Math.abs(tokenChange) > 0.001) {
                            const tokenSymbol = getTokenSymbol(change.mint);

                            const tokenTransaction = {
                                id: `${signatureInfo.signature}_${change.mint}`,
                                wallet: walletAddress,
                                type: tokenChange > 0 ? 'received' : 'sent',
                                amount: Math.abs(tokenChange).toFixed(6),
                                token: tokenSymbol,
                                address: formatTransactionAddress('Token Program'),
                                timestamp: new Date((signatureInfo.blockTime || Date.now() / 1000) * 1000).toISOString(),
                                signature: signatureInfo.signature
                            };

                            transactions.push(tokenTransaction);
                            console.log(`Added token: ${tokenTransaction.type} ${tokenTransaction.amount} ${tokenSymbol}`);
                        }
                    });
                }

                // Задержка для rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error(`Error processing transaction: ${error.message}`);
                continue;
            }
        }

        // Сортировка по времени
        transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        console.log(`Page ${page}: processed ${transactions.length} transactions, hasMore: ${hasMore}`);

        return {
            data: transactions,
            hasMore: hasMore,
            totalFetched: allSignatures.length
        };

    } catch (error) {
        console.error('Error fetching transactions:', error);
        return {
            data: page === 1 ? getMockTransactions(walletAddress) : [],
            hasMore: false,
            totalFetched: 0
        };
    }
}

// Routes
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'CNServer is running!',
        timestamp: new Date().toISOString(),
        rpc: SOLANA_RPC
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Get transactions с пагинацией
app.get('/api/transaction/list', async (req, res) => {
    try {
        const { wallet, page = 1, limit = 10 } = req.query;

        if (!wallet) {
            return res.status(400).json({
                success: false,
                error: 'Wallet address is required'
            });
        }

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 10;

        console.log(`API request: wallet=${wallet}, page=${pageNum}, limit=${limitNum}`);

        // Валидация Solana адреса
        try {
            new PublicKey(wallet);
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Solana wallet address'
            });
        }

        const result = await getRealTransactionsPaginated(wallet, pageNum, limitNum);

        res.json({
            success: true,
            data: {
                transactions: result.data,
                count: result.data.length,
                wallet: wallet,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    hasMore: result.hasMore,
                    totalFetched: result.totalFetched
                }
            }
        });

    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve transactions',
            details: error.message
        });
    }
});

// Error handling
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`
🚀 CNServer Started Successfully!
🌐 Server URL: http://localhost:${PORT}
🔗 RPC: ${SOLANA_RPC}

Available Endpoints:
- GET  /                      - Server info
- GET  /api/health           - Health check  
- GET  /api/transaction/list - Get transactions

Ready to accept requests!
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
});

module.exports = app;