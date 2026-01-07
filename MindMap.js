/*
```javascript
*/
if (
  !ea.verifyMinimumPluginVersion ||
  !ea.verifyMinimumPluginVersion('1.5.21')
) {
  new Notice(
    'This script requires a newer version of Excalidraw. Please install the latest version.'
  );
  return;
}

let settings = ea.getScriptSettings();

// -----------------------
// Default settings
// -----------------------
const defaultSettings = {
  'Starting arrowhead': {
    value: 'none',
    valueset: ['none', 'arrow', 'triangle', 'bar', 'dot'],
  },
  'Ending arrowhead': {
    value: 'none',
    valueset: ['none', 'arrow', 'triangle', 'bar', 'dot'],
  },
  'Line points': {
    value: 0,
    description: 'Number of line points between start and end',
  },
  'Box selected': {
    value: false,
    description: 'Box selected mindmap elements',
  },
  'Add dash bullet': {
    value: true,
    description:
      "If true, prepend a dash '-' to each bullet line in the outline.",
  },
  'Horizontal spacing': {
    value: 200,
    description:
      'Horizontal distance between levels (parent edge to child edge). Used for LR/RL/BI.',
  },
  'Vertical spacing': {
    value: 100,
    description: 'Vertical spacing between sibling nodes. Used for LR/RL/BI.',
  },
};

// Clear old unused settings
for (const key in settings) {
  if (!defaultSettings.hasOwnProperty(key)) delete settings[key];
}

// Fill missing defaults
for (const key in defaultSettings) {
  if (!settings[key]) settings[key] = defaultSettings[key];
}

ea.setScriptSettings(settings);

// -----------------------------------------------------
// Selected elements
// -----------------------------------------------------
let selectedElements = ea.getViewSelectedElements();
if (selectedElements.length === 0) {
  new Notice(
    'No objects selected. Please select at least one object to connect or select.'
  );
  return;
}

// -----------------------------------------------------
// Snapshot + adjacency maps
// -----------------------------------------------------
function snapshotCanvas() {
  const elements = ea.getViewElements();
  const byId = new Map();
  const arrows = [];
  const connectors = []; // arrows + lines

  const outgoingArrows = new Map(); // elementId -> arrow[]
  const incomingArrows = new Map(); // elementId -> arrow[]
  const outgoingConnectors = new Map(); // elementId -> (arrow|line)[]
  const incomingConnectors = new Map();

  const boundArrowPairs = new Set(); // "startId->endId"

  const pushMapList = (map, key, val) => {
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }
    arr.push(val);
  };

  for (const el of elements) {
    byId.set(el.id, el);
    if (el.type === 'arrow') arrows.push(el);
    if (el.type === 'arrow' || el.type === 'line') connectors.push(el);
  }

  for (const c of connectors) {
    const sId = c.startBinding?.elementId || null;
    const eId = c.endBinding?.elementId || null;

    if (sId) pushMapList(outgoingConnectors, sId, c);
    if (eId) pushMapList(incomingConnectors, eId, c);

    if (c.type === 'arrow') {
      if (sId) pushMapList(outgoingArrows, sId, c);
      if (eId) pushMapList(incomingArrows, eId, c);
      if (sId && eId) boundArrowPairs.add(`${sId}->${eId}`);
    }
  }

  return {
    elements,
    byId,
    arrows,
    connectors,
    outgoingArrows,
    incomingArrows,
    outgoingConnectors,
    incomingConnectors,
    boundArrowPairs,
  };
}

let snapshot = snapshotCanvas();

function hasConnections(el, snap) {
  return (
    (snap.outgoingConnectors.get(el.id)?.length || 0) > 0 ||
    (snap.incomingConnectors.get(el.id)?.length || 0) > 0
  );
}

// -----------------------------------------------------
// Style helpers
// -----------------------------------------------------
function normalizeArrowHead(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.toLowerCase() === 'none') return null;
  return v;
}

function pickArrowStyleFor(sourceEl, snap) {
  const candidates = []
    .concat(snap.outgoingArrows.get(sourceEl.id) || [])
    .concat(snap.incomingArrows.get(sourceEl.id) || []);

  const hit = candidates.find(a => a.type === 'arrow' && !a.isDeleted);
  if (hit) return hit;

  return (snap.arrows || []).find(a => !a.isDeleted) || null;
}

function makeArrowOptionsFromSource(sourceEl, snap) {
  const a = pickArrowStyleFor(sourceEl, snap);
  const app = ea.getExcalidrawAPI?.()?.getAppState?.() || {};

  return {
    startArrowHead: normalizeArrowHead(
      settings['Starting arrowhead'].value === 'none'
        ? null
        : settings['Starting arrowhead'].value
    ),
    endArrowHead: normalizeArrowHead(
      settings['Ending arrowhead'].value === 'none'
        ? null
        : settings['Ending arrowhead'].value
    ),
    numberOfPoints: Math.floor(settings['Line points'].value) || 0,

    strokeColor: a?.strokeColor ?? app.currentItemStrokeColor ?? '#000000',
    strokeWidth: a?.strokeWidth ?? app.currentItemStrokeWidth ?? 1,
    strokeStyle: a?.strokeStyle ?? app.currentItemStrokeStyle ?? 'solid',
    strokeSharpness:
      a?.strokeSharpness ?? app.currentItemStrokeSharpness ?? 'sharp',
    roughness: a?.roughness ?? app.currentItemRoughness ?? 0,
  };
}

function makeArrowOptionsFromContext(snap, preferredEls = []) {
  let a = null;
  for (const el of preferredEls) {
    a = pickArrowStyleFor(el, snap);
    if (a) break;
  }
  if (!a) a = (snap.arrows || []).find(x => !x.isDeleted) || null;

  const app = ea.getExcalidrawAPI?.()?.getAppState?.() || {};
  return {
    startArrowHead: normalizeArrowHead(
      settings['Starting arrowhead'].value === 'none'
        ? null
        : settings['Starting arrowhead'].value
    ),
    endArrowHead: normalizeArrowHead(
      settings['Ending arrowhead'].value === 'none'
        ? null
        : settings['Ending arrowhead'].value
    ),
    numberOfPoints: Math.floor(settings['Line points'].value) || 0,

    strokeColor: a?.strokeColor ?? app.currentItemStrokeColor ?? '#000000',
    strokeWidth: a?.strokeWidth ?? app.currentItemStrokeWidth ?? 1,
    strokeStyle: a?.strokeStyle ?? app.currentItemStrokeStyle ?? 'solid',
    strokeSharpness:
      a?.strokeSharpness ?? app.currentItemStrokeSharpness ?? 'sharp',
    roughness: a?.roughness ?? app.currentItemRoughness ?? 0,
  };
}

function makeTextOptionsFromSource(sourceEl) {
  return {
    fontFamily: sourceEl?.fontFamily ?? 5,
    fontSize: sourceEl?.fontSize ?? 20,
    textAlign: sourceEl?.textAlign ?? 'center',
    roughness: sourceEl?.roughness ?? 2,
    strokeWidth: sourceEl?.strokeWidth ?? 1,
    strokeStyle: sourceEl?.strokeStyle ?? 'solid',
    strokeSharpness: sourceEl?.strokeSharpness ?? 'sharp',
    backgroundColor: sourceEl?.backgroundColor ?? 'transparent',
    fillStyle: sourceEl?.fillStyle ?? 'solid',
    strokeColor: sourceEl?.strokeColor ?? '#000000',
    opacity: sourceEl?.opacity ?? 100,
    handDrawn: sourceEl?.handDrawn ?? true,
    isHandDrawn: sourceEl?.isHandDrawn ?? true,
  };
}

// -----------------------------------------------------
// Per-mindmap direction metadata (stored on root node)
// - customData.mindmap.dir: 'LR' | 'RL' | 'BI'
// - fallback link: mindmap://dir=LR|RL|BI (only if link empty or already mindmap link)
// - default: LR
// -----------------------------------------------------
function normalizeDir(v) {
  const x = String(v || '')
    .toUpperCase()
    .trim();
  if (x === 'LR' || x === 'RL' || x === 'BI') return x;
  return null;
}

function tryReadDirFromCustomData(el) {
  try {
    const d = el?.customData?.mindmap?.dir;
    return normalizeDir(d);
  } catch (_e) {
    return null;
  }
}

function tryReadDirFromLink(el) {
  const link = el?.link;
  if (!link || typeof link !== 'string') return null;

  const m = link.match(/^(mindmap|mm):\/\/(.+)$/i);
  if (!m) return null;

  const tail = m[2] || '';
  const m2 = tail.match(/(?:\b|\?|&)dir\s*=\s*(LR|RL|BI)\b/i);
  if (m2) return normalizeDir(m2[1]);

  const m3 = tail.match(/^(LR|RL|BI)$/i);
  if (m3) return normalizeDir(m3[1]);

  return null;
}

function tryReadDirFromText(el) {
  const t = (el?.text || '').toString();
  const m = t.match(/\bdir\s*[:=]\s*(LR|RL|BI)\b/i);
  return m ? normalizeDir(m[1]) : null;
}

function readMindmapDirFromRoot(rootEl) {
  return (
    tryReadDirFromCustomData(rootEl) ||
    tryReadDirFromLink(rootEl) ||
    tryReadDirFromText(rootEl) ||
    'LR'
  );
}

function writeMindmapDirToRoot_EDITABLE(rootElEditable, dir) {
  const d = normalizeDir(dir) || 'LR';

  try {
    rootElEditable.customData = rootElEditable.customData || {};
    rootElEditable.customData.mindmap = rootElEditable.customData.mindmap || {};
    rootElEditable.customData.mindmap.dir = d;
  } catch (_e) {}

  try {
    const link = rootElEditable.link;
    const isMindmapLink =
      typeof link === 'string' && /^(mindmap|mm):\/\//i.test(link || '');
    if (!link || isMindmapLink) {
      rootElEditable.link = `mindmap://dir=${d}`;
    }
  } catch (_e) {}
}

// -----------------------------------------------------
// Geometry helpers
// -----------------------------------------------------
function centerX(el) {
  return el.x + el.width / 2;
}
function centerY(el) {
  return el.y + el.height / 2;
}

function getAxisSpacing() {
  const levelSpacing = parseFloat(settings['Horizontal spacing'].value) || 200;
  const siblingSpacing = parseFloat(settings['Vertical spacing'].value) || 100;
  return { levelSpacing, siblingSpacing };
}

function getSidesForDir(dirLRorRL) {
  if (dirLRorRL === 'RL') {
    return {
      parentSide: 'left',
      childSide: 'right',
      fpStart: [0, 0.5],
      fpEnd: [1, 0.5],
    };
  }
  return {
    parentSide: 'right',
    childSide: 'left',
    fpStart: [1, 0.5],
    fpEnd: [0, 0.5],
  };
}

function edgeCenter(el, side) {
  if (side === 'left') return [el.x, el.y + el.height / 2];
  return [el.x + el.width, el.y + el.height / 2]; // right
}

function getNodeSide(el, rootEl) {
  const dx = centerX(el) - centerX(rootEl);
  const EPS = 2;
  if (dx > EPS) return 'R';
  if (dx < -EPS) return 'L';
  return 'C';
}

// -----------------------------------------------------
// Find mindmap root (walk parents by incoming arrows)
// -----------------------------------------------------
function getParentsOfNode(childEl, snap) {
  const incoming = snap.incomingArrows.get(childEl.id) || [];
  const parents = [];
  for (const a of incoming) {
    if (!a || a.isDeleted) continue;
    const pId = a.startBinding?.elementId;
    if (!pId) continue;
    const pEl = snap.byId.get(pId);
    if (!pEl) continue;
    if (pEl.type === 'arrow' || pEl.type === 'line') continue;
    parents.push({ parentEl: pEl, arrowEl: a });
  }
  return parents;
}

function pickBestParent(childEl, snap) {
  const ps = getParentsOfNode(childEl, snap);
  if (ps.length === 0) return null;

  let best = ps[0];
  let bestD = Infinity;

  for (const p of ps) {
    const dx = centerX(p.parentEl) - centerX(childEl);
    const dy = centerY(p.parentEl) - centerY(childEl);
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) {
      bestD = d2;
      best = p;
    }
  }

  return best.parentEl;
}

function findMindmapRoot(startEl, snap) {
  const visited = new Set();
  let cur = startEl;
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    const p = pickBestParent(cur, snap);
    if (!p) return cur;
    cur = p;
  }
  return cur || startEl;
}

function getMindmapDirAndRoot(anyNodeEl, snap) {
  const root = findMindmapRoot(anyNodeEl, snap);
  const dir = readMindmapDirFromRoot(root);
  return { root, dir };
}

// -----------------------------------------------------
// Create a bound arrow between two elements (dir = 'LR'|'RL')
// -----------------------------------------------------
function addBoundArrowBetween(
  sourceEl,
  targetEl,
  style = {},
  dirLRorRL = 'LR'
) {
  const { parentSide, childSide, fpStart, fpEnd } = getSidesForDir(dirLRorRL);

  const startArrowHead = normalizeArrowHead(style.startArrowHead);
  const endArrowHead = normalizeArrowHead(style.endArrowHead);
  const numberOfPoints = Number.isFinite(style.numberOfPoints)
    ? style.numberOfPoints
    : 0;

  if (typeof style.strokeColor !== 'undefined')
    ea.style.strokeColor = style.strokeColor;
  if (typeof style.strokeWidth !== 'undefined')
    ea.style.strokeWidth = style.strokeWidth;
  if (typeof style.strokeStyle !== 'undefined')
    ea.style.strokeStyle = style.strokeStyle;
  if (typeof style.strokeSharpness !== 'undefined')
    ea.style.strokeSharpness = style.strokeSharpness;
  if (typeof style.roughness !== 'undefined')
    ea.style.roughness = style.roughness;

  const createdId = ea.connectObjects(
    sourceEl.id,
    parentSide,
    targetEl.id,
    childSide,
    {
      numberOfPoints,
      startArrowHead,
      endArrowHead,
      padding: 0,
    }
  );

  try {
    if (createdId) {
      const a = ea.getElement(createdId);
      if (a && a.type === 'arrow') {
        if (a.startBinding) {
          a.startBinding.focus = 0;
          if (a.startBinding.fixedPoint) a.startBinding.fixedPoint = fpStart;
        }
        if (a.endBinding) {
          a.endBinding.focus = 0;
          if (a.endBinding.fixedPoint) a.endBinding.fixedPoint = fpEnd;
        }
      }
    }
  } catch (_e) {}

  return createdId;
}

// -----------------------------------------------------
// Mindmap traversal (children)
// - LR: only children to the right
// - RL: only children to the left
// - BI: root can have both; non-root children continue outward on their side
// -----------------------------------------------------
function getChildTriples(parentEl, snap, mindmapDir, mindmapRoot) {
  const outgoing = snap.outgoingArrows.get(parentEl.id) || [];
  const all = [];

  for (const a of outgoing) {
    if (!a || a.isDeleted) continue;
    const cId = a.endBinding?.elementId;
    if (!cId) continue;
    const cEl = snap.byId.get(cId);
    if (!cEl || cEl.isDeleted) continue;
    if (cEl.type === 'arrow' || cEl.type === 'line') continue;

    all.push({ childEl: cEl, arrowEl: a });
  }

  // ---------- LR / RL ----------
  if (mindmapDir === 'LR') {
    const filtered = all.filter(t => centerX(t.childEl) > centerX(parentEl));
    filtered.sort((a, b) => a.childEl.y - b.childEl.y);
    return filtered;
  }

  if (mindmapDir === 'RL') {
    const filtered = all.filter(t => centerX(t.childEl) < centerX(parentEl));
    filtered.sort((a, b) => a.childEl.y - b.childEl.y);
    return filtered;
  }

  // ---------- BI ----------
  // Root: left(top→down) then right(top→down)
  if (mindmapRoot && parentEl.id === mindmapRoot.id) {
    const left = [];
    const right = [];

    // classify by current X relative to root center
    const rootCx = centerX(mindmapRoot);
    for (const t of all) {
      const side = centerX(t.childEl) < rootCx ? 'L' : 'R';
      (side === 'L' ? left : right).push(t);
    }

    left.sort((a, b) => a.childEl.y - b.childEl.y);
    right.sort((a, b) => a.childEl.y - b.childEl.y);

    // If everything is on one side, BI degenerates -> auto split by Y alternating
    if (left.length === 0 || right.length === 0) {
      const merged = all.slice().sort((a, b) => a.childEl.y - b.childEl.y);
      const L = [];
      const R = [];
      for (let i = 0; i < merged.length; i++) {
        (i % 2 === 0 ? R : L).push(merged[i]); // R, L, R, L...
      }
      return L.concat(R); // left first, then right (as requested)
    }

    return left.concat(right);
  }

  // Non-root: children must continue outward on the same side as the parent
  if (mindmapRoot) {
    const pSide = getNodeSide(parentEl, mindmapRoot); // 'L'|'R'|'C'
    if (pSide === 'L') {
      const filtered = all.filter(t => centerX(t.childEl) < centerX(parentEl));
      filtered.sort((a, b) => a.childEl.y - b.childEl.y);
      return filtered;
    }
    if (pSide === 'R') {
      const filtered = all.filter(t => centerX(t.childEl) > centerX(parentEl));
      filtered.sort((a, b) => a.childEl.y - b.childEl.y);
      return filtered;
    }
  }

  // Fallback: stable
  all.sort((a, b) => a.childEl.y - b.childEl.y);
  return all;
}

// For BI optimize root, we must include all outgoing edges regardless of current X,
// because we may move a whole branch to the other side.
function getChildTriplesAllOut(parentEl, snap) {
  const outgoing = snap.outgoingArrows.get(parentEl.id) || [];
  const triples = [];
  for (const a of outgoing) {
    if (!a || a.isDeleted) continue;
    const cId = a.endBinding?.elementId;
    if (!cId) continue;
    const cEl = snap.byId.get(cId);
    if (!cEl) continue;
    if (cEl.type === 'arrow' || cEl.type === 'line') continue;
    triples.push({ childEl: cEl, arrowEl: a });
  }
  triples.sort((a, b) => a.childEl.y - b.childEl.y);
  return triples;
}

function collectSubtree(subtreeRootEl, snap, mindmapDir, mindmapRoot) {
  const visited = new Set();
  const nodes = [];
  const edges = []; // { parentId, childId, arrowId }

  function dfs(el) {
    if (!el || visited.has(el.id)) return;
    visited.add(el.id);

    nodes.push(el);

    const triples = getChildTriples(el, snap, mindmapDir, mindmapRoot);
    for (const t of triples) {
      edges.push({
        parentId: el.id,
        childId: t.childEl.id,
        arrowId: t.arrowEl?.id || null,
      });
      dfs(t.childEl);
    }
  }

  dfs(subtreeRootEl);
  return { nodes, edges };
}

function collectSubtreeAllOut(subtreeRootEl, snap) {
  const visited = new Set();
  const nodes = [];
  const edges = [];

  function dfs(el) {
    if (!el || visited.has(el.id)) return;
    visited.add(el.id);

    nodes.push(el);

    const triples = getChildTriplesAllOut(el, snap);
    for (const t of triples) {
      edges.push({
        parentId: el.id,
        childId: t.childEl.id,
        arrowId: t.arrowEl?.id || null,
      });
      dfs(t.childEl);
    }
  }

  dfs(subtreeRootEl);
  return { nodes, edges };
}

// -----------------------------------------------------
// Outline + clipboard (direction-aware)
// -----------------------------------------------------
function buildOutline(
  element,
  snap,
  mindmapDir,
  mindmapRoot,
  visited = new Set(),
  depth = 0
) {
  if (!element || visited.has(element.id)) return '';
  visited.add(element.id);

  let label = element.text?.trim() ?? `Element ${element.id}`;
  label = String(label).replace(/\r?\n/g, ' ');

  const indent = '\t'.repeat(depth);
  const useDash = settings['Add dash bullet'].value;
  const bulletPrefix = useDash ? '- ' : '';

  let outline = `${indent}${bulletPrefix}${label}\n`;

  const triples = getChildTriples(element, snap, mindmapDir, mindmapRoot);
  for (const t of triples) {
    outline += buildOutline(
      t.childEl,
      snap,
      mindmapDir,
      mindmapRoot,
      visited,
      depth + 1
    );
  }
  return outline;
}

async function copyOutlineToClipboard(rootEl, snap, mindmapDir, mindmapRoot) {
  const bulletText = buildOutline(rootEl, snap, mindmapDir, mindmapRoot);

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(bulletText);
      new Notice('Mindmap text copied to clipboard!');
    } else {
      ea.setClipboard(bulletText);
      new Notice('Mindmap text copied to plugin clipboard!');
    }
  } catch (_e) {
    new Notice('Error copying mindmap text to clipboard!');
  }
}

// -----------------------------------------------------
// Group subtree (direction-aware)
// -----------------------------------------------------
function getChildElementsForGrouping(
  element,
  snap,
  mindmapDir,
  mindmapRoot,
  visited
) {
  visited = visited || new Set();
  let children = [];

  if (visited.has(element.id)) return children;
  visited.add(element.id);

  const triples = getChildTriples(element, snap, mindmapDir, mindmapRoot);
  for (const t of triples) {
    children.push(t.childEl);
    if (t.arrowEl) children.push(t.arrowEl);
    children = children.concat(
      getChildElementsForGrouping(
        t.childEl,
        snap,
        mindmapDir,
        mindmapRoot,
        visited
      )
    );
  }

  return children;
}

async function groupSubtree(rootEl, snap, mindmapDir, mindmapRoot) {
  const childElements = getChildElementsForGrouping(
    rootEl,
    snap,
    mindmapDir,
    mindmapRoot
  );
  const elementsToGroup = [rootEl].concat(childElements);

  const uniq = new Map();
  for (const el of elementsToGroup) if (el && el.id) uniq.set(el.id, el);
  const uniqElementsToGroup = Array.from(uniq.values());

  const elementIdsToGroup = uniqElementsToGroup.map(el => el.id);

  const addBox = settings['Box selected'].value;

  if (addBox) {
    const box = ea.getBoundingBox(uniqElementsToGroup);
    const padding = 5;
    const color = ea.getExcalidrawAPI().getAppState().currentItemStrokeColor;

    ea.style.strokeColor = color;
    ea.style.roundness = { type: 2, value: padding };

    const boxId = ea.addRect(
      box.topX - padding,
      box.topY - padding,
      box.width + 2 * padding,
      box.height + 2 * padding
    );

    try {
      if (typeof ea.sendToBack === 'function') ea.sendToBack([boxId]);
      else {
        const api = ea.getExcalidrawAPI?.();
        if (api && typeof api.sendToBack === 'function')
          api.sendToBack([boxId]);
      }
    } catch (_e) {}

    ea.copyViewElementsToEAforEditing(uniqElementsToGroup);
    ea.addToGroup([boxId].concat(elementIdsToGroup));
  } else {
    ea.copyViewElementsToEAforEditing(uniqElementsToGroup);
    ea.addToGroup(elementIdsToGroup);
  }

  await ea.addElementsToView(false, false, true);
  new Notice(`Grouped ${uniqElementsToGroup.length} elements.`);
}

// -----------------------------------------------------
// Add Child / Add Sibling (direction-aware; BI chooses side)
// -----------------------------------------------------
function countRootChildrenSides(rootEl, snap) {
  const outgoing = snap.outgoingArrows.get(rootEl.id) || [];
  let left = 0;
  let right = 0;
  for (const a of outgoing) {
    if (!a || a.isDeleted) continue;
    const cId = a.endBinding?.elementId;
    if (!cId) continue;
    const cEl = snap.byId.get(cId);
    if (!cEl) continue;
    const side = getNodeSide(cEl, rootEl);
    if (side === 'L') left++;
    else if (side === 'R') right++;
  }
  return { left, right };
}

function chooseBiSideForNewChild(parentEl, selectedEl, mindmapRoot, snap) {
  if (mindmapRoot && parentEl.id === mindmapRoot.id) {
    const { left, right } = countRootChildrenSides(mindmapRoot, snap);
    if (left < right) return 'L';
    if (right < left) return 'R';
    const sSide =
      selectedEl && mindmapRoot ? getNodeSide(selectedEl, mindmapRoot) : 'C';
    return sSide === 'L' ? 'L' : 'R';
  }

  if (mindmapRoot) {
    const pSide = getNodeSide(parentEl, mindmapRoot);
    if (pSide === 'L' || pSide === 'R') return pSide;
    const sSide = selectedEl ? getNodeSide(selectedEl, mindmapRoot) : 'C';
    if (sSide === 'L' || sSide === 'R') return sSide;
  }

  return 'R';
}

async function insertNode(selectedEl, snap, mode /* 'child'|'sibling' */) {
  const { root: mindmapRoot, dir: mindmapDir } = getMindmapDirAndRoot(
    selectedEl,
    snap
  );
  const { levelSpacing, siblingSpacing } = getAxisSpacing();

  const label = await utils.inputPrompt(
    mode === 'child' ? 'Add child node' : 'Add sibling node',
    'Enter node text',
    '',
    [
      { caption: 'Confirm', action: input => (input || '').trim() },
      { caption: 'Cancel', action: () => null },
    ]
  );
  if (label === null || label === undefined) return;
  if (label === '') return;

  let parentEl = null;
  if (mode === 'child') {
    parentEl = selectedEl;
  } else {
    parentEl = pickBestParent(selectedEl, snap);
    if (!parentEl) {
      new Notice(
        "No parent found (selected looks like the root). Use 'Add child' instead."
      );
      return;
    }
  }

  let effectiveDir = mindmapDir;
  if (mindmapDir === 'BI') {
    const side = chooseBiSideForNewChild(
      parentEl,
      selectedEl,
      mindmapRoot,
      snap
    );
    effectiveDir = side === 'L' ? 'RL' : 'LR';
  }

  const textOptions = makeTextOptionsFromSource(selectedEl);
  const arrowOptions = makeArrowOptionsFromSource(parentEl, snap);

  // Create node first to know width
  const newId = ea.addText(parentEl.x, parentEl.y, label, textOptions);
  let newEl = ea.getElement(newId);
  if (!newEl) {
    new Notice('Failed to create new node.');
    return;
  }

  // Determine siblings bucket (for BI root, keep left and right separate)
  function isSameOutwardBucket(childEl) {
    if (mindmapDir !== 'BI') return true;
    if (!mindmapRoot) return true;

    if (parentEl.id === mindmapRoot.id) {
      const side = getNodeSide(childEl, mindmapRoot);
      const want = effectiveDir === 'RL' ? 'L' : 'R';
      return side === want || side === 'C';
    }

    const pSide = getNodeSide(parentEl, mindmapRoot);
    const want = pSide === 'L' ? 'RL' : 'LR';
    return want === effectiveDir;
  }

  const existingTriplesAll = getChildTriples(
    parentEl,
    snap,
    mindmapDir,
    mindmapRoot
  );
  const existingChildren = existingTriplesAll
    .map(t => t.childEl)
    .filter(c => isSameOutwardBucket(c))
    .sort((a, b) => a.y - b.y);

  let targetX = 0;
  let targetY = 0;

  if (effectiveDir === 'LR') {
    if (existingChildren.length > 0) {
      targetX = existingChildren[0].x;
      targetY =
        existingChildren[existingChildren.length - 1].y + siblingSpacing;
    } else {
      targetX = parentEl.x + parentEl.width + levelSpacing;
      targetY = parentEl.y;
    }
  } else {
    if (existingChildren.length > 0) {
      targetX = existingChildren[0].x;
      targetY =
        existingChildren[existingChildren.length - 1].y + siblingSpacing;
    } else {
      targetX = parentEl.x - levelSpacing - newEl.width;
      targetY = parentEl.y;
    }
  }

  // Enter edit mode and apply positioning + connect
  try {
    ea.copyViewElementsToEAforEditing([parentEl, newEl]);
  } catch (_e) {}

  const editableNew = ea.getElement(newId) || newEl;
  editableNew.x = targetX;
  editableNew.y = targetY;

  addBoundArrowBetween(parentEl, editableNew, arrowOptions, effectiveDir);

  await ea.addElementsToView(false, false, true);
  new Notice(mode === 'child' ? 'Added child node.' : 'Added sibling node.');
}

// -----------------------------------------------------
// Optimize layout
// - LR/RL: subtree layout
// - BI: ALWAYS optimize the true root, and FORCE split root children left/right
// -----------------------------------------------------
async function optimizeLayout(subtreeRootEl, snap) {
  const { root: mindmapRoot, dir: mindmapDir } = getMindmapDirAndRoot(
    subtreeRootEl,
    snap
  );
  const { levelSpacing, siblingSpacing } = getAxisSpacing();

  snap = snapshotCanvas();

  // ✅ BI is global: always optimize root, so we can split children on both sides
  if (mindmapDir === 'BI' && mindmapRoot) {
    await optimizeLayoutBiRoot(
      mindmapRoot,
      snap,
      mindmapDir,
      mindmapRoot,
      levelSpacing,
      siblingSpacing
    );
    return;
  }

  await optimizeLayoutSingleDir(
    subtreeRootEl,
    snap,
    mindmapDir,
    mindmapRoot,
    mindmapDir,
    levelSpacing,
    siblingSpacing
  );
}

function straightenArrowBetween(parentEl, childEl, arrowEl, dirLRorRL) {
  const { parentSide, childSide, fpStart, fpEnd } = getSidesForDir(dirLRorRL);

  const startAbs = edgeCenter(parentEl, parentSide);
  const endAbs = edgeCenter(childEl, childSide);

  try {
    if (arrowEl.startBinding) {
      arrowEl.startBinding.focus = 0;
      if (arrowEl.startBinding.fixedPoint)
        arrowEl.startBinding.fixedPoint = fpStart;
    }
    if (arrowEl.endBinding) {
      arrowEl.endBinding.focus = 0;
      if (arrowEl.endBinding.fixedPoint) arrowEl.endBinding.fixedPoint = fpEnd;
    }
  } catch (_e) {}

  const minX = Math.min(startAbs[0], endAbs[0]);
  const minY = Math.min(startAbs[1], endAbs[1]);

  arrowEl.x = minX;
  arrowEl.y = minY;

  arrowEl.points = [
    [startAbs[0] - minX, startAbs[1] - minY],
    [endAbs[0] - minX, endAbs[1] - minY],
  ];
}

async function optimizeLayoutSingleDir(
  subtreeRootEl,
  snap,
  mindmapDir,
  mindmapRoot,
  effectiveDir,
  levelSpacing,
  siblingSpacing
) {
  const { nodes, edges } = collectSubtree(
    subtreeRootEl,
    snap,
    mindmapDir,
    mindmapRoot
  );

  if (!nodes || nodes.length <= 1) {
    new Notice('Nothing to optimize (no children found).');
    return;
  }

  const byId = new Map(nodes.map(n => [n.id, n]));
  const childrenByParent = new Map();

  for (const e of edges) {
    if (!childrenByParent.has(e.parentId)) childrenByParent.set(e.parentId, []);
    childrenByParent.get(e.parentId).push(e.childId);
  }

  for (const [pId, childIds] of childrenByParent.entries()) {
    childIds.sort((a, b) => (byId.get(a)?.y || 0) - (byId.get(b)?.y || 0));
  }

  function countLeaves(id) {
    const kids = childrenByParent.get(id) || [];
    if (kids.length === 0) return 1;
    let sum = 0;
    for (const k of kids) sum += countLeaves(k);
    return sum;
  }

  const pos = new Map(); // id -> {x,y}

  // First pass: compute total height needed for all leaves (edge-to-edge spacing)
  function collectLeafHeights(id, heights) {
    const el = byId.get(id);
    if (!el) return;
    const kids = childrenByParent.get(id) || [];
    if (kids.length === 0) {
      heights.push(el.height);
    } else {
      for (const k of kids) collectLeafHeights(k, heights);
    }
  }

  const leafHeights = [];
  collectLeafHeights(subtreeRootEl.id, leafHeights);

  // Total span = sum of all leaf heights + spacing gaps between them
  const totalHeightSum = leafHeights.reduce((a, b) => a + b, 0);
  const totalGaps = Math.max(0, leafHeights.length - 1) * siblingSpacing;
  const totalSpan = totalHeightSum + totalGaps;

  const rootCenterY = centerY(subtreeRootEl);
  // Start from top edge of the first leaf
  let nextLeafTopY = rootCenterY - totalSpan / 2;

  function assignY(id) {
    const el = byId.get(id);
    if (!el) return;

    const kids = childrenByParent.get(id) || [];

    if (kids.length === 0) {
      // Place leaf at nextLeafTopY (top edge), then advance by its height + spacing
      const cur = pos.get(id) || { x: el.x, y: el.y };
      cur.y = nextLeafTopY;
      pos.set(id, cur);
      nextLeafTopY += el.height + siblingSpacing;
      return;
    }

    for (const k of kids) assignY(k);

    const first = byId.get(kids[0]);
    const last = byId.get(kids[kids.length - 1]);
    if (!first || !last) return;

    const fp = pos.get(first.id) || { x: first.x, y: first.y };
    const lp = pos.get(last.id) || { x: last.x, y: last.y };

    const firstCenter = fp.y + first.height / 2;
    const lastCenter = lp.y + last.height / 2;

    const myCenter = (firstCenter + lastCenter) / 2;
    const yTopLeft = myCenter - el.height / 2;

    const cur = pos.get(id) || { x: el.x, y: el.y };
    cur.y = yTopLeft;
    pos.set(id, cur);
  }

  assignY(subtreeRootEl.id);

  // Preserve subtree root's Y (top-left)
  const computedRoot = pos.get(subtreeRootEl.id) || {
    x: subtreeRootEl.x,
    y: subtreeRootEl.y,
  };
  const deltaY = subtreeRootEl.y - computedRoot.y;
  for (const [id, p] of pos.entries()) {
    p.y += deltaY;
    pos.set(id, p);
  }

  function assignX(id) {
    const el = byId.get(id);
    if (!el) return;

    const cur = pos.get(id) || { x: el.x, y: el.y };

    if (id === subtreeRootEl.id) {
      cur.x = subtreeRootEl.x;
      pos.set(id, cur);
    }

    const kids = childrenByParent.get(id) || [];
    for (const k of kids) {
      const childEl = byId.get(k);
      if (!childEl) continue;

      const parentP = pos.get(id) || { x: el.x, y: el.y };
      const childP = pos.get(k) || { x: childEl.x, y: childEl.y };

      if (effectiveDir === 'LR') {
        childP.x = parentP.x + el.width + levelSpacing;
      } else {
        childP.x = parentP.x - levelSpacing - childEl.width;
      }

      pos.set(k, childP);
      assignX(k);
    }
  }

  assignX(subtreeRootEl.id);

  // Edit set: nodes + arrows
  const arrowIds = edges.map(e => e.arrowId).filter(Boolean);
  const liveNodeEls = nodes.map(n => ea.getElement(n.id) || n).filter(Boolean);
  const liveArrowEls = arrowIds
    .map(id => ea.getElement(id) || snap.byId.get(id))
    .filter(a => a && a.type === 'arrow');

  const editSet = (() => {
    const m = new Map();
    for (const el of [].concat(liveNodeEls, liveArrowEls)) {
      if (el && el.id) m.set(el.id, el);
    }
    return Array.from(m.values());
  })();

  try {
    ea.copyViewElementsToEAforEditing(editSet);
  } catch (_e) {
    new Notice('Optimize layout failed: could not enter edit mode.');
    return;
  }

  let moved = 0;
  for (const n of nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const ed = ea.getElement(n.id);
    if (!ed) continue;
    if (ed.x !== p.x || ed.y !== p.y) {
      ed.x = p.x;
      ed.y = p.y;
      moved++;
    }
  }

  let straightened = 0;
  for (const e of edges) {
    if (!e.arrowId) continue;
    const a = ea.getElement(e.arrowId);
    if (!a || a.type !== 'arrow') continue;

    const pEl = ea.getElement(e.parentId);
    const cEl = ea.getElement(e.childId);
    if (!pEl || !cEl) continue;

    straightenArrowBetween(pEl, cEl, a, effectiveDir);
    straightened++;
  }

  await ea.addElementsToView(false, false, true);
  new Notice(
    `Optimized layout (${mindmapDir}). Moved ${moved} node(s), straightened ${straightened} arrow(s).`
  );
}

async function optimizeLayoutBiRoot(
  rootEl,
  snap,
  mindmapDir,
  mindmapRoot,
  levelSpacing,
  siblingSpacing
) {
  // ✅ Use ALL outgoing edges so branches can be moved across sides safely
  const { nodes, edges } = collectSubtreeAllOut(rootEl, snap);

  if (!nodes || nodes.length <= 1) {
    new Notice('Nothing to optimize (no children found).');
    return;
  }

  const byId = new Map(nodes.map(n => [n.id, n]));
  const childrenByParent = new Map();

  for (const e of edges) {
    if (!childrenByParent.has(e.parentId)) childrenByParent.set(e.parentId, []);
    childrenByParent.get(e.parentId).push(e.childId);
  }

  // stable order by current y (predictable)
  for (const [pId, childIds] of childrenByParent.entries()) {
    childIds.sort((a, b) => (byId.get(a)?.y || 0) - (byId.get(b)?.y || 0));
  }

  // ✅ Force split: root’s direct children alternate by Y order (R, L, R, L...)
  const sideById = new Map(); // nodeId -> 'L'|'R'|'C'
  sideById.set(rootEl.id, 'C');

  const rootKids = (childrenByParent.get(rootEl.id) || []).slice();
  rootKids.sort((a, b) => (byId.get(a)?.y || 0) - (byId.get(b)?.y || 0));

  for (let i = 0; i < rootKids.length; i++) {
    sideById.set(rootKids[i], i % 2 === 0 ? 'R' : 'L');
  }

  // Descendants inherit side from their parent
  function propagateSide(pId) {
    const kids = childrenByParent.get(pId) || [];
    for (const k of kids) {
      if (!sideById.has(k)) {
        const pSide = sideById.get(pId) || 'C';
        sideById.set(k, pSide === 'L' ? 'L' : 'R');
      }
      propagateSide(k);
    }
  }
  propagateSide(rootEl.id);

  // -------------------------------------------------
  // ✅ Per-side vertical distribution (BI)
  // Layout L and R independently so same-side root children
  // are not separated by the opposite side’s subtree.
  // -------------------------------------------------
  const pos = new Map(); // id -> {x,y}
  const rootCenterY = centerY(rootEl);

  // Root stays fixed
  pos.set(rootEl.id, { x: rootEl.x, y: rootEl.y });

  function childrenOnSameSide(parentId, side) {
    const kids = childrenByParent.get(parentId) || [];
    return kids.filter(kId => (sideById.get(kId) || 'R') === side);
  }

  function countLeavesSide(id, side) {
    const kids = childrenOnSameSide(id, side);
    if (kids.length === 0) return 1;
    let sum = 0;
    for (const k of kids) sum += countLeavesSide(k, side);
    return sum;
  }

  function assignYSide(id, side, ctx) {
    const el = byId.get(id);
    if (!el) return;

    const kids = childrenOnSameSide(id, side);

    if (kids.length === 0) {
      // Place leaf at nextLeafTopY (top edge), then advance by its height + spacing
      const cur = pos.get(id) || { x: el.x, y: el.y };
      cur.y = ctx.nextLeafTopY;
      pos.set(id, cur);
      ctx.nextLeafTopY += el.height + siblingSpacing;
      return;
    }

    for (const k of kids) assignYSide(k, side, ctx);

    const first = byId.get(kids[0]);
    const last = byId.get(kids[kids.length - 1]);
    if (!first || !last) return;

    const fp = pos.get(first.id) || { x: first.x, y: first.y };
    const lp = pos.get(last.id) || { x: last.x, y: last.y };

    const firstCenter = fp.y + first.height / 2;
    const lastCenter = lp.y + last.height / 2;

    const myCenter = (firstCenter + lastCenter) / 2;
    const yTopLeft = myCenter - el.height / 2;

    const cur = pos.get(id) || { x: el.x, y: el.y };
    cur.y = yTopLeft;
    pos.set(id, cur);
  }

  // Collect leaf heights for a side
  function collectLeafHeightsSide(id, side, heights) {
    const el = byId.get(id);
    if (!el) return;
    const kids = childrenOnSameSide(id, side);
    if (kids.length === 0) {
      heights.push(el.height);
    } else {
      for (const k of kids) collectLeafHeightsSide(k, side, heights);
    }
  }

  function layoutSide(side) {
    const kids = (childrenByParent.get(rootEl.id) || []).filter(
      kId => (sideById.get(kId) || 'R') === side
    );
    if (kids.length === 0) return;

    // Stable order
    kids.sort((a, b) => (byId.get(a)?.y || 0) - (byId.get(b)?.y || 0));

    // Collect all leaf heights on this side
    const leafHeights = [];
    for (const k of kids) collectLeafHeightsSide(k, side, leafHeights);

    // Total span = sum of all leaf heights + spacing gaps between them
    const totalHeightSum = leafHeights.reduce((a, b) => a + b, 0);
    const totalGaps = Math.max(0, leafHeights.length - 1) * siblingSpacing;
    const totalSpan = totalHeightSum + totalGaps;

    const ctx = { nextLeafTopY: rootCenterY - totalSpan / 2 };

    for (const k of kids) assignYSide(k, side, ctx);
  }

  // Key change: do both sides independently
  layoutSide('L');
  layoutSide('R');

  // -------------------------------------------------
  // X assignment: based on sideById
  // -------------------------------------------------
  function assignX(id) {
    const el = byId.get(id);
    if (!el) return;

    const cur = pos.get(id) || { x: el.x, y: el.y };
    if (id === rootEl.id) {
      cur.x = rootEl.x;
      pos.set(id, cur);
    }

    const kids = childrenByParent.get(id) || [];
    for (const k of kids) {
      const childEl = byId.get(k);
      if (!childEl) continue;

      const parentP = pos.get(id) || { x: el.x, y: el.y };
      const childP = pos.get(k) || { x: childEl.x, y: childEl.y };

      const side = sideById.get(k) || 'R';
      if (side === 'L') {
        childP.x = parentP.x - levelSpacing - childEl.width;
      } else {
        childP.x = parentP.x + el.width + levelSpacing;
      }

      pos.set(k, childP);
      assignX(k);
    }
  }

  assignX(rootEl.id);

  // -------------------------------------------------
  // Edit set: nodes + arrows
  // -------------------------------------------------
  const arrowIds = edges.map(e => e.arrowId).filter(Boolean);
  const liveNodeEls = nodes.map(n => ea.getElement(n.id) || n).filter(Boolean);
  const liveArrowEls = arrowIds
    .map(id => ea.getElement(id) || snap.byId.get(id))
    .filter(a => a && a.type === 'arrow');

  const editSet = (() => {
    const m = new Map();
    for (const el of [].concat(liveNodeEls, liveArrowEls)) {
      if (el && el.id) m.set(el.id, el);
    }
    return Array.from(m.values());
  })();

  try {
    ea.copyViewElementsToEAforEditing(editSet);
  } catch (_e) {
    new Notice('Optimize layout failed: could not enter edit mode.');
    return;
  }

  let moved = 0;
  for (const n of nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const ed = ea.getElement(n.id);
    if (!ed) continue;
    if (ed.x !== p.x || ed.y !== p.y) {
      ed.x = p.x;
      ed.y = p.y;
      moved++;
    }
  }

  // -------------------------------------------------
  // Straighten arrows
  // -------------------------------------------------
  let straightened = 0;
  for (const e of edges) {
    if (!e.arrowId) continue;
    const a = ea.getElement(e.arrowId);
    if (!a || a.type !== 'arrow') continue;

    const pEl = ea.getElement(e.parentId);
    const cEl = ea.getElement(e.childId);
    if (!pEl || !cEl) continue;

    const side = sideById.get(e.childId) || 'R';
    const edgeDir = side === 'L' ? 'RL' : 'LR';
    straightenArrowBetween(pEl, cEl, a, edgeDir);
    straightened++;
  }

  await ea.addElementsToView(false, false, true);
  new Notice(
    `Optimized BI layout. Moved ${moved} node(s), straightened ${straightened} arrow(s).`
  );
}

// -----------------------------------------------------
// A. Single text block with NO connections: build mindmap from bullets
// -----------------------------------------------------
if (
  selectedElements.length === 1 &&
  selectedElements[0].type === 'text' &&
  !hasConnections(selectedElements[0], snapshot)
) {
  async function parseBulletedText(rawText) {
    const lines = rawText.split('\n');

    const nodes = [];
    const indentStack = [0];
    const nodeStack = [];

    const normalizeIndent = ws => (ws || '').replace(/\t/g, '    ').length;

    const parseLine = line => {
      const match = line.match(/^(\s*)(?:([-*+])|(\d+\.))?\s*(.*)$/);
      if (!match) return null;
      const leadingWs = match[1] || '';
      const content = (match[4] || '').trim();
      if (!content) return null;
      const indent = normalizeIndent(leadingWs);
      return { indent, content };
    };

    for (const line of lines) {
      if (!line.trim()) continue;

      const info = parseLine(line);
      if (!info) continue;

      const { indent, content } = info;

      while (
        indent < indentStack[indentStack.length - 1] &&
        indentStack.length > 1
      ) {
        indentStack.pop();
        nodeStack.pop();
      }

      if (indent > indentStack[indentStack.length - 1]) {
        indentStack.push(indent);
      }

      const level = indentStack.length - 1;

      const node = {
        label: content,
        level,
        parent: null,
        children: [],
        element: null,
      };

      if (level > 0 && nodeStack[level - 1]) {
        node.parent = nodeStack[level - 1];
        nodeStack[level - 1].children.push(node);
      }

      nodeStack[level] = node;
      nodeStack.length = level + 1;

      nodes.push(node);
    }

    let rootNodes = nodes.filter(n => !n.parent);

    if (rootNodes.length > 1) {
      let rootNodeLabel = 'Root';
      try {
        const userInput = await utils.inputPrompt(
          'Multiple root nodes detected',
          'Enter text for the root node',
          'Root',
          [
            { caption: 'Confirm', action: input => input || 'Root' },
            { caption: 'Cancel', action: () => 'Root' },
          ]
        );
        if (userInput !== null && userInput !== '' && userInput !== undefined) {
          rootNodeLabel = userInput;
        }
      } catch (_e) {}

      const defaultRootNode = {
        label: rootNodeLabel,
        level: 0,
        parent: null,
        children: [],
        element: null,
      };

      for (const originalRoot of rootNodes) {
        originalRoot.parent = defaultRootNode;
        defaultRootNode.children.push(originalRoot);
      }

      return [defaultRootNode];
    }

    return rootNodes;
  }

  async function chooseDirection(defaultDir = 'LR') {
    const choice = await utils.suggester(
      ['Left → Right (LR)', 'Right → Left (RL)', 'Center split (BI)'],
      ['LR', 'RL', 'BI'],
      `Mindmap direction (default ${defaultDir})`
    );
    return choice === null ? defaultDir : choice;
  }

  function createTextOptions() {
    return {
      fontFamily: 5,
      fontSize: 20,
      textAlign: 'center',
      roughness: 2,
      strokeWidth: 1,
      strokeStyle: 'solid',
      strokeSharpness: 'sharp',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeColor: '#000000',
      opacity: 100,
      handDrawn: true,
      isHandDrawn: true,
    };
  }

  async function buildMindmapFromBullets(rootNode, originalTextEl) {
    const dir = await chooseDirection('LR');
    const { levelSpacing, siblingSpacing } = getAxisSpacing();
    const textOptions = createTextOptions();

    // Create elements for measurement
    function createElements(node) {
      const id = ea.addText(0, 0, node.label, textOptions);
      node.element = ea.getElement(id);
      for (const c of node.children || []) createElements(c);
    }
    createElements(rootNode);

    const sourceTextX = originalTextEl.x;
    const sourceTextY = originalTextEl.y;
    const sourceTextW = originalTextEl.width;
    const sourceTextH = originalTextEl.height;

    const rootEl = rootNode.element;
    const centerSrcY = sourceTextY + sourceTextH / 2;

    // Place root to the right of source text block
    rootEl.x = sourceTextX + sourceTextW + 20;
    rootEl.y = centerSrcY - rootEl.height / 2;

    const arrowOptions = makeArrowOptionsFromContext(snapshotCanvas(), []);

    // Tree maps
    const childrenMap = new Map();
    (function walk(n) {
      childrenMap.set(n, (n.children || []).slice());
      for (const c of n.children || []) walk(c);
    })(rootNode);

    function countLeaves(node) {
      const kids = childrenMap.get(node) || [];
      if (kids.length === 0) return 1;
      let sum = 0;
      for (const k of kids) sum += countLeaves(k);
      return sum;
    }

    // Collect all leaf heights for edge-to-edge spacing
    function collectLeafHeights(node, heights) {
      const kids = childrenMap.get(node) || [];
      if (kids.length === 0) {
        heights.push(node.element.height);
      } else {
        for (const c of kids) collectLeafHeights(c, heights);
      }
    }

    const leafHeights = [];
    collectLeafHeights(rootNode, leafHeights);

    // Total span = sum of all leaf heights + spacing gaps between them
    const totalHeightSum = leafHeights.reduce((a, b) => a + b, 0);
    const totalGaps = Math.max(0, leafHeights.length - 1) * siblingSpacing;
    const totalSpan = totalHeightSum + totalGaps;

    let nextLeafTopY = centerY(rootEl) - totalSpan / 2;

    function assignY(node) {
      const el = node.element;
      const kids = childrenMap.get(node) || [];

      if (kids.length === 0) {
        // Place leaf at nextLeafTopY (top edge), then advance by its height + spacing
        el.y = nextLeafTopY;
        nextLeafTopY += el.height + siblingSpacing;
        return;
      }

      for (const c of kids) assignY(c);

      const first = kids[0].element;
      const last = kids[kids.length - 1].element;
      const myCenter = (centerY(first) + centerY(last)) / 2;
      el.y = myCenter - el.height / 2;
    }

    assignY(rootNode);

    // BI: alternate root children L/R; descendants inherit
    const sideByNode = new Map();
    sideByNode.set(rootNode, 'C');

    if (dir === 'BI') {
      const rootKids = childrenMap.get(rootNode) || [];
      for (let i = 0; i < rootKids.length; i++) {
        sideByNode.set(rootKids[i], i % 2 === 0 ? 'R' : 'L');
      }

      (function propagate(n) {
        const kids = childrenMap.get(n) || [];
        for (const c of kids) {
          if (!sideByNode.has(c)) {
            const pSide = sideByNode.get(n) || 'R';
            sideByNode.set(c, pSide === 'L' ? 'L' : 'R');
          }
          propagate(c);
        }
      })(rootNode);
    }

    function assignX(node) {
      const el = node.element;
      const kids = childrenMap.get(node) || [];
      for (const c of kids) {
        const childEl = c.element;

        let edgeDir = dir;
        if (dir === 'BI') {
          const side = sideByNode.get(c) || 'R';
          edgeDir = side === 'L' ? 'RL' : 'LR';
        }

        if (edgeDir === 'LR') {
          childEl.x = el.x + el.width + levelSpacing;
        } else {
          childEl.x = el.x - levelSpacing - childEl.width;
        }

        assignX(c);
      }
    }

    assignX(rootNode);

    // Store dir on root
    try {
      ea.copyViewElementsToEAforEditing([rootEl]);
      const editableRoot = ea.getElement(rootEl.id) || rootEl;
      writeMindmapDirToRoot_EDITABLE(editableRoot, dir);
    } catch (_e) {}

    // Connect arrows
    function connect(node) {
      for (const c of node.children || []) {
        if (!node.element || !c.element) continue;

        let edgeDir = dir;
        if (dir === 'BI') {
          const side = sideByNode.get(c) || 'R';
          edgeDir = side === 'L' ? 'RL' : 'LR';
        }

        addBoundArrowBetween(node.element, c.element, arrowOptions, edgeDir);
        connect(c);
      }
    }
    connect(rootNode);

    // delete original text block
    try {
      ea.copyViewElementsToEAforEditing([]);
      ea.deleteViewElements([originalTextEl.id]);
    } catch (_e) {
      try {
        const live = ea.getElement(originalTextEl.id) || originalTextEl;
        if (live) {
          ea.copyViewElementsToEAforEditing([live]);
          live.isDeleted = true;
        }
      } catch (__e) {}
    }

    await ea.addElementsToView(false, false, true);
    new Notice(`Created mindmap from bulleted text (${dir})!`);
  }

  const textElement = selectedElements[0];
  let rawText = (textElement.text || '').trim();
  if (!rawText) {
    new Notice('The selected text block is empty.');
    return;
  }

  const rootNodes = await parseBulletedText(rawText);
  if (!rootNodes || rootNodes.length === 0) {
    new Notice('No valid bullet lines found in the selected text block.');
    return;
  }

  await buildMindmapFromBullets(rootNodes[0], textElement);
  return;
}

// -----------------------------------------------------
// Single element selected: action menu
// -----------------------------------------------------
if (selectedElements.length === 1 && selectedElements[0].type === 'text') {
  snapshot = snapshotCanvas();
  const selectedEl = selectedElements[0];

  const { root: mindmapRoot, dir: mindmapDir } = getMindmapDirAndRoot(
    selectedEl,
    snapshot
  );

  const action = await utils.suggester(
    [
      'Group',
      'Copy to clipboard',
      'Add Child',
      'Add Sibling',
      'Optimize layout',
      'Set mindmap direction',
    ],
    ['group', 'copy', 'child', 'sibling', 'optimize', 'setdir'],
    `Choose action (dir: ${mindmapDir})`
  );

  if (action === null) return;

  snapshot = snapshotCanvas();

  if (action === 'group') {
    await groupSubtree(selectedEl, snapshot, mindmapDir, mindmapRoot);
    return;
  }

  if (action === 'copy') {
    await copyOutlineToClipboard(selectedEl, snapshot, mindmapDir, mindmapRoot);
    return;
  }

  if (action === 'child') {
    await insertNode(selectedEl, snapshot, 'child');
    return;
  }

  if (action === 'sibling') {
    await insertNode(selectedEl, snapshot, 'sibling');
    return;
  }

  if (action === 'optimize') {
    await optimizeLayout(selectedEl, snapshot);
    return;
  }

  if (action === 'setdir') {
    const newDir = await utils.suggester(
      ['Left → Right (LR)', 'Right → Left (RL)', 'Center split (BI)'],
      ['LR', 'RL', 'BI'],
      'Set direction for this mindmap (stored on root)'
    );
    if (newDir === null) return;

    const fresh = snapshotCanvas();
    const trueRoot = findMindmapRoot(selectedEl, fresh);

    try {
      ea.copyViewElementsToEAforEditing([trueRoot]);
      const editableRoot = ea.getElement(trueRoot.id) || trueRoot;
      writeMindmapDirToRoot_EDITABLE(editableRoot, newDir);
      await ea.addElementsToView(false, false, true);
      new Notice(`Mindmap direction set to ${newDir} (on root).`);
    } catch (_e) {
      new Notice('Failed to set mindmap direction.');
    }

    return;
  }

  return;
}

// -----------------------------------------------------
// Multi-select: Reconnect / Delete arrows
// -----------------------------------------------------
snapshot = snapshotCanvas();

const nonArrowElements = selectedElements.filter(
  el => el.type !== 'arrow' && el.type !== 'line'
);
const onlyNonArrowsSelected =
  nonArrowElements.length === selectedElements.length;

let userAction = 'connect';

if (!onlyNonArrowsSelected) {
  userAction = await utils.suggester(
    ['Reconnect elements', 'Delete arrows'],
    ['connect', 'delete'],
    'What do you want to do with the selected elements?'
  );
  if (userAction === null) return;
}

if (userAction === 'connect') {
  selectedElements = selectedElements.filter(
    el => el.type !== 'arrow' && el.type !== 'line'
  );

  const selectedTexts = selectedElements.filter(el => el.type === 'text');
  const elementsForConnect =
    selectedTexts.length > 0 ? selectedTexts : selectedElements;

  const selectedIds = new Set(elementsForConnect.map(e => e.id));

  const mindmapInfo = elementsForConnect.length
    ? getMindmapDirAndRoot(elementsForConnect[0], snapshot)
    : { root: null, dir: 'LR' };
  const mindmapDir = mindmapInfo.dir;

  const reconnectArrowStyle = makeArrowOptionsFromContext(
    snapshot,
    elementsForConnect
  );

  function getArrowEndpointAbs(arrow, atStart) {
    const idx = atStart ? 0 : arrow.points.length - 1;
    const p = arrow.points[idx];
    return [arrow.x + p[0], arrow.y + p[1]];
  }

  function pointInsideRect(px, py, el) {
    return (
      px >= el.x &&
      px <= el.x + el.width &&
      py >= el.y &&
      py <= el.y + el.height
    );
  }

  function findSelectedContainingPoint(px, py) {
    for (const el of elementsForConnect) {
      if (pointInsideRect(px, py, el)) return el;
    }
    return null;
  }

  const arrowInfosByPair = new Map(); // pair -> [{arrow, fullyBound}]
  const desiredPairs = new Set(); // "p->c"
  const inCountWithinSelection = new Map(); // childId -> count

  const addDesiredPair = (pId, cId) => {
    const key = `${pId}->${cId}`;
    if (!desiredPairs.has(key)) {
      desiredPairs.add(key);
      inCountWithinSelection.set(
        cId,
        (inCountWithinSelection.get(cId) || 0) + 1
      );
    }
  };

  const addArrowInfo = (pairKey, info) => {
    let arr = arrowInfosByPair.get(pairKey);
    if (!arr) {
      arr = [];
      arrowInfosByPair.set(pairKey, arr);
    }
    arr.push(info);
  };

  // 1) Preserve existing edges among selected nodes
  for (const a of snapshot.arrows) {
    if (a.isDeleted) continue;

    let sEl = null;
    let eEl = null;

    const sId = a.startBinding?.elementId || null;
    const eId = a.endBinding?.elementId || null;

    if (sId && selectedIds.has(sId)) sEl = snapshot.byId.get(sId) || null;
    if (eId && selectedIds.has(eId)) eEl = snapshot.byId.get(eId) || null;

    if (!sEl) {
      const [sx, sy] = getArrowEndpointAbs(a, true);
      sEl = findSelectedContainingPoint(sx, sy);
    }
    if (!eEl) {
      const [ex, ey] = getArrowEndpointAbs(a, false);
      eEl = findSelectedContainingPoint(ex, ey);
    }

    if (!sEl || !eEl) continue;
    if (sEl.id === eEl.id) continue;

    // For LR/RL: keep directional feel. For BI: allow both sides.
    if (mindmapDir === 'LR') {
      if (!(centerX(eEl) > centerX(sEl))) continue;
    } else if (mindmapDir === 'RL') {
      if (!(centerX(eEl) < centerX(sEl))) continue;
    }

    const pairKey = `${sEl.id}->${eEl.id}`;
    addDesiredPair(sEl.id, eEl.id);

    const fullyBound = !!(a.startBinding?.elementId && a.endBinding?.elementId);
    addArrowInfo(pairKey, { arrow: a, fullyBound });
  }

  // 2) Infer only for true orphans (no incoming arrows anywhere)
  function hasAnyIncomingArrow(el, snap2) {
    const inc = snap2.incomingArrows.get(el.id) || [];
    return inc.some(a => !a.isDeleted);
  }

  function forwardGap(parent, child, dir2) {
    if (dir2 === 'LR') return child.x - (parent.x + parent.width);
    return parent.x - (child.x + child.width);
  }

  function perpGap(parent, child) {
    return Math.abs(centerY(parent) - centerY(child));
  }

  function isPotentialParent(parent, child, dir2) {
    return forwardGap(parent, child, dir2) > 0;
  }

  function findBestParentFor(childEl) {
    let best = null;
    let bestScore = Infinity;

    if (mindmapDir === 'BI') {
      for (const p of elementsForConnect) {
        if (p.id === childEl.id) continue;

        const gapL = forwardGap(p, childEl, 'LR');
        const gapR = forwardGap(p, childEl, 'RL');

        let ok = false;
        let gap = Infinity;
        if (gapL > 0) {
          ok = true;
          gap = Math.min(gap, gapL);
        }
        if (gapR > 0) {
          ok = true;
          gap = Math.min(gap, gapR);
        }
        if (!ok) continue;

        const score = gap + perpGap(p, childEl) * 0.5;
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
      return best;
    }

    for (const p of elementsForConnect) {
      if (p.id === childEl.id) continue;
      if (!isPotentialParent(p, childEl, mindmapDir)) continue;
      const score =
        forwardGap(p, childEl, mindmapDir) + perpGap(p, childEl) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }

    return best;
  }

  for (const el of elementsForConnect) {
    const inSel = inCountWithinSelection.get(el.id) || 0;
    if (inSel > 0) continue;
    if (hasAnyIncomingArrow(el, snapshot)) continue;

    const parent = findBestParentFor(el);
    if (!parent) continue;
    addDesiredPair(parent.id, el.id);
  }

  // 3) Apply repairs
  const arrowsToDelete = [];
  const arrowsToCenter = [];
  const edgesToCreate = [];

  const getLive = id => snapshot.byId.get(id) || ea.getElement(id) || null;

  for (const pairKey of desiredPairs) {
    const infos = arrowInfosByPair.get(pairKey) || [];
    const [pId, cId] = pairKey.split('->');

    const parentEl = getLive(pId);
    const childEl = getLive(cId);
    if (!parentEl || !childEl) continue;

    const hasBound = snapshot.boundArrowPairs.has(pairKey);

    if (hasBound) {
      for (const info of infos) {
        if (info.fullyBound) arrowsToCenter.push(info.arrow);
      }
      continue;
    }

    for (const info of infos) arrowsToDelete.push(info.arrow);
    edgesToCreate.push({ pId, cId });
  }

  const uniqById = arr => {
    const m = new Map();
    for (const x of arr) if (x && x.id) m.set(x.id, x);
    return Array.from(m.values());
  };

  const editSet = uniqById(
    [].concat(elementsForConnect).concat(arrowsToDelete).concat(arrowsToCenter)
  );

  try {
    ea.copyViewElementsToEAforEditing(editSet);
  } catch (_e) {}

  for (const a of arrowsToDelete) {
    const live = ea.getElement(a.id) || a;
    if (live) live.isDeleted = true;
  }

  for (const a of arrowsToCenter) {
    const live = ea.getElement(a.id) || a;
    if (!live || live.type !== 'arrow') continue;

    try {
      const sId = live.startBinding?.elementId;
      const eId = live.endBinding?.elementId;
      if (!sId || !eId) continue;

      const sEl = getLive(sId);
      const eEl = getLive(eId);
      if (!sEl || !eEl) continue;

      const dirLRorRL = centerX(eEl) >= centerX(sEl) ? 'LR' : 'RL';
      const { fpStart, fpEnd } = getSidesForDir(dirLRorRL);

      if (live.startBinding) {
        live.startBinding.focus = 0;
        if (live.startBinding.fixedPoint)
          live.startBinding.fixedPoint = fpStart;
      }
      if (live.endBinding) {
        live.endBinding.focus = 0;
        if (live.endBinding.fixedPoint) live.endBinding.fixedPoint = fpEnd;
      }
    } catch (_e) {}
  }

  let createdCount = 0;
  for (const { pId, cId } of edgesToCreate) {
    const pEl = getLive(pId);
    const cEl = getLive(cId);
    if (!pEl || !cEl) continue;

    const dirLRorRL = centerX(cEl) >= centerX(pEl) ? 'LR' : 'RL';
    addBoundArrowBetween(pEl, cEl, reconnectArrowStyle, dirLRorRL);
    snapshot.boundArrowPairs.add(`${pId}->${cId}`);
    createdCount++;
  }

  await ea.addElementsToView(false, false, true);

  new Notice(
    `Reconnected. Kept ${Math.max(
      0,
      desiredPairs.size - createdCount
    )} link(s), created ${createdCount} repair link(s).`
  );

  return;
}

if (userAction === 'delete') {
  const selectedIds = new Set(selectedElements.map(el => el.id));

  const directlySelectedArrows = selectedElements.filter(
    el => el.type === 'arrow'
  );

  const connectedArrows = snapshot.arrows.filter(el => {
    const startId = el.startBinding?.elementId;
    const endId = el.endBinding?.elementId;
    return (
      (startId && selectedIds.has(startId)) || (endId && selectedIds.has(endId))
    );
  });

  const toDeleteMap = new Map();
  for (const a of directlySelectedArrows) toDeleteMap.set(a.id, a);
  for (const a of connectedArrows) toDeleteMap.set(a.id, a);

  const arrowsToDelete = Array.from(toDeleteMap.values());

  if (arrowsToDelete.length === 0) {
    new Notice('No arrows found connected to the selected elements.');
    return;
  }

  ea.copyViewElementsToEAforEditing(arrowsToDelete);

  for (const a of arrowsToDelete) {
    const live = ea.getElement(a.id) || a;
    if (live) live.isDeleted = true;
  }

  await ea.addElementsToView(false, false, true);
  new Notice(
    `Deleted ${arrowsToDelete.length} arrow${
      arrowsToDelete.length > 1 ? 's' : ''
    }.`
  );
  return;
}
