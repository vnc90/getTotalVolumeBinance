import axios, { AxiosResponse } from 'axios';
import Volume, { IVolume } from '../models/Volume';

interface SymbolInfo {
    symbol: string;
    status: string;
    quoteAsset: string;
}

interface ComplianceSymbol {
    symbol: string;
    marketCap: number;
    trading: number;
    quoteAsset: string;
}

interface RateLimitInfo {
    usedWeight: number;
    maxWeight: number;
    interval: string;
}

export class VolumeService {
    private readonly apiUrl: string;
    private readonly complianceApiUrl: string = 'https://www.binance.com/bapi/apex/v1/friendly/apex/marketing/complianceSymbolList';
    private readonly rateLimitDelay: number = 1200; // 1.2 seconds between requests
    private readonly loopDelay: number = 5 * 60 * 1000; // 5 minutes
    private readonly maxWeight: number = 1200; // Maximum weight per minute
    private readonly minMarketCap: number = 18000000; // Minimum market cap in USDT
    private currentWeight: number = 0;
    private isRunning: boolean = true;

    constructor() {
        this.apiUrl = process.env.BINANCE_API_URL || 'https://api.binance.com/api/v3';
    }

    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private handleRateLimitHeaders(response: AxiosResponse): RateLimitInfo {
        const headers = response.headers;
        let rateLimitInfo: RateLimitInfo = {
            usedWeight: 0,
            maxWeight: this.maxWeight,
            interval: '1m'
        };

        // Check for X-MBX-USED-WEIGHT headers
        for (const key in headers) {
            if (key.startsWith('x-mbx-used-weight-')) {
                const weight = parseInt(headers[key]);
                const interval = key.replace('x-mbx-used-weight-', '');
                rateLimitInfo = {
                    usedWeight: weight,
                    maxWeight: this.maxWeight,
                    interval: interval
                };
                this.currentWeight = weight;
                break;
            }
        }

        return rateLimitInfo;
    }

    private async handleApiError(error: any): Promise<void> {
        if (error.response) {
            const status = error.response.status;
            const retryAfter = error.response.headers['retry-after'];

            if (status === 429 || status === 418) {
                const waitTime = parseInt(retryAfter) * 1000 || 60000; // Default to 1 minute if no retry-after header
                console.log(`Rate limit exceeded or IP banned. Waiting for ${waitTime/1000} seconds...`);
                await this.delay(waitTime);
            } else {
                console.error('API Error:', error.response.data);
                throw error;
            }
        } else {
            console.error('Network Error:', error.message);
            throw error;
        }
    }

    private async makeApiRequest<T>(url: string, params?: any): Promise<T> {
        try {
            const response = await axios.get(url, { params });
            const rateLimitInfo = this.handleRateLimitHeaders(response);
            
            // Log rate limit information
            console.log(`Rate Limit Info - Used: ${rateLimitInfo.usedWeight}/${rateLimitInfo.maxWeight} (${rateLimitInfo.interval})`);

            // Check if we're approaching the limit
            if (rateLimitInfo.usedWeight > this.maxWeight * 0.8) {
                console.log('Approaching rate limit, waiting for 1 minute...');
                await this.delay(60000);
            }

            return response.data;
        } catch (error) {
            await this.handleApiError(error);
            throw error;
        }
    }

    private async getFilteredSymbols(): Promise<string[]> {
        try {
            console.log('Fetching symbols from compliance API...');
            const response = await axios.get(this.complianceApiUrl);
            const symbols: ComplianceSymbol[] = response.data.data;

            const filteredSymbols = symbols
                .filter(symbol => 
                    symbol.marketCap >= this.minMarketCap && 
                    symbol.trading === 1 && 
                    symbol.quoteAsset === 'USDT'
                )
                .map(symbol => symbol.symbol);

            console.log(`Found ${filteredSymbols.length} symbols with market cap >= ${this.minMarketCap} USDT`);
            return filteredSymbols;
        } catch (error) {
            console.error('Error fetching filtered symbols:', error);
            throw error;
        }
    }

    async calculateTotalVolume(symbol: string): Promise<IVolume> {
        try {
            const endTime = Date.now();
            const startTime = endTime - (10 * 24 * 60 * 60 * 1000); // 10 days ago

            const klines = await this.makeApiRequest<any[]>(`${this.apiUrl}/klines`, {
                symbol: symbol,
                interval: '1d',
                startTime: startTime,
                endTime: endTime
            });
            
            if (klines.length === 0) {
                throw new Error('No data available for the specified period');
            }

            const totalVolume = klines.reduce((sum: number, kline: any[]) => {
                return sum + parseFloat(kline[7]); // Quote asset volume is at index 7
            }, 0);

            const volumeData = await Volume.findOneAndUpdate(
                { symbol: symbol },
                {
                    symbol,
                    totalVolume,
                    startTime: klines[0][0],
                    endTime: endTime,
                    updatedAt: new Date()
                },
                {
                    new: true,
                    upsert: true
                }
            );

            console.log('Volume Data:', {
                symbol,
                totalVolume,
                startTime: new Date(klines[0][0]).toISOString(),
                endTime: new Date(endTime).toISOString(),
            });

            return volumeData;
        } catch (error) {
            console.error('Error calculating volume:', error);
            throw error;
        }
    }

    stopProcessing(): void {
        console.log('Stopping volume calculation service...');
        this.isRunning = false;
    }

    async processAllSymbols(): Promise<void> {
        while (this.isRunning) {
            try {
                console.log('Starting new cycle of volume calculation...');
                const symbols = await this.getFilteredSymbols();
                console.log(`Processing ${symbols.length} symbols with market cap >= ${this.minMarketCap} USDT`);

                for (const symbol of symbols) {
                    if (!this.isRunning) {
                        console.log('Service stopped. Exiting...');
                        return;
                    }

                    try {
                        await this.calculateTotalVolume(symbol);
                        await this.delay(this.rateLimitDelay);
                    } catch (error) {
                        console.error(`Error processing symbol ${symbol}:`, error);
                        continue;
                    }
                }

                if (this.isRunning) {
                    console.log('Completed one cycle. Waiting 5 minutes before next cycle...');
                    await this.delay(this.loopDelay);
                }
            } catch (error) {
                console.error('Error in processAllSymbols:', error);
                if (this.isRunning) {
                    await this.delay(this.loopDelay);
                }
            }
        }
    }
} 