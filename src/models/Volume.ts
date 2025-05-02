import mongoose, { Schema, Document } from 'mongoose';

export interface IVolume extends Document {
    symbol: string;
    totalVolume: number;
    startTime: number;
    endTime: number;
    createdAt: Date;
    updatedAt: Date;
}

const VolumeSchema: Schema = new Schema({
    symbol: { type: String, required: true },
    totalVolume: { type: Number, required: true },
    startTime: { type: Number, required: true },
    endTime: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model<IVolume>('Volume', VolumeSchema); 