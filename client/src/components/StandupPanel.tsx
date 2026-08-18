import type { ParticipantStandup, MeetingPhase, Participant } from '../types/voice.js';
import { Card, SectionLabel } from './ui/index.js';

const PHASE_LABEL: Record<MeetingPhase, string> = {
  idle: 'Idle', greeting: 'Greeting', yesterday: 'Yesterday',
  today: 'Today', blockers: 'Blockers', summary: 'Summary', completed: 'Done',
};

function CompletionRing({ pct }: { pct: number }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  // Matches the brand/success tokens in tailwind.config.js — SVG stroke
  // can't take a Tailwind class, so these are the same colors spelled out.
  const color = pct >= 100 ? '#34d399' : '#7c5cff';
  return (
    <div className="relative w-12 h-12 flex-shrink-0">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="#1f2937" strokeWidth="4" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeLinecap="round" strokeDasharray={circ}
          strokeDashoffset={circ - (pct / 100) * circ}
          className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-bold text-gray-300">{pct}%</span>
      </div>
    </div>
  );
}

function Section({ title, items, empty, accent }: {
  title: string; items: string[]; empty: string; accent: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className={`text-[10px] font-bold uppercase tracking-widest ${accent}`}>{title}</p>
      {items.length === 0
        ? <p className="text-[11px] text-gray-600 italic pl-2">{empty}</p>
        : <ul className="space-y-1">
            {items.map((it, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-gray-300 anim-in">
                <span className={`mt-[5px] w-1 h-1 rounded-full flex-shrink-0 ${accent.replace('text-', 'bg-')}`} />
                {it === 'none' ? 'No blockers 🎉' : it}
              </li>
            ))}
          </ul>
      }
    </div>
  );
}

interface Props {
  participants: Participant[];
  standups: Record<string, ParticipantStandup>;
  phase: MeetingPhase;
  currentSpeakerId: string | null;
}

export function StandupPanel({ participants, standups, phase, currentSpeakerId }: Props) {
  const overall = participants.length
    ? Math.round(
        participants.reduce((sum, p) => sum + (standups[p.id]?.completionPercentage ?? 0), 0) / participants.length
      )
    : 0;

  return (
    <Card className="!p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <SectionLabel>Standup progress</SectionLabel>
        <CompletionRing pct={overall} />
      </div>

      {participants.length === 0 ? (
        <p className="text-[11px] text-gray-600 italic">No team members yet.</p>
      ) : (
        <div className="space-y-4 divide-y divide-gray-800">
          {participants.map((p, idx) => {
            const data = standups[p.id];
            const speaking = p.id === currentSpeakerId;
            const pct = data?.completionPercentage ?? 0;
            const hasAnyData = !!data && (data.yesterday.length > 0 || data.today.length > 0 || data.blockers.length > 0);

            return (
              <div key={p.id} className={idx > 0 ? 'pt-4' : ''}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: p.color }}>
                    {p.name.slice(0, 1).toUpperCase()}
                  </div>
                  <span className="text-[12px] font-medium text-gray-200 truncate">{p.name}</span>
                  {speaking && (
                    <span className="flex items-center gap-1 text-[10px] text-live ml-auto flex-shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse" /> {PHASE_LABEL[phase]}
                    </span>
                  )}
                  {!speaking && p.hasSpoken && (
                    <span className="text-[10px] text-emerald-500 ml-auto flex-shrink-0">✓ {pct}%</span>
                  )}
                  {!speaking && !p.hasSpoken && (
                    <span className="text-[10px] text-gray-600 ml-auto flex-shrink-0">waiting</span>
                  )}
                </div>

                {(hasAnyData || speaking) && (
                  <div className="space-y-3 pl-7">
                    <Section title="✅ Yesterday" items={data?.yesterday ?? []} empty="Not yet collected" accent="text-emerald-400" />
                    <Section title="🎯 Today" items={data?.today ?? []} empty="Not yet collected" accent="text-blue-400" />
                    <Section title="🚧 Blockers" items={data?.blockers ?? []} empty="Not yet collected" accent="text-orange-400" />
                    {data && data.missingInfo.length > 0 && phase !== 'completed' && (
                      <Section title="⏳ Still needed" items={data.missingInfo} empty="" accent="text-amber-500" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
