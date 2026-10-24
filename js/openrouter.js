// The functions every page uses to talk to OpenRouter.
// Each call adds its cost to a session total shown on the page.

const MODEL = 'google/gemini-2.5-flash-lite';
const IMAGE_MODEL = 'google/gemini-2.5-flash-image';

let sessionCost = 0;
let sessionCalls = 0;

function addCost(data) {
  sessionCost += data.usage?.cost || 0;
  sessionCalls += 1;
  const costEl = document.getElementById('sessionCost');
  const callsEl = document.getElementById('sessionCalls');
  if (costEl) costEl.textContent = sessionCost.toFixed(4);
  if (callsEl) callsEl.textContent = sessionCalls;
}

function requireKey() {
  if (typeof OPENROUTER_API_KEY === 'undefined' || OPENROUTER_API_KEY.startsWith('YOUR_')) {
    throw new Error('No API key. Copy js/config.local.example.js to js/config.local.js and paste your key in.');
  }
}

async function askModel(prompt, model = MODEL) {
  requireKey();
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENROUTER_API_KEY },
    body: JSON.stringify({ model: model, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || response.statusText);
  addCost(data);
  return data;
}

async function askImage(prompt) {
  requireKey();
  const response = await fetch('https://openrouter.ai/api/v1/images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENROUTER_API_KEY },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt: prompt, n: 1, aspect_ratio: '3:2' }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || response.statusText);
  addCost(data);
  return data;
}