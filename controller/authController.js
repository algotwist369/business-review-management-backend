const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../model/user');
const Reviews = require('../model/review');

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const JWT_EXPIRES = '7d';

// signup or login with google 
const googleAuth = async (req, res) => {
    try {
        const { email, username, google_id } = req.body;

        if (!email || !google_id) {
            return res.status(400).json({ error: 'Email and Google ID required' });
        }

        let user = await User.findOne({ email });

        if (!user) {
            user = await User.create({
                email,
                username,
                google_id,
                last_login: new Date(),
            });
        } else {
            user.last_login = new Date();
            await user.save();
        }

        const token = jwt.sign(
            { id: user._id, role: user.role },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES }
        );

        return res.status(200).json({
            message: 'Authentication successful',
            token,
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
            },
        });

    } catch (error) {
        console.error('Google Auth Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// logout
const logout = async (req, res) => {
    return res.status(200).json({
        message: 'Logout successful. Please remove token on client side.',
    });
};

// get all users - admin/super_admin
const getAllUsers = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        // Filter: Super admin sees all (except themselves), admin sees only assigned users
        let filter = {
            is_deleted: false,
            _id: { $ne: new mongoose.Types.ObjectId(req.user.id || req.user._id) }
        };

        if (req.user.role === 'admin') {
            filter.managed_by = new mongoose.Types.ObjectId(req.user.id || req.user._id);
        }

        const users = await User.aggregate([
            { $match: filter },
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: Number(limit) },
            {
                $lookup: {
                    from: 'reviews',
                    localField: '_id',
                    foreignField: 'user_id',
                    as: 'userReviews'
                }
            },
            {
                $addFields: {
                    total_reviews: { $sum: '$userReviews.review_count' }
                }
            },
            {
                $project: {
                    userReviews: 0,
                    __v: 0
                }
            }
        ]);

        const total = await User.countDocuments(filter);

        return res.status(200).json({
            total,
            page: Number(page),
            limit: Number(limit),
            data: users,
        });

    } catch (error) {
        console.error('Get Users Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// get user by id - by admin/super_admin
const getUserById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        let filter = { _id: id, is_deleted: false };
        if (req.user.role === 'admin') {
            filter.managed_by = req.user.id || req.user._id;
        }

        const user = await User.findOne(filter)
            .select('-__v')
            .lean();

        if (!user) {
            return res.status(404).json({ error: 'User not found or access denied' });
        }

        return res.status(200).json(user);

    } catch (error) {
        console.error('Get User Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// update user status (active/inactive) - by admin/super_admin
const updateUserStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        if (typeof is_active !== 'boolean') {
            return res.status(400).json({ error: 'is_active must be boolean' });
        }

        let filter = { _id: id };
        if (req.user.role === 'admin') {
            filter.managed_by = req.user.id || req.user._id;
        }

        const updated = await User.findOneAndUpdate(
            filter,
            { is_active },
            { new: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({ error: 'User not found or access denied' });
        }

        return res.status(200).json(updated);

    } catch (error) {
        console.error('Update Status Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// delete user (admin/super_admin)
const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        let filter = { _id: id };
        if (req.user.role === 'admin') {
            filter.managed_by = req.user.id || req.user._id;
        }

        const deleted = await User.findOneAndUpdate(
            filter,
            { is_deleted: true, is_active: false },
            { new: true }
        );

        if (!deleted) {
            return res.status(404).json({ error: 'User not found or access denied' });
        }

        return res.status(200).json({
            message: 'User deleted successfully',
        });

    } catch (error) {
        console.error('Delete User Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// assign businesses to user (admin/super_admin)
const assignBusinessesToUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { businessIds } = req.body; // Array of business IDs

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        if (!Array.isArray(businessIds)) {
            return res.status(400).json({ error: 'businessIds must be an array' });
        }

        // Validate all business IDs
        const isValidIds = businessIds.every(bid => mongoose.Types.ObjectId.isValid(bid));
        if (!isValidIds) {
            return res.status(400).json({ error: 'One or more invalid business IDs' });
        }

        let filter = { _id: id };
        if (req.user.role === 'admin') {
            filter.managed_by = req.user.id || req.user._id;
        }

        const updatedUser = await User.findOneAndUpdate(
            filter,
            { $set: { assigned_businesses: businessIds } },
            { new: true }
        ).select('-__v').lean();

        if (!updatedUser) {
            return res.status(404).json({ error: 'User not found or access denied' });
        }

        return res.status(200).json({
            message: 'Businesses assigned successfully',
            user: updatedUser
        });

    } catch (error) {
        console.error('Assign Businesses Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
    googleAuth,
    logout,
    getAllUsers,
    getUserById,
    updateUserStatus,
    deleteUser,
    assignBusinessesToUser
}