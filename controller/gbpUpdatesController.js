const mongoose = require('mongoose');
const GoogleBusinessProfileUpdates = require('../model/GoogleBusinessProfileUpdates');
const User = require('../model/user');
const Business = require('../model/Business');

// Helpers for validation
const validateMonth = (month) => {
    return typeof month === 'string' && /^\d{4}-\d{2}$/.test(month);
};

const validateCount = (val) => {
    if (val === undefined || val === null) return true;
    return Number.isInteger(Number(val)) && Number(val) >= 0;
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
            user_id
        } = req.body;

        // Basic validations
        if (!business_id || !month) {
            return res.status(400).json({ error: 'business_id and month are required' });
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

        // Check if record already exists for this business + month
        let record = await GoogleBusinessProfileUpdates.findOne({ business_id, month });

        if (record) {
            // Check if requester is allowed to update this existing record
            if (req.user.role === 'admin') {
                const recordUser = await User.findById(record.user_id).lean();
                if (!recordUser || (recordUser.managed_by?.toString() !== req.user._id.toString() && record.user_id.toString() !== req.user._id.toString())) {
                    return res.status(403).json({ error: 'Access denied: Existing record belongs to a user you do not manage' });
                }
            }

            // Update fields
            if (product_count !== undefined) record.product_count = product_count;
            if (service_count !== undefined) record.service_count = service_count;
            if (media_count !== undefined) record.media_count = media_count;
            if (post_start_date !== undefined) record.post_start_date = post_start_date ? new Date(post_start_date) : null;
            if (post_end_date !== undefined) record.post_end_date = post_end_date ? new Date(post_end_date) : null;
            if (scheduled_posts_count !== undefined) record.scheduled_posts_count = scheduled_posts_count;
            if (update_link !== undefined) record.update_link = update_link;
            if (status !== undefined) record.status = status;
            if (remarks !== undefined) record.remarks = remarks;
            
            if (req.user.role !== 'user' && user_id) {
                record.user_id = targetUserId;
            }
            
            record.updated_by = req.user._id;

            await record.save();

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
                product_count: product_count || 0,
                service_count: service_count || 0,
                media_count: media_count || 0,
                post_start_date: post_start_date ? new Date(post_start_date) : null,
                post_end_date: post_end_date ? new Date(post_end_date) : null,
                scheduled_posts_count: scheduled_posts_count || 0,
                update_link,
                status: status || 'pending',
                remarks,
                updated_by: req.user._id
            });

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
            user_id
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
            if (!recordUser || (recordUser.managed_by?.toString() !== req.user._id.toString() && record.user_id.toString() !== req.user._id.toString())) {
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

        // Update fields
        if (product_count !== undefined) record.product_count = product_count;
        if (service_count !== undefined) record.service_count = service_count;
        if (media_count !== undefined) record.media_count = media_count;
        if (post_start_date !== undefined) record.post_start_date = post_start_date ? new Date(post_start_date) : null;
        if (post_end_date !== undefined) record.post_end_date = post_end_date ? new Date(post_end_date) : null;
        if (scheduled_posts_count !== undefined) record.scheduled_posts_count = scheduled_posts_count;
        if (update_link !== undefined) record.update_link = update_link;
        if (status !== undefined) record.status = status;
        if (remarks !== undefined) record.remarks = remarks;

        record.updated_by = req.user._id;

        await record.save();

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
        const { month, page = 1, limit = 20, search = '' } = req.query;

        if (month && !validateMonth(month)) {
            return res.status(400).json({ error: 'month must be in YYYY-MM format' });
        }

        const skip = (Number(page) - 1) * Number(limit);

        let filter = {};

        if (month) {
            filter.month = month;
        }

        // Role-based filters
        if (req.user.role === 'user') {
            const assignedIds = req.user.assigned_businesses || [];
            filter.business_id = { $in: assignedIds };
        } else if (req.user.role === 'admin') {
            const managedUsers = await User.find({ managed_by: req.user._id, is_deleted: false }).select('_id').lean();
            const userIds = [req.user._id, ...managedUsers.map(u => u._id)];
            filter.user_id = { $in: userIds };
        }

        // Search businesses by name
        if (search) {
            const matchingBusinesses = await Business.find({
                $or: [
                    { business_name: { $regex: search, $options: 'i' } },
                    { location: { $regex: search, $options: 'i' } },
                    { short_code: { $regex: search, $options: 'i' } }
                ]
            }).select('_id').lean();

            const businessIds = matchingBusinesses.map(b => b._id);
            
            if (filter.business_id) {
                const userAssignedIdsStr = filter.business_id.$in.map(id => id.toString());
                const matchingIds = businessIds.filter(id => userAssignedIdsStr.includes(id.toString()));
                filter.business_id = { $in: matchingIds };
            } else {
                filter.business_id = { $in: businessIds };
            }
        }

        const data = await GoogleBusinessProfileUpdates.find(filter)
            .populate('business_id', 'business_name location short_code business_link')
            .populate('user_id', 'username email')
            .populate('updated_by', 'username email')
            .sort({ month: -1, createdAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .lean();

        const total = await GoogleBusinessProfileUpdates.countDocuments(filter);

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
            if (!recordUser || (recordUser.managed_by?.toString() !== req.user._id.toString() && record.user_id._id.toString() !== req.user._id.toString())) {
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

        let filter = { business_id: businessId };
        if (month) {
            filter.month = month;
        }

        if (req.user.role === 'admin') {
            const managedUsers = await User.find({ managed_by: req.user._id, is_deleted: false }).select('_id').lean();
            const userIds = [req.user._id, ...managedUsers.map(u => u._id)];
            filter.user_id = { $in: userIds };
        }

        const data = await GoogleBusinessProfileUpdates.find(filter)
            .populate('business_id', 'business_name location short_code business_link')
            .populate('user_id', 'username email')
            .populate('updated_by', 'username email')
            .sort({ month: -1 })
            .lean();

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

        let filter = { month };

        if (req.user.role === 'user') {
            const assignedIds = req.user.assigned_businesses || [];
            filter.business_id = { $in: assignedIds };
        } else if (req.user.role === 'admin') {
            const managedUsers = await User.find({ managed_by: req.user._id, is_deleted: false }).select('_id').lean();
            const userIds = [req.user._id, ...managedUsers.map(u => u._id)];
            filter.user_id = { $in: userIds };
        }

        const records = await GoogleBusinessProfileUpdates.find(filter).lean();

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
            if (!recordUser || (recordUser.managed_by?.toString() !== req.user._id.toString() && record.user_id.toString() !== req.user._id.toString())) {
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
    deleteGbpUpdate
};
