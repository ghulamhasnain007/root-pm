/**
 * Shared meeting-data shapes used by StandupPanel/TranscriptPanel — reused
 * by both the (removed) in-browser meeting UI's design and the Discord
 * meeting panel, which polls GET /integrations/discord/meetings/:guildId/status
 * for a payload matching MeetingState directly.
 */

export type MeetingPhase =
  | 'idle' | 'greeting' | 'yesterday' | 'today' | 'blockers' | 'summary' | 'completed';

export interface StandupData {
  yesterday: string[];
  today: string[];
  blockers: string[];
  missingInfo: string[];
  completionPercentage: number;
}

export interface ParticipantStandup extends StandupData {
  participantId: string;
}

export interface Participant {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  hasSpoken: boolean;
  connected: boolean;
}

export interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  participantId?: string;
  participantName?: string;
  content: string;
  timestamp: number;
}

export interface AudioDiagnostics {
  packetsDecoded: number;
  peakLevel: number;
  chunksSentToGemini: number;
  chunksDroppedByGate: number;
  chunksSentToDiscord: number;
  resubscribes: number;
  aiSpeaking: boolean;
  geminiDoneSendingAudio: boolean;
  silenceSeconds: number;
}

export interface MeetingState {
  id: string;
  phase: MeetingPhase;
  startedAt: number | null;
  durationMs: number;
  participants: Participant[];
  turnOrder: string[];
  currentSpeakerId: string | null;
  standups: Record<string, ParticipantStandup>;
  transcript: TranscriptEntry[];
  isActive: boolean;
  diagnostics?: AudioDiagnostics;
}
