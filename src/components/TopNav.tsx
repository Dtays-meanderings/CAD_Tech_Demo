import React from 'react';
import { Settings, User, Download, Upload } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { exportToDXF } from '../lib/dxf-export';
import { importFromDXF } from '../lib/dxf-import';

export const TopNav: React.FC = () => {
  const { model, addObjects } = useSettings() as any; // Using cast to prevent strict context undefined lookup blocking if context wraps heavily

  const handleExport = () => {
    exportToDXF(model);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        try {
          const objects = importFromDXF(text);
          if (objects.length > 0) {
            addObjects(objects);
            alert(`Successfully imported ${objects.length} CAD entities directly into the solver AST.`);
          }
        } catch (err: any) {
          alert('Error importing DXF constraints: ' + err.message);
        }
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input to allow consecutive re-imports identically
  };

  return (
    <div className="h-14 border-b border-border flex items-center justify-between px-4 bg-neutral-bg/80 backdrop-blur-md z-50">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-sm flex items-center justify-center">
            <span className="text-neutral-bg font-bold text-xs">CAD</span>
          </div>
          <span className="font-display font-bold tracking-tight text-lg">2D CAD App</span>
        </div>
        
        <div className="flex items-center gap-2 border-l border-border/40 pl-8">
            <label className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium hover:bg-white/10 rounded-sm cursor-pointer transition-colors text-white/80">
                <Upload className="w-4 h-4" />
                Import DXF
                <input type="file" accept=".dxf" className="hidden" onChange={handleImport} />
            </label>
            <button onClick={handleExport} className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium hover:bg-white/10 rounded-sm cursor-pointer transition-colors text-white/80">
                <Download className="w-4 h-4" />
                Export DXF
            </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <button className="p-2 hover:bg-white/5 rounded-sm transition-colors cursor-pointer">
            <Settings className="w-5 h-5 text-white/60" />
          </button>
          <button className="p-2 hover:bg-white/5 rounded-sm transition-colors cursor-pointer">
            <User className="w-5 h-5 text-white/60" />
          </button>
        </div>
      </div>
    </div>
  );
};
