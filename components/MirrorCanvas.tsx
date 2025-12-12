import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as faceMesh from '@mediapipe/face_mesh';
import * as cam from '@mediapipe/camera_utils';
import { 
  calculateEAR, 
  LEFT_EYE_INDICES, 
  RIGHT_EYE_INDICES, 
  HEAD_NOSE_INDEX, 
  lerp,
  distance
} from '../utils/math';
import { generateNewScene } from '../utils/sceneGenerator';
import { FrameHistory, Point, SceneParams } from '../types';

const BLINK_THRESHOLD = 0.18;
const MAX_HISTORY = 60;

interface RenderedShape {
  x: number;
  y: number;
  size: number;
  shape: any; // Reference to original shape param
}

export const MirrorCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<FrameHistory[]>([]);
  
  const [isLoaded, setIsLoaded] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const [fps, setFps] = useState(0);

  const sceneParamsRef = useRef<SceneParams>(generateNewScene());
  const headPosRef = useRef<Point>({ x: 0.5, y: 0.5 });
  const targetHeadPosRef = useRef<Point>({ x: 0.5, y: 0.5 });
  const blinkCooldownRef = useRef(0);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(0);
  // Removed hueShiftRef to rely on strict palettes
  const resetFlashRef = useRef(0); // Track animation intensity for scramble feedback

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const initMediaPipe = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fmAny = faceMesh as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const camAny = cam as any;

        const FaceMeshClass = fmAny.FaceMesh || fmAny.default?.FaceMesh || fmAny.default;
        const CameraClass = camAny.Camera || camAny.default?.Camera || camAny.default;

        if (!FaceMeshClass || !CameraClass) {
            throw new Error("Failed to load MediaPipe modules");
        }

        const faceMeshClient = new FaceMeshClass({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });

        faceMeshClient.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        faceMeshClient.onResults(onResults);

        if (videoRef.current) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const camera = new CameraClass(videoRef.current, {
            onFrame: async () => {
              if (videoRef.current) {
                await faceMeshClient.send({ image: videoRef.current });
              }
            },
            width: 1280,
            height: 720,
          });

          await camera.start();
          setIsLoaded(true);
        }
      } catch (err) {
        console.error("MediaPipe Init Error:", err);
        setPermissionError(true);
      }
    };

    initMediaPipe();

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
         const stream = videoRef.current.srcObject as MediaStream;
         stream.getTracks().forEach(track => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetScene = useCallback(() => {
    // Trigger reset animation and regenerate scene parameters
    sceneParamsRef.current = generateNewScene();
    resetFlashRef.current = 1.0; 
  }, []);

  const extractEye = (
    image: CanvasImageSource, 
    landmarks: Point[], 
    indices: number[],
    width: number,
    height: number
  ): Promise<ImageBitmap> | null => {
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    
    indices.forEach(idx => {
      const p = landmarks[idx];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    const paddingX = (maxX - minX) * 0.6;
    const paddingY = (maxY - minY) * 1.0;
    
    minX = Math.max(0, minX - paddingX);
    maxX = Math.min(1, maxX + paddingX);
    minY = Math.max(0, minY - paddingY);
    maxY = Math.min(1, maxY + paddingY);

    const sx = minX * width;
    const sy = minY * height;
    const sw = (maxX - minX) * width;
    const sh = (maxY - minY) * height;

    if (sw <= 0 || sh <= 0) return null;

    return createImageBitmap(image, sx, sy, sw, sh);
  };

  const onResults = async (results: faceMesh.Results) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const now = performance.now();
    if (now - lastTimeRef.current >= 1000) {
        setFps(frameCountRef.current);
        frameCountRef.current = 0;
        lastTimeRef.current = now;
    }
    frameCountRef.current++;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // Logic
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const landmarks = results.multiFaceLandmarks[0];
      const nose = landmarks[HEAD_NOSE_INDEX];
      targetHeadPosRef.current = { x: 1 - nose.x, y: nose.y };

      const leftEAR = calculateEAR(landmarks, LEFT_EYE_INDICES);
      const rightEAR = calculateEAR(landmarks, RIGHT_EYE_INDICES);
      
      if (leftEAR < BLINK_THRESHOLD && rightEAR < BLINK_THRESHOLD) {
        if (blinkCooldownRef.current <= 0) {
          blinkCooldownRef.current = 25; 
          resetScene();
        }
      }

      try {
        const [leftEyeBmp, rightEyeBmp] = await Promise.all([
          extractEye(results.image, landmarks, LEFT_EYE_INDICES, video.videoWidth, video.videoHeight),
          extractEye(results.image, landmarks, RIGHT_EYE_INDICES, video.videoWidth, video.videoHeight)
        ]);

        if (leftEyeBmp && rightEyeBmp) {
            const newFrame: FrameHistory = {
                leftEye: { image: leftEyeBmp, timestamp: now, bounds: {x:0, y:0, width:0, height:0} }, 
                rightEye: { image: rightEyeBmp, timestamp: now, bounds: {x:0, y:0, width:0, height:0} }
            };
            
            historyRef.current.unshift(newFrame);
            if (historyRef.current.length > MAX_HISTORY) {
                const old = historyRef.current.pop();
                old?.leftEye.image?.close();
                old?.rightEye.image?.close();
            }
        }
      } catch (e) {
          console.error("Bitmap extraction failed", e);
      }
    } else {
        targetHeadPosRef.current = { x: 0.5, y: 0.5 };
    }

    if (blinkCooldownRef.current > 0) blinkCooldownRef.current--;
    headPosRef.current.x = lerp(headPosRef.current.x, targetHeadPosRef.current.x, 0.08);
    headPosRef.current.y = lerp(headPosRef.current.y, targetHeadPosRef.current.y, 0.08);

    renderScene(ctx, canvas.width, canvas.height, video);
  };

  const renderScene = (
    ctx: CanvasRenderingContext2D, 
    width: number, 
    height: number, 
    videoElement: HTMLVideoElement
  ) => {
    const params = sceneParamsRef.current;
    const head = headPosRef.current;
    const parallaxX = (head.x - 0.5) * width;
    const parallaxY = (head.y - 0.5) * height;

    // Fixed high blur for the background to maintain the "moody void" atmosphere consistently
    const blurRadius = 15;

    // --- 1. Background Layer: Psychedelic Blur ---
    ctx.save();
    // Draw the raw video feed scaled up slightly to cover edges
    ctx.filter = `blur(${blurRadius}px) grayscale(100%) contrast(150%) brightness(60%)`;
    ctx.drawImage(videoElement, -50, -50, width + 100, height + 100);
    
    // Add a dark overlay to make it a "void"
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, width, height);
    
    // Scanline grid effect in background
    ctx.strokeStyle = params.secondaryColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.15;
    const gridSize = 100;
    // Parallax grid
    const gridOffsetX = parallaxX * 0.1;
    const gridOffsetY = parallaxY * 0.1;
    
    ctx.beginPath();
    for(let x = (gridOffsetX % gridSize); x < width; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
    }
    for(let y = (gridOffsetY % gridSize); y < height; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.restore();

    // --- 2. Calculate Shape Positions (Pre-pass) ---
    const renderedShapes: RenderedShape[] = [];

    params.shapes.forEach((shape) => {
        const historyIndex = Math.min(shape.delayFrames, historyRef.current.length - 1);
        if (historyIndex < 0) return;
        const frameData = historyRef.current[historyIndex];
        if (!frameData) return;

        // Depth logic: closer items (bigger scale) move more
        // Drift logic: shapes drift based on gaze/head pos and glitch intensity
        const depth = shape.scale * 0.5; 
        const gazeDriftX = (head.x - 0.5) * width * 0.4 * shape.glitchIntensity;
        const gazeDriftY = (head.y - 0.5) * height * 0.4 * shape.glitchIntensity;

        const centerX = shape.x * width + (parallaxX * depth) + gazeDriftX;
        const centerY = shape.y * height + (parallaxY * depth) + gazeDriftY;
        const size = 120 * shape.scale;

        renderedShapes.push({ x: centerX, y: centerY, size, shape });
    });

    // --- 3. Draw Connections (Web Effect) ---
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    
    // Connect each shape to nearby shapes
    for (let i = 0; i < renderedShapes.length; i++) {
        for (let j = i + 1; j < renderedShapes.length; j++) {
            const s1 = renderedShapes[i];
            const s2 = renderedShapes[j];
            const d = distance({x: s1.x, y: s1.y}, {x: s2.x, y: s2.y});
            
            // Connection threshold based on canvas size
            if (d < Math.min(width, height) * 0.4) {
                const opacity = 1 - (d / (Math.min(width, height) * 0.4));
                ctx.beginPath();
                ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.8})`;
                ctx.moveTo(s1.x, s1.y);
                ctx.lineTo(s2.x, s2.y);
                ctx.stroke();
            }
        }
    }
    ctx.restore();


    // --- 4. Draw Shapes & UI Overlays (with Trails) ---
    renderedShapes.forEach((item) => {
        const { x, y, size, shape } = item;
        
        // Retrieve Image
        const historyIndex = Math.min(shape.delayFrames, historyRef.current.length - 1);
        const frameData = historyRef.current[historyIndex];
        const useLeftEye = shape.id.charCodeAt(0) % 2 === 0;
        const eyeImg = useLeftEye ? frameData.leftEye.image : frameData.rightEye.image;
        if (!eyeImg) return;

        const trailCount = 2; // Number of echo/trail frames
        // Render from back (trail) to front (main)
        for (let k = trailCount; k >= 0; k--) {
            const isMain = k === 0;
            const isTrail = !isMain;

            // Trail Offset Logic:
            // Trails drag behind the movement. If parallax moves shape right (+), trail is left (-).
            // We use glitchIntensity to exaggerate the trail for some shapes.
            const lagIntensity = 0.08 * k * (0.8 + shape.glitchIntensity);
            const trailX = isMain ? 0 : -(parallaxX * lagIntensity);
            const trailY = isMain ? 0 : -(parallaxY * lagIntensity);
            
            ctx.save();
            ctx.translate(x + trailX, y + trailY);
            
            // --- FLICKER & OPACITY LOGIC ---
            let alpha = isMain ? 1.0 : (0.4 / (k + 0.5));
            
            // Random instability/flicker
            // Trails are more unstable than the main shape
            const instability = shape.glitchIntensity;
            const flickerChance = isTrail ? 0.25 : 0.02;
            
            if (Math.random() < flickerChance + (instability * 0.1)) {
                // Randomly dip opacity to simulate loose connection/bad signal
                alpha *= (0.2 + Math.random() * 0.7);
                
                // Occasional drop to near-zero for trails
                if (isTrail && Math.random() > 0.8) alpha *= 0.1;
            }
            
            ctx.globalAlpha = alpha;

            // Micro-jitter (Horizontal tearing)
            if (Math.random() < 0.05 + (instability * 0.05)) {
                 const jitter = (Math.random() - 0.5) * 6 * instability;
                 ctx.translate(jitter, 0);
            }

            // Removed Global Hue Rotation to respect Palette
            // We can add a very subtle static color offset for trails if needed, 
            // but pure opacity looks cleaner for high-contrast styles.

            // --- Render Eye Image ---
            ctx.save();
            ctx.beginPath();
            ctx.rect(-size/2, -size/2, size, size);
            ctx.clip();

            // Draw Eye (Grayscale or High Contrast Filtered)
            ctx.drawImage(eyeImg, -size/2, -size/2, size, size);
            
            // Glitch / Color Tint
            ctx.globalCompositeOperation = 'overlay';
            // Occasional color flash for unstable trail frames
            if (isTrail && Math.random() < 0.05) {
                 ctx.fillStyle = '#FFFFFF';
            } else {
                 ctx.fillStyle = shape.color;
            }
            ctx.fillRect(-size/2, -size/2, size, size);

            // Scanlines on eye
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            for(let ly = -size/2; ly < size/2; ly += 3) {
                ctx.fillRect(-size/2, ly, size, 1);
            }
            ctx.restore(); // End Image Clip

            // --- Render Borders ---
            ctx.strokeStyle = shape.color;
            ctx.lineWidth = isMain ? 2 : 1;
            ctx.strokeRect(-size/2, -size/2, size, size);

            // --- UI Text (Main only) ---
            if (isMain) {
                ctx.fillStyle = shape.color;
                ctx.font = '10px monospace';
                ctx.shadowColor = shape.color;
                ctx.shadowBlur = 4;

                // ID Label (Top Left)
                ctx.fillText(`ID_${shape.id.substring(0,2).toUpperCase()}`, -size/2, -size/2 - 6);
                
                // Time Label (Top Right)
                const timeDelay = (shape.delayFrames * 16.6 / 1000).toFixed(2);
                const tText = `T-${timeDelay}s`;
                const tWidth = ctx.measureText(tText).width;
                ctx.fillText(tText, size/2 - tWidth, -size/2 - 6);

                // Decor corners
                const cornerSize = 10;
                ctx.lineWidth = 3;
                // Top Left
                ctx.beginPath();
                ctx.moveTo(-size/2, -size/2 + cornerSize);
                ctx.lineTo(-size/2, -size/2);
                ctx.lineTo(-size/2 + cornerSize, -size/2);
                ctx.stroke();
                // Bottom Right
                ctx.beginPath();
                ctx.moveTo(size/2, size/2 - cornerSize);
                ctx.lineTo(size/2, size/2);
                ctx.lineTo(size/2 - cornerSize, size/2);
                ctx.stroke();
            }

            ctx.restore(); // End Parent Translate
        }
    });

    // --- 5. Reset Scramble Feedback (Blink Action) ---
    if (resetFlashRef.current > 0.001) {
        ctx.save();
        const intensity = resetFlashRef.current;
        
        // Flash overlay (additive)
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(255, 255, 255, ${intensity * 0.3})`;
        ctx.fillRect(0, 0, width, height);

        // Noise strips
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(255, 255, 255, ${intensity * 0.6})`;
        const numStrips = 8;
        for (let i = 0; i < numStrips; i++) {
             // Random noise positions
             const stripH = Math.random() * 60 * intensity;
             const stripY = Math.random() * height;
             if (Math.random() > 0.5) {
                 ctx.fillRect(0, stripY, width, stripH);
             }
        }
        
        // Confirmation Text
        if (intensity > 0.2) {
            ctx.font = 'bold 24px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowBlur = 10 * intensity;
            ctx.shadowColor = 'rgba(255, 255, 255, 1)';
            
            // Randomly shift text color for glitch feel
            ctx.fillStyle = Math.random() > 0.5 ? params.primaryColor : '#FFFFFF';
            ctx.fillText('[ SYSTEM_SCRAMBLE ]', width/2, height/2);
        }

        ctx.restore();
        // Decay the effect
        resetFlashRef.current *= 0.85;
    } else {
        resetFlashRef.current = 0;
    }

    // --- 6. Global CRT Overlay ---
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    
    // A. Static Horizontal Scanlines
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'; 
    for (let y = 0; y < height; y += 4) {
        ctx.fillRect(0, y, width, 1);
    }

    // B. Rolling "Refresh" Bar
    const time = performance.now() * 0.0003; // speed
    const barHeight = height * 0.25;
    const yPos = (time * height * 0.8) % (height + barHeight) - barHeight;
    
    const gradient = ctx.createLinearGradient(0, yPos, 0, yPos + barHeight);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.03)'); // Very subtle white
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, yPos, width, barHeight);

    // C. Vignette
    const rad = Math.min(width, height);
    const vignette = ctx.createRadialGradient(width/2, height/2, rad * 0.4, width/2, height/2, rad * 0.9);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.5)'); 
    
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    ctx.restore();
  };

  useEffect(() => {
    const handleResize = () => {
        if (containerRef.current && canvasRef.current) {
            canvasRef.current.width = containerRef.current.clientWidth;
            canvasRef.current.height = containerRef.current.clientHeight;
        }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-screen bg-black overflow-hidden cursor-none">
      <video
        ref={videoRef}
        className="absolute top-0 left-0 opacity-0 pointer-events-none"
        style={{ width: '1280px', height: '720px' }} 
        playsInline
        muted
      />
      <canvas ref={canvasRef} className="block w-full h-full" />
      
      {/* UI Overlay */}
      <div className="absolute top-6 left-6 z-10 pointer-events-none mix-blend-difference text-white font-mono">
        <h1 className="text-4xl font-bold tracking-tighter mb-2" style={{textShadow: '0 0 10px white'}}>CORRUPTED_VISION // V 4.2</h1>
        <div className="text-xs space-y-1 opacity-90 font-bold">
          <p>[SIGNAL_INTEGRITY]: {isLoaded ? 'CRITICAL' : 'OFFLINE'}</p>
          <p>[DATA_FRAGMENTS]: {sceneParamsRef.current.shapes.length} NODES</p>
          <p>[DISPLACEMENT]: SYNCHRONIZED</p>
        </div>
      </div>

      <div className="absolute bottom-6 left-6 z-10 text-xs font-mono text-gray-500">
          INTERACTION: MOVE_HEAD_TO_NAVIGATE_VOID
      </div>
      <div className="absolute bottom-6 right-6 z-10 text-xs font-mono text-gray-500">
          BLINK_TO_SCRAMBLE_FREQUENCY
      </div>

      {!isLoaded && !permissionError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-40">
           <div className="font-mono text-white animate-pulse text-xl">
             INITIALIZING_SYSTEM...
           </div>
        </div>
      )}
      {permissionError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-50 text-red-500 font-mono">
            ACCESS_DENIED // ENABLE_CAMERA
        </div>
      )}
    </div>
  );
};