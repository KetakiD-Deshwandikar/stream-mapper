import {
  ANNOTATION_COMMENT_STATUSES,
  ANNOTATION_DEFAULT_USERNAME,
  BLOCK_CLASSES,
} from '../../utils/constants.js';

const ANNOTATION_STORE_KEY = 'stream-annotation-comments';
export const DEFAULT_USERNAME = ANNOTATION_DEFAULT_USERNAME;
export const COMMENT_STATUSES = ANNOTATION_COMMENT_STATUSES;

export function normalizeCommentStatus(status) {
  const value = `${status || ''}`.trim();
  const normalized = value.toLowerCase();
  if (
    normalized === 'complete'
    || normalized === 'close'
    || normalized === 'resolved'
  ) return 'Closed';
  if (normalized === 'accepted' || normalized === 'accept') return 'Accepted';
  if (normalized === 'rejected' || normalized === 'reject') return 'Rejected';
  if (normalized === 'open') return 'Open';
  if (COMMENT_STATUSES.includes(value)) return value;
  return COMMENT_STATUSES[0];
}

export function createAnnotationStore({ annotationState, annotationUI }) {
  let previewUrlResolverFn = null;

  function setPreviewUrlResolver(fn) {
    previewUrlResolverFn = fn;
  }

  let onMetadataBlockRenderedFn = null;

  function setOnMetadataBlockRendered(fn) {
    onMetadataBlockRenderedFn = fn;
  }

  function generateId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function buildElementAnchorRecord(selector = '', elementProps = {}) {
    const normalizedSelector = `${selector || ''}`.trim();
    const normalizedElementProps = elementProps && typeof elementProps === 'object'
      ? { ...elementProps }
      : {};
    if (!normalizedSelector && !Object.keys(normalizedElementProps).length) return null;
    return {
      selector: normalizedSelector,
      ...normalizedElementProps,
    };
  }

  function isInlineAssetUrl(value) {
    const normalized = `${value || ''}`.trim().toLowerCase();
    return normalized.startsWith('data:') || normalized.startsWith('blob:');
  }

  function getPersistedElementSource(element) {
    if (!(element instanceof HTMLElement)) return '';

    const originalSource = element.getAttribute('data-stream-original-src')
      || element.closest('picture')?.getAttribute('data-stream-original-src')
      || '';
    if (originalSource) return originalSource;

    const directSource = element.getAttribute('src')
      || element.getAttribute('srcset')
      || '';
    if (isInlineAssetUrl(directSource)) return '';
    return directSource;
  }

  function getCommentElementDescriptor(element) {
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      href: element.getAttribute('href') || '',
      src: getPersistedElementSource(element),
      alt: element.getAttribute('alt') || '',
      title: element.getAttribute('title') || '',
      ariaLabel: element.getAttribute('aria-label') || '',
    };
  }

  function parseCommentElementPath(elementPath) {
    if (!elementPath) return null;
    if (typeof elementPath === 'object') {
      const hasStructuredAnchor = Boolean(
        elementPath.sectionDaaLh
        || Number.isInteger(elementPath.sectionIndex)
        || elementPath.blockDaaLh
        || elementPath.blockClass
        || Number.isInteger(elementPath.blockIndex)
        || elementPath.pathWithinBlock,
      );
      if (!hasStructuredAnchor && elementPath.selector) {
        return {
          ...elementPath,
          legacy: true,
        };
      }
      return elementPath;
    }
    try {
      const parsed = JSON.parse(elementPath);
      if (parsed && typeof parsed === 'object') {
        const hasStructuredAnchor = Boolean(
          parsed.sectionDaaLh
          || Number.isInteger(parsed.sectionIndex)
          || parsed.blockDaaLh
          || parsed.blockClass
          || Number.isInteger(parsed.blockIndex)
          || parsed.pathWithinBlock,
        );
        if (!hasStructuredAnchor && parsed.selector) {
          return {
            ...parsed,
            legacy: true,
          };
        }
        return parsed;
      }
    } catch (error) {
      // Ignore legacy plain-selector paths.
    }
    return {
      legacy: true,
      selector: elementPath,
    };
  }

  function getCommentElementPathKey(elementPath) {
    const descriptor = parseCommentElementPath(elementPath);
    if (!descriptor) return '';
    if (descriptor.legacy) return `legacy:${descriptor.selector || ''}`;
    return [
      descriptor.sectionDaaLh || '',
      descriptor.sectionIndex ?? '',
      descriptor.blockDaaLh || '',
      descriptor.blockClass || '',
      descriptor.blockIndex ?? '',
      descriptor.pathWithinBlock || '',
      descriptor.tag || '',
      descriptor.id || '',
      descriptor.href || '',
      descriptor.src || '',
      descriptor.alt || '',
      descriptor.title || '',
      descriptor.ariaLabel || '',
    ].join('|');
  }

  function getEditElementPathKey(elementPath, elementProps = {}) {
    if (!Object.keys(elementProps || {}).length) {
      return getCommentElementPathKey(elementPath);
    }
    return getCommentElementPathKey(buildElementAnchorRecord(elementPath, elementProps));
  }

  function normalizeEasyEdit(edit) {
    const parsedElementPath = parseCommentElementPath(edit.elementPath);
    const normalizedElementProps = (() => {
      if (edit.elementProps && typeof edit.elementProps === 'object') {
        return { ...edit.elementProps };
      }
      if (parsedElementPath && !parsedElementPath.legacy) {
        const {
          selector,
          legacy,
          ...rest
        } = parsedElementPath;
        return rest;
      }
      return {};
    })();

    const blockClass = `${edit.blockClass
      || normalizedElementProps.blockClass
      || parsedElementPath?.blockClass
      || ''}`;
    const blockGlobalIndex = edit.blockGlobalIndex
      ?? normalizedElementProps.blockGlobalIndex
      ?? parsedElementPath?.blockGlobalIndex
      ?? null;

    const picIndexInBlock = edit.picIndexInBlock
      ?? normalizedElementProps.picIndexInBlock
      ?? parsedElementPath?.picIndexInBlock
      ?? null;

    const viewport = edit.viewport || (() => {
      const w = window.innerWidth;
      if (w < 600) return 'mobile';
      if (w >= 1200) return 'desktop';
      return 'tablet';
    })();

    return {
      id: edit.id || generateId('easy-edit'),
      editType: edit.editType || 'text',
      attrName: edit.attrName || '',
      elementPath: `${edit.elementPath || parsedElementPath?.selector || ''}`,
      elementProps: normalizedElementProps,
      blockClass,
      blockGlobalIndex,
      picIndexInBlock,
      viewport,
      elementRef: edit.elementRef || '',
      from: `${edit.from || ''}`,
      to: `${edit.to || ''}`,
      fromHtml: `${edit.fromHtml || ''}`,
      toHtml: `${edit.toHtml || ''}`,
      changedFrom: `${edit.changedFrom || ''}`,
      changedTo: `${edit.changedTo || ''}`,
      updatedAt: edit.updatedAt || new Date().toISOString(),
      authorUsername: `${edit.authorUsername || window.streamConfig?.username || ''}`,
      changeHistory: Array.isArray(edit.changeHistory) ? edit.changeHistory : [],
      isCommitted: !!edit.isCommitted,
      // In-memory key into the asset maps; stripped in buildSavePayload.
      assetFileKey: edit.assetFileKey || '',
    };
  }

  function getReviewId() {
    const collabId = window.streamConfig?.collabId;
    if (collabId !== null && collabId !== undefined && `${collabId}`.trim()) {
      return `collab:${`${collabId}`.trim()}`;
    }

    const streamConfigReviewId = window.streamConfig?.reviewId;
    if (streamConfigReviewId !== null && streamConfigReviewId !== undefined && `${streamConfigReviewId}`.trim()) {
      return `${streamConfigReviewId}`.trim();
    }

    const params = new URLSearchParams(window.location.search);
    const urlReviewId = params.get('reviewId') || params.get('reviewid');
    if (urlReviewId && urlReviewId.trim()) return urlReviewId.trim();

    return 'default-review';
  }

  function parseAnnotationPayload(parsed) {
    const easyEditsPayload = parsed?.easy_edits;
    const easyEdits = Array.isArray(easyEditsPayload)
      ? easyEditsPayload
        .filter((edit) => edit && typeof edit === 'object')
        .map((edit) => normalizeEasyEdit(edit))
      : [];

    return {
      threads: [],
      easyEdits,
      assets: [],
      localAssets: [],
    };
  }

  function truncateInlineEditText(text, max = 80) {
    const value = `${text || ''}`.replace(/\s+/g, ' ').trim();
    if (value.length <= max) return value || '""';
    return `${value.slice(0, max)}...`;
  }

  function getEditPanelMessage(edit) {
    if (edit.editType === 'image-src') {
      const fromLabel = truncateInlineEditText(edit.from, 40);
      const toLabel = edit.to ? truncateInlineEditText(edit.to, 40) : 'pending upload';
      return `replaced image src "${fromLabel}" → "${toLabel}"`;
    }
    if (edit.editType === 'image-alt') {
      return `changed alt "${truncateInlineEditText(edit.from, 40)}" → "${truncateInlineEditText(edit.to, 40)}"`;
    }
    if (
      edit.editType === 'text'
      && edit.from === edit.to
      && edit.fromHtml
      && edit.toHtml
      && edit.fromHtml !== edit.toHtml
    ) {
      return `updated formatting for "${truncateInlineEditText(edit.to || edit.from)}"`;
    }
    return `"${truncateInlineEditText(edit.from)}" → "${truncateInlineEditText(edit.to)}"`;
  }

  function buildEditThreadFromEasyEdit(edit) {
    const normalizedEdit = normalizeEasyEdit(edit);
    const authorUsername = normalizedEdit.authorUsername || DEFAULT_USERNAME;
    const history = normalizedEdit.changeHistory || [];

    const messages = [];
    let prevTo = normalizedEdit.from;
    let prevToHtml = normalizedEdit.fromHtml;

    history.forEach((entry, i) => {
      messages.push({
        id: `${normalizedEdit.id}-history-${i}`,
        username: authorUsername,
        text: getEditPanelMessage({
          ...normalizedEdit,
          from: prevTo,
          to: entry.to,
          fromHtml: prevToHtml,
          toHtml: entry.toHtml || '',
        }),
        kind: 'comment',
        createdAt: entry.updatedAt || null,
        historyIndex: i,
      });
      prevTo = entry.to;
      prevToHtml = entry.toHtml || '';
    });

    messages.push({
      id: `${normalizedEdit.id}-message`,
      username: authorUsername,
      text: getEditPanelMessage({
        ...normalizedEdit,
        from: prevTo,
        fromHtml: prevToHtml,
      }),
      kind: 'comment',
      createdAt: normalizedEdit.updatedAt || null,
      isCurrent: true,
      isCommitted: !!normalizedEdit.isCommitted,
      hasPendingHistory: history.length > 0,
    });

    messages.reverse();

    return {
      id: normalizedEdit.id,
      threadType: 'edit',
      elementRef: normalizedEdit.elementRef,
      elementPath: normalizedEdit.elementPath,
      elementProps: normalizedEdit.elementProps,
      status: COMMENT_STATUSES[0],
      username: authorUsername,
      messages,
    };
  }

  function rebuildEditThreadsFromEasyEdits() {
    const nextEditThreads = annotationState.store.easyEdits
      .filter((edit) => (
        edit
        && typeof edit === 'object'
        && edit.editType !== 'image-src'
        && (edit.from !== edit.to || (Array.isArray(edit.changeHistory) && edit.changeHistory.length > 0))
      ))
      .map((edit) => buildEditThreadFromEasyEdit(edit));
    const preservedThreads = annotationState.store.threads.filter(
      (thread) => (thread?.threadType || 'comment') !== 'edit',
    );
    annotationState.store.threads = [
      ...preservedThreads,
      ...nextEditThreads,
    ];
  }

  function discardUncommittedEasyEditsOnLoad() {
    const edits = annotationState.store?.easyEdits;
    if (!Array.isArray(edits)) return;
    annotationState.store.easyEdits = edits.filter((edit) => edit && edit.isCommitted);
  }

  function loadAnnotationStore() {
    try {
      const reviewId = getReviewId();
      const raw = window.sessionStorage.getItem(ANNOTATION_STORE_KEY);
      if (!raw) {
        annotationState.store = {
          threads: [], easyEdits: [], assets: [], localAssets: [],
        };
        return;
      }
      const parsed = JSON.parse(raw) || {};

      if (reviewId && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[reviewId]) {
        annotationState.store = parseAnnotationPayload(parsed[reviewId]);
        discardUncommittedEasyEditsOnLoad();
        rebuildEditThreadsFromEasyEdits();
        return;
      }

      annotationState.store = parseAnnotationPayload(parsed);
      discardUncommittedEasyEditsOnLoad();
      rebuildEditThreadsFromEasyEdits();
    } catch (error) {
      annotationState.store = {
        threads: [], easyEdits: [], assets: [], localAssets: [],
      };
    }
  }

  function saveAnnotationStore() {
    const payload = {
      easy_edits: annotationState.store.easyEdits,
    };
    const reviewId = getReviewId();
    let existingMap = {};
    try {
      existingMap = JSON.parse(window.sessionStorage.getItem(ANNOTATION_STORE_KEY) || '{}') || {};
      if (Array.isArray(existingMap) || typeof existingMap !== 'object') existingMap = {};
    } catch (error) {
      existingMap = {};
    }

    existingMap[reviewId] = payload;

    const serialized = JSON.stringify(existingMap);
    window.sessionStorage.setItem(ANNOTATION_STORE_KEY, serialized);
    window.streamAnnotationComments = existingMap;
  }

  function replaceFirstOccurrence(source, fromValue, toValue) {
    const haystack = `${source || ''}`;
    const needle = `${fromValue || ''}`;
    if (!needle) return haystack;
    const index = haystack.indexOf(needle);
    if (index === -1) return haystack;
    return `${haystack.slice(0, index)}${toValue || ''}${haystack.slice(index + needle.length)}`;
  }

  function countOccurrences(haystack, needle) {
    const ndl = `${needle || ''}`;
    if (!ndl) return 0;
    let count = 0;
    let idx = haystack.indexOf(ndl);
    while (idx !== -1) {
      count += 1;
      idx = haystack.indexOf(ndl, idx + ndl.length);
    }
    return count;
  }

  function replaceNthOccurrence(source, needle, replacement, n) {
    const haystack = `${source || ''}`;
    const ndl = `${needle || ''}`;
    if (!ndl) return haystack;
    let count = 0;
    let idx = haystack.indexOf(ndl);
    while (idx !== -1) {
      if (count === n) {
        return `${haystack.slice(0, idx)}${replacement || ''}${haystack.slice(idx + ndl.length)}`;
      }
      count += 1;
      idx = haystack.indexOf(ndl, idx + ndl.length);
    }
    return haystack;
  }

  function getViewportOccurrenceIndex(occurrenceCount, viewport) {
    if (occurrenceCount <= 1) return 0;
    if (viewport === 'mobile') return 0;
    if (viewport === 'desktop') return occurrenceCount - 1;
    if (occurrenceCount === 3) return 1;
    if (occurrenceCount === 2) return 0;
    return occurrenceCount - 1;
  }

  function escapeRegExp(value) {
    return `${value || ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function findBlockInDaHtml(mainEl, blockClass, blockGlobalIndex) {
    if (!blockClass || !(blockGlobalIndex >= 0)) return null;
    const allSimilarBlocks = Array.from(mainEl.children).flatMap((section) => (
      Array.from(section.children).filter(
        (child) => child instanceof HTMLElement
          && Array.from(child.classList || []).find(Boolean) === blockClass,
      )
    ));
    return allSimilarBlocks[blockGlobalIndex] || null;
  }

  function keepLatestImageEdits(easyEdits = []) {
    const latestByKey = new Map();
    for (const edit of easyEdits) {
      if (!edit || (edit.editType !== 'image-src' && edit.editType !== 'image-alt')) continue;
      const key = `${edit.editType}|${getEditElementPathKey(edit.elementPath, edit.elementProps)}`;
      const prev = latestByKey.get(key);
      if (!prev || new Date(edit.updatedAt || 0) >= new Date(prev.updatedAt || 0)) {
        latestByKey.set(key, edit);
      }
    }
    return easyEdits.filter((edit) => {
      if (!edit || (edit.editType !== 'image-src' && edit.editType !== 'image-alt')) return true;
      const key = `${edit.editType}|${getEditElementPathKey(edit.elementPath, edit.elementProps)}`;
      return latestByKey.get(key) === edit;
    });
  }

  function applyEasyEditsToHtmlString(html, easyEdits = []) {
    let updatedHtml = `${html || ''}`;
    const effectiveEdits = keepLatestImageEdits(easyEdits);

    // Parse the ORIGINAL html once so that candidate counts stay stable across edits.
    // Sequential edits shrink same-src lists in updatedHtml; reading from the original
    // parse keeps getViewportOccurrenceIndex and picIndexInBlock mapping correct.
    const origWrapper = document.createElement('div');
    origWrapper.innerHTML = `<main>${html || ''}</main>`;
    const origMainEl = origWrapper.querySelector('main');
    effectiveEdits.forEach((edit) => {
      if (!edit || typeof edit !== 'object') return;

      // Metadata-like blocks are stripped from this HTML and re-appended at the end of
      // the page separately, so skip them here to avoid matching inline.
      if (BLOCK_CLASSES.includes(edit.blockClass)) return;

      if (edit.editType === 'image-src') {
        const fromSrc = `${edit.from || ''}`;
        const toSrc = `${edit.to || ''}`;
        if (!fromSrc || !toSrc) return;

        const imgBlockClass = edit.blockClass || edit.elementProps?.blockClass || '';
        const imgBlockGlobalIndex = edit.blockGlobalIndex
          ?? edit.elementProps?.blockGlobalIndex
          ?? -1;

        if (imgBlockClass && imgBlockGlobalIndex >= 0) {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = `<main>${updatedHtml}</main>`;
          const mainEl = wrapper.querySelector('main');
          const targetBlock = findBlockInDaHtml(mainEl, imgBlockClass, imgBlockGlobalIndex);
          if (targetBlock) {
            const currentBlockHtml = targetBlock.outerHTML;

            // Use original block to resolve absolute picture position.
            // This keeps the index stable even after prior edits changed picture srcs.
            const origBlock = findBlockInDaHtml(origMainEl, imgBlockClass, imgBlockGlobalIndex);
            const origAllPics = origBlock
              ? Array.from(origBlock.querySelectorAll('picture'))
              : [];
            const origCandidates = origAllPics.filter(
              (pic) => pic.innerHTML.includes(fromSrc),
            );
            // Fall back to all pictures when `from` is no longer in the baseline.
            const candidatePool = origCandidates.length ? origCandidates : origAllPics;

            const storedIdx = edit.picIndexInBlock ?? edit.elementProps?.picIndexInBlock ?? null;
            let origTarget = null;

            if (storedIdx !== null && storedIdx >= 0 && storedIdx < candidatePool.length) {
              origTarget = candidatePool[storedIdx];
            } else {
              const picIdx = getViewportOccurrenceIndex(
                candidatePool.length || 1,
                edit.viewport,
              );
              origTarget = candidatePool[picIdx] || null;
            }

            // Map original target → absolute index → picture in current (modified) block
            const absIdx = origTarget ? origAllPics.indexOf(origTarget) : -1;
            const allCurrentPics = Array.from(targetBlock.querySelectorAll('picture'));
            const targetEl = absIdx >= 0 && absIdx < allCurrentPics.length
              ? allCurrentPics[absIdx]
              : null;

            if (targetEl) {
              const curEl = targetEl.outerHTML;
              // Overwrite the picture's source(s) with `to` regardless of current src.
              const replacementEl = targetEl.cloneNode(true);
              replacementEl.querySelectorAll('img').forEach((img) => {
                img.setAttribute('src', toSrc);
                if (img.hasAttribute('srcset')) img.setAttribute('srcset', toSrc);
              });
              replacementEl.querySelectorAll('source').forEach((s) => s.setAttribute('srcset', toSrc));
              const newEl = replacementEl.outerHTML;
              // Count identical pictures before targetEl so we replace the correct
              // nth occurrence when multiple pictures share the same outerHTML.
              const nth = allCurrentPics
                .slice(0, absIdx)
                .filter((pic) => pic.outerHTML === curEl)
                .length;
              const blk = currentBlockHtml;
              const newBlk = replaceNthOccurrence(blk, curEl, newEl, nth);
              if (newBlk !== blk) {
                updatedHtml = replaceFirstOccurrence(updatedHtml, blk, newBlk);
              }
            }
          }
          return;
        }

        updatedHtml = replaceFirstOccurrence(updatedHtml, fromSrc, toSrc);
        return;
      }

      if (edit.editType === 'image-alt') {
        const fromAlt = `${edit.from || ''}`;
        const toAlt = `${edit.to || ''}`;
        if (!fromAlt) return;
        const escapedFromAlt = escapeRegExp(fromAlt);
        const doubleQuoteAlt = new RegExp(`alt="${escapedFromAlt}"`);
        const singleQuoteAlt = new RegExp(`alt='${escapedFromAlt}'`);

        const altBlockClass = edit.blockClass || edit.elementProps?.blockClass || '';
        const altBlockGlobalIndex = edit.blockGlobalIndex
          ?? edit.elementProps?.blockGlobalIndex
          ?? -1;

        if (altBlockClass && altBlockGlobalIndex >= 0) {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = `<main>${updatedHtml}</main>`;
          const mainEl = wrapper.querySelector('main');
          const targetBlock = findBlockInDaHtml(mainEl, altBlockClass, altBlockGlobalIndex);
          if (targetBlock) {
            const originalBlockHtml = targetBlock.outerHTML;
            const dqAttr = `alt="${fromAlt}"`;
            const sqAttr = `alt='${fromAlt}'`;
            let attrStr = null;
            if (originalBlockHtml.includes(dqAttr)) attrStr = dqAttr;
            else if (originalBlockHtml.includes(sqAttr)) attrStr = sqAttr;
            if (attrStr) {
              const altCount = countOccurrences(originalBlockHtml, attrStr);
              const altIdx = getViewportOccurrenceIndex(altCount, edit.viewport);
              const toAttr = attrStr.startsWith('alt="') ? `alt="${toAlt}"` : `alt='${toAlt}'`;
              const newBlockHtml = replaceNthOccurrence(originalBlockHtml, attrStr, toAttr, altIdx);
              if (newBlockHtml !== originalBlockHtml) {
                updatedHtml = replaceFirstOccurrence(updatedHtml, originalBlockHtml, newBlockHtml);
              }
            } else {
              // fromAlt not in the block HTML — happens when cachedCleanHtml was refreshed
              // from DA after a prior push (DA converts all quotes to single, so the previous
              // push result is now the current text). Fall back to the image by position.
              const picIdx = edit.picIndexInBlock ?? edit.elementProps?.picIndexInBlock ?? null;
              const pics = Array.from(targetBlock.querySelectorAll('picture'));
              const targetPic = picIdx != null ? pics[picIdx] : pics[0];
              const targetImgEl = targetPic?.querySelector('img');
              if (targetImgEl) {
                targetImgEl.setAttribute('alt', toAlt);
                const newBlockHtml = targetBlock.outerHTML;
                if (newBlockHtml !== originalBlockHtml) {
                  // eslint-disable-next-line max-len
                  updatedHtml = replaceFirstOccurrence(updatedHtml, originalBlockHtml, newBlockHtml);
                }
              }
            }
          }
          return;
        }

        if (doubleQuoteAlt.test(updatedHtml)) {
          updatedHtml = updatedHtml.replace(doubleQuoteAlt, `alt="${toAlt}"`);
        } else if (singleQuoteAlt.test(updatedHtml)) {
          updatedHtml = updatedHtml.replace(singleQuoteAlt, `alt='${toAlt}'`);
        } else {
          // fromAlt not found globally — fall back to locating the element by elementPath.
          const elPath = edit.elementPath;
          if (elPath) {
            const globalWrapper = document.createElement('div');
            globalWrapper.innerHTML = `<main>${updatedHtml}</main>`;
            const targetImgEl = globalWrapper.querySelector(elPath);
            if (targetImgEl?.tagName === 'IMG') {
              targetImgEl.setAttribute('alt', toAlt);
              updatedHtml = globalWrapper.querySelector('main').innerHTML;
            }
          }
        }
        return;
      }

      const fromHtml = `${edit.fromHtml || ''}`;
      const toHtml = `${edit.toHtml || ''}`;
      const fromText = `${edit.from || ''}`;
      const toText = `${edit.to || ''}`;

      const blockClass = edit.blockClass || edit.elementProps?.blockClass || '';
      const blockGlobalIndex = edit.blockGlobalIndex
        ?? edit.elementProps?.blockGlobalIndex
        ?? -1;

      if (blockClass && blockGlobalIndex >= 0) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `<main>${updatedHtml}</main>`;
        const mainEl = wrapper.querySelector('main');
        const targetBlock = findBlockInDaHtml(mainEl, blockClass, blockGlobalIndex);

        if (targetBlock) {
          const originalBlockHtml = targetBlock.outerHTML;
          const beforeBlockReplace = updatedHtml;
          if (fromHtml && originalBlockHtml.includes(fromHtml)) {
            const htmlCount = countOccurrences(originalBlockHtml, fromHtml);
            const htmlIdx = getViewportOccurrenceIndex(htmlCount, edit.viewport);
            const repl = toHtml || fromHtml;
            const newBlockHtml = replaceNthOccurrence(originalBlockHtml, fromHtml, repl, htmlIdx);
            updatedHtml = replaceFirstOccurrence(updatedHtml, originalBlockHtml, newBlockHtml);
          } else if (fromText && originalBlockHtml.includes(fromText)) {
            const textCount = countOccurrences(originalBlockHtml, fromText);
            const textIdx = getViewportOccurrenceIndex(textCount, edit.viewport);
            const newBlockHtml = replaceNthOccurrence(originalBlockHtml, fromText, toText, textIdx);
            updatedHtml = replaceFirstOccurrence(updatedHtml, originalBlockHtml, newBlockHtml);
          }
          if (updatedHtml !== beforeBlockReplace) return;
        }
        // Block-scoped replacement didn't apply — fall through to global matching.
      }

      if (fromHtml) {
        const replaced = replaceFirstOccurrence(updatedHtml, fromHtml, toHtml || fromHtml);
        if (replaced !== updatedHtml) { updatedHtml = replaced; return; }
      }
      if (fromText) {
        updatedHtml = replaceFirstOccurrence(updatedHtml, fromText, toText);
      }
    });
    return updatedHtml;
  }

  function getStoredAnnotationPayload() {
    try {
      const reviewId = getReviewId();
      const raw = window.sessionStorage.getItem(ANNOTATION_STORE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) || {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[reviewId]) {
        return parseAnnotationPayload(parsed[reviewId]);
      }
      return parseAnnotationPayload(parsed);
    } catch {
      return null;
    }
  }

  function getThreadType(thread) {
    return thread?.threadType || 'comment';
  }

  function buildElementPath(element, root = annotationUI.mainEl) {
    const segments = [];
    let current = element;

    while (current && current !== root) {
      if (!current.parentElement) break;
      const tag = current.tagName.toLowerCase();
      const siblings = [];
      const currentTagName = current.tagName;
      const children = Array.from(current.parentElement.children);
      for (let idx = 0; idx < children.length; idx += 1) {
        const child = children[idx];
        if (child.tagName === currentTagName) siblings.push(child);
      }
      const index = siblings.indexOf(current);
      let selectorSegment = `${tag}:nth-of-type(${index + 1})`;
      if (current.classList.contains('section')) {
        selectorSegment = `.section:nth-of-type(${index + 1})`;
      } else if (current.parentElement === root || current.parentElement?.classList.contains('section')) {
        const blockClass = Array.from(current.classList || []).find(Boolean);
        if (blockClass) {
          selectorSegment = `.${blockClass}:nth-of-type(${index + 1})`;
        }
      }
      segments.unshift(selectorSegment);
      current = current.parentElement;
    }

    return `main > ${segments.join(' > ')}`;
  }

  function buildRelativeElementPath(element, root) {
    if (!element || !root) return '';
    if (element === root) return ':scope';

    const segments = [];
    let current = element;

    while (current && current !== root) {
      if (!current.parentElement) break;
      const tag = current.tagName.toLowerCase();
      const siblings = [];
      const children = Array.from(current.parentElement.children);
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child.tagName === current.tagName) siblings.push(child);
      }
      const siblingIndex = siblings.indexOf(current);
      segments.unshift(`${tag}:nth-of-type(${siblingIndex + 1})`);
      current = current.parentElement;
    }

    return segments.join(' > ') || ':scope';
  }

  function getDirectSectionChildren(root) {
    if (!(root instanceof HTMLElement)) return [];
    return Array.from(root.children).filter((child) => (
      child instanceof HTMLElement && child.classList.contains('section')
    ));
  }

  function getCommentAnchorContext(element, root = annotationUI.mainEl) {
    if (!(element instanceof HTMLElement) || !(root instanceof HTMLElement)) return null;

    const section = element.closest('.section');
    if (!(section instanceof HTMLElement) || !root.contains(section)) return null;

    let block = element;
    while (
      block
      && block.parentElement
      && block.parentElement !== section
    ) {
      block = block.parentElement;
    }
    if (!(block instanceof HTMLElement)) return null;

    const sections = getDirectSectionChildren(root);
    const sectionIndex = sections.indexOf(section);
    const blockChildren = Array.from(section.children)
      .filter((child) => child instanceof HTMLElement);
    const blockIndex = blockChildren.indexOf(block);
    const blockClass = Array.from(block.classList || []).find(Boolean) || '';

    const allSimilarBlocks = blockClass
      ? getDirectSectionChildren(root).flatMap(
        (s) => Array.from(s.children).filter(
          (child) => child instanceof HTMLElement
            && Array.from(child.classList || []).find(Boolean) === blockClass,
        ),
      )
      : [];
    const blockGlobalIndex = allSimilarBlocks.indexOf(block);

    return {
      section,
      block,
      sectionDaaLh: section.getAttribute('daa-lh') || '',
      sectionIndex: sectionIndex > -1 ? sectionIndex : null,
      blockDaaLh: block.getAttribute('daa-lh') || '',
      blockClass,
      blockIndex: blockIndex > -1 ? blockIndex : null,
      blockGlobalIndex: blockGlobalIndex > -1 ? blockGlobalIndex : null,
    };
  }

  function buildCommentElementPath(element, root = annotationUI.mainEl) {
    const selector = buildElementPath(element, root);
    const context = getCommentAnchorContext(element, root);
    if (!context) {
      return JSON.stringify({
        selector,
        ...getCommentElementDescriptor(element),
      });
    }

    const picEl = element.closest('picture') || (element.tagName === 'IMG' ? element : null);
    // Index among pictures in the block that share the same persisted source URL.
    // Using same-src siblings avoids counting extra pictures that the render layer
    // adds (icons, logos) which do not exist in DA HTML.
    const imgEl = picEl ? picEl.querySelector('img') : null;
    const picSrc = imgEl ? getPersistedElementSource(imgEl) : '';
    const sameSrcPics = picEl && picSrc
      ? Array.from(context.block.querySelectorAll('picture')).filter((pic) => {
        const pImg = pic.querySelector('img');
        return pImg && getPersistedElementSource(pImg) === picSrc;
      })
      : [];
    const picIndexInBlock = sameSrcPics.length > 0 ? sameSrcPics.indexOf(picEl) : -1;

    return JSON.stringify({
      selector,
      sectionDaaLh: context.sectionDaaLh,
      sectionIndex: context.sectionIndex,
      blockDaaLh: context.blockDaaLh,
      blockClass: context.blockClass,
      blockIndex: context.blockIndex,
      blockGlobalIndex: context.blockGlobalIndex,
      pathWithinBlock: buildRelativeElementPath(element, context.block),
      picIndexInBlock: picIndexInBlock > -1 ? picIndexInBlock : null,
      ...getCommentElementDescriptor(element),
    });
  }

  function buildThreadElementPath(element, root = annotationUI.mainEl) {
    return buildCommentElementPath(element, root);
  }

  function buildEditElementAnchor(element, root = annotationUI.mainEl) {
    const descriptor = parseCommentElementPath(buildThreadElementPath(element, root));
    if (!descriptor) {
      return {
        elementPath: '',
        elementProps: {},
      };
    }
    const {
      selector,
      legacy,
      ...elementProps
    } = descriptor;
    return {
      elementPath: selector || '',
      elementProps,
    };
  }

  function ensureElementRef(element) {
    if (!element.dataset.annotationRef) {
      element.dataset.annotationRef = generateId('el');
    }
    return element.dataset.annotationRef;
  }

  function getElementByRef(elementRef) {
    if (!annotationUI.mainEl || !elementRef) return null;
    return annotationUI.mainEl.querySelector(`[data-annotation-ref="${elementRef}"]`);
  }

  function getMainRelativeSelector(selector) {
    const value = `${selector || ''}`.trim();
    if (!value) return '';
    if (value === 'main') return '';
    if (value.startsWith('main > ')) return value.slice('main > '.length);
    return value;
  }

  function getRelativeSelector(selector) {
    const value = `${selector || ''}`.trim();
    if (!value || value === ':scope') return '';
    if (value.startsWith(':scope > ')) return value.slice(':scope > '.length);
    if (value.startsWith(':scope')) return value.slice(':scope'.length).trim();
    return value;
  }

  function getCommentBlockFromDescriptor(descriptor) {
    if (!annotationUI.mainEl || !descriptor || descriptor.legacy) return null;

    let section = null;
    if (descriptor.sectionDaaLh) {
      section = getDirectSectionChildren(annotationUI.mainEl).find((child) => (
        child.getAttribute('daa-lh') === descriptor.sectionDaaLh
      )) || null;
    }
    if (!(section instanceof HTMLElement) && Number.isInteger(descriptor.sectionIndex)) {
      const sections = getDirectSectionChildren(annotationUI.mainEl);
      section = sections[descriptor.sectionIndex] || null;
    }
    if (!(section instanceof HTMLElement)) return null;

    let block = null;
    if (descriptor.blockDaaLh) {
      block = Array.from(section.children).find((child) => (
        child instanceof HTMLElement && child.getAttribute('daa-lh') === descriptor.blockDaaLh
      )) || null;
    }
    if (!(block instanceof HTMLElement) && Number.isInteger(descriptor.blockIndex)) {
      const blockChildren = Array.from(section.children)
        .filter((child) => child instanceof HTMLElement);
      const candidate = blockChildren[descriptor.blockIndex] || null;
      if (candidate instanceof HTMLElement) {
        block = candidate;
      }
    }
    if (!(block instanceof HTMLElement) && descriptor.blockClass) {
      block = Array.from(section.children).find((child) => (
        child instanceof HTMLElement && child.classList.contains(descriptor.blockClass)
      )) || null;
    }
    return block instanceof HTMLElement ? block : null;
  }

  function getElementByCommentPath(elementPath) {
    if (!annotationUI.mainEl || !elementPath) return null;
    const descriptor = parseCommentElementPath(elementPath);
    if (!descriptor) return null;

    if (!descriptor.legacy) {
      const block = getCommentBlockFromDescriptor(descriptor);
      if (!block) return null;

      const selector = getRelativeSelector(descriptor.pathWithinBlock);
      const candidates = !selector
        ? [block]
        : Array.from(block.querySelectorAll(selector));

      const exactMatch = candidates.find((candidate) => {
        if (!(candidate instanceof HTMLElement)) return false;
        const candidateDescriptor = getCommentElementDescriptor(candidate);
        if (descriptor.tag && candidateDescriptor.tag !== descriptor.tag) return false;
        if (descriptor.id && candidateDescriptor.id !== descriptor.id) return false;
        if (descriptor.href && candidateDescriptor.href !== descriptor.href) return false;
        if (descriptor.src && candidateDescriptor.src !== descriptor.src) return false;
        if (descriptor.alt && candidateDescriptor.alt !== descriptor.alt) return false;
        if (descriptor.title && candidateDescriptor.title !== descriptor.title) return false;
        if (
          descriptor.ariaLabel
          && candidateDescriptor.ariaLabel !== descriptor.ariaLabel
        ) return false;
        return true;
      });

      if (exactMatch instanceof HTMLElement) return exactMatch;
      if (candidates.length === 1 && descriptor.tag) {
        return candidates[0];
      }
      if (descriptor.selector) {
        return getElementByCommentPath({
          ...descriptor,
          legacy: true,
        });
      }
      return null;
    }

    if (!descriptor.selector) return null;

    const candidates = Array.from(
      annotationUI.mainEl.querySelectorAll(getMainRelativeSelector(descriptor.selector)),
    );
    const exactMatch = candidates.find((candidate) => {
      if (!(candidate instanceof HTMLElement)) return false;
      const candidateDescriptor = getCommentElementDescriptor(candidate);
      if (descriptor.tag && candidateDescriptor.tag !== descriptor.tag) return false;
      if (descriptor.id && candidateDescriptor.id !== descriptor.id) return false;
      if (descriptor.href && candidateDescriptor.href !== descriptor.href) return false;
      if (descriptor.src && candidateDescriptor.src !== descriptor.src) return false;
      if (descriptor.alt && candidateDescriptor.alt !== descriptor.alt) return false;
      if (descriptor.title && candidateDescriptor.title !== descriptor.title) return false;
      if (
        descriptor.ariaLabel
        && candidateDescriptor.ariaLabel !== descriptor.ariaLabel
      ) return false;
      return true;
    });

    if (exactMatch instanceof HTMLElement) return exactMatch;
    if (descriptor.legacy && candidates[0] instanceof HTMLElement) return candidates[0];
    if (candidates.length === 1 && descriptor.tag) {
      return candidates[0];
    }
    return null;
  }

  function getElementByThreadPath(elementPath) {
    return getElementByCommentPath(elementPath);
  }

  function getElementForThread(thread) {
    if (!thread) return null;
    if (thread.elementPath) {
      const byPath = getElementByThreadPath(thread.elementPath);
      if (byPath) return byPath;
    }
    return getElementByRef(thread.elementRef);
  }

  function rebindThreadsToCurrentDom() {
    if (!annotationUI.mainEl) return;

    annotationState.store.threads.forEach((thread) => {
      const target = getElementForThread(thread);
      if (!(target instanceof HTMLElement)) return;
      thread.elementRef = ensureElementRef(target);
    });
  }

  function getThreadByElementRef(elementRef, threadType = null) {
    return annotationState.store.threads.find((thread) => thread.elementRef === elementRef
      && (!threadType || getThreadType(thread) === threadType));
  }

  function getThreadByElementPath(elementPath, threadType = null, elementProps = {}) {
    return annotationState.store.threads.find((thread) => (
      (!threadType || getThreadType(thread) === threadType)
        && getEditElementPathKey(thread.elementPath, thread.elementProps)
          === getEditElementPathKey(elementPath, elementProps)
    ));
  }

  function getCommentThreadByElementPath(elementPath) {
    return getThreadByElementPath(elementPath, 'comment');
  }

  function getEditThreadByElementPath(elementPath, elementProps = {}) {
    return getThreadByElementPath(elementPath, 'edit', elementProps);
  }

  function getCommentThreadByElement(element) {
    if (!(element instanceof HTMLElement)) return null;
    const exactPath = buildThreadElementPath(element, annotationUI.mainEl);
    const exactThread = getCommentThreadByElementPath(exactPath);
    if (exactThread) return exactThread;

    return annotationState.store.threads.find((thread) => (
      getThreadType(thread) === 'comment' && getElementByThreadPath(thread.elementPath) === element
    ));
  }

  function getEditThreadByElement(element) {
    if (!(element instanceof HTMLElement)) return null;
    const exactAnchor = buildEditElementAnchor(element, annotationUI.mainEl);
    const exactThread = getEditThreadByElementPath(
      exactAnchor.elementPath,
      exactAnchor.elementProps,
    );
    if (exactThread) return exactThread;

    return annotationState.store.threads.find((thread) => (
      getThreadType(thread) === 'edit' && getElementByThreadPath(thread.elementPath) === element
    ));
  }

  function getThreadById(threadId) {
    return annotationState.store.threads.find((thread) => thread.id === threadId);
  }

  function replaceThreadsByType(threadType, nextThreads = []) {
    const preservedThreads = annotationState.store.threads.filter(
      (thread) => getThreadType(thread) !== threadType,
    );
    annotationState.store.threads = [
      ...preservedThreads,
      ...nextThreads.map((thread) => ({
        ...thread,
        threadType: thread.threadType || threadType,
        status: normalizeCommentStatus(thread.status),
        messages: Array.isArray(thread.messages) ? thread.messages : [],
      })),
    ];
  }

  function upsertThread(nextThread) {
    if (!nextThread?.id) return;
    const normalizedThread = {
      ...nextThread,
      threadType: nextThread.threadType || getThreadType(nextThread),
      status: normalizeCommentStatus(nextThread.status),
      messages: Array.isArray(nextThread.messages) ? nextThread.messages : [],
    };
    const existingIndex = annotationState.store.threads.findIndex(
      (thread) => thread.id === normalizedThread.id,
    );
    if (existingIndex > -1) {
      annotationState.store.threads[existingIndex] = normalizedThread;
      return;
    }
    annotationState.store.threads.push(normalizedThread);
  }

  function removeThread(threadId) {
    if (!threadId) return;
    annotationState.store.threads = annotationState.store.threads.filter(
      (thread) => thread.id !== threadId,
    );
  }

  function removeThreadMessage(threadId, messageId) {
    if (!threadId || !messageId) return;
    const thread = getThreadById(threadId);
    if (!thread) return;
    thread.messages = (thread.messages || []).filter((message) => message.id !== messageId);
  }

  function clearSelectedElement() {
    if (annotationState.selectedElement) {
      annotationState.selectedElement.classList.remove('annotation-selected-element');
    }
    annotationState.selectedElement = null;
    annotationState.selectedElementPath = '';
    annotationState.selectedElementRef = '';
  }

  function getEasyEditByElement(elementRef, elementPath, elementProps = {}) {
    const elementPathKey = getEditElementPathKey(elementPath, elementProps);
    return annotationState.store.easyEdits.find((edit) => (
      (elementRef && edit.elementRef === elementRef)
      || (
        elementPathKey
        && getEditElementPathKey(edit.elementPath, edit.elementProps) === elementPathKey
      )
    ));
  }

  function getElementForEdit(edit) {
    if (!annotationUI.mainEl) return null;
    if (!edit.elementPath && !Object.keys(edit.elementProps || {}).length) {
      return edit.elementRef ? getElementByRef(edit.elementRef) : null;
    }
    const anchorRecord = buildElementAnchorRecord(edit.elementPath, edit.elementProps);
    const byPath = getElementByCommentPath(anchorRecord);
    if (byPath instanceof HTMLElement) return byPath;
    if (edit.elementRef) {
      const byRef = getElementByRef(edit.elementRef);
      if (byRef) return byRef;
    }
    return null;
  }

  function pruneNestedTextEasyEdits() {
    const textEditTargets = annotationState.store.easyEdits.map((edit, index) => {
      if (edit?.editType !== 'text') return null;
      const target = getElementForEdit(edit);
      if (!(target instanceof HTMLElement)) return null;
      return { index, target };
    }).filter(Boolean);

    const targetToIndexes = new Map();
    textEditTargets.forEach(({ index, target }) => {
      const existingIndexes = targetToIndexes.get(target) || [];
      existingIndexes.push(index);
      targetToIndexes.set(target, existingIndexes);
    });

    const nestedAncestorIndexes = new Set();
    textEditTargets.forEach(({ target }) => {
      let parent = target.parentElement;
      while (parent && parent !== annotationUI.mainEl) {
        const ancestorIndexes = targetToIndexes.get(parent);
        if (ancestorIndexes?.length) {
          ancestorIndexes.forEach((index) => nestedAncestorIndexes.add(index));
        }
        parent = parent.parentElement;
      }
    });

    const nextEasyEdits = annotationState.store.easyEdits.filter((edit, index) => (
      edit?.editType !== 'text' || !nestedAncestorIndexes.has(index)
    ));

    if (nextEasyEdits.length === annotationState.store.easyEdits.length) return false;
    annotationState.store.easyEdits = nextEasyEdits;
    rebuildEditThreadsFromEasyEdits();
    return true;
  }

  function resolveStoredEasyEdit(normalizedEditRecord) {
    return annotationState.store.easyEdits.find((edit) => edit.id === normalizedEditRecord.id)
      || getEasyEditByElement(
        normalizedEditRecord.elementRef,
        normalizedEditRecord.elementPath,
        normalizedEditRecord.elementProps,
      )
      || null;
  }

  function upsertEasyEdit(editRecord) {
    const normalizedEditRecord = normalizeEasyEdit(editRecord);
    const normalizedEditPathKey = getEditElementPathKey(
      normalizedEditRecord.elementPath,
      normalizedEditRecord.elementProps,
    );
    const index = annotationState.store.easyEdits.findIndex((edit) => (
      edit.elementRef === normalizedEditRecord.elementRef
        || (
          normalizedEditPathKey
          && getEditElementPathKey(edit.elementPath, edit.elementProps) === normalizedEditPathKey
        )
    ));
    if (index > -1) {
      const existing = annotationState.store.easyEdits[index];
      const history = [...(existing.changeHistory || [])];
      const isImageEdit = normalizedEditRecord.editType === 'image-src'
        || normalizedEditRecord.editType === 'image-alt'
        || existing.editType === 'image-src'
        || existing.editType === 'image-alt';
      // Image edits: record a step when the file or URL changes (to may stay '').
      const valueChanged = isImageEdit
        ? (existing.to !== normalizedEditRecord.to
          || (existing.assetFileKey || '') !== (normalizedEditRecord.assetFileKey || ''))
        : (existing.to !== normalizedEditRecord.to);
      if (valueChanged) {
        history.push({
          to: existing.to,
          toHtml: existing.toHtml,
          fileKey: existing.assetFileKey || '',
          updatedAt: existing.updatedAt,
        });
      }
      annotationState.store.easyEdits[index] = {
        ...existing,
        ...normalizedEditRecord,
        from: existing.from,
        fromHtml: existing.fromHtml,
        changeHistory: history,
        // Preserve the viewport from when the edit was first created; don't let a
        // sync/update re-evaluate window.innerWidth at push time.
        viewport: editRecord.viewport || existing.viewport || normalizedEditRecord.viewport,
        isCommitted: false,
      };
      const didPruneNestedEdits = pruneNestedTextEasyEdits();
      if (!didPruneNestedEdits) rebuildEditThreadsFromEasyEdits();
      return resolveStoredEasyEdit(normalizedEditRecord);
    }
    annotationState.store.easyEdits.push(normalizedEditRecord);
    const didPruneNestedEdits = pruneNestedTextEasyEdits();
    if (!didPruneNestedEdits) rebuildEditThreadsFromEasyEdits();
    return resolveStoredEasyEdit(normalizedEditRecord);
  }

  function findEasyEditIndex(easyEditId) {
    if (!easyEditId) return -1;
    return annotationState.store.easyEdits.findIndex((edit) => edit?.id === easyEditId);
  }

  function undoLastChange(easyEditId) {
    const index = findEasyEditIndex(easyEditId);
    if (index < 0) return null;
    const edit = annotationState.store.easyEdits[index];
    const history = Array.isArray(edit.changeHistory) ? [...edit.changeHistory] : [];

   if (!history.length && edit.from === edit.to) return null;
    if (!history.length && edit.isCommitted) return null;

    let previousTo;
    let previousToHtml;
    let previousFileKey = '';
    if (history.length) {
      const popped = history.pop();
      previousTo = popped?.to ?? edit.from;
      previousToHtml = popped?.toHtml || '';
      previousFileKey = popped?.fileKey || '';
    } else {
      previousTo = edit.from;
      previousToHtml = edit.fromHtml;
    }

    annotationState.store.easyEdits[index] = {
      ...edit,
      to: `${previousTo ?? ''}`,
      toHtml: `${previousToHtml ?? ''}`,
      assetFileKey: previousFileKey,
      changeHistory: history,
      updatedAt: new Date().toISOString(),
    };
    rebuildEditThreadsFromEasyEdits();
    return annotationState.store.easyEdits[index];
  }

  function clearChangeHistoryAfterSave(savedEditIds = null) {
    const savedIdSet = Array.isArray(savedEditIds) && savedEditIds.length
      ? new Set(savedEditIds)
      : null;
    annotationState.store.easyEdits = annotationState.store.easyEdits.map((edit) => {
      if (savedIdSet && !savedIdSet.has(edit?.id)) return edit;
      return { ...edit, changeHistory: [], isCommitted: true };
    });
    rebuildEditThreadsFromEasyEdits();
  }

  function buildSavePayload() {
    const edits = annotationState.store.easyEdits
      .filter((edit) => {
        if (!edit) return false;
        // Don't persist a pending asset edit that hasn't been assigned a URL yet.
        if ((edit.editType === 'image-src' || edit.editType === 'image-alt') && !edit.to) {
          return false;
        }
        return edit.from !== edit.to || (edit.fromHtml || '') !== (edit.toHtml || '');
      })
      .map((edit) => {
        const { changeHistory, assetFileKey, ...rest } = edit;
        return rest;
      });

    const lastIdxByBlock = {};
    edits.forEach((edit, i) => {
      if (BLOCK_CLASSES.includes(edit.blockClass) && edit.toHtml) {
        lastIdxByBlock[edit.blockClass] = i;
      }
    });
    return edits.map((edit, i) => {
      const isRedundantBlockCopy = BLOCK_CLASSES.includes(edit.blockClass)
        && edit.toHtml && lastIdxByBlock[edit.blockClass] !== i;
      if (isRedundantBlockCopy) {
        const { toHtml, fromHtml, ...rest } = edit;
        return rest;
      }
      return edit;
    });
  }

  function replaceEasyEdits(nextEasyEdits = []) {
    annotationState.store.easyEdits = Array.isArray(nextEasyEdits)
      ? nextEasyEdits
        .filter((edit) => edit && typeof edit === 'object')
        .map((edit) => ({ ...normalizeEasyEdit(edit), isCommitted: true }))
      : [];
    const didPruneNestedEdits = pruneNestedTextEasyEdits();
    if (!didPruneNestedEdits) rebuildEditThreadsFromEasyEdits();
  }

  function getChangedSegments(fromText, toText) {
    const fromValue = `${fromText || ''}`;
    const toValue = `${toText || ''}`;
    let prefix = 0;
    while (
      prefix < fromValue.length
      && prefix < toValue.length
      && fromValue[prefix] === toValue[prefix]
    ) {
      prefix += 1;
    }

    let fromSuffixIndex = fromValue.length - 1;
    let toSuffixIndex = toValue.length - 1;
    while (
      fromSuffixIndex >= prefix
      && toSuffixIndex >= prefix
      && fromValue[fromSuffixIndex] === toValue[toSuffixIndex]
    ) {
      fromSuffixIndex -= 1;
      toSuffixIndex -= 1;
    }

    return {
      changedFrom: fromValue.slice(prefix, fromSuffixIndex + 1),
      changedTo: toValue.slice(prefix, toSuffixIndex + 1),
    };
  }

  function removeEasyEditHighlights(root = annotationUI.mainEl) {
    if (!(root instanceof HTMLElement)) return;
    root.querySelectorAll('.annotation-easy-edit-changed').forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      element.classList.remove('annotation-easy-edit-changed');
    });
  }

  function pushThreadMessage(thread, text, kind = 'reply') {
    thread.messages = thread.messages || [];
    thread.messages.push({
      id: generateId('message'),
      username: window.streamConfig?.username || DEFAULT_USERNAME,
      text,
      kind,
    });
  }

  function recordEditMessage(elementRef, elementPath, text, elementProps = {}) {
    let thread = getEditThreadByElementPath(elementPath, elementProps);
    if (!thread && elementRef) {
      thread = getThreadByElementRef(elementRef, 'edit');
    }
    if (!thread) {
      thread = {
        id: generateId('thread'),
        threadType: 'edit',
        elementRef,
        elementPath,
        elementProps,
        status: COMMENT_STATUSES[0],
        username: DEFAULT_USERNAME,
        messages: [],
      };
      annotationState.store.threads.push(thread);
    }

    const existingMessages = thread.messages || [];
    const kind = existingMessages.length ? 'reply' : 'comment';
    pushThreadMessage(thread, text, kind);
    annotationState.activeThreadId = thread.id;
    annotationState.activeMessageId = '';
    annotationState.activeEditId = '';
  }

  function rebindEasyEditsToCurrentDom() {
    if (!annotationUI.mainEl) return;
    annotationState.store.easyEdits.forEach((edit) => {
      const target = getElementForEdit(edit);
      if (!(target instanceof HTMLElement)) return;
      edit.elementRef = ensureElementRef(target);
      if (!edit.elementPath || !Object.keys(edit.elementProps || {}).length) {
        const editAnchor = buildEditElementAnchor(target, annotationUI.mainEl);
        edit.elementPath = editAnchor.elementPath;
        edit.elementProps = editAnchor.elementProps;
      }
    });
    rebuildEditThreadsFromEasyEdits();
  }

  const easyEditOriginalByElement = new WeakMap();

  // In-memory only (never serialized): File + base64 by fileKey, and base64 by URL.
  const assetFileByKey = new Map();
  const assetBase64ByKey = new Map();
  const assetBase64ByUrl = new Map();

  function registerAssetFile(fileKey, file, base64) {
    if (!fileKey) return;
    if (file) assetFileByKey.set(fileKey, file);
    if (base64) assetBase64ByKey.set(fileKey, base64);
  }

  function cacheAssetUrlBase64(url, base64) {
    if (url && base64) assetBase64ByUrl.set(url, base64);
  }

  function getAssetFile(fileKey) {
    return fileKey ? assetFileByKey.get(fileKey) || null : null;
  }

  function getAssetPreviewSrc({ to = '', fileKey = '' } = {}) {
    if (fileKey && assetBase64ByKey.has(fileKey)) return assetBase64ByKey.get(fileKey);
    if (to && assetBase64ByUrl.has(to)) return assetBase64ByUrl.get(to);
    return to || '';
  }

  function getEasyEditOriginalForElement(element) {
    if (!(element instanceof HTMLElement)) return null;
    return easyEditOriginalByElement.get(element) || null;
  }

  async function applyEasyEditsToDom() {
    if (!annotationUI.mainEl) return;
    removeEasyEditHighlights(annotationUI.mainEl);

    const resolvedUrls = new Map();
    if (previewUrlResolverFn) {
      await Promise.all(
        annotationState.store.easyEdits
          .filter((edit) => edit?.editType === 'image-src' && edit.to?.includes('content.da.live'))
          .map(async (edit) => {
            const b64 = await previewUrlResolverFn(edit.to);
            if (b64) resolvedUrls.set(edit.to, b64);
          }),
      );
    }

    keepLatestImageEdits(annotationState.store.easyEdits).forEach((edit) => {
      if (edit.from === edit.to && (edit.fromHtml || '') === (edit.toHtml || '')) return;

      // Metadata-like edit: replace the whole block on the DOM with the edited toHtml.
      // Resolved by block class (not the inner element ref) since these blocks render
      // in their own section.
      if (BLOCK_CLASSES.includes(edit.blockClass)) {
        const block = annotationUI.mainEl.querySelector(`div.${edit.blockClass}`);
        if (block && edit.toHtml) {
          const tmp = document.createElement('div');
          tmp.innerHTML = edit.toHtml;
          const newBlock = tmp.querySelector(`div.${edit.blockClass}`) || tmp.firstElementChild;
          if (newBlock) {
            const liveClone = block.cloneNode(true);
            liveClone.querySelectorAll('img').forEach((img) => {
              const orig = img.getAttribute('data-stream-original-src');
              if (orig) img.setAttribute('src', orig);
              [...img.attributes].filter((a) => a.name.startsWith('data-')).forEach((a) => img.removeAttribute(a.name));
            });
            if (liveClone.innerHTML !== newBlock.innerHTML) {
              block.innerHTML = newBlock.innerHTML;
            }
          }
          
          if (previewUrlResolverFn) {
            block.querySelectorAll('img').forEach((img) => {
              const src = img.getAttribute('src') || '';
              if (src && !src.startsWith('data:') && !img.getAttribute('data-stream-original-src')) {
                img.setAttribute('data-stream-original-src', src);
              }
              previewUrlResolverFn(src).then((b64) => {
                if (b64 && b64 !== src && img.getAttribute('src') === src) {
                  img.setAttribute('src', b64);
                }
              });
            });
          }
          if (onMetadataBlockRenderedFn) onMetadataBlockRenderedFn(block);
        }
        return;
      }

      const target = getElementForEdit(edit);
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('[data-class="fragment"]')) return;

      // Pending asset edit (empty `to`): keep the existing base64 preview.
      if ((edit.editType === 'image-src' || edit.editType === 'image-alt') && !edit.to) return;

      if (edit.editType === 'text') {
        easyEditOriginalByElement.set(target, {
          from: edit.from,
          fromHtml: edit.fromHtml || '',
        });
      }

      if (edit.editType === 'image-src') {
        const displayUrl = resolvedUrls.get(edit.to) || edit.to || '';
        const imgEl = target.tagName === 'IMG' ? target : target.querySelector('img');
        if (imgEl) {
          imgEl.setAttribute('src', displayUrl);
          if (imgEl.hasAttribute('srcset')) imgEl.setAttribute('srcset', displayUrl);
        }
        const picture = (imgEl || target).closest('picture');
        if (picture) {
          picture.querySelectorAll('source').forEach((s) => s.setAttribute('srcset', displayUrl));
        }
        return;
      }

      if (edit.editType === 'image-alt') {
        target.setAttribute('alt', edit.to || '');
        return;
      }

      if (edit.toHtml) {
        if (target.innerHTML !== edit.toHtml) {
          target.innerHTML = edit.toHtml;
        }
        return;
      }

      const currentText = target.textContent || '';
      if (edit.from && edit.to && edit.from !== edit.to && currentText.includes(edit.to)) {
        return;
      }
      if (edit.from && currentText.includes(edit.from)) {
        target.textContent = currentText.replace(edit.from, edit.to);
      } else if (edit.to) {
        target.textContent = edit.to;
      }
    });
  }

  return {
    applyEasyEditsToDom,
    applyEasyEditsToHtmlString,
    setPreviewUrlResolver,
    setOnMetadataBlockRendered,
    buildElementPath,
    buildCommentElementPath,
    buildEditElementAnchor,
    buildThreadElementPath,
    clearSelectedElement,
    ensureElementRef,
    generateId,
    getChangedSegments,
    getCommentThreadByElement,
    getCommentThreadByElementPath,
    getEditThreadByElement,
    getEditThreadByElementPath,
    getEditPanelMessage,
    getElementByCommentPath,
    getElementByThreadPath,
    getEasyEditByElement,
    getEasyEditOriginalForElement,
    registerAssetFile,
    cacheAssetUrlBase64,
    getAssetFile,
    getAssetPreviewSrc,
    getElementByRef,
    getElementForThread,
    getElementForEdit,
    getStoredAnnotationPayload,
    getThreadByElementPath,
    getThreadByElementRef,
    getThreadById,
    getThreadType,
    loadAnnotationStore,
    normalizeCommentStatus,
    pushThreadMessage,
    recordEditMessage,
    rebuildEditThreadsFromEasyEdits,
    rebindEasyEditsToCurrentDom,
    rebindThreadsToCurrentDom,
    replaceEasyEdits,
    removeThread,
    removeThreadMessage,
    replaceThreadsByType,
    removeEasyEditHighlights,
    saveAnnotationStore,
    upsertThread,
    upsertEasyEdit,
    undoLastChange,
    clearChangeHistoryAfterSave,
    buildSavePayload,
  };
}
