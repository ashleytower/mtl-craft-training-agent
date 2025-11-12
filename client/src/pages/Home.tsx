import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Mic, MicOff, Loader2, Send } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Streamdown } from "streamdown";
import { storagePut } from "@/lib/storage";

type Message = {
  role: "user" | "assistant";
  content: string;
  isLoading?: boolean;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const transcribeMutation = trpc.voice.transcribe.useMutation();
  const sendMessageMutation = trpc.chat.sendMessage.useMutation();

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        
        // Stop all tracks
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
      // Check file size (16MB limit)
      const sizeMB = audioBlob.size / (1024 * 1024);
      if (sizeMB > 16) {
        alert('Audio file is too large. Please record a shorter message.');
        setIsProcessing(false);
        return;
      }

      // Upload audio to storage
      const audioBuffer = await audioBlob.arrayBuffer();
      const timestamp = Date.now();
      const audioKey = `voice-recordings/recording-${timestamp}.webm`;
      
      const { url: audioUrl } = await storagePut(
        audioKey,
        new Uint8Array(audioBuffer),
        'audio/webm'
      );

      // Transcribe audio
      const transcription = await transcribeMutation.mutateAsync({
        audioUrl,
        language: 'en',
      });

      // Add user message
      setMessages(prev => [...prev, {
        role: "user",
        content: transcription.text,
      }]);

      // Add loading message
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "",
        isLoading: true,
      }]);

      // Get AI response
      const response = await sendMessageMutation.mutateAsync({
        message: transcription.text,
        audioUrl,
      });

      // Replace loading message with actual response
      setMessages(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = {
          role: "assistant",
          content: response.message,
          isLoading: false,
        };
        return newMessages;
      });

    } catch (error) {
      console.error('Error processing audio:', error);
      setMessages(prev => prev.filter(m => !m.isLoading));
      alert('Failed to process audio. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex flex-col">
      {/* Header */}
      <header className="bg-black/20 backdrop-blur-sm border-b border-white/10">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-white">Bar Training Voice Agent</h1>
          <p className="text-sm text-purple-200">Your AI assistant for bartending excellence</p>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6 flex flex-col max-w-4xl">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto mb-6 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-purple-500/20 mb-4">
                <Mic className="w-10 h-10 text-purple-300" />
              </div>
              <h2 className="text-2xl font-semibold text-white mb-2">
                Welcome to Bar Training Voice Agent
              </h2>
              <p className="text-purple-200 max-w-md mx-auto">
                Press the microphone button below to start a voice conversation. 
                Ask me anything about cocktails, bar service, or workshop planning!
              </p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <Card
                key={idx}
                className={`p-4 ${
                  msg.role === "user"
                    ? "bg-purple-600/20 border-purple-500/30 ml-auto max-w-[80%]"
                    : "bg-slate-800/50 border-slate-700/50 mr-auto max-w-[80%]"
                }`}
              >
                {msg.isLoading ? (
                  <div className="flex items-center gap-2 text-purple-200">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Thinking...</span>
                  </div>
                ) : (
                  <div className="text-white prose prose-invert max-w-none">
                    <Streamdown>{msg.content}</Streamdown>
                  </div>
                )}
              </Card>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Recording Controls */}
        <div className="bg-black/30 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
          <div className="flex flex-col items-center gap-4">
            {isProcessing ? (
              <div className="text-center">
                <Loader2 className="w-12 h-12 animate-spin text-purple-400 mx-auto mb-2" />
                <p className="text-purple-200">Processing your message...</p>
              </div>
            ) : (
              <>
                <Button
                  size="lg"
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isProcessing}
                  className={`w-20 h-20 rounded-full ${
                    isRecording
                      ? "bg-red-500 hover:bg-red-600 animate-pulse"
                      : "bg-purple-600 hover:bg-purple-700"
                  }`}
                >
                  {isRecording ? (
                    <MicOff className="w-8 h-8" />
                  ) : (
                    <Mic className="w-8 h-8" />
                  )}
                </Button>
                <p className="text-sm text-purple-200">
                  {isRecording ? "Recording... Tap to stop" : "Tap to start recording"}
                </p>
              </>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-black/20 backdrop-blur-sm border-t border-white/10 py-4">
        <div className="container mx-auto px-4 text-center text-sm text-purple-300">
          Powered by AI • Mtl Craft Cocktails
        </div>
      </footer>
    </div>
  );
}
