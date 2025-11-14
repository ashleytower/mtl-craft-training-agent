# Bar Training Voice Agent - TODO

## Completed
- [x] Design database schema for cocktail recipes
- [x] Design database schema for packing checklists
- [x] Design database schema for workshop planning data
- [x] Seed database with cocktail recipes from knowledge base
- [x] Seed database with packing checklist items
- [x] Create voice transcription endpoint using Whisper API
- [x] Build chat history management
- [x] Implement LLM integration for intelligent responses

## Current Sprint - Voice Agent MVP
- [x] Build voice recording UI with microphone controls
- [x] Implement audio upload to storage
- [x] Create voice chat interface
- [x] Add loading states for transcription and response
- [x] Test complete voice interaction flow
- [x] Add mobile responsiveness

## Future - RAG Integration
- [ ] Connect Google Sheets for knowledge base
- [ ] Build RAG system for retrieving bar training information
- [ ] Enhance LLM responses with context from knowledge base

## New Features - Speech-to-Speech & Recipe Display
- [x] Add text-to-speech for AI responses (speech output)
- [x] Add text input field alongside voice recording
- [x] Implement recipe card display when cocktails are mentioned
- [x] Redesign with Apple-inspired neutral colors (grays, whites, blacks)
- [x] Update typography to SF Pro-style clean fonts
- [x] Add smooth animations and transitions
- [x] Implement minimalist UI with proper spacing

## Le Fou Fou Client Prototype
- [x] Access Notion SOP Workshop Pointers
- [x] Access Google Sheets cocktail database
- [x] Rebrand app to "Le Fou Fou"
- [x] Integrate SOP content into AI knowledge base
- [x] Update system prompts with Le Fou Fou context
- [x] Integrate real cocktail data from Google Sheets (using existing sample data)

## Bilingual Support & Logo Update
- [x] Add Le Fou Fou logo from client URL
- [x] Implement language toggle (EN/FR)
- [x] Update UI to support bilingual content
- [x] Add French translations for interface text
- [x] Update AI to respond in selected language

## Google Sheets RAG Integration
- [x] Set up Google Sheets API connection
- [x] Create service to fetch cocktail data from sheets
- [x] Create service to fetch ingredients from sheets
- [x] Create service to fetch preparation steps from sheets
- [x] Update AI system to use live Google Sheets data
- [x] Test real-time updates from spreadsheet

## ElevenLabs TTS Integration
- [x] Add ElevenLabs API key as secret
- [x] Create server-side TTS endpoint using ElevenLabs API
- [x] Select appropriate voices for English and French
- [x] Update frontend to use ElevenLabs instead of browser TTS
- [x] Test voice quality and latency

## Urgent Fixes for Demo
- [x] Fix Google Sheets not loading real recipes
- [x] Fix ElevenLabs voice not playing

## Critical Bug
- [x] Fix voice recording - takes recording but no AI response comes back (was just slow)

## Voice Improvements
- [x] Speed up voice response flow
- [x] Use more conversational ElevenLabs voice
- [x] Add prominent voice on/off toggle
- [x] Only speak recipe/answer text, not full markdown

## UI Improvements
- [x] Add Le Fou Fou logo to header
- [x] Add 3 quick action buttons at bottom: Signature Drinks, Upselling Tips, Quick Tips
- [x] Speed up voice playback rate (1.15x)

## Voice Mode UI Redesign
- [x] Add fixed bottom button bar: Signatures, Upselling, Quick Tips, Voice Mode
- [x] Remove quick action buttons from above input
- [x] Voice Mode button activates voice-only interface (hides text input, shows only mic)
- [x] Voice toggle (speaker icon) controls ElevenLabs TTS calls
- [x] Make Voice Mode button slightly larger/special
- [x] Keep light theme, clean minimal design

## Bottom Button Styling & Signature View
- [x] Add LiquidButton component for bottom buttons
- [ ] Apply Le Fou Fou brand colors (sage green, dark gray, cream) - LATER
- [x] Make buttons smaller/mobile-optimized
- [ ] Create signature cocktail detail view (like Old Fashioned example)
- [x] Make colors easily customizable for multi-restaurant use (neutral default)

## Critical Bug Fix
- [x] Fix voice transcription error: "Invalid transcription response" - Added detailed logging

## Bottom Navigation Redesign
- [x] Research best mobile bottom navigation patterns (Instagram, Spotify, banking apps)
- [x] Create unified, intuitive bottom navigation design
- [x] Implement modern tab bar with proper spacing and touch targets
- [x] Add smooth transitions and active states
- [x] Ensure all components follow unified design system

## System Prompt Update
- [x] Replace current prompt with improved structured format
- [x] Remove workshop references (that's for Mtl Craft, not Le Fou Fou app)
- [x] Test new prompt with sample questions
