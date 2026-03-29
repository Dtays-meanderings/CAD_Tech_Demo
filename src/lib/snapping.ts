import { CADModel, Point, SnapConfig, CADObject } from '../types';

export interface SnapResult {
  point: Point;
  type: 'vertex' | 'midpoint' | 'center' | 'geometricCenter' | 'edge' | 'objectCenter' | 'quadrant' | 'grid' | 'none';
  objectId?: string;
  targetPointId?: string; // Persistent UUID topological reference
  distance: number;
}

export function calculateSnap(
  pos: Point,
  model: CADModel,
  config: SnapConfig,
  worldThreshold: number,
  gridSize: number,
  excludeId?: string,
  showOrigin: boolean = true
): SnapResult {
  let bestSnap: SnapResult = { point: pos, type: 'none', distance: worldThreshold };

  if (!config.globalEnabled) {
    return bestSnap;
  }

  const snapPriorities: Record<SnapResult['type'], number> = {
    vertex: 10,
    center: 10,
    midpoint: 8,
    quadrant: 8,
    edge: 4,
    objectCenter: 3,
    geometricCenter: 3,
    grid: 1,
    none: 0
  };

  const evalObjects = [...model.objects];
  if (showOrigin) {
    evalObjects.push({ id: 'origin-x', type: 'line', points: [{ id: 'ox1', x: -1000000, y: 0 }, { id: 'ox2', x: 1000000, y: 0 }] } as any);
    evalObjects.push({ id: 'origin-y', type: 'line', points: [{ id: 'oy1', x: 0, y: -1000000 }, { id: 'oy2', x: 0, y: 1000000 }] } as any);
  }

  evalObjects.forEach(obj => {
    if (obj.id === excludeId) return;

    // Helper to evaluate a candidate point
    const evaluate = (p: Point, type: SnapResult['type'], targetPointId?: string) => {
      const d = Math.sqrt(Math.pow(pos.x - p.x, 2) + Math.pow(pos.y - p.y, 2));
      
      if (d <= worldThreshold) {
        const currentPriority = snapPriorities[bestSnap.type];
        const newPriority = snapPriorities[type];

        if (newPriority > currentPriority || (newPriority === currentPriority && d < bestSnap.distance)) {
          bestSnap = { point: p, type, objectId: obj.id, targetPointId, distance: d };
        }
      }
    };

    // 1. Vertex (Endpoints / Structural Nodes)
    if (config.vertex) {
      if (obj.type === 'line' || obj.type === 'spline' || obj.type === 'rectangle' || obj.type === 'polygon' || obj.type === 'arc') {
        obj.points.forEach(p => evaluate(p, 'vertex', p.id));
      }
    }

    // 2. Midpoint
    if (config.midpoint) {
      if (obj.type === 'line' && obj.points.length >= 2 && obj.points[0] && obj.points[1]) {
        const p1 = obj.points[0];
        const p2 = obj.points[1];
        evaluate({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, 'midpoint');
      }
    }

    // 3. Center
    if (config.center) {
      if (obj.type === 'circle' || obj.type === 'arc') {
        // First point is fundamentally the center anchor for radius configurations
        if (obj.points.length > 0) evaluate(obj.points[0], 'center', obj.points[0].id);
      }
    }

    // 4. Object Center (Bounding Box)
    if (config.objectCenter) {
      if (obj.points.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        obj.points.forEach(p => {
          if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
        });
        evaluate({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, 'objectCenter');
      }
    }

    // 5. Quadrant (0, 90, 180, 270)
    if (config.quadrant) {
      if (obj.type === 'circle' && obj.points.length >= 2 && obj.points[0] && obj.points[1]) {
        const c = obj.points[0];
        const rP = obj.points[1];
        const r = Math.sqrt(Math.pow(c.x - rP.x, 2) + Math.pow(c.y - rP.y, 2));
        evaluate({ x: c.x + r, y: c.y }, 'quadrant');
        evaluate({ x: c.x - r, y: c.y }, 'quadrant');
        evaluate({ x: c.x, y: c.y + r }, 'quadrant');
        evaluate({ x: c.x, y: c.y - r }, 'quadrant');
      }
    }

    // 6. Edge (Nearest point on curve)
    if (config.edge) {
      if (obj.type === 'line' && obj.points.length >= 2 && obj.points[0] && obj.points[1]) {
        const p1 = obj.points[0];
        const p2 = obj.points[1];
        
        // Project pos onto line mathematically
        const vec = { x: p2.x - p1.x, y: p2.y - p1.y };
        const lenSq = vec.x * vec.x + vec.y * vec.y;
        if (lenSq > 0) {
          const t = Math.max(0, Math.min(1, ((pos.x - p1.x) * vec.x + (pos.y - p1.y) * vec.y) / lenSq));
          const proj = { x: p1.x + t * vec.x, y: p1.y + t * vec.y };
          evaluate(proj, 'edge');
        }
      } else if (obj.type === 'circle' && obj.points.length >= 2 && obj.points[0] && obj.points[1]) {
        const c = obj.points[0];
        const rP = obj.points[1];
        const r = Math.hypot(rP.x - c.x, rP.y - c.y);
        const dist = Math.hypot(pos.x - c.x, pos.y - c.y);
        if (dist > 0) {
          evaluate({ x: c.x + (pos.x - c.x) * r / dist, y: c.y + (pos.y - c.y) * r / dist }, 'edge');
        }
      } else if (obj.type === 'arc' && obj.points.length >= 3 && obj.points[0] && obj.points[1] && obj.points[2]) {
        const c = obj.points[0];
        const start = obj.points[1];
        const end = obj.points[2];
        const r = Math.hypot(start.x - c.x, start.y - c.y);
        const dist = Math.hypot(pos.x - c.x, pos.y - c.y);
        
        if (dist > 0) {
          const posAngle = Math.atan2(pos.y - c.y, pos.x - c.x);
          const startAngle = Math.atan2(start.y - c.y, start.x - c.x);
          const endAngle = Math.atan2(end.y - c.y, end.x - c.x);
          
          const PI2 = Math.PI * 2;
          let sweep = endAngle - startAngle;
          while (sweep < 0) sweep += PI2;
          
          let relativePos = posAngle - startAngle;
          while (relativePos < 0) relativePos += PI2;
          
          if (relativePos <= sweep) {
            evaluate({ x: c.x + (pos.x - c.x) * r / dist, y: c.y + (pos.y - c.y) * r / dist }, 'edge');
          }
        }
      } else if ((obj.type === 'rectangle' || obj.type === 'polygon') && obj.points.length >= 2) {
        const pts = obj.points;
        for (let i = 0; i < pts.length; i++) {
          const p1 = pts[i];
          const p2 = pts[(i + 1) % pts.length];
          const vec = { x: p2.x - p1.x, y: p2.y - p1.y };
          const lenSq = vec.x * vec.x + vec.y * vec.y;
          if (lenSq > 0) {
            const t = Math.max(0, Math.min(1, ((pos.x - p1.x) * vec.x + (pos.y - p1.y) * vec.y) / lenSq));
            evaluate({ x: p1.x + t * vec.x, y: p1.y + t * vec.y }, 'edge');
          }
        }
      }
    }
  });

  // 7. Grid Snap (Only if no structural geometries were hit)
  if (bestSnap.type === 'none' && config.grid) {
    const gridX = Math.round(pos.x / gridSize) * gridSize;
    const gridY = Math.round(pos.y / gridSize) * gridSize;
    const gridD = Math.sqrt(Math.pow(pos.x - gridX, 2) + Math.pow(pos.y - gridY, 2));
    
    if (gridD < worldThreshold) {
      bestSnap = { point: { x: gridX, y: gridY }, type: 'grid', distance: gridD };
    }
  }

  return bestSnap;
}
