import { useEffect, useRef } from 'react';
import type { TranscriptEntry, Participant } from '../types/voice.js';
import { SectionLabel } from './ui/index.js';

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function SoundWave() {
  return (
    <div className="flex items-end gap-0.5 h-3.5">
      {[1,2,3,4,5].map((_, i) => (
        <div key={i} className="wave-bar w-0.5 rounded-full bg-live" style={{ height: '100%' }} />
      ))}
    </div>
  );
}

export function TranscriptPanel({ entries, isAiSpeaking, participants }: {
  entries: TranscriptEntry[];
  isAiSpeaking: boolean;
  participants: Participant[];
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  const colorFor = (participantId?: string) =>
    participants.find((p) => p.id === participantId)?.color ?? '#3b82f6';

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <SectionLabel>Live transcript</SectionLabel>
        <div className="flex items-center gap-3">
          {isAiSpeaking && (
            <div className="flex items-center gap-1.5 text-[11px] text-live">
              <SoundWave />
              <span>Speaking</span>
            </div>
          )}
          <span className="text-[10px] text-gray-600 font-mono">{entries.length} msg</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-600">The transcript appears here once the meeting starts.</p>
          </div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className={`anim-in flex gap-2.5 ${e.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {/* Avatar */}
              <div
                className={`flex-shrink-0 w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center border ${
                  e.role === 'assistant'
                    ? 'bg-brand-subtle border-brand/30 text-brand'
                    : 'text-white border-transparent'
                }`}
                style={e.role === 'user' ? { backgroundColor: colorFor(e.participantId) } : undefined}
              >
                {e.role === 'assistant' ? 'AI' : (e.participantName?.slice(0, 1).toUpperCase() ?? 'U')}
              </div>

              {/* Bubble */}
              <div className={`max-w-[78%] flex flex-col gap-0.5 ${e.role === 'user' ? 'items-end' : 'items-start'}`}>
                {e.role === 'user' && e.participantName && (
                  <span className="text-[9px] text-gray-500 px-1">{e.participantName}</span>
                )}
                <div className={`px-3 py-2 rounded-xl text-[13px] leading-relaxed ${
                  e.role === 'assistant'
                    ? 'bg-gray-800 text-gray-200 rounded-tl-sm'
                    : 'bg-blue-600/15 border border-blue-500/20 text-blue-100 rounded-tr-sm'
                }`}>
                  {e.content}
                </div>
                <span className="text-[9px] text-gray-600 font-mono px-1">{fmtTime(e.timestamp)}</span>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
