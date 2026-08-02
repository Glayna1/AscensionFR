'use strict';

const CONFIG = Object.freeze({
  dataOwner: 'LePetitDan',
  dataRepo: 'AscensionFR-Textes',
  dataBranch: 'main',
  dataDirectory: 'traductions',
  issuePrefix: '[TRAD]',
  maxResults: 200,
  maxRegistryPages: 10,
  api: 'https://api.github.com',
  raw: 'https://raw.githubusercontent.com'
});

const state = {
  categories: [],
  cache: new Map(),
  selectedEntry: null,
  proposals: []
};

const el = {};

window.addEventListener('DOMContentLoaded', () => {
  Object.assign(el, {
    catalogueState: document.querySelector('#catalogue-state'),
    searchForm: document.querySelector('#search-form'),
    query: document.querySelector('#query'),
    category: document.querySelector('#category'),
    searchButton: document.querySelector('#search-button'),
    clearButton: document.querySelector('#clear-button'),
    searchState: document.querySelector('#search-state'),
    results: document.querySelector('#results'),
    refreshProposals: document.querySelector('#refresh-proposals'),
    proposalsState: document.querySelector('#proposals-state'),
    proposals: document.querySelector('#proposals'),
    dialog: document.querySelector('#proposal-dialog'),
    proposalForm: document.querySelector('#proposal-form'),
    proposalCategory: document.querySelector('#proposal-category'),
    proposalPath: document.querySelector('#proposal-path'),
    proposalSha: document.querySelector('#proposal-sha'),
    beforeValue: document.querySelector('#before-value'),
    afterValue: document.querySelector('#after-value'),
    reason: document.querySelector('#reason'),
    operationBadge: document.querySelector('#operation-badge'),
    diffSummary: document.querySelector('#diff-summary'),
    diffOutput: document.querySelector('#diff-output'),
    proposalWarning: document.querySelector('#proposal-warning'),
    openIssue: document.querySelector('#open-issue')
  });

  el.searchForm.addEventListener('submit', runSearch);
  el.clearButton.addEventListener('click', clearSearch);
  el.results.addEventListener('click', onResultAction);
  el.refreshProposals.addEventListener('click', loadProposals);
  el.proposals.addEventListener('click', onProposalAction);
  el.afterValue.addEventListener('input', updateDiffPreview);
  el.proposalForm.addEventListener('submit', publishProposal);
  el.dialog.addEventListener('click', event => {
    if (event.target.closest('[data-close-dialog]')) el.dialog.close();
  });

  loadCategories();
  loadProposals();
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
    const detail = remaining === '0' ? 'Limite publique GitHub atteinte. Réessaie plus tard.' : `GitHub répond ${response.status}.`;
    throw new Error(detail);
  }
  return response.json();
}

async function loadCategories() {
  try {
    const url = `${CONFIG.api}/repos/${CONFIG.dataOwner}/${CONFIG.dataRepo}/contents/${CONFIG.dataDirectory}?ref=${encodeURIComponent(CONFIG.dataBranch)}`;
    const files = await apiFetch(url);
    state.categories = files
      .filter(item => item.type === 'file' && item.name.toLowerCase().endsWith('.json'))
      .map(item => ({ name: item.name, path: item.path, blobSha: item.sha, size: item.size }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    el.category.replaceChildren(option('', 'Toutes les catégories'));
    for (const category of state.categories) {
      el.category.append(option(category.name, category.name));
    }
    el.category.disabled = false;
    el.searchButton.disabled = false;
    el.catalogueState.textContent = `${state.categories.length} catégories publiques`;
    el.catalogueState.dataset.state = 'ok';
    el.searchState.textContent = 'Choisis un fichier ou recherche dans toutes les catégories. Pour une recherche globale, saisis au moins 3 caractères.';
  } catch (error) {
    el.catalogueState.textContent = 'Catalogue indisponible';
    el.catalogueState.dataset.state = 'error';
    el.searchState.textContent = error.message;
  }
}

function option(value, label) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

async function loadCategory(category) {
  if (state.cache.has(category.name)) return state.cache.get(category.name);
  const url = `${CONFIG.raw}/${CONFIG.dataOwner}/${CONFIG.dataRepo}/${CONFIG.dataBranch}/${category.path}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Impossible de lire ${category.name} (${response.status}).`);
  const data = await response.json();
  const entries = flattenJson(data, category);
  const result = { category, entries };
  state.cache.set(category.name, result);
  return result;
}

function flattenJson(value, category, path = [], output = []) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    const text = value === null ? '' : String(value);
    const displayPath = path.map(pathPart).join(' › ');
    output.push({
      id: `${category.name}:${JSON.stringify(path)}`,
      category: category.name,
      categoryPath: category.path,
      blobSha: category.blobSha,
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

function pathPart(part) {
  return typeof part === 'number' ? `[${part}]` : String(part);
}

function normalize(value) {
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr');
}
