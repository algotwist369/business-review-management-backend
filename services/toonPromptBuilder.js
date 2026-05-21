const MAX_STYLE_EXAMPLES = 3;
const MAX_EXAMPLE_LENGTH = 360;

const trimText = (value, limit) => String(value || '').trim().slice(0, limit);

const buildReviewPromptPayload = ({
    business,
    services,
    localSeoKeywords,
    languages,
    tone,
    dataset,
}) => {
    const languagePolicy = languages.length > 1
        ? 'one_natural_review_mixed_across_all_selected_languages'
        : 'one_review_in_selected_language';

    return {
    task: 'one_original_local_business_review',
    business: {
        name: trimText(business.business_name, 160),
        location: trimText(business.location, 160),
    },
    services: services.map((service) => trimText(service, 100)).filter(Boolean).slice(0, 10),
    seo_keywords: localSeoKeywords.map((keyword) => trimText(keyword, 80)).filter(Boolean).slice(0, 12),
    languages: languages.map((language) => ({
        name: trimText(language.name, 80),
        code: trimText(language.code, 24),
    })),
    language_policy: languagePolicy,
    tone: trimText(tone || 'natural customer voice', 80),
    style_examples: dataset
        ? dataset.examples
            .map((example) => trimText(example, MAX_EXAMPLE_LENGTH))
            .filter(Boolean)
            .slice(0, MAX_STYLE_EXAMPLES)
        : [],
    };
};

const encodeToToon = async (payload) => {
    const toon = await import('@toon-format/toon');
    return toon.encode(payload);
};

const buildReviewPrompt = async (input) => {
    const payload = buildReviewPromptPayload(input);
    const toonPayload = await encodeToToon(payload);

    return {
        payload,
        toonPayload,
        systemPrompt: [
            'You write one human local-business review.',
            'Use the TOON data as the only business context.',
            'Follow language_policy exactly.',
            'If multiple languages are selected, return one natural mixed-language review and include meaningful words or sentences from every selected language.',
            'If one language is selected, write the whole review in that language.',
            'Do not copy, paraphrase too closely, quote, or mention style examples.',
            'Keep the review specific, natural, non-robotic, and suitable for a public business review.',
            'Return only the review text without labels, markdown, or analysis.',
        ].join(' '),
        userPrompt: `Generate the review from this TOON input:\n${toonPayload}`,
    };
};

module.exports = {
    MAX_EXAMPLE_LENGTH,
    MAX_STYLE_EXAMPLES,
    buildReviewPrompt,
};
