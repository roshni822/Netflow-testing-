import { NODE_STYLES, NODE_TYPE_ORDER } from "./nodeStyles";
import NodeTypeIcon from "../../components/NodeTypeIcon";

export default function NodeTypesSidebar({ onAddNode }) {
  return (
    <aside
      aria-label="Node types"
      className="w-44 lg:w-52 shrink-0 border-r border-line bg-surface flex flex-col min-h-0"
    >
      <div className="px-4 pt-4 pb-3 border-b border-line">
        <div className="text-[11px] font-semibold tracking-wider text-fg-muted">
          NODES
        </div>
      </div>

      <ul className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
        {NODE_TYPE_ORDER.map((type) => {
          const s = NODE_STYLES[type];
          return (
            <li key={type}>
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-node-type", type);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAddNode?.(type)}
                title={s.label}
                aria-label={`Add ${s.label} node`}
                className={`group w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-lg border transition cursor-grab active:cursor-grabbing active:scale-[0.99] shadow-sm ${s.chip}`}
              >
                <span
                  className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${s.tile}`}
                >
                  <NodeTypeIcon name={s.icon} />
                </span>
                <span className="min-w-0 flex-1 text-sm font-semibold leading-tight truncate">
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
