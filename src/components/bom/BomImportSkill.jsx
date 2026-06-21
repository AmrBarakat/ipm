/**
 * BomImportSkill — full 4-step BOM import wizard
 * Step 1: Upload → Step 2: Mapping Review → Step 3: Preview/Edit → Step 4: Save
 */
import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Upload, X } from 'lucide-react';
import BomStepUpload from './BomStepUpload';
import BomStepMapping from './BomStepMapping';
import BomStepPreview from './BomStepPreview';
import BomStepSave from './BomStepSave';

const STEPS = ['Upload & Recognize', 'Confirm Mapping', 'Preview & Edit', 'Save to BOM'];

export default function BomImportSkill({ projectId, initialDocument, onClose, onImported }) {
  const [step, setStep] = useState(0);
  const [fileUrl, setFileUrl] = useState(null);
  const [fileName, setFileName] = useState('');
  const [profile, setProfile] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [templateMatch, setTemplateMatch] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [summary, setSummary] = useState(null);

  function handleRecognized({ file_url, file_name, profile, sheet_names, template_match }) {
    setFileUrl(file_url);
    setFileName(file_name);
    setProfile(profile);
    setSheetNames(sheet_names || []);
    setTemplateMatch(template_match);
    setStep(1);
  }

  function handleMappingConfirmed(confirmedProfile) {
    setProfile(confirmedProfile);
    setStep(2);
  }

  function handlePreviewReady({ preview_rows, warnings, summary }) {
    setPreviewRows(preview_rows);
    setWarnings(warnings || []);
    setSummary(summary);
  }

  function handleSaved() {
    onImported?.();
    onClose?.();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              <Upload className="w-5 h-5 text-amber-500" /> BOM Import — Smart Recognition
            </h2>
            {fileName && <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xl">{fileName}</p>}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0 px-6 py-3 border-b border-slate-100 shrink-0">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition ${i === step ? 'bg-amber-500 text-slate-900' : i < step ? 'text-emerald-600' : 'text-slate-400'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i === step ? 'bg-slate-900 text-amber-400' : i < step ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                  {i < step ? '✓' : i + 1}
                </span>
                {s}
              </div>
              {i < STEPS.length - 1 && <div className="w-6 h-px bg-slate-200 mx-1" />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {step === 0 && (
            <BomStepUpload
              projectId={projectId}
              initialDocument={initialDocument}
              onRecognized={handleRecognized}
            />
          )}
          {step === 1 && profile && (
            <BomStepMapping
              profile={profile}
              sheetNames={sheetNames}
              templateMatch={templateMatch}
              fileUrl={fileUrl}
              onConfirm={handleMappingConfirmed}
              onBack={() => setStep(0)}
            />
          )}
          {step === 2 && profile && (
            <BomStepPreview
              fileUrl={fileUrl}
              profile={profile}
              onPreviewReady={handlePreviewReady}
              previewRows={previewRows}
              warnings={warnings}
              summary={summary}
              onBack={() => setStep(1)}
              onProceed={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <BomStepSave
              projectId={projectId}
              previewRows={previewRows}
              profile={profile}
              warnings={warnings}
              summary={summary}
              onSaved={handleSaved}
              onBack={() => setStep(2)}
            />
          )}
        </div>
      </div>
    </div>
  );
}