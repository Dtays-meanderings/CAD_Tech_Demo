import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Stage, Layer, Line, Circle, Rect, Group, Text, Path, Arc, Ellipse, Shape } from 'react-konva';
import Konva from 'konva';
import { evaluateMath } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';
import { KonvaEventObject } from 'konva/lib/Node';
import { CADModel, CADObject, Layer as TypeLayer, Point, ToolType, ShapeType, Dimension, PythonState, SnapConfig, Constraint } from '../types';
import { performFillet, performBSpline } from '../lib/occt';
import { calculateSnap, SnapResult } from '../lib/snapping';
import { SnapMarker } from './SnapMarker';
import { performTrim, findIntersections } from '../lib/intersection';
import { findClosedLoops, traceConnectedLines } from '../lib/topology';
import { generateClipperOffset } from '../lib/offset';
import { BoxSelect, Check, Maximize2 } from 'lucide-react';
export const Viewport: React.FC = () => {
  const { 
    settings, updateSettings, model, addObject, addObjects, updateObject, updateObjectLive, 
    removeObject, removeObjects, addDimension, updateDimension, selectedVertices, setSelectedVertices, 
    addCoincidentConstraint, selectedObjectIds, setSelectedObjectIds, undo, redo, 
    updateModel, solveConstraints, selectedConstraintId, toggleDimensionReference,
    applyMirror
  } = useSettings();

  const selectedConstraint = model.objects
    .flatMap(obj => obj.constraints.map(c => ({ ...c, objectId: obj.id })))
    .find(c => c.id === selectedConstraintId);

  const closedLoops = React.useMemo(() => findClosedLoops(model.objects.filter(o => !o.construction)), [model.objects]);

  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });
  const containerRef = React.useRef<HTMLDivElement>(null);
  const referenceDimValuesRef = React.useRef(new Map<string, { value: number, label: string }>());

  React.useEffect(() => {
    let changed = false;
    const updates: { id: string, value: number, label: string }[] = [];
    model.dimensions.forEach(dim => {
      if (dim.isReference && referenceDimValuesRef.current.has(dim.id)) {
        const val = referenceDimValuesRef.current.get(dim.id)!;
        if (Math.abs((dim.value ?? 0) - val.value) > 1e-4) {
          changed = true;
          updates.push({ id: dim.id, value: val.value, label: val.label });
        }
      }
    });

    if (changed) {
      updateModel(prev => {
        const newDims = prev.dimensions.map(d => {
          const update = updates.find(u => u.id === d.id);
          return update ? { ...d, value: update.value, label: update.label } : d;
        });
        return { ...prev, dimensions: newDims };
      });
    }
  });
  
  const [currentShape, setCurrentShape] = React.useState<CADObject | null>(null);
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [isAltPressed, setIsAltPressed] = useState(false);
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);
  const [hoveredVertex, setHoveredVertex] = useState<{ objectId: string, pointIndex: number } | null>(null);
  const [mousePos, setMousePos] = useState<Point | null>(null);
  
  const mirroredPreview = useMemo(() => {
    const { mirrorSession } = settings;
    if (!mirrorSession || mirrorSession.selectedIds.length === 0) return [];
    if (!settings.isAltPressed && !mirrorSession.isSelectingLine) return [];

    let mirrorLineId = mirrorSession.mirrorLineId;
    if (hoveredObjectId) {
      const obj = model.objects.find(o => o.id === hoveredObjectId);
      if (obj?.type === 'line') mirrorLineId = hoveredObjectId;
      if (hoveredObjectId === 'axis-x' || hoveredObjectId === 'axis-y') mirrorLineId = hoveredObjectId;
    }

    if (!mirrorLineId) return [];
    
    let mirrorLine = model.objects.find(o => o.id === mirrorLineId);
    if (!mirrorLine && mirrorLineId === 'axis-x') {
       mirrorLine = { type: 'line', points: [{x: 0, y: 0}, {x: 1, y: 0}] } as any;
    } else if (!mirrorLine && mirrorLineId === 'axis-y') {
       mirrorLine = { type: 'line', points: [{x: 0, y: 0}, {x: 0, y: 1}] } as any;
    }

    if (!mirrorLine || mirrorLine.type !== 'line' || mirrorLine.points.length < 2) return [];

    const mP1 = mirrorLine.points[0];
    const mP2 = mirrorLine.points[1];
    const dx = mP2.x - mP1.x;
    const dy = mP2.y - mP1.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.0001) return [];

    const reflect = (p: Point) => {
      const u = ((p.x - mP1.x) * dx + (p.y - mP1.y) * dy) / lenSq;
      const projX = mP1.x + u * dx;
      const projY = mP1.y + u * dy;
      return { x: 2 * projX - p.x, y: 2 * projY - p.y };
    };

    return model.objects
      .filter(o => mirrorSession.selectedIds.includes(o.id))
      .map(obj => ({
        ...obj,
        id: `preview-${obj.id}`,
        points: obj.points.map(p => ({ ...p, ...reflect(p) }))
      }));
  }, [settings, model.objects, hoveredObjectId]);
  
  // Pan and Zoom state
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

  const resolveModelObject = useCallback((id: string) => {
     if (id === 'origin-x') return { id: 'origin-x', type: 'line', points: [{ id: 'ox1', x: -1000000, y: 0 }, { id: 'ox2', x: 1000000, y: 0 }], visible: true, construction: true } as CADObject;
     if (id === 'origin-y') return { id: 'origin-y', type: 'line', points: [{ id: 'oy1', x: 0, y: -1000000 }, { id: 'oy2', x: 0, y: 1000000 }], visible: true, construction: true } as CADObject;
     return model.objects.find(o => o.id === id);
  }, [model.objects]);

  const handleFitAll = useCallback(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    if (model.objects.length === 0) {
      setStageScale(1);
      setStagePos({ x: dimensions.width / 2, y: dimensions.height / 2 });
      return;
    }

    model.objects.forEach(obj => {
      obj.points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
    });

    if (minX === Infinity || maxX === -Infinity) {
       setStageScale(1);
       setStagePos({ x: dimensions.width / 2, y: dimensions.height / 2 });
       return;
    }

    const padding = 80;
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    
    const scaleX = (dimensions.width - padding * 2) / w;
    const scaleY = (dimensions.height - padding * 2) / h;
    const newScale = Math.max(0.01, Math.min(scaleX, scaleY, 5)); 
    
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    setStageScale(newScale);
    setStagePos({
      x: dimensions.width / 2 - cx * newScale,
      y: dimensions.height / 2 + cy * newScale // Math maps Y upward: stagePos.y + cy * (-stageScale) = center! Thus +cy.
    });
  }, [model.objects, dimensions]);
  
  // Marquee selection
  const [selectionRect, setSelectionRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isTrimmingSweep, setIsTrimmingSweep] = useState(false);
  const [trimSweepPath, setTrimSweepPath] = useState<Point[]>([]);
  const [trimSweepHitCache, setTrimSweepHitCache] = useState<Set<string>>(new Set());
  const [offsetPreview, setOffsetPreview] = useState<CADObject[]>([]);
  const [firstFilletClick, setFirstFilletClick] = useState<Point | null>(null);
  const startSnapRef = useRef<SnapResult | null>(null);

  React.useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const w = containerRef.current.offsetWidth;
        const h = containerRef.current.offsetHeight;
        setDimensions({ width: w, height: h });
        setStagePos(prev => {
           if (prev.x === 0 && prev.y === 0 && w > 0 && h > 0) {
             return { x: w / 2, y: h / 2 };
           }
           return prev;
        });
      }
    };

    window.addEventListener('resize', updateSize);
    // Use a small timeout to let flexbox settle layout bounds properly
    setTimeout(updateSize, 10);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  React.useEffect(() => {
    // When changing tools or aborting, reliably clear ALL drawing caches and ghosts.
    if (settings.activeTool === 'select' || (currentShape && currentShape.type !== settings.activeTool)) {
        setIsDrawing(false);
        if (currentShape) {
          removeObject(currentShape.id);
          setCurrentShape(null);
        }
        setOffsetPreview([]);
        setTrimSweepPath([]);
        setTrimSweepHitCache(new Set());
        setFirstFilletClick(null);
        setCurrentSnap(null);
        startSnapRef.current = null;
    }
  }, [settings.activeTool, isDrawing, currentShape, removeObject]);

  React.useEffect(() => {
    model.objects.forEach(obj => {
       if (obj.type === 'spline' && obj.points.length >= 2) {
          const activeMode = obj.metadata?.splineMode || settings.splineMode || 'interpolate';
          const activeTension = obj.metadata?.splineTension ?? settings.splineTension ?? 0.5;
          const hash = obj.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('|') + `|${activeMode}|${activeTension}`;
          if (obj.metadata?.lastSplineHash !== hash) {
             if (!obj.metadata) obj.metadata = {};
             obj.metadata.lastSplineHash = hash;
             obj.metadata.splineMode = activeMode;
             obj.metadata.splineTension = activeTension;
             
             performBSpline(obj.points, activeMode, activeTension).then(res => {
                if (res.success && res.points) {
                   updateObjectLive(obj.id, {
                      metadata: { ...obj.metadata, curvePoints: res.points, lastSplineHash: hash, splineMode: activeMode, splineTension: activeTension }
                   });
                }
             }).catch(console.error);
          }
       }
    });
  }, [model.objects, updateObjectLive, settings.splineMode, settings.splineTension]);

  const findIntersection = (p1: Point, p2: Point, p3: Point, p4: Point): Point | null => {
    const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y, x4 = p4.x, y4 = p4.y;
    
    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (Math.abs(denom) < 0.0001) return null; // Parallel
    
    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    return {
      x: x1 + ua * (x2 - x1),
      y: y1 + ua * (y2 - y1)
    };
  };

  const [currentSnap, setCurrentSnap] = useState<SnapResult | null>(null);

  const getSnapResult = (point: Point, excludeId?: string): SnapResult => {
    let result = calculateSnap(point, model, settings.snapConfig, settings.snapThreshold / stageScale, settings.gridSize, excludeId, settings.showOrigin !== false);

    // 2. Slope Matching (Parallel/Perpendicular Snapping)
    if (isDrawing && currentShape && currentShape.type === 'line' && currentShape.points.length > 0) {
      const start = currentShape.points[0];
      const currentVec = { x: point.x - start.x, y: point.y - start.y };
      const currentLen = Math.sqrt(currentVec.x * currentVec.x + currentVec.y * currentVec.y);
      const worldThreshold = settings.snapThreshold / stageScale;
      
      if (currentLen > 5) {
        model.objects.forEach(obj => {
          if (obj.type === 'line' && obj.id !== currentShape.id) {
            const p1 = obj.points[0];
            const p2 = obj.points[1];
            const targetVec = { x: p2.x - p1.x, y: p2.y - p1.y };
            const targetLen = Math.sqrt(targetVec.x * targetVec.x + targetVec.y * targetVec.y);
            
            if (targetLen > 0) {
              const uTarget = { x: targetVec.x / targetLen, y: targetVec.y / targetLen };
              
              // Parallel snap
              const dot = (currentVec.x * uTarget.x + currentVec.y * uTarget.y);
              const proj = { x: uTarget.x * dot, y: uTarget.y * dot };
              const distPara = Math.sqrt(Math.pow(currentVec.x - proj.x, 2) + Math.pow(currentVec.y - proj.y, 2));
              
              if (distPara < worldThreshold && distPara < result.distance) {
                result = { point: { x: start.x + proj.x, y: start.y + proj.y }, type: 'edge', distance: distPara };
              }
              
              // Perpendicular snap
              const uPerp = { x: -uTarget.y, y: uTarget.x };
              const dotPerp = (currentVec.x * uPerp.x + currentVec.y * uPerp.y);
              const projPerp = { x: uPerp.x * dotPerp, y: uPerp.y * dotPerp };
              const distPerp = Math.sqrt(Math.pow(currentVec.x - projPerp.x, 2) + Math.pow(currentVec.y - projPerp.y, 2));
              
              if (distPerp < worldThreshold && distPerp < result.distance) {
                result = { point: { x: start.x + projPerp.x, y: start.y + projPerp.y }, type: 'edge', distance: distPerp };
              }
            }
          }
        });
      }
    }

    return result;
  };

  const snapPoint = (point: Point, excludeId?: string): Point => {
    return getSnapResult(point, excludeId).point;
  };

  const getStageRelativePosition = (stage: any) => {
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    return {
      x: (pointer.x - stage.x()) / stage.scaleX(),
      y: (pointer.y - stage.y()) / stage.scaleY(),
    };
  };

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const scaleBy = 1.1;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;

    setStageScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    
    // Middle mouse button (button 1) for panning
    if (e.evt.button === 1) {
      stage.container().style.cursor = 'grabbing';
      stage.startDrag();
      return;
    }

    const pos = getStageRelativePosition(stage);
    if (!pos) return;

    if (e.evt.button === 0 && (settings.activeTool === 'dimension' || settings.activeTool === 'radius' || settings.activeTool === 'angle') && (selectedObjectIds.length > 0 || selectedVertices.length === 2)) {
          if (e.target !== stage && e.target.name() !== 'grid') {
              return; // Let object click handlers add it to selection queue
          }
          if (settings.activeTool === 'angle' && selectedObjectIds.length < 2) {
              return; // Wait for second selection
          }
          if (settings.activeTool === 'radius') {
              const obj = model.objects.find(o => o.id === selectedObjectIds[0]);
              if (obj && (obj.type === 'circle' || obj.type === 'arc')) {
                  const center = obj.points[0];
                  const p1 = obj.points[1];
                  const r = Math.hypot(p1.x - center.x, p1.y - center.y);
                  const dimId = Date.now().toString();
                  const isDia = settings.isDiameterMode;
                  const val = isDia ? r * 2 : r;
                  addDimension({
                    id: dimId, type: isDia ? 'diameter' : 'radial', points: [center, p1, pos],
                    value: val, label: isDia ? `Ø${val.toFixed(2)}` : `R${val.toFixed(2)}`, objectId: obj.id,
                    isDiameter: isDia
                  });
                  if (!settings.isReferenceMode) {
                    updateObject(obj.id, {
                      constraints: [...(obj.constraints || []), { id: `${dimId}-rad`, type: 'radius', value: r }]
                    });
                  }
                  setSelectedObjectIds([]);
              }
              return;
          }
          if (selectedVertices.length === 2) {
             const v1 = selectedVertices[0]; const v2 = selectedVertices[1];
             const o1 = model.objects.find(o => o.id === v1.objectId);
             const o2 = model.objects.find(o => o.id === v2.objectId);
             if (o1 && o2) { 
               const p1 = o1.points[v1.pointIndex]; 
               const p2 = o2.points[v2.pointIndex];
               
               const dx = Math.abs(p2.x - p1.x);
               const dy = Math.abs(p2.y - p1.y);
               const midX = (p1.x + p2.x)/2;
               const midY = (p1.y + p2.y)/2;
               
               const mouseDx = Math.abs(pos.x - midX);
               const mouseDy = Math.abs(pos.y - midY);
               
               let dimType: 'horizontal' | 'vertical' | 'linear' = 'linear';
               let constrType: 'horizontal_distance' | 'vertical_distance' | 'distance' = 'distance';
               let val = Math.hypot(dx, dy);
               
               // Dynamic Bounding
               if (mouseDy > mouseDx * 1.5) {
                   dimType = 'horizontal';
                   constrType = 'horizontal_distance';
                   val = dx;
               } else if (mouseDx > mouseDy * 1.5) {
                   dimType = 'vertical';
                   constrType = 'vertical_distance';
                   val = dy;
               }
               
               const dimId = Date.now().toString();
               addDimension({
                 id: dimId, type: dimType, points: [p1, p2, pos],
                 value: val, label: `${val.toFixed(2)}`, objectId: o1.id, targetObjectId: o2.id
               });
               
               if (!settings.isReferenceMode) {
                 updateObject(o1.id, {
                   constraints: [...(o1.constraints || []), { 
                     id: `${dimId}-dist`, type: constrType, value: val, 
                     pointIndex: v1.pointIndex, targetId: o2.id, targetPointIndex: v2.pointIndex 
                   }]
                 });
               }
               
               setSelectedVertices([]);
               setSelectedObjectIds([]);
             }
          } else if (selectedObjectIds.length > 0) {
             const obj1 = resolveModelObject(selectedObjectIds[0]);
             const obj2 = selectedObjectIds.length > 1 ? resolveModelObject(selectedObjectIds[1]) : null;
             
             if (obj1 && !obj2) {
               if (obj1.type === 'line') {
                  const p1 = obj1.points[0];
                  const p2 = obj1.points[1];
                  const dx = Math.abs(p2.x - p1.x);
                  const dy = Math.abs(p2.y - p1.y);
                  const midX = (p1.x + p2.x)/2;
                  const midY = (p1.y + p2.y)/2;
                  
                  const mouseDx = Math.abs(pos.x - midX);
                  const mouseDy = Math.abs(pos.y - midY);
                  
                  let dimType: 'horizontal' | 'vertical' | 'linear' = 'linear';
                  let constrType: 'horizontal_distance' | 'vertical_distance' | 'distance' = 'distance';
                  let val = Math.hypot(dx, dy);
                  
                  // Dynamic Bounding
                  if (mouseDy > mouseDx * 1.5) {
                      dimType = 'horizontal';
                      constrType = 'horizontal_distance';
                      val = dx;
                  } else if (mouseDx > mouseDy * 1.5) {
                      dimType = 'vertical';
                      constrType = 'vertical_distance';
                      val = dy;
                  }
                  
                  const dimId = Date.now().toString();
                  addDimension({
                    id: dimId, type: dimType, points: [p1, p2, pos],
                    value: val, label: `${val.toFixed(2)}`, objectId: obj1.id
                  });
                  if (!settings.isReferenceMode) {
                    updateObject(obj1.id, {
                      constraints: [...(obj1.constraints || []), { id: `${dimId}-dist`, type: constrType, value: val }]
                    });
                  }
                  setSelectedObjectIds([]);
               } else if (obj1.type === 'circle' || obj1.type === 'arc') {
                  const center = obj1.points[0];
                  const p1 = obj1.points[1];
                  const r = Math.hypot(p1.x - center.x, p1.y - center.y);
                  const dimId = Date.now().toString();
                  addDimension({
                    id: dimId, type: 'radial', points: [center, p1, pos],
                    value: r, label: `R${r.toFixed(2)}`, objectId: obj1.id
                  });
                  if (!settings.isReferenceMode) {
                    updateObject(obj1.id, {
                      constraints: [...(obj1.constraints || []), { id: `${dimId}-rad`, type: 'radius', value: r }]
                    });
                  }
                  setSelectedObjectIds([]);
               }
             } else if (obj1 && obj2) {
               const isLine = (o: CADObject) => o.type === 'line';
               const isPoint = (o: CADObject) => o.type === 'point';
               const isArc = (o: CADObject) => o.type === 'arc' || o.type === 'circle';

               if (isLine(obj1) && isLine(obj2)) {
                  if (obj1.points.length < 2 || obj2.points.length < 2) return;
                  const dx1 = obj1.points[1].x - obj1.points[0].x;
                  const dy1 = obj1.points[1].y - obj1.points[0].y;
                  const dx2 = obj2.points[1].x - obj2.points[0].x;
                  const dy2 = obj2.points[1].y - obj2.points[0].y;
                  const cross = Math.abs(dx1*dy2 - dy1*dx2);
                  
                  if (cross < 1e-4) {
                     const hostObj = (obj1.id === 'origin-x' || obj1.id === 'origin-y') ? obj2 : obj1;
                     const targetObj = hostObj.id === obj1.id ? obj2 : obj1;
                     const p1 = hostObj.points[0];
                     const lineLen = Math.hypot(targetObj.points[1].x - targetObj.points[0].x, targetObj.points[1].y - targetObj.points[0].y) || 1;
                     const dxT = targetObj.points[1].x - targetObj.points[0].x;
                     const dyT = targetObj.points[1].y - targetObj.points[0].y;
                     
                     const ux = dxT / lineLen; const uy = dyT / lineLen;
                     const vx = p1.x - targetObj.points[0].x; const vy = p1.y - targetObj.points[0].y;
                     const dotV = vx * ux + vy * uy;
                     const p2 = { x: targetObj.points[0].x + ux * dotV, y: targetObj.points[0].y + uy * dotV };
                     
                     const dx = Math.abs(p2.x - p1.x);  const dy = Math.abs(p2.y - p1.y);
                     const midX = (p1.x + p2.x)/2;  const midY = (p1.y + p2.y)/2;
                     const mouseDx = Math.abs(pos.x - midX); const mouseDy = Math.abs(pos.y - midY);
                     let dimType: 'horizontal' | 'vertical' | 'linear' = 'linear';
                     let constrType: 'horizontal_distance' | 'vertical_distance' | 'distance' = 'distance';
                     let val = Math.hypot(dx, dy);
                     if (mouseDy > mouseDx * 1.5) { dimType = 'horizontal'; constrType = 'horizontal_distance'; val = dx; }
                     else if (mouseDx > mouseDy * 1.5) { dimType = 'vertical'; constrType = 'vertical_distance'; val = dy; }
                     
                     const dimId = Date.now().toString();
                     addDimension({
                         id: dimId, type: dimType, points: [p1, p2, pos],
                         value: val, label: `${val.toFixed(2)}`, objectId: hostObj.id, targetObjectId: targetObj.id
                     });
                     if (!settings.isReferenceMode) {
                         updateObject(hostObj.id, {
                             constraints: [...(hostObj.constraints || []), { 
                                 id: `${dimId}-dist`, type: constrType, value: val, pointIndex: 0, targetId: targetObj.id, targetPointIndex: undefined 
                             }]
                         });
                     }
                     setSelectedObjectIds([]);
                  } else {
                     const hostObj = (obj1.id === 'origin-x' || obj1.id === 'origin-y') ? obj2 : obj1;
                     const targetObj = hostObj.id === obj1.id ? obj2 : obj1;
                     
                     const l1p1 = hostObj.points[0]; const l1p2 = hostObj.points[1];
                     const l2p1 = targetObj.points[0]; const l2p2 = targetObj.points[1];
                     const denom = (l1p1.x - l1p2.x) * (l2p1.y - l2p2.y) - (l1p1.y - l1p2.y) * (l2p1.x - l2p2.x);
                     let currentAngle = 90; 
                     let rev1 = false, rev2 = false, topSign = 1;

                     if (Math.abs(denom) > 0.001) {
                        const t = ((l1p1.x - l2p1.x) * (l2p1.y - l2p2.y) - (l1p1.y - l2p1.y) * (l2p1.x - l2p2.x)) / denom;
                        const intersect = { x: l1p1.x + t * (l1p2.x - l1p1.x), y: l1p1.y + t * (l1p2.y - l1p1.y) };
                        const vecMouse = { x: pos.x - intersect.x, y: pos.y - intersect.y };
                        const u1 = { x: l1p2.x - l1p1.x, y: l1p2.y - l1p1.y };
                        const u2 = { x: l2p2.x - l2p1.x, y: l2p2.y - l2p1.y };

                        rev1 = (u1.x * vecMouse.x + u1.y * vecMouse.y) < 0;
                        rev2 = (u2.x * vecMouse.x + u2.y * vecMouse.y) < 0;
                        
                        const ray1 = { x: rev1 ? -u1.x : u1.x, y: rev1 ? -u1.y : u1.y };
                        const ray2 = { x: rev2 ? -u2.x : u2.x, y: rev2 ? -u2.y : u2.y };
                        
                        const crossRay = ray1.x * ray2.y - ray1.y * ray2.x;
                        topSign = crossRay > 0 ? 1 : -1;
                        
                        let angle1 = Math.atan2(ray1.y, ray1.x) * 180 / Math.PI;
                        let angle2 = Math.atan2(ray2.y, ray2.x) * 180 / Math.PI;
                        let sweep = angle2 - angle1;
                        while (sweep < 0) sweep += 360;
                        while (sweep >= 360) sweep -= 360;
                        if (sweep > 180) sweep = 360 - sweep;
                        currentAngle = sweep;
                     }

                     const dimId = Date.now().toString();
                     
                     addDimension({
                       id: dimId, type: 'angular', points: [hostObj.points[0], targetObj.points[0], pos],
                       value: currentAngle, label: `${currentAngle.toFixed(1)}°`, objectId: hostObj.id, targetObjectId: targetObj.id
                     });
                     if (!settings.isReferenceMode) {
                       updateObject(hostObj.id, {
                         constraints: [...(hostObj.constraints || []), { id: `${dimId}-ang`, type: 'angle', value: currentAngle, targetId: targetObj.id, rev1: hostObj.id === obj1.id ? rev1 : rev2, rev2: hostObj.id === obj1.id ? rev2 : rev1, topSign } as any]
                       });
                     }
                     setSelectedObjectIds([]);
                     updateSettings({ activeTool: 'select' });
                  }
               } else if ((isLine(obj1) || isLine(obj2)) && (isPoint(obj1) || isPoint(obj2) || isArc(obj1) || isArc(obj2))) {
                  const lineObj = isLine(obj1) ? obj1 : obj2;
                  const pointObj = !isLine(obj1) ? obj1 : obj2;
                  
                  if (!pointObj.points || pointObj.points.length < 1 || !lineObj.points || lineObj.points.length < 2) return;
                  const p1 = pointObj.points[0];
                  const ax = lineObj.points[0].x; const ay = lineObj.points[0].y;
                  const bx = lineObj.points[1].x; const by = lineObj.points[1].y;
                  
                  const dxL = bx - ax; const dyL = by - ay;
                  const lenL = Math.hypot(dxL, dyL) || 1;
                  const ux = dxL / lenL; const uy = dyL / lenL;
                  const vx = p1.x - ax; const vy = p1.y - ay;
                  const dotV = vx * ux + vy * uy;
                  const p2 = { x: ax + ux * dotV, y: ay + uy * dotV };
                  
                  const dx = Math.abs(p2.x - p1.x);  const dy = Math.abs(p2.y - p1.y);
                  const midX = (p1.x + p2.x)/2;  const midY = (p1.y + p2.y)/2;
                  const mouseDx = Math.abs(pos.x - midX); const mouseDy = Math.abs(pos.y - midY);
                  let dimType: 'horizontal' | 'vertical' | 'linear' = 'linear';
                  let constrType: 'horizontal_distance' | 'vertical_distance' | 'distance' = 'distance';
                  let val = Math.hypot(dx, dy);
                  if (mouseDy > mouseDx * 1.5) { dimType = 'horizontal'; constrType = 'horizontal_distance'; val = dx; }
                  else if (mouseDx > mouseDy * 1.5) { dimType = 'vertical'; constrType = 'vertical_distance'; val = dy; }
                  
                  const dimId = Date.now().toString();
                  addDimension({
                      id: dimId, type: dimType, points: [p1, p2, pos],
                      value: val, label: `${val.toFixed(2)}`, objectId: pointObj.id, targetObjectId: lineObj.id
                  });
                  if (!settings.isReferenceMode) {
                      updateObject(pointObj.id, {
                          constraints: [...(pointObj.constraints || []), { 
                              id: `${dimId}-dist`, type: constrType, value: val, pointIndex: 0, targetId: lineObj.id, targetPointIndex: undefined 
                          }]
                      });
                  }
                  setSelectedObjectIds([]);
               } else if (!isLine(obj1) && !isLine(obj2)) {
                  if (!obj1.points || obj1.points.length < 1 || !obj2.points || obj2.points.length < 1) return;
                  const p1 = obj1.points[0];
                  const p2 = obj2.points[0];
                  const dx = Math.abs(p2.x - p1.x);  const dy = Math.abs(p2.y - p1.y);
                  const midX = (p1.x + p2.x)/2;  const midY = (p1.y + p2.y)/2;
                  const mouseDx = Math.abs(pos.x - midX); const mouseDy = Math.abs(pos.y - midY);
                  let dimType: 'horizontal' | 'vertical' | 'linear' = 'linear';
                  let constrType: 'horizontal_distance' | 'vertical_distance' | 'distance' = 'distance';
                  let val = Math.hypot(dx, dy);
                  if (mouseDy > mouseDx * 1.5) { dimType = 'horizontal'; constrType = 'horizontal_distance'; val = dx; }
                  else if (mouseDx > mouseDy * 1.5) { dimType = 'vertical'; constrType = 'vertical_distance'; val = dy; }
                  
                  const dimId = Date.now().toString();
                  addDimension({
                      id: dimId, type: dimType, points: [p1, p2, pos],
                      value: val, label: `${val.toFixed(2)}`, objectId: obj1.id, targetObjectId: obj2.id
                  });
                  if (!settings.isReferenceMode) {
                      updateObject(obj1.id, {
                          constraints: [...(obj1.constraints || []), { 
                              id: `${dimId}-dist`, type: constrType, value: val, pointIndex: 0, targetId: obj2.id, targetPointIndex: 0 
                          }]
                      });
                  }
                  setSelectedObjectIds([]);
               }
             }
          }
          return;
    }

    const modificationTools: ToolType[] = ['fillet', 'trim', 'trim_corner', 'offset', 'mirror', 'array', 'extrude', 'dimension', 'radius'];
    if (settings.activeTool === 'select' || modificationTools.includes(settings.activeTool)) {
      const target = e.target;
      if (target === stage) {
        if ((settings.activeTool === 'dimension' || settings.activeTool === 'radius') && (selectedObjectIds.length > 0 || selectedVertices.length === 2)) {
          if (settings.activeTool === 'radius') {
              const obj = model.objects.find(o => o.id === selectedObjectIds[0]);
              if (obj && (obj.type === 'circle' || obj.type === 'arc')) {
                  const center = obj.points[0];
                  const p1 = obj.points[1];
                  const r = Math.hypot(p1.x - center.x, p1.y - center.y);
                  const dimId = Date.now().toString();
                  const isDia = settings.isDiameterMode;
                  const val = isDia ? r * 2 : r;
                  addDimension({
                    id: dimId, type: isDia ? 'diameter' : 'radial', points: [center, p1, pos],
                    value: val, label: isDia ? `Ø${val.toFixed(2)}` : `R${val.toFixed(2)}`, objectId: obj.id,
                    isDiameter: isDia
                  });
                  if (!settings.isReferenceMode) {
                    updateObject(obj.id, {
                      constraints: [...(obj.constraints || []), { id: `${dimId}-rad`, type: 'radius', value: r }]
                    });
                  }
                  setSelectedObjectIds([]);
              }
              return;
          }
          
          if (selectedVertices.length === 2) {
             const v1 = selectedVertices[0]; const v2 = selectedVertices[1];
             const o1 = model.objects.find(o => o.id === v1.objectId);
             const o2 = model.objects.find(o => o.id === v2.objectId);
             if (o1 && o2) { 
               const p1 = o1.points[v1.pointIndex]; 
               const p2 = o2.points[v2.pointIndex];
               
               const dx = Math.abs(p2.x - p1.x);
               const dy = Math.abs(p2.y - p1.y);
               const midX = (p1.x + p2.x)/2;
               const midY = (p1.y + p2.y)/2;
               
               const mouseDx = Math.abs(pos.x - midX);
               const mouseDy = Math.abs(pos.y - midY);
               
               let dimType: 'horizontal' | 'vertical' | 'linear' = 'linear';
               let constrType: 'horizontal_distance' | 'vertical_distance' | 'distance' = 'distance';
               let val = Math.hypot(dx, dy);
               
               // Dynamic Bounding
               if (mouseDy > mouseDx * 1.5) {
                   dimType = 'horizontal';
                   constrType = 'horizontal_distance';
                   val = dx;
               } else if (mouseDx > mouseDy * 1.5) {
                   dimType = 'vertical';
                   constrType = 'vertical_distance';
                   val = dy;
               }
               
               const dimId = Date.now().toString();
               addDimension({
                 id: dimId, type: dimType, points: [p1, p2, pos],
                 value: val, label: `${val.toFixed(2)}`, objectId: o1.id, targetObjectId: o2.id
               });
               
               if (!settings.isReferenceMode) {
                 updateObject(o1.id, {
                   constraints: [...(o1.constraints || []), { 
                     id: `${dimId}-dist`, type: constrType, value: val, 
                     pointIndex: v1.pointIndex, targetId: o2.id, targetPointIndex: v2.pointIndex 
                   }]
                 });
               }
               
               setSelectedVertices([]);
               setSelectedObjectIds([]);
             }
          } else if (selectedVertices.length === 1 && selectedObjectIds.length === 1) {
             const v1 = selectedVertices[0];
             const o1 = model.objects.find(o => o.id === v1.objectId);
             const o2 = resolveModelObject(selectedObjectIds[0]);
             if (o1 && o2 && o2.type === 'line') {
               const p1 = o1.points[v1.pointIndex];
               const ax = o2.points[0].x; const ay = o2.points[0].y;
               const bx = o2.points[1].x; const by = o2.points[1].y;
               const lenL = Math.hypot(bx-ax, by-ay) || 1;
               const dotV = (p1.x - ax)*((bx-ax)/lenL) + (p1.y - ay)*((by-ay)/lenL);
               const p2 = { x: ax + ((bx-ax)/lenL)*dotV, y: ay + ((by-ay)/lenL)*dotV };
               
               const dx = Math.abs(p2.x - p1.x);
               const dy = Math.abs(p2.y - p1.y);
               const midX = (p1.x + p2.x)/2;
               const midY = (p1.y + p2.y)/2;
               
               const mouseDx = Math.abs(pos.x - midX);
               const mouseDy = Math.abs(pos.y - midY);
               
               let dimType: 'horizontal' | 'vertical' | 'linear' = 'linear';
               let constrType: 'distance' = 'distance';
               let val = Math.hypot(dx, dy);
               
               // Dynamic Bounding (visual only)
               if (mouseDy > mouseDx * 1.5) {
                   dimType = 'horizontal';
               } else if (mouseDx > mouseDy * 1.5) {
                   dimType = 'vertical';
               }
               
               const dimId = Date.now().toString();
               addDimension({
                 id: dimId, type: dimType, points: [p1, p2, pos],
                 value: val, label: `${val.toFixed(2)}`, objectId: o1.id, targetObjectId: o2.id
               });
               
               if (!settings.isReferenceMode) {
                 updateObject(o1.id, {
                   constraints: [...(o1.constraints || []), { 
                     id: `${dimId}-dist`, type: constrType, value: val, 
                     pointIndex: v1.pointIndex, targetId: o2.id
                   } as any]
                 });
               }
               
               setSelectedVertices([]);
               setSelectedObjectIds([]);
             }
          } else if (selectedObjectIds.length > 0) {
             const obj1 = resolveModelObject(selectedObjectIds[0]);
             const obj2 = selectedObjectIds.length > 1 ? resolveModelObject(selectedObjectIds[1]) : null;
             
             if (obj1 && !obj2) {
               if (obj1.type === 'line') {
                  const p1 = obj1.points[0];
                  const p2 = obj1.points[1];
                  const dx = Math.abs(p2.x - p1.x);
                  const dy = Math.abs(p2.y - p1.y);
                  const midX = (p1.x + p2.x)/2;
                  const midY = (p1.y + p2.y)/2;
                  
                  const mouseDx = Math.abs(pos.x - midX);
                  const mouseDy = Math.abs(pos.y - midY);
                  
                  let dimType: 'horizontal' | 'vertical' | 'linear' = 'linear';
                  let constrType: 'horizontal_distance' | 'vertical_distance' | 'distance' = 'distance';
                  let val = Math.hypot(dx, dy);
                  
                  // Dynamic Bounding
                  if (mouseDy > mouseDx * 1.5) {
                      dimType = 'horizontal';
                      constrType = 'horizontal_distance';
                      val = dx;
                  } else if (mouseDx > mouseDy * 1.5) {
                      dimType = 'vertical';
                      constrType = 'vertical_distance';
                      val = dy;
                  }
                  
                  const dimId = Date.now().toString();
                  addDimension({
                    id: dimId, type: dimType, points: [p1, p2, pos],
                    value: val, label: `${val.toFixed(2)}`, objectId: obj1.id
                  });
                  if (!settings.isReferenceMode) {
                    updateObject(obj1.id, {
                      constraints: [...(obj1.constraints || []), { id: `${dimId}-dist`, type: constrType, value: val }]
                    });
                  }
                  setSelectedObjectIds([]);
               } else if (obj1.type === 'circle' || obj1.type === 'arc') {
                  const center = obj1.points[0];
                  const p1 = obj1.points[1];
                  const r = Math.hypot(p1.x - center.x, p1.y - center.y);
                  const dimId = Date.now().toString();
                  addDimension({
                    id: dimId, type: 'radial', points: [center, p1, pos],
                    value: r, label: `R${r.toFixed(2)}`, objectId: obj1.id
                  });
                  if (!settings.isReferenceMode) {
                    updateObject(obj1.id, {
                      constraints: [...(obj1.constraints || []), { id: `${dimId}-rad`, type: 'radius', value: r }]
                    });
                  }
                  setSelectedObjectIds([]);
               }
             } else if (obj1 && obj2) {
               if (obj1.type === 'line' && obj2.type === 'line') {
                   const l1p1 = obj1.points[0]; const l1p2 = obj1.points[1];
                   const l2p1 = obj2.points[0]; const l2p2 = obj2.points[1];
                   const denom = (l1p1.x - l1p2.x) * (l2p1.y - l2p2.y) - (l1p1.y - l1p2.y) * (l2p1.x - l2p2.x);
                   
                   const hostObj = (obj1.id === 'origin-x' || obj1.id === 'origin-y') ? obj2 : obj1;
                   const targetObjConstraint = hostObj.id === obj1.id ? obj2 : obj1;
                   
                   if (Math.abs(denom) <= 0.001) {
                       const lineLen = Math.hypot(l2p2.x - l2p1.x, l2p2.y - l2p1.y) || 1;
                       const dLine = Math.abs((l2p2.x - l2p1.x) * (l2p1.y - l1p1.y) - (l2p1.x - l1p1.x) * (l2p2.y - l2p1.y)) / lineLen;
                       const isVertical = Math.abs(l1p1.x - l1p2.x) < Math.abs(l1p1.y - l1p2.y);
                       const dimType = isVertical ? 'horizontal' : 'vertical';
                       const dimId = Date.now().toString();
                       addDimension({ id: dimId, type: dimType, points: [obj1.points[0], obj2.points[0], pos], value: dLine, label: `${dLine.toFixed(2)}`, objectId: hostObj.id, targetObjectId: targetObjConstraint.id });
                       if (!settings.isReferenceMode) updateObject(hostObj.id, { constraints: [...(hostObj.constraints || []), { id: `${dimId}-dist`, type: 'distance', pointIndex: 0, targetId: targetObjConstraint.id, value: dLine } as any] });
                       setSelectedObjectIds([]);
                       return;
                   }

                   let currentAngle = 90;
                   let rev1 = false, rev2 = false, topSign = 1;
                   
                   if (Math.abs(denom) > 0.001) {
                       const t = ((l1p1.x - l2p1.x) * (l2p1.y - l2p2.y) - (l1p1.y - l2p1.y) * (l2p1.x - l2p2.x)) / denom;
                       const intersect = { x: l1p1.x + t * (l1p2.x - l1p1.x), y: l1p1.y + t * (l1p2.y - l1p1.y) };
                       
                       const d1p1 = Math.hypot(l1p1.x - intersect.x, l1p1.y - intersect.y);
                       const d1p2 = Math.hypot(l1p2.x - intersect.x, l1p2.y - intersect.y);
                       rev1 = d1p1 > d1p2;
                       
                       const d2p1 = Math.hypot(l2p1.x - intersect.x, l2p1.y - intersect.y);
                       const d2p2 = Math.hypot(l2p2.x - intersect.x, l2p2.y - intersect.y);
                       rev2 = d2p1 > d2p2;
                       
                       const u1 = { x: l1p2.x - l1p1.x, y: l1p2.y - l1p1.y };
                       const u2 = { x: l2p2.x - l2p1.x, y: l2p2.y - l2p1.y };
                       const ray1 = { x: rev1 ? -u1.x : u1.x, y: rev1 ? -u1.y : u1.y };
                       const ray2 = { x: rev2 ? -u2.x : u2.x, y: rev2 ? -u2.y : u2.y };
                       
                       const cross = ray1.x * ray2.y - ray1.y * ray2.x;
                       topSign = cross > 0 ? 1 : -1;
                       
                       let angle1 = Math.atan2(ray1.y, ray1.x) * 180 / Math.PI;
                       let angle2 = Math.atan2(ray2.y, ray2.x) * 180 / Math.PI;
                       let sweep = angle2 - angle1;
                       while (sweep < 0) sweep += 360;
                       while (sweep >= 360) sweep -= 360;
                       if (sweep > 180) sweep = 360 - sweep;
                       currentAngle = sweep;
                   }
                   
                   const dimId = Date.now().toString();
                   addDimension({
                     id: dimId, type: 'angular', points: [obj1.points[0], obj2.points[0], pos],
                     value: currentAngle, label: `${currentAngle.toFixed(1)}°`, objectId: hostObj.id, targetObjectId: targetObjConstraint.id
                   });
                   if (!settings.isReferenceMode) {
                     const targetObjForAngle = hostObj.id === obj1.id ? obj2 : obj1;
                      updateObject(hostObj.id, {
                       constraints: [...(hostObj.constraints || []), { id: `${dimId}-angle`, type: 'angle', targetId: targetObjForAngle.id, value: currentAngle, rev1: hostObj.id === obj1.id ? rev1 : rev2, rev2: hostObj.id === obj1.id ? rev2 : rev1, topSign } as any]
                     });
                   }
                   setSelectedObjectIds([]);
                }
              } else if ((obj1.type === 'line' || obj2.type === 'line') && (obj1.type === 'point' || obj1.type === 'circle' || obj1.type === 'arc' || obj2.type === 'point' || obj2.type === 'circle' || obj2.type === 'arc')) {
                 const lObj = obj1.type === 'line' ? obj1 : obj2;
                 const pObj = obj1.type !== 'line' ? obj1 : obj2;
                 const l1p1 = lObj.points[0]; const l1p2 = lObj.points[1];
                 const p = pObj.points[0];
                 const lineLen = Math.hypot(l1p2.x - l1p1.x, l1p2.y - l1p1.y) || 1;
                 const dLine = Math.abs((l1p2.x - l1p1.x) * (l1p1.y - p.y) - (l1p1.x - p.x) * (l1p2.y - l1p1.y)) / lineLen;
                 const isVertical = Math.abs(l1p1.x - l1p2.x) < Math.abs(l1p1.y - l1p2.y);
                 const dimType = isVertical ? 'horizontal' : 'vertical';
                 const dimId = Date.now().toString();
                 addDimension({ id: dimId, type: dimType, points: [pObj.points[0], lObj.points[0], pos], value: dLine, label: `${dLine.toFixed(2)}`, objectId: pObj.id, targetObjectId: lObj.id });
                 if (!settings.isReferenceMode) updateObject(pObj.id, { constraints: [...(pObj.constraints || []), { id: `${dimId}-dist`, type: 'distance', pointIndex: 0, targetId: lObj.id, value: dLine } as any] });
                 setSelectedObjectIds([]);
              }
           }
          setSelectedObjectIds([]);
          return;
        } // Restore missing brace!

        if (settings.activeTool === 'offset') {
          if (offsetPreview.length > 0) {
            addObjects([...offsetPreview]);
            setSelectedObjectIds([]);
            setOffsetPreview([]);
            return;
          }
        }

        if (settings.activeTool === 'trim' || settings.activeTool === 'trim_corner') {
          setIsTrimmingSweep(true);
          setTrimSweepPath([pos]);
          setTrimSweepHitCache(new Set());
        }
        if (settings.activeTool === 'select' || (settings.activeTool === 'mirror' && !settings.isAltPressed)) {
          setIsSelecting(true);
          setSelectionRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
        }
      }
      return;
    }

    const drawingTools: ToolType[] = ['line', 'rectangle', 'circle', 'spline', 'arc', 'arc3pt', 'polygon', 'text', 'point', 'ellipse'];
    if (!drawingTools.includes(settings.activeTool)) {
      return;
    }

    if (isDrawing && currentShape) {
      if (currentShape.type === 'rectangle' && currentShape.points.length === 4) {
        const p1 = currentShape.points[0];
        const p2 = currentShape.points[1];
        const p3 = currentShape.points[2];
        const p4 = currentShape.points[3];
        
        const now = Date.now();
        const id1 = now.toString() + '-1';
        const id2 = now.toString() + '-2';
        const id3 = now.toString() + '-3';
        const id4 = now.toString() + '-4';

        const line1: CADObject = { ...currentShape, id: id1, name: 'Rect Line 1', type: 'line', points: [p1, p2], constraints: [] };
        const line2: CADObject = { ...currentShape, id: id2, name: 'Rect Line 2', type: 'line', points: [p2, p3], constraints: [] };
        const line3: CADObject = { ...currentShape, id: id3, name: 'Rect Line 3', type: 'line', points: [p3, p4], constraints: [] };
        const line4: CADObject = { ...currentShape, id: id4, name: 'Rect Line 4', type: 'line', points: [p4, p1], constraints: [] };

        // Add coincident constraints to join the lines
        line1.constraints.push({ id: id1 + '-c', type: 'coincident', pointIndex: 1, targetId: id2, targetPointIndex: 0 });
        line2.constraints.push({ id: id2 + '-c', type: 'coincident', pointIndex: 1, targetId: id3, targetPointIndex: 0 });
        line3.constraints.push({ id: id3 + '-c', type: 'coincident', pointIndex: 1, targetId: id4, targetPointIndex: 0 });
        line4.constraints.push({ id: id4 + '-c', type: 'coincident', pointIndex: 1, targetId: id1, targetPointIndex: 0 });

        // Add horizontal/vertical constraints to keep it a rectangle utilizing explicit point indices
        line1.constraints.push({ id: id1 + '-h', type: 'horizontal', pointIndex: 0, targetPointIndex: 1 });
        line2.constraints.push({ id: id2 + '-v', type: 'vertical', pointIndex: 0, targetPointIndex: 1 });
        line3.constraints.push({ id: id3 + '-h', type: 'horizontal', pointIndex: 0, targetPointIndex: 1 });
        line4.constraints.push({ id: id4 + '-v', type: 'vertical', pointIndex: 0, targetPointIndex: 1 });

        addObjects([line1, line2, line3, line4]);
      } else if (settings.activeTool === 'arc3pt' && currentShape.type === 'arc3pt') {
        if (currentShape.points.length === 2) {
          const p2 = currentShape.points[1];
          setCurrentShape({ ...currentShape, points: [...currentShape.points, { ...p2, id: crypto.randomUUID() }] });
          return;
        } else if (currentShape.points.length === 3) {
          const [p1, p2, p3] = currentShape.points;
          const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
          let center = { x: (p1.x + p3.x) / 2, y: (p1.y + p3.y) / 2, id: crypto.randomUUID() };
          if (Math.abs(d) >= 1e-4) {
             const ux = ((p1.x*p1.x + p1.y*p1.y)*(p2.y - p3.y) + (p2.x*p2.x + p2.y*p2.y)*(p3.y - p1.y) + (p3.x*p3.x + p3.y*p3.y)*(p1.y - p2.y)) / d;
             const uy = ((p1.x*p1.x + p1.y*p1.y)*(p3.x - p2.x) + (p2.x*p2.x + p2.y*p2.y)*(p1.x - p3.x) + (p3.x*p3.x + p3.y*p3.y)*(p2.x - p1.x)) / d;
             center = { x: ux, y: uy, id: crypto.randomUUID() };
          }
          const radius = Math.hypot(p1.x - center.x, p1.y - center.y);
          
          let startAngle = Math.atan2(p1.y - center.y, p1.x - center.x) * 180 / Math.PI;
          let endAngle = Math.atan2(p3.y - center.y, p3.x - center.x) * 180 / Math.PI;
          let sweepAngle = endAngle - startAngle;
          while (sweepAngle < 0) sweepAngle += 360;
          const midAngleRaw = Math.atan2(p2.y - center.y, p2.x - center.x) * 180 / Math.PI;
          let midAngle = midAngleRaw - startAngle;
          while (midAngle < 0) midAngle += 360;
          
          const isCCW = midAngle <= sweepAngle;
          const pStart = isCCW ? p1 : p3;
          const pEnd = isCCW ? p3 : p1;

          const finalArc: CADObject = { 
             ...currentShape, 
             id: Date.now().toString(),
             type: 'arc', 
             points: [center, pStart, pEnd],
             constraints: [...(currentShape.constraints || []), { id: `${currentShape.id}-radius`, type: 'radius', value: radius }]
          };
          addObject(finalArc);
        }
      } else if (settings.activeTool === 'ellipse' && currentShape.type === 'ellipse') {
        if (currentShape.points.length === 2) {
          const p2 = currentShape.points[1];
          setCurrentShape({ ...currentShape, points: [...currentShape.points, { ...p2, id: crypto.randomUUID() }] });
          return;
        } else if (currentShape.points.length === 3) {
          const p0 = currentShape.points[0]; // Center
          const p1 = currentShape.points[1]; // Major Axis Edge
          const rawP2 = currentShape.points[2]; // Minor Axis raw edge

          // Mirror P1 across P0 to get P2 (Major Negative)
          const p2 = { x: p0.x - (p1.x - p0.x), y: p0.y - (p1.y - p0.y), id: crypto.randomUUID() };

          // Project rawP2 onto the perpendicular axis to get P3 (Minor Positive)
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          
          const px = rawP2.x - p0.x;
          const py = rawP2.y - p0.y;
          // Perpendicular unit vector: (-uy, ux)
          const dotPerp = px * (-uy) + py * (ux);
          
          const p3 = { x: p0.x - uy * dotPerp, y: p0.y + ux * dotPerp, id: rawP2.id };
          // Mirror P3 across P0 to get P4 (Minor Negative)
          const p4 = { x: p0.x - (p3.x - p0.x), y: p0.y - (p3.y - p0.y), id: crypto.randomUUID() };

          const finalEllipse: CADObject = { 
             ...currentShape, 
             id: Date.now().toString(),
             type: 'ellipse', 
             points: [p0, p1, p2, p3, p4, {x:0, y:0, id: crypto.randomUUID()}, {x:0, y:0, id: crypto.randomUUID()}],
             constraints: currentShape.constraints || []
          };
          
          // Seed the foci properly right off the bat
          const a2 = Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2);
          const b2 = Math.pow(p3.x - p0.x, 2) + Math.pow(p3.y - p0.y, 2);
          const cFocal = Math.sqrt(Math.abs(a2 - b2));
          if (a2 >= b2) {
             finalEllipse.points[5].x = p0.x + (p1.x - p0.x) / len * cFocal;
             finalEllipse.points[5].y = p0.y + (p1.y - p0.y) / len * cFocal;
             finalEllipse.points[6].x = p0.x - (p1.x - p0.x) / len * cFocal;
             finalEllipse.points[6].y = p0.y - (p1.y - p0.y) / len * cFocal;
          } else {
             const lenB = Math.sqrt(b2) || 1;
             finalEllipse.points[5].x = p0.x + (p3.x - p0.x) / lenB * cFocal;
             finalEllipse.points[5].y = p0.y + (p3.y - p0.y) / lenB * cFocal;
             finalEllipse.points[6].x = p0.x - (p3.x - p0.x) / lenB * cFocal;
             finalEllipse.points[6].y = p0.y - (p3.y - p0.y) / lenB * cFocal;
          }

          addObject(finalEllipse);
        }
      } else if (settings.activeTool === 'spline' && currentShape.type === 'spline') {
        const lastPt = currentShape.points[currentShape.points.length - 1];
        setCurrentShape({ ...currentShape, points: [...currentShape.points, { ...lastPt, id: crypto.randomUUID() }] });
        return;
      } else {
        // Enforce the new currentShape.constraints hooks on drop natively binding exact structural architectures
        const buildConstraintFromSnap = (snap: SnapResult | null, pointId: string | undefined): Constraint | null => {
          if (!snap || snap.type === 'none' || snap.type === 'grid' || snap.type === 'objectCenter' || snap.type === 'geometricCenter' || !snap.objectId || !pointId) return null;
          const base: Constraint = { id: Date.now().toString() + '-' + pointId, type: 'coincident', pointId, targetId: snap.objectId };
          if (snap.type === 'vertex' || snap.type === 'center' || snap.type === 'quadrant') {
             if (!snap.targetPointId) return null; 
             return { ...base, type: 'coincident', targetPointId: snap.targetPointId };
          } else if (snap.type === 'midpoint') {
             return { ...base, type: 'midpoint' };
          } else if (snap.type === 'edge') {
             return { ...base, type: 'coincident' };
          }
          return null;
        };


        const constraintsToAdd: Constraint[] = [...(currentShape.constraints || [])];
        
        const c1 = buildConstraintFromSnap(startSnapRef.current, currentShape.points[0]?.id);
        if (c1) constraintsToAdd.push(c1);
        
        // Prevent duplicate constraints if it is a single point shape
        if (currentShape.points.length > 1) {
          const c2 = buildConstraintFromSnap(currentSnap, currentShape.points[currentShape.points.length - 1]?.id);
          if (c2) constraintsToAdd.push(c2);
        }

        currentShape.constraints = constraintsToAdd;

        addObject(currentShape);
      }
      
      setCurrentShape(null);
      setIsDrawing(false);
      return;
    }

    // Priority override: If a snap point is actively rendered, force its selection regardless of standard pixel thresholds
    const freshSnap = getSnapResult(pos);
    const snapRes = (currentSnap && currentSnap.type !== 'none') ? currentSnap : freshSnap;
    
    setCurrentSnap(snapRes.type !== 'none' ? snapRes : null);
    startSnapRef.current = snapRes.type !== 'none' ? snapRes : null;
    const snapped = snapRes.point;
    setIsDrawing(true);

    const generatePoint = (p: Point) => ({ ...p, id: crypto.randomUUID() });

    const newObj: CADObject = {
      id: Date.now().toString(),
      name: `${settings.activeTool.charAt(0).toUpperCase() + settings.activeTool.slice(1)} ${model.objects.length + 1}`,
      type: settings.activeTool as ShapeType,
      points: settings.activeTool === 'point' ? [generatePoint(snapped)] : [generatePoint(snapped), generatePoint({ ...snapped })],
      visible: true,
      locked: false,
      constraints: [],
      layerId: model.activeLayerId,
      sketchId: model.activeSketchId,
      construction: settings.isConstructionMode || false,
    };

    if (settings.activeTool === 'text') {
      newObj.text = 'New Text';
      newObj.fontSize = 14;
    }

    if (settings.activeTool === 'point') {
      const buildConstraintFromSnap = (snap: SnapResult | null, pointId: string | undefined): Constraint | null => {
        if (!snap || snap.type === 'none' || snap.type === 'grid' || snap.type === 'objectCenter' || snap.type === 'geometricCenter' || !snap.objectId || !pointId) return null;
        const base: Constraint = { id: Date.now().toString() + '-' + pointId, type: 'coincident', pointId, targetId: snap.objectId };
        if (snap.type === 'vertex' || snap.type === 'center' || snap.type === 'quadrant') {
           if (!snap.targetPointId) return null; 
           return { ...base, type: 'coincident', targetPointId: snap.targetPointId };
        } else if (snap.type === 'midpoint') {
           return { ...base, type: 'midpoint' };
        } else if (snap.type === 'edge') {
           return { ...base, type: 'coincident' };
        }
        return null;
      };

      const c1 = buildConstraintFromSnap(snapRes, newObj.points[0].id);
      if (c1) newObj.constraints.push(c1);
      addObject(newObj);
      return; // Single-click placement strictly bypasses `isDrawing` render hooks
    }

    setIsDrawing(true);
    setCurrentShape(newObj);
  };

  const handleMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = getStageRelativePosition(stage);
    if (!pos) return;
    setMousePos(pos);

    if (isSelecting && selectionRect) {
      setSelectionRect({
        ...selectionRect,
        w: pos.x - selectionRect.x,
        h: pos.y - selectionRect.y,
      });
      return;
    }

    if (isTrimmingSweep && (settings.activeTool === 'trim' || settings.activeTool === 'trim_corner')) {
      const newPath = [...trimSweepPath, pos];
      setTrimSweepPath(newPath);
      
      const prevPos = trimSweepPath[trimSweepPath.length - 1];
      if (!prevPos) return;

      const sweepLine: CADObject = { 
        id: 'sweep', name: 'sweep', type: 'line', points: [prevPos, pos], 
        visible: true, locked: false, constraints: [], layerId: '', sketchId: model.activeSketchId || '' 
      } as CADObject;

      const hitCandidates: { id: string, pt: Point }[] = [];
      model.objects.forEach(obj => {
         if (!obj.visible || trimSweepHitCache.has(obj.id)) return;
         if (obj.sketchId && obj.sketchId !== model.activeSketchId) return;
         const pts = findIntersections(sweepLine, [obj]);
         if (pts.length > 0) hitCandidates.push({ id: obj.id, pt: pts[0] });
      });

      if (hitCandidates.length > 0) {
        const newCache = new Set(trimSweepHitCache);
        hitCandidates.forEach(h => {
          if (!newCache.has(h.id)) {
            newCache.add(h.id);
            if (settings.activeTool === 'trim') {
               applyModification(h.id, h.pt); 
            }
          }
        });
        setTrimSweepHitCache(newCache);
      }
      return;
    }

    if (settings.activeTool === 'offset' && selectedObjectIds.length > 0) {
      const selectedWires = model.objects.filter(o => selectedObjectIds.includes(o.id));
      if (selectedWires.length > 0) {
        const first = selectedWires[0];
        if (first.points.length > 1) {
            const p0 = first.points[0];
            const p1 = first.points[first.points.length - 1] || first.points[1];
            const vx = p1.x - p0.x;
            const vy = p1.y - p0.y;
            const wx = pos.x - p0.x;
            const wy = pos.y - p0.y;
            const cross = vx * wy - vy * wx;
            const sideMultiplier = cross >= 0 ? 1 : -1;
            
            const previews = generateClipperOffset(selectedWires, settings.offsetDistance || 10, settings.offsetCount || 1, sideMultiplier);
            setOffsetPreview(previews);
        }
      }
    }

    if (!isDrawing || !currentShape) {
      const isToolActive = settings.activeTool !== 'select';
      const isSelectingTool = ['dimension', 'fillet', 'trim', 'offset', 'mirror', 'extrude'].includes(settings.activeTool);
      if (isToolActive || isSelectingTool || settings.activeTool === 'select') {
         const snapRes = getSnapResult(pos);
         setCurrentSnap(snapRes.type !== 'none' ? snapRes : null);
      } else {
         setCurrentSnap(null);
      }
      return;
    }

    const snapRes = getSnapResult(pos, currentShape.id);
    setCurrentSnap(snapRes);
    const snapped = snapRes.point;
    const startPoint = currentShape.points[0];

    let newPoints = [...currentShape.points];
    const updatePt = (idx: number, p: Point) => ({ ...p, id: currentShape.points[idx]?.id || crypto.randomUUID() });

    if (currentShape.type === 'line') {
      newPoints = [startPoint, updatePt(1, snapped)];
    } else if (currentShape.type === 'point') {
      newPoints = [updatePt(0, snapped)];
    } else if (currentShape.type === 'rectangle') {
      newPoints = [
        startPoint,
        updatePt(1, { x: snapped.x, y: startPoint.y }),
        updatePt(2, snapped),
        updatePt(3, { x: startPoint.x, y: snapped.y })
      ];
    } else if (currentShape.type === 'circle') {
      newPoints = [startPoint, updatePt(1, snapped)];
    } else if (currentShape.type === 'spline') {
      newPoints[newPoints.length - 1] = updatePt(newPoints.length - 1, snapped);
    } else if (currentShape.type === 'arc') {
      newPoints = [startPoint, updatePt(1, snapped)];
    } else if (currentShape.type === 'polygon') {
      // Simple polygon: hexagon
      const radius = Math.sqrt(Math.pow(snapped.x - startPoint.x, 2) + Math.pow(snapped.y - startPoint.y, 2));
      newPoints = [];
      for (let i = 0; i < 6; i++) {
        const angle = (i * 60) * Math.PI / 180;
        newPoints.push({
          x: startPoint.x + radius * Math.cos(angle),
          y: startPoint.y + radius * Math.sin(angle),
          id: currentShape.points[i]?.id || crypto.randomUUID()
        });
      }
    } else if (currentShape.type === 'arc3pt') {
      if (currentShape.points.length === 2) {
         newPoints = [startPoint, updatePt(1, snapped)];
      } else if (currentShape.points.length === 3) {
         newPoints = [currentShape.points[0], currentShape.points[1], updatePt(2, snapped)];
      }
    } else if (currentShape.type === 'ellipse') {
      if (currentShape.points.length === 2) {
         newPoints = [startPoint, updatePt(1, snapped)];
      } else if (currentShape.points.length === 3) {
         newPoints = [currentShape.points[0], currentShape.points[1], updatePt(2, snapped)];
      }
    }

    setCurrentShape({ ...currentShape, points: newPoints });
  };

  const handleMouseUp = () => {
    if (isTrimmingSweep) {
      console.log('isTrimmingSweep TRUE, tool:', settings.activeTool, 'cache size:', trimSweepHitCache.size);
      if (settings.activeTool === 'trim_corner' && trimSweepHitCache.size === 2) {
         console.log('trim_corner executed');
         const ids = Array.from(trimSweepHitCache);
         const obj1 = model.objects.find(o => o.id === ids[0]);
         const obj2 = model.objects.find(o => o.id === ids[1]);
         console.log('obj1:', obj1, 'obj2:', obj2);
         
         if (obj1 && obj2 && obj1.type === 'line' && obj2.type === 'line') {
             const p1 = obj1.points[0], p2 = obj1.points[1];
             const p3 = obj2.points[0], p4 = obj2.points[1];
             const det = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
             
             if (Math.abs(det) > 1e-4) {
                 const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / det;
                 const intersect = { x: p1.x + ua * (p2.x - p1.x), y: p1.y + ua * (p2.y - p1.y), id: crypto.randomUUID() };
                 
                 const hitX = trimSweepPath.reduce((s, p) => s + p.x, 0) / trimSweepPath.length;
                 const hitY = trimSweepPath.reduce((s, p) => s + p.y, 0) / trimSweepPath.length;
                 
                 const keepP1_obj1 = Math.hypot(p1.x - hitX, p1.y - hitY) > Math.hypot(p2.x - hitX, p2.y - hitY);
                 const newObj1Pts = keepP1_obj1 ? [p1, intersect] : [intersect, p2];
                 
                 const keepP1_obj2 = Math.hypot(p3.x - hitX, p3.y - hitY) > Math.hypot(p4.x - hitX, p4.y - hitY);
                 const newObj2Pts = keepP1_obj2 ? [p3, intersect] : [intersect, p4];
                 
                 console.log('Calling updateModel with intersect:', intersect, 'hitX:', hitX, 'hitY:', hitY);
                 updateModel(prev => {
                    const newObjs = prev.objects.map(o => {
                       if (o.id === obj1.id) return { ...o, points: newObj1Pts };
                       if (o.id === obj2.id) return { ...o, points: newObj2Pts };
                       return o;
                    });
                    
                    const idTag = Date.now().toString();
                    const coincident: Constraint = { id: `${idTag}-c`, type: 'coincident', pointIndex: keepP1_obj1 ? 1 : 0, targetId: obj2.id, targetPointIndex: keepP1_obj2 ? 1 : 0 };
                    
                    const finalObjs = newObjs.map(o => {
                       if (o.id === obj1.id) return { ...o, constraints: [...(o.constraints || []), coincident] };
                       return o;
                    });
                    
                    const solved = solveConstraints(finalObjs);
                    console.log('updateModel finished, returning solved constraints');
                    return { ...prev, objects: solved };
                 });
             } else {
                 console.log('Det too small:', det);
             }
         } else {
             console.log('obj types wrong or unfound');
         }
      } else if (settings.activeTool === 'trim_corner') {
         console.log('trim_corner conditions failed. Cache size:', trimSweepHitCache.size);
      }
      else if (settings.activeTool === 'trim') {
         // Auto-bind intersecting endpoints formed exactly by mathematical Trimming operations
         updateModel(prev => {
             const EPSILON = 1e-4;
             let changed = false;
             let nextObjs = [...prev.objects];
             
             // Gather all eligible line/arc vertices 
             const vertices: { objIndex: number, ptIndex: number, pos: Point, id: string }[] = [];
             nextObjs.forEach((o, oIdx) => {
                 if (o.type === 'line') {
                     vertices.push({ objIndex: oIdx, ptIndex: 0, pos: o.points[0], id: o.id });
                     if (o.points[1]) vertices.push({ objIndex: oIdx, ptIndex: 1, pos: o.points[1], id: o.id });
                 } else if (o.type === 'arc') {
                     if (o.points[1]) vertices.push({ objIndex: oIdx, ptIndex: 1, pos: o.points[1], id: o.id });
                     if (o.points[2]) vertices.push({ objIndex: oIdx, ptIndex: 2, pos: o.points[2], id: o.id });
                 }
             });
             
             // Compare all endpoints uniquely
             for (let i = 0; i < vertices.length; i++) {
                 for (let j = i + 1; j < vertices.length; j++) {
                     const v1 = vertices[i];
                     const v2 = vertices[j];
                     if (v1.id === v2.id) continue;
                     
                     const d = Math.hypot(v1.pos.x - v2.pos.x, v1.pos.y - v2.pos.y);
                     if (d < EPSILON) {
                         const obj1 = nextObjs[v1.objIndex];
                         const hasConstraint = obj1.constraints?.some(c => 
                             c.type === 'coincident' && c.pointIndex === v1.ptIndex &&
                             c.targetId === v2.id && c.targetPointIndex === v2.ptIndex
                         );
                         
                         if (!hasConstraint) {
                            const cId = `${Date.now()}-auto-${v1.id}-${v2.id}`;
                            const newC: Constraint = {
                                id: cId, type: 'coincident', pointIndex: v1.ptIndex,
                                targetId: v2.id, targetPointIndex: v2.ptIndex
                            };
                            nextObjs[v1.objIndex] = {
                                ...obj1,
                                constraints: [...(obj1.constraints || []), newC]
                            };
                            changed = true;
                         }
                     }
                 }
             }
             
             if (changed) {
                 return { ...prev, objects: solveConstraints(nextObjs) };
             }
             return prev;
         });
      }

      setIsTrimmingSweep(false);
      setTrimSweepPath([]);
      setTrimSweepHitCache(new Set());
      return;
    }

    if ((settings.activeTool as string === 'select' || settings.activeTool as string === 'mirror') && isSelecting) {
      const isCrossing = selectionRect.w < 0;
      const x1 = Math.min(selectionRect.x, selectionRect.x + selectionRect.w);
      const y1 = Math.min(selectionRect.y, selectionRect.y + selectionRect.h);
      const x2 = Math.max(selectionRect.x, selectionRect.x + selectionRect.w);
      const y2 = Math.max(selectionRect.y, selectionRect.y + selectionRect.h);

      const newlySelectedIds: string[] = [];

      const lineIntersectsLine = (p1: Point, p2: Point, p3: Point, p4: Point) => {
        const det = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
        if (det === 0) return false;
        const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / det;
        const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / det;
        return (ua >= 0 && ua <= 1) && (ub >= 0 && ub <= 1);
      };

      const lineIntersectsRect = (p1: Point, p2: Point) => {
        const p1In = p1.x >= x1 && p1.x <= x2 && p1.y >= y1 && p1.y <= y2;
        const p2In = p2.x >= x1 && p2.x <= x2 && p2.y >= y1 && p2.y <= y2;
        if (p1In || p2In) return true;
        return lineIntersectsLine(p1, p2, {x: x1, y: y1}, {x: x2, y: y1}) ||
               lineIntersectsLine(p1, p2, {x: x2, y: y1}, {x: x2, y: y2}) ||
               lineIntersectsLine(p1, p2, {x: x2, y: y2}, {x: x1, y: y2}) ||
               lineIntersectsLine(p1, p2, {x: x1, y: y2}, {x: x1, y: y1});
      };

      const circleIntersectsRect = (center: Point, radius: number) => {
        const closestX = Math.max(x1, Math.min(center.x, x2));
        const closestY = Math.max(y1, Math.min(center.y, y2));
        const distanceX = center.x - closestX;
        const distanceY = center.y - closestY;
        return (distanceX * distanceX + distanceY * distanceY) <= (radius * radius);
      };
      
      model.objects.forEach(obj => {
        if (!obj.visible) return;
        
        const points = obj.points;
        let allInside = true;
        let touched = false;

        points.forEach(p => {
          const inRect = p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
          if (!inRect) allInside = false;
          if (inRect) touched = true;
        });

        if (!touched && isCrossing) {
          if (obj.type === 'line' || obj.type === 'rectangle' || obj.type === 'polygon' || obj.type === 'spline') {
            for (let i = 0; i < points.length - 1; i++) {
              if (lineIntersectsRect(points[i], points[i+1])) {
                touched = true;
                break;
              }
            }
            if (!touched && (obj.type === 'rectangle' || obj.type === 'polygon')) {
              if (lineIntersectsRect(points[points.length-1], points[0])) {
                touched = true;
              }
            }
          } else if ((obj.type === 'circle' || obj.type === 'arc') && points.length >= 2 && points[0] && points[1]) {
            const radius = Math.sqrt(Math.pow(points[1].x - points[0].x, 2) + Math.pow(points[1].y - points[0].y, 2));
            if (circleIntersectsRect(points[0], radius)) {
              touched = true;
            }
          }
        }

        if (isCrossing) {
          if (touched) newlySelectedIds.push(obj.id);
        } else {
          if (allInside) newlySelectedIds.push(obj.id);
        }
      });

      if ((settings.activeTool as string) === 'mirror') {
         updateSettings({
           mirrorSession: {
             ...(settings.mirrorSession || { selectedIds: [], isSelectingLine: false }),
             selectedIds: [...new Set([...(settings.mirrorSession?.selectedIds || []), ...newlySelectedIds])]
           }
         });
      } else {
        setSelectedObjectIds(prev => {
          const combined = [...new Set([...prev, ...newlySelectedIds])];
          return combined;
        });
      }

      setIsSelecting(false);
      setSelectionRect(null);
      return;
    }
  };

  const applyModification = async (objId: string, pos: Point | null, overrideSelectedIds?: string[], overrideFirstClick?: Point | null) => {
    const obj = model.objects.find(o => o.id === objId);
    if (!obj) return;

    const ids = overrideSelectedIds || selectedObjectIds;
    const firstClick = overrideFirstClick || firstFilletClick;

    if (settings.activeTool === 'fillet') {
      if (ids.length === 2) {
        // Fillet between two lines
        const obj1 = model.objects.find(o => o.id === ids[0]);
        const obj2 = model.objects.find(o => o.id === ids[1]);
        
        if (obj1 && obj2 && ['line', 'arc'].includes(obj1.type) && ['line', 'arc'].includes(obj2.type)) {
            const intersects = findIntersections(obj1, [obj2], true);
            let intersect = null;
            if (intersects.length > 0) {
              if (firstClick && pos) {
                 intersect = intersects.reduce((best, cur) => {
                    const dCur = Math.hypot(cur.x - firstClick.x, cur.y - firstClick.y) + Math.hypot(cur.x - pos.x, cur.y - pos.y);
                    const dBest = Math.hypot(best.x - firstClick.x, best.y - firstClick.y) + Math.hypot(best.x - pos.x, best.y - pos.y);
                    return dCur < dBest ? cur : best;
                 });
              } else {
                 intersect = intersects[0];
              }
            }

            if (intersect) {
               const compVec = (o: CADObject, target: Point, click: Point | null) => {
                   if (o.type === 'line') {
                      const v1 = { x: o.points[0].x - target.x, y: o.points[0].y - target.y };
                      const v2 = { x: o.points[1].x - target.x, y: o.points[1].y - target.y };
                      if (click) {
                          const vc = { x: click.x - target.x, y: click.y - target.y };
                          return (vc.x * v1.x + vc.y * v1.y) > (vc.x * v2.x + vc.y * v2.y) ? v1 : v2;
                      }
                      return Math.hypot(v1.x, v1.y) > Math.hypot(v2.x, v2.y) ? v1 : v2;
                   } else {
                      if (click) return { x: click.x - target.x, y: click.y - target.y };
                      return { x: o.points[1].x - target.x, y: o.points[1].y - target.y };
                   }
               };
               
               const vec1 = compVec(obj1, intersect, firstClick);
               const vec2 = compVec(obj2, intersect, pos);
               const l1 = Math.hypot(vec1.x, vec1.y) || 1;
               const l2 = Math.hypot(vec2.x, vec2.y) || 1;
               const u1 = { x: vec1.x / l1, y: vec1.y / l1 };
               const u2 = { x: vec2.x / l2, y: vec2.y / l2 };
               const dot = u1.x * u2.x + u1.y * u2.y;
               const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
               
               let radius = settings.filletRadius;
               if (pos) {
                  const distToClick = Math.hypot(pos.x - intersect.x, pos.y - intersect.y);
                  radius = distToClick * Math.tan(angle / 2);
                  updateSettings({ filletRadius: radius });
               }

               try {
                  const occtResult = await performFillet(obj1 as any, obj2 as any, radius, intersect, u1, u2);

                  if (occtResult.success && occtResult.arc) {
                      const { center, pStart, pEnd } = occtResult.arc;
                      
                      const computePts = (o: CADObject, pTan: Point, clickPos: Point | null) => {
                          if (o.type === 'line') {
                             const p0 = o.points[0], p1 = o.points[1];
                             if (!clickPos) return [p0, pTan];
                             const ref = intersect || pTan;
                             const v0 = { x: p0.x - ref.x, y: p0.y - ref.y };
                             const v1 = { x: p1.x - ref.x, y: p1.y - ref.y };
                             const vC = { x: clickPos.x - ref.x, y: clickPos.y - ref.y };
                             if (vC.x * v0.x + vC.y * v0.y > vC.x * v1.x + vC.y * v1.y) return [p0, pTan];
                             return [pTan, p1];
                          } else {
                             const c = o.points[0], p1 = o.points[1], p2 = o.points[2];
                             const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
                             const aTan = Math.atan2(pTan.y - c.y, pTan.x - c.x);
                             if (!clickPos) return [c, p1, pTan];
                             const aC = Math.atan2(clickPos.y - c.y, clickPos.x - c.x);
                             
                             const getSweep = (s: number, e: number) => {
                                let sw = e - s;
                                while(sw <= 0) sw += 2*Math.PI; return sw;
                             };
                             const sInt = getSweep(a1, aTan);
                             const sC = getSweep(a1, aC);
                             if (sC < sInt) return [c, p1, pTan];
                             return [c, pTan, p2];
                          }
                      };

                      const sharedPStartId = crypto.randomUUID();
                      const sharedPEndId = crypto.randomUUID();
                      const pStartMapped = { ...pStart, id: sharedPStartId };
                      const pEndMapped = { ...pEnd, id: sharedPEndId };

                      const newPoints1 = computePts(obj1, pStartMapped, firstClick);
                      const newPoints2 = computePts(obj2, pEndMapped, pos);

                      const trimmedIndex1 = newPoints1.findIndex(p => p.id === sharedPStartId);
                      const trimmedIndex2 = newPoints2.findIndex(p => p.id === sharedPEndId);

                      const arcCenterPt = { ...center, id: crypto.randomUUID() };
                      const arcPt1Id = crypto.randomUUID();
                      const arcPt2Id = crypto.randomUUID();
                      
                      let outArcPt1 = { ...pStart, id: arcPt1Id };
                      let outArcPt2 = { ...pEnd, id: arcPt2Id };
                      let pt1Index = 1;
                      let pt2Index = 2;
                      
                      let startAngle = Math.atan2(pStart.y - center.y, pStart.x - center.x);
                      let endAngle = Math.atan2(pEnd.y - center.y, pEnd.x - center.x);
                      let angleDiff = endAngle - startAngle;
                      while (angleDiff < 0) angleDiff += 2 * Math.PI;
                      if (angleDiff > Math.PI) {
                          const tmp = outArcPt1;
                          outArcPt1 = outArcPt2;
                          outArcPt2 = tmp;
                          pt1Index = 2;
                          pt2Index = 1;
                      }

                      const arcId = Date.now().toString();
                      const arc: CADObject = {
                        id: arcId,
                        name: `Fillet Arc (OCCT)`,
                        type: 'arc',
                        points: [arcCenterPt, outArcPt1, outArcPt2],
                        visible: true,
                        locked: false,
                        constraints: [
                          { id: `${arcId}-tangent-1`, type: 'tangent', pointIndex: outArcPt1.id === arcPt1Id ? 1 : 2, targetId: obj1.id },
                          { id: `${arcId}-tangent-2`, type: 'tangent', pointIndex: outArcPt2.id === arcPt2Id ? 2 : 1, targetId: obj2.id },
                          { id: `${arcId}-radius`, type: 'radius', value: radius },
                          { id: `${arcId}-coincident-1`, type: 'coincident', pointIndex: outArcPt1.id === arcPt1Id ? 1 : 2, targetId: obj1.id, targetPointIndex: trimmedIndex1 },
                          { id: `${arcId}-coincident-2`, type: 'coincident', pointIndex: outArcPt2.id === arcPt2Id ? 2 : 1, targetId: obj2.id, targetPointIndex: trimmedIndex2 }
                        ],
                        layerId: model.activeLayerId,
                        sketchId: model.activeSketchId,
                      };
                      
                      updateModel(prev => {
                        let newObjects = prev.objects.map(o => {
                          if (o.id === obj1.id) {
                            const constraints = (o.constraints || []).filter(c => !(c.type === 'coincident' && c.targetId === obj2.id));
                            return { ...o, points: newPoints1, constraints };
                          }
                          if (o.id === obj2.id) {
                            const constraints = (o.constraints || []).filter(c => !(c.type === 'coincident' && c.targetId === obj1.id));
                            return { ...o, points: newPoints2, constraints };
                          }
                          return o;
                        });
                        newObjects.push(arc);
                        newObjects = solveConstraints(newObjects);
                        
                        return {
                          ...prev,
                          objects: newObjects,
                          dimensions: [...prev.dimensions, {
                            id: (Date.now() + 1).toString(),
                            type: 'radial',
                            points: [center, pStart],
                            value: radius,
                            label: `R${radius.toFixed(2)}`,
                            objectId: arcId,
                            isEditing: true,
                            sketchId: prev.activeSketchId,
                            metadata: {
                              type: 'fillet',
                              arcId: arcId,
                              line1Id: obj1.id,
                              line2Id: obj2.id,
                              intersect: intersect,
                              u1: u1,
                              u2: u2,
                              angle: angle,
                              p1_fixed: obj1.type === 'line' ? ((u1.x * vec1.x + u1.y * vec1.y) > 0 ? obj1.points[0] : obj1.points[1]) : obj1.points[1],
                              p2_fixed: obj2.type === 'line' ? ((u2.x * vec2.x + u2.y * vec2.y) > 0 ? obj2.points[0] : obj2.points[1]) : obj2.points[1]
                            }
                          }]
                        };
                      });
                      
                      setSelectedObjectIds([]);
                      setFirstFilletClick(null);
                  } else {
                     console.error('OCCT Fillet Returned error:', occtResult.error);
                  }
               } catch (err) {
                  console.error('OCCT Fillet Failed generically:', err);
               }
            }
        }
        return;
      }
      
      // Find the closest vertex to the click position
      let closestIdx = -1;
      let minDist = Infinity;
      
      if (pos) {
        obj.points.forEach((p, i) => {
          const d = Math.sqrt(Math.pow(p.x - pos.x, 2) + Math.pow(p.y - pos.y, 2));
          if (d < minDist) {
            minDist = d;
            closestIdx = i;
          }
        });
      }

      // If it's an intermediate vertex, we can "fillet" it
      if (closestIdx > 0 && closestIdx < obj.points.length - 1) {
        const pPrev = obj.points[closestIdx - 1];
        const pCurr = obj.points[closestIdx];
        const pNext = obj.points[closestIdx + 1];

        // Calculate vectors
        const v1 = { x: pPrev.x - pCurr.x, y: pPrev.y - pCurr.y };
        const v2 = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };

        const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
        const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

        if (len1 > 0 && len2 > 0) {
          const u1 = { x: v1.x / len1, y: v1.y / len1 };
          const u2 = { x: v2.x / len2, y: v2.y / len2 };

          // Angle between u1 and u2
          const dot = u1.x * u2.x + u1.y * u2.y;
          const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

          // Calculate radius based on click position
          let radius = settings.filletRadius;
          if (pos) {
            const distToClick = Math.sqrt(Math.pow(pos.x - pCurr.x, 2) + Math.pow(pos.y - pCurr.y, 2));
            radius = distToClick * Math.tan(angle / 2);
            // Cap radius to avoid overlapping other segments
            radius = Math.min(radius, len1 * 0.45, len2 * 0.45);
            updateSettings({ filletRadius: radius });
          }

          // Distance to tangent points
          const d = radius / Math.tan(angle / 2);
          
          const T1 = { x: pCurr.x + u1.x * d, y: pCurr.y + u1.y * d };
          const T2 = { x: pCurr.x + u2.x * d, y: pCurr.y + u2.y * d };
          
          // Center of arc
          const h = radius / Math.sin(angle / 2);
          const bisect = { x: u1.x + u2.x, y: u1.y + u2.y };
          const bisectLen = Math.sqrt(bisect.x * bisect.x + bisect.y * bisect.y);
          const uBisect = { x: bisect.x / bisectLen, y: bisect.y / bisectLen };
          const center = { x: pCurr.x + uBisect.x * h, y: pCurr.y + uBisect.y * h };

          // For polylines, we'd need to split the polyline or add an arc segment.
          const newPoints = [...obj.points];
          newPoints.splice(closestIdx, 1, T1, T2);
          updateObject(objId, { points: newPoints });

          const filletId = Date.now().toString();
          addObject({
            id: filletId,
            name: 'Fillet',
            type: 'arc',
            points: [center, T1, T2],
            visible: true,
            locked: false,
            constraints: [
              { id: `${filletId}-tangent-1`, type: 'tangent', targetId: objId, targetPointIndex: Math.max(0, closestIdx - 1) },
              { id: `${filletId}-tangent-2`, type: 'tangent', targetId: objId, targetPointIndex: closestIdx + 1 },
              { id: `${filletId}-coincident-1`, type: 'coincident', pointIndex: 1, targetId: objId, targetPointIndex: closestIdx },
              { id: `${filletId}-coincident-2`, type: 'coincident', pointIndex: 2, targetId: objId, targetPointIndex: closestIdx + 1 }
            ],
            layerId: model.activeLayerId,
            sketchId: model.activeSketchId
          });

          // In vertex mode, we must synchronously update the constraints model before dimension
          // So let's extract the arc out so we can explicitly solveConstraints
          const newArc = {
            id: filletId,
            name: 'Fillet',
            type: 'arc' as const,
            points: [center, T1, T2],
            visible: true,
            locked: false,
            constraints: [
              { id: `${filletId}-tangent-1`, type: 'tangent', targetId: objId, targetPointIndex: Math.max(0, closestIdx - 1) },
              { id: `${filletId}-tangent-2`, type: 'tangent', targetId: objId, targetPointIndex: closestIdx + 1 },
              { id: `${filletId}-coincident-1`, type: 'coincident', pointIndex: 1, targetId: objId, targetPointIndex: closestIdx },
              { id: `${filletId}-coincident-2`, type: 'coincident', pointIndex: 2, targetId: objId, targetPointIndex: closestIdx + 1 }
            ],
            layerId: model.activeLayerId,
            sketchId: model.activeSketchId
          };
          updateModel(prev => {
            let nextObj = prev.objects.map(o => o.id === objId ? { ...o, points: newPoints } : o);
            nextObj.push(newArc as any);
            return {
              ...prev,
              objects: nextObj
            };
          });

          addDimension({
            id: Date.now().toString() + '-dim',
            type: 'radial',
            points: [center, T1],
            value: radius,
            label: `R${radius.toFixed(2)}`,
            objectId: filletId,
            isEditing: true,
            metadata: {
              type: 'fillet',
              polylineId: objId,
              vertexIndex: closestIdx,
              intersect: pCurr,
              u1,
              u2,
              angle
            }
          });
        }
      }
    } else if (settings.activeTool === 'offset') {
      const connected = traceConnectedLines(obj, model.objects);
      const connectedIds = connected.map(c => c.id);
      if (!selectedObjectIds.includes(objId)) {
        setSelectedObjectIds(prev => [...new Set([...prev, ...connectedIds])]);
      } else {
        setSelectedObjectIds(prev => prev.filter(id => !connectedIds.includes(id)));
        setOffsetPreview([]);
      }
    } else if ((settings.activeTool as string) === 'mirror') {
      if (settings.isAltPressed || settings.mirrorSession?.isSelectingLine) {
        if (obj.type === 'line') {
          applyMirror(objId);
        }
      } else {
        const isSelected = settings.mirrorSession?.selectedIds.includes(objId);
        const newSelectedIds = isSelected
          ? settings.mirrorSession?.selectedIds.filter(id => id !== objId) || []
          : [...(settings.mirrorSession?.selectedIds || []), objId];
        
        updateSettings({
          mirrorSession: {
            ...(settings.mirrorSession || { selectedIds: [], isSelectingLine: false }),
            selectedIds: newSelectedIds
          }
        });
      }
    }
 else if (settings.activeTool === 'trim_corner') {
      if (ids.length === 2) {
        const obj1 = model.objects.find(o => o.id === ids[0]);
        const obj2 = model.objects.find(o => o.id === ids[1]);
        
        if (obj1 && obj2 && ['line', 'arc'].includes(obj1.type) && ['line', 'arc'].includes(obj2.type)) {
           const intersects = findIntersections(obj1, [obj2], true);
           if (intersects.length > 0) {
             const bestIntersect = intersects.reduce((best, cur) => {
                const dCur = Math.hypot(cur.x - firstClick!.x, cur.y - firstClick!.y) + Math.hypot(cur.x - pos!.x, cur.y - pos!.y);
                const dBest = Math.hypot(best.x - firstClick!.x, best.y - firstClick!.y) + Math.hypot(best.x - pos!.x, best.y - pos!.y);
                return dCur < dBest ? cur : best;
             });
             
             const computePts = (o: CADObject, clickPos: Point) => {
               if (o.type === 'line') {
                  const p0 = o.points[0], p1 = o.points[1];
                  const v0 = { x: p0.x - bestIntersect.x, y: p0.y - bestIntersect.y };
                  const v1 = { x: p1.x - bestIntersect.x, y: p1.y - bestIntersect.y };
                  const vClick = { x: clickPos.x - bestIntersect.x, y: clickPos.y - bestIntersect.y };
                  
                  const d0 = v0.x * v0.x + v0.y * v0.y;
                  const d1 = v1.x * v1.x + v1.y * v1.y;
                  
                  const dot0 = vClick.x * v0.x + vClick.y * v0.y;
                  const dot1 = vClick.x * v1.x + vClick.y * v1.y;
                  
                  let keepIndex = 0;
                  if (dot0 > 0 && dot1 <= 0) {
                     keepIndex = 0;
                  } else if (dot1 > 0 && dot0 <= 0) {
                     keepIndex = 1;
                  } else {
                     keepIndex = d0 > d1 ? 0 : 1;
                  }
                  
                  return keepIndex === 0 ? [p0, bestIntersect] : [bestIntersect, p1];
               } else if (o.type === 'arc') {
                  const center = o.points[0], p1 = o.points[1], p2 = o.points[2];
                  const a1 = Math.atan2(p1.y - center.y, p1.x - center.x);
                  const a2 = Math.atan2(p2.y - center.y, p2.x - center.x);
                  const aInt = Math.atan2(bestIntersect.y - center.y, bestIntersect.x - center.x);
                  const aClick = Math.atan2(clickPos.y - center.y, clickPos.x - center.x);
                  
                  const getSweep = (start: number, end: number) => {
                      let sweep = end - start;
                      while(sweep <= 0) sweep += 2 * Math.PI;
                      return sweep;
                  };
                  
                  const totalSweep = getSweep(a1, a2);
                  const sweepInt = getSweep(a1, aInt);
                  
                  if (sweepInt < totalSweep) {
                      const sweepClick = getSweep(a1, aClick);
                      if (sweepClick < sweepInt) {
                          return [center, p1, bestIntersect];
                      } else {
                          return [center, bestIntersect, p2];
                      }
                  } else {
                      const distToA2 = getSweep(a2, aInt);
                      const distToA1 = getSweep(aInt, a1);
                      if (distToA2 < distToA1) {
                          return [center, p1, bestIntersect];
                      } else {
                          return [center, bestIntersect, p2];
                      }
                  }
               }
               return o.points;
             };
             
             const pts1 = computePts(obj1, firstClick!);
             const pts2 = computePts(obj2, pos!);
             
             updateModel(prev => {
                let nextObjs = prev.objects.map(o => {
                  if (o.id === obj1.id) return { ...o, points: pts1 };
                  if (o.id === obj2.id) return { ...o, points: pts2 };
                  return o;
                });
                
                nextObjs = nextObjs.map(o => {
                  if (o.id === obj1.id) {
                     const pIdx = pts1.findIndex(p => p === bestIntersect);
                     const tIdx = pts2.findIndex(p => p === bestIntersect);
                     const c = { id: Date.now().toString(), type: 'coincident' as const, pointIndex: pIdx, targetId: obj2.id, targetPointIndex: tIdx };
                     return { ...o, constraints: [...(o.constraints || []), c] };
                  }
                  return o;
                });
                
                return { ...prev, objects: solveConstraints(nextObjs) };
             });
             
             setSelectedObjectIds([]);
             setFirstFilletClick(null);
           }
        }
      }
    } else if (settings.activeTool === 'trim') {
      if (pos) {
        const results = performTrim(obj, pos, model.objects.filter(o => o.visible && o.sketchId === obj.sketchId));
        if (results !== null) {
          updateModel(prev => {
            let nextObjs = [...prev.objects];
            
            const keepsOriginal = results.find(r => r.id === objId);
            const newObjects = results.filter(r => r.id !== objId);
            
            // Helper to structurally evaluate exact topological indices dynamically inside closures
            const resolveIdx = (cadObj: CADObject | undefined, pId?: string, pIdx?: number): number | undefined => {
               if (!cadObj) return undefined;
               if (pId) {
                   const found = cadObj.points.findIndex(p => p.id === pId);
                   if (found !== -1) return found;
               }
               return pIdx;
            };

            // 1. Purge stale constraints natively inside newly spawned or retained slices
            [keepsOriginal, ...newObjects].forEach(res => {
               if (!res) return;
               if (!res.constraints) res.constraints = [];
               
               res.constraints = res.constraints.filter(c => {
                  if (c.type === 'coincident') {
                      const idx = resolveIdx(obj, c.pointId, c.pointIndex);
                      if (idx !== undefined) {
                         const originalPt = obj.points[idx];
                         if (!originalPt) return false;
                         
                         // Locate where this point ended up mathematically inside the trimmed offspring!
                         const matchIndex = res.points.findIndex(p => Math.hypot(p.x - originalPt.x, p.y - originalPt.y) < 1e-4);
                         
                         if (matchIndex !== -1) {
                            // Point survived inside this slice! Relink it specifically so we don't rely on random UUID fallbacks!
                            c.pointIndex = matchIndex;
                            if (c.pointId) c.pointId = res.points[matchIndex].id; // update UUID hook to match new slice if necessary
                            return true;
                         }
                         return false; // Point was mathematically displaced by Trim! Sever the connection!
                      }
                  } else if (['distance', 'horizontal_distance', 'vertical_distance', 'angle', 'direct_distance'].includes(c.type)) {
                      // Line length / angle was explicitly structurally mutilated by a raw trimming operation! 
                      // We MUST proactively obliterate these specific dimension constraints to prevent the BFGS solver 
                      // from dynamically instantly expanding the slice back perfectly fighting the user's explicit trim.
                      return false;
                  }
                  return true;
               });
            });

            // Destroy associated global UI dimensions mapped to any mutilated geometric slice natively
            const trimmedObjIds = new Set<string>();
            trimmedObjIds.add(objId); // Target line was physically altered
            
            const validDimensions = prev.dimensions.filter(dim => {
               if (trimmedObjIds.has(dim.objectId) || (dim.targetObjectId && trimmedObjIds.has(dim.targetObjectId))) {
                   return false; // Eliminate the visual dimension overlay smoothly predicting mathematical oblivion
               }
               return true;
            });

            if (keepsOriginal) {
               nextObjs = nextObjs.map(o => o.id === objId ? { ...o, ...keepsOriginal } : o);
            } else {
               nextObjs = nextObjs.filter(o => o.id !== objId);
            }
            
            newObjects.forEach(res => {
               const payload = { ...res };
               if (!payload.layerId) payload.layerId = prev.activeLayerId || 'layer1';
               if (!payload.sketchId) payload.sketchId = prev.activeSketchId || 'sketch1';
               nextObjs.push(payload);
            });

            // 2. Map and re-link incoming external constraints safely targeting the severed piece
            nextObjs = nextObjs.map(other => {
               if (other.id === objId || !other.constraints) return other;
               
               let changed = false;
               const validConstraints = other.constraints.map(c => {
                  if (c.targetId === objId) {
                     const targetIdx = resolveIdx(obj, c.targetPointId, c.targetPointIndex);
                     if (targetIdx !== undefined) {
                         const originalTargetPt = obj.points[targetIdx];
                         if (!originalTargetPt) return c;
                         
                         if (keepsOriginal) {
                            // Check if keepsOriginal physically owns this point natively!
                            const matchIndex = keepsOriginal.points.findIndex(p => Math.hypot(p.x - originalTargetPt.x, p.y - originalTargetPt.y) < 1e-4);
                            if (matchIndex !== -1) {
                               c.targetPointIndex = matchIndex;
                               if (c.targetPointId) c.targetPointId = keepsOriginal.points[matchIndex].id;
                               changed = true;
                               return c;
                            }
                         }
                         
                         // Look for the physical constraint point wandering into new subdivided offspring slices!
                         for (const nobj of newObjects) {
                             const matchIndex = nobj.points.findIndex(p => Math.hypot(p.x - originalTargetPt.x, p.y - originalTargetPt.y) < 1e-4);
                             if (matchIndex !== -1) {
                                 changed = true;
                                 return { ...c, targetId: nobj.id, targetPointIndex: matchIndex, targetPointId: nobj.points[matchIndex].id };
                             }
                         }
                         
                         changed = true;
                         return null; // Endpoint vanished. Sever hook safely.
                     }
                  }
                  return c;
               }).filter(c => c !== null) as Constraint[];
               
               if (changed) return { ...other, constraints: validConstraints };
               return other;
            });
            
            return { ...prev, objects: solveConstraints(nextObjs), dimensions: validDimensions };
          });
          setSelectedObjectIds([]);
        } else {
          // Fallback basic trim: remove the last point for generic polylines not handled natively algebraically
          if (obj.points.length > 2 && (obj.type === 'line' || obj.type === 'polygon' || obj.type === 'spline')) {
            updateObject(objId, { points: obj.points.slice(0, -1) });
          } else {
            removeObject(objId);
          }
        }
      }
    }
 else if (settings.activeTool === 'array') {
      // Basic array: create 3 copies shifted horizontally
      for (let i = 1; i <= 3; i++) {
        const newPoints = obj.points.map(p => ({ x: p.x + i * 50, y: p.y }));
        addObject({
          ...obj,
          id: Date.now().toString() + i,
          name: `${obj.name} Array ${i}`,
          points: newPoints
        });
      }
    }
  };

  const renderObject = (obj: CADObject, isCurrent: boolean = false) => {
    if (!obj || !obj.points || obj.points.length === 0) return null;
    const sketch = model.sketches.find(s => s.id === obj.sketchId);
    if (!obj.visible || (sketch && !sketch.visible)) return null;

    const isSelected = selectedObjectIds.includes(obj.id) || 
      (settings.activeTool === 'mirror' && (settings.mirrorSession?.selectedIds.includes(obj.id) || false));
    const isHovered = hoveredObjectId === obj.id;
    
    const isPartOfSelectedConstraint = selectedConstraint && (
      selectedConstraint.objectId === obj.id || 
      (selectedConstraint.type === 'coincident' && selectedConstraint.targetId === obj.id)
    );

    const layer = model.layers.find(l => l.id === obj.layerId);
    let stroke = isSelected ? '#4EDE93' : (isHovered ? '#FFFFFF' : (layer?.color || '#ADC6FF'));
    
    if (isPartOfSelectedConstraint) {
      stroke = '#FFD700'; // Highlight color for selected constraint
    }

    const strokeWidth = (isHovered || isSelected || isPartOfSelectedConstraint ? 3 : 2) / stageScale;
    const opacity = isCurrent ? 0.6 : 1;

    const handleClick = (e: KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      const pos = getStageRelativePosition(stage);
      
      if (settings.activeTool === 'fillet') {
        if (selectedObjectIds.includes(obj.id)) return;
        
        const next = [...selectedObjectIds, obj.id];
        if (next.length === 1) {
          setFirstFilletClick(pos);
          setSelectedObjectIds(next);
        } else if (next.length === 2) {
          applyModification(obj.id, pos, next, firstFilletClick);
          setSelectedObjectIds([]);
        }
      } else if (settings.activeTool === 'dimension' || settings.activeTool === 'angle') {
        if (selectedObjectIds.includes(obj.id)) return;
        const next = [...selectedObjectIds, obj.id];
        if (next.length <= 2) {
          setSelectedObjectIds(next);
        }
      } else if (settings.activeTool === 'radius') {
        if (obj.type === 'circle' || obj.type === 'arc') {
          const center = obj.points[0];
          const p1 = obj.points[1];
          const r = Math.hypot(p1.x - center.x, p1.y - center.y);
          const dimId = Date.now().toString();
          const isDia = settings.isDiameterMode;
          const val = isDia ? r * 2 : r;
          
          addDimension({
            id: dimId, type: isDia ? 'diameter' : 'radial', points: [center, p1, pos!],
            value: val, label: isDia ? `Ø${val.toFixed(2)}` : `R${val.toFixed(2)}`, objectId: obj.id,
            isDiameter: isDia
          });
          if (!settings.isReferenceMode) {
            updateObject(obj.id, {
              constraints: [...(obj.constraints || []), { id: `${dimId}-rad`, type: 'radius', value: r }]
            });
          }
          setSelectedObjectIds([]);
          updateSettings({ activeTool: 'select' });
        }
      } else if (['trim', 'offset', 'mirror'].includes(settings.activeTool as string)) {
        applyModification(obj.id, pos);
      } else if (settings.activeTool === 'trim_corner') {
        if (selectedObjectIds.includes(obj.id)) return;
        const next = [...selectedObjectIds, obj.id];
        if (next.length === 1) {
          setFirstFilletClick(pos);
          setSelectedObjectIds(next);
        } else if (next.length === 2) {
          applyModification(obj.id, pos, next, firstFilletClick);
          setSelectedObjectIds([]);
        }
      } else {
        const drawingTools = ['line', 'rectangle', 'circle', 'arc', 'spline', 'polygon', 'point'];
        if (drawingTools.includes(settings.activeTool)) {
          return; // Suppress object selection while drawing primitives
        }
        
        if (e.evt.shiftKey) {
          setSelectedObjectIds(prev => 
            prev.includes(obj.id) ? prev.filter(id => id !== obj.id) : [...prev, obj.id]
          );
        } else {
          setSelectedObjectIds([obj.id]);
        }
      }
    };

    const getWireDragHandlers = () => {
      if (settings.activeTool !== 'select' || isCurrent || obj.type === 'point') return {};
      return {
        draggable: true,
        onDragStart: (e: any) => {
          e.cancelBubble = true;
          const stage = e.target.getStage();
          const pStart = getStageRelativePosition(stage);
          if (pStart) {
            e.target.setAttr('dragPointerStart', pStart);
          }
          const targets = selectedObjectIds.includes(obj.id) ? selectedObjectIds : [obj.id];
          if (!selectedObjectIds.includes(obj.id)) {
            setSelectedObjectIds([obj.id]);
          }
          const selection = selectedObjectIds.includes(obj.id) ? selectedObjectIds : [obj.id];
          const startState = selection.map(id => {
            const o = model.objects.find(obj => obj.id === id);
            return { id, type: o?.type, points: o ? o.points.map(p => ({...p})) : [] };
          });
          e.target.setAttr('dragState', startState);
        },
        onDragMove: (e: any) => {
          const dragState = e.target.getAttr('dragState');
          const pStart = e.target.getAttr('dragPointerStart');
          if (!dragState || !pStart) return;
          
          const stage = e.target.getStage();
          const pos = getStageRelativePosition(stage);
          if (!pos) return;
          
          const dx = pos.x - pStart.x;
          const dy = pos.y - pStart.y;
          
          if (obj.type === 'line' || obj.type === 'rectangle' || obj.type === 'polygon' || obj.type === 'spline' || obj.type === 'ellipse') {
             e.target.x(0);
             e.target.y(0);
          }
          
          dragState.forEach((state: any) => {
            const isAdaptable = state.points.length > 0 && ['arc', 'arc3pt', 'circle', 'ellipse'].includes(state.type);
            const hasConstraints = model.objects.some(o => o.id === state.id && (o.constraints?.length || 0) > 0 || (o.constraints?.some(c => c.targetId === state.id)));
            // We use state (from dragStart) to apply absolute translations synchronously
            const newPoints = state.points.map((p: Point, idx: number) => {
                if (isAdaptable && hasConstraints && idx !== 0) {
                    const latestObj = model.objects.find(o => o.id === state.id);
                    return latestObj ? latestObj.points[idx] : p; 
                }
                return { ...p, x: p.x + dx, y: p.y + dy };
            });
            updateObjectLive(state.id, { points: newPoints }, isAdaptable ? 0 : -1);
          });
        },
        onDragEnd: (e: any) => {
          const dragState = e.target.getAttr('dragState');
          const pStart = e.target.getAttr('dragPointerStart');
          if (!dragState || !pStart) return;
          
          const stage = e.target.getStage();
          const pos = getStageRelativePosition(stage);
          const dx = pos ? pos.x - pStart.x : 0;
          const dy = pos ? pos.y - pStart.y : 0;
          
          if (obj.type === 'line' || obj.type === 'rectangle' || obj.type === 'polygon' || obj.type === 'spline' || obj.type === 'ellipse') {
             e.target.x(0);
             e.target.y(0);
          }
          
          e.target.setAttr('dragState', null);
          e.target.setAttr('dragPointerStart', null);
          
          dragState.forEach((state: any) => {
            if (dx !== 0 || dy !== 0) {
              const isAdaptable = state.points.length > 0 && ['arc', 'arc3pt', 'circle', 'ellipse'].includes(state.type);
              const currentObj = model.objects.find(o => o.id === state.id) || state;
              updateObject(state.id, { points: currentObj.points }, isAdaptable ? 0 : -1); // final update pushing cleanly stabilized topography to history safely
            }
          });
        }
      };
    };

    if (obj.type === 'line' || obj.type === 'rectangle' || obj.type === 'spline' || obj.type === 'polygon') {
      const isClosed = obj.type === 'rectangle' || obj.type === 'polygon';
      const isSpline = obj.type === 'spline';
      const hasOCCTCurve = isSpline && obj.metadata?.curvePoints && obj.metadata.curvePoints.length > 0;
      const primaryPoints = hasOCCTCurve ? obj.metadata.curvePoints : obj.points;

      return (
        <Group key={obj.id}>
          {isClosed && !obj.construction && (
            <Line
               points={obj.points.flatMap(p => [p.x, p.y])}
               closed={true}
               fill={stroke}
               opacity={0.06}
               listening={false}
            />
          )}
          <Line
            points={primaryPoints.flatMap((p: Point) => [p.x, p.y])}
            stroke={stroke}
            strokeWidth={strokeWidth}
            hitStrokeWidth={20 / stageScale}
            closed={isClosed && !obj.construction}
            tension={isSpline && !hasOCCTCurve ? 0.5 : 0}
            opacity={opacity}
            dash={obj.construction ? [10, 5] : []}
            fillEnabled={false}
            onClick={handleClick}
            onMouseEnter={() => setHoveredObjectId(obj.id)}
            onMouseLeave={() => setHoveredObjectId(null)}
            {...getWireDragHandlers()}
          />
          {isSpline && (
            <Line
               points={obj.points.flatMap(p => [p.x, p.y])}
               stroke={stroke}
               strokeWidth={1 / stageScale}
               dash={[5 / stageScale, 10 / stageScale]}
               opacity={0.4}
               listening={false}
            />
          )}
          {isSpline && obj.points.map((p, i) => (
            <Circle
               key={`${obj.id}-pt-${i}`}
               x={p.x}
               y={p.y}
               radius={4 / stageScale}
               fill="transparent"
               stroke={stroke}
               strokeWidth={1.5 / stageScale}
               hitStrokeWidth={15 / stageScale}
               listening={false}
               opacity={0.6}
            />
          ))}
        </Group>
      );
    }

    if (obj.type === 'circle') {
      if (obj.points.length < 2) return null;
      const radius = Math.sqrt(
        Math.pow(obj.points[1].x - obj.points[0].x, 2) + 
        Math.pow(obj.points[1].y - obj.points[0].y, 2)
      );
      return (
        <Group key={obj.id}>
          {!obj.construction && (
            <Circle
              x={obj.points[0].x}
              y={obj.points[0].y}
              radius={radius}
              fill={stroke}
              opacity={0.06}
              listening={false}
            />
          )}
          <Circle
            x={obj.points[0].x}
            y={obj.points[0].y}
            radius={radius}
            stroke={stroke}
            strokeWidth={strokeWidth}
            hitStrokeWidth={20 / stageScale}
            opacity={opacity}
            dash={obj.construction ? [10, 5] : []}
            fillEnabled={false}
            onClick={handleClick}
            onMouseEnter={() => setHoveredObjectId(obj.id)}
            onMouseLeave={() => setHoveredObjectId(null)}
            {...getWireDragHandlers()}
          />
        </Group>
      );
    }

    if (obj.type === 'arc') {
      if (obj.points.length < 3) return null;
      const center = obj.points[0];
      const start = obj.points[1];
      const end = obj.points[2];
      
      if (!center || !start || !end) return null;
      
      const radius = Math.sqrt(Math.pow(start.x - center.x, 2) + Math.pow(start.y - center.y, 2));
      const startAngle = Math.atan2(start.y - center.y, start.x - center.x) * 180 / Math.PI;
      let endAngle = Math.atan2(end.y - center.y, end.x - center.x) * 180 / Math.PI;
      
      let sweepAngle = obj.metadata?.ccwSweep !== undefined 
          ? (obj.metadata.ccwSweep * 180 / Math.PI) 
          : (endAngle - startAngle);
      
      if (obj.metadata?.ccwSweep === undefined) {
          // Normalize sweep strictly to the minor arc (-180 to 180 cut boundary)
          // This prevents geometrically flawless OCCT arc points traversing clockwise 
          // from rendering visually inverted 270-degree arcs on the Konva canvas.
          if (sweepAngle > 180) sweepAngle -= 360;
          else if (sweepAngle < -180) sweepAngle += 360;
      }
      
      let renderStartAngle = startAngle;
      let renderSweepAngle = sweepAngle;
      if (sweepAngle < 0) {
        renderStartAngle = startAngle + sweepAngle;
        renderSweepAngle = Math.abs(sweepAngle);
      }
      
      return (
        <Arc
          key={obj.id}
          x={center.x}
          y={center.y}
          innerRadius={radius}
          outerRadius={radius}
          rotation={renderStartAngle}
          angle={renderSweepAngle}
          stroke={stroke}
          strokeWidth={strokeWidth}
          hitStrokeWidth={20 / stageScale}
          opacity={opacity}
          dash={obj.construction ? [10, 5] : []}
          fillEnabled={false}
          onClick={handleClick}
          onMouseEnter={() => setHoveredObjectId(obj.id)}
          onMouseLeave={() => setHoveredObjectId(null)}
          {...getWireDragHandlers()}
        />
      );
    }
    
    if (obj.type === 'ellipse') {
      if (obj.points.length < 2 || !obj.points[0] || !obj.points[1]) return null;
      const p0 = obj.points[0];
      const p1 = obj.points[1];
      const rx = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      let ry = rx;
      if (obj.points.length === 3) {
         // Ghost Preview: Project the raw mouse coordinate rigidly onto the perpendicular orthogonal minor axis natively
         const pMinor = obj.points[2];
         const dx = p1.x - p0.x;
         const dy = p1.y - p0.y;
         const len = Math.hypot(dx, dy) || 1;
         const ux = dx / len;
         const uy = dy / len;
         const px = pMinor.x - p0.x;
         const py = pMinor.y - p0.y;
         const dotPerp = px * (-uy) + py * (ux);
         ry = Math.abs(dotPerp);
      } else if (obj.points.length >= 5) {
         // Finalized object natively holds the exact bounded orthogonal points natively
         const pMinor = obj.points[3];
         ry = Math.hypot(pMinor.x - p0.x, pMinor.y - p0.y);
      }
      const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI;
      
      const isSelected = selectedObjectIds.includes(obj.id);
      
      return (
        <Group key={obj.id} listening={!isDrawing}>
          {/* Main Ellipse Body / Parametric Arc Slice */}
          {obj.metadata?.sweepAngle ? (
            <Shape
              x={p0.x}
              y={p0.y}
              rotation={angle}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={opacity}
              dash={obj.construction ? [10, 5] : []}
              fillEnabled={false}
              onClick={handleClick}
              onMouseEnter={() => setHoveredObjectId(obj.id)}
              onMouseLeave={() => setHoveredObjectId(null)}
              {...getWireDragHandlers()}
              hitStrokeWidth={10 / stageScale}
              sceneFunc={(ctx, shape) => {
                 ctx.beginPath();
                 const start = obj.metadata?.startAngle ?? 0;
                 const end = start + (obj.metadata?.sweepAngle ?? (2 * Math.PI));
                 ctx.ellipse(0, 0, rx, ry, 0, start, end, false);
                 ctx.fillStrokeShape(shape);
              }}
            />
          ) : (
            <Ellipse
              x={p0.x}
              y={p0.y}
              radiusX={rx}
              radiusY={ry}
              rotation={angle}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={opacity}
              dash={obj.construction ? [10, 5] : []}
              fillEnabled={false}
              onClick={handleClick}
              onMouseEnter={() => setHoveredObjectId(obj.id)}
              onMouseLeave={() => setHoveredObjectId(null)}
              {...getWireDragHandlers()}
              hitStrokeWidth={10 / stageScale}
            />
          )}
          {/* Internal Dashed Crosshairs for Axis Visualization */}
          {obj.points.length >= 5 && (isSelected || hoveredObjectId === obj.id) && (
             <Group listening={false}>
                <Line points={[obj.points[1].x, obj.points[1].y, obj.points[2].x, obj.points[2].y]} stroke={stroke} strokeWidth={1 / stageScale} dash={[5 / stageScale, 5 / stageScale]} opacity={0.4} />
                <Line points={[obj.points[3].x, obj.points[3].y, obj.points[4].x, obj.points[4].y]} stroke={stroke} strokeWidth={1 / stageScale} dash={[5 / stageScale, 5 / stageScale]} opacity={0.4} />
                {obj.points[5] && obj.points[6] && (
                   <Group>
                      <Line points={[obj.points[5].x - 4/stageScale, obj.points[5].y - 4/stageScale, obj.points[5].x + 4/stageScale, obj.points[5].y + 4/stageScale]} stroke={stroke} strokeWidth={1.5 / stageScale} />
                      <Line points={[obj.points[5].x + 4/stageScale, obj.points[5].y - 4/stageScale, obj.points[5].x - 4/stageScale, obj.points[5].y + 4/stageScale]} stroke={stroke} strokeWidth={1.5 / stageScale} />
                      
                      <Line points={[obj.points[6].x - 4/stageScale, obj.points[6].y - 4/stageScale, obj.points[6].x + 4/stageScale, obj.points[6].y + 4/stageScale]} stroke={stroke} strokeWidth={1.5 / stageScale} />
                      <Line points={[obj.points[6].x + 4/stageScale, obj.points[6].y - 4/stageScale, obj.points[6].x - 4/stageScale, obj.points[6].y + 4/stageScale]} stroke={stroke} strokeWidth={1.5 / stageScale} />
                   </Group>
                )}
             </Group>
          )}
        </Group>
      );
    }
    
    if (obj.type === 'arc3pt') {
       if (obj.points.length === 2 && obj.points[0] && obj.points[1]) {
          return <Line key={obj.id} points={[obj.points[0].x, obj.points[0].y, obj.points[1].x, obj.points[1].y]} stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} dash={[5 / stageScale, 5 / stageScale]} />;
       } else if (obj.points.length === 3 && obj.points[0] && obj.points[1] && obj.points[2]) {
          const p1 = obj.points[0], p2 = obj.points[1], p3 = obj.points[2];
          const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
          if (Math.abs(d) < 1e-4) return <Line key={obj.id} points={[p1.x, p1.y, p3.x, p3.y]} stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} dash={[5 / stageScale, 5 / stageScale]} />;
          
          const ux = ((p1.x*p1.x + p1.y*p1.y)*(p2.y - p3.y) + (p2.x*p2.x + p2.y*p2.y)*(p3.y - p1.y) + (p3.x*p3.x + p3.y*p3.y)*(p1.y - p2.y)) / d;
          const uy = ((p1.x*p1.x + p1.y*p1.y)*(p3.x - p2.x) + (p2.x*p2.x + p2.y*p2.y)*(p1.x - p3.x) + (p3.x*p3.x + p3.y*p3.y)*(p2.x - p1.x)) / d;
          const center = { x: ux, y: uy, id: 'center' };
          const radius = Math.hypot(p1.x - center.x, p1.y - center.y);
          
          const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x) * 180 / Math.PI;
          let endAngle = Math.atan2(p3.y - center.y, p3.x - center.x) * 180 / Math.PI;
          
          let sweepAngle = endAngle - startAngle;
          while (sweepAngle < 0) sweepAngle += 360;
          
          const midAngleRaw = Math.atan2(p2.y - center.y, p2.x - center.x) * 180 / Math.PI;
          let midAngle = midAngleRaw - startAngle;
          while (midAngle < 0) midAngle += 360;
          
          if (midAngle > sweepAngle) {
             sweepAngle = sweepAngle - 360;
          }
          
          let renderStartAngle = startAngle;
          let renderSweepAngle = sweepAngle;
          if (sweepAngle < 0) {
            renderStartAngle = startAngle + sweepAngle;
            renderSweepAngle = Math.abs(sweepAngle);
          }
          
          return <Arc key={obj.id} x={center.x} y={center.y} innerRadius={radius} outerRadius={radius} rotation={renderStartAngle} angle={renderSweepAngle} stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} fillEnabled={false} dash={[5 / stageScale, 5 / stageScale]} {...getWireDragHandlers()} />;
       }
    }

    if (obj.type === 'text') {
      if (!obj.points || obj.points.length < 1 || !obj.points[0]) return null;
      return (
        <Text
          key={obj.id}
          x={obj.points[0].x}
          y={obj.points[0].y}
          text={obj.text}
          fontSize={(obj.fontSize || 12) / stageScale}
          fill={stroke}
          scaleY={-1}
          onClick={handleClick}
        />
      );
    }

    if (obj.type === 'point') {
      if (!obj.points || obj.points.length < 1 || !obj.points[0]) return null;
      return (
        <Circle
          key={obj.id}
          x={obj.points[0].x}
          y={obj.points[0].y}
          radius={4 / stageScale}
          fill={obj.construction ? "transparent" : stroke}
          stroke={stroke}
          strokeWidth={(obj.construction ? 1.5 : 1) / stageScale}
          dash={obj.construction ? [2 / stageScale, 2 / stageScale] : []}
          onClick={handleClick}
          onMouseEnter={() => setHoveredObjectId(obj.id)}
          onMouseLeave={() => setHoveredObjectId(null)}
        />
      );
    }

    return null;
  };

  if (typeof window !== 'undefined') (window as any).__REACT_MODEL__ = model;
  return (
    <div ref={containerRef} className="flex-1 relative bg-[#0B1326] overflow-hidden">
      {/* Viewport Zoom Overlay */}
      <div className="absolute top-4 right-4 z-50 flex flex-col gap-2 pointer-events-auto">
         <button 
           title="Fit All"
           onClick={handleFitAll}
           className="p-2 bg-surface/80 hover:bg-surface border border-white/10 rounded-md backdrop-blur-md shadow-xl text-white/70 hover:text-white transition-colors"
         >
           <Maximize2 className="w-5 h-5" />
         </button>
      </div>

      {/* Grid Background */}
      {settings.showGrid && (
        <div 
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(to right, #ADC6FF 1px, transparent 1px),
              linear-gradient(to bottom, #ADC6FF 1px, transparent 1px)
            `,
            backgroundSize: `${settings.gridSize * stageScale}px ${settings.gridSize * stageScale}px`,
            backgroundPosition: `${stagePos.x}px ${stagePos.y}px`
          }}
        />
      )}

      {dimensions.width > 0 && (
        <>
          <Stage 
            width={dimensions.width} 
            height={dimensions.height}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onContextMenu={(e) => {
               e.evt.preventDefault();
               if (isDrawing && currentShape && currentShape.type === 'spline') {
                  if (currentShape.points.length >= 2) {
                     const finalPoints = currentShape.points.slice(0, currentShape.points.length - 1);
                     if (finalPoints.length >= 2) {
                        addObject({ ...currentShape, points: finalPoints });
                     }
                  }
                  setCurrentShape(null);
                  setIsDrawing(false);
                  return;
               }
               if (selectedObjectIds.length > 0 && (!hoveredObjectId || selectedObjectIds.includes(hoveredObjectId))) {
                  const anySolid = selectedObjectIds.some(id => {
                     const obj = model.objects.find(o => o.id === id);
                     return obj && !obj.construction;
                  });
                  updateModel(prev => ({
                     ...prev,
                     objects: prev.objects.map(o => 
                        selectedObjectIds.includes(o.id) ? { ...o, construction: anySolid } : o
                     )
                  }));
               } else if (hoveredObjectId) {
                  const targetObj = model.objects.find(o => o.id === hoveredObjectId);
                  if (targetObj) {
                     updateObject(targetObj.id, { construction: !targetObj.construction });
                  }
               }
            }}
            onWheel={handleWheel}
            scaleX={stageScale}
            scaleY={-stageScale}
            x={stagePos.x}
            y={stagePos.y}
            draggable={false} // We handle dragging manually for middle mouse
            onDragEnd={(e) => {
              if (e.target === e.target.getStage()) {
                setStagePos({ x: e.target.x(), y: e.target.y() });
                e.target.container().style.cursor = 'default';
              }
            }}
          >
            <Layer>
              {settings.showOrigin !== false && (
                <Group x={0} y={0} listening={settings.activeTool === 'select' || (settings.activeTool === 'mirror' && !!settings.mirrorSession?.isSelectingLine) || settings.activeTool === 'dimension' || settings.activeTool === 'angle'}>
                   <Line 
                    points={[-1000000, 0, 1000000, 0]} 
                    stroke="#FF3B30" 
                    strokeWidth={(hoveredObjectId === 'origin-x' || selectedObjectIds.includes('origin-x') ? 2 : 1) / stageScale} 
                    hitStrokeWidth={15 / stageScale}
                    opacity={settings.activeTool === 'mirror' || hoveredObjectId === 'origin-x' || selectedObjectIds.includes('origin-x') ? 1 : 0.05}
                    onMouseDown={(e) => { 
                       e.cancelBubble = true; 
                       if (settings.activeTool === 'mirror') applyMirror('axis-x');
                       else {
                          if (selectedObjectIds.includes('origin-x')) return;
                          const next = [...selectedObjectIds, 'origin-x'];
                          if (next.length <= 2) setSelectedObjectIds(next);
                       }
                    }}
                    onMouseEnter={(e) => { setHoveredObjectId('origin-x'); e.target.getStage()!.container().style.cursor = 'crosshair'; }}
                    onMouseLeave={(e) => { setHoveredObjectId(null); e.target.getStage()!.container().style.cursor = 'default'; }}
                 />
                 <Line 
                    points={[0, -1000000, 0, 1000000]} 
                    stroke="#34C759" 
                    strokeWidth={(hoveredObjectId === 'origin-y' || selectedObjectIds.includes('origin-y') ? 2 : 1) / stageScale} 
                    hitStrokeWidth={15 / stageScale}
                    opacity={settings.activeTool === 'mirror' || hoveredObjectId === 'origin-y' || selectedObjectIds.includes('origin-y') ? 1 : 0.05}
                    onMouseDown={(e) => { 
                       e.cancelBubble = true; 
                       if (settings.activeTool === 'mirror') applyMirror('axis-y');
                       else {
                          if (selectedObjectIds.includes('origin-y')) return;
                          const next = [...selectedObjectIds, 'origin-y'];
                          if (next.length <= 2) setSelectedObjectIds(next);
                       }
                    }}
                    onMouseEnter={(e) => { setHoveredObjectId('origin-y'); e.target.getStage()!.container().style.cursor = 'crosshair'; }}
                    onMouseLeave={(e) => { setHoveredObjectId(null); e.target.getStage()!.container().style.cursor = 'default'; }}
                 />
                 <Circle x={0} y={0} radius={3 / stageScale} fill="#FFFFFF" listening={false} />
              </Group>
              )}

              {closedLoops.map(loop => (
                 <Line
                   key={loop.id}
                   points={loop.points.flatMap(p => [p.x, p.y])}
                   closed={true}
                   fill="#00ffff"
                   opacity={0.06}
                   listening={false}
                 />
              ))}
              {model.objects.map(obj => renderObject(obj))}
              {currentShape && renderObject(currentShape, true)}
              {currentSnap && <SnapMarker snap={currentSnap} scale={stageScale} />}
              
              {/* Ghost Dimension */}
              {settings.activeTool === 'dimension' && mousePos && (selectedObjectIds.length > 0 || selectedVertices.length === 2) && (() => {
                let p1: Point | undefined, p2: Point | undefined;
                if (selectedVertices.length === 2) {
                   const v1 = selectedVertices[0]; const v2 = selectedVertices[1];
                   const o1 = model.objects.find(o => o.id === v1.objectId);
                   const o2 = model.objects.find(o => o.id === v2.objectId);
                   if (o1 && o2) { p1 = o1.points[v1.pointIndex]; p2 = o2.points[v2.pointIndex]; }
                } else if (selectedObjectIds.length > 0) {
                   const obj1 = resolveModelObject(selectedObjectIds[0]);
                   const obj2 = selectedObjectIds.length > 1 ? resolveModelObject(selectedObjectIds[1]) : null;
                   
                   const isLine = (o: CADObject) => o.type === 'line';
                   const isPoint = (o: CADObject) => o.type === 'point';
                   const isArc = (o: CADObject) => o.type === 'arc' || o.type === 'circle';

                   if (obj1 && !obj2) {
                     if (isLine(obj1)) { p1 = obj1.points[0]; p2 = obj1.points[1]; }
                     else if (isArc(obj1)) { p1 = obj1.points[0]; p2 = obj1.points[1]; }
                   } else if (obj1 && obj2) {
                     if (isLine(obj1) && isLine(obj2)) {
                        const dx1 = obj1.points[1].x - obj1.points[0].x; const dy1 = obj1.points[1].y - obj1.points[0].y;
                        const dx2 = obj2.points[1].x - obj2.points[0].x; const dy2 = obj2.points[1].y - obj2.points[0].y;
                        if (Math.abs(dx1*dy2 - dy1*dx2) < 1e-4) {
                           p1 = obj1.points[0];
                           const len2 = Math.hypot(dx2, dy2) || 1;
                           const vx = p1.x - obj2.points[0].x; const vy = p1.y - obj2.points[0].y;
                           const dot = vx*(dx2/len2) + vy*(dy2/len2);
                           p2 = { x: obj2.points[0].x + (dx2/len2)*dot, y: obj2.points[0].y + (dy2/len2)*dot };
                        }
                     } else if ((isLine(obj1) || isLine(obj2)) && (isPoint(obj1) || isPoint(obj2) || isArc(obj1) || isArc(obj2))) {
                        const lObj = isLine(obj1) ? obj1 : obj2; const pObj = !isLine(obj1) ? obj1 : obj2;
                        p1 = pObj.points[0];
                        const ax = lObj.points[0].x; const ay = lObj.points[0].y;
                        const bx = lObj.points[1].x; const by = lObj.points[1].y;
                        const lenL = Math.hypot(bx-ax, by-ay) || 1;
                        const dotV = (p1.x - ax)*((bx-ax)/lenL) + (p1.y - ay)*((by-ay)/lenL);
                        p2 = { x: ax + ((bx-ax)/lenL)*dotV, y: ay + ((by-ay)/lenL)*dotV };
                     } else if (!isLine(obj1) && !isLine(obj2)) {
                        p1 = obj1.points[0]; p2 = obj2.points[0];
                     }
                   }
                }
                
                if (p1 && p2) {
                   const dx = Math.abs(p2.x - p1.x);
                   const dy = Math.abs(p2.y - p1.y);
                   const midX = (p1.x + p2.x)/2;
                   const midY = (p1.y + p2.y)/2;
                   
                   const mouseDx = Math.abs(mousePos.x - midX);
                   const mouseDy = Math.abs(mousePos.y - midY);
                   
                   let dimType: 'horizontal' | 'vertical' | 'linear' = 'linear';
                   let val = Math.hypot(dx, dy);
                   
                   if (mouseDy > mouseDx * 1.5) { dimType = 'horizontal'; val = dx; }
                   else if (mouseDx > mouseDy * 1.5) { dimType = 'vertical'; val = dy; }
                   
                   let dimP1, dimP2;
                   if (dimType === 'linear') {
                      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
                      const px = -(p2.y - p1.y)/len; const py = (p2.x - p1.x)/len;
                      const offset = (mousePos.x - p1.x)*px + (mousePos.y - p1.y)*py;
                      dimP1 = { x: p1.x + px*offset, y: p1.y + py*offset };
                      dimP2 = { x: p2.x + px*offset, y: p2.y + py*offset };
                   } else if (dimType === 'horizontal') {
                      dimP1 = { x: p1.x, y: mousePos.y }; dimP2 = { x: p2.x, y: mousePos.y };
                   } else {
                      dimP1 = { x: mousePos.x, y: p1.y }; dimP2 = { x: mousePos.x, y: p2.y };
                   }
                   
                   return (
                     <Group opacity={0.6} listening={false}>
                       <Line points={[p1.x, p1.y, dimP1.x, dimP1.y]} stroke="#4EDE93" strokeWidth={1 / stageScale} dash={[2 / stageScale, 2 / stageScale]} />
                       <Line points={[p2.x, p2.y, dimP2.x, dimP2.y]} stroke="#4EDE93" strokeWidth={1 / stageScale} dash={[2 / stageScale, 2 / stageScale]} />
                       <Line points={[dimP1.x, dimP1.y, dimP2.x, dimP2.y]} stroke="#4EDE93" strokeWidth={1 / stageScale} dash={[5 / stageScale, 5 / stageScale]} />
                       <Text x={(dimP1.x+dimP2.x)/2} y={(dimP1.y+dimP2.y)/2} text={val.toFixed(2)} fontSize={12 / stageScale} fill="#4EDE93" align="center" scaleY={-1} />
                     </Group>
                   );
                }
                return null;
              })()}

              {/* Dimensions */}
              {model.dimensions.map(dim => {
                const sketch = model.sketches.find(s => s.id === dim.sketchId);
                if (sketch && !sketch.visible) return null;
                
                let drawElements = null;

                if (['linear', 'horizontal', 'vertical'].includes(dim.type) && dim.objectId && dim.points.length >= 3) {
                  // Find the constraint associated with this dimension to locate exactly which points are constrained natively
                  const hostObj = model.objects.find(o => o.constraints?.some(c => c.id === `${dim.id}-dist`));
                  const constraint = hostObj?.constraints?.find(c => c.id === `${dim.id}-dist`);
                  
                  let p1: Point | undefined;
                  let p2: Point | undefined;
                  
                  if (constraint) {
                    p1 = hostObj.points[constraint.pointIndex ?? 0];
                    if (constraint.targetId) {
                        const targetObj = resolveModelObject(constraint.targetId);
                        if (targetObj) {
                            if (constraint.targetPointIndex !== undefined) {
                                p2 = targetObj.points[constraint.targetPointIndex];
                            } else {
                                // Dynamic point-to-line projection matching mathematical bounds
                                const ax = targetObj.points[0].x; const ay = targetObj.points[0].y;
                                const bx = targetObj.points[1].x; const by = targetObj.points[1].y;
                                const dxL = bx - ax; const dyL = by - ay;
                                const lenL = Math.hypot(dxL, dyL) || 1;
                                const ux = dxL / lenL; const uy = dyL / lenL;
                                const vx = p1.x - ax; const vy = p1.y - ay;
                                const dotV = vx * ux + vy * uy;
                                p2 = { x: ax + ux * dotV, y: ay + uy * dotV };
                            }
                        }
                    } else {
                        // Standard line standalone constraint
                        p2 = hostObj.points[1];
                    }
                  } else {
                    // Fallback for older constraints or missing structural links
                    const targetObj = resolveModelObject(dim.objectId);
                    if (targetObj) {
                        p1 = targetObj.points[0];
                        if (dim.targetObjectId) {
                            const secondObj = resolveModelObject(dim.targetObjectId);
                            if (secondObj && secondObj.type === 'line') {
                                const ax = secondObj.points[0].x; const ay = secondObj.points[0].y;
                                const bx = secondObj.points[1].x; const by = secondObj.points[1].y;
                                const dxL = bx - ax; const dyL = by - ay;
                                const lenL = Math.hypot(dxL, dyL) || 1;
                                const ux = dxL / lenL; const uy = dyL / lenL;
                                const vx = p1.x - ax; const vy = p1.y - ay;
                                const dotV = vx * ux + vy * uy;
                                p2 = { x: ax + ux * dotV, y: ay + uy * dotV };
                            } else {
                                p2 = secondObj ? secondObj.points[0] : targetObj.points[1];
                            }
                        } else {
                            p2 = targetObj.points[1];
                        }
                    }
                  }
                  
                  if (p1 && p2) {
                    const pos = dim.points[2];
                    
                    let dimP1, dimP2;
                    
                    if (dim.type === 'linear') {
                        // Vector along the line
                        const dx = p2.x - p1.x;
                        const dy = p2.y - p1.y;
                        const len = Math.hypot(dx, dy) || 1;
                        const ux = dx / len;
                        const uy = dy / len;
                        
                        // Perpendicular vector
                        const px = -uy;
                        const py = ux;
                        
                        // Project pos onto the perpendicular vector to find the signed offset distance
                        const vx = pos.x - p1.x;
                        const vy = pos.y - p1.y;
                        const offset = vx * px + vy * py;
                        
                        dimP1 = { x: p1.x + px * offset, y: p1.y + py * offset };
                        dimP2 = { x: p2.x + px * offset, y: p2.y + py * offset };
                    } else if (dim.type === 'horizontal') {
                        dimP1 = { x: p1.x, y: pos.y };
                        dimP2 = { x: p2.x, y: pos.y };
                    } else { // vertical
                        dimP1 = { x: pos.x, y: p1.y };
                        dimP2 = { x: pos.x, y: p2.y };
                    }
                    
                    let displayLabel = dim.label;
                    if (dim.isReference) {
                        let currentVal = 0;
                        if (dim.type === 'linear') {
                            currentVal = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                        } else if (dim.type === 'horizontal') {
                            currentVal = Math.abs(p2.x - p1.x);
                        } else if (dim.type === 'vertical') {
                            currentVal = Math.abs(p2.y - p1.y);
                        }
                        displayLabel = `(${currentVal.toFixed(2)})`;
                        referenceDimValuesRef.current.set(dim.id, { value: currentVal, label: displayLabel });
                    }

                    drawElements = (
                      <Group 
                        key={dim.id}
                        onClick={(e) => {
                           e.cancelBubble = true;
                           setSelectedObjectIds(prev => prev.includes(dim.id) ? prev.filter(id => id !== dim.id) : [...prev, dim.id]);
                        }}
                        onContextMenu={(e) => {
                           e.cancelBubble = true;
                           e.evt.preventDefault();
                           updateDimension(dim.id, { isEditing: true });
                        }}
                        onDblClick={(e) => {
                           e.cancelBubble = true;
                           e.evt.preventDefault();
                           updateDimension(dim.id, { isEditing: true });
                        }}
                      >
                        {/* Witness lines */}
                        <Line points={[p1.x, p1.y, dimP1.x, dimP1.y]} stroke={selectedObjectIds.includes(dim.id) ? (settings.activeColors?.secondary || '#0A84FF') : "#4EDE93"} strokeWidth={1 / stageScale} opacity={0.5} />
                        <Line points={[p2.x, p2.y, dimP2.x, dimP2.y]} stroke={selectedObjectIds.includes(dim.id) ? (settings.activeColors?.secondary || '#0A84FF') : "#4EDE93"} strokeWidth={1 / stageScale} opacity={0.5} />
                        {/* Dimension line */}
                        <Line points={[dimP1.x, dimP1.y, dimP2.x, dimP2.y]} stroke={selectedObjectIds.includes(dim.id) ? (settings.activeColors?.secondary || '#0A84FF') : "#4EDE93"} strokeWidth={1 / stageScale} dash={[5 / stageScale, 5 / stageScale]} />
                        {/* Text */}
                        <Text
                          x={(dimP1.x + dimP2.x) / 2}
                          y={(dimP1.y + dimP2.y) / 2 - 15 / stageScale}
                          text={displayLabel}
                          fontSize={12 / stageScale}
                          scaleY={-1}
                          fill={selectedObjectIds.includes(dim.id) ? (settings.activeColors?.secondary || '#0A84FF') : "#4EDE93"}
                          align="center"
                          draggable={settings.activeTool === 'select'}
                          onDragMove={(e) => {
                            const newPos = { x: e.target.x(), y: e.target.y() + 15 };
                            const newPoints = [...dim.points];
                            newPoints[2] = newPos;
                            updateDimension(dim.id, { points: newPoints });
                          }}
                        />
                      </Group>
                    );
                  }
                } else if ((dim.type === 'radial' || dim.type === 'diameter') && dim.objectId && dim.points.length >= 2) {
                  const targetObj = resolveModelObject(dim.objectId);
                  if (targetObj && (targetObj.type === 'arc' || targetObj.type === 'circle')) {
                    const center = targetObj.points[0];
                    const pos = dim.points[2] || dim.points[1];
                    const isDia = dim.type === 'diameter';
                    const radius = isDia ? dim.value / 2 : dim.value;
                    
                    // Vector from center to pos
                    const dx = pos.x - center.x;
                    const dy = pos.y - center.y;
                    const len = Math.hypot(dx, dy) || 1;
                    const ux = dx / len;
                    const uy = dy / len;
                    
                    // Edge point
                    const edge = { x: center.x + ux * radius, y: center.y + uy * radius };
                    const oppositeEdge = isDia ? { x: center.x - ux * radius, y: center.y - uy * radius } : { x: center.x, y: center.y };
                    const endpoint = len > radius ? pos : edge;
                    
                    // We draw the line from center passing through edge out to pos
                    const txtPos = { x: pos.x, y: pos.y };
                    
                    let displayLabel = dim.label;
                    let isActuallyReference = dim.isReference;
                    if (!isActuallyReference) {
                        const hostObj = resolveModelObject(dim.objectId);
                        const hasConstraint = hostObj?.constraints?.some(c => c.type === 'radius' && c.id.startsWith(dim.id));
                        if (hostObj && !hasConstraint) isActuallyReference = true;
                    }
                    
                    if (isActuallyReference) {
                        const currentRadius = Math.hypot(targetObj.points[1].x - center.x, targetObj.points[1].y - center.y);
                        const currentVal = isDia ? currentRadius * 2 : currentRadius;
                        displayLabel = `(${isDia ? 'Ø' : 'R'}${currentVal.toFixed(2)})`;
                        referenceDimValuesRef.current.set(dim.id, { value: currentVal, label: displayLabel });
                    }

                    drawElements = (
                      <Group 
                        key={dim.id}
                        onClick={(e) => {
                           e.cancelBubble = true;
                           setSelectedObjectIds(prev => prev.includes(dim.id) ? prev.filter(id => id !== dim.id) : [...prev, dim.id]);
                        }}
                        onContextMenu={(e) => {
                           e.cancelBubble = true;
                           e.evt.preventDefault();
                           updateDimension(dim.id, { isEditing: true });
                        }}
                        onDblClick={(e) => {
                           e.cancelBubble = true;
                           e.evt.preventDefault();
                           updateDimension(dim.id, { isEditing: true });
                        }}
                      >
                        <Line points={[oppositeEdge.x, oppositeEdge.y, endpoint.x, endpoint.y]} stroke={selectedObjectIds.includes(dim.id) ? (settings.activeColors?.secondary || '#0A84FF') : "#4EDE93"} strokeWidth={1 / stageScale} dash={[5 / stageScale, 5 / stageScale]} />
                        <Circle x={edge.x} y={edge.y} radius={3 / stageScale} fill={selectedObjectIds.includes(dim.id) ? (settings.activeColors?.secondary || '#0A84FF') : "#4EDE93"} />
                        {isDia && <Circle x={oppositeEdge.x} y={oppositeEdge.y} radius={3 / stageScale} fill={selectedObjectIds.includes(dim.id) ? (settings.activeColors?.secondary || '#0A84FF') : "#4EDE93"} />}
                        <Text
                          x={txtPos.x}
                          y={txtPos.y}
                          text={displayLabel}
                          fontSize={12 / stageScale}
                          scaleY={-1}
                          fill={selectedObjectIds.includes(dim.id) ? (settings.activeColors?.secondary || '#0A84FF') : "#4EDE93"}
                          draggable={settings.activeTool === 'select'}
                          onDragMove={(e) => {
                            const newPos = getStageRelativePosition(e.target.getStage());
                            if (newPos) {
                              const newPoints = [...dim.points];
                              newPoints[2] = newPos;
                              updateDimension(dim.id, { points: newPoints });
                            }
                          }}
                        />
                      </Group>
                    );
                  }
                } else if (dim.type === 'angular' && dim.objectId && dim.targetObjectId && dim.points.length >= 3) {
                  const obj1 = resolveModelObject(dim.objectId);
                  const obj2 = resolveModelObject(dim.targetObjectId);
                  if (obj1 && obj2 && obj1.type === 'line' && obj2.type === 'line') {
                    const l1p1 = obj1.points[0];
                    const l1p2 = obj1.points[1];
                    const l2p1 = obj2.points[0];
                    const l2p2 = obj2.points[1];
                    const pos = dim.points[2];
                    
                    // Find intersection 
                    const denom = (l1p1.x - l1p2.x) * (l2p1.y - l2p2.y) - (l1p1.y - l1p2.y) * (l2p1.x - l2p2.x);
                    if (Math.abs(denom) > 0.001) {
                      const t = ((l1p1.x - l2p1.x) * (l2p1.y - l2p2.y) - (l1p1.y - l2p1.y) * (l2p1.x - l2p2.x)) / denom;
                      const intersect = { x: l1p1.x + t * (l1p2.x - l1p1.x), y: l1p1.y + t * (l1p2.y - l1p1.y) };
                      
                      const radius = Math.hypot(pos.x - intersect.x, pos.y - intersect.y);
                      // Find physical vectors from intersection along the dominant line segments
                      const d1p1 = Math.hypot(l1p1.x - intersect.x, l1p1.y - intersect.y);
                      const d1p2 = Math.hypot(l1p2.x - intersect.x, l1p2.y - intersect.y);
                      const ray1 = d1p1 > d1p2 ? { x: l1p1.x - intersect.x, y: l1p1.y - intersect.y } : { x: l1p2.x - intersect.x, y: l1p2.y - intersect.y };
                      
                      const d2p1 = Math.hypot(l2p1.x - intersect.x, l2p1.y - intersect.y);
                      const d2p2 = Math.hypot(l2p2.x - intersect.x, l2p2.y - intersect.y);
                      const ray2 = d2p1 > d2p2 ? { x: l2p1.x - intersect.x, y: l2p1.y - intersect.y } : { x: l2p2.x - intersect.x, y: l2p2.y - intersect.y };
                      
                      const pv = { x: pos.x - intersect.x, y: pos.y - intersect.y };
                      
                      let a1 = Math.atan2(ray1.y, ray1.x) * 180 / Math.PI;
                      let a2 = Math.atan2(ray2.y, ray2.x) * 180 / Math.PI;
                      let ap = Math.atan2(pv.y, pv.x) * 180 / Math.PI;
                      if (a1 < 0) a1 += 360;
                      if (a2 < 0) a2 += 360;
                      if (ap < 0) ap += 360;

                      const angleDiff = (fromA: number, toA: number) => {
                          let diff = toA - fromA;
                          while (diff < 0) diff += 360;
                          while (diff >= 360) diff -= 360;
                          return diff;
                      };

                      // The 4 structural rays emitted from the intersection
                      const rays = [
                         a1, 
                         a2, 
                         (a1 + 180) % 360, 
                         (a2 + 180) % 360
                      ].sort((a,b) => a - b);

                      // Determine mathematical sector containing `ap`
                      let startAngle = rays[rays.length - 1];
                      let endAngle = rays[0];
                      for (let i = 0; i < rays.length - 1; i++) {
                         if (ap >= rays[i] && ap <= rays[i+1]) {
                             startAngle = rays[i];
                             endAngle = rays[i+1];
                             break;
                         }
                      }
                      
                      let sweepAngle = angleDiff(startAngle, endAngle);

                      let displayLabel = dim.label;
                      let isActuallyReference = dim.isReference;
                      if (!isActuallyReference) {
                          const hostObj = resolveModelObject(dim.objectId);
                          const hasConstraint = hostObj?.constraints?.some(c => c.type === 'angle' && c.targetId === dim.targetObjectId);
                          if (hostObj && !hasConstraint) isActuallyReference = true;
                      }

                      if (isActuallyReference) {
                          displayLabel = `(${sweepAngle.toFixed(1)}°)`;
                          referenceDimValuesRef.current.set(dim.id, { value: sweepAngle, label: displayLabel });
                      } else {
                          // Lock the rendered sweep strictly to the constraint's mathematically solved exact numeric value.
                          // Sweep evaluating against parametric bounds gracefully handling reflexive visual intersections.
                          let physicalSweep = angleDiff(a1, a2);
                          let lockedStart = a1;
                          let lockedSweep = physicalSweep;
                          
                          if (Math.abs(physicalSweep - dim.value) > Math.abs((360 - physicalSweep) - dim.value)) {
                              lockedStart = a2;
                              lockedSweep = 360 - physicalSweep;
                          }
                          startAngle = lockedStart;
                          sweepAngle = lockedSweep;
                      }
                      
                      const midAngle = startAngle + sweepAngle / 2;
                      const midArcX = intersect.x + Math.cos(midAngle * Math.PI / 180) * radius;
                      const midArcY = intersect.y + Math.sin(midAngle * Math.PI / 180) * radius;

                      drawElements = (
                        <Group 
                          key={dim.id}
                          onClick={(e) => {
                             e.cancelBubble = true;
                             setSelectedObjectIds(prev => prev.includes(dim.id) ? prev.filter(id => id !== dim.id) : [...prev, dim.id]);
                          }}
                          onContextMenu={(e) => {
                             e.cancelBubble = true;
                             e.evt.preventDefault();
                             updateDimension(dim.id, { isEditing: true });
                          }}
                          onDblClick={(e) => {
                             e.cancelBubble = true;
                             e.evt.preventDefault();
                             updateDimension(dim.id, { isEditing: true });
                          }}
                        >
                          <Line 
                            points={[midArcX, midArcY, pos.x, pos.y]}
                            stroke={selectedObjectIds.includes(dim.id) ? (settings.activeColors?.secondary || '#0A84FF') : "#4EDE93"}
                            strokeWidth={1 / stageScale}
                            opacity={0.5}
                          />
                          <Arc
                            x={intersect.x}
                            y={intersect.y}
                            innerRadius={radius}
                            outerRadius={radius}
                            rotation={startAngle}
                            angle={sweepAngle}
                            stroke={selectedObjectIds.includes(dim.id) ? (settings.activeColors?.secondary || '#0A84FF') : "#4EDE93"}
                            strokeWidth={1 / stageScale}
                            dash={[5 / stageScale, 5 / stageScale]}
                          />
                          <Text
                            x={pos.x}
                            y={pos.y}
                            text={displayLabel}
                            fontSize={12 / stageScale}
                            scaleY={-1}
                            fill={selectedObjectIds.includes(dim.id) ? (settings.activeColors?.secondary || '#0A84FF') : "#4EDE93"}
                            align="center"
                            draggable={settings.activeTool === 'select'}
                            onDragMove={(e) => {
                              const newPos = { x: e.target.x(), y: e.target.y() };
                              const newPoints = [...dim.points];
                              newPoints[2] = newPos;
                              updateDimension(dim.id, { points: newPoints });
                            }}
                          />
                        </Group>
                      );
                    }
                  }
                }
                
                // Fallback rendering
                if (!drawElements && dim.points.length >= 2 && dim.points[0] && dim.points[1]) {
                  drawElements = (
                    <Group key={dim.id}>
                      <Line
                        points={[dim.points[0].x, dim.points[0].y, dim.points[1].x, dim.points[1].y]}
                        stroke="#4EDE93"
                        strokeWidth={1 / stageScale}
                        dash={[5 / stageScale, 5 / stageScale]}
                      />
                      <Text
                        x={(dim.points[0].x + dim.points[1].x) / 2}
                        y={(dim.points[0].y + dim.points[1].y) / 2 - 15 / stageScale}
                        text={dim.label}
                        fontSize={10 / stageScale}
                        fill="#4EDE93"
                        onClick={() => updateDimension(dim.id, { isEditing: true })}
                      />
                    </Group>
                  );
                }

                return drawElements;
              })}

            {/* Selection Handles for all objects */}
            {settings.activeTool === 'select' && model.objects.map(obj => (
              obj.points.map((p, i) => {
                // Feature: Clean UI - Hide perimeter anchors for pristine full circles and 360-degree major arcs
                if ((obj.type === 'circle' && i === 1) || 
                    (obj.type === 'arc' && (i === 1 || i === 2) && obj.metadata?.ccwSweep && obj.metadata.ccwSweep >= Math.PI * 1.999)) {
                    return null;
                }

                const isConstrained = obj.constraints.some(c => c.pointIndex === i) || 
                  model.objects.some(o => o.constraints.some(c => c.targetId === obj.id && c.targetPointIndex === i));
                
                const isPartOfSelectedConstraintVertex = selectedConstraint && (
                  (selectedConstraint.objectId === obj.id && selectedConstraint.pointIndex === i) ||
                  (selectedConstraint.type === 'coincident' && selectedConstraint.targetId === obj.id && selectedConstraint.targetPointIndex === i)
                );

                const isVertexSelected = selectedVertices.some(v => v.objectId === obj.id && v.pointIndex === i);
                const isVertexHovered = hoveredVertex?.objectId === obj.id && hoveredVertex?.pointIndex === i;
                const isObjSelected = selectedObjectIds.includes(obj.id);
                
                // Always show vertices in select mode, but subtle if not selected/hovered/objSelected
                const opacity = (isVertexSelected || isVertexHovered || isObjSelected || isPartOfSelectedConstraintVertex) ? 1 : 0.3;
                const baseRadius = (isVertexSelected || isVertexHovered || isPartOfSelectedConstraintVertex) ? 6 : 4;
                const radius = baseRadius / stageScale;

                return (
                  <Circle
                    key={`${obj.id}-${i}`}
                    x={p.x}
                    y={p.y}
                    radius={radius}
                    fill={isVertexSelected ? "#FFD700" : (isVertexHovered ? "#FFFFFF" : (isPartOfSelectedConstraintVertex ? "#FFD700" : "#4EDE93"))}
                    stroke={isVertexSelected ? "white" : (isConstrained || isPartOfSelectedConstraintVertex ? "#FF4444" : "none")}
                    strokeWidth={(isConstrained || isPartOfSelectedConstraintVertex ? 2 : 1) / stageScale}
                    hitStrokeWidth={15 / stageScale}
                    opacity={opacity}
                    draggable={settings.activeTool === 'select'}
                    onDragStart={(e) => {
                      e.cancelBubble = true;
                      if (!isVertexSelected) {
                         setSelectedVertices(prev => {
                           if (e.evt.shiftKey) return [...prev, { objectId: obj.id, pointIndex: i }];
                           return [{ objectId: obj.id, pointIndex: i }];
                         });
                         if (!isObjSelected) {
                           setSelectedObjectIds([obj.id]);
                         }
                      }
                    }}
                    onMouseEnter={() => setHoveredVertex({ objectId: obj.id, pointIndex: i })}
                    onMouseLeave={() => setHoveredVertex(null)}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      if (e.evt.shiftKey) {
                        setSelectedVertices(prev => {
                          const exists = prev.find(v => v.objectId === obj.id && v.pointIndex === i);
                          if (exists) return prev.filter(v => v !== exists);
                          return [...prev, { objectId: obj.id, pointIndex: i }];
                        });
                      } else {
                        setSelectedVertices([{ objectId: obj.id, pointIndex: i }]);
                        setSelectedObjectIds([obj.id]);
                      }
                    }}
                    onDragMove={(e) => {
                      const stage = e.target.getStage();
                      const pos = snapPoint(getStageRelativePosition(stage) || p, obj.id);
                      const newPoints = [...obj.points];
                      newPoints[i] = pos;
                      
                      // Solve constraints immediately to get the "attached" position
                      const newObjects = model.objects.map(o => o.id === obj.id ? { ...o, points: newPoints } : o);
                      const solvedObjects = solveConstraints(newObjects, obj.id, i);
                      const solvedObj = solvedObjects.find(o => o.id === obj.id);
                      
                      if (solvedObj) {
                        const solvedPos = solvedObj.points[i];
                        // Force the Konva node to the solved position
                        e.target.x(solvedPos.x);
                        e.target.y(solvedPos.y);
                        
                        // Update the model state with all solved objects
                        updateObjectLive(obj.id, { points: solvedObj.points }, i);
                      }
                    }}
                    onDragEnd={(e) => {
                      const stage = e.target.getStage();
                      const pos = snapPoint(getStageRelativePosition(stage) || p, obj.id);
                      const newPoints = [...obj.points];
                      newPoints[i] = pos;
                      updateObject(obj.id, { points: newPoints }, i);
                    }}
                  />
                );
              })
            ))}

            {/* Active Offset Preview Array */}
            {offsetPreview.map((obj) => {
              if (!obj || !obj.points || obj.points.length === 0) return null;
              if (obj.type === 'arc') {
                if (obj.points.length < 3) return null;
                const center = obj.points[0];
                const start = obj.points[1];
                const end = obj.points[2];
                if (!center || !start || !end) return null;
                const radius = Math.sqrt(Math.pow(start.x - center.x, 2) + Math.pow(start.y - center.y, 2));
                const startAngle = Math.atan2(start.y - center.y, start.x - center.x) * 180 / Math.PI;
                let endAngle = Math.atan2(end.y - center.y, end.x - center.x) * 180 / Math.PI;
                let sweepAngle = endAngle - startAngle;
                while (sweepAngle < 0) sweepAngle += 360;
                let renderStartAngle = startAngle;
                let renderSweepAngle = sweepAngle;
                if (sweepAngle < 0) { renderStartAngle = startAngle + sweepAngle; renderSweepAngle = Math.abs(sweepAngle); }
                
                return (
                  <Arc
                    key={obj.id}
                    x={center.x}
                    y={center.y}
                    innerRadius={radius}
                    outerRadius={radius}
                    rotation={renderStartAngle}
                    angle={renderSweepAngle}
                    stroke="#4EDE93"
                    strokeWidth={1.5 / stageScale}
                    opacity={0.8}
                    dash={[5 / stageScale, 5 / stageScale]}
                    listening={false}
                  />
                );
              } else if (obj.type === 'line' || obj.type === 'rectangle' || obj.type === 'polygon' || obj.type === 'circle' || obj.type === 'spline') {
                return (
                  <Line
                    key={obj.id}
                    points={obj.points.flatMap(p => [p.x, p.y])}
                    stroke="#4EDE93"
                    strokeWidth={1.5 / stageScale}
                    closed={obj.points.length > 2 && Math.hypot(obj.points[0].x - obj.points[obj.points.length-1].x, obj.points[0].y - obj.points[obj.points.length-1].y) < 1e-4}
                    opacity={0.8}
                    dash={[5 / stageScale, 5 / stageScale]}
                    listening={false}
                  />
                );
              }
              return null;
            })}

            {/* Marquee Selection */}
            {isSelecting && selectionRect && (
              <Rect
                x={selectionRect.x}
                y={selectionRect.y}
                width={selectionRect.w}
                height={selectionRect.h}
                fill={selectionRect.w < 0 ? "rgba(78, 222, 147, 0.1)" : "rgba(173, 198, 255, 0.1)"}
                stroke={selectionRect.w < 0 ? "#4EDE93" : "#ADC6FF"}
                strokeWidth={1 / stageScale}
                dash={selectionRect.w < 0 ? [5 / stageScale, 5 / stageScale] : []}
              />
            )}

            {/* Dynamic Angle Preview */}
            {(() => {
               if (settings.activeTool === 'angle' && selectedObjectIds.length === 2 && mousePos) {
                 const resolveObj = (id: string) => {
                   if (id === 'origin-x') return { id: 'origin-x', type: 'line', points: [{x:-1000000, y:0}, {x:1000000, y:0}] } as any;
                   if (id === 'origin-y') return { id: 'origin-y', type: 'line', points: [{x:0, y:-1000000}, {x:0, y:1000000}] } as any;
                   return model.objects.find(o => o.id === id);
                 };
                 const obj1 = resolveObj(selectedObjectIds[0]);
                 const obj2 = resolveObj(selectedObjectIds[1]);
                 if (obj1 && obj2 && (obj1.type === 'line' || obj1.id.startsWith('origin')) && (obj2.type === 'line' || obj2.id.startsWith('origin'))) {
                     const hostObj = (obj1.id === 'origin-x' || obj1.id === 'origin-y') ? obj2 : obj1;
                     const targetObj = hostObj.id === obj1.id ? obj2 : obj1;
                     
                     const l1p1 = hostObj.points[0]; const l1p2 = hostObj.points[1];
                     const l2p1 = targetObj.points[0]; const l2p2 = targetObj.points[1];
                     const denom = (l1p1.x - l1p2.x) * (l2p1.y - l2p2.y) - (l1p1.y - l1p2.y) * (l2p1.x - l2p2.x);
                     if (Math.abs(denom) > 0.001) {
                         const t = ((l1p1.x - l2p1.x) * (l2p1.y - l2p2.y) - (l1p1.y - l2p1.y) * (l2p1.x - l2p2.x)) / denom;
                         const intersect = { x: l1p1.x + t * (l1p2.x - l1p1.x), y: l1p1.y + t * (l1p2.y - l1p1.y) };
                         const vecMouse = { x: mousePos.x - intersect.x, y: mousePos.y - intersect.y };
                         const u1 = { x: l1p2.x - l1p1.x, y: l1p2.y - l1p1.y };
                         const u2 = { x: l2p2.x - l2p1.x, y: l2p2.y - l2p1.y };

                         const rev1 = (u1.x * vecMouse.x + u1.y * vecMouse.y) < 0;
                         const rev2 = (u2.x * vecMouse.x + u2.y * vecMouse.y) < 0;

                         const ray1 = { x: rev1 ? -u1.x : u1.x, y: rev1 ? -u1.y : u1.y };
                         const ray2 = { x: rev2 ? -u2.x : u2.x, y: rev2 ? -u2.y : u2.y };
                         
                         const crossRay = ray1.x * ray2.y - ray1.y * ray2.x;
                         const topSign = crossRay > 0 ? 1 : -1;
                         
                         let angle1 = Math.atan2(ray1.y, ray1.x) * 180 / Math.PI;
                         let angle2 = Math.atan2(ray2.y, ray2.x) * 180 / Math.PI;
                         let sweep = angle2 - angle1;
                         while (sweep < 0) sweep += 360;
                         while (sweep >= 360) sweep -= 360;
                         if (sweep > 180) sweep = 360 - sweep;
                         
                         let renderStart = angle1;
                         let renderSweep = sweep * topSign;
                         if (renderSweep < 0) {
                            renderStart += renderSweep;
                            renderSweep = Math.abs(renderSweep);
                         }

                         const radius = Math.max(Math.hypot(vecMouse.x, vecMouse.y), 10 / stageScale);
                         
                         return (
                            <Group>
                              <Arc x={intersect.x} y={intersect.y} innerRadius={radius} outerRadius={radius} rotation={renderStart} angle={renderSweep} stroke="#FFD700" strokeWidth={1/stageScale} opacity={0.6} dash={[5/stageScale, 5/stageScale]} listening={false} />
                              <Text x={mousePos.x} y={mousePos.y - 15/stageScale} text={`${sweep.toFixed(1)}°`} fill="#FFD700" fontSize={12/stageScale} scaleY={-1} listening={false} align="center" />
                              <Line points={[intersect.x, intersect.y, intersect.x + ray1.x * radius/Math.hypot(ray1.x, ray1.y), intersect.y + ray1.y * radius/Math.hypot(ray1.x, ray1.y)]} stroke="#FFD700" strokeWidth={1/stageScale} opacity={0.3} listening={false} />
                              <Line points={[intersect.x, intersect.y, intersect.x + ray2.x * radius/Math.hypot(ray2.x, ray2.y), intersect.y + ray2.y * radius/Math.hypot(ray2.x, ray2.y)]} stroke="#FFD700" strokeWidth={1/stageScale} opacity={0.3} listening={false} />
                            </Group>
                         );
                     }
                 }
               }
               return null;
            })()}

            {/* Mirror Ghost Preview */}
            {mirroredPreview.map(obj => {
              if (!obj || !obj.points || obj.points.length === 0) return null;
              const pts = obj.points.filter(p => p !== undefined).flatMap(p => [p.x, p.y]);
              if (obj.type === 'line') {
                if (obj.points.length < 2) return null;
                return <Line key={obj.id} points={pts} stroke="#4EDE93" strokeWidth={1/stageScale} opacity={0.3} dash={[5/stageScale, 5/stageScale]} />;
              } else if (obj.type === 'circle') {
                if (obj.points.length < 2) return null;
                const radius = Math.sqrt(Math.pow(obj.points[1].x - obj.points[0].x, 2) + Math.pow(obj.points[1].y - obj.points[0].y, 2));
                return <Circle key={obj.id} x={obj.points[0].x} y={obj.points[0].y} radius={radius} stroke="#4EDE93" strokeWidth={1/stageScale} opacity={0.3} dash={[5/stageScale, 5/stageScale]} />;
              } else if (obj.type === 'arc' || obj.type === 'arc3pt') {
                 // Simple representation for now
                 return <Line key={obj.id} points={pts} stroke="#4EDE93" strokeWidth={1/stageScale} opacity={0.3} dash={[5/stageScale, 5/stageScale]} />;
              }
              return null;
            })}

            {/* Power Trim Sweep Path */}
            {isTrimmingSweep && trimSweepPath.length > 1 && (
              <Line
                points={trimSweepPath.flatMap(p => [p.x, p.y])}
                stroke="rgba(255, 255, 255, 0.8)"
                strokeWidth={1.5 / stageScale}
                dash={[5 / stageScale, 5 / stageScale]}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            )}
          </Layer>
        </Stage>

      {/* Onscreen Dimension Inputs */}
      {model.dimensions.map(dim => {
        if (!dim.isEditing || !dim.points || dim.points.length === 0) return null;
        const labelPos = dim.points[dim.points.length - 1];
        if (!labelPos) return null;
        const textX = labelPos.x;
        const textY = labelPos.y;
        
        // Convert Y-Up world coordinates to Y-Down screen coordinates
        const screenX = textX * stageScale + stagePos.x;
        const screenY = textY * -stageScale + stagePos.y;
        
        return (
          <div 
            key={`input-${dim.id}`}
            className="absolute z-50 transform -translate-x-1/2 flex items-center gap-2"
            style={{ left: screenX, top: screenY - 25 }} // visually rest it right above the dimension cursor point precisely!
          >
            <input 
              autoFocus
              type="text"
              defaultValue={dim.value.toFixed(2)}
              onFocus={(e) => e.target.select()}
              className="bg-surface border border-primary rounded px-2 py-1 text-xs text-white w-20 shadow-xl"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const newValue = evaluateMath((e.target as HTMLInputElement).value);
                  if (newValue !== null && !isNaN(newValue)) {
                      const suffix = dim.type === 'angular' ? '°' : ((dim.type === 'radial' || dim.type === 'diameter') ? '' : ` ${settings.unit}`);
                      const prefix = dim.type === 'radial' ? 'R' : (dim.type === 'diameter' ? 'Ø' : '');
                      updateDimension(dim.id, { 
                        value: newValue, 
                        label: `${prefix}${newValue.toFixed(2)}${suffix}`,
                        isEditing: false 
                      });
                  }
                } else if (e.key === 'Escape') {
                  updateDimension(dim.id, { isEditing: false });
                }
              }}
              onBlur={() => updateDimension(dim.id, { isEditing: false })}
            />
            <button
               onMouseDown={(e) => { 
                   e.preventDefault(); 
                   e.stopPropagation(); 
                   toggleDimensionReference(dim.id); 
               }}
               className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-widest uppercase transition-colors shadow-xl border ${dim.isReference ? 'bg-black/80 text-white/50 border-white/20 hover:bg-white/10' : 'bg-primary/20 text-primary border-primary/40 hover:bg-primary/30'}`}
               title={dim.isReference ? "Click to make this dimension Drive geometry" : "Click to make this dimension a Reference readout"}
            >
               {dim.isReference ? 'REF' : 'DRV'}
            </button>
          </div>
        );
      })}

      </>
      )}

      {/* Floating Offset Configuration Panel */}
      {settings.activeTool === 'offset' && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-surface/90 backdrop-blur-md border border-border rounded-lg shadow-2xl p-2.5 flex items-center gap-4 z-50 pointer-events-auto">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold text-white/50 tracking-widest pl-1">Distance</span>
            <input 
              type="text" 
              defaultValue={settings.offsetDistance}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                      const val = evaluateMath((e.target as HTMLInputElement).value);
                      if (val !== null) {
                          updateSettings({ offsetDistance: val });
                          (e.target as HTMLInputElement).value = val.toString();
                      }
                  }
              }}
              onBlur={(e) => {
                  const val = evaluateMath((e.target as HTMLInputElement).value);
                  if (val !== null) {
                      updateSettings({ offsetDistance: val });
                      e.target.value = val.toString();
                  }
              }}
              className="w-16 bg-black/20 border border-white/10 rounded px-2 py-1 text-xs text-primary font-mono focus:outline-none focus:border-primary transition-colors text-right"
            />
          </div>
          <div className="w-px h-5 bg-white/10" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold text-white/50 tracking-widest pl-1">Count</span>
            <input 
              type="text" 
              defaultValue={settings.offsetCount}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                      const val = Math.round(evaluateMath((e.target as HTMLInputElement).value) || 1);
                      if (val !== null && val >= 1 && val <= 50) {
                          updateSettings({ offsetCount: val });
                          (e.target as HTMLInputElement).value = val.toString();
                      }
                  }
              }}
              onBlur={(e) => {
                  const val = Math.round(evaluateMath((e.target as HTMLInputElement).value) || 1);
                  if (val !== null && val >= 1 && val <= 50) {
                      updateSettings({ offsetCount: val });
                      e.target.value = val.toString();
                  }
              }}
              className="w-16 bg-black/20 border border-white/10 rounded px-2 py-1 text-xs text-secondary font-mono focus:outline-none focus:border-secondary transition-colors text-right"
            />
          </div>
        </div>
      )}

      {settings.activeTool === 'mirror' && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 z-50 pointer-events-auto">
          <div className="bg-surface/80 backdrop-blur-md border border-white/10 rounded-full px-4 py-2 flex items-center gap-3 shadow-2xl">
            <div className="flex items-center gap-2 pr-3 border-r border-white/10 text-xs font-medium text-white/50">
              <span className="bg-primary/20 text-primary px-1.5 py-0.5 rounded text-[10px]">MIRROR</span>
            </div>

            <div className="flex items-center gap-1">
              <button 
                onClick={() => updateSettings({ 
                  mirrorSession: { 
                    ...(settings.mirrorSession || { selectedIds: [], isSelectingLine: false }),
                    isSelectingLine: !settings.mirrorSession?.isSelectingLine 
                  } 
                })}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-200 text-xs font-medium ${
                  settings.isAltPressed || settings.mirrorSession?.isSelectingLine 
                    ? 'bg-primary text-secondary-bg shadow-lg shadow-primary/20' 
                    : 'text-white hover:bg-white/5'
                }`}
              >
                {settings.isAltPressed || settings.mirrorSession?.isSelectingLine ? 'Pick Axis Mode' : 'Pick Geometry Mode'}
                <div className="flex items-center gap-1 opacity-50 text-[10px] ml-1 px-1.5 py-0.5 bg-black/20 rounded">
                  <span className="font-bold">ALT</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
