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
  // Returns an array of top-level nodes, each node has { label, children[] } recursively
  function parseBulletedText(rawText) {
    // 1. Split into lines, ignoring empty lines
    const lines = rawText.split(/\r?\n/).map(l => l.trimEnd());
    
    // We'll store each line's indentation level + label
    // We treat the indentation based on leading tabs OR spaces. 
    // For simplicity, let's assume each leading tab = 1 indent level
    // (If you have spaces, you can handle them similarly or treat each 2/4 spaces as one indent.)
    
    // parse lines into a structure { depth, label }
    const parsed = [];
    for (let line of lines) {
      if (!line.trim()) {
        // skip blank lines
        continue;
      }
      // measure leading tabs
      let depth = 0;
      let i = 0;
      while (i < line.length && line[i] === "\t") {
        depth++;
        i++;
      }
      // remove leading tabs from the text
      let label = line.slice(i).trim();
      // if there's a dash prefix, remove it
      if (label.startsWith("- ")) {
        label = label.slice(2).trim();
      }
      parsed.push({ depth, label });
    }

    // Now we build a tree from this array
    // Each item is { label, children: [] }
    // We'll keep an array "stack" to track the current chain of parent nodes
    const roots = [];
    const stack = [];

    for (let item of parsed) {
      const node = { label: item.label, children: [] };

      // If stack is empty, or item.depth === 0 => top-level node
      if (stack.length === 0 || item.depth === 0) {
        roots.push(node);
        stack.length = 0;   // clear stack
        stack.push({ depth: item.depth, node });
      } else {
        // We'll pop from the stack until the top of the stack is at a shallower depth
        while (stack.length > 0 && stack[stack.length - 1].depth >= item.depth) {
          stack.pop();
        }
        if (stack.length === 0) {
          // It's effectively top-level again
          roots.push(node);
          stack.push({ depth: item.depth, node });
        } else {
          // the top of the stack is the parent
          stack[stack.length - 1].node.children.push(node);
          stack.push({ depth: item.depth, node });
        }
      }
    }

    return roots;
  }


  // -----------------------------------------------------
  // Helper function: build a mindmap (left->right) from a bullet node
  // We place shapes with x offset = 200 * depth, sibling spacing = 100px
  // Lines have no arrowheads
  async function buildMindmapFromBullets(rootNode, originalTextEl) {
    // We'll create shapes for each bullet node recursively
    // We'll store them so we can connect them with lines
    // We'll also keep track of the bounding box so we know where to place them

    // Let's pick a starting X, Y near the original text element
    // or you can pick a default like (100,100)
    const startX = originalTextEl.x;
    const startY = originalTextEl.y;

    // We'll define a function that places each node
    // Depth-based horizontal offset: depth * 200
    // We'll track vertical offset for siblings
    let nodeIdCounter = 0;
    const placedNodes = [];

    // measure text sizing if you want. We'll just pick a default width/height
    // or you can let Excalidraw auto-size the text
    // For a better approach, we might measure the text and set the element width/height accordingly.
    // We'll keep it simple for now.
    const defaultWidth = 150;
    const defaultHeight = 40;

    // We'll do a recursive function that places node + children
    function placeNode(node, depth, siblingIndex, siblingCount) {
      // y offset from top of all siblings
      // If we have siblingCount siblings at this depth, they occupy totalHeight = (siblingCount-1)*verticalSpacing
      // We'll try to center them around 0. 
      const verticalSpacing = 100;
      const xPos = startX + depth * 200; // horizontal offset
      // We'll offset y by (siblingIndex * verticalSpacing) - some center offset
      // For simplicity, let's not do fancy centering. We'll just stack them downward
      const yPos = startY + siblingIndex * verticalSpacing; 

      // create a text element with node.label
      // We use the Excalidraw Automate "ea.style", "ea.addText" or so:
      ea.style.fontSize = 20;
      ea.style.textAlign = "left";
      const newNodeId = ea.addText(xPos, yPos, node.label);
      // optionally size it or style it more
      // update the element in the "EAforEditing" if you want

      placedNodes.push({ id: newNodeId, label: node.label, depth, x: xPos, y: yPos, nodeRef: node });

      // place children
      for (let i = 0; i < node.children.length; i++) {
        placeNode(node.children[i], depth + 1, i, node.children.length);
      }
    }

    // We call placeNode on the root node alone. 
    // But if the root node itself has siblings, that means we actually have
    // multiple "top-level" items in the children array. Usually not the case if we picked a single root.
    // We'll place just the root with siblingIndex=0, siblingCount=1
    placeNode(rootNode, 0, 0, 1);

    // Now we connect them. We'll do it after we place them so we have all coords
    // Let's define a function to find the placed node for a given nodeRef
    function findPlaced(nodeRef) {
      return placedNodes.find(p => p.nodeRef === nodeRef);
    }

    // We'll do a recursion that for each node, we connect it to its children
    function connectChildren(node) {
      // for each child in node.children, we find the parent's placed info and the child's placed info
      for (let child of node.children) {
        const parentPlaced = findPlaced(node);
        const childPlaced = findPlaced(child);
        if (parentPlaced && childPlaced) {
          // We'll create a line from parent's right edge to child's left edge
          // or we can do a quick midpoint approach. 
          // We'll define a getEdge func or we do a direct approach:
          const parentXCenter = parentPlaced.x;  // that's top-left corner, actually
          // If you want the center, you'd do parentXCenter + (some width / 2)
          const pxCenter = parentXCenter + (defaultWidth / 2);
          const pyCenter = parentPlaced.y + (defaultHeight / 2);

          const childXCenter = childPlaced.x + (defaultWidth / 2);
          const childYCenter = childPlaced.y + (defaultHeight / 2);

          ea.style.strokeColor = "#000000";
          ea.style.strokeWidth = 1;
          ea.style.roughness = 0;
          // No arrowheads
          ea.addArrow(
            [
              [pxCenter, pyCenter],
              [childXCenter, childYCenter]
            ],
            {
              startArrowHead: null,
              endArrowHead: null,
              numberOfPoints: 0, // straight line
            }
          );
        }
        // recurse
        connectChildren(child);
      }
    }
    connectChildren(rootNode);

    // Now we add everything to the view
    // remove or hide the original text block if you prefer
    ea.copyViewElementsToEAforEditing([]);
    ea.deleteViewElements([originalTextEl.id]); // if you want to remove the original text

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
  const bulletTree = parseBulletedText(rawText);

  if (!bulletTree || bulletTree.length === 0) {
    new Notice("No valid bullet lines found in the selected text block.");
    return;
  }

  // 3. Handle single vs. multiple top-level items
  let rootNode;
  if (bulletTree.length === 1) {
    // We have exactly one top-level node
    rootNode = bulletTree[0];
  } else {
    // We have multiple top-level items
    // We'll create an artificial root with label "Root" that has them as children
    rootNode = {
      label: "Root",
      children: bulletTree
    };
  }

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
    // If we’ve seen this shape already, bail out (avoid cycles)
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

    // Recursively include children’s text in sorted order
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
 * We then compute a vertical offset using the slope from the shape’s center
 * and clamp the result so it stays within the element’s top and bottom.
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
