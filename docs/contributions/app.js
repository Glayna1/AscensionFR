'use strict';

const CONFIG = Object.freeze({
  owner: 'LePetitDan',
  repo: 'AscensionFR-Textes',
  branch: 'main',
  directory: 'traductions',
  api: 'https://api.github.com',
  raw: 'https://raw.githubusercontent.com',
  maxResults: 200,
  historySize: 20,
  entryHistorySize: 14,
  pageSize: 100
});

const MISSING = Symbol('missing');
const state = {
  categories: [],
  categoryCache: new Map(),
  rawCache: new Map(),
  entryIndex: new Map(),
  commits: []
};

const ui = {};

window.addEventListener('DOMContentLoaded', () => {
  Object.assign(ui, {
    catalogueState: document.querySelector('#catalogue-state'),
    searchForm: document.querySelector('#search-form'),
    query: document.querySelector('#query'),
    category: document.querySelector('#category'),
    searchButton: document.querySelector('#search-button'),
    clearButton: document.querySelector('#clear-button'),
    searchState: document.querySelector('#search-state'),
    results: document.querySelector('#results'),
    refreshHistory: document.querySelector('#refresh-history'),
    historyState: document.querySelector('#history-state'),
    history: document.querySelector('#history')
  });

  ui.searchForm.addEventListener('submit', runSearch);
  ui.clearButton.addEventListener('click', clearSearch);
  ui.results.addEventListener('click', onResultAction);
  ui.refreshHistory.addEventListener('click', loadHistory);
  ui.history.addEventListener('click', onHistoryAction);

  loadCategories();
  loadHistory();
});

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const detail = remaining === '0'
      ? 'La limite de lecture publique de GitHub est atteinte. Réessaie après sa réinitialisation.'
      : `GitHub répond ${response.status} pour cette lecture.`;
    throw new Error(detail);
  }
  return response.json();
}

async function loadCategories() {
  setStatus(ui.catalogueState, 'Chargement des catégories…', '');
  try {
    const url = `${CONFIG.api}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.directory}?ref=${encodeURIComponent(CONFIG.branch)}`;
    const files = await apiFetch(url);
    state.categories = files
      .filter(item => item.type === 'file' && item.name.toLocaleLowerCase('fr').endsWith('.json'))
      .map(item => ({ name: item.name, path: item.path, sha: item.sha, size: item.size }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    ui.category.replaceChildren(makeOption('', 'Toutes les catégories'));
    for (const category of state.categories) {
      ui.category.append(makeOption(category.name, category.name));
    }
    ui.category.disabled = false;
    ui.searchButton.disabled = false;
    setStatus(ui.catalogueState, `${state.categories.length} catégories publiques`, 'ok');
    ui.searchState.textContent = 'Choisis un fichier, ou saisis au moins 3 caractères pour chercher dans toutes les catégories.';
  } catch (error) {
    setStatus(ui.catalogueState, 'Catalogue indisponible', 'error');
    ui.searchState.textContent = error.message;
  }
}

function makeOption(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function setStatus(element, text, status) {
  element.textContent = text;
  if (status) element.dataset.state = status;
  else delete element.dataset.state;
}

async function loadCategory(category) {
  if (state.categoryCache.has(category.name)) return state.categoryCache.get(category.name);

  const data = await fetchJsonFile(category.path, CONFIG.branch);
  if (data === MISSING) throw new Error(`${category.name} est introuvable sur GitHub.`);
  const entries = flattenJson(data, category);
  const loaded = { category, entries };
  state.categoryCache.set(category.name, loaded);
  for (const entry of entries) state.entryIndex.set(entry.id, entry);
  return loaded;
}

async function fetchJsonFile(path, ref) {
  const key = `${ref}:${path}`;
  if (state.rawCache.has(key)) return state.rawCache.get(key);

  const url = `${CONFIG.raw}/${CONFIG.owner}/${CONFIG.repo}/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 404) {
    state.rawCache.set(key, MISSING);
    return MISSING;
  }
  if (!response.ok) throw new Error(`Impossible de lire ${path} à la révision ${shortSha(ref)}.`);
  const value = await response.json();
  state.rawCache.set(key, value);
  return value;
}

function flattenJson(value, category, path = [], output = []) {
  if (isPrimitive(value)) {
    const text = primitiveText(value);
    const displayPath = displayJsonPath(path);
    output.push({
      id: `${category.name}:${JSON.stringify(path)}`,
      category: category.name,
      categoryPath: category.path,
      blobSha: category.sha,
      path: [...path],
      displayPath,
      leaf: path.length ? String(path[path.length - 1]) : '(racine)',
      value: text,
      searchable: normalize(`${category.name} ${displayPath} ${text}`)
    });
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((child, index) => flattenJson(child, category, [...path, index], output));
    return output;
  }

  for (const [key, child] of Object.entries(value)) {
    flattenJson(child, category, [...path, key], output);
  }
  return output;
}

function isPrimitive(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function primitiveText(value) {
  if (value === null) return 'null';
  return String(value);
}

function displayJsonPath(path) {
  if (!path.length) return '(racine)';
  return path.map(part => typeof part === 'number' ? `[${part}]` : String(part)).join(' › ');
}

function normalize(value) {
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr');
}

async function runSearch(event) {
  event.preventDefault();
  const rawQuery = ui.query.value.trim();
  const query = normalize(rawQuery);
  const chosen = ui.category.value;

  if (!chosen && query.length < 3) {
    ui.searchState.textContent = 'Pour chercher partout, saisis au moins 3 caractères. Sinon, sélectionne une catégorie.';
    ui.query.focus();
    return;
  }

  const categories = chosen
    ? state.categories.filter(category => category.name === chosen)
    : state.categories;

  ui.searchButton.disabled = true;
  ui.clearButton.hidden = false;
  ui.results.replaceChildren(makeInlineState('Lecture des fichiers publics…'));

  try {
    const loaded = await mapLimit(categories, 3, async (category, index) => {
      ui.searchState.textContent = `Lecture publique : ${index + 1}/${categories.length} — ${category.name}`;
      return loadCategory(category);
    });

    let results = loaded.flatMap(item => item.entries);
    if (query) results = results.filter(entry => entry.searchable.includes(query));
    results.sort((a, b) => scoreEntry(b, query) - scoreEntry(a, query)
      || a.category.localeCompare(b.category, 'fr')
      || a.displayPath.localeCompare(b.displayPath, 'fr'));

    const total = results.length;
    const shown = results.slice(0, CONFIG.maxResults);
    renderResults(shown, rawQuery);
    ui.searchState.textContent = total > CONFIG.maxResults
      ? `${total.toLocaleString('fr-FR')} résultat(s), dont les ${CONFIG.maxResults} premiers sont affichés.`
      : `${total.toLocaleString('fr-FR')} résultat(s).`;
  } catch (error) {
    ui.results.replaceChildren(makeInlineState(error.message));
    ui.searchState.textContent = 'La recherche n’a pas pu être terminée.';
  } finally {
    ui.searchButton.disabled = false;
  }
}

function scoreEntry(entry, query) {
  if (!query) return 0;
  const leaf = normalize(entry.leaf);
  const value = normalize(entry.value);
  if (leaf === query || value === query) return 100;
  if (leaf.startsWith(query)) return 80;
  if (value.startsWith(query)) return 70;
  if (leaf.includes(query)) return 60;
  if (value.includes(query)) return 50;
  return 10;
}

function renderResults(entries, query) {
  ui.results.replaceChildren();
  if (!entries.length) {
    ui.results.append(makeInlineState('Aucun texte public ne correspond à cette recherche.'));
    return;
  }

  for (const entry of entries) {
    const card = document.createElement('article');
    card.className = 'result-card';
    card.dataset.entryId = entry.id;

    const head = document.createElement('div');
    head.className = 'result-card__head';

    const identity = document.createElement('div');
    const category = document.createElement('p');
    category.className = 'result-card__category';
    category.textContent = entry.category;
    const path = document.createElement('p');
    path.className = 'result-card__path';
    path.textContent = entry.displayPath;
    identity.append(category, path);

    const sourceActions = document.createElement('div');
    sourceActions.className = 'result-card__source-actions';
    sourceActions.append(
      makeLinkButton('Fichier actuel', githubFileUrl(entry.categoryPath, CONFIG.branch)),
      makeLinkButton('Commits du fichier', githubCommitsUrl(entry.categoryPath))
    );
    head.append(identity, sourceActions);

    const value = document.createElement('p');
    value.className = 'result-card__value';
    appendHighlighted(value, entry.value, query);

    const actions = document.createElement('div');
    actions.className = 'result-card__actions';
    const historyButton = document.createElement('button');
    historyButton.type = 'button';
    historyButton.className = 'button button--ghost button--small';
    historyButton.dataset.action = 'entry-history';
    historyButton.textContent = 'Comparer son historique exact';
    actions.append(historyButton);

    const detail = document.createElement('div');
    detail.className = 'entry-history';
    detail.hidden = true;

    card.append(head, value, actions, detail);
    ui.results.append(card);
  }
}

function appendHighlighted(target, text, query) {
  if (!query) {
    target.textContent = text;
    return;
  }
  const normalizedText = normalize(text);
  const normalizedQuery = normalize(query);
  let cursor = 0;
  let found = normalizedText.indexOf(normalizedQuery);
  if (found < 0) {
    target.textContent = text;
    return;
  }

  while (found >= 0) {
    target.append(document.createTextNode(text.slice(cursor, found)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(found, found + query.length);
    target.append(mark);
    cursor = found + query.length;
    found = normalizedText.indexOf(normalizedQuery, cursor);
  }
  target.append(document.createTextNode(text.slice(cursor)));
}

function makeLinkButton(label, href) {
  const link = document.createElement('a');
  link.className = 'button button--ghost button--small';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = label;
  return link;
}

function makeInlineState(text) {
  const node = document.createElement('div');
  node.className = 'inline-state';
  node.textContent = text;
  return node;
}

function clearSearch() {
  ui.query.value = '';
  ui.category.value = '';
  ui.results.replaceChildren();
  ui.searchState.textContent = 'Choisis un fichier, ou saisis au moins 3 caractères pour chercher dans toutes les catégories.';
  ui.clearButton.hidden = true;
  ui.query.focus();
}

async function onResultAction(event) {
  const button = event.target.closest('button[data-action="entry-history"]');
  if (!button) return;
  const card = button.closest('[data-entry-id]');
  const entry = state.entryIndex.get(card.dataset.entryId);
  const detail = card.querySelector('.entry-history');

  if (!detail.hidden) {
    detail.hidden = true;
    button.textContent = 'Comparer son historique exact';
    return;
  }

  detail.hidden = false;
  button.textContent = 'Masquer l’historique';
  if (detail.dataset.loaded === 'true') return;
  detail.replaceChildren(makeInlineState('Calcul des versions avant/après…'));

  try {
    const changes = await loadEntryHistory(entry);
    renderEntryHistory(detail, changes);
    detail.dataset.loaded = 'true';
  } catch (error) {
    detail.replaceChildren(makeInlineState(error.message));
  }
}

async function loadEntryHistory(entry) {
  const endpoint = `${CONFIG.api}/repos/${CONFIG.owner}/${CONFIG.repo}/commits?sha=${encodeURIComponent(CONFIG.branch)}&path=${encodeURIComponent(entry.categoryPath)}&per_page=${CONFIG.entryHistorySize}`;
  const commits = await apiFetch(endpoint);
  const changes = [];

  for (const commit of commits) {
    const parentSha = commit.parents?.[0]?.sha;
    if (!parentSha) continue;
    const [beforeDocument, afterDocument] = await Promise.all([
      fetchJsonFile(entry.categoryPath, parentSha),
      fetchJsonFile(entry.categoryPath, commit.sha)
    ]);
    const before = beforeDocument === MISSING ? MISSING : valueAtPath(beforeDocument, entry.path);
    const after = afterDocument === MISSING ? MISSING : valueAtPath(afterDocument, entry.path);
    if (!sameValue(before, after)) {
      changes.push({
        before,
        after,
        operation: classifyOperation(before, after),
        commit
      });
    }
  }
  return changes;
}

function renderEntryHistory(container, changes) {
  container.replaceChildren();
  if (!changes.length) {
    container.append(makeInlineState('Aucun changement de cette valeur n’apparaît dans les derniers commits du fichier.'));
    return;
  }

  for (const change of changes) {
    const item = document.createElement('article');
    item.className = 'change-card';
    const header = document.createElement('div');
    header.className = 'change-card__header';
    const info = document.createElement('div');
    const title = document.createElement('a');
    title.href = change.commit.html_url;
    title.target = '_blank';
    title.rel = 'noreferrer';
    title.textContent = firstLine(change.commit.commit.message);
    const meta = document.createElement('p');
    meta.className = 'proposal-meta';
    meta.textContent = `${commitAuthor(change.commit)} · ${formatDate(change.commit.commit.author?.date)} · ${shortSha(change.commit.sha)}`;
    info.append(title, meta);
    header.append(info, makeOperationBadge(change.operation));
    item.append(header, renderComparison(change.before, change.after));
    container.append(item);
  }
}

async function loadHistory() {
  ui.refreshHistory.disabled = true;
  ui.history.replaceChildren();
  ui.historyState.hidden = false;
  ui.historyState.textContent = 'Lecture des commits publics…';
  try {
    const endpoint = `${CONFIG.api}/repos/${CONFIG.owner}/${CONFIG.repo}/commits?sha=${encodeURIComponent(CONFIG.branch)}&path=${encodeURIComponent(CONFIG.directory)}&per_page=${CONFIG.historySize}`;
    state.commits = await apiFetch(endpoint);
    renderHistory(state.commits);
    ui.historyState.hidden = state.commits.length > 0;
    if (!state.commits.length) ui.historyState.textContent = 'Aucun commit public trouvé.';
  } catch (error) {
    ui.historyState.hidden = false;
    ui.historyState.textContent = error.message;
  } finally {
    ui.refreshHistory.disabled = false;
  }
}

function renderHistory(commits) {
  ui.history.replaceChildren();
  for (const commit of commits) {
    const card = document.createElement('article');
    card.className = 'proposal-card';
    card.dataset.commitSha = commit.sha;

    const top = document.createElement('div');
    top.className = 'proposal-card__top';
    const identity = document.createElement('div');
    const title = document.createElement('h3');
    const link = document.createElement('a');
    link.href = commit.html_url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = firstLine(commit.commit.message);
    title.append(link);
    const meta = document.createElement('div');
    meta.className = 'proposal-meta';
    meta.append(
      makeMeta(`Auteur : ${commitAuthor(commit)}`),
      makeMeta(formatDate(commit.commit.author?.date)),
      makeMeta(shortSha(commit.sha))
    );
    identity.append(title, meta);
    const label = document.createElement('span');
    label.className = 'state-label state-label--closed';
    label.textContent = 'commit';
    top.append(identity, label);

    const actions = document.createElement('div');
    actions.className = 'vote-row';
    actions.append(
      makeActionButton('Voir tous les changements', 'commit-changes'),
      makeActionButton('Votes et revues', 'commit-votes')
    );

    const details = document.createElement('div');
    details.className = 'commit-details';

    card.append(top, actions, details);
    ui.history.append(card);
  }
}

function makeMeta(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function makeActionButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button--ghost button--small';
  button.dataset.action = action;
  button.textContent = label;
  return button;
}

async function onHistoryAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const card = button.closest('[data-commit-sha]');
  if (!card) return;
  const sha = card.dataset.commitSha;
  const details = card.querySelector('.commit-details');

  if (button.dataset.action === 'commit-changes') {
    await toggleCommitChanges(button, details, sha);
  } else if (button.dataset.action === 'commit-votes') {
    await toggleCommitVotes(button, details, sha);
  } else if (button.dataset.action === 'more-changes') {
    revealMoreChanges(button, details);
  }
}

async function toggleCommitChanges(button, details, sha) {
  const existing = details.querySelector('[data-section="changes"]');
  if (existing) {
    existing.remove();
    button.textContent = 'Voir tous les changements';
    return;
  }

  button.disabled = true;
  button.textContent = 'Calcul en cours…';
  const section = document.createElement('section');
  section.dataset.section = 'changes';
  section.className = 'detail-section';
  section.append(makeInlineState('Comparaison exacte des fichiers JSON…'));
  details.prepend(section);

  try {
    const payload = await loadCommitChanges(sha);
    renderCommitChanges(section, payload);
    button.textContent = 'Masquer les changements';
  } catch (error) {
    section.replaceChildren(makeInlineState(error.message));
    button.textContent = 'Réessayer les changements';
  } finally {
    button.disabled = false;
  }
}

async function loadCommitChanges(sha) {
  const commit = await apiFetch(`${CONFIG.api}/repos/${CONFIG.owner}/${CONFIG.repo}/commits/${sha}`);
  const parentSha = commit.parents?.[0]?.sha;
  if (!parentSha) return { commit, changes: [], files: [] };

  const files = (commit.files || []).filter(file => file.filename.startsWith(`${CONFIG.directory}/`) && file.filename.endsWith('.json'));
  const changes = [];

  for (const file of files) {
    const oldPath = file.previous_filename || file.filename;
    const [beforeDocument, afterDocument] = await Promise.all([
      fetchJsonFile(oldPath, parentSha),
      fetchJsonFile(file.filename, sha)
    ]);
    changes.push(...compareDocuments(beforeDocument, afterDocument, file.filename));
  }

  return { commit, changes, files };
}

function compareDocuments(beforeDocument, afterDocument, filename) {
  const beforeMap = beforeDocument === MISSING ? new Map() : flattenToMap(beforeDocument);
  const afterMap = afterDocument === MISSING ? new Map() : flattenToMap(afterDocument);
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes = [];

  for (const key of keys) {
    const beforeEntry = beforeMap.get(key);
    const afterEntry = afterMap.get(key);
    const before = beforeEntry ? beforeEntry.value : MISSING;
    const after = afterEntry ? afterEntry.value : MISSING;
    if (sameValue(before, after)) continue;
    changes.push({
      filename,
      path: (afterEntry || beforeEntry).path,
      displayPath: (afterEntry || beforeEntry).displayPath,
      before,
      after,
      operation: classifyOperation(before, after)
    });
  }

  return changes.sort((a, b) => a.filename.localeCompare(b.filename, 'fr')
    || a.displayPath.localeCompare(b.displayPath, 'fr'));
}

function flattenToMap(value, path = [], output = new Map()) {
  if (isPrimitive(value)) {
    output.set(JSON.stringify(path), {
      path: [...path],
      displayPath: displayJsonPath(path),
      value: primitiveText(value)
    });
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => flattenToMap(child, [...path, index], output));
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    flattenToMap(child, [...path, key], output);
  }
  return output;
}

function renderCommitChanges(section, payload) {
  section.replaceChildren();
  const summary = document.createElement('div');
  summary.className = 'change-summary';
  summary.textContent = `${payload.changes.length.toLocaleString('fr-FR')} changement(s) JSON exact(s) dans ${payload.files.length} fichier(s).`;
  section.append(summary);

  if (!payload.changes.length) {
    section.append(makeInlineState('Aucune valeur JSON primitive différente n’a été trouvée dans ce commit.'));
    return;
  }

  const list = document.createElement('div');
  list.className = 'change-list';
  list.dataset.visible = '0';
  section.append(list);
  appendChangeBatch(list, payload.changes);
  section.dataset.allChanges = JSON.stringify(payload.changes.map(serializeChange));

  if (payload.changes.length > CONFIG.pageSize) {
    const more = makeActionButton('Afficher les changements suivants', 'more-changes');
    more.dataset.total = String(payload.changes.length);
    section.append(more);
  }
}

function serializeChange(change) {
  return {
    ...change,
    before: change.before === MISSING ? { __missing: true } : change.before,
    after: change.after === MISSING ? { __missing: true } : change.after
  };
}

function deserializeChange(change) {
  return {
    ...change,
    before: change.before && change.before.__missing ? MISSING : change.before,
    after: change.after && change.after.__missing ? MISSING : change.after
  };
}

function appendChangeBatch(list, supplied) {
  const changes = supplied || JSON.parse(list.closest('[data-section="changes"]').dataset.allChanges).map(deserializeChange);
  const start = Number(list.dataset.visible || 0);
  const end = Math.min(start + CONFIG.pageSize, changes.length);

  for (const change of changes.slice(start, end)) {
    const card = document.createElement('article');
    card.className = 'change-card';
    const header = document.createElement('div');
    header.className = 'change-card__header';
    const identity = document.createElement('div');
    const filename = document.createElement('p');
    filename.className = 'result-card__category';
    filename.textContent = change.filename;
    const path = document.createElement('p');
    path.className = 'result-card__path';
    path.textContent = change.displayPath;
    identity.append(filename, path);
    header.append(identity, makeOperationBadge(change.operation));
    card.append(header, renderComparison(change.before, change.after));
    list.append(card);
  }
  list.dataset.visible = String(end);
}

function revealMoreChanges(button, details) {
  const section = details.querySelector('[data-section="changes"]');
  const list = section.querySelector('.change-list');
  const changes = JSON.parse(section.dataset.allChanges).map(deserializeChange);
  appendChangeBatch(list, changes);
  const visible = Number(list.dataset.visible);
  if (visible >= changes.length) button.remove();
  else button.textContent = `Afficher les suivants (${changes.length - visible} restant(s))`;
}

async function toggleCommitVotes(button, details, sha) {
  const existing = details.querySelector('[data-section="votes"]');
  if (existing) {
    existing.remove();
    button.textContent = 'Votes et revues';
    return;
  }

  button.disabled = true;
  button.textContent = 'Lecture des votes…';
  const section = document.createElement('section');
  section.dataset.section = 'votes';
  section.className = 'detail-section';
  section.append(makeInlineState('Recherche de la pull request associée…'));
  details.append(section);

  try {
    const voteData = await loadCommitVotes(sha);
    renderCommitVotes(section, voteData);
    button.textContent = 'Masquer votes et revues';
  } catch (error) {
    section.replaceChildren(makeInlineState(error.message));
    button.textContent = 'Réessayer les votes';
  } finally {
    button.disabled = false;
  }
}

async function loadCommitVotes(sha) {
  const pulls = await apiFetch(`${CONFIG.api}/repos/${CONFIG.owner}/${CONFIG.repo}/commits/${sha}/pulls`);
  const results = [];

  for (const pull of pulls) {
    const [reactions, reviews] = await Promise.all([
      apiFetch(`${CONFIG.api}/repos/${CONFIG.owner}/${CONFIG.repo}/issues/${pull.number}/reactions?per_page=100`),
      apiFetch(`${CONFIG.api}/repos/${CONFIG.owner}/${CONFIG.repo}/pulls/${pull.number}/reviews?per_page=100`)
    ]);
    results.push({ pull, reactions, reviews: latestReviewsByUser(reviews) });
  }
  return results;
}

function latestReviewsByUser(reviews) {
  const latest = new Map();
  for (const review of reviews) {
    const login = review.user?.login;
    if (!login) continue;
    const existing = latest.get(login);
    if (!existing || new Date(review.submitted_at || 0) >= new Date(existing.submitted_at || 0)) {
      latest.set(login, review);
    }
  }
  return [...latest.values()];
}

function renderCommitVotes(section, voteData) {
  section.replaceChildren();
  if (!voteData.length) {
    section.append(makeInlineState('Aucune pull request publique n’est associée à ce commit : aucun vote ou avis GitHub ne peut lui être attribué.'));
    return;
  }

  for (const data of voteData) {
    const card = document.createElement('article');
    card.className = 'vote-card';
    const title = document.createElement('h4');
    const link = document.createElement('a');
    link.href = data.pull.html_url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = `PR #${data.pull.number} — ${data.pull.title}`;
    title.append(link);
    card.append(title);

    const groups = [
      ['👍 Pour', data.reactions.filter(item => item.content === '+1').map(item => item.user)],
      ['👎 Contre', data.reactions.filter(item => item.content === '-1').map(item => item.user)],
      ['✅ Approuvé', data.reviews.filter(item => item.state === 'APPROVED').map(item => item.user)],
      ['⛔ Changements demandés', data.reviews.filter(item => item.state === 'CHANGES_REQUESTED').map(item => item.user)],
      ['💬 Commenté', data.reviews.filter(item => item.state === 'COMMENTED').map(item => item.user)]
    ];

    for (const [label, users] of groups) card.append(renderVoterGroup(label, users));
    section.append(card);
  }
}

function renderVoterGroup(label, users) {
  const group = document.createElement('div');
  group.className = 'voter-group';
  const strong = document.createElement('strong');
  strong.textContent = `${label} (${users.length})`;
  group.append(strong);

  const list = document.createElement('span');
  list.className = 'voter-list';
  if (!users.length) {
    list.textContent = 'personne';
  } else {
    const seen = new Set();
    for (const user of users) {
      if (!user?.login || seen.has(user.login)) continue;
      seen.add(user.login);
      const link = document.createElement('a');
      link.href = user.html_url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = `@${user.login}`;
      list.append(link);
    }
  }
  group.append(list);
  return group;
}

function valueAtPath(documentValue, path) {
  let current = documentValue;
  for (const part of path) {
    if (current === null || typeof current !== 'object' || !(part in current)) return MISSING;
    current = current[part];
  }
  return isPrimitive(current) ? primitiveText(current) : JSON.stringify(current);
}

function sameValue(a, b) {
  if (a === MISSING || b === MISSING) return a === b;
  return String(a) === String(b);
}

function classifyOperation(before, after) {
  if (before === MISSING) return 'ajout';
  if (after === MISSING) return 'suppression';
  return 'modification';
}

function makeOperationBadge(operation) {
  const badge = document.createElement('span');
  badge.className = 'operation-badge';
  badge.dataset.operation = operation;
  badge.textContent = operation === 'ajout' ? 'Ajout' : operation === 'suppression' ? 'Suppression' : 'Modification';
  return badge;
}

function renderComparison(before, after) {
  const wrapper = document.createElement('div');
  wrapper.className = 'comparison';

  const beforeText = before === MISSING ? '' : String(before);
  const afterText = after === MISSING ? '' : String(after);
  const diff = diffText(beforeText, afterText);

  const summary = document.createElement('p');
  summary.className = 'diff-summary';
  summary.textContent = `${diff.added} mot(s) ajouté(s) · ${diff.removed} mot(s) retiré(s)`;

  const output = document.createElement('div');
  output.className = 'diff-output';
  for (const part of diff.parts) {
    if (part.type === 'equal') output.append(document.createTextNode(part.text));
    else {
      const node = document.createElement(part.type === 'insert' ? 'ins' : 'del');
      node.textContent = part.text;
      output.append(node);
    }
  }

  const values = document.createElement('div');
  values.className = 'before-after';
  values.append(
    makeValueBlock('Avant', before === MISSING ? '∅ valeur inexistante' : beforeText, 'before'),
    makeValueBlock('Après', after === MISSING ? '∅ valeur supprimée' : afterText, 'after')
  );

  wrapper.append(summary, output, values);
  return wrapper;
}

function makeValueBlock(label, value, kind) {
  const block = document.createElement('div');
  block.className = `value-block value-block--${kind}`;
  const title = document.createElement('strong');
  title.textContent = label;
  const text = document.createElement('pre');
  text.textContent = value;
  block.append(title, text);
  return block;
}

function diffText(before, after) {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length * b.length > 1_800_000) return coarseDiff(before, after);

  const rows = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = a[i - 1] === b[j - 1]
        ? rows[i - 1][j - 1] + 1
        : Math.max(rows[i - 1][j], rows[i][j - 1]);
    }
  }

  const reversed = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      reversed.push({ type: 'equal', text: a[i - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || rows[i][j - 1] >= rows[i - 1][j])) {
      reversed.push({ type: 'insert', text: b[j - 1] });
      j -= 1;
    } else {
      reversed.push({ type: 'delete', text: a[i - 1] });
      i -= 1;
    }
  }

  const parts = mergeDiffParts(reversed.reverse());
  return {
    parts,
    added: countWords(parts.filter(part => part.type === 'insert').map(part => part.text).join('')),
    removed: countWords(parts.filter(part => part.type === 'delete').map(part => part.text).join(''))
  };
}

function tokenize(text) {
  return String(text).match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [];
}

function mergeDiffParts(parts) {
  const merged = [];
  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (previous && previous.type === part.type) previous.text += part.text;
    else merged.push({ ...part });
  }
  return merged;
}

function coarseDiff(before, after) {
  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;

  const parts = [];
  if (prefix) parts.push({ type: 'equal', text: before.slice(0, prefix) });
  const removedText = before.slice(prefix, before.length - suffix || before.length);
  const addedText = after.slice(prefix, after.length - suffix || after.length);
  if (removedText) parts.push({ type: 'delete', text: removedText });
  if (addedText) parts.push({ type: 'insert', text: addedText });
  if (suffix) parts.push({ type: 'equal', text: before.slice(before.length - suffix) });
  return { parts, added: countWords(addedText), removed: countWords(removedText) };
}

function countWords(text) {
  return (String(text).match(/[\p{L}\p{N}_]+/gu) || []).length;
}

function githubFileUrl(path, ref) {
  return `https://github.com/${CONFIG.owner}/${CONFIG.repo}/blob/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function githubCommitsUrl(path) {
  return `https://github.com/${CONFIG.owner}/${CONFIG.repo}/commits/${encodeURIComponent(CONFIG.branch)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function commitAuthor(commit) {
  return commit.author?.login ? `@${commit.author.login}` : commit.commit.author?.name || 'Auteur inconnu';
}

function shortSha(sha) {
  return String(sha || '').slice(0, 7);
}

function firstLine(text) {
  return String(text || '').split('\n')[0];
}

function formatDate(value) {
  if (!value) return 'date inconnue';
  return new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
