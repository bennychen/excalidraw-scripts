/*
```javascript
*/
if (!ea.verifyMinimumPluginVersion || !ea.verifyMinimumPluginVersion("1.5.21")) {
  new Notice("This script requires version 1.5.21 or newer of the Excalidraw plugin. Please install the latest version.");
  return;
}

// Get the selected elements
const selectedElements = ea.getViewSelectedElements();

// Check if a single text element is selected
if (selectedElements.length !== 1 || selectedElements[0].type !== 'text') {
  new Notice('Please select a single text element containing the bulleted list.');
  return;
}

const textElement = selectedElements[0];
const bulletedText = textElement.text;

// Optional: Remove the text element after extracting the text
// ea.deleteViewElements([textElement.id]);

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

// Parse the bulleted text
const lines = bulletedText.split('\n');
const nodes = [];
const parents = [];
const spacesPerIndent = 2; // Adjust based on your indentation
const rootLevelIndent = null;

for (const line of lines) {
  const match = line.match(/^(\s*)[-*+]\s+(.*)$/);
  if (match) {
    const indent = match[1]; // Leading whitespace
    const text = match[2]; // The text after '- ', '* ', or '+ '
    const indentLength = indent.replace(/\t/g, '    ').length; // Replace tabs with spaces

    // Determine the level based on indentation
    const level = indentLength / spacesPerIndent;

    const node = {
      text: text,
      level: level,
      parent: null,
      element: null,
      x: 0,
      y: 0
    };

    if (level > 0 && parents[level - 1]) {
      node.parent = parents[level - 1];
    }

    nodes.push(node);
    parents[level] = node;
    // Remove deeper levels
    parents.length = level + 1;
    console.log("find text", text);
  } else if (line.trim() === '') {
    // Ignore empty lines
    continue;
  } else {
    new Notice('Invalid line format: ' + line);
    return;
  }
}

// Set positioning constants
const xOffsetPerLevel = 200; // Horizontal distance per level
const ySpacing = 100;        // Vertical spacing between elements

// Keep track of the next y position for each level
const levelPositions = [];

// Apply style from the first node
ea.style.strokeColor = "#000000"; // Default to black
ea.style.strokeWidth = 1;
ea.style.strokeStyle = "solid";
ea.style.strokeSharpness = "sharp";

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

// Create elements and position them
for (const node of nodes) {
  const level = node.level;
  const x = level * xOffsetPerLevel;
  let y = levelPositions[level] || 0;

  if (node.parent) {
    const parentY = node.parent.y;
    y = Math.max(y, parentY + ySpacing);
  }

  // Create the text element
  const elementId = ea.addText(x, y, node.text);
  const element = ea.getElement(elementId);

  node.element = element;
  node.x = x;
  node.y = y;

  // Update the y position for the level
  levelPositions[level] = y + ySpacing;
}

// Connect elements with arrows
for (const node of nodes) {
  if (node.parent) {
    const sourceEl = node.parent.element;
    const targetEl = node.element;

    const sourceCenterX = sourceEl.x + sourceEl.width / 2;
    const sourceCenterY = sourceEl.y + sourceEl.height / 2;

    const targetCenterX = targetEl.x + targetEl.width / 2;
    const targetCenterY = targetEl.y + targetEl.height / 2;

    // Get edge points
    const [startX, startY] = getEdgePoint(sourceEl, targetCenterX, targetCenterY);
    const [endX, endY] = getEdgePoint(targetEl, sourceCenterX, sourceCenterY);

    // Create the arrow with startObjectId and endObjectId
    const arrowId = ea.addArrow([[startX, startY], [endX, endY]], {
      ...arrowOptions,
      startObjectId: sourceEl.id,
      endObjectId: targetEl.id,
    });
  }
}

// Optional: Remove the original text element
// ea.deleteViewElements([textElement.id]);

// Finalize by adding elements to view
await ea.addElementsToView(false, false, true);