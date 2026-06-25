require('dotenv').config({ path: 'C:/Users/ADMIN/Desktop/dos-internal-management/server/.env' });
const mongoose = require('mongoose');
const User = require('../model/user');
const ChatGroup = require('../model/ChatGroup');
const ChatMessage = require('../model/ChatMessage');
const GroupMessage = require('../model/GroupMessage');
const chatController = require('../controller/chatController');

// Mock response object
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

const runTest = async () => {
    let admin = null;
    let user = null;
    let group = null;
    
    let msg1 = null;
    let replyMsg = null;
    let grpMsg1 = null;

    try {
        console.log('Connecting to database...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected!');

        // Cleanup any potential old test users
        await User.deleteMany({ username: { $regex: /^test_msgops_/ } });
        await ChatGroup.deleteMany({ name: { $regex: /^Test MessageOps Group/ } });

        console.log('Creating test users...');
        admin = await User.create({
            email: 'test_msgops_admin@omega.com',
            username: 'test_msgops_admin',
            password_hash: 'hashedpassword',
            role: 'admin',
            is_active: true
        });

        user = await User.create({
            email: 'test_msgops_user@omega.com',
            username: 'test_msgops_user',
            password_hash: 'hashedpassword',
            role: 'user',
            managed_by: [admin._id],
            is_active: true
        });

        // ==========================================
        // PART 1: DIRECT MESSAGES TESTS
        // ==========================================
        console.log('\n--- 1. Send direct message (admin to user) ---');
        let req = {
            user: { _id: admin._id },
            body: {
                recipient_id: user._id,
                text: 'Hello from admin!',
                priority: 'High'
            }
        };
        let res = mockResponse();
        await chatController.sendMessage(req, res);
        console.log(`Status: ${res.statusCode}`);
        if (res.statusCode !== 201) throw new Error('Failed to send direct message');
        msg1 = res.jsonData;
        console.log(`Sent Message ID: ${msg1._id}, text: "${msg1.text}"`);

        console.log('\n--- 2. Reply to direct message (user to admin) ---');
        req = {
            user: { _id: user._id },
            body: {
                recipient_id: admin._id,
                text: 'Replying to your message!',
                parent_message_id: msg1._id
            }
        };
        res = mockResponse();
        await chatController.sendMessage(req, res);
        console.log(`Status: ${res.statusCode}`);
        if (res.statusCode !== 201) throw new Error('Failed to reply to message');
        replyMsg = res.jsonData;
        console.log(`Reply parent_message_id: ${replyMsg.parent_message_id?._id || replyMsg.parent_message_id}`);
        console.log(`Quoted text preview: "${replyMsg.parent_message_id?.text}" by "${replyMsg.parent_message_id?.sender_id?.username}"`);
        if (!replyMsg.parent_message_id) throw new Error('Parent message context missing in reply');

        console.log('\n--- 3. Edit direct message (admin edits msg1) ---');
        req = {
            user: { _id: admin._id },
            params: { messageId: msg1._id },
            body: { text: 'Hello from admin (edited)!' }
        };
        res = mockResponse();
        await chatController.editMessage(req, res);
        console.log(`Status: ${res.statusCode}`);
        if (res.statusCode !== 200) throw new Error('Failed to edit message');
        console.log(`Edited text: "${res.jsonData.text}" (is_edited: ${res.jsonData.is_edited})`);
        if (res.jsonData.text !== 'Hello from admin (edited)!' || !res.jsonData.is_edited) {
            throw new Error('Message edit fields not applied correctly');
        }

        console.log('\n--- 4. Edit message (unauthorized attempt by user on msg1) ---');
        req = {
            user: { _id: user._id },
            params: { messageId: msg1._id },
            body: { text: 'Hack attempt!' }
        };
        res = mockResponse();
        await chatController.editMessage(req, res);
        console.log(`Status (Should be 403): ${res.statusCode}`);
        if (res.statusCode !== 403) throw new Error('Should block unauthorized message edits');

        console.log('\n--- 5. Delete direct message (admin deletes msg1) ---');
        req = {
            user: { _id: admin._id },
            params: { messageId: msg1._id }
        };
        res = mockResponse();
        await chatController.deleteMessage(req, res);
        console.log(`Status: ${res.statusCode}`);
        if (res.statusCode !== 200) throw new Error('Failed to delete message');
        console.log(`Deleted message properties: text: "${res.jsonData.text}", is_deleted: ${res.jsonData.is_deleted}`);
        if (res.jsonData.text !== 'This message was deleted' || !res.jsonData.is_deleted) {
            throw new Error('Message soft-deletion properties mismatch');
        }

        // ==========================================
        // PART 2: GROUP MESSAGES TESTS
        // ==========================================
        console.log('\n--- 6. Create Chat Group for testing Group Message Operations ---');
        group = await ChatGroup.create({
            name: 'Test MessageOps Group',
            created_by: admin._id,
            members: [admin._id, user._id]
        });
        console.log(`Group created: ${group.name} (${group._id})`);

        console.log('\n--- 7. Send Group Message ---');
        req = {
            user: { _id: admin._id },
            body: {
                group_id: group._id,
                text: 'Hello group!',
                priority: 'Low'
            }
        };
        res = mockResponse();
        await chatController.sendGroupMessage(req, res);
        console.log(`Status: ${res.statusCode}`);
        if (res.statusCode !== 201) throw new Error('Failed to send group message');
        grpMsg1 = res.jsonData;

        console.log('\n--- 8. Reply to Group Message ---');
        req = {
            user: { _id: user._id },
            body: {
                group_id: group._id,
                text: 'Replying in group!',
                parent_message_id: grpMsg1._id
            }
        };
        res = mockResponse();
        await chatController.sendGroupMessage(req, res);
        console.log(`Status: ${res.statusCode}`);
        if (res.statusCode !== 201) throw new Error('Failed to send group reply message');
        console.log(`Group reply parent text: "${res.jsonData.parent_message_id?.text}"`);
        if (!res.jsonData.parent_message_id) throw new Error('Group reply parent context missing');

        console.log('\n--- 9. Edit Group Message ---');
        req = {
            user: { _id: admin._id },
            params: { messageId: grpMsg1._id },
            body: { text: 'Hello group (edited)!' }
        };
        res = mockResponse();
        await chatController.editGroupMessage(req, res);
        console.log(`Status: ${res.statusCode}`);
        if (res.statusCode !== 200) throw new Error('Failed to edit group message');
        if (res.jsonData.text !== 'Hello group (edited)!' || !res.jsonData.is_edited) {
            throw new Error('Group message edit properties mismatch');
        }

        console.log('\n--- 10. Delete Group Message ---');
        req = {
            user: { _id: admin._id },
            params: { messageId: grpMsg1._id }
        };
        res = mockResponse();
        await chatController.deleteGroupMessage(req, res);
        console.log(`Status: ${res.statusCode}`);
        if (res.statusCode !== 200) throw new Error('Failed to delete group message');
        if (res.jsonData.text !== 'This message was deleted' || !res.jsonData.is_deleted) {
            throw new Error('Group message soft-deletion mismatch');
        }

        console.log('\nAll integration tests passed successfully!');

    } catch (error) {
        console.error('Test execution failed:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        // Cleanup database
        console.log('Cleaning up database...');
        if (admin) await User.findByIdAndDelete(admin._id);
        if (user) await User.findByIdAndDelete(user._id);
        if (group) {
            await ChatGroup.findByIdAndDelete(group._id);
            await GroupMessage.deleteMany({ group_id: group._id });
        }
        if (msg1) await ChatMessage.findByIdAndDelete(msg1._id);
        if (replyMsg) await ChatMessage.findByIdAndDelete(replyMsg._id);
        
        await mongoose.disconnect();
        console.log('Disconnected!');
    }
};

runTest();
