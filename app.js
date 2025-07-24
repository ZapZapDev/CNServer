const express = require('express');
const cors = require('cors');
const { Connection, PublicKey } = require('@solana/web3.js');

const app = express();
const PORT = 3001;

// АРХИВНЫЕ RPC для максимальной глубины (в порядке приоритета)
const ARCHIVE_RPC_ENDPOINTS = [
    'https://ssc-dao.genesysgo.net',                          // GenesysGo - лучший для архива
    'https://api.mainnet-beta.solana.com',                    // Официальный Solana
    'https://rpc.ankr.com/solana',                           // Ankr архивный
    'https://docs-demo.solana-mainnet.quiknode.pro/',       // QuickNode демо
    'https://solana-api.projectserum.com',                  // Serum
    'https://api.mainnet-beta.solana.com',                  // Backup официальный
];

console.log(`🏛️ ARCHIVE MODE: Using ${ARCHIVE_RPC_ENDPOINTS.length} RPC endpoints for MAXIMUM depth`);

// Создаем connections для всех RPC
const connections = ARCHIVE_RPC_ENDPOINTS.map((endpoint, index) => ({
    connection: new Connection(endpoint, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 15000
    }),
    endpoint,
    index,
    errors: 0,
    success: 0
}));

let currentRpcIndex = 0;

// Функция для получения лучшего RPC
function getBestRPC() {
    // Сортируем по успешности (меньше ошибок = лучше)
    const sorted = [...connections].sort((a, b) => {
        const aRatio = a.success / Math.max(a.errors + a.success, 1);
        const bRatio = b.success / Math.max(b.errors + b.success, 1);
        return bRatio - aRatio;
    });

    return sorted[0];
}

// Функция с автоматическим переключением RPC
async function archiveRequest(requestFn, description = 'request') {
    const maxRetries = connections.length;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const rpc = connections[currentRpcIndex];

        try {
            console.log(`📡 ${description} via RPC ${currentRpcIndex + 1} (${rpc.endpoint.split('/')[2]})`);
            const result = await requestFn(rpc.connection);
            rpc.success++;
            return result;
        } catch (error) {
            rpc.errors++;
            console.log(`❌ RPC ${currentRpcIndex + 1} failed: ${error.message}`);

            // Переключаемся на следующий RPC
            currentRpcIndex = (currentRpcIndex + 1) % connections.length;

            // Небольшая пауза перед повтором
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    throw new Error(`All ${maxRetries} RPC endpoints failed for ${description}`);
}

// CORS
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.options('*', (req, res) => res.sendStatus(200));

// Логирование
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Кеши
const signatureCache = new Map();
const transactionCache = new Map();

// Константы для МАКСИМАЛЬНОЙ глубины
const MAX_SIGNATURES_PER_REQUEST = 1000;
const AGGRESSIVE_BATCH_SIZE = 500;
const MAX_CONCURRENT = 25;

// Известные токены
const KNOWN_TOKENS = {
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'mSOL',
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
    'So11111111111111111111111111111111111111112': 'SOL'
};

// Системные программы
const SYSTEM_PROGRAMS = new Set([
    '11111111111111111111111111111111111111111111',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    'ComputeBudget111111111111111111111111111111',
    'Vote111111111111111111111111111111111111111',
    'Stake11111111111111111111111111111111111111'
]);

function formatAddress(address) {
    if (!address || address.length < 8) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function getTokenSymbol(mint) {
    return KNOWN_TOKENS[mint] || 'TOKEN';
}

// Улучшенный поиск контрагента
function findTransactionCounterparty(accountKeys, walletAddress, instructions, preBalances, postBalances) {
    // Анализ инструкций
    for (const instruction of instructions || []) {
        const accounts = instruction.accounts || [];
        const walletIndex = accountKeys.findIndex(key =>
            (typeof key === 'string' ? key : key.toBase58()) === walletAddress
        );

        if (accounts.includes(walletIndex)) {
            for (const accountIndex of accounts) {
                if (accountIndex < accountKeys.length && accountIndex !== walletIndex) {
                    const accountKey = accountKeys[accountIndex];
                    const accountStr = typeof accountKey === 'string' ? accountKey : accountKey.toBase58();

                    if (!SYSTEM_PROGRAMS.has(accountStr)) {
                        return accountStr;
                    }
                }
            }
        }
    }

    // Анализ изменений балансов
    for (let i = 0; i < accountKeys.length; i++) {
        const accountKey = accountKeys[i];
        const accountStr = typeof accountKey === 'string' ? accountKey : accountKey.toBase58();

        if (accountStr !== walletAddress && !SYSTEM_PROGRAMS.has(accountStr)) {
            const balanceChange = (postBalances[i] || 0) - (preBalances[i] || 0);
            if (Math.abs(balanceChange) > 1000) {
                return accountStr;
            }
        }
    }

    // Первый не-системный аккаунт
    for (const accountKey of accountKeys) {
        const accountStr = typeof accountKey === 'string' ? accountKey : accountKey.toBase58();
        if (accountStr !== walletAddress && !SYSTEM_PROGRAMS.has(accountStr)) {
            return accountStr;
        }
    }

    return 'Unknown';
}

// Обработка транзакции
async function processTransaction(signatureInfo, walletAddress) {
    const cacheKey = `${walletAddress}_${signatureInfo.signature}`;
    const cached = transactionCache.get(cacheKey);
    if (cached) return cached;

    try {
        const tx = await archiveRequest(async (conn) => {
            return await conn.getTransaction(signatureInfo.signature, {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed'
            });
        }, `transaction ${signatureInfo.signature.slice(0, 8)}`);

        if (!tx?.meta || tx.meta.err) return null;

        const results = [];

        // Получаем ключи аккаунтов
        let accountKeys = [];
        if (tx.transaction.message.accountKeys) {
            accountKeys = tx.transaction.message.accountKeys;
        } else if (tx.transaction.message.staticAccountKeys) {
            accountKeys = tx.transaction.message.staticAccountKeys;
            if (tx.meta.loadedAddresses) {
                accountKeys = [
                    ...accountKeys,
                    ...(tx.meta.loadedAddresses.writable || []),
                    ...(tx.meta.loadedAddresses.readonly || [])
                ];
            }
        }

        const walletIndex = accountKeys.findIndex(key => {
            const keyStr = typeof key === 'string' ? key : key.toBase58();
            return keyStr === walletAddress;
        });

        if (walletIndex === -1) return null;

        // Определяем контрагента
        const counterparty = findTransactionCounterparty(
            accountKeys,
            walletAddress,
            tx.transaction.message.instructions,
            tx.meta.preBalances,
            tx.meta.postBalances
        );

        // SOL транзакции
        const preBalance = tx.meta.preBalances[walletIndex] || 0;
        const postBalance = tx.meta.postBalances[walletIndex] || 0;
        const balanceChange = (postBalance - preBalance) / 1000000000;

        if (Math.abs(balanceChange) >= 0.000001) {
            results.push({
                id: signatureInfo.signature,
                wallet: walletAddress,
                type: balanceChange > 0 ? 'received' : 'sent',
                amount: Math.abs(balanceChange).toFixed(9).replace(/\.?0+$/, ''),
                token: 'SOL',
                address: formatAddress(counterparty),
                timestamp: new Date((signatureInfo.blockTime || Date.now() / 1000) * 1000).toISOString(),
                signature: signatureInfo.signature
            });
        }

        // SPL токены
        if (tx.meta.preTokenBalances && tx.meta.postTokenBalances) {
            const tokenChanges = new Map();

            [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances].forEach(balance => {
                if (balance.owner === walletAddress) {
                    const key = balance.mint;
                    if (!tokenChanges.has(key)) {
                        tokenChanges.set(key, { pre: 0, post: 0, mint: balance.mint });
                    }
                }
            });

            tx.meta.preTokenBalances.forEach(balance => {
                if (balance.owner === walletAddress) {
                    const change = tokenChanges.get(balance.mint);
                    if (change) change.pre = parseFloat(balance.uiTokenAmount.uiAmountString || '0');
                }
            });

            tx.meta.postTokenBalances.forEach(balance => {
                if (balance.owner === walletAddress) {
                    const change = tokenChanges.get(balance.mint);
                    if (change) change.post = parseFloat(balance.uiTokenAmount.uiAmountString || '0');
                }
            });

            tokenChanges.forEach(change => {
                const tokenChange = change.post - change.pre;
                if (Math.abs(tokenChange) > 0.000001) {
                    results.push({
                        id: `${signatureInfo.signature}_${change.mint}`,
                        wallet: walletAddress,
                        type: tokenChange > 0 ? 'received' : 'sent',
                        amount: Math.abs(tokenChange).toFixed(6).replace(/\.?0+$/, ''),
                        token: getTokenSymbol(change.mint),
                        address: formatAddress(counterparty),
                        timestamp: new Date((signatureInfo.blockTime || Date.now() / 1000) * 1000).toISOString(),
                        signature: signatureInfo.signature
                    });
                }
            });
        }

        transactionCache.set(cacheKey, results);
        return results;

    } catch (error) {
        console.log(`Error processing tx: ${error.message}`);
        return null;
    }
}

// АГРЕССИВНАЯ загрузка ДО САМОЙ ПЕРВОЙ транзакции
async function loadCompleteHistory(walletAddress) {
    const cacheKey = `${walletAddress}_complete_history`;
    let cached = signatureCache.get(cacheKey);
    if (cached?.isComplete) {
        console.log(`📋 Using cached complete history: ${cached.signatures.length} signatures`);
        return cached.signatures;
    }

    console.log(`🏛️ ARCHIVE MODE: Loading COMPLETE history for ${walletAddress.slice(0, 8)}...`);

    const publicKey = new PublicKey(walletAddress);
    let allSignatures = cached?.signatures || [];
    let lastSignature = allSignatures.length > 0 ? allSignatures[allSignatures.length - 1].signature : null;
    let totalLoaded = allSignatures.length;
    let batchCount = 0;
    let consecutiveEmptyBatches = 0;

    try {
        while (consecutiveEmptyBatches < 3) { // Попробуем 3 раза если пусто
            batchCount++;
            console.log(`🔍 Archive Batch ${batchCount}: Requesting ${MAX_SIGNATURES_PER_REQUEST} signatures...`);

            const requestParams = {
                limit: MAX_SIGNATURES_PER_REQUEST,
                commitment: 'confirmed'
            };

            if (lastSignature) {
                requestParams.before = lastSignature;
            }

            const newSignatures = await archiveRequest(async (conn) => {
                return await conn.getSignaturesForAddress(publicKey, requestParams);
            }, `signatures batch ${batchCount}`);

            if (newSignatures.length === 0) {
                consecutiveEmptyBatches++;
                console.log(`⚠️ Empty batch ${consecutiveEmptyBatches}/3`);

                if (consecutiveEmptyBatches >= 3) {
                    console.log(`✅ REACHED GENESIS! No more signatures found after ${batchCount} batches`);
                    break;
                }

                // Переключаемся на другой RPC и пробуем еще
                currentRpcIndex = (currentRpcIndex + 1) % connections.length;
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            consecutiveEmptyBatches = 0; // Сбрасываем счетчик пустых батчей
            allSignatures.push(...newSignatures);
            totalLoaded += newSignatures.length;
            lastSignature = newSignatures[newSignatures.length - 1].signature;

            // Сохраняем прогресс
            signatureCache.set(cacheKey, {
                signatures: allSignatures,
                isComplete: false,
                lastUpdated: Date.now(),
                batchCount
            });

            console.log(`📈 Batch ${batchCount}: +${newSignatures.length} signatures (total: ${totalLoaded})`);

            // Если получили меньше чем запрашивали - возможно дошли до конца
            if (newSignatures.length < MAX_SIGNATURES_PER_REQUEST) {
                console.log(`🎯 Possibly reached end: got ${newSignatures.length} < ${MAX_SIGNATURES_PER_REQUEST}`);

                // Попробуем еще раз с другим RPC
                currentRpcIndex = (currentRpcIndex + 1) % connections.length;
                await new Promise(resolve => setTimeout(resolve, 500));
            } else {
                // Микро-пауза между полными батчами
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        // Отмечаем как полностью загруженную историю
        signatureCache.set(cacheKey, {
            signatures: allSignatures,
            isComplete: true,
            lastUpdated: Date.now(),
            totalBatches: batchCount
        });

        console.log(`🏆 COMPLETE HISTORY LOADED! ${totalLoaded} signatures in ${batchCount} batches`);
        console.log(`📊 RPC Stats:`, connections.map(c =>
            `${c.endpoint.split('/')[2]}: ${c.success}✅/${c.errors}❌`
        ).join(', '));

        return allSignatures;

    } catch (error) {
        console.error('Error loading complete history:', error);
        return allSignatures;
    }
}

// Основная функция
async function getTransactionsPaginated(walletAddress, page, limit) {
    try {
        console.log(`🏛️ Archive request: page ${page}, limit ${limit} for ${walletAddress.slice(0, 8)}`);

        // Загружаем ПОЛНУЮ историю
        const allSignatures = await loadCompleteHistory(walletAddress);

        // Пагинация
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const pageSignatures = allSignatures.slice(startIndex, endIndex);
        const hasMore = endIndex < allSignatures.length;

        console.log(`📊 Archive page ${page}: ${startIndex}-${endIndex} of ${allSignatures.length} (hasMore: ${hasMore})`);

        if (pageSignatures.length === 0) {
            return {
                data: [],
                hasMore: false,
                totalFetched: allSignatures.length
            };
        }

        // Параллельная обработка
        const allTransactions = [];
        const batches = [];

        for (let i = 0; i < pageSignatures.length; i += MAX_CONCURRENT) {
            batches.push(pageSignatures.slice(i, i + MAX_CONCURRENT));
        }

        for (const batch of batches) {
            const batchPromises = batch.map(sig => processTransaction(sig, walletAddress));
            const batchResults = await Promise.allSettled(batchPromises);

            batchResults.forEach(result => {
                if (result.status === 'fulfilled' && result.value) {
                    if (Array.isArray(result.value)) {
                        allTransactions.push(...result.value);
                    } else {
                        allTransactions.push(result.value);
                    }
                }
            });
        }

        // Сортировка
        allTransactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        console.log(`✅ Archive page ${page}: ${allTransactions.length} transactions processed`);

        return {
            data: allTransactions,
            hasMore: hasMore,
            totalFetched: allSignatures.length
        };

    } catch (error) {
        console.error('Error in archive getTransactionsPaginated:', error);
        return {
            data: [],
            hasMore: false,
            totalFetched: 0
        };
    }
}

// Routes
app.get('/', (req, res) => {
    const rpcStats = connections.map(c => ({
        endpoint: c.endpoint.split('/')[2],
        success: c.success,
        errors: c.errors,
        ratio: c.success / Math.max(c.success + c.errors, 1)
    }));

    res.json({
        success: true,
        message: 'ARCHIVE CNServer - MAXIMUM DEPTH! 🏛️',
        timestamp: new Date().toISOString(),
        mode: 'ARCHIVE',
        features: {
            maxDepth: 'TO THE GENESIS',
            rpcs: ARCHIVE_RPC_ENDPOINTS.length,
            autoSwitching: true,
            fullHistory: true
        },
        rpcStats
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'archive_ready',
        timestamp: new Date().toISOString(),
        cache: {
            signatures: signatureCache.size,
            transactions: transactionCache.size
        }
    });
});

app.get('/api/transaction/list', async (req, res) => {
    try {
        const { wallet, page = 1, limit = 50 } = req.query;

        if (!wallet) {
            return res.status(400).json({
                success: false,
                error: 'Wallet address is required'
            });
        }

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 50;

        console.log(`🏛️ Archive API: wallet=${wallet.slice(0, 8)}, page=${pageNum}, limit=${limitNum}`);

        try {
            new PublicKey(wallet);
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Solana wallet address'
            });
        }

        const result = await getTransactionsPaginated(wallet, pageNum, limitNum);

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
        console.error('Archive API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve transactions',
            details: error.message
        });
    }
});

app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
});

app.listen(PORT, () => {
    console.log(`
🏛️ ARCHIVE CNServer Started!
🌐 Server URL: http://localhost:${PORT}
📚 Archive RPC Endpoints: ${ARCHIVE_RPC_ENDPOINTS.length}
🎯 Mission: LOAD EVERY TRANSACTION TO THE GENESIS

🔥 Features:
   • ${ARCHIVE_RPC_ENDPOINTS.length} Archive RPC endpoints
   • Automatic RPC switching on failures
   • Complete transaction history loading
   • Real sender/receiver detection
   • Multi-level caching

Хуй
    `);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

module.exports = app;