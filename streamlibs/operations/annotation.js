/* eslint-disable no-console */
/* eslint-disable function-paren-newline */
/* eslint-disable no-restricted-syntax */
import { fetchFigmaContent } from '../sources/figma.js';
import {
  fetchDAContent,
  daPageExists,
  copyDaPage,
} from '../sources/da.js';
import { hydrateFragmentLinksInDaBlocks } from './edit/fragment-hydrate.js';
import { miloLoadArea } from '../utils/utils.js';
import { getDACompatibleHtml, postData } from '../target/da.js';
import { fetchImageAsBase64 } from './edit/dom.js';
import { createAnnotationState, createAnnotationUI } from './annotation/state.js';
import { createAnnotationStore } from './annotation/store.js';
import createCommentsPanelController from './annotation/comments-panel.js';
import createInlineEditingController from './annotation/inline-editing.js';
import createAnnotationServiceClient from './annotation/service.js';
import createAssetServiceClient from './annotation/asset-service.js';
import createAssetsPanelController from './annotation/assets-panel.js';
import requestParentCollabRefresh from './annotation/collab-sync.js';
import { handleError } from '../utils/error-handler.js';
import { BLOCK_CLASSES, isMetadata } from '../utils/constants.js';

// ── Module singletons ────────────────────────────────────────────────────────

const annotationState = createAnnotationState();
const annotationUI = createAnnotationUI();
const store = createAnnotationStore({ annotationState, annotationUI });
const annotationService = createAnnotationServiceClient();
const assetService = createAssetServiceClient();
const assetsPanel = createAssetsPanelController({
  annotationState,
  annotationUI,
  store,
  assetService,
});
const previewUrlCache = new Map();

async function resolvePreviewUrl(url) {
  if (!url) return url;
  // DA editor-format images store the real URL in the # fragment of an fpo.svg
  // placeholder; decode it and map the source host to the delivery host.
  if (url.includes('fpo.svg#')) {
    url = (url.split('#')[1] || url).replace('admin.da.live/source/', 'content.da.live/');
  }
  if (!url.includes('content.da.live')) return url;
  if (previewUrlCache.has(url)) return previewUrlCache.get(url);
  const b64 = await fetchImageAsBase64(url);
  if (b64) previewUrlCache.set(url, b64);
  return b64 || url;
}

export async function setupCollabSpace() {
  if (
    !window.streamConfig.draftLocation
    || (window.streamConfig.draftLocation
    && window.streamConfig.targetUrl
    && window.streamConfig.draftLocation === window.streamConfig.targetUrl)
  ) {
    const { collabId } = window.streamConfig;
    if (!collabId) handleError('error', ' with setting up the collab');
    const targetHierarchy = window.streamConfig.targetUrl.split('/');
    const collabUrl = `${targetHierarchy[0]}/${targetHierarchy[1]}/drafts/collab/${collabId}/${targetHierarchy[targetHierarchy.length - 1]}`;
    const collabSpaceExists = await daPageExists(collabUrl);
    if (!collabSpaceExists) {
      if (await copyDaPage(window.streamConfig.targetUrl, collabUrl)) {
        window.streamConfig.draftLocation = collabUrl;
        await new Promise((resolve) => { setTimeout(resolve, 15000); });
      }
    } else {
      window.streamConfig.draftLocation = collabUrl;
    }
  }
}

export async function recordImageRegenAsLocalAsset(imgEl, generatedUrl, pendingAlt = '') {
  if (!(imgEl instanceof HTMLImageElement) || !generatedUrl) return;

  const base64Data = await fetchImageAsBase64(generatedUrl);
  if (!base64Data) return;

  const mimeType = base64Data.split(';')[0].split(':')[1] || 'image/jpeg';
  const ext = mimeType.split('/')[1]?.split('+')[0] || 'jpg';
  const binaryStr = atob(base64Data.split(',')[1]);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i += 1) bytes[i] = binaryStr.charCodeAt(i);
  const file = new File([bytes], `generated-${Date.now()}.${ext}`, { type: mimeType });

  await assetsPanel.registerLocalAssetFromRegen(imgEl, file, base64Data, pendingAlt, generatedUrl);
}

const commentsPanel = createCommentsPanelController({
  annotationState,
  annotationUI,
  store,
  assetsPanel,
});
commentsPanel.setImageRegenHandler(recordImageRegenAsLocalAsset);

let cachedCleanHtml = '';
// blockClass -> combined <div> holding the original HTML for that block.
const cachedMetadataBlocks = new Map();
const regenReplacements = [];
//Looks on the page for the live metadata block and makes copy 
function buildBlockToHtml(blockClass) {
  const liveBlock = document.querySelector(`main div.${blockClass}`);
  if (!liveBlock) return '';
  const clone = liveBlock.cloneNode(true);
  clone.querySelectorAll('.stream-annotation-delete-metadata-row').forEach((el) => el.remove());
  clone.querySelectorAll('picture').forEach((picture) => {
    const img = picture.querySelector('img');
    if (img) picture.replaceWith(img);
    else picture.remove();
  });
  clone.querySelectorAll('img').forEach((img) => {
    const originalSrc = img.getAttribute('data-stream-original-srcset')
      || img.getAttribute('data-stream-original-src');
    if (originalSrc) img.setAttribute('src', originalSrc);
  });
  clone.querySelectorAll('*').forEach((el) => {
    [...el.attributes]
      .filter((attr) => attr.name.startsWith('data-'))
      .forEach((attr) => el.removeAttribute(attr.name));
  });
  return getDACompatibleHtml(clone.outerHTML);
}
const METADATA_USER_ROW_CLASS = 'stream-metadata-user-row';
const METADATA_ROW_DELETE_BTN_CLASS = 'stream-annotation-delete-metadata-row';

function removeUserMetadataRow(row) {
  if (!(row instanceof HTMLElement) || !row.classList.contains(METADATA_USER_ROW_CLASS)) return;
  const blockClass = isMetadata(row);
  row.remove();
  if (blockClass) {
    // Refresh the block's edit(s) so the deletion is reflected in toHtml (display + push).
    const toHtml = buildBlockToHtml(blockClass);
    (annotationState.store.easyEdits || []).forEach((e) => {
      if (e.blockClass === blockClass && e.toHtml) e.toHtml = toHtml;
    });
    store.saveAnnotationStore();
  }
  commentsPanel.renderThreadMarkers({ resolveTargets: true });
}

function ensureUserMetadataRowDeleteButton(row) {
  if (!(row instanceof HTMLElement) || !row.classList.contains(METADATA_USER_ROW_CLASS)) return;
  if (row.querySelector(`:scope > .${METADATA_ROW_DELETE_BTN_CLASS}`)) return;
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = METADATA_ROW_DELETE_BTN_CLASS;
  deleteBtn.setAttribute('aria-label', 'Delete metadata row');
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeUserMetadataRow(row);
  });
  row.append(deleteBtn);
}

// Re-attach delete controls after a block re-render (called via store callback).
function decorateMetadataUserRows(block) {
  if (!(block instanceof HTMLElement)) return;
  block.querySelectorAll(`:scope > .${METADATA_USER_ROW_CLASS}`).forEach(ensureUserMetadataRowDeleteButton);
}

// On Save, user-added rows become permanent: drop the marker + delete control.
function commitMetadataRows() {
  if (!annotationUI.mainEl) return;
  annotationUI.mainEl.querySelectorAll(`.stream-metadata-section .${METADATA_USER_ROW_CLASS}`).forEach((row) => {
    row.querySelectorAll(`.${METADATA_ROW_DELETE_BTN_CLASS}`).forEach((b) => b.remove());
    row.classList.remove(METADATA_USER_ROW_CLASS);
  });
}

store.setOnMetadataBlockRendered(decorateMetadataUserRows);

const inlineEditing = createInlineEditingController({
  annotationState,
  annotationUI,
  store,
  renderThreadMarkers: commentsPanel.renderThreadMarkers,
  renderCommentsPanel: commentsPanel.renderCommentsPanel,
  removePopup: commentsPanel.removePopup,
  getBlockFromHtml: (blockClass) => cachedMetadataBlocks.get(blockClass)?.outerHTML || '',
  buildBlockToHtml,
});

commentsPanel.setInlineModeHandlers({
  enableInlineEditMode: inlineEditing.enableInlineEditMode,
  disableInlineEditMode: inlineEditing.disableInlineEditMode,
});

assetsPanel.setOnAssetsChanged(() => {
  commentsPanel.renderThreadMarkers({ resolveTargets: true });
  commentsPanel.renderCommentsPanel();
});
//pull mtdt/card-mtdt blocks out saves for later and keeps rest of html as cleaned page
function parseAndCacheCleanHtml(htmlDom) {
  cachedMetadataBlocks.clear();
  BLOCK_CLASSES.forEach((blockClass) => {
    const blocks = [...htmlDom.querySelectorAll(`div.${blockClass}`)];
    let combinedInnerHtml = '';
    blocks.forEach((block) => {
      combinedInnerHtml += block.innerHTML;
      const parent = block.parentElement;
      block.remove();
      if (parent && parent.children.length === 0) parent.remove();
    });
    const cached = document.createElement('div');
    cached.className = blockClass;
    cached.innerHTML = combinedInnerHtml;
    cachedMetadataBlocks.set(blockClass, cached);
  });
  cachedCleanHtml = htmlDom.innerHTML;
}

// ── Preview DOM helpers (annotationOperation only) ───────────────────────────

function normalizeDAImages(root) {
  root.querySelectorAll('img').forEach((img) => {
    if (img.src.includes('content.da.live') && img.parentElement.tagName !== 'PICTURE') {
      const pic = document.createElement('picture');
      img.parentElement.replaceWith(pic);
      pic.appendChild(img);
    }
  });
}

async function getDADom() {
  const { source } = window.streamConfig;
  if (source === 'figma') {
    const { htmlDom: html } = await fetchFigmaContent();
    return html;
  }
  if (source === 'da') {
    const cfg = window.streamConfig;
    const html = await fetchDAContent(cfg.draftLocation || cfg.contentUrl);
    normalizeDAImages(html);
    return html;
  }
  return null;
}

async function initializePreview() {
  document.body.querySelectorAll(':scope > header, :scope > main').forEach((el) => el.remove());
  const htmlDom = await getDADom();
  const headerEle = document.createElement('header');
  const mainEle = document.createElement('main');
  const rawHtml = (htmlDom instanceof HTMLElement && htmlDom.tagName === 'MAIN')
    ? htmlDom
    : null;
  if (rawHtml) parseAndCacheCleanHtml(rawHtml);
  mainEle.innerHTML = rawHtml ? rawHtml.innerHTML : htmlDom;
  document.body.prepend(mainEle);
  document.body.prepend(headerEle);
}

// ── URL / HTML helpers ────────────────────────────────────────────────────────

function extractFilename(url) {
  if (!url) return '';
  return (url.split('?')[0]?.split('#')[0] ?? '').split('/').pop() || '';
}

function toDaMediaUrl(url) {
  if (!url) return url;
  try {
    const filename = new URL(url).pathname.split('/').pop();
    if (!filename) return url;
    return `./media_${filename}`;
  } catch {
    return url;
  }
}

function rewriteAttr(el, attr, origin) {
  const val = el.getAttribute(attr);
  if (!val) return;
  if (val.startsWith('data:')) { el.setAttribute('data-regen-src', val); return; }
  if (!origin) return;
  if (val.startsWith('./media')) {
    el.setAttribute(attr, `${origin}/${val.slice(2)}`);
  } else if (val.startsWith('/') && !val.startsWith('//')) {
    el.setAttribute(attr, `${origin}${val}`);
  }
}

function rewriteMediaUrls(container) {
  const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
  container.querySelectorAll('img').forEach((img) => {
    rewriteAttr(img, 'src', origin);
    if (img.hasAttribute('srcset')) rewriteAttr(img, 'srcset', origin);
  });
  container.querySelectorAll('source').forEach((source) => {
    rewriteAttr(source, 'srcset', origin);
  });
}

// ── Asset element resolution ──────────────────────────────────────────────────

function replaceAssetUrl(element, assetUrl) {
  const img = element.tagName === 'IMG' ? element : element.querySelector('img');
  if (img) {
    img.setAttribute('src', assetUrl);
    if (img.hasAttribute('srcset')) img.setAttribute('srcset', assetUrl);
  }
  element.querySelectorAll('source').forEach((source) => {
    source.setAttribute('srcset', assetUrl);
  });
}

function resolveBlockInSection(section, blockClass, blockIndex) {
  if (blockClass) {
    const matching = Array.from(section.querySelectorAll(`:scope > div.${blockClass}`));
    const block = matching[blockIndex] ?? matching[0] ?? null;
    if (block) return block;
  }
  const divs = Array.from(section.children).filter((el) => el.tagName === 'DIV');
  return divs[blockIndex] ?? null;
}

function findBlockByGlobalIndex(main, blockClass, blockGlobalIndex) {
  if (!blockClass || !(blockGlobalIndex >= 0)) return null;
  const allSimilarBlocks = Array.from(main.children).flatMap((section) => (
    Array.from(section.children).filter(
      (child) => child instanceof HTMLElement
        && Array.from(child.classList || []).find(Boolean) === blockClass,
    )
  ));
  return allSimilarBlocks[blockGlobalIndex] || null;
}

function findImgInBlock(block) {
  const pic = block.querySelector('picture');
  if (pic && pic.querySelector('img')) return pic;
  return block.querySelector('img');
}

function findAssetElement(doc, elementPath, elementProps, originalSrc) {
  const main = doc.querySelector('main');
  if (!main) return null;

  if (elementPath) {
    const selector = elementPath.startsWith('main > ')
      ? elementPath.slice('main > '.length) : elementPath;
    try {
      const el = main.querySelector(selector);
      if (el) return el;
    } catch { /* invalid selector */ }
  }

  const sectionIndex = typeof elementProps?.sectionIndex === 'number'
    ? elementProps.sectionIndex : -1;
  const blockClass = typeof elementProps?.blockClass === 'string' ? elementProps.blockClass : '';
  const blockIndex = typeof elementProps?.blockIndex === 'number' ? elementProps.blockIndex : 0;
  const blockGlobalIndex = typeof elementProps?.blockGlobalIndex === 'number'
    ? elementProps.blockGlobalIndex : -1;

  if (blockClass && blockGlobalIndex >= 0) {
    const block = findBlockByGlobalIndex(main, blockClass, blockGlobalIndex);
    if (block) {
      const el = findImgInBlock(block);
      if (el) return el;
    }
  }

  if (elementProps && sectionIndex >= 0) {
    const sections = Array.from(main.children).filter((el) => el.tagName === 'DIV');
    const section = sections[sectionIndex];
    if (section) {
      const block = resolveBlockInSection(section, blockClass, blockIndex);
      if (block) {
        const pic = block.querySelector('picture');
        if (pic && pic.querySelector('img')) return pic;
        const img = block.querySelector('img');
        if (img) return img;
      }
    }
  }

  if (originalSrc) {
    const allImages = main.querySelectorAll('img');
    const withoutParams = originalSrc.split('?')[0]?.split('#')[0] ?? '';
    const filename = withoutParams.split('/').pop() || '';
    const candidates = [];

    for (const img of allImages) {
      const src = img.getAttribute('src') || '';
      if (src && withoutParams && src.includes(withoutParams)) candidates.push(img);
    }
    if (candidates.length === 0 && filename) {
      for (const img of allImages) {
        const src = (img.getAttribute('src') || '').split('?')[0]?.split('#')[0] ?? '';
        if (src.split('/').pop() === filename) candidates.push(img);
      }
    }

    if (candidates.length === 1) return candidates[0].closest('picture') || candidates[0];

    if (candidates.length > 1 && sectionIndex >= 0) {
      const sections = Array.from(main.children).filter((el) => el.tagName === 'DIV');
      const section = sections[sectionIndex];
      if (section) {
        const block = resolveBlockInSection(section, blockClass, blockIndex);
        if (block) {
          const blockCandidate = candidates.find((img) => block.contains(img));
          if (blockCandidate) return blockCandidate.closest('picture') || blockCandidate;
        }
      }
    }

    if (candidates.length > 0) return candidates[0].closest('picture') || candidates[0];
  }

  return null;
}

// ── HTML export ───────────────────────────────────────────────────────────────

function buildHtmlWithEditsAndAssets(assetReplacements) {
  const easyEdits = annotationState.store.easyEdits || [];
  const html = store.applyEasyEditsToHtmlString(cachedCleanHtml, easyEdits);
  const container = document.createElement('div');
  container.innerHTML = `<main>${html}</main>`;

  for (const asset of assetReplacements) {
    // Assets with block+globalIndex were already applied viewport-aware in the string phase
    const assetBc = asset.elementProps?.blockClass;
    const assetBgi = asset.elementProps?.blockGlobalIndex;
    if (assetBc && assetBgi != null) continue; // eslint-disable-line no-continue
    const element = findAssetElement(
      container, asset.elementPath, asset.elementProps, asset.originalSrc,
    );
    if (element) {
      replaceAssetUrl(element, asset.targetUrl);
    } else {
      const filenameCandidates = [
        extractFilename(asset.originalSrc),
        extractFilename(asset.daUrl),
      ].filter(Boolean);
      let matched = false;
      if (filenameCandidates.length > 0) {
        for (const img of container.querySelectorAll('img')) {
          if (filenameCandidates.includes(extractFilename(img.getAttribute('src') || ''))) {
            img.setAttribute('src', asset.targetUrl);
            if (img.hasAttribute('srcset')) img.setAttribute('srcset', asset.targetUrl);
            const picture = img.closest('picture');
            if (picture) {
              picture.querySelectorAll('source').forEach((s) => s.setAttribute('srcset', asset.targetUrl));
            }
            matched = true;
          }
        }
      }
      if (!matched && asset.daUrl) {
        for (const img of container.querySelectorAll('img')) {
          if ((img.getAttribute('src') || '') === asset.daUrl) {
            img.setAttribute('src', asset.targetUrl);
            if (img.hasAttribute('srcset')) img.setAttribute('srcset', asset.targetUrl);
            const picture = img.closest('picture');
            if (picture) {
              picture.querySelectorAll('source').forEach((s) => s.setAttribute('srcset', asset.targetUrl));
            }
          }
        }
      }
    }
  }

  // image-src easyEdits take priority — they carry the final promoted URL and
  // reliable original src, so they overwrite the assetReplacements pass above.
  const imageSrcEdits = (annotationState.store.easyEdits || [])
    .filter((e) => e?.editType === 'image-src' && e.to);
  // Edits with blockClass+blockGlobalIndex were already applied viewport-aware in the string phase
  imageSrcEdits
    .filter((edit) => {
      const bc = edit.blockClass || edit.elementProps?.blockClass;
      const bgi = edit.blockGlobalIndex ?? edit.elementProps?.blockGlobalIndex;
      return !(bc && bgi != null);
    })
    .forEach((edit) => {
      const mergedProps = {
        ...edit.elementProps,
        ...(edit.blockClass ? { blockClass: edit.blockClass } : {}),
        ...(edit.blockGlobalIndex != null ? { blockGlobalIndex: edit.blockGlobalIndex } : {}),
      };
      const element = findAssetElement(container, edit.elementPath, mergedProps, edit.from);
      if (element) replaceAssetUrl(element, edit.to);
    });

  for (const regen of regenReplacements) {
    const regenFilename = extractFilename(regen.originalSrc);
    for (const img of container.querySelectorAll('img')) {
      const src = (img.getAttribute('src') || '').split('?')[0]?.split('#')[0] ?? '';
      if (src === regen.originalSrc || (regenFilename && src.split('/').pop() === regenFilename)) {
        const relUrl = toDaMediaUrl(regen.targetUrl);
        img.setAttribute('src', relUrl);
        if (img.hasAttribute('srcset')) img.setAttribute('srcset', relUrl);
        const picture = img.closest('picture');
        if (picture) {
          picture.querySelectorAll('source').forEach((s) => s.setAttribute('srcset', relUrl));
        }
        break;
      }
    }
  }

  rewriteMediaUrls(container);
  const mainEl = container.querySelector('main');

  // Metadata-like blocks live outside the page body: for each block we pulled out, clean
  // any separate inline instances then re-append its edited HTML  at
  // the end before pushing.
  cachedMetadataBlocks.forEach((cachedBlock, blockClass) => {
    mainEl.querySelectorAll(`div.${blockClass}`).forEach((block) => block.remove());
    //picks the most recent saved edit for that metadata block (elementPath matches blockClass and has toHtml), so that version is used when re-appending the block on save instead of the original cached HTML.
    const blockEdit = easyEdits.filter((e) => e.blockClass === blockClass && e.toHtml).at(-1);
    const finalHtml = blockEdit?.toHtml
      || (cachedBlock.innerHTML.trim() ? cachedBlock.outerHTML : '');
    // Wrap in a section <div> so DA treats it as a block inside a section (not a bare
    // section), otherwise the block's rows flatten into plain paragraphs on the page.
    if (finalHtml) mainEl.insertAdjacentHTML('beforeend', `<div>${finalHtml}</div>`);
  });

  mainEl.querySelectorAll('.stream-metadata-user-row').forEach((el) => el.classList.remove('stream-metadata-user-row'));
  mainEl.querySelectorAll('.stream-annotation-delete-metadata-row').forEach((el) => el.remove());

  return { easyEdits, daCompatibleHtml: getDACompatibleHtml(mainEl.innerHTML) };
}

// ── Session lifecycle ─────────────────────────────────────────────────────────

function prepareAnnotationSession({ preserveRemoteEditState = false } = {}) {
  const previousAnnotationMode = annotationUI.annotationMode || 'comments';
  const shouldRestoreInlineMode = annotationUI.inlineMode
    && window.streamConfig?.inlineEditingAllowed !== false;
  inlineEditing.resetInlineEditModeState();
  annotationUI.annotationMode = shouldRestoreInlineMode ? 'edit' : previousAnnotationMode;
  document.body.classList.add('annotation-mode');
  if (!preserveRemoteEditState) {
    annotationState.latestSavedEditsUpdatedAt = null;
    annotationState.pendingRemoteEditsSnapshot = null;
    annotationState.hasLoadedInitialEditsSnapshot = false;
  }
  return { shouldRestoreInlineMode };
}

async function finishAnnotationSession(mainEl, {
  preserveRemoteEditState,
  shouldRestoreInlineMode,
}) {
  await commentsPanel.setupAnnotationUI(mainEl, { preserveRemoteEditState });
  if (annotationState.latestRemoteCollabSnapshot) {
    commentsPanel.applyRemoteCollabSnapshot(annotationState.latestRemoteCollabSnapshot, {
      includeEdits: false,
    });
  }
  store.setPreviewUrlResolver(resolvePreviewUrl);
  store.rebindEasyEditsToCurrentDom();
  await store.applyEasyEditsToDom();
  store.saveAnnotationStore();
  if (shouldRestoreInlineMode) {
    const didEnableInlineMode = await inlineEditing.enableInlineEditMode();
    if (!didEnableInlineMode) {
      commentsPanel.renderThreadMarkers({ resolveTargets: true });
      commentsPanel.renderCommentsPanel();
    }
  } else {
    commentsPanel.renderThreadMarkers({ resolveTargets: true });
    commentsPanel.renderCommentsPanel();
  }

  for (const blockClass of cachedMetadataBlocks.keys()) {
    const divWrapper = document.createElement('div');
    divWrapper.classList.add('section');
    divWrapper.classList.add('stream-metadata-section');
    const blocktitle = document.createElement('h3');
    blocktitle.textContent = blockClass.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    divWrapper.appendChild(blocktitle);
    divWrapper.innerHTML += cachedMetadataBlocks.get(blockClass).outerHTML;
    mainEl.appendChild(divWrapper);

    const imgResolves = [...divWrapper.querySelectorAll('img')].map(async (img) => {
      const originalSrc = img.getAttribute('src') || '';
      const resolved = await resolvePreviewUrl(originalSrc);
      if (resolved && resolved !== originalSrc) {
        img.setAttribute('data-stream-original-src', originalSrc);
        img.setAttribute('src', resolved);
      }
    });
    const sourceResolves = [...divWrapper.querySelectorAll('source')].map(async (source) => {
      const originalSrcset = source.getAttribute('srcset') || '';
      const resolved = await resolvePreviewUrl(originalSrcset);
      if (resolved && resolved !== originalSrcset) {
        source.setAttribute('data-stream-original-srcset', originalSrcset);
        source.setAttribute('srcset', resolved);
      }
    });
    // eslint-disable-next-line no-await-in-loop
    await Promise.all([...imgResolves, ...sourceResolves]);

    // Add-row controls — generalized for any BLOCK_CLASSES block (rows append to this
    // block's live DOM; new <p> cells register as editable so edits persist via toHtml).
    const blockEl = divWrapper.querySelector(`div.${blockClass}`);
    if (blockEl) {
      const addAndRegisterRow = (row) => {
        row.classList.add(METADATA_USER_ROW_CLASS);
        blockEl.append(row);
        row.querySelectorAll('p').forEach((p) => inlineEditing.registerNewEditableElement(p));
        ensureUserMetadataRowDeleteButton(row);
        const toHtml = buildBlockToHtml(blockClass);
        (annotationState.store.easyEdits || []).forEach((e) => {
          if (e.blockClass === blockClass && e.toHtml) e.toHtml = toHtml;
        });
        store.saveAnnotationStore();
      };
      const addTextBtn = document.createElement('button');
      addTextBtn.className = 'stream-annotation-add-metadata-row';
      addTextBtn.textContent = '+ Add text/link row';
      addTextBtn.addEventListener('click', () => {
        const row = document.createElement('div');
        row.innerHTML = '<div><p>add metadata key</p></div><div><p>add text or link value</p></div>';
        addAndRegisterRow(row);
      });
      const addImageBtn = document.createElement('button');
      addImageBtn.className = 'stream-annotation-add-metadata-row';
      addImageBtn.textContent = '+ Add image row';
      addImageBtn.addEventListener('click', () => {
        const row = document.createElement('div');
        row.innerHTML = '<div><p>key</p></div><div><picture><img src="https://main--stream-mapper--adobecom.aem.live/assets/media_1bf6f8fe5a340bb3f4e022b300d7013821fe5ff89.png"></picture></div>';
        addAndRegisterRow(row);
      });
      const metadataActions = document.createElement('div');
      metadataActions.className = 'stream-annotation-metadata-actions';
      metadataActions.append(addTextBtn, addImageBtn);
      divWrapper.append(metadataActions);
    }
  }
  await store.applyEasyEditsToDom();

}

// ── Asset / edit processing (shared by persist and save) ──────────────────────

async function uploadAndDecideAssets() {
  let newlyUploadedIds = [];
  try {
    newlyUploadedIds = await assetsPanel.uploadLocalAssets();
  } catch (err) {
    console.error('[annotation] Upload of local assets failed:', err);
  }
  const appliedAssetIds = [...new Set([...assetsPanel.getAppliedAssetIds(), ...newlyUploadedIds])];
  if (appliedAssetIds.length > 0) {
    try {
      await assetService.batchDecideAssets(appliedAssetIds, 'accepted');
      assetsPanel.clearAppliedAssets();
    } catch (err) {
      console.error('[annotation] Batch decide failed:', err);
    }
  }
  return newlyUploadedIds;
}

function buildAssetReplacementsAndEdits(resolveTargetUrl) {
  const latestByPath = new Map();
  for (const asset of (annotationState.store.assets || [])) {
    // eslint-disable-next-line no-continue
    if (!asset.originalSrc || !asset.daUrl) continue;
    const existing = latestByPath.get(asset.elementPath);
    const isNewer = existing && asset.createdAt
      && new Date(asset.createdAt) > new Date(existing.createdAt || 0);
    if (!existing || isNewer) {
      latestByPath.set(asset.elementPath, asset);
    }
  }

  const resolvedAssets = Array.from(latestByPath.values()).map((asset) => {
    const liveEl = asset.elementRef
      ? document.querySelector(`[data-annotation-ref="${asset.elementRef}"]`)
      : null;
      //checks if this image inside a metadata block?
      //fig out real ori da img url instead or using preview url shown  onscreen
    const blockClass = isMetadata(liveEl);
    const imgEl = liveEl?.tagName === 'IMG' ? liveEl : liveEl?.querySelector('img');
    let { originalSrc } = asset;
    if (blockClass) {
      const fromAttr = imgEl?.getAttribute('data-stream-original-src');
      const cachedBlock = cachedMetadataBlocks.get(blockClass);
      if (fromAttr) {
        originalSrc = fromAttr;
      } else if (cachedBlock) {
        const cachedImg = cachedBlock.querySelector('img[src*="content.da.live"]');
        if (cachedImg) originalSrc = cachedImg.getAttribute('src') || asset.originalSrc;
      }
    }
    return { asset, blockClass, originalSrc };
  });

  const assetReplacements = resolvedAssets.map(({ asset }) => ({
    elementPath: asset.elementPath,
    elementProps: asset.elementProps,
    originalSrc: asset.originalSrc,
    daUrl: asset.daUrl,
    targetUrl: resolveTargetUrl(asset),
  }));

  for (const { asset, blockClass, originalSrc } of resolvedAssets) {
    const finalUrl = resolveTargetUrl(asset);
    if (!asset.elementPath || !finalUrl) continue; // eslint-disable-line no-continue
    const existingEdit = store.getEasyEditByElement(
      asset.elementRef || '', asset.elementPath, asset.elementProps,
    );
    // Keep the metadata classification even when the live ref didn't resolve (e.g. an added
    // image row whose data-annotation-ref was stripped + <picture> flattened on re-render) —
    // otherwise the edit downgrades to non-metadata and skips the metadata preview path → 401.
    const effectiveBlockClass = blockClass || existingEdit?.blockClass || '';
    if (!existingEdit || existingEdit.editType === 'image-src') {
      store.upsertEasyEdit({
        ...(existingEdit || {}),
        editType: 'image-src',
        elementPath: asset.elementPath,
        blockClass: effectiveBlockClass,
        elementProps: asset.elementProps || {},
        elementRef: asset.elementRef || '',
        from: effectiveBlockClass ? originalSrc : (existingEdit?.from || originalSrc),
        to: finalUrl,
        fromHtml: effectiveBlockClass
          ? (cachedMetadataBlocks.get(effectiveBlockClass)?.outerHTML || '') : '',
        toHtml: effectiveBlockClass ? buildBlockToHtml(effectiveBlockClass) : '',
        // Keep the original replacement time so panel ordering stays chronological.
        updatedAt: existingEdit?.updatedAt || new Date().toISOString(),
      });
    }
  }

  return assetReplacements;
}

// ── da.live URL normalizer ────────────────────────────────────────────────────

/** da.live edit URL → repo path (e.g. adobecom/...); leaves plain paths unchanged. */
function normalizePersistUrlForDaApi(raw) {
  const s = `${raw || ''}`.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return s.replace(/^\/+/, '');
  try {
    const u = new URL(s);
    if (u.hash?.startsWith('#/')) return decodeURIComponent(u.hash.slice(2)).replace(/^\/+/, '');
    if (u.hostname.includes('da.live') && u.pathname && u.pathname !== '/') {
      return decodeURIComponent(u.pathname).replace(/^\/+/, '');
    }
  } catch { /* ignore */ }
  return s;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function annotationOperation(options = {}) {
  const { preserveRemoteEditState = false } = options;
  const { shouldRestoreInlineMode } = prepareAnnotationSession({ preserveRemoteEditState });

  await initializePreview();
  const mainEl = document.querySelector('main');
  if (!mainEl) return;

  if (window.streamConfig?.source === 'da') {
    mainEl.querySelectorAll(':scope > div').forEach((div) => {
      if (!div.dataset.source) div.dataset.source = 'da';
    });
  }

  if (window.streamConfig?.source === 'da') {
    const insertedFragments = await hydrateFragmentLinksInDaBlocks(mainEl);
    for (const root of insertedFragments) {
      // eslint-disable-next-line no-await-in-loop
      await miloLoadArea(root);
    }
  }

  await miloLoadArea();

  await finishAnnotationSession(mainEl, { preserveRemoteEditState, shouldRestoreInlineMode });
}

export async function annotationOperationOnHostPage(options = {}) {
  const {
    preserveRemoteEditState = false,
    refreshBaselineHtml = false,
    baselineHtml = null,
  } = options;

  await new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!document.getElementById('page-load-ok-milo')) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document.body, { childList: true });
  });

  const { shouldRestoreInlineMode } = prepareAnnotationSession({ preserveRemoteEditState });

  const mainEl = document.querySelector('main');
  if (!mainEl) throw new Error('annotationOperationOnHostPage: no <main> found on page');

  if (!cachedCleanHtml || refreshBaselineHtml) {
    if (window.streamConfig?.source === 'da') {
      try {
        const cfg = window.streamConfig;
        const daMain = await fetchDAContent(cfg.draftLocation || cfg.contentUrl);
        if (daMain) parseAndCacheCleanHtml(daMain);
        else cachedCleanHtml = '';
      } catch (err) {
        console.warn('[annotation] Failed to fetch DA baseline HTML, falling back to live DOM:', err);
        cachedCleanHtml = '';
      }
    } else {
      cachedCleanHtml = baselineHtml || mainEl.innerHTML || '';
    }
  }

  await finishAnnotationSession(mainEl, { preserveRemoteEditState, shouldRestoreInlineMode });

  const stripBase64QueryParam = (el) => {
    const attr = el.tagName === 'SOURCE' ? 'srcset' : 'src';
    const val = el[attr];
    if (!val?.includes('base64')) return;
    const queryIdx = val.indexOf('?');
    if (queryIdx === -1) return;
    el[attr] = val.substring(0, queryIdx);
  };

  const mergedElements = [...document.querySelectorAll('main img, main source')];
  if (mergedElements.length) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => stripBase64QueryParam(m.target));
    });
    mergedElements.forEach((el) => {
      stripBase64QueryParam(el);
      observer.observe(el, { attributes: true, attributeFilter: ['src', 'srcset'] });
    });
  }
}

export async function persistAnnotationChangesToDA(versionLabel = null) {
  await inlineEditing.syncInlineEditsBeforePersist();
  await uploadAndDecideAssets();

  let promotedAssets = [];
  try {
    const result = await assetService.batchPromote();
    promotedAssets = result?.promoted || [];
  } catch (err) {
    console.error('[annotation] Batch promote failed:', err);
  }

  for (const promoted of promotedAssets) {
    const existing = (annotationState.store.assets || []).find((a) => a.id === promoted.id);
    if (existing) Object.assign(existing, promoted);
    else annotationState.store.assets.push(promoted);
  }

  const assetReplacements = buildAssetReplacementsAndEdits(
    (asset) => asset.finalDaUrl || asset.daUrl,
  );
  const { daCompatibleHtml } = buildHtmlWithEditsAndAssets(assetReplacements);

  const cfg = window.streamConfig || {};
  const rawPushUrl = `${cfg.pageUrl || cfg.targetUrl || ''}`.trim();
  if (!rawPushUrl) {
    throw new Error(
      'persistAnnotationChangesToDA: streamConfig.pageUrl is required (set via STREAM_HTML_REVIEW_INIT).',
    );
  }
  await postData(normalizePersistUrlForDaApi(rawPushUrl) || rawPushUrl, daCompatibleHtml, {
    suppressErrorPage: true,
    ...(versionLabel ? { versionLabel } : {}),
  });
  // eslint-disable-next-line no-use-before-define
  await persistEditsToDb();
}
async function persistEditsToDb() {
  const savePayload = store.buildSavePayload();
  const savedEditIds = savePayload.map((edit) => edit.id).filter(Boolean);

  if (annotationService.isAvailable()) {
    const persistedEditSnapshot = await annotationService.saveEdits(savePayload);
    if (persistedEditSnapshot) {
      store.clearChangeHistoryAfterSave(savedEditIds);
      annotationState.latestSavedEditsUpdatedAt = persistedEditSnapshot.updatedAt
        || persistedEditSnapshot.createdAt
        || null;
      commentsPanel.markSelfSavedEditsSnapshot(persistedEditSnapshot.editRecord);
      annotationState.pendingRemoteEditsSnapshot = null;
      annotationState.hasLoadedInitialEditsSnapshot = true;
    }
  }
  store.saveAnnotationStore();
}

export async function saveAnnotationChanges(reportProgress = () => {}) {
  
  commitMetadataRows();
  await inlineEditing.syncInlineEditsBeforePersist();
  await uploadAndDecideAssets();
  // Save assigns each image edit its content.da.live URL (no DA push here).
  buildAssetReplacementsAndEdits((asset) => asset.daUrl);
  await persistEditsToDb();
  reportProgress('editsSaved');
  requestParentCollabRefresh('edits-saved');
}

export function applyRemoteCollabSnapshot(snapshot) {
  commentsPanel.applyRemoteCollabSnapshot(snapshot);
}

export function recordTextRegenAsEdit(element, fromText, toText, fromHtml = '') {
  if (!(element instanceof HTMLElement) || !annotationUI.mainEl) return;

  const elementRef = store.ensureElementRef(element);
  const snapshot = annotationUI.inlineElementSnapshot.get(elementRef);

  const editAnchor = store.buildEditElementAnchor(element, annotationUI.mainEl);
  const existing = store.getEasyEditByElement(
    elementRef, editAnchor.elementPath, editAnchor.elementProps,
  );
  const stampedOriginal = store.getEasyEditOriginalForElement(element);
  // eslint-disable-next-line max-len
  const baselineText = existing?.from ?? stampedOriginal?.from ?? snapshot?.originalText ?? fromText;
  // eslint-disable-next-line max-len
  const baselineHtml = existing?.fromHtml ?? stampedOriginal?.fromHtml ?? snapshot?.originalHtml ?? fromHtml;
  const segments = store.getChangedSegments(baselineText, toText);

  const persistedEdit = store.upsertEasyEdit({
    id: existing?.id || store.generateId('easy-edit'),
    editType: 'text',
    attrName: '',
    elementPath: editAnchor.elementPath,
    elementProps: editAnchor.elementProps,
    elementRef,
    from: baselineText,
    to: toText,
    fromHtml: baselineHtml,
    toHtml: toText,
    changedFrom: segments.changedFrom,
    changedTo: segments.changedTo,
    updatedAt: new Date().toISOString(),
  });

  const editThread = store.getEditThreadByElementPath(
    persistedEdit?.elementPath, persistedEdit?.elementProps,
  );
  if (editThread) {
    annotationState.activeThreadId = editThread.id;
    annotationState.activeMessageId = '';
    annotationState.activeEditId = '';
  }
  store.saveAnnotationStore();
  commentsPanel.renderThreadMarkers({ resolveTargets: true });
  commentsPanel.renderCommentsPanel();
}

export function registerRegenReplacement(originalSrc, newUrl) {
  const existing = regenReplacements.findIndex((r) => r.originalSrc === originalSrc);
  if (existing >= 0) regenReplacements[existing].targetUrl = newUrl;
  else regenReplacements.push({ originalSrc, targetUrl: newUrl });
}

export function preparePendingRemoteEditsRefresh() {
  return commentsPanel.applyPendingRemoteEditsSnapshot();
}

export async function refreshAnnotationFloatingUI() {
  await new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
  commentsPanel.renderThreadMarkers({ resolveTargets: true });
}
