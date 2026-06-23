const mongoose = require('mongoose');
const GoogleAdsTeam = require('../model/GoogleAdsTeam');
const User = require('../model/user');
const Business = require('../model/Business');

// Get all Google Ads records
const getGoogleAdsRecords = async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '', status = '' } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const allowedStatus = ['pending', 'in_progress', 'completed', 'suspended', '404'];
        if (status && !allowedStatus.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${allowedStatus.join(', ')}` });
        }

        let filter = {};

        if (status) {
            filter.status = status;
        }

        // Role-based filters
        if (req.user.role === 'user') {
            const assignedIds = req.user.assigned_businesses || [];
            filter.business_id = { $in: assignedIds };
            filter.user_id = req.user._id;
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

        const data = await GoogleAdsTeam.find(filter)
            .populate('business_id', 'business_name location short_code business_link')
            .populate('user_id', 'username email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .lean();

        const total = await GoogleAdsTeam.countDocuments(filter);

        return res.status(200).json({
            total,
            page: Number(page),
            limit: Number(limit),
            data
        });
    } catch (error) {
        console.error('Get Google Ads Records Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Create or update Google Ads record
const createOrUpdateGoogleAdsRecord = async (req, res) => {
    try {
        const {
            business_id,
            is_gmb_created,
            is_whatsapp_live,
            is_number_verified,
            status,
            remarks,
            user_id
        } = req.body;

        if (!business_id) {
            return res.status(400).json({ error: 'business_id is required' });
        }

        // Check if business exists
        const business = await Business.findById(business_id).lean();
        if (!business) {
            return res.status(404).json({ error: 'Business not found' });
        }

        // Enforce user scoping
        if (req.user.role === 'user') {
            const assignedIds = (req.user.assigned_businesses || []).map(id => id.toString());
            if (!assignedIds.includes(business_id.toString())) {
                return res.status(403).json({ error: 'Access denied to this business' });
            }
        }

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

        let record = await GoogleAdsTeam.findOne({ user_id: targetUserId, business_id });

        if (record) {
            // Check admin authorization
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
            if (is_gmb_created !== undefined) record.is_gmb_created = is_gmb_created;
            if (is_whatsapp_live !== undefined) record.is_whatsapp_live = is_whatsapp_live;
            if (is_number_verified !== undefined) record.is_number_verified = is_number_verified;
            if (status !== undefined) record.status = status;
            if (remarks !== undefined) record.remarks = remarks;

            if (req.user.role !== 'user' && user_id) {
                record.user_id = targetUserId;
            }

            await record.save();

            const populated = await GoogleAdsTeam.findById(record._id)
                .populate('business_id', 'business_name location short_code business_link')
                .populate('user_id', 'username email')
                .lean();

            return res.status(200).json({
                message: 'Google Ads record updated successfully',
                data: populated
            });
        } else {
            // Create new record
            const newRecord = await GoogleAdsTeam.create({
                user_id: targetUserId,
                business_id,
                is_gmb_created: is_gmb_created || {},
                is_whatsapp_live: is_whatsapp_live || {},
                is_number_verified: is_number_verified || {},
                status: status || 'pending',
                remarks
            });

            const populated = await GoogleAdsTeam.findById(newRecord._id)
                .populate('business_id', 'business_name location short_code business_link')
                .populate('user_id', 'username email')
                .lean();

            return res.status(201).json({
                message: 'Google Ads record created successfully',
                data: populated
            });
        }
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'A Google Ads record already exists for this business. Please refresh and try again.' });
        }
        console.error('Create/Update Google Ads Record Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
    getGoogleAdsRecords,
    createOrUpdateGoogleAdsRecord
};
