import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NODE_STYLES } from "./nodeStyles";
import NodeTypeIcon from "../../components/NodeTypeIcon";

export const NODE_W = 180;
export const NODE_H = 68;

const zoomBtnCls =
  "w-8 h-8 inline-flex items-center justify-center rounded-lg border border-line bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg text-sm font-semibold shadow-sm transition";

// The nodes live in a large logical "world". The viewport (the visible box) is
// much smaller — users zoom + pan to navigate big graphs (20+ nodes) instead of
// being clamped to a tiny fixed canvas.
const WORLD_W = 2400;
const WORLD_H = 4000;
const MIN_SCALE = 0.2;
const MAX_SCALE = 2;
const clampScale = (s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

const computeFit = (el, list, { maxScale = 1 } = {}) => {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return null;
    if (!list.length) return { scale: 1, x: 24, y: 24 };

    const padX = Math.max(48, Math.min(96, rect.width * 0.08));
    const padY = Math.max(48, Math.min(96, rect.height * 0.1));
    const minX = Math.min(...list.map((n) => n.x));
    const minY = Math.min(...list.map((n) => n.y));
    const maxX = Math.max(...list.map((n) => n.x + NODE_W));
    const maxY = Math.max(...list.map((n) => n.y + NODE_H));
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const scale = clampScale(
      Math.min(
        maxScale,
        (rect.width - padX * 2) / w,
        (rect.height - padY * 2) / h
      )
    );
    return {
      scale,
      x: (rect.width - w * scale) / 2 - minX * scale,
      y: (rect.height - h * scale) / 2 - minY * scale,
    };
  };

export default function WorkflowEditor({
  nodes,
  connections,
  selectedNodeId,
  onSelectNode,
  onMoveNode,
  onDropNewNode,
  onDeleteNode,
  onAddConnection,
  onDeleteConnection,
  readOnly = false,
  // Bump when the graph is replaced (edit load / template) so we auto-fit again.
  fitKey = 0,
  isMaximized = false,
  onToggleMaximize = null,
  // Live structural problems from graphIssues — highlight + banner on the canvas.
  problemNodeIds = null,
  flowProblems = [],
  onSelectProblem,
}) {
  const containerRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragState, setDragState] = useState(null);
  const [pendingConn, setPendingConn] = useState(null);
  const [hoveredConnIdx, setHoveredConnIdx] = useState(null);
  const [hoverTargetId, setHoverTargetId] = useState(null);
  const [problemsOpen, setProblemsOpen] = useState(true);
  const problemSet = problemNodeIds instanceof Set
    ? problemNodeIds
    : new Set(problemNodeIds || []);

  // view = pan offset (x, y in screen px) + zoom (scale). Kept as one object so
  // wheel/zoom updates stay internally consistent under rapid events.
  const [view, setView] = useState({ scale: 1, x: 24, y: 24 });
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef(null); // { lastX, lastY } while panning
  const didPanRef = useRef(false); // suppress the deselect-click after a pan
  // First paint of this editor session — auto-fit once the canvas has a real size.
  const didInitialFitRef = useRef(false);
  const nodesRef = useRef(nodes);
  useLayoutEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // Convert pointer (client) coordinates into world coordinates.
  const toWorld = (clientX, clientY) => {
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    };
  };

  // Zoom + center so every node fits within the viewport. Cap at 1× so a
  // two-node scratch graph isn't blown up to fill the whole screen.


  const fitView = useCallback(() => {
    const next = computeFit(containerRef.current, nodesRef.current, { maxScale: 1 });
    if (next) setView(next);
  }, []);

  // Wheel-to-zoom, focused on the cursor. Registered natively (passive:false)
  // so we can preventDefault and stop the page from scrolling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const fx = e.clientX - rect.left;
      const fy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setView((v) => {
        const next = clampScale(v.scale * factor);
        const k = next / v.scale;
        return { scale: next, x: fx - (fx - v.x) * k, y: fy - (fy - v.y) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // On first visit (and after the fullscreen layout settles), fit every node
  // into view. ResizeObserver covers the case where the canvas mounts at 0×0
  // before the flex layout assigns height. `fitKey` resets this when the graph
  // is replaced (edit load / template).
  useEffect(() => {
    didInitialFitRef.current = false;
    const el = containerRef.current;
    if (!el) return undefined;

    const tryFit = () => {
      if (didInitialFitRef.current) return;
      const list = nodesRef.current;
      if (!list.length) return;
      const next = computeFit(el, list, { maxScale: 1 });
      if (!next) return;
      didInitialFitRef.current = true;
      setView(next);
    };

    tryFit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(tryFit) : null;
    ro?.observe(el);
    // Layout can settle a frame or two after step-2 becomes fullscreen.
    const t1 = window.setTimeout(tryFit, 50);
    const t2 = window.setTimeout(tryFit, 200);
    return () => {
      ro?.disconnect();
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [fitKey]);

  // Edit mode often mounts with a bootstrap graph, then swaps in the real
  // nodes — if the first fit already ran on empty/bootstrap, retry once.
  useEffect(() => {
    if (didInitialFitRef.current || !nodes.length) return;
    fitView();
  }, [nodes.length, fitView]);

  // Auto-fit when a node is added/removed, or when maximized state changes.
  useEffect(() => {
    if (didInitialFitRef.current && nodes.length > 0) {
      // Small timeout to allow DOM layout to settle if maximized state changed
      const timer = setTimeout(fitView, 50);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, isMaximized, fitView]);

  const zoomAtCenter = (factor) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const fx = rect ? rect.width / 2 : 0;
    const fy = rect ? rect.height / 2 : 0;
    setView((v) => {
      const next = clampScale(v.scale * factor);
      const k = next / v.scale;
      return { scale: next, x: fx - (fx - v.x) * k, y: fy - (fy - v.y) * k };
    });
  };

  const resetView = () => setView({ scale: 1, x: 24, y: 24 });

  const handleNodeMouseDown = (e, node) => {
    if (readOnly) return;
    e.stopPropagation();
    onSelectNode?.(node.id);
    const w = toWorld(e.clientX, e.clientY);
    setDragState({ id: node.id, offsetX: w.x - node.x, offsetY: w.y - node.y });
  };

  // Nodes were mouse-only: a keyboard user couldn't reach one, let alone move
  // or delete it. Arrows nudge by the same 10px grid the drag snaps to (×4 with
  // Shift), Enter/Space selects so the config panel opens, Delete removes.
  const NUDGE = 10;
  const handleNodeKeyDown = (e, node) => {
    if (readOnly) return;
    const step = e.shiftKey ? NUDGE * 4 : NUDGE;
    const nudge = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (nudge) {
      e.preventDefault();
      onSelectNode?.(node.id);
      onMoveNode?.(node.id, Math.max(0, node.x + nudge[0]), Math.max(0, node.y + nudge[1]));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectNode?.(node.id);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onDeleteNode?.(node.id);
    }
  };

  const handleStartConnect = (e, nodeId) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const w = toWorld(e.clientX, e.clientY);
    setPendingConn({
      fromId: nodeId,
      startX: node.x + NODE_W / 2,
      startY: node.y + NODE_H,
      x: w.x,
      y: w.y,
    });
  };

  // Mousedown on empty canvas -> begin panning. Nodes and connection dots call
  // stopPropagation, so this only fires for the background.
  const handleBackgroundMouseDown = (e) => {
    if (dragState || pendingConn) return;
    panRef.current = { lastX: e.clientX, lastY: e.clientY };
    didPanRef.current = false;
    setIsPanning(true);
  };

  const handleMouseMove = (e) => {
    if (dragState) {
      const w = toWorld(e.clientX, e.clientY);
     const x = w.x - dragState.offsetX;
const y = w.y - dragState.offsetY;

      onMoveNode?.(dragState.id, x, y);
      return;
    }
    if (pendingConn) {
      const w = toWorld(e.clientX, e.clientY);
      setPendingConn((prev) => ({ ...prev, x: w.x, y: w.y }));
      const target = nodeAt(w.x, w.y, nodes, pendingConn.fromId);
      setHoverTargetId(target?.id || null);
      return;
    }
    if (panRef.current) {
      const dx = e.clientX - panRef.current.lastX;
      const dy = e.clientY - panRef.current.lastY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didPanRef.current = true;
      panRef.current = { lastX: e.clientX, lastY: e.clientY };
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };

  const endInteractions = (e) => {
    if (dragState) setDragState(null);
    if (pendingConn) {
      const w = toWorld(e.clientX, e.clientY);
      const target = nodeAt(w.x, w.y, nodes, pendingConn.fromId);
      if (target) {
        const exists = connections.some(
          (c) => c.from === pendingConn.fromId && c.to === target.id
        );
        if (!exists) {
          onAddConnection?.({ from: pendingConn.fromId, to: target.id });
        }
      }
      setPendingConn(null);
      setHoverTargetId(null);
    }
    if (panRef.current) {
      panRef.current = null;
      setIsPanning(false);
    }
  };

  const handleBackgroundClick = () => {
    // A drag-pan also fires a click on mouseup — don't let it deselect.
    if (didPanRef.current) {
      didPanRef.current = false;
      return;
    }
    onSelectNode?.(null);
  };

  const problemCount = Array.isArray(flowProblems) ? flowProblems.length : 0;

  return (
    <section className="flex-1 min-w-0 bg-surface-2 flex flex-col relative">
      {!readOnly && problemCount > 0 && (
        <div className="shrink-0 border-b border-danger-line bg-danger-subtle/90 px-4 py-2.5">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 w-5 h-5 rounded-full bg-danger-subtle border border-danger-line text-danger-fg flex items-center justify-center shrink-0" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setProblemsOpen((o) => !o)}
                className="flex items-center gap-1.5 text-left w-full"
                aria-expanded={problemsOpen}
              >
                <span className="text-xs font-semibold text-danger-fg">
                  {problemCount} connection {problemCount === 1 ? 'problem' : 'problems'}
                </span>
                <span className="text-[11px] text-danger-fg/80">
                  {problemsOpen ? 'Hide' : 'Show'}
                </span>
              </button>
              {problemsOpen && (
                <ul className="mt-1.5 space-y-1 max-h-28 overflow-y-auto">
                  {flowProblems.map((issue, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => onSelectProblem?.(issue)}
                        className="text-left text-[11px] text-danger-fg/95 hover:underline leading-snug"
                      >
                        {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-end gap-3 px-4 border-b border-line bg-surface/90 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 shrink-0 rounded-xl border border-line bg-surface-2/80 p-1">
          <button
            type="button"
            onClick={() => zoomAtCenter(1 / 1.2)}
            className={zoomBtnCls}
            title="Zoom out"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={resetView}
            className="h-8 min-w-[3.5rem] px-2 inline-flex items-center justify-center rounded-lg border border-transparent bg-surface text-[11px] font-semibold text-fg hover:bg-surface-2 transition"
            title="Reset zoom to 100%"
          >
            {Math.round(view.scale * 100)}%
          </button>
          <button
            type="button"
            onClick={() => zoomAtCenter(1.2)}
            className={zoomBtnCls}
            title="Zoom in"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={fitView}
            className="ml-0.5 h-8 px-3 inline-flex items-center justify-center rounded-lg bg-indigo-600 hover:bg-indigo-700 text-[11px] font-semibold text-white shadow-sm transition"
            title="Fit all nodes in view"
          >
            Fit
          </button>
          {onToggleMaximize && (
            <button
              type="button"
              onClick={onToggleMaximize}
              className="ml-1 w-8 h-8 inline-flex items-center justify-center rounded-lg border border-transparent hover:border-line bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg text-sm font-semibold transition"
              title={isMaximized ? "Restore view" : "Maximize view"}
              aria-label={isMaximized ? "Restore view" : "Maximize view"}
            >
              {isMaximized ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9V4.5M15 9h4.5M15 9l5.25-5.25M15 15v4.5M15 15h4.5M15 15l5.25 5.25" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9m5.25 11.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className={`relative flex-1 min-h-0 overflow-hidden ${
          isPanning ? "cursor-grabbing" : "cursor-grab"
        } ${isDragOver ? "ring-2 ring-inset ring-indigo-400/60" : ""}`}
        onMouseDown={handleBackgroundMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endInteractions}
        onMouseLeave={endInteractions}
        onClick={handleBackgroundClick}
        onDragOver={(e) => {
          if (readOnly) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          if (readOnly) return;
          e.preventDefault();
          setIsDragOver(false);
          const type = e.dataTransfer.getData("application/x-node-type");
          if (!type) return;
          const w = toWorld(e.clientX, e.clientY);
          const x = Math.max(0, Math.min(WORLD_W - NODE_W, w.x - NODE_W / 2));
          const y = Math.max(0, Math.min(WORLD_H - NODE_H, w.y - NODE_H / 2));
          onDropNewNode?.(type, x, y);
        }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            width: WORLD_W,
            height: WORLD_H,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <DottedBackground />

          <svg
            className="absolute inset-0"
            width={WORLD_W}
            height={WORLD_H}
            style={{ pointerEvents: "none" , overflow:"visible" }}
          >
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill="var(--color-fg-subtle)" />
              </marker>
              <marker
                id="arrow-dashed"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill="var(--color-line)" />
              </marker>
              <marker
                id="arrow-hover"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill="#f43f5e" />
              </marker>
              <marker
                id="arrow-approve"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill="#10b981" />
              </marker>
              <marker
                id="arrow-reject"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill="#ef4444" />
              </marker>
            </defs>

            {connections.map((c, idx) => {
              const from = nodes.find((n) => n.id === c.from);
              const to = nodes.find((n) => n.id === c.to);
              if (!from || !to) return null;
              const d = pathFor(from, to);
              const isHovered = hoveredConnIdx === idx;

              let strokeColor, marker;
              if (isHovered) {
                strokeColor = "#f43f5e";
                marker = "url(#arrow-hover)";
              } else if (c.branch === "approve") {
                strokeColor = "#10b981";
                marker = "url(#arrow-approve)";
              } else if (c.branch === "reject") {
                strokeColor = "#ef4444";
                marker = "url(#arrow-reject)";
              } else if (c.dashed) {
                strokeColor = "#cbd5e1";
                marker = "url(#arrow-dashed)";
              } else {
                strokeColor = "#94a3b8";
                marker = "url(#arrow)";
              }
              return (
                <g key={idx}>
                  {!readOnly && (
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      style={{ pointerEvents: "stroke", cursor: "pointer" }}
                      onMouseEnter={() => setHoveredConnIdx(idx)}
                      onMouseLeave={() => setHoveredConnIdx(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteConnection?.(idx);
                        setHoveredConnIdx(null);
                      }}
                    >
                      <title>Click to delete connection</title>
                    </path>
                  )}

                  <path
                    d={d}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={isHovered ? 2 : 1.6}
                    strokeDasharray={
                      c.dashed || c.branch === "reject" ? "5 4" : undefined
                    }
                    markerEnd={marker}
                    style={{ pointerEvents: "none" }}
                  />
                </g>
              );
            })}

            {pendingConn && (
              <path
                d={`M ${pendingConn.startX} ${pendingConn.startY} L ${pendingConn.x} ${pendingConn.y}`}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={1.8}
                strokeDasharray="4 3"
                style={{ pointerEvents: "none" }}
              />
            )}
          </svg>

          {nodes.map((node) => (
            <WorkflowNode
              key={node.id}
              node={node}
              selected={selectedNodeId === node.id}
              hasProblem={problemSet.has(node.id)}
              isPendingTarget={hoverTargetId === node.id}
              isPendingSource={pendingConn?.fromId === node.id}
              onMouseDown={(e) => handleNodeMouseDown(e, node)}
              onKeyDown={(e) => handleNodeKeyDown(e, node)}
              onStartConnect={(e) => handleStartConnect(e, node.id)}
              onDelete={() => onDeleteNode?.(node.id)}
              readOnly={readOnly}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function WorkflowNode({
  node,
  selected,
  hasProblem = false,
  isPendingTarget,
  isPendingSource,
  onMouseDown,
  onKeyDown,
  onStartConnect,
  onDelete,
  readOnly = false,
}) {
  const s = NODE_STYLES[node.type] || NODE_STYLES.start;
  const cursorCls = readOnly
    ? "cursor-default"
    : selected
    ? `ring-2 ${s.ring} shadow-md cursor-grabbing`
    : "cursor-grab hover:shadow-md";
  const problemCls = hasProblem && !selected
    ? "ring-2 ring-rose-500/80 shadow-md"
    : hasProblem && selected
      ? "ring-2 ring-rose-500"
      : "";
  return (
    <div
      onMouseDown={readOnly ? undefined : onMouseDown}
      onKeyDown={readOnly ? undefined : onKeyDown}
      onClick={(e) => e.stopPropagation()}
      role={readOnly ? undefined : "button"}
      tabIndex={readOnly ? undefined : 0}
      aria-pressed={readOnly ? undefined : selected}
      aria-invalid={hasProblem || undefined}
      aria-label={readOnly ? undefined : `${node.title}${node.subtitle ? `, ${node.subtitle}` : ''}${hasProblem ? '. Connection problem' : ''}. Arrow keys to move, Delete to remove.`}
      className={`group absolute select-none rounded-xl border px-3 py-2.5 shadow-sm backdrop-blur-[2px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${s.card} ${cursorCls} ${problemCls} ${
        !readOnly && isPendingTarget ? "ring-2 ring-indigo-500/70 shadow-md" : ""
      } ${hasProblem ? "border-rose-400 dark:border-rose-500/70" : ""}`}
      style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
    >
      {hasProblem && (
        <span
          className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-sm"
          title="Connection problem"
          aria-hidden="true"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </span>
      )}
      <div className="flex items-center gap-2.5 h-full">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${s.tile}`}>
          <NodeTypeIcon name={s.icon} className="w-4 h-4" />
        </span>
        <div className="min-w-0 text-left">
          <div className={`text-[13px] font-semibold truncate leading-tight ${s.title}`}>{node.title}</div>
          <div className={`text-[11px] mt-0.5 truncate leading-tight ${s.subtitle}`}>{node.subtitle}</div>
        </div>
      </div>

      {!readOnly && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 -top-1.5 w-3 h-3 rounded-full bg-surface border-2 transition ${
            isPendingTarget
              ? "border-indigo-500 scale-125"
              : "border-line group-hover:border-fg-subtle"
          }`}
        />
      )}

      {!readOnly && (
        <div
          onMouseDown={onStartConnect}
          title="Drag to connect"
          className={`absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 rounded-full bg-surface border-2 transition cursor-crosshair hover:scale-125 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 ${
            isPendingSource
              ? "border-indigo-600 scale-125 bg-indigo-50 dark:bg-indigo-500/20"
              : "border-line hover:border-indigo-500"
          }`}
        />
      )}

      {!readOnly && selected && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete node"
          aria-label={`Delete ${node.title}`}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-surface border border-line text-fg-muted hover:text-danger-fg hover:border-danger-line shadow-sm text-[11px] leading-none flex items-center justify-center"
        >
          ×
        </button>
      )}
    </div>
  );
}

function DottedBackground() {
  return (
    <svg
      className="absolute inset-0"
      width="100%"
      height="100%"
      style={{ pointerEvents: "none" }}
    >
      <defs>
        <pattern
          id="dots"
          x="0"
          y="0"
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1.25" cy="1.25" r="1.1" fill="var(--color-line)" opacity="0.85" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="var(--color-surface-2)" />
      <rect width="100%" height="100%" fill="url(#dots)" />
    </svg>
  );
}

function pathFor(from, to) {
  const fromX = from.x + NODE_W / 2;
  const fromY = from.y + NODE_H;
  const toX = to.x + NODE_W / 2;
  const toY = to.y;

  if (Math.abs(fromX - toX) < 4) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  const midY = fromY + Math.max(20, (toY - fromY) / 2);
  return `M ${fromX} ${fromY} L ${fromX} ${midY} L ${toX} ${midY} L ${toX} ${toY}`;
}

function nodeAt(x, y, nodes, excludeId) {
  return nodes.find(
    (n) =>
      n.id !== excludeId &&
      x >= n.x &&
      x <= n.x + NODE_W &&
      y >= n.y &&
      y <= n.y + NODE_H
  );
}
