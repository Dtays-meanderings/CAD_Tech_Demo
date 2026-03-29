import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { askGemini } from '../services/aiService';
import { onOCCTReady, onOCCTStatus, performBox } from '../lib/occt';
import { Settings, CADModel, ToolType, CADObject, Layer, Dimension, Sketch, PythonState, PythonLog, Geometry3D, CADBody, CADFeature, Constraint, Point } from '../types';
import { solveConstraintsAlgebraic } from '../lib/algebraic-solver';
// @ts-ignore
import initOpenCascade from 'opencascade.js/dist/opencascade.wasm.js';
// @ts-ignore
import wasmUrlFromVite from 'opencascade.js/dist/opencascade.wasm.wasm?url';

interface SettingsContextType {
  settings: Settings;
  updateSettings: (updates: Partial<Settings>) => void;
  model: CADModel;
  addObject: (obj: CADObject) => void;
  addObjects: (objs: CADObject[]) => void;
  removeObject: (id: string) => void;
  removeObjects: (ids: string[]) => void;
  updateObject: (id: string, updates: Partial<CADObject>, activePointIndex?: number) => void;
  updateObjectLive: (id: string, updates: Partial<CADObject>, activePointIndex?: number) => void;
  updateModel: (updater: (prev: CADModel) => CADModel) => void;
  addDimension: (dim: Dimension) => void;
  updateDimension: (id: string, updates: Partial<Dimension>) => void;
  removeDimension: (id: string) => void;
  toggleDimensionReference: (dimId: string) => void;
  addLayer: (layer: Layer) => void;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string) => void;
  addSketch: (sketch: Sketch) => void;
  removeSketch: (id: string) => void;
  updateSketch: (id: string, updates: Partial<Sketch>) => void;
  setActiveSketch: (id: string) => void;
  selectedVertices: { objectId: string, pointIndex: number }[];
  setSelectedVertices: React.Dispatch<React.SetStateAction<{ objectId: string, pointIndex: number }[]>>;
  selectedObjectIds: string[];
  setSelectedObjectIds: React.Dispatch<React.SetStateAction<string[]>>;
  addFeature: (feature: CADFeature) => void;
  removeFeature: (id: string) => void;
  updateFeature: (id: string, updates: Partial<CADFeature>) => void;
  setActiveFeature: (id: string) => void;
  addCoincidentConstraint: (v1: { objectId: string, pointIndex: number }, target: { objectId: string, pointIndex?: number }) => void;
  addParallelConstraint: (objId?: string, targetId?: string, vertices?: { objectId: string, pointIndex: number }[]) => void;
  addPerpendicularConstraint: (objId?: string, targetId?: string, vertices?: { objectId: string, pointIndex: number }[]) => void;
  addHorizontalConstraint: (objId?: string, vertices?: { objectId: string, pointIndex: number }[]) => void;
  addVerticalConstraint: (objId?: string, vertices?: { objectId: string, pointIndex: number }[]) => void;
  addEqualConstraint: (objId?: string, targetId?: string, vertices?: { objectId: string, pointIndex: number }[], allIds?: string[]) => void;
  addFixedConstraint: (objId: string, pointIndex?: number) => void;
  addTangentConstraint: (objId: string, targetId: string) => void;
  undo: () => void;
  redo: () => void;
  clearModel: () => void;
  solveConstraints: (objects: CADObject[], activeId?: string, activePointIndex?: number, explicitDimensions?: Dimension[]) => CADObject[];
  commandHistory: string[];
  executeCommand: (cmd: string) => void;
  removeConstraint: (objectId: string, constraintId: string) => void;
  lastAIResponse: string | null;
  setLastAIResponse: (response: string | null) => void;
  selectedConstraintId: string | null;
  setSelectedConstraintId: (id: string | null) => void;
  pythonState: PythonState;
  runPython: (code: string) => Promise<void>;
  geometry3D: Geometry3D[];
  addGeometry3D: (geo: Geometry3D) => void;
  clearGeometry3D: () => void;
  mainThreadOC: any;
  addBody: (body: CADBody) => void;
  removeBody: (id: string) => void;
  updateBody: (id: string, updates: Partial<CADBody>) => void;
  setActiveBody: (id: string) => void;
  addBox3D: (dx: number, dy: number, dz: number, pos: { x: number, y: number }) => void;
  addCylinder3D: (radius: number, height: number, pos: { x: number, y: number }) => void;
  addSphere3D: (radius: number, pos: { x: number, y: number }) => void;
  addCone3D: (radius1: number, radius2: number, height: number, pos: { x: number, y: number }) => void;
  applyMirror: (overrideLineId?: string | any) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const INITIAL_LAYER: Layer = {
  id: 'layer-0',
  name: 'Default',
  visible: true,
  locked: false,
  color: '#ADC6FF'
};

const INITIAL_SKETCH: Sketch = {
  id: 'sketch-0',
  name: 'Sketch 1',
  visible: true,
  locked: false,
  isOpen: true,
  bodyId: 'body-0',
  position: [0, 0, 0],
  rotation: [0, 0, 0],
};

const INITIAL_BODY: CADBody = {
  id: 'body-0',
  name: 'Body 1',
  visible: true,
  locked: false,
  isOpen: true,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
};

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings>({
    showHotkeys: true,
    snapConfig: {
      globalEnabled: true,
      vertex: true,
      midpoint: true,
      center: true,
      geometricCenter: true,
      edge: true,
      objectCenter: true,
      quadrant: true,
      grid: true
    },
    gridSize: 20,
    snapThreshold: 10,
    activeTool: 'select',
    filletRadius: 10,
    unit: 'mm',
    show3DPreview: false,
    showPythonConsole: false,
    offsetDistance: 10,
    offsetCount: 1,
    thinkingMode: false,
    splineMode: 'interpolate',
    splineTension: 0.5,
    isDiameterMode: false,
    isAltPressed: false,
    mirrorSession: {
      selectedIds: [],
      isSelectingLine: false,
      mirrorLineId: undefined
    }
  });

  const [model, setModel] = useState<CADModel>({
    objects: [],
    layers: [INITIAL_LAYER],
    sketches: [INITIAL_SKETCH],
    bodies: [INITIAL_BODY],
    dimensions: [],
    activeLayerId: 'layer-0',
    activeSketchId: 'sketch-0',
    activeBodyId: 'body-0',
  });

  const [history, setHistory] = useState<CADModel[]>([]);
  const [redoStack, setRedoStack] = useState<CADModel[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [selectedVertices, setSelectedVertices] = useState<{ objectId: string, pointIndex: number }[]>([]);
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [selectedConstraintId, setSelectedConstraintId] = useState<string | null>(null);
  const [lastAIResponse, setLastAIResponse] = useState<string | null>(null);
  const [pythonState, setPythonState] = useState<PythonState>({
    isReady: false,
    isExecuting: false,
    isBunkerReady: false,
    logs: [],
  });
  const [geometry3D, setGeometry3D] = useState<Geometry3D[]>([]);
  const pyodideRef = React.useRef<any>(null);
  const isInitializingRef = React.useRef<boolean>(false);
  const [mainThreadOC, setMainThreadOC] = useState<any>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'BUNKER_READY') {
        setPythonState(prev => ({ ...prev, isBunkerReady: true }));
        addLog('info', 'Bunker Cache Ready! You can now disconnect from the internet.');
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', handleMessage);
  }, []);

  // Migration / Auto-Heal: Purge orphaned dimension constraints from objects
  useEffect(() => {
    if (!model.objects || !model.dimensions) return;
    let needsHeal = false;
    
    const validDimIds = new Set(model.dimensions.map(d => d.id));
    
    const healedObjects = model.objects.map(obj => {
      if (!obj.constraints || obj.constraints.length === 0) return obj;
      const goodConstraints = obj.constraints.filter(c => {
         // Dimension constraints look like "{dimId}-angle" or "{dimId}-dist"
         // Avoid deleting intrinsic structural properties!
         const match = c.id.match(/^(\d+)-(angle|dist|radius|tangent|coincident)/);
         if (match) {
             const dimId = match[1];
             // Explicitly whitelist Arc/Fillet built-in constraints which use the arc's Date.now() ID instead of a Dimension ID.
             const isArcConstraint = obj.type === 'arc' && c.id.startsWith(obj.id);
             
             if (!isArcConstraint && !validDimIds.has(dimId)) {
                 needsHeal = true;
                 return false; // Orphaned! Delete it!
             }
         }
         return true;
      });
      
      return goodConstraints.length === obj.constraints.length ? obj : { ...obj, constraints: goodConstraints };
    });
    
    if (needsHeal) {
      console.log("Auto-healing corrupted dimension constraints from LocalStorage...");
      setModel(prev => ({ ...prev, objects: healedObjects }));
    }
  }, [model.dimensions.length]); // Run once on startup, or when dimensions change

  const saveToHistory = useCallback((newModel: CADModel) => {
    setHistory(prev => [...prev, model]);
    setRedoStack([]);
    setModel(newModel);
  }, [model]);

  const undo = useCallback(() => {
    setHistory(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack(redoPrev => [...redoPrev, model]);
      setModel(last);
      return prev.slice(0, -1);
    });
  }, [model]);

  const updateModel = useCallback((updater: (prev: CADModel) => CADModel) => {
    setModel(prev => {
      const next = updater(prev);
      setHistory(h => [...h, prev]);
      setRedoStack([]);
      return next;
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack(prev => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1];
      setHistory(historyPrev => [...historyPrev, model]);
      setModel(next);
      return prev.slice(0, -1);
    });
  }, [model]);

  const updateSettings = (updates: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
  };


  const solveConstraints = (objects: CADObject[], activeId?: string, activePointIndex?: number, explicitDimensions?: Dimension[]): CADObject[] => {
    return solveConstraintsAlgebraic(objects, explicitDimensions || model.dimensions, activeId, activePointIndex);
  };

  useEffect(() => {
    const initPyodide = async () => {
      if (isInitializingRef.current || pyodideRef.current || !settings.showPythonConsole) return;
      isInitializingRef.current = true;
      
      try {
        // Wait for OCCT to be ready first to avoid memory allocation conflicts
        // This is a common issue when multiple large WASM modules load at once
        addLog('info', 'Waiting for CAD engine to be ready before starting Python...');
        
        await new Promise<void>((resolve) => {
          let resolved = false;
          const done = () => {
             if (resolved) return;
             resolved = true;
             setTimeout(resolve, 1000);
          };
          let cleanup: (() => void) | undefined;
          
          const timeout = setTimeout(() => {
            if (cleanup) cleanup();
            console.warn('CAD engine wait timed out, attempting Python boot anyway...');
            done();
          }, 3000);

          cleanup = onOCCTStatus((status) => {
            if (status.ready || status.error) {
              clearTimeout(timeout);
              if (cleanup) cleanup();
              done();
            }
          });
        });

        addLog('info', 'Initializing Python engine...');
        
        // Log memory status if available
        if ((performance as any).memory) {
          const mem = (performance as any).memory;
          console.log(`Main Thread Memory (before Pyodide): ${(mem.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB / ${(mem.jsHeapSizeLimit / 1024 / 1024).toFixed(2)}MB`);
        }

        // @ts-ignore
        if (window.loadPyodide) {
          // @ts-ignore
          const pyodide = await window.loadPyodide({
            // Pyodide v0.25.0+ options
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/"
          });
          pyodideRef.current = pyodide;
          setPythonState(prev => ({ ...prev, isReady: true }));
          addLog('info', 'Python engine initialized.');
          
          addLog('info', 'Injecting raw OpenCASCADE kernel directly into Python (this may take a moment)...');
          try {
             let wasmUrl = wasmUrlFromVite;
             if (!wasmUrl || wasmUrl.startsWith('node')) {
               wasmUrl = 'https://unpkg.com/opencascade.js@1.1.1/dist/opencascade.wasm.wasm';
             }
             const ocInst = await initOpenCascade({
               INITIAL_MEMORY: 64 * 1024 * 1024,
               ALLOW_MEMORY_GROWTH: true,
               locateFile: (path: string) => path.endsWith('.wasm') ? wasmUrl : path
             });
             setMainThreadOC(ocInst);
             pyodideRef.current.globals.set("oc", ocInst);
             addLog('info', 'SUCCESS: The raw `oc` global object is now permanently mounted!');
          } catch(e: any) {
             addLog('stderr', `OCCT Mounting Error: ${e.message}`);
          }
        }
      } catch (error: any) {
        console.error('Failed to initialize Pyodide:', error);
        addLog('stderr', `Failed to initialize Python engine: ${error.message}`);
      } finally {
        isInitializingRef.current = false;
      }
    };

    if (settings.showPythonConsole && !pythonState.isReady) {
      initPyodide();
    }
  }, [settings.showPythonConsole, pythonState.isReady]);

  const addLog = (type: PythonLog['type'], content: string) => {
    setPythonState(prev => ({
      ...prev,
      logs: [...prev.logs, { type, content, timestamp: Date.now() }]
    }));
  };

  const runPython = async (code: string) => {
    if (!pyodideRef.current) {
      if (!settings.showPythonConsole) {
        updateSettings({ showPythonConsole: true });
        addLog('info', 'Starting Python engine...');
      }
      
      // Wait for Pyodide to be ready
      addLog('info', 'Waiting for Python engine to initialize...');
      let attempts = 0;
      while (!pyodideRef.current && attempts < 60) { // 30 second timeout
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
      }
      
      if (!pyodideRef.current) {
        addLog('stderr', 'Python engine initialization timed out.');
        return;
      }
    }
    setPythonState(prev => ({ ...prev, isExecuting: true }));
    
    try {
      // Safely parse Python PyProxy objects back to native JS objects
      const parseArg = (arg: any) => {
        if (arg && typeof arg.toJs === 'function') {
          return arg.toJs({ dict_converter: Object.fromEntries });
        }
        return arg;
      };

      // Construct dynamic API bound to latest React closures
      const cadApi = {
        getSettings: () => settings,
        updateSettings: (updates: any) => updateSettings(parseArg(updates)),
        getModel: () => model,
        addObject: (obj: any) => addObject(parseArg(obj)),
        addObjects: (objs: any[]) => addObjects(parseArg(objs)),
        removeObject: (id: string) => removeObject(id),
        updateObject: (id: string, updates: any) => updateObject(id, parseArg(updates)),
        executeCommand: (cmd: string) => executeCommand(cmd),
        undo: () => undo(),
        redo: () => redo(),
        clearModel: () => clearModel(),
        addGeometry3D: (geo: any) => addGeometry3D(parseArg(geo)),
        clearGeometry3D: () => clearGeometry3D(),
        createOCCTBox: async (dx: number, dy: number, dz: number) => {
          const result = await performBox(dx, dy, dz);
          if (result && result.success) {
            addObject({
              id: 'box3d-' + Date.now().toString(),
              name: `Box [${dx}×${dy}×${dz}]`,
              type: 'box3d',
              points: [{ id: `box3d-p-${Date.now()}`, x: 0, y: 0 }],
              visible: true,
              locked: false,
              constraints: [],
              layerId: model.activeLayerId || model.layers[0]?.id || 'layer1',
              bodyId: model.activeBodyId || model.bodies?.[0]?.id || 'body-0',
              color: '#00ffff',
              metadata: { dx, dy, dz }
            });
            return { success: true, message: `Created OCCT Box with dimensions: ${dx}x${dy}x${dz} inside Tree` };
          }
          return result;
        },
        addDimension: (dim: any) => addDimension(parseArg(dim)),
        removeDimension: (id: string) => removeDimension(id),
        addLayer: (layer: any) => addLayer(parseArg(layer)),
        setActiveLayer: (id: string) => setActiveLayer(id),
      };

      // Register the API wrapper globally in Python natively
      pyodideRef.current.globals.set("cad", cadApi);

      // Capture stdout/stderr
      pyodideRef.current.setStdout({
        batched: (str: string) => addLog('stdout', str)
      });
      pyodideRef.current.setStderr({
        batched: (str: string) => addLog('stderr', str)
      });

      const result = await pyodideRef.current.runPythonAsync(code);
      
      if (result !== undefined) {
        addLog('stdout', String(result));
      }
      
      setPythonState(prev => ({ ...prev, lastResult: result }));
      addLog('info', 'Execution completed.');
    } catch (error: any) {
      addLog('stderr', error.message);
    } finally {
      setPythonState(prev => ({ ...prev, isExecuting: false }));
    }
  };

  const addGeometry3D = (geo: Geometry3D) => {
    setGeometry3D(prev => [...prev, geo]);
  };

  const clearGeometry3D = () => {
    setGeometry3D([]);
  };

  const addObject = (obj: CADObject) => {
    const payload = { ...obj } as CADObject;
    if (!payload.layerId) payload.layerId = model.activeLayerId || 'layer1';
    if (!payload.sketchId && !payload.bodyId) {
      payload.sketchId = model.activeSketchId || 'sketch1';
    }
    
    const newObjects = solveConstraints([...model.objects, payload]);
    saveToHistory({
      ...model,
      objects: newObjects,
    });
  };

  const addObjects = (objs: CADObject[]) => {
    updateModel(prev => {
      const newObjectsWithMetadata = objs.map(obj => {
        const payload = { ...obj } as CADObject;
        if (!payload.layerId) payload.layerId = prev.activeLayerId || 'layer1';
        if (!payload.sketchId && !payload.bodyId) {
           payload.sketchId = prev.activeSketchId || 'sketch1';
        }
        return payload;
      });
      const newObjects = solveConstraintsAlgebraic([...prev.objects, ...newObjectsWithMetadata], prev.dimensions);
      return { ...prev, objects: newObjects };
    });
  };

  const applyMirror = useCallback((overrideLineId?: string | any) => {
    const { mirrorSession } = settings;
    if (!mirrorSession || mirrorSession.selectedIds.length === 0) return;

    let targetLineId = (typeof overrideLineId === 'string') ? overrideLineId : mirrorSession.mirrorLineId;
    if (!targetLineId) return;

    let mirrorLine = model.objects.find(o => o.id === targetLineId);
    
    // Inject synthetic Infinite Global Axes allowing parametric mirroring across Cartesian 0,0 anchors
    if (!mirrorLine && targetLineId === 'axis-x') {
       mirrorLine = { type: 'line', points: [{x: 0, y: 0}, {x: 1, y: 0}] } as any;
    } else if (!mirrorLine && targetLineId === 'axis-y') {
       mirrorLine = { type: 'line', points: [{x: 0, y: 0}, {x: 0, y: 1}] } as any;
    }

    if (!mirrorLine || mirrorLine.type !== 'line' || mirrorLine.points.length < 2) return;

    const mP1 = mirrorLine.points[0];
    const mP2 = mirrorLine.points[1];
    
    const dx = mP2.x - mP1.x;
    const dy = mP2.y - mP1.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.0001) return;

    const reflect = (p: { x: number, y: number }) => {
      const u = ((p.x - mP1.x) * dx + (p.y - mP1.y) * dy) / lenSq;
      const projX = mP1.x + u * dx;
      const projY = mP1.y + u * dy;
      return { x: 2 * projX - p.x, y: 2 * projY - p.y };
    };

    const sourceObjects = model.objects.filter(o => mirrorSession.selectedIds.includes(o.id));
    const newObjects: CADObject[] = sourceObjects.map(obj => {
      const mirroredPoints = obj.points.map(p => ({
        ...p,
        id: `m-p-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        ...reflect(p)
      }));
      
      return {
        ...obj,
        id: `m-obj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: `${obj.name} (Mirror)`,
        points: mirroredPoints,
        constraints: [], 
      };
    });

    addObjects(newObjects);
    updateSettings({ 
      activeTool: 'select',
      mirrorSession: { selectedIds: [], isSelectingLine: false, mirrorLineId: undefined }
    });
  }, [settings, model, addObjects, updateSettings]);

  const removeObject = (id: string) => {
    removeObjects([id]);
  };

  const removeObjects = (ids: string[]) => {
    if (ids.length === 0) return;
    updateModel(prev => {
      const remainingObjects = prev.objects.filter(o => !ids.includes(o.id));
      
      const cleanedObjects = remainingObjects.map(obj => {
         if (!obj.constraints || obj.constraints.length === 0) return obj;
         
         const newConstraints = obj.constraints.filter(c => {
             // Remove constraint if it points to a deleted object
             if (c.targetId && ids.includes(c.targetId)) return false;
             // Remove constraint if it belonged to a dimension that was just deleted
             if (ids.some(deletedId => c.id.startsWith(`${deletedId}-`))) return false;
             
             return true;
         });
         
         return newConstraints.length === obj.constraints.length ? obj : { ...obj, constraints: newConstraints };
      });

      return {
        ...prev,
        objects: cleanedObjects,
        dimensions: prev.dimensions.filter(d => 
           !ids.includes(d.id) &&
           !(d.objectId && ids.includes(d.objectId)) && 
           !(d.targetObjectId && ids.includes(d.targetObjectId))
        )
      };
    });
    setSelectedConstraintId(null);
  };

  const updateObject = (id: string, updates: Partial<CADObject>, activePointIndex?: number) => {
    updateModel(prev => {
      const newObjects = prev.objects.map(o => o.id === id ? { ...o, ...updates } : o);
      const solvedObjects = solveConstraintsAlgebraic(newObjects, prev.dimensions, id, activePointIndex);
      return {
        ...prev,
        objects: solvedObjects,
      };
    });
  };

  const updateObjectLive = (id: string, updates: Partial<CADObject>, activePointIndex?: number) => {
    setModel(prev => {
      const newObjects = prev.objects.map(o => o.id === id ? { ...o, ...updates } : o);
      const solvedObjects = solveConstraintsAlgebraic(newObjects, prev.dimensions, id, activePointIndex);
      return {
        ...prev,
        objects: solvedObjects,
      };
    });
  };

  const addDimension = (dim: Dimension) => {
    updateModel(prev => ({
      ...prev,
      dimensions: [...prev.dimensions, { ...dim, sketchId: prev.activeSketchId, isReference: dim.isReference ?? (settings.isReferenceMode || false) }],
    }));
  };

  const updateDimension = (id: string, updates: Partial<Dimension>) => {
    setModel(prev => {
      const newDims = prev.dimensions.map(d => d.id === id ? { ...d, ...updates } : d);
      
      // We strictly bypass the BFGS algebraic solver sequence if the update is purely aesthetic (e.g. dragging text points or entering edit mode) 
      const requiresReSolve = updates.value !== undefined || updates.objectId !== undefined || updates.targetObjectId !== undefined;

      return {
        ...prev,
        dimensions: newDims,
        objects: requiresReSolve ? solveConstraintsAlgebraic(prev.objects, newDims) : prev.objects
      };
    });
  };

  const toggleDimensionReference = (dimId: string) => {
    updateModel(prev => {
      const dim = prev.dimensions.find(d => d.id === dimId);
      if (!dim) return prev;

      const newIsReference = !dim.isReference;
      const newDims = prev.dimensions.map(d => d.id === dimId ? { ...d, isReference: newIsReference } : d);

      const hostObj = prev.objects.find(o => o.id === dim.objectId);
      if (!hostObj) return { ...prev, dimensions: newDims }; // Should not happen in healthy files

      let newConstraints = [...(hostObj.constraints || [])];

      if (newIsReference) {
         // Changing to reference -> Delete any rigidly driving constraint starting with dimId
         newConstraints = newConstraints.filter(c => !c.id.startsWith(`${dimId}-`));
      } else {
         // Changing to rigid driving -> Generate identical constraint mapped to this Dimension type
         let constrType = '';
         let constraintObj: any = { id: `${dimId}-auto`, value: dim.value };
         
         if (dim.type === 'linear') { constrType = 'distance'; constraintObj.targetId = dim.targetObjectId; }
         else if (dim.type === 'horizontal') { constrType = 'horizontal_distance'; constraintObj.targetId = dim.targetObjectId; }
         else if (dim.type === 'vertical') { constrType = 'vertical_distance'; constraintObj.targetId = dim.targetObjectId; }
         else if (dim.type === 'angular') { constrType = 'angle'; constraintObj.targetId = dim.targetObjectId; }
         else if (dim.type === 'radial' || dim.type === 'diameter') { constrType = 'radius'; }

         constraintObj.type = constrType;
         newConstraints.push(constraintObj as Constraint);
      }

      const newObjects = prev.objects.map(o => o.id === hostObj.id ? { ...o, constraints: newConstraints } : o);
      const solvedObjects = !newIsReference ? solveConstraintsAlgebraic(newObjects, newDims) : newObjects;

      return {
        ...prev,
        dimensions: newDims,
        objects: solvedObjects
      };
    });
  };

  const removeDimension = (id: string) => {
    updateModel(prev => ({
      ...prev,
      dimensions: prev.dimensions.filter(d => d.id !== id),
    }));
  };

  const addLayer = (layer: Layer) => {
    saveToHistory({
      ...model,
      layers: [...model.layers, layer],
    });
  };

  const removeLayer = (id: string) => {
    if (id === 'layer-0') return;
    saveToHistory({
      ...model,
      layers: model.layers.filter(l => l.id !== id),
      objects: model.objects.filter(o => o.layerId !== id),
      activeLayerId: model.activeLayerId === id ? 'layer-0' : model.activeLayerId
    });
  };

  const setActiveLayer = (id: string) => {
    setModel(prev => ({ ...prev, activeLayerId: id }));
  };

  const addSketch = (sketch: Sketch) => {
    saveToHistory({
      ...model,
      sketches: [...model.sketches, sketch],
      activeSketchId: sketch.id
    });
  };

  const removeSketch = (id: string) => {
    if (model.sketches.length <= 1) return;
    saveToHistory({
      ...model,
      sketches: model.sketches.filter(s => s.id !== id),
      objects: model.objects.filter(o => o.sketchId !== id),
      activeSketchId: model.activeSketchId === id ? model.sketches.find(s => s.id !== id)?.id : model.activeSketchId
    });
  };

  const updateSketch = (id: string, updates: Partial<Sketch>) => {
    saveToHistory({
      ...model,
      sketches: model.sketches.map(s => s.id === id ? { ...s, ...updates } : s)
    });
  };

  const addBox3D = (dx: number, dy: number, dz: number, pos: Point) => {
    const id = Date.now().toString();
    addObject({
      id,
      name: `Box ${id}`,
      type: 'box3d',
      points: [pos],
      visible: true,
      locked: false,
      constraints: [],
      layerId: model.activeLayerId,
      bodyId: model.activeBodyId,
      metadata: { dx, dy, dz }
    });
  };

  const addCylinder3D = (radius: number, height: number, pos: Point) => {
    const id = Date.now().toString();
    addObject({
      id,
      name: `Cylinder ${id}`,
      type: 'cylinder3d',
      points: [pos],
      visible: true,
      locked: false,
      constraints: [],
      layerId: model.activeLayerId,
      bodyId: model.activeBodyId,
      metadata: { radius, height }
    });
  };

  const addSphere3D = (radius: number, pos: Point) => {
    const id = Date.now().toString();
    addObject({
      id,
      name: `Sphere ${id}`,
      type: 'sphere3d',
      points: [pos],
      visible: true,
      locked: false,
      constraints: [],
      layerId: model.activeLayerId,
      bodyId: model.activeBodyId,
      metadata: { radius }
    });
  };

  const addCone3D = (radius1: number, radius2: number, height: number, pos: Point) => {
    const id = Date.now().toString();
    addObject({
      id,
      name: `Cone ${id}`,
      type: 'cone3d',
      points: [pos],
      visible: true,
      locked: false,
      constraints: [],
      layerId: model.activeLayerId,
      bodyId: model.activeBodyId,
      metadata: { radius1, radius2, height }
    });
  };

  const addBody = (body: CADBody) => {
    saveToHistory({
      ...model,
      bodies: [...(model.bodies || []), body]
    });
  };

  const removeBody = (id: string) => {
    if (!model.bodies) return;
    saveToHistory({
      ...model,
      bodies: model.bodies.filter(b => b.id !== id),
      objects: model.objects.filter(o => o.bodyId !== id),
      sketches: model.sketches.filter(s => s.bodyId !== id),
      activeBodyId: model.activeBodyId === id ? model.bodies.find(b => b.id !== id)?.id : model.activeBodyId
    });
  };

  const updateBody = (id: string, updates: Partial<CADBody>) => {
    saveToHistory({
      ...model,
      bodies: (model.bodies || []).map(b => b.id === id ? { ...b, ...updates } : b)
    });
  };

  const setActiveBody = (id: string) => {
    setModel(prev => ({ ...prev, activeBodyId: id }));
  };

  const addFeature = (feature: CADFeature) => {
    saveToHistory({
      ...model,
      features: [...(model.features || []), feature]
    });
  };

  const removeFeature = (id: string) => {
    saveToHistory({
      ...model,
      features: (model.features || []).filter(f => f.id !== id)
      // Note: As requested, deleting a feature deliberately LEAVES the associated Sketch in the tree unharmed!
    });
  };

  const updateFeature = (id: string, updates: Partial<CADFeature>) => {
    saveToHistory({
      ...model,
      features: (model.features || []).map(f => f.id === id ? { ...f, ...updates } : f)
    });
  };

  const setActiveFeature = (id: string) => {
    // We can just rely on selectedObjectIds to track active feature for properties
  };

  const addCoincidentConstraint = (v1: { objectId: string, pointIndex: number }, target: { objectId: string, pointIndex?: number }) => {
    const obj1 = model.objects.find(o => o.id === v1.objectId);
    if (!obj1) return;

    const newConstraint = {
      id: Date.now().toString(),
      type: 'coincident' as const,
      pointIndex: v1.pointIndex,
      targetId: target.objectId,
      targetPointIndex: target.pointIndex
    };

    const newObjects = model.objects.map(o => 
      o.id === v1.objectId ? { ...o, constraints: [...o.constraints, newConstraint] } : o
    );

    const solvedObjects = solveConstraints(newObjects, v1.objectId);
    saveToHistory({
      ...model,
      objects: solvedObjects
    });
    setSelectedVertices([]);
  };

  const addParallelConstraint = (objId?: string, targetId?: string, vertices?: { objectId: string, pointIndex: number }[]) => {
    if (vertices && vertices.length >= 4) {
      const v1 = vertices[0];
      const v2 = vertices[1];
      const v3 = vertices[2];
      const v4 = vertices[3];
      const newConstraint = { id: Date.now().toString(), type: 'parallel' as const, pointIndex: v1.pointIndex, pointIndex2: v2.pointIndex, targetId: v3.objectId, targetPointIndex: v3.pointIndex, targetPointIndex2: v4.pointIndex };
      const newObjects = model.objects.map(o => o.id === v1.objectId ? { ...o, constraints: [...(o.constraints || []), newConstraint] } : o);
      saveToHistory({ ...model, objects: solveConstraints(newObjects, v1.objectId) });
      setSelectedVertices([]);
      return;
    } else if (vertices && vertices.length === 2 && objId) {
      const v1 = vertices[0];
      const v2 = vertices[1];
      const newConstraint = { id: Date.now().toString(), type: 'parallel' as const, targetId: v1.objectId, targetPointIndex: v1.pointIndex, targetPointIndex2: v2.pointIndex };
      const newObjects = model.objects.map(o => o.id === objId ? { ...o, constraints: [...(o.constraints || []), newConstraint] } : o);
      saveToHistory({ ...model, objects: solveConstraints(newObjects, objId) });
      setSelectedVertices([]);
      return;
    }
    
    if (!objId || !targetId) return;
    const obj = model.objects.find(o => o.id === objId);
    const target = model.objects.find(o => o.id === targetId);
    if (!obj || !target || obj.type !== 'line' || target.type !== 'line') return;

    const newConstraint = {
      id: Date.now().toString(),
      type: 'parallel' as const,
      targetId: targetId
    };

    const newObjects = model.objects.map(o => 
      o.id === objId ? { ...o, constraints: [...o.constraints, newConstraint] } : o
    );

    const solvedObjects = solveConstraints(newObjects, objId);
    saveToHistory({
      ...model,
      objects: solvedObjects
    });
  };

  const addTangentConstraint = (objId: string, targetId: string) => {
    const obj = model.objects.find(o => o.id === objId);
    const target = model.objects.find(o => o.id === targetId);
    if (!obj || !target) return;

    // Ensure the constraint is placed on the arc pointing TO the line
    let sourceId = objId;
    let destId = targetId;
    
    if (obj.type === 'line' && (target.type === 'arc' || target.type === 'circle')) {
        sourceId = targetId;
        destId = objId;
    }

    const newConstraint = {
      id: Date.now().toString(),
      type: 'tangent' as const,
      targetId: destId
    };

    const newObjects = model.objects.map(o => 
      o.id === sourceId ? { ...o, constraints: [...o.constraints, newConstraint] } : o
    );

    const solvedObjects = solveConstraints(newObjects, sourceId);
    saveToHistory({
      ...model,
      objects: solvedObjects
    });
  };

  const addPerpendicularConstraint = (objId?: string, targetId?: string, vertices?: { objectId: string, pointIndex: number }[]) => {
    if (vertices && vertices.length >= 4) {
      const v1 = vertices[0];
      const v2 = vertices[1];
      const v3 = vertices[2];
      const v4 = vertices[3];
      const newConstraint = { id: Date.now().toString(), type: 'perpendicular' as const, pointIndex: v1.pointIndex, pointIndex2: v2.pointIndex, targetId: v3.objectId, targetPointIndex: v3.pointIndex, targetPointIndex2: v4.pointIndex };
      const newObjects = model.objects.map(o => o.id === v1.objectId ? { ...o, constraints: [...(o.constraints || []), newConstraint] } : o);
      saveToHistory({ ...model, objects: solveConstraints(newObjects, v1.objectId) });
      setSelectedVertices([]);
      return;
    } else if (vertices && vertices.length === 2 && objId) {
      const v1 = vertices[0];
      const v2 = vertices[1];
      const newConstraint = { id: Date.now().toString(), type: 'perpendicular' as const, targetId: v1.objectId, targetPointIndex: v1.pointIndex, targetPointIndex2: v2.pointIndex };
      const newObjects = model.objects.map(o => o.id === objId ? { ...o, constraints: [...(o.constraints || []), newConstraint] } : o);
      saveToHistory({ ...model, objects: solveConstraints(newObjects, objId) });
      setSelectedVertices([]);
      return;
    }
    
    if (!objId || !targetId) return;
    const obj = model.objects.find(o => o.id === objId);
    const target = model.objects.find(o => o.id === targetId);
    if (!obj || !target || obj.type !== 'line' || target.type !== 'line') return;

    const newConstraint = {
      id: Date.now().toString(),
      type: 'perpendicular' as const,
      targetId: targetId
    };

    const newObjects = model.objects.map(o => 
      o.id === objId ? { ...o, constraints: [...o.constraints, newConstraint] } : o
    );

    const solvedObjects = solveConstraints(newObjects, objId);
    saveToHistory({
      ...model,
      objects: solvedObjects
    });
  };

  const addHorizontalConstraint = (objId?: string, vertices?: { objectId: string, pointIndex: number }[]) => {
    if (vertices && vertices.length === 2) {
      const obj1 = model.objects.find(o => o.id === vertices[0].objectId);
      if (!obj1) return;
      const newConstraint = {
        id: Date.now().toString(),
        type: 'horizontal' as const,
        pointIndex: vertices[0].pointIndex,
        targetId: vertices[1].objectId,
        targetPointIndex: vertices[1].pointIndex
      };
      const newObjects = model.objects.map(o => 
        o.id === vertices[0].objectId ? { ...o, constraints: [...(o.constraints || []), newConstraint] } : o
      );
      const solvedObjects = solveConstraints(newObjects, vertices[0].objectId);
      saveToHistory({ ...model, objects: solvedObjects });
      setSelectedVertices([]);
      return;
    }
    
    if (objId) {
      const obj = model.objects.find(o => o.id === objId);
      if (!obj || obj.type !== 'line') return;

      const newConstraint = {
        id: Date.now().toString(),
        type: 'horizontal' as const,
        pointIndex: 0,
        targetPointIndex: 1
      };

      const newObjects = model.objects.map(o => 
        o.id === objId ? { ...o, constraints: [...(o.constraints || []), newConstraint] } : o
      );

      const solvedObjects = solveConstraints(newObjects, objId);
      saveToHistory({
        ...model,
        objects: solvedObjects
      });
    }
  };

  const addVerticalConstraint = (objId?: string, vertices?: { objectId: string, pointIndex: number }[]) => {
    if (vertices && vertices.length === 2) {
      const obj1 = model.objects.find(o => o.id === vertices[0].objectId);
      if (!obj1) return;
      const newConstraint = {
        id: Date.now().toString(),
        type: 'vertical' as const,
        pointIndex: vertices[0].pointIndex,
        targetId: vertices[1].objectId,
        targetPointIndex: vertices[1].pointIndex
      };
      const newObjects = model.objects.map(o => 
        o.id === vertices[0].objectId ? { ...o, constraints: [...(o.constraints || []), newConstraint] } : o
      );
      const solvedObjects = solveConstraints(newObjects, vertices[0].objectId);
      saveToHistory({ ...model, objects: solvedObjects });
      setSelectedVertices([]);
      return;
    }
    
    if (objId) {
      const obj = model.objects.find(o => o.id === objId);
      if (!obj || obj.type !== 'line') return;

      const newConstraint = {
        id: Date.now().toString(),
        type: 'vertical' as const,
        pointIndex: 0,
        targetPointIndex: 1
      };

      const newObjects = model.objects.map(o => 
        o.id === objId ? { ...o, constraints: [...(o.constraints || []), newConstraint] } : o
      );

      const solvedObjects = solveConstraints(newObjects, objId);
      saveToHistory({
        ...model,
        objects: solvedObjects
      });
    }
  };

  const addEqualConstraint = (objId?: string, targetId?: string, vertices?: { objectId: string, pointIndex: number }[], allIds?: string[]) => {
    if (vertices && vertices.length >= 4) {
      const v1 = vertices[0];
      const v2 = vertices[1];
      const v3 = vertices[2];
      const v4 = vertices[3];
      const newConstraint = { id: Date.now().toString(), type: 'equal' as const, pointIndex: v1.pointIndex, pointIndex2: v2.pointIndex, targetId: v3.objectId, targetPointIndex: v3.pointIndex, targetPointIndex2: v4.pointIndex };
      const newObjects = model.objects.map(o => o.id === v1.objectId ? { ...o, constraints: [...(o.constraints || []), newConstraint] } : o);
      saveToHistory({ ...model, objects: solveConstraints(newObjects, v1.objectId) });
      setSelectedVertices([]);
      return;
    } else if (vertices && vertices.length === 2 && objId) {
      const v1 = vertices[0];
      const v2 = vertices[1];
      const newConstraint = { id: Date.now().toString(), type: 'equal' as const, targetId: v1.objectId, targetPointIndex: v1.pointIndex, targetPointIndex2: v2.pointIndex };
      const newObjects = model.objects.map(o => o.id === objId ? { ...o, constraints: [...(o.constraints || []), newConstraint] } : o);
      saveToHistory({ ...model, objects: solveConstraints(newObjects, objId) });
      setSelectedVertices([]);
      return;
    }

    // Handle Multi-Object Equal (Daisy-chaining)
    if (allIds && allIds.length >= 2) {
      let currentObjects = model.objects;
      for (let i = 0; i < allIds.length - 1; i++) {
        const id1 = allIds[i];
        const id2 = allIds[i+1];
        const newConstraint = {
          id: (Date.now() + i).toString(),
          type: 'equal' as const,
          targetId: id2
        };
        currentObjects = currentObjects.map(o => 
          o.id === id1 ? { ...o, constraints: [...(o.constraints || []), newConstraint] } : o
        );
      }
      saveToHistory({ ...model, objects: solveConstraints(currentObjects, allIds[0]) });
      return;
    }
    
    if (!objId || !targetId) return;
    const obj = model.objects.find(o => o.id === objId);
    const target = model.objects.find(o => o.id === targetId);
    if (!obj || !target) return; // Removed Line-Only constraint check to allow Arc/Circle radius equality

    const newConstraint = {
      id: Date.now().toString(),
      type: 'equal' as const,
      targetId: targetId
    };

    const newObjects = model.objects.map(o => 
      o.id === objId ? { ...o, constraints: [...(o.constraints || []), newConstraint] } : o
    );

    const solvedObjects = solveConstraints(newObjects, objId);
    saveToHistory({
      ...model,
      objects: solvedObjects
    });
  };

  const addFixedConstraint = (objId: string, pointIndex?: number) => {
    const obj = model.objects.find(o => o.id === objId);
    if (!obj) return;

    const newConstraint = {
      id: Date.now().toString(),
      type: 'fixed' as const,
      pointIndex: pointIndex,
      fixedX: pointIndex !== undefined ? obj.points[pointIndex].x : undefined,
      fixedY: pointIndex !== undefined ? obj.points[pointIndex].y : undefined,
      fixedPoints: pointIndex === undefined ? obj.points.map(p => ({x: p.x, y: p.y})) : undefined
    };

    const newObjects = model.objects.map(o => 
      o.id === objId ? { ...o, constraints: [...o.constraints, newConstraint] } : o
    );

    const solvedObjects = solveConstraints(newObjects, objId);
    saveToHistory({
      ...model,
      objects: solvedObjects
    });
    setSelectedVertices([]);
  };

  const removeConstraint = (objectId: string, constraintId: string) => {
    saveToHistory({
      ...model,
      objects: model.objects.map(o => o.id === objectId ? { ...o, constraints: o.constraints.filter(c => c.id !== constraintId) } : o),
      dimensions: model.dimensions.filter(d => !constraintId.startsWith(d.id))
    });
    if (selectedConstraintId === constraintId) {
      setSelectedConstraintId(null);
    }
  };

  const setActiveSketch = (id: string) => {
    setModel(prev => ({ ...prev, activeSketchId: id }));
  };

  const clearModel = () => {
    saveToHistory({
      objects: [],
      layers: [INITIAL_LAYER],
      sketches: [INITIAL_SKETCH],
      bodies: [INITIAL_BODY],
      dimensions: [],
      activeLayerId: 'layer-0',
      activeSketchId: 'sketch-0',
      activeBodyId: 'body-0',
    });
  };

  const executeCommand = async (cmd: string) => {
    setCommandHistory(prev => [...prev, cmd]);
    const parts = cmd.toLowerCase().split(' ');
    const action = parts[0];

    switch (action) {
      case 'ask':
      case 'ai':
        const prompt = parts.slice(1).join(' ');
        if (prompt) {
          setLastAIResponse('Thinking...');
          try {
            const response = await askGemini(prompt, settings.thinkingMode);
            setLastAIResponse(response);
          } catch (error: any) {
            setLastAIResponse(`Error: ${error.message}`);
          }
        }
        break;
      case 'l':
      case 'line':
        updateSettings({ activeTool: 'line' });
        break;
      case 'c':
      case 'circle':
        updateSettings({ activeTool: 'circle' });
        break;
      case 'r':
      case 'rect':
        updateSettings({ activeTool: 'rectangle' });
        break;
      case 'p':
      case 'point':
        updateSettings({ activeTool: 'point' });
        break;
      case 'u':
      case 'undo':
        undo();
        break;
      case 're':
      case 'redo':
        redo();
        break;
      case 'clear':
        clearModel();
        break;
      default:
        console.log('Unknown command:', cmd);
    }
  };

  return (
    <SettingsContext.Provider value={{ 
      settings, 
      updateSettings, 
      model, 
      addObject, 
      addObjects,
      removeObject, 
      removeObjects,
      updateObject,
      addDimension,
      updateDimension,
      removeDimension,
      toggleDimensionReference,
      addLayer,
      removeLayer,
      setActiveLayer,
      addSketch,
      removeSketch,
      updateSketch,
      setActiveSketch,
      addFeature,
      removeFeature,
      updateFeature,
      setActiveFeature,
      addBody,
      removeBody,
      updateBody,
      setActiveBody,
      addBox3D,
      addCylinder3D,
      addSphere3D,
      addCone3D,
      selectedVertices,
      setSelectedVertices,
      selectedObjectIds,
      setSelectedObjectIds,
      addCoincidentConstraint,
      addParallelConstraint,
      addPerpendicularConstraint,
      addHorizontalConstraint,
      addVerticalConstraint,
      addEqualConstraint,
      addFixedConstraint,
      addTangentConstraint,
      undo,
      redo,
      clearModel,
      solveConstraints,
      commandHistory,
      executeCommand,
      updateObjectLive,
      updateModel,
      removeConstraint,
      lastAIResponse,
      setLastAIResponse,
      selectedConstraintId,
      setSelectedConstraintId,
      pythonState,
      runPython,
      geometry3D,
      addGeometry3D,
      clearGeometry3D,
      mainThreadOC,
      applyMirror
    }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
