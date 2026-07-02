const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../model/user');
const Business = require('../model/Business');
const GoogleBusinessProfileUpdates = require('../model/GoogleBusinessProfileUpdates');

const runTests = async () => {
    try {
        console.log('Connecting to database...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected!');

        // 1. Create test entities
        console.log('Creating test entities...');
        const testAdmin = await User.create({
            username: 'TestAdmin',
            email: 'testadmin@example.com',
            role: 'admin',
            scopes: ['review_management']
        });

        const testUser = await User.create({
            username: 'TestUser',
            email: 'testuser@example.com',
            role: 'user',
            managed_by: testAdmin._id,
            scopes: ['review_management'] // default
        });

        const testBusiness = await Business.create({
            business_name: 'Test Business ' + Date.now(),
            location: 'Test Location',
            short_code: 'TESTBC_' + Date.now(),
            user_id: testAdmin._id
        });

        // 2. Test scope assignment logic directly via User findAndUpdate
        console.log('Testing scope assignment...');
        const updatedUser = await User.findOneAndUpdate(
            { _id: testUser._id, managed_by: testAdmin._id },
            { $set: { scopes: ['review_management', 'gbp_record_management'] } },
            { returnDocument: "after" }
        );
        if (!updatedUser.scopes.includes('gbp_record_management')) {
            throw new Error('Scope assignment failed');
        }
        console.log('✓ Scope assignment successful!');

        // 3. Test record creation validation (controllers mock)
        console.log('Testing monthly GBP update record creation...');
        
        // Let's test negative count check (mocking createGbpUpdate validation)
        const validateCount = (val) => Number.isInteger(Number(val)) && Number(val) >= 0;
        if (validateCount(-5)) {
            throw new Error('Count validation allowed negative values');
        }

        // Test normal record creation
        const record = await GoogleBusinessProfileUpdates.create({
            user_id: testUser._id,
            business_id: testBusiness._id,
            month: '2026-06',
            product_count: 5,
            service_count: 3,
            media_count: 12,
            post_start_date: new Date('2026-06-01'),
            post_end_date: new Date('2026-07-01'),
            scheduled_posts_count: 15,
            status: 'completed',
            remarks: 'All is completed for this location',
            updated_by: testUser._id
        });
        console.log('✓ Record created successfully: ID', record._id);

        // 4. Test duplicate business_id + month
        console.log('Testing duplicate record handling...');
        try {
            await GoogleBusinessProfileUpdates.create({
                user_id: testUser._id,
                business_id: testBusiness._id,
                month: '2026-06',
                product_count: 10,
                service_count: 6,
                media_count: 24,
                post_start_date: new Date('2026-06-01'),
                post_end_date: new Date('2026-07-01'),
                scheduled_posts_count: 30,
                status: 'completed',
                remarks: 'Duplicate entry',
                updated_by: testUser._id
            });
            throw new Error('Mongoose index did not catch duplicate business_id + month');
        } catch (err) {
            if (err.code === 11000) {
                console.log('✓ Duplicate record caught by index successfully!');
            } else {
                throw err;
            }
        }

        // 5. Cleanup
        console.log('Cleaning up test data...');
        await User.deleteOne({ _id: testAdmin._id });
        await User.deleteOne({ _id: testUser._id });
        await Business.deleteOne({ _id: testBusiness._id });
        await GoogleBusinessProfileUpdates.deleteOne({ _id: record._id });
        console.log('✓ Cleanup completed!');

        console.log('ALL direct database tests passed successfully!');
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await mongoose.connection.close();
        console.log('Database connection closed.');
    }
};

runTests();
