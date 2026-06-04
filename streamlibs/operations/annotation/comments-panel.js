/* eslint-disable no-console */
/* eslint-disable no-use-before-define */
import {
  ANNOTATION_MESSAGES,
  ANNOTATION_DEFAULT_USERNAME,
  ANNOTATION_REFRESH_EVENT,
} from '../../utils/constants.js';
import { COMMENT_STATUSES } from './store.js';
import createAnnotationServiceClient from './service.js';
import requestParentCollabRefresh from './collab-sync.js';
import syncFragmentEditDisabledHints from './fragment-hints.js';
import { hideGlobalSnackbar, showGlobalSnackbar } from '../../utils/snackbar.js';
import { formatCardTimestamp, ARROW_ICON_SVG } from '../../utils/utils.js';

const THREAD_STATUS_OPTIONS = Object.freeze(['Open', 'Accepted', 'Rejected', 'Closed']);

const MAX_LINK_DISPLAY_LENGTH = 60;

function truncateUrl(url) {
  if (url.length <= MAX_LINK_DISPLAY_LENGTH) return url;
  return `${url.slice(0, MAX_LINK_DISPLAY_LENGTH)}…`;
}

function linkifyText(str) {
  if (!str) return '';
  const escaped = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (match) => `<a href="${match}" target="_blank" rel="noopener noreferrer" title="${match}">${truncateUrl(match)}</a>`,
  );
}

export default function createCommentsPanelController({
  annotationState,
  annotationUI,
  store,
  assetsPanel,
  metadataPanel,
}) {
  const annotationService = createAnnotationServiceClient();
  const isInlineEditingAllowed = () => window.streamConfig?.inlineEditingAllowed !== false || window.streamConfig?.collabRole === 'owner';
  let enableInlineEditMode = async () => {};
  let disableInlineEditMode = () => {};
  let recordImageRegenAsLocalAsset = null;
  let flushPendingCommentsPanelRefresh = () => {};
  let renderCommentsPanel = () => {};
  let popupSubmitPending = false;
  let activePanelFilter = 'all';
  let activeCommentEditor = null;
  let popupDraft = '';
  let popupDraftKey = '';
  let pendingCommentsPanelRefresh = false;
  const panelReplyDrafts = new Map();
  const pendingReplyComposerKeys = new Set();
  const pendingCommentEditIds = new Set();
  const pendingAutoApplyThreadIds = new Set();

  function setInlineModeHandlers(handlers) {
    enableInlineEditMode = handlers.enableInlineEditMode;
    disableInlineEditMode = handlers.disableInlineEditMode;
  }

  function setImageRegenHandler(fn) {
    recordImageRegenAsLocalAsset = fn;
  }

  function setSelectedElement(element) {
    store.clearSelectedElement();
    annotationState.selectedElement = element;
    annotationState.selectedElement.classList.add('annotation-selected-element');
    annotationState.selectedElementRef = '';
    annotationState.selectedElementPath = store.buildCommentElementPath(
      annotationState.selectedElement,
      annotationUI.mainEl,
    );
  }

  function ensureFloatingLayer() {
    const existing = document.querySelector('.annotation-floating-layer');
    if (existing) existing.remove();

    const layer = document.createElement('div');
    layer.className = 'annotation-floating-layer';
    document.body.appendChild(layer);
    annotationUI.layerEl = layer;
  }

  function updateModeButtonStates() {
    if (annotationUI.inlineToggleEl instanceof HTMLButtonElement) {
      const pressed = annotationUI.annotationMode === 'edit' || annotationUI.inlineMode;
      annotationUI.inlineToggleEl.setAttribute('aria-pressed', `${pressed}`);
      annotationUI.inlineToggleEl.classList.toggle('is-active', pressed);
    }
    if (annotationUI.inlineAssetsToggleEl instanceof HTMLButtonElement) {
      const pressed = annotationUI.annotationMode === 'assets';
      annotationUI.inlineAssetsToggleEl.setAttribute('aria-pressed', `${pressed}`);
      annotationUI.inlineAssetsToggleEl.classList.toggle('is-active', pressed);
    }
  }

  function ensureCommentsPanel() {
    const existing = document.querySelector('.annotation-comments-panel');
    if (existing) existing.remove();

    const panel = document.createElement('aside');
    panel.className = 'annotation-comments-panel';
    panel.innerHTML = `
      <div class="annotation-comments-panel-header">
        <div class="annotation-comments-panel-heading">
          <h3>Annotations</h3>
        </div>
        <div class="annotation-mode-toolbar" role="toolbar" aria-label="Annotation modes">
          <button
            type="button"
            class="annotation-mode-btn annotation-mode-btn-edit"
            data-mode="edit"
            aria-pressed="false"
            aria-label="Toggle inline edit mode"
            title="Toggle inline edit mode"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 17.25V21h3.75L19.81 7.94l-3.75-3.75z"></path>
            </svg>
          </button>
          <button
            type="button"
            class="annotation-mode-btn annotation-mode-btn-assets"
            data-mode="assets"
            aria-pressed="false"
            aria-label="Toggle replace image mode"
            title="Toggle replace image mode"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"></path>
            </svg>
          </button>
          <button
            type="button"
            class="annotation-mode-btn annotation-mode-btn-visibility"
            aria-pressed="false"
            aria-label="Toggle annotation visibility"
            title="Toggle annotation visibility"
          >
            <svg class="annotation-visibility-icon-show" width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M12.306 4.28999C11.2818 3.76572 10.1505 3.48445 9 3.46799C4.668 3.46799 1.125 7.78099 1.125 9.17999C1.125 10.68 4.854 14.532 8.968 14.532C13.116 14.532 16.875 10.679 16.875 9.17999C16.875 7.99999 14.768 5.50999 12.306 4.28999ZM9 13.612C8.08783 13.612 7.19615 13.3415 6.43771 12.8347C5.67927 12.328 5.08814 11.6077 4.73907 10.7649C4.39 9.92219 4.29866 8.99487 4.47662 8.10023C4.65457 7.20559 5.09382 6.38381 5.73882 5.73881C6.38382 5.09381 7.2056 4.65456 8.10024 4.47661C8.99488 4.29865 9.9222 4.38998 10.7649 4.73905C11.6077 5.08813 12.328 5.67926 12.8347 6.4377C13.3415 7.19614 13.612 8.08782 13.612 8.99999C13.6117 10.2231 13.1257 11.396 12.2609 12.2609C11.396 13.1257 10.2231 13.6117 9 13.612Z" fill="currentColor"/>
              <path fill-rule="evenodd" clip-rule="evenodd" d="M10.333 9.04199C10.1579 9.04199 9.98444 9.00748 9.82265 8.94043C9.66085 8.87338 9.51386 8.7751 9.39007 8.65121C9.26627 8.52733 9.16811 8.38026 9.10118 8.21842C9.03425 8.05658 8.99986 7.88313 9 7.70799C9.0026 7.47626 9.06641 7.24933 9.18494 7.05019C9.30348 6.85105 9.47254 6.68677 9.675 6.57399C9.45606 6.50737 9.22882 6.47202 9 6.46899C8.49941 6.46899 8.01007 6.61743 7.59385 6.89554C7.17763 7.17365 6.85322 7.56894 6.66166 8.03142C6.47009 8.4939 6.41997 9.0028 6.51763 9.49377C6.61529 9.98473 6.85634 10.4357 7.21031 10.7897C7.56427 11.1436 8.01526 11.3847 8.50622 11.4824C8.99719 11.58 9.50609 11.5299 9.96857 11.3383C10.431 11.1468 10.8263 10.8224 11.1044 10.4061C11.3826 9.98992 11.531 9.50058 11.531 8.99999C11.5278 8.79709 11.4986 8.59544 11.444 8.39999C11.3292 8.59311 11.1668 8.75355 10.9723 8.86595C10.7777 8.97836 10.5576 9.03897 10.333 9.04199Z" fill="currentColor"/>
            </svg>
            <svg class="annotation-visibility-icon-hide" width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:none">
              <g clip-path="url(#clip0_visibility_hide)">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M7.286 4.71999C8.12397 4.3827 9.04261 4.29921 9.92766 4.47988C10.8127 4.66055 11.6251 5.09741 12.2638 5.73615C12.9026 6.37488 13.3394 7.18728 13.5201 8.07233C13.7008 8.95738 13.6173 9.87602 13.28 10.714L14.752 12.186C16.052 11.092 16.875 9.87999 16.875 9.17999C16.875 7.99799 14.768 5.50999 12.307 4.28999C11.2823 3.76588 10.1508 3.48462 9 3.46799C8.147 3.47595 7.3022 3.63543 6.505 3.93899L7.286 4.71999Z" fill="currentColor"/>
                <path fill-rule="evenodd" clip-rule="evenodd" d="M16.9 16.029L11.164 10.3C11.4029 9.90839 11.5299 9.45875 11.531 9.00001C11.5278 8.7971 11.4986 8.59545 11.444 8.40001C11.329 8.59275 11.1664 8.75279 10.9719 8.86484C10.7774 8.97688 10.5575 9.03719 10.333 9.04001C9.97965 9.04001 9.64074 8.8997 9.39079 8.64993C9.14083 8.40016 9.00027 8.06137 9.00001 7.70801C9.00261 7.47627 9.06642 7.24934 9.18495 7.0502C9.30349 6.85106 9.47255 6.68678 9.67501 6.57401C9.45608 6.50738 9.22883 6.47203 9.00001 6.46901C8.54126 6.47014 8.09162 6.59708 7.70001 6.83601L1.97101 1.10001C1.93302 1.06194 1.88789 1.03174 1.83822 1.01113C1.78854 0.990526 1.73529 0.979919 1.68151 0.979919C1.62773 0.979919 1.57447 0.990526 1.5248 1.01113C1.47512 1.03174 1.43 1.06194 1.39201 1.10001L1.10001 1.39201C1.06194 1.43 1.03174 1.47512 1.01113 1.5248C0.990526 1.57447 0.979919 1.62773 0.979919 1.68151C0.979919 1.73529 0.990526 1.78854 1.01113 1.83822C1.03174 1.88789 1.06194 1.93302 1.10001 1.97101L4.27601 5.14401C2.36901 6.51401 1.12501 8.35301 1.12501 9.18001C1.12501 10.68 4.85401 14.532 8.96801 14.532C10.2683 14.5059 11.5439 14.1717 12.69 13.557L16.029 16.897C16.067 16.9351 16.1121 16.9653 16.1618 16.9859C16.2115 17.0065 16.2647 17.0171 16.3185 17.0171C16.3723 17.0171 16.4255 17.0065 16.4752 16.9859C16.5249 16.9653 16.57 16.9351 16.608 16.897L16.897 16.608C16.9353 16.5702 16.9657 16.5252 16.9866 16.4757C17.0074 16.4261 17.0183 16.3729 17.0186 16.3191C17.0189 16.2653 17.0085 16.212 16.9882 16.1623C16.9678 16.1125 16.9379 16.0672 16.9 16.029ZM9.00001 13.612C8.1405 13.6141 7.2976 13.3754 6.56685 12.9229C5.83611 12.4704 5.24676 11.8222 4.86563 11.0518C4.4845 10.2814 4.32683 9.41966 4.4105 8.56424C4.49417 7.70881 4.81583 6.89394 5.33901 6.21201L6.83901 7.71201C6.54568 8.19402 6.42276 8.76059 6.48995 9.32082C6.55714 9.88106 6.81055 10.4025 7.20954 10.8015C7.60852 11.2005 8.12995 11.4539 8.69019 11.5211C9.25042 11.5883 9.81699 11.4653 10.299 11.172L11.799 12.672C10.9956 13.2861 10.0113 13.6167 9.00001 13.612Z" fill="currentColor"/>
              </g>
              <defs>
                <clipPath id="clip0_visibility_hide">
                  <rect width="18" height="18" fill="white"/>
                </clipPath>
              </defs>
            </svg>
          </button>
        </div>
      </div>
      <div class="annotation-panel-filter-tabs" role="tablist" aria-label="Filter annotations">
        <button type="button" role="tab" class="annotation-panel-filter-tab is-active" data-filter="all" aria-selected="true">All</button>
        <button type="button" role="tab" class="annotation-panel-filter-tab" data-filter="comment" aria-selected="false">Comments</button>
        <button type="button" role="tab" class="annotation-panel-filter-tab" data-filter="edit" aria-selected="false">Edits</button>
        <button type="button" role="tab" class="annotation-panel-filter-tab" data-filter="asset" aria-selected="false">Assets</button>
      </div>
      <div class="annotation-comments-content">
        <div class="annotation-comments-list"></div>
        <div class="annotation-comments-disabled-overlay">Edit mode is on. Switch it off to add comments.</div>
      </div>
    `;
    document.body.appendChild(panel);
    annotationUI.panelEl = panel;
    annotationUI.panelListEl = panel.querySelector('.annotation-comments-list');
    annotationUI.inlineToggleEl = panel.querySelector('.annotation-mode-btn-edit');
    annotationUI.inlineAssetsToggleEl = panel.querySelector('.annotation-mode-btn-assets');
    annotationUI.inlineCommentsToggleEl = null;
    annotationUI.visibilityToggleEl = panel.querySelector('.annotation-mode-btn-visibility');

    annotationUI.visibilityToggleEl.addEventListener('click', () => {
      const layer = document.querySelector('.annotation-floating-layer');
      const isHidden = annotationUI.visibilityToggleEl.getAttribute('aria-pressed') === 'true';
      const showIcon = annotationUI.visibilityToggleEl.querySelector('.annotation-visibility-icon-show');
      const hideIcon = annotationUI.visibilityToggleEl.querySelector('.annotation-visibility-icon-hide');
      if (isHidden) {
        if (layer) layer.style.display = '';
        annotationUI.visibilityToggleEl.setAttribute('aria-pressed', 'false');
        annotationUI.visibilityToggleEl.title = 'Toggle annotation visibility';
        if (showIcon) showIcon.style.display = '';
        if (hideIcon) hideIcon.style.display = 'none';
      } else {
        if (layer) layer.style.display = 'none';
        annotationUI.visibilityToggleEl.setAttribute('aria-pressed', 'true');
        annotationUI.visibilityToggleEl.title = 'Hide annotations';
        if (showIcon) showIcon.style.display = 'none';
        if (hideIcon) hideIcon.style.display = '';
      }
    });

    panel.querySelector('.annotation-panel-filter-tabs').addEventListener('click', (event) => {
      const tab = event.target.closest('.annotation-panel-filter-tab');
      if (!(tab instanceof HTMLButtonElement)) return;
      activePanelFilter = tab.dataset.filter || 'all';
      panel.querySelectorAll('.annotation-panel-filter-tab').forEach((btn) => {
        const isActive = btn.dataset.filter === activePanelFilter;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', `${isActive}`);
      });
      renderCommentsPanel();
    });

    updateModeButtonStates();
    applyOwnerOnlyToggleState();
  }

  function applyOwnerOnlyToggleState() {
    const isOwner = isCurrentUserCollabOwner();
    const restrictedTooltip = ANNOTATION_MESSAGES.inlineEditRestrictedDescription;

    if (annotationUI.inlineToggleEl instanceof HTMLButtonElement) {
      if (isOwner) {
        annotationUI.inlineToggleEl.disabled = false;
        annotationUI.inlineToggleEl.title = 'Toggle inline edit mode';
        annotationUI.inlineToggleEl.setAttribute('aria-label', 'Toggle inline edit mode');
        annotationUI.inlineToggleEl.removeAttribute('aria-disabled');
      } else {
        annotationUI.inlineToggleEl.disabled = true;
        annotationUI.inlineToggleEl.title = restrictedTooltip;
        annotationUI.inlineToggleEl.setAttribute('aria-label', restrictedTooltip);
        annotationUI.inlineToggleEl.setAttribute('aria-disabled', 'true');
      }
    }

    if (annotationUI.inlineAssetsToggleEl instanceof HTMLButtonElement) {
      if (isOwner) {
        annotationUI.inlineAssetsToggleEl.disabled = false;
        annotationUI.inlineAssetsToggleEl.title = 'Toggle replace image mode';
        annotationUI.inlineAssetsToggleEl.setAttribute('aria-label', 'Toggle replace image mode');
        annotationUI.inlineAssetsToggleEl.removeAttribute('aria-disabled');
      } else {
        annotationUI.inlineAssetsToggleEl.disabled = true;
        annotationUI.inlineAssetsToggleEl.title = restrictedTooltip;
        annotationUI.inlineAssetsToggleEl.setAttribute('aria-label', restrictedTooltip);
        annotationUI.inlineAssetsToggleEl.setAttribute('aria-disabled', 'true');
      }
    }
  }

  function ensureCanvasRefreshBar() {
    const existing = document.querySelector('.annotation-canvas-refresh-bar');
    if (existing) existing.remove();

    const refreshBar = document.createElement('div');
    refreshBar.className = 'annotation-canvas-refresh-bar';
    refreshBar.setAttribute('aria-hidden', 'true');
    refreshBar.setAttribute('role', 'status');
    refreshBar.setAttribute('aria-live', 'polite');
    refreshBar.innerHTML = `
      <div class="annotation-canvas-refresh-copy">
        <span class="annotation-canvas-refresh-icon" aria-hidden="true">i</span>
        <div class="annotation-canvas-refresh-text">
          <strong>${ANNOTATION_MESSAGES.refreshEditsTitle}</strong>
          <span>${ANNOTATION_MESSAGES.refreshEditsInlineMessage}</span>
        </div>
      </div>
      <button type="button" class="annotation-canvas-refresh-btn">${ANNOTATION_MESSAGES.refreshEditsAction}</button>
    `;
    document.body.appendChild(refreshBar);
    annotationUI.canvasRefreshBarEl = refreshBar;

    const refreshButton = refreshBar.querySelector('.annotation-canvas-refresh-btn');
    if (refreshButton instanceof HTMLButtonElement) {
      annotationState.canvasRefreshBarClickHandler = (event) => {
        event.preventDefault();
        event.stopPropagation();
        hideGlobalSnackbar();
        window.dispatchEvent(new CustomEvent(ANNOTATION_REFRESH_EVENT));
      };
      refreshButton.addEventListener('click', annotationState.canvasRefreshBarClickHandler);
    }
  }

  function buildCommentGroups(thread) {
    const groups = [];
    const byCommentId = new Map();
    let currentGroup = null;

    (thread.messages || []).forEach((message) => {
      const isComment = message.kind === 'comment' || !currentGroup;
      if (isComment) {
        const group = {
          comment: message,
          replies: [],
        };
        groups.push(group);
        byCommentId.set(message.id, group);
        currentGroup = group;
        return;
      }

      const parentGroup = message.replyToCommentId
        ? byCommentId.get(message.replyToCommentId)
        : currentGroup;
      if (parentGroup) parentGroup.replies.push(message);
    });

    return groups;
  }

  function getRootComment(thread) {
    return buildCommentGroups(thread)[0]?.comment || thread?.messages?.[0] || null;
  }

  function getCurrentUserIdentity() {
    return annotationService.getCurrentUserIdentity();
  }

  function isCurrentUserCollabOwner() {
    const normalizedRole = `${window.streamConfig?.collabRole || ''}`
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ');
    if (!normalizedRole) {
      return window.streamConfig?.inlineEditingAllowed === true;
    }
    return normalizedRole === 'owner'
      || normalizedRole === 'collab owner';
  }

  function isThreadClosed(thread) {
    return Boolean(thread) && store.normalizeCommentStatus(thread.status) === 'Closed';
  }

  function isCommentEditableByCurrentUser(thread, message) {
    if (!message || annotationUI.inlineMode || annotationUI.annotationMode !== 'comments') return false;
    const currentUser = getCurrentUserIdentity();
    const currentProfileId = `${currentUser?.profileId || ''}`.trim();
    const authorProfileId = `${message.authorProfileId ?? ''}`.trim();
    return Boolean(currentProfileId && authorProfileId && currentProfileId === authorProfileId);
  }

  function isThreadStatusEditableByCurrentUser(thread) {
    if (!thread) return false;
    if (annotationUI.inlineMode || annotationUI.annotationMode !== 'comments') return false;
    return isCurrentUserCollabOwner();
  }

  function getCommentEditorKey(threadId, commentId) {
    return `${threadId || ''}::${commentId || ''}`;
  }

  function getDraftScopeKey(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  function syncPopupDraftScope(elementPath) {
    const nextKey = getDraftScopeKey(elementPath);
    if (popupDraftKey && popupDraftKey !== nextKey) {
      popupDraft = '';
    }
    popupDraftKey = nextKey;
  }

  function updatePopupDraft(value) {
    popupDraft = value || '';
  }

  function clearPopupDraft() {
    popupDraft = '';
    popupDraftKey = '';
  }

  function getReplyComposerKey(threadId, commentId = '') {
    return `${threadId || ''}::${commentId || ''}`;
  }

  function getPanelReplyDraft(threadId, commentId = '') {
    return panelReplyDrafts.get(getReplyComposerKey(threadId, commentId)) || '';
  }

  function updatePanelReplyDraft(threadId, commentId = '', value = '') {
    const key = getReplyComposerKey(threadId, commentId);
    if (!value) {
      panelReplyDrafts.delete(key);
      return;
    }
    panelReplyDrafts.set(key, value);
  }

  function clearPanelReplyDraft(threadId, commentId = '') {
    panelReplyDrafts.delete(getReplyComposerKey(threadId, commentId));
  }

  function resetPanelReplyComposer(threadId, commentId = '') {
    clearPanelReplyDraft(threadId, commentId);
    const input = annotationUI.panelEl?.querySelector(
      `.annotation-panel-reply-input[data-thread-id="${threadId}"][data-comment-id="${commentId}"]`,
    );
    if (input instanceof HTMLInputElement) {
      input.value = '';
    }
  }

  function isEditingComment(threadId, commentId) {
    return activeCommentEditor?.threadId === threadId
      && activeCommentEditor?.commentId === commentId;
  }

  function openCommentEditor(threadId, commentId, text) {
    if (pendingCommentEditIds.size) return false;
    activeCommentEditor = {
      threadId,
      commentId,
      draft: text || '',
    };
    return true;
  }

  function focusCommentEditor(threadId, commentId) {
    window.requestAnimationFrame(() => {
      const input = annotationUI.panelEl?.querySelector(
        `.annotation-panel-edit-input[data-thread-id="${threadId}"][data-comment-id="${commentId}"]`,
      );
      if (!(input instanceof HTMLTextAreaElement)) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  function closeCommentEditor() {
    activeCommentEditor = null;
  }

  function updateCommentEditorDraft(value) {
    if (!activeCommentEditor) return;
    activeCommentEditor = {
      ...activeCommentEditor,
      draft: value,
    };
  }

  function isCommentsViewActive() {
    return annotationUI.annotationMode === 'comments' && !annotationUI.inlineMode;
  }

  function schedulePendingCommentsPanelRefreshFlush() {
    window.requestAnimationFrame(() => {
      flushPendingCommentsPanelRefresh();
    });
  }

  function shouldDeferCommentsPanelRefresh() {
    return pendingReplyComposerKeys.size > 0
      || pendingCommentEditIds.size > 0;
  }

  flushPendingCommentsPanelRefresh = function flushPendingCommentsPanelRefreshImpl() {
    if (!pendingCommentsPanelRefresh) return;
    if (shouldDeferCommentsPanelRefresh()) return;
    renderCommentsPanel();
  };

  function setCommentEditPending(threadId, commentId, isPending) {
    const key = getCommentEditorKey(threadId, commentId);
    if (isPending) {
      pendingCommentEditIds.add(key);
    } else {
      pendingCommentEditIds.delete(key);
    }

    const textArea = annotationUI.panelEl?.querySelector(
      `.annotation-panel-edit-input[data-thread-id="${threadId}"][data-comment-id="${commentId}"]`,
    );
    const saveBtn = annotationUI.panelEl?.querySelector(
      `.annotation-panel-edit-save-btn[data-thread-id="${threadId}"][data-comment-id="${commentId}"]`,
    );
    const cancelBtn = annotationUI.panelEl?.querySelector(
      `.annotation-panel-edit-cancel-btn[data-thread-id="${threadId}"][data-comment-id="${commentId}"]`,
    );
    const form = textArea?.closest('.annotation-panel-edit-form')
      || saveBtn?.closest('.annotation-panel-edit-form')
      || cancelBtn?.closest('.annotation-panel-edit-form');

    if (form instanceof HTMLElement) {
      form.classList.toggle('is-submitting', isPending);
      form.setAttribute('aria-busy', `${isPending}`);
    }
    if (textArea instanceof HTMLTextAreaElement) {
      textArea.readOnly = isPending;
    }
    if (saveBtn instanceof HTMLButtonElement) {
      saveBtn.disabled = isPending;
    }
    if (cancelBtn instanceof HTMLButtonElement) {
      cancelBtn.disabled = isPending;
    }
    if (!isPending) {
      schedulePendingCommentsPanelRefreshFlush();
    }
  }

  function setPanelReplyPending(threadId, commentId, isPending) {
    const key = getReplyComposerKey(threadId, commentId);
    if (isPending) {
      pendingReplyComposerKeys.add(key);
    } else {
      pendingReplyComposerKeys.delete(key);
    }

    const input = annotationUI.panelEl?.querySelector(
      `.annotation-panel-reply-input[data-thread-id="${threadId}"][data-comment-id="${commentId || ''}"]`,
    );
    const button = annotationUI.panelEl?.querySelector(
      `.annotation-panel-reply-btn[data-thread-id="${threadId}"][data-comment-id="${commentId || ''}"]`,
    );
    const composer = input?.closest('.annotation-panel-reply-composer')
      || button?.closest('.annotation-panel-reply-composer');

    if (composer instanceof HTMLElement) {
      composer.classList.toggle('is-submitting', isPending);
      composer.setAttribute('aria-busy', `${isPending}`);
    }
    if (input instanceof HTMLInputElement) {
      input.readOnly = isPending;
    }
    if (button instanceof HTMLButtonElement) {
      button.disabled = isPending;
    }
    if (!isPending) {
      schedulePendingCommentsPanelRefreshFlush();
    }
  }

  function createCommentEditForm(threadId, commentId, draft, isReply = false) {
    const editorFieldId = `annotation-panel-edit-input-${threadId}-${commentId}`;
    const editForm = document.createElement('div');
    editForm.className = isReply
      ? 'annotation-panel-edit-form annotation-panel-edit-form-reply'
      : 'annotation-panel-edit-form';

    const input = document.createElement('textarea');
    input.className = 'annotation-panel-edit-input';
    input.id = editorFieldId;
    input.name = editorFieldId;
    input.dataset.threadId = threadId;
    input.dataset.commentId = commentId;
    input.placeholder = ANNOTATION_MESSAGES.editCommentPlaceholder;
    input.value = draft || '';

    const actions = document.createElement('div');
    actions.className = 'annotation-panel-edit-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'annotation-panel-edit-cancel-btn';
    cancelBtn.dataset.threadId = threadId;
    cancelBtn.dataset.commentId = commentId;
    cancelBtn.setAttribute('aria-label', ANNOTATION_MESSAGES.cancelCommentAction);
    cancelBtn.setAttribute('title', ANNOTATION_MESSAGES.cancelCommentAction);
    cancelBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6L18 18M18 6L6 18"></path>
      </svg>
    `;

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'annotation-panel-edit-save-btn';
    saveBtn.dataset.threadId = threadId;
    saveBtn.dataset.commentId = commentId;
    saveBtn.setAttribute('aria-label', ANNOTATION_MESSAGES.saveCommentAction);
    saveBtn.setAttribute('title', ANNOTATION_MESSAGES.saveCommentAction);
    saveBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12.5L9.5 17L19 7.5"></path>
      </svg>
    `;

    actions.append(cancelBtn, saveBtn);
    editForm.append(input, actions);
    return editForm;
  }

  function isCommentsServiceAvailable() {
    return annotationService.isAvailable();
  }

  function showAttachAssetDropdown(anchorEl, threadId) {
    // Remove existing dropdown if any
    const existing = document.querySelector('.annotation-attach-dropdown');
    if (existing) { existing.remove(); return; }

    const assets = (annotationState.store.assets || [])
      .filter((a) => a.status !== 'rejected');
    if (!assets.length) return;

    const dropdown = document.createElement('div');
    dropdown.className = 'annotation-attach-dropdown';

    assets.forEach((asset) => {
      const item = document.createElement('button');
      item.className = 'annotation-attach-dropdown-item';
      item.textContent = `${asset.filename} (${asset.status})`;
      item.title = asset.elementPath;
      item.addEventListener('click', async () => {
        dropdown.remove();
        // Link this asset to the comment thread by re-uploading with comment_id
        // For now, we show the asset thumbnail inline in the thread as a visual reference
        try {
          const content = await (assetsPanel
            // eslint-disable-next-line no-underscore-dangle
            ? Promise.resolve(asset._base64Data ? { data: asset._base64Data } : null)
            : Promise.resolve(null));
          if (content?.data) {
            const thread = store.getThreadById(threadId);
            if (thread) {
              store.pushThreadMessage(threadId, {
                id: `asset-attach-${asset.id}-${Date.now()}`,
                username: '',
                text: `[Attached: ${asset.filename}]`,
                kind: 'reply',
                replyToCommentId: thread.messages?.[0]?.id || '',
                createdAt: new Date().toISOString(),
              });
              renderCommentsPanel();
            }
          }
        } catch (err) {
          console.error('[comments-panel] Attach asset failed:', err);
        }
      });
      dropdown.appendChild(item);
    });

    // Position dropdown below the anchor button
    const rect = anchorEl.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.zIndex = '10000';
    document.body.appendChild(dropdown);

    // Close on outside click
    const closeHandler = (e) => {
      if (!dropdown.contains(e.target)) {
        dropdown.remove();
        document.removeEventListener('click', closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
  }

  function captureTransientDraftsFromDom() {
    const popupInput = annotationUI.popupEl?.querySelector('.annotation-reply-input');
    if (popupInput instanceof HTMLTextAreaElement) {
      updatePopupDraft(popupInput.value);
    }

    annotationUI.panelEl?.querySelectorAll('.annotation-panel-reply-input').forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      updatePanelReplyDraft(input.dataset.threadId, input.dataset.commentId, input.value);
    });
  }

  function getThreadRenderSnapshot(thread) {
    return {
      id: thread?.id || '',
      threadType: store.getThreadType(thread),
      status: thread?.status || '',
      username: thread?.username || '',
      elementPath: getDraftScopeKey(thread?.elementPath),
      messages: (thread?.messages || []).map((message) => ({
        id: message?.id || '',
        authorProfileId: `${message?.authorProfileId ?? ''}`,
        username: message?.username || '',
        text: message?.text || '',
        kind: message?.kind || '',
        replyToCommentId: message?.replyToCommentId || '',
      })),
    };
  }

  function getThreadsRenderSignature(threads = []) {
    return JSON.stringify(threads.map(getThreadRenderSnapshot));
  }

  function createFnv1aHash() {
    let hash = 0x811c9dc5;
    return {
      update(value = '') {
        const input = `${value}`;
        for (let index = 0; index < input.length; index += 1) {
          // eslint-disable-next-line no-bitwise
          hash ^= input.charCodeAt(index);
          // eslint-disable-next-line no-bitwise
          hash = Math.imul(hash, 0x01000193) >>> 0;
        }
      },
      digest() {
        return hash.toString(16).padStart(8, '0');
      },
    };
  }

  function getStableStringValue(input) {
    if (Array.isArray(input)) {
      return input.map((item) => getStableStringValue(item));
    }
    if (input && typeof input === 'object') {
      return Object.keys(input)
        .sort()
        .reduce((result, key) => {
          result[key] = getStableStringValue(input[key]);
          return result;
        }, {});
    }
    return input;
  }

  function stringifyStableValue(value) {
    try {
      return JSON.stringify(getStableStringValue(value));
    } catch {
      return '';
    }
  }

  function getEasyEditComparisonSnapshot(edit) {
    return {
      editType: edit?.editType || '',
      attrName: edit?.attrName || '',
      elementPath: edit?.elementPath || '',
      elementProps: stringifyStableValue(edit?.elementProps || {}),
      from: edit?.from || '',
      to: edit?.to || '',
      fromHtml: edit?.fromHtml || '',
      toHtml: edit?.toHtml || '',
      changedFrom: edit?.changedFrom || '',
      changedTo: edit?.changedTo || '',
    };
  }

  function getEasyEditsComparisonHash(edits = []) {
    const normalizedEdits = [...edits]
      .map((edit) => {
        const snapshot = getEasyEditComparisonSnapshot(edit);
        const stableKey = `${snapshot.elementPath}::${snapshot.attrName}::${snapshot.editType}`;
        return `${stableKey}|${stringifyStableValue(snapshot)}`;
      })
      .sort();

    const hash = createFnv1aHash();
    normalizedEdits.forEach((normalizedEdit) => {
      hash.update(normalizedEdit);
      hash.update('\u001f');
    });

    return hash.digest();
  }

  function getEasyEditsComparisonSize(edits = []) {
    return Array.isArray(edits) ? edits.length : 0;
  }

  function getSelfSavedEditsFingerprint(edits = []) {
    return {
      count: getEasyEditsComparisonSize(edits),
      hash: getEasyEditsComparisonHash(edits),
    };
  }

  function setSelfSavedEditsFingerprint(edits = []) {
    const fingerprint = getSelfSavedEditsFingerprint(edits);
    annotationState.latestSelfSavedEditsHash = fingerprint.hash;
    annotationState.latestSelfSavedEditsCount = fingerprint.count;
  }

  function clearSelfSavedEditsFingerprint() {
    annotationState.latestSelfSavedEditsHash = '';
    annotationState.latestSelfSavedEditsCount = 0;
  }

  function markSelfSavedEditsSnapshot(editRecord = []) {
    setSelfSavedEditsFingerprint(editRecord);
  }

  function shouldSuppressSelfSaveRefresh(remoteEditRecord = []) {
    if (!annotationState.latestSelfSavedEditsHash) return false;
    if (
      getEasyEditsComparisonSize(remoteEditRecord) !== annotationState.latestSelfSavedEditsCount
    ) {
      return false;
    }
    return (
      getEasyEditsComparisonHash(remoteEditRecord)
      === annotationState.latestSelfSavedEditsHash
    );
  }

  function syncPendingPanelStates() {
    pendingReplyComposerKeys.forEach((key) => {
      const [threadId = '', commentId = ''] = key.split('::');
      setPanelReplyPending(threadId, commentId, true);
    });
    pendingCommentEditIds.forEach((key) => {
      const [threadId = '', commentId = ''] = key.split('::');
      setCommentEditPending(threadId, commentId, true);
    });
  }

  function getTimestampValue(value) {
    const timestamp = new Date(value || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function hasPendingRemoteEdits() {
    return Boolean(
      annotationState.pendingRemoteEditsSnapshot?.updatedAt
      || annotationState.pendingRemoteEditsSnapshot?.createdAt,
    );
  }

  function renderRefreshAction() {
    if (!(annotationUI.canvasRefreshBarEl instanceof HTMLElement)) return;
    const isVisible = hasPendingRemoteEdits();
    annotationUI.canvasRefreshBarEl.classList.toggle('is-visible', isVisible);
    annotationUI.canvasRefreshBarEl.setAttribute('aria-hidden', `${!isVisible}`);
  }

  function applyNormalizedCommentThreads(nextCommentThreads = []) {
    const currentCommentThreads = annotationState.store.threads.filter(
      (thread) => store.getThreadType(thread) === 'comment',
    );
    const didCommentsChange = getThreadsRenderSignature(currentCommentThreads)
      !== getThreadsRenderSignature(nextCommentThreads);

    if (!didCommentsChange) {
      if (pendingCommentsPanelRefresh && !shouldDeferCommentsPanelRefresh()) {
        renderCommentsPanel();
      }
      return false;
    }

    store.replaceThreadsByType('comment', nextCommentThreads);

    // eslint-disable-next-line no-use-before-define
    clearThreadTargetCache();
    // eslint-disable-next-line no-use-before-define
    renderThreadMarkers({ resolveTargets: true });

    if (shouldDeferCommentsPanelRefresh()) {
      pendingCommentsPanelRefresh = true;
      return true;
    }

    renderCommentsPanel();
    return true;
  }

  function applySavedEditsSnapshot(snapshot) {
    store.replaceEasyEdits(snapshot?.editRecord || []);
    annotationState.latestSavedEditsUpdatedAt = snapshot?.updatedAt || snapshot?.createdAt || null;
    annotationState.pendingRemoteEditsSnapshot = null;
    annotationState.hasLoadedInitialEditsSnapshot = true;
    store.rebindEasyEditsToCurrentDom();
    store.applyEasyEditsToDom();
    store.saveAnnotationStore();
    // eslint-disable-next-line no-use-before-define
    clearThreadTargetCache();
    // eslint-disable-next-line no-use-before-define
    renderThreadMarkers({ resolveTargets: true });
    renderCommentsPanel();
  }

  function applyRemoteEditsSnapshot(remoteEditSnapshot, options = {}) {
    const {
      forceApply = false,
    } = options;

    const safeSnapshot = remoteEditSnapshot || {
      createdAt: null,
      updatedAt: null,
      authorUsername: '',
      editRecord: [],
    };
    const remoteUpdatedAtValue = getTimestampValue(
      safeSnapshot.updatedAt || safeSnapshot.createdAt,
    );
    const currentUpdatedAtValue = getTimestampValue(annotationState.latestSavedEditsUpdatedAt);
    const pendingUpdatedAtValue = getTimestampValue(
      annotationState.pendingRemoteEditsSnapshot?.updatedAt
      || annotationState.pendingRemoteEditsSnapshot?.createdAt,
    );

    if (!annotationState.hasLoadedInitialEditsSnapshot || forceApply) {
      applySavedEditsSnapshot(safeSnapshot);
      return true;
    }

    if (!remoteUpdatedAtValue) {
      return false;
    }

    if (remoteUpdatedAtValue <= currentUpdatedAtValue) {
      return false;
    }

    if (remoteUpdatedAtValue <= pendingUpdatedAtValue) {
      return false;
    }

    if (annotationState.latestSelfSavedEditsHash) {
      const shouldSuppress = shouldSuppressSelfSaveRefresh(safeSnapshot.editRecord);
      clearSelfSavedEditsFingerprint();
      if (shouldSuppress) {
        applySavedEditsSnapshot(safeSnapshot);
        return false;
      }
    }

    annotationState.pendingRemoteEditsSnapshot = safeSnapshot;
    renderCommentsPanel();
    showGlobalSnackbar(ANNOTATION_MESSAGES.refreshEditsSnackbar, {
      variant: 'warning',
    });
    return true;
  }

  function applyRemoteCollabSnapshot(snapshot = {}, options = {}) {
    const {
      includeEdits = true,
    } = options;

    annotationState.latestRemoteCollabSnapshot = snapshot;

    if (snapshot?.collab) {
      try {
        const nextThreads = annotationService.normalizeThreadsPayload(snapshot.collab);
        if (Array.isArray(nextThreads)) {
          applyNormalizedCommentThreads(
            nextThreads.filter((thread) => store.getThreadType(thread) === 'comment'),
          );
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Could not apply remote comment snapshot', error);
      }
    }

    if (includeEdits && snapshot && Object.prototype.hasOwnProperty.call(snapshot, 'edits')) {
      try {
        const nextEditSnapshot = annotationService.normalizeEditsSnapshot(snapshot.edits);
        applyRemoteEditsSnapshot(nextEditSnapshot);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Could not apply remote edits snapshot', error);
      }
    }

    // Update assets from snapshot (edits API returns { edits, assets })
    const remoteAssets = snapshot?.edits?.assets || snapshot?.assets;
    if (remoteAssets && assetsPanel) {
      try {
        assetsPanel.updateAssetsFromSnapshot(remoteAssets);
        // eslint-disable-next-line no-use-before-define
        clearThreadTargetCache();
        // eslint-disable-next-line no-use-before-define
        renderThreadMarkers({ resolveTargets: true });
        renderCommentsPanel();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Could not apply remote assets snapshot', error);
      }
    }
  }

  function applyPendingRemoteEditsSnapshot() {
    if (!annotationState.pendingRemoteEditsSnapshot) return false;
    applyRemoteEditsSnapshot(annotationState.pendingRemoteEditsSnapshot, {
      forceApply: true,
    });
    return true;
  }

  function getThreadActivityTimestamp(thread) {
    if (!thread) return 0;
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    let latest = 0;
    messages.forEach((message) => {
      const candidates = [message?.editedAt, message?.createdAt];
      candidates.forEach((value) => {
        const ts = getTimestampValue(value);
        if (ts > latest) latest = ts;
      });
    });
    if (!latest) {
      latest = getTimestampValue(thread.updatedAt || thread.createdAt);
    }
    return latest;
  }

  function buildUnifiedItems() {
    const items = [];

    annotationState.store.threads.forEach((thread) => {
      if (!thread) return;
      const threadType = store.getThreadType(thread);
      if (threadType === 'comment' || threadType === 'edit') {
        items.push({
          kind: threadType,
          thread,
          timestamp: getThreadActivityTimestamp(thread),
        });
      }
    });

    if (assetsPanel) {
      // One item per image edit; renders as a stack of From→To history cards.
      (annotationState.store.easyEdits || [])
        .filter((edit) => edit && edit.editType === 'image-src')
        .forEach((edit) => {
          items.push({
            kind: 'asset-edit',
            edit,
            timestamp: getTimestampValue(edit.updatedAt) || 0,
          });
        });
    }

    items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return items;
  }

  function enforceThreadStatusSelectOptions(root) {
    const scope = root || annotationUI.panelEl || annotationUI.panelListEl;
    if (!scope || typeof scope.querySelectorAll !== 'function') return;
    const statusSelects = scope.querySelectorAll(
      '.annotation-panel-status-select:not(.annotation-reviewer-select)',
    );
    statusSelects.forEach((statusSelect) => {
      if (!(statusSelect instanceof HTMLSelectElement)) return;
      const { threadId } = statusSelect.dataset;
      const thread = threadId ? store.getThreadById?.(threadId) : null;
      const normalizedThreadStatus = store.normalizeCommentStatus(thread?.status || statusSelect.value || '');
      const selectedStatus = THREAD_STATUS_OPTIONS.includes(normalizedThreadStatus)
        ? normalizedThreadStatus
        : THREAD_STATUS_OPTIONS[0];
      statusSelect.innerHTML = '';
      THREAD_STATUS_OPTIONS.forEach((status) => {
        const option = document.createElement('option');
        option.value = status;
        option.textContent = status;
        option.selected = selectedStatus === status;
        statusSelect.appendChild(option);
      });
    });
  }

  renderCommentsPanel = function renderCommentsPanelImpl() {
    if (!annotationUI.panelListEl) return;
    pendingCommentsPanelRefresh = false;
    captureTransientDraftsFromDom();
    renderRefreshAction();
    updateModeButtonStates();

    const finalizeFragmentHints = () => syncFragmentEditDisabledHints(
      annotationUI.mainEl,
      annotationUI.annotationMode === 'edit'
        || annotationUI.inlineMode
        || annotationUI.assetSelectMode,
    );

    const activePopupThreadId = `${annotationUI.popupEl?.dataset.threadId || ''}`.trim();
    if (activePopupThreadId) {
      const popupThread = store.getThreadById(activePopupThreadId);
      if (isThreadClosed(popupThread)) {
        closePopupAndSelection();
        showGlobalSnackbar(ANNOTATION_MESSAGES.closedThreadRestricted);
      }
    }

    let preservedComposer = null;
    let preservedComposerKey = '';
    let preservedEditForm = null;
    let preservedEditKey = '';
    let preservedSelStart = 0;
    let preservedSelEnd = 0;
    let preservedIsReply = false;

    const { activeElement } = document;
    if (activeElement && annotationUI.panelListEl.contains(activeElement)) {
      if (
        activeElement instanceof HTMLInputElement
        && activeElement.classList.contains('annotation-panel-reply-input')
      ) {
        const tid = activeElement.dataset.threadId || '';
        const cid = activeElement.dataset.commentId || '';
        preservedComposerKey = `${tid}::${cid}`;
        preservedSelStart = activeElement.selectionStart ?? activeElement.value.length;
        preservedSelEnd = activeElement.selectionEnd ?? activeElement.value.length;
        preservedComposer = activeElement.closest('.annotation-panel-reply-composer');
        if (preservedComposer) preservedComposer.remove();
      } else if (
        activeElement instanceof HTMLTextAreaElement
        && activeElement.classList.contains('annotation-panel-edit-input')
      ) {
        const tid = activeElement.dataset.threadId || '';
        const cid = activeElement.dataset.commentId || '';
        preservedEditKey = `${tid}::${cid}`;
        preservedSelStart = activeElement.selectionStart ?? activeElement.value.length;
        preservedSelEnd = activeElement.selectionEnd ?? activeElement.value.length;
        preservedEditForm = activeElement.closest('.annotation-panel-edit-form');
        preservedIsReply = !!activeElement.closest('.annotation-panel-reply-row');
        if (preservedEditForm) preservedEditForm.remove();
      }
    }

    const scrollContainer = annotationUI.panelEl?.querySelector('.annotation-comments-content');
    const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

    annotationUI.panelListEl.innerHTML = '';
    const panelTitle = annotationUI.panelEl?.querySelector('.annotation-comments-panel-header h3');
    if (panelTitle instanceof HTMLElement) {
      panelTitle.textContent = 'Annotations';
    }

    if (assetsPanel
      && annotationUI.annotationMode === 'assets'
      && !annotationUI.assetSelectMode) {
      assetsPanel.enterSelectMode();
    }

    if (annotationUI.annotationMode === 'edit' && annotationUI.inlineMode) {
      const hint = document.createElement('p');
      hint.className = 'annotation-mode-hint annotation-mode-hint-edit';
      hint.textContent = 'Click on text on the page to suggest a replacement.';
      annotationUI.panelListEl.appendChild(hint);
    } else if (
      assetsPanel
      && annotationUI.annotationMode === 'assets'
      && annotationUI.assetSelectMode
    ) {
      const hint = document.createElement('p');
      hint.className = 'annotation-mode-hint annotation-mode-hint-assets';
      hint.textContent = 'Click an image on the page to upload a replacement.';
      annotationUI.panelListEl.appendChild(hint);
      finalizeFragmentHints();
    }

    if (!isCommentsServiceAvailable()) {
      const empty = document.createElement('div');
      empty.className = 'annotation-comments-empty annotation-comments-empty-warning';
      empty.innerHTML = `
        <strong>${ANNOTATION_MESSAGES.collabUnavailableTitle}</strong>
        <span>${ANNOTATION_MESSAGES.collabUnavailableDescription}</span>
      `;
      annotationUI.panelListEl.appendChild(empty);
      finalizeFragmentHints();
      return;
    }

    annotationUI.panelEl?.querySelectorAll('.annotation-panel-filter-tab').forEach((btn) => {
      const isActive = btn.dataset.filter === activePanelFilter;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', `${isActive}`);
    });

    const allItems = buildUnifiedItems();
    const unifiedItems = activePanelFilter === 'all' ? allItems : allItems.filter((item) => {
      if (activePanelFilter === 'comment') return item.kind === 'comment';
      if (activePanelFilter === 'edit') return item.kind === 'edit';
      if (activePanelFilter === 'asset') return item.kind === 'asset-edit';
      return true;
    });

    if (!unifiedItems.length) {
      const empty = document.createElement('p');
      empty.className = 'annotation-comments-empty';
      const emptyMessages = {
        comment: 'No comments yet.',
        edit: 'No inline edits yet.',
        asset: 'No asset replacements yet.',
        all: 'No annotations yet. Add comments, make inline edits, or replace images to populate this feed.',
      };
      empty.textContent = emptyMessages[activePanelFilter] || emptyMessages.all;
      annotationUI.panelListEl.appendChild(empty);
      finalizeFragmentHints();
      return;
    }

    let didReuseComposer = false;
    let didReuseEditForm = false;

    const renderThreadItem = (thread, isCommentThread) => {
      const groups = buildCommentGroups(thread);
      groups.forEach((group, idx) => {
        const isLatestInThread = idx === groups.length - 1;
        const isClosedThread = isThreadClosed(thread);
        const canEditRootComment = isCommentThread
          && !isClosedThread
          && isCommentEditableByCurrentUser(thread, group.comment);
        const isMetadataBlockEdit = !isCommentThread && thread.editType === 'metadata-block';
        const card = document.createElement('article');
        card.className = isCommentThread
          ? 'annotation-panel-comment annotation-panel-comment-item'
          : `annotation-panel-comment annotation-panel-edit-item${
            isMetadataBlockEdit ? ' annotation-panel-edit-item-metadata' : ''}`;
        card.dataset.threadId = thread.id;
        card.dataset.messageId = group.comment.id || '';
        if (isMetadataBlockEdit) {
          card.dataset.metadataEditId = thread.id;
          if (thread.blockSelector) card.dataset.blockSelector = thread.blockSelector;
        }
        const isActiveMessage = Boolean(annotationState.activeMessageId)
          && group.comment.id === annotationState.activeMessageId;
        if (isActiveMessage
          || (!annotationState.activeMessageId
            && thread.id === annotationState.activeThreadId
            && isLatestInThread)) {
          card.classList.add('is-active');
        }

        let statusControls;
        if (isCommentThread) {
          statusControls = document.createElement('div');
          statusControls.className = 'annotation-panel-status-controls';
          const statusSelect = document.createElement('select');
          const canEditThreadStatus = isThreadStatusEditableByCurrentUser(thread);
          statusSelect.className = 'annotation-panel-status-select';
          statusSelect.dataset.threadId = thread.id;
          statusSelect.dataset.messageId = group.comment.id || '';
          statusSelect.disabled = !canEditThreadStatus;
          if (!canEditThreadStatus) {
            const restrictionMessage = isClosedThread
              ? ANNOTATION_MESSAGES.closedThreadRestricted
              : ANNOTATION_MESSAGES.updateStatusRestricted;
            statusSelect.title = restrictionMessage;
            statusSelect.setAttribute('aria-label', restrictionMessage);
          }
          const normalizedThreadStatus = store.normalizeCommentStatus(thread.status);
          const selectedThreadStatus = THREAD_STATUS_OPTIONS.includes(normalizedThreadStatus)
            ? normalizedThreadStatus
            : THREAD_STATUS_OPTIONS[0];
          THREAD_STATUS_OPTIONS.forEach((status) => {
            const option = document.createElement('option');
            option.value = status;
            option.textContent = status;
            option.selected = selectedThreadStatus === status;
            statusSelect.appendChild(option);
          });
          statusSelect.dataset.status = store.normalizeCommentStatus(thread.status);
          statusControls.append(statusSelect);
          if (canEditRootComment) {
            const editThreadBtn = document.createElement('button');
            editThreadBtn.type = 'button';
            editThreadBtn.className = 'annotation-panel-edit-btn';
            editThreadBtn.dataset.action = 'edit-comment';
            editThreadBtn.dataset.threadId = thread.id;
            editThreadBtn.dataset.commentId = group.comment.id || '';
            editThreadBtn.setAttribute('aria-label', ANNOTATION_MESSAGES.editCommentAriaLabel);
            editThreadBtn.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 17.25V21h3.75L19.81 7.94l-3.75-3.75z"></path>
            </svg>
          `;
            statusControls.append(editThreadBtn);
          }
        }

        const username = document.createElement('p');
        username.className = 'annotation-panel-comment-user';
        username.textContent = group.comment.username
          || thread.username
          || ANNOTATION_DEFAULT_USERNAME;

        const cardHeader = document.createElement('div');
        cardHeader.className = 'annotation-panel-comment-header';
        cardHeader.append(username);
        if (statusControls) cardHeader.append(statusControls);

        if (isCommentThread && window.streamConfig?.operation === 'aiSeoAnnotation') {
          const normalizedStatus = store.normalizeCommentStatus(thread.status);
          const isOwner = isCurrentUserCollabOwner();
          const isAutoApplyEnabled = isOwner
            && (normalizedStatus === 'Resolved' || normalizedStatus === 'Accepted')
            && !pendingAutoApplyThreadIds.has(thread.id);
          const autoApplyBtn = document.createElement('button');
          autoApplyBtn.type = 'button';
          autoApplyBtn.className = 'annotation-card-auto-apply-btn';
          autoApplyBtn.disabled = !isAutoApplyEnabled;
          autoApplyBtn.setAttribute('aria-label', 'Auto apply comment');
          // eslint-disable-next-line no-nested-ternary
          autoApplyBtn.title = !isOwner
            ? 'Only the owner can auto apply comments'
            : isAutoApplyEnabled
              ? 'Auto apply comment'
              : 'Resolve the comment to enable auto apply';
          autoApplyBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74Z"/>
            <path d="M19 15l1.09 2.91L23 19l-2.91 1.09L19 23l-1.09-2.91L15 19l2.91-1.09Z"/>
          </svg>`;
          autoApplyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();

            let targetEl = store.getElementForThread(thread);
            if (!targetEl) {
              const ep = thread.elementPath;
              const fallbackSelector = (typeof ep === 'object' ? ep?.selector : null)
                || (typeof ep === 'string' ? (() => { try { return JSON.parse(ep)?.selector; } catch { return null; } })() : null);
              if (fallbackSelector && annotationUI.mainEl) {
                targetEl = annotationUI.mainEl.querySelector(fallbackSelector);
              }
            }
            if (!targetEl) {
              return;
            }

            const TEXT_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'TD', 'TH']);
            const isTextEl = TEXT_TAGS.has(targetEl.tagName);
            let targetImg = targetEl.tagName === 'IMG' ? targetEl : targetEl.querySelector('img');
            if (!targetImg && targetEl.parentElement) {
              targetImg = targetEl.parentElement.querySelector('img');
            }
            // eslint-disable-next-line max-len
            if (isTextEl) {
              const elementText = targetEl.textContent.trim();
              if (!elementText) return;

              const allGroups = buildCommentGroups(thread);
              const commentLines = [];
              allGroups.forEach((g) => {
                if (g.comment?.text) commentLines.push(`- ${g.comment.text}`);
                g.replies.forEach((reply) => {
                  if (reply?.text) commentLines.push(`- ${reply.text}`);
                });
              });

              const payloadText = `${elementText}\nRegenerate based on following comments\n${commentLines.join('\n')}`;
              const token = window.streamConfig?.token || '';
              const endpoint = `${window.streamConfig?.streamMapper?.serviceEP || ''}/api/content-regeneration`;
              const threadId = window.streamConfig?.threadId || '';

              let blockName = '';
              let cur = targetEl;
              while (cur && cur !== document.body) {
                const parent = cur.parentElement;
                if (parent?.classList.contains('section')) { blockName = cur.classList[0] || ''; break; }
                cur = parent;
              }

              pendingAutoApplyThreadIds.add(thread.id);
              autoApplyBtn.disabled = true;
              autoApplyBtn.classList.add('is-loading');
              try {
                const res = await fetch(endpoint, {
                  method: 'POST',
                  headers: {
                    'content-type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                  },
                  // eslint-disable-next-line max-len
                  body: JSON.stringify({ text: payloadText, block: blockName, thread_id: threadId }),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                const newText = json?.response?.text || json.text || json.content || json.result || '';
                if (newText && targetEl.isConnected) {
                  // Auto-apply inside a managed metadata block is owned by the
                  // metadata-block recorder; skip the text-edit record.
                  if (targetEl.closest('.page-metadata, .card-metadata')) return;
                  const fromText = targetEl.textContent.trim();
                  const fromHtml = targetEl.innerHTML;
                  targetEl.textContent = newText;
                  const elementRef = store.ensureElementRef(targetEl);
                  const snapshot = annotationUI.inlineElementSnapshot?.get(elementRef);
                  const baselineText = snapshot?.originalText || fromText;
                  const baselineHtml = snapshot?.originalHtml || fromHtml;
                  const editAnchor = store.buildEditElementAnchor(targetEl, annotationUI.mainEl);
                  const segments = store.getChangedSegments(baselineText, newText);
                  const { elementPath, elementProps } = editAnchor;
                  // eslint-disable-next-line max-len
                  const existing = store.getEasyEditByElement(elementRef, elementPath, elementProps);
                  store.upsertEasyEdit({
                    id: existing?.id || store.generateId('easy-edit'),
                    editType: 'text',
                    attrName: '',
                    elementPath: editAnchor.elementPath,
                    elementProps: editAnchor.elementProps,
                    elementRef,
                    from: baselineText,
                    to: newText,
                    fromHtml: baselineHtml,
                    toHtml: newText,
                    changedFrom: segments.changedFrom,
                    changedTo: segments.changedTo,
                    updatedAt: new Date().toISOString(),
                  });
                  store.saveAnnotationStore();
                  renderThreadMarkers({ resolveTargets: true });
                  renderCommentsPanel();
                }
              } catch (err) {
                console.error('[auto-apply] content-regeneration failed', err);
              } finally {
                pendingAutoApplyThreadIds.delete(thread.id);
                autoApplyBtn.disabled = false;
                autoApplyBtn.classList.remove('is-loading');
              }
            } else if (targetImg) {
              const imgSrc = targetImg.getAttribute('src') || '';
              const isSvg = /\.svg(\?.*)?$/i.test(imgSrc) || imgSrc.startsWith('data:image/svg');
              if (!isSvg && typeof recordImageRegenAsLocalAsset === 'function') {
                const altText = targetImg.alt || '';
                const allGroups = buildCommentGroups(thread);
                const commentLines = [];
                allGroups.forEach((g) => {
                  if (g.comment?.text) commentLines.push(`- ${g.comment.text}`);
                  g.replies.forEach((reply) => {
                    if (reply?.text) commentLines.push(`- ${reply.text}`);
                  });
                });
                const prompt = `Change the image generated for ${altText}\nTo have following changes\n${commentLines.join('\n')}`;
                const token = window.streamConfig?.token || '';
                const endpoint = `${window.streamConfig?.streamMapper?.serviceEP || ''}/api/image-generation`;

                pendingAutoApplyThreadIds.add(thread.id);
                autoApplyBtn.disabled = true;
                autoApplyBtn.classList.add('is-loading');
                try {
                  const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                      'content-type': 'application/json',
                      ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({ prompt }),
                  });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const json = await res.json();
                  const newUrl = json?.response?.imageUrl || json?.response?.url || json.url || json.image_url || json.imageUrl || '';
                  const newAlt = json?.response?.alt || json.alt || 'Image Alt text';
                  if (newUrl && targetImg.isConnected) {
                    await recordImageRegenAsLocalAsset(targetImg, newUrl, newAlt);
                  }
                } catch (err) {
                  console.error('[auto-apply] image-generation failed', err);
                } finally {
                  pendingAutoApplyThreadIds.delete(thread.id);
                  autoApplyBtn.disabled = false;
                  autoApplyBtn.classList.remove('is-loading');
                }
              }
            }
          });
          if (statusControls) {
            statusControls.append(autoApplyBtn);
          } else {
            const controls = document.createElement('div');
            controls.className = 'annotation-panel-status-controls';
            controls.append(autoApplyBtn);
            cardHeader.append(controls);
          }
        }

        const hasPending = !!group.comment?.hasPendingHistory || !group.comment?.isCommitted;
        if (!isCommentThread && group.comment?.isCurrent && hasPending) {
          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'annotation-panel-cancel-btn';
          cancelBtn.title = 'Discard last local change';
          cancelBtn.setAttribute('aria-label', 'Discard last local change');
          cancelBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.0605 10L13.2803 7.78028C13.5733 7.48731 13.5733 7.0127 13.2803 6.71973C12.9873 6.42676 12.5127 6.42676 12.2197 6.71973L10 8.93946L7.78027 6.71973C7.4873 6.42676 7.01269 6.42676 6.71972 6.71973C6.42675 7.0127 6.42675 7.48731 6.71972 7.78028L8.93945 10L6.71972 12.2197C6.42675 12.5127 6.42675 12.9873 6.71972 13.2803C6.8662 13.4268 7.05761 13.5 7.24999 13.5C7.44237 13.5 7.63378 13.4268 7.78026 13.2803L9.99999 11.0606L12.2197 13.2803C12.3662 13.4268 12.5576 13.5 12.75 13.5C12.9424 13.5 13.1338 13.4268 13.2803 13.2803C13.5732 12.9873 13.5732 12.5127 13.2803 12.2197L11.0605 10Z" fill="currentColor"/><path d="M10 18.75C5.1748 18.75 1.25 14.8252 1.25 10C1.25 5.1748 5.1748 1.25 10 1.25C14.8252 1.25 18.75 5.1748 18.75 10C18.75 14.8252 14.8252 18.75 10 18.75ZM10 2.75C6.00195 2.75 2.75 6.00195 2.75 10C2.75 13.998 6.00195 17.25 10 17.25C13.998 17.25 17.25 13.998 17.25 10C17.25 6.00195 13.998 2.75 10 2.75Z" fill="currentColor"/></svg>';
          cancelBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            const result = store.undoLastChange(thread.id);
            if (!result) return;
            store.applyEasyEditsToDom();
            store.saveAnnotationStore();
            renderThreadMarkers({ resolveTargets: true });
            renderCommentsPanel();
          });
          card.append(cancelBtn);
        }

        card.append(cardHeader);

        // Discard renders only on the LAST metadata-block edit for this block
        // (true stack/LIFO semantics). Each metadata-block edit's toHtml is a
        // cumulative snapshot, so removing an older one would not undo only
        // that change — it would surface a still-cumulative later snapshot.
        if (isMetadataBlockEdit && thread.blockSelector) {
          const lastEditForBlock = store.getLastMetadataBlockEdit(thread.blockSelector);
          if (lastEditForBlock && lastEditForBlock.id === thread.id) {
            const discardBtn = document.createElement('button');
            discardBtn.type = 'button';
            discardBtn.className = 'annotation-panel-metadata-discard-btn';
            discardBtn.dataset.action = 'discard-metadata-edit';
            discardBtn.dataset.metadataEditId = thread.id;
            discardBtn.setAttribute('aria-label', 'Discard this metadata change');
            discardBtn.title = 'Discard this metadata change';
            discardBtn.textContent = 'Discard';
            card.append(discardBtn);
          }
        }

        const rootCommentKey = `${thread.id}::${group.comment.id || ''}`;
        const isEditingRootComment = canEditRootComment
          && isEditingComment(thread.id, group.comment.id || '');
        if (isEditingRootComment) {
          if (preservedEditForm && !preservedIsReply && preservedEditKey === rootCommentKey) {
            card.append(preservedEditForm);
            preservedEditForm = null;
            didReuseEditForm = true;
          } else {
            const editForm = createCommentEditForm(
              thread.id,
              group.comment.id || '',
              activeCommentEditor?.draft || '',
            );
            card.append(editForm);
          }
        } else {
          const text = document.createElement('p');
          text.className = 'annotation-panel-comment-text';
          const blockClass = !isCommentThread ? (thread.elementProps?.blockClass || '') : '';
          if (blockClass) {
            const blockLabel = document.createElement('span');
            blockLabel.className = 'annotation-panel-block-label annotation-panel-block-label-edit';
            blockLabel.textContent = blockClass;
            text.append(blockLabel);
          }
          const textBody = document.createElement('span');
          const linkified = linkifyText(group.comment.text);
          textBody.innerHTML = isCommentThread
            ? linkified
            : linkified.replace(/→/g, ARROW_ICON_SVG);
          text.append(textBody);
          card.append(text);
        }

        const repliesWrap = document.createElement('div');
        repliesWrap.className = 'annotation-panel-replies-list';
        group.replies.forEach((reply) => {
          const replyRow = document.createElement('div');
          replyRow.className = 'annotation-panel-reply-row';

          const replyKey = `${thread.id}::${reply.id || ''}`;
          const canEditReply = isCommentThread
            && !isClosedThread
            && isCommentEditableByCurrentUser(thread, reply);
          const isEditingReply = canEditReply && isEditingComment(thread.id, reply.id || '');
          if (isEditingReply) {
            if (preservedEditForm && preservedIsReply && preservedEditKey === replyKey) {
              replyRow.append(preservedEditForm);
              preservedEditForm = null;
              didReuseEditForm = true;
            } else {
              const editForm = createCommentEditForm(
                thread.id,
                reply.id || '',
                activeCommentEditor?.draft || '',
                true,
              );
              replyRow.append(editForm);
            }
          } else {
            const replyContent = document.createElement('div');
            replyContent.className = 'annotation-panel-reply-content';
            const replyUsername = document.createElement('p');
            replyUsername.className = 'annotation-panel-reply-user';
            replyUsername.textContent = reply.username || ANNOTATION_DEFAULT_USERNAME;
            const replyText = document.createElement('p');
            replyText.className = 'annotation-panel-reply-text';
            replyText.innerHTML = linkifyText(reply.text);
            replyContent.append(replyUsername, replyText);
            replyRow.append(replyContent);
          }

          if (isCommentThread && canEditReply && !isEditingReply) {
            const replyEditBtn = document.createElement('button');
            replyEditBtn.type = 'button';
            replyEditBtn.className = 'annotation-panel-edit-btn annotation-panel-edit-btn-reply';
            replyEditBtn.dataset.action = 'edit-comment';
            replyEditBtn.dataset.threadId = thread.id;
            replyEditBtn.dataset.commentId = reply.id || '';
            replyEditBtn.setAttribute('aria-label', ANNOTATION_MESSAGES.editCommentAriaLabel);
            replyEditBtn.innerHTML = `
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 17.25V21h3.75L19.81 7.94l-3.75-3.75z"></path>
              </svg>
            `;
            replyRow.append(replyEditBtn);
          }
          repliesWrap.appendChild(replyRow);
        });

        card.append(repliesWrap);

        if (isCommentThread && !isClosedThread) {
          const composerKey = `${thread.id}::${group.comment.id || ''}`;
          if (preservedComposer && preservedComposerKey === composerKey) {
            card.append(preservedComposer);
            preservedComposer = null;
            didReuseComposer = true;
          } else {
            const replyFieldId = `annotation-panel-reply-input-${thread.id}-${group.comment.id || 'root'}`;
            const replyComposer = document.createElement('div');
            replyComposer.className = 'annotation-panel-reply-composer';
            replyComposer.innerHTML = `
              <input type="text" id="${replyFieldId}" name="${replyFieldId}" class="annotation-panel-reply-input" data-thread-id="${thread.id}" data-comment-id="${group.comment.id || ''}" placeholder="Reply..." />
              <button type="button" class="annotation-panel-reply-btn" data-thread-id="${thread.id}" data-comment-id="${group.comment.id || ''}" aria-label="Send reply">
                <span aria-hidden="true">➤</span>
              </button>
            `;
            const replyInput = replyComposer.querySelector('.annotation-panel-reply-input');
            if (replyInput instanceof HTMLInputElement) {
              replyInput.value = getPanelReplyDraft(thread.id, group.comment.id || '');
            }
            card.append(replyComposer);
          }
        }

        if (!isCommentThread) {
          const timestamp = formatCardTimestamp(group.comment.createdAt || thread.updatedAt);
          if (timestamp) {
            const time = document.createElement('p');
            time.className = 'annotation-card-timestamp';
            time.textContent = timestamp;
            card.append(time);
          }
        }

        annotationUI.panelListEl.appendChild(card);
      });
    };

    unifiedItems.forEach((item) => {
      if (item.kind === 'comment') {
        renderThreadItem(item.thread, true);
      } else if (item.kind === 'edit') {
        renderThreadItem(item.thread, false);
      } else if (assetsPanel && item.kind === 'asset-edit') {
        assetsPanel.buildAssetEditStepCards(item.edit)
          .forEach((card) => annotationUI.panelListEl.appendChild(card));
      }
    });

    if (scrollContainer) scrollContainer.scrollTop = savedScrollTop;
    syncPendingPanelStates();

    if (didReuseComposer && preservedComposerKey) {
      const [tid, cid] = preservedComposerKey.split('::');
      const input = annotationUI.panelListEl.querySelector(
        `.annotation-panel-reply-input[data-thread-id="${tid}"][data-comment-id="${cid}"]`,
      );
      if (input instanceof HTMLInputElement) {
        window.requestAnimationFrame(() => {
          input.focus();
          input.setSelectionRange(preservedSelStart, preservedSelEnd);
        });
      }
    }

    if (didReuseEditForm && preservedEditKey) {
      const [tid, cid] = preservedEditKey.split('::');
      const textarea = annotationUI.panelListEl.querySelector(
        `.annotation-panel-edit-input[data-thread-id="${tid}"][data-comment-id="${cid}"]`,
      );
      if (textarea instanceof HTMLTextAreaElement) {
        window.requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(preservedSelStart, preservedSelEnd);
        });
      }
    }
    finalizeFragmentHints();
    enforceThreadStatusSelectOptions(annotationUI.panelEl);
  };

  function getCommentsScrollContainer() {
    if (!annotationUI.panelEl) return null;
    return annotationUI.panelEl.querySelector('.annotation-comments-content');
  }

  function scrollAssetInPanel(elementPath) {
    if (!annotationUI.panelEl || !annotationUI.panelListEl || !elementPath) return;

    if (activePanelFilter === 'comment' || activePanelFilter === 'edit') {
      activePanelFilter = 'asset';
      annotationUI.panelEl.querySelectorAll('.annotation-panel-filter-tab').forEach((btn) => {
        const isActive = btn.dataset.filter === activePanelFilter;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', `${isActive}`);
      });
    }

    renderCommentsPanel();

    const runScroll = () => {
      const scrollContainer = getCommentsScrollContainer();

      // Collect all assets for this elementPath and sort newest first
      const candidates = [];
      (annotationState.store.localAssets || []).forEach((asset) => {
        if (asset.elementPath === elementPath) {
          candidates.push({
            selector: `[data-local-asset-id="${asset.localId}"]`,
            ts: assetsPanel ? assetsPanel.getAssetTimestamp(asset) : 0,
          });
        }
      });
      (annotationState.store.assets || []).forEach((asset) => {
        if (asset.elementPath === elementPath) {
          candidates.push({
            selector: `[data-asset-id="${asset.id}"]`,
            ts: assetsPanel ? assetsPanel.getAssetTimestamp(asset) : 0,
          });
        }
      });
      candidates.sort((a, b) => (b.ts || 0) - (a.ts || 0));

      const target = candidates.reduce((found, candidate) => {
        if (found) return found;
        const card = annotationUI.panelListEl.querySelector(candidate.selector);
        return card instanceof HTMLElement ? card : null;
      }, null);

      if (!(target instanceof HTMLElement) || !scrollContainer) return;

      const targetTop = target.offsetTop + annotationUI.panelListEl.offsetTop - 16;
      scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });

      annotationUI.panelListEl.querySelectorAll('.annotation-panel-comment-focus')
        .forEach((el) => el.classList.remove('annotation-panel-comment-focus'));
      target.classList.add('annotation-panel-comment-focus');
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      window.setTimeout(() => { target.classList.remove('annotation-panel-comment-focus'); }, 1200);
    };

    window.requestAnimationFrame(runScroll);
    window.setTimeout(runScroll, 60);
  }

  function scrollThreadInPanel(threadId, messageId = '', commentIndex = 0) {
    if (!annotationUI.panelEl || !annotationUI.panelListEl || !threadId) return;
    const thread = store.getThreadById(threadId);
    if (!thread) return;

    const firstCommentId = buildCommentGroups(thread)[0]?.comment?.id || '';
    annotationState.activeThreadId = threadId;
    annotationState.activeMessageId = messageId || firstCommentId;
    annotationState.activeEditId = '';
    renderCommentsPanel();

    const runScroll = () => {
      const scrollContainer = getCommentsScrollContainer();
      let target = null;
      if (annotationState.activeMessageId) {
        target = annotationUI.panelListEl.querySelector(`[data-message-id="${annotationState.activeMessageId}"]`);
      }
      if (!(target instanceof HTMLElement)) {
        const sameThreadCards = annotationUI.panelListEl.querySelectorAll(`[data-thread-id="${threadId}"]`);
        target = sameThreadCards[commentIndex] || sameThreadCards[0] || null;
      }
      if (!(target instanceof HTMLElement) || !scrollContainer) return;

      const targetTop = target.offsetTop + annotationUI.panelListEl.offsetTop - 16;
      scrollContainer.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      });

      annotationUI.panelListEl.querySelectorAll('.annotation-panel-comment-focus')
        .forEach((el) => el.classList.remove('annotation-panel-comment-focus'));
      target.classList.add('annotation-panel-comment-focus');
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      window.setTimeout(() => {
        target.classList.remove('annotation-panel-comment-focus');
      }, 1200);
    };

    window.requestAnimationFrame(runScroll);
    window.setTimeout(runScroll, 60);
  }

  function clearMarkers() {
    if (!annotationUI.layerEl) return;
    annotationUI.layerEl.querySelectorAll('.annotation-thread-marker, .annotation-edit-marker, .annotation-asset-marker')
      .forEach((marker) => marker.remove());
  }

  function clearThreadTargetCache() {
    if (!(annotationState.threadTargetCache instanceof Map)) {
      annotationState.threadTargetCache = new Map();
      return;
    }
    annotationState.threadTargetCache.clear();
  }

  function resolveThreadTargets() {
    clearThreadTargetCache();
    annotationState.store.threads.forEach((thread) => {
      if (!thread?.id) return;
      annotationState.threadTargetCache.set(thread.id, store.getElementForThread(thread));
    });
  }

  function getCachedThreadTarget(thread) {
    if (!thread?.id) return null;
    if (!(annotationState.threadTargetCache instanceof Map)) {
      annotationState.threadTargetCache = new Map();
    }

    const cachedTarget = annotationState.threadTargetCache.get(thread.id);
    if (
      cachedTarget instanceof HTMLElement
      && annotationUI.mainEl?.contains(cachedTarget)
    ) {
      return cachedTarget;
    }

    const resolvedTarget = store.getElementForThread(thread);
    annotationState.threadTargetCache.set(thread.id, resolvedTarget);
    return resolvedTarget;
  }

  function scrollCommentsPanelToBottom() {
    const scrollContainer = getCommentsScrollContainer();
    if (!scrollContainer) return;
    window.requestAnimationFrame(() => {
      scrollContainer.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    });
  }

  function renderThreadMarkers({ resolveTargets = false } = {}) {
    if (!annotationUI.layerEl || !annotationUI.mainEl) return;
    if (resolveTargets) resolveThreadTargets();
    const occupiedMarkerSlots = new Set();
    const MARKER_STEP = 28;
    const MIN_MARKER_LEFT = 8;

    annotationUI.mainEl.querySelectorAll('[data-annotation-count]').forEach((el) => {
      el.classList.remove('annotation-has-comments');
      el.removeAttribute('data-annotation-count');
    });
    clearMarkers();

    const resolveMarkerPosition = (baseTop, baseLeft) => {
      const row = Math.max(0, Math.round(baseTop));
      let nextLeft = Math.max(MIN_MARKER_LEFT, Math.round(baseLeft));
      let slotKey = `${row}:${nextLeft}`;
      while (occupiedMarkerSlots.has(slotKey) && nextLeft > MIN_MARKER_LEFT) {
        nextLeft = Math.max(MIN_MARKER_LEFT, nextLeft - MARKER_STEP);
        slotKey = `${row}:${nextLeft}`;
      }
      occupiedMarkerSlots.add(slotKey);
      return {
        top: row,
        left: nextLeft,
      };
    };

    annotationState.store.threads
      .filter((thread) => store.getThreadType(thread) === 'comment')
      .forEach((thread) => {
        const targetEl = getCachedThreadTarget(thread);
        if (!targetEl) return;

        targetEl.classList.add('annotation-has-comments');
        targetEl.setAttribute(
          'data-annotation-count',
          String((thread.messages || []).length || 1),
        );

        const rect = targetEl.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;

        const groups = buildCommentGroups(thread);
        groups.forEach((group, idx) => {
          const marker = document.createElement('button');
          marker.type = 'button';
          marker.className = 'annotation-thread-marker';
          marker.dataset.threadId = thread.id;
          marker.dataset.messageId = group.comment.id || '';
          marker.dataset.commentIndex = String(idx);
          marker.title = `Comment ${idx + 1}`;
          marker.setAttribute('aria-label', `Open comment ${idx + 1}`);
          marker.innerHTML = `
            <svg class="annotation-thread-marker-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 4h16v11H7l-3 3z"></path>
            </svg>
          `;

          const position = resolveMarkerPosition(
            rect.top - 8,
            rect.right - 8 - (idx * MARKER_STEP),
          );
          marker.style.top = `${position.top}px`;
          marker.style.left = `${position.left}px`;
          annotationUI.layerEl.appendChild(marker);
        });
      });

    annotationState.store.threads
      .filter((thread) => store.getThreadType(thread) === 'edit')
      .forEach((thread) => {
        const targetEl = getCachedThreadTarget(thread);
        if (!targetEl) return;

        const rect = targetEl.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;

        const groups = buildCommentGroups(thread);
        groups.forEach((group, idx) => {
          const marker = document.createElement('button');
          marker.type = 'button';
          marker.className = 'annotation-edit-marker';
          marker.dataset.threadId = thread.id;
          marker.dataset.messageId = group.comment.id || '';
          marker.dataset.commentIndex = String(idx);
          marker.title = `Edit ${idx + 1}`;
          marker.setAttribute('aria-label', `Open edit ${idx + 1}`);
          marker.innerHTML = `
            <svg class="annotation-edit-marker-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 17.25V21h3.75L19.81 7.94l-3.75-3.75z"></path>
            </svg>
          `;

          const position = resolveMarkerPosition(
            rect.top - 8,
            rect.right - 8 - (idx * MARKER_STEP),
          );
          marker.style.top = `${position.top}px`;
          marker.style.left = `${position.left}px`;
          annotationUI.layerEl.appendChild(marker);
        });
      });

    if (assetsPanel) {
      const assetsByPath = new Map();
      (annotationState.store.assets || []).forEach((asset) => {
        if (asset?.elementPath) assetsByPath.set(asset.elementPath, asset);
      });
      (annotationState.store.localAssets || []).forEach((asset) => {
        if (asset?.elementPath) assetsByPath.set(asset.elementPath, asset);
      });

      [...assetsByPath.values()].forEach((asset) => {
        const el = annotationUI.mainEl.querySelector(asset.elementPath);
        if (!el) return;
        const targetImg = el.tagName === 'IMG' ? el : el.querySelector('img');
        const targetEl = targetImg || el;
        const rect = targetEl.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;

        const position = resolveMarkerPosition(rect.top - 8, rect.right - 8);
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = 'annotation-asset-marker';
        marker.dataset.assetId = `${asset.id || asset.localId || ''}`;
        marker.dataset.elementPath = asset.elementPath;
        marker.title = `Asset: ${asset.filename || 'image'}`;
        marker.setAttribute('aria-label', `Asset replacement: ${asset.filename || 'image'}`);
        marker.innerHTML = `
          <svg class="annotation-asset-marker-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"></path>
          </svg>
        `;
        marker.style.top = `${position.top}px`;
        marker.style.left = `${position.left}px`;
        annotationUI.layerEl.appendChild(marker);
      });
    }
  }

  function setPopupSubmitPending(isPending) {
    popupSubmitPending = isPending;

    if (!(annotationUI.popupEl instanceof HTMLElement)) return;

    annotationUI.popupEl.classList.toggle('is-submitting', isPending);
    annotationUI.popupEl.setAttribute('aria-busy', `${isPending}`);

    const input = annotationUI.popupEl.querySelector('.annotation-reply-input');
    const sendBtn = annotationUI.popupEl.querySelector('.annotation-reply-btn');
    const closeBtn = annotationUI.popupEl.querySelector('.annotation-popup-close');

    if (input instanceof HTMLTextAreaElement) {
      input.readOnly = isPending;
    }
    if (sendBtn instanceof HTMLButtonElement) {
      sendBtn.disabled = isPending;
    }
    if (closeBtn instanceof HTMLButtonElement) {
      closeBtn.disabled = isPending;
    }
  }

  async function submitPanelReply(threadId, commentId, rawValue) {
    if (!isCommentsServiceAvailable()) {
      showGlobalSnackbar(ANNOTATION_MESSAGES.commentsUnavailableSnackbar);
      return;
    }
    const composerKey = getReplyComposerKey(threadId, commentId);
    if (pendingReplyComposerKeys.has(composerKey)) return;

    const value = (rawValue || '').trim();
    if (!value) return;
    const thread = store.getThreadById(threadId);
    if (!thread) return;
    if (isThreadClosed(thread)) {
      showGlobalSnackbar(ANNOTATION_MESSAGES.closedThreadRestricted);
      return;
    }
    let activeThread = thread;
    let didPersistToService = false;
    let didHydrateThread = false;

    setPanelReplyPending(threadId, commentId, true);
    try {
      const result = await annotationService.createReply(threadId, value);
      if (result?.persisted) {
        didPersistToService = true;
      }
      if (result?.thread) {
        store.upsertThread(result.thread);
        activeThread = store.getThreadById(result.thread.id) || thread;
        didHydrateThread = true;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Could not save reply to service', error);
    }

    if (!didPersistToService) {
      showGlobalSnackbar(ANNOTATION_MESSAGES.sendReplyError);
      setPanelReplyPending(threadId, commentId, false);
      return;
    }

    if (!didHydrateThread) {
      store.pushThreadMessage(activeThread, value, 'reply');
    }

    hideGlobalSnackbar();
    annotationState.activeThreadId = activeThread.id;
    annotationState.activeMessageId = commentId || getRootComment(activeThread)?.id || '';
    resetPanelReplyComposer(threadId, commentId);
    setPanelReplyPending(threadId, commentId, false);
    if (didHydrateThread) {
      store.saveAnnotationStore();
      renderThreadMarkers({ resolveTargets: true });
      renderCommentsPanel();
      scrollCommentsPanelToBottom();
    } else {
      store.saveAnnotationStore();
      renderCommentsPanel();
    }
    requestParentCollabRefresh('reply-created');
  }

  function removePopup() {
    popupSubmitPending = false;
    if (!annotationUI.popupEl) return;
    annotationUI.popupEl.remove();
    annotationUI.popupEl = null;
  }

  function closePopupAndSelection() {
    clearPopupDraft();
    store.clearSelectedElement();
    removePopup();
  }

  async function submitCommentEdit(threadId, commentId, rawValue) {
    if (!isCommentsServiceAvailable()) {
      showGlobalSnackbar(ANNOTATION_MESSAGES.commentsUnavailableSnackbar);
      return;
    }
    const editKey = getCommentEditorKey(threadId, commentId);
    if (pendingCommentEditIds.has(editKey)) return;

    const thread = store.getThreadById(threadId);
    if (!thread) return;
    const message = thread.messages?.find((item) => item.id === commentId);
    if (isThreadClosed(thread)) {
      showGlobalSnackbar(ANNOTATION_MESSAGES.closedThreadRestricted);
      return;
    }
    if (!message || !isCommentEditableByCurrentUser(thread, message)) return;

    const nextValue = `${rawValue || ''}`.trim();
    const previousValue = `${message.text || ''}`.trim();
    if (!nextValue || nextValue === previousValue) {
      closeCommentEditor();
      renderCommentsPanel();
      return;
    }

    setCommentEditPending(threadId, commentId, true);
    try {
      const result = await annotationService.updateComment(commentId, nextValue, threadId);
      if (!result?.persisted) throw new Error('Comment update failed');
      if (result.thread) {
        store.upsertThread(result.thread);
      } else {
        message.text = nextValue;
      }
      hideGlobalSnackbar();
      closeCommentEditor();
      annotationState.activeThreadId = threadId;
      annotationState.activeMessageId = commentId;
      store.saveAnnotationStore();
      renderThreadMarkers({ resolveTargets: true });
      renderCommentsPanel();
      scrollThreadInPanel(threadId, commentId);
      requestParentCollabRefresh('comment-updated');
    } catch (error) {
      showGlobalSnackbar(ANNOTATION_MESSAGES.saveCommentError);
      // eslint-disable-next-line no-console
      console.warn('Could not update comment in service', error);
      setCommentEditPending(threadId, commentId, false);
      return;
    }

    setCommentEditPending(threadId, commentId, false);
  }

  async function submitPopupMessage() {
    if (!isCommentsServiceAvailable()) {
      showGlobalSnackbar(ANNOTATION_MESSAGES.commentsUnavailableSnackbar);
      return;
    }
    if (popupSubmitPending) return;
    if (
      !annotationUI.popupEl
      || !annotationState.selectedElement
      || !annotationState.selectedElementPath
    ) return;
    const input = annotationUI.popupEl.querySelector('.annotation-reply-input');
    if (!(input instanceof HTMLTextAreaElement)) return;

    const value = input.value.trim();
    if (!value) return;

    let didPersistToService = false;
    let thread = null;
    setPopupSubmitPending(true);
    try {
      const remoteThread = await annotationService.createThread({
        elementPath: annotationState.selectedElementPath,
        body: value,
        quotedText: annotationState.selectedElement.textContent?.trim() || null,
      });
      if (remoteThread) {
        store.upsertThread(remoteThread);
        thread = store.getThreadById(remoteThread.id);
        didPersistToService = true;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Could not save comment thread to service', error);
    }

    if (!didPersistToService || !thread) {
      showGlobalSnackbar(ANNOTATION_MESSAGES.postCommentError);
      setPopupSubmitPending(false);
      return;
    }

    hideGlobalSnackbar();
    const latest = thread.messages[thread.messages.length - 1];
    annotationState.activeMessageId = getRootComment(thread)?.id || latest?.id || '';
    annotationState.activeThreadId = thread.id;
    setPopupSubmitPending(false);
    closePopupAndSelection();
    store.saveAnnotationStore();
    renderThreadMarkers({ resolveTargets: true });
    renderCommentsPanel();
    scrollCommentsPanelToBottom();
    requestParentCollabRefresh('comment-created');
  }

  function attachPopupEvents() {
    if (!annotationUI.popupEl) return;
    const input = annotationUI.popupEl.querySelector('.annotation-reply-input');
    const sendBtn = annotationUI.popupEl.querySelector('.annotation-reply-btn');

    if (sendBtn) {
      sendBtn.addEventListener('click', (event) => {
        event.preventDefault();
        submitPopupMessage();
      });
    }

    if (input) {
      input.addEventListener('input', (event) => {
        const { target } = event;
        if (!(target instanceof HTMLTextAreaElement)) return;
        updatePopupDraft(target.value);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        submitPopupMessage();
      });
    }
  }

  function positionPopup(anchorElement) {
    if (!annotationUI.popupEl) return;
    const panelRect = annotationUI.panelEl?.getBoundingClientRect();
    const maxPopupRight = panelRect ? Math.max(24, panelRect.left - 12) : window.innerWidth - 12;
    const maxPopupWidth = Math.max(220, maxPopupRight - 24);
    annotationUI.popupEl.style.maxWidth = `${maxPopupWidth}px`;

    const rect = anchorElement.getBoundingClientRect();
    const popupWidth = Math.min(annotationUI.popupEl.offsetWidth || 320, maxPopupWidth);
    const popupHeight = annotationUI.popupEl.offsetHeight || 260;

    let left = rect.right + 12;
    if (left + popupWidth > maxPopupRight) {
      left = rect.left - popupWidth - 12;
    }
    left = Math.max(12, Math.min(left, maxPopupRight - popupWidth));

    let { top } = rect;
    top = Math.max(12, Math.min(top, window.innerHeight - popupHeight - 12));

    annotationUI.popupEl.style.left = `${left}px`;
    annotationUI.popupEl.style.top = `${top}px`;
  }

  function preparePopupDraftForElement(element) {
    if (annotationState.selectedElement && annotationState.selectedElement !== element) {
      const popupInput = annotationUI.popupEl?.querySelector('.annotation-reply-input');
      if (popupInput instanceof HTMLTextAreaElement) {
        popupInput.value = '';
      }
      clearPopupDraft();
    }
    return store.buildCommentElementPath(element, annotationUI.mainEl);
  }

  function openPopupForElement(element, shouldScroll = false) {
    if (popupSubmitPending) return;
    if (!annotationUI.layerEl) return;
    const nextElementPath = preparePopupDraftForElement(element);
    setSelectedElement(element);
    syncPopupDraftScope(nextElementPath);
    const thread = store.getCommentThreadByElement(annotationState.selectedElement);
    if (thread && isThreadClosed(thread)) {
      store.clearSelectedElement();
      removePopup();
      showGlobalSnackbar(ANNOTATION_MESSAGES.closedThreadRestricted);
      return;
    }
    annotationState.activeThreadId = thread?.id || '';
    annotationState.activeMessageId = '';
    renderCommentsPanel();
    if (shouldScroll) {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    removePopup();
    const popup = document.createElement('section');
    popup.className = 'annotation-floating-popup';
    popup.dataset.threadId = thread?.id || '';

    const header = document.createElement('div');
    header.className = 'annotation-popup-header';

    const title = document.createElement('h3');
    title.className = 'annotation-popup-title';
    title.textContent = 'Comment';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'annotation-popup-close';
    closeBtn.setAttribute('aria-label', 'Close comment');
    closeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6L18 18M18 6L6 18"></path>
      </svg>
    `;

    const rightControls = document.createElement('div');
    rightControls.className = 'annotation-popup-header-controls';
    rightControls.append(closeBtn);
    header.append(title, rightControls);

    const composer = document.createElement('div');
    composer.className = 'annotation-reply-composer';
    const popupFieldId = `annotation-popup-input-${thread?.id || 'new'}`;
    composer.innerHTML = `
      <textarea id="${popupFieldId}" name="${popupFieldId}" class="annotation-reply-input" placeholder="Write a comment..."></textarea>
      <button type="button" class="annotation-reply-btn" aria-label="Send comment">
        <span aria-hidden="true">➤</span>
      </button>
    `;

    popup.append(header, composer);
    annotationUI.layerEl.appendChild(popup);
    annotationUI.popupEl = popup;
    positionPopup(element);
    attachPopupEvents();

    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      closePopupAndSelection();
    });

    const input = popup.querySelector('.annotation-reply-input');
    if (input instanceof HTMLTextAreaElement) {
      input.value = popupDraft;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function syncFloatingUI() {
    if (!annotationUI.mainEl) return;
    renderThreadMarkers();
    if (annotationUI.popupEl && annotationState.selectedElement) {
      positionPopup(annotationState.selectedElement);
    }
  }

  function scheduleFloatingUISync() {
    if (annotationState.floatingUiFrameId) return;
    annotationState.floatingUiFrameId = window.requestAnimationFrame(() => {
      annotationState.floatingUiFrameId = null;
      syncFloatingUI();
    });
  }

  function teardownGlobalListeners(options = {}) {
    const {
      preserveRemoteEditState = false,
    } = options;
    hideGlobalSnackbar();
    closeCommentEditor();
    assetsPanel.exitSelectMode();
    pendingCommentsPanelRefresh = false;
    if (!preserveRemoteEditState) {
      clearSelfSavedEditsFingerprint();
      annotationState.pendingRemoteEditsSnapshot = null;
      annotationState.hasLoadedInitialEditsSnapshot = false;
    }
    panelReplyDrafts.clear();
    popupDraft = '';
    popupDraftKey = '';
    if (annotationState.floatingUiFrameId) {
      window.cancelAnimationFrame(annotationState.floatingUiFrameId);
      annotationState.floatingUiFrameId = null;
    }
    if (annotationUI.mainEl && annotationState.mainScrollHandler) {
      annotationUI.mainEl.removeEventListener('scroll', annotationState.mainScrollHandler);
      annotationState.mainScrollHandler = null;
    }
    if (annotationUI.mainEl && annotationState.mainClickHandler) {
      annotationUI.mainEl.removeEventListener('click', annotationState.mainClickHandler, true);
      annotationState.mainClickHandler = null;
    }
    if (annotationUI.layerEl && annotationState.layerClickHandler) {
      annotationUI.layerEl.removeEventListener('click', annotationState.layerClickHandler);
      annotationState.layerClickHandler = null;
    }
    if (annotationUI.panelEl && annotationState.panelClickHandler) {
      annotationUI.panelEl.removeEventListener('click', annotationState.panelClickHandler);
      annotationState.panelClickHandler = null;
    }
    if (annotationUI.canvasRefreshBarEl && annotationState.canvasRefreshBarClickHandler) {
      const refreshButton = annotationUI.canvasRefreshBarEl.querySelector('.annotation-canvas-refresh-btn');
      if (refreshButton instanceof HTMLButtonElement) {
        refreshButton.removeEventListener('click', annotationState.canvasRefreshBarClickHandler);
      }
      annotationState.canvasRefreshBarClickHandler = null;
    }
    if (annotationUI.canvasRefreshBarEl) {
      annotationUI.canvasRefreshBarEl.remove();
      annotationUI.canvasRefreshBarEl = null;
    }
    if (annotationUI.panelEl && annotationState.panelInputHandler) {
      annotationUI.panelEl.removeEventListener('input', annotationState.panelInputHandler);
      annotationState.panelInputHandler = null;
    }
    if (annotationUI.panelEl && annotationState.panelKeydownHandler) {
      annotationUI.panelEl.removeEventListener('keydown', annotationState.panelKeydownHandler);
      annotationState.panelKeydownHandler = null;
    }
    if (annotationUI.panelEl && annotationState.panelFocusoutHandler) {
      annotationUI.panelEl.removeEventListener('focusout', annotationState.panelFocusoutHandler);
      annotationState.panelFocusoutHandler = null;
    }
    if (annotationUI.panelEl && annotationState.panelChangeHandler) {
      annotationUI.panelEl.removeEventListener('change', annotationState.panelChangeHandler);
      annotationState.panelChangeHandler = null;
    }
    if (annotationUI.inlineToggleEl && annotationState.inlineToggleClickHandler) {
      annotationUI.inlineToggleEl.removeEventListener(
        'click',
        annotationState.inlineToggleClickHandler,
      );
      annotationState.inlineToggleClickHandler = null;
    }
    if (annotationUI.inlineAssetsToggleEl && annotationState.inlineAssetsToggleClickHandler) {
      annotationUI.inlineAssetsToggleEl.removeEventListener(
        'click',
        annotationState.inlineAssetsToggleClickHandler,
      );
      annotationState.inlineAssetsToggleClickHandler = null;
    }
    if (annotationState.documentClickHandler) {
      document.removeEventListener('click', annotationState.documentClickHandler);
      annotationState.documentClickHandler = null;
    }
    if (annotationState.windowResizeHandler) {
      window.removeEventListener('resize', annotationState.windowResizeHandler);
      annotationState.windowResizeHandler = null;
    }
  }

  async function setupAnnotationUI(mainEl, options = {}) {
    const {
      preserveRemoteEditState = false,
    } = options;
    teardownGlobalListeners({ preserveRemoteEditState });
    annotationUI.mainEl = mainEl;
    ensureFloatingLayer();
    ensureCommentsPanel();
    ensureCanvasRefreshBar();
    store.loadAnnotationStore();
    store.rebindThreadsToCurrentDom();
    store.saveAnnotationStore();
    renderThreadMarkers({ resolveTargets: true });
    renderCommentsPanel();

    annotationState.mainClickHandler = (event) => {
      if (!isCommentsViewActive()) return;
      if (!isCommentsServiceAvailable()) return;
      if (popupSubmitPending) return;
      const { target } = event;
      if (!(target instanceof HTMLElement)) return;
      if (target === mainEl) return;
      if (target.closest('a')) event.preventDefault();
      event.stopPropagation();
      openPopupForElement(target);
    };
    mainEl.addEventListener('click', annotationState.mainClickHandler, true);

    annotationState.layerClickHandler = (event) => {
      const { target } = event;
      if (!(target instanceof Element)) return;
      const assetMarker = target.closest('.annotation-asset-marker');
      if (assetMarker instanceof HTMLButtonElement) {
        scrollAssetInPanel(assetMarker.dataset.elementPath || '');
        return;
      }
      const editMarker = target.closest('.annotation-edit-marker');
      if (editMarker instanceof HTMLButtonElement) {
        scrollThreadInPanel(
          editMarker.dataset.threadId,
          editMarker.dataset.messageId,
          Number.parseInt(editMarker.dataset.commentIndex || '0', 10),
        );
        return;
      }
      const marker = target.closest('.annotation-thread-marker');
      if (!(marker instanceof HTMLButtonElement)) return;
      scrollThreadInPanel(
        marker.dataset.threadId,
        marker.dataset.messageId,
        Number.parseInt(marker.dataset.commentIndex || '0', 10),
      );
    };
    annotationUI.layerEl.addEventListener('click', annotationState.layerClickHandler);

    annotationState.panelClickHandler = async (event) => {
      const { target } = event;
      if (!(target instanceof Element)) return;
      if (target.closest('.annotation-mode-toolbar')) return;
      if (!isCommentsServiceAvailable()) return;
      const card = target.closest('.annotation-panel-comment');

      if (card instanceof HTMLElement && card.classList.contains('annotation-panel-asset-item')) {
        if (target.closest('.annotation-asset-actions')) return;
        let elementPath = null;
        const { localAssetId, assetId } = card.dataset;
        if (localAssetId) {
          const local = (annotationState.store.localAssets || []).find((a) => a.localId === localAssetId);
          if (local?.targetImg instanceof HTMLElement) {
            local.targetImg.scrollIntoView({ block: 'center', behavior: 'smooth' });
            return;
          }
          elementPath = local?.elementPath || null;
        } else if (assetId) {
          const asset = (annotationState.store.assets || []).find((a) => String(a.id) === String(assetId));
          elementPath = asset?.elementPath || null;
        }
        if (elementPath && annotationUI.mainEl) {
          const el = annotationUI.mainEl.querySelector(elementPath);
          if (el instanceof HTMLElement) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        return;
      }

      const discardMetadataBtn = target.closest('.annotation-panel-metadata-discard-btn');
      if (discardMetadataBtn instanceof HTMLButtonElement) {
        const editId = discardMetadataBtn.dataset.metadataEditId;
        if (editId && metadataPanel?.discardMetadataEdit) {
          metadataPanel.discardMetadataEdit(editId);
          renderThreadMarkers({ resolveTargets: true });
          renderCommentsPanel();
        }
        return;
      }

      if (card instanceof HTMLElement && card.classList.contains('annotation-panel-edit-item')) {
        const thread = store.getThreadById(card.dataset.threadId);
        if (!thread) return;
        // Metadata-block edits aren't anchored to a single element — scroll to
        // the metadata block itself.
        if (thread.editType === 'metadata-block') {
          let blockEl = null;
          try {
            blockEl = thread.blockSelector
              ? document.querySelector(thread.blockSelector)
              : null;
          } catch (error) {
            blockEl = null;
          }
          if (blockEl instanceof HTMLElement) {
            blockEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        } else {
          const targetEl = store.getElementForThread(thread);
          if (targetEl) targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        annotationState.activeThreadId = thread.id;
        annotationState.activeMessageId = card.dataset.messageId || '';
        renderCommentsPanel();
        return;
      }

      if (target.closest('.annotation-panel-attach-btn')) {
        const attachBtn = target.closest('.annotation-panel-attach-btn');
        if (!(attachBtn instanceof HTMLButtonElement)) return;
        const { threadId } = attachBtn.dataset;
        if (!threadId) return;
        showAttachAssetDropdown(attachBtn, threadId);
        return;
      }

      if (target.closest('.annotation-panel-reply-btn')) {
        const replyBtn = target.closest('.annotation-panel-reply-btn');
        if (!(replyBtn instanceof HTMLButtonElement)) return;
        const { threadId, commentId } = replyBtn.dataset;
        if (!threadId) return;
        const thread = store.getThreadById(threadId);
        if (isThreadClosed(thread)) {
          showGlobalSnackbar(ANNOTATION_MESSAGES.closedThreadRestricted);
          return;
        }
        const input = annotationUI.panelEl.querySelector(
          `.annotation-panel-reply-input[data-thread-id="${threadId}"][data-comment-id="${commentId}"]`,
        );
        if (!(input instanceof HTMLInputElement)) return;
        submitPanelReply(threadId, commentId, input.value);
        return;
      }

      if (target.closest('.annotation-panel-edit-save-btn')) {
        const saveBtn = target.closest('.annotation-panel-edit-save-btn');
        if (!(saveBtn instanceof HTMLButtonElement)) return;
        const { threadId, commentId } = saveBtn.dataset;
        if (!threadId || !commentId) return;
        const input = annotationUI.panelEl.querySelector(
          `.annotation-panel-edit-input[data-thread-id="${threadId}"][data-comment-id="${commentId}"]`,
        );
        if (!(input instanceof HTMLTextAreaElement)) return;
        submitCommentEdit(threadId, commentId, input.value);
        return;
      }

      if (target.closest('.annotation-panel-edit-cancel-btn')) {
        closeCommentEditor();
        renderCommentsPanel();
        return;
      }

      if (target.closest('.annotation-panel-edit-btn')) {
        const editBtn = target.closest('.annotation-panel-edit-btn');
        if (!(editBtn instanceof HTMLButtonElement)) return;
        const { threadId, commentId } = editBtn.dataset;
        if (!threadId || !commentId) return;
        const thread = store.getThreadById(threadId);
        const message = thread?.messages?.find((item) => item.id === commentId);
        if (isThreadClosed(thread)) {
          showGlobalSnackbar(ANNOTATION_MESSAGES.closedThreadRestricted);
          return;
        }
        if (!message || !isCommentEditableByCurrentUser(thread, message)) return;
        if (!openCommentEditor(threadId, commentId, message.text || '')) return;
        renderCommentsPanel();
        focusCommentEditor(threadId, commentId);
        return;
      }

      if (target.closest('.annotation-panel-reply-input')) return;
      if (target.closest('.annotation-panel-edit-form')) return;
      if (target.closest('.annotation-panel-status-select')) return;
      if (!(card instanceof HTMLElement)) return;

      const thread = store.getThreadById(card.dataset.threadId);
      if (!thread) return;
      annotationState.activeEditId = '';
      annotationState.activeMessageId = card.dataset.messageId || '';
      const targetEl = store.getElementForThread(thread);
      if (!targetEl) return;
      if (isThreadClosed(thread)) {
        annotationState.activeThreadId = thread.id;
        renderCommentsPanel();
        targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      openPopupForElement(targetEl, true);
    };
    annotationUI.panelEl.addEventListener('click', annotationState.panelClickHandler);

    annotationState.panelInputHandler = (event) => {
      const { target } = event;
      if (target instanceof HTMLInputElement && target.classList.contains('annotation-panel-reply-input')) {
        updatePanelReplyDraft(target.dataset.threadId, target.dataset.commentId, target.value);
        return;
      }
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!target.classList.contains('annotation-panel-edit-input')) return;
      updateCommentEditorDraft(target.value);
    };
    annotationUI.panelEl.addEventListener('input', annotationState.panelInputHandler);

    annotationState.panelKeydownHandler = (event) => {
      if (annotationUI.inlineMode) return;
      if (!isCommentsServiceAvailable()) return;
      const { target } = event;
      if (target instanceof HTMLInputElement && target.classList.contains('annotation-panel-reply-input')) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        submitPanelReply(target.dataset.threadId, target.dataset.commentId, target.value);
        return;
      }
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!target.classList.contains('annotation-panel-edit-input')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCommentEditor();
        renderCommentsPanel();
        return;
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submitCommentEdit(target.dataset.threadId, target.dataset.commentId, target.value);
      }
    };
    annotationUI.panelEl.addEventListener('keydown', annotationState.panelKeydownHandler);

    annotationState.panelFocusoutHandler = () => {
      schedulePendingCommentsPanelRefreshFlush();
    };
    annotationUI.panelEl.addEventListener('focusout', annotationState.panelFocusoutHandler);

    annotationState.panelChangeHandler = async (event) => {
      const { target } = event;
      if (annotationUI.inlineMode) return;
      if (!isCommentsServiceAvailable()) return;
      if (!(target instanceof HTMLSelectElement)) return;
      if (!target.classList.contains('annotation-panel-status-select')) return;
      const { threadId } = target.dataset;
      if (!threadId) return;
      const thread = store.getThreadById(threadId);
      if (!thread) return;
      if (!isThreadStatusEditableByCurrentUser(thread)) {
        target.value = thread.status;
        target.disabled = true;
        showGlobalSnackbar(ANNOTATION_MESSAGES.updateStatusRestricted);
        window.setTimeout(() => {
          target.disabled = false;
        }, 0);
        return;
      }
      const previousStatus = thread.status;
      const nextStatus = target.value;
      target.value = previousStatus;
      target.disabled = true;
      annotationState.activeThreadId = thread.id;
      annotationState.activeMessageId = '';
      try {
        const remoteThread = await annotationService.updateThreadStatus(threadId, nextStatus);
        if (!remoteThread) return;
        store.upsertThread(remoteThread);
        hideGlobalSnackbar();
        store.saveAnnotationStore();
        renderThreadMarkers({ resolveTargets: true });
        renderCommentsPanel();
        requestParentCollabRefresh('thread-status-updated');
      } catch (error) {
        showGlobalSnackbar(ANNOTATION_MESSAGES.updateStatusError);
        target.value = previousStatus;
        renderCommentsPanel();
        // eslint-disable-next-line no-console
        console.warn('Could not update thread status in service', error);
      } finally {
        target.disabled = false;
      }
    };
    annotationUI.panelEl.addEventListener('change', annotationState.panelChangeHandler);

    annotationState.documentClickHandler = (event) => {
      if (annotationUI.inlineMode) return;
      if (popupSubmitPending) return;
      const { target } = event;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('.annotation-floating-popup')) return;
      if (target.closest('.annotation-thread-marker')) return;
      if (target.closest('.annotation-comments-panel')) return;
      if (target.closest('main')) return;
      closePopupAndSelection();
    };
    document.addEventListener('click', annotationState.documentClickHandler);

    annotationState.mainScrollHandler = scheduleFloatingUISync;
    annotationState.windowResizeHandler = scheduleFloatingUISync;
    mainEl.addEventListener('scroll', annotationState.mainScrollHandler);
    window.addEventListener('resize', annotationState.windowResizeHandler);

    if (annotationUI.inlineToggleEl instanceof HTMLButtonElement) {
      annotationState.inlineToggleClickHandler = async (event) => {
        event.preventDefault();
        const button = annotationUI.inlineToggleEl;
        if (!(button instanceof HTMLButtonElement) || button.disabled) return;

        if (annotationUI.annotationMode === 'edit') {
          closeCommentEditor();
          closePopupAndSelection();
          annotationUI.annotationMode = 'comments';
          await disableInlineEditMode();
          updateModeButtonStates();
          renderThreadMarkers({ resolveTargets: true });
          renderCommentsPanel();
          return;
        }

        if (assetsPanel) assetsPanel.exitSelectMode();

        if (!isInlineEditingAllowed()) {
          closeCommentEditor();
          closePopupAndSelection();
          annotationUI.annotationMode = 'edit';
          await disableInlineEditMode();
          updateModeButtonStates();
          renderThreadMarkers({ resolveTargets: true });
          renderCommentsPanel();
          showGlobalSnackbar(ANNOTATION_MESSAGES.inlineEditRestrictedSnackbar);
          return;
        }
        if (!isCommentsServiceAvailable()) {
          annotationUI.annotationMode = 'comments';
          updateModeButtonStates();
          showGlobalSnackbar(ANNOTATION_MESSAGES.collabUnavailableSnackbar);
          return;
        }

        button.disabled = true;
        try {
          closeCommentEditor();
          closePopupAndSelection();
          annotationUI.annotationMode = 'edit';
          const didEnable = await enableInlineEditMode();
          if (!didEnable) {
            throw new Error('Inline edit mode unavailable');
          }
        } catch {
          annotationUI.annotationMode = 'comments';
        } finally {
          button.disabled = false;
        }
        updateModeButtonStates();
        renderThreadMarkers({ resolveTargets: true });
        renderCommentsPanel();
      };
      annotationUI.inlineToggleEl.addEventListener(
        'click',
        annotationState.inlineToggleClickHandler,
      );
    }

    if (annotationUI.inlineAssetsToggleEl instanceof HTMLButtonElement) {
      annotationState.inlineAssetsToggleClickHandler = async (event) => {
        event.preventDefault();
        const button = annotationUI.inlineAssetsToggleEl;
        if (!(button instanceof HTMLButtonElement) || button.disabled) return;

        if (annotationUI.annotationMode === 'assets') {
          annotationUI.annotationMode = 'comments';
          if (assetsPanel) assetsPanel.exitSelectMode();
          updateModeButtonStates();
          renderThreadMarkers({ resolveTargets: true });
          renderCommentsPanel();
          return;
        }

        closeCommentEditor();
        annotationUI.annotationMode = 'assets';
        await disableInlineEditMode();
        updateModeButtonStates();
        renderThreadMarkers({ resolveTargets: true });
        renderCommentsPanel();
      };
      annotationUI.inlineAssetsToggleEl.addEventListener(
        'click',
        annotationState.inlineAssetsToggleClickHandler,
      );
    }
  }

  return {
    applyPendingRemoteEditsSnapshot,
    applyRemoteCollabSnapshot,
    markSelfSavedEditsSnapshot,
    removePopup,
    renderCommentsPanel,
    renderThreadMarkers,
    setImageRegenHandler,
    setInlineModeHandlers,
    setupAnnotationUI,
  };
}
