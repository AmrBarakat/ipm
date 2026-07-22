/**
 * BOM Skill Save — writes confirmed preview rows into BOMItem entity.
 * Handles parent/child (panel) rows, conflict detection, and template saving.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let user = null;
    try { user = await base44.auth.me(); } catch (_) { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { project_id, preview_rows, conflict_resolutions, save_template, template_name, profile } = await req.json();
    if (!project_id || !preview_rows) return Response.json({ error: 'project_id and preview_rows required' }, { status: 400 });

    // Load existing BOM items for conflict detection
    const existing = await base44.asServiceRole.entities.BOMItem.filter({ project_id });
    const existingByPartNo = {};
    for (const item of existing) {
      if (item.manufacturer_part_number) existingByPartNo[item.manufacturer_part_number.toLowerCase()] = item;
    }

    const skipped = [];
    const merged = [];

    // Map preview_id → DB id for parent rows (needed for child parent_id)
    const previewIdToDbId = {};

    // Process top-level rows first, then children
    const topLevelRows = preview_rows.filter(r => !r.is_child);
    const childRows = preview_rows.filter(r => r.is_child);

    // Separate rows into those needing merge vs bulk create
    const toCreate = [];
    for (const row of topLevelRows) {
      const partNoKey = (row.manufacturer_part_number || '').toLowerCase();
      const resolution = conflict_resolutions?.[row.preview_id] || (partNoKey && existingByPartNo[partNoKey] ? 'skip' : 'create');
      const existingItem = partNoKey ? existingByPartNo[partNoKey] : null;

      if (existingItem && resolution === 'skip') {
        skipped.push(row.preview_id);
        previewIdToDbId[row.preview_id] = existingItem.id;
        continue;
      }

      if (existingItem && resolution === 'merge') {
        await base44.asServiceRole.entities.BOMItem.update(existingItem.id, {
          quantity: existingItem.quantity + (row.quantity ?? 1),
        });
        merged.push(existingItem.id);
        previewIdToDbId[row.preview_id] = existingItem.id;
        continue;
      }

      toCreate.push(row);
    }

    // Bulk create top-level rows in batches of 25
    const BATCH = 25;
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < toCreate.length; i += BATCH) {
      const batch = toCreate.slice(i, i + BATCH).map(row => ({
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
        delivery_status: row.delivery_status || 'not_delivered',
        panel_allocations: Array.isArray(row.panel_allocations) ? row.panel_allocations : [],
        currency: 'SAR',
      }));
      const newItems = await base44.asServiceRole.entities.BOMItem.bulkCreate(batch);
      newItems.forEach((newItem, idx) => {
        previewIdToDbId[toCreate[i + idx].preview_id] = newItem.id;
      });
      if (i + BATCH < toCreate.length) await delay(300);
    }

    // Bulk create child rows in batches of 25
    const childPayloads = childRows.map(child => ({
      project_id,
      parent_id: previewIdToDbId[child._parent_preview_id] || null,
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
      delivery_status: 'not_delivered',
      currency: 'SAR',
    }));
    for (let i = 0; i < childPayloads.length; i += BATCH) {
      await base44.asServiceRole.entities.BOMItem.bulkCreate(childPayloads.slice(i, i + BATCH));
      if (i + BATCH < childPayloads.length) await delay(300);
    }

    const created = toCreate.length + childPayloads.length;

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
      created,
      skipped: skipped.length,
      merged: merged.length,
      template_id: savedTemplate?.id || null,
    });

  } catch (err) {
    return Response.json({ error: err.message || 'Save failed' }, { status: 500 });
  }
});