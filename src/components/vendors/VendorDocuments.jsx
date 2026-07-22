import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Upload, FileText, Trash2 } from 'lucide-react';
import { formatBytes, formatDate } from '@/lib/constants';

/**
 * VendorDocuments — upload, list and remove files linked to a vendor.
 * Files are stored via the UploadFile integration; only metadata is kept on
 * the vendor record. Calls onChange(newDocumentsArray) on every change so the
 * parent can persist immediately.
 */
export default function VendorDocuments({ documents = [], onChange }) {
  const [uploading, setUploading] = useState(false);

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      onChange([...documents, {
        file_url,
        file_name: file.name,
        content_type: file.type,
        file_size: file.size,
        uploaded_date: new Date().toISOString(),
        category: 'other',
      }]);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  function remove(idx) { onChange(documents.filter((_, i) => i !== idx)); }

  return (
    <div className="space-y-2">
      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-amber-300 text-amber-700 hover:bg-amber-50 rounded text-xs font-semibold cursor-pointer">
        <Upload className="w-3.5 h-3.5" /> {uploading ? 'Uploading…' : 'Upload document'}
        <input type="file" onChange={onUpload} className="hidden" disabled={uploading} />
      </label>
      {documents.length === 0 ? (
        <p className="text-xs text-slate-400 italic">No documents linked yet.</p>
      ) : (
        <div className="space-y-1.5">
          {documents.map((d, i) => (
            <div key={i} className="flex items-center gap-2 border border-slate-200 rounded px-2.5 py-2">
              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <a href={d.file_url} target="_blank" rel="noreferrer" className="text-sm text-blue-700 hover:underline truncate block">{d.file_name || 'Document'}</a>
                <div className="text-[11px] text-slate-400">{formatBytes(d.file_size)} · {formatDate((d.uploaded_date || '').slice(0, 10))}</div>
              </div>
              <button onClick={() => remove(i)} className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}