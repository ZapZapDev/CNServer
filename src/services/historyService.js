const blockchainService = require('./blockchainService');

const getWalletHistory = async (wallet, page, limit) => {
    const signatures = await blockchainService.getSignatures(wallet, page * limit);

    const start = (page - 1) * limit;
    const pageSignatures = signatures.slice(start, start + limit);

    const txPromises = pageSignatures.map(async (sig) => {
        const tx = await blockchainService.getTransaction(sig.signature);
        if (!tx) return null;

        return parseTransaction(tx, sig, wallet);
    });

    const results = await Promise.all(txPromises);
    const transactions = results.filter(r => r).flat();

    return {
        transactions: transactions.sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        ),
        hasMore: start + limit < signatures.length
    };
};

const parseTransaction = (tx, sig, wallet) => {
    const results = [];
    const keys = tx.transaction.message.accountKeys || [];
    const walletIndex = keys.findIndex(k => k.toString() === wallet);

    if (walletIndex === -1) return results;

    // SOL
    const preBalance = tx.meta.preBalances[walletIndex] || 0;
    const postBalance = tx.meta.postBalances[walletIndex] || 0;
    const solChange = (postBalance - preBalance) / 1e9;

    if (Math.abs(solChange) >= 0.000001) {
        results.push({
            id: `${sig.signature}_SOL`,
            type: solChange > 0 ? 'received' : 'sent',
            amount: Math.abs(solChange).toFixed(6),
            token: 'SOL',
            timestamp: new Date((sig.blockTime || Date.now() / 1000) * 1000).toISOString(),
            signature: sig.signature
        });
    }

    // SPL Tokens
    if (tx.meta.preTokenBalances && tx.meta.postTokenBalances) {
        const tokenChanges = new Map();

        tx.meta.preTokenBalances.forEach(b => {
            if (b.owner === wallet) {
                tokenChanges.set(b.mint, {
                    pre: parseFloat(b.uiTokenAmount.uiAmountString || '0'),
                    post: 0,
                    mint: b.mint
                });
            }
        });

        tx.meta.postTokenBalances.forEach(b => {
            if (b.owner === wallet) {
                if (tokenChanges.has(b.mint)) {
                    tokenChanges.get(b.mint).post = parseFloat(b.uiTokenAmount.uiAmountString || '0');
                } else {
                    tokenChanges.set(b.mint, {
                        pre: 0,
                        post: parseFloat(b.uiTokenAmount.uiAmountString || '0'),
                        mint: b.mint
                    });
                }
            }
        });

        tokenChanges.forEach(change => {
            const diff = change.post - change.pre;
            if (Math.abs(diff) > 0.000001) {
                results.push({
                    id: `${sig.signature}_${change.mint}`,
                    type: diff > 0 ? 'received' : 'sent',
                    amount: Math.abs(diff).toFixed(6),
                    token: change.mint,
                    timestamp: new Date((sig.blockTime || Date.now() / 1000) * 1000).toISOString(),
                    signature: sig.signature
                });
            }
        });
    }

    return results;
};

module.exports = {
    getWalletHistory
};