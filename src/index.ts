import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { VolumeService } from './services/volumeService';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/totalvolume')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

let volumeService: VolumeService;

async function main() {
    try {
        volumeService = new VolumeService();
        console.log('Starting volume calculation service...');
        await volumeService.processAllSymbols();
    } catch (error) {
        console.error('Error in main:', error);
    }
}

// Handle process termination
process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT. Gracefully shutting down...');
    if (volumeService) {
        volumeService.stopProcessing();
    }
    await mongoose.connection.close();
    process.exit(0);
});

// Handle process termination (Windows)
process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM. Gracefully shutting down...');
    if (volumeService) {
        volumeService.stopProcessing();
    }
    await mongoose.connection.close();
    process.exit(0);
});

main(); 