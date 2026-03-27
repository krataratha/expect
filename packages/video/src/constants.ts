export const VIDEO_WIDTH_PX = 1920;
export const VIDEO_HEIGHT_PX = 1080;
export const VIDEO_FPS = 30;

export const BACKGROUND_COLOR = "#0a0a0a";
export const TEXT_COLOR = "#d4d4d8";
export const MUTED_COLOR = "#737373";
export const RED_COLOR = "#f87171";
export const GREEN_COLOR = "#4ade80";
export const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const SPINNER_SPEED_FRAMES = 3;

export const SCENE_TYPING_DURATION_FRAMES = 70;
export const SCENE_COVERAGE_BAR_DURATION_FRAMES = 95;
export const TRANSITION_DURATION_FRAMES = 15;

export const TOTAL_DURATION =
  SCENE_TYPING_DURATION_FRAMES +
  SCENE_COVERAGE_BAR_DURATION_FRAMES +
  345 -
  TRANSITION_DURATION_FRAMES * 2;
