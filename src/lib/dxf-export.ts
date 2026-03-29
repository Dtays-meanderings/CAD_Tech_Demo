import Drawing from 'dxf-writer';
import { CADModel, CADObject } from '../types';

export function exportToDXF(model: CADModel): string {
  const drawing = new Drawing();

  model.objects.forEach((obj: CADObject) => {
    if (obj.type === 'line' && obj.points.length >= 2 && obj.points[0] && obj.points[1]) {
      drawing.drawLine(obj.points[0].x, obj.points[0].y, obj.points[1].x, obj.points[1].y);
    } else if (obj.type === 'point' && obj.points.length >= 1 && obj.points[0]) {
      drawing.drawPoint(obj.points[0].x, obj.points[0].y);
    } else if (obj.type === 'circle' && obj.points.length >= 1 && obj.points[0]) {
      drawing.drawCircle(obj.points[0].x, obj.points[0].y, obj.metadata?.radius || 10);
    } else if (obj.type === 'ellipse' && obj.points.length >= 1 && obj.points[0]) {
      const majorAxis = obj.metadata?.majorAxis || 10;
      const minorAxis = obj.metadata?.minorAxis || 5;
      const rotation = obj.metadata?.rotation || 0;
      (drawing as any).drawEllipse(
        obj.points[0].x,
        obj.points[0].y,
        majorAxis * Math.cos(rotation),
        majorAxis * Math.sin(rotation),
        minorAxis / majorAxis
      );
    } else if (obj.type === 'arc' && obj.points.length >= 1 && obj.points[0]) {
      drawing.drawArc(
        obj.points[0].x,
        obj.points[0].y,
        obj.metadata?.radius || 10,
        obj.metadata?.startAngle || 0,
        obj.metadata?.endAngle || 90
      );
    } else if ((obj.type === 'rectangle' || obj.type === 'polygon') && obj.points.length >= 2) {
      for (let i = 0; i < obj.points.length; i++) {
        const p1 = obj.points[i];
        const p2 = obj.points[(i + 1) % obj.points.length];
        if (p1 && p2) {
          drawing.drawLine(p1.x, p1.y, p2.x, p2.y);
        }
      }
    } else if (obj.type === 'spline' && obj.points.length >= 2) {
      const validPoints = obj.points.filter(p => p && p.x !== undefined && p.y !== undefined);
      if (validPoints.length >= 2) {
        (drawing as any).drawSpline(
          validPoints.map(p => [p.x, p.y]),
          obj.metadata?.degree || 3,
          obj.metadata?.knots || [],
          obj.metadata?.weights || []
        );
      }
    } else if (obj.type === 'text' && obj.points.length >= 1 && obj.points[0]) {
      drawing.drawText(
        obj.points[0].x,
        obj.points[0].y,
        obj.fontSize || 12,
        0,
        obj.text || ''
      );
    }
  });

  const dxfString = drawing.toDxfString();
  const blob = new Blob([dxfString], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'model.dxf';
  link.click();
  URL.revokeObjectURL(url);

  return dxfString;
}
