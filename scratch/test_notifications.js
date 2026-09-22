const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../model/user');
const Business = require('../model/Business');
const Notification = require('../model/Notification');
const Review = require('../model/review');
const {
    checkUserCompletionForBusiness,
    sendPendingWorkAlerts
} = require('../services/notificationService');

const runTest = async () => {
    let dummyAdmin = null;
    let dummyUser = null;
    let dummyBusiness = null;
    let dummyReview = null;

    try {
        console.log('Connecting to database...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected!');

        // 1. Create a dummy Admin (Manager)
        console.log('Creating dummy admin...');
        dummyAdmin = await User.create({
            email: 'dummy_admin_test@omega.com',
            username: 'dummy_admin_test',
            password_hash: 'hashedpassworddummy',
            role: 'admin',
            is_active: true
        });

        // 2. Create a dummy User assigned to the manager
        console.log('Creating dummy user...');
        dummyUser = await User.create({
            email: 'dummy_user_test@omega.com',
            username: 'dummy_user_test',
            password_hash: 'hashedpassworddummy',
            role: 'user',
            managed_by: [dummyAdmin._id],
            scopes: ['review_management'],
            is_active: true
        });

        // 3. Create a dummy Business that is 6 days old (introductory period expires in 1 day)
        console.log('Creating dummy business (6 days old)...');
        const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
        dummyBusiness = await Business.create({
            business_name: 'Dummy Test Business Inc',
            location: 'Test City',
            short_code: 'DUMMYTEST',
            is_returnDocument: "after",
            user_id: dummyAdmin._id,
            createdAt: sixDaysAgo
        });

        // 4. Assign Business to the User
        console.log('Assigning business to user...');
        dummyUser.assigned_businesses = [dummyBusiness._id];
        await dummyUser.save();

        // 5. Test checkUserCompletionForBusiness before work is done
        console.log('Checking completion (should be false)...');
        const isCompletedBefore = await checkUserCompletionForBusiness(dummyUser._id, dummyBusiness._id);
        console.log('Completion status before:', isCompletedBefore);
        if (isCompletedBefore !== false) {
            throw new Error('Completion status should be false before work is done');
        }

        // 6. Clear any old notifications if any
        await Notification.deleteMany({
            $or: [
                { user_id: dummyUser._id },
                { user_id: dummyAdmin._id }
            ]
        });

        // 7. Run sendPendingWorkAlerts (Simulating cron job)
        console.log('Running daily pending work alerts...');
        await sendPendingWorkAlerts();

        // 8. Verify Notifications exist in DB
        console.log('Verifying notifications...');
        const userNotifs = await Notification.find({ user_id: dummyUser._id }).lean();
        const adminNotifs = await Notification.find({ user_id: dummyAdmin._id }).lean();

        console.log(`User notifications count: ${userNotifs.length}`);
        console.log(`Admin notifications count: ${adminNotifs.length}`);

        if (userNotifs.length === 0) {
            throw new Error('No pending work notification created for the assigned user');
        }
        if (adminNotifs.length === 0) {
            throw new Error('No pending work alert notification created for the managing admin');
        }

        console.log('User notification detail:', userNotifs[0].message);
        console.log('Admin notification detail:', adminNotifs[0].message);

        if (!userNotifs[0].message.includes('Dummy Test Business Inc') || !userNotifs[0].message.includes('1 day')) {
            throw new Error('User notification message does not match expected business and days left');
        }

        // 9. Add Review to complete the workspace task
        console.log('Completing task: adding review...');
        dummyReview = await Review.create({
            user_id: dummyUser._id,
            business_id: dummyBusiness._id,
            review_count: 5,
            review_date: new Date()
        });

        // 10. Test checkUserCompletionForBusiness after work is done
        console.log('Checking completion (should be true)...');
        const isCompletedAfter = await checkUserCompletionForBusiness(dummyUser._id, dummyBusiness._id);
        console.log('Completion status after:', isCompletedAfter);
        if (isCompletedAfter !== true) {
            throw new Error('Completion status should be true after reviews are added');
        }

        console.log('🎉 Integration tests completed successfully!');
    } catch (error) {
        console.error('❌ Integration tests failed:', error);
    } finally {
        // Clean up
        console.log('Cleaning up database...');
        if (dummyUser) await User.deleteOne({ _id: dummyUser._id });
        if (dummyAdmin) await User.deleteOne({ _id: dummyAdmin._id });
        if (dummyBusiness) await Business.deleteOne({ _id: dummyBusiness._id });
        if (dummyReview) await Review.deleteOne({ _id: dummyReview._id });
        if (dummyUser && dummyAdmin) {
            await Notification.deleteMany({
                $or: [
                    { user_id: dummyUser._id },
                    { user_id: dummyAdmin._id }
                ]
            });
        }
        await mongoose.connection.close();
        console.log('Database connection closed.');
    }
};

runTest();
