import React, { useEffect, useRef } from 'react';

export interface M3ShapeLoaderProps {
  /**
   * Größe des morphing Elements in Pixeln:
   * - 'xs': 16px (Buttons, kleine Status-Badges)
   * - 'sm': 20px (Input-Felder, Header-Badges)
   * - 'md': 36px (Karten-Platzhalter, Dialoge)
   * - 'lg': 48px (Standard Lade-Container, Scanner)
   * - 'xl': 64px (Initial Loading Screen)
   * - oder direkte Pixel-Zahl (z. B. 48)
   */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
  /**
   * Ob der Loader in einem M3 Contained Kreis-Hintergrund
   * (var(--md-sys-color-surface-container-highest) / #E3E8E4) gezeichnet werden soll.
   */
  contained?: boolean;
  /**
   * Optionale Beschriftung / Text unter dem Loader
   */
  label?: string;
  /**
   * Primäre Füllfarbe des morphing Shapes (Standard: Waldgrün var(--md-sys-color-primary, #02432E))
   */
  color?: string;
  /**
   * Zusätzliche CSS-Klassen
   */
  className?: string;
}

interface Point {
  x: number;
  y: number;
}

const NUM_POINTS = 180;
const MORPH_DURATION_PER_SHAPE = 650; // ms per shape transition

/**
 * 7 M3 Expressive Canonical Key Shapes Vector Generator (180 sampled points per shape):
 * 1. Soft Burst / Stern (8 abgerundete Spitzen)
 * 2. Cookie / Keks 9 (9-blättrige Blüten-Welle / Scallop 9)
 * 3. Rounded Pentagon (abgerundetes 5-Eck)
 * 4. M3 Pill / Capsule (Superellipse / Kapsel)
 * 5. Sunny / Sonne 12 (12-strahlige M3 Sonnen-Form)
 * 6. Cookie 4 (4-blättriges Kleeblatt / Scallop 4)
 * 7. Oval / Soft Ellipse (sanfte M3 Ellipse)
 */
const generateM3Shapes = (): Point[][] => {
  const shapes: Point[][] = [];

  // 1. Soft Burst / Stern (8 rounded points)
  const burst: Point[] = [];
  for (let i = 0; i < NUM_POINTS; i++) {
    const theta = (i / NUM_POINTS) * Math.PI * 2;
    const r = 0.72 + 0.28 * Math.cos(8 * theta);
    burst.push({ x: r * Math.cos(theta), y: r * Math.sin(theta) });
  }
  shapes.push(burst);

  // 2. Cookie / Keks 9 (9 lobes)
  const cookie9: Point[] = [];
  for (let i = 0; i < NUM_POINTS; i++) {
    const theta = (i / NUM_POINTS) * Math.PI * 2;
    const r = 0.80 + 0.20 * Math.cos(9 * theta);
    cookie9.push({ x: r * Math.cos(theta), y: r * Math.sin(theta) });
  }
  shapes.push(cookie9);

  // 3. Rounded Pentagon (5 rounded corners)
  const pentagon: Point[] = [];
  for (let i = 0; i < NUM_POINTS; i++) {
    const theta = (i / NUM_POINTS) * Math.PI * 2;
    const r = 0.84 + 0.16 * Math.cos(5 * theta) + 0.03 * Math.cos(10 * theta);
    pentagon.push({ x: r * Math.cos(theta), y: r * Math.sin(theta) });
  }
  shapes.push(pentagon);

  // 4. M3 Pill / Capsule (Superellipse)
  const pill: Point[] = [];
  for (let i = 0; i < NUM_POINTS; i++) {
    const theta = (i / NUM_POINTS) * Math.PI * 2;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const signX = Math.sign(cosT) || 1;
    const signY = Math.sign(sinT) || 1;
    const x = 0.96 * signX * Math.pow(Math.abs(cosT), 0.7);
    const y = 0.58 * signY * Math.pow(Math.abs(sinT), 0.7);
    pill.push({ x, y });
  }
  shapes.push(pill);

  // 5. Sunny / Sonne 12 (12 lobes)
  const sunny12: Point[] = [];
  for (let i = 0; i < NUM_POINTS; i++) {
    const theta = (i / NUM_POINTS) * Math.PI * 2;
    const r = 0.85 + 0.15 * Math.cos(12 * theta);
    sunny12.push({ x: r * Math.cos(theta), y: r * Math.sin(theta) });
  }
  shapes.push(sunny12);

  // 6. Cookie 4 (4 lobes / clover)
  const cookie4: Point[] = [];
  for (let i = 0; i < NUM_POINTS; i++) {
    const theta = (i / NUM_POINTS) * Math.PI * 2;
    const r = 0.76 + 0.24 * Math.cos(4 * theta);
    cookie4.push({ x: r * Math.cos(theta), y: r * Math.sin(theta) });
  }
  shapes.push(cookie4);

  // 7. Oval / Soft Ellipse
  const oval: Point[] = [];
  for (let i = 0; i < NUM_POINTS; i++) {
    const theta = (i / NUM_POINTS) * Math.PI * 2;
    const x = 0.94 * Math.cos(theta);
    const y = 0.68 * Math.sin(theta);
    oval.push({ x, y });
  }
  shapes.push(oval);

  return shapes;
};

const M3_SHAPES = generateM3Shapes();

// Material 3 cubic-bezier ease transition
const easeInOutCubic = (t: number): number => {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

/**
 * Material 3 Expressive Contained Loading Indicator (Sub-Step 8.4.1)
 * Canvas 2D Vector-Pfad-Interpolation mit 7 M3 Schlüsselformen.
 */
export const M3ShapeLoader: React.FC<M3ShapeLoaderProps> = ({
  size = 'md',
  contained = false,
  label,
  color,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Pixelgröße ermitteln
  const pixelSize =
    typeof size === 'number'
      ? size
      : size === 'xs'
      ? 16
      : size === 'sm'
      ? 20
      : size === 'md'
      ? 36
      : size === 'lg'
      ? 48
      : 64;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let animId: number;
    let startTime: number | null = null;

    const totalShapes = M3_SHAPES.length;
    const totalCycle = totalShapes * MORPH_DURATION_PER_SHAPE;

    // Resolve color helpers
    const resolveCssVar = (cssVarOrColor: string | undefined, fallback: string): string => {
      if (!cssVarOrColor) return fallback;
      if (cssVarOrColor.startsWith('var(')) {
        const varName = cssVarOrColor.replace(/var\((--[\w-]+).*\)/, '$1').trim();
        const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        return resolved || fallback;
      }
      return cssVarOrColor;
    };

    const render = (now: number) => {
      if (!startTime) startTime = now;
      const elapsed = now - startTime;

      const dpr = window.devicePixelRatio || 2;
      const canvasWidth = pixelSize * dpr;
      const canvasHeight = pixelSize * dpr;

      if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
      }

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      const cx = canvasWidth / 2;
      const cy = canvasHeight / 2;

      // 1. Draw Contained Background if contained is active
      if (contained) {
        const bgRadius = canvasWidth / 2;
        const bgFillColor =
          resolveCssVar('var(--md-sys-color-surface-container-highest)', '#E3E8E4');

        ctx.beginPath();
        ctx.arc(cx, cy, bgRadius - 0.5, 0, Math.PI * 2);
        ctx.fillStyle = bgFillColor;
        ctx.fill();
      }

      // 2. Calculate current shape interpolation indices & progress
      const progressInCycle = (elapsed % totalCycle) / MORPH_DURATION_PER_SHAPE;
      const shapeIndexA = Math.floor(progressInCycle) % totalShapes;
      const shapeIndexB = (shapeIndexA + 1) % totalShapes;
      const subProgress = progressInCycle - Math.floor(progressInCycle);
      const ease = easeInOutCubic(subProgress);

      const shapeA = M3_SHAPES[shapeIndexA];
      const shapeB = M3_SHAPES[shapeIndexB];

      // 3. Apply continuous rotation and draw interpolated vector path
      ctx.save();
      ctx.translate(cx, cy);

      // Continuous subtle rotation (one full rotation every 4800ms)
      const rotationAngle = (elapsed / 4800) * Math.PI * 2;
      ctx.rotate(rotationAngle);

      // Scale vector coordinates to canvas dimensions
      const shapeScale = contained ? pixelSize * 0.28 * dpr : pixelSize * 0.44 * dpr;

      ctx.beginPath();
      const firstX = (shapeA[0].x * (1 - ease) + shapeB[0].x * ease) * shapeScale;
      const firstY = (shapeA[0].y * (1 - ease) + shapeB[0].y * ease) * shapeScale;
      ctx.moveTo(firstX, firstY);

      for (let i = 1; i < NUM_POINTS; i++) {
        const xi = (shapeA[i].x * (1 - ease) + shapeB[i].x * ease) * shapeScale;
        const yi = (shapeA[i].y * (1 - ease) + shapeB[i].y * ease) * shapeScale;
        ctx.lineTo(xi, yi);
      }

      ctx.closePath();

      // Resolve primary fill color
      const primaryColor =
        color || resolveCssVar('var(--md-sys-color-primary)', '#02432E');
      ctx.fillStyle = resolveCssVar(primaryColor, '#02432E');
      ctx.fill();

      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [pixelSize, contained, color]);

  const canvasElement = (
    <canvas
      ref={canvasRef}
      role="status"
      aria-label={label || 'Ladevorgang aktiv'}
      className={`shrink-0 block ${className}`}
      style={{
        width: `${pixelSize}px`,
        height: `${pixelSize}px`,
      }}
    />
  );

  if (!label) {
    return canvasElement;
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      {canvasElement}
      <span className="text-xs md:text-sm font-medium text-[var(--md-sys-color-on-surface-variant)] text-center tracking-wide">
        {label}
      </span>
    </div>
  );
};

export default M3ShapeLoader;
