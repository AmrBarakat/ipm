import { Link } from 'react-router-dom';
import { ArrowLeft, FolderPlus } from 'lucide-react';
import ProjectForm from '@/components/projects/ProjectForm';

export default function NewProject() {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/projects" className="text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <FolderPlus className="text-amber-500 w-6 h-6" /> New Project
          </h1>
          <p className="text-sm text-slate-500">Fill in the details to create a new project.</p>
        </div>
      </div>
      <ProjectForm />
    </div>
  );
}