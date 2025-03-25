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
  },
  "Add dash bullet": {
    value: true,
    description: "If true, prepend a dash '-' to each bullet line in the outline."
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

// -----------------------------------------------------
// Helper function: check if an element has any line/arrow connections
function hasConnections(el) {
  // You can do a quick check in the current canvas:
  const allElements = ea.getViewElements();
  const linesOrArrows = allElements.filter(e => e.type === "line" || e.type === "arrow");
  for (let la of linesOrArrows) {
    // check if it references `el.id`
    if ((la.startBinding?.elementId === el.id) || (la.endBinding?.elementId === el.id)) {
      return true;
    }
  }
  return false;
}

// A. Detect the "Single Text Block, No Connections" scenario
if (
  selectedElements.length === 1 &&
  selectedElements[0].type === "text" &&
  !hasConnections(selectedElements[0]) // we'll define hasConnections() below
) {

  // -----------------------------------------------------
  // Helper function: parse a bulleted text block (with indentation)
  // Returns an array of parsed nodes with relationships
  function parseBulletedText(rawText) {
    const lines = rawText.split('\n');
    // Track the indentation of each level as we go
    const levelIndents = [0]; // Start with root level at 0 indentation
    let lastLevel = 0;
    let prevIndent = 0;
    
    // Parse each line and build a hierarchical structure
    const nodes = [];
    const parents = [];
    
    // Helper function to determine the indentation level
    function getIndentLevel(line, prevIndent) {
      // Extract leading whitespace
      const match = line.match(/^(\s*)([-*+]?)(.*)$/);
      if (!match) return null;
      
      const leading = match[1]?.replace(/\t/g, "    ") || "";
      const bullet = match[2] || "";
      const content = match[3]?.trim() || "";
      const currentIndent = leading.length;
      
      let level = 0;
      
      // Compare with previous indentation
      if (currentIndent > prevIndent) {
        // Child of previous line
        level = lastLevel + 1;
        levelIndents[level] = currentIndent;
      } else if (currentIndent === prevIndent) {
        // Sibling of previous line
        level = lastLevel;
      } else {
        // Find the parent level by backtracking
        for (level = lastLevel - 1; level >= 0; level--) {
          if (levelIndents[level] === currentIndent) {
            break; // Found the right level
          } else if (levelIndents[level] < currentIndent) {
            // We're between two known levels, use the parent
            break;
          }
        }
        // Ensure we don't go below 0
        level = Math.max(0, level);
      }
      
      lastLevel = level;
      return { level, bullet, content };
    }

    for (const line of lines) {
      if (!line.trim()) continue; // skip empty
      
      const info = getIndentLevel(line, prevIndent);
      if (!info) {
        new Notice("Invalid line: " + line);
        continue;
      }
      
      // Update the previous indent for next iteration
      prevIndent = line.match(/^(\s*)/)[0].replace(/\t/g, "    ").length;
      
      // destructure info
      const { level, content } = info;
      const node = {
        label: content,
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
        label: "Root",
        level: 0,
        parent: null,
        children: [],
      };
      
      // Make all original root nodes children of the new root
      for (const originalRoot of rootNodes) {
        originalRoot.parent = defaultRootNode;
        defaultRootNode.children.push(originalRoot);
        originalRoot.level = 1; // Update level since it's now a child
      }
      
      // Add the new root node to the nodes array
      nodes.push(defaultRootNode);
      
      return [defaultRootNode]; // Return only the new default root
    }
    
    return rootNodes;
  }
  
  // -----------------------------------------------------
  // Helper function: build a mindmap (left->right) from a bullet node
  // We place shapes with x offset = 200 * depth, sibling spacing = 100px
  // Lines have no arrowheads
  async function buildMindmapFromBullets(rootNode, originalTextEl) {
    // Store the source text element's position and dimensions
    const sourceTextX = originalTextEl.x;
    const sourceTextY = originalTextEl.y;
    const sourceTextWidth = originalTextEl.width;
    const sourceTextHeight = originalTextEl.height;

    // Get spacing values from settings
    const xSpacing = 200; // Horizontal distance between levels
    const ySpacing = 100; // Vertical spacing between sibling nodes

    // Calculate the total height needed for the mindmap
    // First, count the number of leaf nodes (nodes without children)
    const countLeafNodes = (node) => {
      if (!node.children || node.children.length === 0) {
        return 1;
      }
      return node.children.reduce((sum, child) => sum + countLeafNodes(child), 0);
    };
    
    const leafNodeCount = countLeafNodes(rootNode);
    
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

    // Starting x position for root node - position right after the source text element
    const rootX = sourceTextX + sourceTextWidth + 20; // 20px gap between source and mindmap

    // Assign initial positions
    assignInitialPositions(rootNode, 0, rootX);

    // Apply style from the first node
    ea.style.strokeColor = "#000000"; // Default to black
    ea.style.strokeWidth = 1;
    ea.style.strokeStyle = "solid";
    ea.style.strokeSharpness = "sharp";
    ea.style.fontFamily = 5;

    // Create a function for creating text elements with consistent settings
    function createTextElement(x, y, text) {
      return ea.addText(x, y, text, {
        fontFamily: 5,
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
        isHandDrawn: true
      });
    }

    // Set arrow options based on settings
    const arrowOptions = {
      startArrowHead: settings["Starting arrowhead"].value === "none" ? null : settings["Starting arrowhead"].value,
      endArrowHead: settings["Ending arrowhead"].value === "none" ? null : settings["Ending arrowhead"].value,
      numberOfPoints: Math.floor(settings["Line points"].value),
      strokeColor: ea.style.strokeColor,
      strokeWidth: ea.style.strokeWidth,
      strokeStyle: ea.style.strokeStyle,
      roughness: 2, // Add roughness for hand-drawn appearance
    };

    // First create temporary elements to calculate actual space needed
    function createTemporaryElements(node) {
      const elementId = ea.addText(node.x, node.y, node.label);
      node.element = ea.getElement(elementId);
      
      if (node.children) {
        for (const child of node.children) {
          createTemporaryElements(child);
        }
      }
    }
    
    createTemporaryElements(rootNode);

    // Adjust positions based on actual element widths
    function adjustPositions(node) {
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
        adjustPositions(child);
      }
    }

    // Adjust positions
    adjustPositions(rootNode);

    // Store positions and prepare for final elements
    const nodePositions = [];
    function collectNodePositions(node) {
      nodePositions.push({
        id: node.element.id,
        x: node.x,
        y: node.y,
        text: node.label,
        node: node
      });
      
      if (node.children) {
        for (const child of node.children) {
          collectNodePositions(child);
        }
      }
    }
    
    collectNodePositions(rootNode);

    // Store the old element IDs for deletion
    const oldElementIds = nodePositions.map(item => item.id);

    // Clear out old element references
    function clearElementReferences(node) {
      node.element = null;
      if (node.children) {
        for (const child of node.children) {
          clearElementReferences(child);
        }
      }
    }
    
    clearElementReferences(rootNode);

    // Create the actual elements with hand-drawn style
    for (const item of nodePositions) {
      // Create a new text element with our function
      const elementId = createTextElement(item.x, item.y, item.text);
      const element = ea.getElement(elementId);
      
      // Update the node reference
      item.node.element = element;
    }

    // Connect elements with arrows
    function connectWithArrows(node) {
      if (!node.children || node.children.length === 0) {
        return;
      }
      
      for (const child of node.children) {
        if (node.element && child.element) {
          const sourceEl = node.element; // Parent element
          const targetEl = child.element; // Child element

          const sourceCenterX = sourceEl.x + sourceEl.width / 2;
          const sourceCenterY = sourceEl.y + sourceEl.height / 2;

          const targetCenterX = targetEl.x + targetEl.width / 2;
          const targetCenterY = targetEl.y + targetEl.height / 2;

          // Get edge points using the getEdgePoint function
          const [startX, startY] = getEdgePoint(sourceEl, targetCenterX, targetCenterY);
          const [endX, endY] = getEdgePoint(targetEl, sourceCenterX, sourceCenterY);

          // Create the arrow with startObjectId and endObjectId
          ea.addArrow([[startX, startY], [endX, endY]], {
            ...arrowOptions,
            startObjectId: sourceEl.id,
            endObjectId: targetEl.id,
          });
        }
        
        // Recursively connect child's children
        connectWithArrows(child);
      }
    }
    
    connectWithArrows(rootNode);

    // Delete the old temporary elements
    try {
      for (const elementId of oldElementIds) {
        const element = ea.getElement(elementId);
        if (element) {
          element.isDeleted = true;
        }
      }
    } catch (e) {
      console.log("Error deleting elements:", e);
    }

    // Remove or hide the original text block
    ea.copyViewElementsToEAforEditing([]);
    ea.deleteViewElements([originalTextEl.id]);

    // Finalize by adding elements to view
    await ea.addElementsToView(false, false, true);
    new Notice("Created mindmap from bulleted text!");
  }

  // The user presumably wants to convert a bulleted text block to a mindmap
  const textElement = selectedElements[0];
  
  // 1. Grab the text (including line breaks)
  let rawText = textElement.text || "";
  rawText = rawText.trim();
  if (!rawText) {
    new Notice("The selected text block is empty.");
    return;
  }

  // 2. Parse the bulleted text into a tree
  const rootNodes = parseBulletedText(rawText);

  if (!rootNodes || rootNodes.length === 0) {
    new Notice("No valid bullet lines found in the selected text block.");
    return;
  }

  // 3. Get the root node (we've already handled the multiple root case in parseBulletedText)
  const rootNode = rootNodes[0];

  // 4. Create the mindmap from that root node
  buildMindmapFromBullets(rootNode, textElement);

  return; // end script
}

// If only one element is selected, and it is connected, perform grouping action
if (selectedElements.length === 1 && 
    selectedElements[0].type === 'text') {
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
  
  /**
  * Recursively build a bullet-list outline from a "root" shape,
  * including all children on its right side, and each child's children, etc.
  *
  * @param {Object} element The shape from which to start
  * @param {Object[]} allElements All shapes/arrows on the canvas
  * @param {Set} visited For cycle prevention
  * @param {number} depth Indentation level
  * @returns {string} The bullet-list text representing this node and its descendants
  */
  function buildOutline(element, allElements, visited = new Set(), depth = 0) {
    // If we've seen this shape already, bail out (avoid cycles)
    if (visited.has(element.id)) {
      return "";
    }
    visited.add(element.id);

    // Figure out how we label each element
    let label = element.text?.trim() ?? `Element ${element.id}`;
    // Remove all line breaks from the node text
    label = label.replace(/\r?\n/g, " ");

    // Adjust indentation
    let indent = "\t".repeat(depth);

    // The new setting read:
    const useDash = settings["Add dash bullet"].value;
    // If it's true, we'll prepend "- ", otherwise just an empty string or something else
    let bulletPrefix = useDash ? "- " : "";

    // Form this line
    let outline = `${indent}${bulletPrefix}${label}\n`;

    // Find all arrow-based children to the right
    const outgoingArrows = allElements.filter((el) => {
      if (el.type === "arrow" && el.startBinding?.elementId === element.id) {
        const endEl = allElements.find((e) => e.id === el.endBinding?.elementId);
        if (endEl && endEl.x > element.x) {
          return true;
        }
      }
      return false;
    });

    // Collect the child elements (shapes) from those arrows
    let childShapes = [];
    for (let arrow of outgoingArrows) {
      const childId = arrow.endBinding?.elementId;
      const childEl = allElements.find((e) => e.id === childId);
      if (childEl) {
        childShapes.push(childEl);
      }
    }

    // **Sort the child elements top-to-bottom** by their y coordinate
    // (You could also sort by the center y if desired: childEl.y + childEl.height/2)
    childShapes.sort((a, b) => a.y - b.y);

    // Recursively include children's text in sorted order
    for (let childEl of childShapes) {
      outline += buildOutline(childEl, allElements, visited, depth + 1);
    }

    return outline;
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
  
  // Generate the bullet text from the new function
  const bulletText = buildOutline(rootElement, allElements);

  // Copy bullet text to the clipboard
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(bulletText);
      new Notice("Mindmap text copied to clipboard!");
    } else {
      ea.setClipboard(bulletText);
      new Notice("Mindmap text copied to plugin clipboard!");
    }
  } catch (err) {
    console.error("Clipboard error:", err);
    new Notice("Error copying bullet text to clipboard!");
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

/**
 * getEdgePoint(element, targetX, targetY)
 * Always returns a point on the left or right boundary of `element`.
 * If the target is to the right, you get the right edge (x + w).
 * If the target is to the left, you get the left edge (x).
 * We then compute a vertical offset using the slope from the shape's center
 * and clamp the result so it stays within the element's top and bottom.
 */
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
