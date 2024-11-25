/*
```javascript
*/
if (!ea.verifyMinimumPluginVersion || !ea.verifyMinimumPluginVersion("1.5.21")) {
  new Notice("This script requires a newer version of Excalidraw. Please install the latest version.");
  return;
}

settings = ea.getScriptSettings();

// Define default settings
const defaultSettings = {
  "Starting arrowhead": {
    value: "none",
    valueset: ["none", "arrow", "triangle", "bar", "dot"]
  },
  "Ending arrowhead": {
    value: "none",
    valueset: ["none", "arrow", "triangle", "bar", "dot"]
  },
  "Line points": {
    value: 0,
    description: "Number of line points between start and end"
  },
  "Box selected": {
    value: false,
    description: "Box selected mindmap elements"
  }
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

// Get selected elements
let selectedElements = ea.getViewSelectedElements();

// Check if any elements are selected
if (selectedElements.length === 0) {
  new Notice("No objects selected. Please select at least one object to connect or select.");
  return;
}

// If only one element is selected, perform grouping action
if (selectedElements.length === 1 && 
    selectedElements[0].type !== 'line' && selectedElements[0].type != 'arrow') {
  const rootElement = selectedElements[0];

  // Function to recursively find all child elements
  function getChildElements(element, allElements, visited) {
    visited = visited || new Set();
    let children = [];

    // Prevent cycles
    if (visited.has(element.id)) {
      return children;
    }
    visited.add(element.id);

    // Get all arrows starting from this element
    const outgoingArrows = allElements.filter(el => {
      if (el.type === 'arrow' && el.startBinding && el.startBinding.elementId === element.id) {
        // Get the end element
        const endElement = allElements.find(e => e.id === el.endBinding?.elementId);
        if (endElement && endElement.x > element.x) {
          // The child element is on the right side
          return true;
        }
      }
      return false;
    });

    for (let arrow of outgoingArrows) {
      const childElementId = arrow.endBinding.elementId;
      const childElement = allElements.find(e => e.id === childElementId);

      if (childElement) {
        children.push(childElement);
        children.push(arrow); // Include the arrow in the group

        // Recursively get children of this child
        const grandChildren = getChildElements(childElement, allElements, visited);
        children = children.concat(grandChildren);
      }
    }

    return children;
  }

  // Get all elements in the canvas
  const allElements = ea.getViewElements();

  // Get all child elements recursively
  const childElements = getChildElements(rootElement, allElements);
  if (childElements.length > 0) {
    // Include the root element in the group
    const elementsToGroup = [rootElement].concat(childElements);

    // Group the elements
    const elementIdsToGroup = elementsToGroup.map(el => el.id);
    const addBox = settings["Box selected"].value;
    if (addBox) {
      const box = ea.getBoundingBox(elementsToGroup);
      const padding = 5;
      color = ea
              .getExcalidrawAPI()
              .getAppState()
              .currentItemStrokeColor;
      ea.style.strokeColor = color;
      ea.style.roundness = { type: 2, value: padding };
      id = ea.addRect(
        box.topX - padding,
        box.topY - padding,
        box.width + 2*padding,
        box.height + 2*padding
      );
      ea.copyViewElementsToEAforEditing(elementsToGroup);
      ea.addToGroup([id].concat(elementIdsToGroup));
    }
    else {
      ea.copyViewElementsToEAforEditing(elementsToGroup);
      ea.addToGroup(elementIdsToGroup);
    }


    // Add elements to view
    await ea.addElementsToView(false, false, true);

    new Notice(`Grouped ${elementsToGroup.length} elements.`);
  } else {
    new Notice("No child elements found for the selected element.");
  }

  // End the script here since we've performed the grouping action
  return;
}

// If more than one element is selected, perform the connection action

const arrowStart = settings["Starting arrowhead"].value === "none" ? null : settings["Starting arrowhead"].value;
const arrowEnd = settings["Ending arrowhead"].value === "none" ? null : settings["Ending arrowhead"].value;
const linePoints = Math.floor(settings["Line points"].value);

// Get selected elements, excluding arrows and lines
selectedElements = selectedElements.filter(el => el.type !== 'arrow' && el.type !== 'line');

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
  const elTopY = el.y;
  const elBottomY = el.y + el.height;

  // Find potential parents among nodes to the left
  let potentialParents = [];
  for (let j = 0; j < i; j++) {
    const potentialParentNode = nodes[j];
    const parentEl = potentialParentNode.element;
    const parentRightX = parentEl.x + parentEl.width;

    if (parentRightX < elLeftX) {
      potentialParents.push(potentialParentNode);
    }
  }

  // Filter to keep only column-adjacent nodes
  const columnAdjacentNodes = potentialParents.filter(parentNode => {
    const parentRightX = parentNode.element.x + parentNode.element.width;

    // Check if any other node is between this parent and current node
    return !potentialParents.some(otherNode => {
      if (otherNode === parentNode) return false;
      const otherLeftX = otherNode.element.x;
      const otherRightX = otherNode.element.x + otherNode.element.width;
      return otherLeftX > parentRightX && otherRightX < elLeftX;
    });
  });

  // Find the parent with minimum y-gap
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

    // Assign parent and add child to parent's children
    if (closestParent) {
      node.parent = closestParent;
      closestParent.children.push(node);
    }
  } else {
    // If no column-adjacent parents, assign root node as parent
    if (node !== rootNode) {
      node.parent = rootNode;
      rootNode.children.push(node);
    }
  }
}

// Function to get the point on the edge of an element closest to a given point
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
