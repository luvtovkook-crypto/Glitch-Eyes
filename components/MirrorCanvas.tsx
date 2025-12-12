import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as faceMesh from '@mediapipe/face_mesh';
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
  const [errorMsg, setErrorMsg] = useState('');
  const [fps, setFps] = useState(0);

  const sceneParamsRef = useRef<SceneParams>(generateNewScene());
  const headPosRef = useRef<Point>({ x: 0.5, y: 0.5 });
  const targetHeadPosRef = useRef<Point>({ x: 0.5, y: 0.5 });
  const blinkCooldownRef = useRef(0);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(0);
  const resetFlashRef = useRef(0);
  
  // Refs for loop control
  const faceMeshRef = useRef<any>(null);
  const animationFrameId = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    
    const initSystem = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fmAny = faceMesh as any;
        const FaceMeshClass = fmAny.FaceMesh || fmAny.default?.FaceMesh || fmAny.default;

        if (!FaceMeshClass) {
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
        faceMeshRef.current = faceMeshClient;

        // Try to start camera immediately
        if (isMountedRef.current) {
            startCamera();
        }

      } catch (err: any) {
        console.error("System Init Error:", err);
        if (isMountedRef.current) {
            setPermissionError(true);
            setErrorMsg(err.message || 'Initialization Failed');
        }
      }
    };

    initSystem();

    return () => {
      isMountedRef.current = false;
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      if (videoRef.current && videoRef.current.srcObject) {
         const stream = videoRef.current.srcObject as MediaStream;
         stream.getTracks().forEach(track => track.stop());
      }
      if (faceMeshRef.current) {
          faceMeshRef.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = async () => {
      if (!isMountedRef.current) return;
      
      setPermissionError(false);
      setErrorMsg('');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setPermissionError(true);
          setErrorMsg("Browser API Unavailable");
          return;
      }

      try {
          // Simplified constraints for maximum compatibility
          // Removed specific resolution requirements that might cause issues
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user' },
            audio: false 
          });

          if (!isMountedRef.current) {
              stream.getTracks().forEach(t => t.stop());
              return;
          }

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            // Use onloadeddata to ensure we have frame data available
            videoRef.current.onloadeddata = () => {
                if (!isMountedRef.current) return;
                videoRef.current?.play().catch(e => console.warn("Video play interrupted", e));
                setIsLoaded(true);
                processVideo();
            };
          }
      } catch (err: any) {
          console.error("Camera Permission Error:", err);
          if (isMountedRef.current) {
              setPermissionError(true);
              setErrorMsg(err.name === 'NotAllowedError' ? 'Permission Denied' : err.message);
          }
      }
  };

  const processVideo = async () => {
      if (!isMountedRef.current) return;
      if (!videoRef.current || !faceMeshRef.current) return;
      
      // Only process if enough data is available and video is playing
      if (videoRef.current.readyState >= 2 && !videoRef.current.paused && !videoRef.current.ended) {
          try {
            await faceMeshRef.current.send({ image: videoRef.current });
          } catch (e) {
            // Drop frame silently on error
          }
      }
      
      // Continue loop
      animationFrameId.current = requestAnimationFrame(processVideo);
  };

  const resetScene = useCallback(() => {
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
    if (!isMountedRef.current) return;
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
          // Bitmap extraction failed
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

    const blurRadius = 15;

    // --- 1. Background Layer ---
    ctx.save();
    ctx.filter = `blur(${blurRadius}px) grayscale(100%) contrast(150%) brightness(60%)`;
    ctx.drawImage(videoElement, -50, -50, width + 100, height + 100);
    
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, width, height);
    
    ctx.strokeStyle = params.secondaryColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.15;
    const gridSize = 100;
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

    // --- 2. Calculate Shape Positions ---
    const renderedShapes: RenderedShape[] = [];

    params.shapes.forEach((shape) => {
        const historyIndex = Math.min(shape.delayFrames, historyRef.current.length - 1);
        if (historyIndex < 0) return;
        const frameData = historyRef.current[historyIndex];
        if (!frameData) return;

        const depth = shape.scale * 0.5; 
        const gazeDriftX = (head.x - 0.5) * width * 0.4 * shape.glitchIntensity;
        const gazeDriftY = (head.y - 0.5) * height * 0.4 * shape.glitchIntensity;

        const centerX = shape.x * width + (parallaxX * depth) + gazeDriftX;
        const centerY = shape.y * height + (parallaxY * depth) + gazeDriftY;
        const size = 120 * shape.scale;

        renderedShapes.push({ x: centerX, y: centerY, size, shape });
    });

    // --- 3. Draw Connections ---
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    
    for (let i = 0; i < renderedShapes.length; i++) {
        for (let j = i + 1; j < renderedShapes.length; j++) {
            const s1 = renderedShapes[i];
            const s2 = renderedShapes[j];
            const d = distance({x: s1.x, y: s1.y}, {x: s2.x, y: s2.y});
            
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


    // --- 4. Draw Shapes & UI Overlays ---
    renderedShapes.forEach((item) => {
        const { x, y, size, shape } = item;
        
        const historyIndex = Math.min(shape.delayFrames, historyRef.current.length - 1);
        const frameData = historyRef.current[historyIndex];
        const useLeftEye = shape.id.charCodeAt(0) % 2 === 0;
        const eyeImg = useLeftEye ? frameData.leftEye.image : frameData.rightEye.image;
        if (!eyeImg) return;

        const trailCount = 2; 
        for (let k = trailCount; k >= 0; k--) {
            const isMain = k === 0;
            const isTrail = !isMain;

            const lagIntensity = 0.08 * k * (0.8 + shape.glitchIntensity);
            const trailX = isMain ? 0 : -(parallaxX * lagIntensity);
            const trailY = isMain ? 0 : -(parallaxY * lagIntensity);
            
            ctx.save();
            ctx.translate(x + trailX, y + trailY);
            
            let alpha = isMain ? 1.0 : (0.4 / (k + 0.5));
            const instability = shape.glitchIntensity;
            const flickerChance = isTrail ? 0.25 : 0.02;
            
            if (Math.random() < flickerChance + (instability * 0.1)) {
                alpha *= (0.2 + Math.random() * 0.7);
                if (isTrail && Math.random() > 0.8) alpha *= 0.1;
            }
            
            ctx.globalAlpha = alpha;

            if (Math.random() < 0.05 + (instability * 0.05)) {
                 const jitter = (Math.random() - 0.5) * 6 * instability;
                 ctx.translate(jitter, 0);
            }

            ctx.save();
            ctx.beginPath();
            ctx.rect(-size/2, -size/2, size, size);
            ctx.clip();

            ctx.drawImage(eyeImg, -size/2, -size/2, size, size);
            
            ctx.globalCompositeOperation = 'overlay';
            if (isTrail && Math.random() < 0.05) {
                 ctx.fillStyle = '#FFFFFF';
            } else {
                 ctx.fillStyle = shape.color;
            }
            ctx.fillRect(-size/2, -size/2, size, size);

            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            for(let ly = -size/2; ly < size/2; ly += 3) {
                ctx.fillRect(-size/2, ly, size, 1);
            }
            ctx.restore(); 

            ctx.strokeStyle = shape.color;
            ctx.lineWidth = isMain ? 2 : 1;
            ctx.strokeRect(-size/2, -size/2, size, size);

            if (isMain) {
                ctx.fillStyle = shape.color;
                ctx.font = '10px monospace';
                ctx.shadowColor = shape.color;
                ctx.shadowBlur = 4;
                ctx.fillText(`ID_${shape.id.substring(0,2).toUpperCase()}`, -size/2, -size/2 - 6);
                
                const timeDelay = (shape.delayFrames * 16.6 / 1000).toFixed(2);
                const tText = `T-${timeDelay}s`;
                const tWidth = ctx.measureText(tText).width;
                ctx.fillText(tText, size/2 - tWidth, -size/2 - 6);

                const cornerSize = 10;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(-size/2, -size/2 + cornerSize);
                ctx.lineTo(-size/2, -size/2);
                ctx.lineTo(-size/2 + cornerSize, -size/2);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(size/2, size/2 - cornerSize);
                ctx.lineTo(size/2, size/2);
                ctx.lineTo(size/2 - cornerSize, size/2);
                ctx.stroke();
            }

            ctx.restore(); 
        }
    });

    // --- 5. Reset Scramble Feedback ---
    if (resetFlashRef.current > 0.001) {
        ctx.save();
        const intensity = resetFlashRef.current;
        
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(255, 255, 255, ${intensity * 0.3})`;
        ctx.fillRect(0, 0, width, height);

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(255, 255, 255, ${intensity * 0.6})`;
        const numStrips = 8;
        for (let i = 0; i < numStrips; i++) {
             const stripH = Math.random() * 60 * intensity;
             const stripY = Math.random() * height;
             if (Math.random() > 0.5) {
                 ctx.fillRect(0, stripY, width, stripH);
             }
        }
        
        if (intensity > 0.2) {
            ctx.font = 'bold 24px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowBlur = 10 * intensity;
            ctx.shadowColor = 'rgba(255, 255, 255, 1)';
            ctx.fillStyle = Math.random() > 0.5 ? params.primaryColor : '#FFFFFF';
            ctx.fillText('[ SYSTEM_SCRAMBLE ]', width/2, height/2);
        }

        ctx.restore();
        resetFlashRef.current *= 0.85;
    } else {
        resetFlashRef.current = 0;
    }

    // --- 6. Global CRT Overlay ---
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'; 
    for (let y = 0; y < height; y += 4) {
        ctx.fillRect(0, y, width, 1);
    }

    const time = performance.now() * 0.0003; 
    const barHeight = height * 0.25;
    const yPos = (time * height * 0.8) % (height + barHeight) - barHeight;
    
    const gradient = ctx.createLinearGradient(0, yPos, 0, yPos + barHeight);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.03)'); 
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, yPos, width, barHeight);

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
        autoPlay
        playsInline
        muted
        className="absolute top-0 left-0 opacity-0 pointer-events-none"
        style={{ width: '1280px', height: '720px' }} 
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
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-50 text-red-500 font-mono p-4 text-center">
            <div className="mb-4 text-xl">ACCESS_DENIED // {errorMsg || 'CAMERA_ERROR'}</div>
            <div className="mb-6 text-sm text-gray-400 max-w-md border border-gray-800 p-4 bg-gray-900">
                <p className="mb-2">1. Check browser address bar for blocked camera icon.</p>
                <p className="mb-2">2. Allow camera access.</p>
                <p>3. Click Retry below.</p>
            </div>
            <button 
                onClick={() => startCamera()}
                className="px-6 py-2 border border-red-500 hover:bg-red-500 hover:text-black transition-colors"
            >
                [ RETRY_CONNECTION ]
            </button>
        </div>
      )}
    </div>
  );
};