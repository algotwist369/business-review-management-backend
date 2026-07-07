const normalizeAssetInput = (input = {}, updatedBy = null, previous = {}) => {
    const source = input && typeof input === 'object' ? input : {};
    const fallbackLinks = Array.isArray(previous?.links) ? previous.links : [];
    const rawLinks = Array.isArray(source.links)
        ? source.links
        : source.url
            ? [{ title: source.title || source.link_title || 'Link', url: source.url }]
            : fallbackLinks.length
                ? fallbackLinks
                : previous?.url
                    ? [{ title: 'Link', url: previous.url }]
                    : [];

    const links = rawLinks
        .map((link, index) => {
            if (typeof link === 'string') {
                return { title: `Link ${index + 1}`, url: link.trim() };
            }

            const url = String(link?.url || '').trim();
            if (!url) return null;

            const title = String(link?.title || '').trim() || `Link ${index + 1}`;
            return { title, url };
        })
        .filter(Boolean);

    return {
        is_created: typeof source.is_created === 'boolean'
            ? source.is_created
            : !!previous?.is_created,
        links,
        url: links[0]?.url || null,
        updated_at: new Date(),
        updated_by: updatedBy || previous?.updated_by || null,
    };
};

const normalizeAssetFields = (source, fieldNames, updatedBy, previous = {}) => {
    return fieldNames.reduce((acc, field) => {
        if (source[field] !== undefined) {
            acc[field] = normalizeAssetInput(source[field], updatedBy, previous[field]);
        }
        return acc;
    }, {});
};

module.exports = {
    normalizeAssetInput,
    normalizeAssetFields,
};
