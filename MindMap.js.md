/*
```javascript
*/
if (!ea.verifyMinimumPluginVersion || !ea.verifyMinimumPluginVersion("1.5.21")) {
  new Notice("This script requires a newer version of Excalidraw. Please install the latest version.");
  return;
}

settings = ea.getScriptSettings();
// Set default values on first run
if (!settings["Starting arrowhead"]) {
  settings = {
    "Starting arrowhead": {
      value: "none",
      valueset: ["none", "arrow", "triangle", "bar", "dot"]
    },
    "Ending arrowhead": {
      value: "arrow",
      valueset: ["none", "arrow", "triangle", "bar", "dot"]
    },
    "Line points": {
      value: 0,
      description: "Number of line points between start and end"
    }
  };
  ea.setScriptSettings(settings);
}

const arrowStart = settings["Starting arrowhead"].value === "none" ? null : settings["Starting arrowhead"].value;
const arrowEnd = settings["Ending arrowhead"].value === "none" ? null : settings["Ending arrowhead"].value;
const linePoints = Math.floor(settings["Line points"].value);

// Get selected elements, excluding arrows and lines
let selectedElements = ea.getViewSelectedElements().filter(el => el.type !== 'arrow' && el.type !== 'line');

// Check if any elements are selected
if (selectedElements.length === 0) {
  new Notice("No objects selected. Please select at least one object to connect.");
  return;
}

// Copy selected elements to EA for editing
ea.copyViewElementsToEAforEditing(selectedElements);

// Apply line style from the first element
ea.style.strokeColor = selectedElements[0].strokeColor;
ea.style.strokeWidth = selectedElements[0].strokeWidth;
ea.style.strokeStyle = selectedElements[0].strokeStyle;
ea.style.strokeSharpness = selectedElements[0].strokeSharpness;

// Set arrow options based on settings
const arrowOptions = {
  startArrowHead: arrowStart,
  endArrowHead: arrowEnd,
  numberOfPoints: linePoints,
  strokeColor: ea.style.strokeColor,
  strokeWidth: ea.style.strokeWidth,
  strokeStyle: ea.style.strokeStyle,
  roughness: 0, // Adjust as needed
};

// Class to represent a node in the tree
class Node {
  constructor(element) {
    this.element = element;
    this.parent = null;
    this.children = [];
  }
}

// Create nodes from all selected elements
let nodes = selectedElements.map(el => new Node(el));

// Sort nodes by their leftmost x position
nodes.sort((a, b) => a.element.x - b.element.x);

// Identify the root node (leftmost node)
const rootNode = nodes[0];

// Build the tree by assigning parents
for (let i = 1; i < nodes.length; i++) {
  const node = nodes[i];
  const el = node.element;
  const elLeftX = el.x;
  const elRightX = el.x + el.width;

  // Find potential parents among nodes to the left with no x-overlap
  let potentialParents = [];
  for (let j = 0; j < i; j++) {
    const potentialParentNode = nodes[j];
    const parentEl = potentialParentNode.element;
    const parentRightX = parentEl.x + parentEl.width;

    // Check if parent's rightmost x is less than child's leftmost x (no x-overlap)
    if (parentRightX < elLeftX) {
      potentialParents.push(potentialParentNode);
    }
  }

  // If there are potential parents, select the one with the closest rightmost x to the child's leftmost x
  if (potentialParents.length > 0) {
    let closestParent = null;
    let minXGap = Infinity;

    for (let potentialParent of potentialParents) {
      const parentEl = potentialParent.element;
      const parentRightX = parentEl.x + parentEl.width;
      const xGap = elLeftX - parentRightX;

      if (xGap < minXGap) {
        minXGap = xGap;
        closestParent = potentialParent;
      }
    }

    // Assign parent and add child to parent's children
    if (closestParent) {
      node.parent = closestParent;
      closestParent.children.push(node);
    }
  } else {
    // If no potential parents, assign root node as parent (to ensure a single tree)
    if (node !== rootNode) {
      node.parent = rootNode;
      rootNode.children.push(node);
    }
  }
  // console.log(el.text, 'parent:', node.parent.element.text);
}

// Function to get the point on the edge of an element closest to a given point (updated)
function getEdgePoint(element, targetX, targetY) {
  const x = element.x;
  const y = element.y;
  const w = element.width;
  const h = element.height;

  const centerX = x + w / 2;
  const centerY = y + h / 2;

  const dx = targetX - centerX;
  const dy = targetY - centerY;

  const m = dy / dx;

  let edgeX, edgeY;

  if (Math.abs(dx) > Math.abs(dy)) {
    // Intersection with left or right edge
    if (dx > 0) {
      edgeX = x + w;
      edgeY = centerY + (w / 2) * m;
    } else {
      edgeX = x;
      edgeY = centerY - (w / 2) * m;
    }
  } else {
    // Intersection with top or bottom edge
    if (dy > 0) {
      edgeY = y + h;
      edgeX = centerX + (h / 2) / m;
    } else {
      edgeY = y;
      edgeX = centerX - (h / 2) / m;
    }
  }

  // Clamp edgeX and edgeY to element boundaries
  edgeX = Math.max(x, Math.min(x + w, edgeX));
  edgeY = Math.max(y, Math.min(y + h, edgeY));

  return [edgeX, edgeY];
}

// Function to check if two elements are already connected
function areElementsConnected(sourceId, targetId) {
  const allElements = ea.getViewElements();
  for (let el of allElements) {
    if (el.type === 'arrow') {
      const startId = el.startBinding ? el.startBinding.elementId : null;
      const endId = el.endBinding ? el.endBinding.elementId : null;
      if (startId === sourceId && endId === targetId) {
        return true;
      }
    }
  }
  return false;
}

// Function to create arrows recursively
function createArrows(node) {
  for (let child of node.children) {
    const sourceEl = node.element; // Parent element
    const targetEl = child.element; // Child element

    // Calculate centers
    const sourceCenterX = sourceEl.x + sourceEl.width / 2;
    const sourceCenterY = sourceEl.y + sourceEl.height / 2;

    const targetCenterX = targetEl.x + targetEl.width / 2;
    const targetCenterY = targetEl.y + targetEl.height / 2;

    // Get edge points
    const [startX, startY] = getEdgePoint(sourceEl, targetCenterX, targetCenterY);
    const [endX, endY] = getEdgePoint(targetEl, sourceCenterX, sourceCenterY);

    // Check if the elements are already connected
    if (!areElementsConnected(sourceEl.id, targetEl.id)) {
      // Create the arrow with startObjectId and endObjectId
      ea.addArrow([[startX, startY], [endX, endY]], {
        ...arrowOptions,
        startObjectId: sourceEl.id,
        endObjectId: targetEl.id,
      });
    }

    // Recursively create arrows for the child's children
    if (child.children.length > 0) {
      createArrows(child);
    }
  }
}

// Start creating arrows from the root node
createArrows(rootNode);

// Finalize by adding elements to view
await ea.addElementsToView(false, false, true);