const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../model/user');
const Business = require('../model/Business');
const Group = require('../model/Group');

// Import controllers
const businessController = require('../controller/businessController');
const canvaController = require('../controller/canvaController');
const jsTeamController = require('../controller/jsTeamController');
const webDevController = require('../controller/webDevController');
const leadsController = require('../controller/leadsController');
const googleAdsController = require('../controller/googleAdsController');
const socialMediaController = require('../controller/socialMediaController');
const gbpUpdatesController = require('../controller/gbpUpdatesController');
const groupController = require('../controller/groupController');

// Mock response helper
const mockResponse = () => {
    const res = {};
    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    res.json = (data) => {
        res.jsonData = data;
        return res;
    };
    return res;
};

const runTests = async () => {
    let testAdmin = null;
    let testUser = null;
    let testBusiness = null;
    let testGroup = null;

    try {
        console.log('Connecting to database...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected!');

        // Cleanup any potential old test entries
        await User.deleteMany({ username: { $regex: /^test_sec_/ } });
        await Business.deleteMany({ short_code: { $regex: /^sec_test_/ } });
        await Group.deleteMany({ groupName: { $regex: /^Sec Test Group/ } });

        console.log('Creating test admin and user...');
        testAdmin = await User.create({
            email: 'test_sec_admin@omega.com',
            username: 'test_sec_admin',
            password_hash: 'hashedpassword',
            role: 'admin',
            is_active: true
        });

        testUser = await User.create({
            email: 'test_sec_user@omega.com',
            username: 'test_sec_user',
            password_hash: 'hashedpassword',
            role: 'user',
            assigned_businesses: [],
            is_active: true
        });

        console.log('Creating a test business...');
        testBusiness = await Business.create({
            business_name: 'Sec Test Business',
            location: 'Test Location',
            short_code: 'sec_test_123',
            business_link: 'http://test.link',
            is_active: true,
            user_id: testAdmin._id
        });

        console.log('\n--- 1. Testing Business Sorting Whitelist ---');
        {
            // Valid sorting
            const req = {
                user: { role: 'admin', _id: testAdmin._id },
                query: { sortBy: 'location', sortOrder: 'asc' }
            };
            const res = mockResponse();
            await businessController.getAllBusiness(req, res);
            console.log('Valid sort (location, asc) status:', res.statusCode);
            if (res.statusCode !== 200) throw new Error('Expected 200 for valid sort');

            // Invalid sorting key
            const reqInvalidKey = {
                user: { role: 'admin', _id: testAdmin._id },
                query: { sortBy: 'non_existent_field_malicious', sortOrder: 'desc' }
            };
            const resInvalidKey = mockResponse();
            await businessController.getAllBusiness(reqInvalidKey, resInvalidKey);
            console.log('Invalid sort key status:', resInvalidKey.statusCode);
            if (resInvalidKey.statusCode !== 200) throw new Error('Expected 200 for invalid sort key (graceful default)');

            // Invalid sort order
            const reqInvalidOrder = {
                user: { role: 'admin', _id: testAdmin._id },
                query: { sortBy: 'createdAt', sortOrder: 'invalid_order_val' }
            };
            const resInvalidOrder = mockResponse();
            await businessController.getAllBusiness(reqInvalidOrder, resInvalidOrder);
            console.log('Invalid sort order status:', resInvalidOrder.statusCode);
            if (resInvalidOrder.statusCode !== 200) throw new Error('Expected 200 for invalid sort order (graceful default)');
        }

        console.log('\n--- 2. Testing Invalid business_id ObjectId Validations ---');
        const invalidId = 'not-a-valid-object-id';
        const controllersToTest = [
            { name: 'Canva', controller: canvaController, fn: 'createOrUpdateCanvaRecord' },
            { name: 'JS Team', controller: jsTeamController, fn: 'createOrUpdateJsRecord' },
            { name: 'Web Dev', controller: webDevController, fn: 'createOrUpdateWebDevRecord' },
            { name: 'Leads', controller: leadsController, fn: 'createOrUpdateLeadsRecord' },
            { name: 'Google Ads', controller: googleAdsController, fn: 'createOrUpdateGoogleAdsRecord' },
            { name: 'Social Media', controller: socialMediaController, fn: 'createOrUpdateSocialMediaRecord' },
            { name: 'GBP Updates', controller: gbpUpdatesController, fn: 'createGbpUpdate', body: { month: '2026-06' } }
        ];

        for (const target of controllersToTest) {
            const req = {
                user: { role: 'admin', _id: testAdmin._id },
                body: { business_id: invalidId, ...target.body }
            };
            const res = mockResponse();
            await target.controller[target.fn](req, res);
            console.log(`${target.name} validator status with invalid ID:`, res.statusCode);
            if (res.statusCode !== 400 || res.jsonData.error !== 'Invalid business_id') {
                throw new Error(`${target.name} failed to validate invalid business_id properly. Got ${res.statusCode} and ${JSON.stringify(res.jsonData)}`);
            }
        }
        console.log('All workflow business_id validations passed!');

        console.log('\n--- 3. Testing Admin Grouping Permission Bypass ---');
        {
            // Admin should be able to group a business not assigned to their assigned_businesses array
            const reqAdmin = {
                user: { role: 'admin', _id: testAdmin._id, assigned_businesses: [] },
                body: { groupName: 'Sec Test Group Admin', businessIds: [testBusiness._id.toString()] }
            };
            const resAdmin = mockResponse();
            await groupController.createGroup(reqAdmin, resAdmin);
            console.log('Admin createGroup status:', resAdmin.statusCode);
            if (resAdmin.statusCode !== 201) {
                throw new Error(`Admin group creation failed: ${JSON.stringify(resAdmin.jsonData)}`);
            }
            testGroup = resAdmin.jsonData;

            // Admin adding to group
            const reqAddAdmin = {
                user: { role: 'admin', _id: testAdmin._id, assigned_businesses: [] },
                params: { groupId: testGroup._id.toString() },
                body: { businessId: testBusiness._id.toString() }
            };
            const resAddAdmin = mockResponse();
            await groupController.addBusinessToGroup(reqAddAdmin, resAddAdmin);
            console.log('Admin addBusinessToGroup status:', resAddAdmin.statusCode);
            if (resAddAdmin.statusCode !== 200) {
                throw new Error(`Admin add to group failed: ${JSON.stringify(resAddAdmin.jsonData)}`);
            }

            // Normal user with no assigned businesses trying to group should fail with 403
            const reqUser = {
                user: { role: 'user', _id: testUser._id, assigned_businesses: [] },
                body: { groupName: 'Sec Test Group User Failed', businessIds: [testBusiness._id.toString()] }
            };
            const resUser = mockResponse();
            await groupController.createGroup(reqUser, resUser);
            console.log('User createGroup status (unassigned):', resUser.statusCode);
            if (resUser.statusCode !== 403) {
                throw new Error(`User should be forbidden from grouping unassigned businesses. Got status: ${resUser.statusCode}`);
            }

            // Normal user trying to add business to group should fail with 403
            const reqAddUser = {
                user: { role: 'user', _id: testUser._id, assigned_businesses: [] },
                params: { groupId: testGroup._id.toString() },
                body: { businessId: testBusiness._id.toString() }
            };
            const resAddUser = mockResponse();
            await groupController.addBusinessToGroup(reqAddUser, resAddUser);
            console.log('User addBusinessToGroup status (unassigned):', resAddUser.statusCode);
            if (resAddUser.statusCode !== 403) {
                throw new Error(`User should be forbidden from adding unassigned business to group. Got status: ${resAddUser.statusCode}`);
            }
        }
        console.log('Admin grouping permissions bypass and user restrictions passed!');

        console.log('\n🎉 ALL SECURITY INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');

    } catch (error) {
        console.error('❌ Integration tests failed:', error);
    } finally {
        console.log('Cleaning up database...');
        if (testAdmin) await User.deleteOne({ _id: testAdmin._id });
        if (testUser) await User.deleteOne({ _id: testUser._id });
        if (testBusiness) await Business.deleteOne({ _id: testBusiness._id });
        if (testGroup) await Group.deleteOne({ _id: testGroup._id });
        await mongoose.connection.close();
        console.log('Database connection closed.');
    }
};

runTests();
