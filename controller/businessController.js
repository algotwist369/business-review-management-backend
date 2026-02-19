const mongoose = require('mongoose');
const Business = require('../model/Business');

// add business
const addBusiness = async (req, res) => {
    try {
        const { business_name, location, short_code } = req.body;

        // Basic validation (fast fail)
        if (!business_name || !location || !short_code) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Ensure only admin can create
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admin can create business' });
        }

        // Check duplicate (lean = less memory)
        const existingBusiness = await Business.findOne({
            $or: [{ short_code }],
        }).lean();

        if (existingBusiness) {
            return res.status(400).json({
                error: 'Business name or short code already exists',
            });
        }

        // Create directly (no extra object instantiation)
        const savedBusiness = await Business.create({
            business_name,
            location,
            short_code,
            is_active: true,
            user_id: req.user._id,
        });

        return res.status(201).json(savedBusiness);
    } catch (error) {
        console.error('Add Business Error:', error);

        // Handle duplicate index error (better performance handling)
        if (error.code === 11000) {
            return res.status(400).json({
                error: 'Business short code already exists',
            });
        }

        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
// gett all business
const getAllBusiness = async (req, res) => {
    try {
        if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'user')) {
            return res.status(403).json({ error: 'Unauthorized access' });
        }

        const { page = 1, limit = 10 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        // Filter: Admin sees all, users only see active
        const filter = req.user.role === 'admin' ? {} : { is_active: true };

        const businesses = await Business.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .lean(); // low memory usage

        const total = await Business.countDocuments(filter);

        return res.status(200).json({
            total,
            page: Number(page),
            limit: Number(limit),
            data: businesses,
        });
    } catch (error) {
        console.error('Get All Business Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// edit business
const editBusiness = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admin can edit business' });
        }

        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid business ID' });
        }

        const updatedBusiness = await Business.findByIdAndUpdate(
            id,
            { $set: req.body },
            {
                new: true,
                runValidators: true,
            }
        ).lean();

        if (!updatedBusiness) {
            return res.status(404).json({ error: 'Business not found' });
        }

        return res.status(200).json(updatedBusiness);

    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({
                error: 'Business name or short code already exists',
            });
        }

        console.error('Edit Business Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// delete business\
const deleteBusiness = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admin can delete business' });
        }

        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid business ID' });
        }

        const deleted = await Business.findByIdAndDelete(id);

        if (!deleted) {
            return res.status(404).json({ error: 'Business not found' });
        }

        return res.status(200).json({ message: 'Business deleted successfully' });

    } catch (error) {
        console.error('Delete Business Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// update business status (active/inactive)
const updateBusinessStatus = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admin can update status' });
        }

        const { id } = req.params;
        const { is_active } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid business ID' });
        }

        if (typeof is_active !== 'boolean') {
            return res.status(400).json({ error: 'is_active must be boolean' });
        }

        const updated = await Business.findByIdAndUpdate(
            id,
            { $set: { is_active } },
            { new: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({ error: 'Business not found' });
        }

        return res.status(200).json(updated);

    } catch (error) {
        console.error('Update Business Status Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};


module.exports = {
    addBusiness,
    getAllBusiness,
    editBusiness,
    deleteBusiness,
    updateBusinessStatus
}