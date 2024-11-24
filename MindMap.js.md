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
      value: "none",
      valueset: ["none", "arrow", "triangle", "bar", "dot"]
    },
    "Line points": {
      value: 0,
      description: "Number of line points between start and end"
    },
    "Threshold": {
      value: 50,
      description: "Distance threshold for grouping elements into columns"
    }
  };
  ea.setScriptSettings(settings);
}

const arrowStart = settings["Starting arrowhead"].value === "none" ? null : settings["Starting arrowhead"].value;
const arrowEnd = settings["Ending arrowhead"].value === "none" ? null : settings["Ending arrowhead"].value;
const linePoints = Math.floor(settings["Line points"].value);
const threshold = parseFloat(settings["Threshold"].value);

// Get selected elements, excluding arrows and lines
let selectedElements = ea.getViewSelectedElements().filter(el => el.type !== 'arrow' && el.type !== 'line');

// Check if any elements are selected
if (selectedElements.length === 0) {
  new Notice("No objects selected. Please select at least one object to connect.");
  return;
}

// Copy selected elements to EA for editing
ea.copyViewElementsToEAforEditing(selectedElements);

// Get groups from selected elements
const groups = ea.getMaximumGroups(selectedElements);

let els = []; // Store largest elements from groups

// Extract the largest element from each group
for (let i = 0, len = groups.length; i < len; i++) {
  const largestElement = ea.getLargestElement(groups[i]);
  els.push(largestElement);
}

// Check if there are valid elements to connect
if (els.length === 0) {
  new Notice("No valid objects found to connect.");
  return;
}

// Apply line style from the first element
ea.style.strokeColor = els[0].strokeColor;
ea.style.strokeWidth = els[0].strokeWidth;
ea.style.strokeStyle = els[0].strokeStyle;
ea.style.strokeSharpness = els[0].strokeSharpness;

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

// Group elements into columns based on their x positions
function groupElementsByColumn(elements, threshold) {
  // Sort elements by x position
  elements.sort((a, b) => a.x - b.x);

  let columns = [];
  let currentColumn = [];
  let lastX = null;

  for (let el of elements) {
    if (lastX === null || Math.abs(el.x - lastX) <= threshold) {
      currentColumn.push(el);
    } else {
      columns.push(currentColumn);
      currentColumn = [el];
    }
    lastX = el.x;
  }
  if (currentColumn.length > 0) {
    columns.push(currentColumn);
  }
  return columns;
}

const columns = groupElementsByColumn(els, threshold);

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

// Now connect each element in current column to the closest element in previous column
for (let i = columns.length - 1; i > 0; i--) {
  const currentColumn = columns[i];
  const previousColumn = columns[i - 1];

  for (let targetEl of currentColumn) {
    // Find the closest element in previousColumn to targetEl
    let closestSourceEl = null;
    let minDistance = Infinity;

    for (let sourceEl of previousColumn) {
      const distance = Math.abs(sourceEl.y - targetEl.y);
      // console.log("distance", targetEl.text, sourceEl.text, distance);

      if (distance < minDistance) {
        minDistance = distance;
        closestSourceEl = sourceEl;
      }
    }

    if (closestSourceEl) {
      // Check if the elements are already connected
      if (areElementsConnected(targetEl.id, closestSourceEl.id)) {
        // Elements are already connected; skip adding a new arrow
        continue;
      }

      // Calculate centers
      const targetCenterX = targetEl.x + targetEl.width / 2;
      const targetCenterY = targetEl.y + targetEl.height / 2;

      const sourceCenterX = closestSourceEl.x + closestSourceEl.width / 2;
      const sourceCenterY = closestSourceEl.y + closestSourceEl.height / 2;

      // Get edge points
      const [startX, startY] = getEdgePoint(targetEl, sourceCenterX, sourceCenterY);
      const [endX, endY] = getEdgePoint(closestSourceEl, targetCenterX, targetCenterY);

      // Create the arrow with startObjectId and endObjectId
      const arrowId = ea.addArrow([[startX, startY], [endX, endY]], {
        ...arrowOptions,
        startObjectId: targetEl.id,
        endObjectId: closestSourceEl.id,
      });
    }
  }
}

// Finalize by adding elements to view
await ea.addElementsToView(false, false, true);
