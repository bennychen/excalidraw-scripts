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

// Function to assign initial positions - first pass
function assignInitialPositions(node, level, x) {
  node.x = x;

  if (!node.children || node.children.length === 0) {
    // Leaf node
    node.y = nextY;
    nextY += ySpacing;
  } else {
    // Internal node
    // Process children first
    for (let child of node.children) {
      assignInitialPositions(child, level + 1, x + xSpacing);
    }
    // After processing children, set y position as average of children's y positions
    const firstChildY = node.children[0].y;
    const lastChildY = node.children[node.children.length - 1].y;
    node.y = (firstChildY + lastChildY) / 2;
  }
}

// Starting x position for root nodes - position right after the source text element
const rootX = sourceTextX + sourceTextWidth + 20; // 20px gap between source and mindmap

// Assign initial positions to all root nodes
for (const root of rootNodes) {
  assignInitialPositions(root, 0, rootX);
}

// Apply style from the first node
ea.style.strokeColor = "#000000"; // Default to black
ea.style.strokeWidth = 1;
ea.style.strokeStyle = "solid";
ea.style.strokeSharpness = "sharp";
ea.style.roughness = 2; // Add roughness for hand-drawn appearance

// Try numeric constants for font family (0, 1, 2, 3 etc.)
ea.style.fontFamily = 1; // Try a different numeric constant for font family

// Set font size
ea.style.fontSize = 20; // Set a larger font size for better readability

// Create a function for creating text elements with consistent settings
function createTextElement(x, y, text) {
  // Try setting all potential font properties in the global style
  ea.style.fontFamily = 1;       // Try numeric value 2
  ea.style.font = "Excalidraw";      // Try string name
  ea.style.fontStyle = "normal";
  ea.style.fontSize = 20;
  ea.style.textAlign = "center";
  ea.style.roughness = 2;
  
  // Add a text element with detailed options - try all possible combinations
  return ea.addText(x, y, text, {
    fontFamily: 1,             // Try numeric value 2
    font: "Excalidraw",            // Try explicit font name
    fontSize: 20,
    textAlign: "center",
    roughness: 2,
    strokeWidth: 1,
    strokeStyle: "solid",
    strokeSharpness: "sharp",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeColor: "#000000",
    opacity: 100,
    handDrawn: true,
    fontSource: "Excalidraw",
    isHandDrawn: true
  });
}

// Set arrow options based on settings
const arrowOptions = {
  startArrowHead: arrowStart,
  endArrowHead: arrowEnd,
  numberOfPoints: linePoints,
  strokeColor: ea.style.strokeColor,
  strokeWidth: ea.style.strokeWidth,
  strokeStyle: ea.style.strokeStyle,
  roughness: 2, // Add roughness for hand-drawn appearance
};

// Create initial elements so we can calculate positions
for (const node of nodes) {
  const x = node.x;
  const y = node.y;
  
  // Create a temporary element - we'll replace these later
  const elementId = ea.addText(x, y, node.text);
  const element = ea.getElement(elementId);
  
  node.element = element;
}

// Function to adjust positions based on actual element widths - second pass
function adjustPositions(node, level) {
  if (!node.children || node.children.length === 0) {
    return; // No adjustments needed for leaf nodes
  }
  
  // Calculate the parent's right edge
  const parentRightEdge = node.x + node.element.width;
  
  // Adjust positions of children
  for (let child of node.children) {
    // Move the child to be xSpacing distance from parent's right edge
    child.element.x = parentRightEdge + xSpacing;
    child.x = child.element.x; // Update node's x to match element
    
    // Recursively adjust the children of this child
    adjustPositions(child, level + 1);
  }
}

// Adjust positions for all root nodes
for (const root of rootNodes) {
  adjustPositions(root, 0);
}

// Now we have the correct positions, let's collect them
const nodePositions = [];
for (const node of nodes) {
  nodePositions.push({
    id: node.element.id,
    x: node.x,
    y: node.y,
    text: node.text,
    node: node
  });
}

// Store the old element IDs for deletion
const oldElementIds = nodes.map(node => node.element.id);

// Clear out old element references
for (const node of nodes) {
  node.element = null;
}

// Now create the actual elements with hand-drawn style
for (const item of nodePositions) {
  // Create a new text element with our function
  const elementId = createTextElement(item.x, item.y, item.text);
  const element = ea.getElement(elementId);
  
  // Update the node reference
  item.node.element = element;
}

// Connect elements with arrows
for (const node of nodes) {
  if (node.parent && node.element && node.parent.element) {
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

// Now delete the old temporary elements
try {
  // Instead of using deleteViewElements, mark each element as deleted
  // and then update the scene - this is more reliable
  for (const elementId of oldElementIds) {
    const element = ea.getElement(elementId);
    if (element) {
      element.isDeleted = true;
    }
  }
} catch (e) {
  console.log("Error deleting elements:", e);
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

// Finalize by adding elements to view
await ea.addElementsToView(false, false, true);