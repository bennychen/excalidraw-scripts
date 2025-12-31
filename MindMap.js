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

settings = ea.getScriptSettings();

// Define default settings
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
  if (!defaultSettings.hasOwnProperty(key)) {
    delete settings[key];
  }
}

// Check and set default values for each setting if not present
for (const key in defaultSettings) {
  if (!settings[key]) {
    settings[key] = defaultSettings[key];
  }
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

      // Some environments only reliably expose modifier flags:
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

  // Capture on both document + window to maximize chances in Obsidian/Excalidraw
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur, true);

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);

  window.__mindmapKeyTrackerInstalled = true;
}

function isCtrlOrCmdPressed() {
  ensureMindmapKeyTracker();

  // 1) Use live tracked state
  const st = window.__mindmapKeyState;
  const live = !!(st && (st.ctrl || st.meta));
  if (live) return true;

  // 2) If user pressed Ctrl/Cmd very recently (covers “Ctrl+click then run script” workflows)
  // Keep window short to avoid accidental triggers.
  const RECENT_MS = 700;
  if (
    st &&
    st.lastCtrlOrMetaDownAt &&
    Date.now() - st.lastCtrlOrMetaDownAt <= RECENT_MS
  ) {
    return true;
  }

  // 3) Fallback: sometimes the triggering event is available as window.event
  try {
    const ev = window.event;
    if (ev && (ev.ctrlKey || ev.metaKey)) return true;
  } catch (_e) {}

  return false;
}

// Get selected elements
let selectedElements = ea.getViewSelectedElements();

// Check if any elements are selected
if (selectedElements.length === 0) {
  new Notice(
    'No objects selected. Please select at least one object to connect or select.'
  );
  return;
}

// -----------------------------------------------------
// Snapshot + adjacency maps (Fix #2)
// -----------------------------------------------------
function snapshotCanvas() {
  const elements = ea.getViewElements();
  const byId = new Map();
  const arrows = [];
  const connectors = []; // arrows + lines (for hasConnections)

  const outgoingArrows = new Map(); // elementId -> arrow[]
  const incomingArrows = new Map(); // elementId -> arrow[]
  const outgoingConnectors = new Map(); // elementId -> (arrow|line)[]
  const incomingConnectors = new Map();

  // For fast edge-existence check (bound start->end only)
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

// Build one snapshot up-front for early checks
let snapshot = snapshotCanvas();

// -----------------------------------------------------
// Helper: check if an element has any line/arrow connections (Fix #2)
// -----------------------------------------------------
function hasConnections(el, snap) {
  return (
    (snap.outgoingConnectors.get(el.id)?.length || 0) > 0 ||
    (snap.incomingConnectors.get(el.id)?.length || 0) > 0
  );
}

// -----------------------------------------------------
// Insert child/sibling helpers
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
  // Choose the closest parent on the left (max x)
  candidates.sort((a, b) => b.x - a.x);
  return candidates[0];
}

function normalizeArrowHead(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.toLowerCase() === 'none') return null;
  return v;
}

function makeArrowOptionsFromSource(sourceEl) {
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
    strokeColor: sourceEl?.strokeColor ?? '#000000',
    strokeWidth: sourceEl?.strokeWidth ?? 1,
    strokeStyle: sourceEl?.strokeStyle ?? 'solid',
    strokeSharpness: sourceEl?.strokeSharpness ?? 'sharp',
    roughness: sourceEl?.roughness ?? 0,
  };
}

function makeTextOptionsFromSource(sourceEl) {
  // Keep it conservative: reuse core properties commonly present on Excalidraw text elements.
  // (Your earlier addText usage accepts extra fields in your environment; we keep them.)
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
    return { didInsert: true, forceOutline: false }; // user canceled; treat as handled
  }

  const xSpacing = parseFloat(settings['Horizontal spacing'].value) || 200;
  const ySpacing = parseFloat(settings['Vertical spacing'].value) || 100;

  // Decide source (arrow from) and parent for placement rules
  let sourceEl = null; // arrow start
  let parentEl = null; // for sibling placement
  let newX = 0;
  let newY = 0;

  if (choice === 'child') {
    sourceEl = selectedEl;

    const existingChildren = getRightChildren(selectedEl, snap);
    if (existingChildren.length > 0) {
      // Align to existing child column; add below last child
      newX = existingChildren[0].x;
      newY = existingChildren[existingChildren.length - 1].y + ySpacing;
    } else {
      // First child: to the right of the selected element
      newX = selectedEl.x + selectedEl.width + xSpacing;
      newY = selectedEl.y;
    }
  } else {
    // sibling
    parentEl = getParentFromLeft(selectedEl, snap);
    if (!parentEl) {
      new Notice(
        'No parent found (selected looks like the root). Use "Add child" instead.'
      );
      return { didInsert: true, forceOutline: false };
    }

    sourceEl = parentEl;

    const siblings = getRightChildren(parentEl, snap);
    if (siblings.length > 0) {
      // Prefer same column as existing siblings; add below last sibling
      newX = siblings[0].x;
      newY = siblings[siblings.length - 1].y + ySpacing;
    } else {
      // Fallback: place to the right of parent
      newX = parentEl.x + parentEl.width + xSpacing;
      newY = parentEl.y;
    }
  }

  // IMPORTANT for reliable connections:
  // connectObjects() operates on elements inside EA "editing" context.
  // So we MUST copy the source element from the view into EA for editing first,
  // then create the new text in EA, then connect them.
  try {
    ea.copyViewElementsToEAforEditing([sourceEl]);
  } catch (_e) {
    // If this fails, we still proceed; some builds allow connecting by ids directly.
  }

  // Styling
  const textOptions = makeTextOptionsFromSource(selectedEl);
  const arrowOptions = makeArrowOptionsFromSource(sourceEl, snap);

  // Create node
  const newId = ea.addText(newX, newY, label, textOptions);
  const newEl = ea.getElement(newId);

  // Create connection (source -> new)
  if (newEl) {
    addBoundArrowBetween(sourceEl, newEl, arrowOptions);
  } else {
    // Fallback: if EA didn't give us the element object, try connecting by ids only
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
// A. Detect the "Single Text Block, No Connections" scenario
// -----------------------------------------------------
if (
  selectedElements.length === 1 &&
  selectedElements[0].type === 'text' &&
  !hasConnections(selectedElements[0], snapshot)
) {
  // -----------------------------------------------------
  // Helper function: parse a bulleted text block (with indentation)
  // Robust indent-stack approach (Fix #3)
  async function parseBulletedText(rawText) {
    const lines = rawText.split('\n');

    const nodes = [];
    const indentStack = [0]; // indentation values
    const nodeStack = []; // last node at each level

    // Normalize tabs (Obsidian commonly uses tabs in lists)
    const normalizeIndent = ws => (ws || '').replace(/\t/g, '    ').length;

    // Accept -,*,+, 1. style, or even no bullet (we treat indentation as the hierarchy source)
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

      // Reduce stack until it can accept this indent
      while (
        indent < indentStack[indentStack.length - 1] &&
        indentStack.length > 1
      ) {
        indentStack.pop();
        nodeStack.pop();
      }

      // If indent is deeper than current level, push a new level
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

    // Identify root nodes
    let rootNodes = nodes.filter(n => !n.parent);

    // If multiple roots, wrap them
    if (rootNodes.length > 1) {
      let rootNodeLabel = 'Root';

      try {
        const userInput = await utils.inputPrompt(
          'Multiple root nodes detected',
          'Enter text for the root node',
          'Root',
          [
            {
              caption: 'Confirm',
              action: input => input || 'Root',
            },
            {
              caption: 'Cancel',
              action: () => 'Root',
            },
          ]
        );

        if (userInput !== null && userInput !== '' && userInput !== undefined) {
          rootNodeLabel = userInput;
        }
      } catch (error) {
        console.error('Error with input prompt:', error);
      }

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

      // Normalize levels after wrapping (optional but keeps data consistent)
      const relabelLevels = (n, lvl) => {
        n.level = lvl;
        for (const c of n.children || []) relabelLevels(c, lvl + 1);
      };
      relabelLevels(defaultRootNode, 0);

      return [defaultRootNode];
    }

    return rootNodes;
  }

  // -----------------------------------------------------
  // Helper function: build a mindmap (left->right) from a bullet node
  async function buildMindmapFromBullets(rootNode, originalTextEl) {
    // Store the source text element's position and dimensions
    const sourceTextX = originalTextEl.x;
    const sourceTextY = originalTextEl.y;
    const sourceTextWidth = originalTextEl.width;
    const sourceTextHeight = originalTextEl.height;

    // Get spacing values from settings
    const xSpacing = parseFloat(settings['Horizontal spacing'].value);
    const ySpacing = parseFloat(settings['Vertical spacing'].value);

    // Calculate total height based on leaf nodes
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
        for (let child of node.children) {
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

    function createTextElement(x, y, text) {
      return ea.addText(x, y, text, textOptions);
    }

    const arrowOptions = {
      startArrowHead:
        settings['Starting arrowhead'].value === 'none'
          ? null
          : settings['Starting arrowhead'].value,
      endArrowHead:
        settings['Ending arrowhead'].value === 'none'
          ? null
          : settings['Ending arrowhead'].value,
      numberOfPoints: Math.floor(settings['Line points'].value),
      strokeColor: ea.style.strokeColor,
      strokeWidth: ea.style.strokeWidth,
      strokeStyle: ea.style.strokeStyle,
      roughness: 2,
    };

    // Create temporary elements for measurement
    function createTemporaryElements(node) {
      const elementId = ea.addText(node.x, node.y, node.label, textOptions);
      node.element = ea.getElement(elementId);
      if (node.children) {
        for (const child of node.children) createTemporaryElements(child);
      }
    }

    createTemporaryElements(rootNode);

    // Adjust child x positions based on actual widths
    function adjustPositions(node) {
      if (!node.children || node.children.length === 0) return;

      const parentRightEdge = node.x + node.element.width;

      for (let child of node.children) {
        child.element.x = parentRightEdge + xSpacing;
        child.x = child.element.x;
        adjustPositions(child);
      }
    }

    adjustPositions(rootNode);

    // Collect positions + old ids
    const nodePositions = [];
    function collectNodePositions(node) {
      nodePositions.push({
        id: node.element.id,
        x: node.x,
        y: node.y,
        text: node.label,
        node,
      });
      if (node.children) {
        for (const child of node.children) collectNodePositions(child);
      }
    }
    collectNodePositions(rootNode);
    const oldElementIds = nodePositions.map(item => item.id);

    // Clear references and create final elements
    function clearElementReferences(node) {
      node.element = null;
      if (node.children)
        for (const child of node.children) clearElementReferences(child);
    }
    clearElementReferences(rootNode);

    for (const item of nodePositions) {
      const elementId = createTextElement(item.x, item.y, item.text);
      const element = ea.getElement(elementId);
      item.node.element = element;
    }

    // Connect
    function connectWithArrows(node) {
      if (!node.children || node.children.length === 0) return;
      for (const child of node.children) {
        if (node.element && child.element) {
          addBoundArrowBetween(node.element, child.element, arrowOptions);
        }
        connectWithArrows(child);
      }
    }
    connectWithArrows(rootNode);

    // Delete temporary elements
    try {
      for (const elementId of oldElementIds) {
        const element = ea.getElement(elementId);
        if (element) element.isDeleted = true;
      }
    } catch (e) {
      console.log('Error deleting elements:', e);
    }

    // Remove the original text block (best-effort: keep your original call, but safe fallback)
    try {
      ea.copyViewElementsToEAforEditing([]);
      ea.deleteViewElements([originalTextEl.id]);
    } catch (_e) {
      // fallback (mark deleted)
      try {
        const live = ea.getElement(originalTextEl.id) || originalTextEl;
        if (live) {
          ea.copyViewElementsToEAforEditing([live]);
          live.isDeleted = true;
        }
      } catch (__e) {
        // ignore
      }
    }

    await ea.addElementsToView(false, false, true);
    new Notice('Created mindmap from bulleted text!');
  }

  // The user wants to convert a bulleted text block to a mindmap
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

  const rootNode = rootNodes[0];

  // Fix #1: ensure we await the async build
  await buildMindmapFromBullets(rootNode, textElement);

  return; // end script
}

// -----------------------------------------------------
// If only one element is selected, and it is connected, perform grouping action
// BUT: if CTRL/CMD is held, offer Insert Child/Sibling menu instead.
// -----------------------------------------------------
if (selectedElements.length === 1 && selectedElements[0].type === 'text') {
  snapshot = snapshotCanvas();
  const rootElement = selectedElements[0];

  // Only show add child/sibling when Ctrl/Cmd is held
  if (isCtrlOrCmdPressed()) {
    const res = await insertChildOrSiblingFlow(rootElement, snapshot);
    if (res && res.didInsert) return; // insertion (or canceled) handled
    if (res && res.forceOutline) {
      // fall through to default outline behavior
    } else {
      // If user canceled chooser, do nothing
      return;
    }
  }

  function getChildElements(element, snap, visited) {
    visited = visited || new Set();
    let children = [];

    if (visited.has(element.id)) return children;
    visited.add(element.id);

    const outgoing = snap.outgoingArrows.get(element.id) || [];
    for (let arrow of outgoing) {
      const endId = arrow.endBinding?.elementId;
      const endElement = endId ? snap.byId.get(endId) : null;

      if (endElement && endElement.x > element.x) {
        children.push(endElement);
        children.push(arrow);

        const grandChildren = getChildElements(endElement, snap, visited);
        children = children.concat(grandChildren);
      }
    }

    return children;
  }

  function buildOutline(element, snap, visited = new Set(), depth = 0) {
    if (visited.has(element.id)) return '';
    visited.add(element.id);

    let label = element.text?.trim() ?? `Element ${element.id}`;
    label = label.replace(/\r?\n/g, ' ');

    let indent = '\t'.repeat(depth);
    const useDash = settings['Add dash bullet'].value;
    let bulletPrefix = useDash ? '- ' : '';

    let outline = `${indent}${bulletPrefix}${label}\n`;

    const outgoing = snap.outgoingArrows.get(element.id) || [];
    let childShapes = [];

    for (let arrow of outgoing) {
      const childId = arrow.endBinding?.elementId;
      const childEl = childId ? snap.byId.get(childId) : null;
      if (childEl && childEl.x > element.x) childShapes.push(childEl);
    }

    childShapes.sort((a, b) => a.y - b.y);

    for (let childEl of childShapes) {
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
      color = ea.getExcalidrawAPI().getAppState().currentItemStrokeColor;
      ea.style.strokeColor = color;
      ea.style.roundness = { type: 2, value: padding };
      id = ea.addRect(
        box.topX - padding,
        box.topY - padding,
        box.width + 2 * padding,
        box.height + 2 * padding
      );
      try {
        if (typeof ea.sendToBack === 'function') {
          ea.sendToBack([id]);
        } else {
          const api = ea.getExcalidrawAPI?.();
          if (api && typeof api.sendToBack === 'function') {
            api.sendToBack([id]);
          }
        }
      } catch (_e) {
        // ignore
      }

      ea.copyViewElementsToEAforEditing(elementsToGroup);
      ea.addToGroup([id].concat(elementIdsToGroup));
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
  } catch (err) {
    console.error('Clipboard error:', err);
    new Notice('Error copying bullet text to clipboard!');
  }

  return;
}

// -----------------------------------------------------
// If more than one element is selected, perform the connection action
// -----------------------------------------------------

// Refresh snapshot for multi-select mode
snapshot = snapshotCanvas();

// Filter out arrows and lines from selection
const nonArrowElements = selectedElements.filter(
  el => el.type !== 'arrow' && el.type !== 'line'
);
const onlyNonArrowsSelected =
  nonArrowElements.length === selectedElements.length;

let userAction = 'connect';

if (!onlyNonArrowsSelected) {
  userAction = await utils.suggester(
    ['Connect elements', 'Delete arrows'],
    ['connect', 'delete'],
    'What do you want to do with the selected elements?'
  );

  if (userAction === null) return;
}

const arrowStart =
  settings['Starting arrowhead'].value === 'none'
    ? null
    : settings['Starting arrowhead'].value;
const arrowEnd =
  settings['Ending arrowhead'].value === 'none'
    ? null
    : settings['Ending arrowhead'].value;
const linePoints = Math.floor(settings['Line points'].value);

const arrowOptions = {
  startArrowHead: arrowStart,
  endArrowHead: arrowEnd,
  numberOfPoints: linePoints,
  strokeColor: '#000000',
  strokeWidth: 1,
  strokeStyle: 'solid',
  roughness: 0,
};

if (userAction === 'connect') {
  selectedElements = selectedElements.filter(
    el => el.type !== 'arrow' && el.type !== 'line'
  );

  const selectedTexts = selectedElements.filter(el => el.type === 'text');
  const elementsForConnect =
    selectedTexts.length > 0 ? selectedTexts : selectedElements;

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

  function findSelectedContainingPoint(px, py, els) {
    for (const t of els) {
      if (pointInsideRect(px, py, t)) return t;
    }
    return null;
  }

  async function deleteArrowsBetweenSelectedElements(selectedEls, snap) {
    if (!selectedEls || selectedEls.length === 0) return;

    const selectedIds = new Set(selectedEls.map(e => e.id));
    const arrows = snap.arrows;

    const toDelete = [];

    for (const a of arrows) {
      const sId = a.startBinding?.elementId || null;
      const eId = a.endBinding?.elementId || null;

      // If bound to non-selected elements, skip
      if (sId && !selectedIds.has(sId)) continue;
      if (eId && !selectedIds.has(eId)) continue;

      let sEl = null,
        eEl = null;

      if (sId && selectedIds.has(sId)) {
        sEl = snap.byId.get(sId) || null;
      } else if (!sId) {
        const [sx, sy] = getArrowEndpointAbs(a, true);
        sEl = findSelectedContainingPoint(sx, sy, selectedEls);
      }

      if (eId && selectedIds.has(eId)) {
        eEl = snap.byId.get(eId) || null;
      } else if (!eId) {
        const [ex, ey] = getArrowEndpointAbs(a, false);
        eEl = findSelectedContainingPoint(ex, ey, selectedEls);
      }

      if (sEl && eEl) toDelete.push(a);
    }

    if (toDelete.length === 0) return;

    ea.copyViewElementsToEAforEditing(toDelete);
    for (const a of toDelete) {
      const live = ea.getElement(a.id) || a;
      if (live) live.isDeleted = true;
    }
    await ea.addElementsToView(false, false, true);
  }

  // Delete arrows first, then refresh snapshot (Fix #2: keep adjacency accurate)
  await deleteArrowsBetweenSelectedElements(elementsForConnect, snapshot);
  snapshot = snapshotCanvas();

  ea.copyViewElementsToEAforEditing(elementsForConnect);

  ea.style.strokeColor = elementsForConnect[0].strokeColor;
  ea.style.strokeWidth = elementsForConnect[0].strokeWidth;
  ea.style.strokeStyle = elementsForConnect[0].strokeStyle;
  ea.style.strokeSharpness = elementsForConnect[0].strokeSharpness;

  arrowOptions.strokeColor = ea.style.strokeColor;
  arrowOptions.strokeWidth = ea.style.strokeWidth;
  arrowOptions.strokeStyle = ea.style.strokeStyle;

  class Node {
    constructor(element) {
      this.element = element;
      this.parent = null;
      this.children = [];
    }
  }

  let nodes = elementsForConnect.map(el => new Node(el));
  nodes.sort((a, b) => a.element.x - b.element.x);

  const rootNode = nodes[0];

  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    const el = node.element;
    const elLeftX = el.x;

    let potentialParents = [];
    for (let j = 0; j < i; j++) {
      const p = nodes[j];
      const parentRightX = p.element.x + p.element.width;
      if (parentRightX < elLeftX) potentialParents.push(p);
    }

    const columnAdjacentNodes = potentialParents.filter(parentNode => {
      const parentRightX = parentNode.element.x + parentNode.element.width;
      return !potentialParents.some(otherNode => {
        if (otherNode === parentNode) return false;
        const otherLeftX = otherNode.element.x;
        const otherRightX = otherNode.element.x + otherNode.element.width;
        return otherLeftX > parentRightX && otherRightX < elLeftX;
      });
    });

    if (columnAdjacentNodes.length > 0) {
      let closestParent = null;
      let minYGap = Infinity;

      for (let potentialParent of columnAdjacentNodes) {
        const parentEl = potentialParent.element;
        const parentCenterY = parentEl.y + parentEl.height / 2;
        const elementCenterY = el.y + el.height / 2;
        const yGap = Math.abs(elementCenterY - parentCenterY);

        if (yGap < minYGap) {
          minYGap = yGap;
          closestParent = potentialParent;
        }
      }

      if (closestParent) {
        node.parent = closestParent;
        closestParent.children.push(node);
      }
    } else {
      if (node !== rootNode) {
        node.parent = rootNode;
        rootNode.children.push(node);
      }
    }
  }

  // Fast connection existence check using snapshot (Fix #2)
  function areElementsConnected(sourceId, targetId, snap) {
    return snap.boundArrowPairs.has(`${sourceId}->${targetId}`);
  }

  function createArrows(node, snap) {
    for (let child of node.children) {
      const sourceEl = node.element;
      const targetEl = child.element;

      if (!areElementsConnected(sourceEl.id, targetEl.id, snap)) {
        addBoundArrowBetween(sourceEl, targetEl, arrowOptions);
        snap.boundArrowPairs.add(`${sourceEl.id}->${targetEl.id}`);
      }

      if (child.children.length > 0) createArrows(child, snap);
    }
  }

  createArrows(rootNode, snapshot);

  await ea.addElementsToView(false, false, true);
  new Notice('Connected elements with arrows.');
} else if (userAction === 'delete') {
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
}

/**
 * Create a new arrow and force physical binding to source/target
 */
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

  // Some builds return the id, some return void; keep best-effort logic.
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

  // Best-effort centering: set binding focus to edge center if available.
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
}

function pickArrowStyleFor(sourceEl, snap) {
  const candidates = []
    .concat(snap.outgoingArrows.get(sourceEl.id) || [])
    .concat(snap.incomingArrows.get(sourceEl.id) || []);

  // Prefer a real bound arrow that already exists
  const hit = candidates.find(a => a.type === 'arrow' && !a.isDeleted);
  if (hit) return hit;

  // Fallback: any arrow on the canvas
  return (snap.arrows || []).find(a => !a.isDeleted) || null;
}

function makeArrowOptionsFromSource(sourceEl, snap) {
  const a = pickArrowStyleFor(sourceEl, snap);
  const app = ea.getExcalidrawAPI().getAppState();

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

    // IMPORTANT: inherit these from an existing arrow, not a text node
    strokeColor: a?.strokeColor ?? app.currentItemStrokeColor ?? '#000000',
    strokeWidth: a?.strokeWidth ?? app.currentItemStrokeWidth ?? 1,
    strokeStyle: a?.strokeStyle ?? app.currentItemStrokeStyle ?? 'solid',
    strokeSharpness:
      a?.strokeSharpness ?? app.currentItemStrokeSharpness ?? 'sharp',
    roughness: a?.roughness ?? app.currentItemRoughness ?? 0,
  };
}
