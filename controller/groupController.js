const mongoose = require('mongoose');
const Group = require('../model/Group');
const Business = require('../model/Business');

const BUSINESS_POPULATE_FIELDS = 'business_name location business_link is_active';

const toStringSet = (items = []) => new Set(items.map((item) => item.toString()));

const createGroup = async (req, res) => {
    try {
        const { groupName, businessIds = [] } = req.body;

        if (!groupName || !groupName.trim()) {
            return res.status(400).json({ error: 'groupName is required' });
        }

        const normalizedIds = [...new Set((businessIds || []).map((id) => id?.toString()))];
        const hasInvalidId = normalizedIds.some((id) => !mongoose.Types.ObjectId.isValid(id));
        if (hasInvalidId) {
            return res.status(400).json({ error: 'Invalid business ID provided' });
        }

        const assignedSet = toStringSet(req.user.assigned_businesses);
        const hasUnassignedId = normalizedIds.some((id) => !assignedSet.has(id));
        if (hasUnassignedId) {
            return res.status(403).json({ error: 'You can only group your assigned businesses' });
        }

        if (normalizedIds.length > 0) {
            const existingCount = await Business.countDocuments({ _id: { $in: normalizedIds } });
            if (existingCount !== normalizedIds.length) {
                return res.status(404).json({ error: 'One or more businesses were not found' });
            }
        }

        const group = await Group.create({
            userId: req.user._id,
            groupName: groupName.trim(),
            businessIds: normalizedIds,
        });

        const created = await Group.findById(group._id).populate('businessIds', BUSINESS_POPULATE_FIELDS).lean();

        return res.status(201).json(created);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ error: 'Group name already exists' });
        }
        console.error('Create Group Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getUserGroups = async (req, res) => {
    try {
        const groups = await Group.find({ userId: req.user._id })
            .populate('businessIds', BUSINESS_POPULATE_FIELDS)
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json(groups);
    } catch (error) {
        console.error('Get User Groups Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const addBusinessToGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { businessId } = req.body;

        if (!mongoose.Types.ObjectId.isValid(groupId) || !mongoose.Types.ObjectId.isValid(businessId)) {
            return res.status(400).json({ error: 'Invalid ID provided' });
        }

        const assignedSet = toStringSet(req.user.assigned_businesses);
        if (!assignedSet.has(businessId.toString())) {
            return res.status(403).json({ error: 'You can only group your assigned businesses' });
        }

        const business = await Business.exists({ _id: businessId });
        if (!business) {
            return res.status(404).json({ error: 'Business not found' });
        }

        const updated = await Group.findOneAndUpdate(
            { _id: groupId, userId: req.user._id },
            { $addToSet: { businessIds: businessId } },
            { returnDocument: 'after' }
        )
            .populate('businessIds', BUSINESS_POPULATE_FIELDS)
            .lean();

        if (!updated) {
            return res.status(404).json({ error: 'Group not found' });
        }

        return res.status(200).json(updated);
    } catch (error) {
        console.error('Add Business To Group Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const removeBusinessFromGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { businessId } = req.body;

        if (!mongoose.Types.ObjectId.isValid(groupId) || !mongoose.Types.ObjectId.isValid(businessId)) {
            return res.status(400).json({ error: 'Invalid ID provided' });
        }

        const updated = await Group.findOneAndUpdate(
            { _id: groupId, userId: req.user._id },
            { $pull: { businessIds: businessId } },
            { returnDocument: 'after' }
        )
            .populate('businessIds', BUSINESS_POPULATE_FIELDS)
            .lean();

        if (!updated) {
            return res.status(404).json({ error: 'Group not found' });
        }

        return res.status(200).json(updated);
    } catch (error) {
        console.error('Remove Business From Group Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getBusinessesInGroup = async (req, res) => {
    try {
        const { groupId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(groupId)) {
            return res.status(400).json({ error: 'Invalid group ID' });
        }

        const group = await Group.findOne({ _id: groupId, userId: req.user._id })
            .populate('businessIds', BUSINESS_POPULATE_FIELDS)
            .lean();

        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        return res.status(200).json({
            groupId: group._id,
            groupName: group.groupName,
            businesses: group.businessIds || [],
        });
    } catch (error) {
        console.error('Get Group Businesses Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const updateGroupName = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { groupName } = req.body;

        if (!mongoose.Types.ObjectId.isValid(groupId)) {
            return res.status(400).json({ error: 'Invalid group ID' });
        }

        if (!groupName || !groupName.trim()) {
            return res.status(400).json({ error: 'groupName is required' });
        }

        const updated = await Group.findOneAndUpdate(
            { _id: groupId, userId: req.user._id },
            { $set: { groupName: groupName.trim() } },
            { returnDocument: 'after', runValidators: true }
        )
            .populate('businessIds', BUSINESS_POPULATE_FIELDS)
            .lean();

        if (!updated) {
            return res.status(404).json({ error: 'Group not found' });
        }

        return res.status(200).json(updated);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ error: 'Group name already exists' });
        }
        console.error('Update Group Name Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const deleteGroup = async (req, res) => {
    try {
        const { groupId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(groupId)) {
            return res.status(400).json({ error: 'Invalid group ID' });
        }

        const deleted = await Group.findOneAndDelete({ _id: groupId, userId: req.user._id }).lean();

        if (!deleted) {
            return res.status(404).json({ error: 'Group not found' });
        }

        return res.status(200).json({ message: 'Group deleted successfully' });
    } catch (error) {
        console.error('Delete Group Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
    createGroup,
    getUserGroups,
    addBusinessToGroup,
    removeBusinessFromGroup,
    getBusinessesInGroup,
    updateGroupName,
    deleteGroup,
};
