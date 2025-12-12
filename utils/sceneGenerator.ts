
import { SceneParams, GeometricFrame, ShapeType } from '../types';
import { randomRange, generateId } from './math';

// High contrast surveillance/cyberpunk palettes
const PALETTES = [
  { primary: '#00FF41', secondary: '#003B00', bg: '#000000' }, // Matrix Green
  { primary: '#FF0055', secondary: '#550011', bg: '#050002' }, // Cyber Red
  { primary: '#00F0FF', secondary: '#003344', bg: '#000508' }, // Neon Cyan
  { primary: '#FFFFFF', secondary: '#444444', bg: '#111111' }, // Stark White
  { primary: '#FFD700', secondary: '#332200', bg: '#0A0500' }, // Cyber Gold
  { primary: '#9D00FF', secondary: '#220033', bg: '#05000A' }, // Electric Purple
  { primary: '#FF4400', secondary: '#330D00', bg: '#050100' }, // High Voltage Orange
  { primary: '#FF00FF', secondary: '#440044', bg: '#0A000A' }, // Magenta Glitch
];

const SHAPE_TYPES: ShapeType[] = ['rect']; // Focusing on Rects for the "screen" look in reference

export const generateNewScene = (): SceneParams => {
  const palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
  // Increased count significantly from (6, 10) to (20, 35) for more density
  const shapeCount = Math.floor(randomRange(20, 35)); 
  const shapes: GeometricFrame[] = [];

  for (let i = 0; i < shapeCount; i++) {
    const isMain = i === 0; // Ensure at least one large focal point
    shapes.push({
      id: generateId(),
      type: 'rect',
      delayFrames: Math.floor(randomRange(2, 45)), 
      // Wider distribution to use more screen space
      x: isMain ? 0.5 : randomRange(0.05, 0.95),
      y: isMain ? 0.5 : randomRange(0.05, 0.95),
      // Adjusted scale range to allow for smaller fragments given the higher density
      scale: isMain ? randomRange(1.8, 2.5) : randomRange(0.3, 1.4),
      rotation: 0, // Keep rects axis-aligned for the surveillance look
      rotationSpeed: 0,
      color: Math.random() > 0.3 ? palette.primary : '#FFFFFF',
      glitchIntensity: randomRange(0.1, 0.9),
    });
  }

  return {
    backgroundColor: palette.bg,
    primaryColor: palette.primary,
    secondaryColor: palette.secondary,
    shapes,
    glitchMode: Math.random() > 0.5 ? 'rgb-split' : 'invert',
  };
};
