import { useState, useRef, useCallback, useEffect } from 'react';
import type { PillRef } from '../../types/board';
import { PillDropdown } from './PillDropdown';
import { ApiLookupDropdown } from '../apiLookup/ApiLookupDropdown';
import type { ApiDefinition } from '../apiLookup/apiRegistry';
import { getApiById } from '../apiLookup/apiRegistry';

export interface PromptDataSnapshot {
  text: string;
  promptTemplate: string;
  pills: PillRef[];
}

interface PillEditorProps {
  initialText: string;
  initialPills: PillRef[];
  objectId: string;
  onSave: (result: { text: string; promptTemplate: string; pills: PillRef[] }) => void;
  onCancel: () => void;
  style?: React.CSSProperties;
  /** Ref kept up-to-date with the latest serialized content so parent can save on click-outside */
  latestDataRef?: React.MutableRefObject<PromptDataSnapshot | null>;
  /** Callback to set apiConfig on the parent object when user selects an API via >> */
  onSetApiConfig?: (apiId: string) => void;
}

// Left-side nodes for inputs, right-side nodes for outputs
const INPUT_NODES  = [8, 7, 6, 1, 5]; // top-left, left, bottom-left, then overflow
const OUTPUT_NODES = [2, 3, 4, 1, 5]; // top-right, right, bottom-right, then overflow

/** Next free node from the correct side based on direction */
function nextFreeNode(pills: PillRef[], direction: 'in' | 'out' = 'in'): number {
  const used = new Set(pills.map((p) => p.node));
  const preferred = direction === 'in' ? INPUT_NODES : OUTPUT_NODES;
  for (const n of preferred) {
    if (!used.has(n)) return n;
  }
  // Fallback: any free node 1-8
  for (let n = 1; n <= 8; n++) {
    if (!used.has(n)) return n;
  }
  return 1;
}

/** Serialize contentEditable innerHTML back to plain text + template */
function serializeContent(container: HTMLDivElement, pills: PillRef[]): { text: string; promptTemplate: string } {
  const pillMap = new Map(pills.map((p) => [p.id, p]));
  let text = '';
  let template = '';

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
      template += node.textContent ?? '';
    } else if (node instanceof HTMLElement && node.dataset.pillId) {
      const pill = pillMap.get(node.dataset.pillId);
      if (pill) {
        text += `{${pill.label}}`;
        template += `{${pill.label}}`;
      }
    } else if (node instanceof HTMLElement && node.dataset.apiGroup) {
      // API block — serialize as [API:id]{input1} {input2} → {result}
      const apiId = node.dataset.apiGroup;
      text += `[API:${apiId}]`;
      template += `[API:${apiId}]`;
      // Walk children to pick up pill spans inside the block
      node.querySelectorAll('[data-pill-id]').forEach((pillEl) => {
        const pill = pillMap.get((pillEl as HTMLElement).dataset.pillId!);
        if (pill) {
          if (pill.direction === 'out') {
            text += ` \u2192 {${pill.label}}`;
            template += ` \u2192 {${pill.label}}`;
          } else {
            text += `{${pill.label}} `;
            template += `{${pill.label}} `;
          }
        }
      });
    } else if (node instanceof HTMLElement && node.tagName === 'BR') {
      text += '\n';
      template += '\n';
    } else {
      // DIV used as line break in contentEditable
      if (node instanceof HTMLElement && node.tagName === 'DIV' && node.previousSibling) {
        text += '\n';
        template += '\n';
      }
      node.childNodes.forEach(walk);
    }
  };

  container.childNodes.forEach(walk);
  return { text, promptTemplate: template };
}

/** Build an API block card DOM element */
function buildApiBlockDOM(
  apiId: string,
  apiName: string,
  apiIcon: string,
  inputPills: PillRef[],
  outputPills: PillRef[],
  onPillClick: (pill: PillRef, rect: DOMRect) => void,
  paramHints?: { name: string; placeholder: string }[],
): HTMLDivElement {
  const block = document.createElement('div');
  block.className = 'api-pill-block';
  block.contentEditable = 'false';
  block.dataset.apiGroup = apiId;

  // Header
  const header = document.createElement('div');
  header.className = 'api-pill-block-header';
  header.textContent = `${apiIcon} ${apiName}`;
  block.appendChild(header);

  // Inputs section
  if (inputPills.length > 0) {
    const inputsDiv = document.createElement('div');
    inputsDiv.className = 'api-pill-block-inputs';
    const inputLabel = document.createElement('span');
    inputLabel.className = 'api-pill-block-label';
    inputLabel.textContent = 'IN:';
    inputsDiv.appendChild(inputLabel);
    for (const pill of inputPills) {
      const pillEl = document.createElement('span');
      pillEl.className = 'pill-tag pill-tag-api-in';
      pillEl.contentEditable = 'false';
      pillEl.dataset.pillId = pill.id;
      pillEl.textContent = pill.label;
      pillEl.addEventListener('click', () => {
        const rect = pillEl.getBoundingClientRect();
        onPillClick(pill, rect);
      });
      inputsDiv.appendChild(pillEl);
      // Add placeholder hint after the pill
      const hint = paramHints?.find((h) => h.name === pill.label);
      if (hint) {
        const hintEl = document.createElement('span');
        hintEl.className = 'api-pill-block-hint';
        hintEl.textContent = hint.placeholder;
        inputsDiv.appendChild(hintEl);
      }
    }
    block.appendChild(inputsDiv);
  }

  // Outputs section
  if (outputPills.length > 0) {
    const outputsDiv = document.createElement('div');
    outputsDiv.className = 'api-pill-block-outputs';
    const outputLabel = document.createElement('span');
    outputLabel.className = 'api-pill-block-label';
    outputLabel.textContent = 'OUT:';
    outputsDiv.appendChild(outputLabel);
    for (const pill of outputPills) {
      const pillEl = document.createElement('span');
      pillEl.className = 'pill-tag pill-tag-api-out';
      pillEl.contentEditable = 'false';
      pillEl.dataset.pillId = pill.id;
      pillEl.textContent = pill.label;
      pillEl.addEventListener('click', () => {
        const rect = pillEl.getBoundingClientRect();
        onPillClick(pill, rect);
      });
      outputsDiv.appendChild(pillEl);
    }
    block.appendChild(outputsDiv);
  }

  return block;
}

export function PillEditor({
  initialText,
  initialPills,
  objectId: _objectId,
  onSave,
  onCancel,
  style,
  latestDataRef,
  onSetApiConfig,
}: PillEditorProps) {
  const [pills, setPills] = useState<PillRef[]>(initialPills);
  const [dropdownPill, setDropdownPill] = useState<{ pill: PillRef; position: { x: number; y: number } } | null>(null);
  const [apiLookup, setApiLookup] = useState<{ position: { x: number; y: number } } | null>(null);
  const [, setHasApiConfig] = useState(false);
  /** Stores info needed to remove the '>>' text and insert pills after API selection */
  const apiTriggerRef = useRef<{ firstGtCharIdx: number } | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef(pills);
  pillsRef.current = pills;

  const handlePillClickForDropdown = useCallback((pill: PillRef, rect: DOMRect) => {
    setDropdownPill({ pill, position: { x: rect.left, y: rect.bottom + 4 } });
  }, []);

  /** Build initial HTML from text + pills */
  const buildInitialHTML = useCallback(() => {
    let html = initialText;

    // Check for [API:xxx] blocks and reconstruct them
    const apiBlockMatch = html.match(/\[API:([^\]]+)\]/);
    if (apiBlockMatch) {
      const apiId = apiBlockMatch[1];
      const apiDef = getApiById(apiId);
      const apiName = apiDef?.name ?? apiId;
      const apiIcon = apiDef?.icon ?? '>';

      const apiPills = initialPills.filter((p) => p.apiGroup === apiId);
      const apiInputPills = apiPills.filter((p) => p.direction === 'in');
      const apiOutputPills = apiPills.filter((p) => p.direction === 'out');

      // Remove the [API:xxx] marker and the associated pill tokens from html
      // The serialized form is: [API:id]{input1} {input2}  → {result}
      let apiText = apiBlockMatch[0]; // starts with [API:xxx]
      for (const pill of apiPills) {
        apiText += `{${pill.label}} `;
        apiText += `\u2192 {${pill.label}} `;
      }
      // Remove everything from [API:xxx] to end (API block is always at the end or standalone)
      const markerIdx = html.indexOf(apiBlockMatch[0]);
      const beforeApi = html.substring(0, markerIdx);
      // Build the block HTML
      const inputSpans = apiInputPills.map((p) => {
        let span = makePillSpan(p, 'pill-tag-api-in');
        const paramDef = apiDef?.params.find((d) => d.name === p.label);
        if (paramDef?.placeholder) {
          span += `<span class="api-pill-block-hint">${escapeHtml(paramDef.placeholder)}</span>`;
        }
        return span;
      }).join(' ');
      const outputSpans = apiOutputPills.map((p) => makePillSpan(p, 'pill-tag-api-out')).join(' ');
      const blockHtml = `<div class="api-pill-block" contenteditable="false" data-api-group="${escapeHtml(apiId)}">` +
        `<div class="api-pill-block-header">${escapeHtml(apiIcon)} ${escapeHtml(apiName)}</div>` +
        (inputSpans ? `<div class="api-pill-block-inputs"><span class="api-pill-block-label">IN:</span>${inputSpans}</div>` : '') +
        (outputSpans ? `<div class="api-pill-block-outputs"><span class="api-pill-block-label">OUT:</span>${outputSpans}</div>` : '') +
        `</div>`;

      // Replace regular {label} pills in the text before the API block
      let beforeHtml = beforeApi;
      const nonApiPills = initialPills.filter((p) => !p.apiGroup);
      for (const pill of nonApiPills) {
        const pattern = `{${pill.label}}`;
        const pillHtml = makePillSpan(pill);
        beforeHtml = beforeHtml.split(pattern).join(pillHtml);
      }
      return beforeHtml.replace(/\n/g, '<br>') + blockHtml;
    }

    // No API block — regular pill replacement
    for (const pill of initialPills) {
      const pattern = `{${pill.label}}`;
      const pillHtml = makePillSpan(pill);
      html = html.split(pattern).join(pillHtml);
    }
    return html.replace(/\n/g, '<br>');
  }, [initialText, initialPills]);

  /** Sync latest serialized content into the parent-provided ref */
  const syncLatestData = useCallback(() => {
    if (!latestDataRef || !editorRef.current) return;
    const { text, promptTemplate } = serializeContent(editorRef.current, pillsRef.current);
    latestDataRef.current = { text, promptTemplate, pills: pillsRef.current };
  }, [latestDataRef]);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = buildInitialHTML();
      // Attach click handlers to any pill spans already in the DOM
      editorRef.current.querySelectorAll('[data-pill-id]').forEach((el) => {
        const pillId = (el as HTMLElement).dataset.pillId;
        if (!pillId) return;
        el.addEventListener('click', () => {
          const pill = pillsRef.current.find((p) => p.id === pillId);
          if (pill) {
            const rect = el.getBoundingClientRect();
            handlePillClickForDropdown(pill, rect);
          }
        });
      });
      editorRef.current.focus();
      // Move cursor to end
      const sel = window.getSelection();
      if (sel) {
        sel.selectAllChildren(editorRef.current);
        sel.collapseToEnd();
      }
      // Initialize the ref with current content
      syncLatestData();
    }
  // Only on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep ref in sync on every input
  const handleInput = useCallback(() => {
    syncLatestData();
  }, [syncLatestData]);

  /** Handle API selection from the >> dropdown */
  const handleApiSelect = useCallback((api: ApiDefinition) => {
    const container = editorRef.current;
    if (!container || !apiTriggerRef.current) {
      setApiLookup(null);
      return;
    }

    // Remove the '>' text from the editor
    const gtIdx = apiTriggerRef.current.firstGtCharIdx;
    const treeWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let charCount = 0;
    let gtNode: Text | null = null;
    let gtOffset = 0;

    while (treeWalker.nextNode()) {
      const textNode = treeWalker.currentNode as Text;
      const len = textNode.length;
      if (charCount + len > gtIdx) {
        gtNode = textNode;
        gtOffset = gtIdx - charCount;
        break;
      }
      charCount += len;
    }

    if (gtNode) {
      // Delete the first '>' (the second was prevented from being inserted)
      const deleteRange = document.createRange();
      deleteRange.setStart(gtNode, gtOffset);
      deleteRange.setEnd(gtNode, Math.min(gtOffset + 1, gtNode.length));
      deleteRange.deleteContents();
    }

    // Auto-create input pills for each API param (with apiGroup tag)
    const newPills: PillRef[] = [];
    const inputPills: PillRef[] = [];

    for (const param of api.params) {
      const pillId = crypto.randomUUID();
      const currentPills = [...pillsRef.current, ...newPills];
      const node = nextFreeNode(currentPills, 'in');
      const newPill: PillRef = { id: pillId, label: param.name, node, direction: 'in', apiGroup: api.id };
      newPills.push(newPill);
      inputPills.push(newPill);
    }

    // Create the output pill (with apiGroup tag)
    const outPillId = crypto.randomUUID();
    const allPillsSoFar = [...pillsRef.current, ...newPills];
    const outNode = nextFreeNode(allPillsSoFar, 'out');
    const outPill: PillRef = { id: outPillId, label: 'result', node: outNode, direction: 'out', apiGroup: api.id };
    newPills.push(outPill);

    // Build the API block card DOM element
    const blockEl = buildApiBlockDOM(
      api.id,
      api.name,
      api.icon,
      inputPills,
      [outPill],
      handlePillClickForDropdown,
      api.params,
    );

    // Insert the block at the cursor position (or end)
    container.appendChild(blockEl);

    // Move cursor after the block
    const sel = window.getSelection();
    if (sel) {
      const endRange = document.createRange();
      endRange.setStartAfter(blockEl);
      endRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(endRange);
    }

    // Update pills state
    setPills((prev) => {
      const next = [...prev, ...newPills];
      pillsRef.current = next;
      syncLatestData();
      return next;
    });

    // Signal apiConfig to parent
    onSetApiConfig?.(api.id);
    setHasApiConfig(true);

    // Close dropdown and clear trigger
    setApiLookup(null);
    apiTriggerRef.current = null;

    // Re-focus the editor
    container.focus();
  }, [onSetApiConfig, syncLatestData, handlePillClickForDropdown]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // If API lookup is open, close it instead of cancelling the edit
      if (apiLookup) {
        setApiLookup(null);
        apiTriggerRef.current = null;
        return;
      }
      onCancel();
      return;
    }

    // Detect '>>' trigger for API lookup
    if (e.key === '>') {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return; // let default behavior
      const range = sel.getRangeAt(0);
      const container = editorRef.current;
      if (!container) return;

      // Get text content before cursor
      const preRange = document.createRange();
      preRange.setStart(container, 0);
      preRange.setEnd(range.startContainer, range.startOffset);
      const textBefore = preRange.toString();

      if (textBefore.endsWith('>')) {
        e.preventDefault();

        // Calculate position for dropdown
        const rect = range.getBoundingClientRect();
        const pos = {
          x: rect.left || rect.right,
          y: (rect.bottom || rect.top) + 4,
        };

        // Store the char index of the first '>' (the one already in the editor)
        apiTriggerRef.current = { firstGtCharIdx: textBefore.length - 1 };
        setApiLookup({ position: pos });
        return;
      }
    }

    // On `}` keystroke, scan backward for matching `{`
    if (e.key === '}') {
      e.preventDefault();
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const container = editorRef.current;
      if (!container) return;

      // Get text content before cursor
      const preRange = document.createRange();
      preRange.setStart(container, 0);
      preRange.setEnd(range.startContainer, range.startOffset);
      const textBefore = preRange.toString();

      const braceIdx = textBefore.lastIndexOf('{');
      if (braceIdx === -1) {
        // No matching brace, just insert the character
        document.execCommand('insertText', false, '}');
        return;
      }

      const label = textBefore.slice(braceIdx + 1).trim();
      if (!label) {
        document.execCommand('insertText', false, '}');
        return;
      }

      // Create a pill
      const currentPills = pillsRef.current;
      const pillId = crypto.randomUUID();
      const defaultDir: 'in' | 'out' = 'in';
      const node = nextFreeNode(currentPills, defaultDir);
      const newPill: PillRef = { id: pillId, label, node, direction: defaultDir };

      // Remove the `{label` text and replace with pill span
      // Walk backwards from cursor to find and remove the `{label` text
      const treeWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let charCount = 0;
      let startNode: Text | null = null;
      let startOffset = 0;

      while (treeWalker.nextNode()) {
        const textNode = treeWalker.currentNode as Text;
        const len = textNode.length;
        if (charCount + len > braceIdx) {
          startNode = textNode;
          startOffset = braceIdx - charCount;
          break;
        }
        charCount += len;
      }

      if (startNode) {
        const deleteRange = document.createRange();
        deleteRange.setStart(startNode, startOffset);
        deleteRange.setEnd(range.startContainer, range.startOffset);
        deleteRange.deleteContents();

        // Insert pill element
        const pillEl = document.createElement('span');
        pillEl.className = `pill-tag pill-tag-${newPill.direction}`;
        pillEl.contentEditable = 'false';
        pillEl.dataset.pillId = pillId;
        pillEl.textContent = label;
        pillEl.addEventListener('click', () => {
          const rect = pillEl.getBoundingClientRect();
          setDropdownPill({ pill: { ...newPill }, position: { x: rect.left, y: rect.bottom + 4 } });
        });

        const insertRange = document.createRange();
        insertRange.setStart(startNode, Math.min(startOffset, startNode.length));
        insertRange.collapse(true);
        insertRange.insertNode(pillEl);

        // Move cursor after pill
        const afterRange = document.createRange();
        afterRange.setStartAfter(pillEl);
        afterRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(afterRange);
      }

      setPills((prev) => {
        const next = [...prev, newPill];
        pillsRef.current = next;
        syncLatestData();
        return next;
      });
    }
  }, [onCancel, syncLatestData, apiLookup]);

  const handleDone = useCallback(() => {
    if (!editorRef.current) return;
    const { text, promptTemplate } = serializeContent(editorRef.current, pillsRef.current);
    onSave({ text, promptTemplate, pills: pillsRef.current });
  }, [onSave]);

  const handlePillUpdate = useCallback((updated: PillRef) => {
    setPills((prev) => {
      const old = prev.find((p) => p.id === updated.id);
      let pill = updated;
      // Reassign node when direction changes so it moves to the correct side
      if (old && old.direction !== updated.direction) {
        const others = prev.filter((p) => p.id !== updated.id);
        pill = { ...updated, node: nextFreeNode(others, updated.direction) };
      }
      const next = prev.map((p) => p.id === pill.id ? pill : p);
      pillsRef.current = next;
      syncLatestData();
      return next;
    });
    // Update DOM element
    if (editorRef.current) {
      const el = editorRef.current.querySelector(`[data-pill-id="${updated.id}"]`);
      if (el) {
        el.textContent = updated.label;
        el.className = `pill-tag pill-tag-${updated.direction}`;
      }
    }
    setDropdownPill((prev) => prev ? { ...prev, pill: updated } : null);
  }, [syncLatestData]);

  const handlePillRemove = useCallback((pillId: string) => {
    setPills((prev) => {
      const next = prev.filter((p) => p.id !== pillId);
      pillsRef.current = next;
      return next;
    });
    // Remove from DOM
    if (editorRef.current) {
      const el = editorRef.current.querySelector(`[data-pill-id="${pillId}"]`);
      if (el) el.remove();
    }
    syncLatestData();
    setDropdownPill(null);
  }, [syncLatestData]);

  const handlePillClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.dataset.pillId) {
      const pill = pillsRef.current.find((p) => p.id === target.dataset.pillId);
      if (pill) {
        const rect = target.getBoundingClientRect();
        setDropdownPill({ pill, position: { x: rect.left, y: rect.bottom + 4 } });
      }
    }
  }, []);

  return (
    <div className="pill-editor-wrapper">
      <div
        ref={editorRef}
        className="pill-editor"
        contentEditable
        suppressContentEditableWarning
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        onClick={handlePillClick}
        style={style}
      />
      <div className="pill-editor-hint">{'{name}'} pill &middot; &gt;&gt; api</div>
      <div className="pill-editor-toolbar">
        <button className="text-edit-btn text-edit-btn-done" onClick={handleDone}>
          Done
        </button>
      </div>
      {/* Accumulator config is managed via board object properties, not PillEditor */}

      {dropdownPill && (
        <PillDropdown
          pill={dropdownPill.pill}
          position={dropdownPill.position}
          onUpdate={handlePillUpdate}
          onRemove={() => handlePillRemove(dropdownPill.pill.id)}
          onClose={() => setDropdownPill(null)}
        />
      )}

      {apiLookup && (
        <ApiLookupDropdown
          position={apiLookup.position}
          onSelect={handleApiSelect}
          onClose={() => { setApiLookup(null); apiTriggerRef.current = null; }}
        />
      )}
    </div>
  );
}

function makePillSpan(pill: PillRef, extraClass?: string): string {
  const cls = extraClass ?? `pill-tag-${pill.direction}`;
  return `<span class="pill-tag ${cls}" contenteditable="false" data-pill-id="${pill.id}">${escapeHtml(pill.label)}</span>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
