// ============ helpers ============
const $ = (id) => document.getElementById(id);

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

const wc = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const clean = (t) => t.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/^\s*\*\s+/gm, '- ');
const norm = (s) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

function parseJSON(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('The model did not return JSON');
  return JSON.parse(text.slice(s, e + 1));
}

const cache = {};   // never pay twice for the same thing in a session
let pack, measures = [], offices = [];

// ============ load data + tabs ============
fetch('data/datapack.json').then((r) => r.json()).then((p) => {
  pack = p; measures = p.measures; offices = p.offices;
  for (const m of measures) { $('measure').add(new Option(m.label, m.id)); $('cmpMeasure').add(new Option(m.label, m.id)); }
  for (const o of offices) $('office').add(new Option(o.name, o.id));
  $('disclaimer').textContent = pack.meta.argumentDisclaimer;
  showMeasure(); showCompareStatic(); showOffice();
}).catch((err) => alert('Could not load the data pack: ' + err.message));

document.querySelectorAll('nav button').forEach((btn) => {
  btn.onclick = () => {
    for (const n of ['measures', 'compare', 'offices']) $('tab-' + n).hidden = (n !== btn.dataset.tab);
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b === btn));
  };
});

// ============ TAB 1: measures ============
const LEVEL_NAME = { plain: 'Plain English', everyday: 'Everyday', simplest: 'Simplest' };
const LEVELS = {
  plain: 'a newspaper editorial, about grade 11 to 13. Keep technical terms but define each one the first time it appears.',
  everyday: 'about grade 7 to 9. Average sentence under 15 words. Common words. Leave nothing undefined.',
  simplest: 'about grade 3 to 4, for an elementary school reader. Every sentence under 10 words. Use words of one or two syllables where possible. Use a small relatable example.',
};
const LENGTHS = {
  headline: 'at most 25 words (one or two short sentences)',
  short: 'between 75 and 100 words',
  standard: 'between 250 and 300 words',
  complete: 'no word limit, but cover every provision of the measure',
};
const GRADE_TARGET = { plain: [11, 13], everyday: [7, 9], simplest: [3, 4] };
const LEN_RANGE = { headline: [0, 25], short: [75, 100], standard: [250, 300], complete: null };

// Simple text search (no AI) for details a rewrite must not lose.
const QUALIFIERS = {
  'prop-40': [['"one-time"', /one[- ]time/i]],
  'prop-43': [['two-thirds vote', /two[- ]thirds|2\/3|two out of (every )?three/i], ['starts in 2027', /2027/], ['special taxes', /special tax/i]],
  'prop-4': [['says it repeals / ends a ban', /repeal|ends? the ban|removes? the ban|lifts? the ban|no longer (ban|prohibit)/i]],
  'prop-45': [['deadlines / time limits', /deadline|time ?limit|days/i]],
};

const current = () => measures.find((m) => m.id === $('measure').value);

// The prompt is built from the FULL LEGAL TEXT ONLY. Never the official summary.
function buildPrompt(m, level, length, marked) {
  const text = marked ? m.fullTextMarked : m.fullText;
  const markerNote = marked
    ? 'Text marked [DELETED: ...] is being removed from the law. Text marked [NEW: ...] is being added.'
    : 'Text marked [DELETED: ...] is being removed from the law.';
  return `Rewrite this California ballot measure for a voter.
Reading level: ${LEVELS[level]}
Length: ${LENGTHS[length]}.

Rules:
- Use ONLY the legal text below. Do not add facts from outside it.
- ${markerNote}
- Say plainly what the measure changes. If it repeals or removes something, say so.
- Never drop qualifiers such as "one-time", dollar amounts, percentages, vote thresholds, dates, or who is affected.
- No opinions. Do not say how to vote.
- Plain text only. No markdown, no headings, no asterisks.

${m.label} full legal text:
${text}`;
}

function refreshControls() {
  const m = current(), level = $('level').value, length = $('length').value;
  let msg = '';
  $('length').disabled = (level === 'asis');
  $('marked').disabled = (level === 'asis');
  if (level === 'asis') {
    msg = 'As written shows the exact certified text. No AI is used, so length does not apply.';
  } else {
    if (level === 'simplest' && length === 'headline') msg += 'Simplest at Headline length will very likely drop qualifiers (for example "one-time"). Check the result against the full text. ';
    const r = LEN_RANGE[length];
    if (r && r[0] > m.wordCount) msg += `${m.label} is only ${m.wordCount} words, shorter than the ${r[0]}-word target, so the model will have to pad. `;
    if (length === 'complete' && m.wordCount > 5000) msg += `This measure is long (${m.wordCount} words): slower, costs more, and may miss provisions.`;
  }
  $('warning').textContent = msg.trim();
  $('warning').hidden = !msg.trim();
}

function showMeasure() {
  const m = current();
  $('officialTitle').textContent = m.official.title;
  $('officialPage').href = m.official.url;
  $('legalText').href = m.sources.legalTextPdf;
  const fk = fleschKincaid(operativeText(m.fullText));
  $('measureInfo').textContent = `${m.wordCount} words of legal text · reads at grade ${fk.grade} · certified text, not AI`;
  $('officialSummary').textContent = m.official.summary;
  $('officialFk').textContent = `The state's summary reads at grade ${fleschKincaid(m.official.summary).grade}.`;
  $('fullText').textContent = m.fullText;
  $('fullText').hidden = true;
  $('result').replaceChildren();
  renderTopics(m);
  refreshControls();
}
$('measure').onchange = showMeasure;
$('level').onchange = refreshControls;
$('length').onchange = refreshControls;

function toggleFull() { $('fullText').hidden = !$('fullText').hidden; }
$('toggleFull').onclick = (e) => { e.preventDefault(); toggleFull(); };
$('go').onclick = () => runMeasure(false);

async function runMeasure(force) {
  const m = current(), level = $('level').value, length = $('length').value;
  const marked = $('marked').checked, model = $('model').value, out = $('result');

  if (level === 'asis') {
    const fk = fleschKincaid(operativeText(m.fullText));
    out.replaceChildren(h('div', { class: 'official' },
      h('span', { class: 'tag off' }, 'OFFICIAL CERTIFIED TEXT'),
      ` not AI · reads at grade ${fk.grade} · the exact text is shown below`));
    $('fullText').hidden = false;
    return;
  }

  const key = [m.id, level, length, marked, model].join('|');
  let entry = cache[key];
  if (!entry || force) {
    $('go').disabled = true;
    out.textContent = 'Waiting for the model…';
    const prompt = buildPrompt(m, level, length, marked);
    try {
      const t0 = performance.now();
      const data = await askModel(prompt, model);
      entry = {
        text: clean(data.choices[0].message.content), model: data.model, prompt,
        cost: data.usage?.cost || 0, secs: ((performance.now() - t0) / 1000).toFixed(1),
      };
      cache[key] = entry;
    } catch (err) {
      out.textContent = 'Error: ' + err.message;
      $('go').disabled = false;
      return;
    }
    $('go').disabled = false;
  }
  renderMeasure(m, level, length, entry);
}

function renderMeasure(m, level, length, e) {
  const fk = fleschKincaid(e.text).grade;
  const orig = fleschKincaid(operativeText(m.fullText)).grade;
  const gt = GRADE_TARGET[level], n = wc(e.text), lr = LEN_RANGE[length];
  const gradeOk = fk !== null && fk >= gt[0] && fk <= gt[1];
  const lenOk = !lr || (n >= lr[0] && n <= lr[1]);
  const quals = (QUALIFIERS[m.id] || []).map(([label, re]) => {
    const hit = re.test(e.text);
    return h('div', { class: hit ? 'ok' : 'bad' }, (hit ? '✓ ' : '✗ ') + label + (hit ? ' is mentioned' : ' was NOT found in this rendering'));
  });
  const box = h('div', { class: 'ai' },
    h('div', {}, h('span', { class: 'tag' }, 'AI-GENERATED'), `${m.label} · ${LEVEL_NAME[level]} · ${length} · from the full legal text · ${e.model}`),
    h('p', { class: 'body' }, e.text),
    h('div', { class: gradeOk ? 'ok' : 'bad' }, `Reading level: grade ${fk} (target ${gt[0]}-${gt[1]}) ${gradeOk ? '✓' : 'missed target'} · the legal text is grade ${orig}`),
    h('div', { class: lenOk ? 'ok' : 'bad' }, `Length: ${n} words` + (lr ? ` (target ${lr[0]}-${lr[1]}) ${lenOk ? '✓' : 'missed target'}` : ' (no cap)')),
    ...quals,
    h('small', {}, `Took ${e.secs}s · this call cost $${e.cost} · Machine-written. It can be wrong. Nothing here is official.`),
    h('div', {},
      h('a', { href: m.sources.legalTextPdf, target: '_blank' }, 'Full legal text (PDF)'), ' · ',
      h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); toggleFull(); } }, 'Show full legal text here'), ' ',
      h('button', { onclick: () => runMeasure(true) }, 'Regenerate (new call)')),
    h('details', {}, h('summary', {}, 'Show exactly what was sent'), h('pre', { class: 'body' }, e.prompt)));
  $('result').replaceChildren(box);
}

// ---- Topics of concern: keyword counts (NO AI), then an optional AI explanation ----
const TOPICS = [
  { id: 'taxes', label: 'My Taxes', covers: 'Taxes & spending, such as how public money is spent',
    re: /\b(tax\w*|revenues?|funds?|funding|fees?|spend\w*|expenditures?|appropriat\w*|budget\w*|dollars?)\b|\$\d/i },
  { id: 'home', label: 'My Home', covers: 'Rent & housing costs, including renting and owning',
    re: /\b(housing|homes?|homeowners?|mortgages?|rents?|rental\w*|renters?|tenants?|landlords?|residential|apartments?|dwellings?|residences?)\b/i },
  { id: 'health', label: 'My Health and Schools', covers: 'Your health, and help for families & schools',
    re: /\b(health\w*|medi-cal|medical|hospitals?|clinics?|patients?|schools?|education\w*|students?|teachers?|child\w*|famil\w*|colleges?|nutrition|food)\b/i },
  { id: 'neighborhood', label: 'My Neighborhood', covers: 'Local services & environment, including water and roads',
    re: /\b(water|roads?|transit|transportation|environment\w*|wildfires?|fire|police|safety|energy|electric(ity)?|broadband|infrastructure|pollution|parks?|utilit\w*|neighborhoods?|sewer|waste)\b/i },
  { id: 'vote', label: 'My Vote and My Say', covers: 'Elections & your vote',
    re: /\b(elections?|elective|elected|electorate|vote\w*|voters?|ballots?|candidates?|campaigns?|initiative|referendum|political)\b/i },
];

function renderTopics(m) {
  const ps = m.fullText.split(/\n\s*\n/).filter((p) => p.trim());
  const rows = TOPICS.map((t) => ({ t, n: ps.filter((p) => t.re.test(p)).length }));
  const max = Math.max(...rows.map((r) => r.n));
  const box = $('topics');
  box.replaceChildren(h('small', {}, 'Keyword counts: how many paragraphs of the legal text mention each topic\'s words. No AI. A rough signal, not a measure of real impact.'));
  for (const { t, n } of rows) {
    const pct = Math.round(100 * n / ps.length);
    box.append(h('div', { class: 'topic' },
      h('b', {}, t.label), ' ',
      (n === max && n > 0) ? h('span', { class: 'tag' }, 'Most mentioned here') : '',
      h('div', {}, h('small', {}, t.covers)),
      h('div', { class: 'barbox' }, h('div', { class: 'bar', style: `width:${Math.max(pct, 1)}%` })),
      h('small', {}, `${n} of ${ps.length} paragraphs (${pct}%)  `),
      h('button', { onclick: () => explainTopic(t, n, ps.length) }, 'Explain'),
      h('details', {}, h('summary', {}, 'Keywords counted'), h('small', {}, t.re.source))));
  }
  $('topicResult').replaceChildren();
}

async function explainTopic(t, n, total) {
  const m = current(), model = $('model').value, box = $('topicResult');
  const key = ['topic', m.id, t.id, model].join('|');
  let e = cache[key];
  if (!e) {
    box.textContent = 'Waiting for the model…';
    const prompt = `A voter wants to know what this California ballot measure means for one topic: "${t.label}" (${t.covers}).
Use ONLY the legal text below for "text_says". Text marked [DELETED: ...] is being removed from the law.
Return ONLY a JSON object, no markdown fences:
{"text_says":[{"point":"one plain English sentence","quote":"exact words copied from the legal text"}],
 "not_addressed":"one sentence on what the text does not say about this topic, or an empty string",
 "opinion":"under 80 words: your own view of whether this looks good, bad or mixed for this topic, and why. Do not tell the voter how to vote."}
Give at most 3 points. If the text says little about this topic, return an empty text_says array and say so in not_addressed.

${m.label} full legal text:
${m.fullText}`;
    try {
      const data = await askModel(prompt, model);
      e = { parsed: parseJSON(data.choices[0].message.content), model: data.model, cost: data.usage?.cost || 0 };
      cache[key] = e;
    } catch (err) { box.textContent = 'Error: ' + err.message + ' (try again if the JSON was broken)'; return; }
  }
  const p = e.parsed, src = norm(m.fullText);
  const points = (p.text_says || []).map((x) => h('div', {},
    h('p', {}, x.point),
    h('blockquote', {}, '“' + x.quote + '”'),
    src.includes(norm(x.quote || '')) ? h('small', { class: 'ok' }, '✓ quote found in the legal text') : h('small', { class: 'bad' }, '⚠ this quote was not found in the legal text')));
  box.replaceChildren(
    h('div', { class: 'ai' },
      h('div', {}, h('span', { class: 'tag' }, 'AI-GENERATED'), `${m.label} · ${t.label} · what the text says · ${e.model}`),
      h('small', {}, `Keyword count: ${n} of ${total} paragraphs`),
      points.length ? points : h('p', {}, 'The model found little in the text about this topic.'),
      p.not_addressed ? h('p', {}, h('b', {}, 'Not addressed in the text: '), p.not_addressed) : '',
      h('small', {}, `This call cost $${e.cost} · `, h('a', { href: m.sources.legalTextPdf, target: '_blank' }, 'Full legal text (PDF)'))),
    h('div', { class: 'opinion' },
      h('span', { class: 'tag op' }, 'AI OPINION'),
      h('p', {}, p.opinion || ''),
      h('small', {}, 'This is the AI\'s own opinion. It is not a fact, it is not in the law, and it may draw on knowledge from outside the text.')));
}

// ============ TAB 2: compare the two sides ============
const ARG_KEYS = { yes: ['argumentInFavor', 'rebuttalToAgainst'], no: ['argumentAgainst', 'rebuttalToFavor'] };
const DIMS = [
  ['what_it_does', 'What the measure does', 'what it requires, allows, changes or repeals'],
  ['money', 'Money and costs', 'who pays, how much is raised or spent, effects on budgets'],
  ['who_affected', 'Who is affected', 'who benefits, who is harmed, who gains or loses power'],
  ['risks', 'Risks and safeguards', 'claimed risks, loopholes, accountability, protections'],
];
const cmpMeasure = () => measures.find((x) => x.id === $('cmpMeasure').value);

// Signers and overlaps come straight from the data pack. No AI.
const ORG_STOP = new Set(['of', 'the', 'and', 'for', 'california', 'ca', 'association', 'assn', 'inc']);
const orgTokens = (o) => new Set(o.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !ORG_STOP.has(w)));
function orgMatch(a, b) {
  const A = orgTokens(a), B = orgTokens(b);
  if (!A.size || !B.size) return null;
  const inter = [...A].filter((x) => B.has(x)).length;
  const jac = inter / (A.size + B.size - inter);
  if (jac === 1) return 'same organization';
  if (jac >= 0.6) return 'possibly the same organization';
  return null;
}

function showCompareStatic() {
  const m = cmpMeasure(), a = m.arguments;
  $('cmpResult').replaceChildren();
  const signers = (side) => ARG_KEYS[side].flatMap((k) => a[k].signers.map((s) => ({ ...s, round: a[k].round })));
  const col = (side, title) => h('div', { class: 'side' },
    h('b', {}, title),
    ...ARG_KEYS[side].map((k) => h('div', {}, `${a[k].round === 'argument' ? 'Argument' : 'Rebuttal'} · ${a[k].wordCount} words` + (a[k].round === 'rebuttal' ? ' · answers the other side\'s argument' : ''))),
    h('hr'),
    ...signers(side).map((s) => h('div', {}, h('b', {}, s.name), `, ${s.title}`, s.organization ? ` — ${s.organization}` : '', h('br'), h('small', {}, `signed the ${s.round}`))));

  const findings = [];
  for (const y of signers('yes')) for (const n of signers('no')) {
    if (y.name === n.name) findings.push(`${y.name} signed for BOTH sides.`);
    if (y.organization && n.organization) {
      const r = orgMatch(y.organization, n.organization);
      if (r) findings.push(`${r}: "${y.organization}" (YES side) and "${n.organization}" (NO side).`);
    }
  }
  $('cmpWho').replaceChildren(
    h('h3', {}, 'Who wrote what, and who signed'),
    h('small', {}, 'Each side wrote one argument and one rebuttal. The rebuttal to the argument in favor is written by the NO side. From the printed pages, not AI.'),
    h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:8px' }, col('yes', 'Urges a YES vote'), col('no', 'Urges a NO vote')),
    findings.length
      ? h('div', { class: 'warn' }, h('b', {}, 'Overlap worth noting: '), findings.map((f) => h('div', {}, '⚠ ' + f)))
      : h('p', {}, 'No organization or person signed for both sides.'));
}
$('cmpMeasure').onchange = showCompareStatic;
$('cmpGo').onclick = runCompare;

function comparePrompt(m) {
  const a = m.arguments;
  return `You are extracting claims from the printed arguments on one California ballot measure.
Use ONLY the four documents below. Do NOT say which side is right. Do not add facts.

[YES-ARGUMENT] Argument in favor, written by the YES side:
${a.argumentInFavor.text}

[NO-REBUTTAL] Rebuttal to the argument in favor, written by the NO side:
${a.rebuttalToFavor.text}

[NO-ARGUMENT] Argument against, written by the NO side:
${a.argumentAgainst.text}

[YES-REBUTTAL] Rebuttal to the argument against, written by the YES side:
${a.rebuttalToAgainst.text}

For each of these four dimensions, report what BOTH sides said:
- what_it_does: what the measure requires, allows, changes or repeals
- money: who pays, how much is raised or spent, effects on budgets
- who_affected: who benefits, who is harmed, who gains or loses power
- risks: claimed risks, loopholes, accountability, protections

For each side ("yes" = urges a YES vote, "no" = urges a NO vote) give:
- "claim": one sentence in your own words, or null if that side never raised this dimension
- "quote": exact words copied from that side's own documents (under 25 words), or null
- "raised_in": "argument" if raised in that side's main argument; "rebuttal" if it appears ONLY in that side's rebuttal; "not_raised" if never raised
- "other_side_response": "disputed" if the OTHER side's rebuttal directly responds to this claim; "not_addressed" if it does not; "not_applicable" if raised_in is "rebuttal" or "not_raised". Only the NO side's rebuttal can answer the YES argument, and only the YES side's rebuttal can answer the NO argument.
- "response_quote": exact words from the other side's rebuttal that respond, or null

Return ONLY JSON, no markdown fences:
{"dimensions":{"what_it_does":{"yes":{...},"no":{...}},"money":{"yes":{...},"no":{...}},"who_affected":{"yes":{...},"no":{...}},"risks":{"yes":{...},"no":{...}}}}`;
}

async function runCompare() {
  const m = cmpMeasure(), model = $('model').value, out = $('cmpResult');
  const key = ['cmp', m.id, model].join('|');
  let e = cache[key];
  if (!e) {
    out.textContent = 'Waiting for the model… (one call, structured JSON)';
    $('cmpGo').disabled = true;
    try {
      const data = await askModel(comparePrompt(m), model);
      const raw = data.choices[0].message.content;
      const parsed = parseJSON(raw);
      if (!parsed.dimensions) throw new Error('The JSON had no "dimensions" key');
      e = { parsed, raw, model: data.model, cost: data.usage?.cost || 0 };
      cache[key] = e;
    } catch (err) {
      out.textContent = 'Error: ' + err.message + ' (the model may have returned broken JSON; try again)';
      $('cmpGo').disabled = false;
      return;
    }
    $('cmpGo').disabled = false;
  }
  renderCompare(m, e);
}

function renderCompare(m, e) {
  const a = m.arguments;
  const own = (side) => ARG_KEYS[side].map((k) => a[k].text).join('\n');
  const rebuttalOf = (side) => a[side === 'yes' ? 'rebuttalToAgainst' : 'rebuttalToFavor'].text;
  const other = { yes: 'no', no: 'yes' };

  const cell = (side, d) => {
    if (!d || !d.claim || d.raised_in === 'not_raised') return h('td', { class: 'empty' }, 'This side did not raise this point.');
    const parts = [h('div', {}, h('span', { class: 'tag' }, 'AI-generated wording')), h('p', {}, d.claim)];
    if (d.quote) {
      parts.push(h('blockquote', {}, '“' + d.quote + '”'),
        norm(own(side)).includes(norm(d.quote)) ? h('small', { class: 'ok' }, '✓ quote found in the printed text') : h('div', { class: 'bad' }, '⚠ The quote the model gave was not found in the printed text.'));
    }
    if (d.raised_in === 'rebuttal') {
      parts.push(h('p', { class: 'warn' }, 'First raised in a rebuttal, so the other side never got to respond.'));
    } else if (d.other_side_response === 'disputed') {
      const rq = d.response_quote;
      parts.push(h('p', { class: 'warn' }, 'Disputed in the other side\'s rebuttal.'));
      if (rq) parts.push(h('blockquote', {}, '“' + rq + '”'),
        norm(rebuttalOf(other[side])).includes(norm(rq)) ? h('small', { class: 'ok' }, '✓ response quote found') : h('div', { class: 'bad' }, '⚠ response quote not found in the rebuttal'));
    } else {
      parts.push(h('p', { class: 'warn' }, 'The other side\'s rebuttal did not address this point.'));
    }
    parts.push(h('a', { href: m.sources.argumentsPage, target: '_blank' }, 'Original text ↗'));
    return h('td', {}, parts);
  };

  const table = h('table', { class: 'cmp' },
    h('tr', {}, h('th', {}, 'Dimension'), h('th', {}, 'Urges YES'), h('th', {}, 'Urges NO')),
    ...DIMS.map(([k, name, desc]) => {
      const d = e.parsed.dimensions[k] || {};
      return h('tr', {}, h('td', {}, h('b', {}, name), h('br'), h('small', {}, desc)), cell('yes', d.yes), cell('no', d.no));
    }));

  $('cmpResult').replaceChildren(
    h('h3', {}, 'What each side claims'),
    h('div', { class: 'warn' }, pack.meta.argumentDisclaimer + ' This app does not say which side is right.'),
    table,
    h('small', {}, `Claims extracted by ${e.model} as JSON, parsed by this page · this call cost $${e.cost}`),
    h('details', {}, h('summary', {}, 'Raw JSON the model returned'), h('pre', { class: 'body' }, e.raw)));
}

// ============ TAB 3: down-ballot offices ============
const SCENES = {
  'berkeley-rent-board': [
    'a renter and a repair person looking at a water stain on the ceiling of a Berkeley apartment',
    'a family carrying boxes into an older Berkeley apartment building',
    'a renter at a kitchen table reading a lease and a rent notice with a cup of tea',
    'neighbors chatting on the porches of a row of Berkeley bungalows',
    'a quiet Berkeley street of apartment buildings at dusk with lit windows',
    'ordinary residents seated in a circle at a community meeting room',
  ],
  'ac-transit-ward-1': [
    'a bus pulling up to a tree-lined East Bay bus stop as riders wait',
    'a student with a backpack stepping onto a city bus',
    'the inside of a bus on a sunny morning with riders reading and chatting',
    'a bicycle loaded on the front rack of a bus',
    'riders waiting under a bus shelter at dusk',
    'a bus passing a brick campus building on a leafy street',
  ],
  'bart-director': [
    'a rapid-transit train arriving at an elevated Bay Area station platform',
    'a commuter tapping a fare card at a station gate',
    'rush-hour commuters riding an escalator down into a station',
    'a train crossing a hillside in the East Bay at sunset',
    'a family with a stroller boarding a train',
    'an empty, well-lit station platform late at night',
  ],
  'ebmud-director': [
    'a glass being filled from a kitchen faucet in morning light',
    'a calm reservoir surrounded by rolling East Bay hills',
    'a water treatment plant with clean round tanks at sunrise',
    'a backyard garden being watered with a drip hose',
    'a low reservoir and dry hills during a drought',
    'a utility crew repairing a water pipe in a residential street',
  ],
  'peralta-ccd-trustee': [
    'students studying together in a bright community college library',
    'adult learners in an evening classroom',
    'a student working at a bench in a science lab',
    'students talking on a campus lawn near a modern building',
    'an instructor helping a student in an art or ceramics studio',
    'a student with a backpack walking to class on an urban East Bay campus',
  ],
};
const images = {};
const curOffice = () => offices.find((x) => x.id === $('office').value);

function imagePrompt(o) {
  const list = SCENES[o.id].map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `Friendly editorial illustration, warm natural light, soft colors, slightly stylized, 3:2 landscape.
Subject: something the "${o.name}" (${o.jurisdiction}) could affect in everyday life, set in the Berkeley / East Bay area of California.
Choose ONE of these scenes at random and draw only that scene:
${list}
Rules: any people are invented ordinary residents of varied ages and backgrounds, shown at a distance with no close-up portraits, and none is recognizable as a real person. No candidates and no politicians. No text, no words, no logos, no signs, no flags, no ballots, no voting imagery, and nothing that could be mistaken for official election material.`;
}

function showOffice() {
  const o = curOffice();
  $('officeFacts').replaceChildren(h('div', { class: 'official' },
    h('span', { class: 'tag off' }, 'FROM THE DATA PACK'), ' not generated',
    h('p', {}, o.description),
    h('small', {}, 'Jurisdiction: ' + o.jurisdiction),
    ...(o.additionalContext || []).map((c) => h('div', {}, '• ' + c.fact + (c.kind === 'boundary' ? ' (boundary)' : '')))));
  $('offText').replaceChildren();
  $('offImg').replaceChildren();
  renderGallery(o);
}
$('office').onchange = showOffice;
$('offExplain').onclick = explainOffice;
$('offImage').onclick = makeImage;

async function explainOffice() {
  const o = curOffice(), model = $('model').value, out = $('offText');
  const key = ['off', o.id, model].join('|');
  let e = cache[key];
  if (!e) {
    out.textContent = 'Waiting for the model…';
    const extra = (o.additionalContext || []).map((c) => `- ${c.fact}${c.kind === 'boundary' ? ' [BOUNDARY]' : ''}`).join('\n') || '(none)';
    const prompt = `You are explaining a down-ballot office to a voter. Use ONLY the facts below. Do not add facts from memory.

Office: ${o.name}
Jurisdiction: ${o.jurisdiction}
What it decides (from the data pack): ${o.description}
Additional facts:
${extra}

Return ONLY JSON, no markdown fences:
{"title":"short friendly headline","intro":"two sentences in plain English, about grade 7 to 9","decides":["short items taken only from the facts above"],"does_not_control":["items"],"why_it_matters":"one sentence"}

Rules for "does_not_control": only include items directly supported by a fact marked [BOUNDARY], or by the limits of the stated jurisdiction. If there are none, return an empty array. Never guess what the office cannot do.`;
    try {
      const t0 = performance.now();
      const data = await askModel(prompt, model);
      e = { parsed: parseJSON(data.choices[0].message.content), model: data.model, cost: data.usage?.cost || 0, secs: ((performance.now() - t0) / 1000).toFixed(1) };
      cache[key] = e;
    } catch (err) { out.textContent = 'Error: ' + err.message; return; }
  }
  const p = e.parsed;
  out.replaceChildren(h('div', { class: 'ai' },
    h('div', {}, h('span', { class: 'tag' }, 'AI-GENERATED'), `Explainer: ${o.name} · from the data pack facts above · ${e.model}`),
    h('h3', {}, p.title || o.name),
    h('p', {}, p.intro || ''),
    h('b', {}, 'What it decides'),
    h('ul', {}, (p.decides || []).map((x) => h('li', {}, x))),
    h('b', {}, 'What it does NOT control'),
    (p.does_not_control && p.does_not_control.length)
      ? h('ul', {}, p.does_not_control.map((x) => h('li', {}, x)))
      : h('p', { class: 'warn' }, 'The data pack does not say what this office does not control, so this app will not guess.'),
    h('b', {}, 'Why it matters'),
    h('p', {}, p.why_it_matters || ''),
    h('small', {}, `Took ${e.secs}s · this call cost $${e.cost} · Machine-written. It can be wrong. Nothing here is official.`)));
}

async function makeImage() {
  const o = curOffice(), box = $('offImg');
  const prompt = imagePrompt(o);
  $('offImage').disabled = true;
  box.textContent = 'Drawing… (this can take 10-20 seconds, about $0.04)';
  try {
    const data = await askImage(prompt);
    const im = data.data[0];
    const src = `data:${im.media_type || 'image/png'};base64,${im.b64_json}`;
    (images[o.id] = images[o.id] || []).push({ src, prompt, cost: data.usage?.cost || 0 });
    showImage(o, images[o.id].length - 1);
    renderGallery(o);
  } catch (err) { box.textContent = 'Error: ' + err.message; }
  $('offImage').disabled = false;
}

function showImage(o, i) {
  const im = images[o.id][i];
  $('offImg').replaceChildren(h('div', { class: 'ai' },
    h('div', {}, h('span', { class: 'tag' }, 'AI-GENERATED IMAGE'), `${o.name} · ${IMAGE_MODEL}`),
    h('img', { class: 'ill', src: im.src, alt: 'AI-generated illustration for the ' + o.name }),
    h('small', {}, `The AI chose one of ${SCENES[o.id].length} scenes; the image API does not say which. Invented scene, no real people. This call cost $${im.cost}. `),
    h('a', { href: im.src, download: o.id + '.png' }, 'Download'),
    h('details', {}, h('summary', {}, 'Show the image prompt'), h('pre', { class: 'body' }, im.prompt))));
}

function renderGallery(o) {
  $('gallery').replaceChildren(...(images[o.id] || []).map((im, i) => h('img', { src: im.src, onclick: () => showImage(o, i), alt: 'earlier illustration' })));
}