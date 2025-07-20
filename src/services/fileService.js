const fs = require('fs').promises;
const path = require('path');

class FileService {
    constructor() {
        this.walletsFile = path.join(__dirname, '../data/wallets.json');
        this.dataDir = path.join(__dirname, '../data');
    }

    async ensureDataDirectory() {
        try {
            await fs.access(this.dataDir);
        } catch (error) {
            await fs.mkdir(this.dataDir, { recursive: true });
            console.log('Created data directory');
        }
    }

    async saveWallet(address, metadata = {}) {
        try {
            await this.ensureDataDirectory();

            let wallets = [];
            try {
                const data = await fs.readFile(this.walletsFile, 'utf8');
                wallets = JSON.parse(data);
            } catch (error) {
                wallets = [];
            }

            const existingIndex = wallets.findIndex(w => w.address === address);

            if (existingIndex !== -1) {
                wallets[existingIndex].lastAccess = new Date().toISOString();
                wallets[existingIndex].accessCount = (wallets[existingIndex].accessCount || 1) + 1;
            } else {
                wallets.push({
                    address,
                    source: metadata.source || 'unknown',
                    createdAt: new Date().toISOString(),
                    lastAccess: new Date().toISOString(),
                    accessCount: 1
                });
            }

            await fs.writeFile(this.walletsFile, JSON.stringify(wallets, null, 2));

            console.log(`Wallet saved: ${address} (${metadata.source || 'unknown'})`);
            return { success: true, isNew: existingIndex === -1 };

        } catch (error) {
            console.error('Error saving wallet:', error);
            throw new Error('Failed to save wallet to file');
        }
    }

    async getAllWallets() {
        try {
            await this.ensureDataDirectory();
            const data = await fs.readFile(this.walletsFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return [];
        }
    }

    async getStats() {
        try {
            const wallets = await this.getAllWallets();
            const sources = {};

            wallets.forEach(wallet => {
                const source = wallet.source || 'unknown';
                sources[source] = (sources[source] || 0) + 1;
            });

            return {
                total: wallets.length,
                unique: new Set(wallets.map(w => w.address)).size,
                sources: sources,
                lastUpdated: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error getting stats:', error);
            return {
                total: 0,
                unique: 0,
                sources: {},
                lastUpdated: new Date().toISOString()
            };
        }
    }
}

module.exports = new FileService();