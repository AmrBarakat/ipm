/**
 * Step 1 — Upload & Auto-Recognize
 */
import { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Upload, FileSpreadsheet, Loader2, AlertTriangle } from 'lucide-react';

export default function BomStepUpload({ projectId, onRecognized }) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      setError('Only .xlsx, .xls, and .csv files are supported.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Upload file
      const { file_url } = await base44.integrations.Core.UploadFile({ file });

      // Run recognizer
      const res = await base44.functions.invoke('bomRecognizer', {
        file_url,
        project_id: projectId,
      });

      onRecognized({
        file_url,
        file_name: file.name,
        profile: res.data?.profile,
        sheet_names: res.data?.sheet_names,
        template_match: res.data?.template_match,
      });
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Recognition failed.');
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  }

  return (
    <div className="p-10 flex flex-col items-center justify-center min-h-[400px]">
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`w-full max-w-lg border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center cursor-pointer transition ${dragging ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:border-amber-300 hover:bg-slate-50'}`}
      >
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={e => handleFile(e.target.files[0])} />

        {loading ? (
          <div className="text-center">
            <Loader2 className="w-10 h-10 text-amber-500 animate-spin mx-auto mb-4" />
            <p className="font-semibold text-slate-700">Uploading & recognizing structure…</p>
            <p className="text-slate-400 text-sm mt-1">Running 4-layer column detection. This takes a few seconds.</p>
          </div>
        ) : (
          <div className="text-center">
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileSpreadsheet className="w-8 h-8 text-amber-500" />
            </div>
            <h3 className="font-semibold text-slate-700 text-lg mb-2">Drop your BOM file here</h3>
            <p className="text-slate-400 text-sm mb-4">Supports any Excel (.xlsx / .xls) or CSV layout — column order doesn't matter.</p>
            <span className="px-4 py-2 bg-amber-500 text-slate-900 font-semibold text-sm rounded-lg">
              Browse file
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 max-w-lg w-full text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <p className="text-xs text-slate-400 mt-6 text-center max-w-md">
        The recognizer auto-detects column structure using header names, position heuristics, and content shape analysis. You'll review and adjust the detected mapping in the next step.
      </p>
    </div>
  );
}