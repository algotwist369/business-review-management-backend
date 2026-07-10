
const SystemMetric = require('../model/SystemMetric');
const SystemAlert = require('../model/SystemAlert');
const { resolveAlert } = require('../services/monitoring.service');

// Get metrics (with date range filters)
const getMetrics = async (req, res) => {
  try {
    const { startDate, endDate, limit = 100 } = req.query;
    const filter = {};

    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) filter.timestamp.$lte = new Date(endDate);
    }

    const metrics = await SystemMetric.find(filter)
      .sort({ timestamp: -1 })
      .limit(Number(limit));

    res.status(200).json({ metrics });
  } catch (err) {
    console.error('Get metrics error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Get alerts
const getAlerts = async (req, res) => {
  try {
    const { is_resolved, type, startDate, endDate, limit = 100 } = req.query;
    const filter = {};

    if (is_resolved !== undefined) filter.is_resolved = is_resolved === 'true';
    if (type) filter.type = type;

    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) filter.timestamp.$lte = new Date(endDate);
    }

    const alerts = await SystemAlert.find(filter)
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .populate('resolved_by', 'username email');

    res.status(200).json({ alerts });
  } catch (err) {
    console.error('Get alerts error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Resolve an alert
const resolveAlertController = async (req, res) => {
  try {
    const { alertId } = req.params;
    const resolvedAlert = await resolveAlert(alertId, req.user._id);

    if (!resolvedAlert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.status(200).json({ alert: resolvedAlert });
  } catch (err) {
    console.error('Resolve alert error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Get current status summary (active alerts, latest metrics)
const getStatusSummary = async (req, res) => {
  try {
    const activeAlerts = await SystemAlert.find({ is_resolved: false })
      .sort({ timestamp: -1 });

    const latestMetrics = await SystemMetric.findOne()
      .sort({ timestamp: -1 });

    res.status(200).json({
      activeAlerts,
      latestMetrics,
    });
  } catch (err) {
    console.error('Get status summary error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

module.exports = {
  getMetrics,
  getAlerts,
  resolveAlertController,
  getStatusSummary,
};
