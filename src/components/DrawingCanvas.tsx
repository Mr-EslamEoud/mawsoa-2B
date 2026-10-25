import React, { useRef, useState, useEffect } from 'react';

interface DrawingCanvasProps {
  isEnabled: boolean;
}

interface Point {
  x: number;
  y: number;
}

export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ isEnabled }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const pointsRef = useRef<Point[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#16a34a';
      ctx.lineWidth = 4;
      ctxRef.current = ctx;
    }
    
    const handleResize = () => {
      if (canvas && ctxRef.current) {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        ctxRef.current.lineCap = 'round';
        ctxRef.current.strokeStyle = '#16a34a';
        ctxRef.current.lineWidth = 4;
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getEventCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    let clientX = 0;
    let clientY = 0;
    
    if ('touches' in e) {
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ('changedTouches' in e && e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      }
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isEnabled || !canvasRef.current || !ctxRef.current) return;
    const { x, y } = getEventCoordinates(e);
    ctxRef.current.beginPath();
    ctxRef.current.moveTo(x, y);
    setIsDrawing(true);
    pointsRef.current = [{ x, y }];
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !isEnabled || !canvasRef.current || !ctxRef.current) return;
    
    // Prevent scrolling when drawing on touchscreen
    if ('touches' in e) {
      e.preventDefault();
    }
    
    const { x, y } = getEventCoordinates(e);
    ctxRef.current.lineTo(x, y);
    ctxRef.current.stroke();
    pointsRef.current.push({ x, y });
  };

  const stopDrawing = () => {
    if (!isDrawing || !ctxRef.current) return;
    ctxRef.current.closePath();
    setIsDrawing(false);
    checkIfCheckmark(pointsRef.current);
  };

  const checkIfCheckmark = (points: Point[]) => {
    if (points.length < 15 || !canvasRef.current || !ctxRef.current) return;
    let maxY = 0;
    let lowestIndex = 0;
    points.forEach((p, i) => {
      if (p.y > maxY) {
        maxY = p.y;
        lowestIndex = i;
      }
    });
    if (lowestIndex > points.length * 0.1 && lowestIndex < points.length * 0.9) {
      let drops = 0;
      for (let i = 1; i < points.length; i++) {
        if (points[i].x < points[i - 1].x - 10) drops++;
      }
      if (drops < 3) {
        ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        pointsRef.current = [];
      }
    }
  };

  return (
    <canvas
      ref={canvasRef}
      id="drawing-canvas"
      className={isEnabled ? 'active' : ''}
      onMouseDown={startDrawing}
      onMouseMove={draw}
      onMouseUp={stopDrawing}
      onMouseLeave={stopDrawing}
      onTouchStart={startDrawing}
      onTouchMove={draw}
      onTouchEnd={stopDrawing}
    />
  );
};
