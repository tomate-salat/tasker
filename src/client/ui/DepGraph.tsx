/**
 * Das Abhängigkeits-Board: ein Graph mit React Flow, geöffnet aus dem
 * Inspektor heraus wie der Zeichen-Editor. Links stehen alle aktiven Tasks und
 * Milestones des Projekts als Baum, von dort kommen sie per Drag & Drop aufs
 * Board; rechts werden sie verbunden.
 *
 * Das Board zeigt einen Ausschnitt: von einem Task aus alles, was er in jeder
 * Tiefe benötigt und was auf ihn wartet; von einem Milestone aus dasselbe für
 * ihn und seine Tasks – die der obersten Ebene immer, auch ohne Pfeile. Was
 * nur daneben hängt, fehlt.
 *
 * Die Pfeile sind die `deps` selbst – ein Pfeil von A nach B heißt „B benötigt
 * A“. Gespeichert wird zusätzlich, wo die Knoten liegen und wie die Pfeile aus
 * „Neu anordnen“ verlaufen (`graphElk.ts`) – je Ausgangspunkt. Wird ein Knoten
 * verschoben, fallen seine Pfeile auf die einfache Stufenform zurück.
 *
 * Das Modul wird nachgeladen, damit React Flow nicht im Startpaket steckt.
 */
import '@xyflow/react/dist/style.css';
import {
  Background,
  BaseEdge,
  ConnectionLineType,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  getSmoothStepPath,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnBeforeDelete,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dependsOn } from '@shared/blocking.js';
import { dependencyScope, type Pos } from '@shared/graphLayout.js';
import { isArchived, isDone, type Milestone, type Task } from '@shared/model.js';
import { draftMilestones, plannedMilestones } from '@shared/outline.js';
import { milestoneDone, milestoneProgressPct } from '@shared/progress.js';
import type { Workspace } from '@shared/workspace.js';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { CardFace } from './Cards.js';
import { edgeKey, elkLayout, fitRoute, roundedPath, type Layout } from './graphElk.js';
import { DEFAULT_MARK, MS_STATUS, STATUS_LABEL } from './icons.js';
import { Inspector } from './Inspector.js';
import { useMenu, type MenuItem } from './Menu.js';
import { milestoneMenu, taskMenu } from './rowMenu.js';

type Item = Task | Milestone;
type ItemNode = Node<{ item: Item; sub: string; done: boolean; focus: boolean }, 'item'>;
type RoutedEdge = Edge<{ route?: Pos[] }, 'routed'>;

const isMs = (x: Item): x is Milestone => 'planned' in x;
const kindOf = (x: Item): 'task' | 'milestone' => (isMs(x) ? 'milestone' : 'task');
/** Der Datentyp beim Ziehen aus der Liste aufs Board. */
const DRAG_TYPE = 'application/x-tasker-graph';
/** Größe eines Knotens – so breit wie die Karten der Kartenansicht. */
const CARD_W = 142;
const CARD_H = 176;
/** Wie lange nach dem letzten Verschieben die Positionen gespeichert werden. */
const SAVE_AFTER_MS = 600;

const dark = (): boolean =>
  document.documentElement.dataset['theme'] === 'dark' ||
  (document.documentElement.dataset['theme'] !== 'light' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches);

export default function DepGraph() {
  const graphOpen = useStore((s) => s.graphOpen);
  const ws = useStore((s) => s.ws);
  if (!graphOpen || !ws) return null;
  return (
    <ReactFlowProvider>
      <Board
        key={graphOpen.focusId}
        ws={ws}
        projectId={graphOpen.projectId}
        focusId={graphOpen.focusId}
      />
    </ReactFlowProvider>
  );
}

/**
 * Wann darf `target` auf `source` warten? Ein Milestone wartet nur auf
 * Milestones, Kreise und Doppelte gibt es nicht. Gibt den Grund zurück, wenn nicht.
 */
function refusal(ws: Workspace, source: Item, target: Item): string | null {
  if (source.id === target.id) return 'Ein Eintrag kann nicht auf sich selbst warten.';
  if (isMs(target) && !isMs(source)) return 'Ein Milestone kann nur auf Milestones warten.';
  if (target.deps.includes(source.id)) return 'Diese Abhängigkeit gibt es schon.';
  if (dependsOn(ws, source, target.id)) return 'Das ergäbe einen Kreis.';
  return null;
}

function Board({ ws, projectId, focusId }: { ws: Workspace; projectId: string; focusId: string }) {
  const { openGraph, patch, say, undo, select, selected } = useStore();
  const menu = useMenu();
  const flow = useReactFlow();
  const focus = ws.task(focusId) ?? ws.milestone(focusId);

  // Alles Aktive des Projekts; Doku-Seiten sind keine Aufgaben.
  const items = useMemo(() => {
    const tasks = ws.tasks.filter((t) => t.projectId === projectId && ws.isActive(t) && !ws.isDoc(t));
    const milestones = ws.milestones.filter((m) => m.projectId === projectId && !isArchived(m));
    return new Map<string, Item>([...milestones, ...tasks].map((x) => [x.id, x]));
  }, [ws, projectId]);

  const links = useMemo(() => {
    const out: { source: string; target: string }[] = [];
    for (const x of items.values()) {
      for (const d of x.deps) if (items.has(d)) out.push({ source: d, target: x.id });
    }
    return out;
  }, [items]);

  /* ------------------------------------------------ Positionen & Speichern */

  const [layout, setLayout] = useState<Layout | null>(null);
  const pos = layout?.nodes ?? null;
  useEffect(() => {
    let alive = true;
    void api
      .graph(focusId)
      .then((g) => alive && setLayout({ nodes: g.nodes, edges: g.edges ?? {} }))
      .catch((e: unknown) => {
        if (!alive) return;
        say(e instanceof Error ? e.message : 'Board konnte nicht geladen werden');
        setLayout({ nodes: {}, edges: {} });
      });
    return () => {
      alive = false;
    };
  }, [focusId, say]);

  const saveTimer = useRef<number | undefined>(undefined);
  const save = useCallback(
    (next: Layout) => {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void api.putGraph(focusId, next).catch((e: unknown) => {
          say(e instanceof Error ? e.message : 'Board konnte nicht gespeichert werden');
        });
      }, SAVE_AFTER_MS);
    },
    [focusId, say],
  );
  /**
   * Knoten setzen. Ein Pfeil, dessen Enden sich dabei bewegen, verliert seinen
   * berechneten Verlauf – der passte nicht mehr.
   */
  const place = useCallback(
    (update: (prev: Record<string, Pos>) => Record<string, Pos>) => {
      setLayout((prev) => {
        const before = prev?.nodes ?? {};
        const nodes = update(before);
        const same = (id: string): boolean =>
          !!nodes[id] && nodes[id]!.x === before[id]?.x && nodes[id]!.y === before[id]?.y;
        const edges = Object.fromEntries(
          Object.entries(prev?.edges ?? {}).filter(([k]) => {
            const [s, t] = k.split('>');
            return same(s!) && same(t!);
          }),
        );
        const next = { nodes, edges };
        save(next);
        return next;
      });
    },
    [save],
  );

  /** Die Größe eines Knotens, wie er gezeichnet ist – vor dem Zeichnen die der Karten. */
  const sized = useCallback(
    (id: string) => {
      const m = flow.getNode(id)?.measured;
      return { id, width: m?.width ?? CARD_W, height: m?.height ?? CARD_H };
    },
    [flow],
  );

  // Der Ausschnitt: ein Task allein; ein Milestone mit all seinen Tasks der
  // obersten Ebene (auch ohne Abhängigkeiten) und den Unteraufgaben, die welche
  // haben – dazu alles, was sie benötigen und was auf sie wartet.
  const scope = useMemo(() => {
    const seeds = [focusId];
    const m = ws.milestone(focusId);
    if (m) {
      const linked = new Set(links.flatMap((l) => [l.source, l.target]));
      for (const r of ws.msRoots(m)) {
        seeds.push(r.id);
        for (const d of ws.desc(r)) if (linked.has(d.id)) seeds.push(d.id);
      }
    }
    return dependencyScope(seeds, links);
  }, [ws, focusId, links]);

  // Was in dieser Sitzung aus der Liste dazukam – oder durch einen gelöschten
  // Pfeil aus dem Ausschnitt fiele: es bleibt liegen, bis das Board zugeht.
  const [added, setAdded] = useState<Set<string>>(() => new Set());

  const boardIds = useMemo(() => {
    if (!pos) return [];
    return [...items.keys()].filter((id) => scope.has(id) || added.has(id));
  }, [pos, items, scope, added]);
  const onBoard = useMemo(() => new Set(boardIds), [boardIds]);

  // Was noch keinen Platz hat, bekommt einen: beim ersten Öffnen ordnet ELK
  // alles an, samt Pfeilen. Kommt später etwas dazu, landet es unter dem, was
  // schon liegt – das Bestehende springt nicht herum.
  const placing = useRef(false);
  useEffect(() => {
    if (!pos || placing.current) return;
    const missing = boardIds.filter((id) => !pos[id]);
    if (!missing.length) return;
    const fresh = missing.length === boardIds.length;
    placing.current = true;
    void elkLayout(boardIds.map(sized), links)
      .then((auto) => {
        if (fresh) {
          setLayout(auto);
          save(auto);
          window.setTimeout(() => void flow.fitView({ maxZoom: 1.2 }), 50);
          return;
        }
        const placed = boardIds.filter((id) => pos[id]).map((id) => pos[id]!.y + sized(id).height);
        const top = placed.length ? Math.max(...placed) + 80 : 0;
        const minY = Math.min(...missing.map((id) => auto.nodes[id]!.y));
        place((prev) => {
          const next = { ...prev };
          for (const id of missing) next[id] = { x: auto.nodes[id]!.x, y: auto.nodes[id]!.y - minY + top };
          return next;
        });
      })
      .catch((e: unknown) => say(e instanceof Error ? e.message : 'Anordnen fehlgeschlagen'))
      .finally(() => {
        placing.current = false;
      });
  }, [pos, boardIds, links, place, save, sized, flow, say]);

  /* ----------------------------------------------------- Knoten & Pfeile */

  const [nodes, setNodes] = useState<ItemNode[]>([]);
  useEffect(() => {
    if (!pos) return;
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return boardIds
        .filter((id) => pos[id])
        .map((id): ItemNode => {
          const item = items.get(id)!;
          return {
            ...(old.get(id) ?? { id, type: 'item' as const }),
            position: pos[id]!,
            data: {
              item,
              sub: subtitle(ws, item),
              done: isMs(item) ? milestoneDone(ws, item) : isDone(item),
              focus: id === focusId,
            },
          };
        });
    });
  }, [pos, boardIds, items, ws, focusId]);

  const routes = layout?.edges;
  const [edges, setEdges] = useState<RoutedEdge[]>([]);
  useEffect(() => {
    setEdges((prev) => {
      const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return links.filter((l) => onBoard.has(l.source) && onBoard.has(l.target)).map((l): RoutedEdge => {
        const id = edgeKey(l.source, l.target);
        const src = items.get(l.source)!;
        const done = isMs(src) ? milestoneDone(ws, src) : isDone(src);
        return {
          id,
          type: 'routed',
          data: { route: routes?.[id] },
          source: l.source,
          target: l.target,
          selected: selected.has(id),
          className: done ? 'done' : '',
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
        };
      });
    });
  }, [links, items, ws, onBoard, routes]);

  const onNodesChange = useCallback(
    (changes: NodeChange<ItemNode>[]) =>
      // Entfernt wird nur über `onBeforeDelete`, nicht hier.
      setNodes((n) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), n)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<RoutedEdge>[]) =>
      setEdges((e) => applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), e)),
    [],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, __: Node, dragged: Node[]) =>
      place((prev) => {
        const next = { ...prev };
        for (const n of dragged) next[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
        return next;
      }),
    [place],
  );

  /* ------------------------------------------------ Verbinden & Entfernen */

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const s = items.get(c.source);
      const t = items.get(c.target);
      return !!s && !!t && !refusal(ws, s, t);
    },
    [items, ws],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const s = items.get(c.source);
      const t = items.get(c.target);
      if (!s || !t) return;
      const why = refusal(ws, s, t);
      if (why) {
        say(why);
        return;
      }
      void patch(kindOf(t), t.id, { deps: [...t.deps, s.id] });
    },
    [items, ws, patch, say],
  );

  /**
   * Entf löscht ausgewählte Pfeile (also Abhängigkeiten) und nimmt ausgewählte
   * Knoten vom Board. Was über Abhängigkeiten zum Ausschnitt gehört, bleibt
   * liegen – sonst wäre es beim nächsten Öffnen ohnehin wieder da. React Flow
   * selbst entfernt nichts: das Board zeigt immer die Daten.
   */
  const onBeforeDelete: OnBeforeDelete<ItemNode, RoutedEdge> = useCallback(
    async ({ nodes: gone, edges: goneEdges }) => {
      const cut = goneEdges.filter((e) => e.selected);
      const byTarget = new Map<string, Set<string>>();
      for (const e of cut) {
        const set = byTarget.get(e.target) ?? new Set<string>();
        byTarget.set(e.target, set.add(e.source));
      }
      for (const [targetId, sources] of byTarget) {
        const t = items.get(targetId);
        if (t) await patch(kindOf(t), t.id, { deps: t.deps.filter((d) => !sources.has(d)) });
      }

      setAdded((prev) => {
        const next = new Set(prev);
        // Ein gelöschter Pfeil soll nichts unter der Hand verschwinden lassen.
        for (const e of cut) next.add(e.source).add(e.target);
        return next;
      });
      takeOff(gone.map((n) => n.id));
      return false;
    },
    [items, patch, scope],
  );

  /** Vom Board nehmen – nur, was nicht über Abhängigkeiten zum Ausschnitt gehört. */
  function takeOff(ids: string[]): void {
    const free = ids.filter((id) => !scope.has(id));
    if (free.length) {
      setAdded((prev) => {
        const next = new Set(prev);
        for (const id of free) next.delete(id);
        return next;
      });
    }
    if (free.length < ids.length) {
      say('Hängt über Abhängigkeiten mit dem Ausschnitt zusammen – erst die Pfeile entfernen.');
    }
  }

  const removeLink = (source: string, target: string): void => {
    const t = items.get(target);
    if (!t) return;
    setAdded((prev) => new Set(prev).add(source).add(target));
    void patch(kindOf(t), t.id, { deps: t.deps.filter((d) => d !== source) });
  };

  /* ----------------------------------------------------------- Inspektor */

  // Doppelklick blendet rechts den Inspektor ein. Er zeigt, was ausgewählt ist –
  // so folgt er auch den Links darin – und geht mit seinem ✕ wieder zu.
  const [detail, setDetail] = useState(false);
  const showDetail = useCallback(
    (id: string) => {
      select(id);
      setDetail(true);
    },
    [select],
  );
  useEffect(() => {
    if (!selected) setDetail(false);
  }, [selected]);

  /* ------------------------------------------------------ Aus der Liste */

  const showNode = useCallback(
    (id: string) => {
      const p = pos?.[id];
      if (!p) return;
      void flow.setCenter(p.x + CARD_W / 2, p.y + CARD_H / 2, { zoom: Math.max(flow.getZoom(), 1), duration: 300 });
      setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
    },
    [pos, flow],
  );

  const onDrop = (e: React.DragEvent): void => {
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (!id || !items.has(id)) return;
    e.preventDefault();
    if (onBoard.has(id)) {
      showNode(id);
      return;
    }
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setAdded((prev) => new Set(prev).add(id));
    // Der Mauszeiger soll etwa in der Mitte des Knotens landen.
    place((prev) => ({ ...prev, [id]: { x: Math.round(p.x - CARD_W / 2), y: Math.round(p.y - 30) } }));
  };

  /** „Neu anordnen“: alles auf dem Board mit ELK, samt Pfeilverläufen. */
  const relayout = (): void => {
    void elkLayout(boardIds.map(sized), links)
      .then((auto) => {
        setLayout((prev) => {
          const next = { nodes: { ...prev?.nodes, ...auto.nodes }, edges: auto.edges };
          save(next);
          return next;
        });
        window.setTimeout(() => void flow.fitView({ duration: 300 }), 50);
      })
      .catch((e: unknown) => say(e instanceof Error ? e.message : 'Anordnen fehlgeschlagen'));
  };

  /* ------------------------------------------------------ Kontextmenüs */

  /** Auf dem Board öffnet der Doppelklick die Details, in der Liste den Graph. */
  const nodeMenu = (id: string, inList = false): MenuItem[] => {
    const item = items.get(id);
    if (!item) return [];
    return [
      { label: 'Details anzeigen', kbd: inList ? undefined : 'Doppelklick', onSelect: () => showDetail(id) },
      {
        label: 'Vom Board nehmen',
        disabled: scope.has(id) || !onBoard.has(id),
        onSelect: () => takeOff([id]),
      },
      { sep: true },
      ...boardItems(isMs(item) ? milestoneMenu(ws, item) : taskMenu(ws, item)),
    ];
  };

  const edgeMenu = (source: string, target: string): MenuItem[] => {
    const s = items.get(source);
    const t = items.get(target);
    if (!s || !t) return [];
    return [
      { head: `„${t.title || 'Ohne Titel'}“ benötigt „${s.title || 'Ohne Titel'}“` },
      { label: 'Abhängigkeit entfernen', danger: true, onSelect: () => removeLink(source, target) },
    ];
  };

  const paneMenu = (): MenuItem[] => [
    { label: 'Neu anordnen', disabled: !boardIds.length, onSelect: relayout },
    { label: 'Alles einpassen', onSelect: () => void flow.fitView({ duration: 300 }) },
  ];

  /* ---------------------------------------------------------- Tastatur */

  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current?.focus(), []);
  const close = (): void => openGraph(null);

  // Am Fenster statt am Board: nach dem Löschen eines Pfeils liegt der Fokus
  // auf der Seite, Esc und Strg+Z sollen trotzdem hier ankommen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest?.('input, textarea');
      if (e.key === 'Escape') {
        if (typing) target!.blur();
        else if (!document.querySelector('.ctx')) openGraph(null);
        return;
      }
      // Die Abhängigkeiten sind gewöhnliche Änderungen – Strg+Z nimmt sie zurück.
      if (!typing && (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        void undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openGraph, undo]);

  const nodeTypes = useMemo(() => ({ item: ItemNodeView }), []);
  const edgeTypes = useMemo(() => ({ routed: RoutedEdgeView }), []);

  return (
    // `draw-modal`: die Tasten der Liste und die globalen Tasten halten sich raus.
    <div className="draw-modal graph-modal" ref={root} tabIndex={-1}>
      <div className="draw-head">
        <strong className="graph-title">
          Abhängigkeiten{' '}
          <span className="muted">
            · {focus && isMs(focus) ? '◆ ' : ''}
            {focus?.title || 'Ohne Titel'}
          </span>
        </strong>
        <span className="graph-help muted">
          Aus der Liste aufs Board ziehen · vom rechten Punkt zum nächsten Eintrag ziehen = „benötigt“ ·
          Entf löscht den gewählten Pfeil · Doppelklick zeigt Details
        </span>
        <button className="btn" onClick={relayout} disabled={!boardIds.length}>
          Neu anordnen
        </button>
        <button className="btn" onClick={close} title="Schließen (Esc)">
          Schließen
        </button>
      </div>
      <div className={`graph-body ${detail && selected ? 'with-detail' : ''}`}>
        <ItemList
          ws={ws}
          projectId={projectId}
          focusId={focusId}
          items={items}
          onBoard={onBoard}
          onShow={showNode}
          onOpen={(id) => openGraph({ projectId, focusId: id })}
          onMenu={(e, id) => {
            e.preventDefault();
            menu.openAtPoint(e.clientX, e.clientY, nodeMenu(id, true));
          }}
        />
        <div
          className="graph-board"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_TYPE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={onDrop}
        >
          {pos && (
            <ReactFlow<ItemNode, RoutedEdge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onBeforeDelete={onBeforeDelete}
              onNodeDoubleClick={(_, n) => showDetail(n.id)}
              onNodeContextMenu={(e, n) => {
                e.preventDefault();
                menu.openAtPoint(e.clientX, e.clientY, nodeMenu(n.id));
              }}
              onEdgeContextMenu={(e, edge) => {
                e.preventDefault();
                menu.openAtPoint(e.clientX, e.clientY, edgeMenu(edge.source, edge.target));
              }}
              onPaneContextMenu={(e) => {
                e.preventDefault();
                menu.openAtPoint(e.clientX, e.clientY, paneMenu());
              }}
              zoomOnDoubleClick={false}
              // Linke Taste zieht ein Auswahlrechteck auf, die mittlere verschiebt.
              selectionOnDrag
              panOnDrag={[1]}
              deleteKeyCode={['Delete', 'Backspace']}
              colorMode={dark() ? 'dark' : 'light'}
              connectionRadius={40}
              connectionLineType={ConnectionLineType.SmoothStep}
              fitView
              fitViewOptions={{ maxZoom: 1.2 }}
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
            </ReactFlow>
          )}
          {pos && !boardIds.length && (
            <p className="graph-empty muted">
              Noch leer. Tasks und Milestones aus der Liste links hierher ziehen.
            </p>
          )}
        </div>
        {detail && selected && <Inspector ws={ws} id={selected} />}
      </div>
      {menu.node}
    </div>
  );
}

/**
 * Das Zeilenmenü aus der Liste, soweit es auf dem Board etwas bedeutet: was eine
 * Zeile in der Liste anlegt, umbenennt, verschiebt oder aufklappt, fehlt – das
 * geschähe unsichtbar hinter dem Board. Tastenkürzel fehlen auch, denn hier
 * gelten andere (Entf nimmt vom Board).
 */
const LIST_ONLY = new Set([
  'Details öffnen',
  'Umbenennen',
  'Neuer Task darunter',
  'Neue Unteraufgabe',
  'Neuer Task darin',
  'Nach oben',
  'Nach unten',
  'Aufklappen',
  'Zuklappen',
]);

function boardItems(list: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const x of list) {
    if ('sep' in x) {
      if (out.length && !('sep' in out[out.length - 1]!)) out.push(x);
      continue;
    }
    if ('label' in x && LIST_ONLY.has(x.label)) continue;
    out.push('kbd' in x ? { ...x, kbd: undefined } : x);
  }
  while (out.length && 'sep' in out[out.length - 1]!) out.pop();
  return out;
}

/**
 * Ein Pfeil: mit Verlauf aus „Neu anordnen“ genau diesen, sonst – nach dem
 * Verschieben oder frisch verbunden – die einfache Stufenform.
 */
function RoutedEdgeView(p: EdgeProps<RoutedEdge>) {
  const route = p.data?.route;
  const source = { x: p.sourceX, y: p.sourceY };
  const target = { x: p.targetX, y: p.targetY };
  const path =
    route && route.length > 2
      ? roundedPath(fitRoute(route, source, target))
      : getSmoothStepPath({
          sourceX: p.sourceX,
          sourceY: p.sourceY,
          sourcePosition: p.sourcePosition,
          targetX: p.targetX,
          targetY: p.targetY,
          targetPosition: p.targetPosition,
        })[0];
  return <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} style={p.style} interactionWidth={16} />;
}

/** Wo ein Eintrag hängt – als zweite Zeile im Knoten. */
function subtitle(ws: Workspace, x: Item): string {
  if (isMs(x)) return x.planned ? 'Milestone' : 'Milestone · vorbereitet';
  const parent = ws.task(x.parentId);
  if (parent) return `unter ${parent.title || 'Ohne Titel'}`;
  const ms = ws.milestone(x.milestoneId);
  return ms ? `◆ ${ms.title || 'Ohne Titel'}` : x.ready ? 'Ready' : 'Backlog';
}

function Glyph({ ws, item }: { ws: Workspace; item: Item }) {
  if (isMs(item)) return <span className="ico ms">◆</span>;
  const mark = ws.mark(item.markId);
  return <span className="mk-emoji">{mark ? mark.emoji : DEFAULT_MARK.emoji}</span>;
}

/**
 * Ein Knoten sieht aus wie eine Karte der Kartenansicht (`CardFace`), nur dass
 * sich darin nichts anklicken lässt – Klicks gehören dem Board. Ein Milestone
 * bekommt dieselbe Form, mit ◆-Leiste statt Markierung und seinem Fortschritt.
 */
function ItemNodeView({ data }: NodeProps<ItemNode>) {
  const ws = useStore((s) => s.ws);
  const { item, sub, done, focus } = data;
  if (!ws) return null;
  return (
    <div className={`tcard gn ${isMs(item) ? 'gn-ms' : ''} ${done ? 'done' : ''} ${focus ? 'holds' : ''}`}>
      <Handle type="target" position={Position.Left} />
      {isMs(item) ? (
        <>
          <div className="tcard-markbar">
            <span className="ico ms">◆</span>
            <span className="tcard-markname">{sub}</span>
          </div>
          <div className="tcard-head">
            <span className="tcard-title">{item.title || <em>Ohne Titel</em>}</span>
          </div>
          <div className="tcard-foot">
            <div className="tcard-meta">
              <span className="gn-ms-status">{MS_STATUS[item.status as keyof typeof MS_STATUS] ?? STATUS_LABEL[item.status]}</span>
              <span className="tcard-badges">
                <span className="tcard-count">{milestoneProgressPct(ws, item)} %</span>
              </span>
            </div>
          </div>
        </>
      ) : (
        <CardFace ws={ws} task={item} />
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

/* ------------------------------------------------------------ Die Liste */

type ListRow = { item: Item; depth: number };

/**
 * Alle aktiven Einträge des Projekts als Baum: die Milestones mit ihren Tasks,
 * danach die Tasks ohne Milestone – je mit ihren Unteraufgaben eingerückt.
 */
function listRows(ws: Workspace, projectId: string): { head: string; rows: ListRow[] }[] {
  const tree = (roots: Task[], depth: number, out: ListRow[]): ListRow[] => {
    for (const t of roots) {
      out.push({ item: t, depth });
      tree(ws.kids(t.id), depth + 1, out);
    }
    return out;
  };
  const milestones = (list: Milestone[]): ListRow[] =>
    list.flatMap((m) => [{ item: m, depth: 0 }, ...tree(ws.msRoots(m), 1, [])]);
  const loose = ws.tasks
    .filter((t) => t.projectId === projectId && !t.parentId && !t.milestoneId && !t.doc && ws.isActive(t))
    .sort((a, b) => Number(b.ready) - Number(a.ready) || a.order - b.order);

  return [
    { head: 'Milestones im Plan', rows: milestones(plannedMilestones(ws, projectId)) },
    { head: 'Vorbereitete Milestones', rows: milestones(draftMilestones(ws, projectId)) },
    { head: 'Ready & Backlog', rows: tree(loose, 0, []) },
  ].filter((s) => s.rows.length);
}

const norm = (s: string): string => s.toLocaleLowerCase('de');

function ItemList({
  ws,
  projectId,
  focusId,
  items,
  onBoard,
  onShow,
  onOpen,
  onMenu,
}: {
  ws: Workspace;
  projectId: string;
  /** Wovon aus das Board offen ist – steht immer ganz oben, auch beim Suchen. */
  focusId: string;
  items: Map<string, Item>;
  onBoard: Set<string>;
  onShow: (id: string) => void;
  /** Doppelklick: den Graph dieses Eintrags zeigen – auf dem Board öffnet er den Inspektor. */
  onOpen: (id: string) => void;
  onMenu: (e: React.MouseEvent, id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const sections = useMemo(() => {
    const focus = items.get(focusId);
    const pinned = focus ? [{ head: 'Geöffnet', rows: [{ item: focus, depth: 0 }], pinned: true }] : [];
    return [...pinned, ...listRows(ws, projectId)];
  }, [ws, projectId, items, focusId]);

  // Beim Suchen bleiben die Treffer mit ihren Eltern stehen, damit der Baum lesbar bleibt.
  const keep = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return null;
    const ids = new Set<string>();
    for (const x of items.values()) {
      if (!norm(x.title).includes(q)) continue;
      ids.add(x.id);
      if (isMs(x)) continue;
      for (const a of ws.ancestors(x)) ids.add(a.id);
      const ms = ws.milestoneOf(x);
      if (ms) ids.add(ms.id);
    }
    return ids;
  }, [query, items, ws]);

  return (
    <aside className="graph-list">
      <input
        type="search"
        className="graph-q"
        placeholder="Task oder Milestone suchen …"
        aria-label="Task oder Milestone suchen"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="graph-rows">
        {sections.map((s) => {
          const rows = keep && !('pinned' in s) ? s.rows.filter((r) => keep.has(r.item.id)) : s.rows;
          if (!rows.length) return null;
          return (
            <div key={s.head}>
              <div className="graph-sec">{s.head}</div>
              {rows.map(({ item, depth }) => {
                const done = isMs(item) ? milestoneDone(ws, item) : isDone(item);
                const on = onBoard.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`graph-row ${isMs(item) ? 'ms' : ''} ${done ? 'done' : ''} ${on ? 'on' : ''}`}
                    style={{ paddingLeft: 10 + depth * 16 }}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, item.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => on && onShow(item.id)}
                    onDoubleClick={() => onOpen(item.id)}
                    onContextMenu={(e) => onMenu(e, item.id)}
                    title={
                      on
                        ? 'Liegt auf dem Board – klicken zum Hinspringen, Doppelklick zeigt seinen Graph'
                        : 'Aufs Board ziehen · Doppelklick zeigt seinen Graph'
                    }
                  >
                    <Glyph ws={ws} item={item} />
                    <span className="graph-row-t">{item.title || 'Ohne Titel'}</span>
                    {on && <span className="graph-on" aria-label="auf dem Board" />}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
