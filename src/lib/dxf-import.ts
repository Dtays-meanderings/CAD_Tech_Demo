import DxfParser from 'dxf-parser';
import { CADObject } from '../types';

export function importFromDXF(dxfString: string): CADObject[] {
  const parser = new DxfParser();
  try {
    const dxf = parser.parseSync(dxfString);
    const objects: CADObject[] = [];

    if (!dxf || !dxf.entities) return [];

    dxf.entities.forEach((entity: any) => {
      const id = Math.random().toString(36).substr(2, 9);
      const common = {
        id,
        name: `${entity.type}-${id}`,
        visible: true,
        locked: false,
        constraints: [],
        layerId: 'layer-0', // Default layer
      };

      if (entity.type === 'LINE') {
        let p1, p2;
        if (entity.vertices && entity.vertices.length >= 2) {
          p1 = entity.vertices[0];
          p2 = entity.vertices[1];
        } else if (entity.start && entity.end) {
          p1 = entity.start;
          p2 = entity.end;
        }

        if (p1 && p2 && p1.x !== undefined && p1.y !== undefined && p2.x !== undefined && p2.y !== undefined) {
          objects.push({
            ...common,
            type: 'line',
            points: [
              { x: p1.x, y: p1.y },
              { x: p2.x, y: p2.y },
            ],
          });
        }
      } else if (entity.type === 'POINT' && entity.position && entity.position.x !== undefined && entity.position.y !== undefined) {
        objects.push({
          ...common,
          type: 'point',
          points: [{ x: entity.position.x, y: entity.position.y }],
        });
      } else if (entity.type === 'CIRCLE' && entity.center && entity.center.x !== undefined && entity.center.y !== undefined) {
        objects.push({
          ...common,
          type: 'circle',
          points: [{ x: entity.center.x, y: entity.center.y }],
          metadata: { radius: entity.radius || 10 },
        });
      } else if (entity.type === 'ELLIPSE' && entity.center && entity.majorAxisEndPoint && 
                 entity.center.x !== undefined && entity.center.y !== undefined &&
                 entity.majorAxisEndPoint.x !== undefined && entity.majorAxisEndPoint.y !== undefined) {
        const majorAxis = Math.sqrt(entity.majorAxisEndPoint.x ** 2 + entity.majorAxisEndPoint.y ** 2);
        objects.push({
          ...common,
          type: 'ellipse',
          points: [{ x: entity.center.x, y: entity.center.y }],
          metadata: {
            majorAxis: majorAxis,
            minorAxis: majorAxis * (entity.axisRatio || 0.5),
            rotation: Math.atan2(entity.majorAxisEndPoint.y, entity.majorAxisEndPoint.x),
          },
        });
      } else if (entity.type === 'ARC' && entity.center && entity.center.x !== undefined && entity.center.y !== undefined) {
        objects.push({
          ...common,
          type: 'arc',
          points: [{ x: entity.center.x, y: entity.center.y }],
          metadata: {
            radius: entity.radius || 10,
            startAngle: (entity.startAngle || 0) * (180 / Math.PI),
            endAngle: (entity.endAngle || Math.PI / 2) * (180 / Math.PI),
          },
        });
      } else if ((entity.type === 'TEXT' || entity.type === 'MTEXT') && (entity.position || (entity.columnX !== undefined && entity.columnY !== undefined))) {
        const x = entity.columnX !== undefined ? entity.columnX : (entity.position ? (entity.position.x || 0) : 0);
        const y = entity.columnY !== undefined ? entity.columnY : (entity.position ? (entity.position.y || 0) : 0);
        objects.push({
          ...common,
          type: 'text',
          points: [{ x, y }],
          text: entity.text || '',
          fontSize: entity.height || 12,
        });
      } else if (entity.type === 'SPLINE' && entity.controlPoints) {
        const validPoints = entity.controlPoints
          .filter((p: any) => p && p.x !== undefined && p.y !== undefined)
          .map((p: any) => ({ x: p.x, y: p.y }));
        
        if (validPoints.length >= 2) {
          objects.push({
            ...common,
            type: 'spline',
            points: validPoints,
            metadata: {
              degree: entity.degree || 3,
              knots: entity.knots || [],
              weights: entity.weights || [],
            },
          });
        }
      } else if ((entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') && entity.vertices) {
        // Convert polyline to multiple lines
        for (let i = 0; i < entity.vertices.length - 1; i++) {
          const p1 = entity.vertices[i];
          const p2 = entity.vertices[i + 1];
          if (p1 && p2 && p1.x !== undefined && p1.y !== undefined && p2.x !== undefined && p2.y !== undefined) {
            const lineId = Math.random().toString(36).substr(2, 9);
            objects.push({
              ...common,
              id: lineId,
              name: `line-${lineId}`,
              type: 'line',
              points: [
                { x: p1.x, y: p1.y },
                { x: p2.x, y: p2.y },
              ],
            });
          }
        }
        if (entity.shape && entity.vertices.length >= 2) { // Closed polyline
          const p1 = entity.vertices[entity.vertices.length - 1];
          const p2 = entity.vertices[0];
          if (p1 && p2 && p1.x !== undefined && p1.y !== undefined && p2.x !== undefined && p2.y !== undefined) {
            const lineId = Math.random().toString(36).substr(2, 9);
            objects.push({
              ...common,
              id: lineId,
              name: `line-${lineId}`,
              type: 'line',
              points: [
                { x: p1.x, y: p1.y },
                { x: p2.x, y: p2.y },
              ],
            });
          }
        }
      }
    });

    return objects;
  } catch (err) {
    console.error('DXF Parse Error:', err);
    return [];
  }
}
