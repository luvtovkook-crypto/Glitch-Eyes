import { Point } from '../types';

export const distance = (p1: Point, p2: Point) => {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
};

export const lerp = (start: number, end: number, t: number) => {
  return start * (1 - t) + end * t;
};

// Calculate Eye Aspect Ratio to detect blinking
export const calculateEAR = (landmarks: Point[], indices: number[]) => {
  // indices: [left, right, top, bottom] roughly
  // Vertical distance
  const v1 = distance(landmarks[indices[2]], landmarks[indices[3]]);
  // Horizontal distance
  const h1 = distance(landmarks[indices[0]], landmarks[indices[1]]);
  return v1 / h1;
};

// MediaPipe Face Mesh Indices
export const LEFT_EYE_INDICES = [33, 133, 159, 145]; // Left, Right, Top, Bottom
export const RIGHT_EYE_INDICES = [362, 263, 386, 374];

export const HEAD_NOSE_INDEX = 1;

export const randomRange = (min: number, max: number) => Math.random() * (max - min) + min;

export const generateId = () => Math.random().toString(36).substr(2, 9);