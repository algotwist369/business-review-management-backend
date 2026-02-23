const mongoose = require('mongoose');
const User = require('../model/user');

// Assign a user to an admin
const assignUserToAdmin = async (req, res) => {
    try {
        const { userId, adminId } = req.body;

        if (!mongoose.Types.ObjectId.isValid(userId) || (adminId && !mongoose.Types.ObjectId.isValid(adminId))) {
            return res.status(400).json({ error: 'Invalid ID provided' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (adminId) {
            const admin = await User.findById(adminId);
            if (!admin || admin.role !== 'admin') {
                return res.status(400).json({ error: 'Invalid admin ID' });
            }
            user.managed_by = adminId;
        } else {
            user.managed_by = null;
        }

        await user.save();

        return res.status(200).json({
            message: 'User assignment updated successfully',
            user: {
                id: user._id,
                email: user.email,
                managed_by: user.managed_by
            }
        });

    } catch (error) {
        console.error('Assign User Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Update user role
const updateUserRole = async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!['user', 'admin', 'super_admin'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const updatedUser = await User.findByIdAndUpdate(
            id,
            { role },
            { new: true }
        ).select('-__v').lean();

        if (!updatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.status(200).json({
            message: 'User role updated successfully',
            user: updatedUser
        });

    } catch (error) {
        console.error('Update Role Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
    assignUserToAdmin,
    updateUserRole
};
