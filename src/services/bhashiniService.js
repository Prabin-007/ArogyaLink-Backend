/**
 * src/services/bhashiniService.js
 * --------------------------------
 * Bhashini / ULCA / Dhruva integration service.
 *
 * NOTE: As per requirements, Bhashini speech translation is optional/future scope.
 * The system defaults to mock mode so video calls work without external dependencies.
 */

const isMock = () =>
  process.env.USE_MOCK_BHASHINI === 'true' ||
  !process.env.BHASHINI_USER_ID ||
  !process.env.BHASHINI_ULCA_KEY;

// -----------------------------------------------------------------------------
// MOCK MODE (Default for video call hackathon demo)
// -----------------------------------------------------------------------------
const MOCK_PHRASES = {
  hi: { text: 'मुझे सिर दर्द हो रहा है',       en: 'I have a headache' },
  mr: { text: 'मला ताप आला आहे',                 en: 'I have a fever' },
  bn: { text: 'আমার পেটে ব্যথা করছে',            en: 'I have a stomach ache' },
  ta: { text: 'எனக்கு இருமல் உள்ளது',             en: 'I have a cough' },
  te: { text: 'నాకు తలనొప్పిగా ఉంది',             en: 'I have a headache' },
};

function mockTranslate({ sourceLanguage, targetLanguage }) {
  const phrase = MOCK_PHRASES[sourceLanguage] ?? { text: '(mock speech)', en: '(mock translation)' };
  return {
    recognizedText: phrase.text,
    translatedText: targetLanguage === 'en' ? phrase.en : phrase.text,
    audioContent: null,
  };
}

async function translateSpeech({ audioBase64, sourceLanguage, targetLanguage }) {
  if (isMock()) {
    return mockTranslate({ sourceLanguage, targetLanguage });
  }

  try {
    const axios = require('axios');
    const PIPELINE_CONFIG_URL =
      'https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline';

    const response = await axios.post(
      PIPELINE_CONFIG_URL,
      {
        pipelineTasks: [
          { taskType: 'asr',         config: { language: { sourceLanguage } } },
          { taskType: 'translation', config: { language: { sourceLanguage, targetLanguage } } },
          { taskType: 'tts',         config: { language: { sourceLanguage: targetLanguage } } },
        ],
        pipelineRequestConfig: { pipelineId: process.env.BHASHINI_PIPELINE_ID },
      },
      {
        headers: {
          userID: process.env.BHASHINI_USER_ID,
          ulcaApiKey: process.env.BHASHINI_ULCA_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    return {
      recognizedText: response.data?.pipelineResponse?.[0]?.output?.[0]?.source ?? '',
      translatedText: response.data?.pipelineResponse?.[1]?.output?.[0]?.target ?? '',
      audioContent: response.data?.pipelineResponse?.[2]?.audio?.[0]?.audioContent ?? null,
    };
  } catch (err) {
    console.warn('Bhashini live inference unavailable, returning mock:', err.message);
    return mockTranslate({ sourceLanguage, targetLanguage });
  }
}

module.exports = { translateSpeech };
