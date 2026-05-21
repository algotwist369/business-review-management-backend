const LANGUAGE_CODES = {
    arabic: 'ar',
    bengali: 'bn',
    english: 'en',
    french: 'fr',
    german: 'de',
    gujarati: 'gu',
    hindi: 'hi',
    italian: 'it',
    japanese: 'ja',
    kannada: 'kn',
    malayalam: 'ml',
    marathi: 'mr',
    nepali: 'ne',
    odia: 'or',
    oriya: 'or',
    portuguese: 'pt',
    punjabi: 'pa',
    russian: 'ru',
    sanskrit: 'sa',
    spanish: 'es',
    tamil: 'ta',
    telugu: 'te',
    urdu: 'ur',
};

const normalizeLanguageName = (name = '') => name.trim().toLowerCase();

const detectLanguageCode = (name = '') => LANGUAGE_CODES[normalizeLanguageName(name)] || '';

module.exports = {
    detectLanguageCode,
};
