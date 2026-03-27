export interface SoundAsset {
  /** Unique identifier for the sound */
  name: string;
  /** Base64-encoded data URI (data:audio/mpeg;base64,...) */
  dataUri: string;
  /** Duration in seconds */
  duration: number;
  /** Audio format */
  format: "mp3" | "wav" | "ogg";
  /** License identifier */
  license: "CC0" | "OGA-BY" | "MIT";
  /** Original author/creator */
  author: string;
}

export interface UseSoundOptions {
  volume?: number;
  playbackRate?: number;
  interrupt?: boolean;
  soundEnabled?: boolean;
  onPlay?: () => void;
  onEnd?: () => void;
  onPause?: () => void;
  onStop?: () => void;
}

export type PlayFunction = (overrides?: { volume?: number; playbackRate?: number }) => void;

export interface SoundControls {
  stop: () => void;
  pause: () => void;
  isPlaying: boolean;
  duration: number | null;
  sound: SoundAsset;
}

export type UseSoundReturn = readonly [PlayFunction, SoundControls];
