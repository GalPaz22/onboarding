import dotenv from "dotenv";

dotenv.config();

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;

// Initialize Google AI if available
let GoogleGenAI = null;
let ai = null;

try {
  const mod = await import('@google/genai');
  GoogleGenAI = mod.GoogleGenAI || mod.default || null;

  if (GOOGLE_AI_API_KEY && GOOGLE_AI_API_KEY !== "YOUR_GOOGLE_AI_KEY" && GoogleGenAI) {
    ai = new GoogleGenAI({ apiKey: GOOGLE_AI_API_KEY });
    console.log('✅ [LLM-UTILS] Google AI initialized successfully');
  }
} catch (err) {
  console.error('❌ [LLM-UTILS] Failed to load Google AI:', err.message);
}

/**
 * Call Gemini 2.5 Flash with JSON response mode
 * Uses consistent configuration across the application
 *
 * @param {Array} messages - Array of message objects with role and parts
 * @param {Object} options - Optional configuration overrides
 * @returns {Promise<Object>} - Parsed JSON response from Gemini
 */
export async function callGeminiJSON(messages, options = {}) {
  if (!ai) {
    throw new Error('Google AI not initialized - check GOOGLE_AI_API_KEY');
  }

  const defaultConfig = {
    model: "gemini-2.5-flash",
    contents: messages,
    config: {
      responseMimeType: "application/json",
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  // Merge with any custom options
  const finalConfig = {
    ...defaultConfig,
    ...options,
    config: {
      ...defaultConfig.config,
      ...(options.config || {})
    }
  };

  try {
    const response = await ai.models.generateContent(finalConfig);

    let result;
    if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      result = response.candidates[0].content.parts[0].text;
    } else if (response.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      result = response.response.candidates[0].content.parts[0].text;
    }

    if (!result) {
      throw new Error("No valid response from Gemini");
    }

    // Handle code blocks in response
    let jsonString = result.trim();
    if (jsonString.startsWith('```') && jsonString.endsWith('```')) {
      jsonString = jsonString.replace(/^```(?:json)?\s*|```\s*$/g, '');
    }

    return JSON.parse(jsonString);

  } catch (error) {
    console.error('❌ [LLM-UTILS] Gemini call failed:', error.message);
    throw error;
  }
}

/**
 * Call Gemini 2.5 Flash with text response mode
 *
 * @param {Array} messages - Array of message objects with role and parts
 * @param {Object} options - Optional configuration overrides
 * @returns {Promise<string>} - Text response from Gemini
 */
export async function callGeminiText(messages, options = {}) {
  if (!ai) {
    throw new Error('Google AI not initialized - check GOOGLE_AI_API_KEY');
  }

  const defaultConfig = {
    model: "gemini-2.5-flash",
    contents: messages,
    config: {
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  // Merge with any custom options
  const finalConfig = {
    ...defaultConfig,
    ...options,
    config: {
      ...defaultConfig.config,
      ...(options.config || {})
    }
  };

  try {
    const response = await ai.models.generateContent(finalConfig);

    let result;
    if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      result = response.candidates[0].content.parts[0].text;
    } else if (response.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      result = response.response.candidates[0].content.parts[0].text;
    }

    if (!result) {
      throw new Error("No valid response from Gemini");
    }

    return result.trim();

  } catch (error) {
    console.error('❌ [LLM-UTILS] Gemini call failed:', error.message);
    throw error;
  }
}

/**
 * Check if Google AI is available
 * @returns {boolean}
 */
export function isAIAvailable() {
  return ai !== null;
}

/**
 * Get the AI client instance
 * @returns {Object|null}
 */
export function getAIClient() {
  return ai;
}

export default {
  callGeminiJSON,
  callGeminiText,
  isAIAvailable,
  getAIClient
};
