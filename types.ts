export interface Point {
  x: number;
  y: number;
  z?: number;
}

export interface EyeData {
  image: ImageBitmap | null;
  timestamp: number;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface FrameHistory {
  leftEye: EyeData;
  rightEye: EyeData;
}

export type ShapeType = 'rect' | 'circle' | 'triangle' | 'slice';

export interface GeometricFrame {
  id: string;
  type: ShapeType;
  delayFrames: number; // How far back in history to look
  x: number; // Normalized 0-1
  y: number; // Normalized 0-1
  scale: number;
  rotation: number;
  rotationSpeed: number;
  color: string;
  glitchIntensity: number;
}

export interface SceneParams {
  backgroundColor: string;
  shapes: GeometricFrame[];
  primaryColor: string;
  secondaryColor: string;
  glitchMode: 'rgb-split' | 'pixel-sort' | 'invert';
}