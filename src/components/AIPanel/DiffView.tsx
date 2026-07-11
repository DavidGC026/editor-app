import { useMemo } from 'react';
import { diffLines, Change } from 'diff';
import { X, Check, GitCompare } from 'lucide-react';
import { useStore } from '../../store';

/**
 * GitHub-style line-by-line diff modal. Shown whenever the agent calls
 * `escribir_archivo` on an existing file. The user must either accept or
 * reject the changes — the agent loop blocks on this decision.
 */
export default function DiffView() {
  const pendingDiff = useStore((s) => s.aiPendingDiff);
  const resolver = useStore((s) => s.aiPendingDiffResolver);

  const changes: Change[] = useMemo(() => {
    if (!pendingDiff) return [];
    return diffLines(pendingDiff.before, pendingDiff.after);
  }, [pendingDiff]);

  if (!pendingDiff) return null;

  // Build a single-column unified diff with old/new line numbers per row.
  const rows: { type: 'add' | 'del' | 'eq'; text: string; oldNo?: number; newNo?: number }[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const c of changes) {
    const lines = c.value.split('\n');
    // diffLines preserves trailing newlines; drop the empty last item.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
      if (c.added) {
        rows.push({ type: 'add', text: line, newNo: newLine++ });
      } else if (c.removed) {
        rows.push({ type: 'del', text: line, oldNo: oldLine++ });
      } else {
        rows.push({ type: 'eq', text: line, oldNo: oldLine++, newNo: newLine++ });
      }
    }
  }

  const handleAccept = () => {
    if (resolver) resolver(true);
  };
  const handleReject = () => {
    if (resolver) resolver(false);
  };

  // Stats
  const additions = rows.filter((r) => r.type === 'add').length;
  const deletions = rows.filter((r) => r.type === 'del').length;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
    >
      <div
        className="w-[min(880px,92vw)] h-[min(640px,80vh)] bg-forge-sidebar border border-forge-border rounded-md shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-forge-border">
          <div className="flex items-center gap-2 min-w-0">
            <GitCompare size={16} className="text-forge-accent flex-shrink-0" />
            <h2 className="text-forge-text-strong text-sm font-medium truncate">
              Cambios propuestos: {pendingDiff.relPath}
            </h2>
            <span className="text-[11px] text-green-400 ml-2 flex-shrink-0">
              +{additions}
            </span>
            <span className="text-[11px] text-red-400 flex-shrink-0">
              −{deletions}
            </span>
          </div>
          <button
            onClick={handleReject}
            className="text-forge-text hover:text-forge-text-strong"
            title="Rechazar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Diff body */}
        <div
          className="flex-1 overflow-auto sidebar-scroll font-mono text-[12px] leading-[1.45]"
          style={{ background: '#1F2025' }}
        >
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {rows.map((r, i) => {
                let bg = 'transparent';
                let prefix = ' ';
                let textColor = '#D0D3DA';
                if (r.type === 'add') {
                  bg = 'rgba(74, 219, 148, 0.12)';
                  prefix = '+';
                  textColor = '#A6F3CB';
                } else if (r.type === 'del') {
                  bg = 'rgba(255, 107, 107, 0.12)';
                  prefix = '−';
                  textColor = '#FFB3B3';
                }
                return (
                  <tr key={i} style={{ background: bg }}>
                    <td
                      className="text-right px-2 select-none"
                      style={{
                        width: 48,
                        color: '#6e7280',
                        borderRight: '1px solid #2A2D38',
                      }}
                    >
                      {r.oldNo ?? ''}
                    </td>
                    <td
                      className="text-right px-2 select-none"
                      style={{
                        width: 48,
                        color: '#6e7280',
                        borderRight: '1px solid #2A2D38',
                      }}
                    >
                      {r.newNo ?? ''}
                    </td>
                    <td
                      className="pl-2 pr-3 whitespace-pre-wrap break-words"
                      style={{ color: textColor }}
                    >
                      <span className="select-none mr-2 opacity-60">{prefix}</span>
                      {r.text || ' '}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-forge-border">
          <button
            onClick={handleReject}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] text-forge-text hover:text-forge-text-strong border border-forge-border hover:border-forge-text/40"
          >
            <X size={14} /> Rechazar
          </button>
          <button
            onClick={handleAccept}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium bg-forge-accent text-black hover:opacity-90"
          >
            <Check size={14} /> Aceptar cambios
          </button>
        </div>
      </div>
    </div>
  );
}
