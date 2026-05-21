const { buildReviewPrompt } = require('./toonPromptBuilder');

const getContentText = (message) => {
    if (typeof message.content === 'string') {
        return message.content.trim();
    }

    if (Array.isArray(message.content)) {
        return message.content
            .map((part) => typeof part === 'string' ? part : part.text)
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    return '';
};

const generateAiReview = async (input) => {
    const [{ ChatOpenAI }] = await Promise.all([
        import('@langchain/openai'),
    ]);

    const prompt = await buildReviewPrompt(input);
    const model = new ChatOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_REVIEW_MODEL || 'gpt-4o-mini',
        temperature: 0.85,
        maxTokens: Number(process.env.OPENAI_REVIEW_MAX_TOKENS || 220),
    });

    const response = await model.invoke([
        ['system', prompt.systemPrompt],
        ['human', prompt.userPrompt],
    ]);

    const reviewText = getContentText(response);
    if (!reviewText) {
        throw new Error('AI review generation returned empty content');
    }

    return {
        reviewText,
        promptPayload: prompt.payload,
        promptToon: prompt.toonPayload,
        tokenUsage: response.usage_metadata || response.response_metadata?.tokenUsage || {},
    };
};

module.exports = {
    generateAiReview,
};
