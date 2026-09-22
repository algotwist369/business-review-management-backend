
const mongoose = require('mongoose');
const Review = require('../model/review');
require('dotenv').config();

const TEST_USER_ID = '69d918312acb785e3c9c2bbe';
const TEST_SEARCH = 'AURIC SPA SANPADA'; // user's search term

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            maxPoolSize: 20,
        });
        console.log('🟢 Connected to MongoDB for test');
    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    }
};

const testAggregation = async () => {
    await connectDB();

    console.log('\n🔍 Test 1: No search filter');
    const pipelineNoSearch = [
        { $match: { user_id: new mongoose.Types.ObjectId(TEST_USER_ID) } },
        {
            $lookup: {
                from: 'businesses',
                localField: 'business_id',
                foreignField: '_id',
                as: 'business'
            }
        },
        { $unwind: '$business' },
    ];

    const resultsNoSearch = await Review.aggregate(pipelineNoSearch);
    console.log(`\n✅ Test 1 - Found ${resultsNoSearch.length} results`);
    console.log('\nSample result (first 3):', resultsNoSearch.slice(0, 3).map(r => ({
        reviewId: r._id,
        businessId: r.business._id,
        businessName: r.business.business_name,
        location: r.business.location,
        reviewCount: r.review_count
    })));

    console.log('\n\n🔍 Test 2: With search filter:', TEST_SEARCH);
    let businessMatchStage = {};
    if (TEST_SEARCH) {
        businessMatchStage['business.business_name'] = { $regex: TEST_SEARCH, $options: 'i' };
    }
    console.log('businessMatchStage:', businessMatchStage);

    const pipelineWithSearch = [
        ...pipelineNoSearch,
        { $match: businessMatchStage },
    ];

    const resultsWithSearch = await Review.aggregate(pipelineWithSearch);
    console.log(`\n✅ Test 2 - Found ${resultsWithSearch.length} results`);
    console.log('\nSample result (first 3):', resultsWithSearch.slice(0, 3).map(r => ({
        reviewId: r._id,
        businessId: r.business._id,
        businessName: r.business.business_name,
        location: r.business.location,
        reviewCount: r.review_count
    })));

    process.exit(0);
};

testAggregation().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
