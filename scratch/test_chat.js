const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../model/user');
const ChatMessage = require('../model/ChatMessage');
const chatController = require('../controller/chatController');

// Mock express response object
const mockResponse = () => {
    const res = {};
    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    res.json = (data) => {
        res.body = data;
        return res;
    };
    return res;
};

const runTest = async () => {
    let superAdmin = null;
    let admin1 = null;
    let admin2 = null;
    let user1 = null;
    let user2 = null;

    try {
        console.log('Connecting to database...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected!');

        console.log('Cleaning up old test users...');
        await User.deleteMany({ email: /_test_chat@omega\.com$/ });

        console.log('Creating test users...');
        // 1. Super Admin
        superAdmin = await User.create({
            email: 'superadmin_test_chat@omega.com',
            username: 'superadmin_test_chat',
            password_hash: 'hashedpassword',
            role: 'super_admin',
            is_active: true
        });

        // 2. Admin 1 (Manager of User 1)
        admin1 = await User.create({
            email: 'admin1_test_chat@omega.com',
            username: 'admin1_test_chat',
            password_hash: 'hashedpassword',
            role: 'admin',
            is_active: true
        });

        // 3. Admin 2 (Manager of User 2)
        admin2 = await User.create({
            email: 'admin2_test_chat@omega.com',
            username: 'admin2_test_chat',
            password_hash: 'hashedpassword',
            role: 'admin',
            is_active: true
        });

        // 4. User 1 (Managed by Admin 1)
        user1 = await User.create({
            email: 'user1_test_chat@omega.com',
            username: 'user1_test_chat',
            password_hash: 'hashedpassword',
            role: 'user',
            managed_by: [admin1._id],
            is_active: true
        });

        // 5. User 2 (Managed by Admin 2)
        user2 = await User.create({
            email: 'user2_test_chat@omega.com',
            username: 'user2_test_chat',
            password_hash: 'hashedpassword',
            role: 'user',
            managed_by: [admin2._id],
            is_active: true
        });

        console.log('Clean up old messages...');
        await ChatMessage.deleteMany({
            $or: [
                { sender_id: { $in: [superAdmin._id, admin1._id, admin2._id, user1._id, user2._id] } },
                { recipient_id: { $in: [superAdmin._id, admin1._id, admin2._id, user1._id, user2._id] } }
            ]
        });

        // Test 1: Admin 1 sending message to User 1 (Allowed)
        console.log('Test 1: Admin 1 -> User 1 (Should succeed)...');
        const req1 = {
            user: admin1,
            body: { recipient_id: user1._id.toString(), text: 'Hello managed user 1!', priority: 'High' }
        };
        const res1 = mockResponse();
        await chatController.sendMessage(req1, res1);
        console.log('Result status:', res1.statusCode);
        if (res1.statusCode !== 201) {
            throw new Error('Test 1 failed to send message');
        }

        // Test 2: Admin 1 sending message to User 2 (Not Allowed - User 2 is managed by Admin 2)
        console.log('Test 2: Admin 1 -> User 2 (Should fail 403)...');
        const req2 = {
            user: admin1,
            body: { recipient_id: user2._id.toString(), text: 'Hello unauthorized user 2!', priority: 'Medium' }
        };
        const res2 = mockResponse();
        await chatController.sendMessage(req2, res2);
        console.log('Result status:', res2.statusCode, 'Body:', res2.body);
        if (res2.statusCode !== 403) {
            throw new Error('Test 2 should have blocked message with 403');
        }

        // Test 3: User 1 sending message to Admin 1 (Allowed)
        console.log('Test 3: User 1 -> Admin 1 (Should succeed)...');
        const req3 = {
            user: user1,
            body: { recipient_id: admin1._id.toString(), text: 'Hello manager!', priority: 'Medium' }
        };
        const res3 = mockResponse();
        await chatController.sendMessage(req3, res3);
        console.log('Result status:', res3.statusCode);
        if (res3.statusCode !== 201) {
            throw new Error('Test 3 failed to send message');
        }

        // Test 4: User 1 sending message to Admin 2 (Not Allowed - Admin 2 does not manage User 1)
        console.log('Test 4: User 1 -> Admin 2 (Should fail 403)...');
        const req4 = {
            user: user1,
            body: { recipient_id: admin2._id.toString(), text: 'Hello unauthorized admin!', priority: 'Low' }
        };
        const res4 = mockResponse();
        await chatController.sendMessage(req4, res4);
        console.log('Result status:', res4.statusCode, 'Body:', res4.body);
        if (res4.statusCode !== 403) {
            throw new Error('Test 4 should have blocked message with 403');
        }

        // Test 5: Super Admin sending message to User 2 (Should fail 403 under new rules - super admin cannot message users)
        console.log('Test 5: Super Admin -> User 2 (Should fail 403)...');
        const req5 = {
            user: superAdmin,
            body: { recipient_id: user2._id.toString(), text: 'Hello from Super Admin!', priority: 'High' }
        };
        const res5 = mockResponse();
        await chatController.sendMessage(req5, res5);
        console.log('Result status:', res5.statusCode);
        if (res5.statusCode !== 403) {
            throw new Error('Test 5 should have blocked Super Admin message to user with 403');
        }

        // Test 6: Verify User 1 Contact List
        console.log('Test 6: Fetching User 1 Contacts (Should ONLY include Admin 1, and NOT Super Admin, Admin 2, or User 2)...');
        const req6 = { user: user1 };
        const res6 = mockResponse();
        await chatController.getContacts(req6, res6);
        console.log('User 1 Contacts count:', res6.body.length);
        const contactIds = res6.body.map(c => c._id.toString());
        console.log('Contact IDs list:', contactIds);
        
        if (!contactIds.includes(admin1._id.toString())) {
            throw new Error('User 1 contact list should contain their managing admin');
        }
        if (contactIds.includes(superAdmin._id.toString())) {
            throw new Error('User 1 contact list should NOT contain the super admin');
        }
        if (contactIds.includes(admin2._id.toString()) || contactIds.includes(user2._id.toString())) {
            throw new Error('User 1 contact list should NOT contain unmanaged admins/users');
        }

        // Test 7: Verify lastMessage and unreadCount in Admin 1 Contacts list
        console.log('Test 7: Verify unread stats in Admin 1 contact list...');
        const req7 = { user: admin1 };
        const res7 = mockResponse();
        await chatController.getContacts(req7, res7);
        const user1Contact = res7.body.find(c => c._id.toString() === user1._id.toString());
        console.log('User 1 unread count for Admin 1:', user1Contact?.unreadCount);
        console.log('Last message preview text:', user1Contact?.lastMessage?.text);
        
        if (!user1Contact || user1Contact.unreadCount !== 1) {
            throw new Error('Admin 1 should see exactly 1 unread message from User 1');
        }
        if (user1Contact.lastMessage?.text !== 'Hello manager!') {
            throw new Error('Last message preview text does not match the actual last sent message');
        }

        // Test 8: Mark messages read
        console.log('Test 8: Mark messages from User 1 to Admin 1 as read...');
        const req8 = { user: admin1, params: { contactId: user1._id.toString() } };
        const res8 = mockResponse();
        await chatController.markChatAsRead(req8, res8);
        
        // Re-check contacts list for Admin 1
        const res7_2 = mockResponse();
        await chatController.getContacts(req7, res7_2);
        const user1Contact_2 = res7_2.body.find(c => c._id.toString() === user1._id.toString());
        console.log('User 1 unread count for Admin 1 after read patch:', user1Contact_2?.unreadCount);
        if (user1Contact_2?.unreadCount !== 0) {
            throw new Error('Unread count should have been cleared to 0');
        }

        console.log('🎉 Chat Security & Logic Integration Tests passed successfully!');
    } catch (error) {
        console.error('❌ Integration tests failed:', error);
    } finally {
        console.log('Cleaning up database test records...');
        if (superAdmin) await User.deleteOne({ _id: superAdmin._id });
        if (admin1) await User.deleteOne({ _id: admin1._id });
        if (admin2) await User.deleteOne({ _id: admin2._id });
        if (user1) await User.deleteOne({ _id: user1._id });
        if (user2) await User.deleteOne({ _id: user2._id });
        
        await ChatMessage.deleteMany({
            $or: [
                { sender_id: { $in: [superAdmin?._id, admin1?._id, admin2?._id, user1?._id, user2?._id] } },
                { recipient_id: { $in: [superAdmin?._id, admin1?._id, admin2?._id, user1?._id, user2?._id] } }
            ]
        });
        
        await mongoose.connection.close();
        console.log('Database connection closed.');
    }
};

runTest();
