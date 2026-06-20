/**
 * BOM Skill Save — writes confirmed preview rows into BOMItem entity.
 * Handles parent/child (panel) rows, conflict detection, and template saving.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { project_id, preview_rows, conflict_resolutions, save_template, template_name, profile } = await req.json();
    if (!project_id || !preview_rows) return Response.json({ error: 'project_id and preview_rows required' }, { status: 400 });

    // Load existing BOM items for conflict detection
    const existing = await base44.asServiceRole.entities.BOMItem.filter({ project_id });
    const existingByPartNo = {};
    for (const item of existing) {
      if (item.manufacturer_part_number) existingByPartNo[item.manufacturer_part_number.toLowerCase()] = item;
    }

    const created = [];
    const skipped = [];
    const merged = [];
    const errors = [];

    // Map preview_id → DB id for parent rows (needed for child parent_id)
    const previewIdToDbId = {};

    // Process top-level rows first, then children
    const topLevelRows = preview_rows.filter(r => !r.is_child);
    const childRows = preview_rows.filter(r => r.is_child);

    for (const row of topLevelRows) {
      const partNoKey = (row.manufacturer_part_number || '').toLowerCase();
      const resolution = conflict_resolutions?.[row.preview_id] || (partNoKey && existingByPartNo[partNoKey] ? 'skip' : 'create');
      const existingItem = partNoKey ? existingByPartNo[partNoKey] : null;

      const payload = {
        project_id,
        description: row.description,
        category: row.category || 'other',
        supplier: row.supplier || '',
        manufacturer_part_number: row.manufacturer_part_number || '',
        quantity: row.quantity ?? 1,
        unit: row.unit || 'pcs',
        planned_cost_price: row.planned_cost_price ?? 0,
        actual_cost_price: row.actual_cost_price ?? row.planned_cost_price ?? 0,
        cost_price: row.planned_cost_price ?? 0,
        selling_price: row.selling_price ?? 0,
        stock_qty: row.stock_qty ?? 0,
        order_status: row.order_status || 'not_ordered',
        delivery_status: row.delivery_status || 'pending',
        currency: 'SAR',
      };

      if (existingItem && resolution === 'skip') {
        skipped.push(row.preview_id);
        previewIdToDbId[row.preview_id] = existingItem.id;
        continue;
      }

      if (existingItem && resolution === 'merge') {
        // Merge: sum quantities, keep existing prices unless overridden
        const updated = await base44.asServiceRole.entities.BOMItem.update(existingItem.id, {
          quantity: existingItem.quantity + payload.quantity,
        });
        merged.push(existingItem.id);
        previewIdToDbId[row.preview_id] = existingItem.id;
        continue;
      }

      // Create new
      const newItem = await base44.asServiceRole.entities.BOMItem.create(payload);
      previewIdToDbId[row.preview_id] = newItem.id;
      created.push(newItem.id);
    }

    // Create child rows with parent_id resolved
    for (const child of childRows) {
      const parentDbId = previewIdToDbId[child._parent_preview_id];
      const payload = {
        project_id,
        parent_id: parentDbId || null,
        description: child.description,
        category: child.category || 'other',
        supplier: child.supplier || '',
        manufacturer_part_number: child.manufacturer_part_number || '',
        quantity: child.quantity ?? 1,
        unit: child.unit || 'pcs',
        planned_cost_price: child.planned_cost_price ?? 0,
        actual_cost_price: child.actual_cost_price ?? child.planned_cost_price ?? 0,
        cost_price: child.planned_cost_price ?? 0,
        selling_price: child.selling_price ?? 0,
        stock_qty: 0,
        order_status: 'not_ordered',
        delivery_status: 'pending',
        currency: 'SAR',
      };
      const newChild = await base44.asServiceRole.entities.BOMItem.create(payload);
      created.push(newChild.id);
    }

    // Save template if requested
    let savedTemplate = null;
    if (save_template && template_name && profile) {
      savedTemplate = await base44.asServiceRole.entities.BOMTemplate.create({
        name: template_name,
        recognition_profile: profile,
        is_default: false,
      });
    }

    return Response.json({
      created: created.length,
      skipped: skipped.length,
      merged: merged.length,
      errors,
      template_id: savedTemplate?.id || null,
    });

  } catch (err) {
    return Response.json({ error: err.message || 'Save failed' }, { status: 500 });
  }
});