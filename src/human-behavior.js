/**
 * Human Behavior Simulation Engine for Playwright
 * Provides realistic mouse movements, typing cadences, bezier trajectories, and human pauses.
 */

// Track current mouse position
let currentMousePos = { x: 100, y: 100 };

/**
 * Random integer between min and max inclusive
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Random float between min and max
 */
function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Human pause with randomized jitter
 */
function humanDelay(minMs = 400, maxMs = 1000) {
  const ms = randomInt(minMs, maxMs);
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generates cubic bezier curve points between start and end
 */
function generateBezierCurve(start, end, numPoints = 25) {
  // Randomize two control points
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const distance = Math.hypot(deltaX, deltaY);

  const variance = Math.min(distance * 0.35, 120);

  const cp1 = {
    x: start.x + deltaX * randomFloat(0.2, 0.4) + randomFloat(-variance, variance),
    y: start.y + deltaY * randomFloat(0.1, 0.3) + randomFloat(-variance, variance)
  };

  const cp2 = {
    x: start.x + deltaX * randomFloat(0.6, 0.8) + randomFloat(-variance, variance),
    y: start.y + deltaY * randomFloat(0.7, 0.9) + randomFloat(-variance, variance)
  };

  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    // Cubic bezier formula: (1-t)^3*P0 + 3(1-t)^2*t*P1 + 3(1-t)*t^2*P2 + t^3*P3
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    const x = uuu * start.x + 3 * uu * t * cp1.x + 3 * u * tt * cp2.x + ttt * end.x;
    const y = uuu * start.y + 3 * uu * t * cp1.y + 3 * u * tt * cp2.y + ttt * end.y;

    points.push({ x: Math.round(x), y: Math.round(y) });
  }

  return points;
}

/**
 * Move mouse naturally across a bezier curve to target coordinates
 */
async function humanMouseMove(page, targetX, targetY) {
  const start = { ...currentMousePos };
  const end = { x: targetX, y: targetY };
  const distance = Math.hypot(end.x - start.x, end.y - start.y);

  // Dynamic point count based on distance
  const numPoints = Math.max(12, Math.min(40, Math.floor(distance / 20)));
  const points = generateBezierCurve(start, end, numPoints);

  for (const pt of points) {
    await page.mouse.move(pt.x, pt.y);
    currentMousePos = pt;
    // Tiny jitter delay
    await new Promise(r => setTimeout(r, randomInt(6, 18)));
  }

  // Final move to exact coordinate
  await page.mouse.move(targetX, targetY);
  currentMousePos = { x: targetX, y: targetY };
}

/**
 * Move mouse naturally to an element and click it like a human
 */
async function humanClick(page, selectorOrElement, options = {}) {
  let element = null;
  if (typeof selectorOrElement === 'string') {
    await page.waitForSelector(selectorOrElement, { state: 'visible', timeout: options.timeout || 15000 });
    element = await page.$(selectorOrElement);
  } else {
    element = selectorOrElement;
  }

  if (!element) {
    throw new Error(`Element not found for human click: ${selectorOrElement}`);
  }

  // Scroll element into view if needed
  await element.scrollIntoViewIfNeeded().catch(() => {});

  const box = await element.boundingBox();
  if (!box) {
    // Fallback standard click if boundingBox not available (e.g. SVG hidden)
    await element.click();
    return;
  }

  // Click slightly off-center (between 25% and 75% of width/height)
  const targetX = Math.round(box.x + box.width * randomFloat(0.3, 0.7));
  const targetY = Math.round(box.y + box.height * randomFloat(0.3, 0.7));

  // 1. Move mouse smoothly to element
  await humanMouseMove(page, targetX, targetY);

  // 2. Human hesitation before clicking (100ms - 350ms)
  await humanDelay(100, 350);

  // 3. Mouse down -> pause -> Mouse up
  await page.mouse.down();
  await humanDelay(50, 120);
  await page.mouse.up();

  // 4. Post-click natural pause
  await humanDelay(options.postDelayMin || 200, options.postDelayMax || 500);
}

/**
 * Type text realistically with variable speeds, pauses after punctuation, and natural cadence
 */
async function humanType(page, selectorOrElement, text, options = {}) {
  // First, naturally click to focus the element
  await humanClick(page, selectorOrElement, { postDelayMin: 150, postDelayMax: 300 });

  // Clear existing content if needed
  if (options.clear !== false) {
    await page.keyboard.press('Control+A');
    await humanDelay(60, 140);
    await page.keyboard.press('Backspace');
    await humanDelay(100, 250);
  }

  const str = String(text || '');

  // For long texts (> 120 chars), type in rapid human chunks with natural cadence
  if (str.length > 100) {
    // Divide into phrases/words
    const words = str.split(' ');
    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      for (const char of word) {
        await page.keyboard.type(char);
        await new Promise(r => setTimeout(r, randomInt(18, 45)));
      }
      // Space between words
      if (w < words.length - 1) {
        await page.keyboard.type(' ');
        // Human space pause
        await new Promise(r => setTimeout(r, randomInt(40, 120)));
        // Occasional thought pause after punctuation
        if (word.endsWith(',') || word.endsWith('.') || word.endsWith('!') || word.endsWith('?')) {
          await humanDelay(180, 400);
        }
      }
    }
  } else {
    // Normal human typing
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      await page.keyboard.type(char);

      // Keystroke timing: faster for normal letters, longer for punctuation
      if (['.', ',', '!', '?', ';', ':'].includes(char)) {
        await humanDelay(150, 350);
      } else if (char === ' ') {
        await humanDelay(50, 130);
      } else {
        await new Promise(r => setTimeout(r, randomInt(25, 75)));
      }
    }
  }

  // Natural pause after finishing typing
  await humanDelay(300, 700);
}

/**
 * Paste text like a human using Ctrl+V / paste operation
 * Focuses element with smooth mouse click, clears existing text,
 * pastes text in one go, and adds a natural human delay.
 */
async function humanPaste(page, selectorOrElement, text, options = {}) {
  // 1. Naturally click into the element to focus
  await humanClick(page, selectorOrElement, { postDelayMin: 150, postDelayMax: 300 });

  // 2. Clear existing content if needed
  if (options.clear !== false) {
    await page.keyboard.press('Control+A');
    await humanDelay(50, 100);
    await page.keyboard.press('Backspace');
    await humanDelay(80, 160);
  }

  // 3. Paste text (insertText triggers genuine input and change events like paste)
  const str = String(text || '');
  if (typeof selectorOrElement === 'string') {
    await page.fill(selectorOrElement, str);
  } else {
    await page.keyboard.insertText(str);
  }

  // 4. Natural human pause after pasting before moving to the next action
  await humanDelay(options.postDelayMin || 500, options.postDelayMax || 1000);
}

module.exports = {
  humanDelay,
  humanMouseMove,
  humanClick,
  humanType,
  humanPaste
};
