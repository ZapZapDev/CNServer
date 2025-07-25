const { Connection, PublicKey } = require('@solana/web3.js');

const connection = new Connection('https://rpc.ankr.com/solana/d6c6fa3c371801bea9a0116cc75ad5526f07873f0fb2742e6762a250f3abf73b');

const getSignatures = async (wallet, limit) => {
    const publicKey = new PublicKey(wallet);

    return await connection.getSignaturesForAddress(publicKey, {
        limit: Math.min(limit, 1000)
    });
};

const getTransaction = async (signature) => {
    try {
        const tx = await connection.getTransaction(signature, {
            maxSupportedTransactionVersion: 0
        });

        if (!tx || tx.meta?.err) return null;

        return tx;
    } catch (error) {
        return null;
    }
};

module.exports = {
    getSignatures,
    getTransaction
};