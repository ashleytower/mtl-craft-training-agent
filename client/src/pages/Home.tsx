import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Mic, MicOff, Loader2, Send, Volume2, VolumeX } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Streamdown } from "streamdown";
import { storagePut } from "@/lib/storage";

type Recipe = {
  id: number;
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const speechSynthesisRef = useRef<SpeechSynthesisUtterance | null>(null);

  const transcribeMutation = trpc.voice.transcribe.useMutation();
  const sendMessageMutation = trpc.chat.sendMessage.useMutation();

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup speech synthesis on unmount
  useEffect(() => {
    return () => {
      if (speechSynthesisRef.current) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const speakText = (text: string) => {
    if (!speechEnabled) return;
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    speechSynthesisRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processAudio(audioBlob);
        
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not access microphone. Please check permissions.');
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
        language: 'en',
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
    if (!text.trim()) return;

    stopSpeaking();
    
    setMessages(prev => [...prev, {
      role: "user",
      content: text,
    }]);

    setMessages(prev => [...prev, {
      role: "assistant",
      content: "",
      isLoading: true,
    }]);

    try {
      const response = await sendMessageMutation.mutateAsync({
        message: text,
        audioUrl,
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

      // Speak the response
      speakText(response.message);

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

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold text-neutral-900">Le Fou Fou</h1>
          <p className="text-sm text-neutral-500">AI-powered cocktail training assistant</p>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-6 py-8 flex flex-col max-w-4xl">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto mb-6 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-16">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-neutral-100 mb-4">
                <Mic className="w-8 h-8 text-neutral-600" />
              </div>
              <h2 className="text-2xl font-semibold text-neutral-900 mb-2">
                Welcome
              </h2>
              <p className="text-neutral-600 max-w-md mx-auto leading-relaxed">
                Ask me anything about cocktails, bar service, or workshop planning. 
                Use voice or type your question below.
              </p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <Card
                  className={`max-w-[85%] ${
                    msg.role === "user"
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "bg-white border-neutral-200"
                  }`}
                >
                  <div className="p-4">
                    {msg.isLoading ? (
                      <div className="flex items-center gap-2 text-neutral-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Thinking...</span>
                      </div>
                    ) : (
                      <>
                        <div className={`prose prose-sm max-w-none ${
                          msg.role === "user" ? "prose-invert" : ""
                        }`}>
                          <Streamdown>{msg.content}</Streamdown>
                        </div>
                        
                        {msg.recipes && msg.recipes.length > 0 && (
                          <div className="mt-4 space-y-4">
                            {msg.recipes.map(recipe => (
                              <div key={recipe.id} className="border border-neutral-200 rounded-xl p-4 bg-neutral-50">
                                <h3 className="text-lg font-semibold text-neutral-900 mb-1">{recipe.name}</h3>
                                {recipe.description && (
                                  <p className="text-sm text-neutral-600 mb-3">{recipe.description}</p>
                                )}
                                
                                {recipe.ingredients.length > 0 && (
                                  <div className="mb-3">
                                    <h4 className="text-sm font-semibold text-neutral-900 mb-2">Ingredients:</h4>
                                    <ul className="space-y-1">
                                      {recipe.ingredients.map((ing, i) => (
                                        <li key={i} className="text-sm text-neutral-700">
                                          {ing.amount && ing.unit ? `${ing.amount} ${ing.unit} ` : ''}
                                          {ing.ingredient}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                
                                <div className="mb-2">
                                  <h4 className="text-sm font-semibold text-neutral-900 mb-1">Method:</h4>
                                  <p className="text-sm text-neutral-700">{recipe.method}</p>
                                </div>
                                
                                {recipe.glassType && (
                                  <p className="text-xs text-neutral-500 mb-2">
                                    <strong>Glass:</strong> {recipe.glassType}
                                  </p>
                                )}
                                
                                {recipe.funFacts && (
                                  <div className="mt-3 pt-3 border-t border-neutral-200">
                                    <p className="text-xs text-neutral-600 italic">{recipe.funFacts}</p>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </Card>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Controls */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          {/* Speech Control */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Button
                size="lg"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
                className={`w-14 h-14 rounded-full ${
                  isRecording
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-neutral-900 hover:bg-neutral-800"
                }`}
              >
                {isRecording ? (
                  <MicOff className="w-6 h-6" />
                ) : (
                  <Mic className="w-6 h-6" />
                )}
              </Button>
              <div>
                <p className="text-sm font-medium text-neutral-900">
                  {isRecording ? "Recording..." : "Voice Input"}
                </p>
                <p className="text-xs text-neutral-500">
                  {isRecording ? "Tap to stop" : "Tap to speak"}
                </p>
              </div>
            </div>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (isSpeaking) {
                  stopSpeaking();
                } else {
                  setSpeechEnabled(!speechEnabled);
                }
              }}
              className="text-neutral-600"
            >
              {isSpeaking ? (
                <VolumeX className="w-5 h-5" />
              ) : speechEnabled ? (
                <Volume2 className="w-5 h-5" />
              ) : (
                <VolumeX className="w-5 h-5" />
              )}
            </Button>
          </div>

          {/* Text Input */}
          <form onSubmit={handleTextSubmit} className="flex gap-2">
            <Input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Or type your question..."
              disabled={isProcessing || isRecording}
              className="flex-1 bg-neutral-50 border-neutral-200 focus:border-neutral-400"
            />
            <Button
              type="submit"
              disabled={!textInput.trim() || isProcessing || isRecording}
              className="bg-neutral-900 hover:bg-neutral-800"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>

          {isProcessing && (
            <div className="mt-3 flex items-center gap-2 text-neutral-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Processing your message...</span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
