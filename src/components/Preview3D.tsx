import React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Line, Edges, Environment, ContactShadows, Bounds, useBounds, Html } from '@react-three/drei';
import { useSettings } from '../contexts/SettingsContext';
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { calculateSnap } from '../lib/snapping';

const SnapMarker3D = ({ snap, position }: { snap: any, position: THREE.Vector3 }) => {
  if (!snap || snap.type === 'none' || snap.type === 'grid') {
    return (
      <mesh position={position} renderOrder={100}>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshBasicMaterial color="#ffff00" depthTest={false} transparent opacity={0.8} />
      </mesh>
    );
  }

  const color = "#ffaa00";
  const s = 0.4;

  let content = null;
  switch (snap.type) {
    case 'vertex':
      content = <Line points={[[-s,-s,0], [s,-s,0], [s,s,0], [-s,s,0], [-s,-s,0]]} color={color} lineWidth={2} depthTest={false} />;
      break;
    case 'midpoint':
      content = <Line points={[[0,s,0], [s,-s,0], [-s,-s,0], [0,s,0]]} color={color} lineWidth={2} depthTest={false} />;
      break;
    case 'center':
    case 'arcCenter':
      content = <Line points={Array.from({length: 33}, (_, i) => [Math.cos(i * Math.PI / 16) * s, Math.sin(i * Math.PI / 16) * s, 0] as [number, number, number])} color={color} lineWidth={2} depthTest={false} />;
      break;
    case 'edge':
      content = (
        <group>
          <Line points={[[-s,-s,0], [s,s,0]]} color={color} lineWidth={2} depthTest={false} />
          <Line points={[[-s,s,0], [s,-s,0]]} color={color} lineWidth={2} depthTest={false} />
        </group>
      );
      break;
    case 'quadrant':
      content = (
        <group>
           <Line points={Array.from({length: 33}, (_, i) => [Math.cos(i * Math.PI / 16) * s, Math.sin(i * Math.PI / 16) * s, 0] as [number, number, number])} color={color} lineWidth={2} depthTest={false} />
           <Line points={[[-s*1.5,0,0], [s*1.5,0,0]]} color={color} lineWidth={2} depthTest={false} />
           <Line points={[[0,-s*1.5,0], [0,s*1.5,0]]} color={color} lineWidth={2} depthTest={false} />
        </group>
      );
      break;
    case 'objectCenter':
    case 'geometricCenter':
      content = (
        <group>
          <Line points={[[-s,-s,0], [s,-s,0], [s,s,0], [-s,s,0], [-s,-s,0]]} color={color} lineWidth={2} depthTest={false} />
          <Line points={[[-s/3,-s,0], [-s/3,s,0]]} color={color} lineWidth={2} depthTest={false} />
          <Line points={[[s/3,-s,0], [s/3,s,0]]} color={color} lineWidth={2} depthTest={false} />
          <Line points={[[-s,-s/3,0], [s,-s/3,0]]} color={color} lineWidth={2} depthTest={false} />
          <Line points={[[-s,s/3,0], [s,s/3,0]]} color={color} lineWidth={2} depthTest={false} />
        </group>
      );
      break;
    default:
      content = (
        <mesh>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.8} />
        </mesh>
      );
  }

  return (
    <group position={position} rotation={[-Math.PI / 2, 0, 0]} renderOrder={100}>
      {content}
    </group>
  );
};

const ExtrudeGizmo = ({ feature, updateFeature, centroidX, centroidY, depthScale, setOrbitEnabled }: any) => {
  const [hovered, setHovered] = React.useState(false);
  const startDragDepth = React.useRef<number | null>(null);
  const startDragY = React.useRef<number>(0);
  
  const groupRef = React.useRef<THREE.Group>(null);
  const { camera } = useThree();

  useFrame(() => {
    if (groupRef.current) {
      const target = new THREE.Vector3();
      groupRef.current.getWorldPosition(target);
      const dist = camera.position.distanceTo(target);
      const factor = Math.max(0.1, dist * 0.028);
      groupRef.current.scale.set(factor, factor, factor);
    }
  });

  const handlePointerDown = (e: any) => {
    e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    setOrbitEnabled(false);
    startDragDepth.current = feature.depth;
    startDragY.current = e.clientY;
  };
  
  const handlePointerMove = (e: any) => {
    if (startDragDepth.current === null) return;
    e.stopPropagation();
    const deltaY = startDragY.current - e.clientY;
    const dirScale = feature.reverse ? -1 : 1;
    let newDepth = startDragDepth.current + deltaY * 0.5 * dirScale;
    if (newDepth < 0.1) newDepth = 0.1;
    updateFeature(feature.id, { depth: newDepth });
  };
  
  const handlePointerUp = (e: any) => {
    e.stopPropagation();
    e.target.releasePointerCapture(e.pointerId);
    startDragDepth.current = null;
    setOrbitEnabled(true);
  };

  const color = hovered ? "#ffff00" : "#ffaa00";
  
  return (
    <group ref={groupRef} position={[centroidX, centroidY, depthScale]}>
      <mesh 
         position={[0, 0, 1.5]} 
         rotation={[Math.PI/2, 0, 0]}
         renderOrder={999}
         onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
         onPointerOut={(e) => { e.stopPropagation(); setHovered(false); }}
         onPointerDown={handlePointerDown}
         onPointerMove={handlePointerMove}
         onPointerUp={handlePointerUp}
      >
         <cylinderGeometry args={[0.15, 0.15, 3]} />
         <meshBasicMaterial color={color} depthTest={false} opacity={hovered ? 0.9 : 0.6} transparent />
      </mesh>
      
      <mesh 
         position={[0, 0, 3.5]} 
         rotation={[Math.PI/2, 0, 0]}
         renderOrder={999}
         onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
         onPointerOut={(e) => { e.stopPropagation(); setHovered(false); }}
         onPointerDown={handlePointerDown}
         onPointerMove={handlePointerMove}
         onPointerUp={handlePointerUp}
      >
         <coneGeometry args={[0.5, 1.2, 16]} />
         <meshBasicMaterial color={color} depthTest={false} opacity={hovered ? 0.9 : 0.6} transparent />
      </mesh>
    </group>
  );
};



const RevolveGizmo = ({ feature, updateFeature, setOrbitEnabled }: any) => {
  const [hovered, setHovered] = React.useState(false);
  const startDragAngle = React.useRef<number | null>(null);
  const startDragX = React.useRef<number>(0);
  
  const groupRef = React.useRef<THREE.Group>(null);
  const { camera } = useThree();

  useFrame(() => {
    if (groupRef.current) {
      const target = new THREE.Vector3();
      groupRef.current.getWorldPosition(target);
      const dist = camera.position.distanceTo(target);
      const factor = Math.max(0.1, dist * 0.028);
      groupRef.current.scale.set(factor, factor, factor);
    }
  });

  const handlePointerDown = (e: any) => {
    e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    setOrbitEnabled(false);
    startDragAngle.current = feature.angle || 360;
    startDragX.current = e.clientX;
  };
  
  const handlePointerMove = (e: any) => {
    if (startDragAngle.current === null) return;
    e.stopPropagation();
    const deltaX = e.clientX - startDragX.current;
    let newAngle = startDragAngle.current + deltaX * 0.5;
    if (newAngle < 1) newAngle = 1;
    if (newAngle > 360) newAngle = 360;
    updateFeature(feature.id, { angle: newAngle });
  };
  
  const handlePointerUp = (e: any) => {
    e.stopPropagation();
    e.target.releasePointerCapture(e.pointerId);
    startDragAngle.current = null;
    setOrbitEnabled(true);
  };

  const color = hovered ? "#00ffff" : "#00aaaa";
  const revAngle = (feature.angle || 360) * (Math.PI / 180);
  
  return (
    <group ref={groupRef} rotation={[0, revAngle, 0]} position={[2, 0, 0]}>
      <mesh 
         renderOrder={999}
         onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
         onPointerOut={(e) => { e.stopPropagation(); setHovered(false); }}
         onPointerDown={handlePointerDown}
         onPointerMove={handlePointerMove}
         onPointerUp={handlePointerUp}
      >
         <torusGeometry args={[0.5, 0.1, 16, 32]} />
         <meshBasicMaterial color={color} depthTest={false} opacity={hovered ? 0.9 : 0.6} transparent />
      </mesh>
    </group>
  );
};

const AutofitTrigger = ({ model, targetRef }: { model: any, targetRef: React.RefObject<THREE.Group> }) => {
   const bounds = useBounds();
   // Initialize to -1 so that the very first feature creation (which mounts the Preview3D component) triggers the auto-fit hook correctly.
   const prevCount = React.useRef(-1);
   
   React.useEffect(() => {
      const curCount = model.features?.length || 0;
      if (curCount > prevCount.current && curCount > 0) {
          setTimeout(() => {
              if (targetRef.current) {
                 bounds.refresh(targetRef.current).fit();
              } else {
                 bounds.refresh().fit();
              }
          }, 150);
      }
      prevCount.current = curCount;
   }, [model.features, bounds, targetRef]);
   return null;
};

const STLExportListener = () => {
   const { scene } = useThree();
   React.useEffect(() => {
     const handleExport = (e: any, isLathe: boolean = false) => {
       const { id, name } = e.detail;
       const object = scene.getObjectByName(`feature-mesh-${id}`);
       if (object) {
         try {
           const stlWorldGroup = new THREE.Group();
           
           if (isLathe) {
               // CNC Lathe CAM typically expects:
               // Machine Z (Spindle) = Sketch X (Scene X)
               // Machine X (Diameter) = Sketch Y (Scene -Z)
               // Rotating THREE Scene by +90 deg around Y maps Scene X to STL Z, and Scene -Z to STL X.
               stlWorldGroup.rotation.y = -Math.PI / 2;
           } else {
               // Standard 3DP Slicers use Z as UP. THREE.js uses Y as UP.
               // Rotating by -90 deg on X maps Scene Y to STL Z.
               stlWorldGroup.rotation.x = -Math.PI / 2;
           }
           
           object.updateWorldMatrix(true, false);
           object.traverse((child) => {
               if ((child as THREE.Mesh).isMesh) {
                   const m = child as THREE.Mesh;
                   if (m.material && (m.material as any).type === 'LineBasicMaterial') return;
                   if (!m.userData || !m.userData.isSolid) return;
                   
                   const clone = new THREE.Mesh(m.geometry, m.material);
                   m.updateWorldMatrix(true, false);
                   clone.matrixAutoUpdate = false;
                   clone.matrix.copy(m.matrixWorld);
                   stlWorldGroup.add(clone);
               }
           });
           
           scene.add(stlWorldGroup);
           stlWorldGroup.updateMatrixWorld(true);

           const exporter = new STLExporter();
           const stlString = exporter.parse(stlWorldGroup);
           
           scene.remove(stlWorldGroup);

           const blob = new Blob([stlString], { type: 'text/plain' });
           const url = URL.createObjectURL(blob);
           const link = document.createElement('a');
           link.style.display = 'none';
           link.href = url;
           link.download = isLathe ? `${name}_lathe.stl` : `${name}.stl`;
           document.body.appendChild(link);
           link.click();
           document.body.removeChild(link);
           URL.revokeObjectURL(url);
         } catch (err) {
           console.error("STL Export Error:", err);
         }
       }
     };
     
     const handleNormalExport = (e: any) => handleExport(e, false);
     const handleLatheExport = (e: any) => handleExport(e, true);
     
     window.addEventListener('export-stl', handleNormalExport as any);
     window.addEventListener('export-stl-lathe', handleLatheExport as any);
     return () => {
         window.removeEventListener('export-stl', handleNormalExport as any);
         window.removeEventListener('export-stl-lathe', handleLatheExport as any);
     };
   }, [scene]);
   return null;
};

export const Preview3D: React.FC = () => {
  const { settings, updateSettings, model, geometry3D, selectedObjectIds, setSelectedObjectIds, addObject, updateObjectLive, removeObject, updateFeature, removeFeature, removeBody, removeSketch } = useSettings();
  const newestFeatureRef = React.useRef<THREE.Group>(null);

  const [isDrawing, setIsDrawing] = React.useState(false);
  const [currentShapeId, setCurrentShapeId] = React.useState<string | null>(null);
  const [orbitEnabled, setOrbitEnabled] = React.useState(true);

  const [cursorPlanePosition, setCursorPlanePosition] = React.useState<THREE.Vector3>(new THREE.Vector3());
  const [currentSnap, setCurrentSnap] = React.useState<any>(null);
  const activeBodyNode = React.useRef<THREE.Group>(null);

  React.useEffect(() => {
    if (isDrawing && currentShapeId) {
      const shape = model.objects.find(o => o.id === currentShapeId);
      if (shape && shape.type !== settings.activeTool) {
        setIsDrawing(false);
        setCurrentShapeId(null);
        removeObject(currentShapeId);
      }
    }
  }, [settings.activeTool, isDrawing, currentShapeId, model.objects, removeObject]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent deleting if the user is typing in an input or textarea (like renaming a sketch in the sidebar)
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedObjectIds.length > 0) {
          e.preventDefault();
          selectedObjectIds.forEach(id => {
            if (model.features?.some(f => f.id === id)) {
              removeFeature(id);
            } else if (model.objects.some(o => o.id === id)) {
              removeObject(id);
            } else if (model.bodies?.some(b => b.id === id)) {
              removeBody(id);
            } else if (model.sketches.some(s => s.id === id)) {
              removeSketch(id);
            }
          });
          setSelectedObjectIds([]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedObjectIds, model, removeObject, removeFeature, removeBody, removeSketch, setSelectedObjectIds]);

  const handleObjClick = (e: any, objId: string) => {
    e.stopPropagation();
    
    if (settings.activeTool === 'select-axis') {
      const selectedFeatureId = selectedObjectIds.find(id => model.features?.some(f => f.id === id && f.type === 'revolve'));
      if (selectedFeatureId) {
        updateFeature(selectedFeatureId, { customAxisLineId: objId });
        updateSettings({ activeTool: 'select' });
      } else {
        updateSettings({ activeTool: 'select' });
      }
      return;
    }

    if (e.shiftKey) {
      if (selectedObjectIds.includes(objId)) {
        setSelectedObjectIds(selectedObjectIds.filter(id => id !== objId));
      } else {
        setSelectedObjectIds([...selectedObjectIds, objId]);
      }
    } else {
      setSelectedObjectIds([objId]);
    }
  };

  const handlePointerMissed = (e: any) => {
    if (e.type === 'click' && !e.shiftKey) {
      setSelectedObjectIds([]);
    }
  };

  const renderShape = (obj: any) => {
    const sketch = model.sketches.find(s => s.id === obj.sketchId);
    const body = model.bodies?.find(b => b.id === obj.bodyId);

    if (obj.visible === false || (sketch && sketch.visible === false) || (body && body.visible === false)) {
      return null;
    }

    const bodyPos = body?.position || [0, 0, 0];
    const bodyRot = body?.rotation || [0, 0, 0];
    const sketchPos = sketch?.position || [0, 0, 0];
    const sketchRot = sketch?.rotation || [0, 0, 0];

    const isSelected = selectedObjectIds.includes(obj.id);
    const highlightColor = "#4EDE93";
    const defaultColor = "#ADC6FF";

    // Combine coordinate systems. We map 2D point [x, y] to 3D point [x, 0, -y] natively
    // scaled by 0.1 to match existing viewport projection matrices implicitly.
    if (obj.type === 'rectangle') {
      const p1 = obj.points[0];
      const p2 = obj.points[2] || obj.points[1] || p1;
      
      const top = -p1.y / 10;
      const bottom = -p2.y / 10;
      const left = p1.x / 10;
      const right = p2.x / 10;
      const pts = [
        new THREE.Vector3(left, 0, top),
        new THREE.Vector3(right, 0, top),
        new THREE.Vector3(right, 0, bottom),
        new THREE.Vector3(left, 0, bottom),
        new THREE.Vector3(left, 0, top)
      ];

      return (
        <group key={obj.id} position={bodyPos} rotation={bodyRot}>
          <group position={sketchPos} rotation={sketchRot}>
            <Line
              points={pts}
              color={isSelected ? highlightColor : defaultColor}
              lineWidth={isSelected ? 3 : 2}
              onClick={(e) => handleObjClick(e, obj.id)}
            />
          </group>
        </group>
      );
    }

    if (obj.type === 'circle') {
      if (!obj.points || obj.points.length < 2 || !obj.points[0] || !obj.points[1]) return null;
      const radius = Math.sqrt(
        Math.pow(obj.points[1].x - obj.points[0].x, 2) +
        Math.pow(obj.points[1].y - obj.points[0].y, 2)
      ) / 10;
      const cx = obj.points[0].x / 10;
      const cy = -obj.points[0].y / 10;

      const pts = [];
      const segments = 64;
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        pts.push(new THREE.Vector3(cx + Math.cos(theta) * radius, 0, cy + Math.sin(theta) * radius));
      }

      return (
        <group key={obj.id} position={bodyPos} rotation={bodyRot}>
          <group position={sketchPos} rotation={sketchRot}>
            <Line
              points={pts}
              color={isSelected ? highlightColor : defaultColor}
              lineWidth={isSelected ? 3 : 2}
              onClick={(e) => handleObjClick(e, obj.id)}
            />
          </group>
        </group>
      );
    }

    if (obj.type === 'arc') {
      const center = obj.points[0];
      const start = obj.points[1];
      const end = obj.points[2];
      
      const radius = Math.hypot(start.x - center.x, start.y - center.y) / 10;
      
      const startRad = Math.atan2(start.y - center.y, start.x - center.x);
      const endRad = Math.atan2(end.y - center.y, end.x - center.x);
      
      let sweepAngle = obj.metadata?.ccwSweep;
      if (sweepAngle === undefined) {
         sweepAngle = endRad - startRad;
         while (sweepAngle <= -Math.PI) sweepAngle += Math.PI * 2;
         while (sweepAngle > Math.PI) sweepAngle -= Math.PI * 2;
      }

      const pts = [];
      const segments = Math.max(12, Math.floor(64 * Math.abs(sweepAngle) / (Math.PI * 2)));
      for (let i = 0; i <= segments; i++) {
        const theta = startRad + (i / segments) * sweepAngle;
        const x2d = center.x + Math.cos(theta) * radius * 10;
        const y2d = center.y + Math.sin(theta) * radius * 10;
        pts.push(new THREE.Vector3(x2d / 10, 0, -y2d / 10));
      }

      return (
        <group key={obj.id} position={bodyPos} rotation={bodyRot}>
          <group position={sketchPos} rotation={sketchRot}>
            <Line
              points={pts}
              color={isSelected ? highlightColor : defaultColor}
              lineWidth={isSelected ? 3 : 2}
              onClick={(e) => handleObjClick(e, obj.id)}
            />
          </group>
        </group>
      );
    }

    if (obj.type === 'spline') {
      const hasOCCTCurve = obj.metadata?.curvePoints && obj.metadata.curvePoints.length > 0;
      const primaryPoints = hasOCCTCurve ? obj.metadata.curvePoints : obj.points;

      if (!primaryPoints || primaryPoints.length < 2) return null;

      const pts = primaryPoints.map((p: any) => new THREE.Vector3(p.x / 10, 0, -p.y / 10));

      return (
        <group key={obj.id} position={bodyPos} rotation={bodyRot}>
          <group position={sketchPos} rotation={sketchRot}>
            <Line
              points={pts}
              color={isSelected ? highlightColor : defaultColor}
              lineWidth={isSelected ? 3 : 2}
              onClick={(e) => handleObjClick(e, obj.id)}
            />
          </group>
        </group>
      );
    }

    if (obj.type === 'ellipse') {
      if (obj.points.length < 2) return null;
      const p0 = obj.points[0];
      const p1 = obj.points[1];
      
      const cx = p0.x / 10;
      const cy = -p0.y / 10;
      const rx = Math.hypot(p1.x - p0.x, p1.y - p0.y) / 10;
      let ry = rx;
      
      if (obj.points.length >= 3) {
         const pMinor = obj.points.length >= 5 ? obj.points[3] : obj.points[2];
         const dx = p1.x - p0.x;
         const dy = p1.y - p0.y;
         const len = Math.hypot(dx, dy);
         if (len > 0) {
             const nx = -dy / len;
             const ny = dx / len;
             const vMinorX = pMinor.x - p0.x;
             const vMinorY = pMinor.y - p0.y;
             ry = Math.abs(vMinorX * nx + vMinorY * ny) / 10;
         }
      }
      
      const rot = Math.atan2(-p1.y - (-p0.y), p1.x - p0.x);

      const pts = [];
      const segments = 64;
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const lx = rx * Math.cos(theta);
        const ly = ry * Math.sin(theta);
        const px = cx + lx * Math.cos(rot) - ly * Math.sin(rot);
        const py = cy + lx * Math.sin(rot) + ly * Math.cos(rot);
        pts.push(new THREE.Vector3(px, 0, py));
      }

      return (
        <group key={obj.id} position={bodyPos} rotation={bodyRot}>
          <group position={sketchPos} rotation={sketchRot}>
            <Line
               points={pts}
               color={isSelected ? highlightColor : defaultColor}
               lineWidth={isSelected ? 3 : 2}
               onClick={(e) => handleObjClick(e, obj.id)}
            />
          </group>
        </group>
      );
    }

    if (obj.type === 'line') {
      if (!obj.points || obj.points.length < 2 || !obj.points[0] || !obj.points[1]) return null;
      const p1 = new THREE.Vector3(obj.points[0].x / 10, 0, -obj.points[0].y / 10);
      const p2 = new THREE.Vector3(obj.points[1].x / 10, 0, -obj.points[1].y / 10);

      return (
        <group key={obj.id} position={bodyPos} rotation={bodyRot}>
          <group position={sketchPos} rotation={sketchRot}>
            <Line
              points={[p1, p2]}
              color={isSelected ? highlightColor : defaultColor}
              lineWidth={isSelected ? 3 : 2}
              onClick={(e) => handleObjClick(e, obj.id)}
            />
          </group>
        </group>
      );
    }

    if (obj.type === 'box3d') {
      if (!obj.points || obj.points.length < 1 || !obj.points[0]) return null;
      const { dx, dy, dz } = obj.metadata || { dx: 10, dy: 10, dz: 10 };
      const centerX = obj.points[0].x / 10;
      const centerY = obj.points[0].y / 10;
      return (
        <group key={obj.id} position={bodyPos} rotation={bodyRot}>
          <mesh
            position={[centerX, dz / 20, -centerY]}
            onClick={(e) => handleObjClick(e, obj.id)}
            userData={{ isSolid: true }}
          >
            <boxGeometry args={[dx / 10, dz / 10, dy / 10]} />
            <meshStandardMaterial color={isSelected ? highlightColor : (obj.color || "#00ffff")} />
          </mesh>
        </group>
      );
    }

    if (obj.type === 'cylinder3d') {
      if (!obj.points || obj.points.length < 1 || !obj.points[0]) return null;
      const { radius, height } = obj.metadata || { radius: 5, height: 10 };
      const centerX = obj.points[0].x / 10;
      const centerY = obj.points[0].y / 10;
      return (
        <group key={obj.id} position={bodyPos} rotation={bodyRot}>
          <mesh
            position={[centerX, height / 20, -centerY]}
            onClick={(e) => handleObjClick(e, obj.id)}
            userData={{ isSolid: true }}
          >
            <cylinderGeometry args={[radius / 10, radius / 10, height / 10, 32]} />
            <meshStandardMaterial color={isSelected ? highlightColor : (obj.color || "#00ffff")} />
          </mesh>
        </group>
      );
    }

    if (obj.type === 'sphere3d') {
      if (!obj.points || obj.points.length < 1 || !obj.points[0]) return null;
      const { radius } = obj.metadata || { radius: 5 };
      const centerX = obj.points[0].x / 10;
      const centerY = obj.points[0].y / 10;
      return (
        <group key={obj.id} position={bodyPos} rotation={bodyRot}>
          <mesh
            position={[centerX, radius / 10, -centerY]}
            onClick={(e) => handleObjClick(e, obj.id)}
            userData={{ isSolid: true }}
          >
            <sphereGeometry args={[radius / 10, 32, 32]} />
            <meshStandardMaterial color={isSelected ? highlightColor : (obj.color || "#00ffff")} />
          </mesh>
        </group>
      );
    }

    if (obj.type === 'cone3d') {
      if (!obj.points || obj.points.length < 1 || !obj.points[0]) return null;
      const { radius1, radius2, height } = obj.metadata || { radius1: 5, radius2: 0, height: 10 };
      const centerX = obj.points[0].x / 10;
      const centerY = obj.points[0].y / 10;
      return (
        <group key={obj.id} position={bodyPos} rotation={bodyRot}>
          <mesh
            position={[centerX, height / 20, -centerY]}
            onClick={(e) => handleObjClick(e, obj.id)}
            userData={{ isSolid: true }}
          >
            <coneGeometry args={[radius1 / 10, height / 10, 32]} />
            <meshStandardMaterial color={isSelected ? highlightColor : (obj.color || "#00ffff")} />
          </mesh>
        </group>
      );
    }

    return null;
  };

  return (
    <div className="flex-1 bg-[#0B1326]">
      <Canvas
        camera={{ position: [20, 20, 20], fov: 50, near: 0.01, far: 100000 }}
        onPointerMissed={handlePointerMissed}
        shadows
      >
        <STLExportListener />
        <ambientLight intensity={0.6} color="#ffffff" />
        <directionalLight position={[10, 20, 10]} intensity={1.5} castShadow shadow-mapSize={[2048, 2048]} />
        <Environment preset="city" />
        <ContactShadows position={[0, -0.01, 0]} opacity={0.4} scale={50} blur={2} />
        {settings.showGrid && (
          <Grid
            infiniteGrid
            fadeDistance={5000}
            sectionSize={(settings.gridSize / 10) * 5}
            cellSize={settings.gridSize / 10}
            sectionColor="#4A6588"
            cellColor="#2A3C56"
          />
        )}
        <OrbitControls makeDefault enabled={orbitEnabled} />


        {/* Modern Compact Origin Marker */}
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <mesh>
            <sphereGeometry args={[0.2, 16, 16]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.9} />
          </mesh>
          <Line points={[[0, 0, 0], [3, 0, 0]]} color="#ef4444" lineWidth={4} transparent opacity={0.9} />
          <Line points={[[0, 0, 0], [0, 3, 0]]} color="#22c55e" lineWidth={4} transparent opacity={0.9} />
          <Line points={[[0, 0, 0], [0, 0, 3]]} color="#3b82f6" lineWidth={4} transparent opacity={0.9} />
        </group>

        <group ref={activeBodyNode}>
          <mesh
            visible={false}
            rotation={[-Math.PI / 2, 0, 0]}
            onPointerDown={(e) => {
              if (settings.activeTool === 'select') return;
              e.stopPropagation();

              const worldPt = e.point.clone();
              const localPt = activeBodyNode.current ? activeBodyNode.current.worldToLocal(worldPt) : worldPt;
              const point2D = { x: localPt.x * 10, y: -localPt.z * 10 };
              const snap = calculateSnap(point2D, model, settings.snapConfig, settings.snapThreshold, settings.gridSize, undefined, settings.showOrigin !== false);
              const pt = snap.point;

              if (settings.activeTool === 'line' || settings.activeTool === 'rectangle' || settings.activeTool === 'circle') {
                if (!isDrawing) {
                  const newId = Date.now().toString();
                  let initialPoints = [pt, pt];
                  if (settings.activeTool === 'rectangle') {
                    initialPoints = [pt, pt, pt, pt];
                  }
                  const newShape: any = {
                    id: newId,
                    name: `${settings.activeTool.charAt(0).toUpperCase() + settings.activeTool.slice(1)} ${model.objects.filter((o: any) => o.type === settings.activeTool).length + 1}`,
                    type: settings.activeTool,
                    points: initialPoints,
                    closed: false,
                    visible: true,
                    constraints: [],
                    sketchId: model.activeSketchId,
                    bodyId: model.activeBodyId,
                    color: settings.activeTool === 'rectangle' ? '#a5b4fc' : undefined
                  };
                  addObject(newShape);
                  setIsDrawing(true);
                  setCurrentShapeId(newId);
                } else if (currentShapeId) {
                  setIsDrawing(false);
                  setCurrentShapeId(null);
                  if (settings.activeTool !== 'line') {
                    updateSettings({ activeTool: 'select' });
                  }
                }
              }
            }}
            onPointerMove={(e) => {
              if (settings.activeTool !== 'select') {
                e.stopPropagation();
                const worldPt = e.point.clone();
                const localPt = activeBodyNode.current ? activeBodyNode.current.worldToLocal(worldPt) : worldPt;

                // Invert mapping: 3D [x, y, z] -> 2D [x * 10, -z * 10]
                const point2D = { x: localPt.x * 10, y: -localPt.z * 10 };
                const snapResult = calculateSnap(point2D, model, settings.snapConfig, settings.snapThreshold, settings.gridSize, undefined, settings.showOrigin !== false);

                // Map snapped 2D point back to 3D local vector
                const snappedLocalPt = new THREE.Vector3(snapResult.point.x / 10, 0, -snapResult.point.y / 10);
                setCursorPlanePosition(snappedLocalPt);
                setCurrentSnap(snapResult);

                if (isDrawing && currentShapeId) {
                  const shape = model.objects.find(o => o.id === currentShapeId);
                  if (shape) {
                    const p1 = shape.points[0];
                    if (settings.activeTool === 'line' || settings.activeTool === 'circle') {
                      updateObjectLive(currentShapeId, { points: [p1, snapResult.point] });
                    } else if (settings.activeTool === 'rectangle') {
                      updateObjectLive(currentShapeId, {
                        points: [
                          p1,
                          { x: snapResult.point.x, y: p1.y },
                          snapResult.point,
                          { x: p1.x, y: snapResult.point.y }
                        ]
                      });
                    }
                  }
                }
              }
            }}
          >
            <planeGeometry args={[10000, 10000]} />
          </mesh>
          {/* Dynamic Cursor Marker */}
          {settings.activeTool !== 'select' && (
            <SnapMarker3D snap={currentSnap} position={cursorPlanePosition} />
          )}
        </group>

        {model.objects.map(renderShape)}

        <Bounds margin={2.5} maxDuration={0.0001}>
        <AutofitTrigger model={model} targetRef={newestFeatureRef} />
        {/* Dynamic Parameterized Feature Renderer */}
        {model.features?.map(feature => {
          if (!feature.visible || (feature.type !== 'extrude' && feature.type !== 'revolve')) return null;
          
          const sketchObjects = model.objects.filter(o => o.sketchId === feature.sketchId && !o.construction);
          if (sketchObjects.length === 0) return null;
          
          let shape = new THREE.Shape();
          const first = sketchObjects[0];

          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

          const updateBounds = (p: any) => {
             if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
             if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
          };

          if (first.type === 'rectangle' && first.points.length >= 2) {
             const p1 = first.points[0]; const p2 = first.points[2] || first.points[1];
             const x1 = p1.x / 10; const x2 = p2.x / 10;
             const y1 = -p1.y / 10; const y2 = -p2.y / 10;
             shape.moveTo(x1, y1); shape.lineTo(x2, y1); shape.lineTo(x2, y2); shape.lineTo(x1, y2); shape.lineTo(x1, y1);
             updateBounds(first.points[0]); updateBounds(p2);
          } else if (first.type === 'circle' && first.points.length >= 2) {
             const radius = Math.hypot(first.points[1].x - first.points[0].x, first.points[1].y - first.points[0].y) / 10;
             shape.absarc(first.points[0].x / 10, -first.points[0].y / 10, radius, 0, Math.PI * 2, false);
             updateBounds({x: first.points[0].x - radius*10, y: first.points[0].y - radius*10});
             updateBounds({x: first.points[0].x + radius*10, y: first.points[0].y + radius*10});
          } else {
             const segments: {obj: any, start: any, end: any, flipped: boolean}[] = [];
             sketchObjects.forEach(obj => {
               if (obj.type === 'line' && obj.points.length >= 2) {
                 segments.push({ obj, start: obj.points[0], end: obj.points[1], flipped: false });
               } else if (obj.type === 'arc' && obj.points.length >= 3) {
                 segments.push({ obj, start: obj.points[1], end: obj.points[2], flipped: false });
               } else if (obj.type === 'spline') {
                 const pts = (obj.metadata?.curvePoints && obj.metadata.curvePoints.length > 0) ? obj.metadata.curvePoints : obj.points;
                 if (pts && pts.length >= 2) {
                    segments.push({ obj, start: pts[0], end: pts[pts.length - 1], flipped: false });
                 }
               }
             });

             if (segments.length > 0) {
               const sorted: typeof segments = [];
               const unvisited = [...segments];

               let current = unvisited.shift()!;
               sorted.push(current);

               while (unvisited.length > 0) {
                 const lastPoint = current.flipped ? current.start : current.end;
                 let nextIdx = -1;
                 let needsFlip = false;

                 for (let i = 0; i < unvisited.length; i++) {
                   const cand = unvisited[i];
                   const pIdMatch = cand.start.id && lastPoint.id && cand.start.id === lastPoint.id;
                   const pDistMatch = Math.hypot(cand.start.x - lastPoint.x, cand.start.y - lastPoint.y) < 0.1;
                   if (pIdMatch || pDistMatch) {
                     nextIdx = i;
                     needsFlip = false;
                     break;
                   }
                   
                   const pIdRevMatch = cand.end.id && lastPoint.id && cand.end.id === lastPoint.id;
                   const pDistRevMatch = Math.hypot(cand.end.x - lastPoint.x, cand.end.y - lastPoint.y) < 0.1;
                   if (pIdRevMatch || pDistRevMatch) {
                     nextIdx = i;
                     needsFlip = true;
                     break;
                   }
                 }

                 if (nextIdx !== -1) {
                   const nextSeq = unvisited.splice(nextIdx, 1)[0];
                   nextSeq.flipped = needsFlip;
                   sorted.push(nextSeq);
                   current = nextSeq;
                 } else {
                   current = unvisited.shift()!;
                   sorted.push(current);
                 }
               }

               let isDrawingPath = false;
               let lastDrawnPoint = { x: Infinity, y: Infinity };

               sorted.forEach((seg) => {
                  const drawStart = seg.flipped ? seg.end : seg.start;
                  const drawEnd = seg.flipped ? seg.start : seg.end;
                  
                  if (!isDrawingPath || Math.hypot(lastDrawnPoint.x - drawStart.x, lastDrawnPoint.y - drawStart.y) > 0.1) {
                    shape.moveTo(drawStart.x / 10, -drawStart.y / 10);
                    isDrawingPath = true;
                  }

                  if (seg.obj.type === 'line') {
                    shape.lineTo(drawEnd.x / 10, -drawEnd.y / 10);
                    updateBounds(drawStart); updateBounds(drawEnd);
                  } else if (seg.obj.type === 'arc') {
                    const center = seg.obj.points[0];
                    const startPt = seg.obj.points[1];
                    const endPt = seg.obj.points[2];
                    const radius = Math.hypot(startPt.x - center.x, startPt.y - center.y) / 10;
                    const startRad = Math.atan2(startPt.y - center.y, startPt.x - center.x);
                    const endRad = Math.atan2(endPt.y - center.y, endPt.x - center.x);
                    
                    let ccw = seg.obj.metadata?.ccwSweep !== undefined ? seg.obj.metadata.ccwSweep > 0 : null;
                    if (ccw === null) {
                      let sweep = endRad - startRad;
                      while (sweep <= -Math.PI) sweep += Math.PI * 2;
                      while (sweep > Math.PI) sweep -= Math.PI * 2;
                      ccw = sweep > 0;
                    }

                    const drawCCW = seg.flipped ? !ccw : ccw;
                    const arcStartRad = seg.flipped ? endRad : startRad;
                    const arcEndRad = seg.flipped ? startRad : endRad;

                    shape.absarc(
                      center.x / 10, 
                      -center.y / 10, 
                      radius, 
                      -arcStartRad, 
                      -arcEndRad, 
                      drawCCW
                    );
                    
                    updateBounds(center); updateBounds(startPt); updateBounds(endPt);
                  } else if (seg.obj.type === 'spline') {
                    const pts = (seg.obj.metadata?.curvePoints && seg.obj.metadata.curvePoints.length > 0) ? seg.obj.metadata.curvePoints : seg.obj.points;
                    const iterPts = seg.flipped ? [...pts].reverse() : pts;
                    
                    for (let j = 0; j < iterPts.length; j++) {
                      const p = iterPts[j];
                      if (j > 0 || Math.hypot(p.x - drawStart.x, p.y - drawStart.y) > 0.1) {
                         shape.lineTo(p.x / 10, -p.y / 10);
                      }
                      updateBounds(p);
                    }
                  }
                  
                  lastDrawnPoint = drawEnd;
               });
             }
          }

          const centroidX = minX !== Infinity ? (minX + maxX) / 2 / 10 : 0;
          const centroidY = minY !== Infinity ? -(minY + maxY) / 2 / 10 : 0;

          const isSelected = selectedObjectIds.includes(feature.id);
          const drawColor = isSelected ? '#4EDE93' : '#4A6588';

          const handleClick = (e: any) => {
            e.stopPropagation();
            if (e.shiftKey) {
              setSelectedObjectIds(prev => prev.includes(feature.id) ? prev.filter(id => id !== feature.id) : [...prev, feature.id]);
            } else {
              setSelectedObjectIds([feature.id]);
            }
          };

          const depthScale = feature.depth / 10 || 0.1;
          const zOffset = feature.symmetric ? -depthScale / 2 : 0;
          const flipScale = feature.reverse ? 1 : -1;
          const finalZOffset = zOffset * flipScale;
          const userOpacity = feature.opacity !== undefined ? feature.opacity : 1.0;
          const isTransparent = userOpacity < 1.0;

          const isNewest = feature.id === model.features[model.features.length - 1]?.id;
          
          if (feature.type === 'extrude') {
             return (
               <group ref={isNewest ? newestFeatureRef : null} key={feature.id} position={[0, -finalZOffset, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, flipScale]}>
                 <mesh name={`feature-mesh-${feature.id}`} userData={{ isSolid: true }} onClick={handleClick} castShadow receiveShadow>
                   <extrudeGeometry key={`${feature.id}-${depthScale}-${feature.symmetric}`} args={[shape, { depth: depthScale, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 32 }]} />
                   <meshStandardMaterial 
                      color={drawColor} 
                      transparent={isTransparent} 
                      opacity={isSelected && !isTransparent ? 0.9 : userOpacity} 
                      side={THREE.DoubleSide} 
                      roughness={0.7} 
                      metalness={0.1}
                   />
                   <Edges scale={1} threshold={15} color={isSelected ? '#ffffff' : '#1e293b'} />
                 </mesh>
                 
                 {isSelected && (
                    <ExtrudeGizmo 
                       feature={feature} 
                       updateFeature={updateFeature} 
                       centroidX={centroidX} 
                       centroidY={centroidY} 
                       depthScale={depthScale} 
                       setOrbitEnabled={setOrbitEnabled} 
                    />
                 )}
               </group>
             );
          } else if (feature.type === 'revolve') {
             const revAngle = (feature.angle || 360) * (Math.PI / 180);
             let lathePoints: THREE.Vector2[] = [];
             
             // Extract 2D points from shape
             const shapeShape = shape.extractPoints(12).shape;
             
             // Base points are natively relative to Sketch X/Y
             const axis = feature.axis || 'Y';
             
             if (axis === 'Y') {
                lathePoints = shapeShape.map(p => new THREE.Vector2(p.x, p.y));
             } else if (axis === 'X') {
                lathePoints = shapeShape.map(p => new THREE.Vector2(p.y, -p.x));
             } else if (axis === 'Custom' && feature.customAxisLineId) {
                // Find custom line natively
                const customLine = model.objects.find(o => o.id === feature.customAxisLineId && o.type === 'line');
                if (customLine && customLine.points.length >= 2) {
                   const p1 = customLine.points[0];
                   const p2 = customLine.points[1];
                   const dx = (p2.x - p1.x) / 10;
                   const dy = (p2.y - p1.y) / 10;
                   const customAngle = Math.atan2(dy, dx);
                   const cx = p1.x / 10;
                   const cy = -p1.y / 10;
                   
                   // Translate to origin, rotate inverse to align with Y, use as Lathe points
                   lathePoints = shapeShape.map(p => {
                       const translatedX = p.x - cx;
                       const translatedY = p.y - cy;
                       // Rotate by (-customAngle + 90deg) to align custom line with Y axis
                       const rot = -customAngle + Math.PI/2;
                       const rotX = translatedX * Math.cos(rot) - translatedY * Math.sin(rot);
                       const rotY = translatedX * Math.sin(rot) + translatedY * Math.cos(rot);
                       return new THREE.Vector2(rotX, rotY);
                   });
                } else {
                   // Fallback
                   lathePoints = shapeShape.map(p => new THREE.Vector2(p.x, p.y));
                }
             } else {
                lathePoints = shapeShape.map(p => new THREE.Vector2(p.x, p.y));
             }
             
             // To ensure a closed volume visually, ensure endpoints match loosely
             if (lathePoints.length > 0) {
                 const firstP = lathePoints[0];
                 const hoverP = lathePoints[lathePoints.length - 1];
                 if (Math.hypot(firstP.x - hoverP.x, firstP.y - hoverP.y) > 0.01) {
                     lathePoints.push(new THREE.Vector2(firstP.x, firstP.y));
                 }
             }

             return (
               <group ref={isNewest ? newestFeatureRef : null} key={feature.id} rotation={[Math.PI / 2, 0, 0]}>
                 {/* Reorient group if Custom or X to counteract local rotational transformations */}
                 <group 
                   rotation={
                     axis === 'X' ? [0, 0, Math.PI / 2] : 
                     (axis === 'Custom' && feature.customAxisLineId) ? 
                        (() => {
                           const cl = model.objects.find(o => o.id === feature.customAxisLineId);
                           if (cl && cl.points && cl.points.length >= 2) {
                              const dx = (cl.points[1].x - cl.points[0].x) / 10;
                              const dy = (cl.points[1].y - cl.points[0].y) / 10;
                              return [0, 0, Math.atan2(dy, dx) - Math.PI / 2];
                           }
                           return [0,0,0] as [number, number, number];
                        })() : [0, 0, 0]
                   }
                   position={
                     (axis === 'Custom' && feature.customAxisLineId) ? 
                        (() => {
                           const cl = model.objects.find(o => o.id === feature.customAxisLineId);
                           if (cl && cl.points && cl.points.length >= 1) return [cl.points[0].x / 10, -cl.points[0].y / 10, 0] as [number, number, number];
                           return [0,0,0] as [number, number, number];
                        })() : [0, 0, 0]
                   }
                 >
                   <group name={`feature-mesh-${feature.id}`}>
                     <mesh userData={{ isSolid: true }} onClick={handleClick} castShadow receiveShadow>
                       <latheGeometry args={[lathePoints, Math.max(16, Math.floor(revAngle * 10)), 0, revAngle]} />
                       <meshStandardMaterial 
                          color={drawColor} 
                          transparent={isTransparent} 
                          opacity={isSelected && !isTransparent ? 0.9 : userOpacity} 
                          side={THREE.DoubleSide} 
                          roughness={0.7} 
                          metalness={0.1} 
                       />
                       <Edges scale={1} threshold={15} color={isSelected ? '#ffffff' : '#1e293b'} />
                     </mesh>
                     {revAngle < Math.PI * 1.99 && (
                         <>
                           <mesh userData={{ isSolid: true }}>
                             <shapeGeometry args={[shape]} />
                             <meshStandardMaterial color={drawColor} transparent={isTransparent} opacity={isSelected && !isTransparent ? 0.9 : userOpacity} side={THREE.DoubleSide} roughness={0.7} metalness={0.1} />
                             <Edges scale={1} threshold={15} color={isSelected ? '#ffffff' : '#1e293b'} />
                           </mesh>
                           <group rotation={[0, revAngle, 0]}>
                             <mesh userData={{ isSolid: true }}>
                               <shapeGeometry args={[shape]} />
                               <meshStandardMaterial color={drawColor} transparent={isTransparent} opacity={isSelected && !isTransparent ? 0.9 : userOpacity} side={THREE.DoubleSide} roughness={0.7} metalness={0.1} />
                               <Edges scale={1} threshold={15} color={isSelected ? '#ffffff' : '#1e293b'} />
                             </mesh>
                           </group>
                         </>
                       )}
                       {isSelected && (
                         <RevolveGizmo 
                           feature={feature} 
                           updateFeature={updateFeature} 
                           setOrbitEnabled={setOrbitEnabled} 
                         />
                       )}
                   </group>
                 </group>
               </group>
             );
          }
        })}
        </Bounds>

        {geometry3D.map((geo) => {
          const isSelected = selectedObjectIds.includes(geo.id);
          const drawColor = isSelected ? '#4EDE93' : (geo.color || '#00ffff');

          const handleClick = (e: any) => {
             e.stopPropagation();
             if (e.shiftKey) {
                setSelectedObjectIds(prev => prev.includes(geo.id) ? prev.filter(id => id !== geo.id) : [...prev, geo.id]);
             } else {
                setSelectedObjectIds([geo.id]);
             }
          };

          if (geo.type === 'box') {
            return (
              <mesh 
                key={geo.id} 
                position={geo.position || [0, 0, 0]} 
                rotation={geo.rotation || [0, 0, 0]}
                onClick={handleClick}
              >
                <boxGeometry args={geo.scale || [1, 1, 1]} />
                <meshStandardMaterial color={drawColor} transparent opacity={isSelected ? 0.9 : 0.8} />
                <Edges scale={1} threshold={15} color={isSelected ? '#ffffff' : '#111111'} />
              </mesh>
            );
          }
          if (geo.data) {
            return (
               <mesh key={geo.id} onClick={handleClick}>
                 <primitive object={geo.data} />
                 {isSelected && <meshStandardMaterial color={drawColor} transparent opacity={0.6} />}
               </mesh>
            );
          }
          return null;
        })}
      </Canvas>
    </div>
  );
};
