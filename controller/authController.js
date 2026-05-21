const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../model/user');
const Reviews = require('../model/review');

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const JWT_EXPIRES = '7d';
const PASSWORD_MIN_LENGTH = 8;

const normalizeEmail = (email = '') => email.trim().toLowerCase();

const buildAuthResponse = (user) => ({
    id: user._id,
    email: user.email,
    username: user.username,
    role: user.role,
    ai_review_access: user.role === 'super_admin' || !!user.ai_review_access,
    has_password: !!user.password_hash,
});

const signToken = (user) => jwt.sign(
    { id: user._id, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
);

const validatePassword = (password) =>
    typeof password === 'string' && password.length >= PASSWORD_MIN_LENGTH;

// signup or login with google 
const googleAuth = async (req, res) => {
    try {
        const { email, username, google_id } = req.body;
        const normalizedEmail = normalizeEmail(email);

        if (!normalizedEmail || !google_id) {
            return res.status(400).json({ error: 'Email and Google ID required' });
        }

        let user = await User.findOne({ email: normalizedEmail }).select('+password_hash');

        if (!user) {
            user = await User.create({
                email: normalizedEmail,
                username,
                google_id,
                last_login: new Date(),
            });
        } else {
            if (user.is_deleted || !user.is_active) {
                return res.status(401).json({ error: 'Invalid or inactive user' });
            }
            if (!user.google_id) {
                user.google_id = google_id;
            }
            if (!user.username && username) {
                user.username = username;
            }
            user.last_login = new Date();
            await user.save();
        }

        const token = signToken(user);

        return res.status(200).json({
            message: 'Authentication successful',
            token,
            user: buildAuthResponse(user),
        });

    } catch (error) {
        console.error('Google Auth Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// signup with email and password
const signup = async (req, res) => {
    try {
        const { email, username, password } = req.body;
        const normalizedEmail = normalizeEmail(email);

        if (!normalizedEmail || !validatePassword(password)) {
            return res.status(400).json({
                error: `Email and password of at least ${PASSWORD_MIN_LENGTH} characters are required`,
            });
        }

        const existingUser = await User.findOne({ email: normalizedEmail }).lean();
        if (existingUser) {
            return res.status(409).json({ error: 'Account already exists for this email' });
        }

        const user = await User.create({
            email: normalizedEmail,
            username,
            password_hash: await bcrypt.hash(password, 12),
            last_login: new Date(),
        });

        return res.status(201).json({
            message: 'Signup successful',
            token: signToken(user),
            user: buildAuthResponse(user),
        });
    } catch (error) {
        console.error('Signup Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// login with email and password
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = normalizeEmail(email);

        if (!normalizedEmail || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const user = await User.findOne({
            email: normalizedEmail,
            is_deleted: false,
        }).select('+password_hash');

        if (!user || !user.is_active || !user.password_hash) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const passwordMatches = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatches) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        user.last_login = new Date();
        await user.save();

        return res.status(200).json({
            message: 'Authentication successful',
            token: signToken(user),
            user: buildAuthResponse(user),
        });
    } catch (error) {
        console.error('Login Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getCurrentUser = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('+password_hash');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.status(200).json({
            ...buildAuthResponse(user),
        });
    } catch (error) {
        console.error('Get Current User Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const updatePassword = async (req, res) => {
    try {
        const { current_password, new_password } = req.body;

        if (!validatePassword(new_password)) {
            return res.status(400).json({
                error: `New password must be at least ${PASSWORD_MIN_LENGTH} characters`,
            });
        }

        const user = await User.findById(req.user._id).select('+password_hash');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.password_hash) {
            if (!current_password) {
                return res.status(400).json({ error: 'Current password required' });
            }

            const passwordMatches = await bcrypt.compare(current_password, user.password_hash);
            if (!passwordMatches) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
        }

        const hadPassword = !!user.password_hash;
        user.password_hash = await bcrypt.hash(new_password, 12);
        await user.save();

        return res.status(200).json({
            message: hadPassword ? 'Password updated successfully' : 'Password set successfully',
        });
    } catch (error) {
        console.error('Update Password Error:', error);
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
                    password_hash: 0,
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
            .select('-__v -password_hash')
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
            { returnDocument: 'after' }
        ).select('-password_hash').lean();

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
            { returnDocument: 'after' }
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
            { returnDocument: 'after' }
        ).select('-__v -password_hash').lean();

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
    signup,
    login,
    logout,
    getCurrentUser,
    updatePassword,
    getAllUsers,
    getUserById,
    updateUserStatus,
    deleteUser,
    assignBusinessesToUser
}
