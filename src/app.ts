import m, { type Component } from 'mithril';
import katex from 'katex';
import { compareVersion, ProofStore, REVIEW_STATUS_LABELS, RULES } from './store';
import type { ProofDocument, ProofStep, ReviewStatus, StepReview } from './types';

const store = new ProofStore();

const snippets = [
  { label: '∀', value: '\\forall ' },
  { label: '∃', value: '\\exists ' },
  { label: '→', value: '\\to ' },
  { label: '⇔', value: '\\iff ' },
  { label: '≠', value: '\\ne ' },
  { label: '≤', value: '\\le ' },
  { label: '≥', value: '\\ge ' },
  { label: '∈', value: '\\in ' },
  { label: '∑', value: '\\sum_{i=1}^{n} ' },
  { label: '√', value: '\\sqrt{}' },
  { label: '分式', value: '\\frac{}{}' },
  { label: '上标', value: '^{}' },
  { label: '下标', value: '_{}' },
];

const typeLabel: Record<ProofStep['type'], string> = {
  premise: '前提',
  derivation: '推导',
  goal: '目标 / 结论',
};

const reviewOrder: ReviewStatus[] = ['pending', 'approved', 'hold'];

function renderRichText(text: string): m.Children {
  const parts = text.split(/(\$[^$]+\$)/g);
  return parts.map((part) => {
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      try {
        return m.trust(katex.renderToString(part.slice(1, -1), { throwOnError: false, output: 'html' }));
      } catch {
        return part;
      }
    }
    return part;
  });
}

function shortId(id: string): string {
  return id.replace(/^step-/, '').slice(-4).toUpperCase();
}

function formatStamp(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function reviewChip(review: StepReview): m.Children {
  return m('span.review-chip', { class: `is-${review.status}` }, [
    review.status === 'approved' ? '✓' : review.status === 'hold' ? '❚❚' : '✎',
    REVIEW_STATUS_LABELS[review.status],
    review.returnedAt && m('em.review-returned', '已退回'),
  ]);
}

function download(name: string, content: string, mime: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type: mime }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportMarkdown(document: ProofDocument): string {
  const lines = [`# ${document.title}`, '', `**证明目标：** $${document.goal}$`, ''];
  document.steps.forEach((step, index) => {
    const refs = step.references.map((id) => `步骤 ${document.steps.findIndex((item) => item.id === id) + 1}`).filter((ref) => ref !== '步骤 0');
    lines.push(`## ${index + 1}. ${step.statement}`);
    lines.push('');
    lines.push(`- 类型：${typeLabel[step.type]}`);
    lines.push(`- 推理规则：${step.rule}`);
    if (refs.length) lines.push(`- 依据：${refs.join('、')}`);
    if (step.note) lines.push(`- 旁注：${step.note}`);
    if (step.counterexample) lines.push(`- 反例：${step.counterexample}`);
    if (step.alternative) lines.push(`- 替代分支：${step.alternative}`);
    // 送审稿只附已通过步骤的审阅意见。
    if (step.review.status === 'approved') {
      lines.push(`- 审阅意见（${step.review.reviewer || '未署名'} · ${formatStamp(step.review.reviewedAt) || '未记录时间'}）：${step.review.comment || '通过，无补充意见。'}`);
    }
    lines.push('');
  });
  lines.push('## 符号表');
  Object.entries(document.symbols).forEach(([symbol, meaning]) => lines.push(`- $${symbol}$：${meaning}`));
  return lines.join('\n');
}

function exportLatex(document: ProofDocument): string {
  const lines = ['\\documentclass{article}', '\\usepackage{amsmath,amssymb}', '\\begin{document}', `\\section*{${document.title}}`, `\\textbf{证明目标：} $${document.goal}$`, '\\begin{enumerate}'];
  document.steps.forEach((step) => {
    const refs = step.references.map((id) => document.steps.findIndex((item) => item.id === id) + 1).filter(Boolean);
    const support = refs.length ? `（依据 ${refs.join(', ')}；${step.rule}）` : `（${step.rule}）`;
    lines.push(`  \\item ${step.statement} ${support}`);
    if (step.note) lines.push(`  \\par\\small 旁注：${step.note}`);
    // 送审稿只附已通过步骤的审阅意见。
    if (step.review.status === 'approved') {
      lines.push(`  \\par\\small 审阅意见（${step.review.reviewer || '未署名'}）：${step.review.comment || '通过，无补充意见。'}`);
    }
  });
  lines.push('\\end{enumerate}', '\\end{document}');
  return lines.join('\n');
}

export class ProofApp implements Component {
  private readonly onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const inEditor = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? store.redo() : store.undo();
      m.redraw();
      return;
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      store.redo();
      m.redraw();
      return;
    }
    if (command && event.key === 'Enter') {
      event.preventDefault();
      store.addStep(event.shiftKey ? 'goal' : 'derivation');
      m.redraw();
      return;
    }
    if (command && event.key.toLowerCase() === 's') {
      event.preventDefault();
      store.save();
      store.notify('已保存到浏览器');
      m.redraw();
      return;
    }
    if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && !inEditor) {
      event.preventDefault();
      const steps = store.current.steps;
      const index = steps.findIndex((step) => step.id === store.selectedStepId);
      const next = event.key === 'ArrowDown' ? Math.min(index + 1, steps.length - 1) : Math.max(index - 1, 0);
      store.selectStep(steps[next]?.id ?? '');
      document.querySelector(`[data-step="${store.selectedStepId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      m.redraw();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !inEditor && store.selectedStepId) {
      event.preventDefault();
      store.removeStep(store.selectedStepId);
      m.redraw();
    }
  };

  oncreate(): void {
    window.addEventListener('keydown', this.onKeyDown);
  }

  onremove(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }

  reviewEditor(selected: ProofStep): m.Children {
    const review = selected.review;
    const author = store.current.author;
    return m('div.review-editor', [
      m('label.field-label', '审阅状态'),
      m('div.review-switch', reviewOrder.map((status) => m('button.review-option', {
        class: review.status === status ? `is-active is-${status}` : '',
        onclick: () => { store.setReview(status); m.redraw(); },
        title: status === 'pending' ? '退回待改' : status === 'approved' ? '审阅通过' : '暂缓处理',
      }, REVIEW_STATUS_LABELS[status]))),
      m('label.field-label', '审阅人'),
      m('input.input.is-small.review-reviewer', {
        value: review.reviewer,
        placeholder: author ? `${author}（可修改）` : '输入审阅人姓名',
        onfocus: (event: Event) => { store.lastInput = event.target as HTMLInputElement; },
        oninput: (event: Event) => store.setReview(review.status, { reviewer: (event.target as HTMLInputElement).value }),
      }),
      m('label.field-label', '修改建议 / 审阅意见'),
      m('textarea.textarea.is-small.review-comment', {
        rows: 2,
        value: review.comment,
        placeholder: review.status === 'approved' ? '记录通过理由（可选）' : '写明需要修改的问题或暂缓原因',
        oninput: (event: Event) => store.setReview(review.status, { comment: (event.target as HTMLTextAreaElement).value }),
      }),
      (review.reviewedAt || review.returnedAt) && m('p.review-meta',
        review.returnedAt
          ? [`曾通过，编辑后于 ${formatStamp(review.returnedAt)} 自动退回待改，原意见保留`]
          : [`${REVIEW_STATUS_LABELS[review.status]}于 ${formatStamp(review.reviewedAt)}`, review.reviewer ? ` · ${review.reviewer}` : ''],
      ),
    ]);
  }

  view(): m.Children {
    const document = store.current;
    const selected = store.selectedStep;
    const checks = store.checks;
    const errors = checks.filter((check) => check.severity === 'error').length;
    const warnings = checks.filter((check) => check.severity === 'warning').length;
    const summary = store.reviewSummary;
    const selectedVersion = document.versions.find((version) => version.id === store.compareVersionId);
    const diff = selectedVersion ? compareVersion(document, selectedVersion) : [];
    const reviewChangeCount = diff.filter((item) => item.reviewChanged && item.beforeId && item.afterId && item.beforeId === item.afterId).length;
    const headState = errors ? 'has-error' : summary.finalizable ? 'is-ok' : 'is-waiting';
    const headCopy = errors
      ? `${errors} 个结构错误`
      : summary.finalizable
        ? '全部步骤通过审阅，可定稿'
        : `审阅进行中 ${summary.approved}/${summary.total}`;

    return m('div.app-shell', [
      m('header.topbar', [
        m('div.brand', [
          m('div.brand-mark', '∑'),
          m('div', [m('p.eyebrow', 'FORMAL NOTEBOOK'), m('h1', '格致 · 证明编辑器')]),
        ]),
        m('div.topbar-center', [
          m('span.status-dot', { class: headState }),
          headCopy,
          m('span.topbar-separator'),
          `自动保存于 ${new Date(document.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
        ]),
        m('div.actions', [
          m('button.button.is-light', { onclick: () => { store.undo(); m.redraw(); }, disabled: !store.undoStack.length, title: '撤销 Ctrl+Z' }, '↶ 撤销'),
          m('button.button.is-light', { onclick: () => { store.redo(); m.redraw(); }, disabled: !store.redoStack.length, title: '重做 Ctrl+Y' }, '↷ 重做'),
          m('button.button.is-link', { onclick: () => { store.addStep('derivation'); m.redraw(); }, title: '添加步骤 Ctrl+Enter' }, '+ 添加步骤'),
        ]),
      ]),
      m('main.workspace', [
        m('aside.left-rail', [
          m('section.panel.document-panel', [
            m('div.panel-heading', [m('span', '证明文档'), m('button.icon-button', { onclick: () => { store.addDocument(); m.redraw(); }, title: '新建证明' }, '+')]),
            m('div.document-list', store.documents.map((item) => m('button.document-item', {
              class: item.id === document.id ? 'is-active' : '',
              onclick: () => { store.selectDocument(item.id); m.redraw(); },
            }, [
              m('span.document-glyph', item.steps.length),
              m('span.document-copy', [m('strong', item.title), m('small', `${item.steps.length} 步 · ${item.author}`)]),
              m('span.chevron', '›'),
            ]))),
          ]),
          m('section.panel.version-panel', [
            m('div.panel-heading', [m('span', '版本快照'), m('span.count-badge', document.versions.length)]),
            document.versions.length === 0 && m('p.empty-copy', '保存快照后，可以并排查看改动（含审阅变化）。'),
            m('div.version-list', document.versions.map((version) => {
              const approved = version.steps.filter((step) => step.review.status === 'approved').length;
              return m('button.version-item', {
                class: version.id === store.compareVersionId ? 'is-active' : '',
                onclick: () => { store.compareVersionId = store.compareVersionId === version.id ? '' : version.id; m.redraw(); },
              }, [
                m('span', [version.name, m('small.version-review', `审阅通过 ${approved}/${version.steps.length}`)]),
                m('small', new Date(version.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })),
              ]);
            })),
            m('button.button.is-fullwidth.is-small', { onclick: () => { store.createVersion(); m.redraw(); } }, '＋ 保存当前版本'),
          ]),
          m('section.check-summary', [
            m('div.check-summary-head', [
              m('div', [m('span.eyebrow', 'LIVE CHECK'), m('h2', '证明检查')]),
              m('span.check-total', { class: errors ? 'has-error' : '' }, errors + warnings),
            ]),
            m('div.review-counts', reviewOrder.map((status) => m('span.review-pill', { class: `is-${status}` }, [
              REVIEW_STATUS_LABELS[status],
              m('strong', String(summary[status])),
            ]))),
            m('div.check-summary-bars', [
              m('span', { style: { width: `${Math.max(8, 100 - errors * 24 - warnings * 8)}%` } }),
            ]),
            m('p', summary.finalizable
              ? `✓ ${summary.total} 个步骤全部通过审阅，可以定稿送审。`
              : summary.hold
                ? `${summary.pending} 步待改、${summary.hold} 步暂缓，暂不能定稿。`
                : `${summary.pending} 步待改，全部通过后方可定稿。`),
            summary.finalizable
              ? m('div.finalize-badge', '✓ 可定稿')
              : m('div.finalize-badge.is-blocked', '● 未定稿'),
          ]),
        ]),
        m('section.editor-column', [
          m('div.editor-titlebar', [
            m('div', [
              m('input.title-input', { value: document.title, oninput: (event: Event) => { store.update((item) => { item.title = (event.target as HTMLInputElement).value; }); } }),
              m('div.editor-meta', [`${document.author} · ${document.steps.length} 个步骤`, m('span.keyboard-hint', '拖动 ⠿ 排序')]),
            ]),
            m('div.export-actions', [
              m('button.button.is-small', { onclick: () => download(`${document.title}.md`, exportMarkdown(document), 'text/markdown;charset=utf-8') }, '导出 Markdown'),
              m('button.button.is-small', { onclick: () => download(`${document.title}.tex`, exportLatex(document), 'application/x-tex;charset=utf-8') }, '导出 LaTeX'),
            ]),
          ]),
          m('section.goal-card', [
            m('div.goal-label', '证明目标'),
            m('div.goal-formula', renderRichText(`$${document.goal}$`)),
            m('input.formula-input', {
              value: document.goal,
              onfocus: (event: Event) => { store.lastInput = event.target as HTMLInputElement; },
              oninput: (event: Event) => store.update((item) => { item.goal = (event.target as HTMLInputElement).value; }),
              'aria-label': '证明目标',
            }),
          ]),
          m('div.steps-toolbar', [
            m('div', [m('strong', '证明步骤'), m('span.steps-count', `${document.steps.length} 步`)]),
            m('div.steps-toolbar-actions', [
              m('button.button.is-small.is-white', { onclick: () => { store.addStep('premise'); m.redraw(); } }, '＋ 前提'),
              m('button.button.is-small.is-white', { onclick: () => { store.addStep('derivation'); m.redraw(); } }, '＋ 推导'),
              m('button.button.is-small.is-white', { onclick: () => { store.addStep('goal'); m.redraw(); } }, '＋ 结论'),
            ]),
          ]),
          m('div.steps-list', document.steps.length === 0 && m('div.empty-state', '尚无步骤。按 Ctrl+Enter 开始添加。'), document.steps.map((step, index) => {
            const stepChecks = checks.filter((check) => check.stepId === step.id);
            return m('article.step-card', {
              'data-step': step.id,
              class: [step.id === store.selectedStepId ? 'is-selected' : '', `review-${step.review.status}`].join(' '),
              draggable: true,
              onclick: () => { store.selectStep(step.id); m.redraw(); },
              ondragstart: () => { store.dragStepId = step.id; },
              ondragover: (event: DragEvent) => event.preventDefault(),
              ondrop: (event: DragEvent) => { event.preventDefault(); store.moveStep(store.dragStepId, step.id); store.dragStepId = ''; m.redraw(); },
            }, [
              m('div.step-rail', [
                m('span.drag-handle', { title: '拖动排序' }, '⠿'),
                m('span.step-number', String(index + 1).padStart(2, '0')),
              ]),
              m('div.step-body', [
                m('div.step-head', [
                  m('span.tag', { class: step.type === 'goal' ? 'is-success' : step.type === 'premise' ? 'is-info' : 'is-light' }, typeLabel[step.type]),
                  m('span.rule-chip', step.rule),
                  reviewChip(step.review),
                  step.review.reviewer && m('span.review-by', step.review.reviewer),
                  m('span.step-id', `#${shortId(step.id)}`),
                  stepChecks.length > 0 && m('span.issue-badge', `${stepChecks.length} 项检查`),
                  m('button.step-menu', { onclick: (event: Event) => { event.stopPropagation(); store.removeStep(step.id); m.redraw(); }, title: '删除步骤' }, '×'),
                ]),
                m('div.step-statement', renderRichText(step.statement)),
                m('div.step-footer', [
                  m('span', step.references.length ? `依据：${step.references.map((reference) => {
                    const referenceIndex = document.steps.findIndex((item) => item.id === reference);
                    return referenceIndex >= 0 ? `步骤 ${referenceIndex + 1}` : `缺失 ${shortId(reference)}`;
                  }).join('、')}` : '独立前提'),
                  step.note && m('span.has-note', '含旁注'),
                  step.counterexample && m('span.has-counterexample', '含反例'),
                  step.alternative && m('span.has-branch', '含替代分支'),
                  step.review.comment && m('span.review-quote', { class: `is-${step.review.status}` }, `审阅：${step.review.comment}`),
                ]),
              ]),
            ]);
          })),
        ]),
        m('aside.right-rail', [
          selected ? m('section.panel.inspector', [
            m('div.panel-heading', [m('span', '步骤检查器'), m('span.inspector-step', `#${shortId(selected.id)}`)]),
            m('label.field-label', '步骤类型'),
            m('div.select.is-fullwidth', m('select', { value: selected.type, onchange: (event: Event) => store.updateStep({ type: (event.target as HTMLSelectElement).value as ProofStep['type'] }) }, Object.entries(typeLabel).map(([value, label]) => m('option', { value }, label)))),
            m('label.field-label', '推理规则'),
            m('div.select.is-fullwidth', m('select', { value: selected.rule, onchange: (event: Event) => store.updateStep({ rule: (event.target as HTMLSelectElement).value }) }, RULES.map((rule) => m('option', { value: rule }, rule)))),
            m('label.field-label', '命题或推导式'),
            m('textarea.textarea.formula-textarea', {
              value: selected.statement,
              rows: 4,
              onfocus: (event: Event) => { store.lastInput = event.target as HTMLTextAreaElement; },
              oninput: (event: Event) => store.updateStep({ statement: (event.target as HTMLTextAreaElement).value }),
            }),
            m('div.formula-toolbar', snippets.map((snippet) => m('button.formula-key', {
              title: `插入 ${snippet.label}`,
              onclick: (event: Event) => {
                event.preventDefault();
                const input = store.lastInput;
                if (!input) return;
                const start = input.selectionStart ?? input.value.length;
                const end = input.selectionEnd ?? start;
                const next = input.value.slice(0, start) + snippet.value + input.value.slice(end);
                input.value = next;
                if (input instanceof HTMLTextAreaElement) {
                  if (input.classList.contains('review-comment')) store.setReview(selected.review.status, { comment: next });
                  else store.updateStep({ statement: next });
                } else if (input.classList.contains('review-reviewer')) {
                  store.setReview(selected.review.status, { reviewer: next });
                } else store.update((document) => { document.goal = next; });
                input.focus();
                const cursor = start + snippet.value.length;
                input.setSelectionRange(cursor, cursor);
                m.redraw();
              },
            }, snippet.label))),
            m('label.field-label', '引用步骤'),
            m('div.reference-list', document.steps.filter((step) => step.id !== selected.id).map((step) => m('label.reference-item', [
              m('input', {
                type: 'checkbox',
                checked: selected.references.includes(step.id),
                onchange: (event: Event) => {
                  const checked = (event.target as HTMLInputElement).checked;
                  const references = checked ? [...selected.references, step.id] : selected.references.filter((id) => id !== step.id);
                  store.updateStep({ references });
                },
              }),
              m('span', `步骤 ${document.steps.indexOf(step) + 1}`),
              m('small', step.statement.replace(/\$/g, '')),
            ]))),
            m('div.field-grid', [
              m('div', [m('label.field-label', '旁注'), m('textarea.textarea.is-small', { rows: 2, value: selected.note, placeholder: '记录思路或条件', oninput: (event: Event) => store.updateStep({ note: (event.target as HTMLTextAreaElement).value }) })]),
              m('div', [m('label.field-label', '反例 / 边界情况'), m('textarea.textarea.is-small', { rows: 2, value: selected.counterexample, placeholder: '尝试寻找反例', oninput: (event: Event) => store.updateStep({ counterexample: (event.target as HTMLTextAreaElement).value }) })]),
              m('div', [m('label.field-label', '替代分支'), m('textarea.textarea.is-small', { rows: 2, value: selected.alternative, placeholder: '另一种可行推导', oninput: (event: Event) => store.updateStep({ alternative: (event.target as HTMLTextAreaElement).value }) })]),
            ]),
            this.reviewEditor(selected),
            m('button.button.is-small.is-white.is-fullwidth.add-symbol', {
              onclick: () => {
                const symbol = window.prompt('输入符号名称');
                if (!symbol) return;
                const meaning = window.prompt('输入符号含义') ?? '待补充';
                store.update((document) => { document.symbols[symbol] = meaning; });
                m.redraw();
              },
            }, '＋ 登记新符号'),
          ]) : m('section.panel.inspector', m('p.empty-copy', '选择一个步骤进行检查。')),
          m('section.panel.symbol-panel', [
            m('div.panel-heading', [m('span', '符号表'), m('span.count-badge', Object.keys(document.symbols).length)]),
            m('div.symbol-list', Object.entries(document.symbols).map(([symbol, meaning]) => m('div.symbol-row', [
              m('code', symbol),
              m('input.symbol-meaning', { value: meaning, oninput: (event: Event) => store.update((item) => { item.symbols[symbol] = (event.target as HTMLInputElement).value; }) }),
            ]))),
          ]),
          m('section.panel.checks-panel', [
            m('div.panel-heading', [m('span', '检查结果'), m('span.count-badge', checks.length)]),
            summary.total > 0 && !summary.finalizable && m('div.gate-banner', [
              m('strong', '暂不能定稿'),
              m('small', `还有 ${summary.pending} 步待改${summary.hold ? `、${summary.hold} 步暂缓` : ''}，通过后导出送审稿。`),
            ]),
            summary.finalizable && m('div.gate-banner.is-ok', [
              m('strong', '可定稿送审'),
              m('small', '全部步骤已通过审阅，导出文件将附带各步审阅意见。'),
            ]),
            m('div.check-list', checks.map((check) => m('button.check-item', {
              class: check.severity,
              onclick: () => { if (check.stepId) { store.selectStep(check.stepId); globalThis.document.querySelector(`[data-step="${check.stepId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } m.redraw(); },
            }, [
              m('span.check-icon', check.severity === 'error' ? '×' : check.severity === 'warning' ? '!' : '✓'),
              m('span', [m('strong', check.title), m('small', check.detail)]),
            ]))),
          ]),
          m('section.shortcut-card', [
            m('span.eyebrow', 'KEYBOARD'),
            m('p', [m('kbd', 'Ctrl'), ' + ', m('kbd', 'Enter'), ' 新步骤']),
            m('p', [m('kbd', 'Alt'), ' + ', m('kbd', '↑↓'), ' 切换步骤']),
            m('p', [m('kbd', 'Ctrl'), ' + ', m('kbd', 'Z'), ' 撤销']),
          ]),
        ]),
      ]),
      selectedVersion && m('div.diff-overlay', { onclick: () => { store.compareVersionId = ''; m.redraw(); } }, [
        m('section.diff-dialog', { onclick: (event: Event) => event.stopPropagation() }, [
          m('header.diff-head', [
            m('div', [m('span.eyebrow', 'VERSION DIFF'), m('h2', `${selectedVersion.name} ↔ 当前版本`)]),
            m('button.delete', { onclick: () => { store.compareVersionId = ''; m.redraw(); } }),
          ]),
          m('div.diff-summary', [
            m('span.tag.is-danger', `删除 ${diff.filter((item) => item.kind === 'removed').length}`),
            m('span.tag.is-success', `新增 ${diff.filter((item) => item.kind === 'added').length}`),
            m('span.tag.is-warning', `修改 ${diff.filter((item) => item.kind === 'changed').length}`),
            m('span.tag.is-info', `审阅变化 ${reviewChangeCount}`),
            m('span.tag.is-light', `未变 ${diff.filter((item) => item.kind === 'same').length}`),
          ]),
          m('div.diff-table', [
            m('div.diff-row.diff-header', [m('span', '位置'), m('span', '旧版本'), m('span', '当前版本'), m('span', '审阅变化')]),
            ...diff.map((item) => {
              const samePosition = item.beforeId && item.afterId && item.beforeId === item.afterId;
              const reviewCell = samePosition
                ? m('span.diff-review', { class: item.reviewChanged ? 'is-changed' : '' }, item.reviewChanged
                  ? [
                      m('span.review-chip.is-mini', { class: `is-${item.beforeReview?.status ?? 'pending'}` }, REVIEW_STATUS_LABELS[item.beforeReview?.status ?? 'pending']),
                      ' → ',
                      m('span.review-chip.is-mini', { class: `is-${item.afterReview?.status ?? 'pending'}` }, REVIEW_STATUS_LABELS[item.afterReview?.status ?? 'pending']),
                      (item.beforeReview?.reviewer !== item.afterReview?.reviewer || item.beforeReview?.comment !== item.afterReview?.comment)
                        && m('small', '审阅人或意见有修改'),
                    ]
                  : [m('span.review-chip.is-mini', { class: `is-${item.afterReview?.status ?? 'pending'}` }, REVIEW_STATUS_LABELS[item.afterReview?.status ?? 'pending']), m('small', '无变化')])
                : m('span.diff-review', '—');
              return m('div.diff-row', { class: `is-${item.kind}${item.reviewChanged && samePosition ? ' review-changed' : ''}` }, [
                m('span.diff-label', item.label),
                m('span', item.before || '—'),
                m('span', item.after || '—'),
                reviewCell,
              ]);
            }),
          ]),
        ]),
      ]),
      store.toast && m('div.toast-notification', store.toast),
    ]);
  }
}
