import React from 'react';
import { TopNav } from './components/TopNav';
import { RightSidebar } from './components/RightSidebar';
import { Viewport } from './components/Viewport';
import { FloatingDrawPanel } from './components/FloatingDrawPanel';
import { StatusBar } from './components/StatusBar';
import { CommandLine } from './components/CommandLine';
import { Preview3D } from './components/Preview3D';
import { ControlBar } from './components/ControlBar';
import { useSettings } from './contexts/SettingsContext';
import { initOCCT } from './lib/occt';

export default function App() {
  const { settings, updateSettings, setSelectedObjectIds, setSelectedVertices, removeObjects, selectedObjectIds, undo, redo } = useSettings();

  React.useEffect(() => {
    initOCCT();
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      if (e.key === 'Alt') {
        e.preventDefault();
        updateSettings({ 
          isAltPressed: true,
          mirrorSession: settings.activeTool === 'mirror' ? {
            ...(settings.mirrorSession || { selectedIds: [], isSelectingLine: false }),
            isSelectingLine: true
          } : settings.mirrorSession
        });
      }

      if (e.key === 'Escape') {
        updateSettings({ 
          activeTool: 'select',
          mirrorSession: { selectedIds: [], isSelectingLine: false, mirrorLineId: undefined } 
        });
        setSelectedObjectIds([]);
        setSelectedVertices([]);
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedObjectIds.length > 0) {
          removeObjects(selectedObjectIds);
          setSelectedObjectIds([]);
        }
      }

      // Undo: Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        redo();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        updateSettings({ 
          isAltPressed: false,
          mirrorSession: settings.activeTool === 'mirror' ? {
            ...(settings.mirrorSession || { selectedIds: [], isSelectingLine: false }),
            isSelectingLine: false
          } : settings.mirrorSession
        });
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [updateSettings, setSelectedObjectIds, setSelectedVertices, removeObjects, selectedObjectIds, undo, redo, settings]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-neutral-bg">
      <TopNav />
      
      <div className="flex flex-1 min-h-0">
        <main className="flex-1 flex flex-col relative min-w-0">
          {settings.show3DPreview ? <Preview3D /> : <Viewport />}
          <FloatingDrawPanel />
          <CommandLine />
          <ControlBar />
        </main>
        
        <RightSidebar />
      </div>
      
      <StatusBar />
    </div>
  );
}
