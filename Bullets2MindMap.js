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

// Store the source text element's position and dimensions for later use
const sourceTextX = textElement.x;
const sourceTextY = textElement.y;
const sourceTextWidth = textElement.width;
const sourceTextHeight = textElement.height;

// Optional: Remove the text element after extracting the text
// ea.deleteViewElements([textElement.id]);

settings = ea.getScriptSettings();

// Check if settings is null and initialize if necessary
if (!settings) {
  settings = {};
}

// Set default values if missing
if (!settings["Starting arrowhead"]) {
  settings["Starting arrowhead"] = {
    value: "none",
    valueset: ["none", "arrow", "triangle", "bar", "dot"]
  };
}

if (!settings["Ending arrowhead"]) {
  settings["Ending arrowhead"] = {
    value: "none",
    valueset: ["none", "arrow", "triangle", "bar", "dot"]
  };
}

if (!settings["Line points"]) {
  settings["Line points"] = {
    value: 0,
    description: "Number of line points between start and end"
  };
}

if (!settings["Horizontal spacing"]) {
  settings["Horizontal spacing"] = {
    value: 200,
    description: "Horizontal distance between levels (from parent's right to child's left)"
  };
}

if (!settings["Vertical spacing"]) {
  settings["Vertical spacing"] = {
    value: 100,
    description: "Vertical spacing between sibling nodes"
  };
}

ea.setScriptSettings(settings);

const arrowStart = settings["Starting arrowhead"].value === "none" ? null : settings["Starting arrowhead"].value;
const arrowEnd = settings["Ending arrowhead"].value === "none" ? null : settings["Ending arrowhead"].value;
const linePoints = Math.floor(settings["Line points"].value);

const xSpacing = parseFloat(settings["Horizontal spacing"].value); // Horizontal distance between levels
const ySpacing = parseFloat(settings["Vertical spacing"].value);   // Vertical spacing between sibling nodes

// Parse the bulleted text
const lines = bulletedText.split('\n');
// A list of known indentations, from smallest to largest, where index = nesting level.
// We start with 0 so any line with zero indentation is considered level 0 (root).
let indentationLevels = [0];

function getIndentLevel(line) {
  // 1. Extract leading whitespace (tabs or spaces)
  const match = line.match(/^(\s*)([-*+]?)(.*)$/);
  if (!match) {
    return null;
  }
  let leading = match[1] ?? "";   // Leading whitespace
  let bullet  = match[2] ?? "";  // The bullet char if present
  let content = match[3] ?? "";  // The rest of the text

  // 2. Convert tabs to e.g. 4 spaces (or 2, or whatever you like)
  leading = leading.replace(/\t/g, "    ");
  const indentLength = leading.length;

  // 3. Figure out if indentLength is in indentationLevels.
  //    If not, insert it in ascending order.
  let level = 0;
  let inserted = false;

  for (let i = 0; i < indentationLevels.length; i++) {
    const knownIndent = indentationLevels[i];
    // If we find an exact match, we use that
    if (knownIndent === indentLength) {
      level = i;
      inserted = true;
      break;
    }
    // If this indent is between two known values, insert it as a new level
    if (knownIndent > indentLength) {
      indentationLevels.splice(i, 0, indentLength);
      level = i; // The new level is now i
      inserted = true;
      break;
    }
  }

  // If it's bigger than all knownIndent, we push it to the end
  if (!inserted) {
    indentationLevels.push(indentLength);
    level = indentationLevels.length - 1;
  }

  return { level, bullet, content: content.trim() };
}

const nodes = [];
const parents = [];

for (const line of lines) {
  if (!line.trim()) continue; // skip empty

  // get indent info
  const info = getIndentLevel(line);
  if (!info) {
    new Notice("Invalid line: " + line);
    continue;
  }

  // destructure info
  const { level, content } = info;
  const node = {
    text: content,
    level,
    parent: null,
    children: [],
  };

  // If level > 0, attach to the parent's children
  if (level > 0 && parents[level - 1]) {
    node.parent = parents[level - 1];
    parents[level - 1].children.push(node);
  }

  // Keep track of parents at each level
  parents[level] = node;

  // Remove deeper-level parents if we just stepped back in indentation
  parents.length = level + 1;

  nodes.push(node);
}

// Identify root nodes
const rootNodes = nodes.filter(node => !node.parent);

// If there are multiple root nodes, create a default "Root" node and make all roots its children
if (rootNodes.length > 1) {
  // Create a new root node
  const defaultRootNode = {
    text: "Root",
    level: 0,
    parent: null,
    children: [],
    x: 0,
    y: 0
  };
  
  // Make all original root nodes children of the new root
  for (const originalRoot of rootNodes) {
    originalRoot.parent = defaultRootNode;
    defaultRootNode.children.push(originalRoot);
    originalRoot.level = 1; // Update level since it's now a child
  }
  
  // Add the new root node to the nodes array
  nodes.push(defaultRootNode);
  
  // Update rootNodes to contain only the new default root
  rootNodes.splice(0, rootNodes.length, defaultRootNode);
}

// Calculate the total height needed for the mindmap
// First, count the number of leaf nodes (nodes without children)
const leafNodeCount = nodes.filter(node => !node.children || node.children.length === 0).length;
// Calculate estimated total height based on leaf nodes and spacing
const estimatedTotalHeight = (leafNodeCount - 1) * ySpacing;

// Calculate source text vertical center
const sourceTextCenter = sourceTextY + sourceTextHeight / 2;

// Initialize nextY to start from a position that will center the mindmap
let nextY = sourceTextCenter - (estimatedTotalHeight / 2);

// Function to assign positions
function assignPositions(node, level, x) {
  node.x = x;

  if (!node.children || node.children.length === 0) {
    // Leaf node
    node.y = nextY;
    nextY += ySpacing;
  } else {
    // Internal node
    // Process children first
    for (let child of node.children) {
      assignPositions(child, level + 1, x + xSpacing);
    }
    // After processing children, set y position as average of children's y positions
    const firstChildY = node.children[0].y;
    const lastChildY = node.children[node.children.length - 1].y;
    node.y = (firstChildY + lastChildY) / 2;
  }
}

// Starting x position for root nodes - position right after the source text element
const rootX = sourceTextX + sourceTextWidth + 20; // 20px gap between source and mindmap

// Assign positions to all root nodes
for (const root of rootNodes) {
  assignPositions(root, 0, rootX);
}

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

// Now create elements
for (const node of nodes) {
  const x = node.x;
  const y = node.y;

  // Create the text element
  const elementId = ea.addText(x, y, node.text);
  const element = ea.getElement(elementId);

  node.element = element;
}

function getEdgePoint(element, targetX, targetY) {
  const x = element.x;
  const y = element.y;
  const w = element.width;
  const h = element.height;

  const centerX = x + w / 2;
  const centerY = y + h / 2;

  const dx = targetX - centerX;
  const dy = targetY - centerY;

  // If dx is 0, we can't do a slope calculation (vertical line).
  // Fallback to right edge if you prefer, or left if you prefer.
  if (dx === 0) {
    return [x + w, centerY];
  }

  // Slope from center to target
  const slope = dy / dx;

  let edgeX, edgeY;

  // If the target is to the right, use the right edge
  if (dx > 0) {
    edgeX = x + w;
    // Horizontal distance from center to right edge is w/2
    edgeY = centerY + slope * (w / 2);
  } 
  // Otherwise, use the left edge
  else {
    edgeX = x;
    // Horizontal distance from center to left edge is w/2
    edgeY = centerY - slope * (w / 2);
  }

  // Make sure we stay within the top and bottom edges of the shape
  if (edgeY < y) edgeY = y;
  if (edgeY > y + h) edgeY = y + h;

  return [edgeX, edgeY];
}

// Connect elements with arrows
for (const node of nodes) {
  if (node.parent) {
    const sourceEl = node.parent.element; // Parent element
    const targetEl = node.element;        // Child element

    const sourceCenterX = sourceEl.x + sourceEl.width / 2;
    const sourceCenterY = sourceEl.y + sourceEl.height / 2;

    const targetCenterX = targetEl.x + targetEl.width / 2;
    const targetCenterY = targetEl.y + targetEl.height / 2;

    // Get edge points
    const [startX, startY] = getEdgePoint(sourceEl, targetCenterX, targetCenterY);
    const [endX, endY] = getEdgePoint(targetEl, sourceCenterX, sourceCenterY);

    // Create the arrow with startObjectId and endObjectId
    ea.addArrow([[startX, startY], [endX, endY]], {
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