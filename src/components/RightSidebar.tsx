import React from 'react';
import { 
  ChevronRight, ChevronDown, Eye, Search, Filter, Box, History, MousePointer, Maximize, AlignCenter, Grid3X3, Pin, Pencil, Settings, Layers,
  Link2, Target, MoveHorizontal, MoveVertical, Equal, Hash, Zap, Anchor, Scissors, Plus, PlusSquare, Trash2, EyeOff, Brain, MessageSquare, X,
  Settings2, Circle, Square, MousePointer2, Move, Check, Ruler, CheckSquare, CornerUpLeft, CornerUpRight, TerminalSquare, Copy, CopyPlus, SquareDashedMousePointer, Axis3d, SplitSquareVertical, RefreshCw 
} from 'lucide-react';
import { cn, evaluateMath } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';
import { Sketch, CADFeature } from '../types';



export const RightSidebar: React.FC = () => {
  const { 
    settings, updateSettings, model, removeObject, updateObject, 
    addLayer, removeLayer, setActiveLayer,
    addSketch, removeSketch, updateSketch, setActiveSketch,
    addFeature, removeFeature, updateFeature,
    addBody, removeBody, updateBody, setActiveBody,
    addBox3D, addCylinder3D, addSphere3D, addCone3D,
    selectedObjectIds, setSelectedObjectIds,
    lastAIResponse, setLastAIResponse,
    addGeometry3D
  } = useSettings();

  const [contextMenu, setContextMenu] = React.useState<{ x: number, y: number, sketchId: string } | null>(null);

  React.useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const selectedObject = model.objects.find(o => selectedObjectIds.includes(o.id));
  const selectedFeature = model.features?.find(f => selectedObjectIds.includes(f.id));

  const handleExtrude = (sketchId: string) => {
    const sketchObjects = model.objects.filter(o => o.sketchId === sketchId && !o.construction);
    if (sketchObjects.length === 0) {
      console.warn("Extrude Failed: Sketch is empty.");
      return;
    }

    // Attempt to verify closed loop using a fast explicit check.
    // For rectangles/circles, it's inherently closed.
    // For connected lines/arcs, they must form a sequence where every start touches exactly one end.
    let isClosed = true;
    
    // Very basic topological perimeter heuristic matching node quantities.
    let looseEnds = 0;
    sketchObjects.forEach(obj => {
      if (obj.type === 'circle' || obj.type === 'rectangle' || obj.type === 'polygon' || obj.type === 'ellipse') {
        // Naturally closed
      } else if (obj.points.length >= 2) {
         // evaluate if endpoint binds exactly to another object endpoint
         const p1 = (obj.type === 'arc' && obj.points.length >= 3) ? obj.points[1] : obj.points[0];
         const p2 = obj.points[obj.points.length - 1];
         let p1Touches = false;
         let p2Touches = false;
         
         sketchObjects.forEach(other => {
           if (other.id === obj.id) return;
           const otherP1 = (other.type === 'arc' && other.points.length >= 3) ? other.points[1] : other.points[0];
           const otherP2 = other.points[other.points.length - 1];
           
           if (Math.hypot(p1.x - otherP1.x, p1.y - otherP1.y) < 0.1) p1Touches = true;
           if (Math.hypot(p1.x - otherP2.x, p1.y - otherP2.y) < 0.1) p1Touches = true;
           if (Math.hypot(p2.x - otherP1.x, p2.y - otherP1.y) < 0.1) p2Touches = true;
           if (Math.hypot(p2.x - otherP2.x, p2.y - otherP2.y) < 0.1) p2Touches = true;
         });
         
         if (!p1Touches) looseEnds++;
         if (!p2Touches) looseEnds++;
      }
    });

    if (looseEnds > 0) {
       const msg = `Extrude Failed: Sketch ${sketchId} contains an open loop with disconnected vertices. Ensure all geometry snaps to explicit endpoints.`;
       console.error(msg);
       alert(msg);
       return;
    }

    const featureId = 'feature-' + Date.now().toString();
    addFeature({
      id: featureId,
      type: 'extrude',
      name: `Extrude ${(model.features?.length || 0) + 1}`,
      bodyId: model.sketches.find(s => s.id === sketchId)?.bodyId || 'body-0',
      sketchId,
      depth: 10,
      symmetric: true,
      reverse: false,
      visible: true,
      isOpen: true
    });
    
    console.info(`Successfully generated parametric feature for Sketch ${sketchId}`);
    setContextMenu(null);
    updateSettings({ show3DPreview: true });
    setTimeout(() => {
      setSelectedObjectIds([featureId]);
    }, 10);
  };

  const handleRevolve = (sketchId: string) => {
    const sketchObjects = model.objects.filter(o => o.sketchId === sketchId && !o.construction);
    if (sketchObjects.length === 0) {
      console.warn("Revolve Failed: Sketch is empty.");
      return;
    }

    let looseEnds = 0;
    sketchObjects.forEach(obj => {
      if (obj.type === 'circle' || obj.type === 'rectangle' || obj.type === 'polygon' || obj.type === 'ellipse') {
      } else if (obj.points.length >= 2) {
         const p1 = (obj.type === 'arc' && obj.points.length >= 3) ? obj.points[1] : obj.points[0];
         const p2 = obj.points[obj.points.length - 1];
         let p1Touches = false;
         let p2Touches = false;
         
         sketchObjects.forEach(other => {
           if (other.id === obj.id) return;
           const otherP1 = (other.type === 'arc' && other.points.length >= 3) ? other.points[1] : other.points[0];
           const otherP2 = other.points[other.points.length - 1];
           
           if (Math.hypot(p1.x - otherP1.x, p1.y - otherP1.y) < 0.1) p1Touches = true;
           if (Math.hypot(p1.x - otherP2.x, p1.y - otherP2.y) < 0.1) p1Touches = true;
           if (Math.hypot(p2.x - otherP1.x, p2.y - otherP1.y) < 0.1) p2Touches = true;
           if (Math.hypot(p2.x - otherP2.x, p2.y - otherP2.y) < 0.1) p2Touches = true;
         });
         
         if (!p1Touches) looseEnds++;
         if (!p2Touches) looseEnds++;
      }
    });

    if (looseEnds > 0) {
       const msg = `Revolve Failed: Sketch ${sketchId} contains an open loop with disconnected vertices. Ensure all geometry snaps to explicit endpoints.`;
       console.error(msg);
       alert(msg);
       return;
    }

    const featureId = 'feature-' + Date.now().toString();
    addFeature({
      id: featureId,
      type: 'revolve',
      name: `Revolve ${(model.features?.length || 0) + 1}`,
      bodyId: model.sketches.find(s => s.id === sketchId)?.bodyId || 'body-0',
      sketchId,
      depth: 10,
      axis: 'X',
      angle: 360,
      symmetric: false,
      reverse: false,
      visible: true,
      isOpen: true
    });
    
    console.info(`Successfully generated Revolve feature for Sketch ${sketchId}`);
    setContextMenu(null);
    updateSettings({ show3DPreview: true });
    setTimeout(() => {
      setSelectedObjectIds([featureId]);
    }, 10);
  };

  const renderSketchNode = (sketch: Sketch, isConsumed: boolean = false) => {
    const sketchObjects = model.objects.filter(o => o.sketchId === sketch.id);
    const isActiveSketch = model.activeSketchId === sketch.id;

    return (
      <div key={sketch.id} className={cn("space-y-1", isConsumed && "pl-4 border-l border-white/10 ml-2")}>
        <div 
          className={cn(
            "flex items-center justify-between py-1 group cursor-pointer rounded-sm px-1",
            isActiveSketch ? "bg-primary/5" : "hover:bg-white/5"
          )}
          onClick={() => setActiveSketch(sketch.id)}
          onContextMenu={(e) => {
            if (isConsumed) return; // Disallow extruding an already consumed sketch
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, sketchId: sketch.id });
          }}
        >
          <div className="flex items-center gap-2">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                updateSketch(sketch.id, { isOpen: !sketch.isOpen });
              }}
              className="p-0.5 hover:bg-white/10 rounded-sm"
            >
              {sketch.isOpen ? <ChevronDown className="w-3 h-3 text-white/40" /> : <ChevronRight className="w-3 h-3 text-white/40" />}
            </button>
            <Pencil className={cn("w-3 h-3", isActiveSketch ? "text-secondary" : "text-white/40")} />
            <span 
              className={cn(isActiveSketch && "text-secondary font-bold")}
              onDoubleClick={() => {
                const newName = prompt('Rename Sketch', sketch.name);
                if (newName) updateSketch(sketch.id, { name: newName });
              }}
              title="Double click to rename"
            >
              {sketch.name} ({sketchObjects.length})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 mr-1">
              <button 
                disabled={isConsumed}
                onClick={(e) => { e.stopPropagation(); if (!isConsumed) handleExtrude(sketch.id); }}
                className={cn("text-[9px] px-1 py-0.5 rounded font-bold transition-colors", isConsumed ? "bg-white/5 text-white/20 cursor-not-allowed" : "bg-primary/20 hover:bg-primary/40 text-primary")}
                title={isConsumed ? "Sketch already consumed by a feature" : "Extrude this Sketch"}
              >EXT</button>
              <button 
                disabled={isConsumed}
                onClick={(e) => { e.stopPropagation(); if (!isConsumed) handleRevolve(sketch.id); }}
                className={cn("text-[9px] px-1 py-0.5 rounded font-bold transition-colors", isConsumed ? "bg-white/5 text-white/20 cursor-not-allowed" : "bg-secondary/20 hover:bg-secondary/40 text-secondary")}
                title={isConsumed ? "Sketch already consumed by a feature" : "Revolve this Sketch"}
              >REV</button>
            </div>
            
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100">
              <button onClick={(e) => {
                e.stopPropagation();
                updateSketch(sketch.id, { visible: !sketch.visible });
              }}>
                {sketch.visible ? <Eye className="w-3 h-3 text-white/40" /> : <EyeOff className="w-3 h-3 text-white/20" />}
              </button>
              {(model.sketches.length > 1 && !isConsumed) && (
                <button onClick={(e) => {
                  e.stopPropagation();
                  removeSketch(sketch.id);
                }}>
                  <Trash2 className="w-3 h-3 text-destructive/60 hover:text-destructive" />
                </button>
              )}
            </div>
          </div>
        </div>
        
        {sketch.isOpen && (
          <div className="pl-6 space-y-0.5">
            {sketchObjects.map((obj) => (
              <div 
                key={obj.id}
                onClick={() => setSelectedObjectIds([obj.id])}
                className={cn(
                  "flex items-center justify-between py-1.5 px-2 rounded-sm group cursor-pointer",
                  selectedObjectIds.includes(obj.id) ? "bg-primary/20 text-primary border border-primary/30" : "hover:bg-white/5 text-white/50"
                )}
              >
                <div className="flex items-center gap-2">
                  <Pencil className={cn("w-3 h-3", selectedObjectIds.includes(obj.id) ? "text-primary" : "text-white/30")} />
                  <span>{obj.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={(e) => {
                    e.stopPropagation();
                    updateObject(obj.id, { visible: !obj.visible });
                  }}>
                    <Eye className={cn("w-3 h-3", obj.visible ? "text-primary" : "opacity-20")} />
                  </button>
                  <button onClick={(e) => {
                    e.stopPropagation();
                    removeObject(obj.id);
                  }} className="opacity-0 group-hover:opacity-100 text-destructive hover:text-red-400">
                    <Scissors className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
            {sketchObjects.length === 0 && (
              <div className="py-2 text-[10px] text-white/20 italic pl-2">Empty Sketch</div>
            )}
          </div>
        )}
      </div>
    );
  };



  const handleAddBody = () => {
    addBody({
      id: 'body-' + Date.now().toString(),
      name: `Body ${(model.bodies?.length || 0) + 1}`,
      visible: true,
      locked: false,
      isOpen: true,
      position: [0, 0, 0],
      rotation: [0, 0, 0]
    });
  };

  const handleAddSketch = () => {
    addSketch({
      id: Date.now().toString(),
      name: `Sketch ${model.sketches.length + 1}`,
      visible: true,
      locked: false,
      isOpen: true,
      bodyId: model.activeBodyId || model.bodies[0]?.id || 'body-0',
      position: [0, 0, 0],
      rotation: [0, 0, 0]
    });
  };

  return (
    <>
    <div className="w-80 border-l border-border flex flex-col bg-neutral-bg overflow-hidden">
      {/* Model Tree */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        <div className="p-3 pb-2 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-white/60">Model Tree</span>
          <div className="flex gap-2">
            <Filter className="w-3.5 h-3.5 text-white/40 cursor-pointer hover:text-white" />
          </div>
        </div>
        
        <div className="px-3 pb-3 flex gap-2 border-b border-border">
          <button 
            onClick={handleAddBody} 
            className="flex-1 flex items-center justify-center gap-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-[10px] font-bold py-1.5 rounded-sm transition-colors uppercase tracking-wider"
          >
            <PlusSquare className="w-3.5 h-3.5" />
            New Body
          </button>
          <button 
            onClick={handleAddSketch} 
            className="flex-1 flex items-center justify-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/5 text-white/80 text-[10px] font-bold py-1.5 rounded-sm transition-colors uppercase tracking-wider"
          >
            <Plus className="w-3.5 h-3.5" />
            New Sketch
          </button>
        </div>

        <div className="px-3 pb-3 flex flex-wrap gap-2 border-b border-border mt-2">
          <button 
            onClick={() => addBox3D(10, 10, 10, { x: 0, y: 0 })}
            className="flex-1 min-w-[60px] flex flex-col items-center justify-center gap-1 bg-white/5 hover:bg-white/10 border border-white/5 text-white/60 text-[8px] font-bold py-1.5 rounded-sm transition-colors uppercase tracking-wider"
            title="Add 3D Box"
          >
            <Box className="w-3.5 h-3.5" />
            Box
          </button>
          <button 
            onClick={() => addCylinder3D(5, 10, { x: 0, y: 0 })}
            className="flex-1 min-w-[60px] flex flex-col items-center justify-center gap-1 bg-white/5 hover:bg-white/10 border border-white/5 text-white/60 text-[8px] font-bold py-1.5 rounded-sm transition-colors uppercase tracking-wider"
            title="Add 3D Cylinder"
          >
            <Axis3d className="w-3.5 h-3.5" />
            Cyl
          </button>
          <button 
            onClick={() => addSphere3D(5, { x: 0, y: 0 })}
            className="flex-1 min-w-[60px] flex flex-col items-center justify-center gap-1 bg-white/5 hover:bg-white/10 border border-white/5 text-white/60 text-[8px] font-bold py-1.5 rounded-sm transition-colors uppercase tracking-wider"
            title="Add 3D Sphere"
          >
            <Circle className="w-3.5 h-3.5" />
            Sph
          </button>
          <button 
            onClick={() => addCone3D(5, 0, 10, { x: 0, y: 0 })}
            className="flex-1 min-w-[60px] flex flex-col items-center justify-center gap-1 bg-white/5 hover:bg-white/10 border border-white/5 text-white/60 text-[8px] font-bold py-1.5 rounded-sm transition-colors uppercase tracking-wider"
            title="Add 3D Cone"
          >
            <PlusSquare className="w-3.5 h-3.5 rotate-45" />
            Cone
          </button>
        </div>
        
        <div className="p-3">


          <div className="space-y-1 text-[11px]">
            <div className="flex items-center gap-2 py-1 text-white/80">
              <ChevronDown className="w-3 h-3" />
              <span className="font-bold">PROJECT_ALPHA</span>
            </div>
            
            <div className="pl-4 space-y-2">
              {model.bodies?.map((body) => {
                const bodySketches = model.sketches.filter(s => s.bodyId === body.id);
                const bodyObjects = model.objects.filter(o => o.bodyId === body.id && !o.sketchId);
                const isActiveBody = model.activeBodyId === body.id;

                return (
                  <div key={body.id} className="space-y-1">
                    <div 
                      className={cn(
                        "flex items-center justify-between py-1 group cursor-pointer rounded-sm px-1",
                        isActiveBody ? "bg-primary/20 border-l-2 border-primary text-primary" : "hover:bg-white/5 text-white/80"
                      )}
                      onClick={() => setActiveBody(body.id)}
                    >
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            updateBody(body.id, { isOpen: !body.isOpen });
                          }}
                          className="p-0.5 hover:bg-white/10 rounded-sm"
                        >
                          {body.isOpen ? <ChevronDown className="w-3 h-3 text-white/40" /> : <ChevronRight className="w-3 h-3 text-white/40" />}
                        </button>
                        <Box className={cn("w-3 h-3", isActiveBody ? "text-primary" : "text-white/40")} />
                        <span 
                          className={cn("font-bold", isActiveBody && "text-primary")}
                          onDoubleClick={() => {
                            const newName = prompt('Rename Body', body.name);
                            if (newName) updateBody(body.id, { name: newName });
                          }}
                          title="Double click to rename"
                        >
                          {body.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100">
                        <button onClick={(e) => {
                          e.stopPropagation();
                          updateBody(body.id, { visible: !body.visible });
                        }}>
                          {body.visible ? <Eye className="w-3 h-3 text-white/40" /> : <EyeOff className="w-3 h-3 text-white/20" />}
                        </button>
                        <button onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("Are you sure you want to permanently clear this Body and all its contents?")) {
                            removeBody(body.id);
                          }
                        }}>
                          <Trash2 className="w-3 h-3 text-destructive/60 hover:text-destructive" />
                        </button>
                      </div>
                    </div>
                    
                    {body.isOpen && (
                      <div className="pl-4 space-y-2 mt-1">
                        {/* 1. Render Features */}
                        {model.features?.filter(f => f.bodyId === body.id).map(feature => {
                          const consumedSketch = model.sketches.find(s => s.id === feature.sketchId);
                          const isSelectedFeature = selectedObjectIds.includes(feature.id);
                          return (
                            <div key={feature.id} className="space-y-1">
                              <div 
                                className={cn(
                                  "flex items-center justify-between py-1 group cursor-pointer rounded-sm px-1",
                                  isSelectedFeature ? "bg-primary/10 border border-primary/20" : "hover:bg-white/5"
                                )}
                                onClick={() => setSelectedObjectIds([feature.id])}
                              >
                                <div className="flex items-center gap-2">
                                  <button onClick={(e) => { e.stopPropagation(); updateFeature(feature.id, { isOpen: !feature.isOpen }); }} className="p-0.5 hover:bg-white/10 rounded-sm">
                                    {feature.isOpen ? <ChevronDown className="w-3 h-3 text-white/40" /> : <ChevronRight className="w-3 h-3 text-white/40" />}
                                  </button>
                                  <Box className={cn("w-3 h-3", isSelectedFeature ? "text-primary/80" : "text-white/40")} />
                                  <span className={cn(isSelectedFeature && "text-primary/80 font-bold")} onDoubleClick={() => { const newName = prompt('Rename Extrude', feature.name); if (newName) updateFeature(feature.id, { name: newName }); }} title="Double click to rename">{feature.name}</span>
                                </div>
                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100">
                                  <button onClick={(e) => { e.stopPropagation(); updateFeature(feature.id, { visible: !feature.visible }); }}>
                                    {feature.visible ? <Eye className="w-3 h-3 text-white/40" /> : <EyeOff className="w-3 h-3 text-white/20" />}
                                  </button>
                                  <button onClick={(e) => { e.stopPropagation(); removeFeature(feature.id); }}>
                                    <Trash2 className="w-3 h-3 text-destructive/60 hover:text-destructive" />
                                  </button>
                                </div>
                              </div>
                              {/* Render Consumer Sketch Inside */}
                              {feature.isOpen && consumedSketch && renderSketchNode(consumedSketch, true)}
                            </div>
                          );
                        })}

                        {/* 2. Render Orhpaned Sketches */}
                        {bodySketches
                          .filter(s => !(model.features||[]).some(f => f.sketchId === s.id))
                          .map(sketch => renderSketchNode(sketch, false))}

                        {bodyObjects.map((obj) => (
                          <div 
                            key={obj.id}
                            onClick={() => setSelectedObjectIds([obj.id])}
                            className={cn(
                              "flex items-center justify-between py-1.5 px-2 rounded-sm group cursor-pointer ml-1",
                              selectedObjectIds.includes(obj.id) ? "bg-primary/20 text-primary border border-primary/30" : "hover:bg-white/5 text-white/50"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <Box className={cn("w-3 h-3", selectedObjectIds.includes(obj.id) ? "text-primary" : "text-white/30")} />
                              <span>{obj.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={(e) => {
                                e.stopPropagation();
                                updateObject(obj.id, { visible: !obj.visible });
                              }}>
                                <Eye className={cn("w-3 h-3", obj.visible ? "text-primary" : "opacity-20")} />
                              </button>
                              <button onClick={(e) => {
                                e.stopPropagation();
                                removeObject(obj.id);
                              }} className="opacity-0 group-hover:opacity-100 text-destructive hover:text-red-400">
                                <Scissors className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Properties & Settings */}
      <div className="h-[500px] border-t border-border flex flex-col bg-surface">
        <div className="p-4 flex items-center justify-between border-b border-border">
          <span className="text-xs font-bold uppercase tracking-widest text-white/60">Properties</span>
          <Settings className="w-3.5 h-3.5 text-white/40" />
        </div>

        <div className="p-4 space-y-6 overflow-y-auto">
          {selectedFeature ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Feature Name</span>
                <input 
                  type="text"
                  value={selectedFeature.name}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => updateFeature(selectedFeature.id, { name: e.target.value })}
                  className="w-full bg-neutral-bg border border-border rounded-sm px-2 py-1.5 text-xs text-white"
                />
              </div>

              <div className="space-y-3 mt-4">
                <div className="flex items-center gap-2 text-[10px] font-bold text-white/40 uppercase tracking-wider">
                  <Box className="w-3 h-3 text-primary" />
                  {selectedFeature.type === 'extrude' ? 'Extrude Parameters' : 'Revolve Parameters'}
                </div>
                
                {selectedFeature.type === 'extrude' && (
                  <>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-white/30 w-12 font-mono">DEPTH</span>
                      <input 
                        key={selectedFeature.id + "-depth"}
                        type="text"
                        defaultValue={selectedFeature.depth}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                const val = evaluateMath((e.target as HTMLInputElement).value);
                                if (val !== null) {
                                    updateFeature(selectedFeature.id, { depth: val });
                                    (e.target as HTMLInputElement).value = val.toString();
                                }
                            }
                        }}
                        onBlur={(e) => {
                            const val = evaluateMath(e.target.value);
                            if (val !== null) {
                                updateFeature(selectedFeature.id, { depth: val });
                                e.target.value = val.toString();
                            } else {
                                e.target.value = selectedFeature.depth.toString();
                            }
                        }}
                        className="flex-1 bg-neutral-bg border border-border rounded-sm px-2 py-1 text-xs text-white"
                      />
                      <span className="text-xs font-mono text-white/30 w-4">mm</span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[10px] font-bold text-white/40 uppercase tracking-wider">
                        <SplitSquareVertical className="w-3 h-3 text-secondary ml-[20px]" />
                        SYMMETRIC
                      </div>
                      <button 
                        onClick={() => updateFeature(selectedFeature.id, { symmetric: !selectedFeature.symmetric })}
                        className={cn(
                          "w-8 h-4 rounded-full relative transition-colors cursor-pointer",
                          selectedFeature.symmetric ? "bg-primary" : "bg-white/10"
                        )}
                      >
                        <div className={cn(
                          "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all",
                          selectedFeature.symmetric ? "left-4.5" : "left-0.5"
                        )} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-2 text-[10px] font-bold text-white/40 uppercase tracking-wider">
                        <SplitSquareVertical className="w-3 h-3 text-secondary ml-[20px] opacity-0" />
                        REVERSE DIR
                      </div>
                      <button 
                        onClick={() => updateFeature(selectedFeature.id, { reverse: !selectedFeature.reverse })}
                        className={cn(
                          "w-8 h-4 rounded-full relative transition-colors cursor-pointer",
                          selectedFeature.reverse ? "bg-primary" : "bg-white/10"
                        )}
                      >
                        <div className={cn(
                          "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all",
                          selectedFeature.reverse ? "left-4.5" : "left-0.5"
                        )} />
                      </button>
                    </div>
                  </>
                )}
                
                {selectedFeature.type === 'revolve' && (
                  <>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-white/30 w-12 font-mono">ANGLE</span>
                      <input 
                        key={selectedFeature.id + "-angle"}
                        type="text"
                        defaultValue={selectedFeature.angle}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                const val = evaluateMath((e.target as HTMLInputElement).value);
                                if (val !== null) {
                                    updateFeature(selectedFeature.id, { angle: val });
                                    (e.target as HTMLInputElement).value = val.toString();
                                }
                            }
                        }}
                        onBlur={(e) => {
                            const val = evaluateMath(e.target.value);
                            if (val !== null) {
                                updateFeature(selectedFeature.id, { angle: val });
                                e.target.value = val.toString();
                            } else {
                                e.target.value = (selectedFeature.angle || 360).toString();
                            }
                        }}
                        className="flex-1 bg-neutral-bg border border-border rounded-sm px-2 py-1 text-xs text-white"
                      />
                      <span className="text-xs font-mono text-white/30 w-4">deg</span>
                    </div>
                    
                    <div className="space-y-2 pt-2">
                      <span className="text-[10px] text-white/30 font-mono">AXIS</span>
                      <div className="flex gap-1 h-7">
                         {['X', 'Y', 'Custom'].map(ax => (
                            <button
                               key={ax}
                               onClick={() => updateFeature(selectedFeature.id, { axis: ax as 'X' | 'Y' | 'Custom' })}
                               className={cn(
                                  "flex-1 text-[10px] rounded-sm transition-colors border",
                                  selectedFeature.axis === ax ? "bg-primary/20 border-primary text-primary" : "bg-neutral-bg border-border text-white/50 hover:bg-white/5"
                               )}
                            >
                               {ax}
                            </button>
                         ))}
                      </div>
                      
                      {selectedFeature.axis === 'Custom' && (
                        <button
                          onClick={() => {
                             updateSettings({ activeTool: 'select-axis' });
                          }}
                          className={cn(
                            "w-full text-[10px] uppercase font-bold tracking-wider py-1.5 rounded-sm transition-all border mt-1",
                            settings.activeTool === 'select-axis' ? "bg-secondary/20 text-secondary border-secondary/50" : "bg-neutral-bg border-border text-white/60 hover:bg-white/10"
                          )}
                        >
                          {selectedFeature.customAxisLineId ? 'Reselect Guide Line' : 'Select Guide Line'}
                        </button>
                      )}
                    </div>
                  </>
                )}

                <div className="flex items-center gap-3 mt-4">
                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider w-12">OPACITY</span>
                  <input 
                    type="range"
                    min="10"
                    max="100"
                    step="1"
                    value={(selectedFeature.opacity ?? 1.0) * 100}
                    onChange={(e) => updateFeature(selectedFeature.id, { opacity: parseFloat(e.target.value) / 100 })}
                    className="flex-1 accent-primary"
                  />
                  <span className="text-xs font-mono text-white/30 w-8 text-right">
                    {Math.round((selectedFeature.opacity ?? 1.0) * 100)}%
                  </span>
                </div>

                <div className="pt-4 space-y-2">
                  <button
                    onClick={() => {
                       const filename = selectedFeature.name ? selectedFeature.name : `feature-${selectedFeature.id}`;
                       window.dispatchEvent(new CustomEvent('export-stl', { detail: { id: selectedFeature.id, name: filename } }));
                    }}
                    className="w-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 transition-colors rounded-sm py-1.5 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2"
                  >
                    <Target className="w-3 h-3" />
                    Export STL (3DP)
                  </button>
                  <button
                    onClick={() => {
                       const filename = selectedFeature.name ? selectedFeature.name : `feature-${selectedFeature.id}`;
                       window.dispatchEvent(new CustomEvent('export-stl-lathe', { detail: { id: selectedFeature.id, name: filename } }));
                    }}
                    className="w-full bg-secondary/10 hover:bg-secondary/20 text-secondary border border-secondary/30 transition-colors rounded-sm py-1.5 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2"
                  >
                    <Target className="w-3 h-3" />
                    Export for Lathe
                  </button>
                </div>
              </div>
            </div>
          ) : selectedObject ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Object Name</span>
                <input 
                  type="text"
                  value={selectedObject.name}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => updateObject(selectedObject.id, { name: e.target.value })}
                  className="w-full bg-neutral-bg border border-border rounded-sm px-2 py-1.5 text-xs text-white"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[10px] font-bold text-white/40 uppercase tracking-wider">
                  <MousePointer2 className="w-3 h-3" />
                  Primary Coordinates
                </div>
                
                {['X', 'Y'].map((coord, i) => (
                  <div key={coord} className="flex items-center gap-3">
                    <span className="text-[10px] text-white/30 w-4 font-mono">{coord}</span>
                    <div className="flex-1 bg-neutral-bg border border-primary/30 rounded-sm px-3 py-1.5 flex items-center justify-between shadow-[0_0_10px_rgba(173,198,255,0.05)]">
                      <span className="text-xs font-mono text-primary">
                        {selectedObject.points[0][coord.toLowerCase() as 'x' | 'y'].toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {selectedObject.type === 'box3d' && (
                <div className="space-y-3 mt-4">
                  <div className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Dimensions</div>
                  {['dx', 'dy', 'dz'].map(dim => (
                    <div key={dim} className="flex items-center gap-3">
                      <span className="text-[10px] text-white/30 w-8 font-mono">{dim.toUpperCase()}</span>
                      <input 
                        type="number"
                        value={selectedObject.metadata?.[dim] || 10}
                        onChange={(e) => updateObject(selectedObject.id, { metadata: { ...selectedObject.metadata, [dim]: parseFloat(e.target.value) } })}
                        className="flex-1 bg-neutral-bg border border-border rounded-sm px-2 py-1 text-xs text-white"
                      />
                    </div>
                  ))}
                </div>
              )}

              {selectedObject.type === 'cylinder3d' && (
                <div className="space-y-3 mt-4">
                  <div className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Dimensions</div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-white/30 w-8 font-mono">RAD</span>
                    <input 
                      type="number"
                      value={selectedObject.metadata?.radius || 5}
                      onChange={(e) => updateObject(selectedObject.id, { metadata: { ...selectedObject.metadata, radius: parseFloat(e.target.value) } })}
                      className="flex-1 bg-neutral-bg border border-border rounded-sm px-2 py-1 text-xs text-white"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-white/30 w-8 font-mono">H</span>
                    <input 
                      type="number"
                      value={selectedObject.metadata?.height || 10}
                      onChange={(e) => updateObject(selectedObject.id, { metadata: { ...selectedObject.metadata, height: parseFloat(e.target.value) } })}
                      className="flex-1 bg-neutral-bg border border-border rounded-sm px-2 py-1 text-xs text-white"
                    />
                  </div>
                </div>
              )}

              {selectedObject.type === 'sphere3d' && (
                <div className="space-y-3 mt-4">
                  <div className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Dimensions</div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-white/30 w-8 font-mono">RAD</span>
                    <input 
                      type="number"
                      value={selectedObject.metadata?.radius || 5}
                      onChange={(e) => updateObject(selectedObject.id, { metadata: { ...selectedObject.metadata, radius: parseFloat(e.target.value) } })}
                      className="flex-1 bg-neutral-bg border border-border rounded-sm px-2 py-1 text-xs text-white"
                    />
                  </div>
                </div>
              )}

              {selectedObject.type === 'cone3d' && (
                <div className="space-y-3 mt-4">
                  <div className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Dimensions</div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-white/30 w-8 font-mono">R1</span>
                    <input 
                      type="number"
                      value={selectedObject.metadata?.radius1 || 5}
                      onChange={(e) => updateObject(selectedObject.id, { metadata: { ...selectedObject.metadata, radius1: parseFloat(e.target.value) } })}
                      className="flex-1 bg-neutral-bg border border-border rounded-sm px-2 py-1 text-xs text-white"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-white/30 w-8 font-mono">R2</span>
                    <input 
                      type="number"
                      value={selectedObject.metadata?.radius2 || 0}
                      onChange={(e) => updateObject(selectedObject.id, { metadata: { ...selectedObject.metadata, radius2: parseFloat(e.target.value) } })}
                      className="flex-1 bg-neutral-bg border border-border rounded-sm px-2 py-1 text-xs text-white"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-white/30 w-8 font-mono">H</span>
                    <input 
                      type="number"
                      value={selectedObject.metadata?.height || 10}
                      onChange={(e) => updateObject(selectedObject.id, { metadata: { ...selectedObject.metadata, height: parseFloat(e.target.value) } })}
                      className="flex-1 bg-neutral-bg border border-border rounded-sm px-2 py-1 text-xs text-white"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-white/20 gap-2 py-4 border-b border-border/50 mb-4">
              <MousePointer2 className="w-6 h-6 opacity-10" />
              <span className="text-[9px] uppercase tracking-widest">No Selection</span>
            </div>
          )}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] font-bold text-white/40 uppercase tracking-wider">
                <Grid3X3 className="w-3 h-3" />
                SHOW GRID
              </div>
              <button 
                onClick={() => updateSettings({ 
                  showGrid: !settings.showGrid,
                  snapConfig: { ...settings.snapConfig, grid: !settings.showGrid }
                })}
                className={cn(
                  "w-8 h-4 rounded-full relative transition-colors cursor-pointer",
                  settings.showGrid ? "bg-primary" : "bg-white/10"
                )}
              >
                <div className={cn(
                  "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all",
                  settings.showGrid ? "left-4.5" : "left-0.5"
                )} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] font-bold text-white/40 uppercase tracking-wider">
                <Grid3X3 className="w-3 h-3 opacity-50" />
                SHOW ORIGIN
              </div>
              <button 
                onClick={() => updateSettings({ 
                  showOrigin: settings.showOrigin === false ? true : false,
                })}
                className={cn(
                  "w-8 h-4 rounded-full relative transition-colors cursor-pointer",
                  settings.showOrigin !== false ? "bg-primary" : "bg-white/10"
                )}
              >
                <div className={cn(
                  "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all",
                  settings.showOrigin !== false ? "left-4.5" : "left-0.5"
                )} />
              </button>
            </div>
            <div className="flex items-center gap-3 px-1 pt-2">
              <span className="text-[10px] text-white/30 w-16 uppercase">Grid Size</span>
              <input 
                type="range" 
                min="10" 
                max="50" 
                step="5"
                value={settings.gridSize}
                onChange={(e) => updateSettings({ gridSize: parseInt(e.target.value) })}
                className="flex-1 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-primary"
              />
              <span className="text-[10px] text-primary font-mono w-8">{settings.gridSize}</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] font-bold text-white/40 uppercase tracking-wider">
                <Layers className="w-3 h-3" />
                Layers
              </div>
              <button 
                onClick={() => addLayer({ id: Date.now().toString(), name: `Layer ${model.layers.length + 1}`, visible: true, locked: false, color: '#ADC6FF' })}
                className="p-1 hover:bg-white/5 rounded-sm transition-colors"
              >
                <Plus size={12} className="text-white/60" />
              </button>
            </div>
            <div className="space-y-1">
              {model.layers.map(layer => (
                <div 
                  key={layer.id}
                  onClick={() => setActiveLayer(layer.id)}
                  className={cn(
                    "flex items-center justify-between p-2 rounded-sm cursor-pointer transition-colors border border-transparent",
                    model.activeLayerId === layer.id ? "bg-primary/10 border-primary/30" : "bg-surface/50 border-border hover:bg-white/5"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: layer.color }} />
                    <span className="text-[11px] text-white/80">{layer.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={(e) => { e.stopPropagation(); /* Toggle visibility logic would go here */ }}
                      className="p-1 hover:bg-white/10 rounded-sm"
                    >
                      {layer.visible ? <Eye size={10} className="text-white/40" /> : <EyeOff size={10} className="text-white/20" />}
                    </button>
                    {model.layers.length > 1 && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }}
                        className="p-1 hover:bg-white/10 rounded-sm text-destructive"
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
      
      {contextMenu && (
        <div 
          className="fixed z-50 bg-neutral-bg border border-border rounded-md shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button 
            className="w-full text-left px-4 py-2 text-xs text-white/80 hover:bg-primary/20 hover:text-primary transition-colors flex items-center gap-2"
            onClick={(e) => {
              e.stopPropagation();
              handleExtrude(contextMenu.sketchId);
            }}
          >
            <Box className="w-4 h-4" />
            Extrude Body
          </button>
          <button 
            className="w-full text-left px-4 py-2 text-xs text-white/80 hover:bg-secondary/20 hover:text-secondary transition-colors flex items-center gap-2 border-t border-white/5"
            onClick={(e) => {
              e.stopPropagation();
              handleRevolve(contextMenu.sketchId);
            }}
          >
            <RefreshCw className="w-4 h-4" />
            Revolve Body
          </button>
        </div>
      )}
    </>
  );
};
