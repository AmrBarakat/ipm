import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { file_url, project_id } = await req.json();
    if (!file_url || !project_id) {
      return Response.json({ error: 'file_url and project_id are required' }, { status: 400 });
    }

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `You are an expert industrial automation engineer. Analyze this project document (could be a project charter, technical specification, offer, or contract) and extract ALL equipment, materials, hardware, software, and services mentioned.

For each item, extract:
- description: full item description
- item_code: part number or item code if mentioned (otherwise empty string)
- category: one of: plc, hmi, drive, sensor, meter, panel, cable, network, software, service, other
- manufacturer: manufacturer or brand name if mentioned (otherwise empty string)
- manufacturer_part_number: manufacturer part number if mentioned (otherwise empty string)
- quantity: numeric quantity (default 1 if not specified)
- unit: unit of measure (pcs, m, set, lot, etc.)
- cost_price: unit cost/price if mentioned as a number (default 0)
- selling_price: selling price if mentioned (default 0)
- notes: any additional notes or specs

Rules:
- Extract EVERY piece of equipment, material, or service you can identify
- Be thorough — look for tables, lists, appendices, and inline mentions
- If quantities are in a table, use the table values
- If prices are mentioned, capture them
- Group similar items if they are clearly the same product
- Return ONLY a valid JSON object with a single key "items" containing an array

Return format:
{
  "items": [
    {
      "description": "...",
      "item_code": "...",
      "category": "...",
      "manufacturer": "...",
      "manufacturer_part_number": "...",
      "quantity": 1,
      "unit": "pcs",
      "cost_price": 0,
      "selling_price": 0,
      "notes": "..."
    }
  ]
}`,
      file_urls: [file_url],
      model: 'claude_sonnet_4_6',
      response_json_schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                item_code: { type: 'string' },
                category: { type: 'string' },
                manufacturer: { type: 'string' },
                manufacturer_part_number: { type: 'string' },
                quantity: { type: 'number' },
                unit: { type: 'string' },
                cost_price: { type: 'number' },
                selling_price: { type: 'number' },
                notes: { type: 'string' }
              }
            }
          }
        }
      }
    });

    return Response.json({ items: result.items || [] });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});