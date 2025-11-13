/**
 * ElevenLabs Text-to-Speech Integration
 * Provides high-quality voice synthesis for conversational AI
 */

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

// Voice IDs for bilingual support - using conversational voices
const VOICES = {
  en: 'cgSgspJ2msm6clMCkdW9', // Jessica - warm, conversational female voice
  fr: 'XB0fDUnXU5powFXDhCwa', // Charlotte - natural, conversational French voice
};

export interface TextToSpeechOptions {
  text: string;
  language?: 'en' | 'fr';
  voiceId?: string;
}

/**
 * Convert text to speech using ElevenLabs API
 * Returns audio buffer that can be sent to client
 */
export async function textToSpeech(options: TextToSpeechOptions): Promise<Buffer> {
  const { text, language = 'en', voiceId } = options;

  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is not configured');
  }

  const selectedVoiceId = voiceId || VOICES[language];

  try {
    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${selectedVoiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5', // Fast, high-quality model
          voice_settings: {
            stability: 0.3, // Lower for more natural variation
            similarity_boost: 0.8,
            style: 0.5, // Add conversational style
            use_speaker_boost: true,
          },
          optimize_streaming_latency: 3, // Optimize for speed
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('Error generating speech with ElevenLabs:', error);
    throw error;
  }
}

/**
 * Get available voices from ElevenLabs
 */
export async function getAvailableVoices() {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is not configured');
  }

  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching ElevenLabs voices:', error);
    throw error;
  }
}
