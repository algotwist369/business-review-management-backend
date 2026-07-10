
const mongoose = require('mongoose');

const systemMetricSchema = new mongoose.Schema(
  {
    cpu_usage_percent: { type: Number, required: true },
    memory_usage_percent: { type: Number, required: true },
    disk_usage_percent: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// TTL index: Delete documents older than 30 days
systemMetricSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
systemMetricSchema.index({ timestamp: -1 });

module.exports = mongoose.model('SystemMetric', systemMetricSchema);
