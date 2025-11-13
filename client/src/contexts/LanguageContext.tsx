import { createContext, useContext, useState, ReactNode } from "react";

type Language = "en" | "fr";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const translations = {
  en: {
    appTitle: "Le Fou Fou",
    appSubtitle: "AI-powered cocktail training assistant",
    welcomeTitle: "Welcome",
    welcomeMessage: "Ask me anything about cocktails, bar service, or workshop planning. Use voice or type your question below.",
    voiceInput: "Voice Input",
    tapToSpeak: "Tap to speak",
    tapToStop: "Tap to stop",
    recording: "Recording...",
    orType: "Or type your question...",
    processing: "Processing your message...",
    thinking: "Thinking...",
    ingredients: "Ingredients:",
    method: "Method:",
    glass: "Glass:",
    send: "Send",
  },
  fr: {
    appTitle: "Le Fou Fou",
    appSubtitle: "Assistant de formation cocktail propulsé par IA",
    welcomeTitle: "Bienvenue",
    welcomeMessage: "Demandez-moi n'importe quoi sur les cocktails, le service de bar ou la planification d'ateliers. Utilisez la voix ou tapez votre question ci-dessous.",
    voiceInput: "Entrée vocale",
    tapToSpeak: "Appuyez pour parler",
    tapToStop: "Appuyez pour arrêter",
    recording: "Enregistrement...",
    orType: "Ou tapez votre question...",
    processing: "Traitement de votre message...",
    thinking: "Réflexion...",
    ingredients: "Ingrédients:",
    method: "Méthode:",
    glass: "Verre:",
    send: "Envoyer",
  },
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");

  const t = (key: string): string => {
    return translations[language][key as keyof typeof translations.en] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}
