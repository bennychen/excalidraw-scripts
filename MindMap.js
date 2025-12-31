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
      "Horizontal distance between levels (from parent's right to child's left)",
  },
  'Vertical spacing': {
    value: 100,
    description: 'Vertical spacing between sibling nodes',
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
// Key state tracker (CTRL/CMD gating for insert menu)
// -----------------------------------------------------
function ensureMindmapKeyTracker() {
  if (window.__mindmapKeyTrackerInstalled) return;

  window.__mindmapKeyState = window.__mindmapKeyState || {
    ctrl: false,
    meta: false,
    shift: false,
    alt: false,
    lastCtrlOrMetaDownAt: 0,
  };

  const updateFromEvent = (e, isDown) => {
    try {
      if (e.key === 'Control') window.__mindmapKeyState.ctrl = isDown;
      if (e.key === 'Meta') window.__mindmapKeyState.meta = isDown;
      if (e.key === 'Shift') window.__mindmapKeyState.shift = isDown;
      if (e.key === 'Alt') window.__mindmapKeyState.alt = isDown;

      // Modifier flags are often more reliable in Obsidian
      if (typeof e.ctrlKey === 'boolean')
        window.__mindmapKeyState.ctrl = e.ctrlKey;
      if (typeof e.metaKey === 'boolean')
        window.__mindmapKeyState.meta = e.metaKey;
      if (typeof e.shiftKey === 'boolean')
        window.__mindmapKeyState.shift = e.shiftKey;
      if (typeof e.altKey === 'boolean')
        window.__mindmapKeyState.alt = e.altKey;

      if (
        isDown &&
        (window.__mindmapKeyState.ctrl || window.__mindmapKeyState.meta)
      ) {
        window.__mindmapKeyState.lastCtrlOrMetaDownAt = Date.now();
      }
    } catch (_e) {
      // ignore
    }
  };

  const onKeyDown = e => updateFromEvent(e, true);
  const onKeyUp = e => updateFromEvent(e, false);
  const onBlur = () => {
    window.__mindmapKeyState.ctrl = false;
    window.__mindmapKeyState.meta = false;
    window.__mindmapKeyState.shift = false;
    window.__mindmapKeyState.alt = false;
  };

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur, true);

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);

  window.__mindmapKeyTrackerInstalled = true;
}

function isCtrlOrCmdPressed() {
  ensureMindmapKeyTracker();

  const st = window.__mindmapKeyState;
  if (st && (st.ctrl || st.meta)) return true;

  // Recent window helps for “hold ctrl, click, then run command” workflows
  const RECENT_MS = 700;
  if (
    st &&
    st.lastCtrlOrMetaDownAt &&
    Date.now() - st.lastCtrlOrMetaDownAt <= RECENT_MS
  ) {
    return true;
  }

  // Fallback: sometimes the triggering event is accessible
  try {
    const ev = window.event;
    if (ev && (ev.ctrlKey || ev.metaKey)) return true;
  } catch (_e) {}

  return false;
}

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
// Style helpers (fix “sloppiness” mismatch)
// -----------------------------------------------------
function normalizeArrowHead(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.toLowerCase() === 'none') return null;
  return v;
}

function pickArrowStyleFor(sourceEl, snap) {
  // Prefer an arrow that is already connected to this node
  const candidates = []
    .concat(snap.outgoingArrows.get(sourceEl.id) || [])
    .concat(snap.incomingArrows.get(sourceEl.id) || []);

  const hit = candidates.find(a => a.type === 'arrow' && !a.isDeleted);
  if (hit) return hit;

  // Fallback: any arrow on the canvas
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

    // Inherit “sloppiness” / stroke from an existing arrow
    strokeColor: a?.strokeColor ?? app.currentItemStrokeColor ?? '#000000',
    strokeWidth: a?.strokeWidth ?? app.currentItemStrokeWidth ?? 1,
    strokeStyle: a?.strokeStyle ?? app.currentItemStrokeStyle ?? 'solid',
    strokeSharpness:
      a?.strokeSharpness ?? app.currentItemStrokeSharpness ?? 'sharp',
    roughness: a?.roughness ?? app.currentItemRoughness ?? 0,
  };
}

function makeArrowOptionsFromContext(snap, preferredEls = []) {
  // Use any arrow connected to any preferred element; else any arrow; else appState
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
// Create a bound arrow between two elements (edge centers)
// -----------------------------------------------------
function addBoundArrowBetween(sourceEl, targetEl, style = {}) {
  const sourceCenterX = sourceEl.x + sourceEl.width / 2;
  const targetCenterX = targetEl.x + targetEl.width / 2;

  // Always connect horizontally for mindmaps
  const goRight = targetCenterX >= sourceCenterX;
  const sourceSide = goRight ? 'right' : 'left';
  const targetSide = goRight ? 'left' : 'right';

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
    sourceSide,
    targetEl.id,
    targetSide,
    {
      numberOfPoints,
      startArrowHead,
      endArrowHead,
      padding: 0,
    }
  );

  // Best-effort centering on the edge midpoints
  try {
    if (createdId) {
      const a = ea.getElement(createdId);
      if (a && a.type === 'arrow') {
        if (a.startBinding) {
          a.startBinding.focus = 0;
          if (a.startBinding.fixedPoint)
            a.startBinding.fixedPoint = goRight ? [1, 0.5] : [0, 0.5];
        }
        if (a.endBinding) {
          a.endBinding.focus = 0;
          if (a.endBinding.fixedPoint)
            a.endBinding.fixedPoint = goRight ? [0, 0.5] : [1, 0.5];
        }
      }
    }
  } catch (_e) {
    // ignore
  }

  return createdId;
}

// -----------------------------------------------------
// Insert child/sibling helpers (CTRL/CMD only)
// -----------------------------------------------------
function getRightChildren(parentEl, snap) {
  const outgoing = snap.outgoingArrows.get(parentEl.id) || [];
  const children = [];
  for (const a of outgoing) {
    const childId = a.endBinding?.elementId;
    if (!childId) continue;
    const childEl = snap.byId.get(childId);
    if (!childEl) continue;
    if (childEl.x > parentEl.x) children.push(childEl);
  }
  children.sort((a, b) => a.y - b.y);
  return children;
}

function getParentFromLeft(childEl, snap) {
  const incoming = snap.incomingArrows.get(childEl.id) || [];
  const candidates = [];
  for (const a of incoming) {
    const pId = a.startBinding?.elementId;
    if (!pId) continue;
    const pEl = snap.byId.get(pId);
    if (!pEl) continue;
    if (pEl.x < childEl.x) candidates.push(pEl);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.x - a.x); // closest from left
  return candidates[0];
}

async function insertChildOrSiblingFlow(selectedEl, snap) {
  const choice = await utils.suggester(
    ['Add child', 'Add sibling', 'Run default outline'],
    ['child', 'sibling', 'outline'],
    'CTRL/CMD held: quick action'
  );
  if (choice === null) return { didInsert: false, forceOutline: false };
  if (choice === 'outline') return { didInsert: false, forceOutline: true };

  const label = await utils.inputPrompt(
    choice === 'child' ? 'Add child node' : 'Add sibling node',
    'Enter node text',
    '',
    [
      { caption: 'Confirm', action: input => (input || '').trim() },
      { caption: 'Cancel', action: () => null },
    ]
  );

  if (label === null || label === undefined || label === '') {
    return { didInsert: true, forceOutline: false }; // treat as handled
  }

  const xSpacing = parseFloat(settings['Horizontal spacing'].value) || 200;
  const ySpacing = parseFloat(settings['Vertical spacing'].value) || 100;

  let sourceEl = null; // arrow start
  let newX = 0;
  let newY = 0;

  if (choice === 'child') {
    sourceEl = selectedEl;
    const existingChildren = getRightChildren(selectedEl, snap);
    if (existingChildren.length > 0) {
      newX = existingChildren[0].x;
      newY = existingChildren[existingChildren.length - 1].y + ySpacing;
    } else {
      newX = selectedEl.x + selectedEl.width + xSpacing;
      newY = selectedEl.y;
    }
  } else {
    const parentEl = getParentFromLeft(selectedEl, snap);
    if (!parentEl) {
      new Notice(
        "No parent found (selected looks like the root). Use 'Add child' instead."
      );
      return { didInsert: true, forceOutline: false };
    }

    sourceEl = parentEl;
    const siblings = getRightChildren(parentEl, snap);
    if (siblings.length > 0) {
      newX = siblings[0].x;
      newY = siblings[siblings.length - 1].y + ySpacing;
    } else {
      newX = parentEl.x + parentEl.width + xSpacing;
      newY = parentEl.y;
    }
  }

  // Make sure source is editable (reliable connectObjects behavior)
  try {
    ea.copyViewElementsToEAforEditing([sourceEl]);
  } catch (_e) {}

  const textOptions = makeTextOptionsFromSource(selectedEl);
  const arrowOptions = makeArrowOptionsFromSource(sourceEl, snap); // inherits sloppiness from existing arrows

  const newId = ea.addText(newX, newY, label, textOptions);
  const newEl = ea.getElement(newId);

  if (newEl) {
    addBoundArrowBetween(sourceEl, newEl, arrowOptions);
  } else {
    // rare fallback
    try {
      ea.connectObjects(sourceEl.id, 'right', newId, 'left', {
        numberOfPoints: arrowOptions.numberOfPoints,
        startArrowHead: arrowOptions.startArrowHead,
        endArrowHead: arrowOptions.endArrowHead,
        padding: 0,
      });
    } catch (_e) {}
  }

  await ea.addElementsToView(false, false, true);
  new Notice(choice === 'child' ? 'Added child node.' : 'Added sibling node.');

  return { didInsert: true, forceOutline: false };
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
        x: 0,
        y: 0,
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
        x: 0,
        y: 0,
      };

      for (const originalRoot of rootNodes) {
        originalRoot.parent = defaultRootNode;
        defaultRootNode.children.push(originalRoot);
      }

      const relabelLevels = (n, lvl) => {
        n.level = lvl;
        for (const c of n.children || []) relabelLevels(c, lvl + 1);
      };
      relabelLevels(defaultRootNode, 0);

      return [defaultRootNode];
    }

    return rootNodes;
  }

  async function buildMindmapFromBullets(rootNode, originalTextEl) {
    const sourceTextX = originalTextEl.x;
    const sourceTextY = originalTextEl.y;
    const sourceTextWidth = originalTextEl.width;
    const sourceTextHeight = originalTextEl.height;

    const xSpacing = parseFloat(settings['Horizontal spacing'].value) || 200;
    const ySpacing = parseFloat(settings['Vertical spacing'].value) || 100;

    const countLeafNodes = node => {
      if (!node.children || node.children.length === 0) return 1;
      return node.children.reduce(
        (sum, child) => sum + countLeafNodes(child),
        0
      );
    };

    const leafNodeCount = countLeafNodes(rootNode);
    const estimatedTotalHeight = (leafNodeCount - 1) * ySpacing;
    const sourceTextCenter = sourceTextY + sourceTextHeight / 2;
    let nextY = sourceTextCenter - estimatedTotalHeight / 2;

    function assignInitialPositions(node, level, x) {
      node.x = x;

      if (!node.children || node.children.length === 0) {
        node.y = nextY;
        nextY += ySpacing;
      } else {
        for (const child of node.children) {
          assignInitialPositions(child, level + 1, x + xSpacing);
        }
        const firstChildY = node.children[0].y;
        const lastChildY = node.children[node.children.length - 1].y;
        node.y = (firstChildY + lastChildY) / 2;
      }
    }

    const rootX = sourceTextX + sourceTextWidth + 20;
    assignInitialPositions(rootNode, 0, rootX);

    ea.style.strokeColor = '#000000';
    ea.style.strokeWidth = 1;
    ea.style.strokeStyle = 'solid';
    ea.style.strokeSharpness = 'sharp';
    ea.style.fontFamily = 5;

    const textOptions = {
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

    const createTextElement = (x, y, text) =>
      ea.addText(x, y, text, textOptions);

    const arrowOptions = {
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
      strokeColor: ea.style.strokeColor,
      strokeWidth: ea.style.strokeWidth,
      strokeStyle: ea.style.strokeStyle,
      strokeSharpness: ea.style.strokeSharpness,
      roughness: 2,
    };

    // temp elements for measurement
    function createTemporaryElements(node) {
      const elementId = ea.addText(node.x, node.y, node.label, textOptions);
      node.element = ea.getElement(elementId);
      for (const child of node.children || []) createTemporaryElements(child);
    }
    createTemporaryElements(rootNode);

    function adjustPositions(node) {
      if (!node.children || node.children.length === 0) return;
      const parentRightEdge = node.x + node.element.width;
      for (const child of node.children) {
        child.element.x = parentRightEdge + xSpacing;
        child.x = child.element.x;
        adjustPositions(child);
      }
    }
    adjustPositions(rootNode);

    const nodePositions = [];
    function collectNodePositions(node) {
      nodePositions.push({
        id: node.element.id,
        x: node.x,
        y: node.y,
        text: node.label,
        node,
      });
      for (const child of node.children || []) collectNodePositions(child);
    }
    collectNodePositions(rootNode);

    const oldElementIds = nodePositions.map(item => item.id);

    function clearElementReferences(node) {
      node.element = null;
      for (const child of node.children || []) clearElementReferences(child);
    }
    clearElementReferences(rootNode);

    for (const item of nodePositions) {
      const elementId = createTextElement(item.x, item.y, item.text);
      const element = ea.getElement(elementId);
      item.node.element = element;
    }

    function connectWithArrows(node) {
      for (const child of node.children || []) {
        if (node.element && child.element) {
          addBoundArrowBetween(node.element, child.element, arrowOptions);
        }
        connectWithArrows(child);
      }
    }
    connectWithArrows(rootNode);

    // delete temp
    try {
      for (const elementId of oldElementIds) {
        const element = ea.getElement(elementId);
        if (element) element.isDeleted = true;
      }
    } catch (_e) {}

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
    new Notice('Created mindmap from bulleted text!');
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
// Single element selected (connected): default outline/group,
// BUT only show Add Child/Sibling when Ctrl/Cmd is held.
// -----------------------------------------------------
if (selectedElements.length === 1 && selectedElements[0].type === 'text') {
  snapshot = snapshotCanvas();
  const rootElement = selectedElements[0];

  if (isCtrlOrCmdPressed()) {
    const res = await insertChildOrSiblingFlow(rootElement, snapshot);
    if (res && res.didInsert) return;
    if (!(res && res.forceOutline)) return; // canceled chooser -> do nothing
    // else: fall through to default outline
  }

  function getChildElements(element, snap, visited) {
    visited = visited || new Set();
    let children = [];

    if (visited.has(element.id)) return children;
    visited.add(element.id);

    const outgoing = snap.outgoingArrows.get(element.id) || [];
    for (const arrow of outgoing) {
      const endId = arrow.endBinding?.elementId;
      const endElement = endId ? snap.byId.get(endId) : null;

      if (endElement && endElement.x > element.x) {
        children.push(endElement);
        children.push(arrow);
        children = children.concat(getChildElements(endElement, snap, visited));
      }
    }

    return children;
  }

  function buildOutline(element, snap, visited = new Set(), depth = 0) {
    if (visited.has(element.id)) return '';
    visited.add(element.id);

    let label = element.text?.trim() ?? `Element ${element.id}`;
    label = label.replace(/\r?\n/g, ' ');

    const indent = '\t'.repeat(depth);
    const useDash = settings['Add dash bullet'].value;
    const bulletPrefix = useDash ? '- ' : '';

    let outline = `${indent}${bulletPrefix}${label}\n`;

    const outgoing = snap.outgoingArrows.get(element.id) || [];
    const childShapes = [];
    for (const arrow of outgoing) {
      const childId = arrow.endBinding?.elementId;
      const childEl = childId ? snap.byId.get(childId) : null;
      if (childEl && childEl.x > element.x) childShapes.push(childEl);
    }

    childShapes.sort((a, b) => a.y - b.y);

    for (const childEl of childShapes) {
      outline += buildOutline(childEl, snap, visited, depth + 1);
    }

    return outline;
  }

  const childElements = getChildElements(rootElement, snapshot);
  if (childElements.length > 0) {
    const elementsToGroup = [rootElement].concat(childElements);
    const elementIdsToGroup = elementsToGroup.map(el => el.id);
    const addBox = settings['Box selected'].value;

    if (addBox) {
      const box = ea.getBoundingBox(elementsToGroup);
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

      ea.copyViewElementsToEAforEditing(elementsToGroup);
      ea.addToGroup([boxId].concat(elementIdsToGroup));
    } else {
      ea.copyViewElementsToEAforEditing(elementsToGroup);
      ea.addToGroup(elementIdsToGroup);
    }

    await ea.addElementsToView(false, false, true);
    new Notice(`Grouped ${elementsToGroup.length} elements.`);
  } else {
    new Notice('No child elements found for the selected element.');
  }

  const bulletText = buildOutline(rootElement, snapshot);

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(bulletText);
      new Notice('Mindmap text copied to clipboard!');
    } else {
      ea.setClipboard(bulletText);
      new Notice('Mindmap text copied to plugin clipboard!');
    }
  } catch (_e) {
    new Notice('Error copying bullet text to clipboard!');
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

// Show prompt only if arrows are included in selection (same as your previous behavior)
if (!onlyNonArrowsSelected) {
  userAction = await utils.suggester(
    ['Reconnect elements', 'Delete arrows'],
    ['connect', 'delete'],
    'What do you want to do with the selected elements?'
  );
  if (userAction === null) return;
}

if (userAction === 'connect') {
  // Reconnect = preserve original connections; only repair missing/broken.
  selectedElements = selectedElements.filter(
    el => el.type !== 'arrow' && el.type !== 'line'
  );

  const selectedTexts = selectedElements.filter(el => el.type === 'text');
  const elementsForConnect =
    selectedTexts.length > 0 ? selectedTexts : selectedElements;

  const selectedIds = new Set(elementsForConnect.map(e => e.id));

  // Arrow style for *new* edges (match existing line “sloppiness”)
  const reconnectArrowStyle = makeArrowOptionsFromContext(
    snapshot,
    elementsForConnect
  );

  // Endpoint helpers for broken/unbound arrows
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

  const centerY = el => el.y + el.height / 2;

  // Desired edges = preserved edges among selected + inferred edges for true orphans
  const arrowInfosByPair = new Map(); // pair -> [{arrow, fullyBound}]
  const desiredPairs = new Set(); // "p->c"
  const inCountWithinSelection = new Map(); // childId -> count (within selected)

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

  // 1) Preserve all existing edges among selected nodes
  for (const a of snapshot.arrows) {
    if (a.isDeleted) continue;

    let sEl = null;
    let eEl = null;

    const sId = a.startBinding?.elementId || null;
    const eId = a.endBinding?.elementId || null;

    if (sId && selectedIds.has(sId)) sEl = snapshot.byId.get(sId) || null;
    if (eId && selectedIds.has(eId)) eEl = snapshot.byId.get(eId) || null;

    // fallback for broken arrows: endpoint hit-test into selected nodes
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

    // mindmap direction: left -> right only
    if (eEl.x <= sEl.x) continue;

    const pairKey = `${sEl.id}->${eEl.id}`;
    addDesiredPair(sEl.id, eEl.id);

    const fullyBound = !!(a.startBinding?.elementId && a.endBinding?.elementId);
    addArrowInfo(pairKey, { arrow: a, fullyBound });
  }

  // 2) Only infer a parent for a node if it is a “true orphan” globally:
  // - no incoming arrows at all (even from outside selection)
  // This prevents re-wiring when you selected a subset of a larger map.
  function hasAnyIncomingArrow(el, snap) {
    const inc = snap.incomingArrows.get(el.id) || [];
    return inc.some(a => !a.isDeleted);
  }

  function findBestParentFor(childEl) {
    const childLeftX = childEl.x;

    const potentialParents = elementsForConnect.filter(p => {
      const pr = p.x + p.width;
      return p.id !== childEl.id && pr < childLeftX;
    });
    if (potentialParents.length === 0) return null;

    // column-adjacent filter
    const columnAdjacent = potentialParents.filter(p => {
      const pr = p.x + p.width;
      return !potentialParents.some(other => {
        if (other.id === p.id) return false;
        const or = other.x + other.width;
        return other.x > pr && or < childLeftX;
      });
    });

    const candidates =
      columnAdjacent.length > 0 ? columnAdjacent : potentialParents;

    let best = null;
    let bestGap = Infinity;
    for (const p of candidates) {
      const gap = Math.abs(centerY(p) - centerY(childEl));
      if (gap < bestGap) {
        bestGap = gap;
        best = p;
      }
    }
    return best;
  }

  for (const el of elementsForConnect) {
    const inSel = inCountWithinSelection.get(el.id) || 0;
    if (inSel > 0) continue; // already has a parent within selected => preserve
    if (hasAnyIncomingArrow(el, snapshot)) continue; // has a parent somewhere else => do NOT infer

    const parent = findBestParentFor(el);
    if (!parent) continue; // treat as root
    addDesiredPair(parent.id, el.id);
  }

  // 3) Apply: keep good arrows; recreate broken/missing ones; do not disturb original edges
  const arrowsToDelete = [];
  const arrowsToCenter = [];
  const edgesToCreate = []; // [{pId,cId}]

  const getLive = id => snapshot.byId.get(id) || ea.getElement(id) || null;

  for (const pairKey of desiredPairs) {
    const infos = arrowInfosByPair.get(pairKey) || [];
    const [pId, cId] = pairKey.split('->');

    const parentEl = getLive(pId);
    const childEl = getLive(cId);
    if (!parentEl || !childEl) continue;

    const hasBound = snapshot.boundArrowPairs.has(pairKey);

    if (hasBound) {
      // keep it; optionally center endpoints if your build supports focus/fixedPoint
      for (const info of infos) {
        if (info.fullyBound) arrowsToCenter.push(info.arrow);
      }
      continue;
    }

    // If there are existing arrows for this pair (likely broken), delete them and recreate
    for (const info of infos) arrowsToDelete.push(info.arrow);

    edgesToCreate.push({ pId, cId });
  }

  // Stage for edit
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

  // Delete broken arrows
  for (const a of arrowsToDelete) {
    const live = ea.getElement(a.id) || a;
    if (live) live.isDeleted = true;
  }

  // Center endpoints on existing bound arrows (best-effort)
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

      const goRight = eEl.x + eEl.width / 2 >= sEl.x + sEl.width / 2;

      if (live.startBinding) {
        live.startBinding.focus = 0;
        if (live.startBinding.fixedPoint)
          live.startBinding.fixedPoint = goRight ? [1, 0.5] : [0, 0.5];
      }
      if (live.endBinding) {
        live.endBinding.focus = 0;
        if (live.endBinding.fixedPoint)
          live.endBinding.fixedPoint = goRight ? [0, 0.5] : [1, 0.5];
      }
    } catch (_e) {}
  }

  // Create missing/repaired edges (use style that matches existing arrows)
  let createdCount = 0;
  for (const { pId, cId } of edgesToCreate) {
    const pEl = getLive(pId);
    const cEl = getLive(cId);
    if (!pEl || !cEl) continue;

    addBoundArrowBetween(pEl, cEl, reconnectArrowStyle);
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
