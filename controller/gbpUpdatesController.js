const mongoose = require('mongoose');
const GoogleBusinessProfileUpdates = require('../model/GoogleBusinessProfileUpdates');
const GbpDailyActivity = require('../model/GbpDailyActivity');
const User = require('../model/user');
const Business = require('../model/Business');
const { normalizeAssetInput } = require('../utils/assetUtils');

// Helpers for validation
const validateMonth = (month) => {
    return typeof month === 'string' && /^\d{4}-\d{2}$/.test(month);
};

const validateCount = (val) => {
    if (val === undefined || val === null) return true;
    return Number.isInteger(Number(val)) && Number(val) >= 0;
};

const validateDate = (date) => {
    return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date);
};

const parseMonthBounds = (month) => {
    const [year, monthNumber] = month.split('-').map(Number);
    const start = new Date(year, monthNumber - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, monthNumber, 0, 23, 59, 59, 999);
    return { start, end };
};

const overlapsMonth = (record, monthStart, monthEnd) => {
    if (!record.post_start_date || !record.post_end_date) return false;
    const start = new Date(record.post_start_date);
    const end = new Date(record.post_end_date);
    return start <= monthEnd && end >= monthStart;
};

const hasPositivePermanentCount = (record, field) => Number(record?.[field] || 0) > 0;

const mergeEffectiveMonthlyRecords = (records, month) => {
    if (!month) return records;

    const { start: monthStart, end: monthEnd } = parseMonthBounds(month);
    const grouped = new Map();

    records.forEach(record => {
        const userId = (record.user_id?._id || record.user_id)?.toString();
        const businessId = (record.business_id?._id || record.business_id)?.toString();
        if (!userId || !businessId) return;

        const key = `${userId}:${businessId}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(record);
    });

    const effectiveRecords = [];

    grouped.forEach(groupRecords => {
        const sorted = groupRecords.sort((a, b) => {
            if (a.month !== b.month) return b.month.localeCompare(a.month);
            return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
        });

        const exactRecord = sorted.find(record => record.month === month);
        const postRecord = sorted.find(record => overlapsMonth(record, monthStart, monthEnd));
        const baseRecord = exactRecord || postRecord || sorted[0];
        if (!baseRecord) return;

        const effective = { ...baseRecord };
        effective.is_effective_month_view = true;
        effective.effective_month = month;

        ['product_count', 'service_count', 'media_count'].forEach(field => {
            const countSource = sorted.find(record => record.month <= month && hasPositivePermanentCount(record, field));
            if (countSource) {
                effective[field] = countSource[field];
                effective[`${field}_source_month`] = countSource.month;
            }
        });

        if (postRecord) {
            effective.post_start_date = postRecord.post_start_date;
            effective.post_end_date = postRecord.post_end_date;
            effective.scheduled_posts_count = postRecord.scheduled_posts_count || 0;
            effective.update_link = postRecord.update_link;
            effective.post_source_month = postRecord.month;
        } else {
            effective.post_start_date = null;
            effective.post_end_date = null;
            effective.scheduled_posts_count = 0;
            effective.update_link = '';
            effective.post_source_month = null;
        }

        effectiveRecords.push(effective);
    });

    return effectiveRecords;
};

const buildRoleFilter = async (req) => {
    const filter = {};

    if (req.user.role === 'user') {
        const assignedIds = req.user.assigned_businesses || [];
        filter.business_id = { $in: assignedIds };
        filter.user_id = req.user._id;
    } else if (req.user.role === 'admin') {
        const managedUsers = await User.find({ managed_by: req.user._id, is_deleted: false }).select('_id').lean();
        const userIds = [req.user._id, ...managedUsers.map(u => u._id)];
        filter.user_id = { $in: userIds };
    }

    return filter;
};

const applyBusinessSearchFilter = async (filter, search) => {
    if (!search) return filter;

    const matchingBusinesses = await Business.find({
        $or: [
            { business_name: { $regex: search, $options: 'i' } },
            { location: { $regex: search, $options: 'i' } },
            { short_code: { $regex: search, $options: 'i' } }
        ]
    }).select('_id').lean();

    const businessIds = matchingBusinesses.map(b => b._id);

    if (filter.business_id?.$in) {
        const allowedIds = filter.business_id.$in.map(id => id.toString());
        filter.business_id = { $in: businessIds.filter(id => allowedIds.includes(id.toString())) };
    } else {
        filter.business_id = { $in: businessIds };
    }

    return filter;
};

const buildMonthAwareFilter = (filter, month) => {
    if (!month) return filter;

    const { start: monthStart, end: monthEnd } = parseMonthBounds(month);
    return {
        ...filter,
        $or: [
            { month: { $lte: month } },
            {
                post_start_date: { $lte: monthEnd },
                post_end_date: { $gte: monthStart }
            }
        ]
    };
};

const getLatestPermanentCounts = async (userId, businessId, month, excludeRecordId = null) => {
    const query = {
        user_id: userId,
        business_id: businessId,
        month: { $lte: month }
    };

    if (excludeRecordId) {
        query._id = { $ne: excludeRecordId };
    }

    const records = await GoogleBusinessProfileUpdates.find(query)
        .sort({ month: -1, updatedAt: -1 })
        .select('month product_count service_count media_count')
        .lean();

    const counts = {};
    ['product_count', 'service_count', 'media_count'].forEach(field => {
        const source = records.find(record => hasPositivePermanentCount(record, field));
        if (source) counts[field] = source[field];
    });

    return counts;
};

const preservePermanentCounts = (incomingCounts, fallbackCounts = {}) => {
    const preserved = {};

    ['product_count', 'service_count', 'media_count'].forEach(field => {
        const incoming = incomingCounts[field];
        const fallback = fallbackCounts[field];

        if ((incoming === undefined || incoming === null || Number(incoming) === 0) && Number(fallback || 0) > 0) {
            preserved[field] = fallback;
        } else if (incoming !== undefined) {
            preserved[field] = incoming;
        }
    });

    return preserved;
};

const dailyTrackedFields = [
    'product_count',
    'service_count',
    'media_count',
    'post_start_date',
    'post_end_date',
    'scheduled_posts_count',
    'update_link',
    'status',
    'remarks',
    'is_number_live',
    'is_whatsapp_live',
    'is_website_live',
    'is_email_live'
];

const startOfDay = (date = new Date()) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

const endOfDay = (date = new Date()) => {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
};

const normalizeForCompare = (value) => {
    if (value instanceof Date) return value.toISOString();
    if (value && typeof value.toObject === 'function') return value.toObject();
    if (value && typeof value === 'object') return JSON.parse(JSON.stringify(value));
    return value ?? null;
};

const snapshotGbpRecord = (record) => {
    if (!record) return null;
    const raw = typeof record.toObject === 'function' ? record.toObject() : record;
    return dailyTrackedFields.reduce((snapshot, field) => {
        snapshot[field] = normalizeForCompare(raw[field]);
        return snapshot;
    }, {});
};

const getChangedFields = (beforeSnapshot, afterSnapshot) => {
    if (!afterSnapshot) return [];
    if (!beforeSnapshot) {
        return dailyTrackedFields.filter(field => {
            const value = afterSnapshot[field];
            return value !== undefined && value !== null && value !== '';
        });
    }

    return dailyTrackedFields.filter(field => {
        return JSON.stringify(normalizeForCompare(beforeSnapshot[field])) !== JSON.stringify(normalizeForCompare(afterSnapshot[field]));
    });
};

const logGbpDailyActivity = async ({ record, previousRecord, changedBy, action }) => {
    try {
        const previousSnapshot = snapshotGbpRecord(previousRecord);
        const newSnapshot = snapshotGbpRecord(record);
        const changedFields = getChangedFields(previousSnapshot, newSnapshot);

        if (action === 'updated' && changedFields.length === 0) return;

        await GbpDailyActivity.create({
            gbp_update_id: record._id,
            user_id: record.user_id,
            business_id: record.business_id,
            month: record.month,
            activity_date: startOfDay(new Date()),
            changed_by: changedBy,
            action,
            changed_fields: changedFields,
            changed_fields_count: changedFields.length,
            previous_data: previousSnapshot,
            new_data: newSnapshot,
        });
    } catch (error) {
        console.error('GBP Daily Activity Log Error:', error);
    }
};

const backfillLegacyDailyActivities = async (baseFilter = {}, activityDate = new Date()) => {
    const dayStart = startOfDay(activityDate);
    const dayEnd = endOfDay(activityDate);
    const records = await GoogleBusinessProfileUpdates.find({
        ...baseFilter,
        $or: [
            { updatedAt: { $gte: dayStart, $lte: dayEnd } },
            { createdAt: { $gte: dayStart, $lte: dayEnd } }
        ]
    })
        .select('user_id business_id month product_count service_count media_count post_start_date post_end_date scheduled_posts_count update_link status remarks is_number_live is_whatsapp_live is_website_live is_email_live updated_by createdAt updatedAt')
        .limit(2000)
        .lean();

    await Promise.all(records.map(record => {
        const legacyKey = `gbp:${record._id}`;
        return GbpDailyActivity.updateOne(
            { legacy_key: legacyKey },
            {
                $setOnInsert: {
                    gbp_update_id: record._id,
                    user_id: record.user_id,
                    business_id: record.business_id,
                    month: record.month,
                    activity_date: startOfDay(record.updatedAt || record.createdAt || new Date()),
                    changed_by: record.updated_by || record.user_id,
                    action: 'legacy_snapshot',
                    changed_fields: dailyTrackedFields,
                    changed_fields_count: dailyTrackedFields.length,
                    previous_data: null,
                    new_data: snapshotGbpRecord(record),
                    is_legacy: true,
                    legacy_key: legacyKey,
                }
            },
            { upsert: true }
        ).catch(error => {
            if (error.code !== 11000) console.error('GBP Legacy Daily Activity Error:', error);
        });
    }));
};
// Create or update monthly record
const createGbpUpdate = async (req, res) => {
    try {
        const {
            business_id,
            month,
            product_count,
            service_count,
            media_count,
            post_start_date,
            post_end_date,
            scheduled_posts_count,
            update_link,
            status,
            remarks,
            user_id,
            is_number_live,
            is_whatsapp_live,
            is_website_live,
            is_email_live
        } = req.body;

        // Basic validations
        if (!business_id || !month) {
            return res.status(400).json({ error: 'business_id and month are required' });
        }

        if (!mongoose.Types.ObjectId.isValid(business_id)) {
            return res.status(400).json({ error: 'Invalid business_id' });
        }

        if (!validateMonth(month)) {
            return res.status(400).json({ error: 'month must be in YYYY-MM format' });
        }

        // Count validations
        const counts = { product_count, service_count, media_count, scheduled_posts_count };
        for (const [key, val] of Object.entries(counts)) {
            if (val !== undefined && !validateCount(val)) {
                return res.status(400).json({ error: `${key} must be a non-negative integer` });
            }
        }

        // Status validation
        const allowedStatus = ['pending', 'in_progress', 'completed', 'suspended', '404'];
        if (status && !allowedStatus.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${allowedStatus.join(', ')}` });
        }

        // Check if business exists
        const business = await Business.findById(business_id).lean();
        if (!business) {
            return res.status(404).json({ error: 'Business not found' });
        }

        // Enforce user scoping:
        // Regular user: can only manage for their assigned businesses
        if (req.user.role === 'user') {
            const assignedIds = (req.user.assigned_businesses || []).map(id => id.toString());
            if (!assignedIds.includes(business_id.toString())) {
                return res.status(403).json({ error: 'Access denied to this business' });
            }
        }

        // Determine target user_id for the record:
        // For users, it's always themselves. For admins/super_admins, it can be themselves or a managed user
        let targetUserId = req.user._id;
        if (user_id && req.user.role !== 'user') {
            if (!mongoose.Types.ObjectId.isValid(user_id)) {
                return res.status(400).json({ error: 'Invalid user_id' });
            }
            if (req.user.role === 'admin') {
                const managedUser = await User.findOne({ _id: user_id, managed_by: req.user._id, is_deleted: false }).lean();
                if (!managedUser && req.user._id.toString() !== user_id.toString()) {
                    return res.status(403).json({ error: 'Access denied: You can only assign records to users you manage' });
                }
            }
            targetUserId = user_id;
        }

        const fallbackCounts = await getLatestPermanentCounts(targetUserId, business_id, month);
        const preservedCounts = preservePermanentCounts(
            { product_count, service_count, media_count },
            fallbackCounts
        );

        // Check if record already exists for this user + business + month
        let record = await GoogleBusinessProfileUpdates.findOne({ user_id: targetUserId, business_id, month });

        if (record) {
            const previousRecord = record.toObject();
            // Check if requester is allowed to update this existing record
            if (req.user.role === 'admin') {
                const recordUser = await User.findById(record.user_id).lean();
                const isManaged = Array.isArray(recordUser.managed_by)
                    ? recordUser.managed_by.some(id => id.toString() === req.user._id.toString())
                    : recordUser.managed_by?.toString() === req.user._id.toString();
                if (!recordUser || (!isManaged && record.user_id.toString() !== req.user._id.toString())) {
                    return res.status(403).json({ error: 'Access denied: Existing record belongs to a user you do not manage' });
                }
            }

            // Update fields
            if (preservedCounts.product_count !== undefined) record.product_count = preservedCounts.product_count;
            if (preservedCounts.service_count !== undefined) record.service_count = preservedCounts.service_count;
            if (preservedCounts.media_count !== undefined) record.media_count = preservedCounts.media_count;
            if (post_start_date !== undefined) record.post_start_date = post_start_date ? new Date(post_start_date) : null;
            if (post_end_date !== undefined) record.post_end_date = post_end_date ? new Date(post_end_date) : null;
            if (scheduled_posts_count !== undefined) record.scheduled_posts_count = scheduled_posts_count;
            if (update_link !== undefined) record.update_link = update_link;
            if (status !== undefined) record.status = status;
            if (remarks !== undefined) record.remarks = remarks;

            if (is_number_live !== undefined) record.is_number_live = normalizeAssetInput(is_number_live, req.user._id, record.is_number_live);
            if (is_whatsapp_live !== undefined) record.is_whatsapp_live = normalizeAssetInput(is_whatsapp_live, req.user._id, record.is_whatsapp_live);
            if (is_website_live !== undefined) record.is_website_live = normalizeAssetInput(is_website_live, req.user._id, record.is_website_live);
            if (is_email_live !== undefined) record.is_email_live = normalizeAssetInput(is_email_live, req.user._id, record.is_email_live);

            if (req.user.role !== 'user' && user_id) {
                record.user_id = targetUserId;
            }

            record.updated_by = req.user._id;

            await record.save();
            await logGbpDailyActivity({ record, previousRecord, changedBy: req.user._id, action: 'updated' });

            if (record.status === 'completed') {
                const { handleWorkspaceCompletion } = require('../services/notificationService');
                await handleWorkspaceCompletion(record.user_id, record.business_id);
            }

            const populated = await GoogleBusinessProfileUpdates.findById(record._id)
                .populate('business_id', 'business_name location short_code business_link')
                .populate('user_id', 'username email')
                .populate('updated_by', 'username email')
                .lean();

            return res.status(200).json({
                message: 'GBP updates record updated successfully',
                data: populated
            });
        } else {
            // Create new record
            const newRecord = await GoogleBusinessProfileUpdates.create({
                user_id: targetUserId,
                business_id,
                month,
                product_count: preservedCounts.product_count || 0,
                service_count: preservedCounts.service_count || 0,
                media_count: preservedCounts.media_count || 0,
                post_start_date: post_start_date ? new Date(post_start_date) : null,
                post_end_date: post_end_date ? new Date(post_end_date) : null,
                scheduled_posts_count: scheduled_posts_count || 0,
                update_link,
                status: status || 'pending',
                remarks,
                is_number_live: normalizeAssetInput(is_number_live || {}, req.user._id),
                is_whatsapp_live: normalizeAssetInput(is_whatsapp_live || {}, req.user._id),
                is_website_live: normalizeAssetInput(is_website_live || {}, req.user._id),
                is_email_live: normalizeAssetInput(is_email_live || {}, req.user._id),
                updated_by: req.user._id
            });

            await logGbpDailyActivity({ record: newRecord, previousRecord: null, changedBy: req.user._id, action: 'created' });

            if (newRecord.status === 'completed') {
                const { handleWorkspaceCompletion } = require('../services/notificationService');
                await handleWorkspaceCompletion(newRecord.user_id, newRecord.business_id);
            }

            const populated = await GoogleBusinessProfileUpdates.findById(newRecord._id)
                .populate('business_id', 'business_name location short_code business_link')
                .populate('user_id', 'username email')
                .populate('updated_by', 'username email')
                .lean();

            return res.status(201).json({
                message: 'GBP updates record created successfully',
                data: populated
            });
        }

    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'A monthly update record already exists for this business and month. Please refresh and try again.' });
        }
        console.error('Create GBP Update Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Update record by ID
const updateGbpUpdate = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            product_count,
            service_count,
            media_count,
            post_start_date,
            post_end_date,
            scheduled_posts_count,
            update_link,
            status,
            remarks,
            user_id,
            is_number_live,
            is_whatsapp_live,
            is_website_live,
            is_email_live
        } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid record ID' });
        }

        const record = await GoogleBusinessProfileUpdates.findById(id);
        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        // Count validations
        const counts = { product_count, service_count, media_count, scheduled_posts_count };
        for (const [key, val] of Object.entries(counts)) {
            if (val !== undefined && !validateCount(val)) {
                return res.status(400).json({ error: `${key} must be a non-negative integer` });
            }
        }

        // Status validation
        const allowedStatus = ['pending', 'in_progress', 'completed', 'suspended', '404'];
        if (status && !allowedStatus.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${allowedStatus.join(', ')}` });
        }

        // Role-based auth checks:
        if (req.user.role === 'user') {
            const assignedIds = (req.user.assigned_businesses || []).map(bid => bid.toString());
            if (!assignedIds.includes(record.business_id.toString())) {
                return res.status(403).json({ error: 'Access denied: Business is not assigned to you' });
            }
        } else if (req.user.role === 'admin') {
            const recordUser = await User.findById(record.user_id).lean();
            const isManaged = Array.isArray(recordUser.managed_by)
                ? recordUser.managed_by.some(id => id.toString() === req.user._id.toString())
                : recordUser.managed_by?.toString() === req.user._id.toString();
            if (!recordUser || (!isManaged && record.user_id.toString() !== req.user._id.toString())) {
                return res.status(403).json({ error: 'Access denied: Existing record belongs to a user you do not manage' });
            }
        }

        // Update user assignment if requested by admin/super_admin
        if (user_id && req.user.role !== 'user') {
            if (!mongoose.Types.ObjectId.isValid(user_id)) {
                return res.status(400).json({ error: 'Invalid user_id' });
            }
            if (req.user.role === 'admin') {
                const managedUser = await User.findOne({ _id: user_id, managed_by: req.user._id, is_deleted: false }).lean();
                if (!managedUser && req.user._id.toString() !== user_id.toString()) {
                    return res.status(403).json({ error: 'Access denied: You can only assign records to users you manage' });
                }
            }
            record.user_id = user_id;
        }

        const previousRecord = record.toObject();

        const fallbackCounts = await getLatestPermanentCounts(record.user_id, record.business_id, record.month, record._id);
        const preservedCounts = preservePermanentCounts(
            { product_count, service_count, media_count },
            fallbackCounts
        );

        // Update fields
        if (preservedCounts.product_count !== undefined) record.product_count = preservedCounts.product_count;
        if (preservedCounts.service_count !== undefined) record.service_count = preservedCounts.service_count;
        if (preservedCounts.media_count !== undefined) record.media_count = preservedCounts.media_count;
        if (post_start_date !== undefined) record.post_start_date = post_start_date ? new Date(post_start_date) : null;
        if (post_end_date !== undefined) record.post_end_date = post_end_date ? new Date(post_end_date) : null;
        if (scheduled_posts_count !== undefined) record.scheduled_posts_count = scheduled_posts_count;
        if (update_link !== undefined) record.update_link = update_link;
        if (status !== undefined) record.status = status;
        if (remarks !== undefined) record.remarks = remarks;

        if (is_number_live !== undefined) record.is_number_live = normalizeAssetInput(is_number_live, req.user._id, record.is_number_live);
        if (is_whatsapp_live !== undefined) record.is_whatsapp_live = normalizeAssetInput(is_whatsapp_live, req.user._id, record.is_whatsapp_live);
        if (is_website_live !== undefined) record.is_website_live = normalizeAssetInput(is_website_live, req.user._id, record.is_website_live);
        if (is_email_live !== undefined) record.is_email_live = normalizeAssetInput(is_email_live, req.user._id, record.is_email_live);

        record.updated_by = req.user._id;

        await record.save();
        await logGbpDailyActivity({ record, previousRecord, changedBy: req.user._id, action: 'updated' });

        if (record.status === 'completed') {
            const { handleWorkspaceCompletion } = require('../services/notificationService');
            await handleWorkspaceCompletion(record.user_id, record.business_id);
        }

        const populated = await GoogleBusinessProfileUpdates.findById(record._id)
            .populate('business_id', 'business_name location short_code business_link')
            .populate('user_id', 'username email')
            .populate('updated_by', 'username email')
            .lean();

        return res.status(200).json({
            message: 'GBP updates record updated successfully',
            data: populated
        });

    } catch (error) {
        console.error('Update GBP Update Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Get records (filtered by month, with search and pagination)
const getGbpUpdates = async (req, res) => {
    try {
        const { month, page = 1, limit = 20, search = '', status = '' } = req.query;

        if (month && !validateMonth(month)) {
            return res.status(400).json({ error: 'month must be in YYYY-MM format' });
        }
        const allowedStatus = ['pending', 'in_progress', 'completed', 'suspended', '404'];
        if (status && !allowedStatus.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${allowedStatus.join(', ')}` });
        }

        const skip = (Number(page) - 1) * Number(limit);

        let filter = await buildRoleFilter(req);
        filter = await applyBusinessSearchFilter(filter, search);
        filter = buildMonthAwareFilter(filter, month);

        const records = await GoogleBusinessProfileUpdates.find(filter)
            .populate('business_id', 'business_name location short_code business_link')
            .populate('user_id', 'username email')
            .populate('updated_by', 'username email')
            .sort({ month: -1, createdAt: -1 })
            .lean();

        let data = mergeEffectiveMonthlyRecords(records, month)
            .sort((a, b) => {
                if (a.month !== b.month) return b.month.localeCompare(a.month);
                return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
            });

        if (status) {
            data = data.filter(record => (record.status || 'pending') === status);
        }

        const total = data.length;
        data = data.slice(skip, skip + Number(limit));

        return res.status(200).json({
            total,
            page: Number(page),
            limit: Number(limit),
            data
        });

    } catch (error) {
        console.error('Get GBP Updates Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};


const applyTargetUserFilter = async (filter, req, targetUserId) => {
    if (!targetUserId) return filter;
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
        const error = new Error('Invalid user_id');
        error.statusCode = 400;
        throw error;
    }

    if (req.user.role === 'user' && req.user._id.toString() !== targetUserId.toString()) {
        const error = new Error('Access denied for this user');
        error.statusCode = 403;
        throw error;
    }

    if (req.user.role === 'admin' && req.user._id.toString() !== targetUserId.toString()) {
        const managedUser = await User.findOne({ _id: targetUserId, managed_by: req.user._id, is_deleted: false }).select('_id').lean();
        if (!managedUser) {
            const error = new Error('Access denied for this user');
            error.statusCode = 403;
            throw error;
        }
    }

    const currentAllowed = filter.user_id?.$in;
    if (currentAllowed) {
        const allowedIds = currentAllowed.map(id => id.toString());
        if (!allowedIds.includes(targetUserId.toString())) {
            const error = new Error('Access denied for this user');
            error.statusCode = 403;
            throw error;
        }
    }

    filter.user_id = targetUserId;
    return filter;
};

const getGbpDailyActivities = async (req, res) => {
    try {
        const { date, page = 1, limit = 20, search = '', status = '', user_id = '' } = req.query;

        if (date && !validateDate(date)) {
            return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
        }

        const allowedStatus = ['pending', 'in_progress', 'completed', 'suspended', '404'];
        if (status && !allowedStatus.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${allowedStatus.join(', ')}` });
        }

        const selectedDate = parseLocalDay(date);
        const skip = (Number(page) - 1) * Number(limit);
        const safeLimit = Math.min(Number(limit) || 20, 100);

        let roleFilter = await buildRoleFilter(req);
        roleFilter = await applyTargetUserFilter(roleFilter, req, user_id);
        await backfillLegacyDailyActivities(roleFilter, selectedDate);

        let filter = {
            ...roleFilter,
            activity_date: { $gte: startOfDay(selectedDate), $lte: endOfDay(selectedDate) }
        };
        filter = await applyBusinessSearchFilter(filter, search);

        const allForStatus = status
            ? await GbpDailyActivity.find(filter).sort({ activity_date: -1, updatedAt: -1, createdAt: -1 }).lean()
            : null;
        const total = status
            ? allForStatus.filter(activity => (activity.new_data?.status || 'pending') === status).length
            : await GbpDailyActivity.countDocuments(filter);

        const activities = status
            ? allForStatus.filter(activity => (activity.new_data?.status || 'pending') === status).slice(skip, skip + safeLimit)
            : await GbpDailyActivity.find(filter)
                .sort({ activity_date: -1, updatedAt: -1, createdAt: -1 })
                .skip(skip)
                .limit(safeLimit)
                .lean();

        const populated = await GbpDailyActivity.populate(activities, [
            { path: 'business_id', select: 'business_name location short_code business_link' },
            { path: 'user_id', select: 'username email' },
            { path: 'changed_by', select: 'username email role' }
        ]);

        return res.status(200).json({
            total,
            page: Number(page),
            limit: safeLimit,
            data: populated
        });
    } catch (error) {
        console.error('Get GBP Daily Activities Error:', error);
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Internal Server Error' });
    }
};

const getGbpDailySummary = async (req, res) => {
    try {
        const { date, search = '', user_id = '' } = req.query;

        if (date && !validateDate(date)) {
            return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
        }

        const selectedDate = parseLocalDay(date);
        let roleFilter = await buildRoleFilter(req);
        roleFilter = await applyTargetUserFilter(roleFilter, req, user_id);
        await backfillLegacyDailyActivities(roleFilter, selectedDate);

        let filter = {
            ...roleFilter,
            activity_date: { $gte: startOfDay(selectedDate), $lte: endOfDay(selectedDate) }
        };
        filter = await applyBusinessSearchFilter(filter, search);

        const rows = await GbpDailyActivity.find(filter)
            .select('user_id business_id action changed_fields_count new_data')
            .lean();

        const uniqueUsers = new Set();
        const uniqueBusinesses = new Set();
        const statusCounts = { pending: 0, in_progress: 0, completed: 0, suspended: 0, 404: 0 };
        let changedFields = 0;
        let legacyCount = 0;

        rows.forEach(row => {
            if (row.user_id) uniqueUsers.add(row.user_id.toString());
            if (row.business_id) uniqueBusinesses.add(row.business_id.toString());
            changedFields += row.changed_fields_count || 0;
            if (row.action === 'legacy_snapshot') legacyCount += 1;
            const stat = row.new_data?.status || 'pending';
            statusCounts[stat] = (statusCounts[stat] || 0) + 1;
        });

        return res.status(200).json({
            total_events: rows.length,
            active_users: uniqueUsers.size,
            businesses_updated: uniqueBusinesses.size,
            changed_fields_count: changedFields,
            legacy_count: legacyCount,
            status_counts: statusCounts,
        });
    } catch (error) {
        console.error('Get GBP Daily Summary Error:', error);
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Internal Server Error' });
    }
};
// Get single record by ID
const getGbpUpdateById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid record ID' });
        }

        const record = await GoogleBusinessProfileUpdates.findById(id)
            .populate('business_id', 'business_name location short_code business_link')
            .populate('user_id', 'username email')
            .populate('updated_by', 'username email')
            .lean();

        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        // Authorization checks
        if (req.user.role === 'user') {
            const assignedIds = (req.user.assigned_businesses || []).map(bid => bid.toString());
            if (!assignedIds.includes(record.business_id._id.toString())) {
                return res.status(403).json({ error: 'Access denied: Business is not assigned to you' });
            }
        } else if (req.user.role === 'admin') {
            const recordUser = await User.findById(record.user_id._id).lean();
            const isManaged = Array.isArray(recordUser.managed_by)
                ? recordUser.managed_by.some(id => id.toString() === req.user._id.toString())
                : recordUser.managed_by?.toString() === req.user._id.toString();
            if (!recordUser || (!isManaged && record.user_id._id.toString() !== req.user._id.toString())) {
                return res.status(403).json({ error: 'Access denied: Existing record belongs to a user you do not manage' });
            }
        }

        return res.status(200).json(record);

    } catch (error) {
        console.error('Get GBP Update By ID Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Get records by Business
const getGbpUpdatesByBusiness = async (req, res) => {
    try {
        const { businessId } = req.params;
        const { month } = req.query;

        if (!mongoose.Types.ObjectId.isValid(businessId)) {
            return res.status(400).json({ error: 'Invalid business ID' });
        }

        if (month && !validateMonth(month)) {
            return res.status(400).json({ error: 'month must be in YYYY-MM format' });
        }

        // User auth check
        if (req.user.role === 'user') {
            const assignedIds = (req.user.assigned_businesses || []).map(bid => bid.toString());
            if (!assignedIds.includes(businessId.toString())) {
                return res.status(403).json({ error: 'Access denied to this business' });
            }
        }

        let filter = await buildRoleFilter(req);
        filter.business_id = businessId;
        filter = buildMonthAwareFilter(filter, month);

        const records = await GoogleBusinessProfileUpdates.find(filter)
            .populate('business_id', 'business_name location short_code business_link')
            .populate('user_id', 'username email')
            .populate('updated_by', 'username email')
            .sort({ month: -1 })
            .lean();

        const data = mergeEffectiveMonthlyRecords(records, month);

        return res.status(200).json(data);

    } catch (error) {
        console.error('Get GBP Updates By Business Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Get summary for a month
const getGbpUpdatesSummary = async (req, res) => {
    try {
        const { month } = req.query;

        if (!month) {
            return res.status(400).json({ error: 'month parameter is required' });
        }

        if (!validateMonth(month)) {
            return res.status(400).json({ error: 'month must be in YYYY-MM format' });
        }

        let filter = await buildRoleFilter(req);
        filter = buildMonthAwareFilter(filter, month);

        const records = mergeEffectiveMonthlyRecords(
            await GoogleBusinessProfileUpdates.find(filter).lean(),
            month
        );

        const summary = {
            total_records: records.length,
            status_counts: {
                pending: 0,
                in_progress: 0,
                completed: 0,
                suspended: 0,
                404: 0
            },
            total_product_count: 0,
            total_service_count: 0,
            total_media_count: 0,
            total_scheduled_posts_count: 0
        };

        records.forEach(r => {
            const stat = r.status || 'pending';
            if (summary.status_counts[stat] !== undefined) {
                summary.status_counts[stat]++;
            } else {
                summary.status_counts[stat] = 1;
            }
            summary.total_product_count += r.product_count || 0;
            summary.total_service_count += r.service_count || 0;
            summary.total_media_count += r.media_count || 0;
            summary.total_scheduled_posts_count += r.scheduled_posts_count || 0;
        });

        return res.status(200).json(summary);

    } catch (error) {
        console.error('Get GBP Updates Summary Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Delete record if allowed
const deleteGbpUpdate = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid record ID' });
        }

        const record = await GoogleBusinessProfileUpdates.findById(id);
        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        // Authorization checks
        if (req.user.role === 'user') {
            const assignedIds = (req.user.assigned_businesses || []).map(bid => bid.toString());
            const isAssigned = assignedIds.includes(record.business_id.toString());
            const isCreator = record.user_id.toString() === req.user._id.toString();

            if (!isAssigned || !isCreator) {
                return res.status(403).json({ error: 'Access denied: You can only delete your own records for assigned businesses' });
            }
        } else if (req.user.role === 'admin') {
            const recordUser = await User.findById(record.user_id).lean();
            const isManaged = Array.isArray(recordUser.managed_by)
                ? recordUser.managed_by.some(id => id.toString() === req.user._id.toString())
                : recordUser.managed_by?.toString() === req.user._id.toString();
            if (!recordUser || (!isManaged && record.user_id.toString() !== req.user._id.toString())) {
                return res.status(403).json({ error: 'Access denied: Record belongs to a user you do not manage' });
            }
        }

        await GoogleBusinessProfileUpdates.findByIdAndDelete(id);

        return res.status(200).json({ message: 'Record deleted successfully' });

    } catch (error) {
        console.error('Delete GBP Update Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
    createGbpUpdate,
    updateGbpUpdate,
    getGbpUpdates,
    getGbpUpdateById,
    getGbpUpdatesByBusiness,
    getGbpUpdatesSummary,
    getGbpDailyActivities,
    getGbpDailySummary,
    deleteGbpUpdate
};








