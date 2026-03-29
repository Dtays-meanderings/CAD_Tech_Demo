import React from 'react';
import { 
  MousePointer2, Pencil, PenTool, Activity, Layers
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';

const toolsConfig = [
  { id: 'select', icon: MousePointer2, label: 'SELECT' },
  { id: 'draw', icon: Pencil, label: 'DRAW' },
  { id: 'modify', icon: PenTool, label: 'MODIFY' },
  { id: 'analyze', icon: Activity, label: 'ANALYZE' },
  { id: 'layers', icon: Layers, label: 'LAYERS' },
];

export const LeftSidebar: React.FC = () => {
  const { settings, updateSettings } = useSettings();

  const isSelectActive = settings.activeTool === 'select';

  return (
    <div className="w-20 border-r border-border flex flex-col items-center py-6 gap-8 bg-neutral-bg z-50">
      <div className="text-[10px] font-bold text-white/20 tracking-widest uppercase mb-2">
        Toolbox
      </div>
      
      <div className="flex flex-col gap-4 w-full px-2">
        {toolsConfig.map((tool) => {
          const isActive = tool.id === 'select' ? isSelectActive : (tool.id === 'draw' ? !isSelectActive : false);

          return (
            <div key={tool.id} className="relative group w-full">
              <button
                onClick={() => {
                  if (tool.id === 'select') updateSettings({ activeTool: 'select' });
                  // Future: open drawing panel, layer panel, etc.
                }}
                className={cn(
                  "w-full flex flex-col items-center gap-1.5 py-3 rounded-sm transition-all relative",
                  isActive
                    ? "bg-primary/10 text-primary border-r-2 border-primary" 
                    : "text-white/40 hover:text-white hover:bg-white/5"
                )}
              >
                <tool.icon className={cn("w-6 h-6", isActive ? "text-primary" : "text-white/40 group-hover:text-white")} />
                <span className="text-[9px] font-bold tracking-tighter">{tool.label}</span>
                
                {isActive && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-l-full" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
