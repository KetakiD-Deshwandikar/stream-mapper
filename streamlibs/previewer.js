/* eslint-disable no-console */
/* eslint-disable no-use-before-define */
import {
  persistOnTarget,
  targetCompatibleHtml,
} from './target/da.js';
import {
  pushTargetHtmlToStore,
  fetchPreviewHtmlFromStore,
  pushPreviewHtmlToStore,
  fetchTargetHtmlFromStore,
  resetEditChangesInStore,
  resetPreviewHtmlInStore,
  resetTargetHtmlInStore,
} from './store/store.js';
import {
  getQueryParam,
  fixRelativeLinks,
  initializeTokens,
  miloLoadArea,
  getMapperEnv,
  transformImages,
} from './utils/utils.js';
import { handleError } from './utils/error-handler.js';
import { showGlobalSnackbar } from './utils/snackbar.js';
import {
  createStreamOperation,
  editStreamOperation,
  applyEditChanges,
  handleBackToEditor,
  preflightOperation,
  annotationOperation,
  annotationOperationOnHostPage,
  refreshAnnotationFloatingUI,
  saveAnnotationChanges,
  persistAnnotationChangesToDA,
  applyRemoteCollabSnapshot,
  preparePendingRemoteEditsRefresh,
  attachRegenHandlers,
  setupCollabSpace,
} from './utils/operations.js';
import {
  ANNOTATION_REFRESH_EVENT,
  ANNOTATION_READY_EVENT,
  ANNOTATION_MESSAGES,
  LOADER_PROGRESS_STEPS,
  LOADER_STEP_MESSAGES,
} from './utils/constants.js';
import { CONFIG } from './utils/config.js';
import {
  initializeLoader,
  updateLoader,
  hideLoader,
  notifyParentPreviewInteractive,
} from './utils/loader.js';
import { setupBlockActionModal, syncBlockSelectionChrome } from './utils/block-action-modal.js';
import { fetchDAContent } from './sources/da.js';

const PUSH_TO_DA_RESULT = 'PUSH_TO_DA_RESULT';

function normalizeDaPath(input = '') {
  const val = String(input || '').trim().replace(/\.html$/i, '');
  if (!val) return '';

  // https://da.live/edit#/org/repo/path → org/repo/path
  if (val.includes('da.live/edit#/')) {
    const path = val.split('da.live/edit#/')[1] || '';
    try { return decodeURIComponent(path); } catch { return path; }
  }

  // https://branch--repo--adobecom.aem.live/path or .aem.page/path → adobecom/repo/path
  const aemMatch = val.match(/^https?:\/\/.+?--(.+?)--adobecom\.aem\.(?:live|page)(\/[^?#]*)?/i);
  if (aemMatch) {
    const repo = aemMatch[1];
    const path = (aemMatch[2] || '').replace(/^\/+/, '').replace(/\.html$/i, '');
    return path ? `adobecom/${repo}/${path}` : `adobecom/${repo}`;
  }

  return val;
}

function isAnnotationOp() {
  const { operation } = window.streamConfig || {};
  return operation === 'annotation' || operation === 'aiSeoAnnotation';
}

function notifyParentPushToDaResult(success, detailMessage) {
  if (!window.parent || window.parent === window) return;
  window.parent.postMessage(
    {
      type: PUSH_TO_DA_RESULT,
      success: !!success,
      message: detailMessage ? String(detailMessage) : '',
    },
    '*',
  );
}

function parseBooleanFlag(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function isCollabOwnerRole(role) {
  const normalizedRole = `${role || ''}`
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  if (!normalizedRole) return false;
  return normalizedRole === 'owner'
    || normalizedRole === 'collab owner'
    || normalizedRole.endsWith(' owner');
}

function resolveInlineEditingAllowed(previewParams = {}) {
  const explicitFlag = parseBooleanFlag(previewParams.inlineEditingAllowed);
  if (explicitFlag !== null) return explicitFlag;
  if (previewParams.collabRole) return isCollabOwnerRole(previewParams.collabRole);
  return false;
}

function hideDOMElements(eles = []) {
  if (!eles.length) return;
  eles.forEach((ele) => {
    if (!ele) return;
    ele.style.display = 'none';
    ele.classList.remove('is-visible');
  });
}

function showDOMElements(eles = []) {
  if (!eles.length) return;
  eles.forEach((ele) => {
    if (!ele) return;
    ele.style.display = 'block';
  });
}

async function postOperationProcessing(rawhtml) {
  let html = fixRelativeLinks(rawhtml);
  pushPreviewHtmlToStore(html);
  updateLoader({
    message: LOADER_STEP_MESSAGES.START_PAINTING,
    percentage: LOADER_PROGRESS_STEPS.START_PAINTING,
  });
  await startHTMLPainting();
  html = targetCompatibleHtml(html);
  pushTargetHtmlToStore(html);
  hideLoader();
}

function notifyAnnotationReady() {
  if (!window.parent || window.parent === window) return;
  window.parent.postMessage({
    type: ANNOTATION_READY_EVENT,
    storeId: getQueryParam('storeId'),
  }, '*');
}

export async function initiatePreviewer(forceOperation = null) {
  let html = '';
  switch (forceOperation || window.streamConfig.operation) {
    case 'create':
      html = await createStreamOperation();
      await postOperationProcessing(html);
      break;
    case 'edit':
      updateLoader({ message: 'Preparing the editor. Please wait' });
      await editStreamOperation();
      syncBlockSelectionChrome();
      hideLoader();
      return;
    case 'preflight':
      updateLoader();
      await preflightOperation();
      hideLoader();
      break;
    case 'annotation':
      updateLoader();
      await setupCollabSpace();
      await annotationOperation();
      hideLoader();
      notifyAnnotationReady();
      break;
    case 'aiSeoAnnotation':
      updateLoader({ percentage: 10, message: 'Loading Page' });
      await mergeImageUrls();
      updateLoader({ percentage: 50, message: 'Loading Page' });
      await setupCollabSpace();
      updateLoader({ percentage: 80, message: 'Loading Page' });
      annotationOperationOnHostPage();
      updateLoader({ percentage: 100, message: 'Loading Page' });
      attachRegenHandlers();
      hideLoader();
      notifyAnnotationReady();
      break;
    case 'aiSeoPreview':
      updateLoader({ percentage: 100, message: 'Loading Page' });
      hideLoader();
      break;
    default:
      break;
  }
}

async function startHTMLPainting() {
  paintHtmlOnPage();
  await miloLoadArea();
}

async function paintHtmlOnPage() {
  const headerEle = document.createElement('header');
  const mainEle = document.createElement('main');
  mainEle.innerHTML = fetchPreviewHtmlFromStore();
  document.body.prepend(mainEle);
  document.body.prepend(headerEle);
}

async function requestStreamConfigFromParent() {
  const storeId = getQueryParam('storeId');

  // If there is no parent window or no storeId, fall back to query params (legacy behavior)
  if (!window.parent || window.parent === window || !storeId) {
    const source = getQueryParam('source');
    const target = getQueryParam('target');
    const isSourceDa = source?.toLowerCase() === 'da';
    const isTargetDa = target?.toLowerCase() === 'da';
    const rawPageUrl = getQueryParam('pageUrl') || getQueryParam('page_url');
    const rawContentUrl = getQueryParam('contentUrl');
    const rawTargetUrl = getQueryParam('targetUrl');
    return {
      source,
      contentUrl: isSourceDa ? normalizeDaPath(rawContentUrl) : rawContentUrl,
      target,
      targetUrl: isTargetDa ? normalizeDaPath(rawTargetUrl) : rawTargetUrl,
      pageUrl: normalizeDaPath(rawPageUrl) || null,
      token: getQueryParam('token'),
      profileId: getQueryParam('profileId') || getQueryParam('profile_id'),
      collabId: getQueryParam('collabId') || getQueryParam('collab_id'),
      operation: getQueryParam('operation') || 'create',
      preflightUrl: getQueryParam('preflightUrl'),
      selectedPageBlocks: getQueryParam('selectedPageBlock') ? getQueryParam('selectedPageBlock').split(',') : [],
      selectedPageBlockIndices: getQueryParam('selectedPageBlockIndex') ? getQueryParam('selectedPageBlockIndex').split(',') : [],
      reviewId: getQueryParam('reviewId') || getQueryParam('reviewid'),
      startReview: getQueryParam('startReview') || getQueryParam('startreview'),
      inlineEditingAllowed: getQueryParam('inlineEditingAllowed'),
      collabRole: getQueryParam('collabRole'),
    };
  }

  const allowedOrigins = CONFIG[getMapperEnv()].streamMapper.allowMessagesFromDomains || [];

  // Ask parent for preview parameters using storeId
  return new Promise((resolve) => {
    const handler = (event) => {
      const isOriginAllowed = allowedOrigins.some((pattern) => {
        const regex = new RegExp(`^${pattern.replace('*', '.*')}$`);
        return regex.test(event.origin);
      });
      if (!isOriginAllowed) return;

      const data = event.data || {};
      if (data.type !== 'STREAM_PREVIEW_PARAMS') return;
      if (data.storeId && data.storeId !== storeId) return;

      window.removeEventListener('message', handler);
      const params = data.params || {};
      const isSourceDa = params.source?.toLowerCase() === 'da';
      const isTargetDa = params.target?.toLowerCase() === 'da';
      if (params.pageUrl) params.pageUrl = normalizeDaPath(params.pageUrl);
      if (params.collab?.pageUrl) params.collab.pageUrl = normalizeDaPath(params.collab.pageUrl);
      if (isSourceDa && params.contentUrl) params.contentUrl = normalizeDaPath(params.contentUrl);
      if (isTargetDa && params.targetUrl) params.targetUrl = normalizeDaPath(params.targetUrl);
      if (params.collab?.draftLocation) {
        params.collab.draftLocation = normalizeDaPath(params.collab.draftLocation) || null;
      }
      resolve(params);
    };

    window.addEventListener('message', handler);

    window.parent.postMessage({
      type: 'STREAM_PREVIEW_PARAMS',
      storeId,
    }, '*');
  });
}

async function setupMessageListener() {
  window.addEventListener('message', async (event) => {
    const allowedOrigins = window.streamConfig.streamMapper.allowMessagesFromDomains;
    const isOriginAllowed = allowedOrigins.some((pattern) => {
      const regex = new RegExp(`^${pattern.replace('*', '.*')}$`);
      return regex.test(event.origin);
    });
    if (!isOriginAllowed) return;

    if (event.data.type === 'PUSH_TO_DA') {
      try {
        await persist(event.data.versionLabel || null);
      } catch {
        // persist() notifies the parent on failure; swallow to avoid unhandled rejection
      }
    }
    if (event.data.type === 'SAVE_ANNOTATION_CHANGES') {
      await saveChanges();
    }
    if (event.data.type === 'RUN_PREFLIGHT') {
      const url = new URL(window.location.href);
      url.searchParams.set('forceOperation', 'preflight');
      window.location.href = url.toString();
    }
    if (event.data.type === 'EDIT_APPLY_CHANGES') {
      await applyEditChanges();
    }
    if (event.data.type === 'BACK_TO_EDIT') {
      await handleBackToEditor();
      syncBlockSelectionChrome();
    }
    if (event.data.type === 'RESET' && window.streamConfig?.operation !== 'aiSeoAnnotation') {
      window.location.reload();
    }
    if (event.data.type === 'STREAM_GET_TARGET_HTML') {
      const bodyHtml = fetchTargetHtmlFromStore() || '';
      event.source?.postMessage({
        type: 'STREAM_TARGET_HTML',
        requestId: event.data.requestId,
        storeId: getQueryParam('storeId'),
        bodyHtml,
      }, event.origin);
    }
    if (event.data.type === 'STREAM_COLLAB_SNAPSHOT') {
      if (!isAnnotationOp()) return;
      const collabPageUrl = event.data?.payload?.collab?.pageUrl;
      if (collabPageUrl) window.streamConfig.pageUrl = normalizeDaPath(collabPageUrl);
      const collabDraftLocation = event.data?.payload?.collab?.draftLocation;
      if (collabDraftLocation) {
        window.streamConfig.draftLocation = normalizeDaPath(collabDraftLocation) || null;
      }
      applyRemoteCollabSnapshot(event.data.payload || {});
    }
  });

  window.addEventListener(ANNOTATION_REFRESH_EVENT, async () => {
    await refreshAnnotationCanvas();
  });
}

export default async function initPreviewer() {
  resetTargetHtmlInStore();
  resetPreviewHtmlInStore();
  resetEditChangesInStore();
  initializeLoader();
  const previewParams = await requestStreamConfigFromParent();
  if (getQueryParam('forceOperation')) previewParams.operation = getQueryParam('forceOperation');
  window.streamConfig = {
    streamMapper: { ...CONFIG[getMapperEnv()].streamMapper },
    figmaServiceRetry: CONFIG.figmaServiceRetry,
    source: previewParams.source,
    contentUrl: previewParams.contentUrl,
    target: previewParams.target,
    targetUrl: previewParams.targetUrl,
    pageUrl: normalizeDaPath(
      previewParams.pageUrl
      || previewParams.page_url
      || previewParams.collab?.pageUrl,
    ) || null,
    token: previewParams.token,
    profileId: previewParams.profileId || previewParams.profile_id || null,
    collabId: previewParams.collabId || previewParams.collab_id || null,
    operation: previewParams.operation || 'create',
    preflightUrl: previewParams.preflightUrl,
    selectedPageBlocks: previewParams.selectedPageBlocks || [],
    selectedPageBlockIndices: previewParams.selectedPageBlockIndices || [],
    username: previewParams.username || null,
    reviewId: previewParams.reviewId || previewParams.reviewid || null,
    startReview: previewParams.startReview || previewParams.startreview || false,
    inlineEditingAllowed: resolveInlineEditingAllowed(previewParams),
    collabRole: previewParams.collabRole || null,
    draftLocation: previewParams.collab?.draftLocation || null,
  };
  await initializeTokens(window.streamConfig.token);
  await initiatePreviewer();
  setupBlockActionModal();
  await setupMessageListener();
}

export async function persist(versionLabel = null) {
  const isHostPageAnnotation = window.streamConfig?.operation === 'aiSeoAnnotation';
  const mainEl = document.querySelector('main');
  try {
    notifyParentPreviewInteractive(false);
    updateLoader({ message: 'Pushing content to DA' });
    if (!isHostPageAnnotation) hideDOMElements([mainEl]);
    if (isAnnotationOp()) {
      await persistAnnotationChangesToDA(versionLabel);
    } else {
      await persistOnTarget(versionLabel);
    }
    hideLoader();
    if (!isHostPageAnnotation) showDOMElements([mainEl]);
    notifyParentPushToDaResult(true);
  } catch (error) {
    hideLoader();
    if (!isHostPageAnnotation) showDOMElements([mainEl]);
    const detail = error?.message ? String(error.message) : '';
    notifyParentPushToDaResult(false, detail);
    handleError(error, 'persisting content');
    throw error;
  }
}

export async function saveChanges() {
  const isAnnotationOperation = isAnnotationOp();
  const isHostPageAnnotation = window.streamConfig?.operation === 'aiSeoAnnotation';
  try {
    updateLoader({
      message: LOADER_STEP_MESSAGES.SAVE_PREPARING,
      percentage: LOADER_PROGRESS_STEPS.SAVE_PREPARING,
    });
    if (!isHostPageAnnotation) hideDOMElements([document.querySelector('main')]);
    if (isAnnotationOperation) {
      await saveAnnotationChanges((stage) => {
        if (stage === 'editsSaved') {
          updateLoader({
            message: LOADER_STEP_MESSAGES.SAVE_METADATA_DONE,
            percentage: LOADER_PROGRESS_STEPS.SAVE_METADATA_DONE,
          });
        }
      });
      if (!isHostPageAnnotation) {
        updateLoader({
          message: LOADER_STEP_MESSAGES.START_PAINTING,
          percentage: LOADER_PROGRESS_STEPS.START_PAINTING,
        });
        await annotationOperation({ preserveRemoteEditState: true });
      }
    } else {
      await persistOnTarget();
    }
    if (!isHostPageAnnotation) showDOMElements([document.querySelector('main')]);
    if (isAnnotationOperation) {
      await refreshAnnotationFloatingUI();
    }
    hideLoader();
    if (isAnnotationOperation) {
      notifyAnnotationReady();
    }
  } catch (error) {
    hideLoader();
    if (!isHostPageAnnotation) showDOMElements([document.querySelector('main')]);
    if (isAnnotationOperation) {
      showGlobalSnackbar(ANNOTATION_MESSAGES.saveEditsError);
    } else {
      handleError(error, 'saving changes');
    }
    throw error;
  }
}

export async function refreshAnnotationCanvas() {
  if (!isAnnotationOp()) return;

  try {
    updateLoader({
      message: LOADER_STEP_MESSAGES.START_PAINTING,
      percentage: LOADER_PROGRESS_STEPS.START_PAINTING,
    });
    hideDOMElements([document.querySelector('main')]);
    preparePendingRemoteEditsRefresh();
    if (window.streamConfig.operation === 'aiSeoAnnotation') {
      await annotationOperationOnHostPage({ preserveRemoteEditState: true });
      attachRegenHandlers();
    } else {
      await annotationOperation({ preserveRemoteEditState: true });
    }
    showDOMElements([document.querySelector('main')]);
    await refreshAnnotationFloatingUI();
    hideLoader();
    notifyAnnotationReady();
  } catch (error) {
    hideLoader();
    showDOMElements([document.querySelector('main')]);
    showGlobalSnackbar(ANNOTATION_MESSAGES.refreshEditsError);
    throw error;
  }
}

function loadCssFiles(filePath) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = filePath;
  link.dataset.streamMapperStyles = '';
  document.head.appendChild(link);
}

export async function mergeImageUrls() {
  const { host, pathname } = window.location;
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get('daRenderingApp') !== 'stream' && searchParams.get('darenderingapp') !== 'stream') return;
  const repo = host.split('--')[1];
  const daUrl = `adobecom/${repo}${pathname}`;
  const daHtml = await fetchDAContent(daUrl);
  const daImg = daHtml.querySelectorAll('main img');
  const pageImg = [...document.querySelectorAll('main img')].filter((img) => !img.src.toLowerCase().includes('.svg'));
  daImg.forEach((img, idx) => {
    if (!pageImg[idx]) return;
    pageImg[idx].src = img.src;
    const pic = pageImg[idx].closest('picture');
    if (pic) {
      // eslint-disable-next-line no-return-assign
      pic.querySelectorAll('source').forEach((s) => s.srcset = img.src);
    }
  });
  await transformImages();
}

export async function selfRender() {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get('daRenderingApp') !== 'stream' && searchParams.get('darenderingapp') !== 'stream') return;
  if (window.location.host.includes('stream-mapper--adobecom.aem')) return;
  const mapperOrigin = searchParams.get('mapperOrigin') || searchParams.get('mapperorigin');
  loadCssFiles(`${mapperOrigin}/streamlibs/styles/styles.css`);
  await initPreviewer();
}
