
const mongoose = require('mongoose');

const alertTypeEnum = [
  'HIGH_CPU_USAGE',
  'HIGH_MEMORY_USAGE',
  'HIGH_DISK_USAGE',
  'APP_CRASHED_PM2_RESTART',
  'API_5XX_ERRORS_HIGH',
  'API_RESPONSE_TIME_HIGH',
  'MONGODB_DISCONNECTED',
  'EXTERNAL_API_TOKEN_EXPIRED',
  'ADMIN_SUSPICIOUS_LOGIN',
];

const systemAlertSchema = new mongoose.Schema(
  {
    type: { type: String, enum: alertTypeEnum, required: true, index: true },
    message: { type: String, required: true },
    severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'HIGH', index: true },
    is_resolved: { type: Boolean, default: false, index: true },
    resolved_at: { type: Date },
    resolved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    metadata: { type: mongoose.Schema.Types.Mixed }, // To store additional info like login IP, API endpoint, etc.
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);


// TTL index: Delete documents older than 30 days
systemAlertSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
systemAlertSchema.index({ is_resolved: 1, timestamp: -1 });
systemAlertSchema.index({ type: 1, is_resolved: 1 });

module.exports = mongoose.model('SystemAlert', systemAlertSchema);
