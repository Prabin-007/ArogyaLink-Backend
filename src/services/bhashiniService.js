/**
 * src/services/bhashiniService.js
 * --------------------------------
 * Bhashini / ULCA / Dhruva integration service.
 *
 * Converts base64 audio from a patient into:
 *   1. Recognized text  (ASR — Automatic Speech Recognition)
 *   2. Translated text  (NMT — Neural Machine Translation)
 *   3. Synthesized audio (TTS — Text-to-Speech, base64, may be null)
 *
 * The exact request/response shape of the Bhashini pipeline APIs can change.
 * Access requires registering at https://bhashini.gov.in and requesting ULCA
 * credentials. This file implements the documented high-level flow
 * (pipeline config → ASR → NMT → TTS) but you MUST verify the current
 * payload/response structure against the live Bhashini API docs before a real
 * demo, and adjust parsePipelineResponse / parseInferenceResponse if the
 * shape differs.
 *
 * Set USE_MOCK_BHASHINI=true in .env to run the whole app without real
 * credentials — this returns a simulated ASR/NMT result so the rest of the
 * stack (WebRTC, sockets, UI) can be demoed end-to-end.
 */

const axios = require('axios');

const PIPELINE_CONFIG_URL =
  'https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline';

const isMock = () => process.env.USE_MOCK_BHASHINI === 'true';

// Cache the pipeline config in memory so we don't re-fetch it on every request.
let cachedPipelineConfig = null;

async function getPipelineConfig(sourceLanguage, targetLanguage) {
  if (cachedPipelineConfig) return cachedPipelineConfig;

  if (!process.env.BHASHINI_USER_ID || !process.env.BHASHINI_ULCA_KEY) {
    throw new Error('Missing BHASHINI_USER_ID / BHASHINI_ULCA_KEY environment variables');
  }

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

  cachedPipelineConfig = response.data;
  return cachedPipelineConfig;
}

/**
 * Defensive parsing — Bhashini's response nests the callback URL and the
 * per-service auth key under pipelineInferenceAPIEndPoint. If the schema
 * changes, this is the ONLY place that needs updating.
 */
function parsePipelineResponse(config) {
  const endpoint = config?.pipelineInferenceAPIEndPoint;
  if (!endpoint?.callbackUrl) {
    throw new Error('Unexpected Bhashini pipeline config response shape');
  }
  return {
    inferenceUrl: endpoint.callbackUrl,
    inferenceApiKey: endpoint.inferenceApiKey,
  };
}

async function runInference({ audioBase64, sourceLanguage, targetLanguage }) {
  const config = await getPipelineConfig(sourceLanguage, targetLanguage);
  const { inferenceUrl, inferenceApiKey } = parsePipelineResponse(config);

  const response = await axios.post(
    inferenceUrl,
    {
      pipelineTasks: [
        { taskType: 'asr',         config: { language: { sourceLanguage } } },
        { taskType: 'translation', config: { language: { sourceLanguage, targetLanguage } } },
        { taskType: 'tts',         config: { language: { sourceLanguage: targetLanguage } } },
      ],
      inputData: {
        audio: [{ audioContent: audioBase64 }],
      },
    },
    {
      headers: {
        Authorization: inferenceApiKey?.value ?? inferenceApiKey,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );

  return parseInferenceResponse(response.data);
}

/**
 * Normalize whatever Bhashini returns into a simple, stable shape.
 * Adjust the field lookups here if the live API returns a different structure.
 */
function parseInferenceResponse(data) {
  const asrText      = data?.pipelineResponse?.[0]?.output?.[0]?.source ?? '';
  const translatedText = data?.pipelineResponse?.[1]?.output?.[0]?.target ?? '';
  const audioContent = data?.pipelineResponse?.[2]?.audio?.[0]?.audioContent ?? null;

  return { recognizedText: asrText, translatedText, audioContent };
}

// =============================================================================
// MOCK MODE
// =============================================================================
// A tiny canned phrase bank so the demo has something plausible to show even
// without real ASR/NMT credentials. audioContent is null — the frontend should
// simply skip audio playback when it is missing.
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

/**
 * Public entry point used by the socket handler.
 * Always returns { recognizedText, translatedText, audioContent }.
 *
 * @param {object} params
 * @param {string} params.audioBase64     – Base64-encoded audio chunk from the patient's mic
 * @param {string} params.sourceLanguage  – BCP-47 language code of the patient's speech
 * @param {string} params.targetLanguage  – BCP-47 language code the doctor speaks
 */
async function translateSpeech({ audioBase64, sourceLanguage, targetLanguage }) {
  if (isMock()) {
    return mockTranslate({ sourceLanguage, targetLanguage });
  }

  try {
    return await runInference({ audioBase64, sourceLanguage, targetLanguage });
  } catch (err) {
    console.error('Bhashini inference failed:', err.message);
    throw new Error('Translation service is currently unavailable');
  }
}

module.exports = { translateSpeech };
