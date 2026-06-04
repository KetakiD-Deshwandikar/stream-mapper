import { ANNOTATION_DEFAULT_USERNAME } from '../../utils/constants.js';
import { hideGlobalSyncIndicator, showGlobalSyncIndicator } from '../../utils/snackbar.js';
import { normalizeCommentStatus } from './store.js';

const SERVICE_STATUS_BY_COMMENT_STATUS = {
  Open: 'open',
  Accepted: 'accepted',
  Rejected: 'rejected',
  Closed: 'closed',
};

const COMMENT_STATUS_BY_SERVICE_STATUS = {
  open: 'Open',
  accepted: 'Accepted',
  rejected: 'Rejected',
  closed: 'Closed',
};

export function normalizeToken(token) {
  const value = `${token || ''}`.trim();
  if (!value) return '';
  return value.startsWith('Bearer ') ? value : `Bearer ${value}`;
}

export function getAnnotationCollabId() {
  const cfg = window.streamConfig || {};
  const collabId = cfg.collabId ?? cfg.collab_id;
  return `${collabId || ''}`.trim();
}

function normalizeAnchorElementPath(elementPath) {
  if (!elementPath) return null;
  if (typeof elementPath === 'object') {
    return elementPath;
  }
  try {
    const parsed = JSON.parse(elementPath);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (error) {
    // Ignore legacy plain-string paths.
  }
  return {
    selector: `${elementPath || ''}`,
  };
}

function sortComments(comments = []) {
  return [...comments].sort((left, right) => {
    const leftValue = new Date(left?.createdAt || 0).getTime();
    const rightValue = new Date(right?.createdAt || 0).getTime();
    return leftValue - rightValue;
  });
}

function normalizeThreadPayload(thread) {
  const comments = sortComments(thread?.comments || []);
  const rootComment = comments.find((comment) => !comment?.parentCommentId) || comments[0] || null;
  const rootCommentId = rootComment?.id || '';
  const isEditThread = Boolean(thread?.anchor?.isEdit);

  return {
    id: thread?.id || '',
    threadType: isEditThread ? 'edit' : 'comment',
    elementPath: thread?.anchor?.elementPath || '',
    elementRef: '',
    status: normalizeCommentStatus(
      COMMENT_STATUS_BY_SERVICE_STATUS[`${thread?.state || ''}`.toLowerCase()] || thread?.state || '',
    ),
    username: rootComment?.authorName || ANNOTATION_DEFAULT_USERNAME,
    messages: comments.map((comment) => ({
      id: comment.id || '',
      authorProfileId: comment.authorProfileId ?? null,
      username: comment.authorName || ANNOTATION_DEFAULT_USERNAME,
      text: comment.body || '',
      kind: comment.id === rootCommentId ? 'comment' : 'reply',
      replyToCommentId: comment.id === rootCommentId ? '' : (comment.parentCommentId || rootCommentId),
      createdAt: comment.createdAt || null,
      editedAt: comment.editedAt || null,
    })),
  };
}

function normalizeThreadsPayload(data) {
  let threadPayload = null;
  if (Array.isArray(data?.threads)) {
    threadPayload = data.threads;
  } else if (Array.isArray(data)) {
    threadPayload = data;
  }

  if (!Array.isArray(threadPayload)) return null;
  return threadPayload.map(normalizeThreadPayload).filter((thread) => thread.id);
}

function normalizeEditRecord(edit) {
  const normalizedAnchor = normalizeAnchorElementPath(edit?.elementPath);
  let normalizedElementProps = {};
  if (edit?.elementProps && typeof edit.elementProps === 'object') {
    normalizedElementProps = { ...edit.elementProps };
  } else if (normalizedAnchor && typeof normalizedAnchor === 'object') {
    normalizedElementProps = Object.fromEntries(
      Object.entries(normalizedAnchor).filter(([key]) => key !== 'selector'),
    );
  }

  const blockClass = `${edit?.blockClass || normalizedElementProps.blockClass || ''}`.trim();
  const blockSelector = `${edit?.blockSelector || ''}`.trim()
    || (blockClass ? `main .${blockClass}` : '');

  return {
    id: edit?.id || '',
    editType: edit?.editType || 'text',
    attrName: edit?.attrName || '',
    elementPath: `${edit?.elementPath || normalizedAnchor?.selector || ''}`,
    elementProps: normalizedElementProps,
    elementRef: edit?.elementRef || '',
    blockClass,
    blockSelector,
    from: `${edit?.from || ''}`,
    to: `${edit?.to || ''}`,
    fromHtml: `${edit?.fromHtml || ''}`,
    toHtml: `${edit?.toHtml || ''}`,
    changedFrom: `${edit?.changedFrom || ''}`,
    changedTo: `${edit?.changedTo || ''}`,
    updatedAt: edit?.updatedAt || null,
    authorUsername: edit?.authorUsername || edit?.authorName || '',
    viewport: edit?.viewport || '',
  };
}

function normalizeEditsSnapshot(data) {
  // Service has returned both shapes in practice:
  // { edits: { ...mergedSnapshot } } and { edits: [{ ...mergedSnapshot }] }.
  const editsPayload = Array.isArray(data?.edits)
    ? data.edits[0]
    : data?.edits || null;

  if (!editsPayload || typeof editsPayload !== 'object') {
    return {
      createdAt: null,
      authorUsername: '',
      editRecord: [],
    };
  }

  const authorUsername = `${editsPayload?.authorUsername || ''}`.trim();
  const editRecord = Array.isArray(editsPayload?.editRecord)
    ? editsPayload.editRecord
      .map((edit) => {
        const editAuthorUsername = `${edit?.authorUsername || edit?.authorName || ''}`.trim();
        return {
          ...normalizeEditRecord(edit),
          authorUsername: editAuthorUsername || authorUsername,
        };
      })
      .filter((edit) => edit.id)
    : [];

  return {
    createdAt: editsPayload?.createdAt || null,
    updatedAt: editsPayload?.updatedAt || editsPayload?.createdAt || null,
    authorUsername,
    editRecord,
  };
}

export default function createAnnotationServiceClient() {
  async function annotationServiceFetch(path, options = {}) {
    const resolvedServiceEndpoint = `${window.streamConfig?.streamMapper?.serviceEP || ''}`.trim();
    const collabId = getAnnotationCollabId();
    if (!resolvedServiceEndpoint || !collabId) return null;

    const headers = {
      ...(options.headers || {}),
    };
    const token = normalizeToken(window.streamConfig?.token);
    if (token) headers.Authorization = token;
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${resolvedServiceEndpoint}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`Annotation service request failed: ${response.status}`);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  function isAvailable() {
    return Boolean(getAnnotationCollabId());
  }

  function getCurrentUserIdentity() {
    const profileId = window.streamConfig?.profileId ?? null;

    return {
      profileId: profileId === null || profileId === undefined ? null : `${profileId}`,
    };
  }

  async function withSyncIndicator(message, callback) {
    showGlobalSyncIndicator(message);
    try {
      return await callback();
    } finally {
      hideGlobalSyncIndicator();
    }
  }

  async function getThread(threadId) {
    if (!threadId) return null;
    const data = await annotationServiceFetch(`/api/threads/${encodeURIComponent(threadId)}`);
    return data ? normalizeThreadPayload(data) : null;
  }

  async function listThreads() {
    const collabId = getAnnotationCollabId();
    if (!collabId) return null;
    const data = await annotationServiceFetch(`/api/collabs/${encodeURIComponent(collabId)}/threads`);
    if (!Array.isArray(data)) return [];
    return data.map(normalizeThreadPayload).filter((thread) => thread.id);
  }

  async function getEditsSnapshot() {
    const collabId = getAnnotationCollabId();
    if (!collabId) return null;
    try {
      const data = await annotationServiceFetch(`/api/collabs/${encodeURIComponent(collabId)}/edits`);
      return normalizeEditsSnapshot(data);
    } catch (error) {
      if (`${error?.message || ''}`.includes('404')) {
        return {
          createdAt: null,
          updatedAt: null,
          authorUsername: '',
          editRecord: [],
        };
      }
      throw error;
    }
  }

  async function listEdits() {
    const snapshot = await getEditsSnapshot();
    return snapshot?.editRecord || [];
  }

  async function createThread({
    elementPath,
    body,
    quotedText = null,
    threadType = 'comment',
  }) {
    return withSyncIndicator(
      threadType === 'edit' ? 'Saving edit...' : 'Posting comment...',
      async () => {
        const collabId = getAnnotationCollabId();
        if (!collabId) return null;
        const data = await annotationServiceFetch(`/api/collabs/${encodeURIComponent(collabId)}/threads`, {
          method: 'POST',
          body: JSON.stringify({
            anchor: {
              elementPath: normalizeAnchorElementPath(elementPath),
              isEdit: threadType === 'edit',
            },
            quotedText,
            body,
          }),
        });
        return data ? normalizeThreadPayload(data) : null;
      },
    );
  }

  async function createReply(threadId, body, options = {}) {
    const {
      loadingMessage = 'Sending reply...',
    } = options;

    return withSyncIndicator(loadingMessage, async () => {
      const collabId = getAnnotationCollabId();
      if (!collabId || !threadId) return null;
      await annotationServiceFetch(
        `/api/collabs/${encodeURIComponent(collabId)}/threads/${encodeURIComponent(threadId)}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({
            body,
          }),
        },
      );

      try {
        return {
          persisted: true,
          thread: await getThread(threadId),
        };
      } catch (error) {
        return {
          persisted: true,
          thread: null,
        };
      }
    });
  }

  async function updateThreadStatus(threadId, status) {
    return withSyncIndicator('Updating comment status...', async () => {
      if (!threadId) return null;
      const nextState = SERVICE_STATUS_BY_COMMENT_STATUS[normalizeCommentStatus(status)] || 'open';
      const data = await annotationServiceFetch(`/api/threads/${encodeURIComponent(threadId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: nextState }),
      });
      return data ? normalizeThreadPayload(data) : null;
    });
  }

  async function updateComment(commentId, body, threadId) {
    return withSyncIndicator('Saving comment...', async () => {
      if (!commentId || !threadId) return null;
      await annotationServiceFetch(`/api/comments/${encodeURIComponent(commentId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      });

      try {
        return {
          persisted: true,
          thread: await getThread(threadId),
        };
      } catch (error) {
        return {
          persisted: true,
          thread: null,
        };
      }
    });
  }

  async function saveEdits(edits = []) {
    return withSyncIndicator('Saving changes...', async () => {
      const collabId = getAnnotationCollabId();
      if (!collabId) {
        return {
          createdAt: null,
          updatedAt: null,
          authorUsername: '',
          editRecord: [],
        };
      }
      await annotationServiceFetch(`/api/collabs/${encodeURIComponent(collabId)}/edits`, {
        method: 'POST',
        body: JSON.stringify({
          edits,
        }),
      });

      try {
        const latestEdits = await getEditsSnapshot();
        if (latestEdits) {
          return latestEdits;
        }
      } catch (error) {
        // Ignore and fall back to local payload below.
      }

      return {
        createdAt: null,
        updatedAt: null,
        authorUsername: '',
        editRecord: edits.map(normalizeEditRecord).filter((edit) => edit.id),
      };
    });
  }

  return {
    createReply,
    createThread,
    getEditsSnapshot,
    getCurrentUserIdentity,
    isAvailable,
    listEdits,
    listThreads,
    normalizeEditsSnapshot,
    normalizeThreadsPayload,
    saveEdits,
    updateComment,
    updateThreadStatus,
  };
}
