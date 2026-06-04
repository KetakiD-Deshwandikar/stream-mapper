/* eslint-disable no-underscore-dangle */
/* eslint-disable no-console */
/* eslint-disable no-use-before-define */
/* eslint-disable no-restricted-syntax */
import { showGlobalSnackbar } from '../../utils/snackbar.js';
import { formatCardTimestamp, ARROW_ICON_SVG } from '../../utils/utils.js';

const ALLOWED_MIME_TYPES = [
  'image/png', 'image/jpeg',
];
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg'];

export default function createAssetsPanelController({
  annotationState,
  annotationUI,
  store,
  assetService,
}) {
  let fileInputEl = null;
  let pendingUploadTarget = null;
  let onAssetsChanged = null;

  function setOnAssetsChanged(handler) {
    onAssetsChanged = typeof handler === 'function' ? handler : null;
  }

  function notifyAssetsChanged() {
    if (typeof onAssetsChanged === 'function') {
      onAssetsChanged();
    }
  }

  function getFileInput() {
    if (!fileInputEl) {
      fileInputEl = document.createElement('input');
      fileInputEl.type = 'file';
      fileInputEl.accept = 'image/png,image/jpeg';
      fileInputEl.style.display = 'none';
      document.body.appendChild(fileInputEl);
      // eslint-disable-next-line no-use-before-define
      fileInputEl.addEventListener('change', handleFileSelected);
    }
    return fileInputEl;
  }

  function isCurrentUserCollabOwner() {
    const normalizedRole = `${window.streamConfig?.collabRole || ''}`
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ');
    if (!normalizedRole) {
      return window.streamConfig?.inlineEditingAllowed === true;
    }
    return normalizedRole === 'owner' || normalizedRole === 'collab owner';
  }

  function renderAssetsPanel() {
    if (!annotationUI.panelListEl) return;
    annotationUI.panelListEl.innerHTML = '';

    const isOwner = isCurrentUserCollabOwner();

    if (isOwner && annotationUI.annotationMode === 'assets') {
      // eslint-disable-next-line no-use-before-define
      if (!annotationUI.assetSelectMode) enterSelectMode();
    }

    if (isOwner && annotationUI.assetSelectMode) {
      const hint = document.createElement('p');
      hint.className = 'annotation-assets-select-hint';
      hint.textContent = 'Click an image on the page to upload a replacement.';
      annotationUI.panelListEl.appendChild(hint);
    }

    // One stack of From→To cards per image edit (newest on top).
    const imageEdits = (annotationState.store.easyEdits || [])
      .filter((edit) => edit && edit.editType === 'image-src');

    const editCardGroups = [...imageEdits]
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
      .map((edit) => buildAssetEditStepCards(edit))
      .filter((cards) => cards.length > 0);

    if (editCardGroups.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'annotation-comments-empty';
      empty.textContent = 'No assets uploaded yet.';
      annotationUI.panelListEl.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'annotation-assets-list';
    editCardGroups.forEach((cards) => cards.forEach((card) => list.appendChild(card)));
    annotationUI.panelListEl.appendChild(list);

    renderAssetMarkers();
  }

  // Sets href on an anchor to realUrl when it's a proper URL, or attaches a
  // blob-URL click handler when only a data URL (previewSrc) is available.
  function setAssetLinkHref(anchorEl, previewSrc, realUrl) {
    if (realUrl && !realUrl.startsWith('data:')) {
      anchorEl.href = realUrl;
      return;
    }
    if (previewSrc?.startsWith('data:')) {
      anchorEl.href = '#';
      anchorEl.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          const [header, b64] = previewSrc.split(',');
          const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
          window.open(blobUrl, '_blank');
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        } catch { /* ignore */ }
      });
      return;
    }
    anchorEl.href = previewSrc || '#';
  }

  // Stacked From→To cards for one image edit, newest first; no-op steps dropped.
  function buildAssetEditStepCards(edit) {
    const steps = [];
    let prev = { to: edit.from || '', fileKey: '' };
    (edit.changeHistory || []).forEach((entry) => {
      const cur = { to: entry.to || '', fileKey: entry.fileKey || '' };
      steps.push({ from: prev, to: cur, updatedAt: entry.updatedAt });
      prev = cur;
    });
    steps.push({
      from: prev,
      to: { to: edit.to || '', fileKey: edit.assetFileKey || '' },
      updatedAt: edit.updatedAt,
      isCurrent: true,
    });

    return steps
      .filter((step) => store.getAssetPreviewSrc(step.from) !== store.getAssetPreviewSrc(step.to))
      .reverse()
      .map((step) => buildAssetStepCard(edit, step));
  }

  function buildAssetStepCard(edit, step) {
    const card = document.createElement('article');
    card.className = `annotation-panel-comment annotation-panel-asset-item${step.isCurrent ? '' : ' annotation-asset-card-history'}`;

    // Only the current, uncommitted step is discardable.
    if (step.isCurrent && !edit.isCommitted) {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'annotation-panel-cancel-btn';
      cancelBtn.setAttribute('aria-label', 'Discard last image change');
      cancelBtn.title = 'Discard last change';
      cancelBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.0605 10L13.2803 7.78028C13.5733 7.48731 13.5733 7.0127 13.2803 6.71973C12.9873 6.42676 12.5127 6.42676 12.2197 6.71973L10 8.93946L7.78027 6.71973C7.4873 6.42676 7.01269 6.42676 6.71972 6.71973C6.42675 7.0127 6.42675 7.48731 6.71972 7.78028L8.93945 10L6.71972 12.2197C6.42675 12.5127 6.42675 12.9873 6.71972 13.2803C6.8662 13.4268 7.05761 13.5 7.24999 13.5C7.44237 13.5 7.63378 13.4268 7.78026 13.2803L9.99999 11.0606L12.2197 13.2803C12.3662 13.4268 12.5576 13.5 12.75 13.5C12.9424 13.5 13.1338 13.4268 13.2803 13.2803C13.5732 12.9873 13.5732 12.5127 13.2803 12.2197L11.0605 10Z" fill="currentColor"/><path d="M10 18.75C5.1748 18.75 1.25 14.8252 1.25 10C1.25 5.1748 5.1748 1.25 10 1.25C14.8252 1.25 18.75 5.1748 18.75 10C18.75 14.8252 14.8252 18.75 10 18.75ZM10 2.75C6.00195 2.75 2.75 6.00195 2.75 10C2.75 13.998 6.00195 17.25 10 17.25C13.998 17.25 17.25 13.998 17.25 10C17.25 6.00195 13.998 2.75 10 2.75Z" fill="currentColor"/></svg>';
      cancelBtn.addEventListener('click', () => discardAssetEditStep(edit));
      card.appendChild(cancelBtn);
    }

    const username = document.createElement('p');
    username.className = 'annotation-panel-comment-user';
    username.textContent = edit.authorUsername || window.streamConfig?.username || 'You';
    card.appendChild(username);

    const text = document.createElement('p');
    text.className = 'annotation-panel-comment-text annotation-panel-asset-links';
    const blockClass = edit.elementProps?.blockClass || edit.blockClass || '';
    if (blockClass) {
      const blockLabel = document.createElement('span');
      blockLabel.className = 'annotation-panel-block-label annotation-panel-block-label-asset';
      blockLabel.textContent = blockClass;
      text.appendChild(blockLabel);
    }
    const fromSrc = store.getAssetPreviewSrc(step.from);
    const toSrc = store.getAssetPreviewSrc(step.to);
    const fromLink = document.createElement('a');
    fromLink.textContent = 'From Image';
    fromLink.target = '_blank';
    fromLink.rel = 'noopener noreferrer';
    fromLink.className = 'annotation-asset-link';
    setAssetLinkHref(fromLink, fromSrc, step.from?.to || '');
    const arrow = document.createElement('span');
    arrow.className = 'annotation-asset-arrow';
    arrow.innerHTML = ARROW_ICON_SVG;
    const toLink = document.createElement('a');
    toLink.textContent = 'To Image';
    toLink.target = '_blank';
    toLink.rel = 'noopener noreferrer';
    toLink.className = 'annotation-asset-link';
    setAssetLinkHref(toLink, toSrc, step.to?.to || '');
    text.appendChild(fromLink);
    text.appendChild(arrow);
    text.appendChild(toLink);
    card.appendChild(text);

    const timestamp = formatCardTimestamp(step.updatedAt);
    if (timestamp) {
      const time = document.createElement('p');
      time.className = 'annotation-card-timestamp';
      time.textContent = timestamp;
      card.appendChild(time);
    }

    return card;
  }

  // Step back one entry in the image edit's history (or to the original).
  function discardAssetEditStep(edit) {
    if (!edit) return;
    const result = store.undoLastChange(edit.id);

    annotationState.store.localAssets = (annotationState.store.localAssets || [])
      .filter((a) => {
        if (a.elementPath !== edit.elementPath) return true;
        annotationUI.appliedAssets.delete(a.localId);
        return false;
      });

    const el = store.getElementForEdit(edit);
    const targetImg = el?.tagName === 'IMG' ? el : el?.querySelector('img');

    if (!result || result.from === result.to) {
      if (targetImg) revertAssetPreview(targetImg);
    } else {
      const src = store.getAssetPreviewSrc({ to: result.to, fileKey: result.assetFileKey });
      setAssetImgPreview(targetImg, src);
    }

    store.saveAnnotationStore();
    notifyAssetsChanged();
  }

  function buildLocalAssetCard(localAsset) {
    const card = document.createElement('article');
    card.className = 'annotation-panel-comment annotation-panel-asset-item annotation-asset-card-local';
    card.dataset.localAssetId = localAsset.localId;
    if (localAsset.createdAt) card.dataset.createdAt = localAsset.createdAt;

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'annotation-panel-cancel-btn';
    cancelBtn.setAttribute('aria-label', 'Discard last image change');
    cancelBtn.title = 'Discard last change';
    cancelBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.0605 10L13.2803 7.78028C13.5733 7.48731 13.5733 7.0127 13.2803 6.71973C12.9873 6.42676 12.5127 6.42676 12.2197 6.71973L10 8.93946L7.78027 6.71973C7.4873 6.42676 7.01269 6.42676 6.71972 6.71973C6.42675 7.0127 6.42675 7.48731 6.71972 7.78028L8.93945 10L6.71972 12.2197C6.42675 12.5127 6.42675 12.9873 6.71972 13.2803C6.8662 13.4268 7.05761 13.5 7.24999 13.5C7.44237 13.5 7.63378 13.4268 7.78026 13.2803L9.99999 11.0606L12.2197 13.2803C12.3662 13.4268 12.5576 13.5 12.75 13.5C12.9424 13.5 13.1338 13.4268 13.2803 13.2803C13.5732 12.9873 13.5732 12.5127 13.2803 12.2197L11.0605 10Z" fill="currentColor"/><path d="M10 18.75C5.1748 18.75 1.25 14.8252 1.25 10C1.25 5.1748 5.1748 1.25 10 1.25C14.8252 1.25 18.75 5.1748 18.75 10C18.75 14.8252 14.8252 18.75 10 18.75ZM10 2.75C6.00195 2.75 2.75 6.00195 2.75 10C2.75 13.998 6.00195 17.25 10 17.25C13.998 17.25 17.25 13.998 17.25 10C17.25 6.00195 13.998 2.75 10 2.75Z" fill="currentColor"/></svg>';
    cancelBtn.addEventListener('click', () => discardLastAssetStep(localAsset));
    card.appendChild(cancelBtn);

    const username = document.createElement('p');
    username.className = 'annotation-panel-comment-user';
    username.textContent = window.streamConfig?.username || 'You';
    card.appendChild(username);

    const text = document.createElement('p');
    text.className = 'annotation-panel-comment-text annotation-panel-asset-links';
    const blockClass = localAsset.elementProps?.blockClass || '';
    if (blockClass) {
      const blockLabel = document.createElement('span');
      blockLabel.className = 'annotation-panel-block-label annotation-panel-block-label-asset';
      blockLabel.textContent = blockClass;
      text.appendChild(blockLabel);
    }
    const fromSrc = store.getAssetPreviewSrc({ to: localAsset.originalSrc }) || localAsset.originalSrc || '';
    const toSrc = localAsset.base64Data || '';
    const fromLink = document.createElement('a');
    fromLink.textContent = 'From Image';
    fromLink.target = '_blank';
    fromLink.rel = 'noopener noreferrer';
    fromLink.className = 'annotation-asset-link';
    setAssetLinkHref(fromLink, fromSrc, localAsset.originalSrc || '');
    const arrow = document.createElement('span');
    arrow.className = 'annotation-asset-arrow';
    arrow.innerHTML = ARROW_ICON_SVG;
    const toLink = document.createElement('a');
    toLink.textContent = 'To Image';
    toLink.target = '_blank';
    toLink.rel = 'noopener noreferrer';
    toLink.className = 'annotation-asset-link';
    setAssetLinkHref(toLink, toSrc, '');
    text.appendChild(fromLink);
    text.appendChild(arrow);
    text.appendChild(toLink);
    card.appendChild(text);

    const timestamp = formatCardTimestamp(localAsset.createdAt);
    if (timestamp) {
      const time = document.createElement('p');
      time.className = 'annotation-card-timestamp';
      time.textContent = timestamp;
      card.appendChild(time);
    }

    return card;
  }

  function buildRemoteAssetCard(asset) {
    const card = document.createElement('article');
    card.className = `annotation-panel-comment annotation-panel-asset-item${asset.status === 'rejected' ? ' annotation-asset-rejected' : ''}`;
    card.dataset.assetId = asset.id;
    if (asset.createdAt) card.dataset.createdAt = asset.createdAt;

    const isApplied = annotationUI.appliedAssets.has(asset.id);

    const username = document.createElement('p');
    username.className = 'annotation-panel-comment-user';
    username.textContent = asset.username || 'Collaborator';
    card.appendChild(username);

    const text = document.createElement('p');
    text.className = 'annotation-panel-comment-text annotation-panel-asset-links';
    const blockClass = asset.elementProps?.blockClass || asset.blockClass || '';
    if (blockClass) {
      const blockLabel = document.createElement('span');
      blockLabel.className = 'annotation-panel-block-label annotation-panel-block-label-asset';
      blockLabel.textContent = blockClass;
      text.appendChild(blockLabel);
    }
    const fromSrc = store.getAssetPreviewSrc({ to: asset.originalSrc }) || asset.originalSrc || '';
    const toSrc = asset._base64Data || store.getAssetPreviewSrc({ to: asset.daUrl }) || '';
    const fromLink = document.createElement('a');
    fromLink.textContent = 'From Image';
    fromLink.target = '_blank';
    fromLink.rel = 'noopener noreferrer';
    fromLink.className = 'annotation-asset-link';
    setAssetLinkHref(fromLink, fromSrc, asset.originalSrc || '');
    const arrow = document.createElement('span');
    arrow.className = 'annotation-asset-arrow';
    arrow.innerHTML = ARROW_ICON_SVG;
    const toLink = document.createElement('a');
    toLink.textContent = 'To Image';
    toLink.target = '_blank';
    toLink.rel = 'noopener noreferrer';
    toLink.className = 'annotation-asset-link';
    setAssetLinkHref(toLink, toSrc, asset.daUrl || '');
    text.appendChild(fromLink);
    text.appendChild(arrow);
    text.appendChild(toLink);
    card.appendChild(text);

    const footer = document.createElement('div');
    footer.className = 'annotation-asset-card-footer';

    const actions = document.createElement('div');
    actions.className = 'annotation-asset-actions';

    if (asset.status === 'pending' && !isApplied && isCurrentUserCollabOwner()) {
      const applyBtn = document.createElement('button');
      applyBtn.className = 'annotation-asset-action-btn';
      applyBtn.textContent = 'Apply';
      applyBtn.title = 'Preview this asset on the page';
      applyBtn.addEventListener('click', () => applyAssetToPage(asset));
      actions.appendChild(applyBtn);
    }

    if (asset.status === 'pending') {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'annotation-asset-action-btn annotation-asset-action-delete';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => handleDeleteAsset(asset));
      actions.appendChild(deleteBtn);
    }

    footer.appendChild(actions);

    const timestamp = formatCardTimestamp(asset.updatedAt || asset.createdAt);
    if (timestamp) {
      const time = document.createElement('span');
      time.className = 'annotation-card-timestamp';
      time.textContent = timestamp;
      footer.appendChild(time);
    }

    card.appendChild(footer);

    return card;
  }

  function enterSelectMode() {
    if (!isCurrentUserCollabOwner()) return;

    annotationUI.assetSelectMode = true;
    document.body.classList.add('annotation-asset-select-mode');

    annotationUI.assetSelectHandler = (event) => {
      const img = event.target.closest('img');
      if (!img) return;
      if (img.closest('.annotation-comments-panel') || img.closest('.annotation-asset-pending-badge')) return;
      if (img.closest('[data-class="fragment"]')) return;
      const src = img.getAttribute('src') || '';
      if (/\.svg(\?.*)?$/i.test(src) || src.startsWith('data:image/svg')) return;

      event.preventDefault();
      event.stopPropagation();

      pendingUploadTarget = img;
      getFileInput().click();
    };

    if (annotationUI.mainEl) {
      annotationUI.mainEl.addEventListener('click', annotationUI.assetSelectHandler, true);
    }
  }

  function exitSelectMode() {
    annotationUI.assetSelectMode = false;
    document.body.classList.remove('annotation-asset-select-mode');

    if (annotationUI.assetSelectHandler && annotationUI.mainEl) {
      annotationUI.mainEl.removeEventListener('click', annotationUI.assetSelectHandler, true);
      annotationUI.assetSelectHandler = null;
    }
  }

  function validateFile(file) {
    const ext = `.${(file.name || '').split('.').pop() || ''}`.toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(ext)) {
      const friendlyTypes = ALLOWED_EXTENSIONS.join(', ');
      return `Unsupported file type "${ext}". Allowed types: ${friendlyTypes}`;
    }
    return null;
  }

  async function handleFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // reset for re-use
    if (!file || !pendingUploadTarget) return;

    const validationError = validateFile(file);
    if (validationError) {
      showGlobalSnackbar(validationError, { variant: 'error', duration: 5000 });
      return;
    }

    const targetImg = pendingUploadTarget;
    pendingUploadTarget = null;

    const anchorTarget = targetImg.closest('picture') || targetImg;
    const { elementPath, elementProps } = store.buildEditElementAnchor(anchorTarget);
    const elementRef = store.ensureElementRef(anchorTarget);

    if (!elementPath) {
      console.warn('[assets-panel] Could not determine element path for upload target');
      return;
    }

    const originalSrc = targetImg.dataset.originalSrc || elementProps?.src || targetImg.src || '';

    // Cache the absolute loaded URL so a page-relative originalSrc still renders.
    const fromDisplaySrc = targetImg.currentSrc || targetImg.src || '';
    if (originalSrc && fromDisplaySrc) store.cacheAssetUrlBase64(originalSrc, fromDisplaySrc);

    const base64Data = await readFileAsDataUrl(file);
    if (!base64Data) {
      console.warn('[assets-panel] Could not read file as data URL');
      return;
    }

    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const localAsset = {
      localId,
      file, // raw File object — sent to BE on Save Changes
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      elementPath,
      elementRef,
      elementProps,
      originalSrc,
      base64Data,
      targetImg,
      createdAt: new Date().toISOString(),
    };

    // eslint-disable-next-line max-len
    const supersededLocal = annotationState.store.localAssets.filter((a) => a.elementPath === elementPath);
    annotationState.store.localAssets = annotationState.store.localAssets
      .filter((a) => a.elementPath !== elementPath);
    for (const old of supersededLocal) {
      annotationUI.appliedAssets.delete(old.localId);
    }
    // eslint-disable-next-line max-len
    const supersededRemote = (annotationState.store.assets || []).filter((a) => a.elementPath === elementPath);
    annotationState.store.assets = (annotationState.store.assets || [])
      .filter((a) => a.elementPath !== elementPath);
    for (const old of supersededRemote) {
      annotationUI.appliedAssets.delete(old.id);
    }

    annotationState.store.localAssets.push(localAsset);

    // Track the replacement as an image edit (from=original, to='' until Save);
    // the File + base64 live in the in-memory maps under assetFileKey.
    const assetFileKey = store.generateId('asset-file');
    store.registerAssetFile(assetFileKey, file, base64Data);
    localAsset.assetFileKey = assetFileKey;
    store.upsertEasyEdit({
      editType: 'image-src',
      elementPath,
      elementProps,
      elementRef,
      from: originalSrc,
      to: '',
      fromHtml: '',
      toHtml: '',
      assetFileKey,
    });

    applyAssetPreviewToImg(targetImg, base64Data, localAsset);

    notifyAssetsChanged();
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  function removeLocalAsset(localId) {
    const idx = annotationState.store.localAssets.findIndex((a) => a.localId === localId);
    if (idx === -1) return;

    const localAsset = annotationState.store.localAssets[idx];
    if (localAsset.targetImg) {
      revertAssetPreview(localAsset.targetImg);
    }
    annotationUI.appliedAssets.delete(localId);

    annotationState.store.localAssets.splice(idx, 1);
    notifyAssetsChanged();
  }

  function setAssetImgPreview(targetImg, src) {
    if (!targetImg || !src) return;
    targetImg.src = src;
    if (targetImg.srcset) targetImg.srcset = src;
    const pictureEl = targetImg.closest('picture');
    if (pictureEl) {
      pictureEl.querySelectorAll('source').forEach((source) => { source.srcset = src; });
    }
  }

  // Discard goes back ONE step in the image edit's history (parity with text edits):
  // e.g. after Asset1→Asset2(saved)→Asset3, discarding restores Asset2, not Asset1.
  // Only when there is no prior step does it fall back to the original image.
  function discardLastAssetStep(localAsset) {
    const { elementPath, elementProps, elementRef } = localAsset;
    const edit = store.getEasyEditByElement(elementRef, elementPath, elementProps);
    if (!edit) {
      removeLocalAsset(localAsset.localId);
      return;
    }

    const result = store.undoLastChange(edit.id);

    // Drop the pending local asset for the step we just left.
    const superseded = annotationState.store.localAssets.filter((a) => a.elementPath === elementPath);
    annotationState.store.localAssets = annotationState.store.localAssets
      .filter((a) => a.elementPath !== elementPath);
    superseded.forEach((a) => annotationUI.appliedAssets.delete(a.localId));

    let targetImg = localAsset.targetImg;
    if (!targetImg) {
      const el = store.getElementForEdit(edit);
      targetImg = el?.tagName === 'IMG' ? el : el?.querySelector('img');
    }

    if (!result || result.from === result.to) {
      // No prior step left — revert to the original image.
      if (targetImg) revertAssetPreview(targetImg);
    } else {
      const src = store.getAssetPreviewSrc({ to: result.to, fileKey: result.assetFileKey });
      setAssetImgPreview(targetImg, src);
    }

    store.saveAnnotationStore();
    notifyAssetsChanged();
  }

  function applyAssetPreviewToImg(targetImg, base64Data, asset) {
    if (!targetImg || !base64Data) return;

    if (!targetImg.dataset.originalSrc) {
      // Store the attribute value (not the resolved .src property) so it
      // matches the literal src string in cachedCleanHtml for reliable lookup.
      targetImg.dataset.originalSrc = targetImg.getAttribute('src') || targetImg.src;
    }

    targetImg.src = base64Data;
    if (targetImg.srcset) targetImg.srcset = base64Data;

    const pictureEl = targetImg.closest('picture');
    if (pictureEl) {
      pictureEl.querySelectorAll('source').forEach((source) => {
        if (!source.dataset.originalSrcset) {
          source.dataset.originalSrcset = source.srcset;
        }
        source.srcset = base64Data;
      });
    }

    const trackingId = asset.localId || asset.id;
    annotationUI.appliedAssets.set(trackingId, {
      assetId: trackingId,
      elementPath: asset.elementPath,
      targetImg,
    });
  }

  async function applyAssetToPage(asset, targetImgOverride) {
    if (!isCurrentUserCollabOwner()) return;

    try {
      // eslint-disable-next-line no-underscore-dangle
      let base64Data = asset._base64Data;
      if (!base64Data) {
        const content = await assetService.getAssetContent(asset.id);
        if (!content?.data) {
          // eslint-disable-next-line no-console
          console.warn('[assets-panel] Could not fetch asset content for', asset.id);
          return;
        }
        base64Data = content.data;
        // eslint-disable-next-line no-underscore-dangle
        asset._base64Data = base64Data;
      }

      let targetImg = targetImgOverride;
      if (!targetImg && annotationUI.mainEl) {
        const element = annotationUI.mainEl.querySelector(asset.elementPath);
        if (!element) {
          console.warn(`[assets-panel] Element not found: ${asset.elementPath}`);
          return;
        }
        targetImg = element.tagName === 'IMG'
          ? element
          : element.querySelector('img');
      }

      if (!targetImg) {
        console.warn('[assets-panel] No target img found for asset', asset.id);
        return;
      }

      applyAssetPreviewToImg(targetImg, base64Data, asset);
      notifyAssetsChanged();
    } catch (err) {
      console.error('[assets-panel] Apply asset failed:', err);
    }
  }

  function renderAssetMarkers() {
    if (!annotationUI.layerEl || !annotationUI.mainEl) return;

    annotationUI.layerEl.querySelectorAll('.annotation-asset-marker')
      .forEach((m) => m.remove());

    const assetsByPath = new Map();
    for (const asset of (annotationState.store.assets || [])) {
      if (asset.elementPath) assetsByPath.set(asset.elementPath, asset);
    }
    for (const asset of (annotationState.store.localAssets || [])) {
      if (asset.elementPath) assetsByPath.set(asset.elementPath, asset);
    }
    const allAssets = [...assetsByPath.values()];

    const occupiedSlots = new Set();
    const MARKER_STEP = 28;
    const MIN_LEFT = 8;

    allAssets.forEach((asset) => {
      if (!asset.elementPath) return;
      const el = annotationUI.mainEl.querySelector(asset.elementPath);
      if (!el) return;

      const targetImg = el.tagName === 'IMG' ? el : el.querySelector('img');
      const targetEl = targetImg || el;
      const rect = targetEl.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;

      const top = Math.max(0, Math.round(rect.top - 8));
      let left = Math.max(MIN_LEFT, Math.round(rect.right - 8));
      let slotKey = `${top}:${left}`;
      while (occupiedSlots.has(slotKey) && left > MIN_LEFT) {
        left = Math.max(MIN_LEFT, left - MARKER_STEP);
        slotKey = `${top}:${left}`;
      }
      occupiedSlots.add(slotKey);

      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'annotation-asset-marker';
      marker.title = `Asset: ${asset.filename || 'image'}`;
      marker.setAttribute('aria-label', `Asset replacement: ${asset.filename || 'image'}`);
      marker.innerHTML = `
        <svg class="annotation-asset-marker-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"></path>
        </svg>
      `;
      marker.style.top = `${top}px`;
      marker.style.left = `${left}px`;
      annotationUI.layerEl.appendChild(marker);
    });
  }

  async function handleDeleteAsset(asset) {
    try {
      await assetService.deleteAsset(asset.id);

      const applied = annotationUI.appliedAssets.get(asset.id);
      if (applied?.targetImg) {
        revertAssetPreview(applied.targetImg);
        annotationUI.appliedAssets.delete(asset.id);
      }

      annotationState.store.assets = annotationState.store.assets.filter((a) => a.id !== asset.id);
      notifyAssetsChanged();
    } catch (err) {
      console.error('[assets-panel] Delete failed:', err);
    }
  }

  function revertAssetPreview(imgEl) {
    if (imgEl.dataset.originalSrc) {
      imgEl.src = imgEl.dataset.originalSrc;
      delete imgEl.dataset.originalSrc;
    }
    if (imgEl.dataset.originalSrcset) {
      imgEl.srcset = imgEl.dataset.originalSrcset;
      delete imgEl.dataset.originalSrcset;
    }
    const pictureEl = imgEl.closest('picture');
    if (pictureEl) {
      pictureEl.querySelectorAll('source').forEach((source) => {
        if (source.dataset.originalSrcset) {
          source.srcset = source.dataset.originalSrcset;
          delete source.dataset.originalSrcset;
        }
      });
    }
  }

  async function uploadLocalAssets() {
    const localAssets = annotationState.store.localAssets || [];
    if (localAssets.length === 0) return [];

    const uploadedIds = [];

    for (const localAsset of localAssets) {
      if (localAsset.skipUploadAndPromotion) {
        // Regen image — already at its final content.da.live URL.
        // The image-src easyEdit carries the URL; no upload or promotion needed.
        annotationUI.appliedAssets.delete(localAsset.localId);
        // eslint-disable-next-line no-continue
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const asset = await assetService.uploadAsset(
          localAsset.file,
          localAsset.elementPath,
          localAsset.elementRef,
          localAsset.elementProps,
          null, // commentId
          localAsset.originalSrc,
        );
        if (!asset) {
          console.warn('[assets-panel] Upload returned null for local asset:', localAsset.localId);
          // eslint-disable-next-line no-continue
          continue;
        }

        asset._base64Data = localAsset.base64Data;
        // Cache base64 for the saved URL so cards/discards avoid a DA refetch.
        if (asset.daUrl) store.cacheAssetUrlBase64(asset.daUrl, localAsset.base64Data);
        annotationState.store.assets.push(asset);

        const applied = annotationUI.appliedAssets.get(localAsset.localId);
        if (applied) {
          annotationUI.appliedAssets.delete(localAsset.localId);
          annotationUI.appliedAssets.set(asset.id, {
            assetId: asset.id,
            elementPath: asset.elementPath,
            targetImg: applied.targetImg,
          });
          if (applied.targetImg && asset.daUrl) {
            applied.targetImg.dataset.streamOriginalSrc = asset.daUrl;
          }
        }

        uploadedIds.push(asset.id);
      } catch (err) {
        console.error('[assets-panel] Upload failed for local asset:', localAsset.localId, err);
        showGlobalSnackbar(
          `Upload failed for "${localAsset.filename}": ${err.message || 'Unknown error'}`,
          { variant: 'error', duration: 5000 },
        );
      }
    }

    annotationState.store.localAssets = [];

    return uploadedIds;
  }

  function getAppliedAssetIds() {
    return Array.from(annotationUI.appliedAssets.keys())
      .filter((id) => !String(id).startsWith('local-'));
  }

  function updateAssetsFromSnapshot(remoteAssets) {
    if (!Array.isArray(remoteAssets)) return;

    const localMap = new Map(annotationState.store.assets.map((a) => [a.id, a]));
    const merged = remoteAssets.map((remote) => {
      const local = localMap.get(remote.id);
      return {
        ...remote,
        _base64Data: local?._base64Data || null,
      };
    });
    annotationState.store.assets = merged;

    for (const [assetId] of annotationUI.appliedAssets) {
      // eslint-disable-next-line no-continue
      if (String(assetId).startsWith('local-')) continue;
      const asset = merged.find((a) => a.id === assetId);
      if (!asset || asset.status !== 'pending') {
        annotationUI.appliedAssets.delete(assetId);
      }
    }
  }

  function clearAppliedAssets() {
    annotationUI.appliedAssets.clear();
  }

  async function registerLocalAssetFromRegen(targetImg, file, base64Data, pendingAlt = '', generatedUrl = '') {
    if (!targetImg || !file || !base64Data) return null;
    // Managed metadata blocks are owned by the metadata-block recorder; image
    // regen inside metadata must not produce a separate image-alt/image-src edit.
    if (targetImg.closest && targetImg.closest('.page-metadata, .card-metadata')) return null;

    const anchorTarget = targetImg.closest('picture') || targetImg;
    const { elementPath, elementProps } = store.buildEditElementAnchor(anchorTarget);
    const elementRef = store.ensureElementRef(anchorTarget);

    if (!elementPath) return null;

    // Use the stored attribute value (set by applyAssetPreviewToImg on a previous regen)
    // or the current src attribute (before this regen overwrites it).  Both are attribute
    // values so they match the literal src string in cachedCleanHtml.
    const originalSrc = targetImg.getAttribute('data-original-src')
      || targetImg.getAttribute('src')
      || '';
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const localAsset = {
      localId,
      file,
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      elementPath,
      elementRef,
      elementProps,
      originalSrc,
      base64Data,
      targetImg,
      createdAt: new Date().toISOString(),
      // Already at its final content.da.live URL; skip upload and promotion.
      skipUploadAndPromotion: true,
    };

    // eslint-disable-next-line max-len
    const supersededLocal = annotationState.store.localAssets.filter((a) => a.elementPath === elementPath);
    annotationState.store.localAssets = annotationState.store.localAssets
      .filter((a) => a.elementPath !== elementPath);
    for (const old of supersededLocal) annotationUI.appliedAssets.delete(old.localId);

    // eslint-disable-next-line max-len
    const supersededRemote = (annotationState.store.assets || []).filter((a) => a.elementPath === elementPath);
    annotationState.store.assets = (annotationState.store.assets || [])
      .filter((a) => a.elementPath !== elementPath);
    for (const old of supersededRemote) annotationUI.appliedAssets.delete(old.id);

    annotationState.store.localAssets.push(localAsset);

    const assetFileKey = store.generateId('asset-file');
    store.registerAssetFile(assetFileKey, file, base64Data);
    localAsset.assetFileKey = assetFileKey;
    store.upsertEasyEdit({
      editType: 'image-src',
      elementPath,
      elementProps,
      elementRef,
      from: targetImg.getAttribute('data-stream-original-src') || originalSrc,
      to: generatedUrl || '',
      fromHtml: '',
      toHtml: '',
      assetFileKey,
    });

    applyAssetPreviewToImg(targetImg, base64Data, localAsset);

    if (pendingAlt) {
      const originalAlt = targetImg.getAttribute('alt') || '';
      const imgRef = store.ensureElementRef(targetImg);
      const imgAnchor = store.buildEditElementAnchor(targetImg);

      targetImg.dataset.pendingAlt = pendingAlt;
      targetImg.alt = pendingAlt;

      const { elementPath: altPath, elementProps: altProps } = imgAnchor;
      const existingAltEdit = store.getEasyEditByElement(imgRef, altPath, altProps);
      if (!existingAltEdit || existingAltEdit.editType === 'image-alt') {
        store.upsertEasyEdit({
          ...(existingAltEdit || {}),
          id: existingAltEdit?.id || store.generateId('easy-edit'),
          editType: 'image-alt',
          attrName: 'alt',
          elementPath: imgAnchor.elementPath,
          elementProps: imgAnchor.elementProps,
          elementRef: imgRef,
          from: existingAltEdit?.from ?? originalAlt,
          to: pendingAlt,
          fromHtml: '',
          toHtml: '',
          updatedAt: new Date().toISOString(),
        });
      }
    }

    notifyAssetsChanged();
    return {
      elementPath, elementProps, elementRef, originalSrc,
    };
  }

  function cleanup() {
    exitSelectMode();
    annotationUI.appliedAssets.clear();
    annotationState.store.localAssets = [];
    if (fileInputEl) {
      fileInputEl.removeEventListener('change', handleFileSelected);
      fileInputEl.remove();
      fileInputEl = null;
    }
    pendingUploadTarget = null;
  }

  function getAssetTimestamp(asset) {
    if (!asset) return 0;
    const value = asset.updatedAt || asset.createdAt || 0;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : 0;
  }

  return {
    applyAssetToPage,
    buildLocalAssetCard,
    buildRemoteAssetCard,
    buildAssetEditStepCards,
    cleanup,
    clearAppliedAssets,
    enterSelectMode,
    exitSelectMode,
    getAppliedAssetIds,
    getAssetTimestamp,
    registerLocalAssetFromRegen,
    renderAssetMarkers,
    renderAssetsPanel,
    setOnAssetsChanged,
    updateAssetsFromSnapshot,
    uploadLocalAssets,
  };
}
