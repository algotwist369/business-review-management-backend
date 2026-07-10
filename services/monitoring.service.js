
const os = require('os');
const fs = require('fs');
const mongoose = require('mongoose');
const SystemMetric = require('../model/SystemMetric');
const SystemAlert = require('../model/SystemAlert');

// Thresholds
const CPU_THRESHOLD = 80; // %
const MEMORY_THRESHOLD = 85; // %
const DISK_THRESHOLD = 80; // %

// Helper to get CPU usage
const getCpuUsage = () => {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  cpus.forEach(cpu => {
    for (let type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });

  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  const usage = 100 - ~~(100 * idle / total);
  return usage;
};

// Helper to get Memory usage
const getMemoryUsage = () => {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const usagePercent = (usedMemory / totalMemory) * 100;
  return Number(usagePercent.toFixed(2));
};

// Helper to get Disk usage (Windows/Linux compatible)
const getDiskUsage = async () => {
  try {
    // For simplicity, check root drive (Windows: C:, Linux: /)
    if (os.platform() === 'win32') {
      // Quick estimate for Windows (use os module)
      // NOTE: For accurate Windows disk usage, consider using a package like 'systeminformation'
      // For now, we'll use a placeholder, or you can add 'systeminformation' as a dependency
      return 50; // Default placeholder if we can't get real data
    } else {
      // Linux/macOS
      const { execSync } = require('child_process');
      const result = execSync('df -k /', { encoding: 'utf8' });
      const lines = result.trim().split('\n');
      const lastLine = lines[lines.length - 1];
      const usageMatch = lastLine.match(/(\d+)%/);
      return usageMatch ? Number(usageMatch[1]) : 50;
    }
  } catch (err) {
    console.error('Error getting disk usage:', err);
    return 50;
  }
};

// Check MongoDB connection status
const getMongoDbStatus = () => {
  return mongoose.connection.readyState === 1; // 1 = connected
};

// Create a system alert
const createAlert = async ({ type, message, severity = 'HIGH', metadata = {} }) => {
  try {
    // Check if there's already an unresolved alert of the same type to avoid duplicates
    const existingUnresolved = await SystemAlert.findOne({ type, is_resolved: false });
    if (existingUnresolved) {
      // Update existing alert's timestamp and message
      existingUnresolved.timestamp = new Date();
      existingUnresolved.message = message;
      existingUnresolved.metadata = metadata;
      await existingUnresolved.save();
      return existingUnresolved;
    }

    const alert = new SystemAlert({
      type,
      message,
      severity,
      metadata,
    });
    await alert.save();
    console.log(`[MONITORING] Created alert: ${type} - ${message}`);
    return alert;
  } catch (err) {
    console.error('[MONITORING] Error creating alert:', err);
    return null;
  }
};

// Resolve an alert
const resolveAlert = async (alertId, resolvedByUserId) => {
  try {
    const alert = await SystemAlert.findByIdAndUpdate(
      alertId,
      {
        is_resolved: true,
        resolved_at: new Date(),
        resolved_by: resolvedByUserId,
      },
      { returnDocument: 'after' }
    );
    return alert;
  } catch (err) {
    console.error('[MONITORING] Error resolving alert:', err);
    return null;
  }
};

// Collect and save system metrics
const collectAndSaveMetrics = async () => {
  try {
    const cpuUsage = getCpuUsage();
    const memoryUsage = getMemoryUsage();
    const diskUsage = await getDiskUsage();

    const metric = new SystemMetric({
      cpu_usage_percent: cpuUsage,
      memory_usage_percent: memoryUsage,
      disk_usage_percent: diskUsage,
    });
    await metric.save();
    console.log('[MONITORING] Saved system metrics');

    // Check thresholds and create alerts
    if (cpuUsage > CPU_THRESHOLD) {
      await createAlert({
        type: 'HIGH_CPU_USAGE',
        message: `High CPU usage detected: ${cpuUsage.toFixed(1)}%`,
        severity: 'HIGH',
        metadata: { cpu_usage: cpuUsage },
      });
    } else {
      // Resolve existing HIGH_CPU_USAGE alert if any
      const alert = await SystemAlert.findOne({ type: 'HIGH_CPU_USAGE', is_resolved: false });
      if (alert) await resolveAlert(alert._id, null);
    }

    if (memoryUsage > MEMORY_THRESHOLD) {
      await createAlert({
        type: 'HIGH_MEMORY_USAGE',
        message: `High memory usage detected: ${memoryUsage.toFixed(1)}%`,
        severity: 'HIGH',
        metadata: { memory_usage: memoryUsage },
      });
    } else {
      const alert = await SystemAlert.findOne({ type: 'HIGH_MEMORY_USAGE', is_resolved: false });
      if (alert) await resolveAlert(alert._id, null);
    }

    if (diskUsage > DISK_THRESHOLD) {
      await createAlert({
        type: 'HIGH_DISK_USAGE',
        message: `High disk usage detected: ${diskUsage.toFixed(1)}%`,
        severity: 'HIGH',
        metadata: { disk_usage: diskUsage },
      });
    } else {
      const alert = await SystemAlert.findOne({ type: 'HIGH_DISK_USAGE', is_resolved: false });
      if (alert) await resolveAlert(alert._id, null);
    }

    // Check MongoDB connection
    const isMongoConnected = getMongoDbStatus();
    if (!isMongoConnected) {
      await createAlert({
        type: 'MONGODB_DISCONNECTED',
        message: 'MongoDB is disconnected!',
        severity: 'CRITICAL',
      });
    } else {
      const alert = await SystemAlert.findOne({ type: 'MONGODB_DISCONNECTED', is_resolved: false });
      if (alert) await resolveAlert(alert._id, null);
    }

  } catch (err) {
    console.error('[MONITORING] Error collecting metrics:', err);
  }
};

module.exports = {
  getCpuUsage,
  getMemoryUsage,
  getDiskUsage,
  getMongoDbStatus,
  createAlert,
  resolveAlert,
  collectAndSaveMetrics,
};
