const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../model/user');
const ChatGroup = require('../model/ChatGroup');
const GroupMessage = require('../model/GroupMessage');

const chatController = require('../controller/chatController');

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
    let testUser1 = null;
    let testUser2 = null;
    let testGroup = null;

    try {
        console.log('Connecting to database...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected!');

        // Cleanup
        await User.deleteMany({ username: { $regex: /^test_grops_/ } });
        await ChatGroup.deleteMany({ name: { $regex: /^Test Group Ops/ } });

        console.log('Creating test admin and users...');
        testAdmin = await User.create({
            email: 'test_grops_admin@omega.com',
            username: 'test_grops_admin',
            password_hash: 'hashedpassword',
            role: 'admin',
            is_active: true
        });

        testUser1 = await User.create({
            email: 'test_grops_user1@omega.com',
            username: 'test_grops_user1',
            password_hash: 'hashedpassword',
            role: 'user',
            managed_by: [testAdmin._id],
            is_active: true
        });

        testUser2 = await User.create({
            email: 'test_grops_user2@omega.com',
            username: 'test_grops_user2',
            password_hash: 'hashedpassword',
            role: 'user',
            managed_by: [testAdmin._id],
            is_active: true
        });

        console.log('\n--- 1. Testing Create Group ---');
        {
            const req = {
                user: { _id: testAdmin._id },
                body: {
                    name: 'Test Group Ops Original',
                    members: [testUser1._id.toString()]
                }
            };
            const res = mockResponse();
            await chatController.createGroup(req, res);
            console.log('Create Group status:', res.statusCode);
            if (res.statusCode !== 201) throw new Error('Create Group failed');
            testGroup = res.jsonData;
            console.log('Created Group name:', testGroup.name);
            console.log('Members count:', testGroup.members.length);
        }

        console.log('\n--- 2. Testing Edit Group ---');
        {
            // Edit name and add testUser2
            const req = {
                user: { _id: testAdmin._id },
                params: { groupId: testGroup._id.toString() },
                body: {
                    name: 'Test Group Ops Updated',
                    members: [testUser1._id.toString(), testUser2._id.toString()]
                }
            };
            const res = mockResponse();
            await chatController.editGroup(req, res);
            console.log('Edit Group status:', res.statusCode);
            if (res.statusCode !== 200) throw new Error('Edit Group failed');
            
            const updatedGroup = res.jsonData;
            console.log('Updated Group name:', updatedGroup.name);
            console.log('Updated Members count:', updatedGroup.members.length);
            if (updatedGroup.name !== 'Test Group Ops Updated') throw new Error('Name was not updated');
            if (updatedGroup.members.length !== 3) throw new Error('Members list was not updated (admin + user1 + user2)');
        }

        console.log('\n--- 3. Testing Edit Group Security (Unauthorized User) ---');
        {
            // testUser1 is not the creator, should fail to edit with 403
            const req = {
                user: { _id: testUser1._id },
                params: { groupId: testGroup._id.toString() },
                body: {
                    name: 'Hacked Group Name',
                    members: [testUser1._id.toString()]
                }
            };
            const res = mockResponse();
            await chatController.editGroup(req, res);
            console.log('Edit Group unauthorized status:', res.statusCode);
            if (res.statusCode !== 403) throw new Error('Expected 403 Forbidden');
        }

        console.log('\n--- 4. Testing Group Message deletion after Group delete ---');
        {
            // Send a test message first
            const reqMsg = {
                user: { _id: testUser1._id },
                body: {
                    group_id: testGroup._id.toString(),
                    text: 'Ops test message',
                    priority: 'Medium'
                }
            };
            const resMsg = mockResponse();
            await chatController.sendGroupMessage(reqMsg, resMsg);
            console.log('Send Group Message status:', resMsg.statusCode);
            if (resMsg.statusCode !== 201) throw new Error('Send message failed');

            const message = resMsg.jsonData;

            // Delete group
            const reqDel = {
                user: { _id: testAdmin._id },
                params: { groupId: testGroup._id.toString() }
            };
            const resDel = mockResponse();
            await chatController.deleteGroup(reqDel, resDel);
            console.log('Delete Group status:', resDel.statusCode);
            if (resDel.statusCode !== 200) throw new Error('Delete Group failed');

            // Verify group is deleted from DB
            const checkGroup = await ChatGroup.findById(testGroup._id);
            console.log('Group still in DB:', !!checkGroup);
            if (checkGroup) throw new Error('Group was not deleted from DB');

            // Verify message is deleted from DB
            const checkMessage = await GroupMessage.findById(message._id);
            console.log('Message still in DB:', !!checkMessage);
            if (checkMessage) throw new Error('Group messages were not deleted from DB');
        }

        console.log('\n🎉 ALL EDIT AND DELETE GROUP BACKEND TESTS PASSED! 🎉');

    } catch (error) {
        console.error('❌ Integration tests failed:', error);
    } finally {
        console.log('Cleaning up database...');
        if (testAdmin) await User.deleteOne({ _id: testAdmin._id });
        if (testUser1) await User.deleteOne({ _id: testUser1._id });
        if (testUser2) await User.deleteOne({ _id: testUser2._id });
        await mongoose.connection.close();
        console.log('Database connection closed.');
    }
};

runTests();
