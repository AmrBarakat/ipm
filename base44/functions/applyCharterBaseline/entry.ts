/**
 * applyCharterBaseline — the APPLY step for the charter review flow.
 *
 * Takes the reviewed-and-edited proposals from the modal and commits them in
 * one call, mirroring applyPODNExtraction's single-write-point contract:
 *
 *   create BaselineLine rows → activate CharterBaseline → update Project →
 *   close Extraction (status "completed" + created_entity_refs) → AuditLog.
 *
 * Identity field checkboxes: only checked fields with non-blank charter values
 * are written to the Project — a blank never overwrites a populated field.
 *
 * Input: { extraction_id, project_id, identity_updates, proposals }
 * Output: { extraction_id, baseline_id, line_count, warnings }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { requirePrivilege } from '../../shared/requirePrivilege.ts';

function cleanObj(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const denied = requirePrivilege(user, 'create');
    if (denied) return denied;

    const body = await req.json();
    const { extraction_id, project_id, identity_updates, proposals } = body;
    if (!extraction_id || !project_id)
      return Response.json({ error: 'extraction_id and project_id are required' }, { status: 400 });

    const actor = user?.full_name || user?.email || 'system';
    const now = new Date().toISOString();

    // ── Read extraction (must be "review", kind "charter") ──────────────────
    const extraction = await base44.asServiceRole.entities.Extraction.get(extraction_id);
    if (!extraction) return Response.json({ error: 'Extraction not found' }, { status: 404 });
    if (extraction.status !== 'review')
      return Response.json({ error: `Extraction is ${extraction.status}, not review` }, { status: 400 });
    if (extraction.extraction_kind !== 'charter')
      return Response.json({ error: 'Extraction is not a charter extraction' }, { status: 400 });

    // ── Find CharterBaseline from existing refs ────────────────────────────
    const existingRefs = Array.isArray(extraction.created_entity_refs) ? extraction.created_entity_refs : [];
    const baselineRef = existingRefs.find(r => r.entity_type === 'CharterBaseline');
    if (!baselineRef) return Response.json({ error: 'No CharterBaseline linked to this extraction' }, { status: 400 });
    const baseline_id = baselineRef.entity_id;

    const baseline = await base44.asServiceRole.entities.CharterBaseline.get(baseline_id);
    if (!baseline) return Response.json({ error: 'CharterBaseline not found' }, { status: 404 });

    // ── Use proposals from the body, or fall back to stored proposals ──────
    const lines = Array.isArray(proposals) && proposals.length > 0
      ? proposals
      : (Array.isArray(extraction.proposals) ? extraction.proposals : []);

    const refs = [...existingRefs];
    const warnings = [];

    // ── 1. Create BaselineLine records from proposals ─────────────────────
    let lineCount = 0;
    for (const p of lines) {
      if (p.status === 'rejected') continue;
      const payload = p.payload || p;
      const created = await base44.asServiceRole.entities.BaselineLine.create({
        baseline_id,
        project_id,
        stream: payload.stream || 'goods',
        line_type: payload.line_type || 'revenue',
        description: payload.description || '',
        amount: Number(payload.amount) || 0,
        currency: payload.currency || 'SAR',
        sort_order: payload.sort_order || (lineCount + 1),
        source_ref: payload.source_ref || '',
        expense_category: payload.expense_category || 'material',
        notes: payload.notes || '',
      });
      refs.push({ entity_type: 'BaselineLine', entity_id: created.id, action: 'created', before: {}, applied_updated_date: created.updated_date });
      lineCount++;
    }

    // ── 2. Activate CharterBaseline (draft → active) ───────────────────────
    const baselineBefore = cleanObj({ status: baseline.status || 'draft' });
    const updatedBaseline = await base44.asServiceRole.entities.CharterBaseline.update(baseline_id, { status: 'active' });
    const baselineRefIdx = refs.findIndex(r => r.entity_type === 'CharterBaseline' && r.entity_id === baseline_id);
    if (baselineRefIdx >= 0) {
      refs[baselineRefIdx] = {
        entity_type: 'CharterBaseline', entity_id: baseline_id, action: 'updated',
        before: baselineBefore, applied_updated_date: updatedBaseline?.updated_date,
      };
    } else {
      refs.push({ entity_type: 'CharterBaseline', entity_id: baseline_id, action: 'updated', before: baselineBefore, applied_updated_date: updatedBaseline?.updated_date });
    }

    // ── 3. Update Project — active_charter_baseline_id + identity fields ───
    // Identity checkboxes: only checked fields with non-blank charter values
    // are written — a blank never overwrites a populated Project field.
    const project = await base44.asServiceRole.entities.Project.get(project_id);
    const projectBefore = cleanObj({ active_charter_baseline_id: project?.active_charter_baseline_id || '' });
    const projectUpdate = { active_charter_baseline_id: baseline_id };

    const identityUpdates = identity_updates || {};
    const header = extraction.header || {};
    const identity = header.identity || {};
    const IDENTITY_TO_PROJECT = {
      project_name: 'name',
      client: 'client',
      project_manager: 'project_manager',
      currency: 'currency',
    };
    for (const [identityField, projectField] of Object.entries(IDENTITY_TO_PROJECT)) {
      if (!identityUpdates[identityField]) continue;
      const val = identity[identityField];
      if (val != null && String(val).trim() !== '') {
        projectUpdate[projectField] = val;
      } else {
        warnings.push(`Identity field "${identityField}" checked but value is blank — Project.${projectField} left unchanged.`);
      }
    }

    const updatedProject = await base44.asServiceRole.entities.Project.update(project_id, projectUpdate);
    refs.push({ entity_type: 'Project', entity_id: project_id, action: 'updated', before: projectBefore, applied_updated_date: updatedProject?.updated_date });

    // ── 4. Close extraction ────────────────────────────────────────────────
    await base44.asServiceRole.entities.Extraction.update(extraction_id, {
      status: 'completed',
      applied_at: now,
      applied_by: actor,
      created_entity_refs: refs,
    });

    // ── 5. AuditLog — action "baseline_activated" ──────────────────────────
    await base44.asServiceRole.entities.AuditLog.create({
      project_id,
      entity_type: 'CharterBaseline',
      entity_id: baseline_id,
      action: 'baseline_activated',
      actor,
      summary: `Charter baseline "${baseline.revision_label || 'Rev 0'}" activated — ${lineCount} line items`,
      metadata: { extraction_id, line_count: lineCount },
    });

    return Response.json({
      extraction_id,
      baseline_id,
      line_count: lineCount,
      warnings,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Apply failed' }, { status: 500 });
  }
});