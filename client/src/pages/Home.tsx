import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Mic, MicOff, Loader2, Send, Volume2, VolumeX, Languages } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { trpc } from "@/lib/trpc";
import { Streamdown } from "streamdown";
import { storagePut } from "@/lib/storage";
import { useLanguage } from "@/contexts/LanguageContext";

type Recipe = {
  id: string;
  name: string;
  description: string;
  method: string;
  glassType?: string | null;
  funFacts?: string | null;
  ingredients: Array<{
    amount: string | null;
    unit: string | null;
    ingredient: string;
  }>;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  isLoading?: boolean;
  recipes?: Recipe[];
};

export default function Home() {
  const { language, setLanguage, t: translate } = useLanguage();
  const toggleLanguage = () => setLanguage(language === 'en' ? 'fr' : 'en');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true); // Voice TTS toggle
  const [voiceModeActive, setVoiceModeActive] = useState(false); // Voice-only mode
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [textInput, setTextInput] = useState("");
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const transcribeMutation = trpc.voice.transcribe.useMutation();
  const sendMessageMutation = trpc.chat.sendMessage.useMutation();
  const generateSpeechMutation = trpc.voice.generateSpeech.useMutation();

  const t = (key: string) => {
    const translations: Record<string, Record<string, string>> = {
      appTitle: { en: "Le Fou Fou", fr: "Le Fou Fou" },
      appSubtitle: { en: "AI-powered cocktail training assistant", fr: "Assistant de formation cocktails IA" },
      welcome: { en: "Welcome", fr: "Bienvenue" },
      instructions: {
        en: "Ask me anything about cocktails, bar service, or workshop planning. Use voice or type your question below.",
        fr: "Posez-moi des questions sur les cocktails, le service au bar ou la planification d'ateliers. Utilisez la voix ou tapez votre question ci-dessous.",
      },
      voiceInput: { en: "Voice Input", fr: "Entrée vocale" },
      tapToSpeak: { en: "Tap to speak", fr: "Appuyez pour parler" },
      typeQuestion: { en: "Or type your question...", fr: "Ou tapez votre question..." },
      signatures: { en: "Signatures", fr: "Signatures" },
      upselling: { en: "Upselling", fr: "Vente incitative" },
      quickTips: { en: "Quick Tips", fr: "Astuces rapides" },
      voiceMode: { en: "Voice Mode", fr: "Mode vocal" },
    };
    return translations[key]?.[language] || key;
  };

  useEffect(() => {
    return () => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current = null;
      }
    };
  }, []);

  // Clean markdown and extract plain text for speech
  const cleanTextForSpeech = (text: string): string => {
    return text
      .replace(/[#*_`]/g, '') // Remove markdown symbols
      .replace(/\n+/g, '. ') // Replace newlines with periods
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  };

  const speakText = async (text: string) => {
    if (!speechEnabled) return;
    
    // Stop any ongoing speech
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
    
    setIsSpeaking(true);
    
    try {
      // Clean the text before sending to TTS
      const cleanText = cleanTextForSpeech(text);
      
      const { audioUrl } = await generateSpeechMutation.mutateAsync({
        text: cleanText,
        language,
      });
      
      const audio = new Audio(audioUrl);
      audioPlayerRef.current = audio;
      
      // Speed up playback slightly for faster responses
      audio.playbackRate = 1.15;
      
      audio.onended = () => setIsSpeaking(false);
      audio.onerror = () => setIsSpeaking(false);
      
      await audio.play();
    } catch (error) {
      console.error('Error playing speech:', error);
      setIsSpeaking(false);
    }
  };

  const stopSpeaking = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
    setIsSpeaking(false);
  };

  const toggleSpeech = () => {
    if (speechEnabled && isSpeaking) {
      stopSpeaking();
    }
    setSpeechEnabled(!speechEnabled);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach(track => track.stop());
        await processAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error accessing microphone:", error);
      alert("Could not access microphone. Please check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);

    try {
      const sizeMB = audioBlob.size / (1024 * 1024);
      if (sizeMB > 16) {
        alert('Audio file is too large. Please record a shorter message.');
        setIsProcessing(false);
        return;
      }

      const audioBuffer = await audioBlob.arrayBuffer();
      const timestamp = Date.now();
      const audioKey = `voice-recordings/recording-${timestamp}.webm`;
      
      const { url: audioUrl } = await storagePut(
        audioKey,
        new Uint8Array(audioBuffer),
        'audio/webm'
      );

      const transcription = await transcribeMutation.mutateAsync({
        audioUrl,
        language: language === 'fr' ? 'fr' : 'en',
      });

      await sendTextMessage(transcription.text, audioUrl);

    } catch (error) {
      console.error('Error processing audio:', error);
      setMessages(prev => prev.filter(m => !m.isLoading));
      alert('Failed to process audio. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const sendTextMessage = async (text: string, audioUrl?: string) => {
    setMessages(prev => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "", isLoading: true },
    ]);

    try {
      const response = await sendMessageMutation.mutateAsync({
        message: text,
        audioUrl,
        language,
      });

      setMessages(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = {
          role: "assistant",
          content: response.message,
          isLoading: false,
          recipes: response.recipes,
        };
        return newMessages;
      });

      // Speak the response using ElevenLabs (only if speech is enabled)
      if (speechEnabled) {
        await speakText(response.message);
      }

    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => prev.filter(m => !m.isLoading));
      alert('Failed to send message. Please try again.');
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) {
      sendTextMessage(textInput);
      setTextInput("");
    }
  };

  const handleQuickAction = (prompt: string) => {
    sendTextMessage(prompt);
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src="https://images.tastet.ca/_/rs:fit:300:200:false:0/plain/local:///2024/11/fou-fou-logo.png" 
              alt="Le Fou Fou" 
              className="h-10 w-auto"
            />
            <div>
              <h1 className="text-xl font-semibold text-neutral-900">{t('appTitle')}</h1>
              <p className="text-sm text-neutral-500">{t('appSubtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Voice Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSpeech}
              className={`flex items-center gap-2 ${
                speechEnabled ? 'text-neutral-900' : 'text-neutral-400'
              }`}
            >
              {speechEnabled ? (
                <Volume2 className="w-5 h-5" />
              ) : (
                <VolumeX className="w-5 h-5" />
              )}
            </Button>
            {/* Language Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLanguage}
              className="flex items-center gap-2 text-neutral-600 hover:text-neutral-900"
            >
              <Languages className="w-5 h-5" />
              <span className="font-medium">{language === 'en' ? 'FR' : 'EN'}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-6 py-8 flex flex-col pb-32">
        {messages.length === 0 && !voiceModeActive ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center max-w-2xl mx-auto">
            <div className="w-20 h-20 rounded-full bg-neutral-100 flex items-center justify-center mb-6">
              <Mic className="w-10 h-10 text-neutral-400" />
            </div>
            <h2 className="text-3xl font-semibold text-neutral-900 mb-3">{t('welcome')}</h2>
            <p className="text-neutral-600 text-lg leading-relaxed">
              {t('instructions')}
            </p>
          </div>
        ) : voiceModeActive ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            {/* Voice Mode UI */}
            <div className="w-full max-w-2xl mx-auto space-y-6">
              {messages.slice(-2).map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <Card
                    className={`max-w-[80%] p-4 ${
                      msg.role === "user"
                        ? "bg-neutral-900 text-white"
                        : "bg-white border-neutral-200"
                    }`}
                  >
                    {msg.isLoading ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Thinking...</span>
                      </div>
                    ) : (
                      <Streamdown className="prose prose-sm max-w-none">
                        {msg.content}
                      </Streamdown>
                    )}
                  </Card>
                </div>
              ))}
            </div>
            
            {/* Large Microphone Button */}
            <div className="mt-12">
              <Button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
                size="lg"
                className={`rounded-full w-24 h-24 flex items-center justify-center ${
                  isRecording
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-neutral-900 hover:bg-neutral-800"
                }`}
              >
                {isProcessing ? (
                  <Loader2 className="w-12 h-12 animate-spin text-white" />
                ) : isRecording ? (
                  <MicOff className="w-12 h-12 text-white" />
                ) : (
                  <Mic className="w-12 h-12 text-white" />
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-6 mb-6 max-w-3xl mx-auto w-full">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <Card
                  className={`max-w-[80%] p-4 ${
                    msg.role === "user"
                      ? "bg-neutral-900 text-white"
                      : "bg-white border-neutral-200"
                  }`}
                >
                  {msg.isLoading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Thinking...</span>
                    </div>
                  ) : (
                    <>
                      <Streamdown className="prose prose-sm max-w-none">
                        {msg.content}
                      </Streamdown>
                      {msg.recipes && msg.recipes.length > 0 && (
                        <div className="mt-4 space-y-3">
                          {msg.recipes.map((recipe) => (
                            <Card key={recipe.id} className="p-4 bg-neutral-50 border-neutral-200">
                              <h3 className="font-semibold text-neutral-900 mb-2">{recipe.name}</h3>
                              {recipe.description && (
                                <p className="text-sm text-neutral-600 mb-3">{recipe.description}</p>
                              )}
                              {recipe.ingredients.length > 0 && (
                                <div className="mb-3">
                                  <h4 className="text-xs font-medium text-neutral-700 mb-1">Ingredients:</h4>
                                  <ul className="text-sm text-neutral-600 space-y-1">
                                    {recipe.ingredients.map((ing, i) => (
                                      <li key={i}>
                                        {ing.amount} {ing.unit} {ing.ingredient}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {recipe.method && (
                                <div className="mb-2">
                                  <h4 className="text-xs font-medium text-neutral-700 mb-1">Method:</h4>
                                  <p className="text-sm text-neutral-600">{recipe.method}</p>
                                </div>
                              )}
                              {recipe.glassType && (
                                <p className="text-xs text-neutral-500">Glass: {recipe.glassType}</p>
                              )}
                              {recipe.funFacts && (
                                <p className="text-xs text-neutral-500 italic mt-2">{recipe.funFacts}</p>
                              )}
                            </Card>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </Card>
              </div>
            ))}
          </div>
        )}

        {/* Input Area - Hidden in Voice Mode */}
        {!voiceModeActive && (
          <div className="max-w-3xl mx-auto w-full">
            <Card className="p-6 bg-white border-neutral-200">
              <div className="flex items-center gap-4 mb-4">
                <Button
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isProcessing}
                  size="lg"
                  className={`rounded-full w-14 h-14 flex items-center justify-center ${
                    isRecording
                      ? "bg-red-500 hover:bg-red-600"
                      : "bg-neutral-900 hover:bg-neutral-800"
                  }`}
                >
                  {isProcessing ? (
                    <Loader2 className="w-6 h-6 animate-spin text-white" />
                  ) : isRecording ? (
                    <MicOff className="w-6 h-6 text-white" />
                  ) : (
                    <Mic className="w-6 h-6 text-white" />
                  )}
                </Button>
                <div className="flex-1">
                  <p className="text-sm font-medium text-neutral-900">{t('voiceInput')}</p>
                  <p className="text-xs text-neutral-500">{t('tapToSpeak')}</p>
                </div>
                {isSpeaking && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={stopSpeaking}
                    className="text-neutral-600"
                  >
                    <VolumeX className="w-5 h-5" />
                  </Button>
                )}
              </div>
              <form onSubmit={handleTextSubmit} className="flex gap-2">
                <Input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={t('typeQuestion')}
                  className="flex-1 border-neutral-300 focus:border-neutral-900"
                  disabled={isProcessing}
                />
                <Button
                  type="submit"
                  disabled={!textInput.trim() || isProcessing}
                  className="bg-neutral-900 hover:bg-neutral-800"
                >
                  <Send className="w-5 h-5" />
                </Button>
              </form>
            </Card>
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <BottomNav
        onSignatures={() => handleQuickAction("Show me our signature cocktails")}
        onUpselling={() => handleQuickAction("Give me upselling tips")}
        onQuickTips={() => handleQuickAction("Give me quick service tips")}
        onVoiceMode={() => setVoiceModeActive(!voiceModeActive)}
        voiceModeActive={voiceModeActive}
        disabled={voiceModeActive}
        translations={{
          signatures: t('signatures'),
          upselling: t('upselling'),
          quickTips: t('quickTips'),
          voiceMode: t('voiceMode'),
        }}
      />
    </div>
  );
}
