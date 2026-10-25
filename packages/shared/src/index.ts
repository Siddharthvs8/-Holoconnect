export type Participant = { id: string; name: string; joinedAt: string };
export type RoomSummary = { id: string; roomCode: string; creatorId: string; status: "active" | "ended"; participants: Participant[] };
export type SignalEvents = {
  "room:join": (payload: { roomCode: string; displayName: string }) => void;
  "room:joined": (payload: { roomCode: string; participants: Participant[]; isInitiator: boolean }) => void;
  "room:error": (payload: { message: string }) => void;
  "participant:joined": (participant: Participant) => void;
  "participant:left": (payload: { participantId: string }) => void;
  offer: (payload: { to: string; description: RTCSessionDescriptionInit }) => void;
  answer: (payload: { to: string; description: RTCSessionDescriptionInit }) => void;
  "ice-candidate": (payload: { to: string; candidate: RTCIceCandidateInit }) => void;
};
