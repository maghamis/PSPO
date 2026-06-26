const { lessons: baseLessons, flashcards: baseFlashcards, questions: baseQuestions } = window.STUDY_DATA;
const guideSections = window.SCRUM_GUIDE?.sections || [];
const guideMeta = window.SCRUM_GUIDE?.meta || {};
let lastGuideSelection = '';
let lastGuideSection = 'Scrum Guide';
const STORAGE_KEY = 'pspo-study-coach-state-v1';
const EXAM_QUESTION_COUNT = 80;
const EXAM_DURATION_SEC = 60 * 60;
const PASS_MARK = 85;
const LOCAL_BANK_NAME = 'Built-in original PSPO I question bank';

const scrumChartGroups = [
  { title: 'Scrum Definition', className: 'definition', items: ['Scrum is a lightweight framework', 'Generate value', 'Adaptive solutions', 'Complex problems'] },
  { title: 'Scrum Team', className: 'team', items: ['Developers', 'Product Owner', 'Scrum Master'] },
  { title: 'Scrum Artifacts', className: 'artifacts', items: ['Product Backlog', 'Sprint Backlog', 'Increment'] },
  { title: 'Scrum Events', className: 'events', items: ['The Sprint', 'Sprint Planning', 'Daily Scrum', 'Sprint Review', 'Sprint Retrospective'] },
  { title: 'Scrum Theory', className: 'theory', items: ['Transparency', 'Inspection', 'Adaptation'] },
  { title: 'Scrum Values', className: 'values', items: ['Commitment', 'Focus', 'Openness', 'Respect', 'Courage'] }
];

const app = document.getElementById('app');
const tabs = Array.from(document.querySelectorAll('.tab'));
let deferredInstallPrompt = null;
let timerHandle = null;

const defaultState = () => ({
  completedLessons: {},
  cardProgress: {},
  quizAttempts: [],
  examAttempts: [],
  mistakes: [],
  studyLater: [],
  guideHighlights: [],
  customFlashcards: [],
  customLessons: [],
  questionProgress: {},
  activeQuiz: null,
  activeExam: null,
  currentRoute: 'dashboard'
});

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultState(), ...JSON.parse(raw) } : defaultState();
  } catch (err) {
    console.warn('Could not load state', err);
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
}

function pct(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sampleQuestions(pool, count) {
  const chosen = [];
  while (chosen.length < count) chosen.push(...shuffle(pool));
  return chosen.slice(0, count).map((q, idx) => ({ ...q, sessionId: `${q.id}-${idx}` }));
}


function normalizeQuestionText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function questionKey(q) {
  return normalizeQuestionText(q.prompt) + '|' + (q.options || []).map(normalizeQuestionText).join('|');
}

function dedupeQuestionList(list) {
  const seen = new Set();
  const unique = [];
  list.forEach(q => {
    if (!q || !q.prompt || !Array.isArray(q.options) || !Array.isArray(q.answer)) return;
    const key = questionKey(q);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(q);
  });
  return unique;
}

function questionBank() {
  return dedupeQuestionList([...(baseQuestions || [])]);
}

function questionBankStats() {
  const bank = questionBank();
  const progress = state.questionProgress || {};
  const bankProgress = bank.map(q => progress[q.id]).filter(Boolean);
  const seen = bankProgress.filter(p => (p.seenCount || 0) > 0).length;
  const answered = bankProgress.filter(p => (p.answeredCount || 0) > 0).length;
  const mastered = bankProgress.filter(p => (p.correctCount || 0) > 0 && (p.wrongCount || 0) === 0).length;
  const totalAnswered = bankProgress.reduce((sum, p) => sum + (p.answeredCount || 0), 0);
  const totalCorrect = bankProgress.reduce((sum, p) => sum + (p.correctCount || 0), 0);
  const coreTotal = bank.filter(q => !q.source).length;
  const expandedTotal = bank.filter(q => q.source === 'expanded-original').length;
  const sampleTotal = bank.filter(q => q.source === 'uploaded-sample-exam').length;
  return {
    total: bank.length,
    coreTotal,
    expandedTotal,
    sampleTotal,
    seen,
    unseen: Math.max(0, bank.length - seen),
    answered,
    mastered,
    seenPct: pct(seen, bank.length),
    accuracy: totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : null,
    totalAnswered,
    totalCorrect
  };
}

function bankStatusText(stats) {
  return `Built-in local bank: ${stats.coreTotal} core + ${stats.expandedTotal} expanded original + ${stats.sampleTotal} uploaded sample questions`;
}

function markQuestionSeen(q, kind, session) {
  if (!q || !session) return;
  session.seenSessionIds = session.seenSessionIds || {};
  const marker = q.sessionId || `${q.id}-${session.index}`;
  if (session.seenSessionIds[marker]) return;
  session.seenSessionIds[marker] = true;
  state.questionProgress = state.questionProgress || {};
  const existing = state.questionProgress[q.id] || {
    id: q.id,
    topic: q.topic,
    source: q.source || 'built-in',
    prompt: q.prompt,
    seenCount: 0,
    answeredCount: 0,
    correctCount: 0,
    wrongCount: 0,
    firstSeenAt: Date.now()
  };
  existing.topic = q.topic;
  existing.source = q.source || 'built-in';
  existing.prompt = q.prompt;
  existing.seenCount = (existing.seenCount || 0) + 1;
  existing.lastSeenAt = Date.now();
  existing.lastMode = kind;
  state.questionProgress[q.id] = existing;
}

function recordQuestionAnswer(q, selected, correct, kind) {
  if (!q) return;
  state.questionProgress = state.questionProgress || {};
  const existing = state.questionProgress[q.id] || {
    id: q.id,
    topic: q.topic,
    source: q.source || 'built-in',
    prompt: q.prompt,
    seenCount: 0,
    answeredCount: 0,
    correctCount: 0,
    wrongCount: 0,
    firstSeenAt: Date.now()
  };
  existing.topic = q.topic;
  existing.source = q.source || 'built-in';
  existing.prompt = q.prompt;
  existing.answeredCount = (existing.answeredCount || 0) + 1;
  if (correct) existing.correctCount = (existing.correctCount || 0) + 1;
  else existing.wrongCount = (existing.wrongCount || 0) + 1;
  existing.lastAnsweredAt = Date.now();
  existing.lastCorrect = !!correct;
  existing.lastSelected = selected;
  existing.lastMode = kind;
  state.questionProgress[q.id] = existing;
}

function uniqueTopics() {
  return [...new Set(questionBank().map(q => q.topic))].sort();
}

function arraysEqual(a, b) {
  const aa = [...a].map(Number).sort((x, y) => x - y);
  const bb = [...b].map(Number).sort((x, y) => x - y);
  return aa.length === bb.length && aa.every((v, i) => v === bb[i]);
}

function formatDate(ts) {
  return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function getScore(attempt) {
  return Math.round((attempt.correct / attempt.total) * 100);
}

function setRoute(route) {
  state.currentRoute = route;
  saveState();
  tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.route === route));
  clearInterval(timerHandle);
  timerHandle = null;
  render();
  app.focus({ preventScroll: true });
}

tabs.forEach(tab => tab.addEventListener('click', () => setRoute(tab.dataset.route)));

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  document.getElementById('installBtn').classList.remove('hidden');
});

document.getElementById('installBtn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('installBtn').classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
}

function render() {
  const route = state.currentRoute || 'dashboard';
  if (route === 'dashboard') renderDashboard();
  if (route === 'chart') renderScrumChart();
  if (route === 'guide') renderGuide();
  if (route === 'learn') renderLearn();
  if (route === 'study') renderStudyLater();
  if (route === 'flashcards') renderFlashcards();
  if (route === 'quiz') renderQuiz();
  if (route === 'exam') renderExam();
  if (route === 'review') renderReview();
}

function renderDashboard() {
  const lessonTotal = allLessons().length;
  const completed = Object.keys(state.completedLessons).filter(id => allLessons().some(l => l.id === id)).length;
  const cardStats = getCardStats();
  const quizBest = bestScore(state.quizAttempts);
  const examBest = bestScore(state.examAttempts);
  const weakTopics = topicMistakes().slice(0, 5);
  const lastExam = state.examAttempts.at(-1);
  const lessonPct = pct(completed, lessonTotal);
  const bank = questionBank();
  const bankStats = questionBankStats();
  const bankStatus = bankStatusText(bankStats);

  app.innerHTML = `
    <section class="grid two">
      <div class="card">
        <h2>Study progress</h2>
        <p>Use this as your daily command center. The app stores everything locally on this device.</p>
        <div class="progress-wrap"><div class="progress-bar" style="width:${lessonPct}%"></div></div>
        <p><strong>${lessonPct}%</strong> of lessons completed</p>
        <div class="button-row">
          <button class="primary-btn" data-action="go" data-route="learn">Continue learning</button>
          <button class="secondary-btn" data-action="go" data-route="quiz">Start quiz</button>
        </div>
      </div>
      <div class="card">
        <h2>Install + backup</h2>
        <p>After hosting this folder online, open the URL in Safari, tap <span class="kbd">Share</span>, then <span class="kbd">Add to Home Screen</span>. Your progress still stays in this device/browser unless you export and import it.</p>
        <div class="pill-row">
          <span class="pill">Offline cache ready</span>
          <span class="pill">Local progress</span>
          <span class="pill">Manual backup</span>
        </div>
        <div class="button-row">
          <button class="secondary-btn" data-action="export-data" type="button">Export data</button>
          <button class="secondary-btn" data-action="import-data" type="button">Import data</button>
        </div>
      </div>
      <div class="card">
        <h2>Question bank</h2>
        <p>The question bank is fully built into this app. It now includes the uploaded sample-exam questions you provided. Nothing is imported from the internet. Quiz and Exam shuffle the local bank before selecting questions.</p>
        <div class="pill-row">
          <span class="pill">${bankStats.total} unique total</span>
          <span class="pill">${bankStats.coreTotal} core</span>
          <span class="pill">${bankStats.expandedTotal} expanded</span>
          <span class="pill">${bankStats.sampleTotal} sample exam</span>
          <span class="pill">${bankStats.seen} seen</span>
        </div>
        <div class="progress-wrap"><div class="progress-bar" style="width:${bankStats.seenPct}%"></div></div>
        <p><strong>${bankStats.seenPct}%</strong> of the question bank seen · ${bankStats.unseen} unseen</p>
        <p class="small-note">${esc(bankStatus)} · No external question import.</p>
      </div>
    </section>

    <section class="grid three" style="margin-top:16px">
      ${metricCard('Lessons done', `${completed}/${lessonTotal}`, 'Read and mark complete')}
      ${metricCard('Cards due', cardStats.due, 'Spaced review due now')}
      ${metricCard('Cards mastered', cardStats.mastered, 'Cards answered correctly 3+ times')}
      ${metricCard('Best quiz', quizBest === null ? '—' : quizBest + '%', 'Practice mode')}
      ${metricCard('Best exam', examBest === null ? '—' : examBest + '%', '80 questions / 60 minutes')}
      ${metricCard('Mistakes saved', state.mistakes.length, 'Use Review tab')}
      ${metricCard('Study later', (state.studyLater || []).length, 'Saved Scrum Guide selections')}
      ${metricCard('Q bank seen', `${bankStats.seen}/${bankStats.total}`, `${bankStats.seenPct}% coverage`)}
      ${metricCard('Q bank answered', bankStats.answered, bankStats.accuracy === null ? 'No answers yet' : `${bankStats.accuracy}% answer accuracy`)}
    </section>

    <section class="grid two" style="margin-top:16px">
      <div class="card">
        <h2>Weak topics</h2>
        ${weakTopics.length ? weakTopics.map(t => `
          <div class="soft-card" style="margin-top:10px">
            <div class="pill-row" style="justify-content:space-between">
              <strong>${esc(t.topic)}</strong><span class="pill danger">${t.count} missed</span>
            </div>
            <div class="progress-wrap"><div class="progress-bar" style="width:${Math.min(100, t.count * 18)}%"></div></div>
          </div>`).join('') : '<p>No weak topics yet. Take a quiz to generate diagnostics.</p>'}
      </div>
      <div class="card">
        <h2>Exam readiness</h2>
        <p>${lastExam ? `Last exam simulator score: <strong>${getScore(lastExam)}%</strong> on ${formatDate(lastExam.date)}.` : 'Take the exam simulator when you can consistently score high in practice quizzes.'}</p>
        <div class="pill-row">
          <span class="pill">Target: ${PASS_MARK}%+</span>
          <span class="pill">${EXAM_QUESTION_COUNT} questions</span>
          <span class="pill">60 min</span>
        </div>
        <div class="button-row">
          <button class="primary-btn" data-action="go" data-route="exam">Open exam simulator</button>
        </div>
      </div>
    </section>
  `;
  bindCommonActions();
}


function renderScrumChart() {
  app.innerHTML = `
    <section class="card scrum-chart-card">
      <div class="scrum-chart-stripes" aria-hidden="true">
        ${scrumChartGroups.map(g => `<span class="scrum-stripe ${esc(g.className)}"></span>`).join('')}
      </div>
      <div class="scrum-chart-head">
        <div>
          <p class="eyebrow">Visual map</p>
          <h2>The Scrum Guide</h2>
          <p>Use this quick chart to memorize the main Scrum structure before reading the full Guide.</p>
        </div>
        <div class="pill-row">
          <span class="pill">6 focus areas</span>
          <span class="pill">Exam quick review</span>
        </div>
      </div>
      <div class="scrum-chart-grid" role="list">
        ${scrumChartGroups.map(group => `
          <article class="scrum-chart-column ${esc(group.className)}" role="listitem">
            <div class="scrum-chart-title">${esc(group.title)}</div>
            <div class="scrum-chart-items">
              ${group.items.map(item => `<div class="scrum-chart-item">${esc(item)}</div>`).join('')}
            </div>
          </article>
        `).join('')}
      </div>
      <div class="button-row">
        <button class="primary-btn" data-action="go" data-route="guide">Open Scrum Guide</button>
        <button class="secondary-btn" data-action="go" data-route="learn">Open Learn tab</button>
      </div>
    </section>`;
  bindCommonActions();
}

function metricCard(label, value, hint) {
  return `<div class="card compact metric"><strong>${esc(value)}</strong><span>${esc(label)}</span><p style="margin:4px 0 0">${esc(hint)}</p></div>`;
}

function bestScore(attempts) {
  if (!attempts.length) return null;
  return Math.max(...attempts.map(getScore));
}

function getCardStats() {
  const now = Date.now();
  let due = 0, mastered = 0;
  allFlashcards().forEach(card => {
    const p = state.cardProgress[card.id] || {};
    if (!p.due || p.due <= now) due += 1;
    if ((p.correct || 0) >= 3) mastered += 1;
  });
  return { due, mastered };
}

function topicMistakes() {
  const counts = {};
  state.mistakes.forEach(m => { counts[m.topic] = (counts[m.topic] || 0) + 1; });
  return Object.entries(counts).map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count);
}


function allLessons() {
  return [...baseLessons, ...(state.customLessons || [])];
}

function allFlashcards() {
  return [...baseFlashcards, ...(state.customFlashcards || [])];
}

function topicOptionsFrom(items, fallback = []) {
  return [...new Set([...items.map(i => i.topic).filter(Boolean), ...fallback])].sort();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function renderLearn() {
  const lessonItems = allLessons();
  const topics = topicOptionsFrom(lessonItems, ['Custom']);
  app.innerHTML = `
    <section class="card">
      <h2>Learn Scrum for PSPO I</h2>
      <p>Read each short lesson, then mark it complete. You can also add your own notes/lessons and keep them in the same progress tracker.</p>
      <div class="form-row">
        <div class="field"><label>Search</label><input id="lessonSearch" type="search" placeholder="Search Product Owner, Sprint Goal..." /></div>
        <div class="field"><label>Topic</label><select id="lessonTopic"><option value="all">All topics</option>${topics.map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
        <div class="field"><label>Progress</label><select id="lessonStatus"><option value="all">All</option><option value="open">Not completed</option><option value="done">Completed</option></select></div>
      </div>
      <details class="inline-editor">
        <summary>Add my own lesson / note</summary>
        <div class="form-row custom-form two-cols">
          <div class="field"><label>Title</label><input id="customLessonTitle" type="text" placeholder="Example: Product Owner vs Scrum Master" /></div>
          <div class="field"><label>Topic</label><input id="customLessonTopic" type="text" placeholder="Custom" value="Custom" /></div>
        </div>
        <div class="field"><label>Lesson body</label><textarea id="customLessonBody" rows="5" placeholder="Write your own notes. Each line can become a bullet/detail."></textarea></div>
        <div class="button-row"><button class="primary-btn" id="addCustomLesson" type="button">Add lesson</button></div>
      </details>
    </section>
    <section id="lessonList" class="lesson-list" style="margin-top:16px"></section>
  `;
  const search = document.getElementById('lessonSearch');
  const topic = document.getElementById('lessonTopic');
  const status = document.getElementById('lessonStatus');
  const update = () => drawLessons(search.value, topic.value, status.value);
  [search, topic, status].forEach(el => el.addEventListener('input', update));
  document.getElementById('addCustomLesson').addEventListener('click', () => {
    const title = normalizeText(document.getElementById('customLessonTitle').value);
    const topicValue = normalizeText(document.getElementById('customLessonTopic').value) || 'Custom';
    const body = document.getElementById('customLessonBody').value.trim();
    if (!title || !body) return alert('Add a title and lesson body first.');
    const details = body.split(/\n+/).map(normalizeText).filter(Boolean);
    state.customLessons = state.customLessons || [];
    state.customLessons.unshift({
      id: makeId('custom-lesson'),
      topic: topicValue,
      title,
      summary: details[0] || body,
      details: details.slice(1).length ? details.slice(1) : [body]
    });
    saveState();
    renderLearn();
  });
  update();
}

function drawLessons(query = '', topic = 'all', status = 'all') {
  const q = query.toLowerCase();
  const list = document.getElementById('lessonList');
  const filtered = allLessons().filter(l => {
    const text = `${l.title} ${l.topic} ${l.summary} ${(l.details || []).join(' ')}`.toLowerCase();
    const statusOk = status === 'all' || (status === 'done') === !!state.completedLessons[l.id];
    return text.includes(q) && (topic === 'all' || l.topic === topic) && statusOk;
  });
  list.innerHTML = filtered.length ? filtered.map((l, index) => {
    const isCustom = String(l.id).startsWith('custom-lesson') || String(l.id).startsWith('study-lesson');
    return `
    <article class="lesson-item">
      <div class="lesson-number">${index + 1}</div>
      <div class="lesson-body">
        <div class="pill-row"><span class="pill">${esc(l.topic)}</span>${state.completedLessons[l.id] ? '<span class="pill">Done</span>' : ''}${isCustom ? '<span class="pill">My lesson</span>' : ''}</div>
        <h3 style="margin-top:10px">${esc(l.title)}</h3>
        <p>${esc(l.summary)}</p>
        <ul class="details">${(l.details || []).map(d => `<li>${esc(d)}</li>`).join('')}</ul>
        ${isCustom ? `<button class="danger-link" data-delete-lesson="${esc(l.id)}" type="button">Delete my lesson</button>` : ''}
      </div>
      <button class="check-btn ${state.completedLessons[l.id] ? 'done' : ''}" data-lesson="${esc(l.id)}" title="Toggle complete">${state.completedLessons[l.id] ? '✓' : '+'}</button>
    </article>`;
  }).join('') : `<section class="card center"><h2>No lessons found</h2><p>Try a different search or filter.</p></section>`;
  list.querySelectorAll('[data-lesson]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.lesson;
    if (state.completedLessons[id]) delete state.completedLessons[id];
    else state.completedLessons[id] = Date.now();
    saveState();
    drawLessons(document.getElementById('lessonSearch').value, document.getElementById('lessonTopic').value, document.getElementById('lessonStatus').value);
  }));
  list.querySelectorAll('[data-delete-lesson]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Delete this custom lesson?')) return;
    const id = btn.dataset.deleteLesson;
    state.customLessons = (state.customLessons || []).filter(l => l.id !== id);
    delete state.completedLessons[id];
    saveState();
    drawLessons(document.getElementById('lessonSearch').value, document.getElementById('lessonTopic').value, document.getElementById('lessonStatus').value);
  }));
}

function renderFlashcards() {
  const now = Date.now();
  const deck = allFlashcards();
  const due = deck.filter(card => {
    const p = state.cardProgress[card.id] || {};
    return !p.due || p.due <= now;
  });
  const activeCard = due[0];
  const stats = getCardStats();
  const addCardForm = `
    <section class="card">
      <div class="pill-row" style="justify-content:space-between">
        <div class="pill-row"><span class="pill">Deck: ${deck.length}</span><span class="pill">Due: ${due.length}</span><span class="pill">Mastered: ${stats.mastered}</span></div>
        <button class="danger-btn" id="resetCards" type="button">Reset deck</button>
      </div>
      <details class="inline-editor">
        <summary>Add my own flashcard</summary>
        <div class="form-row custom-form two-cols">
          <div class="field"><label>Topic</label><input id="customCardTopic" type="text" placeholder="Product Owner" value="Custom" /></div>
          <div class="field"><label>Front / question</label><input id="customCardFront" type="text" placeholder="What is the PO accountable for?" /></div>
        </div>
        <div class="field"><label>Back / answer</label><textarea id="customCardBack" rows="4" placeholder="Write the answer you want to memorize."></textarea></div>
        <div class="button-row"><button class="primary-btn" id="addCustomCard" type="button">Add card</button><button class="secondary-btn" id="showMyCards" type="button">Show my cards</button></div>
      </details>
      <section id="myCardsList" class="mini-list hidden"></section>
    </section>`;

  if (!activeCard) {
    app.innerHTML = addCardForm + `
      <section class="card center empty-state" style="margin-top:16px">
        <div class="empty-icon">✓</div>
        <h2>No cards due right now</h2>
        <p>You have ${stats.mastered} mastered cards. Reset the deck if you want to practice again today.</p>
      </section>`;
    bindCardFormEvents();
    return;
  }
  const progress = state.cardProgress[activeCard.id] || {};
  app.innerHTML = addCardForm + `
    <section class="flashcard" id="flashcard" style="margin-top:16px">
      <div class="flashcard-inner">
        <div class="flash-face flash-front">
          <p class="eyebrow">Question · ${esc(activeCard.topic)}</p>
          <h2>${esc(activeCard.front)}</h2>
          <p>Tap the card or use the button to reveal the answer.</p>
        </div>
        <div class="flash-face flash-back">
          <p class="eyebrow">Answer</p>
          <h2>${esc(activeCard.back)}</h2>
          <p>Correct: ${progress.correct || 0} · Again: ${progress.wrong || 0}</p>
        </div>
      </div>
    </section>
    <div class="button-row">
      <button class="secondary-btn" id="flipCard">Flip</button>
      <button class="danger-btn" id="againCard">Again</button>
      <button class="primary-btn" id="gotCard">Got it</button>
    </div>
  `;
  bindCardFormEvents();
  const cardEl = document.getElementById('flashcard');
  const flip = () => cardEl.classList.toggle('flipped');
  cardEl.addEventListener('click', flip);
  document.getElementById('flipCard').addEventListener('click', flip);
  document.getElementById('againCard').addEventListener('click', () => updateCard(activeCard.id, false));
  document.getElementById('gotCard').addEventListener('click', () => updateCard(activeCard.id, true));
}

function bindCardFormEvents() {
  const reset = document.getElementById('resetCards');
  if (reset) reset.addEventListener('click', () => {
    if (!confirm('Reset all flashcard progress?')) return;
    state.cardProgress = {};
    saveState();
    renderFlashcards();
  });
  const add = document.getElementById('addCustomCard');
  if (add) add.addEventListener('click', () => {
    const topic = normalizeText(document.getElementById('customCardTopic').value) || 'Custom';
    const front = normalizeText(document.getElementById('customCardFront').value);
    const back = document.getElementById('customCardBack').value.trim();
    if (!front || !back) return alert('Add a front and back first.');
    state.customFlashcards = state.customFlashcards || [];
    state.customFlashcards.unshift({ id: makeId('custom-card'), topic, front, back });
    saveState();
    renderFlashcards();
  });
  const show = document.getElementById('showMyCards');
  if (show) show.addEventListener('click', () => {
    const box = document.getElementById('myCardsList');
    if (!box) return;
    box.classList.toggle('hidden');
    const myCards = state.customFlashcards || [];
    box.innerHTML = myCards.length ? myCards.map(c => `
      <article class="soft-card mini-item">
        <div><span class="pill">${esc(c.topic)}</span><h3>${esc(c.front)}</h3><p>${esc(c.back)}</p></div>
        <button class="danger-link" data-delete-card="${esc(c.id)}" type="button">Delete</button>
      </article>`).join('') : '<p>No custom cards yet.</p>';
    box.querySelectorAll('[data-delete-card]').forEach(btn => btn.addEventListener('click', () => {
      if (!confirm('Delete this custom card?')) return;
      const id = btn.dataset.deleteCard;
      state.customFlashcards = (state.customFlashcards || []).filter(c => c.id !== id);
      delete state.cardProgress[id];
      saveState();
      renderFlashcards();
    }));
  });
}

function updateCard(id, correct) {
  const p = state.cardProgress[id] || { correct: 0, wrong: 0, interval: 0 };
  if (correct) {
    p.correct = (p.correct || 0) + 1;
    p.interval = Math.min((p.interval || 0) + 1, 4);
    const days = [1, 3, 7, 14][p.interval - 1] || 14;
    p.due = Date.now() + days * 24 * 60 * 60 * 1000;
  } else {
    p.wrong = (p.wrong || 0) + 1;
    p.interval = 0;
    p.due = Date.now();
  }
  state.cardProgress[id] = p;
  saveState();
  renderFlashcards();
}

function renderQuiz() {
  if (state.activeQuiz) return renderQuestionSession('quiz');
  const topics = uniqueTopics();
  app.innerHTML = `
    <section class="card">
      <h2>Practice quiz</h2>
      <p>Use this mode for learning. Questions are selected randomly from the combined question bank. You get instant feedback and every missed answer is saved for review.</p>
      <div class="form-row">
        <div class="field"><label>Topic</label><select id="quizTopic"><option value="all">All topics</option>${topics.map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
        <div class="field"><label>Questions</label><input id="quizCount" type="number" min="5" max="80" value="10" /></div>
        <div class="field"><label>Mode</label><select id="quizMode"><option value="instant">Instant feedback</option></select></div>
      </div>
      <div class="button-row"><button class="primary-btn" id="startQuiz">Start practice quiz</button></div>
    </section>
    <section class="card" style="margin-top:16px">
      <h2>Recent quiz attempts</h2>
      ${state.quizAttempts.slice(-5).reverse().map(a => `<p><strong>${getScore(a)}%</strong> · ${a.correct}/${a.total} · ${formatDate(a.date)}</p>`).join('') || '<p>No quiz attempts yet.</p>'}
    </section>`;
  document.getElementById('startQuiz').addEventListener('click', async () => {
    const topic = document.getElementById('quizTopic').value;
    const count = Math.max(5, Math.min(80, Number(document.getElementById('quizCount').value) || 10));
    const bank = questionBank();
    const pool = topic === 'all' ? bank : bank.filter(q => q.topic === topic);
    state.activeQuiz = {
      type: 'quiz',
      startedAt: Date.now(),
      topic,
      questions: sampleQuestions(pool.length ? pool : bank, count),
      index: 0,
      answers: [],
      submitted: false,
      currentSelection: []
    };
    saveState();
    renderQuiz();
  });
}

function renderExam() {
  if (state.activeExam) return renderQuestionSession('exam');
  app.innerHTML = `
    <section class="card">
      <h2>Exam simulator</h2>
      <p>Simulates PSPO I pressure: ${EXAM_QUESTION_COUNT} questions, 60 minutes, ${PASS_MARK}% pass target. Questions are selected randomly from the local built-in bank. Feedback is shown after finishing.</p>
      <div class="pill-row">
        <span class="pill">${EXAM_QUESTION_COUNT} questions</span>
        <span class="pill">60 minutes</span>
        <span class="pill">Pass target ${PASS_MARK}%</span>
      </div>
      <div class="button-row"><button class="primary-btn" id="startExam">Start exam simulator</button></div>
    </section>
    <section class="card" style="margin-top:16px">
      <h2>Recent exam attempts</h2>
      ${state.examAttempts.slice(-5).reverse().map(a => `<p><strong>${getScore(a)}%</strong> · ${a.correct}/${a.total} · ${a.passed ? 'Passed' : 'Needs review'} · ${formatDate(a.date)}</p>`).join('') || '<p>No exam attempts yet.</p>'}
    </section>`;
  document.getElementById('startExam').addEventListener('click', async () => {
    state.activeExam = {
      type: 'exam',
      startedAt: Date.now(),
      endsAt: Date.now() + EXAM_DURATION_SEC * 1000,
      questions: sampleQuestions(questionBank(), EXAM_QUESTION_COUNT),
      index: 0,
      answers: [],
      submitted: false,
      currentSelection: []
    };
    saveState();
    renderExam();
  });
}

function renderQuestionSession(kind) {
  const session = kind === 'exam' ? state.activeExam : state.activeQuiz;
  if (!session) return kind === 'exam' ? renderExam() : renderQuiz();
  if (kind === 'exam' && Date.now() >= session.endsAt) return finishSession(kind);
  const q = session.questions[session.index];
  const previous = session.answers[session.index];
  const selection = previous ? previous.selected : (session.currentSelection || []);
  const answered = !!previous;
  const showFeedback = kind === 'quiz' && answered;
  const remaining = kind === 'exam' ? Math.max(0, Math.floor((session.endsAt - Date.now()) / 1000)) : null;
  markQuestionSeen(q, kind, session);
  saveState();

  app.innerHTML = `
    <section class="card">
      <div class="pill-row" style="justify-content:space-between">
        <div class="pill-row">
          <span class="pill">${kind === 'exam' ? 'Exam simulator' : 'Practice quiz'}</span>
          <span class="pill">Question ${session.index + 1}/${session.questions.length}</span>
          <span class="pill">${esc(q.topic)}</span>
        </div>
        ${kind === 'exam' ? `<span id="timer" class="timer ${remaining < 300 ? 'danger' : remaining < 600 ? 'warn' : ''}">${formatRemaining(remaining)}</span>` : ''}
      </div>
      <div class="progress-wrap"><div class="progress-bar" style="width:${pct(session.index, session.questions.length)}%"></div></div>
    </section>
    <section class="card question-card" style="margin-top:16px">
      <p class="eyebrow">${q.type === 'multi' ? 'Select all correct answers' : q.type === 'truefalse' ? 'True / False' : 'Choose one answer'}</p>
      <h2>${esc(q.prompt)}</h2>
      <form id="questionForm">
        ${q.options.map((option, i) => optionTemplate(q, i, option, selection, showFeedback)).join('')}
      </form>
      ${showFeedback ? feedbackTemplate(q, previous) : ''}
      <div class="button-row">
        ${answered && session.index > 0 ? '<button class="secondary-btn" id="prevQuestion">Back</button>' : ''}
        ${kind === 'quiz' && !answered ? '<button class="primary-btn" id="submitAnswer">Submit answer</button>' : ''}
        ${kind === 'exam' ? '<button class="primary-btn" id="saveNext">Save & next</button>' : ''}
        ${answered && session.index < session.questions.length - 1 ? '<button class="primary-btn" id="nextQuestion">Next</button>' : ''}
        ${answered && session.index === session.questions.length - 1 ? '<button class="primary-btn" id="finishSession">Finish</button>' : ''}
        ${kind === 'exam' ? '<button class="danger-btn" id="finishNow">Finish now</button>' : '<button class="danger-btn" id="quitQuiz">Quit quiz</button>'}
      </div>
    </section>
  `;

  bindQuestionEvents(kind, q);
  if (kind === 'exam') startTimer();
}

function optionTemplate(q, i, option, selection, showFeedback) {
  const checked = selection.includes(i) ? 'checked' : '';
  const inputType = q.type === 'multi' ? 'checkbox' : 'radio';
  let cls = '';
  if (showFeedback) {
    if (q.answer.includes(i)) cls = 'correct';
    else if (selection.includes(i)) cls = 'wrong';
  }
  return `<label class="option ${cls}"><input type="${inputType}" name="answer" value="${i}" ${checked} ${showFeedback ? 'disabled' : ''}/><span>${esc(option)}</span></label>`;
}

function feedbackTemplate(q, previous) {
  const correct = arraysEqual(previous.selected, q.answer);
  return `<div class="explanation"><strong>${correct ? 'Correct' : 'Review this'}</strong><p>${esc(q.explanation)}</p><p class="answer-key"><strong>Correct answer:</strong> ${q.answer.map(i => esc(q.options[i])).join('; ')}</p><p><span class="pill">${esc(q.ref)}</span></p></div>`;
}

function getSelected() {
  return Array.from(document.querySelectorAll('input[name="answer"]:checked')).map(el => Number(el.value));
}

function bindQuestionEvents(kind, q) {
  const session = kind === 'exam' ? state.activeExam : state.activeQuiz;
  document.querySelectorAll('input[name="answer"]').forEach(input => {
    input.addEventListener('change', () => {
      session.currentSelection = getSelected();
      saveState();
    });
  });
  const submit = document.getElementById('submitAnswer');
  if (submit) submit.addEventListener('click', () => submitPracticeAnswer(kind));
  const saveNext = document.getElementById('saveNext');
  if (saveNext) saveNext.addEventListener('click', () => saveExamAnswerAndNext());
  const prev = document.getElementById('prevQuestion');
  if (prev) prev.addEventListener('click', () => { session.index -= 1; saveState(); renderQuestionSession(kind); });
  const next = document.getElementById('nextQuestion');
  if (next) next.addEventListener('click', () => { session.index += 1; session.currentSelection = []; saveState(); renderQuestionSession(kind); });
  const finish = document.getElementById('finishSession');
  if (finish) finish.addEventListener('click', () => finishSession(kind));
  const finishNow = document.getElementById('finishNow');
  if (finishNow) finishNow.addEventListener('click', () => { if (confirm('Finish exam now?')) finishSession(kind); });
  const quit = document.getElementById('quitQuiz');
  if (quit) quit.addEventListener('click', () => { if (confirm('Quit this quiz?')) { state.activeQuiz = null; saveState(); renderQuiz(); } });
}

function submitPracticeAnswer(kind) {
  const session = state.activeQuiz;
  const q = session.questions[session.index];
  const selected = getSelected();
  if (!selected.length) return alert('Choose an answer first.');
  const correct = arraysEqual(selected, q.answer);
  const record = { questionId: q.id, selected, correct, date: Date.now(), topic: q.topic };
  session.answers[session.index] = record;
  recordQuestionAnswer(q, selected, correct, kind);
  if (!correct) addMistake(q, selected);
  session.currentSelection = [];
  saveState();
  renderQuestionSession(kind);
}

function saveExamAnswerAndNext() {
  const session = state.activeExam;
  const q = session.questions[session.index];
  const selected = getSelected();
  if (!selected.length) return alert('Choose an answer first.');
  const correct = arraysEqual(selected, q.answer);
  session.answers[session.index] = { questionId: q.id, selected, correct, date: Date.now(), topic: q.topic };
  recordQuestionAnswer(q, selected, correct, 'exam');
  session.currentSelection = [];
  if (session.index < session.questions.length - 1) session.index += 1;
  else return finishSession('exam');
  saveState();
  renderQuestionSession('exam');
}

function addMistake(q, selected) {
  state.mistakes.unshift({
    id: `${q.id}-${Date.now()}`,
    questionId: q.id,
    topic: q.topic,
    prompt: q.prompt,
    options: q.options,
    selected,
    answer: q.answer,
    explanation: q.explanation,
    ref: q.ref,
    date: Date.now()
  });
  state.mistakes = state.mistakes.slice(0, 300);
}

function finishSession(kind) {
  const session = kind === 'exam' ? state.activeExam : state.activeQuiz;
  if (!session) return;
  if (kind === 'exam') {
    const unanswered = session.questions.filter((_, i) => !session.answers[i]);
    unanswered.forEach((q, offset) => {
      const idx = session.questions.indexOf(q);
      session.answers[idx] = { questionId: q.id, selected: [], correct: false, date: Date.now(), topic: q.topic };
    });
  }
  const total = session.questions.length;
  const correct = session.answers.filter(a => a && a.correct).length;
  const attempt = { date: Date.now(), total, correct, topic: session.topic || 'all', passed: pct(correct, total) >= PASS_MARK };
  if (kind === 'exam') {
    session.questions.forEach((q, i) => {
      const a = session.answers[i];
      if (!a.correct) addMistake(q, a.selected);
    });
    state.examAttempts.push(attempt);
    state.activeExam = null;
  } else {
    state.quizAttempts.push(attempt);
    state.activeQuiz = null;
  }
  saveState();
  renderResults(kind, attempt);
}

function renderResults(kind, attempt) {
  const score = getScore(attempt);
  app.innerHTML = `
    <section class="card center">
      <div class="empty-icon">${score >= PASS_MARK ? '✓' : '!'}</div>
      <h2>${kind === 'exam' ? 'Exam simulator complete' : 'Quiz complete'}</h2>
      <p>You scored <strong>${score}%</strong> (${attempt.correct}/${attempt.total}). ${kind === 'exam' ? (attempt.passed ? 'That is above the pass target.' : 'Review weak topics before the real exam.') : ''}</p>
      <div class="button-row" style="justify-content:center">
        <button class="primary-btn" data-action="go" data-route="review">Review mistakes</button>
        <button class="secondary-btn" data-action="go" data-route="quiz">Practice again</button>
        <button class="secondary-btn" data-action="go" data-route="dashboard">Dashboard</button>
      </div>
    </section>`;
  bindCommonActions();
}

function startTimer() {
  timerHandle = setInterval(() => {
    if (!state.activeExam) return clearInterval(timerHandle);
    const remaining = Math.max(0, Math.floor((state.activeExam.endsAt - Date.now()) / 1000));
    const el = document.getElementById('timer');
    if (el) {
      el.textContent = formatRemaining(remaining);
      el.classList.toggle('warn', remaining < 600 && remaining >= 300);
      el.classList.toggle('danger', remaining < 300);
    }
    if (remaining <= 0) finishSession('exam');
  }, 1000);
}

function formatRemaining(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function captureGuideSelection(save = true) {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0) return '';
  const root = document.getElementById('guideText');
  if (!root) return '';
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return '';
  const text = normalizeText(sel.toString());
  if (!text) return '';
  const sectionEl = range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer.closest?.('.guide-section')
    : range.commonAncestorContainer.parentElement?.closest?.('.guide-section');
  if (save) {
    lastGuideSelection = text;
    lastGuideSection = sectionEl?.dataset?.title || 'Scrum Guide';
  }
  return text;
}

function closestGuideParagraph(node) {
  if (!node) return null;
  const element = node.nodeType === 1 ? node : node.parentElement;
  return element?.closest?.('.guide-paragraph') || null;
}

function getSelectedGuideRange() {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const root = document.getElementById('guideText');
  if (!root) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const startParagraph = closestGuideParagraph(range.startContainer);
  const endParagraph = closestGuideParagraph(range.endContainer);
  if (!startParagraph || !endParagraph || startParagraph !== endParagraph) return null;

  const rawSelected = range.toString();
  const clean = normalizeText(rawSelected);
  if (!clean) return null;

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(startParagraph);
  beforeRange.setEnd(range.startContainer, range.startOffset);

  let start = beforeRange.toString().length;
  let end = start + rawSelected.length;
  const leadingWhitespace = rawSelected.match(/^\s*/)?.[0]?.length || 0;
  const trailingWhitespace = rawSelected.match(/\s*$/)?.[0]?.length || 0;
  start += leadingWhitespace;
  end -= trailingWhitespace;

  const fullText = startParagraph.textContent || '';
  if (start < 0 || end > fullText.length || start >= end) return null;

  return {
    text: fullText.slice(start, end),
    section: startParagraph.dataset.section || 'Scrum Guide',
    paragraphIndex: Number(startParagraph.dataset.paragraphIndex),
    start,
    end
  };
}

document.addEventListener('selectionchange', () => {
  if ((state.currentRoute || 'dashboard') === 'guide') captureGuideSelection(true);
});

function renderGuide() {
  const sections = guideSections || [];
  app.innerHTML = `
    <section class="card guide-tools-card">
      <h2>Scrum Guide</h2>
      <p>${esc(guideMeta.title || 'The Scrum Guide')} · ${esc(guideMeta.version || 'November 2020')} · ${esc(guideMeta.authors || 'Ken Schwaber & Jeff Sutherland')}</p>
      <button class="guide-highlighter" id="guideHighlighter" type="button" aria-label="Highlight selected Scrum Guide text" title="Highlight selected text">
        <span class="highlighter-icon" aria-hidden="true">▌</span>
      </button>
      <div class="form-row">
        <div class="field"><label>Search guide</label><input id="guideSearch" type="search" placeholder="Search Product Owner, Increment, Sprint Review..." /></div>
        <div class="field"><label>Section</label><select id="guideSection"><option value="all">All sections</option>${sections.map(s => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('')}</select></div>
        <div class="field"><label>Actions</label><div class="button-stack"><button class="primary-btn" id="addSelectedGuide" type="button">Add selected text to Study Later</button></div></div>
      </div>
      <p class="hint">Select text inside one Scrum Guide paragraph and tap the small red marker to highlight it. Use the Study Later button separately when you want to save selected text for later review.</p>
      <details class="license-note"><summary>Attribution and license</summary><p>${esc(guideMeta.copyright || '© 2020 Ken Schwaber and Jeff Sutherland')}. Scrum Guide text is licensed under ${esc(guideMeta.license || 'CC BY-SA 4.0')}. This study app is not affiliated with Scrum.org.</p></details>
    </section>
    <section id="guideText" class="guide-text" style="margin-top:16px"></section>
  `;
  const search = document.getElementById('guideSearch');
  const section = document.getElementById('guideSection');
  const update = () => drawGuide(search.value, section.value);
  [search, section].forEach(el => el.addEventListener('input', update));
  const addSelectedToStudyLater = () => {
    const selected = captureGuideSelection(true) || lastGuideSelection;
    if (!selected || selected.length < 3) return alert('Select text from the Scrum Guide first.');
    addStudyLater(selected, lastGuideSection);
    window.getSelection?.().removeAllRanges?.();
  };
  document.getElementById('addSelectedGuide').addEventListener('click', addSelectedToStudyLater);
  document.getElementById('guideHighlighter').addEventListener('click', () => {
    const selectedRange = getSelectedGuideRange();
    if (!selectedRange || normalizeText(selectedRange.text).length < 1) {
      return alert('Select text from one Scrum Guide paragraph first.');
    }
    addGuideHighlight(selectedRange);
    window.getSelection?.().removeAllRanges?.();
    drawGuide(search.value, section.value);
  });
  document.getElementById('guideText').addEventListener('click', event => {
    const target = event.target.closest?.('.guide-highlight');
    if (!target) return;
    const highlightId = target.dataset.highlightId;
    if (!highlightId) return;
    const text = normalizeText(target.textContent || '');
    const message = text
      ? `Delete this highlight?\n\n${text.slice(0, 180)}${text.length > 180 ? '...' : ''}`
      : 'Delete this highlight?';
    if (!confirm(message)) return;
    state.guideHighlights = (state.guideHighlights || []).filter(item => item.id !== highlightId);
    saveState();
    drawGuide(search.value, section.value);
  });
  update();
}

function drawGuide(query = '', selectedSection = 'all') {
  const q = query.toLowerCase().trim();
  const root = document.getElementById('guideText');
  const filtered = guideSections.filter(s => {
    const text = `${s.title} ${(s.paragraphs || []).join(' ')}`.toLowerCase();
    return (selectedSection === 'all' || s.id === selectedSection) && (!q || text.includes(q));
  });
  root.innerHTML = filtered.length ? filtered.map(s => `
    <article class="card guide-section" data-title="${esc(s.title)}">
      <div class="pill-row"><span class="pill">Scrum Guide</span><span class="pill">${esc(s.title)}</span></div>
      <h3>${esc(s.title)}</h3>
      ${(s.paragraphs || []).map((p, index) => `<p class="guide-paragraph" data-section="${esc(s.title)}" data-paragraph-index="${index}">${renderGuideParagraph(p, s.title, index)}</p>`).join('')}
    </article>`).join('') : '<section class="card center"><h2>No guide text found</h2><p>Try a different search or section.</p></section>';
}


function normalizedTextMap(text) {
  const chars = [];
  const map = [];
  let lastWasSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!lastWasSpace && chars.length) {
        chars.push(' ');
        map.push(i);
        lastWasSpace = true;
      }
    } else {
      chars.push(ch.toLowerCase());
      map.push(i);
      lastWasSpace = false;
    }
  }
  if (chars.at(-1) === ' ') {
    chars.pop();
    map.pop();
  }
  return { normalized: chars.join(''), map };
}

function findNormalizedRange(text, needle) {
  const cleanNeedle = normalizeText(needle).toLowerCase();
  if (!cleanNeedle) return null;
  const haystack = normalizedTextMap(text);
  const index = haystack.normalized.indexOf(cleanNeedle);
  if (index === -1) return null;
  const start = haystack.map[index];
  const lastMapped = haystack.map[index + cleanNeedle.length - 1];
  if (start === undefined || lastMapped === undefined) return null;
  return { start, end: lastMapped + 1 };
}

function firstLegacyHighlightParagraph(sectionTitle, highlightText) {
  const guideSection = guideSections.find(s => s.title === sectionTitle);
  if (!guideSection) return -1;
  return (guideSection.paragraphs || []).findIndex(p => findNormalizedRange(p, highlightText));
}

function renderGuideParagraph(text, sectionTitle, paragraphIndex) {
  const ranges = [];
  const highlights = (state.guideHighlights || [])
    .filter(h => h.section === sectionTitle && normalizeText(h.text).length >= 1);

  highlights.forEach(h => {
    let range = null;
    const hasExactRange = Number.isFinite(Number(h.paragraphIndex)) && Number.isFinite(Number(h.start)) && Number.isFinite(Number(h.end));

    if (hasExactRange) {
      const pIndex = Number(h.paragraphIndex);
      const start = Number(h.start);
      const end = Number(h.end);
      if (pIndex === paragraphIndex && start >= 0 && end <= text.length && start < end) {
        range = { start, end };
      }
    } else if (firstLegacyHighlightParagraph(sectionTitle, h.text) === paragraphIndex) {
      // Old v5 highlights stored only the selected text. Render them once instead of on every matching word.
      range = findNormalizedRange(text, h.text);
    }

    if (!range) return;
    const overlaps = ranges.some(r => range.start < r.end && range.end > r.start);
    if (!overlaps) ranges.push({ ...range, id: h.id });
  });

  if (!ranges.length) return esc(text);
  ranges.sort((a, b) => a.start - b.start);
  let html = '';
  let cursor = 0;
  ranges.forEach(range => {
    html += esc(text.slice(cursor, range.start));
    html += `<mark class="guide-highlight" data-highlight-id="${esc(range.id)}" title="Tap to delete this highlight">${esc(text.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  });
  html += esc(text.slice(cursor));
  return html;
}

function addGuideHighlight(selection) {
  if (!selection || typeof selection !== 'object') return;
  const section = selection.section || 'Scrum Guide';
  const paragraphIndex = Number(selection.paragraphIndex);
  const start = Number(selection.start);
  const end = Number(selection.end);
  const guideSection = guideSections.find(s => s.title === section);
  const paragraph = guideSection?.paragraphs?.[paragraphIndex];

  if (!paragraph || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > paragraph.length || start >= end) {
    return alert('Please select text within a single Scrum Guide paragraph so it can be highlighted.');
  }

  const exactText = paragraph.slice(start, end);
  const clean = normalizeText(exactText);
  if (!clean) return;

  state.guideHighlights = state.guideHighlights || [];
  const duplicate = state.guideHighlights.some(item =>
    item.section === section &&
    Number(item.paragraphIndex) === paragraphIndex &&
    Number(item.start) === start &&
    Number(item.end) === end
  );
  if (duplicate) return alert('That exact selection is already highlighted.');

  state.guideHighlights.unshift({
    id: makeId('highlight'),
    text: clean,
    section,
    paragraphIndex,
    start,
    end,
    color: 'red',
    date: Date.now()
  });
  saveState();
}

function addStudyLater(text, section = 'Scrum Guide') {
  const clean = normalizeText(text);
  if (!clean) return;
  state.studyLater = state.studyLater || [];
  const duplicate = state.studyLater.some(item => normalizeText(item.text).toLowerCase() === clean.toLowerCase());
  if (duplicate) return alert('That selection is already in Study Later.');
  state.studyLater.unshift({ id: makeId('study'), text: clean, section, date: Date.now(), studied: false });
  saveState();
  alert('Added to Study Later.');
}

function renderStudyLater() {
  const items = state.studyLater || [];
  const sections = [...new Set(items.map(i => i.section).filter(Boolean))].sort();
  app.innerHTML = `
    <section class="card">
      <h2>Study Later</h2>
      <p>These are the Scrum Guide selections you saved. You can mark them studied or convert them into your own lesson/flashcard.</p>
      <div class="form-row">
        <div class="field"><label>Search</label><input id="studySearch" type="search" placeholder="Search saved selections..." /></div>
        <div class="field"><label>Section</label><select id="studySection"><option value="all">All sections</option>${sections.map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
        <div class="field"><label>Action</label><button class="danger-btn" id="clearStudied" type="button">Clear studied items</button></div>
      </div>
    </section>
    <section id="studyList" style="margin-top:16px"></section>
  `;
  const search = document.getElementById('studySearch');
  const section = document.getElementById('studySection');
  const update = () => drawStudyLater(search.value, section.value);
  search.addEventListener('input', update);
  section.addEventListener('input', update);
  document.getElementById('clearStudied').addEventListener('click', () => {
    if (!confirm('Clear all studied Study Later items?')) return;
    state.studyLater = (state.studyLater || []).filter(item => !item.studied);
    saveState();
    renderStudyLater();
  });
  update();
}

function drawStudyLater(query = '', section = 'all') {
  const q = query.toLowerCase();
  const list = document.getElementById('studyList');
  const filtered = (state.studyLater || []).filter(item => {
    const text = `${item.section} ${item.text}`.toLowerCase();
    return text.includes(q) && (section === 'all' || item.section === section);
  });
  if (!filtered.length) {
    list.innerHTML = `<section class="card center"><div class="empty-icon">＋</div><h2>No saved guide text yet</h2><p>Open the Guide tab, select text, then add it to Study Later.</p><button class="primary-btn" data-action="go" data-route="guide">Open Guide</button></section>`;
    bindCommonActions();
    return;
  }
  list.innerHTML = filtered.map(item => `
    <article class="card study-item ${item.studied ? 'studied' : ''}">
      <div class="pill-row"><span class="pill">${esc(item.section)}</span><span class="pill">${formatDate(item.date)}</span>${item.studied ? '<span class="pill">Studied</span>' : ''}</div>
      <blockquote>${esc(item.text)}</blockquote>
      <div class="button-row">
        <button class="secondary-btn" data-study-toggle="${esc(item.id)}" type="button">${item.studied ? 'Mark not studied' : 'Mark studied'}</button>
        <button class="secondary-btn" data-study-card="${esc(item.id)}" type="button">Make flashcard</button>
        <button class="secondary-btn" data-study-lesson="${esc(item.id)}" type="button">Make lesson</button>
        <button class="danger-btn" data-study-delete="${esc(item.id)}" type="button">Delete</button>
      </div>
    </article>`).join('');
  list.querySelectorAll('[data-study-toggle]').forEach(btn => btn.addEventListener('click', () => {
    const item = (state.studyLater || []).find(i => i.id === btn.dataset.studyToggle);
    if (item) item.studied = !item.studied;
    saveState();
    drawStudyLater(document.getElementById('studySearch').value, document.getElementById('studySection').value);
  }));
  list.querySelectorAll('[data-study-card]').forEach(btn => btn.addEventListener('click', () => makeFlashcardFromStudy(btn.dataset.studyCard)));
  list.querySelectorAll('[data-study-lesson]').forEach(btn => btn.addEventListener('click', () => makeLessonFromStudy(btn.dataset.studyLesson)));
  list.querySelectorAll('[data-study-delete]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Delete this Study Later item?')) return;
    state.studyLater = (state.studyLater || []).filter(i => i.id !== btn.dataset.studyDelete);
    saveState();
    drawStudyLater(document.getElementById('studySearch').value, document.getElementById('studySection').value);
  }));
}

function makeFlashcardFromStudy(id) {
  const item = (state.studyLater || []).find(i => i.id === id);
  if (!item) return;
  const front = prompt('Flashcard front/question:', `Explain: ${item.text.slice(0, 80)}${item.text.length > 80 ? '…' : ''}`);
  if (!front) return;
  const back = prompt('Flashcard back/answer:', item.text);
  if (!back) return;
  state.customFlashcards = state.customFlashcards || [];
  state.customFlashcards.unshift({ id: makeId('study-card'), topic: item.section || 'Scrum Guide', front: normalizeText(front), back: back.trim() });
  saveState();
  alert('Flashcard added to Cards.');
}

function makeLessonFromStudy(id) {
  const item = (state.studyLater || []).find(i => i.id === id);
  if (!item) return;
  const title = prompt('Lesson title:', item.section || 'Scrum Guide note');
  if (!title) return;
  state.customLessons = state.customLessons || [];
  state.customLessons.unshift({ id: makeId('study-lesson'), topic: item.section || 'Scrum Guide', title: normalizeText(title), summary: item.text, details: [] });
  saveState();
  alert('Lesson added to Learn.');
}

function renderReview() {
  const topics = [...new Set(state.mistakes.map(m => m.topic))].sort();
  app.innerHTML = `
    <section class="card">
      <h2>Review mistakes</h2>
      <p>Every missed quiz and exam question is saved here. Revisit explanations until the pattern becomes obvious.</p>
      <div class="form-row">
        <div class="field"><label>Search</label><input id="mistakeSearch" type="search" placeholder="Search missed questions..." /></div>
        <div class="field"><label>Topic</label><select id="mistakeTopic"><option value="all">All topics</option>${topics.map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
        <div class="field"><label>Action</label><button class="danger-btn" id="clearMistakes">Clear mistake history</button></div>
      </div>
    </section>
    <section id="mistakeList" style="margin-top:16px"></section>`;
  const search = document.getElementById('mistakeSearch');
  const topic = document.getElementById('mistakeTopic');
  const update = () => drawMistakes(search.value, topic.value);
  search.addEventListener('input', update);
  topic.addEventListener('input', update);
  document.getElementById('clearMistakes').addEventListener('click', () => {
    if (!confirm('Clear all saved mistakes?')) return;
    state.mistakes = [];
    saveState();
    renderReview();
  });
  update();
}

function drawMistakes(query = '', topic = 'all') {
  const q = query.toLowerCase();
  const list = document.getElementById('mistakeList');
  const filtered = state.mistakes.filter(m => {
    const text = `${m.prompt} ${m.topic} ${m.explanation}`.toLowerCase();
    return text.includes(q) && (topic === 'all' || m.topic === topic);
  });
  if (!filtered.length) {
    list.innerHTML = `<section class="card center"><div class="empty-icon">✓</div><h2>No mistakes found</h2><p>Take a quiz or exam simulator to build a review list.</p></section>`;
    return;
  }
  list.innerHTML = filtered.map(m => `
    <article class="card review-item">
      <div class="pill-row"><span class="pill">${esc(m.topic)}</span><span class="pill">${formatDate(m.date)}</span></div>
      <h3>${esc(m.prompt)}</h3>
      <p class="answer-key"><strong>Your answer:</strong> ${m.selected.length ? m.selected.map(i => esc(m.options[i])).join('; ') : 'No answer'}</p>
      <p class="answer-key"><strong>Correct:</strong> ${m.answer.map(i => esc(m.options[i])).join('; ')}</p>
      <div class="explanation"><strong>Explanation</strong><p>${esc(m.explanation)}</p><p><span class="pill">${esc(m.ref)}</span></p></div>
    </article>`).join('');
}


function exportStudyData() {
  const payload = {
    app: 'PSPO Study Coach',
    version: 9,
    exportedAt: new Date().toISOString(),
    state
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pspo-study-coach-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importStudyData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        const importedState = parsed.state || parsed;
        if (!importedState || typeof importedState !== 'object') throw new Error('Invalid backup file.');
        const merged = { ...defaultState(), ...importedState };
        if (!Array.isArray(merged.studyLater)) merged.studyLater = [];
        if (!Array.isArray(merged.guideHighlights)) merged.guideHighlights = [];
        if (!Array.isArray(merged.customFlashcards)) merged.customFlashcards = [];
        if (!Array.isArray(merged.customLessons)) merged.customLessons = [];
        if (!merged.questionProgress || typeof merged.questionProgress !== 'object') merged.questionProgress = {};
        if (!confirm('Import this backup and replace the data saved on this device?')) return;
        state = merged;
        state.currentRoute = state.currentRoute || 'dashboard';
        saveState();
        alert('Data imported successfully.');
        render();
      } catch (err) {
        alert('Could not import this file. Make sure it is a PSPO Study Coach JSON backup.');
        console.error(err);
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

function bindCommonActions() {
  document.querySelectorAll('[data-action="go"]').forEach(btn => btn.addEventListener('click', () => setRoute(btn.dataset.route)));
  document.querySelectorAll('[data-action="export-data"]').forEach(btn => btn.addEventListener('click', exportStudyData));
  document.querySelectorAll('[data-action="import-data"]').forEach(btn => btn.addEventListener('click', importStudyData));
}

render();
