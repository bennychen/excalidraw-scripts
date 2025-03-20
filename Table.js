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
  new Notice('Please select a single text element containing the table text.');
  return;
}

const textElement = selectedElements[0];
const tableText = textElement.text;

// Optional: Remove the text element after extracting the text
// ea.deleteViewElements([textElement.id]);

// Use script settings to get per-table settings
settings = ea.getScriptSettings();
// Set default values on first run
const defaultSettings = {
  "Font Size": {
    value: 16,
    description: "Font size for cell text"
  },
  "Horizontal Alignment": {
    value: "center",
    valueset: ["left", "center", "right"],
    description: "Horizontal alignment of text in cells"
  },
  "Vertical Alignment": {
    value: "middle",
    valueset: ["top", "middle", "bottom"],
    description: "Vertical alignment of text in cells"
  },
  "Padding": {
    value: 10,
    description: "Padding inside each cell"
  },
  "Draw Grid Lines": {
    value: true,
    description: "Whether to draw lines for rows and columns"
  }
};

// Check and set default values for each setting if not present
for (const key in defaultSettings) {
  if (!settings[key]) {
    settings[key] = defaultSettings[key];
  }
}

ea.setScriptSettings(settings);

// Get settings
const fontSize = parseInt(settings["Font Size"].value);
const hAlign = settings["Horizontal Alignment"].value;
const vAlign = settings["Vertical Alignment"].value;
const padding = parseInt(settings["Padding"].value);
const drawGridLines = settings["Draw Grid Lines"].value;

// Parse the table text
const lines = tableText.trim().split('\n');
if (lines.length === 0) {
  new Notice('The selected text element is empty.');
  return;
}

const tableData = [];

// Function to split a line into cells
function splitLine(line) {
  // Split by tabs or multiple spaces
  const cells = line.trim().split(/\t+| {2,}/);
  return cells;
}

// Parse each line into cells
for (const line of lines) {
  const cells = splitLine(line);
  tableData.push(cells);
}

// Determine the number of columns (based on the maximum cells in any row)
const columnCount = Math.max(...tableData.map(row => row.length));
const rowCount = tableData.length;

// Measure text to calculate cell sizes
const cellWidths = new Array(columnCount).fill(0);
const rowHeights = new Array(rowCount).fill(0);

// Function to measure text width and height
function measureText(text, fontSize) {
  // Adjust this function based on Excalidraw's font metrics
  const approximateCharacterWidth = fontSize * 0.6; // Approximate width per character
  const width = text.length * approximateCharacterWidth;
  const height = fontSize; // Approximate height
  return { width, height };
}

// Calculate cell widths and row heights
for (let row = 0; row < rowCount; row++) {
  for (let col = 0; col < columnCount; col++) {
    const cellText = tableData[row][col] !== undefined ? tableData[row][col] : '';
    const { width, height } = measureText(cellText, fontSize);
    const cellWidth = width + 2 * padding;
    const cellHeight = height + 2 * padding;

    if (cellWidths[col] < cellWidth) {
      cellWidths[col] = cellWidth;
    }
    if (rowHeights[row] < cellHeight) {
      rowHeights[row] = cellHeight;
    }
  }
}

// Calculate cumulative positions for columns and rows
const columnPositions = [0];
for (let i = 0; i < columnCount; i++) {
  columnPositions.push(columnPositions[i] + cellWidths[i]);
}

const rowPositions = [0];
for (let i = 0; i < rowCount; i++) {
  rowPositions.push(rowPositions[i] + rowHeights[i]);
}

// Starting position (top-left corner of the table)
const startX = textElement.x;
const startY = textElement.y;

// Optional: Remove the original text element
// ea.deleteViewElements([textElement.id]);

// Create elements for each cell
for (let row = 0; row < rowCount; row++) {
  for (let col = 0; col < columnCount; col++) {
    const x = startX + columnPositions[col];
    const y = startY + rowPositions[row];

    // Get the cell content, if any
    const cellText = tableData[row][col] !== undefined ? tableData[row][col] : '';

    // Create the text element for the cell
    const textId = ea.addText(x + padding, y + padding, cellText, {
      width: cellWidths[col] - 2 * padding,
      height: rowHeights[row] - 2 * padding,
      fontSize: fontSize,
      textAlign: hAlign,
      verticalAlign: vAlign,
    });
  }
}

// Draw grid lines if enabled
if (drawGridLines) {
  // Set line style
  ea.style.strokeColor = "#000000"; // Black color
  ea.style.strokeWidth = 1;
  ea.style.strokeStyle = "solid";
  ea.style.strokeSharpness = "sharp";

  // Draw vertical lines
  for (let col = 0; col <= columnCount; col++) {
    const x = startX + columnPositions[col];
    const y1 = startY;
    const y2 = startY + rowPositions[rowCount];

    ea.addLine([[x, y1], [x, y2]]);
  }

  // Draw horizontal lines
  for (let row = 0; row <= rowCount; row++) {
    const y = startY + rowPositions[row];
    const x1 = startX;
    const x2 = startX + columnPositions[columnCount];

    ea.addLine([[x1, y], [x2, y]]);
  }
}

// Finalize by adding elements to view
await ea.addElementsToView(false, false, true);
